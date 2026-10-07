"""Voice lines for Games → Guess the Identity: every voiced line of an Identity with its text and when it is said
(Localize PersonalityVoiceDlg; a line's id is its sample's name in the voice banks), and the voiced battle lines of
bosses. Nothing in the game's tables ties a battle line to who says it (the game's code does), so a boss is found by
what the line's own note says: a skill id of his, or his Korean name / the developers' nickname for him; the bark
samples numbered after a unit's look ("battle_s3_8105_2") come without text."""
from __future__ import annotations

import collections
import json
import os
import re

VERSION = 7
CHAR_LINES, CHAR_MIN = 40, 5  # lines kept of a story character (spread over the story), fewest to be asked about
SINNERS = ["Yi Sang", "Faust", "Don Quixote", "Ryōshū", "Meursault", "Hong Lu", "Heathcliff", "Ishmael", "Rodion", "Sinclair", "Outis", "Gregor"]
# the developers' notes call some bosses by a short name: note's word -> the start of the English name
NICK = {"붉은 신": "The Crimson God", "바퀴황제": "The Roach Emperor", "검지 아비": "The Index Nursefather",
        "엄지 아비": "The Thumb Nursefather", "소지 아비": "The Pinky Nursefather", "중지 제자": "The Middle Apprentice",
        "검지 제자": "The Index Apprentice", "엄지 제자": "The Thumb Apprentice", "소지 제자": "The Pinky Apprentice",
        "와일드헌트 히스클리프": "Erlking Heathcliff", "크로머": "Kromer", "cromer": "Kromer", "수셰프": "Sous Chef",
        "바늘이 왕": "King of Needleworks", "잔느": "Jeanne Sartre", "산초": "Sancho",
        "중지 아비": "The Middle Nursefather", "시간살인마": "The Time Ripper", "호엔하임": "Distorted Hohenheim", "포레그": "Four-legs", "원레그": "One-leg", "뇌횡": "Lei Heng", "가구": "Jia Qiu"}


def _rows(folder: str, pattern: str) -> list[dict]:
    out = []
    for fn in sorted(os.listdir(folder)) if os.path.isdir(folder) else []:
        if re.match(pattern, fn):
            try:
                with open(os.path.join(folder, fn), encoding="utf-8-sig") as f:
                    out += [r for r in json.load(f).get("dataList", []) if isinstance(r, dict) and r.get("id")]
            except (OSError, ValueError):
                continue
    return out


def _text(s) -> str:
    return " ".join(re.sub(r"<[^>]+>", "", str(s or "")).split())


def _where(stem: str) -> tuple[float, str]:
    """(order, label) of a story file by its name: "S1040B" = Canto 10 (S + the Canto + two digits; S0.. = the
    Prologue, "S9991B" = Canto 9's last pages), "3D309A" = Canto 3's dungeon (the Canto comes FIRST there), "E614A" = an
    Intervallo after Canto 6, "E0..X" / "ES…" = the events, "P10102" = an Identity's own story."""
    m, d = re.match(r"T?S(\d{3,4})", stem), re.match(r"(\d+)D\d{3}", stem)
    if m or d:
        n = int(d.group(1)) if d else int(m.group(1)[:-2])
        if n > 20:  # ("S9991": four digits, but not a Canto past the ninth)
            n = int(m.group(1)[0])
        return n + (0.2 if d else 0.0), f"Canto {n}" if n else "Prologue"
    m = re.match(r"E([1-9])\d\d", stem)
    if m:
        return int(m.group(1)) + 0.5, f"Intervallo after Canto {m.group(1)}"
    if re.match(r"E0|ES", stem):
        return 90.0, "Event"
    return (95.0, "Identity story") if stem.startswith("P") else (99.0, "Story")


def characters(loc_root: str, sounds: dict, story: dict, enemies: list[dict], portraits: dict | None = None) -> list[dict]:
    """Who speaks in the story, with their voiced lines. story: {file stem: Story/Effect rows} — a row there names
    the voice file of the line with the same id in Localize StoryData, whose `teller` (or `model`, through
    EN_ScenarioModelCodes) is who says it.
    portraits: {model: asset path of its picture in the story's log} (StaticData scenario-asset names it per model).
    -> [{"name", "role", "where", "order", "pic", "sinner" (1-12) | "boss" (handbook entry id), "lines": [[sample, text, where]]}]"""
    en = os.path.join(loc_root, "en")
    codes = {str(r["id"]): r for r in _rows(en, r"EN_ScenarioModelCodes.*\.json$")}
    found: dict[str, dict] = {}
    for stem in sorted(story, key=lambda s: (_where(s)[0], s)):
        try:
            with open(os.path.join(en, "StoryData", f"EN_{stem}.json"), encoding="utf-8-sig") as f:
                loc = {r.get("id"): r for r in json.load(f).get("dataList", []) if isinstance(r, dict)}
        except (OSError, ValueError):
            continue
        order, label = _where(stem)
        for r in story[stem]:
            sample, t = str(r.get("voice") or "").lower(), loc.get(r.get("id")) or {}
            code = codes.get(str(t.get("model") or "")) or {}
            name, text = _text(t.get("teller") or code.get("name")), _text(t.get("content"))
            if not sample or sample not in sounds or not name or not name.strip("?") or not 12 <= len(text) <= 240:
                continue
            c = found.setdefault(name, {"name": name, "roles": collections.Counter(), "pics": collections.Counter(),
                                        "where": label, "order": order, "lines": []})
            c["pics"][(portraits or {}).get(str(t.get("model") or ""), "")] += 1
            c["roles"][_text(t.get("title") or code.get("nickName"))] += 1
            c["lines"].append([sample, text, label])
    exact, names = {}, {}
    for e in enemies:  # a handbook entry by the name the story uses: "Kromer" (the first of its looks), "… - Rien", "Dongrang, Who …"
        exact.setdefault(e["name"].lower(), e["id"])
        for key in {e["name"].rsplit(" - ", 1)[-1], e["name"].split(",")[0]} - {e["name"]}:
            names.setdefault(key.lower(), set()).add(e["name"])
            exact.setdefault("~" + key.lower(), e["id"])
    out = []
    for c in found.values():
        if len(c["lines"]) < CHAR_MIN:
            continue
        step = max(1, len(c["lines"]) // CHAR_LINES)
        role = next((r for r, _ in c.pop("roles").most_common() if r.strip("?") and r != c["name"]), "")
        # the look most of his lines are said in (a character changes clothes, and so models, over the story)
        c.update(lines=c["lines"][::step][:CHAR_LINES], role=role, pic=next((p for p, _ in c.pop("pics").most_common() if p), ""))
        if c["name"] in SINNERS:
            c["sinner"] = SINNERS.index(c["name"]) + 1
        elif c["name"].lower() in exact:
            c["boss"] = exact[c["name"].lower()]
        elif len(names.get(c["name"].lower(), ())) == 1:
            c["boss"] = exact["~" + c["name"].lower()]
        out.append(c)
    return out


def build(loc_root: str, sounds: dict, identities: set[int], enemies: list[dict], story: dict | None = None,
          portraits: dict | None = None) -> dict:
    """loc_root: …/Localize; sounds: viewer.sound_index; enemies: the handbook's list; story: see characters().
    -> {"ids": [[sample, Identity id, when, text]], "bosses": [[sample, handbook entry id, text]], "chars": [...]}"""
    ids = []
    for r in _rows(os.path.join(loc_root, "en", "PersonalityVoiceDlg"), r"EN_Voice_.*\.json$"):
        m = re.search(r"_(\d{5})_\d+$", str(r["id"]))
        text = _text(r.get("dlg"))
        if m and int(m.group(1)) in identities and str(r["id"]).lower() in sounds and len(text) > 3:
            ids.append([str(r["id"]).lower(), int(m.group(1)), _text(r.get("desc")), text])

    by_unit = {i: e for e in enemies for v in e["variants"] for i in v["ids"]}
    by_skill = collections.defaultdict(set)
    for e in enemies:
        for v in e["variants"]:
            for s in (v.get("skills") or []) + (v.get("defense") or []) + [s for p in v.get("parts") or [] for s in p.get("skills") or []]:
                by_skill[str(s.get("id") if isinstance(s, dict) else s)].add(e["id"])
    by_id = {e["id"]: e for e in enemies}
    words = {}  # a note's word -> handbook entry
    for fn_re in (r"KR_Enemies.*\.json$", r"KR_Abnormalit.*\.json$"):
        for r in _rows(os.path.join(loc_root, "kr"), fn_re):
            name = " ".join(str(r.get("name") or "").split())
            if len(name) >= 3 and r["id"] in by_unit:
                words.setdefault(name, by_unit[r["id"]])
    for nick, en in NICK.items():
        e = next((e for e in enemies if e["name"].startswith(en)), None)
        if e:
            words[nick] = e
    order = sorted(words, key=len, reverse=True)
    bosses, seen = [], set()
    for r in _rows(os.path.join(loc_root, "en"), r"EN_BattleSpeechBubbleDlg.*\.json$"):
        sample, text, note = str(r["id"]).lower(), _text(r.get("dlg")), str(r.get("desc") or "") + " " + str(r["id"])
        if sample not in sounds or len(text) <= 3 or sample in seen:
            continue
        m = re.search(r"_(1\d{4})_", sample)
        if m and int(m.group(1)) in identities:  # an Identity's own battle line: said with a skill, or in answer to something
            seen.add(sample)
            n = re.match(r"battle_s(\d)_", sample)
            ids.append([sample, int(m.group(1)), f"Using Skill {n.group(1)}" if n else "In battle", text])
            continue
        m = re.search(r"(\d{6,7})\s*스킬", note)
        e = by_id.get(next(iter(by_skill[m.group(1)]))) if m and len(by_skill.get(m.group(1), ())) == 1 else None
        if not e:
            w = next((w for w in order if w in note), None)
            e = words[w] if w else None
        if e:
            seen.add(sample)
            bosses.append([sample, e["id"], text])
    by_look = {}
    for e in enemies:
        m = re.match(r"(\d{4,5})_", e.get("app") or "")
        if m:
            by_look.setdefault(m.group(1), e)
    for sample, (path, _i) in sounds.items():  # barks named after a unit's look: no text
        m = re.match(r"battle_[a-z0-9_]*?_(\d{4,5})_\d", sample)
        if m and m.group(1) in by_look and os.path.basename(path).lower().startswith("voice") and sample not in seen:
            seen.add(sample)
            bosses.append([sample, by_look[m.group(1)]["id"], ""])
    chars = characters(loc_root, sounds, story or {}, enemies, portraits)
    for c in chars:  # a boss's story lines are his too
        for sample, text, _where_ in c["lines"] if c.get("boss") else []:
            if sample not in seen:
                seen.add(sample)
                bosses.append([sample, c["boss"], text])
    return {"ids": ids, "bosses": bosses, "chars": chars}
