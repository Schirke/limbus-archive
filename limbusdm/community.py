"""Community: live streams, listed by a GitHub Action and read from the community-data branch."""
from __future__ import annotations

import base64
import json
import re
import subprocess
import time

from . import REPO, ghraw

URL = f"https://raw.githubusercontent.com/{REPO}/community-data/streams.json"
# raw by branch is cached ~5 min; by commit it is fresh
AT = f"https://raw.githubusercontent.com/{REPO}/%s/streams.json"
KEEP = 50  # seconds a read list is served again
_cache = [0.0, None]


def _read(url: str) -> dict:
    return json.loads(ghraw.get(url, 10))


def streams() -> dict:
    """The stream lists; {} while none is published or offline."""
    if time.time() - _cache[0] < KEEP and _cache[1] is not None:
        return _cache[1]
    try:
        try:
            doc = _read(AT % ghraw.head("community-data"))
        except Exception:
            doc = _read(URL)
        doc = {k: doc.get(k) for k in ("updated", "en", "ru", "ko", "recommended")}
    except Exception:
        doc = _cache[1] or {}
    _cache[:] = [time.time(), doc]
    return doc


# Recommended channels: recommended.json on `community-config`, saved through gh (owner only).
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
