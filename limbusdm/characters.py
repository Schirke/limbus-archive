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
        """slot: how the game shows that skill ("Skill 3.2", "Defense" — Service.skill_slots), else "Skill <n>"."""
        if kind == "skill":
            if str(owner).startswith("1"):
                name = self.skills.get(owner * 100 + n)
                return (slot or f"Skill {n}") + (f" · {name}" if name else "")
            # E.G.O: S1 awakening (..11), S2 corrosion (..21)
            name = self.skills.get(owner * 100 + n * 10 + 1)
            return {1: "Awakening", 2: "Corrosion"}.get(n, f"Skill {n}") + (f" · {name}" if name else "")
        return clip_name.rsplit("_", 1)[-1] if kind == "pose" else clip_name


def owner_bundles(bundles, cid: int) -> list[str]:
    """Bundles named after an Identity (p10315_…) or E.G.O (e20405_…, e20402-5_…). Early E.G.O have none of those:
    their skills' effect bundles are named <id><skill> (2010121 = 20101 + 21) or …_<id>_ego_…"""
    s = str(cid)
    p = ("p" if s.startswith("1") else "e") + s
    ego_skill = re.compile(rf"^{s}\d{{2}}_assets_all$")
    return sorted(b for b in bundles if b == f"{p}_assets_all" or b.startswith((p + "_", p + "-")) or b == f"sd_{p}_assets_all"
                  or (p[0] == "e" and (ego_skill.match(b) or f"_{s}_ego" in b)))


# ------------------------------------------------------------------ content labels
SEASON_RE = re.compile(r"^s(\d+)_(\d{2})(\d{2})(\d{2})")
# labels match the ones content.py builds from the stage tables, so both land in the same group
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


def season_label(bundle: str) -> str:
    """Fallback group of a bundle nothing else could place: the update it shipped with."""
    sm = SEASON_RE.match(bundle)
    if sm:
        yy, mm, dd = sm.group(2), sm.group(3), sm.group(4)
        return f"Season {sm.group(1)} · update {dd}.{mm}.20{yy}"
    return "Launch / shared"
