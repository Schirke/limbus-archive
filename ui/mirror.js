"use strict";
// Tools → Mirror Dungeon planner: pick gifts, get packs and floors (/api/mirror); build kept in localStorage.
let MIRROR = null;
const MP_KEEP = "mirror";
const MP_MODES = [["Normal", 5, "0"], ["Hard", 5, "1"], ["Hard", 10, "2"], ["Hard", 15, "3"]];  // (name, floors, the game's typeIndex)
const mp = { mode: 1, cap: 4, q: "", kw: "", only: "", sort: "kw", want: new Set(), lock: {}, open: -1, tab: "g", start: [], picks: 1 };
// a keyword chip's picture: the status icon, or the damage type's for Hit / Penetrate / Slash (the name on hover)
const MP_ATK = { Hit: "Blunt", Penetrate: "Pierce", Slash: "Slash" };
const mpKwIco = (k) => (MP_ATK[k] ? ico(`atk_${MP_ATK[k]}`, "s22", mpKw(k), mpKw(k)) : ico(`st_${k}`, "s22", mpKw(k), mpKw(k)));
// the game's gift search order: sins' statuses, then damage types
const MP_KW_ORDER = ["Combustion", "Laceration", "Vibration", "Burst", "Sinking", "Breath", "Charge", "Slash", "Penetrate", "Hit"];
const mpKwRank = (k) => { const i = MP_KW_ORDER.indexOf(k); return i < 0 ? 50 : i; };
const mpKwCmp = (a, b) => (!a - !b) || mpKwRank(a) - mpKwRank(b) || mpKw(a).localeCompare(mpKw(b));
(() => { try { const s = JSON.parse(localStorage.getItem(MP_KEEP) || "{}"); Object.assign(mp, { mode: s.mode ?? 1, cap: s.cap ?? 4, sort: s.sort || "kw", lock: s.lock || {}, start: s.start || [], picks: s.picks || 1 }); mp.want = new Set(s.want || []); } catch { /* a fresh build */ } })();
const mpSave = () => { try { localStorage.setItem(MP_KEEP, JSON.stringify({ mode: mp.mode, cap: mp.cap, sort: mp.sort, lock: mp.lock, want: [...mp.want], start: mp.start, picks: mp.picks })); } catch { /* not kept */ } };
const mpG = (id) => MIRROR.gifts[id] || { name: "Gift " + id, tile: "", kw: "", tier: 0, desc: "" };
const mpGi = (id, cls = "", info = true) => (mpG(id).tile ? `<img class="mpgi ${cls}" data-g="${id}" ${info ? "data-info" : ""} src="${mpG(id).tile}" loading="lazy">` : `<i class="mpgi ${cls}" data-g="${id}" ${info ? "data-info" : ""}></i>`);
const MP_TAP = matchMedia("(hover: none)").matches;  // phones: a tap on a picker tile opens the gift's card
const mpKw = (k) => MP_ATK[k] || ((UNITS.glossary || {})[k] || {}).name || statusName(k);
// which floor list of a pack a floor reads
const mpSpec = (f) => (mp.mode === 0 ? ["0", f] : f < 5 ? ["1", f] : f < 10 ? ["2", -1] : ["3", -1]);
const mpAllowed = (p, f) => { const [d, lf] = mpSpec(f), fl = p.floors[d]; return !!fl && (lf < 0 || fl.includes(lf)); };
const mpFloor = (f) => (f < 5 ? "Floor " + (f + 1) : f < 10 ? "Floors 6–10" : "Floors 11–15");

async function mpLoad() {
  if (MIRROR) return MIRROR;
  const [m] = await Promise.all([api("/api/mirror"), units()]);
  m.excl = new Set(m.packs.flatMap((p) => p.excl));
  // gifts of floors 11-15 only: extreme packs' own gifts and the hidden fight there
  const deep = (p) => Object.keys(p.floors).every((d) => d === "3");
  m.deep = new Set(Object.keys(m.gifts).map(Number).filter((g) => (m.gifts[g].min || 0) >= 10 || (m.excl.has(g) && m.packs.filter((p) => p.excl.includes(g)).every(deep))));
  for (const g of [...mp.want]) if (!m.gifts[g]) mp.want.delete(g);
  mp.start = mp.start.filter((g) => m.gifts[g]);
  return (MIRROR = m);
}
routes.mirror = async () => {
  const main = $("#main");
  if (!MIRROR) main.innerHTML = `<h1>Mirror Dungeon planner</h1><div class="muted">Reading the game's files…</div>`;
  try { await Promise.all([mpLoad(), myTeam().catch(() => {})]); } catch (e) { main.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  if (!location.hash.startsWith("#/mirror")) return;
  if (!MIRROR.packs.length) { MIRROR = null; main.innerHTML = `<h1>Mirror Dungeon planner</h1><div class="empty">Take a snapshot first — the packs and gifts are read from it.</div>`; return; }
  if (!MIRROR.modes[MP_MODES[mp.mode][2]]) mp.mode = 1;
  mpDraw();
};

// Route for the picked gifts: at most `cap` gifts per pack visit, packs added by gain while they all find floors.
function mpPlan() {
  const N = MP_MODES[mp.mode][1], floors = [...Array(N).keys()], packs = MIRROR.packs.filter((p) => floors.some((f) => mpAllowed(p, f)));
  const need = new Set(), fus = [];
  const add = (id) => { if (need.has(id) || mp.start.includes(id)) return; need.add(id); const r = MIRROR.fus[id]; if (r) { fus.push([id, r[0]]); r[0].forEach(add); } };
  mp.want.forEach(add);
  const raw = [...need].filter((g) => !MIRROR.fus[g] && !mpG(g).how);
  const only = new Set(raw.filter((g) => packs.some((p) => p.excl.includes(g))));
  const nowhere = raw.filter((g) => !packs.some((p) => p.excl.includes(g) || p.pool.includes(g)));
  const gives = (p) => raw.filter((g) => (only.has(g) ? p.excl.includes(g) : p.pool.includes(g)));
  const rare = Object.fromEntries(raw.map((g) => [g, packs.filter((p) => gives(p).includes(g)).length]));
  const take = (p, got) => gives(p).filter((g) => !got.has(g)).sort((a, b) => only.has(b) - only.has(a) || rare[a] - rare[b]).slice(0, mp.cap || 99);
  const gain = (p, got) => take(p, got).reduce((s, g) => s + (only.has(g) ? 100 : 1), 0);
  const got = new Set(), used = new Set(), mine = new Map(), pinned = {};
  for (const [f, id] of Object.entries(mp.lock)) { const p = packs.find((x) => x.id === id); if (p && +f < N && mpAllowed(p, +f) && !Object.values(pinned).includes(p)) pinned[f] = p; else delete mp.lock[f]; }
  // seat packs on allowed floors (augmenting paths); null if they don't fit
  const seat = (list) => {
    const at = Array(N).fill(null);
    for (const [f, p] of Object.entries(pinned)) at[f] = p;
    const tryPut = (p, seen) => {
      for (const f of floors) {
        if (!mpAllowed(p, f) || seen.has(f) || pinned[f]) continue;
        seen.add(f);
        if (!at[f] || tryPut(at[f], seen)) { at[f] = p; return true; }
      }
      return false;
    };
    for (const p of list) if (!Object.values(pinned).includes(p) && !tryPut(p, new Set())) return null;
    return at;
  };
  const accept = (p) => { used.add(p); mine.set(p, take(p, got)); mine.get(p).forEach((g) => got.add(g)); };
  Object.values(pinned).forEach(accept);
  let seats = seat([]);
  for (const skip = new Set(); ;) {
    let best = null;
    for (const x of packs) { if (used.has(x) || skip.has(x)) continue; const v = gain(x, got); if (v > 0 && (!best || v > best.v)) best = { p: x, v }; }
    if (!best) break;
    const s = seat([...used, best.p]);
    if (s) { seats = s; accept(best.p); } else skip.add(best.p);
  }
  const src = {}, none = new Set();
  const rows = seats.map((p, f) => {
    const cands = packs.filter((x) => mpAllowed(x, f) && gives(x).length).sort((a, b) => (b === p) - (a === p) || gain(b, none) - gain(a, none)).slice(0, 10);
    if (!p) return { f, p: null, take: [], extra: [], cands };
    const t = mine.get(p);
    t.forEach((g) => (src[g] = { f, p, only: only.has(g) }));
    return { f, p, take: t, extra: gives(p).filter((g) => !t.includes(g)), cands, lock: mp.lock[f] === p.id };
  });
  // gifts left to luck
  for (const x of rows) for (const g of x.extra) if (!src[g]) src[g] = { f: x.f, p: x.p, only: only.has(g), luck: only.has(g) };
  return { N, packs, rows, raw, only, fus, nowhere, src, gives, missed: raw.filter((g) => !src[g] && !nowhere.includes(g)) };
}

function mpPicker() {
  const N = MP_MODES[mp.mode][1], avail = new Set(MIRROR.packs.filter((p) => [...Array(N).keys()].some((f) => mpAllowed(p, f))).flatMap((p) => [...p.pool, ...p.excl]).concat(Object.keys(MIRROR.fus).map(Number))
    .concat(Object.keys(MIRROR.gifts).filter((g) => MIRROR.gifts[g].how && (MIRROR.gifts[g].min || 0) < N).map(Number)));
  const all = Object.entries(MIRROR.gifts).filter(([id]) => avail.has(+id));
  const kws = [...new Set(all.map(([, g]) => g.kw).filter(Boolean))].sort(mpKwCmp);
  const q = mp.q.trim().toLowerCase();
  const list = all.filter(([id, g]) => (!mp.kw || g.kw === mp.kw || (mp.kw === "-" && !g.kw)) && (!q || g.name.toLowerCase().includes(q)) && (mp.only !== "fuse" || MIRROR.fus[id])
    && (mp.only !== "pack" || MIRROR.excl.has(+id)) && (mp.only !== "deep" || MIRROR.deep.has(+id)));
  const key = { kw: (g) => String(9 - g.tier) + g.name, tier: (g) => String(9 - g.tier) + g.name, name: (g) => g.name }[mp.sort];
  list.sort((a, b) => (mp.sort === "kw" && mpKwCmp(a[1].kw, b[1].kw)) || key(a[1]).localeCompare(key(b[1])));
  const tg = (on, attr, label, cls = "") => `<button class="toggle ${cls} ${on ? "on" : ""}" ${attr}>${label}</button>`;
  return `<div class="card mpcard"><input type="text" id="mpq" placeholder="Search a gift…" value="${esc(mp.q)}">
    <div class="mpchips">${tg(!mp.only, 'data-o=""', "All gifts")}${tg(mp.only === "fuse", 'data-o="fuse"', "Fusion · " + all.filter(([id]) => MIRROR.fus[id]).length, "fz")}${tg(mp.only === "pack", 'data-o="pack"', "Pack-only")}${N > 10 ? tg(mp.only === "deep", 'data-o="deep" title="Gifts found on floors 11–15 only"', "Floors 11–15") : ""}</div>
    <div class="mpchips">${tg(!mp.kw, 'data-k=""', "Any")}${kws.map((k) => tg(mp.kw === k, `data-k="${esc(k)}" title="${esc(mpKw(k))}"`, mpKwIco(k), "kwi")).join("")}${tg(mp.kw === "-", 'data-k="-" title="Gifts without a keyword"', "No keyword")}</div>
    <div class="mpchips"><select id="mpsort">${[["kw", "Keyword"], ["tier", "Tier"], ["name", "Name"]].map(([k, l]) => `<option value="${k}" ${mp.sort === k ? "selected" : ""}>Sort: ${l}</option>`).join("")}</select><span class="grow"></span><span class="muted small">${list.length} gifts</span></div>
    <div class="mpgifts">${list.map(([id, g]) => `<div class="mpgift ${MIRROR.excl.has(+id) ? "ex" : ""} ${mp.want.has(+id) ? "on" : ""} ${mp.start.includes(+id) ? "st" : ""}" data-g="${id}" data-pick>${g.tile ? `<img src="${g.tile}" loading="lazy">` : ""}${g.tier ? `<u>${ROMAN[g.tier - 1] || g.tier}</u>` : ""}${g.up ? `<em>${"+".repeat(g.up.length)}</em>` : ""}${MIRROR.fus[id] ? "<s>FUSE</s>" : ""}${mp.start.includes(+id) ? "<i>START</i>" : ""}</div>`).join("")}</div></div>`;
}

function mpBuild(r) {
  const line = (g) => {
    const s = r.src[g];
    if (mp.start.includes(g)) return '<small class="ok">Starting gift — owned from the start, no floor needed</small>';
    if (mpG(g).how) return `<small class="luck">${esc(mpG(g).how)}</small>`;
    if (s && s.luck) return `<small class="luck">${mpFloor(s.f)} · ${esc(s.p.name)} — over ${mp.cap} from one pack, needs luck</small>`;
    if (s) return `<small class="${s.only ? "gold" : "ok"}">${mpFloor(s.f)} · ${esc(s.p.name)}${s.only ? " — only there" : ""}</small>`;
    if (r.nowhere.includes(g)) return '<small class="bad">⚠ in no pack of this mode</small>';
    return `<small class="bad">⚠ no free floor — ${r.packs.filter((p) => r.gives(p).includes(g)).slice(0, 3).map((p) => esc(p.name)).join(", ")}</small>`;
  };
  const item = (g) => { const f = r.fus.find(([res]) => res === g); return `<div class="mpck">${mpGi(g)}<div><b data-g="${g}" data-info>${esc(mpG(g).name)}</b>${f ? `<small class="fz">Fusion of ${f[1].length} gifts</small>` : line(g)}${mdTeamLine(g)}</div>
      ${f ? `<div class="parts">${f[1].map((p) => `<div>${mpGi(p)}<span><a data-g="${p}" data-info>${esc(mpG(p).name)}</a><br>${MIRROR.fus[p] ? '<small class="fz">a fusion itself — below</small>' : line(p)}</span></div>`).join("")}</div>` : ""}</div>`; };
  const extra = r.fus.map(([res]) => res).filter((g) => !mp.want.has(g));
  const start = mp.start.map((g) => `<div class="mpck mpstart">${mpGi(g)}<div><b data-g="${g}" data-info>${esc(mpG(g).name)}</b><span class="mptag">START</span>${line(g)}</div></div>`).join("");
  return `<div class="card mpcard"><div class="row"><span class="mpcap">Your build<small>${mp.want.size} gifts</small></span><span class="grow"></span>${mp.want.size ? "<button data-clear>Clear all</button>" : ""}</div>
    ${start}${[...mp.want, ...extra].filter((g) => !mp.start.includes(g)).map(item).join("") || (start ? "" : '<div class="muted" style="margin:12px 0 4px">Pick gifts on the left — click one again to drop it.</div>')}</div>`;
}

function mpRoute(r) {
  const luck = (x) => x.extra.filter((g) => r.src[g] && r.src[g].luck && r.src[g].f === x.f);
  const icons = (x) => x.take.map((g) => mpGi(g, r.only.has(g) ? "only" : "")).join("") + x.extra.map((g) => mpGi(g, luck(x).includes(g) ? "luck" : "dim")).join("");
  const pk = (p, cls) => (p.tile ? `<img class="${cls}" src="${p.tile}" loading="lazy">` : `<i class="${cls}"></i>`);
  const lane = (x) => `<div class="mplane">${x.cands.map((p) => { const gs = r.gives(p); return `<div class="mpbc ${p === x.p ? "sel" : ""}" data-pin="${x.f}:${p.id}" title="${p === x.p && x.lock ? "Pinned — click to let go" : "Pin this pack to the floor"}">${pk(p, "pk")}<span class="cnt">${gs.length} of yours</span>
      <div class="pn">${esc(p.name)}</div><div class="mpmini">${gs.slice(0, 10).map((g) => mpGi(g, r.only.has(g) ? "only" : "", false)).join("")}</div></div>`; }).join("")}</div>`;
  const arr = (x) => `<span class="arr">${mp.open === x.f ? "▴" : "▾"}</span>`;
  const row = (x, n, wide) => { const lk = luck(x), more = x.extra.length - lk.length; return `<div class="mprow ${x.take.some((g) => r.only.has(g)) ? "hit" : ""}" data-open="${x.f}"><div class="n ${wide ? "wide" : ""}">${n}</div>${pk(x.p, "pk")}
      <div><span class="nm">${esc(x.p.name)}</span>${x.lock ? '<span class="pin">PINNED</span>' : ""}<small>${x.take.length} planned${more ? ` · ${more} more can drop` : ""}</small>
        ${lk.length ? `<small class="lk"><b>!</b> ${lk.length} more pack-only gift${lk.length > 1 ? "s" : ""} over the limit of ${mp.cap} — needs luck</small>` : ""}</div>
      <div class="mpmini">${icons(x)}</div>${arr(x)}</div>${mp.open === x.f ? lane(x) : ""}`; };
  const free = (n, text) => `<div class="mprow free"><div class="n ${String(n).length > 2 ? "wide" : ""}">${n}</div><div>${text}</div></div>`;
  let html = '<div class="mpzone mpcap">Floors 1–5<small>each pack has its own floors</small></div>';
  for (const x of r.rows.slice(0, 5)) html += x.p ? row(x, x.f + 1) : x.cands.length
    ? `<div class="mprow any" data-open="${x.f}"><div class="n">${x.f + 1}</div><div>Any pack<small>nothing you picked is tied to this floor</small></div>${arr(x)}</div>${mp.open === x.f ? lane(x) : ""}`
    : free(x.f + 1, "Any pack<small>nothing you picked is tied to this floor</small>");
  for (const [from, range, note] of [[5, "6–10", "one pool, any order"], [10, "11–15", "extreme packs, any order"]]) {
    if (from >= r.N) continue;
    const on = r.rows.slice(from, from + 5).filter((x) => x.p), left = 5 - on.length;
    html += `<div class="mpzone mpcap">Floors ${range}<small>${note}</small></div>` + on.map((x) => row(x, range, true)).join("")
      + (left ? free(on.length ? "+" + left : range, on.length ? `${left} more floor${left > 1 ? "s" : ""} — any packs` : "Nothing you picked needs these floors — take any packs") : "");
  }
  return html + r.missed.map((g) => `<div class="mpwarn">⚠ ${esc(mpG(g).name)} doesn't fit: the floors of its packs are taken.</div>`).join("")
    + r.nowhere.map((g) => `<div class="mpwarn">⚠ ${esc(mpG(g).name)} is in no pack of this mode (events or another mode).</div>`).join("");
}

function mpDraw() {
  const r = mpPlan(), main = $("#main"), top = ($(".mpgifts") || {}).scrollTop || 0;
  mpSave();
  main.innerHTML = `<div id="mppage"><h1>Mirror Dungeon planner</h1><div class="sub">Pick the E.G.O gifts you want — the planner says which theme packs to take and on which floors. Gold frame: a gift found in certain packs only.</div>
    <div class="mpbar"><div class="seg">${MP_MODES.map(([n, f, t], i) => (MIRROR.modes[t] ? `<button data-m="${i}" class="toggle ${mp.mode === i ? "on" : ""}">${n} · ${f} floors</button>` : "")).join("")}</div>
      <span><label>Gifts counted from one pack</label><span class="seg">${[2, 3, 4, 0].map((c) => `<button data-c="${c}" class="toggle ${mp.cap === c ? "on" : ""}">${c || "All"}</button>`).join("")}</span></span>
      ${(MIRROR.start || {}).pools && MIRROR.start.pools.length ? `<span class="mpstartb"><label>Starting gift</label><button class="toggle ${mp.start.length ? "on" : ""}" data-start>${mp.start.length
        ? mp.start.map((g) => (mpG(g).tile ? `<img src="${mpG(g).tile}" alt="">` : "")).join("") + (mp.start.length === 1 ? `<span>${esc(mpG(mp.start[0]).name)}</span>` : "") : "Choose…"}</button></span>` : ""}</div>
    <div class="mptabs">${[["g", "Gifts"], ["b", `Build${mp.want.size ? ` · ${mp.want.size}` : ""}`], ["f", "Floors"]].map(([k, t]) => `<button class="toggle ${mp.tab === k ? "on" : ""}" data-tab="${k}">${t}</button>`).join("")}</div>
    <div class="mpcols" data-tab="${mp.tab}">${mpPicker()}${mpBuild(r)}<div>${mpRoute(r)}</div></div>
    ${mp.want.size && mp.tab !== "f" ? `<button class="mpstrip" data-tab="f"><b>${mp.want.size}</b> in the build <span>Route ›</span></button>` : ""}</div>`;
  $(".mpgifts").scrollTop = top;
  const page = $("#mppage");
  page.onclick = (e) => {
    const t = e.target.closest("[data-info],[data-m],[data-c],[data-k],[data-o],[data-s],[data-pick],[data-pin],[data-open],[data-clear],[data-start],button[data-tab]");
    if (!t) return;
    const d = t.dataset;
    if ("info" in d || ("pick" in d && MP_TAP)) { mpTip(null); return mpCard(+d.g); }
    if ("start" in d) { mpTip(null); return mpStart(); }
    if (d.m) { mp.mode = +d.m; mp.lock = {}; mp.open = -1; if (mp.only === "deep" && MP_MODES[mp.mode][1] < 11) mp.only = ""; }
    else if (d.c) mp.cap = +d.c;
    else if ("k" in d) mp.kw = d.k;
    else if ("o" in d) mp.only = d.o;
    else if (d.s) mp.sort = d.s;
    else if ("pick" in d) { const g = +d.g; if (mp.want.has(g)) mp.want.delete(g); else mp.want.add(g); }
    else if ("clear" in d) { mp.want.clear(); mp.lock = {}; mp.open = -1; }
    else if (d.pin) { const [f, id] = d.pin.split(":").map(Number); if (mp.lock[f] === id) delete mp.lock[f]; else { for (const k in mp.lock) if (mp.lock[k] === id) delete mp.lock[k]; mp.lock[f] = id; } }
    else if (d.open) mp.open = mp.open === +d.open ? -1 : +d.open;
    else if (d.tab) { mp.tab = d.tab; $("#main").scrollTop = 0; }
    mpTip(null);
    mpDraw();
  };
  $("#mpsort").onchange = (e) => { mp.sort = e.target.value; mpDraw(); };
  $("#mpq").oninput = (e) => { mp.q = e.target.value; mpDraw(); const q = $("#mpq"); q.focus(); q.setSelectionRange(q.value.length, q.value.length); };
  page.oncontextmenu = (e) => { const g = e.target.closest("[data-pick]"); if (g) { e.preventDefault(); mpTip(null); mpCard(+g.dataset.g); } };
  page.onmousemove = (e) => mpTip(e.target.closest("[data-g]"), e);
  page.onmouseleave = () => mpTip(null);
}

// the game's "Starting E.G.O Gift Choice": a category, then 1 of its gifts (+1 for each Starlight bonus)
function mpStart() {
  const S = MIRROR.start, max = 1 + S.bonus.length;
  let kw = (S.pools.find(([, p]) => p.includes(mp.start[0])) || S.pools[0])[0], sel = [...mp.start], picks = Math.min(mp.picks, max);
  const draw = () => {
    const pool = S.pools.find(([k]) => k === kw)[1];
    modal(`<div class="mpsx"><h2>Starting E.G.O Gift</h2><div class="muted small">As in the game: a category, then gifts of it. The planner counts them as owned: no floor is spent on them.</div>
      <div class="mpskws">${S.pools.map(([k]) => `<button class="toggle ${k === kw ? "on" : ""}" data-skw="${esc(k)}">${mpKwIco(k)}${esc(mpKw(k))}</button>`).join("")}</div>
      <div class="mpsgifts">${pool.map((g) => { const on = sel.includes(g); return `<div class="mpsgift ${on ? "on" : ""} ${!on && picks > 1 && sel.length >= picks ? "off" : ""}" data-sg="${g}">${on ? "<i>✓</i>" : ""}
        <div class="mpsh">${mpG(g).tile ? `<img src="${mpG(g).tile}" alt="">` : ""}<div><b>${esc(mpG(g).name)}</b><div class="muted small">${mpG(g).tier ? "Tier " + mpG(g).tier : ""}</div></div></div><div class="mpsd">${fmtDesc(mpG(g).desc)}</div></div>`; }).join("")}</div>
      ${max > 1 ? `<div class="mpspicks"><label>Gifts to choose</label><span class="seg">${[...Array(max).keys()].map((i) => `<button class="toggle ${picks === i + 1 ? "on" : ""}" data-spk="${i + 1}">${i + 1}</button>`).join("")}</span>
        <small class="muted">${S.bonus.map((b) => `<span>+1 · ${esc(b.name)}</span>`).join("")}</small></div>` : ""}
      <div class="mpsfoot"><button data-snone>No starting gift</button><span class="grow"></span><span class="muted small">${sel.length} / ${picks}</span><button class="primary" data-sok>Done</button></div></div>`);
  };
  closeModal.then = () => ($("#modal-body").onclick = null);
  $("#modal-body").onclick = (e) => {
    const k = e.target.closest("[data-skw]"), g = e.target.closest("[data-sg]"), pk = e.target.closest("[data-spk]");
    if (k) { if (k.dataset.skw !== kw) { kw = k.dataset.skw; sel = []; } return draw(); }
    if (pk) { picks = +pk.dataset.spk; sel = sel.slice(0, picks); return draw(); }
    if (g && !e.target.closest(".kw[data-kw]")) {
      const id = +g.dataset.sg;
      sel = sel.includes(id) ? sel.filter((x) => x !== id) : picks === 1 ? [id] : sel.length < picks ? [...sel, id] : sel;
      return draw();
    }
    const done = e.target.closest("[data-sok]") ? sel : e.target.closest("[data-snone]") ? [] : null;
    if (done) { mp.start = done; mp.picks = picks; closeModal(); if (location.hash.startsWith("#/mirror")) mpDraw(); }
  };
  draw();
}

// gift tooltip
function mpTip(el, e) {
  let tip = $("#mptip");
  if (!el) { if (tip) tip.style.display = "none"; return; }
  if (!tip) { tip = document.createElement("div"); tip.id = "mptip"; document.body.appendChild(tip); }
  const id = el.dataset.g;
  if (tip.dataset.g !== id) {
    const g = mpG(id), packs = [...new Set(MIRROR.packs.filter((p) => p.excl.includes(+id)).map((p) => p.name))];
    tip.dataset.g = id;
    tip.innerHTML = `<b>${esc(g.name)}</b><div class="muted small">${[g.tier && "Tier " + g.tier, g.kw && esc(mpKw(g.kw)), g.sin].filter(Boolean).join(" · ")}</div><div>${fmtDesc(g.desc)}</div>${mdTeamLine(id)}
      ${MIRROR.fus[id] ? `<div class="fz">Fusion: ${MIRROR.fus[id][0].map((x) => esc(mpG(x).name)).join(" + ")}</div>` : ""}${packs.length ? `<div class="gold">Only in: ${esc(packs.join(", "))}</div>` : ""}
      ${g.how ? `<div class="gold">${esc(g.how)}</div>` : ""}<div class="muted small mphint">${el.matches("[data-pick]") ? "Right-click" : "Click"} for the full card</div>`;
  }
  tip.style.display = "block";
  tip.style.left = Math.min(e.clientX + 14, innerWidth - 360) + "px";
  tip.style.top = Math.max(8, Math.min(e.clientY + 14, innerHeight - tip.offsetHeight - 8)) + "px";
}
window.addEventListener("hashchange", () => mpTip(null));

// an upgrade level the game marks nothing on (9427): the words that differ from the level before
function mpUpMark(a, b) {
  if (b.includes("upgradeHighlight")) return b;
  const A = a.replace(/<\/?style[^>]*>/g, "").toLowerCase().split(/(\s+)/), B = b.split(/(\s+)/), Bl = B.map((w) => w.toLowerCase()), n = A.length, m = B.length;
  const L = Array.from({ length: n + 1 }, () => new Int16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === Bl[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const keep = new Set();
  for (let i = 0, j = 0; i < n && j < m;) { if (A[i] === Bl[j]) { keep.add(j); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++; }
  let out = "", on = false;
  B.forEach((w, j) => {
    const ch = !keep.has(j) && w.trim();
    if (ch && !on) { out += `<style="upgradeHighlight">`; on = true; } else if (!ch && on && w.trim()) { out += "</style>"; on = false; }
    out += w;
  });
  return (out + (on ? "</style>" : "")).replace(/(\s+)<\/style>/g, "</style>$1");
}

// gift card: the whole text with clickable statuses, recipe, where it comes from
function mpCard(id, lv = 0) {
  const g = mpG(id), packs = [...new Set(MIRROR.packs.filter((p) => p.excl.includes(id)).map((p) => p.name))];
  const into = Object.keys(MIRROR.fus).filter((r) => MIRROR.fus[r].some((rs) => rs.includes(id))).map(Number);
  const chip = (x) => `<a class="mpcchip" data-card="${x}">${mpG(x).tile ? `<img src="${mpG(x).tile}">` : ""}${esc(mpG(x).name)}</a>`;
  const ups = g.up || [], t = (lv && ups[lv - 1]) || g;
  modal(`<div class="mpcardx"><div class="mpchead">${g.tile ? `<img src="${g.tile}">` : ""}<div><h2>${esc(t.name)}${ups.length ? `<span class="mpup">${ups.map((u, i) => `<button data-up="${i + 1}" class="toggle ${lv === i + 1 ? "on" : ""}" title="Upgrade ${i + 1}">${"+".repeat(i + 1)}</button>`).join("")}</span>` : ""}</h2>
      <div class="muted small">${[g.tier && "Tier " + g.tier, g.kw && esc(mpKw(g.kw)), g.sin].filter(Boolean).join(" · ")}</div></div></div>
    ${lv ? `<div class="mpuphint">${lv === 1 ? "Highlighted: what changed from the base gift" : "Highlighted: what changed from +"}</div>` : ""}
    <div class="mpcdesc">${fmtDesc(lv ? mpUpMark(lv > 1 ? ups[lv - 2].desc : g.desc, t.desc) : t.desc)}</div>${mdTeamLine(id)}
    ${MIRROR.fus[id] ? `<h4>Fusion of</h4>${MIRROR.fus[id].map((rs) => `<div class="mpcrow">${rs.map(chip).join("<b>+</b>")}</div>`).join("")}` : ""}
    ${into.length ? `<h4>Fuses into</h4><div class="mpcrow">${into.map(chip).join("")}</div>` : ""}
    ${packs.length ? `<h4>Only in</h4><div class="gold">${esc(packs.join(", "))}</div>` : ""}${g.how ? `<h4>Where</h4><div class="gold">${esc(g.how)}</div>` : ""}
    <div class="row" style="margin-top:14px"><span class="grow"></span><button data-want>${mp.want.has(id) ? "Remove from the build" : "Add to the build"}</button></div></div>`);
  closeModal.then = () => ($("#modal-body").onclick = null);
  $("#modal-body").onclick = (e) => {
    const c = e.target.closest("[data-card]");
    if (c) return mpCard(+c.dataset.card);
    const u = e.target.closest("[data-up]");
    if (u) { mpCard(id, lv === +u.dataset.up ? 0 : +u.dataset.up); document.querySelectorAll("#modal-body .uph").forEach((x) => x.classList.add("flash")); return; }
    if (e.target.closest("[data-want]")) { if (mp.want.has(id)) mp.want.delete(id); else mp.want.add(id); closeModal(); if (location.hash.startsWith("#/mirror")) mpDraw(); }
  };
}
