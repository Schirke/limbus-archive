// More → Upgrade calc: what levels / Upties / Extractions of several Identities and E.G.O cost and how many days of farming that is.
// Data: /api/growth (limbusdm/growth.py). #/growth[/<up|craft>[/<id>]]
const UPG_THREAD_BONUS = 3;  // Thread Luxcavation: the first runs of a day give the bonus (the server decides, not in the files)
const UPG_CRATE = 2;  // a shard crate gives 1-3: the middle
const UPG_DAYS = 3650;
const UPG_KEY = "growth2";
const UPG_SINNERS = ["Yi Sang", "Faust", "Don Quixote", "Ryōshū", "Meursault", "Hong Lu", "Heathcliff", "Ishmael", "Rodion", "Sinclair", "Outis", "Gregor"];
const upg = { db: null, tab: "up", list: [], clist: [], have: { t: [0, 0, 0, 0], th: 0, sh: {}, uni: 0 }, csh: {},
  cfg: { mgr: 0, refills: 0, exp: -1, thr: -1, missions: true, paid: false, bonus: "hard", md: 1 } };
const upgNum = (v, lo = 0, hi = Infinity) => Math.max(lo, Math.min(hi, Math.floor(+v) || 0));
const upgFmt = (n) => Math.round(n).toLocaleString("en-US");
// the game's item pictures (growth.py ICONS); a missing one = its text
function upgPic(k, alt = "", cls = "") {
  const v = upg.db.icons && upg.db.icons[k];
  return v ? `<img class="upgi ${cls}" src="/api/object?bundle=${encodeURIComponent(v.b)}&pid=${v.p}" alt="${esc(alt)}" title="${esc(alt)}" onerror="icoFail(this)">`
    : `<span class="upgi upgtk ${cls}">${esc(alt)}</span>`;
}
const upgShard = (sinner, cls = "") => upgPic(`shard_${sinner}`, `${UPG_SINNERS[sinner - 1] || ""} Egoshard`, cls);
const upgTop = (x) => x.title ? 4 : (upg.db.upEgo[x.grade] || []).length + 1;
const upgRow = (x) => ({ id: x.id, lv0: 1, lv1: upg.db.maxLv, up0: 1, up1: upgTop(x) });

function upgLoad() {
  try {
    const s = JSON.parse(localStorage.getItem(UPG_KEY) || "{}");
    if (s.tab) upg.tab = s.tab;
    if (Array.isArray(s.list)) upg.list = s.list.filter((r) => unitById(r.id));
    if (Array.isArray(s.clist)) upg.clist = s.clist.filter((id) => unitById(id));
    Object.assign(upg.have, s.have || {}); Object.assign(upg.csh, s.csh || {}); Object.assign(upg.cfg, s.cfg || {});
  } catch (e) {}
}
function upgSave() {
  const { db, ...keep } = upg;
  try { localStorage.setItem(UPG_KEY, JSON.stringify(keep)); } catch (e) {}
}

routes.growth = async (args) => {
  $("#main").innerHTML = `<div class="muted">Loading…</div>`;
  try { await units(); upg.db ||= await api("/api/growth"); } catch (e) { $("#main").innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  const d = upg.db;
  if (!UNITS.ids.length || !d.idExp) { $("#main").innerHTML = `<div class="empty">Take a snapshot first — the costs are read from it.</div>`; return; }
  if (!d.loaded) { upgLoad(); d.loaded = true; }
  const c = upg.cfg;
  c.mgr = upgNum(c.mgr || d.stamina.cap.length, 1, d.stamina.cap.length);
  if (!(c.exp >= 0 && c.exp < d.exp.length)) c.exp = d.exp.length - 1;
  if (!(c.thr >= 0 && c.thr < d.thread.length)) c.thr = d.thread.length - 1;
  if (args[0] === "up" || args[0] === "craft") upg.tab = args[0];
  const x = unitById(+args[1]);
  if (x) upgAdd(x);
  if (!upg.list.length) upg.list.push(upgRow(UNITS.ids[0]));
  upgDraw();
};
function upgAdd(x) {
  if (upg.tab === "craft") { if (!upg.clist.includes(x.id)) upg.clist.push(x.id); }
  else if (!upg.list.some((r) => r.id === x.id)) upg.list.push(upgRow(x));
}

// ---------------------------------------------------------------- what it costs
function upgCost(r) {
  const d = upg.db, x = unitById(r.id), out = { exp: 0, th: 0, sh: 0, chain: 0 };
  if (x.title) for (let l = r.lv0; l < r.lv1; l++) out.exp += d.idExp[l - 1] || 0;
  const steps = x.title ? d.upId[x.rank] || [] : d.upEgo[x.grade] || [];
  for (let u = r.up0; u < r.up1; u++) { const s = steps[u - 1] || []; out.th += s[0] || 0; out.sh += s[1] || 0; out.chain += s[2] || 0; }
  out.th += out.chain * d.chain;  // a sync chain (E.G.O level V) is paid in threads
  return out;
}
function upgNeed() {
  const d = upg.db, out = { exp: 0, th: 0, chain: 0, sh: {} };
  for (const r of upg.list) {
    const c = upgCost(r), s = unitById(r.id).sinner;
    out.exp += c.exp; out.th += c.th; out.chain += c.chain;
    if (c.sh) out.sh[s] = (out.sh[s] || 0) + c.sh;
  }
  const tix = upg.have.t.reduce((a, n, i) => a + n * (d.ticket[i] || 0), 0);
  out.expLeft = Math.max(0, out.exp - tix);
  out.thLeft = Math.max(0, out.th - upg.have.th);
  let uni = upg.have.uni || 0;
  out.shLeft = Object.entries(out.sh).reduce((a, [s, n]) => { const l = Math.max(0, n - (upg.have.sh[s] || 0)), u = Math.min(uni, l); uni -= u; return a + l - u; }, 0);
  return out;
}
function upgDay() {
  const d = upg.db, c = upg.cfg, cap = d.stamina.cap[c.mgr - 1] || 0;
  return { enk: 86400 / d.stamina.sec * d.stamina.per + c.refills * cap, cap, lun: d.stamina.buy.slice(0, c.refills).reduce((a, b) => a + b, 0) };
}
const upgExpRun = (s) => s.t.reduce((a, n, i) => a + n * (upg.db.ticket[i] || 0), 0);

// day by day: Enkephalin comes in, modules go to the bonus Thread runs, then EXP runs, then plain Thread runs
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

// shards per level past the pass's last one (its own levels are taken as done): crates of choice go to whoever is short
function upgShardsAt() {
  const p = upg.db.pass, r = (t) => t.o * UPG_CRATE + t.r * UPG_CRATE / 12;
  return r(p.ex.f) + (upg.cfg.paid ? r(p.ex.p) : 0);
}
// day by day: pass missions and Mirror Dungeon give pass points, every level past the last its crates, until `need` shards are there
function upgPass(need) {
  const d = upg.db, c = upg.cfg, day = upgDay(), mod = d.stamina.module, p = d.pass, md = d.md;
  const nb = md.normal.bonus[0] || { bp: 0, lun: 0, mod: 0 }, hb = md.hard ? md.hard.bonus[0] : nb;
  const b = c.bonus === "hard" ? hb : c.bonus === "normal" ? nb : null;
  const mis = d.exp[c.exp].cost + d.thread[c.thr].cost;  // the daily missions: one EXP and one Thread run
  const keep = b ? 3 * b.mod * mod : 0;
  let enk = 0, sh = 0, lv = 0, pts = 0, all = 0, days = 0, runs = 0, weeks = 0, mods = 0, lun = 0, waiting = false;
  const per = upgShardsAt(), gain = (n) => { pts += n; all += n; while (pts >= p.need) { pts -= p.need; lv++; sh += per; } };
  while (sh < need && per > 0 && days < UPG_DAYS) {
    if (days % 7 === 0) { waiting = !!b; if (c.missions) gain(p.weekly); }
    days++; enk += day.enk;
    if (c.missions && enk >= mis * mod) { enk -= mis * mod; mods += mis; gain(p.daily); }
    if (waiting && enk >= 3 * b.mod * mod) { enk -= 3 * b.mod * mod; mods += 3 * b.mod; gain(3 * b.bp); lun += 3 * b.lun; weeks++; waiting = false; }
    // (modules for the next weekly bonus run are kept back: it gives the most points per module)
    for (let i = 0; i < c.md && !waiting && enk - keep >= md.normal.plain.mod * mod; i++) { enk -= md.normal.plain.mod * mod; mods += md.normal.plain.mod; gain(md.normal.plain.bp); runs++; }
  }
  return { days, runs, weeks, mods, lun, lv, all, sh, never: sh < need, refill: day.lun * days };
}

// ---------------------------------------------------------------- page
const upgTile = (icon, big, label, sub = "") => `<div class="upgtile">${icon}<div><b>${big}</b><span>${label}</span>${sub ? `<small>${sub}</small>` : ""}</div></div>`;
const upgDays = (n, never) => `<span class="upgi upgdays">${never ? "∞" : n > 999 ? "999+" : upgFmt(n)}</span>`;
const upgSel = (k, i, val, lo, hi) => `<select data-r="${k}" data-i="${i}">${Array.from({ length: hi - lo + 1 }, (_, j) => lo + j).map((n) => `<option value="${n}" ${n === val ? "selected" : ""}>${ROMAN[n - 1]}</option>`).join("")}</select>`;
const upgRank = (x) => x.title ? "0".repeat(x.rank || 1) : x.grade || "";
function upgHead(x) {
  return `<img class="upgthumb" src="${imgThumb(x.img.thumb)}" alt="" onerror="this.style.visibility='hidden'">
    <div class="upgname"><b>${esc(x.title || x.name)}</b><small>${esc(x.sinnerName)} · ${esc(upgRank(x))}</small></div>`;
}

function upgUpRow(r, i) {
  const x = unitById(r.id), top = upgTop(x), d = upg.db;
  r.up1 = Math.min(Math.max(r.up1, r.up0), top); r.up0 = Math.min(r.up0, r.up1);
  const c = upgCost(r), cost = [c.exp && `${upgFmt(c.exp)} EXP`, c.th && `${upgPic("thread", "Threads", "s")}${upgFmt(c.th)}`, c.sh && `${upgShard(x.sinner, "s")}${c.sh}`].filter(Boolean).map((t) => `<span>${t}</span>`);
  return `<div class="upgunit">${upgHead(x)}
    <div class="upgctl">
      ${x.title ? `<label><span>Lv</span><input type="number" min="1" max="${d.maxLv}" data-r="lv0" data-i="${i}" value="${r.lv0}"><i>→</i><input type="number" min="1" max="${d.maxLv}" data-r="lv1" data-i="${i}" value="${r.lv1}"></label>` : ""}
      <label><span>${x.title ? "Uptie" : "Threadspin"}</span>${upgSel("up0", i, r.up0, 1, top)}<i>→</i>${upgSel("up1", i, r.up1, r.up0, top)}</label>
    </div>
    <div class="upgcost">${cost.join("") || `<span class="muted">nothing</span>`}</div>
    <button class="upgdel" data-del="${i}" title="Remove">✕</button></div>`;
}
function upgCraftRow(id, i) {
  const x = unitById(id), cr = upg.db.craft[id];
  return `<div class="upgunit">${upgHead(x)}
    <div class="upgcost">${cr ? `<span>${upgShard(x.sinner, "s")}${cr.p}</span>` : `<span class="muted">Not in the Dispenser</span>`}</div>
    <button class="upgdel" data-del="${i}" title="Remove">✕</button></div>`;
}
const upgAddBox = (ph) => `<div class="cqpick upgadd"><span class="upgplus">+</span><input class="cqin" placeholder="${ph}" autocomplete="off"><div class="cqlist"></div></div>`;
const upgHave = (inner) => `<div class="upghave"><span class="lvlabel">You have</span><div>${inner}</div></div>`;
const upgIn = (icon, attr, v) => `<label class="upgtix">${icon}<input type="number" min="0" ${attr} value="${v}"></label>`;

function upgUp() {
  const d = upg.db, n = upgNeed(), f = upgFarm(n), es = d.exp[upg.cfg.exp], ts = d.thread[upg.cfg.thr];
  const sins = Object.keys(n.sh).map(Number).sort((a, b) => a - b), anyId = upg.list.some((r) => unitById(r.id).title);
  const shTotal = sins.reduce((a, s) => a + n.sh[s], 0);
  return `<div class="upglist">${upg.list.map(upgUpRow).join("") || `<p class="muted">Add what you want to level up.</p>`}</div>
    ${upgAddBox("Add an Identity or E.G.O…")}
    ${upgHave(`${anyId ? d.ticket.map((_, i) => upgIn(upgPic(`t${i + 1}`, `Ticket ${ROMAN[i]}`, "wide"), `data-tix="${i}"`, upg.have.t[i])).join("") : ""}
      ${upgIn(upgPic("thread", "Threads"), `data-have="th"`, upg.have.th)}
      ${sins.map((s) => upgIn(upgShard(s), `data-sh="${s}"`, upg.have.sh[s] || 0)).join("")}
      ${sins.length ? upgIn(`<span class="upgi upgtk" title="Universal shards">ALL</span>`, `data-have="uni"`, upg.have.uni || 0) : ""}`)}
    <h3>Needed</h3>
    <div class="upgtiles">
      ${anyId ? upgTile(upgPic("t4", "Ticket IV", "wide"), upgFmt(n.exp), "EXP", `≈ ${upgFmt(Math.ceil(n.exp / d.ticket[3]))} Training Tickets IV`) : ""}
      ${upgTile(upgPic("thread", "Threads"), upgFmt(n.th), "Threads", n.chain ? `level V: ${n.chain} sync chains = ${upgFmt(n.chain * d.chain)} Threads or ${n.chain} Egoshards` : "")}
      ${upgTile(sins.length ? upgShard(sins[0]) : `<span class="upgi upgtk">◆</span>`, upgFmt(shTotal), "Egoshards",
        sins.length ? sins.map((s) => `${UPG_SINNERS[s - 1]} ${n.sh[s]}`).join(" · ") + " · universal ones work too" : "")}
    </div>
    <h3>Farming what is left</h3>
    ${f.days === 0 ? `<p class="muted">Nothing left to farm.</p>` : `<div class="upgtiles">
      ${n.expLeft ? upgTile(upgPic("t4", "Ticket IV", "wide"), upgFmt(f.er), "EXP Luxcavation runs", `Lv ${es.lv}: ${upgFmt(upgExpRun(es))} EXP for ${es.cost} modules`) : ""}
      ${n.thLeft ? upgTile(upgPic("thread", "Threads"), upgFmt(f.tr), "Thread Luxcavation runs", `${f.tb} with the daily bonus · Lv ${ts.lv}: ${ts.n} / ${ts.bonus} for ${ts.cost} modules`) : ""}
      ${upgTile(upgPic("module", "Modules"), upgFmt(f.mods), "Enkephalin Modules", `${upgFmt(f.enk)} Enkephalin`)}
      ${upgTile(upgDays(f.days, f.never), f.never ? "Never" : `${upgFmt(f.days)} day${f.days === 1 ? "" : "s"}`, "of Enkephalin", f.lun ? `refills: ${upgFmt(f.lun)} Lunacy` : "no Lunacy refills")}
    </div>`}
    ${n.shLeft ? `<p class="muted small">Egoshards still short: ${upgFmt(n.shLeft)}. They come from the pass: see Extract.</p>` : ""}`;
}

function upgCraft() {
  const d = upg.db, p = d.pass, need = {};
  for (const id of upg.clist) { const x = unitById(id), cr = d.craft[id]; if (cr) need[x.sinner] = (need[x.sinner] || 0) + cr.p; }
  const sins = Object.keys(need).map(Number).sort((a, b) => a - b), total = sins.reduce((a, s) => a + need[s], 0);
  const left = sins.reduce((a, s) => a + Math.max(0, need[s] - (upg.csh[s] || 0)), 0), r = upgPass(left);
  return `<div class="upglist">${upg.clist.map(upgCraftRow).join("") || `<p class="muted">Add what you want to extract.</p>`}</div>
    ${upgAddBox("Add from the Dispenser…")}
    ${sins.length ? upgHave(sins.map((s) => upgIn(upgShard(s), `data-csh="${s}"`, upg.csh[s] || 0)).join("")) : ""}
    ${total ? `<div class="upgbar"><i style="width:${(total - left) / total * 100}%"></i><span>${upgFmt(total - left)} / ${upgFmt(total)} Egoshards</span></div>` : ""}
    ${!total ? "" : !p.ex ? `<p class="empty">No pass in this snapshot.</p>` : !left ? `<p class="muted">You have every Egoshard already.</p>` : `<h3>From the pass and Mirror Dungeon</h3>
    <div class="upgtiles">
      ${upgTile(upgDays(r.days, r.never), r.never ? "Never" : `${upgFmt(r.days)} day${r.days === 1 ? "" : "s"}`, "until the Extraction", r.never ? "" : `≈ ${upgFmt(r.days / 7 * 10) / 10} weeks`)}
      ${upgTile(`<span class="upgi upgtk">MD</span>`, upgFmt(r.weeks + r.runs), "Mirror Dungeon runs", `${r.weeks} with the weekly bonus, ${r.runs} without`)}
      ${upgTile(`<span class="upgi upgtk">LV</span>`, `+${upgFmt(r.lv)}`, `pass levels past ${p.max}`, `${upgFmt(r.all)} points`)}
      ${upgTile(upgPic("module", "Modules"), upgFmt(r.mods), "Enkephalin Modules", `${upgFmt(r.mods * d.stamina.module)} Enkephalin`)}
      ${upgTile(upgPic("lunacy", "Lunacy"), upgFmt(r.lun - r.refill), "Lunacy on the way", `${upgFmt(r.lun)} from the weekly bonus${r.refill ? `, ${upgFmt(r.refill)} on refills` : ""}`)}
    </div>
    <p class="muted small">Counted past pass level ${p.max} (the levels before it taken as done): every ${p.need} points ${upgFmt(upgShardsAt() / UPG_CRATE)} crate(s) of choice with the ${upg.cfg.paid ? "Limbus Pass" : "free pass"}. Crates give 1–3 Egoshards: counted as 2. The weekly bonus is used on all 3 at once.</p>`}`;
}

function upgSide() {
  const d = upg.db, c = upg.cfg, day = upgDay(), craft = upg.tab === "craft";
  const reset = new Date(Date.UTC(2000, 0, 1, 21)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const nb = d.md.normal.bonus[0] || { bp: 0 }, hb = d.md.hard ? d.md.hard.bonus[0] : nb;
  const row = (icon, label, ctl, sub = "") => `<div class="upgset">${icon}<div><label><span>${label}</span>${ctl}</label>${sub ? `<small>${sub}</small>` : ""}</div></div>`;
  return `<div class="upgside"><h3>Your farming</h3>
    ${row(upgPic("enk", "Enkephalin"), "Manager level", `<input type="number" class="dcnum" min="1" max="${d.stamina.cap.length}" data-c="mgr" value="${c.mgr}">`,
      `+${upgFmt(86400 / d.stamina.sec * d.stamina.per)} Enkephalin a day, bar ${day.cap}`)}
    ${row(upgPic("lunacy", "Lunacy"), "Refills a day", `<select data-c="refills">${[0, ...d.stamina.buy].map((_, i) => `<option value="${i}" ${c.refills === i ? "selected" : ""}>${i || "None"}</option>`).join("")}</select>`,
      c.refills ? `${upgFmt(day.lun)} Lunacy a day for ${upgFmt(c.refills * day.cap)} Enkephalin` : "a refill fills the bar")}
    ${row(upgPic("t4", "Ticket IV", "wide"), "EXP Luxcavation", `<select data-c="exp">${d.exp.map((s, i) => `<option value="${i}" ${c.exp === i ? "selected" : ""}>Lv ${s.lv} · ${upgFmt(upgExpRun(s))}</option>`).join("")}</select>`)}
    ${row(upgPic("thread", "Threads"), "Thread Luxcavation", `<select data-c="thr">${d.thread.map((s, i) => `<option value="${i}" ${c.thr === i ? "selected" : ""}>Lv ${s.lv} · ${s.n} / ${s.bonus}</option>`).join("")}</select>`,
      `the first ${UPG_THREAD_BONUS} a day give ${d.thread[c.thr].bonus}; a day starts at ${reset} your time`)}
    ${craft && d.pass.ex ? `<h3>Pass and Mirror Dungeon</h3>
    <span class="cqkind upgpass"><button class="${c.paid ? "" : "on"}" data-paid="0">Free pass</button><button class="${c.paid ? "on" : ""}" data-paid="1">Limbus Pass</button></span>
    ${row(`<span class="upgi upgtk">MD</span>`, "Weekly bonus", `<select data-c="bonus">${[["hard", `Hard ×3 · ${3 * hb.bp}`], ["normal", `Normal ×3 · ${3 * nb.bp}`], ["none", "Not used"]].map(([k, t]) => `<option value="${k}" ${c.bonus === k ? "selected" : ""}>${t}</option>`).join("")}</select>`)}
    ${row(`<span class="upgi upgtk">MD</span>`, "Runs a day", `<input type="number" class="dcnum" min="0" max="5" data-c="md" value="${c.md}">`, `${d.md.normal.plain.bp} points for ${d.md.normal.plain.mod} modules without the bonus`)}
    <label class="upgcheck"><input type="checkbox" data-c="missions" ${c.missions ? "checked" : ""}> Pass missions: ${d.pass.daily} a day, ${d.pass.weekly} a week</label>` : ""}
  </div>`;
}

function upgDraw() {
  const craft = upg.tab === "craft";
  history.replaceState(null, "", `#/growth/${upg.tab}`);
  $("#main").innerHTML = `<div class="upgpage"><h1>Upgrade calculator</h1>
    <div class="cqctl"><span class="cqkind upgtabs"><button class="${craft ? "" : "on"}" data-tab="up">Level & Uptie</button><button class="${craft ? "on" : ""}" data-tab="craft">Extract</button></span></div>
    <div class="upggrid"><div class="upgmain">${craft ? upgCraft() : upgUp()}</div>${upgSide()}</div></div>`;
  upgSave();
  upgBind();
}

function upgBind() {
  const m = $("#main"), d = upg.db, craft = upg.tab === "craft";
  m.querySelectorAll("[data-tab]").forEach((b) => b.onclick = () => { upg.tab = b.dataset.tab; upgDraw(); });
  m.querySelectorAll("[data-del]").forEach((b) => b.onclick = () => { (craft ? upg.clist : upg.list).splice(+b.dataset.del, 1); upgDraw(); });
  // numbers: redraw when the field is left (typing isn't cut off by a redraw)
  const num = (i, set) => { i.onchange = () => { set(i.value); upgDraw(); }; i.onkeydown = (e) => { if (e.key === "Enter") i.blur(); }; };
  m.querySelectorAll("[data-r]").forEach((i) => {
    const r = upg.list[+i.dataset.i], k = i.dataset.r;
    if (i.tagName === "SELECT") i.onchange = () => { r[k] = +i.value; if (k === "up0") r.up1 = Math.max(r.up1, r.up0); upgDraw(); };
    else num(i, (v) => { r[k] = upgNum(v, 1, d.maxLv); if (k === "lv0") r.lv1 = Math.max(r.lv1, r.lv0); else r.lv0 = Math.min(r.lv0, r.lv1); });
  });
  m.querySelectorAll("[data-tix]").forEach((i) => num(i, (v) => { upg.have.t[+i.dataset.tix] = upgNum(v, 0, 99999); }));
  m.querySelectorAll("[data-have]").forEach((i) => num(i, (v) => { upg.have[i.dataset.have] = upgNum(v, 0, 999999); }));
  m.querySelectorAll("[data-sh]").forEach((i) => num(i, (v) => { upg.have.sh[i.dataset.sh] = upgNum(v, 0, 99999); }));
  m.querySelectorAll("[data-csh]").forEach((i) => num(i, (v) => { upg.csh[i.dataset.csh] = upgNum(v, 0, 99999); }));
  m.querySelectorAll("[data-c]").forEach((i) => {
    const k = i.dataset.c;
    if (i.type === "checkbox") i.onchange = () => { upg.cfg[k] = i.checked; upgDraw(); };
    else if (i.tagName === "SELECT") i.onchange = () => { upg.cfg[k] = k === "bonus" ? i.value : +i.value; upgDraw(); };
    else num(i, (v) => { upg.cfg[k] = upgNum(v, k === "md" ? 0 : 1, k === "mgr" ? d.stamina.cap.length : 5); });
  });
  m.querySelectorAll("[data-paid]").forEach((b) => b.onclick = () => { upg.cfg.paid = b.dataset.paid === "1"; upgDraw(); });
  const p = m.querySelector(".upgadd"), inp = p.querySelector("input.cqin"), list = p.querySelector(".cqlist");
  inp.oninput = () => {
    const w = sxWords(inp.value), hit = (s) => { const t = sxNorm(s); return w.every((q) => t.includes(q)); };
    const taken = new Set(craft ? upg.clist : upg.list.map((r) => r.id));
    const pool = [...UNITS.ids, ...UNITS.egos].filter((x) => !taken.has(x.id) && (!craft || d.craft[x.id]));
    const found = w.length ? pool.filter((x) => hit(`${x.title || x.name} ${x.sinnerName} ${sxEn(x.title || x.name)} ${sxEn(x.sinnerName)}`)).slice(0, 10) : [];
    list.innerHTML = found.map((x) => `<div data-id="${x.id}"><img src="${imgThumb(x.img.thumb)}" alt=""><span>${esc(x.title || x.name)} <i>${esc(x.sinnerName)} · ${esc(upgRank(x))}</i></span></div>`).join("");
    list.querySelectorAll("[data-id]").forEach((el) => el.onmousedown = (e) => { e.preventDefault(); upgAdd(unitById(+el.dataset.id)); upgDraw(); const n = $(".upgadd input"); if (n) n.focus(); });
  };
  inp.onfocus = () => sxBack().then(() => inp.oninput());
  inp.onblur = () => setTimeout(() => { list.innerHTML = ""; }, 150);
}
