"""The story reader (Story): every story the game's Story Theater lists, read scene by scene with its backgrounds, speakers'
standing pictures, voices, sounds and music.

What the game keeps where:
* StaticData storytheater-main / -other / -personality: which story files make a chapter's episodes (a node can have a
  `Before`, an `Inter` and an `After` file) and a banner picture; the chapters' names come from Localize
  StageChapterText, the episodes' from StageNode (and StoryTheaterOther), the chapters' blurbs from StoryTheaterMain.
* Story/Effect/<file>.json: the scene script, one row per line of the story (voice sample, background `bg`, picture
  `cg`, who stands where `characterlist`, expression `feeling`, sound `soundeffect`, music `bgm`, a video, effects).
* Localize/<lang>/StoryData/<LANG>_<file>.json: the same rows' text (`content`), speaker (`model`, `teller`) and title.
* StaticData scenario-asset: a speaker's model name -> the picture file name (Story/StandingSprite/<name>.png, or a layered
  Story/StandingModel/<name>.psb with a body and one face per expression)."""
from __future__ import annotations

import json
import os
import re

VERSION = 1  # bump when the index / an episode's layout changes (cached per snapshot)
LANGS = {"en": "EN", "kr": "KR", "jp": "JP"}
DETAIL = {"Before": "Pre-battle", "Inter": "Interlude", "After": "Post-battle"}
UNIT = 100  # a Unity unit is 100 pixels of a standing picture


def _rows(loc: str, lang: str, pattern: str) -> list[dict]:
    """Every row of the Localize/<lang>/ files whose name matches `pattern` ({L} = the language's prefix), oldest first."""
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


def build_index(tables: dict, loc: str, lang: str = "en", identities: dict | None = None) -> dict:
    """The Story page's list: {"main": [chapter], "other": [chapter], "ident": [Sinner]} (see the module doc).
    tables: StaticData tables storytheater-main / -other / -personality; identities: {id: {"name", "sinner"}}."""
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
    nodes = {r["id"]: _line(r.get("title")) for r in _rows(loc, lang, r"{L}_StageNode.*\.json$") if "id" in r}
    other, event = {}, {}
    for r in _rows(loc, lang, r"{L}_StoryTheaterOther\.json$"):
        m = re.match(r"STORY_(\d+)$", str(r.get("id", "")))
        if m:
            other[int(m.group(1))] = _line(r.get("title"))
        m = re.match(r"EventTitleText_(\d+)$", str(r.get("id", "")))
        if m:
            event[int(m.group(1))] = _line(r.get("title"))

    def chapters(kind: str) -> list[dict]:
        out, seen = [], set()
        for fname in sorted(tables.get(f"storytheater-{kind}") or {}, key=lambda f: [int(x) for x in re.findall(r"\d+", f)] or [0]):
            data = tables[f"storytheater-{kind}"][fname]
            for sub in (data.get("list") or []) if isinstance(data, dict) else []:
                sid, stories = sub.get("subChapterId"), sub.get("storyList") or []
                if not isinstance(sid, int) or sid in seen or not any(x.get('storyId') for x in stories):
                    continue
                seen.add(sid)
                eps, by_node = [], {}
                for s in stories:
                    if not s.get("storyId"):
                        continue
                    node = s.get("nodeId")
                    ep = by_node.get(node)
                    if ep is None:
                        ep = by_node[node] = {"node": node, "title": nodes.get(node) or other.get(node) or "", "parts": []}
                        eps.append(ep)
                    ep["parts"].append([s["storyId"], s.get("stageDetail") or ""])
                c = chap.get(sid) or {}
                label = _line(c.get("chapter")) or ""
                title = _line(c.get("chaptertitle")) or event.get(sid, "")
                number = _line(c.get("chapterNumber"))
                if kind == "other" and not label.startswith("Intervallo"):
                    label = "Mini"
                for i, ep in enumerate(eps, 1):
                    ep["n"] = f"{number.lstrip('0') or '0'}-{i}" if kind == "main" and number != "" else str(i)
                    if not ep["title"]:
                        ep["title"] = f"Episode {ep['n']}"
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
    return {"v": VERSION, "main": main, "other": oth, "ident": ident}


def _tags(text: str) -> str:
    return str(text or "")


def episode(file_id: str, effect: list[dict], loc_rows: list[dict], codes: dict, models: dict, voices, assets: dict) -> dict:
    """One story file as a list of lines: the text and speaker with what the scene shows at that point.
    effect: Story/Effect rows; loc_rows: StoryData rows (by id); codes: {model name: ScenarioModelCodes row};
    models: {model name: scenario-asset row}; voices: a set-like of the sample names that exist; assets: see story_assets().
    A line carries only what changed since the line before: bg (picture name), cg, bgm, sfx, vid, cl = [[model,
    slot]], f = {model: expression}. -> {"id", "lines": [...], "models": {name: {...}}}"""
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
        t = loc.get(row.get("id")) or {}
        if row.get("bg"):
            change("bg", str(row["bg"]).split(":")[0])
        if row.get("cg"):  # "<name>:<FadeIn|FadeOut…>[:range]" entries, several after commas; plain colours are only fades
            for ent in re.split(r",(?![^\[]*\])", str(row["cg"])):
                name, _, how = ent.strip().partition(":")
                name = name.strip()
                if not name or name.lower() in ("blackscreen", "none"):
                    continue
                if name.lower() in assets["solid"]:
                    continue
                if how.strip().lower().startswith(("fadeout", "off")):
                    if state["cg"] == name:
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
        feeling = str(row.get("feeling") or "")
        if feeling:
            who_model = speaker_model or next(reversed(state["chars"]), "")
            if who_model and state["feel"].get(who_model) != feeling:
                state["feel"][who_model] = feeling
                pending.setdefault("f", {})[who_model] = feeling
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
            if name and name.lower() in assets[kind]:
                pics[f"{kind}:{name}"] = assets[kind][name.lower()]
        if ln.get("vid") and ln["vid"].lower() in assets["video"]:
            pics[f"vid:{ln['vid']}"] = assets["video"][ln["vid"].lower()]
    return {"id": file_id, "lines": lines, "models": used, "pics": pics}


def _model_info(row: dict, assets: dict) -> dict:
    """What the page needs of a speaker's picture: a plain picture (`img`), a layered model (`psb`) and the name's colour."""
    f = str(row.get("fileName") or "")
    out = {"name": row.get("enname") or "", "color": row.get("nameTagColor") or "", "side": row.get("staringSide") or "",
           "y": row.get("bottomYPos") or 0}
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


def assets(svc) -> dict:
    """Name (lower case) -> catalog path of the story's pictures: backgrounds, CG, plain standing pictures, layered
    models (.psb), speakers' log portraits and the videos. Read once per snapshot."""
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
        for name, typ, c in con.execute("select name, type, c from o where c like ? and type in ('Texture2D', 'Sprite', 'VideoClip')",
                                        (base + "%",)):
            rest = c[len(base):]
            kind = {"Backgrounds": "bg", "CG": "cg", "StandingSprite": "sprite", "StoryPortrait": "portrait", "Video": "video"}.get(rest.split("/")[0])
            if kind:
                out[kind].setdefault(os.path.splitext(os.path.basename(c))[0].lower(), c)
                if kind == "cg" and rest.startswith("CG/Default/"):  # (white, black, red…: the fades' colours)
                    out["solid"][os.path.splitext(os.path.basename(c))[0].lower()] = c
        for (c,) in con.execute("select distinct c from o where c like ? and c like '%.psb'", (base + "StandingModel/%",)):
            out["psb"].setdefault(os.path.splitext(os.path.basename(c))[0].lower(), c)
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
        tables = svc.static_tables(["storytheater-main", "storytheater-other", "storytheater-personality"])
        ids = {x["id"]: {"name": x.get("title") or "", "sinner": x.get("sinnerName")} for x in svc.unit_db().get("ids") or []}
        db = build_index(tables, _loc_root(svc), lang, ids)
        names = {x.get("sinner"): x.get("sinnerName") for x in svc.unit_db().get("ids") or []}
        for sn in db["ident"]:
            sn["name"] = names.get(sn["sinner"]) or f"Sinner {sn['sinner']}"
        found = assets(svc)
        for ch in db["main"] + db["other"]:  # a banner is "Story_BG/<name>" or "Story_CG/<name>": its catalog path
            kind, _, name = ch["banner"].partition("/")
            if ch["banner"].startswith("Assets/"):  # (the Prologue's is a catalog path without its extension)
                ch["pic"] = next((c for c in (ch["banner"] + ".png", ch["banner"]) if svc.lookup_container(c)), "")
            else:
                ch["pic"] = found["bg" if kind == "Story_BG" else "cg"].get(name.lower()) or ""
        svc.store.write_json(rel, db)
    cached[lang] = (sid, db)
    svc._story_idx = cached
    return db


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
    if not row:
        return None
    effect = json.loads(svc.store.get_blob(row[0]).decode("utf-8-sig")).get("dataList", [])
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
    return episode(file_id, effect, loc_rows, codes, _scenario(svc), sound_index(svc), assets(svc))


def model_layout(svc, container: str) -> dict | None:
    """A layered standing model (Story/StandingModel/<name>.psb): where each of its sprites (the body `default`, one
    `face_<expression>` each, front pieces) sits, in pixels, y up, from the model's own prefab.
    -> {"bundle", "layers": [{"n", "s" (sprite id), "l", "b" (left, bottom), "w", "h", "o" (draw order)}]}"""
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
    """A made answer kept in data/story_cache/<kind>/ so the game's files are opened and converted once."""
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
    """A PNG as WebP, no larger than `limit` pixels either way (a fraction of the size, pictures are shown at most full screen)."""
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
    rows = svc.lookup_container(path)
    r = next((x for x in rows if x["type"] == "Texture2D"), None) or next((x for x in rows if x["type"] == "Sprite"), None)
    file = svc.object_file(r["bundle"]) if r else None
    if not file:
        return None
    return _disk(svc, "pics", f"{path}|{r['bundle']}|{r['pid']}|{limit}", ".webp",
                 lambda: _webp(extract.extract(file, int(r["pid"]))[0], limit))


def sprite_png(svc, bundle: str, pid: int) -> bytes | None:
    """One sprite of a layered model (as a kept WebP: the page sizes it from the layout, so its pixels may shrink)."""
    from . import extract
    file = svc.object_file(bundle)
    if not file:
        return None
    return _disk(svc, "sprites", f"{bundle}|{pid}", ".webp", lambda: _webp(extract.extract(file, pid)[0], 4096, 90))


def audio(svc, sample: str) -> tuple[bytes, str] | None:
    """A sound of the banks (voice line, effect, music) as a kept Ogg Opus; the plain WAV when it can't be made."""
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
