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
  const t = dcTarget(), pres = dcPresets(x, label, u, slots), bm0 = dcbFor(x, slots[dc.slot][1]), bm = dc.bm = bm0 && !bm0.low ? bm0 : null;
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
          ${bm0 ? `<span class="muted small">Damage breakdown: Uptie IV only for now</span>` : ""}</div>
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

// the model of this skill (and its Identity's fight state), or null
function dcbFor(x, sk) {
  const d = dcbData(), id = d.ids[x.id], key = id && sk && id.skills[sk.id];
  if (!key) return null;
  dc.bd ||= {};
  const b = dc.bd[x.id] ||= { s: { ...id.start }, on: {} }, m = d.models[key];
  if (id.model(b.s) !== key) Object.assign(b.s, m.bat.set);  // other state's skill
  return { id, key, m, b, low: dc.up < (x.maxUp || 4) };
}
const dcbOn = (bm) => Object.fromEntries(bm.m.rows.map((r) => [r.k, bm.b.on[`${bm.key}.${r.k}`] !== false]));

// the formula of dcCalc on the model's numbers. face: "best" (heads on Plus Coins, tails on Minus Coins), "heads" or "tails"
function dcbCalc(m, u, s, o, env, face = "best") {
  const x = { base: 0, cp: 0, last: 0, dyn: 0, diff: 0, flatLast: 0, lastDyn: 0, reuse: false, targets: 1, subDyn: 0, ...m.mods(s, o) };
  const res = (k) => env.R[k] ?? 1, sd = s.stdmg && m.stn ? m.target(s, o).dmg : [];
  const add = u.op !== "SUB", heads = face === "best" ? add : face === "heads";
  const n = u.coins + (x.reuse ? 1 : 0), diff = env.diff0 + x.diff;
  const mod = 1 + diff / (Math.abs(diff) + 25) + dcRmod(res(u.atk)) + dcRmod(res(u.sin));
  let roll = u.base + x.base, total = 0;
  const coins = [];
  for (let i = 0; i < n; i++) {
    if (heads && i < u.coins) roll += add ? u.coin + x.cp : -u.coin;
    const fin = i === n - 1, r = roll + (fin ? x.last : 0), d = x.dyn + (fin ? x.lastDyn : 0);
    const hit = (dd) => dcFloor(r <= 0 ? 1 : r * (1 + dd / 100) * mod);
    // flat adders and status damage through their sin's resistance
    const flat = fin && x.flatLast ? dcFloor(x.flatLast * res(m.flatSin)) : 0, sdmg = sd[i] ? dcFloor(sd[i] * (m.stn === "Gloom" ? res("Gloom") : 1)) : 0;
    const one = hit(d) + flat + (x.targets - 1) * hit(d + x.subDyn) + sdmg;
    coins.push({ r, one, d, heads, flat, sdmg, reuse: i >= u.coins, t: x.targets });
    total += one;
  }
  return { total, coins, x, diff, mod };
}

function dcbHtml(label, t) {
  const fig = t.e ? enTileImg(t.e) || `<span class="dcnopic"></span>` : `<svg viewBox="0 0 120 150" width="76" height="95" aria-hidden="true">
    <rect x="34" y="138" width="52" height="8" fill="#3a2a20"/><rect x="57" y="96" width="6" height="44" fill="#5a4030"/>
    <rect x="36" y="44" width="48" height="58" rx="10" fill="#6b4a2c"/><circle cx="60" cy="26" r="16" fill="#7a5634"/><rect x="20" y="52" width="80" height="8" rx="4" fill="#5a4030"/>
    <circle cx="60" cy="72" r="16" fill="#e9c9a0"/><circle cx="60" cy="72" r="11" fill="#b3160f"/><circle cx="60" cy="72" r="6" fill="#e9c9a0"/><circle cx="60" cy="72" r="2.5" fill="#b3160f"/></svg>`;
  return `<div class="dcgrid dcbgrid">
    <div class="dcleft">
      <div class="dcb">
        <div class="dcbhead"><h2>Where the damage comes from</h2><button class="toggle" id="dcballon">All on</button><button class="toggle" id="dcballoff">All off</button></div>
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
      <div class="dcbroll">${c.reuse ? "Reuse" : `Coin ${ROMAN[i]}`} · ${c.heads ? "heads" : "tails"} · roll <em>${c.r}</em>${c.d ? ` · ${dcSign(+c.d.toFixed(1))}%` : ""}${c.t > 1 ? ` · ${c.t} targets` : ""}</div>
      <span class="dcbd">${c.one}${c.flat ? `<small class="dcbsloth">incl. +${c.flat} ${m.flatSin}</small>` : ""}${c.sdmg ? `<small class="dcbstd">incl. +${c.sdmg} ${m.stn}</small>` : ""}</span></div>`).join("")}</div>
    ${m.stn ? `<label class="dcbstsw"><span class="dcbsw"><input type="checkbox" id="dcbstdmg" ${s.stdmg ? "checked" : ""}><i></i></span><span>Status damage <small>${K(m.stk)} going off on hits</small></span></label>` : ""}
    <div class="dcbmult"><div><span>Base Power</span><b>${u.base}${now.x.base ? ` +${now.x.base}` : ""}</b></div>
      ${add ? `<div><span>Coin Power</span><b>${u.coin}${now.x.cp ? ` +${now.x.cp}` : ""} each</b></div>` : `<div><span>Coins</span><b>−${u.coin} each, tails is best</b></div>`}
      <div><span>Damage up</span><b>${dcSign(+now.x.dyn.toFixed(1))}%</b></div><div><span>Offense − Defense</span><b>${dcSign(now.diff)} (×${now.mod.toFixed(3)})</b></div></div>`;
  if ($("#dcbstdmg")) $("#dcbstdmg").onchange = (e) => { s.stdmg = e.target.checked ? 1 : 0; dcbRefresh(); };

  // BaTyANl check: his max against ours with his settings (target at his level, no resistances, no status damage)
  const zero = Object.fromEntries(m.rows.map((r) => [r.k, false])), atBat = dcbCalc(m, u, { ...s, ...m.bat.set, stdmg: 0 }, all, { diff0: u.level || 0, R: {} }).total;
  const his = dc.ecMap && ((dc.ecMap.get(x.id) || []).find((q) => q.alt === m.bat.alt) || {}).e, hv = his && his[m.bat.key] ? his[m.bat.key].damage : null;
  $("#dcbbat").innerHTML = `<div><span>Game values (bare skill)</span><b>${calc(zero).total}</b></div>
    <div><span><a href="https://github.com/BaTyANl/ElderCalc" target="_blank" rel="noopener">BaTyANl calc</a> max</span><b>${dc.ecMap ? hv ?? "—" : "…"} · ours ${atBat}</b></div>
    <div class="dcbcmp${hv === atBat ? " ok" : ""}">${!dc.ecMap ? "Loading BaTyANl calc…" : hv == null ? "No BaTyANl calc preset for this skill" : hv === atBat ? "✓ same as ours with his settings" : esc(m.bat.note)}</div>`;
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
      ${why ? `<div class="dcbwhy">${why}</div>` : ""}
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
