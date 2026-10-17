"""Tools → Mirror Dungeon planner: theme packs, their E.G.O gifts and fusion recipes, from StaticData."""
from __future__ import annotations

import re

from .units import _load

VERSION = 4
SINS = {"CRIMSON": "Wrath", "SCARLET": "Lust", "AMBER": "Sloth", "SHAMROCK": "Gluttony", "AZURE": "Gloom", "INDIGO": "Pride", "VIOLET": "Envy"}


def build(tables: dict, loc_dir: str, gift_pics: dict, pack_pics: dict) -> dict:
    """{packs, gifts, fus, modes}"""
    gname, pname = _load(loc_dir, r"EN_EGOgift.*\.json$"), _load(loc_dir, r"EN_MirrorDungeonTheme.*\.json$")
    gdata = {}
    for fold in ("ego-gift", "ego-gift-mirrordungeon"):
        for t in (tables.get(fold) or {}).values():
            for g in (t.get("list") if isinstance(t, dict) else None) or []:
                gdata.setdefault(g.get("id"), g)
    packs = []
    for t in (tables.get("mirrordungeon-theme-floor") or {}).values():
        for p in (t.get("list") if isinstance(t, dict) else None) or []:
            floors = {str(c["dungeonIdx"]): c.get("selectableFloors") or [0, 1, 2, 3, 4] for c in p.get("exceptionConditions") or [] if "dungeonIdx" in c}
            if not floors:
                continue
            ui = p.get("uiConfigs") or {}
            packs.append({"id": p["id"], "name": (pname.get(p["id"]) or {}).get("name") or str(p["id"]), "floors": floors,
                          "pool": p.get("egoGiftPool") or [], "excl": p.get("specificEgoGiftPool") or [],
                          "hard": p.get("difficulty") == "DIFFICULT", "pic": pack_pics.get(str(ui.get("packSpriteId") or "")) or ""})
    packs.sort(key=lambda p: p["id"])
    fus: dict[int, list] = {}
    for t in (tables.get("mirror-dungeon-common-data") or {}).values():
        for c in ((t.get("egoGiftCombineFixedTable") or {}).get("combineFixed") if isinstance(t, dict) else None) or []:
            if c.get("resultEgoGiftId") and c.get("requiredEgoGiftIds") and c["requiredEgoGiftIds"] not in fus.get(c["resultEgoGiftId"], []):
                fus.setdefault(c["resultEgoGiftId"], []).append(c["requiredEgoGiftIds"])
    ids = {g for p in packs for g in p["pool"] + p["excl"]} | set(fus) | {g for rs in fus.values() for r in rs for g in r}
    gifts = {}
    for g in sorted(ids):
        d = gdata.get(g) or {}
        n = gname.get(((d.get("upgradeDataList") or [{}])[0]).get("localizeID") or g) or gname.get(g) or {}
        tier = next((t[5:] for t in d.get("tag") or [] if str(t).startswith("TIER_")), "")
        kw = d.get("keyword")
        gifts[g] = {"name": n.get("name") or f"Gift {g}", "kw": kw if kw and kw != "None" else "", "tier": int(tier) if tier.isdigit() else 0,
                    "sin": SINS.get(d.get("attributeType"), ""), "desc": re.sub(r"\[TabExplain\]", "", n.get("desc") or ""),
                    "pic": gift_pics.get(str(d.get("iconId") or g)) or gift_pics.get(str(g)) or "", "team": team_conds(n.get("desc") or "")}
    modes = {}
    for t in (tables.get("mirrordungeon") or {}).values():
        for d in (t.get("list") if isinstance(t, dict) else None) or []:
            if d.get("typeIndex") is not None:
                modes[str(d["typeIndex"])] = len(d.get("floors") or d.get("basicEnemyLevelPerFloor") or [])
    return {"packs": packs, "gifts": gifts, "fus": fus, "modes": modes}


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
