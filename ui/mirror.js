"use strict";
// Tools → Mirror Dungeon planner: pick the E.G.O gifts you want, get the theme packs to take and the floors to take them
// on. A gift can be tied to certain packs, a pack to certain floors — the planner seats the packs so the most of the
// build is reachable. Data: /api/mirror (limbusdm/mirror.py). The build is kept in localStorage "mirror".
let MIRROR = null;
const MP_KEEP = "mirror";
const MP_MODES = [["Normal", 5, "0"], ["Hard", 5, "1"], ["Hard", 10, "2"], ["Hard", 15, "3"]];  // (name, floors, the game's typeIndex)
const mp = { mode: 1, cap: 4, q: "", kw: "", only: "", sort: "kw", want: new Set(), lock: {}, open: -1 };
(() => { try { const s = JSON.parse(localStorage.getItem(MP_KEEP) || "{}"); Object.assign(mp, { mode: s.mode ?? 1, cap: s.cap ?? 4, sort: s.sort || "kw", lock: s.lock || {} }); mp.want = new Set(s.want || []); } catch { /* a fresh build */ } })();
const mpSave = () => { try { localStorage.setItem(MP_KEEP, JSON.stringify({ mode: mp.mode, cap: mp.cap, sort: mp.sort, lock: mp.lock, want: [...mp.want] })); } catch { /* not kept */ } };
const mpG = (id) => MIRROR.gifts[id] || { name: "Gift " + id, pic: "", kw: "", tier: 0, desc: "" };
const mpGi = (id, cls = "") => (mpG(id).pic ? `<img class="mpgi ${cls}" data-g="${id}" src="${imgThumb(mpG(id).pic)}" loading="lazy">` : `<i class="mpgi ${cls}" data-g="${id}"></i>`);
const mpKw = (k) => ((UNITS.glossary || {})[k] || {}).name || statusName(k);
// which list of a pack's floors a floor reads: Normal → 0; Hard → 1 on floors 1-5, 2 on 6-10, 3 on 11-15 (pools: any of the five)
const mpSpec = (f) => (mp.mode === 0 ? ["0", f] : f < 5 ? ["1", f] : f < 10 ? ["2", -1] : ["3", -1]);
const mpAllowed = (p, f) => { const [d, lf] = mpSpec(f), fl = p.floors[d]; return !!fl && (lf < 0 || fl.includes(lf)); };
const mpFloor = (f) => (f < 5 ? "Floor " + (f + 1) : f < 10 ? "Floors 6–10" : "Floors 11–15");

routes.mirror = async () => {
  const main = $("#main");
  if (!MIRROR) {
    main.innerHTML = `<h1>Mirror Dungeon planner</h1><div class="muted">Reading the game's files…</div>`;
    try { [MIRROR] = await Promise.all([api("/api/mirror"), units()]); } catch (e) { main.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    MIRROR.excl = new Set(MIRROR.packs.flatMap((p) => p.excl));
    for (const g of [...mp.want]) if (!MIRROR.gifts[g]) mp.want.delete(g);
  }
  if (!location.hash.startsWith("#/mirror")) return;
  if (!MIRROR.packs.length) { MIRROR = null; main.innerHTML = `<h1>Mirror Dungeon planner</h1><div class="empty">Take a snapshot first — the packs and gifts are read from it.</div>`; return; }
  if (!MIRROR.modes[MP_MODES[mp.mode][2]]) mp.mode = 1;
  mpDraw();
};

// The route for the picked gifts. A visit to a pack is counted for at most `cap` of them (nobody leaves a pack with
// everything it can drop), the pack-only and the rarest first; packs are added by how much they bring while all of
// them still find floors they may stand on.
function mpPlan() {
  const N = MP_MODES[mp.mode][1], floors = [...Array(N).keys()], packs = MIRROR.packs.filter((p) => floors.some((f) => mpAllowed(p, f)));
  const need = new Set(), fus = [];
  const add = (id) => { if (need.has(id)) return; need.add(id); const r = MIRROR.fus[id]; if (r) { fus.push([id, r[0]]); r[0].forEach(add); } };
  mp.want.forEach(add);
  const raw = [...need].filter((g) => !MIRROR.fus[g]);
  const only = new Set(raw.filter((g) => packs.some((p) => p.excl.includes(g))));
  const nowhere = raw.filter((g) => !packs.some((p) => p.excl.includes(g) || p.pool.includes(g)));
  const gives = (p) => raw.filter((g) => (only.has(g) ? p.excl.includes(g) : p.pool.includes(g)));
  const rare = Object.fromEntries(raw.map((g) => [g, packs.filter((p) => gives(p).includes(g)).length]));
  const take = (p, got) => gives(p).filter((g) => !got.has(g)).sort((a, b) => only.has(b) - only.has(a) || rare[a] - rare[b]).slice(0, mp.cap || 99);
  const gain = (p, got) => take(p, got).reduce((s, g) => s + (only.has(g) ? 100 : 1), 0);
  const got = new Set(), used = new Set(), mine = new Map(), pinned = {};
  for (const [f, id] of Object.entries(mp.lock)) { const p = packs.find((x) => x.id === id); if (p && +f < N && mpAllowed(p, +f) && !Object.values(pinned).includes(p)) pinned[f] = p; else delete mp.lock[f]; }
  // floors for a set of packs, each on a floor it may stand on (pinned ones stay): augmenting paths, null when they don't all fit
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
  // a gift no visit was counted for, but a pack of the route can drop it: luck — worth a warning only for a pack's own gift
  for (const x of rows) for (const g of x.extra) if (!src[g]) src[g] = { f: x.f, p: x.p, only: only.has(g), luck: only.has(g) };
  return { N, packs, rows, raw, only, fus, nowhere, src, gives, missed: raw.filter((g) => !src[g] && !nowhere.includes(g)) };
}

function mpPicker() {
  const N = MP_MODES[mp.mode][1], avail = new Set(MIRROR.packs.filter((p) => [...Array(N).keys()].some((f) => mpAllowed(p, f))).flatMap((p) => [...p.pool, ...p.excl]).concat(Object.keys(MIRROR.fus).map(Number)));
  const all = Object.entries(MIRROR.gifts).filter(([id]) => avail.has(+id));
  const kws = [...new Set(all.map(([, g]) => g.kw).filter(Boolean))].sort((a, b) => mpKw(a).localeCompare(mpKw(b)));
  const q = mp.q.trim().toLowerCase();
  const list = all.filter(([id, g]) => (!mp.kw || g.kw === mp.kw) && (!q || g.name.toLowerCase().includes(q)) && (mp.only !== "fuse" || MIRROR.fus[id]) && (mp.only !== "pack" || MIRROR.excl.has(+id)));
  const key = { kw: (g) => (g.kw ? mpKw(g.kw) : "~") + (9 - g.tier), tier: (g) => String(9 - g.tier) + g.name, name: (g) => g.name }[mp.sort];
  list.sort((a, b) => key(a[1]).localeCompare(key(b[1])));
  const tg = (on, attr, label, cls = "") => `<button class="toggle ${cls} ${on ? "on" : ""}" ${attr}>${label}</button>`;
  return `<div class="card mpcard"><input type="text" id="mpq" placeholder="Search a gift…" value="${esc(mp.q)}">
    <div class="mpchips">${tg(!mp.only, 'data-o=""', "All gifts")}${tg(mp.only === "fuse", 'data-o="fuse"', "Fusion · " + all.filter(([id]) => MIRROR.fus[id]).length, "fz")}${tg(mp.only === "pack", 'data-o="pack"', "Pack-only")}</div>
    <div class="mpchips">${tg(!mp.kw, 'data-k=""', "Any")}${kws.map((k) => tg(mp.kw === k, `data-k="${esc(k)}"`, esc(mpKw(k)))).join("")}</div>
    <div class="mpchips"><span class="muted small">Sort</span>${[["kw", "Keyword"], ["tier", "Tier"], ["name", "Name"]].map(([k, l]) => tg(mp.sort === k, `data-s="${k}"`, l)).join("")}<span class="grow"></span><span class="muted small">${list.length} gifts</span></div>
    <div class="mpgifts">${list.map(([id, g]) => `<div class="mpgift ${MIRROR.excl.has(+id) ? "ex" : ""} ${mp.want.has(+id) ? "on" : ""}" data-g="${id}" data-pick>${g.pic ? `<img src="${imgThumb(g.pic)}" loading="lazy">` : ""}${g.tier ? `<u>${ROMAN[g.tier - 1] || g.tier}</u>` : ""}${MIRROR.fus[id] ? "<s>FUSE</s>" : ""}</div>`).join("")}</div></div>`;
}

function mpBuild(r) {
  const line = (g) => {
    const s = r.src[g];
    if (s && s.luck) return `<small class="luck">${mpFloor(s.f)} · ${esc(s.p.name)} — over ${mp.cap} from one pack, needs luck</small>`;
    if (s) return `<small class="${s.only ? "gold" : "ok"}">${mpFloor(s.f)} · ${esc(s.p.name)}${s.only ? " — only there" : ""}</small>`;
    if (r.nowhere.includes(g)) return '<small class="bad">⚠ in no pack of this mode</small>';
    return `<small class="bad">⚠ no free floor — ${r.packs.filter((p) => r.gives(p).includes(g)).slice(0, 3).map((p) => esc(p.name)).join(", ")}</small>`;
  };
  const item = (g) => { const f = r.fus.find(([res]) => res === g); return `<div class="mpck">${mpGi(g)}<div><b>${esc(mpG(g).name)}</b>${f ? `<small class="fz">Fusion of ${f[1].length} gifts</small>` : line(g)}</div>
      ${f ? `<div class="parts">${f[1].map((p) => `<div>${mpGi(p)}<span>${esc(mpG(p).name)}<br>${MIRROR.fus[p] ? '<small class="fz">a fusion itself — below</small>' : line(p)}</span></div>`).join("")}</div>` : ""}</div>`; };
  const extra = r.fus.map(([res]) => res).filter((g) => !mp.want.has(g));
  return `<div class="card mpcard"><div class="row"><span class="mpcap">Your build<small>${mp.want.size} gifts</small></span><span class="grow"></span>${mp.want.size ? "<button data-clear>Clear all</button>" : ""}</div>
    ${[...mp.want, ...extra].map(item).join("") || '<div class="muted" style="margin:12px 0 4px">Pick gifts on the left — click one again to drop it.</div>'}</div>`;
}

function mpRoute(r) {
  const luck = (x) => x.extra.filter((g) => r.src[g] && r.src[g].luck && r.src[g].f === x.f);
  const icons = (x) => x.take.map((g) => mpGi(g, r.only.has(g) ? "only" : "")).join("") + x.extra.map((g) => mpGi(g, luck(x).includes(g) ? "luck" : "dim")).join("");
  const pk = (p, cls) => (p.pic ? `<img class="${cls}" src="${imgThumb(p.pic)}" loading="lazy">` : `<i class="${cls}"></i>`);
  const lane = (x) => `<div class="mplane">${x.cands.map((p) => { const gs = r.gives(p); return `<div class="mpbc ${p === x.p ? "sel" : ""}" data-pin="${x.f}:${p.id}" title="${p === x.p && x.lock ? "Pinned — click to let go" : "Pin this pack to the floor"}">${pk(p, "pk")}<span class="cnt">${gs.length} of yours</span>
      <div class="pn">${esc(p.name)}</div><div class="mpmini">${gs.slice(0, 10).map((g) => mpGi(g, r.only.has(g) ? "only" : "")).join("")}</div></div>`; }).join("")}</div>`;
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
      <span><label>Gifts counted from one pack</label><span class="seg">${[2, 3, 4, 0].map((c) => `<button data-c="${c}" class="toggle ${mp.cap === c ? "on" : ""}">${c || "All"}</button>`).join("")}</span></span></div>
    <div class="mpcols">${mpPicker()}${mpBuild(r)}<div>${mpRoute(r)}</div></div></div>`;
  $(".mpgifts").scrollTop = top;
  const page = $("#mppage");
  page.onclick = (e) => {
    const t = e.target.closest("[data-m],[data-c],[data-k],[data-o],[data-s],[data-pick],[data-pin],[data-open],[data-clear]");
    if (!t) return;
    const d = t.dataset;
    if (d.m) { mp.mode = +d.m; mp.lock = {}; mp.open = -1; }
    else if (d.c) mp.cap = +d.c;
    else if ("k" in d) mp.kw = d.k;
    else if ("o" in d) mp.only = d.o;
    else if (d.s) mp.sort = d.s;
    else if ("pick" in d) { const g = +d.g; if (mp.want.has(g)) mp.want.delete(g); else mp.want.add(g); }
    else if ("clear" in d) { mp.want.clear(); mp.lock = {}; mp.open = -1; }
    else if (d.pin) { const [f, id] = d.pin.split(":").map(Number); if (mp.lock[f] === id) delete mp.lock[f]; else { for (const k in mp.lock) if (mp.lock[k] === id) delete mp.lock[k]; mp.lock[f] = id; } }
    else if (d.open) mp.open = mp.open === +d.open ? -1 : +d.open;
    mpTip(null);
    mpDraw();
  };
  $("#mpq").oninput = (e) => { mp.q = e.target.value; mpDraw(); const q = $("#mpq"); q.focus(); q.setSelectionRange(q.value.length, q.value.length); };
  page.onmousemove = (e) => mpTip(e.target.closest("[data-g]"), e);
  page.onmouseleave = () => mpTip(null);
}

// a gift's card under the pointer: what it does, what it is fused from, the packs it is tied to
function mpTip(el, e) {
  let tip = $("#mptip");
  if (!el) { if (tip) tip.style.display = "none"; return; }
  if (!tip) { tip = document.createElement("div"); tip.id = "mptip"; document.body.appendChild(tip); }
  const id = el.dataset.g;
  if (tip.dataset.g !== id) {
    const g = mpG(id), packs = [...new Set(MIRROR.packs.filter((p) => p.excl.includes(+id)).map((p) => p.name))];
    tip.dataset.g = id;
    tip.innerHTML = `<b>${esc(g.name)}</b><div class="muted small">${[g.tier && "Tier " + g.tier, g.kw && esc(mpKw(g.kw)), g.sin].filter(Boolean).join(" · ")}</div><div>${fmtDesc(g.desc)}</div>
      ${MIRROR.fus[id] ? `<div class="fz">Fusion: ${MIRROR.fus[id][0].map((x) => esc(mpG(x).name)).join(" + ")}</div>` : ""}${packs.length ? `<div class="gold">Only in: ${esc(packs.join(", "))}</div>` : ""}`;
  }
  tip.style.display = "block";
  tip.style.left = Math.min(e.clientX + 14, innerWidth - 360) + "px";
  tip.style.top = Math.max(8, Math.min(e.clientY + 14, innerHeight - tip.offsetHeight - 8)) + "px";
}
window.addEventListener("hashchange", () => mpTip(null));
