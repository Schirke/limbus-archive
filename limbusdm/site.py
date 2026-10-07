"""The web copy of the app: patch reports and the Identities & E.G.O database written out as a static site.

The site is the app's own UI (ui/) plus a service worker (ui/site/sw.js) that answers the UI's /api/… requests from
files. This module makes those files: it asks the app's own server for every URL the pages can request and saves
the answers under <out>/d/, named by content, with manifests "URL → file". Nothing is rendered twice — the site
shows exactly what the app shows. The other pages are stubs there (ui/site/site.js).

Layout of <out> (data/site by default):
  index.html, sw.js, robots.txt, ui/…        the UI
  d/index.json                               the manifests' names + small answers kept inline (state…)
  d/m/<name>.json.gz                         URL → file
  d/tr/<name>.json.gz                        KR/JP line → English, from the app's translation cache
  d/f/<ab>/<sha1>.<ext>                      the files
"""
from __future__ import annotations

import gzip
import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import quote
from urllib.request import urlopen

from .paths import resource_dir

VERSION = 1
EXT = {"image/png": "png", "image/webp": "webp", "image/jpeg": "jpg", "image/gif": "gif", "audio/wav": "wav",
       "audio/ogg": "ogg", "video/mp4": "mp4", "video/webm": "webm", "application/json": "json", "text/plain": "txt",
       "font/otf": "otf", "font/ttf": "ttf"}
DEFAULTS = {"contact": "", "audio": True, "video": True, "full_images": True, "enemies": True, "music": True, "spine": True, "clips": True,
            "games": True,
            "project": "", "url": ""}
# the pages the site is written for (each has its part in Exporter); any other page of the UI is opened on the site
# only when the check finds it asking for nothing the site lacks (verify)
BASE_OPEN = ["patches", "news", "db", "enemies", "anim", "teams", "games", "gameid", "gameskill", "gamechar", "gameenemy", "gamecanto", "gamewordle", "gameconn", "gamegrid", "gamesplash", "gameatlas", "gameodd", "gamegacha", "gamedare", "community", "support", "buffs"]
# requests the check never fetches by itself: the app's own state and controls, renders, the game's raw files, and the
# ones a part of Exporter makes its own way
NO_HEAL = re.compile(r"^/api/(_|state|settings|disk|check|update|appnotes|patchnotes|fx|mod|frame|versus|skills|skill_slots|owner_|clip|"
                     r"local_video|redraw|browse|tree|types|container|scan|bank|export|open|site_|object|blob|report|characters|"
                     r"music_audio|quiz_audio|community|buff)")  # (community: who is live right now — a copy would only go stale)
CJK = re.compile("[぀-ヿ㐀-鿿가-힯]")
PREVIEW = ("Texture2D", "Sprite", "AudioClip", "VideoClip", "TextAsset", "Mesh")  # ui: previewHtml asks for these as they are


def out_dir(svc) -> str:
    return os.path.join(svc.data_dir, "site")


def config(svc) -> dict:
    """data/site_config.json: {"contact": "Discord: name", "audio": true, "video": true, "full_images": true,
    "project": the Cloudflare Worker the site is uploaded to (none: the site is only written to disk), "url": its address}."""
    c = dict(DEFAULTS)
    try:
        with open(os.path.join(svc.data_dir, "site_config.json"), encoding="utf-8") as f:
            c.update(json.load(f))
    except (OSError, ValueError):
        pass
    return c


def build_info(svc) -> dict:
    """What a copy of the site was made from: the app's version, a hash of its pages (ui/ — they are the site's pages
    too, so a change there shows even between releases), when, and the game version the data is of."""
    ui, h = os.path.join(resource_dir(), "ui"), hashlib.sha1()
    for d, dirs, files in os.walk(ui):
        dirs.sort()
        for fn in sorted(files):
            if not fn.endswith(".ico"):
                h.update(os.path.relpath(os.path.join(d, fn), ui).replace("\\", "/").encode())
                with open(os.path.join(d, fn), "rb") as f:
                    h.update(f.read().replace(b"\r\n", b"\n"))
    sid = svc.latest_snapshot_id() or ""
    return {"version": __import__("limbusdm").__version__, "ui": h.hexdigest()[:10], "stamp": int(time.time()),
            "game": re.sub(r"_\d{8}-\d{6}$", "", sid)}


def deploy_command(svc) -> str:
    """The upload as a command to run by hand (it sends data/site_packed as it was prepared last)."""
    return f'npx wrangler deploy --name {config(svc)["project"]} --assets "{packed_dir(svc)}" --compatibility-date 2026-10-01'


def status(svc) -> dict:
    """This app's build next to the one the site is showing, for the Settings page."""
    cfg, mine = config(svc), build_info(svc)
    out = {"url": cfg["url"], "project": cfg["project"], "app": mine, "site": None, "error": None,
           "command": deploy_command(svc) if cfg["project"] else "", "last": _read_json(os.path.join(svc.data_dir, "site_sent.json")).get("last"),
           "log": (_read_json(os.path.join(svc.data_dir, SEND_LOG)).get("list") or [])[::-1]}
    if cfg["url"]:
        try:
            from urllib.request import Request
            with urlopen(Request(cfg["url"].rstrip("/") + "/d/index.json", headers={"User-Agent": "LimbusArchive"}), timeout=10) as r:
                idx = json.load(r)
            out["site"] = idx.get("build") or {"version": idx["inline"]["/api/state"].get("version"), "stamp": idx.get("stamp")}
        except Exception as e:
            out["error"] = f"{type(e).__name__}: {e}"
    from . import sitefx
    out["fx"] = sitefx.counts(svc)
    s = out["site"]
    out["behind"] = bool(s) and (s.get("version") != mine["version"] or s.get("ui") != mine["ui"])
    return out


def _read_json(path: str) -> dict:
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def url_key(path: str, /, **q) -> str:
    """A request as the service worker names it: the path and its parameters sorted, not encoded."""
    parts = sorted(f"{k}={v}" for k, v in q.items() if v is not None)
    return path + ("?" + "&".join(parts) if parts else "")


def _request(key: str) -> str:
    path, _, qs = key.partition("?")
    path = quote(path, safe="/")
    if not qs:
        return path
    return path + "?" + "&".join(k + "=" + quote(v, safe="") for k, v in (p.split("=", 1) for p in qs.split("&")))


def js_string(v) -> str:
    """A value as ui/app.js valHtml shows it (JSON.stringify for anything but a string)."""
    return v if isinstance(v, str) else json.dumps(v, ensure_ascii=False, separators=(",", ":"))


def public(rep: dict) -> dict:
    """A report without the player's own files. The game's folder in LocalLow holds the account's save
    (save_slot_<account>.json), logs and analytics next to the game's data; only its notices are the game's."""
    own = lambda it: str(it.get("path") or "").startswith("locallow/") and not str(it["path"]).startswith("locallow/notice/")
    rep = dict(rep, sections={k: [it for it in v if not own(it)] for k, v in rep["sections"].items()},
               foreign_only=[f for f in rep.get("foreign_only", []) if not str(f.get("file") or "").startswith("locallow/")])
    rep["summary"] = dict(rep["summary"], foreign_only=len(rep["foreign_only"]),
                          **{k: len(v) for k, v in rep["sections"].items() if k in rep["summary"]})
    return rep


# ------------------------------------------------------------------ what a page asks for
def report_urls(rep: dict, cfg: dict) -> list[str]:
    """Every request ui/app.js can make while a report is open (the "Other" tab's raw objects aside)."""
    S, urls = rep["sections"], []
    obj = lambda it, **x: url_key("/api/object", bundle=it["bundle"], pid=it["pid"], **x)
    urls += [url_key("/api/report", id=rep["id"]), url_key("/api/patchnotes", id=rep["id"])]
    for it in S.get("images", []):
        o, n = it.get("old"), it.get("new")
        for side in (o, n):
            h = side and (side.get("h") if side.get("type") == "Texture2D" else side.get("tex"))
            if h:
                urls.append(url_key("/api/thumb", h=h))
        # the picture itself: every image with a path in the game (the nameless sheet pieces number tens of thousands)
        if n and it.get("path") and cfg["full_images"]:
            urls.append(obj(it))
    for sec in ("texts", "data", "video", "code"):
        for it in S.get(sec, []):
            n = it.get("new")
            if not n:
                continue
            if it.get("type") == "file":
                if n.get("blob") and not it.get("records") and not it.get("lines"):
                    urls.append(url_key("/api/blob", h=n["blob"]))
            elif it.get("bundle") and (it.get("type") != "VideoClip" or cfg["video"]):
                urls.append(obj(it) if it.get("type") in PREVIEW else obj(it, fmt="props"))
    if cfg["audio"]:
        for it in S.get("audio", []):
            sd = it.get("sounds") or {}
            for s in sd.get("added", []) + sd.get("changed", []):
                urls.append(url_key("/api/bank", path=it["path"], i=s[2]))
    for it in S.get("leaks", []):
        if it.get("kind") == "removed":
            continue
        if it.get("path"):
            urls += [url_key("/api/asset_thumb", path=it["path"]), "container:" + it["path"]]
        elif it.get("bundle") and it.get("pid"):
            urls.append(obj(it) if it.get("type") in PREVIEW else obj(it, fmt="props"))
    return list(dict.fromkeys(urls))


def unit_urls(units: dict) -> list[str]:
    """Requests of the Identities & E.G.O page (ui/db.js)."""
    from .uiicons import FONTS, ICONS
    urls = [url_key("/api/units"), url_key("/api/teams")]  # (+ the Team builder)
    urls += [url_key("/api/ui_icon", k=k) for k in ICONS] + [url_key("/api/ui_icon", k=f"sinner_{n}") for n in range(1, 13)]
    urls += [url_key("/api/font", name=n) for n in FONTS]
    thumbs, full = set(), set()

    def walk(o, key=""):
        if isinstance(o, dict):
            for k, v in o.items():
                walk(v, k)
        elif isinstance(o, list):
            for v in o:
                walk(v, key)
        elif isinstance(o, str) and o.startswith("Assets/"):
            (full if key in ("art", "art2") else thumbs).add(o)
    walk(units)
    for u in units.get("ids", []) + units.get("egos", []):
        # (a skill's picture is named by its `icon` where it has one, and the defense skills have pictures too: the
        # page and Guess the skill ask for them the same way — ui/db.js, ui/games2.js)
        for s in (u.get("skills") or []) + (u.get("defense") or []):
            icon = f"Assets/Resources_moved/Sprite/SkillIcon/{s.get('icon') or s['id']}.png"
            thumbs.add(icon)
            full.add(icon)  # drawn into its sin frame
    urls += [url_key("/api/asset_thumb", path=p) for p in sorted(thumbs)]
    urls += [url_key("/api/asset_img", path=p) for p in sorted(full)]
    return urls


# ------------------------------------------------------------------ files
def _ffmpeg() -> str:
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def _shrink(data: bytes, ctype: str, key: str = "") -> tuple[bytes, str]:
    """A smaller form of an answer for the web: PNG → WebP, WAV → Opus. Anything that fails stays as it is."""
    spine, music = key.startswith("/spine/"), key.startswith("/api/music_audio")
    try:
        if ctype == "image/png" and len(data) > 20_000:
            from PIL import Image
            im = Image.open(io.BytesIO(data))
            if im.mode not in ("RGB", "RGBA"):
                im = im.convert("RGBA")
            b = io.BytesIO()
            small = im.width * im.height <= 512 * 512
            # (a Spine page keeps the colour under its transparent pixels: the mesh edges sample it)
            im.save(b, "WEBP", lossless=small, quality=100 if small else 92, method=4, exact=spine)
            if b.tell() < len(data):
                return b.getvalue(), "image/webp"
        if ctype == "audio/wav":
            p = subprocess.run([_ffmpeg(), "-v", "error", "-i", "pipe:0", "-c:a", "libopus", "-b:a", "96k" if music else "72k", "-f", "ogg", "pipe:1"],
                               input=data, capture_output=True, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            if p.returncode == 0 and p.stdout:
                return p.stdout, "audio/ogg"
    except Exception:
        pass
    return data, ctype


def _grouped(got: dict, first: list[tuple[list, int]]) -> tuple[dict, list]:
    """A manifest's files in the order they are packed, and its "groups" [[how many requests, pack size], …]: each of
    `first` (requests, pack size) is a group of its own, the rest follows in packs of the usual size. The Games ask
    for one file at random a round, and a pack is fetched whole: what a game needs all of sits together, what it
    needs one of at a time sits in small packs."""
    urls, groups = {}, []
    for keys, size in first:
        n = 0
        for k in dict.fromkeys(keys):
            if k in got and k not in urls:
                urls[k] = got[k]
                n += 1
        groups.append([n, size])
    rest = {k: f for k, f in got.items() if k not in urls}
    urls.update(rest)
    groups.append([len(rest), PACK])
    return urls, groups


class Exporter:
    def __init__(self, svc, base_url: str, out: str | None = None, progress=None):
        self.svc, self.base, self.out = svc, base_url.rstrip("/"), out or out_dir(svc)
        self.cfg = config(svc)
        self.progress = progress or (lambda stage, done, total, msg="": None)
        self.failed: list[tuple[str, str]] = []
        self.fresh: dict[str, int] = {}  # what was asked from the app this time (not kept from before), by part of the site
        os.makedirs(os.path.join(self.out, "d", "m"), exist_ok=True)

    # -- one request → one file
    def _get(self, key: str) -> tuple[bytes, str]:
        with urlopen(self.base + _request(key), timeout=600) as r:
            data = r.read()
            if r.headers.get("Content-Encoding") == "gzip":
                data = gzip.decompress(data)
            return data, (r.headers.get("Content-Type") or "application/octet-stream").split(";")[0].strip()

    def _store(self, data: bytes, ctype: str, gz=False) -> str:
        ext = EXT.get(ctype, "bin") + (".gz" if gz else "")
        if gz:
            data = gzip.compress(data, 6, mtime=0)
        h = hashlib.sha1(data).hexdigest()
        rel = f"f/{h[:2]}/{h}.{ext}"
        full = os.path.join(self.out, "d", rel)
        if not os.path.exists(full):
            os.makedirs(os.path.dirname(full), exist_ok=True)
            tmp = f"{full}.{threading.get_ident()}.tmp"  # the same picture can come in from two requests at once
            with open(tmp, "wb") as f:
                f.write(data)
            try:
                os.replace(tmp, full)
            except OSError:
                os.remove(tmp)
        return rel

    def fetch(self, key: str, source: str | None = None) -> str | None:
        try:
            data, ctype = self._get(source or key)
        except Exception as e:  # 404 = nothing to show there in the app either
            self.failed.append((key, str(e)))
            return None
        data, ctype = _shrink(data, ctype, key)
        return self._store(data, ctype, gz=ctype in ("application/json", "text/plain") and len(data) > 4000)

    def fetch_all(self, keys: list[str], have: dict, stage: str, sources: dict | None = None) -> dict:
        """keys → {key: file}; `have` = the manifest written last time, whose files are kept.
        sources: {key: the request that really gives its content} where the page's own request isn't the one to make."""
        out, todo, sources = {}, [], sources or {}
        for k in keys:
            f = have.get(k)
            if f and os.path.exists(os.path.join(self.out, "d", f)):
                out[k] = f
            else:
                todo.append(k)
        done = [0]
        self.progress(stage, 0, len(todo))
        lock = threading.Lock()

        def one(k):
            f = self.fetch(k, sources.get(k))
            with lock:
                if f:
                    out[k] = f
                done[0] += 1
                self.progress(stage, done[0], len(todo), k)
        # sounds are decoded one at a time by the app (FMOD), pictures come from the bundles a few at once
        with ThreadPoolExecutor(4) as pool:
            list(pool.map(one, todo))
        self.fresh[stage.replace("site: ", "")] = sum(1 for k in todo if k in out)  # (the rest: the app has nothing there)
        return out

    def _text(self, key: str, have: dict) -> str:
        """An answer that names what else to fetch (a list, an atlas): read back from the file the site keeps for it,
        asked from the app only when there is none — a second "Send to site" walks the lists without the app."""
        rel = have.get(key)
        if rel:
            try:
                with (gzip.open if rel.endswith(".gz") else open)(os.path.join(self.out, "d", rel), "rt", encoding="utf-8", errors="replace") as f:
                    return f.read()
            except OSError:
                pass
        return self._get(key)[0].decode("utf-8", "replace")

    # -- manifests
    def _manifest_path(self, name: str) -> str:
        return os.path.join(self.out, "d", "m", name + ".json.gz")

    def read_manifest(self, name: str) -> dict:
        try:
            with gzip.open(self._manifest_path(name), "rt", encoding="utf-8") as f:
                m = json.load(f)
            return m if m.get("v") == VERSION else {}
        except (OSError, ValueError):
            return {}

    def write_manifest(self, name: str, m: dict):
        m["v"] = VERSION
        tmp = self._manifest_path(name) + ".tmp"
        with gzip.open(tmp, "wt", encoding="utf-8") as f:
            json.dump(m, f, ensure_ascii=False)
        os.replace(tmp, self._manifest_path(name))

    # -- pages
    def report(self, rid: str) -> dict | None:
        rep = public(self.svc.store.read_json(f"reports/{rid}.json.gz"))
        name = "report-" + hashlib.sha1(rid.encode()).hexdigest()[:12]
        if not any(rep["sections"].values()) and not rep["catalog"]["added"] and not rep["catalog"]["removed"]:
            # nothing of the game changed (only the player's own files did): not a report for the site
            for path in (self._manifest_path(name), os.path.join(self.out, "d", "tr", name + ".json.gz")):
                if os.path.exists(path):
                    os.remove(path)
            return None
        old = self.read_manifest(name)
        keys = report_urls(rep, self.cfg)
        keys.remove(url_key("/api/report", id=rid))  # the site gets the report as cleaned above, not the app's file
        # a highlighted path opens through the Files page's requests: its folder's listing, then what the path holds
        extra = []
        for k in [k for k in keys if k.startswith("container:")]:
            path = k[10:]
            keys.remove(k)
            c = url_key("/api/container", path=path)
            extra += [c, url_key("/api/tree", prefix=path.rpartition("/")[0])]
            try:
                rows = json.loads(self._get(c)[0])
            except Exception:
                rows = []
            for r in rows[:20]:
                o = {"bundle": r["bundle"], "pid": r["pid"]}
                extra.append(url_key("/api/object", **o) if r.get("type") in PREVIEW else url_key("/api/object", fmt="props", **o))
        urls = self.fetch_all(list(dict.fromkeys(keys + extra)), old.get("urls", {}), "site: " + rid[-15:])
        urls[url_key("/api/report", id=rid)] = self._store(json.dumps(rep, ensure_ascii=False).encode("utf-8"), "application/json", gz=True)
        meta = next((dict(r, summary=rep["summary"]) for r in self.svc.reports() if r["id"] == rid), None)
        # a texture without its full picture on the site opens as its stored preview
        for it in rep["sections"].get("images", []):
            n = it.get("new")
            k = n and url_key("/api/object", bundle=it["bundle"], pid=it["pid"])
            t = n and urls.get(url_key("/api/thumb", h=n.get("h")))
            if k and k not in urls and t and n.get("type") == "Texture2D":
                urls[k] = t
        m = {"kind": "report", "id": rid, "urls": urls, "meta": meta}
        self.write_manifest(name, m)
        self._translations(name, rep)
        return m

    def _translations(self, name: str, rep: dict):
        """The lines the UI would send to /api/translate, as far as the app has translated them already."""
        tr = self.svc.translator
        found = {}

        def take(v):
            s = js_string(v)
            if v is not None and CJK.search(s) and s not in found:
                t = tr.cache.get(tr._key(s))
                if t:
                    found[s] = t

        def records(rd):
            for r in rd.get("added", []) + rd.get("removed", []):
                for v in r.values():
                    take(v)
            for c in rd.get("changed", []):
                for a, b in c.get("fields", {}).values():
                    take(a)
                    take(b)
        for items in rep["sections"].values():
            for it in items:
                if it.get("records"):
                    records(it["records"])
        for f in rep.get("foreign_only", []):
            for r in f.get("records", []):
                for v in (r.get("record") or {}).values():
                    take(v)
        os.makedirs(os.path.join(self.out, "d", "tr"), exist_ok=True)
        with gzip.open(os.path.join(self.out, "d", "tr", name + ".json.gz"), "wt", encoding="utf-8") as f:
            json.dump(found, f, ensure_ascii=False)

    def units(self) -> dict:
        old = self.read_manifest("units")
        sid = self.svc.latest_snapshot_id()
        have = old.get("urls", {}) if old.get("id") == sid else {}  # another game version: every picture is asked again
        units = self.svc.unit_db()
        # (the lists are the app's own making: a newer app writes them anew for the same game version)
        got = self.fetch_all(unit_urls(units), {k: f for k, f in have.items() if k not in ("/api/units", "/api/teams")}, "site: Identities & E.G.O")
        # the Games draw these at random: every round shows four Identities' faces (all of them in a pack or two of
        # their own: fetched once, then every round is there) and Guess the skill one skill's picture (small packs)
        thumb = lambda p: url_key("/api/asset_thumb", path=p)  # noqa: E731
        ids = units.get("ids", [])
        faces = [thumb(x["img"]["thumb"]) for x in ids if (x.get("img") or {}).get("thumb")]
        icons = [thumb(f"Assets/Resources_moved/Sprite/SkillIcon/{s.get('icon') or s['id']}.png") for x in ids for s in x.get("skills", []) + x.get("defense", [])]
        # an Identity's / E.G.O's card: its art and its skills' pictures in a pack of its own (they lay scattered over
        # packs of the usual size: a megabyte each for a part of one), the second art, shown on a click, in the next
        img = lambda p: url_key("/api/asset_img", path=p)  # noqa: E731
        cards = []
        for x in ids + units.get("egos", []):
            im = x.get("img") or {}
            own = ([img(im["art"])] if im.get("art") else []) + [img(f"Assets/Resources_moved/Sprite/SkillIcon/{s.get('icon') or s['id']}.png")
                                                                  for s in (x.get("skills") or []) + (x.get("defense") or [])]
            cards.append((own, CARD_PACK))
            if im.get("art2"):
                cards.append(([img(im["art2"])], CARD_PACK))
        # the keywords' little pictures (1,500 of them, a card shows about ten): in small packs, by name
        words = sorted(k for k in got if k.startswith("/api/asset_thumb?") and "/Buf/" in k)
        urls, groups = _grouped(got, [(faces, PACK), (icons, GAME_PACK), (words, WORD_PACK)] + cards)
        m = {"kind": "units", "id": sid, "urls": urls, "groups": groups}
        self.write_manifest("units", m)
        return m

    def enemies(self) -> dict:
        """The enemy handbook (ui/enemies.js): the list, each entry's texts, the grid's pictures, the idle pose's
        Spine files and the skill icons."""
        old = self.read_manifest("enemies")
        sid = self.svc.latest_snapshot_id()
        have = old.get("urls", {}) if old.get("id") == sid else {}
        self.progress("site: Enemies", 0, 0)
        db = json.loads(self._get("/api/enemies")[0])
        keys = ["/api/enemies"] + [url_key("/api/enemy_thumb", app=a) for a in db.get("thumbs", [])]
        thumbs, full, seen = set(), set(), set()
        for e in db["list"]:
            k = url_key("/api/enemy", id=e["id"])
            keys.append(k)
            try:
                texts = json.loads(self._text(k, have))
            except Exception:
                continue
            for s in texts.get("skills", {}):
                icon = f"Assets/Resources_moved/Sprite/SkillIcon/{s}.png"
                thumbs.add(icon)
                full.add(icon)
            sp = texts.get("spine") or []
            # (the page's pick: ui/enemies.js enSpinePick)
            x = next((x for x in sp if not re.search(r"destroy|dead|broken|_die", x["base"], re.I)), sp[0] if sp else None)
            if e.get("pic"):
                thumbs.add(e["pic"])
                if not x:
                    full.add(e["pic"])
            if x and (x["bundle"], x["atlas"]) not in seen:
                seen.add((x["bundle"], x["atlas"]))
                base = f"/spine/{x['bundle']}/{x['atlas']}.2/"
                keys += [base + "skeleton.atlas", base + "skeleton.json"]
                try:  # the atlas names its pages: a line that is a file name
                    atlas = self._text(base + "skeleton.atlas", have)
                    keys += [base + ln.strip() for ln in atlas.splitlines() if ln.strip().lower().endswith(".png")]
                except Exception:
                    pass
        keys += [url_key("/api/asset_thumb", path=p) for p in sorted(thumbs)] + [url_key("/api/asset_img", path=p) for p in sorted(full)]
        got = self.fetch_all(list(dict.fromkeys(keys)), have, "site: Enemies")
        # the grid's pictures in small packs, in the grid's order: a screen of tiles is a few of them, and Guess the
        # enemy asks for one picture a round (a pack of the usual size each time before)
        tiles = [url_key("/api/enemy_thumb", app=e["app"]) for e in db["list"] if e.get("app")]
        urls, groups = _grouped(got, [(["/api/enemies"], PACK), (tiles, VOICE_PACK)])
        m = {"kind": "enemies", "id": sid, "urls": urls, "groups": groups}
        self.write_manifest("enemies", m)
        return m

    def music(self) -> dict:
        """The corner player's soundtrack: every track straight from its sound bank as Opus (the app's own answer is
        AAC made for its player's cache)."""
        old = self.read_manifest("music")
        tracks = self.svc.music()["tracks"]
        src = {url_key("/api/music_audio", n=n): url_key("/api/bank", path=t["bank"], i=t["i"]) for n, t in enumerate(tracks)}
        # the player numbers the tracks: a file is kept only while its number still means the same sound
        have = {k: f for k, f in old.get("urls", {}).items() if old.get("src", {}).get(k) == src.get(k)}
        urls = self.fetch_all(list(src), have, "site: Music", src)
        urls["/api/music"] = self.fetch("/api/music") or ""
        m = {"kind": "music", "id": self.svc.latest_snapshot_id(), "urls": {k: f for k, f in urls.items() if f}, "src": src}
        self.write_manifest("music", m)
        return m

    def anim(self) -> dict:
        """The Animations page as far as a browser can play it alone: the Spine skeletons (animated art of Identities
        and E.G.O, enemies, abnormalities, the RPG's people) with the illustration's layers around them, and the
        Identities' and E.G.O's battle animations (clips() — with them every Identity and E.G.O is in the list;
        without, only those with a skeleton). Renders with effects need the game's files and the app."""
        old = self.read_manifest("anim")
        sid = self.svc.latest_snapshot_id()
        have = old.get("urls", {}) if old.get("id") == sid else {}
        self.progress("site: Animations", 0, 0)
        for _ in range(100):  # the enemies' chapters are sorted in the background on the first run
            chars = json.loads(self._get("/api/characters")[0])
            if not chars.get("pending"):
                break
            time.sleep(4)
        if not self.cfg["clips"]:
            for s in chars["sinners"]:
                s["ids"] = [x for x in s["ids"] if x.get("spine")]
                s["egos"] = [x for x in s["egos"] if x.get("spine")]
        for g in chars["groups"]:
            g["kinds"] = {k: arr for k, arr in ((k, [x for x in arr if not x.get("app")]) for k, arr in g["kinds"].items()) if arr}
        chars["groups"] = [g for g in chars["groups"] if g["kinds"]]
        chars["pending"] = False
        todo = [x for s in chars["sinners"] for c in s["ids"] + s["egos"] for x in c["spine"]]
        todo += [x for g in chars["groups"] for arr in g["kinds"].values() for x in arr]
        keys, seen = [], set()

        def skeleton(bundle, atlas):
            if (bundle, str(atlas)) in seen:
                return
            seen.add((bundle, str(atlas)))
            base = f"/spine/{bundle}/{atlas}.2/"
            keys.extend([base + "skeleton.atlas", base + "skeleton.json"])
            try:  # the atlas names its pages: a line that is a file name
                text = self._text(base + "skeleton.atlas", have)
                keys.extend(base + ln.strip() for ln in text.splitlines() if ln.strip().lower().endswith(".png"))
            except Exception:
                pass
        for i, x in enumerate(todo):
            if i % 25 == 0:
                self.progress("site: Animations (list)", i, len(todo))
            skeleton(x["bundle"], x["atlas"])
            k = url_key("/api/spine_scene", bundle=x["bundle"], atlas=x["atlas"])
            keys.append(k)
            try:
                scene = json.loads(self._text(k, have))
            except Exception:
                continue
            for l in scene.get("layers") or []:
                if l.get("kind") == "spine":
                    skeleton(x["bundle"], l["atlas"])
                elif l.get("sprite"):
                    keys.append(url_key("/api/scene_sprite", bundle=x["bundle"], pid=l["sprite"]))
                    fx = (l.get("material") or {}).get("fx") or {}
                    keys.extend(url_key("/api/object", bundle=x["bundle"], pid=fx[n]) for n in ("noise", "dissolve") if fx.get(n))
        if self.cfg["clips"]:
            keys += self.clips([c["id"] for s in chars["sinners"] for c in s["ids"] + s["egos"]], have)
        urls = self.fetch_all(list(dict.fromkeys(keys)), have, "site: Animations")
        urls["/api/characters"] = self._store(json.dumps(chars, ensure_ascii=False).encode("utf-8"), "application/json", gz=True)
        m = {"kind": "anim", "id": sid, "urls": urls}
        self.write_manifest("anim", m)
        return m

    def _stored(self, rel: str):
        """A JSON answer back from the file it was stored in."""
        with (gzip.open if rel.endswith(".gz") else open)(os.path.join(self.out, "d", rel), "rt", encoding="utf-8") as f:
            return json.load(f)

    def clips(self, ids: list, have: dict) -> list[str]:
        """Battle animations of the Identities and E.G.O (ui/app.js loadClip): each one's list of clips, every clip
        with and without "all animated layers", and the sprites the clips draw. → the requests, lists first; the
        lists and the clips are fetched here (they name what comes next), the sprites by the caller."""
        lists = [url_key("/api/owner_clips", id=i) for i in ids]
        got = self.fetch_all(lists, have, "site: Animations (clip lists)")
        # what the lists and the clips named the last time is kept (d/clips.json, not uploaded) and stands while
        # their files are the same ones: thousands of files aren't read again for a list that didn't change
        sig = lambda keys, files: hashlib.sha1("\n".join(files.get(k) or "" for k in keys).encode()).hexdigest()  # noqa: E731
        kept_path = os.path.join(self.out, "d", "clips.json")
        kept = _read_json(kept_path)
        if kept.get("lists") == sig(lists, got):
            clips = kept["clips"]
        else:
            clips = []
            for k in lists:
                try:
                    clips += [url_key("/api/clip", bundle=c["bundle"], clip=c["clip"], go=js_string(c["animator_go"]), all=a)
                              for c in self._stored(got[k]) for a in (0, 1)]
                except (KeyError, OSError, ValueError, TypeError):
                    pass
            clips = list(dict.fromkeys(clips))
            kept = {}
        now = {"lists": sig(lists, got), "clips": clips}
        have.update(got)
        got = self.fetch_all(clips, have, "site: Animations (clips)")
        have.update(got)
        now["files"] = sig(clips, got)
        if kept.get("files") == now["files"]:
            sprites = kept["sprites"]
        else:
            sprites = []
            for k in clips:
                try:
                    sprites += [url_key("/api/object", bundle=sp["bundle"], pid=sp["pid"]) for sp in self._stored(got[k])["sprites"].values()]
                except (KeyError, OSError, ValueError, TypeError, AttributeError):
                    pass
            now["sprites"] = sprites
            with open(kept_path, "w", encoding="utf-8") as f:
                json.dump(now, f)
        return lists + clips + sprites

    def quiz(self) -> dict:
        """Games → Guess the Identity (ui/games2.js): the voice lines' list and every line as sound. (Guess the skill
        plays with the Identities' data, Guess the track with the music.)"""
        old = self.read_manifest("quiz")
        sid = self.svc.latest_snapshot_id()
        have = old.get("urls", {}) if old.get("id") == sid else {}
        q = self.svc.quiz()
        samples = {e[0] for e in (q.get("ids") or []) + (q.get("bosses") or []) if e}  # an entry: [sample name, whose, …]
        samples |= {ln[0] for c in q.get("chars") or [] for ln in c.get("lines") or []}  # Guess the character: [sample, text, where]
        keys = ["/api/quiz"] + [url_key("/api/quiz_audio", s=s) for s in sorted(samples)]
        # Guess the character: the speakers' pictures from the story's log
        keys += [url_key("/api/asset_thumb", path=p) for p in sorted({c.get("pic") for c in q.get("chars") or []} - {None, ""})]
        # (the list is the app's own making: a newer app has more in it for the same game version)
        got = self.fetch_all(keys, {k: f for k, f in have.items() if k != "/api/quiz"}, "site: Games (voice lines)")
        # a round plays one line out of thousands: the lines sit in small packs (a pack is fetched whole)
        urls, groups = _grouped(got, [(keys[:1], PACK), ([k for k in keys if k.startswith("/api/quiz_audio")], VOICE_PACK)])
        m = {"kind": "quiz", "id": sid, "urls": urls, "groups": groups}
        self.write_manifest("quiz", m)
        return m

    def scenes(self) -> dict:
        """Games → Guess the Canto (ui/games3.js): the story's backgrounds, full size (a round zooms into one) and
        their previews (the result's table). The list names them from the folder on, so the check takes none of
        them by itself."""
        old = self.read_manifest("scenes")
        sid = self.svc.latest_snapshot_id()
        have = old.get("urls", {}) if old.get("id") == sid else {}
        try:
            story = json.loads(self._get("/api/game_pics")[0]).get("story") or {}
        except Exception as e:
            self.failed.append(("/api/game_pics", str(e)))
            story = {}
        paths = sorted({"Assets/Resources_moved/Story/Backgrounds/" + p for ps in story.values() for p in ps})
        full = [url_key("/api/asset_img", path=p) for p in paths]
        thumbs = [url_key("/api/asset_thumb", path=p) for p in paths]
        got = self.fetch_all(["/api/game_pics"] + full + thumbs, {k: f for k, f in have.items() if k != "/api/game_pics"},
                             "site: Games (story backgrounds)")
        # a round shows one background out of hundreds: a pack each, or nearly (a pack is fetched whole)
        urls, groups = _grouped(got, [(["/api/game_pics"], PACK), (full, SCENE_PACK), (thumbs, GAME_PACK)])
        m = {"kind": "scenes", "id": sid, "urls": urls, "groups": groups}
        self.write_manifest("scenes", m)
        # (the check fetched the list by itself before this part existed, without the backgrounds: that copy would win)
        extra = self.read_manifest("extra")
        if "/api/game_pics" in extra.get("urls", {}):
            del extra["urls"]["/api/game_pics"]
            self.write_manifest("extra", extra)
        return m

    def gacha(self) -> dict:
        """Games → Extraction (ui/games5.js): the banners' list, their pictures, the extraction's own pictures and
        sounds, the lines E.G.O say. (The Identities' lines are among the quiz's, the art among the units'.)"""
        from . import gacha
        old = self.read_manifest("gacha")
        sid = self.svc.latest_snapshot_id()
        have = old.get("urls", {}) if old.get("id") == sid else {}
        g = gacha.build(self.svc)
        keys = ["/api/gacha"] + [url_key("/api/gacha_ui", n=n) for n in gacha.UI_USED]
        keys += [url_key("/api/asset_img", path=b[k]) for b in g["banners"] for k in ("tile", "typo", "illust") if b.get(k)]
        sounds = [url_key("/api/quiz_audio", s=s) for s in sorted(set(g["snd"].values()))]
        voices = [url_key("/api/quiz_audio", s=v[0]) for v in g["lines"].values() if v[0]]
        got = self.fetch_all(keys + sounds + voices, {k: f for k, f in have.items() if k != "/api/gacha"}, "site: Games (Extraction)")
        urls, groups = _grouped(got, [(keys + sounds, PACK), (voices, VOICE_PACK)])
        m = {"kind": "gacha", "id": sid, "urls": urls, "groups": groups}
        self.write_manifest("gacha", m)
        return m

    CARDS = 9  # pictures kept for each card of the Games page (it draws three)

    def cards(self) -> dict:
        """The Games page's cards (ui/games.js gmHubPics): the app picks random pictures each time; the site keeps one
        handful per game, picked once per game version, under requests of their own ("hub=1") — so they sit together
        in a pack or two instead of one pack each. The list itself is answered from index.json."""
        from urllib.parse import parse_qsl, urlsplit
        old = self.read_manifest("cards")
        sid = self.svc.latest_snapshot_id()
        try:
            picked = json.loads(self._get(f"/api/game_cards?n={self.CARDS}")[0])
        except Exception as e:
            self.failed.append(("/api/game_cards", str(e)))
            picked = {}
        # the app's answer is a preset (server.CARD_PRESET): the same as last time unless the preset was changed
        kept = old.get("id") == sid and (old.get("cards") or {}) == picked
        if kept:
            picked = old["cards"]  # the same pictures as last time: nothing is uploaded again
        key = lambda u: url_key(urlsplit(u).path, **dict(parse_qsl(urlsplit(u).query)))  # noqa: E731
        keys = list(dict.fromkeys(key(u) for us in picked.values() for u in us))
        urls = self.fetch_all(keys, old.get("urls", {}) if kept else {}, "site: Games (cards)")
        m = {"kind": "cards", "id": sid, "urls": urls, "cards": {g: [u for u in us if key(u) in urls] for g, us in picked.items()}}
        self.write_manifest("cards", m)
        return m

    def extra(self, keys: list[str]) -> int:
        """Requests the check found unanswered, fetched as they are (manifest "extra"); a list that comes back is read
        for the game's picture paths, whose previews and pictures are fetched too. Returns how many got a file."""
        old = self.read_manifest("extra")
        sid = self.svc.latest_snapshot_id()
        urls = dict(old.get("urls", {})) if old.get("id") == sid else {}
        got = self.fetch_all([k for k in keys if k not in urls], {}, "site: what the pages asked for")
        paths = set()

        def walk(o):
            if isinstance(o, dict):
                for v in o.values():
                    walk(v)
            elif isinstance(o, list):
                for v in o:
                    walk(v)
            elif isinstance(o, str) and o.startswith("Assets/") and "." in o[-6:]:
                paths.add(o)
        for k, f in got.items():
            if ".json" in f:
                try:
                    walk(json.loads(self._get(k)[0]))
                except Exception:
                    pass
        more = [url_key(ep, path=p) for p in sorted(paths) for ep in ("/api/asset_thumb", "/api/asset_img")]
        got.update(self.fetch_all([k for k in more if k not in urls], {}, "site: their pictures"))
        urls.update(got)
        self.write_manifest("extra", {"kind": "extra", "id": sid, "urls": urls})
        return len(got)

    def buffs(self) -> dict:
        """Database → Buff effects (ui/buffs.js): the list and the effects' videos the app has made by now (they are
        drawn by the Unity player on this computer: the page's "Make all videos"). The site's list says of every
        other effect that it has no video, and that nothing can be made there."""
        from .viewer import _safe_name
        old = self.read_manifest("buffs")
        fx = self.svc.buff_fx
        made = os.path.basename(fx.folder())  # (named by the game version and what draws the videos)
        have = old.get("urls", {}) if old.get("id") == made else {}
        st = {"list": fx.db()["list"], **fx.status()}
        names = list(dict.fromkeys(n for b in st["list"] for n in b.get("fx") or []))
        ready = set(st["have"])
        keys = [url_key("/api/buff_video", name=n) for n in names if _safe_name(n) in ready]
        urls = self.fetch_all(keys, have, "site: Buff effects")
        on_site = {n for n in names if url_key("/api/buff_video", name=n) in urls}
        st.update(have=sorted({_safe_name(n) for n in on_site}), failed=[n for n in names if n not in on_site],
                  queue=0, current=[], busy=False, error="", available=False)
        urls["/api/buffs"] = self._store(json.dumps(st, ensure_ascii=False).encode("utf-8"), "application/json", gz=True)
        m = {"kind": "buffs", "id": made, "urls": urls}
        self.write_manifest("buffs", m)
        # (the check fetched the list by itself before this part existed: that copy would win over this one)
        extra = self.read_manifest("extra")
        if any(k.startswith("/api/buff") for k in extra.get("urls", {})):
            extra["urls"] = {k: f for k, f in extra["urls"].items() if not k.startswith("/api/buff")}
            self.write_manifest("extra", extra)
        return m

    def small(self) -> dict:
        """Pages that are one list each, asked again every time: News (the developers' notices from Steam, as they
        are when the site is sent)."""
        urls = self.fetch_all(["/api/news"], {}, "site: News")
        m = {"kind": "small", "id": self.svc.latest_snapshot_id(), "urls": urls}
        self.write_manifest("small", m)
        return m

    def open_routes(self) -> list[str]:
        return _read_json(os.path.join(self.out, "d", "check.json")).get("open") or BASE_OPEN

    def pages(self):
        """Everything but the reports."""
        if self.cfg["games"]:
            self.quiz()
            self.cards()
            self.scenes()
            self.gacha()
        self.units()
        self.small()
        self.buffs()
        if self.cfg["spine"]:  # (the Animations page: its "With effects" tab — limbusdm/sitefx.py)
            from . import sitefx
            sitefx.export(self)
        if self.cfg["spine"]:
            self.anim()
        if self.cfg["enemies"]:
            self.enemies()
        if self.cfg["music"]:
            self.music()

    # -- the site around the data
    def shell(self):
        """index.html, the UI's files and the service worker; d/index.json from the manifests that are there."""
        ui = os.path.join(resource_dir(), "ui")
        shutil.copytree(ui, os.path.join(self.out, "ui"), dirs_exist_ok=True, ignore=shutil.ignore_patterns("*.ico"))
        shutil.copyfile(os.path.join(ui, "site", "sw.js"), os.path.join(self.out, "sw.js"))
        with open(os.path.join(ui, "index.html"), encoding="utf-8") as f:
            html = f.read()
        # the UI's scripts start asking /api at once: they are loaded only when the service worker is in charge
        scripts = re.findall(r'<script src="([^"]+)"></script>\s*', html)
        html = re.sub(r'<script src="[^"]+"></script>\s*', "", html)
        stamp = str(int(time.time()))
        boot = f"""<script>
const SITE = {json.dumps({"contact": self.cfg["contact"], "build": build_info(self.svc), "open": self.open_routes(), "scripts": [s + "?" + stamp for s in scripts + ["/ui/site/site.js"]]})};
(async () => {{
  const fail = (m) => {{ document.getElementById("main").innerHTML = '<div class="empty">' + m + '</div>'; }};
  if (!("serviceWorker" in navigator)) return fail("This site needs service workers — open it in a normal (not private) window of a current browser.");
  try {{
    await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {{
      // the first visit: the page (its fonts, its pictures) started before the worker could answer — start again with it
      if (!sessionStorage.getItem("sw-reload")) {{ sessionStorage.setItem("sw-reload", "1"); return location.reload(); }}
      await new Promise((ok) => navigator.serviceWorker.addEventListener("controllerchange", ok, {{ once: true }}));
    }}
    sessionStorage.removeItem("sw-reload");
    navigator.serviceWorker.controller.postMessage("reload");
  }} catch (e) {{ return fail("Couldn't start: " + e.message); }}
  // (all asked for at once; "async = false" keeps the order they run in — one after another they cost a round trip each)
  await Promise.all(SITE.scripts.map((src) => new Promise((ok, bad) => {{
    const s = document.createElement("script"); s.src = src; s.async = false; s.onload = ok; s.onerror = bad; document.body.appendChild(s); }})));
}})();
</script>
"""
        html = html.replace("</head>", '<meta name="robots" content="noindex, nofollow">\n'
                            f'<link rel="stylesheet" href="/ui/site/site.css?{stamp}">\n</head>')
        html = html.replace("</body>", boot + "</body>")
        with open(os.path.join(self.out, "index.html"), "w", encoding="utf-8") as f:
            f.write(html)
        with open(os.path.join(self.out, "robots.txt"), "w") as f:
            f.write("User-agent: *\nDisallow: /\n")
        self.index()

    def index(self):
        names = sorted(fn[:-8] for fn in os.listdir(os.path.join(self.out, "d", "m")) if fn.endswith(".json.gz"))
        ms = {n: self.read_manifest(n) for n in names}
        reports = sorted((m["meta"] for m in ms.values() if m.get("kind") == "report" and m.get("meta")),
                         key=lambda r: r["id"], reverse=True)
        snaps = {s["id"]: s for s in self.svc.snapshots()}
        used = [snaps[i] for i in sorted({r[k] for r in reports for k in ("old", "new")} & set(snaps))]
        state = {"game": {"ok": True, "dir": "", "catalog": ""}, "snapshots": used, "reports": reports, "job": None,
                 "watch": {"state": "", "last_check": ""}, "settings": {}, "data_dir": "", "update": None,
                 "version": __import__("limbusdm").__version__, "site": True}
        idx = {"v": VERSION, "stamp": int(time.time()), "build": build_info(self.svc), "manifests": [n for n in names if ms[n]],
               "tr": sorted(fn[:-8] for fn in os.listdir(os.path.join(self.out, "d", "tr")) if fn.endswith(".json.gz"))
               if os.path.isdir(os.path.join(self.out, "d", "tr")) else [],
               # answered from the net by the visitor's browser itself: the list of live streams, made on GitHub
               "live": {"/api/community": __import__("limbusdm.community", fromlist=["URL"]).URL},
               "inline": {"/api/state": state, "/api/marks": {}, "/api/appnotes": {}, "/api/mods_owned": [], "/api/patchnotes?new=1": {"id": None},
                          "/api/game_cards": (ms.get("cards") or {}).get("cards") or {}}}
        with open(os.path.join(self.out, "d", "index.json"), "w", encoding="utf-8") as f:
            json.dump(idx, f, ensure_ascii=False)

    def remove_report(self, rid: str):
        name = "report-" + hashlib.sha1(rid.encode()).hexdigest()[:12]
        for p in (self._manifest_path(name), os.path.join(self.out, "d", "tr", name + ".json.gz")):
            if os.path.exists(p):
                os.remove(p)
        self.sweep()
        self.index()

    def sweep(self) -> int:
        """Delete the files no manifest points at any more."""
        keep = set()
        for fn in os.listdir(os.path.join(self.out, "d", "m")):
            if fn.endswith(".json.gz"):
                keep.update(self.read_manifest(fn[:-8]).get("urls", {}).values())
        n = 0
        root = os.path.join(self.out, "d", "f")
        for d, _, files in os.walk(root):
            for fn in files:
                rel = "f/" + os.path.relpath(os.path.join(d, fn), root).replace("\\", "/")
                if rel not in keep:
                    os.remove(os.path.join(d, fn))
                    n += 1
        return n


def export(svc, base_url: str, reports: list[str] | None = None, units=True, progress=None) -> dict:
    """Write the site: the given reports (all of them when None) and the Identities & E.G.O database."""
    ex = Exporter(svc, base_url, progress=progress)
    for rid in reports if reports is not None else [r["id"] for r in svc.reports()]:
        ex.report(rid)
    if units:
        ex.pages()
    ex.shell()
    return {"dir": ex.out, "failed": len(ex.failed), "size": size_of(ex.out)}


def deploy(svc, progress=None) -> str:
    """Upload data/site_packed with Cloudflare's wrangler (needs Node.js and `npx wrangler login` done once on this
    computer); only the files the host doesn't have yet go up. Returns the site's address."""
    cfg = config(svc)
    npx = shutil.which("npx")
    if not npx:
        raise RuntimeError("Node.js isn't installed — the upload runs Cloudflare's wrangler through npx")
    # run from the data folder: wrangler keeps its own files next to where it runs and reads a config it finds there
    p = subprocess.Popen([npx, "--yes", "wrangler@4", "deploy", "--name", cfg["project"], "--assets", packed_dir(svc),
                          "--compatibility-date", "2026-10-01"], cwd=svc.data_dir, stdin=subprocess.DEVNULL,
                         stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace",
                         creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    tail, url = [], cfg["url"]
    for line in p.stdout:
        line = line.strip()
        if not line:
            continue
        tail = (tail + [line])[-12:]
        m = re.search(r"Uploaded (\d+) of (\d+) assets", line)
        if m and progress:
            progress("site: uploading", int(m.group(1)), int(m.group(2)))
        m = re.search(r"https://\S+\.workers\.dev", line)
        if m:
            url = m.group(0)
    if p.wait() != 0:
        raise RuntimeError("upload failed: " + " | ".join(tail[-4:]))
    return url


def verify(ex: "Exporter", progress=None) -> dict:
    """Open every page of the packed site in a headless browser (limbusdm/sitecheck.py); fetch what a page asked for
    and the site lacked where that is a plain request; decide which pages the site opens. Leaves data/site_packed
    ready to upload. → {"checked", "opened": pages opened beyond BASE_OPEN, "healed", "misses": {page: [requests]}, "error"}"""
    from . import sitecheck
    packed = packed_dir(ex.svc)
    res = sitecheck.check(packed, progress=progress)
    if res["error"]:
        return {"error": res["error"], "checked": 0, "opened": [], "healed": 0, "misses": {}}
    want = sorted({k for ks in res["misses"].values() for k in ks if not NO_HEAL.search(k)})
    healed = ex.extra(want) if want else 0
    if healed:
        ex.shell()
        pack(ex.out, packed)
        again = sitecheck.check(packed, routes=list(res["misses"]), progress=progress)
        if not again["error"]:
            res["misses"] = again["misses"]
    pages = [r for r in res["routes"] if r not in sitecheck.APP_ONLY]
    opened = [r for r in pages if r in BASE_OPEN or r not in res["misses"]]
    out = {"error": None, "when": int(time.time()), "checked": len(pages), "open": opened, "healed": healed,
           "opened": [r for r in opened if r not in BASE_OPEN], "misses": res["misses"]}
    with open(os.path.join(ex.out, "d", "check.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)
    ex.shell()
    pack(ex.out, packed)
    return out


def _listing(root: str) -> dict:
    """{file: what tells its content} of the packed site. A pack and a file on its own are named by their content, so
    their size is enough; the pages and the lists are compared by a hash."""
    out = {}
    for d, _, files in os.walk(root):
        for fn in files:
            full = os.path.join(d, fn)
            rel = os.path.relpath(full, root).replace("\\", "/")
            if rel.startswith(("d/p/", "d/f/")):
                out[rel] = os.path.getsize(full)
            else:
                with open(full, "rb") as f:
                    out[rel] = hashlib.sha1(f.read()).hexdigest()[:12]
    return out


SEND_LOG = "site_log.json"  # how every "Send to site" ended (the toast that says so is gone in seconds)
SEND_LOG_KEEP = 30


def _log_send(svc, entry: dict):
    path = os.path.join(svc.data_dir, SEND_LOG)
    rows = (_read_json(path).get("list") or []) + [entry]
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump({"list": rows[-SEND_LOG_KEEP:]}, f)
    except OSError:
        pass


def publish(svc, base_url: str, report: str | None = None, progress=None) -> dict:
    """The app's "Send to site" with its outcome written down: done or failed, at which step and why (Settings ->
    Website shows the list)."""
    progress = progress or (lambda stage, done, total, msg="": None)
    at, t0 = ["starting"], time.time()

    def note(stage, done, total, msg=""):
        at[0] = stage
        progress(stage, done, total, msg)
    entry = {"when": int(t0), "build": build_info(svc).get("version"), "report": report or ""}
    try:
        r = _publish(svc, base_url, report, note)
    except BaseException as e:
        # (the upload's own words come with the terminal's colour codes)
        why = "cancelled" if isinstance(e, InterruptedError) else re.sub(r"\x1b\[[0-9;]*m", "", f"{type(e).__name__}: {e}")
        _log_send(svc, {**entry, "took": round(time.time() - t0), "ok": False, "stage": at[0], "error": why})
        raise
    _log_send(svc, {**entry, "took": round(time.time() - t0), "ok": True, "uploaded": bool(r.get("site")),
                    "sent": r.get("sent") or {"files": r.get("files"), "bytes": r.get("bytes"), "check": r.get("check")}})
    return r


def _publish(svc, base_url: str, report: str | None, progress) -> dict:
    """This report (with the ones sent before) and the Identities & E.G.O database written out, packed and
    uploaded."""
    ex = Exporter(svc, base_url, progress=progress)
    if report:
        ex.report(report)
    ex.pages()
    ex.shell()
    progress("site: packing", 0, 0)
    size = pack(ex.out, packed_dir(svc))
    chk = verify(ex, progress)
    size = size_of(packed_dir(svc))
    cfg = config(svc)
    if not cfg["project"]:
        return {"site": "", "dir": packed_dir(svc), "check": chk, **size}
    # what this upload changes on the site: the packed folder's files next to the ones sent the last time
    sent_path = os.path.join(svc.data_dir, "site_sent.json")
    before, root = _read_json(sent_path).get("files") or {}, packed_dir(svc)
    now = _listing(root)
    new = [k for k, v in now.items() if before.get(k) != v]
    progress("site: uploading", 0, 0)
    url = deploy(svc, progress)
    build = build_info(svc)
    last = {"when": int(time.time()), "build": build, "report": report or "",
            "uploaded": len(new), "uploaded_bytes": sum(os.path.getsize(os.path.join(root, k)) for k in new),
            "removed": sum(1 for k in before if k not in now), "first": not before,
            "pages": any(k.startswith("ui/") or k in ("index.html", "sw.js") for k in new),
            "data": {k: n for k, n in ex.fresh.items() if n}, "files": size["files"], "bytes": size["bytes"], "check": chk}
    with open(sent_path, "w", encoding="utf-8") as f:
        json.dump({"files": now, "last": last}, f)
    return {"site": url, "dir": packed_dir(svc), "sent": last, **size}


def size_of(root: str) -> dict:
    n = total = 0
    for d, _, files in os.walk(root):
        for fn in files:
            n += 1
            total += os.path.getsize(os.path.join(d, fn))
    return {"files": n, "bytes": total}


PACK = 1 << 20  # a pack is fetched whole (hosts of static files don't all answer byte ranges), so it stays small
# what the Games ask for one at a time, at random (a manifest's "groups", see _grouped): smaller packs — less to fetch
# for one file, more files on the host
HOST_MAX = 24 << 20  # the host takes no file above 25 MiB: a bigger one goes up in parts the service worker joins
# A video is cut into parts as well: the host sends a file whole or not at all, so a player waited for all of it (18 s
# for the biggest) before the first frame; from parts the worker answers the piece a player asks for.
VIDEO_WHOLE = 4 << 20  # (a smaller one comes whole: about a second)
VIDEO_PART = 2 << 20
CARD_PACK = 2 << 20  # one Identity's / E.G.O's art and skill pictures: its card in one fetch
WORD_PACK = 64 << 10  # keyword pictures, ~5 KB each
GAME_PACK = 128 << 10  # skill pictures, ~15 KB each
VOICE_PACK = 256 << 10  # voice lines, ~60 KB each
SCENE_PACK = 384 << 10  # story backgrounds, ~350 KB each


def packed_dir(svc) -> str:
    return os.path.join(svc.data_dir, "site_packed")


def pack(src: str, dst: str) -> dict:
    """The site as it goes up: a manifest's thousands of small files glued into packs (a host counts files).

    A manifest then names a small file as [pack, offset, length, extension]; the service worker fetches the pack
    once, keeps it and cuts the file out. Files go into packs in the order the page lists them, so one screen of
    pictures is a pack or two; a manifest's "groups" [[how many requests, pack size], …] start a pack anew and set
    its size for a run of them (_grouped). Packs are named by what is in them: a report that didn't change gives the same packs
    again and nothing of it is uploaded twice. Files of PACK size and up (music, video, big art) stay on their own."""
    shutil.rmtree(os.path.join(dst, "ui"), ignore_errors=True)
    os.makedirs(dst, exist_ok=True)
    for name in os.listdir(src):
        a, b = os.path.join(src, name), os.path.join(dst, name)
        if name == "ui":
            shutil.copytree(a, b)
        elif os.path.isfile(a):
            shutil.copyfile(a, b)
    for sub in ("m", "p", "tr", "f"):
        os.makedirs(os.path.join(dst, "d", sub), exist_ok=True)
    shutil.copyfile(os.path.join(src, "d", "index.json"), os.path.join(dst, "d", "index.json"))
    shutil.copytree(os.path.join(src, "d", "tr"), os.path.join(dst, "d", "tr"), dirs_exist_ok=True)
    packs, loose, parts = set(), set(), {}  # parts: {a part's file: (the big file, where the part starts in it)}
    for fn in sorted(os.listdir(os.path.join(src, "d", "m"))):
        with gzip.open(os.path.join(src, "d", "m", fn), "rt", encoding="utf-8") as f:
            m = json.load(f)
        groups, cur, n, seen = [], [], 0, set()
        runs = [(i, size) for i, (count, size) in enumerate(m.get("groups") or []) for _ in range(count)]  # per request: its run and pack size
        at = None
        for i, rel in enumerate(m.get("urls", {}).values()):
            if rel in seen:
                continue
            seen.add(rel)
            run, limit = runs[i] if i < len(runs) else (-1, PACK)
            size = os.path.getsize(os.path.join(src, "d", rel))
            if size >= PACK:
                loose.add(rel)
                continue
            if cur and (n + size > limit or run != at):
                groups.append(cur)
                cur, n = [], 0
            at = run
            cur.append((rel, size))
            n += size
        if cur:
            groups.append(cur)
        where = {rel: rel for rel in loose}
        for rel in loose:  # in parts: {"parts": […], "size", "part": a part's size, "ext"} (ui/site/sw.js)
            size, ext = os.path.getsize(os.path.join(src, "d", rel)), rel.rsplit(".", 1)[-1]
            step = VIDEO_PART if ext in ("mp4", "webm") and size > VIDEO_WHOLE else HOST_MAX if size > HOST_MAX else 0
            if step:
                # (a part's name says how the file was cut: a visitor's browser keeps parts by their names)
                names = [f"{rel}.{step >> 10}k.{i}" for i in range(-(-size // step))]
                where[rel] = {"parts": names, "size": size, "part": step, "ext": ext}
                parts.update({p: (rel, i * step, min(step, size - i * step)) for i, p in enumerate(names)})
        for g in groups:
            name = hashlib.sha1("\n".join(rel for rel, _ in g).encode()).hexdigest()[:20] + ".bin"
            packs.add(name)
            full, off = os.path.join(dst, "d", "p", name), 0
            write = not os.path.exists(full) or os.path.getsize(full) != sum(size for _, size in g)
            out = open(full + ".tmp", "wb") if write else None
            for rel, size in g:
                where[rel] = [name, off, size, rel.split(".", 1)[1]]
                off += size
                if out:
                    with open(os.path.join(src, "d", rel), "rb") as f:
                        shutil.copyfileobj(f, out)
            if out:
                out.close()
                os.replace(full + ".tmp", full)
        m["urls"] = {k: where[rel] for k, rel in m.get("urls", {}).items()}
        with gzip.open(os.path.join(dst, "d", "m", fn), "wt", encoding="utf-8") as f:
            json.dump(m, f, ensure_ascii=False)
    whole = {v[0] for v in parts.values()}
    for rel in loose - whole:
        full = os.path.join(dst, "d", rel)
        if not os.path.exists(full):
            os.makedirs(os.path.dirname(full), exist_ok=True)
            shutil.copyfile(os.path.join(src, "d", rel), full)
    for p, (rel, off, size) in parts.items():
        full = os.path.join(dst, "d", p)
        if os.path.exists(full) and os.path.getsize(full) == size:
            continue
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(os.path.join(src, "d", rel), "rb") as f, open(full + ".tmp", "wb") as out:
            f.seek(off)
            out.write(f.read(size))
        os.replace(full + ".tmp", full)
    loose = (loose - whole) | set(parts)
    for sub, keep in (("p", packs), ("m", set(os.listdir(os.path.join(src, "d", "m")))), ("tr", set(os.listdir(os.path.join(src, "d", "tr"))))):
        for fn in os.listdir(os.path.join(dst, "d", sub)):
            if fn not in keep:
                os.remove(os.path.join(dst, "d", sub, fn))
    root = os.path.join(dst, "d", "f")
    for d, _, files in os.walk(root):
        for fn in files:
            if "f/" + os.path.relpath(os.path.join(d, fn), root).replace("\\", "/") not in loose:
                os.remove(os.path.join(d, fn))
    return size_of(dst)


def preview(root: str, port: int = 47890):
    """Serve the written site the way a static host does, to look at it before it goes up."""
    httpd = serve_dir(root, port)
    print(f"http://127.0.0.1:{httpd.server_address[1]}/  (Ctrl+C to stop)")
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        httpd.shutdown()


def serve_dir(root: str, port: int = 0):
    """A static file server on 127.0.0.1 (a free port when 0), byte ranges too; runs in its own thread."""
    import functools
    from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

    class H(SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def end_headers(self):
            self.send_header("Cache-Control", "no-cache")
            super().end_headers()

        def do_GET(self):
            m = re.match(r"bytes=(\d+)-(\d*)", self.headers.get("Range") or "")
            path = self.translate_path(self.path)
            if not m or not os.path.isfile(path):
                return super().do_GET()
            total = os.path.getsize(path)
            a = int(m.group(1))
            b = min(int(m.group(2)) if m.group(2) else total - 1, total - 1)
            with open(path, "rb") as f:
                f.seek(a)
                body = f.read(b - a + 1)
            self.send_response(206)
            self.send_header("Content-Type", self.guess_type(path))
            self.send_header("Content-Range", f"bytes {a}-{b}/{total}")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
    httpd = ThreadingHTTPServer(("127.0.0.1", port), functools.partial(H, directory=root))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd
