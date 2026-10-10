"""Patches → Change history (ui/history.js): what each patch changed in an Identity, an E.G.O, an enemy or a status —
the numbers and the wording — read back from the reports the app already keeps (so only as far back as they go).

A report's `records.changed[]` gives a record's old and new fields. Which card a record belongs to:
- a skill / passive number listed by an Identity or an E.G.O (the unit list) or by an enemy (the handbook);
  an enemy's skill the handbook doesn't list goes by its number without the last two digits (151706 → unit 1517);
- a status (EN_BattleKeywords / EN_Bufs / buff tables) is a card of its own, and also shown under the cards whose
  changed texts name it.
A text whose only change is the game's highlight markup, and every field without a name of its own here, is "technical":
kept, shown on request.
"""
from __future__ import annotations

import gzip
import json
import os
import re

VERSION = 4
MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split()
NUMS = {"defaultValue": "Base Power", "skillLevelCorrection": "Offense Level", "targetNum": "Atk Weight", "mpUsage": "SP cost"}
GROUPS = ("Skills", "Passives", "Statuses", "Stats")


def clean(s) -> str:
    """The game's text without its markup; [Keyword] stays for the page to draw."""
    return re.sub(r"<[^>]+>", "", str(s or "").replace("[TabExplain]", "")).strip()


def _flat(a, b, pre=""):
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b)):
            yield from _flat(a.get(k), b.get(k), f"{pre}.{k}" if pre else str(k))
    elif isinstance(a, list) and isinstance(b, list) and len(a) == len(b):
        for i, (x, y) in enumerate(zip(a, b)):
            yield from _flat(x, y, f"{pre}[{i}]")
    elif a != b:
        yield pre, a, b


def _short(v) -> str:
    s = json.dumps(v, ensure_ascii=False) if not isinstance(v, str) else v
    return s if len(s) <= 110 else s[:107] + "…"


def _day(sid: str) -> str:
    m = re.match(r"s(\d{4})(\d{2})(\d{2})_", sid or "")
    return f"{int(m.group(3))} {MONTHS[int(m.group(2)) - 1]} {m.group(1)}" if m and 1 <= int(m.group(2)) <= 12 else ""


def _taken(sid: str) -> str:
    m = re.search(r"_(\d{4})(\d{2})(\d{2})-\d{6}$", sid or "")
    return f"{int(m.group(3))} {MONTHS[int(m.group(2)) - 1]}" if m and 1 <= int(m.group(2)) <= 12 else ""


class _Owners:
    """Which card a skill, a passive or a unit number belongs to, and the names to show."""

    def __init__(self, units: dict, enemies: dict):
        self.cards: dict[str, dict] = {}
        self.skill: dict[int, tuple[str, dict]] = {}
        self.passive: dict[int, tuple[str, dict]] = {}
        self.unit: dict[int, str] = {}
        for kind, rows in (("id", units.get("ids") or []), ("ego", units.get("egos") or [])):
            for x in rows:
                key = f"{kind}:{x['id']}"
                name = f"{x.get('title') or ''} {x.get('sinnerName') or ''}".strip() if kind == "id" else f"{x.get('name') or ''} · {x.get('sinnerName') or ''}"
                self.cards[key] = {"kind": kind, "id": x["id"], "name": name, "label": "Identity" if kind == "id" else "E.G.O " + (x.get("grade") or ""),
                                   "pic": (x.get("img") or {}).get("thumb") or ""}
                self.unit[x["id"]] = key
                for s in (x.get("skills") or []) + (x.get("defense") or []):
                    self.skill.setdefault(s["id"], (key, s))
                for p in x.get("passives") or []:
                    self.passive.setdefault(p["id"], (key, p))
        self.en_skills = {int(k): v for k, v in (enemies.get("skills") or {}).items()}
        self.en_passives = {int(k): v for k, v in (enemies.get("passives") or {}).items()}
        for e in enemies.get("list") or []:
            key = f"enemy:{e['id']}"
            self.cards[key] = {"kind": "enemy", "id": e["id"], "name": e.get("name") or f"Unit {e['id']}", "label": e.get("label") or "Enemy",
                               "pic": e.get("pic") or "", "app": e.get("app") or ""}
            for v in e.get("variants") or []:
                for i in v.get("ids") or []:
                    self.unit.setdefault(i, key)
                for part in [v] + (v.get("parts") or []):
                    for s in (part.get("skills") or []) + (part.get("defense") or []):
                        if s in self.en_skills:
                            self.skill.setdefault(s, (key, self.en_skills[s]))
                    for p in part.get("passives") or []:
                        if p in self.en_passives:
                            self.passive.setdefault(p, (key, self.en_passives[p]))

    def of_unit(self, n) -> str | None:
        """An enemy / unit number, or a part's (unit number + two digits)."""
        try:
            n = int(n)
        except (TypeError, ValueError):
            return None
        return self.unit.get(n) or self.unit.get(n // 100)

    def of_skill(self, sid) -> tuple[str | None, str, object]:
        try:
            sid = int(sid)
        except (TypeError, ValueError):
            return None, "", None
        key, s = self.skill.get(sid) or (None, self.en_skills.get(sid))
        key = key or self.of_unit(sid // 100)
        up = (s or {}).get("up") or {}
        name = next((u.get("name") for u in up.values() if u.get("name")), "") or f"Skill {sid}"
        return key, name, (s or {}).get("icon") or sid

    def of_passive(self, pid) -> tuple[str | None, str]:
        try:
            pid = int(pid)
        except (TypeError, ValueError):
            return None, ""
        key, p = self.passive.get(pid) or (None, self.en_passives.get(pid))
        return key or self.of_unit(pid // 100), (p or {}).get("name") or f"Passive {pid}"


def _where(path: str, rec: dict | None) -> str:
    """"levelList[2].coinlist[1].coindescs[0].desc" → "Uptie 3 · Coin 2"."""
    out = []
    m = re.search(r"levelList\[(\d+)\]", path)
    levels = (rec or {}).get("levelList") or []
    if m and len(levels) > 1:
        i = int(m.group(1))
        out.append(f"Uptie {levels[i].get('level', i + 1) if i < len(levels) else i + 1}")
    m = re.search(r"coinlist\[(\d+)\]", path)
    if m:
        out.append(f"Coin {int(m.group(1)) + 1}")
    elif path.endswith("name"):
        out.append("Name")
    else:
        out.append("Description")
    return " · ".join(out)


def _patch(report: dict, own: _Owners, glossary: dict, icons: dict) -> dict:
    """{card key: {"groups": {group: {row id: row}}}} of one report."""
    cards: dict[str, dict] = {}

    def row(key, group, rid, name, icon=None):
        r = cards.setdefault(key, {}).setdefault(group, {}).setdefault(str(rid), {"id": str(rid), "name": name, "nums": [], "texts": [], "tech": [], "new": False})
        if icon is not None:  # a skill's picture by its number, a status's by its path
            r["icon"] = icon if isinstance(icon, str) and "/" in icon else icons.get(str(icon)) or ""
        return r

    def texts(r, c, base="Description"):
        for fld, pair in (c.get("fields") or {}).items():
            if not isinstance(pair, list) or len(pair) != 2:
                continue
            for path, x, y in _flat(pair[0], pair[1], fld):
                if not (isinstance(x, str) or x is None) or not (isinstance(y, str) or y is None):
                    continue
                a, b, w = clean(x), clean(y), _where(path, c.get("record")) if "levelList" in path or "coin" in path else ("Name" if path.endswith("name") else base)
                if a == b:
                    if ["highlight only · " + w, "", ""] not in r["tech"]:
                        r["tech"].append(["highlight only · " + w, "", ""])
                    continue
                same = next((t for t in r["texts"] if t[1] == a and t[2] == b), None)
                if same:  # the same edit at several upties: one line
                    m1, m2 = re.match(r"Uptie ([\d, ]+)(.*)", same[0]), re.match(r"Uptie (\d+)(.*)", w)
                    if m1 and m2 and m1.group(2) == m2.group(2) and m2.group(1) not in m1.group(1).split(", "):
                        same[0] = f"Uptie {m1.group(1)}, {m2.group(1)}{m1.group(2)}"
                    elif not m1 and re.fullmatch(r"Coin \d+", w) and re.fullmatch(r"Coin [\d, ]+", same[0]) and w[5:] not in same[0][5:].split(", "):
                        same[0] += ", " + w[5:]  # the same edit on several coins
                else:
                    r["texts"].append([w, a, b])

    def status(key_id):
        g = glossary.get(key_id) or {}
        return row(f"buff:{key_id}", "Statuses", key_id, g.get("name") or str(key_id), g.get("icon") or "")

    for sec in ("texts", "data"):
        for e in (report.get("sections") or {}).get(sec) or []:
            path, rec = e.get("path") or "", e.get("records") or {}
            fn = path.rsplit("/", 1)[-1]
            changed, added = rec.get("changed") or [], rec.get("added") or []
            if "/Localize/en/" in path:
                if fn.startswith("EN_Skills"):
                    for c in changed:
                        key, name, icon = own.of_skill(c.get("id"))
                        if key:
                            texts(row(key, "Skills", c["id"], name, icon), c)
                elif fn.startswith("EN_Passive"):
                    for c in changed:
                        key, name = own.of_passive(c.get("id"))
                        if key:
                            texts(row(key, "Passives", c["id"], name), c)
                elif fn.startswith(("EN_BattleKeywords", "EN_Bufs")):
                    for c in changed:
                        r = status(c.get("id"))
                        if not r["texts"]:
                            texts(r, c)
                continue
            m = re.search(r"/static-data/([\w-]+)/", path)
            folder = m.group(1) if m else ""
            if folder == "skill":
                for c in changed:
                    key, name, icon = own.of_skill(c.get("id"))
                    if not key:
                        continue
                    r = row(key, "Skills", c["id"], name, icon)
                    for fld, pair in (c.get("fields") or {}).items():
                        for p, x, y in _flat(pair[0], pair[1], fld):
                            m2 = re.fullmatch(r"skillData\[(\d+)\]\.(\w+)", p)
                            m3 = re.fullmatch(r"skillData\[(\d+)\]\.coinList\[(\d+)\]\.scale", p)
                            lv = len((c.get("record") or {}).get("skillData") or []) > 1
                            pre = lambda i: f"Uptie {((c['record']['skillData'][int(i)]).get('gaksungLevel') or int(i) + 1)} · " if lv else ""  # noqa: E731
                            if m2 and m2.group(2) in NUMS and isinstance(x, (int, float, type(None))) and isinstance(y, (int, float, type(None))):
                                r["nums"].append([pre(m2.group(1)) + NUMS[m2.group(2)], x or 0, y or 0])
                            elif m3 and isinstance(x, (int, float)) and isinstance(y, (int, float)):
                                r["nums"].append([f"{pre(m3.group(1))}Coin {int(m3.group(2)) + 1} Power", x, y])
                            else:
                                r["tech"].append([re.sub(r"^skillData\[0\]\.", "", p), _short(x), _short(y)])
            elif folder in ("passive", "personality-passive"):
                for a in added:
                    key, name = own.of_passive(a.get("id"))
                    if key and folder == "passive":
                        r = row(key, "Passives", a["id"], name)
                        r["new"] = True
                        desc = clean((own.en_passives.get(a["id"]) or (own.passive.get(a["id"]) or (None, {}))[1]).get("desc"))
                        if desc and not r["texts"]:
                            r["texts"].append(["Description", "", desc])
                for c in changed:
                    key, name = own.of_passive(c.get("id"))
                    if key and folder == "passive":
                        r = row(key, "Passives", c["id"], name)
                        for fld, pair in (c.get("fields") or {}).items():
                            for p, x, y in _flat(pair[0], pair[1], fld):
                                r["tech"].append([p, _short(x), _short(y)])
            elif folder == "buff":
                for c in changed:
                    r = status(c.get("id"))
                    for fld, pair in (c.get("fields") or {}).items():
                        for p, x, y in _flat(pair[0], pair[1], fld):
                            r["tech"].append([p, _short(x), _short(y)])
            elif folder in ("personality", "ego", "enemy", "abnormality-unit", "abnormality-part"):
                for c in changed:
                    key = own.of_unit(c.get("id"))
                    if not key:
                        continue
                    r = row(key, "Stats", "stats", "Stats")
                    for fld, pair in (c.get("fields") or {}).items():
                        for p, x, y in _flat(pair[0], pair[1], fld):
                            r["tech"].append([p, _short(x), _short(y)])
    # a status changed in this patch is also shown under the cards whose changed texts name it
    for key, groups in list(cards.items()):
        if key.startswith("buff:"):
            continue
        said = " ".join(t[1] + " " + t[2] for g in groups.values() for r in g.values() for t in r["texts"])
        for k2, g2 in cards.items():
            if k2.startswith("buff:") and f"[{k2[5:]}]" in said:
                groups.setdefault("Statuses", {}).update(g2["Statuses"])
    return cards


def build(reports: list[dict], load, units: dict, enemies: dict, icons: dict) -> dict:
    """{"patches": [{id, day, taken, cards: {key: {real, groups: [{kind, rows}]}}}] newest first, "cards": {key: {…}}}.
    reports: Service.reports(); load(report id) → the report; icons: {skill picture's name: asset path}."""
    own, glossary = _Owners(units, enemies), units.get("glossary") or {}
    patches, used = [], {}
    for rp in reports:
        try:
            cards = _patch(load(rp["id"]), own, glossary, icons)
        except Exception:
            continue
        out = {}
        for key, groups in cards.items():
            gs = [{"kind": g, "rows": sorted(groups[g].values(), key=lambda r: r["id"])} for g in GROUPS if groups.get(g)]
            real = sum(1 for g in gs for r in g["rows"] if r["nums"] or r["texts"] or r["new"])
            if not gs:
                continue
            out[key] = {"real": real, "groups": gs}
            if key.startswith("buff:"):
                g = glossary.get(key[5:]) or {}
                used[key] = {"kind": "buff", "id": key[5:], "name": g.get("name") or key[5:], "label": "Status", "pic": g.get("icon") or ""}
            else:
                used[key] = own.cards[key]
        if out:
            patches.append({"id": rp["id"], "day": _day(rp["new"]) or rp["new"], "from": _day(rp["old"]), "taken": _taken(rp["new"]), "cards": out})
    return {"patches": patches, "cards": used}


def load_report(data_dir: str, rid: str) -> dict:
    with gzip.open(os.path.join(data_dir, "reports", rid + ".json.gz"), "rt", encoding="utf-8") as f:
        return json.load(f)
