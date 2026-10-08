// Games → Spot the difference: an Identity's art twice, the right one with a few changes the page makes itself (a
// spot mirrored, its colours turned, or painted over with what lies next to it) — find them all before the time is up.
// Nothing new is asked of the game's files: the art is the one Guess the art and Jigsaw show.
// Shares the styles and the Daily challenge / duels of games.js / games7.js.
"use strict";

const GF_ROUNDS = 5, GF_WORTH = 2000, GF_MISS = 100, GF_W = 960, GF_H = 540, GF_SPOTS = [5, 7], GF_TIME = [75, 100];  // (Easy, Hard)
gz.diff = gz.diff || { best: {} };
const gf = { game: null, arts: null, timer: 0 };
window.addEventListener("hashchange", () => { if (!location.hash.startsWith("#/gamediff") && gf.game) gfLeave(); });
function gfLeave() {
  clearInterval(gf.timer);
  gf.game = null;
}

routes.gamediff = async (args = []) => {
  gfLeave();
  const auto = gmAuto("diff", args);
  gmCrumb("diff");
  $("#main").innerHTML = `<h1>Spot the difference</h1><div class="sub">Reading the game's files…</div>`;
  if (!gf.arts) {
    const u = await api("/api/units").catch(() => null);
    gf.arts = ((u || {}).ids || []).filter((x) => x.img && x.img.art && x.img.thumb).map((x) => ({ key: "i" + x.id, id: x.id, name: x.title + " " + x.sinnerName, title: x.title,
      sub: x.sinnerName, thumb: giThumb(x.img.thumb), pic: `/api/asset_img?path=${encodeURIComponent(x.img.art)}` }));
    if (!u) setTimeout(() => { gf.arts = null; });
  }
  if (!location.hash.startsWith("#/gamediff")) return;
  gfDrawStart();
  if (auto && gf.arts.length >= 8) gfNew(true);
};

function gfDrawStart() {
  const s = gz.diff, arts = gf.arts || [];
  $("#main").innerHTML = `<h1>Spot the difference</h1>
    <div class="sub">An Identity's art, twice — the one on the right has been changed in a few spots. Click every spot that differs, on either picture, before the time is up.</div>
    ${arts.length < 8 ? `<p class="muted">Nothing to ask yet: the game's files or a snapshot are missing.</p>` : `
    <div class="dbrow">${gzChip(!s.hard, 'data-h=""', `${GF_SPOTS[0]} differences`)}${gzChip(s.hard, 'data-h="1"', `Hard · ${GF_SPOTS[1]} smaller ones`)}</div>
    <div class="gmstart"><span class="gmscore">${arts.length} PICTURES · BEST <i>${s.best[s.hard ? "h" : "e"] || 0}</i></span>
      ${gmDailyBtn("diff")}<button class="gmbtn" id="gfgo">Start · ${GF_ROUNDS} rounds</button></div>
    <div class="muted small">A picture with every difference found is worth ${GF_WORTH}; a click on nothing costs ${GF_MISS}. ${GF_TIME[0]} seconds a picture (Hard: ${GF_TIME[1]}, points are doubled). A spot is mirrored, has its colours turned, or is painted over with what lies next to it.</div>`}`;
  document.querySelectorAll("#main [data-h]").forEach((b) => b.onclick = () => { s.hard = !!b.dataset.h; gzKeep(); gfDrawStart(); });
  if ($("#gfgo")) $("#gfgo").onclick = () => gfNew();
  if ($("#gmdaily")) $("#gmdaily").onclick = () => gmDailyDone("diff") == null ? gfNew(true) : gzDone();
}

function gfNew(daily) {
  gfLeave();
  const g = gf.game = gzNew("diff", daily, GF_ROUNDS, {});
  g.list = gzMix(gf.arts, g.rnd).slice(0, GF_ROUNDS + 4);
  gf.timer = setInterval(gfClock, 250);
  gfRound();
}

// The changes: `n` round spots that don't touch, each changed in one of three ways, with a soft edge. A change that
// can hardly be seen (a flat patch of sky mirrored) is not made: another spot is tried. → {spots, pic: the changed picture}
function gfMake(base, n, hard, rnd) {
  const W = base.width, H = base.height, src = base.data, out = new Uint8ClampedArray(src), spots = [];
  for (let k = 0; k < 600 && spots.length < n; k++) {
    const r = Math.round((hard ? 24 : 34) + rnd() * (hard ? 16 : 24)), x = Math.round(r + 10 + rnd() * (W - 2 * r - 20)), y = Math.round(r + 10 + rnd() * (H - 2 * r - 20));
    const how = Math.floor(rnd() * 3), side = rnd() < 0.5 ? -1 : 1, up = rnd() < 0.5 ? -1 : 1;
    if (spots.some((s) => Math.hypot(s.x - x, s.y - y) < s.r + r + 40)) continue;
    // (painted over with the spot two radii to the side, or above / below when that falls off the picture)
    let ox = Math.round(2.1 * r) * side, oy = 0;
    if (x + ox - r < 0 || x + ox + r >= W) ox = -ox;
    if (x + ox - r < 0 || x + ox + r >= W) { ox = 0; oy = Math.round(2.1 * r) * up; if (y + oy - r < 0 || y + oy + r >= H) oy = -oy; }
    const px = [];
    let sum = 0, cnt = 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const d = Math.hypot(dx, dy);
      if (d > r) continue;
      const i = ((y + dy) * W + x + dx) * 4, a = Math.min(1, (1 - d / r) * 3.5);
      let j = i, c;
      if (how === 0) j = ((y + dy) * W + x - dx) * 4;
      if (how === 2) j = (Math.max(0, Math.min(H - 1, y + dy + oy)) * W + x + dx + ox) * 4;
      c = how === 1 ? [src[i + 2], src[i], src[i + 1]] : [src[j], src[j + 1], src[j + 2]];
      const off = (Math.abs(c[0] - src[i]) + Math.abs(c[1] - src[i + 1]) + Math.abs(c[2] - src[i + 2])) / 3 * a;
      sum += off;
      cnt++;
      px.push(i, src[i] + (c[0] - src[i]) * a, src[i + 1] + (c[1] - src[i + 1]) * a, src[i + 2] + (c[2] - src[i + 2]) * a);
    }
    if (sum / cnt < (hard ? 16 : 22)) continue;
    for (let p = 0; p < px.length; p += 4) { out[px[p]] = px[p + 1]; out[px[p] + 1] = px[p + 2]; out[px[p] + 2] = px[p + 3]; }
    spots.push({ x, y, r, found: false });
  }
  return { spots, pic: new ImageData(out, W, H) };
}

function gfRound() {
  const g = gf.game;
  if (++g.round >= g.of) return gfResult();
  const ans = g.list[g.round], n = GF_SPOTS[g.hard ? 1 : 0];
  Object.assign(g, { ans, n, spots: null, base: null, pic: null, miss: 0, t0: 0, sec: 0, time: GF_TIME[g.hard ? 1 : 0], done: null, bad: null });
  const drop = () => {  // a picture the game's files don't give, or one too plain to change: another takes the round
    if (gf.game !== g || g.ans !== ans) return;
    if ((g.fails = (g.fails || 0) + 1) > 3 || g.list.length <= g.of) { gfLeave(); gfDrawStart(); return toast("The pictures could not be read from the game's files."); }
    g.list.splice(g.round--, 1);
    gfRound();
  };
  const im = new Image();
  im.onload = () => {
    if (gf.game !== g || g.ans !== ans) return;
    const cv = document.createElement("canvas"), x = cv.getContext("2d", { willReadFrequently: true });
    cv.width = GF_W;
    cv.height = GF_H;
    const k = Math.max(GF_W / im.width, GF_H / im.height), w = im.width * k, h = im.height * k;
    x.drawImage(im, (GF_W - w) / 2, (GF_H - h) / 2, w, h);
    let made;
    try { g.base = x.getImageData(0, 0, GF_W, GF_H); made = gfMake(g.base, n, g.hard, g.rnd); } catch { return drop(); }
    if (made.spots.length < n) return drop();
    Object.assign(g, made, { t0: performance.now() });
    gfDraw();
  };
  im.onerror = drop;
  im.src = ans.pic;
  gfDraw();
}

const gfSec = (g) => g.done ? g.sec : g.t0 ? (performance.now() - g.t0) / 1000 : 0;
const gfFound = (g) => g.spots.filter((s) => s.found).length;
const gfWorth = (g) => Math.max(0, Math.round((GF_WORTH * gfFound(g) / g.n - GF_MISS * g.miss) / 10) * 10) * (g.hard ? 2 : 1);
function gfClock() {
  const g = gf.game, el = $("#gftime");
  if (!g || g.done || !g.spots) return;
  const left = Math.max(0, g.time - gfSec(g));
  if (el) el.innerHTML = `FOUND <b>${gfFound(g)} / ${g.n}</b> · TIME <b>${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, "0")}</b>${g.miss ? ` · ${g.miss} CLICK${g.miss > 1 ? "S" : ""} ON NOTHING` : ""}`;
  if (left <= 0) gfEnd();
}

function gfDraw() {
  const g = gf.game, d = g.done, a = g.ans;
  $("#main").innerHTML = `<h1>Spot the difference</h1>${gzTop(g)}
    <div class="gfbox"><div class="gmkick" id="gftime">${d ? (d.ok ? `+${d.points} · ALL ${g.n} IN ${Math.round(g.sec)} S` : `+${d.points} · ${d.found} OF ${g.n} FOUND`) + (g.miss ? ` · ${g.miss} CLICK${g.miss > 1 ? "S" : ""} ON NOTHING` : "") : "…"}</div>
      <div class="gmq">${d ? esc(a.title) : "Find what differs"}</div>
      ${!g.spots ? `<p class="muted">Reading the picture…</p>` : `<div class="gfpair ${d ? "over" : ""}"><canvas id="gfl" width="${GF_W}" height="${GF_H}"></canvas><canvas id="gfr" width="${GF_W}" height="${GF_H}"></canvas></div>`}
      ${d ? `<div class="gmafter"><span>${esc(a.sub)} · <a href="#/db/${a.id}">Open in the database →</a></span><button class="gmbtn" id="gfnext">${g.round + 1 < g.of ? "Next" : "Result"}</button></div>`
      : `<div class="gnbtns"><button class="toggle" id="gfskip">Show me</button></div>`}</div>`;
  $("#gzquit").onclick = () => { gfLeave(); gfDrawStart(); };
  if ($("#gfskip")) $("#gfskip").onclick = () => gfEnd();
  if ($("#gfnext")) { $("#gfnext").onclick = gfRound; $("#gfnext").focus(); }
  gfPaint();
  gfClock();
  document.querySelectorAll(".gfpair canvas").forEach((cv) => cv.onclick = (e) => {
    if (g.done) return;
    const box = cv.getBoundingClientRect(), x = (e.clientX - box.left) / box.width * GF_W, y = (e.clientY - box.top) / box.height * GF_H;
    const hit = g.spots.find((s) => !s.found && Math.hypot(s.x - x, s.y - y) <= s.r + 14);
    if (hit) hit.found = true;
    else if (!g.spots.some((s) => Math.hypot(s.x - x, s.y - y) <= s.r + 14)) { g.miss++; g.bad = { x, y, at: performance.now() }; setTimeout(gfPaint, 450); }
    gfFound(g) === g.n ? gfEnd() : (gfPaint(), gfClock());
  });
}

// both pictures with the marks: found ones gold; after the round the missed ones red
function gfPaint() {
  const g = gf.game;
  if (!g || !g.spots || !$("#gfl")) return;
  for (const [id, pic] of [["gfl", g.base], ["gfr", g.pic]]) {
    const x = $("#" + id).getContext("2d");
    x.putImageData(pic, 0, 0);
    x.lineWidth = 4;
    for (const s of g.spots) {
      if (!s.found && !g.done) continue;
      x.strokeStyle = s.found ? "#e2b93b" : "#e0483a";
      x.beginPath();
      x.arc(s.x, s.y, s.r + 8, 0, Math.PI * 2);
      x.stroke();
    }
    if (g.bad && performance.now() - g.bad.at < 400 && !g.done) {
      x.strokeStyle = "#e0483a";
      x.beginPath();
      x.moveTo(g.bad.x - 12, g.bad.y - 12); x.lineTo(g.bad.x + 12, g.bad.y + 12);
      x.moveTo(g.bad.x + 12, g.bad.y - 12); x.lineTo(g.bad.x - 12, g.bad.y + 12);
      x.stroke();
    }
  }
}

function gfEnd() {
  const g = gf.game, found = gfFound(g);
  if (g.done) return;
  g.sec = gfSec(g);
  gzScore(g, found === g.n, gfWorth(g), { ans: g.ans, found, of: g.n, miss: g.miss, sec: Math.round(g.sec), clean: found === g.n && !g.miss });
  gfDraw();
}

function gfResult() {
  const g = gf.game;
  clearInterval(gf.timer);
  gzResult("diff", "Spot the difference", g, g.hard ? "h" : "e", ["", "PICTURE", "FOUND", "TIME", "ON NOTHING", "POINTS"],
    (r) => `<td><img class="gologpic odd" src="${r.ans.thumb}"></td><td>${esc(r.ans.title)}<i>${esc(r.ans.sub)}</i></td><td class="${r.ok ? (r.clean ? "ok" : "") : "bad"}">${r.found} / ${r.of}</td><td>${r.sec} s</td><td>${r.miss || ""}</td><td>${r.points}</td>`,
    () => gfNew(), () => { gf.game = null; gfDrawStart(); });
}
