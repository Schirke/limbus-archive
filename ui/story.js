// Database → Story: every story the game's Story Theater lists, read like in the game (limbusdm/story.py). The list has the
// Main Story's Cantos, Detour Tales (Intervallos, Walpurgis Nights, Dante's notes) and the Identity Archive; the reader plays
// a story file scene by scene: background, speakers' standing pictures, voice, sounds and music. Hold the mouse on the scene
// to read faster (x2 after 1.5 s, then x4, x6, x12).
"use strict";

const st = { idx: null, tab: "main", sel: {}, ep: null, list: [], i: 0 };
const stSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const stGet = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const ST_TABS = [["main", "Main Story"], ["ident", "Identity Archive"]];
const ST_PART = { Before: "Pre-battle", Inter: "Interlude", After: "Post-battle" };
const stImg = (p) => `/api/asset_thumb?path=${encodeURIComponent(p)}`;
const stFull = (p, m = 1920) => `/api/story_pic?path=${encodeURIComponent(p)}&m=${m}`;

routes.story = async (args) => {
  let [a, b] = args;
  if (!$("#stpage")) {
    $("#main").innerHTML = `<div id="stpage"><div class="muted">Loading…</div></div>`;
  }
  if (!st.idx) {
    try { st.idx = await api("/api/story"); }
    catch (e) { $("#stpage").innerHTML = `<div class="card">Could not read the story: ${esc(e.message)}</div>`; return; }
  }
  if (a === "read") { stRead(b); return; }
  if (a === "interv" || a === "mini" || a === "other") a = "main";
  if (a === "main" || a === "ident") { st.tab = a; if (b) st.sel[a] = b; }
  stDraw();
};

function stChapters() {
  const idx = st.idx;
  if (st.tab === "main") return [...idx.main, ...idx.other];  // Cantos, then Intervallo, then the mini stories
  return idx.ident.map((s) => ({ id: String(s.sinner), label: s.name, sinner: s.sinner, items: s.items }));
}

function stDraw() {
  const list = stChapters();
  const sel = String(st.sel[st.tab] ?? list[0]?.id);
  const cur = list.find((c) => String(c.id) === sel) || list[0];
  const keep = $(".stcantos")?.scrollTop || 0, keepP = $(".stpanel")?.scrollTop || 0;
  let cards = "", last = "";
  for (const c of list) {
    const on = cur && String(c.id) === String(cur.id);
    if (st.tab === "ident") {
      cards += `<button class="stcanto ident" data-id="${c.id}" aria-expanded="${on}"><img class="sinico" src="/api/ui_icon?k=sinner_${c.sinner}" alt=""><span class="name">${esc(c.label)}</span></button>`;
      continue;
    }
    const tag = c.kind === "mini" ? "Mini" : c.label;
    const name = c.kind === "mini" ? (c.title || c.label) : (c.title || c.label);
    const card = `<button class="stcanto" data-id="${c.id}" aria-expanded="${on}"><span class="art"${c.pic ? ` style="background-image:url('${stImg(c.pic)}')"` : ""}></span>
      <span class="tag">${esc(tag)}</span>${c.time ? `<span class="code">${esc(c.time)}</span>` : ""}<span class="name">${esc(name)}</span><span class="count">${c.eps.length} episodes</span></button>`;
    const grp = st.tab === "main" && c.kind !== "main" ? (c.kind === "intervallo" ? "Intervallo" : "Mini stories") : "";
    if (grp && grp !== last) { cards += `<div class="stgroup">${grp}</div>`; last = grp; }
    cards += card;
  }
  const sub = (cur) => [cur.company, cur.area, cur.time, `${cur.eps.length} episodes`].filter(Boolean).map(esc).join(" · ");
  const head = !cur ? "" : st.tab === "ident" ? `<h2>${esc(cur.label)}</h2><div class="stsub">${cur.items.length} Identity stories</div>`
    : `<h2>${esc(cur.kind === "mini" ? (cur.title || cur.label) : cur.label + (cur.title ? ": " + cur.title : ""))}</h2>
       <div class="stsub">${sub(cur)}</div>${cur.desc ? `<div class="stdesc">${esc(cur.desc)}</div>` : ""}`;
  const items = !cur ? [] : st.tab === "ident"
    ? cur.items.map((it, k) => ({ n: String(k + 1), title: it.name, parts: [[it.story, ""]], icon: `/api/char_icon?id=${it.id}` }))
    : cur.eps;
  const nodes = items.map((e, k) => `<li class="epnode${st.last && e.parts.some((p) => p[0] === st.last) ? " last" : ""}">
      <span class="stdot">${esc(String(e.n).split("-").pop())}</span>
      <div class="strow" role="button" tabindex="0" data-f="${esc(e.parts[0][0])}"><span><span class="stid">${esc(e.n)}</span><br><span class="stt">${esc(e.title)}</span></span>
        <span class="stparts">${e.parts.map((p) => `<button data-f="${esc(p[0])}" class="${p[1] === "Before" ? "pre" : p[1] === "After" ? "post" : ""}">${ST_PART[p[1]] || "Read"}</button>`).join("")}</span></div></li>`).join("");
  $("#stpage").innerHTML = `<div class="sttabs" role="tablist">${ST_TABS.map(([k, n]) => `<button class="sttab" role="tab" data-tab="${k}" aria-selected="${k === st.tab}">${n}</button>`).join("")}
</div>
    <div class="stmain"><div class="stcantos">${cards}</div><section class="stpanel">${head}<ol class="epnodes">${nodes}</ol></section></div>`;
  $(".stcantos").scrollTop = keep; $(".stpanel").scrollTop = cur && String(cur.id) === st.drawn ? keepP : 0;
  st.drawn = cur && String(cur.id);
  document.querySelectorAll(".sttab").forEach((b) => b.onclick = () => { location.hash = "#/story/" + b.dataset.tab; });
  document.querySelectorAll(".stcanto").forEach((b) => b.onclick = () => { st.sel[st.tab] = b.dataset.id; location.hash = `#/story/${st.tab}/${b.dataset.id}`; });
  document.querySelectorAll(".epnode .strow").forEach((r) => {
    r.onclick = (e) => { const f = e.target.closest("button")?.dataset.f || r.dataset.f; stOpen(f, cur); };
    r.onkeydown = (e) => { if (e.key === "Enter") stOpen(r.dataset.f, cur); };
  });
}

// the playlist of a chapter: every file of its episodes in order, so a story goes on into the next one
function stOpen(file, chapter) {
  st.back = location.hash;
  st.chapter = chapter;
  location.hash = "#/story/read/" + encodeURIComponent(file);
}
function stPlaylist(file) {
  const found = [];
  const eps = (c) => (c.eps || c.items?.map((it) => ({ title: it.name, n: "", parts: [[it.story, ""]] })) || []);
  const chapters = [...st.idx.main, ...st.idx.other, ...st.idx.ident.map((s) => ({ label: s.name, items: s.items }))];
  const own = st.chapter && eps(st.chapter).some((e) => e.parts.some((p) => p[0] === file)) ? st.chapter : chapters.find((c) => eps(c).some((e) => e.parts.some((p) => p[0] === file)));
  for (const e of own ? eps(own) : []) for (const p of e.parts) found.push({ id: p[0], title: e.title, n: e.n, detail: p[1] });
  return { list: found.length ? found : [{ id: file, title: file, n: "", detail: "" }], title: own ? (own.title || own.label) : "" };
}

// ------------------------------------------------------------------ the reader
const R = { el: null, ep: null, i: 0, rate: 1, hold: false, held: 0, auto: false, voiceOn: true, typed: 0, total: 0, spans: [], states: [], done: false,
  wait: 0, voice: null, voiceEnd: true, bgm: null, bgmName: "", media: new Map(), layouts: new Map(), chars: new Map(), log: [], timer: 0, open: false, ui: stGet("story.ui", "") };
const R_STEPS = [[0, 1], [1500, 2], [2100, 4], [2800, 6], [3600, 12]];
const R_CPS = 52;  // letters a second at x1

function rEnsure() {
  if (R.el) return;
  const el = document.createElement("div");
  el.id = "streader";
  el.innerHTML = `<div class="rstage" id="rstage"><div class="rbgimg" id="rbg"></div><div class="rchars" id="rchars"></div><div class="rcgimg" id="rcg"></div><div class="rfade" id="rfade"></div>
    <div class="rbar"><i id="rbar"></i></div><div class="rinfo" id="rinfo"></div>
    <div class="rhud"><button type="button" id="rauto">Auto</button><button type="button" id="rmenubtn">Menu</button></div>
    <div class="rmenu" id="rmenu"><button data-a="log">Log</button><button data-a="voice"></button><button data-a="ui"></button><button data-a="skip">Skip to end of this story</button><button data-a="exit">Exit to list</button></div>
    <div class="rbox" id="rbox"><div class="rwho"><b id="rwho"></b><i id="rrole"></i><button type="button" class="rrep" id="rrep" title="Replay voice">▶ voice</button></div><div class="rtxt" id="rtxt"></div><div class="rnext">▼</div></div>
    <div class="rspeed" id="rspeed"></div><div class="rvid" id="rvid"></div>
    <div class="rlog" id="rlog"><div class="rlogh"><b>Log</b><button type="button" id="rlogx">Close</button></div><div class="rlogb" id="rlogb"></div></div>
    <div class="rend" id="rend"></div></div>`;
  document.body.append(el);
  R.el = el;
  R.fit = () => { const s = $("#rstage"); if (s && s.clientWidth) el.style.setProperty("--u", (s.clientWidth / 1920).toFixed(4)); };
  new ResizeObserver(R.fit).observe(el);
  window.addEventListener("resize", R.fit);
  const stage = $("#rstage");
  let t0 = 0, hz = 0, down = false;
  const skip = (e) => e.target.closest(".rhud, .rmenu, .rlog, .rend, .rrep, .rvid");
  stage.addEventListener("pointerdown", (e) => {
    if (skip(e)) return;
    $("#rmenu").classList.remove("on");
    t0 = performance.now(); down = true;
    hz = setInterval(() => {
      const dt = performance.now() - t0;
      let r = 1;
      for (const s of R_STEPS) if (dt >= s[0]) r = s[1];
      rRate(r, dt > 400);
    }, 60);
  });
  const up = () => {
    if (!down) return;
    down = false; clearInterval(hz);
    const dt = performance.now() - t0;
    rRate(1, false);
    if (dt < 400) rAdvance();
  };
  stage.addEventListener("pointerup", up);
  stage.addEventListener("pointerleave", up);
  $("#rauto").onclick = (e) => { e.stopPropagation(); R.auto = !R.auto; e.currentTarget.classList.toggle("on", R.auto); };
  $("#rmenubtn").onclick = (e) => { e.stopPropagation(); rMenuSync(); $("#rmenu").classList.toggle("on"); };
  $("#rrep").onclick = (e) => { e.stopPropagation(); rVoice(R.i); };
  $("#rlogx").onclick = (e) => { e.stopPropagation(); $("#rlog").classList.remove("on"); };
  $("#rmenu").onclick = (e) => {
    e.stopPropagation();
    const a = e.target.dataset.a;
    if (!a) return;
    if (a === "voice") { R.voiceOn = !R.voiceOn; if (!R.voiceOn) R.voice?.pause(); else rVoice(R.i); rMenuSync(); return; }
    if (a === "ui") { R.ui = R.ui ? "" : "alt"; stSet("story.ui", R.ui); R.el.classList.toggle("alt", !!R.ui); rMenuSync(); return; }
    $("#rmenu").classList.remove("on");
    if (a === "log") rLogShow();
    if (a === "skip") rShow(R.ep.lines.length - 1);
    if (a === "exit") rExit();
  };
  document.addEventListener("keydown", (e) => {
    if (!R.open) return;
    if (e.key === " " || e.key === "Enter" || e.key === "ArrowRight") { e.preventDefault(); rAdvance(); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); rShow(Math.max(0, R.i - 1)); }
    else if (e.key === "Escape") { e.stopPropagation(); if ($("#rlog").classList.contains("on") || $("#rmenu").classList.contains("on")) { $("#rlog").classList.remove("on"); $("#rmenu").classList.remove("on"); } else rExit(); }
    else if (e.key === "l" || e.key === "L") rLogShow();
    else if (e.key === "a" || e.key === "A") $("#rauto").click();
  }, true);
  R.timer = setInterval(rTick, 30);
}
function rMenuSync() {
  const m = $("#rmenu");
  m.querySelector('[data-a=voice]').textContent = "Voice: " + (R.voiceOn ? "on" : "off");
  m.querySelector('[data-a=ui]').textContent = "Reader look: " + (R.ui ? "Alternative" : "Game");
}
function rRate(r, show) {
  R.rate = r;
  const s = $("#rspeed");
  s.textContent = "x" + r; s.classList.toggle("on", show && r > 1);
  R.hold = r > 1;
  if (R.voice) { R.voice.playbackRate = Math.min(r, 4); if (r > 4) R.voice.pause(); }
}

async function stRead(file) {
  rEnsure();
  const pl = stPlaylist(file);
  st.list = pl.list; st.last = file;
  R.el.classList.toggle("alt", !!R.ui);
  R.el.classList.add("on"); R.open = true; R.fit();
  R.log = []; R.auto = false; $("#rauto").classList.remove("on");
  await rLoad(file, 0);
}
async function rLoad(file, at) {
  R.file = file;
  $("#rtxt").textContent = "";
  $("#rwho").textContent = ""; $("#rrole").textContent = "";
  let ep;
  try { ep = await api(`/api/story_ep?id=${encodeURIComponent(file)}`); }
  catch (e) { $("#rtxt").textContent = "Could not read this story: " + e.message; return; }
  R.ep = ep;
  R.states = rFold(ep.lines);
  const lo = st.list.findIndex((x) => x.id === file);
  R.meta = st.list[lo] || { title: file, n: "" };
  R.pos = lo;
  // the layered pictures this story uses: asked at once, drawn when they are there
  Object.values(ep.models).forEach((m) => { if (m.psb) rLayout(m.psb); });
  $("#rend").classList.remove("on");
  rShow(Math.min(at, Math.max(0, ep.lines.length - 1)));
}
// every line's state (what the scene shows) from the changes the lines carry
function rFold(lines) {
  const s = { bg: "", cg: "", chars: [], feel: {} }, out = [];
  for (const l of lines) {
    if ("bg" in l) s.bg = l.bg;
    if ("cg" in l) s.cg = l.cg;
    if (l.cl) s.chars = l.cl.map((x) => x.slice());
    if (l.f) Object.assign(s.feel, l.f);
    out.push({ bg: s.bg, cg: s.cg, chars: s.chars.map((x) => x.slice()), feel: Object.assign({}, s.feel) });
  }
  return out;
}
function rLayout(path) {
  if (!R.layouts.has(path)) R.layouts.set(path, api("/api/story_model?path=" + encodeURIComponent(path)).catch(() => null));
  return R.layouts.get(path);
}

// text -> letters that appear one by one; only the game's own tags are kept (color, b, i), the rest is shown as it is
function rHtml(text) {
  text = text.replace(/�/g, "’");
  const letters = (t) => [...t].map((ch) => `<span class="rc">${esc(ch)}</span>`).join("");
  const re = /<(\/?)(color|b|i|size)(?:=([^>]*))?>/gi;
  let out = "", open = 0, last = 0, m;
  while ((m = re.exec(text))) {
    out += letters(text.slice(last, m.index));
    last = re.lastIndex;
    const tag = m[2].toLowerCase();
    if (tag === "size") continue;
    if (m[1]) { if (open) { out += "</span>"; open--; } continue; }
    open++;
    const v = (m[3] || "").trim();
    out += tag === "b" ? `<span style="font-weight:700">` : tag === "i" ? `<span style="font-style:italic">`
      : `<span style="color:${/^#?[0-9a-f]{3,8}$/i.test(v) ? (v[0] === "#" ? v : "#" + v) : /^[a-z]+$/i.test(v) ? v : "inherit"}">`;
  }
  return out + letters(text.slice(last)) + "</span>".repeat(open);
}

function rShow(i) {
  const ep = R.ep;
  if (!ep) return;
  if (i >= ep.lines.length) { rEnd(); return; }
  R.i = i;
  const l = ep.lines[i], s = R.states[i];
  $("#rend").classList.remove("on");
  // picture
  const bgp = ep.pics["bg:" + s.bg], cgp = ep.pics["cg:" + s.cg];
  $("#rbg").style.backgroundImage = bgp ? `url('${stFull(bgp)}')` : "none";
  const cg = $("#rcg");
  cg.style.display = cgp ? "block" : "none";
  cg.style.backgroundImage = cgp ? `url('${stFull(cgp)}')` : "none";
  $("#rchars").style.display = cgp ? "none" : "";
  R.el.classList.toggle("mono", !l.m && !l.who && !s.chars.length && !cgp && (!bgp || /black/i.test(s.bg)));
  rChars(s, l.m);
  // text
  $("#rwho").textContent = l.who || "";
  $("#rrole").textContent = l.role || "";
  $("#rtxt").innerHTML = rHtml(l.text || "");
  R.spans = [...$("#rtxt").querySelectorAll(".rc")];
  R.typed = 0; R.wait = 0; R.done = !R.spans.length;
  $("#rrep").style.display = R.ui && l.v ? "block" : "none";
  $("#rinfo").textContent = `${R.meta.n ? R.meta.n + " · " : ""}${R.meta.title} · ${i + 1}/${ep.lines.length}`;
  $("#rbar").style.width = ((i + 1) / ep.lines.length * 100) + "%";
  if (!R.log.length || R.log[R.log.length - 1].k !== R.file + ":" + i) R.log.push({ k: R.file + ":" + i, w: l.who, t: l.text });
  // sound
  if (l.bgm !== undefined) rBgm(l.bgm);
  if (l.sfx) l.sfx.forEach((x) => rPlay(x));
  rVoice(i);
  if (l.vid && ep.pics["vid:" + l.vid]) rVideo(l.vid);
  // the next lines' voices are fetched while this one is read
  for (const k of [i + 1, i + 2]) if (ep.lines[k]?.v) rAudio(ep.lines[k].v).load();
}

function rAudio(sample) {
  let a = R.media.get(sample);
  if (!a) {
    a = new Audio("/api/story_audio?s=" + encodeURIComponent(sample));
    a.preload = "auto"; a.dataset.vol = "1";
    a.volume = mediaVol();
    R.media.set(sample, a);
    if (R.media.size > 40) R.media.delete(R.media.keys().next().value);
  }
  return a;
}
function rVoice(i) {
  R.voice?.pause();
  R.voice = null; R.voiceEnd = true;
  const l = R.ep.lines[i];
  if (!R.voiceOn || !l?.v || R.rate > 4) return;
  const a = rAudio(l.v);
  a.currentTime = 0; a.playbackRate = Math.min(R.rate, 4); a.preservesPitch = true; a.volume = mediaVol();
  R.voice = a; R.voiceEnd = false;
  a.onended = () => { if (R.voice === a) R.voiceEnd = true; };
  a.onerror = () => { if (R.voice === a) R.voiceEnd = true; };
  a.play().catch(() => { if (R.voice === a) R.voiceEnd = true; });
}
function rPlay(sample) {
  const a = rAudio(sample);
  a.currentTime = 0; a.volume = mediaVol(); a.play().catch(() => {});
}
function rBgm(name) {
  if (name === R.bgmName) return;
  R.bgmName = name;
  R.bgm?.pause();
  if (!name || /^(off|none|stop)$/i.test(name)) { R.bgm = null; return; }
  const a = new Audio("/api/story_audio?s=" + encodeURIComponent(name));
  a.loop = true; a.dataset.vol = "1"; a.volume = mediaVol() * 0.7;
  a.play().catch(() => {});
  R.bgm = a;
}
function rVideo(name) {
  const box = $("#rvid");
  const v = document.createElement("video");
  v.src = "/api/story_video?name=" + encodeURIComponent(name);
  v.autoplay = true; v.playsInline = true;
  v.style.cursor = "pointer";
  const at = R.i;
  const done = () => {
    box.style.display = "none"; box.innerHTML = ""; R.bgm?.play().catch(() => {});
    if (R.i === at && !(R.ep.lines[at].text || "").trim()) rShow(at + 1);  // (a line that is only the video goes on after it)
  };
  v.onended = done; v.onclick = done; v.onerror = done;
  box.innerHTML = ""; box.append(v); box.style.display = "block";
  R.bgm?.pause();
}

// speakers' pictures
async function rChars(s, speaker) {
  const ep = R.ep, box = $("#rchars"), want = new Map(s.chars.map(([m, slot]) => [m, slot]));
  for (const [m, node] of R.chars) if (!want.has(m)) { node.el.remove(); R.chars.delete(m); }
  const many = want.size > 1;
  for (const [m, slot] of want) {
    const info = ep.models[m];
    if (!info || (!info.psb && !info.img)) continue;
    let node = R.chars.get(m);
    if (!node || node.slot !== slot || node.file !== R.file) {
      node?.el.remove();
      const el = document.createElement("div"), inner = document.createElement("div");
      el.className = "stchar"; inner.className = "stin"; el.append(inner);
      node = { el, slot, file: R.file, face: null, faces: {}, psb: !!info.psb };
      R.chars.set(m, node);
      box.append(el);
      const flip = (info.side === "left" && slot < 4) || (info.side === "right" && slot > 4);
      el.style.left = `${slot / 8 * 100}%`;
      el.style.bottom = `calc(var(--u) * ${info.y || 0}px)`;
      const sc = `calc(var(--u) * 0.68 * ${flip ? "-1" : "1"})`;
      inner.style.transform = `scale(${sc}, calc(var(--u) * 0.68)) translateX(-50%)`;
      if (info.img) {
        inner.innerHTML = `<img src="${stFull(info.img, 1400)}" alt="">`;
      } else {
        const lay = await rLayout(info.psb);
        if (!lay || R.chars.get(m) !== node) continue;
        const body = lay.layers.filter((x) => !x.n.startsWith("face_") && x.n !== "pivot");
        const faces = lay.layers.filter((x) => x.n.startsWith("face_"));
        const all = body.concat(faces);
        const l0 = Math.min(...all.map((x) => x.l)), b0 = Math.min(...all.map((x) => x.b));
        const w = Math.max(...all.map((x) => x.l + x.w)) - l0, h = Math.max(...all.map((x) => x.b + x.h)) - b0;
        inner.style.width = w + "px"; inner.style.height = h + "px";
        const url = (x) => `/api/story_sprite?b=${encodeURIComponent(lay.bundle)}&p=${x.s}`;
        const put = (x) => `<img class="rlay" data-n="${esc(x.n)}" style="left:${x.l - l0}px;bottom:${x.b - b0}px;width:${x.w}px;height:${x.h}px;z-index:${x.o}" src="${url(x)}" alt="">`;
        inner.innerHTML = body.map(put).join("") + faces.map((x) => put(x).replace("<img", "<img hidden")).join("");
        node.faces = Object.fromEntries([...inner.querySelectorAll("img[data-n^=face_]")].map((im) => [im.dataset.n, im]));
      }
    }
    // the expression
    if (node.psb && Object.keys(node.faces).length) {
      const f = s.feel[m] || "idle", names = Object.keys(node.faces);
      const pick = node.faces["face_" + f] ? "face_" + f : node.faces.face_idle ? "face_idle" : names.find((n) => /idle|normal|default/.test(n)) || names[0];
      if (node.face !== pick) { if (node.face) node.faces[node.face].hidden = true; node.faces[pick].hidden = false; node.face = pick; }
    }
    node.el.classList.toggle("rdim", many && !!speaker && m !== speaker);
  }
}

function rLogShow() {
  $("#rlogb").innerHTML = R.log.map((x) => `<div><b>${esc(x.w || "—")}</b><p>${esc((x.t || "").replace(/<\/?(color|b|i|size)[^>]*>/g, ""))}</p></div>`).join("");
  $("#rlog").classList.add("on");
  $("#rlogb").scrollTop = 1e9;
}

function rTick() {
  if (!R.open || !R.ep) return;
  if (R.typed < R.spans.length) {
    const n = Math.max(1, Math.round(R_CPS * R.rate * 0.03));
    for (let k = 0; k < n && R.typed < R.spans.length; k++) R.spans[R.typed++].classList.add("on");
    if (R.typed >= R.spans.length) R.done = true;
    return;
  }
  R.done = true;
  if (!(R.auto || R.hold)) return;
  R.wait += 30 * R.rate;
  const talking = R.voice && !R.voiceEnd && R.rate <= 4;
  if (!talking && R.wait > 900) rAdvance(true);
}
function rAdvance(auto) {
  if ($("#rvid").style.display === "block") return;
  if (!R.done) { R.spans.forEach((x) => x.classList.add("on")); R.typed = R.spans.length; R.done = true; return; }
  if ($("#rend").classList.contains("on")) return;
  rShow(R.i + 1);
}
function rEnd() {
  const next = st.list[R.pos + 1];
  const end = $("#rend");
  end.innerHTML = `<h3>${esc(R.meta.title)}</h3><p>${next ? "Next: " + esc(next.title) + (ST_PART[next.detail] ? " · " + ST_PART[next.detail] : "") : "End of this story"}</p>
    <div>${next ? `<button data-a="next">Continue</button>` : ""}<button data-a="again">Read again</button><button data-a="exit">Back to the list</button></div>`;
  end.classList.add("on");
  end.onclick = (e) => {
    e.stopPropagation();
    const a = e.target.dataset?.a;
    if (a === "next") { location.hash = "#/story/read/" + encodeURIComponent(next.id); }
    if (a === "again") { end.classList.remove("on"); rShow(0); }
    if (a === "exit") rExit();
  };
}
function rExit() {
  R.open = false;
  R.el.classList.remove("on");
  R.voice?.pause(); R.bgm?.pause(); R.bgm = null; R.bgmName = "";
  $("#rvid").innerHTML = ""; $("#rvid").style.display = "none";
  for (const [, n] of R.chars) n.el.remove();
  R.chars.clear();
  location.hash = st.back && !st.back.includes("/read/") ? st.back : "#/story";
}

window.addEventListener("hashchange", () => { if (R.open && !location.hash.startsWith("#/story/read/")) { R.open = false; R.el.classList.remove("on"); R.voice?.pause(); R.bgm?.pause(); R.bgm = null; R.bgmName = ""; } });
