// The corner music player: the game's own soundtrack from its FMOD banks (/api/music), battle themes first.
"use strict";

const MUSIC_KEEP = "music";
const mu = { tracks: [], n: -1, open: false, q: "", history: [],
  ...{ battle: true, shuffle: true, vol: 0.6, min: false },
  ...(() => { try { return JSON.parse(localStorage.getItem(MUSIC_KEEP) || "{}"); } catch { return {}; } })() };
const muAudio = new Audio();
muAudio.preload = "none";

const muKeep = () => { try { localStorage.setItem(MUSIC_KEEP, JSON.stringify({ battle: mu.battle, shuffle: mu.shuffle, vol: mu.vol, min: mu.min, last: mu.tracks[mu.n]?.event })); } catch {} };
const muTime = (s) => isFinite(s) ? Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0") : "0:00";
// a theme heard in a few fights only is somebody's own: "Canto 8 · Lei Heng"; the common ones name the chapter
const muSub = (t) => [t.where, t.fights && t.fights <= 3 && t.who.length ? t.who.slice(0, 2).join(", ") : "", t.by].filter(Boolean).join(" · ");
const muList = () => mu.tracks.map((t, n) => ({ t, n })).filter(({ t }) => (!mu.battle || t.battle)
  && (!mu.q || (t.name + " " + t.where + " " + t.who.join(" ") + " " + t.by).toLowerCase().includes(mu.q)));

function muDraw() {
  const box = $("#player"), t = mu.tracks[mu.n], playing = !muAudio.paused && !!t;
  box.classList.toggle("min", mu.min);
  box.classList.toggle("open", mu.open && !mu.min);
  document.body.classList.toggle("player-up", !mu.min);
  $("#mu-kind").textContent = "♪ " + (mu.battle ? "BATTLE THEMES" : "ALL TRACKS") + (mu.shuffle ? " · SHUFFLE" : "");
  $("#mu-name").textContent = t ? t.name : "Limbus Company soundtrack";
  $("#mu-name").title = t ? t.name : "";
  $("#mu-sub").textContent = t ? (mu.loading ? "loading…" : muSub(t)) : `${muList().length} tracks from the game's files`;
  $("#mu-play").textContent = playing ? "⏸" : "▶";
  $("#mu-play").classList.toggle("on", playing);
  $("#mu-shuffle").classList.toggle("on", mu.shuffle);
  $("#mu-listbtn").classList.toggle("on", mu.open);
  $("#mu-pill").textContent = playing ? "♪ " + t.name : "♪";
  if (mu.open && !mu.min) muDrawList();
}

function muDrawList() {
  const rows = muList();
  $("#mu-rows").innerHTML = rows.map(({ t, n }) => `<div class="${n === mu.n ? "on" : ""}" data-n="${n}"><b>${esc(t.name)}</b><i>${esc(muSub(t))}</i><u>${muTime(t.ms / 1000)}</u></div>`).join("")
    || `<p class="muted">Nothing found.</p>`;
  $("#mu-both").textContent = mu.battle ? "Battle themes" : "All tracks";
  $("#mu-rows .on")?.scrollIntoView({ block: "nearest" });
}

function muTick() {
  const d = muAudio.duration || (mu.tracks[mu.n]?.ms || 0) / 1000;
  $("#mu-bar i").style.width = d ? Math.min(100, 100 * muAudio.currentTime / d) + "%" : "0";
  $("#mu-clock").textContent = muTime(muAudio.currentTime) + " / " + muTime(d);
}

function muPlay(n, back) {
  if (!mu.tracks[n]) return;
  if (!back && mu.n >= 0 && mu.n !== n) mu.history.push(mu.n);
  mu.n = n;
  mu.loading = true;
  muAudio.src = "/api/music_audio?n=" + n;
  muAudio.volume = mu.vol;
  muAudio.play().catch(() => {});
  muKeep();
  muDraw();
  muTick();
}

function muNext(dir = 1) {
  if (dir < 0 && mu.history.length) return muPlay(mu.history.pop(), true);
  const rows = muList().map((r) => r.n);
  if (!rows.length) return;
  const at = rows.indexOf(mu.n);
  if (mu.shuffle && dir > 0 && rows.length > 1) {
    let n;
    do n = rows[Math.floor(Math.random() * rows.length)]; while (n === mu.n);
    return muPlay(n);
  }
  muPlay(rows[(at + dir + rows.length) % rows.length]);
}

function muToggle() {
  if (mu.n < 0) return muNext();
  if (!muAudio.src) return muPlay(mu.n, true);
  muAudio.paused ? muAudio.play().catch(() => {}) : muAudio.pause();
}

async function muStart() {
  const tracks = await api("/api/music").catch(() => []);
  if (!Array.isArray(tracks) || !tracks.length) return;  // no snapshot yet, or the game's sound banks aren't there
  mu.tracks = tracks;
  mu.n = tracks.findIndex((t) => t.event === mu.last);
  const box = document.createElement("div");
  box.id = "player";
  box.innerHTML = `<button id="mu-pill" title="Music player"></button>
    <div id="mu-list"><div class="mu-head"><input id="mu-q" placeholder="Search: track, Canto, enemy…"><button id="mu-both" title="Battle themes only / the whole soundtrack"></button></div><div id="mu-rows"></div></div>
    <div id="mu-body"><small id="mu-kind"></small><button id="mu-min" title="Hide">–</button><b id="mu-name"></b><span id="mu-sub"></span>
    <div id="mu-bar"><i></i></div>
    <div class="c"><button id="mu-prev" title="Previous">⏮</button><button id="mu-play" title="Play / pause">▶</button><button id="mu-next" title="Next">⏭</button>
    <button id="mu-shuffle" title="Shuffle">🔀</button><button id="mu-listbtn" title="Track list">☰</button>
    <input id="mu-vol" type="range" min="0" max="1" step="0.01" title="Volume"><span id="mu-clock"></span></div></div>`;
  document.body.appendChild(box);
  $("#mu-vol").value = mu.vol;
  $("#mu-play").onclick = muToggle;
  $("#mu-next").onclick = () => muNext(1);
  $("#mu-prev").onclick = () => muAudio.currentTime > 4 ? (muAudio.currentTime = 0) : muNext(-1);
  $("#mu-shuffle").onclick = () => { mu.shuffle = !mu.shuffle; muKeep(); muDraw(); };
  $("#mu-listbtn").onclick = () => { mu.open = !mu.open; muDraw(); };
  $("#mu-min").onclick = $("#mu-pill").onclick = () => { mu.min = !mu.min; muKeep(); muDraw(); };
  $("#mu-both").onclick = () => { mu.battle = !mu.battle; muKeep(); muDraw(); };
  $("#mu-q").oninput = (e) => { mu.q = e.target.value.trim().toLowerCase(); muDrawList(); };
  $("#mu-vol").oninput = (e) => { muAudio.volume = mu.vol = +e.target.value; muKeep(); };
  $("#mu-rows").onclick = (e) => { const r = e.target.closest("[data-n]"); if (r) muPlay(+r.dataset.n); };
  $("#mu-bar").onclick = (e) => { const d = muAudio.duration; if (d) muAudio.currentTime = d * e.offsetX / e.currentTarget.clientWidth; };
  muAudio.ontimeupdate = muTick;
  muAudio.onplaying = () => { mu.loading = false; muDraw(); };
  muAudio.onpause = muDraw;
  muAudio.onended = () => muNext(1);
  muAudio.onerror = () => { mu.loading = false; if (muAudio.src) toast("This track could not be read from the game's files."); muDraw(); };
  muDraw();
  muTick();
}
muStart();
