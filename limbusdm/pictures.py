"""Story pictures as kept WebP (data/story_cache): the Story reader's and the Story map's (/api/story_pic)."""
from __future__ import annotations

import os

UNIT_CG = "Assets/Resources_moved/Sprite/Unit/CG/"
# the folders /api/story_pic answers from
ROOTS = ("Assets/Resources_moved/Story/", "Assets/Resources_moved/Sprite/StoryTheater/", "Assets/Resources_moved/Sprite/StageMap/", UNIT_CG)


def _disk(svc, kind: str, key: str, ext: str, make):
    """An answer kept in data/story_cache/<kind>/."""
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
    """PNG → WebP no larger than `limit` px."""
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
    if path.endswith("/"):
        return _layered(svc, path, limit)
    from . import extra
    own = extra.file_of(path)
    if own:  # (a picture the game no longer has)
        with open(own, "rb") as f:
            return _webp(f.read(), limit)
    rows = svc.lookup_container(path)
    r = next((x for x in rows if x["type"] == "Texture2D"), None) or next((x for x in rows if x["type"] == "Sprite"), None)
    file = svc.object_file(r["bundle"]) if r else None
    if not file:
        return None
    return _disk(svc, "pics", f"{path}|{r['bundle']}|{r['pid']}|{limit}", ".webp",
                 lambda: _webp(extract.extract(file, int(r["pid"]))[0], limit))


def _layered(svc, folder: str, limit: int) -> bytes | None:
    """A background folder's pictures one over the other: far_* first."""
    import io
    import sqlite3

    from PIL import Image

    from . import extract
    con = sqlite3.connect(svc.ensure_browse())
    rows = con.execute("select c, bundle, pid from o where c like ? and type = 'Texture2D' order by c", (folder + "%",)).fetchall()
    con.close()
    rows = [r for r in rows if r[0].count("/") == folder.count("/")]
    if not rows:
        return None
    rows.sort(key=lambda r: not os.path.basename(r[0]).lower().startswith("far_"))

    def make():
        out = None
        for c, bundle, pid in rows:
            file = svc.object_file(bundle)
            if not file:
                continue
            im = Image.open(io.BytesIO(extract.extract(file, int(pid))[0])).convert("RGBA")
            if out is None:
                out = Image.new("RGBA", im.size)
            out.alpha_composite(im if im.size == out.size else im.resize(out.size))
        if out is None:
            return None
        buf = io.BytesIO()
        out.convert("RGB").save(buf, "PNG")
        return _webp(buf.getvalue(), limit)
    return _disk(svc, "pics", f"{folder}|{'|'.join(str(r[2]) for r in rows)}|{limit}", ".webp", make)
