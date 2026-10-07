"""The Community page: who streams the game right now. The list is made on GitHub (scripts/community.py, run by an
Action with the API keys in the repository's secrets) and read from there — the app holds no keys."""
from __future__ import annotations

import json
import time
import urllib.request

from . import REPO

URL = f"https://raw.githubusercontent.com/{REPO}/community-data/streams.json"
KEEP = 180  # seconds a read list is served again
_cache = [0.0, None]


def streams() -> dict:
    """{"updated", "en": [...], "ru": [...], "ko": [...]}; {} while the list isn't published or the network is down."""
    if time.time() - _cache[0] < KEEP and _cache[1] is not None:
        return _cache[1]
    try:
        req = urllib.request.Request(URL, headers={"User-Agent": "LimbusArchive"})
        with urllib.request.urlopen(req, timeout=10) as r:
            doc = json.load(r)
        doc = {k: doc.get(k) for k in ("updated", "en", "ru", "ko")}
    except Exception:
        doc = _cache[1] or {}
    _cache[:] = [time.time(), doc]
    return doc
