"""Single files from the website's copy (the way ui/site/sw.js finds them): for installs whose game files don't give
the UI fonts and pictures."""
from __future__ import annotations

import gzip
import json
import threading
import time
import urllib.request

DATA = "https://limbus-archive.com/d/"
TYPES = {"png": "image/png", "webp": "image/webp", "jpg": "image/jpeg", "otf": "font/otf", "ttf": "font/ttf"}
KEEP = 600  # seconds the index is used, and a failed site is left alone
_lock = threading.Lock()
_state = {"idx": None, "at": 0.0, "down": 0.0}
_shards: dict[str, dict] = {}
_packs: dict[str, bytes] = {}


def _get(path: str) -> bytes:
    req = urllib.request.Request(DATA + path, headers={"User-Agent": "LimbusArchive"})
    with urllib.request.urlopen(req, timeout=20) as r:
        data = r.read()
        return gzip.decompress(data) if r.headers.get("Content-Encoding") == "gzip" else data


def _file(key: str):
    from .site import _fnv, key_group
    if time.time() - _state["at"] > KEEP:
        _state["idx"] = json.loads(_get("index.json"))
        _state["at"] = time.time()
        _shards.clear()
    keys = _state["idx"].get("keys")
    if not keys:
        return None
    g = key_group(key)
    n = keys["split"].get(g)
    if n:
        g += f"#{_fnv(key) % n}"
    name = keys["f"][_fnv(g) % len(keys["f"])]
    if name not in _shards:
        _shards[name] = json.loads(gzip.decompress(_get("k/" + name)))
    return _shards[name].get(key)


def get(key: str) -> tuple[bytes, str] | None:
    """A request key (site.url_key form) → (bytes, extension), or None when the site has none or can't be reached."""
    with _lock:
        if time.time() - _state["down"] < KEEP:
            return None
        try:
            f = _file(key)
            if isinstance(f, list):  # [pack, offset, length, ext]: the server sends packs whole
                pack, off, size, ext = f
                if pack not in _packs:
                    if len(_packs) > 8:
                        _packs.pop(next(iter(_packs)))
                    _packs[pack] = _get("p/" + pack)
                data = _packs[pack][off:off + size]
            elif isinstance(f, str):
                data, ext = _get(f), f.rsplit(".", 1)[-1]
            else:
                return None
        except Exception:
            _state["down"] = time.time()
            return None
        if ext.endswith(".gz"):
            data, ext = gzip.decompress(data), ext[:-3]
        return (data, ext) if ext in TYPES else None
