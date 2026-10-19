"""Games → lists the newer games ask for: Guess the arena (where each battle stage is from) and Guess the sound (the
battle announcers' lines and the E.G.O voice lines)."""
from __future__ import annotations

import re
from collections import Counter

from . import content

VERSION = 1


def _place(label: str) -> str:
    return re.sub(r"\s*[–—-]\s*Hard$", "", label or "").strip()


def arenas(svc) -> list[dict]:
    """[{name, places: [story chapter, …] (first = where it is first fought), abno: [entry id, name] | None}]"""
    sid, cached = svc.latest_snapshot_id(), getattr(svc, "_arenas", None)
    if cached and cached[0] == sid:
        return cached[1]
    places: dict[str, list[str]] = {}
    for c in svc.stage_db().get("chapters") or []:
        for n in c.get("nodes") or []:
            for f in [n] + list(n.get("fights") or []):
                for w in f.get("waves") or []:
                    got = places.setdefault(w.get("map") or "", [])
                    if _place(c["label"]) not in got:
                        got.append(_place(c["label"]))
    # every stage of every mode: which units are fought on a map (an abnormality's arena: the abnormality)
    units: dict[str, Counter] = {}
    for files in svc.static_tables(content.STAGE_TABLES).values():
        for data in files.values():
            for st in (data.get("list") or []) if isinstance(data, dict) else []:
                for w in (st or {}).get("waveList") or [] if isinstance(st, dict) else []:
                    m = ((w or {}).get("battleMapInfo") or {}).get("mapName")
                    for u in (w or {}).get("unitList") or [] if m else []:
                        if isinstance(u, dict) and isinstance(u.get("unitID"), int):
                            units.setdefault(m, Counter())[u["unitID"]] += 1
    entry = {}
    for e in svc.enemy_db().get("list") or []:
        for v in e.get("variants") or []:
            for uid in v.get("ids") or []:
                entry.setdefault(uid, e)
    out = []
    for m in _maps(svc):
        got = list(places.get(m) or [])
        canto = re.match(r"Cp(\d+)(?:RPG)?_", m)
        if not got and canto:
            got = [f"Canto {int(canto.group(1))}"]
        abno = None
        if m.startswith("Ab_"):
            for uid, _ in (units.get(m) or Counter()).most_common():
                e = entry.get(uid)
                if e and e.get("kind") == "Abnormality":
                    abno = [e["id"], e["name"], e.get("app") or ""]
                    break
        if got or abno:
            out.append({"name": m, "places": got, "abno": abno})
    svc._arenas = (sid, out)
    return out


def _maps(svc) -> list[str]:
    try:
        from .viewer import battle_maps
    except ImportError:  # (a public clone has no player)
        return []
    return [m["name"] for m in battle_maps(svc)]


def voices(svc) -> dict:
    """{"announcers": {name: [[bank, i, ms, text]]}, "egos": {E.G.O id: [[bank, i, ms, kind, text]]}}"""
    from . import soundlib
    db = svc.sound_lib()
    out: dict = {"announcers": {}, "egos": {}}
    ann = soundlib.find(db, ["Voicefiles", "Battle announcers"])
    for k in (ann or {}).get("kids") or []:
        if re.match(r"Announcer \d", k["name"]):
            continue
        rows = [[r[0], r[1], r[3], r[6]] for r in soundlib.items(db, k) if r[3] >= 900]
        if len(rows) >= 3:
            out["announcers"][k["name"]] = rows
    for r in _walk(soundlib.find(db, ["Voicefiles", "E.G.O"]), db):
        m = re.search(r"_(\d{5})_", r[2])
        if m and r[3] >= 900:
            out["egos"].setdefault(m.group(1), []).append([r[0], r[1], r[3], r[4], r[6]])
    return out


def _walk(node, db):
    from . import soundlib
    if not node:
        return
    yield from soundlib.items(db, node)
    for k in node.get("kids") or []:
        yield from _walk(k, db)
