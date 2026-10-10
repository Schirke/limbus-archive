// Games → Chain (from one Identity to another, every step sharing something with the one before), Guess the buff
// (a buff's own effect, as Database → Buff effects shows it), Mixed up (a piece of a track cut into parts — put them
// back in order) and Jigsaw (an Identity's art cut into tiles — put it together against the clock).
// Shares the styles, the Identities' list (gxIds), the type-ahead field (gxType) and the Daily challenge / duels of
// games.js / games3.js.
"use strict";

// ------------------------------------------------------------------ shared
const GZ_KEEP = "games_new";
const gz = { chain: { best: {} }, buff: { best: {} }, mix: { best: {}, battle: true }, jig: { best: {} },
  ...(() => { try { return JSON.parse(localStorage.getItem(GZ_KEEP) || "{}"); } catch { return {}; } })() };
const gzKeep = () => { try { localStorage.setItem(GZ_KEEP, JSON.stringify(gz)); } catch {} };
// what the games' page shows as a game's best (games.js gmBest)
const gzBest = (game) => gz[game] ? Math.max(0, ...Object.values(gz[game].best || {})) : undefined;
const gzMix = (a, rnd) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const gzChip = (on, attr, text) => `<button class="toggle ${on ? "on" : ""}" ${attr}>${text}</button>`;
const gzDone = () => toast("Today's Daily is done — a new one comes with the daily reset.");
// a new game: a daily one (and a duel) draws from its seed, on fixed settings (never Hard)
function gzNew(game, daily, of, more) {
  const duel = daily === true ? gmDuelTake(game) : null;
  return { daily: daily === true, duel, rnd: daily === true ? gmDaySeed(game, duel) : Math.random, hard: daily !== true && !!gz[game].hard,
    of, round: -1, score: 0, streak: 0, top: 0, log: [], ...more };
}
const gzTop = (g) => `<div class="gmtop"><span class="gmscore">ROUND <b>${g.round + 1} / ${g.of}</b></span><span class="grow"></span>
  <span class="gmscore">SCORE <b>${g.score}</b> &nbsp; STREAK <i>×${g.streak}</i></span><button class="toggle" id="gzquit">Quit</button></div>`;
function gzScore(g, ok, points, rec) {
  g.streak = ok ? g.streak + 1 : 0;
  g.top = Math.max(g.top, g.streak);
  g.score += points;
  g.done = { ok, points, ...rec };
  g.log.push({ ok, points, ...rec });
}
// the result's page: the score, the rounds as a table (head: the columns' names, row: a round's cells)
function gzResult(game, title, g, mode, head, row, again, back) {
  gmOver(game, g, g.score);
  const s = gz[game], record = !g.daily && g.score > (s.best[mode] || 0);
  if (!g.daily) s.best[mode] = Math.max(s.best[mode] || 0, g.score);
  gzKeep();
  $("#main").innerHTML = `<h1>${title}</h1>
    <div class="gmtop"><span class="gmbig">${g.score}</span><span class="gmscore">${g.log.filter((r) => r.ok).length} OF ${g.log.length} · BEST STREAK ×${g.top} · BEST <i>${s.best[mode] || 0}</i>${record ? " · NEW RECORD" : ""}</span>
      <span class="grow"></span>${g.daily ? `<span class="gmscore">${gmDayTag(g)}</span><button class="toggle" id="gzcopy">${gmCopyLabel(g)}</button>` : ""}<button class="toggle" id="gzback">Settings</button><button class="gmbtn" id="gzagain">Play again</button></div>
    <table class="gmlog"><tr><th>#</th>${head.map((h) => `<th>${h}</th>`).join("")}</tr>${g.log.map((r, i) => `<tr><td>${i + 1}</td>${row(r)}</tr>`).join("")}</table>`;
  $("#gzagain").onclick = again;
  $("#gzback").onclick = back;
  if ($("#gzcopy")) $("#gzcopy").onclick = () => gmCopyResult(game, g, () => gmShare(title, g.score, g.log));
}

// ------------------------------------------------------------------ Chain
// Two Identities; get from the first to the second, every Identity on the way sharing something with the one before
// it: the Sinner or a faction (Hard: a faction or the season). The pairs are the ones at least GN_FAR links apart, and
// the fewest links there are is the par. "Limbus Company" is not a faction here: every Sinner has one of those, so
// any two would be three links apart through them.
const GN_ROUNDS = 5, GN_WORTH = 2000, GN_STEP = 400, GN_SLACK = 4;
const GN_KINDS = { sinner: "SINNER", assoc: "FACTION", season: "SEASON" };
const gn = { game: null, ids: [] };
window.addEventListener("hashchange", () => { if (!location.hash.startsWith("#/gamechain")) gn.game = null; });
const gnTraits = (x, hard) => [...(hard ? [] : [["sinner", x.sub]]), ...x.assoc.filter((k) => !/^(Limbus Company|LC[A-Z]\??$)/.test(k)).map((k) => ["assoc", k]),
  ...(hard && x.season && x.season !== "—" ? [["season", x.season]] : [])];
// what two Identities share ([kind, name]), or nothing
function gnLink(a, b, hard) {
  const tb = gnTraits(b, hard);
  return gnTraits(a, hard).find(([k, n]) => tb.some(([k2, n2]) => k === k2 && n === n2)) || null;
}
// who is linked to whom, and the links' count from one Identity to every other (with the one it was reached from)
function gnWeb(hard) {
  const web = new Map(gn.ids.map((x) => [x.key, []]));
  gn.ids.forEach((a, i) => { for (let j = i + 1; j < gn.ids.length; j++) if (gnLink(a, gn.ids[j], hard)) { web.get(a.key).push(gn.ids[j].key); web.get(gn.ids[j].key).push(a.key); } });
  return web;
}
function gnFrom(web, key) {
  const far = new Map([[key, { d: 0, by: null }]]), line = [key];
  for (const v of line) for (const w of web.get(v)) if (!far.has(w)) { far.set(w, { d: far.get(v).d + 1, by: v }); line.push(w); }
  return far;
}

routes.gamechain = async (args = []) => {
  gn.game = null;
  const auto = gmAuto("chain", args);
  gmCrumb("chain");
  $("#main").innerHTML = `<h1>Chain</h1><div class="sub">Reading the game's files…</div>`;
  gn.ids = await gxIds();
  if (!location.hash.startsWith("#/gamechain")) return;
  gnDrawStart();
  if (auto && gn.ids.length >= 20) gnNew(true);
};

function gnDrawStart() {
  const s = gz.chain;
  $("#main").innerHTML = `<h1>Chain</h1>
    <div class="sub">Two Identities. Get from the first to the second by naming Identities in between — each must share something with the one before it. The fewer links, the more points.</div>
    ${gn.ids.length < 20 ? `<p class="muted">Nothing to ask yet: the game's files or a snapshot are missing.</p>` : `
    <div class="dbrow">${gzChip(!s.hard, 'data-h=""', "Sinner or faction")}${gzChip(s.hard, 'data-h="1"', "Hard · faction or season")}</div>
    <div class="gmstart"><span class="gmscore">${gn.ids.length} IDENTITIES · BEST <i>${s.best[s.hard ? "h" : "e"] || 0}</i></span>
      ${gmDailyBtn("chain")}<button class="gmbtn" id="gngo">Start · ${GN_ROUNDS} rounds</button></div>
    <div class="muted small">A chain in the fewest links there are is worth ${GN_WORTH}, every link over that ${GN_STEP} less; a name that doesn't link counts as a link too. Limbus Company is not a faction here — everybody has been there. Hard: points are doubled.</div>`}`;
  document.querySelectorAll("#main [data-h]").forEach((b) => b.onclick = () => { s.hard = !!b.dataset.h; gzKeep(); gnDrawStart(); });
  if ($("#gngo")) $("#gngo").onclick = () => gnNew();
  if ($("#gmdaily")) $("#gmdaily").onclick = () => gmDailyDone("chain") == null ? gnNew(true) : gzDone();
}

function gnNew(daily) {
  const g = gn.game = gzNew("chain", daily, GN_ROUNDS, { asked: new Set() });
  g.web = gnWeb(g.hard);
  gnRound();
}

function gnRound() {
  const g = gn.game, want = g.hard ? [5, 4, 3, 2] : [3, 2];
  if (++g.round >= g.of) return gnResult();
  let a = null, b = null, par = 0;
  for (let n = 0; n < 400 && !b; n++) {  // a pair as far apart as the mode asks for (nearer ones as the tries run out)
    const x = gn.ids[Math.floor(g.rnd() * gn.ids.length)], far = gnFrom(g.web, x.key), d = want[Math.min(want.length - 1, Math.floor(n / 100))];
    const ends = gn.ids.filter((y) => (far.get(y.key) || {}).d === d && !g.asked.has(y.key));
    if (g.asked.has(x.key) || !ends.length) continue;
    [a, b, par] = [x, ends[Math.floor(g.rnd() * ends.length)], d];
  }
  if (!b) { gn.game = null; gnDrawStart(); return toast("Could not make a chain from the game's files."); }
  g.asked.add(a.key).add(b.key);
  Object.assign(g, { a, b, par, chain: [a], links: [], used: 0, done: null, way: null });
  gnDraw();
}

const gnWorth = (g, used) => Math.max(GN_STEP, GN_WORTH - GN_STEP * Math.max(0, used - g.par)) * (g.hard ? 2 : 1);

function gnDraw() {
  const g = gn.game, d = g.done, last = g.chain[g.chain.length - 1];
  const chips = (x) => gnTraits(x, g.hard).map(([k, n]) => `<em class="${k}">${esc(n)}</em>`).join("");
  const tile = (x, cls = "") => `<div class="gntile ${cls}"><img src="${x.pic}" onerror="this.remove()"><b>${esc(x.title)}</b><i>${esc(x.sub)}</i><span>${chips(x)}</span></div>`;
  const link = (l) => `<div class="gnlink"><small>${GN_KINDS[l[0]]}</small><b>${esc(l[1])}</b></div>`;
  const row = (list, links, end) => list.map((x, i) => (i ? link(links[i - 1]) : "") + tile(x, i === 0 ? "from" : x === g.b ? "to" : "")).join("")
    + (end ? `<div class="gnlink open"><small>LINK ${g.used + 1} OF ${g.par + GN_SLACK}</small><b>?</b></div>${tile(g.b, "to")}` : "");
  const byKey = (k) => gn.ids.find((x) => x.key === k);
  $("#main").innerHTML = `<h1>Chain</h1>${gzTop(g)}
    <div class="gnbox"><div class="gmkick">${d ? (d.ok ? `+${d.points} · ${g.used} LINK${g.used > 1 ? "S" : ""}, THE FEWEST IS ${g.par}` : "MISSED") : `THE FEWEST IS ${g.par} LINKS · WORTH ${gnWorth(g, Math.max(g.par, g.used + 1))} NOW`}</div>
      <div class="gmq">${d ? (d.ok ? "Linked" : "Not this time") : `From ${esc(g.a.title)} to ${esc(g.b.title)}`}</div>
      <div class="gnrow">${row(g.chain, g.links, !d)}</div>
      ${d && g.way ? `<div class="gmkick gnway">${d.ok ? "A SHORTER WAY" : "A WAY THERE"}</div><div class="gnrow small">${row(g.way.map(byKey), g.way.slice(1).map((k, i) => gnLink(byKey(g.way[i]), byKey(k), g.hard)), false)}</div>` : ""}
      ${d ? `<div class="gmafter"><span>${g.hard ? "A faction or the season" : "The Sinner or a faction"} links two Identities.</span><button class="gmbtn" id="gnnext">${g.round + 1 < g.of ? "Next" : "Result"}</button></div>`
      : `<div class="gwtype"><div class="gmkick">WHO COMES AFTER ${esc(last.title.toUpperCase())}?</div><input id="gnin" class="dbq" placeholder="Identity or Sinner…" autocomplete="off"><div id="gnsugg" class="gmsugg"></div></div>
        <div class="gnbtns"><button class="toggle" id="gnundo" ${g.chain.length > 1 ? "" : "disabled"}>Step back</button><button class="toggle" id="gnskip">I don't know</button></div>`}</div>`;
  $("#gzquit").onclick = () => { gn.game = null; gnDrawStart(); };
  if ($("#gnin")) gxType($("#gnin"), $("#gnsugg"), () => gn.ids.filter((x) => !g.chain.includes(x)), gnTry);
  if ($("#gnundo")) $("#gnundo").onclick = () => { g.chain.pop(); g.links.pop(); gnDraw(); };
  if ($("#gnskip")) $("#gnskip").onclick = () => gnEnd(false);
  if ($("#gnnext")) { $("#gnnext").onclick = gnRound; $("#gnnext").focus(); }
}

function gnTry(key) {
  const g = gn.game, x = gn.ids.find((i) => i.key === key), last = g.chain[g.chain.length - 1];
  if (!x || g.done || g.chain.includes(x)) return;
  const link = gnLink(last, x, g.hard);
  g.used++;
  if (!link) toast(`${esc(x.title)} has nothing in common with ${esc(last.title)}.`);
  else {
    g.chain.push(x);
    g.links.push(link);
    const end = x === g.b ? null : gnLink(x, g.b, g.hard);
    if (end) { g.used++; g.chain.push(g.b); g.links.push(end); }  // (the last link is made by itself)
    if (x === g.b || end) return gnEnd(true);
  }
  g.used + 1 > g.par + GN_SLACK ? gnEnd(false) : gnDraw();
}

function gnEnd(ok) {
  const g = gn.game;
  if (!ok || g.used > g.par) {  // the fewest links, to look at
    const far = gnFrom(g.web, g.a.key);
    g.way = [];
    for (let k = g.b.key; k; k = far.get(k).by) g.way.unshift(k);
  }
  gzScore(g, ok, ok ? gnWorth(g, g.used) : 0, { a: g.a, b: g.b, par: g.par, used: g.used, clean: ok && g.used === g.par });
  gnDraw();
}

function gnResult() {
  const g = gn.game, pic = (x) => `<img class="gologpic odd" src="${x.pic}" title="${esc(x.name)}">`;
  gzResult("chain", "Chain", g, g.hard ? "h" : "e", ["FROM", "TO", "LINKS", "THE FEWEST", "POINTS"],
    (r) => `<td>${pic(r.a)}${esc(r.a.title)}<i>${esc(r.a.sub)}</i></td><td>${pic(r.b)}${esc(r.b.title)}<i>${esc(r.b.sub)}</i></td><td class="${r.ok ? (r.clean ? "ok" : "") : "bad"}">${r.ok ? r.used : "—"}</td><td>${r.par}</td><td>${r.points}</td>`,
    () => gnNew(), () => { gn.game = null; gnDrawStart(); });
}

// ------------------------------------------------------------------ Guess the buff
// A buff's or a debuff's own effect plays (the videos Database → Buff effects has made): name the buff.
const GB_ROUNDS = 10, GB_WORTH = 1000, GB_HINT = 250, GB_TYPE = { pos: "Buff", neg: "Debuff", neu: "Neutral" };
const gb = { game: null, pool: null };
window.addEventListener("hashchange", () => { if (!location.hash.startsWith("#/gamebuff")) gb.game = null; });

routes.gamebuff = async (args = []) => {
  gb.game = null;
  const auto = gmAuto("buff", args);
  gmCrumb("buff");
  $("#main").innerHTML = `<h1>Guess the buff</h1><div class="sub">Reading the game's files…</div>`;
  if (!gb.pool) {
    const r = await api("/api/buffs").catch(() => null), have = new Set((r || {}).have || []), by = new Map();
    // one answer per name: a few buffs of one name have an effect each
    for (const b of (r || {}).list || []) {
      const fx = b.fx.filter((n) => have.has(n.replace(/[^\w.-]/g, "_")));
      const name = (b.name || "").replace(/<[^>]+>/g, "").trim();  // (the game's own marks: "[<s>Great Brother</s>]")
      if (!name || !fx.length) continue;
      const x = by.get(name) || { key: name, name, title: name, sub: GB_TYPE[b.type] || "", type: b.type, id: b.id, icon: b.icon, desc: b.desc || "", fx: [], who: [] };
      x.fx.push(...fx);
      for (const w of b.who) if (!x.who.includes(w.name) && !/^\?+$/.test(w.name)) x.who.push(w.name);
      by.set(name, x);
    }
    gb.pool = [...by.values()];
    if (!r) setTimeout(() => { gb.pool = null; });  // (not read: asked again the next time)
  }
  if (!location.hash.startsWith("#/gamebuff")) return;
  gbDrawStart();
  if (auto && gb.pool.length >= 8) gbNew(true);
};

function gbDrawStart() {
  const s = gz.buff, pool = gb.pool || [];
  $("#main").innerHTML = `<h1>Guess the buff</h1>
    <div class="sub">The effect of a buff or a debuff plays, the way it looks on the one who has it — name it.</div>
    ${pool.length < 8 ? `<p class="muted">Nothing to ask yet: the effects' videos aren't made. Open <a href="#/buffs">Database → Buff effects</a> and make them all once.</p>` : `
    <div class="dbrow">${gzChip(!s.hard, 'data-h=""', "Easy · 4 answers")}${gzChip(s.hard, 'data-h="1"', "Hard · type the name")}</div>
    <div class="gmstart"><span class="gmscore">${pool.length} EFFECTS · BEST <i>${s.best[s.hard ? "h" : "e"] || 0}</i></span>
      ${gmDailyBtn("buff")}<button class="gmbtn" id="gbgo">Start · ${GB_ROUNDS} rounds</button></div>
    <div class="muted small">Easy: four answers. Hard: type the name, points are doubled. A hint — what kind it is, who has it — costs points.</div>`}`;
  document.querySelectorAll("#main [data-h]").forEach((b) => b.onclick = () => { s.hard = !!b.dataset.h; gzKeep(); gbDrawStart(); });
  if ($("#gbgo")) $("#gbgo").onclick = () => gbNew();
  if ($("#gmdaily")) $("#gmdaily").onclick = () => gmDailyDone("buff") == null ? gbNew(true) : gzDone();
}

function gbNew(daily) {
  gb.game = gzNew("buff", daily, GB_ROUNDS, { pool: gb.pool.slice(), asked: new Set() });
  gbRound();
}

function gbRound() {
  const g = gb.game;
  if (++g.round >= g.of) return gbResult();
  let ans;
  for (let k = 0; k < 40 && (!ans || g.asked.has(ans.key)); k++) ans = g.pool[Math.floor(g.rnd() * g.pool.length)];
  g.asked.add(ans.key);
  // wrong answers: others of its kind (a buff among buffs)
  const same = gzMix(g.pool.filter((x) => x !== ans && x.type === ans.type), g.rnd), rest = gzMix(g.pool.filter((x) => x !== ans && x.type !== ans.type), g.rnd);
  Object.assign(g, { ans, fx: ans.fx[Math.floor(g.rnd() * ans.fx.length)], opts: gzMix([ans, ...same.concat(rest).slice(0, 3)], g.rnd), hints: {}, done: null });
  gbDraw();
}

const gbWorth = (g) => Math.max(100, GB_WORTH - GB_HINT * Object.keys(g.hints).length) * (g.hard ? 2 : 1);

function gbDraw() {
  const g = gb.game, a = g.ans, d = g.done, used = Object.keys(g.hints).length;
  const hints = [["type", "KIND", GB_TYPE[a.type] || "—"], a.who.length ? ["who", "WHO", a.who.slice(0, 2).join(", ")] : 0].filter(Boolean);
  const hint = ([k, label, val]) => g.hints[k] || d ? `<div class="gihint open"><small>${label}</small><b>${esc(val)}</b></div>`
    : `<button class="gihint" data-hint="${k}"><small>${label}</small><b>hidden</b><u>open · −${GB_HINT * (g.hard ? 2 : 1)}</u></button>`;
  const cls = (key) => d ? (key === a.key ? "ok" : key === d.pick ? "bad" : "dim") : "";
  $("#main").innerHTML = `<h1>Guess the buff</h1>${gzTop(g)}
    <div class="gmstage gistage gpstage wide"><div>
      <div class="gbvid"><video src="/api/buff_video?name=${encodeURIComponent(g.fx)}" autoplay loop muted playsinline></video></div>
      <div class="gihints">${hints.map(hint).join("")}</div></div>
    <div><div class="gmkick">${d ? (d.ok ? `+${d.points}${used ? ` · ${used} HINT${used > 1 ? "S" : ""} USED` : ""}` : "MISSED") : `WORTH ${gbWorth(g)} NOW`}</div>
      <div class="gmq">${d ? esc(a.name) : "Which buff is this?"}</div>
      ${g.hard && !d ? `<input id="gbtype" class="dbq" placeholder="Buff or debuff…" autocomplete="off"><div id="gbsugg" class="gmsugg"></div><button class="toggle gmmore" id="gbskip">I don't know</button>`
      : g.hard ? `<div class="gmopts"><div class="gmopt ${d.ok ? "ok" : "bad"}"><b>${esc(d.said || "—")}</b><i>your answer</i></div></div>`
      : `<div class="gmopts">${g.opts.map((o) => `<button class="gmopt ${cls(o.key)}" data-k="${esc(o.key)}" ${d ? "disabled" : ""}><b>${esc(o.title)}</b><i>${d ? esc(o.sub) : ""}</i></button>`).join("")}</div>`}
      ${d ? `<div class="gbdesc">${a.icon ? `<img src="${giThumb(a.icon)}" onerror="this.remove()">` : ""}<span>${fmtDesc(a.desc.split("\n").slice(0, 4).join("\n"))}</span></div>
        <div class="gmafter"><a href="#/buffs/${encodeURIComponent(a.id)}">Open in Buff effects →</a><button class="gmbtn" id="gbnext">${g.round + 1 < g.of ? "Next" : "Result"}</button></div>` : ""}</div></div>`;
  // an effect whose video can't be played: another one takes the round
  $("#main video").onerror = () => {
    if (gb.game !== g || g.ans !== a || d) return;
    g.pool = g.pool.filter((x) => x !== a);
    g.round--;
    g.pool.length < 8 ? (gb.game = null, gbDrawStart(), toast("The effects' videos could not be read.")) : gbRound();
  };
  $("#gzquit").onclick = () => { gb.game = null; gbDrawStart(); };
  document.querySelectorAll("#main [data-hint]").forEach((b) => b.onclick = () => { g.hints[b.dataset.hint] = 1; gbDraw(); });
  document.querySelectorAll("#main .gmopts button").forEach((b) => b.onclick = () => gbAnswer(b.dataset.k));
  if ($("#gbnext")) { $("#gbnext").onclick = gbRound; $("#gbnext").focus(); }
  if ($("#gbskip")) $("#gbskip").onclick = () => gbAnswer(null);
  if ($("#gbtype")) gxType($("#gbtype"), $("#gbsugg"), () => gb.pool, gbAnswer);
}

function gbAnswer(key) {
  const g = gb.game, ok = key === g.ans.key;
  if (g.done) return;
  gzScore(g, ok, ok ? gbWorth(g) : 0, { ans: g.ans, pick: key, said: key || "—", hints: Object.keys(g.hints).length, clean: !Object.keys(g.hints).length });
  gbDraw();
}

function gbResult() {
  const g = gb.game;
  gzResult("buff", "Guess the buff", g, g.hard ? "h" : "e", ["BUFF", "YOUR ANSWER", "HINTS", "POINTS"],
    (r) => `<td>${esc(r.ans.name)}<i>${esc(r.ans.sub)}</i></td><td class="${r.ok ? "ok" : "bad"}">${esc(r.said)}</td><td>${r.hints || ""}</td><td>${r.points}</td>`,
    () => gbNew(), () => { gb.game = null; gbDrawStart(); });
}

// ------------------------------------------------------------------ Mixed up
// Twelve seconds of a track cut into four parts (Hard: six) and shuffled — put them back in order. Every part can be
// listened to, and so can the whole row as it stands; a check tells which parts are in place.
const GY_ROUNDS = 10, GY_WORTH = [1000, 700, 400, 200], GY_LEN = 12;
const gy = { game: null, src: [], marks: [] };
const gyOn = () => location.hash.startsWith("#/gamemix");
window.addEventListener("hashchange", () => { if (!gyOn() && gy.game) gyLeave(); });
function gyQuiet() {
  for (const s of gy.src) { try { s.stop(); } catch {} }
  gy.marks.forEach(clearTimeout);
  gy.src = [];
  gy.marks = [];
  document.querySelectorAll(".gycard.play").forEach((c) => c.classList.remove("play"));
}
function gyLeave() {
  gyQuiet();
  gy.game = null;
  gmWarmDrop();
  document.body.classList.remove("quiz");
}

routes.gamemix = async (args = []) => {
  gyLeave();
  const auto = gmAuto("mix", args);
  gmCrumb("mix");
  if (!mu.tracks.length) mu.tracks = await api("/api/music").catch(() => []);
  if (!gyOn()) return;
  gyDrawStart();
  if (auto && $("#gmdaily") && !$("#gmdaily").disabled) gyNew(true);
};

const gyPool = (battle) => mu.tracks.map((t, n) => ({ t, n })).filter(({ t }) => t.ms > 40000 && (!battle || t.battle));

function gyDrawStart() {
  const s = gz.mix, n = gyPool(s.battle).length;
  $("#main").innerHTML = `<h1>Mixed up</h1>
    <div class="sub">A piece of a track is cut into parts and shuffled. Listen to the parts and put them back in order.</div>
    ${!mu.tracks.length ? `<p class="muted">The soundtrack isn't read yet: the game's sound files or a snapshot are missing.</p>` : `
    <div class="dbrow">${gzChip(s.battle, 'data-b="1"', "Battle themes")}${gzChip(!s.battle, 'data-b=""', "All tracks")}<span class="gap"></span>
      ${gzChip(!s.hard, 'data-h=""', "Four parts")}${gzChip(s.hard, 'data-h="1"', "Hard · six parts")}</div>
    <div class="gmstart"><span class="gmscore">${n} TRACKS · BEST <i>${s.best[(s.battle ? "b" : "a") + (s.hard ? "h" : "e")] || 0}</i></span>
      ${gmDailyBtn("mix", gyPool(true).length < 12)}<button class="gmbtn" id="gygo" ${n < 12 ? "disabled" : ""}>Start · ${GY_ROUNDS} rounds</button></div>
    <div class="muted small">Right at the first check: ${GY_WORTH[0]}, then ${GY_WORTH.slice(1).join(", ")} — a check shows which parts are in place. Drag a part onto another to swap them, or click one and then the other. Hard: points are doubled.</div>`}`;
  const set = (sel, key, f) => document.querySelectorAll("#main " + sel).forEach((b) => b.onclick = () => { s[key] = f(b); gzKeep(); gyDrawStart(); });
  set("[data-b]", "battle", (b) => !!b.dataset.b);
  set("[data-h]", "hard", (b) => !!b.dataset.h);
  if ($("#gygo")) $("#gygo").onclick = () => gyNew();
  if ($("#gmdaily")) $("#gmdaily").onclick = () => gmDailyDone("mix") == null ? gyNew(true) : gzDone();
}

function gyNew(daily) {
  gyLeave();
  const g = gy.game = gzNew("mix", daily, GY_ROUNDS, {});
  g.battle = g.daily || !!gz.mix.battle;
  // the tracks of all rounds are drawn here, so the next one's file is fetched while this one is played
  g.list = gzMix(gyPool(g.battle), g.rnd).slice(0, GY_ROUNDS + 4);
  if (typeof muAudio !== "undefined") muAudio.pause();
  gyRound();
}

async function gyRound() {
  const g = gy.game;
  gyQuiet();
  document.body.classList.add("quiz");  // the corner player would play over it
  if (++g.round >= g.of) return gyResult();
  const ans = g.list[g.round], n = g.hard ? 6 : 4, len = GY_LEN / n, start = 5 + g.rnd() * Math.max(1, ans.t.ms / 1000 - 30);
  let order = gzMix([...Array(n).keys()], g.rnd);
  while (order.some((p, i) => p === i)) order = gzMix(order, g.rnd);  // no part starts in its place
  Object.assign(g, { ans, n, len, start, order, tries: 0, lock: new Set(), sel: null, done: null, parts: null });
  gyDraw();
  const ahead = g.list.slice(g.round, g.round + 2).map((x) => x.n);
  gmWarmDrop(ahead);
  ahead.reduce((p, k) => p.then(() => gmFetch(k)), Promise.resolve());
  let buf = null;
  try {
    gmCtx = gmCtx || new (window.AudioContext || window.webkitAudioContext)();
    const url = await gmFetch(ans.n) || "/api/music_audio?n=" + ans.n;
    buf = await gmCtx.decodeAudioData(await (await fetch(url)).arrayBuffer());
  } catch {}
  if (gy.game !== g || g.ans !== ans) return;
  if (!buf || buf.duration < start + GY_LEN) {  // unreadable: another track takes the round
    toast("This track could not be read from the game's files.");
    if ((g.fails = (g.fails || 0) + 1) > 3 || g.list.length <= g.of) { gyLeave(); return gyDrawStart(); }
    g.list.splice(g.round--, 1);
    return gyRound();
  }
  const sr = buf.sampleRate, size = Math.floor(len * sr);
  g.parts = [...Array(n).keys()].map((i) => {
    const part = gmCtx.createBuffer(buf.numberOfChannels, size, sr), from = Math.floor(start * sr) + i * size;
    for (let c = 0; c < buf.numberOfChannels; c++) part.copyToChannel(buf.getChannelData(c).subarray(from, from + size), c);
    const d = part.getChannelData(0), bars = 64, step = Math.floor(size / bars);
    return { buf: part, peaks: [...Array(bars).keys()].map((b) => { let m = 0; for (let k = b * step; k < (b + 1) * step; k += 16) m = Math.max(m, Math.abs(d[k])); return m; }) };
  });
  gyDraw();
}

// plays these parts one after another, lighting each one's card while it sounds
function gyPlay(parts) {
  const g = gy.game;
  if (!g || !g.parts) return;
  gyQuiet();
  gmCtx.resume();
  const gain = gmCtx.createGain(), t0 = gmCtx.currentTime + 0.05;
  gain.gain.value = gmVol();
  gain.connect(gmCtx.destination);
  gy.gain = gain;
  gy.src = parts.map((p, i) => { const s = gmCtx.createBufferSource(); s.buffer = g.parts[p].buf; s.connect(gain); s.start(t0 + i * g.len); return s; });
  const mark = (p) => document.querySelectorAll(".gycard").forEach((c) => c.classList.toggle("play", +c.dataset.p === p));
  gy.marks = [...parts.map((p, i) => setTimeout(() => mark(p), 50 + i * g.len * 1000)), setTimeout(() => mark(-1), 50 + parts.length * g.len * 1000)];
}

const gyWorth = (g) => GY_WORTH[g.tries] * (g.hard ? 2 : 1);

function gyDraw() {
  const g = gy.game, d = g.done, t = g.ans.t, row = d ? [...Array(g.n).keys()] : g.order;
  const card = (p, i) => `<div class="gycard ${d || g.lock.has(i) ? "ok" : ""} ${g.sel === i ? "on" : ""}" data-p="${p}" data-i="${i}" ${d || g.lock.has(i) ? "" : 'draggable="true"'}>
    <small>${i + 1}</small><canvas width="150" height="70"></canvas><button class="toggle" data-play="${p}">▶</button></div>`;
  $("#main").innerHTML = `<h1>Mixed up</h1>${gzTop(g)}
    <div class="gybox"><div class="gmkick">${d ? (d.ok ? `+${d.points} · AT CHECK ${g.tries + 1}` : "MISSED") : `CHECK ${g.tries + 1} OF ${GY_WORTH.length} · WORTH ${gyWorth(g)} NOW`}</div>
      <div class="gmq">${d ? esc(t.name) : "Put the parts in order"}</div>
      ${!g.parts ? `<p class="muted">Cutting the track…</p>` : `<div class="gyrow n${g.n}">${row.map(card).join("")}</div>
      <div class="gybtns"><button class="toggle" id="gyall">▶ Play the row</button><button class="toggle" id="gystop">■ Stop</button>
        <label class="gmvol">Volume <input id="gyvol" type="range" min="0" max="1" step="0.01" value="${gmVol()}"></label><span class="grow"></span>
        ${d ? "" : `<button class="toggle" id="gyskip">I don't know</button><button class="gmbtn" id="gycheck">Check</button>`}</div>`}
      ${d ? `<div class="gmafter"><span>${esc([t.where, t.by].filter(Boolean).join(" · "))}</span><button class="gmbtn" id="gynext">${g.round + 1 < g.of ? "Next" : "Result"}</button></div>` : ""}</div>`;
  $("#gzquit").onclick = () => { gyLeave(); gyDrawStart(); };
  if ($("#gynext")) { $("#gynext").onclick = gyRound; $("#gynext").focus(); }
  if (!g.parts) return;
  document.querySelectorAll(".gycard").forEach((c) => {  // the part's sound as a picture
    const cv = $("canvas", c), x = cv.getContext("2d"), peaks = g.parts[+c.dataset.p].peaks, top = Math.max(0.05, ...peaks), w = cv.width / peaks.length;
    x.fillStyle = c.classList.contains("ok") ? "#d9b53a" : "#8d8388";
    peaks.forEach((v, i) => { const h = Math.max(2, v / top * (cv.height - 6)); x.fillRect(i * w, (cv.height - h) / 2, Math.max(1, w - 1), h); });
  });
  const swap = (i, j) => {
    if (d || i === j || g.lock.has(i) || g.lock.has(j)) return;
    [g.order[i], g.order[j]] = [g.order[j], g.order[i]];
    g.sel = null;
    gyQuiet();
    gyDraw();
  };
  document.querySelectorAll(".gycard").forEach((c) => {
    const i = +c.dataset.i;
    c.onclick = (e) => { if (d || g.lock.has(i) || e.target.closest("button")) return; if (g.sel == null) { g.sel = i; c.classList.add("on"); } else if (g.sel === i) { g.sel = null; c.classList.remove("on"); } else swap(g.sel, i); };
    c.ondragstart = (e) => { gy.drag = i; e.dataTransfer.effectAllowed = "move"; };
    c.ondragover = (e) => { e.preventDefault(); };
    c.ondrop = (e) => { e.preventDefault(); if (gy.drag != null) swap(gy.drag, i); gy.drag = null; };
  });
  document.querySelectorAll(".gycard [data-play]").forEach((b) => b.onclick = () => gyPlay([+b.dataset.play]));
  $("#gyall").onclick = () => gyPlay(row);
  $("#gystop").onclick = gyQuiet;
  $("#gyvol").oninput = (e) => { gm.vol = +e.target.value; if (gy.gain) gy.gain.gain.value = gm.vol; };
  $("#gyvol").onchange = gmKeep;
  if ($("#gycheck")) $("#gycheck").onclick = gyCheck;
  if ($("#gyskip")) $("#gyskip").onclick = () => gyEnd(false);
}

function gyCheck() {
  const g = gy.game, right = g.order.filter((p, i) => p === i).length;
  if (right === g.n) return gyEnd(true);
  g.order.forEach((p, i) => { if (p === i) g.lock.add(i); });
  if (++g.tries >= GY_WORTH.length) { g.tries--; return gyEnd(false); }
  toast(`${right} of ${g.n} in place.`);
  gyDraw();
}

function gyEnd(ok) {
  const g = gy.game;
  gzScore(g, ok, ok ? gyWorth(g) : 0, { ans: g.ans, tries: g.tries + 1, clean: ok && !g.tries });
  gyDraw();
  gyPlay([...Array(g.n).keys()]);  // the piece as it is
}

function gyResult() {
  const g = gy.game;
  gyQuiet();
  gmWarmDrop();
  document.body.classList.remove("quiz");
  gzResult("mix", "Mixed up", g, (g.battle ? "b" : "a") + (g.hard ? "h" : "e"), ["TRACK", "CHECKS", "POINTS", ""],
    (r) => `<td>${esc(r.ans.t.name)}<i>${esc(typeof muSub === "function" ? muSub(r.ans.t) : r.ans.t.where)}</i></td><td class="${r.ok ? "ok" : "bad"}">${r.ok ? r.tries : "—"}</td><td>${r.points}</td><td><button class="toggle" data-play="${r.ans.n}">▶ play</button></td>`,
    () => gyNew(), () => { gy.game = null; gyDrawStart(); });
  document.querySelectorAll("#main [data-play]").forEach((b) => b.onclick = () => { if (typeof muPlay === "function") { mu.min = false; muPlay(+b.dataset.play); } });
}

// ------------------------------------------------------------------ Jigsaw
// An Identity's art cut into tiles and shuffled: swap them until the picture is whole. The clock decides the points.
const GJ_ROUNDS = 5, GJ_WORTH = 2000, GJ_LOW = 400, GJ_TILE = 2;  // (GJ_TILE: seconds a tile before the points start to go)
const gj = { game: null, arts: null, timer: 0 };
window.addEventListener("hashchange", () => { if (!location.hash.startsWith("#/gamejig") && gj.game) gjLeave(); });
function gjLeave() {
  clearInterval(gj.timer);
  gj.game = null;
}

routes.gamejig = async (args = []) => {
  gjLeave();
  const auto = gmAuto("jig", args);
  gmCrumb("jig");
  $("#main").innerHTML = `<h1>Jigsaw</h1><div class="sub">Reading the game's files…</div>`;
  if (!gj.arts) {
    const u = await api("/api/units").catch(() => null);
    gj.arts = ((u || {}).ids || []).filter((x) => x.img && x.img.art && x.img.thumb).map((x) => ({ key: "i" + x.id, id: x.id, name: x.title + " " + x.sinnerName, title: x.title,
      sub: x.sinnerName, thumb: giThumb(x.img.thumb), pic: `/api/asset_img?path=${encodeURIComponent(x.img.art)}` }));
    if (!u) setTimeout(() => { gj.arts = null; });
  }
  if (!location.hash.startsWith("#/gamejig")) return;
  gjDrawStart();
  if (auto && gj.arts.length >= 8) gjNew(true);
};

function gjDrawStart() {
  const s = gz.jig, arts = gj.arts || [];
  $("#main").innerHTML = `<h1>Jigsaw</h1>
    <div class="sub">An Identity's art is cut into tiles and shuffled. Swap the tiles until the picture is whole — the faster, the more points.</div>
    ${arts.length < 8 ? `<p class="muted">Nothing to ask yet: the game's files or a snapshot are missing.</p>` : `
    <div class="dbrow">${gzChip(!s.hard, 'data-h=""', "12 tiles")}${gzChip(s.hard, 'data-h="1"', "Hard · 24 tiles")}</div>
    <div class="gmstart"><span class="gmscore">${arts.length} PICTURES · BEST <i>${s.best[s.hard ? "h" : "e"] || 0}</i></span>
      ${gmDailyBtn("jig")}<button class="gmbtn" id="gjgo">Start · ${GJ_ROUNDS} rounds</button></div>
    <div class="muted small">Drag a tile onto another to swap them, or click one and then the other. A picture is worth ${GJ_WORTH} for ${GJ_TILE} seconds a tile, then less with every second, down to ${GJ_LOW}. Hard: points are doubled.</div>`}`;
  document.querySelectorAll("#main [data-h]").forEach((b) => b.onclick = () => { s.hard = !!b.dataset.h; gzKeep(); gjDrawStart(); });
  if ($("#gjgo")) $("#gjgo").onclick = () => gjNew();
  if ($("#gmdaily")) $("#gmdaily").onclick = () => gmDailyDone("jig") == null ? gjNew(true) : gzDone();
}

function gjNew(daily) {
  gjLeave();
  const g = gj.game = gzNew("jig", daily, GJ_ROUNDS, {});
  g.list = gzMix(gj.arts, g.rnd).slice(0, GJ_ROUNDS + 4);
  gj.timer = setInterval(gjClock, 250);
  gjRound();
}

function gjRound() {
  const g = gj.game;
  if (++g.round >= g.of) return gjResult();
  const ans = g.list[g.round], cols = g.hard ? 6 : 4, rows = g.hard ? 4 : 3, n = cols * rows;
  let at = gzMix([...Array(n).keys()], g.rnd);
  while (at.filter((p, i) => p === i).length > 1) at = gzMix(at, g.rnd);
  Object.assign(g, { ans, cols, rows, at, par: n * GJ_TILE, sel: null, moves: 0, t0: 0, sec: 0, done: null, w: 0, h: 0 });
  const im = new Image();
  im.onload = () => {
    if (gj.game !== g || g.ans !== ans) return;
    const ratio = im.height / im.width;
    g.w = Math.min(760, Math.round(500 / ratio));
    g.h = Math.round(g.w * ratio);
    g.t0 = performance.now();
    gjDraw();
  };
  im.onerror = () => {  // a picture the game's files don't give: another one takes the round
    if (gj.game !== g || g.ans !== ans) return;
    if ((g.fails = (g.fails || 0) + 1) > 3 || g.list.length <= g.of) { gjLeave(); gjDrawStart(); return toast("The pictures could not be read from the game's files."); }
    g.list.splice(g.round--, 1);
    gjRound();
  };
  im.src = ans.pic;
  gjDraw();
}

const gjSec = (g) => g.done ? g.sec : g.t0 ? (performance.now() - g.t0) / 1000 : 0;
// what the picture is worth after this many seconds
const gjWorth = (g, sec) => Math.round(Math.max(GJ_LOW, Math.min(GJ_WORTH, GJ_WORTH - (sec - g.par) * (GJ_WORTH - GJ_LOW) / (g.par * 3))) / 10) * 10 * (g.hard ? 2 : 1);
function gjClock() {
  const g = gj.game, el = $("#gjtime");
  if (!g || g.done || !el || !g.t0) return;
  const sec = gjSec(g);
  el.innerHTML = `TIME <b>${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}</b> · WORTH ${gjWorth(g, sec)} NOW`;
}

function gjDraw() {
  const g = gj.game, d = g.done, a = g.ans;
  $("#main").innerHTML = `<h1>Jigsaw</h1>${gzTop(g)}
    <div class="gjbox"><div class="gmkick" id="gjtime">${d ? (d.ok ? `+${d.points} · ${Math.round(g.sec)} S · ${g.moves} SWAPS` : "MISSED") : "TIME 0:00"}</div>
      <div class="gmq">${d ? esc(a.title) : "Put the picture together"}</div>
      ${!g.w ? `<p class="muted">Reading the picture…</p>` : `<div class="gjboard ${d && d.ok ? "whole" : ""}" id="gjboard" style="width:${g.w}px;height:${g.h}px;grid-template-columns:repeat(${g.cols},1fr)"></div>`}
      ${d ? `<div class="gmafter"><span>${esc(a.sub)} · <a href="#/db/${a.id}">Open in the database →</a></span><button class="gmbtn" id="gjnext">${g.round + 1 < g.of ? "Next" : "Result"}</button></div>`
      : `<div class="gnbtns"><button class="toggle" id="gjskip">I give up</button></div>`}</div>`;
  $("#gzquit").onclick = () => { gjLeave(); gjDrawStart(); };
  if ($("#gjskip")) $("#gjskip").onclick = () => gjEnd(false);
  if ($("#gjnext")) { $("#gjnext").onclick = gjRound; $("#gjnext").focus(); }
  gjBoard();
  gjClock();
}

// the tiles as they lie (after a missed round: as they should)
function gjBoard() {
  const g = gj.game, el = $("#gjboard"), d = g.done;
  if (!el) return;
  const tile = (p, i) => `<div class="gjtile ${g.sel === i ? "on" : ""}" data-i="${i}" ${d ? "" : 'draggable="true"'} style="background-image:url('${g.ans.pic}');background-size:${g.cols * 100}% ${g.rows * 100}%;background-position:${(p % g.cols) / (g.cols - 1) * 100}% ${Math.floor(p / g.cols) / (g.rows - 1) * 100}%"></div>`;
  el.innerHTML = (d ? g.at.map((_, i) => i) : g.at).map(tile).join("");
  if (d) return;
  const swap = (i, j) => {
    g.sel = null;
    if (i !== j) { [g.at[i], g.at[j]] = [g.at[j], g.at[i]]; g.moves++; }
    g.at.every((p, k) => p === k) ? gjEnd(true) : gjBoard();
  };
  el.querySelectorAll(".gjtile").forEach((c) => {
    const i = +c.dataset.i;
    c.onclick = () => { if (g.sel == null) { g.sel = i; c.classList.add("on"); } else swap(g.sel, i); };
    c.ondragstart = (e) => { gj.drag = i; e.dataTransfer.effectAllowed = "move"; };
    c.ondragover = (e) => { e.preventDefault(); };
    c.ondrop = (e) => { e.preventDefault(); if (gj.drag != null) swap(gj.drag, i); gj.drag = null; };
  });
}

function gjEnd(ok) {
  const g = gj.game;
  g.sec = gjSec(g);
  gzScore(g, ok, ok ? gjWorth(g, g.sec) : 0, { ans: g.ans, sec: Math.round(g.sec), moves: g.moves, clean: ok && g.sec <= g.par });
  gjDraw();
}

function gjResult() {
  const g = gj.game;
  clearInterval(gj.timer);
  gzResult("jig", "Jigsaw", g, g.hard ? "h" : "e", ["", "PICTURE", "TIME", "SWAPS", "POINTS"],
    (r) => `<td><img class="gologpic odd" src="${r.ans.thumb}"></td><td>${esc(r.ans.title)}<i>${esc(r.ans.sub)}</i></td><td class="${r.ok ? (r.clean ? "ok" : "") : "bad"}">${r.ok ? r.sec + " s" : "—"}</td><td>${r.moves}</td><td>${r.points}</td>`,
    () => gjNew(), () => { gj.game = null; gjDrawStart(); });
}
