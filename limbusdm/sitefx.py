"""The web copy's "With effects" tab (Animations): skills of the Identities and E.G.O rendered by the Unity player.

A browser can't render them, so the site shows the videos this app has made — two sets of options only: with the
target, and the same with the character's buffs (FX: VARIANTS). The app deletes a render an hour after it was last
watched (viewer.Renderer.prune); the site's copy is taken by "Send to site" while the render is there, or right after
each one by render_all (Settings → Website), and then stays in the site's own files until the game or the renderer
changes. The other options, and rendering itself, are in the app: ui/site/site.js says so on the tab."""
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
    """The site's videos as the manifest lists them. After a game patch (or a new renderer) they stay: "old" names the
    sets — {character: [options]} — still to be rendered again, and each is replaced when its new render is taken
    (the site used to lose every video at the first send after a patch)."""
    m, made = ex.read_manifest("fx"), _made(ex.svc)
    out = {"kind": "fx", "id": made, "urls": m.get("urls") or {}, "src": m.get("src") or {}, "have": m.get("have") or {},
           "none": m.get("none") or [], "old": m.get("old") or {}}
    if m.get("id") and m.get("id") != made:
        out["old"] = {c: sorted(v for v, names in vs.items() if names) for c, vs in out["have"].items()}
        out["none"] = []  # (what gave nothing may give something now)
    return out


def _take(ex, m: dict, cid: int, v: str) -> int:
    """The videos of one character rendered with one set of options, as they are now, into the site's files.
    Returns how many were taken anew."""
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
    """What the tab asks before it shows a video: which videos there are for each set of options, the skills' names,
    the character's buffs — and the site's own list of who has videos at all (/api/site_fx)."""
    cids = sorted(m["have"], key=int)
    want = []
    for c in cids:
        for v in VARIANTS:
            st = {"state": "idle", "videos": m["have"][c].get(v) or [], "available": True, "v": v, "kinds": {}}
            m["urls"][_key("/api/fx", c, v)] = ex._store(json.dumps(st).encode(), "application/json")
        k = _key("/api/fx_buffs", c)
        if k not in m["urls"] or before.get(c) != m["have"][c]:
            try:  # (buff levels are other sets of options: not on the site; "Buffs" only where its videos are)
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
    """Part of "Send to site": the renders that are on the disk now join the ones the site already keeps."""
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
    """For Settings → Website: how many of the Identities and E.G.O have their videos in the site's files."""
    from .site import Exporter
    try:
        m = _read(Exporter(svc, ""))
        return {"have": len(m["have"]), "total": len(_ids(svc)), "videos": len(m["src"]), "old": len(m["old"]), "running": False}
    except Exception:
        return {"have": 0, "total": 0, "videos": 0, "running": False}


def stop():
    _stop.set()


def render_all(svc, base_url: str, progress=None) -> dict:
    """Render every Identity's and E.G.O's skills that the site has no videos of — with the target, and with its
    buffs where it has any — and take each into the site's files as it is done. Hours of work the first time; it
    can be stopped (stop()) and goes on from where it was the next time. Nothing is uploaded: "Send to site" does."""
    from .buffs import unit_buffs
    from .site import Exporter
    progress = progress or (lambda stage, done, total, msg="": None)
    _stop.clear()
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
        else:  # nothing came out (no skill timelines, or the player failed): not tried again for this game version
            failed += 1
            m["none"].append(f"{cid}:{v}")
        ex.write_manifest("fx", m)
    _lists(ex, m, before)
    ex.write_manifest("fx", m)
    return {"fx": {"made": made, "failed": failed, "left": max(0, len(todo) - made - failed), "have": len(m["have"])}}
