"""Database → Sounds: every bank sound in four folders, with speaker and text where the game's files tell."""
from __future__ import annotations

import json
import os
import re

from . import links
from .quiz import _rows, _text, _where

VERSION = 9
SAVE_MAX = 500  # sounds one "Save folder" writes at most (Battle effects: ~9000)
SEARCH_MAX = 3000  # (the page shows them 200 at a time)
FX, STORY, VOICE, OST = "Sound Effects", "Story", "Voicefiles", "Soundtracks"
TOP = [FX, STORY, VOICE, OST]  # (the folders' order)
TOP_ART = {  # (their pictures: the game's own art)
    FX: "Assets/Resources_moved/Story/Backgrounds/Ep10_1/story_b1_foodcourt.png",
    STORY: "Assets/Resources_moved/Story/Backgrounds/Ep10_1/story_Ncourt.png",
    VOICE: "Assets/Resources_moved/Sprite/Unit/CG/10201_normal.png",
    OST: "Assets/Resources_moved/UIConfigs/LobbyBGM/Banner/bgmCover_Rendezvous.png",
}
SINNERS = ["Yi Sang", "Faust", "Don Quixote", "Ryōshū", "Meursault", "Hong Lu", "Heathcliff", "Ishmael", "Rodion",
           "Sinclair", "Outis", "Gregor"]


def _story_where(stem: str) -> tuple[float, str]:
    m = re.match(r"RPG_CP(\d+)", stem, re.I)
    if m:
        return int(m.group(1)) + 0.3, f"Canto {int(m.group(1))} RPG"
    order, label = _where(stem)
    return (order, label) if label != "Story" else (99.0, "Other story")


def _scene_order(name: str) -> str:
    """A story file's letter after its number in story order: B (before the fight), I (between), A (after it)."""
    m = re.match(r"(\S*?\d+)([ABI])(\d*)(?![A-Za-z0-9])(.*)", name)  # (I2, I3: the next intermissions)
    return f"{m[1].lower()}{'BIA'.index(m[2])}{m[3].zfill(2)}{m[4].lower()}" if m else name.lower()


def _sinner_of(uid: int) -> str:
    n = uid // 100 % 100  # (Identity 1SSnn, E.G.O 2SSnn)
    return SINNERS[n - 1] if 1 <= n <= 12 else "Others"


def build(samples: list[tuple], loc_root: str, story: dict, ids: list[dict], egos: list[dict], music: dict,
          portraits: dict | None = None, models: dict | None = None) -> dict:
    """Build the sound tree {"v", "banks", "tree", "src"} from the bank samples and texts. src: "<bank>:<i>" → "m<n>" (the
    soundtrack's track n) or "s<sample>" (a story line, named as the story names it): what other answers have it as."""
    en = os.path.join(loc_root, "en")
    banks, bank_n, src = [], {}, {}
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

    def put(path, s, title="", sub="", text="", key=None, order=None, pic=None, via=None):
        b = bank_n.setdefault(s[0], len(banks))
        if b == len(banks):
            banks.append(s[0])
        node = folder(*path, order=order)
        node.setdefault("items", []).append([b, s[1], s[2], s[3], title, sub, text, key, pic])
        if via:
            src[f"{b}:{s[1]}"] = via

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
    line_of, said = {}, {}  # sample → (stem, line id); its name as the story writes it
    for stem, rows in story.items():
        for r in rows:
            v = str(r.get("voice") or "")
            if v and isinstance(r.get("id"), int):
                line_of.setdefault(v.lower(), (stem, r["id"]))
                said.setdefault(v.lower(), v)
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
        pic = (models or {}).get(str(t.get("model") or "")) or (portraits or {}).get(who)  # (the line's own model first: two can share a name)
        put([STORY, label, scene], s, who, _text(t.get("title")), _text(t.get("content")), line if line is not None else 1e9, pic=pic,
            via=said.get(s[2].lower()) and "s" + said[s[2].lower()])
        if pic:  # (the folder's "who speaks": each face once, a second one of a name by its title)
            pics = folder(STORY, label, scene).setdefault("pics", {})
            if pic not in pics.values():
                k = who if who not in pics else " · ".join(x for x in (who, _text(t.get("title"))) if x)
                pics[k if k not in pics else f"{who} ({len(pics) + 1})"] = pic

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
                key=(t["name"] if t else "~" + name).lower(), order={"Battle themes": 0, "Story": 1}.get(group, 2),
                via=t and "n" in t and f"m{t['n']}")
        elif bank.startswith(("SFX", "UI")) or bank.startswith("CP10-RPG"):
            if "_battleui_" in low:  # (the battle interface is split over the UI and SFX banks: one set, each name once)
                if low in seen:
                    continue
                seen.add(low)
                group = "Interface"
            else:
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
                del it[7]  # (the order key)
                if it[-1] is None:
                    it.pop()
        kids = node.get("kids") or []
        for k in kids:
            tidy(k)
        kids.sort(key=lambda k: (k.get("o", 50), _scene_order(k["name"])))
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
    return {"v": VERSION, "banks": banks, "tree": tree, "src": src}


def find(db: dict, path: list[str]) -> dict | None:
    node = db["tree"]
    for name in path:
        node = next((k for k in node.get("kids") or [] if k["name"] == name), None)
        if node is None:
            return None
    return node


def outline(node: dict, at: tuple = ()) -> dict:
    """A folder without its sounds (the page asks for those folder by folder: url, by the folders' places), with its
    pictures' links."""
    pic = TOP_ART.get(node["name"]) if len(at) == 1 else node.get("img")
    return {"name": node["name"], "n": node["n"], "items": len(node.get("items") or []),
            **{k: node[k] for k in ("sinner", "img") if node.get(k)},
            **({"url": links.sounds(".".join(map(str, at)))} if node.get("items") else {}),
            **({"thumb": links.thumb(pic)} if pic else {}),
            **({"icon": links.ui_icon(f"sinner_{node['sinner']}")} if node.get("sinner") else {}),
            **({"kids": [outline(k, at + (i,)) for i, k in enumerate(node["kids"])]} if node.get("kids") else {})}


def find_at(db: dict, at: str) -> dict | None:
    """The folder at "2.0.5" (its place among its parent's folders, level by level: outline's url)."""
    node = db["tree"]
    for i in at.split(".") if at else []:
        kids = node.get("kids") or []
        if not i.isdigit() or int(i) >= len(kids):
            return None
        node = kids[int(i)]
    return node


def items(db: dict, node: dict) -> list:
    return [[db["banks"][it[0]], *it[1:]] for it in node.get("items") or []]


def urls(db: dict, node: dict, named: dict) -> dict:
    """A folder's sounds as the site has them: {"urls": one per sound, "thumbs": {picture: link}}. Each by the answer other
    pages have it in (a soundtrack's track; the story's line or sound, named = the story's names, lowercase → as written;
    an announcer's line), else by its sample's name."""
    out = []
    for it in node.get("items") or []:
        via = (db.get("src") or {}).get(f"{it[0]}:{it[1]}") or ""
        if os.path.basename(db["banks"][it[0]]).startswith("Voice_Battle_Announcer"):  # (the Announcers page's)
            out.append(links.bank(db["banks"][it[0]], it[1]))
        elif via.startswith("m"):
            out.append(links.music_audio(int(via[1:])))
        elif via.startswith("s") or it[2].lower() in named:
            out.append(links.story_audio(via[1:] if via else named[it[2].lower()]))
        else:
            out.append(links.quiz_audio(it[2].lower()))
    pics = {p for p in [*(node.get("pics") or {}).values(), node.get("img")] + [it[7] for it in node.get("items") or [] if len(it) > 7] if p}
    return {"urls": out, "thumbs": {p: links.thumb(p) for p in sorted(pics)}}


def search(db: dict, q: str, limit: int = SEARCH_MAX, path: list[str] | None = None) -> list:
    """Sounds whose name, speaker or text has every word of q (inside the folder at path, if given); from:name keeps one speaker."""
    who = [(a or b).lower() for a, b in re.findall(r'(?i)\bfrom:(?:"([^"]+)"|(\S+))', q)]
    words, out = re.sub(r'(?i)\bfrom:(?:"[^"]+"|\S+)', " ", q).lower().split(), []
    root = find(db, path or [])

    def walk(node, path):
        for it in node.get("items") or []:
            hay = f"{it[2]} {it[4]} {it[5]} {it[6]}".lower()
            if all(w in hay for w in words) and all(w in it[4].lower() for w in who):
                pic = it[7] if len(it) > 7 else (node.get("pics") or {}).get(it[4]) or node.get("img") or ""
                out.append([path, db["banks"][it[0]], *it[1:7], pic])
                if len(out) >= limit:
                    return True
        return any(walk(k, path + [k["name"]]) for k in node.get("kids") or [])

    if (words or who) and root:
        walk(root, list(path or []))
    return out
