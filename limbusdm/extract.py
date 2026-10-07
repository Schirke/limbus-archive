"""Extract a single object from a bundle in the game's cache for preview/export. Read-only."""
from __future__ import annotations

import gc
import io
import json
import os
import threading
import time
from collections import OrderedDict

import UnityPy

from . import bundles as _bundles  # noqa: F401  (sets the Unity fallback version)

_lock = threading.RLock()  # re-entrant: clip rendering opens dependency bundles while holding it
# Open bundles, most recent last. A loaded bundle takes ~6x its file size in memory (decompressed and parsed):
# 470 MB of files kept the app at 3.2 GB. So few are kept, within a size budget, and none once the app is idle.
_envs: "OrderedDict[str, object]" = OrderedDict()
_sizes: dict[str, int] = {}
MAX_ENVS = 4
MAX_BYTES = 256 * 2**20  # their files; the newest one is kept whatever its size
IDLE_S = 60
_last_use = 0.0
# caches elsewhere that hold objects of a loaded bundle (and so keep it in memory): cleared when the bundles go
on_drop: list = []
_watch = None


def _env(path: str):
    global _last_use, _watch
    with _lock:
        _last_use = time.time()
        if _watch is None:
            _watch = threading.Thread(target=_idle_watch, daemon=True)
            _watch.start()
        if path in _envs:
            _envs.move_to_end(path)
            return _envs[path]
        with open(path, "rb") as f:
            env = UnityPy.load(f.read())
        _envs[path] = env
        _sizes[path] = os.path.getsize(path)
        while len(_envs) > 1 and (len(_envs) > MAX_ENVS or sum(_sizes[p] for p in _envs) > MAX_BYTES):
            _sizes.pop(_envs.popitem(last=False)[0], None)
        return env


def drop_all():
    """Let go of every loaded bundle and what other caches hold of them (the memory goes back to the system)."""
    with _lock:
        _envs.clear()
        _sizes.clear()
        for clear in on_drop:
            try:
                clear()
            except Exception:
                pass
    gc.collect()


def _idle_watch():
    while True:
        time.sleep(15)
        if _envs and time.time() - _last_use > IDLE_S:
            with _lock:  # (not while a bundle is being read; checked again once it is free)
                if time.time() - _last_use > IDLE_S:
                    drop_all()


def _jsonable(v, depth=0):
    if depth > 12:
        return "…"
    if isinstance(v, (bytes, bytearray, memoryview)):
        return f"<{len(v)} bytes>"
    if isinstance(v, dict):
        return {str(k): _jsonable(x, depth + 1) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        if len(v) > 2000:
            return [_jsonable(x, depth + 1) for x in v[:2000]] + [f"… {len(v) - 2000} more"]
        return [_jsonable(x, depth + 1) for x in v]
    return v


def extract(path: str, pid: int, fmt: str | None = None) -> tuple[bytes, str, str]:
    """Return (data, mime, filename) for object `pid` in the bundle file at `path`."""
    env = _env(path)
    obj = next((o for o in env.objects if o.path_id == pid), None)
    if obj is None:
        raise KeyError("object not found")
    t = obj.type.name
    with _lock:
        if fmt == "props":
            return _props(obj)
        data = obj.read()
        name = getattr(data, "m_Name", None) or str(pid)
        if t in ("Texture2D", "Sprite"):
            buf = io.BytesIO()
            data.image.save(buf, "PNG")
            return buf.getvalue(), "image/png", name + ".png"
        if t == "TextAsset":
            raw = data.m_Script
            raw = raw.encode("utf-8", "surrogateescape") if isinstance(raw, str) else bytes(raw)
            ext = ".json" if raw.lstrip()[:1] in (b"{", b"[") else ".txt"
            return raw, "application/json" if ext == ".json" else "text/plain; charset=utf-8", name + ext
        if t == "AudioClip":
            samples = data.samples
            fn, wav = next(iter(samples.items()))
            mime = "audio/wav" if fn.endswith(".wav") else "audio/ogg" if fn.endswith(".ogg") else "application/octet-stream"
            return wav, mime, fn
        if t == "VideoClip":
            from UnityPy.helpers.ResourceReader import get_resource_data
            r = data.m_ExternalResources
            raw = get_resource_data(r.m_Source, obj.assets_file, r.m_Offset, r.m_Size)
            return bytes(raw), "video/mp4", name + ".mp4"
        if t == "Font" and getattr(data, "m_FontData", None):
            return bytes(data.m_FontData), "font/ttf", name + ".ttf"
        if t == "Mesh":
            return data.export().encode(), "text/plain; charset=utf-8", name + ".obj"
    return _props(obj)


def _props(obj) -> tuple[bytes, str, str]:
    try:
        d = obj.parse_as_dict()
    except Exception as e:
        d = {"error": f"{type(e).__name__}: {e}", "type": obj.type.name}
    name = d.get("m_Name") if isinstance(d, dict) else None
    body = json.dumps(_jsonable(d), ensure_ascii=False, indent=1).encode("utf-8")
    return body, "application/json", f"{name or obj.path_id}.json"
