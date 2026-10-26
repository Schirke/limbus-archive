// More → Damage calc → Ranking: every Identity alone against one dummy for 20 turns, by the calculator's own formula and text reading.
// Target: Burn / Bleed / Tremor / Rupture / Sinking count as 99 / 99 for conditions; their damage comes from what the Identity inflicts itself.
// Own statuses start at 0 and grow by the kit's texts (clashes won, coins all Heads, SP at max, no kills, full HP).
const DR_TURNS = 20, DR_ELEM = new Set(["Combustion", "Laceration", "Vibration", "Burst", "Sinking"]), DR_DECK = [1, 1, 2, 1, 2, 3], DR_FOE_SPEED = 4;
const dr = { hit: 1, team: false, rows: null, busy: null, sort: "tot", sin: "", rk: "", q: "" };

// ---- texts as a dummy fight reads them: clashes are won, "first time in the Encounter" lines happen on turn 1
function drPre(l) {
  let t = dcaPlain(l), first = false;
  t = t.replace(/^\[(?:WinDuel|OnWinDuel)\]\s*/i, "").replace(/^(?:On Clash Win|Clash Win)\s*[:,]\s*/i, "");
  const enc = /^(?:Upon entering (?:the |an )?Encounter(?: for the first time)?|Encounter Start|At the start of (?:the |an )?Encounter|Always Active)\s*[:,]?\s*/i.exec(t);
  if (enc) { t = "Combat Start: " + t.slice(enc[0].length); first = true; }
  const beg = /^Begin (?:the )?encounters? with (\d+)(?: of each of)? (\[\w+\])/i.exec(t);
  if (beg) { t = `Combat Start: Gain ${beg[1]} ${beg[2]}`; first = true; }
  t = t.replace(/\bIf this unit's SP is at max,\s*/i, "");
  return { t, first };
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
function drEvPas(x, up, extra = []) {
  const key = `p${x.id}.${up}.${extra.length}`;
  if (DR_EV.has(key)) return DR_EV.get(key);
  const out = [];
  for (const [txt, from] of [...(x.passives || []).map((p0) => { let p = p0; while (p && (p.uptie || 0) > up) p = p.prev; return p && p.kind !== "support" ? [dcaEn("ps", p.id, p.desc), dcaPlain(p.name)] : null; }).filter(Boolean), ...extra]) {
    const ctx = {};
    for (const l of String(txt || "").split("\n")) { const { t, first } = drPre(l); out.push(...dcaInstead(dcaOwnLine(t, ctx, null, true)).map((e) => ({ ...e, from, first: first && e.at === "start" }))); }
  }
  DR_EV.set(key, out);
  return out;
}

// ---- team: statuses other Identities of the same group give this one ("[DawnTeam] Fixer Sinclair gains [DawnFaust]")
function drTeamOf(x) {
  const own = dcaNames(dcaPlain([...(x.passives || []).map((p) => dcaEn("ps", p.id, p.desc)), ...x.skills.flatMap((q) => Object.values(q.up).map((v) => dcaEnU(q, v).desc))].join("\n")));
  const groups = new Set((x.traitKw || []).map((k) => dcaPlain(k.name)).filter(Boolean));
  const sinner = DCA_SIN[x.sinner - 1] || "", gives = {}, mates = [];
  for (const y of UNITS.ids) {
    if (y.id === x.id || y.sinner === x.sinner) continue;
    const pt = (y.passives || []).map((p) => dcaNames(dcaPlain(dcaEn("ps", p.id, p.desc) || ""))).join("\n");
    let mate = false;
    for (const m of pt.matchAll(/\[(\w+)\](?:\[TabExplain\])?\s+([\w.'’ -]{2,40}?)\s+gains?\s+(?:(\d+)\s+)?\[(\w+)\]/g)) {
      if (!new RegExp(`\\b${sinner.split(" ")[0]}\\b`, "i").test(m[2]) || !(own.includes(`[${m[1]}]`) || groups.has(dcaPlain(dcaG(m[1]).name)))) continue;  // (its group: in its own texts or its traits)
      gives[m[4]] = Math.max(gives[m[4]] || 0, +(m[3] || 1));
      mate = true;
    }
    if (mate) mates.push(y);
  }
  return { gives, mates };
}

// ---- one Identity: 20 turns, one card a turn (S1 S1 S2 S1 S2 S3 round), the form its own status says
function drSim(x0, hit, team) {
  // with a team: what the mates' statuses do is read as one more passive of this Identity (its own copy, its own caches)
  const tm0 = team ? drTeamOf(x0) : null, extra = tm0 ? Object.keys(tm0.gives).map((kw, i) => ({ id: `dr${x0.id}.${i}`, kind: "battle", name: kw, desc: dcaEn("gl", kw, dcaG(kw).desc) })) : [];
  const x = extra.length ? Object.assign(Object.create(x0), { id: x0.id + 900000, passives: [...(x0.passives || []), ...extra] }) : x0;
  const up = x.maxUp || 4, slots = dcSlots(x);
  dc.ego = false; dc.id = x.id; dc.up = up; dc.lv = MAX_LEVEL; dc.en = 0; dc.ev = 0; dc.dlv = null; dc.res = {}; dc.hit = hit; dc.bd = {};
  const F = dcForms(x, slots), base = F.forms[0];
  // a Skill 1-3 the kit also uses by name (an ally's follow-up) is still its deck skill
  const byLabel = {};
  slots.forEach(([l], i) => { const m = /^Skill (\d)$/.exec(l); if (m && !(m[1] in byLabel) && !F.info[i].kw) byLabel[m[1]] = i; });
  const deckSlots = new Set(F.forms.flatMap((f) => Object.values({ ...byLabel, ...f.deck })));
  const sp = x.speed[Math.min(up, x.speed.length) - 1] || [4, 4], speed = Math.round((sp[0] + sp[1]) / 2);
  const tm = tm0, approx = new Set();
  const me = {}, pend = [];
  if (tm) for (const [kw, n] of Object.entries(tm.gives)) dcOwnKeys(kw).forEach((k) => { me[k] = n; });
  let carry = {};
  const pas = drEvPas(x, up), all = { has: (k) => k !== "sp" };
  const turns = [];
  let formAt = 0, lastForm = 0;
  for (let t = 1; t <= DR_TURNS; t++) {
    // turn start: statuses' own losses, the passives' Combat Start lines (Encounter ones on turn 1)
    for (const kw of new Set(Object.keys(me).map((k) => k.replace(/^s_/, "").replace(/_[pc]$/, "")))) { const te = dcaTurnEnd(kw); if (te.start) dcOwnDo(me, { conds: [], kw, part: dcaG(kw).st === 2 ? "c" : "s", op: "eat", n: te.start, upTo: true }, {}); }
    const fi = F.forms.findIndex((f, i) => i && f.kw && dcOwnKeys(f.kw).some((k) => me[k] > 0)), form = fi > 0 ? F.forms[fi] : base;
    if (fi > 0 && !formAt) formAt = t;
    const deck = { ...byLabel, ...base.deck, ...form.deck }, tier = DR_DECK[(t - 1) % 6], slot = deck[tier];
    if (slot == null) return null;
    lastForm = fi > 0 ? fi : 0;
    const sk = slots[slot][1], bm = dcModelOf(x, sk);
    if (!bm) return null;
    if (!bm.m.auto) approx.add("hand model");
    const u = cqAt(sk, up), o = dcbOn(bm), name = dcaBare(dcaEnU(sk, u).name);
    // the card's two states: conditions (status-effects at 99) and the real target (status damage)
    const st = (real) => {
      const s = {};
      for (const k of Object.keys(bm.s)) {
        let m;
        if ((m = /^t_(\w+)_(p|c)$/.exec(k))) s[k] = !real && DR_ELEM.has(m[1]) ? 99 : carry[m[1]] ? carry[m[1]][m[2]] || 0 : 0;
        else if ((m = /^t_(\w+)$/.exec(k))) s[k] = carry[m[1]] ? carry[m[1]].n ?? carry[m[1]].p ?? 0 : 0;
        else if (/^s_/.test(k)) s[k] = me[k] || 0;
        else if ((m = /^g_(\w+)$/.exec(k))) s[k] = drG(m[1], k, bm, { speed, team: !!tm, carry, real });
        else s[k] = bm.s[k];
      }
      if (fi > 0) F.forms.forEach((f) => { if (f.kw) s[`s_${f.kw}`] = f === form ? 1 : 0; });
      for (const k in me) if (!(k in s)) s[k] = me[k];
      s.__name = name;
      return dcS(u, s);
    };
    const evs = drEvSkill(sk, up);
    pas.forEach((e) => { if (e.at === "start" && (!e.first || t === 1)) dcOwnDo(me, e, st(false)); });
    evs.forEach((e) => { if (e.op === "add" && e.at === "pre") dcOwnDo(me, e, st(false)); });
    const s99 = st(false), sR = st(true), env = dcEnv(u), m2 = { ...bm.m, bursts: null };
    // Poise: crit chance 5% a Potency
    const pc = Math.min(1, (me.s_Breath_p || 0) * 0.05), calc = (m, s, sd) => {
      const a = dcbCalc(m, u, { ...s, g_crit: 0, stdmg: sd }, o, env), b = pc > 0 ? dcbCalc(m, u, { ...s, g_crit: 1, stdmg: sd }, o, env) : a;
      return { total: a.total * (1 - pc) + b.total * pc, c: pc >= 0.5 ? b : a };
    };
    const b99 = calc(m2, s99, 0), bR = calc(m2, sR, 0), cR = calc(bm.m, sR, 1);
    let dmg = b99.total + (cR.total - bR.total);
    if (bm.m.auto) for (const [kw, b0, a] of bm.m.target(sR, o).st) {
      if (typeof b0 === "number") { if (a > 0) carry[kw] = { n: a }; else delete carry[kw]; } else if (a && a.p > 0 && a.c > 0) carry[kw] = { p: a.p, c: a.c }; else delete carry[kw];
    }
    dcOwnAfter(me, [...evs, ...pas.filter((e) => e.at === "hit" || e.at === "post" || e.at === "use")], { s: s99, c: b99.c, name }, all, pend);
    // follow-ups by their text's condition
    let fu = 0;
    for (const z of form.fu || []) {
      if (deckSlots.has(z)) continue;
      const c = dcaFuCond(x, dcaBare(dcaEnU(slots[z][1], cqAt(slots[z][1], up)).name), up);
      if (!c.length) { approx.add("follow-up"); continue; }
      // "at 0 [X]" of a status the texts never give: not known
      if (c.some((r) => r.tests.some((q) => q.side === "self" && q.eq && !dcOwnKeys(q.kw).some((k) => k in me)))) { approx.add("follow-up"); continue; }
      const tg = { ...carry }; DR_ELEM.forEach((k) => { tg[k] = { p: 99, c: 99 }; });
      if (!dcFuFires(c, { ...s99, ...me }, tg, name, tier)) continue;
      const fbm = dcModelOf(x, slots[z][1]), fu0 = cqAt(slots[z][1], up);
      if (fbm) fu += dcbCalc(fbm.m, fu0, { ...dcS(fu0, { ...fbm.s, ...s99 }), stdmg: 0 }, dcbOn(fbm), dcEnv(fu0)).total;
    }
    dmg += fu;
    // turn end: the target's statuses tick (Burn hits), yours lose Counts, Turn End lines, then what was gained for next turn
    let burn = 0;
    carry = Object.fromEntries(Object.entries(carry).flatMap(([k, v]) => {
      const e = dcaTurnEnd(k);
      if (e.dmg && v.p) burn += v.p;
      if (v.n != null) { const n = e.dec === "all" ? 0 : v.n - e.dec; return n > 0 ? [[k, { n }]] : []; }
      const c = e.dec === "all" ? 0 : v.c - e.dec;
      return c > 0 ? [[k, { p: v.p, c }]] : [];
    }));
    for (const k of Object.keys(me)) {
      const kw = k.replace(/^s_/, "").replace(/_[pc]$/, ""), e = dcaTurnEnd(kw);
      if (tm && kw in tm.gives) continue;
      if (e.one || e.dec === "all") me[k] = 0;
      else if (e.dec && (!/_p$/.test(k))) dcOwnDo(me, { conds: [], kw, part: /_c$/.test(k) ? "c" : "s", op: "eat", n: e.dec, upTo: true }, {});
    }
    pas.forEach((e) => { if (e.at === "end") dcOwnDo(me, e, s99); });
    pend.splice(0).forEach(([e, s]) => dcOwnDo(me, e, s));
    turns.push({ t, tier, slot, kind: F.info[slot].kind, form: lastForm, dmg: Math.round(dmg + burn), fu: Math.round(fu), burn, ...(dr.debug ? { me: { ...me }, carry: JSON.parse(JSON.stringify(carry)), b99: Math.round(b99.total), st: Math.round(cR.total - bR.total) } : {}) });
  }
  // full power: the first 6-turn stretch within 95% of the best one
  const win = turns.map((_, i) => i + 6 <= turns.length ? turns.slice(i, i + 6).reduce((a, q) => a + q.dmg, 0) : 0), best = Math.max(...win);
  const full = win.findIndex((v) => v >= best * 0.95) + 1;
  const tot = turns.reduce((a, q) => a + q.dmg, 0);
  if (F.forms.length > 1 && !formAt) approx.add("form not reached");
  return { id: x0.id, tot, avg: Math.round(tot / DR_TURNS), full, formAt, forms: F.forms.length, turns, approx: [...approx], team: tm ? tm.mates.map((y) => y.id) : [] };
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
  const key = `${dr.hit}.${dr.team ? 1 : 0}`;
  if (DR_DONE.has(key)) return DR_DONE.get(key);
  // the calculator's own state is put back after the run
  const keep = { ...dc }, rows = [], ids = UNITS.ids.filter((x) => x.title);
  for (let i = 0; i < ids.length; i++) {
    try { const r = drSim(ids[i], dr.hit, dr.team); if (r) rows.push(r); } catch (e) { console.warn("ranking", ids[i].id, e); }
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
      <span class="cqkind" id="drteam"><button data-team="0" class="${dr.team ? "" : "on"}">Alone</button><button data-team="1" class="${dr.team ? "on" : ""}">With its team</button></span>
      <span class="cqkind" id="drsort"><button data-sort="tot" class="${dr.sort === "tot" ? "on" : ""}">Most damage</button><button data-sort="full" class="${dr.sort === "full" ? "on" : ""}">Fastest to full power</button></span>
      <select id="drsin"><option value="">All Sinners</option>${DCA_SIN.map((n, i) => `<option value="${i + 1}"${+dr.sin === i + 1 ? " selected" : ""}>${esc(n)}</option>`).join("")}</select>
      <select id="drrk"><option value="">Any rarity</option>${[3, 2, 1].map((n) => `<option value="${n}"${+dr.rk === n ? " selected" : ""}>${"0".repeat(n)}</option>`).join("")}</select>
      <input id="drq" class="drq" placeholder="Search…" value="${esc(dr.q)}">
    </div>
    <div id="drlist"><div class="drload"><span class="muted">Counting every Identity…</span><div class="drprogw"><div id="drprog"></div></div></div></div>
    <p class="muted small drfoot">≈ = part of this kit is not read yet (hover it), the real number can be higher or lower. Not a tier list: damage on one dummy only, no allies' attacks, no E.G.O.<br>
      With its team: what allies of its group give it (Dawn Office, House of Spiders…) and conditions on allies met. Formula: the calculator's, <a href="https://github.com/BaTyANl/ElderCalc" target="_blank" rel="noopener">BaTyANl calc ↗</a></p></div>`;
  const re = async () => { $("#drlist").innerHTML = `<div class="drload"><span class="muted">Counting every Identity…</span><div class="drprogw"><div id="drprog"></div></div></div>`; const r = await drRows(); if (r) drDraw(r); };
  $("#drhit").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; dr.hit = +b.dataset.hit; document.querySelectorAll("#drhit button").forEach((q) => q.classList.toggle("on", q === b)); re(); };
  $("#drteam").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; dr.team = b.dataset.team === "1"; document.querySelectorAll("#drteam button").forEach((q) => q.classList.toggle("on", q === b)); re(); };
  $("#drsort").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; dr.sort = b.dataset.sort; document.querySelectorAll("#drsort button").forEach((q) => q.classList.toggle("on", q === b)); if (dr.rows) drDraw(dr.rows); };
  $("#drsin").onchange = (e) => { dr.sin = e.target.value; if (dr.rows) drDraw(dr.rows); };
  $("#drrk").onchange = (e) => { dr.rk = e.target.value; if (dr.rows) drDraw(dr.rows); };
  $("#drq").oninput = (e) => { dr.q = e.target.value; if (dr.rows) drDraw(dr.rows); };
  $("#drlist").onclick = (e) => { const r = e.target.closest(".drrow"); if (!r || e.target.closest("a")) return; dr.open = dr.open === +r.dataset.id ? 0 : +r.dataset.id; drDraw(dr.rows); };
  await re();
}
const DR_WHY = { "follow-up": "a follow-up's condition", "form not reached": "how it reaches its other form", "hand model": "this Skill's state (set by hand)" };
function drDraw(rows) {
  dr.rows = rows;
  const pos = new Map([...rows].sort((a, b) => b.tot - a.tot).map((r, i) => [r.id, i + 1]));
  const q = dr.q.trim().toLowerCase(), top = Math.max(...rows.map((r) => r.tot), 1);
  const list = rows.map((r) => ({ r, x: unitById(r.id) })).filter(({ x }) => x && (!dr.sin || x.sinner === +dr.sin) && (!dr.rk || x.rank === +dr.rk)
    && (!q || `${x.title} ${x.sinnerName} ${DCA_SIN[x.sinner - 1] || ""}`.toLowerCase().includes(q)))
    .sort((a, b) => dr.sort === "full" ? a.r.full - b.r.full || b.r.tot - a.r.tot : b.r.tot - a.r.tot);
  $("#drlist").innerHTML = list.length ? `<div class="drlist">${list.map(({ r, x }) => {
    const p = pos.get(r.id), mx = Math.max(...r.turns.map((t) => t.dmg), 1), ap = r.approx.length ? `<span class="drap" title="${esc(`Not read yet: ${r.approx.map((a) => DR_WHY[a] || a).join(", ")}`)}">≈</span>` : "";
    const bars = r.turns.map((t) => `<i class="t${DR_DECK[(t.t - 1) % 6]}${t.form ? " f" : ""}" style="height:${Math.max(4, 100 * t.dmg / mx).toFixed(0)}%" title="${esc(`Turn ${t.t} · ${t.kind}: ${t.dmg}`)}"></i>`).join("");
    const mates = r.team.length ? `<span class="drmates" title="${esc(r.team.map((id) => (unitById(id) || {}).title || id).join(", "))}">${r.team.map((id) => { const y = unitById(id); return y ? `<img src="${imgThumb(y.img.thumb)}" alt="">` : ""; }).join("")}</span>` : "";
    return `<div class="drrow${p <= 3 ? " top3" : ""}${dr.open === r.id ? " open" : ""}" data-id="${r.id}">
      <div class="drpos">#${p}</div><img class="drpic" src="${imgThumb(x.img.thumb)}" alt="" onerror="this.style.visibility='hidden'">
      <div class="drnm"><div class="drt">${esc(x.title)}</div><div class="drs"><span>${esc(x.sinnerName)}</span><span class="drrk">${"0".repeat(x.rank)}</span>${seasonTag(x.season)}${ap}${r.formAt ? `<span class="drtag">Form from turn ${r.formAt}</span>` : ""}${mates}</div></div>
      <div class="drbars">${bars}</div>
      <div class="drtot"><b>${r.approx.length ? "≈" : ""}${r.tot}</b><small><span>${r.avg}</span> a turn</small><small>Full power by turn <span>${r.full}</span></small><div class="drfull"><u style="width:${(100 * r.tot / top).toFixed(1)}%"></u></div></div>
      ${dr.open === r.id ? `<div class="drmore"><div class="drturns">${r.turns.map((t) => `<span><i>${t.t}</i>${esc(t.kind)}<b>${t.dmg}</b></span>`).join("")}</div>
        <a href="#/calc/${r.id}/${r.turns[0].slot}">Open in the calculator →</a></div>` : ""}
    </div>`;
  }).join("")}</div>` : `<div class="empty">Nothing found.</div>`;
}
