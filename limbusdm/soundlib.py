"""Database → Sounds: every sound of the game's FMOD banks, sorted into four folders:
Sound Effects, Story, Voicefiles, Soundtracks — with who says a line and its text where the game's files tell.

A story line's sample is named by the story's own files (Story/Effect rows: `voice` of the line with the same id in
Localize StoryData); an Identity's / E.G.O's / announcer's line is its sample's name in PersonalityVoiceDlg /
EGOVoiceDig / BattleAnnouncerDlg; a soundtrack's official name comes from the corner player's list (music.build).
Everything else is listed by its sample name."""
from __future__ import annotations

import json
import os
import re

from .quiz import _rows, _text, _where

VERSION = 5
SAVE_MAX = 500  # sounds one "Save folder" writes at most (Battle effects: ~9000)
FX, STORY, VOICE, OST = "Sound Effects", "Story", "Voicefiles", "Soundtracks"
TOP = [FX, STORY, VOICE, OST]  # (the folders' order)
SINNERS = ["Yi Sang", "Faust", "Don Quixote", "Ryōshū", "Meursault", "Hong Lu", "Heathcliff", "Ishmael", "Rodion",
           "Sinclair", "Outis", "Gregor"]


def _story_where(stem: str) -> tuple[float, str]:
    m = re.match(r"RPG_CP(\d+)", stem, re.I)
    if m:
        return int(m.group(1)) + 0.3, f"Canto {int(m.group(1))} RPG"
    order, label = _where(stem)
    return (order, label) if label != "Story" else (99.0, "Other story")


def _sinner_of(uid: int) -> str:
    n = uid // 100 % 100  # (Identity 1SSnn, E.G.O 2SSnn)
    return SINNERS[n - 1] if 1 <= n <= 12 else "Others"


def build(samples: list[tuple], loc_root: str, story: dict, ids: list[dict], egos: list[dict], music: dict,
          portraits: dict | None = None) -> dict:
    """samples: (bank path as the snapshot names it, index, name, ms) of every bank; loc_root: …/Localize;
    story: {story file stem: Story/Effect rows with a voice}; ids / egos: unit_db's; music: {(bank path, sample name
    lower case): corner player track}; portraits: {story speaker: asset path of their picture in the story's log}.
    -> {"v", "banks": [bank path], "tree": {"name", "kids": [...]} | {"name", "items": [[bank, i, name, ms, title, sub, text]]}}
    (+ a folder's "sinner" (1-12, its emblem), "img" (an Identity's / E.G.O's picture), "pics" ({speaker: picture}))"""
    en = os.path.join(loc_root, "en")
    banks, bank_n = [], {}
    tree = {"name": "", "kids": []}

    def folder(*path, order=None):
        node = tree
        for name in path:
            kid = next((k for k in node["kids"] if k["name"] == name), None)
            if kid is None:
                kid = {"name": name, "kids": []}
                node["kids"].append(kid)
            node = kid
        if order is not None:
            node["o"] = order
        return node

    for name in TOP:
        folder(name)

    def put(path, s, title="", sub="", text="", key=None, order=None):
        b = bank_n.setdefault(s[0], len(banks))
        if b == len(banks):
            banks.append(s[0])
        node = folder(*path, order=order)
        node.setdefault("items", []).append([b, s[1], s[2], s[3], title, sub, text, key])

    # who says what: the voice tables, the story's lines
    voice = {str(r["id"]).lower(): r for sub in ("PersonalityVoiceDlg", "EGOVoiceDig", "BattleAnnouncerDlg")
             for r in _rows(os.path.join(en, sub), r".*\.json$")}
    announcers = {}
    for fn in os.listdir(os.path.join(en, "BattleAnnouncerDlg")) if os.path.isdir(os.path.join(en, "BattleAnnouncerDlg")) else []:
        m = re.match(r"EN_Announcer_(.+)_(\d+)\.json$", fn)
        if m:
            announcers[m.group(2)] = re.sub(r"(?<=[a-z])(?=[A-Z][a-z])", " ", m.group(1)).replace("_", " ")
    id_of = {x["id"]: x for x in ids}
    ego_of = {x["id"]: x for x in egos}
    codes = {str(r["id"]): r for r in _rows(en, r"EN_ScenarioModelCodes.*\.json$")}
    line_of = {}  # sample → (stem, line id)
    for stem, rows in story.items():
        for r in rows:
            v = str(r.get("voice") or "").lower()
            if v and isinstance(r.get("id"), int):
                line_of.setdefault(v, (stem, r["id"]))
    loc_cache: dict[str, dict] = {}

    def story_file(stem):
        if stem not in loc_cache:
            try:
                with open(os.path.join(en, "StoryData", f"EN_{stem}.json"), encoding="utf-8-sig") as f:
                    rows = [r for r in json.load(f).get("dataList", []) if isinstance(r, dict)]
            except (OSError, ValueError):
                rows = []
            place = next((_text(r.get("place")) for r in rows if _text(r.get("place"))), "")
            loc_cache[stem] = ({r.get("id"): r for r in rows}, place)
        return loc_cache[stem]

    def story_put(s, stem, line=None):
        order, label = _story_where(stem)
        rows, place = story_file(stem)
        scene = f"{stem} · {place}" if place else stem
        t = rows.get(line) or {}
        who = _text(t.get("teller") or (codes.get(str(t.get("model") or "")) or {}).get("name"))
        folder(STORY, label, order=order)
        put([STORY, label, scene], s, who, _text(t.get("title")), _text(t.get("content")), line if line is not None else 1e9)
        if who in (portraits or {}):
            folder(STORY, label, scene).setdefault("pics", {})[who] = portraits[who]

    seen = set()
    for s in samples:
        rel, _i, name, _ms = s
        low, bank = name.lower(), os.path.basename(rel)
        kind = (bank, low)
        if kind in seen:
            continue
        seen.add(kind)
        if bank.startswith("BGM"):
            t = music.get((rel, low))
            group = "Battle themes" if t and t.get("battle") else "Story" if bank.startswith("BGM_Story") else "Lobby & other"
            put([OST, group], s, t["name"] if t else "", " · ".join(x for x in ((t or {}).get("where"), (t or {}).get("by")) if x),
                key=(t["name"] if t else "~" + name).lower(), order={"Battle themes": 0, "Story": 1}.get(group, 2))
        elif bank.startswith(("SFX", "UI")) or bank.startswith("CP10-RPG"):
            group = ("Story" if bank.startswith(("SFX_Story", "CP10-RPG")) else "Interface" if bank.startswith(("UI", "SFX_Title"))
                     else "Battle")
            put([FX, group], s, order={"Battle": 0, "Story": 1}.get(group, 2))
        elif bank.startswith("Voice"):
            r = voice.get(low) or {}
            m5, m6, ma = re.search(r"_(\d{5})_", name), re.search(r"_(\d{6})_", name), re.match(r"announcer_\w+?_(\d+)_\d+", low)
            msv = re.match(r"(\d+)SV[-_]", name)
            ego = (m5 and ego_of.get(int(m5.group(1)))) or (m6 and ego_of.get(int(m6.group(1)) // 10))  # ("201011": E.G.O 20101's)
            if ma:
                folder(VOICE, "Battle announcers", order=2)
                put([VOICE, "Battle announcers", announcers.get(ma.group(1)) or f"Announcer {ma.group(1)}"], s, text=_text(r.get("dlg")))
            elif m5 and int(m5.group(1)) in id_of:
                x = id_of[int(m5.group(1))]
                who = x["sinnerName"] or _sinner_of(x["id"])
                folder(VOICE, "Identities", order=0)
                folder(VOICE, "Identities", who, order=SINNERS.index(who) if who in SINNERS else 99)["sinner"] = x["sinner"]
                put([VOICE, "Identities", who, f"{x['title']} {x['sinnerName']}".strip()], s, _text(r.get("desc")), text=_text(r.get("dlg")))
                folder(VOICE, "Identities", who, f"{x['title']} {x['sinnerName']}".strip())["img"] = (x.get("img") or {}).get("thumb") or ""
            elif ego:
                x = ego
                who = x["sinnerName"] or _sinner_of(x["id"])
                folder(VOICE, "E.G.O", order=1)
                folder(VOICE, "E.G.O", who, order=SINNERS.index(who) if who in SINNERS else 99)["sinner"] = x["sinner"]
                put([VOICE, "E.G.O", who, f"{x['name']} {x['sinnerName']}".strip()], s, _text(r.get("desc")), text=_text(r.get("dlg")))
                folder(VOICE, "E.G.O", who, f"{x['name']} {x['sinnerName']}".strip())["img"] = (x.get("img") or {}).get("thumb") or ""
            elif low in line_of:
                story_put(s, *line_of[low])
            elif msv:  # story fights' lines: "9SV-BAT1-…" = Canto 9
                n = int(msv.group(1))
                folder(STORY, f"Canto {n}" if n else "Prologue", order=float(n))
                put([STORY, f"Canto {n}" if n else "Prologue", "Battle lines"], s, text=_text(r.get("dlg")))
            else:
                put([VOICE, "Enemies & others"], s, _text(r.get("desc")), text=_text(r.get("dlg")), order=3)
        else:  # the story's voiced lines (S…, …D…, E…, RPG_CP…)
            if low in line_of:
                story_put(s, *line_of[low])
            else:
                m = re.match(r"([A-Za-z0-9]+)-\d", name)
                story_put(s, m.group(1) if m else re.sub(r"\.assets$|\.bank$", "", os.path.splitext(bank)[0]).rstrip("0123456789") or bank)

    def tidy(node):
        if "items" in node:
            node["items"].sort(key=lambda it: (it[7] if it[7] is not None else 0, it[2].lower()))
            for it in node["items"]:
                it.pop()
        kids = node.get("kids") or []
        for k in kids:
            tidy(k)
        kids.sort(key=lambda k: (k.get("o", 50), k["name"].lower()))
        for k in kids:
            k.pop("o", None)
        if not kids:
            node.pop("kids", None)
        node["n"] = len(node.get("items") or []) + sum(k["n"] for k in kids)

    top = {k["name"]: k for k in tree["kids"]}
    for k in tree["kids"]:
        tidy(k)
    tree["kids"] = [top[n] for n in TOP]
    tree["n"] = sum(k["n"] for k in tree["kids"])
    return {"v": VERSION, "banks": banks, "tree": tree}


def find(db: dict, path: list[str]) -> dict | None:
    node = db["tree"]
    for name in path:
        node = next((k for k in node.get("kids") or [] if k["name"] == name), None)
        if node is None:
            return None
    return node


def outline(node: dict) -> dict:
    """A folder without its sounds (the page asks for those folder by folder)."""
    return {"name": node["name"], "n": node["n"], "items": len(node.get("items") or []),
            **{k: node[k] for k in ("sinner", "img") if node.get(k)},
            **({"kids": [outline(k) for k in node["kids"]]} if node.get("kids") else {})}


def items(db: dict, node: dict) -> list:
    return [[db["banks"][it[0]], *it[1:]] for it in node.get("items") or []]


def search(db: dict, q: str, limit: int = 300) -> list:
    """[[folder path, bank, i, name, ms, title, sub, text, picture]] whose name, speaker or text has every word of q."""
    words, out = q.lower().split(), []

    def walk(node, path):
        for it in node.get("items") or []:
            hay = f"{it[2]} {it[4]} {it[5]} {it[6]}".lower()
            if all(w in hay for w in words):
                out.append([path, db["banks"][it[0]], *it[1:], (node.get("pics") or {}).get(it[4]) or node.get("img") or ""])
                if len(out) >= limit:
                    return True
        return any(walk(k, path + [k["name"]]) for k in node.get("kids") or [])

    if words:
        walk(db["tree"], [])
    return out
