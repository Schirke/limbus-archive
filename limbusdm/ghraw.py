"""Files on our GitHub branches, or the site's copy of them when GitHub is out of reach (some countries)."""
from __future__ import annotations

import json
import re
import time
import urllib.request

from . import REPO

RAW = "https://raw.githubusercontent.com/"
SITE = "https://limbus-archive.com/gh/"
AWAY = 600  # seconds the site's copy goes first after GitHub failed
_away = [0.0]


def _get(url: str, timeout: int, ua: str = "LimbusArchive") -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": ua})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def _both(github, site):
    if time.time() - _away[0] < AWAY:
        try:
            return site()
        except Exception:
            return github()
    try:
        return github()
    except Exception:
        _away[0] = time.time()
        return site()


def get(url: str, timeout: int = 15) -> bytes:
    """A raw.githubusercontent file."""
    return _both(lambda: _get(url, timeout), lambda: _get(SITE + url.removeprefix(RAW), timeout))


def head(branch: str) -> str:
    """A branch's commit ("" when there is no such branch): info/refs (no API limit) or the site's answer."""
    def github():
        refs = _get(f"https://github.com/{REPO}.git/info/refs?service=git-upload-pack", 10, "git/2.45")
        m = re.search(rb"([0-9a-f]{40}) refs/heads/" + re.escape(branch.encode()) + rb"\n", refs)
        return m.group(1).decode() if m else ""
    return _both(github, lambda: json.loads(_get(f"{SITE}sha/{branch}", 10))["sha"])
