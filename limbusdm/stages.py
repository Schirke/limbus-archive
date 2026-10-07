"""The story map (Database → Story map): every chapter's stage nodes where the game draws them on its map, and what a
fight node holds — the waves' enemies, arena and battle themes.

StaticData `part` lists each chapter's nodes with their place on the map (posx / posy in the map's pixels, y down;
the map is `mapSizeRow` × `mapSizeColoumn` tiles of 2048 px, Sprite/StageMap/<illust>/<illust>_<row>_<col>.png) and the
stage a node starts. A fight's stage is a record of battle-story / battle-ab / battle-dungeon; a dungeon node is a
dungeonMap whose encounters are such stages."""
from __future__ import annotations

import re

from . import content, units

VERSION = 1  # bump when the layout changes (cached per snapshot)
TILE = 2048
FIGHT_TABLES = ("battle-story", "battle-ab", "battle-dungeon")  # (an id found in several: the first one wins)
KINDS = {"NORMAL": "fight", "STORY": "story", "DUNGEON": "dungeon"}
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


def build(tables: dict, loc_dir: str, tiles: dict[str, dict[str, str]]) -> dict:
    """tables: part, dungeonMap and FIGHT_TABLES; tiles: {illust id: {"row_col": the tile's path}}."""
    chapters, names = content.load_chapters(loc_dir), units._load(loc_dir, r"EN_StageNode.*\.json$")
    fights: dict[int, dict] = {}
    for table in FIGHT_TABLES:
        for data in (tables.get(table) or {}).values():
            for st in (data.get("list") or []) if isinstance(data, dict) else []:
                if isinstance(st, dict) and isinstance(st.get("id"), int):
                    fights.setdefault(st["id"], st)
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
                    "title": title(n), "x": n.get("posx"), "y": n.get("posy")}
            st = fights.get(n.get("stageId"))
            if kind == "fight" and st:
                node.update(_stage(st))
            elif kind == "dungeon":
                inside, seen = [], set()
                for floor in (dungeons.get(n.get("stageId")) or {}).get("floors") or []:
                    for sector in floor.get("sectors") or []:
                        for d in sector.get("nodes") or []:
                            st = fights.get(d.get("encounterId"))
                            if d.get("encounter") in ENCOUNTERS and st and st["id"] not in seen:
                                seen.add(st["id"])
                                inside.append({**_stage(st), "what": ENCOUNTERS[d["encounter"]]})
                node["fights"] = inside
                node["lv"] = max((f["lv"] for f in inside), default=0)
            for f in [node] + node.get("fights", []):
                for w in f.get("waves") or []:
                    used.update(u[0] for u in w["units"] + w["more"])
            nodes.append(node)
        grid = tiles.get(ill) or {}
        has_map = bool(grid) and all(n["x"] is not None for n in nodes)
        out.append({"id": sid, "label": label + (" · Hard" if hard else ""), "number": number, "hard": hard,
                    "main": 100 <= sid < 200, "order": ch.get("order", 999),
                    "rows": sc.get("mapSizeRow") or 0, "cols": sc.get("mapSizeColoumn") or 0,
                    "tiles": grid if has_map else {}, "nodes": nodes})
    out.sort(key=lambda c: (not c["main"], c["hard"], c["order"], c["id"]))
    return {"chapters": out, "tile": TILE, "units": sorted(used)}
