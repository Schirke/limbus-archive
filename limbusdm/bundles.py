"""Index the objects of one bundle (type, name, path, hash); texts kept as blobs, textures as thumbnails."""
from __future__ import annotations

import hashlib
import io
import os
import warnings
from contextlib import ExitStack

import UnityPy
from UnityPy.export.Texture2DConverter import parse_image_data
from UnityPy.files.SerializedFile import SerializedFile
from UnityPy.streams import EndianBinaryReader

from .store import Store

UnityPy.config.FALLBACK_UNITY_VERSION = "6000.3.12f1"  # Limbus strips the version to "5.x.x"
warnings.filterwarnings("ignore", module="UnityPy")

TEXT_TYPES = {"TextAsset"}
IMAGE_TYPES = {"Texture2D"}


def lean_loading() -> None:
    """Makes UnityPy read a bundle in about half the memory (blocks go straight into one buffer)."""
    import importlib
    import struct

    BF = importlib.import_module("UnityPy.files.BundleFile")  # the modules (the package exports the classes)
    F = importlib.import_module("UnityPy.files.File")
    from UnityPy.helpers import ImportHelper
    from UnityPy.streams import EndianBinaryReader
    from UnityPy.streams.EndianBinaryReader import EndianBinaryReader_Memoryview

    cls = BF.BundleFile
    if getattr(cls, "_lean", False):
        return
    plain_read_fs = cls.read_fs

    def read_fs(self, reader):
        start, st = reader.Position, {"buf": None, "pos": 0}
        decompress = self.decompress_data

        def into_buffer(data, usize, flags, index=0):
            out = decompress(data, usize, flags, index)
            if st["buf"] is None:  # the first call is the blocks-and-directory info: block sizes → the buffer
                n = struct.unpack_from(">i", out, 16)[0]
                st["buf"] = bytearray(sum(struct.unpack_from(">I", out, 20 + i * 10)[0] for i in range(n)))
                return out
            st["buf"][st["pos"]:st["pos"] + len(out)] = out
            st["pos"] += len(out)
            return b""

        self.decompress_data = into_buffer
        try:
            dirs, blocks = plain_read_fs(self, reader)
        except Exception:
            dirs = None
        finally:
            del self.decompress_data
        if dirs is None or st["buf"] is None or st["pos"] != len(st["buf"]) or blocks.Length:
            reader.Position = start  # not the layout expected: UnityPy's own way
            return plain_read_fs(self, reader)
        return dirs, EndianBinaryReader(memoryview(st["buf"]), offset=blocks.BaseOffset)

    def read_files(self, reader, files):
        if not isinstance(reader, EndianBinaryReader_Memoryview):
            return F.File.read_files(self, reader, files)
        for node in files:  # File.read_files, with a view instead of a copy of each file
            name = node.path
            node_reader = EndianBinaryReader(reader.view[node.offset:node.offset + node.size],
                                             offset=reader.BaseOffset + node.offset)
            f = ImportHelper.parse_file(node_reader, self, name, is_dependency=self.is_dependency)
            if isinstance(f, (EndianBinaryReader, F.SerializedFile.SerializedFile)) and self.environment:
                self.environment.register_cab(name, f)
            f.flags = getattr(node, "flags", 0)
            self.files[name] = f

    cls.read_fs, cls.read_files, cls._lean = read_fs, read_files, True


def _h(data) -> str:
    return hashlib.sha1(data).hexdigest()


def index_bundle(path: str, store: Store, thumbs: bool = True) -> dict:
    """Return {"objects": [...], "errors": [...]} for the bundle at `path` (or a player file like resources.assets).
    Read-only on `path`."""
    with ExitStack() as opened:
        # read from the file as needed: the compressed bundle isn't kept in memory too
        env = UnityPy.load(opened.enter_context(open(path, "rb")))
        add_resources(env, path)
        return _index_env(env, path, store, thumbs)


class ReadOnDemand(io.RawIOBase):
    """A file opened for each read and closed at once (never held open: the game can replace it)."""

    def __init__(self, path: str):
        super().__init__()
        self.path, self.pos = path, 0

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, pos, whence=0):
        self.pos = pos if whence == 0 else self.pos + pos if whence == 1 else os.path.getsize(self.path) + pos
        return self.pos

    def read(self, n=-1):
        with open(self.path, "rb") as f:
            f.seek(self.pos)
            data = f.read(n)
        self.pos += len(data)
        return data


def add_resources(env, path: str) -> None:
    """A player file (resources.assets, sharedassets*, level*): its .resS / .resource data files next to it."""
    if not any(isinstance(f, SerializedFile) for f in env.files.values()):
        return
    for side in dict.fromkeys((path + ".resS", os.path.splitext(path)[0] + ".resource")):
        if os.path.isfile(side):
            env.register_cab(os.path.basename(side), EndianBinaryReader(ReadOnDemand(side)))


def _index_env(env, path: str, store: Store, thumbs: bool) -> dict:
    containers: dict[int, str] = {}
    # path → object from m_Container only (env.container walks the whole cache: very slow)
    for obj in env.objects:
        if obj.type.name == "AssetBundle":
            try:
                for cpath, info in obj.read().m_Container:
                    containers.setdefault(info.asset.path_id, cpath)
            except Exception:
                pass

    objects, errors = [], []
    textures: dict[int, str] = {}
    sprites, geo = [], {}
    # a player file numbers its objects 1, 2, 3…: a sprite's raw data names its texture by that number, which a
    # rebuild shifts; such sprites are hashed by their picture instead
    player = any(isinstance(f, SerializedFile) for f in env.files.values())
    for obj in env.objects:
        t = obj.type.name
        rec = {"pid": obj.path_id, "type": t}
        try:
            name = obj.peek_name()
        except Exception:
            name = None
        if not name and t == "Shader":  # a shader's name lives in its parsed form, not in m_Name
            try:
                name = obj.read().m_ParsedForm.m_Name
            except Exception:
                name = None
        if name:
            rec["name"] = name
        if obj.path_id in containers:
            rec["c"] = containers[obj.path_id]
        try:
            if t in TEXT_TYPES:
                data = obj.read()
                raw = data.m_Script
                raw = raw.encode("utf-8", "surrogateescape") if isinstance(raw, str) else bytes(raw)
                rec["h"] = store.put_blob(raw)
                rec["size"] = len(raw)
            elif t in IMAGE_TYPES:
                tex = obj.read()
                try:
                    img_bytes = tex.get_image_data() or b""
                except OSError:  # runtime textures (e.g. dynamic "Font Texture") have no pixel data
                    img_bytes = b""
                rec["h"] = _h(img_bytes + f"{tex.m_Width}x{tex.m_Height}:{tex.m_TextureFormat}".encode())
                rec["w"], rec["hgt"] = tex.m_Width, tex.m_Height
                textures[obj.path_id] = rec["h"]
                if thumbs and img_bytes and not store.has_thumb(rec["h"]):
                    try:  # decoded from the bytes already read, upside down: put_thumb flips the small copy
                        img = parse_image_data(img_bytes, tex.m_Width, tex.m_Height, tex.m_TextureFormat,
                                               obj.version, obj.platform, getattr(tex, "m_PlatformBlob", None), flip=False)
                        store.put_thumb(rec["h"], img, flip=True)
                    except Exception as e:  # unsupported texture format etc.
                        errors.append(f"thumb {name}: {type(e).__name__}: {e}")
            elif t == "Sprite":
                sp = obj.read()
                rec["h"] = _h(obj.get_raw_data())
                r = sp.m_Rect
                rec["rect"] = [round(r.x), round(r.y), round(r.width), round(r.height)]
                tr = sp.m_RD.textureRect
                geo[obj.path_id] = f"{rec['rect']}|{tr.x},{tr.y},{tr.width},{tr.height}|{sp.m_Pivot.x},{sp.m_Pivot.y}"
                try:
                    if sp.m_RD.texture.file_id == 0:  # in player files path ids are small: one from another file clashes
                        rec["tex_pid"] = sp.m_RD.texture.path_id
                except Exception:
                    pass
                sprites.append(rec)
            else:
                raw = obj.get_raw_data()
                rec["h"] = _h(raw)
                rec["size"] = len(raw)
        except Exception as e:
            errors.append(f"{t} {name or obj.path_id}: {type(e).__name__}: {e}")
            try:
                rec["h"] = _h(obj.get_raw_data())
            except Exception:
                rec["h"] = "unreadable"
        objects.append(rec)

    for rec in sprites:  # link sprites to their texture's content hash (for before/after crops)
        th = textures.get(rec.get("tex_pid"))
        if th:
            rec["tex"] = th
            if player and rec["pid"] in geo:
                rec["h"] = _h(f"{th}|{geo[rec['pid']]}".encode())
    try:  # CAB names let other bundles' references be resolved to this one
        from .cabs import cab_names
        cabs = cab_names(path)
    except Exception:
        cabs = []
    return {"objects": objects, "errors": errors, "cabs": cabs}
