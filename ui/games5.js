// Games → the two toys (no score, no Daily):
// Extraction — pulls at the game's standard rates, paid with the lunacy the games give (games.js gmW);
// Challenge roulette — a random team and a rule to play it by.
"use strict";

// ------------------------------------------------------------------ Extraction
const GA_KEEP = "games_gacha", GA_COST = 130, GA_PITY = 200;
// the standard banner's rates; the featured Identity takes half of the 000s
const GA_RATE = { r3: 0.029, ego: 0.013, r2: 0.128 };
const ga = { st: null, data: null, last: [] };
const gaNew = () => ({ pulls: 0, n: { r3: 0, r2: 0, r1: 0, ego: 0 }, since: 0, feat: 0, featAt: null, got: {} });
const gaKeep = () => { try { localStorage.setItem(GA_KEEP, JSON.stringify(ga.st)); } catch {} };

routes.gamegacha = async () => {
  gmCrumb("gacha");
  $("#main").innerHTML = `<h1>Extraction</h1><div class="sub">Reading the game's files…</div>`;
  if (!ga.st) { try { ga.st = { ...gaNew(), ...JSON.parse(localStorage.getItem(GA_KEEP) || "{}") }; } catch { ga.st = gaNew(); } }
  if (!ga.data) {
    const u = await api("/api/units").catch(() => null);
    // what the standard extraction gives: no Walpurgis Night or collaboration units, no E.G.O a Sinner starts with
    const usual = (x) => x.season != null && x.season < 8000 && x.img && x.img.thumb;
    const ids = ((u || {}).ids || []).filter(usual).map((x) => ({ key: "i" + x.id, id: x.id, title: x.title, sub: x.sinnerName, rank: x.rank, date: x.date || "", pic: giThumb(x.img.thumb) }));
    const egos = ((u || {}).egos || []).filter((e) => usual(e) && e.id % 100 !== 1).map((e) => ({ key: "g" + e.id, id: e.id, title: e.name, sub: `${e.sinnerName} · ${e.grade}`, ego: true, pic: giThumb(e.img.thumb) }));
    ga.data = { ids, egos, by: new Map([...ids, ...egos].map((x) => [x.key, x])), r: [0, 1, 2, 3].map((r) => ids.filter((x) => x.rank === r)) };
    ga.data.new = ga.data.r[3].slice().sort((a, b) => b.date.localeCompare(a.date));
    if (!ga.st.feat || !ga.data.by.has("i" + ga.st.feat)) ga.st.feat = (ga.data.new[0] || {}).id || 0;
  }
  if (location.hash.startsWith("#/gamegacha")) gaDraw();
};

// one pull; safe: the last of a ten, never less than a 00
function gaRoll(safe) {
  const d = ga.data, st = ga.st, pick = (a) => a[Math.floor(Math.random() * a.length)], r = Math.random();
  const left = d.egos.filter((e) => !st.got[e.key]), feat = d.by.get("i" + st.feat);
  let x;
  if (r < GA_RATE.r3) x = feat && Math.random() < 0.5 ? feat : pick(d.r[3]);
  else if (r < GA_RATE.r3 + GA_RATE.ego && left.length) x = pick(left);  // (an E.G.O comes once: with all of them owned the rest is Identities)
  else if (r < GA_RATE.r3 + GA_RATE.ego + GA_RATE.r2 || safe) x = pick(d.r[2]);
  else x = pick(d.r[1]);
  const kind = x.ego ? "ego" : "r" + x.rank;
  st.pulls++;
  st.n[kind]++;
  st.since = kind === "r3" ? 0 : st.since + 1;
  if (x === feat && st.featAt == null) st.featAt = st.pulls;
  const fresh = !st.got[x.key];
  st.got[x.key] = (st.got[x.key] || 0) + 1;
  return { x, kind, fresh, feat: x === feat };
}

function gaPull(n) {
  if (!ga.data.r[1].length || !ga.data.r[3].length || gmW.lunacy < n * GM_PULL) return;
  gmW.lunacy -= n * GM_PULL;
  ga.last = Array.from({ length: n }, (_, i) => gaRoll(n === 10 && i === 9));
  gaKeep();
  Object.assign(gmW, { pulls: gmW.pulls + n, r3: gmW.r3 + ga.last.filter((r) => r.kind === "r3").length, ego: gmW.ego + ga.last.filter((r) => r.kind === "ego").length });
  gaDraw();
  gmPay([], [gmW.r3 ? "r3" : "", ga.last.some((r) => r.feat) ? "feat" : "", gmW.ego >= 10 ? "ego10" : "", gmW.pulls >= 100 ? "pulls100" : ""].filter(Boolean));
  if ($(".gawallet b")) $(".gawallet b").textContent = gmW.lunacy.toLocaleString("en");
}

function gaDraw() {
  const d = ga.data, st = ga.st, pct = (v) => st.pulls ? (100 * v / st.pulls).toFixed(1) + "%" : "—";
  const mark = (r) => r.kind === "ego" ? "E.G.O" : "0".repeat(r.x.rank);
  const card = (r, i) => `<div class="gacard ${r.kind} ${r.feat ? "feat" : ""}" style="animation-delay:${i * 90}ms"><img src="${r.x.pic}" onerror="this.remove()"><em>${mark(r)}</em>${r.fresh ? "<u>NEW</u>" : ""}
    <b>${esc(r.x.title)}</b><i>${esc(r.x.sub)}</i></div>`;
  const top = Object.entries(st.got).map(([k, n]) => [d.by.get(k), n]).filter(([x]) => x && (x.ego || x.rank === 3));
  $("#main").innerHTML = `<h1>Extraction</h1>
    <div class="sub">Pulls at the game's standard rates: 000 — 2.9% (half of them the featured Identity), E.G.O — 1.3%, 00 — 12.8%; the tenth of a ten is never less than a 00. Paid with the lunacy the games give: a finished game, a Daily, days in a row, a duel won, achievements.</div>
    ${!d.r[1].length || !d.r[3].length ? `<p class="muted">Nothing to pull yet: the game's files or a snapshot are missing.</p>` : `
    <div class="gmstart"><label class="gafeat">Featured <select id="gafeat">${d.new.map((x) => `<option value="${x.id}" ${x.id === st.feat ? "selected" : ""}>${esc(x.title)} — ${esc(x.sub)}</option>`).join("")}</select></label>
      <span class="grow"></span><span class="gmscore gawallet">LUNACY <b>${gmW.lunacy.toLocaleString("en")}</b></span><button class="toggle" id="gareset" title="Forget what was pulled — the lunacy stays">Start over</button>
      <button class="toggle gaone" id="ga1" ${gmW.lunacy < GM_PULL ? "disabled" : ""}>Extract × 1 · ${GM_PULL}</button><button class="gmbtn" id="ga10" ${gmW.lunacy < 10 * GM_PULL ? "disabled" : ""}>Extract × 10 · ${10 * GM_PULL}</button></div>
    ${gmW.lunacy < GM_PULL ? `<p class="muted">Out of lunacy — <a href="#/games">play a game</a>: today's Dailies pay the most.</p>` : ""}
    <div class="gastats gmscore"><span>PULLS <b>${st.pulls}</b></span><span>SPENT <b>${(st.pulls * GA_COST).toLocaleString("en")}</b></span>
      <span>000 <i>${st.n.r3}</i> ${pct(st.n.r3)}</span><span>E.G.O <i>${st.n.ego}</i> ${pct(st.n.ego)}</span><span>00 <b>${st.n.r2}</b> ${pct(st.n.r2)}</span><span>0 <b>${st.n.r1}</b></span>
      <span>SINCE THE LAST 000 <b>${st.since}</b></span><span>FEATURED ${st.featAt == null ? "<b>—</b>" : `AT PULL <i>${st.featAt}</i>`}</span>
      <span title="${GA_PITY} pulls on one banner buy its featured unit outright">IDEALITY <b>${st.pulls % GA_PITY} / ${GA_PITY}</b></span></div>
    <div class="gagrid">${ga.last.length ? ga.last.map(card).join("") : `<p class="muted">Press Extract.</p>`}</div>
    ${top.length ? `<div class="gmkick gatop">YOUR 000 AND E.G.O · ${top.length} OF ${d.r[3].length + d.egos.length}</div>
      <div class="gahave">${top.sort((a, b) => b[1] - a[1]).map(([x, n]) => `<span class="${x.ego ? "ego" : ""}" title="${esc(x.title + " — " + x.sub)}"><img src="${x.pic}" onerror="this.remove()">${n > 1 ? `<em>×${n}</em>` : ""}</span>`).join("")}</div>` : ""}`}`;
  if (!$("#ga10")) return;
  $("#ga1").onclick = () => gaPull(1);
  $("#ga10").onclick = () => gaPull(10);
  $("#gafeat").onchange = (e) => { st.feat = +e.target.value; st.featAt = null; gaKeep(); };
  $("#gareset").onclick = () => { ga.st = { ...gaNew(), feat: st.feat }; ga.last = []; gaKeep(); gaDraw(); };
}

// ------------------------------------------------------------------ Challenge roulette
const GD_KEEP = "games_dare", GD_SIZES = [5, 6, 7, 12];
// the rules a run is played by; {sin} / {status} / {n} are drawn with the rule
const GD_RULES = ["No E.G.O at all.", "Only the E.G.O each Sinner started with (ZAYIN).", "Win Rate button only — no skill picked by hand.", "No defense skills.",
  "Nobody dies: a Sinner down is the run lost.", "E.G.O of {sin} only.", "Never use Skill 3.", "Every turn, the first skill in each Sinner's slot — no swapping.",
  "A Sinner who gets staggered sits out the next fight.", "No {status} may be inflicted on purpose: skip the skills that do.", "Finish every fight in {n} turns or fewer.",
  "No resource hoarding: the first E.G.O you can afford must be used.", "Sanity stays below 0 — let them panic.", "The slowest Sinner picks first; the others take Win Rate.",
  "No retries: the first result of a fight stands.", "Uptie 3 skills only — nothing a later uptie added."];
const gd = { size: 6, how: "any", ego: true, ...(() => { try { return JSON.parse(localStorage.getItem(GD_KEEP) || "{}"); } catch { return {}; } })(), data: null, team: [], rule: "", around: "" };
const gdKeep = () => { try { localStorage.setItem(GD_KEEP, JSON.stringify({ size: gd.size, how: gd.how, ego: gd.ego })); } catch {} };

routes.gamedare = async () => {
  gmCrumb("dare");
  $("#main").innerHTML = `<h1>Challenge roulette</h1><div class="sub">Reading the game's files…</div>`;
  if (!gd.data) {
    const u = await api("/api/units").catch(() => null), kw = (u || {}).keywords || {};
    const ids = ((u || {}).ids || []).filter((x) => x.img && x.img.thumb).map((x) => ({ id: x.id, title: x.title, sinner: x.sinner, rank: x.rank, kw: (x.keywords || []).map((k) => kw[k] || k), pic: giThumb(x.img.thumb) }));
    const egos = ((u || {}).egos || []).filter((e) => e.img && e.img.thumb).map((e) => ({ id: e.id, title: e.name, sinner: e.sinner, grade: e.grade, pic: giThumb(e.img.thumb) }));
    gd.data = { ids, egos, sinners: (u || {}).sinners || [], sins: (u || {}).sins || [], kws: [...new Set(ids.flatMap((x) => x.kw))] };
  }
  if (!location.hash.startsWith("#/gamedare")) return;
  if (!gd.team.length && gd.data.ids.length) gdSpin();
  gdDraw();
};

const gdPick = (a) => a[Math.floor(Math.random() * a.length)];
// a Sinner's draw: an Identity (of the team's status when there is one and the Sinner has such) and an E.G.O
function gdSlot(sinner) {
  const d = gd.data, mine = d.ids.filter((x) => x.sinner === sinner && (gd.how !== "low" || x.rank < 3)), fit = mine.filter((x) => x.kw.includes(gd.around));
  return { sinner, id: gdPick(fit.length ? fit : mine), ego: gd.ego ? gdPick(d.egos.filter((e) => e.sinner === sinner)) : null };
}
function gdSpin() {
  const d = gd.data, order = d.sinners.map((_, i) => i + 1).map((s) => [Math.random(), s]).sort((a, b) => a[0] - b[0]).map((p) => p[1]);
  gd.around = gd.how === "kw" ? gdPick(d.kws) : "";
  gd.team = order.slice(0, gd.size).sort((a, b) => a - b).map(gdSlot).filter((s) => s.id);
  gd.rule = gdPick(GD_RULES).replace("{sin}", gdPick(d.sins.length ? d.sins : ["Wrath"])).replace("{status}", gdPick(d.kws.length ? d.kws : ["Bleed"])).replace("{n}", 3 + Math.floor(Math.random() * 4));
}

function gdDraw() {
  const d = gd.data, chip = (on, attr, text) => `<button class="toggle ${on ? "on" : ""}" ${attr}>${text}</button>`;
  $("#main").innerHTML = `<h1>Challenge roulette</h1>
    <div class="sub">A random team and a rule to play it by — for a Mirror Dungeon run or a fight you know too well. Click a Sinner to draw that one again.</div>
    ${!d.ids.length ? `<p class="muted">Nothing to draw from yet: the game's files or a snapshot are missing.</p>` : `
    <div class="dbrow">${GD_SIZES.map((n) => chip(gd.size === n, `data-n="${n}"`, n === 12 ? "All twelve" : n + " Sinners")).join("")}<span class="gap"></span>
      ${chip(gd.how === "any", 'data-how="any"', "Any Identity")}${chip(gd.how === "low", 'data-how="low"', "No 000")}${chip(gd.how === "kw", 'data-how="kw"', "Around one status")}<span class="gap"></span>
      ${chip(gd.ego, 'data-ego="1"', "With an E.G.O each")}</div>
    <div class="gdrule"><small>THE RULE${gd.around ? ` · A ${esc(gd.around).toUpperCase()} TEAM` : ""}</small><b>${esc(gd.rule)}</b><button class="toggle" id="gdrule">Another rule</button></div>
    <div class="gdteam">${gd.team.map((s, i) => `<button class="gdslot" data-i="${i}" title="Draw ${esc(d.sinners[s.sinner - 1])} again"><img src="${s.id.pic}" onerror="this.remove()">
      <small>${esc(d.sinners[s.sinner - 1])} · ${"0".repeat(s.id.rank)}</small><b>${esc(s.id.title)}</b>${s.ego ? `<i><img src="${s.ego.pic}" onerror="this.remove()">${esc(s.ego.title)} · ${s.ego.grade}</i>` : ""}</button>`).join("")}</div>
    <div class="gmstart"><button class="gmbtn" id="gdgo">Spin again</button><button class="toggle" id="gdcopy">Copy as text</button></div>`}`;
  const main = $("#main"), set = (sel, f) => main.querySelectorAll(sel).forEach((b) => b.onclick = () => { f(b); gdKeep(); gdSpin(); gdDraw(); });
  set("[data-n]", (b) => { gd.size = +b.dataset.n; });
  set("[data-how]", (b) => { gd.how = b.dataset.how; });
  set("[data-ego]", () => { gd.ego = !gd.ego; });
  main.querySelectorAll(".gdslot").forEach((b) => b.onclick = () => { gd.team[+b.dataset.i] = gdSlot(gd.team[+b.dataset.i].sinner); gdDraw(); });
  if ($("#gdgo")) $("#gdgo").onclick = () => { gdSpin(); gdDraw(); };
  if ($("#gdrule")) $("#gdrule").onclick = () => { const team = gd.team, around = gd.around; gdSpin(); gd.team = team; gd.around = around; gdDraw(); };
  if ($("#gdcopy")) $("#gdcopy").onclick = () => gmCopy(`Limbus Archive · Challenge roulette\nRule: ${gd.rule}\n` + gd.team.map((s) => `${d.sinners[s.sinner - 1]} — ${s.id.title}${s.ego ? ` + ${s.ego.title}` : ""}`).join("\n"));
}
