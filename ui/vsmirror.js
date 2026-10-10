// Versus → Mirror (limbusdm/versus_mirror2.py, its fight core in versus_mirror.py): 5 floors, 4 characters with their own kits, the
// game's deck, one defense each; shop with gift slots, lock, recipes (fusion), interest, economy gifts; a pack = a floor
// with a clear goal (keyword, boss and reward gifts shown before the pick). Route #/vsmirror. The run lives in the page
// (localStorage "vsmirror"; an older run without v 2 is dropped); /api/mirror/act answers.
const m2 = { cat: null, run: null, fight: null, busy: false, kw: null, sel: null, live: null, asked: new Set() };
const M2_KEEP = "vsmirror";
const m2Save = () => { try { localStorage.setItem(M2_KEEP, JSON.stringify({ run: m2.run, fight: m2.fight })); } catch { /* not kept */ } };
function m2Load() {
  try { const x = JSON.parse(localStorage.getItem(M2_KEEP) || "null"); if (x && x.run && x.run.v === 2) { m2.run = x.run; m2.fight = x.fight || null; } } catch { /* none */ }
}
const m2G = (id) => m2.cat.gifts[id] || { name: "Gift " + id, kw: "", tier: 1, pic: "", price: 0, eff: [[], [], []] };
const m2KwName = (kw) => m2.cat.kwName[kw || ""] || kw;
const m2KwIco = (kw, cls = "s18") => (kw ? statusIcon(kw, cls) : "");
const m2Lvl = (lv) => (lv >= 3 ? "++" : lv === 2 ? "+" : "");
const m2Cost = (n) => `<span class="vmcost">${ico("coin", "s18", "Cost", "Cost")}${n}</span>`;
const m2Unit = (id) => (typeof UNITS !== "undefined" && UNITS ? UNITS.ids.find((x) => x.id === id) : null);
const m2IdName = (id) => { const u = m2Unit(id); return u ? `${u.sinnerName} · ${u.title}` : String(id); };
const m2Kit = (id) => m2.cat.kits.find((k) => k.id === id) || { rules: [], levels: {} };
const m2Pack = (pid) => m2.cat.packs.find((p) => p.id === pid);
const m2Fig = (id) => (typeof vs !== "undefined" ? vsFigUrl(id) : "");
const m2IdPic = (id) => { const f = m2Fig(id), u = m2Unit(id); return f ? `<img class="fig" src="${f}" alt="">` : `<img class="idp" src="${u && u.img ? imgThumb(u.img.thumb) : vsIcon(id)}" onerror="vsImgErr(this)" alt="">`; };
// (bosses: their portrait in a circle — user, 2026-10-10: not the whole Spine figure)
// (no portrait in the game files: its face cut from its idle picture; neither: hidden)
const m2Face = (app, cls = "") => `<span class="m2face ${cls}"><img src="${vsIcon(app)}" data-face="${esc(String(app))}" onerror="m2FaceErr(this)" alt=""></span>`;
function m2FaceErr(img) {
  if (img.dataset.face) { const id = img.dataset.face; img.dataset.face = ""; img.src = `/api/fighter_face?id=${encodeURIComponent(id)}`; return; }
  img.style.visibility = "hidden";
}
const m2Price = (base, key) => Math.round(base * (1 - Math.min(0.9, (m2.run.econ || {})[key] || 0)));
const m2Defense = { Counter: "Counter", Guard: "Guard", Evade: "Evade" };

async function m2FigWant(ids) {
  if (typeof vs === "undefined") return;
  if (!vs.figs) vsFigsSet(await api("/api/fighter_pics").catch(() => null));
  if (!vs.figs) return;
  const want = [...new Set(ids.map(String))].filter((id) => !vs.figs.have.has(id) && !vs.figs.failed.has(id) && !m2.asked.has(id));
  if (!want.length) return;
  want.forEach((id) => m2.asked.add(id));
  vsFigsSet(await api("/api/fighter_pics", { ids: want }).catch(() => null));
  m2FigWatch();
}
async function m2FigWatch() {
  clearTimeout(m2FigWatch.timer);
  const before = vs.figs.have.size;
  vsFigsSet(await api("/api/fighter_pics").catch(() => null));
  if (!location.hash.startsWith("#/vsmirror")) return;
  if (vs.figs.have.size !== before && !m2.busy) m2Draw();
  if (vs.figs.busy) m2FigWatch.timer = setTimeout(m2FigWatch, 1500);
}

routes.vsmirror = async () => {
  const main = $("#main");
  if (!m2.cat) {
    main.innerHTML = `<h1>Mirror</h1><div class="muted">Reading the gifts, packs and characters…</div>`;
    try { [m2.cat] = await Promise.all([api("/api/mirror/catalog"), units()]); } catch (e) { main.innerHTML = `<h1>Mirror</h1><div class="empty">${esc(e.message)}</div>`; return; }
    if (!m2.run) m2Load();
  }
  if (!location.hash.startsWith("#/vsmirror")) return;
  if (!m2.cat.packs.length) { m2.cat = null; main.innerHTML = `<h1>Mirror</h1><div class="empty">Take a snapshot first — the gifts and packs are read from it.</div>`; return; }
  m2Draw();
};

async function m2Act(act, arg = null) {
  if (m2.busy) return;
  m2.busy = true;
  document.querySelectorAll("#main button").forEach((b) => { b.disabled = true; });
  const note = $("#m2note");
  if (note && ["new", "id", "leave", "fight"].includes(act)) note.textContent = act === "fight" ? "Fighting…" : "Getting the fighters ready…";
  try {
    if (act === "new" && arg === null) arg = { bossSt: m2BossSt() };
    const r = await api("/api/mirror/act", { run: act === "new" ? null : m2.run, act, arg });
    m2.run = r.run;
    if (r.fight) m2.fight = r.fight;
    if (act === "new") m2.fight = null;
    if (!["buy", "sell", "enhance"].includes(act)) m2.sel = null;
    m2Save();
  } catch (e) { toast(esc(e.message)); }
  m2.busy = false;
  m2Draw();
}

function m2Draw() {
  const main = $("#main"), r = m2.run;
  if (!main || !location.hash.startsWith("#/vsmirror")) return;
  const F = m2.cat.rules.floors;
  const head = !r ? "" : `<div class="vmsteps">${["Character", ...Array.from({ length: F }, (_, i) => `Floor ${i + 1}`), "End"].map((s, i) => {
    const at = r.phase === "id" ? 0 : r.phase === "end" ? F + 1 : r.floor + 1;
    return `<span class="${i === at ? "on" : i < at ? "done" : ""}">${s}</span>`;
  }).join("")}<em>${r.phase === "id" ? "" : { shop: "Shop", pack: "Pick the floor", boss: "Boss", reward: "Reward", end: "" }[r.phase] || ""}</em></div>`;
  const body = !r ? m2Start() : r.phase === "id" ? m2Pick() : r.phase === "shop" ? m2Shop() : r.phase === "pack" ? m2Packs()
    : r.phase === "boss" ? m2Boss() : r.phase === "reward" ? m2Reward() : m2End();
  main.innerHTML = `<div class="vm m2">${head}${body}<div id="m2note" class="muted small"></div></div>`;
  main.querySelectorAll("[data-act]").forEach((b) => b.onclick = () => {
    const a = b.dataset.arg;
    m2Act(b.dataset.act, a === undefined ? null : /^-?\d+$/.test(a) ? +a : a);
  });
  main.querySelectorAll("[data-sel]").forEach((b) => b.onclick = () => { m2.sel = m2.sel === +b.dataset.sel ? null : +b.dataset.sel; m2Draw(); });
  const bst = $("#m2bossst");
  if (bst) bst.onchange = () => { try { localStorage.setItem("vsmirror.bossSt", bst.checked ? "1" : "0"); } catch { /* not kept */ } };
  const kw = $("#m2kw");
  if (kw) kw.onchange = () => { m2.kw = kw.value; };
  if ($("#m2kwr")) $("#m2kwr").onclick = () => m2Act("refresh", m2.kw);
  if ($("#m2live")) $("#m2live").onclick = m2Live;
  if ($("#m2quit")) $("#m2quit").onclick = () => { if (confirm("Give up this run?")) { m2.run = null; m2.fight = null; m2Save(); m2Draw(); } };
  if (r && r.phase === "boss") m2LiveWatch();
  const ids = !r ? [] : r.phase === "id" ? r.offer : [r.id, r.boss].filter((x) => x);
  m2FigWant(ids);
}

const m2StatusHelp = () => `<div class="card vmhelp"><h2>Statuses</h2>${m2.cat.status.map((s) => `<div>${statusIcon(s.kw, "s20")} <b>${esc(s.name)}</b> — ${esc(s.help)}</div>`).join("")}</div>`;

// start screen switch: bosses deal their pack's status (off by default; kept in localStorage)
const m2BossSt = () => { try { return localStorage.getItem("vsmirror.bossSt") === "1"; } catch { return false; } };
const m2BossStBox = () => `<label class="toggle"><input type="checkbox" id="m2bossst" ${m2BossSt() ? "checked" : ""}> Bosses deal their pack's status</label>`;

function m2Start() {
  const R = m2.cat.rules;
  return `<span class="vmkick">PvE · 1 vs 1</span><h1>Mirror</h1>
    <div class="sub">${R.floors} floors. Pick one of four characters — each plays its own way. Skills come from a deck (S1 ×3, S2 ×2, S3 ×1). Each floor: shop → pick a pack
      (its keyword, boss and reward are shown) → boss. Gift slots are few (${R.slots[0]}, +${R.slots[1]} per boss); held Cost earns interest
      (+${R.interest[0]} per ${R.interest[1]}, at most +${R.interest[2]}); three gifts of a recipe fuse into one. A lost boss ends the run.</div>
    <div class="vmrow"><button class="primary" data-act="new">New run ›</button>${m2BossStBox()}</div>${m2StatusHelp()}`;
}

function m2KitBox(id, big = false) {
  const k = m2Kit(id), lv = (m2.run && m2.run.id === id && m2.run.lv) || 1;
  const levels = Object.entries(k.levels || {});
  return `<div class="m2kit">${big ? `<div class="m2words">“${esc(k.words || "")}”</div>` : ""}
    ${(k.rules || []).map((x) => `<div>${esc(x)}</div>`).join("")}
    ${levels.map(([n, t]) => `<div class="${lv >= +n ? "good" : "muted"}">Level ${n}: ${esc(t)}</div>`).join("")}</div>`;
}

function m2Pick() {
  return `<span class="vmkick">New run</span><h1>Pick your character</h1>
    <div class="sub">Four characters, each with its own kit. It brings its skills and a starting gift of its keyword.</div>
    <div class="vmgrid">${m2.run.offer.map((id) => {
      const u = m2Unit(id) || {}, k = m2Kit(id);
      return `<div class="card vmcard"><div class="vmstage">${m2IdPic(id)}</div>
        <div><div class="vmsmall">${esc(u.sinnerName || "")} · HP ${k.hp || "?"} · ${esc(k.defense || "")}</div><div class="vmname">${esc(u.title || id)}</div></div>
        <div class="vmkws">${(u.statuses || []).map((s) => `<span class="vmkw">${statusIcon(s, "s20")}${esc(statusName(s))}</span>`).join("")}</div>
        ${m2KitBox(id, true)}
        <button class="primary" data-act="id" data-arg="${id}">Take ›</button></div>`;
    }).join("")}</div><div class="vmrow"><button id="m2quit">Give up</button></div>`;
}

function m2Gift(id, lv, extra = "") {
  const g = m2G(id);
  return `<div class="vmgi" title="${esc(g.name)}">${g.pic ? `<img src="${imgThumb(g.pic)}" loading="lazy" alt="">` : ""}<b>${ROMAN[(g.tier || 1) - 1]}</b>${lv > 1 ? `<i>${m2Lvl(lv)}</i>` : ""}<span>${g.econ ? ico("coin", "s18", "Economy", "") : m2KwIco(g.kw, "s18")}</span>${extra}</div>`;
}
const m2Eff = (id, lv = 1) => (m2G(id).eff[lv - 1] || []).map((x) => `<div>${esc(x)}</div>`).join("") || `<div class="muted">—</div>`;

function m2Stats() {
  const r = m2.run, R = m2.cat.rules;
  const interest = Math.min(R.interest[2], R.interest[0] * Math.floor(r.cost / R.interest[1]));
  return `<div class="card vmstats"><div class="gold"><b>${ico("coin", "s22", "Cost", "")}${r.cost}</b><span>Cost · +${interest} interest after the boss</span></div>
    <div><b>${r.hpMax}</b><span>Max HP</span></div>${r.shield ? `<div class="vmshield"><b>${r.shield}</b><span>Shield</span></div>` : ""}
    <div><b>${r.build.length}<small> / ${r.slots}</small></b><span>Gift slots</span></div>
    <div><b>${r.floor}<small> / ${R.floors}</small></b><span>Bosses down</span></div></div>`;
}

function m2Side() {
  const r = m2.run, u = m2Unit(r.id) || {}, k = m2Kit(r.id), R = m2.cat.rules;
  const lv = r.lv || 1, next = (k.levels || {})[String(lv + 1)];
  const up = r.phase === "shop" && next && lv < 3 ? `<button data-act="level" ${r.cost < R.level_price[lv - 1] ? "disabled" : ""} title="${esc(next)}">Level ${lv + 1} ${m2Cost(R.level_price[lv - 1])}</button>` : "";
  return `<div class="card vmside"><div class="vmstage small">${m2IdPic(r.id)}</div>
    <div class="vmsmall">${esc(u.sinnerName || "")} · Level ${lv}</div><div class="vmname">${esc(u.title || r.id)}</div>
    ${m2KitBox(r.id)}${up}
    <div class="vmlbl">Your build</div><div class="vmeff">${(r.buildText || []).map((x) => `<div>${esc(x)}</div>`).join("") || `<div class="muted">No effects yet</div>`}</div></div>`;
}

function m2Recipes() {
  const r = m2.run, own = new Set(r.build.map((b) => b.id));
  const rs = r.recipes || [];
  if (!rs.length) return `<div class="card"><div class="vmlbl">Recipes</div><div class="muted small">Own a gift that is part of a recipe and it shows here; the shop keeps one of its missing parts on the shelf.</div></div>`;
  return `<div class="card m2rec"><div class="vmlbl">Recipes</div>${rs.map((x) => {
    const done = x.of.every((g) => own.has(g));
    return `<div class="m2recrow"><div class="m2recof">${x.of.map((g) => `<span class="${own.has(g) ? "" : "m2miss"}">${m2Gift(g, 1)}</span>`).join("+")}</div>
      <span class="m2arrow">→</span>${m2Gift(x.id, 3)}<div><b>${esc(m2G(x.id).name)}</b><div class="vmsmall">${x.have.length} / ${x.of.length} · fused at ++</div>
      ${done ? `<button class="primary" data-act="fuse" data-arg="${x.id}">Fuse</button>` : ""}</div></div>`;
  }).join("")}</div>`;
}

function m2Shop() {
  const r = m2.run, R = m2.cat.rules, own = new Set(r.build.map((b) => b.id));
  const kws = Object.keys(m2.cat.kwName).filter((k) => k);
  if (m2.kw === null || !kws.includes(m2.kw)) m2.kw = r.kw && kws.includes(r.kw) ? r.kw : kws[0];
  const sel = r.build.find((b) => b.id === m2.sel);
  const enh = sel && sel.level < 3 && !m2G(sel.id).econ ? m2Price(R.enhance[sel.level - 1], "enh_off") : 0;
  const full = r.build.length >= r.slots;
  const ref = m2Price(R.refresh, "ref_off"), kref = m2Price(R.kw_refresh, "ref_off");
  const slots = Array.from({ length: r.slots }, (_, i) => r.build[i]);
  return `<h1>Shop · floor ${r.floor + 1}</h1>${m2Stats()}
    <div class="vmshop">${m2Side()}
    <div class="vmmid">
      <div class="vmbar"><span class="vmlbl">Stock</span><span class="grow"></span>
        <button data-act="lock" class="toggle ${r.locked ? "on" : ""}" title="Locked: the next shop keeps this shelf">${r.locked ? "Locked" : "Lock"}</button>
        <button data-act="refresh" ${r.cost < ref ? "disabled" : ""}>Refresh ${m2Cost(ref)}</button>
        <select id="m2kw">${kws.map((k) => `<option value="${k}" ${k === m2.kw ? "selected" : ""}>${esc(m2KwName(k))}</option>`).join("")}</select>
        <button id="m2kwr" ${r.cost < kref ? "disabled" : ""}>Keyword refresh ${m2Cost(kref)}</button></div>
      <div class="vmstock">${r.shelf.length ? r.shelf.map((id) => {
        const g = m2G(id), p = m2Price(g.price, "buy_off");
        const part = (m2.cat.recipes || []).some((x) => x.of.includes(id) && x.of.some((o) => own.has(o)));
        return `<div class="card vmitem">${m2Gift(id, 1)}<div class="vmgname">${esc(g.name)}</div><div class="vmsmall">${g.econ ? "Economy" : `${m2KwIco(g.kw, "s16")} ${esc(m2KwName(g.kw))}`}${part ? ` · <span class="good">recipe part</span>` : ""}</div>
          <div class="vmeff">${m2Eff(id)}</div><button data-act="buy" data-arg="${id}" ${r.cost < p || own.has(id) || full ? "disabled" : ""} title="${full ? "All gift slots are full: sell one first" : ""}">${m2Cost(p)}</button></div>`;
      }).join("") : `<div class="muted">Sold out — refresh for more.</div>`}</div>
      <div class="vmbar"><span class="vmlbl">Your gifts · ${r.build.length} / ${r.slots} slots</span><span class="grow"></span>
        ${sel ? `${m2G(sel.id).econ || sel.fused ? "" : `<button data-act="enhance" data-arg="${sel.id}" ${!enh || r.cost < enh ? "disabled" : ""}>${sel.level >= 3 ? "Enhanced ++" : `Enhance to ${m2Lvl(sel.level + 1)} ${m2Cost(enh)}`}</button>`}
        <button data-act="sell" data-arg="${sel.id}">Sell ${m2Cost("+" + Math.floor(m2G(sel.id).price / 2))}</button>` : `<span class="muted small">Click a gift to enhance or sell it</span>`}</div>
      <div class="card vmowned">${slots.map((b) => b ? `<button class="vmown ${b.id === m2.sel ? "on" : ""}" data-sel="${b.id}">${m2Gift(b.id, b.level)}</button>` : `<div class="m2slot"></div>`).join("")}
        ${sel ? `<div class="vmseldesc"><b>${esc(m2G(sel.id).name)}${m2Lvl(sel.level)}${sel.fused ? " · fused" : ""}</b>${m2Eff(sel.id, sel.level)}${sel.level < 3 && !m2G(sel.id).econ ? `<div class="vmsmall">At ${m2Lvl(sel.level + 1)}: ${(m2G(sel.id).eff[sel.level] || []).map(esc).join(" · ")}</div>` : ""}</div>` : ""}</div>
      ${m2Recipes()}
    </div>
    <div class="vmright"><div class="card"><div class="vmlbl">Next</div><div class="vmname">Floor ${r.floor + 1}${r.floor + 1 === R.floors ? " · final boss" : ""}</div>
      <div class="vmsmall">Three packs: each shows its keyword, its boss and the gifts it pays out.</div>
      <button class="primary" data-act="leave">Pick the floor ›</button></div>${m2Fought()}</div></div>
    <div class="vmrow"><button id="m2quit">Give up</button></div>`;
}

function m2Fought() {
  const fs = m2.run.fights || [];
  if (!fs.length) return "";
  return `<div class="card"><div class="vmlbl">Cleared</div>${fs.map((f) => {
    const p = m2Pack(f.pack);
    return `<div class="vmfought">${m2Face(f.boss, "s44")}<div><b>${esc(p ? p.name : "")}</b><div class="vmsmall">Floor ${f.floor + 1} · ${f.winner === 0 ? "won" : "lost"} · ${Math.floor(f.seconds / 60)}:${String(f.seconds % 60).padStart(2, "0")} · HP ${f.hp[0]} / ${f.hpMax[0]}</div></div></div>`;
  }).join("")}</div>`;
}

function m2Packs() {
  const r = m2.run;
  return `<span class="vmkick">Floor ${r.floor + 1} of ${m2.cat.rules.floors} · HP ${r.hpMax}</span><h1>${r.floor + 1 === m2.cat.rules.floors ? "Pick the final boss" : "Pick a pack"}</h1>
    <div class="sub">The pack's keyword is where it takes your build: its reward gift (at the bottom) is of it. The boss is one of those in the corner. Hard packs: a stronger boss, more Cost.</div>
    <div class="vmgrid">${r.offer.map((o, i) => {
      const p = m2Pack(o.pack) || {}, bs = o.bosses || [o.boss], ns = o.names || [o.name || o.boss], g = o.final ? null : o.reward[0];
      return `<div class="card vmcard"><div class="vmstage vmpack">${p.pic ? `<img src="${imgThumb(p.pic)}" alt="">` : ""}${o.hard ? `<span class="vmtag">Hard</span>` : ""}${o.final ? `<span class="vmtag m2final">Final</span>` : ""}
          <div class="m2corner ${o.final ? "low" : ""}">${bs.map((b, k) => `<span title="${esc(ns[k] || b)}">${m2Face(b, bs.length > 3 ? "s44" : "big")}</span>`).join("")}</div>
          ${g ? `<div class="m2rwc" title="${esc(m2G(g).name + ": " + (m2G(g).eff[0] || []).join(" · "))}">${m2Gift(g, 1)}</div>` : ""}</div>
        <div><div class="vmname">${esc(p.name || "")}</div><div class="vmsmall">${bs.length > 1 ? `Boss: one of ${bs.length}` : esc(ns[0] || "")}</div></div>
        <div class="vminfo"><span class="vmlbl">Goal</span><span>${o.kw ? `${m2KwIco(o.kw, "s20")} ${esc(m2KwName(o.kw))}` : "General"}</span>
          <span class="vmlbl">Boss</span><span>HP ${o.hpMax}${o.power ? ` · +${o.power} power` : ""}${(o.bossSt || []).map((t) => `<br>${esc(t)}`).join("")}</span>
          ${o.final ? `<span class="vmlbl">Win</span><span>the run is cleared</span></div>` : `<span class="vmlbl">Cost</span><span>${m2Cost("+" + o.cost)}</span>
          <span class="vmlbl">Reward</span><span>${g ? esc(m2G(g).name) : "—"}</span></div>`}
        <button class="primary" data-act="pack" data-arg="${i}">${o.final ? "Fight the final boss ›" : "Take this pack ›"}</button></div>`;
    }).join("")}</div>`;
}

function m2Boss() {
  const r = m2.run, o = r.at || {};
  return `<span class="vmkick">${esc((m2Pack(r.pack.id) || {}).name || "")}</span><h1>Floor ${r.floor + 1} boss</h1>
    <div class="card vmvs"><div class="vmfighter">${m2IdPic(r.id)}<div class="vmname">${esc(m2IdName(r.id))}</div><div class="vmhp">HP <b>${r.hpMax}</b>${r.shield ? ` · <span class="vmsh">Shield ${r.shield}</span>` : ""}</div></div>
      <div class="vmversus">VS</div>
      <div class="vmfighter">${m2Face(r.boss, "huge")}<div class="vmname">${esc(o.name || r.boss)}</div><div class="vmhp">HP <b>${o.hpMax || "?"}</b>${o.power ? ` · +${o.power} power` : ""}${o.hard ? " · Hard" : ""}</div></div></div>
    <div class="vmrow"><button class="primary" id="m2live" title="Played in the player's own window as it happens">Watch the fight ›</button>
      <button data-act="fight" title="The same fight, without watching it">Result now ›</button><span id="m2livenote" class="muted"></span></div>
    <div class="vmside2">${m2Side()}${m2Fought()}</div>`;
}
async function m2Live() {
  const r = m2.run;
  const rnd = (n, k) => (n ? (r.seed * 13 + r.floor * 7 + k) % n : 0);
  if (!vs.maps) vs.maps = await api("/api/battle_maps").catch(() => []);
  if (!vs.bgm) vs.bgm = await api("/api/bgm_tracks").catch(() => []);
  const spec = { live: true, mirror: r, mode: "clash", hp: true, death: true, intro: true, deck: true, spread: true, randskill: true,
    lname: m2IdName(r.id), rname: (r.at || {}).name || "" };
  if (vs.maps.length) spec.map = vs.maps[rnd(vs.maps.length, 1)];
  if (vs.bgm.length) spec.music = vs.bgm[rnd(vs.bgm.length, 2)].name;
  try { await api("/api/versus", spec); } catch (e) { toast(esc(e.message)); return; }
  m2.live = { seed: r.seed, floor: r.floor };
  m2LiveWatch();
}
async function m2LiveWatch() {
  clearTimeout(m2LiveWatch.timer);
  const note = $("#m2livenote");
  if (!note) return;
  let st;
  try { st = await api("/api/versus_live"); } catch (e) { m2LiveWatch.timer = setTimeout(m2LiveWatch, 2000); return; }
  const busy = ["preparing", "loading", "playing"].includes(st.state);
  const mine = m2.live && m2.run && m2.live.seed === m2.run.seed && m2.live.floor === m2.run.floor;
  if ($("#m2live")) $("#m2live").disabled = busy;
  if (busy) note.textContent = st.msg || "";
  else if (st.state === "error" && mine) note.innerHTML = `<span class="bad">${esc(st.msg || "failed")}</span>`;
  else if (st.state === "done" && mine && m2.run.phase === "boss" && !m2.busy) { m2.live = null; m2Act("fight"); return; }
  if (busy) m2LiveWatch.timer = setTimeout(m2LiveWatch, 1000);
}

function m2FightBox(f) {
  if (!f) return "";
  const t = `${Math.floor(f.seconds / 60)}:${String(f.seconds % 60).padStart(2, "0")}`;
  const row = (k, a, b) => `<span>${k}</span><b>${a}</b><b>${b}</b>`;
  const s = f.side, k = f.kit || {}, inc = f.income;
  const kit = [k.phases > 1 ? `phase ${k.phases} reached` : "", k.counters ? `${k.counters} counters` : "", k.blockTremor ? `${k.blockTremor} Tremor from blocks` : "",
    k.shots ? `${k.shots} bonus shots` : "", k.reloads ? `${k.reloads} reloads` : "", k.stones ? `${k.stones}× stone` : ""].filter((x) => x);
  return `<div class="card vmfight"><div class="vmlbl">Floor ${f.floor + 1} · ${f.winner === 0 ? "won" : "lost"} · ~${t} · ${f.clashes} clash rounds</div>
    <div class="vmtable"><span></span><b class="muted">You</b><b class="muted">Boss</b>
      ${row("HP left", `${f.hp[0]} / ${f.hpMax[0]}`, `${f.hp[1]} / ${f.hpMax[1]}`)}${row("Clash rounds won", s[0].clashes, s[1].clashes)}
      ${row("Skills landed", s[0].landed, s[1].landed)}${row("Damage by hits", s[0].hits, s[1].hits)}
      ${row("Damage by statuses", s[0].status, s[1].status)}${row("Healed", s[0].heal, s[1].heal)}</div>
    ${kit.length ? `<div class="vmsmall">Kit: ${kit.map(esc).join(" · ")}</div>` : ""}
    ${inc ? `<div class="vmsmall gold">Cost: +${inc.boss} boss${inc.interest ? ` · +${inc.interest} interest` : ""}${inc.gifts ? ` · +${inc.gifts} gifts` : ""}${inc.urn ? ` · +${inc.urn} urn (broke)` : ""}</div>` : ""}</div>`;
}

function m2Reward() {
  const r = m2.run, full = r.build.length >= r.slots;
  return `<div class="vmcenter"><span class="vmkick good">Floor ${r.floor} down</span><h1>${r.offer.length > 1 ? "Take one gift" : "Pack reward"}</h1>
    <div class="sub">${full ? "Your gift slots are full — skip it, or take it after selling in the next shop (it is gone then)." : "The pack's reward. One more gift slot opened."}</div></div>
    <div class="vmgrid">${r.offer.map((id) => {
      const g = m2G(id);
      return `<div class="card vmcard vmrew">${m2Gift(id, 1)}<div class="vmname">${esc(g.name)}</div><div class="vmsmall">${m2KwIco(g.kw, "s16")} ${esc(m2KwName(g.kw))}</div>
        <div class="vmeff">${m2Eff(id)}</div><button class="primary" data-act="reward" data-arg="${id}" ${full ? "disabled" : ""}>Take ›</button></div>`;
    }).join("")}</div>
    <div class="vmrow vmcenter"><button data-act="reward">Take nothing</button></div>${m2FightBox(m2.fight)}`;
}

function m2End() {
  const r = m2.run, fs = r.fights || [], secs = fs.reduce((a, f) => a + f.seconds, 0);
  const st = [[`${fs.filter((f) => f.winner === 0).length} / ${m2.cat.rules.floors}`, "Floors"], [r.build.length, "Gifts"], [r.cost, "Cost left"],
    [`${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`, "Fighting"]];
  return `<span class="vmkick">Run result</span><h1>${r.won ? "Run cleared" : "Run lost"}</h1>
    <div class="card vmstats">${st.map(([v, k]) => `<div><b>${v}</b><span>${k}</span></div>`).join("")}</div>
    <div class="vmshop2">${m2Side()}<div><div class="card vmowned">${r.build.map((b) => m2Gift(b.id, b.level)).join("")}</div>${fs.map(m2FightBox).join("")}</div></div>
    <div class="vmrow"><button class="primary" data-act="new">New run ›</button>${m2BossStBox()}</div>`;
}

// (styles of what v1's .vm* classes don't have)
document.head.insertAdjacentHTML("beforeend", `<style>
.m2face { display: inline-flex; width: 64px; height: 64px; border-radius: 50%; overflow: hidden; flex-shrink: 0; background: #0a0605; border: 2px solid #5d3f25; box-shadow: 0 0 10px #000; }
.m2face img { width: 100%; height: 100%; object-fit: cover; object-position: 50% 25%; }
.m2face.s44 { width: 44px; height: 44px; }
.m2corner { position: absolute; right: 10px; top: 10px; display: flex; flex-direction: column; align-items: center; gap: 6px; }
.m2corner.low { top: 44px; }
.m2corner > span { display: inline-flex; }
.m2rwc { position: absolute; left: 50%; bottom: 10px; transform: translateX(-50%); box-shadow: 0 0 14px #000; }
.m2face.big { width: 64px; height: 64px; border-width: 2px; border-color: var(--gold); }
.m2face.huge { width: 200px; height: 200px; border-width: 3px; border-color: var(--gold); }
.vmfought .m2face img { width: 100%; height: 100%; border: 0; }
.m2 .vmtag.m2final { left: auto; right: 0; top: 10px; background: #ff4b3a; color: #fff; clip-path: polygon(10px 0, 100% 0, 100% 100%, 0 100%); padding: 3px 10px 2px 22px; }
.m2kit { font-size: 13px; line-height: 1.45; display: flex; flex-direction: column; gap: 2px; }
.m2kit .good { color: #8fd18a; }
.m2words { font-style: italic; color: var(--cream); margin-bottom: 4px; }
.m2slot { width: 72px; height: 72px; border: 1px dashed #5d3f25; opacity: .6; }
.m2rec { display: flex; flex-direction: column; gap: 8px; }
.m2recrow { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.m2recof { display: flex; align-items: center; gap: 2px; }
.m2recof .vmgi { width: 48px; height: 48px; }
.m2miss { opacity: .35; }
.m2arrow { font-size: 22px; color: var(--gold); }
</style>`);
