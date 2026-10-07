"""Versus team fights: several fighters a side (many vs many, or many vs one boss), decided by the same simplified rules
as the one-on-one engine (versus_engine.py: coin flips, the data's knockback, landings with all coins) plus the order
they act in:

- tags: a fighter's role ("nimble", "slow", "range", "mass", "universal" — several allowed; a boss has its own too)
  decides when it acts (the queue), its cooldown after an engagement and whom it goes for; a skill's own tags ("range",
  "mass") only how that one attack is done (a shot from where it stands, or a run in; a mass one hits the others near
  its target too, weaker). Fighters using bullets are range ones; a skill whose coins land from afar is a range one, a
  skill hitting several (the data's targetNum / arearange) a mass one; data/versus_tags.json overrides both (tags_of);
- start: the game's own formation slots (static-data team-position: 1 the player's side, 2 the enemies', 9 a lone
  boss), x across the stage and the game's y as depth (z); only the start — nobody goes back to a slot, except a slow
  one knocked out of its zone (it fights only within it, then walks back); one left near a wall walks back towards the
  middle after its engagement;
- engagements: the one-on-one exchange (2-5 clashes, then the one that won more lands its skill, or nobody is hit) with
  whomever it picked: the nearest free one; with no other target left (a lone boss, the last one standing) several pile
  onto one (it is surrounded): each clash it picks one of them at random to clash, the others' blows land; fully
  parrying one (winning every clash with it) earns a strong counter: its whole skill on that one, the others near it hit
  weaker;
- a range shot can't be clashed: the one shot guards, evades or takes it (and doesn't run at the shooter); a range
  one shoots from where it stands and moves only when attacked up close: it fights there, then backs off to shoot again;
  it has `ammo` shots: empty, it goes in to fight up close until it backs off and reloads (one with nothing to fight up
  close with shoots on weaker and reloads);
- the boss (alone against two or more): a short cooldown, can't be interrupted only during its chosen skills (its later
  ones, see armor) and its strong counter, and lets blows through: at most boss_streak clashes won in a row;
- "lanes": how many engagements at once (1: one at a time, what the player films; 0 "all at once": every free one
  engages at once, no cooldowns);
- "aggro" (flow): no queue at all — each one keeps at its own target until its skill is spent, its aggro runs out or it
  turns on someone hitting it; everyone fights at once (see Battle.run_aggro).

Nothing here changes coin power or HP: tags change only order, timing, targets and movement. Positions are body
heights (x across, z depth: + is farther from the camera)."""
import contextlib
import json
import math
import os
import random
import re
import threading

from . import versus_engine as E

TEAM = {
    "wall": 8.0,             # across: how far from the stage's middle anyone gets (at least; wider for far slots)
    "depth": 1.6,            # depth: how far in front of / behind the middle line
    "world_body": 1.6,       # the game's world units per body height (team-position -> bodies)
    "depth_scale": 0.65,     # the game's depth squeezed by this (a flat camera shows little of it)
    "cooldown": {"nimble": (0.3, 0.6), "universal": (0.8, 1.2), "range": (1.0, 1.5), "slow": (1.8, 2.5), "boss": (0.2, 0.4)},
    "priority": {"boss": 0, "nimble": 1, "universal": 2, "range": 2, "slow": 3},  # who acts first when ready together
    "exchange": (2, 5), "exchange_short": (1, 2),  # clashes in an engagement (Exchanges on / off)
    "zone": 1.5,             # a slow one's zone: this far around its start slot
    "zone_wait": 4.0,        # seconds a slow one waits for someone to come before it leaves its zone
    "join_window": 0.8,      # seconds: one ready this soon joins an engagement on its only target
    "pile_cap": 2, "boss_cap": 4,  # attackers on one at most (on the boss)
    "boss_streak": 3,        # the boss wins at most this many clashes in a row
    "interrupt_p": 0.5,      # a blow on the boss outside its armor cuts its landing short this often
    "strong_side": 0.4,      # a strong counter on the others near: this share of its damage and knockback
    "extra_share": 0.5,      # a blow landing while the surrounded one clashes someone else: this share of its coin
    "boss_hp": 0.7,          # the boss's HP: a one-on-one fighter's x this x the number against it
    "side_reach": 2.0,       # "near": within this many bodies of the one countering
    "range_reach": 4.0,      # world units: a coin landing at least this far in front of the other one is a shot from afar
    "mass_reach": 2.2,       # a mass skill also hits the others within this many bodies of its target
    "mass_share": 0.6,       # them: this share of its damage and knockback
    "edge": 2.2,             # after an engagement, one this close to a wall walks back towards the middle
    "edge_back": 3.0,        # to at least this far from it
    "soft_wall": 2.5,        # knocked towards a wall closer than this: less far (down to a quarter right at it)
    "personal": 0.65,        # two that aren't fighting each other never stand closer than this (one steps aside in depth)
    "boss_cd_by": {"slow": 2.0, "nimble": 0.7},  # a boss's cooldown x this for its own tag
    # aggro (flow "aggro"): how long one keeps at its target by its role (seconds), how often it turns on one that
    # clashes it while it was after someone else, a free blow on a busy target, a whole skill after a won clash
    "aggro_time": {"nimble": (2.5, 3.5), "universal": (4.0, 6.0), "range": (4.0, 6.0), "slow": (6.0, 9.0), "boss": (3.0, 5.0)},
    "retaliate": {"nimble": 0.25, "universal": 0.5, "range": 0.3, "slow": 0.8, "boss": 0.6},
    "extra_s": 0.4, "burst_p": 0.2, "burst_max": 5.0, "defend_series": 0.3,
    "aim": (1.5, 2.5),       # a shooter takes aim again this long after a shot
    "shot_share": 0.5,       # a shot (it can't be clashed, it comes again and again) takes this share of a landing
    "aggro_hp": 2.0,         # HP x this in aggro (everyone fights at once)
    "full_parry": 3,         # the boss winning this many clashes in a row against one: a strong counter on it
    "shoot_mixed": 0.4,      # one with a range skill but no range tag shoots at one farther than "close" this often
    "shoot_gap": 3.2,        # a range one attacked up close backs off this far from its nearest foe afterwards
    # the boss (both flows): its mass skill sweeps everyone this close around itself (bodies), not only those near its
    # target; (aggro) it lands its skill after this many clashes won with it, follows a won clash up with a whole skill
    # this often, takes free blows at this share (its armor window: armor_blow) instead of extra_share; (both flows)
    # turns on a shooter hitting it this often (dashing at it: run_speed x dash); its HP and damage: see fair_boss
    "boss_sweep": 2.6, "boss_land_wins": 2, "boss_burst_p": 0.45,
    "boss_blow": 0.35, "armor_blow": 0.25, "boss_chase": 0.5, "dash": 2.0,
    "fair": 0.5, "fair_seeds": 48,  # the boss's strength is set so that it wins about this share of fights (that many tried)
    "boss_shot": 0.6,        # (aggro) a shot on the boss: x this on top of shot_share (it shrugs off chip damage too)
    "back_after": 2,         # (aggro) a range one backs off to shoot again after this many clashes up close
    # ammo (range ones): shots before it is empty; empty, it goes in to fight up close until it backs off (and reloads
    # there); one with no skill to fight up close with shoots on weaker (empty_share) and reloads in reload_s instead
    "ammo": 4, "empty_share": 0.5, "reload_s": 2.5,
    # engine clock (seconds; estimates for the queue — the player has its own timing)
    "run_speed": 9.0, "walk_speed": 3.0, "clash_s": 0.35, "hold_s": 0.35, "counter_s": 0.8,
    "max_clashes": 3,        # the fight ends after rounds x this many clashes at most (then the losing side falls)
    # (several engagements at once) a long or showy attack — a fighter's last skill (S3), one this long or longer, the
    # fight's last kill — stops everyone else on the spot while it plays (Battle.freeze)
    "spot_s": 3.5,
    "freeze": True,          # a spotlight attack stops the others (Battle.freeze)
}

# what the page's team rules may change (limbusdm/server.py /api/versus_team_rules; spec "rules"): key -> (low, high), a
# pair of numbers (exchange: both ends), or a table of pairs (cooldown: by role)
RULE_LIMITS = {"spot_s": (1.0, 30.0), "boss_streak": (1, 9), "interrupt_p": (0.0, 1.0), "boss_hp": (0.1, 3.0), "wall": (4.0, 14.0),
               "freeze": None, "exchange": (1, 9), "cooldown": (0.0, 8.0)}
_RULES_LOCK = threading.RLock()


def rule_defaults() -> dict:
    return {k: (json.loads(json.dumps(TEAM[k])) if k != "cooldown" else {r: list(v) for r, v in TEAM[k].items()}) for k in RULE_LIMITS}


def clean_rules(r) -> dict:
    """The page's rules as TEAM values: only known keys, numbers inside their limits, pairs low <= high."""
    out = {}
    if not isinstance(r, dict):
        return out
    num = lambda v, lo, hi: max(lo, min(hi, float(v)))
    try:
        for k, lim in RULE_LIMITS.items():
            if k not in r:
                continue
            v = r[k]
            if k == "freeze":
                out[k] = bool(v)
            elif k == "exchange":
                a, b = sorted(int(num(x, *lim)) for x in v)
                out[k] = (a, b)
            elif k == "cooldown":
                cd = dict(TEAM["cooldown"])
                for role, pr in v.items():
                    if role in cd:
                        a, b = sorted(num(x, *lim) for x in pr)
                        cd[role] = (a, b)
                out[k] = cd
            elif k == "boss_streak":
                out[k] = int(num(v, *lim))
            else:
                out[k] = num(v, *lim)
    except (TypeError, ValueError):
        return {}
    return out


@contextlib.contextmanager
def rules(r):
    """TEAM with the page's rules on while the block runs (Battle / script read TEAM; one at a time)."""
    c = clean_rules(r)
    if not c:
        yield
        return
    with _RULES_LOCK:
        old = {k: TEAM[k] for k in c}
        TEAM.update(c)
        try:
            yield
        finally:
            TEAM.update(old)
ROLES = ("nimble", "slow", "range", "mass", "universal")
SKILL_TAGS = ("range", "mass")
# (the game's formation slots if the data has none: team-position 1, 2, 9)
SLOTS = {1: [(-1.3, 4), (-3.1, -3), (-5.3, 4), (-7, -3), (-9.5, 4), (-11, -3), (-14, 4), (-16, -3), (-3, 0), (-7, 0), (-11, 0), (-15, 0)],
         2: [(4, 4), (6, -3), (8, 4), (10, -3), (12, 4), (14, -3), (16, 4), (18, -3), (20, 4), (22, -3), (24, 4), (24, -4)],
         9: [(9, 0)]}


# ------------------------------------------------------------------ tags

def _tag_file(svc) -> str:
    return os.path.join(svc.store.root, "versus_tags.json")


def tag_overrides(svc) -> dict:
    """data/versus_tags.json: {"<id or prefab>": {"unit": ["slow", ...], "skills": {"<group>": "range" | "melee"}}}."""
    try:
        with open(_tag_file(svc), encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def save_tag_overrides(svc, d: dict):
    with open(_tag_file(svc), "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=1)


def shot_reach(t: dict) -> float:
    """How far in front of the other one a coin's first blow lands, world units (see versus_engine.clashable): a
    "wide" move that far before it, "to the target" its radius, "relative" on from there; no move: 0 (face to face)."""
    hits = sorted(h["t"] for h in t["events"].get("hits") or [] if not h.get("tick"))
    if not hits:
        return 0.0
    d = 0.0
    for m in sorted(t["events"].get("moves") or [], key=lambda m: m["t"]):
        if m["t"] > hits[0] + 1e-3:
            break
        x = (m.get("pos") or [0])[0]
        d = x if m["kind"] == "wide" else d - x if m["kind"] == "relative" else m.get("radius") or 0.0
    return d


def uses_bullets(svc, f: dict) -> bool:
    """Whether its attack skills (the game's data) spend or load bullets (Full-Stop, the Thumb, Fell Bullet, ...)."""
    skills_t, _ = E._tables(svc)
    return any(re.search(r"Bullet", json.dumps(skills_t.get(s.get("id")) or {})) for s in f["skills"] if s.get("id"))


def is_mass(svc, sid) -> bool:
    """The game's data has the skill hit several (its highest uptie's targetNum over 1, or an arearange)."""
    skills_t, _ = E._tables(svc)
    rec = skills_t.get(sid) or {}
    d = (rec.get("skillData") or [{}])[-1]
    try:
        area = float(str(d.get("arearange") or 0).strip() or 0)
    except ValueError:
        area = 0.0
    return (d.get("targetNum") or 1) > 1 or area > 0


def tags_of(svc, f: dict, over: dict | None = None) -> dict:
    """{"unit": [roles], "skills": {group: [tags]}, "auto": why}: a range skill's first coin lands range_reach or
    more in front of the other one, a mass skill hits several (is_mass); one using bullets is a range one (its
    farthest-reaching skill a range one at least); data/versus_tags.json wins over all of it (a skill's tags there: a
    list, or one tag; "melee" or [] for none). No role: "universal"."""
    reach = {s["group"]: max((shot_reach(t) for t in s["parts"] if t["events"].get("hits")), default=0.0) for s in f["skills"]}
    sk = {s["group"]: (["range"] if reach[s["group"]] >= TEAM["range_reach"] else []) + (["mass"] if s.get("id") and is_mass(svc, s["id"]) else [])
          for s in f["skills"]}
    unit, why = [], []
    if f["skills"] and uses_bullets(svc, f):
        unit.append("range")
        why.append("bullets")
        if not any("range" in v for v in sk.values()):
            # (its farthest-reaching skill short enough to play in the fight: longer ones never do — see finisher_from)
            ok = [s["group"] for s in f["skills"] if s["seconds"] <= E.RULES["finisher_from"]] or list(reach)
            sk[max(ok, key=reach.get)].append("range")
    if any("range" in v for v in sk.values()) and not unit:
        why.append("a range skill")
    if any("mass" in v for v in sk.values()):
        why.append("a mass skill")
    o = (over if over is not None else tag_overrides(svc)).get(str(f["cid"])) or {}
    if o.get("unit"):
        unit = [r for r in o["unit"] if r in ROLES]
        why.append("set by hand")
    for g, v in (o.get("skills") or {}).items():
        if g in sk:
            v = [v] if isinstance(v, str) else list(v or [])
            sk[g] = [x for x in v if x in SKILL_TAGS]
    return {"unit": unit or ["universal"], "skills": sk, "auto": ", ".join(why)}


def team_fighters(svc, lefts: list, rights: list, spec: dict, lnames=(), rnames=()) -> tuple[list, list, list]:
    """(fighters, sides, tags) for a team fight: versus_engine.fighter for each (the left ones with the spec's
    "lskills", the right ones "rskills"), each one's tags_of."""
    over = tag_overrides(svc)
    F, side = [], []
    for s, ids, names, sk in ((0, lefts, list(lnames), spec.get("lskills")), (1, rights, list(rnames), spec.get("rskills"))):
        for k, c in enumerate(ids):
            f = E.fighter(svc, c, names[k] if k < len(names) else "", bool(sk))
            if not f["skills"]:
                continue  # (nothing to fight with: no skill animations)
            F.append(f)
            side.append(s)
    if not (side.count(0) and side.count(1)):
        raise ValueError("each side needs at least one with skills to fight with")
    return F, side, [tags_of(svc, f, over) for f in F]


# ------------------------------------------------------------------ the start

def slots(svc) -> dict:
    """{position id: [(x, y), ...]} of the game's team-position table (SLOTS without it)."""
    t = getattr(svc, "_vs_slots", None)
    if t is None:
        t = dict(SLOTS)
        try:
            for d in (svc.static_tables(["team-position"]).get("team-position") or {}).values():
                for r in d.get("list") or []:
                    if r.get("positionList"):
                        t[r["id"]] = [(p.get("x") or 0.0, p.get("y") or 0.0) for p in r["positionList"]]
        except Exception:
            pass
        svc._vs_slots = t
    return t


def start_places(svc, nl: int, nr: int) -> list[list[float]]:
    """Where each one starts (body heights, [x, z]): the left side in the player's slots, the right side in the
    enemies' (a lone one opposite two or more: the boss slot), centred between the two front slots."""
    t = slots(svc) if svc is not None else SLOTS
    left = (t.get(1) or SLOTS[1])[:nl]
    right = (t.get(9) or SLOTS[9]) if nr == 1 and nl >= 2 else (t.get(2) or SLOTS[2])
    right = right[:nr]
    if nl == 1 and nr >= 2:
        left = [(-r[0], r[1]) for r in (t.get(9) or SLOTS[9])]
    while len(left) < nl:  # (more than the table has: one more row behind)
        left.append((left[-1][0] - 2.5, -left[-1][1]))
    while len(right) < nr:
        right.append((right[-1][0] + 2.5, -right[-1][1]))
    mid = (max(x for x, _ in left) + min(x for x, _ in right)) / 2
    wb, ds = TEAM["world_body"], TEAM["depth_scale"]
    return [[round((x - mid) / wb, 3), round(max(-TEAM["depth"], min(TEAM["depth"], y / wb * ds)), 3)] for x, y in left + right]


# ------------------------------------------------------------------ the fight

def spotlight(f: dict, sk: dict, final=False) -> bool:
    """A long or showy attack (it stops everyone else while it plays): the fighter's last skill (S3), one of spot_s
    seconds or more, or the fight's last kill."""
    return bool(final) or bool(f["skills"]) and sk["group"] == f["skills"][-1]["group"] or sk.get("seconds", 0) >= TEAM["spot_s"]


class Battle:
    """One team fight. F: the fighters (versus_engine.fighter's), side: 0 left / 1 right each, tags: tags_of's each.
    steps: one dict per beat (act, t, dur, who, tgt, ...); run() returns them with everyone's positions, HP and when each
    one is ready again after every beat."""

    def __init__(self, F: list, side: list, tags: list, seed: int, opts: dict, places=None, R=E.RULES, T=TEAM):
        self.F, self.side, self.R, self.T, self.o, self.seed = F, side, R, T, opts, seed
        self.n = len(F)
        self.rnd = random.Random(seed)
        self.decks = [E.Deck(f, self.rnd, R) for f in F]
        # duels (flow "duels"): no autobattler logic — fixed pairs (the same slot across, or drawn: opts "pairs"), each pair
        # fights its own one-on-one at the same time as the others: no roles, cooldowns, boss, helpers, shots or mass hits
        self.duels = opts.get("flow") == "duels"
        if self.duels:
            tags = [{"unit": ["universal"], "skills": {g: [] for g in tg["skills"]}, "auto": "duels"} for tg in tags]
        self.tags = tags
        self.role = [set(tg["unit"]) for tg in tags]
        counts = [side.count(0), side.count(1)]
        self.boss = -1 if self.duels else next((i for i in range(self.n) if counts[side[i]] == 1 and counts[1 - side[i]] >= 2), -1)
        if self.boss >= 0:
            self.role[self.boss] = self.role[self.boss] | {"boss"}
        self.rounds = int(opts.get("rounds") or 20)
        self.all_at_once = bool(opts.get("allAtOnce")) or self.duels
        self.lanes = 0 if self.all_at_once else max(1, int(opts.get("lanes") or 1))
        self.kbs = float(opts.get("kbscale") or 2)
        self.long_max = R["finisher_from"]
        self.short = not opts.get("pace", True)
        self.aggro = opts.get("flow") == "aggro"
        n = len(F)
        self.tgt, self.sk, self.uses, self.won, self.lost = [None] * n, [None] * n, [0] * n, [0] * n, [0] * n
        self.agg_end, self.aggs, self.pairs, self.parried = [0.0] * n, [[] for _ in range(n)], {}, {}
        self.partner = [None] * n  # (aggro) whom each one's current beat is with (None: running, walking)
        self.blown = {}  # (aggro) (i, j): the end of j's beat i already landed a free blow in (one a beat)
        self.armor_until = 0.0  # (aggro) the boss can't be interrupted (its armored skill) until then
        self.chase = None  # (aggro) the shooter the boss turned on: it dashes at it
        self.aim = [0.0] * n  # (aggro) a shooter shoots again only from then on (it may fight up close meanwhile)
        self.shooting = [0.0] * n  # (aggro) until then it plays its shot: one up close hits it meanwhile, doesn't wait
        self.ammo = [T["ammo"] if "range" in tg["unit"] else -1 for tg in tags]  # (-1: no ammo count)
        self.close_fights = [0] * n  # (aggro) clashes each one has fought up close since it last backed off
        # the boss's strength (see fair_boss): its HP and the damage it deals x the square root of it each
        self.boss_mult = math.sqrt(float(opts.get("bossPower") or 1)) if self.boss >= 0 else 1.0
        # HP: each side's pool about what a one-on-one fighter has (rounds x hp_per_clash), shared out by the data's HP
        self.max = [0] * self.n
        for s in (0, 1):
            ids = [i for i in range(self.n) if side[i] == s]
            mean = (sum(F[i]["hp"] for i in ids) / len(ids)) if ids else 1
            for i in ids:
                share = min(R["hp_ratio"], max(1 / R["hp_ratio"], F[i]["hp"] / mean))
                big = T["boss_hp"] * (len(self.side) - len(ids)) if i == self.boss else 1 / len(ids) ** 0.5
                if self.duels:
                    big = 1.0  # (each pair is a one-on-one: a one-on-one fighter's HP)
                if opts.get("flow") == "aggro":
                    big *= T["aggro_hp"]
                if i == self.boss:
                    big *= self.boss_mult  # (see fair_boss)  # (everyone hits at once: more HP, or the fight is over in seconds)
                self.max[i] = max(1, round(self.rounds * R["hp_per_clash"] * share * big))
        self.hp = list(self.max)
        self.mate = self.duel_pairs() if self.duels else {}
        # (the fight ends after about rounds x max_clashes clashes: of every pair at once in duels)
        self.clash_cap = self.rounds * T["max_clashes"] * (max(1, len(self.mate) // 2) if self.duels else 1)
        self.pos = [list(p) for p in (places or start_places(None, counts[0], counts[1]))]
        self.home = [list(p) for p in self.pos]
        self.wall = max(T["wall"], max(abs(p[0]) for p in self.pos) + 0.6)
        self.t = 0.0
        self.ready = [round(self.rnd.uniform(0, 0.4) + 0.15 * T["priority"][self.main_role(i)], 3) for i in range(self.n)]
        self.busy = [0.0] * self.n  # busy until
        self.waited = [None] * self.n  # (slow) since when it has found nobody in its zone
        self.streak = 0  # the boss's clashes won in a row
        self.clashes = 0
        self.eng = 0
        self.steps = []
        self.dead_order = []
        self.cds = [[] for _ in range(self.n)]  # each one's cooldowns: [from, ready again]
        # (several engagements at once: a spotlight attack stops the others — see freeze) [from, to] of each stop
        self.freezes = []
        self.freezing = not self.aggro and self.lanes != 1 and bool(TEAM.get("freeze", True))
        self.eng_start = {}  # each engagement's start (engine time)

    # --- duels
    def duel_pairs(self) -> dict:
        """{i: its opponent, ...} both ways: the k-th of the left team against the k-th of the right (front slots first), or
        the right team drawn ("pairs": "random"); those with no one across (an uneven team) fight nobody."""
        L = [i for i in range(self.n) if self.side[i] == 0]
        Rr = [i for i in range(self.n) if self.side[i] == 1]
        if self.o.get("pairs") == "random":
            random.Random(self.seed * 7 + 3).shuffle(Rr)
        m = {}
        for a, b in zip(L, Rr):
            m[a], m[b] = b, a
        return m

    def duel_open(self) -> int:
        """Pairs still fighting (both alive)."""
        return sum(1 for a, b in self.mate.items() if a < b and self.alive(a) and self.alive(b))

    # --- who is what
    def main_role(self, i) -> str:
        r = self.role[i]
        return "boss" if "boss" in r else "slow" if "slow" in r else "nimble" if "nimble" in r else "range" if "range" in r else "universal"

    def cooldown(self, i) -> float:
        if self.all_at_once:
            return 0.0
        c = self.rnd.uniform(*self.T["cooldown"][self.main_role(i)])
        if i == self.boss:
            for r, k in self.T["boss_cd_by"].items():
                if r in self.role[i]:
                    c *= k
        return round(c, 3)

    def alive(self, i) -> bool:
        return self.hp[i] > 0

    def foes(self, i) -> list[int]:
        return [j for j in range(self.n) if self.side[j] != self.side[i] and self.alive(j)]

    def dist(self, i, j) -> float:
        return math.hypot(self.pos[i][0] - self.pos[j][0], self.pos[i][1] - self.pos[j][1])

    def gap(self, i, j) -> float:  # across only (who is in reach: they clash side by side)
        return abs(self.pos[i][0] - self.pos[j][0])

    def stags(self, i, sk) -> list:
        return self.tags[i]["skills"].get(sk["group"]) or []

    def range_skills(self, i) -> list:
        return [s for s in self.F[i]["skills"] if "range" in self.stags(i, s) and s["seconds"] <= self.long_max]

    def melee_skills(self, i) -> list:
        return [s for s in self.F[i]["skills"] if "range" not in self.stags(i, s)]

    def near(self, v, reach=None) -> list[int]:
        """v's side's others (alive) within reach of it."""
        reach = self.T["mass_reach"] if reach is None else reach
        return [o for o in range(self.n) if o != v and self.alive(o) and self.side[o] == self.side[v] and self.dist(o, v) <= reach]

    def mass(self, w, v, sk, coins) -> list[dict]:
        """(a mass skill) the others near v hit by it too, weaker (never the fight's last kill); [{"who", "dmg",
        "dmgShare"}]."""
        if "mass" not in self.stags(w, sk):
            return []
        out = []
        near = self.near(v)
        if w == self.boss:  # (the boss sweeps everyone around itself too)
            near += [o for o in self.foes(w) if o != v and o not in near and self.dist(o, w) <= self.T["boss_sweep"]]
        for o in near:
            x, _ = self.land(w, o, sk, coins, share=self.T["mass_share"], kb=self.T["mass_share"], keep=True)
            out.append({"who": o, "dmg": x, "dmgShare": x / self.max[o]})
        return out

    def in_zone(self, i, p) -> bool:
        return math.hypot(p[0] - self.home[i][0], p[1] - self.home[i][1]) <= self.T["zone"] + self.R["clash_gap"]

    # --- the record
    def log(self, act, who, tgt, dur, eng, at=None, **kw):
        """A beat at engine time `at` (default: now) lasting dur; with the positions and HP of those in it (the rest
        filled in by run())."""
        at = self.t if at is None else at
        if self.freezes:
            # (decided before a spotlight attack of another engagement was known: after it — or held through it)
            at = self.thaw(at, eng)
            for a, b, e in self.freezes:
                if e != eng and self.eng_start.get(eng, 0.0) < a - 1e-6 and at < a - 1e-6 < at + dur - 2e-6:
                    dur += b - a
                    kw["frozen"] = round(kw.get("frozen", 0) + b - a, 3)
        part = sorted({x for x in [who, tgt] + [e["who"] for e in kw.get("extras") or []] if x is not None and x >= 0})
        s = dict(act=act, t=round(at, 3), dur=round(dur, 3), who=who, tgt=tgt, eng=eng,
                 p={i: [round(v, 2) for v in self.pos[i]] for i in part}, h={i: self.hp[i] for i in part}, **kw)
        self.steps.append(s)
        if self.freezing and act in ("whole", "strong", "shot") and kw.get("sk") and spotlight(self.F[who], kw["sk"], kw.get("final")):
            s["spot"] = True
            self.freeze(s)
        return s

    def freeze(self, s):
        """A spotlight attack (see spotlight) at s: everything else stops for its length — the other engagements' beats
        from then on come that much later (one going on then: held that long, "frozen"), the others' busy / ready
        times and cooldowns too; no new engagement starts meanwhile (run)."""
        T, D, E = s["t"], s["dur"], s["eng"]
        mine = set()
        for st in self.steps:
            if st["eng"] == E:
                mine |= {x for x in [st["who"], st["tgt"]] + [e["who"] for e in st.get("extras") or []] + [e["who"] for e in st.get("side") or []]
                         if x is not None and x >= 0}
        for st in self.steps:
            if st is s or st["eng"] == E:
                continue
            if st["t"] >= T - 1e-6:
                st["t"] = round(st["t"] + D, 3)
            elif st["t"] + st["dur"] > T + 1e-6:
                st["dur"] = round(st["dur"] + D, 3)
                st["frozen"] = round(st.get("frozen", 0) + D, 3)
        for i in range(self.n):
            if i in mine:
                continue
            if T < self.busy[i] < 1e8:
                self.busy[i] = round(self.busy[i] + D, 3)
            if self.ready[i] > T:
                self.ready[i] = round(self.ready[i] + D, 3)
            for c in self.cds[i]:
                if c[0] >= T - 1e-6:
                    c[0], c[1] = round(c[0] + D, 3), round(c[1] + D, 3)
                elif c[1] > T:
                    c[1] = round(c[1] + D, 3)
        self.freezes.append([T, round(T + D, 3), E])
        self.freezes.sort()

    def thaw(self, t, eng) -> float:
        """Engine time t of engagement eng (decided as if nothing stopped it) after the other engagements' spotlight
        stops before it."""
        start = self.eng_start.get(eng, 0.0)
        for a, b, e in self.freezes:
            if e != eng and start < a - 1e-6 and t >= a - 1e-6:  # (one started after it was decided knowing it)
                t += b - a
        return round(t, 3)

    # --- moving
    def clamp(self, p):
        w, d = self.wall, self.T["depth"]
        over = abs(p[0]) - w
        if over > 0:
            p[0] = (1 if p[0] > 0 else -1) * (w - min(over * self.R["wall_bounce"], self.R["wall_bounce_max"]))
        p[1] = max(-d, min(d, p[1]))
        return p

    def face(self, i, j) -> float:  # the way i faces to look at j (across)
        return 1.0 if self.pos[j][0] >= self.pos[i][0] else -1.0

    def run_to(self, i, j, side=None, dz=0.0) -> float:
        """i runs up to j, face to face across (on `side` of it: -1 left, 1 right; default the side it comes from) at
        j's depth (+ dz); the seconds it takes."""
        side = side if side is not None else (-1.0 if self.pos[i][0] < self.pos[j][0] else 1.0)
        to = self.clamp([self.pos[j][0] + side * self.R["clash_gap"], self.pos[j][1] + dz])
        if abs(to[0] - self.pos[j][0]) < self.R["clash_gap"] * 0.6:  # (pinned at a wall: the other side of it)
            to = self.clamp([self.pos[j][0] - side * self.R["clash_gap"], self.pos[j][1] + dz])
        to = self.aside(i, to, j)
        d = math.hypot(to[0] - self.pos[i][0], to[1] - self.pos[i][1])
        self.pos[i] = to
        return max(0.2, d / self.T["run_speed"]) if d > 0.05 else 0.0

    def aside(self, i, to, j=None):
        """Where i stands instead of `to` if someone else (not j) already stands there: the nearest free spot a step or
        two aside in depth (else a step back across too)."""
        P = self.T["personal"]

        def free(p):
            return all(math.hypot(self.pos[o][0] - p[0], self.pos[o][1] - p[1]) >= P
                       for o in range(self.n) if o not in (i, j) and self.alive(o))
        if free(to):
            return to
        back = 1.0 if j is None or self.pos[j][0] <= to[0] else -1.0
        for dx in (0.0, 0.5 * back, 1.0 * back):
            for dz in (P, -P, 2 * P, -2 * P, 3 * P, -3 * P):
                p = self.clamp([to[0] + dx, to[1] + dz])
                if free(p):
                    return p
        return to

    def knock(self, i, j, d):
        """i thrown back by d across, away from j (pulled in below 0, never through it); towards a wall closer than
        soft_wall, less far."""
        away = -self.face(i, j)
        if d > 0:
            room = self.wall - self.pos[i][0] * away
            d *= max(0.25, min(1.0, (room - 0.5) / self.T["soft_wall"]))
        o = self.pos[j][0]
        to = self.pos[i][0] + away * max(-self.R["kb_max"], min(self.R["kb_max"], d))
        if (to - o) * away < self.R["clash_gap"] * 0.4:
            to = o + away * self.R["clash_gap"] * 0.4
        self.pos[i] = self.aside(i, self.clamp([to, self.pos[i][1]]), j)

    def room(self, i, j) -> float:  # between i and the wall behind it (facing j)
        return self.wall + self.pos[i][0] * self.face(i, j)

    # --- the rules (versus_engine.Fight's, for any two)
    def flip(self) -> bool:
        return self.rnd.random() < self.R["heads"]

    def roll(self, sk, coins) -> int:
        return sk["base"] + sum(sk["coin"] for _ in range(coins) if self.flip())

    def hurt(self, i, dmg, atk, most, w=None) -> int:
        """i takes dmg (its resistance to atk; w: the one dealing it, the boss x its strength), at most `most`."""
        mult = (self.F[i]["resist"].get(atk, 1.0) or 1.0) * (self.boss_mult if w is not None and w == self.boss else 1.0)
        d = min(most, max(1, round(dmg * mult)))
        self.hp[i] = max(0, self.hp[i] - d)
        return d

    def cap(self, i, share=1.0) -> int:
        return max(1, round(self.max[i] * self.R["landing_cap"] * share))

    def most(self, w, d, share=1.0) -> int:
        """The most a blow of w that isn't a whole skill takes from d: its cap, and never d's last HP when d is the
        last one standing on its side (the fight's last kill is a skill: final_skill)."""
        m = self.cap(d, share)
        return min(m, self.hp[d] - 1) if len(self.foes(w)) == 1 else m

    def defense(self, d, shot=False) -> str | None:
        """How d meets a blow it doesn't clash: guards / evades (its own defense skill's kind, else 2 : 1), or (not a
        shot: it would have to run at the shooter) takes it and strikes back; or nothing."""
        o, rnd = self.o, self.rnd
        if not (o.get("defend") or o.get("counter")) or rnd.random() >= self.R["defend_p"]:
            return None
        if o.get("counter") and not shot and (not o.get("defend") or rnd.random() < (0.5 if self.F[d].get("counter") else 1 / 3)):
            return "Counter"
        if not o.get("defend"):
            return None
        g = self.F[d]["guard"]
        return g["kind"] if g else rnd.choices(["Guard", "Evade"], weights=self.R["guard_evade"])[0]

    def land(self, w, d, sk, coins, defense=None, share=1.0, kb=1.0, keep=False) -> tuple[int, int]:
        """w lands `coins` coins of sk on d (versus_engine.Fight.land's rules; damage and knockback x share / kb);
        (damage, coins dodged). keep: never d's last HP when it is the last one (see most)."""
        g = (self.F[d]["guard"] or self.R["plain_guard"]) if defense in ("Guard", "Evade") else None
        shield = self.roll(g, g["coins"]) if defense == "Guard" else 0
        total, missed, power, broken = 0, 0, sk["base"], False
        cap = self.most(w, d, share) if keep else self.cap(d, share)
        for _ in range(coins):
            if self.flip():
                power += sk["coin"]
            if defense == "Evade" and not broken:
                if self.roll(g, g["coins"]) > power:
                    missed += 1
                    continue
                broken = True
            dmg = max(0, power - shield) if defense == "Guard" else power
            shield = max(0, shield - power) if defense == "Guard" else 0
            if dmg <= 0 or total >= cap:
                continue
            total += self.hurt(d, dmg * share, sk["atk"], cap - total, w)
        if missed < coins and self.alive(d):
            force = sk["lastForce"] if coins == sk["coins"] else sk["coinForce"]
            self.knock(d, w, E.knock_bodies(force, self.kbs) * kb * (0.5 if defense == "Guard" else 1))
        return total, missed

    # --- choosing
    def target(self, i, taken=()) -> int | None:
        """Whom i goes for: the nearest one of the other side that isn't busy (nor in `taken`); a slow one only those
        in its zone (unless it has waited zone_wait seconds); none free: None."""
        if self.duels:
            j = self.mate.get(i)
            return j if j is not None and self.alive(j) and self.busy[j] <= self.t + 1e-6 else None
        foes = [j for j in self.foes(i) if self.busy[j] <= self.t + 1e-6 and j not in taken]
        if "slow" in self.role[i] and not self.all_at_once:
            near = [j for j in foes if self.in_zone(i, self.pos[j])]
            w = self.waited[i]
            if near or w is None or self.t - w < self.T["zone_wait"]:
                foes = near
        if not foes:
            return None
        if "mass" in self.role[i]:  # (one with mass attacks: where they stand closest together)
            return min(foes, key=lambda j: (round(self.dist(i, j) - 1.2 * len(self.near(j)), 2), self.rnd.random()))
        return min(foes, key=lambda j: (round(self.dist(i, j), 2), self.rnd.random()))

    def empty(self, i) -> bool:
        """i is a range one out of ammo."""
        return self.ammo[i] == 0

    def spend(self, i) -> float:
        """i fires one shot: its ammo down by one; the damage share of it (empty with nothing to fight up close with:
        empty_share, and it reloads — see reload_s)."""
        if self.ammo[i] < 0:
            return 1.0
        if self.ammo[i] > 0:
            self.ammo[i] -= 1
            return 1.0
        return self.T["empty_share"]

    def reload(self, i):
        if self.ammo[i] >= 0:
            self.ammo[i] = self.T["ammo"]

    def wants_shot(self, i, j) -> bool:
        if self.duels:
            return False
        rs = self.range_skills(i)
        if not rs or self.gap(i, j) <= self.R["close"] + 1e-6:
            return False
        if self.empty(i) and self.melee_skills(i):
            return False  # (out of ammo: it goes in to fight up close)
        if len(self.foes(i)) == 1 and self.hp[j] <= self.cap(j):
            return False  # (the fight's last kill: run in and land the longest skill, not a shot)
        if not self.melee_skills(i) or "range" in self.role[i]:
            return True  # (a range one always shoots from where it stands; it fights up close only when attacked there)
        return self.rnd.random() < self.T["shoot_mixed"]

    def joiners(self, a, d) -> list[int]:  # noqa: C901
        """Those that pile onto d with a: ready about now, with no other free target (d being taken), the cap not
        reached; a slow one never onto one already surrounded."""
        if self.duels:
            return []
        cap = self.T["boss_cap"] if d == self.boss else self.T["pile_cap"]
        out = []
        cands = [j for j in range(self.n) if j != a and self.alive(j) and self.side[j] != self.side[d]
                 and self.busy[j] <= self.t + 1e-6 and self.ready[j] <= self.t + self.T["join_window"]]
        cands.sort(key=lambda j: (self.ready[j], self.T["priority"][self.main_role(j)]))
        for j in cands:
            if 1 + len(out) >= cap:
                break
            if self.target(j, taken={d}) is not None:
                continue  # (it has someone else to go for)
            if "slow" in self.role[j] and (1 + len(out) >= 2 or not self.in_zone(j, self.pos[d])):
                continue
            out.append(j)
        return out

    # --- one engagement
    def engage(self, a) -> bool:
        d = self.target(a)
        c, dash = self.chase, False
        if a == self.boss and c is not None:  # (it turned on a shooter: it dashes at it, if it is free)
            self.chase = None
            if self.alive(c) and self.busy[c] <= self.t + 1e-6:
                d, dash = c, True
        if d is None:
            if "slow" in self.role[a] and self.waited[a] is None:
                self.waited[a] = self.t
            # (duels: its opponent has fallen — it stands by for good)
            self.ready[a] = round(self.t + (1e6 if self.duels and self.mate.get(a) is not None and not self.alive(self.mate[a]) else 0.5), 3)
            return False
        self.waited[a] = None
        self.eng += 1
        self.eng_start[self.eng] = self.t
        if self.wants_shot(a, d):
            self.shot(a, d)
        elif self.lone(a):
            # the lone one (a boss) goes for d: d and the rest of its side surround it
            dur = self.run_to(a, d) / (self.T["dash"] if dash else 1)
            if dur:
                self.log("run-in", a, d, dur, self.eng, dash=dash, result="dashes at the shooter" if dash else "runs in")
            self.t_run = dur
            A = [d] + self.joiners(d, a)
            self.melee(A, a, shooters={j for j in A[1:] if self.wants_shot(j, a)})
        else:
            A = [a] + self.joiners(a, d)
            self.melee(A, d, shooters={j for j in A[1:] if self.wants_shot(j, d)})
        return True

    def lone(self, i) -> bool:
        """i is the last one standing on its side, with two or more against it."""
        return not self.duels and not any(self.alive(j) and self.side[j] == self.side[i] and j != i for j in range(self.n)) and len(self.foes(i)) >= 2

    def finish(self, who: list[int], end: float):
        """Those in an engagement ending at `end`: busy until then, ready again after their cooldown (kept in cds for
        the cooldown bars). A slow one out of its zone walks back to it; one left near a wall walks back towards the
        middle (nobody hangs about at the stage's ends)."""
        at_end = end  # (as decided: log() puts it after other engagements' spotlight stops)
        end = self.thaw(end, self.eng) if self.freezes else end
        for i in who:
            self.busy[i] = end
            self.ready[i] = round(end + self.cooldown(i), 3)
        for i in who:
            if not self.alive(i):
                continue
            to, why = None, ""
            if "slow" in self.role[i] and not self.in_zone(i, self.pos[i]):
                h = self.home[i]
                to, why = [h[0] + self.rnd.uniform(-0.3, 0.3), h[1]], "walks back to its zone"
            elif "range" in self.role[i] and self.range_skills(i) and any(self.gap(i, o) <= self.R["close"] + 0.3 for o in self.foes(i)):
                o = min(self.foes(i), key=lambda o: self.dist(i, o))
                away = -self.face(i, o)
                x = self.pos[o][0] + away * self.T["shoot_gap"]
                if abs(x) > self.wall - 0.8:  # (no room behind it: the other way round, past the foe)
                    x = self.pos[o][0] - away * self.T["shoot_gap"]
                to, why = [x, self.pos[i][1]], "backs off to shoot again" + (", reloads" if self.ammo[i] >= 0 and self.ammo[i] < self.T["ammo"] else "")
                self.reload(i)
            elif self.wall - abs(self.pos[i][0]) < self.T["edge"]:
                x = self.pos[i][0]
                to = [(1 if x > 0 else -1) * (self.wall - self.T["edge_back"] - self.rnd.uniform(0, 0.8)), self.pos[i][1]]
                why = "walks back from the wall"
            if to is None:
                continue
            to = self.aside(i, self.clamp(to))
            dur = math.hypot(to[0] - self.pos[i][0], to[1] - self.pos[i][1]) / self.T["walk_speed"]
            self.pos[i] = to
            self.log("return", i, None, dur, self.eng, at=at_end, result=why)
            self.busy[i] = end + dur
            self.ready[i] = round(max(self.ready[i], end + dur), 3)
        for i in who:
            if self.alive(i) and self.ready[i] > self.busy[i] + 1e-3:
                self.cds[i].append([round(self.busy[i], 3), self.ready[i]])

    def kill_check(self, w, d, at) -> bool:
        """d fell to w: a beat for it; whether the fight is over (one side all down)."""
        if self.alive(d):
            return False
        self.dead_order.append(d)
        self.busy[d] = 1e9
        over = self.duel_open() == 0 if self.duels else not self.foes(w)
        self.log("falls", d, w, 0.0, self.eng, at=at, result=f"#{d} falls" + (", the fight is over" if over else ""))
        return over

    def shot(self, a, d):
        """a shoots d from where it stands (a range skill, all its coins): d can't clash it — it guards, evades or
        takes it, and stays where it is."""
        t0 = self.t
        sk = self.rnd.choice(self.range_skills(a))
        how = self.defense(d, shot=True)
        # (never the fight's last kill: that one is the longest skill, run in and landed — see landing)
        share = self.spend(a)
        dmg, missed = self.land(a, d, sk, sk["coins"], defense=how, share=share, keep=True)
        side = self.mass(a, d, sk, sk["coins"])
        if share < 1:  # (empty, nothing to fight up close with: it reloads after this one)
            self.reload(a)
        if d == self.boss and self.rnd.random() < self.T["boss_chase"]:
            self.chase = a  # (the boss turns on the shooter: see engage)
        res = f"{dmg} damage" + (f", {missed} of {sk['coins']} dodged" if how == "Evade" else "") + (", blocked" if how == "Guard" else "") \
            + "".join(f"; #{x['who']} {x['dmg']} (mass)" for x in side)
        self.log("shot", a, d, sk["seconds"], self.eng, skill=sk["group"], sk=sk, coins=sk["coins"], dmg=dmg,
                 dmgShare=dmg / self.max[d], defense=how, side=side, final=False, result=f"shoots from afar: {res}")
        end = t0 + sk["seconds"]
        over = False
        for v in [d] + [x["who"] for x in side]:
            over = self.kill_check(a, v, end) or over
        self.t_end([a, d], end, over)

    def final_skill(self, w) -> dict:
        """The fight's last kill: its longest skill (opts "randskill": one that ends within 4.5 s)."""
        sk = self.F[w]["skills"]
        if self.o.get("randskill"):
            short = [s for s in sk if s["seconds"] <= 4.5] or [min(sk, key=lambda s: s["seconds"])]
            return self.rnd.choice(short)
        return max(sk, key=lambda s: s["seconds"])

    def melee(self, A: list[int], d: int, shooters=()):
        """A (one or more) at d: an exchange of clashes. One attacker: versus_engine's exchange. Several (d
        surrounded): each clash d picks one at random to clash, the others' blows land; then a strong counter on one
        it fully parried, else the one that won most lands its skill, else they spring back."""
        R, T, rnd = self.R, self.T, self.rnd
        t = self.t + getattr(self, "t_run", 0.0)
        self.t_run = 0.0
        eng = self.eng
        surround = len(A) >= 2
        shooters = [k for k in A if k in shooters or (self.range_skills(k) and not self.melee_skills(k))]
        fighters = [k for k in A if k not in shooters] or A[:1]
        shooters = [k for k in shooters if k not in fighters]
        # the run in: the first from its side, the next from the other side, then behind them a little deeper / nearer
        for n, k in enumerate(fighters):
            s0 = -1.0 if self.pos[fighters[0]][0] < self.pos[d][0] else 1.0
            side = s0 * (-1 if n % 2 else 1)
            dur = self.run_to(k, d, side=side, dz=(0.0 if n < 2 else 0.45 * (1 if n == 2 else -1)))
            if dur:
                self.log("run-in", k, d, dur, eng, at=t, result="runs in" + (" (surrounding)" if n else ""))
                t += dur * (1.0 if n == 0 else 0.35)
        sks = {k: self.decks[k].skill("close", self.long_max) for k in A}
        for k in shooters:
            sks[k] = rnd.choice(self.range_skills(k))
        dsk = self.decks[d].skill("close", self.long_max)
        n = min(rnd.randint(*(T["exchange_short"] if self.short else T["exchange"])), max(1, self.clash_cap - self.clashes))
        wins = {k: [0, 0] for k in fighters}  # [k won, d won]
        last = fighters[0]
        armor_d = d == self.boss
        for r in range(n):
            k = rnd.choice(fighters) if surround and len(fighters) > 1 else fighters[0]
            if k != last and self.gap(k, d) > R["close"] + 1e-6:
                dur = self.run_to(k, d)
                self.log("run-in", k, d, dur, eng, at=t, result="runs back in")
                t += dur
            last = k
            p = [self.roll(sks[k], sks[k]["coins"]), self.roll(dsk, dsk["coins"])]
            while p[0] == p[1]:
                p = [self.roll(sks[k], sks[k]["coins"]), self.roll(dsk, dsk["coins"])]
            lo = k if p[0] < p[1] else d
            edge = ""
            pinned = [i for i in (k, d) if self.room(i, d if i == k else k) < R["edge_room"]]
            if pinned:
                i = min(pinned, key=lambda i: self.room(i, d if i == k else k))
                if lo == i and rnd.random() < R["edge_win"]:
                    lo = d if i == k else k
                    edge = f" (#{i} has its back to the wall: pushes out)"
                    if i == k:
                        p[0] = p[1] + rnd.randint(1, 3)
                    else:
                        p[1] = p[0] + rnd.randint(1, 3)
            if armor_d and lo == k:
                self.streak += 1
                if self.streak > T["boss_streak"]:
                    lo, self.streak = d, 0
                    p[0] = p[1] + rnd.randint(1, 3)
                    edge += " (the boss lets one through)"
            elif armor_d:
                self.streak = 0
            wn = d if lo == k else k
            wins[k][0 if wn == k else 1] += 1
            self.clashes += 1
            self.knock(lo, wn, R["loser_push"])
            # the others' blows land on d meanwhile (one coin each; a shooter's a shot) — d flinches, isn't thrown
            extras = []
            for e in A:
                if e == k or not self.alive(d):
                    continue
                if e in shooters or (e in fighters and self.gap(e, d) <= R["close"] + 1e-6):
                    m = self.most(e, d, 0.5)
                    dmg = self.hurt(d, self.roll(sks[e], 1) * T["extra_share"], sks[e]["atk"], m, e) if m > 0 else 0
                    extras.append({"who": e, "dmg": dmg, "dmgShare": dmg / self.max[d], "shot": e in shooters})
            s = self.log("clash", wn, d if wn == k else k, T["clash_s"], eng, at=t, att=k, def_=d, loser=lo, pow=p,
                         skills={k: sks[k]["group"], d: dsk["group"]}, extras=extras, nth=[r + 1, n],
                         result=f"wins {max(p)} to {min(p)}, #{lo} knocked back{edge}"
                         + "".join(f"; #{x['who']} lands a blow ({x['dmg']})" for x in extras))
            s["anims"] = {k: self.decks[k].clash(sks[k]), d: self.decks[d].clash(dsk)}
            t += T["clash_s"]
            if not self.alive(d):
                over = self.kill_check(extras[-1]["who"], d, t)
                self.t_end(A + [d], t, over)
                return
            if r < n - 1 and not surround:
                dur = self.run_to(wn, lo)
                if dur:
                    self.log("run-in", wn, lo, dur, eng, at=t, result="runs at it")
                    t += dur
        # after the exchange
        over = False
        full = [k for k in fighters if wins[k][0] == 0 and wins[k][1] >= 2] if surround else []
        best = max(fighters, key=lambda k: (wins[k][0] - wins[k][1], rnd.random()))
        worst = min(fighters, key=lambda k: (wins[k][0] - wins[k][1], rnd.random()))
        if surround and d == self.boss and not full:
            # (the boss surrounded: the clashes it won against all of them together decide — not its worst pair)
            ta, tb = sum(w[0] for w in wins.values()), sum(w[1] for w in wins.values())
            if ta == tb:
                best = worst = fighters[0]
                wins = {fighters[0]: [0, 0]}
            elif tb > ta:
                best = worst
                wins = {worst: [0, 1]}
            else:
                worst = best
                wins = {best: [1, 0]}
        if full:
            k = rnd.choice(full)
            t, over = self.strong_counter(d, k, [x for x in A if x != k], dsk, t)
        elif wins[best][0] > wins[best][1]:
            t, over = self.landing(best, d, sks[best], t, helpers=[x for x in A if x != best])
        elif wins[worst][1] > wins[worst][0]:
            t, over = self.landing(d, worst, dsk, t, others=[x for x in A if x != worst], helpers=[x for x in A if x != worst])
        else:
            for k in fighters:
                if self.gap(k, d) <= R["close"] + 1e-6:
                    self.knock(k, d, R["near_gap"] - R["clash_gap"])
            self.log("stand-off", -1, d, T["hold_s"], eng, at=t, extras=[{"who": k} for k in fighters], result="nobody hit, they spring apart")
            t += T["hold_s"]
        self.t_end(A + [d], t, over)

    def t_end(self, who, t, over):
        self.finish([i for i in who if self.alive(i)], t)
        if over:
            self.over = True

    def landing(self, w, v, sk, t, others=(), helpers=()) -> tuple[float, bool]:
        """w lands its skill sk on v (its run at it, a defense now and then, a counter); the boss landing it with
        others around: armor on its later skills (they can't cut it short), else a blow may cut it to one coin."""
        R, T = self.R, self.T
        eng = self.eng
        dur = self.run_to(w, v)
        if dur:
            self.log("run-in", w, v, dur, eng, at=t, result="runs at it")
            t += dur
        how = self.defense(v)
        if (self.duel_open() == 1 if self.duels else len(self.foes(w)) == 1) and self.hp[v] <= self.cap(v):
            how = None  # (the fight's last blow lands clean)
        coins, armor, cut = sk["coins"], False, None
        if w == self.boss and (others or self.aggro):
            armor = sk is not self.F[w]["skills"][0]
            if armor:
                self.armor_until = max(self.armor_until, t + sk["seconds"])
            if others and not armor and self.rnd.random() < T["interrupt_p"]:
                cut = self.rnd.choice(list(others))
                coins = 1
        dmg, missed = self.land(w, v, sk, coins, defense=how if how != "Counter" else None)
        side = self.mass(w, v, sk, coins)
        final = not self.alive(v) and (self.duel_open() == 0 if self.duels else not self.foes(w))
        shown = self.final_skill(w) if final else sk
        # the others in the engagement don't wait through a skill that isn't a spotlight one: each lands a blow
        # meanwhile (one coin at extra_share — on the boss boss_blow, armor_blow in its armor; a shooter its shot) on the
        # other side's one of the two
        helps = []
        if helpers and not final and not spotlight(self.F[w], shown):
            for h in helpers:
                tg = v if self.side[h] == self.side[w] else w
                if not self.alive(h) or not self.alive(tg) or h in (w, v):
                    continue
                shooter = bool(self.range_skills(h)) and (not self.melee_skills(h) or "range" in self.role[h])
                if not shooter and self.gap(h, tg) > R["close"] + 0.3:
                    continue
                hs = self.rnd.choice(self.range_skills(h)) if shooter else self.decks[h].skill("close", self.long_max)
                share = (T["armor_blow"] if armor and tg == w else T["boss_blow"]) if tg == self.boss else T["extra_share"]
                m = self.most(h, tg, 0.5)
                d2 = self.hurt(tg, self.roll(hs, 1) * share, hs["atk"], m, h) if m > 0 else 0
                helps.append({"who": h, "on": tg, "dmg": d2, "dmgShare": d2 / self.max[tg], "shot": shooter})
        res = f"{dmg} damage" + (f", {missed} dodged" if how == "Evade" else "") + (", blocked" if how == "Guard" else "") \
            + (", taken to strike back" if how == "Counter" else "") + (", it can't be interrupted" if armor else "") \
            + (f", #{cut} cuts it short" if cut is not None else "") + "".join(f"; #{x['who']} {x['dmg']} (mass)" for x in side) \
            + "".join(f"; #{x['who']} lands a blow on #{x['on']} ({x['dmg']})" for x in helps)
        self.log("whole", w, v, shown["seconds"], eng, at=t, skill=shown["group"], sk=shown, coins=shown["coins"] if final else coins,
                 dmg=dmg, dmgShare=dmg / self.max[v], defense=how, armor=armor, side=side, final=final, result=res, extras=helps)
        t += shown["seconds"] if coins == sk["coins"] else T["counter_s"]
        if cut is not None and self.alive(w):
            cs = self.decks[cut].skill("close", self.long_max)
            d2 = self.hurt(w, self.roll(cs, 1), cs["atk"], self.most(cut, w, 0.5)) if self.most(cut, w, 0.5) > 0 else 0
            self.log("interrupt", cut, w, T["counter_s"], eng, at=t, dmg=d2, dmgShare=d2 / self.max[w], result=f"cuts in: {d2} damage")
            t += T["counter_s"]
            if self.kill_check(cut, w, t):
                return t, True
        over = False
        for x in [v] + [x["who"] for x in side]:
            over = self.kill_check(w, x, t) or over
        for x in helps:
            over = self.kill_check(x["who"], x["on"], t) or over
        if over:
            return t, True
        if not self.alive(w):
            return t, False
        if how == "Counter" and self.alive(v):
            c = self.F[v].get("counter") or self.F[v]["skills"][0]
            power = self.roll(c, c["coins"])
            d2 = self.hurt(w, power, c.get("atk") or "", min(self.cap(w), self.hp[w] - 1)) if self.hp[w] > 1 else 0  # (a counter never kills)
            self.knock(w, v, E.knock_bodies(c.get("lastForce") or 2, self.kbs))
            self.log("counter", v, w, T["counter_s"], eng, at=t, dmg=d2, dmgShare=d2 / self.max[w], anim=self.decks[v].counter_coin(),
                     result=f"strikes back: {d2} damage")
            t += T["counter_s"]
        return t, False

    def strong_counter(self, d, k, others, dsk, t) -> tuple[float, bool]:
        """d fully parried k: its whole skill on k (the boss: can't be interrupted), and the others near d hit by it
        weaker (strong_side of the damage and knockback)."""
        T = self.T
        eng = self.eng
        sk = max([s for s in self.F[d]["skills"] if s["seconds"] <= self.long_max] or self.F[d]["skills"], key=lambda s: s["coins"])
        dmg, _ = self.land(d, k, sk, sk["coins"])
        if d == self.boss:
            self.armor_until = max(self.armor_until, t + sk["seconds"])
        side = []
        reach = max(T["side_reach"], T["mass_reach"] if "mass" in self.stags(d, sk) else 0)
        for o in others:
            if self.alive(o) and self.dist(o, d) <= reach:
                x, _ = self.land(d, o, sk, sk["coins"], share=T["strong_side"], kb=T["strong_side"])
                side.append({"who": o, "dmg": x, "dmgShare": x / self.max[o]})
        final = (not self.alive(k) or any(not self.alive(x["who"]) for x in side)) and not self.foes(d)
        shown = self.final_skill(d) if final else sk
        self.log("strong", d, k, shown["seconds"], eng, at=t, skill=shown["group"], sk=shown, coins=shown["coins"], dmg=dmg,
                 dmgShare=dmg / self.max[k], side=side, armor=d == self.boss, final=final,
                 result=f"fully parried #{k}: strong counter, {dmg} damage" + "".join(f"; #{x['who']} {x['dmg']}" for x in side))
        t += shown["seconds"]
        over = False
        for v in [k] + [x["who"] for x in side]:
            over = self.kill_check(d, v, t) or over
        return t, over


    # --- aggro (opts "flow": "aggro"): no queue, no exchanges — everyone fights its own target at once, blow after blow
    def aggro_eng(self, a, b) -> int:
        """The id of the pair a-b's fight (the engine view draws its beats together)."""
        k = (min(a, b), max(a, b))
        if k not in self.pairs:
            self.pairs[k] = len(self.pairs) + 1
        return self.pairs[k]

    def aggro_pick(self, i) -> int | None:
        """A new target for i (versus_team's target rules; busy ones too — whoever fights someone else may be hit
        meanwhile), and a new skill to fight it with: its clashes until the skill is spent (its coins, at least 2)."""
        foes = self.foes(i)
        if "slow" in self.role[i]:
            near = [j for j in foes if self.in_zone(i, self.pos[j])]
            w = self.waited[i]
            if near or w is None or self.t - w < self.T["zone_wait"]:
                foes = near
        if not foes:
            return None
        # (the nearest, but one already fought by several is less tempting; a mass one goes where they stand together)
        load = {j: sum(1 for k in range(self.n) if self.alive(k) and self.tgt[k] == j and k != i) for j in foes}
        mass = 1.2 if "mass" in self.role[i] else 0.0
        j = min(foes, key=lambda j: (round(self.dist(i, j) + 1.2 * load[j] - mass * len(self.near(j)), 2), self.rnd.random()))
        self.waited[i] = None
        self.aggro_set(i, j)
        return j

    def aggro_set(self, i, j):
        rs = self.range_skills(i)
        shooter = rs and "range" in self.role[i] and not (self.empty(i) and self.melee_skills(i))
        if i == self.boss and j != self.chase:
            self.chase = None
        self.tgt[i] = j
        melee = [x for x in self.melee_skills(i) if x["seconds"] <= self.long_max]
        self.sk[i] = self.rnd.choice(rs) if shooter else self.rnd.choice(melee) if self.empty(i) and melee else self.decks[i].clash_skill(self.long_max)
        self.uses[i] = 1 if shooter else max(2, min(4, self.sk[i]["coins"]))
        self.won[i] = self.lost[i] = 0
        end = self.t + self.rnd.uniform(*self.T["aggro_time"][self.main_role(i)])
        self.agg_end[i] = end
        self.aggs[i].append([round(self.t, 3), round(end, 3), j])

    def aggro_drop(self, i):
        """i's aggro ends now (its bar empties)."""
        if self.aggs[i] and self.aggs[i][-1][1] > self.t:
            self.aggs[i][-1][1] = round(self.t, 3)
        self.tgt[i] = None

    def aggro_act(self, i):  # noqa: C901
        """i's next beat at self.t: (its skill spent with more won than lost: it lands it) a new target / skill if
        needed, then a shot, a run in, a free blow on a target busy with someone else, or a clash."""
        R, T, rnd = self.R, self.T, self.rnd
        t = self.t
        j = self.tgt[i]
        spent = self.uses[i] <= 0 or (i == self.boss and self.won[i] >= T["boss_land_wins"])
        if j is not None and self.alive(j) and spent and self.won[i] > self.lost[i] and self.gap(i, j) <= R["close"] + 0.5 \
                and self.busy[j] <= t + 1e-6:
            # its skill spent, more of its clashes won than lost: it lands that skill
            self.eng = self.aggro_eng(i, j)
            end, over = self.landing(i, j, self.sk[i], t)
            self.busy[i] = self.busy[j] = end
            self.partner[i], self.partner[j] = j, i
            self.aggro_drop(i)
            self.over = self.over or over
            return
        if j is None or not self.alive(j) or t >= self.agg_end[i] - 1e-6 or self.uses[i] <= 0:
            self.aggro_drop(i)
            if self.back_off(i, t):  # (a range one fought up close: it backs off to shoot again first)
                return
            j = self.aggro_pick(i)
            if j is None:  # (nobody to go for: a slow one waits in its zone, walking back to it)
                if "slow" in self.role[i] and self.waited[i] is None:
                    self.waited[i] = t
                self.finish_walk(i, t)
                self.busy[i] = max(self.busy[i], t + 0.4)
                self.partner[i] = None
                return
        self.eng = self.aggro_eng(i, j)
        if self.empty(i) and self.sk[i] in self.range_skills(i) and self.melee_skills(i):
            melee = [x for x in self.melee_skills(i) if x["seconds"] <= self.long_max] or self.melee_skills(i)
            self.sk[i] = self.rnd.choice(melee)  # (out of ammo: it goes in to fight up close)
            self.uses[i] = max(2, min(4, self.sk[i]["coins"]))
        if self.sk[i] in self.range_skills(i) and self.wants_shot(i, j) and self.aim[i] > t + 1e-6:
            self.busy[i] = self.aim[i]  # (still taking aim)
            self.partner[i] = None
            return
        if self.sk[i] in self.range_skills(i) and self.wants_shot(i, j):
            # a shot from where it stands: the other one takes it (or guards / evades) and goes on with its own fight
            sk = self.sk[i]
            how = self.defense(j, shot=True)
            share = self.spend(i)
            dmg, missed = self.land(i, j, sk, sk["coins"], defense=how, share=share * T["shot_share"] * (T["boss_shot"] if j == self.boss else 1), keep=True)
            side = self.mass(i, j, sk, sk["coins"])
            res = f"{dmg} damage" + (", blocked" if how == "Guard" else "") + (f", {missed} dodged" if how == "Evade" else "") \
                + "".join(f"; #{x['who']} {x['dmg']} (mass)" for x in side)
            self.log("shot", i, j, sk["seconds"], self.eng, skill=sk["group"], sk=sk, coins=sk["coins"], dmg=dmg,
                     dmgShare=dmg / self.max[j], defense=how, side=side, result=f"shoots from afar: {res}")
            self.busy[i] = self.shooting[i] = t + sk["seconds"]
            self.aim[i] = t + sk["seconds"] + self.rnd.uniform(*T["aim"])  # (and takes aim again: it may fight meanwhile)
            if share < 1:  # (empty, nothing to fight up close with: it reloads, longer)
                self.reload(i)
                self.aim[i] += T["reload_s"]
            self.partner[i] = j
            self.uses[i] = 0
            if j == self.boss and self.tgt[j] != i and self.chase is None and rnd.random() < T["boss_chase"]:
                self.aggro_drop(j)  # (the boss turns on the shooter: it dashes at it as soon as it is free)
                self.aggro_set(j, i)
                self.chase = i
            for v in [j] + [x["who"] for x in side]:
                self.over = self.kill_check(i, v, t + sk["seconds"]) or self.over
            return
        if self.gap(i, j) > R["close"] + 1e-6:
            dash = i == self.boss and self.chase == j
            dur = self.run_to(i, j) / (T["dash"] if dash else 1)
            self.log("run-in", i, j, dur, self.eng, dash=dash, result="dashes at the shooter" if dash else "runs at it")
            if dash:
                self.chase = None
            self.busy[i] = t + max(dur, 0.15)
            self.partner[i] = None
            return
        open_ = self.shooting[j] > t + 1e-6 and self.blown.get((i, j)) != self.busy[j]  # (it plays its shot: wide open)
        if self.busy[j] > t + 1e-6 and not open_ and (self.partner[j] in (None, i) or self.blown.get((i, j)) == self.busy[j]):
            # (it is on its way, or busy with i itself: i meets it as soon as it is free — they clash then)
            self.busy[i] = self.busy[j]
            self.partner[i] = j
            return
        if self.busy[j] > t + 1e-6:
            # its target is busy with someone else: a blow lands meanwhile (half a coin's power; the boss in its
            # armor doesn't flinch); now and then it turns on the one hitting it
            self.blown[(i, j)] = self.busy[j]
            armor = j == self.boss and self.armor_until > t + 1e-6
            share = T["armor_blow"] if armor else T["boss_blow"] if j == self.boss else T["extra_share"]
            m = self.most(i, j, 0.5)
            dmg = self.hurt(j, self.roll(self.sk[i], 1) * share, self.sk[i]["atk"], m, i) if m > 0 else 0
            self.log("blow", i, j, T["extra_s"], self.eng, dmg=dmg, dmgShare=dmg / self.max[j], armor=armor,
                     result=f"lands a blow while it is busy: {dmg}" + (" (it can't be interrupted)" if armor else ""))
            self.busy[i] = t + T["extra_s"]
            self.partner[i] = j
            self.uses[i] -= 1
            self.won[i] += 1
            self.over = self.kill_check(i, j, t + T["extra_s"]) or self.over
            return
        # a clash with it (or it guards / evades instead): versus_engine's series, one blow
        if self.tgt[j] is None or not self.alive(self.tgt[j]):
            self.aggro_set(j, i)
        jsk = self.sk[j] or self.decks[j].clash_skill(self.long_max)
        if self.o.get("defend") and rnd.random() < T["defend_series"]:
            g0 = self.F[j]["guard"]
            how = g0["kind"] if g0 else rnd.choices(["Guard", "Evade"], weights=R["guard_evade"])[0]
            if how in ("Guard", "Evade"):
                g = self.F[j]["guard"] or R["plain_guard"]
                hit = max(0, self.roll(self.sk[i], 1) - self.roll(g, g["coins"])) if how == "Guard" else 0
                m = self.most(i, j, 0.5)
                dmg = self.hurt(j, hit, self.sk[i]["atk"], m, i) if hit and m > 0 else 0
                if how == "Guard":
                    self.knock(j, i, 0.15)
                self.log("clash", i, j, T["clash_s"], self.eng, att=i, def_=j, loser=-1, pow=[0, 0], defense=how, dmg=dmg,
                         dmgShare=dmg / self.max[j], skills={i: self.sk[i]["group"], j: jsk["group"]}, extras=[], nth=[0, 0],
                         result=f"#{j} {how.lower()}s" + (f", {dmg} damage" if dmg else ""),
                         anims={i: self.decks[i].clash(self.sk[i]), j: None})
                self.busy[i] = self.busy[j] = t + T["clash_s"]
                self.partner[i], self.partner[j] = j, i
                self.uses[i] -= 1
                self.won[i] += 1
                self.clashes += 1
                return
        p = [self.roll(self.sk[i], self.sk[i]["coins"]), self.roll(jsk, jsk["coins"])]
        while p[0] == p[1]:
            p = [self.roll(self.sk[i], self.sk[i]["coins"]), self.roll(jsk, jsk["coins"])]
        lo = i if p[0] < p[1] else j
        edge = ""
        for a, b in ((i, j), (j, i)):
            if lo == a and self.room(a, b) < R["edge_room"] and rnd.random() < R["edge_win"]:
                lo = b
                edge = f" (#{a} has its back to the wall: pushes out)"
                p = [p[1] + rnd.randint(1, 3), p[1]] if a == i else [p[0], p[0] + rnd.randint(1, 3)]
                break
        if self.boss in (i, j):
            b = self.boss
            if lo != b:
                self.streak += 1
                if self.streak > T["boss_streak"]:
                    lo, self.streak = b, 0
                    edge += " (the boss lets one through)"
                    p = [p[1] + 1, p[1]] if b == j else [p[0], p[0] + 1]
            else:
                self.streak = 0
        wn = j if lo == i else i
        self.clashes += 1
        self.close_fights[i] += 1
        self.close_fights[j] += 1
        self.knock(lo, wn, R["loser_push"])
        self.log("clash", wn, lo, T["clash_s"], self.eng, att=i, def_=j, loser=lo, pow=p,
                 skills={i: self.sk[i]["group"], j: jsk["group"]}, extras=[], nth=[self.clashes, 0],
                 result=f"wins {max(p)} to {min(p)}, #{lo} knocked back{edge}",
                 anims={i: self.decks[i].clash(self.sk[i]), j: self.decks[j].clash(jsk)})
        end = t + T["clash_s"]
        self.busy[i] = self.busy[j] = end
        self.partner[i], self.partner[j] = j, i
        for a in (i, j):
            if self.tgt[a] == (j if a == i else i):
                self.uses[a] -= 1
                if a == wn:
                    self.won[a] += 1
                else:
                    self.lost[a] += 1
        # the boss fully parrying one (it won its last clashes against it): a strong counter on it
        if wn == self.boss and lo != self.boss:
            self.parried[lo] = self.parried.get(lo, 0) + 1
            if self.parried[lo] >= T["full_parry"]:
                self.parried[lo] = 0
                others = [k for k in range(self.n) if k != lo and self.alive(k) and self.side[k] != self.side[self.boss]]
                end2, over = self.strong_counter(self.boss, lo, others, jsk, end)
                for k in [self.boss, lo] + [k for k in others if self.dist(k, self.boss) <= T["side_reach"]]:
                    self.busy[k] = max(self.busy[k], end2)
                    self.partner[k] = lo if k == self.boss else self.boss
                self.over = self.over or over
                return
        elif lo == self.boss:
            self.parried[wn] = 0
        # the one it fights now and then turns on it (retaliation)
        if self.tgt[j] != i and rnd.random() < T["retaliate"][self.main_role(j)]:
            self.aggro_drop(j)
            self.aggro_set(j, i)
        # the winner follows up now and then with a whole skill; the last one standing low: the fight's last skill
        last = len(self.foes(wn)) == 1 and self.hp[lo] <= self.cap(lo)
        fits = [x for x in self.melee_skills(wn) if x["seconds"] <= self.T["burst_max"]]
        if last or (fits and rnd.random() < (T["boss_burst_p"] if wn == self.boss else T["burst_p"])):
            sk = self.sk[wn] if last else rnd.choice(fits)
            self.eng = self.aggro_eng(wn, lo)
            end2, over = self.landing(wn, lo, sk, end)
            self.busy[wn] = self.busy[lo] = end2
            self.partner[wn], self.partner[lo] = lo, wn
            self.over = self.over or over

    def back_off(self, i, t) -> bool:
        """(aggro) a range one that has fought up close (back_after clashes there) backs off shoot_gap from its nearest
        foe to shoot again (as after an engagement in the exchanges flow); whether it did. Not while it goes in for the
        fight's last kill."""
        if "range" not in self.role[i] or not self.range_skills(i) or self.close_fights[i] < self.T["back_after"]:
            return False
        close = [o for o in self.foes(i) if self.gap(i, o) <= self.R["close"] + 0.3]
        if not close or (len(self.foes(i)) == 1 and self.hp[close[0]] <= self.cap(close[0])):
            return False
        self.close_fights[i] = 0
        o = min(close, key=lambda o: self.dist(i, o))
        away = -self.face(i, o)
        x = self.pos[o][0] + away * self.T["shoot_gap"]
        if abs(x) > self.wall - 0.8:  # (no room behind it: the other way round, past the foe)
            x = self.pos[o][0] - away * self.T["shoot_gap"]
        to = self.aside(i, self.clamp([x, self.pos[i][1]]))
        dur = math.hypot(to[0] - self.pos[i][0], to[1] - self.pos[i][1]) / self.T["walk_speed"]
        self.pos[i] = to
        self.log("return", i, None, dur, 0, at=t, result="backs off to shoot again" + (", reloads" if self.ammo[i] < self.T["ammo"] else ""))
        self.reload(i)
        self.busy[i] = t + max(dur, 0.2)
        self.partner[i] = None
        return True

    def finish_walk(self, i, t):
        """(aggro) one with nobody to go for walks back to its zone (slow) or away from a wall."""
        to, why = None, ""
        if "slow" in self.role[i] and not self.in_zone(i, self.pos[i]):
            to, why = [self.home[i][0] + self.rnd.uniform(-0.3, 0.3), self.home[i][1]], "walks back to its zone"
        elif self.wall - abs(self.pos[i][0]) < self.T["edge"]:
            x = self.pos[i][0]
            to, why = [(1 if x > 0 else -1) * (self.wall - self.T["edge_back"]), self.pos[i][1]], "walks back from the wall"
        if to is None:
            return
        to = self.aside(i, self.clamp(to))
        dur = math.hypot(to[0] - self.pos[i][0], to[1] - self.pos[i][1]) / self.T["walk_speed"]
        self.pos[i] = to
        self.log("return", i, None, dur, 0, at=t, result=why)
        self.busy[i] = t + dur

    def run_aggro(self) -> dict:
        """Aggro: everyone fights at once; each one picks its target (and a skill) and keeps at it — clashes blow
        after blow, the loser knocked back and the winner after it — until the skill is spent (then, more won than
        lost, it lands it), its aggro runs out (aggro_time by its role), its target falls or it turns on someone
        hitting it. A target busy with someone else takes free blows. No cooldowns, no queue."""
        T = self.T
        self.over = False
        self.log("start", -1, None, 0.0, 0, result="the fight starts")
        self.steps[-1]["p"] = {i: list(self.pos[i]) for i in range(self.n)}
        self.steps[-1]["h"] = {i: self.hp[i] for i in range(self.n)}
        for i in range(self.n):
            self.busy[i] = self.ready[i]
        guard = 0
        while not self.over and all(any(self.alive(i) and self.side[i] == s for i in range(self.n)) for s in (0, 1)):
            guard += 1
            if guard > 20000 or self.clashes >= self.clash_cap:
                self.finale()
                break
            alive = [i for i in range(self.n) if self.alive(i)]
            i = min(alive, key=lambda i: (self.busy[i], T["priority"][self.main_role(i)], self.rnd.random()))
            self.t = max(self.t, self.busy[i])
            self.aggro_act(i)
        for i in range(self.n):
            if self.aggs[i] and self.aggs[i][-1][1] > self.t:
                self.aggs[i][-1][1] = round(self.t, 3)
        return self.result()

    # --- the whole fight
    def run(self) -> dict:
        if self.aggro:
            return self.run_aggro()
        T = self.T
        self.over = False
        self.log("start", -1, None, 0.0, 0, result="the fight starts")
        self.steps[-1]["p"] = {i: list(self.pos[i]) for i in range(self.n)}
        self.steps[-1]["h"] = {i: self.hp[i] for i in range(self.n)}
        guard = 0
        while not self.over and all(any(self.alive(i) and self.side[i] == s for i in range(self.n)) for s in (0, 1)):
            guard += 1
            if guard > 5000 or self.clashes >= self.clash_cap:
                self.finale()
                break
            fz = next((b for a, b, _ in self.freezes if a - 1e-6 <= self.t < b - 1e-6), None)
            if fz is not None:  # (a spotlight attack plays: nothing new starts until it is over)
                self.t = fz
                continue
            running = sum(1 for i in range(self.n) if self.busy[i] > self.t + 1e-6 and self.alive(i) and self.busy[i] < 1e8)
            lanes_busy = len({s["eng"] for s in self.steps if s["eng"] and s["t"] + s["dur"] > self.t + 1e-6}) if running else 0
            free = self.lanes == 0 or lanes_busy < self.lanes
            cands = [i for i in range(self.n) if self.alive(i) and self.busy[i] <= self.t + 1e-6 and self.ready[i] <= self.t + 1e-6]
            cands.sort(key=lambda i: (self.ready[i], T["priority"][self.main_role(i)], self.rnd.random()))
            started = False
            if free and cands:
                for a in cands:
                    if self.engage(a):
                        started = True
                        break
            if started:
                continue
            # nothing to start now: on to the next moment something frees up
            nxt = [b for b in self.busy if b > self.t + 1e-6 and b < 1e8] + [r for i, r in enumerate(self.ready) if r > self.t + 1e-6 and self.alive(i)]
            self.t = min(nxt) if nxt else self.t + 0.5
        return self.result()

    def finale(self):
        """Too long: the side with less of its HP left falls, one by one, to the other side's blows (the last one to
        the longest skill)."""
        share = [sum(self.hp[i] for i in range(self.n) if self.side[i] == s) / max(1, sum(self.max[i] for i in range(self.n) if self.side[i] == s)) for s in (0, 1)]
        lose = 0 if share[0] < share[1] else 1
        t = max([self.t] + [b for b in self.busy if b < 1e8])
        for v in [i for i in range(self.n) if self.side[i] == lose and self.alive(i)]:
            w = min([i for i in range(self.n) if self.side[i] != lose and self.alive(i)], key=lambda i: self.dist(i, v))
            self.eng += 1
            self.eng_start[self.eng] = t
            last = sum(1 for i in range(self.n) if self.side[i] == lose and self.alive(i)) == 1
            sk = self.final_skill(w) if last else self.decks[w].skill("close", self.long_max)
            dur = self.run_to(w, v)
            if dur:
                self.log("run-in", w, v, dur, self.eng, at=t, result="runs in")
                t += dur
            d = self.hp[v]
            self.hp[v] = 0
            self.log("whole", w, v, sk["seconds"], self.eng, at=t, skill=sk["group"], sk=sk, coins=sk["coins"], dmg=d,
                     dmgShare=d / self.max[v], final=last, result=f"#{v} falls" if not last else "the last one falls")
            t += sk["seconds"]
            self.dead_order.append(v)
        self.t = t

    def result(self) -> dict:
        """The steps in time order, each with everyone's positions / HP after it and when each one is ready again."""
        # (beats are decided one after another but may be logged out of time order — fights going on at once: each
        # beat's HP change is taken in the order it was decided, then added up in time order)
        last = list(self.max)
        for s in self.steps:
            s["dh"] = {}
            for i, h in s.pop("h").items():
                if h != last[i]:
                    s["dh"][i] = h - last[i]
                    last[i] = h
        steps = sorted(self.steps, key=lambda s: s["t"])
        pos = [list(p) for p in self.home]
        hp = list(self.max)
        for s in steps:
            for i, p in s.pop("p").items():
                pos[i] = p
            for i, d in s.pop("dh").items():
                hp[i] += d
            s["x"] = [list(p) for p in pos]
            s["hp"] = list(hp)
        alive = [s for s in (0, 1) if any(self.hp[i] > 0 and self.side[i] == s for i in range(self.n))]
        winner = alive[0] if len(alive) == 1 else 0
        if self.duels and len(alive) == 2:  # (every pair settled: the side with more of its fighters left, else more HP)
            up = [sum(1 for i in self.mate if self.side[i] == s and self.alive(i)) for s in (0, 1)]
            share = [sum(self.hp[i] for i in self.mate if self.side[i] == s) / max(1, sum(self.max[i] for i in self.mate if self.side[i] == s)) for s in (0, 1)]
            winner = 0 if (up[0], share[0]) >= (up[1], share[1]) else 1
        return {"team": True, "steps": steps, "winner": winner, "seed": self.seed, "hp": list(self.hp), "hpMax": self.max,
                "side": self.side, "clashes": self.clashes, "boss": self.boss, "roles": [sorted(r) for r in self.role],
                "home": self.home, "wall": self.wall, "depth": self.T["depth"], "cds": self.cds, "tags": self.tags, "aggs": self.aggs,
                "flow": "aggro" if self.aggro else "duels" if self.duels else "exchanges", "bossPower": float(self.o.get("bossPower") or 1), "freezes": self.freezes,
                "time": round(max((s["t"] + s["dur"] for s in steps), default=0), 2)}


_FAIR = {}


def fair_boss(F: list, side: list, tags: list, opts: dict, places=None) -> float:
    """The boss's strength (its HP and damage x the square root of it each: the fight's length moves only half as
    much as by HP alone) that makes it win about TEAM["fair"] of its fights against these ones (with these options):
    line-ups differ far too much for one rule (a boss with mass skills sweeps a party, one with a coin a skill against
    shooters never gets a skill in), so for each of fair_seeds fixed fights the strength it starts winning at is
    halved in on (log scale, 0.15-12), and the one that many of them are won at taken. 1.0 without a boss. Kept for the
    line-up."""
    counts = [side.count(0), side.count(1)]
    if not any(counts[s] == 1 and counts[1 - s] >= 2 for s in (0, 1)):
        return 1.0
    key = json.dumps([[str(f["cid"]) for f in F], side, tags, {k: v for k, v in opts.items() if k not in ("winner", "bossPower")}, places],
                     sort_keys=True, default=str)
    if key in _FAIR:
        return _FAIR[key]
    n, want = TEAM["fair_seeds"], TEAM["fair"]

    def wins(seed, m):
        b = Battle(F, side, tags, seed, dict(opts, bossPower=m, winner=None), places=places)
        return b.run()["winner"] == side[b.boss]
    th = []
    for k in range(n):
        lo, hi = math.log(0.15), math.log(12.0)
        for _ in range(6):
            mid = (lo + hi) / 2
            lo, hi = (lo, mid) if wins(900000 + k, math.exp(mid)) else (mid, hi)
        th.append((lo + hi) / 2)
    th.sort()
    m = round(math.exp(th[min(n - 1, int(want * n))]), 3)
    if len(_FAIR) > 200:
        _FAIR.clear()
    _FAIR[key] = m
    return m


def simulate(F: list, side: list, tags: list, seed: int, opts: dict | None = None, places=None) -> dict:
    """A team fight (see Battle). opts: rounds, defend, counter, kbscale, pace (Exchanges: 2-5 clashes an
    engagement, else 1-2), lanes (1 one at a time; allAtOnce: all), flow ("aggro": Battle.run_aggro — no queue, no
    exchanges), winner (0 / 1: that side wins — the seed is walked on until it does), randskill, bossPower (the
    boss's strength; default fair_boss's, "fair": false: 1)."""
    opts = dict(opts or {})
    with rules(opts.get("rules")):
        if "bossPower" not in opts and opts.get("fair", True) and opts.get("flow") != "duels":
            opts["bossPower"] = fair_boss(F, side, tags, opts, places)
        want = opts.get("winner")
        r = None
        for k in range(200):
            r = Battle(F, side, tags, seed + k, opts, places=places).run()
            if want not in (0, 1) or r["winner"] == want:
                return r
        return r


# ------------------------------------------------------------------ the script for the player

_ACTING = ("clash", "whole", "shot", "strong", "counter", "interrupt")


def _coin(rnd, f: dict, sk: dict | None = None) -> dict | None:
    """A coin timeline of f to strike with on the side (an extra's blow, an interrupt): one of sk's (else its first
    skill's) that can stand in for a clash (versus_engine.clashable), else its first one with hits."""
    if not f["skills"]:
        return None
    parts = (sk or f["skills"][0])["parts"]
    cand = [t for t in parts if E.clashable(t)] or [t for t in parts if t["events"].get("hits")][:1]
    return rnd.choice(cand) if cand else None


def script(fight: dict, F: list, spec: dict) -> tuple[list[dict], list[dict]]:  # noqa: C901
    """The player's script of a team fight: (parts, background). Each beat with an acting pair (a clash, a landing, a
    shot, a strong counter, a counter, an interrupt) is played as versus_engine.script plays a one-on-one beat (its
    parts, the partner's timeline, the loser, a defense, the damage share). Engagements go on at the same time: the
    beats of one chain that never overlap (always the spotlight attacks — see spotlight — and never one held through
    one) are "featured": the player's main parts, with the two-fighter code; the others are background beats the player
    plays alongside them, lighter (bg_part).

    A featured beat's first part also has: pair: [cast index of the player's fighter 0, of fighter 1] (who / loser /
    runs as in one-on-one, within the pair); place "run" + runs: the one running in first, rz: its depth after it (body
    heights); et: its engine time, lt: the same without the spotlight stops (the background's clock); hp: everyone's HP
    share when it starts; moves: the others moving meanwhile ({"i", "x", "z", "dur", "kind": run / dash / walk / back,
    "rel": x relative to that one's place (-1: absolute), "after": from the beat's end on}); extras: the others' blows
    on the surrounded one during a clash ({"i", "tl": the coin's timeline, "off", "dmg"}); dies: those falling after
    it. Every part of a spotlight attack has spot; every part of a mass skill / strong counter side ({"i", "dmg", "kb"}).

    A background beat: {"pair", "lt", "runs", "rz", "parts": [bg_part ...], "moves", "after" (moves from its end on),
    "dies", "note"}."""
    from . import viewer as V
    rnd = random.Random(fight["seed"] * 11 + 5)
    short = short_names(F)
    tags = fight.get("tags") or [{"skills": {}} for _ in F]
    hpmax = fight["hpMax"]
    n = len(F)
    freezes = fight.get("freezes") or []

    def lane_t(e):  # (engine time without the spotlight stops before it)
        return round(e - sum(max(0.0, min(e, f[1]) - f[0]) for f in freezes), 3)

    hp = list(hpmax)
    beats: list[dict] = []
    last_of: dict = {}   # engagement -> its last beat so far
    runs_in: dict = {}   # engagement -> run-ins since its last beat
    pending: dict = {}   # engagement -> the others' moves for its next beat
    last_win: dict = {}  # engagement -> its last clash's winner

    def share(i):
        return round(hp[i] / max(1, hpmax[i]), 4)

    def run_move(r):
        i, j = r["who"], r["tgt"]
        return {"i": i, "rel": j if j is not None else -1, "x": round(r["x"][i][0] - (r["x"][j][0] if j is not None else 0), 3),
                "z": r["x"][i][1], "dur": round(max(0.15, r["dur"]), 3), "kind": "dash" if r.get("dash") else "run"}

    beat_no = 0
    for s in fight["steps"]:
        act, eng = s["act"], s["eng"]
        if act == "start":
            continue
        if act == "run-in":
            runs_in.setdefault(eng, []).append(s)
            hp = s["hp"]
            continue
        b = last_of.get(eng)
        if act == "return":
            if b is not None and not b["final"]:
                b["after"].append({"i": s["who"], "rel": -1, "x": s["x"][s["who"]][0], "z": s["x"][s["who"]][1],
                                   "dur": round(max(0.2, s["dur"]), 3), "kind": "walk", "after": True})
            hp = s["hp"]
            continue
        if act == "stand-off":
            if b is not None and not b["final"]:
                b["standoff"] = {"hold": round(rnd.uniform(*E.RULES["standoff_hold"]), 3),
                                 "gap": round(abs(s["x"][b["pair"][0]][0] - s["x"][b["pair"][1]][0]), 3),
                                 "x": s["x"], "who": [x["who"] for x in s.get("extras") or []], "text": describe_step(s, short)}
            hp = s["hp"]
            continue
        if act == "falls":
            v = s["who"]
            if b is not None and not b["final"]:
                b["dies"].append(v)
                b["after"] = [m for m in b["after"] if m["i"] != v]
            hp = s["hp"]
            if any(all(s["hp"][i] <= 0 for i in range(n) if fight["side"][i] == sd) for sd in (0, 1)):
                break  # (the fight is over)
            continue
        if act not in _ACTING:
            hp = s["hp"]
            continue
        # an acting beat: the pair, and the beat as one-on-one would play it
        beat_no += 1
        if act == "clash":
            k, d = s["att"], s["def_"]
            pair = [k, d]
            an = s.get("anims") or {}
            fake = dict(act="clash", who=0 if s["who"] == k else 1, anims=(an.get(k), an.get(d)),
                        loser=-1 if s.get("loser") not in pair else pair.index(s["loser"]), pow=s.get("pow") or [0, 0],
                        skills=[s["skills"].get(k), s["skills"].get(d)], nth=s.get("nth") or [0, 0], rng=["close", "close"],
                        result=s.get("result", ""), defense=s.get("defense"), dmgShare=s.get("dmgShare", 0))
        elif act in ("whole", "shot", "strong"):
            w, v = s["who"], s["tgt"]
            pair = [w, v]
            sk = s["sk"]
            if (s.get("coins") or sk["coins"]) < sk["coins"] and not s.get("final"):
                hit = [t for t in sk["parts"] if t["events"].get("hits")][:1]  # (cut short: its first blow only)
                sk = dict(sk, parts=hit or sk["parts"][:1])
            fake = dict(act="whole", who=0, sk=sk, final=bool(s.get("final")), defense=s.get("defense"),
                        dmgShare=s.get("dmgShare", 0), rng=["close", "close"], result=s.get("result", ""), skill=sk["group"],
                        coins=s.get("coins"))
        else:  # counter, interrupt: one coin without a clash
            w, v = s["who"], s["tgt"]
            pair = [w, v]
            anim = s.get("anim") if act == "counter" else _coin(rnd, F[w])
            if anim is None:
                hp = s["hp"]
                continue
            fake = dict(act="counter", who=0, anim=anim, dmgShare=s.get("dmgShare", 0), rng=["close", "close"],
                        result=s.get("result", ""))
        if (fake["act"] == "clash" and fake["anims"][0] is None and fake["anims"][1] is None) or None in pair or pair[0] == pair[1]:
            hp = s["hp"]
            continue
        parts = E.script({"seed": fight["seed"] * 31 + beat_no, "steps": [fake]}, F[pair[0]], F[pair[1]], spec)
        if not parts:
            hp = s["hp"]
            continue
        for t in parts:  # (each beat is scripted alone: its landing's number made one of the whole fight's, for the cut-ins)
            if t.get("land") is not None:
                t["land"] = beat_no * 100 + int(t["land"])
        mine = [r for r in runs_in.get(eng, []) if r["who"] in pair]
        t0 = min([s["t"]] + [r["t"] for r in runs_in.get(eng, [])])
        beat = dict(eng=eng, pair=pair, act=act, t0=round(t0, 3), end=round(s["t"] + s["dur"], 3), spot=bool(s.get("spot")),
                    final=bool(s.get("final")), parts=parts, hp=[share(i) for i in range(n)], after=[], dies=[], standoff=None,
                    note=describe_step(s, short), runs=-1, rz=None)
        if act != "shot":
            lw = last_win.get(eng)
            r = mine[-1]["who"] if mine else lw if lw in pair and act == "clash" else pair[0]
            beat["runs"] = pair.index(r)
            if mine:
                beat["rz"] = mine[-1]["x"][r][1]
        beat["moves"] = pending.pop(eng, []) + [run_move(r) for r in runs_in.get(eng, []) if r["who"] not in pair]
        runs_in[eng] = []
        if act == "clash":
            last_win[eng] = s["who"]
        elif act in ("whole", "strong"):
            last_win[eng] = s["who"]
        # the others' blows on the surrounded one during the clash, each its own coin with the clash's blow
        if act in ("clash", "whole") and s.get("extras"):
            lead_ev = parts[0]["events"]
            xs = []
            for x in s["extras"]:
                i = x["who"]
                on = x.get("on", pair[1])
                if i in pair or on not in pair:
                    continue
                tl = None
                if x.get("shot"):
                    rs = [sk for sk in F[i]["skills"] if "range" in (tags[i]["skills"].get(sk["group"]) or [])]
                    tl = next((t for sk in rs for t in sk["parts"] if t["events"].get("hits")), None)
                tl = tl or _coin(rnd, F[i])
                if tl is None:
                    continue
                # (its first blow with the clash's / the skill's first one)
                off = round(V._clash_blow(tl["events"]) - V._round_blow(lead_ev, None), 4)
                xs.append({"i": i, "tl": tl, "off": off, "dmg": round(x.get("dmgShare", 0), 4), "v": pair.index(on)})
            beat["extras"] = xs
        # a mass skill's / strong counter's others: hit with each part's blows, weaker
        side = s.get("side") or []
        if side:
            kb = TEAM["strong_side"] if act == "strong" else TEAM["mass_share"]
            nh = sum(len(t["events"].get("hits") or []) for t in parts) or 1
            for t in parts:
                h = len(t["events"].get("hits") or [])
                if h:
                    t["side"] = [{"i": x["who"], "dmg": round(x.get("dmgShare", 0) * h / nh, 4), "kb": kb} for x in side]
        beats.append(beat)
        last_of[eng] = beat
        hp = s["hp"]

    # the featured chain: beats that never overlap, always the spotlight ones, never one held through a spotlight stop
    stops = [f[0] for f in freezes]
    beats.sort(key=lambda b: b["t0"])
    feat_end, last_eng = -1e9, None
    for k, b in enumerate(beats):
        through = not b["spot"] and any(b["t0"] < T - 1e-3 and b["end"] > T + 1e-3 for T in stops)
        free = b["t0"] >= feat_end - 1e-3
        # (two starting together: the one of the engagement featured so far)
        if free and not b["spot"] and b["eng"] != last_eng and last_eng is not None:
            alt = next((o for o in beats[k + 1:] if o["t0"] <= b["t0"] + 1e-3 and o["eng"] == last_eng), None)
            if alt is not None:
                free = False
        b["featured"] = b["spot"] or (free and not through)
        if b["featured"]:
            feat_end = max(feat_end, b["end"])
            last_eng = b["eng"]

    out, bg = [], []
    for b in beats:
        parts = b["parts"]
        if b["featured"]:
            e = parts[0]
            e.update(pair=b["pair"], et=b["t0"], lt=lane_t(b["t0"]), hp=b["hp"], note=b["note"], beat=len(out), act=b["act"])
            if b["runs"] >= 0:
                e.update(place="run", runs=b["runs"])
                if b["rz"] is not None:
                    e["rz"] = b["rz"]
            if b["moves"]:
                e["moves"] = b["moves"]
            if b.get("extras"):
                e["extras"] = b["extras"]
            if b["spot"]:
                for t in parts:
                    t["spot"] = True
            last = parts[-1]
            st = b["standoff"]
            mv = list(b["after"])
            if st:
                last.update(standoff=st["hold"], gap=st["gap"])
                last["note"] = last.get("note", "") + " | " + st["text"]
                mv += [{"i": i, "rel": -1, "x": st["x"][i][0], "z": st["x"][i][1], "dur": 0.25, "kind": "back", "after": True}
                       for i in st["who"] if i not in b["pair"]]
            if mv:
                last["moves"] = list(last.get("moves") or []) + mv
            if b["dies"]:
                last["dies"] = b["dies"]
            out += parts
        else:
            after = list(b["after"])
            if b["standoff"]:
                st = b["standoff"]
                after += [{"i": i, "rel": -1, "x": st["x"][i][0], "z": st["x"][i][1], "dur": 0.25, "kind": "back", "after": True}
                          for i in set(st["who"]) | set(b["pair"])]
            bg.append({"pair": b["pair"], "et": b["t0"], "lt": lane_t(b["t0"]), "runs": b["runs"],
                       "rz": b["rz"] if b["rz"] is not None else -999, "parts": [bg_part(t, k == 0, V) for k, t in enumerate(parts)],
                       "moves": b["moves"], "after": after, "dies": b["dies"], "note": b["note"]})
    # each background beat's anchor: the featured beat it starts after (the player times it from that one's start)
    firsts = [(k, e["lt"]) for k, e in enumerate(out) if "pair" in e]
    for g in bg:
        a = [(k, lt) for k, lt in firsts if lt <= g["lt"] + 1e-6]
        g["anchor"], g["alt"] = a[-1] if a else (-1, 0.0)
    return out, bg


def bg_part(e: dict, first: bool, V) -> dict:
    """A background beat's part (Viewer.cs TeamLane): its timeline, the partner's (a clash), who plays it (0 / 1 of
    the pair), from / to (timeline seconds: a wind-up cut, a clash over a moment after its blow, a strike a moment
    after its last blow), the blow (a clash's: the loser knocked back then), its speed, loser, damage share, defense,
    side."""
    ev = e["events"]
    hits = [h["t"] for h in ev.get("hits") or [] if not h.get("tick")]
    acts = [m["t"] for m in ev.get("moves") or []] + hits
    fa = min(acts) if acts else 0.0
    pt = e.get("partnerTl")
    frm = fa - 0.15 if fa > 0.3 and (e.get("clash") or first) else 0.0
    if e.get("clash"):
        blow = V._round_blow(ev, pt["events"] if pt else None)
        if e.get("coin") and hits:
            frm = max(frm, min(hits) - 0.25)
        to = max([blow] + hits) + 0.25 + (e.get("pause") or 0)
    else:
        blow = max(hits) if hits else 0.0
        to = max(hits) + 0.5 if hits else V.part_length(e)
    return {"tl": e, "ptl": pt, "poff": (pt or {}).get("poff", 0.0), "who": e.get("who", 0), "from": round(max(0.0, frm), 3),
            "to": round(max(to, frm + 0.1), 3), "blow": round(blow, 3), "speed": e.get("speed") or 1.0, "clash": bool(e.get("clash")),
            "loser": e.get("loser", -1) if e.get("clash") and not e.get("defend") else -1, "dmg": e.get("dmg", 0.0),
            "defend": e.get("defend") or "", "side": e.get("side") or [], "final": bool(e.get("final"))}


def describe_script(F: list, fight: dict, entries: list[dict], bg: list[dict] | None = None) -> str:
    """The player's script read out: the featured parts, one line each, and the background beats (in brackets) where
    they start."""
    short = short_names(F)
    out = []
    by_anchor: dict = {}
    for g in bg or []:
        by_anchor.setdefault(g["anchor"], []).append(g)

    def bgline(g):
        a, b = g["pair"]
        return (f"          [bg lt {g['lt']:6.2f} {short[a]}|{short[b]} {len(g['parts'])} parts "
                f"{'+'.join(p['tl']['name'].split('_')[-2] + ('c' if p['clash'] else '') for p in g['parts'])}"
                + (f" run:{g['runs']}" if g["runs"] >= 0 else "") + (" DIES " + ",".join(short[i] for i in g["dies"]) if g["dies"] else "")
                + f"]  # {g['note']}")
    for g in by_anchor.get(-1, []):
        out.append(bgline(g))
    for k, e in enumerate(entries):
        if "pair" in e:
            a, b = e["pair"]
            head = f"{e.get('lt', 0):6.2f} {short[a]}|{short[b]} who {e['who']}"
        else:
            head = " " * 6 + "   ..."
        kind = "FINAL" if e.get("final") else "clash" if e.get("clash") else "counter" if e.get("counter") else "strike" if e.get("strike") else "?"
        bits = [("*" if e.get("spot") else " ") + f"{kind:7s} {e['name']}"]
        if e.get("place"):
            bits.append(f"run:{e.get('runs')}" + (f" z{e['rz']:+.2f}" if "rz" in e else ""))
        if e.get("loser", -1) >= 0 and e.get("clash"):
            bits.append(f"loser {e['loser']}")
        if e.get("defend"):
            bits.append(e["defend"])
        for m in e.get("moves") or []:
            bits.append(f"[{short[m['i']]} {m['kind']}{' after' if m.get('after') else ''} -> {m['x']:+.2f},{m['z']:+.2f}"
                        + (f" of {short[m['rel']]}" if m.get("rel", -1) >= 0 else "") + "]")
        for x in e.get("extras") or []:
            bits.append(f"<{short[x['i']]} off {x['off']:+.2f}>")
        for x in e.get("side") or []:
            bits.append(f"{{side {short[x['i']]} {x['dmg']:.3f}}}")
        if e.get("dies"):
            bits.append("DIES " + ",".join(short[i] for i in e["dies"]))
        if e.get("standoff"):
            bits.append(f"standoff gap {e.get('gap')}")
        out.append(f"{k:3d} {head}  " + "  ".join(bits) + (f"   # {e['note']}" if e.get("note") and "pair" in e else ""))
        for g in by_anchor.get(k, []):
            out.append(bgline(g))
    return "\n".join(out)


def check_script(F: list, fight: dict, entries: list[dict], bg: list[dict] | None = None) -> list[str]:
    """What looks wrong in the player's script: a dead one acting or moving, no final skill or not the longest one,
    featured beats overlapping on the engine's clock, a background beat sharing a fighter with a featured one at the
    same time, two standing on one spot in the engine, parts with no events."""
    probs = []
    n = len(F)
    short = short_names(F)
    items = []  # (lane time, end, pair, dies, what)
    firsts = [e for e in entries if "pair" in e]
    for k, e in enumerate(entries):
        if not e.get("events"):
            probs.append(f"#{k} no events")
    for k, e in enumerate(firsts):
        items.append((e["lt"], e["pair"], [], f"featured {k}"))
    for e in entries:
        if e.get("dies"):
            prev = [x for x in firsts if x is e or entries.index(x) <= entries.index(e)][-1]
            items.append((prev["lt"] + 0.01, [], e["dies"], "dies"))
    for g in bg or []:
        items.append((g["lt"], g["pair"], g["dies"], "bg"))
    items.sort(key=lambda x: x[0])
    dead = set()
    for lt, pair, dies, what in items:
        for i in pair:
            if i in dead:
                probs.append(f"lt {lt:.2f} {short[i]} acts after falling ({what})")
        dead |= set(dies)
    fin = [e for e in entries if e.get("final")]
    if not fin:
        probs.append("no final skill")
    else:
        w = next(e for e in reversed(entries) if "pair" in e and e.get("final"))["pair"][0]
        longest = max(F[w]["skills"], key=lambda s: s["seconds"])
        if not all(e["name"] in [t["name"] for t in longest["parts"]] for e in fin):
            probs.append(f"final is not {short[w]}'s longest skill {longest['group']}")
        if entries[-1] is not fin[-1]:
            probs.append("parts after the final")
    for g in bg or []:
        for p in g["parts"]:
            if p["to"] <= p["from"]:
                probs.append(f"bg {g['note'][:40]}: empty part")
    for s in fight["steps"]:
        alive = [i for i in range(n) if s["hp"][i] > 0]
        for a in alive:
            for b in alive:
                if a < b and math.hypot(s["x"][a][0] - s["x"][b][0], s["x"][a][1] - s["x"][b][1]) < 0.3:
                    probs.append(f"t {s['t']:.2f} {short[a]} and {short[b]} on one spot ({s['act']})")
    return probs


# ------------------------------------------------------------------ reading it out

def short_names(F: list) -> list[str]:
    """Each one's name for the read-out: an Identity / E.G.O by its sinner, an enemy by its name; twins numbered."""
    out = [f["name"].split(" ")[0] if isinstance(f["cid"], int) else f["name"] for f in F]
    seen = {}
    for k, n in enumerate(out):
        seen.setdefault(n, []).append(k)
    for n, ks in seen.items():
        if len(ks) > 1:
            for m, k in enumerate(ks):
                out[k] = f"{n} {m + 1}"
    return out


def describe_step(s: dict, short: list[str]) -> str:
    def sk(n):
        m = re.search(r"S\d+", n or "")
        return m.group(0) if m else (n or "")
    nm = lambda i: short[i] if i is not None and i >= 0 else "all"
    act = s["act"]
    if act == "clash":
        k, d = s["att"], s["def_"]
        what = f"clash {nm(k)} {sk(s['skills'][k])} {s['pow'][0]} vs {s['pow'][1]} {sk(s['skills'][d])} {nm(d)}" + (f" ({s['nth'][0]} of {s['nth'][1]})" if s['nth'][1] else "")
        if s.get("defense"):
            what = f"{nm(k)} {sk(s['skills'][k])} at {nm(d)}"
        who = nm(s["who"]) + " wins"
    else:
        what = act + (f" {sk(s['skill'])}" + (f" x{s['coins']}" if s.get("coins") else "") if s.get("skill") else "")
        if s.get("tgt") is not None and act not in ("falls",):
            what += f" -> {nm(s['tgt'])}"
        if s.get("defense"):
            what += f" on {s['defense'].lower()}"
        who = nm(s["who"])
    res = re.sub(r"#(\d+)", lambda m: nm(int(m.group(1))), s.get("result", ""))
    return f"{who}: {what}  {res}"


def describe(F: list, fight: dict) -> str:
    short = short_names(F)
    side = fight["side"]
    out = ["  vs  ".join(", ".join(f"{short[i]} [{'/'.join(fight['roles'][i])}] HP {fight['hpMax'][i]}" for i in range(len(F)) if side[i] == s)
                         for s in (0, 1)) + f"   (seed {fight['seed']})"]
    for s in fight["steps"]:
        hp = " ".join(f"{h:3d}" for h in s["hp"])
        out.append(f"{s['t']:6.2f} +{s['dur']:4.2f} e{s['eng']:<3d} HP {hp}  {describe_step(s, short)}")
    out.append(f"winner: {'left' if fight['winner'] == 0 else 'right'} after {fight['clashes']} clashes, {fight['time']} s")
    return "\n".join(out)


def to_json(F: list, fight: dict) -> dict:
    """The fight for ui/versus_view.html (team view): names, sides, roles, HP, the stage and the steps (no timelines)."""
    keep = ("act", "t", "dur", "who", "tgt", "eng", "x", "hp", "loser", "pow", "nth", "skill", "coins", "dmg", "defense", "result",
            "final", "att", "armor")
    short = short_names(F)
    steps = []
    for s in fight["steps"]:
        d = {k: s[k] for k in keep if k in s}
        d["def"] = s.get("def_")
        d["extras"] = [{"who": e["who"], "dmg": e.get("dmg"), "shot": e.get("shot")} for e in s.get("extras") or []]
        d["side"] = [{"who": e["who"], "dmg": e.get("dmg")} for e in s.get("side") or []]
        d["text"] = describe_step(s, short)
        steps.append(d)
    return {"team": True, "names": [f["name"] for f in F], "short": short, "side": fight["side"], "roles": fight["roles"],
            "hpMax": fight["hpMax"], "winner": fight["winner"], "seed": fight["seed"], "boss": fight["boss"], "home": fight["home"],
            "wall": fight["wall"], "depth": fight["depth"], "time": fight["time"], "cds": fight["cds"], "aggs": fight["aggs"], "flow": fight["flow"], "bossPower": fight.get("bossPower", 1),
            "ids": [str(f["cid"]) for f in F], "steps": steps,
            # each one's tags: its roles, its skills' (by their S-number), and why they were guessed
            "tags": [{"unit": tg["unit"], "auto": tg.get("auto", ""),
                      "skills": {(re.search(r"S\d+", g) or [g])[0]: v for g, v in tg["skills"].items() if v}} for tg in fight["tags"]]}
