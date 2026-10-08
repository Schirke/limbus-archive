// Games → When was it (an Identity or an E.G.O: put a mark on the game's timeline where it came out — the closer,
// the more points) and Guess who (for two: each has a hidden Identity out of the same 24; ask about the other's by
// what it is — the answers are the game's own — and name it first). Guess who is played in a room of the site's
// server (the live matches' rooms, games6.js) or against the game itself.
// Shares the styles, the Identities' list (gxIds) and the Daily challenge / duels of games.js / games3.js / games7.js.
"use strict";

// ------------------------------------------------------------------ When was it
const GT_ROUNDS = 10, GT_WORTH = 1000, GT_HINT = 250, GT_NEAR = 14, GT_FAR = [365, 240];  // (days off that still pay: Easy, Hard)
gz.when = gz.when || { best: {} };
const gt = { game: null, data: null };
window.addEventListener("hashchange", () => { if (!location.hash.startsWith("#/gamewhen")) gt.game = null; });
const gtDay = (iso) => Math.round(Date.parse(iso + "T00:00:00Z") / 864e5);
const gtIso = (day) => new Date(day * 864e5).toISOString().slice(0, 10);
const gtSay = (day) => new Date(day * 864e5).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

routes.gamewhen = async (args = []) => {
  gt.game = null;
  const auto = gmAuto("when", args);
  gmCrumb("when");
  $("#main").innerHTML = `<h1>When was it</h1><div class="sub">Reading the game's files…</div>`;
  if (!gt.data) {
    const u = await api("/api/units").catch(() => null);
    const of = (list, ego) => (list || []).filter((x) => x.date && x.img && x.img.thumb).map((x) => ({ key: (ego ? "g" : "i") + x.id, id: x.id, ego, title: ego ? x.name : x.title, sub: x.sinnerName,
      name: (ego ? x.name : x.title) + " " + x.sinnerName, day: gtDay(x.date), season: giSeason(u, x.season) || "", pic: giThumb(x.img.thumb) }));
    const all = [...of((u || {}).ids, false), ...of((u || {}).egos, true)];
    // (what the game came out with would all be one answer: not asked)
    const from = Math.min(...all.map((x) => x.day));
    // the seasons on the timeline: each from its first Identity's day to the next one's
    const first = {};
    for (const x of (u || {}).ids || []) if (x.date && x.season >= 1 && x.season < 100) first[x.season] = Math.min(first[x.season] ?? 1e9, gtDay(x.date));
    const seasons = Object.entries(first).map(([k, day]) => ({ n: +k, day, color: (((u || {}).seasons || {})[k] || {}).color || "#888" })).sort((a, b) => a.day - b.day);
    gt.data = { from, to: Math.max(gtDay(new Date().toISOString().slice(0, 10)), ...all.map((x) => x.day)), all: all.filter((x) => x.day > from), seasons };
    if (!u) setTimeout(() => { gt.data = null; });
  }
  if (!location.hash.startsWith("#/gamewhen")) return;
  gtDrawStart();
  if (auto && gtPool("both").length >= GT_ROUNDS) gtNew(true);
};
const gtPool = (what) => gt.data.all.filter((x) => what === "both" || (what === "ego") === x.ego);

function gtDrawStart() {
  const s = gz.when, what = s.what || "id", n = gtPool(what).length;
  $("#main").innerHTML = `<h1>When was it</h1>
    <div class="sub">An Identity or an E.G.O — put the mark on the game's timeline where it came out. The closer, the more points.</div>
    ${gt.data.all.length < GT_ROUNDS ? `<p class="muted">Nothing to ask yet: the game's files or a snapshot are missing.</p>` : `
    <div class="dbrow">${gzChip(what === "id", 'data-w="id"', "Identities")}${gzChip(what === "ego", 'data-w="ego"', "E.G.O")}${gzChip(what === "both", 'data-w="both"', "Both")}<span class="gap"></span>
      ${gzChip(!s.hard, 'data-h=""', "Easy · with the name")}${gzChip(s.hard, 'data-h="1"', "Hard · the picture only")}</div>
    <div class="gmstart"><span class="gmscore">${n} TO ASK · BEST <i>${s.best[what + (s.hard ? "h" : "e")] || 0}</i></span>
      ${gmDailyBtn("when")}<button class="gmbtn" id="gtgo" ${n < GT_ROUNDS ? "disabled" : ""}>Start · ${GT_ROUNDS} rounds</button></div>
    <div class="muted small">Within two weeks of the day: ${GT_WORTH}; then less with every day, nothing a year off. Hard: no name, nothing ${GT_FAR[1]} days off, points are doubled. The season as a hint costs points. What the game came out with isn't asked.</div>`}`;
  const set = (sel, key, f) => document.querySelectorAll("#main " + sel).forEach((b) => b.onclick = () => { s[key] = f(b); gzKeep(); gtDrawStart(); });
  set("[data-w]", "what", (b) => b.dataset.w);
  set("[data-h]", "hard", (b) => !!b.dataset.h);
  if ($("#gtgo")) $("#gtgo").onclick = () => gtNew();
  if ($("#gmdaily")) $("#gmdaily").onclick = () => gmDailyDone("when") == null ? gtNew(true) : gzDone();
}

function gtNew(daily) {
  const g = gt.game = gzNew("when", daily, GT_ROUNDS, {});
  g.what = g.daily ? "id" : gz.when.what || "id";
  g.list = gzMix(gtPool(g.what), g.rnd).slice(0, GT_ROUNDS);
  gtRound();
}

function gtRound() {
  const g = gt.game;
  if (++g.round >= g.of) return gtResult();
  Object.assign(g, { ans: g.list[g.round], at: Math.round((gt.data.from + gt.data.to) / 2), hints: {}, done: null });
  gtDraw();
}

// what a mark this many days off is worth
function gtWorth(g, off) {
  const far = GT_FAR[g.hard ? 1 : 0], part = off <= GT_NEAR ? 1 : Math.max(0, 1 - (off - GT_NEAR) / (far - GT_NEAR));
  return Math.max(0, Math.round((GT_WORTH - GT_HINT * Object.keys(g.hints).length) * part / 10) * 10) * (g.hard ? 2 : 1);
}

function gtDraw() {
  const g = gt.game, a = g.ans, d = g.done, { from, to } = gt.data, pos = (day) => (day - from) / (to - from) * 100;
  const years = [];
  for (let y = new Date(from * 864e5).getUTCFullYear() + 1; gtDay(y + "-01-01") < to; y++) years.push(y);
  const hint = a.season ? (g.hints.season || d ? `<div class="gihint open"><small>SEASON</small><b>${esc(a.season)}</b></div>`
    : `<button class="gihint" data-hint="season"><small>SEASON</small><b>hidden</b><u>open · −${GT_HINT * (g.hard ? 2 : 1)}</u></button>`) : "";
  $("#main").innerHTML = `<h1>When was it</h1>${gzTop(g)}
    <div class="gtbox"><div class="gthead"><img src="${a.pic}" onerror="this.style.visibility='hidden'"><div>
        <div class="gmkick">${d ? (d.points ? `+${d.points} · ` : "MISSED · ") + (d.off ? `${d.off} DAY${d.off > 1 ? "S" : ""} OFF` : "THE VERY DAY") : `${a.ego ? "E.G.O" : "IDENTITY"} · WORTH UP TO ${gtWorth(g, 0)}`}</div>
        <div class="gmq">${d || !g.hard ? esc(a.title) : "When did this come out?"}</div>
        <div class="muted">${d || !g.hard ? esc(a.sub) : ""}${d ? ` · came out on <b>${gtSay(a.day)}</b>` : ""}</div>
        <div class="gihints">${hint}</div></div></div>
      <div class="gtline"><div class="gtyears">${years.map((y) => `<span style="left:${pos(gtDay(y + "-01-01"))}%">${y}</span>`).join("")}</div>
        <div class="gtseasons">${gt.data.seasons.map((s, i, all) => `<span style="left:${pos(s.day)}%;width:${pos(all[i + 1] ? all[i + 1].day : to) - pos(s.day)}%;--c:${s.color}" title="Season ${s.n}: from ${gtSay(s.day)}">S${s.n}</span>`).join("")}</div>
        <input id="gtat" type="range" min="${from}" max="${to}" step="1" value="${g.at}" ${d ? "disabled" : ""}>
        ${d ? `<div class="gtmark" style="left:${pos(a.day)}%"><i></i><b>${gtIso(a.day)}</b></div>` : ""}</div>
      <div class="gmafter"><span>Your mark: <b id="gtsay">${gtSay(g.at)}</b></span>
        ${d ? `<a href="#/db/${a.id}">Open in the database →</a><button class="gmbtn" id="gtnext">${g.round + 1 < g.of ? "Next" : "Result"}</button>` : `<button class="gmbtn" id="gtok">That day</button>`}</div></div>`;
  $("#gzquit").onclick = () => { gt.game = null; gtDrawStart(); };
  $("#gtat").oninput = (e) => { g.at = +e.target.value; $("#gtsay").textContent = gtSay(g.at); };
  document.querySelectorAll("#main [data-hint]").forEach((b) => b.onclick = () => { g.hints[b.dataset.hint] = 1; gtDraw(); });
  if ($("#gtok")) $("#gtok").onclick = () => {
    const off = Math.abs(g.at - a.day), points = gtWorth(g, off);
    gzScore(g, points > 0, points, { ans: a, at: g.at, off, clean: off <= GT_NEAR && !Object.keys(g.hints).length });
    gtDraw();
  };
  if ($("#gtnext")) { $("#gtnext").onclick = gtRound; $("#gtnext").focus(); } else $("#gtat").focus();
}

function gtResult() {
  const g = gt.game;
  gzResult("when", "When was it", g, g.what + (g.hard ? "h" : "e"), ["", "WHAT", "CAME OUT", "YOUR MARK", "OFF", "POINTS"],
    (r) => `<td><img class="gologpic odd" src="${r.ans.pic}"></td><td>${esc(r.ans.title)}<i>${esc(r.ans.sub)}</i></td><td>${gtIso(r.ans.day)}</td><td class="${r.ok ? (r.clean ? "ok" : "") : "bad"}">${gtIso(r.at)}</td><td>${r.off} d</td><td>${r.points}</td>`,
    () => gtNew(), () => { gt.game = null; gtDrawStart(); });
}

// ------------------------------------------------------------------ Guess who
// Two sides, the same 24 Identities (drawn from the game's seed), a hidden one each. A turn: ask whether the other's
// is something (a Sinner, a season, a rarity, an archetype, a damage type, a sin, a faction) — the other side's page
// answers by itself, and the cards it can't be go dark — or name it: right wins, wrong passes the turn.
//   the room's state (the host sets it): {kind: "who", n: the game's number, seed, ids: [the two], first}
//   messages: {k: "q", n, t} · {k: "a", n, t, yes} · {k: "guess", n, key} · {k: "g", n, key, ok, mine}
// A side (gqSide) is one player's view of the game: mine in a room; against the game there are two, the other one
// played by gqBot.
const GQ_CARDS = 24, GQ_KINDS = [["sinner", "SINNER"], ["season", "SEASON"], ["rank", "RARITY"], ["kw", "ARCHETYPE"], ["atk", "DAMAGE"], ["sin", "SIN"], ["assoc", "FACTION"]];
const gq = { ws: null, code: "", room: null, shut: true, retry: 0, error: "", full: false, beat: 0, game: null, ids: [], n: 0, paid: 0, name: false };
const gqOn = () => location.hash.startsWith("#/gamewho");
const gqTraits = (x) => [["sinner", x.sub], ["season", x.season], ["rank", "0".repeat(x.rank)], ...x.kw.map((k) => ["kw", k]), ...x.atk.map((k) => ["atk", k]), ...x.sins.map((k) => ["sin", k]),
  ...x.assoc.filter((k) => !k.startsWith("Limbus Company")).map((k) => ["assoc", k])].filter(([, n]) => n && n !== "—").map(([k, n]) => k + "|" + n);
const gqHas = (x, t) => gqTraits(x).includes(t);
const gqCards = (seed) => gzMix(gq.ids, gmSeed("who" + seed)).slice(0, GQ_CARDS);

// one player's view: its hidden card, the cards the other's may still be, whose turn it is, what was said
function gqSide(id, foe, cards, first, say) {
  return { id, foe, cards, mine: cards[Math.floor(Math.random() * cards.length)], left: new Set(cards.map((x) => x.key)), turn: first, log: [], over: null, theirs: null, say, changed: () => {} };
}
// a message as a side hears it (its own ones too, in the room's order)
function gqStep(s, from, d) {
  const me = from === s.id;
  if (d.k === "mine" && !me) { s.theirs = d.key; return s.changed(); }  // (after the game: the winner's card, to look at)
  if (s.over) return;
  if (d.k === "q" && !me) s.say({ k: "a", t: d.t, yes: gqHas(s.mine, d.t) });
  if (d.k === "a") {
    if (!me) for (const x of s.cards) if (gqHas(x, d.t) !== !!d.yes) s.left.delete(x.key);  // my question, answered
    s.log.unshift({ who: me ? s.foe : s.id, t: d.t, yes: !!d.yes });
    s.turn = from;
  }
  if (d.k === "guess" && !me) s.say({ k: "g", key: d.key, ok: d.key === s.mine.key });
  if (d.k === "g") {
    s.log.unshift({ who: me ? s.foe : s.id, guess: d.key, yes: !!d.ok });
    if (d.ok) { s.over = { win: me ? s.foe : s.id }; if (!me) { s.theirs = d.key; s.say({ k: "mine", key: s.mine.key }); } }
    else { if (!me) s.left.delete(d.key); s.turn = from; }
  }
  s.changed();
}
// the traits worth asking about: the ones some, but not all, of the cards still in have
function gqAsks(s) {
  const left = s.cards.filter((x) => s.left.has(x.key)), n = {};
  for (const x of left) for (const t of gqTraits(x)) n[t] = (n[t] || 0) + 1;
  return Object.entries(n).filter(([, c]) => c < left.length).map(([t, c]) => ({ t, c, of: left.length }));
}
// the game's own side: asks what halves its cards best, names the card when one is left
function gqBot(s) {
  if (s.over || s.turn !== s.id || gq.game == null || gq.game.bot !== s) return;
  s.turn = "";
  const left = [...s.left], asks = gqAsks(s).sort((a, b) => Math.abs(a.c - a.of / 2) - Math.abs(b.c - b.of / 2));
  left.length <= 1 || !asks.length ? s.say({ k: "guess", key: left[Math.floor(Math.random() * left.length)] }) : s.say({ k: "q", t: asks[Math.floor(Math.random() * Math.min(2, asks.length))].t });
}

function gqClose() {
  gq.shut = true;
  clearInterval(gq.timer);
  try { gq.ws && gq.ws.close(); } catch {}
  gq.ws = gq.room = gq.game = null;
  gq.code = "";
}
function gqOpen(code) {
  gqClose();
  gq.code = code;
  gq.shut = false;
  const ws = gq.ws = new WebSocket(`${glServer()}/room/${code}?id=${gl.id}&name=${encodeURIComponent(gl.nick)}`);
  ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } if (ws === gq.ws) gqGot(m); };
  ws.onopen = () => { gq.retry = 0; };
  ws.onclose = () => {
    if (ws !== gq.ws || gq.shut) return;
    if (gq.full || ++gq.retry > 6) { gq.error = gq.full ? "The room is full: Guess who is for two." : "The room can't be reached — the rooms need the site's server."; gq.ws = null; return gqDraw(); }
    setTimeout(() => { if (ws === gq.ws && !gq.shut) { const g = gq.game; gqOpen(gq.code); gq.game = g; } }, 1500);
  };
  gq.timer = setInterval(() => { if (gq.ws && gq.ws.readyState === 1 && ++gq.beat % 25 === 0) gq.ws.send(JSON.stringify({ t: "ping" })); }, 1000);
  gq.error = "";
  gq.full = false;
}
window.addEventListener("hashchange", () => { if (!gqOn() && (gq.code || gq.game)) gqClose(); });
const gqSet = (patch) => { try { gq.ws.send(JSON.stringify({ t: "set", state: { ...(gq.room ? gq.room.state : {}), ...patch } })); } catch {} };
const gqName = (id) => id === "bot" ? "The game" : id === gl.id && !gq.room ? "You" : ((gq.room ? gq.room.players : []).find((p) => p.id === id) || {}).name || "—";

routes.gamewho = async (args = []) => {
  gmCrumb("who");
  if (args[0] === "new") { location.replace("#/gamewho/" + Math.random().toString(36).slice(2, 7).replace(/[^a-z0-9]/g, "x").padEnd(5, "k")); return; }
  $("#main").innerHTML = `<h1>Guess who</h1><div class="sub">Reading the game's files…</div>`;
  gq.ids = await gxIds();
  if (!gqOn()) return;
  if (gq.ids.length < GQ_CARDS) { $("#main").innerHTML = `<h1>Guess who</h1><p class="muted">Nothing to play with yet: the game's files or a snapshot are missing.</p>`; return; }
  const code = (args[0] || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 10);
  if (code === "solo") { gqClose(); return gqSolo(); }
  if (code.length < 4) return gqFront();
  if (gq.code !== code) { gqClose(); gq.code = code; gq.shut = true; }
  if (gl.nick && !gq.ws) gqOpen(code);
  gqDraw();
};

function gqFront() {
  gqClose();
  $("#main").innerHTML = `<h1>Guess who</h1>
    <div class="sub">For two. Both get the same ${GQ_CARDS} Identities and a hidden one each. Take turns asking what the other's is — "a Bleed one?", "Season 3?", "W Corp?" — the game answers for them and darkens the cards it can't be. Name the other's Identity first.</div>
    <div class="gmstart"><a class="gmbtn" href="#/gamewho/new">Make a room</a><span class="muted">or a friend's code:</span><input id="gqcode" class="dbq glin" placeholder="code or link" autocomplete="off"><button class="toggle" id="gqgo">Join</button>
      <span class="gap"></span><a class="toggle" href="#/gamewho/solo">Play against the game</a></div>`;
  const go = () => { const m = /([a-z0-9]{4,10})\s*$/i.exec($("#gqcode").value.trim()); m ? (location.hash = "#/gamewho/" + m[1].toLowerCase()) : toast("That is not a room's code."); };
  $("#gqgo").onclick = go;
  $("#gqcode").onkeydown = (e) => { if (e.key === "Enter") go(); };
}

// against the game: two sides on this page, each hearing what the other says
function gqSolo() {
  const cards = gqCards(Math.random().toString(36).slice(2)), me = gl.id, first = Math.random() < 0.5 ? me : "bot";
  const hear = (from) => (d) => setTimeout(() => { if (gq.game !== g) return; gqStep(g.side, from, d); gqStep(g.bot, from, d); }, from === "bot" ? 500 : 0);
  const g = gq.game = { solo: true, side: gqSide(me, "bot", cards, first, hear(me)), bot: gqSide("bot", me, cards, first, hear("bot")) };
  g.side.changed = gqPlay;
  g.bot.changed = () => { clearTimeout(g.think); g.think = setTimeout(() => gq.game === g && gqBot(g.bot), 1100); };
  gq.name = false;
  gqPlay();
  g.bot.changed();
}

// a message of the room
function gqGot(m) {
  if (m.t === "full") { gq.full = true; return; }
  if (m.t === "room") {
    gq.room = m;
    const s = m.state;
    if (s.kind !== "who") {
      if (s.game || s.kind) { gq.error = "This code is another kind of room."; gq.ws.onclose = null; gqClose(); return gqDraw(); }
      if (m.host === gl.id) gqSet({ kind: "who", n: 0, max: 2 });
      return gqDraw();
    }
    if (s.n && s.n !== gq.n && (s.ids || []).includes(gl.id)) {  // a game starts
      gq.n = s.n;
      const foe = s.ids.find((id) => id !== gl.id), say = (d) => { try { gq.ws.send(JSON.stringify({ t: "msg", data: { ...d, n: s.n } })); } catch {} };
      gq.game = { n: s.n, side: gqSide(gl.id, foe, gqCards(s.seed), s.first, say) };
      gq.game.side.changed = gqPlay;
      gq.name = false;
    }
    return gqDraw();
  }
  const g = gq.game, d = m.data || {};
  if (m.t !== "msg" || !g || g.solo || d.n !== g.n) return;
  gqStep(g.side, m.from, d);
}

// the room before a game (and around it): who is in, the host's Start
function gqDraw() {
  if (!gqOn()) return;
  if (gq.game && !gq.game.solo && gq.room) return gqPlay();
  const code = gq.code, link = `${GM_SITE}/#/gamewho/${code}`;
  const head = `<h1>Guess who</h1><div class="glroom"><span class="gmscore">ROOM <b>${esc(code.toUpperCase())}</b></span><input class="dbq glin" readonly value="${esc(link)}" onclick="this.select()">
    <button class="toggle" id="gqcopy">${GM_SWORDS}Copy the invite</button></div>`;
  if (!gl.nick || !gq.ws) {
    $("#main").innerHTML = `${head}${gq.error ? `<p class="glerr">${esc(gq.error)}</p>` : ""}
      <div class="gmstart"><span class="muted">Your nickname:</span><input id="gqnick" class="dbq glin" maxlength="20" value="${esc(gl.nick)}" placeholder="nickname" autocomplete="off"><button class="gmbtn" id="gqjoin">Come in</button></div>`;
    const join = () => { const n = $("#gqnick").value.trim().slice(0, 20); if (!n) return $("#gqnick").focus(); gl.nick = n; glKeep(); gqOpen(code); gqDraw(); };
    $("#gqjoin").onclick = join;
    $("#gqnick").onkeydown = (e) => { if (e.key === "Enter") join(); };
    $("#gqnick").focus();
  } else if (!gq.room || gq.room.state.kind !== "who") $("#main").innerHTML = `${head}<p class="muted">Coming into the room…</p>`;
  else {
    const r = gq.room, host = r.host === gl.id;
    $("#main").innerHTML = `${head}<div class="glcols"><div><div class="gmgrp">Players <small>${r.players.length} / 2</small></div>
        ${r.players.map((p) => `<div class="glrow ${p.id === gl.id ? "me" : ""}"><span>${esc(p.name)}</span>${p.id === r.host ? "<em>HOST</em>" : ""}</div>`).join("")}</div>
      <div><div class="gmgrp">The game</div>${host ? `<div class="gmstart"><button class="gmbtn" id="gqstart" ${r.players.length < 2 ? "disabled" : ""}>Start</button>
        <span class="muted small">${r.players.length < 2 ? "Waiting for the other one to come in." : "Who asks first is drawn."}</span></div>` : `<p class="muted">The host starts the game.</p>`}</div></div>`;
    if ($("#gqstart")) $("#gqstart").onclick = gqStart;
  }
  if ($("#gqcopy")) $("#gqcopy").onclick = () => gmCopy(`Limbus Archive · Guess who — come in and guess my Identity:\n${link}`);
}
function gqStart() {
  const ids = gq.room.players.slice(0, 2).map((p) => p.id);
  gqSet({ n: (gq.room.state.n || 0) + 1, seed: Math.random().toString(36).slice(2, 8), ids, first: ids[Math.floor(Math.random() * 2)] });
}

// the game itself
function gqPlay() {
  const g = gq.game, s = g && g.side;
  if (!s || !gqOn()) return;
  const mine = s.turn === s.id && !s.over, card = (k) => s.cards.find((x) => x.key === k), label = (t) => t.split("|")[1];
  const kind = (t) => GQ_KINDS.find(([k]) => k === t.split("|")[0])[1], asks = gqAsks(s), left = s.left.size;
  if (s.over && s.over.win === s.id && !g.solo && gq.paid !== g.n) { gq.paid = g.n; gmPay([[GL_WIN, "Guess who won"]], ["duel"]); }
  const tile = (x) => `<button class="gqcard ${s.left.has(x.key) ? "" : "out"} ${s.over && s.theirs === x.key ? "it" : ""}" data-k="${x.key}" ${mine && gq.name && s.left.has(x.key) ? "" : "disabled"} title="${esc(x.name)}">
    <img src="${x.pic}" onerror="this.remove()"><b>${esc(x.title)}</b><i>${esc(x.sub)}</i></button>`;
  const line = (l) => `<div class="gqline ${l.who === s.id ? "me" : ""}"><small>${l.who === s.id ? "YOU" : esc(gqName(l.who).toUpperCase())}</small>${l.guess ? `named <b>${esc((card(l.guess) || {}).title || "")}</b>` : `${kind(l.t)} <b>${esc(label(l.t))}</b>?`}<em class="${l.yes ? "yes" : "no"}">${l.yes ? "YES" : "NO"}</em></div>`;
  $("#main").innerHTML = `<h1>Guess who</h1>
    <div class="gmtop"><span class="gmscore">${s.over ? (s.over.win === s.id ? "<i>YOU NAMED IT FIRST</i>" : `<b>${esc(gqName(s.over.win).toUpperCase())}</b> NAMED YOURS FIRST`) : mine ? "<i>YOUR TURN</i> · ASK, OR NAME THEIR IDENTITY" : `${esc(gqName(s.foe).toUpperCase())}'S TURN…`}</span>
      <span class="grow"></span><span class="gmscore">THEIRS MAY BE <b>${left}</b> OF ${s.cards.length}</span>
      ${s.over ? (g.solo ? `<button class="gmbtn" id="gqagain">Play again</button>` : gq.room && gq.room.host === gl.id ? `<button class="gmbtn" id="gqagain">Play again</button>` : `<span class="muted small">The host starts the next one.</span>`) : ""}
      <a class="toggle" href="#/gamewho">Leave</a></div>
    <div class="gqcols"><div><div class="gqgrid ${mine && gq.name ? "naming" : ""}">${s.cards.map(tile).join("")}</div></div>
      <div class="gqside"><div class="gqmine"><img src="${s.mine.pic}"><div><div class="gmkick">YOUR IDENTITY</div><b>${esc(s.mine.title)}</b><i>${esc(s.mine.sub)}</i></div></div>
        ${s.over ? "" : mine ? `<div class="dbrow">${gzChip(!gq.name, 'data-name=""', "Ask")}${gzChip(gq.name, 'data-name="1"', "Name their Identity")}</div>
          ${gq.name ? `<p class="muted small">Click a card: right wins the game, wrong passes the turn.</p>`
          : GQ_KINDS.map(([k, name]) => { const of = asks.filter((a) => a.t.startsWith(k + "|")).sort((a, b) => a.t.localeCompare(b.t));
              return of.length ? `<div class="gqask"><small>${name}</small>${of.map((a) => `<button class="toggle" data-t="${esc(a.t)}" title="${a.c} of the ${a.of} cards still in">${esc(label(a.t))}</button>`).join("")}</div>` : ""; }).join("")}`
        : `<p class="muted">Waiting for their move — their questions about your Identity are answered by the game.</p>`}
        <div class="gqlog">${s.log.map(line).join("")}</div></div></div>`;
  document.querySelectorAll("#main [data-name]").forEach((b) => b.onclick = () => { gq.name = !!b.dataset.name; gqPlay(); });
  document.querySelectorAll("#main [data-t]").forEach((b) => b.onclick = () => { if (s.turn === s.id) { s.turn = ""; s.say({ k: "q", t: b.dataset.t }); gqPlay(); } });
  document.querySelectorAll("#main .gqcard:not([disabled])").forEach((b) => b.onclick = () => { if (s.turn === s.id) { s.turn = ""; gq.name = false; s.say({ k: "guess", key: b.dataset.k }); gqPlay(); } });
  if ($("#gqagain")) $("#gqagain").onclick = () => g.solo ? gqSolo() : gqStart();
}
