"""Checks that the web copy answers what its pages ask: the packed site served locally, every page opened in headless Edge
/ Chrome, misses reported by the service worker."""
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

from .site import PAGES

# pages that can't work from files: never opened (site.PAGES "app")
APP_ONLY = {r for r, p in PAGES.items() if p.get("app")}


def find_browser() -> str | None:
    for root in (os.environ.get("ProgramFiles(x86)"), os.environ.get("ProgramFiles"), os.environ.get("LOCALAPPDATA")):
        for rel in (r"Microsoft\Edge\Application\msedge.exe", r"Google\Chrome\Application\chrome.exe"):
            p = os.path.join(root or "", rel)
            if root and os.path.exists(p):
                return p
    return shutil.which("msedge") or shutil.which("chrome")


def _kernel32():
    import ctypes
    from ctypes import wintypes
    k = ctypes.WinDLL("kernel32", use_last_error=True)
    k.CreateJobObjectW.restype = k.OpenProcess.restype = wintypes.HANDLE
    k.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
    k.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
    k.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    k.TerminateJobObject.argtypes = [wintypes.HANDLE, wintypes.UINT]
    k.CloseHandle.argtypes = [wintypes.HANDLE]
    return k


def start_browser(args: list, **kw) -> subprocess.Popen:
    """A headless browser that dies with this process, however it ends (a Windows job per browser: kill on close)."""
    proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0), **kw)
    if os.name == "nt":
        try:
            import ctypes
            from ctypes import wintypes
            k = _kernel32()

            class Limits(ctypes.Structure):  # JOBOBJECT_EXTENDED_LIMIT_INFORMATION
                _fields_ = [("a", ctypes.c_int64 * 2), ("flags", wintypes.DWORD), ("b", ctypes.c_size_t * 2), ("c", wintypes.DWORD),
                            ("d", ctypes.c_size_t), ("e", wintypes.DWORD), ("f", wintypes.DWORD), ("io", ctypes.c_uint64 * 6), ("g", ctypes.c_size_t * 4)]
            job, lim = k.CreateJobObjectW(None, None), Limits()
            lim.flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            h = k.OpenProcess(0x0101, False, proc.pid)  # PROCESS_SET_QUOTA | PROCESS_TERMINATE
            if job and h and k.SetInformationJobObject(job, 9, ctypes.byref(lim), ctypes.sizeof(lim)) and k.AssignProcessToJobObject(job, h):
                proc.job = job  # type: ignore[attr-defined]
            elif job:
                k.CloseHandle(job)
            if h:
                k.CloseHandle(h)
        except Exception:
            pass
    return proc


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def new_profile(prefix: str) -> str:
    """A fresh browser profile folder; ones of the same kind left by a killed run over a day ago go first."""
    tmp, old = tempfile.gettempdir(), time.time() - 86400
    for n in os.listdir(tmp):
        p = os.path.join(tmp, n)
        if n.startswith(prefix) and os.path.isdir(p) and os.path.getmtime(p) < old:
            shutil.rmtree(p, ignore_errors=True)
    return tempfile.mkdtemp(prefix=prefix)


def close_browser(proc, prof: str) -> None:
    """Stop the browser with its helper processes and remove its profile (the helpers hold files a moment longer)."""
    try:
        proc.wait(5)
    except Exception:
        subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)], capture_output=True,
                       creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    job = getattr(proc, "job", None)
    if job:  # Edge relaunches itself at start, so the launcher's exit says nothing: the job holds the real browser
        try:
            k = _kernel32()
            k.TerminateJobObject(job, 1)
            k.CloseHandle(job)
        except Exception:
            pass
        proc.job = None
    for _ in range(20):
        shutil.rmtree(prof, ignore_errors=True)
        if not os.path.exists(prof):
            return
        time.sleep(0.5)


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
    """{"routes", "misses": {page: [requests]}, "error"}; settle = longest wait for a page to go quiet."""
    from .site import serve_dir
    out = {"routes": [], "misses": {}, "error": None}
    exe = find_browser()
    if not exe:
        out["error"] = "no Edge or Chrome to open the site with"
        return out
    httpd = serve_dir(root)
    base = f"http://127.0.0.1:{httpd.server_address[1]}"
    port, prof = _free_port(), new_profile("limbus-sitecheck-")
    proc = start_browser([exe, "--headless=new", f"--remote-debugging-port={port}", f"--user-data-dir={prof}", "--window-size=1400,1000",
                             "--remote-allow-origins=*", "--mute-audio", "--no-first-run", "--disable-extensions", "--disable-sync", "--disable-background-timer-throttling",
                             "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "about:blank"])
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
        tab = _Tab((next((t for t in tabs if t["type"] == "page" and t["url"] == "about:blank"), None)  # (not a page a profile opened)
                    or next(t for t in tabs if t["type"] == "page"))["webSocketDebuggerUrl"])
        tab.call("Page.enable")

        def visit(route: str, n: int, tab=tab) -> dict:
            # new "check" value: a fresh load with the service worker in charge
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
        close_browser(proc, prof)
        httpd.shutdown()
    return out
