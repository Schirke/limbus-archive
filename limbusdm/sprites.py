"""Sprite workshop: a frames zip (Animations -> Edit -> Frames, or any zip of PNGs) laid out as one sheet to edit by
hand. The zip is unpacked once into data/sprite_work/<zip's name>; the PNGs there are the ones to draw over in any
editor — the page shows them as they are on the disk, marks the ones that differ from the zip, and loads those into a
mod. The zip itself is never written to: it stays the "original" to compare with and to go back to."""
import base64, glob, io, json, os, re, zipfile, zlib



def _exports(svc) -> str:
    return os.path.join(svc.data_dir, "exports")


def _zip_path(svc, name: str) -> str:
    p = os.path.normpath(os.path.join(_exports(svc), os.path.basename(name)))
    if not p.lower().endswith(".zip") or not os.path.isfile(p):
        raise FileNotFoundError(name)
    return p


def _pngs(z: zipfile.ZipFile) -> dict:
    """File name -> the zip's entry (a zip made elsewhere may keep its PNGs in folders; a name met twice counts once)."""
    out = {}
    for i in z.infolist():
        base = os.path.basename(i.filename)
        if base.lower().endswith(".png") and not base.startswith("._"):
            out.setdefault(base, i)
    return out


def zips(svc) -> list[dict]:
    """Frames zips in data/exports, newest first."""
    out = []
    for p in glob.glob(os.path.join(_exports(svc), "*frames*.zip")):
        try:
            with zipfile.ZipFile(p) as z:
                n = len(_pngs(z))
        except zipfile.BadZipFile:
            continue
        if n:
            out.append({"name": os.path.basename(p), "count": n, "time": os.path.getmtime(p)})
    return sorted(out, key=lambda x: -x["time"])


def add(svc, name: str, data: str) -> str:
    """A zip of PNGs from anywhere, put next to the exported ones."""
    raw = base64.b64decode(data.split(",", 1)[-1])
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        if not _pngs(z):
            raise ValueError("no PNG files in that zip")
    stem = re.sub(r'[<>:"/\\|?*]', "_", re.sub(r"\.zip$", "", os.path.basename(name), flags=re.I)).strip() or "sprites"
    if "frames" not in stem.lower():
        stem += " frames"
    os.makedirs(_exports(svc), exist_ok=True)
    with open(os.path.join(_exports(svc), stem + ".zip"), "wb") as f:
        f.write(raw)
    return stem + ".zip"


def folder(svc, name: str) -> str:
    return os.path.join(svc.data_dir, "sprite_work", re.sub(r"\.zip$", "", os.path.basename(name), flags=re.I))


def _file(svc, name: str, frame: str) -> str:
    return os.path.join(folder(svc, name), os.path.basename(frame))


def _look(path: str, seen: dict) -> list:
    """[mtime_ns, size, crc, w, h, box of what is drawn] of a frame's file; `seen` (kept next to the folder) has it
    from the last time, so a file is read again only when it was saved again."""
    from PIL import Image
    st = os.stat(path)
    base = os.path.basename(path)
    k = seen.get(base)
    if not k or k[:2] != [st.st_mtime_ns, st.st_size]:
        with open(path, "rb") as f:
            raw = f.read()
        try:
            im = Image.open(io.BytesIO(raw)).convert("RGBA")
            (w, h), box = im.size, im.split()[3].getbbox()
        except Exception:  # half written by the editor: looked at again at the next ask
            w = h = 0
            box = None
        k = seen[base] = [st.st_mtime_ns, st.st_size, zlib.crc32(raw), w, h, list(box) if box else None]
        seen[""] = True  # (to be written)
    return k


def sheet(svc, name: str) -> dict:
    """The zip's frames as they are in its work folder now (unpacked at the first ask; a file deleted there comes back)."""
    src = _zip_path(svc, name)
    d = folder(svc, name)
    os.makedirs(d, exist_ok=True)
    frames = []
    try:
        with open(d + ".json", encoding="utf-8") as f:
            seen = json.load(f)
    except (OSError, ValueError):
        seen = {}
    with zipfile.ZipFile(src) as z:
        pngs = _pngs(z)
        try:
            meta = json.loads(z.read("_frames.json"))
        except (KeyError, ValueError):
            meta = {}
        for base, info in pngs.items():
            path = os.path.join(d, base)
            if not os.path.isfile(path):
                with open(path, "wb") as f:
                    f.write(z.read(info))
            t, size, crc, w, h, box = _look(path, seen)
            m = meta.get(base) or {}
            frames.append({"name": base, "w": w, "h": h, "t": str(t), "box": box, "canvas": m.get("canvas"),
                           "pivot": m.get("pivot"), "changed": (size, crc) != (info.file_size, info.CRC)})
    if seen.pop("", None):
        with open(d + ".json", "w", encoding="utf-8") as f:
            json.dump(seen, f)
    m = re.match(r"(\d+|[\w .()-]+Appearance) - ", os.path.basename(src))
    return {"name": os.path.basename(src), "id": m.group(1) if m else "", "folder": d, "time": os.path.getmtime(src),
            "frames": frames}


def png(svc, name: str, frame: str, orig: bool = False, size: int = 0) -> bytes:
    """One frame: the work folder's (orig: the zip's), whole; `size`: cropped to what is drawn and made that small."""
    frame = os.path.basename(frame)
    if orig:
        with zipfile.ZipFile(_zip_path(svc, name)) as z:
            raw = z.read(_pngs(z)[frame])
    else:
        with open(_file(svc, name, frame), "rb") as f:
            raw = f.read()
    if not size:
        return raw
    from PIL import Image
    im = Image.open(io.BytesIO(raw)).convert("RGBA")
    bb = im.split()[3].getbbox()
    if bb:
        im = im.crop(bb)
    im.thumbnail((size, size))
    b = io.BytesIO()
    im.save(b, "PNG")
    return b.getvalue()


def put(svc, name: str, frame: str, data: str) -> None:
    """A picture dropped on a frame: it becomes that frame's file (saved as PNG whatever it was)."""
    from PIL import Image
    frame = os.path.basename(frame)
    with zipfile.ZipFile(_zip_path(svc, name)) as z:
        if frame not in _pngs(z):
            raise KeyError("no such frame")
    im = Image.open(io.BytesIO(base64.b64decode(data.split(",", 1)[-1]))).convert("RGBA")
    os.makedirs(folder(svc, name), exist_ok=True)
    im.save(_file(svc, name, frame), "PNG")


def reset(svc, name: str, frame: str = "") -> int:
    """A frame (none named: every changed one) back to the zip's."""
    n = 0
    with zipfile.ZipFile(_zip_path(svc, name)) as z:
        pngs = _pngs(z)
        for base in ([os.path.basename(frame)] if frame else pngs):
            raw = z.read(pngs[base])
            path = _file(svc, name, base)
            if os.path.isfile(path):
                with open(path, "rb") as f:
                    if f.read() == raw:
                        continue
            with open(path, "wb") as f:
                f.write(raw)
            n += 1
    return n


def open_file(svc, name: str, frame: str) -> None:
    """The frame's file in the program Windows opens PNGs with."""
    path = _file(svc, name, frame)
    if not os.path.isfile(path):
        raise FileNotFoundError(frame)
    os.startfile(path)


def _changed_zip(svc, name: str, everything: bool = False) -> tuple[bytes, int]:
    buf, n = io.BytesIO(), 0
    with zipfile.ZipFile(_zip_path(svc, name)) as zs, zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sheet(svc, name)["frames"]:
            if f["changed"] or everything:
                z.write(_file(svc, name, f["name"]), f["name"])
                n += f["changed"]
        if everything:  # the notes go along, so the zip loads back like an exported one
            for i in zs.infolist():
                if not i.filename.lower().endswith(".png") and not i.is_dir():
                    z.writestr(i.filename, zs.read(i))
    return buf.getvalue(), n


def pack(svc, name: str) -> dict:
    """The work folder as a zip of its own next to the source one: every frame, the edited ones as edited."""
    data, n = _changed_zip(svc, name, True)
    stem = re.sub(r"\.zip$", "", os.path.basename(name), flags=re.I)
    dst = os.path.join(_exports(svc), f"{stem} [edited].zip")
    with open(dst, "wb") as f:
        f.write(data)
    return {"path": dst, "changed": n}


def load(svc, name: str, cid, mod: str) -> int:
    """The changed frames into a mod of that character (frames the character doesn't have are passed by)."""
    from . import mods
    data, n = _changed_zip(svc, name)
    if not n:
        raise ValueError("no frame differs from the zip yet")
    return mods.put_frames_zip(svc, cid, mod, data)
