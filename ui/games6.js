// Games → live matches: a room on the site's server (ui/site/worker.js) that two to eight players join by a link or
// a code, under a nickname. The host picks the game and the mode and starts; everybody then plays the same rounds —
// a duel's seed (games.js), on the Daily's fixed settings — and sees the others on a panel.
//   Race: each at their own pace; the result is the game's own.
//   First to answer (the guessing games): the rounds go in step — the first right answer takes the round's points,
//   the round ends when it is taken, when everybody has answered, or after GL_ROUND seconds.
// The room only passes messages on, in one order for everybody: {k: "p"} progress, {k: "a"} an answer of a round,
// {k: "next"} the host ends a round, {k: "done"} a finished game.
"use strict";

const GL_KEEP = "games_live", GL_ROUND = 30, GL_WIN = 200;
const GL_FIRST = ["track", "id", "char", "skill", "enemy", "canto", "splash", "atlas", "buff"];  // the games "First to answer" can run
const gl = { nick: "", id: "", ...(() => { try { return JSON.parse(localStorage.getItem(GL_KEEP) || "{}"); } catch { return {}; } })(),
  ws: null, code: "", room: null, match: null, n: 0, want: "", timer: 0, paid: 0, retry: 0, shut: true };
if (!gl.id) gl.id = Math.random().toString(36).slice(2, 12);
const glKeep = () => { try { localStorage.setItem(GL_KEEP, JSON.stringify({ nick: gl.nick, id: gl.id })); } catch {} };
// where the rooms are: the site itself; the app goes to the site's address (a test may name another)
const glServer = () => (localStorage.getItem("games_live_host") || (document.body.classList.contains("site") ? location.origin : GM_SITE)).replace(/^http/, "ws");
const glGameOf = (k) => GM_GAMES.find((g) => g[0] === k);
const glMe = () => gl.room && gl.room.host === gl.id;
const glSend = (m) => { try { gl.ws && gl.ws.readyState === 1 && gl.ws.send(JSON.stringify(m)); } catch {} };
const glSet = (patch) => glSend({ t: "set", state: { ...(gl.room ? gl.room.state : {}), ...patch } });
const glSay = (data) => glSend({ t: "msg", data });
// the running game of an engine, and how it stands: [done steps, of how many, score as shown]
function glGame(k) {
  return k === "track" ? gm.game : ["id", "skill", "char"].includes(k) ? gi.game : ["enemy", "canto", "splash", "atlas"].includes(k) ? gp.game
    : k === "wordle" ? gw.game : k === "conn" ? gc.game : k === "grid" ? gg.game : k === "odd" ? go.game
    : k === "chain" ? gn.game : k === "buff" ? gb.game : k === "mix" ? gy.game : k === "jig" ? gj.game : null;
}
function glStand(k, g) {
  if (k === "wordle") return [g.tries.length, GW_TRIES, g.over && g.tries.includes(g.ans) ? "solved" : ""];
  if (k === "conn") return [g.found.length, 4, g.miss ? `${g.miss} miss` : ""];
  if (k === "grid") return [g.got.filter(Boolean).length, 9, g.score];
  return [(g.log || []).length, g.of || 10, g.score];
}

function glClose() {
  gl.shut = true;
  clearInterval(gl.timer);
  try { gl.ws && gl.ws.close(); } catch {}
  gl.ws = gl.room = gl.match = null;
  gl.code = "";
  document.body.classList.remove("gllive", "glfirst");
  $("#glpanel") && $("#glpanel").remove();
}
function glOpen(code) {
  glClose();
  gl.code = code;
  gl.shut = false;
  const ws = gl.ws = new WebSocket(`${glServer()}/room/${code}?id=${gl.id}&name=${encodeURIComponent(gl.nick)}`);
  ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } if (ws === gl.ws) glGot(m); };
  ws.onopen = () => { gl.retry = 0; };
  ws.onclose = () => {  // a line lost in the middle is picked up again; the room keeps the player's place by id
    if (ws !== gl.ws || gl.shut) return;
    if (gl.full || ++gl.retry > 6) { gl.error = gl.full ? "The room is full." : "The room can't be reached — the live matches need the site's server."; gl.ws = null; return glLobby(); }
    setTimeout(() => { if (ws === gl.ws && !gl.shut) { const c = gl.code, m = gl.match; glOpen(c); gl.match = m; if (m) { document.body.classList.add("gllive"); document.body.classList.toggle("glfirst", m.mode === "first"); } } }, 1500);
  };
  gl.timer = setInterval(glTick, 250);
  gl.error = gl.full = "";
}
window.addEventListener("hashchange", () => {
  const h = location.hash, game = gl.match && glGameOf(gl.match.game);
  if (gl.code && !h.startsWith("#/live") && !(game && h.startsWith(game[1]))) glClose();
});

routes.live = (args = []) => {
  document.querySelectorAll("#subnav [data-game]").forEach((a) => a.classList.remove("active"));
  $("#gmcrumb").textContent = "Live match";
  if (args[0] === "new") { gl.want = args[1] || ""; location.replace("#/live/" + Math.random().toString(36).slice(2, 7).replace(/[^a-z0-9]/g, "x").padEnd(5, "k")); return; }
  const code = (args[0] || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 10);
  if (code.length < 4) return glFront();
  if (gl.code !== code) { glClose(); gl.code = code; gl.shut = true; }
  if (gl.nick && !gl.ws) glOpen(code);
  glLobby();
};

// no room yet: make one or go into a friend's
function glFront() {
  glClose();
  $("#main").innerHTML = `<h1>Live match</h1>
    <div class="sub">Play a game with friends at the same time: two to eight players, the same rounds for everybody. One makes a room and sends its link or code; the others come in.</div>
    <div class="gmstart"><a class="gmbtn" href="#/live/new">Make a room</a><span class="muted">or a friend's code:</span><input id="glcode" class="dbq glin" placeholder="code or link" autocomplete="off"><button class="toggle" id="glgo">Join</button></div>`;
  const go = () => { const m = /([a-z0-9]{4,10})\s*$/i.exec($("#glcode").value.trim()); m ? (location.hash = "#/live/" + m[1].toLowerCase()) : toast("That is not a room's code."); };
  $("#glgo").onclick = go;
  $("#glcode").onkeydown = (e) => { if (e.key === "Enter") go(); };  // (a handler that returns false would swallow the key)
}

function glLobby() {
  if (!location.hash.startsWith("#/live/")) return;
  const code = gl.code, link = `${GM_SITE}/#/live/${code}`, chip = (on, attr, text, off) => `<button class="toggle ${on ? "on" : ""}" ${attr} ${off ? "disabled" : ""}>${text}</button>`;
  const head = `<h1>Live match</h1><div class="glroom"><span class="gmscore">ROOM <b>${esc(code.toUpperCase())}</b></span><input class="dbq glin" readonly value="${esc(link)}" onclick="this.select()">
    <button class="toggle" id="glcopy">${GM_SWORDS}Copy the invite</button><span class="muted small">In the app: paste the link or the code on the Games page.</span></div>`;
  if (!gl.nick || !gl.ws) {  // who are you: asked on the way in, kept for the next time
    $("#main").innerHTML = `${head}${gl.error ? `<p class="glerr">${esc(gl.error)}</p>` : ""}
      <div class="gmstart"><span class="muted">Your nickname:</span><input id="glnick" class="dbq glin" maxlength="20" value="${esc(gl.nick)}" placeholder="nickname" autocomplete="off"><button class="gmbtn" id="gljoin">Come in</button></div>`;
    const join = () => { const n = $("#glnick").value.trim().slice(0, 20); if (!n) return $("#glnick").focus(); gl.nick = n; glKeep(); glOpen(code); glLobby(); };
    $("#gljoin").onclick = join;
    $("#glnick").onkeydown = (e) => { if (e.key === "Enter") join(); };
    $("#glnick").focus();
  } else if (!gl.room) {
    $("#main").innerHTML = `${head}<p class="muted">Coming into the room…</p>`;
  } else {
    const r = gl.room, s = r.state, host = glMe(), game = glGameOf(s.game) || glGameOf(gl.want) || GM_SCORED[0], mode = s.mode === "first" && GL_FIRST.includes(game[0]) ? "first" : "race", max = s.max || 8;
    const res = s.status === "over" && s.results ? Object.entries(s.results).map(([id, x]) => ({ id, ...x })).sort((a, b) => b.rank - a.rank) : null;
    $("#main").innerHTML = `${head}
      ${res ? `<div class="glres"><div class="gmkick">THE LAST MATCH · ${esc((glGameOf(s.game) || [])[2] || "")} · ${s.mode === "first" ? "FIRST TO ANSWER" : "RACE"}</div>
        ${res.map((x, i) => `<div class="glrow ${x.id === gl.id ? "me" : ""} ${i ? "" : "win"}"><b>${i + 1}</b><span>${esc(x.name)}</span><i>${esc(String(x.score))}</i><em>${esc(x.grade || "")}</em></div>`).join("")}</div>` : ""}
      <div class="glcols"><div><div class="gmgrp">Players <small>${r.players.length} / ${max}</small></div>
        ${r.players.map((p) => `<div class="glrow ${p.id === gl.id ? "me" : ""}"><span>${esc(p.name)}</span>${p.id === r.host ? "<em>HOST</em>" : ""}${p.id === gl.id ? `<button class="toggle" id="glrename">rename</button>` : ""}</div>`).join("")}
        ${s.status === "play" ? `<p class="muted">A match is on${(s.ids || []).includes(gl.id) ? "" : " — the next one takes you in"}.</p>` : ""}</div>
      <div><div class="gmgrp">The match</div>
        ${host ? `<div class="dbrow">${GM_SCORED.map((g) => chip(g[0] === game[0], `data-game="${g[0]}"`, esc(g[2]))).join("")}</div>
          <div class="dbrow">${chip(mode === "race", 'data-mode="race"', "Race · each at their own pace")}${chip(mode === "first", 'data-mode="first"', "First to answer · rounds in step", !GL_FIRST.includes(game[0]))}</div>
          <div class="dbrow"><span class="muted">Players, up to</span>${[2, 3, 4, 5, 6, 7, 8].map((n) => chip(max === n, `data-max="${n}"`, n, n < r.players.length)).join("")}</div>
          <div class="gmstart">${s.status === "play" ? `<button class="toggle" id="glstop">End the match</button>` : `<button class="gmbtn" id="glstart" ${r.players.length < 2 ? "disabled" : ""}>Start the match</button>`}
            <span class="muted small">${s.status === "play" ? "Stops it for everybody, without a result — if it got stuck." : r.players.length < 2 ? "Waiting for somebody to come in." : mode === "first" ? `The first right answer takes a round; ${GL_ROUND} s a round.` : "The same rounds for everybody; the best result wins."}</span></div>`
        : `<p><b>${esc(game[2])}</b> · ${mode === "first" ? "First to answer" : "Race"} · up to ${max} players</p><p class="muted">The host starts the match.</p>`}</div></div>`;
    if (host && (s.game !== game[0] || s.mode !== mode || !s.max)) glSet({ game: game[0], mode, max });  // (what the page shows is what the room has)
    const set = (sel, f) => document.querySelectorAll(sel).forEach((b) => b.onclick = () => glSet(f(b)));
    set("#main [data-game]", (b) => ({ game: b.dataset.game, mode: GL_FIRST.includes(b.dataset.game) ? mode : "race" }));
    set("#main [data-mode]", (b) => ({ mode: b.dataset.mode }));
    set("#main [data-max]", (b) => ({ max: +b.dataset.max }));
    if ($("#glstart")) $("#glstart").onclick = () => glSet({ status: "play", n: Date.now(), seed: Math.random().toString(36).slice(2, 8).padEnd(6, "0"), ids: r.players.map((p) => p.id), results: null });
    if ($("#glstop")) $("#glstop").onclick = () => glSet({ status: "", results: null });
    if ($("#glrename")) $("#glrename").onclick = () => { gl.ws.onclose = null; glClose(); gl.code = code; gl.nick = ""; glLobby(); };
  }
  if ($("#glcopy")) $("#glcopy").onclick = () => gmCopy(`Limbus Archive · a live match — come in:\n${link}\n(in the app: Games → paste the code ${code.toUpperCase()})`);
}

// a message of the room
function glGot(m) {
  if (m.t === "full") { gl.full = true; return; }
  if (m.t === "room") {
    gl.room = m;
    const s = m.state;
    if (s.status === "play" && s.n + "." + s.seed !== gl.n && (s.ids || []).includes(gl.id) && glGameOf(s.game)) {  // a match starts: the game's page, by the seed
      gl.n = s.n + "." + s.seed;  // (with the seed: a room made anew counts its matches from 1 again)
      gl.match = { game: s.game, mode: s.mode, n: s.n, ids: s.ids, by: {}, pts: {}, rounds: {}, said: "", t0: 0 };
      document.body.classList.add("gllive");
      document.body.classList.toggle("glfirst", s.mode === "first");
      location.hash = `${glGameOf(s.game)[1]}/duel/${s.seed}`;
      return;
    }
    if (s.status !== "play" && gl.match) {  // it is over: back to the room, where the result is
      const won = s.results && Object.entries(s.results).sort((a, b) => b[1].rank - a[1].rank)[0];
      if (won && won[0] === gl.id && Object.keys(s.results).length > 1 && gl.paid !== s.n) { gl.paid = s.n; gmPay([[GL_WIN, "a live match won"]], ["duel"]); }
      gl.match = null;
      document.body.classList.remove("gllive", "glfirst");
      $("#glpanel") && $("#glpanel").remove();
      if (!location.hash.startsWith("#/live")) { location.hash = "#/live/" + gl.code; return; }
    }
    if (gl.match) glEnd();
    return location.hash.startsWith("#/live") ? glLobby() : glPanel();
  }
  const x = gl.match, d = m.data || {};
  if (m.t !== "msg" || !x || d.n !== x.n) return;
  const who = x.by[m.from] = x.by[m.from] || {};
  if (d.k === "p") Object.assign(who, { at: d.at, of: d.of, score: d.score });
  if (d.k === "done") { Object.assign(who, { done: true, score: d.score, rank: d.rank, grade: d.grade }); glEnd(); }
  if (d.k === "a") {  // an answer of a round: the first right one takes its points
    const r = x.rounds[d.r] = x.rounds[d.r] || { ans: {}, first: "" };
    r.ans[m.from] = d.ok;
    if (d.ok && !r.first) { r.first = m.from; x.pts[m.from] = (x.pts[m.from] || 0) + d.pts; x.said = `Round ${d.r + 1}: ${glName(m.from)} was first · +${d.pts}`; }
  }
  if (d.k === "next" && m.from === gl.room.host) glNext(d.r);
  glPanel();
}
const glName = (id) => ((gl.room ? gl.room.players : []).find((p) => p.id === id) || {}).name || "—";
// the players of the match who are still in the room
const glIn = () => gl.match.ids.filter((id) => gl.room.players.some((p) => p.id === id));

// four times a second while a match is on: what I have done goes to the others; the host ends the rounds in step
function glTick() {
  const x = gl.match, g = x && glGame(x.game);
  if (gl.ws && gl.ws.readyState === 1 && (gl.beat = (gl.beat || 0) + 1) % 100 === 0) glSend({ t: "ping" });
  if (!x || !g || !g.duel) return;
  const [at, of, score] = glStand(x.game, g), key = at + "|" + score;
  if (key !== x.sent) { x.sent = key; glSay({ k: "p", n: x.n, at, of, score: x.mode === "first" ? x.pts[gl.id] || 0 : score }); }
  if (x.mode !== "first") return;
  const r = g.round, round = x.rounds[r] = x.rounds[r] || { ans: {}, first: "" };
  if (r !== x.r) { x.r = r; x.t0 = Date.now(); glPanel(); }
  if (g.done && !round.mine && r < 10) { round.mine = true; glSay({ k: "a", n: x.n, r, ok: !!g.done.ok, pts: g.done.points || 0 }); }
  if (glMe() && !round.ended && r < 10 && (round.first || glIn().every((id) => id in round.ans) || Date.now() - x.t0 > GL_ROUND * 1000)) { round.ended = true; glSay({ k: "next", n: x.n, r }); }
  const bar = $("#glpanel .gltime i");
  if (bar) bar.style.width = Math.max(0, 100 - (Date.now() - x.t0) / (GL_ROUND * 10)) + "%";
}
// the round is over for everybody: who hasn't answered passes; a moment to look, then the next one
function glNext(r) {
  const x = gl.match, g = glGame(x.game);
  if (!g || g.round !== r) return;
  const round = x.rounds[r] = x.rounds[r] || { ans: {}, first: "" };
  if (!round.first) x.said = `Round ${r + 1}: nobody took it`;
  if (!g.done) x.game === "track" ? gmAnswer(null, "") : x.game === "buff" ? gbAnswer(null) : GL_FIRST.slice(1, 4).includes(x.game) ? giAnswer(null) : gpAnswer(null);
  setTimeout(() => { const now = glGame(x.game); if (gl.match === x && now === g && g.round === r) { const b = $("#gmnext") || $("#ginext") || $("#gpnext") || $("#gbnext"); b && b.click(); } }, 2400);
}
// my game has ended (games.js gmOver calls this)
function glOver(game, g, score) {
  const x = gl.match;
  if (!x || x.game !== game || !g.duel || x.over) return;
  x.over = true;
  const mine = x.mode === "first" ? x.pts[gl.id] || 0 : score;
  const rank = x.mode === "first" ? mine : game === "wordle" ? (g.tries.includes(g.ans) ? 100 - g.tries.length : 0) : game === "conn" ? (g.miss < GC_MISS ? 10 - g.miss : 0) : +score || 0;
  glSay({ k: "done", n: x.n, score: mine, rank, grade: g.grade ? g.grade.name : "" });
}
// the host closes the match when everybody still in the room has finished
function glEnd() {
  const x = gl.match, s = gl.room.state;
  if (!x || !glMe() || s.status !== "play" || s.n !== x.n || !glIn().length || !glIn().every((id) => (x.by[id] || {}).done)) return;
  glSet({ status: "over", results: Object.fromEntries(glIn().map((id) => [id, { name: glName(id), score: x.by[id].score, rank: x.by[id].rank, grade: x.by[id].grade }])) });
}

// the others, next to the game
function glPanel() {
  const x = gl.match;
  if (!x || !gl.room) return;
  let el = $("#glpanel");
  if (!el) { el = document.createElement("div"); el.id = "glpanel"; document.body.appendChild(el); }
  const rows = x.ids.map((id) => ({ id, name: glName(id), gone: !gl.room.players.some((p) => p.id === id), ...(x.by[id] || {}), score: x.mode === "first" ? x.pts[id] || 0 : (x.by[id] || {}).score ?? 0 }))
    .sort((a, b) => (+b.score || 0) - (+a.score || 0));
  el.innerHTML = `<div class="glhead">${GM_SWORDS}LIVE · ${x.mode === "first" ? "FIRST TO ANSWER" : "RACE"}</div>
    ${x.mode === "first" ? `<div class="gltime"><i></i></div><div class="glsaid">${esc(x.said || "The first right answer takes the round.")}</div>` : ""}
    ${rows.map((p) => `<div class="glrow ${p.id === gl.id ? "me" : ""} ${p.gone ? "gone" : ""}"><span>${esc(p.name)}</span><small>${p.done ? "done" : p.gone ? "left" : `${p.at || 0} / ${p.of || "…"}`}</small><i>${esc(String(p.score))}</i></div>`).join("")}`;
}
