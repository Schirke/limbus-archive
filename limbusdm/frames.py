"""A character's sprite frames by skill, and its Animator poses (for the mods' frame editor)."""
from __future__ import annotations

import io
import json
import os
import re
import zipfile

from .extract import _env, _lock


def _pad(w: int, h: int) -> int:
    """Room around an exported frame for drawing past the outline."""
    return int(0.4 * max(w, h)) + 16


def _jobs(svc, cid):
    from .viewer import _prefabs, _skill_view_rows, make_job, skill_views
    out = []
    if isinstance(cid, int) and str(cid).startswith("2"):
        for v in skill_views(svc, cid):
            try:
                out.append((make_job(svc, cid, False, v), [b for b, n in _skill_view_rows(svc, cid) if n == v]))
            except ValueError:
                pass
    try:
        out.append((make_job(svc, cid), [b for b, _n in _prefabs(svc, cid)]))
    except ValueError:
        pass
    return out


def character_frames(svc, cid) -> dict:
    """{"groups": [{name, frames}]}: one group per skill video, then "Poses"; pivot from the bottom-left."""
    from .viewer import VERSION, job_groups
    cache = os.path.join(svc.store.root, "fx_jobs", f"{svc.latest_snapshot_id()}_v{VERSION}",
                         f"frames_{re.sub(r'[^\w.-]', '_', str(cid))}.json")
    try:
        with open(cache, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        pass
    groups, seen_all = [], {}
    for job, rows in _jobs(svc, cid):
        path = job["bundles"][0] if job.get("bundles") else None
        lg = next((b for b in rows if svc.object_file(b) == path), None)
        if not path or not lg:
            continue
        env = _env(path)
        with _lock:
            objs = {o.path_id: o for o in env.objects}

            def sprite(pid):
                if pid in seen_all:
                    return seen_all[pid]
                o = objs.get(pid)
                rec = None
                if o is not None and o.type.name == "Sprite":
                    d = o.parse_as_dict()
                    r, pv = d["m_Rect"], d.get("m_Pivot") or {"x": 0.5, "y": 0.5}
                    w, h = round(r["width"]), round(r["height"])
                    rec = {"name": d.get("m_Name") or str(pid), "bundle": lg, "pid": str(pid), "w": w, "h": h,
                           "px": round(pv["x"] * w, 2), "py": round(pv["y"] * h, 2), "ppu": d.get("m_PixelsToUnits") or 100}
                seen_all[pid] = rec
                return rec

            def clip_sprites(clip_pid, out):
                c = objs.get(clip_pid)
                if c is None or c.type.name != "AnimationClip":
                    return
                try:
                    pp = c.read_typetree()["m_ClipBindingConstant"]["pptrCurveMapping"]
                except Exception:
                    return
                for p in pp:
                    if p.get("m_FileID", 0) == 0:
                        s = sprite(p.get("m_PathID"))
                        if s and s not in out:
                            out.append(s)

            def timeline_sprites(tl_pid, out):
                stack = list((objs[tl_pid].parse_as_dict().get("m_Tracks") or []) if tl_pid in objs else [])
                while stack:
                    t = objs.get(stack.pop(0).get("m_PathID"))
                    if t is None:
                        continue
                    try:
                        td = t.parse_as_dict()
                    except Exception:
                        continue
                    if td.get("m_Muted"):
                        continue
                    for c in td.get("m_Clips") or []:
                        a = objs.get((c.get("m_Asset") or {}).get("m_PathID"))
                        if a is not None:
                            try:
                                clip_sprites((a.parse_as_dict().get("m_Clip") or {}).get("m_PathID"), out)
                            except Exception:
                                pass
                    clip_sprites((td.get("m_InfiniteClip") or {}).get("m_PathID"), out)
                    stack[:0] = td.get("m_Children") or []

            used = set()
            for g in job_groups(job):
                frames = []
                for t in g["parts"]:
                    timeline_sprites(t["pid"], frames)
                if frames:
                    groups.append({"name": g["name"], "frames": frames})
                    used |= {f["pid"] for f in frames}
            # the Animator's own states: idle, damaged, guard, evade, move, dead…
            root = next((o for o in objs.values() if o.type.name == "GameObject"
                         and job["prefab"].rsplit("/", 1)[-1].lower() == (o.peek_name() or "").lower() + ".prefab"), None)
            poses = []
            if root is not None:
                for comp in root.parse_as_dict().get("m_Component") or []:
                    co = objs.get(comp["component"]["m_PathID"])
                    if co is None or co.type.name != "Animator":
                        continue
                    ctl = objs.get((co.parse_as_dict().get("m_Controller") or {}).get("m_PathID"))
                    if ctl is None:
                        continue
                    for cref in ctl.parse_as_dict().get("m_AnimationClips") or []:
                        clip_sprites(cref.get("m_PathID"), poses)
            poses = [f for f in poses if f["pid"] not in used]
            if poses:
                groups.append({"name": "Poses", "frames": poses})
    out = {"groups": groups}
    os.makedirs(os.path.dirname(cache), exist_ok=True)
    with open(cache, "w", encoding="utf-8") as f:
        json.dump(out, f)
    return out


LOOK_POSE = {"Default": "idle", "Move": "move", "Damaged": "dmg", "Guard": "gud", "Evade": "miss", "Dead": "dead"}


def look_frames(svc, cid, look: str) -> dict:
    """The frames of another appearance of an Identity (e.g. "CastOff"): groups S1… and "Poses", like character_frames."""
    groups, poses = {}, []
    for c in svc.owner_clips(cid):
        if look.lower() not in c["animator"].lower() or c["kind"] not in ("skill", "pose"):
            continue
        path = svc.object_file(c["bundle"])
        if not path:
            continue
        with _lock:
            env = _env(path)
            objs = {o.path_id: o for o in env.objects}
            clip = objs.get(int(c["clip"]))
            frames = []
            try:
                pp = clip.read_typetree()["m_ClipBindingConstant"]["pptrCurveMapping"] if clip is not None else []
            except Exception:
                pp = []
            for p in pp:
                o = objs.get(p.get("m_PathID")) if p.get("m_FileID", 0) == 0 else None
                if o is None or o.type.name != "Sprite":
                    continue
                d = o.parse_as_dict()
                r, pv = d["m_Rect"], d.get("m_Pivot") or {"x": 0.5, "y": 0.5}
                w, h = round(r["width"]), round(r["height"])
                rec = {"name": d.get("m_Name") or str(o.path_id), "bundle": c["bundle"], "pid": str(o.path_id), "w": w, "h": h,
                       "px": round(pv["x"] * w, 2), "py": round(pv["y"] * h, 2), "ppu": d.get("m_PixelsToUnits") or 100}
                if rec not in frames:
                    frames.append(rec)
        if not frames:
            continue
        label = c["name"].rsplit("_", 1)[-1]
        if c["kind"] == "skill":
            groups.setdefault(f"S{c['n']}", frames)
        elif label in LOOK_POSE:
            poses += [{**f, "name": LOOK_POSE[label] if i == 0 else f"{LOOK_POSE[label]}_{i}"} for i, f in enumerate(frames)]
    out = [{"name": k, "frames": v} for k, v in sorted(groups.items())]
    return {"groups": out + ([{"name": "Poses", "frames": poses}] if poses else [])}


PART_GROUP = re.compile(r"^(skill\d+|s\d+|idle|default|move|dmg|damaged|dead)$", re.I)
PART_POSE = {"default": "idle", "damaged": "dmg"}


def _num(name: str) -> int:
    m = re.search(r"(\d+)$", name)
    return int(m.group(1)) if m else 0


def _tree(objs: dict, go) -> dict:
    """{name, pid, active, m (local 2x3), sr: (order, sprite pid) | None, kids}"""
    import math
    d = go.parse_as_dict()
    node = {"name": d.get("m_Name") or "", "pid": go.path_id, "active": d.get("m_IsActive", True), "sr": None, "kids": [], "m": (1, 0, 0, 0, 1, 0)}
    for c in d.get("m_Component") or []:
        co = objs.get(c["component"]["m_PathID"])
        if co is None:
            continue
        if co.type.name == "Transform":
            t = co.parse_as_dict()
            p, s, q = t["m_LocalPosition"], t["m_LocalScale"], t["m_LocalRotation"]
            a = 2 * math.atan2(q["z"], q["w"])
            node["m"] = (math.cos(a) * s["x"], -math.sin(a) * s["y"], p["x"], math.sin(a) * s["x"], math.cos(a) * s["y"], p["y"])
            for ch in t.get("m_Children") or []:
                tr = objs.get(ch["m_PathID"])
                g = tr and objs.get(tr.parse_as_dict()["m_GameObject"]["m_PathID"])
                if g is not None:
                    node["kids"].append(_tree(objs, g))
        elif co.type.name == "SpriteRenderer":
            sd = co.parse_as_dict()
            sp = (sd.get("m_Sprite") or {}).get("m_PathID")
            if sd.get("m_Enabled", 1) and sp in objs:
                node["sr"] = (sd.get("m_SortingOrder", 0), sp, bool(sd.get("m_FlipX")), bool(sd.get("m_FlipY")))
    return node


def _mul(a, b):
    return (a[0] * b[0] + a[1] * b[3], a[0] * b[1] + a[1] * b[4], a[0] * b[2] + a[1] * b[5] + a[2],
            a[3] * b[0] + a[4] * b[3], a[3] * b[1] + a[4] * b[4], a[3] * b[2] + a[4] * b[5] + a[5])


def _has_sr(n) -> bool:
    return bool(n["sr"]) or any(_has_sr(k) for k in n["kids"])


def _variants(n) -> list:
    """Children named <frame>_<k> that each draw something: states of one frame (whole / cracked…)."""
    vs = [k for k in n["kids"] if re.fullmatch(re.escape(n["name"]) + r"_\d+", k["name"]) and _has_sr(k)]
    return sorted(vs, key=lambda k: _num(k["name"])) if len(vs) > 1 else []


def _pieces(n, m, v: str, out: list, top=True):
    """Drawn sprites of a frame: (order, world matrix, sprite pid, flipx, flipy); effects (_e1…) left out."""
    if not n["active"] and not top:
        return
    if re.search(r"_e\d*$", n["name"]):
        return
    # layered frames: _n = whole part, _d = broken part, _nd = both
    if re.search(r"_d$", n["name"]) and v != "d" or re.search(r"_n$", n["name"]) and v == "d":
        return
    m = _mul(m, n["m"])
    if n["sr"]:
        out.append((n["sr"][0], m, n["sr"][1], n["sr"][2], n["sr"][3]))
    vs = _variants(n)
    pick = None
    if vs:
        pick = vs[min(int(v) - 1, len(vs) - 1)] if v.isdigit() else vs[0]
    for k in n["kids"]:
        if vs and k in vs and k is not pick:
            continue
        _pieces(k, m, v, out, False)


def _part_frames(objs, root) -> list:
    """[(group name, [(frame node, world matrix of its parent)])] of a prefab drawn as GameObject frames."""
    found = []

    def walk(n, m):
        mm = _mul(m, n["m"])
        if PART_GROUP.match(n["name"]) and _has_sr(n):
            kids = [k for k in n["kids"] if _has_sr(k) and not re.search(r"_e\d*$", k["name"])]
            # two children <group>_1 / _2 = two states of one frame; more = the frames in order
            if not kids or len(_variants(n)) == 2 == len(kids):
                found.append((n["name"], [(n, m)]))
            else:
                found.append((n["name"], [(k, mm) for k in sorted(kids, key=lambda k: _num(k["name"]))]))
            return
        for k in n["kids"]:
            walk(k, mm)
    walk(root, (1, 0, 0, 0, 1, 0))
    return found


def _part_root(svc, cid):
    from .viewer import make_job
    job = make_job(svc, cid)
    path = job["bundles"][0] if job.get("bundles") else None
    if not path:
        return None, None, None
    name = job["prefab"].rsplit("/", 1)[-1][:-len(".prefab")]
    env = _env(path)
    objs = {o.path_id: o for o in env.objects}
    go = next((o for o in objs.values() if o.type.name == "GameObject" and o.peek_name() == name), None)
    return path, objs, go


def part_frames(svc, cid) -> dict:
    """character_frames for units whose frames are GameObjects of parts (Golden Apple, Kromer's 2nd phase…): one
    composed picture per frame, frame_png with "v" = state ("1", "2"… or "n" / "d")."""
    from .viewer import VERSION
    cache = os.path.join(svc.store.root, "fx_jobs", f"{svc.latest_snapshot_id()}_v{VERSION}",
                         f"parts_{re.sub(r'[^\w.-]', '_', str(cid))}.json")
    try:
        with open(cache, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        pass
    groups = []
    try:
        path, objs, go = _part_root(svc, cid)
    except ValueError:
        path = None
    if path and go is not None:
        from .viewer import _prefabs
        lg = next((b for b, _n in _prefabs(svc, cid) if svc.object_file(b) == path), None)
        with _lock:
            root = _tree(objs, go)
            base = re.sub(r"Appearance$", "", go.peek_name())
            poses = []
            found = _part_frames(objs, root)
            dens = _unit_dens(objs, found) if found else 100.0
            for gname, frames in found:
                recs = []
                for n, m in frames:
                    states = [str(i + 1) for i in range(len(_variants(n)))] or (["n", "d"] if _layered(n) else [""])
                    for st in states:
                        im, px, py = _compose(objs, n, m, st, dens)
                        if im is None:
                            continue
                        recs.append({"name": n["name"] + (f"#{st}" if st and st not in ("1", "n") else ""), "bundle": lg or path,
                                     "pid": str(n["pid"]), "v": st, "w": im.width, "h": im.height, "px": px, "py": py, "ppu": 100})
                if not recs:
                    continue
                low = gname.lower()
                if re.match(r"(skill|s)\d+$", low):
                    groups.append({"name": f"{base}_S{_num(gname)}", "frames": recs})
                else:
                    name = PART_POSE.get(low, low)
                    poses += [dict(r, name=name + r["name"][len(r["name"].split("#")[0]):]) for r in recs if r["pid"] == recs[0]["pid"]]
            groups.sort(key=lambda g: _num(g["name"]))
            if poses:
                groups.append({"name": "Poses", "frames": poses})
    out = {"groups": groups}
    os.makedirs(os.path.dirname(cache), exist_ok=True)
    with open(cache, "w", encoding="utf-8") as f:
        json.dump(out, f)
    return out


def _layered(n) -> bool:
    def walk(k):
        return bool(re.search(r"_d$", k["name"])) or any(walk(c) for c in k["kids"])
    return walk(n)


def _unit_dens(objs, found) -> float:
    """Pixels per world unit for every frame of a unit: its idle frame's sprites at their own resolution."""
    import math
    first = next((f[0] for g, f in found if g.lower() in ("idle", "default")), None) or found[0][1][0]
    ps = []
    _pieces(first[0], first[1], "", ps)
    ds = sorted((objs[sp].parse_as_dict().get("m_PixelsToUnits") or 100) / max(1e-6, math.hypot(w[0], w[3])) for _o, w, sp, *_ in ps)
    return ds[len(ds) // 2] if ds else 100.0


def _compose(objs, n, m, v: str, dens: float):
    """(RGBA picture, pivot x, pivot y from the bottom-left) of a frame node drawn in its prefab's world."""
    import math
    from PIL import Image
    ps = []
    _pieces(n, m, v, ps)
    if not ps:
        return None, 0, 0
    ps.sort(key=lambda p: p[0])
    drawn = []
    for _o, w, sp, fx, fy in ps:
        so = objs[sp]
        sd = so.parse_as_dict()
        try:
            im = so.read().image.convert("RGBA")
        except Exception:
            continue
        drawn.append((w, sd, im, fx, fy))
    if not drawn:
        return None, 0, 0
    items = []
    for w, sd, im, fx, fy in drawn:
        ppu = sd.get("m_PixelsToUnits") or 100
        sx, sy = math.hypot(w[0], w[3]), math.hypot(w[1], w[4])
        k = dens / ppu
        nw, nh = max(1, round(im.width * sx * k)), max(1, round(im.height * sy * k))
        im = im.resize((nw, nh), Image.LANCZOS) if (nw, nh) != im.size else im
        flip = (w[0] * w[4] - w[1] * w[3] < 0) ^ fx
        if flip:
            im = im.transpose(Image.FLIP_LEFT_RIGHT)
        if fy:
            im = im.transpose(Image.FLIP_TOP_BOTTOM)
        pv = sd.get("m_Pivot") or {"x": 0.5, "y": 0.5}
        ax, ay = pv["x"] * nw, (1 - pv["y"]) * nh
        if flip:
            ax = nw - ax
        items.append((im, w[2] * dens - ax, -w[5] * dens - ay))
    x0, y0 = min(i[1] for i in items), min(i[2] for i in items)
    x1, y1 = max(i[1] + i[0].width for i in items), max(i[2] + i[0].height for i in items)
    out = Image.new("RGBA", (math.ceil(x1 - x0) + 1, math.ceil(y1 - y0) + 1), (0, 0, 0, 0))
    for im, x, y in items:
        out.alpha_composite(im, (round(x - x0), round(y - y0)))
    # the prefab's origin (the feet) as the pivot
    return out, round(-x0, 2), round(out.height - (-y0), 2)


def part_png(svc, cid, pid: str, v: str):
    path, objs, go = _part_root(svc, cid)
    with _lock:
        root = _tree(objs, go)
        found = _part_frames(objs, root)
        for _g, frames in found:
            for n, m in frames:
                if str(n["pid"]) == str(pid):
                    return _compose(objs, n, m, v, _unit_dens(objs, found))[0]
    raise KeyError("no such frame")


def find(svc, cid, sprite: str) -> dict | None:
    for g in character_frames(svc, cid)["groups"]:
        for f in g["frames"]:
            if f["name"] == sprite:
                return f
    return None


def frame_png(svc, rec: dict, pad: int = 0):
    """The frame as an RGBA image (its whole rect), with `pad` transparent pixels around it."""
    from PIL import Image
    env = _env(svc.object_file(rec["bundle"]))
    with _lock:
        o = next(x for x in env.objects if x.path_id == int(rec["pid"]))
        im = o.read().image.convert("RGBA")
    if im.size != (rec["w"], rec["h"]):
        full = Image.new("RGBA", (rec["w"], rec["h"]), (0, 0, 0, 0))
        full.paste(im, (0, 0))
        im = full
    if pad:
        big = Image.new("RGBA", (rec["w"] + 2 * pad, rec["h"] + 2 * pad), (0, 0, 0, 0))
        big.paste(im, (pad, pad))
        im = big
    return im


def safe_file(name: str) -> str:
    return re.sub(r'[<>:"/\\|?*]', "_", name)


def group_zip(svc, cid, group: str) -> tuple[bytes, str]:
    """One skill's frames ("": all) as PNGs with room around them, plus a note."""
    groups = character_frames(svc, cid)["groups"]
    if group:
        g = next((x for x in groups if x["name"] == group), None)
        if g is None:
            raise KeyError("no such skill")
        todo = g["frames"]
    else:
        todo = list({safe_file(f["name"]): f for x in groups for f in x["frames"]}.values())
    buf = io.BytesIO()
    meta = {}
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for f in todo:
            pad = _pad(f["w"], f["h"])
            b = io.BytesIO()
            frame_png(svc, f, pad).save(b, "PNG")
            fn = safe_file(f["name"]) + ".png"
            z.writestr(fn, b.getvalue())
            meta[fn] = {"sprite": f["name"], "canvas": [f["w"] + 2 * pad, f["h"] + 2 * pad], "pivot": [f["px"] + pad, f["py"] + pad]}
        z.writestr("_frames.json", json.dumps(meta, ensure_ascii=False, indent=1))
        z.writestr("_README.txt", (
            "Frames of a skill (or of all of them), one PNG per frame, with transparent room around each to draw in.\n"
            "Edit any of them (keep the file name and the canvas size: the character stands where it stands now),\n"
            "then load the edited PNGs (or this whole zip) back in the app: Animations -> Edit -> Frames.\n"
            "Frames you don't change can stay as they are or be left out.\n"))
    return buf.getvalue(), f"{cid} - {group} frames.zip" if group else f"{cid} - all frames.zip"


def placement(rec: dict, size: tuple[int, int]) -> tuple[float, float]:
    """Pivot position in a replacement of `size`."""
    w, h, pad = rec["w"], rec["h"], _pad(rec["w"], rec["h"])
    if size == (w + 2 * pad, h + 2 * pad):
        return rec["px"] + pad, rec["py"] + pad
    if size == (w, h):
        return rec["px"], rec["py"]
    return rec["px"] / w * size[0], rec["py"] / h * size[1]
