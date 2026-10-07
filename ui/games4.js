// Games → Limbus Grid: a 3 × 3 grid, a condition on every row and column — name an Identity for each cell that meets
// both. Nine tries; the fewer Identities fit a cell, the more it is worth.
// Shares the styles, the Identities' list (gxIds) and the Daily challenge / duels of games.js / games3.js.
"use strict";

// ------------------------------------------------------------------ Limbus Grid
const GG_TRIES = 9;
const GG_KINDS = { sinner: "SINNER", season: "SEASON", rank: "RARITY", kw: "ARCHETYPE", atk: "DAMAGE", sin: "SIN", assoc: "FACTION", weak: "WEAK TO", res: "RESISTS", year: "RELEASED IN" };
const gg = { game: null, ids: [], cats: [] };
window.addEventListener("hashchange", () => { if (!location.hash.startsWith("#/gamegrid")) gg.game = null; });

routes.gamegrid = async (args = []) => {
  gg.game = null;
  const auto = gmAuto("grid", args);
  gmCrumb("grid");
  $("#main").innerHTML = `<h1>Limbus Grid</h1><div class="sub">Reading the game's files…</div>`;
  gg.ids = await gxIds();
  if (!location.hash.startsWith("#/gamegrid")) return;
  // every condition a row or a column can carry, with the Identities that meet it (the ones met by six or more)
  const by = {}, put = (kind, name, x) => { if (name && name !== "—") (by[kind + "|" + name] = by[kind + "|" + name] || { kind, name, has: new Set() }).has.add(x.key); };
  for (const x of gg.ids) {
    put("sinner", x.sub, x);
    put("season", x.season, x);
    put("rank", "0".repeat(x.rank), x);
    put("year", x.date.slice(0, 4), x);
    x.kw.forEach((k) => put("kw", k, x));
    x.atk.forEach((k) => put("atk", k + " skill", x));
    x.sins.forEach((k) => put("sin", k + " skill", x));
    x.assoc.forEach((k) => put("assoc", k, x));
    for (const [k, v] of Object.entries(x.resist)) put(v > 1 ? "weak" : v < 1 ? "res" : "", k, x);
  }
  gg.cats = Object.values(by).filter((c) => c.kind && c.has.size >= 6);
  ggDrawStart();
  if (auto && gg.cats.length >= 6) ggNew(true);
};

function ggDrawStart() {
  const s = gx.grid || {};
  $("#main").innerHTML = `<h1>Limbus Grid</h1>
    <div class="sub">Three conditions across, three down. Name an Identity for every cell that meets both of its conditions — each Identity once. ${GG_TRIES} tries for the nine cells, so a wrong name costs a cell.</div>
    ${gg.cats.length < 6 ? `<p class="muted">Nothing to ask yet: the game's files or a snapshot are missing.</p>` : `
    <div class="gmstart"><span class="gmscore">${gg.ids.length} IDENTITIES · BEST <i>${s.best || "—"}</i> · FULL GRIDS <i>${s.full || 0}</i> OF ${s.played || 0}</span>
      ${gmDailyBtn("grid")}<button class="gmbtn" id="gggo">Start</button></div>
    <div class="muted small">A cell is worth more the fewer Identities fit it. "Slash skill" / "Wrath skill" = one of its three skills is that; "Weak to" / "Resists" = its own resistances.</div>`}`;
  if ($("#gggo")) $("#gggo").onclick = () => ggNew();
  if ($("#gmdaily")) $("#gmdaily").onclick = () => gmDailyDone("grid") == null ? ggNew(true) : toast("Today's Daily is done — a new one comes with the daily reset.");
}

// a grid: three conditions for the rows, three for the columns (two of a kind at most, three Sinners), at least two
// Identities in every cell, and nine different ones to fill it with
function ggMake(rnd) {
  const mix = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const both = (a, b) => [...a.has].filter((k) => b.has.has(k));
  for (let n = 0; n < 500; n++) {
    const kinds = {}, take = (c) => (kinds[c.kind] || 0) < (c.kind === "sinner" ? 3 : 2) && (kinds[c.kind] = (kinds[c.kind] || 0) + 1);
    const order = mix(gg.cats), rows = [], cols = [];
    for (const c of order) if (rows.length < 3 && take(c)) rows.push(c);
    for (const c of order) if (cols.length < 3 && !rows.includes(c) && rows.every((r) => both(r, c).length >= 2) && take(c)) cols.push(c);
    if (cols.length < 3) continue;
    const fits = rows.flatMap((r) => cols.map((c) => both(r, c)));
    const ord = fits.map((_, i) => i).sort((a, b) => fits[a].length - fits[b].length), used = new Set();
    const fill = (i) => i === 9 || fits[ord[i]].some((k) => !used.has(k) && (used.add(k), fill(i + 1) || (used.delete(k), false)));
    if (fill(0)) return { rows, cols, fits };
  }
  return null;
}
const ggWorth = (n) => Math.max(100, Math.round(40 / Math.sqrt(n)) * 10);

function ggNew(daily) {
  const duel = daily === true ? gmDuelTake("grid") : null, made = ggMake(daily === true ? gmDaySeed("grid", duel) : Math.random);
  if (!made) return toast("Could not make a grid from the game's files.");
  gg.game = { daily: daily === true, duel, ...made, got: Array(9).fill(null), left: GG_TRIES, score: 0, sel: 0, over: false };
  ggDraw();
}

function ggDraw() {
  const g = gg.game, byKey = (k) => gg.ids.find((x) => x.key === k), used = g.got.filter(Boolean), n = used.length;
  const head = (c) => `<div class="gghead"><small>${GG_KINDS[c.kind]}</small><b>${esc(c.name)}</b></div>`;
  const cell = (i) => {
    const x = g.got[i], fit = g.fits[i];
    if (x) return `<div class="ggcell ok" title="${fit.length} Identities fit this cell"><img src="${x.pic}" onerror="this.remove()"><b>${esc(x.title)}</b><i>+${ggWorth(fit.length)}</i></div>`;
    if (!g.over) return `<button class="ggcell ${g.sel === i ? "on" : ""}" data-i="${i}"><i>${ggWorth(fit.length)}</i></button>`;
    const ex = byKey(fit.find((k) => !used.some((u) => u.key === k)) || fit[0]);
    return `<div class="ggcell miss"><img src="${ex.pic}" onerror="this.remove()"><b>${esc(ex.title)}</b><i>${fit.length} fit</i></div>`;
  };
  const r = g.sel == null ? null : g.rows[Math.floor(g.sel / 3)], c = g.sel == null ? null : g.cols[g.sel % 3];
  $("#main").innerHTML = `<h1>Limbus Grid</h1>
    <div class="gmtop"><span class="gmscore">TRIES LEFT <b>${g.left}</b> &nbsp; SCORE <b>${g.score}</b>${g.daily ? ` · ${gmDayTag(g)}` : ""}</span><span class="grow"></span>
      ${g.over ? `${g.daily ? `<button class="toggle" id="ggcopy">${gmCopyLabel(g)}</button>` : ""}<button class="toggle" id="ggback">Back</button><button class="gmbtn" id="ggagain">Play again</button>` : `<button class="toggle" id="ggquit">Give up</button>`}</div>
    ${g.over ? `<div class="gmkick gcend">${n === 9 ? "THE WHOLE GRID" : `${n} OF 9 CELLS`} · ${g.score} POINTS — THE EMPTY CELLS SHOW ONE THAT FITS</div>`
    : `<div class="gwtype"><div class="gmkick">${esc(r.name)} × ${esc(c.name)}</div><input id="ggin" class="dbq" placeholder="Identity or Sinner…" autocomplete="off"><div id="ggsugg" class="gmsugg"></div></div>`}
    <div class="ggbox"><div class="ggcorner">${g.over ? "" : "pick a cell,<br>name an Identity"}</div>${g.cols.map(head).join("")}
      ${g.rows.map((row, y) => head(row) + [0, 1, 2].map((x) => cell(y * 3 + x)).join("")).join("")}</div>`;
  document.querySelectorAll("button.ggcell").forEach((b) => b.onclick = () => { g.sel = +b.dataset.i; ggDraw(); });
  if ($("#ggin")) gxType($("#ggin"), $("#ggsugg"), () => gg.ids.filter((x) => !g.got.includes(x)), ggTry);
  if ($("#ggquit")) $("#ggquit").onclick = () => ggEnd();
  if ($("#ggagain")) $("#ggagain").onclick = () => ggNew();
  if ($("#ggback")) $("#ggback").onclick = () => { gg.game = null; ggDrawStart(); };
  if ($("#ggcopy")) $("#ggcopy").onclick = () => gmCopyResult("grid", g, () => gxCopy(`Limbus Archive · Limbus Grid · Daily ${gmDay()}\n${n}/9 · ${g.score} pts\n`
    + [0, 1, 2].map((y) => [0, 1, 2].map((x) => g.got[y * 3 + x] ? "🟩" : "⬛").join("")).join("\n")));
}

function ggTry(key) {
  const g = gg.game, x = gg.ids.find((i) => i.key === key);
  if (!x || g.over || g.sel == null || g.got.includes(x)) return;
  g.left--;
  if (g.fits[g.sel].includes(key)) {
    g.got[g.sel] = x;
    g.score += ggWorth(g.fits[g.sel].length);
    const open = [...Array(9).keys()].filter((i) => !g.got[i]);
    g.sel = open.find((i) => i > g.sel) ?? open[0] ?? null;
  } else toast(`${x.title} doesn't fit this cell.`);
  g.left > 0 && g.got.includes(null) ? ggDraw() : ggEnd();
}

function ggEnd() {
  const g = gg.game, s = gx.grid = gx.grid || {};
  g.over = true;
  s.played = (s.played || 0) + 1;
  if (!g.got.includes(null)) s.full = (s.full || 0) + 1;
  if (!g.daily) s.best = Math.max(s.best || 0, g.score);
  gxKeep();
  if (g.daily) gmDailyOver("grid", g, g.score);
  ggDraw();
}
