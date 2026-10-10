"use strict";
// Enemy handbook (Database → Enemies): a portrait grid on the left, the picked one's card on the right.
// Data: /api/enemies (limbusdm/enemies.py) — read from the game's own tables, so it follows every patch.
let ENEMIES = null;
const env = { q: "", sort: "canto", dir: 1, group: "", sel: 0, variant: 0, level: 0, tab: "res" };
const EN_SORTS = [["canto", "Canto"], ["name", "Name"], ["hp", "HP"], ["speed", "Speed"], ["level", "Level"]];
const EN_SHORT = [[/^Canto (\d+).*/, "C$1"], [/^Mirror Dungeon (\d+)/, "MD$1"], [/^Refraction Railway (\d+)/, "RR$1"],
  [/^Walpurgis Night (\d+)/, "WN$1"], [/^Luxcavation/, "LUX"], [/^Not placed.*/, "—"]];
const enShort = (label) => { for (const [re, to] of EN_SHORT) if (re.test(label)) return label.replace(re, to); return label.length > 12 ? label.slice(0, 11) + "…" : label; };
const enHp = (b, level) => Math.floor(b.hp + (b.hpLevel || 0) * level);
const enFirst = (e) => e.variants[0];

routes.enemies = async (args) => {
  const main = $("#main");
  // (which enemies are Spine-drawn is known only once the app has linked the skeletons, about a minute after its first start)
  if (ENEMIES && !$("#engrid") && !ENEMIES.list.some((e) => e.spine)) ENEMIES = null;
  if (!ENEMIES) {
    main.innerHTML = `<div class="muted">Loading the handbook…</div>`;
    try { [ENEMIES] = await Promise.all([api("/api/enemies"), units()]); } catch (e) { main.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  }
  if (!ENEMIES.list.length) { ENEMIES = null; main.innerHTML = `<div class="empty">Take a snapshot first — the handbook is read from it.</div>`; return; }
  if (args[0] && +args[0] !== env.sel) Object.assign(env, { sel: +args[0], variant: 0, level: 0 });
  if (!$("#engrid")) drawEnemies();
  else { markEnemy(); drawEnemy(); }
};

function enFiltered() {
  const q = env.q.trim().toLowerCase();
  const arr = ENEMIES.list.filter((e) => (!env.group || e.group === env.group)
    && (!q || `${e.name} ${e.app} ${e.id} ${e.label} ${enFirst(e).tags.join(" ")} ${enFirst(e).assoc.join(" ")}`.toLowerCase().includes(q)));
  const v = enFirst, by = {
    name: (a, b) => a.name.localeCompare(b.name),
    hp: (a, b) => enHp(v(a), v(a).level) - enHp(v(b), v(b).level),
    speed: (a, b) => (v(a).speed[1] || 0) - (v(b).speed[1] || 0) || (v(a).speed[0] || 0) - (v(b).speed[0] || 0),
    level: (a, b) => v(a).level - v(b).level,
  }[env.sort];
  if (by) arr.sort((a, b) => env.dir * by(a, b));  // "canto" is the order the list comes in
  else if (env.dir < 0) arr.reverse();
  return arr;
}

function drawEnemies() {
  $("#main").innerHTML = `<h1>Enemy handbook</h1>
    <div class="sub">Every enemy, boss and abnormality from the game's own files: stats, resistances, skills and where it is fought.</div>
    <input type="search" id="enq" class="dbq" placeholder="Search: name, faction, keyword…" value="${esc(env.q)}">
    <div class="dbrow">${EN_SORTS.map(([k, n]) => `<button class="toggle ${env.sort === k ? "on" : ""}" data-sort="${k}">${n}${env.sort === k ? (env.dir > 0 ? " ↑" : " ↓") : ""}</button>`).join("")}
      <span class="grow"></span>
      <select id="engroup"><option value="">Anywhere</option>${ENEMIES.groups.map((g) => `<option ${env.group === g ? "selected" : ""}>${esc(g)}</option>`).join("")}</select></div>
    <div class="enwrap"><div><div class="muted small" id="encount"></div><div id="engrid" class="engrid"></div></div><div id="encard" class="encard"></div></div>`;
  const main = $("#main");
  main.querySelectorAll("[data-sort]").forEach((b) => b.onclick = () => { const k = b.dataset.sort; env.dir = env.sort === k ? -env.dir : 1; env.sort = k; drawEnemies(); });
  $("#engroup").onchange = (e) => { env.group = e.target.value; drawEnemyGrid(); };
  let t;
  $("#enq").oninput = (e) => { clearTimeout(t); t = setTimeout(() => { env.q = e.target.value; drawEnemyGrid(); }, 200); };
  drawEnemyGrid();
  enThumbs();
  enDrawn();
}
// sprite enemies without a portrait (the Arknights collab's, …): the app draws their idle pose with the player
// (a few seconds each, in the background); their tiles fill in as the pictures come
async function enDrawn() {
  while (ENEMIES && ENEMIES.making && location.hash.startsWith("#/enemies") && !enDrawn.busy) {
    enDrawn.busy = true;
    await new Promise((ok) => setTimeout(ok, 8000));
    enDrawn.busy = false;
    const d = await api("/api/enemies").catch(() => null);
    if (!d || !ENEMIES) return;
    const fresh = d.thumbs.filter((a) => !ENEMIES.thumbs.includes(a));
    Object.assign(ENEMIES, { thumbs: d.thumbs, making: d.making });
    for (const o of ENEMIES.list) {
      const tile = fresh.includes(o.app) && document.querySelector(`.entile[data-e="${o.id}"]`);
      if (!tile) continue;
      const img = tile.querySelector("img");
      if (img) img.remove();
      tile.insertAdjacentHTML("afterbegin", enTileImg(o));
      if (o.id === env.sel) drawEnemy();
    }
  }
}

function drawEnemyGrid() {
  const arr = enFiltered();
  $("#encount").textContent = `${arr.length} of ${ENEMIES.list.length}`;
  $("#engrid").innerHTML = arr.map((e) => `<a class="entile" href="#/enemies/${e.id}" data-e="${e.id}" title="${esc(`${e.name} · ${e.label}`)}">
      ${enTileImg(e)}<span>${esc(enShort(e.label))}</span><b>${esc(e.name)}</b></a>`).join("")
    || `<div class="empty">Nothing matches.</div>`;
  if (!arr.some((e) => e.id === env.sel) && arr.length) Object.assign(env, { sel: arr[0].id, variant: 0, level: 0 });
  markEnemy();
  drawEnemy();
}
const enThumbUrl = (e) => `/api/enemy_thumb?app=${encodeURIComponent(e.app)}`;
const enTileImg = (e) => ENEMIES.thumbs.includes(e.app) && (e.spine || !e.pic) ? `<img class="sp" loading="lazy" src="${enThumbUrl(e)}" onerror="this.remove()">`
  : e.pic ? `<img loading="lazy" src="${imgThumb(e.pic)}" onerror="this.remove()">` : "";
function markEnemy() {
  document.querySelectorAll("#engrid .entile").forEach((a) => a.classList.toggle("on", +a.dataset.e === env.sel));
}

const enRes = (v) => { const [l, c] = RESIST(v); return [l.toUpperCase(), c]; };
// the two resistance rows of a unit or of one part of an abnormality
function enResists(b) {
  const atk = ["Slash", "Pierce", "Blunt"].filter((k) => b.atk[k] != null), sins = UNITS.sins.filter((k) => b.sin[k] != null);
  return (atk.length ? `<div class="enres">${atk.map((k) => { const [w, c] = enRes(b.atk[k]);
      return `<div class="${c}">${ico(`res_${k}`, "s28", k, k)}<span>${k} ×${b.atk[k]}<small>${w}</small></span></div>`; }).join("")}</div>` : "")
    + (sins.length ? `<div class="enres sin">${sins.map((k) => { const [w, c] = enRes(b.sin[k]);
      return `<div class="${c}">${sinIcon(k, "s24")}×${b.sin[k]}<small>${w}</small></div>`; }).join("")}</div>` : "");
}
const enStagger = (b, level) => b.stagger.length ? b.stagger.map((p) => `${Math.floor(enHp(b, level) * p / 100)} <small>${p}%</small>`).join(" · ") : "—";

// ---- the Spine idle pose in the card (most enemies are Spine skeletons; the rest are sprites: the game's portrait)
const enSpinePick = (list) => (list || []).find((x) => !/destroy|dead|broken|_die/i.test(x.base)) || (list || [])[0];
let enPlayer = null;
function enSpineStop() { if (enPlayer) { try { enPlayer.dispose(); } catch (e) { /* already gone */ } enPlayer = null; } }
window.addEventListener("hashchange", () => { if (!location.hash.startsWith("#/enemies")) enSpineStop(); });
async function enSpineStart(x, box) {
  enSpineStop();
  let sp;
  try { sp = await loadSpinePlayer(); } catch (e) { box.remove(); return; }
  const p = await addSpinePlayer(sp, box, x.bundle, x.atlas, null, {});
  if (!box.isConnected) { if (p) p.dispose(); return; }  // another enemy was picked meanwhile
  enPlayer = p;
}
// The grid shows a Spine-drawn enemy as it looks in battle, not by the game's portrait (line art for many, none for
// the newest chapter's): the page takes a picture of each idle pose, a few at a time, and the app keeps it
// (data/enemy_thumbs).
function enNoThumb(e) {
  e.nothumb = true;
  api("/api/enemy_thumb", { app: e.app, none: true }).catch(() => {});
}
async function enThumbs() {
  if (enThumbs.busy) return;
  const none = new Set(ENEMIES.nothumb || []);  // (found without a pose before: the app remembers)
  const todo = ENEMIES.list.filter((e) => (e.spine || !e.pic) && e.app && !ENEMIES.thumbs.includes(e.app) && !e.nothumb && !none.has(e.app));
  if (!todo.length) return;
  enThumbs.busy = true;
  const seen = new Set();  // (entries can share a look)
  const work = async (sp) => {
    const host = Object.assign(document.createElement("div"), { className: "enshot" });
    document.body.appendChild(host);
    try {
      while (todo.length && location.hash.startsWith("#/enemies")) {
        const e = todo.shift();
        if (seen.has(e.app)) continue;
        seen.add(e.app);
        const texts = e.texts || await api(`/api/enemy?id=${e.id}`).catch(() => null);
        const x = enSpinePick(texts && texts.spine);
        if (!x) { enNoThumb(e); continue; }
        host.innerHTML = "";
        const p = await addSpinePlayer(sp, host, x.bundle, x.atlas, null, {});
        if (!p) { e.nothumb = true; continue; }  // (the player didn't start: tried again another time)
        await new Promise((ok) => setTimeout(ok, 1200));  // (the player fades its loading logo out first)
        const data = host.querySelector("canvas").toDataURL("image/png");
        p.dispose();
        await api("/api/enemy_thumb", { app: e.app, data });
        ENEMIES.thumbs.push(e.app);
        for (const o of ENEMIES.list) {
          const tile = o.app === e.app && document.querySelector(`.entile[data-e="${o.id}"]`);
          if (!tile) continue;
          const img = tile.querySelector("img");
          if (img) img.remove();
          tile.insertAdjacentHTML("afterbegin", enTileImg(o));
        }
      }
    } catch (err) { /* this one's player broke: the others go on */ }
    host.remove();
  };
  try {
    const sp = await loadSpinePlayer();
    await Promise.all([0, 1, 2].map(() => work(sp)));
  } catch (e) { /* no player (offline): the tiles keep the portraits */ }
  enThumbs.busy = false;
}

async function drawEnemy() {
  const box = $("#encard"), e = ENEMIES.list.find((x) => x.id === env.sel);
  if (!box) return;
  if (!e) { enSpineStop(); box.innerHTML = ""; return; }
  if (!e.texts) e.texts = await api(`/api/enemy?id=${e.id}`).catch(() => ({ skills: {}, passives: {}, spine: [] }));
  if (env.sel !== e.id || !$("#encard")) return;
  const v = e.variants[env.variant] || e.variants[0];
  const level = env.level || v.level, hp = enHp(v, level);
  const sk = (ids) => ids.map((i) => e.texts.skills[i]).filter(Boolean), pa = (ids) => ids.map((i) => e.texts.passives[i]).filter(Boolean);
  const skills = [...sk(v.skills).map((s) => [s, ""]), ...sk(v.defense).map((s) => [s, "Defense"]),
    ...v.parts.flatMap((p) => sk(p.skills).map((s) => [s, p.name || p.type]))];
  const passives = [...pa(v.passives).map((p) => [p, ""]), ...v.parts.flatMap((p) => pa(p.passives).map((x) => [x, p.name || p.type]))];
  const stat = (name, val, icon = "") => `<div>${icon}${name}<b>${val}</b></div>`;
  const tabs = [["res", "Resistances"], ["skills", `Skills ${skills.length}`], ["passives", `Passives ${passives.length}`], ["stages", "Stages"]];
  const multi = v.parts.length > 1;
  let body = "";
  if (env.tab === "res") {
    body = multi ? v.parts.map((p) => `<div class="enpart"><div class="enparthead"><b>${esc(p.name || p.type || "Part")}</b>
          <span>${ico("hp", "s18", "HP", "HP")}${enHp(p, level)}</span>${p.speed.length ? `<span>Speed ${p.speed.join("-")}</span>` : ""}
          <span>Stagger ${enStagger(p, level)}</span>${p.breakable ? `<span class="rweak">breakable</span>` : ""}</div>${enResists(p)}</div>`).join("")
      : `<div class="enh">Damage type · Sin</div>${enResists(v) || `<div class="muted">No resistances listed.</div>`}`;
    if (v.sanity) body += `<div class="enh">Sanity</div><div class="enstage"><b>${v.sanity.name ? esc(v.sanity.name) : "Sanity"}</b>
        <span>starts at ${v.sanity.start}${v.sanity.low != null ? ` · low morale at ${v.sanity.low}` : ""}${v.sanity.panic != null ? ` · panic at ${v.sanity.panic}` : ""}</span></div>
      ${v.sanity.lowDesc ? `<div class="skdesc enpanic"><span class="muted">Low morale:</span> ${fmtDesc(v.sanity.lowDesc, true)}</div>` : ""}
      ${v.sanity.panicDesc ? `<div class="skdesc enpanic"><span class="muted">Panic:</span> ${fmtDesc(v.sanity.panicDesc, true)}</div>` : ""}`;
  } else if (env.tab === "skills") {
    body = skills.map(([s, label]) => skillView(s, 1, level, label, e.pic, true)).join(`<div class="sksep"></div>`) || `<div class="muted">No skills with a name in the game's files.</div>`;
  } else if (env.tab === "passives") {
    body = passives.map(([p, label]) => passiveHtml(p, true).replace("Battle passive", label ? esc(label) : "Passive")).join("") || `<div class="muted">No passives.</div>`;
  } else {
    body = v.stages.map((s) => `<div class="enstage"><b>${esc(s.label)}</b><span>${s.n} stage${s.n > 1 ? "s" : ""} · Lv ${s.lv[0]}${s.lv[1] !== s.lv[0] ? `–${s.lv[1]}` : ""}</span></div>
        ${s.stages.map((x) => `<div class="enstage sub"><span>${/^1\d{4}$/.test(x.id) ? `${+String(x.id).slice(1, 3)}-${+String(x.id).slice(3)}` : x.id}</span><b>${esc(x.title || "")}</b><span>${esc(x.place || "")}</span><span class="r">Lv ${x.lv}</span></div>`).join("")}`).join("")
      || `<div class="muted">Not placed in any stage of the current version.</div>`;
  }
  const spine = enSpinePick(e.texts.spine), old = box.querySelector(".enspine");
  const keep = old && old.dataset.e === `${e.id}` && enPlayer ? old : null;  // the same enemy: its player goes on playing
  box.innerHTML = `<div class="enkick">${esc(v.label)}${v.cls ? ` · ${esc(v.cls)}` : ""}</div>
    <h2 class="enname">${esc(e.name)}<em>LV ${level}</em></h2>
    <div class="entags">${[...v.assoc, ...v.tags].map((t) => `<span>${esc(t)}</span>`).join("")}<span class="muted">id ${v.ids.slice(0, 4).join(", ")}${v.ids.length > 4 ? "…" : ""}</span></div>
    <div class="enhead">${spine ? "" : `<div class="enpic">${e.pic ? `<img src="${imgFull(e.pic)}" onerror="this.remove()">` : ENEMIES.thumbs.includes(e.app) ? `<img src="${enThumbUrl(e)}" onerror="this.remove()">` : ""}</div>`}
      ${spine ? `<div class="enspine wide" data-e="${e.id}" title="Its idle pose (Spine). All its animations: the Animations page"></div>` : ""}
      <div class="enstats">${stat("HP", hp, ico("hp", "s20", "HP", ""))}${stat("Speed", v.speed.length ? v.speed.join("-") : "—")}
        ${stat("Def level", `${level + v.def}<small>${v.def >= 0 ? "+" : ""}${v.def}</small>`, ico("def", "s20", "Defense level", ""))}${stat("Stagger", enStagger(v, level))}
        ${stat("Skills", skills.length)}${stat("Slots", v.slots)}</div></div>
    <div class="lvpanel enlv">${e.variants.length > 1 ? `<select id="envar" title="The same enemy with other numbers">${e.variants.map((x, i) => `<option value="${i}" ${x === v ? "selected" : ""}>${esc(x.label)} · Lv ${x.level} · HP ${enHp(x, x.level)}</option>`).join("")}</select>` : ""}
      <span class="lvlabel lv">Lv. <b id="enlvn">${level}</b></span><input type="range" id="enlvr" min="1" max="${Math.max(99, level)}" value="${level}">
      ${e.anim ? `<button id="enanim" title="Its skills with the game's effects">Animations →</button>` : ""}</div>
    <div class="entabs">${tabs.map(([k, n]) => `<button class="${env.tab === k ? "on" : ""}" data-tab="${k}">${n}</button>`).join("")}</div>
    <div class="enbody">${body}</div>`;
  if (keep) box.querySelector(".enspine").replaceWith(keep);
  else if (spine) enSpineStart(spine, box.querySelector(".enspine"));
  else enSpineStop();
  box.querySelectorAll("[data-tab]").forEach((b) => b.onclick = () => { env.tab = b.dataset.tab; drawEnemy(); });
  if ($("#envar")) $("#envar").onchange = (ev) => { env.variant = +ev.target.value; env.level = 0; drawEnemy(); };
  $("#enlvr").oninput = (ev) => { env.level = +ev.target.value; $("#enlvn").textContent = env.level; };
  $("#enlvr").onchange = () => drawEnemy();
  if ($("#enanim")) $("#enanim").onclick = () => { anim.sel = { key: `e${e.app}`, cid: e.app, enemy: { app: e.app, name: e.name } }; location.hash = "#/anim"; };
}
