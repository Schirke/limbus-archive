"""Self-update from GitHub releases: check the latest release, download LimbusArchive.zip, swap the files
after the app has quit (a small PowerShell script waits for the process, copies, restarts), keep data/."""
from __future__ import annotations

import os
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request
import zipfile

from . import APP_EXE, OLD_EXE, REPO, TEST_BUILD, TEST_N, __version__

UA = {"User-Agent": f"LimbusArchive/{__version__}"}
ZIP = "LimbusArchive.zip"


def _ver(s: str) -> tuple:
    return tuple(int(x) for x in re.findall(r"\d+", s or "")[:3]) or (0,)


def _key(tag: str) -> tuple:
    """Order of releases: version, then a test build of that version over the stable one, then its number
    (v0.10.32 < v0.10.32-versus-test < v0.10.32-versus-test2)."""
    m = re.match(r"v?(\d+\.\d+\.\d+)(?:-(.*?)(\d*))?$", tag)
    if not m:
        return (_ver(tag), 0, 0)
    return (_ver(m.group(1)), 1 if m.group(2) else 0, int(m.group(3) or 1))


def _latest_tag() -> tuple[str, str]:
    """(tag, page) of the newest release this build follows. Stable builds: github.com/<repo>/releases/latest, which
    redirects to /releases/tag/<tag> and never names a pre-release. A test build (TEST_BUILD) also reads the releases
    feed for pre-releases tagged v<ver>-<TEST_BUILD>[n] and takes the newest of those and the stable one.
    Neither has api.github.com's 60-requests-per-hour limit."""
    req = urllib.request.Request(f"https://github.com/{REPO}/releases/latest", headers={"User-Agent": UA["User-Agent"]})
    with urllib.request.urlopen(req, timeout=15) as r:
        page = r.geturl()
    m = re.search(r"/releases/tag/([^/?#]+)", page)
    if not m:
        raise RuntimeError("no release published yet")
    tag = urllib.parse.unquote(m.group(1))
    if TEST_BUILD:
        try:
            req = urllib.request.Request(f"https://github.com/{REPO}/releases.atom", headers={"User-Agent": UA["User-Agent"]})
            with urllib.request.urlopen(req, timeout=15) as r:
                feed = r.read().decode("utf-8", "replace")
            for t in re.findall(r"/releases/tag/([^\"'<>?#]+)", feed):
                t = urllib.parse.unquote(t)
                if re.fullmatch(rf"v?\d+\.\d+\.\d+-{re.escape(TEST_BUILD)}\d*", t) and _key(t) > _key(tag):
                    tag, page = t, f"https://github.com/{REPO}/releases/tag/{t}"
        except Exception:
            pass  # the feed is a bonus: fall back to the stable release
    return tag, page


def _own_tag() -> str:
    return f"v{__version__}-{TEST_BUILD}{TEST_N}" if TEST_BUILD else f"v{__version__}"


def check() -> dict:
    tag, page = _latest_tag()
    return {"current": __version__ + (f" ({TEST_BUILD})" if TEST_BUILD else ""), "latest": tag.lstrip("v"),
            "newer": _key(tag) > _key(_own_tag()),
            "url": f"https://github.com/{REPO}/releases/download/{tag}/{ZIP}", "page": page,
            "can_install": bool(getattr(sys, "frozen", False))}


def install(data_dir: str, progress=None, info: dict | None = None) -> str:
    """Download + unpack the release, start the swap script and return; the caller must quit the app."""
    if not getattr(sys, "frozen", False):
        raise RuntimeError("Running from source — update with git pull instead")
    info = info if info and info.get("url") else check()
    if not info["newer"] or not info["url"]:
        raise RuntimeError("Already up to date")
    work = os.path.join(data_dir, "update")
    os.makedirs(work, exist_ok=True)
    zpath = os.path.join(work, ZIP)
    req = urllib.request.Request(info["url"], headers={"User-Agent": UA["User-Agent"]})
    with urllib.request.urlopen(req, timeout=60) as r, open(zpath, "wb") as f:
        total = int(r.headers.get("Content-Length") or info.get("size") or 0)
        done = 0
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
            done += len(chunk)
            if progress:
                progress("downloading", done, total, f"{done // (1 << 20)} / {total // (1 << 20)} MB")
    new_dir = os.path.join(work, "new")
    if os.path.isdir(new_dir):
        import shutil
        shutil.rmtree(new_dir, ignore_errors=True)
    with zipfile.ZipFile(zpath) as z:
        z.extractall(new_dir)
    src = exe = None
    for dp, _dn, fns in os.walk(new_dir):
        exe = next((n for n in (APP_EXE, OLD_EXE) if n in fns), None)
        if exe:
            src = dp
            break
    if not src:
        raise RuntimeError(f"{APP_EXE} not found in the downloaded release")
    app = os.path.dirname(sys.executable)
    # after the rename (LimbusDatamine → LimbusArchive) the old exe would be left behind: delete it
    cleanup = f'Remove-Item -LiteralPath "{os.path.join(app, OLD_EXE)}" -Force -ErrorAction SilentlyContinue\n' \
        if exe != OLD_EXE else ""
    script = os.path.join(work, "apply.ps1")
    log = os.path.join(work, "update.log")
    with open(script, "w", encoding="utf-8-sig") as f:
        f.write(f"""$ErrorActionPreference = 'Continue'
Start-Transcript -Path "{log}" -Force | Out-Null
Wait-Process -Id {os.getpid()} -Timeout 60 -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 800
robocopy "{src}" "{app}" /E /XD data /R:10 /W:1 /NFL /NDL /NJH /NJS
"robocopy exit $LASTEXITCODE"
{cleanup}Start-Process -FilePath "{os.path.join(app, exe)}"
Stop-Transcript | Out-Null
""")
    if progress:
        progress("installing", 1, 1, f"restarting into {info['latest']}")
    cmd = ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", script]
    # the script must outlive the app: own process group, no console, and out of any job object the app runs in
    base = 0x08000000 | 0x00000200  # CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP
    try:
        subprocess.Popen(cmd, creationflags=base | 0x01000000, close_fds=True)  # | CREATE_BREAKAWAY_FROM_JOB
    except OSError:
        subprocess.Popen(cmd, creationflags=base, close_fds=True)
    return info["latest"]


def clean_leftovers(data_dir: str):
    """The downloaded release once the swap is over (the script copies it before it starts the app again);
    update.log stays."""
    import shutil
    work = os.path.join(data_dir, "update")
    shutil.rmtree(os.path.join(work, "new"), ignore_errors=True)
    try:
        os.remove(os.path.join(work, ZIP))
    except OSError:
        pass


def quit_soon(delay: float = 1.5):
    """Exit after the HTTP answer has gone out."""
    import threading

    def _bye():
        time.sleep(delay)
        os._exit(0)

    threading.Thread(target=_bye, daemon=True).start()
