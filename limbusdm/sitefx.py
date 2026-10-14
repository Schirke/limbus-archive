"""The site's "With effects" tab: videos the app has rendered (with target, and with buffs) of Identities, E.G.O and
enemies (by their appearance prefab), kept in the site's files until the game or renderer changes."""
from __future__ import annotations

import json
import os
import re
import shutil
import threading
import time

VARIANTS = ("", "buffs")
FOLDER = re.compile(r"(\d{5}|[\w .()-]{1,120}?Appearance)(?:_(buffs))?")  # a render folder: <id or appearance>[_buffs]
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
           "none": m.get("none") or [], "old": m.get("old") or {}, "dropped": m.get("dropped") or [], "was": m.get("was")}
    if m.get("id") and m.get("id") != made:
        out["old"] = {c: sorted(v for v, names in vs.items() if names) for c, vs in out["have"].items()}
        out["none"] = []  # (what gave nothing may give something now)
        out["was"] = m["id"]
    return out


def _since(m: dict) -> int | None:
    """The renderer version the old videos came from when only it changed (same game version), else None."""
    was, now = (re.match(r"(.+)_v(\d+)$", x or "") for x in (m.get("was"), m.get("id")))
    return int(was.group(2)) if was and now and was.group(1) == now.group(1) else None


def _changed(svc, cid, since: int | None) -> bool:
    """Whether a new renderer draws cid differently (else its old videos stay)."""
    if since is None:
        return True
    try:
        from .viewer import render_changed
        return render_changed(svc, cid, since)
    except Exception:
        return True


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
        if f"{cid}:{v}" in m["dropped"]:  # (made again after drop)
            m["dropped"].remove(f"{cid}:{v}")
        old = [x for x in m.get("old", {}).get(str(cid), []) if x != v]
        if old:
            m["old"][str(cid)] = old
        else:
            m.get("old", {}).pop(str(cid), None)
    return len(got)


def _lists(ex, m: dict, before: dict):
    """What the tab asks before a video: video lists, skill names, buffs, and /api/site_fx."""
    cids = sorted(m["have"], key=lambda c: (not c.isdigit(), int(c) if c.isdigit() else 0, c))
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
        x = FOLDER.fullmatch(d)
        if x:
            c = x.group(1)
            n += _take(ex, m, int(c) if c.isdigit() else c, x.group(2) or "")
    ex.fresh[STAGE.replace("site: ", "")] = n
    _lists(ex, m, before)
    ex.write_manifest("fx", m)
    return m


def drop(svc, base_url: str, cid, v: str = "") -> int:
    """Takes one option set's videos off the site (with the next Send to site) and deletes its render, so "Render videos
    for the site" makes it again; returns how many videos went."""
    from .site import Exporter
    cid = int(cid) if str(cid).isdigit() else str(cid)
    if svc.fx.status(cid, v).get("state") == "running":
        raise RuntimeError("it is being rendered right now")
    ex = Exporter(svc, base_url)
    m = _read(ex)
    before, c = json.loads(json.dumps(m["have"])), str(cid)
    names = (m["have"].get(c) or {}).pop(v, None) or []
    for n in names:
        m["urls"].pop(_key("/api/fx_video", c, v, name=n), None)
        m["src"].pop(_key("/api/fx_video", c, v, name=n), None)
    if c in m["have"] and not any(m["have"][c].values()):
        del m["have"][c]
        for k in [_key("/api/fx", c, x) for x in VARIANTS] + [_key("/api/fx_buffs", c), _key("/api/skill_slots", c)]:
            m["urls"].pop(k, None)
    m["old"][c] = [x for x in m["old"].get(c, []) if x != v]
    if not m["old"][c]:
        del m["old"][c]
    m["none"] = [x for x in m["none"] if x != f"{c}:{v}"]
    if f"{c}:{v}" not in m["dropped"]:
        m["dropped"].append(f"{c}:{v}")
    shutil.rmtree(svc.fx.out_dir(cid, v), ignore_errors=True)
    _lists(ex, m, before)
    ex.write_manifest("fx", m)
    return len(names)


def _ids(svc) -> list[int]:
    return [c["id"] for s in svc.characters().get("sinners", []) for c in s["ids"] + s["egos"]]


def _apps(svc) -> list[str]:
    """Enemies and abnormalities drawn by a battle prefab (Animations' entries with an appearance)."""
    return list(dict.fromkeys(x["app"] for g in svc.characters().get("groups", []) for arr in g["kinds"].values() for x in arr if x.get("app")))


def counts(svc) -> dict:
    """How many Identities / E.G.O (and enemies) have videos on the site."""
    from .site import Exporter
    try:
        m = _read(Exporter(svc, ""))
        units = sum(1 for c in m["have"] if c.isdigit())
        out = {"have": units, "total": len(_ids(svc)), "videos": len(m["src"]), "old": len(m["old"]), "running": False,
               "enemies": {"have": len(m["have"]) - units, "total": len(_apps(svc))}}
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


def _buffs(svc, ex, progress) -> dict:
    """Buff effects' videos (Database → Buff effects) the site has none of at this game and renderer version."""
    from .site import _game, url_key
    bf = svc.buff_fx
    site = ex.read_manifest("buffs")
    on_site = site.get("urls", {}) if _game(site.get("id")) == _game(os.path.basename(bf.folder())) else {}
    bf.start([n for n in bf.db()["fx"] if url_key("/api/buff_video", name=n) not in on_site])
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
    ex = Exporter(svc, base_url)
    buffs = _buffs(svc, ex, progress)  # (first: a few minutes, the skills take hours)
    if _stop.is_set():
        return {"buffs": buffs}
    m = _read(ex)
    before = json.loads(json.dumps(m["have"]))
    todo = []
    for cid in _ids(svc) + _apps(svc):  # (Identities and E.G.O first)
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
    since, same = _since(m), {}
    for i, (cid, v) in enumerate(todo):
        if _stop.is_set():
            break
        label = f"{cid}{' with buffs' if v else ''}"
        progress("site: rendering skills", i, len(todo), label)
        if v in m["old"].get(str(cid), []) and (m["have"].get(str(cid)) or {}).get(v):
            if cid not in same:
                same[cid] = not _changed(svc, cid, since)
            if same[cid]:  # (the new renderer draws it as before: its videos stay)
                m["old"][str(cid)] = [x for x in m["old"][str(cid)] if x != v]
                if not m["old"][str(cid)]:
                    del m["old"][str(cid)]
                ex.write_manifest("fx", m)
                continue
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
