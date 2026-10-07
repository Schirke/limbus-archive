"""The Community page: who streams the game right now. The list is made on GitHub (scripts/community.py, run by an
Action with the API keys in the repository's secrets) and read from there — the app holds no keys."""
from __future__ import annotations

import base64
import json
import re
import subprocess
import time
import urllib.request

from . import REPO

URL = f"https://raw.githubusercontent.com/{REPO}/community-data/streams.json"
# (that address answers from a 5 minutes' cache; the same file by its commit is there at once, and the commit the
# branch is at is asked from the repository itself, as git does — no API, so no hourly limit)
REFS = f"https://github.com/{REPO}.git/info/refs?service=git-upload-pack"
AT = f"https://raw.githubusercontent.com/{REPO}/%s/streams.json"
KEEP = 50  # seconds a read list is served again
_cache = [0.0, None]


def _read(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "LimbusArchive"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.load(r)


def _commit() -> str:
    req = urllib.request.Request(REFS, headers={"User-Agent": "git/2.45"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return re.search(rb"([0-9a-f]{40}) refs/heads/community-data\n", r.read()).group(1).decode()


def streams() -> dict:
    """{"updated", "en": [...], "ru": [...], "ko": [...], "recommended": [...]}; {} while the list isn't published or the network is down."""
    if time.time() - _cache[0] < KEEP and _cache[1] is not None:
        return _cache[1]
    try:
        try:
            doc = _read(AT % _commit())
        except Exception:
            doc = _read(URL)
        doc = {k: doc.get(k) for k in ("updated", "en", "ru", "ko", "recommended")}
    except Exception:
        doc = _cache[1] or {}
    _cache[:] = [time.time(), doc]
    return doc


# The recommended channels (the pictures in the page's corner): links, one a line, in recommended.json on the
# `community-config` branch. Only the repository's owner can write there — through the GitHub CLI he is logged in
# with — so the editor (Settings) is for him alone. The script on GitHub reads the list every minute.
REC = f"repos/{REPO}/contents/recommended.json"
BRANCH = "community-config"


def _gh(*args, body=None):
    try:
        r = subprocess.run(["gh", "api", *args, *(["--input", "-"] if body is not None else [])], capture_output=True, timeout=40,
                           input=json.dumps(body).encode() if body is not None else None,
                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except FileNotFoundError:
        raise RuntimeError("the GitHub CLI (gh) is not installed")
    out = json.loads(r.stdout or b"{}") if r.stdout.strip().startswith((b"{", b"[")) else {}
    if r.returncode:
        raise RuntimeError(out.get("message") or r.stderr.decode("utf-8", "replace").strip()[:200] or "gh failed")
    return out


def recommended() -> dict:
    """{"lines": [...]} as on GitHub now, or {"lines": [], "error"}."""
    try:
        doc = _gh(f"{REC}?ref={BRANCH}")
        return {"lines": json.loads(base64.b64decode(doc["content"]).decode("utf-8")), "sha": doc["sha"]}
    except RuntimeError as e:
        return {"lines": []} if "Not Found" in str(e) or "No commit found" in str(e) else {"lines": [], "error": str(e)}


def save_recommended(lines: list) -> dict:
    lines = [x for line in lines for x in re.split(r"[\s,;]+", str(line)) if x][:40]  # (links typed in one line too)
    try:
        try:
            _gh(f"repos/{REPO}/git/ref/heads/{BRANCH}")
        except RuntimeError:  # the first time: the branch starts from main
            _gh(f"repos/{REPO}/git/refs", body={"ref": "refs/heads/" + BRANCH, "sha": _gh(f"repos/{REPO}/git/ref/heads/main")["object"]["sha"]})
        body = {"message": "recommended channels", "branch": BRANCH,
                "content": base64.b64encode(json.dumps(lines, ensure_ascii=False, indent=1).encode("utf-8")).decode()}
        sha = recommended().get("sha")
        if sha:
            body["sha"] = sha
        _gh("-X", "PUT", REC, body=body)
    except RuntimeError as e:
        return {"lines": lines, "error": str(e)}
    return {"lines": lines}
