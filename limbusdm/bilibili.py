"""The Community page's Bilibili tab: the game's videos on bilibili.com — the most watched of the last day / week / of
all time, or the newest. Asked from Bilibili's own search (the one its site uses: no key, only the visitor cookie the
front page hands out), by the game's Chinese name."""
from __future__ import annotations

import html
import http.cookiejar
import json
import re
import threading
import time
import urllib.parse
import urllib.request

KEYWORD = "边狱公司"
SEARCH = "https://api.bilibili.com/x/web-interface/search/type"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/126.0 Safari/537.36")
PERIODS = {"day": 86400, "week": 7 * 86400, "all": 0}
SORTS = {"views": "click", "new": "pubdate"}
COUNT = 50  # the most one page of the search gives
KEEP = 600  # seconds an answer is served again
# (the translator turns the game's Chinese names into "Border Prison Bus")
GAME = re.compile("边狱巴士公司|边狱巴士|边狱公司")

_lock = threading.Lock()
_cache: dict[tuple, tuple[float, dict]] = {}
_jar = http.cookiejar.CookieJar()
_opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(_jar))


def _get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Referer": "https://search.bilibili.com/"})
    with _opener.open(req, timeout=15) as r:
        return r.read()


def _search(period: str, sort: str) -> list[dict]:
    if not any(c.name == "buvid3" for c in _jar):  # (without the visitor cookie the search answers -412)
        _get("https://www.bilibili.com/")
    q = {"search_type": "video", "keyword": KEYWORD, "order": SORTS[sort], "page_size": COUNT}
    if PERIODS[period]:
        now = int(time.time())
        q.update(pubtime_begin_s=now - PERIODS[period], pubtime_end_s=now)
    doc = json.loads(_get(SEARCH + "?" + urllib.parse.urlencode(q)))
    if doc.get("code"):
        raise RuntimeError(f"Bilibili answered {doc.get('code')}: {doc.get('message')}")
    return (doc.get("data") or {}).get("result") or []


def _pic(url: str) -> str:
    return ("https:" + url if url.startswith("//") else url).replace("http://", "https://")


def _length(text: str) -> str:
    """Bilibili's "8:6" / "585:54" -> "8:06" / "9:45:54"."""
    try:
        m, s = (int(x) for x in str(text).split(":"))
    except ValueError:
        return str(text)
    return f"{m // 60}:{m % 60:02d}:{s:02d}" if m >= 60 else f"{m}:{s:02d}"


def videos(period: str = "week", sort: str = "views", translator=None) -> dict:
    """{"updated", "period", "sort", "videos": [{id, url, title, en, name, avatar, thumb, views, likes, comments,
    length, at, kind}]} or {"error"}. `en` = the title in English when a translator is given and answers."""
    period = period if period in PERIODS else "week"
    sort = sort if sort in SORTS else "views"
    with _lock:
        hit = _cache.get((period, sort))
        if hit and time.time() - hit[0] < KEEP:
            return hit[1]
        try:
            rows = _search(period, sort)
        except Exception as e:
            return hit[1] if hit else {"error": str(e) or type(e).__name__}
        out = []
        for r in rows:
            if r.get("type") != "video" or not r.get("bvid"):
                continue
            out.append({
                "id": r["bvid"], "url": "https://www.bilibili.com/video/" + r["bvid"],
                "title": html.unescape(re.sub(r"<[^>]+>", "", r.get("title") or "")),
                "name": r.get("author") or "", "avatar": _pic(r.get("upic") or ""), "thumb": _pic(r.get("pic") or ""),
                "views": int(r.get("play") or 0), "likes": int(r.get("like") or 0),
                "comments": int(r.get("danmaku") or 0), "length": _length(r.get("duration") or ""),
                "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(r.get("pubdate") or 0)),
                "kind": r.get("typename") or ""})
        if translator and out:
            try:
                for v, en in zip(out, translator.translate([GAME.sub(" Limbus Company ", v["title"]).strip() for v in out])):
                    v["en"] = en if en and en != v["title"] else ""
            except Exception:
                pass
        doc = {"updated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "period": period, "sort": sort,
               "videos": out}
        _cache[(period, sort)] = (time.time(), doc)
        return doc
