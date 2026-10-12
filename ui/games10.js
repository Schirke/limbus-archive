// Guess the arena, Higher or lower, Whose passive, Guess the E.G.O, Guess the sound, Memory.
"use strict";

// ------------------------------------------------------------------ shared
for (const k of ["arena", "hilo", "passive", "ego", "sound", "memory"]) gz[k] = gz[k] || { best: {} };
const KQ_WORTH = 1000, KQ_HINT = 250, KQ_STEPS = [1000, 750, 500, 250];
const kqHint = (g, [k, label, val]) => g.hints[k] || g.done ? `<div class="gihint open"><small>${label}</small><b>${val}</b></div>`
  : `<button class="gihint" data-hint="${k}"><small>${label}</small><b>hidden</b><u>open · −${KQ_HINT * (g.hard ? 2 : 1)}</u></button>`;
const kqCls = (g, key) => g.done ? (key === g.ans.key ? "ok" : key === g.done.pick ? "bad" : "dim") : "";
// a name hidden in a text (the answer's own name would give it away)
const kqMask = (text, words) => words.filter((w) => w && w.length > 2).reduce((t, w) => t.replace(new RegExp(`(?<!\\p{L})${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?!\\p{L})`, "giu"), "▢▢▢"), String(text || ""));
// options, or a field to type into when Hard
function kqAsk(g, pool, placeholder) {
  const d = g.done;
  if (g.hard && !d) return `<input id="kqtype" class="dbq" placeholder="${placeholder}" autocomplete="off"><div id="kqsugg" class="gmsugg"></div><button class="toggle gmmore" id="kqskip">I don't know</button>`;
  if (g.hard) return `<div class="gmopts"><div class="gmopt ${d.ok ? "ok" : "bad"}"><b>${esc(d.said || "—")}</b><i>your answer</i></div></div>`;
  return `<div class="gmopts">${g.opts.map((o) => `<button class="gmopt ${kqCls(g, o.key)}" data-k="${esc(o.key)}" ${d ? "disabled" : ""}><b>${esc(o.title || o.name)}</b><i>${esc(o.sub || "")}</i></button>`).join("")}</div>`;
}
function kqWire(g, pool, answer, next, quit) {
  $("#gzquit").onclick = quit;
  document.querySelectorAll("#main [data-hint]").forEach((b) => b.onclick = () => { g.hints[b.dataset.hint] = 1; g.redraw(); });
  document.querySelectorAll("#main .gmopts button").forEach((b) => b.onclick = () => answer(b.dataset.k));
  if ($("#kqskip")) $("#kqskip").onclick = () => answer(null);
  if ($("#kqtype")) gxType($("#kqtype"), $("#kqsugg"), () => pool, answer);
  if ($("#kqnext")) { $("#kqnext").onclick = next; $("#kqnext").focus(); }
}
// a right answer, a wrong one or none
function kqScore(g, key, worth, rec = {}) {
  const pick = key == null ? null : g.pool.find((x) => x.key === key), ok = !!pick && (g.right ? g.right(pick) : pick.key === g.ans.key);
  gzScore(g, ok, ok ? worth : 0, { ans: g.ans, pick: key, said: pick ? pick.name : "", hints: Object.keys(g.hints).length, clean: ok && !Object.keys(g.hints).length && !g.step, ...rec });
  g.redraw();
}
// three wrong answers: the near ones first, then any
function kqWrong(g, ans, near, n = 3) {
  const out = [], seen = new Set([ans.key]);
  for (const x of [...gzMix(near, g.rnd), ...gzMix(g.pool, g.rnd)]) if (out.length < n && !seen.has(x.key) && !(g.right && g.right(x))) { seen.add(x.key); out.push(x); }
  return gzMix([ans, ...out], g.rnd);
}
// the next one not asked yet
function kqNext(g, list) {
  const left = list.filter((x) => !g.asked.has(x.key)), ans = (left.length ? left : list)[Math.floor(g.rnd() * (left.length || list.length))];
  g.asked.add(ans.key);
  return ans;
}
const kqLoading = (title) => { $("#main").innerHTML = `<h1>${title}</h1><div class="sub">Reading the game's files…</div>`; };
const kqDailyClick = (game, start) => { if ($("#gmdaily")) $("#gmdaily").onclick = () => gmDailyDone(game) == null ? start(true) : gzDone(); };
const kqLevelChips = (s, easy, hard) => `${gzChip(!s.hard, 'data-h=""', easy)}${gzChip(s.hard, 'data-h="1"', hard)}`;

// ------------------------------------------------------------------ Guess the arena
// A battle stage's picture (made by the player) zooms out in steps: where is it from — the story's chapter, or the
// abnormality fought there.
const KA_ROUNDS = 10, KA_ZOOM = [2.6, 1.9, 1.35, 1];
const ka = { game: null, pool: null };
window.addEventListener("hashchange", () => { if (!location.hash.startsWith("#/gamearena")) ka.game = null; });
const kaPool = (what) => (ka.pool || []).filter((x) => what === "abno" ? x.abno : what === "story" ? !x.abno : true);
routes.gamearena = async (args = []) => {
  ka.game = null;
  const auto = gmAuto("arena", args);
  gmCrumb("arena");
  kqLoading("Guess the arena");
  if (!ka.pool) {
    const [list, pics] = await Promise.all([api("/api/game_arenas").catch(() => []), api("/api/stage_pics").catch(() => null)]);
    const have = new Set((pics || {}).have || []);
    ka.pool = (list || []).filter((x) => have.has(x.name)).map((x) => x.abno
      ? { key: "a:" + x.name, name: x.abno[1], abno: x.abno, map: x.name, sub: "Abnormality" }
      : { key: "p:" + x.name, name: x.places[0], places: x.places, map: x.name, sub: x.places.slice(1).join(" · ") });
    if (!list || !pics) setTimeout(() => { ka.pool = null; });
  }
  if (!location.hash.startsWith("#/gamearena")) return;
  kaDrawStart();
  if (auto && kaPool("").length >= 8) kaNew(true);
};

function kaDrawStart() {
  const s = gz.arena, n = kaPool(s.what || "").length;
  $("#main").innerHTML = `<h1>Guess the arena</h1>
    <div class="sub">A battle's arena, zoomed in — it zooms out in steps. Name where it's from: the story's chapter, or the Abnormality fought there. The sooner, the more points.</div>
    ${(ka.pool || []).length < 8 ? `<p class="muted">Nothing to ask yet: the arenas' pictures aren't made. Versus makes them (its stage list), or a snapshot is missing.</p>` : `
    <div class="dbrow">${gzChip(!s.what, 'data-w=""', "Everything")}${gzChip(s.what === "story", 'data-w="story"', "Story chapters")}${gzChip(s.what === "abno", 'data-w="abno"', "Abnormalities")}<span class="gap"></span>
      ${kqLevelChips(s, "Easy · 4 answers", "Hard · type the name")}</div>
    <div class="gmstart"><span class="gmscore">${n} ARENAS · BEST <i>${s.best[(s.what || "all") + (s.hard ? "h" : "e")] || 0}</i></span>
      ${gmDailyBtn("arena")}<button class="gmbtn" id="kago" ${n < 8 ? "disabled" : ""}>Start · ${KA_ROUNDS} rounds</button></div>
    <div class="muted small">An arena used in several chapters counts for each of them. Easy: four answers. Hard: type the name, points are doubled.</div>`}`;
  document.querySelectorAll("#main [data-w]").forEach((b) => b.onclick = () => { s.what = b.dataset.w; gzKeep(); kaDrawStart(); });
  document.querySelectorAll("#main [data-h]").forEach((b) => b.onclick = () => { s.hard = !!b.dataset.h; gzKeep(); kaDrawStart(); });
  if ($("#kago")) $("#kago").onclick = () => kaNew();
  kqDailyClick("arena", kaNew);
}

function kaNew(daily) {
  const g = ka.game = gzNew("arena", daily, KA_ROUNDS, { asked: new Set() });
  g.what = g.daily ? "" : gz.arena.what || "";
  g.list = kaPool(g.what);
  g.redraw = kaDraw;
  kaRound();
}

function kaRound() {
  const g = ka.game;
  if (++g.round >= g.of) return kaResult();
  const ans = kqNext(g, g.list);
  // the answers are places / abnormalities, not arenas: one entry per name
  const names = new Map();
  for (const x of g.list) if ((!!x.abno) === (!!ans.abno) && !names.has(x.name)) names.set(x.name, { key: x.name, name: x.name, title: x.name, sub: x.abno ? "Abnormality" : "" });
  g.pool = [...names.values()];
  g.right = (p) => ans.abno ? p.name === ans.name : ans.places.includes(p.name);
  const near = ans.abno ? [] : g.pool.filter((p) => /^Canto \d+$/.test(p.name) === /^Canto \d+$/.test(ans.name));
  Object.assign(g, { ans: { ...ans, key: ans.name }, step: 0, hints: {}, done: null, cx: 0.25 + g.rnd() * 0.5, cy: 0.3 + g.rnd() * 0.4, img: null });
  g.opts = kqWrong(g, g.pool.find((p) => p.name === ans.name), near);
  const im = new Image();
  im.onload = () => { if (ka.game === g && g.ans.map === ans.map) { g.img = im; kaPaint(); } };
  im.onerror = () => { if (ka.game !== g) return; g.list = g.list.filter((x) => x !== ans); g.round--; kaRound(); };
  im.src = `/api/stage_pic?name=${encodeURIComponent(ans.map)}`;
  kaDraw();
}

const kaWorth = (g) => KQ_STEPS[g.step] * (g.hard ? 2 : 1);
function kaDraw() {
  const g = ka.game, a = g.ans, d = g.done;
  $("#main").innerHTML = `<h1>Guess the arena</h1>${gzTop(g)}
    <div class="gmstage gistage gpstage wide"><div>
      <div class="gppic scene"><canvas id="kacv" width="640" height="360"></canvas></div>
      <div class="gmsteps">${KQ_STEPS.map((w, i) => `<span class="${d ? (i <= g.step ? "done" : "") : i < g.step ? "done" : i === g.step ? "cur" : ""}">${w}</span>`).join("")}</div>
      ${!d && g.step < KQ_STEPS.length - 1 ? `<button class="toggle gmmore" id="kamore">Zoom out · −${(KQ_STEPS[g.step] - KQ_STEPS[g.step + 1]) * (g.hard ? 2 : 1)}</button>` : ""}</div>
    <div><div class="gmkick">${d ? (d.ok ? `+${d.points}` : "MISSED") : `WORTH ${kaWorth(g)} NOW`}</div>
      <div class="gmq">${d ? esc(a.name) : a.abno ? "Whose arena is this?" : "Where is this fight?"}</div>
      ${kqAsk(g, g.pool, a.abno ? "Abnormality…" : "Canto or story…")}
      ${d ? `<div class="gmafter"><span>${a.abno ? `<a href="#/enemies/${a.abno[0]}">Open in the handbook →</a>` : esc(a.places.length > 1 ? "Also in: " + a.places.slice(1).join(", ") : "")}</span>
        <button class="gmbtn" id="kqnext">${g.round + 1 < g.of ? "Next" : "Result"}</button></div>` : ""}</div></div>`;
  kqWire(g, g.pool, (k) => kqScore(g, k, kaWorth(g), { step: g.step }), kaRound, () => { ka.game = null; kaDrawStart(); });
  if ($("#kamore")) $("#kamore").onclick = () => { g.step++; kaDraw(); };
  kaPaint();
}

function kaPaint() {
  const g = ka.game, cv = $("#kacv");
  if (!g || !cv) return;
  const x = cv.getContext("2d");
  x.fillStyle = "#161315";
  x.fillRect(0, 0, cv.width, cv.height);
  if (!g.img) return;
  const z = g.done ? 1 : KA_ZOOM[g.step], w = g.img.width / z, h = g.img.height / z;
  const sx = Math.max(0, Math.min(g.img.width - w, g.cx * g.img.width - w / 2)), sy = Math.max(0, Math.min(g.img.height - h, g.cy * g.img.height - h / 2));
  x.drawImage(g.img, sx, sy, w, h, 0, 0, cv.width, cv.height);
}

function kaResult() {
  const g = ka.game;
  gzResult("arena", "Guess the arena", g, (g.what || "all") + (g.hard ? "h" : "e"), ["", "ARENA OF", "YOUR ANSWER", "OPENED", "POINTS"],
    (r) => `<td><img class="gplogpic" src="/api/stage_pic?name=${encodeURIComponent(r.ans.map)}"></td><td>${esc(r.ans.name)}</td><td class="${r.ok ? "ok" : "bad"}">${esc(r.said || "—")}</td><td>${r.step + 1} / ${KQ_STEPS.length}</td><td>${r.points}</td>`,
    () => kaNew(), () => { ka.game = null; kaDrawStart(); });
}

// ------------------------------------------------------------------ Higher or lower
// Two Identities and one of their numbers: is the second one's higher or lower? Goes on until the first miss.
const KH_MAX = 20, KH_WORTH = 500;
const kh = { game: null, ids: null };
window.addEventListener("hashchange", () => { if (!location.hash.startsWith("#/gamehilo")) kh.game = null; });
const khTop = (x) => x.skills.filter((s) => s.type === "SKILL" && s.copies).sort((a, b) => a.tier - b.tier);
const khRoll = (s) => { const u = s && s.up[Math.max(...Object.keys(s.up).map(Number))]; return u ? u.base + (u.op === "SUB" ? 0 : u.coins * u.coin) : null; };
// [key, what is asked, value, how it is shown, Hard only]
const KH_STATS = [
  ["hp", `HP at level ${MAX_LEVEL}`, (x) => Math.floor(x.hp + x.hpLevel * MAX_LEVEL)],
  ["speed", "Top speed", (x) => (x.speed[x.speed.length - 1] || [])[1]],
  ["date", "Release date", (x) => x.date || null, (v) => v],
  ["s3", "Skill 3's highest roll", (x) => khRoll(khTop(x)[2]), null, true],
  ["slow", "Lowest speed", (x) => (x.speed[x.speed.length - 1] || [])[0], null, true],
  ["stagger", "First stagger threshold", (x) => x.stagger[0] != null ? x.stagger[0] : null, (v) => v + "% HP", true],
  ["def", "Defense level", (x) => MAX_LEVEL + x.def, null, true]];
routes.gamehilo = async (args = []) => {
  kh.game = null;
  const auto = gmAuto("hilo", args);
  gmCrumb("hilo");
  kqLoading("Higher or lower");
  if (!kh.ids) {
    const u = await units().catch(() => null);
    kh.ids = ((u || {}).ids || []).filter((x) => x.img && x.img.thumb && x.speed && x.speed.length).map((x) => ({ key: "i" + x.id, x, id: x.id, name: x.title + " " + x.sinnerName, title: x.title, sub: x.sinnerName, pic: giThumb(x.img.thumb) }));
    if (!u) setTimeout(() => { kh.ids = null; });
  }
  if (!location.hash.startsWith("#/gamehilo")) return;
  khDrawStart();
  if (auto && kh.ids.length >= 8) khNew(true);
};

function khDrawStart() {
  const s = gz.hilo, n = (kh.ids || []).length;
  $("#main").innerHTML = `<h1>Higher or lower</h1>
    <div class="sub">Two Identities and one of their numbers — the first one's is shown. Is the second one's higher or lower? It goes on until the first miss.</div>
    ${n < 8 ? `<p class="muted">Nothing to ask yet: the game's files or a snapshot are missing.</p>` : `
    <div class="dbrow">${kqLevelChips(s, "Easy · HP, speed, release", "Hard · every number")}</div>
    <div class="gmstart"><span class="gmscore">${n} IDENTITIES · BEST <i>${s.best[s.hard ? "h" : "e"] || 0}</i></span>
      ${gmDailyBtn("hilo")}<button class="gmbtn" id="khgo">Start</button></div>
    <div class="muted small">${KH_WORTH} for every right call, up to ${KH_MAX} in a row. Easy asks HP at level ${MAX_LEVEL}, top speed and release date. Hard also asks skill 3's highest roll, the lowest speed, the first stagger threshold and the defense level — points are doubled. Numbers at uptie 4.</div>`}`;
  document.querySelectorAll("#main [data-h]").forEach((b) => b.onclick = () => { s.hard = !!b.dataset.h; gzKeep(); khDrawStart(); });
  if ($("#khgo")) $("#khgo").onclick = () => khNew();
  kqDailyClick("hilo", khNew);
}

function khNew(daily) {
  const g = kh.game = gzNew("hilo", daily, KH_MAX, { asked: new Set() });
  g.stats = KH_STATS.filter((s) => g.hard || !s[4]);
  g.left = kh.ids[Math.floor(g.rnd() * kh.ids.length)];
  g.asked.add(g.left.key);
  khRound();
}

function khRound() {
  const g = kh.game;
  if (g.round >= 0 && (!g.done.ok || g.round + 1 >= g.of)) return khResult();
  g.round++;
  if (g.done) g.left = g.right;
  g.right = null;
  for (let k = 0; k < 60 && !g.right; k++) {  // a number both have, and not the same
    const st = g.stats[Math.floor(g.rnd() * g.stats.length)], a = st[2](g.left.x);
    const can = kh.ids.filter((y) => !g.asked.has(y.key) && st[2](y.x) != null && a != null && st[2](y.x) !== a);
    if (!can.length) continue;
    g.stat = st;
    g.right = can[Math.floor(g.rnd() * can.length)];
  }
  if (!g.right) { g.round--; return khResult(); }
  g.asked.add(g.right.key);
  g.done = null;
  khDraw();
}

const khShow = (st, v) => st[3] ? st[3](v) : String(v);
function khDraw() {
  const g = kh.game, d = g.done, st = g.stat, a = st[2](g.left.x), b = st[2](g.right.x), date = st[0] === "date";
  const card = (y, v, open) => `<div class="khcard ${open ? "" : "hid"}"><img src="${y.pic}"><b>${esc(y.title)}</b><i>${esc(y.sub)}</i><div class="khval">${open ? esc(khShow(st, v)) : "?"}</div></div>`;
  $("#main").innerHTML = `<h1>Higher or lower</h1>
    <div class="gmtop"><span class="gmscore">IN A ROW <b>${g.log.filter((r) => r.ok).length}</b> / ${g.of}</span><span class="grow"></span>
      <span class="gmscore">SCORE <b>${g.score}</b></span><button class="toggle" id="gzquit">Quit</button></div>
    <div class="khbox"><div class="gmkick">${esc(st[1]).toUpperCase()}</div>
      <div class="khpair">${card(g.left, a, true)}<div class="khmid">${d ? `<b class="${d.ok ? "ok" : "bad"}">${d.ok ? `+${d.points}` : "MISSED"}</b>`
        : `<button class="gmbtn" data-up="1">${date ? "Later ▲" : "Higher ▲"}</button><button class="gmbtn" data-up="">${date ? "Earlier ▼" : "Lower ▼"}</button>`}</div>${card(g.right, b, !!d)}</div>
      ${d ? `<div class="gmafter"><span><a href="#/db/${g.right.id}">Open in the database →</a></span><button class="gmbtn" id="khnext">${d.ok && g.round + 1 < g.of ? "Next" : "Result"}</button></div>` : ""}</div>`;
  $("#gzquit").onclick = () => { kh.game = null; khDrawStart(); };
  document.querySelectorAll("#main [data-up]").forEach((btn) => btn.onclick = () => {
    const ok = (b > a) === !!btn.dataset.up;
    gzScore(g, ok, ok ? KH_WORTH * (g.hard ? 2 : 1) : 0, { a: g.left, b: g.right, stat: st, va: a, vb: b, said: btn.dataset.up ? "higher" : "lower", clean: ok });
    khDraw();
  });
  if ($("#khnext")) { $("#khnext").onclick = khRound; $("#khnext").focus(); }
}

function khResult() {
  const g = kh.game;
  g.of = g.log.length;
  gzResult("hilo", "Higher or lower", g, g.hard ? "h" : "e", ["", "NUMBER", "FIRST", "SECOND", "YOUR CALL", "POINTS"],
    (r) => `<td><img class="gologpic odd" src="${r.b.pic}"></td><td>${esc(r.stat[1])}</td><td>${esc(r.a.title)}<i>${esc(khShow(r.stat, r.va))}</i></td><td>${esc(r.b.title)}<i>${esc(khShow(r.stat, r.vb))}</i></td><td class="${r.ok ? "ok" : "bad"}">${r.said}</td><td>${r.points}</td>`,
    () => khNew(), () => { kh.game = null; khDrawStart(); });
}

// ------------------------------------------------------------------ Whose passive
// A passive's text without its name: which Identity's is it?
const KP_ROUNDS = 10;
const kp = { game: null, list: null, ids: null };
window.addEventListener("hashchange", () => { if (!location.hash.startsWith("#/gamepassive")) kp.game = null; });
routes.gamepassive = async (args = []) => {
  kp.game = null;
  const auto = gmAuto("passive", args);
  gmCrumb("passive");
  kqLoading("Whose passive");
  if (!kp.list) {
    const u = await units().catch(() => null), seen = new Map();
    kp.ids = ((u || {}).ids || []).filter((x) => x.img && x.img.thumb).map((x) => ({ key: "i" + x.id, id: x.id, name: x.title + " " + x.sinnerName, title: x.title, sub: x.sinnerName, sinner: x.sinner, kw: x.keywords || [], pic: giThumb(x.img.thumb) }));
    for (const x of (u || {}).ids || []) for (const p of x.passives || []) {
      const text = (p.desc || "").trim();
      if (text.length < 40 || !["battle", "support"].includes(p.kind)) continue;
      seen.set(text, seen.has(text) ? null : { key: "p" + p.id, id: x.id, p, who: "i" + x.id });  // (a text two Identities share: neither)
    }
    kp.list = [...seen.values()].filter(Boolean);
    if (!u) setTimeout(() => { kp.list = null; });
  }
  if (!location.hash.startsWith("#/gamepassive")) return;
  kpDrawStart();
  if (auto && kp.list.length >= 8) kpNew(true);
};

function kpDrawStart() {
  const s = gz.passive, n = (kp.list || []).length;
  $("#main").innerHTML = `<h1>Whose passive</h1>
    <div class="sub">A battle or support passive — its text, without its name. Whose Identity is it?</div>
    ${n < 8 ? `<p class="muted">Nothing to ask yet: the game's files or a snapshot are missing.</p>` : `
    <div class="dbrow">${kqLevelChips(s, "Easy · 4 answers", "Hard · type the name")}</div>
    <div class="gmstart"><span class="gmscore">${n} PASSIVES · BEST <i>${s.best[s.hard ? "h" : "e"] || 0}</i></span>
      ${gmDailyBtn("passive")}<button class="gmbtn" id="kpgo">Start · ${KP_ROUNDS} rounds</button></div>
    <div class="muted small">${KQ_WORTH} a right answer; the passive's name and the Sinner are hints that cost ${KQ_HINT} each. Easy: four answers — the same Sinner's or the same statuses' Identities among them. Hard: type the Identity, points are doubled.</div>`}`;
  document.querySelectorAll("#main [data-h]").forEach((b) => b.onclick = () => { s.hard = !!b.dataset.h; gzKeep(); kpDrawStart(); });
  if ($("#kpgo")) $("#kpgo").onclick = () => kpNew();
  kqDailyClick("passive", kpNew);
}

function kpNew(daily) {
  const g = kp.game = gzNew("passive", daily, KP_ROUNDS, { asked: new Set(), pool: kp.ids });
  g.redraw = kpDraw;
  kpRound();
}

function kpRound() {
  const g = kp.game;
  if (++g.round >= g.of) return kpResult();
  const q = kqNext(g, kp.list), ans = g.pool.find((x) => x.key === q.who);
  const near = g.pool.filter((x) => x.sinner === ans.sinner || x.kw.some((k) => ans.kw.includes(k)));
  Object.assign(g, { q, ans, hints: {}, done: null, step: 0, opts: kqWrong(g, ans, near) });
  kpDraw();
}

const kpWorth = (g) => Math.max(100, KQ_WORTH - KQ_HINT * Object.keys(g.hints).length) * (g.hard ? 2 : 1);
function kpDraw() {
  const g = kp.game, a = g.ans, p = g.q.p, d = g.done;
  const cost = (p.cost || []).map((c) => `${sinIcon(c.sin, "s18")}<b>×${c.n}</b>`).join(" ");
  $("#main").innerHTML = `<h1>Whose passive</h1>${gzTop(g)}
    <div class="gmstage kpstage"><div class="kpcard"><div class="row"><b class="grow">${d || g.hints.name ? esc(p.name) : "▢▢▢"}</b>${cost ? `<span class="pcost"><span class="muted small">${p.mode === "res" ? "Resonance" : "Owned"}</span> ${cost}</span>` : ""}</div>
      <div class="muted small">${p.kind === "support" ? "Support passive" : "Battle passive"}</div>
      <div class="skdesc">${fmtDesc(d ? p.desc : kqMask(p.desc, [a.sub, ...a.sub.split(" ")]), true)}</div>
      <div class="gihints">${[["name", "NAME", esc(p.name)], ["sinner", "SINNER", esc(a.sub)]].map((h) => kqHint(g, h)).join("")}</div></div>
    <div><div class="gmkick">${d ? (d.ok ? `+${d.points}` : "MISSED") : `WORTH ${kpWorth(g)} NOW`}</div>
      <div class="gmq">${d ? esc(a.name) : "Whose passive is this?"}</div>
      ${kqAsk(g, g.pool, "Identity…")}
      ${d ? `<div class="gmafter"><img class="gologpic odd" src="${a.pic}"><a href="#/db/${a.id}">Open in the database →</a><button class="gmbtn" id="kqnext">${g.round + 1 < g.of ? "Next" : "Result"}</button></div>` : ""}</div></div>`;
  kqWire(g, g.pool, (k) => kqScore(g, k, kpWorth(g), { q: g.q }), kpRound, () => { kp.game = null; kpDrawStart(); });
}

function kpResult() {
  const g = kp.game;
  gzResult("passive", "Whose passive", g, g.hard ? "h" : "e", ["", "PASSIVE", "WHOSE", "YOUR ANSWER", "HINTS", "POINTS"],
    (r) => `<td><img class="gologpic odd" src="${r.ans.pic}"></td><td>${esc(r.q.p.name)}</td><td>${esc(r.ans.title)}<i>${esc(r.ans.sub)}</i></td><td class="${r.ok ? "ok" : "bad"}">${esc(r.said || "—")}</td><td>${r.hints || ""}</td><td>${r.points}</td>`,
    () => kpNew(), () => { kp.game = null; kpDrawStart(); });
}

// ------------------------------------------------------------------ Guess the E.G.O
// An E.G.O's card opens in steps: grade, cost and attack first, then its passive, its skill's text, a blurred picture.
const KE_ROUNDS = 10;
const ke = { game: null, list: null };
window.addEventListener("hashchange", () => { if (!location.hash.startsWith("#/gameego")) ke.game = null; });
routes.gameego = async (args = []) => {
  ke.game = null;
  const auto = gmAuto("ego", args);
  gmCrumb("ego");
  kqLoading("Guess the E.G.O");
  if (!ke.list) {
    const u = await units().catch(() => null);
    ke.list = ((u || {}).egos || []).filter((x) => x.img && x.img.thumb && (x.skills || []).length).map((x) => {
      const s = x.skills.find((k) => /AWAKEN/.test(k.type)) || x.skills[0], top = s.up[Math.max(...Object.keys(s.up).map(Number))];
      return { key: "e" + x.id, id: x.id, name: x.name + " " + x.sinnerName, title: x.name, sub: x.sinnerName, sinner: x.sinner, grade: x.grade, cost: x.cost || [],
        top, passive: (x.passives || [])[0], pic: giThumb(x.img.thumb) };
    });
    if (!u) setTimeout(() => { ke.list = null; });
  }
  if (!location.hash.startsWith("#/gameego")) return;
  keDrawStart();
  if (auto && ke.list.length >= 8) keNew(true);
};

function keDrawStart() {
  const s = gz.ego, n = (ke.list || []).length;
  $("#main").innerHTML = `<h1>Guess the E.G.O</h1>
    <div class="sub">An E.G.O's card that opens in steps: its grade, cost and attack first, then its passive, its skill's text and at last a blurred picture. Name the E.G.O; the sooner, the more points.</div>
    ${n < 8 ? `<p class="muted">Nothing to ask yet: the game's files or a snapshot are missing.</p>` : `
    <div class="dbrow">${kqLevelChips(s, "Easy · 4 answers", "Hard · type the name")}</div>
    <div class="gmstart"><span class="gmscore">${n} E.G.O · BEST <i>${s.best[s.hard ? "h" : "e"] || 0}</i></span>
      ${gmDailyBtn("ego")}<button class="gmbtn" id="kego">Start · ${KE_ROUNDS} rounds</button></div>
    <div class="muted small">Easy: four answers — of the same Sinner or the same grade. Hard: type the name, points are doubled. The E.G.O's name is hidden in its texts.</div>`}`;
  document.querySelectorAll("#main [data-h]").forEach((b) => b.onclick = () => { s.hard = !!b.dataset.h; gzKeep(); keDrawStart(); });
  if ($("#kego")) $("#kego").onclick = () => keNew();
  kqDailyClick("ego", keNew);
}

function keNew(daily) {
  const g = ke.game = gzNew("ego", daily, KE_ROUNDS, { asked: new Set(), pool: ke.list });
  g.redraw = keDraw;
  keRound();
}

function keRound() {
  const g = ke.game;
  if (++g.round >= g.of) return keResult();
  const ans = kqNext(g, g.pool), near = g.pool.filter((x) => x.sinner === ans.sinner || x.grade === ans.grade);
  Object.assign(g, { ans, hints: {}, done: null, step: 0, opts: kqWrong(g, ans, near) });
  keDraw();
}

const keWorth = (g) => KQ_STEPS[g.step] * (g.hard ? 2 : 1);
function keDraw() {
  const g = ke.game, a = g.ans, d = g.done, t = a.top, open = (n) => d || g.step >= n, hide = (s) => d ? s : kqMask(s, [a.title]);
  const cost = a.cost.map((c) => `${sinIcon(c.sin, "s18")}<b>×${c.n}</b>`).join(" ");
  const shut = (what) => `<div class="kehid">${what} · opens at the next step</div>`;
  $("#main").innerHTML = `<h1>Guess the E.G.O</h1>${gzTop(g)}
    <div class="gmstage kpstage"><div class="kpcard">
      <div class="row"><b class="grow kegrade">${esc(a.grade || "")}</b>${cost ? `<span class="pcost"><span class="muted small">Cost</span> ${cost}</span>` : ""}</div>
      <div class="kerow">${sinIcon(t.sin, "s18")} ${atkIcon(t, "s18")} <span>${esc([t.sin !== "None" ? t.sin : "", t.atk].filter(Boolean).join(" · "))}</span>
        <span class="muted">Base ${t.base} · ${t.coins} coin${t.coins > 1 ? "s" : ""} ${t.op === "SUB" ? "−" : "+"}${t.coin}${t.sanity ? ` · Sanity −${t.sanity}` : ""}</span></div>
      ${open(1) ? (a.passive ? `<div class="kesec"><small>PASSIVE</small><b>${esc(hide(a.passive.name))}</b><div class="skdesc">${fmtDesc(hide(a.passive.desc), true)}</div></div>` : `<div class="kehid">No passive</div>`) : shut("Its passive")}
      ${open(2) ? `<div class="kesec"><small>SKILL</small><div class="skdesc">${fmtDesc(hide([t.desc, ...(t.coindescs || []).flat()].filter(Boolean).join("\n")), true)}</div></div>` : shut("Its skill's text")}
      ${open(3) ? `<div class="kepic ${d ? "" : "blur"}"><img src="${a.pic}"></div>` : shut("A picture")}
      <div class="gmsteps">${KQ_STEPS.map((w, i) => `<span class="${d ? (i <= g.step ? "done" : "") : i < g.step ? "done" : i === g.step ? "cur" : ""}">${w}</span>`).join("")}</div>
      ${!d && g.step < KQ_STEPS.length - 1 ? `<button class="toggle gmmore" id="kemore">Show more · −${(KQ_STEPS[g.step] - KQ_STEPS[g.step + 1]) * (g.hard ? 2 : 1)}</button>` : ""}</div>
    <div><div class="gmkick">${d ? (d.ok ? `+${d.points}` : "MISSED") : `WORTH ${keWorth(g)} NOW`}</div>
      <div class="gmq">${d ? esc(a.title) : "Which E.G.O is this?"}</div>
      ${kqAsk(g, g.pool, "E.G.O…")}
      ${d ? `<div class="gmafter"><span>${esc(a.sub)} · <a href="#/db/${a.id}">Open in the database →</a></span><button class="gmbtn" id="kqnext">${g.round + 1 < g.of ? "Next" : "Result"}</button></div>` : ""}</div></div>`;
  kqWire(g, g.pool, (k) => kqScore(g, k, keWorth(g), { step: g.step }), keRound, () => { ke.game = null; keDrawStart(); });
  if ($("#kemore")) $("#kemore").onclick = () => { g.step++; keDraw(); };
}

function keResult() {
  const g = ke.game;
  gzResult("ego", "Guess the E.G.O", g, g.hard ? "h" : "e", ["", "E.G.O", "YOUR ANSWER", "OPENED", "POINTS"],
    (r) => `<td><img class="gologpic odd" src="${r.ans.pic}"></td><td>${esc(r.ans.title)}<i>${esc(r.ans.sub)}</i></td><td class="${r.ok ? "ok" : "bad"}">${esc(r.said || "—")}</td><td>${r.step + 1} / ${KQ_STEPS.length}</td><td>${r.points}</td>`,
    () => keNew(), () => { ke.game = null; keDrawStart(); });
}

// ------------------------------------------------------------------ Guess the sound
// A voiced line from a battle: which announcer says it, or which E.G.O it is the Sinner's line of.
const KS_ROUNDS = 10;
const ks = { game: null, ann: null, egos: null, audio: new Audio() };
window.addEventListener("hashchange", () => { if (!location.hash.startsWith("#/gamesound")) { ks.audio.pause(); ks.game = null; } });
const ksPool = (what) => what === "ann" ? ks.ann : what === "ego" ? ks.egos : [...(ks.ann || []), ...(ks.egos || [])];
routes.gamesound = async (args = []) => {
  ks.audio.pause();
  ks.game = null;
  const auto = gmAuto("sound", args);
  gmCrumb("sound");
  kqLoading("Guess the sound");
  if (!ks.ann) {
    const [v, u] = await Promise.all([api("/api/game_voices").catch(() => null), units().catch(() => null)]);
    ks.ann = Object.entries((v || {}).announcers || {}).map(([name, lines]) => ({ key: "a:" + name, name, title: name, sub: "Announcer", kind: "ann", lines }));
    const egos = new Map(((u || {}).egos || []).map((x) => [String(x.id), x]));
    ks.egos = Object.entries((v || {}).egos || {}).filter(([id]) => egos.has(id)).map(([id, lines]) => { const x = egos.get(id);
      return { key: "e" + id, id: x.id, name: x.name + " " + x.sinnerName, title: x.name, sub: x.sinnerName, sinner: x.sinner, kind: "ego", lines, pic: giThumb(x.img.thumb) }; });
    if (!v || !u) setTimeout(() => { ks.ann = null; });
  }
  if (!location.hash.startsWith("#/gamesound")) return;
  ksDrawStart();
  if (auto && ksPool("").length >= 8) ksNew(true);
};

function ksDrawStart() {
  const s = gz.sound, n = (ksPool(s.what || "") || []).length;
  $("#main").innerHTML = `<h1>Guess the sound</h1>
    <div class="sub">A line from a battle plays. Who says it — which battle announcer? Or which E.G.O is it the Sinner's line of?</div>
    ${ksPool("").length < 8 ? `<p class="muted">Nothing to ask yet: the game's sound files or a snapshot are missing.</p>` : `
    <div class="dbrow">${gzChip(!s.what, 'data-w=""', "Both")}${gzChip(s.what === "ann", 'data-w="ann"', "Announcers")}${gzChip(s.what === "ego", 'data-w="ego"', "E.G.O lines")}<span class="gap"></span>
      ${kqLevelChips(s, "Easy · 4 answers", "Hard · type the name")}</div>
    <div class="gmstart"><span class="gmscore">${n} ${s.what === "ann" ? "ANNOUNCERS" : s.what === "ego" ? "E.G.O" : "VOICES"} · BEST <i>${s.best[(s.what || "all") + (s.hard ? "h" : "e")] || 0}</i></span>
      ${gmDailyBtn("sound")}<button class="gmbtn" id="ksgo">Start · ${KS_ROUNDS} rounds</button></div>
    <div class="muted small">${KQ_WORTH} a right answer; the line's text is a hint that costs ${KQ_HINT}. An E.G.O line's answers are all of the same Sinner. Hard: type the name, points are doubled.</div>`}`;
  document.querySelectorAll("#main [data-w]").forEach((b) => b.onclick = () => { s.what = b.dataset.w; gzKeep(); ksDrawStart(); });
  document.querySelectorAll("#main [data-h]").forEach((b) => b.onclick = () => { s.hard = !!b.dataset.h; gzKeep(); ksDrawStart(); });
  if ($("#ksgo")) $("#ksgo").onclick = () => ksNew();
  kqDailyClick("sound", ksNew);
}

function ksNew(daily) {
  const g = ks.game = gzNew("sound", daily, KS_ROUNDS, { asked: new Set() });
  g.what = g.daily ? "" : gz.sound.what || "";
  g.list = ksPool(g.what);
  g.redraw = ksDraw;
  ksRound();
}

function ksRound() {
  const g = ks.game;
  if (++g.round >= g.of) { ks.audio.pause(); return ksResult(); }
  const ans = kqNext(g, g.list);
  g.pool = ans.kind === "ann" ? ks.ann : ks.egos;
  const near = ans.kind === "ego" ? g.pool.filter((x) => x.sinner === ans.sinner) : [];
  Object.assign(g, { ans, line: ans.lines[Math.floor(g.rnd() * ans.lines.length)], hints: {}, done: null, step: 0, opts: kqWrong(g, ans, near) });
  ksDraw();
  ksPlay();
}

function ksPlay() {
  const l = ks.game.line;
  ks.audio.src = `/api/bank?path=${encodeURIComponent(l[0])}&i=${l[1]}`;
  ks.audio.volume = gmVol();
  ks.audio.play().catch(() => {});
}

const ksWorth = (g) => Math.max(100, KQ_WORTH - KQ_HINT * Object.keys(g.hints).length) * (g.hard ? 2 : 1);
function ksDraw() {
  const g = ks.game, a = g.ans, d = g.done, text = g.line[g.line.length - 1] || "";
  $("#main").innerHTML = `<h1>Guess the sound</h1>${gzTop(g)}
    <div class="gmstage"><div><button id="ksplay" class="gmdisc" title="Play it again"><div>▶</div></button>
      <label class="gmvol">Volume <input id="ksvol" type="range" min="0" max="1" step="0.01" value="${gmVol()}"></label>
      <div class="gihints">${text ? kqHint(g, ["text", "TEXT", esc(d || g.hints.text ? text : "")]) : ""}${a.kind === "ego" ? `<div class="gihint open"><small>SINNER</small><b>${esc(a.sub)}</b></div>` : ""}</div></div>
    <div><div class="gmkick">${d ? (d.ok ? `+${d.points}` : "MISSED") : `WORTH ${ksWorth(g)} NOW`}</div>
      <div class="gmq">${d ? esc(a.kind === "ego" ? a.title : a.name) : a.kind === "ego" ? "Which E.G.O's line is this?" : "Which announcer is this?"}</div>
      ${kqAsk(g, g.pool, a.kind === "ego" ? "E.G.O…" : "Announcer…")}
      ${d ? `<div class="gmafter"><span>${esc(g.line[3] && a.kind === "ego" ? g.line[3] : "")}${a.kind === "ego" ? ` · <a href="#/db/${a.id}">Open in the database →</a>` : ""}</span><button class="gmbtn" id="kqnext">${g.round + 1 < g.of ? "Next" : "Result"}</button></div>` : ""}</div></div>`;
  kqWire(g, g.pool, (k) => kqScore(g, k, ksWorth(g), { line: g.line }), ksRound, () => { ks.audio.pause(); ks.game = null; ksDrawStart(); });
  $("#ksplay").onclick = () => { ks.audio.currentTime = 0; ks.audio.play().catch(() => {}); };
  $("#ksvol").oninput = (e) => { ks.audio.volume = gm.vol = +e.target.value; };
  $("#ksvol").onchange = gmKeep;
}

function ksResult() {
  const g = ks.game;
  gzResult("sound", "Guess the sound", g, (g.what || "all") + (g.hard ? "h" : "e"), ["WHO", "THE LINE", "YOUR ANSWER", "HINTS", "POINTS", ""],
    (r) => `<td>${esc(r.ans.title)}<i>${esc(r.ans.sub)}</i></td><td class="small">${esc(r.line[r.line.length - 1] || "")}</td><td class="${r.ok ? "ok" : "bad"}">${esc(r.said || "—")}</td><td>${r.hints || ""}</td><td>${r.points}</td>
      <td><button class="toggle" data-ksplay="${esc(r.line[0])}|${r.line[1]}">▶ play</button></td>`,
    () => ksNew(), () => { ks.game = null; ksDrawStart(); });
  document.querySelectorAll("[data-ksplay]").forEach((b) => b.onclick = () => { const [p, i] = b.dataset.ksplay.split("|"); ks.audio.src = `/api/bank?path=${encodeURIComponent(p)}&i=${i}`; ks.audio.play().catch(() => {}); });
}

// ------------------------------------------------------------------ Memory
// Face-down cards, two of each Identity: turn two at a time and find the pairs. Fewer misses and less time = more points.
const KM_PAIRS = [8, 12], KM_MISS = 250, KM_SEC = 20, KM_MAX = 10000;
const km = { game: null, ids: null, timer: 0 };
window.addEventListener("hashchange", () => { if (!location.hash.startsWith("#/gamememory")) kmLeave(); });
function kmLeave() { clearInterval(km.timer); km.game = null; }
routes.gamememory = async (args = []) => {
  kmLeave();
  const auto = gmAuto("memory", args);
  gmCrumb("memory");
  kqLoading("Memory");
  if (!km.ids) {
    const u = await units().catch(() => null);
    km.ids = ((u || {}).ids || []).filter((x) => x.img && x.img.thumb).map((x) => ({ key: "i" + x.id, id: x.id, title: x.title, sub: x.sinnerName, sinner: x.sinner, pic: giThumb(x.img.thumb) }));
    if (!u) setTimeout(() => { km.ids = null; });
  }
  if (!location.hash.startsWith("#/gamememory")) return;
  kmDrawStart();
  if (auto && km.ids.length >= 16) kmNew(true);
};

function kmDrawStart() {
  const s = gz.memory, n = (km.ids || []).length;
  $("#main").innerHTML = `<h1>Memory</h1>
    <div class="sub">Face-down cards, two of each Identity. Turn two at a time: a pair stays open, others turn back. Find every pair with as few misses as you can.</div>
    ${n < 16 ? `<p class="muted">Nothing to ask yet: the game's files or a snapshot are missing.</p>` : `
    <div class="dbrow">${kqLevelChips(s, `Easy · ${KM_PAIRS[0]} pairs`, `Hard · ${KM_PAIRS[1]} pairs of one Sinner`)}</div>
    <div class="gmstart"><span class="gmscore">BEST <i>${s.best[s.hard ? "h" : "e"] || 0}</i></span>
      ${gmDailyBtn("memory")}<button class="gmbtn" id="kmgo">Start</button></div>
    <div class="muted small">${KM_MAX} at most; every miss costs ${KM_MISS} and every second ${KM_SEC}. Hard: twelve pairs, all of the same Sinner — points are doubled.</div>`}`;
  document.querySelectorAll("#main [data-h]").forEach((b) => b.onclick = () => { s.hard = !!b.dataset.h; gzKeep(); kmDrawStart(); });
  if ($("#kmgo")) $("#kmgo").onclick = () => kmNew();
  kqDailyClick("memory", kmNew);
}

function kmNew(daily) {
  kmLeave();
  const g = km.game = gzNew("memory", daily, KM_PAIRS[0], {});
  g.of = KM_PAIRS[g.hard ? 1 : 0];
  let from = km.ids;
  if (g.hard) {  // one Sinner with enough Identities
    const by = new Map();
    for (const x of km.ids) by.set(x.sub, [...(by.get(x.sub) || []), x]);
    const can = [...by.values()].filter((a) => a.length >= g.of);
    if (can.length) from = can[Math.floor(g.rnd() * can.length)];
  }
  g.pairs = gzMix(from, g.rnd).slice(0, g.of);
  g.cards = gzMix([...g.pairs, ...g.pairs].map((x, i) => ({ x, n: i, open: false, got: false, seen: 0 })), g.rnd);
  Object.assign(g, { up: [], miss: 0, t0: 0, sec: 0, round: 0 });
  km.timer = setInterval(kmClock, 500);
  kmDraw();
}

const kmSec = (g) => g.t0 ? (g.end || performance.now()) / 1000 - g.t0 / 1000 : 0;
const kmPoints = (g) => Math.max(500, Math.round((KM_MAX - KM_MISS * g.miss - KM_SEC * kmSec(g)) / 10) * 10) * (g.hard ? 2 : 1);
function kmClock() {
  const g = km.game, el = $("#kmtime");
  if (!g || !el) return;
  const s = Math.floor(kmSec(g));
  $("#kmpairs").innerHTML = `PAIRS <b>${g.log.length} / ${g.of}</b>`;
  el.innerHTML = `MISSES <b>${g.miss}</b> &nbsp; TIME <i>${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}</i>`;
}

function kmDraw() {
  const g = km.game;
  $("#main").innerHTML = `<h1>Memory</h1>
    <div class="gmtop"><span class="gmscore" id="kmpairs"></span><span class="grow"></span><span class="gmscore" id="kmtime"></span><button class="toggle" id="gzquit">Quit</button></div>
    <div class="kmgrid ${g.hard ? "hard" : ""}">${g.cards.map((c, i) => `<button class="kmcard ${c.open || c.got ? "open" : ""} ${c.got ? "got" : ""}" data-i="${i}" title="${c.open || c.got ? esc(c.x.title + " · " + c.x.sub) : ""}">
      ${c.open || c.got ? `<img src="${c.x.pic}" draggable="false">` : ""}</button>`).join("")}</div>`;
  $("#gzquit").onclick = () => { kmLeave(); kmDrawStart(); };
  document.querySelectorAll("#main .kmcard").forEach((b) => b.onclick = () => kmFlip(+b.dataset.i));
  kmClock();
}

function kmFlip(i) {
  const g = km.game, c = g.cards[i];
  if (!g || c.open || c.got || g.up.length >= 2) return;
  if (!g.t0) g.t0 = performance.now();
  c.open = true;
  c.seen++;
  g.up.push(c);
  if (g.up.length === 2) {
    const [a, b] = g.up;
    if (a.x.key === b.x.key) {
      a.got = b.got = true;
      a.open = b.open = false;
      g.up = [];
      const tries = Math.max(a.seen, b.seen);
      g.log.push({ ok: tries <= 2, clean: tries === 1, ans: a.x, tries, points: 0 });
      if (g.log.length === g.of) return kmEnd();
    } else {
      g.miss++;
      setTimeout(() => { if (km.game !== g) return; a.open = b.open = false; g.up = []; kmDraw(); }, 900);
    }
  }
  kmDraw();
}

function kmEnd() {
  const g = km.game;
  g.end = performance.now();
  clearInterval(km.timer);
  g.score = kmPoints(g);
  g.top = 0;
  for (let i = 0, run = 0; i < g.log.length; i++) { run = g.log[i].ok ? run + 1 : 0; g.top = Math.max(g.top, run); }
  const sec = Math.round(kmSec(g));
  gzResult("memory", "Memory", g, g.hard ? "h" : "e", ["", "IDENTITY", "TURNED", ""],
    (r) => `<td><img class="gologpic odd" src="${r.ans.pic}"></td><td>${esc(r.ans.title)}<i>${esc(r.ans.sub)}</i></td><td class="${r.clean ? "ok" : r.ok ? "" : "bad"}">${r.tries === 1 ? "at first sight" : r.tries + " times"}</td><td></td>`,
    () => kmNew(), () => { km.game = null; kmDrawStart(); });
  $("#main .gmtop .gmscore").insertAdjacentHTML("afterend", `<span class="gmscore">${g.miss} MISS${g.miss === 1 ? "" : "ES"} · ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}</span>`);
}
