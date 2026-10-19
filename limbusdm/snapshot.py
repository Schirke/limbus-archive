"""Snapshot of the current game version (catalog, bundle objects, files), read-only; unchanged bundles and files are
reused."""
from __future__ import annotations

import fnmatch
import gc
import hashlib
import os
import re
import time
from concurrent.futures import FIRST_COMPLETED, ProcessPoolExecutor, ThreadPoolExecutor, as_completed, wait
from concurrent.futures.process import BrokenProcessPool
from datetime import datetime

from .banks import list_sounds
from .bundles import index_bundle, lean_loading
from .catalog import Catalog
from .paths import GamePaths
from .store import Store

TEXT_EXT = {".json", ".txt", ".xml", ".csv", ".toml", ".ini", ".yaml", ".yml", ".lua", ".md"}
TEXT_MAX = 32 * 1024 * 1024
# files that change on every launch and only add noise
DEFAULT_IGNORE = ["*.log", "*/Unity/*Analytics*", "*/Unity/ShaderVariantAnalytics/*", "*/Settings/*", "*/Temp/*"]
BUNDLE_HASH_RE = re.compile(r"_[0-9a-f]{32}\.bundle$")
# the Unity player's own files (main UI atlases, fonts, scenes): indexed like bundles as "install:<file>"
INSTALL_RE = re.compile(r"^install/LimbusCompany_Data/(resources\.assets|sharedassets\d+\.assets|level\d+"
                        r"|globalgamemanagers(?:\.assets)?)$")


def bundle_logical_name(url: str) -> str:
    """Stable bundle name: CDN file name without the content hash."""
    base = re.split(r"[\\/]", url)[-1]
    return BUNDLE_HASH_RE.sub("", base)


def install_bundles(files: dict) -> dict:
    """{"install:<file>": entry} for the player files in a snapshot's file list; hash = with their .resS / .resource."""
    out = {}
    for rel, rec in files.items():
        m = INSTALL_RE.match(rel)
        if not m:
            continue
        recs = [rec] + [files[r] for r in dict.fromkeys((rel + ".resS", os.path.splitext(rel)[0] + ".resource"))
                        if r in files]
        if any(r.get("h") in (None, "unreadable") for r in recs):
            continue
        h = hashlib.sha1("|".join(r["h"] for r in recs).encode()).hexdigest()
        out["install:" + m.group(1)] = {"name": m.group(1), "hash": h, "size": sum(r["size"] for r in recs), "file": rel}
    return out


def install_path(game: GamePaths, rel: str) -> str:
    return os.path.join(game.game, *rel.split("/")[1:])


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
    """Readable strings from IL2CPP global-metadata.dat (ability classes, script paths, literals), sorted."""
    with open(path, "rb") as f:
        data = f.read()
    win = 1 << 16
    out = set()
    for i in range(0, len(data), win):
        chunk = data[i:i + win]
        if len(PRINTABLE_RE.findall(chunk)) > len(chunk) // 2:
            out.update(LEN_PREFIX_RE.sub(b"", s) for s in STRING_RE.findall(chunk))
    return b"\n".join(sorted(out))


def _worker_start():
    """Pool worker start: lean UnityPy loading, below-normal priority."""
    lean_loading()
    try:
        import ctypes
        ctypes.windll.kernel32.SetPriorityClass(ctypes.windll.kernel32.GetCurrentProcess(), 0x4000)
    except Exception:
        try:
            os.nice(5)
        except Exception:
            pass


def _index_job(args):
    path, store_root, thumbs = args
    t = time.time()
    try:
        res = index_bundle(path, Store(store_root), thumbs)
    except Exception as e:
        res = {"objects": [], "errors": [f"bundle unreadable: {type(e).__name__}: {e}"]}
    # bundles are reference cycles: collect now or the worker holds GBs
    gc.collect()
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
    """Memory a bundle takes to index (decompressed size + decoded textures)."""
    from .cabs import unpacked_size
    return int(unpacked_size(path) * 1.6) + (300 << 20)


def install_job(path: str, size: int) -> tuple[int, float]:
    """(memory, time shares) of a player file: read in place, its .resS texture by texture; `size` = with them."""
    return os.path.getsize(path) * 2 + (300 << 20), job_time(int(size * 1.6) + (300 << 20))


def job_time(mem: int) -> float:
    """How long a bundle takes, in shares (fitted on a whole game)."""
    return 1 + max(0, mem - (300 << 20)) / 1.6 / (20 << 20)


def _kill(pool) -> None:
    """Stops a pool now, running bundles too (shutdown() would wait for them)."""
    for p in list((getattr(pool, "_processes", None) or {}).values()):
        try:
            p.terminate()
        except Exception:
            pass
    pool.shutdown(wait=False, cancel_futures=True)


STALL_MIN, STALL_X = 20 * 60, 25  # a bundle is given up after max(20 min, 25x its expected time)


class Snapshotter:
    def __init__(self, store: Store, game: GamePaths, ignore: list[str] | None = None,
                 workers: int | None = None, thumbs: bool = True, progress=None, light: bool = False):
        self.store = store
        self.game = game
        self.ignore = ignore if ignore is not None else DEFAULT_IGNORE
        # light mode: 2 bundles at a time
        self.workers = workers or (2 if light else max(1, min(12, (os.cpu_count() or 4) - 1)))
        self.thumbs = thumbs
        self.progress = progress or (lambda stage, done, total, msg="", **_: None)
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
        files, work = {}, []
        for rel, full in todo:
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
                    and (prev.get("blob") or not want_blob)
                    and (("sounds" in prev and not str(prev.get("error") or "").startswith("sounds:")) or not want_sounds)
                    and ("names" in prev or not want_names)):
                files[rel] = prev
            else:
                work.append((rel, full, st, want_blob, want_sounds, want_names))

        def read(job):
            rel, full, st, want_blob, want_sounds, want_names = job
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
            return rel, rec

        # the first snapshot hashes the whole install: a few threads are ~2x quicker on SSD
        with ThreadPoolExecutor(4) as pool:
            futs = [pool.submit(read, job) for job in work]
            for i, fut in enumerate(as_completed(futs)):
                if self.cancelled:
                    for f in futs:
                        f.cancel()
                    raise InterruptedError
                rel, rec = fut.result()
                files[rel] = rec
                if i % 200 == 0:
                    self.progress("files", i, len(work), rel)
        self.progress("files", len(work), len(work))
        return {rel: files[rel] for rel, _full in todo if rel in files}  # same order as before

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

        # ---------- files ----------
        prev_files = (prev_snapshot or {}).get("files", {})
        roots = {"install": g.game, "locallow": g.locallow}
        files = self._scan_files(roots, prev_files)

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
            mem = job_memory(path)
            jobs.append((logical, path, rel, os.path.getsize(path), mem, job_time(mem)))
        for logical, b in install_bundles(files).items():
            rel = b["index"] = f"bundle_index/install_{b['name']}_{b['hash']}.json.gz"
            bundles[logical] = b
            path = install_path(g, b["file"])
            if self.store.exists(rel):
                continue
            if os.path.isfile(path):
                jobs.append((logical, path, rel, b["size"], *install_job(path, b["size"])))
            else:
                b.pop("index")
        jobs.sort(key=lambda j: -j[4])  # biggest first for better load balancing
        total_bytes = sum(j[3] for j in jobs) or 1
        total_time = sum(j[5] for j in jobs) or 1
        done_bytes = done_time = 0
        errors, failed, retried, stalled, stopped = {}, [], set(), set(), set()
        shares_of = {j[0]: j[5] for j in jobs}
        started = last_done = time.time()
        read_secs = read_shares = 0.0
        self.progress("bundles", 0, len(jobs), f"{len(jobs)} bundles to index")
        if jobs:
            # memory budget: a new bundle starts only while running ones fit in half the free memory; heavy ones in
            # their own small pool
            budget = max(1 << 30, free_memory() // 2)
            heavy_at, reserve = 600 << 20, 1536 << 20
            pending, running, used, i = list(jobs), {}, 0, 0
            sizes = {"heavy": max(1, min(4, self.workers // 2)), "light": self.workers}
            pools = {k: ProcessPoolExecutor(n, max_tasks_per_child=8, initializer=_worker_start) for k, n in sizes.items()}
            try:
                while pending or running:
                    while pending and len(running) < self.workers:
                        free = free_memory()  # what the system really has left, incl. memory workers kept
                        k = next((n for n, j in enumerate(pending) if used + j[4] <= budget and free - j[4] >= reserve), None)
                        if k is None:
                            if running:
                                break
                            k = 0
                        job = pending.pop(k)
                        kind = "heavy" if job[4] >= heavy_at else "light"
                        running[pools[kind].submit(_index_job, (job[1], self.store.root, self.thumbs))] = \
                            (job, kind, pools[kind], time.time())
                        used += job[4]
                    done, _ = wait(running, timeout=2, return_when=FIRST_COMPLETED)
                    if self.cancelled:
                        raise InterruptedError
                    now = time.time()
                    if not done and now - last_done >= 30:
                        # long reads: say which bundle and for how long instead of an old time-left guess
                        job, _k, pool, t0 = min(running.values(), key=lambda r: r[3])
                        self.progress("bundles", i, len(jobs), f"reading {job[0]} ({job[3] >> 20} MB file) for "
                                      f"{int(now - t0) // 60} min", eta=-1)
                        per_share = read_secs / read_shares if read_shares else 1.0
                        for job, kind, pool, t0 in list(running.values()):
                            if now - t0 > max(STALL_MIN, STALL_X * per_share * job[5]):
                                stalled.add(job[0])
                                stopped.add(pool)
                                _kill(pool)
                                if pools[kind] is pool:
                                    pools[kind] = ProcessPoolExecutor(sizes[kind], max_tasks_per_child=8,
                                                                      initializer=_worker_start)
                    for fut in done:
                        job, kind, pool, t0 = running.pop(fut)
                        logical, path, rel, size, mem, shares = job
                        used -= mem
                        last_done = now
                        try:
                            res = fut.result()
                        except BrokenProcessPool:
                            # a worker died (likely OOM) or a stuck one was stopped: new pool; its bundles retried
                            # once alone, then left for the next snapshot
                            if pools[kind] is pool:
                                pool.shutdown(wait=False, cancel_futures=True)
                                pools[kind] = ProcessPoolExecutor(sizes[kind], max_tasks_per_child=8,
                                                                  initializer=_worker_start)
                            if pool in stopped and logical not in stalled:  # only stopped along with a stuck one
                                pending.insert(0, job)
                                continue
                            if logical not in retried and logical not in stalled:
                                retried.add(logical)
                                pending.insert(0, (logical, path, rel, size, budget + 1, shares))
                                continue
                            errors[logical] = ["not read: it took too long, tried again next snapshot"
                                               if logical in stalled else
                                               "not read: the reading process stopped (out of memory?)"]
                            failed.append(logical)
                            res = None
                        if res is not None:
                            if res["errors"]:
                                errors[logical] = res["errors"][:20]
                            self.store.write_json(rel, res)
                            read_secs += res.get("secs") or 0
                            read_shares += shares
                        done_bytes += size
                        done_time += shares_of[logical]
                        i += 1
                        part = done_time / total_time  # time left, from the share done so far
                        spent = time.time() - started
                        eta = round(spent * (1 - part) / part) if part >= 0.05 and spent >= 20 else None
                        self.progress("bundles", i, len(jobs), f"{logical} ({done_bytes * 100 // total_bytes}% of data)",
                                      eta=eta)
            finally:
                for p in pools.values():
                    if running:  # cancelled or failed: don't wait for the bundles still being read
                        _kill(p)
                    else:
                        p.shutdown(wait=True, cancel_futures=True)
        for logical in missing + failed:
            bundles[logical].pop("index", None)

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
