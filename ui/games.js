// Games: the page with a card per game (gmHub), and the line under the menu inside a game (gmCrumb).
// Games → Guess the track: a piece of the game's soundtrack (the corner player's list, music.js) from a random spot;
// it opens in steps (1, 3, 7, 15 s) and the sooner it is named the more it is worth.
"use strict";

const GM_KEEP = "games", GM_STEPS = [1, 3, 7, 15], GM_WORTH = [1000, 750, 500, 250], GM_ROUNDS = 10;
const gm = { battle: true, hard: false, group: "", best: {},
  ...(() => { try { return JSON.parse(localStorage.getItem(GM_KEEP) || "{}"); } catch { return {}; } })(), game: null };
const gmAudio = new Audio();
const gmKeep = () => { try { localStorage.setItem(GM_KEEP, JSON.stringify({ battle: gm.battle, hard: gm.hard, group: gm.group, best: gm.best, vol: gm.vol })); } catch {} };
// how loud the game plays: its own slider under the disc (the corner player's volume until it is moved)
const gmVol = () => gm.vol != null ? +gm.vol : (typeof mu !== "undefined" && mu.vol) || 0.6;
const gmGroup = (t) => /^Canto \d+$/.test(t.where) ? t.where : "Other";
const gmPool = () => mu.tracks.map((t, n) => ({ t, n })).filter(({ t }) => t.ms > 40000 && (!gm.battle || t.battle) && (!gm.group || gmGroup(t) === gm.group));
const gmSub = (t) => t.where || t.by || "";
const gmMode = () => (gm.battle ? "b" : "a") + (gm.hard ? "h" : "e") + gm.group;
// Daily challenge: the same ten rounds for everybody until the game's daily reset (21:00 UTC) — every draw of a game
// goes through gmRnd, which a daily game seeds with the day; its first score of the day is kept, and the result can
// be copied as a line of squares.
let gmRnd = Math.random;
const gmDay = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
function gmSeed(text) {
  let h = 1779033703 ^ text.length;
  for (const c of text) { h = Math.imul(h ^ c.charCodeAt(0), 3432918353); h = h << 13 | h >>> 19; }
  let a = h >>> 0;
  return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const gmDailyDone = (game) => { try { return JSON.parse(localStorage.getItem("games_daily") || "{}")[gmDay() + game]; } catch { return undefined; } };
function gmDailyKeep(game, score) {
  try {
    const all = JSON.parse(localStorage.getItem("games_daily") || "{}"), day = gmDay();
    const today = Object.fromEntries(Object.entries(all).filter(([k]) => k.startsWith(day)));
    if (today[day + game] == null) today[day + game] = score;
    localStorage.setItem("games_daily", JSON.stringify(today));
  } catch {}
}
const gmDailyBtn = (game, off) => { const done = gmDailyDone(game);
  return `<button class="toggle gmdaily" id="gmdaily" ${off ? "disabled" : ""} title="The same ten rounds for everybody today, on fixed settings">Daily challenge${done == null ? "" : ` · done: ${done}`}</button>`; };
// log: [{ok, clean}] — a square per round: right at once, right with hints or more of the piece, missed
function gmShare(title, score, log) {
  const text = `Limbus Archive · ${title} · Daily ${gmDay()}\n${score} pts · ${log.filter((r) => r.ok).length}/${log.length}\n${log.map((r) => r.ok ? (r.clean ? "🟩" : "🟨") : "⬛").join("")}`;
  const done = () => toast("Copied — paste it anywhere.");
  const old = () => { const t = document.createElement("textarea"); t.value = text; document.body.appendChild(t); t.select(); document.execCommand("copy"); t.remove(); done(); };
  navigator.clipboard?.writeText ? navigator.clipboard.writeText(text).then(done, old) : old();
}

const gmShuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(gmRnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
// a track with a number for a name ("Canto VIII Battle 16") can't be told from its neighbours by ear alone
const gmNumbered = (t) => /Battle \d+$|battle theme( \d+)?$/.test(t.name);
// "SAIKAI (instrumental)" is the same piece as "SAIKAI": either answer names it, and they are never offered together
const gmSong = (t) => t.name.replace(/ \(instrumental\)$/, "");

// what a right answer is worth now: less with every step of the piece and every hint opened
const GM_HINT = 250;
const gmWorth = () => Math.max(100, GM_WORTH[gm.game.step] - GM_HINT * Object.keys(gm.game.hints).length) * (gm.hard ? 2 : 1);

// The rounds of a game are drawn at its start, so the tracks of the next ones are fetched while the current one is
// played and a round starts at once (the app makes a track's file at its first request, the site downloads it
// whole). gmWarm: a track's number -> a promise of its object URL (null when it could not be fetched).
const GM_AHEAD = 2, gmWarm = new Map();
function gmFetch(n) {
  if (!gmWarm.has(n)) gmWarm.set(n, fetch("/api/music_audio?n=" + n).then((r) => r.ok ? r.blob() : null).then((b) => b && URL.createObjectURL(b)).catch(() => null));
  return gmWarm.get(n);
}
function gmWarmDrop(keep = []) {
  for (const [n, p] of gmWarm) if (!keep.includes(n)) { gmWarm.delete(n); p.then((u) => u && URL.revokeObjectURL(u)); }
}

function gmStop() {
  clearTimeout(gm.timer);
  cancelAnimationFrame(gm.raf);
  gmAudio.pause();
  document.body.classList.remove("quiz");
}
window.addEventListener("hashchange", () => { if (!location.hash.startsWith("#/games/track")) { gmStop(); gmWarmDrop(); gm.game = null; gmDailyEnd(); } });

// [game (the key of its Daily challenge), page, name, what it is, picture]
const gmIcon = (d) => `<svg viewBox="0 0 24 24">${d}</svg>`;
const GM_GAMES = [
  ["track", "#/games/track", "Guess the track", "A piece of the game's soundtrack from a random spot — name it.",
    gmIcon('<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>')],
  ["id", "#/gameid", "Guess the Identity", "A voice line of an Identity or a boss, by ear or by its text — whose is it?",
    gmIcon('<rect x="5" y="2.5" width="14" height="19" rx="1.5"/><circle cx="12" cy="9.5" r="3"/><path d="M7.5 18c.6-2.6 2.4-4 4.5-4s3.9 1.4 4.5 4"/>')],
  ["char", "#/gamechar", "Guess the character", "A voiced line from the story — who says it? Everybody who speaks, from every Canto.",
    gmIcon('<path d="M4 4.5h16v11.5h-9l-5 4v-4H4z"/><path d="M10 8.6a2 2 0 1 1 2.9 1.8c-.6.3-.9.7-.9 1.4"/><path d="M12 13.6v.1"/>')],
  ["skill", "#/gameskill", "Guess the skill", "A skill's picture — whose skill is it?",
    gmIcon('<path d="M12 2.5l8.2 4.75v9.5L12 21.5l-8.2-4.75v-9.5z"/><path d="M8 16l8-8M12.5 8H16v3.5"/>')],
  ["enemy", "#/gameenemy", "Guess the enemy", "A silhouette that opens in steps — who is it? Or an Identity in big pixels.",
    gmIcon('<path d="M12 3a7 7 0 0 0-7 7v4l2 2v3h10v-3l2-2v-4a7 7 0 0 0-7-7z"/><circle cx="9.5" cy="11" r="1.5"/><circle cx="14.5" cy="11" r="1.5"/>')],
  ["canto", "#/gamecanto", "Guess the Canto", "A piece of a background from the story that zooms out — which Canto is it from?",
    gmIcon('<rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="M3 16l5-5 4 4 3-3 6 5"/><circle cx="16" cy="9" r="1.3"/>')],
  ["wordle", "#/gamewordle", "Limbus Wordle", "One hidden Identity, eight tries: each shows the Sinner, season, rarity, archetype, damage and faction it shares.",
    gmIcon('<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 17.5l2.5 2.5 4.5-5"/>')],
  ["conn", "#/gameconn", "Connections", "Sixteen Identities, four groups of four with something in common. Four mistakes allowed.",
    gmIcon('<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.5 6h7M6 8.5v7M18 8.5v7M8.5 18h7"/>')]];
document.querySelectorAll("#subnav [data-game]").forEach((a) => { a.innerHTML = GM_GAMES.find(([k]) => k === a.dataset.game)[4]; });

// the line under the menu inside a game: back to the games' page, the game's name, the other games by their pictures
function gmCrumb(game) {
  $("#gmcrumb").textContent = GM_GAMES.find(([k]) => k === game)[2];
  document.querySelectorAll("#subnav [data-game]").forEach((a) => a.classList.toggle("active", a.dataset.game === game));
}

// the best score of a game over all its settings ("games" / "games_id" keep one per mode)
function gmBest(game) {
  const of = (o) => Math.max(0, ...Object.values(o || {}));
  if (game === "track") return of(gm.best);
  if (typeof gxBest === "function" && gxBest(game) !== undefined) return gxBest(game);  // the games of games3.js
  const mine = (k) => /^s[he]\d/.test(k) ? "skill" : /^c[tv][he]$/.test(k) ? "char" : "id";
  return of(Object.fromEntries(Object.entries(gi.best || {}).filter(([k]) => mine(k) === game)));
}

function gmHub() {
  document.querySelector('#subnav [data-group="games"]').hidden = true;  // the cards are the menu here
  const left = Math.ceil((new Date(gmDay() + "T21:00:00Z") - Date.now()) / 60000), done = GM_GAMES.filter(([k]) => gmDailyDone(k) != null).length;
  $("#main").innerHTML = `<div class="gmhubhead"><h1>Games</h1><span class="gmscore" title="The same ten rounds for everybody, new every day at the game's daily reset">DAILY CHALLENGE · NEW IN <i>${Math.floor(left / 60)} H ${left % 60} M</i> · TODAY <i>${done} / ${GM_GAMES.length}</i></span></div>
    <div class="gmhub">${GM_GAMES.map(([k, href, name, what, pic]) => { const best = gmBest(k), day = gmDailyDone(k);
      return `<div class="gmcard"><a class="gmart" data-game="${k}" href="${href}">${pic}</a><div class="gmcbody"><a class="gmname" href="${href}">${name}</a><p>${what}</p>
        <div class="gmscore gmstat"><span>BEST ${best ? `<i>${best}</i>` : "—"}</span><span>DAILY ${day == null ? "—" : `<i>${day}</i>`}</span></div>
        <div class="gmplay"><a class="gmbtn" href="${href}">Play</a>${day == null ? `<a class="toggle" href="${href}/daily" title="The same ten rounds for everybody today, on fixed settings">Daily</a>` : `<span class="toggle done">Daily ✓</span>`}</div></div></div>`; }).join("")}</div>`;
  gmHubPics();
}

// the cards' pictures: three of the game's own for each game, the same ones for everybody (the preset of
// /api/game_cards, server.py CARD_PRESET; the web copy keeps them in a pack of its own). The first three that load
// are drawn, in the list's order; a card keeps its drawn icon until then (and where there are none).
function gmHubPics() {
  const some = (a) => a.slice(0, 6);
  const put = async (game, urls) => {
    const el = document.querySelector(`.gmart[data-game="${game}"]`);
    if (!el) return;
    const got = (await Promise.all(some(urls).map((u) => new Promise((ok) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => ok(null); im.src = u; }))))
      .filter(Boolean).slice(0, 3);
    if (got.length < 3 || !el.isConnected) return;
    el.classList.add("pics");
    el.replaceChildren(...got);
  };
  api("/api/game_cards").then((r) => { for (const [game, urls] of Object.entries(r || {})) if (Array.isArray(urls)) put(game, urls); }).catch(() => {});
}

routes.games = async (args = []) => {
  gmStop();
  gmWarmDrop();
  gm.game = null;
  if (args[0] !== "track") return gmHub();
  gmCrumb("track");
  if (!mu.tracks.length) mu.tracks = await api("/api/music").catch(() => []);
  if (!location.hash.startsWith("#/games/track")) return;
  gmDrawStart();
  if (args[1] === "daily" && gmDailyDone("track") == null && $("#gmdaily") && !$("#gmdaily").disabled) gmNew(true);
};

function gmDrawStart() {
  const all = mu.tracks.map((t, n) => ({ t, n })).filter(({ t }) => !gm.battle || t.battle);
  const groups = [...new Set(all.map(({ t }) => gmGroup(t)))].sort((a, b) => (parseInt(a.slice(6)) || 99) - (parseInt(b.slice(6)) || 99));
  if (gm.group && !groups.includes(gm.group)) gm.group = "";
  const n = gmPool().length, chip = (on, attr, text) => `<button class="toggle ${on ? "on" : ""}" ${attr}>${text}</button>`;
  $("#main").innerHTML = `<h1>Guess the track</h1>
    <div class="sub">A piece of the game's soundtrack plays from a random spot — name it. The sooner, the more points.</div>
    ${!mu.tracks.length ? `<p class="muted">The soundtrack isn't read yet: the game's sound files or a snapshot are missing.</p>` : `
    <div class="dbrow">${chip(gm.battle, 'data-b="1"', "Battle themes")}${chip(!gm.battle, 'data-b=""', "All tracks")}<span class="gap"></span>
      ${chip(!gm.hard, 'data-h=""', "Easy · 4 answers")}${chip(gm.hard, 'data-h="1"', "Hard · type the name")}</div>
    <div class="dbrow">${chip(!gm.group, 'data-g=""', "Everything")}${groups.map((g) => chip(gm.group === g, `data-g="${esc(g)}"`, esc(g))).join("")}</div>
    <div class="gmstart"><span class="gmscore">${n} TRACKS · BEST <i>${gm.best[gmMode()] || 0}</i></span>
      ${gmDailyBtn("track", !mu.tracks.some((t) => t.battle))}<button class="gmbtn" id="gmgo" ${n < 8 ? "disabled" : ""}>Start · ${GM_ROUNDS} rounds</button></div>
    <div class="muted small">Easy: four answers — the track's name, or where it plays for the tracks named by a number. Hard: type the name — points are doubled, and for the tracks named by a number their Canto or the enemy fought there counts too.</div>`}`;
  const main = $("#main"), set = (sel, key, f) => main.querySelectorAll(sel).forEach((b) => b.onclick = () => { gm[key] = f(b); gmKeep(); gmDrawStart(); });
  set("[data-b]", "battle", (b) => !!b.dataset.b);
  set("[data-h]", "hard", (b) => !!b.dataset.h);
  set("[data-g]", "group", (b) => b.dataset.g);
  if ($("#gmgo")) $("#gmgo").onclick = () => gmNew();
  if ($("#gmdaily")) $("#gmdaily").onclick = () => gmNew(true);
}

// a daily game runs on fixed settings (battle themes, Easy, everything); the player's own come back after it
function gmDailyEnd() {
  if (gm.mine) Object.assign(gm, gm.mine);
  gm.mine = null;
  gmRnd = Math.random;
}

function gmNew(daily) {
  gmDailyEnd();
  if (daily === true) {
    gm.mine = { battle: gm.battle, hard: gm.hard, group: gm.group };
    Object.assign(gm, { battle: true, hard: false, group: "" });
    gmRnd = gmSeed(gmDay() + "track");
  }
  const pool = gmPool();
  gm.game = { daily: daily === true, pool, order: gmShuffle(pool.map((_, i) => i)).slice(0, GM_ROUNDS), round: -1, score: 0, streak: 0, top: 0, log: [] };
  if (typeof muAudio !== "undefined") muAudio.pause();
  document.body.classList.add("quiz");  // the corner player would give the name away
  gmRound();
}

function gmRound() {
  const g = gm.game;
  gmStop();
  document.body.classList.add("quiz");
  if (++g.round >= g.order.length) return gmResult();
  const at = g.order[g.round], ans = g.pool[at];
  // wrong answers: the nearest tracks in the game's own order (the same Canto, as a rule), each name once
  const near = g.pool.map((p, i) => ({ p, d: Math.abs(i - at) })).filter((x) => x.d && gmSong(x.p.t) !== gmSong(ans.t)).sort((a, b) => a.d - b.d).slice(0, 10);
  const wrong = [];
  for (const x of gmShuffle(near)) if (wrong.length < 3 && !wrong.some((w) => gmSong(w.t) === gmSong(x.p.t))) wrong.push(x.p);
  const len = ans.t.ms / 1000;
  // a numbered track in Easy is asked by its Canto: four "Battle 0N" of one Canto would be a guess by number
  // (the wrong ones: three of the six chapters next to it in the game's order)
  const far = new Map();
  g.pool.forEach((p, i) => { const w = p.t.where; if (w && w !== ans.t.where) far.set(w, Math.min(far.get(w) ?? 1e9, Math.abs(i - at))); });
  const places = gmShuffle([...far].sort((x, y) => x[1] - y[1]).slice(0, 6).map((x) => x[0])).slice(0, 3);
  g.places = !gm.hard && gmNumbered(ans.t) && ans.t.where && places.length === 3 ? gmShuffle([ans.t.where, ...places]) : null;
  Object.assign(g, { ans, opts: gmShuffle([ans, ...wrong]), step: 0, hints: {}, done: null, start: 5 + gmRnd() * Math.max(1, len - 30), loading: true });
  const ahead = g.order.slice(g.round, g.round + 1 + GM_AHEAD).map((i) => g.pool[i].n);
  gmWarmDrop(ahead);
  ahead.reduce((p, n) => p.then(() => gmFetch(n)), Promise.resolve());  // one after another, this round's first
  gmAudio.onerror = null;
  gmAudio.removeAttribute("src");  // the last round's track must not play on while this one is fetched
  gmAudio.load();
  gmAudio.volume = gmVol();
  gmAudio.onloadedmetadata = () => { g.loading = false; gmPlay(); };
  gmFetch(ans.n).then((u) => { if (gm.game === g && g.ans === ans) gmAudio.src = u || "/api/music_audio?n=" + ans.n; });
  gmAudio.onerror = () => {  // unreadable: another track takes the round
    toast("This track could not be read from the game's files.");
    if ((g.fails = (g.fails || 0) + 1) > 4) { gmStop(); gmWarmDrop(); gm.game = null; return gmDrawStart(); }
    g.order[g.round--] = (at + 1) % g.pool.length;
    gmRound();
  };
  gmDrawRound();
}

function gmPlay() {
  const g = gm.game;
  clearTimeout(gm.timer);
  gmAudio.currentTime = g.start;
  gmAudio.play().catch(() => {});
  g.t0 = performance.now();
  gm.timer = setTimeout(() => { if (!g.done) gmAudio.pause(); gmRing(); }, GM_STEPS[g.step] * 1000);
  gmRing();
}

function gmRing() {
  const g = gm.game, el = $("#gmdisc");
  if (!g || !el) return;
  const part = g.done ? 1 : Math.min(1, (performance.now() - g.t0) / 1000 / GM_STEPS[g.step]);
  el.style.background = `conic-gradient(var(--gold) 0 ${part * 100}%, var(--line) ${part * 100}% 100%)`;
  $("#gmdisc div").textContent = g.loading ? "…" : gmAudio.paused ? "▶" : "⏸";
  cancelAnimationFrame(gm.raf);
  if (!gmAudio.paused && !g.done) gm.raf = requestAnimationFrame(gmRing);
}

function gmDrawRound() {
  const g = gm.game, t = g.ans.t, d = g.done, worth = gmWorth();
  // hints for points: the Canto (where it isn't the question or on the answers already), who is fought, the author
  const hints = [gm.hard && t.where ? ["canto", "CANTO", t.where] : 0, t.fights && t.fights <= 3 && t.who.length ? ["who", "FOUGHT", t.who.slice(0, 2).join(", ")] : 0,
    t.by ? ["by", "AUTHOR", t.by] : 0].filter(Boolean);
  const hint = ([k, label, val]) => g.hints[k] || d ? `<div class="gihint open"><small>${label}</small><b>${esc(val)}</b></div>`
    : `<button class="gihint" data-hint="${k}"><small>${label}</small><b>hidden</b><u>open · −${GM_HINT * (gm.hard ? 2 : 1)}</u></button>`;
  const steps = GM_STEPS.map((s, i) => `<span class="${i < g.step || d ? (i <= g.step ? "done" : "") : i === g.step ? "cur" : ""}">${s} s</span>`).join("");
  const opt = ({ t: o, n }) => `<button class="gmopt ${d ? (n === g.ans.n ? "ok" : n === d.pick ? "bad" : "dim") : ""}" data-n="${n}" ${d ? "disabled" : ""}><b>${esc(o.name)}</b><i>${esc(gmSub(o))}</i></button>`;
  const place = (w) => `<button class="gmopt ${d ? (w === t.where ? "ok" : w === d.pick ? "bad" : "dim") : ""}" data-w="${esc(w)}" ${d ? "disabled" : ""}><b>${esc(w)}</b></button>`;
  const fought = t.fights && t.fights <= 3 && t.who.length ? `Fought here: <b>${esc(t.who.slice(0, 2).join(", "))}</b> · ` : "";
  $("#main").innerHTML = `<h1>Guess the track</h1>
    <div class="gmtop"><span class="gmscore">ROUND <b>${g.round + 1} / ${g.order.length}</b></span><span class="grow"></span>
      <span class="gmscore">SCORE <b>${g.score}</b> &nbsp; STREAK <i>×${g.streak}</i></span><button class="toggle" id="gmquit">Quit</button></div>
    <div class="gmstage"><div><button id="gmdisc" class="gmdisc" title="Play it again"><div>…</div></button>
      <div class="gmsteps">${steps}</div>
      ${d || g.step >= GM_STEPS.length - 1 ? "" : `<button class="toggle gmmore" id="gmmore">Hear more · −${(GM_WORTH[g.step] - GM_WORTH[g.step + 1]) * (gm.hard ? 2 : 1)}</button>`}
      <label class="gmvol">Volume <input id="gmvol" type="range" min="0" max="1" step="0.01" value="${gmVol()}"></label>
      <div class="gihints">${hints.map(hint).join("")}</div></div>
    <div><div class="gmkick">${d ? (d.ok ? `+${d.points} · ANSWERED AT ${GM_STEPS[g.step]} s` : "MISSED") : `WORTH ${worth} NOW`}</div>
      <div class="gmq">${d ? esc(t.name) : gm.hard ? "Name the track" : g.places ? "Where does this play?" : "Which track is this?"}</div>
      ${gm.hard && !d ? `<input id="gmtype" class="dbq" placeholder="Track, Canto or enemy…" autocomplete="off"><div id="gmsugg" class="gmsugg"></div>
        <button class="toggle gmmore" id="gmskip">I don't know</button>`
      : gm.hard ? `<div class="gmopts"><div class="gmopt ${d.ok ? "ok" : "bad"}"><b>${esc(d.text || "—")}</b><i>your answer</i></div></div>`
      : `<div class="gmopts">${g.places ? g.places.map(place).join("") : g.opts.map(opt).join("")}</div>`}
      ${d ? `<div class="gmafter"><span>${fought}${esc([t.where, t.by].filter(Boolean).join(" · "))}</span><button class="gmbtn" id="gmnext">${g.round + 1 < g.order.length ? "Next" : "Result"}</button></div>` : ""}</div></div>`;
  $("#gmquit").onclick = () => { gmStop(); gmWarmDrop(); gm.game = null; gmDailyEnd(); gmDrawStart(); };
  $("#gmvol").oninput = (e) => { gmAudio.volume = gm.vol = +e.target.value; };
  $("#gmvol").onchange = gmKeep;
  $("#gmdisc").onclick = () => { if (g.loading) return; if (d) { gmAudio.paused ? gmAudio.play().catch(() => {}) : gmAudio.pause(); setTimeout(gmRing, 50); } else gmPlay(); };
  document.querySelectorAll("[data-hint]").forEach((b) => b.onclick = () => { g.hints[b.dataset.hint] = 1; gmDrawRound(); });
  if ($("#gmmore")) $("#gmmore").onclick = () => { g.step++; gmDrawRound(); if (!g.loading) gmPlay(); };
  if ($("#gmnext")) { $("#gmnext").onclick = gmRound; $("#gmnext").focus(); }
  if ($("#gmskip")) $("#gmskip").onclick = () => gmAnswer(null, "");
  document.querySelectorAll(".gmopts button").forEach((b) => b.onclick = () => b.dataset.w != null ? gmAnswerPlace(b.dataset.w) : gmAnswer(+b.dataset.n));
  if ($("#gmtype")) {
    const inp = $("#gmtype"), draw = () => {
      const q = inp.value.trim().toLowerCase();
      const hits = q.length < 2 ? [] : g.pool.filter(({ t: o }) => (o.name + " " + o.where + " " + o.who.join(" ")).toLowerCase().includes(q));
      $("#gmsugg").innerHTML = hits.map(({ t: o, n }) => `<div data-n="${n}" class="${n === hits[0].n ? "on" : ""}">${esc(o.name)}<i>${esc([o.where, o.fights && o.fights <= 3 ? o.who[0] : ""].filter(Boolean).join(" · "))}</i></div>`).join("");
      $("#gmsugg").querySelectorAll("div").forEach((r) => r.onclick = () => gmAnswer(+r.dataset.n));
    };
    inp.oninput = draw;
    inp.onkeydown = (e) => {  // arrows walk the list, Enter takes the marked one
      const rows = [...$("#gmsugg").children], at = rows.findIndex((r) => r.classList.contains("on"));
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
  gmRing();
}

function gmAnswerPlace(w) {
  gmScore(w === gm.game.ans.t.where, w, w);
}

function gmAnswer(pick, text) {
  const g = gm.game, a = g.ans.t, p = pick == null ? null : mu.tracks[pick];
  let ok = pick === g.ans.n || (!!p && gmSong(p) === gmSong(a));
  if (!ok && p && gm.hard && gmNumbered(a))  // the Canto or the enemy of a numbered track is as good as its number
    ok = (!!a.where && p.where === a.where) || (!!a.who[0] && p.who[0] === a.who[0]);
  gmScore(ok, pick, text ?? (p ? p.name : ""));
}

function gmScore(ok, pick, said) {
  const g = gm.game;
  const points = ok ? gmWorth() : 0;
  g.streak = ok ? g.streak + 1 : 0;
  g.top = Math.max(g.top, g.streak);
  g.score += points;
  g.done = { ok, pick, points, text: said };
  g.log.push({ n: g.ans.n, ok, points, at: GM_STEPS[g.step], said: said || "—", clean: !g.step && !Object.keys(g.hints).length });
  clearTimeout(gm.timer);
  gmAudio.play().catch(() => {});  // the track plays on until Next
  gmDrawRound();
  setTimeout(gmRing, 80);
}

function gmResult() {
  const g = gm.game;
  if (g.daily) gmDailyKeep("track", g.score);
  gmDailyEnd();
  const mode = gmMode(), best = g.daily ? gm.best[mode] || 0 : Math.max(gm.best[mode] || 0, g.score), record = !g.daily && g.score > (gm.best[mode] || 0);
  if (!g.daily) gm.best[mode] = best;
  gmKeep();
  gmStop();
  gmWarmDrop();
  $("#main").innerHTML = `<h1>Guess the track</h1>
    <div class="gmtop"><span class="gmbig">${g.score}</span><span class="gmscore">${g.log.filter((r) => r.ok).length} OF ${g.log.length} · BEST STREAK ×${g.top} · BEST <i>${best}</i>${record ? " · NEW RECORD" : ""}</span>
      <span class="grow"></span>${g.daily ? `<span class="gmscore">DAILY ${gmDay()}</span><button class="toggle" id="gmcopy">Copy the result</button>` : ""}<button class="toggle" id="gmback">Settings</button><button class="gmbtn" id="gmagain">Play again</button></div>
    <table class="gmlog"><tr><th>#</th><th>TRACK</th><th>YOUR ANSWER</th><th>AT</th><th>POINTS</th><th></th></tr>
    ${g.log.map((r, i) => { const t = mu.tracks[r.n]; return `<tr><td>${i + 1}</td><td>${esc(t.name)}<i>${esc(typeof muSub === "function" ? muSub(t) : t.where)}</i></td>
      <td class="${r.ok ? "ok" : "bad"}">${esc(r.said)}</td><td>${r.ok ? r.at + " s" : ""}</td><td>${r.points}</td><td><button class="toggle" data-play="${r.n}">▶ play</button></td></tr>`; }).join("")}</table>`;
  $("#gmagain").onclick = () => gmNew();
  if ($("#gmcopy")) $("#gmcopy").onclick = () => gmShare("Guess the track", g.score, g.log);
  $("#gmback").onclick = () => { gm.game = null; gmDrawStart(); };
  document.querySelectorAll("[data-play]").forEach((b) => b.onclick = () => { if (typeof muPlay === "function") { mu.min = false; muPlay(+b.dataset.play); } });
}
