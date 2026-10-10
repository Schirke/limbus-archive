"""Versus → Mirror: a short PvE run in the spirit of the Mirror Dungeon, fought 1v1 with the Versus engine.

The run (user's order): Identity → shop → pack → boss → (gift 1 of 3 + Cost) → shop → pack → boss → the end. Picking a
pack (1 of 3) is picking the next boss and the gifts that can be found; a lost boss ends the run. Each boss fight starts
at full HP (user, 2026-10-09: no carrying over); within a fight nothing heals but lifesteal gifts. Exchanges on or off
for the whole run (run "flow": "" or "series", picked at its start).

Where things live: everything here but `catalog` / `fighters` is plain Python over plain dicts (no Service, no files),
so the same code can run in the app's server and, later, in a browser (Pyodide) for the website. The fight itself is
versus_engine's (MirrorFight is its Fight with a build on top: a fight without a build is the engine's own, step for
step); the player only acts the script out.

Game data used (StaticData): `mirrordungeon-theme-floor` (packs: mapGenOption.bossPool = stage ids), `battle-mirrordungeon`
(those stages: wave 1's first unit is the boss), `ego-gift(-mirrordungeon)` via mirror.build (names, keyword, tier, icon).
Gift effects in the game are code: we don't read them — EFFECTS is our own simple table per keyword x tier."""
from __future__ import annotations

import random
import re

from . import versus_engine as E

VERSION = 1

RULES = {
    "floors": 2,               # bosses in a run
    "offers": 3,               # Identities / packs / reward gifts to pick from
    "shop_size": 5,            # gifts on a shop's shelf
    # Cost (the game's own word for the run's money)
    "cost_start": 300, "cost_boss": 300, "cost_floor": 50,  # at the start; a won boss (+ this per floor)
    "price": {1: 100, 2: 160, 3: 230, 4: 320, 5: 400},    # a gift by tier (sold: half)
    "refresh": 50, "kw_refresh": 100,                    # a new shelf; a new shelf of one keyword
    "enhance": (100, 150),                               # + and ++ (a gift's level 1 → 2 → 3)
    "level_mult": (1.0, 1.5, 2.0),                       # what a gift's numbers are worth at level 1 / 2 / 3
    # HP: real numbers, not the Versus page's "HP per clash" (a build has to matter and carry over)
    "hp_player": 70,                                     # the Identity's max HP (before gifts)
    "boss_hp": (1.2, 1.5),                               # each floor's boss: this many times the player's base HP
    "boss_power": (0, 1),                                # each floor's boss: + skill base power
    "rounds": 80,                                        # a safety net: the engine's finale after this many clashes
    "series_rounds": 16,                                 # Exchanges off: this many clashes, then the one ahead lands its last skill
    "landing_cap": 0.25,                                 # one landing takes at most this share of the HP
    # statuses (simplified; potency / count each capped)
    "status_max": 20,
    "poise_crit": 0.05, "crit_mult": 1.2,                # per Poise potency: a coin's crit chance; a crit's damage
    "tremor_max": 999,                                   # Tremor just piles up (no count): it is checked against the HP
    "guard_max": 0.5,                                    # a guard takes at most this share off each blow
}

# keyword (as the gift data names it) → our status; the attack-type keywords' gifts are left out for now (user, 2026-10-09)
STATUS_OF = {"Laceration": "bleed", "Combustion": "burn", "Burst": "rupture", "Breath": "poise", "Vibration": "tremor"}
# the sound at the start of a Tremor kill: the game's Tremor Burst sound is its battle UI "Panic" one (a recording of
# Tremor Burst the user downloaded matched it, r 0.998 against all 29 380 of the game's 2.5-9 s sounds; the next 0.93)
TREMOR_SOUND = "047_battleui_panic_a_v1"
ATK_OF = {"Slash": "Slash", "Penetrate": "Penetrate", "Hit": "Hit"}

# Our gift effects, per keyword and tier (1-4; 5 / EX use 4's). Numbers are at level 1 (RULES level_mult for + / ++).
#   base / coin: + skill base / coin power   heads: + coin heads chance   coins: + coins on every skill (max_coins)
#   hp: + max HP share   dmg: + damage share   dmg_<Slash|Penetrate|Hit>: + damage share of that type
#   take: - damage taken share   lifesteal: share of dealt damage healed
#   inflict: {status: [potency, count]} on the first coin that lands of each landing   self: {"poise": [p, c]} on own landing
#   last: x weight of the last skill in the deck (the strongest, as the game's S3)
EFFECTS = {
    "Laceration": {1: {"inflict": {"bleed": [2, 2]}}, 2: {"inflict": {"bleed": [3, 3]}},
                   3: {"inflict": {"bleed": [4, 3]}, "dmg": 0.05}, 4: {"inflict": {"bleed": [5, 4]}, "lifesteal": 0.1}},
    "Combustion": {1: {"inflict": {"burn": [2, 2]}}, 2: {"inflict": {"burn": [3, 3]}},
                   3: {"inflict": {"burn": [4, 3]}, "coin": 1}, 4: {"inflict": {"burn": [6, 4]}}},
    "Burst": {1: {"inflict": {"rupture": [2, 2]}}, 2: {"inflict": {"rupture": [3, 3]}},
              3: {"inflict": {"rupture": [3, 5]}}, 4: {"inflict": {"rupture": [5, 5]}, "dmg": 0.05}},
    "Breath": {1: {"self": {"poise": [2, 2]}}, 2: {"self": {"poise": [3, 3]}},
               3: {"self": {"poise": [4, 4]}, "coin": 1}, 4: {"self": {"poise": [5, 5]}, "dmg": 0.1}},
    # (no status of ours yet: plain numbers in their spirit)
    # Tremor (user, 2026-10-09): piles up; once it reaches the target's HP, the next skill (or counter) that hits it kills it
    "Vibration": {1: {"inflict": {"tremor": [3, 0]}}, 2: {"inflict": {"tremor": [4, 0]}}, 3: {"inflict": {"tremor": [6, 0]}},
                  4: {"inflict": {"tremor": [8, 0]}}},
    "Sinking": {1: {"take": 0.04}, 2: {"take": 0.06}, 3: {"take": 0.08, "hp": 0.05}, 4: {"take": 0.12, "hp": 0.05}},
    "Charge": {1: {"base": 1}, 2: {"base": 1, "heads": 0.02}, 3: {"base": 2}, 4: {"coins": 1}},
    "Slash": {1: {"dmg_Slash": 0.08}, 2: {"dmg_Slash": 0.12}, 3: {"dmg_Slash": 0.18}, 4: {"dmg_Slash": 0.25}},
    "Penetrate": {1: {"dmg_Penetrate": 0.08}, 2: {"dmg_Penetrate": 0.12}, 3: {"dmg_Penetrate": 0.18}, 4: {"dmg_Penetrate": 0.25}},
    "Hit": {1: {"dmg_Hit": 0.08}, 2: {"dmg_Hit": 0.12}, 3: {"dmg_Hit": 0.18}, 4: {"dmg_Hit": 0.25}},
    "": {1: {"hp": 0.08}, 2: {"lifesteal": 0.05}, 3: {"coin": 1, "hp": 0.05}, 4: {"last": 2.0, "dmg": 0.08}},
}

# Shield (2026-10-10): extra HP on top of the HP — all damage takes it first, statuses' too (user: Bleed, Burn, Rupture
# don't go past it; Tremor counts HP + Shield). A gift whose game text gives Shield (catalog: SHIELD_GIFT on its description) starts each
# boss fight with this share of the max HP as Shield, by tier (on top of its keyword's EFFECTS; x level_mult)
SHIELD = {1: 0.08, 2: 0.12, 3: 0.16, 4: 0.20}
SHIELD_GIFT = re.compile(r"(gains?|apply|applied as) [^.]{0,40}?Shield|Shield equal", re.I)


# ------------------------------------------------------------------ the data (app side: needs the Service)

# bosses our player can't show (checked 2026-10-10 by rendering every boss of the packs): drawn by Spine alone, which
# the player has no runtime for — invisible, only their effects show; Don's carnival wheel (48 bodies high) fills the
# picture with red, Don herself can't be made out
NOT_BOSSES = {"8045_ElectricCentipedeAppearance", "8048_GentleFairyAppearance", "8390_RealDon_1pAppearance"}

def catalog(svc) -> dict:
    """{"gifts": {id: {name, kw, tier, sin, desc, pic, price}}, "packs": [{id, name, pic, hard, bosses: [enemy prefab
    names], pool: [gift ids]}], "ids": [Identity ids that can fight]}. Packs without a boss we can fight are left out."""
    db = svc.mirror_db()
    t = svc.static_tables(["mirrordungeon-theme-floor", "battle-mirrordungeon", "enemy", "abnormality-unit"])
    from . import stages
    st = {r["id"]: r for f in (t.get("battle-mirrordungeon") or {}).values() for r in (f.get("list") or [])
          if isinstance(r, dict) and "id" in r}
    en = {r["id"]: r for fo in ("enemy", "abnormality-unit") for f in (t.get(fo) or {}).values() for r in (f.get("list") or [])
          if isinstance(r, dict) and "id" in r}
    raw = {p["id"]: p for f in (t.get("mirrordungeon-theme-floor") or {}).values() for p in (f.get("list") or []) if isinstance(p, dict)}
    gifts = {}
    for gid, g in db["gifts"].items():
        if (g.get("kw") or "") in ATK_OF:
            continue
        tier = g.get("tier") or 1
        gifts[int(gid)] = dict(g, tier=tier, price=RULES["price"].get(min(tier, 5), 100), shield=bool(SHIELD_GIFT.search(g.get("desc") or "")))
    packs = []
    for p in db["packs"]:
        bosses = []
        for sid in ((raw.get(p["id"]) or {}).get("mapGenOption") or {}).get("bossPool") or []:
            waves = stages._stage(st[sid])["waves"] if sid in st else []
            u = waves[0]["units"][0] if waves and waves[0]["units"] else None
            app = (en.get(u[0]) or {}).get("appearance") if u else None
            if app and app not in bosses and app not in NOT_BOSSES:
                bosses.append(app)
        pool = [g for g in p["pool"] + p["excl"] if g in gifts]
        if bosses and pool:
            packs.append({"id": p["id"], "name": p["name"], "pic": p.get("pic") or "", "hard": p.get("hard"),
                          "bosses": bosses, "pool": pool})
    return {"gifts": gifts, "packs": packs}


def fighters(svc, cids, cache: dict | None = None) -> dict:
    """{cid: versus_engine.fighter} (an enemy with its skills' coins as clashes, as the Auto Battler has them); one
    that can't fight (no skills / no clash animations) is left out."""
    out = {} if cache is None else cache
    for c in cids:
        if c in out:
            continue
        try:
            f = E.fighter(svc, c, "", not isinstance(c, int))
        except Exception:
            f = None
        if f and f["skills"] and (f["anims"] or f["skillsClash"]):
            out[c] = f
    return out


# ------------------------------------------------------------------ a build on a fighter (pure)

def gift_mods(g: dict, level: int = 1) -> dict:
    """One gift's numbers at its level (EFFECTS of its keyword and tier, times RULES level_mult)."""
    tab = EFFECTS.get(g.get("kw") or "") or EFFECTS[""]
    eff = tab.get(min(4, max(1, g.get("tier") or 1)))
    k = RULES["level_mult"][max(1, min(3, level or 1)) - 1]
    out = {}
    if g.get("shield"):
        out["shield"] = SHIELD[min(4, max(1, g.get("tier") or 1))] * k
    for key, v in eff.items():
        if key in ("inflict", "self"):
            out[key] = {s: [round(pot * k), round(cnt * k)] for s, (pot, cnt) in v.items()}
        elif key == "last":
            out[key] = 1 + (v - 1) * k
        elif key in ("base", "coin", "coins"):
            out[key] = round(v * k) if key != "coins" else v  # (a coin more is a coin more at any level)
        else:
            out[key] = v * k
    return out


def build_mods(build: list[dict], gifts: dict) -> dict:
    """The sum of a build's gifts (build: [{"id", "level" 1-3}]) as one modifier dict (see EFFECTS)."""
    m = {"base": 0, "coin": 0, "heads": 0.0, "coins": 0, "hp": 0.0, "dmg": 0.0, "take": 0.0, "lifesteal": 0.0,
         "shield": 0.0, "last": 1.0, "inflict": {}, "self": {}}
    for b in build:
        g = gifts.get(b["id"]) or gifts.get(str(b["id"]))
        if not g:
            continue
        for key, v in gift_mods(g, b.get("level") or 1).items():
            if key in ("inflict", "self"):
                for s, (pot, cnt) in v.items():
                    cur = m[key].setdefault(s, [0, 0])
                    cur[0] += pot
                    cur[1] += cnt
            elif key == "last":
                m["last"] *= v
            elif key in ("base", "coin", "coins"):
                m[key] += v
            else:
                m[key] = m.get(key, 0.0) + v
    return m


# names as the page shows them: a gift's keyword, our statuses
KW_NAME = {"Laceration": "Bleed", "Combustion": "Burn", "Burst": "Rupture", "Breath": "Poise", "Vibration": "Tremor",
           "Sinking": "Sinking", "Charge": "Charge", "Slash": "Slash", "Penetrate": "Pierce", "Hit": "Blunt", "": "General"}
ST_NAME = {"bleed": "Bleed", "burn": "Burn", "rupture": "Rupture", "poise": "Poise", "tremor": "Tremor"}
ST_KW = {v: k for k, v in STATUS_OF.items()}  # (our status → the game's keyword: its icon)
ST_HELP = {"bleed": "loses Potency HP at each clash it fights (Count − 1)",
           "burn": "loses Potency HP after each exchange (Count − 1)",
           "rupture": "each coin that hits it deals + Potency damage (Count − 1)",
           "poise": "each of its coins that hits crits with Potency × 5 % chance, × 1.2 damage (Count − 1)",
           "tremor": "piles up; once it is as high as the HP left (+ Shield), the next skill or counter that hits kills (Tremor Burst)"}


def mods_text(m: dict) -> list[str]:
    """A modifier dict (one gift's, or a build's sum) in words, one line per effect."""
    out = []
    pct = lambda v: f"{round(v * 100)} %"
    for s, (p, c) in (m.get("inflict") or {}).items():
        out.append(f"Each skill's first hit: {p} {ST_NAME[s]}" + (f" (Count {c})" if c else " (kills once it reaches the HP left)" if s == "tremor" else ""))
    for s, (p, c) in (m.get("self") or {}).items():
        out.append(f"Each skill landed: gain {p} {ST_NAME[s]} (Count {c})")
    if m.get("base"):
        out.append(f"+{m['base']} base power")
    if m.get("coin"):
        out.append(f"+{m['coin']} coin power")
    if m.get("coins"):
        out.append(f"+{m['coins']} coin on every skill")
    if m.get("heads"):
        out.append(f"+{pct(m['heads'])} heads chance")
    if m.get("hp"):
        out.append(f"+{pct(m['hp'])} max HP")
    if m.get("shield"):
        out.append(f"Fight start: Shield {pct(min(1.0, m['shield']))} of max HP (takes damage before the HP)")
    if m.get("dmg"):
        out.append(f"+{pct(m['dmg'])} damage")
    for a, n in (("Slash", "Slash"), ("Penetrate", "Pierce"), ("Hit", "Blunt")):
        if m.get(f"dmg_{a}"):
            out.append(f"+{pct(m[f'dmg_{a}'])} {n} damage")
    if m.get("take"):
        out.append(f"−{pct(m['take'])} damage taken")
    if m.get("lifesteal"):
        out.append(f"Lifesteal: {pct(m['lifesteal'])} of damage dealt")
    if m.get("last", 1.0) != 1.0:
        out.append(f"Strongest skill drawn ×{m['last']:.1f} as often")
    return out


def with_build(f: dict, mods: dict, power: int = 0) -> dict:
    """A copy of fighter f with the build's numbers on its skills (base / coin power, coins, heads chance, last skill's
    weight); `power`: + base power (a later floor's boss)."""
    skills = []
    for s in f["skills"]:
        s2 = dict(s, base=s["base"] + mods.get("base", 0) + power,
                  coins=max(1, min(E.RULES["max_coins"] + 1, s["coins"] + mods.get("coins", 0))),
                  heads=min(0.9, E.RULES["heads"] + mods.get("heads", 0.0)))
        if s.get("coin", 0) > 0:
            s2["coin"] = s["coin"] + mods.get("coin", 0)
        skills.append(s2)
    return dict(f, skills=skills, mods=mods)


# ------------------------------------------------------------------ the fight (pure)

class MirrorFight(E.Fight):
    """versus_engine's Fight with real HP (carried over), a build's damage numbers, lifesteal and four statuses:
    - Bleed: each clash it fights, it loses Bleed potency HP (count - 1);
    - Burn: after each landing or stand-off, it loses Burn potency HP (count - 1);
    - Rupture: each coin that hits it takes + Rupture potency HP (count - 1), on top of the landing's share (the cap
      on one landing's damage doesn't stop it; the step's "rup" lists each proc for the player);
    - Poise (own): each of its coins that hits crits with potency x poise_crit (x crit_mult damage; count - 1).
    A status never takes the last HP outside a landing (the engine ends a fight on a landing). Shield (a build's
    "shield" share of the max HP, at the start): all damage takes it before the HP, statuses' too. Each step carries
    "st" (both sides' statuses after it), "sh" (both Shields after it, once anyone has one) and, when it happened,
    "heal" / "tick" ([left, right] HP gained / lost outside the hits) for the player."""

    def __init__(self, a, b, seed, opts, hp_max, hp_now):
        R = dict(E.RULES, landing_cap=RULES["landing_cap"])
        super().__init__(a, b, seed, opts, R)
        self.series = opts.get("flow") == "series"
        if self.series:
            self.o = _SeriesOpts(opts, self)
        self._burst = False  # (this step: a Tremor kill)
        self.max = list(hp_max)
        self.hp = [max(1, min(m, h)) for m, h in zip(hp_max, hp_now)]
        self.st = [{}, {}]  # side → {status: [potency, count]}
        self._h = E.RULES["heads"]
        self._side = 0  # (who is landing coins now)
        self._first = False  # (the landing's first coin not landed yet)
        self._heal, self._tick = [0, 0], [0, 0]
        self._rup = []  # (this step's Rupture procs: HP each, on the side being hit)
        self._lethal = False  # (Rupture may take the last HP only inside a landing that may kill)
        self._coin_dmg = None  # (the landing being logged: its coins' damage)
        self.sh = [round(m * min(1.0, (self.F[i].get("mods") or {}).get("shield", 0.0))) for i, m in enumerate(self.max)]
        self.sh0, self.sh_used = list(self.sh), [0, 0]  # (Shield at the start; taken by damage)

    # --- coins
    def flip(self) -> bool:
        return self.rnd.random() < self._h

    def roll(self, sk, coins) -> int:
        old, self._h = self._h, sk.get("heads", E.RULES["heads"])
        try:
            return super().roll(sk, coins)
        finally:
            self._h = old

    def land(self, w, sk, coins, whole, defense=None, lethal=True):
        old, self._h = self._h, sk.get("heads", E.RULES["heads"])
        self._side, self._first, self._lethal = w, True, lethal
        try:
            final = self._land(w, sk, coins, whole, defense, lethal)
        finally:
            self._h, self._lethal = old, False
        for s, (p, c) in (self.F[w].get("mods") or {}).get("self", {}).items():
            self.add(w, s, p, c)
        return final

    def _land(self, w, sk, coins, whole, defense=None, lethal=True):
        """versus_engine.Fight.land, but each coin that hits (not dodged, not fully guarded) procs Rupture — also the
        coins past the landing's cap (their damage stopped by it, the Rupture not)."""
        d, R = 1 - w, self.R
        before = E.range_of(self.gap(), R)
        g = (self.F[d]["guard"] or R["plain_guard"]) if defense else None
        shield = self.roll(g, g["coins"]) if defense == "Guard" else 0
        total, missed, power, broken = 0, 0, sk["base"], False
        cap = round(self.max[d] * R["landing_cap"])
        if not lethal:
            cap = min(cap, self.hp[d] - 1 + self.sh[d])
        per = self._coin_dmg = []  # (each coin's damage, for the player: its own animation takes it, see script)
        for _ in range(coins):
            per.append(0)
            head = self.flip()
            if head:
                power += sk["coin"]
            if defense == "Evade" and not broken:
                if self.roll(g, g["coins"]) > power:
                    missed += 1
                    continue
                broken = True
            # (a guard's roll off each blow — but at most guard_max of it: a block never stops a blow whole, user 2026-10-10
            # "sometimes no damage is dealt")
            stop = min(shield, power * RULES["guard_max"]) if defense == "Guard" else 0
            raw = self.coin_damage(w, sk, power, head)
            dmg = raw * (1 - stop / power if power > 0 else 1) if defense == "Guard" else raw
            shield = shield - stop if defense == "Guard" else 0
            if dmg <= 0:
                continue
            if lethal and self.tremor_kills(d):  # (Tremor as high as its HP: this hit kills it)
                per[-1] = self.hp[d] + self.sh[d]
                self.hp[d], self.sh[d], self._burst = 0, 0, True
                break
            if total >= cap:
                self.rupture(d)
                continue
            per[-1] = self.hurt(d, dmg, sk["atk"], cap - total)
            total += per[-1]
        if missed < coins:
            self.knock(d, E.knock_bodies(sk["lastForce"] if whole else sk["coinForce"], self.kbs) * (0.5 if defense == "Guard" else 1))
        res = f"{total} damage" + (f", {missed} of {coins} dodged" if defense == "Evade" else "") + (", blocked" if defense == "Guard" else "")             + (", taken to strike back" if defense == "Counter" else "")
        final = self.hp[d] <= 0
        if final:
            res += f", #{d} falls"
            sk = self.decks[w].finisher(self.long_max)
            coins = sk["coins"]
        self.log("whole" if whole else "strike", w, before, skill=sk["group"], sk=sk, coins=coins, dmg=total,
                 dmgShare=total / self.max[d], defense=defense, result=res, final=final)
        return final

    def coin_damage(self, w, sk, power, head) -> float:
        """A coin's damage before the defense and the target's numbers: its power (versus_mirror2 has its own)."""
        return power

    def tremor_kills(self, i) -> bool:
        """Side i's Tremor is as high as its HP left + Shield (a hit by a skill or counter kills it)."""
        t = (self.st[i].get("tremor") or [0])[0]
        return 0 < self.hp[i] and self.hp[i] + self.sh[i] <= t

    def counter(self, d, w):
        """(Exchanges) a counter on one whose Tremor reaches its HP: d strikes back with a whole skill that kills it;
        else the engine's counter (one coin, never killing)."""
        if self.series or not self.tremor_kills(w) or self.decks[d].counter_coin() is None:
            return super().counter(d, w)
        b4 = E.range_of(self.gap(), self.R)
        self.meet(d)
        self.log("run-in", d, b4, result="strikes back")
        sk = self.decks[d].finisher(self.long_max)
        self.land(d, sk, sk["coins"], True)

    def rupture(self, i):
        """A coin hit side i: its Rupture (potency HP, count - 1), never its last HP when the blow may not kill."""
        p = self.spend(i, "rupture")
        n = min(p, self.hp[i] + self.sh[i] - (0 if self._lethal else 1))
        if n > 0:
            self.shield_first(i, n)
            self._rup.append(n)

    # --- statuses
    def add(self, i, s, pot, cnt):
        cur = self.st[i].setdefault(s, [0, 0])
        cap = RULES["tremor_max"] if s == "tremor" else RULES["status_max"]
        cur[0], cur[1] = min(cap, cur[0] + pot), min(cap, cur[1] + cnt)

    def spend(self, i, s) -> int:
        """Side i's status s used once: its potency (0 if none), count - 1."""
        cur = self.st[i].get(s)
        if not cur or cur[1] <= 0 or cur[0] <= 0:
            return 0
        cur[1] -= 1
        p = cur[0]
        if cur[1] <= 0:
            del self.st[i][s]
        return p

    def lose(self, i, n):
        """A status tick: n HP off side i (its Shield first), never its last one."""
        n = min(n, self.hp[i] - 1 + self.sh[i])
        if n > 0:
            self.shield_first(i, n)
            self._tick[i] += n

    def shield_first(self, i, n):
        """n damage on side i: its Shield takes it first, the rest off its HP."""
        a = min(self.sh[i], n)
        self.sh[i] -= a
        self.sh_used[i] += a
        self.hp[i] = max(0, self.hp[i] - (n - a))

    def hurt(self, i, dmg, atk, most) -> int:
        a = 1 - i
        ma, mi = self.F[a].get("mods") or {}, self.F[i].get("mods") or {}
        mult = 1 + ma.get("dmg", 0.0) + ma.get(f"dmg_{atk}", 0.0)
        mult *= max(0.3, 1 - mi.get("take", 0.0))
        p = self.spend(a, "poise") if self.st[a].get("poise") else 0
        if p and self.rnd.random() < p * RULES["poise_crit"]:
            mult *= RULES["crit_mult"]
        d = self.take(i, dmg * mult, atk, most)
        if d > 0 and self.hp[i] > 0:
            self.rupture(i)
        if a == self._side and self._first and d > 0:
            self._first = False
            for s, (pot, cnt) in ma.get("inflict", {}).items():
                self.add(i, s, pot, cnt)
        ls = ma.get("lifesteal", 0.0)
        if ls and d > 0 and self.hp[a] > 0:
            h = min(self.max[a] - self.hp[a], round(d * ls))
            if h > 0:
                self.hp[a] += h
                self._heal[a] += h
        return d

    def take(self, i, dmg, atk, most) -> int:
        """versus_engine.Fight.hurt with Shield: side i takes dmg x its resistance to atk (at most `most`), its Shield
        first, the rest off its HP."""
        mult = self.F[i]["resist"].get(atk, 1.0) or 1.0
        d = min(most, max(1, round(dmg * mult)))
        self.shield_first(i, d)
        return d

    def log(self, act, who, before, **kw):
        if kw.get("final") and who in (0, 1):
            self.sh[1 - who] = 0  # (the fall: whatever Shield is left goes with it)
        if act == "clash":
            for i in (0, 1):
                self.lose(i, self.spend(i, "bleed"))
        elif act in ("strike", "whole", "stand-off") and not kw.get("final"):
            for i in (0, 1):
                self.lose(i, self.spend(i, "burn"))
        super().log(act, who, before, **kw)
        s = self.steps[-1]
        s["st"] = [{k: list(v) for k, v in x.items()} for x in self.st]
        if any(self.sh0):
            s["sh"] = list(self.sh)
        if any(self._heal):
            s["heal"] = list(self._heal)
        if any(self._tick):
            s["tick"] = list(self._tick)
        if self._rup:
            s["rup"] = list(self._rup)  # (on the side `who` hit: 1 - who)
        if self._coin_dmg is not None and act in ("strike", "whole"):
            s["coinDmg"] = self._coin_dmg
            self._coin_dmg = None
        if self._burst and act in ("strike", "whole") and kw.get("final"):
            s.update(tremorBurst=True, sfx=[TREMOR_SOUND])  # (the player: the sound at the skill's first hit)
            self._burst = False
        self._heal, self._tick, self._rup = [0, 0], [0, 0], []


# the engine's options for a boss fight: the Versus page's clash base (viewer.CLASH_BASE: guards / evades, counters,
# whole skills up to 5 s, knockback 2x), exchanges ("pace"), the last skill drawn at random
FIGHT_OPTS = dict(rounds=RULES["rounds"], defend=True, counter=True, bursts=True, burstMax=5, kbscale=2, randskill=True, flow="")


class _SeriesOpts(dict):
    """(Exchanges off) the fight's options, but the series' winner — asked at its end — is one whose Tremor on the other
    one reaches its HP (its last skill kills by Tremor Burst; the player's side first); else as the engine decides."""

    def __init__(self, opts, fight):
        super().__init__(opts)
        self.fight = fight

    def get(self, k, default=None):
        f = self.fight
        if k == "winner" and f.clashes >= f.rounds:
            for i in (0, 1):
                if f.tremor_kills(1 - i):
                    f._burst = True
                    return i
        return super().get(k, default)


def boss_fight(player: dict, boss: dict, build: list[dict], gifts: dict, floor: int, hp_now: float | None, seed: int,
               opts: dict | None = None) -> dict:
    """One boss of the run: player (fighter) with its build vs boss (fighter) of floor (0-based); hp_now: the player's
    HP carried over (None: full). The engine's result + "hpMax" / "hp" in real numbers and "mods"."""
    mods = build_mods(build, gifts)
    hp_p = round(RULES["hp_player"] * (1 + mods["hp"]))
    k = min(floor, len(RULES["boss_hp"]) - 1)
    hp_b = round(RULES["hp_player"] * RULES["boss_hp"][k])
    a = with_build(player, mods)
    b = with_build(boss, build_mods([], gifts), RULES["boss_power"][min(floor, len(RULES["boss_power"]) - 1)])
    o = dict(FIGHT_OPTS, **(opts or {}))
    if o.get("flow") == "series":
        o["rounds"] = RULES["series_rounds"]
    mf = MirrorFight(a, b, seed, o, (hp_p, hp_b), (hp_p if hp_now is None else hp_now, hp_b))
    r = mf.run()
    r["mods"] = mods
    r["fighters"] = (a, b)
    r["shield"], r["shieldUsed"] = list(mf.sh0), list(mf.sh_used)
    return r


def seconds(fight: dict) -> float:
    """About how long the fight plays (s): clashes ~1 s each, landings their skill's length, the rest ~0.4 s."""
    t = 0.0
    for s in fight["steps"]:
        if s["act"] == "clash":
            t += 1.0
        elif s.get("sk"):
            t += s["sk"]["seconds"]
        elif s["act"] == "counter":
            t += 1.0
        else:
            t += 0.4
    return t


# ------------------------------------------------------------------ the run (pure: state is a plain dict)

def new_run(cat: dict, ids: list, seed: int) -> dict:
    """A run's state: {"seed", "phase", "floor", "cost", "hp" (None = full), "build", "offer", "shelf", "pack",
    "boss", "log"}. Phase "id": offer = 3 Identity ids."""
    rnd = random.Random(seed)
    return {"seed": seed, "step": 0, "phase": "id", "floor": 0, "cost": RULES["cost_start"], "hp": None, "build": [],
            "id": None, "offer": rnd.sample(ids, min(RULES["offers"], len(ids))), "shelf": [], "pack": None,
            "boss": None, "seen": [], "log": []}


def _rnd(run: dict) -> random.Random:
    run["step"] += 1
    return random.Random(run["seed"] * 1000 + run["step"])


def _gift_pick(cat, rnd, n, pool=None, kw=None, avoid=()) -> list:
    gifts = cat["gifts"]
    ids = [g for g in (pool or list(gifts)) if g in gifts and g not in avoid and (gifts[g].get("tier") or 1) <= 4]
    if kw is not None:
        ids = [g for g in ids if (gifts[g].get("kw") or "") == kw] or ids
    return rnd.sample(ids, min(n, len(ids)))


def owned(run) -> set:
    return {b["id"] for b in run["build"]}


def pick_id(run: dict, cat: dict, cid, kw: str = "") -> dict:
    """Identity picked: a start gift (tier 1, of its keyword `kw` if any), then the first shop."""
    run["id"] = cid
    g = _gift_pick(cat, _rnd(run), 1, kw=kw, pool=[x for x in cat["gifts"] if (cat["gifts"][x].get("tier") or 1) == 1])
    run["build"] += [{"id": x, "level": 1} for x in g]
    run["log"].append(f"Identity {cid}, start gift {g}")
    return open_shop(run, cat)


def open_shop(run: dict, cat: dict, kw=None) -> dict:
    """A shelf (from the last pack's pool, else any), phase "shop"."""
    pool = run["pack"]["pool"] if run.get("pack") else None
    run["shelf"] = _gift_pick(cat, _rnd(run), RULES["shop_size"], pool, kw, owned(run))
    run["phase"] = "shop"
    return run


def buy(run, cat, gid) -> dict:
    p = cat["gifts"][gid]["price"]
    if gid in run["shelf"] and run["cost"] >= p and gid not in owned(run):
        run["cost"] -= p
        run["shelf"].remove(gid)
        run["build"].append({"id": gid, "level": 1})
    return run


def sell(run, cat, gid) -> dict:
    b = next((x for x in run["build"] if x["id"] == gid), None)
    if b:
        run["build"].remove(b)
        run["cost"] += (cat["gifts"].get(gid) or {}).get("price", 0) // 2
    return run


def enhance(run, cat, gid) -> dict:
    b = next((x for x in run["build"] if x["id"] == gid), None)
    if b and b["level"] < 3 and run["cost"] >= RULES["enhance"][b["level"] - 1]:
        run["cost"] -= RULES["enhance"][b["level"] - 1]
        b["level"] += 1
    return run


def refresh(run, cat, kw=None) -> dict:
    c = RULES["kw_refresh"] if kw is not None else RULES["refresh"]
    if run["cost"] >= c:
        run["cost"] -= c
        open_shop(run, cat, kw)
    return run


def leave_shop(run, cat) -> dict:
    """Shop done: 3 packs to pick from (not ones seen before), phase "pack" — or, after the last boss, the end."""
    rnd = _rnd(run)
    left = [p for p in cat["packs"] if p["id"] not in run["seen"]] or cat["packs"]
    run["offer"] = [p["id"] for p in rnd.sample(left, min(RULES["offers"], len(left)))]
    run["phase"] = "pack"
    return run


def pick_pack(run, cat, pid, fightable=None) -> dict:
    """Pack picked: its boss (one of its boss pool that can fight: `fightable`), phase "boss"."""
    p = next(x for x in cat["packs"] if x["id"] == pid)
    rnd = _rnd(run)
    bosses = [b for b in p["bosses"] if fightable is None or b in fightable] or p["bosses"]
    run.update(pack=p, boss=rnd.choice(bosses), phase="boss")
    run["seen"].append(pid)
    return run


def fight_done(run, cat, fight: dict) -> dict:
    """A boss fight's result: lost → "end"; won → HP back to full (user, 2026-10-09: not carried over), Cost, phase
    "reward" (offer = 3 gifts of the pack)."""
    run["log"].append(f"floor {run['floor'] + 1}: {run['boss']} — {'won' if fight['winner'] == 0 else 'lost'}, "
                      f"HP {fight['hp'][0]}/{fight['hpMax'][0]}")
    if fight["winner"] != 0:
        run.update(phase="end", won=False)
        return run
    if run["floor"] + 1 >= RULES["floors"]:  # (the last boss: the run is over, no gift or shop after it)
        run.update(floor=run["floor"] + 1, phase="end", won=True, offer=[])
        return run
    run["hp"] = None
    run["cost"] += RULES["cost_boss"] + RULES["cost_floor"] * run["floor"]
    run["floor"] += 1
    run["offer"] = _gift_pick(cat, _rnd(run), RULES["offers"], run["pack"]["pool"], None, owned(run))
    run["phase"] = "reward"
    return run


def take_reward(run, cat, gid) -> dict:
    if gid in run["offer"]:
        run["build"].append({"id": gid, "level": 1})
    if run["floor"] >= RULES["floors"]:
        run.update(phase="end", won=True)
        return run
    return open_shop(run, cat)


# ------------------------------------------------------------------ the app's side (server.py /api/mirror/*, viewer.versus_job)
# The page keeps the run (a plain dict, sent back with each action); the server only answers: what an action makes of
# it, and the boss fight (the same seed every time: the Live window and "Result now" are the same fight).

def app_state(svc) -> dict:
    """{"cat", "fighters"} of the latest snapshot, kept on the Service (the catalog with names for the page; fighters
    built as they are needed, ~1 s each)."""
    sid = svc.latest_snapshot_id()
    st = getattr(svc, "_versus_mirror", None)
    if st and st["sid"] == sid:
        return st
    cat = catalog(svc)
    from .viewer import fighter_hud
    for p in cat["packs"]:
        p["bossNames"] = [fighter_hud(svc, b)["name"] for b in p["bosses"]]
    st = {"sid": sid, "cat": cat, "fighters": {}}
    svc._versus_mirror = st
    return st


def page_catalog(svc) -> dict:
    """What the page shows: gifts (with our effect in words, per level), packs, the rules, the statuses."""
    cat = app_state(svc)["cat"]
    gifts = {}
    for gid, g in cat["gifts"].items():
        if (g.get("tier") or 1) > 4:
            continue  # (never offered)
        gifts[gid] = {k: g.get(k) for k in ("name", "kw", "tier", "sin", "pic", "price")}
        gifts[gid]["eff"] = [mods_text(gift_mods(g, lv)) for lv in (1, 2, 3)]
    return {"gifts": gifts, "tremorSound": TREMOR_SOUND, "packs": [{k: p[k] for k in ("id", "name", "pic", "hard", "bosses", "bossNames", "pool")} for p in cat["packs"]],
            "rules": {k: RULES[k] for k in ("floors", "cost_start", "cost_boss", "cost_floor", "refresh", "kw_refresh", "enhance",
                                            "hp_player", "boss_hp", "boss_power")},
            "kwName": {k: v for k, v in KW_NAME.items() if k not in ATK_OF}, "status": [{"k": s, "name": ST_NAME[s], "kw": ST_KW[s], "help": ST_HELP[s]} for s in ST_NAME]}


def _fighters(svc, cids) -> dict:
    return fighters(svc, cids, app_state(svc)["fighters"])


def _offer_ids(svc, run: dict, pool: list) -> None:
    """run's Identity offer, each one able to fight (one that can't is swapped for another of the pool)."""
    rnd = random.Random(run["seed"] * 7 + 1)
    tried = set(run["offer"])
    for i, c in enumerate(run["offer"]):
        while c not in _fighters(svc, [c]):
            left = [x for x in pool if x not in tried]
            if not left:
                break
            c = rnd.choice(left)
            tried.add(c)
        run["offer"][i] = c


def fight_of(svc, run: dict) -> dict:
    """The boss fight of run's floor (phase "boss"): boss_fight with the run's Identity, build, HP and the floor's seed."""
    st = app_state(svc)
    F = _fighters(svc, [run["id"], run["boss"]])
    if run["id"] not in F or run["boss"] not in F:
        raise ValueError("this fighter can't fight")
    return boss_fight(F[run["id"]], F[run["boss"]], run["build"], st["cat"]["gifts"], run["floor"], run["hp"],
                      run["seed"] * 31 + run["floor"], {"flow": "series" if run.get("flow") == "series" else ""})


def fight_summary(fight: dict) -> dict:
    """A boss fight for the page: who won, HP, how long, and what happened in numbers (per side: clashes won, skills
    landed, damage dealt by hits / by statuses, healed)."""
    side = [{"clashes": 0, "landed": 0, "hits": 0, "status": 0, "heal": 0} for _ in (0, 1)]
    for s in fight["steps"]:
        if s["act"] == "clash" and not s.get("defense") and s.get("loser", -1) in (0, 1):
            side[1 - s["loser"]]["clashes"] += 1
        if s.get("sk") or s["act"] == "counter":
            side[s["who"]]["landed"] += 1
        for i in (0, 1):
            side[1 - i]["status"] += (s.get("tick") or [0, 0])[i]
            side[i]["heal"] += (s.get("heal") or [0, 0])[i]
    for i in (0, 1):
        # (the other one's HP + Shield lost overall, minus status ticks)
        lost = fight["hpMax"][1 - i] - fight["hp"][1 - i] + (fight.get("shieldUsed") or [0, 0])[1 - i]
        side[i]["hits"] = max(0, lost - side[i]["status"] + side[1 - i]["heal"])
    return {"winner": fight["winner"], "hp": fight["hp"], "hpMax": fight["hpMax"], "seconds": round(seconds(fight)),
            "clashes": fight["clashes"], "side": side}


def _up_to_date(run: dict, cat: dict) -> None:
    """A run the page kept from an older catalog (another game version, or gifts left out since — e.g. the attack-type
    ones): its pack as the catalog has it now, gifts no longer there dropped (a dropped owned gift is paid back)."""
    gifts = cat["gifts"]
    if run.get("pack"):
        run["pack"] = next((p for p in cat["packs"] if p["id"] == run["pack"]["id"]), None) or run["pack"]
        run["pack"]["pool"] = [g for g in run["pack"]["pool"] if g in gifts]
    gone = [b for b in run.get("build", []) if b["id"] not in gifts]
    for b in gone:
        run["cost"] += RULES["price"][1]
    run["build"] = [b for b in run.get("build", []) if b["id"] in gifts]
    run["shelf"] = [g for g in run.get("shelf", []) if g in gifts]
    if run.get("phase") == "reward":
        run["offer"] = [g for g in run.get("offer", []) if g in gifts]


def act(svc, run: dict | None, what: str, arg=None) -> dict:
    """One action of the page on its run: {"run"} after it (+ "fight": its summary, for "fight"). Actions: new (arg: a
    seed or None), id (arg: Identity id), buy / sell / enhance (gift id), refresh (arg: a keyword or None: any), leave,
    pack (pack id), fight, reward (gift id, or None: nothing taken)."""
    cat = app_state(svc)["cat"]
    out = {}
    if run is not None:
        _up_to_date(run, cat)
    if what == "new":  # (arg: {"seed", "flow"}, each optional)
        a = arg if isinstance(arg, dict) else {}
        pool = [x["id"] for x in svc.unit_db()["ids"]]
        run = new_run(cat, pool, int(a["seed"]) if a.get("seed") is not None else random.randrange(1, 10 ** 9))
        run["flow"] = "series" if a.get("flow") == "series" else ""
        _offer_ids(svc, run, pool)
    elif what == "id":
        if run["phase"] != "id" or arg not in run["offer"]:
            raise ValueError("not one of the offered Identities")
        x = next((i for i in svc.unit_db()["ids"] if i["id"] == arg), {})
        run["kw"] = (x.get("statuses") or [""])[0]
        pick_id(run, cat, arg, run["kw"])
    elif what in ("buy", "sell", "enhance"):
        {"buy": buy, "sell": sell, "enhance": enhance}[what](run, cat, int(arg))
    elif what == "refresh":
        refresh(run, cat, arg if arg is not None else None)
    elif what == "leave":
        leave_shop(run, cat)
    elif what == "pack":
        if run["phase"] != "pack" or arg not in run["offer"]:
            raise ValueError("not one of the offered packs")
        p = next(x for x in cat["packs"] if x["id"] == arg)
        pick_pack(run, cat, arg, _fighters(svc, p["bosses"]))
        from .viewer import fighter_hud
        k = min(run["floor"], len(RULES["boss_hp"]) - 1)
        run["bossInfo"] = dict(fighter_hud(svc, run["boss"]), hpMax=round(RULES["hp_player"] * RULES["boss_hp"][k]),
                               power=RULES["boss_power"][min(run["floor"], len(RULES["boss_power"]) - 1)])
    elif what == "fight":
        if run["phase"] != "boss":
            raise ValueError("no boss to fight now")
        f = fight_of(svc, run)
        out["fight"] = dict(fight_summary(f), floor=run["floor"], boss=run["boss"], pack=run["pack"]["id"])
        fight_done(run, cat, f)
        run.setdefault("fights", []).append({k: out["fight"][k] for k in ("floor", "boss", "pack", "winner", "hp", "hpMax", "seconds", "clashes", "side")})
    elif what == "reward":
        if run["phase"] != "reward":
            raise ValueError("no reward to take now")
        if arg is None:
            run["offer"] = []
        take_reward(run, cat, int(arg) if arg is not None else None)
    else:
        raise ValueError(f"unknown action {what}")
    m = build_mods(run["build"], cat["gifts"])  # (for the page: the max HP, the build's effects summed up)
    hp = round(RULES["hp_player"] * (1 + m["hp"]))
    run.update(hpMax=hp, shield=round(hp * min(1.0, m["shield"])), buildText=mods_text(m))
    out["run"] = run
    return out
