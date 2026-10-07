"""A character's sprite frames, by skill: the sprites each skill's animation clips show (read from the clips' sprite
curves, so shared bundles of early Identities / enemies don't mix characters up), and the poses of its Animator
(idle, damaged, guard…). Used by the mods' frame editor: a frame is replaced by a PNG of any size, placed by its pivot
(the character's feet), so nothing has to be found on the sprite atlases."""
from __future__ import annotations

import io
import json
import os
import re
import zipfile

from .extract import _env, _lock


def _pad(w: int, h: int) -> int:
    """Room around an exported frame for drawing beyond the original outline (a longer weapon, a cape)."""
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
    """{"groups": [{"name", "frames": [{"name", "bundle", "pid", "w", "h", "px", "py", "ppu"}]}]} — px / py: the pivot
    in pixels from the frame's bottom-left; one group per video of the skill renderer, then "Poses"."""
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
    """The frames of one skill (group "": of every skill, each frame once — skills share many) as PNGs with room to
    draw around them, and a note on how to bring them back."""
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
    """Where the pivot is in a replacement of `size`: an exported frame (with room around it), the bare frame, or
    another size scaled from the bare one."""
    w, h, pad = rec["w"], rec["h"], _pad(rec["w"], rec["h"])
    if size == (w + 2 * pad, h + 2 * pad):
        return rec["px"] + pad, rec["py"] + pad
    if size == (w, h):
        return rec["px"], rec["py"]
    return rec["px"] / w * size[0], rec["py"] / h * size[1]
