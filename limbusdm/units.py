"""Identity / E.G.O database from StaticData and English localization."""
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
VERSION = 20  # bump when the database layout changes (cached per snapshot)
NO_RES = re.compile(r"cannot gain E\.G\.O resources?", re.I)


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
        # an empty coinList at a later level means "unchanged" (Cinq East Hong Lu S2 / Counter at Uptie 4)
        cur = {**cur, **{k: v for k, v in lv.items() if k != "gaksungLevel" and not (k == "coinList" and not v and cur.get(k))}}
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
    """'super' = Unbreakable, 'purple' / 'green', '' = plain."""
    if any((a or {}).get("scriptName") == "SuperCoin" for a in c.get("abilityScriptList") or []):
        return "super"
    col = (c.get("color") or "").lower()
    return col if col in ("purple", "green") else ""


# coin scripts that put a status on the target this turn, for the damage breakdown: name → when ("" any hit, H heads, T tails)
GIVE_ON_HIT = {"GiveBuffOnSucceedAttack": "", "GiveBuffOnSucceedAttackHead": "H", "GiveBuffOnSucceedAttackTail": "T",
               "GiveBuffOnSucceedAttackIfUsableInDuel": ""}


def _inflicts(d: dict) -> list:
    """[[coin (-1 = every coin), status, Potency, Count, when]] from the skill's scripts."""
    out = []

    def take(i, lst):
        for a in lst or []:
            n, b = re.sub(r"\[.*$", "", a.get("scriptName") or ""), a.get("buffData") or {}
            if n in GIVE_ON_HIT and b.get("target") == "Target" and b.get("buffKeyword") and not b.get("activeRound"):
                out.append([i, b["buffKeyword"], b.get("stack") or 0, b.get("turn") or 0, GIVE_ON_HIT[n]])
    take(-1, d.get("abilityScriptList"))
    for i, c in enumerate(d.get("coinList") or []):
        take(i, c.get("abilityScriptList"))
    return out


# status abilities the breakdown reads: game name → short kind (dmg % / Offense Level / Final Power / Coin Power, target side: takes % / Defense)
BUFF_AB = {"AtkDamageMultiplierByStack": "dmg", "AtkDamageMultiplier": "dmg1", "AttackDmgMultiplier": "dmg1",
           "AtkAdderByStack": "ol", "AtkAdder": "ol1", "SkillPowerResultAdderAsStack": "fp", "SkillPowerResultAdder": "fp1",
           "AtkSkillPowerResultAdderAsStack": "fp", "SkillPowerAdderAsStack": "bp",
           "CoinScaleAdderByStack": "cp", "TakeAtkDamageMultiplierByStack": "take", "TakeAtkDamageMultiplier": "take1",
           "DefAdderByStack": "def", "DefAdder": "def1", "AtkAdderPerStack": "olper",
           "DefaultSkillDmgMultiplierViaBuffCheckDevideByStack": "dmg"}


def _buff_fx(b: dict) -> list:
    """[[kind, value, Slash/Pierce/Blunt or sin or "", cap %]] of a status ("olper": +1 Offense Level per value Stacks)."""
    out = []
    for a in b.get("list") or []:
        name, cap = a.get("ability") or "", None
        m = re.fullmatch(r"(?:DefaultAtkSkill)?(AtkDamageMultiplierByStack)WithLimit_(\d+)", name)
        if m:
            name, cap = m.group(1), int(m.group(2))
        k = BUFF_AB.get(name)
        if k and a.get("coinOperator", "ADD") == "ADD":
            out.append([k, a.get("value") or 0, ATK.get(a.get("atk"), "") or SINS.get(a.get("attribute"), "")] + ([cap] if cap else []))
    return out


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
        if d.get("atkType") not in (None, "NONE") and (inf := _inflicts(d)):
            ups[n]["inf"] = inf
    out = {"id": sid, "type": rec.get("skillType"), "tier": rec.get("skillTier"), "up": ups}
    # enemies' skills mostly share another skill's picture (SkillIcon/<iconID>.png)
    icon = next((d.get("iconID") or d.get("iconId") for d in rec.get("skillData") or [] if d.get("iconID") or d.get("iconId")), None)
    if icon and str(icon) != str(sid):
        out["icon"] = icon
    if copies is not None:
        out["copies"] = copies
    if ups and NO_RES.search(ups[max(ups)]["desc"]):
        out["nores"] = True
    return out


def passive_info(pid: int, passives: dict, loc_passives: dict, kind: str) -> dict:
    rec, t = passives.get(pid) or {}, loc_passives.get(pid) or {}
    cost = [{"sin": SINS.get(c.get("type"), c.get("type")), "n": c.get("value")}
            for c in rec.get("attributeStockCondition") or rec.get("attributeResonanceCondition") or []]
    mode = "owned" if rec.get("attributeStockCondition") else "res" if rec.get("attributeResonanceCondition") else ""
    return {"id": pid, "kind": kind, "name": _one_line(t.get("name")) or str(pid), "desc": t.get("desc") or "",
            "cost": cost, "mode": mode}


def _upgrade(got: dict, info: dict) -> None:
    """A passive repeated at a higher Uptie / Threadspin is its upgrade; the earlier one goes to "prev"."""
    old = got.get(info["name"])
    if old:
        info["prev"] = old.get("prev") if old["id"] == info["id"] else old


def threadspin(require: list | None) -> list[int]:
    """[from, to] Threadspin levels from the game's conditions (0 = and up)."""
    for c in require or []:
        m = re.fullmatch(r"CheckAwakenLevel(?:Between_)?(\d+)(?:_(\d+))?", str(c))
        if m:
            return [int(m.group(1)), int(m.group(2) or 0)]
    return []


def _trait_name(unit_kw: dict, code: str) -> str:
    """The game's text as it is (language tables match on it)."""
    return str((unit_kw.get(f"UnitKeyword_{code}") or {}).get("content") or "")


def _bare(s: str) -> str:
    return _one_line(re.sub(r"<[^>]*>", "", s))


def _traits(unit_kw: dict, codes: list) -> list[dict]:
    out = []
    for c in codes:
        name = _trait_name(unit_kw, c)
        if _bare(name) and not any(_bare(t["name"]) == _bare(name) for t in out):
            out.append({"name": name})
    return out


def build(tables: dict, loc_dir: str) -> dict:
    loc_ids = _load(loc_dir, r"EN_Personalities(-.*)?\.json$")
    loc_egos = _load(loc_dir, r"EN_Egos(-.*)?\.json$")
    loc_skills = _load(loc_dir, r"EN_Skills.*\.json$")
    # EN_Passives_check4.json: the reworked passives an Identity gets at Uptie 4
    loc_passives = _load(loc_dir, r"EN_Passives(-.*|_check\d+)?\.json$")
    loc_ego_passives = _load(loc_dir, r"EN_Passive_Ego(-.*)?\.json$")
    keywords = _load(loc_dir, r"EN_BattleKeywords.*\.json$")
    tags = _load(loc_dir, r"EN_SkillTag.*\.json$")
    assoc = _load(loc_dir, r"EN_AssociationName.*\.json$")
    # associations and unit keywords share UnitKeyword_<code>
    unit_kw = _load(loc_dir, r"EN_UnitKeyword.*\.json$")
    skills = _records(tables, "skill")
    passives = _records(tables, "passive")
    id_passives = {r.get("personalityID"): r for d in (tables.get("personality-passive") or {}).values()
                   for r in (d.get("list") or []) if isinstance(r, dict)}

    ids, events = [], []
    for pid, r in sorted(_records(tables, "personality").items()):
        if not isinstance(pid, int) or pid not in loc_ids:
            continue  # test / unreleased records without a name stay out
        event = not 10000 <= pid < 20000  # (an event's own Identities, 4000xx Sinnerlings: not playable in the main game)
        loc = loc_ids[pid]
        sinner = r.get("characterId") or 0 if event else int(str(pid)[1:3])
        sk = [skill_info(a["skillId"], skills, loc_skills, a.get("number")) for a in r.get("attributeList") or []]
        # extra skills the game never names are internal (helper / unused entries): leave them out
        sk = [s for s in sk if s and (s.get("copies") or any(u["name"] != str(s["id"]) for u in s["up"].values()))]
        dk = [skill_info(d, skills, loc_skills) for d in r.get("defenseSkillIDList") or []]
        pp = id_passives.get(pid) or {}
        pas = []
        for key, kind in (("battlePassiveList", "battle"), ("supporterPassiveList", "support")):
            # keep the last passive per name
            got: dict[str, dict] = {}
            for g in sorted(pp.get(key) or [], key=lambda g: g.get("level", 0)):
                for p in g.get("passiveIDList") or []:
                    info = passive_info(p, passives, loc_passives, kind)
                    if info["name"] == str(p) and not info["desc"]:
                        continue  # one the game never names or describes is internal (as with skills)
                    info["uptie"] = g.get("level")
                    _upgrade(got, info)
                    got[info["name"]] = info
            pas += got.values()
        kws = r.get("skillKeywordList") or []
        (events if event else ids).append({
            "id": pid, "sinner": sinner, "sinnerName": SINNERS[sinner - 1] if 1 <= sinner <= 12 else _one_line(loc.get("name")),
            "title": _one_line(loc.get("title")), "rank": r.get("rank"), "season": r.get("season"),
            "date": _date(r.get("updatedDate") or r.get("releaseDate")),
            "assoc": [_bare(_trait_name(unit_kw, a)) or _one_line((assoc.get(f"associationName_{a}") or {}).get("content"))
                      or a.replace("_", " ").title() for a in r.get("associationList") or []],
            "traitKw": _traits(unit_kw, (r.get("associationList") or []) + (r.get("unitKeywordList") or [])),
            "traits": r.get("unitKeywordList") or [],
            "keywords": kws, "statuses": [k for k in STATUSES if k in kws],
            "hp": (r.get("hp") or {}).get("defaultStat"), "hpLevel": (r.get("hp") or {}).get("incrementByLevel"),
            "def": r.get("defCorrection", 0),
            "speed": [list(zip(r.get("minSpeedList") or [], r.get("maxSpeedList") or []))],
            "stagger": (r.get("breakSection") or {}).get("sectionList") or [],
            "resist": {ATK.get(x.get("type"), x.get("type")): x.get("value")
                       for x in (r.get("resistInfo") or {}).get("atkResistList") or []},
            "skills": [s for s in sk if s], "defense": [s for s in dk if s], "passives": pas,
            "img": {"thumb": f"{ASSET}Unit/Profile/Normal/{pid}_normal_profile.png"} if event else
                   {"thumb": f"{ASSET}UnitCgThumbnail/Default/{pid}_normal.png",
                    "art": f"{ASSET}Unit/CG/{pid}_normal.png", "art2": f"{ASSET}Unit/CG/{pid}_gacksung.png"},
        })
        x = (events if event else ids)[-1]
        x["speed"] = x["speed"][0]
        if event:
            x["event"], x["appearance"] = True, r.get("appearance") or ""

    egos = []
    for eid, r in sorted(_records(tables, "ego").items()):
        if not isinstance(eid, int) or not 20000 <= eid < 30000 or eid not in loc_egos:
            continue
        loc = loc_egos[eid]
        sinner = int(str(eid)[1:3])
        # extra E.G.O skills from additionalList, each once
        sets = [r] + [a for g in r.get("additionalList") or [] for a in g.get("additionalList") or []]
        sk = []
        for key, label in (("awakeningSkillId", "Awakening"), ("corrosionSkillId", "Corrosion")):
            for i, sid in enumerate(dict.fromkeys(a[key] for a in sets if a.get(key))):
                s = skill_info(sid, skills, loc_skills)
                if s:
                    s["label"] = label if not i else f"{label} {i + 1}"
                    sk.append(s)
        # one passive per name, earlier versions in "prev"
        got = {}
        for p in r.get("awakeningPassiveList") or []:
            if p not in loc_ego_passives:
                continue  # no text in the game: an internal helper
            info = passive_info(p, passives, loc_ego_passives, "ego")
            info["threadspin"] = threadspin((passives.get(p) or {}).get("requireIDList"))
            info["uptie"] = (info["threadspin"] or [2])[0]
            _upgrade(got, info)
            got[info["name"]] = info
        pas = list(got.values())
        egos.append({
            "id": eid, "sinner": sinner, "sinnerName": SINNERS[sinner - 1] if 1 <= sinner <= 12 else "",
            "name": _one_line(loc.get("name")), "grade": r.get("egoType"), "season": r.get("season"),
            "date": _date(r.get("updatedDate")),
            "cost": [{"sin": SINS.get(c.get("attributeType"), c.get("attributeType")), "n": c.get("num")}
                     for c in r.get("requirementList") or []],
            "resist": {SINS.get(x.get("type"), x.get("type")): x.get("value") for x in r.get("attributeResistList") or []},
            "skills": sk, "passives": pas, "maxUp": r.get("maxEgoSyncLevel") or 4,
            "img": {"thumb": f"{ASSET}Unit/Profile/Ego/{eid}_awaken_profile.png", "art": f"{ASSET}Unit/EgoCG/{eid}_cg.png"},
        })

    factions = {t for x in ids for t in x["assoc"] + [k["name"] for k in x["traitKw"]] if len(t) > 3}
    for x in ids:
        if fu := follow_ups(x, factions):
            x["fu"] = fu

    used = {k for x in ids + events for k in x["keywords"]} | set(STATUSES)
    kw = {k: _one_line((keywords.get(k) or {}).get("name")) or k for k in used}
    tag_names = {k: _one_line(v.get("name")) for k, v in tags.items() if v.get("name")}
    # [Keyword] tokens: name, description, kind, icon
    buffs = _records(tables, "buff")
    kinds = {"Positive": "pos", "Negative": "neg"}
    glossary = {}
    for k, v in keywords.items():
        if not isinstance(k, str) or not v.get("name"):
            continue
        b = buffs.get(k) or {}
        glossary[k] = {"name": _one_line(v.get("name")), "desc": v.get("desc") or "", "flavor": v.get("flavor") or "",
                       "type": kinds.get(b.get("buffType"), "neu"), "icon": b.get("iconId") or b.get("iconID") or k}
        # for the damage breakdown: a status at all, Potency + Count, its cap, what it does to damage
        if b:
            glossary[k]["st"] = 2 if "SinBuff" in str(b.get("buffClass")) or b.get("maxTurn") else 1
            if b.get("maxStack"):
                glossary[k]["max"] = b["maxStack"]
            if fx := _buff_fx(b):
                glossary[k]["fx"] = fx
    return {"ids": ids, "egos": egos, "events": events, "keywords": kw, "statuses": STATUSES, "tags": tag_names,
            "glossary": glossary, "sins": [v for k, v in SINS.items() if k not in ("WHITE", "BLACK", "NEUTRAL")],
            "sinners": SINNERS}


# ---- extra uses of a skill the kit makes by name ("use 'X'"): each gives one of its sin like a dealt skill (team builder)
_USE = re.compile(r"(?<!not )\buse\s+(?:the\s+)?(?:[\"“‘](.+?)[\"”’]|'(.+?)'(?=[\s,.)]|$))(?!\s+(?:Skill\s+)?as (?:a )?Counter)", re.I)
# how often a line's condition holds in a turn: first match wins (the owner corrects them in Admin → Pages)
_ODDS = [(r"once per Encounter", .15), (r"Substituted in|Returned to the field", .1), (r"Staggered", .3),
         (r"less than \d+% HP|\d+%- HP", .2), (r"types of negative effects", .3),
         (r"\b(?:at|has|with) \d+\+? \[|\bat 0 \[", .5),
         (r"following Skills", .6), (r"\ball(?:y|ies|ied)\b.*\b(?:Attack|Skill|hits?)\b|attacked", .8)]


def _plain(s: str) -> str:
    return re.sub(r"\[TabExplain\]|<[^>]*>", "", s or "")


def _skill_key(n: str) -> str:
    return re.sub(r"\s*[\[【(].*$", "", _plain(n)).strip().lower()


def _team(text: str, factions: set) -> dict | None:
    """The allies a line needs: a faction ("Dawn Office" Identities, "Le Rouge" ally) or a status kind ([PersonalityCharge])."""
    if m := re.search(r"\ballied \[Personality(\w+)\]", text):
        return {"kw": m.group(1)}
    for f in sorted(factions, key=len, reverse=True):
        q = re.escape(f)
        if re.search(rf"(?<!non-)[\"“]?{q}[\"”]?(?:-faction)? (?:all(?:y|ies|ied)|Identit(?:y|ies))(?! including this unit)", text):
            return {"assoc": f}
    return None


def follow_ups(x: dict, factions: set) -> list:
    own = {}
    for s in x["skills"]:
        u = s["up"][max(s["up"])]
        own.setdefault(_skill_key(u["name"]), (s, u["sin"]))
    texts = [p["desc"] for p in x["passives"] if p["kind"] == "battle"]
    for s in x["skills"]:
        u = s["up"][max(s["up"])]
        texts += [u["desc"]] + [c for cl in u.get("coindescs") or [] for c in cl]
    got: dict[int, dict] = {}
    for t in texts:
        head = ""
        for line in _plain(t).split("\n"):
            line = line.strip()
            if not line:
                continue
            bullet = line[0] in "-·※•"
            if not bullet:
                head = line
            ctx = f"{head}\n{line}" if bullet else line
            for m in _USE.finditer(line):
                hit = own.get(_skill_key(m.group(1) or m.group(2)))
                if not hit:
                    continue
                s, sin = hit
                cond = re.sub(r"\(prioritiz[^)]*\)", "", line)
                p = next((v for pat, v in _ODDS if re.search(pat, cond)), .5)
                if re.search(r"If this unit has \[\w+\]", head) and bullet:
                    p *= .5  # (only in another form)
                fu = got.setdefault(s["id"], {"skill": s["id"], "sin": sin, "p": 0, "why": []})
                if line[:240] in fu["why"]:
                    continue
                fu["p"] = max(fu["p"], round(p, 2))  # (lines of one skill are mostly fallbacks of each other)
                if s.get("nores"):
                    fu["nores"] = True
                if "team" not in fu and (team := _team(ctx, factions)):
                    fu["team"] = team
                if re.search(r"per turn per Identity", ctx):
                    fu["each"] = True
                fu["why"].append(line[:240])
    return list(got.values())
