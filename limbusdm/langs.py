"""The game's texts in other languages: the game's own Korean and Japanese, and the players' translations — packs
laid out as the game reads them from its Lang folder (the English files' names without "EN_"), put in the data
folder's lang folder (each with a pack.json: name, version, authors, link). Only those: a pack in the game's own Lang
folder isn't taken, what is shown is chosen.

A language is a table "English text → its text", made from the files side by side (the same file, the same id, the
same field). The pages put it over the English the app answers with (ui/app.js langApply), so nothing else of the
app is made twice. Two parts: "core" (names, skills, passives, statuses…) and "story" (story, voice lines), the
second asked for only by the pages that show lines.

Made tables can also be published (the `lang-data` branch of the app's repository: index.json + the tables): every
app then lists those languages too and takes a table from there instead of making it — a few MB, no half a minute
over the game's files. A computer's own pack or own Korean / Japanese stays first while its table is made."""
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

from . import REPO

VERSION = 3
PUB_BRANCH = "lang-data"
# (the branch's commit is asked from the repository as git does — no API, no hourly limit — and its files by that commit)
PUB_REFS = f"https://github.com/{REPO}.git/info/refs?service=git-upload-pack"
PUB_RAW = f"https://raw.githubusercontent.com/{REPO}/%s/%s"
PUB_KEEP = 600  # seconds the published list is used before it is asked again
SAFE = re.compile(r"^[\w.-]+$")
GROUPS = ("core", "story")
STORY = re.compile(r"(^|/)(storydata|personalityvoicedlg|egovoicedig|battleannouncerdlg|bgmlyrics)/|dlg|voice", re.I)
# letters a pack draws with its own font only (the private use area): such a text stays English on the pages
OWN_GLYPHS = re.compile("[-]")
OFFICIAL = (("kr", "KR_", "ko"), ("jp", "JP_", "ja"))
# a pack's language by the start of its name (the packs' list names them so: "ru-mtl", "hant-LTM", "ptbr-CLT"…)
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
    """_files with each file's size and time (read with the folder's listing: one look per folder, not per file)"""
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
    """The published languages {"sha", "langs": [{id, name, lang, version, authors, link, cover, sig, files}]}, {} when
    none. The first time it is asked at once; later the last list answers and a new one is read in the background."""
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
    """The languages there are: [{id, name, lang, label, dir, prefix, version, authors, link, pub}] — dir None = only
    published; pub = the published copy of it, if any"""
    out, seen = [], set()
    loc = _loc(svc)
    for code, prefix, lang in OFFICIAL:
        d = os.path.join(loc, code)
        if os.path.isdir(d):
            out.append({"id": code, "name": "Official", "lang": lang, "dir": d, "prefix": prefix, "version": "", "authors": [], "link": ""})
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
                        "link": meta.get("link") or ""})
    for e in published(svc).get("langs") or []:
        if not isinstance(e, dict) or not SAFE.match(str(e.get("id", ""))) or not SAFE.match(str(e.get("sig", ""))):
            continue
        mine = next((s for s in out if s["id"] == e["id"]), None)
        if mine:
            mine["pub"] = e
        else:
            out.append({"id": e["id"], "name": e.get("name") or e["id"], "lang": e.get("lang") or _lang_of(e["id"]), "dir": None,
                        "prefix": None, "version": str(e.get("version") or ""), "authors": e.get("authors") or [],
                        "link": e.get("link") or "", "pub": e})
    for s in out:
        s["label"] = NATIVE.get(s["lang"], s["lang"])
    return out


def _sig(files: dict[str, tuple]) -> str:
    h = hashlib.sha1()
    for k in sorted(files):
        h.update(f"{k}|{files[k][1]}|{files[k][2]}\n".encode())
    return h.hexdigest()[:16]


def _read(path: str) -> dict:
    """{id: record} of a texts file; a file with a slip in it (a comma too many) is read past it, a broken one is skipped"""
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


def _own_tags(en: str, x: str) -> str:
    """the game's text marks a translation adds for its own look (<cspace=-2px>, <nobr>, <size>…) are left out: the
    pages draw only the marks the English text has"""
    keep = {m.group(1).lower() for m in TAG.finditer(en)}
    return TAG.sub(lambda m: m.group(0) if m.group(1).lower() in keep else "", x)


def _paths(svc, src: dict, en_sig: str) -> tuple[str, dict]:
    sig = hashlib.sha1(f"{VERSION}|{en_sig}|{_sig(_listed(src['dir'], src['prefix']))}".encode()).hexdigest()[:12]
    base = os.path.join(_cache_dir(svc), f"{src['id']}.{sig}")
    return base, {g: f"{base}.{g}.json.gz" for g in GROUPS}


def source_key(svc, src: dict) -> str:
    """what a language's tables on this computer are made of (the name its files start with): the published copy says
    the same when it was made of the same files"""
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
    """The table of a language's part, as a gzip'd JSON file. This computer's own one when it is made; else the
    published one (for a pack: only when made of the same files); else made here and kept until the texts change.
    local: always this computer's own (what is published is made so)."""
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
    """At the start: the language asked for last is made ready (downloaded or made) before a page asks for it."""
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


def listing(svc) -> dict:
    """The languages for the pages' language menu, with how much of the game's text each one has (once made)."""
    out, en_sig = [], _en_sig(svc)
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
        out.append({k: s[k] for k in ("id", "name", "lang", "label", "version", "authors", "link")} | {"cover": cover})
    return {"langs": out}


def own(svc) -> bool:
    """Whether this computer has players' translations (its own packs or published ones), not only the game's own languages."""
    return any(s["id"] not in {o[0] for o in OFFICIAL} for s in sources(svc))
