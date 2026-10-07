// Versus → Online room ("pick and fight"): a room on the site's server (ui/site/worker.js, the Games' live matches'
// rooms) for a Versus fight between two players. The host fights on the left, a player the host names on the right;
// each picks a fighter and its last skill in secret and says "ready". At the host's Start both picks are told, the
// host draws the fight's seed, and everybody's own app plays the same fight in Versus Live (the engine decides a
// fight by its seed, so it is the same on every screen). The others in the room watch, and may bet lunacy on a side.
// Only in the app: a fight is played from the game's files by the Unity player.
//   the room's state (the host sets it): {kind: "versus", status: "pick" | "reveal" | "fight", n: the fight's
//     number, right: the right fighter's player, fight: {n, spec, lp, rp, …}, last: the fight before's result}
//   messages: {k: "ready", n, on} · {k: "bet", n, side, amt} · {k: "pick", n, id, skill, name} (at "reveal" only)
"use strict";

const VR_BETS = [130, 650, 1300], VR_WIN = 200;
const vr = { ws: null, code: "", room: null, shut: true, retry: 0, error: "", full: false, beat: 0,
  pick: { id: "", skill: "" }, skl: null, bet: { side: "", amt: 0 }, fs: {}, played: 0, settled: 0, live: null, sig: "", seen: 0 };
const vrOn = () => location.hash.startsWith("#/vsroom");
const vrSend = (m) => { try { vr.ws && vr.ws.readyState === 1 && vr.ws.send(JSON.stringify(m)); } catch {} };
const vrSet = (patch) => vrSend({ t: "set", state: { ...(vr.room ? vr.room.state : {}), ...patch } });
const vrSay = (data) => vrSend({ t: "msg", data });
const vrHost = () => !!vr.room && vr.room.host === gl.id;
const vrName = (id) => ((vr.room ? vr.room.players : []).find((p) => p.id === id) || {}).name || "—";
// what a fight's number has heard so far: who is ready, the bets, the picks
const vrF = (n) => vr.fs[n] || (vr.fs[n] = { n, ready: {}, bets: {}, picks: {}, sent: false });
// who fights: the host on the left; on the right the player the host named, else whoever came in first
function vrSides() {
  const r = vr.room, others = r.players.filter((p) => p.id !== r.host);
  return { left: r.host, right: (others.find((p) => p.id === r.state.right) || others[0] || {}).id || "" };
}
const vrRole = () => { const s = vrSides(); return s.left === gl.id ? "left" : s.right === gl.id ? "right" : ""; };
const vrBusy = () => !!vr.live && ["preparing", "loading", "playing"].includes(vr.live.state);

function vrClose() {
  vr.shut = true;
  clearInterval(vr.timer);
  try { vr.ws && vr.ws.close(); } catch {}
  vr.ws = vr.room = null;
  vr.code = "";
}
function vrOpen(code) {
  vrClose();
  vr.code = code;
  vr.shut = false;
  const ws = vr.ws = new WebSocket(`${glServer()}/room/${code}?id=${gl.id}&name=${encodeURIComponent(gl.nick)}`);
  ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } if (ws === vr.ws) vrGot(m); };
  ws.onopen = () => { vr.retry = 0; };
  ws.onclose = () => {  // a line lost in the middle is picked up again; the room keeps the player's place by id
    if (ws !== vr.ws || vr.shut) return;
    if (vr.full || ++vr.retry > 6) { vr.error = vr.full ? "The room is full." : "The room can't be reached — the rooms need the site's server."; vr.ws = null; return vrDraw(); }
    setTimeout(() => { if (ws === vr.ws && !vr.shut) vrOpen(vr.code); }, 1500);
  };
  vr.timer = setInterval(() => { if (vr.ws && vr.ws.readyState === 1 && ++vr.beat % 25 === 0) vrSend({ t: "ping" }); }, 1000);
  vr.error = "";
  vr.full = false;
}
window.addEventListener("hashchange", () => { if (!vrOn() && vr.code) vrClose(); });

routes.vsroom = async (args = []) => {
  if (args[0] === "new") { location.replace("#/vsroom/" + Math.random().toString(36).slice(2, 7).replace(/[^a-z0-9]/g, "x").padEnd(5, "k")); return; }
  const code = (args[0] || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 10);
  if (code.length < 4) return vrFront();
  $("#main").innerHTML = `<h1>Versus · online room</h1><div class="sub">Reading the game's files…</div>`;
  if (!anim.data) anim.data = await api("/api/characters").catch(() => null);
  await units().catch(() => null);
  if (!vrOn()) return;
  if (!anim.data) { $("#main").innerHTML = `<h1>Versus · online room</h1><p class="muted">Nobody to pick yet: the game's files or a snapshot are missing.</p>`; return; }
  if (vr.code !== code) { vrClose(); vr.code = code; vr.shut = true; }
  if (gl.nick && !vr.ws) vrOpen(code);
  vrDraw();
};

// no room yet: make one or go into a friend's
function vrFront() {
  vrClose();
  $("#main").innerHTML = `<h1>Versus · online room</h1>
    <div class="sub">Pick and fight: two players each pick a fighter in secret, then the same fight plays on everybody's screen in Versus Live. The others in the room watch — and may bet lunacy on a side. Everybody needs the app, of the same version.</div>
    <div class="gmstart"><a class="gmbtn" href="#/vsroom/new">Make a room</a><span class="muted">or a friend's code:</span><input id="vrcode" class="dbq glin" placeholder="code" autocomplete="off"><button class="toggle" id="vrgo">Join</button></div>`;
  const go = () => { const m = /([a-z0-9]{4,10})\s*$/i.exec($("#vrcode").value.trim()); m ? (location.hash = "#/vsroom/" + m[1].toLowerCase()) : toast("That is not a room's code."); };
  $("#vrgo").onclick = go;
  $("#vrcode").onkeydown = (e) => { if (e.key === "Enter") go(); };  // (a handler that returns false would swallow the key)
}

// a message of the room
function vrGot(m) {
  if (m.t === "full") { vr.full = true; return; }
  if (m.t === "room") {
    const more = vr.room && m.players.length > vr.room.players.length;
    vr.room = m;
    const s = m.state;
    if (s.kind !== "versus") {
      if (s.game) { vr.error = "This code is a room of the Games' live matches."; vr.ws.onclose = null; vrClose(); return vrDraw(); }
      if (vrHost()) vrSet({ kind: "versus", status: "pick", n: 1, max: 8 });
      return vrDraw();
    }
    const f = vrF(s.n), role = vrRole();
    if (vr.seen !== s.n) { vr.seen = s.n; vr.bet = { side: "", amt: 0 }; }  // (a new fight: a new bet)
    if (s.status === "pick") f.sent = false;
    if (more) {  // somebody came in: they haven't heard what was said before
      if (f.ready[gl.id]) vrSay({ k: "ready", n: s.n, on: true });
      if (f.bets[gl.id]) vrSay({ k: "bet", n: s.n, ...f.bets[gl.id] });
    }
    if (s.status === "reveal" && role && !f.sent && vr.pick.id && vr.skl) {  // the picks are told now
      f.sent = true;
      const list = vr.skl.list;
      vrSay({ k: "pick", n: s.n, id: vr.pick.id, skill: vr.pick.skill || list[Math.floor(Math.random() * list.length)] || "", name: (vsChar(vr.pick.id) || {}).label || "" });
    }
    if (s.status === "fight" && s.fight && vr.played !== s.fight.n) { vr.played = s.fight.n; vrPlay(s.fight); }
    if (s.last && !vrBusy()) vrSettle(s.last);
    return vrDraw();
  }
  const s = vr.room && vr.room.state, d = m.data || {};
  if (m.t !== "msg" || !s || d.n !== s.n) return;
  const f = vrF(s.n);
  if (d.k === "ready") f.ready[m.from] = !!d.on;
  if (d.k === "bet") d.amt > 0 && ["left", "right"].includes(d.side) ? (f.bets[m.from] = { side: d.side, amt: Math.min(+d.amt, VR_BETS[VR_BETS.length - 1]) }) : delete f.bets[m.from];
  if (d.k === "pick") {
    f.picks[m.from] = { id: String(d.id || ""), skill: String(d.skill || ""), name: String(d.name || "").slice(0, 80) };
    if (vrHost() && s.status === "reveal") vrStart();
  }
  vrDraw();
}

// the host, with both picks told: the fight itself — the host's own Versus settings (stage, music, what is shown),
// the two picks and a seed
function vrStart() {
  const s = vr.room.state, f = vrF(s.n), { left, right } = vrSides(), a = f.picks[left], b = f.picks[right];
  if (!a || !b || !vsChar(a.id) || !vsChar(b.id)) return;
  const spec = { ...vsSpec("clash"), left: a.id, right: b.id, skill: a.skill, rskill: b.skill, lname: a.name, rname: b.name, winner: 2, randskill: false,
    seed: Math.floor(Math.random() * 1e9) };
  delete spec.loop;
  vrSet({ status: "fight", fight: { n: s.n, spec, lp: left, rp: right, lnick: vrName(left), rnick: vrName(right) } });
}

// my app plays the fight (Versus Live: a window of the Unity player)
async function vrPlay(fight) {
  if (document.body.classList.contains("site")) return;
  vr.live = { n: fight.n, state: "preparing", msg: "Starting the fight…" };
  try { await api("/api/versus", { ...fight.spec, live: true }); } catch (e) { vr.live = { n: fight.n, state: "error", msg: e.message }; return vrLiveEnd(); }
  vrPoll(fight.n);
}
async function vrPoll(n) {
  if (!vr.live || vr.live.n !== n) return;
  let st;
  try { st = await api("/api/versus_live"); } catch { return setTimeout(() => vrPoll(n), 2000); }
  vr.live = { n, ...st };
  if (vrBusy()) setTimeout(() => vrPoll(n), 1000); else vrLiveEnd();
  vrDraw();
}
// my fight is over: the host's result is the room's (a fight stopped half way or failed has none)
function vrLiveEnd() {
  const st = vr.live, s = vr.room && vr.room.state;
  if (s && vrHost() && s.status === "fight" && s.fight && s.fight.n === st.n) vrOver(st.state === "done" && !st.stopped && st.winner != null ? +st.winner : null, st.state === "error" ? st.msg : "");
  else if (s && s.last) vrSettle(s.last);
  vrDraw();
}
function vrOver(w, err) {
  const s = vr.room.state, x = s.fight;
  vrSet({ status: "pick", n: x.n + 1, fight: null, last: { n: x.n, w, err: err || "", lp: x.lp, rp: x.rp, lnick: x.lnick, rnick: x.rnick, l: x.spec.left, r: x.spec.right, lname: x.spec.lname, rname: x.spec.rname } });
}
// a fight's result: my bet is paid or lost, a fighter's win pays
function vrSettle(last) {
  if (vr.settled >= last.n) return;
  vr.settled = last.n;
  const bet = (vr.fs[last.n] || { bets: {} }).bets[gl.id], side = last.w ? "right" : "left";
  if (last.w == null) return bet && toast("The fight had no result — the bets are off.");
  const got = [];
  if ((last.w ? last.rp : last.lp) === gl.id && vr.played === last.n) got.push([VR_WIN, "a fight won"]);  // (not again after the page was opened anew)
  if (bet && bet.side === side) got.push([bet.amt, "a bet won"]);
  if (bet && bet.side !== side) {
    gmW.lunacy = Math.max(0, gmW.lunacy - bet.amt);
    gmWKeep();
    toast(`<b>−${bet.amt}</b> lunacy · the bet is lost`);
  }
  if (got.length) gmPay(got);
}

async function vrPick(id) {
  const c = vsChar(id);
  if (!c) return;
  vr.pick = { id: c.id, skill: "" };
  vr.skl = null;
  vrDraw();
  const r = await api(`/api/skills?id=${encodeURIComponent(c.id)}`).catch(() => null);
  if (vr.pick.id !== c.id) return;
  const list = ((r || {}).skills || []).filter((n) => !/(^|_)(Parrying|Duel_?Win|Dead|Retreat)(_|$)/i.test(n));
  if (!list.length) { vr.pick = { id: "", skill: "" }; toast(`${esc(c.label)} has no skill to fight with — pick another.`); return vrDraw(); }
  vr.skl = { id: c.id, list, slots: r.slots };
  vrDraw();
}

function vrDraw() {
  if (!vrOn() || !vr.code) return;
  const code = vr.code, chip = (on, attr, text, off) => `<button class="toggle ${on ? "on" : ""}" ${attr} ${off ? "disabled" : ""}>${text}</button>`;
  const head = `<h1>Versus · online room</h1><div class="glroom"><span class="gmscore">ROOM <b>${esc(code.toUpperCase())}</b></span>
    <button class="toggle" id="vrcopy">${GM_SWORDS}Copy the invite</button><span class="muted small">Friends come in from their app: Versus → Online room → the code.</span></div>`;
  const invite = () => { if ($("#vrcopy")) $("#vrcopy").onclick = () => gmCopy(`Limbus Archive · a Versus room — pick a fighter and fight me.\nIn the app: Versus → Online room → code ${code.toUpperCase()}`); };
  if (!gl.nick || !vr.ws) {  // who are you: asked on the way in, kept for the next time (the Games' live matches' nickname)
    vr.sig = "";
    $("#main").innerHTML = `${head}${vr.error ? `<p class="glerr">${esc(vr.error)}</p>` : ""}
      <div class="gmstart"><span class="muted">Your nickname:</span><input id="vrnick" class="dbq glin" maxlength="20" value="${esc(gl.nick)}" placeholder="nickname" autocomplete="off"><button class="gmbtn" id="vrjoin">Come in</button></div>`;
    const join = () => { const n = $("#vrnick").value.trim().slice(0, 20); if (!n) return $("#vrnick").focus(); gl.nick = n; glKeep(); vrOpen(code); vrDraw(); };
    $("#vrjoin").onclick = join;
    $("#vrnick").onkeydown = (e) => { if (e.key === "Enter") join(); };
    $("#vrnick").focus();
    return invite();
  }
  if (!vr.room || vr.room.state.kind !== "versus") { vr.sig = ""; $("#main").innerHTML = `${head}<p class="muted">Coming into the room…</p>`; return invite(); }
  if (!$("#vrmine")) { vr.sig = ""; $("#main").innerHTML = `${head}<div id="vrtop"></div><div class="glcols"><div id="vrplayers"></div><div id="vrmine"></div></div>`; invite(); }
  const r = vr.room, s = r.state, f = vrF(s.n), sides = vrSides(), role = vrRole(), host = vrHost(), picking = s.status === "pick";
  const face = (id, name, nick, cls) => `<div class="vrface ${cls}">${id ? `<img src="${vsIcon(id)}" onerror="this.style.visibility='hidden'">` : `<div class="vrq">?</div>`}<b>${esc(name)}</b><i>${esc(nick)}</i></div>`;
  // the fight on now, or the one before's result
  const x = s.fight, last = s.last && !vrBusy() ? s.last : null, live = vr.live && x && vr.live.n === x.n ? vr.live : vr.live && vrBusy() ? vr.live : null;
  $("#vrtop").innerHTML = x || (live && vrBusy()) ? `<div class="vrfight"><div class="gmkick">FIGHT ${(x || live).n} · ${esc(live ? live.msg || live.state : "starting…")}</div>
      ${x ? `<div class="vrvs">${face(x.spec.left, x.spec.lname, x.lnick, "")}<span>VS</span>${face(x.spec.right, x.spec.rname, x.rnick, "")}</div>` : ""}
      <div class="gnbtns">${vrBusy() ? `<button class="toggle" id="vrstop">Stop my player</button>` : ""}${host && x ? `<button class="toggle" id="vrend">End the fight for everybody</button>` : ""}</div>
      ${live && live.state === "error" ? `<p class="glerr">${esc(live.msg || "the fight could not be played")}</p>` : ""}</div>`
    : last ? `<div class="vrfight"><div class="gmkick">FIGHT ${last.n} · ${last.w == null ? `NO RESULT${last.err ? " — " + esc(last.err) : ""}` : `${esc((last.w ? last.rnick : last.lnick).toUpperCase())} WINS`}</div>
      <div class="vrvs">${face(last.l, last.lname, last.lnick, last.w === 0 ? "win" : last.w === 1 ? "lost" : "")}<span>VS</span>${face(last.r, last.rname, last.rnick, last.w === 1 ? "win" : last.w === 0 ? "lost" : "")}</div></div>` : "";
  if ($("#vrstop")) $("#vrstop").onclick = () => api("/api/versus_live_stop", {}).catch(() => {});
  if ($("#vrend")) $("#vrend").onclick = () => vrOver(null, "");
  // who is in
  const tag = (p) => p.id === sides.left ? "LEFT" : p.id === sides.right ? "RIGHT" : "";
  $("#vrplayers").innerHTML = `<div class="gmgrp">Players <small>${r.players.length} / ${s.max || 8}</small></div>
    ${r.players.map((p) => { const t = tag(p), b = f.bets[p.id];
      return `<div class="glrow ${p.id === gl.id ? "me" : ""}"><span>${esc(p.name)}</span>${t ? `<em class="vrtag">${t}</em>` : ""}${p.id === r.host ? "<em>HOST</em>" : ""}
        ${t ? (f.ready[p.id] ? `<i>ready</i>` : `<small>picking…</small>`) : b ? `<small>${b.amt} on ${b.side}</small>` : host && picking ? `<button class="toggle" data-right="${esc(p.id)}">make the opponent</button>` : `<small>watching</small>`}</div>`; }).join("")}`;
  document.querySelectorAll("#vrplayers [data-right]").forEach((b) => b.onclick = () => vrSet({ right: b.dataset.right }));
  // my corner: a fighter's pick, or a watcher's bet; the host's Start
  const both = sides.right && f.ready[sides.left] && f.ready[sides.right], c = vr.pick.id ? vsChar(vr.pick.id) : null, ready = !!f.ready[gl.id], bet = f.bets[gl.id];
  const sig = JSON.stringify([role, s.n, s.status, vr.pick, !!vr.skl, ready, bet, both, host, sides, gmW.lunacy, vr.bet]);
  if (sig === vr.sig) return;
  vr.sig = sig;
  const start = host ? `<div class="gmstart"><button class="gmbtn" id="vrstart" ${picking && both ? "" : "disabled"}>Start the fight</button>
    <span class="muted small">${!sides.right ? "Waiting for somebody to come in." : !picking ? "The picks are being told…" : both ? "Both are ready." : "Both fighters must be ready."}${picking ? "" : ` <button class="toggle" id="vrback">Back to picking</button>`}</span></div>` : "";
  const mine = !role ? `<div class="gmgrp">Your bet</div>
      <div class="muted small vrnote">You watch this one. Bet lunacy on a side if you like — you have ${gmW.lunacy.toLocaleString("en")}. A bet won pays as much again.</div>
      <div class="dbrow">${chip(vr.bet.side === "left", 'data-side="left"', `Left · ${esc(vrName(sides.left))}`, !picking)}${chip(vr.bet.side === "right", 'data-side="right"', `Right · ${esc(vrName(sides.right))}`, !picking || !sides.right)}</div>
      <div class="dbrow">${VR_BETS.map((n) => chip(vr.bet.amt === n, `data-amt="${n}"`, n, !picking || n > gmW.lunacy)).join("")}${chip(!vr.bet.amt, 'data-amt="0"', "No bet", !picking)}</div>
      <p class="muted small">${bet ? `Your bet: <b>${bet.amt}</b> on the ${bet.side}.` : "No bet placed."}</p>`
    : `<div class="gmgrp">Your fighter <small>${role === "left" ? "YOU FIGHT ON THE LEFT" : "YOU FIGHT ON THE RIGHT"}</small></div>
      <div class="muted small vrnote">Nobody sees your pick until the fight starts.</div>
      ${c ? `<div class="vrpick"><img src="${vsIcon(c.id)}" onerror="this.style.visibility='hidden'"><div><b>${esc(c.label)}</b><i>${esc(c.group)}</i>
          ${vr.skl ? `<label>Last skill <select id="vrskill" ${ready ? "disabled" : ""}><option value="">Random</option>${vr.skl.list.map((n) => `<option value="${esc(n)}" ${n === vr.pick.skill ? "selected" : ""}>${esc(fxLabel(n, vr.skl.slots))}</option>`).join("")}</select></label>` : `<span class="muted small">Reading its skills…</span>`}</div>
          <button class="toggle" id="vrchange" ${ready ? "disabled" : ""}>Change</button></div>`
      : `<div class="gwtype"><input id="vrin" class="dbq" placeholder="Identity, E.G.O or enemy…" autocomplete="off"><div id="vrsugg" class="gmsugg"></div></div>`}
      <div class="gmstart">${ready ? `<span class="gmscore"><i>READY</i></span><button class="toggle" id="vrunready" ${picking ? "" : "disabled"}>Not ready</button>`
        : `<button class="gmbtn" id="vrready" ${c && vr.skl && picking ? "" : "disabled"}>Ready</button>`}</div>`;
  $("#vrmine").innerHTML = mine + start;
  if ($("#vrin")) gxType($("#vrin"), $("#vrsugg"), () => vsChars().map((ch) => ({ key: ch.id, name: ch.label, title: ch.label, sub: ch.group })), vrPick);
  if ($("#vrskill")) $("#vrskill").onchange = (e) => { vr.pick.skill = e.target.value; };
  if ($("#vrchange")) $("#vrchange").onclick = () => { vr.pick = { id: "", skill: "" }; vr.skl = null; vrDraw(); };
  if ($("#vrready")) $("#vrready").onclick = () => vrSay({ k: "ready", n: s.n, on: true });
  if ($("#vrunready")) $("#vrunready").onclick = () => vrSay({ k: "ready", n: s.n, on: false });
  if ($("#vrstart")) $("#vrstart").onclick = () => vrSet({ status: "reveal" });
  if ($("#vrback")) $("#vrback").onclick = () => vrSet({ status: "pick", fight: null });
  const place = () => { vrSay({ k: "bet", n: s.n, side: vr.bet.side, amt: vr.bet.side ? vr.bet.amt : 0 }); vrDraw(); };
  document.querySelectorAll("#vrmine [data-side]").forEach((b) => b.onclick = () => { vr.bet.side = b.dataset.side; place(); });
  document.querySelectorAll("#vrmine [data-amt]").forEach((b) => b.onclick = () => { vr.bet.amt = +b.dataset.amt; place(); });
}
