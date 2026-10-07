"""Reader for the Unity Addressables 2.x binary catalog (catalog.bin).

Port of the read side of BinaryStorageBuffer.Reader + ContentCatalogData.ResourceLocator
from com.unity.addressables 2.x. Read-only; never touches the game.
"""
from __future__ import annotations

import struct
from dataclasses import dataclass, field

MAGIC = 0x0DE38942
NONE = 0xFFFFFFFF
UNICODE_FLAG = 0x80000000
DYNAMIC_FLAG = 0x40000000
CLEAR_MASK = 0x3FFFFFFF


@dataclass
class Bundle:
    name: str
    hash: str
    crc: int
    size: int
    url: str


@dataclass
class Location:
    internal_id: str
    primary_key: str
    provider: str
    type: str
    bundles: list[str] = field(default_factory=list)  # names of bundles this asset depends on


class _Buf:
    def __init__(self, data: bytes):
        self.b = data
        self._str_cache: dict[tuple[int, str], str] = {}
        self._type_cache: dict[int, str] = {}

    def u32(self, off: int) -> int:
        return struct.unpack_from("<I", self.b, off)[0]

    def _raw_string(self, sid: int) -> str:
        if sid & UNICODE_FLAG:
            off = sid & CLEAR_MASK
            n = self.u32(off - 4)
            return self.b[off:off + n].decode("utf-16-le")
        n = self.u32(sid - 4)
        return self.b[sid:sid + n].decode("ascii", "replace")

    def string(self, sid: int, sep: str = "") -> str | None:
        if sid == NONE:
            return None
        key = (sid, sep)
        if key in self._str_cache:
            return self._str_cache[key]
        if sep and sid & DYNAMIC_FLAG:
            parts = []
            nxt = sid
            while nxt != NONE:
                off = nxt & CLEAR_MASK
                part_id, nxt = struct.unpack_from("<II", self.b, off)
                parts.append(self._raw_string(part_id))
            s = sep.join(reversed(parts))
        else:
            s = self._raw_string(sid)
        self._str_cache[key] = s
        return s

    def type_name(self, off: int) -> str | None:
        if off == NONE:
            return None
        if off not in self._type_cache:
            _asm_id, cls_id = struct.unpack_from("<II", self.b, off)
            self._type_cache[off] = self.string(cls_id, ".")
        return self._type_cache[off]

    def offsets_array(self, off: int) -> list[int]:
        if off == NONE:
            return []
        n = self.u32(off - 4) // 4
        return list(struct.unpack_from(f"<{n}I", self.b, off))

    def hash128(self, off: int) -> str:
        # Unity's Hash128.ToString(): each byte of the 16-byte value as two hex digits, in memory order
        return self.b[off:off + 16].hex()

    def typed_object(self, off: int):
        """ReadObject(uint id): ObjectTypeData {typeId, objectId} → value."""
        if off == NONE:
            return None, None
        type_id, obj_id = struct.unpack_from("<II", self.b, off)
        t = self.type_name(type_id)
        if obj_id == NONE:
            return t, None
        if t == "System.String":
            sid, sep = struct.unpack_from("<IH", self.b, obj_id)
            return t, self.string(sid, chr(sep) if sep else "")
        if t == "System.Int32":
            return t, struct.unpack_from("<i", self.b, obj_id)[0]
        if t == "System.Int64":
            return t, struct.unpack_from("<q", self.b, obj_id)[0]
        if t == "System.Boolean":
            return t, bool(self.b[obj_id])
        if t == "UnityEngine.Hash128":
            return t, self.hash128(obj_id)
        if t and t.endswith("AssetBundleRequestOptions"):
            hash_id, name_id, crc, size, _common = struct.unpack_from("<IIIII", self.b, obj_id)
            return t, {"hash": self.hash128(hash_id), "name": self.string(name_id, "_"), "crc": crc, "size": size}
        return t, obj_id


class Catalog:
    def __init__(self, data: bytes):
        buf = _Buf(data)
        magic, version, keys_off, _id_off, _ip, _sp, _init, brh = struct.unpack_from("<iiIIIIII", data, 0)
        if magic != MAGIC:
            raise ValueError("not an Addressables binary catalog")
        self.version = version
        self.build_hash = buf.string(brh) if brh != NONE else None

        n = buf.u32(keys_off - 4) // 8
        key_pairs = [struct.unpack_from("<II", data, keys_off + i * 8) for i in range(n)]

        loc_cache: dict[int, dict] = {}

        def read_loc(off: int) -> dict:
            if off in loc_cache:
                return loc_cache[off]
            pk, iid, prov, deps, _dh, extra, tid = struct.unpack_from("<IIIIiII", data, off)
            loc = {
                "primary_key": buf.string(pk, "/"),
                "internal_id": buf.string(iid, "/"),
                "provider": buf.string(prov, "."),
                "type": buf.type_name(tid),
                "deps": buf.offsets_array(deps),
                "extra": buf.typed_object(extra)[1] if extra != NONE else None,
            }
            loc_cache[off] = loc
            return loc

        self.keys: list = []
        for key_name_off, loc_set_off in key_pairs:
            _t, key = buf.typed_object(key_name_off)
            self.keys.append(key)
            for loc_off in buf.offsets_array(loc_set_off):
                read_loc(loc_off)

        self.bundles: dict[str, Bundle] = {}
        bundle_by_off: dict[int, str] = {}
        for off, loc in loc_cache.items():
            ex = loc["extra"]
            if isinstance(ex, dict) and "hash" in ex:
                b = Bundle(name=ex["name"] or loc["primary_key"], hash=ex["hash"], crc=ex["crc"],
                           size=ex["size"], url=loc["internal_id"])
                self.bundles[loc["primary_key"]] = b
                bundle_by_off[off] = loc["primary_key"]

        self.locations: list[Location] = []
        seen = set()
        for off, loc in loc_cache.items():
            if off in bundle_by_off:
                continue
            key = (loc["internal_id"], loc["type"])
            if key in seen:
                continue
            seen.add(key)
            self.locations.append(Location(
                internal_id=loc["internal_id"], primary_key=loc["primary_key"], provider=loc["provider"],
                type=loc["type"] or "", bundles=[bundle_by_off[d] for d in loc["deps"] if d in bundle_by_off]))

    @classmethod
    def load(cls, path: str) -> "Catalog":
        with open(path, "rb") as f:
            return cls(f.read())
