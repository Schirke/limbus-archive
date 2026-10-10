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
from html import escape as html_escape
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
# the site's addresses it has moved from → where it is now (a config still naming the old one is read as the new)
MOVED = {"https://limbus.shpep.workers.dev": "https://limbus-archive.com"}
# the pages the site is written for (each has its part in Exporter); any other page of the UI is opened on the site
# only when the check finds it asking for nothing the site lacks (verify)
BASE_OPEN = ["home", "patches", "news", "db", "enemies", "anim", "teams", "games", "gameid", "gameskill", "gamechar", "gameenemy", "gamecanto", "gamewordle", "gameconn", "gamegrid", "gamesplash", "gameatlas", "gameodd", "gamemix", "gamebuff", "gamechain", "gamejig", "gamewhen", "gamediff", "gamewho", "gamegacha", "gamedare", "live", "community", "support", "buffs", "mirror", "changes", "banners"]
# the sections' pages for search engines (Exporter.section_pages): route → (name, a line of what is there); the
# games not named here take their name from the menu
SECTIONS = {
    "patches": ("Patch reports", "What every Limbus Company update changed, read from the game's files: new Identities and E.G.O, "
                "changed skills and texts, new pictures, sounds and videos."),
    "news": ("News", "Limbus Company developer notices and update announcements, each next to the report of what the update changed."),
    "changes": ("Change history", "Buffs, nerfs and text changes of Identities, E.G.O and statuses in Limbus Company, update by update."),
    "db": ("Identities & E.G.O", "Every Limbus Company Identity and E.G.O: skills, coins, passives, resistances, stats and full art."),
    "enemies": ("Enemies", "Limbus Company enemies and Abnormalities: their skills, passives and battle look, Canto by Canto."),
    "stages": ("Story map", "Every Canto's stages in Limbus Company: who stands there and what waits."),
    "buffs": ("Buff effects", "Limbus Company statuses and buffs: what each one does and how it looks in battle."),
    "anim": ("Animations", "Limbus Company battle animations and Spine models of Identities, E.G.O, enemies and Abnormalities."),
    "teams": ("Team builder", "Put a Limbus Company team of Identities and E.G.O together and share it as a link or a team code."),
    "mirror": ("Mirror Dungeon planner", "Limbus Company Mirror Dungeon: E.G.O gifts by keyword and tier, theme packs and their bosses."),
    "banners": ("Banner archive", "Every Limbus Company Extraction banner: when it ran and who was on it."),
    "gamegacha": ("Extraction", "A Limbus Company Extraction simulator, paid with the lunacy the site's games give."),
    "games": ("Games", "Limbus Company guessing games: Identities, skills, enemies, music, Wordle, Connections and more, alone or live with friends."),
    "live": ("Live match", "Play the Limbus Company guessing games with friends at the same time, in one room."),
    "community": ("Community", "Who streams Limbus Company right now, and channels worth a look."),
    "support": ("Support & credits", "Support the Limbus Archive project, and who made it."),
    "home": ("Limbus Archive", "Limbus Company fan archive: patch highlights, Identity and E.G.O database, enemies, animations, music and mini-games."),
}
# requests the check never fetches by itself: the app's own state and controls, renders, the game's raw files, and the
# ones a part of Exporter makes its own way
NO_HEAL = re.compile(r"^/api/(_|state|settings|disk|check|update|appnotes|patchnotes|fx|mod|frame|versus|skills|skill_slots|owner_|clip|"
                     r"local_video|sprites|browse|tree|types|container|scan|bank|export|open|site_|object|blob|report|characters|"
                     r"music_audio|quiz_audio|community|buff)")  # (community: who is live right now — a copy would only go stale)
JOURNAL = "fetched.txt"  # (Exporter._journal_add)
NO_JOURNAL = re.compile(r"^/api/(fx_video|buff_video|enemy_thumb)\b")
CJK = re.compile("[぀-ヿ㐀-鿿가-힯]")
PREVIEW = ("Texture2D", "Sprite", "AudioClip", "VideoClip", "TextAsset", "Mesh")  # ui: previewHtml asks for these as they are


def out_dir(svc) -> str:
    return os.path.join(svc.data_dir, "site")


def config(svc) -> dict:
    """data/site_config.json: {"contact": "Discord: name", "audio": true, "video": true, "full_images": true,
    "project": the Cloudflare Worker the site is uploaded to (none: the site is only written to disk), "url": its address,
    "index": true = search engines may list the site (kept out otherwise), "google_verify": Google Search Console's
    code for the front page's verification tag, "stats_key": who may open Site stats, "owner_key": who sees the allowance there (the page is opened once as
    #/community/stats/<key>), "budget": {"day": the day of the month the Cloudflare plan's period starts
    on, "requests", "objects", "rows": what a period may spend of Worker requests, Durable Object requests and rows
    written before the count and the live rooms are closed until the next one (ui/site/worker.js)}}."""
    c = dict(DEFAULTS)
    try:
        with open(os.path.join(svc.data_dir, "site_config.json"), encoding="utf-8") as f:
            c.update(json.load(f))
    except (OSError, ValueError):
        pass
    c["url"] = MOVED.get((c["url"] or "").rstrip("/"), c["url"])
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


def worker_config(svc) -> str:
    """The site's server as wrangler takes it: data/site_worker with the Worker's script (ui/site/worker.js: the files
    as they are, the rooms of the Games' live matches and the count of the site's visitors — Durable Objects) and its
    config, written anew each time.
    -> the config's path."""
    folder = os.path.join(svc.data_dir, "site_worker")
    os.makedirs(folder, exist_ok=True)
    shutil.copyfile(os.path.join(resource_dir(), "ui", "site", "worker.js"), os.path.join(folder, "worker.js"))
    cfg = {"name": config(svc)["project"], "main": "worker.js", "compatibility_date": "2025-09-01",
           "assets": {"directory": packed_dir(svc), "binding": "ASSETS"},
           "durable_objects": {"bindings": [{"name": "ROOMS", "class_name": "Room"}, {"name": "STATS", "class_name": "Stats"}]},
           "migrations": [{"tag": "v1", "new_sqlite_classes": ["Room"]}, {"tag": "v2", "new_sqlite_classes": ["Stats"]}]}
    cfg["vars"] = {}
    if config(svc).get("stats_key"):  # the Site stats page answers only who has the key (else: everybody)
        cfg["vars"]["STATS_KEY"] = config(svc)["stats_key"]
    if config(svc).get("owner_key"):  # Site stats shows the allowance's spending only to who has this key
        cfg["vars"]["OWNER_KEY"] = config(svc)["owner_key"]
    if isinstance(config(svc).get("budget"), dict):  # what a period of the Cloudflare plan may spend (worker.js)
        cfg["vars"]["BUDGET"] = json.dumps(config(svc)["budget"])
    if config(svc)["url"]:  # the site's own address: its old one (*.workers.dev) and www. move there (worker.js moved)
        cfg["vars"]["HOME"] = config(svc)["url"].rstrip("/")
        # (a file is served without the Worker unless asked: the pages go through it, the data and the UI's files don't)
        cfg["assets"]["run_worker_first"] = ["/*", "!/d/*", "!/ui/*", "!/sw.js"]
    path = os.path.join(folder, "wrangler.jsonc")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=1)
    return path


def deploy_command(svc) -> str:
    """The upload as a command to run by hand (it sends data/site_packed as it was prepared last)."""
    return f'npx wrangler deploy -c "{worker_config(svc)}"'


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


def _bilibili_live() -> dict:
    from . import bilibili, community
    return {url_key("/api/bilibili", period=p, sort=s): community.URL.replace("streams.json", f"bilibili_{p}_{s}.json")
            for p in bilibili.PERIODS for s in bilibili.SORTS}


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
    urls = [url_key("/api/units")]
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
    # (an E.G.O's skills have no pictures of their own: its profile picture goes into their frames — ui/db.js skillView)
    full.update(u["img"]["thumb"] for u in units.get("egos", []) if (u.get("img") or {}).get("thumb"))
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
        self._same: dict[str, object] = {}  # unchanged() by the game version a manifest was made from
        os.makedirs(os.path.join(self.out, "d", "m"), exist_ok=True)
        self._jlock = threading.Lock()
        self.journal = self._journal_read()

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
        out, todo, resumed, sources = {}, [], 0, sources or {}
        for k in keys:
            f = have.get(k)
            if f and os.path.exists(os.path.join(self.out, "d", f)):
                out[k] = f
            elif k in self.journal:  # fetched by a send that was cancelled or broke off
                out[k] = self.journal[k]
                resumed += 1
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
                    self._journal_add(k, f)
                done[0] += 1
                self.progress(stage, done[0], len(todo), k)
        # sounds are decoded one at a time by the app (FMOD), pictures come from the bundles a few at once
        with ThreadPoolExecutor(4) as pool:
            list(pool.map(one, todo))
        self.fresh[stage.replace("site: ", "")] = resumed + sum(1 for k in todo if k in out)  # (the rest: the app has nothing there)
        return out

    # -- a send that stops halfway: what it fetched is written down as it comes (d/fetched.txt, not uploaded), so the
    # next send goes on from there (the manifests are written only at the end of each part). A list asked again every
    # time (a request without parameters) and the rendered videos (kept by their own rules) are not written down.
    def _journal_path(self) -> str:
        return os.path.join(self.out, "d", JOURNAL)

    def _journal_head(self) -> str:
        # (another game version or another app: the answers may differ)
        return json.dumps({"game": _game(self.svc.latest_snapshot_id()), "app": __import__("limbusdm").__version__})

    def _journal_read(self) -> dict:
        out = {}
        try:
            with open(self._journal_path(), encoding="utf-8") as f:
                lines = f.read().split("\n")
        except OSError:
            return out
        if lines[0] == self._journal_head():
            for ln in lines[1:]:
                k, tab, rel = ln.partition("\t")
                if tab and rel and os.path.exists(os.path.join(self.out, "d", rel)):  # (a line cut short by a crash: no file)
                    out[k] = rel
        self._journal_write(out)
        return out

    def _journal_write(self, entries: dict):
        tmp = self._journal_path() + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(self._journal_head() + "\n" + "".join(f"{k}\t{v}\n" for k, v in entries.items()))
        os.replace(tmp, self._journal_path())

    def _journal_add(self, key: str, rel: str):
        if not ("?" in key or key.startswith("/spine/")) or NO_JOURNAL.match(key) or "\n" in key or "\t" in key:
            return
        with self._jlock:
            self.journal[key] = rel
            try:
                if not os.path.exists(self._journal_path()):
                    self._journal_write({})
                with open(self._journal_path(), "a", encoding="utf-8") as f:
                    f.write(f"{key}\t{rel}\n")
            except OSError:
                pass

    def forget(self):
        """The send went through: every part is in its manifest."""
        with self._jlock:
            self.journal = {}
            try:
                os.remove(self._journal_path())
            except OSError:
                pass

    # -- what a manifest of an earlier send still holds
    def kept(self, old: dict, skip=()) -> dict:
        """The files of `old` (a manifest written before) that stand for this game version: all of them when it was
        made from the same game version (the time it was read on a computer doesn't count); after a game update, the
        ones whose source the update left alone (unchanged()); none when that can't be told."""
        if not old.get("id"):
            return {}
        urls = {k: f for k, f in (old.get("urls") or {}).items() if k not in skip}
        if _game(old["id"]) == _game(self.svc.latest_snapshot_id()):
            return urls
        same = self.unchanged(old["id"])
        return {k: f for k, f in urls.items() if same(k)} if same else {}

    def unchanged(self, old_id: str):
        """→ request -> whether the game version `old_id` answers it as this one does, from the two snapshots (None
        when this computer has no snapshot of that version)."""
        g = _game(old_id)
        if g not in self._same:
            sid = self.svc.latest_snapshot_id()
            had = [s["id"] for s in self.svc.snapshots() if _game(s["id"]) == g]
            try:
                self._same[g] = _unchanged(self.svc.store.read_json(f"snapshots/{had[-1]}.json.gz"),
                                           self.svc.load_snapshot(sid)) if had and sid else None
            except Exception:
                self._same[g] = None
        return self._same[g]

    def _text(self, key: str, have: dict) -> str:
        """An answer that names what else to fetch (a list, an atlas): read back from the file the site keeps for it,
        asked from the app only when there is none — a second "Send to site" walks the lists without the app."""
        rel = have.get(key) or self.journal.get(key)
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
        have = self.kept(old)  # (another game version: only what it left alone is kept)
        units = self.svc.unit_db()
        # (the lists are the app's own making: a newer app writes them anew for the same game version)
        got = self.fetch_all(unit_urls(units), {k: f for k, f in have.items() if k != "/api/units"}, "site: Identities & E.G.O")
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
            if not x.get("title") and im.get("thumb"):
                own.append(img(im["thumb"]))
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
        have = self.kept(old)
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
            for s, sk in texts.get("skills", {}).items():  # (the page's path: ui/db.js skillView)
                sk = sk or {}
                icon = sk.get("iconPath") or f"Assets/Resources_moved/Sprite/SkillIcon/{sk.get('icon') or s}.png"
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
        have = self.kept(old)
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
        have = self.kept(old)
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
        have = self.kept(old)
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
        have = self.kept(old)
        g = gacha.build(self.svc)
        keys = ["/api/gacha"] + [url_key("/api/gacha_ui", n=n) for n in gacha.UI_USED]
        # (the archive's banners too: Extraction → Banner archive shows their tiles, and "Pull" opens one of them)
        keys += [url_key("/api/asset_img", path=b[k]) for b in g["banners"] + g.get("archive", []) for k in ("tile", "typo", "illust") if b.get(k)]
        keys = list(dict.fromkeys(keys))
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
        kept = bool(old.get("id")) and (old.get("cards") or {}) == picked
        if kept:
            picked = old["cards"]  # the same pictures as last time: nothing is uploaded again
        key = lambda u: url_key(urlsplit(u).path, **dict(parse_qsl(urlsplit(u).query)))  # noqa: E731
        keys = list(dict.fromkeys(key(u) for us in picked.values() for u in us))
        urls = self.fetch_all(keys, self.kept(old) if kept else {}, "site: Games (cards)")
        m = {"kind": "cards", "id": sid, "urls": urls, "cards": {g: [u for u in us if key(u) in urls] for g, us in picked.items()}}
        self.write_manifest("cards", m)
        return m

    def extra(self, keys: list[str]) -> int:
        """Requests the check found unanswered, fetched as they are (manifest "extra"); a list that comes back is read
        for the game's picture paths, whose previews and pictures are fetched too. Returns how many got a file."""
        old = self.read_manifest("extra")
        sid = self.svc.latest_snapshot_id()
        urls = self.kept(old)
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
        have = old.get("urls", {}) if _game(old.get("id")) == _game(made) else {}
        st = {"list": fx.db()["list"], **fx.status()}
        names = list(dict.fromkeys(n for b in st["list"] for n in b.get("fx") or []))
        ready = set(st["have"])
        # (and the ones the site keeps already: made on another computer, taken from the site by pull)
        keys = [url_key("/api/buff_video", name=n) for n in names if _safe_name(n) in ready or url_key("/api/buff_video", name=n) in have]
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

    def tools(self) -> dict:
        """Tools → Mirror Dungeon planner (ui/mirror.js) and Patches → Change history (ui/history.js): their lists and
        the pictures they name — the gifts and packs, the changed cards and skills. The lists are the app's own
        work (not a snapshot's), so they are asked again every time; the pictures are kept while the game version
        is the same."""
        old = self.read_manifest("tools")
        sid = self.svc.latest_snapshot_id()
        lists = ["/api/mirror", "/api/history"]
        have = self.kept(old, lists)
        got = {}
        for k in lists:
            try:
                got[k] = json.loads(self._get(k)[0])
            except Exception as e:
                self.failed.append((k, str(e)))
                got[k] = {}
        thumb = lambda p: url_key("/api/asset_thumb", path=p)  # noqa: E731
        md, hist = got["/api/mirror"], got["/api/history"]
        planner = [thumb(x["pic"]) for x in list((md.get("gifts") or {}).values()) + (md.get("packs") or []) if x.get("pic")]
        drawn = os.path.join(self.svc.data_dir, "enemy_thumbs")
        cards = []
        for c in (hist.get("cards") or {}).values():
            if c.get("pic"):
                cards.append(thumb(c["pic"]))
            elif c.get("app") and os.path.exists(os.path.join(drawn, c["app"] + ".png")):
                cards.append(url_key("/api/enemy_thumb", app=c["app"]))
        cards += [thumb(r["icon"]) for p in hist.get("patches") or [] for c in p["cards"].values() for g in c["groups"] for r in g["rows"] if r.get("icon")]
        files = self.fetch_all(lists + planner + cards, have, "site: Tools (planner, change history)")
        urls, groups = _grouped(files, [(["/api/mirror"] + planner, PACK), (["/api/history"] + cards, PACK)])
        m = {"kind": "tools", "id": sid, "urls": urls, "groups": groups}
        self.write_manifest("tools", m)
        return m

    def langs(self) -> dict:
        """The game's texts in other languages (limbusdm/langs.py): each language's tables and the list of them. A
        table is kept while its texts are the same (`src`: the table file it was made from). A computer with no
        players' translations of its own leaves the ones taken from the site as they are (pull)."""
        from . import langs
        old = self.read_manifest("langs")
        if old and not langs.own(self.svc):
            return old
        src, keys = {}, []
        for lang in langs.sources(self.svc):
            for g in langs.GROUPS:
                k = url_key("/api/lang", id=lang["id"], g=g)
                try:
                    src[k] = os.path.basename(langs.table_file(self.svc, lang["id"], g) or "")
                except Exception as e:
                    self.failed.append((k, str(e)))
                    continue
                keys.append(k)
        have = {k: f for k, f in (old.get("urls") or {}).items() if k in src and (old.get("src") or {}).get(k) == src[k]}
        files = self.fetch_all(keys + ["/api/langs"], have, "site: Languages")
        m = {"kind": "langs", "id": self.svc.latest_snapshot_id(), "urls": files, "src": src}
        self.write_manifest("langs", m)
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
        self.langs()
        self.small()
        self.tools()
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
        pages = self.section_pages(html)
        boot = f"""<script>
const SITE = {json.dumps({"contact": self.cfg["contact"], "build": build_info(self.svc), "open": self.open_routes(), "stats": "key" if self.cfg.get("stats_key") else "all", "titles": {r: t for r, (t, _, _) in pages.items()}, "scripts": [s + "?" + stamp for s in scripts + ["/ui/site/site.js"]]})};
(async () => {{
  // come from the site's old address (ui/site/worker.js moved): what the browser kept there, where nothing is kept here
  if (location.hash.startsWith("#move=")) {{
    let m = {{}};
    try {{ m = JSON.parse(decodeURIComponent(location.hash.slice(6))); }} catch (e) {{ /* the page as it is */ }}
    history.replaceState(null, "", location.pathname + location.search + (m.h || ""));
    try {{ for (const [k, v] of Object.entries(m.d || {{}})) if (localStorage.getItem(k) === null) localStorage.setItem(k, v); }} catch (e) {{ /* not kept */ }}
    try {{
      const c = await caches.open("own");
      if (m.own && !(await c.match("/api/myteam"))) await c.put("/api/myteam", new Response(m.own, {{ headers: {{ "Content-Type": "application/json; charset=utf-8" }} }}));
    }} catch (e) {{ /* not kept */ }}
  }}
  // (a section's page keeps the text it was written with: what a search engine reads, the app not starting)
  const fail = (m) => {{ document.getElementById("main").insertAdjacentHTML("afterbegin", '<div class="empty">' + m + '</div>'); }};
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
        html = html.replace("</head>", f'<link rel="stylesheet" href="/ui/site/site.css?{stamp}">\n</head>')
        html = html.replace("</body>", boot + "</body>")
        # every section has a page of its own (/db, /enemies…): its title, description and a text of what is there —
        # the app's pages live after "#", which a search engine takes for the front page. A visitor gets the app
        # opened on that section (ui/site/site.js)
        for fn in os.listdir(self.out):
            if fn.endswith(".html") and fn != "index.html":
                os.remove(os.path.join(self.out, fn))
        shutil.rmtree(os.path.join(self.out, "games"), ignore_errors=True)
        url = (self.cfg.get("url") or "").rstrip("/")
        for route in pages:
            path = "index.html" if route == "home" else route + ".html"
            os.makedirs(os.path.dirname(os.path.join(self.out, path)) or self.out, exist_ok=True)
            with open(os.path.join(self.out, path), "w", encoding="utf-8") as f:
                f.write(self._page(html, pages, route, url))
        # search engines are kept out unless the site's settings say "index": true
        with open(os.path.join(self.out, "robots.txt"), "w") as f:
            f.write(("User-agent: *\nAllow: /\n" + (f"Sitemap: {url}/sitemap.xml\n" if url else "")) if self.cfg.get("index") else "User-agent: *\nDisallow: /\n")
        # (the list of those pages, for a search engine to find them all)
        sitemap = os.path.join(self.out, "sitemap.xml")
        if self.cfg.get("index") and url:
            day = time.strftime("%Y-%m-%d")
            with open(sitemap, "w", encoding="utf-8") as f:
                f.write('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
                        + "".join(f"<url><loc>{url}/{'' if r == 'home' else r}</loc><lastmod>{day}</lastmod></url>\n" for r in pages)
                        + "</urlset>\n")
        elif os.path.exists(sitemap):
            os.remove(sitemap)
        self.index()

    # -- the sections' own pages, for search engines (shell)
    def _answer(self, key: str):
        """What the site answers to `key` (an /api/… list), read back from its own files; None when it has none."""
        for fn in sorted(os.listdir(os.path.join(self.out, "d", "m"))):
            if fn.startswith("report-") or not fn.endswith(".json.gz"):
                continue
            rel = self.read_manifest(fn[:-8]).get("urls", {}).get(key)
            if isinstance(rel, str):
                try:
                    with (gzip.open if rel.endswith(".gz") else open)(os.path.join(self.out, "d", rel), "rt", encoding="utf-8") as f:
                        return json.load(f)
                except (OSError, ValueError):
                    return None
        return None

    def section_pages(self, html: str) -> dict:
        """{route: (title, description, the page's text)} for every section the site opens, the front page ("home")
        first. The games' names come from the menu (ui/index.html), the lists from what the site holds."""
        names = {}
        for route, attrs, label in re.findall(r'<a href="#/([\w/]+)"([^>]*)>(.*?)</a>', html):
            t = re.search(r'title="([^"]+)"', attrs)
            names.setdefault(route, re.sub(r"<[^>]+>", "", label).strip() or (t.group(1) if t else ""))
        open_ = set(self.open_routes()) | {"home"}
        if "games" in open_:
            open_.add("games/track")
        pages = {}
        for route in ["home"] + list(SECTIONS) + list(names):
            if route in pages or route not in open_ or not (route in SECTIONS or names.get(route)):
                continue
            title, desc = SECTIONS.get(route) or (names[route], f"{names[route]}: a Limbus Company guessing game on Limbus Archive. "
                                                                 "Play alone or in a live match with friends.")
            pages[route] = (title, desc, self._section_text(route))
        return pages

    def _section_text(self, route: str) -> str:
        """The lists a section shows, as plain text a search engine reads (the app draws the page over it)."""
        e = lambda v: html_escape(str(v or ""))  # noqa: E731
        out = []

        def group(head, rows):  # rows: [(sub-heading, [names])]
            rows = [(k, list(dict.fromkeys(x for x in v if x))) for k, v in rows]
            rows = [(k, v) for k, v in rows if v]
            if rows:
                out.append(f"<h2>{e(head)}</h2>" + "".join(f"<p>{f'<b>{e(k)}</b>: ' if k else ''}{', '.join(e(x) for x in v)}</p>" for k, v in rows))

        def by(items, key, name):
            rows = {}
            for x in items:
                rows.setdefault(key(x) or "", []).append(name(x))
            return list(rows.items())
        if route in ("db", "teams", "anim"):
            u = self._answer("/api/units") or {}
            group("Identities", by(u.get("ids") or [], lambda x: x.get("sinnerName"), lambda x: x.get("title")))
            group("E.G.O", by(u.get("egos") or [], lambda x: x.get("sinnerName"), lambda x: f"{x.get('name')} ({x.get('grade')})"))
        elif route == "enemies":
            d = self._answer("/api/enemies") or {}
            group("Enemies and Abnormalities", by(d.get("list") or [], lambda x: x.get("group"), lambda x: x.get("name")))
        elif route == "stages":
            d = self._answer("/api/stages") or {}
            group("Chapters", [("", [c.get("label") for c in d.get("chapters") or []])])
        elif route == "buffs":
            d = self._answer("/api/buffs") or {}
            group("Statuses", [("", [b.get("name") for b in d.get("list") or []])])
        elif route == "mirror":
            d = self._answer("/api/mirror") or {}
            group("Theme packs", [("", [p.get("name") for p in d.get("packs") or []])])
            group("E.G.O gifts", by((d.get("gifts") or {}).values(), lambda x: x.get("kw") or "Other", lambda x: x.get("name")))
        elif route == "changes":
            d = self._answer("/api/history") or {}
            cards = d.get("cards") or {}
            group("Updates", [(p.get("day"), [(cards.get(c) or {}).get("name") for c in p.get("cards") or {}]) for p in d.get("patches") or []])
        elif route in ("home", "patches", "news"):
            d = self._answer("/api/news") or {}
            group("Updates", [(p.get("day"), [(p.get("notice") or {}).get("title") or "Update"]) for p in (d.get("patches") or [])[:30]])
        elif route == "banners":
            d, u = self._answer("/api/gacha") or {}, self._answer("/api/units") or {}
            who = {x.get("id"): f"{x.get('title')} {x.get('sinnerName')}" for x in u.get("ids") or []}
            who.update({x.get("id"): f"{x.get('name')} {x.get('sinnerName')}" for x in u.get("egos") or []})
            group("Banners", [("Until " + (b.get("end") or "")[:10] if b.get("end") else "", [who.get(i, str(i)) for i in b.get("pick") or []]) for b in d.get("archive") or []])
        return "".join(out)

    def _page(self, html: str, pages: dict, route: str, url: str) -> str:
        """index.html as the page of one section: its own title, description, address and text."""
        e = html_escape
        title, desc, body = pages[route]
        full = "Limbus Archive: Limbus Company patches, database, animations and games" if route == "home" else f"{title} · Limbus Company · Limbus Archive"
        here = f"{url}/{'' if route == 'home' else route}"
        pic = route.split("/")[0]
        pic = pic if os.path.exists(os.path.join(resource_dir(), "ui", "site", "home", pic + ".webp")) else "db"
        head = [f'<meta name="description" content="{e(desc)}">']
        if not self.cfg.get("index"):
            head.append('<meta name="robots" content="noindex, nofollow">')
        if route == "home" and self.cfg.get("google_verify"):  # (Google Search Console: the site is ours)
            head.append(f'<meta name="google-site-verification" content="{e(self.cfg["google_verify"])}">')
        if url:
            head += [f'<link rel="canonical" href="{e(here)}">', '<meta property="og:type" content="website">',
                     '<meta property="og:site_name" content="Limbus Archive">', f'<meta property="og:title" content="{e(full)}">',
                     f'<meta property="og:description" content="{e(desc)}">', f'<meta property="og:url" content="{e(here)}">',
                     f'<meta property="og:image" content="{e(url)}/ui/site/home/{pic}.webp">', '<meta name="twitter:card" content="summary_large_image">']
            if route == "home":
                head.append('<script type="application/ld+json">' + json.dumps({"@context": "https://schema.org", "@type": "WebSite",
                                                                               "name": "Limbus Archive", "url": url + "/"}) + "</script>")
        links = "".join(f'<a href="/{"" if r == "home" else r}">{e("Home" if r == "home" else t)}</a>' for r, (t, _, _) in pages.items() if r != route)
        text = (f'<div class="seo"><h1>{e("Limbus Archive" if route == "home" else title)}</h1><p>{e(desc)}</p>{body}'
                f'<nav class="seonav">{links}</nav></div>')
        html = re.sub(r"<title>.*?</title>", f"<title>{e(full)}</title>", html, count=1)
        html = html.replace("</head>", "\n".join(head) + "\n</head>", 1)
        return html.replace('<main id="main"></main>', f'<main id="main">{text}</main>', 1)

    def index(self):
        names = sorted(fn[:-8] for fn in os.listdir(os.path.join(self.out, "d", "m")) if fn.endswith(".json.gz"))
        ms = {n: self.read_manifest(n) for n in names}
        reports = sorted((m["meta"] for m in ms.values() if m.get("kind") == "report" and m.get("meta")),
                         key=lambda r: r["id"], reverse=True)
        # (with the ones a report taken from the site is between: pull)
        snaps = {**_read_json(os.path.join(self.out, "d", "snapshots.json")), **{s["id"]: s for s in self.svc.snapshots()}}
        used = [snaps[i] for i in sorted({r[k] for r in reports for k in ("old", "new")} & set(snaps))]
        state = {"game": {"ok": True, "dir": "", "catalog": ""}, "snapshots": used, "reports": reports, "job": None,
                 "watch": {"state": "", "last_check": ""}, "settings": {}, "data_dir": "", "update": None,
                 "version": __import__("limbusdm").__version__, "site": True}
        # the app's own "what's new" (the releases' notes from GitHub), as they read now: the site shows them to who
        # has an older copy open (ui/site/site.js). Not read this time -> the ones sent before stay
        path = os.path.join(self.out, "d", "index.json")
        from . import appnotes
        notes = appnotes.history()
        if not notes["notes"]:
            notes = (_read_json(path).get("inline") or {}).get("/api/appnotes?all=1") or notes
        idx = {"v": VERSION, "stamp": int(time.time()), "build": build_info(self.svc), "manifests": [n for n in names if ms[n]],
               "tr": sorted(fn[:-8] for fn in os.listdir(os.path.join(self.out, "d", "tr")) if fn.endswith(".json.gz"))
               if os.path.isdir(os.path.join(self.out, "d", "tr")) else [],
               # answered from the net by the visitor's browser itself: the list of live streams, made on GitHub
               # and Bilibili's videos (scripts/bilibili.py writes them there: a browser can't ask Bilibili)
               "live": {"/api/community": __import__("limbusdm.community", fromlist=["URL"]).URL, **_bilibili_live()},
               "inline": {"/api/state": state, "/api/marks": {}, "/api/appnotes": {}, "/api/appnotes?all=1": notes, "/api/mods_owned": [],
                          "/api/patchnotes?new=1": {"id": None}, "/api/game_cards": (ms.get("cards") or {}).get("cards") or {}}}
        with open(path, "w", encoding="utf-8") as f:
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
        keep = set(self.journal.values())  # (a send that broke off goes on with these)
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


PULL_STAGE = "site: taking from the site"
# what pull() takes of the site's parts (not the reports, the rendered videos or News: those have rules of their own)
TAKEN_PARTS = ("units", "enemies", "anim", "quiz", "scenes", "gacha", "cards", "tools", "extra", "music")
PULL_THREADS, PULL_TRIES = 10, 3
PACK_INDEX = "site_packs.json"  # (in the data folder: not uploaded) PackIndex
PACK_INDEX_DAYS = 60  # a pack not made or looked at for this long is dropped from it


def pack_index_path(svc) -> str:
    return os.path.join(svc.data_dir, PACK_INDEX)


class PackIndex:
    """{pack: {offset: file}} of the packs this computer made or took from the site. A pack is named by the files in it,
    so what it holds never changes: pull() takes a pack from the site only when a file of it is missing here."""

    def __init__(self, path: str):
        self.path, self.lock, self.today, self.saved = path, threading.Lock(), int(time.time() // 86400), time.time()
        d = _read_json(path)
        self.packs = (d.get("packs") or {}) if d.get("v") == 1 else {}

    def file(self, pack: str, off: int) -> str | None:
        with self.lock:
            p = self.packs.get(pack)
            if not p:
                return None
            p["t"] = self.today
            return p["f"].get(str(off))

    def add(self, pack: str, off: int, rel: str):
        with self.lock:
            p = self.packs.setdefault(pack, {"f": {}})
            p["t"] = self.today
            p["f"][str(off)] = rel

    def save(self, every: float = 0):
        """Written now, or when `every` seconds went by since the last time (a pull that is cancelled keeps the rest)."""
        with self.lock:
            if time.time() - self.saved < every:
                return
            self.saved = time.time()
            keep = {k: v for k, v in self.packs.items() if self.today - v.get("t", 0) <= PACK_INDEX_DAYS}
            with open(self.path + ".tmp", "w", encoding="utf-8") as f:
                json.dump({"v": 1, "packs": keep}, f, separators=(",", ":"))
            os.replace(self.path + ".tmp", self.path)


def _game(made: str) -> str:
    """A snapshot's (or a renders folder's) name without the time it was read on this computer: the same game version
    on two computers."""
    return re.sub(r"_\d{8}-\d{6}", "", made or "")


def _unchanged(a: dict, b: dict):
    """→ request -> whether its answer is the same in the game version of snapshot b as in a's: what it is read from —
    a bundle, a sound bank — is the same file in both (by its hash). Requests read from anything else (the game's
    lists, its main build, pictures the app draws) say no and are asked again."""
    ba, bb = a.get("bundles") or {}, b.get("bundles") or {}
    aa, ab = a.get("assets") or {}, b.get("assets") or {}
    fa, fb = a.get("files") or {}, b.get("files") or {}
    banks = {}  # voice line → the bank it is in (the first one, as sound_index finds it)
    for rel, rec in fb.items():
        for name, *_ in rec.get("sounds") or []:
            banks.setdefault(name.lower(), rel)

    def bundle(n):
        x, y = ba.get(n), bb.get(n)
        return bool(x and y and x.get("hash") == y.get("hash") and not x.get("missing") and not y.get("missing"))

    def same(key: str) -> bool:
        path, _, qs = key.partition("?")
        q = dict(p.split("=", 1) for p in qs.split("&") if "=" in p)
        if path.startswith("/spine/"):  # /spine/<bundle>/<atlas>/<file>
            return bundle(path.split("/")[2])
        if path == "/api/thumb":  # named by its content
            return True
        if path in ("/api/object", "/api/clip", "/api/spine_scene", "/api/scene_sprite"):
            return bundle(q.get("bundle", ""))
        if path in ("/api/asset_img", "/api/asset_thumb"):
            x, y = aa.get(q.get("path", "")), ab.get(q.get("path", ""))
            return bool(x and y and x.get("bundle") and x["bundle"] == y.get("bundle") and bundle(x["bundle"]))
        if path == "/api/quiz_audio":
            rel = banks.get(q.get("s", "").lower())
            return bool(rel and rel in fa and fa[rel].get("h") == fb[rel].get("h"))
        return False
    return same


class Puller:
    """What the site has and this computer's site files lack, taken back from the site: the reports and the rendered
    videos sent from another computer, so a "Send to site" from here keeps them. The files come back as they were
    written (named by their content), out of the packs and parts pack() made of them."""

    def __init__(self, ex: Exporter, url: str):
        self.ex, self.url = ex, url.rstrip("/")
        self.packs: dict[str, bytes] = {}
        self.lock = threading.Lock()
        self.taken = 0
        self.index = PackIndex(pack_index_path(ex.svc))

    def get(self, path: str) -> bytes:
        from urllib.request import Request
        for i in range(PULL_TRIES):
            try:
                with urlopen(Request(f"{self.url}/d/{path}", headers={"User-Agent": "LimbusArchive"}), timeout=300) as r:
                    return r.read()
            except Exception as e:
                if i == PULL_TRIES - 1 or getattr(e, "code", None) == 404:
                    raise
                time.sleep(2 * (i + 1))

    def json(self, path: str):
        data = self.get(path)
        return json.loads(gzip.decompress(data) if data[:2] == b"\x1f\x8b" else data)

    def _put(self, rel: str, data: bytes):
        full = os.path.join(self.ex.out, "d", rel)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        tmp = f"{full}.{threading.get_ident()}.tmp"
        with open(tmp, "wb") as f:
            f.write(data)
        os.replace(tmp, full)
        with self.lock:
            self.taken += 1

    def file(self, where) -> str:
        """One file of a manifest as the site has it → its name in the site's files (written here when missing)."""
        if isinstance(where, str):  # on its own
            if not os.path.exists(os.path.join(self.ex.out, "d", where)):
                self._put(where, self.get(where))
            return where
        if isinstance(where, dict):  # in parts ("<file>.<size>k.<n>")
            rel = re.sub(r"\.\d+k\.\d+$", "", where["parts"][0])
            if not os.path.exists(os.path.join(self.ex.out, "d", rel)):
                self._put(rel, b"".join(self.get(p) for p in where["parts"]))
            return rel
        pack, off, size, ext = where  # in a pack: named again by its content, as _store named it
        rel = self.index.file(pack, off)
        full = rel and os.path.join(self.ex.out, "d", rel)
        if full and os.path.exists(full) and os.path.getsize(full) == size:  # (the pack is not fetched for it)
            return rel
        with self.lock:
            data = self.packs.get(pack)
        if data is None:
            data = self.get("p/" + pack)
            with self.lock:
                self.packs[pack] = data
        data = data[off:off + size]
        h = hashlib.sha1(data).hexdigest()
        rel = f"f/{h[:2]}/{h}.{ext}"
        full = os.path.join(self.ex.out, "d", rel)
        if not os.path.exists(full) or os.path.getsize(full) != size:
            self._put(rel, data)
        self.index.add(pack, off, rel)
        return rel

    def files(self, urls: dict) -> dict:
        """{request: where on the site} → {request: file}; a pack is fetched once for all it holds. Raises when a file
        could not be taken (the upload would take it off the site)."""
        by_pack: dict = {}
        for k, w in urls.items():
            by_pack.setdefault(w[0] if isinstance(w, list) else None, []).append(k)
        jobs = [ks for p, ks in by_pack.items() if p is not None] + [[k] for k in by_pack.get(None, [])]
        out, done, failed = {}, [0], []

        def one(ks):
            for k in ks:
                try:
                    out[k] = self.file(urls[k])
                except Exception as e:
                    with self.lock:
                        failed.append((k, f"{type(e).__name__}: {e}"))
            with self.lock:
                if isinstance(urls[ks[0]], list):
                    self.packs.pop(urls[ks[0]][0], None)
                done[0] += len(ks)
                self.ex.progress(PULL_STAGE, done[0], len(urls))
            self.index.save(every=20)
        try:
            with ThreadPoolExecutor(PULL_THREADS) as pool:
                list(pool.map(one, jobs))
        finally:
            self.index.save()
        if failed:
            raise RuntimeError(f"couldn't take {len(failed)} files from the site ({failed[0][1]}) — sending now would "
                               "take them off it; send again")
        return {k: out[k] for k in urls if k in out}  # (in the manifest's order: pack() packs them in it)

    def manifest(self, name: str) -> dict:
        m = self.json(f"m/{name}.json.gz")
        if m.get("v") != VERSION:
            return {}
        m["urls"] = self.files(m.get("urls") or {})
        return m


def pull(ex: Exporter, url: str) -> dict:
    """Before a "Send to site": the upload replaces the whole site with this computer's files, so what was sent from
    another computer is taken from the site first — the reports this computer has no files of, and the rendered
    videos (Animations → With effects, Buff effects) of this game version it lacks. A report taken off the site after
    this computer sent it is taken off here too. Refuses when the site shows a newer game version than this app has
    read: the upload would put the older data back.
    The parts made from the game's files are taken too where this computer has none to go on from.
    → {"reports": taken, "removed": taken off here, "videos": taken, "parts": taken, "files": files written}"""
    svc = ex.svc
    p = Puller(ex, url)
    ex.progress(PULL_STAGE, 0, 0)
    # only the newest app sends: an older one would put its older pages back on the site
    from . import updater
    from . import __version__
    try:
        up = updater.check()
    except Exception:  # (GitHub not reached: the site's own build below still tells)
        up = None
    if up and up["newer"]:
        raise RuntimeError(f"this app is {__version__} and {up['latest']} is out — update the app, then send")
    try:
        idx = p.json("index.json")
    except Exception as e:
        if getattr(e, "code", None) == 404:  # nothing sent yet
            return {}
        raise RuntimeError(f"couldn't read what the site has ({type(e).__name__}: {e}) — sending now could take things off it")
    site_app = (idx.get("build") or {}).get("version") or ""
    if updater._ver(site_app) > updater._ver(__version__):
        raise RuntimeError(f"the site was made by the app {site_app} and this one is {__version__} — update the app, then send")
    site_game, mine = _game((idx.get("build") or {}).get("game", "")), build_info(svc)["game"]
    if site_game and site_game != mine and site_game[1:9] >= mine[1:9]:  # (s<date>_<build>)
        raise RuntimeError(f"the site has game data {site_game} and this app {mine or '(none)'} — start the app with the "
                           "game updated so it reads the new version, then send")
    names = set(idx.get("manifests") or [])
    out = {"reports": 0, "removed": 0, "videos": 0, "parts": 0}
    for name in sorted(n for n in names if n.startswith("report-") and not os.path.exists(ex._manifest_path(n))):
        m = p.manifest(name)
        if not m:
            continue
        if name in (idx.get("tr") or []):
            try:
                os.makedirs(os.path.join(ex.out, "d", "tr"), exist_ok=True)
                data = p.get(f"tr/{name}.json.gz")
                with open(os.path.join(ex.out, "d", "tr", name + ".json.gz"), "wb") as f:
                    f.write(data)
            except Exception as e:
                ex.failed.append((name, f"translations from the site: {e}"))
        ex.write_manifest(name, m)
        out["reports"] += 1
    # a report this computer sent that the site has no more was taken off from another computer
    sent = _read_json(os.path.join(svc.data_dir, "site_sent.json")).get("files") or {}
    for fn in os.listdir(os.path.join(ex.out, "d", "m")):
        name = fn[:-8]
        if fn.endswith(".json.gz") and name.startswith("report-") and name not in names and f"d/m/{fn}" in sent:
            for path in (ex._manifest_path(name), os.path.join(ex.out, "d", "tr", name + ".json.gz")):
                if os.path.exists(path):
                    os.remove(path)
            out["removed"] += 1
    # rendered videos of the game version and the renderer this app has
    from . import sitefx
    for name, made, key in (("fx", sitefx._made(svc), "/api/fx_video"),
                            ("buffs", os.path.basename(svc.buff_fx.folder()), "/api/buff_video")):
        if name not in names:
            continue
        site = p.json(f"m/{name}.json.gz")
        if site.get("v") != VERSION or _game(site.get("id")) != _game(made):
            continue
        local = ex.read_manifest(name)
        if local.get("id") != made:  # (the skills' videos of the version before stay until rendered again: sitefx._read)
            local = sitefx._read(ex) if name == "fx" else {"kind": name, "id": made, "urls": {}}
        got = p.files({k: w for k, w in (site.get("urls") or {}).items() if k.startswith(key) and k not in local["urls"]})
        if not got:
            continue
        local["urls"].update(got)
        out["videos"] += len(got)
        if name == "fx":  # (the lists the tab asks for are made again from these: sitefx._lists)
            local.setdefault("src", {}).update({k: v for k, v in (site.get("src") or {}).items() if k in got})
            have = local.setdefault("have", {})
            for cid, vs in (site.get("have") or {}).items():
                for v, videos in vs.items():
                    ok = [n for n in videos if sitefx._key(key, int(cid), v, name=n) in local["urls"]]
                    mine_v = have.setdefault(cid, {})
                    mine_v[v] = list(dict.fromkeys(mine_v.get(v, []) + ok))
            local["none"] = list(dict.fromkeys((local.get("none") or []) + (site.get("none") or [])))
        ex.write_manifest(name, local)
    # the parts made from the game's files, where this computer has none to go on from: never sent from here, or sent
    # from a game version it has no snapshot of any more (with one, Exporter.kept() keeps what the patch left alone).
    # The site's part of the same game version comes whole; of an older one, as far as the patch left it alone.
    for name in TAKEN_PARTS:
        local = ex.read_manifest(name)
        if name not in names or (local.get("id") and ex.unchanged(local["id"])):
            continue
        site = p.json(f"m/{name}.json.gz")
        if site.get("v") != VERSION or not site.get("id"):
            continue
        if _game(site["id"]) != mine and (name == "music" or not ex.unchanged(site["id"])):
            continue
        site["urls"] = p.files(site.get("urls") or {})
        ex.write_manifest(name, site)
        out["parts"] += 1
    # the languages, on a computer with no players' translations of its own: the site's stay (Exporter.langs)
    from . import langs
    if "langs" in names and not langs.own(svc):
        site = p.json("m/langs.json.gz")
        if site.get("v") == VERSION:
            site["urls"] = p.files(site.get("urls") or {})
            ex.write_manifest("langs", site)
            out["parts"] += 1
    # the game versions the taken reports are between: the site's state lists them, this app may not have them
    snaps = {s["id"]: s for s in ((idx.get("inline") or {}).get("/api/state") or {}).get("snapshots") or []}
    if snaps:
        path = os.path.join(ex.out, "d", "snapshots.json")
        merged = {**_read_json(path), **snaps}
        with open(path, "w", encoding="utf-8") as f:
            json.dump(merged, f, ensure_ascii=False)
    out["files"] = p.taken
    ex.fresh["taken from the site"] = out["reports"] + out["videos"] + out["parts"]
    return out


def export(svc, base_url: str, reports: list[str] | None = None, units=True, progress=None) -> dict:
    """Write the site: the given reports (all of them when None) and the Identities & E.G.O database."""
    ex = Exporter(svc, base_url, progress=progress)
    for rid in reports if reports is not None else [r["id"] for r in svc.reports()]:
        ex.report(rid)
    if units:
        ex.pages()
    ex.shell()
    ex.forget()
    return {"dir": ex.out, "failed": len(ex.failed), "size": size_of(ex.out)}


def deploy(svc, progress=None) -> str:
    """Upload data/site_packed with Cloudflare's wrangler (needs Node.js and `npx wrangler login` done once on this
    computer); only the files the host doesn't have yet go up. Returns the site's address."""
    cfg = config(svc)
    npx = shutil.which("npx")
    if not npx:
        raise RuntimeError("Node.js isn't installed — the upload runs Cloudflare's wrangler through npx")
    # run from the data folder: wrangler keeps its own files next to where it runs and reads a config it finds there
    conf = worker_config(svc)
    p = subprocess.Popen([npx, "--yes", "wrangler@4", "deploy", "-c", conf], cwd=os.path.dirname(conf), stdin=subprocess.DEVNULL,
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
        if any("EBUSY" in t for t in tail):  # npx could not update wrangler: its files are held by one that is running
            raise RuntimeError("upload failed: another wrangler is running on this computer (a local preview, "
                               "`wrangler dev`?) and holds its files — close it and send again")
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
        pack(ex.out, packed, pack_index_path(ex.svc))
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
    pack(ex.out, packed, pack_index_path(ex.svc))
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
    cfg = config(svc)
    if cfg["project"] and cfg["url"]:  # what was sent from another computer stays (pull)
        pull(ex, cfg["url"])
    if report:
        ex.report(report)
    # a report made since the newest one on the site goes up as well: Settings -> Website sends without naming one
    # (an older one that is not there was taken off, and stays off)
    def taken(r):
        return r["new"].rsplit("_", 1)[-1]

    def there(r):
        return os.path.exists(ex._manifest_path("report-" + hashlib.sha1(r["id"].encode()).hexdigest()[:12]))
    newest = max((taken(r) for r in svc.reports() if there(r)), default="")
    for r in svc.reports():
        if r["id"] != report and taken(r) > newest and not there(r):
            ex.report(r["id"])
    ex.pages()
    ex.shell()
    progress("site: packing", 0, 0)
    size = pack(ex.out, packed_dir(svc), pack_index_path(svc))
    chk = verify(ex, progress)
    size = size_of(packed_dir(svc))
    if not cfg["project"]:
        ex.forget()
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
    ex.forget()
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


def pack(src: str, dst: str, index: str | None = None) -> dict:
    """The site as it goes up: a manifest's thousands of small files glued into packs (a host counts files).

    A manifest then names a small file as [pack, offset, length, extension]; the service worker fetches the pack
    once, keeps it and cuts the file out. Files go into packs in the order the page lists them, so one screen of
    pictures is a pack or two; a manifest's "groups" [[how many requests, pack size], …] start a pack anew and set
    its size for a run of them (_grouped). Packs are named by what is in them: a report that didn't change gives the same packs
    again and nothing of it is uploaded twice. Files of PACK size and up (music, video, big art) stay on their own.
    `index`: the PackIndex file that learns what each pack holds."""
    idx = PackIndex(index) if index else None
    shutil.rmtree(os.path.join(dst, "ui"), ignore_errors=True)
    os.makedirs(dst, exist_ok=True)
    # (a section's page that is gone from the site goes from here too: Exporter.shell)
    for name in os.listdir(dst):
        if name.endswith((".html", ".xml")) and not os.path.exists(os.path.join(src, name)):
            os.remove(os.path.join(dst, name))
    shutil.rmtree(os.path.join(dst, "games"), ignore_errors=True)
    for name in os.listdir(src):
        a, b = os.path.join(src, name), os.path.join(dst, name)
        if name in ("ui", "games"):
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
                if idx:
                    idx.add(name, off, rel)
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
    if idx:
        idx.save()
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

        def translate_path(self, path):
            # a section's page: /db is db.html, as the host serves it
            full = super().translate_path(path)
            return full + ".html" if not os.path.exists(full) and os.path.isfile(full + ".html") else full

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
