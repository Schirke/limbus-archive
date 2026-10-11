"""The site's "With effects" tab: videos the app has rendered (with target, and with buffs), kept in the site's files until
the game or renderer changes."""
from __future__ import annotations

import json
import os
import re
import threading
import time

VARIANTS = ("", "buffs")
STAGE = "site: Skills with effects"
_stop = threading.Event()


def _made(svc) -> str:
    """What the renders are named by: the game version and the renderer's."""
    return os.path.basename(os.path.dirname(svc.fx.out_dir(0)))


def _key(path: str, cid, v: str = "", **q) -> str:
    from .site import url_key
    return url_key(path, id=cid, **({"v": v} if v else {}), **q)


def _read(ex) -> dict:
    """The site's videos; after a patch they stay and "old" lists the sets to render again."""
    m, made = ex.read_manifest("fx"), _made(ex.svc)
    out = {"kind": "fx", "id": made, "urls": m.get("urls") or {}, "src": m.get("src") or {}, "have": m.get("have") or {},
           "none": m.get("none") or [], "old": m.get("old") or {}}
    if m.get("id") and m.get("id") != made:
        out["old"] = {c: sorted(v for v, names in vs.items() if names) for c, vs in out["have"].items()}
        out["none"] = []  # (what gave nothing may give something now)
    return out


def _take(ex, m: dict, cid: int, v: str) -> int:
    """Take one character's videos of one option set into the site's files; returns how many are new."""
    fx = ex.svc.fx
    st = fx.status(cid, v)
    if st.get("state") == "running" or not st["videos"]:
        return 0
    d, todo, names = fx.out_dir(cid, v), [], []
    for n in st["videos"]:
        k = _key("/api/fx_video", cid, v, name=n)
        try:
            sig = next(os.path.getsize(os.path.join(d, n + e)) for e in (".webm", ".mp4") if os.path.isfile(os.path.join(d, n + e)))
        except (StopIteration, OSError):
            continue
        names.append(n)
        kept = m["urls"].get(k)
        if m["src"].get(k) != sig or not kept or not os.path.exists(os.path.join(ex.out, "d", kept)):  # (rendered again: another file)
            todo.append((k, sig))
    got = ex.fetch_all([k for k, _ in todo], {}, STAGE)
    for k, sig in todo:
        if k in got:
            m["urls"][k], m["src"][k] = got[k], sig
    names = [n for n in names if _key("/api/fx_video", cid, v, name=n) in m["urls"]]
    if names:
        for n in (m["have"].get(str(cid)) or {}).get(v) or []:  # (a video the new render has no more)
            if n not in names:
                m["urls"].pop(_key("/api/fx_video", cid, v, name=n), None)
                m["src"].pop(_key("/api/fx_video", cid, v, name=n), None)
        m["have"].setdefault(str(cid), {})[v] = names
        old = [x for x in m.get("old", {}).get(str(cid), []) if x != v]
        if old:
            m["old"][str(cid)] = old
        else:
            m.get("old", {}).pop(str(cid), None)
    return len(got)


def _lists(ex, m: dict, before: dict):
    """What the tab asks before a video: video lists, skill names, buffs, and /api/site_fx."""
    cids = sorted(m["have"], key=int)
    want = []
    for c in cids:
        for v in VARIANTS:
            st = {"state": "idle", "videos": m["have"][c].get(v) or [], "available": True, "v": v, "kinds": {}}
            m["urls"][_key("/api/fx", c, v)] = ex._store(json.dumps(st).encode(), "application/json")
        k = _key("/api/fx_buffs", c)
        if k not in m["urls"] or before.get(c) != m["have"][c]:
            try:  # buff levels not on the site; "Buffs" only where its videos are
                b = json.loads(ex._get(k)[0])
                b = {"levels": [], "notes": b.get("notes") or {}, "own": (b.get("own") or []) if m["have"][c].get("buffs") else []}
            except Exception:
                b = {"levels": [], "notes": {}, "own": []}
            m["urls"][k] = ex._store(json.dumps(b, ensure_ascii=False).encode("utf-8"), "application/json")
        want.append(_key("/api/skill_slots", c))
    m["urls"].update(ex.fetch_all(want, m["urls"], STAGE + " (skill names)"))
    listed = {c: [v for v in VARIANTS if m["have"][c].get(v)] for c in cids}
    m["urls"]["/api/site_fx"] = ex._store(json.dumps(listed).encode(), "application/json", gz=True)


def export(ex) -> dict:
    """Part of "Send to site": renders on disk join the site's."""
    m = _read(ex)
    before = json.loads(json.dumps(m["have"]))
    root = os.path.dirname(ex.svc.fx.out_dir(0))
    n = 0
    for d in sorted(os.listdir(root)) if os.path.isdir(root) else []:
        x = re.fullmatch(r"(\d{5})(?:_(buffs))?", d)
        if x:
            n += _take(ex, m, int(x.group(1)), x.group(2) or "")
    ex.fresh[STAGE.replace("site: ", "")] = n
    _lists(ex, m, before)
    ex.write_manifest("fx", m)
    return m


def _ids(svc) -> list[int]:
    return [c["id"] for s in svc.characters().get("sinners", []) for c in s["ids"] + s["egos"]]


def counts(svc) -> dict:
    """How many Identities / E.G.O have videos on the site."""
    from .site import Exporter
    try:
        m = _read(Exporter(svc, ""))
        out = {"have": len(m["have"]), "total": len(_ids(svc)), "videos": len(m["src"]), "old": len(m["old"]), "running": False}
    except Exception:
        out = {"have": 0, "total": 0, "videos": 0, "running": False}
    try:
        st = svc.buff_fx.status()
        out["buffs"] = {"have": len(st["have"]), "total": len(svc.buff_fx.db()["fx"]), "failed": len(st["failed"])}
    except Exception:
        pass
    return out


def stop():
    _stop.set()


def _buffs(svc, progress) -> dict:
    """Buff effects' videos (Database → Buff effects): every one not made at this renderer version."""
    bf = svc.buff_fx
    bf.start(None)
    total = bf.status()["queue"]
    while True:
        st = bf.status()
        if not st["busy"] and not st["queue"]:
            break
        if _stop.is_set():
            with bf.lock:
                bf.queue = []  # (the batch being rendered ends first)
        progress("site: rendering buff effects", max(0, total - st["queue"]), total, ", ".join(st["current"])[:80])
        time.sleep(1.5)
    st = bf.status()
    return {"have": len(st["have"]), "failed": len(st["failed"])}


def render_all(svc, base_url: str, progress=None) -> dict:
    """Render every skill the site lacks videos of and take each in; stoppable, resumes next time. Uploads nothing."""
    from .buffs import unit_buffs
    from .site import Exporter
    progress = progress or (lambda stage, done, total, msg="": None)
    _stop.clear()
    buffs = _buffs(svc, progress)  # (first: a few minutes, the skills take hours)
    if _stop.is_set():
        return {"buffs": buffs}
    ex = Exporter(svc, base_url)
    m = _read(ex)
    before = json.loads(json.dumps(m["have"]))
    todo = []
    for cid in _ids(svc):
        for v in VARIANTS:
            if v == "buffs":
                try:
                    if not unit_buffs(svc, cid):
                        continue
                except Exception:
                    continue
            if (not (m["have"].get(str(cid)) or {}).get(v) or v in m["old"].get(str(cid), [])) and f"{cid}:{v}" not in m["none"]:
                todo.append((cid, v))
    made = failed = 0
    for i, (cid, v) in enumerate(todo):
        if _stop.is_set():
            break
        label = f"{cid}{' with buffs' if v else ''}"
        progress("site: rendering skills", i, len(todo), label)
        if not svc.fx.status(cid, v)["videos"]:
            svc.fx.start(cid, None, v)
            time.sleep(0.5)
        while True:
            st = svc.fx.status(cid, v)
            if st.get("state") != "running":
                break
            progress("site: rendering skills", i, len(todo), f"{label} · {st.get('msg') or ''}")
            time.sleep(1.5)
        if _take(ex, m, cid, v) or ((m["have"].get(str(cid)) or {}).get(v) and v not in m["old"].get(str(cid), [])):
            made += 1
        else:  # nothing came out: not tried again this game version
            failed += 1
            m["none"].append(f"{cid}:{v}")
        ex.write_manifest("fx", m)
    _lists(ex, m, before)
    ex.write_manifest("fx", m)
    return {"fx": {"made": made, "failed": failed, "left": max(0, len(todo) - made - failed), "have": len(m["have"])}, "buffs": buffs}
