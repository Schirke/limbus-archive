"""The app's own interface in other languages. Dictionaries ship with the pages: ui/lang/<lang>.json {"t": {key: text}}
(key = English template, or "route|English" for one page; see ui/i18n.js). The English list comes from the pages'
source (uistrings). A translator's checked file (CSV) is kept on this computer in data/ui_lang/<lang>.json and laid
over the shipped one. Who sees it is the owner's switch (beta.json "ui", Admin → Translations)."""
from __future__ import annotations

import csv
import io
import json
import os
import re
import threading

VERSION = 2
LANG_RE = re.compile(r"^[a-z]{2}(-[A-Za-z]{2,4})?$")
_lock = threading.Lock()


def ui_dir() -> str:
    from .paths import resource_dir
    return os.path.join(resource_dir(), "ui")


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


def shipped(lang: str) -> dict:
    """{key: text} of ui/lang/<lang>.json"""
    if not LANG_RE.match(lang or ""):
        return {}
    return _read(os.path.join(ui_dir(), "lang", f"{lang}.json"), {}).get("t", {})


def local_file(svc, lang: str) -> str:
    return os.path.join(svc.data_dir, "ui_lang", f"{lang}.json")


def local(svc, lang: str) -> dict:
    """a translator's rows on this computer {key: text} (v2 files only; the old machine tables are not used)"""
    doc = _read(local_file(svc, lang), {})
    return {k: v for k, v in (doc.get("t") or {}).items() if isinstance(v, str) and v} if doc.get("v") == VERSION else {}


def dictionary(svc, lang: str) -> dict:
    """{key: translation} for the pages"""
    if not LANG_RE.match(lang or ""):
        return {}
    return shipped(lang) | local(svc, lang)


def available(svc) -> list:
    """languages with a dictionary"""
    d = os.path.join(ui_dir(), "lang")
    names = [f[:-5] for f in os.listdir(d) if f.endswith(".json")] if os.path.isdir(d) else []
    return sorted(x for x in names if LANG_RE.match(x))


def english() -> dict:
    """the pages' strings, less the ones marked as not interface (ui/lang/_skip.json)"""
    from . import uistrings
    skip = set(_read(os.path.join(ui_dir(), "lang", "_skip.json"), []))
    return {k: v for k, v in uistrings.strings(ui_dir()).items() if k not in skip}


def _done(key: str, t: dict) -> bool:
    if t.get(key):
        return True
    return any(k.endswith("|" + key) for k in t)


def status(svc) -> dict:
    """per language: strings in the pages, translated, missing (with where they are)"""
    en = english()
    out = {"v": VERSION, "strings": len(en), "langs": {}}
    for lang in available(svc):
        t = dictionary(svc, lang)
        miss = [k for k in en if not _done(k, t)]
        out["langs"][lang] = {"done": len(en) - len(miss), "local": len(local(svc, lang)),
                              "missing": [{"t": k, "where": f"{en[k][0]['file']}:{en[k][0]['line']}"} for k in miss[:400]],
                              "n_missing": len(miss)}
    return out


# ---------------------------------------------------------------- files for translators
def export_csv(svc, lang: str) -> str:
    """data/exports/ui-<lang>.csv (UTF-8 with BOM): key, English, translation, where. Returns its path."""
    if not LANG_RE.match(lang or ""):
        raise ValueError("bad language code")
    en, t = english(), dictionary(svc, lang)
    rows = [[k, k.split("|", 1)[1] if re.match(r"^[a-z0-9-]+\|", k) else k, v, ""] for k, v in sorted(t.items(), key=lambda x: x[0].lower())]
    rows += [[k, k, "", f"{en[k][0]['file']}:{en[k][0]['line']}"] for k in sorted(en, key=str.lower) if not _done(k, t)]
    path = os.path.join(svc.data_dir, "exports", f"ui-{lang}.csv")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["key", "English", "Translation", "Where"])
        w.writerows(rows)
    return path


def _ok(src: str, out: str) -> bool:
    return sorted(set(re.findall(r"\{(\d+)", src))) == sorted(set(re.findall(r"\{(\d+)", out)))


def import_csv(svc, lang: str, text: str) -> dict:
    """A translator's file back: changed rows go into this computer's file (over the shipped ones). Returns counts."""
    if not LANG_RE.match(lang or ""):
        raise ValueError("bad language code")
    text = text.lstrip("﻿")
    try:
        dialect = csv.Sniffer().sniff(text[:4000], delimiters=",;\t")
    except csv.Error:
        dialect = csv.excel
    rows = list(csv.reader(io.StringIO(text), dialect))
    if not rows or [c.strip().lower() for c in rows[0][:3]] != ["key", "english", "translation"]:
        raise ValueError("not a Limbus Archive interface file (the first row must be key, English, Translation)")
    base, changed, bad = shipped(lang), 0, 0
    with _lock:
        mine = local(svc, lang)
        for r in rows[1:]:
            if len(r) < 3 or not r[0] or not r[2].strip():
                continue
            k, new = r[0], r[2].strip()
            if new == (mine.get(k) or base.get(k)):
                continue
            if not _ok(k, new):
                bad += 1
                continue
            mine[k] = new
            changed += 1
        _write(local_file(svc, lang), {"v": VERSION, "lang": lang, "t": mine})
    return {"changed": changed, "bad": bad}
