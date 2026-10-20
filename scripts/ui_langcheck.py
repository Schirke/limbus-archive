"""Interface strings of ui/*.js that a language in ui/lang has no translation for (file:line each).
New UI text: add it to ui/lang/ru.json and zh-Hans.json ("English": "translation", {0} for numbers / names,
"{0|форма|формы|форм}" for Russian word forms), or to ui/lang/_skip.json if it is not interface text.
Usage: .venv\\Scripts\\python.exe scripts\\ui_langcheck.py [lang…]"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from limbusdm import uistrings  # noqa: E402

LANG_DIR = os.path.join(ROOT, "ui", "lang")


def missing() -> dict:
    """{lang: [(English, "file:line"), …]}"""
    en = uistrings.scan(os.path.join(ROOT, "ui"))
    with open(os.path.join(LANG_DIR, "_skip.json"), encoding="utf-8") as f:
        skip = set(json.load(f))
    out = {}
    for fn in sorted(os.listdir(LANG_DIR)):
        if fn.startswith("_") or not fn.endswith(".json"):
            continue
        with open(os.path.join(LANG_DIR, fn), encoding="utf-8") as f:
            t = json.load(f)["t"]
        paged = {k.split("|", 1)[1] for k in t if "|" in k}
        out[fn[:-5]] = [(k, f"{v[0]['file']}:{v[0]['line']}") for k, v in en.items() if k not in skip and k not in t and k not in paged]
    return out


if __name__ == "__main__":
    want = sys.argv[1:]
    n = 0
    for lang, rows in missing().items():
        if want and lang not in want:
            continue
        print(f"{lang}: {len(rows)} missing")
        for k, where in rows:
            print(f"  {where:28} {k}")
        n += len(rows)
    sys.exit(1 if n else 0)
