"""The Versus fight engine (with "Exchanges"): a seeded mini auto-battler that decides the whole fight before anything
is drawn, and the script the player acts out. The player decides nothing on its own: who runs in, who loses a clash,
when they spring apart and how far, what lands and how much it hurts all come from here.

Simplified Limbus rules (not the full game):
- an exchange: 2-5 clashes blow after blow (the pacing of the game's looped story fight, Canto 7 Don vs Bari); in each
  both flip the coins of the skill they picked (heads 50:50: + coin power), the lower power loses it, is knocked back
  and the winner runs at it;
- then, if both won as many clashes, nobody is hit (a stand-off — springing apart only if they are still up close),
  else the one that won more lands its skill with all its coins (a later skill: a close-up on its wind-up); a skill
  over "finisher_from" seconds never plays in the fight, and the killing blow is always the longest skill; each
  coin's power x the other one's resistance to its damage type is damage; now and then the other one guards (its defense skill's roll off the damage) or evades (a
  coin its roll beats misses);
- knockback: each blow's forcePower from the game's data (0: none, below 0: pulled in), small ones made clearly
  visible (see knock_bodies), big ones about as before;
- range (close / mid / far): nearly every weapon is a close one, so they run in first; a skill's own dashes are
  slashes flying past the other one, not a way in;
- the stage has walls: a knockback into one bounces off it, and the one pinned there wins its next clash 70 % of the
  time, pushing the fight back out.

Every number the fight goes by is in RULES. Positions are in body heights from the stage's middle (the player's: two
bodies' average height; see Viewer.cs ClashGap / NearGap / StandoffGap / Wall)."""
import json
import math
import os
import random
import re

from . import units as U
from . import viewer as V

RULES = {
    # spacing (body heights)
    "clash_gap": 0.9,        # face to face in a clash
    "near_gap": 2.3,         # a stand-off at its shortest (a run in away)
    "standoff_gap": 3.4,     # a stand-off at its widest
    "wall": 6.0,             # how far from the stage's middle anyone gets
    "close": 1.4, "mid": 2.6,  # a gap up to "close" is close range, up to "mid" mid, past it far
    "loser_push": 1.2,       # a clash round's loser knocked back this far
    "kb_min": 0.8, "kb_log": 0.75, "kb_ref": 4,  # a blow's knockback: kb_min + kb_log x ln(1 + force / kb_ref) (knock_bodies)
    "kb_max": 3.5,           # a blow's knockback at most
    "wall_bounce": 0.4, "wall_bounce_max": 0.5,  # into a wall: back off it by this share of the rest, at most this far
    "edge_room": 1.1, "edge_win": 0.7,  # pinned (closer to the wall behind it): wins its next clash this often
    # the fight
    "heads": 0.5,            # a coin's chance of heads
    "max_coins": 5,          # a skill's coins at most (a nine-coin skill would end a mini fight in one blow)
    "hp_per_clash": 3,       # HP scaled to the number of clashes: this many per clash
    "hp_ratio": 4 / 3,       # the tougher one at most this much tougher
    "landing_cap": 0.4,      # one landing takes at most this share of the HP
    "exchange": (2, 5),      # clashes in an exchange
    "defend_p": 0.3,         # the loser guards or evades what lands
    "guard_evade": (2, 1),   # with no defense skill of its own: guard : evade
    "plain_guard": {"base": 5, "coin": 3, "coins": 1},
    # skill choice
    "deck": (3, 2, 1),       # skill weights by skill order (later ones: the last weight)
    "finisher_from": 6.0,    # seconds: longer skills never play in the fight (its killing blow is the longest skill)
    "close_first": 3,        # up close the first skill this much likelier
    "clash_span": 0.8, "clash_reach": 3.5,  # a skill's coin as a clash (series): its blows within this many seconds, landing this close (world units; see clashable)
    # timing (seconds)
    "standoff_hold": (0.25, 0.45), "recover_hold": (0.4, 0.7), "clash_pause": (0.0, 0.03),
    # a clash played a little slower (never faster) so it can be followed: this speed, and slower still for a quick one
    # (its blow less than clash_quick seconds in, down to clash_slowest)
    "clash_speed": 0.9, "clash_quick": 0.3, "clash_slowest": 0.75,
}
LEVEL = 50  # both sides' level (HP = the data's base + per level x LEVEL)


def range_of(gap: float, R=RULES) -> str:
    return "close" if gap <= R["close"] else "mid" if gap <= R["mid"] else "far"


# ------------------------------------------------------------------ the two fighters from the game's data

def _tables(svc):
    t = getattr(svc, "_vs_tables", None)
    if t is None:
        st = svc.static_tables(["enemy", "abnormality-unit", "skill"])
        t = (U._records(st, "skill"), [r for f in ("enemy", "abnormality-unit") for r in U._records(st, f).values() if isinstance(r, dict)])
        svc._vs_tables = t
    return t


def _skill(sid, skills) -> dict | None:
    i = U.skill_info(sid, skills, {})
    if not i:
        return None
    u = i["up"][max(i["up"])]  # (its highest uptie)
    coin = u["coin"] or 0
    if (u["op"] or "ADD") in ("SUB", "MINUS"):
        coin = -abs(coin)
    return {"id": sid, "base": u["base"] or 0, "coin": coin, "coins": max(1, min(RULES["max_coins"], u["coins"] or 1)),
            "atk": u["atk"] or "", "def": u["def"] or "Attack"}


def knock_bodies(force: float, scale: float = 2.0, R=RULES) -> float:
    """How far (body heights) a blow of the game's forcePower throws the one hit, at the Knockback setting `scale` (2 =
    as is): 0 none; pushes kb_min + kb_log x ln(1 + force / kb_ref) — small forces (1-3, most skills) clearly visible,
    big ones about as before; pulls (below 0) as the data says. Viewer.cs Knock uses the same curve."""
    if force > 0:
        d = R["kb_min"] + R["kb_log"] * math.log(1 + force / R["kb_ref"])
    else:
        d = force / 15 * 1.2
    return max(-R["kb_max"], min(R["kb_max"], d * scale / 2))


def _last_force(parts: list[dict]) -> float:
    """The game's forcePower of a part's last blow (the one that throws)."""
    hits = [h for t in parts for h in t["events"].get("hits") or [] if not h.get("tick")]
    return hits[-1].get("force") or 0.0 if hits else 0.0


def clashable(t: dict) -> bool:
    """A skill's coin that can stand in for a clash: its blows close together (within clash_span seconds — not a
    combo stretched over seconds) and landing up close: the other one at most clash_reach in front of it when the first
    blows land (a "wide" dash to a point that far before the other one, then a shot or a thrown chain from there, or a
    step back before the next shot, is a blow from afar — a clash nobody stands in). Its moves before each blow say
    where it is: "wide" that far before the other one, "to the target" its radius away, "relative" on from there
    (forward: closer)."""
    hits = sorted(h["t"] for h in t["events"].get("hits") or [] if not h.get("tick"))
    if not hits or hits[-1] - hits[0] > RULES["clash_span"]:
        return False
    moves = sorted(t["events"].get("moves") or [], key=lambda m: m["t"])
    for h in hits:
        d = 0.0  # (no move of its own: they meet face to face first)
        for m in moves:
            if m["t"] > h + 1e-3:
                break
            x = (m.get("pos") or [0])[0]
            d = x if m["kind"] == "wide" else d - x if m["kind"] == "relative" else m.get("radius") or 0.0
        if abs(d) > RULES["clash_reach"]:  # (too far before it, or dashed on through it and far beyond)
            return False
    return True


def pack_for(svc, cid) -> dict:
    """data/versus_pack.json: the attack set of an Identity / enemy (its entry is keyed by id or prefab name):
    {"skills": [entry, ...], "bonus": [entry, ...]}. An entry: {"name": the skill's name in the fight, "from": a skill
    group (all its timelines) or "parts": [timeline names, repeats allowed], "stats": the group whose numbers (base,
    coin, atk) it fights with (default "from"), "coins": its coins (default: its timelines with a blow, at most the
    stats' coins)}. "skills" replace the deck (in order: the first is the likeliest); "bonus" are kept apart
    (fighter["bonus"]) for the Versus page to offer. Nothing for a unit: all its skills."""
    try:
        with open(os.path.join(svc.store.root, "versus_pack.json"), encoding="utf-8") as f:
            d = json.load(f)
    except (OSError, ValueError):
        return {}
    e = d.get(str(cid)) if isinstance(d, dict) else None
    return e if isinstance(e, dict) else {}


def _pack_skill(e: dict, by: dict, timelines: dict, skills_t) -> dict | None:
    """One entry of a pack (see pack_for). "id": the data's skill id whose numbers it fights with (an Identity's skill
    S<n> is id <unit id>0<n>: the k-th animation is NOT the k-th attack of the data — counters, guards and spare
    versions sit among them); else the numbers of the "stats" group (an enemy's: k-th animation = k-th attack)."""
    src = by.get(e.get("stats") or e.get("from")) or (next(iter(by.values()), None) if e.get("id") else None)
    names = e.get("parts") or (by[e["from"]]["parts"] and [t["name"] for t in by[e["from"]]["parts"]] if e.get("from") in by else [])
    parts = [timelines[n] for n in names if n in timelines]
    if not parts or not src:
        return None
    hit = [t for t in parts if t["events"].get("hits")] or parts
    d = {k: v for k, v in src.items() if k not in ("group", "parts", "lastForce", "coinForce", "seconds")}
    if e.get("id"):
        own = _skill(e["id"], skills_t)
        if own:
            d.update(own)
    else:
        d["coins"] = max(1, min(src["coins"], len(hit)))
    if e.get("coins"):
        d["coins"] = int(e["coins"])
    return dict(d, group=e["name"], parts=parts, lastForce=_last_force(parts), coinForce=_last_force(hit[-1:]),
                seconds=round(sum(V.part_length(t) for t in parts), 2))


def fighter(svc, cid, name: str = "", skills_clash: bool = False) -> dict:
    """One side: {"name", "cid", "job", "hp", "resist": {"Slash": x, ...}, "guard", "counter" (its counter skill's
    numbers, if the data has one),
    "skills": [...], "anims": [clash animations]}. Each skill: {"group", "parts" (its coins' timelines, with hits),
    "base", "coin", "coins", "atk", "lastForce" (its last blow's forcePower; a strike's: its last coin's), "seconds"}. An Identity's
    numbers come from the unit database, an enemy's from the enemy tables; a skill the data doesn't name gets a plain
    one. anims: what it clashes with — its clash animations, or (skills_clash) its first skill's coins and them;
    parries: its clash animations alone; skillsClash: (skills_clash) a series clashes with any skill's coins too (see
    Deck.clash)."""
    job = V.make_job(svc, cid)
    if name == cid:
        name = ""  # (an enemy listed by its prefab: named below)
    groups = [g for g in V.job_groups(job) if V.SKILL_GROUP_RE.search(g["name"])]
    groups = [g for g in groups if any(t["events"].get("hits") for t in g["parts"])]
    skills_t, enemies = _tables(svc)
    data, guard, counter = [], None, None
    hp, resist = 150, {}
    if isinstance(cid, int):
        x = next((i for i in svc.unit_db()["ids"] if i["id"] == cid), None)
        if x:
            name = name or f"{x['sinnerName']} {x['title']}"
            hp = (x.get("hp") or 70) + (x.get("hpLevel") or 2.5) * LEVEL
            resist = dict(x.get("resist") or {})
            data = [d for d in (_skill(s["id"], skills_t) for s in sorted(x["skills"], key=lambda s: s.get("tier") or 9)) if d]
            defs = [d for d in (_skill(s["id"], skills_t) for s in x.get("defense") or []) if d]
            guard = next((d for d in defs if d["def"] in ("Guard", "Evade")), None)
            counter = next((d for d in defs if d["def"] == "Counter"), None)
    else:
        rs = [r for r in enemies if r.get("appearance") == cid]

        def score(r):  # (the record whose attack skills match the animations best, then the toughest)
            n = sum(1 for a in r.get("attributeList") or [] if (_skill(a.get("skillId"), skills_t) or {}).get("def") == "Attack")
            return (-abs(n - len(groups)), (r.get("hp") or {}).get("defaultStat") or 0)
        r = max(rs, key=score) if rs else None
        if r:
            h = r.get("hp") or {}
            hp = (h.get("defaultStat") or 70) + (h.get("incrementByLevel") or 2.5) * LEVEL
            resist = {U.ATK.get(a.get("type"), a.get("type")): a.get("value") for a in (r.get("resistInfo") or {}).get("atkResistList") or []}
            got = [d for d in (_skill(a.get("skillId"), skills_t) for a in r.get("attributeList") or []) if d]
            data = [d for d in got if d["def"] == "Attack"]
            guard = next((d for d in got if d["def"] in ("Guard", "Evade")), None)
            defs = got + [d for d in (_skill(s, skills_t) for s in r.get("defenseSkillIDList") or []) if d]
            guard = guard or next((d for d in defs if d["def"] in ("Guard", "Evade")), None)
            counter = next((d for d in defs if d["def"] == "Counter"), None)
        name = name or re.sub(r"^\d+_|Appearance$", "", str(cid)).replace("_", " ")
    skills = []
    for k, g in enumerate(groups):
        # (the k-th animation is the k-th attack skill of the data; more animations than skills reuse the last)
        d = dict(data[min(k, len(data) - 1)]) if data else {"base": 4, "coin": 3, "coins": 2, "atk": ""}
        parts = [t for t in g["parts"] if t["events"].get("hits")] or g["parts"]
        skills.append(dict(d, group=g["name"], parts=g["parts"], lastForce=_last_force(g["parts"]), coinForce=_last_force(parts[-1:]),
                           seconds=round(sum(V.part_length(t) for t in g["parts"]), 2)))
    bonus, counter_sk = [], None
    pk = pack_for(svc, cid)
    if pk:
        by = {s["group"]: s for s in skills}
        tl = {t["name"]: t for t in job["timelines"]}
        skills = [x for x in (_pack_skill(e, by, tl, skills_t) for e in pk.get("skills") or []) if x] or skills
        bonus = [x for x in (_pack_skill(e, by, tl, skills_t) for e in pk.get("bonus") or []) if x]
        counter_sk = pk.get("counter") and _pack_skill(pk["counter"], by, tl, skills_t)
    # (not one that leaps back away from the other one: its blow would land in the air, far off — Sancho's p3_3)
    anims = sorted((t for t in job["timelines"] if V.is_clash(t["name"])
                    and sum(m["pos"][0] for m in t["events"]["moves"] if m["kind"] == "relative") > -1), key=lambda t: t["name"])
    parries = list(anims)
    if skills_clash and skills:
        # (a clash is a quick exchange of blows: the first skill's coins that land within a second and a half)
        quick = [t for t in skills[0]["parts"] if t["events"].get("hits") and max(h["t"] for h in t["events"]["hits"]) <= 1.5]
        anims = (quick or skills[0]["parts"]) + anims
    return {"name": name, "cid": cid, "job": job, "hp": round(hp),
            "resist": resist, "skills": skills, "bonus": bonus, "counterSkill": counter_sk or None, "anims": anims, "parries": parries, "skillsClash": bool(skills_clash and skills),
            "guard": guard and {"kind": "Evade" if guard["def"] == "Evade" else "Guard", "base": guard["base"],
                                "coin": guard["coin"], "coins": guard["coins"]},
            "counter": counter and {k: counter[k] for k in ("base", "coin", "coins", "atk")}}


# ------------------------------------------------------------------ choosing (the deck)

class Deck:
    """What a side picks: a skill for each exchange (weights by skill order, never the same twice in a row, up close
    the first one likelier) and a clash animation for each clash round (never the same twice in a row)."""

    def __init__(self, f: dict, rnd: random.Random, R=RULES):
        self.f, self.rnd, self.R = f, rnd, R
        self.last_skill = self.last_anim = None
        self.anim_uses: dict[str, int] = {}

    def _pick_anim(self, pool: list) -> dict:
        """A clash animation from pool: never the same twice in a row, and none more than twice in the fight (when all
        have had two, the least used ones)."""
        n = self.anim_uses
        left = [t for t in pool if n.get(t["name"], 0) < 2] or [t for t in pool if n.get(t["name"], 0) == min(n.get(u["name"], 0) for u in pool)]
        cand = [t for t in left if t["name"] != self.last_anim] or left
        t = self.rnd.choice(cand)
        self.last_anim = t["name"]
        n[t["name"]] = n.get(t["name"], 0) + 1
        return t

    def skill(self, rng: str, long_max: float = 99.0) -> dict:
        """A skill for an exchange: not one longer than long_max seconds (those are finishers), unless all are."""
        sk = [s for s in self.f["skills"] if s["seconds"] <= long_max] or self.f["skills"]
        cand = [s for s in sk if s is not self.last_skill] or sk
        w = self.R["deck"]
        weights = [w[min(sk.index(s), len(w) - 1)] * (self.R["close_first"] if rng == "close" and s is sk[0] else 1) for s in cand]
        self.last_skill = self.rnd.choices(cand, weights=weights)[0]
        return self.last_skill

    def finisher(self, long_max: float) -> dict:
        """The skill that ends the fight: its longest one."""
        return max(self.f["skills"], key=lambda s: s["seconds"])

    def clash_skill(self, long_max: float = 99.0) -> dict:
        """(series) The skill a clash is fought with: weights by skill order (3 : 2 : 1, the first one most), the
        same one again allowed — not one longer than long_max seconds, unless all are."""
        sk = [s for s in self.f["skills"] if s["seconds"] <= long_max] or self.f["skills"]
        w = self.R["deck"]
        self.last_skill = self.rnd.choices(sk, weights=[w[min(k, len(w) - 1)] for k in range(len(sk))])[0]
        return self.last_skill

    def clash(self, sk: dict) -> dict | None:
        """(series) What it clashes with for skill sk: ("Skills instead of clash animations") a coin of that skill that
        can (see clashable), and for its first skill its clash animations too (a skill without such a coin: them
        alone); else its clash animations. Never the same one twice in a row, none more than twice in a fight."""
        pool = list(self.f["parries"])
        if self.f.get("skillsClash"):
            coins = [t for t in sk["parts"] if clashable(t)]
            pool = coins + pool if sk is self.f["skills"][0] else coins or pool
        if not pool:
            return self.anim()
        return self._pick_anim(pool)

    def counter_coin(self) -> dict | None:
        """The coin it strikes back with (a counter): one of its first skill's that can stand in for a clash (see
        clashable), else its first one with hits."""
        if not self.f["skills"]:
            return None
        parts = self.f["skills"][0]["parts"]
        cand = [t for t in parts if clashable(t)] or [t for t in parts if t["events"].get("hits")][:1]
        return self.rnd.choice(cand) if cand else None

    def anim(self) -> dict | None:
        a = self.f["anims"]
        if not a:
            return None
        return self._pick_anim(a)


# ------------------------------------------------------------------ the fight

class Fight:
    """One fight, step by step. steps: what happened, one dict per beat — act ("stand-off", "run-in", "clash",
    "strike", "whole", "final"), who (0 left, 1 right, -1 both), the skill / animations, powers, the loser,
    defense, damage, and after it both positions (x), HP and the range before / after."""

    def __init__(self, a: dict, b: dict, seed: int, opts: dict, R=RULES):  # noqa: C901
        self.F, self.R, self.o, self.seed = (a, b), R, opts, seed
        self.rnd = random.Random(seed)
        self.decks = (Deck(a, self.rnd, R), Deck(b, self.rnd, R))
        self.rounds = int(opts.get("rounds") or 20)
        self.bmax = float(opts.get("burstMax") or 3) if opts.get("bursts") else 0.0
        # skills longer than this never play in the fight; the killing blow is the longest one
        self.long_max = R["finisher_from"]
        self.kbs = float(opts.get("kbscale") or 2)
        # (HP scaled so the fight runs about `rounds` clashes; a boss's thousands would never run out)
        mean = (a["hp"] * b["hp"]) ** 0.5
        self.max = [max(1, round(self.rounds * R["hp_per_clash"] * min(R["hp_ratio"], max(1 / R["hp_ratio"], f["hp"] / mean)))) for f in (a, b)]
        self.hp = list(self.max)
        self.x = [-R["standoff_gap"] / 2, R["standoff_gap"] / 2]
        self.defended = [0, 0]
        self.clashes = 0
        self.steps = []

    # --- where they stand
    def gap(self):
        return abs(self.x[1] - self.x[0])

    def facing(self, i):  # the way side i faces (towards the other one)
        return 1.0 if self.x[1 - i] >= self.x[i] else -1.0

    def room(self, i):  # between side i and the wall behind it
        return self.R["wall"] + self.x[i] * self.facing(i)

    def off_wall(self, x):
        over = abs(x) - self.R["wall"]
        if over <= 0:
            return x
        return (1 if x > 0 else -1) * (self.R["wall"] - min(over * self.R["wall_bounce"], self.R["wall_bounce_max"]))

    def meet(self, runs: int):
        """A run in: `runs` (0 / 1) runs at the other one, -1 both meet in the middle; face to face, inside the walls."""
        g, w = self.R["clash_gap"], self.R["wall"]
        if runs >= 0:
            self.x[runs] = self.x[1 - runs] - self.facing(runs) * g
        else:
            m = max(-w + g / 2, min(w - g / 2, (self.x[0] + self.x[1]) / 2))
            s = self.facing(0)
            self.x = [m - s * g / 2, m + s * g / 2]

    def apart(self) -> float:
        """Both spring apart to a stand-off around where they are (inside the walls); the gap."""
        g = max(self.R["near_gap"], min(self.R["standoff_gap"], self.gap()))
        w = self.R["wall"]
        m = max(-w + g / 2, min(w - g / 2, (self.x[0] + self.x[1]) / 2))
        s = self.facing(0)
        self.x = [m - s * g / 2, m + s * g / 2]
        return g

    def knock(self, i, d):
        """Side i thrown back by d (pulled in below 0, never through the other one); off a wall it bounces."""
        o, away = self.x[1 - i], -self.facing(i)
        to = self.x[i] + away * max(-self.R["kb_max"], min(self.R["kb_max"], d))
        if (to - o) * away < self.R["clash_gap"] * 0.4:
            to = o + away * self.R["clash_gap"] * 0.4
        self.x[i] = self.off_wall(to)

    # --- the record
    def log(self, act, who, before, **kw):
        self.steps.append(dict(act=act, who=who, rng=[before, range_of(self.gap(), self.R)], x=[round(v, 2) for v in self.x],
                               hp=list(self.hp), **kw))

    # --- the rules
    def flip(self) -> bool:
        return self.rnd.random() < self.R["heads"]

    def roll(self, sk, coins) -> int:
        return sk["base"] + sum(sk["coin"] for _ in range(coins) if self.flip())

    def hurt(self, i, dmg, atk, most) -> int:
        """Side i takes dmg x its resistance to atk (at most `most`)."""
        mult = self.F[i]["resist"].get(atk, 1.0) or 1.0
        d = min(most, max(1, round(dmg * mult)))
        self.hp[i] = max(0, self.hp[i] - d)
        return d

    def land(self, w, sk, coins, whole, defense=None, lethal=True):
        """w lands `coins` coins of sk on the other one (guard: its roll off the damage; evade: a coin its roll beats
        misses); the other one is thrown back by the blow(s). Not `lethal`: it is left at least 1 HP."""
        d = 1 - w
        before = range_of(self.gap(), self.R)
        g = (self.F[d]["guard"] or self.R["plain_guard"]) if defense else None
        shield = self.roll(g, g["coins"]) if defense == "Guard" else 0
        total, missed, power, broken = 0, 0, sk["base"], False
        cap = round(self.max[d] * self.R["landing_cap"])
        if not lethal:
            cap = min(cap, self.hp[d] - 1)
        for _ in range(coins):
            if self.flip():
                power += sk["coin"]
            if defense == "Evade" and not broken:
                if self.roll(g, g["coins"]) > power:
                    missed += 1
                    continue
                broken = True  # (the evade broken: the rest land)
            dmg = max(0, power - shield) if defense == "Guard" else power
            shield = max(0, shield - power) if defense == "Guard" else 0
            if dmg <= 0 or total >= cap:
                continue
            total += self.hurt(d, dmg, sk["atk"], cap - total)
        if missed < coins:
            self.knock(d, knock_bodies(sk["lastForce"] if whole else sk["coinForce"], self.kbs) * (0.5 if defense == "Guard" else 1))
        res = f"{total} damage" + (f", {missed} of {coins} dodged" if defense == "Evade" else "") + (", blocked" if defense == "Guard" else "") \
            + (", taken to strike back" if defense == "Counter" else "")
        final = self.hp[d] <= 0
        if final:
            res += f", #{d} falls"
            sk = self.decks[w].finisher(self.long_max)  # (the killing blow: its longest skill)
            coins = sk["coins"]
        self.log("whole" if whole else "strike", w, before, skill=sk["group"], sk=sk, coins=coins, dmg=total,
                 dmgShare=total / self.max[d], defense=defense, result=res, final=final)
        return final

    def defense(self, d) -> str:
        """How side d meets a blow it doesn't clash: ("defend") guards or evades — its own defense skill's kind, else
        guard : evade 2 : 1 — or ("counter") takes it and strikes back; with both on a counter a third of the time
        (half the time when the data gives it a counter skill)."""
        o, R, rnd = self.o, self.R, self.rnd
        if o.get("counter") and (not o.get("defend") or rnd.random() < (0.5 if self.F[d].get("counter") else 1 / 3)):
            return "Counter"
        g = self.F[d]["guard"]
        return g["kind"] if g else rnd.choices(["Guard", "Evade"], weights=R["guard_evade"])[0]

    def counter(self, d, w):
        """Side d, just hit, strikes back at w without a clash: one coin (its counter skill's numbers, else its first
        skill's), w thrown back by it; never the killing blow."""
        R = self.R
        anim = self.decks[d].counter_coin()
        if anim is None:
            return
        c = self.F[d].get("counter") or self.F[d]["skills"][0]
        b4 = range_of(self.gap(), R)
        self.meet(d)
        self.log("run-in", d, b4, result="strikes back")
        power = self.roll(c, c["coins"])
        dmg = self.hurt(w, power, c.get("atk") or "", min(round(self.max[w] * R["landing_cap"]), self.hp[w] - 1)) if self.hp[w] > 1 else 0
        self.knock(w, knock_bodies(_last_force([anim]), self.kbs))
        self.log("counter", d, b4, skill=self.F[d]["skills"][0]["group"], anim=anim, dmg=dmg, dmgShare=dmg / self.max[w],
                 result=f"strikes back: {dmg} damage")

    def fewer(self, counts, sides=(0, 1)):
        """The side that had fewer of them so far (a tie: either)."""
        m = min(counts[x] for x in sides)
        return self.rnd.choice([x for x in sides if counts[x] == m])

    def final_skill(self, w) -> dict:
        """The winner's last skill: ("randskill") one of its own that ends within 4.5 s (else its shortest), or the
        one picked for it (opts "finals": the left / right one's group name), else its longest."""
        sk = self.F[w]["skills"]
        if self.o.get("randskill"):
            short = [s for s in sk if s["seconds"] <= 4.5] or [min(sk, key=lambda s: s["seconds"])]
            return self.rnd.choice(short)
        name = (self.o.get("finals") or (None, None))[w]
        return next((s for s in sk if s["group"] == name), None) or self.decks[w].finisher(self.long_max)

    def run_series(self) -> dict:
        """Exchanges off: `rounds` clash rounds blow after blow, one series (no stand-offs): each clash's loser (coin
        flips; one with its back to the wall mostly pushes out, as in run) is knocked back and its winner runs at it
        for the next one (nobody hurt); now and then ("defend") one guards or evades instead of striking back (the
        striker runs at it next), or ("bursts") a clash's winner follows it with a whole skill of up to burstMax
        seconds (the other one guarding, evading or taking it). Nobody falls before the end: then the winner (opts
        "winner", else the one with more of its HP left) lands its last skill."""
        R, rnd, o = self.R, self.rnd, self.o
        fits = [[s for s in f["skills"] if s["seconds"] <= self.bmax] for f in self.F]
        bursts = [0, 0]
        self.log("stand-off", -1, "far", result="the fight starts")
        runs = -1  # who runs in next: the last clash's winner (the striker), at the start both
        while self.clashes < self.rounds:
            before = range_of(self.gap(), R)
            if self.gap() > R["close"] + 1e-6:
                self.meet(runs)
                self.log("run-in", runs, before, result="runs in" if runs >= 0 else "both run in")
            runs = -1
            self.clashes += 1
            # each one's skill for this clash (the skill deck: the first one most) and its animation with it
            sks = (self.decks[0].clash_skill(self.long_max), self.decks[1].clash_skill(self.long_max))
            b4 = range_of(self.gap(), R)
            nth = [self.clashes, self.rounds]
            if (o.get("defend") or o.get("counter")) and rnd.random() < 0.3:
                # one of them guards, evades or ("counter") takes it and strikes back, instead of clashing: the other
                # one's clash alone, one coin of its skill (a guard's roll off its damage, an evade takes nothing)
                d = self.fewer(self.defended)
                self.defended[d] += 1
                s = 1 - d
                g = self.F[d]["guard"]
                how = self.defense(d)
                dmg = 0
                hit = self.roll(sks[s], 1) if how == "Counter" else 0
                if how == "Guard":
                    hit = max(0, self.roll(sks[s], 1) - self.roll(g or R["plain_guard"], (g or R["plain_guard"])["coins"]))
                if hit and self.hp[d] > 1:
                    dmg = self.hurt(d, hit, sks[s]["atk"], min(round(self.max[d] * R["landing_cap"]), self.hp[d] - 1))
                anim = self.decks[s].clash(sks[s])
                if how == "Guard":
                    self.knock(d, 0.15)  # (a guard is pushed back a little; an evade not at all)
                self.log("clash", s, b4, loser=-1, pow=[0, 0], skills=[sks[0]["group"], sks[1]["group"]],
                         anims=(anim, None) if s == 0 else (None, anim), nth=nth, defense=how, dmg=dmg,
                         dmgShare=dmg / self.max[d], push=False, result=f"#{d} {how.lower()}s" + (f", {dmg} damage" if dmg else ""))
                runs = s
                if how == "Counter":
                    self.counter(d, s)
                    runs = d
            else:
                p = [self.roll(sks[0], sks[0]["coins"]), self.roll(sks[1], sks[1]["coins"])]
                while p[0] == p[1]:
                    p = [self.roll(sks[0], sks[0]["coins"]), self.roll(sks[1], sks[1]["coins"])]
                lo = 0 if p[0] < p[1] else 1
                edge = ""
                pinned = [i for i in (0, 1) if self.room(i) < R["edge_room"]]
                if pinned:
                    i = min(pinned, key=self.room)
                    if lo == i and rnd.random() < R["edge_win"] + (1 - R["edge_win"]) * (1 - max(0.0, self.room(i)) / R["edge_room"]):
                        lo = 1 - i  # (its back to the wall: it pushes out)
                        p[i] = p[lo] + rnd.randint(1, 3)
                        edge = f" (#{i} has its back to the wall: pushes out)"
                push = R["loser_push"]
                if self.room(1 - lo) < R["edge_room"]:
                    push = max(push, self.x[lo] * self.facing(lo))  # (the winner at the wall: the other one out to the middle)
                self.x[lo] = self.off_wall(self.x[lo] - self.facing(lo) * push)
                self.log("clash", 1 - lo, b4, loser=lo, pow=p, skills=[sks[0]["group"], sks[1]["group"]],
                         anims=(self.decks[0].clash(sks[0]), self.decks[1].clash(sks[1])), nth=nth,
                         result=f"wins {p[1 - lo]} to {p[lo]}, #{lo} knocked back{edge}")
                runs = 1 - lo
                # ("bursts") now and then its winner follows it with a whole skill (one of up to burstMax seconds) on
                # the other one, which guards, evades or takes it — never a skill without a clash before it
                w = 1 - lo
                if fits[w] and self.clashes < self.rounds and rnd.random() < 0.2 * (1 + bursts[1 - w]) / (1 + bursts[w]):
                    bursts[w] += 1
                    sk = rnd.choice(fits[w])
                    kinds = (["Guard", "Evade"] if o.get("defend") else []) + (["Counter"] if o.get("counter") else []) + [None]
                    how = rnd.choices(kinds, weights=[{"Guard": 2, "Evade": 1, "Counter": 1, None: 2}[k] for k in kinds])[0]
                    b4 = range_of(self.gap(), R)
                    self.meet(w)
                    self.log("run-in", w, b4, result="runs at it")
                    self.land(w, sk, sk["coins"], True, defense=how, lethal=False)
                    if how == "Counter":
                        self.counter(1 - w, w)
                        runs = 1 - w
        # (the winner: as asked, else the one with more of its HP left)
        w = o.get("winner") if o.get("winner") in (0, 1) else 0 if self.hp[0] / self.max[0] >= self.hp[1] / self.max[1] else 1
        sk = self.final_skill(w)
        b4 = range_of(self.gap(), R)
        self.meet(w)
        self.log("run-in", w, b4, result="runs in")
        d = self.hp[1 - w]
        self.hp[1 - w] = 0
        self.log("whole", w, range_of(self.gap(), R), skill=sk["group"], sk=sk, coins=sk["coins"], dmg=d,
                 dmgShare=d / self.max[1 - w], result=f"#{1 - w} falls", final=True)
        return {"steps": self.steps, "winner": w, "seed": self.seed, "hp": list(self.hp), "hpMax": self.max,
                "clashes": self.clashes}

    def run(self) -> dict:
        if self.o.get("flow") == "series":
            return self.run_series()
        R, rnd = self.R, self.rnd
        self.log("stand-off", -1, "far", result="the fight starts")
        runs = -1  # who runs in next: after a landed blow the striker, else both
        while self.clashes < self.rounds:
            before = range_of(self.gap(), R)
            if self.gap() > R["close"] + 1e-6:
                if runs < 0:
                    # (one near a wall runs out at the other one, rather than both meeting halfway back at the wall)
                    near = [i for i in (0, 1) if self.room(i) < 2 * R["edge_room"]]
                    if len(near) == 1:
                        runs = near[0]
                self.meet(runs)
                self.log("run-in", runs, before, result="runs in" if runs >= 0 else "both run in")
            runs = -1
            sks = (self.decks[0].skill("close", self.long_max), self.decks[1].skill("close", self.long_max))
            n = min(rnd.randint(*R["exchange"]), self.rounds - self.clashes)
            lo, wins = 0, [0, 0]
            for r in range(n):
                p = [self.roll(sks[0], sks[0]["coins"]), self.roll(sks[1], sks[1]["coins"])]
                while p[0] == p[1]:  # (a tie: both flip again)
                    p = [self.roll(sks[0], sks[0]["coins"]), self.roll(sks[1], sks[1]["coins"])]
                lo = 0 if p[0] < p[1] else 1
                edge = ""
                pinned = [i for i in (0, 1) if self.room(i) < R["edge_room"]]
                if pinned:
                    i = min(pinned, key=self.room)
                    if lo == i and rnd.random() < R["edge_win"] + (1 - R["edge_win"]) * (1 - max(0.0, self.room(i)) / R["edge_room"]):
                        lo = 1 - i  # (its back to the wall: it pushes out)
                        p[i] = p[lo] + rnd.randint(1, 3)
                        edge = f" (#{i} has its back to the wall: pushes out)"
                self.clashes += 1
                wins[1 - lo] += 1
                b4 = range_of(self.gap(), R)
                anims = (self.decks[0].anim(), self.decks[1].anim())
                push = R["loser_push"]
                if self.room(1 - lo) < R["edge_room"]:
                    push = max(push, self.x[lo] * self.facing(lo))  # (the winner at the wall: the other one out to the middle)
                self.x[lo] = self.off_wall(self.x[lo] - self.facing(lo) * push)
                self.log("clash", 1 - lo, b4, loser=lo, pow=p, skills=[sks[0]["group"], sks[1]["group"]], anims=anims,
                         nth=[r + 1, n], result=f"wins {p[1 - lo]} to {p[lo]}, #{lo} knocked back{edge}")
                if r < n - 1:
                    b4 = range_of(self.gap(), R)
                    self.meet(1 - lo)  # (the winner runs at it for the next clash)
                    self.log("run-in", 1 - lo, b4, result="runs at it")
            if self.clashes >= self.rounds:
                break  # (the finale comes next)
            before = range_of(self.gap(), R)
            # nobody hit only when both won as many clashes; else the one that won more lands its blow
            if wins[0] == wins[1]:
                # nobody hit: a stand-off — springing apart only if they are still up close, else where they are
                moved = self.gap() <= R["close"] + 1e-6
                if moved:
                    self.apart()
                self.log("stand-off", -1, before, stay=not moved,
                         result="nobody hit, both spring apart" if moved else "nobody hit, they hold where they are")
                continue
            w = 0 if wins[0] > wins[1] else 1
            sk = sks[w]
            b4 = range_of(self.gap(), R)
            self.meet(w)  # (the winner at it for its blow)
            self.log("run-in", w, b4, result="runs at it")
            # (the winner lands all its skill's coins, as in the game)
            whole = True
            how = None
            if (self.o.get("defend") or self.o.get("counter")) and rnd.random() < R["defend_p"] and self.defended[1 - w] <= self.defended[w]:
                how = self.defense(1 - w)
                self.defended[1 - w] += 1
            if self.land(w, sk, sk["coins"] if whole else 1, whole, defense=how):
                break
            runs = w
            if how == "Counter":
                self.counter(1 - w, w)  # (it took the blow and strikes back)
                runs = 1 - w
        # the finale: if nobody fell, whoever is lower (by HP share) falls to the other one's skill
        if self.hp[0] > 0 and self.hp[1] > 0:
            w = 0 if self.hp[0] / self.max[0] >= self.hp[1] / self.max[1] else 1
            sk = self.decks[w].finisher(self.long_max)
            b4 = range_of(self.gap(), R)
            self.meet(w)
            self.log("run-in", w, b4, result="runs in")
            d = self.hp[1 - w]
            self.hp[1 - w] = 0
            self.log("whole", w, range_of(self.gap(), R), skill=sk["group"], sk=sk, coins=sk["coins"], dmg=d,
                     dmgShare=d / self.max[1 - w], result=f"#{1 - w} falls", final=True)
        winner = 0 if self.hp[0] > 0 else 1
        return {"steps": self.steps, "winner": winner, "seed": self.seed, "hp": list(self.hp), "hpMax": self.max,
                "clashes": self.clashes}


def simulate(a: dict, b: dict, seed: int, opts: dict | None = None) -> dict:
    """The fight of fighters `a` (left) and `b` (right) (see `fighter`). opts: rounds (clashes before the fight is
    settled), defend (guard / evade), counter (take a blow and strike back), bursts + burstMax (whole skills up to that many seconds), kbscale, winner (0 / 1:
    that side wins — the seed is walked on until it does), flow ("series": Exchanges off, see Fight.run_series),
    randskill / finals (the series' last skill, see Fight.final_skill)."""
    opts = dict(opts or {})
    want = opts.get("winner")
    for k in range(200):
        r = Fight(a, b, seed + k, opts).run()
        if want not in (0, 1) or r["winner"] == want:
            return r
    return r


# ------------------------------------------------------------------ the script for the player

def script(fight: dict, a: dict, b: dict, spec: dict) -> list[dict]:
    """The player's parts (versus_job's entries) acting the fight out. Per part, besides the timeline: who plays it,
    `place` before it ("run": `runs` runs at the other one, -1 both; nothing: from where they are), clash rounds with
    their partner's timeline, the engine's `loser` (knocked back after the blow), `standoff` / `recover` and `gap`
    after it, `dmg` (the HP share its hits take), `note` (the beat in words, for the test overlay)."""
    rnd = random.Random(fight["seed"] * 7 + 3)  # (pauses and holds: apart from the fight's own draws)
    F = (a, b)
    out, place, runs = [], None, -1
    lands = 0  # (each landing's parts carry its number: one skill, see viewer.skill_cutins)
    names = [a["name"], b["name"]]
    short = [n.split(" - ")[0] if " - " in n else n for n in names]
    if short[0] == short[1]:
        short = [short[0] + " L", short[1] + " R"]

    def note(s):
        return describe_step(s, short)

    def hold(k):
        return round(rnd.uniform(*RULES[k]), 3)

    def placed(e):
        nonlocal place
        if place:
            e.update(place=place, runs=runs)
            place = None
        return e
    for s in fight["steps"]:
        act = s["act"]
        if act == "run-in":
            place, runs = "run", s["who"]
            continue
        if act == "stand-off":
            if out and s.get("stay"):
                out[-1]["recover"] = hold("standoff_hold")  # (already apart: they hold where they are)
                out[-1]["note"] = out[-1].get("note", "") + " | " + note(s)
            elif out:
                out[-1].update(standoff=hold("standoff_hold"), gap=round(abs(s["x"][1] - s["x"][0]), 3))
                out[-1]["note"] = out[-1].get("note", "") + " | " + note(s)
            continue
        if act == "clash":
            ta, tb = s["anims"]
            if ta is None and tb is None:
                continue
            # the leader plays its timeline with its dashes (the one whose timeline dashes, else the left one); the
            # other one's runs alongside, timed so both blows land together
            if ta is None or (tb is not None and tb["events"]["moves"] and not ta["events"]["moves"]):
                lead, who, other = tb, 1, ta
            else:
                lead, who, other = ta, 0, tb
            # (not with a skill's coin: its blow comes long after the blink and the slide on, from afar)
            if spec.get("dash") and ta is not None and tb is not None and not ta["events"]["moves"] and not tb["events"]["moves"]                     and V.is_clash(ta["name"]) and V.is_clash(tb["name"]):
                # ("Index dashes") a round where neither one moves: its winner blinks past the other one
                who = 1 - s["loser"]
                lead, other = (ta, tb) if who == 0 else (tb, ta)
                # (its slide on after the blink quicker than the player's own Index dash: the next clash follows sooner)
                lead = dict(lead, events=dict(lead["events"], moves=[dict(m, dur=min(m["dur"], 0.3)) for m in V.INDEX_DASH]))
            # (the loser as the engine says — the player has no rule of its own for it; a series' clash pushes nobody)
            e = dict(lead, who=who, clash=True, neutral=True, loser=s["loser"] if s.get("push", True) else -1,
                     lockLoser=True, pause=round(rnd.uniform(*RULES["clash_pause"]), 3), note=note(s))
            if s.get("defense"):
                # (one guards or evades instead of striking back: its pose, the blow's damage on a guard; a counter:
                # it takes the blow as a hit — no pose of its own — and strikes back next)
                e.update(neutral=False, loser=-1, dmg=round(s.get("dmgShare", 0), 4))
                if s["defense"] != "Counter":
                    e["defend"] = s["defense"]
            if not V.is_clash(lead["name"]):
                e["coin"] = True  # (a skill's coin as its clash: its wind-up cut, see Viewer.cs)
            # how quick it is: from where the player starts it (a coin: just before its blow) to its blow
            blow = V._round_blow(lead["events"], other["events"] if other is not None else None)
            lead_in = min(blow, 0.25) if e.get("coin") else blow
            e["speed"] = round(max(RULES["clash_slowest"], RULES["clash_speed"] * min(1.0, 0.75 + 0.25 * lead_in / RULES["clash_quick"])), 3)
            if spec.get("numbers") and not s.get("defense"):
                e.update(powL=s["pow"][0], powR=s["pow"][1])
            if other is not None:
                poff = round(V._clash_blow(other["events"]) - V._clash_blow(lead["events"]), 4)
                e.update(partnerTl=dict(other, who=1 - who, poff=poff),
                         psounds=[dict(x, t=round(x["t"] - poff, 4)) for x in other["events"]["sounds"] if x["t"] - poff >= 0])
            out.append(placed(e))
            continue
        if act == "counter":
            # a strike back without a clash: one coin, the other one thrown back by it
            e = dict(s["anim"], who=s["who"], strike=True, counter=True, throwLast=True, recover=hold("recover_hold"),
                     dmg=round(s.get("dmgShare", 0), 4), note=note(s))
            ev, lastt = e["events"], max((h["t"] for h in e["events"].get("hits") or []), default=None)
            if lastt is not None and ev.get("moves"):
                e["events"] = dict(ev, moves=[m for m in ev["moves"] if m["t"] < lastt - 1e-3])
            out.append(placed(e))
            continue
        # a landing: the skill with all its coins (a later skill: the camera closes in on its wind-up, tilted)
        w, sk = s["who"], s["sk"]
        lands += 1
        parts = [dict(t, who=w, strike=True, whole=True, land=lands) for t in sk["parts"]]
        if sk is not F[w]["skills"][0]:
            parts[0]["closeup"] = True
        if s.get("final"):
            parts = [dict(t, final=True, trim=k == 0) for k, t in enumerate(parts)]
            for t in parts:
                t.pop("strike", None), t.pop("whole", None), t.pop("closeup", None)
        else:
            if s.get("defense") and s["defense"] != "Counter":
                for t in parts:
                    t["defend"] = s["defense"]
            parts[-1].update(throwLast=s.get("defense") in (None, "Guard", "Counter"), recover=hold("recover_hold"))
            # (the one landing it stays where it is after its last blow: no moves after it)
            ev = parts[-1]["events"]
            lastt = max((h["t"] for h in ev.get("hits") or []), default=None)
            if lastt is not None and ev.get("moves"):
                parts[-1]["events"] = dict(ev, moves=[m for m in ev["moves"] if m["t"] < lastt - 1e-3])
        n = sum(len(t["events"].get("hits") or []) for t in parts) or 1
        for t in parts:
            t["dmg"] = round(s.get("dmgShare", 0) * len(t["events"].get("hits") or []) / n, 4)
        parts[0]["note"] = note(s)
        out.append(placed(parts[0]))
        out += parts[1:]
    return out


# ------------------------------------------------------------------ reading it out

def describe_step(s: dict, short: list[str]) -> str:
    def sk(n):
        m = re.search(r"S\d+", n or "")
        return m.group(0) if m else (n or "")
    who = short[s["who"]] if s["who"] >= 0 else "both"
    what = s["act"]
    if s["act"] == "clash" and s.get("defense"):
        what = f"clash {sk(s['skills'][s['who']])} (clash {s['nth'][0]} of {s['nth'][1]})"
    elif s["act"] == "clash":
        what = f"clash {sk(s['skills'][0])} {s['pow'][0]} vs {s['pow'][1]} {sk(s['skills'][1])} (clash {s['nth'][0]} of {s['nth'][1]})"
    elif s.get("skill"):
        what += f" {sk(s['skill'])}" + (f" x{s['coins']}" if s.get("coins") else "")
    if s.get("defense"):
        what += f" on {s['defense'].lower()}"
    res = s["result"].replace("#0", short[0]).replace("#1", short[1])
    return f"{who}: {what} [{s['rng'][0]} > {s['rng'][1]}] {res}"


def describe(a: dict, b: dict, fight: dict) -> str:
    """The fight read out, one line per beat: step, who, what, range before -> after, positions, HP, result."""
    names = [a["name"], b["name"]]
    short = [n.split(" - ")[0] if " - " in n else n for n in names]
    if short[0] == short[1]:
        short = [short[0] + " L", short[1] + " R"]
    out = [f"{names[0]} vs {names[1]}, seed {fight['seed']} (HP scaled {fight['hpMax'][0]} / {fight['hpMax'][1]}"
           f" from the data's {a['hp']} / {b['hp']})"]
    for k, s in enumerate(fight["steps"]):
        out.append(f"{k:3d}  x {s['x'][0]:5.2f} {s['x'][1]:5.2f}  HP {s['hp'][0]:4d} {s['hp'][1]:4d}  {describe_step(s, short)}")
    out.append(f"winner: {short[fight['winner']]} after {fight['clashes']} clashes")
    return "\n".join(out)


def to_json(a: dict, b: dict, fight: dict) -> dict:
    """The fight for the test viewer (ui/versus_view.html): names, HP, walls and the steps (no timelines)."""
    keep = ("act", "who", "rng", "x", "hp", "loser", "pow", "skills", "nth", "skill", "coins", "dmg", "defense", "result", "final")
    return {"names": [a["name"], b["name"]], "hpMax": fight["hpMax"], "winner": fight["winner"], "seed": fight["seed"],
            "rules": {k: RULES[k] for k in ("clash_gap", "near_gap", "standoff_gap", "wall", "close", "mid")},
            "steps": [dict({k: s[k] for k in keep if k in s},
                           anims=[t["name"] if t else None for t in s.get("anims") or []]) for s in fight["steps"]]}


def write_view(path: str, fights: list[dict]):
    """A copy of ui/versus_view.html with `fights` (to_json's) in it, to open in the browser."""
    import json
    import os
    here = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "ui", "versus_view.html")
    with open(here, encoding="utf-8") as f:
        page = f.read()
    with open(path, "w", encoding="utf-8") as f:
        f.write(page.replace("/*FIGHTS*/[]", json.dumps(fights, ensure_ascii=False)))
