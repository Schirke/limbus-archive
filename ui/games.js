// Games: the page with a card per game (gmHub), and the line under the menu inside a game (gmCrumb).
// Games → Guess the track: a piece of the game's soundtrack (the corner player's list, music.js) from a random spot;
// it opens in steps (1, 3, 7, 15 s) and the sooner it is named the more it is worth.
"use strict";

const GM_KEEP = "games", GM_STEPS = [1, 3, 7, 15], GM_WORTH = [1000, 750, 500, 250], GM_ROUNDS = 10;
const gm = { battle: true, hard: false, group: "", how: "", best: {},
  ...(() => { try { return JSON.parse(localStorage.getItem(GM_KEEP) || "{}"); } catch { return {}; } })(), game: null };
const gmAudio = new Audio();
const gmKeep = () => { try { localStorage.setItem(GM_KEEP, JSON.stringify({ battle: gm.battle, hard: gm.hard, group: gm.group, how: gm.how, best: gm.best, vol: gm.vol })); } catch {} };
// how loud the games by ear play (the track, the Identity, the character): a slider under the disc (the corner player's volume until it is moved)
const gmVol = () => gm.vol != null ? +gm.vol : (typeof mu !== "undefined" && mu.vol) || 0.6;
const gmGroup = (t) => /^Canto \d+$/.test(t.where) ? t.where : "Other";
const gmPool = () => mu.tracks.map((t, n) => ({ t, n })).filter(({ t }) => t.ms > 40000 && (!gm.battle || t.battle) && (!gm.group || gmGroup(t) === gm.group));
const gmSub = (t) => t.where || t.by || "";
const gmMode = () => (gm.battle ? "b" : "a") + (gm.hard ? "h" : "e") + gm.how + gm.group;
// how the piece is played (gm.how): as it is, backwards, sped up, or with another track over it
const GM_HOW = [["", "As it is"], ["rev", "Backwards"], ["fast", "Sped up"], ["two", "Two at once"]], GM_FAST = 1.6;
// the piece of a round for "Backwards" / "Two at once": the longest step's worth of the track cut out (turned
// around, or mixed with the same of another track) as a sound file of its own -> its object URL, null when it failed
let gmCtx = null;
async function gmClip(url, start, rev, url2, start2) {
  try {
    gmCtx = gmCtx || new (window.AudioContext || window.webkitAudioContext)();
    const read = async (u) => gmCtx.decodeAudioData(await (await fetch(u)).arrayBuffer());
    const a = await read(url), b = url2 ? await read(url2) : null, sr = a.sampleRate, n = Math.floor(GM_STEPS[GM_STEPS.length - 1] * sr);
    const out = new Int16Array(n * 2), oa = Math.floor(start * sr), ob = Math.floor((start2 || 0) * sr);
    for (let c = 0; c < 2; c++) {
      const da = a.getChannelData(Math.min(c, a.numberOfChannels - 1)), db = b && b.getChannelData(Math.min(c, b.numberOfChannels - 1));
      for (let i = 0; i < n; i++) {
        const v = db ? ((da[oa + i] || 0) + (db[ob + i] || 0)) * 0.6 : da[oa + i] || 0;
        out[(rev ? n - 1 - i : i) * 2 + c] = Math.max(-1, Math.min(1, v)) * 32767;
      }
    }
    const h = new DataView(new ArrayBuffer(44)), text = (at, s) => [...s].forEach((ch, i) => h.setUint8(at + i, ch.charCodeAt(0)));
    text(0, "RIFF"); h.setUint32(4, 36 + out.byteLength, true); text(8, "WAVEfmt "); h.setUint32(16, 16, true); h.setUint16(20, 1, true); h.setUint16(22, 2, true);
    h.setUint32(24, sr, true); h.setUint32(28, sr * 4, true); h.setUint16(32, 4, true); h.setUint16(34, 16, true); text(36, "data"); h.setUint32(40, out.byteLength, true);
    return URL.createObjectURL(new Blob([h, out], { type: "audio/wav" }));
  } catch { return null; }
}
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
  return `<button class="toggle gmdaily" id="gmdaily" ${off ? "disabled" : ""} title="The same ten rounds for everybody today, on fixed settings">Daily challenge${done == null ? "" : ` · done: ${done}`}</button>`
    + gmDuelBtns(game, "gmdaily"); };
// a duel is played by a link (each in their own time) or live (a room, everybody at once: games6.js)
const gmDuelBtns = (game, cls = "") => `<a class="toggle ${cls}" href="${GM_GAMES.find(([k]) => k === game)[1]}/duel" title="${GM_DUEL}">${GM_SWORDS}Duel · by link</a>`
  + `<a class="toggle ${cls}" href="#/live/new/${game}" title="A room for two to eight: everybody plays the same rounds at the same time">${GM_SWORDS}Duel · live</a>`;
const GM_DUEL = "A game to send to a friend: play it, then copy the link with your result — the link opens the same rounds";
// log: [{ok, clean}] — a square per round: right at once, right with hints or more of the piece, missed
function gmShare(title, score, log) {
  const text = `Limbus Archive · ${title} · Daily ${gmDay()}\n${score} pts · ${log.filter((r) => r.ok).length}/${log.length}\n${log.map((r) => r.ok ? (r.clean ? "🟩" : "🟨") : "⬛").join("")}`;
  gmCopy(text);
}
function gmCopy(text) {
  const done = () => toast("Copied — paste it anywhere.");
  const old = () => { const t = document.createElement("textarea"); t.value = text; document.body.appendChild(t); t.select(); document.execCommand("copy"); t.remove(); done(); };
  navigator.clipboard?.writeText ? navigator.clipboard.writeText(text).then(done, old) : old();
}

// A duel: a Daily challenge drawn from a seed of its own instead of the day — the same rounds for whoever opens the
// link "<game>/duel/<seed>.<the sender's result>". Played on the Daily's fixed settings; it leaves today's Daily alone.
const GM_SITE = "https://limbus.shpep.workers.dev";
let gmDuelNext = null;
// what a game's page was opened for (the part of the address after the game): true = start the challenge at once
function gmAuto(game, args) {
  gmDuelNext = null;
  if (args[0] !== "duel") return args[0] === "daily" && gmDailyDone(game) == null;
  const [seed, their] = (args[1] || "").split(".");
  gmDuelNext = { game, seed: /^[a-z0-9]{4,12}$/.test(seed || "") ? seed : Math.random().toString(36).slice(2, 8).padEnd(6, "0"),
    their: their ? their.replace(/_/g, " ").replace(/-/g, "/").slice(0, 14) : null };
  return true;
}
const gmDuelTake = (game) => { const d = gmDuelNext && gmDuelNext.game === game ? gmDuelNext : null; gmDuelNext = null; if (d) setTimeout(() => gmDuelBar(game, d)); return d; };
const gmDuelLink = (game, d, mine) => `${GM_SITE}/${GM_GAMES.find(([k]) => k === game)[1]}/duel/${d.seed}${mine == null ? "" : "." + String(mine).replace(/ /g, "_").replace(/\//g, "-")}`;
// A duel by link has its invite from the first round on, next to the game's name: the link opens the same rounds, so
// it can be sent before the game is finished (the result page's link carries the result too). Not for a live match,
// which has its panel instead. It stays over the game's redraws and goes when the page is left.
function gmDuelBar(game, d) {
  $("#gmduelbar") && $("#gmduelbar").remove();
  const h1 = $("#main h1");
  if (!h1 || (typeof gl !== "undefined" && gl.match) || !location.hash.includes("/duel")) return;
  const el = document.createElement("div"), box = h1.getBoundingClientRect(), text = document.createRange();
  text.selectNodeContents(h1);
  el.id = "gmduelbar";
  el.style.cssText = `top:${box.top + scrollY - 4}px;left:${text.getBoundingClientRect().right + scrollX + 36}px`;
  el.innerHTML = `<span class="gmscore">${GM_SWORDS} DUEL${d.their == null ? " · THE SAME ROUNDS FOR A FRIEND" : ` · THEIRS <i>${esc(d.their)}</i>`}</span><button class="toggle" id="gmduelinv">Copy the invite link</button>`;
  document.body.appendChild(el);
  $("#gmduelinv").onclick = () => gmCopy(`Limbus Archive · ${GM_GAMES.find(([k]) => k === game)[2]} · Duel\nThe same rounds for both of us — play and compare:\n${gmDuelLink(game, d)}`);
}
window.addEventListener("hashchange", () => { if (!location.hash.includes("/duel")) $("#gmduelbar") && $("#gmduelbar").remove(); });
const gmDaySeed = (game, duel) => gmSeed((duel ? "duel" + duel.seed : gmDay()) + game);
// the end of a daily game (g.daily; g.duel when it is a duel): its result is kept, shown and copied
function gmDailyOver(game, g, score) { if (g.duel) g.duel.mine = score; else gmDailyKeep(game, score); }

// Lunacy: what the games pay and Extraction spends (kept in the browser, like the scores). A finished game pays by
// how well it went; a Daily pays a pull's worth, the first one of a day adds for the days in a row, all of a day's
// add a ten; a duel won and the achievements (GM_ACH, once each) pay too.
const GM_PULL = 130, GM_WALLET = "games_wallet";
const gmW = { lunacy: 10 * GM_PULL, streak: 0, day: "", ach: {}, played: {}, pulls: 0, r3: 0, ego: 0, feat: 0,
  ...(() => { try { return JSON.parse(localStorage.getItem(GM_WALLET) || "{}"); } catch { return {}; } })() };
// the lunacy as the game shows it: its own icon (cut from the game's files, /api/gacha_ui) and its red
const GM_LUNIMG = `<img class="lunicon" src="/api/gacha_ui?n=icon_lunacy" alt="lunacy" onerror="this.remove()">`;
// (the count next to Extraction in the top menu)
// (the top menu has little room: 5,230 is shown as 5.2k, rounded down; the exact count is in the hint)
const gmLunShort = (n) => n < 1000 ? String(n) : n < 1e6 ? (Math.floor(n / 100) / 10) + "k" : (Math.floor(n / 1e5) / 10) + "m";
const gmLunDraw = () => { const el = document.querySelector("#navlun"); if (el) el.innerHTML = `${GM_LUNIMG}<b title="${gmW.lunacy.toLocaleString("en")} lunacy">${gmLunShort(gmW.lunacy)}</b>`; };
const gmWKeep = () => { try { localStorage.setItem(GM_WALLET, JSON.stringify(gmW)); } catch {} gmLunDraw(); };
gmLunDraw();
// [key, name, what it takes, lunacy]
const GM_ACH = [["first", "First steps", "Finish any game", 130], ["daily", "Daily bread", "Finish a Daily challenge", 260],
  ["allday", "Clocked in", "Finish every Daily of one day", 1300], ["streak3", "Three in a row", "A Daily three days running", 390],
  ["streak7", "A full week", "A Daily seven days running", 1300], ["streak30", "Company loyalty", "A Daily thirty days running", 6500],
  ["perfect", "Ten of ten", "Every round right in a guessing game", 650], ["hard", "The hard way", "10,000 or more in a Hard game", 650],
  ["wordle3", "Mind reader", "Limbus Wordle in three tries or fewer", 650], ["connp", "No loose ends", "Connections without a mistake", 650],
  ["gridfull", "Nine of nine", "A full Limbus Grid", 650], ["oddp", "Sharp eye", "10,000 in Odd one out", 650], ["duel", "Duelist", "Beat a friend's result in a duel", 390],
  ["every", "Jack of all trades", "Play every game once", 1300], ["r3", "Gold", "Extract a 000", 130], ["feat", "The one I wanted", "Extract the featured 000", 650],
  ["ego10", "Collector", "Extract ten E.G.O", 650], ["pulls100", "Just one more ten", "A hundred pulls", 1300]];
// pays for what happened; `got`: [lunacy, why] lines, achievements by key — one message for all of it
function gmPay(got, ach = []) {
  for (const k of ach) { const a = GM_ACH.find((x) => x[0] === k); if (a && !gmW.ach[k]) { gmW.ach[k] = gmDay(); got.push([a[3], `★ ${a[1]}`]); } }
  got = got.filter(([n]) => n > 0);
  if (!got.length) return gmWKeep();
  gmW.lunacy += got.reduce((s, [n]) => s + n, 0);
  gmWKeep();
  toast(got.map(([n, why]) => `<b>+${n}</b> lunacy · ${esc(why)}`).join("<br>") + `<br><span class="small">You have ${gmW.lunacy.toLocaleString("en")} — <a href="#/gamegacha">Extraction</a></span>`, 7000);
}
// The grade a finished game gets, by its share of the most it could have scored (Vlad's names and steps: of 10,000 —
// up to 3,000 LARP, 4,000-5,000 Tourist, 6,000-8,000 Limbus enjoyer, 9,000 and more Dantehhh; a Hard game counts
// of 20,000, the puzzles by their own measure)
const GM_GRADES = [[0.9, "Dantehhh"], [0.6, "Limbus enjoyer"], [0.4, "Tourist"], [0, "LARP"]];
function gmGrade(q) {
  const at = GM_GRADES.findIndex(([from]) => q >= from);
  return { name: GM_GRADES[at][1], tier: GM_GRADES.length - 1 - at };
}
// the end of any game: its Daily / duel result is kept, it is graded, and it pays
function gmOver(game, g, score) {
  const daily = g.daily && !g.duel, firstToday = daily && gmDailyDone(game) == null;
  if (g.daily) gmDailyOver(game, g, score);
  if (g.paid) return;
  g.paid = true;
  setTimeout(() => typeof glOver === "function" && glOver(game, g, score));  // (a live match hears of it, with the grade set below)
  const hard = game === "track" ? gm.hard : ["id", "skill", "char"].includes(game) ? gi.hard : ["enemy", "splash", "atlas"].includes(game) ? gp.hard : !!g.hard;
  const num = typeof score === "number", wordle = game === "wordle" && g.tries.includes(g.ans), conn = game === "conn" && g.miss < GC_MISS;
  const q = game === "wordle" ? (wordle ? (GW_TRIES + 1 - g.tries.length) / GW_TRIES : 0) : game === "conn" ? (conn ? 1 - g.miss / GC_MISS : 0)
    : game === "grid" ? Math.min(1, score / 2500) : num ? Math.min(1, score / 10000) : 0;
  // (the grade: a Hard game's points are doubled, so it is measured against twice as much)
  g.grade = gmGrade(game === "grid" ? g.got.filter(Boolean).length / 9 : num && hard ? Math.min(1, score / 20000) : q);  // (a grid: by its cells)
  setTimeout(() => {  // (the result's page is drawn by the game right after this)
    const top = $("#main .gmtop");
    if (top && !$("#main .gmgrade")) top.insertAdjacentHTML("beforebegin", `<div class="gmgrade t${g.grade.tier}"><small>YOUR GRADE</small><b>${g.grade.name}</b></div>`);
  });
  const got = [[Math.max(10, Math.round(q * 10) * 10), "a game played"]], ach = ["first"], rounds = Array.isArray(g.log) && g.log.length >= 10;
  gmW.played[game] = 1;
  if (GM_SCORED.every(([k]) => gmW.played[k])) ach.push("every");
  if (rounds && game !== "odd" && g.log.every((r) => r.ok)) ach.push("perfect");
  if (num && score >= 10000 && hard) ach.push("hard");
  if (wordle && g.tries.length <= 3) ach.push("wordle3");
  if (conn && !g.miss) ach.push("connp");
  if (game === "grid" && !g.got.includes(null)) ach.push("gridfull");
  if (game === "odd" && score >= 10000) ach.push("oddp");
  if (g.duel && g.duel.their != null && /^\d+$/.test(g.duel.their) && num && score > +g.duel.their) { got.push([200, "a duel won"]); ach.push("duel"); }
  if (firstToday) {
    got.push([GM_PULL, "a Daily challenge"]);
    ach.push("daily");
    const today = gmDay(), before = new Date(new Date(today + "T12:00:00Z") - 864e5).toISOString().slice(0, 10);
    if (gmW.day !== today) {  // the first Daily of the day: the days in a row
      gmW.streak = gmW.day === before ? gmW.streak + 1 : 1;
      gmW.day = today;
      if (gmW.streak > 1) got.push([50 * Math.min(10, gmW.streak), `${gmW.streak} days in a row`]);
      for (const n of [3, 7, 30]) if (gmW.streak >= n) ach.push("streak" + n);
    }
    if (GM_SCORED.every(([k]) => gmDailyDone(k) != null)) { got.push([10 * GM_PULL, "every Daily of the day"]); ach.push("allday"); }
  }
  gmPay(got, ach);
}
function gmDayTag(g) {
  if (!g.duel) return `DAILY ${gmDay()}`;
  const d = g.duel, num = (v) => /^\d+$/.test(String(v)) ? +v : null, a = num(d.mine), b = num(d.their);
  return `${GM_SWORDS} DUEL${d.their == null ? "" : ` · THEIRS <i>${esc(d.their)}</i>${a == null || b == null ? "" : a > b ? " · <b>YOU WIN</b>" : a < b ? " · <b>THEY WIN</b>" : " · <b>A DRAW</b>"}`}`;
}
const GM_SWORDS = `<svg class="gmswords" viewBox="0 0 24 24"><path d="M4 3l10.5 10.5M4 3v3.2M4 3h3.2M12 16l3-3M13.2 17.8l4.6-4.6M16.5 16.5L20.5 20.5"/><path d="M20 3L9.5 13.5M20 3v3.2M20 3h-3.2M12 16l-3-3M10.8 17.8l-4.6-4.6M7.5 16.5L3.5 20.5"/></svg>`;
// (a duel's result is only worth something sent: its button is the one to see — every result page marks it by this text)
const gmCopyLabel = (g) => g.duel ? `${GM_SWORDS}<span class="gmduelcopy">Copy the duel link — send it to a friend</span>` : "Copy the result";
function gmCopyResult(game, g, share) {
  if (!g.duel) return share();
  const name = GM_GAMES.find(([k]) => k === game)[2];
  gmCopy(`Limbus Archive · ${name} · Duel\nMy result: ${g.duel.mine} — can you beat it?\n${gmDuelLink(game, g.duel, g.duel.mine)}`);
}

// a name as it is searched: without the marks over its letters ("Ryōshū" is found by "ryo", "Öufi" by "oufi")
const gmPlain = (s) => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
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
  if (gm.clip) URL.revokeObjectURL(gm.clip);
  gm.clip = null;
  gmAudio.playbackRate = 1;
  clearTimeout(gm.timer);
  cancelAnimationFrame(gm.raf);
  gmAudio.pause();
  document.body.classList.remove("quiz");
}
// (only when this game was on: the page a click leads to may have started its own game already, with its own seed)
window.addEventListener("hashchange", () => { if (!location.hash.startsWith("#/games/track") && (gm.game || gm.mine)) { gmStop(); gmWarmDrop(); gm.game = null; gmDailyEnd(); } });

// [game (the key of its Daily challenge), page, name, what it is, picture, a toy: no score, no Daily]
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
    gmIcon('<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.5 6h7M6 8.5v7M18 8.5v7M8.5 18h7"/>')],
  ["splash", "#/gamesplash", "Guess the art", "A small piece of an Identity's or an E.G.O's art that zooms out — whose art is it?",
    gmIcon('<rect x="3" y="3" width="18" height="18"/><rect x="11" y="6" width="7" height="7"/><path d="M11 13l-5 5M6 14.5V18h3.5"/>')],
  ["atlas", "#/gameatlas", "In pieces", "An Identity's moving art as the game keeps it — cut into parts on a sheet. The parts come in steps: who is it?",
    gmIcon('<circle cx="7" cy="7" r="3.2"/><rect x="13" y="4" width="7" height="5"/><path d="M4 14h6l-1 6H5z"/><path d="M14 13l6 2-3 5-4-2z"/>')],
  ["odd", "#/gameodd", "Odd one out", "Four Identities, three with something in common. Find the one that doesn't belong — and say what the others share.",
    gmIcon('<circle cx="6" cy="7" r="2.6"/><circle cx="12" cy="7" r="2.6"/><circle cx="18" cy="7" r="2.6"/><rect x="9.4" y="14.4" width="5.2" height="5.2"/>')],
  ["grid", "#/gamegrid", "Limbus Grid", "A 3 × 3 grid with a condition on every row and column — name an Identity for each cell. Nine tries.",
    gmIcon('<rect x="3" y="3" width="18" height="18"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18"/><path d="M10.6 12l1.1 1.1 1.9-2.2"/>')],
  ["gacha", "#/gamegacha", "Extraction", "The game's extraction, with its banners, chances, sounds and voices — paid with the lunacy the games give.",
    gmIcon('<rect x="4" y="3" width="11" height="15" rx="1"/><rect x="9" y="6" width="11" height="15" rx="1"/><path d="M14.5 10.5l1 2.1 2.2.3-1.6 1.5.4 2.2-2-1.1-2 1.1.4-2.2-1.6-1.5 2.2-.3z"/>'), true],
  ["dare", "#/gamedare", "Challenge roulette", "A random team and a rule to play it by — for a run that got too easy.",
    gmIcon('<circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4"/><circle cx="12" cy="12" r="2.2"/>'), true],
  ["mix", "#/gamemix", "Mixed up", "A piece of a track cut into parts and shuffled — listen and put them back in order.",
    gmIcon('<rect x="2.5" y="6" width="4.2" height="12"/><rect x="9.9" y="6" width="4.2" height="12"/><rect x="17.3" y="6" width="4.2" height="12"/><path d="M4.6 3.2c2.5-1.6 5-1.6 7.4 0M10.6 1.6L12 3.2l-1.9.9"/>')],
  ["buff", "#/gamebuff", "Guess the buff", "The effect of a buff or a debuff, as it looks on the one who has it — which one is it?",
    gmIcon('<path d="M12 2.5l2.2 5.6 5.8.4-4.5 3.8 1.5 5.8-5-3.2-5 3.2 1.5-5.8L4 8.5l5.8-.4z"/><path d="M12 19.5v2M5 20l1-1.6M19 20l-1-1.6"/>')],
  ["chain", "#/gamechain", "Chain", "From one Identity to another, each step sharing the Sinner or a faction with the one before — in the fewest links.",
    gmIcon('<rect x="2.5" y="8.5" width="9" height="7" rx="3.5"/><rect x="12.5" y="8.5" width="9" height="7" rx="3.5"/><path d="M9 12h6"/>')],
  ["jig", "#/gamejig", "Jigsaw", "An Identity's art cut into tiles and shuffled — put it together against the clock.",
    gmIcon('<rect x="3" y="3" width="8" height="8"/><rect x="13" y="13" width="8" height="8"/><rect x="14.5" y="2.2" width="7" height="7" transform="rotate(12 18 5.7)"/><rect x="3" y="13" width="8" height="8"/>')],
  ["when", "#/gamewhen", "When was it", "An Identity or an E.G.O — put the mark on the game's timeline where it came out. The closer, the more points.",
    gmIcon('<path d="M2.5 15h19M5 12.5v5M10 12.5v5M15 12.5v5M20 12.5v5"/><path d="M12.5 3.5a3 3 0 0 1 3 3c0 2.2-3 5-3 5s-3-2.8-3-5a3 3 0 0 1 3-3z"/>')],
  ["diff", "#/gamediff", "Spot the difference", "An Identity's art twice, the second one changed in a few spots — find them all before the time is up.",
    gmIcon('<rect x="2.5" y="5" width="8.5" height="14"/><rect x="13" y="5" width="8.5" height="14"/><circle cx="6.7" cy="10" r="1.6"/><path d="M4.500 16l2-2.500 2.500 2.500"/><path d="M15 16l2-2.500 2.500 2.500"/><path d="M16.200 8.800l2.600 2.600M18.800 8.800l-2.600 2.600"/>')],
  // (a game for two: no score, no Daily — the tile says what it is instead)
  ["who", "#/gamewho", "Guess who", "For two: the same 24 Identities and a hidden one each. Ask what the other's is, the game answers — name it first. Or play against the game.",
    gmIcon('<circle cx="8" cy="8" r="3.2"/><path d="M2.5 19c.6-3.2 2.8-5 5.5-5s4.900 1.800 5.500 5"/><path d="M16.2 8.2a2.3 2.3 0 1 1 3.4 2c-.8.4-1.2.9-1.2 1.800"/><path d="M18.4 14.6v.1"/>'), "FOR TWO"]];
const GM_SCORED = GM_GAMES.filter((g) => !g[5]);
// the games' page: the columns its tiles stand in
const GM_GROUPS = [["By ear", ["track", "id", "char", "mix"]], ["By eye", ["skill", "enemy", "canto", "splash", "atlas", "buff", "diff"]], ["Puzzles", ["wordle", "conn", "odd", "grid", "chain", "jig", "when"]], ["Toys", ["dare", "who"]]];
// Mode of the day: the game shown big on the games' page — another one after every daily reset, never a toy; each
// comes once before any comes again (the order is drawn anew for every round of them)
function gmOfDay() {
  const n = Math.floor((Date.now() + 3 * 3600e3) / 864e5), len = GM_SCORED.length, round = Math.floor(n / len);
  const order = (r) => { const rnd = gmSeed("mode" + r); return GM_SCORED.map((g) => [rnd(), g]).sort((a, b) => a[0] - b[0]).map((p) => p[1]); };
  const mine = order(round);
  if (mine[0] === order(round - 1)[len - 1]) [mine[0], mine[1]] = [mine[1], mine[0]];  // (not the same game two days running)
  return mine[n % len];
}
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
  if (typeof gzBest === "function" && gzBest(game) !== undefined) return gzBest(game);  // the games of games7.js
  const mine = (k) => /^s[he]\d/.test(k) ? "skill" : /^c[tv][he]$/.test(k) ? "char" : "id";
  return of(Object.fromEntries(Object.entries(gi.best || {}).filter(([k]) => mine(k) === game)));
}

function gmHub() {
  document.querySelector('#subnav [data-group="games"]').hidden = true;  // the tiles are the menu here
  const left = Math.ceil((new Date(gmDay() + "T21:00:00Z") - Date.now()) / 60000), done = GM_SCORED.filter(([k]) => gmDailyDone(k) != null).length;
  const mode = gmOfDay(), today = gmDailyDone(mode[0]), yesterday = new Date(new Date(gmDay() + "T12:00:00Z") - 864e5).toISOString().slice(0, 10);
  $("#main").innerHTML = `<div class="gmhubhead"><h1>Games</h1><input id="gmduel" class="dbq" placeholder="A duel link or a live room's code — paste, Enter" autocomplete="off"><a class="gmscore gmwallet" href="#/gamegacha" title="Games pay lunacy — spend it in Extraction">${GM_LUNIMG}<i class="lun">${gmW.lunacy.toLocaleString("en")}</i>${gmW.streak > 1 && [gmDay(), yesterday].includes(gmW.day) ? ` · <i>${gmW.streak}</i> DAYS IN A ROW` : ""}</a><span class="gmscore" title="The same ten rounds for everybody, new every day at the game's daily reset">DAILY CHALLENGE · NEW IN <i>${Math.floor(left / 60)} H ${left % 60} M</i> · TODAY <i>${done} / ${GM_SCORED.length}</i></span></div>
    <div class="gmtop"><div class="gmday"><a class="gmart" data-game="${mode[0]}" href="${mode[1]}">${mode[4]}</a><div class="gmdaybody">
      <div class="gmkick">MODE OF THE DAY</div><a class="gmname" href="${mode[1]}">${mode[2]}</a><p>${mode[3]}</p>
      <div class="gmscore">BEST ${gmBest(mode[0]) ? `<i>${gmBest(mode[0])}</i>` : "—"} &nbsp;·&nbsp; DAILY ${today == null ? "—" : `<i>${today}</i>`}</div>
      <div class="gmplay"><a class="gmbtn" href="${mode[1]}">Play</a>${today == null ? `<a class="toggle" href="${mode[1]}/daily" title="The same ten rounds for everybody today, on fixed settings">Daily</a>` : `<span class="toggle done">Daily ✓</span>`}${gmDuelBtns(mode[0])}</div></div></div>
      <div class="gmdailybox"><div class="gmkick">DAILY CHALLENGE</div><div class="gmdbig"><i>${done}</i> / ${GM_SCORED.length} today</div>
        <div class="gmddots">${GM_SCORED.map(([k, href, name]) => { const d = gmDailyDone(k); return d == null ? `<a href="${href}/daily" title="${esc(name)}: not played yet — start it"></a>` : `<span class="done" title="${esc(name)}: ${d}"></span>`; }).join("")}</div>
        <small>NEW IN ${Math.floor(left / 60)} H ${left % 60} M${gmW.streak > 1 && [gmDay(), yesterday].includes(gmW.day) ? ` · ${gmW.streak} DAYS IN A ROW` : ""}</small></div></div>
    <div class="gmcols">${GM_GROUPS.map(([group, keys]) => `<div><div class="gmgrp">${group}</div>${keys.map((key) => { const [k, href, name, , pic, toy] = GM_GAMES.find((g) => g[0] === key), best = toy ? 0 : gmBest(k), day = gmDailyDone(k);
      return `<div class="gmtile ${k === mode[0] ? "on" : ""}"><a class="gmtmain" href="${href}"><span class="gmtpic" data-game="${k}">${pic}</span><span><b>${name}</b><small>${toy ? (toy === true ? "A TOY" : toy) : `BEST ${best ? `<i>${best}</i>` : "—"}`}</small></span></a>
        ${toy ? "" : day == null ? `<a class="gmdot" href="${href}/daily" title="Today's Daily: not played yet — start it"></a>` : `<span class="gmdot done" title="Today's Daily: ${day}"></span>`}</div>`; }).join("")}</div>`).join("")}</div>
    <div class="gmgrp gmachhead">Achievements <small>${GM_ACH.filter(([k]) => gmW.ach[k]).length} / ${GM_ACH.length} · each pays lunacy once</small></div>
    <div class="gmach">${GM_ACH.map(([k, name, what, n]) => `<span class="${gmW.ach[k] ? "done" : ""}" title="${esc(what)}"><b>${esc(name)}</b><small>${esc(what)}</small><i>${gmW.ach[k] ? "✓" : "+" + n}</i></span>`).join("")}</div>`;
  // a duel link from a friend opens its game here too (the link itself leads to the website)
  $("#gmduel").onkeydown = (e) => {
    if (e.key !== "Enter") return;
    const v = e.target.value.trim(), m = /#\/[a-z/]+\/duel\/[\w.%-]+/.exec(v) || /#\/(live|gamewho|vsroom)\/[a-z0-9]{4,10}/i.exec(v), room = /^[a-z0-9]{4,10}$/i.test(v);
    m ? (location.hash = m[0]) : room ? (location.hash = "#/live/" + v.toLowerCase()) : toast("That is neither a duel link nor a room's code.");
  };
  gmHubPics();
}

// the games' pictures: three of the game's own for each game, the same ones for everybody (the preset of
// /api/game_cards, server.py CARD_PRESET; the web copy keeps them in a pack of its own). The mode of the day gets
// the first three that load, in the list's order, a tile the first one; the drawn icon stays until then (and where
// there are none).
function gmHubPics() {
  const some = (a) => a.slice(0, 6);
  const put = async (game, urls) => {
    const el = document.querySelector(`.gmart[data-game="${game}"]`), tile = document.querySelector(`.gmtpic[data-game="${game}"]`);
    if (tile && urls[0]) { const im = new Image(); im.onload = () => tile.isConnected && tile.replaceChildren(im); im.src = urls[0]; }
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
  const auto = gmAuto("track", args.slice(1));
  gmCrumb("track");
  if (!mu.tracks.length) mu.tracks = await api("/api/music").catch(() => []);
  if (!location.hash.startsWith("#/games/track")) return;
  gmDrawStart();
  if (auto && $("#gmdaily") && !$("#gmdaily").disabled) gmNew(true);
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
    <div class="dbrow">${GM_HOW.map(([k, name]) => chip(gm.how === k, `data-how="${k}"`, name)).join("")}</div>
    <div class="dbrow">${chip(!gm.group, 'data-g=""', "Everything")}${groups.map((g) => chip(gm.group === g, `data-g="${esc(g)}"`, esc(g))).join("")}</div>
    <div class="gmstart"><span class="gmscore">${n} TRACKS · BEST <i>${gm.best[gmMode()] || 0}</i></span>
      ${gmDailyBtn("track", !mu.tracks.some((t) => t.battle))}<button class="gmbtn" id="gmgo" ${n < 8 ? "disabled" : ""}>Start · ${GM_ROUNDS} rounds</button></div>
    <div class="muted small">Easy: four answers — the track's name, or where it plays for the tracks named by a number. Hard: type the name — points are doubled, and for the tracks named by a number their Canto or the enemy fought there counts too.</div>`}`;
  const main = $("#main"), set = (sel, key, f) => main.querySelectorAll(sel).forEach((b) => b.onclick = () => { gm[key] = f(b); gmKeep(); gmDrawStart(); });
  set("[data-b]", "battle", (b) => !!b.dataset.b);
  set("[data-h]", "hard", (b) => !!b.dataset.h);
  set("[data-how]", "how", (b) => b.dataset.how);
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
  const duel = daily === true ? gmDuelTake("track") : null;
  gmDailyEnd();
  if (daily === true) {
    gm.mine = { battle: gm.battle, hard: gm.hard, group: gm.group, how: gm.how };
    Object.assign(gm, { battle: true, hard: false, group: "", how: "" });
    gmRnd = gmDaySeed("track", duel);
  }
  const pool = gmPool();
  gm.game = { daily: daily === true, duel, pool, order: gmShuffle(pool.map((_, i) => i)).slice(0, GM_ROUNDS), round: -1, score: 0, streak: 0, top: 0, log: [] };
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
  const mine = () => gm.game === g && g.ans === ans;
  gmFetch(ans.n).then(async (u) => {
    g.real = u || "/api/music_audio?n=" + ans.n;
    if (gm.how === "rev" || gm.how === "two") {  // (the other track of "Two at once": any but this one, from a spot of its own)
      const over = gm.how === "two" && g.pool[(at + 1 + Math.floor(Math.random() * (g.pool.length - 1))) % g.pool.length];
      const clip = await gmClip(g.real, g.start, gm.how === "rev", over && "/api/music_audio?n=" + over.n, over && 5 + Math.random() * Math.max(1, over.t.ms / 1000 - 30));
      if (!mine()) return clip && URL.revokeObjectURL(clip);
      gm.clip = clip;
    }
    if (mine()) gmAudio.src = gm.clip || g.real;
  });
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
  gmAudio.currentTime = gm.clip ? 0 : g.start;
  gmAudio.playbackRate = gm.how === "fast" ? GM_FAST : 1;
  gmAudio.preservesPitch = false;
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
      const q = gmPlain(inp.value.trim());
      const hits = q.length < 2 ? [] : g.pool.filter(({ t: o }) => gmPlain(o.name + " " + o.where + " " + o.who.join(" ")).includes(q));
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
  gmAudio.playbackRate = 1;
  if (gm.clip) {  // a cut-out piece gives way to the track itself, from the same spot
    gmAudio.onloadedmetadata = () => { gmAudio.currentTime = g.start; gmAudio.play().catch(() => {}); setTimeout(gmRing, 80); };
    gmAudio.src = g.real;
    URL.revokeObjectURL(gm.clip);
    gm.clip = null;
  } else gmAudio.play().catch(() => {});  // the track plays on until Next
  gmDrawRound();
  setTimeout(gmRing, 80);
}

function gmResult() {
  const g = gm.game;
  gmOver("track", g, g.score);
  const tag = g.daily ? gmDayTag(g) : "";
  gmDailyEnd();
  const mode = gmMode(), best = g.daily ? gm.best[mode] || 0 : Math.max(gm.best[mode] || 0, g.score), record = !g.daily && g.score > (gm.best[mode] || 0);
  if (!g.daily) gm.best[mode] = best;
  gmKeep();
  gmStop();
  gmWarmDrop();
  $("#main").innerHTML = `<h1>Guess the track</h1>
    <div class="gmtop"><span class="gmbig">${g.score}</span><span class="gmscore">${g.log.filter((r) => r.ok).length} OF ${g.log.length} · BEST STREAK ×${g.top} · BEST <i>${best}</i>${record ? " · NEW RECORD" : ""}</span>
      <span class="grow"></span>${g.daily ? `<span class="gmscore">${tag}</span><button class="toggle" id="gmcopy">${gmCopyLabel(g)}</button>` : ""}<button class="toggle" id="gmback">Settings</button><button class="gmbtn" id="gmagain">Play again</button></div>
    <table class="gmlog"><tr><th>#</th><th>TRACK</th><th>YOUR ANSWER</th><th>AT</th><th>POINTS</th><th></th></tr>
    ${g.log.map((r, i) => { const t = mu.tracks[r.n]; return `<tr><td>${i + 1}</td><td>${esc(t.name)}<i>${esc(typeof muSub === "function" ? muSub(t) : t.where)}</i></td>
      <td class="${r.ok ? "ok" : "bad"}">${esc(r.said)}</td><td>${r.ok ? r.at + " s" : ""}</td><td>${r.points}</td><td><button class="toggle" data-play="${r.n}">▶ play</button></td></tr>`; }).join("")}</table>`;
  $("#gmagain").onclick = () => gmNew();
  if ($("#gmcopy")) $("#gmcopy").onclick = () => gmCopyResult("track", g, () => gmShare("Guess the track", g.score, g.log));
  $("#gmback").onclick = () => { gm.game = null; gmDrawStart(); };
  document.querySelectorAll("[data-play]").forEach((b) => b.onclick = () => { if (typeof muPlay === "function") { mu.min = false; muPlay(+b.dataset.play); } });
}
