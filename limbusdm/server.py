"""Local HTTP server for the UI (127.0.0.1 only)."""
from __future__ import annotations

import json
import mimetypes
import os
import re
import subprocess
import threading
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from .extract import extract
from .paths import resource_dir
from .service import Service

TOKEN_HEADER = "X-Limbus-Datamine"
# How long the window keeps a picture, font or Spine file before asking again; asked again, it gets "not changed"
# (304) while the snapshot and the app are the same ones (the ETag), so nothing is cut out of the bundles twice.
KEEP = "max-age=3600"
# Lists that only a new snapshot changes and that take a while to put together: answered from memory after the first time.
PER_SNAPSHOT = {"/api/battle_maps", "/api/bgm_tracks", "/api/game_pics", "/api/types", "/api/stages", "/api/gacha"}


def _etag(svc) -> str:
    from . import __version__
    return f'"{svc.latest_snapshot_id()}-{__version__}"'


def make_handler(svc: Service, ui_dir: str, on_show=None):
    class H(BaseHTTPRequestHandler):
        # connections are kept open: a page of a few hundred pictures no longer opens one (and a thread) per picture
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
            # (one Cache-Control only: "no-store" sent next to "max-age" made the window keep nothing at all)
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

        def _gz_json_file(self, path):
            if not os.path.exists(path):
                return self._json({"error": "not found"}, 404)
            with open(path, "rb") as f:
                body = f.read()
            self._send(200, body, "application/json; charset=utf-8", {"Content-Encoding": "gzip"})

        def _file(self, path, ctype=None, cache=False):
            if not path or not os.path.exists(path):
                return self._send(404, b"not found", "text/plain")
            with open(path, "rb") as f:
                body = f.read()
            ctype = ctype or mimetypes.guess_type(path)[0] or "application/octet-stream"
            self._send(200, body, ctype, {"Cache-Control": "max-age=86400"} if cache else None)

        def _file_live(self, path, ctype):
            """A file the app itself makes and may make again (an enemy's picture, an effect's video): kept by the window
            and asked "still the same?" each time — the answer is a few bytes (304) unless the file was written anew."""
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

        def _spine_file(self, p: str):
            """/spine/<bundle>/<atlas pid>/skeleton.json | skeleton.atlas | <page>.png"""
            from urllib.parse import unquote
            parts = [unquote(x) for x in p.split("/")[2:]]
            if len(parts) != 3:
                return self._send(404, b"", "text/plain")
            bundle, atlas_pid, fn = parts
            atlas_pid = atlas_pid.split(".")[0]  # "<pid>.<n>": n only busts the WebView's cache
            try:
                data, mime = spine_file(svc, bundle, int(atlas_pid), fn)
            except FileNotFoundError as e:
                return self._send(404, str(e).encode(), "text/plain")
            return self._send(200, data, mime, {"Cache-Control": "max-age=3600"})

        def _asset_thumb(self, path: str):
            """Small preview of a catalog image path: stored texture thumbnail, else the sprite rendered live."""
            rows = svc.lookup_container(path)
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
            """Full-size picture of a catalog path (Identity art, E.G.O CG…), straight from the game cache."""
            rows = svc.lookup_container(path)
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
                traceback.print_exc()
                self.close_connection = True  # (the answer may have been cut half-way)
                if not self._replied:
                    self._json({"error": f"{type(e).__name__}: {e}"}, 500)
            if not self._replied:  # nothing was answered: a kept connection would leave the page waiting
                self.close_connection = True

        def do_GET(self):
            self._run(self._get_kept)

        def do_POST(self):
            if self.headers.get(TOKEN_HEADER) != "1":  # blocks cross-site requests from web pages
                self.close_connection = True  # (its body is left unread)
                return self._json({"error": "forbidden"}, 403)
            self._run(self._post)

        def _get_kept(self):
            """What the window already has (a picture it kept, a list made once per snapshot) is answered without the work."""
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
            if p.startswith("/ui/"):
                full = os.path.normpath(os.path.join(ui_dir, p[4:]))
                if not full.startswith(os.path.normpath(ui_dir)):
                    return self._send(403, b"", "text/plain")
                return self._file(full)
            if p == "/api/appnotes":  # what's new in the app since the version seen last ({} when seen); all=1: the last releases
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
            if p.startswith("/api/redraw"):  # AI redraw of frames (experimental, limbusdm/redraw.py)
                from . import redraw
                if p == "/api/redraw/thumb":
                    return self._send(200, redraw.thumb(svc, q["zip"], q["frame"]), "image/png")
                if p == "/api/redraw/search":
                    return self._json(redraw.search(q.get("q", "")))
                if p == "/api/redraw/char":
                    return self._json(redraw.character(q["tag"]))
                if p == "/api/redraw/img":
                    data, ctype = redraw.booru_image(q["url"])
                    return self._send(200, data, ctype, {"Cache-Control": "max-age=86400"})
                return self._json(dict(redraw.state(), zips=redraw.zips(svc)))
            if p == "/api/state":
                st = svc.state()
                st["disk"] = svc.disk_usage() if q.get("disk") else None
                return self._json(st)
            if p == "/api/report":
                return self._gz_json_file(os.path.join(svc.data_dir, "reports", q["id"] + ".json.gz"))
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
                return self._json(svc.characters())
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
            if p == "/api/owner_clips":
                return self._json(svc.owner_clips(int(q["id"])))
            if p == "/api/fx":
                return self._json(svc.fx.status(_fx_id(q["id"]), _fx_variant(q)))
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
                # (with the soundtrack's own name, where it plays and its number in /api/music_audio when the corner
                # player's list has the same recording: the Versus page shows those and plays a track to listen)
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
                if not re.fullmatch(r"[\w .-]+", name):
                    return self._send(404, b"", "text/plain")
                return self._file(os.path.join(stage_pic_dir(svc), name + ".jpg"), "image/jpeg")
            if p == "/api/battle_maps":
                from .viewer import battle_maps
                return self._json([m["name"] for m in battle_maps(svc)])
            if p == "/api/frames":
                from .frames import character_frames
                return self._json(character_frames(svc, _fx_id(q["id"])))
            if p == "/api/frame_png":  # a game frame (bundle + pid) or a mod's replacement (id + name + file)
                import io as _io
                from . import frames, mods
                if q.get("file"):
                    f = os.path.join(mods.mod_dir(svc, _fx_id(q["id"]), q["name"]), "frames", os.path.basename(q["file"]))
                    with open(f, "rb") as fh:
                        return self._send(200, fh.read(), "image/png", {"Cache-Control": "no-store"})
                rec = {"bundle": q["bundle"], "pid": q["pid"], "w": int(q["w"]), "h": int(q["h"])}
                b = _io.BytesIO()
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
                scenes = art_scenes(path)
                found = scenes.get(int(q["atlas"]))
                if not found and scenes:
                    # the illustration may use another cut of the same skeleton ("<base>_분리버전" next to "<base>")
                    base = next((x["base"] for x in svc.spine_list() if x["bundle"] == q["bundle"] and x["atlas"] == q["atlas"]), None)
                    cuts = {x["atlas"]: x["base"] for x in svc.spine_list() if x["bundle"] == q["bundle"]}
                    found = next((sc for a, sc in scenes.items() if base and cuts.get(str(a), "").startswith(base)), None)
                return self._json(found or {})
            if p.startswith("/spine/"):
                return self._spine_file(p)
            if p == "/api/asset_thumb":
                return self._asset_thumb(q["path"])
            if p == "/api/char_icon":  # a Versus pick: an Identity's / E.G.O's profile picture, an enemy's portrait
                import re as _re
                cid = q.get("id", "")
                base = "Assets/Resources_moved/Sprite/Unit/"
                if _re.fullmatch(r"1\d{4}", cid):
                    path = f"{base}Profile/Normal/{cid}_normal_profile.png"
                elif _re.fullmatch(r"2\d{4}", cid):
                    path = f"{base}Profile/Ego/{cid}_awaken_profile.png"
                else:
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
                return self._json(svc.lookup_container(q["path"]))
            if p == "/api/marks":
                return self._json(svc.marks)
            if p == "/api/units":
                return self._json(svc.unit_db())
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
                return self._json(svc.quiz())
            if p == "/api/game_pics":  # pictures of the Games: the jukebox covers (the track's card), the story's
                # backgrounds by Canto (Guess the Canto; folders Ep<N> / Ep<N>_<part>, named from the folder on so that
                # the web copy doesn't take a few hundred full-size pictures for paths to fetch)
                import re as _re
                base, story = "Assets/Resources_moved/Story/Backgrounds/", {}
                for r in svc.browse_query("Story/Backgrounds", "Sprite", 5000):
                    m = _re.match(r"E[pP](\d+)(?:_[123])?/[^/]+$", (r["c"] or "")[len(base):]) if (r["c"] or "").startswith(base) else None
                    if m:
                        story.setdefault(m.group(1), []).append(r["c"][len(base):])
                return self._json({"track": sorted(r["c"] for r in svc.browse_query("bgmCover", "Sprite", 500) if "/bgmCover_" in (r["c"] or "")),
                                   "story": {k: sorted(set(v)) for k, v in story.items()}})
            if p == "/api/game_cards":  # the pictures on the cards of the Games page
                return self._json(game_cards(svc, int(q.get("n", 12))))
            if p == "/api/quiz_audio":  # one voice line by its sample's name
                from .banks import export_wav
                from .viewer import sound_index
                hit = sound_index(svc).get(q.get("s", "").lower())
                if not hit:
                    return self._json({"error": "no such line"}, 404)
                return self._send(200, export_wav(*hit)[0], "audio/wav", {"Cache-Control": "max-age=86400"})
            if p == "/api/gacha":  # Games → Extraction: the game's banners, pools, lines and sounds
                from . import gacha
                return self._json(gacha.build(svc))
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
                return self._json([{k: v for k, v in t.items() if k not in ("bank", "i")} for t in svc.music()["tracks"]])
            if p == "/api/music_audio":
                from . import music
                tracks = svc.music()["tracks"]
                n = int(q["n"])
                if not 0 <= n < len(tracks):
                    return self._json({"error": "no such track"}, 404)
                return self._file(*music.audio_file(svc, tracks[n]))
            if p == "/api/buffs":  # the buffs with an effect of their own, and which videos are made
                st = svc.buff_fx.status()
                return self._json(st if q.get("status") else {"list": svc.buff_fx.db()["list"], **st})
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
                return self._json({"chapters": db["chapters"], "tile": db.get("tile") or 2048, "units": entry, "tracks": tracks,
                                   "maps": [m["name"] for m in battle_maps(svc)]})
            if p == "/api/enemies":  # the handbook's list; an entry's skill and passive texts come with /api/enemy
                db = svc.enemy_db()
                # a Spine-drawn enemy is shown by a picture of its idle pose, taken by the page (the game's portrait
                # until then); the sprite-drawn ones keep the portrait
                done = {fn[:-4] for fn in os.listdir(_thumb_dir(svc))} if os.path.isdir(_thumb_dir(svc)) else set()
                spines = svc.enemy_spines()
                return self._json({**{k: v for k, v in db.items() if k not in ("skills", "passives", "list")},
                                   "list": [{**e, "spine": bool(spines.get(e["app"]))} for e in db["list"]],
                                   "thumbs": sorted({e["app"] for e in db["list"]} & done), "nothumb": _no_thumbs(svc)})
            if p == "/api/enemy_thumb":
                path = os.path.join(_thumb_dir(svc), _safe(q.get("app", "")) + ".png")
                return self._file_live(path, "image/png") if os.path.exists(path) else self._send(404, b"", "text/plain")
            if p == "/api/enemy":
                db = svc.enemy_db()
                e = next((x for x in db["list"] if str(x["id"]) == q.get("id")), None)
                if not e:
                    return self._send(404, b"", "text/plain")
                bodies = [b for v in e["variants"] for b in [v] + v["parts"]]
                sk = {s for b in bodies for s in b["skills"] + b.get("defense", [])}
                pa = {x for b in bodies for x in b["passives"]}
                # (the cache turns the ids into strings)
                return self._json({"spine": svc.enemy_spines().get(e["app"]) or [],
                                   "skills": {s: db["skills"].get(s) or db["skills"].get(str(s)) for s in sk},
                                   "passives": {x: db["passives"].get(x) or db["passives"].get(str(x)) for x in pa}})
            if p == "/api/teams":
                return self._json(svc.team_guide(refresh=q.get("refresh") == "1"))
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
                return self._send(200, png, "image/png", {"Cache-Control": "max-age=86400"})
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
                if not any(e["app"] == app for e in svc.enemy_db()["list"]):
                    return self._json({"error": "unknown"}, 404)
                if b.get("none"):  # nothing to take a picture of: not tried again at every start
                    return self._json({"ok": True, "nothumb": _no_thumbs(svc, app)})
                img = Image.open(io.BytesIO(base64.b64decode(b["data"].split(",", 1)[-1]))).convert("RGBA")
                img.thumbnail((256, 256))
                os.makedirs(_thumb_dir(svc), exist_ok=True)
                img.save(os.path.join(_thumb_dir(svc), app + ".png"), "PNG")
                return self._json({"ok": True})
            if p == "/api/fighter_pics":  # make pictures of these fighters' idle pose (the player, in the background)
                return self._json(svc.fx.fighter_pics([str(_fx_id(n)) for n in b.get("ids") or []]))
            if p == "/api/stage_pics":  # make pictures of these stages (the player, in the background)
                return self._json(svc.fx.stage_pics([str(n) for n in b.get("names") or []]))
            if p == "/api/patchnotes_seen":
                from . import patchnotes
                patchnotes.mark_seen(svc, b["id"])
                return self._json({"ok": True})
            if p.startswith("/api/redraw"):
                from . import redraw
                if p == "/api/redraw/stop":
                    return self._json(redraw.stop())
                if p == "/api/redraw/load":
                    cid, n = redraw.load(svc, b["zip"], b["mod"])
                    return self._json({"id": cid, "count": n})
                return self._json(redraw.start(svc, b))
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
            if p == "/api/versus":
                spec = {k: b.get(k) for k in ("left", "right", "skill", "mode", "rounds", "winner", "rskill")}
                spec.update({k: b[k] for k in ("map", "speed", "pause", "rspeed", "rpause", "lskills", "rskills", "defend", "counter",
                                        "bursts", "burstMax", "seed", "hitstop", "trim", "clean", "spread", "numbers",
                                        "slowmo", "dash", "music", "hp", "death", "intro", "ego", "lname", "rname",
                                        "bars", "uisfx", "pace", "ramp", "throw", "punch", "fade", "loop", "flash", "randskill", "kbscale", "deck", "notes",
                                        "buff", "buffboth", "buffmany", "buffown", "buffshort",
                                        "debuff", "debuffboth", "debuffmany", "debuffown", "debuffshort") if b.get(k) is not None})
                spec["left"], spec["right"] = _fx_id(spec["left"]), _fx_id(spec["right"])
                if b.get("team"):  # (a team fight: the line-ups as comma-joined ids; versus_job -> versus_team_job)
                    if b.get("live"):
                        return self._json({"error": "Versus Live does not play team fights yet"}, 400)
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
            if p == "/api/open_url":
                url = str(b.get("url", ""))
                if not url.startswith("https://docs.google.com/spreadsheets/"):  # only the team guide
                    return self._json({"error": "not allowed"}, 403)
                import webbrowser
                webbrowser.open(url)
                return self._json({"ok": True})
            if p == "/api/show":
                if on_show:
                    on_show(str(b.get("open") or ""))
                return self._json({"ok": True})
            return self._json({"error": "unknown"}, 404)

    return H


def spine_file(svc: Service, bundle: str, atlas_pid: int, fn: str) -> tuple[bytes, str]:
    """skeleton.json | skeleton.atlas | <page>.png of a Spine skeleton in a bundle, linked by path id (names repeat:
    many skeletons are called "imported")."""
    from .spine import fit_page, page_sizes, spine_map
    path = svc.object_file(bundle)
    if not path:
        raise FileNotFoundError("bundle not in the game cache")
    entry = spine_map(path).get(atlas_pid) or {}
    pid, mime = None, ""
    if fn == "skeleton.atlas":
        pid, mime = atlas_pid, "text/plain; charset=utf-8"
    elif fn == "skeleton.json":
        pid, mime = entry.get("skel"), "application/json"
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
        mime = "image/png"
    if pid is None:
        raise FileNotFoundError("not found")
    data, _m, _fn = extract(path, int(pid))
    if mime == "image/png":
        text = extract(svc.object_file(bundle), atlas_pid)[0].decode("utf-8", "replace")
        data = fit_page(data, page_sizes(text).get(fn))
    return data, mime


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
    """PNG data URLs (frames captured in the UI, e.g. from the Spine player) → GIF cropped to what is visible."""
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


# The pictures on the cards of the Games page, three a game, picked by Vlad (2026-10-07) from sets of the game's own:
# a path in the game's files, or "enemy:<appearance>" = the handbook's picture of that enemy's battle look.
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
}


def game_cards(svc: Service, n: int = 12) -> dict:
    """{game: [picture request]}: the pictures on the cards of the Games page, in order — the same three for
    everybody (CARD_PRESET). A game without a preset gets a handful of the game's own instead, other ones every time
    (jukebox covers, Identities, skills, faces from the story's log, enemies, the story's backgrounds), of which the
    page draws the first three that load. Marked "hub=1" for the web copy: it keeps the cards' pictures in a pack of
    its own, where any other picture costs the visitor the whole pack it sits in."""
    import random
    from urllib.parse import quote
    sid = svc.latest_snapshot_id()
    if not sid:
        return {}
    fixed = {g: ["/api/enemy_thumb?app=" + quote(p[6:], safe="") + "&hub=1" if p.startswith("enemy:") else "/api/asset_thumb?path=" + quote(p, safe="") + "&hub=1"
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
    try:  # enemies by the page's own pictures of their idle pose (made while the handbook is looked through)
        done = {fn[:-4] for fn in os.listdir(_thumb_dir(svc))} if os.path.isdir(_thumb_dir(svc)) else set()
        apps = sorted({e["app"] for e in svc.enemy_db()["list"] if e.get("app")} & done)
        out["enemy"] = ["/api/enemy_thumb?app=" + quote(a, safe="") + "&hub=1" for a in random.sample(apps, min(n, len(apps)))]
    except Exception:
        traceback.print_exc()
    out.update(fixed)
    return out


def _thumb_dir(svc) -> str:
    return os.path.join(svc.data_dir, "enemy_thumbs")


def _no_thumbs(svc, add: str | None = None) -> list[str]:
    """The enemies the page found no idle pose to take a picture of (ui/enemies.js enThumbs), kept for the game
    version they were found in: a new one may bring the missing skeleton."""
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
    """A file name Windows accepts: no reserved characters, and short enough (a name over 255 chars, or a path over
    260, fails with "Invalid argument"); a long Versus name is cut after its last " · " part that still fits."""
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
            ext = ".gif" if g.get("discord") else os.path.splitext(src or "")[1]
            fname = _safe(fname, max(40, min(200, 250 - len(dest) - len(ext) - 6)))  # (6: the separator + " (nn)")
            target = os.path.join(dest, fname + ext)
            n = 2
            while g.get("unique") and os.path.exists(target):  # (Versus: never over another save of the same two)
                target = os.path.join(dest, f"{fname} ({n}){ext}")
                n += 1
            if src and g.get("discord"):  # a GIF under Discord's 10 MB
                from .viewer import discord_gif
                saved = discord_gif(src, target)
            elif src:
                saved = target
                shutil.copyfile(src, saved)
        if not saved:
            raise FileNotFoundError("not rendered")
        return {"path": saved if len(items) == 1 else dest}
    elif b.get("blob"):
        data, fn = svc.store.get_blob(b["blob"]), b.get("name") or b["blob"] + ".txt"
    elif b.get("framezip"):  # one skill's frames, to draw over
        from .frames import group_zip
        data, fn = group_zip(svc, _fx_id(b["framezip"]["id"]), b["framezip"]["group"])
    elif b.get("thumb"):
        with open(svc.store.thumb_path(b["thumb"]), "rb") as f:
            data = f.read()
        fn = (b.get("name") or b["thumb"]) + "_thumb.webp"
    else:
        raise ValueError("nothing to export")
    fn = "".join(c if c not in '<>:"/\\|?*' else "_" for c in fn)
    target = os.path.join(out_dir, fn)
    with open(target, "wb") as f:
        f.write(data)
    return {"path": target}


def _fx_id(v) -> int | str:
    """An Identity / E.G.O id, or an enemy's appearance prefab name ("91008_TroubleshooterAppearance")."""
    v = str(v)
    if v.isdigit():
        return int(v)
    if not re.fullmatch(r"[\w .()-]{1,120}Appearance|vs-[0-9a-f]{12}", v):  # (vs-…: a Versus video)
        raise ValueError("bad id")
    return v


def _fx_variant(q: dict) -> str:
    """Skill render options from a request: "v" ("solo_alpha"…, see viewer.FLAGS); the older "solo" flag still works."""
    from .viewer import variant
    v = q.get("v") or ""
    solo = q.get("solo")
    if solo is True or solo == "1":
        v += "_solo"
    return variant(v)


def serve(svc: Service, port: int, on_show=None) -> ThreadingHTTPServer:
    ui_dir = os.path.join(resource_dir(), "ui")
    httpd = ThreadingHTTPServer(("127.0.0.1", port), make_handler(svc, ui_dir, on_show))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    if getattr(svc, "fx", None) is not None:
        threading.Thread(target=svc.fx.prewarm, daemon=True).start()
    return httpd
