"""Limbus Archive desktop app: a window (pywebview) over a local server.

On start it checks whether the game has downloaded a new version and, if so, builds the report.
"""
from __future__ import annotations

import json
import os
import re
import sys
import threading
import urllib.request

PORT = int(os.environ.get("LIMBUS_DM_PORT", "47821"))  # override only for running a second dev copy
SCHEME = "limbusarchive"  # limbusarchive://open/<page>: a link that opens the app on that page (an invite's button on the site)


def _link(argv: list[str]) -> str:
    """The page the app was started for by a link (limbusarchive://open/gamechar/duel/abc123) as the window's
    address "#/gamechar/duel/abc123"; "" without one. Only a page's address gets through: the link comes from a
    web page."""
    for a in argv[1:]:
        m = re.fullmatch(rf"{SCHEME}:/*(?:open/+)?#?/*([\w.%~-]+(?:/[\w.%~-]+)*)/?", a.strip(), re.I)
        if m and len(m.group(1)) <= 200:
            return "#/" + m.group(1)
    return ""


def _register():
    """Tells Windows that limbusarchive: links are this app's (the user's own part of the registry, every start: the
    app may have been moved). Only the built exe on its usual port."""
    if not getattr(sys, "frozen", False) or PORT != 47821 or sys.platform != "win32":
        return
    try:
        import winreg
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, rf"Software\Classes\{SCHEME}") as k:
            winreg.SetValueEx(k, "", 0, winreg.REG_SZ, "URL:Limbus Archive")
            winreg.SetValueEx(k, "URL Protocol", 0, winreg.REG_SZ, "")
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, rf"Software\Classes\{SCHEME}\shell\open\command") as k:
            winreg.SetValueEx(k, "", 0, winreg.REG_SZ, f'"{sys.executable}" "%1"')
    except Exception:
        pass


def _already_running(link: str = "") -> bool:
    import socket
    try:  # (nothing listens there on a usual start: Windows takes 2 s to say so to an HTTP request, a bare connect is told to give up sooner)
        socket.create_connection(("127.0.0.1", PORT), timeout=0.3).close()
    except OSError:
        return False
    try:
        req = urllib.request.Request(f"http://127.0.0.1:{PORT}/api/show", data=json.dumps({"open": link}).encode(), method="POST",
                                     headers={"X-Limbus-Datamine": "1", "Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=2).read()
        return True
    except Exception:
        return False


NET_CONFIG = """<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <runtime>
    <loadFromRemoteSources enabled="true"/>
  </runtime>
</configuration>
"""


def _unblock(root: str = ""):
    """Lets .NET load the app's own DLLs although Windows marked them "downloaded from the internet" (it marks
    everything unpacked from a zip the browser saved, and .NET refuses a marked DLL: the window never opened, "Failed
    to resolve Python.Runtime.Loader.Initialize"). Two ways, either is enough: the mark is taken off every program
    file (every start — the exe's own mark says nothing: Windows drops it when the user agrees to run the file), and
    <exe>.config tells .NET to load them anyway."""
    if not root:
        if not getattr(sys, "frozen", False) or sys.platform != "win32":
            return
        root = os.path.dirname(sys.executable)
    cfg = os.path.join(root, os.path.basename(sys.executable)) + ".config"
    try:
        if not os.path.exists(cfg):
            with open(cfg, "w", encoding="utf-8") as f:
                f.write(NET_CONFIG)
    except OSError:
        pass
    for d, dirs, files in os.walk(root):
        if d == root:
            dirs[:] = [x for x in dirs if x.lower() != "data"]  # (the app's data may sit next to the exe: nothing to load there)
        for f in files:
            if f.lower().endswith((".dll", ".exe", ".pyd")):
                try:
                    os.remove(os.path.join(d, f) + ":Zone.Identifier")
                except OSError:
                    pass


def main():
    link = _link(sys.argv)
    if _already_running(link):  # (the window that is open goes to the link's page)
        return
    _register()
    _unblock()

    import webview

    from .paths import data_dir
    from .server import serve
    from .service import Service

    for s in (sys.stdout, sys.stderr):  # a "≤" or "♪" the console's code page lacks made print_exc() itself raise, so the
        if hasattr(s, "reconfigure"):    # server dropped the request ("Failed to fetch") instead of answering with the error
            s.reconfigure(errors="backslashreplace")
    svc = Service(data_dir())
    state = {"window": None}

    def show(page: str = ""):
        w = state["window"]
        if w:
            w.restore()
            w.show()
            if page and re.fullmatch(r"#/[\w.%~/-]{1,200}", page):
                w.evaluate_js(f"location.hash = {json.dumps(page)}")

    serve(svc, PORT, on_show=show)

    def startup_check():
        try:
            svc.fx.prune()
            from . import updater
            updater.clean_leftovers(svc.data_dir)
        except Exception:
            pass
        svc.update_check()
        if svc.settings.get("auto_on_start", True):
            try:
                svc.check_version(start=True)
            except Exception as e:
                svc.watch["state"] = f"error: {e}"

    def watcher():
        """While the window is open: the game's catalog every 2 min (a local file, no network) and the app's own
        releases hourly (update_check caches for an hour)."""
        import time
        n = 0
        while True:
            time.sleep(120)
            n += 1
            try:
                if svc.settings.get("auto_on_start", True) and not (svc.job and svc.job.get("running")):
                    svc.check_version(start=True)
                svc.update_check()
                if n % 5 == 0:  # every 10 min: drop renders unwatched for an hour
                    svc.fx.prune()
            except Exception as e:
                svc.watch["state"] = f"error: {e}"

    threading.Thread(target=startup_check, daemon=True).start()
    threading.Thread(target=watcher, daemon=True).start()
    # index of cross-bundle references (needed by some battle animations) and enemy → chapter map; slow only
    # the first time
    threading.Thread(target=lambda: svc.latest_snapshot_id() and svc.cab_index() and svc._content_bg(),
                     daemon=True).start()

    from . import APP_TITLE
    state["window"] = webview.create_window(APP_TITLE, f"http://127.0.0.1:{PORT}/{link}", width=1400, height=900,
                                            min_size=(900, 600), background_color="#121012")
    profile = "webview" if PORT == 47821 else f"webview_{PORT}"  # a running copy locks its WebView2 profile
    webview.start(private_mode=False, storage_path=os.path.join(data_dir(), profile))
    os._exit(0)


if __name__ == "__main__":
    main()
