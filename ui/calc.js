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
  const t = dcTarget(), pres = dcPresets(x, label, u, slots);
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
    <div class="dcgrid">
      <div class="dcleft">
        <div class="dcpresets"><button class="${dc.pre ? "" : "on"}" data-pre="">Game values</button>${pres.map((p, i) => `<button class="${dc.pre === p.key ? "on" : ""}${p.fit ? "" : " dim"}" data-pre="${i}" title="${esc(dcPresetTip(p))}">BaTyANl calc ${p.fit ? `max${p.alt ? ` · state ${p.alt}` : ""}` : esc(p.key)} · <b>${p.v.damage}</b></button>`).join("")}
          ${dc.ecMap ? pres.length ? "" : `<span class="muted small">No BaTyANl calc preset for this skill</span>` : `<span class="muted small">Loading BaTyANl calc presets…</span>`}</div>
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
  $("#dcbonus").onclick = () => { dc.s.bon.push({ kind: "Flat", target: "True", values: dc.s.coins.map(() => 0) }); dcTable(); dcBindTable(); dcUpdate(); };
  dcBindTable();
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
