"""Mirror Dungeon teams from the community MDE Teams Guide (public Google Sheet), re-read once a week.

Every team has its own sheet: lineups are rows where several cells are Identity names ("Pequod Ishmael",
"Shi Faust"), labelled by the heading above them ("Main Team", "Backup", "Floor 1 Sacs"…). Names are matched
to the game's Identities by Sinner + words of the title, so new Identities match without changes here.
"""
from __future__ import annotations

import csv
import io
import re
import time
import urllib.request

SHEET_ID = "1PGbgzl4Z2plWIJD5_2ZdVyfkpPvCUYPK_AJq2q6Ij5c"
SHEET_URL = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}"
# sheets that are not teams
SKIP = re.compile(r"^(welcome|faq|teams list|id catalogue|.*packs?)$", re.I)
UA = {"User-Agent": "Mozilla/5.0 (LimbusArchive team guide reader)"}

SINNER_ALIASES = [  # (sinner number, words that name them; longest first)
    (3, ["don quixote", "don"]), (8, ["ishmael", "ish"]), (6, ["hong lu", "honglu", "hl"]), (1, ["yi sang", "yisang"]),
    (2, ["faust"]), (4, ["ryoshu", "ryōshū", "ryo"]), (5, ["meursault", "meur"]), (7, ["heathcliff", "heath"]),
    (9, ["rodion", "rodya"]), (10, ["sinclair", "sinc"]), (11, ["outis"]), (12, ["gregor", "greg"]),
]
STOP = {"the", "of", "a", "an", "and", "corp", "corporation", "id"}


def _get(url: str) -> str:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", "replace")


def list_sheets() -> list[tuple[str, str]]:
    """[(gid, name)] of the spreadsheet's tabs."""
    html = _get(f"{SHEET_URL}/htmlview")
    out = []
    for m in re.finditer(r'\{name: "(.*?)", pageUrl: ".*?", gid: "(\d+)"', html):
        name = m.group(1).encode().decode("unicode_escape", "replace") if "\\x" in m.group(1) else m.group(1)
        out.append((m.group(2), name))
    return out


def fetch_sheet(gid: str) -> list[list[str]]:
    return list(csv.reader(io.StringIO(_get(f"{SHEET_URL}/export?format=csv&gid={gid}"))))


# ------------------------------------------------------------------ name → Identity
# community nicknames that share no words with the title: (sinner or 0 for any, nickname) -> words of the title
NICKNAMES = {
    (0, "qoh"): "love hate",                  # Queen of Hatred → In the Name of Love and Hate
    (0, "kod"): "sword sharpened tears",      # Knight of Despair
    (0, "alriune"): "faint aroma",
    (3, "manager"): "manchaland",             # Manager Don = The Manager of La Manchaland
    (10, "n corp"): "grip",                   # N Corp. Sinclair = The One Who Shall Grip
    (8, "xichun"): "family hierarch candidate",
}


def _words(s: str) -> list[str]:
    s = s.lower().replace("ō", "o").replace("ū", "u").replace("&", " and ").replace(".", " ").replace("'", "").replace("’", "")
    return [w for w in re.split(r"[^a-z0-9]+", s) if w]


class Matcher:
    """Finds the Identity a community name means: "Pequod Ishmael", "Blade of the House of Spiders Ryoshu"."""

    def __init__(self, ids: list[dict], egos: list[dict] | None = None):
        self.by_sinner: dict[int, list[tuple[set, set, dict]]] = {}
        self.egos: dict[int, list[tuple[set, set, dict]]] = {}
        for x in ids:
            self.by_sinner.setdefault(x["sinner"], []).append((*self._keys(x["title"]), x))
        for x in egos or []:
            self.egos.setdefault(x["sinner"], []).append((*self._keys(x["name"]), x))

    @staticmethod
    def _keys(title: str) -> tuple[set, set]:
        ws = _words(title)
        # acronyms of every run of 2+ words: "BL" = Blade Lineage, "REAP" = Red Eyes And Penitence…
        acr = {"".join(w[0] for w in ws[i:j]) for i in range(len(ws)) for j in range(i + 2, len(ws) + 1)}
        # neighbours written as one word: "fullstop" = Full-Stop
        return set(ws) | {a + b for a, b in zip(ws, ws[1:])}, acr

    def sinner_of(self, words: list[str]) -> tuple[int | None, list[str]]:
        text = " ".join(words)
        for sid, names in SINNER_ALIASES:
            for n in names:
                if re.search(rf"(^| ){re.escape(n)}( |$)", text):
                    rest = re.sub(rf"(^| ){re.escape(n)}( |$)", " ", text, count=1).split()
                    return sid, rest
        return None, words

    def match(self, name: str, egos: bool = False) -> dict | None:
        words = _words(name)
        if not 1 < len(words) <= 12:
            return None
        sid, rest = self.sinner_of(words)
        text = " " + " ".join(rest) + " "
        for (who, nick), title_words in NICKNAMES.items():
            if who in (0, sid) and f" {nick} " in text:
                text = text.replace(f" {nick} ", f" {title_words} ")
        rest = [w for w in text.split() if w not in STOP]
        if not sid or not rest:
            return None
        best, best_score, tie = None, 0.0, False
        for ws, acr, x in (self.egos if egos else self.by_sinner).get(sid, []):
            score = 0.0
            for w in rest:
                if w in ws:
                    score += 1
                elif w in acr or any(t.startswith(w) for t in ws if len(w) >= 3):
                    score += 0.6
            score /= len(rest)
            if score > best_score:
                best, best_score, tie = x, score, False
            elif score == best_score and score > 0:
                tie = True
        if best and best_score >= 0.5 and not tie:
            return {"id": best["id"], "score": round(best_score, 2)}
        return None

    def looks_like_id(self, cell: str) -> bool:
        words = _words(cell)
        return (1 < len(words) <= 10 and len(cell) < 70 and "\n" not in cell and "(" not in cell
                and "floor" not in words and self.sinner_of(words)[0] is not None)


def match_member(matcher: "Matcher", name: str) -> dict:
    """{"id", "ego", "alt"}: "Thumb/dawn Sinclair" is two options for one slot — the first and an alternative."""
    if "/" in name:
        parts = [p.strip() for p in name.split("/") if p.strip()]
        sid, _ = matcher.sinner_of(_words(parts[-1]))
        if sid and len(parts) > 1:
            sinner = next(n for s, ns in SINNER_ALIASES if s == sid for n in ns)
            opts = [matcher.match(p if matcher.sinner_of(_words(p))[0] else f"{p} {sinner}") for p in parts]
            opts = [o["id"] for o in opts if o]
            if opts:
                return {"id": opts[0], "ego": None, "alt": opts[1] if len(opts) > 1 else None}
    m = matcher.match(name)
    e = None if m else matcher.match(name, egos=True)
    return {"id": m["id"] if m else None, "ego": e["id"] if e else None, "alt": None}


# ------------------------------------------------------------------ one team sheet
def _cells(row: list[str]) -> list[tuple[int, str]]:
    return [(i, c.strip()) for i, c in enumerate(row) if c.strip()]


def parse_team(name: str, rows: list[list[str]], matcher: Matcher) -> dict:
    team = {"name": name, "difficulty": "", "updated": "", "codes": [], "about": "", "lineups": []}
    for r in rows:
        for i, c in _cells(r):
            if not team["about"] and c.startswith("This guide is for"):
                team["about"] = c.strip()
            team["codes"] += [m for m in re.findall(r"H4sI[A-Za-z0-9+/=]{20,}", c) if m not in team["codes"]]
            low = c.lower()
            if low.startswith("difficulty") and i + 1 < len(r) and not team["difficulty"]:
                team["difficulty"] = next((x for _, x in _cells(r[i + 1:])), "")
            if low.startswith("last updated"):
                d = re.sub(r"(?i)last updated:?", "", c).strip() or next((x for _, x in _cells(r[i + 1:])), "")
                team["updated"] = team["updated"] or d.split("\n")[0].strip()
    filled = [(n, _cells(r)) for n, r in enumerate(rows) if _cells(r)]  # the sheet has many blank spacer rows
    for k, (n, cells) in enumerate(filled):
        ids = [(i, c) for i, c in cells if matcher.looks_like_id(c)]
        if not ids or len(ids) < len(cells) or (len(ids) < 3 and k and len(filled[k - 1][1]) > 2):
            continue
        prev = filled[k - 1][1] if k else []
        tags = {i: c for i, c in prev} if len(prev) >= 2 and not any(matcher.looks_like_id(c) for _, c in prev) else {}
        nxt = filled[k + 1][1] if k + 1 < len(filled) else []
        notes = {i: c for i, c in nxt} if any(c.lstrip()[:1] in ("•", "�", "-", "#") for _, c in nxt) else {}
        # the heading: the nearest row above that starts at the left edge with a short text
        label, note = "", ""
        for j in range(k - 1, max(-1, k - 6), -1):
            above = filled[j][1]
            if above[0][0] <= 2 and len(above) <= 2 and len(above[0][1]) <= 60 and not matcher.looks_like_id(above[0][1]):
                label = above[0][1].split("\n")[0].strip()
                note = " ".join(x for _, x in above[1:])[:400]
                break
        members = [{"name": c, **match_member(matcher, c), "tag": tags.get(i, ""), "note": notes.get(i, "")}
                   for i, c in ids]
        kind = "ego" if sum(1 for x in members if x["ego"]) > len(members) / 2 else "ids"
        team["lineups"].append({"label": label or "Lineup", "note": note, "kind": kind, "members": members})
    return team


def fetch_all(ids: list[dict], egos: list[dict], log=print) -> dict:
    """Read every team sheet of the guide. Network: ~30 small CSV requests."""
    matcher = Matcher(ids, egos)
    teams, errors = [], []
    summary = {}
    for gid, name in list_sheets():
        try:
            rows = fetch_sheet(gid)
        except Exception as e:
            errors.append(f"{name}: {e}")
            continue
        if name.lower() == "teams list":
            for r in rows:
                cells = _cells(r)
                if len(cells) >= 2 and cells[1][1].upper() == "DIFFICULTY":
                    summary[cells[0][1].lower()] = cells[-1][1]
            continue
        if SKIP.match(name.strip()):
            continue
        t = parse_team(name, rows, matcher)
        if t["lineups"]:
            t["gid"] = gid
            teams.append(t)
        log(f"{name}: {len(t['lineups'])} lineups")
    for t in teams:
        s = summary.get(t["name"].lower())
        if s:
            t["changelog"] = s
    return {"fetched": time.time(), "source": SHEET_URL, "teams": teams, "errors": errors}


def rematch(data: dict, ids: list[dict], egos: list[dict]) -> dict:
    """Match the stored names again (new Identities after a patch)."""
    m = Matcher(ids, egos)
    for t in data.get("teams", []):
        for lu in t["lineups"]:
            for x in lu["members"]:
                x.update(match_member(m, x["name"]))
    return data
