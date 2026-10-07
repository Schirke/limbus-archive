"""Replay Unity AnimationClips of 2D sprite characters (Identity / E.G.O battle animations).

A clip (generic, non-legacy) stores its curves in m_MuscleClip: a streamed clip (keyframes with cubic
coefficients), a dense clip (sampled values) and a constant clip. m_ClipBindingConstant.genericBindings maps
curve indices to (path hash, component type, attribute); PPtr curves hold indices into pptrCurveMapping
(the sprites). Paths are CRC32 hashes of transform paths below the Animator's GameObject.

We rebuild the character's hierarchy (Transforms, SpriteRenderers, active flags), sample the clip at its own
frame rate and output draw lists: which sprite, where, flipped or not, how opaque, in what order.
Particles, shaders and timelines are not part of this.
"""
from __future__ import annotations

import math
import re
import struct
import zlib

from .extract import _env, _lock, on_drop

T_GAMEOBJECT, T_TRANSFORM, T_SPRITERENDERER = 1, 4, 212
ATTR = {zlib.crc32(n.encode()): n for n in (
    "m_FlipX", "m_FlipY", "m_IsActive", "m_Enabled", "m_SortingOrder",
    "m_Color.r", "m_Color.g", "m_Color.b", "m_Color.a")}
# transform attributes are small ids: 1 position, 2 rotation (quaternion), 3 scale, 4 euler
TRANSFORM_SIZE = {1: 3, 2: 4, 3: 3, 4: 3}


# ------------------------------------------------------------------ curve decoding
class Curves:
    def __init__(self, d: dict):
        mc = d["m_MuscleClip"]
        clip = mc["m_Clip"]
        clip = clip.get("data", clip)
        self.stop = float(mc.get("m_StopTime") or 0)
        self.start = float(mc.get("m_StartTime") or 0)
        self.rate = float(d.get("m_SampleRate") or 60) or 60
        bc = d["m_ClipBindingConstant"]
        self.bindings = bc["genericBindings"]
        self.pptr = [((p or {}).get("m_FileID", 0), (p or {}).get("m_PathID")) for p in bc["pptrCurveMapping"]]

        sc = clip["m_StreamedClip"]
        self.n_streamed = int(sc.get("curveCount", 0)) + int(sc.get("discreteCurveCount", 0) or 0)
        dc = clip["m_DenseClip"]
        self.n_dense = int(dc.get("m_CurveCount", 0))
        self.keys: dict[int, list] = {}  # curve -> [(time, a, b, c, d)]
        raw = struct.pack(f"<{len(sc['data'])}I", *sc["data"]) if sc.get("data") else b""
        pos = 0
        while pos + 8 <= len(raw):
            t, n = struct.unpack_from("<fi", raw, pos)
            pos += 8
            for _ in range(n):
                idx, a, b, c, v = struct.unpack_from("<i4f", raw, pos)
                pos += 20
                self.keys.setdefault(idx, []).append((t, a, b, c, v))
        for k in self.keys.values():
            k.sort(key=lambda x: x[0])
        self.dense = list(dc.get("m_SampleArray") or [])
        self.dense_begin = float(dc.get("m_BeginTime") or 0)
        self.dense_rate = float(dc.get("m_SampleRate") or self.rate) or self.rate
        self.dense_frames = int(dc.get("m_FrameCount") or 0)
        self.const = list(clip["m_ConstantClip"].get("data") or [])

        # curve index -> (binding, component index)
        self.curve_of: list[tuple[dict, int]] = []
        for b in self.bindings:
            size = TRANSFORM_SIZE.get(b["attribute"], 1) if b["typeID"] == T_TRANSFORM and not b["isPPtrCurve"] else 1
            for i in range(size):
                self.curve_of.append((b, i))

    def value(self, curve: int, t: float):
        if curve < self.n_streamed:
            keys = self.keys.get(curve)
            if not keys:
                return None
            cur = keys[0]
            for k in keys:
                if k[0] <= t + 1e-6:
                    cur = k
                else:
                    break
            t0, a, b, c, v = cur
            if not math.isfinite(t0) or abs(t0) > 1e6:
                return v
            dt = max(0.0, t - t0)
            return ((a * dt + b) * dt + c) * dt + v
        curve -= self.n_streamed
        if curve < self.n_dense:
            if not self.dense_frames:
                return None
            f = int(round((t - self.dense_begin) * self.dense_rate))
            f = min(max(f, 0), self.dense_frames - 1)
            i = f * self.n_dense + curve
            return self.dense[i] if i < len(self.dense) else None
        curve -= self.n_dense
        return self.const[curve] if curve < len(self.const) else None


# ------------------------------------------------------------------ hierarchy
class Node:
    __slots__ = ("path", "h", "tpid", "name", "parent", "pos", "scale", "active", "renderer")

    def __init__(self, path, name, parent, pos, scale, active, tpid=None):
        self.path, self.name, self.parent, self.pos, self.scale, self.active = path, name, parent, pos, scale, active
        self.h = zlib.crc32(path.encode())
        self.tpid = tpid
        self.renderer = None  # dict: sprite, order, flipx, alpha, enabled


def _vec(v, n=3, default=0.0):
    if v is None:
        return [default] * n
    return [getattr(v, k, default) for k in "xyzw"[:n]]


_scene_cache: dict[int, dict] = {}
on_drop.append(_scene_cache.clear)  # it holds objects of the bundle (see extract.drop_all)


def _scene(objs: dict) -> dict:
    """Transforms, GameObjects and SpriteRenderers of a bundle, linked by m_Father / m_GameObject
    (m_Children lists turned out to be incomplete)."""
    key = id(objs)
    if key in _scene_cache:
        return _scene_cache[key]
    tr, go, sr, kids = {}, {}, {}, {}
    for pid, o in objs.items():
        t = o.type.name
        try:
            if t in ("Transform", "RectTransform"):
                d = o.read()
                father = d.m_Father.path_id if d.m_Father and d.m_Father.m_FileID == 0 and d.m_Father.path_id else None
                tr[pid] = (d.m_GameObject.path_id, father, _vec(d.m_LocalPosition), _vec(d.m_LocalScale, default=1.0))
                if father:
                    kids.setdefault(father, []).append(pid)
            elif t == "GameObject":
                d = o.read()
                go[pid] = (d.m_Name, bool(d.m_IsActive))
            elif t == "SpriteRenderer":
                d = o.read()
                col = getattr(d, "m_Color", None)
                sprite = (d.m_Sprite.m_FileID, d.m_Sprite.path_id, o.assets_file) if d.m_Sprite and d.m_Sprite.path_id else None
                sr[d.m_GameObject.path_id] = {"sprite": sprite, "order": getattr(d, "m_SortingOrder", 0),
                                              "flipx": bool(getattr(d, "m_FlipX", False)),
                                              "alpha": getattr(col, "a", 1.0) if col is not None else 1.0,
                                              "enabled": bool(getattr(d, "m_Enabled", True))}
        except Exception:
            continue
    go_tr = {g: p for p, (g, *_r) in tr.items()}
    sc = {"tr": tr, "go": go, "sr": sr, "kids": kids, "go_tr": go_tr}
    _scene_cache.clear()  # keep only the latest bundle
    _scene_cache[key] = sc
    return sc


def build_hierarchy(objs: dict, go_pid: int) -> dict[int, Node]:
    """{path hash: Node} for the GameObject `go_pid` (root, path "") and everything below it."""
    sc = _scene(objs)
    nodes: dict[int, Node] = {}

    def visit(tpid, path, parent):
        g, _father, pos, scale = sc["tr"][tpid]
        name, active = sc["go"].get(g, ("?", True))
        node = Node(path, name, parent, pos, scale, active, tpid)
        node.renderer = sc["sr"].get(g)
        nodes[node.h] = node
        for ch in sc["kids"].get(tpid, []):
            cname = sc["go"].get(sc["tr"][ch][0], ("?", True))[0]
            visit(ch, f"{path}/{cname}" if path else cname, node)

    root = sc["go_tr"].get(go_pid)
    if root is not None:
        visit(root, "", None)
    return nodes


# ------------------------------------------------------------------ bundle scan
SKILL_RE = re.compile(r"_S(\d+)$", re.I)
POSE_ORDER = ["default", "move", "guard", "evade", "damaged", "dead", "add"]


def list_clips(bundle_path: str) -> list[dict]:
    """Character animation clips of the bundle with the Animator that plays them (FX / 'Recorded' clips skipped)."""
    env = _env(bundle_path)
    with _lock:
        objs = {o.path_id: o for o in env.objects}
        out, seen = [], set()
        for o in env.objects:
            if o.type.name != "Animator":
                continue
            try:
                a = o.read()
                ctrl = objs.get(a.m_Controller.path_id) if a.m_Controller.m_FileID == 0 else None
                if ctrl is None:
                    continue
                cd = ctrl.parse_as_dict()
                go_pid = a.m_GameObject.path_id
            except Exception:
                continue
            for cp in cd.get("m_AnimationClips") or []:
                pid = cp.get("m_PathID")
                c = objs.get(pid)
                if c is None or pid in seen:
                    continue
                name = c.peek_name() or ""
                if name.startswith(("FX_", "Fx_", "fx_")) or name.startswith("Recorded"):
                    continue
                seen.add(pid)
                go = objs.get(go_pid)
                out.append({"clip": str(pid), "name": name, "animator_go": str(go_pid),
                            "animator": (go.peek_name() if go else "") or ""})
    return out


def clip_kind(name: str) -> tuple[str, int]:
    m = SKILL_RE.search(name)
    if m:
        return "skill", int(m.group(1))
    low = name.lower()
    for i, p in enumerate(POSE_ORDER):
        if low.endswith("_" + p) or low.endswith(p) or ("_" + p + "_") in low:
            return "pose", i
    return "other", 99


# ------------------------------------------------------------------ sampling
def bind_slots(cv: Curves, remap: dict | None = None) -> dict:
    """{path hash: {what: curve index}} — what is "sprite", ("tr", attribute, component) or an attribute name.
    `remap` turns path hashes of a nested Animator into hashes below the character's root."""
    by_path: dict[int, dict] = {}
    for ci, (b, comp) in enumerate(cv.curve_of):
        h = remap.get(b["path"], b["path"]) if remap else b["path"]
        slot = by_path.setdefault(h, {})
        if b["isPPtrCurve"]:
            slot["sprite"] = ci
        elif b["typeID"] == T_TRANSFORM:
            slot[("tr", b["attribute"], comp)] = ci
        else:
            slot[ATTR.get(b["attribute"], b["attribute"])] = ci
    return by_path


class _Sprites:
    """Sprite references → keys "bundle|pid" plus their size / pivot (sprites can live in other bundles:
    `resolve(assets_file, file_id, path_id) -> (bundle, obj)`)."""

    def __init__(self, objs, logical, resolve):
        self.objs, self.logical, self.resolve = objs, logical, resolve
        self.resolved: dict[tuple, str | None] = {}
        self.objs_out: dict[str, object] = {}
        self.info: dict[str, dict] = {}

    def key(self, file_id, path_id, assets_file):
        k = (id(assets_file), file_id, path_id)
        if k not in self.resolved:
            if file_id == 0:
                lg, o = self.logical, self.objs.get(path_id)
            else:
                lg, o = self.resolve(assets_file, file_id, path_id) if self.resolve else (None, None)
            key = f"{lg}|{path_id}" if o is not None and o.type.name == "Sprite" else None
            if key:
                self.objs_out[key] = o
            self.resolved[k] = key
        return self.resolved[k]

    def get(self, key):
        if key not in self.info:
            sp = self.objs_out[key].read()
            r = sp.m_Rect
            piv = getattr(sp, "m_Pivot", None)
            px, py = (piv.x, piv.y) if piv is not None else (0.5, 0.5)
            lg, pid = key.split("|", 1)
            self.info[key] = {"bundle": lg, "pid": pid, "w": round(r.width), "h": round(r.height),
                              "px": round(px * r.width, 2), "py": round((1 - py) * r.height, 2),
                              "ppu": getattr(sp, "m_PixelsToUnits", 100) or 100}
        return self.info[key]


def _draw(nodes: dict, layers: list, all_layers: bool, sprites: _Sprites) -> list:
    """Draw list of the hierarchy at one moment. `layers` = [(curves, slots, local time, assets file)], lowest
    priority first: like Unity's timeline tracks on one Animator, each property comes from the last layer that
    animates it, the rest keep the scene's values."""
    def look(h, key):
        for cv, bp, lt, af in reversed(layers):
            slot = bp.get(h)
            ci = slot.get(key) if slot else None
            if ci is not None:
                v = cv.value(ci, lt)
                if v is not None:
                    return v, cv, af
        return None, None, None

    def val(h, key, default):
        v = look(h, key)[0]
        return default if v is None else v

    def world(node):
        x = y = 0.0
        sx = sy = 1.0
        active = True
        chain = []
        while node is not None:
            chain.append(node)
            node = node.parent
        for nd in reversed(chain):
            p = [val(nd.h, ("tr", 1, i), nd.pos[i]) for i in range(2)]
            s = [val(nd.h, ("tr", 3, i), nd.scale[i]) for i in range(2)]
            if nd.parent is not None:  # the root's own offset doesn't matter
                x += p[0] * sx
                y += p[1] * sy
            sx *= s[0]
            sy *= s[1]
            active = active and val(nd.h, "m_IsActive", 1.0 if nd.active else 0.0) > 0.5
        return x, y, sx, sy, active

    ops = []
    for h, nd in nodes.items():
        if not nd.renderer:
            continue
        x, y, sx, sy, active = world(nd)
        if all_layers and any("sprite" in bp.get(h, ()) for _cv, bp, _t, _af in layers):
            active = True  # layers a skill script switches on: show them when asked
        if not active or val(h, "m_Enabled", 1.0 if nd.renderer["enabled"] else 0.0) < 0.5:
            continue
        ref = nd.renderer["sprite"]
        spid = sprites.key(*ref) if ref else None
        v, cv, af = look(h, "sprite")
        if v is not None:
            i = int(round(v))
            spid = sprites.key(*cv.pptr[i], af) if 0 <= i < len(cv.pptr) else None
        if not spid:
            continue
        info = sprites.get(spid)
        alpha = val(h, "m_Color.a", nd.renderer["alpha"])
        if alpha <= 0.01:
            continue
        flip = (val(h, "m_FlipX", 1.0 if nd.renderer["flipx"] else 0.0) > 0.5) != (sx < 0)
        order = val(h, "m_SortingOrder", nd.renderer["order"])
        ppu = info["ppu"]
        ops.append((order, [spid, round(x * ppu, 1), round(-y * ppu, 1), int(flip), round(min(alpha, 1.0), 3),
                            round(abs(sx), 3), round(abs(sy), 3)]))
    ops.sort(key=lambda o: o[0])
    return [o[1] for o in ops]


def _push(frames: list, f: int, ops: list):
    if frames and frames[-1]["ops"] == ops:
        frames[-1]["d"] += 1
    else:
        frames.append({"f": f, "d": 1, "ops": ops})


def render_clip(bundle_path: str, clip_pid: int, go_pid: int, all_layers: bool = False, logical: str = "",
                resolve=None, max_frames: int = 1500) -> dict:
    """Sample the clip into frames: {"fps", "duration", "frames": [{"f", "d", "ops": [[key, x, y, flip, alpha, sx, sy]]}],
    "sprites": {key: {bundle, pid, w, h, px, py}}}. x/y are pixel offsets of the sprite pivot from the character
    origin. Sprites can live in other bundles: `resolve(assets_file, file_id, path_id) -> (bundle, obj)`."""
    env = _env(bundle_path)
    with _lock:
        objs = {o.path_id: o for o in env.objects}
        clip_obj = objs[clip_pid]
        cv = Curves(clip_obj.parse_as_dict())
        bp = bind_slots(cv)
        nodes = build_hierarchy(objs, go_pid)
        sprites = _Sprites(objs, logical, resolve)
        dur = max(cv.stop - cv.start, 0.0)
        n = max(1, min(max_frames, int(round(dur * cv.rate)) + 1))
        frames = []
        for f in range(n):
            _push(frames, f, _draw(nodes, [(cv, bp, cv.start + f / cv.rate, clip_obj.assets_file)], all_layers, sprites))
    return {"fps": cv.rate, "duration": dur, "frames": frames, "sprites": sprites.info, "_objs": sprites.objs_out}


# ------------------------------------------------------------------ GIF
def render_any(bundle_path: str, clip_id: str, go_pid: int, all_layers: bool = False, logical: str = "", resolve=None) -> dict:
    """A plain clip (pid) or a timeline ("tl:<pid>")."""
    clip_id = str(clip_id)
    if clip_id.startswith("tl:"):
        env = _env(bundle_path)
        with _lock:
            objs = {o.path_id: o for o in env.objects}
            tl = next((x for x in list_timelines(objs) if x["clip"] == clip_id), None)
        binds = tl["binds"] if tl else {}
        base = next((c for c in list_clips(bundle_path) if c["animator_go"] == str(go_pid)
                     and c["name"].lower().endswith("_default")), None)
        return render_timeline(bundle_path, int(clip_id[3:]), go_pid, all_layers, logical, resolve, binds,
                               int(base["clip"]) if base else None)
    return render_clip(bundle_path, int(clip_id), go_pid, all_layers, logical, resolve)


def clip_gif(bundle_path: str, clip_id: str, go_pid: int, all_layers: bool = False, speed: float = 1.0,
             logical: str = "", resolve=None) -> bytes:
    """The clip rendered into an animated GIF with the clip's own timing."""
    from PIL import Image

    r = render_any(bundle_path, clip_id, go_pid, all_layers, logical, resolve)
    sp = r["sprites"]
    boxes = []
    for fr in r["frames"]:
        for pid, x, y, flip, a, sx, sy in fr["ops"]:
            s = sp[pid]
            px = (s["w"] - s["px"]) if flip else s["px"]
            boxes.append((x - px * sx, y - s["py"] * sy, x + (s["w"] - px) * sx, y + (s["h"] - s["py"]) * sy))
    if not boxes:
        raise KeyError("nothing visible in this clip")
    x0, y0 = min(b[0] for b in boxes), min(b[1] for b in boxes)
    x1, y1 = max(b[2] for b in boxes), max(b[3] for b in boxes)
    W, H = int(x1 - x0) + 2, int(y1 - y0) + 2
    imgs = {}
    frames, durations = [], []
    with _lock:
        for fr in r["frames"]:
            c = Image.new("RGBA", (W, H), (0, 0, 0, 0))
            for pid, x, y, flip, a, sx, sy in fr["ops"]:
                key = (pid, flip, sx, sy)
                if key not in imgs:
                    im = r["_objs"][pid].read().image.convert("RGBA")
                    if flip:
                        im = im.transpose(Image.FLIP_LEFT_RIGHT)
                    if (sx, sy) != (1, 1):
                        im = im.resize((max(1, int(im.width * sx)), max(1, int(im.height * sy))), Image.LANCZOS)
                    imgs[key] = im
                im = imgs[key]
                if a < 0.999:
                    im = im.copy()
                    im.putalpha(im.getchannel("A").point(lambda v, a=a: int(v * a)))
                s = sp[pid]
                px = (s["w"] - s["px"]) if flip else s["px"]
                c.alpha_composite(im, (int(round(x - px * sx - x0)), int(round(y - s["py"] * sy - y0))))
            frames.append(c)
            durations.append(max(20, int(round(fr["d"] * 1000 / r["fps"] / speed))))
    return _save_gif(frames, durations)


def _save_gif(frames: list, durations: list) -> bytes:
    """RGBA frames → animated GIF with one shared palette (index 255 = transparent).
    A fully empty frame (a character vanishing mid-skill) equals Pillow's disposal background, gets no bounding box
    and is written as a second global header — viewers stop there. Empty frames get a palette whose index 255 has
    another colour, so Pillow sees a difference and writes a proper full-size transparent frame."""
    import io
    from PIL import Image

    step = max(1, len(frames) // 24)
    sample = frames[::step]
    W, H = frames[0].size
    sheet = Image.new("RGB", (W, H * len(sample)))
    for i, c in enumerate(sample):
        sheet.paste(c.convert("RGB"), (0, i * H), c)
    master = sheet.quantize(colors=255, method=Image.Quantize.MEDIANCUT)
    p = master.getpalette()[:255 * 3]
    p = p + [0] * (255 * 3 - len(p))
    master.putpalette(p + p[:3])  # index 255: a copy of colour 0, never chosen first
    blank_pal = p + [255 - v for v in p[:3]]
    pal = []
    for c in frames:
        alpha = c.getchannel("A")
        if alpha.getextrema()[1] < 128:
            q = Image.new("P", c.size, 255)
            q.putpalette(blank_pal)
        else:
            q = c.convert("RGB").quantize(palette=master, dither=Image.Dither.NONE)
            q.paste(255, mask=alpha.point(lambda v: 255 if v < 128 else 0))
        pal.append(q)
    buf = io.BytesIO()
    pal[0].save(buf, "GIF", save_all=True, append_images=pal[1:], duration=durations, loop=0, disposal=2,
                transparency=255, optimize=False)
    return buf.getvalue()


# ------------------------------------------------------------------ timelines
TIMELINE_RE = re.compile(r"_(S(\d+)|Parrying)_Timeline_?([\w]*)$", re.I)


def list_timelines(objs: dict, owner: str = "") -> list[dict]:
    """Skill timelines (…_S2_Timeline_1, …_Parrying_Timeline_3) that animate the character through Animation
    Tracks — used by a few Identities instead of plain …_S1 clips."""
    directors = []
    for o in objs.values():
        if o.type.name == "PlayableDirector":
            try:
                d = o.parse_as_dict()
            except Exception:
                continue
            go = objs.get(d["m_GameObject"]["m_PathID"])
            binds = {}
            for b in d.get("m_SceneBindings") or []:
                k, v = b.get("key") or {}, b.get("value") or {}
                if k.get("m_FileID", 0) == 0 and v.get("m_FileID", 0) == 0:
                    binds[k.get("m_PathID")] = v.get("m_PathID")
            directors.append({"go": d["m_GameObject"]["m_PathID"], "name": (go.peek_name() if go else "") or "", "binds": binds})
    if not directors:
        return []
    main = (next((x for x in directors if owner and x["name"].startswith(owner)), None)
            or next((x for x in directors if x["name"].endswith("Appearance")), directors[0]))
    out = []
    for o in objs.values():
        if o.type.name != "MonoBehaviour":
            continue
        try:
            name = o.peek_name() or ""
        except Exception:
            continue
        m = TIMELINE_RE.search(name)
        if not m:
            continue
        out.append({"clip": f"tl:{o.path_id}", "name": name, "animator_go": str(main["go"]), "animator": main["name"],
                    "timeline": True, "skill": int(m.group(2)) if m.group(2) else None,
                    "part": m.group(3) or "", "binds": main["binds"]})
    return out


def render_timeline(bundle_path: str, tl_pid: int, go_pid: int, all_layers: bool = False, logical: str = "",
                    resolve=None, binds: dict | None = None, base_clip: int | None = None) -> dict:
    """Lay the Animation Tracks of a Timeline out in time (infinite 'Recorded' clips and timeline clips with
    start / clip-in / speed) and sample them like render_clip."""
    env = _env(bundle_path)
    with _lock:
        objs = {o.path_id: o for o in env.objects}
        tl = objs[tl_pid].parse_as_dict()
        fps = float((tl.get("m_EditorSettings") or {}).get("m_Framerate") or 60) or 60
        segments = []  # (start, duration, clip pid, clip-in, speed, root go)

        def track_root(track_pid):
            comp = (binds or {}).get(track_pid)
            o = objs.get(comp) if comp else None
            if o is not None and o.type.name == "Animator":
                return o.read().m_GameObject.path_id
            return go_pid

        def walk(track_pids):
            for tp in track_pids:
                t = objs.get(tp.get("m_PathID")) if tp.get("m_FileID", 0) == 0 else None
                if t is None:
                    continue
                try:
                    td = t.parse_as_dict()
                except Exception:
                    continue
                if td.get("m_Muted"):
                    continue
                if "m_InfiniteClip" in td:  # an AnimationTrack
                    root = track_root(t.path_id)
                    inf = (td.get("m_InfiniteClip") or {}).get("m_PathID")
                    if inf and inf in objs:  # a recorded clip: held to the end of the timeline (Unity's default)
                        segments.append((0.0, -1.0, inf, 0.0, 1.0, root))
                    for c in td.get("m_Clips") or []:
                        a = objs.get((c.get("m_Asset") or {}).get("m_PathID"))
                        try:
                            clip = (a.parse_as_dict().get("m_Clip") or {}).get("m_PathID") if a else None
                        except Exception:
                            clip = None
                        if clip and clip in objs:
                            segments.append((float(c.get("m_Start") or 0), float(c.get("m_Duration") or 0), clip,
                                             float(c.get("m_ClipIn") or 0), float(c.get("m_TimeScale") or 1) or 1.0, root))
                walk(td.get("m_Children") or [])

        walk(tl.get("m_Tracks") or [])
    with _lock:
        nodes = build_hierarchy(objs, go_pid)
        by_tpid = {nd.tpid: nd for nd in nodes.values()}
        sprites = _Sprites(objs, logical, resolve)
        # tracks bound to the same character are layers of one hierarchy (a "Recorded" track that only moves effects
        # must not draw the character a second time); a nested Animator (Warp) is mapped into the character's paths
        groups: dict[int, dict] = {go_pid: {"nodes": nodes, "layers": []}}
        remaps: dict[int, tuple[int, dict | None]] = {go_pid: (go_pid, None)}
        layers = []  # (start, duration, curves, slots, clip-in, speed, assets file, group, infinite, own)
        for start, dur, clip, clip_in, speed, root in segments:
            if root not in remaps:
                sub = build_hierarchy(objs, root)
                top = next((nd for nd in sub.values() if nd.parent is None), None)
                if top is not None and top.tpid in by_tpid:
                    remaps[root] = (go_pid, {h: by_tpid[nd.tpid].h for h, nd in sub.items() if nd.tpid in by_tpid})
                else:
                    remaps[root] = (root, None)
                    groups[root] = {"nodes": sub, "layers": []}
            g, remap = remaps[root]
            try:
                cv = Curves(objs[clip].parse_as_dict())
            except Exception:
                continue
            length = max(cv.stop - cv.start, 0.0)
            layers.append([start, dur if dur >= 0 else length, cv, bind_slots(cv, remap), clip_in, speed,
                           objs[clip].assets_file, g, dur < 0, root == go_pid])
        total = float(tl.get("m_FixedDuration") or 0) if tl.get("m_DurationMode") == 1 else 0.0
        if not total:
            total = max((ly[0] + ly[1] for ly in layers), default=0.0)
        for ly in layers:
            if ly[8]:
                ly[1] = max(ly[1], total)
        # between clips the character stands in its Default pose (the Animator state the timeline returns to)
        base = None
        if base_clip and base_clip in objs:
            try:
                bcv = Curves(objs[base_clip].parse_as_dict())
                base = (bcv, bind_slots(bcv), bcv.start, objs[base_clip].assets_file)
            except Exception:
                base = None
        n = max(1, int(round(total * fps)) + 1)
        frames = []
        for f in range(n):
            t = f / fps
            ops = []
            for g, grp in groups.items():
                active, main_covered = [], False
                for start, dur, cv, bp, clip_in, speed, af, lg, _inf, own in layers:
                    if lg != g or t < start - 1e-6 or t > start + dur + 1e-6:
                        continue
                    local = min(max((t - start) * speed + clip_in, 0.0), max(cv.stop - cv.start, 0.0))
                    active.append((cv, bp, cv.start + local, af))
                    main_covered = main_covered or own
                if g == go_pid and not main_covered and base:
                    active.insert(0, base)
                if active:
                    ops += _draw(grp["nodes"], active, all_layers, sprites)
            _push(frames, f, ops)
    return {"fps": fps, "duration": total, "frames": frames, "sprites": sprites.info, "_objs": sprites.objs_out}
