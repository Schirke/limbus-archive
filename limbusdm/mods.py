"""Mods of skill renders: own textures in place of the game's and a colour shift of the effects, applied by the Unity
player in memory while it renders. The game's files are never written; a mod is a folder of its own:

    data/mods/<id>/<name>/mod.json        {"hue": -180…180, "sat": 0…2, "bright": 0…2}
    data/mods/<id>/<name>/tex/<texture>.png   replaces the texture of that name (same layout as the original)
    data/mods/<id>/<name>/frames/<hash>.png + frames.json   one sprite frame replaced by an image of any size, placed
        by its pivot (the feet); everywhere, or in one skill only ("scope")
    mod.json "timing": [{"group", "at", "dur", "speed"}]   a freeze (speed 0: hold `dur` seconds of video) or a slow /
        fast stretch (`dur` seconds of the original) at `at` seconds of a skill's original video
    mod.json "vfx": [{"effect", "file", "group", "fps", "scale", "blend", "loop", "offset", "intensity"}]   an effect object
        of the skills (its name, or the end of its path) drawn as own frames instead (no scale / offset: as big as and
        where the game's effect draws): "file" under the mod's folder, a
        GIF / APNG / WebP, one PNG or a folder of PNGs (decoded here: the player only reads PNGs; see vfx_frames)

Its renders are kept next to the original's under a variant of their own ("…_m-<name>", see viewer.variant)."""
from __future__ import annotations

import glob
import io
import json
import os
import re
import shutil

NAME_RE = re.compile(r"^[A-Za-z0-9-]{1,32}$")
DEFAULTS = {"hue": 0.0, "sat": 1.0, "bright": 1.0}
VFX_KEYS = ("effect", "file", "group", "fps", "scale", "blend", "loop", "offset", "intensity")


def _root(svc) -> str:
    return os.path.join(svc.store.root, "mods")


def _key(cid) -> str:
    return re.sub(r"[^\w.-]", "_", str(cid))


def mod_dir(svc, cid, name: str) -> str:
    if not NAME_RE.match(name or ""):
        raise ValueError("a mod's name: letters, digits and dashes")
    return os.path.join(_root(svc), _key(cid), name)


def _tex_file(svc, cid, name: str, tex: str) -> str:
    """tex/<hash>.png; the texture's own name (game names have "|" and such) is in tex/names.json."""
    import hashlib
    if not tex or len(tex) > 300:
        raise ValueError("bad texture name")
    return os.path.join(mod_dir(svc, cid, name), "tex", hashlib.sha1(tex.encode("utf-8")).hexdigest()[:16] + ".png")


def _names(d: str) -> dict:
    try:
        with open(os.path.join(d, "tex", "names.json"), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def load(svc, cid, name: str) -> dict | None:
    """The mod as the player takes it: colour values and {texture name: PNG path}."""
    d = mod_dir(svc, cid, name)
    if not os.path.isdir(d):
        return None
    raw = _json(os.path.join(d, "mod.json"), {})
    vals = {**DEFAULTS, **{k: float(v) for k, v in raw.items() if k in DEFAULTS}}
    files = _names(d)  # file → texture name
    tex = {files[os.path.basename(p)]: p for p in sorted(glob.glob(os.path.join(d, "tex", "*.png"))) if os.path.basename(p) in files}
    frames = [dict(f, path=os.path.join(d, "frames", f["file"])) for f in _json(os.path.join(d, "frames.json"), {}).values()
              if os.path.isfile(os.path.join(d, "frames", f["file"]))]
    vfx = []
    for v in raw.get("vfx") or []:
        src = os.path.join(d, str(v.get("file") or ""))
        if not v.get("effect") or not v.get("file") or not os.path.exists(src):
            continue
        pngs, fps = vfx_frames(src, os.path.join(d, "vfx", ".frames"))
        if pngs:
            vfx.append({"effect": str(v["effect"]), "file": str(v["file"]), "group": str(v.get("group") or ""), "frames": pngs,
                        "fps": float(v.get("fps") or fps), "scale": float(v.get("scale") or 0),
                        "blend": "additive" if v.get("blend") == "additive" else "normal", "loop": bool(v.get("loop")),
                        "offset": [float(x) for x in v["offset"][:2]] if v.get("offset") else None,
                        "intensity": float(v.get("intensity") or 1)})
    return {"name": name, **vals, "textures": tex, "frames": frames, "timing": raw.get("timing") or [], "vfx": vfx}


def vfx_frames(src: str, cache: str) -> tuple[list[str], float]:
    """An animation as PNG files (made once, kept while the source is unchanged) and its own fps (24 when it has none):
    a GIF / APNG / WebP frame by frame (Pillow puts each together as shown), a PNG, or a folder of PNGs in name order."""
    import hashlib
    from PIL import Image, ImageSequence
    if os.path.isdir(src):
        return sorted(glob.glob(os.path.join(src, "*.png"))), 24.0
    key = hashlib.sha1(f"{os.path.abspath(src)}|{os.path.getmtime(src)}".encode("utf-8")).hexdigest()[:16]
    out = os.path.join(cache, key)
    meta = _json(os.path.join(out, "frames.json"), None)
    if meta:
        return [os.path.join(out, f) for f in meta["files"]], meta["fps"]
    os.makedirs(out, exist_ok=True)
    files, durs = [], []
    with Image.open(src) as im:
        for i, fr in enumerate(ImageSequence.Iterator(im)):
            f = f"{i:04d}.png"
            fr.convert("RGBA").save(os.path.join(out, f), "PNG")
            files.append(f)
            durs.append(fr.info.get("duration") or 0)
    ms = sum(durs) / len(durs) if durs and all(durs) else 0
    fps = round(1000 / ms, 2) if ms else 24.0
    with open(os.path.join(out, "frames.json"), "w", encoding="utf-8") as f:
        json.dump({"files": files, "fps": fps}, f)
    return [os.path.join(out, f) for f in files], fps


def _json(path: str, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def list_mods(svc, cid) -> list[dict]:
    base = os.path.join(_root(svc), _key(cid))
    out = []
    for n in sorted(os.listdir(base)) if os.path.isdir(base) else []:
        m = load(svc, cid, n) if NAME_RE.match(n) else None
        if m:
            out.append({**m, "textures": sorted(m["textures"]),
                        "frames": [{k: f[k] for k in ("sprite", "scope", "file", "source")} for f in m["frames"]],
                        "vfx": [{**{k: f.get(k) for k in VFX_KEYS}, "n": len(f["frames"])} for f in m["vfx"]]})
    return out


def save(svc, cid, name: str, values: dict) -> dict:
    d = mod_dir(svc, cid, name)
    os.makedirs(os.path.join(d, "tex"), exist_ok=True)
    vals = {k: float(values.get(k, v)) for k, v in DEFAULTS.items()}
    vals["hue"] = max(-180.0, min(180.0, vals["hue"]))
    vals["sat"] = max(0.0, min(2.0, vals["sat"]))
    vals["bright"] = max(0.0, min(3.0, vals["bright"]))
    timing = values.get("timing", _json(os.path.join(d, "mod.json"), {}).get("timing") or [])
    vals["timing"] = [{"group": str(t["group"]), "at": max(0.0, float(t["at"])), "dur": max(0.0, min(30.0, float(t["dur"]))),
                       "speed": max(0.0, min(4.0, float(t["speed"])))} for t in timing if t.get("group")]
    vals["vfx"] = values["vfx"] if "vfx" in values else _json(os.path.join(d, "mod.json"), {}).get("vfx") or []
    with open(os.path.join(d, "mod.json"), "w", encoding="utf-8") as f:
        json.dump(vals, f)
    _forget_renders(svc, cid, name)
    return load(svc, cid, name)


def delete(svc, cid, name: str):
    shutil.rmtree(mod_dir(svc, cid, name), ignore_errors=True)
    _forget_renders(svc, cid, name)


def put_texture(svc, cid, name: str, tex: str, png: bytes | None, size: tuple[int, int] | None = None) -> str:
    """Store (or with png=None remove) a replacement. Any image is taken and saved as PNG; a different size than the
    original's is scaled to it (the sprites are cut from fixed places of the texture)."""
    p = _tex_file(svc, cid, name, tex)
    d = mod_dir(svc, cid, name)
    files = _names(d)
    if png is None:
        if os.path.exists(p):
            os.remove(p)
        files.pop(os.path.basename(p), None)
    else:
        from PIL import Image
        im = Image.open(io.BytesIO(png)).convert("RGBA")
        if size and im.size != tuple(size):
            im = im.resize(tuple(size), Image.LANCZOS)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        im.save(p, "PNG")
        files[os.path.basename(p)] = tex
    os.makedirs(os.path.join(d, "tex"), exist_ok=True)
    with open(os.path.join(d, "tex", "names.json"), "w", encoding="utf-8") as f:
        json.dump(files, f, ensure_ascii=False)
    _forget_renders(svc, cid, name)
    return p


def texture_file(svc, cid, name: str, tex: str) -> str | None:
    p = _tex_file(svc, cid, name, tex)
    return p if os.path.isfile(p) else None


def _forget_renders(svc, cid, name: str):
    """A changed mod's renders are stale."""
    for d in glob.glob(os.path.join(svc.store.root, "fx_renders", "*", f"{_key(cid)}_*m-{name}")):
        shutil.rmtree(d, ignore_errors=True)


APPEAR_RE = re.compile(r"^(\d+)_.*Appear")
HIERARCHY = {"GameObject", "Transform", "RectTransform"}


def _used_textures(bundle_path: str, cid) -> set[int] | None:
    """Texture2D path ids a bundle's prefabs really use — every root object (the character, its cut-ins, the effect
    prefabs its skills spawn) except other characters' "<id>_…Appearance", through their components and every asset
    reachable from them (materials, sprites and their atlases, Animator controllers and clips, timelines, Spine data).
    Bundles also hold things the character never shows: other characters' disabled stand-ins under a cut-in's
    targets (90120_Maid_1Appearance in Hollow's), shared bundles the other Identities, and atlases nothing references
    (8171_Nelly_SDAtlas). None = can't tell."""
    from .extract import _env, _lock
    try:
        env = _env(bundle_path)
    except Exception:
        return None
    with _lock:
        objs = {o.path_id: o for o in env.objects}
        tr_of, kids, father = {}, {}, {}
        for o in env.objects:
            if o.type.name in ("Transform", "RectTransform"):
                try:
                    d = o.parse_as_dict()
                except Exception:
                    continue
                tr_of[d["m_GameObject"]["m_PathID"]] = o.path_id
                f = d["m_Father"]["m_PathID"] if d["m_Father"].get("m_FileID", 0) == 0 else 0
                father[o.path_id] = f
                kids.setdefault(f, []).append(o.path_id)
        go_of = {t: g for g, t in tr_of.items()}
        own = str(cid)
        comps, stack = set(), [t for t, f in father.items() if not f]
        if not stack:
            return None
        while stack:
            t = stack.pop()
            g = go_of.get(t)
            if g is None:
                continue
            m = APPEAR_RE.match(objs[g].peek_name() or "")
            if m and not own.startswith(m.group(1)):
                continue  # another character's stand-in
            try:
                comps |= {c["component"]["m_PathID"] for c in objs[g].parse_as_dict()["m_Component"]}
            except Exception:
                pass
            stack += kids.get(t, [])

        def refs(v, out):
            if isinstance(v, dict):
                if "m_PathID" in v and "m_FileID" in v:
                    if v["m_FileID"] == 0 and v["m_PathID"]:
                        out.append(v["m_PathID"])
                else:
                    for x in v.values():
                        refs(x, out)
            elif isinstance(v, (list, tuple)):  # (maps come as lists of (key, value) tuples)
                for x in v:
                    refs(x, out)

        used, seen, todo = set(), set(), list(comps)
        while todo:
            pid = todo.pop()
            o = objs.get(pid)
            if pid in seen or o is None or o.type.name in HIERARCHY:
                continue
            seen.add(pid)
            if o.type.name == "Texture2D":
                used.add(pid)
                continue
            try:
                d = o.parse_as_dict()
            except Exception:
                continue
            go = (d.get("m_GameObject") or {}).get("m_PathID") if isinstance(d, dict) else None
            if go and pid not in comps:
                continue  # a component of an object outside the character (bindings, targets)
            out = []
            refs({k: v for k, v in d.items() if k not in ("m_GameObject", "m_Script")}, out)
            todo += out
        return used


def textures(svc, cid) -> list[dict]:
    """The textures a mod can replace: those of the character's own bundles (its sprites, its own effects, an E.G.O's
    cut-in and background), biggest first. Shared effect textures of other bundles aren't listed."""
    import sqlite3
    from .viewer import _prefabs, _skill_view_rows
    bundles = {b for b, _n in _prefabs(svc, cid) if "produce" not in b}
    if isinstance(cid, int):
        bundles |= {b for b, _n in _skill_view_rows(svc, cid) if "produce" not in b}
    db = sqlite3.connect(svc.ensure_browse())
    try:
        rows = []
        for b in sorted(bundles):
            rows += db.execute("select bundle, pid, name, w, hgt from o where bundle = ? and type = 'Texture2D'", (b,)).fetchall()
    finally:
        db.close()
    # only what the character uses (shared bundles also hold stand-ins, other Identities and leftovers)
    keep = {}
    for b in bundles:
        path = svc.object_file(b)
        keep[b] = _used_textures(path, cid) if path else None
    rows = [r for r in rows if keep.get(r[0]) is None or r[1] in keep[r[0]]]
    seen, out = set(), []
    # the battle sprites (sprite atlases "sactx-…") first, then by size
    for b, pid, n, w, h in sorted(rows, key=lambda r: (not r[2].startswith("sactx-"), -((r[3] or 0) * (r[4] or 0)), r[2])):
        if n in seen or (w or 0) * (h or 0) < 32 * 32:
            continue
        seen.add(n)
        out.append({"bundle": b, "pid": str(pid), "name": n, "w": w, "h": h})
    return out


def owned(svc) -> list[str]:
    """The characters (as their ids are written in the folder names) that have at least one mod."""
    base = _root(svc)
    out = []
    for k in sorted(os.listdir(base)) if os.path.isdir(base) else []:
        if any(os.path.isfile(os.path.join(base, k, n, "mod.json")) for n in os.listdir(os.path.join(base, k))):
            out.append(k)
    return out


def vfx_frame_file(svc, cid, name: str, effect: str, i: int) -> str | None:
    m = load(svc, cid, name)
    v = next((x for x in (m or {}).get("vfx", []) if x["effect"] == effect), None)
    return v["frames"][i] if v and 0 <= i < len(v["frames"]) else None


def put_vfx(svc, cid, name: str, effect: str, data: bytes | None = None, filename: str = "", params: dict | None = None,
            source: dict | None = None, remove: bool = False) -> None:
    """An effect of the skills drawn as own frames (see vfx_frames). `data`: the file (GIF / APNG / WebP / PNG, or a zip
    of PNGs); `source` {"cid", "effect"}: another character's effect, taken from its rendered Effects videos; neither: only
    the settings change; remove: the game's effect again. `params`: group, fps, scale, blend, loop, offset, intensity."""
    import hashlib
    import zipfile
    if not effect or len(effect) > 200:
        raise ValueError("bad effect name")
    d = mod_dir(svc, cid, name)
    if load(svc, cid, name) is None:
        save(svc, cid, name, {})
    raw = _json(os.path.join(d, "mod.json"), {})
    entries = [v for v in raw.get("vfx") or [] if v.get("effect") != effect]
    old = next((v for v in raw.get("vfx") or [] if v.get("effect") == effect), None)
    key = hashlib.sha1(effect.encode("utf-8")).hexdigest()[:12]
    rel = (old or {}).get("file", "")

    def clear():
        for p in glob.glob(os.path.join(d, "vfx", key + "*")):
            shutil.rmtree(p, ignore_errors=True) if os.path.isdir(p) else os.remove(p)

    if remove:
        clear()
    else:
        if data or source:
            clear()
            os.makedirs(os.path.join(d, "vfx"), exist_ok=True)
        if data:
            if data[:2] == b"PK":  # a zip of PNG frames
                rel = f"vfx/{key}"
                os.makedirs(os.path.join(d, rel), exist_ok=True)
                with zipfile.ZipFile(io.BytesIO(data)) as z:
                    for i, n in enumerate(sorted(x for x in z.namelist() if x.lower().endswith(".png"))):
                        with open(os.path.join(d, rel, f"{i:04d}.png"), "wb") as f:
                            f.write(z.read(n))
            else:
                ext = os.path.splitext(filename)[1].lower()
                ext = ext if ext in (".gif", ".png", ".webp", ".apng") else ".png"
                rel = f"vfx/{key}{ext}"
                with open(os.path.join(d, rel), "wb") as f:
                    f.write(data)
        elif source:
            rel = f"vfx/{key}"
            _vfx_from_render(svc, d, rel, source["cid"], source["effect"])
            params = {"fps": 30, **(params or {})}
        if not rel or not os.path.exists(os.path.join(d, rel)):
            raise ValueError("no animation yet: drop a file first")
        p = {**(old or {}), **(params or {})}
        entry = {"effect": effect, "file": rel, "group": str(p.get("group") or ""),
                 "scale": max(0.0, min(30.0, float(p.get("scale") or 0))), "blend": "additive" if p.get("blend") == "additive" else "normal",
                 "loop": bool(p.get("loop")), "intensity": max(0.0, min(8.0, float(p.get("intensity") or 1)))}
        if p.get("fps"):
            entry["fps"] = max(1.0, min(120.0, float(p["fps"])))
        if p.get("offset"):
            entry["offset"] = [max(-30.0, min(30.0, float(x))) for x in p["offset"][:2]]
        entries.append(entry)
    raw["vfx"] = entries
    with open(os.path.join(d, "mod.json"), "w", encoding="utf-8") as f:
        json.dump({**DEFAULTS, **raw}, f)
    _forget_renders(svc, cid, name)


def _vfx_from_render(svc, d: str, rel: str, src_cid, src_effect: str):
    """Frames of another character's effect: its rendered Effects video (transparent WebM, made in the Effects tab), cut
    into PNGs, cropped to what the effect draws, half size, the faintest alpha cut."""
    import subprocess
    import tempfile
    from PIL import Image
    from .viewer import ffmpeg_exe
    video = svc.fx.video(src_cid, src_effect, "alpha_effects")
    if not video:
        raise ValueError("that effect isn't rendered yet: open its character's Effects tab and render it first")
    tmp = tempfile.mkdtemp(prefix="vfx_")
    try:
        cmd = [ffmpeg_exe(), "-v", "error", "-y"] + (["-c:v", "libvpx-vp9"] if video.endswith(".webm") else []) + ["-i", video,
               "-pix_fmt", "rgba", os.path.join(tmp, "%04d.png")]
        subprocess.run(cmd, check=True, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        files = sorted(glob.glob(os.path.join(tmp, "*.png")))
        ims = [Image.open(f).convert("RGBA") for f in files]
        box = None
        for im in ims:
            b = im.getchannel("A").point(lambda a: 255 if a > 6 else 0).getbbox()
            if b:
                box = b if box is None else (min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3]))
        if not ims or not box:
            raise ValueError("that render has nothing drawn in it")
        out = os.path.join(d, rel)
        os.makedirs(out, exist_ok=True)
        for i, im in enumerate(ims):
            r, g, b_, a = im.crop(box).split()
            c = Image.merge("RGBA", (r, g, b_, a.point(lambda v: 0 if v < 4 else v)))
            c.resize((max(1, c.width // 2), max(1, c.height // 2)), Image.LANCZOS).save(os.path.join(out, f"{i:04d}.png"))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def put_frame(svc, cid, name: str, sprite: str, image: bytes | None, scope: str = "", source: dict | None = None) -> None:
    """Replace one sprite frame (image=None and no source: back to the game's). `image`: a PNG of any size, placed
    by frames.placement; `source`: {"cid", "sprite"} — another character's frame, as that character has it."""
    import hashlib
    from PIL import Image
    from . import frames
    d = mod_dir(svc, cid, name)
    if load(svc, cid, name) is None:
        save(svc, cid, name, {})
    meta = _json(os.path.join(d, "frames.json"), {})
    key = f"{sprite}@{scope}"
    file = hashlib.sha1(key.encode("utf-8")).hexdigest()[:16] + ".png"
    path = os.path.join(d, "frames", file)
    if image is None and source is None:
        meta.pop(key, None)
        if os.path.exists(path):
            os.remove(path)
    else:
        if source:
            rec = frames.find(svc, source["cid"], source["sprite"])
            if rec is None:
                raise KeyError("no such frame")
            im, (px, py), ppu = frames.frame_png(svc, rec), (rec["px"], rec["py"]), rec["ppu"]
        else:
            rec = frames.find(svc, cid, sprite)
            if rec is None:
                raise KeyError("no such frame")
            im = Image.open(io.BytesIO(image)).convert("RGBA")
            (px, py), ppu = frames.placement(rec, im.size), rec["ppu"]
        os.makedirs(os.path.dirname(path), exist_ok=True)
        im.save(path, "PNG")
        meta[key] = {"sprite": sprite, "scope": scope, "file": file, "px": px, "py": py, "ppu": ppu,
                     "source": f"{source['cid']}/{source['sprite']}" if source else ""}
    with open(os.path.join(d, "frames.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False)
    _forget_renders(svc, cid, name)


def put_frames_zip(svc, cid, name: str, data: bytes, scope: str = "") -> int:
    """The edited frames of an exported zip (or any zip of "<sprite>.png"): each one replaces its frame."""
    import zipfile
    from . import frames
    known = {frames.safe_file(f["name"]) + ".png": f["name"] for g in frames.character_frames(svc, cid)["groups"] for f in g["frames"]}
    n = 0
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        for info in z.infolist():
            base = os.path.basename(info.filename)
            if base in known:
                put_frame(svc, cid, name, known[base], z.read(info), scope)
                n += 1
    return n
