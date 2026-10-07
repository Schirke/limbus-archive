// Games → Guess the enemy (a silhouette or a picture in big pixels that opens in steps; "Pixel art" = the same over
// Identities), Guess the Canto (a piece of a story background that zooms out), Limbus Wordle (name the Identity by
// what each try has in common with it) and Connections (16 Identities, four groups of four).
// Shares the styles and the Daily challenge of games.js / games2.js.
"use strict";

// ------------------------------------------------------------------ shared
const GX_KEEP = "games_more";
const gx = { wordle: {}, conn: {}, plain: false, ...(() => { try { return JSON.parse(localStorage.getItem(GX_KEEP) || "{}"); } catch { return {}; } })() };
const gxKeep = () => { try { localStorage.setItem(GX_KEEP, JSON.stringify({ wordle: gx.wordle, conn: gx.conn, plain: gx.plain })); } catch {} };
function gxCopy(text) {
  const done = () => toast("Copied — paste it anywhere.");
  const old = () => { const t = document.createElement("textarea"); t.value = text; document.body.appendChild(t); t.select(); document.execCommand("copy"); t.remove(); done(); };
  navigator.clipboard?.writeText ? navigator.clipboard.writeText(text).then(done, old) : old();
}
// a field to type a name into, with the matches under it: arrows move, Enter takes
function gxType(inp, box, from, pick) {
  inp.oninput = () => {
    const q = inp.value.trim().toLowerCase(), hits = q.length < 2 ? [] : from().filter((x) => x.name.toLowerCase().includes(q));
    box.innerHTML = hits.map((x, i) => `<div data-k="${esc(x.key)}" class="${i ? "" : "on"}">${esc(x.title || x.name)}<i>${esc(x.sub || "")}</i></div>`).join("");
    box.querySelectorAll("div").forEach((r) => r.onclick = () => pick(r.dataset.k));
  };
  inp.onkeydown = (e) => {
    const rows = [...box.children], at = rows.findIndex((r) => r.classList.contains("on"));
    if (e.key === "Enter") return rows[at]?.click();
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" || !rows.length) return;
    e.preventDefault();
    const to = rows[Math.max(0, Math.min(rows.length - 1, at + (e.key === "ArrowDown" ? 1 : -1)))];
    rows[at]?.classList.remove("on");
    to.classList.add("on");
    to.scrollIntoView({ block: "nearest" });
  };
  inp.focus();
}
// the Identities as the two puzzles see them
let gxIdsP = null;
const gxIds = () => gxIdsP || (gxIdsP = api("/api/units").then((u) => ((u || {}).ids || []).filter((x) => x.img && x.img.thumb).map((x) => {
  const top = (s) => s.up[Math.max(...Object.keys(s.up).map(Number))] || {};
  return { key: "i" + x.id, id: x.id, name: x.title + " " + x.sinnerName, title: x.title, sub: x.sinnerName, sinner: x.sinner, season: giSeason(u, x.season) || "—",
    date: x.date || "", rank: x.rank, kw: (x.keywords || []).map((k) => u.keywords[k] || k), assoc: x.assoc || [],
    atk: [...new Set((x.skills || []).filter((s) => s.type === "SKILL").map((s) => top(s).atk).filter(Boolean))], pic: giThumb(x.img.thumb) }; })).catch(() => []));
// what the games' page shows as a game's best (games.js gmBest)
function gxBest(game) {
  if (game === "enemy") return Math.max(0, ...Object.entries(gp.best).filter(([k]) => k !== "canto").map(([, v]) => v));
  if (game === "canto") return gp.best.canto || 0;
  if (game === "wordle") return gx.wordle.best ? `${gx.wordle.best} / ${GW_TRIES}` : 0;
  if (game === "conn") return gx.conn.best == null ? 0 : gx.conn.best ? `${gx.conn.best} MISS` : "PERFECT";
}

// ------------------------------------------------------------------ a picture that opens in steps: enemy, pixel art, Canto
const GP_KEEP = "games_pic", GP_ROUNDS = 10, GP_WORTH = [1000, 750, 500, 250], GP_HINT = 250;
const gp = { page: "enemy", who: "enemy", look: "sil", hard: false, best: {},
  ...(() => { try { return JSON.parse(localStorage.getItem(GP_KEEP) || "{}"); } catch { return {}; } })(), game: null, data: null };
const gpKeep = () => { try { localStorage.setItem(GP_KEEP, JSON.stringify({ who: gp.who, look: gp.look, hard: gp.hard, best: gp.best })); } catch {} };
const gpCanto = () => gp.page === "canto";
const gpTitle = () => gpCanto() ? "Guess the Canto" : "Guess the enemy";
const gpPix = () => !gpCanto() && (gp.who === "id" || gp.look === "pix");
const gpMode = () => gpCanto() ? "canto" : gp.who + (gp.who === "id" ? "" : gp.look) + (gp.hard ? "h" : "e");
const gpPool = () => gpCanto() ? gp.data.scenes : gp.who === "id" ? gp.data.ids : gp.data.enemies;
const gpWorth = () => Math.max(100, GP_WORTH[gp.game.step] - GP_HINT * Object.keys(gp.game.hints).length) * (gp.hard && !gpCanto() ? 2 : 1);

window.addEventListener("hashchange", () => { if (!/^#\/game(enemy|canto)/.test(location.hash)) { gp.game = null; gpDailyEnd(); } });
routes.gameenemy = (args = []) => gpOpen("enemy", args[0] === "daily");
routes.gamecanto = (args = []) => gpOpen("canto", args[0] === "daily");

async function gpOpen(page, daily) {
  gp.page = page;
  gp.game = null;
  gmCrumb(page);
  $("#main").innerHTML = `<h1>${gpTitle()}</h1><div class="sub">Reading the game's files…</div>`;
  if (!gp.data) {
    const [units, en, pics] = await Promise.all([api("/api/units"), api("/api/enemies"), api("/api/game_pics")].map((p) => p.catch(() => null)));
    // enemies by the handbook's picture of their battle look (it has no background, so it makes a silhouette); one per name
    const thumbs = new Set((en || {}).thumbs || []), seen = new Set();
    const enemies = ((en || {}).list || []).filter((e) => thumbs.has(e.app) && !/^\?+$/.test(e.name) && !seen.has(e.name) && seen.add(e.name))
      .map((e) => ({ key: "e" + e.id, id: e.id, name: e.name, title: e.name, sub: e.group, pic: `/api/enemy_thumb?app=${encodeURIComponent(e.app)}` }));
    const ids = ((units || {}).ids || []).filter((x) => x.img && x.img.thumb).map((x) => ({ key: "i" + x.id, id: x.id, name: x.title + " " + x.sinnerName, title: x.title,
      sub: x.sinnerName, sinner: x.sinner, season: giSeason(units, x.season), pic: giThumb(x.img.thumb) }));
    const scenes = Object.entries((pics || {}).story || {}).flatMap(([n, list]) => list.map((p) => ({ key: p, canto: +n, name: "Canto " + n, title: "Canto " + n, sub: "",
      pic: `/api/asset_img?path=${encodeURIComponent("Assets/Resources_moved/Story/Backgrounds/" + p)}`, thumb: giThumb("Assets/Resources_moved/Story/Backgrounds/" + p) })));
    gp.data = { enemies, ids, scenes, cantos: [...new Set(scenes.map((s) => s.canto))].sort((a, b) => a - b) };
  }
  if (gp.page !== page) return;
  gpDrawStart();
  if (daily && gmDailyDone(page) == null && $("#gmdaily") && !$("#gmdaily").disabled) gpNew(true);
}

function gpDrawStart() {
  const pool = gpPool(), chip = (on, attr, text) => `<button class="toggle ${on ? "on" : ""}" ${attr}>${text}</button>`;
  $("#main").innerHTML = `<h1>${gpTitle()}</h1>
    <div class="sub">${gpCanto() ? "A small piece of a background from the story — it zooms out in steps. Name the Canto it is from; the sooner, the more points."
      : "A picture that opens in steps: a black silhouette or big pixels first. Name who it is; the sooner, the more points."}</div>
    ${pool.length < 8 ? `<p class="muted">Nothing to ask yet: the game's files or a snapshot are missing${gpCanto() || gp.who === "id" ? "" : ", or the handbook hasn't made the enemies' pictures yet (open Database → Enemies once)"}.</p>` : `
    ${gpCanto() ? "" : `<div class="dbrow">${chip(gp.who === "enemy", 'data-w="enemy"', "Enemies")}${chip(gp.who === "id", 'data-w="id"', "Identities · pixel art")}<span class="gap"></span>
      ${gp.who === "enemy" ? `${chip(gp.look === "sil", 'data-l="sil"', "Silhouette")}${chip(gp.look === "pix", 'data-l="pix"', "Pixels")}<span class="gap"></span>` : ""}
      ${chip(!gp.hard, 'data-h=""', "Easy · 4 answers")}${chip(gp.hard, 'data-h="1"', "Hard · type the name")}</div>`}
    <div class="gmstart"><span class="gmscore">${pool.length} ${gpCanto() ? "PICTURES" : gp.who === "id" ? "IDENTITIES" : "ENEMIES"} · BEST <i>${gp.best[gpMode()] || 0}</i></span>
      ${gmDailyBtn(gp.page, pool.length < 8)}<button class="gmbtn" id="gpgo">Start · ${GP_ROUNDS} rounds</button></div>
    <div class="muted small">${gpCanto() ? "Backgrounds of the main story, Canto 2 to the latest."
      : "Easy: four answers — enemies met next to this one, or the same Sinner's other Identities. Hard: type the name, points are doubled. A hint costs points too."}</div>`}`;
  const main = $("#main"), set = (sel, key, f) => main.querySelectorAll(sel).forEach((b) => b.onclick = () => { gp[key] = f(b); gpKeep(); gpDrawStart(); });
  set("[data-w]", "who", (b) => b.dataset.w);
  set("[data-l]", "look", (b) => b.dataset.l);
  set("[data-h]", "hard", (b) => !!b.dataset.h);
  if ($("#gpgo")) $("#gpgo").onclick = () => gpNew();
  if ($("#gmdaily")) $("#gmdaily").onclick = () => gpNew(true);
}

// a daily game runs on fixed settings (enemies, silhouette, Easy); the player's own come back after it
function gpDailyEnd() {
  if (gp.mine) Object.assign(gp, gp.mine);
  gp.mine = null;
  gmRnd = Math.random;
}

function gpNew(daily) {
  gpDailyEnd();
  if (daily === true) {
    gp.mine = { who: gp.who, look: gp.look, hard: gp.hard };
    Object.assign(gp, { who: "enemy", look: "sil", hard: false });
    gmRnd = gmSeed(gmDay() + gp.page);
  }
  gp.game = { daily: daily === true, pool: gpPool().slice(), round: -1, score: 0, streak: 0, top: 0, log: [], asked: new Set() };
  gpRound();
}

function gpRound() {
  const g = gp.game;
  if (++g.round >= GP_ROUNDS) return gpResult();
  let ans;
  for (let k = 0; k < 30 && (!ans || g.asked.has(ans.key)); k++) ans = giPick(g.pool);
  g.asked.add(ans.key);
  // wrong answers: enemies next to this one in the handbook's order, the same Sinner's other Identities
  const all = gpPool(), at = all.indexOf(ans);
  let near = gpCanto() ? [] : gp.who === "id" ? all.filter((x) => x !== ans && x.sinner === ans.sinner)
    : all.filter((x) => x !== ans).sort((a, b) => Math.abs(all.indexOf(a) - at) - Math.abs(all.indexOf(b) - at)).slice(0, 8);
  // (the spot a Canto's picture is zoomed into is drawn here, so a daily game shows the same piece to everybody)
  Object.assign(g, { ans, opts: gmShuffle([ans, ...gmShuffle(near).slice(0, 3)]), step: 0, hints: {}, done: null, img: null, fx: 0.2 + gmRnd() * 0.6, fy: 0.2 + gmRnd() * 0.6 });
  const im = new Image();
  // a picture the game's files don't give, or a scene that is all but black: another one takes the round
  const drop = () => { if (gp.game !== g || g.ans !== ans) return; g.pool = g.pool.filter((x) => x !== ans); g.round--;
    g.pool.length < 8 ? (gp.game = null, gpDailyEnd(), gpDrawStart(), toast("The pictures could not be read from the game's files.")) : gpRound(); };
  im.onload = () => {
    if (gp.game !== g || g.ans !== ans) return;
    if (gpCanto()) {
      const c = document.createElement("canvas"), x = c.getContext("2d");
      c.width = 32;
      c.height = 18;
      x.drawImage(im, 0, 0, 32, 18);
      const px = x.getImageData(0, 0, 32, 18).data;
      let sum = 0;
      for (let i = 0; i < px.length; i += 4) sum += px[i] + px[i + 1] + px[i + 2];
      if (sum / (px.length / 4 * 3) < 28) return drop();
    }
    g.img = im;
    gpPaint();
  };
  im.onerror = drop;
  im.src = ans.pic;
  gpDraw();
}

function gpPaint() {
  const g = gp.game, cv = $("#gpcv"), im = g && g.img;
  if (!cv || !im) return;
  const open = !!g.done, s = g.step;
  if (gpCanto()) cv.height = Math.round(cv.width * Math.min(0.75, im.height / im.width));
  const ctx = cv.getContext("2d"), W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  cv.style.filter = "";
  if (gpCanto()) {
    const z = open ? 1 : [4, 2.5, 1.6, 1][s], w = im.width / z, h = im.height / z;
    const x = Math.min(im.width - w, Math.max(0, g.fx * im.width - w / 2)), y = Math.min(im.height - h, Math.max(0, g.fy * im.height - h / 2));
    return ctx.drawImage(im, x, y, w, h, 0, 0, W, H);
  }
  const k = Math.min(W / im.width, H / im.height), w = im.width * k, h = im.height * k, x = (W - w) / 2, y = (H - h) / 2;
  if (gpPix() && !open) {
    const n = [9, 15, 24, 40][s], sw = Math.max(1, Math.round(n * w / Math.max(w, h))), sh = Math.max(1, Math.round(n * h / Math.max(w, h)));
    const small = document.createElement("canvas");
    small.width = sw;
    small.height = sh;
    small.getContext("2d").drawImage(im, 0, 0, sw, sh);
    ctx.imageSmoothingEnabled = false;
    return ctx.drawImage(small, 0, 0, sw, sh, x, y, w, h);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(im, x, y, w, h);
  if (!open) cv.style.filter = ["brightness(0)", "brightness(.3) blur(7px)", "blur(5px)", "blur(2px)"][s];
}

function gpDraw() {
  const g = gp.game, a = g.ans, d = g.done, used = Object.keys(g.hints).length, canto = gpCanto();
  const hints = canto ? [] : gp.who === "id" ? (a.season ? [["season", "SEASON", a.season]] : []) : [["where", "WHERE", a.sub]];
  const hint = ([k, label, val]) => g.hints[k] || d ? `<div class="gihint open"><small>${label}</small><b>${esc(val)}</b></div>`
    : `<button class="gihint" data-hint="${k}"><small>${label}</small><b>hidden</b><u>open · −${GP_HINT * (gp.hard ? 2 : 1)}</u></button>`;
  const cls = (key) => d ? (key === (canto ? String(a.canto) : a.key) ? "ok" : key === d.pick ? "bad" : "dim") : "";
  const opts = canto ? `<div class="gmopts gpcantos">${gp.data.cantos.map((n) => `<button class="gmopt ${cls(String(n))}" data-k="${n}" ${d ? "disabled" : ""}><b>Canto ${n}</b></button>`).join("")}</div>`
    : `<div class="gmopts">${g.opts.map((o) => `<button class="gmopt ${cls(o.key)}" data-k="${o.key}" ${d ? "disabled" : ""}><b>${esc(o.title)}</b><i>${esc(gp.who === "id" || d ? o.sub : "")}</i></button>`).join("")}</div>`;
  $("#main").innerHTML = `<h1>${gpTitle()}</h1>
    <div class="gmtop"><span class="gmscore">ROUND <b>${g.round + 1} / ${GP_ROUNDS}</b></span><span class="grow"></span>
      <span class="gmscore">SCORE <b>${g.score}</b> &nbsp; STREAK <i>×${g.streak}</i></span><button class="toggle" id="gpquit">Quit</button></div>
    <div class="gmstage gistage gpstage ${canto ? "wide" : ""}"><div>
      <div class="gppic ${canto ? "scene" : gpPix() ? "" : "sil"}"><canvas id="gpcv" width="${canto ? 420 : 300}" height="${canto ? 236 : 300}"></canvas></div>
      <div class="gmsteps">${GP_WORTH.map((w, i) => `<span class="${d ? (i <= g.step ? "done" : "") : i < g.step ? "done" : i === g.step ? "cur" : ""}">${w}</span>`).join("")}</div>
      ${!d && g.step < GP_WORTH.length - 1 ? `<button class="toggle gmmore" id="gpmore">Show more · −${(GP_WORTH[g.step] - GP_WORTH[g.step + 1]) * (gp.hard && !canto ? 2 : 1)}</button>` : ""}
      <div class="gihints">${hints.map(hint).join("")}</div></div>
    <div><div class="gmkick">${d ? (d.ok ? `+${d.points}${used ? ` · ${used} HINT USED` : ""}` : "MISSED") : `WORTH ${gpWorth()} NOW`}</div>
      <div class="gmq">${d ? esc(a.name) : canto ? "Which Canto is this from?" : gp.who === "id" ? "Which Identity is this?" : "Who is this?"}</div>
      ${gp.hard && !canto && !d ? `<input id="gptype" class="dbq" placeholder="${gp.who === "id" ? "Identity…" : "Enemy…"}" autocomplete="off"><div id="gpsugg" class="gmsugg"></div>
        <button class="toggle gmmore" id="gpskip">I don't know</button>`
      : gp.hard && !canto ? `<div class="gmopts"><div class="gmopt ${d.ok ? "ok" : "bad"}"><b>${esc(d.said || "—")}</b><i>your answer</i></div></div>` : opts}
      ${d ? `<div class="gmafter">${canto ? "<span></span>" : gp.who === "id" ? `<a href="#/db/${a.id}">Open in the database →</a>` : `<a href="#/enemies/${a.id}">Open in the handbook →</a>`}
        <button class="gmbtn" id="gpnext">${g.round + 1 < GP_ROUNDS ? "Next" : "Result"}</button></div>` : ""}</div></div>`;
  gpPaint();
  $("#gpquit").onclick = () => { gp.game = null; gpDailyEnd(); gpDrawStart(); };
  if ($("#gpmore")) $("#gpmore").onclick = () => { g.step++; gpDraw(); };
  document.querySelectorAll("[data-hint]").forEach((b) => b.onclick = () => { g.hints[b.dataset.hint] = 1; gpDraw(); });
  document.querySelectorAll(".gmopts button").forEach((b) => b.onclick = () => gpAnswer(b.dataset.k));
  if ($("#gpnext")) { $("#gpnext").onclick = gpRound; $("#gpnext").focus(); }
  if ($("#gpskip")) $("#gpskip").onclick = () => gpAnswer(null);
  if ($("#gptype")) gxType($("#gptype"), $("#gpsugg"), gpPool, gpAnswer);
}

function gpAnswer(key) {
  const g = gp.game, canto = gpCanto(), said = canto ? (key ? "Canto " + key : "") : (gpPool().find((x) => x.key === key) || {}).name || "";
  const ok = canto ? +key === g.ans.canto : key === g.ans.key, points = ok ? gpWorth() : 0;
  g.streak = ok ? g.streak + 1 : 0;
  g.top = Math.max(g.top, g.streak);
  g.score += points;
  g.done = { ok, pick: key, points, said };
  g.log.push({ ans: g.ans, ok, points, said: said || "—", step: g.step, hints: Object.keys(g.hints).length });
  gpDraw();
}

function gpResult() {
  const g = gp.game;
  if (g.daily) gmDailyKeep(gp.page, g.score);
  gpDailyEnd();
  const mode = gpMode(), record = !g.daily && g.score > (gp.best[mode] || 0);
  if (!g.daily) gp.best[mode] = Math.max(gp.best[mode] || 0, g.score);
  gpKeep();
  $("#main").innerHTML = `<h1>${gpTitle()}</h1>
    <div class="gmtop"><span class="gmbig">${g.score}</span><span class="gmscore">${g.log.filter((r) => r.ok).length} OF ${g.log.length} · BEST STREAK ×${g.top} · BEST <i>${gp.best[mode] || 0}</i>${record ? " · NEW RECORD" : ""}</span>
      <span class="grow"></span>${g.daily ? `<span class="gmscore">DAILY ${gmDay()}</span><button class="toggle" id="gpcopy">Copy the result</button>` : ""}<button class="toggle" id="gpback">Settings</button><button class="gmbtn" id="gpagain">Play again</button></div>
    <table class="gmlog"><tr><th>#</th><th></th><th>${gpCanto() ? "FROM" : "WHO"}</th><th>YOUR ANSWER</th><th>OPENED</th><th>HINTS</th><th>POINTS</th></tr>
    ${g.log.map((r, i) => `<tr><td>${i + 1}</td><td><img class="gplogpic" src="${r.ans.thumb || r.ans.pic}"></td><td>${esc(r.ans.name)}<i>${esc(r.ans.sub)}</i></td>
      <td class="${r.ok ? "ok" : "bad"}">${esc(r.said)}</td><td>${r.step + 1} / ${GP_WORTH.length}</td><td>${r.hints || ""}</td><td>${r.points}</td></tr>`).join("")}</table>`;
  $("#gpagain").onclick = () => gpNew();
  $("#gpback").onclick = () => { gp.game = null; gpDrawStart(); };
  if ($("#gpcopy")) $("#gpcopy").onclick = () => gmShare(gpTitle(), g.score, g.log.map((r) => ({ ok: r.ok, clean: !r.step && !r.hints })));
}

// ------------------------------------------------------------------ Limbus Wordle
const GW_TRIES = 8;
const GW_COLS = ["Sinner", "Season", "Rarity", "Archetype", "Damage", "Faction"];
const gw = { game: null, ids: [] };
window.addEventListener("hashchange", () => { if (!location.hash.startsWith("#/gamewordle")) gw.game = null; });

routes.gamewordle = async (args = []) => {
  gw.game = null;
  gmCrumb("wordle");
  $("#main").innerHTML = `<h1>Limbus Wordle</h1><div class="sub">Reading the game's files…</div>`;
  gw.ids = await gxIds();
  if (!location.hash.startsWith("#/gamewordle")) return;
  gwDrawStart();
  if (args[0] === "daily" && gmDailyDone("wordle") == null && gw.ids.length) gwNew(true);
};

function gwDrawStart() {
  $("#main").innerHTML = `<h1>Limbus Wordle</h1>
    <div class="sub">One Identity is hidden. Name any Identity — every try shows what it has in common with the hidden one. ${GW_TRIES} tries.</div>
    ${!gw.ids.length ? `<p class="muted">Nothing to ask yet: the game's files or a snapshot are missing.</p>` : `
    <div class="gmstart"><span class="gmscore">${gw.ids.length} IDENTITIES · BEST <i>${gx.wordle.best ? `${gx.wordle.best} / ${GW_TRIES}` : "—"}</i> · SOLVED <i>${gx.wordle.wins || 0}</i> OF ${gx.wordle.played || 0}</span>
      ${gmDailyBtn("wordle")}<button class="gmbtn" id="gwgo">Start</button></div>
    <div class="gwlegend"><span class="gwcell ok">the same</span><span class="gwcell part">partly: shares one of them</span><span class="gwcell">different</span>
      <span class="muted small">Season and rarity also say where to look: ↑ the hidden one came out later / is rarer, ↓ earlier / less rare.</span></div>`}`;
  if ($("#gwgo")) $("#gwgo").onclick = () => gwNew();
  if ($("#gmdaily")) $("#gmdaily").onclick = () => gmDailyDone("wordle") == null ? gwNew(true) : toast("Today's Daily is done — a new one comes with the daily reset.");
}

function gwNew(daily) {
  const rnd = daily === true ? gmSeed(gmDay() + "wordle") : Math.random;
  gw.game = { daily: daily === true, ans: gw.ids[Math.floor(rnd() * gw.ids.length)], tries: [], over: false };
  gwDraw();
}

// what a try has in common with the hidden Identity: a cell per column, [text, "ok" | "part" | ""]
function gwCells(x, a) {
  const set = (p, q) => { const same = p.length === q.length && p.every((v) => q.includes(v));
    return [p.join(", ") || "—", same ? "ok" : p.some((v) => q.includes(v)) ? "part" : ""]; };
  const arrow = (up) => up ? " ↑" : " ↓";
  return [[x.sub, x.sinner === a.sinner ? "ok" : ""],
    x.season === a.season ? [x.season, "ok"] : [x.season + (a.date === x.date ? "" : arrow(a.date > x.date)), ""],
    x.rank === a.rank ? ["0".repeat(x.rank), "ok"] : ["0".repeat(x.rank) + arrow(a.rank > x.rank), ""],
    set(x.kw, a.kw), set(x.atk, a.atk), set(x.assoc, a.assoc)];
}

function gwDraw() {
  const g = gw.game, a = g.ans, won = g.tries.includes(a);
  $("#main").innerHTML = `<h1>Limbus Wordle</h1>
    <div class="gmtop"><span class="gmscore">TRY <b>${Math.min(GW_TRIES, g.tries.length + (g.over ? 0 : 1))} / ${GW_TRIES}</b>${g.daily ? ` · DAILY ${gmDay()}` : ""}</span><span class="grow"></span>
      ${g.over ? `${g.daily ? `<button class="toggle" id="gwcopy">Copy the result</button>` : ""}<button class="toggle" id="gwback">Back</button><button class="gmbtn" id="gwagain">Play again</button>` : `<button class="toggle" id="gwquit">Give up</button>`}</div>
    ${g.over ? `<div class="gwend ${won ? "ok" : ""}"><img src="${a.pic}"><div><div class="gmkick">${won ? `SOLVED IN ${g.tries.length} / ${GW_TRIES}` : "NOT THIS TIME — IT WAS"}</div>
      <div class="gmq">${esc(a.title)}</div><span class="muted">${esc(a.sub)}</span> · <a href="#/db/${a.id}">Open in the database →</a></div></div>`
    : `<div class="gwtype"><input id="gwin" class="dbq" placeholder="Identity or Sinner…" autocomplete="off"><div id="gwsugg" class="gmsugg"></div></div>`}
    <div class="gwgrid"><div class="gwrow head"><span></span>${GW_COLS.map((c) => `<span>${c}</span>`).join("")}</div>
      ${g.tries.slice().reverse().map((x) => `<div class="gwrow"><span class="gwwho"><img src="${x.pic}"><span><b>${esc(x.title)}</b><i>${esc(x.sub)}</i></span></span>
        ${gwCells(x, a).map(([t, c]) => `<span class="gwcell ${c}">${esc(t)}</span>`).join("")}</div>`).join("")}</div>
    ${g.tries.length ? "" : `<p class="muted small">Start with any Identity — the row under the field shows what matched.</p>`}`;
  if ($("#gwin")) gxType($("#gwin"), $("#gwsugg"), () => gw.ids.filter((x) => !g.tries.includes(x)), gwTry);
  if ($("#gwquit")) $("#gwquit").onclick = () => gwEnd();
  if ($("#gwagain")) $("#gwagain").onclick = () => gwNew();
  if ($("#gwback")) $("#gwback").onclick = () => { gw.game = null; gwDrawStart(); };
  if ($("#gwcopy")) $("#gwcopy").onclick = () => gxCopy(`Limbus Archive · Limbus Wordle · Daily ${gmDay()}\n${won ? g.tries.length : "X"}/${GW_TRIES}\n`
    + g.tries.map((x) => gwCells(x, a).map(([, c]) => c === "ok" ? "🟩" : c === "part" ? "🟨" : "⬛").join("")).join("\n"));
}

function gwTry(key) {
  const g = gw.game, x = gw.ids.find((i) => i.key === key);
  if (!x || g.over || g.tries.includes(x)) return;
  g.tries.push(x);
  x === g.ans || g.tries.length >= GW_TRIES ? gwEnd() : gwDraw();
}

function gwEnd() {
  const g = gw.game, won = g.tries.includes(g.ans);
  g.over = true;
  gx.wordle.played = (gx.wordle.played || 0) + 1;
  if (won) {
    gx.wordle.wins = (gx.wordle.wins || 0) + 1;
    gx.wordle.best = Math.min(gx.wordle.best || 99, g.tries.length);
  }
  gxKeep();
  if (g.daily) gmDailyKeep("wordle", won ? `${g.tries.length} / ${GW_TRIES}` : `X / ${GW_TRIES}`);
  gwDraw();
}

// ------------------------------------------------------------------ Connections
const GC_MISS = 4, GC_KINDS = { sinner: "SINNER", kw: "ARCHETYPE", season: "SEASON", assoc: "FACTION" };
const gc = { game: null, ids: [], cats: [] };
window.addEventListener("hashchange", () => { if (!location.hash.startsWith("#/gameconn")) gc.game = null; });

routes.gameconn = async (args = []) => {
  gc.game = null;
  gmCrumb("conn");
  $("#main").innerHTML = `<h1>Connections</h1><div class="sub">Reading the game's files…</div>`;
  gc.ids = await gxIds();
  if (!location.hash.startsWith("#/gameconn")) return;
  // every group an Identity can belong to: its Sinner, archetypes, season, factions (the ones with four members or more)
  const by = {}, put = (kind, name, x) => { if (name && name !== "—") (by[kind + "|" + name] = by[kind + "|" + name] || { kind, name, has: new Set() }).has.add(x.key); };
  for (const x of gc.ids) {
    put("sinner", x.sub, x);
    put("season", x.season, x);
    x.kw.forEach((k) => put("kw", k, x));
    x.assoc.forEach((k) => put("assoc", k, x));
  }
  gc.cats = Object.values(by).filter((c) => c.has.size >= 4);
  gcDrawStart();
  if (args[0] === "daily" && gmDailyDone("conn") == null && gc.cats.length >= 4) gcNew(true);
};

function gcDrawStart() {
  const best = gx.conn.best;
  $("#main").innerHTML = `<h1>Connections</h1>
    <div class="sub">Sixteen Identities hide four groups of four: the same Sinner, archetype, season or faction. Pick four that belong together. ${GC_MISS} mistakes and it is over.</div>
    ${gc.cats.length < 4 ? `<p class="muted">Nothing to ask yet: the game's files or a snapshot are missing.</p>` : `
    <div class="dbrow"><button class="toggle ${gx.plain ? "" : "on"}" data-plain="">With names</button><button class="toggle ${gx.plain ? "on" : ""}" data-plain="1">Pictures only · harder</button></div>
    <div class="gmstart"><span class="gmscore">BEST <i>${best == null ? "—" : best ? `${best} MISS` : "PERFECT"}</i> · SOLVED <i>${gx.conn.wins || 0}</i> OF ${gx.conn.played || 0}</span>
      ${gmDailyBtn("conn")}<button class="gmbtn" id="gcgo">Start</button></div>
    <div class="muted small">An Identity may fit more than one group — there is only one way to split all sixteen.</div>`}`;
  document.querySelectorAll("[data-plain]").forEach((b) => b.onclick = () => { gx.plain = !!b.dataset.plain; gxKeep(); gcDrawStart(); });
  if ($("#gcgo")) $("#gcgo").onclick = () => gcNew();
  if ($("#gmdaily")) $("#gmdaily").onclick = () => gmDailyDone("conn") == null ? gcNew(true) : toast("Today's Daily is done — a new one comes with the daily reset.");
}

// a puzzle: four groups (no more than two of a kind) with four members each, and a single way to split the sixteen;
// of a few such, the one where the most Identities fit a group that isn't theirs
function gcMake(rnd) {
  const mix = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const byKey = new Map(gc.ids.map((x) => [x.key, x]));
  let best = null, found = 0;
  for (let n = 0; n < 600 && found < 10; n++) {
    const cats = [], kinds = {};
    for (const c of mix(gc.cats)) {
      if ((kinds[c.kind] || 0) >= 2 || cats.length >= 4) continue;
      kinds[c.kind] = (kinds[c.kind] || 0) + 1;
      cats.push(c);
    }
    if (cats.length < 4 || Object.keys(kinds).length < 3) continue;
    const used = new Set(), groups = [];
    for (const c of cats) {
      const mine = mix([...c.has].filter((k) => !used.has(k))).slice(0, 4);
      if (mine.length < 4) break;
      mine.forEach((k) => used.add(k));
      groups.push({ cat: c, keys: mine });
    }
    if (groups.length < 4) continue;
    // how many ways the sixteen split into these four groups (stops at two)
    const tiles = [...used];
    const count = (i, left) => {
      if (i === 4) return 1;
      const fit = left.filter((k) => cats[i].has.has(k));
      let ways = 0;
      const pick = (from, got) => {
        if (ways > 1) return;
        if (got.length === 4) { ways += count(i + 1, left.filter((k) => !got.includes(k))); return; }
        for (let j = from; j <= fit.length - (4 - got.length); j++) pick(j + 1, [...got, fit[j]]);
      };
      pick(0, []);
      return ways;
    };
    if (count(0, tiles) !== 1) continue;
    found++;
    const traps = tiles.reduce((s, k) => s + cats.filter((c) => c.has.has(k)).length - 1, 0);
    if (!best || traps > best.traps) best = { traps, groups };
  }
  if (!best) return null;
  const order = ["sinner", "kw", "season", "assoc"];
  best.groups.sort((a, b) => order.indexOf(a.cat.kind) - order.indexOf(b.cat.kind));
  return { groups: best.groups.map((gr, i) => ({ n: i, kind: gr.cat.kind, name: gr.cat.name, keys: gr.keys })), tiles: mix(best.groups.flatMap((gr) => gr.keys)).map((k) => byKey.get(k)) };
}

function gcNew(daily) {
  const made = gcMake(daily === true ? gmSeed(gmDay() + "conn") : Math.random);
  if (!made) return toast("Could not make a puzzle from the game's files.");
  gc.game = { daily: daily === true, plain: gx.plain && daily !== true, ...made, found: [], sel: new Set(), miss: 0, tries: [], over: false };
  gcDraw();
}

function gcDraw() {
  const g = gc.game, left = g.tiles.filter((x) => !g.found.some((gr) => gr.keys.includes(x.key))), won = g.found.length === 4 && g.miss < GC_MISS;
  const bar = (gr) => `<div class="gcbar c${gr.n}"><small>${GC_KINDS[gr.kind]}</small><b>${esc(gr.name)}</b><span>${gr.keys.map((k) => esc(g.tiles.find((x) => x.key === k).title)).join(" · ")}</span></div>`;
  $("#main").innerHTML = `<h1>Connections</h1>
    <div class="gmtop"><span class="gmscore">MISTAKES LEFT <b>${"●".repeat(GC_MISS - g.miss)}${"○".repeat(g.miss)}</b>${g.daily ? ` · DAILY ${gmDay()}` : ""}</span><span class="grow"></span>
      ${g.over ? `${g.daily ? `<button class="toggle" id="gccopy">Copy the result</button>` : ""}<button class="toggle" id="gcback">Back</button><button class="gmbtn" id="gcagain">Play again</button>`
      : `<button class="toggle" id="gcmix">Shuffle</button><button class="toggle" id="gcnone" ${g.sel.size ? "" : "disabled"}>Deselect</button><button class="gmbtn" id="gcsend" ${g.sel.size === 4 ? "" : "disabled"}>Submit</button>`}</div>
    ${g.over ? `<div class="gmkick gcend">${won ? (g.miss ? `SOLVED WITH ${g.miss} MISTAKE${g.miss > 1 ? "S" : ""}` : "PERFECT — NO MISTAKES") : "OUT OF MISTAKES — THE GROUPS WERE"}</div>` : ""}
    <div class="gcbox">${g.found.map(bar).join("")}
      <div class="gcgrid">${left.map((x) => `<button class="gctile ${g.sel.has(x.key) ? "on" : ""} ${g.plain ? "plain" : ""}" data-k="${x.key}"><img src="${x.pic}" onerror="this.remove()">${g.plain ? "" : `<b>${esc(x.title)}</b><i>${esc(x.sub)}</i>`}</button>`).join("")}</div></div>`;
  document.querySelectorAll(".gctile").forEach((b) => b.onclick = () => {
    const k = b.dataset.k;
    g.sel.has(k) ? g.sel.delete(k) : g.sel.size < 4 && g.sel.add(k);
    gcDraw();
  });
  if ($("#gcmix")) $("#gcmix").onclick = () => { g.tiles = g.tiles.map((x) => [Math.random(), x]).sort((a, b) => a[0] - b[0]).map((p) => p[1]); gcDraw(); };
  if ($("#gcnone")) $("#gcnone").onclick = () => { g.sel.clear(); gcDraw(); };
  if ($("#gcsend")) $("#gcsend").onclick = gcSend;
  if ($("#gcagain")) $("#gcagain").onclick = () => gcNew();
  if ($("#gcback")) $("#gcback").onclick = () => { gc.game = null; gcDrawStart(); };
  if ($("#gccopy")) $("#gccopy").onclick = () => gxCopy(`Limbus Archive · Connections · Daily ${gmDay()}\n${won ? (g.miss ? `${g.miss} mistake${g.miss > 1 ? "s" : ""}` : "perfect") : "lost"}\n`
    + g.tries.map((t) => t.map((n) => ["🟨", "🟩", "🟦", "🟪"][n]).join("")).join("\n"));
}

function gcSend() {
  const g = gc.game, sel = [...g.sel], open = g.groups.filter((gr) => !g.found.includes(gr));
  g.tries.push(sel.map((k) => g.groups.find((gr) => gr.keys.includes(k)).n));
  const hit = open.find((gr) => sel.every((k) => gr.keys.includes(k)));
  g.sel.clear();
  if (hit) g.found.push(hit);
  else {
    g.miss++;
    if (g.miss < GC_MISS) toast(open.some((gr) => sel.filter((k) => gr.keys.includes(k)).length === 3) ? "One away…" : "Not a group.");
  }
  if (g.found.length === 4 || g.miss >= GC_MISS) {
    const won = g.miss < GC_MISS;
    g.over = true;
    open.filter((gr) => !g.found.includes(gr)).forEach((gr) => g.found.push(gr));
    gx.conn.played = (gx.conn.played || 0) + 1;
    if (won) {
      gx.conn.wins = (gx.conn.wins || 0) + 1;
      gx.conn.best = Math.min(gx.conn.best == null ? 99 : gx.conn.best, g.miss);
    }
    gxKeep();
    if (g.daily) gmDailyKeep("conn", won ? (g.miss ? `${g.miss} MISS` : "PERFECT") : "LOST");
  }
  gcDraw();
}
