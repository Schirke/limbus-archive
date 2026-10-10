// Database → Sounds: every sound of the game's banks in four folders (Sound Effects, Story,
// Voicefiles, Soundtracks; /api/sounds, limbusdm/soundlib.py), with who says a line and its text. The four folders are
// art tiles, a Sinner's Identities are their cards, a folder of sounds lists its neighbours on the left. One sound plays
// at a time in the bar at the bottom (previous / next run through the list shown; Play all goes on by itself), a
// folder's own sounds can be saved as WAVs at once.
"use strict";

const snd = { tree: null, path: [], rows: [], pics: {}, img: "", shown: 0, q: "", cur: -1, all: false, list: [] };
const SND_PAGE = 200;
const SND_TOP = {  // (the four folders' pictures: the game's own art)
  "Sound Effects": "Assets/Resources_moved/Story/Backgrounds/Ep10_1/story_b1_foodcourt.png",
  "Story": "Assets/Resources_moved/Story/Backgrounds/Ep10_1/story_Ncourt.png",
  "Voicefiles": "Assets/Resources_moved/Sprite/Unit/CG/10201_normal.png",
  "Soundtracks": "Assets/Resources_moved/UIConfigs/LobbyBGM/Banner/bgmCover_Rendezvous.png",
};
const SND_UNIT = { "Story": "voiced lines", "Voicefiles": "lines", "Soundtracks": "tracks" };
const SND_PLAY = `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M6 4l15 8-15 8z"/></svg>`;
const SND_PAUSE = `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>`;

const sndNode = (path) => path.reduce((n, name) => n && (n.kids || []).find((k) => k.name === name), snd.tree);
const sndHash = (path) => "#/sounds" + path.map((p) => "/" + encodeURIComponent(p)).join("");
const sndNum = (n) => n.toLocaleString("en").replace(/,/g, " ");
const sndT = (ms) => { const s = ms ? Math.max(1, Math.round(ms / 1000)) : 0; return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const sndKey = (r) => r[1] + "#" + r[2];
const sndSin = (n) => `/api/ui_icon?k=sinner_${n}`;
// an Identity's / E.G.O's folder in its Sinner's: "Blade Lineage Salsu Faust" → "Blade Lineage Salsu"
const sndShort = (name, parent) => parent && parent.sinner && name.endsWith(" " + parent.name) ? name.slice(0, -parent.name.length - 1) : name;

routes.sounds = async (args) => {
  snd.path = args.filter(Boolean);
  if ($("#sndbody")) return sndDraw();  // (another folder: the page and what plays stay)
  $("#main").innerHTML = `<div id="sndpage"><div id="sndhead"></div><div id="sndbody"><div class="muted">Loading…</div></div>
    <div id="sndbar" class="sndbar" hidden><img id="sndbarpic" alt="" hidden><div class="sndbarname"><b id="sndnow"></b><span id="sndwhere"></span></div>
      <button class="sndnav" id="sndprev" title="Previous" aria-label="Previous"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M6 5h2v14H6zM20 5v14L9 12z"/></svg></button>
      <button class="sndplay" id="sndtoggle" aria-label="Play">${SND_PLAY}</button>
      <button class="sndnav" id="sndnext" title="Next" aria-label="Next"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M16 5h2v14h-2zM4 5v14l11-7z"/></svg></button>
      <span class="mono" id="sndclock">0:00</span><div class="sndseek" id="sndseek"><i></i></div><span class="mono muted" id="sndlen">0:00</span>
      <input type="range" id="sndvol" min="0" max="1" step="0.01" title="Volume" aria-label="Volume">
      <audio id="sndaudio" preload="none"></audio></div></div>`;
  const a = $("#sndaudio");
  a.volume = mediaVol();
  $("#sndvol").value = a.volume;
  $("#sndvol").oninput = (e) => { a.volume = +e.target.value; try { localStorage.setItem(MEDIA_VOL, String(a.volume)); } catch {} };
  a.ontimeupdate = () => {
    $("#sndclock").textContent = sndT(a.currentTime * 1000);
    const d = a.duration || 0;
    $("#sndseek i").style.width = d ? (100 * a.currentTime / d) + "%" : "0";
    const row = document.querySelector(".sndrow.on .sndprog");
    if (row) row.style.width = d ? (100 * a.currentTime / d) + "%" : "0";
  };
  a.onplay = a.onpause = () => sndMark();
  a.onended = () => { if (snd.all && snd.cur + 1 < snd.list.length) sndPlay(snd.cur + 1); else { snd.all = false; sndMark(); } };
  $("#sndseek").onclick = (e) => { if (a.duration) a.currentTime = a.duration * (e.offsetX / e.currentTarget.clientWidth); };
  $("#sndtoggle").onclick = () => a.src && (a.paused ? a.play() : a.pause());
  $("#sndprev").onclick = () => snd.cur > 0 && sndPlay(snd.cur - 1);
  $("#sndnext").onclick = () => snd.cur + 1 < snd.list.length && sndPlay(snd.cur + 1);
  try { snd.tree = snd.tree || await api("/api/sounds"); }
  catch (e) { $("#sndbody").innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  sndDraw();
};

function sndSearchBox(wide) {
  return `<label class="sndq${wide ? " wide" : ""}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>
    <input type="search" id="sndq" placeholder="Search all sounds: a name, a speaker, words of a line…" value="${esc(snd.q)}" aria-label="Search all sounds"></label>`;
}

async function sndDraw() {
  const head = $("#sndhead"), body = $("#sndbody");
  if (!body) return;
  const path = snd.path.slice(), node = sndNode(path);
  if (!node) { location.hash = "#/sounds"; return; }
  if (!path.length && !snd.q) {
    head.innerHTML = `<h1>Sounds</h1><div class="sub">Every sound in the game's files: sound effects, the story's voiced lines, Identity voice lines and the soundtrack. Lines come with who says them and their text.</div>
      <div class="sndtop">${sndSearchBox(true)}<span class="sndmeta">${sndNum(node.n)} sounds · from the game's own files</span></div>`;
  } else {
    const crumbs = [["Sounds", []], ...path.map((p, i) => [p.split(" · ")[0], path.slice(0, i + 1)])];
    head.innerHTML = `<div class="sndtop"><nav class="sndcrumbs" aria-label="Folder path">${crumbs.map(([name, p], i) => i === crumbs.length - 1 && !snd.q ? `<b>${esc(name)}</b>` : `<a href="${sndHash(p)}">${esc(name)}</a>`).join("<span>/</span>")}${snd.q ? `<span>/</span><b>Search</b>` : ""}</nav>
      <span class="sndslant"></span>${sndSearchBox()}</div>`;
  }
  let t;
  $("#sndq").oninput = (e) => { clearTimeout(t); t = setTimeout(() => { snd.q = e.target.value.trim(); sndDraw().then(() => { const q = $("#sndq"); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }); }, 350); };
  if (snd.q) return sndSearch();
  if (!path.length) {
    body.innerHTML = `<div class="sndtiles">${node.kids.map((k) => `<a class="sndtile" href="${sndHash([k.name])}">
      <div class="sndart" style="background-image:url('${imgThumb(SND_TOP[k.name] || "")}')"><span class="sndtag">${k.kids.length} folders</span></div>
      <div class="sndcap"><b>${esc(k.name)}</b><i>${sndNum(k.n)} ${SND_UNIT[k.name] || "sounds"}</i>
      <div class="sndchips">${k.kids.slice(0, 5).map((c) => `<span>${esc(c.name)} ${sndNum(c.n)}</span>`).join("")}${k.kids.length > 5 ? `<span>+${k.kids.length - 5}</span>` : ""}</div></div></a>`).join("")}</div>`;
    return;
  }
  if (node.kids) {
    const parent = sndNode(path.slice(0, -1));
    let h = "";
    if (node.sinner && parent) h += sndSinStrip(parent, path);
    if (node.kids.some((k) => k.sinner)) {
      h += `<div class="sndsins">${node.kids.map((k) => `<a class="sndsin" href="${sndHash([...path, k.name])}">${k.sinner ? `<img src="${sndSin(k.sinner)}" alt="">` : ""}<b>${esc(k.name)}</b><i>${sndNum(k.n)} lines · ${k.kids ? k.kids.length : 0}</i></a>`).join("")}</div>`;
    } else if (node.kids.some((k) => k.img)) {
      const who = node.name.toUpperCase();
      h += `<div class="sndids">${node.kids.map((k) => `<a class="sndid" href="${sndHash([...path, k.name])}"><div class="sndidart">${k.img ? `<img src="${imgThumb(k.img)}" alt="" loading="lazy" onerror="this.remove()">` : ""}</div>
        <div class="sndidcap"><div><small>${esc(who)}</small><b>${esc(sndShort(k.name, node))}</b></div><i>${sndNum(k.n)} lines</i></div></a>`).join("")}</div>`;
    } else {
      h += `<div class="sndplates">${node.kids.map((k) => { const [code, place] = k.name.split(" · "); return `<a class="sndplate" href="${sndHash([...path, k.name])}"><b>${esc(code)}</b>${place ? `<span>${esc(place)}</span>` : ""}<i>${sndNum(k.n)}</i></a>`; }).join("")}</div>`;
    }
    body.innerHTML = h;
    return;
  }
  sndLeaf(path, node);
}

// a Sinner's folder: the twelve to switch between
function sndSinStrip(parent, path) {
  return `<div class="sndstrip">${parent.kids.filter((k) => k.sinner).map((k) => `<a class="${k.name === path[path.length - 1] ? "on" : ""}" href="${sndHash([...path.slice(0, -1), k.name])}"><img src="${sndSin(k.sinner)}" alt="">${esc(k.name)}</a>`).join("")}</div>`;
}

async function sndLeaf(path, node) {
  const body = $("#sndbody"), parent = sndNode(path.slice(0, -1)), [code, place] = node.name.split(" · ");
  const sibs = parent && parent.kids && parent.kids.length > 1 ? parent.kids : null;
  body.innerHTML = `<div class="sndleaf">${sibs ? `<aside class="sndside"><div class="sndsidehead"><b>${esc(parent.name)}</b><i>${sndNum(parent.n)} · ${sibs.length} folders</i></div>
      <div class="sndsidelist">${sibs.map((k) => { const [c, p] = sndShort(k.name, parent).split(" · "); return `<a class="${k === node ? "on" : ""}" href="${sndHash([...path.slice(0, -1), k.name])}"><b>${esc(c)}</b>${p ? `<span>${esc(p)}</span>` : ""}<i>${sndNum(k.n)}</i></a>`; }).join("")}</div></aside>` : ""}
    <section class="sndmain"><div class="sndleafhead"><div class="grow"><div class="sndtitle"><b>${esc(code)}</b>${place ? `<span>${esc(place)}</span>` : ""}</div>
      <div class="sndwho" id="sndwho"><span>${sndNum(node.items)} ${node.items === 1 ? "sound" : "sounds"}</span></div></div>
      <button class="primary" id="sndall">Play all</button>
      <button id="sndsave" ${node.items > 500 ? "disabled title='Too many to save at once: save them one by one'" : ""}>Save folder · ${sndNum(node.items)} WAV</button></div>
      <div id="sndrows" class="sndrows"><div class="muted">Loading…</div></div></section></div>`;
  const on = $(".sndsidelist .on");
  if (on) on.parentElement.scrollTop = on.offsetTop - on.parentElement.clientHeight / 2;
  $("#sndsave").onclick = () => exportObj({ soundfolder: path });
  $("#sndall").onclick = () => { snd.all = true; sndPlay(0); };
  const got = await api(`/api/sounds?path=${encodeURIComponent(JSON.stringify(path))}`).catch(() => ({ items: [], pics: {} }));
  if (snd.path.join("/") !== path.join("/") || snd.q) return;
  snd.rows = got.items.map((r) => [null, ...r]);
  snd.pics = got.pics || {};
  snd.img = node.img || "";
  const who = Object.keys(snd.pics);
  if (who.length) $("#sndwho").insertAdjacentHTML("beforeend", `<span>· who speaks</span>${who.map((w) => `<img src="${imgThumb(snd.pics[w])}" alt="${esc(w)}" title="${esc(w)}">`).join("")}`);
  snd.shown = 0;
  sndMore(true);
}

async function sndSearch() {
  const body = $("#sndbody");
  body.innerHTML = `<div class="muted">Searching…</div>`;
  const q = snd.q, rows = await api(`/api/sounds?q=${encodeURIComponent(q)}`).catch(() => []);
  if (q !== snd.q) return;
  snd.rows = rows;
  snd.pics = {};
  snd.img = "";
  body.innerHTML = `<div class="sndmeta" style="margin-bottom:8px">${rows.length}${rows.length >= 300 ? "+" : ""} found</div><div id="sndrows" class="sndrows"></div>`;
  snd.shown = 0;
  sndMore(true);
}

function sndMore(first) {
  const el = $("#sndrows");
  if (!el) return;
  if (first) el.innerHTML = "";
  $("#sndmore")?.remove();
  const part = snd.rows.slice(snd.shown, snd.shown + SND_PAGE), playing = snd.list[snd.cur] && sndKey(snd.list[snd.cur]);
  el.insertAdjacentHTML("beforeend", part.map((r, k) => {
    const [where, , , name, ms, title, sub, text, found] = r, n = snd.shown + k, pic = found || snd.pics[title] || snd.img;
    return `<div class="sndrow${sndKey(r) === playing ? " on" : ""}" data-key="${esc(sndKey(r))}">
      <button class="sndplay" data-play="${n}" aria-label="Play">${SND_PLAY}</button>
      ${pic ? `<img class="sndpic" src="${imgThumb(pic)}" alt="" loading="lazy" onerror="this.remove()">` : ""}
      <div class="sndtxt">${title ? `<b>${esc(title)}</b>${sub ? ` <small>${esc(sub)}</small>` : ""}` : `<b class="mono">${esc(name)}</b>`}
        ${text ? `<div>${esc(text)}</div>` : ""}
        ${where ? `<a class="sndwhere" href="${sndHash(where)}">${esc(where.map((w) => w.split(" · ")[0]).join(" / "))}</a>` : ""}</div>
      ${title ? `<span class="sndname mono">${esc(name)}</span>` : ""}<span class="sndlen mono">${sndT(ms)}</span>
      <button class="toggle" data-save="${n}" title="Save as WAV">WAV</button><i class="sndprog"></i></div>`;
  }).join("") || (first ? `<div class="empty">Nothing found.</div>` : ""));
  snd.shown += part.length;
  if (snd.shown < snd.rows.length) {
    el.insertAdjacentHTML("afterend", `<button id="sndmore" class="sndmorebtn">Show more · ${sndNum(snd.rows.length - snd.shown)} left</button>`);
    $("#sndmore").onclick = () => sndMore();
  }
  el.querySelectorAll("[data-play]:not([data-on])").forEach((b) => { b.dataset.on = "1"; b.onclick = () => {
    const r = snd.rows[+b.dataset.play], a = $("#sndaudio");
    if (snd.list === snd.rows && snd.list[snd.cur] === r && a && !a.paused) return a.pause();
    snd.all = false;
    sndPlay(+b.dataset.play, true);
  }; });
  el.querySelectorAll("[data-save]:not([data-on])").forEach((b) => { b.dataset.on = "1"; b.onclick = () => { const r = snd.rows[+b.dataset.save]; exportObj({ bank: r[1], i: r[2] }); }; });
  sndMark();
}

// play the n-th of the list shown (the bar's previous / next and Play all go along that list)
function sndPlay(n, fresh) {
  const a = $("#sndaudio");
  if (fresh || snd.list !== snd.rows) snd.list = snd.rows;
  const r = snd.list[n];
  if (!a || !r) return;
  if (snd.list[snd.cur] === r && snd.cur === n && a.src) { a.play().catch(() => {}); return; }
  snd.cur = n;
  a.src = `/api/bank?path=${encodeURIComponent(r[1])}&i=${r[2]}`;
  a.play().catch(() => {});
  const pic = r[8] || snd.pics[r[5]] || snd.img;
  $("#sndbar").hidden = false;
  $("#sndbarpic").hidden = !pic;
  if (pic) $("#sndbarpic").src = imgThumb(pic);
  $("#sndnow").textContent = "♪ " + (r[5] || r[3]);
  $("#sndwhere").textContent = [r[0] ? r[0].map((w) => w.split(" · ")[0]).join(" / ") : snd.path.map((w) => w.split(" · ")[0]).join(" / "), `${n + 1} of ${snd.list.length}`].join(" · ");
  $("#sndlen").textContent = sndT(r[4]);
  if (n >= snd.shown && snd.list === snd.rows) while (snd.shown <= n && snd.shown < snd.rows.length) sndMore();
  sndMark();
  document.querySelector(`.sndrow[data-key="${CSS.escape(sndKey(r))}"]`)?.scrollIntoView({ block: "nearest" });
}

function sndMark() {
  const a = $("#sndaudio"), r = snd.list[snd.cur], key = r ? sndKey(r) : "", going = a && !a.paused && !a.ended;
  document.querySelectorAll(".sndrow").forEach((d) => {
    const on = d.dataset.key === key;
    d.classList.toggle("on", on);
    d.querySelector(".sndplay").innerHTML = on && going ? SND_PAUSE : SND_PLAY;
    if (!on) d.querySelector(".sndprog").style.width = "0";
  });
  const t = $("#sndtoggle");
  if (t) { t.innerHTML = going ? SND_PAUSE : SND_PLAY; t.classList.toggle("on", going); }
}
