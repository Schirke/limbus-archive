"""CAB name → bundle, from UnityFS headers only (a CAB hash can't be derived from the file name)."""
from __future__ import annotations

import struct


def _cstr(b: bytes, pos: int) -> tuple[str, int]:
    end = b.index(b"\0", pos)
    return b[pos:end].decode("utf-8", "replace"), end + 1


def _blocks_info(path: str) -> bytes | None:
    """Blocks and directory info of a UnityFS bundle (no data decompression)."""
    with open(path, "rb") as f:
        head = f.read(4096)
        if not head.startswith(b"UnityFS\0"):
            return None
        pos = 8
        version = struct.unpack_from(">I", head, pos)[0]
        pos += 4
        _, pos = _cstr(head, pos)  # player version
        _, pos = _cstr(head, pos)  # engine revision
        _size, csize, usize, flags = struct.unpack_from(">qIII", head, pos)
        pos += 20
        if version >= 7:
            pos = (pos + 15) // 16 * 16
        if flags & 0x80:  # blocks info at the end of the file
            f.seek(-csize, 2)
            raw = f.read(csize)
        else:
            f.seek(pos)
            raw = f.read(csize)
    comp = flags & 0x3F
    if comp == 0:
        info = raw
    elif comp in (2, 3):
        import lz4.block
        info = lz4.block.decompress(raw, uncompressed_size=usize)
    elif comp == 1:
        import lzma
        props, dict_size = raw[0], struct.unpack_from("<I", raw, 1)[0]
        lc, lp, pb = props % 9, (props // 9) % 5, (props // 9) // 5
        dec = lzma.LZMADecompressor(lzma.FORMAT_RAW, filters=[{"id": lzma.FILTER_LZMA1, "dict_size": dict_size,
                                                                  "lc": lc, "lp": lp, "pb": pb}])
        info = dec.decompress(raw[5:], usize)
    else:
        return None
    return info


def unpacked_size(path: str) -> int:
    """Bytes the bundle takes once decompressed — what UnityPy holds in memory while reading it."""
    try:
        info = _blocks_info(path)
    except Exception:
        info = None
    if not info:
        return 0
    blocks = struct.unpack_from(">i", info, 16)[0]
    return sum(struct.unpack_from(">I", info, 20 + i * 10)[0] for i in range(blocks))


def cab_names(path: str) -> list[str]:
    info = _blocks_info(path)
    if not info:
        return []
    p = 16  # data hash
    blocks = struct.unpack_from(">i", info, p)[0]
    p += 4 + blocks * 10
    nodes = struct.unpack_from(">i", info, p)[0]
    p += 4
    out = []
    for _ in range(nodes):
        p += 20  # offset, size, flags
        name, p = _cstr(info, p)
        out.append(name)
    return out
