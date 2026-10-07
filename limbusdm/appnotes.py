"""What's new in Limbus Archive itself: after the app updates, the notes of the releases since the version seen last,
read once from GitHub (the API is asked only when the version changes — it allows 60 calls an hour)."""
import json, os, time, urllib.request

from . import REPO, __version__
from .updater import UA, _ver

SEEN = "app_seen.json"  # {"version": the last version whose notes were shown}


def _path(data_dir: str) -> str:
    return os.path.join(data_dir, SEEN)


def _seen(data_dir: str) -> str | None:
    try:
        with open(_path(data_dir), encoding="utf-8") as f:
            return json.load(f).get("version")
    except (OSError, ValueError):
        return None


_kept = [0.0, []]  # when the releases were read, and the releases: the history is asked by a button


def _releases() -> list:
    if _kept[1] and time.time() - _kept[0] < 600:
        return _kept[1]
    try:
        req = urllib.request.Request(f"https://api.github.com/repos/{REPO}/releases?per_page=40",
                                     headers={"User-Agent": UA["User-Agent"], "Accept": "application/vnd.github+json"})
        with urllib.request.urlopen(req, timeout=15) as r:
            _kept[:] = [time.time(), [x for x in json.load(r) if not x.get("draft")]]
    except Exception:
        return _kept[1]
    return _kept[1]


def history(count: int = 20) -> dict:
    """The notes of the last releases up to this version, the newest first (the status box's "What's new")."""
    hi = _ver(__version__)
    notes = [{"tag": x["tag_name"].lstrip("v"), "body": x.get("body") or "", "date": (x.get("published_at") or "")[:10]}
             for x in _releases() if _ver(x["tag_name"]) <= hi and (x.get("body") or "").strip()]
    notes.sort(key=lambda n: _ver(n["tag"]), reverse=True)
    return {"version": __version__, "notes": notes[:count], "page": f"https://github.com/{REPO}/releases", "history": True}


def pending(data_dir: str) -> dict:
    """{"version", "notes": [{"tag", "body"}…]} when this version's notes weren't shown yet, else {}.
    The first start with this feature shows only the current version's notes."""
    last = _seen(data_dir)
    if last == __version__:
        return {}
    rels = _releases()
    lo, hi = _ver(last) if last else _ver(__version__), _ver(__version__)
    notes = [{"tag": x["tag_name"].lstrip("v"), "body": x.get("body") or ""} for x in rels
             if (lo < _ver(x["tag_name"]) <= hi or (not last and _ver(x["tag_name"]) == hi))]
    notes.sort(key=lambda n: _ver(n["tag"]), reverse=True)
    return {"version": __version__, "notes": notes[:15], "page": f"https://github.com/{REPO}/releases"}


def mark_seen(data_dir: str):
    with open(_path(data_dir), "w", encoding="utf-8") as f:
        json.dump({"version": __version__}, f)
