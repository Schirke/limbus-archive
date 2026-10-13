// Announcers: the battle announcers with every line by situation, from /api/announcers.
"use strict";

const nc = { data: null, q: "", id: 0, audio: new Audio(), on: -1 };
window.addEventListener("hashchange", () => { if (!location.hash.startsWith("#/announcers")) ncStop(); });

function ncStop() {
  nc.audio.pause();
  nc.on = -1;
  document.querySelectorAll(".ncline.on").forEach((r) => r.classList.remove("on"));
}

routes.announcers = async (args = []) => {
  const main = $("#main");
  if (!nc.data) {
    main.innerHTML = `<h1>Announcers</h1><div class="sub">Reading the game's files…</div>`;
    try { nc.data = await api("/api/announcers"); } catch (e) { main.innerHTML = `<h1>Announcers</h1><div class="empty">${esc(e.message)}</div>`; return; }
    if (!location.hash.startsWith("#/announcers")) return;
  }
  if (!nc.data.list.length) { main.innerHTML = `<h1>Announcers</h1><div class="empty">Take a snapshot first — the announcers are read from it.</div>`; return; }
  nc.id = +args[0] || nc.id || nc.data.list[0].id;
  ncStop();
  main.innerHTML = `<h1>Announcers</h1>
    <div class="sub">Every battle announcer of the game with all of its lines, sorted by what happens in the fight. Press a line to hear it.</div>
    <input type="search" id="ncq" class="dbq" placeholder="Search: an announcer or words of a line…" value="${esc(nc.q)}">
    <div class="enwrap ncwrap"><div><div class="engrid" id="ncgrid"></div></div><div class="encard" id="nccard"></div></div>`;
  let t;
  $("#ncq").oninput = (e) => { clearTimeout(t); t = setTimeout(() => { nc.q = e.target.value; ncDraw(); }, 200); };
  nc.audio.onended = ncStop;
  ncDraw();
};

const ncHas = (s, q) => String(s || "").toLowerCase().includes(q);

function ncDraw() {
  const q = nc.q.trim().toLowerCase();
  const list = nc.data.list.filter((a) => !q || ncHas(a.name, q) || a.lines.some((l) => ncHas(l[1], q)));
  if (list.length && !list.some((a) => a.id === nc.id)) nc.id = list[0].id;
  $("#ncgrid").innerHTML = list.map((a) => `<a class="entile ${a.id === nc.id ? "on" : ""}" href="#/announcers/${a.id}" title="${esc(a.name)}">
    ${a.img ? `<img src="${imgThumb(a.img)}" loading="lazy" onerror="this.remove()">` : ""}<b>${esc(a.name)}</b></a>`).join("") || `<div class="muted">Nothing found.</div>`;
  const a = list.find((x) => x.id === nc.id);
  ncStop();
  if (!a) { $("#nccard").innerHTML = ""; return; }
  // (a search by a line's words shows the lines that have them)
  const lines = a.lines.map((l, i) => [l, i]).filter(([l]) => !q || ncHas(a.name, q) || ncHas(l[1], q));
  const groups = new Map();
  for (const x of lines) { if (!groups.has(x[0][0])) groups.set(x[0][0], []); groups.get(x[0][0]).push(x); }
  const sec = (ms) => ms ? `${(ms / 1000).toFixed(1)} s` : "";
  $("#nccard").innerHTML = `<div class="nchead">${(a.imgs.length ? a.imgs : [a.img]).filter(Boolean).map((p) => `<img src="${imgFull(p)}" onerror="this.remove()">`).join("")}
      <div><h2>${esc(a.name)}</h2><div class="muted small">${a.lines.length} lines${lines.length !== a.lines.length ? ` · ${lines.length} shown` : ""}</div></div></div>
    ${[...groups].map(([k, rows]) => `<div class="enh">${esc(nc.data.kinds[k] || "Other")}</div>${rows.map(([l, i]) =>
      `<div class="ncline ${l[2] ? "" : "mute"}" data-i="${i}"><i class="ncplay">${l[2] ? "▶" : ""}</i><span>${l[1] ? esc(l[1]) : `<span class="muted">(no text)</span>`}</span><em>${sec(l[4])}</em></div>`).join("")}`).join("")}`;
  $("#nccard").scrollTop = 0;
  $("#nccard").querySelectorAll(".ncline:not(.mute)").forEach((r) => r.onclick = () => {
    const i = +r.dataset.i, l = a.lines[i], same = nc.on === i;
    ncStop();
    if (same) return;
    nc.on = i;
    r.classList.add("on");
    if (typeof muAudio !== "undefined") muAudio.pause();
    nc.audio.src = `/api/bank?path=${encodeURIComponent(l[2])}&i=${l[3]}`;
    nc.audio.play().catch(() => ncStop());
  });
}
