"""The web copy: the app's UI plus a service worker that answers /api/… from files saved here (<out>/d/, named by content,
with URL → file manifests)."""
from __future__ import annotations

import gzip
import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from html import escape as html_escape
from urllib.parse import quote, unquote
from urllib.request import urlopen

from . import links
from .paths import resource_dir

VERSION = 1
EXT = {"image/png": "png", "image/webp": "webp", "image/jpeg": "jpg", "image/gif": "gif", "audio/wav": "wav",
       "audio/ogg": "ogg", "video/mp4": "mp4", "video/webm": "webm", "application/json": "json", "text/plain": "txt",
       "font/otf": "otf", "font/ttf": "ttf"}
DEFAULTS = {"contact": "", "audio": True, "video": True, "full_images": True, "enemies": True, "music": True, "spine": True, "clips": True,
            "games": True, "story": True,
            "project": "", "url": ""}
# old site addresses → the current one
MOVED = {"https://limbus.shpep.workers.dev": "https://limbus-archive.com"}
# ------------------------------------------------------------------ the site's pages and parts: described here only
# PAGES: route → what the site does with that page (the menu itself is ui/index.html; ui/site/site.js hides what is
# not open, from SITE.open)
#   title, seo  its page for search engines (<route>.html): name and description; a route without one that the menu
#               names gets the menu's word and a guessing-game text (section_pages)
#   open        open without the check (verify); any other page opens once the check finds nothing missing on it
#   cards       a page per card for link previews: <route>/<…>.html (Exporter.card_pages)
#   app         works only in the app: the check never opens it
#   beta        open once its part was sent; no page for search engines; who sees it is beta.json
#   part        the manifest it mainly reads (PARTS)
PAGES = {
    "patches": {"title": "Patch reports", "seo": "What every Limbus Company update changed, read from the game's files: new Identities "
                "and E.G.O, changed skills and texts, new pictures, sounds and videos.", "open": True},
    "news": {"title": "News", "seo": "Limbus Company developer notices and update announcements, each next to the report of what the "
             "update changed.", "open": True, "part": "small"},
    "changes": {"title": "Change history", "seo": "Buffs, nerfs and text changes of Identities, E.G.O and statuses in Limbus Company, "
                "update by update.", "open": True, "part": "tools"},
    "db": {"title": "Identities & E.G.O", "seo": "Every Limbus Company Identity and E.G.O: skills, coins, passives, resistances, stats "
           "and full art.", "open": True, "cards": True, "part": "units"},
    "enemies": {"title": "Enemies", "seo": "Limbus Company enemies and Abnormalities: their skills, passives and battle look, Canto by "
                "Canto.", "open": True, "cards": True, "part": "enemies"},
    "stages": {"title": "Story map", "seo": "Every Canto's stages in Limbus Company: who stands there and what waits.", "part": "story"},
    "announcers": {"title": "Announcers", "seo": "Every battle announcer of Limbus Company with all of its lines by situation: read them "
                   "and hear them.", "open": True, "part": "announcers"},
    "abnologs": {"title": "Abnormality logs", "seo": "Every Limbus Company Abnormality observation log, Canto by Canto: which Sinner "
                 "wrote it and the others' replies.", "open": True, "part": "abnologs"},
    "story": {"title": "Story", "seo": "Read the Limbus Company story scene by scene: backgrounds, characters, voices and music, Canto by "
              "Canto.", "part": "story"},
    "buffs": {"title": "Buff effects", "seo": "Limbus Company statuses and buffs: what each one does and how it looks in battle.",
              "open": True, "cards": True, "part": "buffs"},
    "anim": {"title": "Animations", "seo": "Limbus Company battle animations and Spine models of Identities, E.G.O, enemies and "
             "Abnormalities.", "open": True, "part": "anim"},
    "teams": {"title": "Team builder", "seo": "Put a Limbus Company team of Identities and E.G.O together and share it as a link or a "
              "team code.", "open": True, "part": "units"},
    "mirror": {"title": "Mirror Dungeon planner", "seo": "Limbus Company Mirror Dungeon: E.G.O gifts by keyword and tier, theme packs and "
               "their bosses.", "open": True, "part": "tools"},
    "calc": {"title": "Damage calculator", "seo": "Limbus Company damage calculator: any Identity or E.G.O skill against any enemy, coin "
             "by coin, with the max damage of every skill.", "open": True, "part": "enemies"},
    "growth": {"title": "Upgrade calculator", "seo": "Limbus Company upgrade calculator: EXP, Threads and Egoshards for any level or "
               "Uptie, and how many Luxcavation and Mirror Dungeon runs and days that takes.", "open": True, "part": "small"},
    "banners": {"title": "Banner archive", "seo": "Every Limbus Company Extraction banner: when it ran and who was on it.", "open": True,
                "part": "gacha"},
    "gamegacha": {"title": "Extraction", "seo": "A Limbus Company Extraction simulator, paid with the lunacy the site's games give.",
                  "open": True, "part": "gacha"},
    "games": {"title": "Games", "seo": "Limbus Company guessing games: Identities, skills, enemies, music, Wordle, Connections and more, "
              "alone or live with friends.", "open": True, "part": "cards"},
    "live": {"title": "Live match", "seo": "Play the Limbus Company guessing games with friends at the same time, in one room.",
             "open": True},
    "community": {"title": "Community", "seo": "Who streams Limbus Company right now, and channels worth a look.", "open": True},
    "support": {"title": "Support & credits", "seo": "Support the Limbus Archive project, and who made it.", "open": True},
    "home": {"title": "Limbus Archive", "seo": "Limbus Company fan archive: patch highlights, Identity and E.G.O database, enemies, "
             "animations, music and mini-games.", "open": True, "part": "units"},
    "profile": {"open": True, "part": "units"},
    "compare": {"title": "Compare", "seo": "Compare two Limbus Company Identities or E.G.O side by side: stats, resistances, skills "
                "and passives.", "open": True, "part": "units"},
    "gameid": {"open": True, "part": "quiz"}, "gamechar": {"open": True, "part": "quiz"}, "gamecanto": {"open": True, "part": "scenes"},
    "gamearena": {"open": True, "part": "newgames"}, "gamesound": {"open": True, "part": "newgames"},
    **{r: {"open": True} for r in ("gameskill", "gameenemy", "gamewordle", "gameconn", "gamegrid", "gamesplash", "gameatlas",
                                   "gameodd", "gamemix", "gamebuff", "gamechain", "gamejig", "gamewhen", "gamediff", "gamehilo",
                                   "gamepassive", "gameego", "gamememory", "gamewho", "gamedare")},
    **{r: {"beta": True, "part": "biggames"} for r in ("biggames", "singingmachine", "slice", "survivors", "collection")},
    **{r: {"app": True} for r in ("versus", "vsroom", "vsmirror", "sounds", "browse", "snapshots", "scan", "settings", "sprites")},
}
BASE_OPEN = [r for r, p in PAGES.items() if p.get("open")]
CARD_DIRS = tuple(r for r, p in PAGES.items() if p.get("cards")) + ("og",)  # (og/: the cards' pictures)

# pack sizes
PACK = 1 << 20  # packs are fetched whole: keep them small
# smaller packs for what the Games fetch one at a time
CARD_PACK = 2 << 20  # one Identity's / E.G.O's art and skill pictures: its card in one fetch
WORD_PACK = 64 << 10  # keyword pictures, ~5 KB each
GAME_PACK = 128 << 10  # skill pictures, ~15 KB each
VOICE_PACK = 256 << 10  # voice lines, ~60 KB each
SCENE_PACK = 384 << 10  # story backgrounds, ~350 KB each
# PARTS: the site's data, one manifest each (d/m/<name>.json.gz), made in this order by Exporter.pages()
#   cfg     made only when this site setting is on
#   taken   pull() takes it from the site when this computer can't go on from its own (langs, buffs, fx: own rules there)
#   crawl   made by following links (Exporter.crawl): the lists to start from (or a name in STARTS: found when sending), and packs by request (first match wins;
#           a tuple of patterns = one group in that order); without it: the Exporter method of the part's name
#   by      "verify": made by the check (verify), not by pages()
#   always  made every time (from the internet, or one request); any other part is skipped while what it is made from
#           (the app, the game version, the site settings, its "uses": INPUTS) is as when it was made last (Exporter.pages)
PARTS = {
    "quiz": {"cfg": "games", "taken": True, "crawl": {"stage": "Games (voice lines)", "start": ["/api/quiz"], "sort": True,
             "packs": [(r"/api/quiz$", PACK), (r"/api/quiz_audio\?", VOICE_PACK), (r"/api/asset_thumb\?", PACK)]}},
    # the Games page's card pictures: random picks, made again only when the game or the app changes; the index gives the list
    "cards": {"cfg": "games", "taken": True, "crawl": {"stage": "Games (cards)", "start": ["/api/game_cards?n=9"], "packs": [],
              "prune": ["/api/game_cards?n=9"], "inline": {"cards": "/api/game_cards?n=9"}}},
    # Guess the Canto picks a background at random: all of them, a small one with its full-size picture
    "scenes": {"cfg": "games", "taken": True, "crawl": {"stage": "Games (story backgrounds)", "start": ["/api/game_pics"],
               "packs": [(r"/api/game_pics$", PACK), (r"/api/asset_img\?", SCENE_PACK), (r"/api/asset_thumb\?", GAME_PACK)]}},
    "gacha": {"cfg": "games", "taken": True, "crawl": {"stage": "Games (Extraction)", "start": ["/api/gacha"],
              "packs": [((r"/api/gacha$", r"/api/gacha_ui\?", r"/api/asset_img\?"), PACK), (r"/api/quiz_audio\?", VOICE_PACK)]}},
    # Guess the arena (the stage pictures) and Guess the sound (a few lines of each announcer, all of the E.G.O's)
    "newgames": {"cfg": "games", "taken": True, "uses": ["stage pictures"], "crawl": {"stage": "Games (arenas, voices)", "start": ["/api/game_arenas", "/api/stage_pics", "/api/game_voices"],
                 "sources": "voices", "prune": ["/api/game_voices"],
                 "packs": [((r"/api/game_arenas$", r"/api/stage_pics$"), PACK), (r"/api/stage_pic\?", GAME_PACK), (r"/api/bank\?", VOICE_PACK)]}},
    # the database (Identities & E.G.O; other pages show its pictures too), the interface's icons and fonts
    "units": {"taken": True, "crawl": {"stage": "Identities & E.G.O", "start": ["/api/units", "/api/ui_icons"], "packs": "units"}},
    "langs": {"always": True, "crawl": {"stage": "Languages", "start": ["/api/langs", "/api/ui_langs"], "sources": "langs",
              "fresh": [r"/api/ui_lang\?"], "packs": [((r"/api/lang\?", r"/api/langfont\?", r"/api/langs$", r"/api/ui_langs$", r"/api/ui_lang\?"), PACK)],
              "hold": "langs"}},  # (hold: a computer with no translations of its own leaves the site's as they are)
    "small": {"always": True, "crawl": {"stage": "News", "start": ["/api/news", "/api/growth"], "packs": []}},  # (one-list pages asked every time)
    # the planner's gifts then theme packs with its list, the history with the rest
    "tools": {"taken": True, "uses": ["enemy pictures"], "crawl": {"stage": "Tools (planner, change history)", "start": ["/api/mirror", "/api/history"],
              "packs": [((r"/api/mirror$", r"/api/asset_thumb\?path=.*/EgoGiftIcon/", r"/api/asset_thumb\?path=.*/card_pack/"), PACK)]}},
    "buffs": {"uses": ["buff videos"], "crawl": {"stage": "Buff effects", "start": ["/api/buffs"], "packs": [], "final": "buffs"}},
    "fx": {"cfg": "spine", "uses": ["skill videos"]},  # (the Animations page: its "With effects" tab — limbusdm/sitefx.py)
    # the Animations list, its Spine skeletons with their illustrations' layers, battle clips with their sprites
    "anim": {"cfg": "spine", "taken": True, "uses": ["fx"], "crawl": {"stage": "Animations", "start": ["/api/characters"], "shape": "anim",
             "versions": "anim", "renew": {"av": r"/api/(spine_scene|owner_clips|clip)\?"}, "packs": "anim"}},  # (av: answers with links)
    "enemies": {"cfg": "enemies", "taken": True, "uses": ["enemy pictures"], "crawl": {"stage": "Enemies", "start": ["/api/enemies"],
                "packs": [(r"/api/enemies$", PACK), (r"/api/enemy_thumb\?", VOICE_PACK)]}},
    "music": {"cfg": "music", "taken": True, "crawl": {"stage": "Music", "start": ["/api/music"], "sources": "music", "packs": []}},  # (Opus from the banks)
    # the Story list, every story file, its pictures, standing models, sounds and voices; Story workshop's catalog; the Story map
    "story": {"cfg": "story", "uses": ["story reader"], "crawl": {"stage": "Story", "hold": "story", "packs": "story",
              "start": ["/api/story", "/api/story_lines", "/api/story_kit", "/api/ui_sprite?n=SettingIcon", "/api/stages"],
              "fresh": [r"/api/story_ep\?"], "versions": "story", "renew": {"mv": r"/api/story_model\?"}}},
    "announcers": {"cfg": "story", "taken": True, "crawl": {"stage": "Announcers", "start": ["/api/announcers"],
                   "packs": [(r"/api/announcers$", PACK), ((r"/api/asset_thumb\?", r"/api/asset_img\?"), GAME_PACK),
                             (r"/api/bank\?", VOICE_PACK)]}},
    "abnologs": {"cfg": "story", "taken": True, "uses": ["enemy pictures", "abno authors"], "crawl": {"stage": "Abnormality logs", "start": ["/api/abno_logs"],
                 "packs": [(r"/api/abno_logs$", PACK), ((r"/api/asset_thumb\?", r"/api/enemy_thumb\?"), GAME_PACK)]}},
    # the big games (ui/big, built): every request they make, found by running them in a hidden window; the lists are asked every time
    "biggames": {"taken": True, "uses": ["big games"], "crawl": {"stage": "Big games", "start": "biggames", "versions": "biggames", "ask": r"/api/(frames|sounds)\b",
                 "packs": [(r"/api/(frames|sounds)\b", PACK), (r"/api/(?!frames\b|sounds\b|bank\b)", GAME_PACK), (r"/api/bank\?", VOICE_PACK)]}},
    "extra": {"taken": True, "by": "verify"},  # (requests the check found unanswered: Exporter.extra)
}
TAKEN_PARTS = tuple(n for n, p in PARTS.items() if p.get("taken"))
assert all(p.get("part") in PARTS for p in PAGES.values() if "part" in p)

CARD_PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{full}</title>
{head}
<script>if(!/bot|crawl|spider|slurp|lighthouse/i.test(navigator.userAgent))location.replace({to})</script>
<style>body{{margin:0;background:#12100e;color:#e9e2d4;font:16px/1.55 system-ui,"Segoe UI",sans-serif}}main{{max-width:860px;margin:0 auto;padding:16px}}a{{color:#e8b33a}}</style>
</head><body><main><h1>{title}</h1><p>{desc}</p>{body}<p><a href="/#/{route}">Open on Limbus Archive</a></p></main></body></html>
"""
# requests the check never fetches by itself
NO_HEAL = re.compile(r"^/api/(_|state|settings|disk|check|update|appnotes|patchnotes|fx|mod|frame|versus|skills|skill_slots|owner_|clip|"
                     r"local_video|sprites|browse|tree|types|container|scan|bank|export|open|site_|object|blob|report|characters|"
                     r"music_audio|quiz_audio|community|buff)")  # (community: who is live right now — a copy would only go stale)
JOURNAL = "fetched.txt"  # (Exporter._journal_add)
NO_JOURNAL = re.compile(r"^/api/(fx_video|buff_video|enemy_thumb)\b")
CJK = re.compile("[぀-ヿ㐀-鿿가-힯]")


def own_file(svc, name: str) -> str:
    """The site's own files in the data folder (settings, what was sent, …)."""
    return os.path.join(svc.data_dir, name)


SITE_DIR = "site_dir.json"  # (in the data folder) {"dir": …}: the folder site/ and site_packed/ are kept in, when not the data folder


def site_root(svc) -> str:
    """The folder site/ and site_packed/ are in (move())."""
    return _read_json(own_file(svc, SITE_DIR)).get("dir") or svc.data_dir


def root_missing(svc) -> str:
    """The site's own folder when it is set and not there (its drive not connected), else ""."""
    d = site_root(svc)
    return "" if d == svc.data_dir or os.path.isdir(d) else d


def out_dir(svc) -> str:
    return os.path.join(site_root(svc), "site")


def config(svc) -> dict:
    """data/site_config.json, over DEFAULTS."""
    c = dict(DEFAULTS)
    try:
        with open(own_file(svc, "site_config.json"), encoding="utf-8") as f:
            c.update(json.load(f))
    except (OSError, ValueError):
        pass
    c["url"] = MOVED.get((c["url"] or "").rstrip("/"), c["url"])
    return c


def build_info(svc) -> dict:
    """What a copy was made from: app version, hash of ui/, time, game version."""
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
    """Writes data/site_worker (worker.js + wrangler config); returns the config's path."""
    folder = own_file(svc, "site_worker")
    os.makedirs(folder, exist_ok=True)
    shutil.copyfile(os.path.join(resource_dir(), "ui", "site", "worker.js"), os.path.join(folder, "worker.js"))
    cfg = {"name": config(svc)["project"], "main": "worker.js", "compatibility_date": "2025-09-01",
           "assets": {"directory": packed_dir(svc), "binding": "ASSETS"},
           "durable_objects": {"bindings": [{"name": "ROOMS", "class_name": "Room"}, {"name": "STATS", "class_name": "Stats"}]},
           "migrations": [{"tag": "v1", "new_sqlite_classes": ["Room"]}, {"tag": "v2", "new_sqlite_classes": ["Stats"]}]}
    saves = config(svc).get("saves_db")
    if isinstance(saves, dict) and saves.get("id"):  # the games' save codes (worker.js /save)
        cfg["d1_databases"] = [{"binding": "SAVES", "database_name": saves.get("name") or "limbus-saves", "database_id": saves["id"]}]
    cfg["vars"] = {}
    if isinstance(config(svc).get("budget"), dict):  # what a period of the Cloudflare plan may spend (worker.js)
        cfg["vars"]["BUDGET"] = json.dumps(config(svc)["budget"])
    if config(svc)["url"]:  # the site's own address: its old one (*.workers.dev) and www. move there (worker.js moved)
        cfg["vars"]["HOME"] = config(svc)["url"].rstrip("/")
        # data and UI files skip the Worker
        cfg["assets"]["run_worker_first"] = ["/*", "!/d/*", "!/ui/*", "!/sw.js"]
    path = os.path.join(folder, "wrangler.jsonc")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=1)
    return path


def deploy_command(svc) -> str:
    """The upload command to run by hand."""
    return f'npx wrangler deploy -c "{worker_config(svc)}"'


def status(svc) -> dict:
    """This app's build next to the one the site is showing, for the Settings page."""
    cfg, mine = config(svc), build_info(svc)
    out = {"url": cfg["url"], "project": cfg["project"], "app": mine, "site": None, "error": None,
           "command": deploy_command(svc) if cfg["project"] else "", "last": _read_json(own_file(svc, "site_sent.json")).get("last"),
           "log": (_read_json(own_file(svc, SEND_LOG)).get("list") or [])[::-1], "dir": site_root(svc), "dir_missing": bool(root_missing(svc))}
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


ADMIN = "site_admin.json"  # (in the data folder) the owner's choices: pages turned on / off, reports taken off the site
# ("back": put back, not taken off again by the site's list)


def admin(svc) -> dict:
    a = _read_json(own_file(svc, ADMIN))
    return {k: list(a.get(k) or []) for k in ("on", "off", "removed", "back")}


def admin_save(svc, a: dict):
    path = own_file(svc, ADMIN)
    with open(path + ".tmp", "w", encoding="utf-8") as f:
        json.dump(a, f, indent=1)
    os.replace(path + ".tmp", path)


def report_name(rid: str) -> str:
    return "report-" + hashlib.sha1(rid.encode()).hexdigest()[:12]


def _bilibili_live() -> dict:
    from . import bilibili, community
    return {url_key("/api/bilibili", period=p, sort=s): community.URL.replace("streams.json", f"bilibili_{p}_{s}.json")
            for p in bilibili.PERIODS for s in bilibili.SORTS}


def url_key(path: str, /, **q) -> str:
    """A request as the service worker names it (path + sorted params)."""
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
    """A report without the player's own files (LocalLow saves, logs)."""
    own = lambda it: str(it.get("path") or "").startswith("locallow/") and not str(it["path"]).startswith("locallow/notice/")
    rep = dict(rep, sections={k: [it for it in v if not own(it)] for k, v in rep["sections"].items()},
               foreign_only=[f for f in rep.get("foreign_only", []) if not str(f.get("file") or "").startswith("locallow/")])
    rep["summary"] = dict(rep["summary"], foreign_only=len(rep["foreign_only"]),
                          **{k: len(v) for k, v in rep["sections"].items() if k in rep["summary"]})
    return rep


# ------------------------------------------------------------------ files
def _ffmpeg() -> str:
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def _shrink(data: bytes, ctype: str, key: str = "") -> tuple[bytes, str]:
    """Smaller form for the web: PNG → WebP, WAV → Opus; failures stay as they are."""
    spine, music = key.startswith("/spine/"), key.startswith("/api/music_audio")
    voice = key.startswith("/api/bank") and "/Voice_" in key
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
            p = subprocess.run([_ffmpeg(), "-v", "error", "-i", "pipe:0", "-c:a", "libopus", "-b:a", "96k" if music else "40k" if voice else "72k", "-fflags", "+bitexact", "-flags:a", "+bitexact", "-f", "ogg", "pipe:1"],
                               input=data, capture_output=True, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            if p.returncode == 0 and p.stdout:
                return p.stdout, "audio/ogg"
    except Exception:
        pass
    return data, ctype


# the big games (PAGES "beta"): what of their requests the site keeps (the rest: other parts, or the app's own)
BIG_ASKS = {"/api/frames", "/api/frame_png", "/api/sounds", "/api/bank", "/api/stage_pic", "/api/asset_thumb", "/api/asset_img", "/api/enemy_thumb",
            "/api/char_icon", "/api/ui_icon", "/api/scene_sprite", "/api/object", "/api/owner_videos", "/api/collection_refs"}


def _big_needs(base: str, progress=None) -> list[str]:
    """Every request the big games make, from the app at `base`, run in a hidden window."""
    from .sitecheck import _Tab, _free_port, close_browser, find_browser, new_profile
    exe = find_browser()
    if not exe:
        raise RuntimeError("no Edge or Chrome to run the games in")
    port, prof = _free_port(), new_profile("limbus-big-")
    proc = subprocess.Popen([exe, "--headless=new", f"--remote-debugging-port={port}", f"--user-data-dir={prof}", "--window-size=1400,1000",
                             "--remote-allow-origins=*", "--mute-audio", "--no-first-run", "--disable-extensions", "--disable-sync", "--disable-background-timer-throttling",
                             "--disable-renderer-backgrounding", "--autoplay-policy=no-user-gesture-required", "about:blank"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    tab = None
    try:
        tabs = None
        for _ in range(60):
            try:
                tabs = json.load(urlopen(f"http://127.0.0.1:{port}/json", timeout=2))
                break
            except Exception:
                time.sleep(0.25)
        if not tabs:
            raise RuntimeError("the browser didn't start")
        tab = _Tab((next((t for t in tabs if t["type"] == "page" and t["url"] == "about:blank"), None)  # (not a page a profile opened)
                    or next(t for t in tabs if t["type"] == "page"))["webSocketDebuggerUrl"])
        tab.call("Page.enable")
        tab.call("Page.navigate", url=base + "/#/biggames")
        end = time.time() + 60
        while tab.js("window.bigLoaded === true && typeof bigNeeds === 'function'") is not True:
            if time.time() > end:
                raise RuntimeError("the big games didn't load")
            time.sleep(0.5)
        # (long: every enemy's frames; asked for in the page, read back when done)
        tab.js("window.__need = null; bigNeeds().then((l) => { window.__need = l; }, (e) => { window.__need = String(e); }); 0")
        end, t0 = time.time() + 1800, time.time()
        while True:
            got = tab.js("window.__need")
            if isinstance(got, list):
                return got
            if isinstance(got, str) or time.time() > end:
                raise RuntimeError(f"the big games' data: {got or 'too slow'}")
            if progress:
                progress("site: Big games (what they use)", 0, 0, f"{int(time.time() - t0)} s")
            time.sleep(1)
    finally:
        try:
            tab and tab.call("Browser.close")
        except Exception:
            pass
        close_browser(proc, prof)


def _grouped(got: dict, first: list[tuple[list, int]]) -> tuple[dict, list]:
    """A manifest's files in pack order, and its "groups" [[count, pack size]]: random-per-round files go in small
    packs."""
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


def _music_sources(svc, keys: list[str]) -> dict:
    """A track as Opus straight from its bank."""
    tracks, out = svc.music()["tracks"], {}
    for k in keys:
        m = re.fullmatch(r"/api/music_audio\?n=(\d+)", k)
        if m and int(m.group(1)) < len(tracks):
            t = tracks[int(m.group(1))]
            out[k] = url_key("/api/bank", path=t["bank"], i=t["i"])
    return out


def _voices_sources(svc, keys: list[str]) -> dict:
    """Guess the sound: a few lines of each announcer."""
    return {"/api/game_voices": url_key("/api/game_voices", n=ANNOUNCER_LINES)} if "/api/game_voices" in keys else {}


# PARTS "sources": a file made from another request than its own (key → request)
def _lang_sources(svc, keys: list[str]) -> dict:
    """A table as it is now: its request carries the table file's name (the same file = the same table)."""
    from . import langs
    out = {}
    for k in keys:
        m = re.fullmatch(r"/api/lang\?g=(\w+)&id=(.+)", k)
        if m:
            try:
                out[k] = k + "&v=" + os.path.basename(langs.table_file(svc, m.group(2), m.group(1)) or "")
            except Exception:
                pass  # (asked as it is: fails there)
    return out


SOURCES = {"music": _music_sources, "voices": _voices_sources, "langs": _lang_sources}


def _langs_hold(ex, old: dict) -> bool:
    from . import langs
    if not old or langs.own(ex.svc):
        return False
    # (lists an older app made: given the links the pages read now)
    add = {"/api/langs": lambda j: {**j, "langs": [{**x, "tables": {g: links.lang_table(x["id"], g) for g in langs.GROUPS}} if "tables" not in x
                                                  else x for x in j.get("langs") or []]},
           "/api/ui_langs": lambda j: j if "urls" in j else {**j, "urls": {c: links.ui_lang(c) for c in j.get("langs") or []}}}
    changed = False
    for key, fn in add.items():
        rel = (old.get("urls") or {}).get(key)
        if rel:
            j = ex._stored(rel)
            n = fn(j)
            if n != j:
                old["urls"][key] = ex._store(json.dumps(n, ensure_ascii=False).encode("utf-8"), "application/json", gz=True)
                changed = True
    if changed:
        ex.write_manifest("langs", old)
    return True


def _story_hold(ex, old: dict) -> bool:
    import importlib.util
    return importlib.util.find_spec("limbusdm.story") is None  # (a copy without the private reader)


HOLDS = {"langs": _langs_hold, "story": _story_hold}


def _story_versions(ex) -> dict:
    from . import story
    return {"mv": getattr(story, "MODEL_VERSION", 1)}  # (standing models placed anew: asked again)


VERSIONS = {"story": _story_versions, "anim": lambda ex: {"av": 1}, "biggames": lambda ex: _big_made(ex)}  # (anim 1: its answers carry links)


def _anim_shape(ex, got: dict):
    """The Animations list as the site shows it: enemies sorted by chapter, Spine only when the site has no battle clips, an
    enemy drawn by its battle prefab only with its videos here."""
    if "/api/characters" not in got:
        return
    chars = ex._stored(got["/api/characters"])
    for _ in range(100):  # the enemies' chapters are sorted in the background on the first run
        if not chars.get("pending"):
            break
        time.sleep(4)
        chars = json.loads(ex._get("/api/characters")[0])
    if not ex.cfg["clips"]:
        for s in chars["sinners"]:
            s["ids"] = [x for x in s["ids"] if x.get("spine")]
            s["egos"] = [x for x in s["egos"] if x.get("spine")]
            for x in s["ids"] + s["egos"]:
                x.pop("clips", None)
    sent = set(ex.read_manifest("fx").get("have") or {})
    for g in chars["groups"]:
        g["kinds"] = {k: arr for k, arr in ((k, [x for x in arr if not x.get("app") or x["app"] in sent]) for k, arr in g["kinds"].items()) if arr}
    chars["groups"] = [g for g in chars["groups"] if g["kinds"]]
    chars["pending"] = False
    got["/api/characters"] = ex._store(json.dumps(chars, ensure_ascii=False).encode("utf-8"), "application/json", gz=True)


# PARTS "shape": a part's lists as the site keeps them, before their links are followed (ex, {list: file})
SHAPES = {"anim": _anim_shape}

def _big_made(ex) -> dict:
    """What the big games' requests depend on: the game data and the built scripts (one dict per send: a failed run clears it)."""
    if hasattr(ex, "_big"):
        return ex._big
    big = os.path.join(resource_dir(), "ui", "big")
    names = sorted(fn for fn in os.listdir(big) if fn.endswith(".js")) if os.path.isdir(big) else []
    h = hashlib.sha1()
    for fn in names:
        with open(os.path.join(big, fn), "rb") as f:
            h.update(f.read())
    ex._big = {"made": f"{ex.svc.latest_snapshot_id()}|{h.hexdigest()[:12]}"} if names else {}
    return ex._big


def _big_start(ex, old: dict) -> list[str]:
    """The requests the big games make, as found by running them in a hidden window (bigNeeds); the old manifest's when
    nothing they depend on changed or they can't run."""
    made = _big_made(ex)
    if made and old.get("made") != made["made"]:
        try:
            keys = []
            for u in _big_needs(ex.base, ex.progress):
                path, _, qs = u.partition("?")
                if path in BIG_ASKS:
                    keys.append(url_key(path, **dict((k, unquote(v)) for k, _, v in (p.partition("=") for p in qs.split("&") if p))))
            return list(dict.fromkeys(keys))
        except Exception as e:
            ex.failed.append(("big games", str(e)))
            made.clear()  # (not recorded: tried again next time)
    return list(old.get("urls") or {})


STARTS = {"biggames": _big_start}


def _story_packs(ex, got: dict) -> list:
    """Story's packs: lists and models, small pictures and model sprites, scene pictures (chapter banners, each story
    file's in reading order, the map), effects and voices, music and videos."""
    K, read = links.key, lambda k: ex._stored(got[k]) if k in got else {}  # noqa: E731
    idx, kit, sdb = read("/api/story"), read("/api/story_kit"), read("/api/stages")
    chapters = (idx.get("main") or []) + (idx.get("other") or [])
    files = [K(f) for f in dict.fromkeys([p[4] for c in chapters for e in c["eps"] for p in e["parts"]]
                                         + [it["info"] for s in idx.get("ident") or [] for it in s["items"]]) if f]
    lists = ["/api/story", "/api/story_lines", "/api/story_kit", "/api/ui_sprite?n=SettingIcon"] + files
    thumbs = [c["tile"] for c in chapters if c.get("tile")] + [c["tile"] for c in kit.get("chars") or [] if c.get("tile")]
    thumbs += [n["picUrl"] for c in sdb.get("chapters") or [] for n in c["nodes"] if n.get("picUrl")]
    banners = {p[2]: p[3] for c in chapters for e in c["eps"] for p in e["parts"] if p[2]} | {c["pic"]: c["big"] for c in chapters if c.get("pic")}
    pics = [banners[b] for b in sorted(banners)]
    models, sprites, sounds, voices, music, videos = [], [], [], [], [], []
    for f in files:
        ep = read(f)
        if not ep:
            continue
        L = ep.get("links") or {}
        pics += [L.get("1920|" + v) for v in ep["pics"].values()]
        for m in ep["models"].values():
            if m.get("img"):
                pics.append(L.get("2048|" + m["img"]))
            if m.get("psb"):
                models.append(L.get("m|" + m["psb"]))
                sprites += [x["url"] for x in read(K(L.get("m|" + m["psb"]) or "")).get("layers") or [] if x.get("url")]
        for ln in ep["lines"]:
            voices.append(L.get("a|" + ln["v"]) if ln.get("v") else "")
            sounds += [L.get("a|" + x) for x in ln.get("sfx") or []]
            music.append(L.get("a|" + ln["bgm"]) if ln.get("bgm") else "")
            videos.append(L.get("v|" + ln["vid"]) if ln.get("vid") else "")
    pics += [u[1] for c in sdb.get("chapters") or [] for u in (c.get("tileUrls") or {}).values()]  # (the map close up)
    k = lambda xs: [K(x) for x in xs if x]  # noqa: E731
    return [(k(lists + models), PACK), (k(thumbs + sprites), GAME_PACK), (k(pics), SCENE_PACK), (k(sounds + voices), VOICE_PACK), (k(music + videos), PACK)]


def _units_packs(ex, got: dict) -> list:
    """The database's packs: the newest faces (the front page, the list's first screen), skill pictures small (the games pick
    at random), keyword pictures by name, a card's art and skill pictures in a pack of its own (the second art in the next),
    then the rest in the order of old (lists, icons, fonts, small pictures, big ones); an E.G.O's own skill pictures after."""
    if "/api/units" not in got:
        return []
    K, u = links.key, ex._stored(got["/api/units"])
    kit = ex._stored(got["/api/ui_icons"]) if "/api/ui_icons" in got else {}
    ids, egos = u.get("ids") or [], u.get("egos") or []
    fresh = sorted(ids, key=lambda x: (x.get("date") or "", x["id"]), reverse=True)
    faces = [x["pics"]["thumb"] for x in fresh for k in ("thumb", "art") if (x.get("img") or {}).get(k)]  # (two per Identity: its art's small one is the same)
    icons = [s["iconUrl"] for x in ids for s in (x.get("skills") or []) + (x.get("defense") or [])]
    words = sorted(k for k in got if k.startswith("/api/asset_thumb?") and "/Buf/" in k)
    cards = []
    for x in ids + egos:
        p = x["pics"]
        cards.append(([p["art"]] + ([s["artUrl"] for s in (x.get("skills") or []) + (x.get("defense") or [])] if x.get("title") else [p["full"]]), CARD_PACK))
        if p["art2"]:
            cards.append(([p["art2"]], CARD_PACK))
    rest = ["/api/units"] + (kit.get("icons") or []) + (kit.get("fonts") or [])
    later = {K(s[f]) for x in egos for s in x.get("skills") or [] for f in ("iconUrl", "artUrl") if s.get(f)}
    rest += sorted(k for k in got if k.startswith("/api/asset_thumb?") and k not in later) + sorted(k for k in got if k.startswith("/api/asset_img?") and k not in later)
    k = lambda xs: [K(x) for x in xs if x]  # noqa: E731
    return [(k(faces[:FRESH_FACES]), PACK), (k(faces[FRESH_FACES:]), PACK), (k(icons), GAME_PACK), (words, WORD_PACK)] + [(k(c), n) for c, n in cards] + [(k(rest), PACK)]


def _anim_packs(ex, got: dict) -> list:
    """Animations' packs in the order of old: each skeleton's files and its illustration (its layers' skeletons, pictures,
    effect textures), then the clip lists, the clips, their sprites; the list last."""
    if "/api/characters" not in got:
        return []
    K = links.key
    read = lambda k, empty: ex._stored(got[k]) if k in got else empty  # noqa: E731
    ch = read("/api/characters", {})
    units = [c for s in ch.get("sinners") or [] for c in s["ids"] + s["egos"]]
    todo = [x for c in units for x in c["spine"]] + [x for g in ch.get("groups") or [] for arr in g["kinds"].values() for x in arr if x.get("files")]
    keys, seen = [], set()

    def skeleton(files):
        a = K(files["atlas"])
        if a not in seen:
            seen.add(a)
            keys.extend([a, K(files["json"])] + (ex._links(a, got[a]) if a in got else []))  # (the atlas names its pages)
    for x in todo:
        skeleton(x["files"])
        keys.append(K(x["scene"]))
        for l in read(K(x["scene"]), {}).get("layers") or []:
            if l.get("files"):
                skeleton(l["files"])
            else:
                keys.extend(K(l[f]) for f in ("url", "noiseUrl", "dissolveUrl") if l.get(f))
    lists = [K(c["clips"]) for c in units if c.get("clips")]
    clips = list(dict.fromkeys(K(cl[f]) for k in lists for cl in read(k, []) for f in ("url", "allUrl") if cl.get(f)))
    sprites = [K(s["url"]) for k in clips for s in (read(k, {}).get("sprites") or {}).values() if s.get("url")]
    return [(keys + lists + clips + sprites + ["/api/characters"], PACK)]


PACKERS = {"story": _story_packs, "units": _units_packs, "anim": _anim_packs}


def _report_order(ex, r: dict, got: dict) -> list[str]:
    """A report's files in reading order: notes, pictures, objects, sounds, notable names, then what their folders hold."""
    S, out, later = r["sections"], [r["notes"]], []
    for it in S.get("images", []):
        out += [it["pics"]["old"], it["pics"]["new"], it.get("open")]
    for sec in ("texts", "data", "video", "code"):
        for it in S.get(sec, []):
            out += [it.get("blob"), it.get("open")]
    for it in S.get("audio", []):
        sd = it.get("sounds") or {}
        out += [s[3] for k in ("added", "changed") for s in sd.get(k, []) if len(s) > 3]
    for it in S.get("leaks", []):
        out.append(it.get("thumb") or it.get("open"))
        if it.get("container"):
            later += [it["container"], it["tree"]]
            try:
                later += [x["url"] for x in ex._stored(got[links.key(it["container"])])]
            except (KeyError, OSError, ValueError):
                pass
    return list(dict.fromkeys(links.key(u) for u in out + later if u))


def _buffs_final(ex, got: dict, old: dict):
    """The videos made on the site's computer only: an older patch's stay until made again, the list says which are here."""
    from .viewer import _safe_name
    st = ex._stored(got["/api/buffs"])
    have = old.get("urls") or {}
    for b in st["list"]:
        for n in b.get("fx") or []:
            k = links.key(links.buff_video(n))
            if k not in got and have.get(k) and os.path.exists(os.path.join(ex.out, "d", have[k])):
                got[k] = have[k]
    names = list(dict.fromkeys(n for b in st["list"] for n in b.get("fx") or []))
    on = [n for n in names if links.key(links.buff_video(n)) in got]
    st.update(have=sorted({_safe_name(n) for n in on}), failed=[n for n in names if n not in on], queue=0, current=[], busy=False,
              error="", available=False, videos={n: links.buff_video(n) for n in on})
    got["/api/buffs"] = ex._store(json.dumps(st, ensure_ascii=False).encode("utf-8"), "application/json", gz=True)
    extra = ex.read_manifest("extra")  # (the old auto-fetched copy)
    if any(k.startswith("/api/buff") for k in extra.get("urls", {})):
        extra["urls"] = {k: f for k, f in extra["urls"].items() if not k.startswith("/api/buff")}
        ex.write_manifest("extra", extra)


FINALS = {"buffs": _buffs_final}

_APP: list[str] = []
CODE_SIG = "code_sig.txt"  # (written by build.ps1 next to the built app's modules)


def code_sig() -> str:
    """The code the app's answers come from: limbusdm/*.py and the private modules, without __init__ (its version number)."""
    import limbusdm
    files = {fn: os.path.join(d, fn) for d in limbusdm.__path__ if os.path.isdir(d)
             for fn in os.listdir(d) if fn.endswith(".py") and fn != "__init__.py"}
    h = hashlib.sha1()
    for fn in sorted(files):
        with open(files[fn], "rb") as f:
            h.update(fn.encode() + f.read().replace(bytes([13, 10]), bytes([10])))  # (same on any checkout)
    return h.hexdigest()[:16]


def app_sig() -> str:
    """What the app's answers come from: its code. A release that changes only pages or the version number keeps it, so the
    send after it asks nothing again."""
    if not _APP:
        import limbusdm
        sig = None
        if getattr(sys, "frozen", False):
            try:
                with open(os.path.join(os.path.dirname(limbusdm.__file__), CODE_SIG), encoding="utf-8") as f:
                    sig = f.read().strip() or "v" + limbusdm.__version__
            except OSError:  # (built without it: the version stands in)
                sig = "v" + limbusdm.__version__
        _APP.append(sig or code_sig())
    return _APP[0]


def _files_sig(folder: str) -> list:
    """Every file under a folder: name, size, time."""
    out = []
    for d, dirs, files in os.walk(folder):
        dirs.sort()
        for fn in sorted(files):
            try:
                st = os.stat(os.path.join(d, fn))
            except OSError:
                continue
            out.append([os.path.relpath(os.path.join(d, fn), folder), st.st_size, int(st.st_mtime)])
    return out


def _file_sig(path: str) -> list:
    try:
        st = os.stat(path)
        return [st.st_size, int(st.st_mtime)]
    except OSError:
        return []


def _story_version():
    try:
        from . import story
        return story.VERSION
    except ImportError:
        return None


# what a part is made from besides the app, the game version and the site settings (PARTS "uses")
INPUTS = {
    "skill videos": lambda ex: _files_sig(os.path.dirname(ex.svc.fx.out_dir(0))),
    "buff videos": lambda ex: _files_sig(ex.svc.buff_fx.folder()),
    "fx": lambda ex: ex.manifest_hash("fx"),  # (the Animations list names enemies with videos)
    "story reader": lambda ex: _story_version(),
    "big games": lambda ex: _files_sig(os.path.join(resource_dir(), "ui", "big")),
    "enemy pictures": lambda ex: _files_sig(os.path.join(ex.svc.data_dir, "enemy_thumbs")),  # (drawn by the app's pages)
    "stage pictures": lambda ex: _files_sig(os.path.join(ex.svc.data_dir, "stage_thumbs")),  # (made by the player on demand)
    "abno authors": lambda ex: _file_sig(os.path.join(resource_dir(), "ui", "abno_authors.json")),
}
MADE = "made.json"  # (d/, not uploaded) what each part was made from, what was sent last (Exporter.pages, _publish)
EVERY_PAGE = ("langs", "extra")  # parts any page may read: a change opens all of them in the check


def check_routes(changed: set) -> list[str] | None:
    """The pages to open again when only these manifests changed (None: all): home, theirs, the patches for a report."""
    if changed & set(EVERY_PAGE):
        return None
    want = {"home"} | {r for r, p in PAGES.items() if p.get("part") in changed}
    if any(n.startswith("report-") for n in changed):
        want |= {"patches", "news"}
    return [r for r in PAGES if r in want and not PAGES[r].get("app")]


class Exporter:
    def __init__(self, svc, base_url: str, out: str | None = None, progress=None):
        if out is None and root_missing(svc):
            raise RuntimeError(f"the site's folder {root_missing(svc)} isn't there — connect its drive (or move the site "
                               "back in Settings → Website)")
        self.svc, self.base, self.out = svc, base_url.rstrip("/"), out or out_dir(svc)
        self.cfg = config(svc)
        self.progress = progress or (lambda stage, done, total, msg="": None)
        self.failed: list[tuple[str, str]] = []
        self.fresh: dict[str, int] = {}  # what was asked from the app this time (not kept from before), by part of the site
        self.same: list[str] = []  # parts skipped: made from the same as last time
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
        """keys → {key: file}; `have` = last manifest; sources: the request that really gives a key's content."""
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
        # sounds one at a time (FMOD), pictures a few at once
        with ThreadPoolExecutor(4) as pool:
            list(pool.map(one, todo))
        part = stage.replace("site: ", "")  # (a crawl asks level by level)
        self.fresh[part] = self.fresh.get(part, 0) + resumed + sum(1 for k in todo if k in out)  # (the rest: the app has nothing there)
        return {k: out[k] for k in keys if k in out}  # (in the asked order, not as they came: the same packs next time)

    # a send that stops halfway goes on next time from d/fetched.txt
    def _journal_path(self) -> str:
        return os.path.join(self.out, "d", JOURNAL)

    def _journal_head(self) -> str:
        # (another game version or another app: the answers may differ)
        return json.dumps({"game": _game(self.svc.latest_snapshot_id()), "app": app_sig()})

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
        """Files of an older manifest still valid for this game version."""
        if not old.get("id"):
            return {}
        urls = {k: f for k, f in (old.get("urls") or {}).items() if k not in skip}
        if _game(old["id"]) == _game(self.svc.latest_snapshot_id()):
            return urls
        same = self.unchanged(old["id"])
        return {k: f for k, f in urls.items() if same(k)} if same else {}

    def unchanged(self, old_id: str):
        """→ whether game version `old_id` answers a request as this one does (None: unknown)."""
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

    def manifest_hash(self, name: str) -> str:
        """A manifest's content ("" without one)."""
        try:
            with gzip.open(self._manifest_path(name), "rb") as f:
                return hashlib.sha1(f.read()).hexdigest()[:16]
        except (OSError, EOFError):
            return ""

    # -- what the parts were made from, what was sent (d/made.json)
    def made(self) -> dict:
        return _read_json(os.path.join(self.out, "d", MADE))

    def made_save(self, made: dict):
        path = os.path.join(self.out, "d", MADE)
        with open(path + ".tmp", "w", encoding="utf-8") as f:
            json.dump(made, f)
        os.replace(path + ".tmp", path)

    def _inputs(self, name: str) -> str:
        p = PARTS[name]
        got = {"app": app_sig(), "game": self.svc.latest_snapshot_id(), "cfg": {k: v for k, v in self.cfg.items() if isinstance(v, bool)},
               "part": p, **{u: INPUTS[u](self) for u in p.get("uses") or []}}
        return hashlib.sha1(json.dumps(got, sort_keys=True, default=str).encode()).hexdigest()[:16]

    def _whole(self, name: str, here: set) -> bool:
        """Every file of a manifest is here (`here`: the files in d/f, listed once)."""
        m = self.read_manifest(name)
        return bool(m) and all(f in here for f in m.get("urls", {}).values() if isinstance(f, str) and f)

    def _listed(self) -> set:
        root = os.path.join(self.out, "d", "f")
        return {f"f/{d.name}/{fn}" for d in os.scandir(root) if d.is_dir() for fn in os.listdir(d.path)} if os.path.isdir(root) else set()

    def state(self) -> dict:
        """What the site is written from: every manifest, the translations, and what the pages take besides."""
        mdir, trdir = os.path.join(self.out, "d", "m"), os.path.join(self.out, "d", "tr")
        ms = {fn[:-8]: self.manifest_hash(fn[:-8]) for fn in sorted(os.listdir(mdir)) if fn.endswith(".json.gz")}
        tr = {}
        for fn in sorted(os.listdir(trdir)) if os.path.isdir(trdir) else []:
            try:
                with gzip.open(os.path.join(trdir, fn), "rb") as f:
                    tr[fn] = hashlib.sha1(f.read()).hexdigest()[:16]
            except (OSError, EOFError):
                tr[fn] = ""
        pages = {"build": {k: v for k, v in build_info(self.svc).items() if k != "stamp"}, "app": app_sig(), "cfg": self.cfg,
                 "admin": admin(self.svc), "open": _read_json(os.path.join(self.out, "d", "check.json")).get("open"), "tr": tr}
        return {"m": ms, "pages": hashlib.sha1(json.dumps(pages, sort_keys=True, default=str).encode()).hexdigest()[:16]}

    # -- pages
    def report(self, rid: str) -> dict | None:
        rep = public(self.svc.store.read_json(f"reports/{rid}.json.gz"))
        name = "report-" + hashlib.sha1(rid.encode()).hexdigest()[:12]
        if not any(rep["sections"].values()) and not rep["catalog"]["added"] and not rep["catalog"]["removed"]:
            # nothing of the game changed (only the player's own files did): not a report for the site
            for path in (self._manifest_path(name), os.path.join(self.out, "d", "tr", name + ".json.gz")):
                if os.path.exists(path):
                    os.remove(path)
            made = self.made()
            if rid not in made.get("empty", []):  # (not read again by the next send: _publish)
                self.made_save({**made, "empty": made.get("empty", []) + [rid]})
            return None
        key = url_key("/api/report", id=rid)
        flags = "".join(f"&{k}=1" for k in ("full_images", "video", "audio") if self.cfg[k])
        meta = next((dict(r, summary=rep["summary"]) for r in self.svc.reports() if r["id"] == rid), None)

        def final(ex, got, old):
            r = ex._stored(got[key])
            gone = [it for it in r["sections"].get("images", []) if it.get("open") and links.key(it["open"]) not in got]
            for it in gone:  # (a picture's full size the app could not give: the page shows its preview)
                del it["open"]
            rel = ex._store(json.dumps(r, ensure_ascii=False).encode("utf-8"), "application/json", gz=True) if gone else got[key]
            rest = {k: f for k, f in got.items() if k != key}
            keep = {k: rest[k] for k in _report_order(ex, r, got) if k in rest}  # (a pack holds its files in this order)
            keep.update((k, f) for k, f in rest.items() if k not in keep)
            keep[key] = rel
            got.clear()
            got.update(keep)
        sec = {"stage": rid[-15:], "start": [key], "packs": [], "keep_all": True, "final": final,
               "sources": lambda svc, keys: {key: key + "&site=1" + flags},  # (the web copy's own answer: cleaned, with the files it holds)
               "manifest": {"kind": "report", "id": rid, "meta": meta}}
        m = self.crawl(name, sec)
        self._translations(name, rep)
        return m

    def _translations(self, name: str, rep: dict):
        """Lines the UI would translate, as far as already translated."""
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

    def crawl(self, name: str, sec: dict | None = None) -> dict:
        """A part made by following links (PARTS "crawl"): its lists, then every file their answers link to (links.py), level
        by level. sec: a manifest that is no part (a report) brings its own."""
        sec = sec or PARTS[name]["crawl"]
        stage = "site: " + sec["stage"]
        old, app = self.read_manifest(name), app_sig()
        if sec.get("hold") and HOLDS[sec["hold"]](self, old):
            return old
        ver = VERSIONS[sec["versions"]](self) if sec.get("versions") else {}
        start = STARTS[sec["start"]](self, old) if isinstance(sec["start"], str) else sec["start"]  # (a name: found when sending)
        ask = [k for k in start if re.match(sec["ask"], k)] if sec.get("ask") else start  # (the lists: asked every time)
        have = {k: f for k, f in (old.get("urls") or {}).items() if k not in ask} if sec.get("keep_all") else self.kept(old, ask)
        if old.get("app") != app and not sec.get("keep_all"):  # (another app may answer differently: its answers asked again, pictures kept)
            have = {k: f for k, f in have.items() if ".json" not in f}
        fresh = list(sec.get("fresh") or []) + [p for v, p in (sec.get("renew") or {}).items() if old.get(v) != ver.get(v)]
        if fresh:  # …and these
            have = {k: f for k, f in have.items() if not any(re.match(p, k) for p in fresh)}
        self.progress(stage, 0, 0)
        got, todo, srcs = {}, list(start), {}
        seen = set(todo)
        while todo:
            level_have = have
            if sec.get("sources"):  # a file made from another request: kept while that request is the same
                src = (SOURCES[sec["sources"]] if isinstance(sec["sources"], str) else sec["sources"])(self.svc, todo)
                srcs.update(src)
                level_have = {k: f for k, f in have.items() if k not in src}
                level_have.update((k, old["urls"][k]) for k, s in src.items() if (old.get("src") or {}).get(k) == s and k in (old.get("urls") or {}) and k not in ask)
            level = self.fetch_all(todo, level_have, stage, srcs)
            if sec.get("shape") and not got:  # (the lists as the site shows them)
                SHAPES[sec["shape"]](self, level)
            got.update((k, level[k]) for k in todo if k in level)
            todo = [k for k in dict.fromkeys(k for t in todo if t in level for k in self._links(t, level[t])) if k not in seen]
            seen.update(todo)
        for key in sec.get("prune", ()):
            if key in got:
                got[key] = self._prune(key, got)
        inline = {field: self._stored(got.pop(key)) for field, key in (sec.get("inline") or {}).items() if key in got}  # (the answer goes into the manifest: the index gives it)
        if sec.get("final"):  # the part's own last touch
            (FINALS[sec["final"]] if isinstance(sec["final"], str) else sec["final"])(self, got, old)
        order = sorted if sec.get("sort") else list  # (a pack holds its files in this order)
        if isinstance(sec["packs"], str):  # (a part's own order: site.PACKERS)
            first = PACKERS[sec["packs"]](self, got)
        else:
            first = [([k for p in ((pat,) if isinstance(pat, str) else pat) for k in order(k for k in got if re.match(p, k))], size) for pat, size in sec["packs"]]
        urls, groups = _grouped(got, first)
        m = {"kind": name, "id": self.svc.latest_snapshot_id(), "app": app, "urls": urls, "groups": groups, **ver, **(sec.get("manifest") or {})}
        if srcs:
            m["src"] = {k: s for k, s in srcs.items() if k in urls}
        m.update(inline)
        self.write_manifest(name, m)
        return m

    def _prune(self, key: str, got: dict) -> str:
        """An answer without the rows that link to a file this part has not got (the app had nothing there)."""
        bad = lambda v: isinstance(v, str) and LINK.match(v) and links.key(v) not in got  # noqa: E731
        drop = lambda v: bad(v) or (isinstance(v, list) and any(bad(x) for x in v)) or (isinstance(v, dict) and any(bad(x) for x in v.values()))  # noqa: E731

        def walk(o):
            if isinstance(o, dict):
                return {k: walk(v) for k, v in o.items()}
            return [walk(v) for v in o if not drop(v)] if isinstance(o, list) else o
        was = self._stored(got[key])
        now = walk(was)
        if now == was:
            return got[key]
        return self._store(json.dumps(now, ensure_ascii=False, separators=(",", ":")).encode("utf-8"), "application/json", gz=True)

    def _links(self, key: str, rel: str) -> list[str]:
        """What an answer links to: /api/… and /spine/… strings in a list's JSON, the pages an atlas names."""
        if key.endswith(".atlas"):
            with (gzip.open if rel.endswith(".gz") else open)(os.path.join(self.out, "d", rel), "rt", encoding="utf-8", errors="replace") as f:
                return [key.rpartition("/")[0] + "/" + ln.strip() for ln in f if ln.strip().lower().endswith(".png")]
        if not key.startswith("/api/") or ".json" not in rel:
            return []
        out = []

        def walk(o):
            if isinstance(o, dict):
                for v in o.values():
                    walk(v)
            elif isinstance(o, list):
                for v in o:
                    walk(v)
            elif isinstance(o, str) and LINK.match(o):
                out.append(links.key(o))
        try:
            walk(self._stored(rel))
        except (OSError, ValueError):
            pass
        return out

    def _stored(self, rel: str):
        """A JSON answer back from the file it was stored in."""
        with (gzip.open if rel.endswith(".gz") else open)(os.path.join(self.out, "d", rel), "rt", encoding="utf-8") as f:
            return json.load(f)

    def extra(self, keys: list[str]) -> int:
        """Requests the check found unanswered (manifest "extra") plus the pictures their lists name; returns how many got
        a file."""
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

    def open_routes(self) -> list[str]:
        a = admin(self.svc)
        # (BASE_OPEN always: a page added since the last site check would stay shut until the next one)
        got = (_read_json(os.path.join(self.out, "d", "check.json")).get("open") or []) + BASE_OPEN
        # (the big games: open once their data is sent; who sees them is beta.json "games")
        big = [r for r, p in PAGES.items() if p.get("beta") and os.path.exists(self._manifest_path(p["part"]))]
        return [r for r in dict.fromkeys(got + a["on"] + big) if r not in a["off"]]

    def pages(self):
        """Everything but the reports: PARTS in order; a part made from the same as last time, with its manifest as it
        left it and every file here, is skipped."""
        made = self.made()
        parts, here = made.setdefault("parts", {}), None
        for name, p in PARTS.items():
            if p.get("by") or (p.get("cfg") and not self.cfg[p["cfg"]]):
                continue
            sig, was = None if p.get("always") else self._inputs(name), parts.get(name) or {}
            if sig and was.get("in") == sig and was.get("m") == self.manifest_hash(name):
                here = self._listed() if here is None else here  # (nothing is deleted while parts are made)
                if self._whole(name, here):
                    self.same.append(name)
                    continue
            failed = len(self.failed)
            if "crawl" in p:
                self.crawl(name)
            else:
                getattr(self, name)()
            # (a list the app didn't give: asked again next time; a file it has nothing for stays so)
            ok = all("404" in e for _, e in self.failed[failed:])
            parts[name] = {"in": sig if ok else None, "m": self.manifest_hash(name)}
            self.made_save(made)
        self.extra_lists()

    def extra_lists(self):
        """The app's lists the check took into "extra" (Story map, planner catalog…), asked again every send."""
        old = self.read_manifest("extra")
        keys = [k for k, f in (old.get("urls") or {}).items() if k.startswith("/api/") and ".json" in f and not NO_HEAL.search(k)]
        if keys:
            got = self.fetch_all(keys, {}, "site: what the pages asked for")
            self.write_manifest("extra", {**old, "urls": {**old["urls"], **got}})

    def fx(self) -> dict:
        """The Animations page's "With effects" tab: limbusdm/sitefx.py."""
        from . import sitefx
        return sitefx.export(self)

    # -- the site around the data
    def shell(self):
        """index.html, UI files, service worker, d/index.json."""
        ui = os.path.join(resource_dir(), "ui")
        shutil.copytree(ui, os.path.join(self.out, "ui"), dirs_exist_ok=True, ignore=shutil.ignore_patterns("*.ico", "fx"))
        shutil.copyfile(os.path.join(ui, "site", "sw.js"), os.path.join(self.out, "sw.js"))
        with open(os.path.join(ui, "index.html"), encoding="utf-8") as f:
            html = f.read()
        # scripts load only once the service worker is in charge
        scripts = re.findall(r'<script src="([^"]+)"></script>\s*', html)
        html = re.sub(r'<script src="[^"]+"></script>\s*', "", html)
        stamp = str(int(time.time()))
        pages = self.section_pages(html)
        script_urls = [s + "?" + stamp for s in scripts + ["/ui/site/site.js"]]
        boot = f"""<script>
const SITE = {json.dumps({"contact": self.cfg["contact"], "build": build_info(self.svc), "open": self.open_routes(), "stats": "key" if self.cfg.get("stats_key") else "all", "titles": {r: t for r, (t, _, _) in pages.items()}, "scripts": script_urls})};
(async () => {{
  // come from the site's old address (ui/site/worker.js moved): what the browser kept there, where nothing is kept here
  if (location.hash.startsWith("#move=")) {{
    let m = {{}};
    try {{ m = JSON.parse(decodeURIComponent(location.hash.slice(6))); }} catch (e) {{ /* the page as it is */ }}
    history.replaceState(null, "", location.pathname + location.search + (/^#/.test(m.h || "") ? m.h : ""));
    try {{ for (const [k, v] of Object.entries(m.d || {{}})) if (typeof v === "string" && !/^(games_live_host|statskey|lang_fonts|beta.*)$/.test(k) && localStorage.getItem(k) === null) localStorage.setItem(k, v); }} catch (e) {{ /* not kept */ }}
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
  // a first visit: the languages' list for ui/app.js to pick from as it starts
  try {{ if (localStorage.getItem("lang") === null) window.SITE_LANGS = (await (await fetch("/api/langs")).json()).langs; }} catch (e) {{ /* picked later */ }}
  // (all asked for at once; "async = false" keeps the order they run in — one after another they cost a round trip each)
  await Promise.all(SITE.scripts.map((src) => new Promise((ok, bad) => {{
    const s = document.createElement("script"); s.src = src; s.async = false; s.onload = ok; s.onerror = bad; document.body.appendChild(s); }})));
}})();
</script>
"""
        # (scripts fetched while the worker starts; they run after it, as before)
        preload = "".join(f'<link rel="preload" as="script" href="{s}">\n' for s in script_urls)
        html = html.replace("</head>", f'<link rel="stylesheet" href="/ui/site/site.css?{stamp}">\n{preload}</head>')
        html = html.replace("</body>", boot + "</body>")
        # a page per section for search engines; visitors get the app on that section
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
        cards = self.card_pages(url)
        # search engines are kept out unless the site's settings say "index": true
        with open(os.path.join(self.out, "robots.txt"), "w") as f:
            f.write(("User-agent: *\nAllow: /\nDisallow: /api/\n" +(f"Sitemap: {url}/sitemap.xml\n" if url else "")) if self.cfg.get("index") else "User-agent: *\nDisallow: /\n")
        # (the list of those pages, for a search engine to find them all)
        sitemap = os.path.join(self.out, "sitemap.xml")
        if self.cfg.get("index") and url:
            day = time.strftime("%Y-%m-%d")
            with open(sitemap, "w", encoding="utf-8") as f:
                f.write('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
                        + "".join(f"<url><loc>{url}/{'' if r == 'home' else r}</loc><lastmod>{day}</lastmod></url>\n" for r in pages)
                        + "".join(f"<url><loc>{url}/{quote(p)}</loc></url>\n" for p in cards)
                        + "</urlset>\n")
        elif os.path.exists(sitemap):
            os.remove(sitemap)
        self.index()

    # -- the sections' own pages, for search engines (shell)
    def _answer(self, key: str):
        """What the site answers to `key`, from its own files; None when it has none."""
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
        """{route: (title, description, text)} for every open section, "home" first."""
        names = {}
        for route, attrs, label in re.findall(r'<a href="#/([\w/]+)"([^>]*)>(.*?)</a>', html):
            t = re.search(r'title="([^"]+)"', attrs)
            names.setdefault(route, re.sub(r"<[^>]+>", "", label).strip() or (t.group(1) if t else ""))
        open_ = set(self.open_routes()) | {"home"}
        if "games" in open_:
            open_.add("games/track")
        pages = {}
        for route in ["home"] + [r for r, p in PAGES.items() if p.get("title")] + list(names):
            p = PAGES.get(route) or {}
            if route in pages or route not in open_ or p.get("beta") or not (p.get("title") or names.get(route)):  # (big games: shown only once turned on)
                continue
            title, desc = (p["title"], p["seo"]) if p.get("title") else (names[route], f"{names[route]}: a Limbus Company guessing game on "
                                                                                       "Limbus Archive. Play alone or in a live match with friends.")
            pages[route] = (title, desc, self._section_text(route))
        return pages

    def _section_text(self, route: str) -> str:
        """A section's lists as plain text for search engines."""
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

    # -- a page per card: what Discord & co. show for a link to it (shell)
    def card_pages(self, url: str) -> list[str]:
        """<route>/<…>.html for every Identity, E.G.O, enemy and buff: name, text and picture for a link's preview,
        then the visitor goes on to the card in the site. Returns their paths (no .html)."""
        for d in CARD_DIRS[:-1]:
            shutil.rmtree(os.path.join(self.out, d), ignore_errors=True)
        if not url:
            return []
        urls = {}
        for fn in sorted(os.listdir(os.path.join(self.out, "d", "m"))):
            if fn.endswith(".json.gz") and not fn.startswith("report-"):
                for k, rel in self.read_manifest(fn[:-8]).get("urls", {}).items():
                    if isinstance(rel, str):
                        urls.setdefault(k, rel)

        def load(key):
            rel = urls.get(key)
            try:
                with (gzip.open if rel.endswith(".gz") else open)(os.path.join(self.out, "d", rel), "rt", encoding="utf-8") as f:
                    return json.load(f)
            except (AttributeError, OSError, ValueError):
                return None

        e, open_, used, out = html_escape, set(self.open_routes()), set(), []
        units = (load("/api/units") or {}) if "db" in open_ else {}
        gl, tags = units.get("glossary") or {}, units.get("tags") or {}
        word = lambda k: tags.get(k) or (gl.get(k) or {}).get("name") or k  # noqa: E731

        def plain(t):
            t = re.sub(r"\[(\w+)\]", lambda m: word(m.group(1)), t or "")
            return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", t)).strip()

        def short(t, n=190):
            return t if len(t) <= n else t[:n].rsplit(" ", 1)[0] + "…"

        def skill(s):  # (name, text) at its last uptie
            up = s.get("up") or {}
            last = up[max(up, key=int)] if up else {}
            return last.get("name") or "", plain(last.get("desc"))

        def skills_html(list_, passives=()):
            rows = list(dict.fromkeys(f"<li><b>{e(n)}</b>{': ' + e(t) if t else ''}</li>" for n, t in (skill(s) for s in list_) if n))
            rows += [f"<li><b>{e(p.get('name') or '')}</b>: {e(plain(p.get('desc')))}</li>" for p in passives if p.get("name")]
            return f"<ul>{''.join(rows)}</ul>" if rows else ""

        def card(path, route, title, desc, body, pic, big=True):
            src = pic and self._og_picture(urls.get(pic), big)
            if src:
                used.add(src)
            here = f"{url}/{quote(path)}"
            head = [f'<meta name="description" content="{e(desc)}">', f'<link rel="canonical" href="{e(here)}">',
                    '<meta property="og:type" content="website">', '<meta property="og:site_name" content="Limbus Archive">',
                    f'<meta property="og:title" content="{e(title)}">', f'<meta property="og:description" content="{e(desc)}">',
                    f'<meta property="og:url" content="{e(here)}">', '<meta name="theme-color" content="#e8b33a">',
                    f'<meta name="twitter:card" content="{"summary_large_image" if big and src else "summary"}">']
            if src:
                head.append(f'<meta property="og:image" content="{e(url)}/og/{src}">')
            if not self.cfg.get("index"):
                head.append('<meta name="robots" content="noindex, nofollow">')
            full = os.path.join(self.out, *path.split("/")) + ".html"
            os.makedirs(os.path.dirname(full), exist_ok=True)
            with open(full, "w", encoding="utf-8") as f:
                f.write(CARD_PAGE.format(full=e(f"{title} · Limbus Company · Limbus Archive"), head="\n".join(head),
                                         to=json.dumps("/#/" + route), title=e(title), desc=e(desc), body=body, route=e(route)))
            out.append(path)

        thumb = lambda p: p and url_key("/api/asset_thumb", path=p)  # noqa: E731
        seasons = units.get("seasons") or {}
        season = lambda x: (seasons.get(str(x.get("season"))) or {}).get("name") or ""  # noqa: E731
        for x in units.get("ids") or []:
            names = [n for n, _ in (skill(s) for s in x.get("skills") or []) if n]
            desc = " ".join(filter(None, [
                f"{'0' * (x.get('rank') or 1)} Identity of {x.get('sinnerName')}" + (f" · {season(x)}." if season(x) else "."),
                f"Keywords: {', '.join(word(k) for k in x.get('statuses') or [])}." if x.get("statuses") else "",
                f"Skills: {' · '.join(dict.fromkeys(names))}." if names else ""]))
            card(f"db/id/{x['id']}", f"db/id/{x['id']}", f"{x.get('title')} {x.get('sinnerName')}", short(desc),
                 skills_html(x.get("skills") or [], x.get("passives") or []), links.key((x.get("pics") or {}).get("art") or ""))
        for x in units.get("egos") or []:
            cost = ", ".join(f"{c['sin']} ×{c['n']}" for c in x.get("cost") or [])
            names = [n for n, _ in (skill(s) for s in x.get("skills") or []) if n]
            desc = " ".join(filter(None, [
                f"{x.get('grade')} E.G.O of {x.get('sinnerName')}" + (f" · {season(x)}." if season(x) else "."),
                f"Cost: {cost}." if cost else "", f"Skills: {' · '.join(dict.fromkeys(names))}." if names else ""]))
            card(f"db/ego/{x['id']}", f"db/ego/{x['id']}", f"{x.get('name')} · {x.get('sinnerName')} E.G.O", short(desc),
                 skills_html(x.get("skills") or [], x.get("passives") or []), links.key((x.get("pics") or {}).get("art") or ""))
        if "enemies" in open_:
            for x in (load("/api/enemies") or {}).get("list") or []:
                texts = load(links.key(x.get("info") or "")) or {}
                sk = list((texts.get("skills") or {}).values())
                names = [n for n, _ in (skill(s or {}) for s in sk) if n]
                desc = f"{x.get('kind') or 'Enemy'} · {x.get('label')}." + (f" Skills: {' · '.join(dict.fromkeys(names))}." if names else "")
                pic = next((k for k in (links.key(x[f]) for f in ("tile", "big") if x.get(f)) if k in urls), "")
                card(f"enemies/{x['id']}", f"enemies/{x['id']}", x.get("name") or str(x["id"]), short(desc),
                     skills_html([s or {} for s in sk]), pic, big=False)
        if "buffs" in open_:
            for x in (load("/api/buffs") or {}).get("list") or []:
                if not re.fullmatch(r"[\w-]+", x.get("id") or ""):
                    continue
                desc = plain(x.get("desc")) or x.get("flavor") or "A Limbus Company status."
                who = ", ".join(w.get("name") or "" for w in (x.get("who") or [])[:12])
                body = f"<p>{e(plain(x.get('desc')))}</p>" + (f"<p>Who has it: {e(who)}</p>" if who else "")
                card(f"buffs/{x['id']}", f"buffs/{x['id']}", f"{x.get('name') or x['id']} · Status", short(desc), body,
                     thumb(x.get("icon")), big=False)
        og = os.path.join(self.out, "og")
        for fn in os.listdir(og) if os.path.isdir(og) else []:
            if fn not in used:
                os.remove(os.path.join(og, fn))
        return out

    def _og_picture(self, rel: str | None, big: bool) -> str:
        """A card's picture as a JPEG in og/ (link previews can't read the packs); its file name or ""."""
        if not rel:
            return ""
        name = hashlib.sha1(f"{rel}|{big}".encode()).hexdigest()[:16] + ".jpg"
        dst = os.path.join(self.out, "og", name)
        if os.path.exists(dst):
            return name
        try:
            from PIL import Image
            with Image.open(os.path.join(self.out, "d", rel)) as im:
                im = im.convert("RGBA")
            back = Image.new("RGBA", im.size, (18, 16, 14, 255))
            back.alpha_composite(im)
            im = back.convert("RGB")
            im.thumbnail((1000, 1000) if big else (400, 400))
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            im.save(dst + ".tmp", "JPEG", quality=82, progressive=True, optimize=True)
            os.replace(dst + ".tmp", dst)
            return name
        except Exception:
            return ""

    def index(self):
        # (later manifests win: "extra" first, so an old auto-fetched answer never covers a part's own)
        names = sorted((fn[:-8] for fn in os.listdir(os.path.join(self.out, "d", "m")) if fn.endswith(".json.gz")),
                       key=lambda n: (n != "extra", n))
        ms = {n: self.read_manifest(n) for n in names}
        reports = sorted((m["meta"] for m in ms.values() if m.get("kind") == "report" and m.get("meta")),
                         key=lambda r: r["id"], reverse=True)
        # (with the ones a report taken from the site is between: pull)
        snaps = {**_read_json(os.path.join(self.out, "d", "snapshots.json")), **{s["id"]: s for s in self.svc.snapshots()}}
        used = [snaps[i] for i in sorted({r[k] for r in reports for k in ("old", "new")} & set(snaps))]
        state = {"game": {"ok": True, "dir": "", "catalog": ""}, "snapshots": used, "reports": reports, "job": None, "big": self.svc._big(),
                 "watch": {"state": "", "last_check": ""}, "settings": {}, "data_dir": "", "update": None,
                 "version": __import__("limbusdm").__version__, "site": True}
        # the app's release notes, shown to visitors with an older copy open; kept when not read
        path = os.path.join(self.out, "d", "index.json")
        from . import appnotes
        notes = appnotes.history()
        if not notes["notes"]:
            notes = (_read_json(path).get("inline") or {}).get("/api/appnotes?all=1") or notes
        idx = {"v": VERSION, "stamp": int(time.time()), "build": build_info(self.svc), "manifests": [n for n in names if ms[n]],
               "removed": admin(self.svc)["removed"],  # (another computer's send leaves these off too: pull)
               "tr": sorted(fn[:-8] for fn in os.listdir(os.path.join(self.out, "d", "tr")) if fn.endswith(".json.gz"))
               if os.path.isdir(os.path.join(self.out, "d", "tr")) else [],
               # read by the visitor's browser: live streams and Bilibili lists on GitHub
               "live": {"/api/community": __import__("limbusdm.community", fromlist=["URL"]).URL, **_bilibili_live()},
               "inline": {"/api/state": state, "/api/marks": {}, "/api/appnotes": {}, "/api/appnotes?all=1": notes, "/api/mods_owned": [],
                          "/api/patchnotes?new=1": {"id": None}, "/api/game_cards": (ms.get("cards") or {}).get("cards") or {}}}
        with open(path, "w", encoding="utf-8") as f:
            json.dump(idx, f, ensure_ascii=False)

    def renew_reports(self):
        """Reports made by an older app (here or on another computer): the answer gets the links the page reads now."""
        from .server import _report_links
        mine = {r["id"] for r in self.svc.reports()}
        for fn in sorted(os.listdir(os.path.join(self.out, "d", "m"))):
            if not (fn.startswith("report-") and fn.endswith(".json.gz")):
                continue
            name = fn[:-8]
            m = self.read_manifest(name)
            key = url_key("/api/report", id=m.get("id") or "")
            try:
                r = self._stored(m["urls"][key])
            except (KeyError, OSError, ValueError):
                continue
            if "notes" in r:  # (made with links)
                continue
            if m["id"] in mine:  # (its report is here: made again, files kept)
                self.report(m["id"])
                continue
            r = _report_links(r, {k: self.cfg[k] for k in ("full_images", "video", "audio")})
            here = lambda u: u and links.key(u) in m["urls"]  # noqa: E731
            for items in r["sections"].values():
                for it in items:
                    for f in ("open", "blob", "thumb", "tree", "container"):
                        if f in it and not here(it[f]):
                            del it[f]  # (the site has no such file: the page leaves it out)
                    if "pics" in it:
                        it["pics"] = {k: u if here(u) else "" for k, u in it["pics"].items()}
                    sd = it.get("sounds")
                    if isinstance(sd, dict):
                        for k in ("added", "changed"):
                            sd[k] = [[*s[:3], s[3] if here(s[3]) else ""] if len(s) > 3 else s for s in sd.get(k, [])]
            m["urls"][key] = self._store(json.dumps(r, ensure_ascii=False).encode("utf-8"), "application/json", gz=True)
            self.write_manifest(name, m)

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
PULL_THREADS, PULL_TRIES = 10, 3
PACK_INDEX = "site_packs.json"  # (in the data folder: not uploaded) PackIndex
PACK_INDEX_DAYS = 60  # a pack not made or looked at for this long is dropped from it


def pack_index_path(svc) -> str:
    return own_file(svc, PACK_INDEX)


class PackIndex:
    """{pack: {offset: file}} of packs made or taken; a pack never changes, pull takes one only when a file is missing."""

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
        """Write now, or once `every` seconds passed."""
        with self.lock:
            if time.time() - self.saved < every:
                return
            self.saved = time.time()
            keep = {k: v for k, v in self.packs.items() if self.today - v.get("t", 0) <= PACK_INDEX_DAYS}
            with open(self.path + ".tmp", "w", encoding="utf-8") as f:
                json.dump({"v": 1, "packs": keep}, f, separators=(",", ":"))
            os.replace(self.path + ".tmp", self.path)


def _game(made: str) -> str:
    """Snapshot / renders folder name without its local read time."""
    return re.sub(r"_\d{8}-\d{6}", "", made or "")


def _pair(rid: str) -> tuple:
    """A report's game versions, without when this computer read them."""
    return tuple(_game(x) for x in rid.split("__"))


def _unchanged(a: dict, b: dict):
    """→ whether a request answers the same in snapshots a and b (its source file has the same hash)."""
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
        if path == "/api/frame_png":
            return bundle(q.get("bundle", ""))
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
    """Takes back from the site what this computer lacks (reports, videos sent from elsewhere), out of the packs."""

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
        """One manifest file as the site has it → its local file name (written when missing)."""
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
        """{request: where on the site} → {request: file}; a pack is fetched once. Raises when a file can't be taken."""
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
    """Before a send: take from the site what another computer sent (reports, videos, parts), so the upload keeps them.
    Refuses when the site has a newer game version."""
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
    # reports taken off the site (here or on another computer) stay off
    a = admin(svc)
    removed = list(dict.fromkeys(a["removed"] + [r for r in idx.get("removed") or [] if isinstance(r, str) and r not in a["back"]]))
    if removed != a["removed"]:
        admin_save(svc, {**a, "removed": removed})
    gone = {report_name(r) for r in removed}
    for name in sorted(n for n in names if n.startswith("report-") and n not in gone and not os.path.exists(ex._manifest_path(n))):
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
    sent = _read_json(own_file(svc, "site_sent.json")).get("files") or {}
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
        stale = local.get("id") != made  # (then the site's videos, made for this version, win over these)
        if stale:  # (the skills' videos of the version before stay until rendered again: sitefx._read)
            local = sitefx._read(ex) if name == "fx" else {"kind": name, "id": made, "urls": {}}
        dropped = set(local.get("dropped") or [])  # (taken off by the owner: sitefx.drop)
        skip = {sitefx._key(key, cid, v, name=n) for cid, vs in (site.get("have") or {}).items() for v, videos in vs.items()
                if f"{cid}:{v}" in dropped for n in videos}
        got = p.files({k: w for k, w in (site.get("urls") or {}).items() if k.startswith(key) and (stale or k not in local["urls"]) and k not in skip})
        if not got:
            continue
        local["urls"].update(got)
        out["videos"] += len(got)
        if name == "fx":  # (the lists the tab asks for are made again from these: sitefx._lists)
            local.setdefault("src", {}).update({k: v for k, v in (site.get("src") or {}).items() if k in got})
            have = local.setdefault("have", {})
            for cid, vs in (site.get("have") or {}).items():
                for v, videos in vs.items():
                    ok = [n for n in videos if sitefx._key(key, cid, v, name=n) in local["urls"]]
                    if not ok:
                        continue
                    mine_v = have.setdefault(cid, {})
                    if not stale:
                        mine_v[v] = list(dict.fromkeys(mine_v.get(v, []) + ok))
                        continue
                    # (the site's set as it is: rendered for this version)
                    for n in mine_v.get(v, []):
                        if n not in ok:
                            local["urls"].pop(sitefx._key(key, cid, v, name=n), None)
                            local["src"].pop(sitefx._key(key, cid, v, name=n), None)
                    mine_v[v] = ok
                    old = [x for x in (local.get("old") or {}).get(cid, []) if x != v]
                    if old:
                        local["old"][cid] = old
                    else:
                        (local.get("old") or {}).pop(cid, None)
            local["none"] = list(dict.fromkeys((local.get("none") or []) + (site.get("none") or [])))
        ex.write_manifest(name, local)
    # game-file parts this computer can't go on from: taken from the site
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
    # languages: the site's stay on a computer without its own
    from . import langs
    if "langs" in names and not langs.own(svc):
        site = p.json("m/langs.json.gz")
        if site.get("v") == VERSION:
            site["urls"] = p.files(site.get("urls") or {})
            ex.write_manifest("langs", site)
            out["parts"] += 1
    # game versions of the taken reports
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
    """Write the site: given reports (None = all) and the database."""
    ex = Exporter(svc, base_url, progress=progress)
    for rid in reports if reports is not None else [r["id"] for r in svc.reports()]:
        ex.report(rid)
    if units:
        ex.pages()
    ex.shell()
    ex.forget()
    return {"dir": ex.out, "failed": len(ex.failed), "size": size_of(ex.out)}


def deploy(svc, progress=None) -> str:
    """Upload data/site_packed with wrangler (only new files go up); returns the site's address."""
    cfg = config(svc)
    npx = shutil.which("npx")
    if not npx:
        raise RuntimeError("Node.js isn't installed — the upload runs Cloudflare's wrangler through npx")
    # run from the data folder: wrangler keeps its files there
    conf = worker_config(svc)
    url = cfg["url"]
    for attempt in range(1, DEPLOY_TRIES + 1):
        p = subprocess.Popen([npx, "--yes", "wrangler@4", "deploy", "-c", conf], cwd=os.path.dirname(conf), stdin=subprocess.DEVNULL,
                             stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace",
                             creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        tail = []
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
        if p.wait() == 0:
            _put_keys(svc, npx, conf)
            return url
        if any("EBUSY" in t for t in tail):  # npx could not update wrangler: its files are held by one that is running
            raise RuntimeError("upload failed: another wrangler is running on this computer (a local preview, "
                               "`wrangler dev`?) and holds its files — close it and send again")
        # Cloudflare's API now and then times out or cuts an answer short: the same upload again a little later
        if attempt == DEPLOY_TRIES or not any(re.search(DEPLOY_FLAKY, t) for t in tail):
            raise RuntimeError("upload failed: " + " | ".join(tail[-4:]))
        if progress:
            progress("site: uploading", 0, 0, f"Cloudflare didn't answer — trying again ({attempt + 1} of {DEPLOY_TRIES})")
        time.sleep(30 * attempt)
    return url


def _put_keys(svc, npx: str, conf: str) -> None:
    keys = {name: config(svc)[k] for k, name in (("stats_key", "STATS_KEY"), ("owner_key", "OWNER_KEY")) if config(svc).get(k)}
    if not keys:
        return
    fd, path = tempfile.mkstemp(suffix=".json", dir=os.path.dirname(conf))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(keys, f)
        subprocess.run([npx, "--yes", "wrangler@4", "secret", "bulk", path, "-c", conf], cwd=os.path.dirname(conf),
                       stdin=subprocess.DEVNULL, capture_output=True, timeout=300, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except (OSError, subprocess.SubprocessError):
        pass
    finally:
        try:
            os.remove(path)
        except OSError:
            pass


DEPLOY_TRIES = 4
DEPLOY_FLAKY = r"\b50[234]\b|Gateway Timeout|Bad Gateway|malformed response|ECONNRESET|ETIMEDOUT|UND_ERR|fetch failed|socket hang up"


def verify(ex: "Exporter", progress=None, routes: list[str] | None = None) -> dict:
    """Open every page (or these routes) of the packed site headless, fetch what was missing, decide which pages open;
    leaves data/site_packed ready. Pages not opened keep what the last check found."""
    from . import sitecheck
    packed = packed_dir(ex.svc)
    res = sitecheck.check(packed, routes=routes, progress=progress)
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
    if routes is not None:
        was = _read_json(os.path.join(ex.out, "d", "check.json"))
        res["misses"] = {**{r: ks for r, ks in (was.get("misses") or {}).items() if r not in routes}, **res["misses"]}
    opened = [r for r in pages if r in BASE_OPEN or r not in res["misses"]]
    out = {"error": None, "when": int(time.time()), "checked": len(pages if routes is None else [r for r in routes if r in pages]),
           "open": opened, "healed": healed,
           "opened": [r for r in opened if r not in BASE_OPEN], "misses": res["misses"]}
    with open(os.path.join(ex.out, "d", "check.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)
    ex.shell()
    pack(ex.out, packed, pack_index_path(ex.svc))
    return out


def _listing(root: str) -> dict:
    """{file: what tells its content} of the packed site (size for packs, hash for pages and lists)."""
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
    path = own_file(svc, SEND_LOG)
    rows = (_read_json(path).get("list") or []) + [entry]
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump({"list": rows[-SEND_LOG_KEEP:]}, f)
    except OSError:
        pass


def publish(svc, base_url: str, report: str | None = None, progress=None) -> dict:
    """"Send to site" with its outcome logged (shown in Settings → Website)."""
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
    """This report (and earlier ones) plus the database: written, packed, uploaded."""
    ex = Exporter(svc, base_url, progress=progress)
    cfg = config(svc)
    if cfg["project"] and cfg["url"]:  # what was sent from another computer stays (pull)
        pull(ex, cfg["url"])
    a = admin(svc)
    if report in a["removed"]:  # (sent on purpose: back on the site)
        a["removed"].remove(report)
        a["back"] = list(dict.fromkeys(a["back"] + [report]))
        admin_save(svc, a)
    gone = set(a["removed"])
    for rid in gone:
        if os.path.exists(ex._manifest_path(report_name(rid))):
            ex.remove_report(rid)
    if report:
        ex.report(report)
    # reports newer than the site's newest go up too
    def taken(r):
        return r["new"].rsplit("_", 1)[-1]

    def there(r):
        return os.path.exists(ex._manifest_path(report_name(r["id"])))
    newest = max((taken(r) for r in svc.reports() if there(r)), default="")
    empty = set(ex.made().get("empty") or [])
    # (a patch another computer sent: its report has other read times in its id)
    mdir = os.path.join(ex.out, "d", "m")
    has = {_pair(ex.read_manifest(fn[:-8]).get("id") or "") for fn in os.listdir(mdir) if fn.startswith("report-")}
    for r in svc.reports():
        if r["id"] != report and r["id"] not in gone | empty and taken(r) > newest and not there(r) and _pair(r["id"]) not in has:
            ex.report(r["id"])
    ex.renew_reports()
    ex.pages()
    # what changed since the last send that went through: nothing → nothing to write, pack, check or upload
    sent_path = own_file(svc, "site_sent.json")
    st, was = ex.state(), ex.made().get("sent") or {}
    changed = {n for n in set(st["m"]) | set(was.get("m") or {}) if st["m"].get(n) != (was.get("m") or {}).get(n)}
    whole = st["pages"] != was.get("pages") or not os.path.exists(os.path.join(packed_dir(svc), "d", "index.json"))
    progress("site: what changed", 0, 0, "all pages" if whole else ", ".join(sorted(changed)) or "nothing")
    if not changed and not whole:
        ex.forget()
        last = _read_json(sent_path).get("last") or {}
        same = {"when": int(time.time()), "build": build_info(svc), "report": report or "", "nothing": True, "uploaded": 0,
                "removed": 0, "pages": False, "data": {}, "same": ex.same, "files": last.get("files"), "bytes": last.get("bytes"), "check": last.get("check")}
        return {"site": cfg["url"] if cfg["project"] else "", "dir": packed_dir(svc), "sent": same, "files": same["files"], "bytes": same["bytes"]}
    ex.shell()
    progress("site: packing", 0, 0)
    size = pack(ex.out, packed_dir(svc), pack_index_path(svc))
    chk = verify(ex, progress, None if whole else check_routes(changed))
    size = size_of(packed_dir(svc))

    def sent():  # (the next send compares with this)
        if not chk.get("error"):
            ex.made_save({**ex.made(), "sent": ex.state()})
    if not cfg["project"]:
        sent()
        ex.forget()
        ex.sweep()
        return {"site": "", "dir": packed_dir(svc), "check": chk, **size}
    # what this upload changes: packed files vs the last sent
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
            "data": {k: n for k, n in ex.fresh.items() if n}, "same": ex.same, "changed": "all" if whole else sorted(changed), "files": size["files"], "bytes": size["bytes"], "check": chk}
    with open(sent_path, "w", encoding="utf-8") as f:
        json.dump({"files": now, "last": last}, f)
    sent()
    ex.forget()
    ex.sweep()  # (unnamed files)
    return {"site": url, "dir": packed_dir(svc), "sent": last, **size}


def size_of(root: str) -> dict:
    n = total = 0
    for d, _, files in os.walk(root):
        for fn in files:
            n += 1
            total += os.path.getsize(os.path.join(d, fn))
    return {"files": n, "bytes": total}


HOST_MAX = 24 << 20  # host limit 25 MiB: bigger files go up in parts
# videos in parts too, so the worker can answer the range a player asks for
VIDEO_WHOLE = 4 << 20  # (a smaller one comes whole: about a second)
VIDEO_PART = 2 << 20
ANNOUNCER_LINES = 8  # Guess the sound on the site: lines of each announcer
FRESH_FACES = 32  # the newest Identities' pictures (two per Identity) in a pack of their own
LINK = re.compile(r"/(api|spine)/")
# what a first visit asks whatever page it opens, each kind in its own pack: a new visitor fetches these, not the big packs they'd sit in
START = (r"^/api/(font\?|langs$|ui_langs$|site_fx$|music$)", r"^/api/gacha_ui\?n=(icon_lunacy|%s)$", r"^/api/ui_icon\?k=(sinner|rank|st)_", r"^/api/units$")


def _start_groups(src: str) -> list[list[tuple[str, int]]]:
    """The START files of every manifest, as packs [[(file, size)]]."""
    from .gacha import SKIN
    skin = "|".join(n for n in SKIN if "PersonalityStory" not in n)  # (those are one page's big pictures)
    kinds = [re.compile(rx % skin if "%s" in rx else rx) for rx in START]
    found = [{} for _ in kinds]
    for fn in sorted(os.listdir(os.path.join(src, "d", "m"))):
        with gzip.open(os.path.join(src, "d", "m", fn), "rt", encoding="utf-8") as f:
            urls = json.load(f).get("urls", {})
        for k, rel in urls.items():
            i = next((i for i, rx in enumerate(kinds) if rx.search(k)), None)
            if i is not None and isinstance(rel, str) and os.path.getsize(os.path.join(src, "d", rel)) < PACK:
                found[i].setdefault(rel, os.path.getsize(os.path.join(src, "d", rel)))
    groups, seen = [], set()
    for d in found:
        cur, n = [], 0
        for rel, size in d.items():
            if rel in seen:
                continue
            seen.add(rel)
            if cur and n + size > PACK:
                groups.append(cur)
                cur, n = [], 0
            cur.append((rel, size))
            n += size
        if cur:
            groups.append(cur)
    return groups


def packed_dir(svc) -> str:
    return os.path.join(site_root(svc), "site_packed")


KEY_SHARDS = 256  # the request → file table cut in this many files: the worker reads only the one a request is in
KEY_SPLIT = 400  # a group with more requests is spread over several shards


def _fnv(s: str) -> int:
    """FNV-1a over UTF-8; ui/site/sw.js has the same."""
    h = 0x811C9DC5
    for b in s.encode("utf-8"):
        h = ((h ^ b) * 0x01000193) & 0xFFFFFFFF
    return h


def key_group(k: str) -> str:
    """Requests one page asks together (a bundle's, an id's) share a shard; ui/site/sw.js has the same."""
    path, _, q = k.partition("?")
    if path.startswith("/spine/"):
        return "/spine/" + path.split("/")[2]
    got = {}
    for part in q.split("&") if q else ():
        name, eq, v = part.partition("=")
        if eq and name not in got:
            got[name] = v
    for name in ("bundle", "id"):
        if name in got:
            return f"{path}?{name}={got[name]}"
    return path


def _put_shard(dst: str, obj) -> str:
    raw = json.dumps(obj, ensure_ascii=False, separators=(",", ":"), sort_keys=isinstance(obj, dict)).encode("utf-8")
    name = hashlib.sha1(raw).hexdigest()[:16] + ".json.gz"
    full = os.path.join(dst, "d", "k", name)
    if not os.path.exists(full):
        with open(full + ".tmp", "wb") as f:
            f.write(gzip.compress(raw, mtime=0))
        os.replace(full + ".tmp", full)
    return name


def _key_shards(dst: str, packed_urls: dict) -> dict:
    """d/k: the manifests' requests cut by key_group (later manifests win, as sw.js read them whole)."""
    with open(os.path.join(dst, "d", "index.json"), encoding="utf-8") as f:
        order = json.load(f).get("manifests") or []
    urls = {}
    for name in order:
        urls.update(packed_urls.get(name) or {})
    counts = {}
    for k in urls:
        g = key_group(k)
        counts[g] = counts.get(g, 0) + 1
    split = {g: -(-n // KEY_SPLIT) for g, n in counts.items() if n > KEY_SPLIT}
    buckets = [{} for _ in range(KEY_SHARDS)]
    for k, v in urls.items():
        g = key_group(k)
        if g in split:
            g += "#" + str(_fnv(k) % split[g])
        buckets[_fnv(g) % KEY_SHARDS][k] = v
    return {"f": [_put_shard(dst, b) if b else "" for b in buckets], "split": split}


def _link(a: str, b: str):
    """b: the same file as a — a second name, not a second copy on disk (on another drive: a copy)."""
    if os.path.exists(b):
        sa, sb = os.stat(a), os.stat(b)
        if os.path.samefile(a, b) or (sa.st_dev != sb.st_dev and sa.st_size == sb.st_size):
            return
    tmp = b + ".tmp"
    if os.path.exists(tmp):
        os.remove(tmp)
    try:
        os.link(a, tmp)
    except OSError:
        shutil.copyfile(a, tmp)
    os.replace(tmp, b)


def move(svc, dst: str, progress=None) -> dict:
    """site/ and site_packed/ into the folder dst ("": back into the data folder). The names in them, in the manifests and
    in what was sent are relative: nothing goes up again. Another drive: copied, then the old ones deleted."""
    progress = progress or (lambda stage, done, total, msg="": None)
    cur, dst = site_root(svc), os.path.abspath(dst.strip().strip('"') or svc.data_dir)
    if root_missing(svc):
        raise RuntimeError(f"the site's folder {cur} isn't there — connect its drive first")
    if os.path.normcase(dst) == os.path.normcase(cur):
        return {"dir": cur, "moved": 0}
    names = [n for n in ("site", "site_packed") if os.path.isdir(os.path.join(cur, n))]
    for n in names:
        if os.path.normcase(dst + os.sep).startswith(os.path.normcase(os.path.join(cur, n) + os.sep)):
            raise RuntimeError(f"{dst} is inside the site's own folder")
    os.makedirs(dst, exist_ok=True)
    files = [(n, os.path.relpath(os.path.join(d, fn), os.path.join(cur, n))) for n in names
             for d, _, fs in os.walk(os.path.join(cur, n)) for fn in fs]
    moved = 0
    for i, (n, rel) in enumerate(files):
        a, b = os.path.join(cur, n, rel), os.path.join(dst, n, rel)
        if i % 200 == 0:
            progress("site: moving its files", i, len(files), dst)
        os.makedirs(os.path.dirname(b), exist_ok=True)
        try:
            os.replace(a, b)  # (same drive: only the name)
        except OSError:
            # another drive: a packed big file is the site's own again there (pack)
            twin = os.path.join(dst, "site", rel) if n == "site_packed" and rel.startswith(os.path.join("d", "f") + os.sep) else ""
            if twin and os.path.exists(twin) and os.path.getsize(twin) == os.path.getsize(a):
                _link(twin, b)
            elif not os.path.exists(b) or os.path.getsize(b) != os.path.getsize(a):
                shutil.copyfile(a, b + ".tmp")
                os.replace(b + ".tmp", b)
        moved += 1
    path = own_file(svc, SITE_DIR)
    if os.path.normcase(dst) == os.path.normcase(svc.data_dir):
        if os.path.exists(path):
            os.remove(path)
    else:
        with open(path + ".tmp", "w", encoding="utf-8") as f:
            json.dump({"dir": dst}, f)
        os.replace(path + ".tmp", path)
    progress("site: moving its files", len(files), len(files), "removing the old copy")
    for n in names:
        shutil.rmtree(os.path.join(cur, n), ignore_errors=True)
    return {"dir": dst, "moved": moved}


def pack(src: str, dst: str, index: str | None = None) -> dict:
    """The site as it goes up: small files glued into content-named packs ([pack, offset, length, ext] in the manifest), in
    page order; big files stay alone."""
    idx = PackIndex(index) if index else None
    shutil.rmtree(os.path.join(dst, "ui"), ignore_errors=True)
    os.makedirs(dst, exist_ok=True)
    # (a section's page that is gone from the site goes from here too: Exporter.shell)
    for name in os.listdir(dst):
        if name.endswith((".html", ".xml")) and not os.path.exists(os.path.join(src, name)):
            os.remove(os.path.join(dst, name))
    for name in ("games",) + CARD_DIRS:
        shutil.rmtree(os.path.join(dst, name), ignore_errors=True)
    for name in os.listdir(src):
        a, b = os.path.join(src, name), os.path.join(dst, name)
        if name in ("ui", "games") + CARD_DIRS:
            shutil.copytree(a, b)
        elif os.path.isfile(a):
            shutil.copyfile(a, b)
    for sub in ("m", "p", "tr", "f", "k"):
        os.makedirs(os.path.join(dst, "d", sub), exist_ok=True)
    shutil.copyfile(os.path.join(src, "d", "index.json"), os.path.join(dst, "d", "index.json"))
    shutil.copytree(os.path.join(src, "d", "tr"), os.path.join(dst, "d", "tr"), dirs_exist_ok=True)
    packs, loose, parts = set(), set(), {}  # parts: {a part's file: (the big file, where the part starts in it)}
    packed_urls = {}

    def glue(g) -> dict:
        name = hashlib.sha1("\n".join(rel for rel, _ in g).encode()).hexdigest()[:20] + ".bin"
        packs.add(name)
        full, off, at = os.path.join(dst, "d", "p", name), 0, {}
        write = not os.path.exists(full) or os.path.getsize(full) != sum(size for _, size in g)
        out = open(full + ".tmp", "wb") if write else None
        for rel, size in g:
            at[rel] = [name, off, size, rel.split(".", 1)[1]]
            if idx:
                idx.add(name, off, rel)
            off += size
            if out:
                with open(os.path.join(src, "d", rel), "rb") as f:
                    shutil.copyfileobj(f, out)
        if out:
            out.close()
            os.replace(full + ".tmp", full)
        return at
    start = {}
    for g in _start_groups(src):
        start.update(glue(g))
    for fn in sorted(os.listdir(os.path.join(src, "d", "m"))):
        with gzip.open(os.path.join(src, "d", "m", fn), "rt", encoding="utf-8") as f:
            m = json.load(f)
        groups, cur, n, seen = [], [], 0, set()
        runs = [(i, size) for i, (count, size) in enumerate(m.get("groups") or []) for _ in range(count)]  # per request: its run and pack size
        at = None
        for i, rel in enumerate(m.get("urls", {}).values()):
            if rel in seen or rel in start:
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
        where = {**start, **{rel: rel for rel in loose}}
        for rel in loose:  # in parts: {"parts": […], "size", "part": a part's size, "ext"} (ui/site/sw.js)
            size, ext = os.path.getsize(os.path.join(src, "d", rel)), rel.rsplit(".", 1)[-1]
            step = VIDEO_PART if ext in ("mp4", "webm") and size > VIDEO_WHOLE else HOST_MAX if size > HOST_MAX else 0
            if step:
                # (a part's name says how the file was cut: a visitor's browser keeps parts by their names)
                names = [f"{rel}.{step >> 10}k.{i}" for i in range(-(-size // step))]
                where[rel] = {"parts": names, "size": size, "part": step, "ext": ext}
                parts.update({p: (rel, i * step, min(step, size - i * step)) for i, p in enumerate(names)})
        for g in groups:
            where.update(glue(g))
        m["urls"] = {k: where[rel] for k, rel in m.get("urls", {}).items()}
        packed_urls[fn[:-8]] = m["urls"]
        with gzip.open(os.path.join(dst, "d", "m", fn), "wt", encoding="utf-8") as f:
            json.dump(m, f, ensure_ascii=False)
    whole = {v[0] for v in parts.values()}
    for rel in loose - whole:
        full = os.path.join(dst, "d", rel)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        _link(os.path.join(src, "d", rel), full)
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
    shards = _key_shards(dst, packed_urls)
    files = sorted({"p/" + n for n in packs} | loose | {"k/" + n for n in shards["f"] if n})
    shards["files"] = _put_shard(dst, files)
    with open(os.path.join(dst, "d", "index.json"), encoding="utf-8") as f:
        ix = json.load(f)
    ix["keys"] = shards
    with open(os.path.join(dst, "d", "index.json"), "w", encoding="utf-8") as f:
        json.dump(ix, f, ensure_ascii=False)
    with open(os.path.join(dst, "_headers"), "w", encoding="utf-8") as f:
        f.write("/*\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: SAMEORIGIN\n  Content-Security-Policy: frame-ancestors 'self'\n"
                "  Referrer-Policy: strict-origin-when-cross-origin\n")
        f.write("".join(f"/d/{sub}/*\n  Cache-Control: public, max-age=31536000, immutable\n" for sub in ("p", "f", "k")))
    keep_k = {n for n in shards["f"] if n} | {shards["files"]}
    for sub, keep in (("p", packs), ("k", keep_k), ("m", set(os.listdir(os.path.join(src, "d", "m")))), ("tr", set(os.listdir(os.path.join(src, "d", "tr"))))):
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
    """A static file server on 127.0.0.1 (byte ranges), in its own thread."""
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
