"""Pictures that look the same (one enemy under several names, mobs A / B / C drawn alike, one story portrait for two
speakers): the Games ask about each look once — Guess the enemy, Guess the character."""
from __future__ import annotations

import os

_looks: dict = {}  # (file, mtime, size) -> the picture made small
_found: dict = {}  # the files' keys in order -> repeats() (the handbook asks at every open; drawn pictures add files)


def _key(path):
    try:
        st = os.stat(path) if path else None
    except OSError:
        return None
    return st and (path, st.st_mtime_ns, st.st_size)


def _look(k):
    if k not in _looks:
        from PIL import Image
        im = Image.open(k[0]).convert("RGBA")
        im = im.crop(im.getbbox() or (0, 0, *im.size))  # the figure only: the same one drawn smaller still matches
        bg = Image.new("RGBA", im.size, (0, 0, 0, 255))
        bg.alpha_composite(im)
        rgb = bg.convert("RGB")
        _looks[k] = (rgb.convert("L").resize((4, 4), Image.BOX).tobytes(), rgb.resize((64, 64), Image.BOX))
    return _looks[k]


def _same(a, b) -> bool:
    from PIL import ImageChops, ImageStat
    if sum(abs(x - y) for x, y in zip(a[0], b[0])) > 128:
        return False
    diff = sum(ImageStat.Stat(ImageChops.difference(a[1], b[1])).mean) / 3
    lit = (sum(ImageStat.Stat(a[1]).mean) + sum(ImageStat.Stat(b[1]).mean)) / 6
    # small next to how much is drawn: two dark, mostly empty pictures of different enemies differ by little in all
    # (Dead Rabbits 1 / 2 differ by 57 % of it, the alike mob pairs by 34 % at most)
    return diff < 6 and diff < 0.45 * max(lit, 1)


def repeats(paths: list) -> dict[int, int]:
    """{place in paths: the earlier place its picture looks like} (a missing / unreadable file never repeats one)."""
    keys = tuple(_key(p) for p in paths)
    if keys in _found:
        return _found[keys]
    kept, out = [], {}
    for i, k in enumerate(keys):
        try:
            lk = _look(k) if k else None
        except Exception:
            lk = None
        if lk is None:
            continue
        j = next((j for j, x in kept if _same(lk, x)), None)
        if j is None:
            kept.append((i, lk))
        else:
            out[i] = j
    if len(_found) > 8:
        _found.clear()
    _found[keys] = out
    return out
