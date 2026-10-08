// ------------------------------------------------------------------ Sprite workshop
// A frames zip (Animations -> Edit -> Frames, or any zip of PNGs) as one sheet, to edit the frames by hand: the zip is
// unpacked into a folder, its PNGs are drawn over in any editor, and the page shows them as they are on the disk —
// what changed, next to the original, in motion — and loads the changed ones into a mod (limbusdm/sprites.py).
const sp = { zip: "", size: 110, bg: "dark", only: false, mod: "edit", fps: 12, mode: "mine", onion: false, full: false };
try { Object.assign(sp, JSON.parse(localStorage.getItem("sprites") || "{}")); } catch (e) { /* no storage */ }
const spSave = () => {
  try { localStorage.setItem("sprites", JSON.stringify({ zip: sp.zip, size: sp.size, bg: sp.bg, only: sp.only, mod: sp.mod, fps: sp.fps, mode: sp.mode, onion: sp.onion, full: sp.full })); } catch (e) { /* no storage */ }
};
const SP_BG = [["dark", "Dark"], ["light", "Light"], ["checker", "Checker"], ["green", "Green"]];
const SP_MODE = [["mine", "Edited", "the file as it is in the folder now"], ["orig", "Original", "the frame as it is in the zip"], ["blink", "Blink", "the two in turn: what changed jumps out"]];

const spUrl = (f, o = {}) => `/api/sprites/png?zip=${encodeURIComponent(sp.zip)}&frame=${encodeURIComponent(f.name)}${o.size ? `&size=${o.size}` : ""}${o.orig ? `&orig=1&t=${sp.sheet.time}` : `&t=${f.t}`}`;
const spName = (f) => f.name.replace(/\.png$/i, "");
// "skill1", "skill1_2", "skill1_10" are one skill; a name that stands alone (idle, dead, guard…) is a pose
const spKey = (f) => { const n = spName(f), m = n.match(/^(.+?)[ _-]\d+(?:,\d+)*$/); return m ? m[1] : n; };
function spGroups(frames) {
  const by = new Map();
  for (const f of frames) { const k = spKey(f); by.set(k, [...(by.get(k) || []), f]); }
  const nat = (a, b) => a.localeCompare(b, "en", { numeric: true });
  const poses = [], out = [];
  for (const k of [...by.keys()].sort(nat)) {
    const l = by.get(k).sort((a, b) => nat(spName(a), spName(b)));
    if (l.length < 2) poses.push(...l); else out.push({ name: k, frames: l });
  }
  if (poses.length) out.unshift({ name: "Poses", frames: poses });
  return out;
}
const spFrame = (name) => sp.sheet && sp.sheet.frames.find((f) => f.name === name);
const spGroupOf = (name) => (sp.groups || []).find((g) => g.frames.some((f) => f.name === name));

routes.sprites = async () => {
  spStop();
  $("#main").innerHTML = `<h1>Sprite workshop</h1><div class="sub">A frames zip laid out as one sheet, to edit by hand. Get a zip from Animations → Edit → Frames
    (or add any zip of PNGs), open its folder, draw over the PNGs in your editor and save — the sheet here follows the files, marks what changed,
    shows it next to the original and in motion, and loads the changed frames into a mod.</div><div id="sppage"><div class="muted">Loading…</div></div>`;
  sp.sel = "";
  const page = $("#sppage");
  page.ondragover = (e) => { e.preventDefault(); };
  page.ondrop = (e) => { e.preventDefault(); spDrop([...e.dataTransfer.files], e.target.closest(".spf")); };
  await spDraw();
};

async function spDraw() {
  const page = $("#sppage");
  if (!page) return;
  clearTimeout(sp.timer);
  let zips = [];
  try { zips = (await api("/api/sprites")).zips; } catch (e) { page.innerHTML = `<div class="card">${esc(e.message)}</div>`; return; }
  if (!zips.some((z) => z.name === sp.zip)) sp.zip = zips[0]?.name || "";
  sp.sheet = null;
  if (sp.zip) try { sp.sheet = await api(`/api/sprites?zip=${encodeURIComponent(sp.zip)}`); } catch (e) { toast(esc(e.message)); }
  if (!$("#sppage")) return;
  const sh = sp.sheet;
  sp.groups = sh ? spGroups(sh.frames) : [];
  if (sp.sel && !spFrame(sp.sel)) sp.sel = "";
  page.className = "spbg-" + sp.bg;
  page.style.setProperty("--sph", sp.size + "px");
  page.innerHTML = `<div class="card">
      <div class="row" style="gap:8px"><span class="small muted">Frames zip</span>
        <select id="spzip" style="flex:1;min-width:280px">${zips.map((z) => `<option value="${esc(z.name)}" ${z.name === sp.zip ? "selected" : ""}>${esc(z.name)} · ${z.count}</option>`).join("")}</select>
        <button id="spadd" title="any zip of PNG frames; it is copied next to the exported ones">Add a zip…</button><input type="file" id="spaddf" accept=".zip" style="display:none">
        ${sh ? `<button id="spfolder" class="primary" title="the PNGs to draw over: save a file there and its tile here changes">Open the folder</button>
        <button id="sppack" title="every frame as it is in the folder now, as a new zip in data/exports">Save as a zip</button>` : ""}</div>
      ${zips.length ? "" : `<div class="muted small" style="margin-top:6px">No frames zips in data/exports yet — export one from Animations → Edit → Frames, or add a zip of PNGs.</div>`}
      ${sh ? `<div class="row" style="gap:14px;margin-top:10px">
        <label class="small" title="how big the tiles are">Size <input id="spsize" type="range" min="60" max="320" step="10" value="${sp.size}" style="width:130px;vertical-align:middle"></label>
        <span class="row" style="gap:4px"><span class="small muted">Behind</span>${SP_BG.map(([k, t]) => `<button class="toggle ${sp.bg === k ? "on" : ""}" data-spbg="${k}">${t}</button>`).join("")}</span>
        <button class="toggle ${sp.only ? "on" : ""}" id="sponly" title="only the frames that differ from the zip">Changed only</button>
        <span class="grow"></span><span id="spcount" class="small muted"></span>
        <button id="spresetall" class="small" title="every changed frame back to the zip's">Reset all</button></div>
      <div class="row" style="gap:8px;margin-top:10px"><span class="small muted">Into a mod</span>
        <label class="small" title="whose frames these are: an Identity / E.G.O id, or an enemy's …Appearance name">of <input id="spid" value="${esc(sp.id ?? sh.id)}" placeholder="10315" style="width:150px"></label>
        <label class="small">named <input id="spmod" value="${esc(sp.mod)}" style="width:120px"></label>
        <button id="spload">Load the changed frames</button>
        <span class="small muted">then pick the mod in Animations → With effects. Drop PNGs anywhere here to replace frames by file name, or on a tile to replace that one.</span></div>` : ""}
    </div>
    <div id="spview"></div><div id="spgrid"></div>`;

  $("#spzip").onchange = (e) => { sp.zip = e.target.value; sp.sel = ""; sp.id = undefined; spStop(); spSave(); spDraw(); };
  $("#spadd").onclick = () => { $("#spaddf").value = ""; $("#spaddf").click(); };
  $("#spaddf").onchange = () => { if ($("#spaddf").files[0]) spDrop([$("#spaddf").files[0]]); };
  if (!sh) return;
  $("#spfolder").onclick = () => api("/api/open", { path: sh.folder });
  $("#sppack").onclick = async () => {
    try {
      const r = await api("/api/sprites/pack", { zip: sp.zip });
      toast(`Saved <span class="mono">${esc(r.path)}</span> · ${r.changed} changed <button onclick='api("/api/open",{path:${JSON.stringify(r.path)}})'>Show in folder</button>`, 7000);
    } catch (e) { toast(esc(e.message)); }
  };
  $("#spsize").oninput = (e) => { sp.size = +e.target.value; page.style.setProperty("--sph", sp.size + "px"); spSave(); };
  page.querySelectorAll("[data-spbg]").forEach((b) => b.onclick = () => {
    sp.bg = b.dataset.spbg; spSave();
    page.className = "spbg-" + sp.bg;
    page.querySelectorAll("[data-spbg]").forEach((x) => x.classList.toggle("on", x === b));
  });
  $("#sponly").onclick = () => { sp.only = !sp.only; spSave(); $("#sponly").classList.toggle("on", sp.only); spGrid(); };
  $("#spresetall").onclick = async () => {
    const n = sh.frames.filter((f) => f.changed).length;
    if (!n || !confirm(`Put ${n} changed frame${n === 1 ? "" : "s"} back as in the zip? Your edits of them in the folder are lost.`)) return;
    await api("/api/sprites/reset", { zip: sp.zip }).catch((e) => toast(esc(e.message)));
    spPoll(true);
  };
  $("#spid").onchange = (e) => { sp.id = e.target.value.trim(); };
  $("#spmod").onchange = (e) => { sp.mod = e.target.value.trim() || "edit"; spSave(); };
  $("#spload").onclick = async () => {
    const id = $("#spid").value.trim();
    if (!id) { toast("Whose frames are these? Type the Identity's id."); return; }
    try {
      const r = await api("/api/sprites/load", { zip: sp.zip, id, mod: sp.mod });
      animMods.kept = {};
      toast(`${r.count} frame${r.count === 1 ? "" : "s"} loaded into mod “${esc(sp.mod)}” of ${esc(id)} — pick it in Animations → With effects`, 7000);
    } catch (e) { toast(esc(e.message)); }
  };
  spGrid();
  spView();
  sp.timer = setTimeout(spPoll, 2000);
}

function spGrid() {
  const box = $("#spgrid"), sh = sp.sheet;
  if (!box || !sh) return;
  const n = sh.frames.filter((f) => f.changed).length;
  $("#spcount").textContent = `${sh.frames.length} frames · ${n} changed`;
  $("#spload").disabled = !n;
  $("#spresetall").hidden = !n;
  const groups = sp.groups.map((g) => ({ ...g, show: g.frames.filter((f) => !sp.only || f.changed) })).filter((g) => g.show.length);
  box.innerHTML = groups.length ? groups.map((g) => `<h3 class="sph">${esc(g.name)} <span class="small muted">${g.frames.length}</span>
      ${g.frames.length > 1 ? `<button class="small" data-spplay="${esc(g.frames[0].name)}" title="these frames one after another">▶ Play</button>` : ""}</h3>
    <div class="spgrid">${g.show.map((f) => `<div class="spf ${f.changed ? "on" : ""} ${f.name === sp.sel ? "sel" : ""}" data-f="${esc(f.name)}" title="${esc(f.name)} · ${f.w}×${f.h}${f.changed ? " · changed" : ""}">
      <img loading="lazy" src="${spUrl(f, { size: 320 })}"><div class="small">${esc(spName(f))}</div></div>`).join("")}</div>`).join("")
    : `<div class="muted" style="margin-top:14px">No changed frames yet: open the folder, draw over a PNG and save it.</div>`;
  box.querySelectorAll(".spf").forEach((el) => el.onclick = () => spPick(el.dataset.f));
  box.querySelectorAll("[data-spplay]").forEach((b) => b.onclick = () => { spStop(); sp.sel = b.dataset.spplay; spView(); spPlay(true); });
}

function spPick(name) {
  spStop();
  sp.sel = sp.sel === name ? "" : name;
  document.querySelectorAll("#spgrid .spf").forEach((el) => el.classList.toggle("sel", el.dataset.f === sp.sel));
  spView();
}

// ---- the picked frame, big: edited / original / the two in turn, the frame before it shown through, the skill in motion
function spView() {
  const box = $("#spview"), f = spFrame(sp.sel);
  if (!box) return;
  if (!f) { box.innerHTML = ""; spStop(); return; }
  const g = spGroupOf(f.name), i = g.frames.indexOf(f);
  const off = f.canvas && f.w && (f.w !== f.canvas[0] || f.h !== f.canvas[1]);
  box.innerHTML = `<div class="card spview">
      <div class="spstage ${sp.full ? "full" : ""}" id="spstage"><canvas id="spcanvas"></canvas></div>
      <div class="spside">
        <div><b>${esc(spName(f))}</b> <span class="small muted">${i + 1} / ${g.frames.length} of ${esc(g.name)}</span><button class="small" id="spclose" style="float:right" title="Esc">✕</button></div>
        <div class="small muted">${f.w}×${f.h} · ${f.changed ? `<b style="color:var(--add)">changed</b>` : "as in the zip"}</div>
        ${off ? `<div class="small" style="color:var(--chg)">Not the exported canvas (${f.canvas[0]}×${f.canvas[1]}): the frame will be placed by scaling. Keep the canvas size to keep the character where it stands.</div>` : ""}
        <div class="row" style="gap:4px;margin-top:8px">${SP_MODE.map(([k, t, tip]) => `<button class="toggle ${sp.mode === k ? "on" : ""}" data-spmode="${k}" title="${tip}">${t}</button>`).join("")}</div>
        <div class="row" style="gap:4px;margin-top:6px"><button class="toggle ${sp.onion ? "on" : ""}" id="sponion" title="the frame before this one, faint, under it: to match the next pose to the last">Onion skin</button>
          <button class="toggle ${sp.full ? "on" : ""}" id="spfull" title="pixel for pixel, scrolled; off: fitted to the box">100%</button></div>
        <div class="row" style="gap:4px;margin-top:8px"><button id="spprev" title="←">◀</button><button id="spgo" title="Space">${sp.playing ? "❚❚" : "▶"}</button><button id="spnext" title="→">▶▏</button>
          <label class="small">fps <input id="spfps" type="number" min="1" max="60" value="${sp.fps}" style="width:54px"></label></div>
        <div class="row" style="gap:4px;margin-top:10px"><button id="spopen" title="in the program Windows opens PNG files with">Open</button><button id="spshow">Show in folder</button></div>
        <div class="row" style="gap:4px;margin-top:4px"><button id="sprep">Replace…</button>${f.changed ? `<button id="spreset" title="this frame back to the zip's">Reset</button>` : ""}
          <input type="file" id="sprepf" accept="image/*" style="display:none"></div>
      </div></div>`;
  $("#spclose").onclick = () => spPick(sp.sel);
  box.querySelectorAll("[data-spmode]").forEach((b) => b.onclick = () => { sp.mode = b.dataset.spmode; spSave(); spView(); });
  $("#sponion").onclick = () => { sp.onion = !sp.onion; spSave(); spView(); };
  $("#spfull").onclick = () => { sp.full = !sp.full; spSave(); spView(); };
  $("#spprev").onclick = () => spStep(-1);
  $("#spnext").onclick = () => spStep(1);
  $("#spgo").onclick = () => spPlay(!sp.playing);
  $("#spfps").onchange = (e) => { sp.fps = Math.max(1, Math.min(60, +e.target.value || 12)); spSave(); if (sp.playing) spPlay(true); };
  $("#spopen").onclick = () => api("/api/sprites/open", { zip: sp.zip, frame: f.name }).catch((e) => toast(esc(e.message)));
  $("#spshow").onclick = () => api("/api/open", { path: sp.sheet.folder + "\\" + f.name });
  $("#sprep").onclick = () => { $("#sprepf").value = ""; $("#sprepf").click(); };
  $("#sprepf").onchange = () => { if ($("#sprepf").files[0]) spDrop([$("#sprepf").files[0]], null, f.name); };
  if ($("#spreset")) $("#spreset").onclick = async () => { await api("/api/sprites/reset", { zip: sp.zip, frame: f.name }).catch((e) => toast(esc(e.message))); spPoll(true); };
  clearInterval(sp.blink);
  sp.flip = false;
  if (sp.mode === "blink") sp.blink = setInterval(() => { if (!$("#spcanvas")) { clearInterval(sp.blink); return; } sp.flip = !sp.flip; spPaint(); }, 450);
  spPaint();
}

const spPics = new Map();  // whole frames, decoded: a few dozen at most (they are big)
function spPic(url) {
  let p = spPics.get(url);
  if (!p) {
    p = new Promise((ok) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => ok(null); im.src = url; });
    spPics.set(url, p);
    if (spPics.size > 60) spPics.delete(spPics.keys().next().value);
  }
  return p;
}
// where a frame's pivot is in a picture of it: from the left and from the BOTTOM (the zip's note has it for the exported
// canvas; another size is scaled, as the app does when it loads the frame; no note: the middle of the bottom edge)
const spPivot = (f, w, h) => (f.pivot && f.canvas ? [f.pivot[0] * w / f.canvas[0], f.pivot[1] * h / f.canvas[1]] : [w / 2, 0]);
// one stage for a whole skill, so the character stays where it stands from frame to frame: as big as what is drawn in
// its frames (the empty room of the exported canvas is left out), with a margin
function spStage(g) {
  let L = -1e9, R = -1e9, U = -1e9, D = -1e9;
  for (const f of g.frames) {
    const [px, py] = spPivot(f, f.w, f.h), [l, t, r, b] = f.box || [0, 0, f.w, f.h];
    L = Math.max(L, px - l); R = Math.max(R, r - px); U = Math.max(U, (f.h - py) - t); D = Math.max(D, b - (f.h - py));
  }
  const m = Math.round(Math.max(L + R, U + D) * 0.08);
  return { L: Math.ceil(L) + m, U: Math.ceil(U) + m, w: Math.max(2, Math.ceil(L + R) + 2 * m), h: Math.max(2, Math.ceil(U + D) + 2 * m) };
}
async function spPaint() {
  const f = spFrame(sp.sel), cv = $("#spcanvas");
  if (!f || !cv) return;
  const g = spGroupOf(f.name), i = g.frames.indexOf(f), st = spStage(g);
  const orig = !sp.playing && (sp.mode === "orig" || (sp.mode === "blink" && sp.flip));
  const turn = sp.turn = (sp.turn || 0) + 1;
  const prev = sp.onion && !sp.playing && g.frames.length > 1 ? g.frames[(i - 1 + g.frames.length) % g.frames.length] : null;
  const [im, under] = await Promise.all([spPic(spUrl(f, { orig })), prev ? spPic(spUrl(prev)) : null]);
  if (turn !== sp.turn || !cv.isConnected) return;
  if (cv.width !== st.w || cv.height !== st.h) { cv.width = st.w; cv.height = st.h; }
  const c = cv.getContext("2d");
  c.clearRect(0, 0, st.w, st.h);
  const put = (img, fr, a) => {
    if (!img) return;
    const [px, py] = spPivot(fr, img.naturalWidth, img.naturalHeight);
    c.globalAlpha = a;
    c.drawImage(img, Math.round(st.L - px), Math.round(st.U - (img.naturalHeight - py)));
  };
  if (under) put(under, prev, 0.35);
  put(im, f, 1);
  c.globalAlpha = 1;
}

function spStep(d) {
  const g = spGroupOf(sp.sel);
  if (!g) return;
  spStop();
  const i = g.frames.findIndex((f) => f.name === sp.sel);
  sp.sel = g.frames[(i + d + g.frames.length) % g.frames.length].name;
  document.querySelectorAll("#spgrid .spf").forEach((el) => el.classList.toggle("sel", el.dataset.f === sp.sel));
  spView();
}
function spStop() { clearInterval(sp.player); clearInterval(sp.blink); sp.playing = false; }
function spPlay(on) {
  clearInterval(sp.player);
  sp.playing = false;
  const g = spGroupOf(sp.sel);
  if (on && g && g.frames.length > 1) {
    sp.playing = true;
    clearInterval(sp.blink);
    g.frames.forEach((f) => spPic(spUrl(f)));
    let i = g.frames.findIndex((f) => f.name === sp.sel);
    sp.player = setInterval(() => {
      if (!$("#spcanvas")) { spStop(); return; }
      i = (i + 1) % g.frames.length;
      sp.sel = g.frames[i].name;
      spPaint();
    }, 1000 / sp.fps);
  }
  document.querySelectorAll("#spgrid .spf").forEach((el) => el.classList.toggle("sel", el.dataset.f === sp.sel));
  if (!sp.playing && g) return spView();  // stopped: the side panel catches up with the frame it stopped on
  if ($("#spgo")) $("#spgo").textContent = sp.playing ? "❚❚" : "▶";
}

// ---- the files: looked at every 2 s; a frame saved again in the editor gets its tile (and the big view) drawn anew
async function spPoll(now) {
  clearTimeout(sp.timer);
  if (!$("#sppage") || !sp.zip) return;
  const zip = sp.zip, sh = await api(`/api/sprites?zip=${encodeURIComponent(zip)}`).catch(() => null);
  if (!$("#sppage") || zip !== sp.zip) return;
  if (sh) {
    const old = new Map((sp.sheet ? sp.sheet.frames : []).map((f) => [f.name, f]));
    const same = sp.sheet && sh.time === sp.sheet.time && sh.frames.length === old.size && sh.frames.every((f) => old.has(f.name));
    if (!same) return spDraw();
    const moved = sh.frames.filter((f) => old.get(f.name).t !== f.t || old.get(f.name).changed !== f.changed);
    if (moved.length || now) {
      sp.sheet = sh;
      sp.groups = spGroups(sh.frames);
      spGrid();
      if (moved.some((f) => f.name === sp.sel) || now) { const on = sp.playing; if (!on) spView(); }
    }
  }
  sp.timer = setTimeout(spPoll, 2000);
}

// ---- pictures dropped on the page (or chosen): a zip joins the list; a PNG replaces the frame of its name, or the
// tile it was dropped on
async function spDrop(files, tile, frame) {
  const read = (f) => new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(f); });
  const zipf = files.find((f) => /\.zip$/i.test(f.name));
  if (zipf) {
    try {
      const r = await api("/api/sprites/add", { name: zipf.name, data: await read(zipf) });
      sp.zip = r.name; sp.sel = ""; sp.id = undefined; spSave();
      toast(`Added ${esc(r.name)}`);
    } catch (e) { toast(esc(e.message)); }
    return spDraw();
  }
  if (!sp.sheet) return;
  const pics = files.filter((f) => /^image\//.test(f.type));
  frame = frame || (tile && pics.length === 1 ? tile.dataset.f : "");
  const known = new Map(sp.sheet.frames.map((f) => [f.name.toLowerCase(), f.name]));
  let n = 0;
  const skipped = [];
  for (const f of pics) {
    const to = frame || known.get(f.name.toLowerCase()) || known.get(f.name.replace(/\.[^.]+$/, "").toLowerCase() + ".png");
    if (!to) { skipped.push(f.name); continue; }
    try { await api("/api/sprites/put", { zip: sp.zip, frame: to, png: await read(f) }); n++; } catch (e) { toast(esc(e.message)); }
  }
  if (n || skipped.length) toast(`${n} frame${n === 1 ? "" : "s"} replaced${skipped.length ? ` · no frame of that name: ${esc(skipped.slice(0, 4).join(", "))} (drop one picture on a tile to replace that tile)` : ""}`, 6000);
  spPoll(true);
}

addEventListener("keydown", (e) => {
  if (!location.hash.startsWith("#/sprites") || !sp.sel || !$("#spcanvas") || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
  if (e.key === "ArrowLeft") { e.preventDefault(); spStep(-1); }
  else if (e.key === "ArrowRight") { e.preventDefault(); spStep(1); }
  else if (e.key === " ") { e.preventDefault(); spPlay(!sp.playing); }
  else if (e.key === "Escape") { spPick(sp.sel); }
});
addEventListener("hashchange", () => { if (!location.hash.startsWith("#/sprites")) { spStop(); clearTimeout(sp.timer); } });
