"""Patches -> News: the developers' update notices from the game's Steam page, tied to the patches in the archive.

Steam's event list is public (no key). Kept: the weekly "Scheduled Update Notice" (posted on Monday, the patch is on
Thursday) and the big posts that come with it ("New Content - …", a season guide). Steam has a build field on every
post, but the developers leave it empty, so a notice finds its patch by the day: the date in its title = the date in a
snapshot's version (s20261001_…)."""
from __future__ import annotations

import json
import os
import re
import time
import urllib.request
from datetime import datetime, timedelta, timezone

APPID = 1973530
URL = "https://store.steampowered.com/events/ajaxgetpartnereventspageable/?clan_accountid=0&appid=%d&offset=%d&count=100&l=english"
IMAGES = "https://clan.akamai.steamstatic.com/images"
PAGE = "https://store.steampowered.com/news/app/%d/view/%s"
KEEP = 3600  # seconds the list is served before Steam is asked again
FIRST = 4  # pages of 100 posts read the first time (about a year and a half); later only the newest page
VERSION = 1
KST = timezone(timedelta(hours=9))  # the game's dates are Korean time
NOTICE_RE = re.compile(r"(\d{4})\D{1,3}([A-Za-z]{3})[a-z]*\.?\s*(\d{1,2})\w*\s+Scheduled Update Notice", re.I)
MONTHS = {m: i + 1 for i, m in enumerate("jan feb mar apr may jun jul aug sep oct nov dec".split())}


def _text(body: str) -> str:
    """A post's BBCode without its pictures, as plain lines."""
    t = re.sub(r"\[img.*?\[/img\]", "", body, flags=re.S | re.I)
    t = re.sub(r"\[\*\]", "• ", t)
    t = re.sub(r"\[/?(?:h\d|p|list|olist|table|tr)\]", "\n", t, flags=re.I)
    t = re.sub(r"\[[^\]\n]{1,200}\]", "", t)
    return re.sub(r"\n\s*\n+", "\n\n", t).strip()


def _post(e: dict) -> dict | None:
    """What is kept of a Steam event, or None for a post that isn't an update's notice."""
    body = (e.get("announcement_body") or {}).get("body") or ""
    title = (e.get("event_name") or "").strip()
    posted = (e.get("announcement_body") or {}).get("posttime") or e.get("rtime32_start_time") or 0
    start = e.get("rtime32_start_time") or 0
    m = NOTICE_RE.search(title)
    if m and m.group(2).lower() in MONTHS:
        kind, day = "notice", "%04d-%02d-%02d" % (int(m.group(1)), MONTHS[m.group(2).lower()], int(m.group(3)))
    elif e.get("event_type") in (13, 14) and start - posted > 36 * 3600:  # posted days ahead of the patch it is about
        kind, day = "extra", datetime.fromtimestamp(start, KST).strftime("%Y-%m-%d")
    else:
        return None
    return {"gid": str(e["gid"]), "kind": kind, "day": day, "title": title, "posted": posted,
            "start": start if start - posted > 36 * 3600 else 0, "text": _text(body),
            "images": [u.strip().replace("{STEAM_CLAN_IMAGE}", IMAGES) for u in re.findall(r"\[img[^\]]*\](.*?)\[/img\]", body, flags=re.S | re.I)],
            "url": PAGE % (APPID, e["gid"])}


def _fetch(offset: int) -> list:
    req = urllib.request.Request(URL % (APPID, offset), headers={"User-Agent": "LimbusArchive"})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.load(r).get("events") or []


def posts(data_dir: str, force: bool = False) -> dict:
    """{"checked", "posts": {gid: post}} from data/news/steam.json, read again from Steam once it is KEEP old.
    Without a connection the saved list is served as it is."""
    path = os.path.join(data_dir, "news", "steam.json")
    try:
        with open(path, encoding="utf-8") as f:
            doc = json.load(f)
        if doc.get("v") != VERSION:
            doc = {}
    except (OSError, ValueError):
        doc = {}
    if doc and not force and time.time() - doc.get("checked", 0) < KEEP:
        return doc
    try:
        found = {}
        for page in range(1 if doc else FIRST):
            events = _fetch(page * 100)
            for e in events:
                p = _post(e)
                if p:
                    found[p["gid"]] = p
            if len(events) < 100:
                break
    except Exception as e:
        return dict(doc or {"posts": {}}, error=str(e))
    doc = {"v": VERSION, "checked": int(time.time()), "posts": {**doc.get("posts", {}), **found}}
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path + ".tmp", "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False)
    os.replace(path + ".tmp", path)
    return doc


def _day(version: str) -> str | None:
    """The date in a snapshot's version: "s20261001_…" -> "2026-10-01"."""
    m = re.match(r"s(\d{4})(\d{2})(\d{2})_", version or "")
    return "-".join(m.groups()) if m else None


def patches(svc, force: bool = False) -> dict:
    """The notices grouped by patch day, newest first, each with what the archive has of that patch:
    {"checked", "error"?, "patches": [{"day", "time", "notice", "extra": [post…], "report", "summary", "snapshot"}]}.
    "report" is the first report whose newer snapshot carries that day; "snapshot" = one is there, report or not."""
    doc = posts(svc.data_dir, force)
    days: dict[str, dict] = {}
    for p in doc.get("posts", {}).values():
        d = days.setdefault(p["day"], {"day": p["day"], "time": 0, "notice": None, "extra": []})
        if p["kind"] == "notice" and (not d["notice"] or p["posted"] > d["notice"]["posted"]):
            d["notice"] = p
        elif p["kind"] == "extra":
            d["extra"].append(p)
        d["time"] = max(d["time"], p["start"])
    snaps = {_day(s["version"]) for s in svc.snapshots()}
    reports = {}
    for r in svc.reports():  # newest first: the oldest report of a day stays (the patch itself, not a later re-check)
        if _day(r["new"]) != _day(r["old"]):
            reports[_day(r["new"])] = r
    out = []
    for d in sorted(days.values(), key=lambda d: d["day"], reverse=True):
        if not d["notice"]:  # a "New Content" post alone isn't a patch's notice
            continue
        if not d["time"]:  # the patch hour when Steam holds only the posting time: Thursday 12:00 in Korea
            d["time"] = int(datetime.strptime(d["day"], "%Y-%m-%d").replace(hour=12, tzinfo=KST).timestamp())
        d["extra"].sort(key=lambda p: p["posted"])
        r = reports.get(d["day"])
        d.update(report=r and r["id"], summary=r and r.get("summary"), snapshot=d["day"] in snaps)
        out.append(d)
    return {"checked": doc.get("checked"), "error": doc.get("error"), "patches": out}
