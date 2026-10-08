"""Does the web copy (limbusdm/site.py) answer what its pages ask for?

The packed site is served from the disk the way its host serves it and every page is opened in a headless browser
(Edge, which Windows has; Chrome otherwise). The site's service worker notes each request it has no file for
(ui/site/sw.js, /api/_misses) and the page hands the list over (ui/site/site.js, "?check"). So a page that started
asking for something new — or a new page — shows up here, not as an error in front of a visitor.
"""
from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from urllib.request import Request, urlopen

# pages that can't work from files (they render with the game's files, or are the app's own controls): never opened
APP_ONLY = {"versus", "vsroom", "vslive", "browse", "snapshots", "scan", "settings", "sprites"}


def find_browser() -> str | None:
    for root in (os.environ.get("ProgramFiles(x86)"), os.environ.get("ProgramFiles"), os.environ.get("LOCALAPPDATA")):
        for rel in (r"Microsoft\Edge\Application\msedge.exe", r"Google\Chrome\Application\chrome.exe"):
            p = os.path.join(root or "", rel)
            if root and os.path.exists(p):
                return p
    return shutil.which("msedge") or shutil.which("chrome")


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class _Tab:
    """One browser tab over the DevTools protocol."""

    def __init__(self, ws_url: str):
        from websocket import create_connection
        self.ws = create_connection(ws_url, suppress_origin=True, timeout=60)
        self.n = 0

    def call(self, method: str, **params):
        self.n += 1
        self.ws.send(json.dumps({"id": self.n, "method": method, "params": params}))
        while True:
            m = json.loads(self.ws.recv())
            if m.get("id") == self.n:
                return m.get("result", {})

    def js(self, expr: str):
        return self.call("Runtime.evaluate", expression=expr, awaitPromise=True, returnByValue=True).get("result", {}).get("value")


TABS = 4  # pages looked at at once


def check(root: str, routes: list[str] | None = None, progress=None, settle: float = 8.0) -> dict:
    """{"routes": [every page the UI has], "misses": {page: [requests without a file]}, "error": str | None}.
    routes: the pages to open (None: all but APP_ONLY). settle: the longest a page is waited for to go quiet (it
    says so itself: ui/site/site.js)."""
    from .site import serve_dir
    out = {"routes": [], "misses": {}, "error": None}
    exe = find_browser()
    if not exe:
        out["error"] = "no Edge or Chrome to open the site with"
        return out
    httpd = serve_dir(root)
    base = f"http://127.0.0.1:{httpd.server_address[1]}"
    port, prof = _free_port(), tempfile.mkdtemp(prefix="limbus-sitecheck-")
    proc = subprocess.Popen([exe, "--headless=new", f"--remote-debugging-port={port}", f"--user-data-dir={prof}", "--window-size=1400,1000",
                             "--remote-allow-origins=*", "--mute-audio", "--no-first-run", "--disable-background-timer-throttling",
                             "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "about:blank"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    tab, more = None, []
    try:
        tabs = None
        for _ in range(60):
            try:
                tabs = json.load(urlopen(f"http://127.0.0.1:{port}/json", timeout=2))
                break
            except Exception:
                time.sleep(0.25)
        if not tabs:
            raise RuntimeError("the browser didn't start")
        tab = _Tab(next(t for t in tabs if t["type"] == "page")["webSocketDebuggerUrl"])
        tab.call("Page.enable")

        def visit(route: str, n: int, tab=tab) -> dict:
            # (another "check" value each time: the page loads anew, with the service worker already in charge)
            tab.call("Page.navigate", url=f"{base}/?check={n}&settle={int(settle * 1000)}#/{route}")
            end = time.time() + 90
            while time.time() < end:
                time.sleep(0.3)
                try:
                    got = tab.js('(document.getElementById("site-check") || {}).textContent || ""')
                except Exception:
                    got = ""
                if got:
                    return json.loads(got)
            raise RuntimeError(f"the page #{route} didn't finish loading")
        first = visit("patches", 0)
        out["routes"] = first["routes"]
        todo = routes if routes is not None else [r for r in first["routes"] if r not in APP_ONLY]
        # a tab per page being looked at (the service worker tells the tabs' requests apart)
        for _ in range(min(TABS, len(todo)) - 1):
            t = json.load(urlopen(Request(f"http://127.0.0.1:{port}/json/new?about:blank", method="PUT"), timeout=10))
            more.append(_Tab(t["webSocketDebuggerUrl"]))
            more[-1].call("Page.enable")
        free, done = [tab] + more, [0]

        def one(job):
            i, r = job
            t = free.pop()
            try:
                return r, first if r == "patches" else visit(r, i + 1, t)
            finally:
                free.append(t)
                done[0] += 1
                if progress:
                    progress("site: checking the pages", done[0], len(todo), r)
        with ThreadPoolExecutor(len(free)) as pool:
            for r, res in pool.map(one, enumerate(todo)):
                if res["misses"]:
                    out["misses"][r] = sorted(set(res["misses"]))
    except Exception as e:
        out["error"] = f"{type(e).__name__}: {e}"
    finally:
        for t in more:
            try:
                t.ws.close()
            except Exception:
                pass
        try:
            if tab:
                tab.call("Browser.close")
        except Exception:
            pass
        try:
            proc.wait(5)
        except Exception:
            subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)], capture_output=True,
                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        httpd.shutdown()
        shutil.rmtree(prof, ignore_errors=True)
    return out
