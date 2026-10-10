"""Versus → Mirror v2: the Mirror run rebuilt after the 2026-10-10 design talk with the user (CLAUDE.md "Mirror v2").

What changed against versus_mirror (v1, kept as it is):
- the fight: clashes as in v1 (an exchange of 2-5 clash rounds, the one that won more lands its whole skill; user
  2026-10-10: no coin breaking), skills come from a deck (S1 x3, S2 x2, S3 x1, shuffled, drawn to the end),
  each fighter has ONE defense — its own from the game's data (Counter, Guard or Evade), damage and statuses in plain
  numbers (HP is the game's, ~180-250, not 70);
- four characters only, each with its own kit — the user's own words (memory "user-designs-kits"; numbers in KIT_RULES):
  Outis 11115: "3 phases, each counter moves her to the next, you have to live until then; in that phase she gets very
    strong"; Zwei Ishmael 10810: "block stacks Tremor, then one-shots" + (user's pick) "clashes weakly";
  Ryōshū 10414: "shoots bonus shots, spends her bullets, tries to evade, between the enemy's attacks may shoot to put on
    effects" (user 2026-10-10: the bonus shot from the start, no level for it); Ryōshū 10412: "stacks damage up on herself; after N stacks (7, as in the
    game) she locks herself in stone that lets her do nothing" (user: nothing else in stone; leveling changes it later);
  character levels (bought in the shop) unlock functions — only the ones the user named;
- 5 floors (boss HP / power rise), the 5th a final boss from a short list; a pack = a floor with a clear goal: its keyword,
  its bosses (one drawn) and the gift it pays out shown before it is picked; Hard packs: stronger boss, more Cost;
- economy: interest (+10 per 100 held, at most +50, after each boss), economy gifts (the game's own: Golden Urn breaks after
  the next won fight for +200, …), few gift slots (6, +1 per boss, at most 10: sell to make room), shop lock, recipe
  fusion (the game's fixed recipes: all ingredients → one fused gift at ++).
Kit things show under the HP as statuses with the game's own icons (KIT_ST: Outis' sword stage up to Lævateinn, bullets,
Gaze of Contempt stacks, the stone = Contempt of the Gaze). Not here yet (user): SP / panic (they ask friends first),
Starlight buffs, a look of its own for the stone.

Pure like v1 (plain dicts) except catalog / fighters / the app's side at the end."""
from __future__ import annotations

import random
import re

from . import versus_engine as E
from . import versus_mirror as M

VERSION = 1

RULES = {
    "floors": 5,
    "offers": 3,                 # packs to pick from
    "shop_size": 5,
    "cost_start": 300, "cost_boss": 200, "cost_floor": 50,   # + after a won boss (+ this per floor)
    "interest": (10, 100, 50),   # + this per that much held, at most (after each won boss)
    "slots": (6, 1, 10),         # gift slots: at the start, + per boss down, at most
    "price": M.RULES["price"], "refresh": 50, "kw_refresh": 100, "enhance": (100, 150),
    "level_price": (250, 400),   # a character's level 2, 3
    "hp_ref": 230,               # the bosses' HP: this x boss_hp[floor] (the characters' own HP: 184-254)
    "boss_hp": (1.0, 1.25, 1.5, 1.8, 2.2),
    "boss_power": (0, 1, 2, 3, 4),
    "hard": {"hp": 1.2, "power": 1, "cost": 150},             # a Hard pack's boss: x HP, + power; + Cost when won
    "tiers": (2, 3, 4, 4, 4),    # gifts in shops and rewards by floor: at most this tier
    "landing_cap": 0.4,          # one landing at most this share of the HP (no one-shots; statuses go past it)
    "rounds": 90,                # clash rounds at most (then the engine's finale)
    "boss_defend": 0.22,         # how often a boss defends instead of clashing
    "boss_status": 2,            # a boss deals its pack keyword's status as a gift of this tier would (user: a middle value for now)
    # damage (user 2026-10-10: "a stable, normal damage logic, not tied to the skills"): a landing of the deck's 1st / 2nd /
    # 3rd skill deals this much, its coins sharing it; each heads + dmg_heads of it on top; each point of power (a boss's
    # floor, Outis' phase, Charge gifts) + dmg_power; a counter / bonus shot this much. The game's numbers decide clashes only
    "dmg": (20, 30, 45), "dmg_counter": 12, "dmg_heads": 0.10, "dmg_power": 0.075,
    "dmg_flat": 60,              # a gift's "+x damage" share → + this x per landing (0.05 → +3)
    "boss_dmg": 0.7,             # a boss's damage x this (its floor's power adds on top)
}

# Kits: the user's words above; these are only the numbers (all ours, open to the user's say)
KIT_RULES = {
    "phase_power": (-3, -2, -1), # Outis: + base power in phase 1 / 2 / 3 (phase 3 also fights with her Lævateinn skills)
    "zwei_clash": -1,            # Zwei: her clash power
    "block_tremor": 2.0,         # Zwei: Tremor on the enemy per block = this x the block's roll
    "bullets": 6,                # 10414: her drum (the game's 6 BulletGodok); empty → Tremor Burst on the enemy, then full again
    "ammo_skills": True,         # 10414: her S1 / S2 spend a bullet too (else only the bonus shots; user: try both)
    "shot_tremor": 4,            # 10414: a bonus shot's Tremor (her S1 coin's in the game)
    "gaze_max": 7, "gaze_dmg": 1,  # 10412: stacks to the stone; + damage per coin per stack
    "stone_turns": 2,            # 10412: exchanges in stone
    "hp_min": 220,               # a character's HP: the game's (level 50), at least this (10414 / 10412 have 184 / 188)
}

# group = the animation (<Char>_S<n>); sid = the game's skill whose numbers it fights with
KITS = {
    # (animations as the game ties them: the Appearance's motionList, _motiondetail 6 + n = the skills' skillMotion "S<n>" — her
    # timeline names don't follow it: S2 plays Phase1_S4, S4 (Rule Violation) Phase1_S5, S6 Phase4_S2, S8 Phase1_S6)
    11115: {"key": "phases", "defense": "Counter", "defend_p": 0.25,
            "deck": [("Outis_Middle_Father_Phase1_S1", 1111501), ("Outis_Middle_Father_Phase1_S4", 1111502), ("Outis_Middle_Father_Phase1_S3", 1111503)],
            "deck3": [("Outis_Middle_Father_Phase4_S1", 1111505), ("Outis_Middle_Father_Phase4_S2", 1111506), ("Outis_Middle_Father_Phase4_S3", 1111507)],
            "finisher": ("Outis_Middle_Father_Phase4_S9", 1111509), "counter": "Outis_Middle_Father_Phase1_S5",
            # her counter (user): "Time to Unpack!" (1111508, skillMotion S8 = motionList 14 = Phase1_S6, 4 timelines for its 4 coins)
            "unpack": ("Outis_Middle_Father_Phase1_S6", 1111508),
            "words": "3 phases. Each Counter moves her to the next one — you have to live until then; in phase 3 she gets very strong.",
            "rules": ["Defense: Counter — takes the blow, strikes back with Time to Unpack! (whole skill)", "Each Counter: next phase (1 → 2 → 3)",
                      "Phase 1: −3 power · Phase 2: −2 power · Phase 3: −1 power, with her Lævateinn skills (5 coins)"],
            "levels": {}},
    10810: {"key": "block", "defense": "Guard", "defend_p": 0.45,
            "deck": [("Ishmael_Zwei_S1", 1081001), ("Ishmael_Zwei_S2", 1081002), ("Ishmael_Zwei_S3", 1081003)],
            "words": "Blocks and stacks Tremor, then one-shots. Clashes weakly.",
            "rules": ["Defense: Guard", "Each block: Tremor on the enemy = 2 × the block's roll",
                      "Tremor as high as the enemy's HP: her next hit kills (Tremor Burst)", "Clash power −1"],
            "levels": {}},
    10414: {"key": "gun", "defense": "Evade", "defend_p": 0.35,
            "deck": [("S1", 1041401), ("S2", 1041402), ("S3", 1041403)], "ammo": (1, 1, 0),
            "words": "Shoots and spends her bullets, tries to evade; between the enemy's attacks she may shoot to put effects on it.",
            "rules": ["Defense: Evade", "A drum of 6 bullets: S1, S2 and each bonus shot spend one",
                      "Drum empty: Tremor Burst — the enemy loses HP equal to its Tremor, its Tremor halves; the drum is full again",
                      "Bonus shot: during the enemy's attack, right after the blows she dodged, one shot (1 bullet): its damage + 4 Tremor"],
            "levels": {}},
    10412: {"key": "stone", "defense": "Guard", "defend_p": 0.25,
            "deck": [("Ryoshu_Jiahuan_S1", 1041201), ("Ryoshu_Jiahuan_S2", 1041202), ("Ryoshu_Jiahuan_S3", 1041203)],
            "words": "Stacks damage up on herself; after 7 stacks she locks herself in stone that lets her do nothing.",
            "rules": ["Defense: Guard", "Each of her coins that hits: +1 stack (+1 damage per coin each)",
                      "7 stacks: stone for 2 exchanges — does nothing, the enemy hits freely; then the stacks are gone"],
            "levels": {}},
}

# kit things shown under the HP as statuses (the player draws icon + number): key → the game's buff icon
KIT_ST = {"sw1": "MiddleFatherSwordOneOutis", "sw2": "MiddleFatherSwordTwoOutis", "sw3": "MiddleFatherSwordFourOutis",
          "ammo": "BulletGodok", "gaze": "GazePersonality", "stone": "ContemptPersonality"}

# 10414's bullet drum: the game's effect, a child of her prefab (under DefaultEffectPivot); its animator's states
# "<name>_ani_<n>" hold n bullets, "_ani_1<n>" fire one of n, "_ani_Re" reloads (the player: Viewer DrumFire)
DRUM_FX = "FX_PC_9_Ryoshu_Walpu8_Buff8_BulletCylinder"

# the final floor's bosses (big ones of the game that our player shows well; checked in the 2026-10-10 boss renders)
FINAL_BOSSES = ["8172_MaouHeathclif_MainAppearance", "8049_DongLang_1pAppearance", "8550_LostPassengerAppearance",
                "8585_ContemptSpiralAppearance"]

# economy gifts: the game's own (their text says what they do; numbers as ours): no fight effect
ECON = {
    9079: {"urn": 200},          # Golden Urn: breaks after the next won fight, +200 Cost (user's example)
    9078: {"income": 30},        # Voracious Hammer: + Cost after each won boss
    9080: {"income": 80},        # Milepost of Survival
    9185: {"enh_back": 0.2},     # Rebate Token: an enhance's Cost back 20 % of the time
    9186: {"ref_back": 0.2},     # New Release Pamphlet: a refresh's Cost back 20 % of the time
    9188: {"ref_off": 0.3},      # Pre-order Discount: refresh −30 %
    9189: {"enh_off": 0.3},      # Renewed Merch: enhance −30 %
    9191: {"buy_off": 0.3},      # Prestige Card: buying −30 %
}
NOT_GIFTS = {9190}  # (skill replacement: nothing of ours)


def econ_text(e: dict) -> list[str]:
    out = []
    if e.get("urn"):
        out.append(f"After the next won fight it breaks: +{e['urn']} Cost")
    if e.get("income"):
        out.append(f"+{e['income']} Cost after each won boss")
    for k, what in (("enh_back", "an enhance"), ("ref_back", "a refresh")):
        if e.get(k):
            out.append(f"{round(e[k] * 100)} % chance to get {what}'s Cost back")
    for k, what in (("ref_off", "Refresh"), ("enh_off", "Enhance"), ("buy_off", "Buying gifts")):
        if e.get(k):
            out.append(f"{what} −{round(e[k] * 100)} % Cost")
    return out


# ------------------------------------------------------------------ data (app side)

def kit_fighter(base: dict, cid: int, skills_t) -> dict:
    """A kit character: its deck's skills (the kit's animations with the game's numbers of the kit's skill ids), one defense."""
    k = KITS[cid]
    by = {s["group"]: s for s in base["skills"]}

    def mk(g, sid):
        s = by.get(g)
        if s is None:
            return None
        d = E._skill(sid, skills_t)
        return dict(s, **{x: d[x] for x in ("base", "coin", "coins", "atk")}) if d else dict(s)
    deck = [x for x in (mk(*e) for e in k["deck"]) if x]
    deck3 = [x for x in (mk(*e) for e in k.get("deck3") or []) if x]
    fin = mk(*k["finisher"]) if k.get("finisher") else None
    skills = deck + deck3 + ([fin] if fin else [])
    f = dict(base, skills=skills, deck1=deck, deck3=deck3 or None, kit=cid, hp=max(base["hp"], KIT_RULES["hp_min"]))
    if k.get("unpack"):
        f["unpack"] = mk(*k["unpack"])
    if k["defense"] == "Counter":
        f["guard"] = None
        f["counterParts"] = (by.get(k["counter"]) or {}).get("parts")
    else:
        g = base.get("guard") or {"base": 5, "coin": 3, "coins": 1}
        f["guard"] = dict(g, kind=k["defense"])
        f["counter"] = None
    return f


def defense_of(f: dict) -> str:
    """A fighter's one defense: its kit's, else the data's (Guard / Evade skill, else its Counter), else Guard."""
    if f.get("kit"):
        return KITS[f["kit"]]["defense"]
    if f.get("guard"):
        return f["guard"]["kind"]
    return "Counter" if f.get("counter") else "Guard"


# ------------------------------------------------------------------ the fight (pure)

class Deck2(E.Deck):
    """The game's deck: S1 x3, S2 x2, S3 x1 (later ones x1), shuffled, drawn to the end, then shuffled again."""

    def __init__(self, f, rnd, R=E.RULES):
        super().__init__(f, rnd, R)
        pool = f.get("deck1") or [s for s in f["skills"] if s["seconds"] <= R["finisher_from"]] or f["skills"]
        self.use(pool)

    def use(self, pool):
        self.pool, self.bag = list(pool), []
        self.slot = {id(s): min(k, 2) for k, s in enumerate(self.pool)}  # (its damage: RULES dmg by the deck's order)

    def skill(self, rng="close", long_max=99.0):
        if not self.bag:
            self.bag = [s for k, s in enumerate(self.pool) for _ in range((3, 2, 1)[min(k, 2)])]
            self.rnd.shuffle(self.bag)
        self.last_skill = self.bag.pop()
        return self.last_skill

    def peek(self):
        return self.bag[-1] if self.bag else None

    def counter_coin(self):
        parts = [t for t in self.f.get("counterParts") or [] if t["events"].get("hits")]
        return self.rnd.choice(parts) if parts else super().counter_coin()


class Fight2(M.MirrorFight):
    """MirrorFight (statuses, Shield, Tremor kills, coin damage) with the new rules: the deck, one
    defense per side, side 0's kit. `level`: the character's level (its unlocks)."""

    def __init__(self, a, b, seed, opts, hp_max, hp_now, level=1):
        super().__init__(a, b, seed, opts, hp_max, hp_now)
        self.R["landing_cap"] = RULES["landing_cap"]
        self.decks = (Deck2(a, self.rnd, self.R), Deck2(b, self.rnd, self.R))
        self.kit = KITS.get(a.get("kit")) or {}
        self.key = self.kit.get("key", "")
        self.level = level
        self.how = (defense_of(a), defense_of(b))
        self.def_p = (self.kit.get("defend_p", 0.25), RULES["boss_defend"])
        KR = KIT_RULES
        self.phase, self.bullets, self.gaze, self.stone = 1, KR["bullets"], 0, 0
        self.stat = {"phases": 1, "shots": 0, "reloads": 0, "stones": 0, "blockTremor": 0, "counters": 0}
        if self.key == "phases":
            self.set_phase(1)
        self.ammo = {}
        if self.key == "gun":
            self.ammo = {id(s): n for s, n in zip(a["deck1"], self.kit["ammo"])}

    # --- kit numbers
    def cpow(self, i, sk, coins) -> int:
        p = self.roll(sk, coins)
        if i == 0 and self.key == "block":
            p += KIT_RULES["zwei_clash"]
        return p

    def hurt(self, i, dmg, atk, most):
        if i == 1 and self.key == "stone" and self.gaze and self._side == 0:
            dmg += self.gaze * KIT_RULES["gaze_dmg"]
        return super().hurt(i, dmg, atk, most)

    def set_phase(self, n):
        self.phase = n
        self.stat["phases"] = max(self.stat["phases"], n)
        add = KIT_RULES["phase_power"][n - 1]
        pool = (self.F[0]["deck3"] if n >= 3 and self.F[0].get("deck3") else self.F[0]["deck1"])
        self.decks[0].use([dict(s, base=s["base"] + add, pw=s.get("pw", 0) + add) for s in pool])

    # --- damage (RULES dmg): fixed per skill slot, not the game's coin powers
    def mult(self, sk, w=0) -> float:
        return max(0.2, 1 + RULES["dmg_power"] * sk.get("pw", 0)) * (RULES["boss_dmg"] if w == 1 else 1)

    def coin_damage(self, w, sk, power, head) -> float:
        b = sk.get("budget") or RULES["dmg"][self.decks[w].slot.get(id(sk), 1)]
        c = max(1, sk["coins"])
        flat = (self.F[w].get("mods") or {}).get("dmgFlat", 0)
        return (b / c + (b * RULES["dmg_heads"] if head else 0)) * self.mult(sk, w) + flat / c

    def counter(self, d, w):
        """A strike back: Outis' Time to Unpack! (whole, dmg_counter in all); a Tremor kill as before; else one coin of
        dmg_counter."""
        if self.tremor_kills(w) and not self.series and self.decks[d].counter_coin() is not None:
            return super().counter(d, w)
        un = self.F[0].get("unpack") if d == 0 and self.key == "phases" else None
        if un is not None and self.hp[1] > 1:
            b4 = E.range_of(self.gap(), self.R)
            self.meet(0)
            self.log("run-in", 0, b4, result="strikes back: Time to Unpack!")
            add = KIT_RULES["phase_power"][self.phase - 1]
            un = dict(un, base=un["base"] + add, pw=un.get("pw", 0) + add, budget=RULES["dmg_counter"])
            self.land(0, un, un["coins"], True, lethal=False)
            return
        anim = self.decks[d].counter_coin()
        if anim is None:
            return
        sk = self.F[d]["skills"][0]
        b4 = E.range_of(self.gap(), self.R)
        self.meet(d)
        self.log("run-in", d, b4, result="strikes back")
        self._side, self._first = d, False
        dmg = 0
        if self.hp[w] > 1:
            dmg = self.hurt(w, RULES["dmg_counter"] * self.mult(sk, d), sk.get("atk") or "",
                            min(round(self.max[w] * self.R["landing_cap"]), self.hp[w] - 1))
        self.knock(w, E.knock_bodies(E._last_force([anim]), self.kbs))
        self.log("counter", d, b4, skill=sk["group"], anim=anim, dmg=dmg, dmgShare=dmg / self.max[w],
                 result=f"strikes back: {dmg} damage")

    def land(self, w, sk, coins, whole, defense=None, lethal=True):
        rec = defense == "Guard" and w == 1 and self.key == "block"
        rolls = []
        if rec:
            orig = self.roll

            def roll(s, n):
                v = orig(s, n)
                rolls.append(v)
                return v
            self.roll = roll
        try:
            final = super().land(w, sk, coins, whole, defense, lethal)
        finally:
            if rec:
                del self.roll
        if rec and rolls and not final:
            t = round(rolls[0] * KIT_RULES["block_tremor"])
            if t > 0:
                self.add(1, "tremor", t, 0)
                self.stat["blockTremor"] += t
                self.steps[-1]["st"][1] = {k: list(v) for k, v in self.st[1].items()}
                self.steps[-1]["result"] += f", +{t} Tremor"
        return final

    def shot(self, mid: int):
        """(10414) A bonus shot during the enemy's attack: one coin of her S1, unopposed, + Tremor; 1 bullet. `mid`: the
        enemy's coins she dodged (its first ones) — the player puts the shot right after the last of them, before its next
        blow (versus_engine.script); she shoots from where she is, no run-in."""
        sk = self.F[0]["deck1"][0]
        parts = [t for t in sk["parts"] if t["events"].get("hits")]
        if not parts or self.hp[1] <= 1:
            return
        # (her plain S1 "Bang. Bang." coin that fires at once — Timeline_2, its shot 0.08 s in — so the enemy waits least)
        anim = min(parts, key=lambda t: min(h["t"] for h in t["events"]["hits"]))
        b4 = E.range_of(self.gap(), self.R)
        self._side, self._first = 0, False
        dmg = self.hurt(1, RULES["dmg_counter"] * self.mult(sk), sk["atk"], min(round(self.max[1] * self.R["landing_cap"]), self.hp[1] - 1))
        self.add(1, "tremor", KIT_RULES["shot_tremor"], 0)
        drum = self.bullets
        self.stat["shots"] += 1  # (no knockback: the enemy is in the middle of its attack)
        self.log("counter", 0, b4, skill=sk["group"], anim=anim, dmg=dmg, dmgShare=dmg / self.max[1], mid=mid,
                 result=f"bonus shot after {mid} dodged: {dmg} damage, +{KIT_RULES['shot_tremor']} Tremor")
        self.steps[-1]["drum"] = drum  # (the player: the drum fires from this many bullets, see versus_engine.script)
        self.spend_bullet()

    def spend_bullet(self):
        """(10414) One bullet out of her drum; the last one: Tremor Burst on the enemy (HP lost = its Tremor, never the
        last one; its Tremor halves), the drum full again."""
        self.bullets -= 1
        if self.bullets > 0:
            return
        t = (self.st[1].get("tremor") or [0])[0]
        if t > 0:
            self.lose(1, t)
            self.st[1]["tremor"][0] = t // 2
            if self.st[1]["tremor"][0] <= 0:
                del self.st[1]["tremor"]
            self.stat["bursts"] = self.stat.get("bursts", 0) + 1
            self.stat["burstDmg"] = self.stat.get("burstDmg", 0) + t
        self.bullets = KIT_RULES["bullets"]
        self.stat["reloads"] += 1
        if self.steps:
            s = self.steps[-1]
            s["result"] += f", drum empty: Tremor Burst {t}, reload" if t > 0 else ", drum empty: reload"
            s["drumRe"] = True
            if t > 0:
                s["sfx"] = s.get("sfx", []) + [M.TREMOR_SOUND]
            s["st"] = [{k: list(v) for k, v in x.items()} for x in self.st]
            if any(self._tick):  # (the HP lost: on this step, as MirrorFight.log puts a tick)
                s["tick"] = [a + b for a, b in zip(s.get("tick") or [0, 0], self._tick)]
                self._tick = [0, 0]
            self.kit_now()

    def kit_st(self) -> dict:
        """Side 0's kit things as statuses (KIT_ST keys: [number, 0])."""
        if self.key == "phases":
            return {("sw1", "sw2", "sw3")[self.phase - 1]: [self.phase, 0]}
        if self.key == "gun":
            return {"ammo": [max(0, self.bullets), 0]}
        if self.key == "stone":
            return {"stone": [self.stone, 0]} if self.stone else {"gaze": [self.gaze, 0]} if self.gaze else {}
        return {}

    def kit_now(self):
        """The last step with the kit's state as it is now (it may have changed after the step was logged)."""
        s = self.steps[-1]
        s["kit"] = {"phase": self.phase, "bullets": self.bullets, "gaze": self.gaze, "stone": self.stone}
        if "st" in s:
            s["st"][0] = dict({k: v for k, v in s["st"][0].items() if k not in KIT_ST}, **self.kit_st())

    def log(self, act, who, before, **kw):
        super().log(act, who, before, **kw)
        if self.key:
            self.kit_now()

    # --- the fight
    def run(self):  # noqa: C901
        R, rnd = self.R, self.rnd
        self.log("stand-off", -1, "far", result="the fight starts")
        runs = -1
        while self.clashes < self.rounds and self.hp[0] > 0 and self.hp[1] > 0:
            before = E.range_of(self.gap(), R)
            if self.gap() > R["close"] + 1e-6:
                if runs < 0:
                    near = [i for i in (0, 1) if self.room(i) < 2 * R["edge_room"]]
                    if len(near) == 1:
                        runs = near[0]
                self.meet(runs)
                self.log("run-in", runs, before, result="runs in" if runs >= 0 else "both run in")
            runs = -1
            sks = [self.decks[0].skill(), self.decks[1].skill()]
            if self.stone > 0:
                # (10412 in stone: she does nothing, the enemy lands its skill)
                self.stone -= 1
                if self.stone == 0:
                    self.gaze = 0
                b4 = E.range_of(self.gap(), R)
                self.meet(1)
                self.log("run-in", 1, b4, result="runs at the stone")
                if self.land(1, sks[1], sks[1]["coins"], True):
                    break
                self.steps[-1]["result"] += " (in stone)" + (": the stone breaks" if self.stone == 0 else "")
                runs = 1
                continue
            d = None
            if rnd.random() < self.def_p[0]:
                d = 0
            elif rnd.random() < self.def_p[1]:
                d = 1
            if d is not None:
                w = 1 - d
                how = self.how[d]
                self.defended[d] += 1
                b4 = E.range_of(self.gap(), R)
                self.meet(w)
                self.log("run-in", w, b4, result="runs at it")
                if self.land(w, sks[w], sks[w]["coins"], True, defense=how):
                    break
                runs = w
                if how == "Counter":
                    self.counter(d, w)
                    runs = d
                    if self.hp[w] <= 0:
                        break
                    if d == 0 and self.key == "phases":
                        self.stat["counters"] += 1
                        if self.phase < 3:
                            self.set_phase(self.phase + 1)
                            self.steps[-1]["result"] += f", phase {self.phase}"
                            self.kit_now()
                dodged = re.search(r"\b([1-9]\d*) of \d+ dodged", self.steps[-1].get("result", "")) if d == 0 and how == "Evade" else None
                if dodged and self.key == "gun" and self.bullets > 0:
                    self.shot(int(dodged.group(1)))
                continue
            # an exchange (as before): 2-5 clash rounds, each won by the higher roll of the skill's coins; the one that
            # won more lands its whole skill, as many won: nobody is hit
            n = min(rnd.randint(*R["exchange"]), self.rounds - self.clashes)
            wins = [0, 0]
            for r in range(n):
                p = [self.cpow(0, sks[0], sks[0]["coins"]), self.cpow(1, sks[1], sks[1]["coins"])]
                while p[0] == p[1]:
                    p = [self.cpow(0, sks[0], sks[0]["coins"]), self.cpow(1, sks[1], sks[1]["coins"])]
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
                b4 = E.range_of(self.gap(), R)
                anims = (self.decks[0].anim(), self.decks[1].anim())
                push = R["loser_push"]
                if self.room(1 - lo) < R["edge_room"]:
                    push = max(push, self.x[lo] * self.facing(lo))
                self.x[lo] = self.off_wall(self.x[lo] - self.facing(lo) * push)
                self.log("clash", 1 - lo, b4, loser=lo, pow=p, skills=[sks[0]["group"], sks[1]["group"]], anims=anims,
                         nth=[r + 1, n], result=f"wins {p[1 - lo]} to {p[lo]}, #{lo} knocked back{edge}")
                if r == 0 and self.key == "gun" and KIT_RULES["ammo_skills"] and self.ammo.get(id(sks[0]), 0):
                    self.steps[-1]["drum"] = self.bullets  # (her S1 / S2 spends a bullet: the drum shows at its first round)
                    self.spend_bullet()
                if r < n - 1:
                    b4 = E.range_of(self.gap(), R)
                    self.meet(1 - lo)
                    self.log("run-in", 1 - lo, b4, result="runs at it")
            if self.clashes >= self.rounds:
                break
            if wins[0] == wins[1]:
                before = E.range_of(self.gap(), R)
                moved = self.gap() <= R["close"] + 1e-6
                if moved:
                    self.apart()
                self.log("stand-off", -1, before, stay=not moved,
                         result="nobody hit, both spring apart" if moved else "nobody hit, they hold where they are")
                continue
            w = 0 if wins[0] > wins[1] else 1
            b4 = E.range_of(self.gap(), R)
            self.meet(w)
            self.log("run-in", w, b4, result="runs at it")
            if self.land(w, sks[w], sks[w]["coins"], True):
                break
            runs = w
            if w == 0 and self.key == "stone" and self.stone == 0:
                self.gaze = min(KIT_RULES["gaze_max"], self.gaze + sum(1 for x in self.steps[-1].get("coinDmg") or [] if x > 0))
                if self.gaze >= KIT_RULES["gaze_max"]:
                    self.stone = KIT_RULES["stone_turns"]
                    self.stat["stones"] += 1
                    self.steps[-1]["result"] += ", turns to stone"
                self.kit_now()
        if self.hp[0] > 0 and self.hp[1] > 0:  # (the safety net: the lower one by HP share falls)
            w = 0 if self.hp[0] / self.max[0] >= self.hp[1] / self.max[1] else 1
            sk = self.decks[w].finisher(self.long_max)
            b4 = E.range_of(self.gap(), R)
            self.meet(w)
            self.log("run-in", w, b4, result="runs in")
            dd = self.hp[1 - w]
            self.hp[1 - w] = 0
            self.log("whole", w, E.range_of(self.gap(), R), skill=sk["group"], sk=sk, coins=sk["coins"], dmg=dd,
                     dmgShare=dd / self.max[1 - w], result=f"#{1 - w} falls", final=True)
        winner = 0 if self.hp[0] > 0 else 1
        return {"steps": self.steps, "winner": winner, "seed": self.seed, "hp": list(self.hp), "hpMax": self.max,
                "clashes": self.clashes, "stExtra": list(KIT_ST)}


FIGHT_OPTS = dict(M.FIGHT_OPTS, rounds=RULES["rounds"], flow="")


def build_mods(build, gifts) -> dict:
    """The fight numbers of a build (economy gifts have none; a fused gift counts at ++)."""
    return M.build_mods([b for b in build if b["id"] not in ECON], gifts)


def boss_hp(floor: int, hard: bool) -> int:
    k = min(floor, len(RULES["boss_hp"]) - 1)
    return round(RULES["hp_ref"] * RULES["boss_hp"][k] * (RULES["hard"]["hp"] if hard else 1))


def boss_power(floor: int, hard: bool) -> int:
    return RULES["boss_power"][min(floor, len(RULES["boss_power"]) - 1)] + (RULES["hard"]["power"] if hard else 0)


def flat_mods(m: dict) -> dict:
    """A build's numbers with its "+x damage" share as + damage per landing (RULES dmg_flat), as the fight uses it."""
    return dict(m, dmg=0.0, dmgFlat=round(m.get("dmg", 0.0) * RULES["dmg_flat"]))


def mods_lines(m: dict) -> list[str]:
    """mods_text, with "+x damage" as a number per skill."""
    f = flat_mods(m)
    return M.mods_text(f) + ([f"+{f['dmgFlat']} damage per skill landed"] if f["dmgFlat"] else [])


def boss_mods(kw: str) -> dict:
    """A boss's own numbers: the status of its pack's keyword (Bleed, Burn, Rupture, Tremor dealt; Poise gained), as a
    gift of tier boss_status gives it. Sinking / Charge / General have no status: nothing."""
    m = build_mods([], {})
    eff = (M.EFFECTS.get(kw) or {}).get(RULES["boss_status"]) or {}
    for key in ("inflict", "self"):
        m[key] = {st: list(v) for st, v in (eff.get(key) or {}).items()}
    return m


def boss_fight(player, boss, build, gifts, floor, hard, seed, level=1, kw="") -> dict:
    mods = flat_mods(build_mods(build, gifts))
    hp_p = round(player["hp"] * (1 + mods["hp"]))
    hp_b = boss_hp(floor, hard)
    a = M.with_build(player, mods)
    for s in a["skills"]:
        s["pw"] = mods.get("base", 0)
    if a.get("deck1"):  # (the kit's decks with the build's numbers too)
        by = {s["group"]: s for s in a["skills"]}
        a["deck1"] = [by[s["group"]] for s in player["deck1"]]
        if player.get("deck3"):
            a["deck3"] = [by[s["group"]] for s in player["deck3"]]
        if player.get("unpack"):
            a["unpack"] = dict(M.with_build(dict(player, skills=[player["unpack"]]), mods)["skills"][0], pw=mods.get("base", 0))
    b = M.with_build(boss, boss_mods(kw), boss_power(floor, hard))
    for s in b["skills"]:
        s["pw"] = boss_power(floor, hard)
    mf = Fight2(a, b, seed, dict(FIGHT_OPTS), (hp_p, hp_b), (hp_p, hp_b), level)
    r = mf.run()
    r.update(mods=mods, fighters=(a, b), shield=list(mf.sh0), shieldUsed=list(mf.sh_used), kit=dict(mf.stat))
    return r


# ------------------------------------------------------------------ the run (pure)

def slots(run) -> int:
    s0, per, top = RULES["slots"]
    return min(top, s0 + per * run["floor"])


def owned(run) -> set:
    return {b["id"] for b in run["build"]}


def _rnd(run) -> random.Random:
    run["step"] += 1
    return random.Random(run["seed"] * 1000 + run["step"])


def econ(run) -> dict:
    """The build's economy effects summed up."""
    m = {}
    for b in run["build"]:
        for k, v in (ECON.get(b["id"]) or {}).items():
            m[k] = m.get(k, 0) + v
    return m


def _price(run, base, key) -> int:
    return round(base * (1 - min(0.9, econ(run).get(key, 0))))


def tier_ok(cat, gid, floor) -> bool:
    return (cat["gifts"][gid].get("tier") or 1) <= RULES["tiers"][min(floor, len(RULES["tiers"]) - 1)]


def recipes_open(run, cat) -> list[dict]:
    """Recipes with at least one ingredient owned (not the fused gift itself): [{"id", "of", "have"}]."""
    own = owned(run)
    out = []
    for r in cat["recipes"]:
        if r["id"] in own:
            continue
        have = [g for g in r["of"] if g in own]
        if have:
            out.append(dict(r, have=have))
    return out


def new_run(cat, seed, boss_st=False) -> dict:
    """boss_st: bosses deal their pack keyword's status (boss_mods; a switch on the start screen, off by default)."""
    return {"v": 2, "seed": seed, "bossSt": bool(boss_st), "step": 0, "phase": "id", "floor": 0, "cost": RULES["cost_start"], "build": [], "id": None,
            "lv": 1, "offer": list(KITS), "shelf": [], "locked": False, "pack": None, "boss": None, "seen": [], "log": [], "fights": []}


def pick_id(run, cat, cid, kw="") -> dict:
    run["id"] = cid
    rnd = _rnd(run)
    pool = [g for g in cat["gifts"] if (cat["gifts"][g].get("tier") or 1) == 1 and g not in ECON and (cat["gifts"][g].get("kw") or "") == kw]
    if pool:
        run["build"].append({"id": rnd.choice(pool), "level": 1})
    return open_shop(run, cat)


def open_shop(run, cat, kw=None, keep=None) -> dict:
    """A shelf: shop_size gifts of the floor's tiers (from the last pack's pool, else any; one of a started recipe's
    missing ingredients when there is one); a locked shelf stays (minus what was bought)."""
    own = owned(run)
    if keep is None and run.get("locked") and run.get("shelf"):
        run["shelf"] = [g for g in run["shelf"] if g not in own]
        run["phase"] = "shop"
        return run
    rnd = _rnd(run)
    f = run["floor"]
    pool = run["pack"]["pool"] if run.get("pack") else list(cat["gifts"])
    ids = [g for g in pool if g in cat["gifts"] and g not in own and tier_ok(cat, g, f)]
    if len(ids) < RULES["shop_size"]:
        ids = [g for g in cat["gifts"] if g not in own and tier_ok(cat, g, f)]
    if kw is not None:
        ids = [g for g in ids if (cat["gifts"][g].get("kw") or "") == kw] or ids
    shelf = []
    want = [g for r in recipes_open(run, cat) for g in r["of"] if g not in own and g in cat["gifts"]]
    if want and kw is None:
        shelf.append(rnd.choice(want))
    rnd.shuffle(ids)
    names = {cat["gifts"][g]["name"] for g in shelf} | {cat["gifts"][g]["name"] for g in own if g in cat["gifts"]}
    for g in ids:  # (one of each name: some gifts are in the data twice)
        if len(shelf) >= RULES["shop_size"]:
            break
        if cat["gifts"][g]["name"] not in names:
            names.add(cat["gifts"][g]["name"])
            shelf.append(g)
    run["shelf"] = shelf
    run["phase"] = "shop"
    return run


def buy(run, cat, gid) -> dict:
    p = _price(run, cat["gifts"][gid]["price"], "buy_off")
    if gid not in run["shelf"] or gid in owned(run):
        raise ValueError("not on the shelf")
    if len(run["build"]) >= slots(run):
        raise ValueError(f"all {slots(run)} gift slots are full — sell a gift first")
    if run["cost"] < p:
        raise ValueError("not enough Cost")
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
    if not b or b["level"] >= 3 or gid in ECON:
        raise ValueError("can't be enhanced")
    c = _price(run, RULES["enhance"][b["level"] - 1], "enh_off")
    if run["cost"] < c:
        raise ValueError("not enough Cost")
    run["cost"] -= c
    b["level"] += 1
    if _rnd(run).random() < econ(run).get("enh_back", 0):
        run["cost"] += c
        run["log"].append("enhance paid back")
    return run


def refresh(run, cat, kw=None) -> dict:
    c = _price(run, RULES["kw_refresh"] if kw is not None else RULES["refresh"], "ref_off")
    if run["cost"] < c:
        raise ValueError("not enough Cost")
    run["cost"] -= c
    open_shop(run, cat, kw, keep=True)
    if _rnd(run).random() < econ(run).get("ref_back", 0):
        run["cost"] += c
        run["log"].append("refresh paid back")
    return run


def fuse(run, cat, rid) -> dict:
    """All the ingredients of recipe rid owned: they become the fused gift, at ++."""
    r = next((x for x in cat["recipes"] if x["id"] == rid), None)
    own = owned(run)
    if not r or not all(g in own for g in r["of"]) or rid in own:
        raise ValueError("not all of its ingredients are here")
    run["build"] = [b for b in run["build"] if b["id"] not in r["of"]] + [{"id": rid, "level": 3, "fused": True}]
    return run


def level_up(run, cat) -> dict:
    lv = run.get("lv", 1)
    k = KITS.get(run["id"]) or {}
    if lv >= 3 or (lv + 1) not in (k.get("levels") or {}):
        raise ValueError("nothing to unlock at the next level yet")
    c = RULES["level_price"][lv - 1]
    if run["cost"] < c:
        raise ValueError("not enough Cost")
    run["cost"] -= c
    run["lv"] = lv + 1
    return run


def pack_kw(cat, p) -> str:
    """A pack's keyword: the one most of its pool's gifts have (economy and general gifts aside)."""
    n = {}
    for g in p["pool"]:
        x = cat["gifts"].get(g)
        if x and g not in ECON and x.get("kw"):
            n[x["kw"]] = n.get(x["kw"], 0) + 1
    return max(n, key=n.get) if n else ""


def leave_shop(run, cat, fightable=lambda b: True) -> dict:
    """3 packs for the next floor, each with its keyword, its bosses (those that can fight; the one fought is drawn from
    them) and the one gift it pays out, shown before the pick; the last floor: packs of the final bosses."""
    rnd = _rnd(run)
    f = run["floor"]
    last = f >= RULES["floors"] - 1
    if last:
        cand = [(p, b) for b in FINAL_BOSSES for p in cat["packs"] if b in p["bosses"]]
        seen_b, pairs = set(), []
        for p, b in cand:
            if b not in seen_b and fightable(b):
                seen_b.add(b)
                pairs.append((p, b, [b]))
        rnd.shuffle(pairs)
        pairs = pairs[:RULES["offers"]]
    else:
        left = [p for p in cat["packs"] if p["id"] not in run["seen"]] or cat["packs"]
        rnd.shuffle(left)
        left.sort(key=lambda p: bool(p.get("hard")))  # (not all three Hard: the easy ones first, then shuffled again below)
        left = left[:1] + sorted(left[1:], key=lambda p: rnd.random())
        pairs = []
        for p in left:
            bs = [b for b in p["bosses"] if b not in FINAL_BOSSES and fightable(b)]
            if bs:
                pairs.append((p, rnd.choice(bs), bs))
            if len(pairs) >= RULES["offers"]:
                break
    own = owned(run)
    offer = []
    for p, b, bs in pairs:
        kw = pack_kw(cat, p)
        top = RULES["tiers"][min(f + 1, len(RULES["tiers"]) - 1)] if not last else 4
        pool, names = [], set()
        for g in p["pool"]:  # (one of each name: some gifts are in the data twice)
            x = cat["gifts"].get(g)
            if x and g not in own and (x.get("tier") or 1) <= top and x["name"] not in names:
                names.add(x["name"])
                pool.append(g)
        mine = [g for g in pool if (cat["gifts"][g].get("kw") or "") == kw]
        hi = [g for g in mine if (cat["gifts"][g].get("tier") or 1) >= top - 1] or mine or pool
        reward = [rnd.choice(hi)] if hi else []
        hard = bool(p.get("hard"))
        offer.append({"pack": p["id"], "boss": b, "bosses": bs, "kw": kw, "bossSt": M.mods_text(boss_mods(kw)) if run.get("bossSt") else [], "reward": reward, "hard": hard, "final": last,
                      "hpMax": boss_hp(f, hard), "power": boss_power(f, hard),
                      "cost": RULES["cost_boss"] + RULES["cost_floor"] * f + (RULES["hard"]["cost"] if hard else 0)})
    run["offer"] = offer
    run["phase"] = "pack"
    return run


def pick_pack(run, cat, k) -> dict:
    o = run["offer"][k]
    run.update(pack=next(p for p in cat["packs"] if p["id"] == o["pack"]), boss=o["boss"], at=o, phase="boss")
    run["seen"].append(o["pack"])
    return run


def fight_done(run, cat, fight) -> dict:
    """Lost → the end; won → interest on what is held, the boss's Cost, economy gifts, one more gift slot, the reward."""
    o = run["at"]
    run["log"].append(f"floor {run['floor'] + 1}: {run['boss']} — {'won' if fight['winner'] == 0 else 'lost'}")
    if fight["winner"] != 0:
        run.update(phase="end", won=False)
        return run
    per, step, top = RULES["interest"]
    got = {"interest": min(top, per * (run["cost"] // step)), "boss": o["cost"]}
    e = econ(run)
    if e.get("income"):
        got["gifts"] = e["income"]
    urns = [b for b in run["build"] if (ECON.get(b["id"]) or {}).get("urn")]
    if urns:
        got["urn"] = sum(ECON[b["id"]]["urn"] for b in urns)
        run["build"] = [b for b in run["build"] if b not in urns]
    run["cost"] += sum(got.values())
    run["income"] = got
    run["floor"] += 1
    if run["floor"] >= RULES["floors"]:
        run.update(phase="end", won=True, offer=[])
        return run
    run["offer"] = [g for g in o["reward"] if g not in owned(run)]
    if not run["offer"]:
        return open_shop(run, cat)
    run["phase"] = "reward"
    return run


def take_reward(run, cat, gid) -> dict:
    if gid is not None:
        if gid not in run["offer"]:
            raise ValueError("not one of the rewards")
        if len(run["build"]) >= slots(run):
            raise ValueError(f"all {slots(run)} gift slots are full — skip it or sell first in the shop")
        run["build"].append({"id": gid, "level": 1})
    run["offer"] = []
    return open_shop(run, cat)


# ------------------------------------------------------------------ the app's side

def app_state(svc) -> dict:
    """v1's catalog (shared) + the recipes, kit fighters' cache."""
    sid = svc.latest_snapshot_id()
    st = getattr(svc, "_versus_mirror2", None)
    if st and st["sid"] == sid:
        return st
    cat1 = M.app_state(svc)["cat"]
    gifts = {g: x for g, x in cat1["gifts"].items() if g not in NOT_GIFTS}
    rec = []
    for rid, ways in (svc.mirror_db().get("fus") or {}).items():
        rid = int(rid)
        for of in ways:
            of = [int(g) for g in of]
            if rid in gifts and all(g in gifts for g in of):
                rec.append({"id": rid, "of": of})
                break
    cat = dict(cat1, gifts=gifts, recipes=rec)
    st = {"sid": sid, "cat": cat, "fighters": {}}
    svc._versus_mirror2 = st
    return st


def _fighters(svc, cids) -> dict:
    st = app_state(svc)
    F = st["fighters"]
    for c in cids:
        if c in F:
            continue
        got = M.fighters(svc, [c], {})
        if c not in got:
            F[c] = None
            continue
        F[c] = kit_fighter(got[c], c, E._tables(svc)[0]) if c in KITS else got[c]
    return {c: F[c] for c in cids if F.get(c)}


def page_catalog(svc) -> dict:
    cat = app_state(svc)["cat"]
    gifts = {}
    for gid, g in cat["gifts"].items():
        if (g.get("tier") or 1) > 5:
            continue
        gifts[gid] = {k: g.get(k) for k in ("name", "kw", "tier", "sin", "pic", "price")}
        gifts[gid]["eff"] = [econ_text(ECON[gid])] * 3 if gid in ECON else [mods_lines(M.gift_mods(g, lv)) for lv in (1, 2, 3)]
        if gid in ECON:
            gifts[gid]["econ"] = True
    db = {x["id"]: x for x in svc.unit_db()["ids"]}
    kits = []
    for cid, k in KITS.items():
        u = db.get(cid) or {}
        f = _fighters(svc, [cid]).get(cid)
        kits.append({"id": cid, "hp": f["hp"] if f else None, "kw": (u.get("statuses") or [""])[0], "defense": k["defense"],
                     "words": k["words"], "rules": k["rules"], "levels": {str(n): t for n, t in k["levels"].items()}})
    return {"gifts": gifts, "recipes": cat["recipes"], "kits": kits, "tremorSound": M.TREMOR_SOUND,
            "packs": [{k: p[k] for k in ("id", "name", "pic", "hard", "bosses", "bossNames", "pool")} for p in cat["packs"]],
            "rules": {k: RULES[k] for k in ("floors", "cost_start", "refresh", "kw_refresh", "enhance", "level_price", "interest", "slots", "tiers")},
            "kitRules": KIT_RULES, "kwName": {k: v for k, v in M.KW_NAME.items() if k not in M.ATK_OF},
            "status": [{"k": s, "name": M.ST_NAME[s], "kw": M.ST_KW[s], "help": M.ST_HELP[s]} for s in M.ST_NAME]}


def fight_of(svc, run) -> dict:
    """The boss fight of run's floor (also what viewer.versus_job plays for a v2 run in the Live window)."""
    st = app_state(svc)
    F = _fighters(svc, [run["id"], run["boss"]])
    if run["id"] not in F or run["boss"] not in F:
        raise ValueError("this fighter can't fight")
    return boss_fight(F[run["id"]], F[run["boss"]], run["build"], st["cat"]["gifts"], run["floor"], bool((run.get("at") or {}).get("hard")),
                      run["seed"] * 31 + run["floor"], run.get("lv", 1), ((run.get("at") or {}).get("kw") or "") if run.get("bossSt") else "")


def fight_summary(fight) -> dict:
    out = M.fight_summary(fight)
    out["kit"] = fight.get("kit") or {}
    return out


def act(svc, run, what, arg=None) -> dict:
    """One page action on its run: new, id, buy / sell / enhance (gift id), refresh (keyword or None), lock, fuse (recipe
    id), level, leave, pack (offer index), fight, reward (gift id or None)."""
    st = app_state(svc)
    cat = st["cat"]
    out = {}
    if run is not None and run.get("v") != 2:
        raise ValueError("an old run — start a new one")
    if what == "new":
        a = arg if isinstance(arg, dict) else {}
        run = new_run(cat, int(a["seed"]) if a.get("seed") is not None else random.randrange(1, 10 ** 9), bool(a.get("bossSt")))
    elif what == "id":
        if run["phase"] != "id" or arg not in KITS:
            raise ValueError("not one of the characters")
        x = next((i for i in svc.unit_db()["ids"] if i["id"] == arg), {})
        run["kw"] = (x.get("statuses") or [""])[0]
        if arg not in _fighters(svc, [arg]):
            raise ValueError("this character can't fight with this game version")
        pick_id(run, cat, arg, run["kw"])
    elif what in ("buy", "sell", "enhance"):
        if run["phase"] != "shop":
            raise ValueError("not in a shop")
        {"buy": buy, "sell": sell, "enhance": enhance}[what](run, cat, int(arg))
    elif what == "refresh":
        refresh(run, cat, arg)
    elif what == "lock":
        run["locked"] = not run.get("locked")
    elif what == "fuse":
        fuse(run, cat, int(arg))
    elif what == "level":
        level_up(run, cat)
    elif what == "leave":
        leave_shop(run, cat, lambda b: b in _fighters(svc, [b]))
        from .viewer import fighter_hud
        for o in run["offer"]:
            o["name"] = fighter_hud(svc, o["boss"])["name"]
            o["names"] = [fighter_hud(svc, b)["name"] for b in o["bosses"]]
    elif what == "pack":
        if run["phase"] != "pack" or not isinstance(arg, int) or not 0 <= arg < len(run["offer"]):
            raise ValueError("not one of the offered packs")
        pick_pack(run, cat, arg)
    elif what == "fight":
        if run["phase"] != "boss":
            raise ValueError("no boss to fight now")
        f = fight_of(svc, run)
        out["fight"] = dict(fight_summary(f), floor=run["floor"], boss=run["boss"], pack=run["pack"]["id"])
        fight_done(run, cat, f)
        out["fight"]["income"] = run.get("income") if f["winner"] == 0 else None
        run["fights"].append({k: out["fight"][k] for k in ("floor", "boss", "pack", "winner", "hp", "hpMax", "seconds", "clashes", "side", "kit")})
    elif what == "reward":
        if run["phase"] != "reward":
            raise ValueError("no reward to take now")
        take_reward(run, cat, int(arg) if arg is not None else None)
    else:
        raise ValueError(f"unknown action {what}")
    if run.get("id"):
        m = build_mods(run["build"], cat["gifts"])
        f = _fighters(svc, [run["id"]]).get(run["id"])
        hp = round((f["hp"] if f else 200) * (1 + m["hp"]))
        run.update(hpMax=hp, shield=round(hp * min(1.0, m["shield"])), buildText=mods_lines(m) + econ_text(econ(run)),
                   slots=slots(run), recipes=recipes_open(run, cat), econ=econ(run))
    out["run"] = run
    return out


def kit_icon(svc, key: str) -> str:
    """A KIT_ST status's icon as a PNG file for the player (the game's buff sprite, kept in the UI cache), "" if none."""
    import io
    import os
    from .extract import extract
    path = os.path.join(svc.ui_cache_dir(), f"kit_{key}.png")
    if os.path.isfile(path):
        return path
    try:
        from PIL import Image
        rows = svc.lookup_container(f"Assets/Resources_moved/Buf/{KIT_ST[key]}.png")
        img = None
        for r in rows:
            if r["type"] == "Texture2D" and r.get("h") and svc.store.thumb_path(r["h"]):
                img = Image.open(svc.store.thumb_path(r["h"]))
                break
        if img is None:
            sp = next((r for r in rows if r["type"] == "Sprite"), None)
            bf = svc.object_file(sp["bundle"]) if sp else None
            if not bf:
                return ""
            img = Image.open(io.BytesIO(extract(bf, int(sp["pid"]))[0]))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        img.convert("RGBA").save(path, "PNG")
        return path
    except Exception:
        return ""
