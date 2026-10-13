"""Announcers page: the battle announcers with their pictures and every line by situation (text + sound)."""
from __future__ import annotations

import json
import os
import re

VERSION = 1
SPRITES = "Assets/Resources_moved/Sprite/BattleAnnouncer/"
OTHER = "Other"


def _json(path: str) -> list:
    try:
        with open(path, encoding="utf-8-sig") as f:
            return json.load(f).get("dataList") or []
    except (OSError, ValueError):
        return []


def _name(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", s or "")).strip()


def build(svc) -> dict:
    """{"list": [{id, name, img, imgs, lines: [[number in "kinds", text, bank, i, ms]]}], "kinds": [situation label]}"""
    from . import soundlib
    sid = svc.latest_snapshot_id()
    en = os.path.join(svc.game.data or "", "Assets", "Resources_moved", "Localize", "en")
    names: dict[int, str] = {}
    for fn in sorted(os.listdir(en)) if os.path.isdir(en) else []:
        if re.match(r"EN_Announcer(-.+)?\.json$", fn):
            for r in _json(os.path.join(en, fn)):
                n = _name(r.get("name"))
                # (a story file hides a name as "??" until its chapter is cleared)
                if isinstance(r.get("id"), int) and n and (set(n) - set("? ") or r["id"] not in names):
                    names[r["id"]] = n
    types = {str(r.get("id")): _name(r.get("content")) for r in _json(os.path.join(en, "EN_AnnouncerVoiceType.json"))}
    text: dict[str, str] = {}
    dlg = os.path.join(en, "BattleAnnouncerDlg")
    for fn in os.listdir(dlg) if os.path.isdir(dlg) else []:
        for r in _json(os.path.join(dlg, fn)):
            text[str(r.get("id")).lower()] = (r.get("dlg") or "").strip()

    db = svc.sound_lib()
    sounds: dict[str, tuple] = {}

    def walk(node):
        for it in soundlib.items(db, node):
            sounds.setdefault(str(it[2]).lower(), (it[0], it[1], it[3]))
        for k in node.get("kids") or []:
            walk(k)
    node = soundlib.find(db, ["Voicefiles", "Battle announcers"])
    if node:
        walk(node)

    assets = {a.lower(): a for a in svc.load_snapshot(sid)["assets"] if a.startswith(SPRITES)} if sid else {}
    pic = lambda s: assets.get(f"{SPRITES}{s}.png".lower()) or ""
    by_ann: dict[int, list[str]] = {}
    for key in text:
        m = re.match(r"announcer_.+?_(\d+)_\d+(?:-\d+)?$", key)
        if m:
            by_ann.setdefault(int(m.group(1)), []).append(key)
    out = []
    for tables in (svc.static_tables(["announcer"]).get("announcer") or {}).values():
        for r in (tables or {}).get("list") or []:
            aid = r.get("id")
            if not isinstance(aid, int) or any(x["id"] == aid for x in out):
                continue
            kinds = sorted(((k.get("path") or "").lower(), k.get("voicetype") or "") for k in r.get("announcerKeywords") or [])
            lines = []
            for key in by_ann.get(aid, []):
                # (the longest path that fits: "announcer_enemy_break" before "announcer_enemy")
                kind = next((t for p, t in reversed(kinds) if p and key.startswith(f"{p}_{aid}_")), OTHER)
                s = sounds.get(key)
                if text[key] or s:
                    lines.append([kind, text[key], *(s or ("", -1, 0)), key])
            order = {t: n for n, (_, t) in enumerate(sorted(kinds, key=lambda k: list(types).index(k[1]) if k[1] in types else 999))}
            num = lambda k: [int(x) for x in re.findall(r"\d+", k)[-2:]]
            lines.sort(key=lambda l: (order.get(l[0], 999), num(l[5])))
            imgs = [p for p in map(pic, r.get("imgStrArray") or [r.get("imgStr")]) if p]
            if not lines:
                continue
            out.append({"id": aid, "name": names.get(aid) or _name(re.sub(r"_announcer.*$", "", r.get("imgStr") or "").replace("_", " ")) or f"Announcer {aid}", "img": pic(r.get("imgStr")) or (imgs[0] if imgs else ""),
                        "imgs": imgs, "lines": [l[:5] for l in lines]})
    out.sort(key=lambda x: x["id"])
    used = [t for t in [*types, OTHER] if any(l[0] == t for x in out for l in x["lines"])]
    used += sorted({l[0] for x in out for l in x["lines"]} - set(used))
    for x in out:
        for l in x["lines"]:
            l[0] = used.index(l[0])
    return {"list": out, "kinds": [types.get(t) or re.sub(r"(?<=[a-z])(?=[A-Z])", " ", t) for t in used], "v": VERSION}


def get(svc) -> dict:
    sid = svc.latest_snapshot_id()
    if not sid:
        return {"list": [], "kinds": []}
    kept = getattr(svc, "_announcers", None)
    if kept and kept[0] == sid:
        return kept[1]
    rel = f"announcers/{sid}.json.gz"
    db = svc.store.read_json(rel)
    if db is None or db.get("v") != VERSION or not db.get("list"):
        db = build(svc)
        if db["list"]:
            svc.store.write_json(rel, db)
    svc._announcers = (sid, db)
    return db
