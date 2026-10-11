"""Story reader: every Story Theater story scene by scene with backgrounds, standing pictures, voices, sounds and music
(StaticData storytheater-*, Story/Effect, StoryData)."""
from __future__ import annotations

import json
import os
import re

VERSION = 7  # bump when the index / an episode's layout changes (cached per snapshot)
LANGS = {"en": "EN", "kr": "KR", "jp": "JP"}
DETAIL = {"Before": "Pre-battle", "Inter": "Interlude", "After": "Post-battle"}
UNIT = 100  # a Unity unit is 100 pixels of a standing picture
STAGES = ("story", "battle-story", "battle-ab", "battle-dungeon")  # tables whose stages name the story files they play
PART = {"B": "Before", "I": "Inter", "A": "After"}  # a file name's letter after its number
# April Fools' Day 2023: its scene script is gone, its text and one glitch picture stayed; place -> what it showed
FOOLS_2023 = "E000X"
DANTE = "단테"  # (his model name in the texts)
FOOLS_PLACES = [("???", "bg", "blackbg"), ("#*%", "cg", "E000X_8"), ("Aboard Mephistopheles", "bg", "Bus_Inside_1")]
FOOLS_BANNER = "Assets/Resources_moved/Sprite/Banner/banner_AprilFools2_event_en"


def _rows(loc: str, lang: str, pattern: str) -> list[dict]:
    """Rows of the Localize/<lang> files matching `pattern`, oldest first."""
    folder, out = os.path.join(loc, lang), []
    pre = LANGS[lang]
    rx = re.compile(pattern.replace("{L}", pre))
    for fn in sorted(os.listdir(folder)) if os.path.isdir(folder) else []:
        if rx.match(fn):
            try:
                with open(os.path.join(folder, fn), encoding="utf-8-sig") as f:
                    out += [r for r in json.load(f).get("dataList", []) if isinstance(r, dict)]
            except (OSError, ValueError):
                continue
    return out


def _line(s) -> str:
    return " ".join(str(s or "").replace("�", "'").split())


def _roman(s: str) -> str:
    return s


def _stem(f: str) -> tuple[str, str]:
    """S926I2 -> ("S926", "Inter"): the files of one stage share a stem."""
    m = re.match(r"(.*?\d+)([A-Z])\d*$", f)
    return (m.group(1), PART.get(m.group(2), "")) if m else (f, "")


def build_index(tables: dict, loc: str, lang: str = "en", identities: dict | None = None, files: set | None = None) -> dict:
    """The Story page's list {"main", "other", "ident"}. `files`: the story files there are (lower case); with it the
    files the Story Theater leaves out are put in too (_left_out)."""
    chap = {}
    for r in _rows(loc, lang, r"{L}_StageChapterText.*\.json$"):
        m = re.match(r"chapter_[a-z]+_(\d+)$", str(r.get("id", "")))
        if m:
            chap.setdefault(int(m.group(1)), r)
    blurb = {}
    for r in _rows(loc, lang, r"{L}_StoryTheaterMain.*\.json$"):
        m = re.match(r"CHAPTER_(\d+)$", str(r.get("id", "")))
        if m:
            blurb[int(m.group(1))] = str(r.get("desc") or "").strip()
    nodes = {}  # node id -> (title, blurb); ids are strings in the files
    for r in _rows(loc, lang, r"{L}_StageNode.*\.json$"):
        if str(r.get("id", "")).isdigit():
            nodes[int(r["id"])] = (_line(r.get("title")), str(r.get("desc") or "").strip(), _line(r.get("place")))
    other, event = {}, {}
    for r in _rows(loc, lang, r"{L}_StoryTheaterOther\.json$"):
        m = re.match(r"STORY_(\d+)$", str(r.get("id", "")))
        if m:
            other[int(m.group(1))] = _line(r.get("title"))
        m = re.match(r"EventTitleText_(\d+)$", str(r.get("id", "")))
        if m:
            event[int(m.group(1))] = _line(r.get("title"))

    def chapters(kind: str) -> list[dict]:
        out, subs = [], {}  # (a Canto's later parts carry its id again: a1c9p2, a1c9p3)
        for fname in sorted(tables.get(f"storytheater-{kind}") or {}, key=lambda f: [int(x) for x in re.findall(r"\d+", f)] or [0]):
            data = tables[f"storytheater-{kind}"][fname]
            for sub in (data.get("list") or []) if isinstance(data, dict) else []:
                sid, stories = sub.get("subChapterId"), sub.get("storyList") or []
                if not isinstance(sid, int) or not any(x.get('storyId') for x in stories):
                    continue
                if sid in subs:
                    had = {x.get("storyId") for x in subs[sid][1]}
                    subs[sid][1].extend(x for x in stories if x.get("storyId") not in had)
                else:
                    subs[sid] = (sub, list(stories))
        for sid, (sub, stories) in subs.items():
            eps, by_node = [], {}
            for s in stories:
                if not s.get("storyId"):
                    continue
                node = s.get("nodeId")
                ep = by_node.get(node)
                if ep is None:
                    title, desc, place = nodes.get(node) or (other.get(node) or "", "", "")
                    ep = by_node[node] = {"node": node, "title": title, "desc": desc, "place": place, "parts": []}
                    eps.append(ep)
                ep["parts"].append([s["storyId"], s.get("stageDetail") or "", s.get("fullBannerId") or ""])
            c = chap.get(sid) or {}
            label = _line(c.get("chapter")) or ""
            title = _line(c.get("chaptertitle")) or event.get(sid, "")
            number = _line(c.get("chapterNumber"))
            if kind == "other" and not label.startswith("Intervallo"):
                label = "Mini"
            out.append({"id": sid, "label": label or title, "title": title if label else "", "kind": "intervallo" if label.startswith("Intervallo") else "mini" if kind == "other" else "main", "number": number,
                        "company": _line(c.get("company")), "area": _line(c.get("area")), "time": _line(c.get("timeline")),
                        "desc": blurb.get(sid, ""), "banner": next((x.get("fullBannerId") for x in stories if x.get("storyId") and x.get("fullBannerId")), ""),
                        "order": sub.get("sortingOrder") or 0, "eps": eps})
        return out

    main = chapters("main")
    main.sort(key=lambda c: c["id"])
    oth = chapters("other")
    def _num(c):
        try:
            return float(c["number"])
        except ValueError:
            return 99.0
    oth.sort(key=lambda c: (c["kind"] != "intervallo", _num(c) if c["kind"] == "intervallo" else 0, c["id"]))
    ident = []
    for fname in sorted((tables.get("storytheater-personality") or {}), key=lambda f: f):
        data = tables["storytheater-personality"][fname]
        for ch in (data.get("list") or []) if isinstance(data, dict) else []:
            items = []
            for p in ch.get("storyList") or []:
                for ps in p.get("personalityStoryList") or []:
                    info = (identities or {}).get(p.get("personalityId")) or {}
                    items.append({"id": p.get("personalityId"), "name": info.get("name") or str(p.get("personalityId")),
                                  "story": ps.get("storyId"), "order": ps.get("order") or 0})
            if items:
                items.sort(key=lambda x: (x["order"], x["id"] or 0))
                ident.append({"sinner": ch.get("characterId"), "items": items})
    ident.sort(key=lambda s: s["sinner"] or 0)
    if files is not None:
        fools, extra = _left_out(main + oth, tables, nodes, files - {str(it["story"]).lower() for sn in ident for it in sn["items"]})
        main[:0] = fools
        oth += extra
    for c in main + oth:
        for i, ep in enumerate(c["eps"], 1):
            ep["n"] = f"{c['number'].lstrip('0') or '0'}-{i}" if c["kind"] == "main" and c["number"] != "" else str(i)
            if not ep["title"]:
                ep["title"] = f"Episode {ep['n']}"
    return {"v": VERSION, "main": main, "other": oth, "ident": ident}


def _stage_files(st: dict) -> list[str]:
    """The story files a stage plays: its own, on entering / leaving, between rounds."""
    story = st.get("story") if isinstance(st.get("story"), dict) else {}
    out = [st.get("storyId")] + list(story.get("enter") or []) + list(story.get("exit") or []) + \
        [o.get("storyID") for o in story.get("others") or [] if isinstance(o, dict)]
    return [f for f in out if isinstance(f, str) and f]


def _april_fools(tables: dict) -> dict:
    """{file: year} of the April Fools' Day stories: played by a storybattle-fools stage, or opened on April 1st in Korea."""
    from datetime import datetime, timedelta
    out = {FOOLS_2023.lower(): "2023"}
    for name, data in (tables.get("battle-story") or {}).items():
        if "fool" in name.lower():
            for st in (data.get("list") or []) if isinstance(data, dict) else []:
                if isinstance(st, dict):
                    out.update({f.lower(): str(st.get("id"))[:4] for f in _stage_files(st)})
    for data in (tables.get("open-story-by-date") or {}).values():
        for r in (data.get("list") or []) if isinstance(data, dict) else []:
            try:
                day = datetime.fromisoformat(str(r["startDate"]).replace("Z", "+00:00")) + timedelta(hours=9)
            except (KeyError, TypeError, ValueError):
                continue
            if (day.month, day.day) == (4, 1) and isinstance(r.get("storyId"), str):
                out.setdefault(r["storyId"].lower(), str(day.year))
    return out


def _left_out(chs: list[dict], tables: dict, nodes: dict, files: set) -> tuple[list[dict], list[dict]]:
    """Puts in the story files the Story Theater doesn't list (the newest Canto before it is added, a fight's
    interludes, events): after the one before them in story-loading-cg. The rest: ([April Fools' Day], [the others])."""
    where = {}  # file -> the stage (node) that plays it
    for t in STAGES:
        for data in (tables.get(t) or {}).values():
            for st in (data.get("list") or []) if isinstance(data, dict) else []:
                if isinstance(st, dict) and isinstance(st.get("id"), int):
                    for f in _stage_files(st):
                        where.setdefault(f.lower(), st["id"])
    order = {}  # chapter id -> its files in order
    for data in (tables.get("story-loading-cg") or {}).values():
        for r in (data.get("list") or []) if isinstance(data, dict) else []:
            if isinstance(r, dict) and isinstance(r.get("id"), int):
                order.setdefault(r["id"], []).extend(f for f in r.get("storyIds") or [] if isinstance(f, str))
    placed = {p[0].lower(): ep for c in chs for ep in c["eps"] for p in ep["parts"]}

    def new_ep(f):
        title, desc, place = nodes.get(where.get(f.lower())) or ("", "", "")
        return {"node": where.get(f.lower()), "title": title, "desc": desc, "place": place, "parts": []}

    for c in chs:
        mine = {id(ep) for ep in c["eps"]}
        by_stem = {_stem(p[0])[0]: ep for ep in c["eps"] for p in ep["parts"]}
        prev = None
        for f in order.get(c["id"], []):
            k = f.lower()
            if k in placed or k not in files:
                prev = f if k in placed and id(placed[k]) in mine else prev
                continue
            stem, detail = _stem(f)
            ep = by_stem.get(stem)
            if ep is None:  # an episode of its own, after the one before it
                before = placed.get(prev.lower()) if prev else None
                at = next((i + 1 for i, e in enumerate(c["eps"]) if e is before), 0)
                ep = by_stem[stem] = new_ep(f)
                c["eps"].insert(at, ep)
                mine.add(id(ep))
            ids = [p[0] for p in ep["parts"]]
            ep["parts"].insert(ids.index(prev) + 1 if prev in ids else len(ids), [f, detail, ""])
            placed[k] = ep
            prev = f
    names = {f.lower(): f for fs in order.values() for f in fs}
    rank = lambda p: ("BXIAC".find(p[0][len(_stem(p[0])[0]):][:1] or "?"), len(p[0]), p[0])  # noqa: E731  (a stage's files in play order)
    # files no list names: with their stage's episode, else (S<Canto><nn>) in their Canto by number
    stems = {_stem(p[0])[0]: ep for c in chs for ep in c["eps"] for p in ep["parts"]}
    cantos = sorted(((c["number"].lstrip("0"), c) for c in chs if c["kind"] == "main" and c["number"].lstrip("0").isdigit()),
                    key=lambda x: -len(x[0]))
    for k in sorted(f for f in files if f not in placed):
        f = names.get(k) or k.upper()
        stem, detail = _stem(f)
        ep = stems.get(stem)
        if ep is None:
            n, c = next(((n, c) for n, c in cantos if re.fullmatch(rf"S{n}\d\d", stem)), (None, None))
            if c is None:
                continue
            num = lambda e: [int(_stem(p[0])[0][1 + len(n):]) for p in e["parts"] if re.fullmatch(rf"S{n}\d\d", _stem(p[0])[0])]  # noqa: E731
            at = max((i + 1 for i, e in enumerate(c["eps"]) if num(e) and min(num(e)) < int(stem[1 + len(n):])), default=0)
            ep = stems[stem] = new_ep(f)
            c["eps"].insert(at, ep)
        ep["parts"].append([f, detail, ""])
        ep["parts"].sort(key=rank)
        placed[k] = ep
    # the rest, one episode per stage
    fools = _april_fools(tables)
    years = {_stem(f.upper())[0]: y for f, y in fools.items()}
    eps, fool_eps = {}, {}
    for k in sorted(f for f in files if f not in placed):
        f = names.get(k) or k.upper()
        stem, detail = _stem(f)
        year = fools.get(k) or years.get(stem)
        box, key = (fool_eps, year) if year else (eps, stem)
        if key not in box:
            box[key] = new_ep(f)
            box[key]["title"] = f"April Fools' Day {year}" if year else box[key]["title"] or stem
        box[key]["parts"].append([f, detail, ""])
        box[key]["parts"].sort(key=rank)
    blank = {"title": "", "number": "", "company": "", "area": "", "time": "", "banner": "", "order": 0}
    return ([{**blank, "id": 1, "label": "April Fools' Day", "kind": "fools", "desc": "Stories the game played only on April 1st.", "banner": FOOLS_BANNER,
              "eps": [fool_eps[y] for y in sorted(fool_eps)]}] if fool_eps else [],
            [{**blank, "id": 0, "label": "Not in the Story Theater", "kind": "extra",
              "desc": "Story files the game's Story Theater doesn't list: events, a fight's interludes and the like.",
              "eps": list(eps.values())}] if eps else [])


def _tags(text: str) -> str:
    return str(text or "")


def episode(file_id: str, effect: list[dict], loc_rows: list[dict], codes: dict, models: dict, voices, assets: dict) -> dict:
    """One story file as lines: text, speaker, and what changed in the scene since the line before."""
    loc = {r.get("id"): r for r in loc_rows}
    lines, used = [], {}
    pending: dict = {}
    titles: dict = {}
    state = {"bg": None, "cg": None, "bgm": None, "chars": {}, "feel": {}}

    def change(key, val):
        if state[key] != val:
            state[key] = val
            pending[key] = val

    for row in effect:
        if isinstance(row.get("id"), int) and row["id"] < 0:  # (a header row: "Episode S0_1")
            continue
        t = loc.get(row.get("id")) or {}
        if row.get("bg"):
            change("bg", str(row["bg"]).split(":")[0])
        if row.get("cg"):  # "<name>:<Fade…>[:range]" entries
            for ent in re.split(r",(?![^\[]*\])", str(row["cg"])):
                name, _, how = ent.strip().partition(":")
                name = name.strip()
                if name.lower() == "blackscreen":
                    name = "black"
                if not name or name.lower() == "none":
                    continue
                if how.strip().lower().startswith(("fadeout", "off")):
                    if name.upper() == "ALL" or (state["cg"] or "").lower() == name.lower():
                        change("cg", "")
                else:
                    change("cg", name)
        if row.get("bgm"):
            bgm = str(row["bgm"]).split(":")[0].split(",")[0].strip()
            pending["bgm"] = bgm if bgm.lower() in voices else ""
        if row.get("soundeffect"):  # "<name>[:delay=2], <name>…": the ones the game's banks have
            sfx = [x.split(":")[0].strip() for x in str(row["soundeffect"]).split(",")]
            sfx = [x for x in sfx if x and x.lower() in voices]
            if sfx:
                pending["sfx"] = sfx
        if row.get("video"):
            pending["vid"] = str(row["video"])
        speaker_model = str(t.get("model") or "")
        cl = str(row.get("characterlist") or "")
        if cl:
            changed = False
            for part in cl.split(","):
                bits = [x.strip() for x in part.split(":")]
                name = bits[0]
                try:
                    slot = int(bits[1]) if len(bits) > 1 else -1
                except ValueError:
                    continue
                if name == "ALL":
                    if state["chars"]:
                        state["chars"].clear()
                        changed = True
                    continue
                if slot < 0:
                    changed = state["chars"].pop(name, None) is not None or changed
                    continue
                for other_name, other_slot in list(state["chars"].items()):
                    if other_slot == slot and other_name != name:  # (a slot holds one picture)
                        del state["chars"][other_name]
                if state["chars"].get(name) != slot:
                    state["chars"][name] = slot
                    changed = True
                speaker_model = speaker_model or name
            if changed:
                pending["cl"] = [[m, s] for m, s in state["chars"].items()]
        feels = []
        feeling = str(row.get("feeling") or "").strip()
        if feeling:
            feels.append((speaker_model or next(reversed(state["chars"]), ""), feeling))
        for fx in re.split(r",(?![^\[]*\])", str(row.get("effect") or "")):
            kind, _, args = fx.strip().partition(":")
            kind = kind.strip().lower()
            if kind == "feeling":  # "Feeling:<model>=<face>": someone else's face
                who, _, face = args.partition("=")
                feels.append((who.strip(), face.strip()))
            elif kind == "cameramovezoom":  # mode=on:horizontal=…:vertical=…:zoom=…:duration=…
                kv = dict(x.split("=", 1) for x in args.split(":") if "=" in x)
                try:
                    cam = {k: float(kv[k]) for k in ("horizontal", "vertical", "zoom", "duration") if k in kv}
                except ValueError:
                    continue
                pending["cam"] = {"h": cam.get("horizontal", 0), "v": cam.get("vertical", 0), "z": cam.get("zoom", 1),
                                  "d": cam.get("duration", 0.5)} if kv.get("mode", "on").strip() == "on" else {"d": cam.get("duration", 0.3)}
        for who_model, face in feels:
            if who_model and face and state["feel"].get(who_model) != face:
                state["feel"][who_model] = face
                pending.setdefault("f", {})[who_model] = face
        text = _tags(t.get("content"))
        voice = str(row.get("voice") or "")
        if not text.strip() and not voice and not row.get("video"):
            continue
        code = codes.get(speaker_model) or {}
        name = _line(t.get("teller")) or _line(code.get("name"))
        if t.get("title"):
            titles[name] = _line(t["title"])
        line = {"who": name, "role": titles.get(name, ""), "text": text}
        if speaker_model:
            line["m"] = speaker_model
        if voice and voice.lower() in voices:
            line["v"] = voice
        if not name and not speaker_model:
            line["n"] = 1  # narration
        line.update(pending)
        pending = {}
        lines.append(line)
        for m in list(state["chars"]) + ([speaker_model] if speaker_model else []):
            if m not in used and models.get(m):
                used[m] = _model_info(models[m], assets)
    pics = {}
    for ln in lines:  # the pictures the lines name -> their catalog paths
        for key, kind in (("bg", "bg"), ("cg", "cg")):
            name = ln.get(key)
            # ("Unit_CG/10207_normal.png" = 10207_normal)
            found = name and (assets[kind].get(name.lower()) or assets[kind].get(os.path.splitext(name.lower().rsplit("/", 1)[-1])[0]))
            if found:
                pics[f"{kind}:{name}"] = found
        if ln.get("vid") and ln["vid"].lower() in assets["video"]:
            pics[f"vid:{ln['vid']}"] = assets["video"][ln["vid"].lower()]
    return {"id": file_id, "lines": lines, "models": used, "pics": pics}


def _model_info(row: dict, assets: dict) -> dict:
    """A speaker's picture: plain (`img`) or layered (`psb`), and the name's colour."""
    f = str(row.get("fileName") or "")
    out = {"name": row.get("enname") or "", "color": row.get("nameTagColor") or "", "side": row.get("staringSide") or "",
           "y": row.get("bottomYPos") or 0, "s": row.get("scale") or 1, "fc": row.get("nameFontColor") or "",
           "nick": row.get("enNickName") or ""}
    if f.lower() in assets["sprite"]:
        out["img"] = assets["sprite"][f.lower()]
    elif f.lower() in assets["psb"]:
        out["psb"] = assets["psb"][f.lower()]
    if row.get("portraitSpritePath") and row["portraitSpritePath"].lower() in assets["portrait"]:
        out["face"] = assets["portrait"][row["portraitSpritePath"].lower()]
    return out


# ---------------------------------------------------------------------------------------------- what needs the app
def _loc_root(svc) -> str:
    return os.path.join(svc.game.data or "", "Assets", "Resources_moved", "Localize")


UNIT_CG = "Assets/Resources_moved/Sprite/Unit/CG/"

# Ch. 8.5-EX Pilgrimage of Compassion: the game removed its scene scripts after the event; its texts stayed. Pictures
# are shipped in ui/extra; backgrounds, music and who stands on stage are rebuilt from the texts (a guess).
PC_ID, PC_NODE = 9120, 912000
PC_BG = "Assets/Resources_moved/Story/Backgrounds/PC/"
PC_ART = "Assets/Resources_moved/Sprite/StoryTheater/SubChapter9120/"
PC_PLACES = [  # place (or its start) -> background, as the event showed them
    ("???", "story_foggy_beach"), ("A Certain Coast", "story_foggy_beach"), ("Iberian Coastline", "story_foggy_beach"),
    ("Iberian Village", "story_village_inside_night_off"), ("Faro Muerto, Entrance", "story_village_inside_night_off"),
    ("Faro Muerto, Clearing", "story_village_inside_afternoon"), ("Faro Muerto Clearing", "story_village_inside_afternoon"),
    ("Faro Muerto, Yesterday", "story_village_inside_night_off"), ("Faro Muerto, Past", "story_village_inside_night_off"),
    ("Faro Muerto, Unoccupied Building", "story_building_inside"), ("Faro Muerto, Coast", "story_coast"),
    ("Vessel Masas Bridge", "story_masas_controlroom"), ("Vessel Masas Control Room", "story_masas_controlroom_night"),
    ("Vessel Masas Decks", "story_masas_deck"), ("Eye of Iberia, Entrance", "story_lighthouse_out"),
    ("Eye of Iberia, Control Room", "story_lighthouse_control_room"), ("Mayors's Dungeon", "story_fathoms_mayors_v1"),
    ("Ægir", "story_aegir_on"), ("Daguanyuan", "story_daguanyuan_hong")]
PC_ART_OF = {"PC01": "PC01", "PC02": "PC02_1", "PC03": "PC03", "PC04": "PC04", "PC05": "PC05", "PC06": "PC06_1",
             "PC07": "PC07", "PC08": "PC08", "PC09": "PC09"}
PC_MUSIC = "call_of_iberia"


def _pc_files(svc) -> list[str]:
    """The restored chapter's story files in order (PC01A, PC01B, …)."""
    import glob
    names = [os.path.basename(f)[3:-5] for f in glob.glob(os.path.join(_loc_root(svc), "en", "StoryData", "EN_PC*.json"))]
    order = {"A": 1, "B": 0, "I": 2}  # (before the fight, after it, between)
    return sorted((n for n in names if re.fullmatch(r"PC\d+[ABI]\d*", n)), key=lambda n: (int(n[2:4]), order.get(n[4], 3), n))


def _pc_chapter(svc, lang: str) -> dict | None:
    files = _pc_files(svc)
    if not files:
        return None
    nodes = {int(r["id"]): (_line(r.get("title")), str(r.get("desc") or "").strip(), _line(r.get("place")))
             for r in _rows(_loc_root(svc), lang, r"{L}_StageNode91.*\.json$") if str(r.get("id", "")).isdigit()}
    chap = next((r for r in _rows(_loc_root(svc), lang, r"{L}_StageChapterText.*\.json$") if r.get("id") == f"chapter_h_{PC_ID}"), {})
    eps, by = [], {}
    for f in files:
        n = int(f[2:4])
        if n not in by:
            title, desc, place = nodes.get(PC_NODE + n) or ("", "", "")
            by[n] = {"node": PC_NODE + n, "title": title or f"Episode {n}", "desc": desc, "place": place, "parts": [], "n": f"8.5-{n}"}
            eps.append(by[n])
        art = PC_ART_OF.get(f[:4])
        by[n]["parts"].append([f, {"A": "After", "B": "Before", "I": "Inter"}.get(f[4], ""), PC_ART + art + ".webp" if art else ""])
    last = PC_ART + "PC01.webp"
    for e in eps:
        for part in e["parts"]:
            last = part[2] = part[2] or last
    return {"id": PC_ID, "label": _line(chap.get("chapter")) or "8.5-EX", "title": _line(chap.get("chaptertitle")) or "Pilgrimage of Compassion",
            "kind": "restored", "number": "8.5", "company": _line(chap.get("company")), "area": _line(chap.get("area")),
            "time": _line(chap.get("timeline")), "desc": "", "banner": "", "pic": PC_ART + "PC01.webp", "order": -1, "eps": eps}


def _pc_scenes() -> dict:
    """{file: {line number: background / CG}} read off the event's own playthrough (ui/extra/Story/pc_scenes.json)."""
    from . import extra
    path = extra.file_of("Assets/Resources_moved/Story/pc_scenes.json")
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, TypeError, ValueError):
        return {}


def _pc_effect(file_id: str, loc_rows: list[dict], models: dict) -> list[dict]:
    """A scene script for a restored file: backgrounds and pictures as the event showed them (else by place), the
    theme, the last two speakers on stage."""
    seen = _pc_scenes().get(file_id) or {}
    out, stage, first, n, cg = [], [], True, 0, False
    for r in loc_rows:
        row = {"id": r.get("id")}
        place = _line(r.get("place")) if r.get("place") not in (None, -1) else ""
        bg = next((b for pre, b in PC_PLACES if place.startswith(pre)), "") if place and not seen else ""
        shown = seen.get(str(n)) if _tags(r.get("content")).strip() else None
        if shown:
            bg = ""
            if shown == "black" or shown.startswith(("PC", "light")):
                row["cg"], cg = "black" if shown == "black" else "pc_" + shown, True
            else:
                bg = shown
        if bg:
            row["bg"] = bg if bg.startswith("story_daguanyuan") else "pc_" + bg
            if cg:
                row["cg"], cg = "ALL:FadeOut", False
        if first:
            row["bgm"], first = PC_MUSIC, False
            if not row.get("bg") and not row.get("cg"):
                row["bg"] = "pc_" + next((b for pre, b in PC_PLACES if place.startswith(pre)), "story_foggy_beach")
        if _tags(r.get("content")).strip():
            n += 1
        m = str(r.get("model") or "")
        if m and m in models and m not in stage:
            stage = (stage + [m])[-2:]
            row["characterlist"] = "ALL," + ",".join(f"{x}:{3 if i == 0 else 7}" for i, x in enumerate(stage))
        out.append(row)
    return out


def _fools_voices(loc_rows: list[dict], voices) -> dict[int, str]:
    """{row: clip} of April Fools' Day 2023: its clips E000X-<n> are numbered one past their line (the text gained a
    row), so line n-1, else n; a spoken line first."""
    said = lambda i: i < len(loc_rows) and bool(_tags(loc_rows[i].get("content")).strip()) and loc_rows[i].get("model") != DANTE  # noqa: E731
    spoken = lambda i: said(i) and bool(loc_rows[i].get("model") or loc_rows[i].get("teller"))  # noqa: E731
    out = {}
    for k in range(1, len(loc_rows) + 1):
        name = f"{FOOLS_2023}-{k:02d}"
        if name.lower() in voices:
            at = next((i for test in (spoken, said) for i in (k - 1, k) if i not in out and test(i)), None)
            if at is not None:
                out[at] = name
    return out


def _fools_effect(loc_rows: list[dict], models: dict, voices) -> list[dict]:
    """A scene script for April Fools' Day 2023: the picture by its place (FOOLS_PLACES), its voices, the last two
    speakers on stage."""
    out, stage, cg = [], [], False
    said = _fools_voices(loc_rows, voices)
    for n, r in enumerate(loc_rows):
        row = {"id": r.get("id")}
        if n in said:
            row["voice"] = said[n]
        elif r.get("model") == DANTE and "d_wick" in voices:  # (Dante's ticking, as the other stories have it)
            row["voice"] = "D_Wick"
        place = _line(r.get("place")) if r.get("place") not in (None, -1) else ""
        hit = next((x for x in FOOLS_PLACES if place.startswith(x[0])), None) if place else None
        if hit and hit[1] == "cg":
            row["cg"], cg = hit[2], True
        elif hit:
            row["bg"] = hit[2]
            if cg:
                row["cg"], cg = "ALL:FadeOut", False
        m = str(r.get("model") or "")
        if m and m in models and m not in stage:
            stage = (stage + [m])[-2:]
            row["characterlist"] = "ALL," + ",".join(f"{x}:{3 if i == 0 else 7}" for i, x in enumerate(stage))
        out.append(row)
    return out


def assets(svc) -> dict:
    """Name → catalog path of the story's pictures and videos, once per snapshot."""
    import sqlite3
    sid = svc.latest_snapshot_id()
    cached = getattr(svc, "_story_assets", None)
    if cached and cached[0] == sid:
        return cached[1]
    out = {k: {} for k in ("bg", "cg", "sprite", "psb", "portrait", "video", "solid")}
    path = svc.ensure_browse()
    if path:
        con = sqlite3.connect(path)
        base = "Assets/Resources_moved/Story/"
        folders = set()
        for name, typ, c in con.execute("select name, type, c from o where c like ? and type in ('Texture2D', 'Sprite', 'VideoClip')",
                                        (base + "%",)):
            rest = c[len(base):]
            kind = {"Backgrounds": "bg", "CG": "cg", "StandingSprite": "sprite", "StoryPortrait": "portrait", "Video": "video"}.get(rest.split("/")[0])
            if kind == "bg" and rest.count("/") == 2 and os.path.basename(c).lower().startswith("far_"):
                folders.add(rest.split("/")[1])
            if kind:
                out[kind].setdefault(os.path.splitext(os.path.basename(c))[0].lower(), c)
                if kind == "cg" and rest.startswith("CG/Default/"):  # (white, black, red…: the fades' colours)
                    out["solid"][os.path.splitext(os.path.basename(c))[0].lower()] = c
        for (c,) in con.execute("select distinct c from o where c like ? and c like '%.psb'", (base + "StandingModel/%",)):
            out["psb"].setdefault(os.path.splitext(os.path.basename(c))[0].lower(), c)
        # a background named by its folder (Bus_boat_L: far sea + the bus over it) -> the folder, drawn layered
        for f in folders:
            out["bg"].setdefault(f.lower(), base + "Backgrounds/" + f + "/")
        from . import extra  # the restored chapter's backgrounds
        for name, c in extra.files("Story/Backgrounds/PC").items():
            out["bg"]["pc_" + name.lower()] = c
        for sub in ("Story/CG/PC", "Sprite/StoryTheater/SubChapter9120"):  # (pictures shown over the scene)
            for name, c in extra.files(sub).items():
                out["cg"]["pc_" + name.lower()] = c
        for name, c in extra.files("Story/StandingSprite/PC").items():  # (and its people, by scenario fileName)
            out["sprite"].setdefault(name.lower(), c)
        # Identity stories' CG: the Identity's own art
        for (c,) in con.execute("select distinct c from o where c like ? and type = 'Texture2D'", (UNIT_CG + "%",)):
            out["cg"].setdefault(os.path.splitext(os.path.basename(c))[0].lower(), c)
        con.close()
    svc._story_assets = (sid, out)
    return out


def _scenario(svc) -> dict:
    """{model name: scenario-asset row} (kept per snapshot)"""
    sid = svc.latest_snapshot_id()
    cached = getattr(svc, "_story_scn", None)
    if cached and cached[0] == sid:
        return cached[1]
    out = _scenario_read(svc)
    svc._story_scn = (sid, out)
    return out


def _scenario_read(svc) -> dict:
    tab = (svc.static_tables(["scenario-asset"]).get("scenario-asset") or {}).get("ScenarioModelCodeAddressable") or {}
    return {r["name"]: r for r in tab.get("assetData") or [] if isinstance(r, dict) and r.get("name")}


def index(svc, lang: str = "en") -> dict:
    """The Story page's list (cached per snapshot and language)."""
    sid = svc.latest_snapshot_id()
    cached = getattr(svc, "_story_idx", None) or {}
    if cached.get(lang, (None,))[0] == sid:
        return cached[lang][1]
    rel = f"story/index_{lang}_{sid}.json.gz"
    db = svc.store.read_json(rel)
    if db is None or db.get("v") != VERSION:
        tables = svc.static_tables(["storytheater-main", "storytheater-other", "storytheater-personality", "story-loading-cg", "open-story-by-date", *STAGES])
        ids = {x["id"]: {"name": x.get("title") or "", "sinner": x.get("sinnerName")} for x in svc.unit_db().get("ids") or []}
        db = build_index(tables, _loc_root(svc), lang, ids, _files(svc))
        names = {x.get("sinner"): x.get("sinnerName") for x in svc.unit_db().get("ids") or []}
        for sn in db["ident"]:
            sn["name"] = names.get(sn["sinner"]) or f"Sinner {sn['sinner']}"
        for ch in db["main"] + db["other"]:
            ch["pic"] = _banner(svc, ch["banner"])
            last = ch["pic"]
            for ep in ch["eps"]:  # each story's own picture as the Story Theater shows it, else the one before
                for part in ep["parts"]:
                    own = f"Assets/Resources_moved/Sprite/StoryTheater/SubChapter{ch['id']}/{part[0]}.png"
                    last = own if svc.lookup_container(own) else _banner(svc, part[2]) or \
                        (ch["kind"] in ("fools", "extra") and _first_picture(svc, part[0])) or last
                    part[2] = last
        pc = _pc_chapter(svc, lang)
        if pc:
            db["main"].insert(0, pc)
        svc.store.write_json(rel, db)
    cached[lang] = (sid, db)
    svc._story_idx = cached
    return db


def _files(svc) -> set | None:
    """The story files of the latest snapshot (lower case), and the restored ones whose text is there."""
    import sqlite3
    path = svc.ensure_browse()
    if not path:
        return None
    con = sqlite3.connect(path)
    try:
        out = {n.lower() for (n,) in con.execute("select name from o where type = 'TextAsset' and c like 'Assets/Resources_moved/Story/Effect/%'")}
    finally:
        con.close()
    if os.path.exists(os.path.join(_loc_root(svc), "en", "StoryData", f"EN_{FOOLS_2023}.json")):
        out.add(FOOLS_2023.lower())
    return out


def _first_picture(svc, file_id: str) -> str:
    """The first background or picture a story file shows (a list card's picture); "" when none."""
    import sqlite3
    a = assets(svc)
    if file_id.upper() == FOOLS_2023:
        return a["cg"].get(FOOLS_PLACES[1][2].lower(), "")
    path = svc.ensure_browse()
    if not path:
        return ""
    con = sqlite3.connect(path)
    try:
        row = con.execute("select h from o where type = 'TextAsset' and name = ? collate nocase and c like 'Assets/Resources_moved/Story/Effect/%'",
                          (file_id,)).fetchone()
    finally:
        con.close()
    try:
        rows = json.loads(svc.store.get_blob(row[0]).decode("utf-8-sig")).get("dataList", []) if row else []
    except (AttributeError, ValueError):
        return ""
    for r in rows:
        for key in ("cg", "bg"):
            name = str(r.get(key) or "").split(",")[0].split(":")[0].strip().lower()
            if name and name != "all" and name not in a["solid"] and name in a[key]:
                return a[key][name]
    return ""


def _banner(svc, banner: str) -> str:
    """A banner id ("Story_BG/<name>", "Story_CG/<name>" or a catalog path without extension) -> its catalog path."""
    if not banner:
        return ""
    if banner.startswith("Assets/"):
        return next((c for c in (banner + ".png", banner) if svc.lookup_container(c)), "")
    kind, _, name = banner.partition("/")
    return assets(svc)["bg" if kind == "Story_BG" else "cg"].get(name.lower()) or ""


def episode_of(svc, file_id: str, lang: str = "en") -> dict | None:
    """One story file (see episode()): the scene script with the chosen language's text."""
    import sqlite3

    from .viewer import sound_index
    path = svc.ensure_browse()
    if not path or not re.fullmatch(r"[A-Za-z0-9_\-]+", file_id):
        return None
    con = sqlite3.connect(path)
    row = con.execute("select h from o where type = 'TextAsset' and name = ? collate nocase and c like 'Assets/Resources_moved/Story/Effect/%'",
                      (file_id,)).fetchone()
    con.close()
    pc = not row and (re.fullmatch(r"PC\d+[ABI]\d*", file_id) or file_id.upper() == FOOLS_2023)
    if not row and not pc:
        return None
    effect = [] if pc else json.loads(svc.store.get_blob(row[0]).decode("utf-8-sig")).get("dataList", [])
    pre = LANGS[lang]
    fn = os.path.join(_loc_root(svc), lang, "StoryData", f"{pre}_{file_id}.json")
    if not os.path.exists(fn):
        fn = os.path.join(_loc_root(svc), "en", "StoryData", f"EN_{file_id}.json")
    try:
        with open(fn, encoding="utf-8-sig") as f:
            loc_rows = json.load(f).get("dataList", [])
    except (OSError, ValueError):
        loc_rows = []
    key = (svc.latest_snapshot_id(), lang)
    held = getattr(svc, "_story_codes", None)
    if not held or held[0] != key:
        held = (key, {str(r.get("id")): r for r in _rows(_loc_root(svc), lang, r"{L}_ScenarioModelCodes.*\.json$")})
        svc._story_codes = held
    codes = held[1]
    if pc:
        if not loc_rows:
            return None
        effect = _fools_effect(loc_rows, _scenario(svc), sound_index(svc)) if file_id.upper() == FOOLS_2023 else _pc_effect(file_id, loc_rows, _scenario(svc))
    return episode(file_id, effect, loc_rows, codes, _scenario(svc), sound_index(svc), assets(svc))


def model_layout(svc, container: str) -> dict | None:
    """Layout of a layered standing model's sprites, from its prefab."""
    cache = svc.__dict__.setdefault("_story_models", {})
    if container in cache:
        return cache[container]
    from . import extract
    rows = svc.lookup_container(container)
    if not rows:
        return None
    bundle = rows[0]["bundle"]
    file = svc.object_file(bundle)
    if not file:
        return None
    stem = os.path.splitext(os.path.basename(container))[0].lower()
    env = extract._env(file)
    layers = []
    with extract._lock:
        root = None
        for o in env.objects:
            if o.type.name != "GameObject":
                continue
            g = o.read()
            if g.m_Name.lower() != stem:
                continue
            tf = next((c.read() for c in g.m_Components if c.read().__class__.__name__ == "Transform"), None)
            if tf is not None and not tf.m_Father.path_id:
                root = tf
                break
        if root is None:
            return None

        def walk(tf, ox, oy, sx, sy):
            g = tf.m_GameObject.read()
            x, y = ox + tf.m_LocalPosition.x * sx, oy + tf.m_LocalPosition.y * sy
            sx, sy = sx * tf.m_LocalScale.x, sy * tf.m_LocalScale.y
            sr = next((c.read() for c in g.m_Components if c.read().__class__.__name__ == "SpriteRenderer"), None)
            if sr is not None and sr.m_Sprite and sr.m_Sprite.path_id and g.m_IsActive:
                sp = sr.m_Sprite.read()
                w, h = sp.m_Rect.width * abs(sx), sp.m_Rect.height * abs(sy)
                ppu = sp.m_PixelsToUnits or UNIT
                layers.append({"n": g.m_Name, "s": str(sr.m_Sprite.path_id),
                               "l": round(x * UNIT - sp.m_Pivot.x * w, 1), "b": round(y * UNIT - sp.m_Pivot.y * h, 1),
                               "w": round(w * UNIT / ppu, 1), "h": round(h * UNIT / ppu, 1), "o": sr.m_SortingOrder})
            for ch in tf.m_Children:
                walk(ch.read(), x, y, sx, sy)

        walk(root, 0.0, 0.0, 1.0, 1.0)
    out = {"bundle": bundle, "layers": layers}
    cache[container] = out
    return out


def _disk(svc, kind: str, key: str, ext: str, make):
    """An answer kept in data/story_cache/<kind>/."""
    import hashlib
    h = hashlib.sha1(key.encode("utf-8")).hexdigest()
    path = os.path.join(svc.data_dir, "story_cache", kind, h[:2], h + ext)
    try:
        with open(path, "rb") as f:
            return f.read()
    except OSError:
        pass
    data = make()
    if data:
        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path + ".tmp", "wb") as f:
                f.write(data)
            os.replace(path + ".tmp", path)
        except OSError:
            pass
    return data


def _webp(png: bytes, limit: int, quality: int = 85) -> bytes:
    """PNG → WebP no larger than `limit` px."""
    import io

    from PIL import Image
    im = Image.open(io.BytesIO(png))
    im.load()
    if max(im.size) > limit:
        im.thumbnail((limit, limit), Image.LANCZOS)
    out = io.BytesIO()
    im.save(out, "WEBP", quality=quality, method=4)
    return out.getvalue()


def picture(svc, path: str, limit: int = 1920) -> bytes | None:
    """A background / CG / standing picture by catalog path, as a kept WebP."""
    from . import extract
    if path.endswith("/"):
        return _layered(svc, path, limit)
    from . import extra
    own = extra.file_of(path)
    if own:  # (a picture the game no longer has)
        with open(own, "rb") as f:
            return _webp(f.read(), limit)
    rows = svc.lookup_container(path)
    r = next((x for x in rows if x["type"] == "Texture2D"), None) or next((x for x in rows if x["type"] == "Sprite"), None)
    file = svc.object_file(r["bundle"]) if r else None
    if not file:
        return None
    return _disk(svc, "pics", f"{path}|{r['bundle']}|{r['pid']}|{limit}", ".webp",
                 lambda: _webp(extract.extract(file, int(r["pid"]))[0], limit))


def _layered(svc, folder: str, limit: int) -> bytes | None:
    """A background folder's pictures one over the other: far_* first."""
    import io
    import sqlite3

    from PIL import Image

    from . import extract
    con = sqlite3.connect(svc.ensure_browse())
    rows = con.execute("select c, bundle, pid from o where c like ? and type = 'Texture2D' order by c", (folder + "%",)).fetchall()
    con.close()
    rows = [r for r in rows if r[0].count("/") == folder.count("/")]
    if not rows:
        return None
    rows.sort(key=lambda r: not os.path.basename(r[0]).lower().startswith("far_"))

    def make():
        out = None
        for c, bundle, pid in rows:
            file = svc.object_file(bundle)
            if not file:
                continue
            im = Image.open(io.BytesIO(extract.extract(file, int(pid))[0])).convert("RGBA")
            if out is None:
                out = Image.new("RGBA", im.size)
            out.alpha_composite(im if im.size == out.size else im.resize(out.size))
        if out is None:
            return None
        buf = io.BytesIO()
        out.convert("RGB").save(buf, "PNG")
        return _webp(buf.getvalue(), limit)
    return _disk(svc, "pics", f"{folder}|{'|'.join(str(r[2]) for r in rows)}|{limit}", ".webp", make)


UI_SPRITES = {"SettingIcon"}  # (the interface sprites the reader asks for)


def ui_sprite(svc, name: str) -> bytes | None:
    """An interface sprite of the game's UI bundle, by name."""
    import sqlite3
    if name not in UI_SPRITES:
        return None
    con = sqlite3.connect(svc.ensure_browse())
    row = con.execute("select bundle, pid from o where type = 'Sprite' and name = ? and bundle like 'dui_resources_default%'", (name,)).fetchone()
    con.close()
    return sprite_png(svc, row[0], int(row[1])) if row else None


def sprite_png(svc, bundle: str, pid: int) -> bytes | None:
    """One sprite of a layered model, as a kept WebP."""
    from . import extract
    file = svc.object_file(bundle)
    if not file:
        return None
    return _disk(svc, "sprites", f"{bundle}|{pid}", ".webp", lambda: _webp(extract.extract(file, pid)[0], 4096, 90))


def audio(svc, sample: str) -> tuple[bytes, str] | None:
    """A bank sound as kept Ogg Opus (WAV when that fails)."""
    import subprocess

    from .banks import export_wav
    from .viewer import sound_index
    hit = sound_index(svc).get(sample.lower())
    if not hit:
        return None
    wav = []

    def make():
        wav.append(export_wav(*hit)[0])
        try:
            from .site import _ffmpeg
            big = len(wav[0]) > 3_000_000  # music
            p = subprocess.run([_ffmpeg(), "-v", "error", "-i", "pipe:0", "-c:a", "libopus", "-b:a", "96k" if big else "64k", "-f", "ogg", "pipe:1"],
                               input=wav[0], capture_output=True, timeout=120, creationflags=0x08000000 if os.name == "nt" else 0)
            return p.stdout if p.returncode == 0 and p.stdout else b""
        except Exception:
            return b""
    ogg = _disk(svc, "audio", f"{hit[0]}|{hit[1]}", ".ogg", make)
    if ogg:
        return ogg, "audio/ogg"
    return (wav[0] if wav else export_wav(*hit)[0]), "audio/wav"
