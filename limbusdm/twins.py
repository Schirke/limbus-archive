"""Pictures that look the same, so the Games ask about each look once."""
from __future__ import annotations

import os

_looks: dict = {}  # (file, mtime, size) -> the picture made small
_found: dict = {}  # file keys in order → repeats()
_thin: dict = {}  # ((file, mtime, size), least) -> sparse() said yes


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
    # small next to how much is drawn
    return diff < 6 and diff < 0.45 * max(lit, 1)


def repeats(paths: list) -> dict[int, int]:
    """{place: earlier place it looks like}"""
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


def sparse(paths, least=0.05):
    """Pictures with almost nothing drawn (no silhouette to ask about)."""
    from PIL import Image
    out = []
    for i, p in enumerate(paths):
        k = (_key(p), least)
        if k[0] is None:
            continue
        if k not in _thin:
            try:
                a = Image.open(p).convert("RGBA").getchannel("A")
            except OSError:
                continue
            _thin[k] = sum(a.histogram()[128:]) < least * a.width * a.height
        if _thin[k]:
            out.append(i)
    return out
