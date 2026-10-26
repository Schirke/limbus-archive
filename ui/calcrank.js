// More → Damage calc → Ranking: every Identity alone against one dummy for 20 turns, by the calculator's own formula and text reading.
// Target: Burn / Bleed / Tremor / Rupture / Sinking count as 99 / 99 for conditions; their damage comes from what the Identity inflicts itself.
// Own statuses start at 0 and grow by the kit's texts (clashes won, coins all Heads, SP at max, no kills, full HP).
const DR_TURNS = 20, DR_ELEM = new Set(["Combustion", "Laceration", "Vibration", "Burst", "Sinking"]), DR_DECK = [1, 1, 2, 1, 2, 3], DR_FOE_SPEED = 4;
const dr = { hit: 1, team: 0, rows: null, busy: null, sort: "tot", sin: "", rk: "", q: "" };

// ---- texts as a dummy fight reads them: clashes are won, "first time in the Encounter" lines happen on turn 1
// with a team (tc = its groups' sizes): conditions on allies of its group are met, "# of [group] allies" become numbers
function drPre(l, tc) {
  let t = dcaPlain(l), first = false;
  t = t.replace(/^\[(?:WinDuel|OnWinDuel)\]\s*/i, "").replace(/^(?:On Clash Win|Clash Win)\s*[:,]\s*/i, "");
  if (tc) t = drTeamText(t, tc);
  const enc = /^(?:Upon entering (?:the |an )?Encounter(?: for the first time)?|Encounter Start|At the start of (?:the |an )?Encounter|Always Active)\s*[:,]?\s*/i.exec(t);
  if (enc) { t = "Combat Start: " + t.slice(enc[0].length); first = true; }
  const beg = /^Begin (?:the )?encounters? with (\d+)(?: of each of)? (\[\w+\])/i.exec(t);
  if (beg) { t = `Combat Start: Gain ${beg[1]} ${beg[2]}`; first = true; }
  t = t.replace(/\bIf this unit's SP is at max,\s*/i, "").replace(/^On Base Attack Skill Use\s*[:,]\s*/i, "On Use: ");
  if (/\bat every Turn Start\.?$/i.test(t)) t = "Turn Start: " + t.replace(/\s*at every Turn Start\.?$/i, "");
  return { t, first };
}
// the group a phrase names ("The Ring-faction", "Kurokumo Clan", "[DawnTeam]") → its size in this team: { field, all }
function drGroupN(ph, tc) {
  const k = drKey(ph.replace(/\[(\w+)\](?:\[TabExplain\])?/g, (_, w) => dcaPlain(dcaG(w).name ? langEn(dcaG(w).name) : w)));
  const g = tc.find((q) => q.key && (k.includes(q.key) || q.key.includes(k)));
  return g || null;
}
const drKey = (s) => String(s).toLowerCase().replace(/[-‐](?:faction|family)\b/g, "").replace(/\b(?:the|allied|ally|allies|identity|identities|units?|other)\b/g, "").replace(/[^a-z0-9]+/g, " ").trim();
function drTeamText(t, tc) {
  // "If X is on the field (alongside this unit), activate the following:" / "When there are 2+ allied X Identities on the field, including this unit,"
  t = t.replace(/^(?:If|When)\s+(?:any of\s+)?.{2,120}?\s+(?:is|are)\s+on the field(?:\s+alongside this unit)?(?:,\s*including this unit)?\s*[,:]?\s*(?:activate the following(?: effects)?\s*:?)?\s*/i, "")
    .replace(/^When there are \d+\+ .{2,80}? on the field(?:, including this unit)?,\s*/i, "")
    .replace(/^If \d+ or more surviving units in the team(?:, including this unit,)? are .{2,60}?,\s*/i, "")
    .replace(/\s*when both units are on the field/i, "");
  // "(# of The Ring allies on the field x 2)" → a number
  t = t.replace(/\(#\s+of\s+(.{2,60}?)\s+on the field\s*x\s*(\d+)\)/gi, (m, g, n) => { const q = drGroupN(g, tc); return q ? String(q.field * +n) : m; });
  // "gain [X] for every Blade Lineage Identity on the field excluding this unit (max 3)", "gain 1 [X] for every Heishou Pack Identity in the Team"
  t = t.replace(/\b(gain|gains)\s+(\d+\s+)?(\[\w+\](?:\s+(?:Count|Potency))?)\s+for every\s+(\d+\s+)?(.{2,60}?)\s+(?:on the field|in the (?:Team|Loadout|Party))([^.(]*?)(?:\s*\(max (\d+)\))?(?=[.;]|$)/gi, (m, v, n, kw, every, g, rest, mx) => {
    const q = drGroupN(g, tc); if (!q) return m;
    let c = /in the (?:Team|Loadout|Party)/i.test(m) ? q.all : q.field;
    if (/excluding this unit/i.test(rest)) c -= 1;
    c = Math.floor(c / +(every || 1)) * +(n || 1); if (mx) c = Math.min(+mx, c);
    return `${v} ${c} ${kw}`;
  });
  t = t.replace(/\b(gain|gains)\s+(\[\w+\])\s+equal to the number of\s+(.{2,60}?)\s+on the field/gi, (m, v, kw, g) => { const q = drGroupN(g, tc); return q ? `${v} ${q.field} ${kw}` : m; });
  return t;
}
const DR_EV = new Map();
function drEvSkill(sk, up) {
  const key = `${sk.id}.${up}`;
  if (DR_EV.has(key)) return DR_EV.get(key);
  const u0 = cqAt(sk, up), out = [];
  if (u0) {
    const u = dcaEnU(sk, u0), ctx = {}, lines = (txt, coin, c2) => String(txt || "").split("\n").flatMap((l) => dcaOwnLine(drPre(l).t, c2, coin, false));
    out.push(...dcaInstead(lines(u.desc, null, ctx)));
    (u.coindescs || []).forEach((cd, i) => { const c2 = {}; out.push(...dcaInstead(cd.flatMap((d) => lines(d, i, c2)))); });
  }
  DR_EV.set(key, out);
  return out;
}
const drPasTexts = (x, up) => (x.passives || []).map((p0) => { let p = p0; while (p && (p.uptie || 0) > up) p = p.prev; return p && p.kind !== "support" ? [dcaEn("ps", p.id, p.desc), dcaPlain(p.name)] : null; }).filter(Boolean);
function drEvPas(x, up, tc) {
  const key = `p${x.id}.${up}.${tc ? tc.map((q) => `${q.key}${q.field}`).join() : ""}`;
  if (DR_EV.has(key)) return DR_EV.get(key);
  const out = [];
  for (const [txt, from] of drPasTexts(x, up)) {
    const ctx = {};
    let dead = false;
    for (const l of String(txt || "").split("\n")) {
      const pl = dcaNames(dcaPlain(l));
      if (drDeathHead.test(pl)) { dead = true; continue; }  // (death lines and their bullets: drDeaths)
      if (dead && /^[-•·]/.test(pl)) continue;
      dead = false;
      const { t, first } = drPre(l, tc);
      out.push(...dcaInstead(dcaOwnLine(t, ctx, null, true)).map((e) => ({ ...e, from, first: first && e.at === "start" })));
    }
  }
  DR_EV.set(key, out);
  return out;
}
// a passive line as events that happen once (a death, a kit script): "Gain 1 [X]", "gain 1 [Y] next turn"
const drOnce = (t) => dcaOwnLine(`Combat Start: ${dcaPlain(t).replace(/^[-•·]\s*/, "").replace(/\s*for this Encounter\b/i, "")}`, {}, null, true);

// ---- the team: for every other Sinner an Identity of its group (the largest group its texts name)
function drTeam(x) {
  if (x._drTeam) return x._drTeam;
  const facs = mdFacs(x).map((f) => ({ name: f, key: drKey(f) })).filter((f) => f.key && !/^(limbus company|lcb)$/.test(f.key));
  const own = drOwnText(x).toLowerCase();
  const tc = facs.map((f) => {
    const sinners = new Set(UNITS.ids.filter((y) => y.sinner !== x.sinner && mdFacs(y).some((g) => drKey(g) === f.key)).map((y) => y.sinner));
    return { ...f, others: sinners.size, all: Math.min(12, sinners.size + 1), field: Math.min(6, sinners.size + 1), named: own.includes(f.key) };
  }).filter((f) => f.others > 0);
  const main = tc.filter((f) => f.named).sort((a, b) => b.others - a.others)[0] || null;
  return (x._drTeam = { tc, main });
}
const drOwnText = (x) => dcaNames(dcaPlain([...(x.passives || []).map((p) => dcaEn("ps", p.id, p.desc)), ...x.skills.flatMap((q) => Object.values(q.up).map((v) => dcaEnU(q, v).desc))].join("\n")));
// statuses other Identities of the same group give this one ("[DawnTeam] Fixer Sinclair gains [DawnFaust]", "apply [X] to all other Blade Lineage allies")
function drTeamOf(x) {
  const own = drOwnText(x), { tc, main } = drTeam(x);
  const groups = new Set((x.traitKw || []).map((k) => dcaPlain(k.name)).filter(Boolean));
  const sinner = DCA_SIN[x.sinner - 1] || "", gives = {}, mates = [], each = [], conv = [];
  for (const y of UNITS.ids) {
    if (y.id === x.id || y.sinner === x.sinner) continue;
    const pt = (y.passives || []).filter((p) => p.kind !== "support").map((p) => dcaNames(dcaPlain(dcaEn("ps", p.id, p.desc) || ""))).join("\n");
    let mate = false;
    for (const m of pt.matchAll(/\[(\w+)\](?:\[TabExplain\])?\s+([\w.'’ -]{2,40}?)\s+gains?\s+(?:(\d+)\s+)?\[(\w+)\]/g)) {
      if (!new RegExp(`\\b${sinner.split(" ")[0]}\\b`, "i").test(m[2]) || !(own.includes(`[${m[1]}]`) || groups.has(dcaPlain(dcaG(m[1]).name)))) continue;  // (its group: in its own texts or its traits)
      gives[m[4]] = Math.max(gives[m[4]] || 0, +(m[3] || 1));
      mate = true;
    }
    // "Combat Start: Apply [X] buff to all other Blade Lineage allies": every turn, if this one is in that group
    if (main && mdFacs(y).some((g) => drKey(g) === main.key)) for (const l of pt.split(/(?<=[.])\s+|\n/)) {
      const m = /^(?:(Combat Start|Turn Start)\s*:\s*)?Apply\s+(?:(\d+)\s+)?\[(\w+)\](?:\s+buff)?\s+to all (?:other\s+)?(.{2,60}?)\s+allies\b/i.exec(l);
      if (!m || drKey(m[4]) !== main.key || !dcaG(m[3]).st) continue;
      if (m[1]) each.push([m[3], +(m[2] || 1)]); else gives[m[3]] = Math.max(gives[m[3]] || 0, +(m[2] || 1));
      mate = true;
    }
    // "Turn Start: If Dawn Office Fixer Faust is defeated, convert [DawnFaust] on Dawn Office Fixer Sinclair into [DawnFaustDying]"
    for (const m of pt.matchAll(/is defeated, convert \[(\w+)\] on (.{2,80}?) into \[(\w+)\]/g)) if (m[1] in gives && new RegExp(`\\b${sinner.split(" ")[0]}\\b`, "i").test(m[2])) conv.push([y.id, m[1], m[3]]);
    if (mate) mates.push(y);
  }
  return { gives, each, mates, conv };
}

// ---- allies falling: who falls when, what this one gains on each death, extra Skill Slots
// a kit the texts can't tell (Vlad's numbers): turns a follow-up plays, the turn the form starts ([alone, team, falling]), allies falling a turn,
// on(t) = its other state this turn, st = states set then, deck = Skills (name or label) by tier, card = the turn's one Skill, idle = no attack, sp = counted at each SP
const DR_KIT = {
  // Outis: the sword's seals at turns 1, 3, 5 → Lævateinn with 10 Vengeance Tattoos (from Resentment she gains when hit; the calculator's preset)
  11115: { fu: { "time to unpack!": [1, 3, 5] }, form: 6, st: (t) => (t >= 6 ? { s_ReinforcedTattooSpiderOutis: 10, s_MiddleFatherSwordOneOutis: 0 } : {}) },
  10415: { kills: [1, 2, 2, 2, 2, 2], selfKill: 1 },  // Ryōshū kills her House of Spiders allies herself with a Defense Skill: 1 on turn 1, then 2 a turn
  10215: { form: [7, 2, 2] },  // Faust: Corpus Ingredient spent by S3 → Flow State (with The Ring allies, S3 on turn 1)
  11016: { form: 4 },  // Le Rouge Sinclair: Noble Dignity
  11009: { kills: [2], on: (t) => t >= 2, st: () => ({ g_cwheninavolatileegostate: 1 }), deck: () => ({ 3: "blazing strike" }) },  // Dawn Sinclair: Waxen Pinion after a won Clash; Faust and Gregor fall on turn 1
  10314: { on: (t) => t >= 2, st: () => ({ s_UnlockBuff_Base: 1 }), deck: () => ({ 1: "Skill 1.1", 2: "Skill 2.1", 3: "Skill 3.1" }) },  // Index Don: Procuration on turn 2
  // Shi Faust: 4 turns of Defense to max Target Aim, then "Bow's Glimmer" in place of Skill 3
  10213: { cyc: 1, idle: (t) => t % 5 > 0, on: (t) => t % 5 === 0, st: (t, on) => (on ? { s_AimForTheGoal: 4, s_SnipingArrowMode: 1 } : {}), card: () => "bow's glimmer", pas: ["Base Power +4", "Coin Power +4", "Deal +44% damage"] },
  // Big Rodion: Eye of Precognition 4 turns, then "Disposal" and 3 turns with the Overheat eye, again
  10916: { cyc: 1, on: (t) => (t - 1) % 7 >= 4, st: (t, on) => (on ? { s_FutureEyeOffRodion: 1, s_FutureEyeOnRodion: 0 } : { s_FutureEyeOnRodion: 30 - 8 * ((t - 1) % 7) }), card: (t) => ((t - 1) % 7 === 4 ? "disposal" : null) },
  // Middle Heathcliff: a Vengeance Tattoo an Envy Resonance, 15 of them every 4 turns → "COMPLETE AND TOTAL EXTERMINATION!!"
  10715: { cyc: 1, on: (t) => t % 4 === 0, st: (t) => ({ s_MiddleFingerTattooID: Math.min(20, 4 * ((t - 1) % 4 + 1)) }), card: (t) => (t % 4 === 0 ? "complete and total extermination!!" : null) },
  // Skills by SP's sign: counted at 45 and at -40 SP
  10913: { sp: [45, -40], st: (t, on, sp) => ({ s_BlessingAlly: +(sp >= 0), s_DespairAlly: +(sp < 0), g_cwhenindespairallystate: +(sp < 0) }), deck: (t, sp) => (sp < 0 ? { 1: "Skill 1.1", 2: "Skill 2.1", 3: "Skill 3.1" } : {}) },
  10312: { sp: [45, -40], st: (t, on, sp) => ({ s_MagicalGirlAppear: +(sp >= 0), s_NoVillain: +(sp < 0) }), deck: (t, sp) => (sp < 0 ? { 1: "Skill 1.1", 2: "Skill 2.1", 3: "Skill 3.1" } : {}) },
  // enhanced Skills (Vlad, 26.10): every S3, from a turn, or on the turns its counter fills
  10114: { deck: () => ({ 3: "Skill 3.1" }) },  // Heishou Wu Yi Sang: 5 Breakthrough by every S3
  10116: { deck: () => ({ 3: "Skill 3.1" }), st: (t) => (drS3(t) ? { s_Charge_c: 15 } : {}) },  // Dimension Rip Yi Sang: 15 Charge Count
  10412: { deck: () => ({ 3: "Skill 3.1" }), st: (t) => (drS3(t) ? { t_ContemptRyoshu: 1 } : {}) },  // Contempt, Awe Ryōshū: 7 Gaze in 2 turns
  10915: { deck: () => ({ 3: "Skill 3.1" }), st: (t, on, sp, m) => (drS3(t) || (m && t >= 2) ? { g_neg: 6 } : {}) },  // Fauvism Hong Lu: 6 negative types after S2
  11213: { deck: () => ({ 3: "Skill 3.1" }) },  // Night Awls Gregor
  10716: { on: (t) => t >= 3, deck: () => ({ 3: "Skill 3.1" }), st: (t, on) => (on ? { t_DuelEdgeAlly: 5 } : {}) },  // Big Apprentice Heathcliff: 5 Duel Edge by turn 3
  11215: { on: (t) => t >= 4, deck: () => ({ 3: "Skill 3.1" }), st: (t, on) => (on ? { s_Charge_p: 3 } : {}) },  // RAND Gregor: 3 Charge Potency by turn 4, kept
  10115: { cyc: 1, card: (t) => (drAt(t, 5, 4) ? "Skill 3.1" : null) },  // Index Nursefather Yi Sang: Furioso-Replica on turn 5, then every 4
  // Crimson Moth Faust: A.B.S Max Attunement kills her, so S3 is held (S2 instead) and the enhanced one goes on the last turn
  10211: { note: 1, deck: () => ({ 3: "Skill 2" }), card: (t) => (t === DR_TURNS ? "Skill 3.1" : null), st: (t) => (t === DR_TURNS ? { s_Combustion_p: 30, g_mhp: 90 } : {}) },  // (her own Burn: 90% HP lost by then)
  // Heishou Mao Faust: alone every other S3; with the team from turn 3 S3 every turn, the enhanced one every other turn
  // (with the Heishou team she is at 10 Speed: its Haste, her own S2 isn't played)
  10212: { cyc: 1, card: (t, m) => (m ? (t >= 3 ? (drAt(t, 3, 2) ? "Skill 3.1" : "Skill 3") : null) : t === 12 ? "Skill 3.1" : null), st: (t, on, sp, m) => (m ? { g_speed: 10, g_spd: 10 - DR_FOE_SPEED } : {}), drop: (m) => (m ? ["Burst"] : []) },  // (Rupture stacks fall in a team fight: only what each turn's Skill inflicts)
  10310: { cyc: 1, card: (t, m) => (drAt(t, m ? 3 : 5, m ? 3 : 5) ? "Skill 3.1" : null), st: (t, on, sp, m) => (drAt(t, m ? 3 : 5, m ? 3 : 5) ? { s_BloodArmorPersonalityFirst: 10 } : {}) },  // La Manchaland Manager Don: alone every 5 turns, with the team every 3
  10410: { cyc: 1, card: (t) => (drAt(t, 4, 4) ? "Skill 3.1" : null), st: (t) => (drAt(t, 4, 4) ? { s_RedEyeFirst: 15, s_PenanceFirst: 15 } : {}) },  // Red Eyes & Penance Ryōshū: 15 + 15 by turn 4, again every 4
  10416: { cyc: 1, card: (t) => (drAt(t, 4, 4) ? "Skill 3.1" : null), st: (t) => (drAt(t, 4, 4) ? { s_RealisationAlly: 60 } : {}) },  // Le Noir Ryōshū: 60 Realisation by turn 4, again every 4
  10513: { cyc: 1, card: (t, m) => (drAt(t, m ? 3 : 4, 3) ? "Skill 3.1" : null) },  // La Manchaland Prince Meursault: 5 Blood Armor on turn 4 (3 with the team), every 3
  10714: { cyc: 1, card: (t) => (drAt(t, 3, 3) ? "Skill 3.1" : null), st: (t) => (drAt(t, 3, 3) ? { s_ChickenFightlust: 20 } : {}) },  // Heishou You Heathcliff: 20 Fightlust on turn 3, every 3
  10911: { cyc: 1, card: (t, m) => (m ? drAt(t, 3, 3) : t === 5) ? "Skill 3.1" : null },  // La Manchaland Princess Rodion: with the team every 3 from turn 3, alone once on turn 5
  11216: { cyc: 1, card: (t) => (drAt(t, 4, 4) ? "Skill 3.1" : null) },  // Dawn Gregor: 30 Stigma on turn 4, again every 4
  10711: { card: (t) => (t === 6 ? "Skill 3.1" : null) },  // Full-Stop Heathcliff: its one AL-HV round on the first S3
  10815: { fu: { "Skill 3.1": [3, 6, 9, 12, 15, 18] }, st: (t) => (drAt(t, 3, 3) ? { s_WindBladeIshmael: 15 } : {}) },  // LCCB-Hound Ishmael: Even the Balance every 3 turns
  // Thumb Capo Meursault: 12 rounds (S1 1, S2 2, S3 3), then 12 special ones: Super Coins and the enhanced S3
  10512: { cyc: 1, on: (t) => DR_CAPO[t - 1], st: (t, on) => (on ? { s_BulletPropellantSpecialAlly: 12 } : {}), deck: () => ({ 3: "Skill 3.1" }) },
  10614: { card: (t, m) => (m && t === 5 ? "Skill 3.1" : null) },  // Ring Nursefather Hong Lu: Closing Time once, turn 5 with 5 Ring allies (alone too late)
  10710: { cyc: 1, idle: (t) => t % 2 === 1, on: (t) => t % 2 === 0, st: (t, on) => (on ? { s_NightPathfinding: 1 } : {}), card: (t) => (t % 2 === 0 ? "Skill 3.1" : null) },  // Wild Hunt: Counter → mount → Lament, Mourn, and Despair
  10613: { on: (t, m) => m > 0 && t >= 3, deck: () => ({ 3: "Skill 3.1" }), st: (t, on) => (on ? { g_cifthisunitactivatedcombowithaheishou: 1 } : {}) },  // Lord of Hongyuan: with the Heishou team every S3 from turn 3
  10611: { on: (t, m) => m > 0 && t <= 4, deck: () => ({ 1: "Skill 1.1", 2: "Skill 2.1", 3: "Skill 3.1" }) },  // Full-Stop Rep Hong Lu: combos while Full-Stop Heathcliff is there
  10712: { fu: (m) => (m ? { "Skill 1.1": [2, 3, 4, 5, 6] } : {}) },  // Kurokumo Wakashu Heathcliff: Rules of the Backstreets once per ally, from turn 2
  10917: { fu: (m) => (m ? { "Skill 2.1": Array.from({ length: DR_TURNS - 1 }, (_, i) => i + 2) } : {}) },  // Le Noir Rodion: Patterning as Cutout after a Le Noir ally, from turn 2
  10315: { card: (t) => (t === 4 ? "Skill 3.1" : null), fu: (m) => (m ? { "Skill 1.1": Array.from({ length: DR_TURNS - 1 }, (_, i) => i + 2) } : {}) },  // Le Noir Don: With Each Smite on turn 4; Judgment! with Le Noir allies
};
const drAt = (t, a, k) => t >= a && (t - a) % k === 0, drS3 = (t) => DR_DECK[(t - 1) % 6] === 3;
// Thumb Capo: which turns shoot the special rounds (12 a magazine, S1 1, S2 2, S3 3)
const DR_CAPO = (() => { const out = []; let n = 12, sp = false; for (let t = 1; t <= DR_TURNS; t++) { out.push(sp); n -= DR_DECK[(t - 1) % 6]; if (n <= 0) { sp = !sp; n = 12; } } return out; })();
// "[BeforeUse] At 30 [X], activate "Y" instead", "If target has 5 [X], activate "Y" instead": the stronger Skill once its status is there
const DR_ALT = new Map();
function drAlt(sk, up) {
  const key = `${sk.id}.${up}`;
  if (!DR_ALT.has(key)) {
    const d = dcaPlain(dcaEnU(sk, cqAt(sk, up)).desc), out = [];
    for (const m of d.matchAll(/(?:At (\d+)\+? \[(\w+)\]( Count)?|If target has (\d+)\+? \[(\w+)\]( Count)?)(?: on self)?,\s*(consume all of it to )?activate "([^"]+)" instead/gi))
      out.push(m[1] ? { self: 1, n: +m[1], kw: m[2], c: !!m[3], eat: !!m[7], to: dcaBare(m[8]) } : { self: 0, n: +m[4], kw: m[5], c: !!m[6], to: dcaBare(m[8]) });
    DR_ALT.set(key, out);
  }
  return DR_ALT.get(key);
}
const drDeathHead = /^(?:Apply the following effects based on .{2,60}? ally death|In an Encounter, if another allied unit is defeated|When \d+ or more other .{2,60}? allies are defeated)\s*:\s*$/i;
function drDeaths(x, up) {
  const out = { each: [], at: [], named: [], slot: null };
  const dead = /^(?:When|Whenever|Upon|If)\s+(?:an?|another|any)?\s*(?:other\s+)?(.{0,60}?)\s*(?:ally|allied unit|allied Identity)\s+(?:is\s+)?(?:defeated|dies|is killed)\s*[,:]\s*/i;
  for (const [txt] of drPasTexts(x, up)) {
    let head = null;
    for (const raw of String(txt || "").split("\n")) {
      const l = dcaNames(dcaPlain(raw));
      const h = drDeathHead.exec(l);
      if (h) { const n = /When (\d+) or more/i.exec(l); head = { n: n ? +n[1] : 0 }; continue; }
      if (head && /^[-•]\s*/.test(l)) { const ev = drOnce(l); if (head.n) out.at.push([head.n, ev]); else out.each.push(...ev); continue; }
      if (head && /^·\s*/.test(l)) { const m = /^·\s*(.+):\s*(.+?)$/.exec(l); if (m) out.named.push(m[2]); continue; }  // (names have colons too)
      head = null;
      let m;
      if ((m = dead.exec(l))) out.each.push(...drOnce(l.slice(m[0].length)));
      else if ((m = /^Ally Death\s*:\s*/i.exec(l))) out.each.push(...drOnce(l.slice(m[0].length)));
      else if ((m = /^-?\s*If (\d+)\+ allies have been defeated in this Encounter,\s*/i.exec(l))) out.at.push([+m[1], drOnce(l.slice(m[0].length).replace(/\s*\(once per Encounter\)/i, ""))]);
      if ((m = /\+1 Skill Slot for every (\d+) .{2,60}? allies that are defeated \(max (\d+) times\)/i.exec(l))) out.slot = { every: +m[1], max: +m[2] };
    }
  }
  return out;
}
// mates' "If this unit is defeated…, Blade of the House of Spiders Ryōshū gains the following effects:" → their bullets, by mate
function drMateDeaths(x, up, mates) {
  const sinner = (DCA_SIN[x.sinner - 1] || "").split(" ")[0], out = new Map();
  for (const y of mates) {
    const pt = (y.passives || []).filter((p) => p.kind !== "support").flatMap((p) => String(dcaEn("ps", p.id, p.desc) || "").split("\n").map((l) => dcaNames(dcaPlain(l))));
    let on = false;
    for (const l of pt) {
      if (/^If this unit is defeated\b.*\bgains the following effects\s*:\s*$/i.test(l)) { on = new RegExp(`\\b${sinner}\\b`, "i").test(l); continue; }
      if (on && /^[-•]\s*/.test(l)) { if (!out.has(y.id)) out.set(y.id, []); out.get(y.id).push(l.replace(/^[-•]\s*/, "")); continue; }
      on = false;
    }
  }
  return out;
}
// ---- one Identity: 20 turns, one card a turn (S1 S1 S2 S1 S2 S3 round; more with extra Skill Slots), the form its own status says
// mode: 0 alone, 1 with its team, 2 with its team and allies falling
function drSim(x0, hit, mode, sp = null) {
  const team = mode > 0, kit = DR_KIT[x0.id] || {};
  // with a team: what the mates' statuses do is read as one more passive of this Identity (its own copy, its own caches)
  const tm = team ? drTeamOf(x0) : null, T = team ? drTeam(x0) : null, up0 = x0.maxUp || 4;
  // allies falling: the group's others, one a turn from turn 10 (or the kit's own pace); mates whose death changes what they give first
  const D = mode === 2 ? drDeaths(x0, up0) : null, fallers = [];
  if (D) {
    const main = T.main, pool = main ? UNITS.ids.filter((y) => y.sinner !== x0.sinner && mdFacs(y).some((g) => drKey(g) === main.key)) : [];
    const per = new Map(), pin = new Set(tm.conv.map(([id]) => id));
    tm.conv.forEach(([id]) => { const y = unitById(id); if (y && !per.has(y.sinner)) per.set(y.sinner, y); });
    pool.forEach((y) => { const p = per.get(y.sinner); if (!p || (!pin.has(p.id) && y.id > p.id)) per.set(y.sinner, y); });
    tm.mates.forEach((y) => { if (!per.has(y.sinner)) per.set(y.sinner, y); });
    fallers.push(...[...per.values()].sort((a, b) => pin.has(b.id) - pin.has(a.id)));
    while (fallers.length < 5) fallers.push(null);  // (allies outside any group)
  }
  const mateDeath = D ? drMateDeaths(x0, up0, fallers.filter(Boolean)) : new Map();
  // the damage side of what the fallen leave (Deal +10%…, Defense Level +2) is read from the start, the statuses at each death
  const fell = D ? [...D.named, ...[...mateDeath.values()].flat()].filter((l) => !/^Gain \d+ \[\w+\]\.?$/i.test(l)) : [];
  const conv = new Set(), fallen = new Set();
  const make = () => {
    const gv = tm ? Object.keys(tm.gives).map((kw) => { const c = tm.conv.find(([id, a]) => a === kw && conv.has(id)); return c ? c[2] : kw; }) : [];
    const extra = [...gv.map((kw) => [kw, dcaEn("gl", kw, dcaG(kw).desc)]), ...(fell.length ? [["fallen", fell.join("\n")]] : []), ...(kit.pas ? [["kit", kit.pas.join("\n")]] : [])]
      .map(([name, desc], i) => ({ id: `dr${x0.id}.${mode}.${conv.size}.${i}`, kind: "battle", name, desc }));
    return extra.length ? Object.assign(Object.create(x0), { id: x0.id + 900000 + mode * 100000 + conv.size * 10000, passives: [...(x0.passives || []), ...extra] }) : x0;
  };
  let x = make();
  const up = x.maxUp || 4, slots = dcSlots(x);
  dc.ego = false; dc.id = x.id; dc.up = up; dc.lv = MAX_LEVEL; dc.en = 0; dc.ev = 0; dc.dlv = null; dc.res = {}; dc.hit = hit; dc.bd = {};
  const F = dcForms(x, slots), base = F.forms[0];
  // a Skill 1-3 the kit also uses by name (an ally's follow-up) is still its deck skill
  const byLabel = {};
  slots.forEach(([l], i) => { const m = /^Skill (\d)$/.exec(l); if (m && !(m[1] in byLabel) && !F.info[i].kw) byLabel[m[1]] = i; });
  const deckSlots = new Set(F.forms.flatMap((f) => Object.values({ ...byLabel, ...f.deck })));
  const spd = x.speed[Math.min(up, x.speed.length) - 1] || [4, 4], speed = Math.round((spd[0] + spd[1]) / 2);
  const approx = new Set(), me = {}, pend = [], kept = new Set(tm ? Object.keys(tm.gives) : []);
  if (tm) for (const [kw, n] of Object.entries(tm.gives)) dcOwnKeys(kw).forEach((k) => { me[k] = n; });
  let carry = {};
  const added = [], all = { has: (k) => k !== "sp" };
  let pas = [...drEvPas(x, up, T ? T.tc : null)];
  const nameOf = (z) => dcaBare(dcaEnU(slots[z][1], cqAt(slots[z][1], up)).name), kfu = typeof kit.fu === "function" ? kit.fu(mode) : kit.fu;
  const drSlot = (n) => slots.findIndex(([l], z) => l === n || nameOf(z) === dcaBare(n));
  const killsAt = (t) => !D ? 0 : kit.kills ? kit.kills[t - 1] || 0 : t >= 10 ? 1 : 0;
  let dead = 0;
  const die = (s) => {
    const y = fallers[dead++];
    if (y) fallen.add(y.id);
    D.each.forEach((e) => dcOwnDo(me, e, s));
    D.at.forEach(([n, ev]) => { if (n === dead) ev.forEach((e) => dcOwnDo(me, e, s)); });
    const add = (txt) => { const ev = dcaOwnLine(drPre(txt, T.tc).t, {}, null, true); if (ev.some((e) => e.at !== "start")) { pas.push(...ev); added.push(...ev); } else drOnce(txt).forEach((e) => dcOwnDo(me, e, s)); };
    if (D.named[dead - 1]) add(D.named[dead - 1]);
    if (y && mateDeath.has(y.id)) mateDeath.get(y.id).forEach(add);
  };
  const turns = [];
  let formAt = 0, lastForm = 0, cardN = 0;
  for (let t = 1; t <= DR_TURNS; t++) {
    // turn start: statuses' own losses, what a mate fallen last turn gave turns into its other status, allies that fall, the passives' Combat Start lines (Encounter ones on turn 1)
    for (const kw of new Set(Object.keys(me).map((k) => k.replace(/^s_/, "").replace(/_[pc]$/, "")))) { const te = dcaTurnEnd(kw); if (te.start) dcOwnDo(me, { conds: [], kw, part: dcaG(kw).st === 2 ? "c" : "s", op: "eat", n: te.start, upTo: true }, {}); }
    const nc = tm ? tm.conv.filter(([id]) => fallen.has(id) && !conv.has(id)) : [];
    if (nc.length) {
      nc.forEach(([id, a, b]) => { conv.add(id); dcOwnKeys(a).forEach((k) => delete me[k]); kept.delete(a); kept.add(b); dcOwnKeys(b).forEach((k) => { me[k] = tm.gives[a]; }); });
      x = make(); dc.id = x.id; pas = [...drEvPas(x, up, T.tc), ...added];
    }
    const before = dead;
    for (let k = killsAt(t); k > 0 && dead < fallers.length; k--) die({});
    const on = kit.on ? kit.on(t, mode) : false, fm = Array.isArray(kit.form) ? kit.form[mode] : kit.form;
    if (fm && t >= fm) { const f = F.forms[1]; if (f && f.kw) dcOwnKeys(f.kw).forEach((k) => { me[k] = 1; }); }
    const fi = F.forms.findIndex((f, i) => i && f.kw && dcOwnKeys(f.kw).some((k) => me[k] > 0)), form = fi > 0 ? F.forms[fi] : base;
    if ((fi > 0 || (on && !kit.cyc)) && !formAt) formAt = t;
    lastForm = fi > 0 ? fi : on ? 1 : 0;
    const ov = { ...(kit.st ? kit.st(t, on, sp, mode) : {}), ...(sp != null ? { g_sp: sp, sp } : {}) };
    const deck = { ...byLabel, ...base.deck, ...form.deck };
    if (kit.deck && (on || !kit.on)) for (const [tier, n] of Object.entries(kit.deck(t, sp, mode))) { const z = drSlot(n); if (z >= 0) deck[tier] = z; }
    // her kills take one of her Skill Slots
    let cards = 1 + (D && D.slot ? Math.min(D.slot.max, Math.floor((kit.selfKill ? before : dead) / D.slot.every)) : 0);
    if (kit.selfKill && dead > before) cards -= 1;
    const gone = kit.dies && t > kit.dies, n = gone || (kit.idle && kit.idle(t, mode)) ? 0 : cards;
    let dmg = 0, fu = 0, s99 = {}, firstSlot = null;
    const kinds = [];
    for (let ci = 0; ci < Math.max(1, n); ci++) {
      const none = ci >= n;  // no attack this turn (Defense, a kill): its turn-start lines still happen
      const tier = DR_DECK[cardN % 6];
      if (!none) cardN++;
      let slot = deck[tier];
      const cn = ci === 0 && !none && kit.card && kit.card(t, mode);
      if (cn) { const z = drSlot(cn); if (z >= 0) slot = z; else approx.add("kit"); }
      if (slot == null || slot < 0) return null;
      // a stronger Skill its own status calls in ("At 30 [X], activate "Y" instead")
      if (!none) for (const a of drAlt(slots[slot][1], up)) {
        const c = carry[a.kw], v = a.self ? (a.c ? me[`s_${a.kw}_c`] : (me[`s_${a.kw}`] || 0) + (me[`s_${a.kw}_p`] || 0)) || 0 : DR_ELEM.has(a.kw) ? 99 : c ? (a.c ? c.c : c.p ?? c.n) || 0 : 0;
        const z = drSlot(a.to);
        if (v >= a.n && z >= 0) { slot = z; if (a.eat) dcOwnKeys(a.kw).forEach((k) => { me[k] = 0; }); break; }
      }
      if (firstSlot == null && !none) firstSlot = slot;
      const sk = slots[slot][1], bm = dcModelOf(x, sk);
      if (!bm) return null;
      if (!bm.m.auto && !none) approx.add("hand model");
      const u = cqAt(sk, up), o = dcbOn(bm), name = dcaBare(dcaEnU(sk, u).name);
      kinds.push(none ? (gone ? "Dead" : "Defense") : F.info[slot].kind);
      // the card's two states: conditions (status-effects at 99) and the real target (status damage)
      const st = (real) => {
        const s = {};
        for (const k of Object.keys(bm.s)) {
          let m;
          if ((m = /^t_(\w+)_(p|c)$/.exec(k))) s[k] = !real && DR_ELEM.has(m[1]) ? 99 : carry[m[1]] ? carry[m[1]][m[2]] || 0 : 0;
          else if ((m = /^t_(\w+)$/.exec(k))) s[k] = carry[m[1]] ? carry[m[1]].n ?? carry[m[1]].p ?? 0 : 0;
          else if (/^s_/.test(k)) s[k] = me[k] || 0;
          else if ((m = /^g_(\w+)$/.exec(k))) s[k] = drG(m[1], k, bm, { speed: speed + (me.s_Agility || 0) + (me.s_Agility_p || 0), team, carry, real, dead });  // (Haste adds Speed)
          else if ((m = /data-kw="(\w+)"[^]*?(Potency|Count)?(?: on (self|target))?$/.exec((bm.id.sliders.find(([q]) => q === k) || [])[1] || ""))) {
            // a hand model's slider on a status: the fight's own number
            const [, kw, pc, side] = m, part = pc ? pc[0].toLowerCase() : "", c = carry[kw];
            s[k] = side === "target" ? (!real && DR_ELEM.has(kw) ? 99 : c ? (part ? c[part] : c.n ?? c.p) || 0 : 0) : me[part ? `s_${kw}_${part}` : `s_${kw}`] || 0;
          } else s[k] = bm.s[k];
        }
        if (fi > 0) F.forms.forEach((f) => { if (f.kw) s[`s_${f.kw}`] = f === form ? 1 : 0; });
        for (const k in me) if (!(k in s)) s[k] = me[k];
        Object.assign(s, ov);
        s.__name = name;
        return dcS(u, s);
      };
      const evs = drEvSkill(sk, up);
      if (ci === 0) pas.forEach((e) => { if (e.at === "start" && (!e.first || t === 1)) dcOwnDo(me, e, st(false)); });
      if (ci === 0 && tm) tm.each.forEach(([kw, n]) => dcOwnDo(me, { conds: [], kw, part: dcaG(kw).st === 2 ? "p" : "s", op: "add", n }, {}));
      if (none) { s99 = st(false); continue; }
      evs.forEach((e) => { if (e.op === "add" && e.at === "pre") dcOwnDo(me, e, st(false)); });
      s99 = st(false);
      const sR = st(true), env = dcEnv(u), m2 = { ...bm.m, bursts: null };
      // Poise: crit chance 5% a Potency
      const pc = Math.min(1, (me.s_Breath_p || 0) * 0.05), calc = (m, s, sd) => {
        const a = dcbCalc(m, u, { ...s, g_crit: 0, stdmg: sd }, o, env), b = pc > 0 ? dcbCalc(m, u, { ...s, g_crit: 1, stdmg: sd }, o, env) : a;
        return { total: a.total * (1 - pc) + b.total * pc, c: pc >= 0.5 ? b : a };
      };
      const b99 = calc(m2, s99, 0), bR = calc(m2, sR, 0), cR = calc(bm.m, sR, 1);
      dmg += b99.total + (cR.total - bR.total);
      if (bm.m.auto) for (const [kw, b0, a] of bm.m.target(sR, o).st) {
        if (typeof b0 === "number") { if (a > 0) carry[kw] = { n: a }; else delete carry[kw]; } else if (a && a.p > 0 && a.c > 0) carry[kw] = { p: Math.min(99, a.p), c: Math.min(99, a.c) }; else delete carry[kw];  // (the game caps both at 99)
      }
      dcOwnAfter(me, [...evs, ...pas.filter((e) => e.at === "hit" || e.at === "post" || e.at === "use")], { s: s99, c: b99.c, name }, all, pend);
      // follow-ups by their text's condition (a kit script's turns instead)
      for (const z of form.fu || []) {
        if (deckSlots.has(z) || (kfu && kfu[nameOf(z)])) continue;
        const c = dcaFuCond(x, nameOf(z), up);
        if (!c.length) { approx.add("follow-up"); continue; }
        // "at 0 [X]" of a status the texts never give: not known
        if (c.some((r) => r.tests.some((q) => q.side === "self" && q.eq && !dcOwnKeys(q.kw).some((k) => k in me)))) { approx.add("follow-up"); continue; }
        const tg = { ...carry };
        DR_ELEM.forEach((k) => { tg[k] = { p: 99, c: 99 }; });
        if (!dcFuFires(c, { ...s99, ...me }, tg, name, tier)) continue;
        fu += drFu(x, slots, z, s99);
      }
    }
    if (kfu) Object.entries(kfu).forEach(([nm, at]) => { const z = drSlot(nm); if (z >= 0 && at.includes(t)) fu += drFu(x, slots, z, s99); });
    dmg += fu;
    // turn end: the target's statuses tick (Burn hits), yours lose Counts, Turn End lines, then what was gained for next turn
    let burn = 0;
    if (kit.drop) kit.drop(mode).forEach((k) => delete carry[k]);
    carry = Object.fromEntries(Object.entries(carry).flatMap(([k, v]) => {
      const e = dcaTurnEnd(k);
      if (e.dmg && v.p) burn += v.p;
      if (v.n != null) { const n = e.dec === "all" ? 0 : v.n - e.dec; return n > 0 ? [[k, { n }]] : []; }
      const c = e.dec === "all" ? 0 : v.c - e.dec;
      return c > 0 ? [[k, { p: v.p, c }]] : [];
    }));
    for (const k of Object.keys(me)) {
      const kw = k.replace(/^s_/, "").replace(/_[pc]$/, ""), e = dcaTurnEnd(kw);
      if (kept.has(kw)) continue;
      if (e.one || e.dec === "all") me[k] = 0;
      else if (e.dec && (!/_p$/.test(k))) dcOwnDo(me, { conds: [], kw, part: /_c$/.test(k) ? "c" : "s", op: "eat", n: e.dec, upTo: true }, {});
    }
    pas.forEach((e) => { if (e.at === "end") dcOwnDo(me, e, s99); });
    pend.splice(0).forEach(([e, s]) => dcOwnDo(me, e, s));
    turns.push({ t, slot: firstSlot ?? 0, kind: kinds.join(" + "), cards: n, dead, form: lastForm, dmg: Math.round(dmg + burn), fu: Math.round(fu), burn, ...(dr.debug ? { me: { ...me }, carry: JSON.parse(JSON.stringify(carry)) } : {}) });
  }
  // full power: the first 6-turn stretch within 95% of the best one
  const win = turns.map((_, i) => i + 6 <= turns.length ? turns.slice(i, i + 6).reduce((a, q) => a + q.dmg, 0) : 0), best = Math.max(...win);
  const full = win.findIndex((v) => v >= best * 0.95) + 1;
  const tot = turns.reduce((a, q) => a + q.dmg, 0);
  if (F.forms.length > 1 && !formAt) approx.add("form not reached");
  return { id: x0.id, key: sp == null ? `${x0.id}` : `${x0.id}~${sp}`, sp, tot, avg: Math.round(tot / DR_TURNS), full, formAt, forms: F.forms.length, turns, approx: [...approx],
    team: tm ? [...new Set([...tm.mates, ...fallers.filter(Boolean)].map((y) => y.id))] : [], dead };
}
// a follow-up's hit in the card's state
function drFu(x, slots, z, s99) {
  const fbm = dcModelOf(x, slots[z][1]), fu0 = cqAt(slots[z][1], dc.up);
  return fbm ? dcbCalc(fbm.m, fu0, { ...dcS(fu0, { ...fbm.s, ...s99 }), stdmg: 0 }, dcbOn(fbm), dcEnv(fu0)).total : 0;
}
// the fight's other numbers, the same for everyone
function drG(g, key, bm, c) {
  const lab = (bm.id.sliders.find(([k]) => k === key) || [])[1] || "", hi = (bm.id.sliders.find(([k]) => k === key) || [])[3] || 0;
  if (/^Allies:/.test(lab)) return c.team ? hi : 0;
  switch (g) {
    case "sp": return 45;
    case "speed": return c.speed;
    case "spd": return c.speed - DR_FOE_SPEED;
    case "neg": return Object.keys(c.carry).filter((k) => !DR_ELEM.has(k) && dcaG(k).type === "neg").length + (c.real ? Object.keys(c.carry).filter((k) => DR_ELEM.has(k)).length : DR_ELEM.size);
    case "res": case "ares": return c.team ? 4 : 1;
    case "fan": case "ally": return c.team ? hi : 0;
    case "mhpT": return 50;
    case "nodmg": return 1;
    case "clash": return 1;
    case "hit": return dr.hit;
    default: return 0;
  }
}

// ---- the page: #/calc/rank
const drTabs = (on) => `<div class="drtabs"><a href="#/calc"${on === "calc" ? ' class="on"' : ""}>Calculator</a><a href="#/calc/rank"${on === "rank" ? ' class="on"' : ""}>Ranking</a></div>`;
const DR_DONE = new Map();  // "hit.team" → rows
async function drRows() {
  const key = `${dr.hit}.${dr.team}`;
  if (DR_DONE.has(key)) return DR_DONE.get(key);
  // the calculator's own state is put back after the run
  const keep = { ...dc }, rows = [], ids = UNITS.ids.filter((x) => x.title);
  for (let i = 0; i < ids.length; i++) {
    for (const sp of (DR_KIT[ids[i].id] || {}).sp || [null]) try { const r = drSim(ids[i], dr.hit, dr.team, sp); if (r) rows.push(r); } catch (e) { console.warn("ranking", ids[i].id, e); }
    if (i % 8 === 7) {
      Object.assign(dc, keep);
      const bar = $("#drprog");
      if (!bar || !location.hash.startsWith("#/calc/rank")) return null;
      bar.style.width = `${(100 * (i + 1) / ids.length).toFixed(1)}%`;
      await new Promise((ok) => setTimeout(ok, 0));
    }
  }
  Object.assign(dc, keep);
  DR_DONE.set(key, rows);
  return rows;
}
async function drPage() {
  $("#main").innerHTML = `<div class="muted">Loading…</div>`;
  try { await units(); } catch (e) { $("#main").innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  if (!UNITS.ids.length) { $("#main").innerHTML = `<div class="empty">Take a snapshot first — the database is read from it.</div>`; return; }
  $("#main").innerHTML = `<div class="dcpage drpage">
    <div class="dctop"><h1>Damage calculator</h1>${drTabs("rank")}</div>
    <div class="drcond"><span class="drlbl">Same for everyone</span>
      <span class="drchip">Uptie 4 · Lv ${MAX_LEVEL}</span><span class="drchip">${DR_TURNS} turns, one Skill a turn: S1 S1 S2 S1 S2 S3</span>
      <span class="drchip">Dummy of the same level, all resistances ×1.0</span><span class="drchip">Burn, Bleed, Tremor, Rupture, Sinking on the target count as 99 for conditions</span>
      <span class="drchip">Own buffs start at 0</span><span class="drchip">Coins all Heads, Clashes won, SP at max</span></div>
    <div class="drbar">
      <span class="cqkind" id="drhit">${[1, 3, 5].map((n) => `<button data-hit="${n}" class="${dr.hit === n ? "on" : ""}">${n === 1 ? "1 enemy" : `${n} enemies`}</button>`).join("")}</span>
      <span class="cqkind" id="drteam">${[[0, "Alone"], [1, "With its team"], [2, "Allies fall"]].map(([n, l]) => `<button data-team="${n}" class="${dr.team === n ? "on" : ""}">${l}</button>`).join("")}</span>
      <span class="cqkind" id="drsort"><button data-sort="tot" class="${dr.sort === "tot" ? "on" : ""}">Most damage</button><button data-sort="full" class="${dr.sort === "full" ? "on" : ""}">Fastest to full power</button></span>
      <select id="drsin"><option value="">All Sinners</option>${DCA_SIN.map((n, i) => `<option value="${i + 1}"${+dr.sin === i + 1 ? " selected" : ""}>${esc(n)}</option>`).join("")}</select>
      <select id="drrk"><option value="">Any rarity</option>${[3, 2, 1].map((n) => `<option value="${n}"${+dr.rk === n ? " selected" : ""}>${"0".repeat(n)}</option>`).join("")}</select>
      <input id="drq" class="drq" placeholder="Search…" value="${esc(dr.q)}">
    </div>
    <div id="drlist"><div class="drload"><span class="muted">Counting every Identity…</span><div class="drprogw"><div id="drprog"></div></div></div></div>
    <p class="muted small drfoot">≈ = part of this kit is not read yet (hover it), the real number can be higher or lower. Not a tier list: damage on one dummy only, no allies' attacks, no E.G.O.<br>
      With its team: what allies of its group give it (Dawn Office, House of Spiders…) and conditions on allies met. Allies fall: from turn 10 one ally a turn (some kits kill their own allies sooner). Formula: the calculator's, <a href="https://github.com/BaTyANl/ElderCalc" target="_blank" rel="noopener">BaTyANl calc ↗</a><br>
      ${esc(DR_SPT)}</p></div>`;
  const re = async () => { $("#drlist").innerHTML = `<div class="drload"><span class="muted">Counting every Identity…</span><div class="drprogw"><div id="drprog"></div></div></div>`; const r = await drRows(); if (r) drDraw(r); };
  $("#drhit").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; dr.hit = +b.dataset.hit; document.querySelectorAll("#drhit button").forEach((q) => q.classList.toggle("on", q === b)); re(); };
  $("#drteam").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; dr.team = +b.dataset.team; document.querySelectorAll("#drteam button").forEach((q) => q.classList.toggle("on", q === b)); re(); };
  $("#drsort").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; dr.sort = b.dataset.sort; document.querySelectorAll("#drsort button").forEach((q) => q.classList.toggle("on", q === b)); if (dr.rows) drDraw(dr.rows); };
  $("#drsin").onchange = (e) => { dr.sin = e.target.value; if (dr.rows) drDraw(dr.rows); };
  $("#drrk").onchange = (e) => { dr.rk = e.target.value; if (dr.rows) drDraw(dr.rows); };
  $("#drq").oninput = (e) => { dr.q = e.target.value; if (dr.rows) drDraw(dr.rows); };
  $("#drlist").onclick = (e) => { const r = e.target.closest(".drrow"); if (!r || e.target.closest("a")) return; dr.open = dr.open === r.dataset.key ? "" : r.dataset.key; drDraw(dr.rows); };
  await re();
}
const DR_HELD = ["S3 held to the last turn", "Her enhanced S3 kills her, so S3 is not used until the last turn."];
const DR_SPT = "Kits whose Skills change with SP are shown twice, at 45 and at -40 SP: the real fight depends on how it is played.";
const DR_WHY = { "follow-up": "a follow-up's condition", "form not reached": "how it reaches its other form", "hand model": "this Skill's state (set by hand)" };
function drDraw(rows) {
  dr.rows = rows;
  const pos = new Map([...rows].sort((a, b) => b.tot - a.tot).map((r, i) => [r.key, i + 1]));
  const q = dr.q.trim().toLowerCase(), top = Math.max(...rows.map((r) => r.tot), 1);
  const list = rows.map((r) => ({ r, x: unitById(r.id) })).filter(({ x }) => x && (!dr.sin || x.sinner === +dr.sin) && (!dr.rk || x.rank === +dr.rk)
    && (!q || `${x.title} ${x.sinnerName} ${DCA_SIN[x.sinner - 1] || ""}`.toLowerCase().includes(q)))
    .sort((a, b) => dr.sort === "full" ? a.r.full - b.r.full || b.r.tot - a.r.tot : b.r.tot - a.r.tot);
  $("#drlist").innerHTML = list.length ? `<div class="drlist">${list.map(({ r, x }) => {
    const p = pos.get(r.key), mx = Math.max(...r.turns.map((t) => t.dmg), 1), ap = r.approx.length ? `<span class="drap" title="${esc(`Not read yet: ${r.approx.map((a) => DR_WHY[a] || a).join(", ")}`)}">≈</span>` : "";
    const bars = r.turns.map((t) => `<i class="t${DR_DECK[(t.t - 1) % 6]}${t.form ? " f" : ""}" style="height:${Math.max(4, 100 * t.dmg / mx).toFixed(0)}%" title="${esc(`Turn ${t.t} · ${t.kind}: ${t.dmg}`)}"></i>`).join("");
    const mates = r.team.length ? `<span class="drmates" title="${esc(r.team.map((id) => (unitById(id) || {}).title || id).join(", "))}">${r.team.map((id) => { const y = unitById(id); return y ? `<img src="${imgThumb(y.img.thumb)}" alt="">` : ""; }).join("")}</span>` : "";
    return `<div class="drrow${p <= 3 ? " top3" : ""}${dr.open === r.key ? " open" : ""}" data-key="${r.key}">
      <div class="drpos">#${p}</div><img class="drpic" src="${imgThumb(x.img.thumb)}" alt="" onerror="this.style.visibility='hidden'">
      <div class="drnm"><div class="drt">${esc(x.title)}</div><div class="drs"><span>${esc(x.sinnerName)}</span><span class="drrk">${"0".repeat(x.rank)}</span>${seasonTag(x.season)}${ap}${r.sp != null ? `<span class="drtag" title="${esc(DR_SPT)}">SP ${r.sp}</span>` : ""}${(DR_KIT[r.id] || {}).note ? `<span class="drtag" title="${esc(DR_HELD[1])}">${esc(DR_HELD[0])}</span>` : ""}${r.formAt ? `<span class="drtag">Form from turn ${r.formAt}</span>` : ""}${mates}</div></div>
      <div class="drbars">${bars}</div>
      <div class="drtot"><b>${r.approx.length ? "≈" : ""}${r.tot}</b><small><span>${r.avg}</span> a turn</small><small>Full power by turn <span>${r.full}</span></small><div class="drfull"><u style="width:${(100 * r.tot / top).toFixed(1)}%"></u></div></div>
      ${dr.open === r.key ? `<div class="drmore"><div class="drturns">${r.turns.map((t) => `<span><i>${t.t}</i>${esc(t.kind)}<b>${t.dmg}</b></span>`).join("")}</div>
        <a href="#/calc/${r.id}/${r.turns[0].slot}">Open in the calculator →</a></div>` : ""}
    </div>`;
  }).join("")}</div>` : `<div class="empty">Nothing found.</div>`;
}
