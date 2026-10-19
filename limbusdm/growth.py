"""More → Upgrade calc: level, Uptie and Extraction costs and what the farming stages, Mirror Dungeon and the pass give."""
from __future__ import annotations

VERSION = 1
FOLDERS = ["common-data", "exp-dungeon", "battle-exp-dungeon", "thread-dungeon", "battle-thread-dungeon", "mirrordungeon",
           "battlepass", "vending-machine", "item"]
TICKETS = (211, 212, 213, 214)  # Identity Training Ticket I-IV
THREAD, MODULE = 201, 11


def _one(tabs, folder) -> dict:
    """The newest file of a folder that holds one table (common-data-a1c10 over common-data)."""
    files = tabs.get(folder) or {}
    return files[max(files, key=lambda n: (len(n), n))] if files else {}


def _rows(tabs, folder) -> list:
    return [e for t in (tabs.get(folder) or {}).values() for e in (t.get("list") or [])]


def _items(rewards, want) -> dict:
    out = {}
    for r in rewards or []:
        if r.get("type") == "ITEM" and r.get("id") in want:
            out[r["id"]] = out.get(r["id"], 0) + r.get("num", 0)
    return out


def _md(tabs) -> dict:
    """Normal / Hard full clear: pass points and Lunacy without the weekly bonus and per bonus used."""
    out = {}
    for f, t in (tabs.get("mirrordungeon") or {}).items():
        kind = "hard" if f.endswith("-hard") else "normal" if "-" not in f.split("mirrordungeon-")[-1] else None
        rows = (t.get("list") or [{}])[0].get("rewardInfo", {}).get("exitRewardListByCondition") or []
        if not kind or not rows:
            continue
        plain, bonus = {"bp": 0, "mod": 0}, {}
        for r in rows:
            c, cond = r.get("consumption") or {}, r.get("condition") or {}
            if cond.get("clearedfloorIndex", -1) < 0:
                continue
            bp = sum(x.get("num", 0) for x in r.get("rewardElements") or [] if x.get("type") == "BATTLEPASS_POINT")
            lun = _items(r.get("rewardElements"), {2}).get(2, 0)
            if not c.get("bonusChanceConsumption"):
                plain["bp"] += bp
                plain["mod"] = c.get("moduleConsumption", 0)
                continue
            n = cond.get("hardCountOfThisWeek", 1)  # (Hard: the 1st / 2nd / 3rd bonus of the week)
            b = bonus.setdefault(n, {"bp": 0, "lun": 0, "mod": 0})
            b["bp"] += bp
            b["lun"] += lun
            b["mod"] = c.get("moduleConsumption", 0)
        out[kind] = {"plain": plain, "bonus": [bonus[k] for k in sorted(bonus)]}
    return out


def _pass(tabs) -> dict:
    """The current pass: shard crates of a level past the last one (free / Limbus Pass), points from its missions."""
    passes = _rows(tabs, "battlepass")
    if not passes:
        return {}
    bp = max(passes, key=lambda p: (bool(p.get("isCurrentForUI")), p.get("id", 0)))
    info, want = bp.get("passRewardsInfo") or {}, set()
    for e in _rows(tabs, "item"):
        kind = (e.get("seasonalTargetElement") or {}).get("type")
        if kind in ("SEASONAL_R_BOX", "SEASONAL_O_BOX", "SEASONAL_GLOBAL_GROWTH_PIECE"):
            want.add(e["id"])
    kinds = {e["id"]: (e.get("seasonalTargetElement") or {}).get("type") for e in _rows(tabs, "item") if e.get("id") in want}
    key = {"SEASONAL_R_BOX": "r", "SEASONAL_O_BOX": "o", "SEASONAL_GLOBAL_GROWTH_PIECE": "u"}

    def sums(rewards):
        got = {"r": 0, "o": 0, "u": 0}
        for i, n in _items(rewards, want).items():
            got[key[kinds[i]]] += n
        return got
    missions = (bp.get("passMissionsInfo") or {}).get("missionList") or []
    per = lambda kind: sum(m.get("exp", 0) for m in missions if m.get("missionType") == kind)  # noqa: E731
    return {"id": bp.get("id"), "need": info.get("requiredExp", 10), "max": info.get("maxLevel", 0),
            "ex": {"f": sums(info.get("exDefaultRewardList")), "p": sums(info.get("exLimbusRewardList"))},
            "daily": per("DAILY"), "weekly": per("WEEKLY")}


def _craft(tabs) -> dict:
    """Dispenser price per Identity / E.G.O id; a blocked one (limited) is left out."""
    out = {}
    for m in _rows(tabs, "vending-machine"):
        for g in m.get("groups") or []:
            for c in g.get("contents") or []:
                if c.get("type") in ("PERSONALITY", "EGO") and c.get("price") and not c.get("blocked"):
                    out[str(c["id"])] = {"p": c["price"], "from": c.get("vendingAvailableDate", "")}
    return out


def build(svc) -> dict:
    tabs = svc.static_tables(FOLDERS)
    cd = _one(tabs, "common-data")
    if not cd:
        return {"v": VERSION}
    lv = {e["id"]: e.get("stageLevel") for e in _rows(tabs, "battle-exp-dungeon")}
    exp = sorted(({"lv": lv.get(e["stageId"]), "cost": e["requiredItem"]["num"], "skip": e["skipRequiredItem"]["num"],
                   "x": e.get("skipRewardModify", 1), "t": [_items(e["normalReward"]["rewards"], TICKETS).get(i, 0) for i in TICKETS]}
                  for e in _rows(tabs, "exp-dungeon")), key=lambda e: (e["lv"] or 0))
    exp = list({(e["lv"], tuple(e["t"])): e for e in exp}.values())
    tlv = {e["id"]: e.get("stageLevel") for e in _rows(tabs, "battle-thread-dungeon")}
    thread = {}
    for g in _rows(tabs, "thread-dungeon"):
        for s in g.get("selectStage") or []:
            thread.setdefault(tlv.get(s["stageId"]), {"lv": tlv.get(s["stageId"]), "cost": s["requiredItem"]["num"],
                                                      "n": _items(s["normalReward"]["rewards"], {THREAD}).get(THREAD, 0),
                                                      "bonus": _items(s["chanceReward"]["rewards"], {THREAD}).get(THREAD, 0)})
    pl, el, lt = cd.get("personalityLevelTable") or {}, cd.get("egoLevelTable") or {}, cd.get("levelTable") or {}
    sync = el.get("exchangeUnitCurrencyConfig") or {}
    return {
        "v": VERSION,
        "stamina": {"sec": cd.get("staminaRecoverSec", 360), "per": cd.get("staminaRecoverAmount", 1),
                    "cap": lt.get("enkephalinTable") or [], "module": cd.get("enkephalinForAModule", 20),
                    "buy": (cd.get("enkephalinPriceTable") or {}).get("priceTable") or []},
        "idExp": pl.get("expTable") or [],
        "maxLv": max([m.get("maxlevel", 0) for m in cd.get("maxlevelbystoryprogress") or []] or [len(pl.get("expTable") or []) + 1]),
        "ticket": (cd.get("needAmountToTicket") or {}).get("ticketTable") or [],
        "upId": {k[-1]: [[c.get("thread", 0), c.get("piece", 0)] for c in v] for k, v in (pl.get("gacksungPieceTable") or {}).items()},
        "upEgo": {k: [[c.get("thread", 0), c.get("piece", 0), c.get("egoSyncChain", 0)] for c in v] for k, v in (el.get("gacksungPieceTable") or {}).items()},
        # one sync chain = this many points; a thread gives 1, a shard of that Sinner 2
        "chain": sync.get("requiredPointPerCurrency", 2),
        "dupe": (cd.get("exchangeValues") or {}),
        "exp": [e for e in exp if e["lv"]],
        "thread": [thread[k] for k in sorted(k for k in thread if k)],
        "md": _md(tabs),
        "pass": _pass(tabs),
        "craft": _craft(tabs),
    }


def get(svc) -> dict:
    sid = svc.latest_snapshot_id()
    if not sid:
        return {"v": VERSION}
    kept = getattr(svc, "_growth", None)
    if kept and kept[0] == sid:
        return kept[1]
    db = build(svc)
    svc._growth = (sid, db)
    return db
