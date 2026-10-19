// More → Upgrade calc: what a level / Uptie / Extraction costs and how many days of farming that is. Data: /api/growth (limbusdm/growth.py). #/growth[/<tab>/<id>]
const UPG_THREAD_BONUS = 3;  // Thread Luxcavation: the first runs of a day give the bonus (the server decides, not in the files)
const UPG_CRATE = 2;  // a shard crate gives 1-3: the middle
const UPG_DAYS = 3650;
const upg = { db: null, tab: "up", ego: false, id: 0, lv0: 1, lv1: 0, up0: 1, up1: 4, have: { t: [0, 0, 0, 0], th: 0, sh: 0 },
  cid: 0, cego: false, csh: 0,
  cfg: { mgr: 0, refills: 0, exp: -1, thr: -1, missions: true, paid: false, bonus: "hard", md: 1 } };
const upgNum = (v, lo = 0, hi = Infinity) => Math.max(lo, Math.min(hi, Math.floor(+v) || 0));
const upgFmt = (n) => Math.round(n).toLocaleString("en-US");
const upgIco = (k, t, fb) => ico(`item_${k}`, "s20", t, fb);
const upgSinner = (x) => ico(`sinner_${x.sinner}`, "s20", x.sinnerName, "◆");

function upgLoad() {
  try { const s = JSON.parse(localStorage.getItem("growth") || "{}"); for (const k of ["tab", "ego", "id", "lv0", "lv1", "up0", "up1", "cid", "cego", "csh"]) if (k in s) upg[k] = s[k]; Object.assign(upg.have, s.have || {}); Object.assign(upg.cfg, s.cfg || {}); } catch (e) {}
}
function upgSave() {
  const { db, ...keep } = upg;
  try { localStorage.setItem("growth", JSON.stringify(keep)); } catch (e) {}
}

routes.growth = async (args) => {
  $("#main").innerHTML = `<div class="muted">Loading…</div>`;
  try { await units(); upg.db ||= await api("/api/growth"); } catch (e) { $("#main").innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  const d = upg.db;
  if (!UNITS.ids.length || !d.idExp) { $("#main").innerHTML = `<div class="empty">Take a snapshot first — the costs are read from it.</div>`; return; }
  if (!upg.db.loaded) { upgLoad(); upg.db.loaded = true; }
  const c = upg.cfg;
  c.mgr = upgNum(c.mgr || d.stamina.cap.length, 1, d.stamina.cap.length);
  if (!(c.exp >= 0 && c.exp < d.exp.length)) c.exp = d.exp.length - 1;
  if (!(c.thr >= 0 && c.thr < d.thread.length)) c.thr = d.thread.length - 1;
  upg.lv1 ||= d.maxLv;
  if (args[0] === "up" || args[0] === "craft") upg.tab = args[0];
  const x = unitById(+args[1]);
  if (x) { if (upg.tab === "craft") { upg.cid = x.id; upg.cego = !x.title; } else { upg.id = x.id; upg.ego = !x.title; } }
  if (!unitById(upg.id)) { upg.ego = false; upg.id = UNITS.ids[0].id; }
  if (!unitById(upg.cid)) { const f = UNITS.ids.find((u) => d.craft[u.id]) || UNITS.ids[0]; upg.cid = f.id; upg.cego = false; }
  upgDraw();
};

// ---------------------------------------------------------------- what it costs
function upgUnit() { return unitById(upg.tab === "craft" ? upg.cid : upg.id); }
function upgNeed() {
  const d = upg.db, x = unitById(upg.id), ego = !x.title, out = { exp: 0, th: 0, sh: 0, chain: 0 };
  if (!ego) for (let l = upg.lv0; l < upg.lv1; l++) out.exp += d.idExp[l - 1] || 0;
  const steps = ego ? d.upEgo[x.grade] || [] : d.upId[x.rank] || [];
  for (let u = upg.up0; u < upg.up1; u++) { const s = steps[u - 1] || []; out.th += s[0] || 0; out.sh += s[1] || 0; out.chain += s[2] || 0; }
  // a sync chain (E.G.O level V) is paid in threads: one chain = d.chain threads
  out.thChain = out.chain * d.chain;
  const tix = upg.have.t.reduce((a, n, i) => a + n * (d.ticket[i] || 0), 0);
  out.expLeft = Math.max(0, out.exp - tix);
  out.thLeft = Math.max(0, out.th + out.thChain - upg.have.th);
  out.shLeft = Math.max(0, out.sh - upg.have.sh);
  return out;
}
function upgDay() {
  const d = upg.db, c = upg.cfg, cap = d.stamina.cap[c.mgr - 1] || 0;
  return { enk: 86400 / d.stamina.sec * d.stamina.per + c.refills * cap, cap, lun: d.stamina.buy.slice(0, c.refills).reduce((a, b) => a + b, 0) };
}
const upgExpRun = (s) => s.t.reduce((a, n, i) => a + n * (upg.db.ticket[i] || 0), 0);

// day by day: Enkephalin comes in, modules go to thread runs (the bonus ones first), then to EXP runs
function upgFarm(n) {
  const d = upg.db, day = upgDay(), es = d.exp[upg.cfg.exp], ts = d.thread[upg.cfg.thr], per = upgExpRun(es);
  let enk = 0, exp = n.expLeft, th = n.thLeft, days = 0, er = 0, tr = 0, tb = 0, mods = 0;
  const run = (cost) => { if (enk < cost * d.stamina.module) return false; enk -= cost * d.stamina.module; mods += cost; return true; };
  while ((exp > 0 || th > 0) && days < UPG_DAYS) {
    days++; enk += day.enk;
    for (let b = UPG_THREAD_BONUS; th > 0 && b > 0 && run(ts.cost); b--) { th -= ts.bonus; tr++; tb++; }
    while (exp > 0 && run(es.cost)) { exp -= per; er++; }
    while (th > 0 && run(ts.cost)) { th -= ts.n; tr++; }
  }
  return { days, er, tr, tb, mods, enk: mods * d.stamina.module, lun: day.lun * days, never: days >= UPG_DAYS };
}

// shards of one Sinner per level past the pass's last one (its own levels are taken as done): choice crates all to that Sinner, random ones 1 in 12
function upgShardsAt() {
  const p = upg.db.pass, r = (t) => t.o * UPG_CRATE + t.r * UPG_CRATE / 12;
  return r(p.ex.f) + (upg.cfg.paid ? r(p.ex.p) : 0);
}
// day by day: pass missions and Mirror Dungeon give pass points, every level past the last its crates, until the shards are there
function upgPass(price) {
  const d = upg.db, c = upg.cfg, day = upgDay(), mod = d.stamina.module, p = d.pass, md = d.md;
  const nb = md.normal.bonus[0] || { bp: 0, lun: 0, mod: 0 }, hb = md.hard ? md.hard.bonus[0] : nb;
  const b = c.bonus === "hard" ? hb : c.bonus === "normal" ? nb : null;
  const mis = d.exp[c.exp].cost + d.thread[c.thr].cost;  // the daily missions: one EXP and one Thread run
  const keep = b ? 3 * b.mod * mod : 0;
  let enk = 0, sh = upg.csh, lv = 0, pts = 0, all = 0, days = 0, runs = 0, weeks = 0, mods = 0, lun = 0, waiting = false;
  const per = upgShardsAt(), gain = (n) => { pts += n; all += n; while (pts >= p.need) { pts -= p.need; lv++; sh += per; } };
  while (sh < price && per > 0 && days < UPG_DAYS) {
    if (days % 7 === 0) { waiting = !!b; if (c.missions) gain(p.weekly); }
    days++; enk += day.enk;
    if (c.missions && enk >= mis * mod) { enk -= mis * mod; mods += mis; gain(p.daily); }
    if (waiting && enk >= 3 * b.mod * mod) { enk -= 3 * b.mod * mod; mods += 3 * b.mod; gain(3 * b.bp); lun += 3 * b.lun; weeks++; waiting = false; }
    // (modules for the next weekly bonus run are kept back: it gives the most points per module)
    for (let i = 0; i < c.md && !waiting && enk - keep >= md.normal.plain.mod * mod; i++) { enk -= md.normal.plain.mod * mod; mods += md.normal.plain.mod; gain(md.normal.plain.bp); runs++; }
  }
  return { days, runs, weeks, mods, lun, lv, all, sh, never: sh < price, refill: day.lun * days };
}

// ---------------------------------------------------------------- page
function upgPicker(x) {
  return `<div class="cqpick upgpick"><img src="${imgThumb(x.img.thumb)}" alt="" onerror="this.style.visibility='hidden'">
    <div class="grow"><div class="cqname">${esc(x.title || x.name)}</div><div class="muted small">${esc(x.sinnerName)}${x.title ? ` · ${"0".repeat(x.rank || 1)}` : x.grade ? ` · ${esc(x.grade)}` : ""}</div></div>
    <input class="cqin" placeholder="Change…" autocomplete="off"><div class="cqlist"></div></div>`;
}
const upgUpBtns = (key, max, lo = 1) => `<span class="upgups">${Array.from({ length: max }, (_, i) => i + 1).map((n) => `<button class="upbtn ${upg[key] === n ? "on" : ""}" data-${key}="${n}" ${n < lo ? "disabled" : ""}>${ico(`up_${n}`, "s22", "", ROMAN[n - 1])}</button>`).join("")}</span>`;
const upgTile = (icon, big, label, sub = "") => `<div class="upgtile">${icon}<div><b>${big}</b><span>${label}</span>${sub ? `<small>${sub}</small>` : ""}</div></div>`;

function upgUp() {
  const d = upg.db, x = unitById(upg.id), ego = !x.title, top = ego ? (d.upEgo[x.grade] || []).length + 1 : 4;
  upg.up1 = Math.min(Math.max(upg.up1, upg.up0), top); upg.up0 = Math.min(upg.up0, upg.up1);
  upg.lv1 = Math.max(upgNum(upg.lv1, 1, d.maxLv), upg.lv0);
  const n = upgNeed(), f = upgFarm(n), es = d.exp[upg.cfg.exp], ts = d.thread[upg.cfg.thr];
  const tickets = d.ticket.map((v, i) => `<label class="upgtix"><span class="upgtk">${ROMAN[i]}</span><input type="number" min="0" data-tix="${i}" value="${upg.have.t[i]}"></label>`).join("");
  return `${upgPicker(x)}
    <div class="upgform">
      ${ego ? "" : `<div class="upgrow"><span class="lvlabel">Level</span><input type="number" class="dcnum" min="1" max="${d.maxLv}" data-k="lv0" value="${upg.lv0}"> → <input type="number" class="dcnum" min="1" max="${d.maxLv}" data-k="lv1" value="${upg.lv1}"></div>`}
      <div class="upgrow"><span class="lvlabel">${ego ? "Threadspin" : "Uptie"} now</span>${upgUpBtns("up0", top)}</div>
      <div class="upgrow"><span class="lvlabel">Goal</span>${upgUpBtns("up1", top, upg.up0)}</div>
      <div class="upgrow"><span class="lvlabel">You have</span>${ego ? "" : `${tickets}`}<label class="upgtix">${upgIco("thread", "Threads", "Threads")}<input type="number" min="0" data-have="th" value="${upg.have.th}"></label><label class="upgtix">${upgSinner(x)}<input type="number" min="0" data-have="sh" value="${upg.have.sh}"></label></div>
    </div>
    <h3>Needed</h3>
    <div class="upgtiles">
      ${ego ? "" : upgTile(`<span class="upgtk big">IV</span>`, upgFmt(n.exp), "EXP", `≈ ${upgFmt(Math.ceil(n.exp / d.ticket[3]))} Training Tickets IV`)}
      ${upgTile(upgIco("thread", "Threads", "🧵"), upgFmt(n.th + n.thChain), "Threads", n.chain ? `level V: ${n.chain} sync chains = ${upgFmt(n.thChain)} Threads or ${n.chain} Egoshards` : "")}
      ${upgTile(upgSinner(x), upgFmt(n.sh), `${esc(x.sinnerName)} Egoshards`, n.sh ? "universal shards work too" : "")}
    </div>
    <h3>Farming what is left</h3>
    ${f.days === 0 ? `<p class="muted">Nothing left to farm.</p>` : `<div class="upgtiles">
      ${ego ? "" : upgTile(`<span class="upgtk big">EXP</span>`, upgFmt(f.er), "EXP Luxcavation runs", `Lv ${es.lv}: ${upgFmt(upgExpRun(es))} EXP for ${es.cost} modules`)}
      ${upgTile(upgIco("thread", "Threads", "🧵"), upgFmt(f.tr), "Thread Luxcavation runs", `${f.tb} with the daily bonus · Lv ${ts.lv}: ${ts.n} / ${ts.bonus} Threads for ${ts.cost} modules`)}
      ${upgTile(upgIco("module", "Enkephalin Modules", "▣"), upgFmt(f.mods), "Enkephalin Modules", `${upgFmt(f.enk)} Enkephalin`)}
      ${upgTile(`<span class="upgdays">${f.never ? "∞" : upgFmt(f.days)}</span>`, f.never ? "Never" : `${upgFmt(f.days)} day${f.days === 1 ? "" : "s"}`, "of Enkephalin", f.lun ? `refills: ${upgFmt(f.lun)} Lunacy` : "no Lunacy refills")}
    </div>`}`;
}

function upgCraft() {
  const d = upg.db, x = unitById(upg.cid), cr = d.craft[x.id], p = d.pass;
  const head = `${upgPicker(x)}<div class="upgform"><div class="upgrow"><span class="lvlabel">${esc(x.sinnerName)} Egoshards you have</span><input type="number" class="dcnum" min="0" data-k="csh" value="${upg.csh}"></div></div>`;
  if (!cr) return `${head}<p class="empty">Not in the Dispenser: it can't be extracted with Egoshards.</p>`;
  const r = upgPass(cr.p), have = Math.min(upg.csh, cr.p);
  return `${head}
    <div class="upgbar"><i style="width:${have / cr.p * 100}%"></i><span>${upgFmt(have)} / ${cr.p} Egoshards</span></div>
    ${!p.ex ? `<p class="empty">No pass in this snapshot.</p>` : `<h3>From the pass and Mirror Dungeon</h3>
    <div class="upgtiles">
      ${upgTile(`<span class="upgdays">${r.never ? "∞" : upgFmt(r.days)}</span>`, r.never ? "Never" : `${upgFmt(r.days)} day${r.days === 1 ? "" : "s"}`, "until the Extraction", r.never ? "" : `≈ ${upgFmt(r.days / 7 * 10) / 10} weeks`)}
      ${upgTile(`<span class="upgtk big">MD</span>`, upgFmt(r.weeks + r.runs), "Mirror Dungeon runs", `${r.weeks} with the weekly bonus, ${r.runs} without`)}
      ${upgTile(`<span class="upgtk big">LV</span>`, `+${upgFmt(r.lv)}`, `pass levels past ${p.max}`, `${upgFmt(r.all)} points`)}
      ${upgTile(upgIco("module", "Enkephalin Modules", "▣"), upgFmt(r.mods), "Enkephalin Modules", `${upgFmt(r.mods * d.stamina.module)} Enkephalin`)}
      ${upgTile(GM_LUNIMG, upgFmt(r.lun - r.refill), "Lunacy on the way", `${upgFmt(r.lun)} from the weekly bonus${r.refill ? `, ${upgFmt(r.refill)} on refills` : ""}`)}
    </div>
    <p class="muted small">Counted past pass level ${p.max} (the levels before it taken as done): every ${p.need} points ${upgFmt(upgShardsAt() / UPG_CRATE)} crate(s) of choice with the ${upg.cfg.paid ? "Limbus Pass" : "free pass"}. Crates give 1–3 Egoshards: counted as 2. The weekly bonus is used on all 3 at once.</p>`}`;
}

function upgSide() {
  const d = upg.db, c = upg.cfg, day = upgDay(), craft = upg.tab === "craft";
  const reset = new Date(Date.UTC(2000, 0, 1, 21)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const nb = d.md.normal.bonus[0] || { bp: 0 }, hb = d.md.hard ? d.md.hard.bonus[0] : nb;
  return `<div class="upgside"><h3>Your farming</h3>
    <label>Manager level<input type="number" class="dcnum" min="1" max="${d.stamina.cap.length}" data-c="mgr" value="${c.mgr}"></label>
    <p class="muted small">+${upgFmt(86400 / d.stamina.sec * d.stamina.per)} Enkephalin a day, bar ${day.cap}</p>
    <label>Lunacy refills a day<select data-c="refills">${[0, ...d.stamina.buy].map((_, i) => `<option value="${i}" ${c.refills === i ? "selected" : ""}>${i || "None"}</option>`).join("")}</select></label>
    ${c.refills ? `<p class="muted small">${upgFmt(day.lun)} Lunacy a day for ${upgFmt(c.refills * day.cap)} Enkephalin</p>` : ""}
    <label>EXP Luxcavation<select data-c="exp">${d.exp.map((s, i) => `<option value="${i}" ${c.exp === i ? "selected" : ""}>Lv ${s.lv} · ${upgFmt(upgExpRun(s))} EXP</option>`).join("")}</select></label>
    <label>Thread Luxcavation<select data-c="thr">${d.thread.map((s, i) => `<option value="${i}" ${c.thr === i ? "selected" : ""}>Lv ${s.lv} · ${s.n} / ${s.bonus} Threads</option>`).join("")}</select></label>
    <p class="muted small">The first ${UPG_THREAD_BONUS} Thread runs a day give the bonus. A day starts at ${reset} your time.</p>
    ${craft && d.pass.ex ? `<h3>Pass and Mirror Dungeon</h3>
    <span class="cqkind"><button class="${c.paid ? "" : "on"}" data-paid="0">Free pass</button><button class="${c.paid ? "on" : ""}" data-paid="1">Limbus Pass</button></span>
    <label>Weekly bonus<select data-c="bonus">${[["hard", `Hard ×3 · ${3 * hb.bp}`], ["normal", `Normal ×3 · ${3 * nb.bp}`], ["none", "Not used"]].map(([k, t]) => `<option value="${k}" ${c.bonus === k ? "selected" : ""}>${t}</option>`).join("")}</select></label>
    <label>Mirror Dungeon runs a day<input type="number" class="dcnum" min="0" max="5" data-c="md" value="${c.md}"></label>
    <p class="muted small">${d.md.normal.plain.bp} points for ${d.md.normal.plain.mod} modules without the bonus</p>
    <label class="upgcheck"><input type="checkbox" data-c="missions" ${c.missions ? "checked" : ""}> Pass missions: ${d.pass.daily} a day, ${d.pass.weekly} a week</label>` : ""}
  </div>`;
}

function upgDraw() {
  const x = upgUnit(), ego = upg.tab === "craft" ? upg.cego : upg.ego;
  history.replaceState(null, "", `#/growth/${upg.tab}/${x.id}`);
  $("#main").innerHTML = `<div class="upgpage"><h1>Upgrade calculator</h1>
    <div class="cqctl"><span class="cqkind"><button class="${upg.tab === "up" ? "on" : ""}" data-tab="up">Level & Uptie</button><button class="${upg.tab === "craft" ? "on" : ""}" data-tab="craft">Extract</button></span>
      <span class="cqkind"><button class="${ego ? "" : "on"}" data-ego="0">Identities</button><button class="${ego ? "on" : ""}" data-ego="1">E.G.O</button></span></div>
    <div class="upggrid"><div class="upgmain">${upg.tab === "craft" ? upgCraft() : upgUp()}</div>${upgSide()}</div></div>`;
  upgSave();
  upgBind();
}

function upgBind() {
  const m = $("#main"), d = upg.db, craft = upg.tab === "craft";
  m.querySelectorAll("[data-tab]").forEach((b) => b.onclick = () => { upg.tab = b.dataset.tab; upgDraw(); });
  m.querySelectorAll("[data-ego]").forEach((b) => b.onclick = () => {
    const ego = b.dataset.ego === "1", list = ego ? UNITS.egos : UNITS.ids, cur = upgUnit();
    if (ego === !cur.title) return;
    const pick = list.find((u) => u.sinner === cur.sinner && (!craft || d.craft[u.id])) || list[0];
    if (craft) { upg.cid = pick.id; upg.cego = ego; } else { upg.id = pick.id; upg.ego = ego; upg.up0 = 1; upg.up1 = ego ? (d.upEgo[pick.grade] || []).length + 1 : 4; }
    upgDraw();
  });
  for (const k of ["up0", "up1"]) m.querySelectorAll(`[data-${k}]`).forEach((b) => b.onclick = () => { upg[k] = +b.dataset[k]; if (k === "up0") upg.up1 = Math.max(upg.up1, upg.up0); upgDraw(); });
  // numbers: redraw when the field is left (typing isn't cut off by a redraw)
  const num = (i, set) => { i.onchange = () => { set(i.value); upgDraw(); }; i.onkeydown = (e) => { if (e.key === "Enter") i.blur(); }; };
  m.querySelectorAll("[data-k]").forEach((i) => num(i, (v) => { upg[i.dataset.k] = upgNum(v, i.dataset.k === "csh" ? 0 : 1, i.dataset.k === "csh" ? 99999 : d.maxLv); if (i.dataset.k === "lv0") upg.lv1 = Math.max(upg.lv1, upg.lv0); }));
  m.querySelectorAll("[data-tix]").forEach((i) => num(i, (v) => { upg.have.t[+i.dataset.tix] = upgNum(v, 0, 99999); }));
  m.querySelectorAll("[data-have]").forEach((i) => num(i, (v) => { upg.have[i.dataset.have] = upgNum(v, 0, 999999); }));
  m.querySelectorAll("[data-c]").forEach((i) => {
    const k = i.dataset.c;
    if (i.type === "checkbox") i.onchange = () => { upg.cfg[k] = i.checked; upgDraw(); };
    else if (i.tagName === "SELECT") i.onchange = () => { upg.cfg[k] = k === "bonus" ? i.value : +i.value; upgDraw(); };
    else num(i, (v) => { upg.cfg[k] = upgNum(v, k === "md" ? 0 : 1, k === "mgr" ? d.stamina.cap.length : 5); });
  });
  m.querySelectorAll("[data-paid]").forEach((b) => b.onclick = () => { upg.cfg.paid = b.dataset.paid === "1"; upgDraw(); });
  const p = m.querySelector(".upgpick"), inp = p.querySelector("input.cqin"), list = p.querySelector(".cqlist");
  inp.oninput = () => {
    const w = sxWords(inp.value), hit = (s) => { const t = sxNorm(s); return w.every((q) => t.includes(q)); };
    const ego = craft ? upg.cego : upg.ego, pool = (ego ? UNITS.egos : UNITS.ids).filter((x) => !craft || d.craft[x.id]);
    const found = w.length ? pool.filter((x) => hit(`${x.title || x.name} ${x.sinnerName} ${sxEn(x.title || x.name)} ${sxEn(x.sinnerName)}`)).slice(0, 8) : [];
    list.innerHTML = found.map((x) => `<div data-id="${x.id}"><img src="${imgThumb(x.img.thumb)}" alt=""><span>${esc(x.title || x.name)} <i>${esc(x.sinnerName)}</i></span></div>`).join("");
    list.querySelectorAll("[data-id]").forEach((el) => el.onmousedown = () => {
      const x = unitById(+el.dataset.id);
      if (craft) upg.cid = x.id;
      else { if (x.sinner !== unitById(upg.id).sinner) upg.have.sh = 0; upg.id = x.id; upg.up1 = !x.title ? (d.upEgo[x.grade] || []).length + 1 : 4; upg.up0 = Math.min(upg.up0, upg.up1); }
      upgDraw();
    });
  };
  inp.onfocus = () => sxBack().then(() => inp.oninput());
  inp.onblur = () => setTimeout(() => { list.innerHTML = ""; }, 150);
}
