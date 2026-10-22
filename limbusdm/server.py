"""Local HTTP server for the UI (127.0.0.1 only)."""
from __future__ import annotations

import json
import mimetypes
import os
import re
import shutil
import subprocess
import threading
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from . import links
from .extra import file_of as extra_file
from .extract import extract
from .paths import resource_dir
from .service import Service

TOKEN_HEADER = "X-Limbus-Datamine"
# how long the window keeps a picture; then 304 while snapshot and app are the same (ETag)
KEEP = "max-age=3600"
# lists only a new snapshot changes: kept in memory after the first time
PER_SNAPSHOT = {"/api/battle_maps", "/api/bgm_tracks", "/api/game_pics", "/api/types", "/api/stages", "/api/gacha", "/api/mirror",
                "/api/game_voices", "/api/announcers", "/api/growth"}


def _etag(svc) -> str:
    from . import __version__
    return f'"{svc.latest_snapshot_id()}-{__version__}"'


def make_handler(svc: Service, ui_dir: str, on_show=None):
    class H(BaseHTTPRequestHandler):
        # keep-alive: no connection per picture
        protocol_version = "HTTP/1.1"
        timeout = 120  # an idle connection's thread ends by itself
        disable_nagle_algorithm = True
        _replied = False
        _memo = None  # the PER_SNAPSHOT request being answered: (snapshot, request)

        def log_message(self, *a):
            pass

        # ---------------------------------------------------------- helpers
        def _send(self, code: int, body: bytes, ctype: str, extra: dict | None = None):
            self._replied = True
            rng = self.headers.get("Range") if code == 200 and ctype.startswith(("video/", "audio/")) else None
            m = __import__("re").match(r"bytes=(\d*)-(\d*)", rng or "")
            if m and body:  # let <video> seek
                start = int(m.group(1)) if m.group(1) else max(0, len(body) - int(m.group(2) or 0))
                end = min(int(m.group(2)) if m.group(1) and m.group(2) else len(body) - 1, len(body) - 1)
                part = body[start:end + 1]
                self.send_response(206)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Range", f"bytes {start}-{end}/{len(body)}")
                self.send_header("Content-Length", str(len(part)))
                self.send_header("Accept-Ranges", "bytes")
                for k in ("ETag", "Cache-Control"):
                    if (extra or {}).get(k) and (extra or {}).get("ETag"):
                        self.send_header(k, extra[k])
                self.end_headers()
                self.wfile.write(part)
                return
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            if ctype.startswith(("video/", "audio/")):
                self.send_header("Accept-Ranges", "bytes")
            extra = dict(extra or {})
            # one Cache-Control only
            keep = extra.get("Cache-Control", "").startswith("max-age") and code == 200
            if keep:
                if not self.path.startswith("/api/thumb?"):  # (a thumbnail is named by its content: kept for the day)
                    extra["Cache-Control"] = KEEP
                extra["ETag"] = _etag(svc)
            elif "Cache-Control" not in extra:
                extra["Cache-Control"] = "no-store"
            for k, v in extra.items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(body)

        def _json(self, obj, code=200):
            body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
            if self._memo and code == 200:
                svc._answers = {**{k: v for k, v in getattr(svc, "_answers", {}).items() if k[0] == self._memo[0]}, self._memo: body}
            self._send(code, body, "application/json; charset=utf-8")

        def _gz_json_file(self, path, tag=None):
            """tag: the file name says what is in it (304 when unchanged)"""
            if not os.path.exists(path):
                return self._json({"error": "not found"}, 404)
            if tag and self.headers.get("If-None-Match") == tag:
                self._replied = True
                self.send_response(304)
                self.send_header("ETag", tag)
                self.send_header("Cache-Control", "no-cache")
                self.end_headers()
                return
            with open(path, "rb") as f:
                body = f.read()
            self._send(200, body, "application/json; charset=utf-8",
                       {"Content-Encoding": "gzip", **({"Cache-Control": "no-cache", "ETag": tag} if tag else {})})

        def _file(self, path, ctype=None, cache=False):
            if not path or not os.path.exists(path):
                return self._send(404, b"not found", "text/plain")
            with open(path, "rb") as f:
                body = f.read()
            ctype = ctype or mimetypes.guess_type(path)[0] or "application/octet-stream"
            self._send(200, body, ctype, {"Cache-Control": "max-age=86400"} if cache else None)

        def _file_live(self, path, ctype):
            """A file the app may make again: kept by the window, 304 unless rewritten."""
            if not path or not os.path.exists(path):
                return self._send(404, b"not found", "text/plain")
            st = os.stat(path)
            tag = f'"f{st.st_mtime_ns:x}-{st.st_size:x}"'
            if self.headers.get("If-None-Match") == tag:
                self._replied = True
                self.send_response(304)
                self.send_header("ETag", tag)
                self.send_header("Cache-Control", "no-cache")
                self.end_headers()
                return
            with open(path, "rb") as f:
                body = f.read()
            self._send(200, body, ctype, {"Cache-Control": "no-cache", "ETag": tag})

        def _keep(self) -> bool:
            """Keep made Spine files on disk (not for the site export)."""
            return not (self.headers.get("User-Agent") or "").startswith("Python-urllib")

        def _spine_file(self, p: str):
            """/spine/<bundle>/<atlas pid>/skeleton.json | skeleton.atlas | <page>.png"""
            from urllib.parse import unquote
            parts = [unquote(x) for x in p.split("/")[2:]]
            if len(parts) != 3:
                return self._send(404, b"", "text/plain")
            bundle, atlas_pid, fn = parts
            atlas_pid = atlas_pid.split(".")[0]  # "<pid>.<n>": n only busts the WebView's cache
            try:
                data, mime = spine_file(svc, bundle, int(atlas_pid), fn, self._keep())
            except FileNotFoundError as e:
                return self._send(404, str(e).encode(), "text/plain")
            return self._send(200, data, mime, {"Cache-Control": "max-age=3600"})

        def _asset_thumb(self, path: str):
            """Small preview of a catalog image: stored thumbnail, else rendered live."""
            rows = svc.lookup_container(path)
            if not rows and extra_file(path):  # (a picture the game no longer has, shipped with the app)
                import io
                from PIL import Image
                img = Image.open(extra_file(path))
                img.thumbnail((256, 256))
                buf = io.BytesIO()
                img.save(buf, "PNG")
                return self._send(200, buf.getvalue(), "image/png", {"Cache-Control": "max-age=86400"})
            for r in rows:
                if r["type"] == "Texture2D" and r.get("h") and svc.store.thumb_path(r["h"]):
                    return self._file(svc.store.thumb_path(r["h"]), "image/webp", cache=True)
            sprite = next((r for r in rows if r["type"] == "Sprite"), None)
            bundle_file = svc.object_file(sprite["bundle"]) if sprite else None
            if not bundle_file:
                return self._send(404, b"no preview", "text/plain")
            import io
            from PIL import Image
            data, _mime, _fn = extract(bundle_file, int(sprite["pid"]))
            img = Image.open(io.BytesIO(data))
            img.thumbnail((256, 256))
            buf = io.BytesIO()
            img.save(buf, "PNG")
            return self._send(200, buf.getvalue(), "image/png", {"Cache-Control": "max-age=86400"})

        def _sinner_icon(self, n: str):
            """The Sinner's shard emblem (icon_piece-501YiSang … 512Gregor) from the UI sprite bundle."""
            if not n.isdigit():
                return self._send(404, b"", "text/plain")
            cache = os.path.join(svc.data_dir, "ui_icons", "sinner", f"{int(n)}.png")
            if not os.path.exists(cache):
                import io
                import sqlite3
                from PIL import Image
                db_path = svc.ensure_browse()
                row = None
                if db_path:
                    con = sqlite3.connect(db_path)
                    row = con.execute("select bundle, pid from o where type = 'Sprite' and name like ? limit 1",
                                      (f"icon_piece-5{int(n):02d}%",)).fetchone()
                    con.close()
                path = svc.object_file(row[0]) if row else None
                if not path:
                    return self._send(404, b"no icon", "text/plain")
                img = Image.open(io.BytesIO(extract(path, int(row[1]))[0]))
                img.thumbnail((96, 96))
                os.makedirs(os.path.dirname(cache), exist_ok=True)
                img.save(cache, "PNG")
            return self._file(cache, "image/png", cache=True)

        def _asset_img(self, path: str):
            """Full-size picture of a catalog path, from the game cache."""
            rows = svc.lookup_container(path)
            if not rows and extra_file(path):
                return self._file(extra_file(path), "image/webp" if path.endswith(".webp") else "image/png", cache=True)
            r = next((x for x in rows if x["type"] == "Texture2D"), None) or next((x for x in rows if x["type"] == "Sprite"), None)
            bundle_file = svc.object_file(r["bundle"]) if r else None
            if not bundle_file:
                return self._send(404, b"no image", "text/plain")
            data, _mime, _fn = extract(bundle_file, int(r["pid"]))
            return self._send(200, data, "image/png", {"Cache-Control": "max-age=86400"})

        def _body(self):
            n = int(self.headers.get("Content-Length") or 0)
            return json.loads(self.rfile.read(n) or b"{}") if n else {}

        # ---------------------------------------------------------- routing
        def _run(self, fn):
            self._replied, self._memo = False, None
            try:
                fn()
            except Exception as e:
                vs = isinstance(e, ImportError) and re.search(r"versus_|viewer|battle_ui|\bstory\b|\bcollection\b|release build", str(e))  # (a copy without the private code)
                if not vs:
                    traceback.print_exc()
                self.close_connection = True  # (the answer may have been cut half-way)
                if not self._replied:
                    self._json({"error": "This comes with the release build only" if vs else f"{type(e).__name__}: {e}"},
                               404 if vs else 500)
            if not self._replied:  # nothing was answered: a kept connection would leave the page waiting
                self.close_connection = True

        def _ours(self) -> bool:
            """Whether the Host header is this server's own address."""
            host = (self.headers.get("Host") or "").lower()
            if host in (f"127.0.0.1:{self.server.server_address[1]}", f"localhost:{self.server.server_address[1]}"):
                return True
            self.close_connection = True
            self._json({"error": "forbidden"}, 403)
            return False

        def do_GET(self):
            if self._ours():
                self._run(self._get_kept)

        def do_POST(self):
            if not self._ours():
                return
            if self.headers.get(TOKEN_HEADER) != "1":  # blocks cross-site requests from web pages
                self.close_connection = True  # (its body is left unread)
                return self._json({"error": "forbidden"}, 403)
            self._run(self._post)

        def _get_kept(self):
            """Answer from what the window or memory already has."""
            tag = self.headers.get("If-None-Match")
            if tag and tag == _etag(svc):
                self._replied = True
                self.send_response(304)
                self.send_header("ETag", tag)
                self.send_header("Cache-Control", KEEP)
                self.end_headers()
                return
            if self.path in PER_SNAPSHOT:
                key = (svc.latest_snapshot_id(), self.path)
                body = getattr(svc, "_answers", {}).get(key)
                if body is not None:
                    return self._send(200, body, "application/json; charset=utf-8")
                self._memo = key
            self._get()

        def _get(self):
            u = urlparse(self.path)
            q = {k: v[0] for k, v in parse_qs(u.query).items()}
            p = u.path
            if p == "/" or p == "/index.html":
                return self._file(os.path.join(ui_dir, "index.html"), "text/html; charset=utf-8")
            m = re.match(r"^/ext/(\w+)\.js$", p)
            if m:  # an optional extension: only from the data folder (ext), none of it ships with the app
                f = os.path.join(svc.data_dir, "ext", m.group(1) + ".js")
                return self._file(f, "text/javascript; charset=utf-8") if os.path.exists(f) else self._send(404, b"", "text/plain")
            if p.startswith("/ui/"):
                full = os.path.normpath(os.path.join(ui_dir, p[4:]))
                if not full.startswith(os.path.normpath(ui_dir) + os.sep):
                    return self._send(403, b"", "text/plain")
                return self._file(full)
            if p == "/api/appnotes":  # app notes since the version seen last; all=1: the last releases
                from . import appnotes
                if q.get("all"):
                    return self._json(appnotes.history())
                return self._json(appnotes.pending(svc.data_dir))
            if p == "/api/skill_slots":  # how the game numbers an Identity's skill animations (Service.skill_slots)
                return self._json(svc.skill_slots(_fx_id(q["id"])))
            if p == "/api/patchnotes":  # a report's "what's new" (new=1: the newest one not shown yet, if any)
                from . import patchnotes
                rid = patchnotes.unseen(svc) if q.get("new") else q["id"]
                return self._json(patchnotes.notes(svc, rid) if rid else {"id": None})
            if p.startswith("/api/sprites"):  # Sprite workshop: a frames zip as a sheet to edit by hand (limbusdm/sprites.py)
                from . import sprites
                if p == "/api/sprites/png":  # (the address carries the file's time: a frame saved again is another address)
                    return self._send(200, sprites.png(svc, q["zip"], q["frame"], bool(q.get("orig")), int(q.get("size") or 0)),
                                      "image/png", {"Cache-Control": "max-age=86400"})
                return self._json(sprites.sheet(svc, q["zip"]) if q.get("zip") else {"zips": sprites.zips(svc)})
            if p == "/api/state":
                st = svc.state()
                st["disk"] = svc.disk_usage() if q.get("disk") else None
                return self._json(st)
            if p == "/api/report":
                if not re.fullmatch(r"[\w.-]+", q["id"]):
                    return self._send(404, b"", "text/plain")
                rep = svc.store.read_json(f"reports/{q['id']}.json.gz")
                if rep is None:
                    return self._send(404, b"", "text/plain")
                if q.get("site"):  # as the web copy keeps it: the player's own files out, only the files it holds
                    from . import site
                    rep = site.public(rep)
                return self._json(_report_links(rep, {k: bool(q.get(k)) for k in ("full_images", "video", "audio")} if q.get("site") else None))
            if p == "/api/scan":
                if not q.get("id"):
                    return self._json({"error": "no snapshot named"}, 404)
                return self._json(svc.scan(q["id"]))
            if p == "/api/thumb":
                return self._file(svc.store.thumb_path(q["h"]), "image/webp", cache=True)
            if p == "/api/blob":
                data = svc.store.get_blob(q["h"])
                if data is None:
                    return self._send(404, b"not found", "text/plain")
                return self._send(200, data, "text/plain; charset=utf-8")
            if p == "/api/object":
                path = svc.object_file(q["bundle"])
                if not path:
                    return self._json({"error": "bundle not in the game cache (older version?)"}, 404)
                data, mime, fn = extract(path, int(q["pid"]), q.get("fmt"))
                extra = {}
                if q.get("download"):
                    extra["Content-Disposition"] = f'attachment; filename="{fn}"'
                return self._send(200, data, mime, extra)
            if p in ("/api/bank", "/api/bank_list"):
                from .banks import export_wav, list_sounds
                path = svc.real_path(q["path"])
                if not path:
                    return self._json({"error": "file not found in the current install"}, 404)
                if p == "/api/bank_list":
                    return self._json(list_sounds(path))
                wav, fn = export_wav(path, int(q["i"]))
                extra = {"Content-Disposition": f'attachment; filename="{fn}"'} if q.get("download") else {}
                return self._send(200, wav, "audio/wav", extra)
            if p == "/api/characters":
                return self._json(_char_tiles(svc, _char_links(svc)))
            m = re.match(r"^/api/ext/(\w+)$", p)
            if m:  # the extension's own data (ext.py next to ext.js; any other: its own .py)
                f = os.path.join(svc.data_dir, "ext", "ext.py" if m.group(1) == "games" else m.group(1) + ".py")
                if not os.path.exists(f):
                    return self._json({"error": "no extension"}, 404)
                import importlib.util
                spec = importlib.util.spec_from_file_location("limbus_ext_" + m.group(1), f)
                mod = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(mod)
                return self._json(mod.handle(svc, q))
            if p == "/api/langs":  # the languages of the game's texts there are (limbusdm/langs.py)
                from . import langs
                return self._json(langs.listing(svc))
            if p == "/api/ui_lang":  # the interface's dictionary {English template: translation}
                from . import uilang
                return self._json(uilang.dictionary(svc, q.get("lang", "")))
            if p == "/api/ui_langs":
                from . import uilang
                have = uilang.available(svc)
                return self._json({"langs": have, "urls": {c: links.ui_lang(c) for c in have}})
            if p == "/api/ui_lang/status":
                from . import uilang
                return self._json(uilang.status(svc))
            if p == "/api/lang":  # one language's table "English text → its text" (g: core / story)
                from . import langs
                f = langs.table_file(svc, q.get("id", ""), q.get("g", "core"))
                return self._gz_json_file(f, f'"{os.path.basename(f)}"') if f else self._json({"error": "no such language"}, 404)
            if p == "/api/langfont":  # a language pack's own font (k: title / text)
                from . import langs
                f = langs.font_file(svc, q.get("id", ""), q.get("k", ""))
                if not f:
                    return self._send(404, b"no font", "text/plain")
                with open(f, "rb") as fh:
                    data = fh.read()
                return self._send(200, data, "font/otf" if data[:4] == b"OTTO" else "font/ttf", {"Cache-Control": "max-age=31536000"})
            if p == "/api/site_status":  # the web copy: the build the site shows next to this app's (Settings)
                from . import site
                return self._json(site.status(svc))
            if p == "/api/disk":
                return self._json({"bytes": svc.disk_usage()})
            if p == "/api/owner_videos":
                return self._json(svc.owner_videos(int(q["id"])))
            if p == "/api/local_video":
                name = os.path.basename(q["name"])
                full = os.path.join(svc.videos_dir(), name)
                ctype = "image/gif" if name.lower().endswith(".gif") else "video/webm" if name.lower().endswith(".webm") else "video/mp4"
                return self._file(full, ctype)
            if p == "/api/owner_clips":  # (+ a clip's links: as it is, with every layer)
                return self._json([{**c, "url": links.clip(c["bundle"], c["clip"], c["animator_go"]),
                                    "allUrl": links.clip(c["bundle"], c["clip"], c["animator_go"], 1)} for c in svc.owner_clips(int(q["id"]))])
            if p == "/api/fx":
                cid, v = _fx_id(q["id"]), _fx_variant(q)
                st = svc.fx.status(cid, v)
                return self._json({**st, "urls": {n: links.fx_video(cid, st.get("v") or "", n) for n in st["videos"]}})
            if p == "/api/preview_snap":  # the player's last picture, shown on the page while its window is hidden
                return self._send(200, getattr(svc, "_pv_snap", (0, b""))[1], "image/jpeg")
            if p == "/api/preview":  # the interactive skill player: its state; with ?id= the skills it plays
                return self._json({**svc.fx.preview_status(), **({"groups": svc.fx.preview_groups(_fx_id(q["id"]))} if q.get("id") else {})})
            if p == "/api/fx_buffs":  # the buff levels its renders can show, and which buff switches each effect on
                from .viewer import buff_levels
                from .buffs import unit_buffs
                # ("own": its buffs that have an effect, for the Buffs option: on itself / on the target)
                try:
                    own = [{"buff": x["buff"], "on": "target" if x["who"] else "self"} for x in unit_buffs(svc, _fx_id(q["id"]))]
                except Exception:
                    own = []
                return self._json({**buff_levels(svc, _fx_id(q["id"])), "own": own})
            if p == "/api/mods":
                from . import mods
                cid = _fx_id(q["id"])
                return self._json({"mods": mods.list_mods(svc, cid), "textures": [] if q.get("light") else mods.textures(svc, cid)})
            if p == "/api/skills":  # the videos a character's renders make (for the Versus page)
                from .viewer import is_clash, job_groups, make_job
                j = make_job(svc, _fx_id(q["id"]))
                return self._json({"skills": [g["name"] for g in job_groups(j) if not is_clash(g["name"])],
                                   "slots": svc.skill_slots(_fx_id(q["id"])),
                                   "clash": sum(1 for t in j["timelines"] if is_clash(t["name"]))})
            if p == "/api/versus":
                st = svc.fx.status(_fx_id(q["key"]))
                return self._json(st)
            if p == "/api/versus_plan":  # the fight engine's decisions only, for ui/versus_view.html (no render)
                from . import versus_engine as E
                from .viewer import burst_max, clash_base, kb_scale
                flag = lambda k: q.get(k) in ("1", "true")
                # (the clash base, with the Debug row's changes: only the switches the page sends)
                base = clash_base(dict({k: flag(k) for k in ("lskills", "rskills", "defend", "counter", "bursts") if k in q},
                                       mode="clash", **{k: q[k] for k in ("burstMax", "kbscale") if q.get(k)}))
                w = int(q.get("winner") or 0)
                if flag("team"):  # (a team fight: lefts / rights, comma-separated; see limbusdm/versus_team.py)
                    from . import versus_team as T
                    F, side, tags = T.team_fighters(svc, [_fx_id(x) for x in q["lefts"].split(",") if x],
                                                    [_fx_id(x) for x in q["rights"].split(",") if x], base,
                                                    q.get("lnames", "").split("|"), q.get("rnames", "").split("|"))
                    fight = T.simulate(F, side, tags, int(q.get("seed") or 0),
                                       dict(rounds=max(1, min(99, int(q.get("rounds") or 1))), defend=base["defend"],
                                            counter=base["counter"], kbscale=kb_scale(base), winner=None if w == 2 else w,
                                            pace=flag("pace") or "pace" not in q, lanes=int(q.get("lanes") or 1),
                                            allAtOnce=flag("allAtOnce"), flow=q.get("flow", ""), pairs=q.get("pairs", ""), randskill=True,
                                            **({"rules": json.loads(q["rules"])} if q.get("rules") else {})),
                                       places=T.start_places(svc, side.count(0), side.count(1)))
                    return self._json(T.to_json(F, fight))
                fa = E.fighter(svc, _fx_id(q["left"]), q.get("lname", ""), base["lskills"])
                fb = E.fighter(svc, _fx_id(q["right"]), q.get("rname", ""), base["rskills"])
                fight = E.simulate(fa, fb, int(q.get("seed") or 0),
                                   dict(rounds=max(1, min(99, int(q.get("rounds") or 1))), defend=base["defend"],
                                        counter=base["counter"], bursts=base["bursts"], burstMax=burst_max(base),
                                        kbscale=kb_scale(base), winner=None if w == 2 else w,
                                        flow="" if flag("pace") else "series", randskill=True))
                return self._json(E.to_json(fa, fb, fight))
            if p == "/api/versus_team_rules":  # the team rules the page may change, with their defaults
                from . import versus_team as T
                return self._json({"defaults": T.rule_defaults(), "limits": {k: v for k, v in T.RULE_LIMITS.items()}})
            if p == "/api/versus_tags":  # team fights: each one's tags (role, range skills), as guessed and set by hand
                from . import versus_team as T
                from .versus_engine import fighter
                over = T.tag_overrides(svc)
                return self._json({"over": over, "tags": {x: T.tags_of(svc, fighter(svc, _fx_id(x)), over)
                                                         for x in q.get("ids", "").split(",") if x}})
            if p == "/api/versus_list":
                return self._json(svc.fx.versus_list())
            if p == "/api/versus_live":
                return self._json(svc.fx.live_status())
            if p == "/api/bgm_tracks":
                from .viewer import bgm_label, bgm_tracks, sound_index
                # with the track's name and its corner-player number when known
                roots = {"install": svc.game.game, "locallow": svc.game.locallow}
                known = {}
                try:
                    for n, t in enumerate(svc.music()["tracks"]):
                        label, _, sub = t["bank"].partition("/")
                        known[(os.path.normcase(os.path.join(roots.get(label) or "", sub)), t["i"])] = (n, t)
                except Exception:
                    pass
                idx, out = sound_index(svc), []
                for name in bgm_tracks(svc):
                    path, i = idx[name]
                    n, t = known.get((os.path.normcase(path), i), (None, None))
                    out.append({"name": name, "label": bgm_label(name),
                                **({"title": t["name"], "where": t.get("where") or "", "n": n} if t else {})})
                return self._json(out)
            if p == "/api/stage_pics":  # which stages have a picture (Versus' stage list), and how many are being made
                return self._json(svc.fx.stage_pics())
            if p == "/api/fighter_pics":  # which Versus fighters have a picture of their idle pose, how many are being made
                return self._json(svc.fx.fighter_pics())
            if p == "/api/fighter_face":  # a fighter's face, cut from its idle picture (team fights' engine view)
                from .viewer import fighter_face
                return self._file(fighter_face(svc, str(_fx_id(q.get("id", "")))), "image/png")
            if p == "/api/fighter_pic":
                from .viewer import _safe_name, fighter_pic_dir
                return self._file(os.path.join(fighter_pic_dir(svc), _safe_name(str(_fx_id(q.get("id", "")))) + ".png"), "image/png")
            if p == "/api/stage_pic":
                from .viewer import stage_pic_dir
                name = q.get("name", "")
                if not re.fullmatch(r"[\w .~-]+", name) or ".." in name:
                    return self._send(404, b"", "text/plain")
                return self._file(os.path.join(stage_pic_dir(svc), name + ".jpg"), "image/jpeg")
            if p == "/api/game_arenas":  # Guess the arena: where each stage is from (limbusdm/gamedata.py)
                from .gamedata import arenas
                have = set(svc.fx.stage_pics().get("have") or [])
                return self._json([{**a, "tile": links.stage_pic(a["name"]) if a["name"] in have else ""} for a in arenas(svc)])
            if p == "/api/game_voices":  # Guess the sound: announcers' and E.G.O voice lines
                from .gamedata import voices
                return self._json(_voices_links(voices(svc), int(q.get("n") or 0)))
            if p == "/api/announcers":  # Announcers page (limbusdm/announcers.py)
                from . import announcers
                return self._json(_announcer_links(announcers.get(svc)))
            if p == "/api/growth":  # Upgrade calc page (limbusdm/growth.py)
                from . import growth
                return self._json(_growth_links(growth.get(svc)))
            if p == "/api/abno_logs":  # Abnormality logs page (limbusdm/abnologs.py)
                from . import abnologs
                return self._json(_abno_links(abnologs.get(svc)))
            if p == "/api/battle_maps":
                from .viewer import battle_maps
                return self._json([m["name"] for m in battle_maps(svc)])
            if p == "/api/frames":
                from .frames import character_frames, look_frames, part_frames
                if q.get("look"):  # another appearance of the Identity (Faust's "CastOff")
                    return self._json(look_frames(svc, _fx_id(q["id"]), q["look"]))
                out = character_frames(svc, _fx_id(q["id"]))
                if q.get("parts") and any(re.search(r"_l\d+_", f["name"]) for g in out["groups"] for f in g["frames"]):
                    from .frames import layer_marks  # frames drawn as layers: where each layer sits ("at": x, y, order)
                    marks = {}
                    for b in {f["bundle"] for g in out["groups"] for f in g["frames"]}:
                        marks.update(layer_marks(svc, b))
                    out = {"groups": [{**g, "frames": [{**f, "at": marks[f["pid"]]} if f["pid"] in marks else f for f in g["frames"]]} for g in out["groups"]]}
                # parts=1: units drawn as GameObjects of parts get composed frames
                return self._json(part_frames(svc, _fx_id(q["id"])) if q.get("parts") and not out["groups"] else out)
            if p == "/api/frame_png":  # a game frame (bundle + pid) or a mod's replacement (id + name + file)
                import io as _io
                from . import frames, mods
                if q.get("file"):
                    f = os.path.join(mods.mod_dir(svc, _fx_id(q["id"]), q["name"]), "frames", os.path.basename(q["file"]))
                    with open(f, "rb") as fh:
                        return self._send(200, fh.read(), "image/png", {"Cache-Control": "no-store"})
                b = _io.BytesIO()
                if "v" in q or "bundle" not in q:  # (a part frame; parse_qs drops an empty v)
                    frames.part_png(svc, _fx_id(q["id"]), q["pid"], q.get("v", "")).save(b, "PNG")
                else:
                    rec = {"bundle": q["bundle"], "pid": q["pid"], "w": int(q["w"]), "h": int(q["h"])}
                    frames.frame_png(svc, rec).save(b, "PNG")
                return self._send(200, b.getvalue(), "image/png", {"Cache-Control": "max-age=86400"})
            if p == "/api/skill_timeline":  # what happens when in a skill's video (Edit mod → Timing)
                from .viewer import skill_timeline
                try:
                    return self._json(skill_timeline(svc, _fx_id(q["id"]), q["group"]))
                except KeyError:
                    return self._json({"error": "no such skill"}, 404)
            if p == "/api/fx_still":  # one picture of a rendered effect
                from .viewer import effect_still
                f = effect_still(svc, _fx_id(q["id"]), q["name"], _fx_variant(q))
                if not f:
                    return self._json({"error": "not rendered"}, 404)
                with open(f, "rb") as fh:
                    return self._send(200, fh.read(), "image/png", {"Cache-Control": "max-age=3600"})
            if p == "/api/mods_owned":  # the characters that have a mod (the Animations list's "Mine")
                from . import mods
                return self._json(mods.owned(svc))
            if p == "/api/mod_vfx_frame":  # frame i of a mod's replacement of an effect (the editor's preview)
                from . import mods
                f = mods.vfx_frame_file(svc, _fx_id(q["id"]), q["name"], q["effect"], int(q.get("i", 0)))
                if not f:
                    return self._json({"error": "no such frame"}, 404)
                with open(f, "rb") as fh:
                    return self._send(200, fh.read(), "image/png", {"Cache-Control": "no-store"})
            if p == "/api/mod_texture":
                from . import mods
                f = mods.texture_file(svc, _fx_id(q["id"]), q["name"], q["tex"])
                if not f:
                    return self._json({"error": "not replaced"}, 404)
                with open(f, "rb") as fh:
                    return self._send(200, fh.read(), "image/png", {"Cache-Control": "no-store"})
            if p == "/api/fx_video":
                full = svc.fx.video(_fx_id(q["id"]), q["name"], _fx_variant(q))
                return self._file(full, "video/webm" if full.endswith(".webm") else "video/mp4") if full else self._json({"error": "not rendered"}, 404)
            if p in ("/api/clip", "/api/clip_gif"):
                from .clips import clip_gif, render_any
                path = svc.object_file(q["bundle"])
                if not path:
                    return self._json({"error": "bundle not in the game cache"}, 404)
                all_layers = q.get("all") == "1"
                if p == "/api/clip":
                    r = render_any(path, q["clip"], int(q["go"]), all_layers, q["bundle"], svc.resolver())
                    r.pop("_objs", None)
                    r["sprites"] = {k: {**s, "url": links.obj(s["bundle"], s["pid"])} for k, s in (r.get("sprites") or {}).items()}
                    return self._json(r)
                gif = clip_gif(path, q["clip"], int(q["go"]), all_layers, 1.0, q["bundle"], svc.resolver())
                return self._send(200, gif, "image/gif")
            if p == "/api/spine_list":
                return self._json(svc.spine_list())
            if p in ("/api/spine_scene", "/api/scene_sprite"):
                from .scene import art_scenes, full_sprite
                path = svc.object_file(q["bundle"])
                if not path:
                    return self._json({"error": "bundle not in the game cache"}, 404)
                if p == "/api/scene_sprite":
                    return self._send(200, full_sprite(path, int(q["pid"])), "image/png", {"Cache-Control": "max-age=86400"})

                def scene():
                    scenes = art_scenes(path)
                    found = scenes.get(int(q["atlas"]))
                    if not found and scenes:
                        # the illustration may use another cut of the skeleton
                        base = next((x["base"] for x in svc.spine_list() if x["bundle"] == q["bundle"] and x["atlas"] == q["atlas"]), None)
                        cuts = {x["atlas"]: x["base"] for x in svc.spine_list() if x["bundle"] == q["bundle"]}
                        found = next((sc for a, sc in scenes.items() if base and cuts.get(str(a), "").startswith(base)), None)
                    return json.dumps(found or {}, ensure_ascii=False).encode("utf-8")
                from .spine import cached
                data = _scene_links(cached(svc.data_dir, path, f"scene/{int(q['atlas'])}", scene, self._keep()), q["bundle"])
                return self._send(200, data, "application/json; charset=utf-8")
            if p.startswith("/spine/"):
                return self._spine_file(p)
            if p == "/api/asset_thumb":
                return self._asset_thumb(q["path"])
            if p == "/api/char_icon":  # a Versus pick: an Identity's / E.G.O's profile picture, an enemy's portrait
                import re as _re
                cid = q.get("id", "")
                cid = str(svc.form_owner(cid) or cid)  # (a second form: its Identity's)
                base = "Assets/Resources_moved/Sprite/Unit/"
                if _re.fullmatch(r"1\d{4}|4\d{5}", cid):  # (4000xx: Sinnerlings)
                    path = f"{base}Profile/Normal/{cid}_normal_profile.png"
                elif _re.fullmatch(r"2\d{4}", cid):
                    path = f"{base}Profile/Ego/{cid}_awaken_profile.png"
                else:
                    drawn = os.path.join(_thumb_dir(svc), _safe(cid) + ".png")  # the handbook's battle-look picture
                    if cid and os.path.exists(drawn):
                        return self._file_live(drawn, "image/png")
                    from .viewer import enemy_portrait
                    path = enemy_portrait(svc, cid)
                if path and cid.isdigit() and not svc.lookup_container(path):  # no profile picture (the first Identities): its list picture
                    db = svc.unit_db()
                    u = next((x for x in db.get("ids", []) + db.get("egos", []) if str(x["id"]) == cid), None)
                    path = ((u or {}).get("img") or {}).get("thumb") or path
                return self._asset_thumb(path) if path else self._send(404, b"", "text/plain")
            if p == "/api/browse":
                return self._json(svc.browse_query(q.get("q", ""), q.get("type", ""), int(q.get("limit", 300))))
            if p == "/api/types":
                return self._json(svc.browse_types())
            if p == "/api/tree":
                return self._json(svc.tree(q.get("prefix", "")))
            if p == "/api/container":
                return self._json([{**r, "url": links.obj(r["bundle"], r["pid"], r.get("type"))} for r in svc.lookup_container(q["path"])])
            if p == "/api/marks":
                return self._json(svc.marks)
            if p == "/api/units":
                return self._json(_unit_links(svc))
            if p == "/api/ui_icons":  # the interface's icons and fonts (the site keeps them with the Identities)
                from .uiicons import FONTS, ICONS
                return self._json({"icons": [links.ui_icon(k) for k in [*ICONS, *(f"sinner_{n}" for n in range(1, 13))]],
                                   "fonts": [links.font(n) for n in FONTS]})
            if p == "/api/community":  # live streams of the game, a list made on GitHub
                from . import community
                return self._json(community.streams())
            if p == "/api/community_rec":  # the recommended channels as the owner wrote them (Settings)
                from . import community
                return self._json(community.recommended())
            if p == "/api/bilibili":  # the game's videos on Bilibili (the Community page's tab)
                from . import bilibili
                return self._json(bilibili.videos(q.get("period", "week"), q.get("sort", "views"), svc.translator))
            if p == "/api/quiz":  # voice lines for Games -> Guess the Identity
                return self._json(_quiz_links(_quiz_twins(svc, svc.quiz())))
            if p == "/api/game_pics":  # pictures of the Games: the jukebox covers (the track's card), the story's
                # story backgrounds by Canto (paths from the folder on)
                import re as _re
                base, story = "Assets/Resources_moved/Story/Backgrounds/", {}
                for r in svc.browse_query("Story/Backgrounds", "Sprite", 5000):
                    m = _re.match(r"E[pP](\d+)(?:_[123])?/[^/]+$", (r["c"] or "")[len(base):]) if (r["c"] or "").startswith(base) else None
                    if m:
                        story.setdefault(m.group(1), []).append(r["c"][len(base):])
                # (a background: its Canto, small and full-size picture, by path)
                scenes = sorted((rel, int(n)) for n, rels in story.items() for rel in set(rels))
                return self._json({"track": sorted(r["c"] for r in svc.browse_query("bgmCover", "Sprite", 500) if "/bgmCover_" in (r["c"] or "")),
                                   "scenes": [{"key": rel, "canto": n, "thumb": links.thumb(base + rel), "img": links.img(base + rel)} for rel, n in scenes]})
            if p == "/api/game_cards":  # the pictures on the cards of the Games page
                return self._json(game_cards(svc, int(q.get("n", 12))))
            if p == "/api/sounds":  # Database → Sounds (limbusdm/soundlib.py): all folders, one folder's sounds, a search
                from . import soundlib
                db = svc.sound_lib()
                if q.get("q"):
                    return self._json(soundlib.search(db, q["q"], path=json.loads(q["path"]) if q.get("path") else None))
                if q.get("path"):
                    node = soundlib.find(db, json.loads(q["path"]))
                    return self._json({"items": soundlib.items(db, node) if node else [], "pics": (node or {}).get("pics") or {}})
                return self._json({**soundlib.outline(db["tree"]), "note": "" if db["tree"].get("n") else getattr(svc, "_bank_note", "")})
            if p == "/api/story":  # Database → Story (story.py, private repo): chapters, episodes, Sinners' Identity stories
                from . import story
                lang = q.get("lang", "en")
                return self._json(_story_index_links(story.index(svc, lang if lang in story.LANGS else "en")))
            if p == "/api/story_ep":  # one story file as scenes
                from . import story
                lang = q.get("lang", "en")
                ep = story.episode_of(svc, q.get("id", ""), lang if lang in story.LANGS else "en")
                return self._json(_story_ep_links(ep)) if ep else self._json({"error": "no such story"}, 404)
            if p == "/api/story_kit":  # Story workshop's catalog: people, backgrounds, pictures, music of the stories
                from . import story
                return self._json(_story_kit_links(story.kit(svc)))
            if p == "/api/collection_refs":  # Collection: what screenshots of the game's lists are compared with
                from . import collection
                return self._json(collection.refs(svc))
            if p == "/api/story_lines":  # the line search: every line in English as [story, line, speaker, text]
                return self._send(200, _story_lines(svc), "application/json; charset=utf-8")
            if p == "/api/story_model":  # a layered standing picture: where its body and faces sit
                from . import story
                lay = story.model_layout(svc, q.get("path", "")) if q.get("path", "").startswith("Assets/Resources_moved/Story/StandingModel/") else None
                if not lay:
                    return self._json({"error": "no such model"}, 404)
                return self._json({**lay, "layers": [dict(x, url=links.story_sprite(lay["bundle"], x["s"])) if x["n"] != "pivot" else x for x in lay["layers"]]})
            if p == "/api/story_sprite":  # one sprite of such a model
                from . import story
                png = story.sprite_png(svc, q.get("b", ""), int(q.get("p", "0")))
                if png is None:
                    return self._send(404, b"no picture", "text/plain")
                return self._send(200, png, "image/webp", {"Cache-Control": "max-age=86400"})
            if p == "/api/stage_node_pic":  # a Story map node's card picture
                from . import stages
                png = stages.node_pic(svc, int(q.get("id", "0") or 0))
                if png is None:
                    return self._send(404, b"no picture", "text/plain")
                return self._send(200, png, "image/webp", {"Cache-Control": "max-age=86400"})
            if p == "/api/ui_sprite":  # one of the game's interface sprites by name (the reader's buttons)
                from . import story
                png = story.ui_sprite(svc, q.get("n", ""))
                if png is None:
                    return self._send(404, b"no picture", "text/plain")
                return self._send(200, png, "image/webp", {"Cache-Control": "max-age=86400"})
            if p == "/api/story_pic":  # a story picture as a kept, smaller WebP (the reader's and the Story map's)
                from . import pictures
                path = q.get("path", "")
                png = pictures.picture(svc, path, int(q.get("m", "1920"))) if path.startswith(pictures.ROOTS) else None
                if png is None:
                    return self._send(404, b"no picture", "text/plain")
                return self._send(200, png, "image/webp", {"Cache-Control": "max-age=86400"})
            if p == "/api/story_audio":  # a story's voice / effect / music as a kept Ogg Opus
                from . import story
                got = story.audio(svc, q.get("s", ""))
                if got is None:
                    return self._send(404, b"no such sound", "text/plain")
                return self._send(200, got[0], got[1], {"Cache-Control": "max-age=86400"})
            if p == "/api/story_video":  # a story's video (Story/Video/<name>.mp4)
                from . import story
                found = story.assets(svc)["video"].get(q.get("name", "").lower())
                rows = svc.lookup_container(found) if found else []
                r = next((x for x in rows if x["type"] == "VideoClip"), None)
                bundle_file = svc.object_file(r["bundle"]) if r else None
                if not bundle_file:
                    return self._send(404, b"no video", "text/plain")
                data, mime, _fn = extract(bundle_file, int(r["pid"]))
                return self._send(200, data, mime, {"Cache-Control": "max-age=86400"})
            if p == "/api/quiz_audio":  # one voice line by its sample's name
                from .banks import export_wav
                from .viewer import sound_index
                hit = sound_index(svc).get(q.get("s", "").lower())
                if not hit:
                    return self._json({"error": "no such line"}, 404)
                return self._send(200, export_wav(*hit)[0], "audio/wav", {"Cache-Control": "max-age=86400"})
            if p == "/api/mirror":  # Tools → Mirror Dungeon planner: theme packs, their gifts, fusions
                return self._json(_mirror_links(svc.mirror_db()))
            if p == "/api/mirror/catalog":  # Versus → Mirror (limbusdm/versus_mirror2.py): gifts, packs, kits, rules
                from . import versus_mirror2 as M2
                return self._json(M2.page_catalog(svc))
            if p == "/api/history":  # Patches → Change history: what the kept reports changed in each card
                return self._json(_history_links(svc, {k: v for k, v in svc.history_db().items() if k != "stamp"}))
            if p == "/api/gacha":  # Games → Extraction: the game's banners, pools, lines and sounds
                from . import gacha
                return self._json(_gacha_links(gacha.build(svc)))
            if p == "/api/gacha_ui":  # one picture of the extraction's screens, cut from the game's main build
                from . import gacha
                got = gacha.ui_png(q.get("n", ""), svc.game.data, svc.ui_cache_dir())
                if got is None:
                    return self._send(404, b"no picture", "text/plain")
                return self._send(200, got[0], got[1], {"Cache-Control": "max-age=86400"})
            if p == "/api/news":  # the developers' update notices from Steam, tied to the archive's patches
                from . import news
                return self._json(news.patches(svc, bool(q.get("force"))))
            if p == "/api/music":  # the corner player's track list
                return self._json([{**{k: v for k, v in t.items() if k not in ("bank", "i")}, "url": links.music_audio(n)} for n, t in enumerate(svc.music()["tracks"])])
            if p == "/api/music_audio":
                from . import music
                tracks = svc.music()["tracks"]
                n = int(q["n"])
                if not 0 <= n < len(tracks):
                    return self._json({"error": "no such track"}, 404)
                return self._file(*music.audio_file(svc, tracks[n]))
            if p == "/api/buffs":  # the buffs with an effect of their own, and which videos are made
                st = svc.buff_fx.status()
                if q.get("status"):
                    return self._json(st)
                lst = [{**b, "iconUrl": links.thumb(b.get("icon") or ""), "who": [{**w, "picUrl": links.thumb(w.get("pic") or ""),
                        "appUrl": links.enemy_thumb(w.get("app") or "")} for w in b.get("who") or []]} for b in svc.buff_fx.db()["list"]]
                return self._json({"list": lst, **st, "alike": svc.buff_fx.alike()})
            if p == "/api/buff_video":
                full = svc.buff_fx.video(q.get("name", ""))
                return self._file_live(full, "video/webm") if full else self._json({"error": "not rendered"}, 404)
            if p == "/api/stages":  # the story map: chapters, nodes, fights (+ what its ids are in the other lists)
                from .viewer import battle_maps
                db = svc.stage_db()
                want = set(db.get("units") or [])
                entry = {i: e["id"] for e in svc.enemy_db()["list"] for v in e["variants"] for i in v["ids"] if i in want}
                try:
                    tracks = svc.music().get("events") or {}
                except Exception:
                    tracks = {}  # (no sound banks read: the themes are listed by their event names)
                from . import stages
                pics = stages.node_pic_ids(svc)
                return self._json({"chapters": [_stage_links(c, pics) for c in db["chapters"]], "tile": db.get("tile") or 2048, "units": entry, "tracks": tracks,
                                   "maps": [m["name"] for m in battle_maps(svc)], "assist": db.get("assist") or {},
                                   "announcers": db.get("announcers") or {}, "sinners": db.get("sinners") or []})
            if p == "/api/enemies":  # the handbook's list; an entry's skill and passive texts come with /api/enemy
                db = svc.enemy_db()
                # Spine enemies: the page's idle-pose picture; sprite ones: the portrait
                done = {fn[:-4] for fn in os.listdir(_thumb_dir(svc))} if os.path.isdir(_thumb_dir(svc)) else set()
                spines = svc.enemy_spines()
                making = _drawn_thumbs(svc, db["list"], spines, done)
                # looks whose picture repeats an earlier one
                from .twins import repeats, sparse
                looks = [a for a in dict.fromkeys(e["app"] for e in db["list"]) if a in done]
                files = [os.path.join(_thumb_dir(svc), a + ".png") for a in looks]
                twins = [looks[i] for i in dict.fromkeys(list(repeats(files)) + sparse(files))]  # (+ pictures with next to nothing drawn)
                return self._json({**{k: v for k, v in db.items() if k not in ("skills", "passives", "list")},
                                   "list": [_enemy_entry(e, bool(spines.get(e["app"])), e["app"] in done) for e in db["list"]],
                                   "thumbs": sorted({e["app"] for e in db["list"]} & done), "twins": twins, "nothumb": _no_thumbs(svc),
                                   "making": making})
            if p == "/api/enemy_thumb":
                path = os.path.join(_thumb_dir(svc), _safe(q.get("app", "")) + ".png")
                return self._file_live(path, "image/png") if os.path.exists(path) else self._send(404, b"", "text/plain")
            if p == "/api/enemy_look":  # the idle pose of any battle look, for the Animations list's picture
                look = _idle_look(svc.enemy_spines().get(q.get("app", "")) or [])
                return self._json({"look": look and {**look, "files": links.spine(look["bundle"], look["atlas"])}})
            if p == "/api/enemy":
                db = svc.enemy_db()
                e = next((x for x in db["list"] if str(x["id"]) == q.get("id")), None)
                if not e:
                    return self._send(404, b"", "text/plain")
                bodies = [b for v in e["variants"] for b in [v] + v["parts"]]
                sk = {s for b in bodies for s in b["skills"] + b.get("defense", [])}
                pa = {x for b in bodies for x in b["passives"]}
                spine = svc.enemy_spines().get(e["app"]) or []
                look = _idle_look(spine)
                # (the cache turns the ids into strings)
                return self._json({"spine": spine, "look": look and {**look, "files": links.spine(look["bundle"], look["atlas"])},
                                   "skills": {s: _skill_links(svc, db["skills"].get(s) or db["skills"].get(str(s)), s, e.get("pic")) for s in sk},
                                   "passives": {x: db["passives"].get(x) or db["passives"].get(str(x)) for x in pa}})
            if p == "/api/myteam":
                return self._json(svc.my_team())
            if p == "/api/asset_img":
                return self._asset_img(q["path"])
            if p == "/api/ui_icon" and q.get("k", "").startswith("sinner_"):
                return self._sinner_icon(q["k"][7:])
            if p == "/api/font":  # one of the game's own UI fonts, read from the install
                from .uiicons import font_file
                data = font_file(q.get("name", ""), svc.game.data, svc.ui_cache_dir())
                if data is None:
                    return self._send(404, b"no font", "text/plain")
                return self._send(200, data, "font/otf" if data[:4] == b"OTTO" else "font/ttf", {"Cache-Control": "max-age=86400"})
            if p == "/api/ui_icon":
                from .uiicons import icon_png
                png = icon_png(q.get("k", ""), svc.game.data, svc.ui_cache_dir())
                if png is None:
                    return self._send(404, b"no icon", "text/plain")
                return self._send(200, png, "image/webp" if png[8:12] == b"WEBP" else "image/png", {"Cache-Control": "max-age=86400"})
            return self._send(404, b"not found", "text/plain")

        def _post(self):
            p = urlparse(self.path).path
            b = self._body()
            if p == "/api/appnotes_seen":
                from . import appnotes
                appnotes.mark_seen(svc.data_dir)
                return self._json({"ok": True})
            if p == "/api/enemy_thumb":  # the page's picture of an enemy's Spine idle pose (PNG data URL), for the grid
                import base64
                import io
                from PIL import Image
                app = _safe(b.get("app", ""))
                if not any(e["app"] == app for e in svc.enemy_db()["list"]) and app not in svc.enemy_spines():
                    return self._json({"error": "unknown"}, 404)
                if b.get("none"):  # nothing to take a picture of: not tried again at every start
                    return self._json({"ok": True, "nothumb": _no_thumbs(svc, app)})
                img = Image.open(io.BytesIO(base64.b64decode(b["data"].split(",", 1)[-1]))).convert("RGBA")
                img.thumbnail((256, 256))
                os.makedirs(_thumb_dir(svc), exist_ok=True)
                img.save(os.path.join(_thumb_dir(svc), app + ".png"), "PNG")
                return self._json({"ok": True, "url": links.enemy_thumb(app)})
            if p == "/api/fighter_pics":  # make pictures of these fighters' idle pose (the player, in the background)
                return self._json(svc.fx.fighter_pics([str(_fx_id(n)) for n in b.get("ids") or []]))
            if p == "/api/stage_pics":  # make pictures of these stages (the player, in the background)
                return self._json(svc.fx.stage_pics([str(n) for n in b.get("names") or []]))
            if p == "/api/patchnotes_seen":
                from . import patchnotes
                patchnotes.mark_seen(svc, b["id"])
                return self._json({"ok": True})
            if p.startswith("/api/sprites"):
                from . import sprites
                if p == "/api/sprites/add":
                    return self._json({"name": sprites.add(svc, b["name"], b["data"])})
                if p == "/api/sprites/put":
                    sprites.put(svc, b["zip"], b["frame"], b["png"])
                    return self._json({"ok": True})
                if p == "/api/sprites/reset":
                    return self._json({"count": sprites.reset(svc, b["zip"], b.get("frame") or "")})
                if p == "/api/sprites/open":
                    sprites.open_file(svc, b["zip"], b["frame"])
                    return self._json({"ok": True})
                if p == "/api/sprites/pack":
                    return self._json(sprites.pack(svc, b["zip"]))
                if p == "/api/sprites/load":
                    return self._json({"count": sprites.load(svc, b["zip"], _fx_id(b["id"]), b["mod"])})
                return self._json({"error": "not found"}, 404)
            if p == "/api/snapshot":
                svc.start_snapshot(auto_report=b.get("report", True))
                return self._json({"ok": True})
            if p == "/api/report":
                svc.start_report(b["old"], b["new"])
                return self._json({"ok": True})
            if p == "/api/site_publish":  # the web copy (limbusdm/site.py): this report + the database, written and uploaded
                from . import site
                base = f"http://127.0.0.1:{self.server.server_address[1]}"
                svc._run_job("site", lambda progress: site.publish(svc, base, b.get("id"), progress))
                return self._json({"ok": True})
            if p == "/api/site_move":  # the web copy's files into another folder (limbusdm/site.py move)
                from . import site
                svc._run_job("sitemove", lambda progress: site.move(svc, str(b.get("dir") or ""), progress))
                return self._json({"ok": True})
            if p == "/api/site_fx":  # the web copy: render the skills the site has no videos of (limbusdm/sitefx.py)
                from . import sitefx
                if b.get("stop"):
                    sitefx.stop()
                else:
                    base = f"http://127.0.0.1:{self.server.server_address[1]}"
                    svc._run_job("sitefx", lambda progress: sitefx.render_all(svc, base, progress))
                return self._json({"ok": True})
            if p == "/api/cancel":
                svc.cancel()
                return self._json({"ok": True})
            if p == "/api/update_check":
                return self._json(svc.update_check(force=bool(b.get("force"))))
            if p == "/api/update_install":
                svc.start_update()
                return self._json({"ok": True})
            if p == "/api/check":
                return self._json({"state": svc.check_version(start=True)})
            if p == "/api/community_rec":
                from . import community
                return self._json(community.save_recommended(b.get("lines") or []))
            if p.startswith("/api/ui_lang/"):  # interface translation (limbusdm/uilang.py); only where the web copy is set up
                from . import uilang
                if not os.path.exists(os.path.join(svc.data_dir, "site_config.json")):
                    return self._json({"error": "not here"}, 403)
                lang = str(b.get("lang") or "")
                if p == "/api/ui_lang/export":
                    try:
                        path = uilang.export_csv(svc, lang)
                    except ValueError as e:
                        return self._json({"error": str(e)}, 400)
                    subprocess.Popen(["explorer", "/select,", path])
                    return self._json({"path": path})
                if p == "/api/ui_lang/import":
                    try:
                        return self._json(uilang.import_csv(svc, lang, str(b.get("text") or "")))
                    except ValueError as e:
                        return self._json({"error": str(e)}, 400)
                return self._json({"error": "not found"}, 404)
            if p == "/api/settings":
                svc.save_settings(b)
                return self._json(svc.settings)
            if p == "/api/translate":
                from .translate import RateLimited
                try:
                    return self._json({"result": svc.translator.translate(b.get("texts", []))})
                except RateLimited as e:
                    return self._json({"error": str(e)}, 429)
            if p == "/api/mark":
                svc.set_mark(b["key"], b.get("mark"))
                return self._json({"ok": True})
            if p == "/api/export":
                return self._json(export_object(svc, b))
            if p == "/api/open":
                target = os.path.normpath(b.get("path") or os.path.join(svc.data_dir, "exports"))
                if os.path.isfile(target):
                    subprocess.Popen(["explorer", "/select,", target])
                else:
                    os.makedirs(target, exist_ok=True)
                    subprocess.Popen(["explorer", target])
                return self._json({"ok": True})
            if p == "/api/myteam":
                return self._json(svc.my_team(b))
            if p == "/api/buffs":  # make these effects' videos (none named: all), a picked buff's first
                svc.buff_fx.start(b.get("names"), bool(b.get("first")))
                return self._json(svc.buff_fx.status())
            if p == "/api/fx":
                kind = b.get("kind") if b.get("kind") in ("skill", "aura", "battle") else ""
                svc.fx.start(_fx_id(b["id"]), b.get("names"), _fx_variant(b), kind)
                return self._json(svc.fx.status(_fx_id(b["id"]), _fx_variant(b)))
            if p == "/api/mod":
                from . import mods
                cid = _fx_id(b["id"])
                if b.get("delete"):
                    mods.delete(svc, cid, b["name"])
                    return self._json({"mods": mods.list_mods(svc, cid)})
                mods.save(svc, cid, b["name"], b)
                return self._json({"mods": mods.list_mods(svc, cid)})
            if p == "/api/mirror/act":  # Versus → Mirror: one action on the run
                from . import versus_mirror2 as M2
                try:
                    return self._json(M2.act(svc, b.get("run"), b["act"], b.get("arg")))
                except KeyError as e:  # (something in the page's run the catalog doesn't have)
                    return self._json({"error": f"this run has something the game data doesn't know ({e}) — start a new run"}, 400)
                except (ValueError, StopIteration) as e:
                    return self._json({"error": str(e) or "that can't be done now"}, 400)
                except Exception as e:  # (a bug: the page gets the traceback for its Debug report)
                    import traceback
                    return self._json({"error": f"{type(e).__name__}: {e}", "trace": traceback.format_exc()}, 500)
            if p == "/api/mirror/debug":  # Versus → Mirror → Debug: run code / load / report (versus_debugkit)
                from . import versus_debugkit as debugkit
                try:
                    return self._json(debugkit.page_call(svc, b))
                except (ValueError, KeyError) as e:
                    return self._json({"error": str(e) or "that can't be done"}, 400)
            if p == "/api/versus":
                spec = {k: b.get(k) for k in ("left", "right", "skill", "mode", "rounds", "winner", "rskill")}
                spec.update({k: b[k] for k in ("map", "speed", "pause", "rspeed", "rpause", "lskills", "rskills", "defend", "counter",
                                        "bursts", "burstMax", "seed", "hitstop", "trim", "clean", "spread", "numbers",
                                        "slowmo", "dash", "music", "hp", "death", "intro", "ego", "lname", "rname",
                                        "bars", "uisfx", "pace", "ramp", "throw", "punch", "fade", "loop", "flash", "randskill", "kbscale", "camFollow", "deck", "notes", "fast",
                                        "buff", "buffboth", "buffmany", "buffown", "buffshort",
                                        "debuff", "debuffboth", "debuffmany", "debuffown", "debuffshort") if b.get(k) is not None})
                if b.get("mirror"):  # (Versus → Mirror: the run's boss fight, the engine's MirrorFight; see versus_job)
                    spec.update(mirror=b["mirror"], left=b["mirror"]["id"], right=b["mirror"]["boss"])
                spec["left"], spec["right"] = _fx_id(spec["left"]), _fx_id(spec["right"])
                if b.get("team"):  # (a team fight: the line-ups as comma-joined ids; versus_job -> versus_team_job)
                    spec.update(team=True, **{k: b[k] for k in ("lefts", "rights", "flow", "lanes", "allAtOnce", "bossPower", "rules", "pairs", "lnames", "rnames") if b.get(k)})
                if b.get("live"):  # (the Versus Live tab: played in the player's window, nothing saved)
                    return self._json(svc.fx.start_live(spec))
                return self._json({"key": svc.fx.start_versus(spec)})
            if p == "/api/versus_tags":  # {"id", "unit": [roles] or null, "skills": {group: "range" | "melee"}}: set by hand
                from . import versus_team as T
                over = T.tag_overrides(svc)
                cid = str(_fx_id(b["id"]))
                o = {k: b[k] for k in ("unit", "skills") if b.get(k)}
                if o:
                    over[cid] = o
                else:
                    over.pop(cid, None)
                T.save_tag_overrides(svc, over)
                return self._json({"over": over})
            if p == "/api/preview":  # {id, v} starts the player (set up once; the same one again is left as it is), {stop: 1} closes it
                if b.get("stop"):
                    svc.fx.preview_stop()
                    return self._json(svc.fx.preview_status())
                return self._json(svc.fx.preview_start(_fx_id(b["id"]), _fx_variant(b), svc.app_handle()))
            if p == "/api/preview_cmd":  # one command for the player (viewer.Renderer.preview_cmd)
                svc.fx.preview_cmd(b)
                return self._json(svc.fx.preview_status())
            if p == "/api/preview_rect":  # the stage box in the app window's pixels: the player's window is laid over it ({show: false}: hidden)
                return self._json({"ok": True, **(svc.preview_place(b) or {})})
            if p == "/api/versus_live_stop":
                svc.fx.stop_live()
                return self._json(svc.fx.live_status())
            if p == "/api/mod_frame":
                import base64
                from . import mods
                cid = _fx_id(b["id"])
                data = base64.b64decode(b["png"].split(",", 1)[-1]) if b.get("png") else None
                scope = b.get("scope") or ""
                if data and data[:2] == b"PK":
                    n = mods.put_frames_zip(svc, cid, b["name"], data, scope)
                    return self._json({"mods": mods.list_mods(svc, cid), "count": n})
                src = b.get("from")
                mods.put_frame(svc, cid, b["name"], b["sprite"], data, scope,
                               {"cid": _fx_id(src["cid"]), "sprite": src["sprite"]} if src else None)
                return self._json({"mods": mods.list_mods(svc, cid), "count": 1})
            if p == "/api/mod_vfx":
                import base64
                from . import mods
                cid = _fx_id(b["id"])
                data = base64.b64decode(b["file"].split(",", 1)[-1]) if b.get("file") else None
                src = b.get("from")
                try:
                    mods.put_vfx(svc, cid, b["name"], b["effect"], data, b.get("filename") or "", b.get("params"),
                                 {"cid": _fx_id(src["cid"]), "effect": src["effect"]} if src else None, bool(b.get("remove")))
                except (ValueError, OSError, RuntimeError) as e:
                    return self._json({"error": str(e)}, 400)
                return self._json({"mods": mods.list_mods(svc, cid)})
            if p == "/api/mod_texture":
                import base64
                from . import mods
                cid = _fx_id(b["id"])
                png = base64.b64decode(b["png"].split(",", 1)[-1]) if b.get("png") else None
                size = (int(b["w"]), int(b["h"])) if b.get("w") and b.get("h") else None
                if mods.load(svc, cid, b["name"]) is None:
                    mods.save(svc, cid, b["name"], {})
                mods.put_texture(svc, cid, b["name"], b["tex"], png, size)
                return self._json({"mods": mods.list_mods(svc, cid)})
            if p == "/api/show":
                if on_show:
                    on_show(str(b.get("open") or ""))
                return self._json({"ok": True})
            return self._json({"error": "unknown"}, 404)

    return H


def spine_file(svc: Service, bundle: str, atlas_pid: int, fn: str, keep: bool = True) -> tuple[bytes, str]:
    """skeleton.json / .atlas / page PNG of a Spine skeleton by path id; kept on disk."""
    from .spine import cached
    path = svc.object_file(bundle)
    if not path:
        raise FileNotFoundError("bundle not in the game cache")
    mime = {"skeleton.atlas": "text/plain; charset=utf-8", "skeleton.json": "application/json"}.get(fn, "image/png")
    return cached(svc.data_dir, path, f"{atlas_pid}/{fn}", lambda: _spine_make(svc, bundle, path, atlas_pid, fn), keep), mime


def _spine_make(svc: Service, bundle: str, path: str, atlas_pid: int, fn: str) -> bytes:
    from .extract import _env, _lock
    from .spine import fit_page, page_sizes, spine_map
    entry = spine_map(path).get(atlas_pid) or {}
    pid = None
    if fn == "skeleton.atlas":
        pid = atlas_pid
    elif fn == "skeleton.json":
        pid = entry.get("skel")
        if pid is None:  # not linked by a SkeletonDataAsset: fall back to the same base name
            base = svc.find_object_by_pid(bundle, str(atlas_pid))
            o = svc.find_object(bundle, "TextAsset", (base or {}).get("name", "")[:-6])
            pid = int(o["pid"]) if o else None
    else:
        pid = entry.get("pages", {}).get(fn)
        if pid is None:
            o = svc.find_object(bundle, "Texture2D", fn.rsplit(".", 1)[0])
            if o is None:  # the texture sits in another bundle (cross-bundle material reference)
                o = svc.find_object_anywhere("Texture2D", fn.rsplit(".", 1)[0], near=bundle)
                if o:
                    path = svc.object_file(o["bundle"]) or path
            pid = int(o["pid"]) if o else None
    if pid is None:
        raise FileNotFoundError("not found")
    if fn in ("skeleton.atlas", "skeleton.json"):
        return extract(path, int(pid))[0]
    # (the page straight from the texture: not to PNG and back before it is fitted)
    env = _env(path)
    obj = next((o for o in env.objects if o.path_id == int(pid)), None)
    if obj is None:
        raise FileNotFoundError("not found")
    with _lock:
        im = obj.read().image
    text = spine_file(svc, bundle, atlas_pid, "skeleton.atlas")[0].decode("utf-8", "replace")
    return fit_page(im, page_sizes(text).get(fn))


def spine_zip(svc: Service, bundle: str, atlas_pid: int, base: str) -> bytes:
    """The skeleton as files Spine tools open: <base>.json, <base>.atlas and the page images."""
    import io
    import zipfile
    from .spine import atlas_pages
    atlas, _m = spine_file(svc, bundle, atlas_pid, "skeleton.atlas")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(f"{base}.json", spine_file(svc, bundle, atlas_pid, "skeleton.json")[0])
        z.writestr(f"{base}.atlas", atlas)
        for page in atlas_pages(atlas.decode("utf-8", "replace")):
            z.writestr(page, spine_file(svc, bundle, atlas_pid, page)[0])
    return buf.getvalue()


def frames_gif(frames: list[str], fps: float) -> bytes:
    """PNG data URLs → GIF cropped to what is visible."""
    import base64
    import io
    from PIL import Image
    from .clips import _save_gif
    imgs = [Image.open(io.BytesIO(base64.b64decode(f.split(",", 1)[-1]))).convert("RGBA") for f in frames]
    if not imgs:
        raise ValueError("no frames")
    boxes = [b for b in (im.getchannel("A").point(lambda v: 255 if v >= 128 else 0).getbbox() for im in imgs) if b]
    if boxes:
        box = (max(0, min(b[0] for b in boxes) - 2), max(0, min(b[1] for b in boxes) - 2),
               min(imgs[0].width, max(b[2] for b in boxes) + 2), min(imgs[0].height, max(b[3] for b in boxes) + 2))
        imgs = [im.crop(box) for im in imgs]
    ms = 1000 / (fps or 25)
    durations = [int(round((i + 1) * ms)) - int(round(i * ms)) for i in range(len(imgs))]
    return _save_gif(imgs, durations)


# Games page card pictures, three a game (Vlad's pick): a game path or "enemy:<appearance>"
CARD_PRESET = {
    "track": ["Assets/Resources_moved/UIConfigs/LobbyBGM/Banner/bgmCover_24_3.png", "Assets/Resources_moved/UIConfigs/LobbyBGM/Banner/bgmCover_14_1.png",
              "Assets/Resources_moved/UIConfigs/LobbyBGM/Banner/bgmCover_24_1.png"],
    "id": ["Assets/Resources_moved/Sprite/UnitCgThumbnail/Default/10504_normal.png", "Assets/Resources_moved/Sprite/UnitCgThumbnail/Default/10405_normal.png",
           "Assets/Resources_moved/Sprite/UnitCgThumbnail/Default/10916_normal.png"],
    "char": ["Assets/Resources_moved/Story/StoryPortrait/StoryLog_YiSang.png", "Assets/Resources_moved/Story/StoryPortrait/StoryLog_Lion.png",
             "Assets/Resources_moved/Story/StoryPortrait/Ep8_1/StoryLog_WangDaeIn.png"],
    "skill": ["Assets/Resources_moved/Sprite/SkillIcon/1091603.png", "Assets/Resources_moved/Sprite/SkillIcon/1071403.png",
              "Assets/Resources_moved/Sprite/SkillIcon/1091505.png"],
    "enemy": ["enemy:90217_Thumb_mob_1Appearance", "enemy:1496_B2_Needle_KingAppearance", "enemy:8103_QueequegAppearance"],
    "canto": ["Assets/Resources_moved/Story/Backgrounds/Ep6_1/story_mansion drawing room.png",
              "Assets/Resources_moved/Story/Backgrounds/Ep6_2/story_catherine_sleep_2.png", "Assets/Resources_moved/Story/Backgrounds/Ep3/story_sinclair_foreststreet.png"],
    "wordle": ["Assets/Resources_moved/Sprite/UnitCgThumbnail/Default/10707_normal.png", "Assets/Resources_moved/Sprite/Unit/Profile/Normal/10416_normal_profile.png",
               "Assets/Resources_moved/Sprite/UnitCgThumbnail/Default/11110_normal.png"],
    "conn": ["Assets/Resources_moved/Sprite/UnitCgThumbnail/Default/10109_normal.png", "Assets/Resources_moved/Sprite/UnitCgThumbnail/Default/10412_normal.png",
             "Assets/Resources_moved/Sprite/UnitCgThumbnail/Default/10302_normal.png"],
    "splash": ["Assets/Resources_moved/Sprite/UnitCgThumbnail/Default/10411_normal.png", "Assets/Resources_moved/Sprite/Unit/Profile/Ego/20205_awaken_profile.png",
               "Assets/Resources_moved/Sprite/UnitCgThumbnail/Default/10908_normal.png"],
    "atlas": ["Assets/Resources_moved/Sprite/UnitCgThumbnail/Default/10105_normal.png", "Assets/Resources_moved/Sprite/UnitCgThumbnail/Default/10612_normal.png",
              "Assets/Resources_moved/Sprite/UnitCgThumbnail/Default/10212_normal.png"],
    "odd": ["Assets/Resources_moved/Sprite/UnitCgThumbnail/Default/10106_normal.png", "Assets/Resources_moved/Sprite/UnitCgThumbnail/Default/10306_normal.png",
            "Assets/Resources_moved/Sprite/UnitCgThumbnail/Default/10713_normal.png"],
    "gacha": ["Assets/Resources_moved/Sprite/UnitCgThumbnail/Default/10513_normal.png", "Assets/Resources_moved/Sprite/UnitCgThumbnail/Default/10214_normal.png",
              "Assets/Resources_moved/Sprite/UnitCgThumbnail/Default/11012_normal.png"],
    "dare": ["Assets/Resources_moved/Sprite/UnitCgThumbnail/Default/10801_normal.png", "Assets/Resources_moved/Sprite/UnitCgThumbnail/Default/10401_normal.png",
             "Assets/Resources_moved/Sprite/UnitCgThumbnail/Default/10701_normal.png"],
    "grid": ["Assets/Resources_moved/Sprite/UnitCgThumbnail/Default/10211_normal.png", "Assets/Resources_moved/Sprite/UnitCgThumbnail/Default/10810_normal.png",
             "Assets/Resources_moved/Sprite/UnitCgThumbnail/Default/10605_normal.png"],
    "mix": ["Assets/Resources_moved/UIConfigs/LobbyBGM/Banner/bgmCover_14_1.png", "Assets/Resources_moved/UIConfigs/LobbyBGM/Banner/bgmCover_24_1.png",
            "Assets/Resources_moved/UIConfigs/LobbyBGM/Banner/bgmCover_24_3.png"],
    "buff": ["Assets/Resources_moved/Sprite/UnitCgThumbnail/Default/10415_normal.png", "Assets/Resources_moved/Sprite/UnitCgThumbnail/Default/10513_normal.png",
             "Assets/Resources_moved/Sprite/UnitCgThumbnail/Default/10214_normal.png"],
    "chain": ["Assets/Resources_moved/Sprite/UnitCgThumbnail/Default/10106_normal.png", "Assets/Resources_moved/Sprite/UnitCgThumbnail/Default/10206_normal.png",
              "Assets/Resources_moved/Sprite/UnitCgThumbnail/Default/10906_normal.png"],
    "jig": ["Assets/Resources_moved/Sprite/UnitCgThumbnail/Default/10310_normal.png", "Assets/Resources_moved/Sprite/UnitCgThumbnail/Default/11208_normal.png",
            "Assets/Resources_moved/Sprite/UnitCgThumbnail/Default/10609_normal.png"],
    "when": ["Assets/Resources_moved/Sprite/UnitCgThumbnail/Default/10102_normal.png", "Assets/Resources_moved/Sprite/UnitCgThumbnail/Default/10708_normal.png", "Assets/Resources_moved/Sprite/UnitCgThumbnail/Default/11111_normal.png"],
    "diff": ["Assets/Resources_moved/Sprite/UnitCgThumbnail/Default/10905_normal.png", "Assets/Resources_moved/Sprite/UnitCgThumbnail/Default/10307_normal.png", "Assets/Resources_moved/Sprite/UnitCgThumbnail/Default/11003_normal.png"],
    "who": ["Assets/Resources_moved/Sprite/UnitCgThumbnail/Default/10203_normal.png", "Assets/Resources_moved/Sprite/UnitCgThumbnail/Default/10804_normal.png", "Assets/Resources_moved/Sprite/UnitCgThumbnail/Default/11205_normal.png"],
    "arena": ["stage:Casino1F", "stage:Ab_FireMoth", "stage:DAreaStreet_A"],
    "singingmachine": ["Assets/Resources_moved/Sprite/Unit/Profile/Ego/21009_awaken_profile.png", "Assets/Resources_moved/Sprite/Unit/EgoCG/21009_cg.png",
                       "Assets/Resources_moved/Sprite/Unit/Profile/Ego/21009_erosion_profile.png"],
    "slice": ["Assets/Resources_moved/Sprite/UnitCgThumbnail/Default/10401_normal.png", "Assets/Resources_moved/Story/StoryPortrait/Ep9_2/StoryLog_MiddleFather.png",
              "Assets/Resources_moved/Story/StoryPortrait/Ep9_1/StoryLog_PinkyFather.png"],
    "surv": ["Assets/Resources_moved/Sprite/UnitCgThumbnail/Default/10101_normal.png", "Assets/Resources_moved/Sprite/UnitCgThumbnail/Default/10201_normal.png",
             "Assets/Resources_moved/Sprite/UnitCgThumbnail/Default/10301_normal.png"],
    "hilo": ["Assets/Resources_moved/Sprite/UnitCgThumbnail/Default/10404_normal.png", "Assets/Resources_moved/Sprite/UnitCgThumbnail/Default/11006_normal.png", "Assets/Resources_moved/Sprite/UnitCgThumbnail/Default/10712_normal.png"],
    "passive": ["Assets/Resources_moved/Sprite/UnitCgThumbnail/Default/10508_normal.png", "Assets/Resources_moved/Sprite/UnitCgThumbnail/Default/10813_normal.png", "Assets/Resources_moved/Sprite/UnitCgThumbnail/Default/11103_normal.png"],
    "ego": ["Assets/Resources_moved/Sprite/Unit/Profile/Ego/20104_awaken_profile.png", "Assets/Resources_moved/Sprite/Unit/Profile/Ego/20202_awaken_profile.png", "Assets/Resources_moved/Sprite/Unit/Profile/Ego/20305_awaken_profile.png"],
    "sound": ["Assets/Resources_moved/Sprite/Unit/Profile/Ego/20102_awaken_profile.png", "Assets/Resources_moved/Sprite/Unit/Profile/Ego/20106_awaken_profile.png", "Assets/Resources_moved/Sprite/Unit/Profile/Ego/20203_awaken_profile.png"],
    "memory": ["Assets/Resources_moved/Sprite/UnitCgThumbnail/Default/10109_normal.png", "Assets/Resources_moved/Sprite/UnitCgThumbnail/Default/10611_normal.png", "Assets/Resources_moved/Sprite/UnitCgThumbnail/Default/11207_normal.png"],
}


def game_cards(svc: Service, n: int = 12) -> dict:
    """{game: [picture requests]} for the Games page cards: the preset, else random picks ("hub=1" for the site)."""
    import random
    from urllib.parse import quote
    sid = svc.latest_snapshot_id()
    if not sid:
        return {}
    fixed = {g: ["/api/enemy_thumb?app=" + quote(p[6:], safe="") + "&hub=1" if p.startswith("enemy:")
                 else "/api/stage_pic?name=" + quote(p[6:], safe="") + "&hub=1" if p.startswith("stage:") else "/api/asset_thumb?path=" + quote(p, safe="") + "&hub=1"
                 for p in ps] for g, ps in CARD_PRESET.items()}
    if set(fixed) >= {"track", "id", "skill", "char", "canto", "wordle", "conn", "enemy"}:  # (every card of today: no lists to read)
        return fixed
    pools = getattr(svc, "_card_pools", None)
    if not pools or pools[0] != sid:
        found: dict[str, list] = {}

        def pool(game, make):
            try:
                found[game] = sorted(set(make()))
            except Exception:
                traceback.print_exc()
        ids = lambda: svc.unit_db().get("ids") or []  # noqa: E731
        pool("track", lambda: [r["c"] for r in svc.browse_query("bgmCover", "Sprite", 500) if "/bgmCover_" in (r["c"] or "")])
        pool("id", lambda: [x["img"]["thumb"] for x in ids() if (x.get("img") or {}).get("thumb")])
        pool("skill", lambda: [f"Assets/Resources_moved/Sprite/SkillIcon/{s.get('icon') or s['id']}.png"
                               for x in ids() for s in x.get("skills") or []])
        pool("char", lambda: [c["pic"] for c in svc.quiz().get("chars") or [] if c.get("pic")])
        pool("canto", lambda: [r["c"] for r in svc.browse_query("Story/Backgrounds", "Sprite", 5000)
                               if re.match(r"Assets/Resources_moved/Story/Backgrounds/E[pP]\d+(?:_[123])?/[^/]+$", r["c"] or "")])
        pools = svc._card_pools = (sid, found)
    found = pools[1]

    def some(game):
        ps = found.get(game) or []
        return ["/api/asset_thumb?path=" + quote(p, safe="") + "&hub=1" for p in random.sample(ps, min(n, len(ps)))]
    out = {g: some(g) for g in found}
    for g in ("wordle", "conn"):  # the Identities' games: faces too, other ones on each card
        out[g] = some("id")
    try:  # enemies by the page's idle-pose pictures
        done = {fn[:-4] for fn in os.listdir(_thumb_dir(svc))} if os.path.isdir(_thumb_dir(svc)) else set()
        apps = sorted({e["app"] for e in svc.enemy_db()["list"] if e.get("app")} & done)
        out["enemy"] = ["/api/enemy_thumb?app=" + quote(a, safe="") + "&hub=1" for a in random.sample(apps, min(n, len(apps)))]
    except Exception:
        traceback.print_exc()
    out.update(fixed)
    return out


def _spine_links(x: dict) -> dict:
    """A Spine skeleton with its files and its illustration's layers."""
    return {**x, "files": links.spine(x["bundle"], x["atlas"]), "scene": links.spine_scene(x["bundle"], x["atlas"])}


def _char_links(svc) -> dict:
    """The Animations list with links: a skeleton's `files` / `scene`, an Identity's / E.G.O's `clips`; a skeleton drawn for
    an enemy names it (`of`: its picture in the list)."""
    ch, spines = svc.characters(), svc.enemy_spines()
    was = getattr(svc, "_chars_linked", None)
    if was and was[0] is ch and was[1] is spines:
        return was[2]
    of = {(x["bundle"], str(x["atlas"])): app for app, xs in spines.items() for x in xs}

    def item(x):
        if not x.get("app") and (x["bundle"], str(x.get("atlas"))) in of:
            x = {**x, "of": of[(x["bundle"], str(x.get("atlas")))]}
        return _spine_links(x) if x.get("atlas") else x

    def unit(c):
        return {**c, "spine": [_spine_links(x) for x in c["spine"]], "clips": links.owner_clips(c["id"])}
    groups = [{**g, "kinds": {k: [dict(item(x)) for x in arr] for k, arr in g["kinds"].items()}} for g in ch.get("groups", [])]
    # a battle look's Spine goes into its entry (tabs), not a row of its own
    looks = {x["app"]: x for g in groups for arr in g["kinds"].values() for x in arr if x.get("app")}
    for g in groups:
        for k, arr in g["kinds"].items():
            keep = []
            for x in arr:
                if not x.get("app") and x.get("of") in looks:
                    looks[x["of"]].setdefault("spine", []).append(x)
                else:
                    keep.append(x)
            g["kinds"][k] = keep
        g["kinds"] = {k: arr for k, arr in g["kinds"].items() if arr}
    out = {**ch, "sinners": [{**s, **{k: [unit(c) for c in s.get(k) or []] for k in ("ids", "egos", "events")},
                              "spine": [_spine_links(x) for x in s.get("spine") or []]} for s in ch.get("sinners", [])],
           "groups": [g for g in groups if g["kinds"]]}
    svc._chars_linked = (ch, spines, out)
    return out


def _idle_look(spine: list) -> dict | None:
    """A look's idle skeleton: not a death one."""
    return next((x for x in spine if not re.search(r"destroy|dead|broken|_die", x["base"], re.I)), spine[0] if spine else None)


def _char_tiles(svc, out: dict) -> dict:
    """The list's enemy pictures as they are now: the drawn idle pose, else the handbook portrait; `draw`: a pose the page
    can still take."""
    d = _thumb_dir(svc)
    done = {f[:-4] for f in os.listdir(d) if f.endswith(".png")} if os.path.isdir(d) else set()
    pics, spines, none = {}, svc.enemy_spines(), set(_no_thumbs(svc))
    for e in svc.enemy_db()["list"]:
        if e.get("pic"):
            pics.setdefault(e["app"], e["pic"])

    def tile(x):
        a = x.get("app") or x.get("of")
        if not a:
            return x
        if _safe(a) in done:
            return {**x, "tile": links.enemy_thumb(a)}
        return {**x, **({"tile": links.thumb(pics[a])} if a in pics else {}), **({"draw": a} if spines.get(a) and a not in none else {})}
    return {**out, "groups": [{**g, "kinds": {k: [tile(x) for x in arr] for k, arr in g["kinds"].items()}} for g in out.get("groups", [])]}


def _scene_links(data: bytes, bundle: str) -> bytes:
    """An illustration's layers with links: a skeleton's `files`, a picture's `url`, its effect textures' `noiseUrl` /
    `dissolveUrl`."""
    sc = json.loads(data)
    if not sc.get("layers"):
        return data
    for l in sc["layers"]:
        if l.get("kind") == "spine":
            l["files"] = links.spine(bundle, l["atlas"])
        elif l.get("sprite"):
            l["url"] = links.scene_sprite(bundle, l["sprite"])
            fx = (l.get("material") or {}).get("fx") or {}
            l.update((n + "Url", links.obj(bundle, fx[n])) for n in ("noise", "dissolve") if fx.get(n))
    return json.dumps(sc, ensure_ascii=False).encode("utf-8")


def _enemy_entry(e: dict, spine: bool, drawn: bool) -> dict:
    """A handbook entry with its pictures: the grid's, the card's when it has no Spine, the portrait (face: other pages
    show it too)."""
    pic = e.get("pic")
    tile = links.enemy_thumb(e["app"]) if drawn and (spine or not pic) else links.thumb(pic)
    big = "" if spine else links.img(pic) or (links.enemy_thumb(e["app"]) if drawn else "")
    return {**e, "spine": spine, "info": f"/api/enemy?id={e['id']}", "tile": tile, "big": big, "face": links.thumb(pic)}


def _unit_links(svc) -> dict:
    """The Identities & E.G.O with their pictures' links: `pics` {thumb, art, art2, thumb2 (the second art small), full (an
    E.G.O's picture big: what its skills show)}; skills `iconUrl` / `artUrl` (an E.G.O's only when the game has its own);
    keywords `iconUrl`."""
    db = svc.unit_db()
    was = getattr(svc, "_units_linked", None)
    if was and was[0] is db:
        return was[1]

    def pics(x):
        im = x.get("img") or {}
        out = {"thumb": links.thumb(im.get("thumb")), "art": links.img(im.get("art")), "art2": links.img(im.get("art2")),
               "thumb2": links.thumb(im.get("art2"))}
        return out if x.get("title") else {**out, "full": links.img(im.get("thumb"))}

    def skills(x, key):
        for s in x[key] or []:
            path = links.SKILL_ICON.format(s.get("icon") or s["id"])
            if x.get("title") or svc.lookup_container(path) or extra_file(path):  # (an E.G.O's own: rare)
                s = {**s, "iconUrl": links.thumb(path), "artUrl": links.img(path)}
            yield s

    def unit(x):
        return {**x, "pics": pics(x), **{k: list(skills(x, k)) for k in ("skills", "defense") if k in x}}
    out = {**db, **{k: [unit(x) for x in db[k]] for k in ("ids", "egos", "events") if k in db}}
    if "glossary" in db:
        out["glossary"] = {k: {**g, "iconUrl": links.thumb(g["icon"])} if g.get("icon") else g for k, g in db["glossary"].items()}
    svc._units_linked = (db, out)
    return out


def _skill_links(svc, s: dict | None, sid, pic: str):
    """A skill with its picture; none in the game: the enemy's portrait."""
    if not s:
        return s
    path = s.get("iconPath") or links.SKILL_ICON.format(s.get("icon") or sid)
    if pic and not svc.lookup_container(path) and not extra_file(path):
        path = pic
    return {**s, "iconUrl": links.thumb(path), "artUrl": links.img(path)}


def _mirror_links(db: dict) -> dict:
    """The planner's gifts and theme packs with their picture's link."""
    return {**db, "gifts": {k: {**g, "tile": links.thumb(g.get("pic"))} for k, g in (db.get("gifts") or {}).items()},
            "packs": [{**p, "tile": links.thumb(p.get("pic"))} for p in db.get("packs") or []]}


STORY_OFF = re.compile(r"(?i)off|none|stop")  # (a line's bgm that stops the music)


def _story_index_links(idx: dict) -> dict:
    """The Story list with its files as links: a chapter's `tile` / `big` picture; an episode part [file, detail, banner,
    banner link, the file's link, banner's small link]; an Identity story's `info`."""
    part = lambda p: [*p, links.story_pic(p[2], 1280), links.story_ep(p[0]), links.thumb(p[2])]  # noqa: E731
    ch = lambda c: {**c, "tile": links.thumb(c.get("pic")), "big": links.story_pic(c.get("pic"), 1280),  # noqa: E731
                    "eps": [{**e, "parts": [part(p) for p in e["parts"]]} for e in c["eps"]]}
    return {**idx, "main": [ch(c) for c in idx["main"]], "other": [ch(c) for c in idx["other"]],
            "ident": [{**s, "items": [{**it, "info": links.story_ep(it.get("story"))} for it in s["items"]]} for s in idx["ident"]]}


def _story_ep_links(ep: dict) -> dict:
    """A story file with `links` {"<px>|<path>": picture, "m|<psb>": model layout, "a|<sample>": sound, "v|<name>": video}:
    the reader (ui/story.js stLink) takes every file from there."""
    L = {}
    for v in ep["pics"].values():
        L["1920|" + v] = links.story_pic(v, 1920)
    for m in ep["models"].values():
        if m.get("img"):
            L["2048|" + m["img"]] = links.story_pic(m["img"], 2048)
        if m.get("psb"):
            L["m|" + m["psb"]] = links.story_model(m["psb"])
    for ln in ep["lines"]:
        for x in [ln.get("v")] + (ln.get("sfx") or []) + [ln.get("bgm") if ln.get("bgm") and not STORY_OFF.fullmatch(ln["bgm"]) else ""]:
            if x:
                L["a|" + x] = links.story_audio(x)
        if ln.get("vid"):
            L["v|" + ln["vid"]] = links.story_video(ln["vid"])
    return {**ep, "links": L}


def _story_kit_links(kit: dict) -> dict:
    """Story workshop's catalog with `links` as a story file has them (its scenes play in the reader), a person's `tile`."""
    L = {}
    for k in ("bg", "cg"):
        for it in kit.get(k) or []:
            L["1920|" + it["p"]] = links.story_pic(it["p"], 1920)
    for c in kit.get("chars") or []:
        if c.get("img"):
            L["2048|" + c["img"]] = links.story_pic(c["img"], 2048)
        if c.get("psb"):
            L["m|" + c["psb"]] = links.story_model(c["psb"])
    for k in ("bgm", "sfx"):
        for it in kit.get(k) or []:
            L["a|" + it["k"]] = links.story_audio(it["k"])
    return {**kit, "chars": [{**c, "tile": links.thumb(c.get("face") or c.get("img"))} for c in kit.get("chars") or []], "links": L}


def _stage_links(c: dict, pics: set) -> dict:
    """A Story map chapter with its tiles' pictures [small, big] and the nodes' card pictures (those that have one)."""
    return {**c, "tileUrls": {rc: [links.thumb(p), links.story_pic(p, 1024)] for rc, p in (c.get("tiles") or {}).items()},
            "nodes": [{**n, "picUrl": links.stage_node_pic(n["id"])} if n["id"] in pics else n for n in c.get("nodes") or []]}


def _report_links(rep: dict, site: dict | None = None) -> dict:
    """A report with the files its page shows as links on the items: images `pics` {old, new} (stored previews) and `open`
    (the object), other items `open` / `blob`, sounds a link last in the row, notable names `thumb` / `tree` / `container`.
    site: what the web copy keeps ({full_images, video, audio}); None: everything."""
    keep = lambda flag: site is None or site.get(flag)  # noqa: E731
    S = {k: [dict(it) for it in v] for k, v in rep["sections"].items()}
    for it in S.get("images", []):
        o, n = it.get("old"), it.get("new")
        side = lambda s: links.report_thumb(s and (s.get("h") if s.get("type") == "Texture2D" else s.get("tex")))  # noqa: E731
        it["pics"] = {"old": side(o), "new": side(n)}
        # (the web copy: named pictures only; a player file's sprites always, no preview of their own)
        if n and it.get("bundle") and (site is None or (it.get("path") and keep("full_images"))
                                       or n.get("type") == "Sprite" and str(it["bundle"]).startswith("install:")):
            it["open"] = links.obj(it["bundle"], it["pid"], it.get("type"))
    for sec in ("texts", "data", "video", "code"):
        for it in S.get(sec, []):
            n = it.get("new")
            if not n:
                continue
            if it.get("type") == "file":
                if n.get("blob") and not it.get("records") and not it.get("lines"):
                    it["blob"] = links.blob(n["blob"])
            elif it.get("bundle") and (it.get("type") != "VideoClip" or keep("video")):
                it["open"] = links.obj(it["bundle"], it["pid"], it.get("type"))
    for it in S.get("audio", []):
        if not keep("audio") or not it.get("sounds"):
            continue
        sd = dict(it["sounds"])
        for k in ("added", "changed"):
            sd[k] = [[*s, links.bank(it["path"], s[2])] for s in sd.get(k, [])]
        it["sounds"] = sd
    for it in S.get("leaks", []):
        if it.get("kind") == "removed":
            continue
        if it.get("path"):
            it.update(thumb=links.thumb(it["path"]), tree=links.tree(it["path"].rpartition("/")[0]), container=links.container(it["path"]))
        elif it.get("bundle") and it.get("pid"):
            it["open"] = links.obj(it["bundle"], it["pid"], it.get("type"))
    return {"notes": links.patchnotes(rep["id"]), **rep, "sections": S}


def _history_links(svc, db: dict) -> dict:
    """A card's picture (an enemy's drawn portrait once it is drawn) and a changed row's skill icon, as links."""
    done = {fn[:-4] for fn in os.listdir(_thumb_dir(svc))} if os.path.isdir(_thumb_dir(svc)) else set()
    card = lambda c: {**c, "tile": links.thumb(c["pic"]) if c.get("pic") else links.enemy_thumb(c["app"]) if c.get("app") and _safe(c["app"]) in done else ""}  # noqa: E731
    row = lambda r: {**r, "iconUrl": links.thumb(r["icon"])} if r.get("icon") else r  # noqa: E731
    return {**db, "cards": {k: card(c) for k, c in (db.get("cards") or {}).items()},
            "patches": [{**p, "cards": {k: {**c, "groups": [{**g, "rows": [row(r) for r in g["rows"]]} for g in c["groups"]]} for k, c in p["cards"].items()}}
                        for p in db.get("patches") or []]}


def _voices_links(v: dict, n: int = 0) -> dict:
    """Guess the sound's lines with their sounds as links (last in a row); n: only that many of each announcer's lines."""
    ann = {name: (sorted(ls, key=lambda ln: (ln[2] > 6000, ln[1]))[:n] if n else ls) for name, ls in (v.get("announcers") or {}).items()}
    row = lambda ln: [*ln, links.bank(ln[0], ln[1])]  # noqa: E731
    return {"announcers": {k: [row(ln) for ln in ls] for k, ls in ann.items()},
            "egos": {k: [row(ln) for ln in ls] for k, ls in (v.get("egos") or {}).items()}}


def _quiz_links(q: dict) -> dict:
    """Every voice line's sound and a character's picture, as links (after the row's own fields)."""
    row = lambda r: [*r, links.quiz_audio(r[0])]  # noqa: E731
    return {**q, "ids": [row(r) for r in q.get("ids") or []], "bosses": [row(r) for r in q.get("bosses") or []],
            "chars": [{**c, "tile": links.thumb(c.get("pic")), "lines": [row(ln) for ln in c.get("lines") or []]} for c in q.get("chars") or []]}


def _gacha_links(g: dict) -> dict:
    """The screens' pictures, each banner's pictures, the sounds and the lines' voices, as links."""
    from . import gacha
    banner = lambda b: {**b, "pics": {k: links.img(b[k]) for k in ("tile", "typo", "illust") if b.get(k)}}  # noqa: E731
    return {"ui": {n: links.gacha_ui(n) for n in gacha.UI_USED}, **g, "banners": [banner(b) for b in g.get("banners") or []],
            "archive": [banner(b) for b in g.get("archive") or []], "lines": {k: [*v, links.quiz_audio(v[0])] for k, v in (g.get("lines") or {}).items()},
            "sndUrl": {k: links.quiz_audio(v) for k, v in (g.get("snd") or {}).items()}}


def _abno_links(db: dict) -> dict:
    """An entry's picture (its portrait, else the enemy handbook's drawn look) and its Spine look's files, as links."""
    return {**db, "list": [{**a, "tile": links.thumb(a["pic"]) if a.get("pic") else links.enemy_thumb(a.get("app")),
                            **({"spine": {**a["spine"], "files": links.spine(a["spine"]["bundle"], a["spine"]["atlas"])}} if a.get("spine") else {})}
                           for a in db.get("list") or []]}


def _growth_links(db: dict) -> dict:
    """Upgrade calc icons with their picture links."""
    return {**db, "icons": {k: {**v, "url": links.obj(v["b"], v["p"])} for k, v in (db.get("icons") or {}).items()}} if db.get("icons") else db


def _announcer_links(db: dict) -> dict:
    """Announcers with their picture links and each line's voice clip: [kind, text, bank, i, ms, clip]."""
    return {**db, "list": [{**a, "tile": links.thumb(a.get("img")), "pics": [links.img(p) for p in a.get("imgs") or [a.get("img")] if p],
                            "lines": [[*ln, links.bank(ln[2], ln[3]) if ln[2] else ""] for ln in a["lines"]]} for a in db.get("list") or []]}


def _thumb_dir(svc) -> str:
    return os.path.join(svc.data_dir, "enemy_thumbs")


def _drawn_thumbs(svc, enemies: list, spines: dict, done: set) -> int:
    """Sprite enemies without a portrait get the player's idle-pose picture; returns how many are still queued."""
    if not spines:  # (which ones are Spine-drawn is known only once the skeletons are linked)
        return 0
    from .viewer import _safe_name, fighter_pic_dir
    bare = [a for a in dict.fromkeys(e.get("app") for e in enemies if not e.get("pic")) if a and not spines.get(a)]
    if not bare:
        return 0
    todo = []
    for a in bare:
        src, dst = os.path.join(fighter_pic_dir(svc), _safe_name(a) + ".png"), os.path.join(_thumb_dir(svc), _safe(a) + ".png")
        if os.path.isfile(src):
            if _safe(a) not in done or os.path.getmtime(src) > os.path.getmtime(dst):  # newer drawing
                os.makedirs(_thumb_dir(svc), exist_ok=True)
                shutil.copyfile(src, dst)
                done.add(_safe(a))
        else:
            todo.append(a)  # old one shown meanwhile
    if not todo:
        return 0
    st = svc.fx.fighter_pics(todo)
    return len([a for a in todo if a not in st["failed"]])


def _quiz_twins(svc, q: dict) -> dict:
    """Story characters; a portrait shared by two keeps one speaker ("twin") with both's lines."""
    import unicodedata
    from .twins import repeats
    chars = q.get("chars") or []
    if not chars:
        return q
    flat = lambda s: "".join(ch for ch in unicodedata.normalize("NFKD", s.lower()) if ch.isalnum())

    def thumb(path):
        r = next((r for r in svc.lookup_container(path) if r["type"] == "Texture2D" and r.get("h")), None)
        return r and svc.store.thumb_path(r["h"])
    enemies = {e["id"]: e for e in svc.enemy_db()["list"]}
    files, drawn_all = [], set(os.listdir(_thumb_dir(svc))) if os.path.isdir(_thumb_dir(svc)) else set()
    memo = getattr(svc, "_quiz_pics", None)
    if memo and memo[0] is q and memo[1] == len(drawn_all):
        files = memo[2]
    for c in chars if not files else ():  # the picture the page shows (games2.js giOpen): the story log's, else the handbook's
        e = enemies.get(c.get("boss")) if not c.get("pic") else None
        drawn = e and e["app"] + ".png" in drawn_all and os.path.join(_thumb_dir(svc), e["app"] + ".png")
        files.append(thumb(c["pic"]) if c.get("pic") else drawn if drawn and (svc.enemy_spines().get(e["app"]) or not e.get("pic"))
                     else thumb(e["pic"]) if e and e.get("pic") else None)
    svc._quiz_pics = (q, len(drawn_all), files)
    order = sorted(range(len(chars)), key=lambda i: (not (chars[i].get("pic") and flat(chars[i]["name"]) in flat(os.path.basename(chars[i]["pic"]))),
                                                     -len(chars[i].get("lines") or []), i))
    twins = {order[k]: order[j] for k, j in repeats([files[i] for i in order]).items()}
    # the twin stays, empty, so places don't shift
    out = [{**c, "lines": list(c.get("lines") or [])} for c in chars]
    for i, j in twins.items():
        out[j]["lines"] += out[i]["lines"]
        out[i] = {**out[i], "lines": [], "twin": j}
    return {**q, "chars": out}


def _no_thumbs(svc, add: str | None = None) -> list[str]:
    """Enemies with no idle pose to picture, kept per game version."""
    path, sid = os.path.join(_thumb_dir(svc), "_none.json"), svc.latest_snapshot_id()
    try:
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
    except (OSError, ValueError):
        d = {}
    apps = d.get("apps", []) if d.get("snapshot") == sid else []
    if add and add not in apps:
        apps = sorted(apps + [add])
        os.makedirs(_thumb_dir(svc), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump({"snapshot": sid, "apps": apps}, f)
    return apps


def _safe(fn: str, room: int = 200) -> str:
    """A file name Windows accepts (no reserved chars, not too long; long Versus names cut at " · ")."""
    fn = "".join(c if c not in '<>:"/\\|?*' else "_" for c in fn).strip()
    if len(fn) > room:
        cut = fn[:room]
        fn = (cut[:cut.rfind(" · ")] if cut.rfind(" · ") > room // 2 else cut).rstrip(" .,")
    return fn


def export_object(svc: Service, b: dict) -> dict:
    out_dir = os.path.join(svc.data_dir, "exports")
    os.makedirs(out_dir, exist_ok=True)
    if b.get("bundle") is not None:
        path = svc.object_file(b["bundle"])
        if not path:
            raise FileNotFoundError("bundle not in the game cache")
        data, _mime, fn = extract(path, int(b["pid"]), b.get("fmt"))
    elif b.get("clipgif"):
        from .clips import clip_gif
        g = b["clipgif"]
        path = svc.object_file(g["bundle"])
        if not path:
            raise FileNotFoundError("bundle not in the game cache")
        data = clip_gif(path, str(g["clip"]), int(g["go"]), bool(g.get("all")), 1.0, g["bundle"], svc.resolver())
        fn = f"{g.get('name') or g['clip']}.gif"
    elif b.get("spine"):
        g = b["spine"]
        data = spine_zip(svc, g["bundle"], int(g["atlas"]), g.get("base") or "skeleton")
        fn = f"{g.get('base') or g['atlas']}_spine.zip"
    elif b.get("video"):  # a WebM the UI recorded (Spine loop)
        import base64
        g = b["video"]
        data = base64.b64decode(g["data"].split(",", 1)[-1])
        fn = f"{g.get('name') or 'animation'}.webm"
    elif b.get("image"):  # a PNG the UI made (a skill icon in its sin frame)
        import base64
        g = b["image"]
        data = base64.b64decode(g["data"].split(",", 1)[-1])
        fn = f"{g.get('name') or 'image'}.png"
    elif b.get("framesgif"):
        g = b["framesgif"]
        data = frames_gif(g["frames"], float(g.get("fps") or 25))
        fn = f"{g.get('name') or 'animation'}.gif"
    elif b.get("bank"):
        from .banks import export_wav
        path = svc.real_path(b["bank"])
        if not path:
            raise FileNotFoundError("bank not found in the current install")
        data, fn = export_wav(path, int(b["i"]))
    elif b.get("fxvideo"):  # skill renders: one video, or all of an Identity into a folder
        g = b["fxvideo"]
        v = _fx_variant(g)
        items = g["items"]  # [[render name, file name], …]
        dest = os.path.join(out_dir, _safe(g["folder"])) if len(items) > 1 else out_dir
        os.makedirs(dest, exist_ok=True)
        import shutil
        saved = None
        for name, fname in items:
            src = svc.fx.video(_fx_id(g["id"]), name, v)  # MP4, or WebM with alpha for a transparent background
            ext = ".gif" if g.get("discord") else " frames" if g.get("frames") else os.path.splitext(src or "")[1]
            fname = _safe(fname, max(40, min(200, 250 - len(dest) - len(ext) - 6)))  # (6: the separator + " (nn)")
            target = os.path.join(dest, fname + ext)
            n = 2
            while g.get("unique") and os.path.exists(target):  # (Versus: never over another save of the same two)
                target = os.path.join(dest, f"{fname} ({n}){ext}")
                n += 1
            if src and g.get("discord"):  # a GIF under Discord's 10 MB
                from .viewer import discord_gif
                saved = discord_gif(src, target)
            elif src and g.get("frames"):  # PNG frames in a folder
                from .viewer import png_frames
                saved = png_frames(src, target)
            elif src:
                saved = target
                shutil.copyfile(src, saved)
        if not saved:
            raise FileNotFoundError("not rendered")
        return {"path": saved if len(items) == 1 else dest}
    elif b.get("buffvideo"):  # Buff effects: one effect's video (WebM with alpha), or all of a buff's into a folder
        g = b["buffvideo"]
        items = [(svc.buff_fx.video(n), fname) for n, fname in g["items"]]  # [[effect name, file name], …]
        items = [(src, fname) for src, fname in items if src]
        if not items:
            raise FileNotFoundError("not made yet")
        dest = os.path.join(out_dir, _safe(g["folder"])) if len(items) > 1 else out_dir
        os.makedirs(dest, exist_ok=True)
        import shutil
        ext = ".gif" if g.get("discord") else " frames" if g.get("frames") else ".webm"
        for src, fname in items:
            target = os.path.join(dest, _safe(fname, max(40, min(200, 250 - len(dest) - len(ext)))) + ext)
            if g.get("discord"):  # a GIF under Discord's 10 MB
                from .viewer import discord_gif
                discord_gif(src, target)
            elif g.get("frames"):  # PNG frames in a folder
                from .viewer import png_frames
                png_frames(src, target)
            else:
                shutil.copyfile(src, target)
        return {"path": target if len(items) == 1 else dest}
    elif b.get("blob"):
        data, fn = svc.store.get_blob(b["blob"]), b.get("name") or b["blob"] + ".txt"
    elif b.get("framezip"):  # one skill's frames, to draw over
        from .frames import group_zip
        data, fn = group_zip(svc, _fx_id(b["framezip"]["id"]), b["framezip"]["group"])
    elif b.get("thumb"):
        with open(svc.store.thumb_path(b["thumb"]), "rb") as f:
            data = f.read()
        fn = (b.get("name") or b["thumb"]) + "_thumb.webp"
    elif b.get("soundfolder"):  # Database → Sounds: a folder's own sounds as WAVs into a folder of that name
        from . import soundlib
        from .banks import export_wav
        db = svc.sound_lib()
        node = soundlib.find(db, b["soundfolder"])
        rows = soundlib.items(db, node) if node else []
        if not rows:
            raise FileNotFoundError("no sounds in this folder")
        if len(rows) > soundlib.SAVE_MAX:
            raise ValueError(f"{len(rows)} sounds: too many to save at once (up to {soundlib.SAVE_MAX})")
        dest = os.path.join(out_dir, _safe(" - ".join(b["soundfolder"]), 120))
        os.makedirs(dest, exist_ok=True)
        for bank, i, name, *_ in rows:
            path = svc.real_path(bank)
            if path:
                with open(os.path.join(dest, _safe(name, 150) + ".wav"), "wb") as f:
                    f.write(export_wav(path, i)[0])
        return {"path": dest}
    else:
        raise ValueError("nothing to export")
    fn = "".join(c if c not in '<>:"/\\|?*' else "_" for c in fn)
    target = os.path.join(out_dir, fn)
    with open(target, "wb") as f:
        f.write(data)
    return {"path": target}


def _fx_id(v) -> int | str:
    """Identity / E.G.O id, or an enemy's appearance prefab name."""
    v = str(v)
    if v.isdigit():
        return int(v)
    if not re.fullmatch(r"[\w .()-]{1,120}Appearance|vs-[0-9a-f]{12}", v):  # (vs-…: a Versus video)
        raise ValueError("bad id")
    return v


def _fx_variant(q: dict) -> str:
    """Skill render options from a request ("v", see viewer.FLAGS; old "solo" still works)."""
    from .viewer import variant
    v = q.get("v") or ""
    solo = q.get("solo")
    if solo is True or solo == "1":
        v += "_solo"
    return variant(v)


def _story_lines(svc: Service) -> bytes:
    """Every line of the story for the line search, kept on disk per snapshot (reading all the stories takes a minute)."""
    from . import story
    folder = os.path.join(svc.data_dir, "story_lines")
    name = f"{svc.latest_snapshot_id()}_v{story.VERSION}.json"
    path = os.path.join(folder, name)
    if os.path.isfile(path):
        with open(path, "rb") as f:
            return f.read()
    idx = story.index(svc)
    files = list(dict.fromkeys([pt[0] for c in idx["main"] + idx["other"] for e in c["eps"] for pt in e["parts"]]
                               + [it["story"] for s in idx["ident"] for it in s["items"]]))
    who, lines = {}, []
    for n, fid in enumerate(files):
        ep = story.episode_of(svc, fid) or {}
        models = ep.get("models") or {}
        for i, ln in enumerate(ep.get("lines") or []):
            text = (ln.get("text") or "").strip()
            if text:
                m = models.get(ln.get("who")) or {}
                lines.append([n, i, who.setdefault((m.get("name") or ln.get("who") or "", m.get("color") or ""), len(who)), text])
    body = json.dumps({"files": files, "who": [list(k) for k in who], "lines": lines}, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    os.makedirs(folder, exist_ok=True)
    for old in os.listdir(folder):
        if old != name:
            os.remove(os.path.join(folder, old))
    with open(path + ".tmp", "wb") as f:
        f.write(body)
    os.replace(path + ".tmp", path)
    return body


class _Server(ThreadingHTTPServer):
    request_queue_size = 128  # a page opens its connections in one burst; 5 (the default) refuses some on Windows


def serve(svc: Service, port: int, on_show=None) -> ThreadingHTTPServer:
    ui_dir = os.path.join(resource_dir(), "ui")
    httpd = _Server(("127.0.0.1", port), make_handler(svc, ui_dir, on_show))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    if getattr(svc, "fx", None) is not None:
        threading.Thread(target=svc.fx.prewarm, daemon=True).start()
    from . import langs
    threading.Thread(target=langs.warm, args=(svc,), daemon=True).start()
    return httpd
