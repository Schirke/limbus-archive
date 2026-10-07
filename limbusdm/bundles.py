"""Index the objects inside one asset bundle: type, name, container path, content hash.

Text assets are stored as blobs, textures get a thumbnail, so later versions can be compared
even after the game has deleted the old bundle from its cache.
"""
from __future__ import annotations

import hashlib
import warnings

import UnityPy

from .store import Store

UnityPy.config.FALLBACK_UNITY_VERSION = "6000.3.12f1"  # Limbus strips the version to "5.x.x"
warnings.filterwarnings("ignore", module="UnityPy")

TEXT_TYPES = {"TextAsset"}
IMAGE_TYPES = {"Texture2D"}


def _h(data) -> str:
    return hashlib.sha1(data).hexdigest()


def index_bundle(path: str, store: Store, thumbs: bool = True) -> dict:
    """Return {"objects": [...], "errors": [...]} for the bundle at `path`. Read-only on `path`."""
    with open(path, "rb") as f:
        env = UnityPy.load(f.read())
    containers: dict[int, str] = {}
    # path → object straight from the AssetBundle's m_Container. (env.container would also walk the preload
    # table and look up every reference into other bundles across the whole cache folder: 315 of 333 s on a
    # big bundle, for nothing we use.)
    for obj in env.objects:
        if obj.type.name == "AssetBundle":
            try:
                for cpath, info in obj.read().m_Container:
                    containers.setdefault(info.asset.path_id, cpath)
            except Exception:
                pass

    objects, errors = [], []
    textures: dict[int, str] = {}
    sprites = []
    for obj in env.objects:
        t = obj.type.name
        rec = {"pid": obj.path_id, "type": t}
        try:
            name = obj.peek_name()
        except Exception:
            name = None
        if not name and t == "Shader":  # a shader's name lives in its parsed form, not in m_Name
            try:
                name = obj.read().m_ParsedForm.m_Name
            except Exception:
                name = None
        if name:
            rec["name"] = name
        if obj.path_id in containers:
            rec["c"] = containers[obj.path_id]
        try:
            if t in TEXT_TYPES:
                data = obj.read()
                raw = data.m_Script
                raw = raw.encode("utf-8", "surrogateescape") if isinstance(raw, str) else bytes(raw)
                rec["h"] = store.put_blob(raw)
                rec["size"] = len(raw)
            elif t in IMAGE_TYPES:
                tex = obj.read()
                try:
                    img_bytes = tex.get_image_data() or b""
                except OSError:  # runtime textures (e.g. dynamic "Font Texture") have no pixel data
                    img_bytes = b""
                rec["h"] = _h(img_bytes + f"{tex.m_Width}x{tex.m_Height}:{tex.m_TextureFormat}".encode())
                rec["w"], rec["hgt"] = tex.m_Width, tex.m_Height
                textures[obj.path_id] = rec["h"]
                if thumbs and img_bytes and not store.has_thumb(rec["h"]):
                    try:
                        store.put_thumb(rec["h"], tex.image)
                    except Exception as e:  # unsupported texture format etc.
                        errors.append(f"thumb {name}: {type(e).__name__}: {e}")
            elif t == "Sprite":
                sp = obj.read()
                rec["h"] = _h(obj.get_raw_data())
                r = sp.m_Rect
                rec["rect"] = [round(r.x), round(r.y), round(r.width), round(r.height)]
                try:
                    rec["tex_pid"] = sp.m_RD.texture.path_id
                except Exception:
                    pass
                sprites.append(rec)
            else:
                raw = obj.get_raw_data()
                rec["h"] = _h(raw)
                rec["size"] = len(raw)
        except Exception as e:
            errors.append(f"{t} {name or obj.path_id}: {type(e).__name__}: {e}")
            try:
                rec["h"] = _h(obj.get_raw_data())
            except Exception:
                rec["h"] = "unreadable"
        objects.append(rec)

    for rec in sprites:  # link sprites to their texture's content hash (for before/after crops)
        th = textures.get(rec.get("tex_pid"))
        if th:
            rec["tex"] = th
    try:  # CAB names let other bundles' references be resolved to this one
        from .cabs import cab_names
        cabs = cab_names(path)
    except Exception:
        cabs = []
    return {"objects": objects, "errors": errors, "cabs": cabs}
