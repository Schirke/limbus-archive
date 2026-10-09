"""Enemy handbook built from the game's own tables: every enemy, boss and abnormality with its HP, speed, stagger
thresholds, resistances (per part for the multi-part ones), skills, passives and the stages it is fought in.

StaticData enemy / abnormality-unit (+ abnormality-part) ← stage wave lists (see content.py) and English localization.
One entry per look and name; the same enemy with other numbers (a later chapter, Mirror Dungeon…) is a variant of it.
"""
from __future__ import annotations

import json
import os
import re

from . import content, units

VERSION = 3  # bump when the layout changes (cached per snapshot)
SIN_KEYS = [k for k in units.SINS if k not in ("WHITE", "BLACK", "NEUTRAL")]
EVENT = (3, 0, "Event")  # stages content.stage_label can't place (their ids overlap the main story's)


def _true(v) -> bool:
    return v is True or str(v).lower() == "true"


def _key(v):
    """Ids are numbers in most tables and strings in some fields ("sdPortrait": "1331")."""
    try:
        return int(v)
    except (TypeError, ValueError):
        return v


def _load_text(loc_dir: str, pattern: str, field: str) -> dict:
    return {k: units._one_line(v.get(field)) for k, v in units._load(loc_dir, pattern).items() if v.get(field)}


def _resolve(u: dict, enemies: dict, abnos: dict, depth: int = 0) -> dict:
    """A unit made from another one (originID) only lists what differs."""
    o = _key(u.get("originID", u.get("originId")))
    if o is None or depth > 4:
        return u
    base = (enemies.get(o) or abnos.get(o)) if _true(u.get("isOriginNormalEnemy")) else (abnos.get(o) or enemies.get(o))
    if not base or base is u:
        return u
    return {**_resolve(base, enemies, abnos, depth + 1), **u}


def _resists(info: dict | None) -> tuple[dict, dict]:
    info = info or {}
    atk = {units.ATK.get(x.get("type"), x.get("type")): x.get("value") for x in info.get("atkResistList") or []}
    sin = {units.SINS[x["type"]]: x.get("value") for x in info.get("attributeResistList") or [] if x.get("type") in SIN_KEYS}
    return atk, sin


def _body(r: dict) -> dict:
    """What a unit and an abnormality's part have in common: HP, speed, stagger, resistances."""
    hp = r.get("hp") or {}
    atk, sin = _resists(r.get("resistInfo"))
    lo, hi = r.get("minSpeedList") or [], r.get("maxSpeedList") or []
    return {"hp": hp.get("defaultStat"), "hpLevel": hp.get("incrementByLevel") or 0, "def": r.get("defCorrection") or 0,
            "speed": [lo[0], hi[0]] if lo and hi else [],
            "stagger": [p for p in (r.get("breakSection") or {}).get("sectionList") or [] if p and p > 0],
            "atk": atk, "sin": sin}


def _skill_ids(r: dict) -> list[int]:
    out = [a.get("skillId") for a in r.get("attributeList") or []]
    for pat in r.get("patternList") or []:
        for slot in pat.get("slotList") or []:
            for par in slot.get("skillParentList") or []:
                out += [c.get("skillID") for c in par.get("skillChildList") or []]
    return list(dict.fromkeys(_key(s) for s in out if s is not None))


def stage_units(tables: dict, chapters: dict) -> dict[int, list]:
    """{unit id: [((prio, order, label), stage id, level)]} from every stage's waves."""
    out: dict[int, list] = {}
    for table in content.STAGE_TABLES:
        for fname, data in (tables.get(table) or {}).items():
            for st in (data.get("list") or []) if isinstance(data, dict) else []:
                if not isinstance(st, dict) or not isinstance(st.get("id"), int):
                    continue
                lab = content.stage_label(table, fname, st["id"], chapters) or EVENT
                story = table in ("battle-story", "battle-ab", "battle-dungeon") and lab is not EVENT
                seen = set()
                for wave in st.get("waveList") or []:
                    for u in ((wave or {}).get("unitList") or []) + ((wave or {}).get("subUnitList") or []):
                        uid = (u or {}).get("unitID")
                        if isinstance(uid, int) and uid not in seen:
                            seen.add(uid)
                            out.setdefault(uid, []).append((lab, st["id"] if story else 0, u.get("unitLevel") or st.get("stageLevel") or 0))
    return out


def build(tables: dict, loc_dir: str) -> dict:
    chapters = content.load_chapters(loc_dir)
    names = content.load_unit_names(loc_dir)
    loc_skills = units._load(loc_dir, r"EN_Skills.*\.json$")
    loc_passives = units._load(loc_dir, r"EN_Passives?[-_.].*json$")
    kw_names = _load_text(loc_dir, r"EN_UnitKeyword.*\.json$", "content")
    assoc_names = _load_text(loc_dir, r"EN_AssociationName.*\.json$", "content")
    panics = units._load(loc_dir, r"EN_PanicInfo.*\.json$")
    nodes = units._load(loc_dir, r"EN_StageNode.*\.json$")
    skills, passives = units._records(tables, "skill"), units._records(tables, "passive")
    enemies, abnos = units._records(tables, "enemy"), units._records(tables, "abnormality-unit")
    part_recs = units._records(tables, "abnormality-part")
    where = stage_units(tables, chapters)

    used_skills: dict[int, dict] = {}
    used_passives: dict[int, dict] = {}

    def skill_list(ids):
        out = []
        for sid in ids:
            if sid not in used_skills:
                s = units.skill_info(sid, skills, loc_skills) if sid in loc_skills else None
                used_skills[sid] = s  # skills the game never names are internal helpers: left out
            if used_skills[sid]:
                out.append(sid)
        return out

    def passive_list(r):
        out = []
        for pid in (r.get("passiveSet") or {}).get("passiveIdList") or []:
            if pid in loc_passives and (loc_passives[pid].get("name") or loc_passives[pid].get("desc")):
                used_passives.setdefault(pid, units.passive_info(pid, passives, loc_passives, "enemy"))
                out.append(pid)
        return list(dict.fromkeys(out))

    def word(table, prefix, k):
        return table.get(f"{prefix}_{k}") or str(k).replace("_", " ").title()

    groups: dict[tuple, dict] = {}
    for table, recs in (("enemy", enemies), ("abnormality-unit", abnos)):
        for uid, raw in recs.items():
            u = _resolve(raw, enemies, abnos)
            # the abnormality-unit table holds every unit built of parts: a plain enemy remade that way says so, and of
            # the rest the ones with sanity are people (bosses), the ones without are abnormalities
            kind = ("Enemy" if table == "enemy" or _true(u.get("isOriginNormalEnemy"))
                    else "Boss" if _true(u.get("hasMp")) else "Abnormality")
            app = u.get("appearance") or ""
            name = names.get(_key(u.get("nameID"))) or names.get(uid) or ""
            stages = where.get(uid) or []
            if not name and not stages:
                continue  # neither named nor fought anywhere: test data
            parts = []
            for pid in u.get("abnormalityPartList") or []:
                p = part_recs.get(pid)
                if not p or not p.get("hp"):
                    continue
                parts.append({**_body(p), "name": names.get(_key(p.get("nameID"))) or names.get(pid) or "",
                              "type": str(p.get("partType") or "").title(), "breakable": _true(p.get("isDestroyable")),
                              "skills": skill_list(_skill_ids(p)), "passives": passive_list(p)})
            body = _body(u)
            if body["hp"] is None and parts:  # the whole is the sum of its parts
                body["hp"], body["hpLevel"] = sum(p["hp"] for p in parts), sum(p["hpLevel"] for p in parts)
            if body["hp"] is None:
                continue
            if len(parts) == 1 and not body["atk"]:  # a one-part unit keeps its numbers on the part
                p = parts[0]
                body.update({k: p[k] for k in ("stagger", "atk", "sin", "def") if p[k] or k == "def"})
                body["speed"] = body["speed"] or p["speed"]
            if not body["speed"] and parts:
                body["speed"] = [min(p["speed"][0] for p in parts if p["speed"]), max(p["speed"][1] for p in parts if p["speed"])] \
                    if any(p["speed"] for p in parts) else []
            panic = panics.get(_key(u.get("panicType"))) or {}
            info = {
                **body, "kind": kind, "cls": u.get("classType") or "", "attr": units.SINS.get(u.get("attributeType"), ""),
                "tags": [word(kw_names, "UnitKeyword", k) for k in u.get("unitKeywordList") or []],
                "assoc": [word(assoc_names, "associationName", k) for k in u.get("associationList") or []],
                "slots": u.get("maxActionSlotNum") or 1,
                "sanity": {"start": u.get("mp") or 0, "low": u.get("lowMorale"), "panic": u.get("panic"),
                           "name": units._one_line(panic.get("panicName")), "lowDesc": panic.get("lowMoraleDescription") or "",
                           "panicDesc": panic.get("panicDescription") or ""} if _true(u.get("hasMp")) else None,
                "skills": skill_list(_skill_ids(u)), "defense": skill_list(u.get("defenseSkillIDList") or []),
                "passives": passive_list(u), "parts": parts,
            }
            sig = json.dumps(info, sort_keys=True)
            label = name or re.sub(r"^\w*?\d+\w*?_|Appearance$", "", app).replace("_", " ") or str(uid)
            g = groups.setdefault((label, app or str(u.get("sdPortrait") or uid)),
                                  {"name": label, "app": app, "kind": kind, "variants": {},
                                   "portrait": [u.get("sdPortrait"), u.get("viewid"), u.get("nameID"), uid]})
            v = g["variants"].setdefault(sig, {**info, "ids": [], "where": []})
            v["ids"].append(uid)
            v["where"] += stages

    out = []
    for g in groups.values():
        variants = []
        for v in g["variants"].values():
            by_label: dict[tuple, dict] = {}
            for lab, stage, level in v.pop("where"):
                d = by_label.setdefault(lab, {"label": lab[2], "n": 0, "lv": [level, level], "stages": []})
                d["n"] += 1
                d["lv"] = [min(d["lv"][0], level), max(d["lv"][1], level)]
                if stage and len(d["stages"]) < 12:
                    node = nodes.get(stage) or {}
                    d["stages"].append({"id": stage, "title": units._one_line(node.get("title")),
                                        "place": units._one_line(node.get("place")), "lv": level})
            first = min(by_label) if by_label else (9, 0, "Not placed in a stage")
            v["stages"] = [by_label[k] for k in sorted(by_label)]
            v["first"] = first
            v["level"] = by_label[first]["lv"][0] if by_label else 1
            variants.append(v)
        variants.sort(key=lambda v: (v["first"], v["level"], v["ids"][0]))
        prio, order, label = variants[0]["first"]
        for v in variants:
            v["label"] = v.pop("first")[2]
        # one that is a boss or an abnormality anywhere is listed as one (as the earliest such look of it)
        kind = next((v["kind"] for v in variants if v["kind"] != "Enemy"), "Enemy")
        out.append({"id": variants[0]["ids"][0], "name": g["name"], "app": g["app"], "kind": kind, "label": label,
                    "group": label.split(" · ")[0], "prio": prio, "order": order, "portrait": g["portrait"],
                    "variants": variants})
    out.sort(key=lambda e: (e["prio"], e["order"], e["label"], e["id"]))
    groups_order = list(dict.fromkeys(e["group"] for e in out))
    return {"list": out, "skills": {k: v for k, v in used_skills.items() if v}, "passives": used_passives,
            "groups": groups_order}
