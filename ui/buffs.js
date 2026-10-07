"use strict";
// Buff effects (Database → Buff effects): the buffs and debuffs that have an effect of their own in the game's data,
// a video of each effect (drawn alone by the Unity player, made on request and kept) and who gives or gets the buff.
// Data: /api/buffs (limbusdm/buffs.py).
let BUFFS = null;
const bfv = { q: "", type: "", who: "", sort: "name", sel: "" };
const BF_TYPES = [["", "All"], ["pos", "Buffs"], ["neg", "Debuffs"], ["neu", "Neutral"]];
const BF_WHO = [["", "Anyone"], ["id", "Identities"], ["ego", "E.G.O"], ["enemy", "Enemies"]];
const BF_WORD = { pos: "Buff", neg: "Debuff", neu: "Neutral" };
const bfName = (b) => b.name || b.id;
const bfSafe = (n) => n.replace(/[^\w.-]/g, "_");  // (the video's file name, as the app writes it)
const bfHas = (n) => BUFFS.have.includes(bfSafe(n));
const bfFailed = (n) => BUFFS.failed.includes(n);

routes.buffs = async (args) => {
  const main = $("#main");
  if (!BUFFS) {
    main.innerHTML = `<div class="muted">Loading the effects… (the first time after a patch takes about a minute)</div>`;
    try { [BUFFS] = await Promise.all([api("/api/buffs"), units()]); } catch (e) { main.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  }
  if (!BUFFS.list.length) { BUFFS = null; main.innerHTML = `<div class="empty">Take a snapshot first — the effects are read from it.</div>`; return; }
  if (args[0]) bfv.sel = args[0];
  if (!$("#bfgrid")) drawBuffs();
  else { bfMark(); drawBuff(); }
  bfPoll();
};

function bfFiltered() {
  const q = bfv.q.trim().toLowerCase();
  const arr = BUFFS.list.filter((b) => (!bfv.type || b.type === bfv.type) && (!bfv.who || b.who.some((w) => w.k === bfv.who))
    && (!q || `${b.name} ${b.id} ${b.fx.join(" ")} ${b.who.map((w) => w.name).join(" ")}`.toLowerCase().includes(q)));
  const order = { pos: 0, neg: 1, neu: 2 };
  if (bfv.sort === "type") arr.sort((a, b) => order[a.type] - order[b.type]);  // (the list comes sorted by name)
  if (bfv.sort === "who") arr.sort((a, b) => b.who.length - a.who.length);
  return arr;
}

function drawBuffs() {
  const chips = (list, key) => list.map(([k, n]) => `<button class="toggle ${bfv[key] === k ? "on" : ""}" data-${key}="${k}">${n}</button>`).join("");
  $("#main").innerHTML = `<h1>Buff effects</h1>
    <div class="sub">Buffs and debuffs that have an effect of their own in the game's files, and who gives or gets them. The plain statuses (Burn, Bleed…) have none.</div>
    <input type="search" id="bfq" class="dbq" placeholder="Search: buff, effect, who has it…" value="${esc(bfv.q)}">
    <div class="dbrow bfrow">${chips(BF_TYPES, "type")}<span class="gap"></span>${chips(BF_WHO, "who")}<span class="grow"></span>
      <select id="bfsort">${[["name", "By name"], ["type", "Buffs first"], ["who", "Most holders"]].map(([k, n]) => `<option value="${k}" ${bfv.sort === k ? "selected" : ""}>${n}</option>`).join("")}</select>
      <button id="bfall"></button></div>
    <div class="enwrap"><div><div class="muted small" id="bfcount"></div><div id="bfgrid" class="engrid bfgrid"></div></div><div id="bfcard" class="encard"></div></div>`;
  const main = $("#main");
  main.querySelectorAll("[data-type]").forEach((b) => b.onclick = () => { bfv.type = b.dataset.type; drawBuffs(); });
  main.querySelectorAll("[data-who]").forEach((b) => b.onclick = () => { bfv.who = b.dataset.who; drawBuffs(); });
  $("#bfsort").onchange = (e) => { bfv.sort = e.target.value; drawBuffGrid(); };
  $("#bfall").onclick = async () => { Object.assign(BUFFS, await api("/api/buffs", {})); bfProgress(); drawBuff(); bfPoll(); };
  let t;
  $("#bfq").oninput = (e) => { clearTimeout(t); t = setTimeout(() => { bfv.q = e.target.value; drawBuffGrid(); }, 200); };
  drawBuffGrid();
  bfProgress();
}

function drawBuffGrid() {
  const arr = bfFiltered();
  $("#bfcount").textContent = `${arr.length} of ${BUFFS.list.length}`;
  $("#bfgrid").innerHTML = arr.map((b) => `<a class="entile bftile ${b.type}" href="#/buffs/${encodeURIComponent(b.id)}" data-b="${esc(b.id)}" title="${esc(`${bfName(b)} · ${BF_WORD[b.type]}`)}">
      ${b.icon ? `<img loading="lazy" src="${imgThumb(b.icon)}" onerror="this.remove()">` : ""}<span>${BF_WORD[b.type]}</span><b>${esc(bfName(b))}</b></a>`).join("")
    || `<div class="empty">Nothing matches.</div>`;
  if (!arr.some((b) => b.id === bfv.sel) && arr.length) bfv.sel = arr[0].id;
  bfMark();
  drawBuff();
}
function bfMark() {
  document.querySelectorAll("#bfgrid .bftile").forEach((a) => {
    a.classList.toggle("on", a.dataset.b === bfv.sel);
    const b = BUFFS.list.find((x) => x.id === a.dataset.b);
    a.classList.toggle("made", !!b && b.fx.some(bfHas));
  });
}

function bfProgress() {
  const btn = $("#bfall");
  if (!btn) return;
  const all = [...new Set(BUFFS.list.flatMap((b) => b.fx))];
  const left = all.filter((n) => !bfHas(n) && !bfFailed(n)).length;
  btn.hidden = !BUFFS.available || (!left && !BUFFS.busy);
  btn.disabled = BUFFS.busy && BUFFS.queue >= left;
  btn.textContent = BUFFS.busy ? `Making videos… ${left} left` : `Make all videos (${left} left)`;
}

function bfVideo(n) {
  if (bfHas(n)) return `<video src="/api/buff_video?name=${encodeURIComponent(n)}" autoplay loop muted playsinline></video>`;
  if (bfFailed(n)) return `<div class="bfnone">This effect could not be drawn outside the game.</div>`;
  if (!BUFFS.available) return `<div class="bfnone">The Unity player is missing — no videos.</div>`;
  return `<div class="bfnone">${BUFFS.current.includes(n) ? "Drawing…" : "In line…"}<div class="progress"><div style="width:${BUFFS.current.includes(n) ? 60 : 10}%"></div></div></div>`;
}

function drawBuff() {
  const box = $("#bfcard"), b = BUFFS.list.find((x) => x.id === bfv.sel);
  if (!box || !b) { if (box) box.innerHTML = ""; return; }
  const same = BUFFS.list.filter((x) => x !== b && x.fx.some((n) => b.fx.includes(n)));
  const link = (w) => w.k === "enemy" ? `#/enemies/${w.id}` : `#/db/${w.k === "ego" ? "ego" : "id"}/${w.id}`;
  // (an enemy by its battle look, as the handbook shows it, when the app has that picture; else the game's portrait)
  const pic = (w) => { const p = w.pic ? imgThumb(w.pic) : "", t = w.app ? `/api/enemy_thumb?app=${encodeURIComponent(w.app)}` : "";
    return t || p ? `<img loading="lazy" src="${t || p}" data-alt="${t ? p : ""}" onerror="if (this.dataset.alt) { this.src = this.dataset.alt; this.dataset.alt = ''; } else this.remove()">` : ""; };
  const group = (k, title) => {
    const ws = b.who.filter((w) => w.k === k);
    return ws.length ? `<h4>${title}</h4><div class="bfwho">${ws.map((w) =>
      `<a href="${link(w)}" title="${esc(w.name)}">${pic(w)}<span>${esc(w.name)}</span></a>`).join("")}</div>` : "";
  };
  box.innerHTML = `<div class="bfhead">${b.icon ? `<img src="${imgThumb(b.icon)}" onerror="this.remove()">` : ""}
      <div><h2 class="${b.type}">${esc(bfName(b))}</h2><div class="muted small">${BF_WORD[b.type]} · <span class="mono">${esc(b.id)}</span></div></div></div>
    <div class="bfvids">${b.fx.map((n) => `<figure data-fx="${esc(n)}">${bfVideo(n)}<figcaption class="mono">${esc(n)}</figcaption></figure>`).join("")}</div>
    ${b.desc ? `<div class="panel"><div class="kwdesc">${fmtDesc(b.desc)}</div>${b.flavor ? `<div class="kwflavor">${esc(b.flavor)}</div>` : ""}</div>` : ""}
    ${b.who.length ? `<div class="panel">${group("id", "Identities")}${group("ego", "E.G.O")}${group("enemy", "Enemies")}</div>`
      : `<div class="muted small">No Identity or handbook enemy names this buff in its skills.</div>`}
    ${same.length ? `<div class="panel"><h4>Same effect</h4><div class="kwrow">${same.map((x) => `<a class="kw ${x.type} big" href="#/buffs/${encodeURIComponent(x.id)}">${esc(bfName(x))}</a>`).join("")}</div></div>` : ""}`;
  // the picked buff's videos are made first
  const todo = b.fx.filter((n) => !bfHas(n) && !bfFailed(n) && !BUFFS.current.includes(n));
  if (todo.length && BUFFS.available && bfv.asked !== b.id) {
    bfv.asked = b.id;
    api("/api/buffs", { names: todo, first: true }).then((st) => { Object.assign(BUFFS, st); bfProgress(); bfPoll(); }).catch(() => {});
  }
}

// while videos are being made: the status every 2 s; a finished one appears in the open card and on its tile
function bfPoll() {
  if (bfPoll.t || !BUFFS || !BUFFS.busy) return;
  bfPoll.t = setTimeout(async () => {
    bfPoll.t = null;
    if (!location.hash.startsWith("#/buffs")) return;
    try { Object.assign(BUFFS, await api("/api/buffs?status=1")); } catch (e) { return; }
    bfProgress();
    bfMark();
    document.querySelectorAll("#bfcard figure[data-fx]").forEach((f) => {
      if (f.querySelector("video")) return;
      f.innerHTML = `${bfVideo(f.dataset.fx)}<figcaption class="mono">${esc(f.dataset.fx)}</figcaption>`;
    });
    bfPoll();
  }, 2000);
}
