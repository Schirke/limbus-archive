"use strict";
// Story → Story workshop: a scene of your own from the stories' people, backgrounds, pictures and music (/api/story_kit),
// played in the reader (stPlayEp), shared as a link (the scene packed in the address) or a file.
const wk = { kit: null, by: null, names: null, sc: null, sel: 0, pick: null, shared: null, audio: null, ro: null };
const WK_KEY = "story.workshop";
const WK_MAX = 300;  // letters a line
const WK_LINES = 200;
const WK_LINK = 1900;  // (a Discord message holds 2000 letters)
const WK_PLACES = [[1, "Far left"], [3, "Left"], [5, "Middle"], [7, "Right"], [9, "Far right"], [-1, "Off stage"]];
const WK_FX = [["shake", "Shake"], ["flash", "Flash"], ["zoom", "Zoom in"]];
const WK_KIND = { m: "a speaker", bg: "a background", cg: "a picture", bgm: "music", sfx: "a sound" };
const WK_SHOW = 240;  // cards drawn at once in the picker

routes.workshop = async (args = []) => {
  const main = $("#main");
  if (!wk.kit) {
    main.innerHTML = `<h1>Story workshop</h1><div class="sub">Reading the stories' people, places and music…</div>`;
    try { wkSetKit(await api("/api/story_kit")); }
    catch (e) { main.innerHTML = `<h1>Story workshop</h1><div class="empty">${esc(e.message)}</div>`; return; }
    if (!location.hash.startsWith("#/workshop")) return;
  }
  if (!wk.kit.chars.length) { wk.kit = null; main.innerHTML = `<h1>Story workshop</h1><div class="empty">Take a snapshot first — the people and places are read from it.</div>`; return; }
  wk.shared = null;
  if (args[0] === "s" && args[1]) {
    try { wk.shared = wkClean(await wkUnpack(args[1])); } catch { wk.shared = null; }
    if (!wk.shared) { main.innerHTML = `<h1>Story workshop</h1><div class="empty">This scene link is broken or cut short.</div><p><a href="#/workshop">Open the workshop</a></p>`; return; }
  }
  if (!wk.sc) wk.sc = wkLoad() || wkSample();
  wkDraw();
};
window.addEventListener("hashchange", () => { if (!location.hash.startsWith("#/workshop")) { wkHear(null); $("#wkpick")?.remove(); } });

function wkSetKit(k) {
  wk.kit = k;
  const map = (xs, key) => new Map(xs.map((x) => [String(x[key]).toLowerCase(), x]));
  wk.by = { m: new Map(k.chars.map((c) => [c.m, c])), bg: map(k.bg, "k"), cg: map(k.cg, "k"), bgm: map(k.bgm, "k"), sfx: map(k.sfx, "k") };
  const at = (ch) => { const i = k.chapters.indexOf(ch); return i < 0 ? 999 : i; };
  wk.at = at;
  wk.names = new Map();
  for (const c of [...k.chars].sort((a, b) => b.n - a.n)) {
    if (!wk.names.has(c.name)) wk.names.set(c.name, []);
    wk.names.get(c.name).push(c);
  }
}
const wkChar = (m) => (m && wk.by.m.get(m)) || null;
const wkFind = (kind, key) => (key && wk.by[kind].get(String(key).toLowerCase())) || null;
const wkColor = (c) => /^#?[0-9a-f]{6}$/i.test(c?.color || "") ? "#" + c.color.replace("#", "") : "#9d9189";
const wkNice = (k) => String(k || "").replace(/^(BGM|SFX)_/i, "").replace(/_/g, " ");
const wkPlain = (t) => String(t || "").replace(/<\/?(color|b|i|size)[^>]*>/gi, "");

// ---------------------------------------------------------------- the scene: kept in the browser, a link, a file
function wkSave() { try { localStorage.setItem(WK_KEY, JSON.stringify(wk.sc)); } catch { /* private window: kept for this visit only */ } }
function wkLoad() { try { return wkClean(JSON.parse(localStorage.getItem(WK_KEY) || "null")); } catch { return null; } }
// a scene from outside (a link, a file, an old save): only the fields and values the workshop knows
function wkClean(sc) {
  if (!sc || !Array.isArray(sc.l) || !sc.l.length) return null;
  const str = (v, n) => typeof v === "string" ? v.slice(0, n) : undefined;
  const lines = sc.l.slice(0, WK_LINES).map((l) => {
    const o = { m: str(l.m, 80) || "", x: str(l.x, WK_MAX) || "" };
    if (o.m && !wkChar(o.m)) o.m = "";
    for (const k of ["n", "f"]) if (str(l[k], 40)) o[k] = str(l[k], 40);
    if (WK_PLACES.some(([p]) => p === l.p)) o.p = l.p;
    for (const k of ["bg", "cg", "bgm"]) if (typeof l[k] === "string" && (l[k] === "" || wkFind(k, l[k]))) o[k] = l[k];
    if (typeof l.sfx === "string" && wkFind("sfx", l.sfx)) o.sfx = l.sfx;
    const fx = Array.isArray(l.fx) ? l.fx.filter((x) => WK_FX.some(([k]) => k === x)) : [];
    if (fx.length) o.fx = [...new Set(fx)];
    if (l.clr) o.clr = 1;
    return o;
  });
  return { v: 1, t: str(sc.t, 60) || "My scene", l: lines };
}
function wkSample() {
  const who = (name) => (wk.names.get(name) || [])[0]?.m || "";
  const bg = ["Bus_Inside_1", "Bus_Inside"].find((k) => wkFind("bg", k)) || [...wk.kit.bg].sort((a, b) => b.n - a.n).find((x) => !/black|white/i.test(x.k))?.k || "";
  const l = [{ m: "", x: "The bus rolls on through the night.", bg }];
  if (who("Faust")) l.push({ m: who("Faust"), x: "Faust has packed lunch for everyone." });
  if (who("Heathcliff")) l.push({ m: who("Heathcliff"), x: "Then why is mine empty?!", fx: ["shake"] });
  return { v: 1, t: "My scene", l };
}
async function wkPack(sc) {
  const s = new Blob([JSON.stringify(sc)]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  const u8 = new Uint8Array(await new Response(s).arrayBuffer());
  let out = "";
  for (let i = 0; i < u8.length; i += 8192) out += String.fromCharCode(...u8.subarray(i, i + 8192));
  return btoa(out).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function wkUnpack(code) {
  const bin = atob(code.replace(/-/g, "+").replace(/_/g, "/"));
  const u8 = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  const s = new Blob([u8]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return JSON.parse(await new Response(s).text());
}
const wkSite = () => document.body.classList.contains("site") ? location.origin : GM_SITE;
async function wkLinkOf(sc) { return `${wkSite()}/#/workshop/s/${await wkPack(sc)}`; }

// ---------------------------------------------------------------- the scene as the reader's story file
// each line's stage: who stands where, faces, background, picture, music (a line changes only what it names)
function wkFold(sc) {
  const s = { chars: new Map(), feel: {}, bg: "", cg: "", bgm: "" }, out = [];
  for (const l of sc.l) {
    if (l.clr) s.chars.clear();
    for (const k of ["bg", "cg", "bgm"]) if (l[k] !== undefined) s[k] = l[k];
    if (l.m) {
      let p = l.p;
      if (p === undefined && !s.chars.has(l.m)) { const used = new Set(s.chars.values()); p = [5, 3, 7, 1, 9].find((x) => !used.has(x)) ?? 5; }
      if (p === -1) s.chars.delete(l.m);
      else if (p !== undefined) { for (const [m, q] of s.chars) if (q === p && m !== l.m) s.chars.delete(m); s.chars.set(l.m, p); }
      if (l.f) s.feel[l.m] = l.f;
    }
    out.push({ chars: [...s.chars], feel: { ...s.feel }, bg: s.bg, cg: s.cg, bgm: s.bgm });
  }
  return out;
}
function wkEp(sc) {
  const states = wkFold(sc), models = {}, pics = {}, lines = [];
  let prev = null, zoom = false;
  sc.l.forEach((l, i) => {
    const s = states[i], c = wkChar(l.m), out = { text: l.x || "" };
    if (c) { out.who = l.n || c.name; out.m = l.m; }
    else if (l.n) out.who = l.n;
    else out.n = 1;
    if (!prev || JSON.stringify(s.chars) !== JSON.stringify(prev.chars)) out.cl = s.chars.map((x) => x.slice());
    for (const [m] of s.chars) models[m] = wkChar(m);
    if (c) models[l.m] = c;
    const f = {};
    for (const m in s.feel) if (!prev || s.feel[m] !== prev.feel[m]) f[m] = s.feel[m];
    if (Object.keys(f).length) out.f = f;
    for (const k of ["bg", "cg"]) {
      if (prev && s[k] === prev[k]) continue;
      out[k] = s[k];
      const it = wkFind(k, s[k]);
      if (it) pics[k + ":" + s[k]] = it.p;
    }
    if (prev ? s.bgm !== prev.bgm : s.bgm) out.bgm = s.bgm || "off";
    if (l.sfx) out.sfx = [l.sfx];
    const fx = l.fx || [];
    if (fx.includes("zoom")) { out.cam = { h: 0, v: 0, z: 1.3, d: 0.6 }; zoom = true; }
    else if (zoom) { out.cam = { d: 0.4 }; zoom = false; }
    if (fx.some((x) => x !== "zoom")) out.fx = fx.filter((x) => x !== "zoom");
    lines.push(out);
    prev = s;
  });
  return { id: "workshop", lines, models, pics };
}
function wkPlay(sc, at = 0) {
  wkHear(null);
  if (!sc.l.some((l) => (l.x || "").trim())) { alert("Write a line first."); return; }
  stPlayEp(wkEp(sc), sc.t, at);
}

// ---------------------------------------------------------------- the page
function wkDraw() {
  if (wk.shared) return wkCover();
  const sc = wk.sc;
  wk.sel = Math.max(0, Math.min(wk.sel, sc.l.length - 1));
  $("#main").innerHTML = `<div id="wkpage">
    <div class="wkbar"><h1>Story workshop</h1><input id="wktitle" maxlength="60" aria-label="Scene title" value="${esc(sc.t)}">
      <span class="grow"></span>
      <button data-a="new">New</button><button data-a="open">Open file</button><button data-a="save">Save file</button><button data-a="share">Share link</button><button class="primary" data-a="play">▶ Play</button>
      <input type="file" id="wkfile" accept=".json,application/json" hidden></div>
    <div class="sub">Pick who speaks, their face and place, write the line; backgrounds, pictures, music and sounds come from the game's stories. The scene is kept in this browser.</div>
    <div class="wkcols">
      <div class="wklines"><div class="wkhead"><b id="wkcount"></b><button data-a="add">+ Add line</button></div><div class="wklist" id="wklist"></div></div>
      <div class="wkmid"><div class="wkstage" id="wkstage"></div>
        <div class="wknav"><button data-a="prev" aria-label="Previous line">‹</button><span id="wkpos"></span><button data-a="next" aria-label="Next line">›</button><span class="grow"></span><button data-a="playhere">▶ Play from this line</button></div>
        <div class="wkmeter"><span id="wkmeter"></span><i><b id="wkbar"></b></i></div></div>
      <div class="wkside" id="wkside"></div>
    </div></div>`;
  const page = $("#wkpage");
  page.addEventListener("click", wkClick);
  page.addEventListener("input", wkInput);
  page.addEventListener("change", wkChange);
  wk.ro?.disconnect();
  wk.ro = new ResizeObserver(() => { const b = $("#wkstage"); if (b) b.style.setProperty("--k", (b.clientWidth / ST_W).toFixed(5)); });
  wk.ro.observe($("#wkstage"));
  wkAll();
}
function wkAll() { wkList(); wkSide(); wkStage(); wkMeter(); }
function wkKeep() { wkSave(); wkMeter(); }

function wkMeta(l) {
  const bits = [];
  if (l.m && l.f) bits.push(l.f);
  if (l.m && l.p !== undefined) bits.push(WK_PLACES.find(([p]) => p === l.p)?.[1]);
  if (l.bg !== undefined) bits.push("new place");
  if (l.cg) bits.push("picture");
  if (l.bgm !== undefined) bits.push(l.bgm ? "music" : "music stops");
  if (l.sfx) bits.push("sound");
  for (const x of l.fx || []) bits.push(WK_FX.find(([k]) => k === x)[1].toLowerCase());
  return bits.filter(Boolean).join(" · ");
}
function wkList() {
  const sc = wk.sc;
  $("#wkcount").textContent = `Lines · ${sc.l.length}`;
  $("#wklist").innerHTML = sc.l.map((l, i) => {
    const c = wkChar(l.m), who = l.n || c?.name || "Narration";
    return `<button class="wkline${i === wk.sel ? " on" : ""}" data-i="${i}" aria-pressed="${i === wk.sel}"><span class="wkrow"><span class="wkdot" style="--c:${wkColor(c)}"></span><b>${esc(who)}</b><em>${i + 1}</em></span>
      <span class="wkmeta">${esc(wkMeta(l))}</span><span class="wktxt">${esc(wkPlain(l.x)) || "<i>(empty)</i>"}</span></button>`;
  }).join("");
  $("#wkpos").textContent = `Line ${wk.sel + 1} of ${sc.l.length}`;
}
function wkLineText() {
  const l = wk.sc.l[wk.sel], b = $(`#wklist .wkline[data-i="${wk.sel}"] .wktxt`);
  if (b) b.innerHTML = esc(wkPlain(l.x)) || "<i>(empty)</i>";
  const t = $("#wkstage .wkbox p");
  if (t) t.textContent = wkPlain(l.x);
  $("#wklen").textContent = `${(l.x || "").length} / ${WK_MAX}`;
}

// the line's settings
function wkSide() {
  const fold = wkFold(wk.sc), l = wk.sc.l[wk.sel], c = wkChar(l.m), was = wk.sel ? fold[wk.sel - 1] : { chars: [], bg: "", cg: "", bgm: "" };
  const thumb = c ? wkFace(c) : "";
  const looks = c ? wk.names.get(c.name) || [] : [];
  const keep = (k, name) => `<span class="muted">${name ? "as before: " + esc(name) : "none"}</span>`;
  const row = (k, label, cur, extra = "") => {
    const set = l[k] !== undefined, it = wkFind(k, l[k]);
    const now = set ? (l[k] === "" ? `<b>${k === "bgm" ? "stops" : "none"}</b>` : `<b>${esc(wkNice(it?.k || l[k]))}</b>`) : keep(k, cur);
    return `<div class="wkset"><span class="wkl">${label}</span><span class="wknow">${now}</span><span class="wkbtns"><button data-a="pick" data-k="${k}">Change…</button>${extra}${set ? `<button data-a="unset" data-k="${k}">Keep</button>` : ""}</span></div>`;
  };
  $("#wkside").innerHTML = `<div class="wkhd"><b>Line ${wk.sel + 1}</b><span class="grow"></span>
      <button data-a="up" aria-label="Move the line up" title="Move up">↑</button><button data-a="down" aria-label="Move the line down" title="Move down">↓</button><button data-a="dup">Duplicate</button><button class="danger" data-a="del">Delete</button></div>
    <div class="wkf"><span class="wkl">Who speaks</span>
      <div class="wkwho"><button class="wkwhobtn${c ? " on" : ""}" data-a="pick" data-k="m">${thumb}<span>${c ? esc(c.name) : "Pick a character…"}</span></button><button class="${c ? "" : "on"}" data-a="narr" aria-pressed="${!c}">Narration</button></div></div>
    ${c && looks.length > 1 ? `<div class="wkf"><label class="wkl" for="wklook">Look</label><select id="wklook">${looks.map((x, i) => `<option value="${esc(x.m)}"${x.m === l.m ? " selected" : ""}>${esc(x.nick || "Look " + (i + 1))}${x.ch ? " · " + esc(x.ch) : ""}</option>`).join("")}</select></div>` : ""}
    <div class="wkf"><label class="wkl" for="wkname">Name shown</label><input id="wkname" maxlength="40" value="${esc(l.n || "")}" placeholder="${esc(c ? c.name : "none (narration)")}"></div>
    ${c ? `<div class="wkf"><span class="wkl">Face</span><div class="wkfaces" id="wkfaces"><span class="muted">Loading…</span></div></div>
    <div class="wkf"><span class="wkl">Place on stage</span><div class="wkplaces"><button data-a="place" data-p="keep" aria-pressed="${l.p === undefined}" class="${l.p === undefined ? "on" : ""}">${was.chars.some(([m]) => m === l.m) ? "Stays" : "Auto"}</button>${WK_PLACES.map(([p, n]) => `<button data-a="place" data-p="${p}" aria-pressed="${l.p === p}" class="${l.p === p ? "on" : ""}">${n}</button>`).join("")}</div></div>` : ""}
    <div class="wkf"><span class="wkl"><label for="wktext">Text</label><span id="wklen"></span></span><textarea id="wktext" rows="4" maxlength="${WK_MAX}">${esc(l.x || "")}</textarea></div>
    <div class="wkf"><span class="wkl">On this line</span>
      ${row("bg", "Background", wkNice(was.bg))}
      ${row("cg", "Picture over the scene", wkNice(was.cg), was.cg && l.cg !== "" ? `<button data-a="none" data-k="cg">Remove</button>` : "")}
      ${row("bgm", "Music", wkNice(was.bgm), was.bgm && l.bgm !== "" ? `<button data-a="none" data-k="bgm">Stop</button>` : "")}
      ${row("sfx", "Sound", "")}
      <div class="wkfx">${WK_FX.map(([k, n]) => `<button data-a="fx" data-k="${k}" aria-pressed="${(l.fx || []).includes(k)}" class="${(l.fx || []).includes(k) ? "on" : ""}">${n}</button>`).join("")}<button data-a="clr" aria-pressed="${!!l.clr}" class="${l.clr ? "on" : ""}" title="Everyone on stage leaves before this line">Clear the stage</button></div></div>`;
  $("#wklen").textContent = `${(l.x || "").length} / ${WK_MAX}`;
  if (c) wkFaces(c, l);
}
function wkFace(c) {
  const src = c.face ? stImg(c.face) : c.img ? stImg(c.img) : "";
  return src ? `<img class="wkpor" loading="lazy" src="${src}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('i'),{className:'wkpor',textContent:this.dataset.n}))" data-n="${esc(c.name.slice(0, 1))}">` : `<i class="wkpor">${esc(c.name.slice(0, 1))}</i>`;
}
// a layered model's faces: its face_<name> sprites (the _L / _R takes are one face)
async function wkFaces(c, l) {
  const box = $("#wkfaces");
  if (!c.psb) { box.innerHTML = `<span class="muted">One picture: no other faces</span>`; return; }
  const lay = await rLayout(c.psb);
  if ($("#wkfaces") !== box || wk.sc.l[wk.sel] !== l) return;
  if (!lay) { box.innerHTML = `<span class="muted">Could not read the faces</span>`; return; }
  const faces = new Map();
  for (const x of lay.layers) if (x.n.startsWith("face_")) { const n = x.n.slice(5).replace(/_[LR]$/, ""); if (!faces.has(n)) faces.set(n, x); }
  const names = [...faces.keys()].sort((a, b) => (b === "idle") - (a === "idle") || a.localeCompare(b));
  const cur = l.f || "idle";
  box.innerHTML = names.length ? names.map((n) => `<button data-a="face" data-f="${esc(n)}" aria-pressed="${n === cur}" class="${n === cur ? "on" : ""}" title="${esc(n)}"><img loading="lazy" src="${rSpriteUrl(lay, faces.get(n))}" alt=""><span>${esc(n.replace(/_/g, " "))}</span></button>`).join("")
    : `<span class="muted">This model has one face</span>`;
}

// the stage as the reader draws it, at the chosen line
function wkStage(box = $("#wkstage"), sc = wk.sc, i = wk.sel) {
  if (!box) return;
  const s = wkFold(sc)[i], l = sc.l[i] || {}, bg = wkFind("bg", s.bg), cg = wkFind("cg", s.cg), c = wkChar(l.m);
  box.style.setProperty("--k", ((box.clientWidth || 640) / ST_W).toFixed(5));
  const who = l.n || c?.name || "";
  box.innerHTML = `<div class="wkbg"${bg ? ` style="background-image:url('${stFull(bg.p)}')"` : ""}></div><div class="wkchars"></div>
    ${cg ? `<div class="wkcg" style="background-image:url('${stFull(cg.p)}')"></div>` : ""}
    ${(l.fx || []).length ? `<div class="wkfxtag">${(l.fx || []).map((x) => `<span>${esc(WK_FX.find(([k]) => k === x)[1])}</span>`).join("")}</div>` : ""}
    <div class="wkbox">${who ? `<b style="--c:${wkColor(c)}">${esc(who)}</b>` : ""}<p class="${who ? "" : "narr"}"></p></div>`;
  box.querySelector(".wkbox p").textContent = wkPlain(l.x);
  if (cg) return;
  const row = box.querySelector(".wkchars"), many = s.chars.length > 1;
  for (const [m, slot] of s.chars) {
    const ch = wkChar(m);
    if (ch) row.append(wkStand(ch, slot, s.feel[m], many && !!l.m && m !== l.m, m === l.m));
  }
}
// one standing picture placed as the reader places it (rStand / rFace)
function wkStand(c, slot, feel, dim, front) {
  const el = document.createElement("div"), inner = document.createElement("div");
  el.className = "stchar" + (dim ? " rdim" : ""); inner.className = "stin"; el.append(inner);
  el.style.zIndex = front ? 20 : 10 - Math.abs(slot - 5);
  const flip = (c.side === "left" && slot < 5) || (c.side === "right" && slot > 5), sc = c.s || 1;
  el.style.left = `${(ST_W / 2 + (slot - 5) * ST_SLOT) / ST_W * 100}%`;
  el.style.bottom = `${(ST_FOOT + (c.y || 0)) / ST_H * 100}%`;
  inner.style.transform = `scale(calc(var(--k) * ${flip ? -sc : sc}), calc(var(--k) * ${sc}))`;
  if (c.img) {
    const im = new Image();
    im.alt = "";
    im.onload = () => { const w = im.naturalWidth, h = im.naturalHeight; Object.assign(im.style, { position: "absolute", width: w + "px", height: h + "px", left: -w / 2 + "px", bottom: "0" }); inner.append(im); };
    im.src = stFull(c.img, 2048);
    return el;
  }
  rLayout(c.psb).then((lay) => {
    if (!lay) return;
    const f = feel || "idle", look = (slot > 5) !== flip ? "L" : slot === 5 && !flip ? "L" : "R";
    const names = new Set(lay.layers.map((x) => x.n));
    const has = (n) => names.has("face_" + n) ? "face_" + n : "";
    const pick = has(f) || has(`${f}_${look}`) || has(`${f}_${look === "L" ? "R" : "L"}`) || has("idle") || has("idle_" + look) || "";
    inner.innerHTML = lay.layers.filter((x) => x.n !== "pivot" && (!x.n.startsWith("face_") || x.n === pick))
      .map((x) => `<img class="rlay" style="left:${x.l}px;bottom:${x.b}px;width:${x.w}px;height:${x.h}px;z-index:${x.o}" src="${rSpriteUrl(lay, x)}" alt="">`).join("");
  });
  return el;
}

async function wkMeter() {
  const m = $("#wkmeter");
  if (!m) return;
  const n = (await wkLinkOf(wk.sc)).length, pct = Math.min(100, Math.round(n / WK_LINK * 100));
  if ($("#wkmeter") !== m) return;
  m.textContent = n <= WK_LINK ? `Fits in a link: ${pct}% used` : "Too long for a link: share it as a file";
  $("#wkbar").style.width = pct + "%";
  $("#wkbar").classList.toggle("over", n > WK_LINK);
}

// a scene opened from a link: its first frame and Play
function wkCover() {
  const sc = wk.shared;
  $("#main").innerHTML = `<div id="wkpage" class="wkcover"><div class="wkstage" id="wkstage"></div>
    <div class="wkctext"><div class="muted">A scene made in Story workshop</div><h1>${esc(sc.t)}</h1><div class="muted">${sc.l.length} line${sc.l.length === 1 ? "" : "s"}</div>
      <div class="wkcbtns"><button class="primary" data-a="cplay">▶ Play</button><button data-a="cedit">Edit a copy</button><a href="#/workshop">Make your own</a></div></div></div>`;
  $("#wkpage").addEventListener("click", wkClick);
  wkStage($("#wkstage"), sc, 0);
}

// ---------------------------------------------------------------- what the buttons do
function wkLine() { return wk.sc.l[wk.sel]; }
function wkClick(e) {
  const li = e.target.closest(".wkline");
  if (li) { wk.sel = +li.dataset.i; wkAll(); return; }
  const b = e.target.closest("button[data-a]");
  if (!b) return;
  const a = b.dataset.a, sc = wk.sc, l = sc && wkLine(), k = b.dataset.k;
  if (a === "cplay") return wkPlay(wk.shared);
  if (a === "cedit") {
    try { const old = localStorage.getItem(WK_KEY); if (old) localStorage.setItem(WK_KEY + ".before", old); } catch { /* not kept */ }
    wk.sc = JSON.parse(JSON.stringify(wk.shared)); wk.sel = 0; wkSave();
    location.hash = "#/workshop";
    return;
  }
  if (a === "play") return wkPlay(sc);
  if (a === "playhere") return wkPlay(sc, wk.sel);
  if (a === "new") {
    if (!confirm("Start a new scene? The one here is replaced (save it as a file first to keep it).")) return;
    wk.sc = { v: 1, t: "My scene", l: [{ m: "", x: "" }] }; wk.sel = 0; wkSave(); wkDraw(); return;
  }
  if (a === "open") { $("#wkfile").click(); return; }
  if (a === "save") {
    const url = URL.createObjectURL(new Blob([JSON.stringify(sc, null, 1)], { type: "application/json" }));
    const link = Object.assign(document.createElement("a"), { href: url, download: (sc.t.replace(/[^\w\- ]+/g, "").trim() || "scene") + ".scene.json" });
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return;
  }
  if (a === "share") return wkShare();
  if (a === "prev" || a === "next") { wk.sel = Math.max(0, Math.min(sc.l.length - 1, wk.sel + (a === "next" ? 1 : -1))); wkAll(); return; }
  if (a === "add") {
    if (sc.l.length >= WK_LINES) { alert(`A scene holds up to ${WK_LINES} lines.`); return; }
    sc.l.splice(wk.sel + 1, 0, { m: l.m, x: "" }); wk.sel++; wkKeep(); wkAll(); $("#wktext")?.focus(); return;
  }
  if (a === "dup") { if (sc.l.length >= WK_LINES) return; sc.l.splice(wk.sel + 1, 0, JSON.parse(JSON.stringify(l))); wk.sel++; }
  else if (a === "del") {
    if (sc.l.length < 2) { sc.l[0] = { m: "", x: "" }; }
    else { sc.l.splice(wk.sel, 1); wk.sel = Math.min(wk.sel, sc.l.length - 1); }
  }
  else if (a === "up" || a === "down") {
    const j = wk.sel + (a === "up" ? -1 : 1);
    if (j < 0 || j >= sc.l.length) return;
    [sc.l[j], sc.l[wk.sel]] = [sc.l[wk.sel], sc.l[j]]; wk.sel = j;
  }
  else if (a === "pick") return wkPick(k);
  else if (a === "narr") { l.m = ""; delete l.f; delete l.p; }
  else if (a === "face") { if (b.dataset.f === "idle") delete l.f; else l.f = b.dataset.f; }
  else if (a === "place") { if (b.dataset.p === "keep") delete l.p; else l.p = +b.dataset.p; }
  else if (a === "unset") delete l[k];
  else if (a === "none") l[k] = "";
  else if (a === "fx") { const fx = new Set(l.fx || []); fx.has(k) ? fx.delete(k) : fx.add(k); if (fx.size) l.fx = [...fx]; else delete l.fx; }
  else if (a === "clr") { if (l.clr) delete l.clr; else l.clr = 1; }
  else return;
  wkKeep(); wkAll();
}
function wkInput(e) {
  const t = e.target;
  if (t.id === "wktitle") { wk.sc.t = t.value.slice(0, 60) || "My scene"; wkKeep(); }
  if (t.id === "wktext") { wkLine().x = t.value.slice(0, WK_MAX); wkKeep(); wkLineText(); }
  if (t.id === "wkname") { const v = t.value.trim().slice(0, 40); if (v) wkLine().n = v; else delete wkLine().n; wkKeep(); wkList(); wkStage(); }
}
async function wkChange(e) {
  const t = e.target;
  if (t.id === "wklook") { wkLine().m = t.value; delete wkLine().f; wkKeep(); wkAll(); }
  if (t.id === "wkfile" && t.files[0]) {
    let sc = null;
    try { sc = wkClean(JSON.parse(await t.files[0].text())); } catch { /* not a scene */ }
    t.value = "";
    if (!sc) { alert("This file is not a Story workshop scene."); return; }
    wk.sc = sc; wk.sel = 0; wkSave(); wkDraw();
  }
}
async function wkShare() {
  const link = await wkLinkOf(wk.sc), fits = link.length <= WK_LINK;
  modal(`<h2>Share “${esc(wk.sc.t)}”</h2>
    ${fits ? `<p class="muted">The whole scene is packed inside the link: nothing is kept on the site.</p>
      <div class="wkshare"><input id="wklinkbox" readonly value="${esc(link)}" aria-label="Scene link"><button class="primary" id="wkcopy">Copy</button></div>`
      : `<p>This scene is too long for a link (${link.length} letters, a Discord message holds 2000). Save it as a file and send the file: it opens with Story workshop → Open file.</p>`}
    <p class="muted">A file holds any length: Save file, then Open file on any device.</p>`);
  const copy = $("#wkcopy");
  if (copy) copy.onclick = async () => {
    try { await navigator.clipboard.writeText(link); copy.textContent = "Copied"; }
    catch { $("#wklinkbox").select(); }
  };
}

// ---------------------------------------------------------------- the picker: people, backgrounds, pictures, music, sounds
function wkPick(kind) {
  wkHear(null);
  wk.pick = { kind, q: "", ch: "", n: WK_SHOW };
  $("#wkpick")?.remove();
  const el = document.createElement("div");
  el.id = "wkpick";
  el.innerHTML = `<div class="wkpbox" role="dialog" aria-modal="true" aria-label="Pick ${WK_KIND[kind]}">
    <div class="wkphead"><h2>Pick ${WK_KIND[kind]}</h2><input id="wkq" type="search" placeholder="Search" aria-label="Search">
      <select id="wkch" aria-label="Chapter"><option value="">Every chapter</option>${wk.kit.chapters.map((c) => `<option>${esc(c)}</option>`).join("")}</select>
      <button data-a="x" aria-label="Close">×</button></div>
    <div class="wkpbody" id="wkpbody"></div></div>`;
  document.body.append(el);
  el.addEventListener("click", (e) => {
    if (e.target === el) return wkPickClose();
    const b = e.target.closest("[data-a]");
    if (!b) return;
    if (b.dataset.a === "x") return wkPickClose();
    if (b.dataset.a === "more") { wk.pick.n += WK_SHOW; return wkPickList(); }
    if (b.dataset.a === "hear") return wkHear(b.dataset.k, b);
    if (b.dataset.a === "use") return wkUse(b.dataset.k);
  });
  el.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); wkPickClose(); } });
  $("#wkq").oninput = (e) => { wk.pick.q = e.target.value.trim().toLowerCase(); wk.pick.n = WK_SHOW; wkPickList(); };
  $("#wkch").onchange = (e) => { wk.pick.ch = e.target.value; wk.pick.n = WK_SHOW; wkPickList(); };
  wkPickList();
  $("#wkq").focus();
}
function wkPickClose() { wkHear(null); $("#wkpick")?.remove(); }
function wkPickList() {
  const p = wk.pick, kind = p.kind, q = p.q;
  let items;
  if (kind === "m") {
    items = [...wk.names.values()].map((looks) => looks[0])
      .filter((c) => (!q || c.name.toLowerCase().includes(q) || (c.nick || "").toLowerCase().includes(q)) && (!p.ch || wk.names.get(c.name).some((x) => x.ch === p.ch)))
      .sort((a, b) => wk.at(a.ch) - wk.at(b.ch) || b.n - a.n);
  } else {
    items = wk.kit[kind].filter((x) => (!q || x.k.toLowerCase().includes(q)) && (!p.ch || x.ch === p.ch))
      .sort((a, b) => wk.at(a.ch) - wk.at(b.ch) || b.n - a.n);
  }
  const shown = items.slice(0, p.n);
  let h;
  if (kind === "m") h = `<div class="wkpgrid people">${shown.map((c) => `<button data-a="use" data-k="${esc(c.m)}">${wkFace(c)}<b>${esc(c.name)}</b><span>${esc(c.nick || c.ch || "")}</span></button>`).join("")}</div>`;
  else if (kind === "bg" || kind === "cg") h = `<div class="wkpgrid pics">${shown.map((x) => `<button data-a="use" data-k="${esc(x.k)}"><img loading="lazy" src="${stFull(x.p)}" alt=""><b>${esc(wkNice(x.k))}</b><span>${esc(x.ch || "")}</span></button>`).join("")}</div>`;
  else h = `<div class="wkplist">${shown.map((x) => `<div class="wkprow"><button class="sndplay" data-a="hear" data-k="${esc(x.k)}" aria-label="Listen to ${esc(wkNice(x.k))}">▶</button><b>${esc(wkNice(x.k))}</b><span class="muted">${esc(x.ch || "")}</span><button data-a="use" data-k="${esc(x.k)}">Use</button></div>`).join("")}</div>`;
  if (!items.length) h = `<div class="empty">Nothing found.</div>`;
  if (items.length > shown.length) h += `<div class="wkpmore"><button data-a="more">Show more (${items.length - shown.length} left)</button></div>`;
  $("#wkpbody").innerHTML = h;
}
function wkUse(key) {
  const l = wkLine(), kind = wk.pick.kind;
  if (kind === "m") { if (l.m !== key) { l.m = key; delete l.f; delete l.n; } }
  else l[kind] = key;
  wkPickClose(); wkKeep(); wkAll();
}
function wkHear(key, btn) {
  const a = wk.audio;
  document.querySelectorAll("#wkpick .sndplay.on").forEach((x) => { x.classList.remove("on"); x.textContent = "▶"; });
  if (a) { a.pause(); wk.audio = null; if (a.dataset.k === key) return; }
  if (!key) return;
  const n = new Audio(rAudioUrl(key));
  n.dataset.k = key; n.volume = mediaVol();
  n.play().catch(() => {});
  n.onended = () => { if (wk.audio === n) wkHear(null); };
  wk.audio = n;
  if (btn) { btn.classList.add("on"); btn.textContent = "■"; }
}
