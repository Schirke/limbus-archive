"""Full illustrations around a Spine skeleton (Uptie 3 / awakening art): the uGUI prefab that holds the
SkeletonGraphic also holds the background and effect layers as sibling Images (BG, Mist, Lightning, Front, …),
drawn in sibling order. Effect layers use Fx_Team/FX_Grp_SpineIllustShader_*: the sprite distorted by a scrolling
noise texture and faded by a scrolling dissolve texture; the UI replays that from the material's values.

Coordinates: uGUI, y up; the layers' parent is a plain Transform (a zero-size rect), so a layer's anchored position
is its pivot's position. SkeletonGraphic draws skeleton units as canvas pixels (scale 0.01 × 100 px per unit) with
the skeleton origin at its own pivot."""
from __future__ import annotations

from .extract import _env, _lock, on_drop

FX_FLOATS = ("_Noise_Intensity", "_Noise_Rotate", "_Noise_Speed_U", "_Noise_Speed_V", "_Dissolve", "_Dissolve_Hardness",
             "_Dissolve_Rotate", "_Dissolve_Speed_U", "_Dissolve_Speed_V", "_White_Intensity", "_SrcBlend", "_DstBlend")

_cache: dict[str, dict] = {}
on_drop.append(_cache.clear)  # it holds objects of the bundle (see extract.drop_all)


def _pp(p) -> int | None:
    return p.get("m_PathID") if p and p.get("m_FileID", 0) == 0 and p.get("m_PathID") else None


def _material(objs, pid) -> dict | None:
    o = objs.get(pid) if pid else None
    if o is None:
        return None
    d = o.parse_as_dict()
    sh = objs.get(_pp(d.get("m_Shader")))
    shader = ""
    try:
        shader = sh.read().m_ParsedForm.m_Name if sh is not None else ""
    except Exception:
        pass
    props = d.get("m_SavedProperties") or {}
    floats = dict(props.get("m_Floats") or [])
    colors = {k: v for k, v in props.get("m_Colors") or []}
    tex = {k: _pp(v.get("m_Texture")) for k, v in props.get("m_TexEnvs") or []}
    m = {"name": d.get("m_Name", ""), "shader": shader,
         "blend": "add" if floats.get("_DstBlend") == 1 else "alpha"}
    if "SpineIllust" in shader:
        m["fx"] = {k[1:]: floats[k] for k in FX_FLOATS if k in floats}
        for k, key in (("noise", "_Noise_Tex"), ("dissolve", "_Dissolve_Tex")):
            if tex.get(key) in objs:
                m["fx"][k] = str(tex[key])
        for k, key in (("noise_tile", "_Noise_Tile_Offset"), ("dissolve_tile", "_Dissolve_Tile_Offset")):
            c = colors.get(key)
            if c:
                m["fx"][k] = [c["r"], c["g"]]
    return m


def art_scenes(bundle_path: str) -> dict[int, dict]:
    """{atlas TextAsset pid: scene} for every SkeletonGraphic that has sibling Image layers.
    scene = {"w", "h", "layers": [{"kind": "image", "name", "sprite", "x", "y", "w", "h", "color", "material"}
    | {"kind": "spine", "atlas", "ox", "oy", "scale", "skin", "anim", "flip"}]} — boxes in frame pixels, y down,
    frame = union of the images. Every skeleton of the prefab is a layer (some illustrations are cut into several)."""
    if bundle_path in _cache:
        return _cache[bundle_path]
    env = _env(bundle_path)
    out: dict[int, dict] = {}
    with _lock:
        objs = {o.path_id: o for o in env.objects}
        rts, go_rt = {}, {}
        for o in env.objects:
            if o.type.name in ("RectTransform", "Transform"):
                try:
                    d = o.parse_as_dict()
                except Exception:
                    continue
                rts[o.path_id] = d
                go_rt[d["m_GameObject"]["m_PathID"]] = o.path_id
        graphics = {}  # GameObject pid -> MonoBehaviour dict (Image / SkeletonGraphic)
        for o in env.objects:
            if o.type.name != "MonoBehaviour":
                continue
            try:
                d = o.parse_as_dict()
            except Exception:
                continue
            if "skeletonDataAsset" in d or "m_Sprite" in d:
                graphics.setdefault(d["m_GameObject"]["m_PathID"], d)

        def atlas_of(sg):
            sda = objs.get(_pp(sg.get("skeletonDataAsset")))
            if sda is None:
                return None
            for a in sda.parse_as_dict().get("atlasAssets") or []:
                ao = objs.get(_pp(a))
                if ao is not None:
                    return _pp(ao.parse_as_dict().get("atlasFile"))
            return None

        def box(rt):
            pos, size, piv = rt["m_AnchoredPosition"], rt["m_SizeDelta"], rt["m_Pivot"]
            sc = rt.get("m_LocalScale") or {"x": 1, "y": 1}
            w, h = size["x"] * sc["x"], size["y"] * sc["y"]
            left, top = pos["x"] - piv["x"] * w, pos["y"] + (1 - piv["y"]) * h
            return left, top, w, h, sc

        def wrapper(rt):
            """A plain Transform (no graphic) that only groups skeletons, e.g. Blade of the House of Spiders'
            "…_Spineani" between the background layers: its skeletons count as layers of its parent."""
            return ("m_AnchoredPosition" not in rt and graphics.get(rt["m_GameObject"]["m_PathID"]) is None
                    and any("skeletonDataAsset" in (graphics.get((rts.get(_pp(c)) or {}).get("m_GameObject", {}).get("m_PathID")) or {})
                            for c in rt.get("m_Children") or []))

        fathers = []  # parents of SkeletonGraphics (or of their wrapper), each once
        for go, sg in graphics.items():
            if "skeletonDataAsset" in sg and go in go_rt:
                f = _pp(rts[go_rt[go]].get("m_Father"))
                if f in rts and wrapper(rts[f]) and _pp(rts[f].get("m_Father")) in rts:
                    f = _pp(rts[f].get("m_Father"))
                if f in rts and f not in fathers:
                    fathers.append(f)
        for father in fathers:
            layers = []
            kids = []
            for ch in rts[father].get("m_Children") or []:
                rt = rts.get(_pp(ch))
                if rt is not None and wrapper(rt):
                    kids += [rts.get(_pp(c)) for c in rt.get("m_Children") or []]  # (at the wrapper's origin)
                else:
                    kids.append(rt)
            for rt in kids:
                if rt is None or "m_AnchoredPosition" not in rt:
                    continue
                cgo = rt["m_GameObject"]["m_PathID"]
                g = graphics.get(cgo)
                gd = objs[cgo].parse_as_dict() if cgo in objs else {}
                if g is None or not gd.get("m_IsActive", 1) or not g.get("m_Enabled", 1):
                    continue
                left, top, w, h, sc = box(rt)
                if "skeletonDataAsset" in g:
                    atlas = atlas_of(g)
                    if atlas is not None:
                        pos = rt["m_AnchoredPosition"]
                        layers.append({"kind": "spine", "atlas": str(atlas), "ox": pos["x"], "oy": pos["y"], "scale": sc["x"],
                                       "skin": g.get("initialSkinName") or "", "anim": g.get("startingAnimation") or "",
                                       "flip": bool(g.get("initialFlipX"))})
                    continue
                sprite = _pp(g.get("m_Sprite"))
                if sprite not in objs:
                    # an Image without a sprite drawing its material's texture (e.g. N Corp. Sinclair's layers)
                    mo = objs.get(_pp(g.get("m_Material")))
                    if mo is not None:
                        tex = dict((mo.parse_as_dict().get("m_SavedProperties") or {}).get("m_TexEnvs") or [])
                        sprite = next((_pp(tex[k].get("m_Texture")) for k in ("_MainTex", "_Tex_Main") if k in tex
                                       and _pp(tex[k].get("m_Texture")) in objs), None)
                if sprite not in objs or w <= 0 or h <= 0:
                    continue
                col = g.get("m_Color") or {}
                layers.append({"kind": "image", "name": gd.get("m_Name", ""), "sprite": str(sprite),
                               "x": left, "y": top, "w": w, "h": h,
                               "color": [col.get("r", 1), col.get("g", 1), col.get("b", 1), col.get("a", 1)],
                               "material": _material(objs, _pp(g.get("m_Material")))})
            images = [ly for ly in layers if ly["kind"] == "image"]
            spines = [ly for ly in layers if ly["kind"] == "spine"]
            if not images or not spines:
                continue
            x0, y1 = min(ly["x"] for ly in images), max(ly["y"] for ly in images)
            x1, y0 = max(ly["x"] + ly["w"] for ly in images), min(ly["y"] - ly["h"] for ly in images)
            for ly in layers:  # → frame pixels, y down
                if ly["kind"] == "image":
                    ly["x"], ly["y"] = round(ly["x"] - x0, 2), round(y1 - ly["y"], 2)
                else:
                    ly["ox"], ly["oy"] = round(ly["ox"] - x0, 2), round(y1 - ly["oy"], 2)
            sc_ = {"w": round(x1 - x0), "h": round(y1 - y0), "layers": layers}
            for ly in spines:  # an illustration can be cut into several skeletons: each one opens the same scene
                out[int(ly["atlas"])] = sc_
    _cache.clear()  # keep only the latest bundle
    _cache[bundle_path] = out
    return out


def full_sprite(bundle_path: str, pid: int) -> bytes:
    """A sprite as a PNG of its whole rect: packed sprites are trimmed, the trimmed part goes back to its offset."""
    import io
    from PIL import Image
    env = _env(bundle_path)
    with _lock:
        o = next(x for x in env.objects if x.path_id == pid)
        sp = o.read()
        im = sp.image.convert("RGBA")
        if o.type.name == "Texture2D":  # a layer drawing a texture directly
            W, H, off = im.width, im.height, None
        else:
            rd = sp.m_RD
            W, H = round(sp.m_Rect.width), round(sp.m_Rect.height)
            off = getattr(rd, "textureRectOffset", None)
    if off is not None and (im.width, im.height) != (W, H):
        full = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        full.paste(im, (round(off.x), H - round(off.y) - im.height))
        im = full
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return buf.getvalue()
