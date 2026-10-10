"""Spine skeletons inside a bundle, linked the way spine-unity links them:
SkeletonDataAsset → skeletonJSON (TextAsset) + atlasAssets → AtlasAsset → atlasFile (TextAsset) + materials → _MainTex.
Names are not unique (many skeletons are called "imported"), so everything goes by path id.
"""
from __future__ import annotations

import hashlib
import os
import re
import threading
import time

from .extract import _env, _lock, on_drop

_cache: dict[str, dict] = {}
_cache_lock = threading.Lock()
on_drop.append(_cache.clear)  # (see extract.drop_all)


def _pid(pptr) -> int | None:
    if isinstance(pptr, dict) and pptr.get("m_FileID", 0) == 0 and pptr.get("m_PathID"):
        return pptr["m_PathID"]
    return None


def _main_tex(mat: dict) -> int | None:
    envs = (mat.get("m_SavedProperties") or {}).get("m_TexEnvs") or []
    items = envs.items() if isinstance(envs, dict) else envs
    for item in items:
        name, val = (item if isinstance(item, (list, tuple)) else (item.get("first"), item.get("second")))
        if name == "_MainTex":
            return _pid((val or {}).get("m_Texture"))
    return None


def atlas_pages(text: str) -> list[str]:
    """Page image names of a Spine 4.x atlas, in order (a page starts after a blank line or at the top)."""
    pages, new_block = [], True
    for line in text.splitlines():
        s = line.strip()
        if not s:
            new_block = True
            continue
        if new_block and re.search(r"\.(png|jpg|webp)$", s, re.I):
            pages.append(s)
        new_block = False
    return pages


def page_sizes(text: str) -> dict[str, tuple[int, int]]:
    """{page image name: (width, height)} from the "size:" line after each page of a Spine 4.x atlas."""
    out, page, new_block = {}, None, True
    for line in text.splitlines():
        s = line.strip()
        if not s:
            new_block = True
            continue
        if new_block and re.search(r"\.(png|jpg|webp)$", s, re.I):
            page = s
        elif page and s.startswith("size:"):
            m = re.match(r"size:\s*(\d+)\s*,\s*(\d+)", s)
            if m:
                out[page] = (int(m.group(1)), int(m.group(2)))
            page = None
        new_block = False
    return out


def fit_page(im, size: tuple[int, int] | None) -> bytes:
    """Unity resizes atlas pages to powers of two on import (678×812 → 512×1024). Spine meshes compute their UVs
    from the real image size, so a stretched page shifts and cuts them: scale it back to the size in the atlas.
    `im`: the page (PIL image) → PNG, written fast (it is kept on disk: cached())."""
    import io
    from PIL import Image
    if size and im.size != tuple(size):
        im = im.resize(tuple(size), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "PNG", compress_level=1)
    return buf.getvalue()


# The files of a skeleton as the page gets them (pages fitted, the illustration's scene), kept on disk: an open
# skeleton otherwise loads its bundle again (bundles leave memory after a minute, extract.IDLE_S) and fits its pages
# again — a second or more each time. Named by the bundle file (path, size, time) and the request: a game update
# makes new ones, and what was not asked for in CACHE_DAYS goes.
CACHE_DIR = "spine_cache"
CACHE_DAYS = 30
_pruned: set[str] = set()


def cached(data_dir: str, bundle_path: str, key: str, make, keep: bool = True) -> bytes:
    """make() → bytes, kept in <data>/spine_cache under `key` of this bundle file (`keep` False: read if there, not
    written — the site's export asks for every skeleton once and keeps its own copies)."""
    d = os.path.join(data_dir, CACHE_DIR)
    try:
        st = os.stat(bundle_path)
        name = hashlib.sha1(f"{bundle_path}|{st.st_size}|{st.st_mtime_ns}|{key}".encode("utf-8", "replace")).hexdigest()[:24]
    except OSError:
        return make()
    f = os.path.join(d, name)
    try:
        with open(f, "rb") as fh:
            data = fh.read()
        if time.time() - os.path.getmtime(f) > 86400:  # (used: stays)
            os.utime(f)
        return data
    except OSError:
        pass
    data = make()
    if not keep:
        return data
    try:
        os.makedirs(d, exist_ok=True)
        tmp = f"{f}.{threading.get_ident()}.tmp"
        with open(tmp, "wb") as fh:
            fh.write(data)
        os.replace(tmp, f)
    except OSError:
        pass
    if d not in _pruned:
        _pruned.add(d)
        threading.Thread(target=_prune, args=(d,), daemon=True).start()
    return data


def _prune(d: str):
    old = time.time() - CACHE_DAYS * 86400
    for e in os.scandir(d):
        try:
            if e.stat().st_mtime < old or e.name.endswith(".tmp") and e.stat().st_mtime < time.time() - 3600:
                os.remove(e.path)
        except OSError:
            pass


def spine_map(bundle_path: str) -> dict[int, dict]:
    """{atlas TextAsset pid: {"skel": pid, "pages": {page name: texture pid}, "name": skeleton asset name}}."""
    with _cache_lock:
        if bundle_path in _cache:
            return _cache[bundle_path]
    env = _env(bundle_path)
    out: dict[int, dict] = {}
    with _lock:
        objs = {o.path_id: o for o in env.objects}
        atlases, skeletons = {}, []
        for o in env.objects:
            if o.type.name != "MonoBehaviour":
                continue
            try:
                name = o.peek_name() or ""
            except Exception:
                continue
            if not (name.endswith("_Atlas") or name.endswith("_SkeletonData")):
                continue
            try:
                d = o.parse_as_dict()
            except Exception:
                continue
            if "atlasFile" in d:
                atlases[o.path_id] = d
            elif "skeletonJSON" in d:
                skeletons.append((name, d))
        for name, sd in skeletons:
            skel = _pid(sd.get("skeletonJSON"))
            for ap in sd.get("atlasAssets") or []:
                a = atlases.get(_pid(ap))
                atlas_txt = _pid(a.get("atlasFile")) if a else None
                if not atlas_txt or atlas_txt not in objs:
                    continue
                try:
                    raw = objs[atlas_txt].read().m_Script
                    text = raw if isinstance(raw, str) else bytes(raw).decode("utf-8", "replace")
                except Exception:
                    continue
                tex = []
                for mp in a.get("materials") or []:
                    m = objs.get(_pid(mp))
                    try:
                        tex.append(_main_tex(m.parse_as_dict()) if m else None)
                    except Exception:
                        tex.append(None)
                pages = atlas_pages(text)
                out.setdefault(atlas_txt, {"skel": skel, "name": name[:-len("_SkeletonData")],
                                           "pages": {p: t for p, t in zip(pages, tex) if t}})
    with _cache_lock:
        _cache[bundle_path] = out
    return out
