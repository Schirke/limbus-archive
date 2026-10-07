"""Spine skeletons inside a bundle, linked the way spine-unity links them:
SkeletonDataAsset → skeletonJSON (TextAsset) + atlasAssets → AtlasAsset → atlasFile (TextAsset) + materials → _MainTex.
Names are not unique (many skeletons are called "imported"), so everything goes by path id.
"""
from __future__ import annotations

import re
import threading

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


def fit_page(png: bytes, size: tuple[int, int] | None) -> bytes:
    """Unity resizes atlas pages to powers of two on import (678×812 → 512×1024). Spine meshes compute their UVs
    from the real image size, so a stretched page shifts and cuts them: scale it back to the size in the atlas."""
    import io
    from PIL import Image
    im = Image.open(io.BytesIO(png))
    if not size or im.size == tuple(size):
        return png
    buf = io.BytesIO()
    im.resize(tuple(size), Image.LANCZOS).save(buf, "PNG")
    return buf.getvalue()


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
