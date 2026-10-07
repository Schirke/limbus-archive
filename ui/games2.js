// Games → Guess the Identity: a voice line of an Identity (or, as an extra, a boss's battle line) by ear or by its
// text — name whose it is. When it is said is always shown; the other hints cost points. (/api/quiz, games.js styles)
// Games → Guess the skill is the same game over skill icons (gi.page "skill"): whose skill is it.
"use strict";

const GI_KEEP = "games_id", GI_ROUNDS = 10, GI_HINT = 250;
const gi = { page: "id", who: "ids", text: false, hard: false, sinner: 0, best: {},
  ...(() => { try { return JSON.parse(localStorage.getItem(GI_KEEP) || "{}"); } catch { return {}; } })(), game: null, data: null };
const giAudio = new Audio();
const giKeep = () => { try { localStorage.setItem(GI_KEEP, JSON.stringify({ who: gi.who, text: gi.text, hard: gi.hard, sinner: gi.sinner, best: gi.best })); } catch {} };
const giSkill = () => gi.page === "skill";
const giChar = () => gi.page === "char";  // Guess the character: who speaks in the story (bosses and everybody else)
const giTitle = () => giSkill() ? "Guess the skill" : giChar() ? "Guess the character" : "Guess the Identity";
const giMode = () => giChar() ? "c" + (gi.text ? "t" : "v") + (gi.hard ? "h" : "e") : giSkill() ? "s" + (gi.hard ? "h" : "e") + gi.sinner : gi.who + (gi.text ? "t" : "v") + (gi.hard ? "h" : "e") + (gi.who === "bosses" ? "" : gi.sinner);
// a season as the game tags it: one name for every Walpurgis Night, none for the standard ones (0), collaborations have no number
const giSeason = (units, s) => ((units.seasons || {})[s == null ? "8000" : s > 9100 && s < 9200 ? "9100" : String(s)] || {}).name || (s ? "" : "Standard");
const giPick = (a) => a[Math.floor(gmRnd() * a.length)];
const giGame = () => giSkill() ? "skill" : giChar() ? "char" : "id";
const giThumb = (path) => `/api/asset_thumb?path=${encodeURIComponent(path)}`;

function giStop() {
  giAudio.pause();
  document.body.classList.remove("quiz");
}
window.addEventListener("hashchange", () => { if (!/^#\/game(id|skill|char)/.test(location.hash) && (gi.game || gi.mine)) { giStop(); gi.game = null; giDailyEnd(); } });

routes.gameid = (args = []) => giOpen("id", gmAuto("id", args));
routes.gameskill = (args = []) => giOpen("skill", gmAuto("skill", args));
routes.gamechar = (args = []) => giOpen("char", gmAuto("char", args));
async function giOpen(page, daily) {  // daily: opened by the "Daily" / "Duel" button of the games' page — the challenge starts at once
  giStop();
  gi.page = page;
  gi.game = null;
  gmCrumb(giGame());
  $("#main").innerHTML = `<h1>${giTitle()}</h1><div class="sub">Reading the game's files…</div>`;
  if (!gi.data) {
    const [q, units, en] = await Promise.all([api("/api/quiz"), api("/api/units"), api("/api/enemies")].map((p) => p.catch(() => null)));
    const ids = new Map(((units || {}).ids || []).map((x) => [x.id, { key: "i" + x.id, id: x.id, name: x.title + " " + x.sinnerName, title: x.title, sub: x.sinnerName,
      sinner: x.sinner, season: giSeason(units, x.season), pic: giThumb(x.img.thumb), lines: [],
      // its skills by their pictures: the name as of the last uptie; what is free to see = sin, damage type, which skill
      skills: (x.skills || []).concat(x.defense || []).map((s) => { const u = s.up[Math.max(...Object.keys(s.up).map(Number))] || {};
        return { s: String(s.id), pic: giThumb(`Assets/Resources_moved/Sprite/SkillIcon/${s.icon || s.id}.png`), text: u.name || "",
          when: [u.sin, u.atk, s.type === "SKILL" ? "Skill " + s.tier : u.def || "Defense"].filter(Boolean).join(" · ") }; }).filter((s) => s.text) }]));
    const thumbs = new Set((en || {}).thumbs || []);
    const bosses = new Map(((en || {}).list || []).map((e) => [e.id, { key: "b" + e.id, id: e.id, name: e.name, title: e.name, sub: e.group, boss: true,
      pic: thumbs.has(e.app) && (e.spine || !e.pic) ? `/api/enemy_thumb?app=${encodeURIComponent(e.app)}` : e.pic ? giThumb(e.pic) : "", lines: [] }]));
    for (const [s, id, when, text] of (q || {}).ids || []) ids.get(id)?.lines.push({ s, when, text });
    for (const [s, id, text] of (q || {}).bosses || []) bosses.get(id)?.lines.push({ s, when: "", text });
    // the story's characters by their picture in the story's log; without one a boss has the handbook's, a Sinner his base Identity's
    const chars = ((q || {}).chars || []).map((c, i) => { const b = c.boss && bosses.get(c.boss), s = c.sinner && ids.get(10001 + c.sinner * 100);
      return { key: "c" + i, id: c.boss || 0, name: c.name, title: c.name, sub: c.where, role: c.role, boss: !!c.boss, char: true, order: c.order,
        pic: c.pic ? giThumb(c.pic) : b ? b.pic : s ? s.pic : "", lines: c.lines.map(([sm, text, where]) => ({ s: sm, when: where, text })) }; });
    gi.data = { chars, all: [...ids.values()], ids: [...ids.values()].filter((x) => x.lines.length), bosses: [...bosses.values()].filter((x) => x.lines.length),
      sinners: (units || {}).sinners || [] };
  }
  giDrawStart();
  if (daily && gi.page === page && $("#gmdaily") && !$("#gmdaily").disabled) giNew(true);
}

// who can be asked with the current chips; a line by its text needs a text
function giPool() {
  const d = gi.data, ok = (x) => x.lines.some((l) => !gi.text || l.text);
  if (giSkill()) return d.all.filter((x) => (!gi.sinner || x.sinner === gi.sinner) && x.skills.length);
  if (giChar()) return d.chars;
  const ids = d.ids.filter((x) => (!gi.sinner || x.sinner === gi.sinner) && ok(x)), bosses = d.bosses.filter(ok);
  return gi.who === "ids" ? ids : gi.who === "bosses" ? bosses : [...ids, ...bosses];
}

function giDrawStart() {
  const d = gi.data, pool = giPool(), chip = (on, attr, text) => `<button class="toggle ${on ? "on" : ""}" ${attr}>${text}</button>`;
  $("#main").innerHTML = `<h1>${giTitle()}</h1>
    <div class="sub">${giChar() ? "A voiced line from the story — by ear or by its text. Name who says it. Where in the story it is said is always shown; the other hints cost points."
      : giSkill() ? "The picture of a skill — name whose skill it is. Its sin and damage type are always shown; the skill's name and the season are hints that cost points."
      : "A voice line — by ear or by its text. Name whose it is. When it is said is always shown; the other hints cost points."}</div>
    ${!pool.length && !gi.sinner ? `<p class="muted">Nothing to ask yet: the game's files or a snapshot are missing.</p>` : giChar() ? `
    <div class="dbrow">${chip(!gi.text, 'data-t=""', "By voice")}${chip(gi.text, 'data-t="1"', "By text")}<span class="gap"></span>
      ${chip(!gi.hard, 'data-h=""', "Easy · 4 answers")}${chip(gi.hard, 'data-h="1"', "Hard · type the name")}</div>
    <div class="gmstart"><span class="gmscore">${pool.length} CHARACTERS · BEST <i>${gi.best[giMode()] || 0}</i></span>
      ${gmDailyBtn(giGame(), !pool.length)}<button class="gmbtn" id="gigo" ${pool.length < 4 ? "disabled" : ""}>Start · ${GI_ROUNDS} rounds</button></div>
    <div class="muted small">Everybody who speaks in the story, bosses and Sinners too. The wrong answers are characters of the same part of the story.</div>` : giSkill() ? `
    <div class="dbrow">${chip(!gi.hard, 'data-h=""', "Easy · 4 portraits")}${chip(gi.hard, 'data-h="1"', "Hard · type the name")}</div>
    <div class="dbrow">${chip(!gi.sinner, 'data-s="0"', "All Sinners")}${d.sinners.map((n, i) => chip(gi.sinner === i + 1, `data-s="${i + 1}"`, esc(n))).join("")}</div>
    <div class="gmstart"><span class="gmscore">${pool.length} IDENTITIES · BEST <i>${gi.best[giMode()] || 0}</i></span>
      ${gmDailyBtn(giGame(), !d.all.length)}<button class="gmbtn" id="gigo" ${pool.length < 4 ? "disabled" : ""}>Start · ${GI_ROUNDS} rounds</button></div>
    <div class="muted small">The wrong answers are other Identities of the same Sinner.</div>` : `
    <div class="dbrow">${chip(gi.who === "ids", 'data-w="ids"', "Identities")}${chip(gi.who === "bosses", 'data-w="bosses"', `Bosses · ${d.bosses.length}`)}${chip(gi.who === "mix", 'data-w="mix"', "Both")}<span class="gap"></span>
      ${chip(!gi.text, 'data-t=""', "By voice")}${chip(gi.text, 'data-t="1"', "By text")}<span class="gap"></span>
      ${chip(!gi.hard, 'data-h=""', "Easy · 4 portraits")}${chip(gi.hard, 'data-h="1"', "Hard · type the name")}</div>
    ${gi.who === "bosses" ? "" : `<div class="dbrow">${chip(!gi.sinner, 'data-s="0"', "All Sinners")}${d.sinners.map((n, i) => chip(gi.sinner === i + 1, `data-s="${i + 1}"`, esc(n))).join("")}</div>`}
    <div class="gmstart"><span class="gmscore">${pool.length} TO GUESS · BEST <i>${gi.best[giMode()] || 0}</i></span>
      ${gmDailyBtn(giGame(), !d.all.length)}<button class="gmbtn" id="gigo" ${pool.length < 4 ? "disabled" : ""}>Start · ${GI_ROUNDS} rounds</button></div>
    <div class="muted small">The wrong answers are other Identities of the same Sinner — the voice is the same, the Identity is what you tell apart. Bosses: the ones with voiced battle lines.</div>`}`;
  const main = $("#main"), set = (sel, key, f) => main.querySelectorAll(sel).forEach((b) => b.onclick = () => { gi[key] = f(b); giKeep(); giDrawStart(); });
  set("[data-w]", "who", (b) => b.dataset.w);
  set("[data-t]", "text", (b) => !!b.dataset.t);
  set("[data-h]", "hard", (b) => !!b.dataset.h);
  set("[data-s]", "sinner", (b) => +b.dataset.s);
  if ($("#gigo")) $("#gigo").onclick = () => giNew();
  if ($("#gmdaily")) $("#gmdaily").onclick = () => giNew(true);
}

// a daily game runs on fixed settings (Identities, by voice, Easy, every Sinner); the player's own come back after it
function giDailyEnd() {
  if (gi.mine) Object.assign(gi, gi.mine);
  gi.mine = null;
  gmRnd = Math.random;
}

function giNew(daily) {
  const duel = daily === true ? gmDuelTake(giGame()) : null;
  giDailyEnd();
  if (daily === true) {
    gi.mine = { who: gi.who, text: gi.text, hard: gi.hard, sinner: gi.sinner };
    Object.assign(gi, { who: "ids", text: false, hard: false, sinner: 0 });
    gmRnd = gmDaySeed(giGame(), duel);
  }
  gi.game = { daily: daily === true, duel, pool: giPool(), round: -1, score: 0, streak: 0, top: 0, log: [], asked: new Set() };
  if (typeof muAudio !== "undefined") muAudio.pause();
  giRound();
}

function giRound() {
  const g = gi.game;
  giStop();
  document.body.classList.add("quiz");
  if (++g.round >= GI_ROUNDS) return giResult();
  let ans;
  for (let k = 0; k < 30 && (!ans || g.asked.has(ans.key)); k++) ans = giPick(g.pool);
  g.asked.add(ans.key);
  const line = giSkill() ? giPick(ans.skills) : giPick(ans.lines.filter((l) => !gi.text || l.text));
  // wrong answers: the same Sinner's other Identities; for a boss, other bosses (the next ones in the handbook's order)
  const all = ans.char ? gi.data.chars : ans.boss ? gi.data.bosses : giSkill() ? gi.data.all : gi.data.ids;
  let near = ans.char || ans.boss ? all.filter((x) => x !== ans).sort((a, b) => Math.abs(all.indexOf(a) - all.indexOf(ans)) - Math.abs(all.indexOf(b) - all.indexOf(ans))).slice(0, 8)
    : all.filter((x) => x !== ans && x.sinner === ans.sinner);
  if (near.length < 3) near = all.filter((x) => x !== ans);
  Object.assign(g, { ans, line, opts: gmShuffle([ans, ...gmShuffle(near.slice()).slice(0, 3)]), hints: {}, done: null });
  if (giSkill()) return giDraw();
  giAudio.src = "/api/quiz_audio?s=" + encodeURIComponent(line.s);
  giAudio.volume = (typeof mu !== "undefined" && mu.vol) || 0.6;
  giAudio.onerror = () => toast("This line could not be read from the game's files.");
  if (!gi.text) giAudio.play().catch(() => {});
  giDraw();
}

// the hints of a round: [key, label, value]; the free one first
function giHints() {
  const g = gi.game, a = g.ans, l = g.line, list = [];
  list.push(a.char ? ["when", "WHERE", l.when] : a.boss ? ["when", "WHERE", a.sub] : giSkill() ? ["when", "SKILL", l.when || "—"] : ["when", "WHEN", l.when || "—"]);
  if (giSkill()) list.push(["text", "NAME", l.text]);
  if (!a.boss && a.season) list.push(["season", "SEASON", a.season]);
  if (a.char && a.role) list.push(["role", "ROLE", a.role]);
  if (giSkill()) return list;
  if (!gi.text && l.text) list.push(["text", "TEXT", "“" + l.text + "”"]);
  if (gi.text) list.push(["voice", "VOICE", "playing"]);
  return list;
}
const giWorth = () => Math.max(GI_HINT, 1000 - GI_HINT * Object.keys(gi.game.hints).length) * (gi.hard ? 2 : 1);

function giDraw() {
  const g = gi.game, a = g.ans, d = g.done, used = Object.keys(g.hints).length;
  const hint = ([k, label, val]) => k === "when" || g.hints[k] || d ? `<div class="gihint open"><small>${label}</small><b>${esc(val)}</b></div>`
    : `<button class="gihint" data-hint="${k}"><small>${label}</small><b>hidden</b><u>open · −${GI_HINT * (gi.hard ? 2 : 1)}</u></button>`;
  const card = (o) => `<button class="gicard ${d ? (o === a ? "ok" : o.key === d.pick ? "bad" : "dim") : ""}" data-k="${o.key}" ${d ? "disabled" : ""}>
    <span class="pic ${o.char ? "who" : ""}">${o.pic ? `<img src="${o.pic}" onerror="this.remove()">` : ""}${o.char ? `<em>${esc(o.name.replace(/[^\p{L} ]/gu, "").split(" ").map((w) => w[0] || "").join("").slice(0, 2).toUpperCase())}</em>` : ""}</span><b>${esc(o.title)}</b><i>${esc(o.sub)}</i></button>`;
  const quote = giSkill() ? "" : gi.text || d ? (g.line.text ? `<div class="giquote">“${esc(g.line.text)}”</div>` : `<div class="giquote dim">No text for this one in the game's files.</div>`) : "";
  $("#main").innerHTML = `<h1>${giTitle()}</h1>
    <div class="gmtop"><span class="gmscore">ROUND <b>${g.round + 1} / ${GI_ROUNDS}</b></span><span class="grow"></span>
      <span class="gmscore">SCORE <b>${g.score}</b> &nbsp; STREAK <i>×${g.streak}</i></span><button class="toggle" id="giquit">Quit</button></div>
    <div class="gmstage gistage"><div>${giSkill() ? `<div class="giskill"><img id="giskpic" src="${g.line.pic}"></div>` : gi.text && !d && !g.hints.voice ? "" : `<button id="gidisc" class="gmdisc gidisc" title="Play it again"><div>▶</div></button>`}
      <div class="gihints">${giHints().map(hint).join("")}</div></div>
    <div><div class="gmkick">${d ? (d.ok ? `+${d.points}${used ? ` · ${used} HINT${used > 1 ? "S" : ""} USED` : ""}` : "MISSED") : `WORTH ${giWorth()} NOW`}</div>
      <div class="gmq">${d ? esc(a.name) : a.char ? "Who says this?" : a.boss ? "Who says this in a fight?" : giSkill() ? "Whose skill is this?" : "Whose line is this?"}</div>${quote}
      ${gi.hard && !d ? `<input id="gitype" class="dbq" placeholder="${a.boss ? "Boss…" : "Identity…"}" autocomplete="off"><div id="gisugg" class="gmsugg"></div>
        <button class="toggle gmmore" id="giskip">I don't know</button>`
      : gi.hard ? `<div class="gmopts"><div class="gmopt ${d.ok ? "ok" : "bad"}"><b>${esc(d.said || "—")}</b><i>your answer</i></div></div>`
      : `<div class="gicards">${g.opts.map(card).join("")}</div>`}
      ${d ? `<div class="gmafter">${a.char && !a.boss ? `<span>${esc([a.role, a.sub].filter(Boolean).join(" · "))}</span>` : a.boss ? `<a href="#/enemies/${a.id}">Open in the handbook →</a>` : `<a href="#/db/${a.id}">Open in the database →</a>`}
        <button class="gmbtn" id="ginext">${g.round + 1 < GI_ROUNDS ? "Next" : "Result"}</button></div>` : ""}</div></div>`;
  $("#giquit").onclick = () => { giStop(); gi.game = null; giDailyEnd(); giDrawStart(); };
  // a skill the game has no picture of: another one takes the round
  if ($("#giskpic")) $("#giskpic").onerror = () => { a.skills = a.skills.filter((s) => s !== g.line); if (!a.skills.length) g.pool = g.pool.filter((x) => x !== a); g.round--; giRound(); };
  if ($("#gidisc")) $("#gidisc").onclick = () => { giAudio.currentTime = 0; giAudio.play().catch(() => {}); };
  document.querySelectorAll("[data-hint]").forEach((b) => b.onclick = () => { g.hints[b.dataset.hint] = 1; if (b.dataset.hint === "voice") giAudio.play().catch(() => {}); giDraw(); });
  document.querySelectorAll(".gicards button").forEach((b) => b.onclick = () => giAnswer(b.dataset.k));
  if ($("#ginext")) { $("#ginext").onclick = giRound; $("#ginext").focus(); }
  if ($("#giskip")) $("#giskip").onclick = () => giAnswer(null);
  if ($("#gitype")) {
    const inp = $("#gitype"), from = a.char ? gi.data.chars : a.boss ? gi.data.bosses : gi.data.all;
    inp.oninput = () => {
      const q = inp.value.trim().toLowerCase(), hits = q.length < 2 ? [] : from.filter((x) => x.name.toLowerCase().includes(q));
      $("#gisugg").innerHTML = hits.map((x, i) => `<div data-k="${x.key}" class="${i ? "" : "on"}">${esc(x.title)}<i>${esc(x.sub)}</i></div>`).join("");
      $("#gisugg").querySelectorAll("div").forEach((r) => r.onclick = () => giAnswer(r.dataset.k));
    };
    inp.onkeydown = (e) => {
      const rows = [...$("#gisugg").children], at = rows.findIndex((r) => r.classList.contains("on"));
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
}

function giAnswer(key) {
  const g = gi.game, said = key && [...gi.data.all, ...gi.data.bosses, ...gi.data.chars].find((x) => x.key === key);
  const ok = key === g.ans.key, points = ok ? giWorth() : 0;
  g.streak = ok ? g.streak + 1 : 0;
  g.top = Math.max(g.top, g.streak);
  g.score += points;
  g.done = { ok, pick: key, points, said: said ? said.name : "" };
  g.log.push({ ans: g.ans, line: g.line, ok, points, said: said ? said.name : "—", hints: Object.keys(g.hints).length });
  if (!giSkill()) {
    giAudio.currentTime = 0;
    giAudio.play().catch(() => {});  // by text: now it is heard
  }
  giDraw();
}

function giResult() {
  const g = gi.game;
  if (g.daily) gmDailyOver(giGame(), g, g.score);
  const tag = g.daily ? gmDayTag(g) : "", game = giGame();
  giDailyEnd();
  const mode = giMode(), record = !g.daily && g.score > (gi.best[mode] || 0);
  if (!g.daily) gi.best[mode] = Math.max(gi.best[mode] || 0, g.score);
  giKeep();
  giStop();
  $("#main").innerHTML = `<h1>${giTitle()}</h1>
    <div class="gmtop"><span class="gmbig">${g.score}</span><span class="gmscore">${g.log.filter((r) => r.ok).length} OF ${g.log.length} · BEST STREAK ×${g.top} · BEST <i>${gi.best[mode] || 0}</i>${record ? " · NEW RECORD" : ""}</span>
      <span class="grow"></span>${g.daily ? `<span class="gmscore">${tag}</span><button class="toggle" id="gicopy">${gmCopyLabel(g)}</button>` : ""}<button class="toggle" id="giback">Settings</button><button class="gmbtn" id="giagain">Play again</button></div>
    <table class="gmlog"><tr><th>#</th><th>WHO</th><th>${giSkill() ? "SKILL" : "LINE"}</th><th>YOUR ANSWER</th><th>HINTS</th><th>POINTS</th><th></th></tr>
    ${g.log.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.ans.name)}</td><td class="giline">${esc(r.line.text || "—")}<i>${esc(r.line.when)}</i></td>
      <td class="${r.ok ? "ok" : "bad"}">${esc(r.said)}</td><td>${r.hints || ""}</td><td>${r.points}</td><td>${giSkill() ? `<img class="gilogpic" src="${r.line.pic}">` : `<button class="toggle" data-say="${esc(r.line.s)}">▶</button>`}</td></tr>`).join("")}</table>`;
  $("#giagain").onclick = () => giNew();
  if ($("#gicopy")) $("#gicopy").onclick = () => gmCopyResult(game, g, () => gmShare(giTitle(), g.score, g.log.map((r) => ({ ok: r.ok, clean: !r.hints }))));
  $("#giback").onclick = () => { gi.game = null; giDrawStart(); };
  document.querySelectorAll("[data-say]").forEach((b) => b.onclick = () => { giAudio.src = "/api/quiz_audio?s=" + encodeURIComponent(b.dataset.say); giAudio.play().catch(() => {}); });
}
