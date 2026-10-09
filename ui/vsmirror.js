// Versus → Mirror: a short PvE run in the spirit of the Mirror Dungeon, fought 1v1 with the Versus engine
// (limbusdm/versus_mirror.py): Identity → shop → pack → boss → gift 1 of 3 → shop → pack → boss. Each boss starts at full
// HP; within a fight nothing heals but lifesteal. Exchanges on / off for the whole run (picked at its start). Fighters are
// drawn as they stand in a fight (the Versus page's idle-pose pictures, made by the player; a portrait meanwhile). The page keeps the run (localStorage "vsmirror": a convenience, not a save); the server answers
// each action (/api/mirror/act) and plays a boss fight in the Live window (/api/versus with "mirror": the same fight
// "Result now" gets, the seed is the run's).
const vm = { cat: null, run: null, fight: null, busy: false, kw: null, sel: null, live: null, flow: "", asked: new Set() };
const VM_KEEP = "vsmirror";
const vmSave = () => { try { localStorage.setItem(VM_KEEP, JSON.stringify({ run: vm.run, fight: vm.fight, flow: vm.flow })); } catch { /* not kept */ } };
function vmLoad() {
  try {
    const x = JSON.parse(localStorage.getItem(VM_KEEP) || "null");
    if (x && x.run) { vm.run = x.run; vm.fight = x.fight || null; }
    if (x && x.flow) vm.flow = x.flow;
  } catch { /* nothing kept */ }
}
const VM_ATK = { Slash: "Slash", Penetrate: "Pierce", Hit: "Blunt" };
const vmG = (id) => vm.cat.gifts[id] || { name: "Gift " + id, kw: "", tier: 1, pic: "", price: 0, eff: [[], [], []] };
const vmKwName = (kw) => vm.cat.kwName[kw || ""] || kw;
const vmKwIco = (kw, cls = "s18") => !kw ? "" : VM_ATK[kw] ? ico(`atk_${VM_ATK[kw]}`, cls, VM_ATK[kw], VM_ATK[kw]) : statusIcon(kw, cls);
const vmLvl = (lv) => (lv >= 3 ? "++" : lv === 2 ? "+" : "");
const vmCost = (n) => `<span class="vmcost">${ico("coin", "s18", "Cost", "Cost")}${n}</span>`;
const vmUnit = (id) => (typeof UNITS !== "undefined" && UNITS ? UNITS.ids.find((x) => x.id === id) : null);
const vmIdName = (id) => { const u = vmUnit(id); return u ? `${u.sinnerName} · ${u.title}` : String(id); };
// a fighter's picture: its idle pose (Spine / sprites) once the player has drawn it, else its portrait meanwhile
const vmFig = (id) => (typeof vs !== "undefined" ? vsFigUrl(id) : "");
const vmIdPic = (id) => { const f = vmFig(id), u = vmUnit(id); return f ? `<img class="fig" src="${f}" alt="${esc(vmIdName(id))}">` : `<img class="idp" data-id="${id}" src="${u && u.img ? imgThumb(u.img.thumb) : vsIcon(id)}" onerror="vsImgErr(this)" alt="${esc(vmIdName(id))}">`; };
const vmBossPic = (app) => { const f = vmFig(app); return f ? `<img class="fig" src="${f}" alt="">` : `<img data-id="${esc(app)}" src="${vsIcon(app)}" onerror="this.style.visibility='hidden'" alt="">`; };
// the idle-pose pictures of these fighters asked of the player (once each); the page is drawn again as they come
async function vmFigWant(ids) {
  if (typeof vs === "undefined") return;
  if (!vs.figs) vsFigsSet(await api("/api/fighter_pics").catch(() => null));
  if (!vs.figs) return;
  const want = [...new Set(ids.map(String))].filter((id) => !vs.figs.have.has(id) && !vs.figs.failed.has(id) && !vm.asked.has(id));
  if (!want.length) return;
  want.forEach((id) => vm.asked.add(id));
  vsFigsSet(await api("/api/fighter_pics", { ids: want }).catch(() => null));
  vmFigWatch();
}
async function vmFigWatch() {
  clearTimeout(vmFigWatch.timer);
  const before = vs.figs.have.size;
  vsFigsSet(await api("/api/fighter_pics").catch(() => null));
  if (!location.hash.startsWith("#/vsmirror")) return;
  if (vs.figs.have.size !== before && !vm.busy && !(document.activeElement && document.activeElement.tagName === "SELECT")) vmDraw();
  if (vs.figs.busy) vmFigWatch.timer = setTimeout(vmFigWatch, 1500);
}
const vmPack = (pid) => vm.cat.packs.find((p) => p.id === pid);

routes.vsmirror = async () => {
  const main = $("#main");
  if (!vm.cat) {
    main.innerHTML = `<h1>Mirror</h1><div class="muted">Reading the gifts and packs…</div>`;
    try { [vm.cat] = await Promise.all([api("/api/mirror/catalog"), units()]); } catch (e) { main.innerHTML = `<h1>Mirror</h1><div class="empty">${esc(e.message)}</div>`; return; }
    if (!vm.run) vmLoad();
  }
  if (!location.hash.startsWith("#/vsmirror")) return;
  if (!vm.cat.packs.length) { vm.cat = null; main.innerHTML = `<h1>Mirror</h1><div class="empty">Take a snapshot first — the gifts and packs are read from it.</div>`; return; }
  vmDraw();
};

async function vmAct(act, arg = null) {
  if (vm.busy) return;
  vm.busy = true;
  document.querySelectorAll("#main button").forEach((b) => { b.disabled = true; });
  const note = $("#vmnote");
  if (note && (act === "new" || act === "pack" || act === "fight")) note.textContent = act === "fight" ? "Fighting…" : "Getting the fighters ready…";
  try {
    const r = await api("/api/mirror/act", { run: act === "new" ? null : vm.run, act, arg: act === "new" ? { flow: vm.flow } : arg });
    vm.run = r.run;
    if (r.fight) vm.fight = r.fight;
    if (act === "new") vm.fight = null;
    if (act !== "buy" && act !== "sell" && act !== "enhance") vm.sel = null;
    vmSave();
  } catch (e) { toast(esc(e.message)); }
  vm.busy = false;
  vmDraw();
}

// ---- the page: a head (where the run is), then the phase's screen
function vmDraw() {
  const main = $("#main"), r = vm.run;
  if (!main || !location.hash.startsWith("#/vsmirror")) return;
  const steps = ["Identity", "Shop", "Pack 1", "Boss 1", "Gift", "Shop", "Pack 2", "Boss 2", "End"];
  const at = !r ? -1 : r.phase === "id" ? 0 : r.phase === "end" ? 8 : r.phase === "reward" ? 4
    : { shop: 1, pack: 2, boss: 3 }[r.phase] + (r.floor > 0 ? 4 : 0);
  const head = `<div class="vmsteps">${steps.map((s, i) => `<span class="${i === at ? "on" : i < at ? "done" : ""}">${s}</span>`).join("")}<em>Exchanges ${r && r.flow === "series" ? "off" : "on"}</em></div>`;
  const body = !r ? vmStart() : r.phase === "id" ? vmPick() : r.phase === "shop" ? vmShop() : r.phase === "pack" ? vmPacks()
    : r.phase === "boss" ? vmBoss() : r.phase === "reward" ? vmReward() : vmEnd();
  main.innerHTML = `<div class="vm">${r ? head : ""}${body}<div id="vmnote" class="muted small"></div></div>`;
  main.querySelectorAll("[data-act]").forEach((b) => b.onclick = () => {
    const a = b.dataset.arg;
    vmAct(b.dataset.act, a === undefined ? null : /^-?\d+$/.test(a) ? +a : a);
  });
  main.querySelectorAll("[data-sel]").forEach((b) => b.onclick = () => { vm.sel = vm.sel === +b.dataset.sel ? null : +b.dataset.sel; vmDraw(); });
  const kw = $("#vmkw");
  if (kw) kw.onchange = () => { vm.kw = kw.value; };
  if ($("#vmlive")) $("#vmlive").onclick = vmLive;
  if ($("#vmquit")) $("#vmquit").onclick = () => { if (confirm("Give up this run?")) { vm.run = null; vm.fight = null; vmSave(); vmDraw(); } };
  main.querySelectorAll("[data-flow]").forEach((b) => b.onclick = () => { vm.flow = b.dataset.flow; vmSave(); vmDraw(); });
  if (r && r.phase === "boss") vmLiveWatch();
  // (the fighters on this screen: their idle-pose pictures)
  const ids = !r ? [] : r.phase === "id" ? r.offer : r.phase === "pack" ? [r.id, ...r.offer.flatMap((p) => (vmPack(p) || {}).bosses || [])]
    : [r.id, r.boss, ...(r.fights || []).map((f) => f.boss)].filter((x) => x);
  vmFigWant(ids);
}
// Exchanges on / off, for the whole run (Duel's switch of that name: exchanges of clashes, landings and stand-offs; off:
// a series of clashes, then the one ahead lands its last skill)
const vmFlowSw = () => `<span class="seg" title="Exchanges: clashes in exchanges, skills landing, stand-offs (longer fights). Off: one series of clashes, then the one ahead lands its last skill (shorter)">
  <span class="vmlbl">Exchanges</span> <button class="toggle ${vm.flow === "series" ? "" : "on"}" data-flow="">On</button><button class="toggle ${vm.flow === "series" ? "on" : ""}" data-flow="series">Off</button></span>`;

function vmStart() {
  const R = vm.cat.rules;
  return `<span class="vmkick">PvE · 1 vs 1</span><h1>Mirror</h1>
    <div class="sub">A short run in the spirit of the Mirror Dungeon: pick an Identity, buy gifts, pick a pack — its boss is your next fight —
      and win a gift from it. ${R.floors} bosses, each fought at full HP; in a fight nothing heals but lifesteal gifts. A lost boss ends the run.</div>
    <div class="vmrow">${vmFlowSw()}<button class="primary" data-act="new">New run ›</button></div>
    <div class="card vmhelp"><h2>Statuses</h2>${vm.cat.status.map((s) => `<div>${statusIcon(s.kw, "s20")} <b>${esc(s.name)}</b> — ${esc(s.help)}</div>`).join("")}
      <div class="muted small">Gifts' effects here are our own simple ones per keyword and tier, not the game's.</div></div>`;
}

// ---- Identity: 1 of 3
function vmPick() {
  const R = vm.cat.rules;
  return `<span class="vmkick">New run · 1 vs 1</span><h1>Pick your Identity</h1>
    <div class="sub">It brings its skills and a starting gift of its keyword. Max HP ${R.hp_player} for everyone, gifts can raise it.</div>
    <div class="vmgrid">${vm.run.offer.map((id) => {
      const u = vmUnit(id) || {};
      return `<div class="card vmcard"><div class="vmstage">${vmIdPic(id)}</div>
        <div><div class="vmsmall">${esc(u.sinnerName || "")}</div><div class="vmname">${esc(u.title || id)}</div></div>
        <div class="vmkws">${(u.statuses || []).map((k) => `<span class="vmkw">${statusIcon(k, "s20")}${esc(statusName(k))}</span>`).join("")}</div>
        <div class="vmsmall">Starting gift: a tier I gift${u.statuses && u.statuses[0] ? ` of ${esc(vmKwName(u.statuses[0]))}` : ""}</div>
        <button class="primary" data-act="id" data-arg="${id}">Take ›</button></div>`;
    }).join("")}</div>
    <div class="vmrow"><button id="vmquit">Give up</button></div>`;
}

// ---- the shop
function vmGift(id, lv, extra = "") {
  const g = vmG(id);
  return `<div class="vmgi" title="${esc(g.name)}">${g.pic ? `<img src="${imgThumb(g.pic)}" loading="lazy" alt="">` : ""}<b>${ROMAN[(g.tier || 1) - 1]}</b>${lv > 1 ? `<i>${vmLvl(lv)}</i>` : ""}<span>${vmKwIco(g.kw, "s18")}</span>${extra}</div>`;
}
const vmEff = (id, lv = 1) => (vmG(id).eff[lv - 1] || []).map((x) => `<div>${esc(x)}</div>`).join("") || `<div class="muted">—</div>`;
function vmStats() {
  const r = vm.run;
  return `<div class="card vmstats"><div class="gold"><b>${ico("coin", "s22", "Cost", "")}${r.cost}</b><span>Cost</span></div><div><b>${r.hpMax}</b><span>Max HP</span></div>
    <div><b>${r.build.length}</b><span>Gifts</span></div><div><b>${r.floor}<small> / ${vm.cat.rules.floors}</small></b><span>Bosses down</span></div></div>`;
}
function vmSide() {
  const r = vm.run, u = vmUnit(r.id) || {};
  return `<div class="card vmside"><div class="vmstage small">${vmIdPic(r.id)}</div>
    <div class="vmsmall">${esc(u.sinnerName || "")}</div><div class="vmname">${esc(u.title || r.id)}</div>
    <div class="vmkws">${(u.statuses || []).map((k) => `<span class="vmkw">${statusIcon(k, "s18")}${esc(statusName(k))}</span>`).join("")}</div>
    <div class="vmlbl">Your build</div><div class="vmeff">${(r.buildText || []).map((x) => `<div>${esc(x)}</div>`).join("") || `<div class="muted">No effects yet</div>`}</div></div>`;
}
function vmFought() {
  const fs = vm.run.fights || [];
  if (!fs.length) return "";
  return `<div class="card"><div class="vmlbl">Cleared</div>${fs.map((f) => {
    const p = vmPack(f.pack);
    return `<div class="vmfought">${vmBossPic(f.boss)}<div><b>${esc(p ? p.name : "")}</b><div class="vmsmall">Boss ${f.floor + 1} · ${f.winner === 0 ? "won" : "lost"} · ${Math.floor(f.seconds / 60)}:${String(f.seconds % 60).padStart(2, "0")} · HP ${f.hp[0]} / ${f.hpMax[0]}</div></div></div>`;
  }).join("")}</div>`;
}
function vmShop() {
  const r = vm.run, R = vm.cat.rules, own = new Set(r.build.map((b) => b.id));
  const kws = Object.keys(vm.cat.kwName).filter((k) => k);
  if (vm.kw === null || !kws.includes(vm.kw)) vm.kw = r.kw && kws.includes(r.kw) ? r.kw : kws[0];
  const sel = r.build.find((b) => b.id === vm.sel);
  const enh = sel && sel.level < 3 ? R.enhance[sel.level - 1] : 0;
  return `<h1>Shop</h1>${vmStats()}
    <div class="vmshop">${vmSide()}
    <div class="vmmid">
      <div class="vmbar"><span class="vmlbl">Stock</span><span class="grow"></span>
        <button data-act="refresh" ${r.cost < R.refresh ? "disabled" : ""} title="A new shelf of any gifts">Refresh ${vmCost(R.refresh)}</button>
        <select id="vmkw" title="The keyword of the next shelf">${kws.map((k) => `<option value="${k}" ${k === vm.kw ? "selected" : ""}>${esc(vmKwName(k))}</option>`).join("")}</select>
        <button id="vmkwr" ${r.cost < R.kw_refresh ? "disabled" : ""} title="A new shelf of the picked keyword's gifts">Keyword refresh ${vmCost(R.kw_refresh)}</button></div>
      <div class="vmstock">${r.shelf.length ? r.shelf.map((id) => {
        const g = vmG(id);
        return `<div class="card vmitem">${vmGift(id, 1)}<div class="vmgname">${esc(g.name)}</div><div class="vmsmall">${vmKwIco(g.kw, "s16")} ${esc(vmKwName(g.kw))}</div>
          <div class="vmeff">${vmEff(id)}</div><button data-act="buy" data-arg="${id}" ${r.cost < g.price || own.has(id) ? "disabled" : ""}>${vmCost(g.price)}</button></div>`;
      }).join("") : `<div class="muted">Sold out — refresh for more.</div>`}</div>
      <div class="vmbar"><span class="vmlbl">Your gifts · ${r.build.length}</span><span class="grow"></span>
        ${sel ? `<button data-act="enhance" data-arg="${sel.id}" ${!enh || r.cost < enh ? "disabled" : ""}>${sel.level >= 3 ? "Enhanced ++" : `Enhance to ${vmLvl(sel.level + 1)} ${vmCost(enh)}`}</button>
        <button data-act="sell" data-arg="${sel.id}">Sell ${vmCost("+" + Math.floor(vmG(sel.id).price / 2))}</button>` : `<span class="muted small">Click a gift to enhance or sell it</span>`}</div>
      <div class="card vmowned">${r.build.map((b) => `<button class="vmown ${b.id === vm.sel ? "on" : ""}" data-sel="${b.id}">${vmGift(b.id, b.level)}</button>`).join("") || `<span class="muted">None yet</span>`}
        ${sel ? `<div class="vmseldesc"><b>${esc(vmG(sel.id).name)}${vmLvl(sel.level)}</b>${vmEff(sel.id, sel.level)}${sel.level < 3 ? `<div class="vmsmall">At ${vmLvl(sel.level + 1)}: ${(vmG(sel.id).eff[sel.level] || []).map(esc).join(" · ")}</div>` : ""}</div>` : ""}</div>
    </div>
    <div class="vmright"><div class="card"><div class="vmlbl">Next</div><div class="vmname">Pack ${r.floor + 1} → Boss ${r.floor + 1}</div>
      <div class="vmsmall">The pack you pick is the boss you fight, and the gifts it pays out.</div>
      <button class="primary" data-act="leave">Pick pack ${r.floor + 1} ›</button></div>${vmFought()}</div></div>
    <div class="vmrow"><button id="vmquit">Give up</button></div>`;
}
// (the keyword refresh: its keyword from the select)
document.addEventListener("click", (e) => { if (e.target.closest && e.target.closest("#vmkwr")) vmAct("refresh", vm.kw); });

// ---- a pack: 1 of 3 (its boss is the next fight)
function vmPacks() {
  const r = vm.run, R = vm.cat.rules, f = Math.min(r.floor, R.boss_hp.length - 1);
  return `<span class="vmkick">Pack ${r.floor + 1} of ${R.floors} · HP ${r.hpMax}</span><h1>Pick a pack</h1>
    <div class="sub">The pack is the boss you fight next and the gifts you can win from it.</div>
    <div class="vmgrid">${r.offer.map((pid) => {
      const p = vmPack(pid);
      if (!p) return "";
      const kws = [...new Set(p.pool.map((g) => vmG(g).kw).filter((k) => k))].slice(0, 6);
      const names = [...new Set(p.bossNames)];
      return `<div class="card vmcard"><div class="vmstage vmpack">${p.pic ? `<img src="${imgThumb(p.pic)}" alt="">` : ""}${p.hard ? `<span class="vmtag">Hard</span>` : ""}
          <div class="vmbosses">${[...new Set(p.bosses)].slice(0, 3).map((b) => vmBossPic(b)).join("")}</div></div>
        <div><div class="vmsmall">${esc(p.name)}</div><div class="vmname">Boss: ${names.length > 1 ? `one of ${names.map(esc).join(" / ")}` : esc(names[0] || "?")}</div></div>
        <div class="vmsmall">Boss HP ${Math.round(R.hp_player * R.boss_hp[f])}${R.boss_power[f] ? ` · +${R.boss_power[f]} power` : ""}</div>
        <div class="vminfo"><span class="vmlbl">Reward</span><span>Gift 1 of 3 from ${p.pool.length} ${kws.map((k) => vmKwIco(k, "s18")).join("")}</span>
          <span class="vmlbl">Cost</span><span>${vmCost("+" + (R.cost_boss + R.cost_floor * r.floor))}</span></div>
        <button class="primary" data-act="pack" data-arg="${pid}">Fight this boss ›</button></div>`;
    }).join("")}</div>`;
}

// ---- the boss: watch it in the Live window, or the result now (the same fight)
function vmBoss() {
  const r = vm.run, b = r.bossInfo || {}, hp = r.hpMax;
  return `<span class="vmkick">${esc(vmPack(r.pack.id) ? vmPack(r.pack.id).name : "")}</span><h1>Boss ${r.floor + 1} of ${vm.cat.rules.floors}</h1>
    <div class="card vmvs"><div class="vmfighter">${vmIdPic(r.id)}<div class="vmname">${esc(vmIdName(r.id))}</div><div class="vmhp">HP <b>${hp}</b> / ${r.hpMax}</div></div>
      <div class="vmversus">VS</div>
      <div class="vmfighter">${vmBossPic(r.boss)}<div class="vmname">${esc(b.name || r.boss)}</div><div class="vmhp">HP <b>${b.hpMax || "?"}</b>${b.cls ? ` · ${esc(b.cls)}` : ""}${b.power ? ` · +${b.power} power` : ""}</div></div></div>
    <div class="vmrow"><button class="primary" id="vmlive" title="Played in the player's own window as it happens, with its sounds and music">Watch the fight ›</button>
      <button data-act="fight" title="The same fight, without watching it">Result now ›</button><span id="vmlivenote" class="muted"></span></div>
    <div class="vmside2">${vmSide()}${vmFought()}</div>`;
}
async function vmLive() {
  const r = vm.run;
  const rnd = (n, k) => (n ? (r.seed * 13 + r.floor * 7 + k) % n : 0);
  if (!vs.maps) vs.maps = await api("/api/battle_maps").catch(() => []);
  if (!vs.bgm) vs.bgm = await api("/api/bgm_tracks").catch(() => []);
  const spec = { live: true, mirror: r, mode: "clash", hp: true, death: true, intro: true, deck: true, spread: true, randskill: true,
    lname: vmIdName(r.id), rname: (r.bossInfo || {}).name || "" };
  if (vs.maps.length) spec.map = vs.maps[rnd(vs.maps.length, 1)];
  if (vs.bgm.length) spec.music = vs.bgm[rnd(vs.bgm.length, 2)].name;
  try { await api("/api/versus", spec); } catch (e) { toast(esc(e.message)); return; }
  vm.live = { seed: r.seed, floor: r.floor };
  vmLiveWatch();
}
async function vmLiveWatch() {
  clearTimeout(vmLiveWatch.timer);
  const note = $("#vmlivenote");
  if (!note) return;
  let st;
  try { st = await api("/api/versus_live"); } catch (e) { vmLiveWatch.timer = setTimeout(vmLiveWatch, 2000); return; }
  const busy = ["preparing", "loading", "playing"].includes(st.state);
  const mine = vm.live && vm.run && vm.live.seed === vm.run.seed && vm.live.floor === vm.run.floor;
  if ($("#vmlive")) $("#vmlive").disabled = busy;
  if (busy) note.textContent = st.msg || "";
  else if (st.state === "error" && mine) note.innerHTML = `<span class="bad">${esc(st.msg || "failed")}</span>`;
  else if (st.state === "done" && mine && vm.run.phase === "boss" && !vm.busy) {  // (over: straight to the result)
    vm.live = null;
    vmAct("fight");
    return;
  }
  if (busy) vmLiveWatch.timer = setTimeout(vmLiveWatch, 1000);
}

// ---- after a won boss: a gift 1 of 3 from its pack
function vmFightBox(f) {
  if (!f) return "";
  const t = `${Math.floor(f.seconds / 60)}:${String(f.seconds % 60).padStart(2, "0")}`;
  const row = (k, a, b) => `<span>${k}</span><b>${a}</b><b>${b}</b>`;
  const s = f.side;
  return `<div class="card vmfight"><div class="vmlbl">Boss ${f.floor + 1} · ${f.winner === 0 ? "won" : "lost"} · ~${t} · ${f.clashes} clashes</div>
    <div class="vmtable"><span></span><b class="muted">You</b><b class="muted">Boss</b>
      ${row("HP left", `${f.hp[0]} / ${f.hpMax[0]}`, `${f.hp[1]} / ${f.hpMax[1]}`)}${row("Clashes won", s[0].clashes, s[1].clashes)}
      ${row("Skills landed", s[0].landed, s[1].landed)}${row("Damage by hits", s[0].hits, s[1].hits)}
      ${row("Damage by statuses", s[0].status, s[1].status)}${row("Healed", s[0].heal, s[1].heal)}</div></div>`;
}
function vmReward() {
  const r = vm.run;
  return `<div class="vmcenter"><span class="vmkick good">Boss ${r.floor} down</span><h1>Take one gift</h1>
    <div class="sub">The other two are gone. The next boss is fought at full HP again.</div></div>
    <div class="vmgrid">${r.offer.map((id) => {
      const g = vmG(id);
      return `<div class="card vmcard vmrew">${vmGift(id, 1)}<div class="vmname">${esc(g.name)}</div><div class="vmsmall">${vmKwIco(g.kw, "s16")} ${esc(vmKwName(g.kw))}</div>
        <div class="vmeff">${vmEff(id)}</div><button class="primary" data-act="reward" data-arg="${id}">Take ›</button></div>`;
    }).join("")}</div>
    <div class="vmrow vmcenter"><button data-act="reward">Take nothing</button></div>${vmFightBox(vm.fight)}`;
}

// ---- the end
function vmEnd() {
  const r = vm.run, won = !!r.won, fs = r.fights || [];
  const secs = fs.reduce((a, f) => a + f.seconds, 0);
  const heal = fs.reduce((a, f) => a + f.side[0].heal, 0);
  const last = fs[fs.length - 1];
  const st = [[`${fs.filter((f) => f.winner === 0).length} / ${vm.cat.rules.floors}`, "Bosses"], [last ? `${last.hp[0]}` : "0", "HP left (last boss)"],
    [r.build.length, "Gifts"], [`${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`, "Fighting"], [`+${heal}`, "Lifesteal HP"]];
  return `<span class="vmkick">Run result</span><h1>${won ? "Run cleared" : "Run lost"}</h1>
    <div class="card vmstats">${st.map(([v, k]) => `<div><b>${v}</b><span>${k}</span></div>`).join("")}</div>
    <div class="vmshop2">${vmSide()}<div><div class="card vmowned">${r.build.map((b) => vmGift(b.id, b.level)).join("")}</div>${fs.map(vmFightBox).join("")}</div></div>
    <div class="vmrow">${vmFlowSw()}<button class="primary" data-act="new">New run ›</button></div>`;
}
