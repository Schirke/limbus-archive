// Games → the two toys (no score, no Daily):
// Extraction — the game's own extraction with its banners, pictures and sounds, paid with the lunacy the games give;
// Challenge roulette — a random team and a rule to play it by.
"use strict";

// ------------------------------------------------------------------ Extraction
// The game's own extraction, screen by screen: the banners with their real pools and chances (/api/gacha), the orb
// in chains whose cracks light up by what was pulled, every 000 and E.G.O shown the game's way — the Sinner's emblem,
// the line said on getting it (with its voice), the art in three passes, the name plate — and the ten cards.
// Pictures and sounds are the game's (/api/gacha_ui, /api/quiz_audio). A pull costs the lunacy the games pay (gmW).
const GA_KEEP = "games_gacha", GA_COST = 130, GA_PITY = 200;
// the Sinners' colours, as the game writes their lines and name plates
const GA_SINNER = ["#d4e1e8", "#ffb1b4", "#ffef23", "#cf0000", "#3f58c8", "#5bffde", "#8a5bd0", "#ff9500", "#b3202a", "#9bb01a", "#4f8f5e", "#a8622a"];
const GA_GLOW = { r1: [150, 150, 160], r2: [235, 70, 45], r3: [255, 205, 60], ego: [80, 150, 255] };
const ga = { st: null, data: null, banner: null, run: 0, skip: null, voice: null, pics: {} };
const gaNew = () => ({ pulls: 0, n: { r3: 0, r2: 0, r1: 0, ego: 0 }, since: 0, got: {}, pity: {}, banner: 0, all: true });
const gaKeep = () => { try { localStorage.setItem(GA_KEEP, JSON.stringify(ga.st)); } catch {} };
const gaUi = (n) => "/api/gacha_ui?n=" + n;
const gaFull = (p) => `/api/asset_img?path=${encodeURIComponent(p)}`;
const gaU = (id) => ga.data.units.get(id);
const gaKind = (id) => gaU(id).ego ? "ego" : "r" + gaU(id).rank;
const gaWait = (ms) => new Promise((r) => setTimeout(r, ms));
function gaSnd(k, vol = 0.7) {
  const s = ga.data.snd[k];
  if (!s) return null;
  const a = new Audio("/api/quiz_audio?s=" + encodeURIComponent(s));
  a.volume = Math.min(1, vol * (typeof gmVol === "function" ? gmVol() / 0.6 : 1));
  a.play().catch(() => {});
  return a;
}
const gaPic = (n) => ga.pics[n] || (ga.pics[n] = Object.assign(new Image(), { src: gaUi(n) }));
function gaStop() {
  ga.run++;
  ga.skip = null;
  if (ga.voice) ga.voice.pause();
  document.body.classList.remove("quiz");
}
window.addEventListener("hashchange", () => { if (!location.hash.startsWith("#/gamegacha")) gaStop(); });
window.addEventListener("resize", () => $("#gestage") && gaFit());
// the screens are laid out for 1280 × 720 and scaled to the page's width
function gaFit() {
  const box = $("#gebox");
  box.style.width = "";
  const k = Math.max(Math.min(0.45, box.clientWidth / 1280), Math.min(1, box.clientWidth / 1280, (window.innerHeight - box.getBoundingClientRect().top - 70) / 720));  // (the whole screen in sight; never wider than the page — a phone)
  $("#gestage").style.transform = `scale(${k})`;
  box.style.width = 1280 * k + "px";
  box.style.height = 720 * k + "px";
}

routes.gamegacha = async (args = []) => {
  gaStop();
  gmCrumb("gacha");
  $("#main").innerHTML = `<h1>Extraction</h1><div class="sub">Reading the game's files…</div>`;
  if (!ga.st) { try { ga.st = { ...gaNew(), ...JSON.parse(localStorage.getItem(GA_KEEP) || "{}") }; } catch { ga.st = gaNew(); } ga.st.pity = ga.st.pity || {}; }
  if (!ga.data) {
    const [g, u, q] = await Promise.all([api("/api/gacha"), api("/api/units"), api("/api/quiz")].map((p) => p.catch(() => null)));
    const said = new Map(((q || {}).ids || []).filter((r) => r[2] === "Identity Acquisition").map((r) => [r[1], [r[0], r[3]]]));
    const units = new Map();
    for (const x of (u || {}).ids || []) if (x.img && x.img.thumb) units.set(x.id, { id: x.id, title: x.title, who: x.sinnerName, sinner: x.sinner, rank: x.rank, season: giSeason(u, x.season),
      tint: ((u.seasons || {})[x.season == null ? "8000" : x.season > 9100 && x.season < 9200 ? "9100" : String(x.season)] || {}).color || "",
      thumb: giThumb(x.img.thumb), art: gaFull(x.img.art2 || x.img.art), line: said.get(x.id) || ["", ""], pan: ((g || {}).pan || {})[x.id] || [] });
    for (const e of (u || {}).egos || []) if (e.img && e.img.thumb) units.set(e.id, { id: e.id, title: e.name, who: e.sinnerName, sinner: e.sinner, ego: e.grade, season: giSeason(u, e.season),
      tint: ((u.seasons || {})[e.season == null ? "8000" : e.season > 9100 && e.season < 9200 ? "9100" : String(e.season)] || {}).color || "",
      thumb: giThumb(e.img.thumb), art: gaFull(e.img.art), line: ((g || {}).lines || {})[e.id] || ["", ""], pan: [] });
    // (a banner names units by number: the ones this snapshot has no picture of are left out of its groups)
    const fit = (b) => ({ ...b, pick: b.pick.filter((i) => units.has(i)), groups: b.groups.map((gr) => ({ ...gr, ids: gr.ids.filter((i) => units.has(i)) })).filter((gr) => gr.ids.length) });
    const banners = ((g || {}).banners || []).map(fit).filter((b) => b.groups.length);
    ga.data = { banners, archive: ((g || {}).archive || []).map(fit).filter((b) => b.groups.length), units, snd: (g || {}).snd || {} };
  }
  if (!location.hash.startsWith("#/gamegacha")) return;
  // "#/gamegacha/<banner>" (Banner archive → Pull): an ended banner joins the tiles, and stays the picked one afterwards
  for (const id of [+args[0], ga.st.banner]) {
    const b = id && !ga.data.banners.some((x) => x.id === id) && ga.data.archive.find((x) => x.id === id);
    if (b) ga.data.banners.unshift(b);
  }
  if (+args[0] && ga.data.banners.some((x) => x.id === +args[0])) { ga.st.banner = +args[0]; gaKeep(); }
  ga.banner = ga.data.banners.find((b) => b.id === ga.st.banner) || ga.data.banners[0];
  if (!ga.banner) { $("#main").innerHTML = `<h1>Extraction</h1><p class="muted">Nothing to pull yet: the game's files or a snapshot are missing.</p>`; return; }
  $("#main").innerHTML = `<h1>Extraction</h1>
    <div class="sub">The game's own banners, pools and chances — and its own pictures, sounds and voices. A pull costs the lunacy the games pay: a finished game, a Daily, days in a row, a duel won, achievements.</div>
    <div id="gebox"><div id="gestage"><div id="gehome" class="gescr"></div><div id="georb" class="gescr"><canvas width="1280" height="720"></canvas></div>
      <div id="gerev" class="gescr"><img class="gelogo"><div class="gequote"></div><div class="gepic"></div><div class="gevig"></div><div class="gering"><i></i></div><div class="geflash"></div><div class="geplate"></div><div class="gesmall"></div></div>
      <div id="geres" class="gescr"><canvas width="1280" height="720"></canvas><div class="gegrid"></div><div class="gebtns"></div></div>
      <img id="geskip" src="${gaUi("MainUI_Gacha_4_Illust_Skip")}" title="Skip"></div></div>
    <div id="gebelow"></div>`;
  $("#geskip").onclick = (e) => { e.stopPropagation(); ga.skip && ga.skip(); };
  for (const n of ["FX_Tex_UI_Gacha_BGSpace_Normal", "FX_Tex_UI_Gacha_Chain2", "FX_Tex_UI_Gacha_Chain_Long1", "FX_Tex_UI_Gacha_Crack1_Main", "FX_Tex_UI_Gacha_Crack1_Space"]) gaPic(n);
  gaFit();
  gaHome();
};

const gaShow = (id) => { document.querySelectorAll("#gestage .gescr").forEach((d) => d.classList.toggle("on", d.id === id)); $("#geskip").hidden = id === "gehome" || id === "geres"; };

// one pull by the banner's own table: a group by its share of 10000 (the tenth of a ten has shares of its own; so
// has a banner whose every E.G.O is owned), then any unit of the group — an E.G.O never twice
function gaRoll(tenth) {
  const b = ga.banner, st = ga.st, ego = (g) => String(g.g).startsWith("EGO");
  const left = b.groups.some((g) => ego(g) && g.ids.some((i) => !st.got[i]));
  const share = (g) => { const o = g.occ, plain = tenth ? "TENTH" : "DEFAULT";
    return ego(g) ? (g.ids.some((i) => !st.got[i]) ? o[plain] ?? o.DEFAULT ?? 0 : 0) : o[(left ? "" : "COMPLETE_EGO_") + plain] ?? o[plain] ?? o.DEFAULT ?? 0; };
  let r = Math.random() * b.groups.reduce((s, g) => s + share(g), 0), group = b.groups.find((g) => share(g) > 0) || b.groups[0];
  for (const g of b.groups) { r -= share(g); if (r < 0) { group = g; break; } }
  const from = ego(group) ? group.ids.filter((i) => !st.got[i]) : group.ids, id = from[Math.floor(Math.random() * from.length)];
  return gaGot(id);
}
function gaGot(id) {
  const st = ga.st, kind = gaKind(id), fresh = !st.got[id];
  st.pulls++;
  st.n[kind]++;
  st.since = kind === "r3" ? 0 : st.since + 1;
  st.got[id] = (st.got[id] || 0) + 1;
  return { id, kind, fresh, feat: ga.banner.pick.includes(id) };
}

function gaHome() {
  gaShow("gehome");
  const b = ga.banner, st = ga.st, f = b.pick[0] && gaU(b.pick[0]), pity = st.pity[b.id] || 0;
  const rate = (g) => { const all = b.groups.reduce((s, x) => s + (x.occ.DEFAULT || 0), 0) || 1;
    return (100 * b.groups.filter((x) => x.g === g || x.g === g + "_pickup").reduce((s, x) => s + (x.occ.DEFAULT || 0), 0) / all).toFixed(1) + "%"; };
  const up = b.groups.filter((x) => String(x.g).endsWith("_pickup")).flatMap((x) => x.ids).map(gaU);
  // TEMPORARY (Vlad, 2026-10-08: "to test with, we'll take it out later"): the "+1300" button gives lunacy for nothing
  $("#gehome").innerHTML = `<div class="gewallet">${GM_LUNIMG}<b>${gmW.lunacy.toLocaleString("en")}</b><button id="getest" title="For testing: lunacy for nothing. To be removed.">+ 1300 · test</button></div>
    <div class="getiles">${ga.data.banners.map((x) => `<img src="${gaFull(x.tile)}" data-b="${x.id}" class="${x === b ? "on" : ""}" title="${x.pick.length ? x.pick.map((i) => esc(gaU(i).title + " — " + gaU(i).who)).join("\n") : "Standard Extraction"}">`).join("")}</div>
    <div class="geshow"><div class="geart" style="background-image:url('${f ? f.art : b.illust ? gaFull(b.illust) : ""}')"></div>${b.typo ? `<img class="getypo" src="${gaFull(b.typo)}">` : ""}
      <div class="geinfo">${b.end ? `<div class="geend">Until ${esc(b.end.slice(0, 10))}</div>` : ""}
        <div>000 <b>${rate("3")}</b> &nbsp; E.G.O <b>${rate("EGO")}</b> &nbsp; 00 <b>${rate("2")}</b></div><div>The tenth of a ten: 00 or better.</div>
        ${up.length ? `<div class="geup">${up.map((x) => `<img src="${x.thumb}" class="${x.ego ? "ego" : ""}" title="${esc(x.title + " — " + x.who)} · rate up">`).join("")}</div>` : ""}</div>
      <label class="geall"><input type="checkbox" id="geall" ${st.all ? "checked" : ""}> Show every 000 and E.G.O</label>
      ${f ? `<div class="gepity">IDEALITY <b>${pity}</b> / ${GA_PITY}${pity >= GA_PITY ? ` <button id="gex">Exchange for ${esc(f.title)}</button>` : ""}</div>` : ""}
      <div class="gepull"><button id="ge1" ${gmW.lunacy < GA_COST ? "disabled" : ""}>Extract 1<small>${GM_LUNIMG}${GA_COST}</small></button><button id="ge10" ${gmW.lunacy < 10 * GA_COST ? "disabled" : ""}>Extract 10<small>${GM_LUNIMG}${10 * GA_COST}</small></button></div>
      ${gmW.lunacy < GA_COST ? `<a class="gebroke" href="#/games">Out of lunacy — play a game: today's Dailies pay the most</a>` : ""}</div>`;
  document.querySelectorAll("#gehome [data-b]").forEach((el) => el.onclick = () => { ga.banner = ga.data.banners.find((x) => x.id === +el.dataset.b); st.banner = ga.banner.id; gaKeep(); gaSnd("gacha_whoosh", 0.4); gaHome(); });
  $("#getest").onclick = () => { gmW.lunacy += 10 * GA_COST; gmWKeep(); gaHome(); };
  $("#ge1").onclick = () => gaPull(1);
  $("#ge10").onclick = () => gaPull(10);
  $("#geall").onchange = (e) => { st.all = e.target.checked; gaKeep(); };
  if ($("#gex")) $("#gex").onclick = async () => { st.pity[b.id] -= GA_PITY; const got = gaGot(f.id); gaKeep(); const me = ++ga.run; await gaReveal(f.id, () => me === ga.run); if (me === ga.run) gaResult([got]); };
  gaBelow();
}

// under the stage: what the pulls came to, and the 000 and E.G.O they gave
function gaBelow() {
  const st = ga.st, pct = (v) => st.pulls ? (100 * v / st.pulls).toFixed(1) + "%" : "—";
  const top = Object.entries(st.got).map(([k, n]) => [gaU(+k), n]).filter(([x]) => x && (x.ego || x.rank === 3)).sort((a, b) => b[1] - a[1]);
  $("#gebelow").innerHTML = `<div class="gastats gmscore"><span>PULLS <b>${st.pulls}</b></span><span>SPENT <b>${(st.pulls * GA_COST).toLocaleString("en")}</b></span>
      <span>000 <i>${st.n.r3}</i> ${pct(st.n.r3)}</span><span>E.G.O <i>${st.n.ego}</i> ${pct(st.n.ego)}</span><span>00 <b>${st.n.r2}</b> ${pct(st.n.r2)}</span><span>0 <b>${st.n.r1}</b></span>
      <span>SINCE THE LAST 000 <b>${st.since}</b></span><button class="toggle" id="gareset" title="Forget what was pulled — the lunacy stays">Start over</button></div>
    ${top.length ? `<div class="gmkick gatop">YOUR 000 AND E.G.O · ${top.length}</div>
      <div class="gahave">${top.map(([x, n]) => `<span class="${x.ego ? "ego" : ""}" title="${esc(x.title + " — " + x.who)}"><img src="${x.thumb}" onerror="this.remove()">${n > 1 ? `<em>×${n}</em>` : ""}</span>`).join("")}</div>` : ""}`;
  $("#gareset").onclick = () => { ga.st = { ...gaNew(), banner: st.banner, all: st.all }; gaKeep(); gaHome(); };
}

async function gaPull(n) {
  if (gmW.lunacy < n * GA_COST) return;
  const me = ++ga.run, alive = () => me === ga.run, st = ga.st;
  gmW.lunacy -= n * GA_COST;
  st.pity[ga.banner.id] = (st.pity[ga.banner.id] || 0) + n;
  const got = Array.from({ length: n }, (_, i) => gaRoll(n === 10 && i === 9));
  gaKeep();
  Object.assign(gmW, { pulls: gmW.pulls + n, r3: gmW.r3 + got.filter((r) => r.kind === "r3").length, ego: gmW.ego + got.filter((r) => r.kind === "ego").length });
  gmWKeep();
  if (typeof muAudio !== "undefined") muAudio.pause();
  document.body.classList.add("quiz");  // (the corner player would play over the voices)
  gaSnd("sfx_ticket_use");
  await gaOrb(got, alive);
  if (st.all) for (const g of got) { if (!alive()) return; if (g.kind === "r3" || g.kind === "ego") await gaReveal(g.id, alive); }
  if (!alive()) return;
  gmPay([], [gmW.r3 ? "r3" : "", got.some((r) => r.feat && r.kind === "r3") ? "feat" : "", gmW.ego >= 10 ? "ego10" : "", gmW.pulls >= 100 ? "pulls100" : ""].filter(Boolean));
  gaResult(got);
}

// ---- the orb in chains: a chain runs out to a crack for every pull, and each crack lights up in its unit's colour
function gaSky(ctx, t, hot) {
  const sky = gaPic("FX_Tex_UI_Gacha_BGSpace_Normal");
  ctx.fillStyle = "#050303";
  ctx.fillRect(0, 0, 1280, 720);
  if (sky.complete && sky.naturalWidth) { const x = -((t * 9) % 1024); ctx.globalAlpha = hot ? 0.95 : 0.8; 
    for (let k = 0; k < 3; k++) { ctx.save(); ctx.translate(x + k * 1024 + (k % 2 ? 1024 : 0), -150); ctx.scale(k % 2 ? -1 : 1, 1); ctx.drawImage(sky, 0, 0, 1024, 1024); ctx.restore(); }  // (every other one mirrored: no seam)
    ctx.globalAlpha = 1; }
  for (let i = 0; i < (hot ? 170 : 90); i++) {  // sparks drifting up
    const s = i * 97.13, x = (Math.sin(s) * 0.5 + 0.5) * 1280 + Math.sin(t * 0.4 + s) * 30, y = (((Math.cos(s * 1.7) * 0.5 + 0.5) * 720 - t * (12 + (i % 7) * 6)) % 720 + 720) % 720;
    ctx.fillStyle = `rgba(255,${130 + (i % 5) * 22},40,${0.25 + 0.5 * Math.abs(Math.sin(t * 2 + s))})`;
    ctx.beginPath(); ctx.arc(x, y, 1 + (i % 4) * (hot ? 1.3 : 0.7), 0, 7); ctx.fill();
  }
}
// a cell of the cracks' sheet (2 × 2, white on black) in a colour, ready to be added to the picture
function gaCrack(sheet, cell, rgb) {
  const key = sheet + cell + rgb, im = gaPic(sheet);
  if (ga.pics[key]) return ga.pics[key];
  if (!im.complete || !im.naturalWidth) return null;
  const c = document.createElement("canvas"), x = c.getContext("2d"), w = im.naturalWidth / 2;
  c.width = c.height = w;
  x.drawImage(im, (cell % 2) * w, Math.floor(cell / 2) * w, w, w, 0, 0, w, w);
  x.globalCompositeOperation = "multiply";
  x.fillStyle = `rgb(${rgb})`;
  x.fillRect(0, 0, w, w);
  return ga.pics[key] = c;
}
function gaOrb(got, alive) {
  return new Promise((done) => {
    gaShow("georb");
    const ctx = $("#georb canvas").getContext("2d"), t0 = performance.now(), n = got.length, cx = 640, cy = 360;
    const pods = got.map((g, i) => { const a = -Math.PI / 2 + (i / n) * Math.PI * 2 + 0.3, far = n === 1 ? 0 : 1;
      return { x: cx + Math.cos(a) * 440 * far * (0.8 + 0.2 * Math.sin(i * 2.3)), y: cy + Math.sin(a) * 255 * far * (0.84 + 0.16 * Math.cos(i * 1.7)) - (n === 1 ? 215 : 0), kind: g.kind, lit: 0, cell: i % 4, turn: i * 1.3 }; });
    let ended = false, burst = 0;
    const end = () => { if (ended) return; ended = true; ga.skip = null; done(); };
    const on = () => alive() && !ended;
    ga.skip = end;
    gaSnd("027");
    setTimeout(() => on() && gaSnd("028"), 800);
    pods.forEach((p, i) => setTimeout(() => { if (!on()) return; p.lit = performance.now(); gaSnd(p.kind === "r1" ? "029" : p.kind === "r2" ? "030" : p.kind === "r3" ? "032" : "031", p.kind === "r1" ? 0.25 : 0.6); }, 1700 + i * 260));
    setTimeout(() => { if (on()) { burst = performance.now(); gaSnd("026"); gaSnd("035", 0.6); } }, 1700 + n * 260 + 1000);
    const chain = gaPic("FX_Tex_UI_Gacha_Chain_Long1"), ball = gaPic("FX_Tex_UI_Gacha_Chain2");
    const draw = () => {
      if (!on()) return;
      const now = performance.now(), t = (now - t0) / 1000, grow = Math.min(1, Math.max(0, (t - 0.8) / 0.8));
      gaSky(ctx, t, false);
      for (const p of pods) {
        const dx = p.x - cx, dy = p.y - cy, len = Math.hypot(dx, dy) * grow;
        if (len > 4 && chain.complete && chain.naturalWidth) { ctx.save(); ctx.translate(cx, cy); ctx.rotate(Math.atan2(dy, dx)); ctx.drawImage(chain, 0, 0, Math.min(1024, len * 1.6), 32, 0, -9, len, 18); ctx.restore(); }
        if (grow < 1) continue;
        const lit = p.lit ? Math.min(1, (now - p.lit) / 350) : 0, big = p.kind === "r3" || p.kind === "ego" ? 1.45 : p.kind === "r2" ? 1.15 : 1, rgb = lit ? GA_GLOW[p.kind] : [120, 120, 130];
        const size = 150 * big * (1 + 0.04 * Math.sin(t * 4 + p.turn));
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.turn); ctx.globalCompositeOperation = "lighter";
        if (lit && p.kind !== "r1") { const gl = ctx.createRadialGradient(0, 0, 4, 0, 0, 95 * big); gl.addColorStop(0, `rgba(${rgb},${0.85 * lit})`); gl.addColorStop(1, `rgba(${rgb},0)`); ctx.fillStyle = gl; ctx.fillRect(-140, -140, 280, 280);
          const hole = gaCrack("FX_Tex_UI_Gacha_Crack1_Space", p.cell, rgb); if (hole) { ctx.globalAlpha = lit; ctx.drawImage(hole, -size / 2, -size / 2, size, size); ctx.globalAlpha = 1; } }
        const crack = gaCrack("FX_Tex_UI_Gacha_Crack1_Main", p.cell, rgb);
        if (crack) ctx.drawImage(crack, -size / 2, -size / 2, size, size);
        ctx.restore();
      }
      const R = 96 * Math.min(1, t / 0.6) * (1 + 0.025 * Math.sin(t * 5));
      const og = ctx.createRadialGradient(cx, cy, 6, cx, cy, R * 1.9); og.addColorStop(0, "rgba(255,190,70,.75)"); og.addColorStop(1, "rgba(255,150,30,0)");
      ctx.fillStyle = og; ctx.fillRect(cx - 200, cy - 200, 400, 400);
      if (ball.complete && ball.naturalWidth) { ctx.save(); ctx.translate(cx, cy); ctx.rotate(t * 0.25); ctx.globalCompositeOperation = "lighter"; ctx.drawImage(ball, -R, -R, R * 2, R * 2); ctx.drawImage(ball, -R, -R, R * 2, R * 2); ctx.restore(); }
      if (burst) { const k = (now - burst) / 600; ctx.fillStyle = `rgba(255,255,255,${Math.min(1, k)})`; ctx.fillRect(0, 0, 1280, 720); if (k >= 1.15) return end(); }
      requestAnimationFrame(draw);
    };
    draw();
  });
}

// ---- one 000 / E.G.O: the Sinner's emblem, its line, the art in three passes, the flash, the name plate
function gaReveal(id, alive) {
  return new Promise(async (done) => {
    const u = gaU(id), el = $("#gerev"), part = (c) => el.querySelector(c);
    const logo = part(".gelogo"), q = part(".gequote"), pic = part(".gepic"), vig = part(".gevig"), ring = part(".gering"), fl = part(".geflash"), pl = part(".geplate"), sm = part(".gesmall");
    let ended = false, last = false, next = null;
    const end = () => { if (ended) return; ended = true; ga.skip = null; el.onclick = null; if (ga.voice) ga.voice.pause(); done(); };
    const on = () => alive() && !ended, tap = (ms) => new Promise((r) => { next = r; setTimeout(r, ms); });
    for (const x of [logo, q, pic, vig, ring, pl, sm]) x.classList.remove("on");
    pic.style.cssText = "";
    fl.style.cssText = "";
    gaShow("gerev");
    ga.skip = end;
    el.onclick = () => last ? end() : next && next();
    const col = u.ego ? "#5b8cff" : GA_SINNER[u.sinner - 1] || "#fff", flash = async (snd, ms, shade = "#fff") => {
      fl.style.transition = "none"; fl.style.background = shade; fl.style.opacity = 1; gaSnd(snd, 0.6); await gaWait(70); fl.style.transition = `opacity ${ms}ms`; fl.style.opacity = 0; };
    await new Promise((r) => { const im = new Image(); im.onload = im.onerror = r; im.src = u.art; setTimeout(r, 2500); });  // (the art is there before its passes)
    if (!on()) return;
    logo.src = gaUi("MainUI_Logoicon_filter_" + (u.sinner - 1));
    logo.classList.add("on");
    gaSnd("039", 0.6);
    await tap(1300); if (!on()) return;
    logo.classList.remove("on");
    await gaWait(350); if (!on()) return;
    q.style.color = sm.style.color = col;
    q.textContent = u.line[1];
    if (u.line[1]) { q.classList.add("on"); gaSnd("040", 0.5); }
    if (u.line[0]) { ga.voice = new Audio("/api/quiz_audio?s=" + encodeURIComponent(u.line[0])); ga.voice.volume = typeof gmVol === "function" ? Math.min(1, gmVol() / 0.6) : 1; ga.voice.play().catch(() => {}); }
    await tap(u.line[1] ? Math.min(7000, 2000 + u.line[1].length * 30) : 500); if (!on()) return;
    q.classList.remove("on");
    await flash(u.ego ? "037" : "035", 700, u.ego ? "#777" : "#fff");
    gaSnd("041", 0.6);
    pic.style.backgroundImage = `url('${u.art}')`;
    const pans = u.pan.length ? u.pan : u.ego ? [[0, -0.12, "UP"], [0.08, 0.1, "DOWN"]] : [[-0.15, -0.22, "LEFT"], [0.2, 0.02, "UP"], [-0.1, 0.2, "RIGHT"]];
    for (const [x, y, dir] of pans) {
      const d = { LEFT: [-5, 0], RIGHT: [5, 0], UP: [0, -5], DOWN: [0, 5] }[dir] || [0, 0], bx = -x * 100, by = y * 100;
      pic.style.transition = "none";
      pic.style.transform = `scale(2.3) translate(${bx - d[0]}%, ${by - d[1]}%)`;
      pic.classList.add("on");
      await gaWait(30);
      gaSnd("034", 0.35);
      pic.style.transition = "transform 1.2s linear";
      pic.style.transform = `scale(2.3) translate(${bx + d[0]}%, ${by + d[1]}%)`;
      await tap(1200); if (!on()) return;
    }
    await flash("036", 900);
    if (u.ego) {  // an E.G.O ends as its art in the ring
      pic.classList.remove("on");
      ring.style.backgroundImage = `url('${u.art}')`;
      ring.classList.add("on");
    } else {
      pic.style.transition = "none"; pic.style.transform = "scale(1.07)";
      await gaWait(40);
      pic.style.transition = "transform 7s ease-out"; pic.style.transform = "scale(1)";
      vig.classList.add("on");
    }
    await gaWait(550); if (!on()) return;
    const dark = /^#(d|f|5bf|9bb)/i.test(col) && !u.ego;
    pl.innerHTML = `${u.season && u.season !== "Standard" ? `<span class="gese" style="background:${u.tint || "#888"}">${esc(u.season)}</span>` : ""}<div class="geti">${esc(u.title)}</div>
      <span class="gewho" style="background:${u.ego ? "#2456d6" : col};color:${dark ? "#161214" : "#fff"}">${esc(u.who)}</span><img class="gerk ${u.ego ? "ego" : ""}" src="${gaUi(u.ego ? `MainUI_Gacha_4_Illust_E${["ZAYIN", "TETH", "HE", "WAW", "ALEPH"].indexOf(u.ego) + 1}_${u.ego}` : "MainUI_Gacha_4_Illust_Rank_" + u.rank)}">`;
    pl.classList.toggle("ego", !!u.ego);
    pl.classList.add("on");
    gaSnd("042", 0.7);
    if (u.line[1]) { sm.textContent = u.line[1]; sm.classList.add("on"); }
    last = true;
    setTimeout(() => on() && end(), 12000);
  });
}

// ---- the cards of what was pulled
function gaResult(got) {
  gaShow("geres");
  document.body.classList.remove("quiz");
  gaSnd("043", 0.7);
  gaSnd("gacha_result", 0.6);
  const ctx = $("#geres canvas").getContext("2d"), t0 = performance.now(), me = ga.run;
  const draw = () => { if (me !== ga.run || !$("#geres") || !$("#geres").classList.contains("on")) return; gaSky(ctx, (performance.now() - t0) / 1000, true); requestAnimationFrame(draw); };
  draw();
  const card = (g, i) => { const u = gaU(g.id);
    return `<div class="gecard ${g.kind}" data-id="${g.id}" style="animation-delay:${i * 70}ms" title="${esc(u.title + " — " + u.who)}"><i style="background-image:url('${u.thumb}')"></i>
      <img class="gefr" src="${gaUi(u.ego ? "MainUI_Gacha_4_Card_EgoRing" : "MainUI_Gacha_4_Card_Foreground_" + u.rank)}">${u.ego ? `<em>${u.ego}</em>` : `<img class="gern" src="${gaUi("MainUI_Gacha_3_Rank" + u.rank)}">`}
      ${g.fresh ? "<u>NEW!</u>" : ""}<span>${esc(u.title)}</span></div>`; };
  $("#geres .gegrid").innerHTML = got.map(card).join("");
  $("#geres .gegrid").classList.toggle("one", got.length === 1);
  $("#geres .gebtns").innerHTML = `<button id="geback">Return</button><button id="geagain" ${gmW.lunacy < GA_COST * got.length ? "disabled" : ""}>Extract again<small>${GM_LUNIMG}${GA_COST * got.length} · you have ${gmW.lunacy.toLocaleString("en")}</small></button>`;
  $("#geback").onclick = () => { ga.run++; gaHome(); };
  $("#geagain").onclick = () => gaPull(got.length === 10 ? 10 : 1);
  document.querySelectorAll(".gecard.r3, .gecard.ego").forEach((c) => c.onclick = async () => { const run = ++ga.run; document.body.classList.add("quiz"); await gaReveal(+c.dataset.id, () => run === ga.run);
    if (run === ga.run) { document.body.classList.remove("quiz"); gaShow("geres"); const again = ga.run; (function d() { if (again !== ga.run || !$("#geres")) return; gaSky(ctx, (performance.now() - t0) / 1000, true); requestAnimationFrame(d); })(); } });
  gaBelow();
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
