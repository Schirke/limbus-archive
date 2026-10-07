"use strict";
// Story map (Database → Story map): a chapter's stage nodes where the game draws them on its map, and what a fight
// holds — the waves' enemies, arena and battle themes. Data: /api/stages (limbusdm/stages.py); the enemies' tiles are
// the handbook's (enemies.js).
let STAGES = null;
const stv = { ch: 0, node: 0, zoom: 1 };
const ST_ZOOM = [128, 192, 256, 384];  // a map tile's side on the page (the game's are 2048; the app keeps 384 px previews)
const ST_KIND = { fight: ["⚔", "Fight"], story: ["❝", "Story"], dungeon: ["◈", "Dungeon"], other: ["◇", "Special stage"] };
const stChapter = () => STAGES.chapters.find((c) => c.id === stv.ch) || STAGES.chapters[0];
const stNode = (c) => c.nodes.find((n) => n.id === stv.node);
const stEnemy = (uid) => { const id = STAGES.units[uid]; return id == null ? null : ENEMIES.list.find((e) => e.id === id); };

routes.stages = async (args) => {
  const main = $("#main");
  if (!STAGES || !ENEMIES) {
    main.innerHTML = `<div class="muted">Loading the map…</div>`;
    try { [STAGES, ENEMIES] = await Promise.all([api("/api/stages"), ENEMIES || api("/api/enemies"), units()]); }
    catch (e) { main.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  }
  if (!STAGES.chapters.length) { STAGES = null; main.innerHTML = `<div class="empty">Take a snapshot first — the map is read from it.</div>`; return; }
  const ch = +args[0] || stv.ch || STAGES.chapters[0].id, same = ch === stv.ch && $("#stcard");
  stv.ch = stChapter().id === ch ? ch : (STAGES.chapters.find((c) => c.id === ch) || STAGES.chapters[0]).id;
  const c = stChapter();
  stv.node = +args[1] && c.nodes.some((n) => n.id === +args[1]) ? +args[1]
    : same && stNode(c) ? stv.node : (c.nodes.find((n) => n.kind !== "story") || c.nodes[0]).id;
  if (same) { stMark(true); stCard(); } else stDraw();
};

function stDraw() {
  const c = stChapter(), main = STAGES.chapters.filter((x) => x.main), side = STAGES.chapters.filter((x) => !x.main);
  $("#main").innerHTML = `<h1>Story map</h1>
    <div class="sub">Every chapter as the game lays it out: pick a node to see who is fought there, on which arena and to which theme.</div>
    <div class="dbrow">${main.map((x) => `<a class="toggle ${x.id === c.id ? "on" : ""}" href="#/stages/${x.id}" title="${esc(x.label)}">${esc(x.number || x.label)}</a>`).join("")}
      <span class="gap"></span>
      <select id="stside"><option value="">Intervallo, Walpurgis Night…</option>${side.map((x) => `<option value="${x.id}" ${x.id === c.id ? "selected" : ""}>${esc((x.number ? x.number + " · " : "") + x.label)}</option>`).join("")}</select>
      <span class="grow"></span>
      ${c.cols ? `<button class="toggle" id="stout" title="Smaller">−</button><button class="toggle" id="stin" title="Bigger">+</button>` : ""}</div>
    <h2 class="sthead">${esc(c.label)}<em>${c.nodes.length} nodes · ${c.nodes.filter((n) => n.kind === "fight" || n.kind === "dungeon").length} with fights</em></h2>
    ${c.cols && Object.keys(c.tiles).length ? `<div class="stmap" id="stmap"></div>` : `<div class="muted small stnomap">The game has no map for this chapter: its stages are a plain list.</div>`}
    <div class="stwrap"><div id="stlist" class="stlist"></div><div id="stcard" class="encard"></div></div>`;
  $("#stside").onchange = (e) => { if (e.target.value) location.hash = `#/stages/${e.target.value}`; };
  if ($("#stin")) {
    $("#stin").onclick = () => { stv.zoom = Math.min(ST_ZOOM.length - 1, stv.zoom + 1); stMap(); stMark(true); };
    $("#stout").onclick = () => { stv.zoom = Math.max(0, stv.zoom - 1); stMap(); stMark(true); };
  }
  $("#stlist").innerHTML = c.nodes.map((n) => `<a href="#/stages/${c.id}/${n.id}" data-n="${n.id}" class="strow ${n.kind}">
      <span>${esc(n.n)}</span><i title="${ST_KIND[n.kind][1]}">${ST_KIND[n.kind][0]}</i><b>${esc(n.title || ST_KIND[n.kind][1])}</b>${n.lv ? `<span class="r">Lv ${n.lv}</span>` : ""}</a>`).join("");
  stMap();
  stMark(true);
  stCard();
}

function stMap() {
  const box = $("#stmap"), c = stChapter();
  if (!box) return;
  const t = ST_ZOOM[stv.zoom], k = t / STAGES.tile, w = c.cols * t, h = c.rows * t;
  const at = (n) => [Math.round(n.x * k), Math.round(n.y * k)];
  box.innerHTML = `<div class="stcanvas" style="width:${w}px;height:${h}px">
      ${Object.entries(c.tiles).map(([rc, path]) => { const [r, col] = rc.split("_");
        return `<img loading="lazy" draggable="false" src="${imgThumb(path)}" style="left:${col * t}px;top:${r * t}px;width:${t}px;height:${t}px" onerror="this.remove()">`; }).join("")}
      <svg width="${w}" height="${h}"><polyline points="${c.nodes.map((n) => at(n).join(",")).join(" ")}"/></svg>
      ${c.nodes.map((n, i) => { const [x, y] = at(n);
        return `<a class="stnode ${n.kind}" href="#/stages/${c.id}/${n.id}" data-n="${n.id}" style="left:${x}px;top:${y}px" title="${esc(`${n.n} · ${n.title || ST_KIND[n.kind][1]}`)}">${n.kind === "story" ? "" : esc(n.n.split("-").pop())}</a>`; }).join("")}
    </div>`;
  box.style.height = Math.min(h, 360) + 18 + "px";
  // the map is dragged about like in the game (a click on a node still opens it)
  let drag = null;
  box.onpointerdown = (e) => { drag = { x: e.clientX, y: e.clientY, l: box.scrollLeft, t: box.scrollTop, moved: false }; };
  box.onpointermove = (e) => {
    if (!drag || !(e.buttons & 1)) { drag = null; return; }
    if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 4) drag.moved = true;
    if (drag.moved) { box.scrollLeft = drag.l - (e.clientX - drag.x); box.scrollTop = drag.t - (e.clientY - drag.y); box.classList.add("drag"); }
  };
  box.onpointerup = box.onpointerleave = () => { setTimeout(() => box.classList.remove("drag"), 0); };
  box.onclick = (e) => { if (drag && drag.moved) e.preventDefault(); drag = null; };
}

function stMark(scroll) {
  document.querySelectorAll("#stlist [data-n], #stmap [data-n]").forEach((a) => a.classList.toggle("on", +a.dataset.n === stv.node));
  if (!scroll) return;
  const box = $("#stmap"), dot = box && box.querySelector(".stnode.on"), row = $("#stlist .on");
  if (dot) box.scrollTo({ left: dot.offsetLeft - box.clientWidth / 2, top: dot.offsetTop - box.clientHeight / 2, behavior: "smooth" });
  if (row) row.parentElement.scrollTop = row.offsetTop - row.parentElement.clientHeight / 2;  // (scrollIntoView would move the page too)
}

// a fight (a node's own, or one inside a dungeon): its waves with arena, themes and enemies
function stFight(f, n) {
  const tile = ([uid, count, lv]) => {
    const e = stEnemy(uid);
    return e ? `<a class="entile" href="#/enemies/${e.id}" title="${esc(`${e.name} · Lv ${lv}`)}">${enTileImg(e)}<span>${count > 1 ? `×${count} · ` : ""}Lv ${lv}</span><b>${esc(e.name)}</b></a>`
      : `<div class="entile" title="Not in the handbook (no name in the game's files)"><span>${count > 1 ? `×${count} · ` : ""}Lv ${lv}</span><b>Unit ${uid}</b></div>`;
  };
  return f.waves.map((w, i) => {
    const themes = [...new Set(w.bgm)].map((ev) => { const t = STAGES.tracks[ev], tr = t != null && mu.tracks[t];
      return tr ? `<button class="sttrack" data-track="${t}" title="Play in the corner player">♪ ${esc(tr.name)}</button>` : `<span class="muted small" title="No recording found for this theme">♪ ${esc(ev.replace(/_/g, " "))}</span>`; }).join("");
    const versus = w.units.some(([uid]) => (stEnemy(uid) || {}).anim);
    return `<div class="stwave"><div class="stwhead"><b>${f.waves.length > 1 ? `Wave ${i + 1}` : "Enemies"}</b>
        ${w.map ? `<span title="${esc(w.map)}">${esc(vsMapLabel(w.map))}</span>` : ""}<span class="grow"></span>
        ${versus ? `<button data-vs="${n}:${i}" title="Versus with this fight's enemy, arena and theme already picked">Play in Versus ⚔</button>` : ""}</div>
      ${themes ? `<div class="stthemes">${themes}</div>` : ""}
      <div class="stunits">${w.units.map(tile).join("") || `<div class="muted small">No enemies listed.</div>`}</div>
      ${w.more.length ? `<div class="enh">Reinforcements</div><div class="stunits more">${w.more.map(tile).join("")}</div>` : ""}</div>`;
  }).join("");
}

function stCard() {
  const box = $("#stcard"), c = stChapter(), n = stNode(c);
  if (!box || !n) return;
  const fights = n.kind === "dungeon" ? n.fights || [] : n.waves ? [n] : [];
  const i = c.nodes.indexOf(n), near = (d, s) => c.nodes[i + d] ? `<a class="toggle" href="#/stages/${c.id}/${c.nodes[i + d].id}">${s}</a>` : "";
  box.innerHTML = `<div class="enkick">${esc(c.label)} · ${ST_KIND[n.kind][1]}</div>
    <h2 class="enname">${esc(n.n)}${n.title ? " · " + esc(n.title) : ""}${n.lv ? `<em>LV ${n.lv}</em>` : ""}</h2>
    <div class="entags">${near(-1, "‹ Previous")}${near(1, "Next ›")}<span class="muted">node ${n.id}${n.stage ? ` · stage ${n.stage}` : ""}${n.turns && n.turns < 99 ? ` · ${n.turns} turns` : ""}</span></div>
    ${n.kind === "story" ? `<div class="muted stnote">A story scene: nobody is fought here.</div>`
      : n.kind === "other" ? `<div class="muted stnote">A stage with rules of its own, not a regular fight.</div>`
      : n.kind === "dungeon" ? `<div class="muted stnote">A dungeon with a map of its own: ${fights.length} different fights inside.</div>`
        + fights.map((f, k) => `<div class="enh">${esc(f.what)} · Lv ${f.lv}</div>${stFight(f, k)}`).join("")
      : fights.length ? stFight(n, 0) : `<div class="muted stnote">The game's files list no fight for this node.</div>`}`;
  box.scrollTop = 0;
  box.querySelectorAll("[data-track]").forEach((b) => b.onclick = () => muPlay(+b.dataset.track));
  box.querySelectorAll("[data-vs]").forEach((b) => b.onclick = async () => {
    const [f, w] = b.dataset.vs.split(":").map(Number), wave = fights[f].waves[w];
    // the fight's own boss when it has one, else the first enemy the renderer can play
    const foes = wave.units.map(([uid]) => stEnemy(uid)).filter((e) => e && e.anim);
    vs.right = (foes.find((e) => e.kind !== "Enemy") || foes[0]).app;
    if (STAGES.maps.includes(wave.map)) vs.map = wave.map;
    if (!vs.bgm) vs.bgm = await api("/api/bgm_tracks").catch(() => null);
    const theme = wave.bgm.map((ev) => STAGES.tracks[ev]).filter((t) => t != null).map((t) => (vs.bgm || []).find((m) => m.n === t)).find(Boolean);
    if (theme) vs.music = theme.name;
    vsKeep();
    location.hash = "#/versus";
  });
}
