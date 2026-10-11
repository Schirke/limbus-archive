"""Writes the Bilibili lists (bilibili_<period>_<sort>.json) to community-data for the website. Usage: python
scripts/bilibili.py <folder> [<translations file>]"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from limbusdm import bilibili  # noqa: E402
from limbusdm.translate import Translator  # noqa: E402

OUT = sys.argv[1] if len(sys.argv) > 1 else "."
KEPT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(OUT, "bilibili_tr.json")


def main():
    tr, said = Translator(KEPT), {}
    for period in bilibili.PERIODS:
        for sort in bilibili.SORTS:
            path = os.path.join(OUT, f"bilibili_{period}_{sort}.json")
            doc = bilibili.videos(period, sort, tr)
            said[f"{period}_{sort}"] = doc.get("error") or len(doc["videos"])
            if doc.get("error") and os.path.exists(path):  # (not answered this time: the list of the last time stays)
                continue
            with open(path, "w", encoding="utf-8") as f:
                json.dump(doc, f, ensure_ascii=False, indent=1)
            time.sleep(1)
    print("bilibili:", said)


if __name__ == "__main__":
    main()
