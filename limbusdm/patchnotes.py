"""A short "what's new" of a report, to paste into Discord or Telegram (both take **bold** from a pasted text).

Built from the report's English localization records (new Identities / E.G.O, enemies, stages, keywords, cosmetics,
changed skill texts), its new music and videos and the Highlights. Cached next to the report (<id>.notes.json)."""
import gzip, json, os, re

VERSION = 1
LIMIT = 1900  # one Discord message holds 2000 characters

_SEEN = "_notes_seen.json"  # reports whose notes were shown (or that came before this feature)


def _clean(s) -> str:
    s = re.sub(r"<[^>]+>", "", str(s or ""))
    return re.sub(r"\s+", " ", s).strip()


def _label(r: dict) -> str:
    for k in ("name", "title", "displayName", "panicName", "chapter", "text"):
        if isinstance(r.get(k), str) and r[k].strip():
            return _clean(r[k])
    return ""


def _list(items: list[str], n: int) -> str:
    items = list(dict.fromkeys(x for x in items if x))
    more = len(items) - n
    return ", ".join(items[:n]) + (f" and {more} more" if more > 0 else "")


def _date(snap_id: str) -> str:
    m = re.match(r"s(\d{4})(\d\d)(\d\d)", snap_id or "")
    return f"{m.group(1)}-{m.group(2)}-{m.group(3)}" if m else ""


def build(svc, rid: str) -> str:
    with gzip.open(os.path.join(svc.data_dir, "reports", rid + ".json.gz"), "rt", encoding="utf-8") as f:
        rep = json.load(f)
    names = svc.names()
    sec = rep.get("sections") or {}

    def who(cid: int) -> str:
        """"Yi Sang — LCB Sinner" for an Identity / E.G.O id."""
        r = names.personalities.get(cid) or names.egos.get(cid) or {}
        title = _clean(r.get("title") or r.get("name") or cid)
        try:
            sinner = names.sinner_name(names.sinner_of(cid))
        except Exception:
            sinner = ""
        return f"{sinner} — {title}" if sinner else title

    added, changed = {}, {}  # localization file kind ("Personalities", "Enemies"…) -> records
    for it in sec.get("texts") or []:
        m = re.match(r"EN_([A-Za-z]+)", it.get("name") or "")
        rec = it.get("records") or {}
        if not m:
            continue
        added.setdefault(m.group(1), []).extend(rec.get("added") or [])
        changed.setdefault(m.group(1), []).extend(rec.get("changed") or [])

    lines = []

    def add(title: str, body: str):
        if body:
            lines.append(f"**{title}:** {body}")

    ids = [who(r["id"]) for r in added.get("Personalities", []) if isinstance(r.get("id"), int)]
    add("New Identities", _list(ids, 8))
    egos = [who(r["id"]) for r in added.get("Egos", []) if isinstance(r.get("id"), int)]
    add("New E.G.O", _list(egos, 8))
    # a changed skill text: the skill id is the owner's id + two digits (Identity 1010101 -> 10101)
    owners = []
    for r in changed.get("Skills", []):
        sid = r.get("id")
        if isinstance(sid, int) and sid >= 1000000 and sid // 100 not in owners:
            owners.append(sid // 100)
    add("Skill texts changed", _list([who(c) for c in owners], 8))
    add("New enemies", _list([_label(r) for r in added.get("Enemies", [])], 10))
    add("New Abnormalities", _list([_label(r) for r in added.get("AbnormalityGuides", [])], 6))
    add("New stages", _list([_label(r) for r in added.get("StageNode", []) + added.get("StageChapterText", [])], 6))
    kw = [_label(r) for r in added.get("BattleKeywords", [])]
    if kw:
        add(f"New status effects ({len(set(kw))})", _list(kw, 6))
    add("New cosmetics", _list([_label(r) for k in ("UserTicket", "Announcer") for r in added.get(k, [])], 6))

    music = []
    for it in sec.get("audio") or []:
        if it.get("kind") != "removed" and (it.get("name") or "").startswith("BGM"):
            old = {s[0] for s in ((it.get("old") or {}).get("sounds") or [])}
            music += [s[0] for s in ((it.get("new") or {}).get("sounds") or []) if s[0] not in old]
    add(f"New music ({len(set(music))} tracks)" if music else "New music", _list(music, 6))

    vids = []
    for it in sec.get("video") or []:
        m = re.search(r"(PersonalityVideo|EgoVideo|SkillPreviewVideo)/(\d+)", it.get("path") or "")
        if m and it.get("kind") != "removed":
            kind = {"PersonalityVideo": "", "EgoVideo": "", "SkillPreviewVideo": " (skill preview)"}[m.group(1)]
            vids.append(who(int(m.group(2))) + kind)
    add("New videos", _list(vids, 6))

    hl = [_clean(it.get("name")) for it in sec.get("leaks") or [] if "leak" in (it.get("flags") or [])]
    add("Highlights (next update)", _list(hl, 6))

    if not lines:
        lines.append("No new Identities, E.G.O, enemies or story this time.")
    s = rep.get("summary") or {}
    if s.get("foreign_only"):
        lines.append(f"{s['foreign_only']} lines are only in Korean / Japanese so far.")
    counts = [f"{s[k]:,} {w}" for k, w in (("texts", "text files"), ("data", "data files"), ("images", "images"),
                                            ("audio", "sound files"), ("video", "videos")) if s.get(k)]
    if counts:
        lines.append("Changed in all: " + ", ".join(counts) + ".")

    head = f"**Limbus Company — what's new{(' (' + _date(rep['new']['id']) + ')') if _date(rep.get('new', {}).get('id')) else ''}**"
    text = head + "\n" + "\n".join(lines)
    while len(text) > LIMIT and len(lines) > 1:  # Discord takes 2000 characters a message: the last lines go
        lines.pop(-2)
        text = head + "\n" + "\n".join(lines)
    return text


def notes(svc, rid: str) -> dict:
    path = os.path.join(svc.data_dir, "reports", rid + ".notes.json")
    try:
        with open(path, encoding="utf-8") as f:
            c = json.load(f)
        if c.get("v") == VERSION:
            return {"id": rid, "text": c["text"], "seen": rid in _seen(svc)}
    except (OSError, ValueError, KeyError):
        pass
    text = build(svc, rid)
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"v": VERSION, "text": text}, f, ensure_ascii=False)
    return {"id": rid, "text": text, "seen": rid in _seen(svc)}


def _seen(svc) -> set:
    """Reports whose notes popped up already. The first time: every report there is, so only new patches pop up."""
    path = os.path.join(svc.data_dir, "reports", _SEEN)
    try:
        with open(path, encoding="utf-8") as f:
            return set(json.load(f))
    except (OSError, ValueError):
        ids = [r["id"] for r in svc.reports()]
        with open(path, "w", encoding="utf-8") as f:
            json.dump(ids, f)
        return set(ids)


def mark_seen(svc, rid: str):
    ids = _seen(svc) | {rid}
    with open(os.path.join(svc.data_dir, "reports", _SEEN), "w", encoding="utf-8") as f:
        json.dump(sorted(ids), f)


def unseen(svc) -> str | None:
    """The newest report whose notes haven't popped up yet."""
    rs = svc.reports()
    return rs[0]["id"] if rs and rs[0]["id"] not in _seen(svc) else None
