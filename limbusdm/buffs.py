"""Buff effects (Database → Buff effects): the buffs and debuffs the game's data ties to an effect prefab, who gives or
gets each, and a video of the effect drawn alone by the Unity player.

The ties: static-data/battle-effect rows (keyword → prefab address) and the bundles' effect lists (label → prefab), where
the keyword / label is a buff's id or one of its abilities (ShinEffect shows the one labelled "Shin"). The plain statuses
(Burn, Bleed…) have no effect of their own in the data and are not here. Who has a buff: the Identities, E.G.O and
enemies whose skill / passive rows or texts name it."""
from __future__ import annotations

import json
import os
import re
import shutil
import sqlite3
import threading

from . import units, viewer

VERSION = 1  # bump when the list's layout changes (cached per snapshot) or the videos must be made again
HOST = 10101  # the battle prefab the effects are loaded next to (the player needs one; it is not drawn)
SIZE = (960, 540)
BATCH = 6  # effects per run of the player


def _strings(o, out: set):
    if isinstance(o, str):
        out.add(o)
    elif isinstance(o, dict):
        for v in o.values():
            _strings(v, out)
    elif isinstance(o, list):
        for v in o:
            _strings(v, out)


def _named(o) -> set:
    """The [Keyword] tokens of a record's texts."""
    return set(re.findall(r"\[([A-Za-z0-9_]+)\]", json.dumps(o, ensure_ascii=False)))


def build(svc) -> dict:
    t = svc.static_tables(["battle-effect", "buff", "skill", "passive"])
    buffs = units._records(t, "buff")
    by_ability: dict[str, set] = {}
    for b, e in buffs.items():
        for a in e.get("list") or []:
            if isinstance(a, dict) and a.get("ability"):
                by_ability.setdefault(a["ability"], set()).add(b)

    fx: dict[str, dict] = {}        # effect name → where the player finds it
    links: dict[str, list] = {}     # buff → effect names
    db = sqlite3.connect(svc.ensure_browse())
    try:
        for doc in t.get("battle-effect", {}).values():
            for e in (doc.get("list") if isinstance(doc, dict) else doc) or []:
                if not isinstance(e, dict):
                    continue
                k, addr = e.get("keyword") or "", e.get("address") or ""
                name = addr.rsplit("/", 1)[-1].rsplit(".", 1)[0]
                owners = ({k} & set(buffs)) | by_ability.get(k, set())
                if not name or not owners or "/rpg/" in addr.lower():
                    continue
                if name not in fx:
                    # (the table's path may leave out a folder the bundle has, see viewer.battle_effects)
                    row = db.execute("select bundle, c from o where lower(c) = lower(?) limit 1", (addr,)).fetchone() \
                        or db.execute("select bundle, c from o where lower(c) like ? limit 1", (f"%/{name.lower()}.prefab",)).fetchone()
                    if not row:
                        continue
                    fx[name] = {"asset": row[1], "bundle": row[0]}
                for b in owners:
                    links.setdefault(b, []).append(name)
    finally:
        db.close()
    for label, name, bundle, pid in viewer.effect_lists(svc):
        owners = ({label} & set(buffs)) | by_ability.get(label, set()) | by_ability.get(label + "Effect", set())
        if not name or name == "?" or not owners:
            continue
        fx.setdefault(name, {"asset": f"Assets/Prefab/Effect/Added/{name}.prefab", "bundle": bundle, "pid": pid})
        for b in owners:
            links.setdefault(b, []).append(name)

    # who has it: the rows and texts of each one's skills and passives
    wanted = set(links)
    skills, passives = units._records(t, "skill"), units._records(t, "passive")
    memo: dict[tuple, set] = {}

    def row_buffs(table, rid) -> set:
        if (id(table), rid) not in memo:
            s: set = set()
            _strings(table.get(rid), s)
            memo[(id(table), rid)] = s & wanted
        return memo[(id(table), rid)]

    def of(x) -> set:
        got = _named(x) & wanted
        for s in (x.get("skills") or []) + (x.get("defense") or []):
            got |= row_buffs(skills, s.get("id") if isinstance(s, dict) else s)
        for p in x.get("passives") or []:
            got |= row_buffs(passives, p.get("id") if isinstance(p, dict) else p)
        return got

    who: dict[str, list] = {}
    udb = svc.unit_db()
    for x in udb.get("ids") or []:
        for b in of(x):
            who.setdefault(b, []).append({"k": "id", "id": x["id"], "name": f"{x['title']} {x['sinnerName']}", "pic": x["img"].get("thumb")})
    for x in udb.get("egos") or []:
        for b in of(x):
            who.setdefault(b, []).append({"k": "ego", "id": x["id"], "name": f"{x['name']} ({x['sinnerName']})", "pic": x["img"].get("thumb")})
    edb = svc.enemy_db()
    for e in edb.get("list") or []:
        got: set = set()
        for body in [b for v in e["variants"] for b in [v] + v["parts"]]:
            got |= of(body)
            for key, table in (("skills", "skills"), ("defense", "skills"), ("passives", "passives")):
                for i in body.get(key) or []:
                    info = edb[table].get(i) or edb[table].get(str(i))  # (the cache turns the ids into strings)
                    if info:
                        got |= _named(info) & wanted
        for b in got:
            who.setdefault(b, []).append({"k": "enemy", "id": e["id"], "name": e["name"], "pic": e.get("pic"), "app": e["app"]})

    glossary = udb.get("glossary") or {}
    kinds = {"Positive": "pos", "Negative": "neg"}
    out = []
    for b, names in links.items():
        g = glossary.get(b) or {}
        out.append({"id": b, "name": g.get("name") or "", "desc": g.get("desc") or "", "flavor": g.get("flavor") or "",
                    "type": kinds.get(buffs[b].get("buffType"), "neu"), "icon": g.get("icon"),
                    "fx": list(dict.fromkeys(names)), "who": who.get(b) or []})
    out.sort(key=lambda x: (not x["name"], (x["name"] or x["id"]).lower()))
    return {"v": VERSION, "list": out, "fx": fx}


def effect_bundles(svc, extra: list[dict]) -> list[str]:
    """The bundle files the player needs for these effects (each {"bundle", "asset", "pid"?}): their bundles and all
    these refer to; a patched copy where a prefab has no address of its own."""
    patched = viewer.patched_bundles(svc, extra)
    files = [patched.get(lg) or svc.object_file(lg) for lg in viewer.bundle_closure(svc, sorted({x["bundle"] for x in extra}))]
    return [p for p in files if p]


# effects that are not on the one who has the buff: a field, a mark on the other one or the team, a hit / break
NOT_ON_SELF = re.compile(r"(?i)target|team|_bg|field|map|enemy|hit|broken|burst|projectile")


ON_OTHER = re.compile(r"(?i)target|enemy")


def unit_buffs(svc, uid, limit: int = 3) -> list[dict]:
    """The buff effects of one Identity / E.G.O (its id) or enemy (its appearance prefab's name), as its fights show
    them: the buffs it gives itself on it (who 0), the debuffs it puts on others on the one it fights (who 1). Only
    effects that have a video (known to draw outside the game), at most `limit` a side.
    [{"who", "name", "asset", "bundle", "buff": the buff's name}]"""
    bf = svc.buff_fx
    db = bf.db()
    made = set(bf.status()["have"])
    app = str(uid).rsplit("/", 1)[-1].rsplit(".", 1)[0].lower()

    def has(w):
        return w["id"] == uid if w["k"] != "enemy" else (w.get("app") or "").lower() == app and isinstance(uid, str)

    out, seen, count = [], set(), [0, 0]
    for b in db["list"]:
        if not any(has(w) for w in b["who"]):
            continue
        for n in b["fx"]:
            who = 1 if b["type"] == "neg" or ON_OTHER.search(n) else 0
            if n in seen or viewer._safe_name(n) not in made or count[who] >= limit:
                continue
            seen.add(n)
            count[who] += 1
            out.append(dict(db["fx"][n], name=n, who=who, buff=b["name"] or b["id"], id=b["id"]))
    return out


GIVES = re.compile(r"(?i)(give|take|gain|add)\w*buff")
AT_END = re.compile(r"(?i)end(attack|skill)|succeed|OSA|kill")


def skill_plan(svc, cid, groups: list[dict], own: list[dict]) -> list[dict]:
    """When each of a character's buff effects (`own`, see unit_buffs) comes on in each skill's video, for a render with
    the "buffs" option: [{"who", "name", "asset", "group", "hit"}], hit = which hit of the skill, from 0 (-1: from the
    start). Its own buffs are on from the start of every skill (Vlad: no matching to skills for those). A debuff comes
    on when the skill inflicts it, read from the skill's data (an Identity's video "…_S<n>" is skill <id>*100+n): one a
    coin gives at that coin's hit, one the skill gives on use from the start, after the attack at its last hit; it shows
    only in the skills that inflict it. One no skill is known to inflict (a passive's, an enemy's — its skills can't
    be told from its videos) comes on at the first hit of every skill."""
    skills = units._records(svc.static_tables(["skill"]), "skill") if isinstance(cid, int) and 10000 <= cid < 20000 else {}
    ids = {x["id"] for x in own}
    gives: dict[str, dict] = {}  # group → {buff id: hit}
    for g in groups:
        m = re.search(r"_S(\d+)", g["name"])
        row = skills.get(cid * 100 + int(m.group(1))) if m and skills else None
        if not row or not row.get("skillData"):
            continue
        hits = sum(len((p.get("events") or {}).get("hits") or []) for p in g["parts"])
        data = row["skillData"][-1]
        coins = data.get("coinList") or []
        got: dict = {}

        def take(scripts, hit):
            for a in scripts or []:
                b = (a.get("buffData") or {}).get("buffKeyword")
                if b in ids and GIVES.search(a.get("scriptName") or "") and b not in got:
                    got[b] = hit(a) if hits else -1

        for i, c in enumerate(coins):
            take(c.get("abilityScriptList"), lambda a, i=i: min(hits - 1, i * hits // len(coins)))
        take(data.get("abilityScriptList"), lambda a: hits - 1 if AT_END.search(a.get("scriptName") or "") else -1)
        gives[g["name"]] = got
    known = {b for got in gives.values() for b in got}
    out = []
    for g in groups:
        hits = sum(len((p.get("events") or {}).get("hits") or []) for p in g["parts"])
        got = gives.get(g["name"], {})
        for x in own:
            if x["who"] == 0:
                hit = -1
            elif x["id"] in got:
                hit = got[x["id"]]
            else:
                if x["id"] in known:
                    continue  # (another skill's debuff)
                hit = 0 if hits else -1
            out.append({"who": x["who"], "name": x["name"], "asset": x["asset"], "group": g["name"], "hit": hit})
    return out


HOLD = 3.5  # "a few seconds" (how long an effect stays on with that choice)


def versus_effects(svc, spec: dict, groups: tuple) -> list[dict]:
    """The Versus page's Buffs and Debuffs switches: the effects a fight shows on the two, as lines for the player
    (ViewerBuffs.cs) — {"who": the one it is on, "name", "asset", "bundle", "hold": seconds it stays (0: to the end),
    "by" / "group": see below}. Each switch has the same four choices (spec keys "<buff|debuff>" + both / many / own /
    short): on one side (drawn at random) or both; one or up to three a side; any of the game's (out of the effects
    that have a video, so known to draw outside the game) or only the two's own; to the end of the fight or a few
    seconds. They come on at random moments — but one's own debuff comes with the skill that inflicts it: "by" = the
    one inflicting, "group" = that skill's video ("" where the skill isn't known: any of its skills), on from a hit of it.
    `groups`: each one's skill videos (viewer.job_groups)."""
    import random
    bf = svc.buff_fx
    db = bf.db()
    made = set(bf.status()["have"])
    own = (spec["left"], spec["right"])
    neg = {n for b in db["list"] if b["type"] == "neg" for n in b["fx"]}
    out = []
    for kind in ("buff", "debuff"):
        if not spec.get(kind):
            continue
        rnd = random.Random(int(spec.get("seed") or 0) * 31 + (7 if kind == "buff" else 11))
        sides = [0, 1] if spec.get(kind + "both") else [rnd.randrange(2)]
        n = 3 if spec.get(kind + "many") else 1
        hold = HOLD if spec.get(kind + "short") else 0
        if not spec.get(kind + "own"):
            pool = sorted(k for k in db["fx"] if viewer._safe_name(k) in made and not NOT_ON_SELF.search(k)
                          and (k in neg) == (kind == "debuff"))
            names = rnd.sample(pool, min(len(pool), len(sides) * n))
            out += [dict(db["fx"][k], name=k, who=sides[i % len(sides)], hold=hold) for i, k in enumerate(names)]
        elif kind == "buff":
            if len(sides) == 1:  # (one side: one that has buffs of its own, when only one of the two does)
                has = [s for s in (0, 1) if any(x["who"] == 0 for x in unit_buffs(svc, own[s], 99))]
                sides = [rnd.choice(has)] if has else sides
            for s in sides:
                pool = [x for x in unit_buffs(svc, own[s], 99) if x["who"] == 0]
                out += [dict(x, who=s, hold=hold) for x in rnd.sample(pool, min(len(pool), n))]
        else:
            if len(sides) == 1:  # (one side: one the other has debuffs for)
                has = [s for s in (0, 1) if any(x["who"] == 1 for x in unit_buffs(svc, own[1 - s], 99))]
                sides = [rnd.choice(has)] if has else sides
            for s in sides:  # (the one the debuffs land on; the other one inflicts them)
                by = 1 - s
                mine = {x["name"]: x for x in unit_buffs(svc, own[by], 99) if x["who"] == 1}
                names = rnd.sample(sorted(mine), min(len(mine), n))
                plan = [e for e in skill_plan(svc, own[by], groups[by], [mine[k] for k in names])]
                count: dict = {}
                for e in plan:
                    count[e["name"]] = count.get(e["name"], 0) + 1
                seen = set()
                for e in plan:
                    g = "" if count[e["name"]] >= len(groups[by]) else e["group"]  # (in every skill: not tied to one)
                    if (e["name"], g) not in seen:
                        seen.add((e["name"], g))
                        out.append(dict(mine[e["name"]], who=s, by=by, group=g, hold=hold))
    return out


class BuffFx:
    """The videos: made on request, a few effects per run of the player, kept until the next patch."""

    def __init__(self, svc):
        self.svc = svc
        self.lock = threading.Lock()
        self.queue: list[str] = []
        self.current: list[str] = []
        self.busy = False
        self.error = ""

    def db(self) -> dict:
        sid = self.svc.latest_snapshot_id()
        if not sid:
            return {"list": [], "fx": {}}
        cached = getattr(self, "_db", None)
        if cached and cached[0] == sid:
            return cached[1]
        rel = f"buff_db/{sid}.json.gz"
        db = self.svc.store.read_json(rel)
        if db is None or db.get("v") != VERSION:
            db = build(self.svc)
            self.svc.store.write_json(rel, db)
        self._db = (sid, db)
        return db

    def folder(self) -> str:
        return os.path.join(self.svc.store.root, "buff_fx", f"{self.svc.latest_snapshot_id()}_v{viewer.VERSION}_{VERSION}")

    def _failed(self) -> list[str]:
        try:
            with open(os.path.join(self.folder(), "failed2.json"), encoding="utf-8") as f:
                return json.load(f)
        except (OSError, ValueError):
            return []

    def video(self, name: str) -> str | None:
        path = os.path.join(self.folder(), viewer._safe_name(name) + ".webm")
        return path if os.path.isfile(path) else None

    def status(self) -> dict:
        d = self.folder()
        have = sorted(f[:-5] for f in os.listdir(d) if f.endswith(".webm")) if os.path.isdir(d) else []
        with self.lock:
            return {"have": have, "failed": self._failed(), "queue": len(self.queue) + len(self.current),
                    "current": list(self.current), "busy": self.busy, "error": self.error,
                    "available": bool(viewer.viewer_exe())}

    def start(self, names: list[str] | None = None, first: bool = False):
        """Queue these effects (None: every one not made yet); `first`: ahead of the ones waiting."""
        known = self.db()["fx"]
        st = self.status()
        skip = {viewer._safe_name(n) for n in st["have"]} | {viewer._safe_name(n) for n in st["failed"]}
        with self.lock:
            add = [n for n in dict.fromkeys(names if names is not None else known)
                   if n in known and viewer._safe_name(n) not in skip and n not in self.current]
            if first:
                self.queue = add + [n for n in self.queue if n not in add]
            else:
                self.queue += [n for n in add if n not in self.queue]
            if self.queue and not self.busy:
                self.busy, self.error = True, ""
                threading.Thread(target=self._work, daemon=True).start()

    def _work(self):
        try:
            # videos of another patch or version
            root = os.path.dirname(self.folder())
            for d in os.listdir(root) if os.path.isdir(root) else []:
                if os.path.join(root, d) != self.folder():
                    shutil.rmtree(os.path.join(root, d), ignore_errors=True)
            os.makedirs(self.folder(), exist_ok=True)
            while True:
                with self.lock:
                    self.current, self.queue = self.queue[:BATCH], self.queue[BATCH:]
                    batch = list(self.current)
                    if not batch:
                        self.busy = False
                        return
                try:
                    made = self._render(batch)
                    bad = [n for n in batch if n not in made]  # (drew nothing)
                except Exception:
                    # one effect can bring the player down: each on its own then
                    bad = []
                    for n in batch if len(batch) > 1 else []:
                        with self.lock:
                            self.current = [n]
                        try:
                            if n not in self._render([n]):
                                bad.append(n)
                        except Exception:
                            bad.append(n)
                    if len(batch) == 1:
                        bad = batch
                if bad:
                    bad = sorted(set(self._failed()) | set(bad))
                    with open(os.path.join(self.folder(), "failed2.json"), "w", encoding="utf-8") as f:
                        json.dump(bad, f)
        except Exception as e:
            self.error = str(e)
            with self.lock:
                self.busy, self.current, self.queue = False, [], []

    def _render(self, names: list[str]) -> set[str]:
        svc, fx = self.svc, self.db()["fx"]
        exe, ff = viewer.tools()
        extra = [dict(fx[n], name=n) for n in names]
        job = dict(viewer.make_job(svc, HOST, False), effectKind="")
        have = set(job["bundles"])
        job = dict(job, bundles=job["bundles"] + [p for p in effect_bundles(svc, extra) if p not in have],
                   extraEffects=[{"name": x["name"], "asset": x["asset"]} for x in extra])
        work = os.path.join(self.folder(), "_work")
        shutil.rmtree(work, ignore_errors=True)
        os.makedirs(work)
        try:
            svc.fx._play(exe, ff, job, None, {"effects", "alpha"}, work, {}, {"done": [], "total": 0}, size=SIZE)
            made = set()
            for n in names:
                src = os.path.join(work, viewer._safe_name(n) + ".webm")
                if os.path.isfile(src):
                    os.replace(src, os.path.join(self.folder(), viewer._safe_name(n) + ".webm"))
                    made.add(n)
            return made
        finally:
            shutil.rmtree(work, ignore_errors=True)
