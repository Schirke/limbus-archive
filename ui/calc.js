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
  try { await units(); if (!ENEMIES) ENEMIES = await api("/api/enemies"); } catch (e) { $("#main").innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  if (!UNITS.ids.length) { $("#main").innerHTML = `<div class="empty">Take a snapshot first — the database is read from it.</div>`; return; }
  dc.lv ||= MAX_LEVEL;
  const x = unitById(+args[0]);
  if (x && (x.id !== dc.id || +args[1] !== dc.slot)) { dc.ego = !x.title; dc.id = x.id; dc.slot = +args[1] || 0; dc.s = null; }
  if (+args[2] >= 1 && +args[2] <= 4 && +args[2] !== dc.up) { dc.up = +args[2]; dc.s = null; }  // from an ID card: its Uptie and level
  if (+args[3] >= 1) dc.lv = Math.min(+args[3], MAX_LEVEL);
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
  const s = p.v.setup, crit = s.coins.find((c) => c.critPercent != null);
  return { type: s.skillType || u.atk, sin: s.skillSin || u.sin, base: s.baseRoll || 0, passive: s.passiveModDynPercent || 0, clash: s.clashCount || 0,
    critP: crit ? crit.critPercent : 20, tm: s.timeMoratorium ? s.timeMoratoriumStacks || 1 : 0,
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

function dcDraw() {
  const { x, slots, label, u } = dcCtx();
  history.replaceState(null, "", `#/calc/${x.id}/${dc.slot}`);
  if (!u) { $("#main").innerHTML = `<div class="empty">This one has no attacking skill.</div>`; return; }
  if (!dc.s) { dc.s = dcFromGame(u); dc.pre = ""; }
  const t = dcTarget(), pres = dcPresets(x, label, u, slots), bm0 = dcbFor(x, slots[dc.slot][1]), bm = dc.bm = bm0 && !dc.manual ? bm0 : null;
  const resIn = (k) => `<label class="dcres">${DC_TYPES.includes(k) ? ico(`res_${k}`, "s20", k, k[0]) : sinIcon(k, "s20")}<input type="number" step="0.25" min="0" data-res="${k}" value="${dc.res[k] ?? 1}"></label>`;
  const tgtCard = t.e
    ? `${enTileImg(t.e) || `<span class="dcnopic"></span>`}<div class="grow"><div class="cqname">${esc(t.e.name)}</div>
        ${t.e.variants.length > 1 ? `<select id="dcev">${t.e.variants.map((v, i) => `<option value="${i}" ${i === dc.ev ? "selected" : ""}>${esc(v.label || `Variant ${i + 1}`)} · Lv. ${v.level}</option>`).join("")}</select>` : `<div class="muted small">${esc(t.v.label || "")} · Lv. ${t.v.level}</div>`}</div>`
    : `<span class="dcdummy">🎯</span><div class="grow"><div class="cqname">Training dummy</div><div class="muted small">No resistances unless you set them</div></div>`;
  $("#main").innerHTML = `<div class="dcpage"><h1>Damage calculator</h1>
    <p class="muted small dccredit">Formula and presets: <a href="https://github.com/BaTyANl/ElderCalc" target="_blank" rel="noopener">BaTyANl calc ↗</a></p>
    <div class="cqpicks">
      <div class="cqpick" data-side="a"><img src="${x.pics.thumb}" alt="" onerror="this.style.visibility='hidden'">
        <div class="grow"><div class="cqname">${esc(x.title || x.name)}</div><div class="muted small">${esc(x.sinnerName)}</div></div>
        <input class="cqin" placeholder="Change…" autocomplete="off"><div class="cqlist"></div></div>
      <div class="cqvs">VS</div>
      <div class="cqpick" data-side="b">${tgtCard}<input class="cqin" placeholder="Change…" autocomplete="off"><div class="cqlist"></div></div>
    </div>
    <div class="cqctl"><span class="cqkind"><button class="${dc.ego ? "" : "on"}" data-ego="0">Identities</button><button class="${dc.ego ? "on" : ""}" data-ego="1">E.G.O</button></span>
      <span class="lvlabel">${dc.ego ? "Threadspin" : "Uptie"}</span>${[1, 2, 3, 4].map((n) => `<button class="upbtn ${dc.up === n ? "on" : ""}" data-up="${n}">${ico(`up_${n}`, "s22", "", ROMAN[n - 1])}</button>`).join("")}
      <span class="lvlabel">Lv. <b id="dclvn">${dc.lv}</b></span><input type="range" id="dclv" min="1" max="${MAX_LEVEL}" value="${dc.lv}">
      ${t.e ? "" : `<span class="lvlabel">Dummy defense</span><input type="number" id="dcdlv" class="dcnum" value="${t.def}">`}</div>
    ${t.e ? "" : `<div class="dcresrow"><span class="lvlabel">Dummy resistances</span>${[...DC_TYPES, ...Object.keys(SIN_COLORS).filter((k) => k !== "None")].map(resIn).join("")}</div>`}
    <div class="dcslots">${slots.map(([l, s], i) => { const v = cqAt(s, dc.up); return `<button class="${i === dc.slot ? "on" : ""}" data-slot="${i}">${sinIcon(v.sin, "s20")}${atkIcon(v, "s18")}<span><small>${esc(l)}</small>${esc(v.name)}</span></button>`; }).join("")}</div>
    ${bm ? dcbHtml(label, t) : `<div class="dcgrid">
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
    </div>`}</div>`;
  if (bm) dcbControls(); else dcTable();
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
  m.querySelectorAll(".cqpick").forEach((p) => {
    const inp = p.querySelector("input.cqin"), list = p.querySelector(".cqlist"), foe = p.dataset.side === "b";
    inp.oninput = () => {
      const w = sxWords(inp.value), hit = (s) => { const t = sxNorm(s); return w.every((q) => t.includes(q)); };
      if (foe) {
        const found = w.length ? ENEMIES.list.filter((e) => e.variants && e.variants.length && hit(`${e.name} ${sxEn(e.name)}`)).slice(0, 8) : [];
        list.innerHTML = `<div data-en="0"><span class="dcdummy">🎯</span><span>Training dummy</span></div>` + found.map((e) => `<div data-en="${e.id}">${enTileImg(e)}<span>${esc(e.name)} <i>${esc(e.label || "")}</i></span></div>`).join("");
        list.querySelectorAll("[data-en]").forEach((d) => d.onmousedown = () => { dc.en = +d.dataset.en; dc.ev = 0; dcDraw(); });
      } else {
        const found = w.length ? dcList().filter((x) => hit(`${x.title || x.name} ${x.sinnerName} ${sxEn(x.title || x.name)} ${sxEn(x.sinnerName)}`)).slice(0, 8) : [];
        list.innerHTML = found.map((x) => `<div data-id="${x.id}"><img src="${x.pics.thumb}" alt=""><span>${esc(x.title || x.name)} <i>${esc(x.sinnerName)}</i></span></div>`).join("");
        list.querySelectorAll("[data-id]").forEach((d) => d.onmousedown = () => { dc.id = +d.dataset.id; dc.slot = 0; redraw(); });
      }
    };
    inp.onfocus = () => sxBack().then(() => inp.oninput());
    inp.onblur = () => setTimeout(() => { list.innerHTML = ""; }, 150);
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
    cut: (k, lab) => { if (!t[k]) return; t[k].c--; note(lab, k, "c", -1); if (t[k].c <= 0) { note("Ran out (Count 0)", k, "p", -t[k].p); delete t[k]; } } };  // Count 0 takes Potency
  const dmg = [];
  coins.forEach((c, i) => {
    if (c.pre) c.pre(f);
    dmg[i] = 0;
    for (const k of ["Sinking", "Burst"]) if (t[k]) { dmg[i] += t[k].p; f.cut(k, "By hits"); }  // the hit sets them off
    if (c.post) c.post(f);
  });
  return { t, dmg, log: [...log.values()] };
}

// ids: fight-state sliders ("… on target" = target side), skill id → model; models: rows (stack skill / pass), mods() = their numbers, target() = the dummy
let DCB = null;
function dcbData() {
  if (DCB) return DCB;
  const K = dcbK, sin = (x) => sinIcon(x), sinI = (...s) => s.map(sin).join(""), min = Math.min, fl = Math.floor;
  const SK = (s) => s.sink > 0 && s.sc > 0 ? s.sink + s.sc : 0;  // "X Sinking" = Potency + Count
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
        { k: "P4", stack: "pass", pn: "P4", title: "Obsidian Covenant", from: sinI("Pride", "Envy", "Sloth") + " owned", fx: [`damage +(${K("ChargeNoirAlly")} Potency × 6)%, max 30%`], need: (s) => s.pres ? "" : "needs Potency",
          text: "This unit's Base Attack Skills deal +([ChargeNoirAlly] Potency on self x 6)% damage against the main target (max 30%)" },
        { k: "P3", stack: "pass", pn: "P3", title: "The Lord's Will and Values Be With Us…", from: "always on", fx: [`final coin Final Power +(${K("ChargeNoirAlly")} Potency + ${K("NoirNailDonQuixote")} / 2), max +5`], need: (s) => s.pres || s.nail > 1 ? "" : "needs Potency or Nails",
          text: "On the final Coin Start of a Base Skill, the said Coin gains Final Power +([ChargeNoirAlly] Potency on self + ([NoirNailDonQuixote] on target / 2)) (max 5)" },
      ],
      mods: (s, o) => {
        const p3 = s.pres >= 3 && o.R1;
        return { cp: (o.R2 ? min(2, fl((s.trem + s.nail) / 6)) : 0) + (p3 ? 1 : 0), last: (o.R5 ? min(4, s.res) : 0) + (o.P3 ? min(5, s.pres + fl(s.nail / 2)) : 0),
          dyn: (p3 ? 40 : 0) + (o.P4 ? min(30, s.pres * 6) : 0) + (o.R3 ? 20 : 0), diff: (o.R4 ? 2 : 0) + (o.R3 ? min(2, fl(s.pres / 3)) : 0),
          flatLast: o.R6 && s.trem > 0 ? min(10, s.nail) : 0 };
      },
      target: (s) => {
        const TB = K("VibrationExplosion");
        const T = dcbSim([["Vibration", s.trem, s.tc]], [{ post: (f) => f.addP("Vibration", 4, "Coin I") }, { post: (f) => f.addC("Vibration", 3, "Coin II") },
          { post: (f) => { f.cut("Vibration", TB); if (s.nail + 1 >= 3) f.cut("Vibration", TB); } }]);
        return { log: T.log, st: [["Vibration", { p: s.trem, c: s.tc }, T.t.Vibration], ["NoirNailDonQuixote", s.nail, s.nail + 1]],
          extra: [`<b>Coin I</b> ${K("NoirNailDonQuixote")} +1`, `<b>Coin III</b> ${K("Vibration")} turns into ${K("VibrationFocusing")}`, `<b>${K("OathFieldDonQuixote")}</b> Speed −1`] };
      },
      nodmg: [`Coin III: ${K("Switch_Vibration")} into ${K("VibrationFocusing")} — not counted yet (its Sloth damage on Burst)`,
        `<span class="dcbpn">P1</span> <b>Malleus Promissionis</b>: gives ${K("ChargeNoirAlly")}, which feeds the rows above`,
        `<span class="dcbpn">P3</span> <b>The Lord's Will…</b> with ${K("OathFieldDonQuixote")}: Clash Power +3 (clash only)`,
        `<span class="dcbpn">P2</span> <b>Mission of Conservation</b>: ${K("NoirShieldUpDonQuixote")} (shield, Unbreakable Coins)`,
        `<span class="dcbpn">P4</span> <b>Obsidian Covenant</b>: 2 ${K("Agility")} next turn`,
        `<span class="dcbpn">S</span> <b>Formation Conservation</b> (support): allies take up to −10% damage`],
    },
    ROD_D: {
      bat: { key: "S3-2", alt: 3, set: { sp: -45, sink: 12, tears: 20, ts: 3 }, note: "His preset “3”: he counts +5% where P4 gives 2 Damage Up = +20% (wiki: +10% per Count), and skips its +1 Power Up." },
      stn: "Gloom", stk: "Sinking",
      rows: [
        { k: "D1", stack: "skill", title: `${K("Sinking")} on target`, from: "S3", fx: ["Final Power +1 per 3 Sinking (Potency + Count), max +4"], need: (s) => SK(s) >= 3 ? "" : `needs 3+ (now ${SK(s)})`,
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
        { k: "B1", stack: "skill", title: `6+ ${K("Sinking")} on target`, from: "S3", fx: ["Coin Power +1 at 6+ Sinking (Potency + Count)"], need: (s) => SK(s) >= 6 ? "" : `needs 6+ (now ${SK(s)})`,
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
const DCA_G = { neg: ["Negative effect types on target", 0, 10], spd: ["Speed over the target", 0, 10], speed: ["Speed", 1, 20], res: ["Highest Resonance", 0, 10], sp: ["SP", -45, 45],
  mhp: ["Missing HP %", 0, 99], mhpT: ["Missing HP % of the target", 0, 99], crack: ["Cracked Coins", 0, 5], crit: ["Critical Hits (0 none, 1 every coin)", 0, 1], clash: ["Clash count (Clash won)", 0, 10], aw: ["Atk Weight over one target", 0, 6], ally: ["Allies that count", 0, 6], tm: ["Time Moratorium stacks on target", 0, 2] };
// plain status names in texts
const DCA_NAMES = { Burn: "Combustion", Bleed: "Laceration", Tremor: "Vibration", Rupture: "Burst", Sinking: "Sinking", Poise: "Breath", Charge: "Charge" };
const DCA_TYPES = /\b(Slash|Pierce|Blunt|Wrath|Lust|Sloth|Gluttony|Gloom|Pride|Envy)\s+(?:damage|Skills?)\b/i;
const DCA_EFF = { cp: "Coin Power", fp: "Final Power", bp: "Base Power", ol: "Offense Level", dyn: "damage", take: "damage taken", reuse: "Reuse", tm: "Time Moratorium: damage +15% per stack, as Sloth" };
const dcaPlain = (t) => String(t || "").replace(/<[^>]*>/g, "").replace(/\{\/?hl\}/g, "").replace(/\s+/g, " ").trim();
const dcaG = (k) => UNITS.glossary[k] || {};
// English texts (the page may show another language)
const dcaEn = (kind, id, v) => (UNITS.en && UNITS.en[kind][id]) ?? v;
const DCA = new Map();

// "[Sinking] on target", "([Laceration] + [Sinking]) on the main target", "[X] Potency on self", "type of negative effect", "Stack consumed" → a term, or null
function dcaTerm(t, side, ctx = {}) {
  t = t.trim().replace(/[.,;]$/, "").replace(/^(?:value of |the )/i, "").replace(/(\]) (?:stage|value)s?$/i, "$1").replace(/(^|[\s(])(Burn|Bleed|Tremor|Rupture|Sinking|Poise|Charge)\b(?!\])/g, (_, a, b) => `${a}[${DCA_NAMES[b]}]`);
  const sm = /^(.*?)\s+(?:on|by) (?:the )?(?:main )?(target|self|this unit)$/i.exec(t);
  if (sm) { t = sm[1].trim(); side = /target/i.test(sm[2]) ? "target" : "self"; }
  if (/^\(.*\)$/.test(t) && !/\)\s*[+x]/.test(t.slice(1, -1))) t = t.slice(1, -1).trim();
  if (/ \+ /.test(t)) { const parts = t.split(/ \+ /).map((p) => dcaTerm(p, side, ctx)); return parts.every(Boolean) ? { sum: parts } : null; }
  let m;
  if ((m = /^\[(\w+)\](?:\s+(Potency|Count|Stacks?))?$/i.exec(t)) && dcaG(m[1]).st) {
    const g = dcaG(m[1]);
    return { kw: m[1], side: side || (g.type === "neg" ? "target" : "self"), part: /^p/i.test(m[2] || "") ? "p" : /^c/i.test(m[2] || "") ? "c" : "s" };
  }
  if (/types? of negative effects?/i.test(t)) return { g: "neg" };
  if (/^missing HP(?: percentage)?$/i.test(t)) return { g: side === "target" ? "mhpT" : "mhp" };
  if (/^(?:the )?target's missing HP$/i.test(t) || /^missing HP(?: percentage)? on (?:the )?(?:enemy|target)/i.test(t)) return { g: "mhpT" };
  if (/^Cracked Coins?$/i.test(t)) return { g: "crack" };
  if (/^(?:point of )?Speed difference$/i.test(t)) return { g: "spd" };
  if (/^Clash count$/i.test(t)) return { g: "clash" };
  if (/^(?:other |allied )?(?:ally|allies|Identity|Identities)\b/i.test(t)) return { g: "ally" };  // "for every ally that …"
  if (/^excess Atk Weight beyond/i.test(t)) return { g: "aw" };
  if ((m = /^\[(\w+)\] and \[(\w+)\] (?:this unit )?(?:consumed|spent)(?: in this Encounter)?$/i.exec(t)) && dcaG(m[1]).st && dcaG(m[2]).st)
    return { sum: [{ kw: m[1], side: "self", part: "s" }, { kw: m[2], side: "self", part: "s" }] };
  if (/^highest Reson/i.test(t)) return { g: "res" };
  if ((m = /^(-?)SP$/.exec(t))) return { g: "sp", neg: !!m[1] };
  if (/^(Stack|Stacks|effect's Stack|the effect's Stack)$/i.test(t) && ctx.own) return { kw: ctx.own, side: ctx.ownSide || "self", part: "s" };
  if (/^(?:combined )?Stacks?$/i.test(t) && ctx.headTerm) return ctx.headTerm;  // "based on (…)": its count
  if ((m = /^(?:\[(\w+)\] )?(Count |Stack |Stacks )?(?:about to be )?(?:consumed|spent)( by this Skill)?$/i.exec(t)) && (m[1] || ctx.use)) {
    const kw = m[1] || ctx.use.kw, cap = ctx.use && ctx.use.kw === kw && !m[3] ? ctx.use.cap : (ctx.spent || {})[kw] ?? null;
    if (!dcaG(kw).st) return null;
    return { kw, side: "self", part: /count/i.test(m[2] || "") || (ctx.use && ctx.use.kw === kw && ctx.use.c) ? "c" : "s", cap };
  }
  return null;
}
function dcaVal(q, s) {
  if (q.sum) return q.sum.reduce((a, p) => a + dcaVal(p, s), 0);
  if (q.prod) return q.prod.reduce((a, p) => a * dcaVal(p, s), 1);
  if (q.g) return (q.neg ? -1 : 1) * (s[`g_${q.g}`] || 0);
  const base = `${q.side[0]}_${q.kw}`;
  let v;
  if (dcaG(q.kw).st === 2) { const p = s[`${base}_p`] || 0, c = s[`${base}_c`] || 0; v = q.part === "p" ? p : q.part === "c" ? c : p > 0 && c > 0 ? p + c : 0; }
  else v = s[base] || 0;
  return q.cap != null ? Math.min(q.cap, v) : v;
}
function dcaLabel(q) {
  if (q.sum) return q.sum.map(dcaLabel).join(" + ");
  if (q.prod) return q.prod.map(dcaLabel).join(" × ");
  if (q.g) return (q.neg ? "−" : "") + DCA_G[q.g][0];
  return `${dcbK(q.kw)}${q.part === "p" ? " Potency" : q.part === "c" ? " Count" : ""} on ${q.side}`;
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
  return t.replace(DCA_NM.re, (all, a, n, at, str) => {
    const k = DCA_NM.by.get(n);
    if (!/\s/.test(n) && !/^ (Count|Potency)\b/.test(str.slice(at + all.length)) && !/\d\s*$/.test(str.slice(0, at + a.length))) return all;
    return `${a}[${k}]`;
  });
}

// a condition ("If target has 6+ [Sinking]", "At 3+ [X] Potency", "If this unit's Speed is faster…") → { q, n } or { unk }
function dcaCond(c, ctx) {
  let m;
  const t = c.trim();
  if (/(?:2|two) or more targets|multiple targets|several targets/i.test(t)) return { never: t, why: "only when hitting several targets" };
  if (/\b(?:is|was|gets) defeated\b/i.test(t)) return { never: t, why: "only after a defeat" };
  if ((m = /^(\d+)\+ (?:combined )?Stacks?$/i.exec(t)) && ctx.headTerm) return { q: ctx.headTerm, n: +m[1] };  // "- 3+ Stack: …" under "based on (…)"
  if ((m = /^(?:if (?:the )?(?:main )?target has|if this unit has|at) less than (\d+) (.+)$/i.exec(t)) && !/%/.test(m[2])) {
    const q = dcaTerm(/target has/i.test(t) && !/ on /.test(m[2]) ? m[2] + " on target" : m[2], /target has/i.test(t) ? "target" : "self", ctx);
    if (q) return { q, n: +m[1], lt: true };
  }
  if ((m = /^if (?:the )?(?:main )?target has (?:(\d+)\+ )?(.+)$/i.exec(t))) { const q = dcaTerm(/ on /.test(m[2]) ? m[2] : m[2] + " on target", "target", ctx); if (q) return { q, n: +(m[1] || 1) }; }
  if ((m = /^if this unit has (?:(\d+)\+ )?(.+)$/i.exec(t))) { const q = dcaTerm(m[2], "self", ctx); if (q) return { q, n: +(m[1] || 1) }; }
  if (/\bIdentit/i.test(t) && /target/i.test(t)) return { never: t };  // we hit enemies
  if ((m = /^at (-?\d+) or less SP$/i.exec(t))) return { q: { g: "sp", neg: true }, n: -m[1] };
  if ((m = /^at (\d+)\+ SP$/i.exec(t))) return { q: { g: "sp" }, n: +m[1] };
  if ((m = /^at (\d+)\+ Speed$/i.exec(t))) return { q: { g: "speed" }, n: +m[1] };
  if ((m = /^at (\d+)\+ (.+)$/i.exec(t))) { const q = dcaTerm(m[2], null, ctx); if (q) return { q, n: +m[1] }; }
  if ((m = /^at (\d+)\s*~\s*(\d+) (.+)$/i.exec(t))) { const q = dcaTerm(m[3], null, ctx); if (q) return { q, n: +m[1], max: +m[2] }; }
  if ((m = /^if this unit is in (?:an? )?\[(\w+)\] state$/i.exec(t)) && dcaG(m[1]).st) return { q: { kw: m[1], side: "self", part: "s" }, n: 1 };
  if ((m = /^if this unit's Speed is faster than (?:the )?(?:main )?target's(?: by (\d+) or more)?$/i.exec(t))) return { q: { g: "spd" }, n: +(m[1] || 1) };
  return { unk: t };
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
  if (ctx.headSkill && ctx.name && ctx.headSkill.toLowerCase() !== ctx.name.toLowerCase()) return { none: t, why: "another Skill", quiet: 1 };
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
    if (cut > 0) { conds.push(dcaCond(t.slice(0, cut), ctx)); rest = t.slice(cut + 1).trim(); }
    else if (!/Power|damage|Offense|Reuse/i.test(t)) { ctx.last = [...conds, dcaCond(t, ctx)]; ctx.comma = true; return null; }
  }
  // "On Clash Lose, …": a lost Clash, not this attack
  const lose = /^(?:On )?(?:Clash Lose|losing a Clash)\s*,\s*/i.exec(rest);
  if (lose) { conds.push({ never: lose[0], why: "only after a lost Clash" }); rest = rest.slice(lose[0].length); }
  const only2 = /^Skill (\d)(?:,? (?:and|or) Skill (\d))?(?:\s*:\s*|\s+(?=gains?\b|deals?\b))/i.exec(rest);
  if (only2) { if (![only2[1], only2[2]].includes(String(ctx.tier))) return { none: t, why: "another Skill", quiet: 1 }; rest = rest.slice(only2[0].length); }
  const use = /consumes? (?:up to (\d+) |all )?\[(\w+)\]( Count)?/i.exec(rest);
  if (use) ctx.use = { kw: use[2], cap: use[1] ? +use[1] : null, c: !!use[3] };
  const spend = /^spend (?:up to )?(\d+) \[(\w+)\]/i.exec(rest);
  if (spend) ctx.use = { kw: spend[2], cap: +spend[1] };
  // "Consume 15 [Charge] Count to gain …": needs that much
  const pay = /consumes? (\d+) \[(\w+)\]( Count| Potency)?/i.exec(rest);
  if (pay && dcaG(pay[2]).st) conds.push({ q: { kw: pay[2], side: "self", part: pay[3] ? pay[3].trim()[0].toLowerCase() : "s" }, n: +pay[1] });
  ctx.last = conds;
  const late = tags.some((g) => /^(OnSucceedAttack|OnWinDuel|OnLoseDuel|OnEndSkill|EndSkill|OnKill|AfterAttack|OnEndTurn|OnDie)/i.test(g));
  const crit = /Critical Hit/i.test(rest);
  const ty = DCA_TYPES.exec(rest);
  if (ty && ctx.atk && ty[1] !== ctx.atk && ty[1] !== ctx.sin && !/bonus|equal to/i.test(rest)) return { none: t, why: `${ty[1]} only` };
  if (ctx.op && (/Minus Coin/i.test(rest) && ctx.op !== "SUB" || /Plus Coin/i.test(rest) && ctx.op === "SUB")) return { none: t, why: "other coin kind" };
  // clauses split by top-level ";", each with its own "for every" and "(max)"
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
    if (rest.endsWith(":") || use || toSkill || basedOn) {
      ctx.head = conds; ctx.headMark = mark; ctx.headSkill = toSkill ? toSkill[1].trim() : null;
      ctx.headTerm = basedOn ? dcaTerm(basedOn[1].replace(/ Stacks?$/i, ""), null, ctx) : null;  // "based on (A + B)": what "N+ Stack" counts
      // "For every 10 [X], gain the following effects:" — the bullets count per 10
      const ev = rest.endsWith(":") && dcaEvery(rest), mm = ev && /^(\d+)\s+(.+)$/.exec(ev[1].trim()), q = mm && dcaTerm(mm[2], null, ctx);
      ctx.headPer = q ? { q, every: +mm[1] } : null;
      return use ? null : { none: t };
    }
    const gain = /\b(gain|gains|inflict|inflicts|apply)\b/i.test(rest);
    if (/damage|\bPower\b|Offense Level|Reuse/i.test(rest) && !/Clash Power|heal|SP damage|Stagger|Shield|less damage|damage taken|Defense Level|\btakes? -|\btakes? damage|cannot|can't|nullify|Unopposed Attack against|Atk Weight|defeated|collectively received|can be used up to/i.test(rest) && !gain) return { unk: t };
    return gain ? { gain: t } : { none: t };
  }
  if (conds.some((c) => c.q === undefined && !c.unk && !c.never)) return { unk: t };
  const scope = /final Coin/i.test(rest) && !fx.every((f) => f.k === "reuse" && f.last && ctx.coin == null) ? "last" : ctx.coin ?? "all";
  if (bullet && ctx.headPer) {
    const times = /\((\d+) times per Skill\)/i.exec(rest);
    fx.forEach((f) => { if (f.per) return; f.per = ctx.headPer.q; f.every = ctx.headPer.every; if (f.k === "reuse") { f.v = 1; if (times) f.cap = +times[1]; } });
  }
  const keep = /\binstead\b/i.test(rest) ? fx.filter((f, i) => !fx.slice(i + 1).some((g) => g.k === f.k)) : fx;
  return { fx: keep.map((f) => ({ ...f, scope, crit })), conds, late, t, inst: /\binstead\b/i.test(rest) };
}
// first top-level match of a one-character separator, or -1
function dcaCut(t, sep) {
  let d = 0;
  for (let i = 0; i < t.length; i++) { const ch = t[i]; if (ch === "(") d++; else if (ch === ")") d--; else if (!d && sep.test(ch)) return i; }
  return -1;
}
// one clause → [effects] | "unk" | "none"
function dcaClause(rest, ctx) {
  const fx = [];
  const both = /deal and take \+(\d+(?:\.\d+)?)% (?:more )?damage/i.exec(rest);
  if (both) return [{ k: "dyn", v: +both[1] }];
  const dmgUp = /^Damage \+(\d+(?:\.\d+)?)%$/i.exec(rest.trim());  // "[WinDuel] Damage +40%"
  if (dmgUp) return [{ k: "dyn", v: +dmgUp[1] }];
  // "gains Offense Level equal to (highest Reson.) (max 6)", "gains (highest Reson. / 2) Offense Level (max 3)"
  const KIND = { "coin power": "cp", "final power": "fp", "base power": "bp", "offense level": "ol" };
  const eqTo = /(Offense Level|Coin Power|Final Power|Base Power) equal to \(?([^()]+?)\)?\s*\(max (\d+)/i.exec(rest);
  const divBy = /\(([^()]+?)\s*\/\s*(\d+)\)\s*(Offense Level|Coin Power|Final Power|Base Power)(?:[^(]*\(max (\d+))?/i.exec(rest);
  if (eqTo) { const q = dcaTerm(eqTo[2], null, ctx); return q ? [{ k: KIND[eqTo[1].toLowerCase()], v: 1, per: q, every: 1, cap: +eqTo[3] }] : "unk"; }
  if (divBy) { const q = dcaTerm(divBy[1], null, ctx); return q ? [{ k: KIND[divBy[3].toLowerCase()], v: 1, per: q, every: +divBy[2], cap: divBy[4] ? +divBy[4] : undefined }] : "unk"; }
  const bonus = /\((\d+(?:\.\d+)?)% of this Coin's final damage\) bonus/i.exec(rest);
  if (bonus) return [{ k: "dyn", v: +bonus[1] }];
  const eq = /deal (\w+) damage equal to (?!.*% of this Coin's final damage).*\(max (\d+)\)/i.exec(rest);
  if (eq && /^(Wrath|Lust|Sloth|Gluttony|Gloom|Pride|Envy)$/i.test(eq[1])) return [{ k: "flat", v: +eq[2], sin: eq[1][0].toUpperCase() + eq[1].slice(1).toLowerCase() }];
  const based = /more damage based on (.+?)\s*\(\+(\d+(?:\.\d+)?)% (?:damage )?(?:per|for every) (?:(\d+)% )?([^,;)]+?)(?:[,;]\s*max \+?(\d+)%)?\)/i.exec(rest);
  if (based) {
    const q = dcaTerm(based[3] ? `${based[4]}${/target/i.test(based[1]) ? " on target" : ""}` : based[4], null, ctx) || dcaTerm(based[1], null, ctx);
    return q ? [{ k: "dyn", v: +based[2], per: q, every: +(based[3] || 1), cap: based[5] ? +based[5] : undefined }] : "unk";
  }
  // "use Coin 1 and 2 an additional time"
  const again = /use Coins? (\d)(?:,? (?:and )?(\d))?(?:,? (?:and )?(\d))? an additional time/i.exec(rest);
  if (again) return again.slice(1).filter(Boolean).map((n) => ({ k: "reuse", v: 1, at: +n - 1 }));
  // "Reuse Coin ([X] - 1) times (4 times max)"
  const rx = /Reuse (?:this )?Coin \((.+?) - (\d+)\) times/i.exec(rest);
  if (rx) { const q = dcaTerm(rx[1], null, ctx), mx = /(\d+) times max|max (\d+) times/i.exec(rest); return q ? [{ k: "reuse", v: 1, per: q, every: 1, off: -rx[2], cap: mx ? +(mx[1] || mx[2]) : undefined }] : "unk"; }
  const EFF = /(Coin Power|Final Power|Base Power|Offense Level|Clash Power|Skill Power)\s*([+-])\s*(\d+)|deals?\s+(?:an additional\s+)?\+\(([^%]*?)\)%\s+(?:more\s+)?(?:\w+\s+)?damage|takes?\s+\+(\d+(?:\.\d+)?)%\s+(?:more\s+)?damage|(?:deals?\s+(?:an additional\s+)?)?\+(\d+(?:\.\d+)?)%\s+(?:more\s+)?(?:\w+\s+)?damage|Reuse (?:this |the final )?Coin|\+(\d+) (Final Power|Coin Power|Offense Level|Base Power)|deals?\s+\w+\s+damage equal to (?:(\d+(?:\.\d+)?)|\(([^%]*?)\))% of this Coin's final damage/gi;
  for (let m; (m = EFF.exec(rest));) {
    if (m[1]) { if (/clash/i.test(m[1])) continue; fx.push({ k: { "coin power": "cp", "final power": "fp", "skill power": "fp", "base power": "bp", "offense level": "ol" }[m[1].toLowerCase()], v: (m[2] === "-" ? -1 : 1) * +m[3] }); }  // "Skill Power" = older word for Final Power
    else if (m[4] != null) {
      let e = m[4].replace(/\s+/g, " ").trim(), off = 0;
      // "+(50 + [Poise] on self + [Rupture] on target)%": a number plus counts
      const lead = /^(\d+(?:\.\d+)?) \+ (.+)$/.exec(e), tail = /^(.+) \+ (\d+(?:\.\d+)?)$/.exec(e);
      if (lead) { off = +lead[1]; e = lead[2]; } else if (tail && !/[x×/]/.test(e)) { off = +tail[2]; e = tail[1]; }
      const mm = /^(.+?)(\s+x\s+|\s*[×/]\s*)(.+)$/.exec(e);
      let q = null, mul = 1;
      if (off && !mm) { q = dcaTerm(e, null, ctx); if (!q) return "unk"; fx.push({ k: "dyn", v: 1, per: q, every: 0, off }); continue; }
      if (mm) {
        const a = dcaTerm(mm[1], null, ctx), b = dcaTerm(mm[3], null, ctx), na = parseFloat(mm[1]), nb = parseFloat(mm[3]);
        if (mm[2].trim() === "/" && a && Number.isFinite(nb)) { q = a; mul = 1 / nb; }
        else if (a && Number.isFinite(+mm[3])) { q = a; mul = +mm[3]; }
        else if (b && Number.isFinite(+mm[1])) { q = b; mul = na; }
        else if (a && b && mm[2].trim() !== "/") q = { prod: [a, b] };
      } else q = dcaTerm(e, null, ctx);
      if (!q) return "unk";
      fx.push({ k: "dyn", v: mul, per: q, every: 0 });
    }
    else if (m[5] != null) fx.push({ k: "take", v: +m[5] });
    else if (m[6] != null) fx.push({ k: "dyn", v: +m[6] });
    else if (m[9] != null) fx.push({ k: "dyn", v: +m[9], own: 1 });
    else if (m[10] != null) {
      const mm = /^(.+?)\s+x\s+(\d+(?:\.\d+)?)$/.exec(m[10].trim()), q = mm && dcaTerm(mm[1], null, ctx);
      if (!q) return "unk";
      fx.push({ k: "dyn", v: +mm[2], per: q, every: 0, own: 1 });
    }
    else if (m[7] != null) fx.push({ k: { "coin power": "cp", "final power": "fp", "base power": "bp", "offense level": "ol" }[m[8].toLowerCase()], v: +m[7] });
    else if (/cannot|can't/i.test(rest)) return "none";
    else { const n = /Coin once/i.test(rest) ? 1 : +((/(\d+) times? max|max (\d+) times?|(\d+) times/i.exec(rest) || []).slice(1).find(Boolean) || (/twice/i.test(rest) ? 2 : 1));
      fx.push({ k: "reuse", v: n, last: /final/i.test(m[0]) }); }
  }
  if (!fx.length) return fx;
  const ev = dcaEvery(rest), cap = /\(max\s+(-?[\d.]+)%?(?:\)|,|;|\s+and\b)|[;,]\s*max\s+(-?[\d.]+)/i.exec(rest);
  if (ev) {
    const mm = /^(\d+(?:\.\d+)?)%?\s+(.+)$/.exec(ev[1].trim()), q = dcaTerm(mm ? mm[2] : ev[1], null, ctx);
    if (!q) return "unk";
    fx.forEach((f) => { if (!f.per && f.k !== "reuse") { f.per = q; f.every = mm ? +mm[1] : 1; } });
  }
  if (cap) fx.forEach((f) => { if (f.k !== "reuse") f.cap = +(cap[1] ?? cap[2]); });
  return fx.filter((f, i) => f.k !== "reuse" || fx.findIndex((g) => g.k === "reuse") === i);  // one Reuse per clause
}

// the words after "for every", up to "(max", ";" / "," or a closing bracket
function dcaEvery(t) {
  const m = /for (?:every|each) |\bper (?=\d)/i.exec(t);
  if (!m) return null;
  let d = 0, i = m.index + m[0].length;
  const a = i;
  for (; i < t.length; i++) {
    const ch = t[i];
    if (ch === "(") { if (!d && /^\(max/i.test(t.slice(i))) break; d++; }
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
  if (f.per) { const n = Math.max(0, dcaVal(f.per, s) + (f.off || 0)); v = f.every ? f.v * Math.floor(n / f.every) : f.v * n; }
  if (f.cap != null) v = f.cap >= 0 ? Math.min(f.cap, v) : Math.max(f.cap, v);
  return v;
}
// what each term needs for the effect at its best: { key: value }
function dcaNeeds(f, conds, out) {
  const put = (q, n) => {
    if (q.sum) { q.sum.forEach((p) => put(p, Math.ceil(n / q.sum.length))); return; }
    if (q.prod) { q.prod.forEach((p) => put(p, Math.ceil(Math.sqrt(n)))); return; }
    if (q.g) { const k = `g_${q.g}`; out[k] = q.g === "sp" ? (q.neg ? Math.min(out[k] ?? 0, -n) : Math.max(out[k] ?? 0, n)) : Math.max(out[k] || 0, n); return; }
    const base = `${q.side[0]}_${q.kw}`, M = (k, v) => { out[k] = Math.max(out[k] || 0, v); };
    if (dcaG(q.kw).st === 2) {
      if (q.part === "p") { M(`${base}_p`, n); M(`${base}_c`, 1); } else if (q.part === "c") { M(`${base}_c`, n); M(`${base}_p`, 1); }
      else { M(`${base}_p`, Math.ceil(n / 2)); M(`${base}_c`, Math.max(1, n - Math.ceil(n / 2))); }
    } else M(base, n);
  };
  conds.forEach((c) => c.q && !c.lt && put(c.q, c.max != null ? c.max : c.n));
  if (f && f.per && f.v > 0) {
    const mx = (q) => q.kw && dcaG(q.kw).max;
    const n = f.k === "reuse" && f.cap == null ? (f.every || 1) * 2 - (f.off || 0)  // uncapped Reuse count: 2
      : (f.cap != null && f.v ? (f.every ? f.every * Math.ceil(Math.abs(f.cap / f.v)) : Math.ceil(Math.abs(f.cap / f.v))) : mx(f.per) || (f.every || 1) * 5) - (f.off || 0);
    put(f.per, f.per.g === "sp" ? 45 : f.per.g && f.cap == null ? DCA_G[f.per.g][2] : f.per.cap != null ? Math.min(f.per.cap, n) : n);
  }
}
function dcaFxText(f) {
  const v = f.k === "dyn" || f.k === "take" ? `${f.per && !f.every ? `${+f.v.toFixed(2)}%` : `${dcSign(f.v)}%`}` : dcSign(f.v);
  if (f.k === "flat") return `+${f.v} ${f.sin} damage (best case)${typeof f.scope === "number" ? ` · coin ${ROMAN[f.scope]}` : ""}`;
  const nm = f.k === "reuse" ? (f.v > 1 ? `Reuse ${f.v} times` : "Reuse once") : `${DCA_EFF[f.k]} ${f.per && !f.every ? `+(${dcaLabel(f.per)} × ${v})` : v}`;
  const per = f.per && f.every ? ` per ${f.every > 1 ? `${f.every} ` : ""}${dcaLabel(f.per)}` : "";
  const sc = f.at ?? f.scope, at = sc === "last" ? " · final coin" : typeof sc === "number" ? ` · coin ${ROMAN[sc]}` : "";
  return `${f.crit ? "on Critical Hit: " : ""}${nm}${per}${f.cap != null ? `, max ${f.cap}${f.k === "dyn" || f.k === "take" ? "%" : ""}` : ""}${at}`;
}
function dcaWhy(row, s) {
  for (const { f, conds } of row.parts) {
    if (f.crit && !s.g_crit) return "needs Critical Hits";
    const nv = conds.find((c) => c.never);
    if (nv) return nv.why || "only against Identities";
    for (const c of conds) if (c.q && !dcaOk(c, s)) return `needs ${c.lt ? "less than " : ""}${c.n}${c.lt ? "" : "+"} ${dcaLabel(c.q)} (now ${dcaVal(c.q, s)})`;
    if (f.per && !dcaVal(f.per, s)) return `needs ${dcaLabel(f.per)}`;
  }
  return "";
}

// how many Identities name a status in their texts (a few = their own mechanic)
let DCA_USE = null;
function dcaUse(kw) {
  if (!DCA_USE) {
    DCA_USE = new Map();
    for (const x of UNITS.ids) {
      const t = JSON.stringify([x.skills.map((s) => Object.values(s.up).map((v) => [v.desc, v.coindescs])), (x.passives || []).map((p) => p.desc)]);
      for (const k of new Set((t.match(/\[(\w+)\]/g) || []).map((s) => s.slice(1, -1)))) DCA_USE.set(k, (DCA_USE.get(k) || 0) + 1);
    }
  }
  return DCA_USE.get(kw) || 0;
}
// the skill at an Uptie with its English texts
function dcaEnU(sk, u) {
  const e = UNITS.en && UNITS.en.sk[sk.id], k = e && Object.keys(sk.up).find((n) => sk.up[n] === u);
  return k && e[k] ? { ...u, ...e[k] } : u;
}
function dcaModel(x, sk, up) {
  const key = `${x.id}.${sk.id}.${up}`;
  if (DCA.has(key)) return DCA.get(key);
  let u0 = cqAt(sk, up);
  if (!u0 || !u0.atk) return null;
  let u = dcaEnU(sk, u0);
  const slots = dcSlots(x), label = (slots.find(([, q]) => q === sk) || ["Skill"])[0], short = label.replace(/^Skill /, "S").replace(/^Counter$/, "C");
  // "At 6+ …, use 'Write 'em all down' as Counter": the Counter is counted as that Skill (the last one named)
  const turns = [...String(u.desc).matchAll(/^.*Reson.*use ['‘"“](.+?)['’"”] as (?:a )?Counter.*$/gim)].map((q) => q[1].toLowerCase());
  const into = turns.length && x.skills.find((q) => { const v = cqAt(q, up); return v && v.atk && dcaPlain(dcaEnU(q, v).name).toLowerCase() === turns[turns.length - 1]; });
  if (into) { u0 = cqAt(into, up); u = { ...dcaEnU(into, u0), into: dcaPlain(u0.name), from: u.desc }; }
  const rows = [], nodmg = [], needs = {}, gains = new Map(), seen = new Set();
  const note = (pn, h, unk) => nodmg.push(`${pn ? `<span class="dcbpn">${esc(pn)}</span> ` : ""}${dcbText(h)}${unk ? ` <span class="dcbunk">not read yet</span>` : ""}`);
  const gainsOf = (t0, from) => {
    const t = dcaNames(t0);
    const put = (side, kw, n, count) => {
      if (!dcaG(kw).st || !side) return;
      const k = `${side[0]}_${kw}`, e = gains.get(k) || { side, kw, p: 0, c: 0, from: [] };
      if (count) e.c = Math.max(e.c, n); else e.p = Math.max(e.p, n);
      if (!e.from.includes(from)) e.from.push(from);
      gains.set(k, e);
    };
    // "gain 1 [A] and 2 [B] next turn", "gain [A] and [B] equal to … (max 3)": every status of the clause
    for (const m of t.matchAll(/\b(gain|gains|inflict|inflicts|apply|applies)\b((?:(?!\b(?:gain|gains|inflict|inflicts|apply|applies)\b)(?:[^.;]|\.\d))*)/gi)) {
      // "… Fixer Sinclair gains": another Sinner's Identity, not this one
      const before = t.slice(0, m.index).split(/[.;:\n]/).pop().trim();
      if (/^(gains|applies|inflicts)$/i.test(m[1]) && (UNITS.sinners || []).some((n) => n !== x.sinnerName && before.endsWith(n))) continue;
      const side = /^(gain|apply)/i.test(m[1]) ? (/^appl/i.test(m[1]) && !/on self|to self/i.test(m[2]) && !/\b(?:on|to) self\b/i.test(t) ? "" : "self") : "target";
      const cl = m[2], upTo = /for every|every time|equal to/i.test(cl) && (/\(max (\d+)\)/i.exec(cl) || /\(max (\d+)\)/i.exec(t));
      // "When hit, gain 1 [X] next turn (3 per turn)": up to 3 times
      const times = /\((?:up to )?(\d+)(?: times)? per turn\)/i.exec(t.slice(m.index)), k = times && /^(when|on|after|every time)\b/i.test(before || t) ? +times[1] : 1;
      let any = false;
      for (const q of cl.matchAll(/(\+?)(\d+)\s+\[(\w+)\](\s+Count)?/g)) { any = true; put(side, q[3], upTo ? Math.max(+q[2], +upTo[1]) : +q[2] * k, q[1] || q[4]); }
      if (!any && upTo) for (const q of cl.matchAll(/\[(\w+)\]/g)) put(side, q[1], +upTo[1], false);
      // "gain [A]" without a number = 1; "[A] / [B] / [C]" = a choice: the last one
      else if (!any) {
        const lead = /^\s*((?:\[\w+\]\s*(?:\/|,|and|or)?\s*)+)/.exec(cl);
        if (lead) { const ks = [...lead[1].matchAll(/\[(\w+)\]/g)].map((q) => q[1]); (/\//.test(lead[1]) ? ks.slice(-1) : ks).forEach((kw) => put(side, kw, 1, false)); }
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
  const kind ={ atk: u.atk, sin: u.sin, op: u.op, tier: (/^Skill (\d)/.exec(label) || [])[1], spent, name: dcaPlain(u.name) }, sctx = { ...kind };
  let n = 0;
  read(u.desc, sctx, (r, l) => { gainsOf(dcaPlain(l), short); if (!r.gain) skillRow(r, l, `s${n++}`, short); });
  (u.coindescs || []).forEach((cd, i) => {
    const cctx = { ...kind, coin: i };
    cd.forEach((d) => read(d, cctx, (r, l) => { gainsOf(dcaPlain(l), `${short} coin ${ROMAN[i]}`); if (!r.gain) skillRow(r, l, `c${i}.${n++}`, `${short} coin ${ROMAN[i]}`); }));
  });
  // the rest of the kit: only for statuses
  const kit = x.title ? [...x.skills, ...(x.defense || [])] : x.skills;
  kit.forEach((q) => { if (q === sk) return; const v = cqAt(q, up) && dcaEnU(q, cqAt(q, up)); if (!v) return; const nm = (slots.find(([, z]) => z === q) || [v.name])[0];
    [v.desc, ...(v.coindescs || []).flat()].forEach((t) => gainsOf(dcaPlain(t), nm)); });

  // passives: battle ones at this Uptie (upgrades keep their earlier versions in prev), support ones off by default
  let pi = 0;
  if (x.title) for (const p0 of x.passives || []) {
    let p = p0;
    while (p && (p.uptie || 0) > up) p = p.prev;
    if (!p) continue;
    const pn = p.kind === "support" ? "S" : `P${++pi}`, cost = (p.cost || []).map((c) => `${sinIcon(c.sin)} ${c.n}`).join(" ");
    const from = `${cost}${cost ? (p.mode === "res" ? " Resonance" : " owned") : "always on"}${p.kind === "support" ? " · support: only if it lands on this unit" : ""}`;
    const pctx = { ...kind }, parts = [], left = [];
    read(dcaEn("ps", p.id, p.desc), pctx, (r, l) => {
      gainsOf(dcaPlain(l), pn);
      if (r.fx && !r.late) r.fx.forEach((f0) => {
        const prev = r.inst && [...parts].reverse().find((p) => p.f.k === f0.k), f = prev && !f0.per && f0.cap != null && prev.f.per && prev.f.scope === f0.scope ? { ...f0, per: prev.f.per, every: prev.f.every } : f0;
        parts.push({ f, conds: r.conds, inst: r.inst }); dcaNeeds(f, r.conds, needs);
      });
      else if (r.unk) left.push([l, true]);
    });
    if (parts.length) rows.push({ k: `p${pi}${pn}`, stack: "pass", pn, title: p.name, from, parts, text: dcaEn("ps", p.id, p.desc), off: p.kind === "support" });
    else note(pn, `<b>${esc(p.name)}</b>${left.length ? "" : ": nothing for damage here"}`, false);
    left.forEach(([l]) => note(pn, l, true));
  }

  // statuses: what they do to damage (game abilities first, else their text with "Stack" = their own number)
  const stRows = [];
  const tryStatus = (side, kw, from, val) => {
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
      String(dcaEn("gl", kw, g.desc)).split("\n").forEach((l) => { const r = dcaLine(l, c); if (!r || !r.fx || r.late) return;
        const fx = r.fx.filter((f) => (side === "self" ? f.k !== "take" : f.k === "take") && !covered.has(f.k === "take" ? "dyn" : f.k));
        fx.forEach((f) => parts.push({ f: { ...f, k: f.k === "take" ? "dyn" : f.k, scope: "all" }, conds: r.conds })); });
    }
    if (!parts.length) return;
    // its own number: what the kit gives (else 1); a status whose game ability has its own cap goes to that cap
    const rare = own.some((f) => f[3] != null);
    parts.forEach(({ f, conds }) => dcaNeeds(!rare && (own.length || f.cap == null && !(g.max <= 10)) && f.per && f.per.kw === kw ? null : f, conds, needs));
    const mine = `${side[0]}_${kw}`;
    if (needs[mine] > (g.max || 99)) needs[mine] = g.max;
    if (val >= 0) dcaNeeds(null, [{ q, n: Math.min(val || 1, g.max || 99) }], needs);
    stRows.push({ k: `st.${id}`, stack: "skill", title: `${dcbK(kw)} on ${side}`, from: from.length ? `from ${from.slice(0, 3).join(", ")}` : "status", parts, text: dcaEn("gl", kw, g.desc) || "" });
  };
  // statuses this unit has can give others ("Coffin: gain 2 Damage Up for every 3 Value (max 6)")
  for (const e of [...gains.values()]) if (e.side === "self" && (e.p || e.c)) { const d = dcaEn("gl", e.kw, dcaG(e.kw).desc); if (d) gainsOf(dcaPlain(d), e.from[0] || "P1"); }
  // statuses the kit gives (any skill or passive) start at that value; a negative one on self (Damage Down …) is a cost: there, at 0
  gains.forEach((e) => tryStatus(e.side, e.kw, e.from, e.side === "self" && dcaG(e.kw).type === "neg" ? -1 : e.p || e.c));
  // statuses the rows check also count by themselves
  const walk = (q) => { if (!q) return; if (q.sum) q.sum.forEach(walk); else if (q.kw) tryStatus(q.side, q.kw, [], 0); };
  [...rows].forEach((r) => r.parts.forEach(({ f, conds }) => { walk(f.per); conds.forEach((c) => walk(c.q)); }));
  rows.push(...stRows);
  rows.forEach((r) => { r.fx = r.parts.map(({ f }) => dcaFxText(f)); r.need = (s) => dcaWhy(r, s);
    // skill rows: named by their condition or what they count
    const c0 = r.parts[0].conds.find((c) => c.q), per = r.parts.find(({ f }) => f.per);
    if (r.stack === "skill" && !r.k.startsWith("st.")) r.title = c0 ? `${c0.n}+ ${dcaLabel(c0.q)}` : per ? dcaLabel(per.f.per) : r.parts.map(({ f }) => dcaFxText(f)).join(", ");
    const unk = r.parts.flatMap(({ conds }) => conds.filter((c) => c.unk).map((c) => c.unk));
    if (unk.length) r.note = `counted as met: ${esc(unk.join("; "))}`; });

  // Time Moratorium (T Corp): the stored damage comes back +15% per stack as Sloth damage
  if (/\[TimeSuspend\]/.test(JSON.stringify([x.skills.map((q) => Object.values(q.up).map((v) => [v.desc, v.coindescs])), (x.passives || []).map((p) => p.desc)]))) {
    rows.push({ k: "tm", stack: "skill", title: `${dcbK("TimeSuspend")} on target`, from: "this Identity's kit", parts: [{ f: { k: "tm", v: 1, per: { g: "tm" }, every: 1, scope: "all" }, conds: [] }], text: dcaEn("gl", "TimeSuspend", dcaG("TimeSuspend").desc) || "",
      fx: [DCA_EFF.tm], need: (s) => s.g_tm ? "" : "needs Time Moratorium on the target" });
    needs.g_tm = 2;
  }
  if ("g_aw" in needs) needs.g_aw = Math.max(0, (u.targets || 1) - 1);
  // Critical Hits: a Poise Identity (the game's own tag) or this skill's text talks of Poise / crits
  if ((x.statuses || []).includes("Breath") || /Critical|\[Breath\]|\bPoise\b/i.test([u.desc, ...(u.coindescs || []).flat()].join("\n"))
    || rows.some((r) => r.parts.some(({ f }) => f.crit))) needs.g_crit = 1;

  // the target: statuses with Potency and Count, from the sliders and the coin scripts
  const inf = (u.inf || []).filter(([, kw]) => dcaG(kw).st === 2);
  const tKws = new Set(inf.map(([, kw]) => kw));
  Object.keys(needs).forEach((k) => { const m = /^t_(\w+?)_(p|c)$/.exec(k); if (m) tKws.add(m[1]); });
  tKws.forEach((kw) => { for (const p of ["p", "c"]) { const k = `t_${kw}_${p}`; if (!(k in needs)) needs[k] = 0; } });
  const stk = tKws.has("Sinking") ? "Sinking" : tKws.has("Burst") ? "Burst" : "";

  // sliders: self first, then the target
  const sliders = [], pairs = [], start = {};
  const keys = Object.keys(needs).sort((a, b) => (a[0] === "t") - (b[0] === "t") || a.localeCompare(b));
  for (const k of keys) {
    let m, label, lo = 0, hi = 20;
    if ((m = /^g_(\w+)$/.exec(k))) { [label, lo, hi] = DCA_G[m[1]]; }
    else if ((m = /^([st])_(\w+?)_(p|c)$/.exec(k))) { label = `${dcbK(m[2])} ${m[3] === "p" ? "Potency" : "Count"} on ${m[1] === "t" ? "target" : "self"}`; hi = Math.max(20, needs[k]); if (m[3] === "p") pairs.push([k, `${m[1]}_${m[2]}_c`]); }
    else if ((m = /^([st])_(\w+)$/.exec(k))) { label = `${dcbK(m[2])} on ${m[1] === "t" ? "target" : "self"}`; hi = dcaG(m[2]).max || Math.max(10, needs[k]); }
    else continue;
    sliders.push([k, label, lo, hi]);
    start[k] = Math.max(lo, Math.min(hi, needs[k] || 0));
  }
  for (const [p, c] of pairs) if (!start[p] !== !start[c]) { start[p] ||= 1; start[c] ||= 1; }

  const order = { cp: "cp", fp: "fp", bp: "base", ol: "diff", dyn: "dyn" };
  if (u.into) nodmg.unshift(`<b>Counted as “${esc(u.into)}”</b>: this Counter turns into it (${dcbText(u.from.split("\n").find((l) => /as (?:a )?Counter/i.test(l)) || "")})`);
  const m = {
    auto: true, rows, stn: stk === "Sinking" ? "Gloom" : stk ? "Rupture" : "", stk, u: u.into ? u : undefined,
    bat: { auto: true },
    mods: (s, o) => {
      const out = { base: 0, cp: 0, fp: 0, last: 0, dyn: 0, diff: 0, lastDyn: 0, coinDyn: [], coinCp: [], coinFp: [], reuseAt: [], coinFlat: [], flatAll: [] };
      for (const r of rows) if (o[r.k]) {
        const vs = r.parts.map(({ f, conds }) => dcaEff(f, conds, s));
        r.parts.forEach((p, i) => { if (!p.inst || !vs[i]) return; for (let j = i - 1; j >= 0; j--) if (r.parts[j].f.k === p.f.k) { vs[j] = 0; break; } });  // "instead": the one before
        r.parts.forEach(({ f }, i) => {
          const v = vs[i];
          if (!v) return;
          if (f.k === "take") return;  // this unit takes more
          if (f.k === "tm") { out.tm = (out.tm || 0) + v; return; }
          if (f.k === "flat") { if (typeof f.scope === "number") (out.coinFlat[f.scope] ||= []).push([v, f.sin]); else out.flatAll.push([v, f.sin]); return; }
          if (f.k === "reuse") { const at = f.at ?? f.scope, c = typeof at === "number" ? at : u.coins - 1; for (let j = 0; j < v; j++) out.reuseAt.push(c); return; }
          if (typeof f.scope === "number") { const arr = { dyn: out.coinDyn, cp: out.coinCp, fp: out.coinFp }[f.k]; if (arr) arr[f.scope] = (arr[f.scope] || 0) + v; else out[order[f.k]] += v; }
          else if (f.scope === "last" && (f.k === "dyn" || f.k === "fp")) out[f.k === "dyn" ? "lastDyn" : "last"] += v;
          else out[order[f.k]] += v;
        });
      }
      out.crit = s.g_crit > 0;
      out.clash = s.g_clash || 0;
      return out;
    },
    target: (s, o, face = "best") => {
      const x2 = m.mods(s, o), seq = dcbSeq(u, x2), heads = face === "best" ? u.op !== "SUB" : face === "heads";
      const T = dcbSim([...tKws].map((kw) => [kw, s[`t_${kw}_p`] || 0, s[`t_${kw}_c`] || 0]), seq.map(([ci]) => ({
        post: (f) => inf.forEach(([i, kw, p, c, w]) => { if ((i === ci || i < 0) && (!w || (w === "H") === heads)) { f.add(kw, p, c, i < 0 ? label : `Coin ${ROMAN[ci]}`); } }) })));
      return { dmg: T.dmg, log: T.log, st: [...tKws].map((kw) => [kw, { p: s[`t_${kw}_p`] || 0, c: s[`t_${kw}_c`] || 0 }, T.t[kw]]), extra: [] };
    },
    nodmg,
  };
  const id = { sliders, start, pairs, skills: {}, model: () => key, auto: true };
  const out = { id, key, m };
  DCA.set(key, out);
  return out;
}
const dcbOn = (bm) => Object.fromEntries(bm.m.rows.map((r) => { const v = bm.b.on[`${bm.key}.${r.k}`]; return [r.k, v === undefined ? !r.off : v]; }));

// the formula of dcCalc on the model's numbers. face: "best" (heads on Plus Coins, tails on Minus Coins), "heads" or "tails"
function dcbCalc(m, u, s, o, env, face = "best") {
  u = m.u || u;  // a Counter that turns into another Skill
  const x = { base: 0, cp: 0, fp: 0, last: 0, dyn: 0, diff: 0, flatLast: 0, lastDyn: 0, reuse: false, targets: 1, subDyn: 0, coinDyn: [], coinCp: [], coinFp: [], reuseAt: [], coinFlat: [], flatAll: [], ...m.mods(s, o) };
  const res = (k) => env.R[k] ?? 1, sd = s.stdmg && m.stn ? m.target(s, o, face).dmg : [];
  const add = u.op !== "SUB", heads = face === "best" ? add : face === "heads";
  const seq = dcbSeq(u, x), n = seq.length, diff = env.diff0 + x.diff;
  const mod = 1 + diff / (Math.abs(diff) + 25) + dcRmod(res(u.atk)) + dcRmod(res(u.sin)) + (x.crit ? 0.2 : 0) + 0.03 * (x.clash || 0);
  let roll = u.base + x.base, total = 0;
  const coins = [];
  for (let i = 0; i < n; i++) {
    const [ci, again] = seq[i];
    if (heads) roll += add ? u.coin + x.cp + (x.coinCp[ci] || 0) : -u.coin;  // a Reuse tosses again
    const fin = i === n - 1, r = roll + x.fp + (fin ? x.last : 0) + (x.coinFp[ci] || 0), d = x.dyn + (fin ? x.lastDyn : 0) + (x.coinDyn[ci] || 0);
    const hit = (dd) => dcFloor(r <= 0 ? 1 : r * (1 + dd / 100) * mod);
    // flat adders and status damage through their sin's resistance
    const fl2 = [...(x.coinFlat[ci] || []), ...x.flatAll], fsin = fl2.length ? fl2[0][1] : m.flatSin;
    const flat = (fin && x.flatLast ? dcFloor(x.flatLast * res(m.flatSin)) : 0) + fl2.reduce((a, [v, k]) => a + dcFloor(v * res(k)), 0), sdmg = sd[i] ? dcFloor(sd[i] * (m.stn === "Gloom" ? res("Gloom") : 1)) : 0;
    let one = hit(d) + flat + (x.targets - 1) * hit(d + x.subDyn) + sdmg;
    if (x.tm) one = dcFloor(one * (1 + 0.15 * x.tm) * res("Sloth"));  // Time Moratorium
    coins.push({ r, one, d, heads, flat, fsin, sdmg, reuse: again, ci, t: x.targets });
    total += one;
  }
  return { total, coins, x, diff, mod };
}
// hits in order: [coin, reused?]; a Reuse hits again right after its coin
function dcbSeq(u, x) {
  const seq = [];
  for (let i = 0; i < u.coins; i++) { seq.push([i, false]); (x.reuseAt || []).forEach((z) => { if (z === i) seq.push([i, true]); }); }
  if (x.reuse) seq.push([u.coins - 1, true]);
  return seq;
}

function dcbHtml(label, t) {
  const fig = t.e ? enTileImg(t.e) || `<span class="dcnopic"></span>` : `<svg viewBox="0 0 120 150" width="76" height="95" aria-hidden="true">
    <rect x="34" y="138" width="52" height="8" fill="#3a2a20"/><rect x="57" y="96" width="6" height="44" fill="#5a4030"/>
    <rect x="36" y="44" width="48" height="58" rx="10" fill="#6b4a2c"/><circle cx="60" cy="26" r="16" fill="#7a5634"/><rect x="20" y="52" width="80" height="8" rx="4" fill="#5a4030"/>
    <circle cx="60" cy="72" r="16" fill="#e9c9a0"/><circle cx="60" cy="72" r="11" fill="#b3160f"/><circle cx="60" cy="72" r="6" fill="#e9c9a0"/><circle cx="60" cy="72" r="2.5" fill="#b3160f"/></svg>`;
  return `<div class="dcgrid dcbgrid">
    <div class="dcleft">
      <div class="dcb">
        <div class="dcbhead"><h2>Where the damage comes from</h2><button class="toggle" id="dcballon">All on</button><button class="toggle" id="dcballoff">All off</button><button class="toggle" id="dcbman" title="The old table with BaTyANl presets, every number editable">Manual table</button></div>
        <div class="dcbstate"><div class="dcbsect">Fight state</div><div id="dcbctl"></div><div class="dcbtgt" id="dcbtgt"></div></div>
        <div class="dcbstack"><div class="dcbsect" id="dcbskhead"></div><div class="dcbrows" id="dcbskill"></div></div>
        <div class="dcbstack"><div class="dcbsect"><span class="dcbpn">P</span>Passives<small>by damage</small></div><div class="dcbrows" id="dcbpass"></div></div>
        <details class="dcbnd"><summary id="dcbndsum"></summary><ul id="dcbnd"></ul></details>
        <div class="dcbhint">Number on the left: damage lost if you switch the row off (or added, if it is off). Rows keep their place when switched.</div>
      </div>
      <details class="dcbmanual"><summary>Manual numbers (the calculator's own fields)</summary><div class="dcmods" id="dcbmods"></div></details>
    </div>
    <div class="dcbmid"><div class="dcresult" id="dcres"></div><div class="dcbbat" id="dcbbat"></div></div>
    <div class="dcbdum"><div class="dcbdummy"><div class="dcbsect">On the target after ${esc(label)}</div>
      <div class="dcbfig">${fig}<div><div class="dcbbadges" id="dcbbadges"></div><div class="dcblegend">left Potency · right Count · green: from this skill</div></div></div>
      <ul class="dcbadd" id="dcbadd"></ul></div></div>
  </div>`;
}

// sliders are built once, never while dragging
function dcbControls() {
  const { id, b } = dc.bm, s = b.s, box = $("#dcbctl");
  const slider = (k, label, a, z, extra = "") => `<div class="dcbsl"><div class="dcbslh"><label for="dcbsl_${k}">${label}</label>${extra}</div><div class="dcbslrow">
    <button data-step="${k}" data-d="-1" aria-label="less">−</button><input type="range" id="dcbsl_${k}" min="${a}" max="${z}" value="${s[k]}"><button data-step="${k}" data-d="1" aria-label="more">+</button><output id="dcbo_${k}">${s[k]}</output></div></div>`;
  const onT = (l) => / on target$/.test(l), short = (l) => l.replace(/ on (self|target)$/, "");
  const mine = id.sliders.filter(([, l]) => !onT(l)), theirs = id.sliders.filter(([, l]) => onT(l));
  box.innerHTML = `<div class="dcbgroups">
    <div><div class="dcbgh">On self</div>${id.sp ? slider("sp", "SP", -45, 45, `<span class="dcbstchip" id="dcbst"></span>`) : ""}${mine.map(([k, l, a, z]) => slider(k, short(l), a, z)).join("")}</div>
    <div><div class="dcbgh">On the target</div>${theirs.map(([k, l, a, z]) => slider(k, short(l), a, z)).join("") || `<div class="dcbfrom">Nothing on the target matters for this skill.</div>`}</div></div>`;
  const lims = Object.fromEntries([...(id.sp ? [["sp", "", -45, 45]] : []), ...id.sliders].map(([k, , a, z]) => [k, [a, z]]));
  const put = (k, v) => { s[k] = Math.max(lims[k][0], Math.min(lims[k][1], v)); $(`#dcbsl_${k}`).value = s[k]; $(`#dcbo_${k}`).textContent = s[k]; };
  // no Potency without Count: 0 clears the other, rising from 0 brings it to 1
  const set = (k, v) => {
    put(k, v);
    for (const [p, c] of id.pairs || []) { const o = k === p ? c : k === c ? p : ""; if (o) { if (s[k] === 0) put(o, 0); else if (s[o] === 0) put(o, 1); } }
    if (k === "sp") dcbState();
    dcbRefresh();
  };
  Object.keys(lims).forEach((k) => { $(`#dcbsl_${k}`).oninput = (e) => set(k, +e.target.value); });
  box.querySelectorAll("[data-step]").forEach((el) => el.onclick = () => set(el.dataset.step, s[el.dataset.step] + +el.dataset.d));
  // All off also empties the fight state; All on brings it back
  const all = (v) => { const bm = dc.bm; bm.m.rows.forEach((r) => { bm.b.on[`${bm.key}.${r.k}`] = v; }); bm.id.sliders.forEach(([k, , a]) => { bm.b.s[k] = v ? bm.id.start[k] : a; }); dcbControls(); dcbRefresh(); };
  $("#dcballon").onclick = () => all(true);
  $("#dcbman").onclick = () => { dc.manual = 1; dc.s = null; dcDraw(); };
  $("#dcballoff").onclick = () => all(false);
}
// SP over 0: the other state's skill
function dcbState() {
  const { id, key, b } = dc.bm, nk = id.model(b.s);
  if (nk === key) return;
  const { x, slots } = dcCtx(), i = slots.findIndex(([, sk]) => id.skills[sk.id] === nk);
  if (i < 0) return;
  dc.slot = i; dc.s = null; dc.bm = dcbFor(x, slots[i][1]);
  history.replaceState(null, "", `#/calc/${x.id}/${i}`);
  $("#main").querySelectorAll("[data-slot]").forEach((el) => el.classList.toggle("on", +el.dataset.slot === i));
}

function dcbRefresh() {
  const bm = dc.bm, { id, key, m, b } = bm, s = b.s, { x, label, u } = dcCtx(), t = dcTarget(), K = dcbK;
  const env = { diff0: dc.lv + (u.level || 0) - t.def, R: t.R }, o = dcbOn(bm), calc = (oo, ss = s, face) => dcbCalc(m, u, ss, oo, env, face);
  if ($("#dcdlv") && dc.dlv == null) $("#dcdlv").value = t.def;
  if (id.sp) { const [k, extra] = id.sp(s); $("#dcbst").innerHTML = `${K(k)} ${extra}`; }
  $("#dcbskhead").innerHTML = `${sinIcon(u.sin, "s20")}${atkIcon(u, "s18")}${esc(label)} · ${esc(u.name)}<small>by damage</small>`;

  // number = damage lost if switched off; order from "everything on", so rows never move
  const now = calc(o), all = Object.fromEntries(m.rows.map((r) => [r.k, true])), full = calc(all).total;
  const val = (r) => o[r.k] ? now.total - calc({ ...o, [r.k]: false }).total : calc({ ...o, [r.k]: true }).total - now.total;
  const order = (r) => full - calc({ ...all, [r.k]: false }).total;
  const vals = new Map(m.rows.map((r) => [r.k, val(r)])), max = Math.max(1, ...vals.values());
  for (const [el, stack] of [["#dcbskill", "skill"], ["#dcbpass", "pass"]]) {
    const rows = m.rows.filter((r) => r.stack === stack).map((r, i) => [r, order(r), i]).sort((p, q) => q[1] - p[1] || p[2] - q[2]);
    $(el).innerHTML = rows.map(([r]) => dcbRow(r, vals.get(r.k), max, o, s)).join("") || `<div class="dcbfrom">No passive adds damage to this skill.</div>`;
  }
  $("#main").querySelectorAll(".dcbsw input[data-row]").forEach((c) => c.onchange = () => { b.on[`${key}.${c.dataset.row}`] = c.checked; dcbRefresh(); });
  $("#dcbndsum").textContent = `Doesn't add damage here (${m.nodmg.length})`;
  $("#dcbnd").innerHTML = m.nodmg.map((h) => `<li>${h}</li>`).join("");

  // one target or every target the skill can hit
  $("#dcbtgt").innerHTML = m.multi ? `<span class="lvlabel">Targets</span><span class="cqkind"><button class="${s.allT ? "" : "on"}" data-t="0">One target</button><button class="${s.allT ? "on" : ""}" data-t="1">All targets (${calc(o, { ...s, allT: 1 }).x.targets})</button></span>
    <span class="muted small">${s.allT ? "main target + the rest at −50%" : "Atk Weight turns into +20% damage each"}</span>` : "";
  $("#dcbtgt").querySelectorAll("[data-t]").forEach((el) => el.onclick = () => { s.allT = +el.dataset.t; dcbRefresh(); });

  // the dummy: statuses before the skill and after it, and what changed them
  const tg = m.target(s, o), sg = (v) => v > 0 ? `+${v}` : `−${-v}`;
  // (the server's link once units go by links)
  const img = (k) => { const g = UNITS.glossary[k], src = g && (g.iconUrl || (g.icon && imgThumb(g.icon))); return src ? `<img src="${src}" alt="" onerror="this.remove()">` : esc(statusName(k)); };
  const nm = (k) => esc((UNITS.glossary[k] || {}).name || statusName(k));
  $("#dcbbadges").innerHTML = tg.st.map(([k, b0, a]) => {
    if (typeof b0 === "number") return `<span class="dcbbadge" title="${nm(k)}">${img(k)}<b class="c">${a}</b>${a - b0 ? `<i class="dc">${sg(a - b0)}</i>` : ""}</span>`;
    const A = a || { p: 0, c: 0 }, dp = A.p - b0.p, dcn = A.c - b0.c;
    return `<span class="dcbbadge${a ? "" : " gone"}" title="${nm(k)}: Potency ${A.p}, Count ${A.c}">${img(k)}<b class="p">${A.p}</b><b class="c">${A.c}</b>
      ${dp ? `<i class="dp${dp < 0 ? " neg" : ""}">${sg(dp)}</i>` : ""}${dcn ? `<i class="dc${dcn < 0 ? " neg" : ""}">${sg(dcn)}</i>` : ""}</span>`;
  }).join("");
  const parts = (e) => [e.p ? `${sg(e.p)} Potency` : "", e.c ? `${sg(e.c)} Count` : ""].filter(Boolean).join(", ");
  $("#dcbadd").innerHTML = [...tg.log.filter((e) => e.p || e.c).map((e) => `<li><b>${e.lab}</b> ${K(e.k)} ${parts(e)}</li>`), ...tg.extra.map((h) => `<li>${h}</li>`)].join("") || `<li>Nothing changes on the target.</li>`;

  // total + coin list
  const C = now.coins, hi = calc(o, s, "heads").total, lo = calc(o, s, "tails").total, add = u.op !== "SUB";
  const chip = (k, icon) => { const v = t.R[k] ?? 1, [l, c] = RESIST(v); return `<span class="dcchip">${icon}<span class="${c}">${l}</span><small>×${v}</small></span>`; };
  $("#dcres").innerHTML = `<div class="dctotal"><small>Total damage</small><b>${now.total}</b><span class="muted small">${add ? `${u.coins} of ${u.coins} heads` : `0 of ${u.coins} heads (Minus Coins: tails is best)`}</span></div>
    <div class="dcrange"><span>All tails <b>${lo}</b></span><span>All heads <b>${hi}</b></span></div>
    <div class="dcchips">${chip(u.atk, ico(`res_${u.atk}`, "s20", u.atk, u.atk))}${chip(u.sin, sinIcon(u.sin, "s20"))}</div>
    <div class="muted small">Offense ${dc.lv} ${dcSign(u.level || 0)}${now.x.diff ? ` ${dcSign(now.x.diff)}` : ""} vs defense ${t.def} → ${dcSign(now.diff)}</div>
    <div class="dcbcoins">${C.map((c, i) => `<div class="dcbcoin"><span class="${c.heads || c.reuse ? "" : "tails"}">${coinIcon("")}</span>
      <div class="dcbroll">${c.reuse ? `Reuse ${ROMAN[c.ci]}` : `Coin ${ROMAN[c.ci]}`} · ${c.heads ? "heads" : "tails"} · roll <em>${c.r}</em>${c.d ? ` · ${dcSign(+c.d.toFixed(1))}%` : ""}${c.t > 1 ? ` · ${c.t} targets` : ""}</div>
      <span class="dcbd">${c.one}${c.flat ? `<small class="dcbsloth">incl. +${c.flat} ${c.fsin || m.flatSin}</small>` : ""}${c.sdmg ? `<small class="dcbstd">incl. +${c.sdmg} ${m.stn}</small>` : ""}</span></div>`).join("")}</div>
    ${m.stn ? `<label class="dcbstsw"><span class="dcbsw"><input type="checkbox" id="dcbstdmg" ${s.stdmg ? "checked" : ""}><i></i></span><span>Status damage <small>${K(m.stk)} going off on hits</small></span></label>` : ""}
    <div class="dcbmult"><div><span>Base Power</span><b>${u.base}${now.x.base ? ` +${now.x.base}` : ""}</b></div>
      ${add ? `<div><span>Coin Power</span><b>${u.coin}${now.x.cp ? ` +${now.x.cp}` : ""} each</b></div>` : `<div><span>Coins</span><b>−${u.coin} each, tails is best</b></div>`}
      <div><span>Damage up</span><b>${dcSign(+now.x.dyn.toFixed(1))}%</b></div><div><span>Offense − Defense</span><b>${dcSign(now.diff)} (×${now.mod.toFixed(3)})</b></div></div>`;
  if ($("#dcbstdmg")) $("#dcbstdmg").onchange = (e) => { s.stdmg = e.target.checked ? 1 : 0; dcbRefresh(); };

  // BaTyANl check: his max against ours with his settings (target at his level, no resistances, no status damage)
  const zero = Object.fromEntries(m.rows.map((r) => [r.k, false])), atBat = dcbCalc(m, u, { ...s, ...(m.auto ? id.start : m.bat.set), stdmg: 0 }, m.auto ? Object.fromEntries(m.rows.map((r) => [r.k, !r.off])) : all, { diff0: u.level || 0, R: {} }).total;
  const his = dc.ecMap && ((dc.ecMap.get(x.id) || []).find((q) => q.alt === m.bat.alt) || {}).e;
  const hv = m.auto ? (dcPresets(x, label, u, dcSlots(x)).find((p) => p.fit) || { v: {} }).v.damage ?? null : his && his[m.bat.key] ? his[m.bat.key].damage : null;
  $("#dcbbat").innerHTML = `<div><span>Game values (bare skill)</span><b>${calc(zero).total}</b></div>
    <div><span><a href="https://github.com/BaTyANl/ElderCalc" target="_blank" rel="noopener">BaTyANl calc</a> max</span><b>${dc.ecMap ? hv ?? "—" : "…"} · ours ${atBat}</b></div>
    <div class="dcbcmp${hv === atBat ? " ok" : ""}">${!dc.ecMap ? "Loading BaTyANl calc…" : hv == null ? "No BaTyANl calc preset for this skill" : hv === atBat ? "✓ same as ours with his settings" : m.auto ? "Rows read from the game texts; his fight state can differ (ours: the starting sliders, every row on)" : esc(m.bat.note)}</div>`;
  $("#dcbmods").innerHTML = `<label>Base power<input type="number" value="${u.base + now.x.base}" readonly></label>
    <label>Damage up, all coins %<input type="number" value="${+now.x.dyn.toFixed(1)}" readonly></label>
    <label>Crit adds %<input type="number" value="20" readonly></label><label>Clashes won<input type="number" value="0" readonly></label>`;
}

function dcbRow(r, v, max, o, s) {
  const on = o[r.k], why = r.need(s, o), tint = r.stack === "pass" ? " pass" : r.tint === "sloth" ? " sloth" : "";
  const lines = r.lines ? r.lines.map((l) => { const a = l.split(": ")[0]; return `<i class="muted">${esc(a)}</i> ${dcbText(l.slice(a.length + 2))}`; }).join("<br>") + "<br><br>" : "";
  return `<div class="dcbrow${!on ? " off" : v ? "" : " zero"}">
    <div class="dcbval${tint}" title="${on ? "lost if switched off" : "added if switched on"}">+${v}</div>
    <div class="dcbwhat">
      <div class="dcbttl">${r.pn ? `<span class="dcbpn">${r.pn}</span>` : ""}<b>${r.title}</b><span class="dcbfrom">${r.from}</span></div>
      <div class="dcbfx">${r.fx.map((f) => `<span>${f}</span>`).join("")}</div>
      ${why ? `<div class="dcbwhy">${why}</div>` : ""}${r.note ? `<div class="dcbfrom dcbnote">${r.note}</div>` : ""}
      <div class="dcbbar${tint}" style="width:${Math.max(2, 100 * v / max)}%"></div>
      <details class="dcbsrc"><summary>game text</summary><p>${lines}${dcbText(r.text)}</p></details>
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
