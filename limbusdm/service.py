"""App core: settings, background jobs (snapshot / report), new-version check, browse index."""
from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import threading
import time
import traceback
from datetime import datetime

from .catalog import Catalog
from .diff import diff_snapshots, scan_snapshot
from .paths import GamePaths
from .snapshot import DEFAULT_IGNORE, Snapshotter, bundle_logical_name, list_snapshots
from .store import Store
from .translate import Translator

DEFAULT_SETTINGS = {
    "game_dir": "",
    "auto_on_start": True,
    "thumbs": True,
    "ignore": DEFAULT_IGNORE,
}


def _re_split_stem(name: str) -> str:
    """"DonQuixote_NCorp_S2_Timeline_1" → "DonQuixote_NCorp_" (the character part of a timeline name)."""
    import re
    m = re.search(r"_(S\d+|Parrying)_Timeline", name, re.I)
    return name[:m.start() + 1] if m else name


class Service:
    def __init__(self, data_dir: str):
        self.data_dir = data_dir
        self.store = Store(data_dir)
        self.settings_path = os.path.join(data_dir, "settings.json")
        self.settings = dict(DEFAULT_SETTINGS)
        if os.path.exists(self.settings_path):
            try:
                with open(self.settings_path, encoding="utf-8") as f:
                    self.settings.update({k: v for k, v in json.load(f).items() if k in DEFAULT_SETTINGS})
            except Exception:
                pass
        self.marks_path = os.path.join(data_dir, "marks.json")
        self.marks = self._load_json(self.marks_path, {})
        try:  # (the team guide an older version kept: recommendations are gone)
            os.remove(os.path.join(data_dir, "teams", "guide.json"))
        except OSError:
            pass
        self.translator = Translator(os.path.join(data_dir, "translations.json"))
        self.job: dict | None = None
        self._job_lock = threading.Lock()
        self._snapshotter: Snapshotter | None = None
        self.watch = {"last_check": None, "state": "not checked yet"}
        self._browse_lock = threading.Lock()
        self._cab_lock = threading.Lock()
        self._content_lock = threading.Lock()
        from .viewer import Renderer
        self.fx = Renderer(self)  # skill renders with the game's effects (Unity player)
        from .buffs import BuffFx
        self.buff_fx = BuffFx(self)  # Database → Buff effects: the list and its videos

    # ------------------------------------------------------------ settings
    @staticmethod
    def _load_json(path, default):
        try:
            with open(path, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return default

    def save_settings(self, upd: dict):
        self.settings.update({k: v for k, v in upd.items() if k in DEFAULT_SETTINGS})
        with open(self.settings_path, "w", encoding="utf-8") as f:
            json.dump(self.settings, f, ensure_ascii=False, indent=2)

    def set_mark(self, key: str, mark: str | None):
        if mark:
            self.marks[key] = mark
        else:
            self.marks.pop(key, None)
        with open(self.marks_path, "w", encoding="utf-8") as f:
            json.dump(self.marks, f, ensure_ascii=False)

    @property
    def game(self) -> GamePaths:
        return GamePaths(self.settings.get("game_dir") or None)

    # ------------------------------------------------------------ queries
    def snapshots(self):
        return list_snapshots(self.store)

    def latest_snapshot_id(self):
        s = self.snapshots()
        return s[-1]["id"] if s else None

    def load_snapshot(self, sid):
        """A snapshot (read once and kept while its file is unchanged: object_file and others ask for it a lot)."""
        rel = f"snapshots/{sid}.json.gz"
        try:
            mtime = os.path.getmtime(os.path.join(self.store.root, rel))
        except OSError:
            return self.store.read_json(rel)
        cached = getattr(self, "_snap_cache", None)
        if cached and cached[0] == (sid, mtime):
            return cached[1]
        snap = self.store.read_json(rel)
        self._snap_cache = ((sid, mtime), snap)
        return snap

    def reports(self):
        d = os.path.join(self.data_dir, "reports")
        out = []
        for fn in sorted(os.listdir(d), reverse=True):
            if fn.endswith(".json.gz") and "__" in fn:
                rid = fn[:-8]
                old, new = rid.split("__", 1)
                meta = self._load_json(os.path.join(d, rid + ".meta.json"), {})
                out.append({"id": rid, "old": old, "new": new, "summary": meta.get("summary")})
        out.sort(key=lambda r: r["new"].rsplit("_", 1)[-1], reverse=True)
        return out

    def state(self):
        g = self.game
        return {
            "game": {"ok": g.ok, "dir": g.game, "catalog": g.catalog_path()},
            "snapshots": self.snapshots(),
            "reports": self.reports(),
            "job": self.job,
            "watch": self.watch,
            "settings": self.settings,
            "data_dir": self.data_dir,
            "version": __import__("limbusdm").__version__,
            "update": (getattr(self, "_update", None) or (0, None))[1],
            "site_publish": os.path.exists(os.path.join(self.data_dir, "site_config.json")),  # the web copy is set up here
        }

    # ------------------------------------------------------------ jobs
    def _run_job(self, kind: str, fn):
        with self._job_lock:
            if self.job and self.job.get("running"):
                raise RuntimeError("another job is running")
            self.job = {"kind": kind, "running": True, "stage": "starting", "done": 0, "total": 0, "msg": "",
                        "started": time.time(), "error": None, "result": None}

        def progress(stage, done, total, msg=""):
            self.job.update(stage=stage, done=done, total=total, msg=msg)

        def runner():
            try:
                self.job["result"] = fn(progress)
            except InterruptedError:
                self.job["error"] = "cancelled"
            except Exception as e:
                self.job["error"] = f"{type(e).__name__}: {e}"
                traceback.print_exc()
            finally:
                self.job["running"] = False
                self.job["finished"] = time.time()
                self._snapshotter = None

        threading.Thread(target=runner, daemon=True).start()

    def start_snapshot(self, auto_report: bool = True):
        def fn(progress):
            prev_id = self.latest_snapshot_id()
            prev = self.load_snapshot(prev_id) if prev_id else None
            self._snapshotter = Snapshotter(self.store, self.game, ignore=self.settings["ignore"],
                                            thumbs=self.settings["thumbs"], progress=progress)
            snap = self._snapshotter.take(prev)
            result = {"snapshot": snap["id"]}
            if not (prev and auto_report):
                threading.Thread(target=self.ensure_browse, args=(snap["id"],), daemon=True).start()
            if prev and auto_report:
                progress("report", 0, 1, "comparing with " + prev_id)
                rep = diff_snapshots(self.store, prev_id, snap["id"])
                if not any(rep["summary"].values()):
                    # nothing changed: no duplicate snapshot, but keep any data the new one has on top
                    # (e.g. after an app update) under the old id
                    self._delete_report(rep["id"])
                    os.remove(os.path.join(self.data_dir, "snapshots", snap["id"] + ".json.gz"))
                    self.store.write_json(f"snapshots/{prev_id}.json.gz", {**snap, "id": prev_id, "created": prev["created"]})
                    return {"snapshot": prev_id, "unchanged": True}
                result["report"] = rep["id"]
            threading.Thread(target=self.ensure_browse, args=(snap["id"],), daemon=True).start()
            return result

        self._run_job("snapshot", fn)

    def start_report(self, old_id: str, new_id: str):
        def fn(progress):
            progress("report", 0, 1, f"{old_id} → {new_id}")
            rep = diff_snapshots(self.store, old_id, new_id)
            return {"report": rep["id"]}

        self._run_job("report", fn)

    def _delete_report(self, rid: str):
        for ext in (".json.gz", ".meta.json"):
            p = os.path.join(self.data_dir, "reports", rid + ext)
            if os.path.exists(p):
                os.remove(p)

    # ------------------------------------------------------------ self-update
    def update_check(self, force: bool = False) -> dict:
        from . import updater
        cached = getattr(self, "_update", None)
        if cached and not force and time.time() - cached[0] < 3600:
            return cached[1]
        try:
            info = updater.check()
        except Exception as e:
            from . import __version__
            info = {"current": __version__, "error": f"{type(e).__name__}: {e}", "newer": False}
        self._update = (time.time(), info)
        return info

    def start_update(self):
        from . import updater

        def fn(progress):
            cached = getattr(self, "_update", None)
            v = updater.install(self.data_dir, progress, cached[1] if cached else None)
            updater.quit_soon(2.0)
            return {"updated_to": v}

        self._run_job("update", fn)

    def cancel(self):
        if self._snapshotter:
            self._snapshotter.cancelled = True

    def scan(self, sid: str):
        rel = f"reports/scan2_{sid}.json.gz"  # scan2: rules changed in 0.4.6 (no "sample")
        data = self.store.read_json(rel)
        if data is None:
            data = scan_snapshot(self.store, sid)
            self.store.write_json(rel, data)
        return data

    # ------------------------------------------------------------ new game version
    def check_version(self, start: bool = True) -> str:
        """Compare the game's catalog with the latest snapshot; if the game has fully downloaded a new
        version, take a snapshot + report (when `start`). Data comes only from what the game downloaded."""
        self.watch["last_check"] = datetime.now().isoformat(timespec="seconds")
        state = self._version_state()
        self.watch["state"] = state
        if state == "new version downloaded" and start and not (self.job and self.job.get("running")):
            self.start_snapshot(auto_report=True)
            self.watch["state"] = "new version: building the report"
        return self.watch["state"]

    def _version_state(self) -> str:
        g = self.game
        cat = g.catalog_path()
        if not g.ok or not cat:
            return "game not found"
        latest = self.latest_snapshot_id()
        if not latest:
            return "no snapshot yet"
        st = os.stat(cat)
        stamp = (latest, cat, st.st_size, st.st_mtime)
        if getattr(self, "_uptodate", None) == stamp:  # checked every 2 min: skip re-hashing an unchanged catalog
            return "up to date"
        with open(cat, "rb") as f:
            data = f.read()
        if self.load_snapshot(latest)["catalog"]["sha1"] == hashlib.sha1(data).hexdigest():
            self._uptodate = stamp
            return "up to date"
        try:
            c = Catalog(data)
        except Exception:
            return "the game is updating, try again in a minute"
        files = [g.bundle_file(b.name, b.hash, b.url) for b in c.bundles.values()]
        missing = sum(1 for f in files if not f)
        if missing:
            return f"new version: the game hasn't downloaded {missing} bundles yet — open the game and let it finish"
        newest = max((os.path.getmtime(f) for f in files if f), default=0)
        if time.time() - max(newest, os.path.getmtime(cat)) < 60:
            return "the game is still writing files, try again in a minute"
        return "new version downloaded"


    # ------------------------------------------------------------ browse index
    def _browse_path(self, sid):
        return os.path.join(self.data_dir, "browse", f"{sid}.sqlite")

    def ensure_browse(self, sid: str | None = None) -> str | None:
        sid = sid or self.latest_snapshot_id()
        if not sid:
            return None
        path = self._browse_path(sid)
        with self._browse_lock:
            if os.path.exists(path):
                return path
            os.makedirs(os.path.dirname(path), exist_ok=True)
            snap = self.load_snapshot(sid)
            tmp = path + ".tmp"
            if os.path.exists(tmp):
                os.remove(tmp)
            db = sqlite3.connect(tmp)
            db.execute("create table o(bundle text, pid integer, type text, name text, c text, h text, w integer, hgt integer, tex text, rect text)")
            for logical, b in snap["bundles"].items():
                if not b.get("index"):
                    continue
                idx = self.store.read_json(b["index"]) or {"objects": []}
                db.executemany("insert into o values (?,?,?,?,?,?,?,?,?,?)", [
                    (logical, o["pid"], o["type"], o.get("name"), o.get("c"), o.get("h"), o.get("w"), o.get("hgt"),
                     o.get("tex"), json.dumps(o["rect"]) if o.get("rect") else None) for o in idx["objects"]])
            db.execute("create index o_c on o(c)")
            db.execute("create index o_bp on o(bundle, pid)")
            db.execute("create index o_type on o(type)")
            db.execute("create index o_btn on o(bundle, type, name)")
            db.commit()
            db.close()
            os.replace(tmp, path)
            # keep only the latest two browse indexes
            for fn in sorted(os.listdir(os.path.dirname(path)))[:-2]:
                try:
                    os.remove(os.path.join(os.path.dirname(path), fn))
                except OSError:
                    pass
        return path

    def browse_query(self, q: str = "", type_: str = "", limit: int = 300, sid: str | None = None):
        path = self.ensure_browse(sid)
        if not path:
            return []
        db = sqlite3.connect(path)
        db.row_factory = sqlite3.Row
        where, args = [], []
        for word in q.split():
            where.append("(name like ? or c like ?)")
            args += [f"%{word}%", f"%{word}%"]
        if type_:
            where.append("type = ?")
            args.append(type_)
        sql = "select * from o" + (" where " + " and ".join(where) if where else "") + " limit ?"
        rows = [dict(r, pid=str(r["pid"])) for r in db.execute(sql, args + [limit])]
        db.close()
        return rows

    def browse_types(self, sid: str | None = None):
        path = self.ensure_browse(sid)
        if not path:
            return []
        db = sqlite3.connect(path)
        rows = db.execute("select type, count(*) from o group by type order by 2 desc").fetchall()
        db.close()
        return rows

    def object_file(self, logical: str):
        """Path of the bundle file in the game's cache for the latest snapshot's version of `logical`."""
        snap = self.load_snapshot(self.latest_snapshot_id())
        b = snap["bundles"].get(logical) if snap else None
        if not b:
            return None
        return self.game.bundle_file(b["name"], b["hash"], b["url"])

    def _name_index(self, db_path: str):
        """Index for lookups by bundle + type + name (added lazily to older browse databases)."""
        if getattr(self, "_name_indexed", None) != db_path:
            db = sqlite3.connect(db_path)
            db.execute("create index if not exists o_btn on o(bundle, type, name)")
            db.commit()
            db.close()
            self._name_indexed = db_path

    def find_object(self, bundle: str, type_: str, name: str) -> dict | None:
        db_path = self.ensure_browse()
        if not db_path:
            return None
        self._name_index(db_path)
        db = sqlite3.connect(db_path)
        db.row_factory = sqlite3.Row
        r = db.execute("select * from o where bundle=? and type=? and name=? limit 1", (bundle, type_, name)).fetchone()
        db.close()
        return dict(r, pid=str(r["pid"])) if r else None

    def find_object_anywhere(self, type_: str, name: str, near: str = "") -> dict | None:
        """Same name in any bundle; prefers a bundle sharing the longest name prefix with `near`."""
        db_path = self.ensure_browse()
        if not db_path:
            return None
        db = sqlite3.connect(db_path)
        db.row_factory = sqlite3.Row
        rows = [dict(r, pid=str(r["pid"])) for r in db.execute("select * from o where type=? and name=?", (type_, name))]
        db.close()
        if not rows:
            return None

        def common(a, b):
            n = 0
            while n < min(len(a), len(b)) and a[n] == b[n]:
                n += 1
            return n
        return max(rows, key=lambda r: common(r["bundle"], near))

    def find_object_by_pid(self, bundle: str, pid: str) -> dict | None:
        db_path = self.ensure_browse()
        if not db_path:
            return None
        db = sqlite3.connect(db_path)
        db.row_factory = sqlite3.Row
        r = db.execute("select * from o where bundle=? and pid=? limit 1", (bundle, int(pid))).fetchone()
        db.close()
        return dict(r, pid=str(r["pid"])) if r else None

    def spine_list(self) -> list[dict]:
        """Spine skeletons (atlas TextAsset + skeleton TextAsset with the same base name) of the latest snapshot."""
        import re
        db_path = self.ensure_browse()
        if not db_path:
            return []
        cached = getattr(self, "_spine_cache", None)
        if cached and cached[0] == db_path:
            return cached[1]
        nm = self.names()
        self._name_index(db_path)
        db = sqlite3.connect(db_path)
        rows = db.execute("""select bundle, pid, substr(name, 1, length(name) - 6) from o
                             where type = 'TextAsset' and name like '%.atlas'""").fetchall()
        db.close()
        out = []
        for bundle, pid, base in rows:
            m = re.match(r"^([pe])(\d{5})_", bundle)
            low = bundle.lower()
            if m:
                kind = "Identity" if m.group(1) == "p" else "E.G.O"
                cid = int(m.group(2))
                label = nm.id_title(cid) if m.group(1) == "p" else nm.ego_title(cid)
            else:
                kind = ("Enemy" if "enemy" in low else "Abnormality" if "abnormality" in low else
                        "RPG" if "rpg" in low else "Story" if "story" in low or "produce" in low else "Other")
                label = ""
            out.append({"bundle": bundle, "atlas": str(pid), "base": base, "kind": kind, "label": label})
        order = ["Identity", "E.G.O", "Enemy", "Abnormality", "RPG", "Story", "Other"]
        out = sorted(out, key=lambda x: (order.index(x["kind"]), x["bundle"], x["base"], x["atlas"]))
        seen: dict[tuple, int] = {}
        for x in out:  # many skeletons share a name ("imported") — number the repeats
            k = (x["bundle"], x["base"])
            seen[k] = seen.get(k, 0) + 1
            if seen[k] > 1:
                x["base"] = f"{x['base']} #{seen[k]}"
        self._spine_cache = (db_path, out)
        return out

    # ------------------------------------------------------------ characters (Animations page)
    def names(self):
        from .characters import Names
        if getattr(self, "_names_obj", None) is None:
            self._names_obj = Names(self.game.data)
        return self._names_obj

    def characters(self) -> dict:
        """{"sinners": [{sid, name, ids: [...], egos: [...], other: [spine]}], "spine_other": {content: [spine]}}"""
        import re
        from .characters import bundle_date, owner_bundles, season_label, tag_label
        sid = self.latest_snapshot_id()
        snap = self.load_snapshot(sid) if sid else None
        if not snap:
            return {"sinners": [], "groups": []}
        cached = getattr(self, "_chars_cache", None)
        if cached and cached[0] == sid:
            return cached[1]
        nm = self.names()
        bundles = list(snap["bundles"])
        spine = self.spine_list()
        spine_by_owner: dict[int, list] = {}
        rest = []
        for x in spine:
            m = re.match(r"^(?:sd_)?([pe])(\d{5})_", x["bundle"])
            if m:
                spine_by_owner.setdefault(int(m.group(2)), []).append(x)
            else:
                rest.append(x)

        def entry(cid, title):
            bs = owner_bundles(bundles, cid)
            if not bs and cid < 20000:  # early Identities share a Sinner bundle (sd_p1_assets_all…)
                bs = self.appearance_bundles(cid)
            return {"id": cid, "title": title, "bundles": bs, "spine": spine_by_owner.get(cid, [])}

        # every playable Identity / E.G.O is listed, files found or not, so none goes missing whatever its bundles
        # are called (early ones: shared Sinner bundles, E.G.O effect bundles named after their skills)
        try:
            db = self.unit_db()
            playable = {x["id"] for x in db["ids"] + db["egos"]}
        except Exception:
            playable = set()

        sinners = {}
        for cid in sorted(set(nm.personalities) | {c for c in spine_by_owner if str(c).startswith("1")}):
            if not (10000 <= cid < 20000):
                continue
            e = entry(cid, nm.id_title(cid))
            if e["bundles"] or e["spine"] or cid in playable:
                sinners.setdefault(nm.sinner_of(cid), {"ids": [], "egos": []})["ids"].append(e)
        for cid in sorted(set(nm.egos) | {c for c in spine_by_owner if str(c).startswith("2")}):
            if not (20000 <= cid < 30000):
                continue
            e = entry(cid, nm.ego_title(cid))
            if e["bundles"] or e["spine"] or cid in playable:
                sinners.setdefault(nm.sinner_of(cid), {"ids": [], "egos": []})["egos"].append(e)
        out_sinners = [{"sid": s, "name": nm.sinner_name(s), **v} for s, v in sorted(sinners.items()) if 1 <= s <= 12]

        # everything else: enemies, abnormalities, RPG, story… grouped by the content they came with — the bundle's
        # name when it says so, else the chapter the game's stage tables put that enemy in, else the update date
        cmap = self.enemy_content(build=False)
        if cmap is None:
            self._content_bg()
        cmap = cmap or {}
        by_bundle: dict[str, set] = {}
        for key, info in cmap.items():
            by_bundle.setdefault(key.split("|")[0], set()).add((info["label"], info["order"]))
        season_end: dict[str, str] = {}  # last dated update of each season, for bundles with no date in the name
        for b in bundles:
            d, m = bundle_date(b), re.match(r"^s(\d+)_", b)
            if d and m and d > season_end.get(m.group(1), ""):
                season_end[m.group(1)] = d
        groups: dict[str, dict] = {}
        for x in rest:
            b = x["bundle"]
            info = cmap.get(f"{b}|{x['atlas']}")
            if info:
                x = {**x, "kind": info["kind"], "name": info.get("name") or ""}
            siblings = by_bundle.get(b, set())
            label, order = (tag_label(b) or ((info["label"], info["order"]) if info else None)
                            or (next(iter(siblings)) if len(siblings) == 1 else (season_label(b), 0)))
            m = re.match(r"^s(\d+)_", b)
            date = bundle_date(b) or (season_end.get(m.group(1)) if m else None)
            g = groups.setdefault(label, {"label": label, "date": date, "order": order, "kinds": {}})
            g["date"], g["order"] = min(filter(None, (g["date"], date)), default=None), max(g["order"], order)
            g["kinds"].setdefault(x["kind"], []).append(x)
        # battle prefabs (the skill renderer's), grouped the same way: by the content their look first appears in
        apps = self.enemy_apps() if cmap else {}
        for x in self.battle_prefabs():
            b, info = x["bundle"], apps.get(x["app"])
            kind = info["kind"] if info else ("Boss / Abnormality" if "abnormality" in b.lower() else "Enemy")
            siblings = by_bundle.get(b, set())
            label, order = (tag_label(b) or ((info["label"], info["order"]) if info else None)
                            or (next(iter(siblings)) if len(siblings) == 1 else (season_label(b), 0)))
            m = re.match(r"^s(\d+)_", b)
            date = bundle_date(b) or (season_end.get(m.group(1)) if m else None)
            g = groups.setdefault(label, {"label": label, "date": date, "order": order, "kinds": {}})
            g["date"], g["order"] = min(filter(None, (g["date"], date)), default=None), max(g["order"], order)
            g["kinds"].setdefault(kind, []).append({**x, "kind": kind, "base": x["app"], "name": (info or {}).get("name") or ""})
        # newest first by the update a group debuted in; the Parts of one Canto stay together
        canto_date: dict[str, str] = {}
        for g in groups.values():
            m = re.match(r"Canto \d+", g["label"])
            if m and g["date"]:
                canto_date[m.group(0)] = min(canto_date.get(m.group(0), g["date"]), g["date"])
        for g in groups.values():
            m = re.match(r"Canto \d+", g["label"])
            date = (canto_date.get(m.group(0)) if m else None) or g.pop("date") or "000000"
            g.pop("date", None)
            g["key"] = f"{date}{g.pop('order'):08.2f}{g['label']}" if g["label"] != "Launch / shared" else ""
            for arr in g["kinds"].values():
                arr.sort(key=lambda x: (x.get("name") or x["base"]).lower())
        out = {"sinners": out_sinners, "groups": sorted(groups.values(), key=lambda g: g["key"], reverse=True),
               "pending": not cmap and self.latest_snapshot_id() is not None and getattr(self, "_content_bg_on", False)}
        self._chars_cache = (sid, out)
        return out

    def _content_bg(self):
        """Build the enemy → chapter map in the background (the Animations page refreshes when it's ready)."""
        if getattr(self, "_content_bg_on", False):
            return
        self._content_bg_on = True

        def run():
            try:
                self.enemy_content()
            except Exception:
                traceback.print_exc()
            finally:
                self._content_bg_on = False
                self._chars_cache = None
        threading.Thread(target=run, daemon=True).start()

    # ------------------------------------------------------------ cross-bundle references
    def cab_index(self) -> dict[str, str]:
        """{"cab-<hash>": bundle} for the latest snapshot (built once, ~2 min on the first run, then from disk)."""
        sid = self.latest_snapshot_id()
        cached = getattr(self, "_cabs", None)
        if cached and cached[0] == sid:
            return cached[1]
        with self._cab_lock:
            cached = getattr(self, "_cabs", None)
            if cached and cached[0] == sid:
                return cached[1]
            rel = f"cab_index/{sid}.json.gz"
            idx = self.store.read_json(rel)
            if idx is None:
                from .cabs import cab_names
                snap = self.load_snapshot(sid)
                idx = {}
                for lg, b in snap["bundles"].items():
                    names = None
                    if b.get("index"):
                        names = (self.store.read_json(b["index"]) or {}).get("cabs")
                    if names is None:
                        path = self.object_file(lg)
                        try:
                            names = cab_names(path) if path else []
                        except Exception:
                            names = []
                    for c in names:
                        idx[c.lower()] = lg
                self.store.write_json(rel, idx)
            self._cabs = (sid, idx)
            return idx

    def resolver(self):
        """resolve(assets_file, file_id, path_id) -> (bundle, object) for references into other bundles."""
        import re
        from .extract import _env
        idx = self.cab_index()
        by_bundle: dict[str, dict] = {}

        def resolve(assets_file, file_id, path_id):
            try:
                ext = assets_file.externals[file_id - 1].path.lower()
            except Exception:
                return None, None
            m = re.search(r"cab-[0-9a-f]+", ext)
            lg = idx.get(m.group(0)) if m else None
            path = self.object_file(lg) if lg else None
            if not path:
                return None, None
            if lg not in by_bundle:
                by_bundle[lg] = {o.path_id: o for o in _env(path).objects}
            return lg, by_bundle[lg].get(path_id)

        return resolve

    # ------------------------------------------------------------ enemies → chapters
    def static_tables(self, folders) -> dict[str, dict[str, object]]:
        """{folder: {file name: parsed JSON}} from StaticData/static-data/<folder>/ of the latest snapshot."""
        db_path = self.ensure_browse()
        out: dict[str, dict[str, object]] = {}
        if not db_path:
            return out
        db = sqlite3.connect(db_path)
        for folder in folders:
            rows = db.execute("select name, h from o where type = 'TextAsset' and c like ?",
                              (f"Assets/Resources_moved/StaticData/static-data/{folder}/%",)).fetchall()
            for name, h in rows:
                if not h or name in out.get(folder, {}):
                    continue
                try:
                    out.setdefault(folder, {})[name] = json.loads(self.store.get_blob(h).decode("utf-8-sig"))
                except Exception:
                    continue
        db.close()
        return out

    def enemy_content(self, build: bool = True) -> dict | None:
        """{"<bundle>|<atlas pid>": {"label", "kind", "name", "prio", "order"}}: the chapter / mode each enemy and
        abnormality skeleton first appears in. ~1 min on the first run (per-bundle results are kept by hash)."""
        import re
        from . import content
        sid = self.latest_snapshot_id()
        if not sid:
            return None
        cached = getattr(self, "_content", None)
        if cached and cached[0] == sid:
            return cached[1]
        rel = f"enemy_content/{sid}.json.gz"
        if not build:
            if not self.store.exists(rel):
                return None
        with self._content_lock:
            cached = getattr(self, "_content", None)
            if cached and cached[0] == sid:
                return cached[1]
            result = self.store.read_json(rel)
            if result is None:
                snap = self.load_snapshot(sid)
                loc = os.path.join(self.game.data or "", "Assets", "Resources_moved", "Localize", "en")
                apps = content.appearance_content(
                    self.static_tables(list(content.UNIT_TABLES) + content.STAGE_TABLES),
                    content.load_chapters(loc), content.load_unit_names(loc))
                self.store.write_json(f"enemy_apps/{sid}.json.gz", apps)
                cabs = self.cab_index()
                links = self._appearance_links(snap)
                result = {}
                for lg, li in links.items():
                    for app, cab, sd in li["uses"]:
                        info = apps.get(app)
                        target = cabs.get(cab) if cab else lg
                        if not info or target not in links:
                            continue
                        for atlas in links[target]["sd"].get(sd, []):
                            key = f"{target}|{atlas}"
                            cur = result.get(key)
                            if cur is None or (info["prio"], info["order"]) < (cur["prio"], cur["order"]):
                                result[key] = info
                self.store.write_json(rel, result)
            self._content = (sid, result)
            self._chars_cache = None
            return result

    def _appearance_links(self, snap: dict) -> dict:
        """{bundle: content.bundle_links} for every bundle with battle prefabs or Spine skeletons (kept per bundle hash)."""
        import re
        from . import content
        db = sqlite3.connect(self.ensure_browse())
        todo = {r[0] for r in db.execute("""select distinct bundle from o where type = 'GameObject'
                                            and c like '%Appearance.prefab'""")}
        db.close()
        todo |= {x["bundle"] for x in self.spine_list()}
        todo = {b for b in todo if b in snap["bundles"] and not re.match(r"^(?:sd_)?[pe]\d{5}_", b)}
        links = {}
        for lg in sorted(todo):
            b = snap["bundles"][lg]
            lrel = f"appearance_links/{lg}_{b['hash']}.json.gz"
            li = self.store.read_json(lrel)
            if li is None:
                path = self.object_file(lg)
                try:
                    li = content.bundle_links(path) if path else {"sd": {}, "uses": []}
                except Exception:
                    li = {"sd": {}, "uses": []}
                self.store.write_json(lrel, li)
            links[lg] = li
        return links

    def enemy_spines(self) -> dict:
        """{appearance prefab name: [{"bundle", "atlas", "base"}]}: the Spine skeletons a battle prefab is drawn with
        (most enemies are sprites and have none). Empty until enemy_content has been built once (it reads the same
        per-bundle links, ~1 min the first time, in the background on start)."""
        sid = self.latest_snapshot_id()
        cached = getattr(self, "_app_spines", None)
        if cached and cached[0] == sid:
            return cached[1]
        if not sid or self.enemy_content(build=False) is None:
            return {}
        links, cabs = self._appearance_links(self.load_snapshot(sid)), self.cab_index()
        bases = {(x["bundle"], x["atlas"]): x["base"] for x in self.spine_list()}
        out: dict[str, list] = {}
        for lg, li in links.items():
            for app, cab, sd in li["uses"]:
                target = cabs.get(cab) if cab else lg
                for atlas in (links.get(target) or {"sd": {}})["sd"].get(sd, []):
                    x = {"bundle": target, "atlas": atlas, "base": bases.get((target, atlas), "")}
                    if x not in out.setdefault(app, []):
                        out[app].append(x)
        self._app_spines = (sid, out)
        return out

    def enemy_apps(self) -> dict:
        """{appearance prefab name: {"label", "kind", "name", "prio", "order"}} (see content.appearance_content)."""
        from . import content
        sid = self.latest_snapshot_id()
        cached = getattr(self, "_apps", None)
        if cached and cached[0] == sid:
            return cached[1]
        rel = f"enemy_apps/{sid}.json.gz"
        apps = self.store.read_json(rel)
        if apps is None:
            loc = os.path.join(self.game.data or "", "Assets", "Resources_moved", "Localize", "en")
            apps = content.appearance_content(self.static_tables(list(content.UNIT_TABLES) + content.STAGE_TABLES),
                                              content.load_chapters(loc), content.load_unit_names(loc))
            self.store.write_json(rel, apps)
        self._apps = (sid, apps)
        return apps

    def battle_prefabs(self) -> list[dict]:
        """Enemies', abnormalities' and others' battle prefabs ("…Appearance"), one entry per name: what the skill
        renderer plays. Many of them are drawn with sprites and have no Spine skeleton to list them by."""
        import re
        db_path = self.ensure_browse()
        if not db_path:
            return []
        db = sqlite3.connect(db_path)
        rows = db.execute("""select bundle, name from o where type = 'GameObject'
                             and c like '%/' || name || '.prefab' and name like '%Appearance'""").fetchall()
        db.close()
        snap = self.load_snapshot(self.latest_snapshot_id())
        out: dict[str, dict] = {}
        for bundle, name in sorted(rows):
            low = bundle.lower()
            if (re.match(r"^(?:sd_)?[pe]\d{5}_", bundle) or re.match(r"^sd_p\d+_", bundle) or re.match(r"^1\d{4}_", name)
                    or any(k in low for k in ("produce", "skinpreview", "_temp_")) or bundle not in snap["bundles"]):
                continue
            out.setdefault(name, {"bundle": bundle, "app": name})
        return list(out.values())

    def skill_slots(self, cid) -> dict[int, dict]:
        """An Identity's skill animations (<Char>_S<n>: skill id = id * 100 + n) as the game shows the skills:
        {n: {"slot": "Skill 3.2" | "Defense", "name"}} — n isn't the tier: Le Noir Footwear Hall Ryoshu's S4 is her
        Defense and S5 her second Skill 3. A tier with one skill is just "Skill 2"."""
        if not isinstance(cid, int) or not str(cid).startswith("1"):
            return {}
        u = next((x for x in self.unit_db().get("ids", []) if x.get("id") == cid), None)
        if not u:
            return {}

        def name(s):
            ups = s.get("up") or {}
            return (ups[max(ups, key=int)] if ups else {}).get("name", "")

        out, tiers = {}, {}
        for s in sorted(u.get("skills") or [], key=lambda s: s["id"]):
            tiers.setdefault(s.get("tier"), []).append(s)
        for tier, ss in tiers.items():
            for i, s in enumerate(ss, 1):
                out[s["id"] - cid * 100] = {"slot": f"Skill {tier}" + (f".{i}" if len(ss) > 1 else ""), "name": name(s)}
        ds = u.get("defense") or []
        for i, s in enumerate(ds if isinstance(ds, list) else [ds], 1):
            out[s["id"] - cid * 100] = {"slot": "Defense" + (f" {i}" if len(ds) > 1 else ""), "name": name(s)}
        return out

    # ------------------------------------------------------------ Identity / E.G.O database, the user's team
    def unit_db(self) -> dict:
        """Identities and E.G.O of the latest snapshot, from the game's tables (rebuilt after every patch)."""
        from . import units
        sid = self.latest_snapshot_id()
        if not sid:
            return {"ids": [], "egos": []}
        cached = getattr(self, "_units", None)
        if cached and cached[0] == sid:
            return cached[1]
        rel = f"unit_db/{sid}.json.gz"
        db = self.store.read_json(rel)
        if db is None or db.get("v") != units.VERSION:
            loc = os.path.join(self.game.data or "", "Assets", "Resources_moved", "Localize", "en")
            db = units.build(self.static_tables(["personality", "skill", "ego", "personality-passive", "passive", "buff"]), loc)
            db["v"] = units.VERSION
            # pictures by file name: newer ones sit in episode subfolders (EgoCG_Ep7/…) or lack a CG thumbnail
            by_name: dict[str, list[str]] = {}
            for path in self.load_snapshot(sid)["assets"]:
                if path.startswith(units.ASSET + "Unit") and path.endswith(".png"):
                    by_name.setdefault(path.rsplit("/", 1)[-1], []).append(path)

            def find(name, folder):
                return next((q for q in by_name.get(name, []) if f"/{folder}/" in q or f"/{folder}" in q), None)
            for x in db["ids"]:
                i, img = x["id"], x["img"]
                img["thumb"] = (find(f"{i}_normal.png", "UnitCgThumbnail") or find(f"{i}_normal_profile.png", "Profile")
                                or find(f"{i}_normal.png", "Unit/CG") or img["thumb"])
                img["art"] = find(f"{i}_normal.png", "Unit/CG") or img["thumb"]
                img["art2"] = find(f"{i}_gacksung.png", "Unit/CG")
            # keyword icons live in Buf/<icon>.png; drop the ones the game doesn't ship
            buf = {p.rsplit("/", 1)[-1][:-4]: p for p in self.load_snapshot(sid)["assets"] if "/Buf/" in p and p.endswith(".png")}
            for g in db["glossary"].values():
                g["icon"] = buf.get(g["icon"]) or buf.get(g["name"].replace(" ", ""))
            for x in db["egos"]:
                i, img = x["id"], x["img"]
                img["art"] = find(f"{i}_cg.png", "EgoCG") or img["art"]
                img["art2"] = find(f"{i}_e_cg.png", "EgoCG")
                img["thumb"] = find(f"{i}_awaken_profile.png", "Profile/Ego") or img["art"]
            self.store.write_json(rel, db)
        db["seasons"] = self.seasons()
        self._units = (sid, db)
        return db

    def music(self) -> dict:
        """The game's soundtrack for the corner player (see music.build): official names, the bank sample of each
        track and where the battle themes play."""
        from . import content, music
        sid = self.latest_snapshot_id()
        if not sid:
            return {"tracks": []}
        cached = getattr(self, "_music", None)
        if cached and cached[0] == sid:
            return cached[1]
        rel = f"music/{sid}.json.gz"
        db = self.store.read_json(rel)
        if db is None or db.get("v") != music.VERSION:
            loc = os.path.join(self.game.data or "", "Assets", "Resources_moved", "Localize", "en")
            samples = [(name, ms, path, i) for path, rec in self.load_snapshot(sid)["files"].items()
                       if os.path.basename(path).lower().startswith("bgm") for i, (name, ms) in enumerate(rec.get("sounds") or [])]
            db = music.build(self.static_tables(["lobby-bgm", "abnormality-unit"] + content.STAGE_TABLES), loc, samples)
            db["v"] = music.VERSION
            self.store.write_json(rel, db)
        self._music = (sid, db)
        return db

    def quiz(self) -> dict:
        """Voice lines for Games -> Guess the Identity (see quiz.build)."""
        from . import quiz
        from .viewer import sound_index
        sid = self.latest_snapshot_id()
        if not sid:
            return {"ids": [], "bosses": [], "chars": []}
        cached = getattr(self, "_quiz", None)
        if cached and cached[0] == sid:
            return cached[1]
        rel = f"quiz/{sid}.json.gz"
        db = self.store.read_json(rel)
        if db is None or db.get("v") != quiz.VERSION:
            loc = os.path.join(self.game.data or "", "Assets", "Resources_moved", "Localize")
            story, portraits, path = {}, {}, self.ensure_browse()  # the story's own files: which voice file a line plays
            if path:
                con = sqlite3.connect(path)
                # a speaker's picture in the story's log: scenario-asset names the sprite of every model
                files = {name: c for c, name in con.execute(
                    "select c, name from o where type = 'Texture2D' and c like 'Assets/Resources_moved/Story/StoryPortrait/%'")}
                for data in (self.static_tables(["scenario-asset"]).get("scenario-asset") or {}).values():
                    for rows in data.values() if isinstance(data, dict) else []:
                        for m in rows if isinstance(rows, list) else []:
                            if isinstance(m, dict) and files.get(m.get("portraitSpritePath")):
                                portraits[str(m.get("name"))] = files[m["portraitSpritePath"]]
                for name, h in con.execute("select name, h from o where type = 'TextAsset' and c like 'Assets/Resources_moved/Story/Effect/%'"):
                    try:
                        story[name.upper()] = [r for r in json.loads(self.store.get_blob(h).decode("utf-8-sig")).get("dataList", []) if r.get("voice")]
                    except Exception:
                        continue
                con.close()
            db = quiz.build(loc, sound_index(self), {x["id"] for x in self.unit_db()["ids"]}, self.enemy_db()["list"], story, portraits)
            db["v"] = quiz.VERSION
            self.store.write_json(rel, db)
        self._quiz = (sid, db)
        return db

    def stage_db(self) -> dict:
        """The story map of the latest snapshot (see stages.build): chapters, their nodes on the map and the fights."""
        import re

        from . import stages
        sid = self.latest_snapshot_id()
        if not sid:
            return {"chapters": []}
        cached = getattr(self, "_stages", None)
        if cached and cached[0] == sid:
            return cached[1]
        rel = f"stage_db/{sid}.json.gz"
        db = self.store.read_json(rel)
        if db is None or db.get("v") != stages.VERSION:
            tiles: dict[str, dict[str, str]] = {}
            con = sqlite3.connect(self.ensure_browse())
            try:
                rows = con.execute("select distinct c from o where type = 'Texture2D' and c like '%/Sprite/StageMap/%'").fetchall()
            finally:
                con.close()
            for (c,) in rows:
                m = re.search(r"/StageMap/(\w+)/\1_(\d+)_(\d+)\.png$", c)
                if m:
                    tiles.setdefault(m.group(1), {})[f"{int(m.group(2))}_{int(m.group(3))}"] = c
            loc = os.path.join(self.game.data or "", "Assets", "Resources_moved", "Localize", "en")
            db = stages.build(self.static_tables(["part", "dungeonMap"] + list(stages.FIGHT_TABLES)), loc, tiles)
            db["v"] = stages.VERSION
            self.store.write_json(rel, db)
        self._stages = (sid, db)
        return db

    def mirror_db(self) -> dict:
        """The Mirror Dungeon planner's lists of the latest snapshot (see mirror.build): packs, gifts, fusions."""
        from . import mirror
        sid = self.latest_snapshot_id()
        if not sid:
            return {"packs": [], "gifts": {}, "fus": {}, "modes": {}}
        cached = getattr(self, "_mirror", None)
        if cached and cached[0] == sid:
            return cached[1]
        rel = f"mirror_db/{sid}.json.gz"
        db = self.store.read_json(rel)
        if db is None or db.get("v") != mirror.VERSION:
            gifts, cards = {}, {}
            con = sqlite3.connect(self.ensure_browse())
            try:
                for name, c in con.execute("select name, c from o where type = 'Texture2D' and c like '%/Sprite/EgoGiftIcon/%'"):
                    gifts.setdefault(name, c)
                for name, c in con.execute("select name, c from o where type = 'Texture2D' and c like '%/Everydungeon/card_pack/%'"):
                    cards.setdefault(name, c)
            finally:
                con.close()
            loc = os.path.join(self.game.data or "", "Assets", "Resources_moved", "Localize", "en")
            db = mirror.build(self.static_tables(["mirrordungeon-theme-floor", "mirror-dungeon-common-data", "ego-gift", "ego-gift-mirrordungeon",
                                                  "mirrordungeon"]), loc, gifts, cards)
            db["v"] = mirror.VERSION
            self.store.write_json(rel, db)
        self._mirror = (sid, db)
        return db

    def history_db(self) -> dict:
        """What each kept report changed in the cards (see history.build). Made anew when a report comes or goes."""
        from . import history
        reports = self.reports()
        stamp = [history.VERSION, self.latest_snapshot_id(), [r["id"] for r in reports]]
        cached = getattr(self, "_history", None)
        if cached and cached[0] == stamp:
            return cached[1]
        rel = "history/changes.json.gz"
        db = self.store.read_json(rel)
        if db is None or db.get("stamp") != stamp:
            icons = {}
            if self.ensure_browse():
                con = sqlite3.connect(self.ensure_browse())
                try:  # (newer skills' pictures sit in subfolders: SkillIcon/Ep10_3/151701.png)
                    for name, c in con.execute("select name, c from o where type = 'Texture2D' and c like '%/Sprite/SkillIcon/%'"):
                        icons.setdefault(name, c)
                finally:
                    con.close()
            db = history.build(reports, lambda rid: history.load_report(self.data_dir, rid), self.unit_db(), self.enemy_db(), icons)
            db["stamp"] = stamp
            self.store.write_json(rel, db)
        self._history = (stamp, db)
        return db

    def enemy_db(self) -> dict:
        """The enemy handbook of the latest snapshot (see enemies.build), with each entry's portrait path and
        whether the skill renderer has its battle prefab."""
        from . import content, enemies
        from .viewer import enemy_portraits
        sid = self.latest_snapshot_id()
        if not sid:
            return {"list": []}
        cached = getattr(self, "_enemies", None)
        if cached and cached[0] == sid:
            return cached[1]
        rel = f"enemy_db/{sid}.json.gz"
        db = self.store.read_json(rel)
        if db is None or db.get("v") != enemies.VERSION:
            loc = os.path.join(self.game.data or "", "Assets", "Resources_moved", "Localize", "en")
            db = enemies.build(self.static_tables(["enemy", "abnormality-unit", "abnormality-part", "skill", "passive"]
                                                  + content.STAGE_TABLES), loc)
            db["v"] = enemies.VERSION
            pics = enemy_portraits(self)
            battle = {x["app"] for x in self.battle_prefabs()}
            for e in db["list"]:
                keys = e.pop("portrait")
                e["pic"] = (e["app"] and pics.get(e["app"])) or next(
                    (pics["#pics"][str(k)] for k in keys if k is not None and str(k) in pics["#pics"]), "")
                if "/SkillIcon/" in e["pic"]:  # (a Versus pick falls back to a skill's icon: not a portrait)
                    e["pic"] = ""
                e["anim"] = e["app"] in battle
            self.store.write_json(rel, db)
        self._enemies = (sid, db)
        return db

    def ui_cache_dir(self) -> str:
        """Where the bits cut from the game's main build are kept: a new game build gets a new folder."""
        res = os.path.join(self.game.data or "", "resources.assets")
        stamp = str(int(os.path.getmtime(res))) if os.path.exists(res) else "none"
        return os.path.join(self.data_dir, "ui_icons", stamp)

    def seasons(self) -> dict:
        """{season id: {"name", "title", "color"}} as the game labels its Identities: "Season 7" / "Kumo no ito…" in
        the colour of the Identity screen's tag. 9100 stands for every Walpurgis Night (9101, 9102…)."""
        import json
        from .uiicons import season_colors
        colors = season_colors(self.game.data, self.ui_cache_dir())
        loc = {}
        try:
            path = os.path.join(self.game.data or "", "Assets", "Resources_moved", "Localize", "en", "EN_SeasonTitle.json")
            with open(path, encoding="utf-8-sig") as f:
                loc = {r["id"]: r.get("content") or "" for r in json.load(f).get("dataList") or []}
        except (OSError, ValueError, KeyError):
            pass
        out = {}
        for sid, color in colors.items():
            if sid == "9100":
                name, title = loc.get("season_9101_walpurgisnacht") or "Walpurgis Night", ""
            elif sid == "8000":
                name, title = "Collaboration", ""
            else:
                name, title = f"Season {sid}", loc.get(f"season_title_{sid}") or ""
            out[sid] = {"name": name, "title": title, "color": color}
        return out

    def my_team(self, data: dict | None = None) -> dict:
        path = os.path.join(self.data_dir, "teams", "my.json")
        if data is not None:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False)
            return data
        return self._load_json(path, {})

    # ------------------------------------------------------------ videos (game's own + the user's recordings)
    def videos_dir(self) -> str:
        p = os.path.join(self.data_dir, "videos")
        os.makedirs(p, exist_ok=True)
        return p

    def owner_videos(self, cid: int) -> list[dict]:
        """Videos rendered by the game itself (acquisition cinematics, skill previews) and the user's own recordings
        from data/videos whose file name matches this Identity / E.G.O."""
        import re
        out = []
        snap = self.load_snapshot(self.latest_snapshot_id())
        labels = {"PersonalityVideo": "Acquisition video", "EgoVideo": "E.G.O video", "SkillPreviewVideo": "Skill preview (in battle)"}
        for p, a in snap["assets"].items():
            if "VideoClip" not in a["types"] or not re.search(rf"/{cid}\.mp4$", p):
                continue
            folder = p.split("/")[-2]
            rows = self.lookup_container(p)
            v = next((r for r in rows if r["type"] == "VideoClip"), None)
            if v:
                out.append({"label": labels.get(folder, folder), "src": f"/api/object?bundle={v['bundle']}&pid={v['pid']}",
                            "kind": "game", "order": list(labels).index(folder) if folder in labels else 9})
        out.sort(key=lambda v: v["order"])
        out += self._local_videos(cid)
        return out

    def _local_videos(self, cid: int) -> list[dict]:
        """Match the user's recordings by file name: Identity title + Sinner name (+ "Skill 1a" → skill 1)."""
        import re
        from urllib.parse import quote
        nm = self.names()
        is_ego = str(cid).startswith("2")
        title = nm.ego_title(cid) if is_ego else nm.id_title(cid)
        sinner = nm.sinner_name(nm.sinner_of(cid))

        def words(s):
            s = s.lower().replace("ō", "o").replace("ū", "u")
            return [w for w in re.split(r"[^a-z0-9]+", s) if len(w) > 1 and w not in ("the", "of", "e", "g", "o")]

        tw, sw = set(words(title)), set(words(sinner))
        out = []
        for fn in sorted(os.listdir(self.videos_dir())):
            if not fn.lower().endswith((".mp4", ".webm", ".mov", ".gif")):
                continue
            fw = set(words(os.path.splitext(fn)[0]))
            if str(cid) in fn or (tw and tw <= fw and sw <= fw):
                m = re.search(r"skill[ _-]?(\d+)([a-z]?)", fn, re.I)
                label = f"Skill {m.group(1)}{m.group(2)}" if m else os.path.splitext(fn)[0]
                out.append({"label": f"{label} · your recording", "src": f"/api/local_video?name={quote(fn)}",
                            "kind": "local", "file": fn})
        return out

    def appearance_bundles(self, cid: int) -> list[str]:
        """Bundles holding the "<id>_…Appearance" prefab — early Identities keep it in shared bundles (sd_p3…)."""
        db_path = self.ensure_browse()
        if not db_path:
            return []
        cached = getattr(self, "_appear", None)
        if not cached or cached[0] != db_path:
            import re
            db = sqlite3.connect(db_path)
            m: dict[int, set] = {}
            for bundle, name in db.execute("select bundle, name from o where type='GameObject' and name like '%Appearance'"):
                mm = re.match(r"^(\d{5})_", name or "")
                if mm:
                    m.setdefault(int(mm.group(1)), set()).add(bundle)
            db.close()
            cached = self._appear = (db_path, m)
        return sorted(cached[1].get(cid, set()))

    def owner_clips(self, cid: int) -> list[dict]:
        """Battle animation clips of an Identity / E.G.O: own clips first (skills, then poses), then extras."""
        from .characters import owner_bundles
        from .clips import clip_kind, list_clips
        snap = self.load_snapshot(self.latest_snapshot_id())
        nm = self.names()
        out = []
        mine = owner_bundles(list(snap["bundles"]), cid)
        shared = [b for b in self.appearance_bundles(cid) if b not in mine]  # early IDs: sd_p3_assets_all, …
        # A story chapter's bundle can hold a copy of the character (10501: s8_a1c10p3_produce_assets_all, 327 MB, next
        # to its own 8 MB sd_p5_assets_all). Opening it takes 5 GB at its peak (2.5 GB once loaded), so such copies are
        # used only when the character has no bundle of its own with clips. A clip found again in a later bundle is not
        # listed twice, and each bundle's listing is kept on disk (per file version): a visit opens no bundle to list.
        bundles = [b for b in mine + shared if "_produce_" not in b]
        story = [b for b in mine + shared if "_produce_" in b]
        names_seen = set()

        def listing(path: str, what: str, make):
            st = os.stat(path)
            key = hashlib.sha1(f"{path}|{st.st_size}|{int(st.st_mtime)}|{what}".encode()).hexdigest()[:24]
            rel = f"clip_lists/{key}.json.gz"
            got = self.store.read_json(rel)
            if got is None:
                got = make()
                self.store.write_json(rel, got)
            return got

        slots = self.skill_slots(cid)

        def add_clips(bs):
            for b in bs:
                path = self.object_file(b)
                if not path:
                    continue
                for c in listing(path, "clips", lambda: list_clips(path)):
                    kind, n = clip_kind(c["name"])
                    own = c["animator"].startswith(str(cid))
                    if c["animator"].startswith(("CameraAction", "FX_", "Fx_")) or (b in shared and not own) or c["name"] in names_seen:
                        continue
                    names_seen.add(c["name"])
                    out.append({**c, "bundle": b, "kind": kind, "n": n, "own": own,
                                "label": nm.clip_label(cid, kind, n, c["name"], (slots.get(n) or {}).get("slot"))})

        add_clips(bundles)
        if not out and story:  # nothing of its own: the story copies are all there is
            bundles += story
            add_clips(story)
        # a few Identities play their skills through Timelines (…_S2_Timeline_1, …) instead of …_S2 clips
        from .clips import list_timelines
        from .extract import _env, _lock
        have = {c["n"] for c in out if c["kind"] == "skill"}
        own_names = [c["name"] for c in out if c["own"]]

        def timelines(path):
            env = _env(path)
            with _lock:
                tls = list_timelines({o.path_id: o for o in env.objects}, str(cid))
            for t in tls:
                t.pop("binds", None)
            return tls

        for b in bundles:
            path = self.object_file(b)
            if not path:
                continue
            tls = listing(path, f"timelines {cid}", lambda: timelines(path))
            for t in sorted(tls, key=lambda t: (t["skill"] or 99, t["part"])):
                if t["skill"] is not None and t["skill"] in have or t["name"] in names_seen:
                    continue
                # a shared bundle holds several Identities: keep timelines named like this one's clips
                stem = _re_split_stem(t["name"])
                if b in shared and not any(n.startswith(stem) for n in own_names):
                    continue
                names_seen.add(t["name"])
                part = f" · part {t['part'].replace('_', '.')}" if t["part"] else ""
                if t["skill"] is not None:
                    label = nm.clip_label(cid, "skill", t["skill"], t["name"], (slots.get(t["skill"]) or {}).get("slot")) + part
                    out.append({**t, "bundle": b, "kind": "skill", "n": t["skill"], "own": True, "label": label})
                else:
                    out.append({**t, "bundle": b, "kind": "other", "n": 90, "own": True, "label": "Parrying" + part})
        # E.G.O clips sit on the Sinner's corroded form, not on an animator named after the E.G.O
        if out and not any(c["own"] for c in out):
            for c in out:
                c["own"] = True
        # short labels: "Meursault_LeiHeng_Default_Off" → "Default Off", "Ryoshu_Nebulizer_Animator_Parrying" → "Parrying"
        import re as _re
        from collections import Counter
        from .clips import POSE_ORDER
        pose_re = _re.compile(r"(?i)(?:^|_)(" + "|".join(POSE_ORDER) + r")(?:_|$)")
        prefixes = Counter()
        for c in out:
            m = pose_re.search(c["name"]) if c["kind"] == "pose" else _re.search(r"_S\d+$", c["name"])
            if m:
                prefixes[c["name"][:m.start() + (1 if c["name"][m.start()] == "_" else 0)]] += 1
        prefix = prefixes.most_common(1)[0][0] if prefixes else ""
        for c in out:
            if c["kind"] == "skill" or c.get("timeline"):
                continue
            m = pose_re.search(c["name"]) if c["kind"] == "pose" else None
            if m:
                rest = c["name"][m.start(1):]
            elif prefix and c["name"].startswith(prefix):
                rest = c["name"][len(prefix):]
            else:
                rest = c["name"]
            c["label"] = rest.replace("_", " ").strip() or c["label"]
        order = {"skill": 0, "pose": 1, "other": 2}
        def slot_order(c):  # skills as the game lists them: 1, 2, 3.1, 3.2 … then Defense
            m = __import__("re").match(r"Skill (\d+)(?:\.(\d+))?", (slots.get(c["n"]) or {}).get("slot", "")) if c["kind"] == "skill" else None
            return int(m.group(1)) + int(m.group(2) or 0) / 10 if m else 50 + (c["n"] or 0) if c["n"] in slots else c["n"]
        out.sort(key=lambda c: (not c["own"], order[c["kind"]], slot_order(c), c["name"]))
        return out

    def real_path(self, rel: str) -> str | None:
        """Snapshot file path ("install/..." or "locallow/...") → path on disk."""
        g = self.game
        root, _, rest = rel.partition("/")
        base = {"install": g.game, "locallow": g.locallow}.get(root)
        if not base or not rest or ".." in rest.split("/"):
            return None
        p = os.path.join(base, *rest.split("/"))
        return p if os.path.isfile(p) else None

    def tree(self, prefix: str, sid: str | None = None):
        sid = sid or self.latest_snapshot_id()
        snap = self.load_snapshot(sid) if sid else None
        if not snap:
            return {"dirs": [], "files": []}
        prefix = prefix.strip("/")
        plen = len(prefix) + 1 if prefix else 0
        entries = [(p, {"types": a["types"], "bundle": a["bundle"]}) for p, a in snap["assets"].items()]
        entries += [(rel, {"types": ["file"], "size": f["size"], "blob": f.get("blob"), "h": f["h"]})
                    for rel, f in snap["files"].items()]
        dirs, files = {}, []
        for p, info in entries:
            if prefix and not p.startswith(prefix + "/"):
                continue
            rest = p[plen:]
            if "/" in rest:
                d = rest.split("/", 1)[0]
                dirs[d] = dirs.get(d, 0) + 1
            else:
                files.append({"path": p, **info})
        return {"dirs": sorted(dirs.items()), "files": sorted(files, key=lambda x: x["path"])[:3000],
                "total_files": len(files)}

    def lookup_container(self, path: str):
        db_path = self.ensure_browse()
        if not db_path:
            return []
        db = sqlite3.connect(db_path)
        db.row_factory = sqlite3.Row
        rows = [dict(r, pid=str(r["pid"])) for r in db.execute("select * from o where c = ?", (path,))]
        db.close()
        return rows

    def disk_usage(self):
        """Size of the data folder (cached for a minute: it has tens of thousands of files)."""
        cached = getattr(self, "_disk", None)
        if cached and time.time() - cached[0] < 60:
            return cached[1]
        total = 0
        stack = [self.data_dir]
        while stack:
            try:
                with os.scandir(stack.pop()) as it:
                    for e in it:
                        if e.is_dir(follow_symlinks=False):
                            stack.append(e.path)
                        else:
                            try:
                                total += e.stat(follow_symlinks=False).st_size
                            except OSError:
                                pass
            except OSError:
                pass
        self._disk = (time.time(), total)
        return total


__all__ = ["Service", "bundle_logical_name"]
