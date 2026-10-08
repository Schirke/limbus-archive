"""Tools → Mirror Dungeon planner (ui/mirror.js): the theme packs, the E.G.O gifts each can drop and the fusion recipes.

All of it is in StaticData:
- `mirrordungeon-theme-floor`: a pack's `egoGiftPool` (what drops in it), `specificEgoGiftPool` (the gifts found in this
  pack and its copies only) and `exceptionConditions` — the modes it appears in: dungeonIdx 0 = Normal and 1 = Hard with
  `selectableFloors` (0-based, floors 1-5), 2 = the pool of floors 6-10, 3 = the pool of floors 11-15 (no floors named:
  any of the five).
- `ego-gift`, `ego-gift-mirrordungeon`: keyword, tier (tag TIER_n), the icon's number (`iconId`, else the gift's own)
  and the number its name is filed under (`upgradeDataList[0].localizeID`).
- `mirror-dungeon-common-data` `egoGiftCombineFixedTable`: what is fused from what (several recipes per result).
- `mirrordungeon`: the modes themselves (typeIndex → how many floors).
"""
from __future__ import annotations

import re

from .units import _load

VERSION = 1
SINS = {"CRIMSON": "Wrath", "SCARLET": "Lust", "AMBER": "Sloth", "SHAMROCK": "Gluttony", "AZURE": "Gloom", "INDIGO": "Pride", "VIOLET": "Envy"}


def build(tables: dict, loc_dir: str, gift_pics: dict, pack_pics: dict) -> dict:
    """{"packs": [{id, name, floors: {dungeonIdx: [floor, …]}, pool, excl, hard, pic}], "gifts": {id: {name, kw, tier,
    sin, desc, pic}}, "fus": {result id: [[ingredient ids], …]}, "modes": {typeIndex: floors}}.
    gift_pics / pack_pics: {texture name: asset path} of Sprite/EgoGiftIcon and of the packs' cards."""
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
                    "pic": gift_pics.get(str(d.get("iconId") or g)) or gift_pics.get(str(g)) or ""}
    modes = {}
    for t in (tables.get("mirrordungeon") or {}).values():
        for d in (t.get("list") if isinstance(t, dict) else None) or []:
            if d.get("typeIndex") is not None:
                modes[str(d["typeIndex"])] = len(d.get("floors") or d.get("basicEnemyLevelPerFloor") or [])
    return {"packs": packs, "gifts": gifts, "fus": fus, "modes": modes}
