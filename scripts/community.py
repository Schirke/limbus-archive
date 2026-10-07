"""Who streams Limbus Company right now: the live streams on Twitch and YouTube (the 30 busiest of a language), in English, Russian and Korean,
written to streams.json. Run by .github/workflows/community.yml on a timer; the app reads the file from the
`community-data` branch (limbusdm/community.py). The API keys come from the repository's secrets, never from the repo.

    TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET   an app registered at dev.twitch.tv
    YOUTUBE_API_KEY                          a key with "YouTube Data API v3" at console.cloud.google.com

Either service is skipped without its key. YouTube lets a key search about 100 times a day (a search per language
each time), so its part is asked anew every 50 minutes and carried over in between.

The recommended channels (the pictures in the page's corner) are the links in recommended.json on the
`community-config` branch, written by the owner's app (limbusdm/community.py): each gets its name and picture, and
whether it is live right now — with any game, not this one alone."""
import datetime
import json
import os
import re
import sys
import urllib.parse
import urllib.request

GAME, TOP, LANGS = "Limbus Company", 30, ("en", "ru", "ko")  # TOP: streams kept per language
YOUTUBE_EVERY = 48 * 60  # seconds
LETTERS = (("ru", "[а-яё]"), ("ko", "[가-힣]"))  # a language told by its letters
OUT = sys.argv[1] if len(sys.argv) > 1 else "streams.json"
REPO = os.environ.get("GITHUB_REPOSITORY") or "Schirke/limbus-archive"
WHO_EVERY = 24 * 3600  # seconds a YouTube channel's name and picture are kept
TW = {}  # the headers Twitch took, for the recommended channels


def call(url, params=None, headers=None, data=None):
    if params:
        url += "?" + urllib.parse.urlencode(params, doseq=True)
    req = urllib.request.Request(url, headers=headers or {}, data=urllib.parse.urlencode(data).encode() if data else None)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def twitch(cid, secret):
    token = call("https://id.twitch.tv/oauth2/token", data={"client_id": cid, "client_secret": secret,
                                                             "grant_type": "client_credentials"})["access_token"]
    head = {"Client-Id": cid, "Authorization": "Bearer " + token}
    games = call("https://api.twitch.tv/helix/games", {"name": GAME}, head)["data"]
    TW.update(head)
    out = {}
    for lang in LANGS:  # the busiest first, as Twitch lists them
        rows = call("https://api.twitch.tv/helix/streams", {"game_id": games[0]["id"], "language": lang, "first": TOP},
                    head)["data"] if games else []
        faces = {}  # the streamers' pictures, for the mark in the app's menu when somebody big is live
        try:
            who = call("https://api.twitch.tv/helix/users", {"id": [s["user_id"] for s in rows]}, head)["data"] if rows else []
            faces = {u["id"]: u.get("profile_image_url") or "" for u in who}
        except Exception as e:
            print("Twitch pictures:", problem(e))
        out[lang] = [{"on": "twitch", "name": s["user_name"], "title": s["title"], "viewers": s["viewer_count"],
                      "url": "https://www.twitch.tv/" + s["user_login"], "started": s["started_at"], "avatar": faces.get(s["user_id"], ""),
                      "thumb": s["thumbnail_url"].replace("{width}", "440").replace("{height}", "248")} for s in rows]
    return out


def youtube(key):
    api, out = "https://www.googleapis.com/youtube/v3/", {}
    for lang in LANGS:
        found = call(api + "search", {"part": "id", "type": "video", "eventType": "live", "q": GAME, "order": "viewCount",
                                      "relevanceLanguage": lang, "maxResults": 25, "key": key})["items"]
        ids = [x["id"]["videoId"] for x in found if x.get("id", {}).get("videoId")]
        rows = call(api + "videos", {"part": "snippet,liveStreamingDetails", "id": ",".join(ids), "key": key})["items"] if ids else []
        faces = {}
        try:
            chans = sorted({v["snippet"]["channelId"] for v in rows})
            who = call(api + "channels", {"part": "snippet", "id": ",".join(chans), "maxResults": 50, "key": key})["items"] if chans else []
            faces = {c["id"]: ((c["snippet"].get("thumbnails") or {}).get("default") or {}).get("url") or "" for c in who}
        except Exception as e:
            print("YouTube pictures:", problem(e))
        out[lang] = []
        for v in rows:
            sn, live = v["snippet"], v.get("liveStreamingDetails") or {}
            if "concurrentViewers" not in live or GAME.lower() not in (sn["title"] + " " + sn.get("description", "")[:300]).lower():
                continue
            # the search only leans towards a language: a stream's own is what it says of itself, else told by its letters
            said = (sn.get("defaultAudioLanguage") or sn.get("defaultLanguage") or "").lower()[:2]
            words = (sn["title"] + sn["channelTitle"]).lower()
            mine = said or next((code for code, letters in LETTERS if re.search(letters, words)), "en")
            if mine != lang:
                continue
            out[lang].append({"on": "youtube", "name": sn["channelTitle"], "title": sn["title"], "viewers": int(live["concurrentViewers"]),
                              "url": "https://www.youtube.com/watch?v=" + v["id"], "started": live.get("actualStartTime") or "",
                              "avatar": faces.get(sn["channelId"], ""),
                              "thumb": (sn["thumbnails"].get("medium") or sn["thumbnails"]["default"])["url"]})
    return out


def wanted():
    """The owner's list: [(the line, "twitch" | "youtube", login | channel id | @handle)]."""
    req = urllib.request.Request(f"https://api.github.com/repos/{REPO}/contents/recommended.json?ref=community-config",
                                 headers={"Accept": "application/vnd.github.raw", "User-Agent": "LimbusArchive"})
    if os.environ.get("GH_TOKEN"):
        req.add_header("Authorization", "Bearer " + os.environ["GH_TOKEN"])
    with urllib.request.urlopen(req, timeout=30) as r:
        lines = json.load(r)
    out = []
    for line in lines if isinstance(lines, list) else []:
        m = re.search(r"twitch\.tv/([A-Za-z0-9_]+)", line)
        if m:
            out.append((line, "twitch", m.group(1).lower()))
            continue
        m = re.search(r"/channel/(UC[\w-]{22})", line) or re.search(r"(?:youtube\.com/|^)(@[^/?#\s]+)", line.strip())
        if m:
            out.append((line, "youtube", urllib.parse.unquote(m.group(1))))
    return out


def page(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Accept-Language": "en"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read().decode("utf-8", "replace")


def recommended(old, now, yt):
    """The recommended channels in the owner's order: {"src", "on", "name", "url", "avatar", "live"}, live = None or
    {"title", "viewers", "url"}. `old` = this part as written the last time: what can't be asked now stays as it was."""
    was = {r["src"]: r for r in old.get("list") or []}
    who, rows = dict(old.get("who") or {}), []
    want = wanted()
    logins = [key for _, on, key in want if on == "twitch"]
    faces, live = {}, {}
    if logins and TW:
        api = "https://api.twitch.tv/helix/"
        faces = {u["login"]: u for u in call(api + "users", {"login": logins[:100]}, TW)["data"]}
        live = {s["user_login"]: s for s in call(api + "streams", {"user_login": logins[:100], "first": 100}, TW)["data"]}
    api, found = "https://www.googleapis.com/youtube/v3/", {}
    for src, on, key in want:
        if on != "youtube" or not yt:
            continue
        w = who.get(src)
        if not w or (now - datetime.datetime.fromisoformat(w["at"])).total_seconds() >= WHO_EVERY:
            try:
                got = call(api + "channels", {"part": "snippet", "id" if key.startswith("UC") else "forHandle": key, "key": yt}).get("items")
                if got:
                    sn = got[0]["snippet"]
                    w = who[src] = {"id": got[0]["id"], "name": sn["title"], "at": now.isoformat(timespec="seconds"),
                                    "avatar": ((sn.get("thumbnails") or {}).get("default") or {}).get("url") or ""}
            except Exception as e:
                print("recommended:", src, problem(e))
        if not w:
            continue
        # what may be on air: the channel's newest videos (its feed: no key spent) and what its /live page shows
        ids = []
        try:
            ids = re.findall(r"<yt:videoId>([\w-]{11})<", page("https://www.youtube.com/feeds/videos.xml?channel_id=" + w["id"]))[:4]
        except Exception as e:
            print("recommended: feed of", w["name"], problem(e))
        try:
            m = re.search(r'<link rel="canonical" href="https://www\.youtube\.com/watch\?v=([\w-]{11})"',
                          page(f"https://www.youtube.com/channel/{w['id']}/live"))
            if m and m.group(1) not in ids:
                ids.append(m.group(1))
        except Exception as e:
            print("recommended: live page of", w["name"], problem(e))
        found[src] = ids
    on_air, asked = {}, True  # video id -> the stream
    ids = sorted({i for v in found.values() for i in v})
    try:
        for n in range(0, len(ids), 50):
            for v in call(api + "videos", {"part": "snippet,liveStreamingDetails", "id": ",".join(ids[n:n + 50]), "key": yt})["items"]:
                if v["snippet"].get("liveBroadcastContent") == "live":
                    on_air[v["id"]] = {"title": v["snippet"]["title"], "url": "https://www.youtube.com/watch?v=" + v["id"],
                                       "viewers": int((v.get("liveStreamingDetails") or {}).get("concurrentViewers") or 0)}
    except Exception as e:
        asked = False
        print("recommended: videos", problem(e))
    for src, on, key in want:
        if on == "twitch" and key in faces:
            u, s = faces[key], live.get(key)
            rows.append({"src": src, "on": on, "name": u["display_name"], "url": "https://www.twitch.tv/" + key,
                         "avatar": u.get("profile_image_url") or "",
                         "live": s and {"title": s["title"], "viewers": s["viewer_count"], "url": "https://www.twitch.tv/" + key}})
        elif on == "youtube" and src in who and yt:
            w = who[src]
            rows.append({"src": src, "on": on, "name": w["name"], "url": "https://www.youtube.com/channel/" + w["id"], "avatar": w["avatar"],
                         "live": next((on_air[i] for i in found.get(src, []) if i in on_air), None) if asked else (was.get(src) or {}).get("live")})
        elif src in was:
            rows.append(was[src])
    return {"list": rows, "who": {src: who[src] for src, _, _ in want if src in who}}


def problem(e):
    """An error to publish: what the service answered, without the key a URL in it may carry."""
    said = ""
    if hasattr(e, "read"):
        try:
            said = " — " + e.read().decode("utf-8", "replace")[:300]
        except Exception:
            pass
    return type(e).__name__ + ": " + re.sub(r"key=[^&\s]+", "key=…", str(e) + said)


def main():
    now = datetime.datetime.now(datetime.timezone.utc)
    try:
        with open(OUT, encoding="utf-8") as f:
            old = json.load(f)
    except (OSError, ValueError):
        old = {}
    parts, errors = dict(old.get("parts") or {}), {}
    key = lambda name: (os.environ.get(name) or "").strip()  # (a pasted secret often ends with a space or a line break)
    tw = (key("TWITCH_CLIENT_ID"), key("TWITCH_CLIENT_SECRET"))
    yt = key("YOUTUBE_API_KEY")
    print("keys:", {n: len(key(n)) for n in ("TWITCH_CLIENT_ID", "TWITCH_CLIENT_SECRET", "YOUTUBE_API_KEY")}, "characters")
    if all(tw):
        try:
            parts["twitch"] = {"at": now.isoformat(timespec="seconds"), "streams": twitch(*tw)}
        except Exception as e:  # one service down doesn't empty the other
            errors["twitch"] = problem(e)
            if "invalid client" in errors["twitch"]:  # the two values look alike: pasted into each other's secret?
                try:
                    parts["twitch"] = {"at": now.isoformat(timespec="seconds"), "streams": twitch(*tw[::-1])}
                    errors.pop("twitch")
                    print("Twitch: the ID and the secret are in each other's place — read the other way round")
                except Exception as e2:
                    errors["twitch"] += " | the other way round: " + problem(e2)
    if yt:
        last = (parts.get("youtube") or {}).get("at")
        if not last or (now - datetime.datetime.fromisoformat(last)).total_seconds() >= YOUTUBE_EVERY:
            try:
                parts["youtube"] = {"at": now.isoformat(timespec="seconds"), "streams": youtube(yt)}
            except Exception as e:
                errors["youtube"] = problem(e)
    if not parts:
        print("no API keys in the secrets, or nothing answered: nothing written", errors or "")
        return
    try:
        rec = recommended(old.get("rec") or {}, now, yt)
    except Exception as e:  # (no list: the branch isn't there, GitHub didn't answer) — as it was
        rec = old.get("rec") or {}
        print("recommended:", problem(e))
    doc = {"updated": now.isoformat(timespec="seconds"), "parts": parts, "errors": errors}
    for lang in LANGS:
        rows = [s for p in parts.values() for s in (p.get("streams") or {}).get(lang) or []]
        doc[lang] = sorted(rows, key=lambda s: -s["viewers"])[:TOP]
    doc["rec"], doc["recommended"] = rec, rec.get("list") or []
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)
    print({lang: len(doc[lang]) for lang in LANGS}, errors or "")


if __name__ == "__main__":
    main()
