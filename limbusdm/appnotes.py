"""What's new in the app: release notes since the version seen last (GitHub API once per version)."""
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
    except Exception:  # (the API's hourly limit is spent, as a rule: the releases' feed has none)
        try:
            _kept[:] = [time.time(), _feed()]
        except Exception:
            return _kept[1]
    return _kept[1]


def _feed() -> list:
    """The last ten releases from releases.atom, shaped like the API's answer (HTML turned back into "## ", "- ", "**")."""
    import html, re
    import xml.etree.ElementTree as ET
    req = urllib.request.Request(f"https://github.com/{REPO}/releases.atom", headers={"User-Agent": UA["User-Agent"]})
    with urllib.request.urlopen(req, timeout=15) as r:
        root = ET.fromstring(r.read())
    ns = {"a": "http://www.w3.org/2005/Atom"}
    out = []
    for e in root.findall("a:entry", ns):
        t = e.findtext("a:content", "", ns)
        t = re.sub(r"<h\d[^>]*>", "\n## ", t)
        t = re.sub(r"<li[^>]*>\s*(?:<p>)?", "\n- ", t)
        t = re.sub(r"</?(?:strong|b)>", "**", t)
        t = re.sub(r"</(?:p|h\d|ul|ol|li)>|<br\s*/?>", "\n", t)
        body = "\n".join(l.strip() for l in html.unescape(re.sub(r"<[^>]+>", "", t)).splitlines() if l.strip())
        out.append({"tag_name": e.findtext("a:id", "", ns).rsplit("/", 1)[-1], "body": body, "published_at": e.findtext("a:updated", "", ns)})
    return out


def history(count: int = 20) -> dict:
    """Notes of the last releases up to this version, newest first."""
    hi = _ver(__version__)
    notes = [{"tag": x["tag_name"].lstrip("v"), "body": x.get("body") or "", "date": (x.get("published_at") or "")[:10]}
             for x in _releases() if _ver(x["tag_name"]) <= hi and (x.get("body") or "").strip()]
    notes.sort(key=lambda n: _ver(n["tag"]), reverse=True)
    return {"version": __version__, "notes": notes[:count], "page": f"https://github.com/{REPO}/releases", "history": True}


def pending(data_dir: str) -> dict:
    """This version's unseen notes {"version", "notes"}, else {}."""
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
