"""Take a snapshot of the current game version: catalog, every object in every bundle, every file.

Everything is read-only on the game side. Bundle indexes are reused by bundle hash, file hashes by
size+mtime, so after the first (slow) snapshot only what changed is scanned again.
"""
from __future__ import annotations

import fnmatch
import hashlib
import os
import re
import time
from concurrent.futures import FIRST_COMPLETED, ProcessPoolExecutor, wait
from datetime import datetime

from .banks import list_sounds
from .bundles import index_bundle
from .catalog import Catalog
from .paths import GamePaths
from .store import Store

TEXT_EXT = {".json", ".txt", ".xml", ".csv", ".toml", ".ini", ".yaml", ".yml", ".lua", ".md"}
TEXT_MAX = 32 * 1024 * 1024
# files that change on every launch and only add noise
DEFAULT_IGNORE = ["*.log", "*/Unity/*Analytics*", "*/Unity/ShaderVariantAnalytics/*", "*/Settings/*", "*/Temp/*"]
BUNDLE_HASH_RE = re.compile(r"_[0-9a-f]{32}\.bundle$")


def bundle_logical_name(url: str) -> str:
    """Stable bundle name: CDN file name without the content hash."""
    base = re.split(r"[\\/]", url)[-1]
    return BUNDLE_HASH_RE.sub("", base)


def _sha1_file(path: str) -> str:
    h = hashlib.sha1()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


PRINTABLE_RE = re.compile(rb"[\x20-\x7e]")
STRING_RE = re.compile(rb"[\x20-\x7e]{4,300}")
LEN_PREFIX_RE = re.compile(rb"^[\x20-\x7e](?=\\Assets\\|\|)")


def code_names(path: str) -> bytes:
    """Readable strings from IL2CPP global-metadata.dat: ability class names (PassiveAbility_…, CoinAbility_…),
    script paths (incl. ScriptsForNextUpdate), string literals. Limbus encrypts the identifier table, but this
    part is plain text; it is found by the density of printable bytes. Sorted, one per line."""
    with open(path, "rb") as f:
        data = f.read()
    win = 1 << 16
    out = set()
    for i in range(0, len(data), win):
        chunk = data[i:i + win]
        if len(PRINTABLE_RE.findall(chunk)) > len(chunk) // 2:
            out.update(LEN_PREFIX_RE.sub(b"", s) for s in STRING_RE.findall(chunk))
    return b"\n".join(sorted(out))


def _index_job(args):
    path, store_root, thumbs = args
    t = time.time()
    try:
        res = index_bundle(path, Store(store_root), thumbs)
    except Exception as e:
        res = {"objects": [], "errors": [f"bundle unreadable: {type(e).__name__}: {e}"]}
    res["secs"] = round(time.time() - t, 2)
    return res


def free_memory() -> int:
    """Available physical memory in bytes (Windows; a safe guess elsewhere)."""
    try:
        import ctypes

        class MEMORYSTATUSEX(ctypes.Structure):
            _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
                        ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                        ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                        ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
                        ("ullAvailExtendedVirtual", ctypes.c_ulonglong)]
        st = MEMORYSTATUSEX()
        st.dwLength = ctypes.sizeof(st)
        ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(st))
        return int(st.ullAvailPhys)
    except Exception:
        return 4 << 30


def job_memory(path: str) -> int:
    """What indexing a bundle costs: UnityPy keeps ~2.2× the decompressed size, plus decoded textures."""
    from .cabs import unpacked_size
    return int(unpacked_size(path) * 2.5) + (300 << 20)


class Snapshotter:
    def __init__(self, store: Store, game: GamePaths, ignore: list[str] | None = None,
                 workers: int | None = None, thumbs: bool = True, progress=None):
        self.store = store
        self.game = game
        self.ignore = ignore if ignore is not None else DEFAULT_IGNORE
        self.workers = workers or max(1, min(12, (os.cpu_count() or 4) - 1))
        self.thumbs = thumbs
        self.progress = progress or (lambda stage, done, total, msg="": None)
        self.cancelled = False

    # ---------- files ----------
    def _ignored(self, rel: str) -> bool:
        rel = "/" + rel.replace("\\", "/")
        return any(fnmatch.fnmatch(rel, "*" + pat.replace("\\", "/").lstrip("*")) or fnmatch.fnmatch(rel, pat)
                   for pat in self.ignore)

    def _scan_files(self, roots: dict[str, str], prev_files: dict) -> dict:
        todo = []
        for label, root in roots.items():
            if not root or not os.path.isdir(root):
                continue
            for dirpath, _dirnames, filenames in os.walk(root):
                for fn in filenames:
                    full = os.path.join(dirpath, fn)
                    rel = label + "/" + os.path.relpath(full, root).replace("\\", "/")
                    if not self._ignored(rel):
                        todo.append((rel, full))
        files = {}
        for i, (rel, full) in enumerate(todo):
            if self.cancelled:
                raise InterruptedError
            if i % 200 == 0:
                self.progress("files", i, len(todo), rel)
            try:
                st = os.stat(full)
            except OSError:
                continue
            prev = prev_files.get(rel)
            ext = os.path.splitext(rel)[1].lower()
            want_blob = ext in TEXT_EXT and st.st_size <= TEXT_MAX
            want_sounds = ext == ".bank"
            want_names = rel.endswith("global-metadata.dat")
            if (prev and prev["size"] == st.st_size and prev["mtime"] == int(st.st_mtime)
                    and (prev.get("blob") or not want_blob) and ("sounds" in prev or not want_sounds)
                    and ("names" in prev or not want_names)):
                files[rel] = prev
                continue
            rec = {"size": st.st_size, "mtime": int(st.st_mtime)}
            try:
                if want_blob:
                    with open(full, "rb") as f:
                        data = f.read()
                    rec["h"] = rec["blob"] = self.store.put_blob(data)
                else:
                    rec["h"] = _sha1_file(full)
                if want_names:
                    rec["names"] = self.store.put_blob(code_names(full))
                if want_sounds:
                    try:
                        rec["sounds"] = [[s["name"], s["ms"]] for s in list_sounds(full)]
                    except Exception as e:
                        rec["sounds"] = []
                        rec["error"] = f"sounds: {e}"
            except OSError as e:
                rec["h"] = "unreadable"
                rec["error"] = str(e)
            files[rel] = rec
        self.progress("files", len(todo), len(todo))
        return files

    # ---------- main ----------
    def take(self, prev_snapshot: dict | None = None) -> dict:
        g = self.game
        if not g.ok:
            raise RuntimeError("Limbus Company install not found")
        cat_path = g.catalog_path()
        if not cat_path:
            raise RuntimeError("Addressables catalog not found — launch the game once")
        self.progress("catalog", 0, 1, cat_path)
        with open(cat_path, "rb") as f:
            cat_bytes = f.read()
        cat = Catalog(cat_bytes)

        version = None
        for b in cat.bundles.values():
            m = re.search(r"(s\d{8}_[A-Za-z0-9_-]+)", b.url)
            if m:
                version = m.group(1)
                break

        bundles = {}
        for key, b in cat.bundles.items():
            logical = bundle_logical_name(b.url)
            bundles[logical] = {"name": b.name, "hash": b.hash, "size": b.size, "url": b.url, "key": key}

        assets = {}
        for loc in cat.locations:
            t = loc.type.rsplit(".", 1)[-1]
            entry = assets.setdefault(loc.internal_id, {"types": [], "bundle": None})
            if t not in entry["types"]:
                entry["types"].append(t)
            if loc.bundles and not entry["bundle"]:
                entry["bundle"] = bundle_logical_name(cat.bundles[loc.bundles[0]].url)

        # ---------- bundles ----------
        jobs, missing = [], []
        for logical, b in bundles.items():
            rel = f"bundle_index/{logical}_{b['hash']}.json.gz"
            b["index"] = rel
            if self.store.exists(rel):
                continue
            path = g.bundle_file(b["name"], b["hash"], b["url"])
            if not path:
                missing.append(logical)
                b["missing"] = True
                continue
            jobs.append((logical, path, rel, os.path.getsize(path), job_memory(path)))
        jobs.sort(key=lambda j: -j[4])  # biggest first for better load balancing
        total_bytes = sum(j[3] for j in jobs) or 1
        done_bytes = 0
        errors = {}
        self.progress("bundles", 0, len(jobs), f"{len(jobs)} bundles to index")
        if jobs:
            # Memory budget: a bundle is decompressed whole while it is read (one Canto bundle takes ~6 GB), so a
            # new one starts only while the running ones fit in half of the free memory; the biggest runs alone.
            # Python keeps much of that memory after the job, so heavy bundles get a fresh process each time.
            budget = max(1 << 30, free_memory() // 2)
            heavy_at, reserve = 600 << 20, 1536 << 20
            pending, running, used, i = list(jobs), {}, 0, 0
            with ProcessPoolExecutor(max(1, min(4, self.workers // 2)), max_tasks_per_child=1) as heavy, \
                    ProcessPoolExecutor(self.workers, max_tasks_per_child=8) as light:
                while pending or running:
                    while pending and len(running) < self.workers:
                        free = free_memory()  # what the system really has left, incl. memory workers kept
                        k = next((n for n, j in enumerate(pending) if used + j[4] <= budget and free - j[4] >= reserve), None)
                        if k is None:
                            if running:
                                break
                            k = 0
                        logical, path, rel, size, mem = pending.pop(k)
                        pool = heavy if mem >= heavy_at else light
                        running[pool.submit(_index_job, (path, self.store.root, self.thumbs))] = (logical, rel, size, mem)
                        used += mem
                    done, _ = wait(running, return_when=FIRST_COMPLETED)
                    for fut in done:
                        logical, rel, size, mem = running.pop(fut)
                        used -= mem
                        if self.cancelled:
                            for f in running:
                                f.cancel()
                            raise InterruptedError
                        res = fut.result()
                        if res["errors"]:
                            errors[logical] = res["errors"][:20]
                        self.store.write_json(rel, res)
                        done_bytes += size
                        i += 1
                        self.progress("bundles", i, len(jobs), f"{logical} ({done_bytes * 100 // total_bytes}% of data)")
        for logical in missing:
            bundles[logical].pop("index", None)

        # ---------- files ----------
        prev_files = (prev_snapshot or {}).get("files", {})
        roots = {"install": g.game, "locallow": g.locallow}
        files = self._scan_files(roots, prev_files)

        now = datetime.now()
        snap = {
            "id": f"{version or 'unknown'}_{now:%Y%m%d-%H%M%S}",
            "version": version,
            "created": now.isoformat(timespec="seconds"),
            "catalog": {"path": cat_path, "sha1": hashlib.sha1(cat_bytes).hexdigest(), "build": cat.build_hash},
            "bundles": bundles,
            "missing_bundles": missing,
            "assets": assets,
            "files": files,
            "errors": errors,
        }
        self.store.write_json(f"snapshots/{snap['id']}.json.gz", snap)
        self.progress("done", 1, 1, snap["id"])
        return snap


def list_snapshots(store: Store) -> list[dict]:
    out = []
    d = os.path.join(store.root, "snapshots")
    for fn in sorted(os.listdir(d)):
        if fn.endswith(".json.gz"):
            sid = fn[:-8]
            out.append({"id": sid, "version": sid.rsplit("_", 1)[0], "created": sid.rsplit("_", 1)[-1]})
    return out
