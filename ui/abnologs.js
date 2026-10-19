"use strict";
// Story → Abnormality logs: the Sinners' observation logs of each Abnormality and who wrote them (/api/abno_logs).
const al = { data: null, q: "", risk: "", who: "", sel: 0, lv: 0, player: null };
const AL_RISKS = ["ZAYIN", "TETH", "HE", "WAW", "ALEPH"];

routes.abnologs = async (args = []) => {
  const main = $("#main");
  if (!al.data) {
    main.innerHTML = `<h1>Abnormality logs</h1><div class="sub">Reading the game's files…</div>`;
    try {
      al.data = await api("/api/abno_logs");
      al.pic = {};  // (the enemy handbook's entries, when its list is already here: a link to it)
      const en = typeof ENEMIES !== "undefined" && ENEMIES;
      for (const e of (en || {}).list || []) for (const v of e.variants || []) for (const id of v.ids || []) al.pic[id] = al.pic[id] || e;
    } catch (e) { main.innerHTML = `<h1>Abnormality logs</h1><div class="empty">${esc(e.message)}</div>`; return; }
    if (!location.hash.startsWith("#/abnologs")) return;
  }
  if (!al.data.list.length) { al.data = null; main.innerHTML = `<h1>Abnormality logs</h1><div class="empty">Take a snapshot first — the logs are read from it.</div>`; return; }
  const pick = al.data.list.find((a) => a.ids.includes(+args[0]));
  if (pick && pick.id !== al.sel) Object.assign(al, { sel: pick.id, lv: 0 });
  alDraw();
  if (pick && innerWidth <= 900) { const r = $(".alread"); if (r) r.scrollIntoView({ block: "start" }); }
};
window.addEventListener("hashchange", () => { if (!location.hash.startsWith("#/abnologs")) alSpineStop(); });

// names come translated with the texts: compared in English
const alWho = (x) => langEn(x.who || "");
const alWriters = (a) => [...new Set(a.logs.map(alWho).filter(Boolean))];
const alSid = (who) => al.data.sinners.indexOf(who) + 1;
const alFace = (who, cls = "s22") => alSid(who) ? ico(`sinner_${alSid(who)}`, cls, who, who.slice(0, 2)) : `<span class="alother" title="${esc(who)}">${esc(who || "?")}</span>`;
// a portrait, else the enemy handbook's drawn battle look, else the code
function alPic(a, cls) {
  const src = a.tile;
  const code = `<i>${esc(a.code || "?")}</i>`;
  return `<div class="alpic ${cls}">${src ? `<img loading="lazy" src="${src}" onerror="this.outerHTML=this.dataset.no" data-no="${esc(code)}">` : code}</div>`;
}
// the reader's big picture: the Abnormality's Spine look playing, the still picture until it loads
function alSpineStop() { if (al.player) { try { al.player.dispose(); } catch (e) { /* already gone */ } al.player = null; } }
async function alSpine(a) {
  alSpineStop();
  const box = $(".alhead .alpic");
  if (!a.spine || !box || typeof loadSpinePlayer !== "function") return;
  let sp;
  try { sp = await loadSpinePlayer(); } catch { return; }
  const host = Object.assign(document.createElement("div"), { className: "alsp" });
  box.appendChild(host);
  const p = await addSpinePlayer(sp, host, a.spine.bundle, a.spine.atlas, null, { files: a.spine.files }).catch(() => null);
  if (!host.isConnected || al.sel !== a.id) { if (p) p.dispose(); return; }
  if (!p) { host.remove(); return; }
  al.player = p;
  box.classList.add("playing");
}
// each speaker's colour for the replies inside a log
const AL_COLOR = { "Yi Sang": "#a9cbe6", Faust: "#f2a9b9", "Don Quixote": "#f3d36b", "Ryōshū": "#e4605a", Meursault: "#7d9be0", "Hong Lu": "#6fcfae",
  Heathcliff: "#a98ad6", Ishmael: "#f2a85a", Rodion: "#d9706a", Sinclair: "#c4d36c", Outis: "#8fb486", Gregor: "#c9a073", Dante: "#e6dccb" };
// the log's text: the game's <i>; a reply ("→ …") in its speaker's colour with the name after it
function alText(t, replies = []) {
  let n = 0;
  return t.split("\n").map((raw) => {
    const line = raw.replace(/<(?!\/?i>)[^>]*>/g, "").replace(/^(\s*<i>)?\s*(→)/, "$2$1");  // (translations wrap lines in <color> and <i>)
    const s = esc(line).replace(/&lt;(\/?)i&gt;/g, "<$1i>");
    if (!/^\s*→/.test(line)) return s.trim() ? `<p>${s}</p>` : "";
    const who = replies[n++] || "";
    return `<p class="alreply" ${AL_COLOR[who] ? `style="color:${AL_COLOR[who]}"` : ""}>${s.replace(/^\s*/, "")}${who ? ` <span class="alsay">[${esc(who)}]</span>` : ""}</p>`;
  }).join("");
}
const alLevel = (x) => (x.lv ? `Observation level ${x.lv}` : "Lacking data");

function alList() {
  const q = al.q.trim().toLowerCase();
  return al.data.list.filter((a) => (!al.risk || a.risk === al.risk) && (!al.who || a.logs.some((x) => alWho(x) === al.who))
    && (!q || `${a.name} ${a.code}`.toLowerCase().includes(q)));
}

function alDraw() {
  const list = alList(), main = $("#main"), top = ($(".algrid") || {}).scrollTop || 0;
  if (!list.some((a) => a.id === al.sel)) Object.assign(al, { sel: (list[0] || {}).id || 0, lv: 0 });
  const a = al.data.list.find((x) => x.id === al.sel);
  const writers = [...al.data.sinners.filter((w) => al.data.list.some((x) => x.logs.some((l) => alWho(l) === w))), ...al.data.others];
  // the list in Story order, a heading where the Canto (or the mode) changes
  let last = "";
  const cards = list.map((x) => { const head = x.where[0] !== last ? `<div class="algroup">${esc((last = x.where[0]))}</div>` : "";
    return `${head}<a class="alcard ${x.id === al.sel ? "on" : ""}" href="#/abnologs/${x.id}">${alPic(x, "sm")}
      <span><small>${esc(x.code || "??-??-??")}${x.risk ? ` · ${x.risk}` : ""}</small><b>${esc(x.name)}</b><em>${alWriters(x).map((w) => alFace(w, "s16")).join("")}</em></span></a>`; }).join("");
  main.innerHTML = `<h1>Abnormality logs</h1>
    <div class="sub">What the Sinners wrote about each Abnormality they faced, log by log. Who wrote a log is guessed from its style. Spoilers for the story.</div>
    <input type="search" id="alq" class="dbq" placeholder="Search a name or a code…" value="${esc(al.q)}">
    <div class="dbrow alfilters"><button class="toggle ${!al.risk ? "on" : ""}" data-risk="">Any risk</button>${AL_RISKS.filter((r) => al.data.list.some((x) => x.risk === r)).map((r) => `<button class="toggle ${al.risk === r ? "on" : ""}" data-risk="${r}">${ico(`grade_${r}`, "s18", r, r)}${r}</button>`).join("")}</div>
    <div class="dbrow alfilters"><button class="toggle ${!al.who ? "on" : ""}" data-who="">Any writer</button>${writers.map((w) => `<button class="toggle ${al.who === w ? "on" : ""}" data-who="${esc(w)}" title="${esc(w)}">${alFace(w, "s20")}</button>`).join("")}</div>
    <div class="alwrap"><div><div class="muted small">${list.length} of ${al.data.list.length}</div>
      <div class="algrid">${cards || `<div class="empty">Nothing matches.</div>`}</div></div>
      <div class="alread">${a ? alRead(a) : ""}</div></div>`;
  $(".algrid").scrollTop = top;
  alBindLog();
  main.querySelectorAll("[data-risk]").forEach((b) => b.onclick = () => { al.risk = b.dataset.risk; alDraw(); });
  main.querySelectorAll("[data-who]").forEach((b) => b.onclick = () => { al.who = al.who === b.dataset.who ? "" : b.dataset.who; alDraw(); });
  let t;
  $("#alq").oninput = (e) => { clearTimeout(t); t = setTimeout(() => { al.q = e.target.value; alDraw(); const q = $("#alq"); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }, 200); };
  if (a) alSpine(a); else alSpineStop();
}

function alRead(a) {
  const e = al.pic[a.id] || a.ids.map((i) => al.pic[i]).find(Boolean);
  return `<div class="alhead">${alPic(a, "big")}<div><small>${esc(a.code || "??-??-??-??")}</small><h2>${esc(a.name)}</h2>
      <div class="altags">${a.risk ? `<span>${ico(`grade_${a.risk}`, "s18", a.risk, "")}${a.risk}</span>` : ""}${a.where.map((w) => `<span>${esc(w)}</span>`).join("")}${e ? `<a href="#/enemies/${e.id}">Enemy handbook ›</a>` : ""}</div></div></div>
    ${a.clue ? `<div class="alclue"><small>CLUE</small>${alText(a.clue)}</div>` : ""}
    <section class="allog">${alLog(a)}</section>`;
}
// one level's log: its tab row, the text, who wrote it
function alLog(a) {
  if (!a.logs[al.lv]) al.lv = 0;
  const x = a.logs[al.lv], who = alWho(x);
  return `<div class="altabs">${a.logs.map((l, i) => `<button class="${i === al.lv ? "on" : ""}" data-allv="${i}">${alLevel(l)}</button>`).join("")}</div>
    <div class="altext">${alText(x.text, x.replies)}</div>
    <div class="alfoot">${who ? `Written by ${alFace(who, "s20")}<b>${esc(x.who)}</b>${x.guess ? ` <i title="Not sure about this one">(guess)</i>` : ""}` : `<span class="muted">Writer unknown</span>`}</div>`;
}
function alBindLog() {
  document.querySelectorAll("#main [data-allv]").forEach((b) => b.onclick = () => {
    al.lv = +b.dataset.allv;
    const a = al.data.list.find((x) => x.id === al.sel), box = $(".allog");
    if (a && box) { box.innerHTML = alLog(a); alBindLog(); }
  });
}
