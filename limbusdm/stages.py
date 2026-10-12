"""Database → Story map: each chapter's nodes on the game's map and what a fight holds (enemies, arena, music), from
StaticData `part`."""
from __future__ import annotations

import os
import re
import unicodedata

from . import content, units

VERSION = 8  # bump when the layout changes (cached per snapshot)
TILE = 2048
FIGHT_TABLES = ("battle-story", "battle-ab", "battle-dungeon")  # (an id found in several: the first one wins)
KINDS = {"NORMAL": "fight", "STORY": "story", "DUNGEON": "dungeon"}
# helpers a stage's script adds in the game's code (no trace in the data): {stage id: [assistant id]}
BY_HAND = {10641: [9999], 10930: [400006]}
ENCOUNTERS = {"battle": "Fight", "hard_battle": "Hard fight", "ab_battle": "Abnormality", "boss": "Boss"}


def _units(rows) -> list[list]:
    """[[unit id, how many, level]] with the same unit's rows added up."""
    out: dict[tuple, list] = {}
    for u in rows or []:
        if isinstance(u, dict) and isinstance(u.get("unitID"), int):
            k = (u["unitID"], u.get("unitLevel") or 0)
            out.setdefault(k, [k[0], 0, k[1]])[1] += u.get("unitCount") or 1
    return list(out.values())


def _stage(st: dict) -> dict:
    waves = []
    for w in st.get("waveList") or []:
        w = w or {}
        waves.append({"map": (w.get("battleMapInfo") or {}).get("mapName") or "", "bgm": list(w.get("bgmList") or []),
                      "units": _units(w.get("unitList")), "more": _units(w.get("subUnitList"))})
    return {"stage": st["id"], "lv": st.get("recommendedLevel") or st.get("stageLevel") or 0,
            "turns": st.get("turnLimit") or 0, "waves": waves}


def _rules(r: dict, st: dict) -> dict:
    """Who may / must fight and which announcer speaks (StaticData restrict-participation, the stage's own row)."""
    ints = lambda v: [x for x in v or [] if isinstance(x, int)]
    out = {k: ints(r.get(key)) for k, key in (("must", "mustParticipateIds"), ("out", "abstainIds"),
                                              ("ann", "fixedAnnouncerIds"), ("noann", "excludeAnnouncerIds"))}
    out["ann"] += [int(m.group(1)) for s in st.get("stageScriptList") or [] if (m := re.fullmatch(r"(\d+)_?Announcer", str(s)))]
    if r.get("excludeAllAnnouncer") and not out["ann"]:
        out["noann"] = "all"
    out["forced"] = [[f["characterId"], f["personalityId"]] for f in r.get("forceCharacters") or []
                     if isinstance(f, dict) and isinstance(f.get("personalityId"), int)]
    if r.get("rentalPersonalityListId"):
        out["rental"] = [str(r["rentalPersonalityListId"]), r.get("rentalPersonalityLevel") or 0]
    for k, key in (("lv", "minPersonalityLevel"), ("uptie", "minPersonalityGacksung"), ("egoUptie", "minEgoGacksung"),
                   ("setLv", "adjustedLevel")):
        if isinstance(r.get(key), int):
            out[k] = r[key]
    p = st.get("participantInfo") or {}
    if isinstance(p.get("max"), int) and (p.get("max") or 0) < 6 or (p.get("min") or 0) > 1:
        out["count"] = [p.get("min") or 0, p.get("max") or 0]
    return {k: v for k, v in out.items() if v}


def _assists(tables: dict, loc_dir: str, portraits: dict[str, str], fights: dict[int, dict], where: dict[int, str],
             restrict: dict[int, dict]) -> tuple[dict, dict]:
    """→ ({assistant id: {name, lv, pic}}, {stage id: [[assistant id, 1 when guessed]]}).
    Named by the stage (its script list, a script named after one, a wave's assistant list); the rest are guessed:
    a stage that shows a Sinner's card at the back gets that Sinner's look-alike from the same part of the story (1);
    BY_HAND adds the ones only the game's code knows (2)."""
    names = {**units._load(loc_dir, r"EN_Enemies.*\.json$"), **units._load(loc_dir, r"EN_Assist.*\.json$")}  # (Vergilius: an enemy name)
    info, part = {}, {}
    for fname, data in (tables.get("assistant") or {}).items():
        for a in (data.get("list") or []) if isinstance(data, dict) else []:
            if isinstance(a, dict) and isinstance(a.get("id"), int):
                aid = a["id"]
                nm = units._one_line((names.get(a.get("nameID") or aid) or {}).get("name")).split("::")[-1]
                pic = portraits.get(f"{a.get('sdPortrait') or aid}_portrait")
                info[aid] = {"name": nm, "lv": a.get("level") or 0, "pic": pic or "", "look": str(a.get("appearance") or "")}
                part[aid] = fname.split("-", 1)[1] if "-" in fname else ""
    by_stage: dict[int, list] = {}
    for sid, st in fights.items():
        got = []
        for s in st.get("stageScriptList") or []:
            got += [aid for aid in info if re.search(rf"(?<!\d){aid}(?!\d)", str(s)) and aid >= 400000]
        for w in st.get("waveList") or []:
            got += [u.get("unitID") for u in (w or {}).get("assistantUnitList") or [] if u.get("unitID") in info]
        if got:
            by_stage[sid] = [[a, 0] for a in dict.fromkeys(got)]
    named = {a for v in by_stage.values() for a, _ in v}
    for sid, r in restrict.items():
        back = (r.get("uiConfig") or {}).get("backCardUICharacterIds") or []
        if sid in by_stage or sid not in fights or not back:
            continue
        stage_part = where.get(sid, "").split("-")[-1]
        for c in back:
            sinner = re.sub(r"\W", "", unicodedata.normalize("NFKD", units.SINNERS[c - 1])).encode("ascii", "ignore").decode().lower() if 1 <= c <= 12 else ""
            guess = [a for a in info if a not in named and part[a] == stage_part and sinner and sinner in info[a]["look"].lower().replace("_", "")]
            if guess:
                by_stage.setdefault(sid, []).extend([a, 1] for a in guess)
    for sid, aids in BY_HAND.items():
        if sid in fights:
            by_stage.setdefault(sid, []).extend([a, 2] for a in aids if a in info and [a, 0] not in by_stage.get(sid, []))
    for v in info.values():
        v.pop("look")
    return info, by_stage


def build(tables: dict, loc_dir: str, tiles: dict[str, dict[str, str]], portraits: dict[str, str] | None = None) -> dict:
    """tables: part, dungeonMap, restrict-participation, assistant, FIGHT_TABLES; tiles: {illust: {"row_col": path}};
    portraits: {"<id>_portrait": path}."""
    chapters, names = content.load_chapters(loc_dir), units._load(loc_dir, r"EN_StageNode.*\.json$")
    fights: dict[int, dict] = {}
    where: dict[int, str] = {}  # stage id -> its file ("storybattle-a1c9p3")
    for table in FIGHT_TABLES:
        for fname, data in (tables.get(table) or {}).items():
            for st in (data.get("list") or []) if isinstance(data, dict) else []:
                if isinstance(st, dict) and isinstance(st.get("id"), int) and st["id"] not in fights:
                    fights[st["id"]] = st
                    where[st["id"]] = fname
    restrict = {r["id"]: r for data in (tables.get("restrict-participation") or {}).values()
                for g in ((data.get("list") or []) if isinstance(data, dict) else []) for r in g.get("restrictList") or []
                if isinstance(r, dict) and isinstance(r.get("id"), int)}
    assist, assist_of = _assists(tables, loc_dir, portraits or {}, fights, where, restrict)

    def fight(st: dict) -> dict:
        f = _stage(st)
        rules = _rules(restrict.get(st["id"]) or {}, st)
        if rules:
            f["rules"] = rules
        if st["id"] in assist_of:
            f["assist"] = assist_of[st["id"]]
        return f

    dungeons = {d["id"]: d for data in (tables.get("dungeonMap") or {}).values()
                for d in (data.get("list") or []) if isinstance(data, dict) and isinstance(d, dict) and "id" in d}
    subs: dict[int, dict] = {}
    # (one file per update, each holding every chapter: the newest wins)
    for fname in sorted(tables.get("part") or {}, key=lambda f: [int(x) for x in re.findall(r"\d+", f)]):
        data = tables["part"][fname]
        for part in (data.get("list") or []) if isinstance(data, dict) else []:
            for sc in part.get("subchapterList") or []:
                if isinstance(sc.get("id"), int):
                    subs[sc["id"]] = sc

    def title(node):
        for k in (node.get("nodeId"), node.get("nodeInfoId")):
            t = units._one_line((names.get(k) or {}).get("title"))
            if t:
                return t
        return ""

    out, used = [], set()
    for sid, sc in subs.items():
        nodes_in = [n for n in sc.get("stageNodeList") or [] if isinstance(n, dict)]
        if not nodes_in or sc.get("isSyncChapter"):
            continue
        hard = "HARD" in (sc.get("subchapterFeatureList") or [])
        ill = str(sc.get("mapIllustId") or sc.get("illustSprName") or "")
        ch = chapters.get(str(sid)) or chapters.get(ill) or {}
        number = str(sc.get("subChapterNumber") or "")
        label = ch.get("label") or title(nodes_in[0]) or f"Chapter {sid}"
        first, nodes = sc.get("startNodeNumber") or 1, []
        for i, n in enumerate(nodes_in):
            kind = KINDS.get(n.get("stageNodeType"), "other")
            node = {"id": n.get("nodeId"), "n": f"{number}-{first + i}" if number else str(first + i), "kind": kind,
                    "title": title(n), "x": n.get("posx"), "y": n.get("posy"), "up": bool(n.get("upper"))}
            st = fights.get(n.get("stageId"))
            if kind == "fight" and st:
                node.update(fight(st))
            elif kind == "dungeon":
                inside, seen = [], set()
                for floor in (dungeons.get(n.get("stageId")) or {}).get("floors") or []:
                    for sector in floor.get("sectors") or []:
                        for d in sector.get("nodes") or []:
                            st = fights.get(d.get("encounterId"))
                            if d.get("encounter") in ENCOUNTERS and st and st["id"] not in seen:
                                seen.add(st["id"])
                                inside.append({**fight(st), "what": ENCOUNTERS[d["encounter"]]})
                node["fights"] = inside
                node["lv"] = max((f["lv"] for f in inside), default=0)
            for f in [node] + node.get("fights", []):
                for w in f.get("waves") or []:
                    used.update(u[0] for u in w["units"] + w["more"])
            nodes.append(node)
        grid = tiles.get(ill) or {}
        has_map = bool(grid) and all(n["x"] is not None for n in nodes)
        out.append({"id": sid, "label": label + (" · Hard" if hard else ""), "number": number, "hard": hard,
                    "main": 100 <= sid < 200, "order": ch.get("order", 999), "time": ch.get("time") or "",
                    "rows": sc.get("mapSizeRow") or 0, "cols": sc.get("mapSizeColoumn") or 0,
                    "tiles": grid if has_map else {}, "nodes": nodes})
    # side stories as the game lists them: by their date in the City (an undated one takes the one before it by
    # number), a Hard copy right after its story
    dated = sorted((c["order"], c["time"]) for c in out if not c["main"] and c["time"])
    for c in out:
        if not c["main"] and not c["time"]:
            c["time"] = max((t for o, t in dated if o <= c["order"]), default="")
    out.sort(key=lambda c: (not c["main"], c["hard"], "" if c["main"] else c["time"], c["order"], c["id"]))
    for h in [c for c in out if c["hard"]]:
        base = next((c for c in out if not c["hard"] and c["label"] == h["label"].replace(" · Hard", "")), None)
        if base:
            out.remove(h)
            out.insert(out.index(base) + 1, h)
    announcers = {k: units._one_line(v.get("name")) for k, v in units._load(loc_dir, r"EN_Announcer(-.*)?\.json$").items()
                  if isinstance(k, int)}
    return {"chapters": out, "tile": TILE, "units": sorted(used), "assist": assist, "announcers": announcers,
            "sinners": units.SINNERS}


NODE_CG = "Assets/Resources_moved/Sprite/StageNodeCG/"
_cg_lock = __import__("threading").Lock()


def node_pic(svc, nid: int) -> bytes | None:
    """A map node's card picture: StageNodeCG/…/<node>.png, else (Cantos 1-4) the main build's sprite named so."""
    import io
    import sqlite3

    from . import pictures
    con = sqlite3.connect(svc.ensure_browse())
    row = con.execute("select c from o where type = 'Texture2D' and c like ? limit 1", (f"{NODE_CG}%/{nid}.png",)).fetchone()
    con.close()
    if row:
        return pictures.picture(svc, row[0], 480)
    folder = os.path.join(svc.ui_cache_dir(), "nodecg")
    with _cg_lock:
        if not os.path.exists(os.path.join(folder, ".done")):
            _cut_main(svc.game.data, folder)
    fp = os.path.join(folder, f"{nid}.png")
    if not os.path.exists(fp):
        return None
    with open(fp, "rb") as f:
        return pictures._webp(f.read(), 480)


def _cut_main(game_data: str, folder: str) -> None:
    import glob

    import UnityPy

    from . import bundles as _bundles  # noqa: F401
    os.makedirs(folder, exist_ok=True)
    for fp in [os.path.join(game_data, "resources.assets")] + sorted(glob.glob(os.path.join(game_data, "sharedassets*.assets"))):
        try:
            env = UnityPy.load(fp)
        except Exception:
            continue
        for o in env.objects:
            if o.type.name != "Sprite":
                continue
            try:
                n = o.peek_name()
                if re.fullmatch(r"\d{5,6}", n) and not os.path.exists(os.path.join(folder, n + ".png")):
                    o.read().image.save(os.path.join(folder, n + ".png"))
            except Exception:
                continue
    open(os.path.join(folder, ".done"), "w").close()


def node_pic_ids(svc) -> set[int]:
    """Nodes that have a card picture."""
    import sqlite3
    con = sqlite3.connect(svc.ensure_browse())
    ids = {int(c.rsplit("/", 1)[-1][:-4]) for (c,) in con.execute("select distinct c from o where type = 'Texture2D' and c like ?", (NODE_CG + "%",))
           if c.rsplit("/", 1)[-1][:-4].isdigit()}
    con.close()
    node_pic(svc, 0)  # (cuts the main build's ones)
    folder = os.path.join(svc.ui_cache_dir(), "nodecg")
    return ids | {int(f[:-4]) for f in os.listdir(folder) if f[:-4].isdigit()} if os.path.isdir(folder) else ids
