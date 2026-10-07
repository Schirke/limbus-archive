"""Which chapter or mode each enemy / abnormality skeleton comes from, read from the game's own tables.

Spine atlas ← SkeletonDataAsset ← Spine component inside an "…Appearance" prefab ← unit (StaticData enemy /
abnormality-unit: "appearance") ← stage wave lists (battle-story, battle-ab, …) ← chapter (EN_StageChapterText).
"""
from __future__ import annotations

import json
import os
import re

import UnityPy

from . import bundles as _bundles  # noqa: F401  (sets the Unity fallback version)

UNIT_TABLES = {"enemy": "Enemy", "abnormality-unit": "Boss / Abnormality"}  # multi-part units: both
STAGE_TABLES = ["battle-story", "battle-ab", "battle-dungeon", "battle-railway-dungeon", "battle-mirrordungeon",
                "battle-exp-dungeon", "battle-thread-dungeon", "battle-bossraid"]
ROMAN = {"I": 1, "V": 5, "X": 10, "L": 50}


def _roman(s: str) -> int:
    n = 0
    for a, b in zip(s, s[1:] + " "):
        n += -ROMAN[a] if ROMAN.get(b, 0) > ROMAN[a] else ROMAN[a]
    return n


# ------------------------------------------------------------------ bundles: Spine skeleton ↔ appearance prefab
def bundle_links(path: str) -> dict:
    """{"sd": {SkeletonDataAsset pid: [atlas TextAsset pids]}, "uses": [[prefab root name, cab or "", sd pid]]}."""
    with open(path, "rb") as f:
        env = UnityPy.load(f.read())
    names, father, go_of_tr, tr_of_go = {}, {}, {}, {}
    atlases, sds, comps = {}, {}, []
    for o in env.objects:
        t = o.type.name
        try:
            if t == "GameObject":
                names[o.path_id] = o.peek_name() or ""
            elif t in ("Transform", "RectTransform"):
                d = o.parse_as_dict()
                go = d["m_GameObject"]["m_PathID"]
                tr_of_go[go], go_of_tr[o.path_id] = o.path_id, go
                father[o.path_id] = d["m_Father"]["m_PathID"]
            elif t == "MonoBehaviour":
                d = o.parse_as_dict()
                if "atlasFile" in d:
                    atlases[o.path_id] = d
                elif "skeletonJSON" in d:
                    sds[o.path_id] = d
                elif isinstance(d.get("skeletonDataAsset"), dict):
                    comps.append((d["m_GameObject"]["m_PathID"], d["skeletonDataAsset"], o.assets_file))
        except Exception:
            continue

    def root(go):
        for _ in range(64):
            f = father.get(tr_of_go.get(go))
            if not f or f not in go_of_tr:
                break
            go = go_of_tr[f]
        return names.get(go, "")

    sd_atlas = {}
    for pid, d in sds.items():
        out = []
        for ap in d.get("atlasAssets") or []:
            a = atlases.get(ap.get("m_PathID")) if not ap.get("m_FileID") else None
            af = (a or {}).get("atlasFile") or {}
            if af.get("m_PathID") and not af.get("m_FileID"):
                out.append(str(af["m_PathID"]))
        if out:
            sd_atlas[str(pid)] = out
    uses = []
    for go, ref, assets_file in comps:
        if not ref.get("m_PathID"):
            continue
        cab = ""
        if ref.get("m_FileID"):
            try:
                m = re.search(r"cab-[0-9a-f]+", assets_file.externals[ref["m_FileID"] - 1].path.lower())
            except Exception:
                m = None
            if not m:
                continue
            cab = m.group(0)
        name = root(go)
        if name:
            uses.append([name, cab, str(ref["m_PathID"])])
    return {"sd": sd_atlas, "uses": uses}


# ------------------------------------------------------------------ chapters and stages
def load_chapters(loc_dir: str) -> dict[str, dict]:
    """{chapter key ("105", "9109"…): {"label", "order"}} from EN_StageChapterText*.json."""
    rows = []
    for fn in sorted(os.listdir(loc_dir)) if os.path.isdir(loc_dir) else []:
        if re.match(r"EN_StageChapterText(-.*)?\.json$", fn):
            try:
                with open(os.path.join(loc_dir, fn), encoding="utf-8-sig") as f:
                    rows += json.load(f).get("dataList", [])
            except Exception:
                continue
    out, last = {}, 0.0
    for r in rows:
        m = re.match(r"chapter_[a-z]+_(\d+)$", str(r.get("id", "")))
        if not m:
            continue
        try:
            order = last = float(r.get("chapterNumber") or "x")
        except ValueError:
            order = last + 0.01  # Walpurgis Nights have no number: right after the chapter listed before them
        title = " ".join(str(r.get("chaptertitle", "")).split())
        ch = str(r.get("chapter", ""))
        mc, mw = re.match(r"Canto ([IVXL]+)$", ch), re.search(r"(\d+)\w* Walpurgis", title)
        label = (f"Canto {_roman(mc.group(1))}" if mc else f"Walpurgis Night {mw.group(1)}" if mw
                 else "Prologue" if ch == "Prologue" else title)
        if label:
            out.setdefault(m.group(1), {"label": label, "order": order})
    return out


def stage_chapter(stage_id: int) -> str | None:
    """Main story stages are 1CCnn (Canto CC), side stories 91XXnn (chapter 91XX)."""
    s = str(stage_id)
    if len(s) == 6 and s.startswith("91"):
        return s[:4]
    if len(s) == 5 and s[0] == "1":
        return "1" + s[1:3]
    if len(s) == 6 and s.startswith("100"):
        return "1" + s[2:4]
    return None


def stage_label(table: str, fname: str, stage_id: int, chapters: dict) -> tuple[int, float, str] | None:
    """(priority, order, label) of a stage: story first, then Railway, then everything repeatable."""
    f = fname.lower()
    if table == "battle-railway-dungeon":
        m = re.search(r"dungeon-0*(\d+)", f)
        return (1, int(m.group(1)), f"Refraction Railway {m.group(1)}") if m else None
    if table == "battle-mirrordungeon":
        m = re.search(r"(\d+)", f)
        return (2, int(m.group(1)) if m else 0, f"Mirror Dungeon {int(m.group(1))}" if m else "Mirror Dungeon")
    if table in ("battle-exp-dungeon", "battle-thread-dungeon"):
        return 2, 0, "Luxcavation"
    if table == "battle-bossraid":
        return 2, 0, "Boss raid"
    m = re.search(r"a1c(\d+)p(\d+)", f)
    if m:
        return 0, int(m.group(1)), f"Canto {int(m.group(1))} · Part {m.group(2)}"
    m = re.search(r"(?:wp|walpu)(\d+)", f)
    if m:
        label = f"Walpurgis Night {m.group(1)}"
        order = next((c["order"] for c in chapters.values() if c["label"] == label), 100 + int(m.group(1)))
        return 0, order, label
    if re.search(r"event\d|fools|x1p1c1|tutorial", f):
        return None  # ids here overlap the main story's numbering
    c = chapters.get(stage_chapter(stage_id) or "")
    return (0, c["order"], c["label"]) if c else None


def load_unit_names(loc_dir: str) -> dict[int, str]:
    out = {}
    for fn in sorted(os.listdir(loc_dir)) if os.path.isdir(loc_dir) else []:
        if not re.match(r"EN_(Enemies|Abnormalit).*\.json$", fn):
            continue
        try:
            with open(os.path.join(loc_dir, fn), encoding="utf-8-sig") as f:
                for r in json.load(f).get("dataList", []):
                    if isinstance(r, dict) and isinstance(r.get("id"), int) and r.get("name"):
                        out.setdefault(r["id"], " ".join(str(r["name"]).split()))
        except Exception:
            continue
    return out


def appearance_content(tables: dict[str, dict[str, object]], chapters: dict, names: dict[int, str]) -> dict[str, dict]:
    """{appearance prefab name: {"label", "prio", "order", "kind", "name"}} — the earliest story content a unit
    with that look appears in (Railway / Mirror Dungeon only when it never shows up in the story)."""
    best: dict[int, tuple] = {}
    for table in STAGE_TABLES:
        for fname, data in (tables.get(table) or {}).items():
            for st in (data.get("list") or []) if isinstance(data, dict) else []:
                if not isinstance(st, dict) or not isinstance(st.get("id"), int):
                    continue
                lab = stage_label(table, fname, st["id"], chapters)
                if not lab:
                    continue
                for wave in st.get("waveList") or []:
                    for u in (wave or {}).get("unitList") or []:
                        uid = (u or {}).get("unitID")
                        if isinstance(uid, int) and (uid not in best or lab < best[uid]):
                            best[uid] = lab
    out: dict[str, dict] = {}
    for table, kind in UNIT_TABLES.items():
        for data in (tables.get(table) or {}).values():
            for u in (data.get("list") or []) if isinstance(data, dict) else []:
                app, uid = (u or {}).get("appearance"), (u or {}).get("id")
                if not app or uid not in best:
                    continue
                prio, order, label = best[uid]
                cur = out.get(app)
                if cur is None or (prio, order) < (cur["prio"], cur["order"]):
                    out[app] = {"label": label, "prio": prio, "order": order, "kind": kind,
                                "name": names.get(uid) or (cur or {}).get("name")}
                elif not cur.get("name") and names.get(uid):
                    cur["name"] = names[uid]
    return out
