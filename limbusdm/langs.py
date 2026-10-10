"""The game's texts in other languages: the game's own Korean and Japanese, and the players' translations — packs
laid out as the game reads them from its Lang folder (the English files' names without "EN_"), put in the data
folder's lang folder (each with a pack.json: name, version, authors, link). Only those: a pack in the game's own Lang
folder isn't taken, what is shown is chosen.

A language is a table "English text → its text", made from the files side by side (the same file, the same id, the
same field). The pages put it over the English the app answers with (ui/app.js langApply), so nothing else of the
app is made twice. Two parts: "core" (names, skills, passives, statuses…) and "story" (story, voice lines), the
second asked for only by the pages that show lines."""
from __future__ import annotations

import collections
import gzip
import hashlib
import json
import os
import re
import threading

VERSION = 2
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


def sources(svc) -> list[dict]:
    """The languages there are: [{id, name, lang, label, dir, prefix, version, authors, link}]"""
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
    tables = {g: {s: c.most_common(1)[0][0] for s, c in seen[g].items()} for g in GROUPS}
    cover = {g: round(100 * done[g] / total[g]) if total[g] else 0 for g in GROUPS}
    return {"tables": tables, "cover": cover}


def _paths(svc, src: dict, en_sig: str) -> tuple[str, dict]:
    sig = hashlib.sha1(f"{VERSION}|{en_sig}|{_sig(_listed(src['dir'], src['prefix']))}".encode()).hexdigest()[:12]
    base = os.path.join(_cache_dir(svc), f"{src['id']}.{sig}")
    return base, {g: f"{base}.{g}.json.gz" for g in GROUPS}


def table_file(svc, lid: str, group: str) -> str | None:
    """The table of a language's part, as a gzip'd JSON file (made the first time and kept until the texts change)."""
    src = next((s for s in sources(svc) if s["id"] == lid), None)
    if not src or group not in GROUPS:
        return None
    with _lock:
        base, files = _paths(svc, src, _en_sig(svc))
        if not all(os.path.exists(p) for p in files.values()):
            made = _build(svc, src)
            os.makedirs(_cache_dir(svc), exist_ok=True)
            for old in os.listdir(_cache_dir(svc)):  # the same language's tables of older texts
                if old.startswith(src["id"] + ".") and not os.path.join(_cache_dir(svc), old).startswith(base + "."):
                    try:
                        os.remove(os.path.join(_cache_dir(svc), old))
                    except OSError:
                        pass
            for g, p in files.items():
                with open(p + ".tmp", "wb") as f:
                    f.write(gzip.compress(json.dumps(made["tables"][g], ensure_ascii=False).encode("utf-8"), 6, mtime=0))
                os.replace(p + ".tmp", p)
            with open(base + ".meta.json", "w", encoding="utf-8") as f:
                json.dump({"cover": made["cover"]}, f)
        return files[group]


def listing(svc) -> dict:
    """The languages for the pages' language menu, with how much of the game's text each one has (once made)."""
    out, en_sig = [], _en_sig(svc)
    for s in sources(svc):
        cover = None
        try:
            base, _ = _paths(svc, s, en_sig)
            with open(base + ".meta.json", encoding="utf-8") as f:
                cover = json.load(f)["cover"]
        except (OSError, ValueError, KeyError):
            pass
        out.append({k: s[k] for k in ("id", "name", "lang", "label", "version", "authors", "link")} | {"cover": cover})
    return {"langs": out}


def own(svc) -> bool:
    """Whether this computer has players' translations (not only the game's own languages)."""
    return any(s["prefix"] == "" for s in sources(svc))
