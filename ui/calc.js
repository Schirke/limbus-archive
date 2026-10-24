// More → Damage calc (beta): one skill's damage against an enemy or a dummy. Formula and presets: ElderCalc by BaTyANl. #/calc/<id>/<slot>
const DC_EC = "https://raw.githubusercontent.com/BaTyANl/ElderCalc/main/ID_Table.json";
const dc = { ego: false, id: 0, slot: 0, up: 4, lv: 0, en: 0, ev: 0, dlv: null, res: {}, s: null, pre: "", ecMap: null, ecBusy: null };
const DC_TYPES = ["Slash", "Pierce", "Blunt"];
const dcList = () => dc.ego ? UNITS.egos : UNITS.ids;
const dcFloor = (v) => Math.floor(v + 1e-9);
// above 1 a resistance adds in full, below 1 only half of the loss counts
const dcRmod = (r) => r > 1 ? r - 1 : r < 1 ? -(1 - r) / 2 : 0;
const dcNum = (v) => { const n = parseFloat(String(v).replace(",", ".")); return Number.isFinite(n) ? n : 0; };
const dcSign = (n) => n > 0 ? `+${n}` : `${n}`;

routes.calc = async (args) => {
  $("#main").innerHTML = `<div class="muted">Loading…</div>`;
  try { await Promise.all([units(), ENEMIES || api("/api/enemies").then((j) => { ENEMIES = j; })]); } catch (e) { $("#main").innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  if (!UNITS.ids.length) { $("#main").innerHTML = `<div class="empty">Take a snapshot first — the database is read from it.</div>`; return; }
  dc.lv ||= MAX_LEVEL;
  const x = unitById(+args[0]);
  if (x && (x.id !== dc.id || +args[1] !== dc.slot)) { dc.ego = !x.title; dc.id = x.id; dc.slot = +args[1] || 0; dc.s = null; }
  if (+args[2] >= 1 && +args[2] <= 4 && +args[2] !== dc.up) { dc.up = +args[2]; dc.s = null; }  // from an ID card: its Uptie and level
  if (+args[3] >= 1) dc.lv = Math.min(+args[3], MAX_LEVEL);
  if (x && args[4] && /^[1-3a-z]+(?:~|$)/.test(args[4])) dc.rotq = { id: x.id, q: args[4] };  // a shared rotation
  if (!dcList().some((u) => u.id === dc.id)) { dc.id = dcList()[0].id; dc.slot = 0; dc.s = null; }
  dcDraw();
  await dcLoadEc();
  if (location.hash.startsWith("#/calc") && $(".dcpage")) dcDraw();
};
function dcLoadEc() {
  dc.ecBusy ||= sxBack().catch(() => {}).then(() => fetch(DC_EC)).then((r) => r.ok ? r.json() : []).catch(() => []).then(dcMatch).then((m) => { dc.ecMap = m; return m; });
  return dc.ecBusy;
}

// ElderCalc's ID_Table names → our Identities (same Sinner, closest title; "… 2" / "… 3" = another state of one ID)
function dcMatch(list) {
  const n = (s) => sxNorm(s).replace(/[^a-z0-9]/g, "");
  const grams = (s) => { const g = new Map(); for (let i = 0; i < s.length - 1; i++) g.set(s.slice(i, i + 2), (g.get(s.slice(i, i + 2)) || 0) + 1); return g; };
  const dice = (a, b) => { const A = grams(a), B = grams(b); let m = 0, t = 0; A.forEach((v, k) => { m += Math.min(v, B.get(k) || 0); t += v; }); B.forEach((v) => { t += v; }); return t ? 2 * m / t : 0; };
  const en = (s) => (sxEn(s) || s).split(" / ")[0];
  const out = new Map();
  for (const e of Array.isArray(list) ? list : []) {
    const raw = String(e["ID Name"] || ""), alt = /\s(\d+)$/.exec(raw), name = n(raw.replace(/\s\d+$/, ""));
    let best = null, sc = 0;
    for (const x of UNITS.ids) if (n(en(x.sinnerName)) === n(e.Sinner)) { const v = dice(name, n(en(x.title))); if (v > sc) { sc = v; best = x; } }
    if (best && sc >= 0.7) { if (!out.has(best.id)) out.set(best.id, []); out.get(best.id).push({ e, alt: alt ? +alt[1] : 0 }); }
  }
  return out;
}

// attacking skills only: Skill 1-3 and alternates, Counter; E.G.O = its skills
function dcSlots(x) {
  const ego = !x.title, out = ego ? x.skills.map((s) => [s.label || "Skill", s]) : cqSlots(x);
  if (!ego) (x.defense || []).forEach((s) => { if (Object.values(s.up).some((u) => u.def === "Counter")) out.push(["Counter", s]); });
  return out.filter(([, s]) => Object.values(s.up).some((u) => u.atk));
}
function dcPresets(x, label, u, slots, at = dc.slot) {
  const tier = (l) => l === "Counter" ? "C" : (/^Skill (\d)/.exec(l) || [])[1], m = dc.ecMap && dc.ecMap.get(x.id), t = tier(label);
  if (!m || !t) return [];
  // by order: Skill 3 = his S3-1, Skill 3.1 = S3-2 …, Counters = C-1, C-2; forms we don't have show dimmed on the first one
  const forms = slots.filter(([l]) => tier(l) === t), k = forms.indexOf(slots[at]) + 1, pre = t === "C" ? "C-" : `S${t}-`, out = [];
  for (const { e, alt } of m) for (const key in e) if (key.startsWith(pre) && e[key] && e[key].setup) {
    const n = +key.slice(pre.length);
    if (n === k || (k === 1 && n > forms.length)) out.push({ key: `${key}${alt ? ` · state ${alt}` : ""}`, alt, v: e[key], fit: n === k });
  }
  return out.sort((a, b) => b.fit - a.fit || a.alt - b.alt);
}
// what his setup assumes, for the button's tooltip
function dcPresetTip(p) {
  const s = p.v.setup, c = s.coins, crit = c.filter((x) => x.hasCrit).length, w = Math.max(...c.map((x) => x.weight ?? 1));
  return [`BaTyANl calc ${p.key}: the skill at its best, by his conditions`, `${c.length} coin${c.length > 1 ? "s" : ""}, base ${s.baseRoll || 0}, ${c.map((x) => dcSign(x.power || 0)).join(" ")}`,
    s.passiveModDynPercent ? `damage up +${s.passiveModDynPercent}% on every coin` : "", c.some((x) => x.modDynPercent) ? `per coin +${c.map((x) => x.modDynPercent || 0).join(" / ")}%` : "",
    crit ? `crit on ${crit} of ${c.length}` : "no crit", w > 1 ? `up to ${w} targets` : "", p.fit ? "" : "(a form this Identity doesn't have now)"].filter(Boolean).join("\n");
}
function dcFromGame(u) {
  return { type: u.atk, sin: u.sin, base: u.base, passive: 0, clash: 0, critP: 20, tm: 0, bon: [],
    coins: Array.from({ length: u.coins }, () => ({ on: true, power: u.op === "SUB" ? -u.coin : u.coin, mod: 0, dx: 0, crit: false, w: 1 })) };
}
// his diff is offense minus defense with the target at the attacker's level: our "Offense +" is the rest over the skill's own bonus
function dcFromPreset(p, u) {
  const s = p.v.setup;  // critPercent is per coin; the others keep 20
  return { type: s.skillType || u.atk, sin: s.skillSin || u.sin, base: s.baseRoll || 0, passive: s.passiveModDynPercent || 0, clash: s.clashCount || 0,
    critP: 20, tm: s.timeMoratorium ? s.timeMoratoriumStacks || 1 : 0,
    bon: (s.bonuses || []).map((b) => ({ kind: b.kind === "Percent" ? "Percent" : "Flat", target: b.target || "True", values: s.coins.map((_, i) => dcNum((b.values || [])[i])) })),
    coins: s.coins.map((c) => ({ on: !!c.active, power: c.power || 0, mod: c.modDynPercent || 0, dx: (c.offenseDefenseDiff || 0) - (u.level || 0), crit: !!c.hasCrit, cp: c.critPercent, w: c.weight ?? 1,
      subs: (c.subtargets || []).map((st) => { const tg = (s.targets || []).find((x) => x.name === st.name);
        return { mod: st.modDynPercent || 0, dx: (st.offenseDefenseDiff || 0) - (u.level || 0), crit: !!st.hasCrit, cp: st.critPercent, res: tg && tg.resistances, tm: tg && tg.timeMoratorium ? tg.timeMoratoriumStacks || 1 : 0 }; }) })) };
}

function dcCalc(s, R, diff0, heads) {
  let roll = s.base, total = 0;
  const rows = s.coins.map((c, i) => {
    roll += (heads ?? c.on) ? c.power : 0;
    // targets after the first may have their own numbers (ElderCalc presets); otherwise all take the first one's
    const hit = (o, R2, tm) => {
      const res2 = (el) => el === "True" ? 1 : R2[el] ?? 1, diff = diff0 + o.dx;
      const mod = 1 + (o.crit ? (o.cp ?? s.critP) / 100 : 0) + diff / (Math.abs(diff) + 25) + 0.03 * s.clash + dcRmod(res2(s.type)) + dcRmod(res2(s.sin));
      const dyn = 1 + (o.mod + s.passive) / 100, core = roll <= 0 ? 1 : roll * dyn * mod;
      let flat = 0, pct = 0;
      s.bon.forEach((b) => { const v = (b.values[i] || 0) * res2(b.target); if (b.kind === "Percent") pct += v; else flat += v; });
      let one = dcFloor(dcFloor(core) + dcFloor(core * pct / 100) + flat);
      if (tm) one = dcFloor(one * (1 + 0.15 * tm) * res2("Sloth"));
      return { diff, mod, dyn, one };
    };
    const main = hit(c, R, s.tm), { diff, mod, dyn, one } = main;
    let dmg = 0;
    for (let k = 0; k < Math.max(0, c.w); k++) { const sub = k && (c.subs || [])[k - 1]; dmg += sub ? hit(sub, sub.res || R, sub.tm).one : one; }
    total += dmg;
    return { roll, diff, mod, dyn, one, dmg };
  });
  return { rows, total };
}

function dcTarget() {
  const e = dc.en ? ENEMIES.list.find((x) => x.id === dc.en) : null, v = e ? e.variants[dc.ev] || e.variants[0] : null;
  return { e, v, R: v ? { ...v.atk, ...v.sin } : { ...dc.res }, def: v ? v.level + v.def : dc.dlv ?? dc.lv };
}
function dcCtx() {
  const x = unitById(dc.id), slots = dcSlots(x), [label, sk] = slots[dc.slot] || slots[0] || [];
  const u = sk ? cqAt(sk, dc.up) : null;
  return { x, slots, label, sk, u };
}

// the page's parts shared by both views: the Identity pick, the target pick, Uptie / level, dummy resistances
const dcResIn = (k) => `<label class="dcres">${DC_TYPES.includes(k) ? ico(`res_${k}`, "s20", k, k[0]) : sinIcon(k, "s20")}<input type="number" step="0.25" min="0" data-res="${k}" value="${dc.res[k] ?? 1}"></label>`;
const dcResKeys = () => [...DC_TYPES, ...Object.keys(SIN_COLORS).filter((k) => k !== "None")];
function dcPickA(x) {
  // name or picture: the Database card (skills, passives)
  return `<div class="cqpick" data-side="a"><img class="dcunit" data-unit="${x.id}" src="${x.pics.thumb}" alt="" title="Skills and passives" onerror="this.style.visibility='hidden'">
    <div class="grow"><button class="cqname dcunit" data-unit="${x.id}" title="Skills and passives">${esc(x.title || x.name)}</button><div class="muted small">${esc(x.sinnerName)}</div></div>
    <input class="cqin" placeholder="Change…" autocomplete="off"><div class="cqlist"></div></div>`;
}
function dcPickB(t) {
  const card = t.e
    ? `${enTileImg(t.e) || `<span class="dcnopic"></span>`}<div class="grow"><div class="cqname">${esc(t.e.name)}</div>
        ${t.e.variants.length > 1 ? `<select id="dcev">${t.e.variants.map((v, i) => `<option value="${i}" ${i === dc.ev ? "selected" : ""}>${esc(v.label || `Variant ${i + 1}`)} · Lv. ${v.level}</option>`).join("")}</select>` : `<div class="muted small">${esc(t.v.label || "")} · Lv. ${t.v.level}</div>`}</div>`
    : `<span class="dcdummy">🎯</span><div class="grow"><div class="cqname">Training dummy</div><div class="muted small">No resistances unless you set them</div></div>`;
  return `<div class="cqpick" data-side="b">${card}<input class="cqin" placeholder="Change…" autocomplete="off"><div class="cqlist"></div></div>`;
}
const dcKind = () => `<span class="cqkind"><button class="${dc.ego ? "" : "on"}" data-ego="0">Identities</button><button class="${dc.ego ? "on" : ""}" data-ego="1">E.G.O</button></span>`;
const dcUp = () => `<span class="lvlabel">${dc.ego ? "Threadspin" : "Uptie"}</span>${[1, 2, 3, 4].map((n) => `<button class="upbtn ${dc.up === n ? "on" : ""}" data-up="${n}">${ico(`up_${n}`, "s22", "", ROMAN[n - 1])}</button>`).join("")}`;
const dcLvIn = () => `<span class="lvlabel">Lv. <b id="dclvn">${dc.lv}</b></span><input type="range" id="dclv" min="1" max="${MAX_LEVEL}" value="${dc.lv}">`;
// the link keeps the skill, Uptie, level and the rotation
function dcUrl() {
  const x = unitById(dc.id), r = dc.rot && dc.rot.id === dc.id ? `/${dc.rot.order.map((t, i) => dc.rot.sl[i] != null ? String.fromCharCode(97 + dc.rot.sl[i]) : t).join("")}${[...dc.rot.fu].map(([z, v]) => `~${z.replace(":", ".")}${v ? "" : "x"}`).join("")}` : "";
  history.replaceState(null, "", `#/calc/${x.id}/${dc.slot}/${dc.up}/${dc.lv}${r}`);
}

function dcDraw() {
  const { x, slots, label, u } = dcCtx();
  if (!u) { history.replaceState(null, "", `#/calc/${x.id}/${dc.slot}`); $("#main").innerHTML = `<div class="empty">This one has no attacking skill.</div>`; return; }
  if (!dc.s) { dc.s = dcFromGame(u); dc.pre = ""; }
  const t = dcTarget(), pres = dcPresets(x, label, u, slots), bm0 = dcbFor(x, slots[dc.slot][1]), bm = dc.bm = bm0 && !dc.manual ? bm0 : null;
  if (bm) {
    $("#main").innerHTML = dcbHtml(x, t);
    dcbControls();
    dcBind(pres, u);
    dcbRefresh();
    return;
  }
  dcUrl();
  $("#main").innerHTML = `<div class="dcpage"><h1>Damage calculator</h1>
    <p class="muted small dccredit">Formula and presets: <a href="https://github.com/BaTyANl/ElderCalc" target="_blank" rel="noopener">BaTyANl calc ↗</a></p>
    <div class="cqpicks">${dcPickA(x)}<div class="cqvs">VS</div>${dcPickB(t)}</div>
    <div class="cqctl">${dcKind()}${dcUp()}${dcLvIn()}
      ${t.e ? "" : `<span class="lvlabel">Dummy defense</span><input type="number" id="dcdlv" class="dcnum" value="${t.def}">`}</div>
    ${t.e ? "" : `<div class="dcresrow"><span class="lvlabel">Dummy resistances</span>${dcResKeys().map(dcResIn).join("")}</div>`}
    <div class="dcslots">${slots.map(([l, s], i) => { const v = cqAt(s, dc.up); return `<button class="${i === dc.slot ? "on" : ""}" data-slot="${i}">${sinIcon(v.sin, "s20")}${atkIcon(v, "s18")}<span><small>${esc(l)}</small>${esc(v.name)}</span></button>`; }).join("")}</div>
    <div class="dcgrid">
      <div class="dcleft">
        <div class="dcpresets"><button class="${dc.pre ? "" : "on"}" data-pre="">Game values</button>${pres.map((p, i) => `<button class="${dc.pre === p.key ? "on" : ""}${p.fit ? "" : " dim"}" data-pre="${i}" title="${esc(dcPresetTip(p))}">BaTyANl calc ${p.fit ? `max${p.alt ? ` · state ${p.alt}` : ""}` : esc(p.key)} · <b>${p.v.damage}</b></button>`).join("")}
          ${dc.ecMap ? pres.length ? "" : `<span class="muted small">No BaTyANl calc preset for this skill</span>` : `<span class="muted small">Loading BaTyANl calc presets…</span>`}
          ${bm0 ? `<button class="toggle" id="dcbback">Damage breakdown</button>` : ""}</div>
        <div class="dctabwrap"><table class="dctab" id="dctab"></table></div>
        <div class="dcbtns"><button data-all="1">All heads</button><button data-all="0">All tails</button><button id="dcbonus">+ Bonus row</button></div>
      </div>
      <div class="dcside">
        <div class="dcresult" id="dcres"></div>
        <div class="dcmods">
          <label>Base power<input type="number" class="dcnum" data-g="base" value="${dc.s.base}"></label>
          <label>Damage up, all coins %<input type="number" class="dcnum" data-g="passive" value="${dc.s.passive}"></label>
          <label>Crit adds %<input type="number" class="dcnum" data-g="critP" value="${dc.s.critP}"></label>
          <label>Clashes won<input type="number" class="dcnum" min="0" data-g="clash" value="${dc.s.clash}"></label>
          <label>Time Moratorium<select data-g="tm">${[0, 1, 2].map((n) => `<option value="${n}" ${dc.s.tm === n ? "selected" : ""}>${n ? `${n} stack${n > 1 ? "s" : ""}` : "None"}</option>`).join("")}</select></label>
        </div>
        <p class="muted small">BaTyANl calc presets count the skill at its best: passives, conditional power and crits are already in. Change any number to try your own case.</p>
      </div>
    </div></div>`;
  dcTable();
  dcBind(pres, u);
  dcUpdate();
}

function dcTable() {
  const s = dc.s, cell = (k, i, v, step = 1) => `<td><input type="number" step="${step}" data-k="${k}" data-i="${i}" value="${v}"></td>`;
  const box = (k, i, v) => `<td><input type="checkbox" data-k="${k}" data-i="${i}" ${v ? "checked" : ""}></td>`;
  const out = (k) => s.coins.map((_, i) => `<td class="dcout" id="dco-${k}-${i}"></td>`).join("");
  const elOpts = (sel) => [...DC_TYPES, ...Object.keys(SIN_COLORS).filter((k) => k !== "None"), "True"].map((k) => `<option ${k === sel ? "selected" : ""}>${k}</option>`).join("");
  $("#dctab").innerHTML = `<tr><th></th>${s.coins.map((c, i) => `<th><button class="dccoin ${c.on ? "on" : ""}" data-flip="${i}" title="Heads / tails">${coinIcon("")}<small>${ROMAN[i] || i + 1}</small></button></th>`).join("")}</tr>
    <tr><th>Power</th>${s.coins.map((c, i) => cell("power", i, c.power)).join("")}</tr>
    <tr><th>Damage up %</th>${s.coins.map((c, i) => cell("mod", i, c.mod)).join("")}</tr>
    <tr><th>Offense +</th>${s.coins.map((c, i) => cell("dx", i, c.dx)).join("")}</tr>
    <tr><th>Crit</th>${s.coins.map((c, i) => box("crit", i, c.crit)).join("")}</tr>
    <tr><th>Targets</th>${s.coins.map((c, i) => cell("w", i, c.w)).join("")}</tr>
    ${s.bon.map((b, j) => `<tr class="dcbon"><th><select data-bk="${j}"><option ${b.kind === "Flat" ? "selected" : ""}>Flat</option><option ${b.kind === "Percent" ? "selected" : ""}>Percent</option></select><select data-bt="${j}">${elOpts(b.target)}</select><button data-bx="${j}" title="Remove">×</button></th>${s.coins.map((_, i) => `<td><input type="number" data-b="${j}" data-i="${i}" value="${b.values[i] || 0}"></td>`).join("")}</tr>`).join("")}
    <tr class="dcsep"><th>Roll</th>${out("roll")}</tr>
    <tr><th>Level diff</th>${out("diff")}</tr>
    <tr><th>Multiplier</th>${out("mul")}</tr>
    <tr class="dcdmg"><th>Damage</th>${out("dmg")}</tr>`;
}

function dcUpdate() {
  if (dc.bm) return dcbRefresh();
  const { u } = dcCtx(), t = dcTarget(), s = dc.s, diff0 = dc.lv + (u.level || 0) - t.def;
  const r = dcCalc(s, t.R, diff0), hi = dcCalc(s, t.R, diff0, true).total, lo = dcCalc(s, t.R, diff0, false).total;
  r.rows.forEach((o, i) => {
    $(`#dco-roll-${i}`).textContent = o.roll;
    $(`#dco-diff-${i}`).textContent = dcSign(o.diff);
    $(`#dco-mul-${i}`).textContent = `×${(o.mod * o.dyn).toFixed(2)}`;
    $(`#dco-mul-${i}`).title = `level, crit, clashes, resistances ×${o.mod.toFixed(3)} · damage up ×${o.dyn.toFixed(2)}`;
    $(`#dco-dmg-${i}`).innerHTML = s.coins[i].w !== 1 ? `${o.dmg}<small> ${s.coins[i].w} targets</small>` : `${o.dmg}`;
  });
  const chip = (k, icon) => { const v = k === "True" ? 1 : t.R[k] ?? 1, [l, c] = RESIST(v); return `<span class="dcchip">${icon}<span class="${c}">${l}</span><small>×${v}</small></span>`; };
  const heads = s.coins.filter((c) => c.on).length;
  if ($("#dcdlv") && dc.dlv == null) $("#dcdlv").value = t.def;
  $("#dcres").innerHTML = `<div class="dctotal"><small>Total damage</small><b>${r.total}</b><span class="muted small">${heads} of ${s.coins.length} heads</span></div>
    <div class="dcrange"><span>All tails <b>${lo}</b></span><span>All heads <b>${hi}</b></span></div>
    <div class="dcchips">${chip(s.type, ico(`res_${s.type}`, "s20", s.type, s.type))}${chip(s.sin, sinIcon(s.sin, "s20"))}</div>
    <div class="muted small">Offense ${dc.lv}${u.level ? ` ${dcSign(u.level)}` : ""} vs defense ${t.def} → ${dcSign(diff0)}</div>`;
  $("#main").querySelectorAll("[data-flip]").forEach((b) => b.classList.toggle("on", s.coins[+b.dataset.flip].on));
}

function dcBind(pres, u) {
  const m = $("#main"), redraw = () => { dc.s = null; dcDraw(); };
  m.querySelectorAll("[data-up]").forEach((b) => b.onclick = () => { dc.up = +b.dataset.up; redraw(); });
  m.querySelectorAll("[data-ego]").forEach((b) => b.onclick = () => {
    const ego = b.dataset.ego === "1";
    if (ego === dc.ego) return;
    dc.back = { ...dc.back, [dc.ego]: [dc.id, dc.slot] };  // each kind keeps its last pick
    dc.ego = ego;
    [dc.id, dc.slot] = (dc.back || {})[ego] || [dcList()[0].id, 0];
    redraw();
  });
  m.querySelectorAll("[data-slot]").forEach((b) => b.onclick = () => { dc.slot = +b.dataset.slot; redraw(); });
  m.querySelectorAll("[data-pre]").forEach((b) => b.onclick = () => {
    const p = b.dataset.pre === "" ? null : pres[+b.dataset.pre];
    dc.s = p ? dcFromPreset(p, u) : dcFromGame(u); dc.pre = p ? p.key : "";
    if (p && !dc.en && p.v.setup.resistances) dc.res = { ...p.v.setup.resistances };  // the target stays; a dummy takes his resistances
    dcDraw();
  });
  $("#dclv").oninput = (e) => { $("#dclvn").textContent = e.target.value; dc.lv = +e.target.value; dcUpdate(); };
  if ($("#dcbback")) $("#dcbback").onclick = () => { dc.manual = 0; dcDraw(); };
  if ($("#dcdlv")) $("#dcdlv").oninput = (e) => { dc.dlv = dcNum(e.target.value); dcUpdate(); };
  if ($("#dcev")) $("#dcev").onchange = (e) => { dc.ev = +e.target.value; dcDraw(); };
  m.querySelectorAll("[data-res]").forEach((i) => i.oninput = () => { dc.res[i.dataset.res] = dcNum(i.value); dcUpdate(); });
  m.querySelectorAll("[data-g]").forEach((i) => i.oninput = () => { dc.s[i.dataset.g] = dcNum(i.value); dcUpdate(); });
  m.querySelectorAll("[data-all]").forEach((b) => b.onclick = () => { dc.s.coins.forEach((c) => { c.on = b.dataset.all === "1"; }); dcUpdate(); });
  if ($("#dcbonus")) {
    $("#dcbonus").onclick = () => { dc.s.bon.push({ kind: "Flat", target: "True", values: dc.s.coins.map(() => 0) }); dcTable(); dcBindTable(); dcUpdate(); };
    dcBindTable();
  }
  m.querySelectorAll("[data-unit]").forEach((el) => el.onclick = () => openUnit(+el.dataset.unit));
  m.querySelectorAll(".cqpick").forEach((p) => {
    const inp = p.querySelector("input.cqin"), list = p.querySelector(".cqlist"), foe = p.dataset.side === "b";
    inp.oninput = () => {
      const w = sxWords(inp.value), hit = (s) => { const t = sxNorm(s); return w.every((q) => t.includes(q)); };
      if (foe) {
        const found = w.length ? ENEMIES.list.filter((e) => e.variants && e.variants.length && hit(`${e.name} ${sxEn(e.name)}`)) : [];
        list.innerHTML = `<div data-en="0"><span class="dcdummy">🎯</span><span>Training dummy</span></div>` + found.map((e) => `<div data-en="${e.id}">${enTileImg(e)}<span>${esc(e.name)} <i>${esc(e.label || "")}</i></span></div>`).join("");
        list.querySelectorAll("[data-en]").forEach((d) => d.onmousedown = () => { dc.en = +d.dataset.en; dc.ev = 0; dcDraw(); });
      } else {
        const found = w.length ? dcList().filter((x) => hit(`${x.title || x.name} ${x.sinnerName} ${sxEn(x.title || x.name)} ${sxEn(x.sinnerName)}`)) : [];
        list.innerHTML = found.map((x) => `<div data-id="${x.id}"><img loading="lazy" src="${x.pics.thumb}" alt=""><span>${esc(x.title || x.name)} <i>${esc(x.sinnerName)}</i></span></div>`).join("");
        list.querySelectorAll("[data-id]").forEach((d) => d.onmousedown = () => { dc.id = +d.dataset.id; dc.slot = 0; redraw(); });
      }
    };
    inp.onfocus = () => sxBack().then(() => inp.oninput());
    inp.onblur = () => setTimeout(() => { list.innerHTML = ""; }, 150);
    list.onmousedown = (e) => e.preventDefault();  // scrollbar keeps focus
  });
}
function dcBindTable() {
  const m = $("#dctab"), s = dc.s;
  m.querySelectorAll("[data-flip]").forEach((b) => b.onclick = () => { const c = s.coins[+b.dataset.flip]; c.on = !c.on; dcUpdate(); });
  m.querySelectorAll("input[data-k]").forEach((i) => i[i.type === "checkbox" ? "onchange" : "oninput"] = () => {
    const c = s.coins[+i.dataset.i]; c[i.dataset.k] = i.type === "checkbox" ? i.checked : dcNum(i.value); dcUpdate();
  });
  m.querySelectorAll("input[data-b]").forEach((i) => i.oninput = () => { s.bon[+i.dataset.b].values[+i.dataset.i] = dcNum(i.value); dcUpdate(); });
  m.querySelectorAll("[data-bk]").forEach((x) => x.onchange = () => { s.bon[+x.dataset.bk].kind = x.value; dcUpdate(); });
  m.querySelectorAll("[data-bt]").forEach((x) => x.onchange = () => { s.bon[+x.dataset.bt].target = x.value; dcUpdate(); });
  m.querySelectorAll("[data-bx]").forEach((x) => x.onclick = () => { s.bon.splice(+x.dataset.bx, 1); dcTable(); dcBindTable(); dcUpdate(); });
}

// ---- Breakdown: where the damage comes from. Hand-made models by skill id (Uptie IV texts)
const dcbK = (k) => fmtDesc(`[${k}]`);
const dcbText = (t) => fmtDesc(String(t).replace(/\{hl\}/g, `<style="highlight">`).replace(/\{\/hl\}/g, "</style>"));
// statuses on the target through the skill: "Inflict X" adds Potency, "+X Count" adds Count; Sinking and Rupture lose 1 Count on every hit
function dcbSim(start, coins) {
  const t = {}, log = new Map();
  const note = (lab, k, what, x) => { const id = lab + "|" + k, e = log.get(id) || { lab, k, p: 0, c: 0 }; e[what] += x; log.set(id, e); };
  for (const [k, p, c] of start) if (p > 0 && c > 0) t[k] = { p, c };
  const f = {
    addP: (k, x, lab) => { if (!x) return; if (!t[k]) { t[k] = { p: 0, c: 1 }; note(lab, k, "c", 1); } t[k].p += x; note(lab, k, "p", x); },
    addC: (k, x, lab) => { if (!x) return; if (!t[k]) { t[k] = { p: 1, c: 0 }; note(lab, k, "p", 1); } t[k].c += x; note(lab, k, "c", x); },
    add: (k, p, c, lab) => { if (!t[k] && p && c) { t[k] = { p, c }; note(lab, k, "p", p); note(lab, k, "c", c); return; } f.addP(k, p, lab); f.addC(k, c, lab); },  // both at once: as given
    cut: (k, lab) => { if (!t[k]) return; t[k].c--; note(lab, k, "c", -1); if (t[k].c <= 0) { note("Ran out (Count 0)", k, "p", -t[k].p); delete t[k]; } },  // Count 0 takes Potency
    dec: (k, x, lab) => { for (let i = 0; i < x; i++) f.cut(k, lab); }, t };
  const dmg = [];
  coins.forEach((c, i) => {
    if (c.pre) c.pre(f);
    dmg[i] = 0;
    for (const k of ["Sinking", "Burst"]) if (t[k]) { dmg[i] += t[k].p; if (k === "Burst" && c.burst) c.burst(f, t[k].p); if (t[k]) f.cut(k, "By hits"); }  // the hit sets them off
    if (c.post) c.post(f);
  });
  return { t, dmg, log: [...log.values()] };
}

// ids: fight-state sliders ("… on target" = target side), skill id → model; models: rows (stack skill / pass), mods() = their numbers, target() = the dummy
let DCB = null;
function dcbData() {
  if (DCB) return DCB;
  const K = dcbK, sin = (x) => sinIcon(x), sinI = (...s) => s.map(sin).join(""), min = Math.min, fl = Math.floor;
  const SK = (s) => s.sink > 0 && s.sc > 0 ? s.sink : 0;  // "X Sinking" = Potency
  const ids = {
    10315: { sliders: [["pres", K("ChargeNoirAlly") + " Potency on self", 0, 6], ["trem", K("Vibration") + " Potency on target", 0, 20], ["tc", K("Vibration") + " Count on target", 0, 20],
      ["nail", K("NoirNailDonQuixote") + " on target", 0, 10], ["res", sin("Sloth") + " Highest Resonance", 0, 4]],
      start: { pres: 6, trem: 12, tc: 6, nail: 10, res: 4 }, pairs: [["trem", "tc"]], skills: { 1031503: "NOIR" }, model: () => "NOIR" },
    10913: { sp: (s) => s.sp >= 0 ? ["BlessingAlly", `· ${min(5, fl(s.sp / 8))} ${K("ProtectiveSword")}`] : ["DespairAlly", `· ${min(5, fl(-s.sp / 8))} ${K("PenetratingSword")}`],
      sliders: [["sink", K("Sinking") + " Potency on target", 0, 20], ["sc", K("Sinking") + " Count on target", 0, 20], ["tears", K("BlackTearsAlly") + " on self", 0, 20], ["ts", K("SwordCutwithTear") + " on self", 0, 3]],
      start: { sp: -45, sink: 12, sc: 6, tears: 20, ts: 3 }, pairs: [["sink", "sc"]], skills: { 1091303: "ROD_B", 1091307: "ROD_D" }, model: (s) => s.sp >= 0 ? "ROD_B" : "ROD_D" },
    10312: { sp: (s) => s.sp >= 0 ? ["MagicalGirlAppear", ""] : ["NoVillain", ""],
      sliders: [["lhp", K("ThePowerOfLoveAndHate") + " Potency", 0, 5], ["lhc", K("ThePowerOfLoveAndHate") + " Count", 0, 20], ["arc", K("ArcanaQueenOfHate") + " on self", 0, 3], ["hys", K("HystericGauge") + " on self", 0, 3]],
      start: { sp: 45, lhp: 5, lhc: 20, arc: 3, hys: 3, allT: 0 }, pairs: [["lhp", "lhc"]], skills: { 1031203: "DON_M", 1031207: "DON_R" }, model: (s) => s.sp >= 0 ? "DON_M" : "DON_R" },
  };
  const models = {
    NOIR: {
      bat: { key: "S3-1", alt: 0, set: { pres: 6, trem: 12, nail: 10, res: 4 }, note: "" }, flatSin: "Sloth",
      rows: [
        { k: "R1", stack: "skill", title: `3+ ${K("ChargeNoirAlly")} Potency`, from: "S3", fx: ["Coin Power +1", "damage +40%"], need: (s) => s.pres >= 3 ? "" : `needs Potency 3+ (now ${s.pres})`,
          text: "[WhenUse] At 3+ [ChargeNoirAlly] Potency, Coin Power +1 and deal +{hl}40{/hl}% damage" },
        { k: "R2", stack: "skill", title: `${K("Vibration")} + ${K("NoirNailDonQuixote")} on target`, from: "S3", fx: ["Coin Power +1 per 6", "max +2"], need: (s) => s.trem + s.nail >= 6 ? "" : `needs 6+ (now ${s.trem + s.nail})`,
          text: "[WhenUse] {hl}Coin Power +1 for every 6 ([Vibration] Potency + [NoirNailDonQuixote]) on target (max 2){/hl}" },
        { k: "R3", stack: "skill", title: K("OathFieldDonQuixote"), from: "S3 gives 3 at Combat Start", fx: ["enemy takes +20% damage", `Offense Level +(${K("ChargeNoirAlly")} Potency / 3), max +2`], need: () => "",
          text: "[StartBattle] Gain 3 [OathFieldDonQuixote] (once per turn)\n\n[OathFieldDonQuixote]:\n· Offense Level +(Preservation Potency on Don Quixote / 3) (rounded down; max 2)\n· Take +10% damage from Skills that consume Charge Count or Unique Charge (from \"Le Noir\" allied Identities' Skills, take +20% damage instead)" },
        { k: "R4", stack: "skill", title: `2 ${K("AttackUp")}`, from: "S3 gives at Combat Start", fx: ["Offense Level +2"], need: () => "",
          text: "[StartBattle] Apply 2 [AttackUp] and 2 [DefenseUp] on self and 1 other \"Le Noir\" allied Identity with the fastest Speed (once per turn)" },
        { k: "R5", stack: "skill", title: `${sin("Sloth")} Resonance`, from: "S3", fx: ["final coin Final Power +1 per highest Resonance, max +4"], need: (s) => s.res ? "" : "no Resonance",
          text: "[BeforeAttack] The final Coin gains Final Power +1 for every highest Reson. (max 4)" },
        { k: "R6", stack: "skill", tint: "sloth", title: `2× ${K("VibrationExplosion")} on coin III`, from: "S3 coin III",
          fx: [`<span class="dcbsloth">+1 Sloth damage per ${K("NoirNailDonQuixote")}, max 10</span>`, "once per Skill, so the 2nd Burst adds none"],
          lines: ["1st: [OnSucceedAttack] Trigger [VibrationExplosion]; then, reduce target's [Vibration] Count by 1",
            "2nd: [OnSucceedAttack] If target has 3+ [NoirNailDonQuixote], trigger [VibrationExplosion]; then, reduce target's [Vibration] Count by 1"],
          need: (s) => !s.trem ? "needs Tremor on target" : !s.nail ? "needs Promised Nail" : "",
          text: "[NoirNailDonQuixote]:\n- Upon Tremor Burst due to Skill effects, take 1 Sloth damage for every Stack (max 10; once per Skill)" },
        { k: "R7", stack: "skill", tint: "sloth", title: `${K("VibrationFocusing")} on coin III`, from: "S3 coin III turns Tremor into Focus",
          fx: [`<span class="dcbsloth">each Burst: Sloth damage (60 + ${K("ChargeNoirAlly")} Potency × 8)% of Tremor Potency, max 120%</span>`], need: (s) => !s.trem ? "needs Tremor on target" : "",
          text: "[VibrationFocusing]:\n- On Tremor Burst, take Sloth Damage equal to (60 + sum of Charge Potency or Unique Charge on the attacker x 8)% of Tremor Potency, and reduce the Count by 1 (max 120%)" },
        { k: "P4", stack: "pass", pn: "P4", title: "Obsidian Covenant", from: sinI("Pride", "Envy", "Sloth") + " owned", fx: [`damage +(${K("ChargeNoirAlly")} Potency × 6)%, max 30%`], need: (s) => s.pres ? "" : "needs Potency",
          text: "This unit's Base Attack Skills deal +([ChargeNoirAlly] Potency on self x 6)% damage against the main target (max 30%)" },
        { k: "P3", stack: "pass", pn: "P3", title: "The Lord's Will and Values Be With Us…", from: "always on", fx: [`final coin Final Power +(${K("ChargeNoirAlly")} Potency + ${K("NoirNailDonQuixote")} / 2), max +5`], need: (s) => s.pres || s.nail > 1 ? "" : "needs Potency or Nails",
          text: "On the final Coin Start of a Base Skill, the said Coin gains Final Power +([ChargeNoirAlly] Potency on self + ([NoirNailDonQuixote] on target / 2)) (max 5)" },
      ],
      mods: (s, o) => {
        const p3 = s.pres >= 3 && o.R1;
        return { cp: (o.R2 ? min(2, fl((s.trem + s.nail) / 6)) : 0) + (p3 ? 1 : 0), last: (o.R5 ? min(4, s.res) : 0) + (o.P3 ? min(5, s.pres + fl(s.nail / 2)) : 0),
          dyn: (p3 ? 40 : 0) + (o.P4 ? min(30, s.pres * 6) : 0) + (o.R3 ? 20 : 0), diff: (o.R4 ? 2 : 0) + (o.R3 ? min(2, fl(s.pres / 3)) : 0),
          flatLast: (o.R6 && s.trem > 0 ? min(10, s.nail) : 0) + (o.R7 && s.trem > 0 ? (s.nail + 1 >= 3 ? 2 : 1) * fl((s.trem + 4) * min(120, 60 + 8 * s.pres) / 100) : 0) };
      },
      target: (s) => {
        const TB = K("VibrationExplosion");
        const T = dcbSim([["Vibration", s.trem, s.tc]], [{ post: (f) => f.addP("Vibration", 4, "Coin I") }, { post: (f) => f.addC("Vibration", 3, "Coin II") },
          { post: (f) => { f.cut("Vibration", TB); if (s.nail + 1 >= 3) f.cut("Vibration", TB); } }]);
        return { log: T.log, st: [["Vibration", { p: s.trem, c: s.tc }, T.t.Vibration], ["NoirNailDonQuixote", s.nail, s.nail + 1]],
          extra: [`<b>Coin I</b> ${K("NoirNailDonQuixote")} +1`, `<b>Coin III</b> ${K("Vibration")} turns into ${K("VibrationFocusing")}`, `<b>${K("OathFieldDonQuixote")}</b> Speed −1`] };
      },
      nodmg: [`<span class="dcbpn">P1</span> <b>Malleus Promissionis</b>: gives ${K("ChargeNoirAlly")}, which feeds the rows above`,
        `<span class="dcbpn">P3</span> <b>The Lord's Will…</b> with ${K("OathFieldDonQuixote")}: Clash Power +3 (clash only)`,
        `<span class="dcbpn">P2</span> <b>Mission of Conservation</b>: ${K("NoirShieldUpDonQuixote")} (shield, Unbreakable Coins)`,
        `<span class="dcbpn">P4</span> <b>Obsidian Covenant</b>: 2 ${K("Agility")} next turn`,
        `<span class="dcbpn">S</span> <b>Formation Conservation</b> (support): allies take up to −10% damage`],
    },
    ROD_D: {
      bat: { key: "S3-2", alt: 3, set: { sp: -45, sink: 12, tears: 20, ts: 3 }, note: "His preset “3”: he counts +5% where P4 gives 2 Damage Up = +20% (wiki: +10% per Count), and skips its +1 Power Up." },
      stn: "Gloom", stk: "Sinking",
      rows: [
        { k: "D1", stack: "skill", title: `${K("Sinking")} on target`, from: "S3", fx: ["Final Power +1 per 3 Sinking Potency, max +4"], need: (s) => SK(s) >= 3 ? "" : `needs 3+ (now ${SK(s)})`,
          text: "Final Power +1 for every 3 [Sinking] on target (max {hl}4{/hl})" },
        { k: "D2", stack: "skill", title: `10+ ${K("BlackTearsAlly")}`, from: "S3, consumes up to 20", fx: ["damage +(consumed × 3)%", "Base Power +1 per 5 consumed"], need: (s) => s.tears >= 10 ? "" : `needs 10+ (now ${s.tears})`,
          text: "[WhenUse] At 10+ [BlackTearsAlly], consume up to 20 [BlackTearsAlly]\n- Deal +(Stack consumed x 3)% damage\n{hl}- Base Power +1 for every 5 Stack consumed{/hl}" },
        { k: "D3", stack: "skill", title: K("PenetratingSword"), from: `${K("DespairAlly")}: 1 per −8 SP`, fx: ["Offense Level +1 per Sword, max +5"], need: (s) => s.sp <= -8 ? "" : "needs SP −8 or lower",
          text: "[DespairAlly]: Turn Start: gain 1 [PenetratingSword] for every -8 SP (max 5)\n\n[PenetratingSword]: Turn Start: gain 1 Offense Level Up for every Stack (max 5)" },
        { k: "D4", stack: "skill", title: K("SwordCutwithTear"), from: "Guard / Counter give it at Turn End", fx: ["damage +10% per stack, max 30%", `with ${K("DespairAlly")}: Pierce Power Up +1 per stack`], need: (s) => s.ts ? "" : "needs Tear-sharpened",
          text: "[SwordCutwithTear]:\n- Base Attack Skills deal +(Stack x 10)% damage (max 30%)\n- If this unit has Despair, gain Pierce Power Up by the effect's Stack at Turn Start" },
        { k: "D5", stack: "skill", title: "Coin III Reuse", from: "S3 coin III", fx: ["one more hit after it consumes Tear-sharpened"], need: (s, o) => s.ts < 3 ? "needs 3 Tear-sharpened" : !o.P3 ? "needs P3 on (it consumes them)" : "",
          text: "Coin III: [OnSucceedAttack] If this Coin consumed [SwordCutwithTear], Reuse Coin once (once per turn)" },
        { k: "P3", stack: "pass", pn: "P3", title: "Break, Tear, and Pierce", from: "always on", fx: [`at 3 ${K("SwordCutwithTear")}: final coin damage +50%`], need: (s) => s.ts >= 3 ? "" : "needs 3 Tear-sharpened",
          text: "If this unit has 3 [SwordCutwithTear]: before hitting an enemy with the final Coin of a Base Attack Skill, consume all [SwordCutwithTear] to inflict 3 [Sinking] and +3 [Sinking] Count, and deal +50% damage with that Coin" },
        { k: "P4", stack: "pass", pn: "P4", title: "Magical Girl of Justice / Knight of Despair", from: sinI("Gloom", "Pride") + " 3 each, owned",
          fx: [`${K("DespairAlly")}: damage +(−SP / 2)%, max 20%`, `3+ Swords: 1 ${K("AttackDmgUp")}, 5 Swords: 2 (+10% damage each)`, `5 Swords: 1 ${K("ResultEnhancement")} (Final Power +1)`], need: (s) => s.sp < 0 ? "" : "needs Despair (SP below 0)",
          text: "When in [DespairAlly] state...\n- Deal +(-SP/2)% damage with Base Skills (max 20%)\n{hl}- Combat Start: at 3+ [PenetratingSword] gain 1 [AttackDmgUp]\n- Combat Start: at 5 [PenetratingSword], gain 2 [AttackDmgUp] and 1 [ResultEnhancement] instead{/hl}" },
        { k: "PS", stack: "pass", pn: "S", title: "For All Those Who Despair...", from: sinI("Gloom") + " 5 · support, if he deploys first", fx: ["−15 SP: Final Power +1", "−30 SP: damage +15% and Final Power +1"], need: (s) => s.sp <= -15 ? "" : "needs SP −15 or lower",
          text: "Combat Start: applies to the ally with the earliest Deployment order\n\nAt -15 or less SP, +1 Final Power to Minus Coin Skills\n{hl}At -30 or less SP, +15% damage and +1 Final Power to Minus Coin Skills instead{/hl}" },
      ],
      mods: (s, o) => {
        const ps = s.sp < 0 ? min(5, fl(-s.sp / 8)) : 0, cons = s.tears >= 10 ? min(20, s.tears) : 0, three = s.ts >= 3 && o.P3;
        return { base: (o.D1 ? min(4, fl(SK(s) / 3)) : 0) + (o.D2 ? fl(cons / 5) : 0) + (o.D4 ? s.ts : 0) + (o.P4 && ps >= 5 ? 1 : 0) + (o.PS && s.sp <= -15 ? 1 : 0),
          dyn: (o.D4 ? min(30, 10 * s.ts) : 0) + (o.P4 && s.sp < 0 ? min(20, -s.sp / 2) + (ps >= 5 ? 20 : ps >= 3 ? 10 : 0) : 0) + (o.PS && s.sp <= -30 ? 15 : 0) + (o.D2 ? cons * 3 : 0),
          diff: o.D3 ? ps : 0, reuse: three && o.D5, lastDyn: three ? 50 : 0 };
      },
      target: (s, o) => {
        let sw = s.sp < 0 ? min(5, fl(-s.sp / 8)) : 0;
        const three = s.ts >= 3 && o.P3, n = 3 + (three && o.D5 ? 1 : 0), coins = [], PS = K("PenetratingSword"), TS = `P3 · 3 ${K("SwordCutwithTear")}`;
        for (let i = 0; i < n; i++) coins.push({
          pre: (f) => { if (o.P3 && i === 0 && sw) { f.addP("Sinking", 1, PS); sw--; } if (o.P3 && i === 2 && sw >= 2) { f.addP("Sinking", sw, PS); sw = 0; } if (three && i === 2) { f.addP("Sinking", 3, TS); f.addC("Sinking", 3, TS); } },
          post: (f) => { if (i === 0 && s.sp < 0) f.addC("Sinking", 1 + min(2, fl(-s.sp / 20)), `${K("DespairAlly")} · first hit`); if (i === 1) f.addC("Sinking", 4, "Coin II"); if (i === 2) f.addP("Sinking", 5, "Coin III"); } });
        const R = dcbSim([["Sinking", s.sink, s.sc]], coins);
        return { dmg: R.dmg, log: R.log, st: [["Sinking", { p: s.sink, c: s.sc }, R.t.Sinking]], extra: [] };
      },
      nodmg: [`<span class="dcbpn">P1</span> <b>E.G.O Gear Sync</b>: SP below 0 gives ${K("DespairAlly")} and Minus Coin skills`,
        `<span class="dcbpn">P2</span> <b>Whispers of the Betrayed Knight</b>: SP doesn't drop below −40 from his own effects`,
        `Minus Coins: the best result is all tails, so coin power doesn't matter here`],
    },
    ROD_B: {
      bat: { key: "S3-1", alt: 3, set: { sp: 45, sink: 12, tears: 20, ts: 0 }, note: "His preset has no Tear-sharpened." },
      stn: "Gloom", stk: "Sinking",
      rows: [
        { k: "B1", stack: "skill", title: `6+ ${K("Sinking")} on target`, from: "S3", fx: ["Coin Power +1 at 6+ Sinking Potency"], need: (s) => SK(s) >= 6 ? "" : `needs 6+ (now ${SK(s)})`,
          text: "If target has 6+ [Sinking], Coin Power +1" },
        { k: "B2", stack: "skill", title: `10+ ${K("BlackTearsAlly")}`, from: "S3, consumes up to 20", fx: ["damage +(consumed × 1.5)%", "Base Power +1 per 5 consumed"], need: (s) => s.tears >= 10 ? "" : `needs 10+ (now ${s.tears})`,
          text: "[WhenUse] At 10+ [BlackTearsAlly], consume up to 20 [BlackTearsAlly]\n- Deal +(Stack consumed x 1.5)% damage\n{hl}- Base Power +1 for every 5 Stack consumed{/hl}" },
        { k: "B3", stack: "skill", title: `Coin III with ${K("SwordCutwithTear")}`, from: "S3 coin III", fx: ["coin III damage +20%"], need: (s) => s.ts ? "" : "needs Tear-sharpened",
          text: "Coin III: {hl}If this unit has [SwordCutwithTear], or consumed it with this Coin, deal +20% damage{/hl}" },
        { k: "B4", stack: "skill", title: K("SwordCutwithTear"), from: "Guard / Counter give it at Turn End", fx: ["damage +10% per stack, max 30%"], need: (s) => s.ts ? "" : "needs Tear-sharpened",
          text: "[SwordCutwithTear]:\n- Base Attack Skills deal +(Stack x 10)% damage (max 30%)\n- If this unit has Blessing, gain Clash Power Up by the effect's Stack at Turn Start" },
        { k: "P3", stack: "pass", pn: "P3", title: "Break, Tear, and Pierce", from: "always on", fx: [`at 3 ${K("SwordCutwithTear")}: final coin damage +50%`], need: (s) => s.ts >= 3 ? "" : "needs 3 Tear-sharpened",
          text: "If this unit has 3 [SwordCutwithTear]: before hitting an enemy with the final Coin of a Base Attack Skill, consume all [SwordCutwithTear] to inflict 3 [Sinking] and +3 [Sinking] Count, and deal +50% damage with that Coin" },
      ],
      mods: (s, o) => {
        const cons = s.tears >= 10 ? min(20, s.tears) : 0;
        return { base: o.B2 ? fl(cons / 5) : 0, cp: o.B1 && SK(s) >= 6 ? 1 : 0, dyn: (o.B4 ? min(30, 10 * s.ts) : 0) + (o.B2 ? cons * 1.5 : 0),
          lastDyn: (o.B3 && s.ts ? 20 : 0) + (o.P3 && s.ts >= 3 ? 50 : 0) };
      },
      target: (s, o) => {
        const prot = min(5, fl(Math.max(0, s.sp) / 8)), three = s.ts >= 3 && o.P3, TS = `P3 · 3 ${K("SwordCutwithTear")}`;
        const coins = [0, 1, 2].map((i) => ({ pre: (f) => { if (three && i === 2) { f.addP("Sinking", 3, TS); f.addC("Sinking", 3, TS); } },
          post: (f) => { if (i === 1) f.addC("Sinking", 3, "Coin II"); if (i === 2) f.addP("Sinking", prot, `Coin III · ${prot} ${K("ProtectiveSword")}`); } }));
        const R = dcbSim([["Sinking", s.sink, s.sc]], coins);
        return { dmg: R.dmg, log: R.log, st: [["Sinking", { p: s.sink, c: s.sc }, R.t.Sinking]], extra: [`<b>${K("BlessingAlly")}</b> 2 ${K("Sinking")} when a Clash ends (no Clash here)`] };
      },
      nodmg: [`${K("ProtectiveSword")} (1 per 8 SP): Defense Level and Clash Power`,
        `<span class="dcbpn">P4</span> <b>Magical Girl of Justice</b> with ${K("BlessingAlly")}: takes less damage, ${K("Protection")}, ${K("ParryingResultUp")}`,
        `${K("SwordCutwithTear")} with ${K("BlessingAlly")}: Clash Power Up`,
        `<span class="dcbpn">S</span> <b>For All Those Who Despair...</b>: Minus Coin skills only`],
    },
    DON_M: {
      bat: { key: "S3-1", alt: 0, set: { sp: 45, lhp: 5, lhc: 20, arc: 3, hys: 3 }, note: "" },
      stn: "Rupture", stk: "Burst",
      rows: [
        { k: "M2", stack: "skill", title: `2+ ${K("ThePowerOfLoveAndHate")} Potency`, from: "S3", fx: ["damage +(Potency × 25)%, max 125%", "Base Power +2"], need: (s) => s.lhp >= 2 ? "" : "needs Potency 2+",
          text: "[WhenUse] At 2+ [ThePowerOfLoveAndHate], deal +([ThePowerOfLoveAndHate] x {hl}25{/hl})% damage {hl}(max 125%){/hl}\n[WhenUse] At 2+ [ThePowerOfLoveAndHate], Base Power +{hl}2{/hl}" },
        { k: "M1", stack: "skill", title: `${K("ArcanaQueenOfHate")} on self`, from: "S3", fx: ["damage +30% per stack, max 90%"], need: (s) => s.arc ? "" : "needs Magical Arcana",
          text: "Deal +{hl}30{/hl}% damage for every [ArcanaQueenOfHate] on self (max {hl}90{/hl}%)" },
        { k: "M3", stack: "skill", title: `${K("ThePowerOfLoveAndHate")} Count`, from: "S3, consumes it", fx: ["Coin Power +1 per 5 consumed, max +4"], need: (s) => s.lhc >= 5 ? "" : "needs 5+ Count",
          text: "[WhenUse] Consume [ThePowerOfLoveAndHate] Count to gain Coin Power (Coin Power +1 for every 5 Count consumed, max {hl}4{/hl})" },
        { k: "M4", stack: "skill", title: K("MagicalGirlAppear"), from: "state at SP 0 or higher", fx: [`damage +(${K("ThePowerOfLoveAndHate")} Potency × 3)%, max 15%`], need: (s) => s.lhp ? "" : "needs Potency",
          text: "[MagicalGirlAppear]:\n- Base Attack Skills deal +3% damage for every Love/Hate on self (max 15%)" },
        { k: "M5", stack: "skill", title: `${K("ArcanaQueenOfHate")} (status)`, from: "the status itself", fx: ["damage +5% per stack"], need: (s) => s.arc ? "" : "needs Magical Arcana",
          text: "[ArcanaQueenOfHate]:\n- Max Stack: 3\n- Base Attack Skills deal +(Stack x 5)% damage" },
        { k: "M6", stack: "skill", title: `${K("VillainMark")} on target`, from: "S2 puts it", fx: ["takes +10% damage from Don Quixote"], need: () => "",
          text: "Skill 2 coin II: [OnSucceedAttack] Inflict [VillainMark] against the main target next turn\n\n[VillainMark]: Take +10% damage from Don Quixote" },
        { k: "P2", stack: "pass", pn: "P2", title: "Magical Girl of Love / Queen of Hatred", from: sinI("Envy") + " 4, Resonance", fx: [`damage +(${K("ThePowerOfLoveAndHate")} Potency × 2)%, max 10%`], need: (s) => s.lhp ? "" : "needs Potency",
          text: "Deal +2% damage for every [ThePowerOfLoveAndHate] (max 10%)\nCombat Start: gain 1 [ArcanaQueenOfHate]" },
      ],
      mods: (s, o) => ({ base: o.M2 && s.lhp >= 2 ? 2 : 0, cp: o.M3 ? min(4, fl(s.lhc / 5)) : 0,
        dyn: (o.M1 ? 30 * s.arc : 0) + (o.M2 && s.lhp >= 2 ? min(125, 25 * s.lhp) : 0) + (o.M4 ? min(15, 3 * s.lhp) : 0) + (o.M5 ? 5 * s.arc : 0) + (o.M6 ? 10 : 0) + (o.P2 ? min(10, 2 * s.lhp) : 0) }),
      target: (s, o) => {
        const T = dcbSim([], [{}, { post: (f) => f.addP("Burst", 2, "Coin II") }, { post: (f) => f.addP("Burst", 2, "Coin III") }]);
        return { dmg: T.dmg, log: T.log, st: [["Burst", { p: 0, c: 0 }, T.t.Burst], ...(o.M6 ? [["VillainMark", 1, 1]] : [])], extra: o.M6 ? [`<b>Skill 2</b> put ${K("VillainMark")} on it`] : [] };
      },
      nodmg: [`<span class="dcbpn">P1</span> <b>E.G.O Gear Sync</b>: SP 0 or higher gives ${K("MagicalGirlAppear")} and Plus Coin skills; +1 Potency per 10 Count consumed`,
        `<span class="dcbpn">P2</span> <b>Queen of Hatred</b>: +1 ${K("ArcanaQueenOfHate")} at Combat Start (feeds the rows above)`,
        `<span class="dcbpn">S</span> <b>Magical Power Charging Support</b>: ${K("Charge")} and healing`],
    },
    DON_R: {
      bat: { key: "S3-2", alt: 0, set: { sp: -45, lhp: 5, lhc: 20, arc: 3, hys: 3, allT: 1 }, note: "His preset is for 5 targets with Offense +4; the game data gives this skill +5." },
      stn: "Gloom", stk: "Sinking", multi: true,
      rows: [
        { k: "V1", stack: "skill", title: `${K("ThePowerOfLoveAndHate")} Potency`, from: "S3", fx: ["damage +30% per Potency, max 150%"], need: (s) => s.lhp ? "" : "needs Potency",
          text: "Deal +{hl}30{/hl}% damage for every [ThePowerOfLoveAndHate] on self (max {hl}150{/hl}%)" },
        { k: "V2", stack: "skill", title: `${K("ArcanaQueenOfHate")} + 3 ${K("HystericGauge")} consumed`, from: "S3", fx: ["Atk Weight +1 per Arcana (max 3), +1 at 3 Hysteria", "one target: damage +(20 × (Weight − 1))%, max 80%", "more targets: extra hits at −50%"],
          need: (s) => s.arc || s.hys >= 3 ? "" : "needs Arcana or 3 Hysteria",
          text: "[BeforeAttack] Consume all [ArcanaQueenOfHate] on self; {hl}gain +1 Atk Weight for every Stack consumed (max 3)\n- If this Skill consumed 3 [HystericGauge], gain +1 Atk Weight{/hl}\n[BeforeAttack] If this Skill only has a single target, {hl}deal +(20 x (Atk Weight - 1))% damage (max 80%){/hl}" },
        { k: "V5", stack: "skill", title: `${K("ArcanaQueenOfHate")} (status)`, from: "consumed Before Attack, BaTyANl still counts it", fx: ["damage +5% per stack"], need: (s) => s.arc ? "" : "needs Magical Arcana",
          text: "[ArcanaQueenOfHate]:\n- Base Attack Skills deal +(Stack x 5)% damage" },
        { k: "V6", stack: "skill", title: `${K("VillainMark")} on target`, from: "S2 puts it", fx: ["takes +10% damage from Don Quixote"], need: () => "",
          text: "[VillainMark]: Take +10% damage from Don Quixote" },
        { k: "P2", stack: "pass", pn: "P2", title: "Magical Girl of Love / Queen of Hatred", from: sinI("Envy") + " 4, Resonance", fx: [`damage +(${K("ThePowerOfLoveAndHate")} Potency × 2)%, max 10%`], need: (s) => s.lhp ? "" : "needs Potency",
          text: "Deal +2% damage for every [ThePowerOfLoveAndHate] (max 10%)\nCombat Start: gain 1 [ArcanaQueenOfHate]" },
      ],
      mods: (s, o) => {
        const w = o.V2 ? 1 + min(3, s.arc) + (s.hys >= 3 ? 1 : 0) : 1, many = s.allT && w > 1;
        return { dyn: (o.V1 ? min(150, 30 * s.lhp) : 0) + (many ? 0 : min(80, 20 * (w - 1))) + (o.V5 ? 5 * s.arc : 0) + (o.V6 ? 10 : 0) + (o.P2 ? min(10, 2 * s.lhp) : 0),
          targets: many ? w : 1, subDyn: -50 };
      },
      target: (s, o) => {
        const T = dcbSim([], [{}, { post: (f) => f.addP("Sinking", 2, "Coin II") }, { post: (f) => f.addP("Sinking", 2, "Coin III") }]);
        return { dmg: T.dmg, log: T.log, st: [["Sinking", { p: 0, c: 0 }, T.t.Sinking], ...(o.V6 ? [["VillainMark", 1, 1]] : [])], extra: o.V6 ? [`<b>Skill 2</b> put ${K("VillainMark")} on it`] : [] };
      },
      nodmg: [`${K("HystericGauge")} and ${K("ThePowerOfLoveAndHate")} Count consumed: Clash Power only`,
        `Cracked Coins: Base Power −6 each (none counted here)`,
        `Minus Coins: the best result is all tails`,
        `<span class="dcbpn">P1</span> <b>E.G.O Gear Sync</b>: SP below 0 gives ${K("NoVillain")} and Minus Coin skills`],
    },
  };
  return (DCB = { ids, models });
}

// the model of this skill (and its Identity's fight state): hand-made at full Uptie, otherwise read from the texts
function dcbFor(x, sk) {
  const d = dcbData(), id = d.ids[x.id], key = id && sk && id.skills[sk.id];
  dc.bd ||= {};
  if (!key || dc.up < (x.maxUp || 4)) {
    const a = sk && dcaModel(x, sk, dc.up);
    if (!a) return null;
    const b = dc.bd[`a${x.id}`] ||= { s: {}, on: {} };
    for (const k in a.id.start) if (!(k in b.s)) b.s[k] = a.id.start[k];
    return { id: a.id, key: a.key, m: a.m, b };
  }
  const b = dc.bd[x.id] ||= { s: { ...id.start }, on: {} }, m = d.models[key];
  if (id.model(b.s) !== key) Object.assign(b.s, m.bat.set);  // other state's skill
  return { id, key, m, b };
}

// ---- Automatic rows: skill, coin, passive and status texts read by a small grammar (condition, effect, "for every N", max); coin scripts give what lands on the target
const DCA_G = { neg: ["Negative effect types on target", 0, 10], spd: ["Speed over the target (negative: slower)", -10, 10], speed: ["Speed", 1, 20], res: ["Highest Resonance", 0, 10], sp: ["SP", -45, 45],
  mhp: ["Missing HP %", 0, 99], spT: ["Target SP", -45, 45], stag: ["Target is Staggered (1 yes)", 0, 1], ares: ["A-Resonance of the Skill's sin", 0, 10], fan: ["N Corp. Fanatics in the party", 0, 12], lost: ["HP lost in this Encounter, %", 0, 100], shT: ["Target has Shield (1 yes)", 0, 1], mhpT: ["Missing HP % of the target", 0, 99], crack: ["Cracked Coins", 0, 5], crit: ["Critical Hits (0 none, 1 every coin)", 0, 1], clash: ["Clash count (Clash won)", 0, 10], aw: ["excess Atk Weight", 0, 6], hit: ["Targets hit", 1, 6], ally: ["Allies that count", 0, 6], tm: ["Time Moratorium stacks on target", 0, 2],
  mark: ["Skill is marked (1 yes)", 0, 1], nodmg: ["Took no damage last turn (1 yes)", 0, 1], tnd: ["Target took no damage this turn (1 yes)", 0, 1], tpd: ["Target already took damage this turn (1 yes)", 0, 1], shS: ["Shield HP on self", 0, 100], tgtd: ["Skills targeting this unit", 0, 6], panic: ["Stack of the target's Panic-type effects", 0, 10] };
let DCA_HP = 1000;  // the target's HP: 1000 for the dummy, the game's for an enemy
let DCA_R = {};  // the target's resistances of the calc in progress
const DC_STAG = new Proxy({}, { get: () => 2 });  // resistances of a Staggered target
// plain status names in texts
const DCA_NAMES = { Burn: "Combustion", Bleed: "Laceration", Tremor: "Vibration", Rupture: "Burst", Sinking: "Sinking", Poise: "Breath", Charge: "Charge", Haste: "Agility", Fragile: "Vulnerable", Fanatic: "AssemblePersonality", Nails: "NailPersonality" };
const DCA_TYPES = /\b(Slash|Pierce|Blunt|Wrath|Lust|Sloth|Gluttony|Gloom|Pride|Envy)\s+(?:damage|Skills?)\b/i;
const DCA_EFF = { cp: "Coin Power", fp: "Final Power", bp: "Base Power", ol: "Offense Level", dyn: "damage", sub: "damage to the other targets", only: "only one kind of target", force: "every Reuse effect", take: "damage taken", reuse: "Reuse", aw: "Atk Weight", tm: "Time Moratorium: damage +15% per stack, as Sloth" };
const dcaPlain = (t) => String(t || "").replace(/<[^>]*>/g, "").replace(/\{\/?hl\}/g, "").replace(/\s+/g, " ").trim();
const dcaG = (k) => { const g = UNITS.glossary[k]; if (g && k === "KnowledgeExplored" && g.max == null) g.max = 3; return g || {}; };  // Insight = a Skill's rank, 1-3
// English texts (the page may show another language)
const dcaEn = (kind, id, v) => (UNITS.en && UNITS.en[kind][id]) ?? v;
const DCA = new Map();
// "on Don Quixote" = on this unit when it is that Sinner (Sanctum: "Preservation Potency on Don Quixote")
const DCA_SIN = ["Yi Sang", "Faust", "Don Quixote", "Ryōshū", "Meursault", "Hong Lu", "Heathcliff", "Ishmael", "Rodion", "Sinclair", "Outis", "Gregor"];
let dcaX = null, DCA_NM1 = null;
// status name before Potency / Count ("Preservation Potency", "Corpus Ingredient Potency"): the one this unit's texts name
const dcaNm1 = (w) => {
  if (!DCA_NM1) { DCA_NM1 = new Map(); for (const k of Object.keys(UNITS.glossary)) { const n = ((UNITS.en && UNITS.en.gn[k]) || UNITS.glossary[k].name || "").trim(); if (dcaG(k).st && /^\w+(?: \w+)*$/.test(n)) DCA_NM1.set(n, [...(DCA_NM1.get(n) || []), k]); } }
  const ks = DCA_NM1.get(w) || [], all = dcaX ? JSON.stringify([dcaX.skills, dcaX.passives]) : "";
  return DCA_NAMES[w] || ks.find((k) => all.includes(`[${k}]`)) || ks[0];
};

// "[Sinking] on target", "([Laceration] + [Sinking]) on the main target", "[X] Potency on self", "type of negative effect", "Stack consumed" → a term, or null
function dcaTerm(t, side, ctx = {}) {
  t = t.trim().replace(/[.,;]$/, "").replace(/\s+instead$/i, "");
  if (/^\(.*\)$/.test(t) && !/\)\s*[+x]/.test(t.slice(1, -1))) t = t.slice(1, -1).trim();  // "(sum of … on all targets)"
  t = t.replace(/^(?:value of |the |total |sum of |remaining )+/i, "").replace(/^(?:the )?target['’]s\s+/i, () => { side = "target"; return ""; }).replace(/\band both\b/gi, "and").replace(/(\]) (?:stage|value)s?$/i, "$1").replace(/\[(\w+)\] Potency ([+x×]) Count\b/gi, "[$1] Potency $2 [$1] Count").replace(/(^|[\s(])(Burn|Bleed|Tremor|Rupture|Sinking|Poise|Charge)\b(?!\])/g, (_, a, b) => `${a}[${DCA_NAMES[b]}]`);
  const sn = new RegExp(`^(.*?) on (${DCA_SIN.join("|")})$`).exec(t);
  if (sn) { if (!dcaX || DCA_SIN[dcaX.sinner - 1] !== sn[2]) return null; t = sn[1].replace(/^(\w+)(?= (?:Potency|Count)$)/, (w) => dcaNm1(w) ? `[${dcaNm1(w)}]` : w); side = "self"; }
  const sm = /^(.*?)\s+(?:on|by) (?:the )?(?:main )?(target|self|this unit|Slot|all (?:attack )?(?:targets|enemies))$/i.exec(t);
  if (sm) { t = sm[1].trim(); side = /target|enem|slot/i.test(sm[2]) ? "target" : "self"; }
  if (/^\(.*\)$/.test(t) && !/\)\s*[+x]/.test(t.slice(1, -1))) t = t.slice(1, -1).trim();
  if (/ \+ /.test(t)) { const parts = t.split(/ \+ /).map((p) => dcaTerm(p, side, ctx)); return parts.every(Boolean) ? { sum: parts } : null; }
  let m;
  if ((m = /^(.+?)\s*\/\s*(\d+)$/.exec(t)) && !/ \+ /.test(m[1]) && !/^\[\w+\]\s*\//.test(t)) { const q = dcaTerm(m[1], side, ctx); if (q && !q.sum && !q.prod) return { ...q, div: +m[2] }; }  // "([X] on target / 2)": rounded down
  if ((m = /^\[(\w+)\](?:\s+(Potency|Count|Stacks?))?$/i.exec(t)) && dcaG(m[1]).st) {
    const g = dcaG(m[1]);
    return { kw: m[1], side: side || (g.type === "neg" ? "target" : "self"), part: /^p/i.test(m[2] || "") ? "p" : /^c/i.test(m[2] || "") ? "c" : "s" };
  }
  if ((m = /^surplus \[(\w+)\](?: Count)? past (\d+) \[\w+\](?: Count)?$/i.exec(t)) && dcaG(m[1]).st) return { kw: m[1], side: side || "self", part: "s", sub: +m[2] };  // "surplus [X] past 20 [X]"
  if ((m = /^(.+?) - (\d+)$/.exec(t)) && !/\[/.test(m[2])) { const q = dcaTerm(m[1], side, ctx); if (q && !q.sum && !q.prod) return { ...q, sub: (q.sub || 0) + +m[2] }; }  // "Envy Reson. - 5"
  if (/^HP this unit (?:has )?cumulatively lost in this Encounter/i.test(t)) return { g: "lost" };
  if (/^['"]?N Corp\. Fanatics?['"]? present in the party$/i.test(t)) return { g: "fan" };
  if (/^(?:highest |\w+ )?A-Reson\.?$/i.test(t)) return { g: "ares" };
  if ((m = /^SP value below (-?\d+)$/i.exec(t))) return { ...(ctx.condTerm && ctx.condTerm.g ? ctx.condTerm : { g: "sp" }), abs: true, from: +m[1], dir: -1 };
  if (/types? of negative effects?/i.test(t)) return { g: "neg" };
  if (/^missing HP(?: percentage)?$/i.test(t)) return { g: side === "target" ? "mhpT" : "mhp" };
  if (/^(?:the )?target's missing HP$/i.test(t) || /^missing HP(?: percentage)? on (?:the )?(?:enemy|target)/i.test(t)) return { g: "mhpT" };
  if (/^Cracked Coins?$/i.test(t)) return { g: "crack" };
  if (/^(?:point of )?Speed difference$/i.test(t)) return { g: "spd" };
  if (/^Clash count$/i.test(t)) return { g: "clash" };
  if (/^(?:other |allied )?(?:ally|allies|Identity|Identities)\b/i.test(t)) return { g: "ally", what: t };  // "for every ally that …"
  if (/^excess Atk Weight beyond/i.test(t)) return { g: "aw" };
  if ((m = /^excess(?: \[(\w+)\])?(?: (?:Stacks?|Count|Potency))?$/i.exec(t)) && (m[1] ? dcaG(m[1]).st : ctx.condTerm && ctx.condTerm.kw && ctx.condN > 1)) {  // over the condition's number
    const b = m[1] ? { kw: m[1], side: "self", part: "s" } : ctx.condTerm;
    return { ...b, sub: ctx.condTerm && ctx.condTerm.kw === b.kw ? Math.max(0, ctx.condN - 1) : 0 };
  }
  if (/^Shield(?: HP)?$/i.test(t)) return { g: side === "target" ? "shT" : "shS" };
  if ((m = /^\[(\w+)\] and \[(\w+)\] (?:this unit )?(?:consumed|spent)(?: in this Encounter)?$/i.exec(t)) && dcaG(m[1]).st && dcaG(m[2]).st)
    return { sum: [{ kw: m[1], side: "self", part: "s" }, { kw: m[2], side: "self", part: "s" }] };
  if (/\] and \[/.test(t) && !/\b(?:consumed|spent)$/i.test(t)) { const parts = t.split(/ and /i).map((p) => dcaTerm(p, side, ctx)); if (parts.every(Boolean)) return { sum: parts }; }  // "[A] and [B] on target"
  if (/^highest Reson/i.test(t) || /^(?:\w+ )?Reson(?:ance)?\.?(?: (?:that includes|including) this Skill)?$/i.test(t)) return { g: "res" };  // "Envy Reson."
  if ((m = /^(-?)Target['’]s SP$/i.exec(t))) return { g: "spT", neg: !!m[1] };
  if ((m = /^(-?)SP$/.exec(t))) return { g: side === "target" ? "spT" : "sp", neg: !!m[1] };
  if (/^(Stack|Stacks|effect's Stack|the effect's Stack)$/i.test(t) && ctx.own) return { kw: ctx.own, side: ctx.ownSide || "self", part: "s" };
  if (/^(?:combined )?Stacks?$/i.test(t) && ctx.headTerm) return ctx.headTerm;  // "based on (…)": its count
  if (/^(?:Stacks?|value)$/i.test(t) && ctx.condTerm && !ctx.use) return ctx.condTerm;  // "At 100+ [X]: … for every value"
  if (/^(?:the )?(?:number of )?Skills? (?:that )?target(?:s|ing) this unit$/i.test(t)) return { g: "tgtd" };
  if (/^excess Resist(?:ance)?\.?$/i.test(t) && ctx.condTerm && ctx.condTerm.res) return { res: ctx.condTerm.res, scale: 10, sub: 10 };
  if (/^(?:this )?Skill['’]s Power$/i.test(t)) return { pow: true };  // the roll of each coin
  if (/^HP percentage the first Coin removed from the main target$/i.test(t)) return { hp1: true };  // first hit / the target's HP
  if ((m = /^(Slash|Pierce|Blunt)\s+Res(?:ist(?:ance)?)?\.?$/i.exec(t))) return { res: m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() };  // the target's resistance
  if ((m = /^both \[(\w+)\]$/i.exec(t)) && dcaG(m[1]).st === 2) return { sum: ["p", "c"].map((part) => ({ kw: m[1], side: side || "target", part })) };  // Potency + Count
  // "[X] Count consumed", "value consumed", "spent [X] Count", "excess [X] Count consumed past 10", "[X] Potency consumed due to this effect"
  const cs = t.replace(/^(consumed|spent) (\[\w+\])( (?:Count|Stacks?|Potency))?$/i, "$2$3 $1");
  if ((m = /^(?:excess )?(?:\[(\w+)\] )?(?:(Count|Stacks?|Potency|value) )?(?:additionally )?(?:about to be |that will be )?(?:consumed|spent|lost)( due to this effect| by this (?:Skill|Coin)(?: effect)?| for this Coin)?(?: past (\d+))?$/i.exec(cs)) && (m[1] || ctx.use)) {
    const kw = m[1] || ctx.use.kw, mine = ctx.use && ctx.use.kw === kw, cap = mine && !/by this (?:Skill|Coin)/.test(m[3] || "") ? ctx.use.cap : (ctx.spent || {})[kw] ?? null, sub = m[4] ? +m[4] : mine ? ctx.use.sub : 0;
    if (!dcaG(kw).st) return null;
    return { kw, side: "self", part: /count/i.test(m[2] || "") || (mine && ctx.use.c) ? "c" : "s", cap, ...(sub ? { sub } : {}) };
  }
  return null;
}
function dcaVal(q, s) {
  if (q.sum) return q.sum.reduce((a, p) => a + dcaVal(p, s), 0);
  if (q.prod) return q.prod.reduce((a, p) => a * dcaVal(p, s), 1);
  if (q.g) return (q.abs ? Math.abs((s[`g_${q.g}`] || 0) - (q.from || 0)) : (q.neg ? -1 : 1) * (s[`g_${q.g}`] || 0)) - (q.sub || 0);
  if (q.res) return Math.round((DCA_R[q.res] ?? 1) * (q.scale || 1) * 100) / 100 - (q.sub || 0);
  if (q.pow || q.hp1) return 0;  // per coin, in dcbCalc
  const base = `${q.side[0]}_${q.kw}`;
  let v;  // plain "[X]" = Potency (with Count)
  if (dcaG(q.kw).st === 2) { const p = s[`${base}_p`] || 0, c = s[`${base}_c`] || 0; v = q.part === "c" ? c : p > 0 && c > 0 ? p : 0; }
  else v = s[base] || 0;
  if (q.sub) v -= q.sub;
  if (q.div) v = Math.floor(v / q.div);
  return q.cap != null ? Math.min(q.cap, v) : v;
}
// status gives status by its own number
const DCA_CH = new Map();
function dcaChain(kw) {
  if (DCA_CH.has(kw)) return DCA_CH.get(kw).items;
  const items = [], lines = new Set(), g = dcaG(kw);
  for (const l of String(dcaEn("gl", kw, g.desc) || "").split("\n")) {
    const plain = dcaPlain(l);
    let t = dcaNames(plain).replace(/^[-•·]\s*/, "");
    // turn start/end only
    const pre = /^(Turn Start|Turn End|Combat Start|Before Attack)\s*:\s*/i.exec(t);
    if (pre) t = t.slice(pre[0].length);
    else if (/^(?:when|on|at the end|before|after|if|immediately|expires|skill|attack end|each)\b|\b(?:when hit|on hit|when taking|when losing|once per skill)\b/i.test(t)) continue;
    const at = /^at (?:(\d+)\+? |max )Stacks?\s*[:,]?\s*/i.exec(t);
    if (at) t = t.slice(at[0].length);
    for (const cl of t.split(";")) {
      const vb = /\b(gains?|inflicts?)\b/i.exec(cl);
      if (!vb || /\b(?:reduce|lose|consume)\b/i.test(cl.slice(0, vb.index))) continue;
      const rest = cl.slice(vb.index + vb[0].length), ev = /\b(?:for (?:every|each)|per) (?:(\d+) )?(?:Stacks?|Value|Potency)\b/i.exec(cl), src = /Potency/i.test(ev ? ev[0] : "") ? "p" : "s";
      const eq = /\b(?:equal to|by) (?:the |this )?(?:effect's )?(?:Stack|Value)\b|\bbased on the Stack\b/i.test(rest);
      const side = /^inflict/i.test(vb[1]) ? "target" : "self", clause = /\(max (\d+)[^)]*\)[^()]*$/i.exec(rest);
      for (const m of rest.matchAll(/(\+?\d+|\(\s*(?:Stack|Value)\s*(?:([x×*/])\s*(\d+))?\s*\))?\s*\[(\w+)\](?:\s+(Count|Potency))?(\s*\(max (\d+)[^)]*\))?/g)) {
        if (!dcaG(m[4]).st || m[4] === kw) continue;
        let v = 1, every = 1;
        if (m[1] && m[1][0] === "(") { if (m[2] === "/") every = +m[3]; else if (m[2]) v = +m[3]; }  // "(Stack x 2)", "(Stack / 4)"
        else if (m[1] && ev) { v = +m[1]; every = +(ev[1] || 1); }  // "1 [X] for every 4 Stacks"
        else if (!m[1] && (ev || eq)) every = ev ? +(ev[1] || 1) : 1;  // "[X] equal to Stack"
        else continue;
        items.push({ to: m[4], side, src, part: /^c/i.test(m[5] || "") ? "c" : dcaG(m[4]).st === 2 ? "p" : "s", v, every, cap: m[7] ? +m[7] : clause ? +clause[1] : undefined, at: at ? (at[1] ? +at[1] : g.max || 1) : undefined });
        lines.add(plain);
      }
    }
  }
  DCA_CH.set(kw, { items, lines });
  return items;
}
// the game's caps and starting numbers from a status text ("Potency : Base 0, Max 5", "Max Count: 20", "Max Stack: 5")
const DCA_CAP = new Map();
function dcaCaps(kw) {
  if (DCA_CAP.has(kw)) return DCA_CAP.get(kw);
  const d = dcaPlain(dcaEn("gl", kw, dcaG(kw).desc)), n = (re) => { const m = re.exec(d); return m ? +m[1] : undefined; };
  const pb = /Potency\s*:\s*Base (\d+),\s*Max (\d+)/i.exec(d), cb = /Count\s*:\s*Base (\d+),\s*Max (\d+)/i.exec(d);
  const out = { p: pb ? +pb[2] : n(/Max(?:imum)? Potency\s*:?\s*(\d+)/i), c: cb ? +cb[2] : n(/Max(?:imum)? Count\s*:?\s*(\d+)/i) ?? n(/Count can go up to (\d+)/i),
    s: n(/Max(?:imum)? Stacks?\s*:?\s*(\d+)/i) ?? dcaG(kw).max, c0: cb ? +cb[1] : 0, p0: !!pb && +pb[1] === 0, meter: !!(pb || cb) };
  DCA_CAP.set(kw, out);
  return out;
}
// a status at turn end, by its text: Count −N or gone, and whether it hits (Burn)
const DCA_TE = new Map();
function dcaTurnEnd(kw) {
  if (DCA_TE.has(kw)) return DCA_TE.get(kw);
  const d = dcaPlain(dcaEn("gl", kw, dcaG(kw).desc));
  const m = /(?:end of (?:the|each) turn|Turn End)\b[^]{0,90}?(?:reduce|lose|lowers?)\w*\s+(?:its |the )?(?:Count\s+)?(?:by\s+)?(\d+)/i.exec(d) || /Count lowers by (\d+) at the end of each turn/i.exec(d);
  const st = /Turn Start:\s*lose (\d+) (?:Stacks?|Count)/i.exec(d);
  const out = { dec: /Turn End:?\s*this effect expires/i.test(d) ? "all" : m ? +m[1] : 0, dmg: /end of the turn, take fixed damage/i.test(d),
    one: /\bfor (?:one|this) turn\b/i.test(d), start: st ? +st[1] : 0 };  // own side: gone at turn end; Turn Start loss
  DCA_TE.set(kw, out);
  return out;
}
// a status that hits on a Tremor Burst: "take 1 Sloth damage for every Stack (max 10; once per Skill)" or "Sloth damage equal to Tremor Potency on self"
const DCA_BH = new Map();
function dcaBurstHit(kw) {
  if (DCA_BH.has(kw)) return DCA_BH.get(kw);
  const d = dcaPlain(dcaEn("gl", kw, dcaG(kw).desc));
  const a = /Upon Tremor Burst[^,]*,\s*take (\d+) (\w+) damage for every Stack(?:\s*\(max (\d+)(;\s*once per Skill)?)?/i.exec(d);
  const b = /When Tremor Burst is triggered on this unit,.*?take (\w+) damage equal to Tremor Potency on self/i.exec(d);
  const cap = (w) => w[0].toUpperCase() + w.slice(1).toLowerCase();
  const out = a ? { per: +a[1], sin: cap(a[2]), cap: a[3] ? +a[3] : undefined, once: !!a[4] } : b ? { tremor: true, sin: cap(b[1]), lose: /Lose 1 Stack/i.test(d) ? 1 : 0 } : null;
  DCA_BH.set(kw, out);
  return out;
}
// Tremor - Focus: "On Tremor Burst, take Sloth Damage equal to (60 + sum of Charge Potency or Unique Charge on the attacker x 8)% of Tremor Potency … (max 120%)"
let DCA_FZ;
function dcaFocus() {
  if (DCA_FZ !== undefined) return DCA_FZ;
  const a = /On Tremor Burst, take (\w+) Damage equal to \((\d+) \+ sum of Charge Potency or Unique Charge on the attacker x (\d+)\)% of Tremor Potency.*?\(max (\d+)%\)/i.exec(dcaPlain(dcaEn("gl", "VibrationFocusing", dcaG("VibrationFocusing").desc) || ""));
  return (DCA_FZ = a ? { sin: a[1][0].toUpperCase() + a[1].slice(1).toLowerCase(), base: +a[2], per: +a[3], max: +a[4] } : null);
}
// a passive's price on inflicting [X] ("When inflicting [X] using Skill effects: At 12+ [Y] Count, inflict +1 more [X] and consume 4 [Y] Count;
// at fewer than 12 consume 2; at insufficient [Y] Count, does not inflict [X]") → { by, at, more, hi, lo }
function dcaInfPay(kw) {
  const ps = dcaX ? (dcaX.passives || []).map((p) => dcaEn("ps", p.id, p.desc) || "").join("\n") : "", e = kw.replace(/\W/g, "");
  const m = new RegExp(`When inflicting \\[${e}\\] using Skill effects:\\s*- At (\\d+)\\+ \\[(\\w+)\\] Count, inflict \\+(\\d+) more \\[${e}\\] and consume (\\d+) \\[\\2\\] Count\\s*- At fewer than \\1 \\[\\2\\] Count, consume (\\d+) \\[\\2\\] Count\\s*- At insufficient \\[\\2\\] Count, does not inflict \\[${e}\\]`, "i").exec(ps);
  return m ? { by: m[2], at: +m[1], more: +m[3], hi: +m[4], lo: +m[5] } : null;
}
// Charge Potency + Unique Charge Potency on self ([ChargeNoirAlly] …)
const dcaChargeP = (s) => Object.keys(s).filter((k) => /^s_Charge\w*_p$/.test(k)).reduce((a, k) => a + (s[k] || 0), 0);
// Deathrite (a stack-count debuff of Rupture): every Rupture trigger lowers it under its condition (+Rupture Count), at 0 Stack it hits for Rupture Potency
const DCA_DR = new Map();
function dcaDeath(kw) {
  if (DCA_DR.has(kw)) return DCA_DR.get(kw);
  const d = dcaPlain(dcaEn("gl", kw, dcaG(kw).desc)), m = /When getting Rupture triggered(?: by (.+?))?(?: while [^,]+)?,\s*lose 1 Stack(?:.*?gain \+(\d+) Rupture Count)?/i.exec(d);
  const out = m && /(\w+) damage equal to Rupture Potency/i.test(d) ? { by: m[1] || "", cnt: m[2] ? +m[2] : 0, sin: /(\w+) damage equal to Rupture Potency/i.exec(d)[1], base: dcaG(kw).max || 1 } : null;
  DCA_DR.set(kw, out);
  return out;
}
const dcaDeathOk = (d, s) => (!/10\+ Speed/i.test(d.by) || (s.g_speed || 0) >= 10) && (!/Critical Hit/i.test(d.by) || s.g_crit > 0);
function dcaLabel(q) {
  if (q.div) return [dcaLabel({ ...q, div: 0 }), q.div].join(" / ");
  if (q.sum) return q.sum.map(dcaLabel).join(" + ");
  if (q.prod) return q.prod.map(dcaLabel).join(" × ");
  if (q.res) return q.scale ? `${q.res} resistance over 1 (tenths)` : `target's ${q.res} resistance`;
  if (q.pow) return "this Skill's Power";
  if (q.hp1) return `% of the target's HP (${DCA_HP}) the first Coin removes`;
  if (q.g) return (q.abs ? `${DCA_G[q.g][0]} away from ${q.from || 0}` : (q.neg ? "−" : "") + DCA_G[q.g][0]) + (q.sub ? ` − ${q.sub}` : "");
  if (q.sub) return `surplus ${dcbK(q.kw)} past ${q.sub} on ${q.side}`;
  return `${dcbK(q.kw)}${q.part === "c" ? " Count" : q.part === "p" || dcaG(q.kw).st === 2 ? " Potency" : ""} on ${q.side}`;
}

// statuses written by name ("Blunt DMG Up", "Bleed Count") → [Keyword]; names of 2+ words, or the 7 sin statuses
let DCA_NM = null;
function dcaNames(t) { if (globalThis.NONAMES) return t;
  if (!DCA_NM) {
    const nm = (k) => (UNITS.en && UNITS.en.gn[k]) || (UNITS.glossary[k] || {}).name;
    const list = Object.keys(UNITS.glossary).filter((k) => dcaG(k).st && nm(k) && (/\s/.test(nm(k).trim()) || Object.values(DCA_NAMES).includes(k)) && !/[[\]()]/.test(nm(k)));
    const by = new Map();
    for (const k of list) { const n = nm(k).trim(); if (!by.has(n) || k === DCA_NAMES[n]) by.set(n, k); }
    for (const [n, k] of Object.entries(DCA_NAMES)) by.set(n, k);
    const esc2 = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    DCA_NM = { by, re: new RegExp(`(^|[^\\[\\w])(${[...by.keys()].sort((a, b) => b.length - a.length).map(esc2).join("|")})(?![\\w\\]])`, "g") };
  }
  // single sin-status words only before Count / Potency or after a number
  const named = t.replace(DCA_NM.re, (all, a, n, at, str) => {
    const k = DCA_NM.by.get(n);
    if (!/\s/.test(n) && !/^ (Count|Potency)\b/.test(str.slice(at + all.length)) && !/\d\+?\s*$/.test(str.slice(0, at + a.length))) return all;
    return `${a}[${k}]`;
  });
  return dcaG("KnowledgeExplored").st ? named.replace(/\bInsight\b/g, "[KnowledgeExplored]") : named;  // Insight = the status
}

// a condition ("If target has 6+ [Sinking]", "At 3+ [X] Potency", "If this unit's Speed is faster…") → { q, n } or { unk }
function dcaCond(c, ctx) {
  let m;
  const t = c.trim();
  if (/(?:2|two) or more targets|multiple targets|several targets/i.test(t)) return { q: { g: "hit" }, n: 2 };
  if (/\b(?:is|was|gets) defeated\b/i.test(t)) return { never: t, why: "only after a defeat" };
  // "- 3+ Stack: …" / "- At 4+ Potency: …" / "- At 5 Potency: …" under "based on (…)"
  if ((m = /^(?:at )?(\d+)(\+)? (?:combined )?(?:Stacks?|Potency|Count)$/i.exec(t)) && ctx.headTerm) return { q: ctx.headTerm, n: +m[1], ...(m[2] ? {} : { max: +m[1] }) };
  if ((m = /with a Coin that gains \[(\w+)\]$/i.exec(t))) return { coinGains: m[1] };
  if ((m = /^(?:if (?:the )?(?:main )?target has|if this unit has|at) less than (\d+) (.+)$/i.exec(t)) && !/%/.test(m[2])) {
    const q = dcaTerm(/target has/i.test(t) && !/ on /.test(m[2]) ? m[2] + " on target" : m[2], /target has/i.test(t) ? "target" : "self", ctx);
    if (q) return { q, n: +m[1], lt: true };
  }
  // "If the enemy has Bleed or 'Unique Bleed'" (status texts): the target has that status
  if ((m = /^if (?:the )?enemy has (\w+)(?: or '?Unique \1'?)?$/i.exec(t)) && DCA_NAMES[m[1]]) { const q = dcaTerm(`[${DCA_NAMES[m[1]]}] on target`, "target", ctx); if (q) return { q, n: 1 }; }
  if ((m = /^if (?:the )?(?:main )?target has (?:(\d+)\+ )?(.+)$/i.exec(t))) { const q = dcaTerm(/ on /.test(m[2]) ? m[2] : m[2] + " on target", "target", ctx); if (q) return { q, n: +(m[1] || 1) }; }
  if ((m = /^(?:if|when) (?:this unit|user) has (?:(\d+)\+? )?(.+)$/i.exec(t))) { const q = dcaTerm(m[2], "self", ctx); if (q) return { q, n: +(m[1] || 1) }; }
  if (/\bIdentit/i.test(t) && /target/i.test(t)) return { never: t };  // we hit enemies
  // HP % as missing HP
  const who = /\b(?:target|enemy|Core|opponent)\b/i.test(t) && !/\b(?:this unit|user)\b/i.test(t) ? "mhpT" : "mhp";
  if (/\bat max HP\b/i.test(t)) return { q: { g: who }, n: 1, lt: true };
  if ((m = /(\d+)%\s*(?:-|or less|or lower)\s*(?:current )?HP|HP (?:is )?(?:at )?(\d+)% or less/i.exec(t))) return { q: { g: who }, n: 100 - +(m[1] || m[2]) };
  if ((m = /(\d+)%\s*(?:\+|or more|or higher)\s*(?:current )?HP/i.exec(t))) return { q: { g: who }, n: 101 - +m[1], lt: true };
  if ((m = /(?:less than|below|under|lower than) (\d+)%(?: of)?(?: current| max)? HP|HP (?:is )?(?:below|under|less than) (\d+)%/i.exec(t))) return { q: { g: who }, n: 101 - +(m[1] || m[2]) };
  if ((m = /(?:more than|above|over|higher than) (\d+)%(?: of)?(?: current| max)? HP|HP (?:is )?(?:above|over) (\d+)%/i.exec(t))) return { q: { g: who }, n: 100 - +(m[1] || m[2]), lt: true };
  // Speed
  if ((m = /^(?:if|when) (?:this unit|the user|user)['’]s Speed is (faster|slower) than (?:the )?(?:main )?target['’]s(?: by (\d+)(?: or more|\+)?)?$/i.exec(t))) return /faster/i.test(m[1]) ? { q: { g: "spd" }, n: +(m[2] || 1) } : { q: { g: "spd" }, n: 1 - +(m[2] || 1), lt: true };
  if ((m = /^(?:if|when) (?:the )?(?:main )?target['’]s Speed is (faster|slower) than (?:this unit|the user|user)['’]s(?: by (\d+)(?: or more|\+)?)?$/i.exec(t))) return /slower/i.test(m[1]) ? { q: { g: "spd" }, n: +(m[2] || 1) } : { q: { g: "spd" }, n: 1 - +(m[2] || 1), lt: true };
  if ((m = /^if (?:this unit|the user|user)['’]s Speed is (\d+) or (slower|lower|faster|higher)$/i.exec(t))) return /slow|low/i.test(m[2]) ? { q: { g: "speed" }, n: +m[1] + 1, lt: true } : { q: { g: "speed" }, n: +m[1] };
  // SP
  if ((m = /\btargets?\b.*\b(?:SP is (?:below|lower than|less than)|less than) (-?\d+)(?: SP)?$/i.exec(t)) && !/%/.test(t)) return { q: { g: "spT" }, n: +m[1], lt: true };
  if ((m = /^when below (-?\d+) SP$/i.exec(t))) return { q: { g: "sp" }, n: +m[1], lt: true };
  // single target, target state
  if (/\b(?:just|only) (?:a |1 |one )?(?:single )?(?:enemy|target)\b|there is just a single (?:target|enemy)|attacking just \d+ target/i.test(t)) return { q: { g: "hit" }, n: 2, lt: true };
  if ((m = /\b(\d+) or more targets|there are (\d+)\+ targets/i.exec(t)) && !/\bally|allies\b/i.test(t)) return { q: { g: "hit" }, n: +(m[1] || m[2]) };
  if (/\b\d+ or more (?:surviving )?targets|there are \d+\+ targets|target is an ally|killed an ally|an ally is one of this Skill's targets/i.test(t)) return { never: t, why: "only when hitting several targets or allies" };
  if ((m = /^if (?:the )?(?:main )?target is (not )?(?:in )?Staggered$/i.exec(t))) return m[1] ? { q: { g: "stag" }, n: 1, lt: true } : { q: { g: "stag" }, n: 1 };
  if (/^(?:if|at) (?:the )?(?:main )?target has Shield$/i.test(t)) return { q: { g: "shT" }, n: 1 };
  if ((m = /^if (?:the )?(?:main )?target is in (?:an? )?\[(\w+)\] state$/i.exec(t)) && dcaG(m[1]).st) return { q: { kw: m[1], side: "target", part: "s" }, n: 1 };
  if ((m = /^if (?:the )?(?:main )?target is in either \[(\w+)\] or \[(\w+)\] states?$/i.exec(t)) && dcaG(m[1]).st && dcaG(m[2]).st) return { q: { sum: [m[1], m[2]].map((kw) => ({ kw, side: "target", part: "s" })) }, n: 1 };
  if ((m = /^at (-?\d+) or less SP$/i.exec(t))) return { q: { g: "sp", neg: true }, n: -m[1] };
  if ((m = /^at (\d+)\+ SP$/i.exec(t))) return { q: { g: "sp" }, n: +m[1] };
  if ((m = /^at (\d+)\+ Speed$/i.exec(t))) return { q: { g: "speed" }, n: +m[1] };
  if ((m = /^(?:if |when )?at (\d+)\+? (.+)$/i.exec(t))) { const q = dcaTerm(m[2], null, ctx); if (q) return { q, n: +m[1] }; }
  if (/\bA-Reson\.? in the Reson\.? chain|\bReson\.? includes an A-Reson|\bhighest A-Reson\.? is \w+ A-Reson/i.test(t)) return { q: { g: "ares" }, n: 1 };
  if (/^if (?:the )?(?:main )?target has any of the Panic type changing effects$/i.test(t)) return { q: { g: "panic" }, n: 1 };
  if ((m = /^if (?:the )?(?:main )?target is \[(\w+)\]$/i.exec(t)) && dcaG(m[1]).st) return { q: { kw: m[1], side: "target", part: "s" }, n: 1 };
  if ((m = /^if \[(\w+)\] is (\d+) or (?:higher|more|greater)$/i.exec(t)) && dcaG(m[1]).st) return { q: { kw: m[1], side: "self", part: "s" }, n: +m[2] };
  if (/^if there is an? \w+ A-Reson\.? or an? \w+ A-Reson\.?$/i.test(t)) return { q: { g: "ares" }, n: 1 };
  if ((m = /^if (?:the )?main target has higher than (\d+(?:\.\d+)?) (Slash|Pierce|Blunt|\w+) Resist\.?$/i.exec(t))) return { q: { res: m[2][0].toUpperCase() + m[2].slice(1).toLowerCase(), scale: 10 }, n: Math.round(+m[1] * 10) + 1 };
  if (/^if this is the first Coin$/i.test(t)) return ctx.coin === 0 ? { ok: true, first: true } : { never: t, why: "only on the first Coin" };
  if ((m = /^if there (?:are|is) any remaining (.+)$/i.exec(t))) { const q = dcaTerm(m[1], null, ctx); if (q) return { q, n: ((ctx.paid || {})[q.kw] || 0) + 1 }; }  // after paying N
  if ((m = /^(?:if |when )?at more than (\d+) (.+)$/i.exec(t))) { const q = dcaTerm(m[2], null, ctx); if (q) return { q, n: +m[1] + 1 }; }
  if ((m = /^at (\d+)\s*~\s*(\d+) (.+)$/i.exec(t))) { const q = dcaTerm(m[3], null, ctx); if (q) return { q, n: +m[1], max: +m[2] }; }
  if ((m = /^(?:if this unit is in|when in) (?:an? )?\[(\w+)\](?: state)?$/i.exec(t)) && dcaG(m[1]).st) return { q: { kw: m[1], side: "self", part: "s" }, n: 1 };
  // yes / no facts: sliders with 0 / 1
  if (/^if (?:this unit|user) took no damage last turn$/i.test(t)) return { q: { g: "nodmg" }, n: 1 };
  if (/^if (?:the )?target took no damage from attacks this turn$/i.test(t)) return { q: { g: "tnd" }, n: 1 };
  if (/^if (?:the )?target previously took damage this turn$/i.test(t)) return { q: { g: "tpd" }, n: 1 };
  if (/^if this Skill is marked with \[\w+\]$/i.test(t)) return { q: { g: "mark" }, n: 1 };
  if (/^at max SP$/i.test(t)) return { q: { g: "sp" }, n: 45 };
  if ((m = /^if (?:the )?sum of (.+?) is (\d+) or (?:higher|greater|more)$/i.exec(t))) { const q = dcaTerm(m[1], null, ctx); if (q) return { q, n: +m[2] }; }
  // consumed / spent in this Skill ("If this unit consumed 10+ Stack", "If 40 Stack was consumed", "If this unit spent [X] due to this Coin's effect")
  if ((m = /^if (?:this unit |this (?:Skill|Coin) )?(?:consumed|spent) (\d+)\+? (.+?)(?: due to this (?:Coin['’]s )?effect)?$/i.exec(t)) || (m = /^if (\d+)\+? (.+?) (?:was|were) (?:consumed|spent)$/i.exec(t))) { const q = dcaTerm(m[2] + " consumed", null, ctx); if (q) return { q, n: +m[1] }; }
  if ((m = /^if this unit (?:consumed|spent) (\[\w+\])(?: due to this (?:Coin['’]s )?effect)?$/i.exec(t))) { const q = dcaTerm(m[1] + " consumed", null, ctx); if (q) return { q, n: 1 }; }
  if ((m = /^(?:if |when )?at (\d+\+? .+?) and (\d+~\d+ .+)$/i.exec(t))) { const a = dcaCond(["at", m[1]].join(" "), ctx), b = dcaCond(["at", m[2]].join(" "), ctx); if (!a.unk && !b.unk) return [a, b]; }
  // has A and/or B
  if ((m = /^(?:if|when) (?:the )?(?:main )?(target|this unit|user|the enemy) (?:has|have) (.+)$/i.exec(t)) && / (?:and|or) /i.test(m[2])) {
    const side = /target|enemy/i.test(m[1]) ? "target" : "self", or = / or /i.test(m[2]) && !/ and /i.test(m[2]);
    const parts = m[2].split(/ (?:and|or) /i).map((p) => { const k = /^(\d+)\+? (.+)$/.exec(p.trim()), w = k ? k[2] : p.trim(), q = dcaTerm(side === "target" && !/ on /.test(w) ? `${w} on target` : w, side, ctx); return q && { q, n: k ? +k[1] : 1 }; });
    if (parts.every(Boolean)) return or ? { q: { sum: parts.map((z) => z.q) }, n: Math.min(...parts.map((z) => z.n)) } : parts;
  }
  // "this unit has [A] and the target has [B]": one condition each
  if ((m = /^(?:if|when) (?:this unit|the user|user) has (?:(\d+)\+? )?(.+?) and (?:the )?(?:main )?target has (?:(\d+)\+? )?(.+)$/i.exec(t)) || ((m = /^(?:if|when) (?:the )?(?:main )?target has (?:(\d+)\+? )?(.+?) and (?:this unit|the user|user) has (?:(\d+)\+? )?(.+)$/i.exec(t)) && (m = [m[0], m[3], m[4], m[1], m[2]]))) {
    const a = dcaTerm(m[2], "self", ctx), b = dcaTerm(/ on /.test(m[4]) ? m[4] : m[4] + " on target", "target", ctx);
    if (a && b) return [{ q: a, n: +(m[1] || 1) }, { q: b, n: +(m[3] || 1) }];
  }
  if (/^if this unit is Fanatic$/i.test(t)) return { q: { kw: "AssemblePersonality", side: "self", part: "s" }, n: 1 };
  if ((m = /^(?:if )?at (\d+)\+? (?:\w+ )?A-Reson\.?$/i.exec(t))) return { q: { g: "ares" }, n: +m[1] };
  // tier steps
  if ((m = /^at ((?:\d+\+\/)+\d+\+) (.+)$/i.exec(t))) { const q = dcaTerm(m[2], null, ctx); if (q) return { tier: { q, ns: m[1].split("/").map((z) => parseInt(z)) } }; }
  if (/\bloses? a Clash\b/i.test(t)) return { never: t, why: "only after a lost Clash" };
  if ((m = /^if (?:the )?target['’]s \[(\w+)\] is at max Stack$/i.exec(t)) && dcaG(m[1]).st && dcaG(m[1]).max) return { q: { kw: m[1], side: "target", part: "s" }, n: dcaG(m[1]).max };
  return dcaFlag(t);
}
// a number or a yes / no the text asks for and nothing in the fight gives: a slider named by the text
function dcaFree(t) {
  t = String(t).trim().replace(/[.,;]$/, "").replace(/^\((.*)\)$/, "$1").trim();
  if (!t || t.length > 90 || /^[\d.\s+x×/*-]+$/.test(t) || /^\w+$/.test(t) || /^[^a-z]*$/i.test(t)) return null;
  const key = `f${t.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 36)}`;
  DCA_G[key] ||= [t[0].toUpperCase() + t.slice(1).replace(/\[(\w+)\]/g, (a, k) => dcbK(k)), 0, /percent|%/i.test(t) ? 100 : 10];
  return { g: key };
}
function dcaFlag(t) {
  const m = /^(?:if |when |at )?(?:(?:the )?(?:main )?target has |this unit has )?(\d+)\+? (.{3,})$/i.exec(t);
  const label = (m ? m[2] : t).replace(/^(?:if|when|at) /i, "").replace(/\[(\w+)\]/g, (a, k) => dcbK(k));
  const key = `c${t.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 36)}`;
  const big = label[0].toUpperCase() + label.slice(1);
  DCA_G[key] ||= m ? [big, 0, Math.max(10, 2 * +m[1])] : [`${big} (1 yes)`, 0, 1];
  return { q: { g: key }, n: m ? +m[1] : 1, flag: t };
}

// one line of text → { fx: [effects], conds } | { gain } | { none } | { unk } | null (nothing to show)
function dcaLine(raw, ctx) {
  let t = dcaPlain(raw).replace(/^[-•·�]\s*/, "");
  const bullet = t !== dcaPlain(raw);
  t = dcaNames(t);
  const tags = [];
  for (let m; (m = /^\[(\w+)\]\s*/.exec(t)) && !dcaG(m[1]).st;) { tags.push(m[1]); t = t.slice(m[0].length); }
  if (!t || /^(\[\w+\]\s*)+$/.test(t)) return null;
  const pre = /^(Combat Start|Turn Start|Turn End|On Use|Before Attack|On Hit(?: with [^:,]*)?)\s*[:,]\s*/i.exec(t);
  if (pre) { tags.push(pre[1].replace(/\s.*$/, "") === "Turn" && /End/.test(pre[1]) ? "OnEndTurn" : pre[1]); t = t.slice(pre[0].length); }
  // a line at the header's own level (or no bullet) ends the header
  const mark = bullet ? dcaPlain(raw)[0] : "";
  if (!bullet || mark === ctx.headMark) { ctx.head = null; ctx.headPer = null; ctx.headSkill = null; ctx.headMark = null; ctx.headTerm = null; }
  // "Apply the following effects to "Blazing Strike"": its bullets only for that Skill
  if (ctx.headSkill && ctx.name && !ctx.name.toLowerCase().startsWith(ctx.headSkill.toLowerCase())) return { none: t, why: "another Skill", quiet: 1 };
  // "Skill 1 and Skill 2 …", "Skill 3: …": only for that Skill
  const only = /^Skill (\d)(?:,? (?:and|or) Skill (\d))?(?:\s*:\s*|\s+(?=gains?\b|deals?\b))/i.exec(t);
  if (only) { if (![only[1], only[2]].includes(String(ctx.tier))) return { none: t, why: "another Skill", quiet: 1 }; t = t.slice(only[0].length); }
  // 'Skill "Eject" deals …', 'Skills "A" and "B" deal …': only for those names
  const named = /^(?:Skills?|Base Skills?)\s+((?:["“'][^"”']+["”'](?:,?\s*(?:and|or)?\s*)?)+)/i.exec(t);
  if (named && ctx.name) {
    const names = [...named[1].matchAll(/["“']([^"”']+)["”']/g)].map((q) => q[1].trim().toLowerCase());
    if (!names.includes(ctx.name.toLowerCase())) return { none: t, why: "another Skill", quiet: 1 };
  }
  // condition before the first top-level comma or colon
  // a sentence over several lines ("At 7~14 Charge Count" / "Consume all …," / "And …") keeps its condition
  const chain = (ctx.comma || /^(and|or|then)\b/i.test(t)) && ctx.last;
  let conds = chain ? [...ctx.last] : bullet && ctx.head ? [...ctx.head] : [], rest = t;
  ctx.comma = /,$/.test(t);
  if (/^(If|At|When|While|Against)\b/i.test(t) || /^\d+\+ [^:,]+:/i.test(t)) {
    const cut = dcaCut(t, /[,:]/);
    if (cut > 0) { conds.push(...[].concat(dcaCond(t.slice(0, cut), ctx))); rest = t.slice(cut + 1).trim(); }
    else if (!/Power|damage|Offense|Reuse/i.test(t)) { ctx.last = [...conds, ...[].concat(dcaCond(t, ctx))]; ctx.comma = true; return null; }
  }
  // "- Per 1 Potency: …" under "based on Potency": for every N of the head's status
  const perH = bullet && ctx.headTerm && /^Per (\d+) (?:Potency|Count|Stacks?)\s*:\s*/i.exec(rest);
  if (perH) rest = rest.slice(perH[0].length);
  rest = rest.replace(/^upon Skill use,\s*/i, "");
  // "On Clash Lose, …": a lost Clash, not this attack
  const lose = /^(?:On )?(?:Clash Lose|losing a Clash)\s*,\s*/i.exec(rest);
  if (lose) { conds.push({ never: lose[0], why: "only after a lost Clash" }); rest = rest.slice(lose[0].length); }
  const win = /^On Clash Win\s*,\s*/i.exec(rest);
  if (win) { conds.push({ q: { g: "clash" }, n: 1 }); rest = rest.slice(win[0].length); }
  const only2 = /^Skill (\d)(?:,? (?:and|or) Skill (\d))?(?:\s*:\s*|\s+(?=gains?\b|deals?\b))/i.exec(rest);
  if (only2) { if (![only2[1], only2[2]].includes(String(ctx.tier))) return { none: t, why: "another Skill", quiet: 1 }; rest = rest.slice(only2[0].length); }
  const use = /consumes? (?:up to (\d+) (?:of )?|all )?\[(\w+)\]( Count)?(?: Potency)?(?: over (\d+))?/i.exec(rest);
  if (use) ctx.use = { kw: use[2], cap: use[1] ? +use[1] : null, c: !!use[3], sub: use[4] ? +use[4] : /additionally/i.test(rest) && ctx.paid && ctx.paid[use[2]] || 0 };
  const loseC = /\bLose \(# of remaining Coins\) \[(\w+)\]/i.exec(rest);  // stacks lost = coins left
  if (loseC) ctx.use = { kw: loseC[1], cap: ctx.ncoins || null, c: false, sub: 0 };
  const spend = /^spend (?:up to )?(\d+) \[(\w+)\]( Count)?/i.exec(rest);
  if (spend) ctx.use = { kw: spend[2], cap: +spend[1], c: !!spend[3] };
  // "Consume 15 [Charge] Count to gain …": needs that much
  const pay = /consumes? (\d+) \[(\w+)\]( Count| Potency)?/i.exec(rest);
  if (pay) ctx.paid = { ...ctx.paid, [pay[2]]: +pay[1] };
  if (pay && dcaG(pay[2]).st) conds.push({ q: { kw: pay[2], side: "self", part: pay[3] ? pay[3].trim()[0].toLowerCase() : "s" }, n: +pay[1] });
  if (/\b(?:against|on|when attacking) (?:a )?Staggered (?:targets?|enem(?:y|ies)|units?)\b/i.test(rest)) conds.push({ q: { g: "stag" }, n: 1 });  // "deal +X% damage against Staggered targets"
  const hv = /\b(?:against|to) (?:units|targets|enemies) (?:that have|with) (?:(\d+)\+? )?(\[\w+\](?: (?:Potency|Count))?|[A-Z][a-z]+(?: [A-Z][a-z]+)*?)(?: for the turn)?\.?(?:\s*\([^)]*\))?\s*$/i.exec(rest);  // "Skill Power +2 against units that have [X]"
  if (hv) { const q = dcaTerm(dcaNames("1 " + hv[2]).replace(/^1 /, "") + " on target", "target", ctx); if (q) conds.push({ q, n: +(hv[1] || 1) }); }
  const spc = /\bagainst targets? (?:at|with|that have) less than (-?\d+) SP\b/i.exec(rest);  // target SP suffix
  if (spc) conds.push({ q: { g: "spT" }, n: +spc[1], lt: true });
  ctx.last = conds;
  const late = tags.some((g) => /^(OnSucceedAttack|OnWinDuel|OnLoseDuel|OnEndSkill|EndSkill|OnKill|AfterAttack|OnEndTurn|OnDie)/i.test(g));
  if (tags.some((g) => /^(EnemyKill|OnKill)$/i.test(g)) || /^\(Does not activate on Reuse/i.test(rest) || /^If this Coin defeated the target|^If 1 or more targets are killed/i.test(t)) return { none: t, why: "only after a kill" };
  if (tags.some((g) => /^(DefeatDuel|OnLoseDuel)$/i.test(g))) return { none: t, why: "only on Clash Lose (then this Skill does not hit)" };
  const crit = /Critical Hit/i.test(rest);
  const ty = DCA_TYPES.exec(rest);
  if (ty && ctx.atk && ty[1] !== ctx.atk && ty[1] !== ctx.sin && !/bonus|equal to|of (?:this|each|the)? ?(?:Coin's final damage|damage dealt)/i.test(rest)) return { none: t, why: `${ty[1]} only` };
  // gated Skills
  const gate = /\bSkills? that (?:gains?|consumes?|inflicts?|uses?)(?: or (?:gains?|consumes?|inflicts?|uses?))? (.+?)(?: Count| Potency)?(?: \([^)]*\))? (?:deals?|gains?)\b/i.exec(rest);
  if (gate && ctx.skillTxt) {
    const ks = gate[1].split(/,? (?:or|and) |, /).map((w) => { const b = /^\[(\w+)\]$/.exec(w.trim()); return b ? b[1] : DCA_NAMES[w.trim()] || w.trim(); });
    if (!ks.some((k) => ctx.skillTxt.some((l) => new RegExp(`\\b(?:gain|consume|spend|inflict)[^.;]*\\[${k}\\]`, "i").test(l)))) return { none: t, why: "this Skill does not gain or consume it", quiet: 1 };
  }
  if (ctx.op && (/Minus Coin/i.test(rest) && ctx.op !== "SUB" || /Plus Coin/i.test(rest) && ctx.op === "SUB")) return { none: t, why: "other coin kind" };
  // "double / boost the Offense Level gained from the above effect": another copy of the line before
  const dbl = /^(double|boost) the (?:amount of )?Offense Level (?:gained )?(?:from|by) the above effects?(?: by (\d+)%)?/i.exec(rest);
  if (dbl && ctx.lastOl) return { fx: ctx.lastOl.map((f) => ({ ...f, mul: dbl[1].toLowerCase() === "double" ? 1 : +dbl[2] / 100, scope: "all" })), conds, late: false, t, inst: false };
  // "double the above damage increase effect": the line before again
  const dbl2 = /^(?:double the above damage increase effect|the damage modifying effect above is applied at 2x its value)/i.exec(rest);
  if (dbl2 && ctx.lastDyn) { const cp = /\(max (-?\d+)%\)/i.exec(rest); return { fx: ctx.lastDyn.map((f) => ({ ...f, mul: 1, scope: "all", ...(cp ? { cap: +cp[1] } : {}) })), conds, late: false, t, inst: false }; }
  // clauses split by top-level ";", each with its own "for every" and "(max)"
  const cq = conds.find((c) => c.q);
  ctx.condTerm = cq ? cq.q : null; ctx.condN = cq ? cq.n : 0;
  ctx.allT = /against all targets/i.test(t);  // a share of the Coin's damage that goes to every target
  const fx = [];
  for (let left = rest; left;) {
    const cut = dcaCut(left, /;/), part = cut < 0 ? left : left.slice(0, cut);
    left = cut < 0 ? "" : left.slice(cut + 1).trim();
    const got = dcaClause(part, ctx);
    if (got === "unk") return { unk: t };
    if (got === "none") return { none: t };
    fx.push(...got);
  }
  if (!fx.length && crit) return { none: t, why: "crit only" };
  if (!fx.length) {
    const toSkill = /following effects? (?:to|for) ["“]([^"”]+)["”]/i.exec(rest), basedOn = /following effects? based on (.+?):?$/i.exec(rest);
    const replaced = /following effects? based on which .*Skill was replaced/i.test(rest) && ctx.replWith;
    if (rest.endsWith(":") || use || toSkill || basedOn || replaced || !rest && conds.length) {
      ctx.head = conds; ctx.headMark = mark; ctx.headSkill = toSkill ? toSkill[1].trim() : replaced || null;
      // "based on (A + B)": what "N+ Stack" counts; "based on Potency": the head condition's status
      const own = basedOn && /^(Potency|Count|Stacks?)$/i.exec(basedOn[1].trim()), hq = (conds.find((c) => c.q && c.q.kw) || {}).q;
      ctx.headTerm = own ? hq && { ...hq, part: /^c/i.test(own[1]) ? "c" : dcaG(hq.kw).st === 2 ? "p" : "s" } : basedOn ? dcaTerm(basedOn[1].replace(/ Stacks?$/i, ""), null, ctx) : null;
      // "For every 10 [X], gain the following effects:" — the bullets count per 10
      const ev = rest.endsWith(":") && dcaEvery(rest), mm = ev && /^(\d+)\s+(.+)$/.exec(ev[1].trim()), q = mm && dcaTerm(mm[2], null, ctx);
      ctx.headPer = q ? { q, every: +mm[1] } : null;
      return use ? null : { none: t };
    }
    const gain = /\b(gain|gains|inflict|inflicts|apply)\b/i.test(rest);
    // damage to this unit or to others, gifts to allies, lines with no number: not this attack's damage
    if (/\b(?:take|takes|lose|loses) [^.]*\bdamage\b|\bHP damage\b|\bto (?:all|at most \d+|\d+) (?:random )?(?:other )?(?:allies|units|enemies)|\bfixed damage (?:by|between)|\bto a random enemy|\bloses? \(?[^.]*SP\b|counts as an Attack Skill|Coin Power does not change; instead|equal to (?:Tremor Burst|\[VibrationExplosion\]) damage|trigger \[VibrationExplosion\]|counts as activating|inflicted only against|deals? 0 damage|\bthe less HP this unit has|^\d+ \[\w+\]/i.test(rest)) return { none: t, why: "not damage to this target" };
    if (/damage|\bPower\b|Offense Level|Reuse/i.test(rest) && !/Clash Power|heal|SP damage|Stagger|Shield|less damage|damage taken|Defense Level|\btakes? -|\btakes? damage|cannot|can't|nullify|Unopposed Attack against|Atk Weight|defeated|collectively received|can be used up to/i.test(rest) && !gain) return { unk: t };
    return gain ? { gain: t } : { none: t };
  }
  // tier steps
  const ti = conds.find((c) => c.tier);
  if (ti) {
    const vs = /([+-]?\d+(?:\/[+-]?\d+)+)/.exec(rest);
    if (!vs) return { unk: t };
    const nums = vs[1].split("/").map(Number);
    fx.forEach((f) => { f.tiers = ti.tier.ns.map((n, i) => [n, nums[i] ?? nums[nums.length - 1]]); f.per = ti.tier.q; f.v = 0; });
    conds = conds.filter((c) => c !== ti);
  }
  if (conds.some((c) => c.q === undefined && !c.unk && !c.never && !c.coinGains && !c.ok)) return { unk: t };
  const ol = fx.filter((f) => f.k === "ol" && f.per), dy = fx.filter((f) => f.k === "dyn");
  if (ol.length) ctx.lastOl = ol;
  if (dy.length) ctx.lastDyn = dy;
  if (perH) fx.forEach((f) => { if (!f.per && f.k !== "reuse") { f.per = ctx.headTerm; f.every = +perH[1]; } });
  const scope = conds.some((c) => c.first) ? "first" : /final Coin/i.test(rest) && !fx.every((f) => f.k === "reuse" && f.last && ctx.coin == null) ? "last" : ctx.coin ?? "all";
  if (bullet && ctx.headPer) {
    const times = /\((\d+) times per Skill\)/i.exec(rest);
    fx.forEach((f) => { if (f.per) return; f.per = ctx.headPer.q; f.every = ctx.headPer.every; if (f.k === "reuse") { f.v = 1; if (times) f.cap = +times[1]; } });
  }
  const keep = /\binstead\b/i.test(rest) ? fx.filter((f, i) => !fx.slice(i + 1).some((g) => g.k === f.k)) : fx;
  // "When hitting with a Coin that gains [X]:" — only those coins of this skill
  const cg = conds.find((c) => c.coinGains);
  if (cg && ctx.coinTexts) {
    const at = ctx.coinTexts.map((x, i) => new RegExp(`gain[^.]*\\[${cg.coinGains}\\]`, "i").test(x) ? i : -1).filter((i) => i >= 0);
    if (!at.length) return { none: t, why: `no coin of this skill gains it`, quiet: 1 };
    return { fx: at.flatMap((i) => keep.map((f) => ({ ...f, scope: i, crit }))), conds: conds.filter((c) => c !== cg), late, t, inst: /\binstead\b/i.test(rest) };
  }
  return { fx: keep.map((f) => ({ ...f, scope: f.scope ?? scope, crit })), conds, late, t, inst: /\binstead\b/i.test(rest) };
}
// first top-level match of a one-character separator, or -1
function dcaCut(t, sep) {
  let d = 0;
  for (let i = 0; i < t.length; i++) { const ch = t[i]; if (ch === "(") d++; else if (ch === ")") d--; else if (!d && sep.test(ch)) return i; }
  return -1;
}
// "Final Power +( … )" with brackets inside at any depth → { kind, inner, every, cap } or null
function dcaPlusParen(rest) {
  const m = /\b(Offense Level|Coin Power|Final Power|Base Power)\s*\+\(/i.exec(rest);
  if (!m) return null;
  let d = 1, i = m.index + m[0].length;
  const a = i;
  for (; i < rest.length && d; i++) { if (rest[i] === "(") d++; else if (rest[i] === ")") d--; }
  if (d) return null;
  let inner = rest.slice(a, i - 1);
  const tail = rest.slice(i);
  if (/^\s*%/.test(tail)) return null;
  const ev = /\s*\/\s*(\d+)$/.exec(inner);
  if (ev) inner = inner.slice(0, ev.index);
  const cap = /^\s*\((?:rounded down; ?)?max (\d+)/i.exec(tail);
  return { kind: m[1], inner, every: ev ? +ev[1] : 0, cap: cap ? +cap[1] : undefined };
}
// one clause → [effects] | "unk" | "none"
const dcaT2 = (t, side, ctx) => dcaTerm(t, side, ctx) || dcaFree(t);  // else a slider named by the text
function dcaClause(rest, ctx) {
  const fx = [];
  // # of Coins
  if (ctx.ncoins) rest = rest.replace(/\+\((\d+(?:\.\d+)?)\s*\/\s*# of Coins(?:,\s*minimum (\d+))?\)(%?)/gi, (all, a, mn, pct) => { const v = a / ctx.ncoins; return `+${pct ? +v.toFixed(2) : Math.max(+(mn || 0), Math.floor(v))}${pct}`; });
  let approx = null, share = false;  // other-type bonus; share = "N% of this Coin's final damage" (its own hit after all multipliers)
  rest = rest.replace(/^\+\(([^()%]+)\)%\s+Damage\b/i, "deal +($1)% damage");  // "+(X)% Damage on Critical Hit"
  rest = rest.replace(/\bgains Power \+(\d+)/i, "gains Coin Power +$1");  // "This Coin gains Power +1 and deals +40% damage for every X (max 3; max 120%)"
  if (/Coin Power does not change/i.test(rest)) return "none";  // read in dcaModel (conv)
  const both = /deal and take \+(\d+(?:\.\d+)?)% (?:more )?damage/i.exec(rest);
  if (both) return [{ k: "dyn", v: +both[1] }];
  const subT = /\bdeals?\s+(-?\d+(?:\.\d+)?)%\s+damage against sub-targets/i.exec(rest);
  if (subT) return [{ k: "sub", v: +subT[1] }];
  // no rate in the text, only the top ("Deal more damage based on … (Max 75%)", "Boost damage based on … (up to 50%)"): the top
  const vague = /\b(?:deals? more damage|boost damage)\s+(?:based on [^()]*?)?\(\s*(?:max|up to)\s+(\d+)%\)/i.exec(rest);
  if (vague) {  // "Spend [Charge] Count to deal more damage (Max 75%)": the top at the most the status can hold, in proportion below it
    const sp = /^spend (?:up to \d+ )?\[(\w+)\]( Count)?/i.exec(rest), top = sp && dcaG(sp[1]).st ? dcaCaps(sp[1])[sp[2] ? "c" : "s"] ?? dcaG(sp[1]).max : 0;
    if (top) return [{ k: "dyn", v: +vague[1] / top, per: { kw: sp[1], side: "self", part: sp[2] ? "c" : "s" }, every: 0, cap: +vague[1] }];
    return [{ k: "dyn", v: +vague[1], best: true }];
  }
  const boostBy = /\bboost damage by (\d+)%(?! of)/i.exec(rest);  // "Spend 3 random E.G.O resources to boost damage by 30%"
  if (boostBy) return [{ k: "dyn", v: +boostBy[1] }];
  const lust = /further boost damage by (\d+)% per resource spent/i.exec(rest);  // "spend Lust resources by (Lust Reson.)"
  if (lust) return [{ k: "dyn", v: +lust[1], per: { g: "res" }, every: 1 }];
  const nextC = /\bNext Coin has \+(\d+) Power/i.exec(rest);  // the next coin rolls higher
  if (nextC) return ctx.coin != null && ctx.coin + 1 < (ctx.ncoins || 0) ? [{ k: "cp", v: +nextC[1], scope: ctx.coin + 1 }] : "none";
  const only = /\bThis Coin deals damage only against the (main target|sub-targets)/i.exec(rest);  // the coin hits one kind of target
  if (only) return ctx.coin != null ? [{ k: "only", v: /main/i.test(only[1]) ? 1 : 2, scope: ctx.coin }] : "none";
  if (/^However, if the main target was an enemy/i.test(rest)) return ctx.coin != null ? [{ k: "only", v: 3, scope: ctx.coin }] : "none";  // an enemy main target is hit after all
  const flatD = /^Damage \+(\d+)$/i.exec(rest.trim());  // "[OnSucceedAttackHead] Damage +3": plain extra damage
  if (flatD) return [{ k: "flat", v: +flatD[1], sin: "True" }];
  if (/unconditionally activate all Reuse effects/i.test(rest)) return [{ k: "force", v: 1 }];
  const fre = /\bdeal additional (\w+) damage equal to \[(\w+)\] on the targeted enemy \(max (\d+)/i.exec(rest);  // "On Hit using Reused Coins …"
  if (fre) { if (!/Reused Coins/i.test(rest)) return "none"; const q = dcaG(fre[2]).st ? { kw: fre[2], side: "target", part: "s" } : null; return q ? [{ k: "flat", v: 1, per: q, every: 0, cap: +fre[3], scope: "reuse", sin: fre[1][0].toUpperCase() + fre[1].slice(1).toLowerCase() }] : "unk"; }
  const rf = /^Raise (?:the )?Skill Final Power by the effect['’]s (?:Count|Stack)\b/i.exec(rest);  // status text: Final Power by its own number
  if (rf && ctx.own) return [{ k: "fp", v: 1, per: { kw: ctx.own, side: ctx.ownSide || "self", part: "s" }, every: 0 }];
  const extra = /For every \[(\w+)\] on self, this Skill loses (\d+) Base Power and gains an extra Coin (\d+) before using Coin (\d+)/i.exec(rest);  // extra copies of a coin
  if (extra && dcaG(extra[1]).st) { const q = { kw: extra[1], side: "self", part: "s" }; return [{ k: "bp", v: -extra[2], per: q, every: 1 }, { k: "reuse", v: 1, per: q, every: 1, at: +extra[3] - 1 }]; }
  if (/\buse this Coin an additional time\b/i.test(rest) && ctx.coin != null) return [{ k: "reuse", v: 1, at: ctx.coin }];  // "If target is below 25% HP, use this Coin an additional time"
  const extra2 = /\bthis Skill gains an extra Coin (\d)\b/i.exec(rest);  // "At 20+ [X], this Skill gains an extra Coin 2": one more hit of that coin
  if (extra2) return [{ k: "reuse", v: 1, at: +extra2[1] - 1 }];
  const dmgUp = /^Damage \+(\d+(?:\.\d+)?)%$/i.exec(rest.trim());  // "[WinDuel] Damage +40%"
  if (dmgUp) return [{ k: "dyn", v: +dmgUp[1] }];
  // "Boost damage by 5% of target's missing HP (Max 20)": extra damage, at most 20
  const boost = /Boost damage by [\d.]+% of (?:the )?target.?s missing HP \(Max (\d+)\)/i.exec(rest);
  if (boost && ctx.sin) return [{ k: "flat", v: +boost[1], sin: ctx.sin }];
  // "gains Offense Level equal to (highest Reson.) (max 6)", "gains (highest Reson. / 2) Offense Level (max 3)"
  const KIND = { "coin power": "cp", "final power": "fp", "base power": "bp", "offense level": "ol" };
  const eqTo = /(Offense Level|Coin Power|Final Power|Base Power)(?: for this Coin)? equal to \(?([^()]+?)\)?\s*\(max (\d+)/i.exec(rest);
  const divBy = /\(([^()]+?)\s*\/\s*(\d+)\)\s*(Offense Level|Coin Power|Final Power|Base Power)(?:[^(]*\(max (\d+))?/i.exec(rest);
  const byP = /\b(Offense Level|Coin Power|Final Power|Base Power) by \(([^()]+?)\)\s*$/i.exec(rest);  // "gain Coin Power by ([X] -1)"
  if (byP) { const mm = /^(.+?)\s+-\s*(\d+)$/.exec(byP[2].trim()), q = dcaT2(mm ? mm[1] : byP[2], null, ctx); return q ? [{ k: KIND[byP[1].toLowerCase()], v: 1, per: mm ? { ...q, sub: +mm[2] } : q, every: 0 }] : "unk"; }
  const eqNo = /\b(Offense Level|Coin Power|Final Power|Base Power)(?: for this Coin)? equal to (\(?\[\w+\](?: [A-Za-z ]*?consumed(?: for this Coin)?| on (?:self|the target|target))?\)?)\s*$/i.exec(rest);  // "gain Coin Power equal to [X]" (no cap)
  if (eqNo) { const q = dcaT2(eqNo[2], null, ctx); return q ? [{ k: KIND[eqNo[1].toLowerCase()], v: 1, per: q, every: 1 }] : "unk"; }
  const byDiv = /\b(?:gains?\s+(\d+)\s+)?(Offense Level|Coin Power|Final Power|Base Power)\s+by\s+\(([^()]+?)\s*\/\s*(\d+)\)(?:\s*\(max (\d+))?/i.exec(rest);  // "gains 1 Offense Level by (X / 2) (Max 6)"
  const pp = !byDiv && !/\b(?:Offense Level|Coin Power|Final Power|Base Power)\s*[+-]\s*\d/i.test(rest) ? dcaPlusParen(rest) : null;  // "Final Power +([X] on self + ([Y] on target / 2)) (max 5)"
  const plusQ = pp ? dcaT2(pp.inner, null, ctx) : null;
  if (plusQ) return [{ k: KIND[pp.kind.toLowerCase()], v: 1, per: plusQ, every: pp.every, cap: pp.cap }];
  if (byDiv) { const q = dcaT2(byDiv[3], null, ctx); return q ? [{ k: KIND[byDiv[2].toLowerCase()], v: +(byDiv[1] || 1), per: q, every: +byDiv[4], cap: byDiv[5] ? +byDiv[5] : undefined }] : "unk"; }
  if (eqTo) { const q = dcaT2(eqTo[2], null, ctx); return q ? [{ k: KIND[eqTo[1].toLowerCase()], v: 1, per: q, every: 1, cap: +eqTo[3] }] : "unk"; }
  if (divBy) { const q = dcaT2(divBy[1], null, ctx); return q ? [{ k: KIND[divBy[3].toLowerCase()], v: 1, per: q, every: +divBy[2], cap: divBy[4] ? +divBy[4] : undefined }] : "unk"; }
  // bonus share of Coin damage
  const TYPE = /^(Slash|Pierce|Blunt|Wrath|Lust|Sloth|Gluttony|Gloom|Pride|Envy)$/i, own = (w) => !w || !TYPE.test(w) || [ctx.atk, ctx.sin].some((z) => z && z.toLowerCase() === w.toLowerCase());
  const bonus = /\((\d+(?:\.\d+)?)% of this Coin's final damage\) bonus/i.exec(rest);
  if (bonus) return [{ k: "dyn", v: +bonus[1], share: ctx.allT ? "all" : true }];
  for (const [re, ni, ti] of [
    [/\bdeals?\s+(?:bonus\s+)?(?:(\w+)\s+)?(?:bonus\s+)?damage\s+(?:equal to|by)\s+\(?(\d+(?:\.\d+)?)%\s+of\s+(?:(?:this|each|the)\s+)?(?:Coin['’]s final damage|damage dealt)\)?/i, 2, 1],
    [/\bdeals?\s+\((\d+(?:\.\d+)?)%\s+of\s+this Coin['’]s final damage\)\s+(?:(\w+)\s+)?damage/i, 1, 2],
    [/\bdeals?\s+(\d+(?:\.\d+)?)%\s+of\s+(?:the\s+)?damage dealt\s+as\s+(?:(\w+)\s+)?bonus damage/i, 1, 2],
    [/\bdeals?\s+(\d+(?:\.\d+)?)%\s+of\s+(?:(\w+)\s+)?damage dealt\s+as\s+(\w+)\s+damage/i, 1, 3]]) {  // "5% of Gluttony damage dealt as Wrath damage"
    const b = re.exec(rest);
    if (b) { share = true; if (!own(b[ti])) approx = b[ti]; rest = `${rest.slice(0, b.index)}deal +${b[ni]}% damage${rest.slice(b.index + b[0].length)}`; break; }
  }
  const be = /\bdeals?\s+\(([^()%]+)\)%\s+of\s+this Coin['’]s final damage\s+as\s+(?:(\w+)\s+)?bonus damage/i.exec(rest), be2 = /\bdeals?\s+(?:(\w+)\s+)?damage equal to\s+\(([^()%]+)\)%\s+of\s+this Coin['’]s final damage/i.exec(rest);
  const bx = /\bdeals?\s+bonus\s+(?:(\w+)\s+)?damage by\s+\(([^()%]+)\)%\s+of\s+(?:the\s+)?damage dealt/i.exec(rest);  // "bonus Gloom damage by (X * 2.5)% of damage dealt"
  if (bx) { share = true; if (!own(bx[1])) approx = bx[1]; rest = `${rest.slice(0, bx.index)}deal +(${bx[2]})% damage${rest.slice(bx.index + bx[0].length)}`; }
  else if (be) { share = true; if (!own(be[2])) approx = be[2]; rest = `${rest.slice(0, be.index)}deal +(${be[1]})% damage${rest.slice(be.index + be[0].length)}`; }
  else if (be2) { share = true; if (!own(be2[1])) approx = be2[1]; rest = `${rest.slice(0, be2.index)}deal +(${be2[2]})% damage${rest.slice(be2.index + be2[0].length)}`; }
  const be3 = /\bdeals?\s+\(\(([^()%]+)\)%\s+of\s+this Coin['’]s final damage\)\s+(?:(\w+)\s+)?damage/i.exec(rest);  // "Deal (([X] on self x 2)% of this Coin's final damage) Wrath damage"
  if (!bx && !be && !be2 && be3) { share = true; if (!own(be3[2])) approx = be3[2]; rest = `${rest.slice(0, be3.index)}deal +(${be3[1]})% damage${rest.slice(be3.index + be3[0].length)}`; }
  // "Deal ([X] Potency x [Y] Stack / 10) Wrath damage": a sin hit by two numbers
  const fm = /\bdeals?\s+\(([^()]+?)\s*\/\s*(\d+)\)\s+(Wrath|Lust|Sloth|Gluttony|Gloom|Pride|Envy)\s+damage/i.exec(rest);
  if (fm) {
    const qs = fm[1].split(/\s+x\s+/).map((p) => dcaT2(p, null, ctx));
    if (qs.every(Boolean)) return [{ k: "flat", v: 1 / +fm[2], per: qs.length > 1 ? { prod: qs } : qs[0], every: 0, sin: fm[3][0].toUpperCase() + fm[3].slice(1).toLowerCase() }];
  }
  // fixed bonus hit
  const fb = /\bdeals? (\d+) (Slash|Pierce|Blunt|Wrath|Lust|Sloth|Gluttony|Gloom|Pride|Envy) (?:bonus damage|damage to (?:the )?target)/i.exec(rest);
  if (fb) return [{ k: "flat", v: +fb[1], sin: fb[2][0].toUpperCase() + fb[2].slice(1).toLowerCase() }];
  // fixed sin hit
  rest = rest.replace(/"All" (\[\w+\])/, ["the sum of both", "$1"].join(" "));  // '"All" = the sum of both The Living and The Departed'
  if (/^- "All" = /i.test(rest)) return "none";
  const fq = /\b(?:deals?|inflicts?)\s+(Wrath|Lust|Sloth|Gluttony|Gloom|Pride|Envy)\s+damage equal to\s+((?:the sum of both )?\[\w+\](?:\s+(?:Potency|Count))?(?:\s+on\s+(?:the\s+)?(?:main\s+)?(?:target|self))?)\s*(?:\(max (\d+)\))?\s*$/i.exec(rest);
  if (fq) { const q = dcaT2(fq[2], null, ctx); if (q) return [{ k: "flat", v: 1, per: q, every: 0, sin: fq[1][0].toUpperCase() + fq[1].slice(1).toLowerCase(), cap: fq[3] ? +fq[3] : undefined }]; }
  const eq = /deal (\w+) damage equal to (?!.*% of this Coin's final damage).*\(max (\d+)\)/i.exec(rest);
  if (eq && /^(Wrath|Lust|Sloth|Gluttony|Gloom|Pride|Envy)$/i.test(eq[1])) return [{ k: "flat", v: +eq[2], sin: eq[1][0].toUpperCase() + eq[1].slice(1).toLowerCase() }];
  const based = /more damage based on (.+?)\s*\(\+(\d+(?:\.\d+)?)% (?:damage )?(?:per|for every) (?:(\d+)% )?([^,;)]+?)(?:[,;]\s*max \+?(\d+)%)?\)/i.exec(rest);
  if (based) {
    const q = dcaT2(based[3] ? `${based[4]}${/target/i.test(based[1]) ? " on target" : ""}` : based[4], null, ctx) || dcaT2(based[1], null, ctx);
    return q ? [{ k: "dyn", v: +based[2], per: q, every: +(based[3] || 1), cap: based[5] ? +based[5] : undefined }] : "unk";
  }
  // target SP, SP distance
  const tsp = /Deal \((-?)Target['’]s SP\s*\/\s*(\d+)\)% more damage/i.exec(rest);
  if (tsp) fx.push({ k: "dyn", v: 1 / +tsp[2], per: { g: "spT", neg: !!tsp[1] }, every: 0 });
  const far = /more damage the further (this unit['’]s|their|the target['’]s|target['’]s) SP(?: value)? is from (-?\d+)\s*\(\+(\d+(?:\.\d+)?)% damage for every missing SP,?\s*max (\d+)%/i.exec(rest);
  if (far) return [{ k: "dyn", v: +far[3], per: /^this/i.test(far[1]) ? { g: "sp", abs: true, from: +far[2], dir: 1 } : { g: "spT", abs: true, from: +far[2], dir: -1 }, every: 1, cap: +far[4] }];
  // "use Coin 1 and 2 an additional time"
  const again = /use Coins? (\d)(?:,? (?:and )?(\d))?(?:,? (?:and )?(\d))? an additional time/i.exec(rest);
  if (again) return again.slice(1).filter(Boolean).map((n) => ({ k: "reuse", v: 1, at: +n - 1 }));
  // "Reuse Coin ([X] - 1) times (4 times max)"
  const rx = /Reuse (?:this )?Coin \((.+?) - (\d+)\) times/i.exec(rest);
  const rx2 = /Reuse (?:this )?Coin \(\((.+?)\s*\/\s*(\d+)\) - (\d+)\) times/i.exec(rest);  // "Reuse this Coin (([X] consumed / 10) - 1) times (3 times max)"
  if (rx2) { const q = dcaT2(rx2[1], null, ctx), mx = /(\d+) times max|max (\d+) times/i.exec(rest); return q ? [{ k: "reuse", v: 1, per: q, every: +rx2[2], off: -rx2[2] * rx2[3], cap: mx ? +(mx[1] || mx[2]) : undefined }] : "unk"; }
  if (rx) { const q = dcaT2(rx[1], null, ctx), mx = /(\d+) times max|max (\d+) times/i.exec(rest); return q ? [{ k: "reuse", v: 1, per: q, every: 1, off: -rx[2], cap: mx ? +(mx[1] || mx[2]) : undefined }] : "unk"; }
  const EFF = /(Coin Power|Final Power|Base Power|Offense Level|Clash Power|Skill Power|Atk Weight)\s*([+-])\s*(\d+)|deals?\s+(?:an additional\s+)?\+\(([^%]*?)\)%\s+(?:more\s+)?(?:\w+\s+)?damage|takes?\s+\+(\d+(?:\.\d+)?)%\s+(?:more\s+)?damage|(?:deals?\s+(?:an additional\s+)?)?\+(\d+(?:\.\d+)?)%\s*(?:more\s+)?(?:\w+\s+)?damage|Reuse (?:this |the final )?Coin|([+-]\d+) (Final Power|Coin Power|Offense Level|Base Power|Skill Power|Atk Weight)|deals?\s+\w+\s+damage equal to (?:(\d+(?:\.\d+)?)|\(([^%]*?)\))% of this Coin's final damage/gi;
  for (let m; (m = EFF.exec(rest));) {
    if (m[1]) { if (/clash/i.test(m[1])) continue; fx.push({ k: { "coin power": "cp", "final power": "fp", "skill power": "fp", "base power": "bp", "offense level": "ol", "atk weight": "aw" }[m[1].toLowerCase()], v: (m[2] === "-" ? -1 : 1) * +m[3] }); }  // "Skill Power" = older word for Final Power
    else if (m[4] != null) {
      let e = m[4].replace(/\s+/g, " ").trim().replace(/\[(\w+)\] Potency x Count\b/i, "[$1] Potency x [$1] Count"), off = 0;
      // "+(50 + [Poise] on self + [Rupture] on target)%": a number plus counts
      const lead = /^(\d+(?:\.\d+)?) \+ (.+)$/.exec(e), tail = /^(.+) \+ (\d+(?:\.\d+)?)$/.exec(e);
      if (lead) { off = +lead[1]; e = lead[2]; } else if (tail && !/[x×/]/.test(e)) { off = +tail[2]; e = tail[1]; }
      const mm = /^(.+?)(\s+x\s+|\s*[×/*]\s*)(.+)$/.exec(e);
      let q = null, mul = 1;
      if (off && !mm) { q = dcaT2(e, null, ctx); if (!q) return "unk"; fx.push({ k: "dyn", v: 1, per: q, every: 0, off }); continue; }
      if (mm) {
        const a = dcaT2(mm[1], null, ctx), b = dcaT2(mm[3], null, ctx), na = parseFloat(mm[1]), nb = parseFloat(mm[3]);
        if (mm[2].trim() === "/" && a && Number.isFinite(nb)) { q = a; mul = 1 / nb; }
        else if (a && Number.isFinite(+mm[3])) { q = a; mul = +mm[3]; }
        else if (b && Number.isFinite(+mm[1])) { q = b; mul = na; }
        else if (a && b && mm[2].trim() !== "/") q = { prod: [a, b] };
      } else q = dcaT2(e, null, ctx);
      if (!q) return "unk";
      fx.push({ k: "dyn", v: mul, per: q, every: 0 });
    }
    else if (m[5] != null) fx.push({ k: "take", v: +m[5] });
    else if (m[6] != null) fx.push({ k: "dyn", v: +m[6] });
    else if (m[9] != null) fx.push({ k: "dyn", v: +m[9], own: 1 });
    else if (m[10] != null) {
      const mm = /^(.+?)\s+x\s+(\d+(?:\.\d+)?)$/.exec(m[10].trim()), q = mm && dcaT2(mm[1], null, ctx);
      if (!q) return "unk";
      fx.push({ k: "dyn", v: +mm[2], per: q, every: 0, own: 1 });
    }
    else if (m[7] != null) fx.push({ k: { "coin power": "cp", "final power": "fp", "skill power": "fp", "base power": "bp", "offense level": "ol", "atk weight": "aw" }[m[8].toLowerCase()], v: +m[7] });
    else if (/cannot|can't/i.test(rest)) return "none";
    else if (/\b(?:final|with (?:the|a)|by (?:the|a)|each|on)\s*$/i.test(rest.slice(0, m.index))) continue;  // "On Hit with the final Reuse Coin, …": names a coin, no Reuse
    else { const n = /Coin once/i.test(rest) ? 1 : +((/(\d+) times? max|max (\d+) times?|(\d+) times/i.exec(rest) || []).slice(1).find(Boolean) || (/twice/i.test(rest) ? 2 : 1));
      fx.push({ k: "reuse", v: n, last: /final/i.test(m[0]) }); }
  }
  if (!fx.length) return fx;
  const ev = dcaEvery(rest), cap = /\(max\s+(-?[\d.]+)%?(?:\)|,|;|\s+and\b)|[;,]\s*max\s+(-?[\d.]+)|\(down to (-?\d+)\)/i.exec(rest);
  if (ev) {
    const mm = /^(\d+(?:\.\d+)?)%?\s+(.+)$/.exec(ev[1].trim()), q = dcaT2(mm ? mm[2] : ev[1], null, ctx);
    if (!q) return "unk";
    fx.forEach((f) => { if (!f.per && f.k !== "reuse") { f.per = q; f.every = mm ? (q.scale ? Math.round(+mm[1] * q.scale) : +mm[1]) : 1; } });
  }
  const cap2 = /\(max (\d+);\s*max (\d+)%\)/i.exec(rest);  // first for the Power, second for the damage
  if (cap2) fx.forEach((f) => { if (f.k !== "reuse") f.cap = f.k === "dyn" ? +cap2[2] : +cap2[1]; });
  else if (cap) fx.forEach((f) => { if (f.k !== "reuse") f.cap = +(cap[1] ?? cap[2] ?? cap[3]); });
  if (approx) fx.forEach((f) => { if (f.k === "dyn") f.approx = approx; });
  if (share) fx.forEach((f) => { if (f.k === "dyn") f.share = ctx.allT ? "all" : true; });
  return fx.filter((f, i) => f.k !== "reuse" || fx.findIndex((g) => g.k === "reuse") === i);  // one Reuse per clause
}

// the words after "for every", up to "(max", ";" / "," or a closing bracket
function dcaEvery(t) {
  const m = /for (?:every|each) |\bper (?=[\d\[])/i.exec(t);
  if (!m) return null;
  let d = 0, i = m.index + m[0].length;
  const a = i;
  for (; i < t.length; i++) {
    const ch = t[i];
    if (ch === "(") { if (!d && /^\((?:max|down to)/i.test(t.slice(i))) break; d++; }
    else if (ch === ")") { if (!d) break; d--; }
    else if (!d && (ch === ";" || ch === ",")) break;
    else if (!d && / (or|On Hit|when|against)\b/i.test(t.slice(i, i + 9)) && /^ (or|On Hit|when|against)\b/i.test(t.slice(i))) break;
  }
  return [null, t.slice(a, i).trim().replace(/\.$/, "")];
}
const dcaOk = (c, s) => c.never ? false : !c.q ? true : c.lt ? dcaVal(c.q, s) < c.n : dcaVal(c.q, s) >= c.n && (c.max == null || dcaVal(c.q, s) <= c.max);
// value of one effect in a fight state (0 when a condition fails)
function dcaEff(f, conds, s) {
  if (f.crit && !s.g_crit) return 0;
  if (conds.some((c) => !dcaOk(c, s))) return 0;
  let v = f.v;
  if (f.per && (f.per.pow || f.per.hp1)) return v;  // per coin, in dcbCalc
  if (f.tiers) { const n = dcaVal(f.per, s); v = 0; for (const [at, tv] of f.tiers) if (n >= at) v = tv; }
  else if (f.per) { const n = Math.max(0, dcaVal(f.per, s) + (f.off || 0)); v = f.every ? f.v * Math.floor(n / f.every) : f.v * n; }
  if (f.cap != null) v = f.cap >= 0 ? Math.min(f.cap, v) : Math.max(f.cap, v);
  if (f.mul != null) v = f.k === "ol" ? Math.floor(v * f.mul) : v * f.mul;  // "boost by 50%"
  return v;
}
// what each term needs for the effect at its best: { key: value }
function dcaNeeds(f, conds, out) {
  const put = (q, n) => {
    if (q.res || q.pow || q.hp1) return;
    if (q.div) { put({ ...q, div: 0 }, n * q.div); return; }
    if (q.sub) n += q.sub;
    if (q.sum) { q.sum.forEach((p) => put(p, Math.ceil(n / q.sum.length))); return; }
    if (q.prod) { q.prod.forEach((p) => put(p, Math.ceil(Math.sqrt(n)))); return; }
    if (q.g) { const k = `g_${q.g}`; if (q.what) (out.__w ||= {})[q.g] = q.what; out[k] = q.abs ? 45 * (q.dir || 1) : q.g === "sp" || q.g === "spT" ? (q.neg ? Math.min(out[k] ?? 0, -n) : Math.max(out[k] ?? 0, n)) : Math.max(out[k] || 0, n); return; }
    const base = `${q.side[0]}_${q.kw}`, M = (k, v) => { out[k] = Math.max(out[k] || 0, v); };
    if (dcaG(q.kw).st === 2) {
      if (q.part === "c") { M(`${base}_c`, n); M(`${base}_p`, 1); } else { M(`${base}_p`, n); M(`${base}_c`, 1); }
    } else M(base, n);
  };
  conds.forEach((c) => {
    if (!c.q) return;
    if (!c.lt) put(c.q, c.max != null ? c.max : c.n);
    else if (c.n <= 0 && c.q.g) { const k = `g_${c.q.g}`; out[k] = Math.min(out[k] ?? 0, c.n - 1); }  // below a negative bound
  });
  if (f && f.tiers) put(f.per, f.tiers[f.tiers.length - 1][0]);
  if (f && f.per && f.v > 0) {
    const mx = (q) => q.sum ? q.sum.reduce((t, z) => t + (mx(z) || 0), 0) : q.kw && dcaG(q.kw).max;
    const n = f.k === "reuse" && f.cap == null ? (mx(f.per) || (f.every || 1) * 2) - (f.off || 0)  // uncapped Reuse count: 2
      : (f.cap != null && f.v ? (f.every ? f.every * Math.ceil(Math.abs(f.cap / f.v)) : Math.ceil(Math.abs(f.cap / f.v))) : mx(f.per) || (f.every || 1) * 5) - (f.off || 0);
    put(f.per, f.per.g === "sp" || f.per.g === "spT" ? 45 : f.per.g && f.cap == null ? DCA_G[f.per.g][2] : f.per.cap != null ? Math.min(f.per.cap, n) : n);
  }
}
function dcaFxText(f) {
  if (f.k === "only") return `${typeof f.scope === "number" ? `coin ${ROMAN[f.scope]} ` : ""}${f.v === 1 ? "hits only the main target" : f.v === 2 ? "hits only the other targets" : "hits the main target too"}`;
  if (f.k === "force") return "all Reuse effects switch on";
  if (f.tiers) return `${DCA_EFF[f.k]} ${f.tiers.map(([a, tv]) => `${dcSign(tv)} at ${a}+`).join(", ")} ${dcaLabel(f.per)}`;
  const v = f.k === "dyn" || f.k === "take" || f.k === "sub" ? `${f.per && !f.every ? `${+f.v.toFixed(2)}%` : `${dcSign(+f.v.toFixed(2))}%`}` : dcSign(f.v);
  if (f.k === "flat") return `${f.per ? `+(${dcaLabel(f.per)})${f.v !== 1 ? ` × ${+f.v.toFixed(2)}` : ""}` : `+${f.v}`} ${f.sin === "True" ? "" : `${f.sin} `}damage (best case)${typeof f.scope === "number" ? ` · coin ${ROMAN[f.scope]}` : f.scope === "reuse" ? " · Reuse hits" : ""}`;
  // "Reuse this Coin ([X] Potency - 1) times (4 times max)"
  if (f.k === "reuse" && f.per && f.off) return `Reuse (${dcaLabel(f.per)} − ${-f.off}) times${f.cap != null ? `, max ${f.cap}` : ""}${typeof (f.at ?? f.scope) === "number" ? ` · coin ${ROMAN[f.at ?? f.scope]}` : ""}`;
  const nm = f.k === "reuse" ? (f.v > 1 ? `Reuse ${f.v} times` : "Reuse once") : `${DCA_EFF[f.k]} ${f.per && !f.every ? `+(${dcaLabel(f.per)} × ${v})` : v}`;
  const per = f.per && f.every ? ` per ${f.every > 1 ? `${f.every} ` : ""}${dcaLabel(f.per)}` : "";
  const sc = f.at ?? f.scope, at = sc === "last" ? " · final coin" : typeof sc === "number" ? ` · coin ${ROMAN[sc]}` : "";
  return `${f.crit ? "on Critical Hit: " : ""}${nm}${per}${f.mul != null ? ` × ${f.mul} (the line above again)` : ""}${f.cap != null ? `, max ${f.cap}${f.k === "dyn" || f.k === "take" ? "%" : ""}` : ""}${f.best ? " (the top)" : ""}${at}`;
}
function dcaWhy(row, s) {
  for (const { f, conds } of row.parts) {
    if (f.crit && !s.g_crit) return "needs Critical Hits";
    const nv = conds.find((c) => c.never);
    if (nv) return nv.why || "only against Identities";
    for (const c of conds) if (c.q && !dcaOk(c, s)) return `needs ${c.lt ? "less than " : ""}${c.n}${c.lt ? "" : "+"} ${dcaLabel(c.q)} (now ${dcaVal(c.q, s)})`;
    if (f.per && !f.per.pow && !f.per.hp1 && !dcaVal(f.per, s)) return `needs ${dcaLabel(f.per)}`;
  }
  return "";
}

// the skill at an Uptie with its English texts
function dcaEnU(sk, u) {
  const e = UNITS.en && UNITS.en.sk[sk.id], k = e && Object.keys(sk.up).find((n) => sk.up[n] === u);
  return k && e[k] ? { ...u, ...e[k] } : u;
}
// skill consumes Charge: its text says so, or it inflicts a status a passive counts as that ("Skills that inflict [X] … count as Skills that consume [Charge] Count")
function dcaUsesCharge(u) {
  const t = [u.desc, ...(u.coindescs || []).flat()].join("\n");
  if (/Consume[^\n]*\[(?:Charge|ChargeNoirAlly)\]|\[Charge\] Count (?:is )?consumed/i.test(t)) return true;
  const ps = dcaX ? (dcaX.passives || []).map((p) => dcaEn("ps", p.id, p.desc) || "").join("\n") : "";
  return [...ps.matchAll(/Skills that inflict \[(\w+)\][^\n]*count as Skills that consume \[Charge\] Count/gi)].some((m) => new RegExp(`Inflict[^\\n]*\\[${m[1]}\\]`, "i").test(t));
}
function dcaModel(x, sk, up) {
  const key = `${x.id}.${sk.id}.${up}`;
  if (DCA.has(key)) return DCA.get(key);
  dcaX = x;
  let u0 = cqAt(sk, up);
  if (!u0 || !u0.atk) return null;
  let u = dcaEnU(sk, u0);
  const slots = dcSlots(x), label = (slots.find(([, q]) => q === sk) || ["Skill"])[0], short = label.replace(/^Skill /, "S").replace(/^Counter$/, "C");
  // "At 6+ …, use 'Write 'em all down' as Counter": the Counter is counted as that Skill (the last one named)
  const nm = (z) => dcaPlain(z).toLowerCase().replace(/[^a-z0-9]+/g, "").replace(/(.)\1+/g, "$1"), turns = [];  // letters only, repeats folded ("COUPOOOONS")
  for (const m of String(u.desc).matchAll(/^.*Reson.*?use\s+(.+?)\s+(?:Skills?\s+)?as (?:a )?Counter.*$/gim)) for (const q of m[1].matchAll(/["“‘'](.+?)["”’'](?=\s|,|\.|$)/g)) turns.push(nm(q[1]));
  const cand = x.skills.filter((q) => { const v = cqAt(q, up); return v && v.atk; }), nameOf = (q) => nm(dcaEnU(q, cqAt(q, up)).name);
  const into = turns.length && (turns.slice().reverse().map((t) => cand.find((q) => nameOf(q) === t)).find(Boolean) || turns.slice().reverse().map((t) => cand.find((q) => nameOf(q).startsWith(t))).find(Boolean));
  if (into) { u0 = cqAt(into, up); u = { ...dcaEnU(into, u0), into: dcaPlain(u0.name), from: u.desc }; }
  const ramp = /^\s*\[WideAreaRampage\]\s*$/m.test(String(u.desc));  // every Coin flips against one random target
  const rows = [], nodmg = [], needs = {}, gains = new Map(), seen = new Set(), exprGains = [];
  const note = (pn, h, unk) => nodmg.push(`${pn ? `<span class="dcbpn">${esc(pn)}</span> ` : ""}${dcbText(h)}${unk ? ` <span class="dcbunk">not read yet</span>` : ""}`);
  const gainsOf = (t0, from) => {
    const t = dcaNames(t0);
    const put = (side, kw, n, count) => {
      if (!dcaG(kw).st || !side) return;
      const k = `${side[0]}_${kw}`, e = gains.get(k) || { side, kw, p: 0, c: 0, from: [] };
      if (count) e.c = Math.max(e.c, n); else e.p = Math.max(e.p, n);
      if (!e.from.includes(from)) e.from.push(from);
      (e.lines ||= new Set()).add(`${from}: ${t0}`);  // where it was given
      gains.set(k, e);
    };
    // "gain 1 [A] and 2 [B] next turn", "gain [A] and [B] equal to … (max 3)": every status of the clause
    for (const m of t.matchAll(/\b(gain|gains|inflict|inflicts|apply|applies)\b((?:(?!\b(?:gain|gains|inflict|inflicts|apply|applies)\b)(?:[^.;]|\.\d|\.(?=\s*[\/)])))*)/gi)) {
      // "… Fixer Sinclair gains": another Sinner's Identity, not this one
      const before = t.slice(0, m.index).split(/[.;:\n]/).pop().trim();
      if (/^(gains|applies|inflicts)$/i.test(m[1]) && (UNITS.sinners || []).some((n) => n !== x.sinnerName && before.endsWith(n))) continue;
      // another unit gains
      if (/^gains$/i.test(m[1]) && /\b(?:ally|allies|attacker|enemy|enemies|opponent)\b/i.test(before) && !/\bthis unit\b/i.test(before.split(",").pop())) continue;
      const side = /^(gain|apply)/i.test(m[1]) ? (/^appl/i.test(m[1]) && !/on self|to self/i.test(m[2]) && !/\b(?:on|to) self\b/i.test(t) ? "" : "self") : "target";
      const cl = m[2], upTo = /for every|every time|equal to/i.test(cl) && (/\(max (\d+)\)/i.exec(cl) || /\(max (\d+)\)/i.exec(t));
      // gain by expression
      let viaExpr = false;
      for (const q of cl.matchAll(/\(([^()]+?)\s*\/\s*(\d+)\)\s+\[(\w+)\](\s+(?:Count|Potency))?|\[(\w+)\](\s+(?:Count|Potency))?\s+by\s+\(([^()]+?)\s*\/\s*(\d+)\)/g)) {
        const to = q[3] || q[5], term = dcaTerm(q[1] || q[7], null, {}), pt = (q[4] || q[6] || "").trim(), mx = /\(max (\d+)\)/i.exec(cl);
        if (!term || !dcaG(to).st || side !== "self") continue;
        exprGains.push({ to, side, part: /^c/i.test(pt) ? "c" : dcaG(to).st === 2 ? "p" : "s", v: 1, every: +(q[2] || q[8]), cap: mx ? +mx[1] : undefined, q: term, name: from, line: t0 });
        viaExpr = true;
      }
      if (viaExpr) continue;
      // gift by "for every"
      const fe = /\bfor (?:every|each) (?:(\d+)%? )?(.+?)\s*(?:\(max |[,;]|$)/i.exec(cl), fq = fe && dcaTerm(fe[2].replace(/\s+/g, " "), null, {}), fmx = /\(max (\d+)/i.exec(cl);
      if (fq) {
        let last = 1, got = 0;
        for (const q of cl.slice(0, fe.index).matchAll(/(?:(\+?)(\d+)\s+)?\[(\w+)\](\s+(?:Count|Potency))?/g)) {
          if (!dcaG(q[3]).st || (fq.kw === q[3] && fq.side === side)) continue;  // not from itself
          if (q[2]) last = +q[2];
          exprGains.push({ to: q[3], side, part: /Count/.test(q[4] || "") ? "c" : dcaG(q[3]).st === 2 ? "p" : "s", v: last, every: +(fe[1] || 1), cap: fmx ? +fmx[1] : undefined, q: fq, name: from, line: t0 });
          got++;
        }
        if (got) continue;
      }
      // "When hit, gain 1 [X] next turn (3 per turn)": up to 3 times
      const times = /\((?:up to )?(\d+)(?: times)? per turn\)/i.exec(t.slice(m.index)), k = times && /^(when|on|after|every time)\b/i.test(before || t) ? +times[1] : 1;
      let any = false;
      for (const q of cl.matchAll(/(\+?)(\d+)\s+\[(\w+)\](\s+Count)?/g)) { any = true; put(side, q[3], upTo ? Math.max(+q[2], +upTo[1]) : +q[2] * k, q[1] || q[4]); }
      // "and [B]" takes the number
      for (const q of cl.matchAll(/(\d+)\s+(?:\[\w+\]|[A-Z][a-z]+)(?:\s+Count)?\s*(?:,|,? and)\s+\[(\w+)\](\s+Count)?/g)) put(side, q[2], +q[1] * k, q[3]);
      if (!any && upTo) for (const q of cl.matchAll(/\[(\w+)\]/g)) put(side, q[1], +upTo[1], false);
      // "gain [A]" without a number = 1; "[A] / [B] / [C]" = a choice: the last one
      else if (!any) {
        const lead = /^\s*((?:\[\w+\]\s*(?:\/|,|and|or)?\s*)+)/.exec(cl);
        if (lead) { const ks = [...lead[1].matchAll(/\[(\w+)\]/g)].map((q) => q[1]); (/\//.test(lead[1]) ? ks.slice(-1) : ks).forEach((kw) => put(side, kw, dcaDeath(kw) ? dcaDeath(kw).base : 1, false)); }
      }
    }
    // "Max Blunt DMG Up gained by this effect: 5"
    for (const q of t.matchAll(/Max \[(\w+)\] gained by this effect: (\d+)/gi)) put("self", q[1], +q[2], false);
  };
  // texts of this skill (rows), and the rest of the kit (statuses it gives)
  const read = (txt, ctx, mk) => String(txt || "").split("\n").forEach((l) => { const r = dcaLine(l, ctx); if (r) mk(r, l); });
  const skillRow = (r, l, k, from) => {
    const up = r.fx && r.inst && /^\s*[-•·]/.test(dcaPlain(l)) && rows.length && rows[rows.length - 1].from === from && rows[rows.length - 1];
    if (up) { up.parts.push(...r.fx.map((f) => ({ f, conds: r.conds, inst: true }))); up.text += "\n" + l; r.fx.forEach((f) => dcaNeeds(f, r.conds, needs)); }
    else if (r.fx) { rows.push({ k, stack: "skill", title: from, from, parts: r.fx.map((f) => ({ f, conds: r.conds })), text: l }); r.fx.forEach((f) => dcaNeeds(f, r.conds, needs)); }
    else if (r.unk) note(from, l, true);
    else if (r.none && !r.why) note(from, l);
    else if (r.why) note(from, `${l} — ${r.why}`);
  };
  // what the coins spend ("Spend 2 [Bullet]"), for "… about to be spent by this Skill"
  const spent = {};
  for (const m of (u.coindescs || []).flat().join("\n").matchAll(/Spend (?:up to )?(\d+|all of) \[(\w+)\]/gi)) spent[m[2]] = (spent[m[2]] || 0) + (/all/i.test(m[1]) ? Infinity : +m[1]);
  const kind = { atk: u.atk, sin: u.sin, op: u.op, tier: (/^Skill (\d)/.exec(label) || [])[1], spent, name: dcaPlain(u.name), ncoins: u.coins, skillTxt: [u.desc, ...(u.coindescs || []).flat()].join("\n").split("\n").map((l) => dcaNames(dcaPlain(l))),
    coinTexts: (u.coindescs || []).map((cd) => dcaNames(dcaPlain(cd.join(" ")))) }, sctx = { ...kind };
  let n = 0;
  read(u.desc, sctx, (r, l) => { gainsOf(dcaPlain(l), short); if (!r.gain) skillRow(r, l, `s${n++}`, short); });
  (u.coindescs || []).forEach((cd, i) => {
    const cctx = { ...kind, coin: i };
    cd.forEach((d) => read(d, cctx, (r, l) => { gainsOf(dcaPlain(l), `${short} coin ${ROMAN[i]}`); if (!r.gain) skillRow(r, l, `c${i}.${n++}`, `${short} coin ${ROMAN[i]}`); }));
  });
  // the rest of the kit: only for statuses
  const kit = x.title ? [...x.skills, ...(x.defense || [])] : x.skills;
  kit.forEach((q) => { if (q === sk) return; const v = cqAt(q, up) && dcaEnU(q, cqAt(q, up)); if (!v) return; const nm = (slots.find(([, z]) => z === q) || [v.name])[0];
    [v.desc, ...(v.coindescs || []).flat()].forEach((t) => String(t || "").split("\n").forEach((l) => gainsOf(dcaPlain(l), nm))); });

  // passives: battle ones at this Uptie (upgrades keep their earlier versions in prev), support ones off by default
  let pi = 0;
  const pname = {}, pnote = {};  // passive names; where each "nothing for damage here" note is
  for (const p0 of x.passives || []) {
    let p = p0;
    while (p && (p.uptie || 0) > up) p = p.prev;
    if (!p || p.kind === "support") continue;  // support passives: not counted at all (user)
    const pn = `P${++pi}`; pname[pn] = p.name;
    const cost = (p.cost || []).map((c) => `${sinIcon(c.sin)} ${c.n}`).join(" ");
    const from = `${cost}${cost ? (p.mode === "res" ? " Resonance" : " owned") : "always on"}${p.kind === "support" ? " · support: only if it lands on this unit" : ""}`;
    const pctx = { ...kind, replWith: (/replace [^"]*?with "([^"]+)"/i.exec(dcaEn("ps", p.id, p.desc)) || [])[1] }, parts = [], left = [];  // "replace the Skill with \"X\"": the lines below are X's

    read(dcaEn("ps", p.id, p.desc), pctx, (r, l) => {
      gainsOf(dcaPlain(l), pn);
      if (r.fx && !r.late) r.fx.forEach((f0) => {
        const prev = r.inst && [...parts].reverse().find((p) => p.f.k === f0.k), f = prev && !f0.per && f0.cap != null && prev.f.per && prev.f.scope === f0.scope ? { ...f0, per: prev.f.per, every: prev.f.every } : f0;
        parts.push({ f, conds: r.conds, inst: r.inst }); dcaNeeds(f, r.conds, needs);
      });
      else if (r.unk) left.push([l, true]);
    });
    if (parts.length) rows.push({ k: `p${pi}${pn}`, stack: "pass", pn, title: p.name, from, parts, text: dcaEn("ps", p.id, p.desc), off: p.kind === "support" });
    else { pnote[pn] = nodmg.length; note(pn, `<b>${esc(p.name)}</b>${left.length ? "" : ": nothing for damage here"}`, false); }
    left.forEach(([l]) => note(pn, l, true));
  }

  // statuses: what they do to damage (game abilities first, else their text with "Stack" = their own number)
  const stRows = [], chains = [];
  // forms ("[X] exclusive Skill"): a Skill of one form does not have the statuses of the other forms
  const formKws = new Set();
  let ownForm = null;
  [...x.skills, ...(x.defense || [])].forEach((q) => { const v = cqAt(q, up); if (!v) return; const f = /^\s*\[(\w+)\] exclusive Skill/m.exec(dcaPlain(dcaEnU(q, v).desc).replace(/ \| /g, "\n")) || /^\s*\[(\w+)\] exclusive Skill/.exec(dcaPlain(dcaEnU(q, v).desc)); if (f) { formKws.add(f[1]); if (q === sk) ownForm = f[1]; } });
  const tryStatus = (side, kw, from, val, src = []) => {
    if (ownForm && formKws.has(kw) && kw !== ownForm) return;
    const id = `${side[0]}_${kw}`;
    if (seen.has(id)) return;
    seen.add(id);
    const g = dcaG(kw), fit = (f) => !f[2] || f[2] === u.atk || f[2] === u.sin;
    const q = { kw, side, part: "s" }, parts = [];
    const own = (g.fx || []).filter(fit).filter((f) => side === "self" ? /^(dmg|ol|fp|cp|bp)/.test(f[0]) : /^(take|def)/.test(f[0]));
    if (own.length) for (const [k, v, , lim] of own) {
      if (k === "olper") { parts.push({ f: { k: "ol", v: 1, per: q, every: v, scope: "all" }, conds: [] }); continue; }  // +1 per v Stacks
      const one = /1$/.test(k), kk = k.replace(/1$/, ""), map = { dmg: "dyn", take: "dyn", ol: "ol", def: "ol", fp: "fp", cp: "cp", bp: "bp" }[kk];
      const val2 = kk === "dmg" || kk === "take" ? v * 100 : kk === "def" ? -v : v;
      const cap = lim ?? (g.max && (kk === "dmg" || kk === "take") ? +(val2 * g.max).toFixed(2) : undefined);
      parts.push({ f: one ? { k: map, v: val2, scope: "all" } : { k: map, v: val2, per: q, every: 1, scope: "all", cap }, conds: one ? [{ q, n: 1 }] : [] });
    }
    // its text: everything when the game lists no abilities we read, else only kinds the abilities don't cover
    const covered = new Set(parts.map(({ f }) => f.k));
    if (dcaEn("gl", kw, g.desc) && (!(g.fx || []).length || own.length)) {
      const c = { ...kind, own: kw, ownSide: side };
      // tiers: "… based on Corpus Ingredient Potency:" / "based on Stack:", then "- 2+ : …", "· At 10+ Stack: …", "· 11~20: …" need that many
      let tq = null;
      String(dcaEn("gl", kw, g.desc)).split("\n").forEach((l0) => {
        const hd = /\bbased on (?:(.+?) (Potency|Count)|Stacks?):\s*$/i.exec(l0);
        if (hd) { const k2 = hd[1] && ((/^\[(\w+)\]$/.exec(hd[1]) || [])[1] || dcaNm1(hd[1])); tq = !hd[1] ? q : k2 && dcaG(k2).st ? { kw: k2, side, part: dcaG(k2).st === 1 ? "s" : hd[2][0].toLowerCase() } : null; return; }
        const tm = tq && /^\s*[-·]\s*(?:At\s+)?(\d+)(\+|~(\d+))?(?:\s+Stacks?)?\s*:\s*(.+)$/i.exec(l0);
        if (!tm && !/^\s*·/.test(l0)) tq = null;
        const tc = tm ? [{ q: tq, n: +tm[1], ...(tm[3] ? { max: +tm[3] } : {}) }] : [], l = tm ? tm[4] : l0;
        const r = dcaLine(l, c); if (!r || !r.fx || r.late) return;
        const fx = r.fx.filter((f) => (side === "self" ? f.k !== "take" : f.k === "take") && !covered.has(f.k === "take" ? "dyn" : f.k));
        // a line not counting the status itself works only while it is there
        const has = (f) => (f.per && f.per.kw === kw) || r.conds.some((c) => c.q && c.q.kw === kw);
        fx.forEach((f) => parts.push({ f: { ...f, k: f.k === "take" ? "dyn" : f.k, scope: "all" }, conds: [...(has(f) ? r.conds : [...r.conds, { q, n: 1 }]), ...tc] })); });
    }
    // own status that makes enemies take more from Charge skills (Sanctum: "+10% … ("Le Noir" … +20% instead)")
    const cg = side === "self" && /Take \+(\d+)% damage from Skills that consume Charge Count(?: or Unique Charge)?(?: \(from "([^"]+)" allied Identities' Skills, take \+(\d+)% damage instead\))?/i.exec(dcaEn("gl", kw, g.desc) || "");
    if (cg && dcaUsesCharge(u)) parts.push({ f: { k: "dyn", v: +(cg[2] && dcaX && dcaX.title.includes(cg[2]) ? cg[3] : cg[1]), scope: "all" }, conds: [{ q, n: 1 }] });
    // status on the target: "Take +(Stack x N)% damage from <A>-faction Identities" (· "If the attacker is in both <A> faction and <B> faction, … +(Stack x M)% … instead"): by the attacker's factions
    const fa = side === "target" && /Take \+\(Stack x ([\d.]+)\)% damage from (?:the )?(.+?)-faction Identities(?:[^]*?If the attacker is in both (.+?) faction and (.+?) faction, take \+\(Stack x ([\d.]+)\)% damage instead)?/i.exec(dcaEn("gl", kw, g.desc) || "");
    if (fa && dcaX) { const as = dcaX.assoc || [], v = fa[3] && as.includes(fa[3]) && as.includes(fa[4]) ? +fa[5] : as.includes(fa[2]) ? +fa[1] : 0; if (v) parts.push({ f: { k: "dyn", v, per: q, every: 1, scope: "all" }, conds: [] }); }
    // chain: gives other statuses
    let linked = 0;
    if (side === "self") for (const c of dcaChain(kw)) {
      const k2 = `${c.side[0]}_${c.to}`, ch = { ...c, from: kw, q: { kw, side: "self", part: c.src } };
      chains.push(ch);
      const gn = (UNITS.en && UNITS.en.gn[kw]) || g.name || kw;
      const cl = [...DCA_CH.get(kw).lines], hits = cl.filter((l) => l.includes(`[${c.to}]`));
      tryStatus(c.side, c.to, [esc(gn)], -1, (hits.length ? hits : cl).map((l) => `${gn}: ${l}`));
      const ks = dcaG(c.to).st === 2 ? [`${k2}_p`, `${k2}_c`] : [k2];
      // counts if used
      const dummy = c.side === "target" && dcaG(c.to).st === 2 && (u.inf || []).some(([, k]) => k === c.to);
      if (!dummy && !ks.some((z) => z in needs) && !stRows.some((r) => r.k === `st.${k2}`)) { chains.splice(chains.indexOf(ch), 1); continue; }
      ks.forEach((z) => { if (!(z in needs)) needs[z] = 0; });
      linked++;
    }
    if (!parts.length && !linked) return;
    // its own number: what the kit gives (else 1); a status whose game ability has its own cap goes to that cap
    const rare = own.some((f) => f[3] != null);
    parts.forEach(({ f, conds }) => dcaNeeds(!rare && (own.length || f.cap == null && !(g.max <= 10)) && f.per && f.per.kw === kw ? null : f, conds, needs));
    const mine = `${side[0]}_${kw}`;
    if (needs[mine] > (g.max || 99)) needs[mine] = g.max;
    if (val >= 0) dcaNeeds(null, [{ q, n: Math.min(val || 1, g.max || 99) }], needs);
    if (parts.length) stRows.push({ k: `st.${id}`, stack: "skill", title: `${dcbK(kw)} on ${side}`, from: from.length ? `from ${from.slice(0, 3).join(", ")}` : "status", parts, text: dcaEn("gl", kw, g.desc) || "", lines: src.length ? [...src].slice(0, 4) : undefined, how: !!src.length, srcs: from });
  };
  // own-number lines are chains
  for (const e of [...gains.values()]) if (e.side === "self" && (e.p || e.c)) { const d = dcaEn("gl", e.kw, dcaG(e.kw).desc); dcaChain(e.kw); if (d) String(d).split("\n").filter((l) => !DCA_CH.get(e.kw).lines.has(dcaPlain(l))).forEach((l) => gainsOf(dcaPlain(l), e.from[0] || "P1")); }
  // statuses the kit gives (any skill or passive) start at that value; a negative one on self (Damage Down …) is a cost: there, at 0
  // on the target: only what this skill or a passive puts there starts on (another skill's Fragile etc. starts at 0)
  const tgt0 = (e) => e.side === "target" && !e.from.some((f) => /^(P\d+|S)$/.test(f) || f === short || f.startsWith(`${short} coin`));
  gains.forEach((e) => tryStatus(e.side, e.kw, e.from, e.side === "self" && dcaG(e.kw).type === "neg" || tgt0(e) ? -1 : e.p || e.c, e.lines ? [...e.lines] : []));
  // gifts by expression
  for (const c of exprGains) {
    const k2 = `${c.side[0]}_${c.to}`, ks = dcaG(c.to).st === 2 ? [`${k2}_p`, `${k2}_c`] : [k2], ch = { ...c, from: c.name };
    if (chains.some((z) => z.to === c.to && z.name === c.name && z.every === c.every && z.side === c.side) || tgt0({ side: c.side, from: [c.name] })) continue;  // target: this Skill / passives only
    chains.push(ch);
    tryStatus(c.side, c.to, [esc(c.name)], -1, c.line ? [`${c.name}: ${c.line}`] : []);
    if (!ks.some((z) => z in needs) && !stRows.some((r) => r.k === `st.${k2}`)) { chains.splice(chains.indexOf(ch), 1); continue; }
    ks.forEach((z) => { if (!(z in needs)) needs[z] = 0; });
    dcaNeeds(null, [{ q: c.q, n: c.every * 5 }], needs);
  }
  // "Gain 1 [X] every time this unit consumes 10 cumulative [X] Count" (passive) + this Skill consumes [X] Count: Potency up for the checks after it
  const cu = /At (\d+)\+ \[(\w+)\] Count, consume up to (\d+) \[\2\] Count/i.exec(dcaPlain(u.desc));
  if (cu && dcaG(cu[2]).st === 2) for (const p of x.passives || []) {
    if (p.kind !== "battle") continue;
    const g = new RegExp(`Gain (\\d+) \\[${cu[2]}\\] every time this unit consumes (\\d+) cumulative \\[${cu[2]}\\] Count`, "i").exec(dcaPlain(dcaEn("ps", p.id, p.desc) || ""));
    if (g) chains.push({ from: cu[2], to: cu[2], side: "self", part: "p", v: +g[1], every: +g[2], at: +cu[1], q: { kw: cu[2], side: "self", part: "c", cap: +cu[3] }, name: `${dcaPlain(p.name)} (Count consumed)` });
  }
  // statuses the rows check also count by themselves
  const walk = (q) => { if (!q) return; if (q.sum) q.sum.forEach(walk); else if (q.kw) tryStatus(q.side, q.kw, [], 0); };
  [...rows].forEach((r) => r.parts.forEach(({ f, conds }) => { walk(f.per); conds.forEach((c) => walk(c.q)); }));
  // a status only passives give sits in the Passives block; a passive that gives a counted status is not "nothing for damage"
  for (const r of stRows) {
    if (r.srcs.length && r.srcs.every((f) => f in pname)) Object.assign(r, { stack: "pass", pn: r.srcs.join(", "), from: r.srcs.map((f) => esc(pname[f])).join(", ") });
    r.srcs.forEach((f) => { if (f in pnote) nodmg[pnote[f]] = null; });
  }
  nodmg.splice(0, nodmg.length, ...nodmg.filter((h) => h != null));
  rows.push(...stRows);
  rows.forEach((r) => { r.fx = r.parts.map(({ f }) => dcaFxText(f)); r.need = (s) => dcaWhy(r, link(s).s);
    // skill rows: named by their condition or what they count
    const c0 = r.parts[0].conds.filter((c) => c.q).pop(), per = r.parts.find(({ f }) => f.per);  // the line's own condition, not its header's
    if (r.stack === "skill" && !r.k.startsWith("st.")) r.title = c0 ? `${c0.lt ? "under " : ""}${c0.n}${c0.lt ? "" : "+"} ${dcaLabel(c0.q)}` : per ? dcaLabel(per.f.per) : r.parts.map(({ f }) => dcaFxText(f)).join(", ");
    const unk = r.parts.flatMap(({ conds }) => conds.filter((c) => c.unk).map((c) => c.unk));
    const ap = [...new Set(r.parts.map(({ f }) => f.approx).filter(Boolean))];
    if (unk.length || ap.length) r.note = [unk.length ? `counted as met: ${esc(unk.join("; "))}` : "", ap.length ? `${esc(ap.join(", "))} bonus damage, counted as this Skill's own type` : ""].filter(Boolean).join(" · "); });

  // Time Moratorium (T Corp): the stored damage comes back +15% per stack as Sloth damage
  if (/\[TimeSuspend\]/.test(JSON.stringify([x.skills.map((q) => Object.values(q.up).map((v) => { const e = dcaEnU(q, v); return [e.desc, e.coindescs]; })), (x.passives || []).map((p) => dcaEn("ps", p.id, p.desc))]))) {
    rows.push({ k: "tm", stack: "skill", title: `${dcbK("TimeSuspend")} on target`, from: "this Identity's kit", parts: [{ f: { k: "tm", v: 1, per: { g: "tm" }, every: 1, scope: "all" }, conds: [] }], text: dcaEn("gl", "TimeSuspend", dcaG("TimeSuspend").desc) || "",
      fx: [DCA_EFF.tm], need: (s) => s.g_tm ? "" : "needs Time Moratorium on the target" });
    needs.g_tm = 2;
  }
  if ("g_aw" in needs) needs.g_aw = Math.max(0, (u.targets || 1) - 1);
  if ("g_stag" in needs) needs.g_stag = 0;  // "Target is Staggered" starts off (user): on = res ×2.0 + the texts' Staggered conditions
  // Critical Hits: a Poise Identity (the game's own tag) or this skill's text talks of Poise / crits
  if ((x.statuses || []).includes("Breath") || /Critical|\[Breath\]|\bPoise\b/i.test([u.desc, ...(u.coindescs || []).flat()].join("\n"))
    || rows.some((r) => r.parts.some(({ f }) => f.crit))) needs.g_crit = 1;

  // the target: statuses with Potency and Count, from the sliders and the coin scripts
  const inf = (u.inf || []).filter(([, kw]) => dcaG(kw).st === 2);
  const tKws = new Set(inf.map(([, kw]) => kw));
  // Tremor Burst: moves the Stagger bar by Tremor Potency (no HP damage); coin lines hit on that coin, skill lines on every hit or the final one, passives once
  const bursts = [];
  const tb = (l, where, from) => {
    const p = dcaPlain(l);
    if (!/\btrigger(?:s)? \[VibrationExplosion\]/i.test(p) || /\b(?:upon|when|after) triggering\b|on self\b/i.test(p)) return;
    const t2 = /\[VibrationExplosion\] (\d+) times/i.exec(p), cut = /reduce (?:the )?(?:target's )?\[Vibration\] Count by (\d+)/i.exec(p);
    bursts.push({ ...where, n: t2 ? +t2[1] : /\btwice\b/i.test(p) ? 2 : 1, cut: cut ? +cut[1] : 0, from, cond: /^\s*(?:\[\w+\]\s*)?(?:-\s*)?(?:if|at)\b/i.test(p) });
  };
  String(u.desc || "").split("\n").forEach((l) => { const p = dcaPlain(l); tb(l, /final (?:Reuse )?Coin/i.test(p) ? { last: true } : /\[WinDuel\]/.test(p) ? { first: true } : { all: true }, label); });
  (u.coindescs || []).forEach((cd, i) => cd.forEach((d) => String(d).split("\n").forEach((l) => tb(l, { coin: i }, `Coin ${ROMAN[i]}`))));
  // passives burst on the Skill they talk about, never on a follow-up they use themselves
  if (x.title && !dcaFollowUps(x).has(dcaBare(u.name))) for (const p0 of x.passives || []) {
    let p = p0;
    while (p && (p.uptie || 0) > up) p = p.prev;
    if (p && p.kind !== "support") String(dcaEn("ps", p.id, p.desc)).split("\n").forEach((l) => { if (/^\W*(?:On Hit|·|-)/i.test(dcaPlain(l))) tb(l, /Final Coin/i.test(l) ? { last: true } : { first: true }, dcaPlain(p.name)); });
  }
  const bsin = [u.desc, ...(u.coindescs || []).flat()].map((l) => /\bdeals? (Slash|Pierce|Blunt|Wrath|Lust|Sloth|Gluttony|Gloom|Pride|Envy) damage equal to (?:Tremor Burst|\[VibrationExplosion\]) damage/i.exec(dcaNames(dcaPlain(l)))).find(Boolean);  // "Deal Blunt damage equal to Tremor Burst damage"
  if (bursts.length) tKws.add("Vibration");
  // "Trigger [Switch_Vibration] into [VibrationFocusing]": from that coin on, every Burst also deals Focus's Sloth damage
  const focusAt = (u.coindescs || []).findIndex((cd) => cd.some((d) => /\[Switch_Vibration\] into \[VibrationFocusing\]/i.test(dcaPlain(d)))), fz = dcaFocus();
  // one-number statuses the coins put on the target ("Inflict 1 [NoirNailDonQuixote]") and take off ("Consume all [X] on target")
  const inf1 = [], eat1 = [];
  (u.coindescs || []).forEach((cd, i) => cd.join("\n").split("\n").forEach((l) => {
    const p = dcaNames(dcaPlain(l));
    for (const q of p.matchAll(/\bInflict (?:\+?(\d+) )?\[(\w+)\]/gi)) if (dcaG(q[2]).st === 1 && (q[1] || dcaDeath(q[2])) && !/^\s*next turn/i.test(p.slice(q.index + q[0].length))) inf1.push([i, q[2], q[1] ? +q[1] : dcaDeath(q[2]).base, /\[OnSucceedAttackHead\]/.test(p) ? "H" : ""]);
    const ea = /Consume all \[(\w+)\] on (?:the )?target/i.exec(p);
    if (ea && dcaG(ea[1]).st === 1) eat1.push([i, ea[1]]);
  }));
  const t1 = [...new Set([...inf1.map(([, k]) => k), ...eat1.map(([, k]) => k), ...Object.keys(needs).map((k) => /^t_(\w+)$/.exec(k)).filter((q) => q && dcaG(q[1]).st === 1 && (dcaBurstHit(q[1]) || dcaDeath(q[1]))).map((q) => q[1])])];
  t1.forEach((kw) => { if (!(`t_${kw}` in needs)) needs[`t_${kw}`] = 0; });
  // what inflicting them costs (a passive's Count price): the own Count becomes a slider, its max start pays the bonus every time
  const pay1 = Object.fromEntries(inf1.map(([, kw]) => [kw, dcaInfPay(kw)]).filter(([, r]) => r));
  Object.entries(pay1).forEach(([kw, r]) => {
    const n = inf1.filter(([, k]) => k === kw).length, k = `s_${r.by}_c`;
    needs[k] = Math.max(needs[k] || 0, r.at + (n - 1) * r.hi);
    if (!(`s_${r.by}_p` in needs)) needs[`s_${r.by}_p`] = 0;
  });
  // damage-taken debuffs this Skill puts on the target one coin after another ("Inflict 2 Fragile"): the next coins already feel them
  const seqKws = [];
  for (const r of rows) {
    const mm = /^st\.t_(\w+)$/.exec(r.k);
    if (!mm || r.parts.length !== 1 || !inf1.some(([, k]) => k === mm[1])) continue;
    const { f } = r.parts[0];
    if (f.k !== "dyn" || !f.per || f.per.kw !== mm[1]) continue;
    r.seq = inf1.filter(([, k]) => k === mm[1]).map(([i, , n]) => [i, n]);
    seqKws.push(mm[1]);
  }
  const deaths = t1.filter((kw) => dcaDeath(kw));  // Deathrites on the target
  deaths.forEach((kw) => { const d = dcaDeath(kw); if (/10\+ Speed/i.test(d.by)) needs.g_speed = Math.max(needs.g_speed || 0, 10); if (/Critical Hit/i.test(d.by)) needs.g_crit = 1; });
  Object.keys(needs).forEach((k) => { const m = /^t_(\w+?)_(p|c)$/.exec(k); if (m) tKws.add(m[1]); });
  tKws.forEach((kw) => { for (const p of ["p", "c"]) { const k = `t_${kw}_${p}`; if (!(k in needs)) needs[k] = 0; } });
  const stk = tKws.has("Sinking") ? "Sinking" : tKws.has("Burst") ? "Burst" : "";

  // sliders: self first, then the target
  const sliders = [], pairs = [], start = {};
  const keys = Object.keys(needs).sort((a, b) => (a[0] === "t") - (b[0] === "t") || a.localeCompare(b));
  for (const k of keys) {
    let m, label, lo = 0, hi = 20;
    if ((m = /^g_(\w+)$/.exec(k))) { if (m[1] === "aw" || m[1] === "hit") continue; [label, lo, hi] = DCA_G[m[1]]; if (needs.__w && needs.__w[m[1]]) label = `Allies: ${needs.__w[m[1]].replace(/^(?:other |allied )?(?:ally|allies)\s*/i, "")}`; }  // from the targets pick; allies named by what the text counts
    else if ((m = /^([st])_(\w+?)_(p|c)$/.exec(k))) { label = `${dcbK(m[2])} ${m[3] === "p" ? "Potency" : "Count"} on ${m[1] === "t" ? "target" : "self"}`; hi = dcaCaps(m[2])[m[3]] ?? Math.max(20, needs[k]); if (m[3] === "p") pairs.push([k, `${m[1]}_${m[2]}_c`]); }
    else if ((m = /^([st])_(\w+)$/.exec(k))) { label = `${dcbK(m[2])} on ${m[1] === "t" ? "target" : "self"}`; hi = dcaCaps(m[2]).s ?? Math.max(10, needs[k]); }
    else continue;
    sliders.push([k, label, lo, hi]);
    start[k] = Math.max(lo, Math.min(hi, needs[k] || 0));
  }
  for (const [p, c] of pairs) if (!start[p] !== !start[c]) { start[p] ||= 1; start[c] ||= 1; }
  deaths.forEach((kw) => { start[`t_${kw}`] = Math.max(start[`t_${kw}`] || 0, dcaDeath(kw).base); });
  seqKws.forEach((kw) => { start[`t_${kw}`] = 0; });  // what the Skill puts there starts at 0  // a Deathrite starts at its Base Stack
  // a Count that starts above 1 (Bright: Base 3)
  for (const [p, c] of pairs) { const c0 = dcaCaps(p.slice(2, -2)).c0; if (start[p] > 0 && c0 > start[c]) start[c] = c0; }

  const cv = /Coin Power does not change; instead, for every net Coin Power increase, Final Power \+(\d+) and deal \+(\d+)% damage/i.exec(u.desc), conv = cv ? { fp: +cv[1], dyn: +cv[2] } : null;
  const order = { cp: "cp", fp: "fp", bp: "base", ol: "diff", dyn: "dyn" };
  if (u.into) nodmg.unshift(`<b>Counted as “${esc(u.into)}”</b>: this Counter turns into it (${dcbText(u.from.split("\n").find((l) => /as (?:a )?Counter/i.test(l)) || "")})`);
  // chained slider values
  const link = (s0) => {
    // targets hit → excess Atk Weight
    const tw = (u.targets || 1) + (s0.g_awAdd || 0), hit = Math.max(1, Math.min(tw, s0.g_hit || 1)), s = { ...s0, g_hit: hit, g_aw: tw - hit };
    if (!chains.length) return { s, notes: {} };
    const s2 = { ...s }, notes = {};
    for (const c of chains) {
      const g2 = dcaG(c.to), own = dcaVal(c.q || { kw: c.from, side: "self", part: c.src || "s" }, s2);
      if (c.at != null && own < c.at) continue;
      let n = c.v * Math.floor(own / c.every);
      if (c.cap != null) n = Math.min(c.cap, n);
      if (n <= 0) continue;
      const b = `${c.side[0]}_${c.to}`, key = g2.st === 2 ? `${b}_${c.part === "c" ? "c" : "p"}` : b;
      s2[key] = Math.min(g2.max || 999, (s2[key] || 0) + n);
      if (g2.st === 2) { const o2 = `${b}_${c.part === "c" ? "p" : "c"}`; if (!s2[o2]) s2[o2] = 1; }  // new status: both numbers
      notes[key] = `${notes[key] ? notes[key] + ", " : ""}<span>+${n} from</span> ${c.name ? esc(c.name) : dcbK(c.from)}`;
    }
    return { s: s2, notes };
  };
  const m = {
    auto: true, rows, stn: stk === "Sinking" ? "Gloom" : stk ? "Rupture" : "", stk, u: u.into ? u : undefined, bursts: bursts.length ? bursts : null,
    bat: { auto: true },
    mods: (s0, o) => {
      let s = link(s0).s;
      // "gain +N Atk Weight": more targets or excess Atk Weight
      const awAdd = rows.reduce((a, r) => !o[r.k] || r.seq ? a : r.parts.reduce((b, { f, conds }) => f.k === "aw" ? b + dcaEff(f, conds, s) : b, a), 0);
      if (awAdd) s = link({ ...s0, g_awAdd: awAdd }).s;
      const out = { aw: awAdd, base: 0, cp: 0, fp: 0, last: 0, dyn: 0, diff: 0, lastDyn: 0, firstDyn: 0, subDyn: 0, coinDyn: [], coinCp: [], coinFp: [], reuseAt: [], coinFlat: [], flatAll: [] };
      const forced = rows.some((r) => o[r.k] && r.parts.some(({ f, conds }) => f.k === "force" && dcaEff(f, conds, s)));  // "unconditionally activate all Reuse effects"
      for (const r of rows) if (o[r.k]) {
        if (r.seq) {  // stacks grow with every coin that inflicted them
          const kw = r.k.slice(5), f = r.parts[0].f, mxs = dcaG(kw).max || 99;
          for (let ci = 0; ci < u.coins; ci++) {
            let n = s[`t_${kw}`] || 0;
            for (const [i, k] of r.seq) if (i < ci) n += k;
            let v = f.v * Math.min(mxs, n);
            if (f.cap != null) v = Math.min(f.cap, v);
            if (v) out.coinDyn[ci] = (out.coinDyn[ci] || 0) + v;
          }
          continue;
        }
        const vs = r.parts.map(({ f, conds }) => dcaEff(f, f.k === "reuse" && forced ? [] : conds, s));
        r.parts.forEach((p, i) => { if (!p.inst || !vs[i]) return; for (let j = i - 1; j >= 0; j--) if (r.parts[j].f.k === p.f.k) { vs[j] = 0; break; } });  // "instead": the one before
        r.parts.forEach(({ f }, i) => {
          const v = vs[i];
          if (!v) return;
          if (f.k === "take" || f.k === "aw") return;  // this unit takes more; Atk Weight above
          if (f.share && f.k === "dyn") {  // share of the final damage
            const put = (o2) => { if (typeof f.scope === "number") (o2.coinShare ||= [])[f.scope] = (o2.coinShare[f.scope] || 0) + v; else if (f.scope === "last") o2.lastShare = (o2.lastShare || 0) + v; else o2.share = (o2.share || 0) + v; };
            put(out); if (f.share === "all") put(out.shAll ||= {});
            return;
          }
          if (f.k === "sub") { out.subDyn += v; return; }
          if (f.k === "only") { (out.only ||= [])[f.scope] = v; return; }
          if (f.k === "force") return;
          if (f.per && f.per.pow) { (out.powDyn ||= []).push({ v, cap: f.cap }); return; }  // % of this Skill's Power
          if (f.per && f.per.hp1) { (out.hpDyn ||= []).push({ v, cap: f.cap, scope: f.scope }); return; }  // % of the HP the first Coin took  // "-50% damage against sub-targets"
          if (f.k === "tm") { out.tm = (out.tm || 0) + v; return; }
          if (f.k === "flat") { if (f.scope === "reuse") (out.flatReuse ||= []).push([v, f.sin]); else if (typeof f.scope === "number") (out.coinFlat[f.scope] ||= []).push([v, f.sin]); else out.flatAll.push([v, f.sin]); return; }
          if (f.k === "reuse") { const at = f.at ?? f.scope, c = typeof at === "number" ? at : u.coins - 1; for (let j = 0; j < v; j++) out.reuseAt.push(c); return; }
          if (typeof f.scope === "number") { const arr = { dyn: out.coinDyn, cp: out.coinCp, fp: out.coinFp }[f.k]; if (arr) arr[f.scope] = (arr[f.scope] || 0) + v; else out[order[f.k]] += v; }
          else if (f.scope === "last" && (f.k === "dyn" || f.k === "fp")) out[f.k === "dyn" ? "lastDyn" : "last"] += v;
          else if (f.scope === "last" && f.k === "cp") out.coinCp[u.coins - 1] = (out.coinCp[u.coins - 1] || 0) + v;  // "the final Coin gains Coin Power"
          else if (f.scope === "first" && f.k === "dyn") out.firstDyn += v;
          else out[order[f.k]] += v;
        });
      }
      out.crit = s.g_crit > 0;
      out.clash = s.g_clash || 0;
      if (conv && o.conv !== false) { const net = out.cp; out.fp += conv.fp * net; out.dyn += conv.dyn * net; out.cp = 0; }  // "net Coin Power increase" becomes Final Power and damage
      if (s.g_hit > 1) out.targets = s.g_hit;  // side targets: -N% only where a line says so
      out.ramp = ramp;
      return out;
    },
    target: (s0, o, face = "best") => {
      const s = link(s0).s, x2 = m.mods(s0, o), seq = dcbSeq(u, x2), heads = face === "best" ? u.op !== "SUB" : face === "heads";
      const stag = [], blog = [], bflat = [], gone = [], on = s.tb !== 0;
      // one-number statuses on the target (Promised Nail …): what coins inflict, what they consume, what they deal on a Tremor Burst
      const one = Object.fromEntries(t1.map((kw) => [kw, s[`t_${kw}`] || 0])), one0 = { ...one }, used = new Set(), paid = {};
      const T = dcbSim([...tKws].map((kw) => [kw, s[`t_${kw}_p`] || 0, s[`t_${kw}_c`] || 0]), seq.map(([ci], j) => ({
        burst: (f, p) => {  // Rupture goes off: the Deathrites on the target react
          for (const kw of deaths) {
            const d = dcaDeath(kw);
            if (!one[kw] || !dcaDeathOk(d, s)) continue;
            one[kw]--;
            if (d.cnt) f.addC("Burst", d.cnt, dcaG(kw).name || kw);
            if (one[kw] <= 0) { (bflat[j] ||= []).push([p, d.sin[0].toUpperCase() + d.sin.slice(1).toLowerCase(), kw]); blog.push({ lab: dcaG(kw).name || kw, hit: p, sin: d.sin, kw }); gone.push([kw, j]); }
          }
        },
        post: (f) => {
          inf.forEach(([i, kw, p, c, w]) => { if ((i === ci || i < 0) && (!w || (w === "H") === heads)) { f.add(kw, p, c, i < 0 ? label : `Coin ${ROMAN[ci]}`); } });
          inf1.forEach(([i, kw, n, w]) => { if (i === ci && (!w || heads)) {
            const r = pay1[kw];
            if (r) {  // the passive's price in own Count
              const c = paid[r.by] ?? (s[`s_${r.by}_c`] || 0), cost = c >= r.at ? r.hi : r.lo;
              if (c < cost) { blog.push({ lab: `Coin ${ROMAN[ci]}`, kw, no: 1, by: r.by, c, pay: cost }); return; }
              if (c >= r.at) n += r.more;
              paid[r.by] = c - cost; blog.push({ lab: `Coin ${ROMAN[ci]}`, kw: r.by, own: -cost });
            }
            one[kw] =dcaDeath(kw) ? one[kw] || n : Math.min(dcaCaps(kw).s ?? 99, one[kw] + n); /* a Deathrite does not stack on itself */ blog.push({ lab: `Coin ${ROMAN[ci]}`, kw, add: n }); } });
          if (on) for (const b of bursts) if (b.coin === ci || b.all || (b.last && j === seq.length - 1) || (b.first && j === 0)) {
            const tk = Object.keys(f.t).find((z) => /^Vibration/.test(z)), v = tk ? f.t[tk].p : 0;
            if (!v) continue;
            if (bsin) (bflat[j] ||= []).push([v * b.n, bsin[1], "VibrationExplosion"]);
            if (fz && (tk === "VibrationFocusing" || (focusAt >= 0 && ci >= focusAt))) {
              const d = Math.floor(v * Math.min(fz.max, fz.base + fz.per * dcaChargeP(s)) / 100 + 1e-9);
              if (d) { for (let k = 0; k < b.n; k++) (bflat[j] ||= []).push([d, fz.sin, "VibrationFocusing"]); blog.push({ lab: dcaG("VibrationFocusing").name || "VibrationFocusing", hit: d * b.n, sin: fz.sin, kw: "VibrationFocusing" }); }
            }
            stag[j] = (stag[j] || 0) + v * b.n; blog.push({ lab: b.coin != null ? `Coin ${ROMAN[ci]}` : b.from, v: v * b.n, n: b.n, kw: tk });
            for (const kw of t1) {  // "Upon Tremor Burst, take 1 Sloth damage for every Stack (max 10; once per Skill)"
              const h = dcaBurstHit(kw);
              if (!h || !one[kw] || (h.once && used.has(kw))) continue;
              const d = h.tremor ? v : Math.min(h.cap ?? 999, h.per * one[kw]);
              (bflat[j] ||= []).push([d, h.sin, kw]); used.add(kw); blog.push({ lab: dcaG(kw).name || kw, hit: d, sin: h.sin, kw });
              if (h.lose) one[kw] = Math.max(0, one[kw] - h.lose);
            }
            if (b.cut) f.dec(tk, b.cut, `Coin ${ROMAN[ci]}`);  // "then, reduce … Count"
          }
          eat1.forEach(([i, kw]) => { if (i === ci && one[kw]) { blog.push({ lab: `Coin ${ROMAN[ci]}`, kw, eat: one[kw] }); one[kw] = 0; } });  // "Consume all [X] on target"
        } })));
      return { dmg: T.dmg, log: T.log, stag, blog, bflat, gone, end: T.t, st: [...[...tKws].map((kw) => [kw, { p: s[`t_${kw}_p`] || 0, c: s[`t_${kw}_c`] || 0 }, T.t[kw]]), ...t1.map((kw) => [kw, one0[kw], one[kw]])], extra: [] };
    },
    deaths: deaths.length ? deaths : null,
    nodmg, chains: [...new Set(chains.map((c) => c.from))], chainNote: (s) => link(s).notes, linked: (s) => link(s).s,
  };
  const id = { sliders, start, pairs, skills: {}, model: () => key, auto: true };
  const out = { id, key, m };
  DCA.set(key, out);
  return out;
}
const dcbOn = (bm) => Object.fromEntries(bm.m.rows.map((r) => { const v = bm.b.on[`${bm.key}.${r.k}`]; return [r.k, v === undefined ? !r.off : v]; }));

// the formula of dcCalc on the model's numbers. face: "best" (heads on Plus Coins, tails on Minus Coins), "heads" or "tails"
function dcbCalc(m, u, s, o, env, face = "best") {
  if (s.g_stag) env = { ...env, R: DC_STAG };  // a Staggered target takes ×2.0 from every type and sin (game-checked)
  DCA_R = env.R || {};
  { const t = dcTarget(), hv = t.v; DCA_HP = hv && hv.hp ? Math.max(1, Math.floor(hv.hp + (hv.hpLevel || 0) * hv.level)) : 1000; }
  u = m.u || u;  // a Counter that turns into another Skill
  const x = { base: 0, cp: 0, fp: 0, last: 0, dyn: 0, diff: 0, flatLast: 0, lastDyn: 0, reuse: false, targets: 1, subDyn: 0, coinDyn: [], coinCp: [], coinFp: [], reuseAt: [], coinFlat: [], flatAll: [], ...m.mods(s, o) };
  const res = (k) => env.R[k] ?? 1, T = (s.stdmg && (m.stn || m.deaths)) || m.bursts ? m.target(s, o, face) : null, sd = s.stdmg && m.stn ? T.dmg : [], stag = (T && T.stag) || [];
  const add = u.op !== "SUB", heads = face === "best" ? add : face === "heads";
  const seq = dcbSeq(u, x), n = seq.length, diff = env.diff0 + x.diff;
  const mod = 1 + diff / (Math.abs(diff) + 25) + dcRmod(res(u.atk)) + dcRmod(res(u.sin)) + (x.crit ? 0.2 : 0) + 0.03 * (x.clash || 0);
  let roll = u.base + x.base, total = 0;
  const xg = {};
  const coins = [];
  for (let i = 0; i < n; i++) {
    const [ci, again] = seq[i];
    if (heads) roll += add ? u.coin + x.cp + (x.coinCp[ci] || 0) : -u.coin;  // a Reuse tosses again
    // a Deathrite that went off on an earlier coin is gone: its "target has [X]" damage bonus stops
    const gk = T && T.gone ? T.gone.filter(([, j]) => j < i).map(([kw]) => kw) : [];
    const gdyn = gk.length ? (xg[gk.join()] ??= m.mods({ ...s, ...Object.fromEntries(gk.map((kw) => [`t_${kw}`, 0])) }, o)).dyn - x.dyn : 0;
    const fin = i === n - 1, r = roll + x.fp + (fin ? x.last : 0) + (x.coinFp[ci] || 0), d = gdyn + x.dyn + (fin ? x.lastDyn : 0) + (i === 0 ? x.firstDyn || 0 : 0) + (x.coinDyn[ci] || 0) + (x.powDyn || []).reduce((a, p) => a + Math.min(p.cap ?? 1e9, p.v * Math.max(0, r)), 0)
      + (i > 0 ? (x.hpDyn || []).reduce((a, p) => a + (typeof p.scope !== "number" || p.scope === ci ? Math.min(p.cap ?? 1e9, p.v * 100 * coins[0].main / DCA_HP) : 0), 0) : 0);
    const shOf = (z) => z ? (z.share || 0) + (fin ? z.lastShare || 0 : 0) + ((z.coinShare || [])[ci] || 0) : 0, sh = shOf(x), shA = shOf(x.shAll);
    // "N% of this Coin's final damage": its own hit on top of the coin's
    const h0 = (dd) => dcFloor(r <= 0 ? 1 : r * (1 + dd / 100) * mod), hit = (dd) => { const h = h0(dd); return h + (sh ? dcFloor(h * sh / 100) : 0); };
    // flat adders and status damage through their sin's resistance
    const fl2 = [...(x.coinFlat[ci] || []), ...x.flatAll, ...(again ? x.flatReuse || [] : []), ...((T && T.bflat && T.bflat[i]) || [])], fsin = fl2.length ? fl2[0][1] : m.flatSin;
    const fx = [...(fin && x.flatLast ? [[x.flatLast, m.flatSin]] : []), ...fl2].map(([v, k, src]) => ({ v: dcFloor(v * res(k)), sin: k, src: src || "" })).filter((f) => f.v);
    const flat = fx.reduce((a, f) => a + f.v, 0), sdmg = sd[i] ? dcFloor(sd[i] * (m.stn === "Gloom" ? res("Gloom") : 1)) : 0;
    const tmf = (v) => x.tm ? dcFloor(v * (1 + 0.15 * x.tm) * res("Sloth")) : v;  // Time Moratorium
    let main = tmf(hit(d) + flat + sdmg), side = x.targets > 1 ? tmf(hit(d + x.subDyn)) : 0, one = tmf(hit(d) + flat + (x.targets - 1) * hit(d + x.subDyn) + sdmg);
    const ov = x.only && x.only[ci];  // this coin hits only the main target (1) or only the others (2)
    let shd = sh ? dcFloor(h0(d) * sh / 100) : 0, shn = sh ? 1 : 0;  // "N% of this Coin's final damage": extra damage of its own
    if (x.ramp && x.targets > 1) { side = 0; const e = shA ? tmf((x.targets - 1) * dcFloor(h0(d) * shA / 100)) : 0; one = main + e; if (e) { shd += e; shn += x.targets - 1; } }  // [WideAreaRampage]: one target per coin; "against all targets" shares hit every one
    else if (ov === 1) { side = 0; one = main; } else if (ov === 2) { one = (x.targets - 1) * side; main = 0; }
    coins.push({ r, one, main, side, d, sh, shA, shd, shn, heads, flat, fx, fsin, sdmg, stag: stag[i] || 0, reuse: again, ci, t: x.targets, fin, first: i === 0 });
    total += one;
  }
  return { total, coins, x, diff, mod, stag: stag.reduce((a, v) => a + (v || 0), 0) };
}
// hits in order: [coin, reused?]; a Reuse hits again right after its coin
function dcbSeq(u, x) {
  const seq = [];
  for (let i = 0; i < u.coins; i++) { seq.push([i, false]); (x.reuseAt || []).forEach((z) => { if (z === i) seq.push([i, true]); }); }
  if (x.reuse) seq.push([u.coins - 1, true]);
  return seq;
}

// ---- the page: skill bar + rotation, you | result | target, why this number, the multipliers popup
// forms ("[X] exclusive Skill"), skill kinds (S1–S3, Counter, Follow-up, Support), each form's deck skill per tier
const DCF = new Map();
function dcForms(x, slots) {
  const key = `${x.id}.${dc.up}`;
  if (DCF.has(key)) return DCF.get(key);
  const en = (sk) => dcaEnU(sk, cqAt(sk, dc.up) || Object.values(sk.up).pop());
  const fuNames = x.title ? dcaFollowUps(x) : new Set(), bare = dcaBare;
  const info = slots.map(([l, sk]) => {
    const v = en(sk), d = dcaPlain(v.desc), fm = /\[(\w+)\] exclusive Skill/i.exec(d), tier = +((/^Skill (\d)/.exec(l) || [])[1] || 0);
    const kind = !x.title ? l : l === "Counter" ? "Counter" : fuNames.has(bare(v.name)) ? "Follow-up" : /\[SupportAlly\]/.test(d) ? "Support" : tier ? `S${tier}` : l;
    return { kw: fm ? fm[1] : "", tier: /^S\d$/.test(kind) ? tier : 0, kind };
  });
  const groups = new Map();
  info.forEach((f, i) => { if (!groups.has(f.kw)) groups.set(f.kw, []); groups.get(f.kw).push(i); });
  // one exclusive Skill is no form
  for (const [kw, idx] of [...groups]) if (kw && idx.length < 2) { groups.delete(kw); if (!groups.has("")) groups.set("", []); groups.get("").push(...idx); }
  let forms = [...groups].map(([kw, idx]) => ({ kw, idx: idx.sort((a, b) => a - b), label: kw ? dcaG(kw).name || kw : "Base form" })).sort((a, b) => (a.kw !== "") - (b.kw !== ""));
  if (forms.length < 2) forms = [{ kw: "", idx: slots.map((_, i) => i), label: "" }];
  forms.forEach((f) => { f.deck = {}; f.fu = []; f.idx.forEach((i) => { const k = info[i]; if (k.tier && !(k.tier in f.deck)) f.deck[k.tier] = i; if (k.kind === "Follow-up") f.fu.push(i); }); });
  const out = { forms, info, of: (i) => Math.max(0, forms.findIndex((f) => f.idx.includes(i))) };
  DCF.set(key, out);
  return out;
}
// Skills the kit uses by name ("use 'La Demande'"): follow-ups
const dcaBare = (n) => dcaPlain(n).replace(/\s*[[【(].*$/, "").trim().toLowerCase();
const DCA_FU = new Map();
function dcaFollowUps(x) {
  if (DCA_FU.has(x.id)) return DCA_FU.get(x.id);
  const out = new Set(), scan = (txt) => { for (const q of dcaPlain(txt).matchAll(/\buse\s+["'“‘]([^"'”’]+)["'”’](?!\s+as (?:a )?Counter)/gi)) out.add(dcaBare(q[1])); };
  (x.passives || []).forEach((p) => scan(dcaEn("ps", p.id, p.desc)));
  [...x.skills, ...(x.defense || [])].forEach((q) => Object.values(q.up).forEach((v0) => { const v = dcaEnU(q, v0); scan(v.desc); (v.coindescs || []).flat().forEach(scan); }));
  DCA_FU.set(x.id, out);
  return out;
}
// a skill's model without touching another state's sliders (hand models switch state by SP)
function dcModelOf(x, sk) {
  dc.bd ||= {};
  const d = dcbData(), id = d.ids[x.id], key = id && id.skills[sk.id];
  if (!key || dc.up < (x.maxUp || 4)) {
    // another skill's own starting state under the shared one, not written in (its target statuses stay its own)
    const a = dcaModel(x, sk, dc.up);
    if (!a) return null;
    const b = dc.bd[`a${x.id}`] ||= { s: {}, on: {} };
    return { id: a.id, key: a.key, m: a.m, b, s: { ...a.id.start, ...b.s } };
  }
  const b = dc.bd[x.id] ||= { s: { ...id.start }, on: {} }, m = d.models[key];
  return { id, key, m, b, s: id.model(b.s) === key ? b.s : { ...b.s, ...m.bat.set } };
}
// the state a skill is counted in: the sliders + the targets pick
function dcS(u, base) {
  const h = Math.max(1, Math.min(9, dc.hit || 1));
  return { ...base, g_hit: h, allT: (dc.hit || 1) > 1 ? 1 : base.allT || 0 };
}
const dcEnv = (u) => { const t = dcTarget(); return { diff0: dc.lv + (u.level || 0) - t.def, R: t.R }; };
function dcOne(x, i, carry, best, me) {
  const sk = dcSlots(x)[i][1], bm = dcModelOf(x, sk);
  if (!bm) return null;
  const u = cqAt(sk, dc.up), o = dcbOn(bm);
  // best: the skill at its own starting state (the numbers in the skill bar)
  const b0 = best ? { ...bm.s, ...bm.id.start, ...(bm.m.bat && !bm.m.auto && bm.id.model({ ...bm.s, ...bm.id.start }) !== bm.key ? bm.m.bat.set : {}) } : bm.s;
  if (best && best.forms && best.forms.length > 1) best.forms.forEach((q) => { if (q.kw) b0[`s_${q.kw}`] = q === best.cur ? 1 : 0; });  // the form's own status
  let s = dcS(u, b0);
  if (carry && bm.m.auto) {
    s = { ...s };
    for (const k in s) { const q = /^t_(\w+)_(p|c)$/.exec(k), q1 = !q && /^t_(\w+)$/.exec(k); if (q) s[k] = carry[q[1]] ? carry[q[1]][q[2]] || 0 : 0; else if (q1 && dcaG(q1[1]).st === 1) s[k] = carry[q1[1]] ? carry[q1[1]].n || 0 : 0; }
    for (const kw in carry) { if (carry[kw].n != null) s[`t_${kw}`] = carry[kw].n; else { s[`t_${kw}_p`] = carry[kw].p; s[`t_${kw}_c`] = carry[kw].c; } }
  }
  if (me && bm.m.auto) s = { ...s, ...me };  // own statuses the rotation moved
  return { slot: i, bm, u, s, o, c: dcbCalc(bm.m, u, s, o, dcEnv(u)) };
}
const dcImg = (k) => { const g = UNITS.glossary[k], src = g && (g.iconUrl || (g.icon && imgThumb(g.icon))); return src ? `<img class="dcsti" src="${src}" alt="" title="${esc(g.name || k)}" onerror="this.remove()">` : ""; };

// ---- own statuses through the rotation: what a skill / the passives gain and spend, by their texts
// one line → events { at: pre|hit|post|next|start|end|use, kw (or sp), part p|c|s, op add|eat|all, n | ex | per, cap, upTo, pay, conds, coin, face, lim }
function dcaOwnLine(raw, ctx, coin, pas) {
  let t = dcaPlain(raw).replace(/^[-•·]\s*/, "");
  const bullet = t !== dcaPlain(raw), line = t;
  if (!bullet) ctx.head = null;
  t = dcaNames(t);
  const tags = [];
  for (let m; (m = /^\[(\w+)\]\s*/.exec(t)) && !dcaG(m[1]).st;) { tags.push(m[1]); t = t.slice(m[0].length); }
  const pre = /^(Combat Start|Turn Start|Turn End|On Use|Before Attack|On Hit|At the start of the combat phase|Upon Skill use|At Skill End|At Attack End)\s*[:,]\s*/i.exec(t);
  if (pre) { tags.push(pre[1]); t = t.slice(pre[0].length); }
  const tg = tags.join(" ");
  if (/WinDuel|DefeatDuel|LoseDuel|Kill|Evade|OnDie|Parry|Discard/i.test(tg)) return [];
  let at = /OnSucceedAttack|On Hit/i.test(tg) ? "hit" : /EndSkill|AfterAttack|EndBattle|Skill End|Attack End/i.test(tg) ? "post" : /Turn End|OnEndTurn/i.test(tg) ? "end"
    : /StartBattle|Combat Start|Turn Start|start of the combat/i.test(tg) ? (pas ? "start" : "pre") : pas ? "" : coin != null ? "hit" : "pre";
  // conditions before the first comma / colon; a header's conditions go to its bullets
  const conds = bullet && ctx.head ? [...ctx.head] : [];
  for (let k = 0; k < 3; k++) {
    if (!/^(If|At|When|While|Upon|Against|On|For|Whenever)\b/i.test(t)) break;
    // "At 3+ [X] gain 1 [Y]": no comma, the verb ends it
    let cut = dcaCut(t, /[,:]/), skip = 1;
    const vi = t.search(/\b(?:gain|gains|lose|loses|consume|consumes|spend|spends|heal|heals|apply|applies)\b/i);
    if (vi > 0 && (cut <= 0 || vi < cut)) { cut = vi; skip = 0; }
    if (cut <= 0) break;
    const ct = t.slice(0, cut).trim();
    t = t.slice(cut + skip).trim();
    const use = /^(?:upon|when|after) (?:this unit )?(?:using|uses) (?:the )?(?:Skill )?["“]([^"”]+)["”](?: Skill)?(?: \([^)]*\))?$/i.exec(ct);
    if (use) { at = pas ? "use" : at; conds.push({ name: dcaBare(use[1]) }); continue; }
    if (/^on clash|evad|defeat|kill|\bdies\b|Clash (?:Win|Lose)/i.test(ct)) return [];
    const c = /^if this unit does not have \[(\w+)\]$/i.exec(ct);
    if (c && dcaG(c[1]).st) { conds.push({ absent: c[1] }); continue; }
    for (const z of [].concat(dcaCond(ct, {}))) { if (z.never) return []; conds.push(z.unk || z.tier || z.coinGains ? { unk: ct } : z); }
  }
  if (/:\s*$/.test(t) || /the following/i.test(t)) ctx.head = conds;
  if (!at || (pas && conds.some((c) => c.unk))) return [];  // passives: read conditions only
  const ev = [], lim = /\bonce per (?:turn|Skill)\b/i.test(line) ? 1 : +((/\((?:up to )?(\d+) times per turn|(\d+) per turn\)/i.exec(line) || [])[1] || 0) || 0;
  const base = { at, conds, coin, face: /Head/.test(tg) ? "H" : /Tail/.test(tg) ? "T" : "", lim, line };
  const subj = (i) => { const b = t.slice(0, i).split(/[.;:]/).pop(); return /\b(?:ally|allies|attacker|enemy|enemies|opponent|target)\b/i.test(b) && !/\bthis unit\b/i.test(b.split(",").pop()); };
  // gains
  for (const m of t.matchAll(/\b(gain|gains|apply|applies|heal|heals|recover|recovers)\b((?:(?!\b(?:gain|gains|apply|applies|inflict|inflicts|consume|consumes|spend|spends|lose|loses|heal|heals|recover|recovers)\b)[^.;])*)/gi)) {
    if (subj(m.index)) continue;
    const cl = m[2];
    if (/^appl/i.test(m[1]) && !/\b(?:on|to) self\b/i.test(cl)) continue;
    if (/\b(?:for|to|on) (?:\d+ )?(?:other |all )?(?:ally|allies)\b/i.test(cl)) continue;
    const a2 = /\bnext turn\b/i.test(cl) ? "next" : at, mx = /\(max (\d+)/i.exec(cl), cap = mx ? +mx[1] : undefined;
    if (/^(heal|recover)/i.test(m[1])) { const sp = /^\s*(\d+)\s+SP\b/i.exec(cl); if (sp && !/\bfor\b/i.test(cl)) ev.push({ ...base, at: a2, sp: 1, op: "add", n: +sp[1] }); continue; }
    const fe = /\bfor (?:every|each) (?:(\d+) )?(.+?)\s*(?:\(max |[,;]|$)/i.exec(cl), fq = fe && dcaTerm(fe[2].replace(/\s+/g, " "), "self", {});
    let any = false;
    for (const q of cl.slice(0, fe ? fe.index : undefined).matchAll(/(\+?)(?:(\d+)|\(([^()]+)\))\s+(?:additional |more )?\[(\w+)\](\s+(?:Count|Potency))?/g)) {
      const kw = q[4], st = dcaG(kw).st;
      if (!st) continue;
      any = true;
      const e = { ...base, at: a2, kw, part: st === 1 ? "s" : /Count/.test(q[5] || "") || (q[1] && !q[5]) ? "c" : "p", op: "add", cap };
      if (q[2] != null) { e.n = +q[2]; if (fe) { if (!fq) continue; e.per = fq; e.every = +(fe[1] || 1); } }
      else { e.ex = dcaOwnEx(q[3]); if (!e.ex) continue; }
      ev.push(e);
    }
    const lead = !any && /^\s*((?:\[\w+\]\s*(?:\/|,|and|or)?\s*)+)/.exec(cl);  // "gain [X]" = 1
    if (lead) { const ks = [...lead[1].matchAll(/\[(\w+)\]/g)].map((q) => q[1]).filter((k) => dcaG(k).st); (/\//.test(lead[1]) ? ks.slice(-1) : ks).forEach((kw) => ev.push({ ...base, at: a2, kw, part: dcaG(kw).st === 1 ? "s" : "p", op: "add", n: 1 })); }
  }
  // SP lost
  for (const m of t.matchAll(/\b(lose|loses|consume|consumes)\s+(?:(\d+)|\(([^()]+)\))\s+SP\b/gi)) {
    if (subj(m.index)) continue;
    const mx = /^\s*\(max (\d+)/i.exec(t.slice(m.index + m[0].length)), e = { ...base, sp: 1, op: "eat", cap: mx ? +mx[1] : undefined, pay: /consume/i.test(m[1]) };
    if (m[2] != null) e.n = +m[2]; else { e.ex = dcaOwnEx(m[3]); if (!e.ex) continue; }
    ev.push(e);
  }
  // spent / lost statuses
  for (const m of t.matchAll(/\b(consume|consumes|spend|spends|lose|loses)\s+(up to\s+)?(all(?: of)?|\d+)\s+(?:the\s+)?(?:this unit's\s+)?\[(\w+)\](\s+(?:Count|Potency|Stacks?))?(\s+on (?:the )?(?:main )?target)?/gi)) {
    const kw = m[4], st = dcaG(kw).st;
    if (m[6] || !st || subj(m.index)) continue;
    const all = /^all/i.test(m[3]), after = t.slice(m.index + m[0].length);
    ev.push({ ...base, kw, part: st === 1 ? "s" : /Count|Stack/i.test(m[5] || "") ? "c" : "p", op: all ? "all" : "eat", n: all ? 0 : +m[3], upTo: !!m[2], pay: !m[2] && !all && /^\s*(?:on self\s*)?(?:,\s*)?(?:to|and)\b/i.test(after) });
  }
  // "Lose [X] on self": all of it
  for (const m of t.matchAll(/\b(?:lose|loses|remove|removes)\s+(?:all\s+)?\[(\w+)\](?:\s+on self)?(?=\s*(?:[.;,]|$|and\b))/gi)) if (dcaG(m[1]).st && !subj(m.index)) ev.push({ ...base, kw: m[1], part: "c", op: "all", n: 0 });
  // "At less than 3 [X] Potency, cancel the Skill": no damage
  if (/\bcancel (?:the|this) Skill\b/i.test(t)) ev.push({ ...base, cancel: true });
  return ev;
}
// "[Charge] + 1", "[X] on self x 2", "[X] / 3" → { terms, mul, div }
function dcaOwnEx(t) {
  const m = /^(.+?)\s*([/x×*])\s*(\d+)$/.exec(t.trim()), body = m ? m[1] : t.trim();
  const terms = body.split(/\s+\+\s+/).map((z) => /^\d+$/.test(z) ? +z : dcaTerm(z, "self", {}));
  if (terms.some((z) => z == null)) return null;
  return { terms, mul: m && m[2] !== "/" ? +m[3] : 1, div: m && m[2] === "/" ? +m[3] : 1 };
}
// "… gain 2 [X] instead": the line before it only when this one's condition is not met
function dcaInstead(ev) {
  ev.forEach((e, i) => {
    if (!/\binstead\b/i.test(e.line) || e.op !== "add") return;
    const c = e.conds.filter((z) => z.q && !z.lt && z.max == null);
    if (c.length !== 1) return;
    for (let j = 0; j < i; j++) { const d = ev[j]; if (d.kw === e.kw && d.op === "add" && d.line !== e.line && !/\binstead\b/i.test(d.line)) d.conds = [...d.conds, { ...c[0], lt: true }]; }
  });
  return ev;
}
const dcaOwnVal = (ex, s) => Math.floor(ex.terms.reduce((a, q) => a + (typeof q === "number" ? q : dcaVal(q, s)), 0) * ex.mul / ex.div);
// a skill's own events (its text and coins); the passives' own events (each turn, on use, on hit)
const DCA_OWN = new Map();
function dcaOwnEv(sk, up) {
  const key = `${sk.id}.${up}`;
  if (DCA_OWN.has(key)) return DCA_OWN.get(key);
  const u0 = cqAt(sk, up), out = [];
  if (u0) {
    const u = dcaEnU(sk, u0), ctx = {};
    const blk = (ev) => out.push(...dcaInstead(ev));
    blk(String(u.desc || "").split("\n").flatMap((l) => dcaOwnLine(l, ctx, null, false)));
    (u.coindescs || []).forEach((cd, i) => { const c2 = {}; blk(cd.flatMap((d) => String(d).split("\n").flatMap((l) => dcaOwnLine(l, c2, i, false)))); });
  }
  DCA_OWN.set(key, out);
  return out;
}
function dcaOwnPas(x, up) {
  const key = `p${x.id}.${up}`;
  if (DCA_OWN.has(key)) return DCA_OWN.get(key);
  const out = [];
  for (const p0 of x.passives || []) {
    let p = p0;
    while (p && (p.uptie || 0) > up) p = p.prev;
    if (!p || p.kind === "support") continue;
    const ctx = {};
    out.push(...dcaInstead(String(dcaEn("ps", p.id, p.desc) || "").split("\n").flatMap((l) => dcaOwnLine(l, ctx, null, true).map((e) => ({ ...e, from: dcaPlain(p.name) })))));
  }
  DCA_OWN.set(key, out);
  return out;
}
const dcOwnKeys = (kw) => kw === "sp" ? ["g_sp"] : dcaG(kw).st === 2 ? [`s_${kw}_p`, `s_${kw}_c`] : [`s_${kw}`];
// one event on the own state `me` (slider keys); s = the state the card hit with, for conditions and expressions
function dcOwnDo(me, e, s, k = 1) {
  const has = (kw) => dcOwnKeys(kw).some((k) => me[k] != null && (me[k] > 0 || dcaCaps(kw).meter));
  if (e.conds.some((c) => (c.q && !dcaOk(c, { ...s, ...me })) || (c.name && c.name !== s.__name) || (c.absent && has(c.absent)))) return false;
  let n = e.ex ? dcaOwnVal(e.ex, { ...s, ...me }) : e.per ? e.n * Math.floor(dcaVal(e.per, { ...s, ...me }) / e.every) : e.n;
  if (e.cap != null) n = Math.min(e.cap, n);
  n *= k;
  if (e.sp) {
    const v = me.g_sp || 0;
    if (e.op === "eat" && e.pay && v - n < -45) return false;
    me.g_sp = Math.max(-45, Math.min(45, v + (e.op === "add" ? n : -n)));
    return true;
  }
  const g = dcaG(e.kw), cp = dcaCaps(e.kw), b = `s_${e.kw}`;
  if (g.st === 2) {
    // a meter ("Potency : Base 0"): stays at 0 until lost
    const on = has(e.kw);
    let p = me[`${b}_p`] || 0, c = me[`${b}_c`] || 0;
    if (e.op === "add") { if (!on) c = Math.max(c, cp.c0 || 0); if (e.part === "c") { c += n; if (!p && !cp.p0) p = 1; } else { p += n; if (!c) c = cp.c0 || 1; } p = Math.min(cp.p ?? 99, p); c = Math.min(cp.c ?? 99, c); }
    else if (e.op === "all") { delete me[`${b}_p`]; delete me[`${b}_c`]; return true; }
    else { const cur = e.part === "c" ? c : p; if (e.pay && cur < n) return false; const d = e.upTo ? Math.min(cur, n) : n; if (e.part === "c") c = Math.max(0, c - d); else p = Math.max(0, p - d); }
    if (!cp.meter && (c <= 0 || (p <= 0 && !cp.p0))) p = c = 0;
    me[`${b}_p`] = p; me[`${b}_c`] = c;
  } else {
    let v = me[b] || 0;
    if (e.op === "add") v = Math.min(cp.s ?? g.max ?? 99, v + n);
    else if (e.op === "all") v = 0;
    else { if (e.pay && v < n) return false; v = Math.max(0, v - (e.upTo ? Math.min(v, n) : n)); }
    me[b] = v;
  }
  return true;
}
// a card's events after its hits: spends, On Hit (per hit of that coin), Attack End; "next turn" ones wait; Poise −1 Count per crit
function dcOwnAfter(me, evs, r, tracked, pend) {
  const s = { ...r.s, __name: r.name }, ok = (e) => tracked.has(e.sp ? "sp" : e.kw), C = r.c.coins;
  for (const e of evs) if (ok(e) && e.op !== "add" && e.at !== "hit" && e.at !== "next") dcOwnDo(me, e, s);  // costs of the skill
  for (const e of evs) if (ok(e) && e.at === "hit") {
    const n = C.filter((c) => (e.coin == null || c.ci === e.coin) && (!e.face || (e.face === "H") === c.heads)).length;
    if (n) dcOwnDo(me, e, s, e.lim ? Math.min(e.lim, n) : n);
  }
  for (const e of evs) if (ok(e) && e.op === "add" && (e.at === "post" || e.at === "use")) dcOwnDo(me, e, s);
  for (const e of evs) if (ok(e) && e.op === "add" && (e.at === "next" || e.at === "end")) pend.push([e, s]);
  if (tracked.has("Breath") && r.c.x.crit && me.s_Breath_c > 0) { me.s_Breath_c = Math.max(0, me.s_Breath_c - C.length); if (!me.s_Breath_c) me.s_Breath_p = 0; }
}
// when a follow-up fires, from the lines that name it: [{ pre, or, skill, tests }] (empty = not read)
const DCA_FUC = new Map();
function dcaFuCond(x, name, up) {
  const key = `${x.id}.${name}.${up}`;
  if (DCA_FUC.has(key)) return DCA_FUC.get(key);
  const lines = [], scan = (txt, skill) => String(txt || "").split("\n").forEach((l) => {
    const p = dcaNames(dcaPlain(l));
    for (const q of p.matchAll(/\buse\s+(?:the\s+)?["“‘]([^"”’]+)["”’]/gi)) if (dcaBare(q[1]) === name && !/^\s*(?:Skill\s+)?as (?:a )?Counter/i.test(p.slice(q.index + q[0].length))) lines.push({ t: p.slice(0, q.index), skill, full: p });
  });
  for (const p0 of x.passives || []) { let p = p0; while (p && (p.uptie || 0) > up) p = p.prev; if (p && p.kind !== "support") scan(dcaEn("ps", p.id, p.desc)); }
  [...x.skills, ...(x.defense || [])].forEach((q) => { const v0 = cqAt(q, up); if (!v0) return; const v = dcaEnU(q, v0), nm = dcaBare(v.name); scan(v.desc, nm); (v.coindescs || []).flat().forEach((d) => scan(d, nm)); });
  const out = [], part = (kw, pt) => /^Count/i.test(pt || "") || (/^Stack/i.test(pt || "") && dcaG(kw).st === 2) ? "c" : dcaG(kw).st === 2 ? "p" : "s";
  for (const l of lines) {
    const tests = [];
    let t = l.t.replace(/^[-•·]\s*/, "").replace(/^(?:\[\w+\]\s*)+/, "")
      .replace(/^(?:At (?:the )?(?:Skill['’]s )?(?:Base )?(?:Skill|Attack) End(?: of (?:a |this unit['’]s )?Base Attack Skills?(?: against enemies)?)?|Combat Start|At Skill End)\s*[:,]?\s*/i, "");
    t = t.replace(/\b(?:after|when) (?:this unit )?(?:uses|using) (?:the )?(?:Skill )?["“]([^"”]+)["”](?: Skill)?\s*[,:]?\s*/gi, (_, n) => { tests.push({ skill: dcaBare(n) }); return ""; });
    t = t.replace(/\b(?:after|when) (?:this unit )?(?:uses|using) Skill (\d)\s*[,:]?\s*/gi, (_, n) => { tests.push({ tier: +n }); return ""; });
    t = t.replace(/\b(?:if this unit has |at )(\d+)(\+)? (?:remaining )?\[(\w+)\](?: (Potency|Count|Stacks?))?(?: on self)?\s*[,:]?\s*/gi, (_, n, pl, kw, pt) => { if (dcaG(kw).st) tests.push({ kw, side: "self", part: part(kw, pt), n: +n, eq: !pl && +n === 0 }); return ""; });
    t = t.replace(/\bif (?:the )?(?:main )?target has (\d+)(\+)? \[(\w+)\](?: (Potency|Count|Stacks?))?\s*[,:]?\s*/gi, (_, n, pl, kw, pt) => { if (dcaG(kw).st) tests.push({ kw, side: "target", part: part(kw, pt), n: +n }); return ""; });
    t = t.replace(/\bif an enemy that has \[(\w+)\] is the main target of this unit['’]s Base Attack Skills\s*[,:]?\s*/gi, (_, kw) => { if (dcaG(kw).st) tests.push({ kw, side: "target", part: part(kw), n: 1 }); return ""; });
    t = t.replace(/\bif (?:the )?(?:main )?target has (\d+)\+ types of negative effects\s*[,:]?\s*/gi, (_, n) => { tests.push({ neg: +n }); return ""; });
    if (tests.length && !/[a-z]{3,}/i.test(t.replace(/\b(?:and|or|then)\b/gi, ""))) out.push({ pre: /\bbefore using\b|^Combat Start/i.test(l.full), or: /\bor\b/i.test(l.t), skill: l.skill, tests, line: l.full });
  }
  out.lines = lines.map((l) => l.full);
  DCA_FUC.set(key, out);
  return out;
}
// does a follow-up fire: own state `s` (sliders), the target `tg` ({kw: {p, c} | {n}}), the card's skill name and tier
function dcFuFires(cond, s, tg, name, tier) {
  const tv = (q) => { const v = tg[q.kw]; return !v ? 0 : v.n != null ? v.n : q.part === "c" ? v.c : v.p; };
  const ok = (q) => q.skill ? q.skill === name : q.tier ? q.tier === tier : q.neg ? Object.keys(tg).filter((k) => dcaG(k).type === "neg").length >= q.neg
    : q.side === "target" ? tv(q) >= q.n : q.eq ? dcaVal(q, s) === 0 : dcaVal(q, s) >= q.n;
  return cond.some((c) => (!c.skill || c.skill === name) && (c.or ? c.tests.some(ok) : c.tests.every(ok)));
}

const DC_CARDS = 12;  // most cards in a rotation
// one pass through the deck: 3× S1, 2× S2, 1× S3 of the current form; the target keeps what earlier cards inflicted, your own statuses move by the texts
function dcRotCalc(x, F) {
  if (!x.title) return null;
  const fi = F.of(dc.slot), f = F.forms[fi];
  if (![1, 2, 3].every((t) => t in f.deck)) return null;
  if (!dc.rot || dc.rot.id !== x.id) {
    dc.rot = { id: x.id, order: [1, 1, 2, 1, 2, 3], sl: [], fu: new Map(), open: dc.rot ? dc.rot.open : true, pick: {} };
    if (dc.rotq && dc.rotq.id === x.id) {
      const [o, ...fu] = dc.rotq.q.split("~"), cs = [...o.slice(0, DC_CARDS)].filter((ch) => /\d/.test(ch) || F.info[ch.charCodeAt(0) - 97]);
      dc.rot.order = cs.map((ch) => /\d/.test(ch) ? +ch : F.info[ch.charCodeAt(0) - 97].tier);
      dc.rot.sl = cs.map((ch) => /\d/.test(ch) ? null : ch.charCodeAt(0) - 97);
      fu.forEach((z) => { const m = /^(\d+)\.(\d+)(x?)$/.exec(z); if (m) dc.rot.fu.set(`${m[1]}:${m[2]}`, m[3] ? 0 : 1); });  // x = off
    }
    dc.rotq = null;
  }
  const R = dc.rot, pick = R.pick[fi] ||= {}, cur = F.info[dc.slot], slots = dcSlots(x), up = dc.up;
  if (cur.tier && f.idx.includes(dc.slot) && !(cur.tier in pick)) pick[cur.tier] = dc.slot;  // the skill on screen plays its tier
  const deck = { 1: pick[1] ?? f.deck[1], 2: pick[2] ?? f.deck[2], 3: pick[3] ?? f.deck[3] };
  const slotOf = (i) => R.sl[i] ?? deck[R.order[i]], en = (sl) => { const sk = slots[sl][1]; return dcaBare(dcaEnU(sk, cqAt(sk, up)).name); };
  // the target at the start: the fight state's statuses with Potency and Count
  let carry = {};
  const first = dcModelOf(x, slots[slotOf(0)][1]);
  if (first && first.m.auto) for (const k in first.s) {
    const v = first.s[k], q = /^t_(\w+)_p$/.exec(k), q1 = /^t_(\w+)$/.exec(k);
    if (q && v > 0 && first.s[`t_${q[1]}_c`] > 0) carry[q[1]] = { p: v, c: first.s[`t_${q[1]}_c`] };
    else if (!q && q1 && !/_c$/.test(k) && dcaG(q1[1]).st === 1 && v > 0) carry[q1[1]] = { n: v };  // one-number (Promised Nail, L'Abject)
  }
  // your own statuses: the ones the texts gain (and the damage reads) move; the rest stay as set
  const used = [...new Set([...R.order.map((_, i) => slotOf(i)), ...f.fu])], pas = dcaOwnPas(x, up), fuc = Object.fromEntries(f.fu.map((z) => [z, dcaFuCond(x, en(z), up)]));
  const read = new Set(), me = {};
  for (const sl of used) { const bm = dcModelOf(x, slots[sl][1]); if (bm && bm.m.auto) for (const k in bm.s) if (/^s_|^g_sp$/.test(k)) { read.add(k); if (!(k in me)) me[k] = bm.s[k]; } }
  Object.values(fuc).forEach((c) => c.forEach((r) => r.tests.forEach((q) => { if (q.side === "self") dcOwnKeys(q.kw).forEach((k) => read.add(k)); })));
  const tracked = new Set();
  [...used.flatMap((sl) => dcaOwnEv(slots[sl][1], up)), ...pas].forEach((e) => { const kw = e.sp ? "sp" : e.kw; if ((e.op === "add" || e.sp) && dcOwnKeys(kw).some((k) => read.has(k))) tracked.add(kw); });
  F.forms.forEach((q) => tracked.delete(q.kw));  // the form's own status
  const kept = [...new Set([...read].map((k) => k === "g_sp" ? "sp" : k.replace(/^s_/, "").replace(/_[pc]$/, "")))].filter((kw) => !tracked.has(kw) && !F.forms.some((q) => q.kw === kw));
  const meT = () => Object.fromEntries([...tracked].flatMap(dcOwnKeys).map((k) => [k, me[k] || 0]));
  const copy = (c) => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, { ...v }]));
  const after = (r) => { if (!r.bm.m.auto) return; for (const [kw, b0, a] of r.bm.m.target(r.s, r.o).st) { if (typeof b0 === "number") { if (a > 0) carry[kw] = { n: a }; else delete carry[kw]; } else if (a && a.p > 0 && a.c > 0) carry[kw] = { p: a.p, c: a.c }; else delete carry[kw]; } };
  const pasCard = pas.filter((e) => e.at === "hit" || e.at === "post" || e.at === "use"), ok = (e) => tracked.has(e.sp ? "sp" : e.kw);
  const own = (r, sl) => { if (!r.bm.m.auto) return; const ev = dcaOwnEv(slots[sl][1], up), cl = r.cancel && new Set(ev.filter((e) => e.cancel).map((e) => e.line)); dcOwnAfter(me, cl ? ev.filter((e) => cl.has(e.line)) : [...ev, ...pasCard], { s: r.s, c: r.c, name: en(sl) }, tracked, pend); };
  // "At less than 3 [X] Potency, cancel the Skill": that card deals nothing
  const cancel = (r, sl) => r.bm.m.auto && dcaOwnEv(slots[sl][1], up).some((e) => e.cancel && e.conds.every((c) => !c.q || dcaOk(c, r.s))) ? { ...r, c: { ...r.c, total: 0, stag: 0, coins: [] }, cancel: true } : r;
  const cards = [];
  let tot = 0, stag = 0, pend = [], lastS = {};
  R.order.forEach((tier, i) => {
    const slot = slotOf(i), sk = slots[slot][1], name = en(slot), sc = { ...lastS, __name: name };
    if (i) {  // turn start: statuses' own losses, the passives' Combat Start lines, then this skill's On Use gains
      for (const kw of tracked) { const te = kw !== "sp" && dcaTurnEnd(kw); if (te && te.start) dcOwnDo(me, { conds: [], kw, part: dcaG(kw).st === 2 ? "c" : "s", op: "eat", n: te.start, upTo: true }, sc); }
      pas.forEach((e) => { if (e.at === "start" && ok(e)) dcOwnDo(me, e, sc); });
      dcaOwnEv(sk, up).forEach((e) => { if (e.op === "add" && e.at === "pre" && ok(e)) dcOwnDo(me, e, sc); });
    }
    const into = copy(carry), me0 = meT(), meC = { ...me }, one = (sl) => { const r = cancel(dcOne(x, sl, i ? carry : null, null, i ? meT() : null), sl); if (!r.cancel) after(r); own(r, sl); return r; };
    const main = one(slot);
    lastS = main.s;
    // what you had on this card (a meter shows at 0)
    const mine = Object.fromEntries([...tracked].map((kw) => { const ks = dcOwnKeys(kw), v = ks.map((k) => meC[k] || 0); return [kw, ks.length === 2 ? { p: v[0], c: v[1] } : { n: v[0] }, ks.every((k) => meC[k] != null)]; })
      .filter(([kw, v, on]) => kw === "sp" ? on : v.n > 0 || v.c > 0 || (on && dcaCaps(kw).meter)).map(([kw, v]) => [kw, v]));
    // follow-ups: by their text's condition, or your pick
    const fu = f.fu.map((z) => {
      const c = fuc[z], ov = R.fu.get(`${i}:${z}`), cs = c.some((r) => r.pre);
      const auto = c.length ? dcFuFires(c, cs ? { ...main.s, ...me0 } : { ...main.s, ...meT() }, cs ? into : carry, name, tier) : false;
      return { z, read: c.length > 0, auto, ov, on: ov != null ? !!ov : auto, why: (c.length ? c.map((r) => r.line) : c.lines).join("\n") };
    });
    const fus = fu.filter((q) => q.on).map((q) => one(q.z));
    // turn end as each status says: Count −N (Tremor, Burn, Charge…), none for Sinking / Bleed / Rupture; Burn hits
    let burn = 0;
    carry = Object.fromEntries(Object.entries(carry).flatMap(([k, v]) => {
      const e = dcaTurnEnd(k);
      if (e.dmg && main.s.stdmg && v.p) burn += v.p;
      if (v.n != null) { const n = e.dec === "all" ? 0 : v.n - e.dec; return n > 0 ? [[k, { n }]] : []; }  // Stacks
      const c = e.dec === "all" ? 0 : v.c - e.dec;
      return c > 0 ? [[k, { p: v.p, c }]] : [];
    }));
    // yours: "for one turn" ones go, Counts drop; then Turn End lines and what was gained for next turn
    for (const kw of tracked) {
      if (kw === "sp") continue;
      const e = dcaTurnEnd(kw), ks = dcOwnKeys(kw);
      if (e.one || e.dec === "all") ks.forEach((k) => { me[k] = 0; });
      else if (e.dec) dcOwnDo(me, { conds: [], kw, part: ks.length === 2 ? "c" : "s", op: "eat", n: e.dec, upTo: true }, sc);
    }
    pas.forEach((e) => { if (e.at === "end" && ok(e)) dcOwnDo(me, e, { ...main.s, __name: name }); });
    pend.forEach(([e, s]) => dcOwnDo(me, e, s));
    pend = [];
    const sum = main.c.total + fus.reduce((a, r) => a + r.c.total, 0) + burn, sg = main.c.stag + fus.reduce((a, r) => a + r.c.stag, 0);
    tot += sum; stag += sg;
    cards.push({ i, tier, slot, kind: F.info[slot].kind, main, fus, fu, into, mine, sum, stag: sg, burn });
  });
  return { R, F, f, fi, deck, cards, tot, stag, kept };
}
// a skill dragged from the bar: onto a card it plays there, past the last card it is one more card
function dcSetCard(i, slot, F) {
  const R = dc.rot;
  if (i >= R.order.length) { if (R.order.length >= DC_CARDS) return; i = R.order.length; }
  R.order[i] = F.info[slot].tier; R.sl[i] = slot;
}
function dcDelCard(i) {
  const R = dc.rot;
  if (R.order.length < 2) return;
  R.order.splice(i, 1); R.sl.splice(i, 1);
  R.fu = new Map([...R.fu].flatMap(([z, v]) => { const [a, s] = z.split(":"); return +a === i ? [] : [[`${+a > i ? a - 1 : a}:${s}`, v]]; }));
  if (dc.turn === i) dc.turn = -1; else if (dc.turn > i) dc.turn--;
}
function dcMoveCard(from, to) {
  const R = dc.rot, idx = R.order.map((_, i) => i), [m] = idx.splice(from, 1);
  idx.splice(to, 0, m);
  R.order = idx.map((i) => R.order[i]);
  R.sl = idx.map((i) => R.sl[i] ?? null);
  R.fu = new Map([...R.fu].map(([z, v]) => { const [i, s] = z.split(":"); return [`${idx.indexOf(+i)}:${s}`, v]; }));
  if (dc.turn >= 0) dc.turn = idx.indexOf(dc.turn);
}

function dcbHtml(x, t) {
  const fig = dcFig(t, 76);
  return `<div class="dcpage dcnew">
    <div class="dctop"><h1>Damage calculator</h1><p class="muted small dccredit">Formula: the game's (see "All multipliers"). Presets to compare: <a href="https://github.com/BaTyANl/ElderCalc" target="_blank" rel="noopener">BaTyANl calc ↗</a></p></div>
    <div class="dcb dcskwrap"><div class="dcskbar" id="dcskbar"></div><div class="dcrot" id="dcrot"></div></div>
    <div class="dcfight">
      <div class="dcb dcyou">${dcPickA(x)}<div class="dcctl2">${dcKind()}</div><div class="dcctl2">${dcUp()}</div><div class="dcctl2">${dcLvIn()}</div><div class="dcctl2"><button class="toggle" id="dcmax" title="Every status at what this skill needs for its most damage (the game's caps)">Max for this skill</button></div><div id="dcbself"></div></div>
      <div class="dcb dcmid" id="dcres"></div>
      <div class="dcb dcdum">${dcPickB(t)}
        ${t.e ? "" : `<div class="dcctl2"><span class="lvlabel">Defense Level</span><input type="number" id="dcdlv" class="dcnum" value="${t.def}"></div>
          <details class="dcresd"><summary>Resistances <span id="dcreschips"></span></summary><div class="dcresrow">${dcResKeys().map(dcResIn).join("")}</div></details>`}
        <div id="dcbdum" data-fig="${esc(fig)}"></div><div id="dcbtgtctl"></div></div>
    </div>
    <div class="dcb dcwhy">
      <div class="dcbhead"><h2>Why this number</h2><button class="toggle" id="dcballon">All on</button><button class="toggle" id="dcballoff">All off</button></div>
      <div class="dcbhint">What adds to the damage, biggest first. The number is how much the total drops if you switch the row off (or grows if you switch it on).</div>
      <div class="dcbstack"><div class="dcbsect" id="dcbskhead"></div><div class="dcbrows" id="dcbskill"></div></div>
      <div class="dcbstack"><div class="dcbsect"><span class="dcbpn">P</span>Passives</div><div class="dcbrows" id="dcbpass"></div></div>
      <details class="dcbnd"><summary id="dcbndsum"></summary><ul id="dcbnd"></ul></details>
    </div>
    <details class="dcb dcfold"><summary>Compare and edit by hand · BaTyANl calc · manual table</summary>
      <div class="dcbbat" id="dcbbat"></div>
      <p class="muted small">The manual table: every number of the formula editable, BaTyANl presets one click away.</p><button class="toggle" id="dcbman">Open the manual table</button></details>
    <div class="dcmodal" id="dcmodal" hidden><div class="dcmbox" role="dialog" aria-modal="true" aria-label="Damage multipliers"><button class="dcmx" id="dcmx" aria-label="Close">✕</button><div id="dcmult"></div></div></div>
  </div>`;
}
function dcFig(t, w) {
  return t.e ? enTileImg(t.e) || `<span class="dcnopic"></span>` : `<svg viewBox="0 0 120 150" width="${w}" height="${Math.round(w * 1.25)}" aria-hidden="true">
    <rect x="34" y="138" width="52" height="8" fill="#3a2a20"/><rect x="57" y="96" width="6" height="44" fill="#5a4030"/>
    <rect x="36" y="44" width="48" height="58" rx="10" fill="#6b4a2c"/><circle cx="60" cy="26" r="16" fill="#7a5634"/><rect x="20" y="52" width="80" height="8" rx="4" fill="#5a4030"/>
    <circle cx="60" cy="72" r="16" fill="#e9c9a0"/><circle cx="60" cy="72" r="11" fill="#b3160f"/><circle cx="60" cy="72" r="6" fill="#e9c9a0"/><circle cx="60" cy="72" r="2.5" fill="#b3160f"/></svg>`;
}

// controls are built once per skill, never while dragging: switch (0/1), buttons (small ranges), − n + (counts), a slider (wide ranges)
function dcbControls() {
  const { id, b } = dc.bm, s = b.s, pairs = id.pairs || [], cOf = new Map(pairs), inPair = new Set(pairs.map(([, c]) => c));
  const all = [...(id.sp ? [["sp", "SP", -45, 45]] : []), ...id.sliders], lims = Object.fromEntries(all.map(([k, , a, z]) => [k, [a, z]]));
  const name = (k, l) => l.replace(/ on (self|target)$/, "").replace(/ (Potency|Count)$/, (m0) => cOf.has(k) ? "" : m0);
  // − n + with a number you can type (a slider too for wide ranges, a switch for 0/1); what other statuses give shows inside the number, which can't go below it
  const ext = (k) => (dc.ext && dc.ext[k]) || 0;
  const num = (k, v, lo, hi) => `<input type="number" class="dcnumin" data-n="${k}" min="${lo}" max="${hi}" value="${v}" aria-label="${esc(k)}">`;
  const ctl = (k) => {
    const [a, z] = lims[k], v = s[k] ?? a;
    if (z - a === 1) return `<label class="dcbsw"><input type="checkbox" data-k="${k}" ${v > a ? "checked" : ""} aria-label="${esc(k)}"><i></i></label>`;
    if (z - a >= 30) return `<span class="dcrange"><input type="range" data-k="${k}" min="${a}" max="${z}" value="${v}" aria-label="${esc(k)}">${num(k, v, a, z)}</span>`;
    return `<span class="dcstep" data-st="${k}"><button data-d="-1" aria-label="less">−</button>${num(k, v + ext(k), a + ext(k), Math.max(z, a + ext(k)))}<button data-d="1" aria-label="more">+</button></span>`;
  };
  const step2 = (k, l) => ctl(k).replace('<span class="dcstep"', `<span class="dcstep" title="${l}"`).replace('<button data-d="-1"', `<em>${l}</em><button data-d="-1"`);
  const row = ([k, l]) => `<div class="dcst"><div class="dcstn">${k === "sp" ? `SP <span class="dcbstchip" id="dcbst"></span>` : name(k, l)}</div><div class="dcstc">${cOf.has(k) ? step2(k, "Pot.") + step2(cOf.get(k), "Cnt") : ctl(k)}</div><div class="dcbfrom dcch" id="dcbch_${k}"></div></div>`;
  const lab = (k) => (all.find((q) => q[0] === k) || [])[1] || "", items = all.filter(([k]) => !inPair.has(k)), tSide = (k) => /^t_|^g_(spT|stag|shT|mhpT|tm|neg)$/.test(k) || / on target$/.test(lab(k));
  const grp = (h, list) => list.length ? `<div class="dcbsect2">${h}</div>${list.map(row).join("")}` : "";
  const self = items.filter(([k]) => !tSide(k)), tgt = items.filter(([k]) => tSide(k));
  $("#dcbself").innerHTML = grp("Fight state", self.filter(([k, l]) => !/^s_/.test(k) && !/ on self$/.test(l))) + grp("Statuses on self", self.filter(([k, l]) => /^s_/.test(k) || / on self$/.test(l))) || `<div class="dcbfrom">Nothing about this unit changes the damage.</div>`;
  $("#dcbtgtctl").innerHTML = grp("On the target before the skill", tgt) || `<div class="dcbfrom">Nothing on the target matters for this skill.</div>`;
  const paint = (k) => {
    if (!lims[k]) return;
    const [a, z] = lims[k], e = ext(k);
    document.querySelectorAll(`[data-k="${k}"]`).forEach((el) => { if (el.type === "checkbox") el.checked = s[k] > a; else if (el.type === "range") el.value = s[k]; });
    document.querySelectorAll(`[data-n="${k}"]`).forEach((el) => {
      const wide = !!el.closest(".dcrange");
      el.min = wide ? a : a + e; el.max = wide ? z : Math.max(z, a + e);
      if (document.activeElement !== el) el.value = s[k] + (wide ? 0 : e);
    });
  };
  dc.paint = paint;  // dcbRefresh repaints when given amounts change
  const put = (k, v) => { s[k] = Math.max(lims[k][0], Math.min(lims[k][1], v)); paint(k); };
  // no Potency without Count: 0 clears the other, rising from 0 brings it to 1
  const set = (k, v) => {
    put(k, v);
    for (const [p, c] of pairs) { const o = k === p ? c : k === c ? p : ""; if (o) { if (s[k] === 0) put(o, 0); else if (s[o] === 0) put(o, 1); } }
    if (k === "sp") dcbState();
    dcbRefresh();
  };
  const box = $("#main");
  box.querySelectorAll("input[data-k]").forEach((el) => { el[el.type === "range" ? "oninput" : "onchange"] = () => set(el.dataset.k, el.type === "checkbox" ? (el.checked ? lims[el.dataset.k][1] : lims[el.dataset.k][0]) : +el.value); });
  box.querySelectorAll("input[data-n]").forEach((el) => {
    el.onchange = () => { const k = el.dataset.n; set(k, Math.round(dcNum(el.value)) - (el.closest(".dcrange") ? 0 : ext(k))); };
    el.onkeydown = (e) => { if (e.key === "Enter") el.blur(); };
  });
  box.querySelectorAll("[data-st] button").forEach((el) => el.onclick = () => { const k = el.parentElement.dataset.st; set(k, (s[k] ?? lims[k][0]) + +el.dataset.d); });
  // All off also empties the fight state; All on brings it back
  const allRows = (v) => { const bm = dc.bm; bm.m.rows.forEach((r) => { bm.b.on[`${bm.key}.${r.k}`] = v; }); bm.id.sliders.forEach(([k, , a]) => { bm.b.s[k] = v ? bm.id.start[k] : a; }); dcbControls(); dcbRefresh(); };
  $("#dcballon").onclick = () => allRows(true);
  $("#dcmax").onclick = () => { const { x } = dcCtx(); dcMax(x, dc.slot, dcForms(x, dcSlots(x))); dc.bm = dcbFor(x, dcSlots(x)[dc.slot][1]); dcbControls(); dcbRefresh(); };
  $("#dcballoff").onclick = () => allRows(false);
  $("#dcbman").onclick = () => { dc.manual = 1; dc.s = null; dcDraw(); };
  $("#dcmx").onclick = () => { $("#dcmodal").hidden = true; };
  $("#dcmodal").onclick = (e) => { if (e.target.id === "dcmodal") $("#dcmodal").hidden = true; };
  if (!dc.esc) { dc.esc = 1; document.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("#dcmodal")) $("#dcmodal").hidden = true; }); }
}
// SP over 0: the other state's skill
function dcbState() {
  const { id, key, b } = dc.bm, nk = id.model(b.s);
  if (nk === key) return;
  const { x, slots } = dcCtx(), i = slots.findIndex(([, sk]) => id.skills[sk.id] === nk);
  if (i < 0) return;
  dc.slot = i; dc.s = null; dc.bm = dcbFor(x, slots[i][1]);
}

// the fight state at this skill's best (its starting numbers), the form's own status kept
function dcMax(x, i, F, form) {
  const bm = dcbFor(x, dcSlots(x)[i][1]);
  if (!bm) return;
  Object.assign(bm.b.s, bm.id.start);
  const g = form || F.forms[F.of(i)];
  if (F.forms.length > 1) F.forms.forEach((q) => { if (q.kw) bm.b.s[`s_${q.kw}`] = q === g ? 1 : 0; });
}
// touch: hold, a copy follows the finger, drop on the card (or "+ turn") under it; mouse keeps HTML5 drag
const dcDragged = () => Date.now() - (dc.touchEnd || 0) < 500;
const DC_EDGE = 90, DC_SPEED = 16;  // edge strip (px) where a dragged copy scrolls the page, top speed (px a frame)
// what scrolls here: the nearest scrolling parent (the desktop's #main), else the page
function dcScroller(el) {
  for (let a = el.parentElement; a && a !== document.body; a = a.parentElement)
    if (/auto|scroll/.test(getComputedStyle(a).overflowY) && a.scrollHeight > a.clientHeight + 1) return a;
  return document.scrollingElement;
}
function dcTouchDrag(el, start, drop) {
  el.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" || e.button) return;
    const x0 = e.clientX, y0 = e.clientY, id = e.pointerId, dr = el.draggable;
    let ghost = null, over = null, dx = 0, dy = 0;
    el.draggable = false;  // no native drag on touch
    const place = (x, y) => { ghost.style.transform = `translate(${x - dx}px, ${y - dy}px)`; };
    const timer = setTimeout(() => {
      const b = el.getBoundingClientRect();
      dx = x0 - b.left; dy = y0 - b.top;
      ghost = el.cloneNode(true); ghost.classList.add("dcghost"); ghost.classList.remove("on", "drag"); ghost.style.width = `${b.width}px`;
      document.body.appendChild(ghost); place(x0, y0); start();
      raf = requestAnimationFrame(edge);
      if (navigator.vibrate) try { navigator.vibrate(15); } catch (_) { /* no vibration */ }
    }, 350);
    let fx = x0, fy = y0, raf = 0, sc = null, up = false, down = false;
    const hit = () => {
      const t = document.elementFromPoint(fx, fy), to = t && t.closest(".dccard, .dcadd");
      if (to !== over) { if (over) over.classList.remove("over"); if (to) to.classList.add("over"); over = to; }
    };
    // the page cannot scroll under the finger while dragging: it scrolls by itself near the top / bottom edge
    const edge = () => {
      raf = ghost ? requestAnimationFrame(edge) : 0;
      if (!ghost) return;
      sc = sc || dcScroller(el);
      const root = sc === document.scrollingElement, r = root ? { top: 0, bottom: innerHeight } : sc.getBoundingClientRect();
      const top = Math.max(0, r.top), bottom = Math.min(innerHeight, r.bottom), z = Math.min(DC_EDGE, (bottom - top) / 3);
      // (an edge counts once the finger has been away from it: a skill picked up right at the edge does not run off)
      if (fy >= top + z) up = true;
      if (fy <= bottom - z) down = true;
      const k = up && fy < top + z ? -(top + z - fy) / z : down && fy > bottom - z ? (fy - (bottom - z)) / z : 0;
      if (!k) return;
      const was = sc.scrollTop;
      sc.scrollTop += Math.round(Math.sign(k) * Math.max(3, Math.min(1, Math.abs(k)) * DC_SPEED));
      if (sc.scrollTop !== was) hit();
    };
    const move = (ev) => {
      if (ev.pointerId !== id) return;
      if (!ghost) { if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > 10) end(null); return; }
      fx = ev.clientX; fy = ev.clientY;
      place(fx, fy); hit();
    };
    const block = (ev) => { if (ghost && ev.cancelable) ev.preventDefault(); };  // no scroll while dragging
    const menu = (ev) => ev.preventDefault();
    const end = (ev) => {
      clearTimeout(timer); cancelAnimationFrame(raf);
      document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", end); document.removeEventListener("pointercancel", end);
      document.removeEventListener("touchmove", block); el.removeEventListener("contextmenu", menu);
      el.draggable = dr;
      if (!ghost) return;
      ghost.remove(); if (over) over.classList.remove("over");
      dc.touchEnd = Date.now();
      drop(ev && ev.type === "pointerup" ? over : null);
    };
    document.addEventListener("pointermove", move); document.addEventListener("pointerup", end); document.addEventListener("pointercancel", end);
    document.addEventListener("touchmove", block, { passive: false }); el.addEventListener("contextmenu", menu);
  });
}
function dcbBar(x, slots, F, rot) {
  const fi = F.of(dc.slot), f = F.forms[fi];
  const btn = (i) => {
    const v = cqAt(slots[i][1], dc.up), k = F.info[i], r = dcOne(x, i, null, { forms: F.forms, cur: f });
    return `<button class="dcsk${i === dc.slot ? " on" : ""}${k.tier ? "" : " kind"}" data-slot="${i}"${rot && rot.R.open ? ' draggable="true"' : ""} style="--sin:${SIN_COLORS[v.sin] || "#4a3424"}">
      <small>${sinIcon(v.sin, "s16")}${atkIcon(v, "s16")}${esc(k.kind)}</small><span>${esc(v.name)}</span><b>${r ? r.c.total : "—"}</b></button>`;
  };
  $("#dcskbar").innerHTML = `${F.forms.length > 1 ? `<div class="dcform"><span class="lvlabel">Form</span><span class="cqkind">${F.forms.map((q, j) => `<button class="${j === fi ? "on" : ""}" data-form="${j}">${q.kw ? dcImg(q.kw) : ""}${esc(q.label)}</button>`).join("")}</span>
      <span class="dcbfrom">${f.kw ? `Skills only ${esc(f.label)} has` : "Before the form changes"}</span></div>` : ""}
    <div class="dcsks"><span class="lvlabel">Skill</span><div class="dcskrow">${f.idx.map(btn).join("")}</div></div>`;
  $("#dcskbar").querySelectorAll("[data-slot]").forEach((el) => el.onclick = () => {
    if (dcDragged()) return;
    const i = +el.dataset.slot, k = F.info[i];
    if (rot && k.tier) rot.R.pick[fi][k.tier] = i;  // the rotation plays this one for its tier
    dcMax(x, i, F);
    dc.slot = i; dc.turn = -1; dc.s = null; dcDraw();
  });
  $("#dcskbar").querySelectorAll("[draggable][data-slot]").forEach((el) => {
    el.ondragstart = (e) => { dc.dragSlot = +el.dataset.slot; e.dataTransfer.effectAllowed = "copy"; e.dataTransfer.setData("text/plain", el.dataset.slot); $("#dcrot").classList.add("dcdrop"); };
    el.ondragend = () => { dc.dragSlot = null; $("#dcrot").classList.remove("dcdrop"); };
    dcTouchDrag(el, () => $("#dcrot").classList.add("dcdrop"), (to) => {
      $("#dcrot").classList.remove("dcdrop");
      if (!to) return;
      dcSetCard(to.dataset.card != null ? +to.dataset.card : rot.R.order.length, +el.dataset.slot, F); dcbRefresh();
    });
  });
  $("#dcskbar").querySelectorAll("[data-form]").forEach((el) => el.onclick = () => {
    const g = F.forms[+el.dataset.form], cur = F.info[dc.slot], to = cur.tier && cur.tier in g.deck ? g.deck[cur.tier] : Object.values(g.deck)[0] ?? g.idx[0];
    dcMax(x, to, F, g);
    dc.slot = to; dc.turn = -1; dc.s = null; dcDraw();
  });
}

function dcbRot(x, slots, rot) {
  const el = $("#dcrot");
  if (!rot) { el.innerHTML = ""; return; }
  const R = rot.R, f = rot.f, nm = (i) => esc(cqAt(slots[i][1], dc.up).name);
  const into = (c) => Object.entries(c).map(([kw, v]) => `<span>${kw === "sp" ? "SP " : dcImg(kw)}${v.n != null ? v.n : `${v.p}·${v.c}`}</span>`).join("");
  const fuTag = (q) => q.ov != null ? "your pick" : q.read ? "auto" : "not read, your choice";
  const card = (cd) => { const v = cqAt(slots[cd.slot][1], dc.up); return `<div class="dccard${cd.i === dc.turn ? " on" : ""}" draggable="true" data-card="${cd.i}" style="--sin:${SIN_COLORS[v.sin] || "#4a3424"}" tabindex="0">
    <div class="dccturn"><span>Turn ${cd.i + 1}</span><span>${sinIcon(v.sin, "s16")}${esc(cd.kind)}</span></div><div class="dccnm" title="${nm(cd.slot)}">${nm(cd.slot)}</div>
    <b class="dccdmg">${cd.main.cancel ? `<span class="dccx" title="The skill's text cancels it here">0</span>` : cd.main.c.total}</b><div class="dccin" title="On the target before this card">${!cd.i ? "your fight state" : Object.keys(cd.into).length ? into(cd.into) : "nothing carried"}</div>
    ${Object.keys(cd.mine).length ? `<div class="dccme" title="Your statuses on this card">${into(cd.mine)}</div>` : ""}
    ${cd.fu.map((q) => { const r = cd.fus.find((z) => z.slot === q.z); return `<button class="dccfu${q.on ? " on" : ""}${q.read ? "" : " unk"}" data-fu="${cd.i}:${q.z}" title="${esc(q.why || "")}">+ ${nm(q.z)}${r ? ` <b>${r.c.total}</b>` : ""} <i>${fuTag(q)}</i></button>`; }).join("")}
    ${cd.stag ? `<div class="dccstg">+${cd.stag} Stagger</div>` : ""}${cd.burn ? `<div class="dccburn">+${cd.burn} ${dcImg("Combustion")}at turn end</div>` : ""}
    <div class="dccarr"><button data-mv="-1" aria-label="Earlier" ${cd.i ? "" : "disabled"}>‹</button><button data-mv="1" aria-label="Later" ${cd.i < R.order.length - 1 ? "" : "disabled"}>›</button>${R.order.length > 1 ? `<button data-del aria-label="Remove" title="Remove this card">✕</button>` : ""}</div></div>`; };
  el.innerHTML = `<div class="dcroth"><span class="lvlabel">Rotation · one pass through the deck</span><span class="dcrord">${rot.cards.map((cd) => esc(cd.kind)).join(" → ")}</span><span class="grow"></span>
      <b class="dcrtot">${rot.tot}</b><span class="muted small">damage${rot.stag ? ` · <span class="dcstgc">+${rot.stag} Stagger</span>` : ""}</span>
      <button class="toggle" id="dcrtog">${R.open ? "Hide" : "Show"}</button><button class="toggle" id="dcrcopy">Copy link</button></div>
    ${R.open ? `<div class="dcdeck">${rot.cards.map(card).join("")}${R.order.length < DC_CARDS ? `<div class="dcadd">+ turn</div>` : ""}</div>
      <div class="dcbhint">What a card inflicts stays on the target for the next cards. At turn end a status changes as its text says (Tremor, Burn: Count −1; Sinking, Bleed, Rupture stay). Click a card to see that turn; drag the cards or use the arrows to reorder them.</div>
      <div class="dcbhint">Your own statuses (the second row of icons on a card) change as the texts say: what a skill gains or spends, Poise Count −1 for every crit, turn end. Turn 1 starts from your fight state.${rot.kept.length ? ` <span>Stay as set (where they come from is not read):</span> ${rot.kept.map((kw) => `<span class="dcbkept">${kw === "sp" ? "SP" : dcImg(kw) || esc(statusName(kw))}</span>`).join(" ")}` : ""}</div>
      ${f.fu.length ? `<div class="dcbhint">A follow-up plays when its text's condition is met on that card (auto); a condition not read is your choice. Click it to switch it yourself, click again to go back to auto.</div>` : ""}
      <div class="dcbhint">Drag a skill from the bar above onto a card to play it on that turn, or onto “+ turn” after them to add a turn. ✕ removes a turn. On a phone: hold a skill or a card, then move it.</div>` : ""}`;
  $("#dcrtog").onclick = () => { R.open = !R.open; dcbRefresh(); };
  $("#dcrcopy").onclick = () => { const u = location.href; (navigator.clipboard ? navigator.clipboard.writeText(u) : Promise.reject()).then(() => toast("Link copied"), () => toast(esc(u), 8000)); };
  let from = -1;
  el.querySelectorAll(".dccard").forEach((c) => {
    const i = +c.dataset.card;
    c.onclick = (e) => {
      const fu = e.target.closest("[data-fu]"), mv = e.target.closest("[data-mv]");
      if (dcDragged()) return;
      if (fu) { const k = fu.dataset.fu, q = rot.cards[i].fu.find((z) => `${i}:${z.z}` === k); if (R.fu.has(k)) R.fu.delete(k); else R.fu.set(k, q && q.auto ? 0 : 1); dcbRefresh(); return; }
      if (mv) { dcMoveCard(i, i + +mv.dataset.mv); dcbRefresh(); return; }
      if (e.target.closest("[data-del]")) { dcDelCard(i); dcbRefresh(); return; }
      const cd = rot.cards[i];
      dc.turn = i;
      if (cd.slot !== dc.slot) { dc.slot = cd.slot; dc.s = null; dcDraw(); } else dcbRefresh();
    };
    c.onkeydown = (e) => { if (e.key === "Enter") c.click(); };
    c.ondragstart = (e) => { from = i; c.classList.add("drag"); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(i)); };
    c.ondragend = () => c.classList.remove("drag");
    dcTouchDrag(c, () => c.classList.add("drag"), (to) => {
      c.classList.remove("drag");
      if (to && to.dataset.card != null && +to.dataset.card !== i) { dcMoveCard(i, +to.dataset.card); dcbRefresh(); }
    });
    c.ondragover = (e) => { e.preventDefault(); c.classList.add("over"); };
    c.ondragleave = () => c.classList.remove("over");
    c.ondrop = (e) => {
      e.preventDefault(); e.stopPropagation(); c.classList.remove("over");
      if (dc.dragSlot != null) { dcSetCard(i, dc.dragSlot, rot.F); dc.dragSlot = null; el.classList.remove("dcdrop"); dcbRefresh(); }
      else if (from >= 0 && from !== i) { dcMoveCard(from, i); dcbRefresh(); }
    };
  });
  // a skill dropped past the cards: one more turn
  const deck = el.querySelector(".dcdeck");
  if (deck) {
    deck.ondragover = (e) => { if (dc.dragSlot != null) e.preventDefault(); };
    deck.ondrop = (e) => { if (dc.dragSlot == null) return; e.preventDefault(); dcSetCard(R.order.length, dc.dragSlot, rot.F); dc.dragSlot = null; el.classList.remove("dcdrop"); dcbRefresh(); };
  }
}

function dcbRefresh() {
  const { x, slots, label, u } = dcCtx(), t = dcTarget(), F = dcForms(x, slots), rot = dcRotCalc(x, F);
  if (dc.turn >= 0 && !(rot && rot.cards[dc.turn] && rot.cards[dc.turn].slot === dc.slot)) dc.turn = -1;
  const card = dc.turn >= 0 ? rot.cards[dc.turn] : null;
  const bm = dc.bm, { id, key, m, b } = bm, K = dcbK, o = dcbOn(bm), env = dcEnv(u);
  const s = card ? card.main.s : dcS(u, b.s), calc = (oo, ss = s, face) => dcbCalc(m, u, ss, oo, env, face);
  dcUrl();
  dcbBar(x, slots, F, rot);
  dcbRot(x, slots, rot);
  if ($("#dcdlv") && dc.dlv == null) $("#dcdlv").value = t.def;
  if ($("#dcreschips")) $("#dcreschips").innerHTML = [u.atk, u.sin].map((k) => { const v = t.R[k] ?? 1, [l, c] = RESIST(v); return `<span class="dcchip">${DC_TYPES.includes(k) ? ico(`res_${k}`, "s16", k, k) : sinIcon(k, "s16")}<span class="${c}">${l}</span><small>×${v}</small></span>`; }).join("");
  if (id.sp && $("#dcbst")) { const [k, extra] = id.sp(b.s); $("#dcbst").innerHTML = `${K(k)} ${extra}`; }
  const cn = m.chainNote ? m.chainNote(b.s) : {}, L = m.linked ? m.linked(dcS(u, b.s)) : null;
  dc.ext = {};  // what other statuses give: shown inside the number, its floor
  if (L) id.sliders.forEach(([k]) => { if (L[k] > (b.s[k] || 0)) dc.ext[k] = L[k] - (b.s[k] || 0); });
  if (dc.paint) id.sliders.forEach(([k]) => dc.paint(k));
  [...(id.sp ? [["sp"]] : []), ...id.sliders].forEach(([k]) => { const el = $(`#dcbch_${k}`); if (el) { const c2 = (id.pairs || []).find(([p]) => p === k); el.innerHTML = [cn[k], c2 && cn[c2[1]]].filter(Boolean).join(", "); } });
  $("#dcbskhead").innerHTML = `${sinIcon(u.sin, "s20")}${atkIcon(u, "s18")}${esc(label)} · ${esc(u.name)}<small>by damage</small>`;

  // number = damage lost if switched off; order from "everything on", so rows never move
  const now = calc(o), allOn = Object.fromEntries(m.rows.map((r) => [r.k, true])), full = calc(allOn).total;
  const val = (r) => o[r.k] ? now.total - calc({ ...o, [r.k]: false }).total : calc({ ...o, [r.k]: true }).total - now.total;
  const order = (r) => full - calc({ ...allOn, [r.k]: false }).total;
  const vals = new Map(m.rows.map((r) => [r.k, val(r)])), max = Math.max(1, ...vals.values());
  for (const [el, stack] of [["#dcbskill", "skill"], ["#dcbpass", "pass"]]) {
    const rows = m.rows.filter((r) => r.stack === stack).map((r, i) => [r, order(r), i]).sort((p, q) => q[1] - p[1] || p[2] - q[2]);
    $(el).innerHTML = rows.map(([r]) => dcbRow(r, vals.get(r.k), max, o, s)).join("") || `<div class="dcbfrom">${stack === "pass" ? "No passive adds damage to this skill." : "Nothing in this skill's text adds damage."}</div>`;
  }
  $("#main").querySelectorAll(".dcbsw input[data-row]").forEach((c) => c.onchange = () => { b.on[`${key}.${c.dataset.row}`] = c.checked; dcbRefresh(); });
  $("#dcbndsum").textContent = `Doesn't add damage here (${m.nodmg.length})`;
  $("#dcbnd").innerHTML = m.nodmg.map((h) => `<li>${h}</li>`).join("");

  // the result: total = hits + status damage; Stagger from Tremor Burst beside it
  const C = now.coins, add = u.op !== "SUB", lo = calc(o, s, "tails").total, hi = calc(o, s, "heads").total;
  // extra damage (not the coin hit itself): status damage, flat sin damage, shares of the Coin's damage — summed per kind, instances counted
  const xd = new Map(), xput = (k, v, n, o) => { if (!v) return; const e = xd.get(k) || { v: 0, n: 0, ...o }; e.v += v; e.n += n; xd.set(k, e); };
  C.forEach((c) => { xput("st", c.sdmg, 1, { st: m.stk || "Burst" }); (c.fx || []).forEach((f) => xput(`fl ${f.sin} ${f.src}`, f.v, 1, f)); xput(`sh ${c.sh} ${c.shA ? 1 : 0}`, c.shd, c.shn, { pct: +(+c.sh).toFixed(1), all: !!c.shA }); });
  const SINS = /^(Wrath|Lust|Sloth|Gluttony|Gloom|Pride|Envy)$/;
  const xdChip = ([k, e]) => {
    let ic = "", lab, sub = "", tip;
    if (k === "st") {
      ic = dcImg(e.st); lab = e.st === "Sinking" ? "Sinking damage" : "Rupture damage";
      tip = e.st === "Sinking" ? "Each hit sets off Sinking on the target: Gloom damage = its Potency (no SP), then Count −1" : "Each hit sets off Rupture on the target: damage = its Potency, then Count −1";
    } else if (k.startsWith("fl ")) {
      ic = SINS.test(e.sin) ? sinIcon(e.sin, "s16") : ""; lab = `${e.sin} damage`;
      if (e.src) { sub = `<small>from</small> <small class="notr">${esc(dcaG(e.src).name || e.src)}</small>`; tip = "A hit of its own when this status goes off, through the target's resistance to that sin"; }
      else tip = "A hit of its own from the Skill or passive text, through the target's resistance to that sin";
    } else {
      lab = "extra hit"; sub = `<small>${e.all ? `${e.pct}% of Coin damage, every target` : `${e.pct}% of Coin damage`}</small>`;
      tip = e.all ? "The Coin deals one more hit of its own to every target: a share of its final damage (after all multipliers)" : "The Coin deals one more hit of its own: a share of its final damage (after all multipliers)";
    }
    return `<span title="${tip}"><b>+${e.v}</b>${ic}<i>${lab}</i>${sub}${e.n > 1 ? `<small>×${e.n}</small>` : ""}</span>`;
  };
  const sd = [...xd.values()].reduce((a, e) => a + e.v, 0);
  const ci = dc.coin >= 0 && dc.coin < C.length ? dc.coin : C.length - 1, sel = C[ci], w = (u.targets || 1) + (now.x.aw || 0), h = now.x.targets || 1;
  const xc = (c) => {  // what only this coin has
    const out = [], X = now.x;
    if (X.coinDyn[c.ci]) out.push(`${dcSign(+X.coinDyn[c.ci].toFixed(1))}% this coin`);
    if (c.sh) out.push(`+${+c.sh.toFixed(1)}% of the final damage as its own hit`);
    if (X.coinCp[c.ci]) out.push(`Coin Power ${dcSign(X.coinCp[c.ci])} this coin`);
    if (X.coinFp[c.ci]) out.push(`Final Power ${dcSign(X.coinFp[c.ci])} this coin`);
    if (c.fin && X.last) out.push(`Final Power ${dcSign(X.last)} final coin`);
    if (c.fin && X.lastDyn) out.push(`${dcSign(+X.lastDyn.toFixed(1))}% final coin`);
    if (c.first && X.firstDyn) out.push(`${dcSign(+X.firstDyn.toFixed(1))}% first hit`);
    if (c.flat) out.push(`<span class="dcbsloth">incl. +${c.flat} ${c.fsin || m.flatSin}</span>`);
    if (c.sdmg) out.push(`<span class="dcbstd">incl. +${c.sdmg} ${m.stk === "Burst" ? "Rupture" : m.stk || m.stn}</span>`);
    if (c.stag) out.push(`<span class="dcstgc">Tremor Burst +${c.stag} Stagger</span>`);
    if (h > 1) out.push(`main ${c.main} + ${h - 1}× ${c.side}`);
    return out.map((z) => z.startsWith("<span") ? z : `<span>${z}</span>`).join(" · ");  // one text each, for the translation
  };
  const st0 = now.mod, dy = 1 + sel.d / 100;
  $("#dcres").innerHTML = `<div class="dcrsk">${sinIcon(u.sin, "s22")}${atkIcon(u, "s20")}<span>${esc(F.info[dc.slot].kind)} · ${esc(u.name)}</span></div>
    ${card ? `<div class="dcturn">Turn ${card.i + 1} of the rotation${card.i ? `: the target carries what turns 1–${card.i} inflicted` : ""}<button class="toggle" id="dcback">Back to my fight state</button></div>` : ""}
    <div class="dcbig"><b>${now.total}</b>${xd.size ? `<span class="dcxd">${[...xd].map(xdChip).join("")}</span>` : ""}${now.stag ? `<span class="dcstg">+${now.stag} Stagger<small>Tremor Burst</small></span>` : ""}</div>
    <div class="dcsum">${sd ? `<b>${now.total - sd}</b> from hits + <b>${sd}</b> extra damage · ` : ""}<span>${add ? "all heads" : "all tails (Minus Coins)"}</span> · <span>${h > 1 ? `${h} targets` : "one target"}</span> · all tails <b>${lo}</b> · all heads <b>${hi}</b></div>
    ${m.auto && w > 1 ? `<div class="dctbox"><span class="dcaw">Atk Weight ${w}</span><span class="cqkind">${Array.from({ length: w }, (_, i) => `<button data-hit="${i + 1}" class="${i + 1 === h ? "on" : ""}">hitting ${i + 1}</button>`).join("")}</span>
      <span class="dcbfrom">${w - h ? `${w - h} excess Atk Weight` : "no excess Atk Weight"}${h > 1 ? now.x.ramp ? " · each Coin hits one random target" : " · the other targets take −50%" : ""}</span></div>`
      : !m.auto && m.multi ? `<div class="dctbox"><span class="cqkind"><button data-hit="1" class="${h > 1 ? "" : "on"}">One target</button><button data-hit="9" class="${h > 1 ? "on" : ""}">All targets</button></span><span class="dcbfrom">${h > 1 ? "main target + the rest at −50%" : "Atk Weight turns into +20% damage each"}</span></div>` : ""}
    ${m.stn || m.bursts ? `<div class="dcsws">${m.stn ? `<label class="dcbstsw"><span class="dcbsw"><input type="checkbox" id="dcbstdmg" ${s.stdmg ? "checked" : ""}><i></i></span><span>Status damage <small>${K(m.stk)} going off on hits</small></span></label>` : ""}
      ${m.bursts ? `<label class="dcbstsw"><span class="dcbsw"><input type="checkbox" id="dcbtb" ${b.s.tb !== 0 ? "checked" : ""}><i></i></span><span>Tremor Burst <small>moves the Stagger bar by Tremor Potency, no HP damage</small></span></label>` : ""}</div>` : ""}
    <div class="dcbcoins">${C.map((c, i) => `<button class="dcbcoin${i === ci ? " on" : ""}" data-coin="${i}"><span class="${c.heads || c.reuse ? "" : "tails"}">${coinIcon("")}</span>
      <span class="dcbroll">${c.reuse ? `Reuse ${ROMAN[c.ci]}` : `Coin ${ROMAN[c.ci]}`} · ${c.heads ? "heads" : "tails"} · roll <em>${c.r}</em>${c.d ? ` · <em>${dcSign(+c.d.toFixed(1))}%</em>` : ""}${xc(c) ? `<br><span class="dcbx">${xc(c)}</span>` : ""}</span>
      <span class="dcbd">${c.one}</span></button>`).join("")}</div>
    <div class="dcmul">
      <span>Offense vs Defense ${dcSign(now.diff)}, resistances, crit, clashes <small>(static)</small></span><b>×${st0.toFixed(3)}</b>
      <span>% damage on ${sel.reuse ? "Reuse" : "Coin"} ${ROMAN[sel.ci]} ${dcSign(+sel.d.toFixed(1))}% <small>(dynamic, all added up)</small></span><b>×${dy.toFixed(2)}</b>
      <span class="tot">They multiply: every roll × ${st0.toFixed(3)} × ${dy.toFixed(2)}</span><b class="tot">×${(st0 * dy).toFixed(2)}</b></div>
    <button class="toggle dcmbtn" id="dcmopen">All multipliers and where they come from</button>`;
  $("#dcres").querySelectorAll("[data-hit]").forEach((el) => el.onclick = () => { dc.hit = +el.dataset.hit; dcbRefresh(); });
  $("#dcres").querySelectorAll("[data-coin]").forEach((el) => el.onclick = () => { dc.coin = +el.dataset.coin; dcbRefresh(); });
  if ($("#dcbstdmg")) $("#dcbstdmg").onchange = (e) => { b.s.stdmg = e.target.checked ? 1 : 0; dcbRefresh(); };
  if ($("#dcbtb")) $("#dcbtb").onchange = (e) => { b.s.tb = e.target.checked ? 1 : 0; dcbRefresh(); };
  if ($("#dcback")) $("#dcback").onclick = () => { dc.turn = -1; dcbRefresh(); };
  $("#dcmopen").onclick = () => { dcMult(now, ci, s, o, env); $("#dcmodal").hidden = false; $("#dcmx").focus(); };
  if (!$("#dcmodal").hidden) dcMult(now, ci, s, o, env);

  // the target: one figure per target hit, statuses after the skill and what changed them
  const tg = m.target(s, o), sg = (v) => v > 0 ? `+${v}` : `−${-v}`, fig = $("#dcbdum").dataset.fig;
  const mainSum = C.reduce((a, c) => a + c.main, 0), sideSum = C.reduce((a, c) => a + c.side, 0);
  const nm = (k) => esc((UNITS.glossary[k] || {}).name || statusName(k));
  const img = (k) => dcImg(k).replace('class="dcsti" ', "") || esc(statusName(k));
  $("#dcbdum").innerHTML = `<div class="dcbsect2">After ${esc(label)} · ${esc(u.name)}</div>
    ${card && card.i ? `<div class="dcbfrom"><span>Turn ${card.i + 1}: before it the target had</span> ${Object.keys(card.into).length ? Object.entries(card.into).map(([kw, v]) => `${dcImg(kw)}${v.n != null ? v.n : `${v.p}·${v.c}`}`).join(" ") : "<span>nothing</span>"} <span>(carried; the controls below set turn 1)</span></div>` : ""}
    ${card && card.i && Object.keys(card.mine).length ? `<div class="dcbfrom">Turn ${card.i + 1}, your statuses by the texts of the cards before: <span>${Object.entries(card.mine).map(([kw, v]) => `${kw === "sp" ? "SP " : dcImg(kw)}${v.n != null ? v.n : `${v.p}·${v.c}`}`).join(" ")}</span></div>` : ""}
    <div class="dcarena">${now.x.ramp && h > 1 ? `<div class="dcfig">${fig}<b>${C.reduce((a, c) => a + c.one, 0)}</b><small>${h} targets, one per Coin</small></div>` : Array.from({ length: Math.min(h, 6) }, (_, i) => `<div class="dcfig${i ? " side" : ""}">${i ? fig.replace(/width="\d+" height="\d+"/, 'width="48" height="60"') : fig}<b>${i ? sideSum : mainSum}</b><small>${i ? "−50%" : h > 1 ? "main target" : "damage"}</small></div>`).join("")}</div>
    <div class="dcbbadges">${tg.st.map(([k, b0, a]) => {
      if (typeof b0 === "number") return `<span class="dcbbadge" title="${nm(k)}">${img(k)}<b class="c">${a}</b>${a - b0 ? `<i class="dc">${sg(a - b0)}</i>` : ""}</span>`;
      const A = a || { p: 0, c: 0 }, dp = A.p - b0.p, dcn = A.c - b0.c;
      return `<span class="dcbbadge${a ? "" : " gone"}" title="${nm(k)}: Potency ${A.p}, Count ${A.c}">${img(k)}<b class="p">${A.p}</b><b class="c">${A.c}</b>
        ${dp ? `<i class="dp${dp < 0 ? " neg" : ""}">${sg(dp)}</i>` : ""}${dcn ? `<i class="dc${dcn < 0 ? " neg" : ""}">${sg(dcn)}</i>` : ""}</span>`;
    }).join("")}</div>${tg.st.length ? `<div class="dcblegend">on the main target · left Potency · right Count · green: from this skill</div>` : ""}
    <ul class="dcbadd">${[...tg.log.filter((e) => e.p || e.c).map((e) => `<li><b>${e.lab}</b> ${K(e.k)} ${[e.p ? `${sg(e.p)} Potency` : "", e.c ? `${sg(e.c)} Count` : ""].filter(Boolean).join(", ")}</li>`),
      ...(tg.blog || []).map((e) => e.no ? `<li><b>${esc(e.lab)}</b> ${K(e.kw)} not inflicted: ${K(e.by)} Count ${e.c} &lt; ${e.pay}</li>` : e.own ? `<li><b>${esc(e.lab)}</b> ${K(e.kw)} Count ${e.own} on self</li>` : e.add ?`<li><b>${esc(e.lab)}</b> ${K(e.kw)} +${e.add}</li>` : e.eat ? `<li><b>${esc(e.lab)}</b> ${K(e.kw)} −${e.eat} (consumed)</li>` : e.hit ?`<li class="dcbsloth"><b>${K(e.kw)}</b> on ${K("VibrationExplosion")}: +${e.hit} ${esc(e.sin)} damage</li>` : `<li class="dcstgc"><b>${esc(e.lab)}</b> ${K("VibrationExplosion")}${e.n > 1 ? ` ×${e.n}` : ""}: +${e.v} Stagger</li>`), ...tg.extra.map((q) => `<li>${q}</li>`)].join("") || `<li>Nothing changes on the target.</li>`}</ul>`;

  // BaTyANl check: his max against ours with his settings (target at his level, no resistances, no status damage)
  const zero = Object.fromEntries(m.rows.map((r) => [r.k, false])), atBat = dcbCalc(m, u, { ...b.s, ...(m.auto ? id.start : m.bat.set), stdmg: 0, tb: 0 }, m.auto ? Object.fromEntries(m.rows.map((r) => [r.k, !r.off])) : allOn, { diff0: u.level || 0, R: {} }).total;
  const his = dc.ecMap && ((dc.ecMap.get(x.id) || []).find((q) => q.alt === m.bat.alt) || {}).e;
  const hv = m.auto ? (dcPresets(x, label, u, dcSlots(x)).find((p) => p.fit) || { v: {} }).v.damage ?? null : his && his[m.bat.key] ? his[m.bat.key].damage : null;
  $("#dcbbat").innerHTML = `<div><span>Game values (bare skill)</span><b>${calc(zero).total}</b></div>
    <div><span><a href="https://github.com/BaTyANl/ElderCalc" target="_blank" rel="noopener">BaTyANl calc</a> max</span><b>${dc.ecMap ? hv ?? "—" : "…"} · ours ${atBat}</b></div>
    <div class="dcbcmp${hv === atBat ? " ok" : ""}">${!dc.ecMap ? "Loading BaTyANl calc…" : hv == null ? "No BaTyANl calc preset for this skill" : hv === atBat ? "✓ same as ours with his settings" : m.auto ? "Rows read from the game texts; his fight state can differ (ours: the starting state, rows as they start)" : esc(m.bat.note)}</div>`;
}

// the popup: every part of the formula for one coin, each with where it comes from
function dcMult(now, ci, s, o, env) {
  const bm = dc.bm, m = bm.m, { u } = dcCtx(), U = m.u || u, t = dcTarget(), c = now.coins[ci], X = now.x, seq = now.coins;
  const on = m.rows.filter((r) => o[r.k]), part = new Map(on.map((r) => [r, m.mods(s, { [r.k]: true })]));
  const nm = (r) => `${r.pn ? `<span class="dcbpn">${r.pn}</span> ` : ""}${r.title}`;
  const tr = (a, v, cls = "") => `<tr class="${cls}"><td>${a}</td><td>${v}</td></tr>`;
  const list = (f) => on.map((r) => [r, f(part.get(r))]).filter(([, v]) => v).map(([r, v]) => tr(nm(r), typeof v === "number" ? dcSign(+v.toFixed(1)) : v, "sub")).join("");
  const heads = seq.slice(0, ci + 1).filter((q) => q.heads).length;
  const res = (k) => (s.g_stag ? DC_STAG : env.R)[k] ?? 1, diff = now.diff;
  const add = U.op !== "SUB";
  $("#dcmult").innerHTML = `<h2>Damage multipliers · ${c.reuse ? "Reuse" : "Coin"} ${ROMAN[c.ci]}</h2>
    <div class="cqkind dcmtabs">${seq.map((q, i) => `<button data-mc="${i}" class="${i === ci ? "on" : ""}">${q.reuse ? "Reuse" : "Coin"} ${ROMAN[q.ci]}</button>`).join("")}</div>
    <p class="dcbfrom">damage per hit = floor( Roll × static × dynamic ). Inside each part the numbers add up; the parts multiply.</p>
    <div class="dcmblk"><div class="dcmbh"><span>Roll (power)</span><b>${c.r}</b></div><table>
      ${tr("Base Power", U.base)}${list((p) => p.base)}
      ${add ? tr(`Coin Power × ${heads} heads so far`, `${U.coin + X.cp} each`) + list((p) => p.cp) : tr("Minus Coins", `−${U.coin} each, tails is best`)}
      ${X.coinCp[c.ci] ? tr("Coin Power of this coin", dcSign(X.coinCp[c.ci])) + list((p) => p.coinCp[c.ci]) : ""}
      ${X.fp || X.coinFp[c.ci] || (c.fin && X.last) ? tr("Final Power", dcSign(X.fp + (X.coinFp[c.ci] || 0) + (c.fin ? X.last : 0))) + list((p) => (p.fp || 0) + (p.coinFp[c.ci] || 0) + (c.fin ? p.last || 0 : 0)) : ""}</table></div>
    <div class="dcmblk"><div class="dcmbh"><span>Static part</span><b>×${now.mod.toFixed(3)}</b></div><table>
      ${tr(`Offense ${dc.lv + (u.level || 0) + X.diff} vs Defense ${t.def} → ${dcSign(diff)}`, `${dcSign(+(100 * diff / (Math.abs(diff) + 25)).toFixed(1))}%`)}
      ${tr("Identity level", dc.lv, "sub")}${tr("Skill Offense Level", dcSign(u.level || 0), "sub")}${list((p) => p.diff)}
      ${tr(t.e ? `${esc(t.e.name)}: Defense Level` : "Dummy Defense Level", t.def, "sub")}
      ${tr(`${esc(U.atk)} resistance ×${res(U.atk)}`, `${dcSign(+(100 * dcRmod(res(U.atk))).toFixed(1))}%`)}${tr(`${esc(U.sin)} resistance ×${res(U.sin)}`, `${dcSign(+(100 * dcRmod(res(U.sin))).toFixed(1))}%`)}
      ${tr("Critical Hit", X.crit ? "+20%" : "0")}${tr(`Clashes won ${X.clash || 0}`, X.clash ? `+${3 * X.clash}%` : "0")}</table></div>
    <div class="dcmblk"><div class="dcmbh"><span>Dynamic part (all % damage)</span><b>×${(1 + c.d / 100).toFixed(2)}</b></div><table>
      ${list((p) => p.dyn)}${X.coinDyn[c.ci] ? tr("only this coin", "") + list((p) => p.coinDyn[c.ci]) : ""}${c.fin && X.lastDyn ? tr("only the final coin", "") + list((p) => p.lastDyn) : ""}${c.first && X.firstDyn ? tr("only the first hit", "") + list((p) => p.firstDyn) : ""}
      ${c.d ? "" : tr("nothing adds % damage", "0")}${c.t > 1 ? tr("the other targets", `${dcSign(X.subDyn)}% more`, "sub") : ""}</table></div>
    <div class="dcmfin">floor(<b>${c.r}</b> × <b>${now.mod.toFixed(3)}</b> × <b>${(1 + c.d / 100).toFixed(2)}</b>) = <b>${dcFloor(c.r <= 0 ? 1 : c.r * (1 + c.d / 100) * now.mod)}</b>${c.flat ? ` + ${c.flat} ${esc(c.fsin || m.flatSin)}` : ""}${c.sdmg ? ` + ${c.sdmg} status damage` : ""}${c.t > 1 ? ` + ${c.t - 1} × ${c.side} (other targets)` : ""}${X.tm ? ` · Time Moratorium ×${(1 + 0.15 * X.tm).toFixed(2)}` : ""}${c.flat || c.sdmg || c.t > 1 || X.tm ? ` → <b>${c.one}</b>` : ""}</div>
    <p class="dcbfrom">Status damage (Sinking, Rupture) and flat damage come after, through their own resistance. Tremor Burst moves the Stagger bar by Tremor Potency and deals no HP damage.</p>
    <details class="dcmres"><summary>Resistance table and the wiki formula</summary><table>
      ${tr("Fatal ×2", "+100%")}${tr("Weak ×1.5", "+50%")}${tr("Normal ×1", "0")}${tr("Endured ×0.5", "−25%")}${tr("Ineffective ×0.25", "−37.5%")}</table>
      <p class="dcbfrom">Static: resistances + level difference d / (|d| + 25) + Critical Hit 20% + 3% per clash won. Dynamic: every "% damage" added up (Damage Up / Fragile +10% per Count up to 100%, Protection −10%). <a href="https://limbuscompany.wiki.gg/wiki/Damage_Formula" target="_blank" rel="noopener">wiki: Damage Formula ↗</a></p></details>`;
  $("#dcmult").querySelectorAll("[data-mc]").forEach((el) => el.onclick = () => { dc.coin = +el.dataset.mc; dcbRefresh(); });
}

function dcbRow(r, v, max, o, s) {
  const on = o[r.k], why = r.need(s, o), tint = r.stack === "pass" ? " pass" : r.tint === "sloth" ? " sloth" : "";
  const lines = r.lines ? r.lines.map((l) => { const a = l.split(": ")[0]; return `<i class="muted">${esc(a)}</i> ${dcbText(l.slice(a.length + 2))}`; }).join("<br>") + "<br><br>" : "";
  const note = r.note ? String(r.note).replace(/counted as met: /, "<b>Assumed:</b> ") : "";
  return `<div class="dcbrow${!on ? " off" : v ? "" : " zero"}">
    <div class="dcbval${tint}"><b>+${v}</b><small>${on ? "lost if off" : "if on"}</small></div>
    <div class="dcbwhat">
      <div class="dcbttl">${r.pn ? `<span class="dcbpn">${r.pn}</span>` : ""}<b>${r.title}</b><span class="dcbfrom">${r.from}</span></div>
      <div class="dcbfx">${r.fx.map((f) => `<span>${f}</span>`).join("")}</div>
      ${why ? `<div class="dcbwhy">${why}</div>` : ""}${note ? `<div class="dcbfrom dcbnote">${note}</div>` : ""}
      <div class="dcbbar${tint}" style="width:${Math.max(2, 100 * v / max)}%"></div>
      <details class="dcbsrc"><summary>game text</summary><p>${lines}${r.how ? `<span class="muted">How the status works:</span><br>` : ""}${dcbText(r.text)}</p></details>
    </div>
    <label class="dcbsw" title="Count this"><input type="checkbox" data-row="${r.k}" ${on ? "checked" : ""} aria-label="count this row"><i></i></label>
  </div>`;
}

// ID / E.G.O card: a damage line under each attacking skill (db.js openUnit), with a link into the calculator
function dcSkillLine(x, s, up, level) {
  const slots = dcSlots(x), at = slots.findIndex(([, sk]) => sk === s);
  if (at < 0) return "";
  const u = cqAt(s, up), max = !x.title || up < (x.maxUp || 4) ? "" : `<span class="dcskmax" data-dcmax="${x.id}:${at}">${dcMaxText(x, slots, at)}</span>`;
  return `<div class="dcskline">${atkIcon(u, "s18")}${max}
    <a class="toggle" href="#/calc/${x.id}/${at}/${up}/${level}" onclick="$('#modal').classList.add('hidden')">Calculator →</a></div>`;
}
// ElderCalc's max for that form; loads his table on first use and fills the open card
function dcMaxText(x, slots, at) {
  if (!dc.ecMap) {
    dcLoadEc().then(() => document.querySelectorAll("[data-dcmax]").forEach((el) => {
      const [id, i] = el.dataset.dcmax.split(":").map(Number), y = unitById(id);
      if (y) el.innerHTML = dcMaxText(y, dcSlots(y), i);
    }));
    return "";
  }
  const [label, sk] = slots[at], p = dcPresets(x, label, cqAt(sk, 4), slots, at).filter((q) => q.fit);
  return p.length ? `<span class="muted">BaTyANl calc · max damage</span> <b title="${esc(dcPresetTip(p[0]))}">${p.map((q) => q.v.damage).join(" / ")}</b>` : "";
}
