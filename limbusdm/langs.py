"""The game's texts in other languages (the game's KR / JP, players' packs in data/lang) as "English → text" tables the
pages apply. Made tables can be published on the `lang-data` branch; apps download them instead of making them."""
from __future__ import annotations

import collections
import gzip
import hashlib
import json
import os
import re
import threading
import time
import urllib.request

from . import REPO, links

VERSION = 4
PUB_BRANCH = "lang-data"
# branch commit via info/refs (no API limit), files by commit
PUB_REFS = f"https://github.com/{REPO}.git/info/refs?service=git-upload-pack"
PUB_RAW = f"https://raw.githubusercontent.com/{REPO}/%s/%s"
PUB_KEEP = 600  # seconds the published list is used before it is asked again
SAFE = re.compile(r"^[\w.-]+$")
GROUPS = ("core", "story")
STORY = re.compile(r"(^|/)(storydata|personalityvoicedlg|egovoicedig|battleannouncerdlg|bgmlyrics)/|dlg|voice", re.I)
# private-use glyphs (a pack's own font): such texts stay English
OWN_GLYPHS = re.compile("[-]")
OFFICIAL = (("kr", "KR_", "ko"), ("jp", "JP_", "ja"))
# a pack's language by its id's start
BY_ID = (("ru", "ru"), ("es", "es"), ("zh-cn", "zh-Hans"), ("hans", "zh-Hans"), ("hant", "zh-Hant"), ("ptbr", "pt-BR"),
         ("pt", "pt-BR"), ("th", "th"), ("it", "it"), ("vn", "vi"), ("vi", "vi"), ("de", "de"), ("fr", "fr"),
         ("pl", "pl"), ("tr", "tr"), ("id", "id"), ("uk", "uk"), ("ko", "ko"), ("ja", "ja"))
NATIVE = {"ko": "한국어", "ja": "日本語", "ru": "Русский", "es": "Español", "zh-Hans": "简体中文", "zh-Hant": "繁體中文",
          "pt-BR": "Português (BR)", "th": "ไทย", "it": "Italiano", "vi": "Tiếng Việt", "de": "Deutsch", "fr": "Français",
          "pl": "Polski", "tr": "Türkçe", "id": "Bahasa Indonesia", "uk": "Українська"}
_lock = threading.Lock()
_en: dict = {}  # the English files read once: (signature, {file: {id: record}})
_pub: dict = {"at": 0.0, "doc": None, "reading": False}  # the published list: when it was asked, what it said
_last = [None]  # the language asked for last (kept in lang_cache/last.txt: made ready at the next start)


def _loc(svc) -> str:
    return os.path.join(svc.game.data or "", "Assets", "Resources_moved", "Localize")


def _cache_dir(svc) -> str:
    return os.path.join(svc.data_dir, "lang_cache")


def _lang_of(pid: str) -> str:
    low = pid.lower()
    for start, code in BY_ID:
        if low == start or low.startswith(start + "-") or low.startswith(start + "_"):
            return code
    return low


def _files(root: str, prefix: str = "") -> dict[str, str]:
    """{the file's name as the English one is named, without "EN_" and lower case: its path}"""
    return {k: v[0] for k, v in _listed(root, prefix).items()}


def _listed(root: str, prefix: str = "", rel: str = "") -> dict[str, tuple]:
    """_files with each file's size and time"""
    out = {}
    try:
        entries = list(os.scandir(os.path.join(root, rel) if rel else root))
    except OSError:
        return out
    for e in entries:
        if e.is_dir():
            out.update(_listed(root, prefix, rel + e.name + "/"))
        elif e.name.lower().endswith(".json") and (not prefix or e.name.startswith(prefix)):
            st = e.stat()
            out[(rel + e.name[len(prefix):]).lower()] = (e.path, st.st_size, int(st.st_mtime))
    return out


def _get(url: str, timeout: int, ua: str = "LimbusArchive") -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": ua})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def _pub_read(svc):
    try:
        refs = _get(PUB_REFS, 10, "git/2.45")
        m = re.search(rb"([0-9a-f]{40}) refs/heads/" + PUB_BRANCH.encode() + rb"\n", refs)
        if not m:  # nothing published yet
            doc = {}
        else:
            sha = m.group(1).decode()
            doc = json.loads(_get(PUB_RAW % (sha, "index.json"), 15))
            doc["sha"] = sha
        _pub["doc"] = doc
        os.makedirs(_cache_dir(svc), exist_ok=True)
        with open(os.path.join(_cache_dir(svc), "published.json"), "w", encoding="utf-8") as f:
            json.dump(doc, f, ensure_ascii=False)
    except Exception:  # offline: the list read before stays
        pass
    finally:
        _pub["reading"] = False


def published(svc) -> dict:
    """The published languages {"sha", "langs"}, {} when none; refreshed in the background."""
    if _pub["doc"] is None:
        try:
            with open(os.path.join(_cache_dir(svc), "published.json"), encoding="utf-8") as f:
                _pub["doc"] = json.load(f)
        except (OSError, ValueError):
            _pub["doc"] = {}
            _pub["at"] = time.time()
            _pub["reading"] = True
            _pub_read(svc)
    if time.time() - _pub["at"] > PUB_KEEP and not _pub["reading"]:
        _pub["at"] = time.time()
        _pub["reading"] = True
        threading.Thread(target=_pub_read, args=(svc,), daemon=True).start()
    return _pub["doc"] or {}


def forget_published(svc):
    """read the published list again now (after publishing)"""
    _pub["at"] = time.time()
    _pub["reading"] = True
    _pub_read(svc)


def sources(svc) -> list[dict]:
    """The languages there are; dir None = published only, pub = its published copy."""
    out, seen = [], set()
    loc = _loc(svc)
    for code, prefix, lang in OFFICIAL:
        d = os.path.join(loc, code)
        if os.path.isdir(d):
            out.append({"id": code, "name": "Official", "lang": lang, "dir": d, "prefix": prefix, "version": "", "authors": [], "link": "", "license": {}, "discord": ""})
            seen.add(code)
    for root in [os.path.join(svc.data_dir, "lang")]:
        if not os.path.isdir(root):
            continue
        for name in sorted(os.listdir(root)):
            d = os.path.join(root, name)
            if name.startswith((".", "_")) or name in seen or not os.path.isdir(d):
                continue
            if not any(fn.lower().endswith(".json") and fn.lower() != "pack.json" for fn in os.listdir(d)):
                continue
            meta = {}
            try:
                with open(os.path.join(d, "pack.json"), encoding="utf-8") as f:
                    meta = json.load(f)
            except (OSError, ValueError):
                pass
            seen.add(name)
            out.append({"id": name, "name": meta.get("name") or name, "lang": meta.get("lang") or _lang_of(name), "dir": d,
                        "prefix": "", "version": str(meta.get("version") or ""), "authors": meta.get("authors") or [],
                        "link": meta.get("link") or "", "license": meta.get("license") or {},
                        "discord": meta.get("discord") or ""})
    for e in published(svc).get("langs") or []:
        if not isinstance(e, dict) or not SAFE.match(str(e.get("id", ""))) or not SAFE.match(str(e.get("sig", ""))):
            continue
        mine = next((s for s in out if s["id"] == e["id"]), None)
        if mine:
            mine["pub"] = e
            mine["discord"] = mine["discord"] or e.get("discord") or ""
        else:
            out.append({"id": e["id"], "name": e.get("name") or e["id"], "lang": e.get("lang") or _lang_of(e["id"]), "dir": None,
                        "prefix": None, "version": str(e.get("version") or ""), "authors": e.get("authors") or [],
                        "link": e.get("link") or "", "license": e.get("license") or {}, "discord": e.get("discord") or "", "pub": e})
    for s in out:
        s["label"] = NATIVE.get(s["lang"], s["lang"])
    return out


def _sig(files: dict[str, tuple]) -> str:
    h = hashlib.sha1()
    for k in sorted(files):
        h.update(f"{k}|{files[k][1]}|{files[k][2]}\n".encode())
    return h.hexdigest()[:16]


def _read(path: str) -> dict:
    """{id: record} of a texts file (a trailing comma is forgiven)."""
    try:
        with open(path, encoding="utf-8-sig") as f:
            raw = f.read()
    except OSError:
        return {}
    for text in (raw, re.sub(r",(\s*[}\]])", r"\1", raw)):
        try:
            d = json.loads(text)
            break
        except ValueError:
            continue
    else:
        return {}
    rows = d.get("dataList") if isinstance(d, dict) else None
    return {str(r["id"]): r for r in rows or [] if isinstance(r, dict) and "id" in r}


def _strings(o, path=""):
    if isinstance(o, str):
        yield path, o
    elif isinstance(o, dict):
        for k, v in o.items():
            if k != "id":
                yield from _strings(v, f"{path}/{k}")
    elif isinstance(o, list):
        for i, v in enumerate(o):
            yield from _strings(v, f"{path}/{i}")


def _en_sig(svc) -> str:
    return _sig(_listed(os.path.join(_loc(svc), "en"), "EN_"))


def _english(svc) -> dict:
    en = _files(os.path.join(_loc(svc), "en"), "EN_")
    sig = _en_sig(svc)
    if _en.get("sig") != sig:
        _en.clear()
        _en.update(sig=sig, files={k: _read(p) for k, p in en.items()})
    return _en


def _build(svc, src: dict) -> dict:
    en = _english(svc)
    mine = _files(src["dir"], src["prefix"])
    seen = {g: collections.defaultdict(collections.Counter) for g in GROUPS}
    total = {g: 0 for g in GROUPS}
    done = {g: 0 for g in GROUPS}
    for key, rows in en["files"].items():
        g = "story" if STORY.search(key) else "core"
        theirs = _read(mine[key]) if key in mine else {}
        for rid, rec in rows.items():
            t = dict(_strings(theirs.get(rid) or {}))
            for path, s in _strings(rec):
                if not re.search(r"[^\W\d_]", s):
                    continue
                total[g] += 1
                x = t.get(path)
                if x and x != s and x.strip() and not OWN_GLYPHS.search(x):
                    seen[g][s][x] += 1
                    done[g] += 1
    tables = {g: {} for g in GROUPS}
    for g in GROUPS:
        for s, c in seen[g].items():
            x = _own_tags(s, c.most_common(1)[0][0])
            tables[g][s] = x
            one = " ".join(s.split())  # (the app shows many texts on one line: "The House of Spiders:\nThe …" → "… The …")
            if one != s and one not in seen[g]:
                tables[g].setdefault(one, " ".join(x.split()))
    cover = {g: round(100 * done[g] / total[g]) if total[g] else 0 for g in GROUPS}
    return {"tables": tables, "cover": cover}


TAG = re.compile(r"</?([a-zA-Z-]+)(?:=[^>]*)?>")
READ = {"link", "style", "sprite", "color", "u", "b", "i", "s"}  # marks the pages read (db.js fmtDesc: a status' <link>…)


def _own_tags(en: str, x: str) -> str:
    """Drops look-only tags a translation adds (<cspace>, <nobr>…)."""
    keep = READ | {m.group(1).lower() for m in TAG.finditer(en)}
    return TAG.sub(lambda m: m.group(0) if m.group(1).lower() in keep else "", x)


def _paths(svc, src: dict, en_sig: str) -> tuple[str, dict]:
    sig = hashlib.sha1(f"{VERSION}|{en_sig}|{_sig(_listed(src['dir'], src['prefix']))}".encode()).hexdigest()[:12]
    base = os.path.join(_cache_dir(svc), f"{src['id']}.{sig}")
    return base, {g: f"{base}.{g}.json.gz" for g in GROUPS}


def source_key(svc, src: dict) -> str:
    """Name of what a local table is made of (same as the published copy's when equal)."""
    return os.path.basename(_paths(svc, src, _en_sig(svc))[0])


def _drop_old(svc, lid: str, base: str):
    """the same language's tables of older texts"""
    for old in os.listdir(_cache_dir(svc)):
        if old.startswith(lid + ".") and not os.path.join(_cache_dir(svc), old).startswith(base + "."):
            try:
                os.remove(os.path.join(_cache_dir(svc), old))
            except OSError:
                pass


def _fetch_pub(svc, e: dict) -> dict:
    """the published tables of a language, downloaded once (kept by their signature)"""
    base = os.path.join(_cache_dir(svc), f"{e['id']}.p{e['sig']}")
    files = {g: f"{base}.{g}.json.gz" for g in GROUPS}
    if all(os.path.exists(p) for p in files.values()):
        return files
    sha = (_pub["doc"] or {}).get("sha", "")
    names = e.get("files") or {}
    if not re.match(r"^[0-9a-f]{40}$", sha) or not all(SAFE.match(str(names.get(g, ""))) for g in GROUPS):
        raise ValueError("the published list is not readable")
    os.makedirs(_cache_dir(svc), exist_ok=True)
    for g, p in files.items():
        data = _get(PUB_RAW % (sha, names[g]), 120)
        if data[:2] != b"\x1f\x8b":
            raise ValueError("not a table")
        with open(p + ".tmp", "wb") as f:
            f.write(data)
        os.replace(p + ".tmp", p)
    with open(base + ".meta.json", "w", encoding="utf-8") as f:
        json.dump({"cover": e.get("cover")}, f)
    _drop_old(svc, e["id"], base)
    return files


def _remember(svc, lid: str):
    if _last[0] == lid:
        return
    _last[0] = lid
    try:
        os.makedirs(_cache_dir(svc), exist_ok=True)
        with open(os.path.join(_cache_dir(svc), "last.txt"), "w", encoding="utf-8") as f:
            f.write(lid)
    except OSError:
        pass


def table_file(svc, lid: str, group: str, local: bool = False) -> str | None:
    """A language part's table file: own one, else the published one, else made here. local: always own."""
    src = next((s for s in sources(svc) if s["id"] == lid), None)
    if not src or group not in GROUPS:
        return None
    with _lock:
        if not local:
            _remember(svc, lid)
        pub = src.get("pub")
        if src["dir"] is None:
            return _fetch_pub(svc, pub)[group]
        base, files = _paths(svc, src, _en_sig(svc))
        if all(os.path.exists(p) for p in files.values()):
            return files[group]
        if pub and not local and (src["prefix"] or pub.get("src") == os.path.basename(base)):
            try:
                return _fetch_pub(svc, pub)[group]
            except Exception:  # (offline: made here)
                pass
        made = _build(svc, src)
        os.makedirs(_cache_dir(svc), exist_ok=True)
        _drop_old(svc, src["id"], base)
        for g, p in files.items():
            with open(p + ".tmp", "wb") as f:
                f.write(gzip.compress(json.dumps(made["tables"][g], ensure_ascii=False).encode("utf-8"), 6, mtime=0))
            os.replace(p + ".tmp", p)
        with open(base + ".meta.json", "w", encoding="utf-8") as f:
            json.dump({"cover": made["cover"]}, f)
        return files[group]


def warm(svc):
    """At start: make the last asked language ready."""
    try:
        with open(os.path.join(_cache_dir(svc), "last.txt"), encoding="utf-8") as f:
            lid = f.read().strip()
    except OSError:
        return
    _last[0] = lid
    time.sleep(5)  # (after the window's first requests)
    try:
        table_file(svc, lid, "core")
    except Exception:
        pass


FONT_DIRS = {"title": "Title", "text": "Context"}
FONT_CHOICES = {"title": ("pack", "sofia"), "text": ("pack",)}
SOFIA = "fonts/SofiaSansExtraCondensed-SemiBold.ttf"  # (in ui/: OFL, fonts/OFL-SofiaSans.txt)
REF_TEXT = (0.700, 1.079, 0.251)  # Segoe UI: cap height, ascent, descent (em)
NON_LATIN = {"ru", "uk", "be", "bg", "sr", "mk", "kk", "mn", "el", "zh", "ja", "ko", "th", "lo", "km", "my", "ar", "fa", "ur",
             "he", "hi", "bn", "ta", "te", "ka", "hy"}
STACKED = {"th", "lo", "km", "my", "hi", "bn", "ta", "te"}  # marks above and below: own line metrics, a little larger
_metric_cache: dict = {}


def _fonts_file(svc) -> str:
    return os.path.join(svc.data_dir, "lang", "_fonts.json")


def font_modes(svc) -> dict:
    """{pack id: {"title": "pack" / "sofia", "text": "pack"}}: the fonts a language's pages use"""
    try:
        with open(_fonts_file(svc), encoding="utf-8") as f:
            d = json.load(f)
    except (OSError, ValueError):
        return {}
    out = {}
    for k, v in (d.items() if isinstance(d, dict) else ()):
        if isinstance(v, dict):
            v = {kind: c for kind, c in v.items() if c in FONT_CHOICES.get(kind, ())}
            if v:
                out[k] = v
    return out


def set_font_mode(svc, lid: str, kind: str, choice: str):
    d = font_modes(svc)
    m = d.setdefault(lid, {})
    if choice in FONT_CHOICES.get(kind, ()):
        m[kind] = choice
    else:
        m.pop(kind, None)
    d = {k: v for k, v in d.items() if v}
    os.makedirs(os.path.dirname(_fonts_file(svc)), exist_ok=True)
    with open(_fonts_file(svc) + ".tmp", "w", encoding="utf-8") as f:
        json.dump(d, f)
    os.replace(_fonts_file(svc) + ".tmp", _fonts_file(svc))


def _font_path(src: dict, kind: str) -> str | None:
    """a pack's own font (Font/Title, Font/Context); Bebas skipped (Latin only)"""
    if not src.get("dir") or src.get("prefix") or kind not in FONT_DIRS:
        return None
    try:
        found = [e for e in os.scandir(os.path.join(src["dir"], "Font", FONT_DIRS[kind]))
                 if e.is_file() and e.name.lower().endswith((".ttf", ".otf")) and "bebas" not in e.name.lower()]
    except OSError:
        return None
    return max(found, key=lambda e: e.stat().st_size).path if found else None


def font_file(svc, lid: str, kind: str) -> str | None:
    return _font_path(next((s for s in sources(svc) if s["id"] == lid), {}), kind)


def _metrics(data: bytes) -> tuple | None:
    """(cap height, ascent, descent) in em, from the font's head / OS/2 tables"""
    import struct
    try:
        base = struct.unpack(">I", data[12:16])[0] if data[:4] == b"ttcf" else 0
        n = struct.unpack(">H", data[base + 4:base + 6])[0]
        tables = {data[base + 12 + 16 * i:base + 16 + 16 * i]: struct.unpack(">I", data[base + 20 + 16 * i:base + 24 + 16 * i])[0] for i in range(n)}
        upm = struct.unpack(">H", data[tables[b"head"] + 18:tables[b"head"] + 20])[0]
        o = tables[b"OS/2"]
        ver, sel = struct.unpack(">H", data[o:o + 2])[0], struct.unpack(">H", data[o + 62:o + 64])[0]
        ta, td = struct.unpack(">hh", data[o + 68:o + 72])
        wa, wd = struct.unpack(">HH", data[o + 74:o + 78])
        cap = struct.unpack(">h", data[o + 88:o + 90])[0] if ver >= 2 else 0
        asc, desc = (ta, -td) if sel & 128 else (wa, wd)  # (as the browser on Windows)
        return ((cap or 0.7 * upm) / upm, asc / upm, desc / upm)
    except (KeyError, struct.error, ZeroDivisionError):
        return None


def _metrics_of(path: str) -> tuple | None:
    try:
        st = os.stat(path)
    except OSError:
        return None
    key = (path, st.st_size, int(st.st_mtime))
    if key not in _metric_cache:
        with open(path, "rb") as f:
            _metric_cache[key] = _metrics(f.read())
    return _metric_cache[key]


def _ref_title(svc) -> tuple:
    """the game's Bebas: what the titles' letters are fitted to"""
    if "bebas" not in _metric_cache:
        from .uiicons import font_file as ui_font
        data = None
        try:
            data = ui_font("BebasKai", svc.game.data, svc.ui_cache_dir())
        except Exception:
            pass
        _metric_cache["bebas"] = (data and _metrics(data)) or (0.700, 0.950, 0.250)
    return _metric_cache["bebas"]


def _fit(m: tuple | None, ref: tuple, stacked: bool = False) -> str:
    """descriptors: the same cap height and line as the font it stands next to"""
    if not m:
        return ""
    k = ref[0] / m[0]
    if stacked:
        return f"size-adjust: {100 * min(k, 1.15):.1f}%;"
    return f"size-adjust: {100 * k:.1f}%; ascent-override: {100 * ref[1] / k:.1f}%; descent-override: {100 * ref[2] / k:.1f}%; line-gap-override: 0%;"


def _fonts(svc, src: dict, mode: dict | None) -> dict:
    """{"title" / "text": {"url", "css"}}: the fonts a language's pages use (none: the app's own)"""
    from .paths import resource_dir
    out = {}
    # a Latin-script language mixes its letters with ASCII inside a word: its font takes every letter ("all"), not only those past Latin-1
    script = str(src.get("lang") or "").split("-")[0]
    latin = script not in NON_LATIN
    for kind, choice in (mode or {}).items():
        if choice == "sofia":
            p, url = os.path.join(resource_dir(), "ui", SOFIA), "/ui/" + SOFIA
        else:
            p = _font_path(src, kind)
            if not p:
                continue
            st = os.stat(p)
            v = hashlib.sha1(f"{p}|{st.st_size}|{int(st.st_mtime)}".encode()).hexdigest()[:8]
            url = f"/api/langfont?id={src['id']}&k={kind}&v={v}"  # (params sorted: the site's name)
        out[kind] = {"url": url, "css": _fit(_metrics_of(p), _ref_title(svc) if kind == "title" else REF_TEXT, script in STACKED)}
        if latin:
            out[kind]["all"] = True
    return out


def font_names(svc) -> dict:
    """{pack id: {"title": file name, "text": file name}}"""
    return {s["id"]: {k: os.path.basename(p) for k in FONT_DIRS if (p := _font_path(s, k))} for s in sources(svc)}


def listing(svc) -> dict:
    """The language menu's list with coverage."""
    out, en_sig, modes = [], _en_sig(svc), font_modes(svc)
    for s in sources(svc):
        cover = None
        if s["dir"]:
            try:
                base, _ = _paths(svc, s, en_sig)
                with open(base + ".meta.json", encoding="utf-8") as f:
                    cover = json.load(f)["cover"]
            except (OSError, ValueError, KeyError):
                pass
        if cover is None and s.get("pub"):
            cover = s["pub"].get("cover")
        out.append({k: s[k] for k in ("id", "name", "lang", "label", "version", "authors", "link", "license", "discord")}
                   | {"cover": cover, "fonts": _fonts(svc, s, modes.get(s["id"])), "tables": {g: links.lang_table(s["id"], g) for g in GROUPS}})
    return {"langs": out}


def own(svc) -> bool:
    """Whether there are players' translations (own or published)."""
    return any(s["id"] not in {o[0] for o in OFFICIAL} for s in sources(svc))
