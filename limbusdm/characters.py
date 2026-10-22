"""Sinners → Identities / E.G.O with their battle animation clips and Spine skeletons; content labels."""
from __future__ import annotations

import json
import os
import re

SINNER_ORDER = ["Yi Sang", "Faust", "Don Quixote", "Ryōshū", "Meursault", "Hong Lu", "Heathcliff", "Ishmael",
                "Rodion", "Sinclair", "Outis", "Gregor"]


def _load(base: str, pattern: str) -> dict[int, dict]:
    out = {}
    if not os.path.isdir(base):
        return out
    for fn in sorted(os.listdir(base)):
        if not re.match(pattern, fn):
            continue
        try:
            with open(os.path.join(base, fn), encoding="utf-8-sig") as f:
                for r in json.load(f).get("dataList", []):
                    if isinstance(r, dict) and isinstance(r.get("id"), int):
                        out.setdefault(r["id"], r)
        except Exception:
            continue
    return out


class Names:
    """English names of Identities, E.G.O and skills, read from the game's localization."""

    def __init__(self, game_data_dir: str | None):
        base = os.path.join(game_data_dir or "", "Assets", "Resources_moved", "Localize", "en")
        self.personalities = _load(base, r"EN_Personalities(-.*)?\.json$")
        self.egos = _load(base, r"EN_Egos(-.*)?\.json$")
        skills = _load(base, r"EN_Skills.*\.json$")
        self.skills = {}
        for sid, r in skills.items():
            lv = (r.get("levelList") or [{}])[0] or {}
            name = lv.get("name") or r.get("name")
            if name:
                self.skills[sid] = name

    def sinner_of(self, cid: int) -> int:
        return int(str(cid)[1:3])

    def sinner_name(self, sid: int) -> str:
        for pid, r in self.personalities.items():
            if self.sinner_of(pid) == sid and r.get("name"):
                return r["name"]
        return SINNER_ORDER[sid - 1] if 1 <= sid <= 12 else f"Sinner {sid}"

    def id_title(self, cid: int) -> str:
        r = self.personalities.get(cid) or {}
        return " ".join(str(r.get("title", "")).split()) or str(cid)

    def ego_title(self, cid: int) -> str:
        r = self.egos.get(cid) or {}
        return r.get("name") or str(cid)

    def clip_label(self, owner: int, kind: str, n: int, clip_name: str, slot: str | None = None) -> str:
        """How the game names a skill's slot ("Skill 3.2", "Defense"), else "Skill <n>"."""
        if kind == "skill":
            if str(owner).startswith(("1", "4")):  # (4000xx: an event's Identities)
                name = self.skills.get(owner * 100 + n)
                return (slot or f"Skill {n}") + (f" · {name}" if name else "")
            # E.G.O: S1 awakening (..11), S2 corrosion (..21)
            name = self.skills.get(owner * 100 + n * 10 + 1)
            return {1: "Awakening", 2: "Corrosion"}.get(n, f"Skill {n}") + (f" · {name}" if name else "")
        return clip_name.rsplit("_", 1)[-1] if kind == "pose" else clip_name


def owner_bundles(bundles, cid: int) -> list[str]:
    """Bundles named after an Identity (p10315_…) or E.G.O (e20405_…); early E.G.O: <id><skill> or …_<id>_ego_…"""
    s = str(cid)
    p = ("p" if s.startswith("1") else "e") + s
    ego_skill = re.compile(rf"^{s}\d{{2}}_assets_all$")
    return sorted(b for b in bundles if b == f"{p}_assets_all" or b.startswith((p + "_", p + "-")) or b == f"sd_{p}_assets_all"
                  or (p[0] == "e" and (ego_skill.match(b) or f"_{s}_ego" in b)))


# ------------------------------------------------------------------ content labels
SEASON_RE = re.compile(r"^s(\d+)_(\d{2})(\d{2})(\d{2})")
# same labels as content.py, so both land in one group
TAGS = [
    (re.compile(r"a(\d+)c(\d+)p(\d+)"), lambda m: (f"Canto {m.group(2)} · Part {m.group(3)}", int(m.group(2)))),
    (re.compile(r"walpu(\d+)"), lambda m: (f"Walpurgis Night {m.group(1)}", 0)),
    (re.compile(r"(?:rr|railway|refraction)(\d+)"), lambda m: (f"Refraction Railway {m.group(1)}", 0)),
    (re.compile(r"mrr(\d+)"), lambda m: (f"Mirror Refraction Railway {m.group(1)}", 0)),
    (re.compile(r"mirrordungeon(\d*)|(?<![a-z])md(\d+)"),
     lambda m: (f"Mirror Dungeon {m.group(1) or m.group(2) or ''}".strip(), 0)),
    (re.compile(r"mowe"), lambda m: ("Murder on the WARP Express", 0)),
    (re.compile(r"tkt"), lambda m: ("Timekilling Time", 0)),
]


def tag_label(bundle: str) -> tuple[str, float] | None:
    """(label, order) when the bundle's name says which content it came with."""
    for rx, fmt in TAGS:
        m = rx.search(bundle)
        if m:
            return fmt(m)
    return None


def bundle_date(bundle: str) -> str | None:
    sm = SEASON_RE.match(bundle)
    return f"{sm.group(2)}{sm.group(3)}{sm.group(4)}" if sm else None


SPINE_SINNERS = ["yisang", "faust", "donquixote", "ryoshu", "meursault", "honglu", "heathcliff", "ishmael", "rodion", "sinclair",
                 "outis", "gregor"]
SPINE_JUNK = re.compile(r"(?i)^(?:skeleton|test|0-1|(?:back|front|fx)(?: #\d+)?)$")  # (nameless layers and leftovers)
FOOLS = "April Fools' Day"


def spine_place(bundle: str, base: str) -> tuple[str, object] | None:
    """Where a Spine no owner names goes: ("hide", None), ("kid", sinner) = a Sinnerling's, ("sinner", n) = under the
    Sinner, ("group", label); None = by its bundle as before."""
    if SPINE_JUNK.match(base):
        return "hide", None
    m = re.match(r"baby_(\w+?)_idle$", base)
    if bundle.startswith("skinpreview") and m and m.group(1) in SPINE_SINNERS:
        return "kid", SPINE_SINNERS.index(m.group(1)) + 1
    if base.startswith("aff25_"):
        return "group", FOOLS
    if bundle.startswith("spine_s1_"):  # (Season 1 Identities' animated art: its Sinner's, else a group)
        n = _spine_sinner(base)
        return ("sinner", n) if n else ("group", "Season 1 illustrations")
    if bundle.startswith("sd_deadscene"):
        return "group", "Death scenes"
    m = re.match(r"sd_(?:p|ego)(\d+)_assets", bundle)
    if m and 1 <= int(m.group(1)) <= 12:
        return "sinner", int(m.group(1))
    if bundle.startswith("shaderv2") and "meursault" in base.lower():
        return "sinner", SPINE_SINNERS.index("meursault") + 1
    return None


_SPINE_SINNER_WORDS = [("yisang", "yis"), ("faust", "fau"), ("donquixote", "don"), ("ryoshu", "ryo"), ("meursault", "meu", "mer", "maur"),
                       ("honglu", "hongju", "honhlu", "hong"), ("heathcliff", "heath"), ("ishmael", "ismael", "ism"),
                       ("rodion", "rodya"), ("sinclair", "sinc"), ("outis", "otis"), ("gregor", "greg")]
# words in a Spine's name → words of an Identity's title (only these: a guess on other words would put art on the wrong card)
SPINE_ORGS = {"wcorp": "w corp", "rcorp": "r corp", "gcorp": "g corp", "ncorp": "n corp", "kurokumo": "kurokumo",
              "darkcloud": "kurokumo", "seven": "seven assoc", "zwei": "zwei assoc", "shi": "shi assoc", "liu": "liu assoc",
              "liuasso": "liu assoc", "blade": "blade lineage", "mexico": "los mariachis"}
_SPINE_PARTS = {"idle", "default", "back", "front", "fx", "illust", "illust2", "2"}


def _spine_words(base: str) -> list[str]:
    b = re.sub(r"^default(?=[a-z])", "default_", base.lower())  # ("defaultdonquixote")
    return [w for w in re.split(r"[_\s#-]+|(?<=[a-z])(?=\d)|(?<=\d)(?=[a-z])", b) if w]


def _spine_sinner(base: str) -> int | None:
    words = set(_spine_words(base))
    hit = [i + 1 for i, names in enumerate(_SPINE_SINNER_WORDS) if words & set(names)]
    return hit[0] if len(hit) == 1 else None


def spine_owner(base: str, sinner: int, ids: list[dict]) -> int | None:
    """The Identity a Sinner's loose Spine belongs to (by the organisation in its name; none = the LCB Sinner), or None."""
    names = {w for w in _SPINE_SINNER_WORDS[sinner - 1]}
    words = [w for w in _spine_words(base) if w not in names and w not in _SPINE_PARTS and not w.isdigit()]
    if not words:
        return next((x["id"] for x in ids if x["id"] % 100 == 1), None)
    if len(words) != 1 or words[0] not in SPINE_ORGS:
        return None
    hit = [x["id"] for x in ids if SPINE_ORGS[words[0]] in (x.get("title") or "").lower().replace(".", "")]
    return hit[0] if len(hit) == 1 else None


def season_label(bundle: str) -> str:
    """Fallback group of a bundle nothing else could place: the update it shipped with."""
    sm = SEASON_RE.match(bundle)
    if sm:
        yy, mm, dd = sm.group(2), sm.group(3), sm.group(4)
        return f"Season {sm.group(1)} · update {dd}.{mm}.20{yy}"
    return "Launch / shared"
