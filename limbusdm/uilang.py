"""The app's own interface in other languages: English UI strings collected from the pages (data/ui_lang/strings.json),
a dictionary per language (data/ui_lang/<lang>.json: machine or checked by a person), CSV export / import for
translators. Apps without the files get the published dictionaries (lang-data branch, see langs.published)."""
from __future__ import annotations

import csv
import io
import json
import os
import re
import threading
import time

VERSION = 1
NUM = re.compile(r"\d+(?:[.,:]\d+)*")
# words machine translation must leave alone
KEEP = ("Limbus Archive", "Limbus Company", "E.G.O", "Spine", "Discord", "Twitch", "YouTube", "Bilibili", "Steam",
        "GitHub", "GIF", "WebM", "MP4", "WAV", "PNG", "ZIP", "FMOD", "Unity")
# names of the app's own parts: left in English when they stand alone
NAMES = {"limbus", "archive", "limbus archive", "versus", "live", "auto battler", "daily"}
MAX_LEN = 600
_lock = threading.Lock()
_job: dict = {}
_game: dict = {}  # the game's English texts (not UI): {"sig", "set"}


def _dir(svc) -> str:
    return os.path.join(svc.data_dir, "ui_lang")


def template(text: str) -> tuple[str, list[str]]:
    """\"3 of 10 rows\" → (\"{0} of {1} rows\", [\"3\", \"10\"]); whitespace collapsed."""
    nums = []

    def put(m):
        nums.append(m.group(0))
        return "{%d}" % (len(nums) - 1)
    return NUM.sub(put, " ".join(text.split())), nums


def _read(path: str, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def _write(path: str, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path + ".tmp", "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=0, sort_keys=True)
    os.replace(path + ".tmp", path)


def strings(svc) -> dict:
    return _read(os.path.join(_dir(svc), "strings.json"), {}).get("strings", {})


def lang_file(svc, lang: str) -> str:
    return os.path.join(_dir(svc), f"{lang}.json")


def table(svc, lang: str) -> dict:
    """{template: [translation, "m" machine | "h" person]}"""
    return _read(lang_file(svc, lang), {}).get("t", {})


def _game_texts(svc) -> set:
    """Every English text of the game (names, skills, lines…): those are the game's, not the UI's."""
    from . import langs
    sig = langs._en_sig(svc)
    if _game.get("sig") != sig:
        out = set()
        for rows in langs._english(svc)["files"].values():
            for rec in rows.values():
                for _, s in langs._strings(rec):
                    one = " ".join(s.split())
                    out.add(one)
                    out.add(template(one)[0])
        _game.update(sig=sig, set=out)
    return _game["set"]


def _is_ui(s: str) -> bool:
    if not s or len(s) > MAX_LEN or not re.search(r"[A-Za-z]{2}", s):
        return False
    if " " not in s and re.search(r"[_/\\]|\.\w", s):  # file names
        return False
    # code words (BoxCollider, LeNoir) and names glued to numbers (cp{0}, S{1})
    if any(re.search(r"[a-z][A-Z]", w) and w.strip("()[].,:;!?") not in KEEP for w in s.split()) or re.search(r"[A-Za-z]\{\d+\}", s):
        return False
    return not re.search(r"https?://|^#/|\.(png|jpg|zip|json|wav|mp4|webm|gif)\b", s, re.I)


def add_seen(svc, texts: list, page: str = "") -> int:
    """Merge strings a page showed; game texts and non-UI bits left out. Returns how many were new."""
    game = _game_texts(svc)
    with _lock:
        path = os.path.join(_dir(svc), "strings.json")
        doc = _read(path, {"v": VERSION, "strings": {}})
        have, new = doc.setdefault("strings", {}), 0
        for t in texts[:5000]:
            key = template(str(t))[0]
            if key in have or not _is_ui(key) or key in game or " ".join(str(t).split()) in game:
                continue
            have[key] = {"at": time.strftime("%Y-%m-%d"), "page": str(page)[:40]}
            new += 1
        if new:
            _write(path, doc)
    return new


def dictionary(svc, lang: str) -> dict:
    """{template: translation} for the pages: this computer's file, else the published one, else {}."""
    if not re.match(r"^[a-z]{2}(-[A-Za-z]{2,4})?$", lang or ""):
        return {}
    if os.path.exists(lang_file(svc, lang)):
        if not offered(svc, lang):
            return {}
        return {k: v[0] for k, v in table(svc, lang).items() if v and v[0] and k.lower() not in NAMES}
    return _published(svc, lang)


def _published(svc, lang: str) -> dict:
    from . import langs
    e = (langs.published(svc).get("ui") or {}).get(lang)
    sha = (langs._pub["doc"] or {}).get("sha", "")
    if not e or not langs.SAFE.match(str(e.get("file", ""))) or not langs.SAFE.match(str(e.get("sig", ""))):
        return {}
    path = os.path.join(langs._cache_dir(svc), f"ui-{lang}.{e['sig']}.json")
    if not os.path.exists(path) and re.match(r"^[0-9a-f]{40}$", sha):
        try:
            data = langs._get(langs.PUB_RAW % (sha, e["file"]), 60)
            json.loads(data)
            os.makedirs(langs._cache_dir(svc), exist_ok=True)
            for old in os.listdir(langs._cache_dir(svc)):
                if old.startswith(f"ui-{lang}."):
                    os.remove(os.path.join(langs._cache_dir(svc), old))
            with open(path, "wb") as f:
                f.write(data)
        except Exception:
            return {}
    return _read(path, {})


def local_langs(svc) -> list:
    """Languages with a dictionary file on this computer, offered or not."""
    names = [fn[:-5] for fn in os.listdir(_dir(svc))] if os.path.isdir(_dir(svc)) else []
    return sorted(x for x in names if re.match(r"^[a-z]{2}(-[A-Za-z]{2,4})?$", x))


def _off(svc) -> list:
    return _read(os.path.join(_dir(svc), "off.json"), [])


def offered(svc, lang: str) -> bool:
    return lang not in _off(svc)


def set_offer(svc, lang: str, on: bool):
    """Unoffered: kept on disk, but used nowhere and not published."""
    off = [x for x in _off(svc) if x != lang] + ([] if on else [lang])
    _write(os.path.join(_dir(svc), "off.json"), off)


def delete(svc, lang: str):
    for p in (lang_file(svc, lang), os.path.join(_dir(svc), f"mt_cache_{lang}.json")):
        if os.path.exists(p):
            os.remove(p)
    set_offer(svc, lang, True)


def available(svc) -> list:
    """UI languages there are (offered local files and published ones)."""
    from . import langs
    local = local_langs(svc)
    pub = [x for x in (langs.published(svc).get("ui") or {}) if x not in local]
    return sorted([x for x in local if offered(svc, x)] + pub)


def status(svc) -> dict:
    s = {k: v for k, v in strings(svc).items() if k.lower() not in NAMES}
    out = {"strings": len(s), "langs": {}, "job": dict(_job)}
    for lang in sorted(set(available(svc)) | set(local_langs(svc))):
        local = os.path.exists(lang_file(svc, lang))
        t = table(svc, lang) if local else {}
        done = [k for k in s if (t.get(k) or [""])[0]]
        out["langs"][lang] = {"local": local, "on": offered(svc, lang), "done": len(done),
                              "human": sum(1 for k in done if t[k][1] == "h"), "missing": len(s) - len(done)}
    return out


# ---------------------------------------------------------------- machine translation
def _protect(s: str) -> str:
    for i, w in enumerate(KEEP):
        s = s.replace(w, "{%d}" % (90 + i))
    return s


def _restore(s: str) -> str:
    for i, w in enumerate(KEEP):
        s = s.replace("{%d}" % (90 + i), w)
    return s


def _ok(src: str, out: str) -> bool:
    return sorted(re.findall(r"\{\d+\}", src)) == sorted(re.findall(r"\{\d+\}", out))


def translate_missing(svc, lang: str):
    """Machine-translate every collected string the language lacks (background job)."""
    from .translate import Translator
    if not re.match(r"^[a-z]{2}(-[A-Za-z]{2,4})?$", lang):
        raise ValueError("bad language code")
    tr = Translator(os.path.join(_dir(svc), f"mt_cache_{lang}.json"), target=lang)
    todo = [k for k in strings(svc) if not (table(svc, lang).get(k) or [""])[0] and k.lower() not in NAMES]
    _job.update(kind="translate", lang=lang, done=0, total=len(todo), state="busy", error="")
    try:
        for i in range(0, len(todo), 40):
            part = todo[i:i + 40]
            got = tr.translate([_protect(k) for k in part])
            with _lock:
                doc = _read(lang_file(svc, lang), {"v": VERSION, "lang": lang, "t": {}})
                t = doc.setdefault("t", {})
                for k, g in zip(part, got):
                    g = _restore(g or "")
                    if g and _ok(k, g) and not (t.get(k) or ["", ""])[1] == "h":
                        t[k] = [g, "m"]
                _write(lang_file(svc, lang), doc)
            _job["done"] = min(len(todo), i + 40)
        _job.update(state="done", at=int(time.time()))
    except Exception as e:
        _job.update(state="error", error=f"{type(e).__name__}: {e}"[:300])


def start(svc, kind: str, **kw) -> bool:
    if _job.get("state") == "busy":
        return False
    _job.clear()
    _job.update(state="busy", kind=kind)
    fn = {"translate": translate_missing, "crawl": crawl}[kind]
    threading.Thread(target=lambda: _safe_run(fn, svc, **kw), daemon=True).start()
    return True


def _safe_run(fn, svc, **kw):
    try:
        fn(svc, **kw)
    except Exception as e:
        _job.update(state="error", error=f"{type(e).__name__}: {e}"[:300])


# ---------------------------------------------------------------- files for translators
def export_csv(svc, lang: str) -> str:
    """data/exports/ui-<lang>.csv (UTF-8 with BOM): key, English, translation, who. Returns its path."""
    t, rows = table(svc, lang), []
    for k in sorted(strings(svc), key=str.lower):
        if k.lower() in NAMES:
            continue
        tr, who = (t.get(k) or ["", ""])[:2]
        rows.append([k, k, tr, {"h": "person", "m": "machine"}.get(who, "")])
    path = os.path.join(svc.data_dir, "exports", f"ui-{lang}.csv")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["key", "English", "Translation", "Who"])
        w.writerows(rows)
    return path


def import_csv(svc, lang: str, text: str) -> dict:
    """A translator's file back: a changed translation counts as checked by a person. Returns counts."""
    if not re.match(r"^[a-z]{2}(-[A-Za-z]{2,4})?$", lang):
        raise ValueError("bad language code")
    text = text.lstrip("﻿")
    try:
        dialect = csv.Sniffer().sniff(text[:4000], delimiters=",;\t")
    except csv.Error:
        dialect = csv.excel
    rows = list(csv.reader(io.StringIO(text), dialect))
    if not rows or [c.strip().lower() for c in rows[0][:3]] != ["key", "english", "translation"]:
        raise ValueError("not a Limbus Archive interface file (the first row must be key, English, Translation)")
    known, changed, cleared, bad = set(strings(svc)), 0, 0, 0
    with _lock:
        doc = _read(lang_file(svc, lang), {"v": VERSION, "lang": lang, "t": {}})
        t = doc.setdefault("t", {})
        for r in rows[1:]:
            if len(r) < 3 or r[0] not in known:
                continue
            k, new = r[0], r[2].strip()
            old = (t.get(k) or ["", ""])[0]
            if new == old:
                continue
            if not new:
                t.pop(k, None)
                cleared += 1
            elif _ok(k, new):
                t[k] = [new, "h"]
                changed += 1
            else:
                bad += 1
        _write(lang_file(svc, lang), doc)
    return {"changed": changed, "cleared": cleared, "bad": bad}


# ---------------------------------------------------------------- collecting from every page
def crawl(svc, port: int, routes: list | None = None):
    """Open the app's pages in headless Edge / Chrome and collect what they show (sections and their named sub-pages;
    `routes`: only these)."""
    import subprocess
    from urllib.request import urlopen
    from .sitecheck import _Tab, _free_port, close_browser, find_browser, new_profile
    exe = find_browser()
    if not exe:
        raise RuntimeError("no Edge or Chrome")
    dbg, prof = _free_port(), new_profile("limbus-ui-")
    proc = subprocess.Popen([exe, "--headless=new", f"--remote-debugging-port={dbg}", f"--user-data-dir={prof}",
                             "--window-size=1600,1000", "--remote-allow-origins=*", "--mute-audio", "--no-first-run",
                             "--lang=en-US", "about:blank"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    tab = None
    try:
        tabs = None
        for _ in range(60):
            try:
                tabs = json.load(urlopen(f"http://127.0.0.1:{dbg}/json", timeout=2))
                break
            except Exception:
                time.sleep(0.25)
        if not tabs:
            raise RuntimeError("the browser didn't start")
        tab = _Tab(next(t for t in tabs if t["type"] == "page")["webSocketDebuggerUrl"])
        tab.call("Page.enable")
        base = f"http://127.0.0.1:{port}/"
        todo, seen, found = list(routes or ["patches"]), set(), 0
        _job.update(done=0, total=1, new=0)
        while todo and len(seen) < 160:
            route = todo.pop(0)
            if route in seen:
                continue
            seen.add(route)
            tab.call("Page.navigate", url=f"{base}#/{route}")
            time.sleep(3.5)
            got = tab.js("JSON.stringify({s: window.uiCollect ? uiCollect() : [], l: [...document.querySelectorAll('a[href^=\"#/\"]')].map(a => a.getAttribute('href').slice(2))})") or "{}"
            got = json.loads(got)
            found += add_seen(svc, got.get("s") or [], route)
            depth = route.count("/")
            for r in got.get("l") or []:
                r = r.split("?")[0]
                # sections and their named sub-pages only, not every card ("enemies/8049")
                if not routes and r and r not in seen and r not in todo and depth < 1 and re.match(r"^[a-z-]+(/[a-z-]+)?$", r):
                    todo.append(r)
            _job.update(done=len(seen), total=len(seen) + len(todo), new=found, page=route)
        _job.update(state="done", at=int(time.time()), new=found)
    finally:
        try:
            if tab:
                tab.call("Browser.close")
        except Exception:
            pass
        close_browser(proc, prof)
