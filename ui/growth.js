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
// an E.G.O's own last Threadspin (level V only where the game has it)
const upgTop = (x) => x.title ? 4 : Math.min(x.maxUp || 4, (upg.db.upEgo[x.grade] || []).length + 1);
// the player's Collection (its page keeps it in this browser: {ids: {id: {u, l}}, egos: {id: {u}}})
function upgMine() {
  try { const c = typeof collectionMine === "function" ? collectionMine() : JSON.parse(localStorage.getItem("collection") || "null"); if (c && c.ids && c.egos) return c; } catch (e) {}
  return { ids: {}, egos: {} };
}
const upgOwn = (x, c = upgMine()) => (x.title ? c.ids : c.egos)[x.id];
// a row starts where the Collection has it; a level it doesn't know = not counted
function upgFromMine(r, own) {
  const x = unitById(r.id), d = upg.db;
  if (!own) return r;
  r.up0 = Math.min(Math.max(own.u || 1, 1), upgTop(x)); r.up1 = Math.max(r.up1, r.up0);
  if (x.title) { r.lv0 = Math.min(own.l || d.maxLv, d.maxLv); r.lv1 = Math.max(r.lv1, r.lv0); }
  return r;
}
const upgRow = (x) => upgFromMine({ id: x.id, lv0: 1, lv1: upg.db.maxLv, up0: 1, up1: upgTop(x) }, upgOwn(x));
const upgMaxed = (x, own) => (own.u || 1) >= upgTop(x) && (!x.title || !own.l || own.l >= upg.db.maxLv);
function upgColBar(craft) {
  const c = upgMine(), ni = Object.keys(c.ids).length, ne = Object.keys(c.egos).length;
  if (!ni && !ne) return "";
  const units = [...UNITS.ids, ...UNITS.egos];
  if (craft) {
    const miss = units.filter((x) => upg.db.craft[x.id] && !upgOwn(x, c) && !upg.clist.includes(x.id)).length;
    return `<div class="upgcol"><span>Collection: ${ni} Identities, ${ne} E.G.O</span>${miss ? `<button data-col="missing">Add all ${miss} I don't have</button>` : ""}</div>`;
  }
  const open = units.filter((x) => { const o = upgOwn(x, c); return o && !upgMaxed(x, o) && !upg.list.some((r) => r.id === x.id); }).length;
  return `<div class="upgcol"><span>Collection: ${ni} Identities, ${ne} E.G.O</span><button data-col="take">Take Uptie and levels from it</button>
    ${open ? `<button data-col="open">Add all ${open} not at max</button>` : ""}</div>`;
}

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

// shards per level past the pass's last one (its own levels are taken as done): crates of choice go to whoever is short
function upgShardsAt() {
  const p = upg.db.pass, r = (t) => t.o * UPG_CRATE + t.r * UPG_CRATE / 12;
  return p.ex ? r(p.ex.f) + (upg.cfg.paid ? r(p.ex.p) : 0) : 0;
}
// day by day until the EXP, Threads and Egoshards are there. Enkephalin goes, in this order, to the pass missions (one EXP and
// one Thread run: their loot counts) and the weekly bonus run (both every day / week of it), the plain Mirror Dungeon runs (only
// while Egoshards are short: pass points → crates), then Luxcavation
function upgSim(need) {
  const d = upg.db, c = upg.cfg, day = upgDay(), mod = d.stamina.module, p = d.pass, md = d.md;
  const es = d.exp[c.exp], ts = d.thread[c.thr], per = upgExpRun(es), crate = upgShardsAt();
  const nb = md.normal.bonus[0] || { bp: 0, lun: 0, mod: 0 }, hb = md.hard ? md.hard.bonus[0] : nb;
  const b = c.bonus === "hard" ? hb : c.bonus === "normal" ? nb : null;
  let enk = 0, exp = need.exp, th = need.th, sh = crate > 0 ? need.sh : 0, days = 0, er = 0, tr = 0, tb = 0, runs = 0, weeks = 0, mods = 0, lun = 0;
  let mer = 0, mtr = 0;  // mission runs once that EXP / those Threads were already there: only for the pass points
  let lv = 0, pts = 0, all = 0, waiting = false, bonus = 0;
  const spend = (n) => { if (enk < n * mod) return false; enk -= n * mod; mods += n; return true; };
  const gain = (n) => { pts += n; all += n; while (pts >= p.need) { pts -= p.need; lv++; sh -= crate; } };
  const thRun = () => { th -= bonus > 0 ? ts.bonus : ts.n; if (bonus-- > 0) tb++; tr++; };
  while ((exp > 0 || th > 0 || sh > 0) && days < UPG_DAYS) {
    if (days % 7 === 0) { waiting = !!b; if (c.missions) gain(p.weekly); }
    days++; enk += day.enk; bonus = UPG_THREAD_BONUS;
    if (c.missions && enk >= (es.cost + ts.cost) * mod) {
      spend(es.cost); spend(ts.cost); gain(p.daily);
      if (exp > 0) { exp -= per; er++; } else mer++;
      if (th > 0) thRun(); else { mtr++; bonus--; }
    }
    if (waiting && spend(3 * b.mod)) { gain(3 * b.bp); lun += 3 * b.lun; weeks++; waiting = false; }
    // (modules for the next weekly bonus run are kept back: it gives the most points per module)
    const keep = b ? 3 * b.mod * mod : 0;
    for (let i = 0; i < c.md && sh > 0 && !waiting && enk - keep >= md.normal.plain.mod * mod; i++) { spend(md.normal.plain.mod); gain(md.normal.plain.bp); runs++; }
    while (th > 0 && bonus > 0 && spend(ts.cost)) thRun();
    while (exp > 0 && spend(es.cost)) { exp -= per; er++; }
    while (th > 0 && spend(ts.cost)) thRun();
  }
  return { days, er, tr, tb, mer, mtr, runs, weeks, mods, lun, lv, all, refill: day.lun * days, never: days >= UPG_DAYS, noPass: need.sh > 0 && !crate };
}
// the farming tiles of a result
function upgFarmTiles(r, need, label) {
  const d = upg.db, es = d.exp[upg.cfg.exp], ts = d.thread[upg.cfg.thr];
  return `<div class="upgtiles">
    ${upgTile(upgDays(r.days, r.never), r.never ? "Never" : `${upgFmt(r.days)} day${r.days === 1 ? "" : "s"}`, label,
      r.never ? "" : r.days >= 14 ? `≈ ${upgFmt(r.days / 7 * 10) / 10} weeks` : "")}
    ${need.exp ? upgTile(upgPic("t4", "Ticket IV", "wide"), upgFmt(r.er), "EXP Luxcavation runs", `Lv ${es.lv}: ${upgFmt(upgExpRun(es))} EXP for ${es.cost} modules`) : ""}
    ${r.mer || r.mtr ? upgTile(`<span class="upgi upgtk">+</span>`, upgFmt(r.mer + r.mtr), "runs only for the pass missions", `${r.mer} EXP and ${r.mtr} Thread Luxcavation, once the EXP / Threads were there`) : ""}
    ${need.th ? upgTile(upgPic("thread", "Threads"), upgFmt(r.tr), "Thread Luxcavation runs", `${r.tb} with the daily bonus · Lv ${ts.lv}: ${ts.n} / ${ts.bonus} for ${ts.cost} modules`) : ""}
    ${need.sh && !r.noPass ? upgTile(`<span class="upgi upgtk">MD</span>`, upgFmt(r.weeks + r.runs), "Mirror Dungeon runs", `${r.weeks} with the weekly bonus, ${r.runs} without`) : ""}
    ${need.sh && !r.noPass ? upgTile(`<span class="upgi upgtk">LV</span>`, `+${upgFmt(r.lv)}`, `pass levels past ${d.pass.max}`, `${upgFmt(r.all)} points · ${upgFmt(r.lv * upgShardsAt())} Egoshards`) : ""}
    ${upgTile(upgPic("module", "Modules"), upgFmt(r.mods), "Enkephalin Modules", `${upgFmt(r.mods * d.stamina.module)} Enkephalin`)}
    ${r.lun || r.refill ? upgTile(upgPic("lunacy", "Lunacy"), `${r.lun - r.refill > 0 ? "+" : ""}${upgFmt(r.lun - r.refill)}`, "Lunacy in all", [r.lun && `+${upgFmt(r.lun)} from ${r.weeks} weekly bonus runs`, r.refill && `−${upgFmt(r.refill)} on Enkephalin refills`].filter(Boolean).join(", ")) : ""}
  </div>
  ${r.noPass ? `<p class="empty">No pass in this snapshot: Egoshards not counted.</p>` : need.sh ? `<p class="muted small">Egoshards come from the pass past level ${d.pass.max} (the levels before it taken as done): every ${d.pass.need} points ${upgFmt(upgShardsAt() / UPG_CRATE)} crate(s) of choice with the ${upg.cfg.paid ? "Limbus Pass" : "free pass"}, 1–3 Egoshards each, counted as 2. The weekly bonus is used on all 3 at once.</p>` : ""}`;
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
    <div class="upgcost">${upgOwn(x) ? `<span class="upgmine">✓ in your Collection</span>` : ""}${cr ? `<span>${upgShard(x.sinner, "s")}${cr.p}</span>` : `<span class="muted">Not in the Dispenser</span>`}</div>
    <button class="upgdel" data-del="${i}" title="Remove">✕</button></div>`;
}
const upgAddBox = (ph) => `<div class="cqpick upgadd"><span class="upgplus">+</span><input class="cqin" placeholder="${ph}" autocomplete="off"><div class="cqlist"></div></div>`;
const upgHave = (inner) => `<div class="upghave"><span class="lvlabel">You have</span><div>${inner}</div></div>`;
const upgIn = (icon, attr, v) => `<label class="upgtix">${icon}<input type="number" min="0" ${attr} value="${v}"></label>`;

function upgUp() {
  const d = upg.db, n = upgNeed(), f = upgSim({ exp: n.expLeft, th: n.thLeft, sh: n.shLeft });
  const sins = Object.keys(n.sh).map(Number).sort((a, b) => a - b), anyId = upg.list.some((r) => unitById(r.id).title);
  const shTotal = sins.reduce((a, s) => a + n.sh[s], 0);
  return `<div class="upglist">${upg.list.map(upgUpRow).join("") || `<p class="muted">Add what you want to level up.</p>`}</div>
    ${upgAddBox("Add an Identity or E.G.O…")}
    ${upgColBar(false)}
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
    ${f.days === 0 ? `<p class="muted">Nothing left to farm.</p>` : upgFarmTiles(f, { exp: n.expLeft, th: n.thLeft, sh: n.shLeft }, n.shLeft ? "until it is all there" : "of Enkephalin")}`;
}

function upgCraft() {
  const d = upg.db, need = {};
  for (const id of upg.clist) { const x = unitById(id), cr = d.craft[id]; if (cr) need[x.sinner] = (need[x.sinner] || 0) + cr.p; }
  const sins = Object.keys(need).map(Number).sort((a, b) => a - b), total = sins.reduce((a, s) => a + need[s], 0);
  const left = sins.reduce((a, s) => a + Math.max(0, need[s] - (upg.csh[s] || 0)), 0), r = upgSim({ exp: 0, th: 0, sh: left });
  return `<div class="upglist">${upg.clist.map(upgCraftRow).join("") || `<p class="muted">Add what you want to extract.</p>`}</div>
    ${upgAddBox("Add from the Dispenser…")}
    ${upgColBar(true)}
    ${sins.length ? upgHave(sins.map((s) => upgIn(upgShard(s), `data-csh="${s}"`, upg.csh[s] || 0)).join("")) : ""}
    ${total ? `<div class="upgbar"><i style="width:${(total - left) / total * 100}%"></i><span>${upgFmt(total - left)} / ${upgFmt(total)} Egoshards</span></div>` : ""}
    ${!total ? "" : !left ? `<p class="muted">You have every Egoshard already.</p>` : `<h3>From the pass and Mirror Dungeon</h3>${upgFarmTiles(r, { exp: 0, th: 0, sh: left }, "until the Extraction")}`}`;
}

function upgSide() {
  const d = upg.db, c = upg.cfg, day = upgDay();
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
    ${d.pass.ex ? `<h3>Pass and Mirror Dungeon</h3>
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
  m.querySelectorAll("[data-col]").forEach((b) => b.onclick = () => {
    const c = upgMine(), units = [...UNITS.ids, ...UNITS.egos], k = b.dataset.col;
    if (k === "take") upg.list.forEach((r) => upgFromMine(r, upgOwn(unitById(r.id), c)));
    if (k === "open") units.forEach((x) => { const o = upgOwn(x, c); if (o && !upgMaxed(x, o)) upgAdd(x); });
    if (k === "missing") units.forEach((x) => { if (d.craft[x.id] && !upgOwn(x, c)) upgAdd(x); });
    upgDraw();
  });
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
    const mine = upgMine(), tag = (x) => { const o = upgOwn(x, mine); return o ? ` <b class="upgmine">✓${o.u ? ` ${ROMAN[o.u - 1]}` : ""}${o.l ? ` · Lv ${o.l}` : ""}</b>` : ""; };
    list.innerHTML = found.map((x) => `<div data-id="${x.id}"><img src="${imgThumb(x.img.thumb)}" alt=""><span>${esc(x.title || x.name)} <i>${esc(x.sinnerName)} · ${esc(upgRank(x))}</i>${tag(x)}</span></div>`).join("");
    list.querySelectorAll("[data-id]").forEach((el) => el.onmousedown = (e) => { e.preventDefault(); upgAdd(unitById(+el.dataset.id)); upgDraw(); const n = $(".upgadd input"); if (n) n.focus(); });
  };
  inp.onfocus = () => sxBack().then(() => inp.oninput());
  inp.onblur = () => setTimeout(() => { list.innerHTML = ""; }, 150);
}
