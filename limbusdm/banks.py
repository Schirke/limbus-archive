"""FMOD .bank files: list the sounds inside (own FSB5 header parser) and export one as WAV via FMOD."""
from __future__ import annotations

import ctypes
import struct
import threading

_lock = threading.Lock()
FREQS = {1: 8000, 2: 11000, 3: 11025, 4: 16000, 5: 22050, 6: 24000, 7: 32000, 8: 44100, 9: 48000, 10: 96000}


def fsb_from_bank(data: bytes) -> bytes | None:
    """Slice the (first) FSB5 sound container out of an FMOD Studio .bank file."""
    i = data.find(b"FSB5")
    if i < 0:
        return None
    _magic, ver, _n, shdr, names, size = struct.unpack_from("<4sIIIII", data, i)
    header = 60 if ver == 1 else 64
    return data[i:i + header + shdr + names + size]


def _fsbs(f) -> list[tuple[int, int, int]]:
    """Every FSB5 container in an open .bank file: (offset, length, length of its headers and names) — a bank can
    hold several (one per "SND " chunk: Voice_Default_S5_3.assets.bank has 9 sounds in its first and 508 in its
    second). Walks the file's RIFF chunks, reading only their headers."""
    f.seek(0, 2)
    end = f.tell()
    out = []

    def walk(pos, stop):
        while pos + 8 <= stop:
            f.seek(pos)
            cid, size = struct.unpack("<4sI", f.read(8))
            if cid in (b"RIFF", b"LIST"):
                walk(pos + 12, min(stop, pos + 8 + size))
            elif cid == b"SND ":
                f.seek(pos + 8)
                head = f.read(min(size, 128))
                i = head.find(b"FSB5")
                if i >= 0 and len(head) >= i + 24:
                    _m, ver, _n, shdr, names, data = struct.unpack_from("<4sIIIII", head, i)
                    h = (60 if ver == 1 else 64) + shdr + names
                    out.append((pos + 8 + i, h + data, h))
            pos += 8 + size + (size & 1)
    f.seek(0)
    if f.read(4) == b"RIFF":
        walk(0, end)
    if not out:  # (not a RIFF bank: the first FSB5 in it)
        f.seek(0)
        data = f.read()
        i = data.find(b"FSB5")
        if i >= 0:
            _m, ver, _n, shdr, names, size = struct.unpack_from("<4sIIIII", data, i)
            h = (60 if ver == 1 else 64) + shdr + names
            out.append((i, h + size, h))
    return out


def parse_fsb(fsb: bytes) -> list[dict]:
    """Names and durations of the sounds in an FSB5 container, without decoding audio."""
    _magic, ver, n, shdr_size, names_size, _data_size = struct.unpack_from("<4sIIIII", fsb, 0)
    pos = 60 if ver == 1 else 64
    end = pos + shdr_size
    samples = []
    for _ in range(n):
        (mode,) = struct.unpack_from("<Q", fsb, pos)
        pos += 8
        freq = FREQS.get((mode >> 1) & 0xF, 44100)
        count = (mode >> 34) & 0x3FFFFFFF
        more = mode & 1
        while more and pos < end:
            (chunk,) = struct.unpack_from("<I", fsb, pos)
            more, size, ctype = chunk & 1, (chunk >> 1) & 0xFFFFFF, (chunk >> 25) & 0x7F
            if ctype == 2 and size >= 4:  # frequency chunk
                (freq,) = struct.unpack_from("<I", fsb, pos + 4)
            pos += 4 + size
        samples.append({"freq": freq, "samples": count})
    names = [None] * n
    if names_size:
        base = (60 if ver == 1 else 64) + shdr_size
        for k in range(n):
            (off,) = struct.unpack_from("<I", fsb, base + 4 * k)
            s = base + off
            e = fsb.find(b"\0", s)
            names[k] = fsb[s:e].decode("utf-8", "replace")
    return [{"i": k, "name": names[k] or f"sound_{k}",
             "ms": int(1000 * s["samples"] / s["freq"]) if s["freq"] else 0} for k, s in enumerate(samples)]


def list_sounds(path: str) -> list[dict]:
    """The sounds of every FSB5 container in the bank, numbered on across them (see export_wav)."""
    out = []
    with open(path, "rb") as f:
        for off, _length, head in _fsbs(f):
            f.seek(off)
            for s in parse_fsb(f.read(head)):
                out.append(dict(s, i=len(out)))
    return out


_layouts: dict = {}  # bank path → (size, mtime, [(offset, length, sounds in it)]): the walk and the headers are read once
_blobs: list = []    # the last few containers read, newest last: [(path, offset, bytes, names)] (a fight's sounds share a few banks)
_BLOB_MAX, _BLOB_KEEP = 48 << 20, 4


def _layout(path: str):
    import os
    st = os.stat(path)
    hit = _layouts.get(path)
    if hit and hit[0] == st.st_size and hit[1] == st.st_mtime_ns:
        return hit[2]
    rows = []
    with open(path, "rb") as f:
        for off, length, head in _fsbs(f):
            f.seek(off)
            rows.append((off, length, len(parse_fsb(f.read(head)))))
    _layouts[path] = (st.st_size, st.st_mtime_ns, rows)
    return rows


def export_wav(path: str, index: int) -> tuple[bytes, str]:
    # fmod_toolkit points pyfmodex at its bundled fmod.dll, so import pyfmodex through it
    from fmod_toolkit.fmod import get_pyfmodex_system_instance, pyfmodex, subsound_to_wav
    # (the index runs on across the bank's FSB5 containers: find the one holding it)
    fsb = names = None
    with _lock:
        for off, length, n in _layout(path):
            if index < n:
                for b in _blobs:
                    if b[0] == path and b[1] == off:
                        fsb, names = b[2], b[3]
                        break
                else:
                    with open(path, "rb") as f:
                        f.seek(off)
                        fsb = f.read(length)
                    names = parse_fsb(fsb)
                    if length <= _BLOB_MAX:
                        _blobs.append((path, off, fsb, names))
                        del _blobs[:-_BLOB_KEEP]
                break
            index -= n
    if not fsb:
        raise ValueError("no FSB5 sound data in this bank")
    system, lock = get_pyfmodex_system_instance(32, pyfmodex.flags.INIT_FLAGS.NORMAL)
    incl = (ctypes.c_int * 1)(index)  # decode only the requested sound
    exinfo = pyfmodex.structure_declarations.CREATESOUNDEXINFO(length=len(fsb))
    exinfo.inclusionlist = ctypes.cast(incl, ctypes.POINTER(ctypes.c_int))
    exinfo.inclusionlistnum = 1
    with _lock, lock:
        snd = system.create_sound(fsb, pyfmodex.flags.MODE.OPENMEMORY, exinfo=exinfo)
        sub = snd.get_subsound(index)
        wav = subsound_to_wav(sub)
        sub.release()
        snd.release()
    return wav, names[index]["name"] + ".wav"
