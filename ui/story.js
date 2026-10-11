// Database → Story: Story Theater stories played scene by scene (backgrounds, standing pictures, voices, music). Hold
// the mouse to read faster.
"use strict";

const st = { idx: null, tab: "main", sel: {}, pick: {}, ep: null, list: [], i: 0 };
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
  storyDraw();
};

function stChapters() {
  const idx = st.idx;
  if (st.tab === "main") return [...idx.main, ...idx.other];  // Cantos, then Intervallo, then the mini stories
  return idx.ident.map((s) => ({ id: String(s.sinner), label: s.name, sinner: s.sinner, items: s.items }));
}

function storyDraw() {
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
      <span class="tag">${esc(tag)}</span>${c.time ? `<span class="code">${esc(c.time)}</span>` : ""}<span class="name">${esc(name)}</span><span class="count">${c.eps.reduce((n, e) => n + e.parts.length, 0)} episodes</span></button>`;
    const grp = st.tab === "main" && c.kind !== "main" ? (c.kind === "intervallo" ? "Intervallo" : "Mini stories") : "";
    if (grp && grp !== last) { cards += `<div class="stgroup">${grp}</div>`; last = grp; }
    cards += card;
  }
  const nEps = (c) => c.eps.reduce((n, e) => n + e.parts.length, 0);
  const sub = (cur) => [cur.company, cur.area, cur.time, `${nEps(cur)} episodes`].filter(Boolean).map(esc).join(" · ");
  const head = !cur ? "" : st.tab === "ident" ? `<h2>${esc(cur.label)}</h2><div class="stsub">${cur.items.length} Identity stories</div>`
    : `<h2>${esc(cur.kind === "mini" ? (cur.title || cur.label) : cur.label + (cur.title ? ": " + cur.title : ""))}</h2>
       <div class="stsub">${sub(cur)}</div>${cur.desc ? `<div class="stdesc">${esc(cur.desc)}</div>` : ""}`;
  // every story file is one episode, as in the game's Story Theater: a picture, a strip of Ep. 1…N, a panel with Enter
  const eps = !cur ? [] : st.tab === "ident"
    ? cur.items.map((it) => ({ id: it.story, n: "", title: it.name, detail: "", pic: "", icon: `/api/char_icon?id=${it.id}` }))
    : cur.eps.flatMap((e) => e.parts.map((p) => ({ id: p[0], n: e.n, title: e.title, desc: e.desc, detail: p[1], pic: p[2] || cur.pic })));
  const key = st.tab + ":" + (cur ? cur.id : "");
  let at = st.pick[key];
  if (at == null || !eps[at]) at = Math.max(0, eps.findIndex((e) => e.id === st.last));
  st.pick[key] = at;
  const ep = eps[at];
  const pic = ep && (ep.pic ? `background-image:url('${stFull(ep.pic, 1280)}')` : ep.icon ? `background-image:url('${ep.icon}')` : "");
  const view = !ep ? "" : `<div class="stview">
      <div class="stbanner${ep.icon ? " icon" : ""}" style="${pic}"><span class="stbtag">EP.${at + 1}</span></div>
      <div class="stinfo"><div class="stepl">${st.tab === "ident" ? "Identity story" : "Episode"}</div><div class="stepn">${esc(ep.n || String(at + 1))}</div>
        ${ST_PART[ep.detail] ? `<div class="stpart ${ep.detail.toLowerCase()}">${ST_PART[ep.detail]}</div>` : ""}
        <div class="stept">${esc(ep.title)}</div>${ep.desc ? `<div class="stepd">${esc(ep.desc)}</div>` : ""}
        <button type="button" class="stenter" data-f="${esc(ep.id)}">Enter</button></div></div>`;
  const track = eps.map((e, k) => `<button type="button" class="stent${k === at ? " on" : ""}${e.id === st.last ? " last" : ""}" data-k="${k}" title="${esc((e.n ? e.n + " " : "") + e.title + (ST_PART[e.detail] ? " · " + ST_PART[e.detail] : ""))}"><span>Ep. ${k + 1}</span><i></i></button>`).join("");
  $("#stpage").innerHTML = `<div class="sttabs" role="tablist">${ST_TABS.map(([k, n]) => `<button class="sttab" role="tab" data-tab="${k}" aria-selected="${k === st.tab}">${n}</button>`).join("")}
</div>
    <div class="stmain"><div class="stcantos">${cards}</div><section class="stpanel">${head}${view}<div class="sttrack">${track}</div></section></div>`;
  $(".stcantos").scrollTop = keep; $(".stpanel").scrollTop = cur && String(cur.id) === st.drawn ? keepP : 0;
  st.drawn = cur && String(cur.id);
  const tr = $(".sttrack"), on = $(".sttrack .on");
  if (on) tr.scrollLeft = on.offsetLeft - (tr.clientWidth - on.offsetWidth) / 2;
  document.querySelectorAll(".sttab").forEach((b) => b.onclick = () => { location.hash = "#/story/" + b.dataset.tab; });
  document.querySelectorAll(".stcanto").forEach((b) => b.onclick = () => { st.sel[st.tab] = b.dataset.id; location.hash = `#/story/${st.tab}/${b.dataset.id}`; });
  document.querySelectorAll(".stent").forEach((b) => {
    b.onclick = () => { st.pick[key] = +b.dataset.k; storyDraw(); };
    b.ondblclick = () => stOpen(eps[+b.dataset.k].id, cur);
  });
  const enter = $(".stenter");
  if (enter) enter.onclick = () => stOpen(enter.dataset.f, cur);
  $(".stbanner")?.addEventListener("click", () => enter?.click());
}

// a chapter's files in order, so a story goes on
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
  for (const e of own ? eps(own) : []) for (const p of e.parts) found.push({ id: p[0], title: e.title, n: e.n, detail: p[1], place: e.place || "" });
  return { list: found.length ? found : [{ id: file, title: file, n: "", detail: "" }], title: own ? (own.title || own.label) : "" };
}

// ------------------------------------------------------------------ the reader
const R = { el: null, ep: null, i: 0, rate: 1, hold: false, held: 0, auto: false, voiceOn: true, typed: 0, total: 0, spans: [], states: [], done: false,
  wait: 0, voice: null, voiceEnd: true, bgm: null, bgmName: "", media: new Map(), layouts: new Map(), chars: new Map(), log: [], timer: 0, open: false, ui: stGet("story.ui", "") };
const R_STEPS = [[0, 1], [1500, 2], [2100, 4], [2800, 6], [3600, 12]];
const R_CPS = 52;  // letters a second at x1
// the game's story stage: 2400 x 1350, slot n at x = (n - 5) * 140 from the middle (200 in the prefab; 140 measured on
// in-game screenshots), its foot 400 below the bottom
const ST_W = 2400, ST_H = 1350, ST_SLOT = 140, ST_FOOT = -400;

function rEnsure() {
  if (R.el) return;
  const el = document.createElement("div");
  el.id = "streader";
  el.innerHTML = `<div class="rstage" id="rstage"><div class="rcam" id="rcam"><div class="rbgimg" id="rbg"></div><div class="rchars" id="rchars"></div><div class="rcgimg" id="rcg"></div></div><div class="rvig"></div><div class="rfade" id="rfade"></div><div class="rplace" id="rplace"></div>
    <div class="rhex" id="rhex"><button type="button" class="rhx" data-h="skip" title="Skip to the end"><svg viewBox="0 0 24 24"><path d="M3 5l9 7-9 7zM12 5l9 7-9 7z"/></svg></button><button type="button" class="rhx" data-h="auto" title="Auto"><b>AUTO</b></button><button type="button" class="rhx" data-h="log" title="Log"><svg viewBox="0 0 24 24"><path d="M6 2h9l5 5v15H6zM14 3v5h5M9 11h8M9 14h8M9 17h6" fill="none" stroke="currentColor" stroke-width="1.8"/></svg></button><button type="button" class="rhx" data-h="hide" title="Hide the interface"><b>UI</b></button><button type="button" class="rhx" data-h="set" title="Settings"><svg viewBox="0 0 24 24"><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zm8.4 5.1l2 1.6-2 3.5-2.4-.9a8 8 0 0 1-2.2 1.3L15.4 22h-4l-.4-2.6a8 8 0 0 1-2.2-1.3l-2.4.9-2-3.5 2-1.6a8 8 0 0 1 0-2.6l-2-1.6 2-3.5 2.4.9a8 8 0 0 1 2.2-1.3L11.4 2h4l.4 2.6a8 8 0 0 1 2.2 1.3l2.4-.9 2 3.5-2 1.6a8 8 0 0 1 0 2.6z"/></svg></button><button type="button" class="rhx" data-h="more" title="Menu"><svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" stroke-width="2.6"/></svg></button></div>
    <div class="rbar"><i id="rbar"></i></div><div class="rinfo" id="rinfo"></div>
    <div class="rhud"><button type="button" id="rauto">Auto</button><button type="button" id="rmenubtn">Menu</button></div>
    <div class="rmenu" id="rmenu"><button data-a="log">Log</button><button data-a="voice"></button><button data-a="ui"></button><button data-a="skip">Skip to end of this story</button><button data-a="exit">Exit to list</button></div>
    <div class="rbox" id="rbox"><div class="rplates" id="rplates"><div class="rtitle" id="rtitle"></div><div class="rname" id="rname"></div></div><div class="rwho"><b id="rwho"></b><i id="rrole"></i><button type="button" class="rrep" id="rrep" title="Replay voice">▶ voice</button></div><div class="rtxt" id="rtxt"></div><div class="rnext">▼</div></div>
    <div class="rspeed" id="rspeed"></div><div class="rvid" id="rvid"></div>
    <div class="rlog" id="rlog"><div class="rlogh"><b>Log</b><button type="button" id="rlogx">Close</button></div><div class="rlogb" id="rlogb"></div></div>
    <div class="rend" id="rend"></div></div>`;
  document.body.append(el);
  R.el = el;
  R.fit = () => {
    const s = $("#rstage");
    if (s && s.clientWidth) { el.style.setProperty("--u", (s.clientWidth / 1920).toFixed(4)); el.style.setProperty("--k", (s.clientWidth / ST_W).toFixed(5)); }
  };
  new ResizeObserver(R.fit).observe(el);
  window.addEventListener("resize", R.fit);
  const stage = $("#rstage");
  let t0 = 0, hz = 0, down = false;
  const skip = (e) => e.target.closest(".rhud, .rhex, .rmenu, .rlog, .rend, .rrep, .rvid");
  stage.addEventListener("pointerdown", (e) => {
    if (skip(e)) return;
    if (R.el.classList.contains("noui")) { R.el.classList.remove("noui"); return; }  // (a tap brings the hidden interface back)
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
  $("#rauto").onclick = (e) => { e.stopPropagation(); R.auto = !R.auto; e.currentTarget.classList.toggle("on", R.auto); $('.rhx[data-h=auto]').classList.toggle("on", R.auto); };
  $("#rmenubtn").onclick = (e) => { e.stopPropagation(); rMenuSync(); $("#rmenu").classList.toggle("on"); };
  $("#rrep").onclick = (e) => { e.stopPropagation(); rVoice(R.i); };
  // the game's row of buttons, folded behind the menu one
  $("#rhex").onclick = (e) => {
    e.stopPropagation();
    const h = e.target.closest(".rhx")?.dataset.h;
    if (h === "more") $("#rhex").classList.toggle("open");
    if (h === "skip") rShow(R.ep.lines.length - 1);
    if (h === "auto") $("#rauto").click();
    if (h === "log") rLogShow();
    if (h === "hide") setTimeout(() => R.el.classList.add("noui"));
    if (h === "set") { rMenuSync(); $("#rmenu").classList.toggle("on"); }
  };
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
  m.querySelector('[data-a=ui]').textContent = "Reader look: " + (R.ui ? "Archive" : "Game");
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
  const s = { bg: "", cg: "", chars: [], feel: {}, cam: {} }, out = [];
  for (const l of lines) {
    if ("bg" in l) s.bg = l.bg;
    if ("cg" in l) s.cg = l.cg;
    if (l.cl) s.chars = l.cl.map((x) => x.slice());
    if (l.f) Object.assign(s.feel, l.f);
    if (l.cam) s.cam = l.cam;
    out.push({ bg: s.bg, cg: s.cg, chars: s.chars.map((x) => x.slice()), feel: Object.assign({}, s.feel), cam: s.cam });
  }
  return out;
}
function rLayout(path) {
  if (!R.layouts.has(path)) R.layouts.set(path, api("/api/story_model?path=" + encodeURIComponent(path)).catch(() => null));
  return R.layouts.get(path);
}

// typed letters; only color / b / i tags kept
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
  // the camera: zoom on a point given in half screens from the middle (CameraMoveZoom)
  const cam = s.cam, z = cam.z || 1, rc = $("#rcam");
  rc.style.transition = `transform ${l.cam ? cam.d || 0 : 0}s ease-in-out`;
  rc.style.transform = cam.z ? `translate(${cam.h * z * 50}%, ${cam.v * z * 50}%) scale(${z})` : "none";
  // text
  $("#rwho").textContent = l.who || "";
  $("#rrole").textContent = l.role || "";
  // the game's name plates: the title above, the name on the speaker's colour
  const mi = ep.models[l.m] || {}, title = l.role || mi.nick || "";
  $("#rplates").style.display = l.who ? "" : "none";
  $("#rtitle").textContent = title; $("#rtitle").style.display = title ? "" : "none";
  $("#rname").textContent = l.who || "";
  $("#rname").style.setProperty("--tag", /^#?[0-9a-f]{6}$/i.test(mi.color || "") ? "#" + mi.color.replace("#", "") : "");
  $("#rname").style.setProperty("--tagc", /^#?[0-9a-f]{6}$/i.test(mi.fc || "") ? "#" + mi.fc.replace("#", "") : "");
  $("#rplace").textContent = R.meta.place || ""; $("#rplace").style.display = R.meta.place ? "" : "none";
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

// speakers' pictures, placed as the game's Standing (0-10) slots place them
function rChars(s, speaker) {
  const ep = R.ep, box = $("#rchars"), want = new Map(s.chars.map(([m, slot]) => [m, slot]));
  for (const [m, node] of R.chars) if (!want.has(m)) { node.el.remove(); R.chars.delete(m); }
  const many = want.size > 1;
  for (const [m, slot] of want) {
    const info = ep.models[m];
    if (!info || (!info.psb && !info.img)) continue;
    let node = R.chars.get(m);
    if (!node || node.slot !== slot || node.file !== R.file) {
      node?.el.remove();
      node = rStand(m, info, slot);
      R.chars.set(m, node);
      box.append(node.el);
    }
    rFace(node, m);
    node.el.classList.toggle("rdim", many && !!speaker && m !== speaker);
    node.el.style.zIndex = m === speaker ? 20 : slot === 5 ? 10 : 10 - Math.abs(slot - 5);
  }
}
// one standing picture: a 0 x 0 point at the slot's foot, the picture scaled around it
function rStand(m, info, slot) {
  const el = document.createElement("div"), inner = document.createElement("div");
  el.className = "stchar"; inner.className = "stin"; el.append(inner);
  // pictures drawn looking one way turn toward the middle
  const flip = (info.side === "left" && slot < 5) || (info.side === "right" && slot > 5);
  const node = { el, slot, file: R.file, face: null, faces: null, flip };
  el.style.left = `${(ST_W / 2 + (slot - 5) * ST_SLOT) / ST_W * 100}%`;
  el.style.bottom = `${(ST_FOOT + (info.y || 0)) / ST_H * 100}%`;
  const sc = info.s || 1;
  inner.style.transform = `scale(calc(var(--k) * ${flip ? -sc : sc}), calc(var(--k) * ${sc}))`;
  if (info.img) {  // a flat picture: its own pixels, standing on the foot (matches in-game screenshots)
    const im = new Image();
    im.alt = "";
    im.onload = () => {
      const w = im.naturalWidth, h = im.naturalHeight;
      Object.assign(im.style, { position: "absolute", width: w + "px", height: h + "px", left: -w / 2 + "px", bottom: "0" });
      inner.append(im);
    };
    im.src = stFull(info.img, 2048);
    return node;
  }
  rLayout(info.psb).then((lay) => {  // a layered model: body + one face, in its own pixels around its origin
    if (!lay || R.chars.get(m) !== node) return;
    const url = (x) => `/api/story_sprite?b=${encodeURIComponent(lay.bundle)}&p=${x.s}`;
    const put = (x, face) => `<img class="rlay" data-n="${esc(x.n)}"${face ? " hidden" : ""} style="left:${x.l}px;bottom:${x.b}px;width:${x.w}px;height:${x.h}px;z-index:${x.o}" src="${url(x)}" alt="">`;
    inner.innerHTML = lay.layers.filter((x) => x.n !== "pivot").map((x) => put(x, x.n.startsWith("face_"))).join("");
    node.faces = Object.fromEntries([...inner.querySelectorAll("img[data-n^=face_]")].map((im) => [im.dataset.n, im]));
    rFace(node, m);
  });
  return node;
}
// the face the line asks for: face_<feeling>, or its _L / _R take looking toward the middle; none = the body's own face
function rFace(node, m) {
  if (!node.faces) return;
  const f = (R.states[R.i]?.feel || {})[m] || "idle", look = (node.slot > 5) !== node.flip ? "L" : node.slot === 5 && !node.flip ? "L" : "R";
  const has = (n) => node.faces["face_" + n] ? "face_" + n : "";
  const pick = has(f) || has(`${f}_${look}`) || has(`${f}_${look === "L" ? "R" : "L"}`)
    || (node.face && f !== "idle" ? node.face : "") || has("idle") || has("idle_" + look) || "";
  if (node.face === pick) return;
  if (node.face) node.faces[node.face].hidden = true;
  if (pick) node.faces[pick].hidden = false;
  node.face = pick;
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
