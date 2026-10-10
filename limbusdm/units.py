"""Identity / E.G.O database built from the game's own tables (StaticData) and English localization,
so it follows every patch by itself."""
from __future__ import annotations

import json
import os
import re

SINS = {"CRIMSON": "Wrath", "SCARLET": "Lust", "AMBER": "Sloth", "SHAMROCK": "Gluttony", "AZURE": "Gloom",
        "INDIGO": "Pride", "VIOLET": "Envy", "WHITE": "White", "BLACK": "Black", "NEUTRAL": "None"}
ATK = {"SLASH": "Slash", "PENETRATE": "Pierce", "HIT": "Blunt", "NONE": ""}
DEF = {"GUARD": "Guard", "EVADE": "Evade", "COUNTER": "Counter", "ATTACK": "Attack"}
# the seven statuses teams are built around, in the game's order
STATUSES = ["Combustion", "Laceration", "Vibration", "Burst", "Sinking", "Breath", "Charge"]
SINNERS = ["Yi Sang", "Faust", "Don Quixote", "Ryōshū", "Meursault", "Hong Lu", "Heathcliff", "Ishmael",
           "Rodion", "Sinclair", "Outis", "Gregor"]
ASSET = "Assets/Resources_moved/Sprite/"
VERSION = 11  # bump when the database layout changes (cached per snapshot)


def _load(base: str, pattern: str) -> dict:
    out = {}
    if not os.path.isdir(base):
        return out
    for fn in sorted(os.listdir(base)):
        if not re.match(pattern, fn):
            continue
        try:
            with open(os.path.join(base, fn), encoding="utf-8-sig") as f:
                for r in json.load(f).get("dataList", []):
                    if isinstance(r, dict) and "id" in r:
                        out.setdefault(r["id"], r)
        except Exception:
            continue
    return out


def _records(tables: dict, folder: str) -> dict:
    out = {}
    for data in (tables.get(folder) or {}).values():
        for r in (data.get("list") or []) if isinstance(data, dict) else []:
            if isinstance(r, dict) and r.get("id") is not None:
                out.setdefault(r["id"], r)
    return out


def _date(n) -> str:
    s = str(n or "")
    return f"{s[:4]}-{s[4:6]}-{s[6:8]}" if len(s) == 8 else ""


def _one_line(s) -> str:
    return " ".join(str(s or "").split())


def skill_levels(rec: dict) -> dict[int, dict]:
    """{uptie level: merged skill data}: each level of skillData only lists what changed."""
    out, cur = {}, {}
    for lv in sorted(rec.get("skillData") or [], key=lambda d: d.get("gaksungLevel", 1)):
        cur = {**cur, **{k: v for k, v in lv.items() if k != "gaksungLevel"}}
        out[lv.get("gaksungLevel", 1)] = cur
    for n in range(1, 5):  # fill the gaps (levels without changes)
        if n not in out and n - 1 in out:
            out[n] = out[n - 1]
    return out


def _text_levels(loc: dict | None) -> dict[int, dict]:
    out = {}
    for lv in (loc or {}).get("levelList") or []:
        out[lv.get("level", 1)] = lv
    for n in range(1, 5):
        if n not in out and n - 1 in out:
            out[n] = out[n - 1]
    return out


def coin_kind(c: dict) -> str:
    """'super' = Unbreakable Coin (SuperCoin script), 'purple' / 'green' = the game's coloured coins, '' = plain."""
    if any((a or {}).get("scriptName") == "SuperCoin" for a in c.get("abilityScriptList") or []):
        return "super"
    col = (c.get("color") or "").lower()
    return col if col in ("purple", "green") else ""


def skill_info(sid: int, skills: dict, loc_skills: dict, copies: int | None = None) -> dict | None:
    rec = skills.get(sid)
    if not rec:
        return None
    lv, tx = skill_levels(rec), _text_levels(loc_skills.get(sid))
    ups = {}
    for n, d in lv.items():
        t = tx.get(n) or tx.get(max(tx) if tx else 0) or {}
        coins = d.get("coinList") or []
        ups[n] = {
            "sin": SINS.get(d.get("attributeType"), d.get("attributeType") or ""),
            "atk": ATK.get(d.get("atkType"), d.get("atkType") or ""),
            "def": DEF.get(d.get("defType"), d.get("defType") or ""),
            "base": d.get("defaultValue"), "coins": len(coins),
            "coin": (coins[0].get("scale") if coins else None),
            "op": (coins[0].get("operatorType") if coins else "ADD"),
            "coinkinds": [coin_kind(c) for c in coins],
            "level": d.get("skillLevelCorrection", 0), "targets": d.get("targetNum", 1),
            "sanity": d.get("mpUsage", 0),
            "name": _one_line(t.get("name")) or str(sid), "desc": t.get("desc") or "",
            "coindescs": [[c.get("desc", "") for c in (cl.get("coindescs") or [])] for cl in (t.get("coinlist") or [])],
        }
    out = {"id": sid, "type": rec.get("skillType"), "tier": rec.get("skillTier"), "up": ups}
    # enemies' skills mostly share another skill's picture (SkillIcon/<iconID>.png)
    icon = next((d.get("iconID") or d.get("iconId") for d in rec.get("skillData") or [] if d.get("iconID") or d.get("iconId")), None)
    if icon and str(icon) != str(sid):
        out["icon"] = icon
    if copies is not None:
        out["copies"] = copies
    return out


def passive_info(pid: int, passives: dict, loc_passives: dict, kind: str) -> dict:
    rec, t = passives.get(pid) or {}, loc_passives.get(pid) or {}
    cost = [{"sin": SINS.get(c.get("type"), c.get("type")), "n": c.get("value")}
            for c in rec.get("attributeStockCondition") or rec.get("attributeResonanceCondition") or []]
    mode = "owned" if rec.get("attributeStockCondition") else "res" if rec.get("attributeResonanceCondition") else ""
    return {"id": pid, "kind": kind, "name": _one_line(t.get("name")) or str(pid), "desc": t.get("desc") or "",
            "cost": cost, "mode": mode}


def threadspin(require: list | None) -> list[int]:
    """[from, to] Threadspin levels from the game's conditions: CheckAwakenLevel2 → [2, 0] (0 = and up),
    CheckAwakenLevelBetween_2_4 → [2, 4]."""
    for c in require or []:
        m = re.fullmatch(r"CheckAwakenLevel(?:Between_)?(\d+)(?:_(\d+))?", str(c))
        if m:
            return [int(m.group(1)), int(m.group(2) or 0)]
    return []


def build(tables: dict, loc_dir: str) -> dict:
    loc_ids = _load(loc_dir, r"EN_Personalities(-.*)?\.json$")
    loc_egos = _load(loc_dir, r"EN_Egos(-.*)?\.json$")
    loc_skills = _load(loc_dir, r"EN_Skills.*\.json$")
    loc_passives = _load(loc_dir, r"EN_Passives(-.*)?\.json$")
    loc_ego_passives = _load(loc_dir, r"EN_Passive_Ego(-.*)?\.json$")
    keywords = _load(loc_dir, r"EN_BattleKeywords.*\.json$")
    tags = _load(loc_dir, r"EN_SkillTag.*\.json$")
    assoc = _load(loc_dir, r"EN_AssociationName.*\.json$")
    skills = _records(tables, "skill")
    passives = _records(tables, "passive")
    id_passives = {r.get("personalityID"): r for d in (tables.get("personality-passive") or {}).values()
                   for r in (d.get("list") or []) if isinstance(r, dict)}

    ids = []
    for pid, r in sorted(_records(tables, "personality").items()):
        if not isinstance(pid, int) or not 10000 <= pid < 20000 or pid not in loc_ids:
            continue  # test / unreleased records without a name stay out
        loc = loc_ids[pid]
        sinner = int(str(pid)[1:3])
        sk = [skill_info(a["skillId"], skills, loc_skills, a.get("number")) for a in r.get("attributeList") or []]
        # extra skills the game never names are internal (helper / unused entries): leave them out
        sk = [s for s in sk if s and (s.get("copies") or any(u["name"] != str(s["id"]) for u in s["up"].values()))]
        dk = [skill_info(d, skills, loc_skills) for d in r.get("defenseSkillIDList") or []]
        pp = id_passives.get(pid) or {}
        pas = []
        for key, kind in (("battlePassiveList", "battle"), ("supporterPassiveList", "support")):
            # a passive listed again at a higher uptie is its upgraded version: keep the last one per name
            got: dict[str, dict] = {}
            for g in sorted(pp.get(key) or [], key=lambda g: g.get("level", 0)):
                for p in g.get("passiveIDList") or []:
                    info = passive_info(p, passives, loc_passives, kind)
                    if info["name"] == str(p) and not info["desc"]:
                        continue  # one the game never names or describes is internal (as with skills)
                    info["uptie"] = g.get("level")
                    got[info["name"]] = info
            pas += got.values()
        kws = r.get("skillKeywordList") or []
        ids.append({
            "id": pid, "sinner": sinner, "sinnerName": SINNERS[sinner - 1] if 1 <= sinner <= 12 else _one_line(loc.get("name")),
            "title": _one_line(loc.get("title")), "rank": r.get("rank"), "season": r.get("season"),
            "date": _date(r.get("updatedDate") or r.get("releaseDate")),
            "assoc": [_one_line((assoc.get(f"associationName_{a}") or {}).get("content")) or a.replace("_", " ").title()
                      for a in r.get("associationList") or []],
            "traits": r.get("unitKeywordList") or [],
            "keywords": kws, "statuses": [k for k in STATUSES if k in kws],
            "hp": (r.get("hp") or {}).get("defaultStat"), "hpLevel": (r.get("hp") or {}).get("incrementByLevel"),
            "def": r.get("defCorrection", 0),
            "speed": [list(zip(r.get("minSpeedList") or [], r.get("maxSpeedList") or []))],
            "stagger": (r.get("breakSection") or {}).get("sectionList") or [],
            "resist": {ATK.get(x.get("type"), x.get("type")): x.get("value")
                       for x in (r.get("resistInfo") or {}).get("atkResistList") or []},
            "skills": [s for s in sk if s], "defense": [s for s in dk if s], "passives": pas,
            "img": {"thumb": f"{ASSET}UnitCgThumbnail/Default/{pid}_normal.png",
                    "art": f"{ASSET}Unit/CG/{pid}_normal.png", "art2": f"{ASSET}Unit/CG/{pid}_gacksung.png"},
        })
        ids[-1]["speed"] = ids[-1]["speed"][0]

    egos = []
    for eid, r in sorted(_records(tables, "ego").items()):
        if not isinstance(eid, int) or not 20000 <= eid < 30000 or eid not in loc_egos:
            continue
        loc = loc_egos[eid]
        sinner = int(str(eid)[1:3])
        # some E.G.O have more skills in additionalList (Hollow: Le Trou → Boucher un trou): "Awakening 2", …
        # in the game's order; a skill listed again (the shared Corrosion) is shown once
        sets = [r] + [a for g in r.get("additionalList") or [] for a in g.get("additionalList") or []]
        sk = []
        for key, label in (("awakeningSkillId", "Awakening"), ("corrosionSkillId", "Corrosion")):
            for i, sid in enumerate(dict.fromkeys(a[key] for a in sets if a.get(key))):
                s = skill_info(sid, skills, loc_skills)
                if s:
                    s["label"] = label if not i else f"{label} {i + 1}"
                    sk.append(s)
        # the passive unlocks at Threadspin 2; some E.G.O have a second, upgraded one for a higher Threadspin
        pas = []
        for p in r.get("awakeningPassiveList") or []:
            if p not in loc_ego_passives:
                continue  # no text in the game: an internal helper
            info = passive_info(p, passives, loc_ego_passives, "ego")
            info["threadspin"] = threadspin((passives.get(p) or {}).get("requireIDList"))
            pas.append(info)
        egos.append({
            "id": eid, "sinner": sinner, "sinnerName": SINNERS[sinner - 1] if 1 <= sinner <= 12 else "",
            "name": _one_line(loc.get("name")), "grade": r.get("egoType"), "season": r.get("season"),
            "date": _date(r.get("updatedDate")),
            "cost": [{"sin": SINS.get(c.get("attributeType"), c.get("attributeType")), "n": c.get("num")}
                     for c in r.get("requirementList") or []],
            "resist": {SINS.get(x.get("type"), x.get("type")): x.get("value") for x in r.get("attributeResistList") or []},
            "skills": sk, "passives": pas,
            "img": {"thumb": f"{ASSET}Unit/Profile/Ego/{eid}_awaken_profile.png", "art": f"{ASSET}Unit/EgoCG/{eid}_cg.png"},
        })

    used = {k for x in ids for k in x["keywords"]} | set(STATUSES)
    kw = {k: _one_line((keywords.get(k) or {}).get("name")) or k for k in used}
    tag_names = {k: _one_line(v.get("name")) for k, v in tags.items() if v.get("name")}
    # names, descriptions, flavor text, buff / debuff and icon for the [Keyword] tokens used in descriptions
    buffs = _records(tables, "buff")
    kinds = {"Positive": "pos", "Negative": "neg"}
    glossary = {}
    for k, v in keywords.items():
        if not isinstance(k, str) or not v.get("name"):
            continue
        b = buffs.get(k) or {}
        glossary[k] = {"name": _one_line(v.get("name")), "desc": v.get("desc") or "", "flavor": v.get("flavor") or "",
                       "type": kinds.get(b.get("buffType"), "neu"), "icon": b.get("iconId") or b.get("iconID") or k}
    return {"ids": ids, "egos": egos, "keywords": kw, "statuses": STATUSES, "tags": tag_names,
            "glossary": glossary, "sins": [v for k, v in SINS.items() if k not in ("WHITE", "BLACK", "NEUTRAL")],
            "sinners": SINNERS}
