"""Abnormality logs: the Sinners' observation logs of each Abnormality (Localize EN_AbnormalityGuides*), who wrote each."""
from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3

from .paths import resource_dir
from .units import SINNERS

VERSION = 6
# writers guessed from the texts' style, by text key
AUTHORS = os.path.join("ui", "abno_authors.json")
OTHERS = ["LCE"]  # (Canto IX: the logs are LCE's researchers' notes)
WHERE = {"mirror": "Mirror Dungeon", "mowe": "Murder on the WARP Express", "tkt": "Timekilling Time", "pilgrimage": "Pilgrimage of Compassion"}


def _json(path: str) -> list:
    try:
        with open(path, encoding="utf-8-sig") as f:
            return json.load(f).get("dataList") or []
    except (OSError, ValueError):
        return []


def _name(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", s or "")).strip()


def key(text: str) -> str:
    return hashlib.sha1(text.strip().encode()).hexdigest()[:12]


def _where(fn: str, gid: int) -> tuple[float, str]:
    """(order, label) from the text file's name, for logs whose Abnormality no Story map stage has."""
    tag = re.sub(r"^EN_AbnormalityGuides[-_]?|\.json$", "", fn).lower()
    if not tag and 8000 <= gid < 9000:  # (the main file's Mirror Dungeon ids; the first Railway's from 8500, the second's from 8549)
        return (111, "Refraction Railway 1") if 8500 <= gid < 8549 else (100, "Mirror Dungeon")
    m = re.match(r"a1c(10|11|12|\d)", tag)
    if m:
        return int(m[1]), f"Canto {m[1]}"
    m = re.match(r"(refraction|walpu)(\d+)", tag)
    if m:
        return (110 if m[1] == "refraction" else 120) + int(m[2]), f"{'Refraction Railway' if m[1] == 'refraction' else 'Walpurgis Night'} {m[2]}"
    return {"mirror": 100}.get(tag, 200), WHERE.get(tag, "Story" if not tag else "Event")


def _chapters(svc) -> dict[int, tuple[float, str]]:
    """{unit id: (order, label)} of the first Story map chapter that fights it."""
    try:
        db = svc.stage_db()
    except Exception:
        return {}
    first: dict[int, tuple[float, str]] = {}
    for c in sorted(db.get("chapters") or [], key=lambda c: (bool(c.get("hard")), c.get("order") or 0)):
        label = re.sub(r"\s*·\s*Hard$", "", c.get("label") or "")
        for n in c.get("nodes") or []:
            for f in [n] + list(n.get("fights") or []):
                for w in f.get("waves") or []:
                    for u in (w.get("units") or []) + (w.get("more") or []):
                        first.setdefault(u[0], (c.get("order") or 0, label))
    return first


def build(svc) -> dict:
    """{"list": [{id, ids, code, name, clue, risk, pic, apps, where, order, logs: [{lv, text, h}]}]} in Story order; the same logs
    under several ids are one."""
    en = os.path.join(svc.game.data or "", "Assets", "Resources_moved", "Localize", "en")
    units = {}
    for files in svc.static_tables(["abnormality-unit"]).values():
        for js in files.values():
            for u in (js.get("list") if isinstance(js, dict) else js) or []:
                if isinstance(u, dict) and isinstance(u.get("id"), int):
                    units.setdefault(u["id"], u)
    con = sqlite3.connect(svc.ensure_browse())
    try:
        pics = {os.path.splitext(c.rsplit("/", 1)[-1])[0]: c for (c,) in con.execute(
            "select distinct c from o where type = 'Sprite' and c like '%/Sprite/Unit/Portrait/%_portrait.png'")}
    finally:
        con.close()
    chapters = _chapters(svc)

    def pic(gid: int) -> str:
        u = units.get(gid) or {}
        return next((pics[f"{c}_portrait"] for c in (u.get("sdPortrait"), gid, u.get("originID")) if c and f"{c}_portrait" in pics), "")

    def apps(gid: int) -> list[str]:  # its own look, then the unit it comes from
        u = units.get(gid) or {}
        return [a for a in (u.get("appearance"), (units.get(u.get("originID")) or {}).get("appearance")) if a]

    guides = {}
    for fn in sorted(os.listdir(en)) if os.path.isdir(en) else []:
        if re.match(r"EN_AbnormalityGuides([-_].+)?\.json$", fn):
            for r in _json(os.path.join(en, fn)):
                if isinstance(r.get("id"), int):
                    guides[r["id"]] = (fn, r)
    out: dict[tuple, dict] = {}
    for gid, (fn, r) in sorted(guides.items()):
        # (the text as the game has it: translations are looked up by it)
        logs = [{"lv": s.get("level") or 0, "text": s["story"], "h": key(s["story"])} for s in r.get("storyList") or [] if (s.get("story") or "").strip()]
        if not logs:
            continue
        name = _name(r.get("name")) or r.get("codeName") or str(gid)
        k = (name, tuple(x["h"] for x in logs))
        u = units.get(gid) or {}
        where = min([chapters[i] for i in (gid, u.get("originID")) if i in chapters] or [_where(fn, gid)])
        if k in out:
            e = out[k]
            e["ids"].append(gid)
            e["pic"] = e["pic"] or pic(gid)
            e["apps"] += [a for a in apps(gid) if a not in e["apps"]]
            if where[0] < e["order"]:
                e["order"], e["where"] = where[0], [where[1]]
            continue
        out[k] = {"id": gid, "ids": [gid], "code": _name(r.get("codeName")), "name": name,
                  "clue": "" if (r.get("clue") or "").strip().lower() in ("", "clue") else r["clue"],
                  "risk": u.get("classType") or "", "pic": pic(gid), "apps": apps(gid), "order": where[0], "where": [where[1]], "logs": logs}
    return {"list": sorted(out.values(), key=lambda e: (e["order"], e["id"])), "v": VERSION}


def authors(svc) -> dict:
    """{text key: {who, guess, replies}}: the guesses (replies: who says each "→" line)."""
    try:
        with open(os.path.join(resource_dir(), AUTHORS), encoding="utf-8") as f:
            return {k: {"who": v["who"], "guess": bool(v.get("guess")), "replies": v.get("replies") or []} for k, v in json.load(f).items()}
    except (OSError, ValueError):
        return {}


def _skeleton(found: list) -> dict:
    """The idle-looking skeleton of a look (not a death or destruction one)."""
    return next((x for x in found if not re.search(r"destroy|dead|broken|_die", x.get("base", ""), re.I)), found[0])


def get(svc) -> dict:
    sid = svc.latest_snapshot_id()
    if not sid:
        return {"list": [], "sinners": SINNERS, "others": OTHERS}
    kept = getattr(svc, "_abnologs", None)
    if not kept or kept[0] != sid:
        rel = f"abnologs/{sid}.json.gz"
        db = svc.store.read_json(rel)
        if db is None or db.get("v") != VERSION or not db.get("list"):
            db = build(svc)
            if db["list"]:
                svc.store.write_json(rel, db)
        svc._abnologs = kept = (sid, db)
    who = authors(svc)
    drawn = os.path.join(svc.data_dir, "enemy_thumbs")  # (the handbook's battle looks drawn so far)
    try:
        spines = svc.enemy_spines()
    except Exception:
        spines = {}
    out = []
    for a in kept[1]["list"]:
        thumb = next((x for x in a["apps"] if os.path.exists(os.path.join(drawn, x + ".png"))), "")
        sk = next((spines[x] for x in reversed(a["apps"]) if spines.get(x)), None)  # (the unit it comes from first: its full look)
        out.append({**a, "app": thumb, "spine": {k: v for k, v in _skeleton(sk).items() if k in ("bundle", "atlas")} if sk else None,
                    "logs": [{**x, **who.get(x["h"], {"who": ""})} for x in a["logs"]]})
    return {"list": out, "sinners": SINNERS, "others": OTHERS}
