"""Skill renders with the game's own effects: a small Unity player (unity/LimbusViewer) loads the game's bundles
(read-only, from its cache) and plays an Identity's skill timelines; this module prepares its job, mixes the skill's
sounds from the FMOD banks and encodes an MP4.

The game's scripts are encrypted, but its timelines keep their field names (type trees), so what they do is read
here: dashes to the target, camera zoom / shake, sounds. Effects are switched on by the player itself (stand-in
classes with the game's class names receive the timeline data)."""
from __future__ import annotations

import glob
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time

CAB_RE = re.compile(r"cab-[0-9a-f]+")
_lock = threading.Lock()
VERSION = 22  # bump to re-render cached videos
KEEP_SECONDS = 3600  # a render is deleted an hour after it was last watched (see Renderer.prune)
WIDTH, HEIGHT = 1920, 1080  # the size of the game's own skill preview videos


def viewer_exe() -> str | None:
    """LimbusViewer.exe: next to the app when frozen, the Unity build output when run from source."""
    here = os.path.dirname(sys.executable if getattr(sys, "frozen", False) else os.path.abspath(__file__))
    for p in (os.path.join(here, "LimbusViewer", "LimbusViewer.exe"),
              os.path.join(here, "..", "unity", "LimbusViewer", "Build", "LimbusViewer.exe")):
        if os.path.isfile(p):
            return os.path.normpath(p)
    return None


def ffmpeg_exe() -> str | None:
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return shutil.which("ffmpeg")


DISCORD_MAX = 10 * 1000 * 1000  # Discord's upload limit without Nitro


def discord_gif(src: str, out: str) -> str:
    """A render as a looping GIF that Discord takes (under 10 MB): smaller and choppier steps until it fits.
    A transparent WebM stays transparent (one palette entry kept for it)."""
    ff = ffmpeg_exe()
    if not ff:
        raise RuntimeError("ffmpeg is missing")
    for width, fps in ((720, 25), (640, 20), (540, 18), (480, 15), (400, 15), (320, 12), (256, 10)):
        vf = (f"fps={fps},scale={width}:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff:reserve_transparent=1[p];"
              f"[b][p]paletteuse=dither=bayer:bayer_scale=4:alpha_threshold=128")
        subprocess.run([ff, "-v", "error", "-y", "-i", src, "-filter_complex", vf, "-loop", "0", out],
                       check=True, capture_output=True, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        if os.path.getsize(out) <= DISCORD_MAX:
            return out
    return out  # the smallest try; still over for a very long render


# ------------------------------------------------------------------ reading the timelines
def _env(path):
    from .extract import _env as env
    return env(path)


def _scripts(svc) -> dict[int, str]:
    """MonoScript path id → class name (the game keeps all of them in one bundle)."""
    cached = getattr(svc, "_mono_names", None)
    snap = svc.load_snapshot(svc.latest_snapshot_id())
    lg = next((k for k in snap["bundles"] if k.endswith("_monoscripts")), None)
    if cached and cached[0] == lg:
        return cached[1]
    names = {}
    path = svc.object_file(lg) if lg else None
    if path:
        for o in _env(path).objects:
            if o.type.name == "MonoScript":
                try:
                    names[o.path_id] = o.read().m_ClassName
                except Exception:
                    pass
    svc._mono_names = (lg, names)
    return names


_ext_lock = threading.Lock()


def _externals_cached(svc, path: str) -> set[str]:
    """_externals, remembered on disk per bundle file (its folder carries the content hash)."""
    p = os.path.join(svc.store.root, "fx_jobs", "externals.json")
    with _ext_lock:
        cache = getattr(svc, "_fx_ext", None)
        if cache is None:
            try:
                with open(p, encoding="utf-8") as f:
                    cache = json.load(f)
            except (OSError, ValueError):
                cache = {}
            svc._fx_ext = cache
        if path in cache:
            return set(cache[path])
    found = _externals(path)
    with _ext_lock:
        cache[path] = sorted(found)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w", encoding="utf-8") as f:
            json.dump(cache, f)
    return found


def _externals(path: str) -> set[str]:
    out = set()
    env = _env(path)
    for f in env.files.values():
        for sf in getattr(f, "files", {}).values():
            for ext in getattr(sf, "externals", []) or []:
                m = CAB_RE.search(ext.path.lower())
                if m:
                    out.add(m.group(0))
    return out


def _curve(c) -> list:
    """Flat [time, value, in, out, …] (the player's JSON reader takes no nested lists)."""
    return [x for k in (c or {}).get("m_Curve") or [] for x in (k["time"], k["value"], k["inSlope"], k["outSlope"])]


# Group tracks that are alternatives of each other; the game's script plays one of them. (kept, dropped) by name.
VARIANT_PAIRS = [("normal", "upgrade"), ("nonebuff", "buff"), ("win", "lose"),
                 ("cartridge", "iserode")]


def _live(objs: dict, ref: dict) -> bool:
    """Whether a track (or anything inside a group) is not muted in the data."""
    t = objs.get(ref.get("m_PathID")) if ref.get("m_FileID", 0) == 0 else None
    if t is None:
        return False
    try:
        d = t.parse_as_dict()
    except Exception:
        return False
    if d.get("m_Muted"):
        return False
    kids = d.get("m_Children") or []
    return not kids or any(_live(objs, k) for k in kids)


def variant_mutes(objs: dict, tl: dict, scripts: dict, tails: bool = False, unmute: dict | None = None) -> dict[int, str]:
    """Group tracks to switch off so only one version of a skill plays: front / back (the coin's heads / tails), the
    first of numbered variants (0, 1, 2…), and the plain version where there is an upgraded one (Upgrade, buff…). Groups the
    timeline itself has muted stay as they are, but for an E.G.O cut-in's promotion_After / promotion_Before: the game picks
    one when it plays (the data leaves either muted), and promotion_After is the look of the trailers: 20310's map walls
    stand through its cut-in there, promotion_Before keeps them off. promotion_After goes into unmute when the data has it
    muted. {track path id: name}."""
    out: dict[int, str] = {}

    def groups(refs):
        found = []
        for r in refs or []:
            t = objs.get(r.get("m_PathID")) if r.get("m_FileID", 0) == 0 else None
            if t is None:
                continue
            try:
                d = t.parse_as_dict()
            except Exception:
                continue
            if scripts.get((d.get("m_Script") or {}).get("m_PathID")) == "GroupTrack":
                kids = d.get("m_Children") or []
                # a group whose tracks are all muted in the data plays nothing: not a live alternative
                dead = bool(d.get("m_Muted")) or (kids and not any(_live(objs, k) for k in kids))
                found.append((t.path_id, d.get("m_Name") or "", dead, kids))
        return found

    def visit(refs):
        gs = groups(refs)
        live = {n.lower(): pid for pid, n, muted, _ in gs if not muted}
        names = {n.lower(): (pid, n) for pid, n, _m, _ in gs}
        drop = set()
        if "front" in live and "back" in live:
            drop.add("front" if tails else "back")
        nums = sorted((int(k), k) for k in live if k.isdigit())
        drop |= {k for _, k in nums[1:]}
        for keep, gone in VARIANT_PAIRS:
            for k in live:
                if k == gone or k.endswith("_" + gone):
                    if keep in live or k[: -len(gone)] + keep in live:
                        drop.add(k)
        for k in live:  # "Yisang_WCorp_Normal" / "Yisang_WCorp_Success"
            if k.endswith("_success") and k[: -len("success")] + "normal" in live:
                drop.add(k)
        for k, (pid, n) in names.items():
            if k.endswith("promotion_after") and k[: -len("after")] + "before" in names:
                drop.add(k[: -len("after")] + "before")
                if k not in live and unmute is not None:
                    unmute[pid] = n
                    live[k] = pid
        for k in drop:
            pid, n = names[k]
            out[pid] = n
        for pid, _n, _m, kids in gs:
            if pid not in out:
                visit(kids)

    visit(tl.get("m_Tracks"))
    return out


def _timeline_events(objs: dict, tl: dict, scripts: dict, muted: dict | None = None, unmuted: dict | None = None) -> dict:
    """What a timeline's tracks do, as plain data: moves, camera, shakes, hits, sounds."""
    ev = {"moves": [], "zooms": [], "rotates": [], "shakes": [], "hits": [], "sounds": [], "fx": [], "sturns": []}

    def sturn(si: dict) -> dict:
        """How the game moves the one hit (sturnInfo): forcePower (below 0: pulled towards the attacker), type 3 launches
        it at airborneAngle, isRotateTarget tips it over by targetRotateAngle."""
        return {"force": float(si.get("forcePower") or 0), "stun": int(si.get("sturnType") or 0),
                "angle": float(si.get("airborneAngle") or 90),
                "rot": float(si.get("targetRotateAngle") or 0) if si.get("isRotateTarget") else 0.0}
    muted = muted or {}

    def cls(o):
        try:
            d = o.parse_as_dict()
        except Exception:
            return None, {}
        return scripts.get((d.get("m_Script") or {}).get("m_PathID")), d

    def walk(refs):
        for r in refs or []:
            t = objs.get(r.get("m_PathID")) if r.get("m_FileID", 0) == 0 else None
            if t is None:
                continue
            tc, td = cls(t)
            if td.get("m_Muted") and t.path_id not in (unmuted or {}) or t.path_id in muted:
                continue
            for m in (td.get("m_Markers") or {}).get("m_Objects") or []:
                mo = objs.get(m.get("m_PathID"))
                if mo is None:
                    continue
                mc, md = cls(mo)
                at = float(md.get("m_Time") or 0)
                mi = md.get("moveInfo") or {}
                if mc and mc.startswith("SkillGiveTiming_GiveDamage"):
                    ev["last"] = max(ev.get("last") or 0.0, at)
                if mc and mc.startswith("SkillGiveTiming_TweenMove"):
                    kind = "relative" if "Relative" in mc else "target"
                    mv = {"t": at, "kind": kind, "dur": float(mi.get("duration") or 0), "ease": int(mi.get("ease") or 1),
                          "radius": float(mi.get("arriveRadius") or 0), "chaseY": bool(mi.get("isChaseY")),
                          # stop at the target's / attacker's edge, not its centre (big enemies)
                          "bodies": int(bool(mi.get("isInclude_targetRadius"))) + int(bool(mi.get("isInclude_attakcerRadius"))),
                          "pos": [0.0, 0.0, 0.0], "curve": _curve(mi.get("moveAnimationCurve"))}
                    if kind == "relative":
                        p = mi.get("movePos") or {}
                        mv["pos"] = [p.get("x", 0.0), p.get("y", 0.0), p.get("z", 0.0)]
                    wide = (md.get("moveInfo_wide") or {}).get("arriveRadius_Vector")
                    if wide:
                        mv["kind"] = "wide"
                        mv["pos"] = [wide.get("x", 0.0), wide.get("y", 0.0), wide.get("z", 0.0)]
                    ev["moves"].append(mv)
                elif mc and mc.startswith("SkillGiveTiming_GiveDamage"):
                    # (sturnInfo: how the game knocks the one hit back — forcePower 0-18, type 3 launches it at airborneAngle;
                    # info.multiHit: the damage comes in that many ticks over multiHitDuration, a saw's buzz; ratios: its
                    # share of the coin's damage)
                    si, inf = md.get("sturnInfo") or {}, md.get("info") or {}
                    ev["hits"].append(dict(sturn(si), t=at, last=bool(inf.get("isLastAttack")), multi=int(inf.get("multiHit") or 1),
                                           span=float(inf.get("multiHitDuration") or -1), ratio=float(md.get("ratios") or 1)))
                elif mc and mc.startswith("SkillGiveTiming_GiveSturn"):
                    # a shove without damage: a drag along with the attacker (force below 0), a lift, a push
                    ev["sturns"].append(dict(sturn(md.get("sturnInfo") or {}), t=at))
                elif mc and mc.startswith("CharacterAppearanceMarker_EndCheaker"):
                    ev["end"] = max(ev.get("end") or 0.0, at)  # where the game moves on (the timeline may run longer)
                elif mc and mc.startswith("CharacterAppearanceMarker_CameraShaker"):
                    ev["shakes"].append({"t": at, "dur": float(md.get("duration") or 0.2),
                                         "strength": float(md.get("strength") or 0.5), "vibrato": int(md.get("vibrato") or 20)})
            for c in td.get("m_Clips") or []:
                a = objs.get((c.get("m_Asset") or {}).get("m_PathID"))
                if a is None:
                    continue
                ac, ad = cls(a)
                start, dur = float(c.get("m_Start") or 0), float(c.get("m_Duration") or 0)
                ev["dur"] = max(ev.get("dur") or 0.0, start + dur)  # (the timeline's length: where its last clip ends)
                tmpl = ad.get("template") or {}
                if ac and ac.startswith("EffectActivate"):
                    # (when its effects come on: a clash timeline's spark is its blow, see versus pacing)
                    ev["fx"].append({"t": start, "dur": dur, "name": c.get("m_DisplayName") or ""})
                if ac and (ac.startswith(("EffectActivate", "FMOD")) or "EventReference" in ad):
                    ev["last"] = max(ev.get("last") or 0.0, start + (dur if ac.startswith("EffectActivate") else 0.0))
                if ac and ac.startswith("OnBattleCamZoomClip"):
                    z = tmpl.get("zoomInfo") or {}
                    zoom = {"t": start, "dur": dur, "size": float(z.get("size") or 0),
                            "rel": bool(z.get("isRelative", 1)), "speed": float(z.get("focusSpeed") or z.get("FocusSpeed") or 0.1),
                            "between": float(z.get("SetZoomBetweenPoint") or 0),
                            "attacker": bool(z.get("SetZoomAttacker")), "targets": bool(z.get("SetZoomTargets"))}
                    if "EndSize" in z:
                        # V2: from a start size and camera offset to an end one, over its duration (or the clip's)
                        def vec(v):
                            v = v or {}
                            return [float(v.get("x", 0)), float(v.get("y", 0)), float(v.get("z", 0))]
                        end = float(z.get("EndSize") or 0)
                        span = float(z.get("duration") or -1)
                        zoom.update(v2=True, size=end,
                                    startSize=end if z.get("UseCurrentSizeAsStart") else float(z.get("StartSize") or 0),
                                    off0=vec(z.get("StartMoveOffset")), off1=vec(z.get("EndMoveOffset")),
                                    ease=span if span > 0 else dur)
                    ev["zooms"].append(zoom)
                elif ac and ac.startswith("OnBattleCamRotateClip"):
                    ri = tmpl.get("rotateInfo") or {}
                    ang = ri.get("targetAngle") or {}
                    ev["rotates"].append({"t": start, "dur": dur, "angle": [ang.get("x", 0.0), ang.get("y", 0.0), ang.get("z", 0.0)],
                                          "speed": float(ri.get("focusRotateSpeed") or ri.get("duration") or 0.2)})
                elif ac and ac.startswith("FMOD") or "EventReference" in ad:
                    name = c.get("m_DisplayName") or ad.get("eventName") or ""
                    if name:
                        ev["sounds"].append({"t": start, "dur": dur, "name": name, "voice": "Voice" in (tc or "")})
            walk(td.get("m_Children"))

    walk(tl.get("m_Tracks"))
    for k in ev:
        if isinstance(ev[k], list):
            ev[k].sort(key=lambda e: e["t"])
    return ev


def skill_timeline(svc, cid, group: str) -> dict:
    """What happens when in one skill's video (the Edit mod's Timing): its parts, and the effects coming on, hits,
    voice lines and other sounds, camera shakes and moves, as seconds of the video. With the skill rendered the
    parts' starts are the player's (parts.txt), else the parts are laid one after another by their length."""
    job = make_job(svc, cid)
    g = next((x for x in job_groups(job) if x["name"] == group), None)
    if g is None:
        raise KeyError(group)
    starts: dict[str, list[float]] = {}
    video = svc.fx.video(cid, group)
    if video:
        try:
            with open(os.path.splitext(video)[0] + ".parts.txt", encoding="utf-8") as f:
                for line in f:
                    name, _, at = line.rstrip("\n").rpartition("\t")
                    starts.setdefault(name, []).append(float(at))
        except (OSError, ValueError):
            pass
    parts, events, off = [], [], 0.0
    for t in g["parts"]:
        ev = t.get("events") or {}
        length = float(ev.get("end") or ev.get("dur") or 0) or 0.5
        at = starts[t["name"]][0] if starts.get(t["name"]) else off
        parts.append({"name": t["name"], "start": at, "len": length})
        for key, kind in (("fx", "effect"), ("hits", "hit"), ("shakes", "shake"), ("moves", "move")):
            for e in ev.get(key) or []:
                events.append({"t": at + e["t"], "dur": e.get("dur") or 0, "kind": kind, "label": e.get("name") or ""})
        for e in ev.get("sounds") or []:
            events.append({"t": at + e["t"], "dur": e.get("dur") or 0, "kind": "voice" if e.get("voice") else "sound", "label": e.get("name") or ""})
        off = at + length
    events.sort(key=lambda e: e["t"])
    return {"rendered": bool(starts), "length": off, "parts": parts, "events": events}


def effect_still(svc, cid, name: str, v: str) -> str | None:
    """One picture that shows what a rendered effect is (the frame that draws the most, cropped to it), kept next to its
    video as "<name>.still.png"; None when the effect isn't rendered."""
    video = svc.fx.video(cid, name, v)
    if not video:
        return None
    out = os.path.splitext(video)[0] + ".still.png"
    if os.path.isfile(out) and os.path.getmtime(out) >= os.path.getmtime(video):
        return out
    from PIL import Image
    ff = ffmpeg_exe()
    tmp = tempfile.mkdtemp(prefix="still_")
    try:
        cmd = [ff, "-v", "error", "-y"] + (["-c:v", "libvpx-vp9"] if video.endswith(".webm") else []) + ["-i", video,
               "-vf", "scale=480:-2", "-pix_fmt", "rgba", os.path.join(tmp, "%04d.png")]
        try:
            subprocess.run(cmd, check=True, capture_output=True, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        except subprocess.CalledProcessError:
            return None  # (the video is still being written: asked again a moment later)
        files = sorted(glob.glob(os.path.join(tmp, "*.png")))
        best, area = None, -1
        for f in files:
            a = Image.open(f).convert("RGBA").getchannel("A").point(lambda x: 255 if x > 16 else 0)
            n = sum(a.histogram()[255:])
            if n > area:
                best, area = f, n
        if best is None:
            return None
        im = Image.open(best).convert("RGBA")
        box = im.getchannel("A").point(lambda x: 255 if x > 16 else 0).getbbox() if video.endswith(".webm") else None
        if box:
            pad = max(6, (box[2] - box[0]) // 12)
            im = im.crop((max(0, box[0] - pad), max(0, box[1] - pad), min(im.width, box[2] + pad), min(im.height, box[3] + pad)))
        im.thumbnail((320, 320))
        im.save(out, "PNG")
        return out
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def _prefabs(svc, cid: int | str) -> list[tuple[str, str]]:
    """(bundle, GameObject name) of the battle prefab: "<id>_…Appearance" for Identities, the corrosion form
    "ErosionAppearance_<id>NN" for E.G.O; for an enemy / abnormality its appearance prefab's own name."""
    import sqlite3
    db = sqlite3.connect(svc.ensure_browse())
    try:
        if isinstance(cid, str):
            return sorted(set(db.execute("select bundle, name from o where type='GameObject' and name = ? and c like ?",
                                         (cid, "%Appearance.prefab")).fetchall()))
        # (one Identity's prefab is spelled "…Appearacne" in the game)
        rows = db.execute("select bundle, name from o where type='GameObject' and (name like ? or name like ?)",
                          (f"{cid}_%Appear%", f"ErosionAppearance_{cid}%")).fetchall()
    finally:
        db.close()
    return sorted(set(rows))


# track classes the player has (Unity's Timeline package + its stand-ins); the game's own ones load as nothing there
KNOWN_TRACKS = {"AnimationTrack", "GroupTrack", "ActivationTrack", "ControlTrack", "AudioTrack", "SignalTrack",
                "PlayableTrack", "EffectActivateTimelineTrack"}


def _sig(objs: dict, tl: dict, scripts: dict) -> list[int]:
    """[tracks, clips] of a timeline counted over the track classes the player knows — tells same-named timelines
    of different Identities (shared bundles) apart there."""
    tracks = clips = 0
    todo = list(tl.get("m_Tracks") or [])
    while todo:
        r = todo.pop()
        t = objs.get(r.get("m_PathID")) if r.get("m_FileID", 0) == 0 else None
        if t is None:
            continue
        try:
            td = t.parse_as_dict()
        except Exception:
            continue
        todo += td.get("m_Children") or []
        if scripts.get((td.get("m_Script") or {}).get("m_PathID")) not in KNOWN_TRACKS:
            continue
        tracks += 1
        clips += len(td.get("m_Clips") or [])
    return [tracks, clips]


TIMELINE_NAME = re.compile(r"Time?line", re.I)  # "Timline" in Faust's first Identity


def _draws_sprites(objs: dict, tl: dict) -> bool:
    """Whether the timeline's animation clips swap sprites (the character is drawn frame by frame then; otherwise a
    game script plays its Spine skeleton)."""
    todo = list(tl.get("m_Tracks") or [])
    while todo:
        r = todo.pop()
        t = objs.get(r.get("m_PathID")) if r.get("m_FileID", 0) == 0 else None
        if t is None:
            continue
        try:
            td = t.parse_as_dict()
        except Exception:
            continue
        todo += td.get("m_Children") or []
        clips = [(td.get("m_InfiniteClip") or {}).get("m_PathID")]
        for c in td.get("m_Clips") or []:
            a = objs.get((c.get("m_Asset") or {}).get("m_PathID"))
            try:
                clips.append((a.parse_as_dict().get("m_Clip") or {}).get("m_PathID") if a else None)
            except Exception:
                pass
        for pid in clips:
            o = objs.get(pid) if pid else None
            if o is not None and o.type.name == "AnimationClip":
                try:
                    if o.read().m_ClipBindingConstant.pptrCurveMapping:
                        return True
                except Exception:
                    pass
    return False


DAMAGE_RE = re.compile(r"dmg|damage", re.I)


def _target_tracks(objs: dict, tl: dict) -> list[str]:
    """Animation tracks the game binds to the target at runtime: their clips only show damage sprites (in the prefab
    they point at the character itself, whose skill pose they would then cover)."""
    out = []
    todo = list(tl.get("m_Tracks") or [])
    while todo:
        r = todo.pop()
        t = objs.get(r.get("m_PathID")) if r.get("m_FileID", 0) == 0 else None
        if t is None:
            continue
        try:
            td = t.parse_as_dict()
        except Exception:
            continue
        todo += td.get("m_Children") or []
        if "m_InfiniteClip" not in td:
            continue
        clips = [(td.get("m_InfiniteClip") or {}).get("m_PathID")]
        for c in td.get("m_Clips") or []:
            a = objs.get((c.get("m_Asset") or {}).get("m_PathID"))
            try:
                clips.append((a.parse_as_dict().get("m_Clip") or {}).get("m_PathID") if a else None)
            except Exception:
                pass
        names = set()
        for pid in clips:
            o = objs.get(pid) if pid else None
            if o is None or o.type.name != "AnimationClip":
                continue
            try:
                for ref in o.read().m_ClipBindingConstant.pptrCurveMapping:
                    so = objs.get(ref.path_id) if ref.file_id == 0 else None
                    names.add((so.peek_name() if so else "") or "?")
            except Exception:
                pass
        if names and all(DAMAGE_RE.search(n) for n in names):
            out.append(td.get("m_Name") or "")
    return out


def _pptrs(v, out: set):
    if isinstance(v, dict):
        if v.get("m_FileID") == 0 and "m_PathID" in v:
            out.add(v["m_PathID"])
        for x in v.values():
            _pptrs(x, out)
    elif isinstance(v, list):
        for x in v:
            _pptrs(x, out)


_SINNER_KEYS = ("yisang", "faust", "donquixote", "ryoshu", "meursault", "honglu", "heathcliff", "ishmael", "rodion",
                "sinclair", "outis", "gregor")


def _words(name: str) -> set[str]:
    """Words of an object name, without vowels (the game spells them loosely: LeNoir / LaNoir / Lanoir → lnr; Philip /
    Pilip → plp)."""
    parts = re.findall(r"[A-Z]?[a-z]+|[A-Z]+(?![a-z])|\d+", re.sub(r"[^A-Za-z0-9]+", " ", name))
    return {re.sub(r"[aeiouy]", "", p.lower().replace("ph", "p")) for p in parts if len(p) >= 3}


def battle_effects(svc, cid: int, prefab: str) -> list[dict]:
    """The buff, aura and field effects the game plays for a character out of other bundles: static-data/battle-effect
    maps a keyword (which one plays when is up to the game's encrypted scripts) to an effect prefab. Taken here: those
    whose prefab shares a word with the character's battle prefab name besides the Sinner's, e.g. 10315
    "10315_Donquixote_LeNoir_CaptainAppearance" → "Fx_PC_Cp10_Donquixote_LanoirCaptain_BG_Team_1" (its field effect),
    10416 "10416_Ryoshu_LeNoirAppearance" → "Fx_Mon_Cp10_LaNoir_Realisation" (the Le Noir aura); not those named after
    another Sinner, nor story-mode (RPG) ones. A boss's effect (Fx_Mon_…) only when the character's own skills or
    passives give the buff it is played for: 10416 has the Le Noir boss's Realisation and NoirSuit, while the boss's
    NoirShield / field effects (named LanoirCaptain, like 10315's) are no Sinner's. An effect played for a buff of its
    own is taken whatever its name. [{"name", "asset", "bundle", "keyword"}], the asset as the bundle addresses it."""
    import sqlite3
    if not isinstance(cid, int) or not 10000 <= cid < 30000:
        return []
    s = int(str(cid)[1:3])
    if not 1 <= s <= len(_SINNER_KEYS):
        return []
    sinner = _SINNER_KEYS[s - 1]
    stem = re.sub(r"(?i)appear\w*$", "", prefab.rsplit("/", 1)[-1].rsplit(".", 1)[0])
    own = _words(stem) - _words(sinner) - {"bs"}
    db_path = svc.ensure_browse()
    if not db_path or not own:
        return []
    out, seen = [], set()

    buffs = own_buffs(svc, cid)

    def ours(name: str, addr: str, keyword: str = "") -> bool:
        if not name or name in seen or "/rpg/" in addr.lower():
            return False
        if keyword in buffs:
            return True
        flat = re.sub(r"[^a-z]", "", name.lower())
        return bool(own & _words(name)) and not re.match(r"(?i)fx_mon_", name) \
            and not any(k in flat for k in _SINNER_KEYS if k != sinner)

    entries = [e for doc in svc.static_tables(["battle-effect"]).get("battle-effect", {}).values()
               for e in (doc.get("list") if isinstance(doc, dict) else doc) or [] if isinstance(e, dict)]
    # a boss effect played for one of the character's buffs brings the rest of its set (same name but the last word):
    # 10416's Realisation and NoirSuit (Fx_Mon_Cp10_LaNoir_Realisation / _Shield) bring _ShieldAlly, which the game
    # shows on it too (its keyword LanoirAllyShieldEffect is up to the scripts)
    families = {n.rsplit("_", 1)[0] for e in entries if (e.get("keyword") or "") in buffs
                for n in [(e.get("address") or "").rsplit("/", 1)[-1].rsplit(".", 1)[0]] if re.match(r"(?i)fx_mon_", n)}
    db = sqlite3.connect(db_path)
    try:
        for e in entries:
            addr = e.get("address") or ""
            name = addr.rsplit("/", 1)[-1].rsplit(".", 1)[0]
            if not ours(name, addr, e.get("keyword") or "") and not (name not in seen and name.rsplit("_", 1)[0] in families):
                continue
            # (the table's path may leave out a folder the bundle has: …/Cp10/LaNoir_Fanatic/ vs …/Cp10/Cp10_1/LaNoir_Fanatic/)
            row = db.execute("select bundle, c from o where lower(c) = lower(?) limit 1", (addr,)).fetchone() \
                or db.execute("select bundle, c from o where lower(c) like ? limit 1", (f"%/{name.lower()}.prefab",)).fetchone()
            if row:
                seen.add(name)
                out.append({"name": name, "asset": row[1], "bundle": row[0], "keyword": e.get("keyword", "")})
        # effect prefabs of the buff / battle-effect bundles the table doesn't list (10416's own
        # Fx_PC_Cp10_Ryoshu_LaNoirContemporary_Realisation)
        for bundle, c in db.execute("select distinct bundle, c from o where c like 'Assets/Prefab/Effect/%.prefab' "
                                    "and (bundle like '%battleeffect%' or bundle like '%\\_buf\\_%' escape '\\' or bundle like '%buff%')"):
            name = c.rsplit("/", 1)[-1].rsplit(".", 1)[0]
            if ours(name, c):
                seen.add(name)
                out.append({"name": name, "asset": c, "bundle": bundle, "keyword": ""})
        # effects only an effect list (a ScriptableObject of a bundle) names, by label: a buff's key (the game's
        # ActivateBuffEffect* abilities show the effect labelled with the buff's id) or ability (ShinEffect, an
        # ActivateBuffEffectSkin, shows the one labelled "Shin"), or an object named after the character like the ones above (two words in
        # common: one alone, "Ring" or "Disciple", is shared with other factions' effects)
        keys = buffs | buff_abilities(svc, buffs)
        for label, name, bundle, pid in effect_lists(svc):
            if name in seen or name == "?":
                continue
            if label in keys or label + "Effect" in keys or ours(name, "", "") and len(own & _words(name)) >= 2:
                seen.add(name)
                out.append({"name": name, "asset": f"Assets/Prefab/Effect/Added/{name}.prefab", "bundle": bundle, "keyword": label,
                            "pid": pid})
    finally:
        db.close()
    return out


def buff_abilities(svc, ids) -> set[str]:
    """The abilities of the given buffs (static data)."""
    out = set()
    for doc in svc.static_tables(["buff"]).get("buff", {}).values():
        for e in (doc.get("list") if isinstance(doc, dict) else doc) or []:
            if isinstance(e, dict) and e.get("id") in ids:
                out |= {a.get("ability") for a in e.get("list") or [] if isinstance(a, dict)}
    return out


def effect_lists(svc) -> list[tuple]:
    """(label, prefab name, bundle, path id) of every effect list (EffectList_*.asset): the game's buff-effect labels for
    prefabs the bundles keep without an address of their own."""
    sid = svc.latest_snapshot_id()
    cached = getattr(svc, "_effect_lists", None)
    if cached and cached[0] == sid:
        return cached[1]
    import sqlite3
    path = os.path.join(svc.data_dir, "effect_lists.json")
    try:
        with open(path, encoding="utf-8") as f:
            doc = json.load(f)
        if doc.get("sid") == sid:
            svc._effect_lists = (sid, [tuple(x) for x in doc["list"]])
            return svc._effect_lists[1]
    except (OSError, ValueError):
        pass
    db = sqlite3.connect(svc.ensure_browse())
    try:
        bundles = sorted({r[0] for r in db.execute("select bundle from o where c like '%/EffectList%.asset'")})
    finally:
        db.close()
    out = []
    for b in bundles:
        f = svc.object_file(b)
        if not f:
            continue
        env = _env(f)
        objs = {o.path_id: o for o in env.objects}
        for o in env.objects:
            if o.type.name != "MonoBehaviour":
                continue
            try:
                tt = o.read_typetree()
            except Exception:
                continue
            for e in tt.get("Effects_Label") or []:
                ref = e.get("effectObj") or {}
                g = objs.get(ref.get("m_PathID")) if not ref.get("m_FileID") else None
                if g is not None and g.type.name == "GameObject" and e.get("label"):
                    out.append((e["label"], g.read().m_Name, b, g.path_id))
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"sid": sid, "list": out}, f)
    svc._effect_lists = (sid, out)
    return out


def addressed_bundle(svc, logical: str, items: list[tuple[int, str]]) -> str:
    """A copy of a bundle (in data/fx_patched) whose container also lists prefabs the bundle keeps without an address of
    its own (only an effect list refers to them), so the player can load them by their (pid, address). Made once."""
    import hashlib
    src = svc.object_file(logical)
    d = os.path.join(svc.data_dir, "fx_patched")
    key = hashlib.md5(json.dumps(sorted(items)).encode()).hexdigest()[:10]
    dst = os.path.join(d, f"{logical}_{os.path.getsize(src)}_{key}.bundle")
    if not os.path.isfile(dst):
        import UnityPy
        os.makedirs(d, exist_ok=True)
        with open(src, "rb") as f:
            env = UnityPy.load(f.read())
        ab = next(o for o in env.objects if o.type.name == "AssetBundle")
        tt = ab.read_typetree()
        for pid, address in items:
            tt["m_Container"].append([address, {"preloadIndex": 0, "preloadSize": 0, "asset": {"m_FileID": 0, "m_PathID": pid}}])
        ab.save_typetree(tt)
        with open(dst + ".tmp", "wb") as f:
            f.write(env.file.save(packer="lz4"))
        os.replace(dst + ".tmp", dst)
    return dst


def patched_bundles(svc, extra: list[dict]) -> dict[str, str]:
    """logical bundle → its patched copy, for the extra effects that need one."""
    by: dict[str, list] = {}
    for x in extra:
        if "pid" in x:
            by.setdefault(x["bundle"], []).append((x["pid"], x["asset"]))
    return {lg: addressed_bundle(svc, lg, items) for lg, items in by.items()}


def own_buffs(svc, cid: int) -> set[str]:
    """The buffs a character's own skills and passives give or check (static data), and those these lead to:
    10416 → Realisation, NoirSuit, Charge, …"""
    t = svc.static_tables(["skill", "passive", "personality-passive", "buff"])
    # a buff the descriptions name in brackets ("gain [ObsessionAndGreedRodion]") counts too: the tables of some Identities
    # (the Nursefathers) don't give it
    try:
        unit = next((u for u in svc.unit_db()["ids"] if u["id"] == cid), None)
    except Exception:
        unit = None
    named = set(re.findall(r"\[([A-Za-z0-9_]+)\]", json.dumps(unit, ensure_ascii=False))) if unit else set()

    def rows(folder):
        for doc in t.get(folder, {}).values():
            for e in (doc.get("list") if isinstance(doc, dict) else doc) or []:
                if isinstance(e, dict):
                    yield e

    def walk(o, strs: set, ints: set | None = None):
        if isinstance(o, str):
            strs.add(o)
        elif isinstance(o, int) and ints is not None:
            ints.add(o)
        elif isinstance(o, dict):
            for v in o.values():
                walk(v, strs, ints)
        elif isinstance(o, list):
            for v in o:
                walk(v, strs, ints)

    key, strs, pids = str(cid), set(), set()
    for e in rows("skill"):
        if str(e.get("id", "")).startswith(key):
            walk(e, strs)
    for e in rows("personality-passive"):
        if e.get("personalityID") == cid:
            walk(e, set(), pids)
    for e in rows("passive"):
        if e.get("id") in pids:
            walk(e, strs)
    buffs = {}
    for e in rows("buff"):
        buffs.setdefault(e.get("id"), e)
    seen, todo = set(), [x for x in strs | named if x in buffs]
    while todo:
        b = todo.pop()
        if b in seen:
            continue
        seen.add(b)
        more = set()
        walk(buffs[b], more)
        todo += [x for x in more if x in buffs and x not in seen]
    return seen


def bundle_closure(svc, roots: list[str]) -> list[str]:
    """The bundles and every bundle they reference (logical names)."""
    idx = svc.cab_index()
    seen, todo = [], list(roots)
    while todo:
        lg = todo.pop()
        if lg in seen:
            continue
        seen.append(lg)
        path = svc.object_file(lg)
        if not path:
            continue
        for cab in _externals_cached(svc, path):
            dep = idx.get(cab)
            if dep and dep not in seen:
                todo.append(dep)
    return seen


def make_job(svc, cid: int, tails: bool = False, view: str | None = None) -> dict:
    """make_job_uncached, kept on disk per snapshot / Identity / coin side / cut-in (it reads a lot of bundles)."""
    p = os.path.join(svc.store.root, "fx_jobs", f"{svc.latest_snapshot_id()}_v{VERSION}",
                     f"{view or cid}{'_tails' if tails else ''}.json")
    try:
        with open(p, encoding="utf-8") as f:
            job = json.load(f)
        # (made before timelines had their length, effect times or knockbacks: made again)
        if not job.get("timelines") or "sturns" in job["timelines"][0]["events"] and all(
                "multi" in h for t in job["timelines"] for h in t["events"]["hits"]):
            return job
    except (OSError, ValueError):
        pass
    job = make_job_uncached(svc, cid, tails, view)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(job, f)
    return job


def bundle_deps(svc, root_lg: str) -> list[str]:
    """A bundle and every bundle it references (logical names, the bundle first)."""
    idx = svc.cab_index()
    seen, todo = [], [root_lg]
    while todo:
        lg = todo.pop()
        if lg in seen:
            continue
        seen.append(lg)
        path = svc.object_file(lg)
        if not path:
            continue
        for cab in _externals_cached(svc, path):
            dep = idx.get(cab)
            if dep and dep not in seen:
                todo.append(dep)
    return seen


MAP_DIR = "/BattleMapPresets/BattleMapPreset_"


def battle_maps(svc) -> list[dict]:
    """The stages battles are fought on (Versus backgrounds): [{"name": "Cp9_Thumbfinger", "bundle", "prefab"}…]."""
    import sqlite3
    path = svc.ensure_browse()
    if not path:
        return []
    db = sqlite3.connect(path)
    try:
        rows = db.execute("select distinct bundle, c from o where c like ?", (f"%{MAP_DIR}%.prefab",)).fetchall()
    finally:
        db.close()
    out = {}
    for b, c in rows:
        name = c.rsplit(MAP_DIR, 1)[-1][:-len(".prefab")]
        # (a story scene's copy can't be loaded by name: the map's own bundle first)
        if name not in out or "map" in b and "map" not in out[name]["bundle"]:
            out[name] = {"name": name, "bundle": b, "prefab": c}
    return sorted(out.values(), key=lambda m: m["name"].lower())


def make_job_uncached(svc, cid: int, tails: bool = False, view: str | None = None) -> dict:
    """Bundles (the battle prefab's and every bundle it references, current versions only), the prefab's path and
    the skill timelines its components point at, with their events. `view`: an E.G.O cut-in prefab instead (see
    skill_views), whose timelines are played in the order its script lists them."""
    found = _prefabs(svc, cid) if not view else [r for r in _skill_view_rows(svc, cid) if r[1] == view]
    # the battle prefab is addressable in its own bundle; story-scene bundles (…_produce_…) keep copies that aren't
    found.sort(key=lambda r: ("produce" in r[0], r[0]))
    root_lg = go_name = prefab = None
    for lg, name in found:
        path = svc.object_file(lg)
        if not path:
            continue
        for o in _env(path).objects:
            if o.type.name == "AssetBundle":
                prefab = next((c for c, _i in o.read().m_Container
                               if c.rsplit("/", 1)[-1].lower() == name.lower() + ".prefab"), None)
                break
        if prefab:
            root_lg, go_name = lg, name
            break
    if not prefab:
        raise ValueError(f"no battle prefab for {cid}")
    seen = bundle_deps(svc, root_lg)
    scripts = _scripts(svc)
    env = _env(svc.object_file(root_lg))
    objs = {o.path_id: o for o in env.objects}
    # the prefab's GameObjects → every object their components point at (the game's appearance script lists the
    # character's timelines; shared bundles of early Identities hold other characters' timelines too)
    root = next((o for o in objs.values() if o.type.name == "GameObject" and o.peek_name() == go_name), None)
    gos, stack = set(), []
    if root is not None:
        stack.append(root.read())
    while stack:
        g = stack.pop()
        gos.add(g.object_reader.path_id)
        for c in g.m_Components:
            co = objs.get(c.path_id)
            if co is not None and co.type.name == "Transform":
                for ch in co.read().m_Children:
                    tr = objs.get(ch.path_id)
                    if tr is not None:
                        go = objs.get(tr.read().m_GameObject.path_id)
                        if go is not None:
                            stack.append(go.read())
    # the pose between a skill's clips (the Animator's default state): the "…_Default" clip of its controller
    default_clip = ""
    if root is not None:
        for c in root.read().m_Components:
            co = objs.get(c.path_id)
            if co is None or co.type.name != "Animator":
                continue
            try:
                ctl = objs.get(co.read().m_Controller.path_id)
                names = [objs[x.path_id].peek_name() for x in ctl.read().m_AnimationClips if x.path_id in objs] if ctl else []
            except Exception:
                names = []
            default_clip = next((n for n in names if n and n.lower().endswith("_default")), "") or                 next((n for n in names if n and "default" in n.lower()), "")
    refs: set = set()
    for o in objs.values():
        if o.type.name in ("MonoBehaviour", "PlayableDirector"):
            try:
                d = o.parse_as_dict()
            except Exception:
                continue
            if (d.get("m_GameObject") or {}).get("m_PathID") in gos:
                _pptrs({k: v for k, v in d.items() if k not in ("m_GameObject", "m_Script")}, refs)
    timelines = []
    for o in objs.values():
        if o.type.name != "MonoBehaviour":
            continue
        try:
            name = o.peek_name() or ""
        except Exception:
            continue
        # a TimelineAsset by its fields, not its name: the game also names them "…Timline…" or "…_Parrying_1"
        try:
            node = o.serialized_type.node if o.serialized_type else None
        except Exception:
            node = None
        if node is not None:
            if not any(c.m_Name == "m_Tracks" for c in node.m_Children or []):
                continue
        elif not TIMELINE_NAME.search(name) or "Track" in name or "Clip" in name:
            continue
        try:
            d = o.parse_as_dict()
        except Exception:
            continue
        if "m_Tracks" not in d:
            continue
        unmute: dict[int, str] = {}
        mute = variant_mutes(objs, d, scripts, tails, unmute)
        timelines.append({"name": name, "pid": o.path_id, "sig": _sig(objs, d, scripts), "own": o.path_id in refs,
                          "sprites": _draws_sprites(objs, d), "targetTracks": _target_tracks(objs, d),
                          "mute": sorted(set(mute.values())), "unmute": sorted(set(unmute.values())),
                          "events": _timeline_events(objs, d, scripts, mute, unmute)})
    if any(t["own"] for t in timelines):
        timelines = [t for t in timelines if t["own"]]
    job = {"id": cid if isinstance(cid, int) else 0, "prefab": prefab, "bundles": [svc.object_file(lg) for lg in seen if svc.object_file(lg)],
           "defaultClip": default_clip, "timelines": timelines}
    if not view and root is not None:
        job.update(buff_states(objs, root, scripts))
    if view and root is not None:
        # the cut-in's script lists its timelines: an intro, then one per coin
        seq = []
        for c in root.read().m_Components:
            co = objs.get(c.path_id)
            if co is None or co.type.name != "MonoBehaviour":
                continue
            try:
                d = co.parse_as_dict()
            except Exception:
                continue
            if "_timelineList" not in d:  # BattleSkillViewEGOBase_V3 and the per-E.G.O scripts built on it
                continue  # (earlier cut-ins have one timeline: the director's, below)
            for ref in [d.get("_timeline_Intro")] + list(d.get("_timelineList") or []) + [d.get("_timeline_Outtro")]:
                ref = ref or {}
                o = objs.get(ref.get("m_PathID")) if ref.get("m_FileID", 0) == 0 else None
                if o is not None:
                    seq.append(o.peek_name())
        if not seq:
            for c in root.read().m_Components:
                co = objs.get(c.path_id)
                if co is not None and co.type.name == "PlayableDirector":
                    ref = co.parse_as_dict().get("m_PlayableAsset") or {}
                    o = objs.get(ref.get("m_PathID")) if ref.get("m_FileID", 0) == 0 else None
                    if o is not None:
                        seq.append(o.peek_name())
        job.update(view=view, sequence=seq)
    return job


def _skill_view_rows(svc, cid: int) -> list[tuple[str, str]]:
    import sqlite3
    db = sqlite3.connect(svc.ensure_browse())
    try:
        return sorted(set(db.execute("select bundle, name from o where type='GameObject' and name like ?",
                                     (f"SkillViewEGO_{cid}%",)).fetchall()))
    finally:
        db.close()


def skill_views(svc, cid: int) -> list[str]:
    """An E.G.O's cut-ins: SkillViewEGO_<id>11 its use, …21 the corroded one (each a scene of its own, see the Viewer)."""
    # (story scenes keep copies in their own bundles, which can't be loaded by name)
    return sorted({n for b, n in _skill_view_rows(svc, cid) if re.fullmatch(rf"SkillViewEGO_{cid}\d\d", n) and "produce" not in b})


# (the game also spells it "Timline", and some Identities have no word at all: Faust Index "…_S1_1", "…_S1_2")
SKILL_RE = re.compile(r"^(.*_S(\d+))(?:_Time?line[ _]?|_(?=\d))(\d+(?:_\d+)?)?_?$")


def buff_states(objs: dict, root, scripts: dict) -> dict:
    """What the character's buffs change on it in battle, for the player to show one level of: the root's
    CharacterAppearanceUpdateBuffState components (UB_<id>, ShaderLevelBuffState…) list ranks, each a buff and the count
    it needs, the objects it switches on (by child-index path from the root: names repeat) and, for a
    ShaderLevelBuffState, the material keyword (_LEVEL_LV_1…) it sets; the attack effects with a
    CharacterAttackEffectUpdateBuffState hold a version per level (children r_1, r_2…). {"buffStates": […],
    "buffLevels": the number of levels} or {} when there are none. 11216 → Stigma Workshop Hand stacks 10 / 20 / 30
    (Stig_1 / Stig_2 / Stig_Max), its sword's shader levels 1–3 and its slashes' r_1–r_3."""
    paths, parent_of = {}, {}

    def walk(g, path):
        paths[g.object_reader.path_id] = path
        for c in g.m_Components:
            co = objs.get(c.path_id)
            if co is not None and co.type.name == "Transform":
                for i, ch in enumerate(co.read().m_Children):
                    tr = objs.get(ch.path_id)
                    go = objs.get(tr.read().m_GameObject.path_id) if tr is not None else None
                    if go is not None:
                        parent_of[go.path_id] = g.object_reader.path_id
                        walk(go.read(), f"{path}/{i}" if path else str(i))

    walk(root.read(), "")
    states, levels, scripts_on = [], 0, {}
    for o in objs.values():
        if o.type.name != "MonoBehaviour":
            continue
        try:
            d = o.read_typetree()
        except Exception:
            continue
        go = (d.get("m_GameObject") or {}).get("m_PathID")
        if go not in paths:
            continue
        name = scripts.get((d.get("m_Script") or {}).get("m_PathID"), "")
        scripts_on.setdefault(go, set()).add(name)
        # (only the root's: a stray copy sits on one of 11216's effects)
        if go != root.path_id or "_buffInfo" not in d:
            continue
        ranks = []
        for r in d.get("_buffInfo") or []:
            eff = [e.get("effect") or {} for e in r.get("ActiveEffect") or []]
            eff = [x["m_PathID"] for x in eff if not x.get("m_FileID") and x.get("m_PathID") in paths]
            ranks.append({"keyword": r.get("buffKeywordName") or "", "count": int(r.get("buffCount") or 0),
                          "effects": [paths[x] for x in eff], "names": [objs[x].peek_name() for x in eff]})
        lv = d.get("shaderLevelEffect") or {}
        if not any(r["effects"] for r in ranks) and not lv.get("levelKeywords"):
            continue
        states.append({"script": name, "ranks": ranks, "levelProperty": lv.get("levelPropertyName") or "",
                       "levelKeywords": list(lv.get("levelKeywords") or [])})
        levels = max(levels, len(ranks))
    # the attack effects' versions per level: r_<n> under an object holding a CharacterAttackEffectUpdateBuffState
    holders = {g for g, n in scripts_on.items() if "CharacterAttackEffectUpdateBuffState" in n}
    variants = 0
    for g in paths:
        m = re.fullmatch(r"r_(\d+)", objs[g].peek_name() or "", re.I)
        p = parent_of.get(g) if m else None
        while p is not None and p not in holders:
            p = parent_of.get(p)
        if p is not None:
            variants = max(variants, int(m.group(1)))
    levels = max(levels, variants)
    return {"buffStates": states, "buffLevels": levels, "buffVariants": variants} if levels > 1 else {}


def buff_levels(svc, cid) -> dict:
    """The buff levels a character's renders can show (see buff_states), for the app: {"levels": [what each shows…],
    "notes": {effect: the buff that switches it on}}; {"levels": []} for one without."""
    sid = svc.latest_snapshot_id()
    memo = svc.__dict__.setdefault("_buff_levels", {})
    if (sid, cid) in memo:
        return memo[(sid, cid)]
    from . import units
    try:
        job = make_job(svc, cid)
    except ValueError:
        job = {}
    n = job.get("buffLevels") or 0
    names = getattr(svc, "_keyword_names", None)
    if names is None and n:
        loc = os.path.join(svc.game.data or "", "Assets", "Resources_moved", "Localize", "en")
        names = svc._keyword_names = {k: (r.get("name") or "").strip() for k, r in units._load(loc, r"EN_BattleKeywords.*\.json$").items()}

    # (11216's three steps are all "Light of Daybreak": then the game's ids tell them apart)
    used = {r["keyword"] for s in job.get("buffStates") or [] for r in s["ranks"] if r["keyword"]}
    alike = {k for k in used if sum((names.get(k) or k) == (names.get(o) or o) for o in used) > 1}

    def need(r):
        if not r["keyword"]:
            return ""
        name = names.get(r["keyword"]) or r["keyword"]
        if r["keyword"] in alike:
            name += f" ({r['keyword']})"
        return f"{name} {r['count']}+" if r["count"] > 1 else name

    levels, notes = [], {}
    for lv in range(n if n > 1 else 0):
        got = []
        for s in job["buffStates"]:
            r = s["ranks"][min(lv, len(s["ranks"]) - 1)]
            what = [x for x in r["names"]] + ([f"material {s['levelKeywords'][min(lv, len(s['levelKeywords']) - 1)]}"]
                                              if s["levelKeywords"] else [])
            got.append(f"{need(r) or s['script'].replace('CharacterAppearance', '')}: {', '.join(what) or 'nothing'}")
        if job.get("buffVariants", 0) > 1:
            got.append(f"attack effects: version r_{min(lv + 1, job['buffVariants'])}")
        levels.append(got)
    for s in job.get("buffStates") or []:
        for i, r in enumerate(s["ranks"]):
            for x in r["names"]:
                notes.setdefault(re.sub(r"[^\w.-]", "_", x), need(r) or f"{s['script'].replace('CharacterAppearance', '')} level {i}")
    memo[(sid, cid)] = out = {"levels": levels, "notes": notes}
    return out


def job_groups(job: dict) -> list[dict]:
    """The videos a job makes: a cut-in is one (its timelines in its script's order), a battle prefab one per skill."""
    if job.get("view"):
        by = {t["name"]: t for t in job["timelines"]}
        parts = [by[n] for n in job.get("sequence") or [] if n in by]
        return [{"name": job["view"], "parts": parts}] if parts else []
    # skills first, in order (they're what people open first), then clashes and other variants
    return sorted(group_timelines(job["timelines"]), key=lambda g: (
        0 if re.search(r"_S\d+$", g["name"]) else 1,
        int(re.search(r"_S(\d+)", g["name"]).group(1)) if re.search(r"_S(\d+)", g["name"]) else 0, g["name"]))


MAX_ROUNDS = 99  # clashes in one Versus video
# a clash timeline: "…_Parrying_Timeline_2", also "Parrying_0" (early Identities), "…_Parrying_Timeline 1",
# "…_Parrying_Range_Timeline", "…_Parry_TimeLine" and the typos "Parrrying" / "Parryng" / "Parriyng";
# not a lost or won clash, nor an effect
PARRY_RE = re.compile(r"Parr+i?y", re.I)
PARRY_NOT = re.compile(r"Lose|Win|Complete|Effect|Default", re.I)


def is_clash(name: str) -> bool:
    return bool(PARRY_RE.search(name or "")) and not PARRY_NOT.search(name or "")


# the base of a clash fight (Versus mode "clash"): unless the spec says otherwise (the Versus page's Debug row sends only
# what was changed), guards and evades, counters, whole skills up to 5 s, both fighting with their skills' coins as well as
# clash animations ("Skills instead of clash animations"), knockback 2x, the game's UI sounds and cinematic bars, hit
# effects (camera push-in, flash, slow motion at the impact, hit-stop, the last blow in slow motion), wind-ups cut,
# leftover effects cut off at each round (not faded: a series has no stand-offs to fade in)
CLASH_BASE = dict(defend=True, counter=True, bursts=True, burstMax=5, lskills=True, rskills=True, kbscale=2, uisfx=True, bars=True,
                  trim=True, clean=True, punch=True, flash=True, ramp=True, hitstop=True, slowmo=True, fade=False)


def clash_base(spec: dict) -> dict:
    """The spec of a clash fight with its base switches (CLASH_BASE) as defaults: whatever the spec sets wins."""
    return dict(CLASH_BASE, **spec) if spec.get("mode") == "clash" else spec


def versus_job(svc, spec: dict) -> tuple[dict, list[dict]]:
    """Two characters on one stage (the Versus page). spec: {"left", "right": id or enemy prefab name, "skill": the
    left one's skill (a job_groups name), "mode": "target" (the right one takes the hits, with its own idle and hit
    poses) or "clash" (`rounds` clashes, both playing their clash timelines at once, then the `winner`'s skill —
    "rskill" for the right one — on the other)}. One video, "Versus"."""
    spec = clash_base(spec)
    if spec.get("team"):
        return versus_team_job(svc, spec)
    left, right = spec["left"], spec["right"]
    L, R = make_job(svc, left), make_job(svc, right)
    gl = next((g for g in job_groups(L) if g["name"] == spec.get("skill")), None)
    if gl is None:
        raise ValueError("pick a skill of the left one")
    entries, partners = [], []
    import random
    rnd = random.Random(int(spec.get("seed") or 0))
    w = int(spec.get("winner") or 0)
    winner = (rnd.randrange(2) if w == 2 else 1 if w == 1 else 0) if spec.get("mode") == "clash" else 0
    # every clash fight is the fight engine's (limbusdm/versus_engine.py): it decides the whole fight, the player acts
    # its script out. "pace" (Exchanges): exchanges of clashes, then a skill lands or both spring apart; else a series
    # of clash rounds, then the winner's last skill. "loop": the video's last frame leads into its first (Exchanges)
    loop = spec.get("mode") == "clash" and bool(spec.get("loop"))
    pace = spec.get("mode") == "clash"
    scripted = None
    if pace:
        from . import versus_engine as E
        fa = E.fighter(svc, left, spec.get("lname") or "", bool(spec.get("lskills")))
        fb = E.fighter(svc, right, spec.get("rname") or "", bool(spec.get("rskills")))
        if not fa["anims"] and not fb["anims"]:
            raise ValueError("neither of them has clash animations")
        fight = E.simulate(fa, fb, int(spec.get("seed") or 0),
                           dict(rounds=max(1, min(MAX_ROUNDS, int(spec.get("rounds") or 1))), defend=spec.get("defend"),
                                counter=spec.get("counter"), bursts=spec.get("bursts"), burstMax=burst_max(spec), kbscale=kb_scale(spec),
                                winner=None if w == 2 else w, flow="" if spec.get("pace") or loop else "series",
                                randskill=spec.get("randskill"), finals=(spec.get("skill"), spec.get("rskill"))))
        scripted = E.script(fight, fa, fb, spec)
        winner = fight["winner"]
        if loop:
            scripted = [e for e in scripted if not e.get("final")]
        for e in scripted:
            pt = e.pop("partnerTl", None)
            if pt is not None:
                partners.append(pt)
                e.update(hasPartner=True, partner=len(partners) - 1)
        entries = scripted
        if loop and entries:
            entries[-1].update(standoff=round(rnd.uniform(0.4, 0.7), 3), closing=True)
        quiet_clashes(svc, entries)
    if loop or scripted is not None:  # (a loop ends in the stand-off it started in; the engine's script has its own end)
        final = []
    else:
        final = gl["parts"]
    if pace:
        final = [dict(t, events=split_hits(t["events"])) for t in final]
        for e in entries:
            e["events"] = split_hits(e["events"])
    entries += [dict(t, who=winner, trim=k == 0, final=True) for k, t in enumerate(final)]
    if scripted is not None:
        final = [e for e in entries if e.get("final")]
    job = dict(L, bundles=list(dict.fromkeys(L["bundles"] + R["bundles"])), partners=partners,
               opponent={"prefab": R["prefab"], "defaultClip": R["defaultClip"]})
    if spec.get("mode") == "clash":
        job["clashSpeed"] = clash_speed(spec)
    # the Versus extras, each its own switch (see VS_EXTRAS); "intro" also puts WIN over the winner at the end
    job.update({k: bool(spec.get(k)) for k in VS_EXTRAS if k not in ("dash", "music", "intro", "ego", "uisfx", "randskill", "deck", "notes",
                                                                    "buff", "buffboth", "buffmany", "buffown", "buffshort",
                                                                    "debuff", "debuffboth", "debuffmany", "debuffown", "debuffshort")})
    job.update(pace=pace, loop=loop, directed=scripted is not None)
    if spec.get("buff") or spec.get("debuff"):
        # the Buffs / Debuffs switches: effects out of the Buff effects list shown on the two (buffs.versus_effects says
        # which, on whom and for how long; when they come on is the player's, ViewerBuffs.cs)
        from . import buffs
        picks = buffs.versus_effects(svc, spec, (job_groups(L), job_groups(R)))
        if picks:
            job["bundles"] = list(dict.fromkeys(job["bundles"] + buffs.effect_bundles(svc, picks)))
            job["randomBuffs"] = [{"who": x["who"], "name": x["name"], "asset": x["asset"], "by": x.get("by", -1),
                                   "group": x.get("group", ""), "hold": x["hold"]} for x in picks]
    if scripted is not None:
        job.update(wall=E.RULES["wall"], loserPush=E.RULES["loser_push"])
    job["kbScale"] = kb_scale(spec)
    if spec.get("uisfx"):
        # each clash round: the game's clash sound at its blow (and a guard's / dodge's sound when one doesn't strike back)
        k = 0
        for e in entries:
            if not e.get("clash"):
                continue
            ev = e["events"]
            pev = partners[e["partner"]]["events"] if e.get("hasPartner") and not partners[e["partner"]].get("fxOnly") else None
            at = _round_blow(ev, pev)
            add = [{"t": at, "name": UI_SFX["duel"][k % 3]}]
            k += 1
            if e.get("defend") in UI_SFX:
                add.append({"t": at, "name": UI_SFX[e["defend"]]})
            e["events"] = dict(ev, sounds=list(ev["sounds"]) + add)
    job.update(win=bool(spec.get("intro")), seed=int(spec.get("seed") or 0), winner=winner,
               finalHits=sum(len(t["events"].get("hits") or []) for t in final))
    m = next((x for x in battle_maps(svc) if x["name"] == spec.get("map")), None) if spec.get("map") else None
    if m:
        # the stage behind them, with the game's battle camera looking down at its floor
        maps = [svc.object_file(lg) for lg in bundle_deps(svc, m["bundle"])]
        job["bundles"] = list(dict.fromkeys(job["bundles"] + [x for x in maps if x]))
        job["map"] = {"prefab": m["prefab"]}
    music = spec.get("music") if spec.get("music") in bgm_tracks(svc) else None
    ego = versus_ego_pick(svc, spec["right"] if winner == 1 else spec["left"], rnd) if spec.get("ego") else None
    if ego:
        # the lead-in before it: the camera closes in on the winner, the screen darkens, the E.G.O's name shows
        job.update(egoStart=True, egoName="")
    return job, [{"name": "Versus", "parts": entries, "music": music, "ego": ego}]


def versus_team_job(svc, spec: dict) -> tuple[dict, list[dict]]:
    """A team fight (spec "team"): "lefts" / "rights" (ids or enemy prefab names), "flow" ("" exchanges, one at a time),
    "lanes", "seed", "winner" (0 / 1, 2 random), "rounds", "bossPower" (else limbusdm/versus_team.py fair_boss's), the
    stage and switches as a clash fight's. The engine decides it, versus_team.script turns it into the player's parts;
    job.cast lists everyone (prefab, default clip, side, start place in body heights, cooldowns on the engine's clock),
    job.teamFrame the stretch of stage the fight goes over (the fixed wide shot). One video, "Versus"."""
    from . import versus_engine as E
    from . import versus_team as T
    ids = lambda xs: [int(x) if str(x).isdigit() else x for x in (xs.split(",") if isinstance(xs, str) else xs or []) if str(x)]
    F, side, tags = T.team_fighters(svc, ids(spec.get("lefts")), ids(spec.get("rights")), spec)
    w = int(spec.get("winner") or 0) if spec.get("winner") is not None else 2
    opts = dict(rounds=max(1, min(MAX_ROUNDS, int(spec.get("rounds") or 20))), defend=spec.get("defend"), counter=spec.get("counter"),
                kbscale=kb_scale(spec), winner=None if w == 2 else w, pace=True, flow=spec.get("flow") or "",
                # (the same options as /api/versus_plan's, so the render plays the fight the engine view showed; engagements
                # at once: lanes, or all of them with allAtOnce; a spotlight attack stops the rest)
                lanes=int(spec.get("lanes") or 1), allAtOnce=bool(spec.get("allAtOnce")), randskill=True)
    if spec.get("bossPower"):
        opts["bossPower"] = float(spec["bossPower"])
    if spec.get("pairs"):
        opts["pairs"] = spec["pairs"]
    if spec.get("rules"):  # (the page's team rules: versus_team.RULE_LIMITS)
        opts["rules"] = spec["rules"]
    fight = T.simulate(F, side, tags, int(spec.get("seed") or 0), opts, places=T.start_places(svc, side.count(0), side.count(1)))
    with T.rules(spec.get("rules")):
        entries, bg = T.script(fight, F, spec)
    partners = []
    bg_sounds = {}

    def keep(tl):  # (a background timeline: into job.partners, its sounds for the encoder)
        partners.append(dict({k: v for k, v in tl.items() if k not in ("partnerTl", "psounds", "side")}, events=split_hits(tl["events"]), who=-1))
        k = len(partners) - 1
        bg_sounds[str(k)] = [x for x in tl["events"].get("sounds") or [] if not x.get("voice")]
        return k
    for g in bg:
        for p in g["parts"]:
            p["tl"] = keep(p["tl"])
            p["ptl"] = keep(p["ptl"]) if p.get("ptl") else -1
    pair = None
    for e in entries:
        pair = e.get("pair") or pair  # (only a beat's first part has it: the rest play within the same pair)
        if pair:  # (who plays it: for the skill cut-ins)
            e.update(cid=F[pair[int(e.get("who") or 0)]]["cid"], cside=side[pair[int(e.get("who") or 0)]])
        pt = e.pop("partnerTl", None)
        if pt is not None:
            partners.append(pt)
            e.update(hasPartner=True, partner=len(partners) - 1)
        for x in e.get("extras") or []:
            partners.append(dict(x.pop("tl"), who=-1))
            x["tl"] = len(partners) - 1
        e["events"] = split_hits(e["events"])
    quiet_clashes(svc, entries)
    first_right = side.index(1)
    L, R = F[0]["job"], F[first_right]["job"]
    bundles = list(dict.fromkeys(b for f in F for b in f["job"]["bundles"]))
    cast = [{"prefab": f["job"]["prefab"], "defaultClip": f["job"]["defaultClip"], "side": side[i], "name": T.short_names(F)[i],
             "x": fight["home"][i][0], "z": fight["home"][i][1], "boss": i == fight["boss"],
             "cds": [v for c in fight["cds"][i] for v in c]} for i, f in enumerate(F)]
    # the stretch of stage the fight goes over (everyone alive, every beat), for the fixed wide shot
    xs = [p[0] for s in fight["steps"] for i, p in enumerate(s["x"]) if s["hp"][i] > 0] + [p[0] for p in fight["home"]]
    zs = [p[1] for s in fight["steps"] for p in s["x"]] + [p[1] for p in fight["home"]]
    job = dict(L, bundles=bundles, partners=partners, opponent={"prefab": R["prefab"], "defaultClip": R["defaultClip"]},
               cast=cast, teamFrame=[min(xs), max(xs), min(zs), max(zs)], bossPower=fight.get("bossPower", 1.0), teamBg=bg,
               teamIds=[[f["cid"] for i, f in enumerate(F) if side[i] == s] for s in (0, 1)],
               teamNames=[[T.short_names(F)[i] for i in range(len(F)) if side[i] == s] for s in (0, 1)])
    job["clashSpeed"] = clash_speed(spec)
    job.update({k: bool(spec.get(k)) for k in VS_EXTRAS if k not in ("dash", "music", "intro", "ego", "uisfx", "randskill", "deck", "notes") and not k.startswith(("buff", "debuff"))})
    job.update(pace=True, loop=False, directed=True, wall=fight["wall"], loserPush=E.RULES["loser_push"], kbScale=kb_scale(spec))
    winner = fight["winner"]
    if spec.get("uisfx"):
        k = 0
        for e in entries:
            if not e.get("clash"):
                continue
            ev = e["events"]
            pev = partners[e["partner"]]["events"] if e.get("hasPartner") else None
            at = _round_blow(ev, pev)
            add = [{"t": at, "name": UI_SFX["duel"][k % 3]}]
            k += 1
            if e.get("defend") in UI_SFX:
                add.append({"t": at, "name": UI_SFX[e["defend"]]})
            e["events"] = dict(ev, sounds=list(ev["sounds"]) + add)
    final = [e for e in entries if e.get("final")]
    job.update(win=bool(spec.get("intro")), seed=int(spec.get("seed") or 0), winner=winner,
               finalHits=sum(len(t["events"].get("hits") or []) for t in final))
    m = next((x for x in battle_maps(svc) if x["name"] == spec.get("map")), None) if spec.get("map") else None
    if m:
        maps = [svc.object_file(lg) for lg in bundle_deps(svc, m["bundle"])]
        job["bundles"] = list(dict.fromkeys(job["bundles"] + [x for x in maps if x]))
        job["map"] = {"prefab": m["prefab"]}
    music = spec.get("music") if spec.get("music") in bgm_tracks(svc) else None
    return job, [{"name": "Versus", "parts": entries, "music": music, "ego": None, "bgSounds": bg_sounds}]


def versus_ego_pick(svc, cid, rnd) -> dict | None:
    """One of the Sinner's own E.G.O with an awakening cut-in, for the Versus winner `cid` (an Identity; enemies have
    none): {"id", "view", "title"}."""
    sinner = next((s for s in svc.characters()["sinners"] if any(x["id"] == cid for x in s["ids"])), None)
    if not sinner:
        return None
    egos = list(sinner["egos"])
    rnd.shuffle(egos)
    for e in egos:
        views = [v for v in skill_views(svc, e["id"]) if re.fullmatch(rf"SkillViewEGO_{e['id']}1\d", v)]
        if views:
            # (the player's font has Latin letters only: "Great Trichiliocosm [三千大世界]" -> "Great Trichiliocosm")
            title = re.sub(r"\s*\[[^\]]*\]", "", re.sub(r"<[^>]+>", "", e["title"])).strip()
            return {"id": e["id"], "view": views[0], "title": title}
    return None


def quiet_clashes(svc, entries: list[dict]):
    """In a clash nobody speaks a whole line (sighs and shouts are fine): voice lines over 0.9 s (the sound's own length;
    the timeline clip's when the sound isn't found) are for landing a blow, taken out of the clash rounds."""
    lens = {}

    def long_line(x) -> bool:
        if not x.get("voice"):
            return False
        if x["name"] not in lens:
            n = x.get("dur") or 0.0
            try:
                hit = _find_sound(sound_index(svc), x["name"])
                w = svc.fx._wav(hit) if hit else None
                n = _wav_seconds(w) if w else n
            except Exception:
                pass
            lens[x["name"]] = n
        return lens[x["name"]] > 0.9
    for e in entries:
        if e.get("clash"):
            e["events"] = dict(e["events"], sounds=[x for x in e["events"]["sounds"] if not long_line(x)])
            if e.get("psounds"):
                e["psounds"] = [x for x in e["psounds"] if not long_line(x)]


def split_hits(ev: dict) -> dict:
    """A timeline's hits with the game's multi-hits split into their ticks: `multi` of them over `span` seconds (Don
    Quixote's lantern saw: one coin, one blow, four ticks of damage), each with its share of the damage; the knockback
    and "last" go with the last tick, the others are marked "tick" (damage only, not a blow of their own)."""
    if not any((h.get("multi") or 1) > 1 for h in ev.get("hits") or []):
        return ev
    hits = []
    for h in ev["hits"]:
        n = h.get("multi") or 1
        if n <= 1:
            hits.append(h)
            continue
        span = h["span"] if h.get("span", -1) > 0 else 0.1 * n
        for k in range(n):
            hits.append(dict(h, t=round(h["t"] + span * k / n, 4), ratio=(h.get("ratio") or 1) / n, multi=1, tick=k > 0,
                             last=h.get("last") and k == n - 1, force=h.get("force", 0) if k == n - 1 else 0.0))
    return dict(ev, hits=sorted(hits, key=lambda x: x["t"]))


def _loop_seam(frames: str) -> int:
    """A Versus loop (the player's loop.txt: how many frames the opening stand-off has): its frames are blended over
    the last ones, more and more towards the end, so the video's last frame leads into the frame after them. Returns
    how many frames the video then starts later (0: not a loop)."""
    try:
        with open(os.path.join(frames, "loop.txt"), encoding="utf-8") as f:
            n = int(f.read().strip() or 0)
    except (OSError, ValueError):
        return 0
    names = sorted(x for x in os.listdir(frames) if re.fullmatch(r"\d{4}\.png", x))
    if n <= 0 or len(names) < 3 * n:
        return 0
    from PIL import Image
    for i in range(n):
        a = os.path.join(frames, names[len(names) - n + i])
        with Image.open(a) as ia, Image.open(os.path.join(frames, names[i])) as ib:
            Image.blend(ia, ib.convert(ia.mode), (i + 1) / n).save(a)
    return n


def kb_scale(spec: dict) -> float:
    """The game's knockback distances times this (0.5-3; 2 unless set)."""
    try:
        return min(3.0, max(0.5, float(spec.get("kbscale") if spec.get("kbscale") is not None else 2)))
    except (TypeError, ValueError):
        return 2.0


def clash_pause(spec: dict) -> float:
    """Seconds between a clash's blow and the next run in; -1 (unset): as long as the clash animation lasts."""
    try:
        p = spec.get("pause")
        return -1.0 if p is None or float(p) < 0 else min(3.0, float(p))
    except (TypeError, ValueError):
        return -1.0


# Versus switches: hit-stop, cutting wind-ups, clearing effects left over, pushing apart overlaps, clash numbers,
# slow motion on the last blow, Index dashes, music (a BGM track's name)…; and the game's story-fight feel: exchanges
# from a stand-off (or a skill landing), a speed ramp around blows, thrown far back by a blow that lands, the camera
# pushing in on blows, effects fading out in a stand-off, a seamless loop, a white flash on every blow
VS_EXTRAS = ("hitstop", "trim", "clean", "spread", "numbers", "slowmo", "dash", "music", "hp", "death", "intro", "ego",
             "bars", "uisfx", "pace", "ramp", "throw", "punch", "fade", "loop", "flash", "randskill", "deck", "notes",
             "buff", "buffboth", "buffmany", "buffown", "buffshort",
             "debuff", "debuffboth", "debuffmany", "debuffown", "debuffshort")
# the game's battle UI sounds (SFX_1 bank): a clash's blow, guarding, dodging, the E.G.O cut-in starting, winning
UI_SFX = {"duel": ["038_battleui_duel1_a_v1", "039_battleui_duel2_a_v1", "040_battleui_duel3_a_v1"],
          "Guard": "048_battleui_defense_guard_a_v1", "Evade": "049_battleui_defense_evasion_a_v1",
          "ego": "051_battleui_cutscene_ego1_a_v1", "win": "059_battleui_end_win_a_v1"}


def _clash_blow(ev: dict) -> float:
    """When a clash round's blow lands in a timeline: its first hit, else its spark (an effect coming on early, as the
    player's SparkAt), else the end of its dashes, else just after it starts."""
    if ev.get("hits"):
        return min(h["t"] for h in ev["hits"])
    early = [x["t"] for x in ev.get("fx") or [] if x["t"] <= 0.3]
    if early:
        return max(early)
    ends = [m["t"] + m["dur"] for m in ev.get("moves") or []]
    return max(ends) if ends else 0.12


def _round_blow(ev: dict, pev: dict | None) -> float:
    """A clash round's blow as the player times it (Viewer.cs: blows / blowAt), with its partner's timeline `pev`:
    the leader's first hit; else, when either one moves, where the leader's first dash at the other one ends (or the
    last move of the two); else the earliest spark of the two."""
    if ev.get("hits"):
        return min(h["t"] for h in ev["hits"])
    moves = list(ev.get("moves") or []) + list((pev or {}).get("moves") or [])
    if moves:
        dash = sorted((m for m in ev.get("moves") or [] if m["kind"] != "relative"), key=lambda m: m["t"])
        return dash[0]["t"] + dash[0]["dur"] if dash else max(m["t"] + m["dur"] for m in moves)
    sparks = [x["t"] for x in (ev.get("fx") or []) + ((pev or {}).get("fx") or []) if x["t"] <= 0.3]
    return max(max(sparks), 1 / 30) if sparks else 0.12


# Yi Sang · Index Nursefather's clash dash (YiSang_Index_father_Parrying_Timeline_1)
INDEX_DASH = [{"t": 0.0, "kind": "wide", "dur": 0.066, "ease": 6, "radius": 0.0, "chaseY": False, "bodies": 0, "pos": [-3.0, 0.0, 0.0], "curve": []},
              {"t": 0.1, "kind": "relative", "dur": 0.5, "ease": 12, "radius": 0.0, "chaseY": False, "bodies": 0, "pos": [4.0, 0.0, 0.0],
               "curve": [0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 0.0]}]


BATTLE_BGM = re.compile(r"battle|boss|enemy|ally|전투|보스", re.I)  # (early chapters' tracks are named in Korean: 전투 battle)
BGM_WORDS = [("아군전투", "ally battle"), ("적전투", "enemy battle"), ("보스전", "boss battle"), ("뒤틀림", "distortion"),
             ("전반부", "1st half"), ("초반부", "early"), ("중반부", "middle"), ("후반부", "late"), ("완성본", "final"),
             ("장_상", " part 1"), ("장_하", " part 2"), ("장", ""), ("동랑", "Dongrang"), ("이벤트", "event"), ("에고", "E.G.O")]


def _duration(ff: str, path: str) -> float:
    r = subprocess.run([ff, "-hide_banner", "-i", path], capture_output=True, text=True,
                       creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    m = re.search(r"Duration: (\d+):(\d+):([\d.]+)", r.stderr or "")
    return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3)) if m else 0.0


def _video_seconds(ff: str, path: str) -> float:
    """How long a file's picture runs (its sound may run longer than the container says for it)."""
    r = subprocess.run([ff, "-hide_banner", "-i", path, "-map", "0:v:0", "-c", "copy", "-f", "null", "-"], capture_output=True,
                       text=True, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    ts = re.findall(r"time=(\d+):(\d+):([\d.]+)", r.stderr or "")
    return int(ts[-1][0]) * 3600 + int(ts[-1][1]) * 60 + float(ts[-1][2]) if ts else _duration(ff, path)


def _ego_card(svc, ego: int, still: str | None, out: str, seconds: float = 1.2, size: tuple | None = None) -> int:
    """Frames (out/000.png…) of the game's E.G.O start over the battle's last frame `still`: it darkens, purple streaks
    run along two corners, the E.G.O's art slides in on a slanted panel with ragged purple edges, and golden hexagons
    break out of it at the end. Returns the number of frames. No `still` (Versus Live, which holds its own last frame
    under it): transparent RGBA frames of everything but the darkening (each drawn on black and on white, the
    alpha from the difference), `size` the frames' size (Live's picture is smaller than a render's)."""
    import math, random
    from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter, ImageMath
    rnd = random.Random(ego)
    if still:
        bgs = [ImageEnhance.Brightness(Image.open(still).convert("RGB").resize((WIDTH, HEIGHT))).enhance(0.45)]
    else:
        bgs = [Image.new("RGB", (WIDTH, HEIGHT), (0, 0, 0)), Image.new("RGB", (WIDTH, HEIGHT), (255, 255, 255))]
    art = char_art(svc, ego)
    n = int(seconds * 30)
    pw, slant = int(WIDTH * 0.30), int(HEIGHT * 0.42)  # the panel: its width, and how far its top leans right
    cx = int(WIDTH * 0.55)
    if art:
        a = art.copy()
        scale = max(HEIGHT * 1.08 / a.height, (pw + slant * 0.6) / a.width)  # (the whole figure, as the game shows it)
        a = a.resize((int(a.width * scale), int(a.height * scale)))
    streaks = [(rnd.uniform(-0.15, 0.15), rnd.uniform(2, 6), rnd.uniform(0.3, 1.0)) for _ in range(9)]
    drawn = []
    for i, ib in ((i, ib) for i in range(n) for ib in range(len(bgs))):
        rnd = random.Random(ego * 7919 + i)  # (the same ragged edges on every background)
        t = i / 30
        k = min(1.0, t / 0.25)
        ease = 1 - (1 - k) ** 3
        im = bgs[ib].copy()
        d = ImageDraw.Draw(im, "RGBA")
        # purple streaks along the top-right and bottom-left corners, parallel to the panel
        for j, (off, wdt, alpha) in enumerate(streaks):
            span = min(1.0, t / 0.15) * alpha
            for corner in (0, 1):
                y0 = (HEIGHT * (0.05 + off) if corner == 0 else HEIGHT * (0.95 + off))
                x0 = WIDTH * (0.62 + 0.04 * j) if corner == 0 else WIDTH * (0.38 - 0.04 * j)
                dx, dy = slant * 1.4, -HEIGHT * 1.0
                p1 = (x0 - dx * 0.5, y0 - dy * 0.5) if corner == 0 else (x0 - dx * 0.5, y0 - dy * 0.5)
                p2 = (p1[0] + dx * 0.6, p1[1] + dy * 0.6)
                d.line([p1, p2], fill=(210, 40, 230, int(200 * span)), width=int(wdt))
        # the panel: a parallelogram, sliding in from the right and drifting a little
        x = cx + (1 - ease) * WIDTH * 0.6 - t * 18
        poly = [(x - pw / 2, HEIGHT + 20), (x + pw / 2, HEIGHT + 20), (x + pw / 2 + slant, -20), (x - pw / 2 + slant, -20)]
        if art:
            mask = Image.new("L", (WIDTH, HEIGHT), 0)
            ImageDraw.Draw(mask).polygon(poly, fill=255)
            layer = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
            ax = int(x - a.width / 2 + slant / 2)
            layer.paste(a, (ax, (HEIGHT - a.height) // 2), a)
            im.paste(layer, (0, 0), Image.composite(layer, Image.new("RGBA", (WIDTH, HEIGHT)), mask).split()[3])
        else:
            d.polygon(poly, fill=(30, 20, 40, 230))
        # ragged purple edges along both slanted sides
        for (bx, by), (tx, ty) in ((poly[0], poly[3]), (poly[1], poly[2])):
            pts = []
            for s_ in range(14):
                f = s_ / 13
                jag = rnd.uniform(-9, 9)
                pts.append((bx + (tx - bx) * f + jag, by + (ty - by) * f))
            d.line(pts, fill=(170, 30, 210, 160), width=10)
            d.line(pts, fill=(255, 120, 255, 230), width=3)
        # golden hexagons breaking out at the end
        if t > seconds - 0.35:
            g = (t - (seconds - 0.35)) / 0.35
            cxh, cyh = x + slant / 2, HEIGHT / 2
            for ring in range(3):
                r = (g * 1.3 + ring * 0.25) * WIDTH * 0.45
                hexa = [(cxh + r * math.cos(math.pi / 3 * q + 0.3), cyh + r * math.sin(math.pi / 3 * q + 0.3)) for q in range(7)]
                d.line(hexa, fill=(255, 200, 80, int(255 * (1 - g))), width=6)
            d.rectangle([0, 0, WIDTH, HEIGHT], fill=(255, 245, 220, int(200 * g * g)))
        if still:
            im.save(os.path.join(out, f"{i:03d}.png"))
            continue
        drawn.append(im)
        if len(drawn) == 2:
            cb, cw = (x.resize(size or (WIDTH, HEIGHT)) for x in drawn)
            drawn = []
            # (coverage = 1 - what white shows more than black; the colour drawn on black is coverage x colour)
            a = ImageChops.invert(ImageChops.subtract(cw, cb).convert("L"))
            af = a.point(lambda v: max(v, 1)).convert("F")
            col = [ImageMath.lambda_eval(lambda x: x["c"] * 255 / x["a"], c=ch.convert("F"), a=af).convert("L") for ch in cb.split()]
            Image.merge("RGBA", col + [a]).save(os.path.join(out, f"{i:03d}.png"))
    return n


# a character cut-in over a long whole skill (see skill_cutins, _cutin_card, Renderer._versus_cutins)
CUTIN_MIN = 4.0      # a whole skill whose timelines run longer than this together (part_length summed) gets one
CUTIN_SECONDS = 1.1  # the panel on screen: slides in, holds, slides back out
CUTIN_LEAD = 0.8     # it comes this long before the skill's strongest moment and slides away just after it


def _occurrences(entries: list[dict]) -> list[int]:
    """Each entry's k: the k-th time its part is played (parts.txt / timemap.txt count them by name)."""
    seen, out = {}, []
    for e in entries:
        out.append(seen.get(e["name"], 0))
        seen[e["name"]] = out[-1] + 1
    return out


def skill_cutins(entries: list[dict]) -> list[dict]:
    """The whole skills of a Versus video that get a cut-in of their character: each landing of the fight engine (its
    parts share `land`) and the last skill (the `final` parts), when their timelines run over CUTIN_MIN seconds
    together. [{"who": 0 left / 1 right, "parts": [indices into entries], "final": bool}], in order."""
    groups, cur = [], None
    for i, e in enumerate(entries):
        key = "final" if e.get("final") else e.get("land")
        if key is None:
            cur = None
            continue
        if cur is None or cur["key"] != key:
            cur = {"key": key, "who": int(e.get("who") or 0), "parts": [], "final": key == "final", "cid": e.get("cid"), "side": e.get("cside")}
            groups.append(cur)
        cur["parts"].append(i)
    return [g for g in groups if sum(part_length(entries[i]) for i in g["parts"]) > CUTIN_MIN]


def cutin_moments(entries: list[dict], parts: list[int]) -> list[tuple[int, float]]:
    """A skill's moments a cut-in can lead into, strongest first: (entry index, timeline time). Its blows — a multi-hit
    with all its ticks — by their share of the damage and their knockback, a later one first when as strong; a skill
    without hits: its deepest camera zoom-in."""
    blows, order = [], 0
    for i in parts:
        ev = entries[i]["events"]
        for h in sorted(ev.get("hits") or [], key=lambda x: x["t"]):
            if h.get("tick") and blows and blows[-1][2] == i:
                blows[-1][0] += float(h.get("ratio") or 0) + abs(float(h.get("force") or 0)) / 40
                continue
            n = max(1, int(h.get("multi") or 1))
            blows.append([float(h.get("ratio") or 1) * n + abs(float(h.get("force") or 0)) / 40, order, i, float(h["t"])])
            order += 1
    if not blows:
        for i in parts:
            for z in entries[i]["events"].get("zooms") or []:
                deep = -z["size"] if z.get("rel") else (z.get("startSize") or 0) - z["size"] if z.get("v2") else 0
                blows.append([deep, order, i, float(z["t"] + min(z["dur"], 0.5))])
                order += 1
    blows.sort(key=lambda b: (-round(b[0], 3), -b[1]))
    return [(i, t) for _s, _o, i, t in blows]


def cutin_art(img, sprite: bool = False):
    """The picture for a cut-in's panel (PIL RGBA) and (x, y) of its head, the height and width of its head and torso,
    as fractions of it: an Identity's art as it is (head and torso already); a battle sprite (transparent around it) cut
    to its upper part, the soft glow of an aura around it dropped."""
    if not sprite:
        return img, (0.5, 0.0, 1.0, 1.0)
    alpha = img.getchannel("A").point(lambda v: max(0, min(255, (v - 110) * 255 // 90)))
    img = img.copy()
    img.putalpha(alpha)
    box = alpha.point(lambda v: 255 if v > 200 else 0).getbbox()
    if not box:
        return img, (0.5, 0.0, 1.0, 1.0)
    x0, y0, x1, y1 = box
    h = y1 - y0
    # the head: the middle of what the top rows draw
    cols = alpha.crop((x0, y0 + int(h * 0.05), x1, y0 + max(int(h * 0.05) + 1, int(h * 0.3)))).resize((x1 - x0, 1), 2).getdata()
    tot = sum(cols) or 1
    cx = x0 + sum(k * v for k, v in enumerate(cols)) / tot
    region = (max(0, int(cx - h * 0.5)), max(0, y0 - int(h * 0.03)), min(img.width, int(cx + h * 0.5)), min(img.height, y0 + int(h * 0.85)))
    crop = img.crop(region)
    tight = crop.getchannel("A").getbbox() or (0, 0, crop.width, crop.height)  # (sideways: only as wide as it draws)
    crop = crop.crop((tight[0], 0, tight[2], crop.height))
    left = region[0] + tight[0]
    # (head and torso: the top 0.63 of its height, so wide; below that, more of it to fill the panel's bottom)
    band = min(1.0, h * 0.63 / crop.height)
    bw = crop.getchannel("A").crop((0, 0, crop.width, int(crop.height * band))).getbbox()
    return crop, ((cx - left) / crop.width, (y0 + h * 0.15 - region[1]) / crop.height, band,
                  (bw[2] - bw[0]) / crop.width if bw else 1.0)


def _cutin_card(art, sprite: bool, side: int, out: str, seconds: float = CUTIN_SECONDS, label: str = "") -> int:
    """Frames (out/000.png…, transparent around it) of a character cut-in laid over a running skill, the way the
    E.G.O start draws its panel (_ego_card): a slanted panel with ragged purple edges and the character's art slides in
    from its side of the screen (side 1: mirrored, from the right), golden hexagons open around it, then it slides
    back out, fading, with `label` ("P1" / "P2") written at the panel's foot. Soft: no flash, the picture behind only a
    little darker on that side. Returns the frame count."""
    import math, random
    from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont
    rnd = random.Random(7)
    W, H = WIDTH, HEIGHT
    n = int(round(seconds * 30))
    pw, slant, pad = int(W * 0.18), int(H * 0.26), 24
    x_in = W * 0.135 - slant / 2  # where its bottom edge's middle comes to rest (its middle at half height: 13.5 % in, by the edge)
    ch, cw = H + 40, pw + slant + 2 * pad
    # the panel itself, drawn once: a dark purple backdrop and the art, clipped to the parallelogram
    poly = [(pad, ch), (pad + pw, ch), (pad + pw + slant, 0), (pad + slant, 0)]
    grad = Image.linear_gradient("L").resize((cw, ch))
    card = Image.composite(Image.new("RGBA", (cw, ch), (16, 9, 24, 255)), Image.new("RGBA", (cw, ch), (58, 20, 74, 255)), grad)
    if art is not None:
        img, (fx, fy, band, bandw) = cutin_art(art, sprite)
        if sprite:
            # head and torso fill it (a wide one — a big beast — no wider than about the panel)
            scale = min(ch * 0.92 / (img.height * band), (pw + slant) * 0.95 / (img.width * bandw))
        else:
            scale = max(ch * 1.02 / img.height, (pw + slant) * 1.02 / img.width)
        a = img.resize((max(1, int(img.width * scale)), max(1, int(img.height * scale))), Image.LANCZOS)
        top = int(ch * 0.04) if sprite else 0
        # (the head on the panel's middle at its height: the panel leans, its middle further right higher up)
        hy = min(ch * 0.8, top + fy * a.height) if sprite else ch * 0.25
        mid = pad + pw / 2 + slant * (1 - hy / ch)
        if sprite:
            # (a battle sprite has no background of its own: a soft purple glow behind it)
            glow = Image.new("L", (cw, ch), 0)
            ImageDraw.Draw(glow).ellipse([mid - pw * 0.7, ch * 0.08, mid + pw * 0.7, ch * 0.62], fill=110)
            glow = glow.filter(ImageFilter.GaussianBlur(60))
            card = Image.alpha_composite(card, Image.merge("RGBA", (*Image.new("RGB", (cw, ch), (190, 70, 220)).split(), glow)))
        layer = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
        layer.paste(a, (int(mid - fx * a.width), top), a)
        card = Image.alpha_composite(card, layer)
    mask = Image.new("L", (cw, ch), 0)
    ImageDraw.Draw(mask).polygon(poly, fill=255)
    card.putalpha(ImageChops.multiply(card.getchannel("A"), mask))
    # that side of the picture a little darker behind it
    dim = Image.linear_gradient("L").rotate(90, expand=True).resize((int(W * 0.5), H)).point(lambda v: int((255 - v) * 0.32))
    black = Image.new("RGBA", dim.size, (0, 0, 0, 255))
    jags = [[rnd.uniform(-8, 8) for _ in range(16)] for _ in range(2)]
    streaks = [(rnd.uniform(-0.25, 0.25), rnd.uniform(2, 5), rnd.uniform(0.25, 0.55), rnd.uniform(0.4, 0.9)) for _ in range(6)]
    hexes = [(rnd.choice((rnd.uniform(-0.3, -0.05), rnd.uniform(1.05, 1.35))), rnd.uniform(0.08, 0.92), rnd.uniform(14, 34),
              rnd.uniform(0.12, 0.45)) for _ in range(8)]  # (along its two edges, not over the face)
    t_in, t_out = 0.25, 0.3
    font = ImageFont.load_default()
    for fname in ("seguibl.ttf", "arialbd.ttf"):
        try:
            font = ImageFont.truetype(fname, 56)
            break
        except OSError:
            continue
    for i in range(n):
        t = i / 30
        ease = 1 - (1 - min(1.0, t / t_in)) ** 3
        o = max(0.0, (t - (seconds - t_out)) / t_out)
        x = x_in - (1 - ease) * W * 0.45 - o * o * W * 0.25 + t * 12  # (in, a slow drift, then back out)
        vis = min(1.0, t / 0.12) * (1 - o)
        im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        im.paste(black, (0, 0), dim.point(lambda v: int(v * vis)))
        c = card if vis >= 1 else card.copy()
        if vis < 1:
            c.putalpha(c.getchannel("A").point(lambda v: int(v * vis)))
        left = int(x - pw / 2 - pad)
        if left < W and left + cw > 0:
            im.alpha_composite(c, (max(0, left), 0), (max(0, -left), 20))
        fx_ = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        d = ImageDraw.Draw(fx_)
        # purple streaks along the panel's outer side, parallel to it
        span = min(1.0, t / 0.2)
        for off, wdt, length, alpha in streaks:
            by, L = H * (0.62 + off), H * length * span
            bx = x + pw / 2 + slant * (H + 20 - by) / (H + 40) + 28 + abs(off) * 140  # (just outside its outer edge)
            d.line([(bx, by), (bx + slant / H * L, by - L)], fill=(205, 60, 235, int(170 * alpha)), width=int(wdt))
        # ragged purple edges along both slanted sides
        for e_, bx in enumerate((x - pw / 2, x + pw / 2)):
            pts = [(bx + slant * (s_ / 15) + jags[e_][s_] + rnd.uniform(-2, 2), (H + 20) - (H + 40) * (s_ / 15)) for s_ in range(16)]
            d.line(pts, fill=(160, 30, 205, 150), width=12)
            d.line(pts, fill=(255, 135, 255, 235), width=3)
        # golden hexagons opening along its edges while it holds
        for hx, hy, r, at in hexes:
            g = (t - at) / 0.3
            if g <= 0:
                continue
            fade = min(1.0, g)
            rr = r * (0.5 + 0.5 * min(1.0, g)) * (1 + 0.15 * (t - at))
            cx_ = x - pw / 2 + slant * (1 - hy) + pw * hx + (t - at) * 25
            cy_ = H * hy - (t - at) * 18
            hexa = [(cx_ + rr * math.cos(math.pi / 3 * q + 0.52), cy_ + rr * math.sin(math.pi / 3 * q + 0.52)) for q in range(7)]
            d.line(hexa, fill=(255, 205, 90, int(210 * fade)), width=3)
        if vis < 1:
            fx_.putalpha(fx_.getchannel("A").point(lambda v: int(v * vis)))
        im = Image.alpha_composite(im, fx_)
        if side == 1:
            im = im.transpose(Image.FLIP_LEFT_RIGHT)
        if label and vis > 0:
            # (after the mirroring, so the letters read the right way round: under the panel's foot, on its side)
            lx = x + slant * 0.05 + 4
            lx = W - lx if side == 1 else lx
            lay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
            ld = ImageDraw.Draw(lay)
            tw = ld.textlength(label, font=font)
            ld.text((lx - tw / 2, H - 78), label, font=font, fill=(255, 215, 120, int(255 * vis)), stroke_width=4,
                    stroke_fill=(40, 10, 60, int(255 * vis)))
            im = Image.alpha_composite(im, lay)
        im.save(os.path.join(out, f"{i:03d}.png"), compress_level=1)
    return n


def _has_audio(ff: str, path: str) -> bool:
    r = subprocess.run([ff, "-hide_banner", "-i", path], capture_output=True, text=True,
                       creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    return "Audio:" in (r.stderr or "")


def enemy_portraits(svc) -> dict[str, str]:
    """{appearance prefab name: its portrait's catalog path}: the enemy / abnormality data name each look's portrait
    (sdPortrait, else the unit's own number); the picture is "<that>_portrait" in a chapter's folder under
    Sprite/Unit/Portrait/. Kept per snapshot."""
    import sqlite3
    from . import content
    sid = svc.latest_snapshot_id()
    cached = getattr(svc, "_portraits", None)
    if cached and cached[0] == sid:
        return cached[1]
    path = svc.ensure_browse()
    pics = {}
    if path:
        db = sqlite3.connect(path)
        try:
            for (c,) in db.execute("select distinct c from o where c like '%/Sprite/Unit/Portrait/%_portrait.png'"):
                pics.setdefault(c.rsplit("/", 1)[-1][:-len("_portrait.png")], c)
        finally:
            db.close()
    out = {}
    for data in svc.static_tables(list(content.UNIT_TABLES)).values():
        for t in data.values():
            for u in (t.get("list") or []) if isinstance(t, dict) else []:
                app = (u or {}).get("appearance")
                if not app or app in out:
                    continue
                for key in (u.get("sdPortrait"), u.get("viewid"), u.get("nameID"), u.get("id"), app.split("_", 1)[0]):
                    if key is not None and str(key) in pics:
                        out[app] = pics[str(key)]
                        break
    # (the newest ones may have no portrait yet: the icon of their first skill instead)
    if path:
        db = sqlite3.connect(path)
        try:
            icons = {c.rsplit("/", 1)[-1][:-4]: c for (c,) in db.execute(
                "select distinct c from o where c like '%/Sprite/SkillIcon/%01.png'")}
        finally:
            db.close()
        for data in svc.static_tables(list(content.UNIT_TABLES)).values():
            for t in data.values():
                for u in (t.get("list") or []) if isinstance(t, dict) else []:
                    app = (u or {}).get("appearance")
                    if app and app not in out:
                        num = app.split("_", 1)[0]
                        if num + "01" in icons:
                            out[app] = icons[num + "01"]
        out["#icons"] = icons
    out["#pics"] = pics
    svc._portraits = (sid, out)
    return out


def enemy_portrait(svc, app: str) -> str:
    """A Versus pick's picture path: its portrait by its data, else by the number its name starts with (allies and
    NPCs aren't in the enemy tables), else its first skill's icon; "" when there is none."""
    m = enemy_portraits(svc)
    num = app.split("_", 1)[0]
    return m.get(app) or m.get("#pics", {}).get(num) or m.get("#icons", {}).get(num + "01") or ""


def char_art(svc, cid):
    """A big picture of a Versus pick (PIL image) or None: an Identity's / E.G.O's info art, an enemy's portrait."""
    import io
    from PIL import Image
    from .extract import extract
    base = "Assets/Resources_moved/Sprite/Unit/"
    s_ = str(cid)
    if re.fullmatch(r"1\d{4}", s_):
        paths = [f"{base}Info/Normal/{s_}_normal_info.png", f"{base}Profile/Normal/{s_}_normal_profile.png"]
    elif re.fullmatch(r"2\d{4}", s_):
        paths = [f"{base}Info/Ego/{s_}_awaken_info.png", f"{base}Profile/Ego/{s_}_awaken_profile.png"]
    else:
        paths = [enemy_portrait(svc, s_)]
    for path in paths:
        sprite = next((r for r in svc.lookup_container(path) if r["type"] == "Sprite"), None)
        bundle = svc.object_file(sprite["bundle"]) if sprite else None
        if bundle:
            try:
                data, _m, _f = extract(bundle, int(sprite["pid"]))
                return Image.open(io.BytesIO(data)).convert("RGBA")
            except Exception:
                continue
    return None


def _burn_notes(ff: str, video: str, parts: list[dict]):
    """("notes", for testing) the fight engine's beats written over the video, each from where its part starts
    (Versus.parts.txt: the parts the player played, in order) to the next one: who did what, the clash powers and
    coins left, the range, the result."""
    try:
        with open(os.path.join(os.path.dirname(video), "Versus.parts.txt"), encoding="utf-8") as f:
            played = [(n, float(t)) for n, _, t in (x.rstrip("\n").rpartition("\t") for x in f if x.strip())]
    except (OSError, ValueError):
        return
    cues, k = [], 0
    for name, t in played:
        while k < len(parts) and parts[k]["name"] != name:
            k += 1
        if k >= len(parts):
            break
        if parts[k].get("note"):
            cues.append((t, parts[k]["note"]))
        k += 1
    if not cues:
        return
    end = _video_seconds(ff, video)

    def ts(x):
        return f"{int(x // 3600)}:{int(x % 3600 // 60):02d}:{x % 60:05.2f}"
    lines = ["[Script Info]", "ScriptType: v4.00+", "PlayResX: 1920", "PlayResY: 1080", "", "[V4+ Styles]",
             "Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV",
             "Style: N,Arial,34,&H00FFFFFF,&H00000000,&H80000000,1,3,2,0,7,30,30,24", "", "[Events]",
             "Format: Layer, Start, End, Style, Text"]
    for i, (t, text) in enumerate(cues):
        t1 = cues[i + 1][0] if i + 1 < len(cues) else end
        lines.append(f"Dialogue: 0,{ts(t)},{ts(max(t + 0.3, t1))},N,{text.replace('|', chr(92) + 'N')}")
    d = os.path.dirname(video)
    with open(os.path.join(d, "notes.ass"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    tmp = os.path.join(d, "Versus.notes.mp4")
    r = subprocess.run([ff, "-y", "-v", "error", "-i", "Versus.mp4", "-vf", "ass=notes.ass", "-c:v", "libx264", "-preset", "veryfast",
                        "-crf", "20", "-c:a", "copy", "-movflags", "+faststart", "Versus.notes.mp4"], cwd=d, capture_output=True)
    if r.returncode == 0 and os.path.exists(tmp):
        os.replace(tmp, video)


def _intro_card(svc, spec):
    """The Versus intro's picture (PIL): both characters' art, their names, VS between them."""
    from PIL import Image, ImageDraw, ImageFont
    names = svc.names()

    labels = {spec["left"]: spec.get("lname"), spec["right"]: spec.get("rname")}

    def name(cid):
        if not isinstance(cid, int) and labels.get(cid):
            return labels[cid], ""
        if isinstance(cid, int):
            r = names.personalities.get(cid) or names.egos.get(cid) or {}
            title = r.get("title") or r.get("name") or str(cid)
            try:
                return f"{names.sinner_name(names.sinner_of(cid))}", re.sub(r"<[^>]+>", "", title)
            except Exception:
                return re.sub(r"<[^>]+>", "", title), ""
        return re.sub(r"^\d+_|Appearance$", "", cid), ""

    def font(size, bold=True):
        for n in (("seguibl.ttf", "arialbd.ttf") if bold else ("segoeui.ttf", "arial.ttf")):
            try:
                return ImageFont.truetype(n, size)
            except OSError:
                continue
        return ImageFont.load_default()

    im = Image.new("RGB", (WIDTH, HEIGHT), (18, 16, 20))
    d = ImageDraw.Draw(im)
    for i in range(HEIGHT):  # a dark gradient, warmer towards the middle
        c = int(18 + 18 * (1 - abs(i - HEIGHT / 2) / (HEIGHT / 2)))
        d.line([(0, i), (WIDTH, i)], fill=(c + 8, c, c - 2))
    for side, cid in ((0, spec["left"]), (1, spec["right"])):
        art = char_art(svc, cid)
        cx = WIDTH // 4 if side == 0 else WIDTH * 3 // 4
        if not art:  # (some enemies have no portrait: a dark card with a mark)
            art = Image.new("RGBA", (300, 420), (40, 34, 44, 255))
            dd = ImageDraw.Draw(art)
            dd.rectangle([6, 6, 293, 413], outline=(200, 160, 70, 255), width=4)
            q = font(200)
            dd.text((150 - dd.textlength("?", font=q) / 2, 90), "?", font=q, fill=(200, 160, 70, 255))
        if art:
            art.thumbnail((WIDTH // 2 - 60, HEIGHT - 190))
            if side == 1:
                art = art.transpose(Image.FLIP_LEFT_RIGHT)
            im.paste(art, (cx - art.width // 2, 40 + (HEIGHT - 190 - art.height) // 2), art)
        top, sub = (re.sub(r"\s+", " ", x).strip() for x in name(cid))  # (titles can hold line breaks)
        more = int(spec.get(("lmore", "rmore")[side]) or 0)  # (a team fight: the first of the side, and how many more)
        if more:
            top += f" +{more}"
        for text, f, y, col in ((top, font(40), HEIGHT - 130, (240, 200, 90)), (sub, font(26, False), HEIGHT - 78, (230, 230, 230))):
            if text:
                w = d.textlength(text, font=f)
                d.text((cx - w / 2, y), text, font=f, fill=col, stroke_width=3, stroke_fill=(0, 0, 0))
    vf = font(120)
    w = d.textlength("VS", font=vf)
    d.text((WIDTH / 2 - w / 2, HEIGHT / 2 - 80), "VS", font=vf, fill=(200, 40, 40), stroke_width=5, stroke_fill=(0, 0, 0))
    return im


def _versus_intro(svc, ff, spec, video, seconds: float = 2.0):
    """An "A vs B" card before the fight: both pictures, their names, VS between them; faded into the video."""
    png = video + ".intro.png"
    _intro_card(svc, spec).save(png)
    tmp = video + ".intro.mp4"
    has_a = _has_audio(ff, video)
    cmd = [ff, "-y", "-loglevel", "error", "-loop", "1", "-framerate", "30", "-t", f"{seconds}", "-i", png,
           "-f", "lavfi", "-t", f"{seconds}", "-i", "anullsrc=r=48000:cl=stereo", "-i", video]
    fc = (f"[0:v]format=yuv420p,fade=t=in:st=0:d=0.3,fade=t=out:st={seconds - 0.35}:d=0.35,setsar=1[v0];"
          f"[2:v]setsar=1[v1];")
    fc += "[v0][1:a][v1][2:a]concat=n=2:v=1:a=1[v][a]" if has_a else "[v0][v1]concat=n=2:v=1:a=0[v]"
    cmd += ["-filter_complex", fc, "-map", "[v]"] + (["-map", "[a]", "-c:a", "aac", "-b:a", "160k"] if has_a else [])
    cmd += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-movflags", "+faststart", tmp]
    subprocess.run(cmd, check=True, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    os.replace(tmp, video)
    os.remove(png)


def bgm_tracks(svc) -> list[str]:
    """The game's battle music (BGM bank samples named as battle / boss / enemy / ally tracks), for under a Versus video."""
    return sorted(n for n, v in sound_index(svc).items()
                  if os.path.basename(v[0]).lower().startswith("bgm") and BATTLE_BGM.search(n)
                  and not re.search("승리|victory", n, re.I))  # (not the short win jingle)


def bgm_label(name: str) -> str:
    """A track's name readable: "lc_1장_아군전투_전반부_bgm_(완성본_loop)" -> "Ch 1 ally battle 1st half"."""
    s = name
    for ko, en in BGM_WORDS:
        s = s.replace(ko, en)
    s = re.sub(r"^lc_(\d+(?:\.\d+)?)", r"Ch \1", s)
    s = re.sub(r"[_()]+", " ", s)
    s = re.sub(r"\b(bgm|final|loop|master)\b|-13lufs|#\d+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def played_clock(parts_path: str, timemap_path: str):
    """When the player showed what: (starts, when). starts {part: [its starts in the video, s]} (parts.txt: a part can
    be played more than once — clash rounds repeat the clash timelines); when(part, t, k, voice=False): the video time
    of timeline time `t` of the k-th time `part` was played (timemap.txt: the timeline time of each frame — trimmed
    wind-ups, slow motion, hit-stop), None when that moment was cut off."""
    starts: dict[str, list[float]] = {}
    try:
        with open(parts_path, encoding="utf-8") as f:
            for line in f:
                name, _, at = line.rstrip("\n").rpartition("\t")
                starts.setdefault(name, []).append(float(at))
    except (OSError, ValueError):
        pass
    # (one run of frames per time the part is played: a new run where the timeline time goes back)
    tmap: dict[str, list[list[tuple[float, float]]]] = {}
    try:
        with open(timemap_path, encoding="utf-8") as f:
            for line in f:
                part, tt, vt = line.rstrip("\n").split("\t")
                runs = tmap.setdefault(part, [])
                if not runs or float(tt) < runs[-1][-1][0] - 1e-4 or float(vt) > runs[-1][-1][1] + 1.5 / 30:
                    runs.append([])
                runs[-1].append((float(tt), float(vt)))
    except (OSError, ValueError):
        pass

    def when(part, t, k, voice=False):
        runs = tmap.get(part)
        m = runs[k] if runs and k < len(runs) else None
        if not m:
            return t + starts[part][k]
        if voice and m[0][0] - 1.5 <= t < m[0][0]:
            return m[0][1]  # (a line in a trimmed wind-up: said as the part starts, not lost with it)
        if t > m[-1][0] + 0.05 or t < m[0][0] - 0.05:  # cut off (a clash's pause, a trimmed wind-up): not played
            return None
        return next((vt for tt, vt in m if tt >= t - 1e-4), m[-1][1])
    return starts, when


SKILL_GROUP_RE = re.compile(r"(^|_)S\d+(_Time?line( ?\d+)?)?$")  # a skill (job_groups): "…_S1", "…_S12", early "S1_Timeline"; not variants


def part_length(t: dict) -> float:
    """How long a timeline plays: to its end marker if it has one, else to its last clip."""
    ev = t["events"]
    return ev.get("end") or ev.get("dur") or ev.get("last") or 0.0


def burst_max(spec: dict) -> float:
    """The longest whole skill played in the middle of a clash, in seconds."""
    try:
        return min(10.0, max(1.0, float(spec.get("burstMax") or 3)))
    except (TypeError, ValueError):
        return 3.0


def clash_speed(spec: dict) -> float:
    try:
        return min(3.0, max(0.25, float(spec.get("speed") or 1)))
    except (TypeError, ValueError):
        return 1.0


def group_timelines(timelines: list[dict]) -> list[dict]:
    """One video per skill: the game splits a skill into one timeline per coin (…_S1_Timeline_1, _2, _3; Pinky
    Father uses _11, _22, _33) and plays them back to back. Alternatives stay on their own: a different last coin
    (…_S3_Timeline_3_1), versions next to a given Identity (…_S5_Timeline_10115), clashes, Duel Win…"""
    by, groups = {}, []
    for t in timelines:
        m = SKILL_RE.match(t["name"])
        if m:
            by.setdefault(m.group(1), []).append((m.group(3) or "", t))
        else:
            groups.append({"name": t["name"], "parts": [t]})
    for base, items in by.items():
        plain = {int(k): t for k, t in items if k.isdigit()}
        seq = {k: t for k, t in plain.items() if k < 100}
        if not seq and len(plain) == 1:
            seq = dict(plain)
        for k, t in items:
            if k == "" and 0 not in seq and not seq:
                seq[0] = t
            elif "_" in k and int(k.split("_")[0]) not in seq and int(k.split("_")[0]) < 100:
                seq[int(k.split("_")[0])] = t  # "1_1" where there is no plain part 1
        used = {id(t) for t in seq.values()}
        if seq:
            groups.append({"name": base, "parts": [seq[k] for k in sorted(seq)]})
        for _k, t in items:
            if id(t) not in used:
                groups.append({"name": t["name"], "parts": [t]})
    return groups


# ------------------------------------------------------------------ sounds
def sound_index(svc) -> dict[str, tuple[str, int]]:
    """Sample name (lower case) → (bank path, index): the latest snapshot's banks, listed again from the files on disk
    (their headers only: a fraction of a second) — the indexes must match the files export_wav reads, and listings
    made before banks.py read every FSB5 container of a bank miss the sounds past its first (newer Identities' voice
    lines); the snapshot's listing when a bank can't be read."""
    sid = svc.latest_snapshot_id()
    cached = getattr(svc, "_sound_idx", None)
    if cached and cached[0] == sid:
        return cached[1]
    import struct
    from .banks import list_sounds
    snap = svc.load_snapshot(sid)
    roots = {"install": svc.game.game, "locallow": svc.game.locallow}
    out = {}
    for rel, rec in snap["files"].items():
        if not rec.get("sounds"):
            continue
        label, _, sub = rel.partition("/")
        path = os.path.join(roots.get(label) or "", sub)
        try:
            names = [x["name"] for x in list_sounds(path)]
        except (OSError, ValueError, struct.error):
            names = [name for name, _ms in rec["sounds"]]
        for i, name in enumerate(names):
            out.setdefault(name.lower(), (path, i))
    svc._sound_idx = (sid, out)
    return out


def _find_sound(idx: dict, name: str):
    n = name.lower()
    for cand in (n, re.sub(r"-\d+$", "", n), re.sub(r"_\d+$", "", n)):
        if cand in idx:
            return idx[cand]
    return None


# ------------------------------------------------------------------ rendering
# render options, also the folder suffix of their renders ("solo", "alpha_16bit", …; "" = default)
#   solo   – the stand-in target is hidden (same moves and framing, for putting into other videos)
#   alpha  – transparent background: a WebM (VP9 with alpha) instead of the MP4
#   static – one fixed framing per skill that holds the whole move (no follow, zoom, roll or shake)
#   16bit  – drawn with an HDR colour buffer (bright effects add up before they clip); same video out
#   tails  – every coin lands tails (the game dims or hides parts of the effects then)
#   effects – not the skills: each effect of the character on its own, without the characters, framed to what it draws
#   nobloom – drawn without Bloom (the glow around bright effects)
#   buffs  – with the effects of its buffs: the ones it gives itself on it, the debuffs it inflicts on the target,
#            each from the moment the skill gives it (limbusdm/buffs.py unit_buffs, skill_plan)
FLAGS = ("solo", "alpha", "static", "16bit", "tails", "nobg", "novoice", "subs", "effects", "nobloom", "buffs")


def variant(v) -> str:
    """Normalized options key from "alpha_solo", ["solo", "alpha"]… (unknown flags dropped, fixed order); a buff level
    ("lv<n>", see buff_states; level 0, the plain one, has no flag) and a mod ("m-<name>", see mods.py) go last."""
    got = set(re.split(r"[_,+ ]", v) if isinstance(v, str) else v or [])
    lv = next((g for g in sorted(got) if re.fullmatch(r"lv[1-9]", g)), None)
    mod = next((g for g in sorted(got) if re.fullmatch(r"m-[A-Za-z0-9-]{1,32}", g)), None)
    return "_".join([f for f in FLAGS if f in got] + ([lv] if lv else []) + ([mod] if mod else []))


def _safe_name(name: str) -> str:
    return re.sub(r"[^\w.-]", "_", name)


LINE_AT = 0.2  # when an E.G.O's line starts in its cut-in (seconds; the game's script plays it as the cut-in opens)
_LINES: dict = {}


def ego_line_text(svc, line_id: str) -> str | None:
    """The English text of an E.G.O line (Localize/en/EGOVoiceDig/EN_Voice_EGO_*.json)."""
    if not _LINES:
        import glob as _g
        d = os.path.join(svc.game.data or "", "Assets", "Resources_moved", "Localize", "en", "EGOVoiceDig")
        for f in _g.glob(os.path.join(d, "*.json")):
            try:
                with open(f, encoding="utf-8-sig") as fh:
                    for x in json.load(fh).get("dataList") or []:
                        if x.get("id"):
                            _LINES[x["id"]] = x.get("dlg") or ""
            except (OSError, ValueError):
                pass
    return _LINES.get(line_id)


def _wav_seconds(wav: bytes) -> float:
    import io
    import wave
    try:
        with wave.open(io.BytesIO(wav)) as w:
            return w.getnframes() / float(w.getframerate())
    except Exception:
        return 4.0


def _subtitle_png(text: str, w: int, h: int, path: str):
    """The line as a subtitle: white text with a dark outline, centred near the bottom of a transparent frame."""
    from PIL import Image, ImageDraw, ImageFont
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    size = max(18, h // 24)
    font = None
    for name in ("segoeui.ttf", "arial.ttf", "DejaVuSans.ttf"):
        try:
            font = ImageFont.truetype(name, size)
            break
        except OSError:
            continue
    font = font or ImageFont.load_default()
    d = ImageDraw.Draw(im)
    lines = [x.strip() for x in text.split("\n") if x.strip()]
    y = h - int(h * 0.07) - len(lines) * int(size * 1.35)
    for ln in lines:
        tw = d.textlength(ln, font=font)
        d.text(((w - tw) / 2, y), ln, font=font, fill=(255, 255, 255, 255), stroke_width=max(2, size // 12), stroke_fill=(0, 0, 0, 230))
        y += int(size * 1.35)
    im.save(path)


STAGE_PICS = 10        # stages per player run (each run loads their bundles together)
STAGE_PIC_CID = 10101  # the character a stage picture is framed for (hidden in it): a fight's camera at its start


def stage_pic_dir(svc) -> str:
    """The stage pictures of the Versus page's stage list (<name>.jpg), made by the player on demand."""
    return os.path.join(svc.data_dir, "stage_thumbs")


def fighter_pic_dir(svc) -> str:
    """The Versus fighters standing in their idle pose (<id>.png, transparent, cut to the body), made by the player on demand."""
    return os.path.join(svc.data_dir, "fighter_pics")


class PicQueue:
    """Pictures the player makes in the background, one batch per run: `run(names)` makes them and returns those it
    made; a name it couldn't make is not tried again (until the app starts again)."""

    def __init__(self, folder, ext, run, batch, key=lambda n: n):
        self.folder, self.ext, self.run, self.batch, self.key = folder, ext, run, batch, key
        self.queue, self.current, self.failed, self.busy, self.error = [], [], [], False, ""
        self.lock = threading.Lock()

    def status(self, names: list[str] | None = None, known=None) -> dict:
        """The pictures there are, how many are being made; `names`: queued (those without one; `known` filters)."""
        d = self.folder()
        have = sorted(fn[:-len(self.ext)] for fn in os.listdir(d) if fn.endswith(self.ext)) if os.path.isdir(d) else []
        with self.lock:
            if names:
                skip = set(have) | set(self.queue) | set(self.failed) | set(self.current)
                have_keys = set(have)
                self.queue += [n for n in dict.fromkeys(names) if n not in skip and self.key(n) not in have_keys and (known is None or n in known)]
                if self.queue and not self.busy:
                    self.busy = True
                    threading.Thread(target=self._work, daemon=True).start()
            return {"have": have, "queue": len(self.queue) + len(self.current), "busy": self.busy,
                    "failed": list(self.failed), "error": self.error}

    def _work(self):
        while True:
            with self.lock:
                self.current, self.queue = self.queue[:self.batch], self.queue[self.batch:]
                if not self.current:
                    self.busy = False
                    return
            batch = self.current
            try:
                made = self.run(batch)
                self.failed += [n for n in batch if n not in made]
            except Exception as e:  # (the rest of the queue is still tried)
                self.error = str(e)
                self.failed += batch
            with self.lock:
                self.current = []


def _player_run(work: str, job: dict, timeout: float):
    """One run of the player on `job` (its frames into `work`), waited for."""
    exe = viewer_exe()
    if not exe:
        raise RuntimeError("LimbusViewer.exe is missing")
    job = dict(job, out=work)
    jp = os.path.join(work, "job.json")
    with open(jp, "w", encoding="utf-8") as f:
        json.dump(job, f)
    subprocess.run([exe, "-batchmode", "-job", jp, "-logFile", os.path.join(work, "player.log")],
                   timeout=timeout, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))


def make_stage_pics(svc, names: list[str]) -> set[str]:
    """One player run: a picture of each stage alone, as a Versus fight's camera sees it at the start."""
    from PIL import Image
    maps = {m["name"]: m for m in battle_maps(svc)}
    ms = [maps[n] for n in names if n in maps]
    job = dict(make_job(svc, STAGE_PIC_CID))
    bundles = list(job["bundles"])
    for m in ms:
        bundles += [x for x in (svc.object_file(lg) for lg in bundle_deps(svc, m["bundle"])) if x]
    d = stage_pic_dir(svc)
    os.makedirs(d, exist_ok=True)
    work = tempfile.mkdtemp(prefix="_run_", dir=d)
    made = set()
    try:
        job.update(bundles=list(dict.fromkeys(bundles)), timelines=[], fps=30, width=640, height=360,
                   supersample=2, stills=[{"prefab": m["prefab"], "pitch": 10} for m in ms])
        _player_run(work, job, 60 + 30 * len(ms))
        for i, m in enumerate(ms):
            src = os.path.join(work, f"still_{i}.png")
            if os.path.isfile(src):
                Image.open(src).convert("RGB").save(os.path.join(d, m["name"] + ".jpg"), "JPEG", quality=85)
                made.add(m["name"])
    finally:
        shutil.rmtree(work, ignore_errors=True)
    return made


def make_fighter_pics(svc, ids: list[str]) -> set[str]:
    """A fighter in its idle pose as the player draws it in a fight (sprites or Spine), on a transparent background,
    cut to its body: one player run each."""
    from PIL import Image
    d = fighter_pic_dir(svc)
    os.makedirs(d, exist_ok=True)
    made = set()
    for cid in ids:
        work = tempfile.mkdtemp(prefix="_run_", dir=d)
        try:
            job = dict(make_job(svc, int(cid) if str(cid).isdigit() else cid))
            job.update(timelines=[], fps=30, width=1280, height=720, supersample=2, transparent=True, target=False)
            _player_run(work, job, 120)
            src = os.path.join(work, "idle.png")
            if not os.path.isfile(src):
                continue
            img = Image.open(src).convert("RGBA")
            box = img.getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox()
            if not box:
                continue
            pad = 8
            img = img.crop((max(0, box[0] - pad), max(0, box[1] - pad), min(img.width, box[2] + pad), min(img.height, box[3] + pad)))
            img.thumbnail((640, 640))
            img.save(os.path.join(d, _safe_name(str(cid)) + ".png"), "PNG")
            made.add(str(cid))
        except Exception:
            continue
        finally:
            shutil.rmtree(work, ignore_errors=True)
    return made


def fighter_face(svc, cid: str) -> str | None:
    """A round icon's picture of a fighter (team fights' engine view): its idle picture (make_fighter_pics) cut to a
    square on its face: the top of its body's column (where its upper part is thickest: not a weapon held out);
    data/fighter_pics/face/<id>.png, made once. None: no idle picture yet."""
    from PIL import Image
    src = os.path.join(fighter_pic_dir(svc), _safe_name(str(cid)) + ".png")
    if not os.path.isfile(src):
        return None
    out = os.path.join(fighter_pic_dir(svc), "face", _safe_name(str(cid)) + ".png")
    if os.path.isfile(out) and os.path.getmtime(out) >= os.path.getmtime(src):
        return out
    img = Image.open(src).convert("RGBA")
    a = img.getchannel("A").point(lambda v: 255 if v > 40 else 0)
    box = a.getbbox()
    if not box:
        return None
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    # its body's column: where the upper part of it is thickest (a sword or a gun held out is thin), smoothed
    band = a.crop((x0, y0, x1, y0 + max(2, round(h * 0.4))))
    px = band.load()
    cols = [sum(1 for y in range(band.height) if px[x, y]) for x in range(band.width)]
    k = max(2, round(w * 0.06))
    sm = [sum(cols[max(0, x - k):x + k + 1]) for x in range(len(cols))]
    cx = x0 + max(range(len(sm)), key=sm.__getitem__)
    # its top there: the first row the column is mostly drawn in
    r = max(3, round(w * 0.05))
    full = a.load()
    top = y0
    for y in range(y0, y1):
        xs = range(max(x0, cx - r), min(x1, cx + r + 1))
        if sum(1 for x in xs if full[x, y]) >= 0.4 * len(xs):
            top = y
            break
    side = max(16, round(h * (0.45 if w > h * 1.3 else 0.3)))
    cy = top + side * 0.47
    l, t = round(cx - side / 2), round(cy - side / 2)
    sq = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    sq.alpha_composite(img.crop((max(0, l), max(0, t), min(img.width, l + side), min(img.height, t + side))), (max(0, -l), max(0, -t)))
    sq = sq.resize((128, 128), Image.LANCZOS)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    sq.save(out, "PNG")
    return out


class Renderer:
    """Renders all skills of one Identity / E.G.O at once (the player loads its bundles once), then serves MP4s."""

    def __init__(self, svc):
        self.svc = svc
        self.jobs: dict[tuple, dict] = {}  # (cid, variant) → {"state", "msg", "done": [names], "total"}
        # pictures made by the player in the background for the Versus page: stages, fighters in their idle pose
        self.stage_q = PicQueue(lambda: stage_pic_dir(svc), ".jpg", lambda n: make_stage_pics(svc, n), STAGE_PICS)
        self.fighter_q = PicQueue(lambda: fighter_pic_dir(svc), ".png", lambda n: make_fighter_pics(svc, n), 1, key=_safe_name)

    def stage_pics(self, names: list[str] | None = None) -> dict:
        return self.stage_q.status(names, {m["name"] for m in battle_maps(self.svc)} if names else None)

    def fighter_pics(self, ids: list[str] | None = None) -> dict:
        return self.fighter_q.status(ids)

    def out_dir(self, cid: int, v: str = "") -> str:
        """Each set of options (see FLAGS) has its own folder: "<cid>", "<cid>_solo", "<cid>_alpha_static"…"""
        v = variant(v)
        return os.path.join(self.svc.store.root, "fx_renders", f"{self.svc.latest_snapshot_id()}_v{VERSION}",
                            f"{cid}_{v}" if v else str(cid))

    def video(self, cid: int, name: str, v: str = "") -> str | None:
        """The render of one skill: an MP4, or a WebM (VP9 with alpha) when the background is transparent."""
        base = os.path.join(self.out_dir(cid, v), _safe_name(name))
        path = next((base + e for e in (".webm", ".mp4") if os.path.isfile(base + e)), None)
        if path:
            try:
                os.utime(path)  # watched: prune keeps it another KEEP_SECONDS
            except OSError:
                pass
        return path

    def prune(self, keep: float = KEEP_SECONDS):
        """Frees disk: renders made for another snapshot or renderer VERSION, frames left behind by a run the app
        was closed in the middle of, and videos nobody has watched for `keep` seconds (they are made again on
        demand)."""
        sid = self.svc.latest_snapshot_id()
        if not sid:
            return
        root = os.path.join(self.svc.store.root, "fx_renders")
        cur = f"{sid}_v{VERSION}"
        for top in ("fx_renders", "fx_jobs"):
            for d in glob.glob(os.path.join(self.svc.store.root, top, "*_v*")):
                if os.path.isdir(d) and os.path.basename(d) != cur:
                    shutil.rmtree(d, ignore_errors=True)
        with _lock:  # a render can't start meanwhile: its folder might go
            self._prune_current(os.path.join(root, cur), keep)

    def _prune_current(self, base: str, keep: float):
        busy = {os.path.normcase(self.out_dir(*k)) for k, st in list(self.jobs.items()) if st.get("state") == "running"}
        now = time.time()
        for d in glob.glob(os.path.join(base, "*")):
            if not os.path.isdir(d) or os.path.normcase(d) in busy:
                continue
            for f in os.listdir(d):
                p = os.path.join(d, f)
                try:
                    if f.startswith("fx_") and os.path.isdir(p):
                        shutil.rmtree(p, ignore_errors=True)
                    elif f.endswith((".mp4", ".webm")) and now - os.path.getmtime(p) > keep:
                        os.remove(p)
                except OSError:
                    pass
            if not any(f.endswith((".mp4", ".webm")) for f in os.listdir(d)):
                shutil.rmtree(d, ignore_errors=True)

    def status(self, cid: int, v: str = "") -> dict:
        v = variant(v)
        st = dict(self.jobs.get((cid, v)) or {"state": "idle"})
        d = self.out_dir(cid, v)
        st["videos"] = sorted({os.path.splitext(f)[0] for f in os.listdir(d) if f.endswith((".mp4", ".webm"))})             if os.path.isdir(d) else []
        st["available"] = bool(viewer_exe())
        st["v"] = v
        if "kinds" not in st:  # the Effects tab's sub-tab of each effect, as the player told it
            try:
                with open(os.path.join(d, "kinds.json"), encoding="utf-8") as f:
                    st["kinds"] = json.load(f)
            except (OSError, ValueError):
                st["kinds"] = {}
        return st

    def start(self, cid: int, names: list[str] | None = None, v: str = "", kind: str = ""):
        """kind: of the Effects tab's effects only those of this sub-tab ("skill", "aura", "battle"; "": all)."""
        v = variant(v)
        with _lock:
            if (self.jobs.get((cid, v)) or {}).get("state") == "running":
                return
            self.jobs[(cid, v)] = {"state": "running", "msg": "Preparing…", "done": [], "total": 0, "kind": kind}
        threading.Thread(target=self._run, args=(cid, names, v, kind), daemon=True).start()

    def _run(self, cid: int, names, v: str = "", kind: str = ""):
        st = self.jobs[(cid, v)]
        flags = set(v.split("_")) if v else set()
        try:
            exe, ff = viewer_exe(), ffmpeg_exe()
            if not exe:
                raise RuntimeError("LimbusViewer.exe is missing")
            if not ff:
                raise RuntimeError("ffmpeg is missing")
            tails = "tails" in flags
            mod = None
            mname = next((f[2:] for f in flags if f.startswith("m-")), None)
            if mname:
                from . import mods
                m = mods.load(self.svc, cid, mname)
                if m is None:
                    raise RuntimeError(f"no mod named {mname}")
                mod = {"hue": m["hue"], "sat": m["sat"], "bright": m["bright"],
                       "textures": [{"name": k, "path": v} for k, v in m["textures"].items()],
                       "frames": [{"sprite": f["sprite"], "path": f["path"], "px": f["px"], "py": f["py"], "ppu": f["ppu"],
                                   "scope": f["scope"]} for f in m["frames"]],
                       "timing": m["timing"], "vfx": m["vfx"]}
            out = self.out_dir(cid, v)
            if "effects" in flags:
                # its effects: one run of the battle prefab; the player names them as it finds them
                os.makedirs(out, exist_ok=True)
                job = dict(make_job(self.svc, cid, tails), effectKind=kind)
                # and the buff / aura / field effects the game plays for it out of other bundles (with their dependencies)
                extra = battle_effects(self.svc, cid, job["prefab"])
                if extra:
                    have = set(job["bundles"])
                    patched = patched_bundles(self.svc, extra)
                    more = [patched.get(lg) or self.svc.object_file(lg)
                            for lg in bundle_closure(self.svc, sorted({x["bundle"] for x in extra}))]
                    job = dict(job, bundles=job["bundles"] + [p for p in more if p and p not in have],
                               extraEffects=[{"name": x["name"], "asset": x["asset"]} for x in extra])
                self._play(exe, ff, dict(job, mod=mod) if mod else job, None, flags, out, {}, st)
                st.update(state="done", msg="")
                return
            # an E.G.O: its cut-ins (each a scene of its own), then its corroded form's battle prefab
            views = skill_views(self.svc, cid) if isinstance(cid, int) and str(cid).startswith("2") else []
            jobs = []
            for view in views:
                try:
                    jobs.append(make_job(self.svc, cid, tails, view))
                except ValueError:
                    pass
            try:
                jobs.append(make_job(self.svc, cid, tails))
            except ValueError:
                if not jobs:
                    raise
            plan = []
            for job in jobs:
                groups = job_groups(job)
                if names:
                    groups = [g for g in groups if g["name"] in names or any(t["name"] in names for t in g["parts"])]
                if groups:
                    plan.append((job, groups))
            if not plan:
                raise RuntimeError("this one has no skill timelines")
            st["total"] = sum(len(g) for _j, g in plan)
            os.makedirs(out, exist_ok=True)
            sidx = sound_index(self.svc)
            own = []
            if "buffs" in flags:
                from . import buffs
                own = buffs.unit_buffs(self.svc, cid)
                more = buffs.effect_bundles(self.svc, own) if own else []
            for job, groups in plan:
                if own and not job["prefab"].rsplit("/", 1)[-1].startswith("SkillViewEGO"):  # (not over a cut-in)
                    # each comes on when the skill gives it (buffs.skill_plan)
                    job = dict(job, bundles=list(dict.fromkeys(job["bundles"] + more)), buffsOn=True,
                               randomBuffs=buffs.skill_plan(self.svc, cid, groups, own))
                self._play(exe, ff, dict(job, mod=mod) if mod else job, groups, flags, out, sidx, st)
            st.update(state="done", msg="")
        except Exception as e:
            st.update(state="error", msg=str(e))

    # ------------------------------------------------------------ Versus
    def versus_key(self, spec: dict) -> str:
        import hashlib
        spec = clash_base(spec)
        keep = {k: spec.get(k) for k in ("left", "right", "skill", "mode", "rounds", "winner", "rskill")}
        # (newer options only when set: videos made before them keep their keys)
        if spec.get("map"):
            keep["map"] = spec["map"]
        if spec.get("mode") == "clash":
            if clash_speed(spec) != 1:
                keep["speed"] = clash_speed(spec)
            if clash_pause(spec) >= 0:
                keep["pause"] = clash_pause(spec)
            for k in ("rspeed", "rpause", "lskills", "rskills", "defend", "counter", "bursts"):
                if spec.get(k):
                    keep[k] = True
            if spec.get("bursts"):
                keep["burstMax"] = burst_max(spec)
            if any(spec.get(k) for k in ("rspeed", "rpause", "lskills", "rskills", "defend", "counter", "bursts", "dash", "numbers", "hp", "pace", "loop", "randskill", "deck")) \
                    or int(spec.get("winner") or 0) == 2:
                keep["seed"] = int(spec.get("seed") or 0)
        if spec.get("buff") or spec.get("debuff"):
            keep["seed"] = int(spec.get("seed") or 0)
        if spec.get("team"):  # (a team fight: its line-ups and rules are part of the key — a 1v1 key stays as it was)
            keep["team"] = True
            for k in ("lefts", "rights", "flow", "lanes", "allAtOnce", "bossPower", "rules", "pairs"):
                if spec.get(k):
                    keep[k] = ",".join(map(str, spec[k])) if isinstance(spec[k], (list, tuple)) else spec[k]
            keep["seed"] = int(spec.get("seed") or 0)
        for k in VS_EXTRAS:
            if spec.get(k):
                keep[k] = spec[k]
        if spec.get("kbscale") is not None:
            keep["kbscale"] = kb_scale(spec)
        return "vs-" + hashlib.sha1(json.dumps(keep, sort_keys=True).encode()).hexdigest()[:12]

    def start_versus(self, spec: dict) -> str:
        if spec.get("mode") == "clash" and spec.get("loop"):
            # (a loop: nothing before its first frame or after its last — no intro card, E.G.O, death, WIN or HP running down)
            spec = {k: x for k, x in spec.items() if k not in ("intro", "ego", "death", "hp")}
        key = self.versus_key(spec)
        with _lock:
            if (self.jobs.get((key, "")) or {}).get("state") != "running":
                self.jobs[(key, "")] = {"state": "running", "msg": "Preparing…", "done": [], "total": 1}
                threading.Thread(target=self._run_versus, args=(key, spec), daemon=True).start()
        return key

    def _run_versus(self, key: str, spec: dict):
        spec = clash_base(spec)
        st = self.jobs[(key, "")]
        try:
            exe, ff = viewer_exe(), ffmpeg_exe()
            if not exe or not ff:
                raise RuntimeError("LimbusViewer.exe or ffmpeg is missing")
            job, groups = versus_job(self.svc, spec)
            if spec.get("team"):  # (the intro card of a team fight: the first of each side and how many more)
                tl, tr = job["teamIds"]
                spec = dict(spec, left=tl[0], right=tr[0], lmore=len(tl) - 1, rmore=len(tr) - 1)
            out = self.out_dir(key)
            os.makedirs(out, exist_ok=True)
            with open(os.path.join(out, "spec.json"), "w", encoding="utf-8") as f:
                json.dump(spec, f, ensure_ascii=False)
            sidx = sound_index(self.svc)
            music = groups[0].pop("music", None)  # (laid under the finished video: through the intro and the E.G.O too)
            st["phase"] = "fight"  # (the UI's progress bar, see vsProgress)
            self._play(exe, ff, job, groups, set(), out, sidx, st)
            video = os.path.join(out, "Versus.mp4")
            if spec.get("cutins", True) and not job.get("loop") and os.path.exists(video):
                st.update(msg="Skill cut-ins…", phase="cutins", current=None)
                try:
                    self._versus_cutins(exe, ff, spec, groups[0], video)
                except (OSError, ValueError, subprocess.SubprocessError):
                    pass  # (only a decoration: the fight's video stays as it is)
            if spec.get("notes") and os.path.exists(video):
                _burn_notes(ff, video, groups[0]["parts"])
            spec = dict(spec, won=job.get("winner", 0))
            with open(os.path.join(out, "spec.json"), "w", encoding="utf-8") as f:
                json.dump(spec, f, ensure_ascii=False)
            if spec.get("ego") and os.path.exists(video):
                st.update(msg="E.G.O cut-in…", phase="ego", current=None)
                self._versus_ego(exe, ff, spec, groups[0], video, sidx, st)
            if spec.get("intro") and os.path.exists(video):
                st.update(msg="Intro…", phase="intro", current=None)
                _versus_intro(self.svc, ff, spec, video)
            if (music or spec.get("uisfx") and (spec.get("intro") or spec.get("death"))) and os.path.exists(video):
                st.update(msg="Music…", phase="music", current=None)
                self._versus_audio(ff, video, music, sidx, spec)
            st.update(state="done", msg="")
        except Exception as e:
            st.update(state="error", msg=str(e))

    def _versus_audio(self, ff, video, music, sidx, spec):
        """Under the finished video: the music, from the start to the end (faded out), and the win jingle as WIN shows."""
        dur = _video_seconds(ff, video)
        ins = []
        hit = _find_sound(sidx, music) if music else None
        wav = self._wav(hit) if hit and os.path.isfile(hit[0]) else None
        if music and not wav:
            raise RuntimeError(f"the music track {music} could not be read from the game's sound banks")
        tmpd = video + ".audio"
        os.makedirs(tmpd, exist_ok=True)
        if wav:
            with open(os.path.join(tmpd, "music.wav"), "wb") as f:
                f.write(wav)
            ins += ["-stream_loop", "-1", "-i", os.path.join(tmpd, "music.wav")]
        hit = _find_sound(sidx, UI_SFX["win"]) if spec.get("uisfx") and (spec.get("intro") or spec.get("death")) else None
        wwav = self._wav(hit) if hit and os.path.isfile(hit[0]) else None
        if wwav:
            with open(os.path.join(tmpd, "win.wav"), "wb") as f:
                f.write(wwav)
            ins += ["-i", os.path.join(tmpd, "win.wav")]
        if not ins:
            return
        fc, labels, k = [], ["[0:a]"], 1
        if wav:
            fc.append(f"[{k}:a]aformat=channel_layouts=stereo:sample_rates=48000,atrim=0:{dur:.2f},volume=0.5,"
                      f"afade=t=out:st={max(0.0, dur - 1.5):.2f}:d=1.5[m]")
            labels.append("[m]")
            k += 1
        if wwav:
            ms = int(max(0.0, dur - 1.6) * 1000)
            fc.append(f"[{k}:a]aformat=channel_layouts=stereo:sample_rates=48000,adelay={ms}|{ms},volume=0.8[w]")
            labels.append("[w]")
        fc.append(f"{''.join(labels)}amix=inputs={len(labels)}:normalize=0:duration=longest,atrim=0:{dur:.2f}[a]")
        tmp = video + ".mus.mp4"
        cmd = [ff, "-y", "-loglevel", "error", "-i", video] + ins + ["-filter_complex", ";".join(fc), "-map", "0:v", "-map", "[a]",
                                                                      "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", tmp]
        subprocess.run(cmd, check=True, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        os.replace(tmp, video)
        shutil.rmtree(tmpd, ignore_errors=True)

    def _versus_ego(self, exe, ff, spec, group, video, sidx, st):
        """The winner's E.G.O cut-in (picked in versus_job) spliced in before its last skill, right after the
        player's lead-in, through a white flash both ways."""
        ego = group.get("ego")
        if not ego:
            return
        ego_out = self.out_dir(ego["id"])
        clip = os.path.join(ego_out, _safe_name(ego["view"]) + ".mp4")
        if not os.path.exists(clip):
            job = make_job(self.svc, ego["id"], view=ego["view"])
            os.makedirs(ego_out, exist_ok=True)
            self._play(exe, ff, job, job_groups(job), set(), ego_out, sidx, st)
        if not os.path.exists(clip) or not _has_audio(ff, video) or not _has_audio(ff, clip):
            return
        # where the winner's last skill starts: the first of the final parts in the player's list
        try:
            with open(os.path.join(os.path.dirname(video), "Versus.parts.txt"), encoding="utf-8") as f:
                starts = [float(x.rstrip("\n").rpartition("\t")[2]) for x in f if x.strip()]
        except (OSError, ValueError):
            return
        n_final = sum(1 for t in group["parts"] if t.get("final"))
        if len(starts) < n_final or n_final == 0:
            return
        at, d, x = starts[-n_final], _video_seconds(ff, clip), 0.25
        if d <= 2 * x:
            return
        # the card: the battle's last frame darkened, the E.G.O's art on a slanted panel sliding in with ragged purple
        # edges and streaks, then golden hexagons breaking out of it (the game's E.G.O start)
        work = video + ".egocard"
        os.makedirs(work, exist_ok=True)
        still = os.path.join(work, "still.png")
        subprocess.run([ff, "-y", "-loglevel", "error", "-ss", f"{max(0.0, at - 0.04):.3f}", "-i", video, "-frames:v", "1", still],
                       check=True, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        n = _ego_card(self.svc, ego["id"], still, work)
        cd = n / 30
        norm = "fps=30,format=yuv420p,setsar=1,settb=AVTB"
        fc = (f"[0:v]trim=0:{at:.3f},setpts=PTS-STARTPTS,{norm}[v1];[0:v]trim={at:.3f},setpts=PTS-STARTPTS,{norm}[v3];"
              f"[2:v]{norm}[vc];[1:v]scale={WIDTH}:{HEIGHT},setpts=PTS-STARTPTS,{norm},trim=0:{d:.3f}[v2];"
              f"[0:a]atrim=0:{at:.3f},asetpts=PTS-STARTPTS[a1];[0:a]atrim={at:.3f},asetpts=PTS-STARTPTS[a3];"
              f"[3:a]atrim=0:{cd:.3f}[ac];"
              f"[1:a]aformat=channel_layouts=stereo:sample_rates=48000,atrim=0:{d:.3f},asetpts=PTS-STARTPTS[a2];"
              f"[v1][vc]xfade=transition=fade:duration=0.1:offset={at - 0.1:.3f}[v1c];"
              f"[v1c][v2]xfade=transition=fadewhite:duration={x}:offset={at - 0.1 + cd - x:.3f}[v12];"
              f"[v12][v3]xfade=transition=fadewhite:duration={x}:offset={at - 0.1 + cd - x + d - x:.3f}[v];"
              f"[a1][ac]acrossfade=d=0.1[a1c];[a1c][a2]acrossfade=d={x}[a12];[a12][a3]acrossfade=d={x}[a]")
        tmp = video + ".ego.mp4"
        hit = _find_sound(sidx, UI_SFX["ego"])
        swav = self._wav(hit) if hit and os.path.isfile(hit[0]) else None
        if swav:
            with open(os.path.join(work, "start.wav"), "wb") as f:
                f.write(swav)
            fc = fc.replace(f"[3:a]atrim=0:{cd:.3f}[ac];",
                            f"[3:a]aformat=channel_layouts=stereo:sample_rates=48000,apad,atrim=0:{cd:.3f}[ac];")
        cmd = [ff, "-y", "-loglevel", "error", "-i", video, "-i", clip, "-framerate", "30", "-i", os.path.join(work, "%03d.png")]
        cmd += ["-i", os.path.join(work, "start.wav")] if swav else ["-f", "lavfi", "-t", f"{cd + 1:.2f}", "-i", "anullsrc=r=48000:cl=stereo"]
        cmd += [
               "-filter_complex", fc, "-map", "[v]", "-map", "[a]",
               "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", tmp]
        subprocess.run(cmd, check=True, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        shutil.rmtree(work, ignore_errors=True)
        os.replace(tmp, video)

    def _battle_sprite(self, exe, cid):
        """A character's look in battle (PIL RGBA, transparent around it) for the cut-ins of those without art of
        their own (enemies, abnormalities): the player's still of its idle pose (idle.png), drawn alone at three times
        the video's size and cut to what it draws. Kept per snapshot; None when it can't be drawn."""
        from PIL import Image
        d = self.out_dir("sprite-" + _safe_name(str(cid)))
        png = os.path.join(d, "idle.png")
        if not os.path.isfile(png):
            os.makedirs(d, exist_ok=True)
            work = tempfile.mkdtemp(prefix="fx_", dir=d)
            try:
                job = dict(make_job(self.svc, cid), timelines=[], out=work, fps=30, width=WIDTH * 3, height=HEIGHT * 3,
                           supersample=1, target=False, transparent=True)
                jp = os.path.join(work, "job.json")
                with open(jp, "w", encoding="utf-8") as f:
                    json.dump(job, f)
                subprocess.run([exe, "-batchmode", "-job", jp, "-logFile", os.path.join(work, "player.log")], timeout=300,
                               creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
                im = Image.open(os.path.join(work, "idle.png")).convert("RGBA")
                box = im.getchannel("A").getbbox()
                if box:
                    im.crop(box).save(png)
            except (OSError, ValueError, subprocess.SubprocessError):
                pass
            finally:
                shutil.rmtree(work, ignore_errors=True)
        try:
            return Image.open(png).convert("RGBA")
        except OSError:
            return None

    def _versus_cutins(self, exe, ff, spec, group, video):
        """Over the fight's whole skills longer than CUTIN_MIN (skill_cutins): a cut-in of the one playing it, leading
        into the skill's strongest moment (cutin_moments) where the player showed it (Versus.parts.txt / .timemap.txt),
        inside the skill and apart from the others; the last skill's not right at its start when the winner's E.G.O
        cut-in is spliced in before it (_versus_ego, later). Art: an Identity's own, else its battle sprite."""
        entries = group["parts"]
        cuts = skill_cutins(entries)
        base = os.path.splitext(video)[0]
        starts, when = played_clock(base + ".parts.txt", base + ".timemap.txt")
        if not cuts or not starts:
            return
        occ = _occurrences(entries)
        end = _video_seconds(ff, video)

        def at(i, t=None):  # (where entry i's moment t — None: its start — is in the video)
            try:
                return starts[entries[i]["name"]][occ[i]] if t is None else when(entries[i]["name"], t, occ[i])
            except (KeyError, IndexError):
                return None
        plan, free = [], 0.0
        for g in cuts:
            g0 = at(g["parts"][0])
            if g0 is None:
                continue
            nxt = g["parts"][-1] + 1
            g1 = (at(nxt) if nxt < len(entries) else None) or end
            lo = max(free, g0 + (1.0 if g["final"] and group.get("ego") else 0.0))
            for i, t in cutin_moments(entries, g["parts"]):
                hit = at(i, t)
                if hit is not None and lo <= min(max(lo, hit - CUTIN_LEAD), g1 - CUTIN_SECONDS):
                    s0 = min(max(lo, hit - CUTIN_LEAD), g1 - CUTIN_SECONDS)
                    if g.get("cid") is not None:  # (a team fight: the fighter of the entry's pair)
                        plan.append((s0, g["cid"], g["side"]))
                    else:
                        plan.append((s0, spec["left"] if g["who"] == 0 else spec["right"], g["who"]))
                    free = s0 + CUTIN_SECONDS + 0.5
                    break
        if not plan:
            return
        work = video + ".cutins"
        os.makedirs(work, exist_ok=True)
        try:
            sets, items = {}, []
            for s0, cid, side in plan:
                key = (str(cid), side)
                if key not in sets:
                    ident = bool(re.fullmatch(r"1\d{4}", str(cid)))
                    art = char_art(self.svc, cid) if ident else self._battle_sprite(exe, cid)
                    sprite = art is not None and not ident
                    if art is None:
                        art = char_art(self.svc, cid)  # (no sprite: an enemy's portrait)
                    sets[key] = None
                    if art is not None:
                        sets[key] = os.path.join(work, str(len(sets)))
                        os.makedirs(sets[key])
                        _cutin_card(art, sprite, side, sets[key], label=f"P{side + 1}")
                if sets[key]:
                    items.append((s0, sets[key]))
            if not items:
                return
            cmd, fc, prev = [ff, "-y", "-loglevel", "error", "-i", video], [], "[0:v]"
            for k, (s0, d) in enumerate(items):
                cmd += ["-framerate", "30", "-i", os.path.join(d, "%03d.png")]
                fc.append(f"[{k + 1}:v]setpts=PTS-STARTPTS+{s0:.3f}/TB[c{k}];{prev}[c{k}]overlay=eof_action=pass[v{k}]")
                prev = f"[v{k}]"
            fc.append(f"{prev}format=yuv420p[v]")
            tmp = video + ".cut.mp4"
            cmd += ["-filter_complex", ";".join(fc), "-map", "[v]", "-map", "0:a?", "-c:v", "libx264", "-preset", "veryfast",
                    "-crf", "20", "-c:a", "copy", "-movflags", "+faststart", tmp]
            subprocess.run(cmd, check=True, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            os.replace(tmp, video)
            with open(base + ".cutins.txt", "w", encoding="utf-8") as f:  # (where they are: for checking)
                f.write("".join(f"{s0:.3f}\t{cid}\t{side}\n" for s0, cid, side in plan))
        finally:
            shutil.rmtree(work, ignore_errors=True)

    # ------------------------------------------------------------ live (the "Versus Live" tab)
    def start_live(self, spec: dict) -> dict:
        """A clash fight played in the Unity player's own window in real time, nothing saved: the fight a render of
        `spec` would make (the engine's), with what ffmpeg adds to a render played / shown by the player instead —
        each part's sounds, the music, the win jingle, the intro card, the winner's E.G.O cut-in (unity/.../ViewerLive.cs).
        No loop. One at a time."""
        with _lock:
            cur = getattr(self, "live", None)
            if not (cur and cur.get("state") in ("preparing", "loading", "playing")):
                self.live = {"state": "preparing", "msg": "Preparing the fight…"}
                threading.Thread(target=self._run_live, args=(dict(spec), self.live), daemon=True).start()
        return self.live_status()

    def live_status(self) -> dict:
        st = getattr(self, "live", None) or {"state": "idle"}
        return {k: v for k, v in st.items() if k != "proc"}

    def stop_live(self):
        st = getattr(self, "live", None) or {}
        p = st.get("proc")
        if p and p.poll() is None:
            st["stopped"] = True
            p.kill()

    def _run_live(self, spec: dict, st: dict):
        work = None
        try:
            exe = viewer_exe()
            if not exe:
                raise RuntimeError("LimbusViewer.exe is missing")
            spec = {k: x for k, x in spec.items() if k not in ("loop", "notes")}
            spec["mode"] = "clash"
            for side, key in (("left", "skill"), ("right", "rskill")):  # (random picks come without their skills)
                names = [g["name"] for g in job_groups(make_job(self.svc, spec[side])) if not is_clash(g["name"])
                         and not re.search(r"(^|_)(Parrying|Duel_?Win|Dead|Retreat)(_|$)", g["name"], re.I)]
                if spec.get(key) not in names:
                    spec[key] = names[0] if names else ""
            job, groups = versus_job(self.svc, spec)
            st.update(msg="Reading the sounds…", winner=job.get("winner", 0))
            work = tempfile.mkdtemp(prefix="limbus_live_")
            sidx = sound_index(self.svc)
            clips: dict = {}  # bank hit → its number in liveClips (each sound read once)
            pending: list = []  # (bank hit, file) still to be written: the player starts first and waits for prep.done

            def clip(name):
                hit = _find_sound(sidx, name) if name else None
                if not hit or not os.path.isfile(hit[0]):
                    return -1
                if hit not in clips:
                    if hit in self.__dict__.get("_wavs", {}) and self._wav(hit) is None:
                        return -1  # (known to be unreadable)
                    clips[hit] = len(clips)
                    pending.append((hit, os.path.join(work, f"s{clips[hit]}.wav")))
                return clips[hit]

            g = groups[0]
            parts = []
            for i, t in enumerate(g["parts"]):
                live = [{"t": s["t"], "clip": k, "voice": bool(s.get("voice"))} for s in t["events"]["sounds"] + t.get("psounds", [])  # (as _encode)
                        if (k := clip(s["name"])) >= 0]
                parts.append(dict(t, group=g["name"], first=i == 0, last=i == len(g["parts"]) - 1, live=live))
            music = clip(g.get("music"))
            if g.get("music") and music < 0:
                raise RuntimeError(f"the music track {g['music']} could not be read from the game's sound banks")
            music_file = os.path.join(work, f"s{music}.wav") if music >= 0 else None
            win = clip(UI_SFX["win"]) if spec.get("uisfx") and (spec.get("intro") or spec.get("death")) else -1
            intro = ""
            if spec.get("intro"):
                intro = os.path.join(work, "intro.png")
                _intro_card(self.svc, spec).save(intro)
            ego_job = None
            if g.get("ego"):
                st.update(msg="Preparing the E.G.O cut-in…")
                ego_job = self._live_ego(exe, g, work, sidx, st, clip)
                if ego_job is None:
                    job.update(egoStart=False)  # (it could not be made: the fight goes on without the lead-in too)
            job.update(timelines=parts, out=work, fps=30, width=WIDTH, height=HEIGHT, supersample=1, target=True,
                       live=True, liveClips=[os.path.join(work, f"s{k}.wav") for k in range(len(clips))],
                       liveMusic=music, liveWin=win, liveIntro=intro, liveEgo=ego_job, livePrep=True)
            jp = os.path.join(work, "job.json")
            with open(jp, "w", encoding="utf-8") as f:
                json.dump(job, f)
            p = subprocess.Popen([exe, "-job", jp, "-logFile", os.path.join(work, "player.log"),
                                  "-screen-fullscreen", "0", "-screen-width", "1280", "-screen-height", "720"])
            st.update(state="loading", msg="Loading in the player's window…", proc=p, names=[spec.get("lname"), spec.get("rname")])
            prep_error = []

            def write_sounds():
                # the sounds are written while the player starts up (its bundles load meanwhile); it waits for prep.done
                try:
                    for hit, path in pending:
                        wav = self._wav(hit)
                        if wav is not None:
                            with open(path, "wb") as f:
                                f.write(wav)
                        elif path == music_file:
                            prep_error.append(f"the music track {g['music']} could not be read from the game's sound banks")
                            p.kill()
                            return
                except Exception as e:
                    prep_error.append(str(e))
                    p.kill()
                    return
                open(os.path.join(work, "prep.done"), "w").close()
            threading.Thread(target=write_sounds, daemon=True).start()
            while (rc := p.poll()) is None:
                try:
                    with open(os.path.join(work, "live.txt"), encoding="utf-8") as f:
                        if f.read().strip() == "playing" and st["state"] == "loading":
                            st.update(state="playing", msg="Playing in the player's window")
                except OSError:
                    pass
                time.sleep(0.2)
            log = ""
            try:
                with open(os.path.join(work, "viewer.log"), encoding="utf-8", errors="replace") as f:
                    log = f.read()
            except OSError:
                pass
            timing = next((ln[6:] for ln in log.splitlines() if ln.startswith("live: ") and " frames in " in ln), "")
            if prep_error:
                raise RuntimeError(prep_error[0])
            if rc != 0 and not st.get("stopped"):
                raise RuntimeError(f"the Unity player failed ({rc}) {log[-400:]}")
            st.update(state="done", msg="Stopped" if st.get("stopped") else "", timing=timing)
        except Exception as e:
            st.update(state="error", msg=str(e))
        finally:
            st.pop("proc", None)
            if work and not os.environ.get("LV_KEEP_LIVE"):  # (testing: the job and the player's logs kept)
                shutil.rmtree(work, ignore_errors=True)

    def _live_ego(self, exe, group, work, sidx, st, clip):
        """The winner's E.G.O cut-in for the Live player, baked as a render has it (the same pieces, _versus_ego): its
        cut-in as frames (JPEG) and sound (made by the player and kept as for a render, if not yet), the card (RGBA frames
        over the battle's last frame, which the player holds and darkens), the E.G.O start sound. None when it can't be made."""
        ego, ff = group["ego"], ffmpeg_exe()
        ego_out = self.out_dir(ego["id"])
        cut = os.path.join(ego_out, _safe_name(ego["view"]) + ".mp4")
        if not ff:
            return None
        if not os.path.exists(cut):
            job = make_job(self.svc, ego["id"], view=ego["view"])
            os.makedirs(ego_out, exist_ok=True)
            prog = {"state": "running", "msg": "", "done": [], "total": 0}  # (the cut-in's own progress, as a skill render's)
            self._play(exe, ff, job, job_groups(job), set(), ego_out, sidx, prog)
        if not os.path.exists(cut):
            return None
        size = (1280, 720)
        d = os.path.join(work, "ego")
        os.makedirs(os.path.join(d, "clip"))
        os.makedirs(os.path.join(d, "card"))
        flags = dict(check=True, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        subprocess.run([ff, "-y", "-loglevel", "error", "-i", cut, "-vf", f"fps=30,scale={size[0]}:{size[1]}", "-q:v", "3",
                        os.path.join(d, "clip", "%04d.jpg")], **flags)
        frames = len([x for x in os.listdir(os.path.join(d, "clip")) if x.endswith(".jpg")])
        audio = ""
        if _has_audio(ff, cut):
            audio = os.path.join(d, "clip.wav")
            subprocess.run([ff, "-y", "-loglevel", "error", "-i", cut, "-vn", "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", audio], **flags)
        n = _ego_card(self.svc, ego["id"], None, os.path.join(d, "card"), size=size)
        if frames < 12:
            return None
        return {"clip": os.path.join(d, "clip"), "clipFrames": frames, "audio": audio,
                "card": os.path.join(d, "card"), "cardFrames": n, "sound": clip(UI_SFX["ego"])}

    def versus_list(self) -> list[dict]:
        """Versus videos made with the current snapshot, newest first."""
        base = os.path.dirname(self.out_dir("x"))
        out = []
        for d in glob.glob(os.path.join(base, "vs-*")):
            v = os.path.join(d, "Versus.mp4")
            try:
                with open(os.path.join(d, "spec.json"), encoding="utf-8") as f:
                    spec = json.load(f)
            except (OSError, ValueError):
                continue
            if os.path.isfile(v):
                out.append({"key": os.path.basename(d), "spec": spec, "time": os.path.getmtime(v)})
        return sorted(out, key=lambda x: -x["time"])

    def _play(self, exe, ff, job, groups, flags, out, sidx, st, size=(WIDTH, HEIGHT)):
        """One run of the Unity player; each video is encoded as soon as its frames are complete, several at a time.
        groups None: the character's effects (the "effects" flag), one video each as the player lists them."""
        work = tempfile.mkdtemp(prefix="fx_", dir=out)
        effects = groups is None
        base = st.get("rendered", 0)
        try:
            # the player plays a group's parts back to back into one folder of frames
            job = dict(job, timelines=[] if effects else [dict(t, group=g["name"], first=i == 0, last=i == len(g["parts"]) - 1)
                                                         for g in groups for i, t in enumerate(g["parts"])])
            job.update({"out": work, "fps": 30, "width": size[0], "height": size[1], "target": "solo" not in flags,
                        "transparent": "alpha" in flags, "staticCamera": "static" in flags,
                        "bits": 16 if "16bit" in flags else 8, "tails": "tails" in flags, "noBackground": "nobg" in flags,
                        "effects": effects, "buffLevel": next((int(f[2:]) for f in flags if re.fullmatch(r"lv\d", f)), 0)})
            if "nobloom" in flags:
                job["bloom"] = 0
            jp = os.path.join(work, "job.json")
            with open(jp, "w", encoding="utf-8") as f:
                json.dump(job, f)
            st["msg"] = "Rendering in Unity…"
            p = subprocess.Popen([exe, "-batchmode", "-job", jp, "-logFile", os.path.join(work, "player.log")],
                                 creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            encoded = set()
            from concurrent.futures import ThreadPoolExecutor

            def encode(g):
                self._encode(ff, work, out, g, sidx, flags)
                st["done"].append(g["name"])

            with ThreadPoolExecutor(max(1, min(4, (os.cpu_count() or 4) // 3))) as pool:
                futures = []
                while True:
                    rc = p.poll()
                    if effects:  # the player lists the effects first (name, tab), then makes a folder of frames for each that draws
                        try:
                            with open(os.path.join(work, "effects.txt"), encoding="utf-8") as f:
                                listed = [ln.split("\t") for ln in f.read().splitlines() if ln]
                            # (all of them, each with its sub-tab, whichever sub-tab is drawn)
                            kinds = {x[0]: x[1] for x in listed if len(x) > 1}
                            if job.get("effectKind") and kinds:
                                listed = [x for x in listed if kinds.get(x[0]) == job["effectKind"]]
                            st["total"] = len(listed)
                            groups = [{"name": x[0], "parts": []} for x in listed]
                            if kinds and kinds != st.get("kinds"):
                                st["kinds"] = kinds
                                with open(os.path.join(out, "kinds.json"), "w", encoding="utf-8") as f:
                                    json.dump(kinds, f)
                        except OSError:
                            groups = []
                    current = None
                    for g in groups:
                        if g["name"] not in encoded and os.path.exists(os.path.join(work, g["name"], "done")):
                            encoded.add(g["name"])
                            futures.append(pool.submit(encode, g))
                        elif g["name"] not in encoded and current is None and os.path.isdir(os.path.join(work, g["name"])):
                            current = g["name"]
                    # for the progress bar: videos whose frames are all there (of this run and the runs before it), and
                    # the one being drawn
                    st["rendered"] = base + len(encoded)
                    if current:
                        # the video being drawn, for its own progress bar: an effect's frames of the number the player
                        # wrote first ("total"); a skill's parts started of its parts (parts.txt)
                        d = os.path.join(work, current)
                        try:
                            names = os.listdir(d)
                        except OSError:
                            names = []
                        n = sum(1 for f in names if f.endswith((".png", ".exr")))
                        frac = 0.0
                        try:
                            if effects:
                                with open(os.path.join(d, "total"), encoding="utf-8") as f:
                                    frac = n / max(1, int(f.read().strip() or 0))
                            else:
                                with open(os.path.join(d, "parts.txt"), encoding="utf-8") as f:
                                    started = sum(1 for ln in f if ln.strip())
                                parts = next((len(g["parts"]) for g in groups if g["name"] == current), 1)
                                frac = (max(0, started - 1) + 0.5) / max(1, parts)
                        except (OSError, ValueError):
                            pass
                        st["current"] = {"name": current, "frac": min(1.0, frac)}
                        st["msg"] = f"Rendering {current} (frame {n})…"
                    else:
                        st["current"] = None
                        st["msg"] = "Rendering in Unity…" if rc is None else "Encoding…"
                    if rc is not None:
                        break
                    time.sleep(0.2)
                for f in futures:
                    f.result()
            if rc != 0 and not encoded:
                log = ""
                try:
                    with open(os.path.join(work, "viewer.log"), encoding="utf-8", errors="replace") as f:
                        log = f.read()[-400:]
                except OSError:
                    pass
                raise RuntimeError(f"the Unity player failed ({rc}) {log}")
        finally:
            shutil.rmtree(work, ignore_errors=True)

    def prewarm(self):
        """Once, in the background when the app starts: the slow first-use parts of a Versus fight's preparation (the sound
        index, the engine's tables, the FMOD start, the portrait lookup) done before the first fight asks for them."""
        steps = (lambda: __import__("limbusdm.versus_engine", fromlist=["x"])._tables(self.svc),
                 lambda: sound_index(self.svc),
                 lambda: __import__("fmod_toolkit.fmod", fromlist=["x"]).get_pyfmodex_system_instance(
                     32, __import__("fmod_toolkit.fmod", fromlist=["x"]).pyfmodex.flags.INIT_FLAGS.NORMAL),
                 lambda: char_art(self.svc, 10101))
        for step in steps:
            try:
                step()
            except Exception:
                pass

    def _wav(self, hit):
        """A sound from the FMOD banks as WAV, decoded once per session."""
        cache = self.__dict__.setdefault("_wavs", {})
        if hit not in cache:
            try:
                from .banks import export_wav
                cache[hit] = export_wav(*hit)[0]
            except Exception:
                cache[hit] = None
            if len(cache) > 400:  # keep memory in check
                cache.pop(next(iter(cache)))
        return cache[hit]

    def _encode(self, ff, work, out, group, sidx, flags=frozenset()):
        """One video per skill with its sounds: MP4 (H.264 + AAC), or with a transparent background WebM
        (VP9 with alpha + Opus), which video editors take as a layer."""
        frames = os.path.join(work, group["name"])
        hdr, alpha = "16bit" in flags, "alpha" in flags
        pattern = os.path.join(frames, "%04d.exr" if hdr else "%04d.png")
        # part → its starts in the video, in order (written by the player). A part can be played more than once (clash
        # rounds repeat the clash timelines), each time with its sounds
        starts, when = played_clock(os.path.join(frames, "parts.txt"), os.path.join(frames, "timemap.txt"))
        cut_in = group["name"].startswith("SkillViewEGO_")  # ends at its end marker (see the Viewer): later sounds don't play

        # an E.G.O's cut-in: the Sinner's line ("battle_awaken_<id>_1" / "battle_erosion_<id>_1"), which the game's
        # script plays when the E.G.O is used, and its text for subtitles
        line = None
        m = re.match(r"^SkillViewEGO_(\d{5})([12])\d$", group["name"])
        if m:
            line = f"battle_{'awaken' if m.group(2) == '1' else 'erosion'}_{m.group(1)}_1"
        sounds, played = [], {}
        for t in group["parts"]:
            k = played.get(t["name"], 0)  # the k-th time this part is played
            if k >= len(starts.get(t["name"]) or []):
                continue  # (the player skipped it)
            played[t["name"]] = k + 1
            sounds += [dict(s, t=w)
                       for s in t["events"]["sounds"] + t.get("psounds", [])  # (a clash: the other one's sounds too)
                       if not (cut_in and t["events"].get("end") and s["t"] > t["events"]["end"])
                       and (w := when(t["name"], s["t"], k, s.get("voice"))) is not None]
        if line:
            sounds.append({"t": LINE_AT, "name": line, "voice": True, "line": True})
        # (a team fight's background beats: the player lists each timeline it started — job.partners index, video
        # time, the timeline time it started from — and the group has their sounds)
        if group.get("bgSounds") and os.path.isfile(os.path.join(frames, "bg.txt")):
            with open(os.path.join(frames, "bg.txt"), encoding="utf-8") as f:
                for ln in f:
                    x = ln.rstrip("\n").split("\t")
                    if len(x) >= 3:
                        at, frm = float(x[1]), float(x[2])
                        to = float(x[3]) if len(x) > 3 else 1e9  # (where it ended: cut short, nothing after)
                        sounds += [dict(s, t=round(at + s["t"] - frm, 4)) for s in group["bgSounds"].get(x[0]) or [] if frm <= s["t"] <= to + 0.3]
        if "novoice" in flags:
            sounds = [s for s in sounds if not s.get("voice")]
        # a loop: the opening stand-off's frames are blended into the closing one's and cut from the start (the
        # fighters stand the same in both; the stage's own animation runs on across the seam)
        cut = 0 if hdr else _loop_seam(frames)
        if cut:
            sounds = [dict(s, t=s["t"] - cut / 30) for s in sounds if s["t"] >= cut / 30]
        cmd = [ff, "-y", "-loglevel", "error", "-framerate", "30"] + (["-start_number", str(cut)] if cut else []) + ["-i", pattern]
        filters, labels = [], []
        sub = None  # (png, from, to): the line's text over the picture
        if line and "subs" in flags:
            text = ego_line_text(self.svc, line)
            if text:
                hit = _find_sound(sidx, line)
                wav = self._wav(hit) if hit and os.path.isfile(hit[0]) else None
                dur = _wav_seconds(wav) if wav else 4.0
                png = os.path.join(frames, "subs.png")
                _subtitle_png(text, WIDTH, HEIGHT, png)
                sub = (png, LINE_AT, LINE_AT + max(2.0, dur) + 0.5)
        # each sound file is an input once, split for every time it is played (many clash rounds repeat the same ones)
        inputs: dict = {}  # bank hit → (input number, [delays in ms])
        for s in sounds:
            hit = _find_sound(sidx, s["name"])
            if not hit or not os.path.isfile(hit[0]):
                continue
            if hit not in inputs:
                wav = self._wav(hit)
                if wav is None:
                    continue
                k = len(inputs) + 1
                wp = os.path.join(frames, f"s{k}.wav")  # per skill: skills are encoded in parallel
                with open(wp, "wb") as f:
                    f.write(wav)
                cmd += ["-i", wp]
                inputs[hit] = (k, [])
            inputs[hit][1].append(int(s["t"] * 1000))
        for k, delays in inputs.values():
            parts = [f"[s{k}_{j}]" for j in range(len(delays))]
            filters.append(f"[{k}:a]aformat=channel_layouts=stereo:sample_rates=48000,asplit={len(delays)}{''.join(parts)}")
            for j, ms in enumerate(delays):
                filters.append(f"{parts[j]}adelay={ms}|{ms}[a{k}_{j}]")
                labels.append(f"[a{k}_{j}]")
        music = None
        hit = _find_sound(sidx, group["music"]) if group.get("music") else None
        wav = self._wav(hit) if hit and os.path.isfile(hit[0]) else None
        if wav:
            n_frames = len(glob.glob(os.path.join(frames, "*.exr" if hdr else "*.png"))) - cut
            dur = max(1.0, n_frames / 30)
            k = len(inputs) + 1
            mp = os.path.join(frames, "music.wav")
            with open(mp, "wb") as f:
                f.write(wav)
            cmd += ["-stream_loop", "-1", "-i", mp]
            filters.append(f"[{k}:a]aformat=channel_layouts=stereo:sample_rates=48000,atrim=0:{dur:.2f},volume=0.35,"
                           f"afade=t=out:st={max(0.0, dur - 1.5):.2f}:d=1.5[music]")
            labels.append("[music]")
            music = k
        if labels:
            filters.append(f"{''.join(labels)}amix=inputs={len(labels)}:normalize=0:duration=longest[aout]")
        vin = "[0:v]"
        if sub:
            cmd += ["-loop", "1", "-framerate", "30", "-i", sub[0]]
            k = len(inputs) + 1 + (1 if music else 0)
            filters.append(f"[0:v][{k}:v]overlay=0:0:shortest=1:enable='between(t,{sub[1]:.2f},{sub[2]:.2f})'[subv]")
            vin = "[subv]"
        # video: 16-bit frames are half-float EXR (with alpha: premultiplied); 8-bit ones PNG (alpha straight). The
        # EXR values are already gamma-encoded like the game's, so they are tagged sRGB, not ffmpeg's "linear"
        if alpha:
            filters.append(f"{vin}format=gbrapf32le,unpremultiply=inplace=1,setparams=color_trc=iec61966-2-1,format=yuva420p[vout]" if hdr
                           else f"{vin}format=yuva420p[vout]")
        elif hdr:
            filters.append(f"color=c=0x1a1a1f:s={WIDTH}x{HEIGHT}:r=30[bg];{vin}format=gbrap[fg];"
                           "[bg][fg]overlay=shortest=1:format=gbrp:alpha=premultiplied,setparams=color_trc=iec61966-2-1,format=yuv420p[vout]")
        else:
            filters.append(f"{vin}format=yuv420p[vout]")
        graph = ";".join(filters)
        if len(graph) > 8000:  # dozens of clash rounds: past what a Windows command line holds, so from a file
            gp = os.path.join(frames, "filters.txt")
            with open(gp, "w", encoding="utf-8") as f:
                f.write(graph)
            cmd += ["-/filter_complex", gp, "-map", "[vout]"]  # (ffmpeg 7: an option's value read from a file)
        else:
            cmd += ["-filter_complex", graph, "-map", "[vout]"]
        if labels:
            cmd += ["-map", "[aout]"]
        base = os.path.join(out, _safe_name(group["name"]))
        if alpha:
            cmd += ["-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "24", "-row-mt", "1",
                    "-deadline", "realtime", "-cpu-used", "8",  # 7x faster than "good", same quality here
                    "-auto-alt-ref", "0", "-metadata:s:v:0", "alpha_mode=1"]
            if labels:
                cmd += ["-c:a", "libopus", "-b:a", "160k"]
            cmd.append(base + ".webm")
        else:
            cmd += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-movflags", "+faststart"]
            if labels:
                cmd += ["-c:a", "aac", "-b:a", "160k"]
            cmd.append(base + ".mp4")
        subprocess.run(cmd, check=True, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        for f in ("parts.txt", "timemap.txt"):  # (Versus: where its parts and their moments are in the video)
            if os.path.exists(os.path.join(frames, f)):
                shutil.copyfile(os.path.join(frames, f), base + "." + f)
