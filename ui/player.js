// Animations → Play → Skills: pick a skill and it plays. The desktop app has the game's own player (Unity) set up once, its window
// laid over the stage box (limbusdm/embed.py); the website plays the videos the app rendered. Same page, same buttons.
// Server: /api/preview (state, start, stop), /api/preview_cmd, /api/preview_rect; /api/fx (renders, `urls` on the site).
const PLAY_MODES = ["fx", "effects", "battle"];
const PL_MODE_NAMES = [["fx", "Skills"], ["effects", "Effects"], ["battle", "Battle clips"]];
const PL_SPEEDS = [0.25, 0.5, 1, 2];
const PL_SPEC = { fps: 60 };
const pl = { c: null, site: false, group: "", names: [], st: null, state: null, key: "", poll: 0, rect: 0, shown: "", paused: false, loop: true,
  speed: 1, scrub: false, sets: null, ready: false, idle: 0, video: null, rendering: null, seekTo: null, seekCmd: 0, seekAt: 0, sending: false, again: null };

// a character the player can show: an Identity (E.G.O and enemies keep the list of videos)
const plEligible = (c) => !!c.owner || /^\d+$/.test(String(c.id)) && String(c.id)[0] !== "2";  // (a second form: its prefab, owner = its Identity)
const plMode = () => (PLAY_MODES.includes(anim.tab) ? anim.tab : "fx");

function plModeBar() {
  return `<span class="seg pl-modes">${PL_MODE_NAMES.map(([k, l]) => `<button class="toggle ${plMode() === k ? "on" : ""}" data-mode="${k}">${l}</button>`).join("")}</span>`;
}
function plModeClicks(root) {
  root.querySelectorAll("[data-mode]").forEach((b) => b.onclick = () => { anim.tab = b.dataset.mode; openAnimEntry(anim.sel); });
}

// the options that need a new player: the others are commands
function plKey() {
  return [anim.fxOpt?.tails && "tails", anim.fxOpt?.nobloom && "nobloom", anim.fxOpt?.alpha && "alpha", anim.fxOpt?.alpha && anim.fxOpt?.skillbg && "skillbg", anim.fxLevel > 0 && `lv${anim.fxLevel}`, anim.fxMod && `m-${anim.fxMod}`].filter(Boolean).join("_");
}
const plSlot = (n) => {
  const s = anim.slots?.[n];
  return s ? s.slot : "";
};
// "Skill 2 · name" → label, group; the badge of the list
const plBadge = (name) => {
  const m = /(?:^|_)S(\d+)(?:_\d{5})?$/.exec(name);
  const slot = m ? plSlot(m[1]) : "";
  const k = /^Skill (\d)/.exec(slot);
  return k ? k[1] : /^Defense/.test(slot) ? "D" : "·";
};
const plWhole = (name) => /(?:^|_)S\d+(?:_\d{5})?$/.test(name);

function plStop(kill) {
  clearInterval(pl.poll); clearInterval(pl.rect); pl.poll = pl.rect = 0;
  if (pl.video) pl.video = null;
  if (!pl.site) {
    api("/api/preview_rect", { show: false }).catch(() => {});
    if (kill) api("/api/preview", { stop: 1 }).catch(() => {});
    else { clearTimeout(pl.killTimer); pl.killTimer = setTimeout(() => { if (!$("#plstage")) api("/api/preview", { stop: 1 }).catch(() => {}); }, 60000); }  // (left for good: closed)
  }
  pl.shown = "";
}

async function openPlay(c, body) {
  clearTimeout(anim.fxTimer);
  plStop(false);
  const site = typeof siteDl === "function";
  Object.assign(pl, { c, site, group: "", ready: false, state: null, key: "", idle: 0, rendering: null });
  const mine = () => $("#abody") && anim.sel?.cid === (c.owner || c.id) && PLAY_MODES.includes(anim.tab);
  clearTimeout(pl.killTimer);
  // (everything this page needs is asked at once, the skill list included: it is the slow one)
  anim.fxBuffs = anim.fxBuffs || {};
  anim.formSlots = anim.formSlots || {};
  const names = site ? null : api(`/api/preview?id=${encodeURIComponent(c.id)}`).then((j) => j.groups.map((g) => g.name));
  if (names) names.catch(() => {});  // (its error is shown where it is read)
  const [slots, mods, sets] = await Promise.all([
    !site && c.owner ? anim.formSlots[c.id] || api(`/api/skill_slots?id=${encodeURIComponent(c.id)}`).catch(() => ({})) : null,  // (a form's skills have names of their own)
    site ? null : animMods(c.id),
    site ? api("/api/site_fx").then((j) => j[c.id] || []).catch(() => []) : null,
    anim.fxBuffs[c.id] ? null : api(`/api/fx_buffs?id=${encodeURIComponent(c.id)}`).catch(() => ({ levels: [], notes: {}, own: [] })).then((j) => { anim.fxBuffs[c.id] = j; }),
  ]);
  if (!site) {
    if (c.owner) { anim.formSlots[c.id] = slots; anim.slots = slots; } else if (anim.sel?.slots) anim.slots = anim.sel.slots;
    // the options of this character only: a character's mods that are gone
    if (anim.fxMod && !mods.mods.some((m) => m.name === anim.fxMod)) anim.fxMod = "";
  } else {
    pl.sets = sets;
    anim.fxSolo = false; anim.fxLevel = 0; anim.fxMod = "";
    anim.fxOpt = { buffs: pl.sets.includes("buffs") && (!!anim.fxOpt?.buffs || !pl.sets.includes("")) };  // (buffs on when that is the only set)
  }
  if (!mine()) return;
  body.innerHTML = `<div class="pl-error" id="plerr" hidden></div>
    <div class="pl-ws" id="plws">
      <section class="pl-panel pl-listbox"><h3 class="pl-h">Play <small id="plcount"></small></h3><div class="pl-modebox">${plModeBar()}</div><div class="pl-list" id="pllist"></div>
        <div class="pl-legend"><span class="pl-dot ok"></span><span id="pllegend"></span></div></section>
      <section class="pl-center">
        <div class="pl-head"><h2 id="plname"></h2><span class="pl-badge" id="plbadge"></span><span class="grow"></span><span class="muted small mono" id="pldur"></span></div>
        <div class="pl-stage" id="plstage"><div class="pl-overlay" id="plload"><div><div class="pl-spin"></div><b id="plloadt"></b><div class="muted small" id="plloads"></div></div></div>
          <div class="pl-overlay" id="plnone" hidden><div><b>No video of this set</b><div class="muted small" style="margin:6px 0 0">Only the sets the app rendered and sent here can play. Change an option, or render it in the desktop app.</div></div></div>
          ${site ? `<video id="plvideo" playsinline muted preload="auto"></video>` : ""}</div>
        <div class="pl-transport"><div class="pl-scrub" id="plscrub" tabindex="0" role="slider" aria-label="Position"><div class="pl-rail"></div><div class="pl-fill" id="plfill"></div><div class="pl-knob" id="plknob"></div></div>
          <div class="pl-tr"><button class="pl-ibtn" id="plrestart" title="Restart (Home)" aria-label="Restart">${PL_ICON.restart}</button><button class="pl-ibtn" id="plback" title="One frame back (Left)" aria-label="One frame back">${PL_ICON.back}</button>
            <button class="pl-ibtn pl-play" id="plplay" title="Play / pause (Space)" aria-label="Play or pause"></button><button class="pl-ibtn" id="plfwd" title="One frame forward (Right)" aria-label="One frame forward">${PL_ICON.fwd}</button>
            <button class="toggle" id="plloop" title="Loop (L)">Loop</button><span class="pl-time" id="pltime"></span>
            <span class="seg pl-speeds" id="plspeeds"></span></div>
          <div class="pl-hint"><span><kbd>Space</kbd> play / pause</span><span><kbd>←</kbd> <kbd>→</kbd> frame</span><span><kbd>1</kbd>–<kbd>4</kbd> speed</span><span id="plmsg"></span></div></div></section>
      <aside class="pl-side"><section class="pl-panel"><h3 class="pl-h">Scene <small id="plscenenote"></small></h3><div id="plscene"></div></section>
        <section class="pl-render"><h3 class="pl-h" id="plrtitle"></h3><div class="pl-rbody" id="plrbody"></div></section></aside></div>`;
  plModeClicks(body);
  $("#plloop").classList.toggle("on", pl.loop);
  $("#plspeeds").innerHTML = PL_SPEEDS.map((s) => `<button class="toggle ${s === pl.speed ? "on" : ""}" data-s="${s}">×${s}</button>`).join("");
  plWire(body);
  await plVideos();
  if (!mine()) return;
  if (!site && pl.st.available === false) { plError("The effects renderer (LimbusViewer) isn't part of this build."); return; }
  if (!site) {
    try { pl.names = await names; }
    catch (e) { plError(e.message); return; }
    if (!mine()) return;
  } else pl.names = pl.st.videos.slice();
  pl.names.sort((a, b) => { const x = plKeyOf(a), y = plKeyOf(b); return x[0] - y[0] || x[1] - y[1] || String(x[2]).localeCompare(String(y[2]), undefined, { numeric: true }); });
  pl.group = pl.names.includes(anim.plGroup) ? anim.plGroup : pl.names[0] || "";
  plDrawAll();
  if (site) plSiteLoad(); else plLaunch();
  if (!pl.rect) pl.rect = setInterval(plPlaceWindow, 60);
  if (!plPlaceSoon.hooked) {  // (a scroll or a resize moves the window within the frame, not a poll later)
    plPlaceSoon.hooked = true;
    for (const ev of ["scroll", "resize"]) window.addEventListener(ev, plPlaceSoon, true);
  }
}
const plKeyOf = (n) => { const m = /(?:^|_)S(\d+)(?:_(\d{5})|_Time?line[ _]?(.*))?$/.exec(n); return m ? [0, slotOrder(+m[1]), m[2] || m[3] || ""] : [1, 0, n]; };

const PL_ICON = {
  restart: `<svg viewBox="0 0 24 24"><path d="M6 5h2v14H6zM20 5v14L9.5 12z"/></svg>`,
  back: `<svg viewBox="0 0 24 24"><path d="M14 5v14L4 12zM16 5h2v14h-2z"/></svg>`,
  fwd: `<svg viewBox="0 0 24 24"><path d="M10 5v14l10-7zM6 5h2v14H6z"/></svg>`,
  play: `<svg viewBox="0 0 24 24"><path d="M7 4.5v15l13-7.5z"/></svg>`,
  pause: `<svg viewBox="0 0 24 24"><path d="M6 4h4.5v16H6zM13.5 4H18v16h-4.5z"/></svg>`,
};

function plError(msg) {
  const e = $("#plerr");
  if (!e) return;
  e.hidden = false;
  e.textContent = msg;
  $("#plws").classList.add("pl-dim");
}

// ---------------------------------------------------------------- renders (the green dots) and the render card
async function plVideos() {
  const v = fxVariant(), c = pl.c;
  pl.st = await api(`/api/fx?id=${encodeURIComponent(c.id)}${v ? `&v=${v}` : ""}`).catch(() => ({ videos: [], state: "idle" }));
  return pl.st;
}
const plTags = () => [anim.fxSolo && "no target", ...fxOpts().map(([k, , t]) => anim.fxOpt?.[k] && t), anim.fxLevel > 0 && `buff level ${anim.fxLevel}`, anim.fxMod && `mod ${anim.fxMod}`].filter(Boolean);
const plFile = (n) => { const tg = plTags(); return `${pl.c.id} ${pl.c.title} - ${fxLabel(n)}${tg.length ? ` (${tg.join(", ")})` : ""}`; };
const plHas = (n) => (pl.st?.videos || []).includes(n);
const plSrc = (n) => `${pl.st?.urls?.[n] || `/api/fx_video?id=${encodeURIComponent(pl.c.id)}${fxVariant() ? `&v=${fxVariant()}` : ""}&name=${encodeURIComponent(n)}`}${pl.st?.urls?.[n] ? "" : `&t=${pl.st?.t || ""}`}`;

function plDrawList() {
  let h = "", g = "";
  for (const n of pl.names) {
    const grp = plWhole(n) ? "Skills" : "Clash and guard";
    if (grp !== g) { g = grp; h += `<h6>${grp}</h6>`; }
    h += `<div class="pl-it ${n === pl.group ? "on" : ""}" data-n="${esc(n)}" tabindex="0"><span class="pl-sin">${esc(plBadge(n))}</span><div><b>${esc(fxLabel(n))}</b><small>${esc(n)}</small></div><span class="pl-dot ${plHas(n) ? "ok" : ""}"></span></div>`;
  }
  $("#pllist").innerHTML = h || `<div class="muted small" style="padding:10px">This one has no skills to play.</div>`;
  $("#plcount").textContent = `${pl.names.length} items`;
  $("#pllegend").textContent = pl.site ? "a video of these settings is on the site" : "rendered with the current settings";
  $("#pllist").querySelectorAll("[data-n]").forEach((it) => {
    const go = () => plPick(it.dataset.n);
    it.onclick = go;
    it.onkeydown = (e) => { if (e.key === "Enter") go(); };
  });
}

function plDrawScene() {
  const c = pl.c, o = anim.fxOpt || {}, site = pl.site, buffs = anim.fxBuffs[c.id] || { levels: [], own: [] };
  // an option is open when the set it makes exists (on the site: was sent); in the app always
  const can = (change) => {
    if (!site) return true;
    const keep = { solo: anim.fxSolo, opt: { ...anim.fxOpt }, lv: anim.fxLevel };
    change();
    const v = fxVariant();
    Object.assign(anim, { fxSolo: keep.solo, fxOpt: keep.opt, fxLevel: keep.lv });
    return pl.sets.includes(v);
  };
  const seg = (key, items, on, set) => `<span class="seg" data-g="${key}">${items.map(([val, label, test]) => {
    const off = !on(val) && !(test ? test() : can(() => set(val)));
    return `<button class="toggle ${on(val) ? "on" : ""}" data-v="${esc(String(val))}" ${off ? `disabled title="In the desktop app"` : ""}>${label}</button>`;
  }).join("")}</span>`;
  const row = (label, html) => `<div class="pl-row"><span>${label}</span>${html}</div>`;
  const sw = (key, label, hint, on, off, tip) => `<label class="pl-sw ${off ? "dis" : ""}" ${tip ? `title="${esc(tip)}"` : ""}><input type="checkbox" data-opt="${key}" ${on ? "checked" : ""} ${off ? "disabled" : ""}><i></i><span>${label}${hint ? `<small>${hint}</small>` : ""}</span></label>`;
  const alpha = !!o.alpha;
  const more = FX_OPTS.filter(([k]) => !["alpha", "static", "skillbg"].includes(k) && fxOptFor(c).some(([x]) => x === k) && !(k === "buffs" && !fxOwn(c.id).length));
  const forms = c.forms || [];
  $("#plscene").innerHTML = `<div class="pl-sec">
      ${row("Target", seg("solo", [[0, "With"], [1, "Without"]], (x) => (+x === 1) === !!anim.fxSolo, (x) => { anim.fxSolo = +x === 1; }))}
      ${row("Camera", seg("static", [[0, "Game"], [1, "Static"]], (x) => (+x === 1) === !!o.static, (x) => { anim.fxOpt = { ...anim.fxOpt, static: +x === 1 }; }))}
      ${row("Background", seg("alpha", [[0, "Arena"], [1, "Transparent"]], (x) => (+x === 1) === alpha, (x) => { anim.fxOpt = { ...anim.fxOpt, alpha: +x === 1 }; }))}
      ${sw("skillbg", "Skill background", alpha ? "The red and dark tints and flashes some skills put over the screen." : "Part of the arena picture. Choose Transparent to switch it on its own.", alpha && !!o.skillbg,
        !alpha || (site && !can(() => { anim.fxOpt = { ...anim.fxOpt, skillbg: !o.skillbg }; })))}
    </div>
    ${forms.length || buffs.levels.length > 1 ? `<div class="pl-sec"><h4>Character</h4>
      ${forms.length ? row("Form", seg("form", [["", "Base"], ...forms.map((f) => [f.id, esc(f.name)])], (x) => (c.owner ? c.id === x : x === ""), () => {})) : ""}
      ${buffs.levels.length > 1 ? row("Buffs", seg("lv", buffs.levels.map((_, i) => [i, i ? `Lv ${i}` : "Base"]), (x) => (anim.fxLevel || 0) === +x, (x) => { anim.fxLevel = +x; })) : ""}</div>` : ""}
    ${more.length ? `<details class="pl-more"><summary>More options</summary><div class="pl-in">${more.map(([k, label]) => sw(k, label, "", !!o[k], site && !can(() => { anim.fxOpt = { ...anim.fxOpt, [k]: !o[k] }; }))).join("")}</div></details>` : ""}`;
  $("#plscenenote").textContent = site ? "videos on the site" : "changes show at once";
  const root = $("#plscene");
  root.querySelectorAll("[data-g=solo] button").forEach((b) => b.onclick = () => plOption(() => { anim.fxSolo = +b.dataset.v === 1; }, "target"));
  root.querySelectorAll("[data-g=static] button").forEach((b) => b.onclick = () => plOption(() => { anim.fxOpt = { ...anim.fxOpt, static: +b.dataset.v === 1 }; }, "camera"));
  root.querySelectorAll("[data-g=alpha] button").forEach((b) => b.onclick = () => plOption(() => {
    anim.fxOpt = { ...anim.fxOpt, alpha: +b.dataset.v === 1 };
    if (!anim.fxOpt.alpha) anim.fxOpt.skillbg = false;
  }, "restart"));
  root.querySelectorAll("[data-g=lv] button").forEach((b) => b.onclick = () => plOption(() => { anim.fxLevel = +b.dataset.v; }, "restart"));
  root.querySelectorAll("[data-g=form] button").forEach((b) => b.onclick = () => { anim.fxForm = b.dataset.v; openAnimEntry(anim.sel); });
  root.querySelectorAll("input[data-opt]").forEach((i) => i.onchange = () => plOption(() => { anim.fxOpt = { ...anim.fxOpt, [i.dataset.opt]: i.checked }; }, ["tails", "nobloom", "skillbg"].includes(i.dataset.opt) ? "restart" : ""));
}

// the card under the settings: what a render would be, and the buttons
function plDrawRender() {
  const n = pl.group, site = pl.site, tags = plTags(), has = plHas(n), r = pl.st || {};
  const running = r.state === "running";
  const chips = tags.length ? tags.map((t) => `<span>${esc(t)}</span>`).join("") : `<span class="base">default settings</span>`;
  $("#plrtitle").textContent = site ? "Download" : "Render";
  if (!n) { $("#plrbody").innerHTML = ""; return; }
  const dl = site ? (typeof siteDl === "function" ? siteDl(plSrc(n), plFile(n), false) : "") : "";
  if (site) {
    $("#plrbody").innerHTML = `<div class="pl-sum">${chips}</div><div class="pl-rstate"><span class="pl-dot ${has ? "ok" : ""}"></span><span>${has ? `A video of ${esc(fxLabel(n))} for these settings. Rendered in the desktop app and sent here.` : "No video for these settings on the site."}</span></div>
      <div class="pl-dl">${has ? dl : ""}</div>
      <div class="pl-sitenote">Rendering and the greyed options need the game's files: <a href="${typeof repo === "string" ? `${repo}/releases/latest` : "#"}" target="_blank" rel="noopener">the desktop app</a>.</div>`;
    return;
  }
  const cur = running && r.current ? r.current : null;
  $("#plrbody").innerHTML = `<div class="pl-sum">${chips}</div>
    ${running ? `<div><div class="pl-rstate" style="margin-bottom:6px"><span class="pl-dot"></span><span>Rendering ${esc(cur ? fxLabel(cur.name) : "")}… <b>${cur ? Math.round(100 * cur.frac) : 0}%</b>. Keep playing meanwhile.</span></div><div class="pl-bar"><i style="width:${cur ? Math.max(2, 100 * cur.frac) : 2}%"></i></div></div>`
    : r.state === "error" ? `<div class="pl-rstate bad"><span class="pl-dot"></span><span>${esc(r.msg || "The render failed.")}</span></div>`
    : `<div class="pl-rstate"><span class="pl-dot ${has ? "ok" : ""}"></span><span>${has ? "Rendered with these settings. Render again replaces it." : "Not rendered with these settings yet. About half a minute."}</span></div>`}
    <button class="pl-go" id="plgo" ${running ? "disabled" : ""}>${running ? "Rendering…" : has ? "Render again" : "Render"}</button>
    <div class="pl-three"><button class="toggle" id="plsave" ${has ? "" : "disabled"}>Save</button><button class="toggle" id="plgif" ${has ? "" : "disabled"} title="a looping GIF under 10 MB, to post in Discord">GIF</button><button class="toggle" id="plpng" ${has ? "" : "disabled"} title="every frame as a PNG in a folder, for video editors">PNG frames</button></div>
    <button class="pl-link" id="plall" ${running ? "disabled" : ""}>Render all ${pl.names.length} with these settings</button>`;
  const v = fxVariant(), folder = `${pl.c.id} ${pl.c.title}${tags.length ? ` (${tags.join(", ")})` : ""}`;
  $("#plgo").onclick = () => plRender([n]);
  $("#plall").onclick = () => plRender(null);
  $("#plsave").onclick = () => exportObj({ fxvideo: { id: pl.c.id, v, items: [[n, plFile(n)]], folder } });
  $("#plgif").onclick = () => { toast("Making the GIF…"); exportObj({ fxvideo: { id: pl.c.id, v, items: [[n, plFile(n)]], discord: true } }); };
  $("#plpng").onclick = () => { toast("Saving the frames…"); exportObj({ fxvideo: { id: pl.c.id, v, items: [[n, plFile(n)]], frames: true } }); };
}
async function plRender(names) {
  const v = fxVariant();
  await api("/api/fx", { id: pl.c.id, v, names, kind: "" }).catch((e) => toast(esc(e.message)));
  plWatchRender();
}
// the renders go on in the background: the card and the dots follow
function plWatchRender() {
  clearTimeout(pl.renderTimer);
  const tick = async () => {
    if (!$("#plrbody")) return;
    await plVideos();
    plDrawList(); plDrawRender();
    if (pl.st.state === "running") pl.renderTimer = setTimeout(tick, 1200);
  };
  tick();
}

function plDrawAll() {
  plDrawList(); plDrawScene(); plDrawRender(); plDrawStage();
  if (pl.st?.state === "running") plWatchRender();
}
function plDrawStage() {
  $("#plname").textContent = pl.group ? fxLabel(pl.group) : "";
  const b = $("#plbadge");
  b.className = "pl-badge " + (pl.site ? "vid" : "live");
  b.textContent = pl.site ? "Video from the app" : "Live player";
  $("#plplay").innerHTML = pl.paused ? PL_ICON.play : PL_ICON.pause;
}

// ---------------------------------------------------------------- the options: commands, a new player, or a new set of videos
async function plOption(change, how) {
  change();
  anim.plGroup = pl.group;
  if (pl.site) { await plVideos(); plDrawAll(); plSiteLoad(); return; }
  await plVideos();
  plDrawAll();
  if (how === "target") plCmd({ op: "target", on: !anim.fxSolo });
  else if (how === "camera") plCmd({ op: "camera", on: !!anim.fxOpt?.static });
  else if (how === "restart") plLaunch();
}
function plPick(n) {
  pl.group = anim.plGroup = n;
  plDrawList(); plDrawRender(); plDrawStage();
  if (pl.site) plSiteLoad(); else plCmd({ op: "play", group: n, seek: 0, paused: false });
  pl.paused = false;
  plDrawStage();
}

// ---------------------------------------------------------------- the desktop app: the player's window
const plCmd = (c) => api("/api/preview_cmd", c).then((s) => { plState(s); return s; }).catch(() => {});
// dragging the knob: the player jumps to where it is, one jump at a time (the latest place wins), paused there
async function plScrubTo(f) {
  pl.scrubWant = f;
  if (pl.scrubBusy) return;
  pl.scrubBusy = true;
  try {
    while (pl.scrub && pl.scrubWant != null) {
      const w = pl.scrubWant;
      pl.scrubWant = null;
      if (w === pl.scrubDone) continue;
      const s = await plCmd({ op: "seek", group: pl.group, seek: w, paused: true });
      const t0 = performance.now();
      for (;;) {  // (until the player shows it: then the next one)
        const st = await api("/api/preview").catch(() => null);
        if (st) pl.state = st;
        if (!st || !pl.scrub || performance.now() - t0 > 3000 || (st.cmd >= (s?.seq || 0) && st.frame >= w - 1)) break;
        await new Promise((r) => setTimeout(r, 20));
      }
      pl.scrubDone = w;
    }
  } finally { pl.scrubBusy = false; }
}
// a jump: the knob stays where it was dropped until the player has been there (a way back is a replay from the start, the
// frame counter runs up from 0 meanwhile)
async function plSeek(frame, paused) {
  pl.seekTo = frame; pl.seekCmd = Infinity; pl.seekAt = performance.now();
  plProgress(frame, pl.total || 0, pl.fps || 60);
  const s = await plCmd({ op: "seek", group: pl.group, seek: frame, paused });
  if (pl.seekTo === frame) pl.seekCmd = s && s.seq || 0;
}
async function plLaunch() {
  pl.ready = false;
  pl.key = plKey();
  plLoading("Loading the character", "First time takes a few seconds. After that skills play at once.");
  let s;
  try { s = await api("/api/preview", { id: pl.c.id, v: pl.key }); } catch (e) { plError(e.message); return; }
  plState(s);
  clearInterval(pl.poll);
  pl.poll = setInterval(async () => {
    if (!$("#plstage")) { plStop(true); return; }
    const st = await api("/api/preview").catch(() => null);
    if (st) plState(st);
  }, 120);
}
function plLoading(title, sub) {
  $("#plload").hidden = false;
  $("#plloadt").textContent = title;
  $("#plloads").textContent = sub || "";
  $("#plload").querySelector(".pl-spin").hidden = !title || /failed|could not/i.test(title);
}
function plState(s) {
  pl.state = s;
  if (!$("#plstage")) return;
  if (s.state === "error") { plLoading("The player could not start", s.msg); return; }
  if (s.state === "closed") { plLoading("The player closed", "Pick a skill to start it again."); pl.ready = false; return; }
  if (s.state !== "ready") { return; }
  if (!pl.ready) {
    pl.ready = true;
    $("#plload").hidden = true;
    if (pl.group) plCmd({ op: "play", group: pl.group, seek: 0, paused: false });
    plCmd({ op: "loop", loop: pl.loop }); plCmd({ op: "speed", speed: pl.speed });
    plCmd({ op: "target", on: !anim.fxSolo }); plCmd({ op: "camera", on: !!anim.fxOpt?.static });
    pl.shown = "";
  }
  pl.paused = !!s.paused || s.play === "ended";
  plProgress(s.frame || 0, s.total || 0, s.fps || 60);
}
// where the window goes: over the stage box, when it is fully seen and nothing is on top of it
function plPlaceWindow() {
  const el = $("#plstage");
  if (!el) { plStop(true); return; }
  if (pl.site) return;
  const r = el.getBoundingClientRect(), host = $("#aview").getBoundingClientRect();
  // the part of the box the page shows (it scrolls under the header): the window shows only that
  const l = Math.max(r.left, host.left), t = Math.max(r.top, host.top), rt = Math.min(r.right, host.right), b = Math.min(r.bottom, host.bottom);
  const seen = r.width > 40 && rt - l > 8 && b - t > 8;
  const covered = !!document.querySelector(".an-modal, #modal:not(.hidden), #modal.open, #whatsnew:not(.hidden)");
  // (the window cannot move in step with a scrolling page: it is hidden while the box moves and laid back when it is still)
  const sample = [r.left, r.top, r.width, r.height].map(Math.round).join();
  if (sample !== pl.sample) { pl.sample = sample; pl.moveAt = performance.now(); }
  const show = pl.ready && seen && !covered && performance.now() - pl.moveAt > 130;
  const dpr = window.devicePixelRatio || 1;
  const clip = show && (l > r.left + 1 || t > r.top + 1 || rt < r.right - 1 || b < r.bottom - 1) ? [l - r.left, t - r.top, rt - r.left, b - r.top] : null;
  const key = show ? [r.left, r.top, r.width, r.height, dpr, ...(clip || [])].map((x) => Math.round(x * 10)).join() : "hide";
  if (key === pl.shown) return;
  if (pl.sending) { pl.again = true; return; }  // (one request at a time: the next one carries where the box is by then)
  pl.sending = true;
  // (a window that goes away while its box is still seen leaves its last picture on the page meanwhile)
  const snap = !show && !!pl.shown && pl.shown !== "hide" && pl.ready && seen;
  pl.shown = key;
  api("/api/preview_rect", show ? { x: r.left, y: r.top, w: r.width, h: r.height, dpr, clip, show: true } : { show: false, snap })
    .then((j) => plSnap(show ? "" : j && j.snap || (snap ? "" : null))).catch(() => { pl.shown = ""; })
    .finally(() => { pl.sending = false; if (pl.again) { pl.again = false; plPlaceWindow(); } });
}
// the still picture under the window: url shows it, "" takes it away, null leaves it as it is
function plSnap(url) {
  const st = $("#plstage");
  if (!st || url === null) return;
  let im = $("#plsnap");
  if (!url) { if (im) im.hidden = true; return; }
  if (!im) { im = Object.assign(document.createElement("img"), { id: "plsnap", className: "pl-snap", alt: "" }); st.appendChild(im); }
  im.src = url;
  im.hidden = false;
}
function plPlaceSoon() {
  if (!$("#plstage") || pl.frameReq) return;
  pl.frameReq = requestAnimationFrame(() => { pl.frameReq = 0; plPlaceWindow(); });
}

// ---------------------------------------------------------------- the website: videos
function plSiteLoad() {
  const v = $("#plvideo"), n = pl.group;
  if (!v) return;
  const none = !n || !plHas(n);
  $("#plnone").hidden = !none;
  $("#plload").hidden = true;
  v.hidden = none;
  pl.video = none ? null : v;
  if (none) { v.removeAttribute("src"); plProgress(0, 0, 30); return; }
  v.loop = pl.loop; v.playbackRate = pl.speed;
  v.src = plSrc(n);
  v.ontimeupdate = () => plProgress(Math.round(v.currentTime * 30), Math.round((v.duration || 0) * 30), 30);
  v.onloadedmetadata = () => plProgress(0, Math.round(v.duration * 30), 30);
  v.onplay = v.onpause = () => { pl.paused = v.paused; if ($("#plplay")) $("#plplay").innerHTML = v.paused ? PL_ICON.play : PL_ICON.pause; };
  v.play().catch(() => {});
}

// ---------------------------------------------------------------- controls
function plProgress(frame, total, fps) {
  if (pl.scrub || !$("#plfill")) return;
  if (pl.seekTo != null) {
    const st = pl.state || {};
    if ((st.cmd >= pl.seekCmd && frame >= pl.seekTo - 1) || performance.now() - pl.seekAt > 10000) pl.seekTo = null;
    else frame = pl.seekTo;
  }
  const dur = total / fps, t = frame / fps, k = total ? Math.min(1, frame / total) : 0;
  $("#plfill").style.width = `${100 * k}%`;
  $("#plknob").style.left = `${100 * k}%`;
  $("#pltime").innerHTML = `${t.toFixed(2)} <small>/ ${dur.toFixed(2)} s</small> &nbsp; <small>F ${String(frame).padStart(3, "0")}</small>`;
  $("#pldur").textContent = total ? `${dur.toFixed(1)} s · ${total} frames · ${pl.site ? "30 fps video" : "live"}` : "";
  $("#plplay").innerHTML = pl.paused ? PL_ICON.play : PL_ICON.pause;
  pl.total = total; pl.fps = fps; pl.frame = frame;
}
function plWire(root) {
  const v = () => pl.video;
  const live = (c) => { if (pl.ready) plCmd(c); };
  $("#plplay").onclick = () => {
    if (pl.site) { if (!v()) return; v().paused ? v().play() : v().pause(); return; }
    const ended = pl.state?.play === "ended";
    if (ended) live({ op: "play", group: pl.group, seek: 0, paused: false });
    else live({ op: pl.paused ? "resume" : "pause" });
  };
  $("#plrestart").onclick = () => { if (pl.site) { if (v()) { v().currentTime = 0; v().play(); } } else live({ op: "play", group: pl.group, seek: 0, paused: false }); };
  const step = (d) => {
    if (pl.site) { if (v()) { v().pause(); v().currentTime = Math.max(0, v().currentTime + d / 30); } return; }
    if (d > 0) { if (!pl.paused) live({ op: "pause" }); live({ op: "step" }); }
    else if (pl.ready) plSeek(Math.max(0, (pl.seekTo ?? pl.frame ?? 0) - 2), true);
  };
  $("#plback").onclick = () => step(-1);
  $("#plfwd").onclick = () => step(1);
  $("#plloop").onclick = () => { pl.loop = !pl.loop; $("#plloop").classList.toggle("on", pl.loop); if (v()) v().loop = pl.loop; live({ op: "loop", loop: pl.loop }); };
  const setSpeed = (s) => {
    pl.speed = s;
    $("#plspeeds").querySelectorAll("[data-s]").forEach((b) => b.classList.toggle("on", +b.dataset.s === s));
    if (v()) v().playbackRate = s;
    live({ op: "speed", speed: s });
  };
  $("#plspeeds").querySelectorAll("[data-s]").forEach((b) => b.onclick = () => setSpeed(+b.dataset.s));
  const scrub = $("#plscrub");
  const at = (e) => { const r = scrub.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); };
  const jump = (k, final) => {
    const f = Math.round(k * (pl.total || 0));
    $("#plfill").style.width = `${100 * k}%`; $("#plknob").style.left = `${100 * k}%`;
    if (pl.site) { if (v() && v().duration) v().currentTime = k * v().duration; return; }
    if (!pl.ready) return;
    if (!final) { plScrubTo(f); return; }  // (the picture follows the knob while it is dragged)
    if (pl.scrubDone === f) {  // (the picture is already there: only go on, if it was playing)
      pl.seekTo = null;
      if (!pl.scrubWas) plCmd({ op: "resume" });
    } else plSeek(f, pl.scrubWas);
  };
  scrub.onpointerdown = (e) => { scrub.setPointerCapture(e.pointerId); pl.scrub = true; pl.scrubWas = pl.paused; pl.scrubDone = pl.scrubWant = null; jump(at(e), false); };
  scrub.onpointermove = (e) => { if (pl.scrub) jump(at(e), false); };
  scrub.onpointerup = (e) => { if (!pl.scrub) return; pl.scrub = false; jump(at(e), true); };
  if (!plWire.keys) {
    plWire.keys = true;
    document.addEventListener("keydown", (e) => {
      if (!$("#plstage") || /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName) && document.activeElement.type !== "checkbox") return;
      if (e.key === " ") { e.preventDefault(); $("#plplay").click(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); $("#plback").click(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); $("#plfwd").click(); }
      else if (e.key === "Home") $("#plrestart").click();
      else if (/^[1-4]$/.test(e.key)) $("#plspeeds").querySelectorAll("[data-s]")[+e.key - 1]?.click();
      else if (e.key.toLowerCase() === "l") $("#plloop").click();
    });
  }
}
function plMsg(t) {
  const m = $("#plmsg");
  if (!m) return;
  m.textContent = t;
  clearTimeout(plMsg.h);
  plMsg.h = setTimeout(() => { m.textContent = ""; }, 2200);
}
