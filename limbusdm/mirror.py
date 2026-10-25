"""Tools → Mirror Dungeon planner: theme packs, their E.G.O gifts and fusion recipes, from StaticData."""
from __future__ import annotations

import re

from .units import _load

VERSION = 8
SINS = {"CRIMSON": "Wrath", "SCARLET": "Lust", "AMBER": "Sloth", "SHAMROCK": "Gluttony", "AZURE": "Gloom", "INDIGO": "Pride", "VIOLET": "Envy"}


def build(tables: dict, loc_dir: str, gift_pics: dict, pack_pics: dict) -> dict:
    """{packs, gifts, fus, modes}"""
    gname, pname = _load(loc_dir, r"EN_EGOgift.*\.json$"), _load(loc_dir, r"EN_MirrorDungeonTheme.*\.json$")
    gdata, hid, rank = {}, set(), {}
    for fold in ("ego-gift", "ego-gift-mirrordungeon"):
        for name, t in (tables.get(fold) or {}).items():
            for g in (t.get("list") if isinstance(t, dict) else None) or []:
                # a gift listed twice (story copy without tags): the Mirror Dungeon one wins
                r = 2 * name.startswith("ego-gift-mirrordungeon") + any(str(x).startswith("TIER_") for x in g.get("tag") or [])
                if r > rank.get(g.get("id"), -1):
                    gdata[g.get("id")], rank[g.get("id")] = g, r
                if name.startswith("hidden"):
                    hid.add(g.get("id"))
    packs = []
    for t in (tables.get("mirrordungeon-theme-floor") or {}).values():
        for p in (t.get("list") if isinstance(t, dict) else None) or []:
            floors = {str(c["dungeonIdx"]): c.get("selectableFloors") or [0, 1, 2, 3, 4] for c in p.get("exceptionConditions") or [] if "dungeonIdx" in c}
            if not floors:
                continue
            ui = p.get("uiConfigs") or {}
            packs.append({"id": p["id"], "name": (pname.get(p["id"]) or {}).get("name") or str(p["id"]), "floors": floors,
                          "pool": p.get("egoGiftPool") or [], "excl": p.get("specificEgoGiftPool") or [],
                          "hard": p.get("difficulty") == "DIFFICULT", "pic": pack_pics.get(str(ui.get("packSpriteId") or "")) or "",
                          # the boss the game draws over the card (the "WARNING" packs only), the bosses it names
                          "boss": pack_pics.get(str(ui.get("bossSpriteId") or "")) or "", "bossUnits": _boss_units(tables, p),
                          "_gen": [p.get("mapGenOption"), p.get("mapGenSequence")]})
    packs.sort(key=lambda p: p["id"])
    _extra(tables, packs, set(gdata) - hid, how := {})
    fus: dict[int, list] = {}
    for t in (tables.get("mirror-dungeon-common-data") or {}).values():
        for c in ((t.get("egoGiftCombineFixedTable") or {}).get("combineFixed") if isinstance(t, dict) else None) or []:
            if c.get("resultEgoGiftId") and c.get("requiredEgoGiftIds") and c["requiredEgoGiftIds"] not in fus.get(c["resultEgoGiftId"], []):
                fus.setdefault(c["resultEgoGiftId"], []).append(c["requiredEgoGiftIds"])
    ids = {g for p in packs for g in p["pool"] + p["excl"]} | set(fus) | {g for rs in fus.values() for r in rs for g in r} | set(how)
    nm = lambda g: gname.get(((gdata.get(g) or {}).get("upgradeDataList") or [{}])[0].get("localizeID") or g) or gname.get(g) or {}  # noqa: E731
    # the rest of the game's gift list: a cursed gift's changed form (next id), the fusion-only EX
    adj = {x.get("reqEgogiftId") for t in (tables.get("mirror-dungeon-common-data") or {}).values() if isinstance(t, dict) for x in t.get("egogiftCombineProbAdjust") or []}
    for t in (tables.get("mirrordungeon-egogift-droppool") or {}).values():
        for x in (t.get("list") if isinstance(t, dict) else None) or []:
            for g in (x.get("egoGifts") or []) + (x.get("globalExcludeEgoGifts") or []):
                if g in ids or g in how or g not in gdata or g in hid:
                    continue
                m = re.search(r"changes after (\d+) Encounter wins", nm(g - 1).get("desc") or "")
                if m and g - 1 in ids:
                    how[g] = {"how": f"{nm(g - 1).get('name')} turns into it after {m[1]} Encounter wins", "min": (how.get(g - 1) or {}).get("min", 0)}
                    if g - 1 in how:
                        how[g - 1]["how"] += f" · turns into {nm(g).get('name')}"
                elif g in adj:
                    how[g] = {"how": "From a fusion"}
                else:
                    how[g] = {"how": "Mirror Dungeon"}
                ids.add(g)
    gifts = {}
    for g in sorted(ids):
        d = gdata.get(g) or {}
        n = nm(g)
        tier = next((t[5:] for t in d.get("tag") or [] if str(t).startswith("TIER_")), "")
        kw = d.get("keyword")
        gifts[g] = {"name": n.get("name") or f"Gift {g}", "kw": kw if kw and kw != "None" else "", "tier": int(tier) if tier.isdigit() else 0,
                    "sin": SINS.get(d.get("attributeType"), ""), "desc": re.sub(r"\[TabExplain\]", "", n.get("desc") or ""),
                    "pic": gift_pics.get(str(d.get("iconId") or g)) or gift_pics.get(str(g)) or "", "team": team_conds(n.get("desc") or "")}
        # "+" / "++": the game's texts of each upgrade level, changed parts in <style="upgradeHighlight">
        up = [gname.get(u.get("localizeID")) or {} for u in sorted(d.get("upgradeDataList") or [], key=lambda u: u.get("upgradeLevel") or 0) if u.get("upgradeLevel")]
        if up and all(u.get("desc") for u in up):
            gifts[g]["up"] = [{"name": u.get("name") or "", "desc": re.sub(r"\[TabExplain\]", "", u["desc"])} for u in up]
        if g in how:
            gifts[g].update(how[g])
    modes = {}
    for t in (tables.get("mirrordungeon") or {}).values():
        for d in (t.get("list") if isinstance(t, dict) else None) or []:
            if d.get("typeIndex") is not None:
                modes[str(d["typeIndex"])] = len(d.get("floors") or d.get("basicEnemyLevelPerFloor") or [])
    return {"packs": packs, "gifts": gifts, "fus": fus, "modes": modes, "start": _start(tables, loc_dir, gifts)}


def _boss_units(tables: dict, p: dict) -> list[int]:
    """A pack's bosses as unit ids: the ones its card shows, else the units of its boss fights."""
    ids = list((p.get("uiConfigs") or {}).get("showBossIds") or [])
    if not ids:
        fights = {b.get("id"): b for t in (tables.get("battle-mirrordungeon") or {}).values() for b in (t.get("list") if isinstance(t, dict) else None) or []}
        for bid in (p.get("mapGenOption") or {}).get("bossPool") or []:
            ids += [u.get("unitID") for w in (fights.get(bid) or {}).get("waveList") or [] for u in w.get("unitList") or []]
    return list(dict.fromkeys(i for i in ids if i))


def _start(tables: dict, loc_dir: str, gifts: dict) -> dict:
    """The game's "Starting E.G.O Gift Choice": {pools: [[keyword, [ids]]], bonus: [{name}]} (each bonus = one more pick)."""
    common = [t for _, t in sorted((tables.get("mirror-dungeon-common-data") or {}).items()) if isinstance(t, dict) and t.get("startEgoGiftPools")]
    pools = [[p["keyword"], [g for g in p.get("normalpool") or [] if g in gifts]] for p in (common[-1]["startEgoGiftPools"] if common else []) if p.get("keyword")]
    ui = _load(loc_dir, r"EN_MirrorDungeonUI.*\.json$")
    bonus = {}
    for _, t in sorted((tables.get("mirrordungeon-start-buffs") or {}).items()):
        for d in (t.get("list") if isinstance(t, dict) else None) or []:
            for b in d.get("buffs") or []:
                if any(e.get("type") == "ADDITIONAL_START_EGO_GIFT_SELECT" for e in b.get("effects") or []) and b.get("baseId") not in bonus:
                    bonus[b.get("baseId")] = (ui.get(b.get("localizeId")) or {}).get("content") or str(b.get("baseId"))
    return {"pools": [p for p in pools if p[1]], "bonus": [{"name": n} for _, n in sorted(bonus.items())]}


def _rewards(o) -> set:
    """EGO_GIFT reward ids anywhere inside a battle / event."""
    if isinstance(o, dict):
        got = {o["rewardId"]} if o.get("type") == "EGO_GIFT" and o.get("rewardId") else set()
        return got.union(*(_rewards(v) for v in o.values()))
    return set().union(*(_rewards(v) for v in o)) if isinstance(o, list) else set()


def _extra(tables: dict, packs: list, real: set, how: dict) -> None:
    """Gifts outside the packs' pools: rewards of a pack's fights / events (pack-only when 3 packs or fewer, e.g. the
    extreme bosses' gifts), the hidden fight of floors 11-15, events of many packs ({id: {how, min}} into `how`)."""
    src: dict[int, set] = {}
    for fold in ("battle-mirrordungeon", "abnormality-event"):
        for t in (tables.get(fold) or {}).values():
            for x in (t.get("list") if isinstance(t, dict) else None) or []:
                if isinstance(x, dict) and x.get("id"):
                    src.setdefault(x["id"], set()).update(_rewards(x))
    for t in (tables.get("acquirable-egogifts-in-event") or {}).values():
        for x in (t.get("list") if isinstance(t, dict) else None) or []:
            src.setdefault(x.get("eventId"), set()).update(x.get("egoGiftList") or [])
    known = {g for p in packs for g in p["pool"] + p["excl"]}
    owners: dict[int, list] = {}
    for p in packs:
        refs = {int(n) for n in re.findall(r"\d{5,7}", str([p.pop("_gen")]))}
        for g in set().union(*(src.get(r, set()) for r in refs)) - known:
            if g in real:
                owners.setdefault(g, []).append(p)
    for g, ps in owners.items():
        if len(ps) <= 3:
            for p in ps:
                p["excl"].append(g)
        else:
            how[g] = {"how": "From a random event"}
    for t in (tables.get("mirror-dungeon-common-data") or {}).values():
        hb = (t.get("hiddenBattleInfo") if isinstance(t, dict) else None) or {}
        lo = hb.get("minFloorCondition") or 11
        pr = max((x.get("prob") or 0 for x in hb.get("probInfo") or []), default=0)
        for b in hb.get("pool") or []:
            for g in src.get(b, set()) - known:
                if g in real:
                    how[g] = {"how": f"Hidden fight on floors {lo}–15" + (f" ({pr:.0%} a floor)" if pr else ""), "min": lo - 1}


def users(db: dict, units: dict) -> dict:
    """{[X]: Identity ids whose skills name it} for the gifts' "consume [X]" conditions (the page's texts may be translated)."""
    keys = {c["k"] for g in db["gifts"].values() for c in g.get("team") or [] if c["kind"] == "use"}
    out = {}
    for x in units.get("ids") or []:
        text = " ".join(str(u.get("desc") or "") + " " + " ".join(d for cs in u.get("coindescs") or [] for d in cs)
                        for s in x.get("skills") or [] for u in (s.get("up") or {}).values())
        for k in keys:
            if f"[{k}]" in text:
                out.setdefault(k, []).append(x["id"])
    return out


def team_conds(desc: str) -> list[dict]:
    """What a gift needs from the team to switch on: "5 or more Identities ... [Laceration]" (st), "... consume
    [BloodDinner]" (use), "3 or more Blade Lineage Identities" (fac); scope = field / all / bench."""
    out = []
    text = re.sub(r"<[^>]+>|[\"“”]", "", desc or "")
    # no threshold, stronger with more of them (n = 0): "number of Identities ... consume [X]", "all Bloodfiend allies"
    m = re.search(r"based on the number of Identities[^.]*?consume \[(\w+)\]", text)
    if m:
        out.append({"n": 0, "kind": "use", "k": m[1], "scope": "all" if "counts all units" in text else "field"})
    m = re.search(r"(?:[Aa]ll|of) ([A-Z][\w .'-]{2,40}?) allies", text)
    if m:
        out.append({"n": 0, "kind": "fac", "fs": [m[1]], "scope": "field"})
    for raw in re.split(r"\n|(?<=\.)\s|\s-\s", text):
        s = re.sub(r"\s+", " ", raw)
        if "activates" not in s.lower():
            continue
        scope = ("all" if re.search(r"count(?:s|ing) (?:all units|Backup)", s, re.I)
                 else "bench" if re.search(r"among the Backup", s, re.I) else "field")
        m = re.search(r"(\d+)(?:\+| or more) Identities (?:have (?:Attack )?Skills that|that) (?:apply or gain|apply|inflict|gain) \[(\w+)\]", s)
        if m:
            out.append({"n": int(m[1]), "kind": "st", "k": m[2], "scope": scope})
            continue
        m = re.search(r"(\d+)(?:\+| or more) Identities have (?:Attack )?Skills that consume \[(\w+)\]", s)
        if m:
            out.append({"n": int(m[1]), "kind": "use", "k": m[2], "scope": scope})
            continue
        m = re.search(r"(\d+)(?:\+| or more) (.+?)(?:-faction)? Identities", s)
        if m:  # faction names are checked against the Identities' on the page
            out.append({"n": int(m[1]), "kind": "fac", "fs": [f.strip() for f in m[2].split(" or ")], "scope": scope})
    return out
