"use strict";
// ------------------------------------------------------------------ helpers
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const CJK = /[぀-ヿ㐀-鿿가-힯]/;
const PAGE = 200;

async function api(path, body) {
  const opt = body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json", "X-Limbus-Datamine": "1" }, body: JSON.stringify(body) };
  const r = await fetch(path, opt);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || r.statusText);
  if (body !== undefined && path.startsWith("/api/mod")) animMods.kept = {};  // a mod was changed: the lists are asked again
  return data;
}
function toast(html, ms = 4000) {
  const t = $("#toast");
  t.innerHTML = html;
  t.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add("hidden"), ms);
}
function modal(html) {
  $("#modal-body").innerHTML = html;
  $("#modal").classList.remove("hidden");
}
function closeModal() {
  $("#modal").classList.add("hidden");
  $("#modal-body").innerHTML = "";
  const then = closeModal.then;
  closeModal.then = null;
  if (then) then();
}
$("#modal-close").onclick = closeModal;
$("#modal").onclick = (e) => { if (e.target.id === "modal") closeModal(); };
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

const fmtSize = (n) => n == null ? "" : n > 1e9 ? (n / 1e9).toFixed(2) + " GB" : n > 1e6 ? (n / 1e6).toFixed(1) + " MB" : n > 1e3 ? (n / 1e3).toFixed(0) + " KB" : n + " B";
// version "s20261001_CxWu8Z…" → "build 01.10.2026"; snapshot id "<version>_20261003-205708" → "build 01.10.2026 · taken 03.10 20:57"
const fmtVer = (v) => { const m = /^s(\d{4})(\d\d)(\d\d)_/.exec(v || ""); return m ? `build ${m[3]}.${m[2]}.${m[1]}` : (v || "?"); };
const fmtSnap = (id) => { const m = /^(.*)_(\d{4})(\d\d)(\d\d)-(\d\d)(\d\d)\d\d$/.exec(id || ""); return m ? `${fmtVer(m[1])} · taken ${m[4]}.${m[3]} ${m[5]}:${m[6]}` : id; };
const SUMMARY_LABELS = [["leaks", "highlights"], ["foreign_only", "KR/JP-only lines"], ["texts", "texts"], ["data", "data"], ["images", "images"],
  ["audio", "audio"], ["video", "video"], ["code", "code"], ["catalog_added", "new paths"], ["other", "other"]];
const summaryChips = (s) => s ? `<div class="chips">${SUMMARY_LABELS.filter(([k]) => s[k]).map(([k, l]) =>
  `<span class="chip ${k === "leaks" || k === "foreign_only" ? "leak" : ""}"><b>${s[k]}</b> ${l}</span>`).join("") || `<span class="chip">no content changes</span>`}</div>` : "";
const thumb = (h) => h ? `/api/thumb?h=${h}` : "";
const live = (it, extra = "") => `/api/object?bundle=${encodeURIComponent(it.bundle)}&pid=${it.pid}${extra}`;
const badge = (k) => `<span class="badge ${k}">${k}</span>`;
const fmtMs = (ms) => ms == null ? "" : `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
// audio is decoded only when the user presses play
const soundPlayer = (bank, i, name) => `<span class="row"><button class="toggle" onclick='playSound(this, ${JSON.stringify(bank)}, ${i})'>▶ play</button>
  <button class="toggle" onclick='exportObj(${JSON.stringify({ bank, i })})'>export WAV</button></span>`;
function filterNames(input) {
  const q = input.value.trim().toLowerCase();
  input.nextElementSibling.querySelectorAll("div").forEach((d) => d.style.display = !q || d.textContent.toLowerCase().includes(q) ? "" : "none");
}
function playSound(btn, bank, i) {
  const a = document.createElement("audio");
  a.controls = true;
  a.autoplay = true;
  a.src = `/api/bank?path=${encodeURIComponent(bank)}&i=${i}`;
  btn.replaceWith(a);
}
const FLAG_LABELS = { leak: "next update", suspicious: "test / dummy" };
const flagBadges = (f) => (f || []).map((k) => `<span class="badge ${k}">${FLAG_LABELS[k] || k}</span>`).join(" ");

let STATE = null, MARKS = {};
const markKey = (it) => [it.bundle || "", it.path || "", it.type || "", it.name || ""].join("|");

// ------------------------------------------------------------------ state polling
async function refresh() {
  try {
    STATE = await api("/api/state");
  } catch (e) { return; }
  renderStatus();
  const j = STATE.job;
  if (j && !j.running && j.finished && refresh.lastJob !== j.finished) {
    if (refresh.lastJob !== undefined) {  // don't toast a job that finished before the window opened
      if (j.kind === "snapshot" && !j.error) newSnapshot();
      if (j.error) { toast(`${esc(j.kind)} failed: ${esc(j.error)}`, 8000); if (j.kind === "site" && $("#sitebox")) drawSiteBox(); }
      else if (j.result && j.result.unchanged) toast("Nothing changed since the last snapshot.");
      else if (j.result && j.result.report) {
        toast(`Report ready — <a href="#/patches/${encodeURIComponent(j.result.report)}">open</a>`, 10000);
        showNotes(j.result.report);
      }
      else if (j.result && j.result.snapshot) toast("Snapshot saved.");
      else if (j.result && "site" in j.result) {
        toast(j.result.site ? `On the site — <a href="${esc(j.result.site)}" target="_blank">open</a>${j.result.sent ? `<br><span class="small">${siteSent(j.result.sent)}</span>` : ""}` : "Site files are ready (no upload is set up).", 20000);
        if ($("#sitebox")) drawSiteBox();
      }
    }
    refresh.lastJob = j.finished;
  } else if (refresh.lastJob === undefined) refresh.lastJob = j ? j.finished : null;
  // the background checks found something while the window was open
  const up = STATE.update && STATE.update.newer ? STATE.update.latest : null;
  if (up && refresh.lastUpdate !== undefined && refresh.lastUpdate !== up)
    toast(`Limbus Archive ${esc(up)} is out — ${STATE.update.can_install ? `<a href="#" onclick="installUpdate();return false">install</a>`
      : `<a href="${esc(STATE.update.page || "#")}" target="_blank">download</a>`}`, 15000);
  refresh.lastUpdate = up;
  const gs = STATE.watch.state || "";
  if (gs.startsWith("new version") && refresh.lastGame !== undefined && !refresh.lastGame.startsWith("new version"))
    toast(`New game version: ${esc(gs.replace(/^new version:?\s*/, ""))}`, 10000);
  refresh.lastGame = gs;
  if (typeof refresh.hook === "function") refresh.hook();
}
// "What's new" of a report: a short text to paste into Discord or Telegram; pops up once for each new patch
async function showNotes(rid) {
  let n;
  try { n = await api(`/api/patchnotes?id=${encodeURIComponent(rid)}`); } catch (e) { toast(esc(e.message)); return; }
  modal(`<h2 style="margin-top:0">What's new</h2><div class="small muted">Ready to paste into Discord or Telegram (**bold** works in both). You can edit it here first.</div>
    <textarea id="notes" rows="14" style="width:min(720px,86vw);margin:8px 0">${esc(n.text)}</textarea>
    <div class="row" style="gap:8px"><button class="primary" id="ncopy">Copy</button><a href="#/patches/${encodeURIComponent(rid)}" id="nopen">Open the report</a>
      <span class="grow"></span><span class="small muted" id="nlen"></span></div>`);
  const len = () => { $("#nlen").textContent = `${$("#notes").value.length} / 2000 characters (one Discord message)`; };
  $("#notes").oninput = len;
  len();
  $("#ncopy").onclick = async () => {
    try { await navigator.clipboard.writeText($("#notes").value); } catch (e) { $("#notes").select(); document.execCommand("copy"); }
    toast("Copied");
  };
  $("#nopen").onclick = closeModal;
  if (!n.seen) api("/api/patchnotes_seen", { id: rid }).catch(() => {});
}
// what's new in the app after it updated: the release notes since the version seen last (from GitHub)
function showAppNotes(a) {
  const md = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    .map((l) => /^[-*] /.test(l) ? `<li>${l.slice(2)}</li>` : /^#+ /.test(l) ? `<div><b>${l.replace(/^#+ /, "")}</b></div>` : `<div>${l}</div>`).join("");
  // a.history = the last releases, opened by the status box's button
  modal(`<h2 style="margin-top:0">Limbus Archive ${a.history ? "" : esc(a.version) + " "}— what's new</h2>
    ${a.notes.length ? a.notes.map((n) => `<div style="margin:10px 0 4px"><b>${esc(n.tag)}</b>${n.date ? ` <span class="small muted">${esc(n.date)}</span>` : ""}</div><ul style="margin:0;padding-left:20px;max-width:720px">${md(n.body)}</ul>`).join("")
      : `<div class="muted">Couldn't read the notes — <a href="${esc(a.page)}" target="_blank">see the releases on GitHub</a>.</div>`}`);
  if (a.history) return;
  api("/api/appnotes_seen", {}).catch(() => {});
  return new Promise((ok) => { closeModal.then = ok; });
}
async function showAppHistory() {
  $("#status").classList.add("hidden");
  try { showAppNotes(await api("/api/appnotes?all=1")); } catch (e) { toast(esc(e.message)); }
}
// at the start: the app's own notes after an update, then a game patch that came in while the app was closed
(async () => {
  const a = await api("/api/appnotes").catch(() => ({}));
  if (a.version) await showAppNotes(a);
  const n = await api("/api/patchnotes?new=1").catch(() => ({}));
  if (n.id) showNotes(n.id);
})();

function renderStatus() {
  const s = STATE, j = s.job;
  let h = s.game.ok ? `<div class="ok">● Game found</div>` : `<div class="bad">● Game not found — set the path in Settings</div>`;
  const last = s.snapshots[s.snapshots.length - 1];
  h += `<div>Latest: ${last ? esc(fmtSnap(last.id)) : "no snapshot yet"}</div>`;
  const up = s.update;
  if (up && up.newer) {
    h += `<div class="updatebox">Update <b>${esc(up.latest)}</b> is available${up.can_install
      ? ` <button class="primary toggle" onclick="installUpdate()" ${j && j.running ? "disabled" : ""}>Install</button>`
      : ` — <a href="${esc(up.page || "#")}" target="_blank">download</a>`}</div>`;
  }
  h += `<div title="${esc(s.watch.last_check || "")}">Game: ${esc(s.watch.state)}</div>
    <button class="toggle" style="margin-top:6px" onclick="checkAll()" ${j && j.running ? "disabled" : ""}>Check for updates</button>
    <button class="toggle" style="margin-top:6px" onclick="showAppHistory()">What's new</button>`;
  if (j && j.running) h += `<div style="margin-top:6px">${esc(j.kind)}: ${esc(j.stage)} ${j.total ? `${j.done}/${j.total}` : ""}</div><div class="progress"><div style="width:${j.total ? (100 * j.done / j.total) : 5}%"></div></div>`;
  $("#status").innerHTML = h;
  const b = $("#statusbtn");
  b.className = up && up.newer ? "news" : "";
  b.innerHTML = j && j.running ? `${esc(j.kind)} ${j.total ? Math.floor(100 * j.done / j.total) + "%" : "…"}`
    : up && up.newer ? `Update ${esc(up.latest)}`
    : `<span class="${s.game.ok ? "ok" : "bad"}">●</span> ${s.game.ok ? esc(s.watch.state) : "Game not found"}`;
}
$("#statusbtn").onclick = () => $("#status").classList.toggle("hidden");
document.addEventListener("click", (e) => { if (!e.target.closest("#statusbox")) $("#status").classList.add("hidden"); });

// reset timers, Moscow time as UTC hours: daily 00:00, weekly Thursday 00:00, maintenance Thursday 04:00-06:00
function drawTimers() {
  const now = new Date(), H = 3600e3;
  const next = (h, wd) => {
    const t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h));
    if (wd != null) t.setUTCDate(t.getUTCDate() + ((wd - t.getUTCDay() + 7) % 7));
    if (t <= now) t.setUTCDate(t.getUTCDate() + (wd != null ? 7 : 1));
    return t;
  };
  const left = (t) => { const m = Math.ceil((t - now) / 60000), d = Math.floor(m / 1440);
    return (d ? d + "d " : "") + Math.floor(m % 1440 / 60) + "h" + (d ? "" : " " + m % 60 + "m"); };
  const cell = (name, t) => `<span>${name}</span><b class="${t - now < 3 * H ? "soon" : ""}">${left(t)}</b>`;
  const maint = next(1, 4), ends = new Date(maint - 7 * 24 * H + 2 * H);
  $("#timers").innerHTML = cell("DAILY RESET", next(21)) + cell("WEEKLY RESET", next(21, 3))
    + (now < ends ? `<span>MAINTENANCE</span><b class="now">now · ${left(ends)} left</b>` : cell("MAINTENANCE", maint));
}
drawTimers();
setInterval(drawTimers, 20000);
setInterval(refresh, 2000);

// A snapshot was taken while the window is open: the lists the pages keep (characters, Identities, enemies, music…)
// were read from the one before, or from nothing on the first run, so they are read again.
function newSnapshot() {
  anim.data = null; UNITS = null; ENEMIES = null; STAGES = null; gi.data = null; vs.maps = vs.bgm = null;
  if (!$("#player")) muStart();
  if (["anim", "db", "enemies", "stages", "teams", "versus", "autobattler"].includes(location.hash.split("/")[1])) route();
}

// ------------------------------------------------------------------ router
const routes = {};
function route() {
  const [, name = "patches", ...rest] = location.hash.split("/");
  const sub = document.querySelector(`#subnav a[data-route="${name}"]`);
  const group = sub ? sub.parentElement.dataset.group : ({ scan: "patches", vsroom: "versus", gamegacha: "gacha" })[name] || name;
  document.querySelectorAll("#top a[data-group]").forEach((a) => a.classList.toggle("active", a.dataset.group === group));
  document.querySelectorAll("#subnav div").forEach((d) => { d.hidden = d.dataset.group !== group; });
  document.querySelectorAll("#subnav a").forEach((a) => a.classList.toggle("active", a === sub));
  refresh.hook = null;
  stopAnim();
  (routes[name] || routes.patches)(rest.map(decodeURIComponent));
}
window.addEventListener("hashchange", route);

// ------------------------------------------------------------------ jobs
function jobBlock() {
  const j = STATE && STATE.job;
  if (!j) return "";
  if (j.running) return `<div class="card"><b>${esc(j.kind)}</b> — ${esc(j.stage)} ${j.total ? `${j.done}/${j.total}` : ""}<div class="progress"><div style="width:${j.total ? (100 * j.done / j.total) : 5}%"></div></div><div class="small muted mono">${esc(j.msg || "")}</div><button class="danger" onclick="api('/api/cancel',{})">Cancel</button></div>`;
  if (j.error) return `<div class="card"><span class="badge removed">failed</span> ${esc(j.kind)}: ${esc(j.error)}</div>`;
  return "";
}
async function installUpdate() {
  if (!confirm("Download the update, close the app and start the new version? Your data stays.")) return;
  try { await api("/api/update_install", {}); toast("Downloading the update… the app restarts by itself.", 20000); refresh(); }
  catch (e) { toast("Update failed: " + esc(e.message)); }
}
async function checkUpdates() {
  const r = await api("/api/update_check", { force: true });
  toast(r.error ? `Could not check: ${esc(r.error)}` : r.newer ? `Update ${esc(r.latest)} is available — see the status menu at the top` : `You have the latest version (${esc(r.current)})`, 6000);
  refresh();
}
// one button for both: a new game patch (builds the report) and a new version of this app
async function checkAll() {
  const [game, app] = await Promise.all([
    api("/api/check", {}).catch((e) => ({ state: e.message })),
    api("/api/update_check", { force: true }).catch((e) => ({ error: e.message })),
  ]);
  const appLine = app.error ? `could not check (${esc(app.error)})` : app.newer
    ? `<b>${esc(app.latest)} is available</b> — press Install in the status menu at the top` : `latest version (${esc(app.current)})`;
  toast(`<div>Game: ${esc(game.state)}</div><div>App: ${appLine}</div>`, 8000);
  refresh();
}
async function checkVersion() {
  try { const r = await api("/api/check", {}); toast(esc(r.state), 6000); refresh(); }
  catch (e) { toast(esc(e.message)); }
}
async function takeSnapshot() {
  try { await api("/api/snapshot", { report: true }); toast("Snapshot started"); refresh(); }
  catch (e) { toast(esc(e.message)); }
}

// ------------------------------------------------------------------ Patches
routes.patches = async (args) => {
  if (args[0]) return renderReport(args.join("/"));
  const main = $("#main");
  const draw = () => {
    const s = STATE;
    if (!s) return;
    let h = `<h1>Patches</h1><div class="sub">What changed between game versions. A new report is built automatically after each patch.</div>`;
    h += jobBlock();
    if (!s.snapshots.length) {
      h += `<div class="empty"><p>No snapshot yet. Take the first one now — it is the baseline the next patch will be compared with.<br>The first snapshot reads the whole game cache (about 10 min), later ones only what changed.</p><button class="primary" onclick="takeSnapshot()" ${s.job && s.job.running ? "disabled" : ""}>Take first snapshot</button></div>`;
    } else if (!s.reports.length) {
      h += `<div class="empty"><p>Baseline ready: <b>${esc(fmtSnap(s.snapshots[s.snapshots.length - 1].id))}</b>. There is nothing to compare it with yet, so there are no reports.</p>
        <p><b>After the next patch:</b> open the game and let it download everything. The app notices the new version by itself (on start, or within 2 minutes if it is already open) and builds the report.</p>
        <p class="small">A report has tabs <b>Highlights</b> (next-update and test / dummy files, KR/JP-only lines) · <b>Texts</b> · <b>Data</b> (changed records by id) ·
        <b>Images</b> (before → after) · <b>Audio</b> (new tracks, playable) · <b>Video</b> · <b>Code</b> · <b>New paths</b> · <b>Other</b> (everything else).</p>
        <p>Meanwhile you can look at what is already in the files:</p>
        <div class="row" style="justify-content:center"><button onclick="location.hash='#/scan/${encodeURIComponent(s.snapshots[s.snapshots.length - 1].id)}'">Highlights of the current version</button>
        <button onclick="location.hash='#/browse'">Browse files</button></div></div>`;
    }
    for (const r of s.reports) {
      // (a report's row: the build's day large, what changed as large counts)
      const m = /^build (\d\d\.\d\d)\.(\d{4}) · taken (.+)$/.exec(fmtSnap(r.new));
      h += `<div class="card click rep" onclick="location.hash='#/patches/${encodeURIComponent(r.id)}'"><div class="repd">${m ? `<b>${m[1]}</b><span>${m[2]} · taken ${esc(m[3])}</span>` : `<span>${esc(fmtSnap(r.new))}</span>`}</div>
        <div class="repb">${summaryChips(r.summary)}<div class="muted small">compared with ${esc(fmtSnap(r.old))}</div></div><span class="repgo">Open report ›</span></div>`;
    }
    main.innerHTML = h;
  };
  draw();
  refresh.hook = draw;
};

// ------------------------------------------------------------------ Report
// what each tab would show — explained when a patch has nothing there
const TAB_HELP = {
  texts: "Localization files (EN / KR / JP) and readable text inside bundles: new and edited lines by record id.",
  data: "The game's tables (StaticData): stages, enemies, skills, items… — added, changed and removed records.",
  images: "New and redrawn images: status icons, CG, backgrounds, portraits, gacha banners…",
  audio: "Sound banks: music, voiced story scenes, character voices, effects — every new or changed sound playable.",
  video: "Video files: acquisition videos of Identities / E.G.O, skill previews, cutscenes.",
  code: "The game's code: GameAssembly.dll and global-metadata.dat. A report lists the readable names that appeared or disappeared — ability classes (PassiveAbility_…, CoinAbility_…), script paths such as ScriptsForNextUpdate, text constants. New mechanics often show up here before they are in the data.",
  other: "Everything else: prefabs, shaders, animations, materials…",
};
const SECTIONS = [
  ["leaks", "Highlights"], ["texts", "Texts"], ["data", "Data"], ["images", "Images"], ["audio", "Audio"],
  ["video", "Video"], ["code", "Code"], ["catalog", "New paths"], ["other", "Other"],
];
let REPORT = null;
const view = { tab: "leaks", q: "", kinds: new Set(["added", "changed", "removed"]), starred: false, shown: PAGE };

async function renderReport(id, keepTab) {
  const main = $("#main");
  // (a tab of the report that is open: drawn from what was read — the report is megabytes to fetch and to parse)
  if (!(keepTab && REPORT && REPORT.id === id)) {
    main.innerHTML = `<div class="muted">Loading report…</div>`;
    try {
      [REPORT, MARKS] = await Promise.all([api(`/api/report?id=${encodeURIComponent(id)}`), api("/api/marks")]);
    } catch (e) { main.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  }
  const r = REPORT, s = r.summary;
  const counts = {
    // images: the ones with a path in the game; nameless sprite-sheet pieces are counted inside the tab
    leaks: s.leaks + s.foreign_only, texts: s.texts, data: s.data, images: (r.sections.images || []).filter((it) => it.path).length || s.images, audio: s.audio,
    video: s.video, code: s.code, catalog: s.catalog_added + s.catalog_removed, other: s.other,
  };
  // opening a report lands on the first tab with something in it; a tab the user clicks stays open even if empty
  if (!keepTab && !counts[view.tab]) view.tab = SECTIONS.find(([k]) => counts[k])?.[0] || "leaks";
  main.innerHTML = `<div class="row"><div class="grow"><h1>Patch · ${esc(fmtVer(r.new.version))}</h1>
    <div class="sub">${esc(fmtSnap(r.new.id))} compared with ${esc(fmtSnap(r.old.id))} · ${s.bundles_changed} bundles changed</div></div>
    <div class="row" style="gap:10px">${STATE && STATE.site_publish ? `<button id="rsite" title="put this report and the Identities & E.G.O database on the web copy">Send to site</button>` : ""}<button id="rnotes" title="a short text of what's new, to paste into Discord or Telegram">What's new</button><a href="#/patches">← all patches</a></div></div>
    <div class="tabs">${SECTIONS.map(([k, label]) => `<button data-tab="${k}" class="${k === view.tab ? "active" : ""} ${k === "leaks" && counts.leaks ? "has-leak" : ""}">${label}<span class="n">${counts[k]}</span></button>`).join("")}</div>
    <div class="filters">
      <input type="search" id="q" placeholder="Filter by name / path / text…" value="${esc(view.q)}">
      ${["added", "changed", "removed"].map((k) => `<button class="toggle ${view.kinds.has(k) ? "on" : ""}" data-kind="${k}">${k}</button>`).join("")}
      <button class="toggle ${view.starred ? "on" : ""}" id="starred">★ only</button>
    </div>
    <div id="sec"></div>`;
  main.querySelectorAll(".tabs button").forEach((b) => b.onclick = () => { view.tab = b.dataset.tab; view.shown = PAGE; renderReport(id, true); });
  main.querySelectorAll("[data-kind]").forEach((b) => b.onclick = () => { const k = b.dataset.kind; view.kinds.has(k) ? view.kinds.delete(k) : view.kinds.add(k); b.classList.toggle("on"); view.shown = PAGE; drawSection(); });
  $("#starred").onclick = (e) => { view.starred = !view.starred; e.target.classList.toggle("on"); drawSection(); };
  $("#rnotes").onclick = () => showNotes(id);
  if ($("#rsite")) $("#rsite").onclick = async () => {
    try { await api("/api/site_publish", { id }); toast("Sending to the site… the progress is in the status at the top.", 8000); refresh(); }
    catch (e) { toast(esc(e.message)); }
  };
  let t;
  $("#q").oninput = (e) => { clearTimeout(t); t = setTimeout(() => { view.q = e.target.value; view.shown = PAGE; drawSection(); }, 250); };
  drawSection();
}

function itemText(it) {
  return [it.name, it.path, it.type, it.bundle].join(" ").toLowerCase();
}
function filterItems(items) {
  const q = view.q.trim().toLowerCase();
  return items.filter((it) => (!it.kind || view.kinds.has(it.kind))
    && (!q || itemText(it).includes(q) || (q.length > 2 && JSON.stringify(it.records || it.lines || "").toLowerCase().includes(q)))
    && (!view.starred || MARKS[markKey(it)] === "star"));
}
function moreButton(total) {
  return total > view.shown ? `<button class="more" id="more">Show more (${total - view.shown} left)</button>` : "";
}
function bindMore() {
  const m = $("#more");
  if (m) m.onclick = () => { view.shown += PAGE * 2; drawSection(); };
}
function starBtn(it) {
  const k = markKey(it), on = MARKS[k] === "star";
  return `<button class="star ${on ? "on" : ""}" data-mark="${esc(k)}" title="Mark as interesting">★</button>`;
}
function bindStars(root) {
  root.querySelectorAll("[data-mark]").forEach((b) => b.onclick = async (e) => {
    e.stopPropagation();
    const k = b.dataset.mark, on = MARKS[k] === "star";
    if (on) delete MARKS[k]; else MARKS[k] = "star";
    b.classList.toggle("on", !on);
    await api("/api/mark", { key: k, mark: on ? null : "star" });
  });
}

function drawSection() {
  const el = $("#sec"), r = REPORT, tab = view.tab;
  if (tab === "leaks") return drawLeaks(el);
  if (tab === "catalog") return drawCatalog(el);
  let items = filterItems(r.sections[tab] || []);
  if (!items.length) { el.innerHTML = `<div class="empty">${(r.sections[tab] || []).length ? "Nothing matches the filter." : `Nothing changed here in this patch.<br><span class="small">${esc(TAB_HELP[tab] || "")}</span>`}</div>`; return; }
  if (tab === "images") return drawImages(el, items);
  if (tab === "audio") return drawAudio(el, items);
  if (tab === "other") {
    // "added Shader" etc.: click a type to list only those
    if (view.otherType) items = items.filter((it) => `${it.kind} ${it.type}` === view.otherType);
    const chip = (k, n) => `<button class="toggle ${view.otherType === k ? "on" : ""}" data-otype="${esc(k)}">${esc(k)} <b>${n}</b></button>`;
    el.innerHTML = `<div class="card"><b>By type</b> <span class="muted small">click to show only that type</span><div class="chips imgcats">${r.other_by_type.map(([k, n]) => chip(k, n)).join("")}</div></div>` + listHtml(items);
    el.querySelectorAll("[data-otype]").forEach((b) => b.onclick = () => { view.otherType = view.otherType === b.dataset.otype ? null : b.dataset.otype; view.shown = PAGE; drawSection(); });
  } else {
    el.innerHTML = listHtml(items);
  }
  bindList(el, items);
}

// ---------- audio: FMOD banks by what they hold, from the bank's name
const AUDIO_CATS = [
  ["Music", /^BGM_/i],
  ["Story dialogue", /^(S\d|E\d|\d+D\d)/],          // voiced story scenes: S1034A, E301B, 1D104B…
  ["Character voices", /^Voice_(Default|Title)/i],    // Identity lines: formation, smalltalk, login…
  ["Announcers", /^Voice_Battle_Announcer/i],
  ["RPG", /^(RPG|RPC)_|-RPG-/i],
  ["Sound effects", /^(SFX|UI$|UI\.)/i],
];
const bankName = (it) => String(it.path || it.name || "").split("/").pop().replace(/(\.assets)?\.bank$/i, "");
function audioCat(it) {
  const n = bankName(it);
  for (const [label, re] of AUDIO_CATS) if (re.test(n)) return label;
  return "Other sounds";
}
const AUDIO_ORDER = [...AUDIO_CATS.map(([l]) => l), "Other sounds"];
function drawAudio(el, all) {
  const nSounds = (it) => it.sounds ? it.sounds.added.length + it.sounds.changed.length + it.sounds.removed.length : 0;
  const counts = {}, sounds = {};
  all.forEach((it) => { const c = audioCat(it); counts[c] = (counts[c] || 0) + 1; sounds[c] = (sounds[c] || 0) + nSounds(it); });
  if (view.audioCat && !counts[view.audioCat]) view.audioCat = null;
  // by category, then the banks with the most new/changed sounds; metadata-only .bank twins last
  const items = all.filter((it) => !view.audioCat || audioCat(it) === view.audioCat)
    .map((it) => [AUDIO_ORDER.indexOf(audioCat(it)), -nSounds(it), it]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map((x) => x[2]);
  const chip = (c, label, n, k) => `<button class="toggle ${view.audioCat === c ? "on" : ""}" data-acat="${esc(c || "")}">${esc(label)} <span class="muted small">${k ? `${k} sounds` : `${n} files`}</span></button>`;
  let h = `<div class="chips imgcats">${chip(null, "All", all.length, Object.values(sounds).reduce((a, b) => a + b, 0))}${AUDIO_ORDER.filter((c) => counts[c]).map((c) => chip(c, c, counts[c], sounds[c])).join("")}</div>`;
  let prev = null;
  h += items.slice(0, view.shown).map((it, i) => {
    const c = audioCat(it), head = c !== prev && !view.audioCat ? `<h3 class="group">${esc(c)} <span class="muted small">${sounds[c] ? `${sounds[c]} sounds` : `${counts[c]} files`}</span></h3>` : "";
    prev = c;
    return head + listHtml([it], i);
  }).join("") + moreButton(items.length);
  el.innerHTML = h;
  el.querySelectorAll("[data-acat]").forEach((b) => b.onclick = () => { view.audioCat = b.dataset.acat || null; view.shown = PAGE; drawSection(); });
  bindList(el, items);
}

// ---------- lists (texts / data / audio / video / code / other)
function listHtml(items, at) {
  const single = at !== undefined;
  return (single ? items : items.slice(0, view.shown)).map((it, j) => {
    const i = single ? at : j;
    const counts = it.records ? diffStat(it.records.counts)
      : it.sounds ? (it.sounds.added.length + it.sounds.changed.length + it.sounds.removed.length
        ? diffStat({ added: it.sounds.added.length, changed: it.sounds.changed.length, removed: it.sounds.removed.length }) + `<span class="muted small">sounds</span>`
        : `<span class="muted small">no sounds inside</span>`) : "";
    const lang = it.lang ? `<span class="badge lang">${esc(it.lang)}</span>` : "";
    return `<div class="item" data-i="${i}"><div class="head">${badge(it.kind)} ${flagBadges(it.flags)} ${lang}
      <span class="path grow">${it.path || it.name ? esc(it.path || it.name) : `<span class="muted">(no name · ${esc(it.pid || "")})</span>`}${it.path && it.name && !it.path.endsWith(it.name) ? ` <span class="muted">(${esc(it.name)})</span>` : ""}</span>
      ${counts}<span class="muted small">${esc(it.type)}${it.bundle ? " · " + esc(it.bundle) : ""}</span>${starBtn(it)}</div><div class="body"></div></div>`;
  }).join("") + (single ? "" : moreButton(items.length));
}
// "+61 ~2 −26" in green / yellow / red like a GitHub diff; zeros left out
function diffStat(c) {
  const part = (n, sign, cls) => n ? `<span class="${cls}">${sign}${n}</span>` : "";
  return `<span class="diffstat">${part(c.added, "+", "d-add")}${part(c.changed, "~", "d-chg")}${part(c.removed, "−", "d-rem")}</span>`;
}
let LIST_ITEMS = [];
function bindList(el, items) {
  LIST_ITEMS = items;
  el.querySelectorAll(".item > .head").forEach((h) => h.onclick = () => {
    const box = h.parentElement, it = LIST_ITEMS[+box.dataset.i];
    box.classList.toggle("open");
    if (box.classList.contains("open") && !box.dataset.loaded) { box.dataset.loaded = 1; fillItemBody($(".body", box), it); }
  });
  bindStars(el);
  bindMore();
}

function fillItemBody(body, it) {
  let h = "";
  if (it.records) h += recordsHtml(it.records);
  if (it.lines) h += `<pre class="mono">${it.lines.map((l) => `<span style="color:${l[0] === "+" ? "var(--add)" : l[0] === "-" ? "var(--rem)" : "inherit"}">${esc(l)}</span>`).join("\n")}</pre>`;
  const n = it.new, o = it.old;
  if (it.type === "AudioClip" && n) h += `<audio controls preload="none" src="${live(it)}"></audio>`;
  if (it.type === "VideoClip" && n) h += `<video controls preload="none" src="${live(it)}" style="max-width:100%"></video>`;
  if (it.names) {
    const nm = it.names;
    const list = (arr, k) => arr.map((x) => `<div class="mono small">${badge(k)} ${esc(x)}</div>`).join("");
    h += `<div class="small muted" style="margin-bottom:6px">Readable strings of the game code — ability classes (PassiveAbility_…, CoinAbility_…),
      script paths (look for ScriptsForNextUpdate), text constants: +${nm.counts.added} new, −${nm.counts.removed} gone.
      New mechanics often show up here before they are in the data.</div>
      <input type="search" placeholder="Filter names…" oninput="filterNames(this)" style="width:320px;margin-bottom:8px">
      <div class="names" style="max-height:60vh;overflow:auto">${list(nm.added, "added")}${list(nm.removed, "removed")}</div>`;
  }
  if (it.sounds) {
    const sd = it.sounds;
    const row = (s, k) => `<tr><td>${badge(k)}</td><td class="mono">${esc(s[0])}</td><td class="muted small">${fmtMs(s[1])}</td>
      <td>${k !== "removed" ? soundPlayer(it.path, s[2], s[0]) : ""}</td></tr>`;
    h += `<div class="small muted" style="margin-bottom:6px">${sd.total} sounds in this bank</div><table>${sd.added.map((s) => row(s, "added")).join("")}${sd.changed.map((s) => row(s, "changed")).join("")}${sd.removed.map((s) => row(s, "removed")).join("")}</table>`;
    if (!sd.added.length && !sd.changed.length && !sd.removed.length) h += `<div class="muted small">Same sound names and lengths — the bank changed internally.</div>`;
  }
  if (it.type === "file") {
    h += `<div class="small muted">size ${fmtSize(o && o.size)} → ${fmtSize(n && n.size)}</div>`;
    if (!it.records && !it.lines && n && n.blob) h += `<button onclick="showBlob('${n.blob}')">Show content</button>`;
  } else if (n && it.bundle) {
    h += `<div class="row" style="margin-top:8px"><button onclick='showObject(${JSON.stringify({ bundle: it.bundle, pid: it.pid, type: it.type, name: it.name || "" })})'>Open</button>
      <button onclick='exportObj(${JSON.stringify({ bundle: it.bundle, pid: it.pid })})'>Export</button></div>`;
  }
  body.innerHTML = h || `<div class="muted">No preview.</div>`;
  translateIn(body);
}

// records diff (json with ids)
function valHtml(v) {
  if (v === undefined || v === null) return `<span class="muted">—</span>`;
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return CJK.test(s) ? `<span class="orig">${esc(s)}</span><span class="tr" data-src="${esc(s)}">…</span>` : esc(s);
}
function recordFields(rec) {
  return Object.entries(rec).map(([k, v]) => `<div class="field"><span class="k">${esc(k)}</span>${valHtml(v)}</div>`).join("");
}
function recordsHtml(rd) {
  let h = "";
  const ridOf = (r) => esc(r.id ?? r.ID ?? r.key ?? "");
  for (const r of rd.added) h += `<div class="rec added"><div class="rid">added · id ${ridOf(r)}</div>${recordFields(r)}</div>`;
  for (const c of rd.changed) h += `<div class="rec changed"><div class="rid">changed · id ${esc(c.id)}</div>${Object.entries(c.fields).map(([k, [a, b]]) =>
    `<div class="field"><span class="k">${esc(k)}</span><span class="old">${valHtml(a)}</span> → <span class="new">${valHtml(b)}</span></div>`).join("")}</div>`;
  for (const r of rd.removed) h += `<div class="rec removed"><div class="rid">removed · id ${ridOf(r)}</div>${recordFields(r)}</div>`;
  const c = rd.counts, shown = rd.added.length + rd.changed.length + rd.removed.length, total = c.added + c.changed + c.removed;
  if (total > shown) h += `<div class="muted small">${total - shown} more records not shown</div>`;
  return h || `<div class="muted">No record changes (formatting only).</div>`;
}
async function translateIn(root) {
  const spans = [...root.querySelectorAll(".tr[data-src]")].filter((s) => !s.dataset.done);
  if (!spans.length) return;
  spans.forEach((s) => s.dataset.done = 1);
  for (let i = 0; i < spans.length; i += 40) {
    const chunk = spans.slice(i, i + 40);
    try {
      const { result } = await api("/api/translate", { texts: chunk.map((s) => s.dataset.src) });
      chunk.forEach((s, j) => s.textContent = result[j] || "(no translation)");
    } catch (e) {
      spans.slice(i).forEach((s) => { s.textContent = `(${e.message})`; delete s.dataset.done; });
      return;
    }
  }
}

// ---------- images
function imgPair(it) {
  const o = it.old, n = it.new;
  const oldSrc = o && (o.type === "Texture2D" ? thumb(o.h) : o.tex ? thumb(o.tex) : "");
  const newSrc = n ? (n.type === "Texture2D" ? thumb(n.h) : live(it)) : "";
  return { oldSrc, newSrc };
}
// Images grouped by what they are, from the folder the game keeps them in
const NOPATH_CAT = "Without a path";
const IMG_CATS = [
  ["Status effects", /^Buf\//], ["Skill icons", /^Sprite\/SkillIcon/], ["Portraits", /^Sprite\/(Unit|UserInfoSuppotPortrait|MailSenderPortrait)\//],
  ["CG thumbnails", /^Sprite\/(UnitCgThumbnail|LoadCgThumbnail|StageNodeCG)\//], ["Story CG", /^Story\/CG\//],
  ["Backgrounds", /^Story\/Backgrounds\//], ["Story characters", /^Story\/(StandingModel|StandingSprite|StoryPortrait|RPGPortrait)\//],
  ["Gacha", /^Gacha\//], ["E.G.O gifts", /^Sprite\/EgoGiftIcon\//], ["Announcers", /^Sprite\/(BattleAnnouncer|CollabAnnouncerFrame)\//],
  ["Banners & tickets", /^Sprite\/(Banner|UserInfoBanner|UserInfoBannerMaster|UserInfoTicket_[LR]|UserinfoTicket_EGO_Bg)\//],
  ["Maps & dungeons", /^(Sprite\/(StageMap|Chapter|StoryDungeonMapIllust|Dungeon|ChoiceEvent)|MirrorDungeon|Dungeon)\//],
  ["RPG", /^(RPGSystem|V2_Texture\/RPG|Sprite\/RPGUI)\//], ["Notices", /^Notice\//], ["Skin previews", /^SkinPreview/],
  ["UI", /^(Sprite\/UI|UI|V2_Texture|DUI|UIConfigs|Sprite\/PanicType)\//],
];
function imgCat(it) {
  if (!it.path) return NOPATH_CAT;
  const p = it.path.replace(/^Assets\/Resources_moved\//, "");
  for (const [label, re] of IMG_CATS) if (re.test(p)) return label;
  return "Other images";
}
const IMG_ORDER = [...IMG_CATS.map(([l]) => l), "Other images", NOPATH_CAT];
function drawImages(el, all) {
  const counts = {};
  all.forEach((it) => { const c = imgCat(it); counts[c] = (counts[c] || 0) + 1; });
  const cats = IMG_ORDER.filter((c) => counts[c]);
  if (view.imgCat && !counts[view.imgCat]) view.imgCat = null;
  // "All" leaves out the nameless sprites (effect frames, map tiles, parts of sprite sheets): thousands, rarely news
  const items = all.filter((it) => view.imgCat ? imgCat(it) === view.imgCat : imgCat(it) !== NOPATH_CAT)
    .map((it) => [IMG_ORDER.indexOf(imgCat(it)), it]).sort((a, b) => a[0] - b[0]).map(([, it]) => it);
  const named = all.length - (counts[NOPATH_CAT] || 0);
  const chip = (c, n, label) => `<button class="toggle ${view.imgCat === c ? "on" : ""}" data-icat="${esc(c || "")}">${esc(label || c)} <span class="muted small">${n}</span></button>`;
  let h = `<div class="chips imgcats">${chip(null, named, "All")}${cats.map((c) => chip(c, counts[c])).join("")}</div>`;
  if (!view.imgCat && counts[NOPATH_CAT]) h += `<div class="muted small" style="margin:-4px 0 10px">${counts[NOPATH_CAT]} images without a path in the game (effect frames, map tiles, pieces of sprite sheets) are under <b>${NOPATH_CAT}</b>.</div>`;
  let prev = null;
  h += `<div class="grid">${items.slice(0, view.shown).map((it, i) => {
    const c = imgCat(it), head = c !== prev && !view.imgCat ? `<h3 class="group" style="grid-column:1/-1;margin:8px 0 0">${esc(c)} <span class="muted small">${counts[c]}</span></h3>` : "";
    prev = c;
    const { oldSrc, newSrc } = imgPair(it);
    const pics = it.kind === "changed" ? `<img loading="lazy" src="${oldSrc}"><span class="arrow">→</span><img loading="lazy" src="${newSrc}">`
      : `<img loading="lazy" src="${it.kind === "removed" ? oldSrc : newSrc}">`;
    const dims = (it.new || it.old || {}).w ? ` · ${(it.new || it.old).w}×${(it.new || it.old).hgt}` : "";
    return head + `<div class="tile ${MARKS[markKey(it)] === "seen" ? "seen" : ""}" data-i="${i}">${starBtn(it)}<div class="pics">${pics}</div>
      <div class="cap">${badge(it.kind)} ${flagBadges(it.flags)} <b>${esc(it.name || "")}</b><div class="muted">${esc(it.type)}${dims}</div><div class="muted">${esc(it.path || it.bundle || "")}</div></div></div>`;
  }).join("")}</div>${moreButton(items.length)}`;
  el.innerHTML = h;
  el.querySelectorAll("[data-icat]").forEach((b) => b.onclick = () => { view.imgCat = b.dataset.icat || null; view.shown = PAGE; drawSection(); });
  el.querySelectorAll(".tile").forEach((t) => t.onclick = () => openImage(items[+t.dataset.i]));
  bindStars(el);
  bindMore();
}
function openImage(it) {
  const { oldSrc } = imgPair(it);
  const n = it.new;
  let h = `<h2 style="margin-top:0">${esc(it.name || "")}</h2><div class="small muted mono" style="margin-bottom:10px">${esc(it.path || "")} · ${esc(it.bundle)} · ${esc(it.type)}</div><div class="compare">`;
  if (it.old) h += `<figure><img src="${oldSrc}"><figcaption>before (stored preview)</figcaption></figure>`;
  if (n) h += `<figure><img src="${live(it)}"><figcaption>now (full size from the game cache)</figcaption></figure>`;
  h += `</div>`;
  if (n) h += `<div class="row" style="margin-top:12px"><button onclick='exportObj(${JSON.stringify({ bundle: it.bundle, pid: it.pid })})'>Export PNG</button></div>`;
  modal(h);
}

// ---------- leaks
// group lists by file extension: ".png" files together, then ".prefab", …; inside a group by path
const fileExt = (p) => { const n = String(p || "").split("/").pop(); const i = n.lastIndexOf("."); return i > 0 ? n.slice(i + 1).toLowerCase() : ""; };
function byFileType(arr, pathOf) {
  const count = {};
  arr.forEach((x) => { const e = fileExt(pathOf(x)); count[e] = (count[e] || 0) + 1; });
  return [...arr].sort((a, b) => {
    const ea = fileExt(pathOf(a)), eb = fileExt(pathOf(b));
    return ea !== eb ? (count[eb] - count[ea]) || ea.localeCompare(eb) : String(pathOf(a)).localeCompare(String(pathOf(b)));
  });
}
const IMG_EXT = new Set(["png", "jpg", "jpeg", "tga", "psd", "webp"]);
// inline preview for image assets, so the list can be skimmed without clicking
const thumbFor = (path, types) => path && (IMG_EXT.has(fileExt(path)) || (types || []).some((t) => t === "Texture2D" || t === "Sprite")) && !/^(install|locallow)\//.test(path)
  ? `<img loading="lazy" src="/api/asset_thumb?path=${encodeURIComponent(path)}" onerror="this.remove()">` : "";
function groupHeader(arr, i, pathOf, wrap) {
  const e = fileExt(pathOf(arr[i]));
  if (i > 0 && fileExt(pathOf(arr[i - 1])) === e) return "";
  const n = arr.filter((x) => fileExt(pathOf(x)) === e).length;
  return wrap(`${e ? "." + esc(e) : "no extension"} <span class="muted small">${n}</span>`);
}
function leakThumb(it) {
  if (it.path) return thumbFor(it.path, [it.type]);
  return (it.type === "Texture2D" || it.type === "Sprite") && it.bundle && it.pid
    ? `<img loading="lazy" src="${live(it)}" onerror="this.remove()">` : "";
}
function drawLeaks(el) {
  const r = REPORT;
  const items = byFileType(filterItems(r.sections.leaks), (it) => it.path || it.name);
  let h = `<h2 style="margin-top:0">Notable names</h2><div class="sub small">Files whose names contain nextupdate / notinclude / DoNotTranslate (<b>next update</b>) or dummy / test / temp / unused (<b>test / dummy</b>). Grouped by file type. Click to open.</div>`;
  h += items.length ? items.slice(0, view.shown).map((it, i) => groupHeader(items, i, (x) => x.path || x.name, (hd) => `<h3 class="group">${hd}</h3>`) +
    `<div class="card click row" data-leak="${i}"><div class="grow">${badge(it.kind)} ${flagBadges(it.flags)} <span class="mono">${esc(it.path || it.name)}</span>
     <span class="muted small">${esc(it.type)} · in ${esc(it.section)}</span></div><div class="thumbcell">${it.kind !== "removed" ? leakThumb(it) : ""}</div></div>`).join("") + moreButton(items.length) : `<div class="empty">No notable names in this patch.</div>`;
  h += `<h2>Lines only in KR / JP</h2><div class="sub small">Localization records with real text that have no English version yet. Original first, then a machine translation.</div>`;
  const q = view.q.trim().toLowerCase();
  const files = r.foreign_only.filter((f) => !q || JSON.stringify(f).toLowerCase().includes(q));
  h += files.length ? files.map((f) => `<div class="item open"><div class="head"><span class="path grow mono">${esc(f.file)}</span><span class="muted small">${f.count} records</span></div>
     <div class="body">${f.records.map((rec) => `<div class="rec added"><div class="rid"><span class="badge lang">${esc(rec.lang)}</span> id ${esc(rec.id)}</div>${recordFields(rec.record)}</div>`).join("")}
     ${f.count > f.records.length ? `<div class="muted small">${f.count - f.records.length} more</div>` : ""}</div></div>`).join("") : `<div class="empty">No new KR/JP-only lines.</div>`;
  el.innerHTML = h;
  el.querySelectorAll("[data-leak]").forEach((c) => c.onclick = () => {
    const it = items[+c.dataset.leak];
    if (it.kind === "removed") return toast("Removed in this patch — only the name is left.");
    if (it.path) openPath(it.path);
    else if (it.bundle && it.pid) showObject({ bundle: it.bundle, pid: it.pid, type: it.type, name: it.name });
    else toast("This report was built by an older version — open it from Browse files.");
  });
  bindMore();
  translateIn(el);
}

// ---------- catalog paths
function drawCatalog(el) {
  const q = view.q.trim().toLowerCase();
  const add = REPORT.catalog.added.filter((c) => view.kinds.has("added") && (!q || c.path.toLowerCase().includes(q)));
  const rem = REPORT.catalog.removed.filter((c) => view.kinds.has("removed") && (!q || c.path.toLowerCase().includes(q)));
  const row = (c, k) => `<tr><td>${badge(k)} ${flagBadges(c.flags)}</td><td class="mono">${esc(c.path)}</td><td class="muted small">${esc(c.types.join(", "))}</td><td class="muted small">${esc(c.bundle || "")}</td></tr>`;
  el.innerHTML = `<div class="sub small">Asset paths that appeared in or disappeared from the catalog — names of new files even before their content is used.</div>
    <table><tr><th></th><th>path</th><th>types</th><th>bundle</th></tr>${add.slice(0, view.shown).map((c) => row(c, "added")).join("")}${rem.slice(0, view.shown).map((c) => row(c, "removed")).join("")}</table>
    ${moreButton(Math.max(add.length, rem.length))}`;
  bindMore();
}

// ------------------------------------------------------------------ object preview / export (shared)
async function previewHtml(o) {
  const src = `/api/object?bundle=${encodeURIComponent(o.bundle)}&pid=${o.pid}`;
  if (o.type === "Texture2D" || o.type === "Sprite") return `<img src="${src}">`;
  if (o.type === "AudioClip") return `<audio controls src="${src}"></audio>`;
  if (o.type === "VideoClip") return `<video controls src="${src}"></video>`;
  const r = await fetch(o.type === "TextAsset" || o.type === "Mesh" ? src : src + "&fmt=props");
  if (!r.ok) return `<div class="empty">${esc((await r.json().catch(() => ({}))).error || r.statusText)}</div>`;
  let text = await r.text();
  try { text = JSON.stringify(JSON.parse(text), null, 1); } catch (e) { /* not json */ }
  if (text.length > 400000) text = text.slice(0, 400000) + "\n… (truncated, export to see everything)";
  return `<pre>${esc(text)}</pre>${CJK.test(text.slice(0, 20000)) ? `<button onclick="translatePre(this)">Translate visible KR/JP lines</button>` : ""}`;
}
async function showObject(o) {
  modal(`<div class="muted">Loading…</div>`);
  const body = await previewHtml(o);
  modal(`<h2 style="margin-top:0">${esc(o.name || o.pid)}</h2><div class="small muted mono" style="margin-bottom:10px">${esc(o.type)} · ${esc(o.bundle)} · pid ${o.pid}</div>
    <div class="preview">${body}</div><div class="row" style="margin-top:12px"><button onclick='exportObj(${JSON.stringify({ bundle: o.bundle, pid: o.pid })})'>Export</button>
    <button onclick='exportObj(${JSON.stringify({ bundle: o.bundle, pid: o.pid, fmt: "props" })})'>Export properties (JSON)</button></div>`);
}
async function showBlob(h) {
  const r = await fetch(`/api/blob?h=${h}`);
  let text = await r.text();
  try { text = JSON.stringify(JSON.parse(text), null, 1); } catch (e) { /* plain text */ }
  modal(`<div class="preview"><pre>${esc(text.slice(0, 400000))}</pre></div>`);
}
async function translatePre(btn) {
  const pre = btn.previousElementSibling;
  const lines = pre.textContent.split("\n").filter((l) => CJK.test(l)).slice(0, 200);
  btn.disabled = true;
  btn.textContent = "Translating…";
  const { result } = await api("/api/translate", { texts: lines });
  const box = document.createElement("div");
  box.innerHTML = lines.map((l, i) => `<div class="field"><span class="orig mono">${esc(l.trim())}</span><span class="tr">${esc(result[i] || "")}</span></div>`).join("");
  btn.replaceWith(box);
}
async function exportObj(o) {
  try {
    const { path } = await api("/api/export", o);
    toast(`Saved <span class="mono">${esc(path)}</span> <button onclick='api("/api/open",{path:${JSON.stringify(path)}})'>Show in folder</button>`, 7000);
  } catch (e) { toast("Export failed: " + esc(e.message)); }
}

// ------------------------------------------------------------------ Browse
const browse = { prefix: "", q: "", type: "" };
routes.browse = async () => {
  const main = $("#main");
  main.innerHTML = `<h1>Browse files</h1><div class="sub">Every asset of the latest snapshot (catalog paths, files of the install) — open, translate, export.</div>
    <div class="filters"><input type="search" id="bq" placeholder="Search objects by name or path (e.g. nextupdate, 20211_e_cg, Bongy)…" value="${esc(browse.q)}">
    <select id="btype"><option value="">all types</option></select><button id="bgo" class="primary">Search</button></div>
    <div class="split"><div class="pane tree" id="tree"></div><div class="pane preview" id="pv"><div class="muted">Select a file.</div></div></div>`;
  api("/api/types").then((types) => {
    $("#btype").innerHTML = `<option value="">all types</option>` + types.map(([t, n]) => `<option ${t === browse.type ? "selected" : ""} value="${esc(t)}">${esc(t)} (${n})</option>`).join("");
  }).catch(() => {});
  $("#bgo").onclick = () => { browse.q = $("#bq").value.trim(); browse.type = $("#btype").value; browse.q || browse.type ? searchObjects() : loadTree(browse.prefix); };
  $("#bq").onkeydown = (e) => { if (e.key === "Enter") $("#bgo").click(); };
  browse.q || browse.type ? searchObjects() : loadTree(browse.prefix);
};
async function loadTree(prefix) {
  browse.prefix = prefix;
  const el = $("#tree");
  el.innerHTML = `<div class="muted">Loading…</div>`;
  const t = await api(`/api/tree?prefix=${encodeURIComponent(prefix)}`);
  const parts = prefix ? prefix.split("/") : [];
  let h = `<div class="crumbs"><a onclick="loadTree('')">root</a>${parts.map((p, i) => ` / <a onclick='loadTree(${JSON.stringify(parts.slice(0, i + 1).join("/"))})'>${esc(p)}</a>`).join("")}</div>`;
  h += t.dirs.map(([d, n]) => `<div class="dir" onclick='loadTree(${JSON.stringify((prefix ? prefix + "/" : "") + d)})'>${esc(d)} <span class="muted small">${n}</span></div>`).join("");
  h += t.files.map((f, i) => `<div data-f="${i}" title="${esc(f.path)}">${esc(f.path.split("/").pop())} <span class="muted small">${esc(f.types.join(", "))}</span></div>`).join("");
  if (t.total_files > t.files.length) h += `<div class="muted small">${t.total_files - t.files.length} more — use search</div>`;
  el.innerHTML = h;
  el.querySelectorAll("[data-f]").forEach((d) => d.onclick = () => openTreeFile(t.files[+d.dataset.f]));
}
// open any catalog path ("Assets/...") or file ("install/...", "locallow/...") in a popup
async function openPath(path) {
  modal(`<div class="preview" id="mpv" style="min-width:60vw"><div class="muted">Loading…</div></div>`);
  const target = $("#mpv");
  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  const t = await api(`/api/tree?prefix=${encodeURIComponent(dir)}`).catch(() => ({ files: [] }));
  const f = t.files.find((x) => x.path === path) || { path, types: ["asset"] };
  await openTreeFile(f, target);
}
async function openTreeFile(f, target) {
  const pv = target || $("#pv");
  if (f.types[0] === "file" && f.path.endsWith(".bank")) {
    pv.innerHTML = `<div class="mono small" style="margin-bottom:8px">${esc(f.path)}</div><div class="muted">Reading sound list…</div>`;
    const sounds = await api(`/api/bank_list?path=${encodeURIComponent(f.path)}`).catch((e) => ({ error: e.message }));
    pv.innerHTML = `<div class="mono small" style="margin-bottom:8px">${esc(f.path)} · ${fmtSize(f.size)}</div>` + (sounds.error ? `<div class="empty">${esc(sounds.error)}</div>`
      : sounds.length ? `<table>${sounds.map((s) => `<tr><td class="mono">${esc(s.name)}</td><td class="muted small">${fmtMs(s.ms)}</td><td>${soundPlayer(f.path, s.i, s.name)}</td></tr>`).join("")}</table>`
      : `<div class="muted">No sounds inside (event/metadata bank). Audio is in the matching *.assets.bank.</div>`);
    return;
  }
  if (f.types[0] === "file") {
    if (!f.blob) { pv.innerHTML = `<div class="mono small">${esc(f.path)}</div><div class="muted">Binary file, ${fmtSize(f.size)} · sha1 ${esc(f.h)}</div>`; return; }
    const r = await fetch(`/api/blob?h=${f.blob}`);
    let text = await r.text();
    try { text = JSON.stringify(JSON.parse(text), null, 1); } catch (e) { /* plain */ }
    pv.innerHTML = `<div class="mono small" style="margin-bottom:8px">${esc(f.path)}</div><pre>${esc(text.slice(0, 400000))}</pre>${CJK.test(text.slice(0, 20000)) ? `<button onclick="translatePre(this)">Translate visible KR/JP lines</button>` : ""}
      <div class="row" style="margin-top:8px"><button onclick='exportObj(${JSON.stringify({ blob: f.blob, name: f.path.split("/").pop() })})'>Export</button></div>`;
    return;
  }
  const objs = await api(`/api/container?path=${encodeURIComponent(f.path)}`);
  if (!objs.length) { pv.innerHTML = `<div class="mono small">${esc(f.path)}</div><div class="muted">Not loaded as a separate object (sub-asset of a bundle). Try search.</div>`; return; }
  pv.innerHTML = `<div class="mono small" style="margin-bottom:8px">${esc(f.path)}</div><div class="row">${objs.map((o, i) => `<button data-o="${i}">${esc(o.type)} ${esc(o.name || "")}</button>`).join("")}</div><div class="pvb" style="margin-top:10px"></div>`;
  const open = async (o) => {
    const box = pv.querySelector(".pvb");
    box.innerHTML = `<div class="muted">Loading…</div>`;
    box.innerHTML = await previewHtml(o) + `<div class="row" style="margin-top:10px"><button onclick='exportObj(${JSON.stringify({ bundle: o.bundle, pid: o.pid })})'>Export</button>
      <button onclick='exportObj(${JSON.stringify({ bundle: o.bundle, pid: o.pid, fmt: "props" })})'>Export properties</button></div>`;
  };
  pv.querySelectorAll("[data-o]").forEach((b) => b.onclick = () => open(objs[+b.dataset.o]));
  open(objs.find((o) => o.type !== "Sprite") || objs[0]);
}
async function searchObjects() {
  const el = $("#tree");
  el.innerHTML = `<div class="muted">Searching… (the first search builds an index, ~1 min)</div>`;
  const rows = await api(`/api/browse?q=${encodeURIComponent(browse.q)}&type=${encodeURIComponent(browse.type)}&limit=500`);
  el.innerHTML = `<div class="crumbs"><a onclick="browse.q='';browse.type='';$('#bq').value='';loadTree(browse.prefix)">← back to folders</a> · ${rows.length}${rows.length === 500 ? "+" : ""} results</div>` +
    rows.map((o, i) => `<div data-o="${i}" title="${esc(o.c || "")}">${esc(o.name || o.c || o.pid)} <span class="muted small">${esc(o.type)} · ${esc(o.bundle)}</span></div>`).join("");
  el.querySelectorAll("[data-o]").forEach((d) => d.onclick = async () => {
    const o = rows[+d.dataset.o];
    $("#pv").innerHTML = `<div class="mono small" style="margin-bottom:8px">${esc(o.c || o.name || "")} · ${esc(o.type)} · ${esc(o.bundle)}</div><div class="muted">Loading…</div>`;
    $("#pv").innerHTML = `<div class="mono small" style="margin-bottom:8px">${esc(o.c || o.name || "")} · ${esc(o.type)} · ${esc(o.bundle)}</div>` + await previewHtml(o) +
      `<div class="row" style="margin-top:10px"><button onclick='exportObj(${JSON.stringify({ bundle: o.bundle, pid: o.pid })})'>Export</button>
       <button onclick='exportObj(${JSON.stringify({ bundle: o.bundle, pid: o.pid, fmt: "props" })})'>Export properties</button></div>`;
  });
}

// ------------------------------------------------------------------ Animations
// Left: Sinners → Identities / E.G.O, then enemies & others by content. Right: the game's own battle clips
// (replayed from the AnimationClips: sprite swaps, layers, offsets, flips, fades) and Spine skeletons.
const anim = { data: null, q: "", sel: null, open: {}, tab: null, clips: null, clip: null, all: false, speed: 1, playing: true, raf: 0, render: null };
routes.anim = async () => {
  const main = $("#main");
  anim.filter = anim.filter || "all";
  main.innerHTML = `<div class="an-app">
    <aside class="an-rail"><div class="an-rhead"><input type="search" id="aq" placeholder="Search: Yi Sang, Sunshower, Canto 9, pirate…" value="${esc(anim.q)}">
      <div class="an-chips" id="afilters"></div></div><div id="alist" class="an-list"></div></aside>
    <div class="an-main" id="aview"><div class="an-empty">Pick a Sinner's Identity or E.G.O, or an enemy on the left.<br>
      <span class="muted small">Skills with the game's own effects and sounds, battle clips, single effects, and your mods — all for the one you pick.</span></div></div></div>`;
  $("#alist").innerHTML = `<div class="muted" style="padding:10px">Loading…</div>`;
  if (!anim.data) anim.data = await api("/api/characters");
  await units().catch(() => null);
  anim.owned = new Set(await api("/api/mods_owned").catch(() => []));
  $("#aq").oninput = (e) => { anim.q = e.target.value; drawAnimTree(); };
  drawAnimTree();
  if (anim.sel) openAnimEntry(anim.sel);
  if (anim.data.pending) waitAnimGroups();
};
// The enemy → chapter map is built in the background on the first run; regroup when it's ready.
async function waitAnimGroups() {
  if (anim.waiting) return;
  anim.waiting = true;
  try {
    while (anim.data.pending) {
      await new Promise((r) => setTimeout(r, 4000));
      anim.data = await api("/api/characters");
    }
  } finally { anim.waiting = false; }
  if ($("#alist")) drawAnimTree();
}
// the last few opened (kept in this browser)
const recentGet = () => { try { return JSON.parse(localStorage.getItem("anim.recent") || "[]"); } catch (e) { return []; } };
function recentAdd(sel, title, sub) {
  if (sel.spine) return;
  const r = [{ key: sel.key, cid: sel.cid, enemy: sel.enemy ? sel.enemy.app : "", title, sub }, ...recentGet().filter((x) => x.key !== sel.key)].slice(0, 5);
  try { localStorage.setItem("anim.recent", JSON.stringify(r)); } catch (e) { /* private mode */ }
}
const animThumb = (id) => {
  const u = typeof unitById === "function" && unitById(id);
  return u && u.img && u.img.thumb ? `<img loading="lazy" src="${imgThumb(u.img.thumb)}" onerror="this.style.visibility='hidden'">` : `<span class="an-ph"></span>`;
};
const AN_FILTERS = [["all", "All"], ["ids", "Identities"], ["egos", "E.G.O"], ["enemies", "Enemies"], ["mine", "★ Mine"]];
function drawAnimTree() {
  const q = anim.q.trim().toLowerCase();
  const hit = (s) => !q || s.toLowerCase().includes(q);
  const f = anim.filter, owned = anim.owned || new Set();
  const sel = (key) => anim.sel && anim.sel.key === key ? "sel" : "";
  const mine = (id) => f !== "mine" || owned.has(String(id));
  $("#afilters").innerHTML = AN_FILTERS.map(([k, l]) => `<button class="an-chip ${f === k ? "on" : ""}" data-f="${k}" ${k === "mine" ? `title="Characters you made a mod for"` : ""}>${l}</button>`).join("");
  $("#afilters").querySelectorAll("[data-f]").forEach((b) => b.onclick = () => { anim.filter = b.dataset.f; drawAnimTree(); });
  let h = "";
  const recent = !q && f === "all" ? recentGet() : [];
  if (recent.length) {
    h += `<div class="an-grp">Recent</div>` + recent.map((r, i) => `<div class="an-it ${sel(r.key)}" data-r="${i}">${r.enemy ? `<span class="an-ph"></span>` : animThumb(r.cid)}<div class="an-t">${esc(r.title)}<small>${esc(r.sub)}</small></div></div>`).join("");
  }
  const chars = f === "all" || f === "ids" || f === "egos" || f === "mine";
  if (chars) {
    h += `<div class="an-grp">Sinners</div>`;
    anim.data.sinners.forEach((s) => {
      const ids = f === "egos" ? [] : s.ids.filter((x) => mine(x.id) && hit(`${s.name} ${x.title} ${x.id}`));
      const egos = f === "ids" ? [] : s.egos.filter((x) => mine(x.id) && hit(`${s.name} ${x.title} ${x.id} ego`));
      if (!ids.length && !egos.length) return;
      const open = q || f === "mine" || anim.open[`s${s.sid}`];
      h += `<div class="an-sn" data-toggle="s${s.sid}"><span class="an-av">${ico(`sinner_${s.sid}`, "s22", s.name, s.name.slice(0, 2))}</span><span class="an-n"><b>${esc(s.name)}</b>
        <small>${ids.length} ID · ${egos.length} E.G.O</small></span><span class="muted">${open ? "▾" : "▸"}</span></div>`;
      if (!open) return;
      const leaf = (x, ego) => `<div class="an-it ${sel(`c${x.id}`)}" data-c="${x.id}">${animThumb(x.id)}<div class="an-t">${esc(x.title)}<small>${ego ? "E.G.O " : ""}${x.id}${x.spine.length ? " · spine" : ""}</small></div>${owned.has(String(x.id)) ? `<span class="an-dot" title="has a mod"></span>` : ""}</div>`;
      if (ids.length) h += `<div class="an-sub">Identities</div>` + ids.map((x) => leaf(x, false)).join("");
      if (egos.length) h += `<div class="an-sub">E.G.O</div>` + egos.map((x) => leaf(x, true)).join("");
    });
  }
  if (f === "all" || f === "enemies" || f === "mine") {
    let g2 = "";
    anim.data.groups.forEach((g, gi) => {
      const kinds = Object.entries(g.kinds).map(([k, arr]) => [k, arr.filter((x) => (f !== "mine" || (x.app && owned.has(String(x.app)))) && hit(`${g.label} ${k} ${x.name || ""} ${x.base} ${x.bundle}`))]).filter(([, arr]) => arr.length);
      if (!kinds.length) return;
      const n = kinds.reduce((a, [, arr]) => a + arr.length, 0);
      const open = q || f === "mine" || anim.open[`g${gi}`];
      g2 += `<div class="an-sn" data-toggle="g${gi}"><span class="an-n"><b>${esc(g.label)}</b> <small>${n}</small></span><span class="muted">${open ? "▾" : "▸"}</span></div>`;
      if (!open) return;
      kinds.forEach(([k, arr]) => {
        g2 += `<div class="an-sub">${esc(k)}</div>` + arr.map((x) => x.app
          // a battle prefab: its skills with the game's effects
          ? `<div class="an-it ${sel(`e${x.app}`)}" data-g="${gi}" data-k="${esc(k)}" data-e="${esc(x.app)}" title="Skills with effects"><span class="an-ph"></span><div class="an-t">⚔ ${x.name ? esc(x.name) : esc(x.app)}<small>${x.name ? esc(x.app) : ""}</small></div>${owned.has(String(x.app)) ? `<span class="an-dot" title="has a mod"></span>` : ""}</div>`
          : `<div class="an-it ${sel(`s${x.bundle}/${x.atlas}`)}" data-g="${gi}" data-k="${esc(k)}" data-a="${x.atlas}" data-b="${esc(x.bundle)}"><span class="an-ph"></span><div class="an-t">${x.name ? esc(x.name) : esc(x.base)}<small>${x.name ? esc(x.base) : "Spine"}</small></div></div>`).join("");
      });
    });
    if (g2 || f !== "mine") h += `<div class="an-grp">Enemies, abnormalities &amp; others</div>` + (anim.data.pending ? `<div class="muted small" style="padding:0 8px 6px">Sorting enemies by chapter…</div>` : "") + g2;
  }
  if (!h.replace(/<div class="an-grp">[^<]*<\/div>/g, "").trim()) h = `<div class="muted" style="padding:10px">${f === "mine" ? "No mods yet: open a character, pick “+ New mod” in the Mod box." : "Nothing found."}</div>`;
  $("#alist").innerHTML = h;
  $("#alist").querySelectorAll("[data-toggle]").forEach((d) => d.onclick = () => { anim.open[d.dataset.toggle] = !anim.open[d.dataset.toggle]; drawAnimTree(); });
  $("#alist").querySelectorAll("[data-c]").forEach((d) => d.onclick = () => { openAnimEntry({ key: `c${d.dataset.c}`, cid: +d.dataset.c }); drawAnimTree(); });
  $("#alist").querySelectorAll("[data-r]").forEach((d) => d.onclick = () => {
    const r = recent[+d.dataset.r];
    let x = null;
    if (r.enemy) for (const g of anim.data.groups) for (const arr of Object.values(g.kinds)) x = x || arr.find((e) => e.app === r.enemy);
    if (r.enemy && !x) return;
    openAnimEntry(r.enemy ? { key: r.key, cid: x.app, enemy: x } : { key: r.key, cid: r.cid });
    drawAnimTree();
  });
  $("#alist").querySelectorAll("[data-e]").forEach((d) => d.onclick = () => {
    const x = anim.data.groups[+d.dataset.g].kinds[d.dataset.k].find((s) => s.app === d.dataset.e);
    openAnimEntry({ key: `e${x.app}`, cid: x.app, enemy: x });
    drawAnimTree();
  });
  $("#alist").querySelectorAll("[data-a]").forEach((d) => d.onclick = () => {
    const x = anim.data.groups[+d.dataset.g].kinds[d.dataset.k].find((s) => s.atlas === d.dataset.a && s.bundle === d.dataset.b);
    openAnimEntry({ key: `s${x.bundle}/${x.atlas}`, spine: x });
    drawAnimTree();
  });
}
function findChar(cid) {
  for (const s of anim.data.sinners) for (const x of [...s.ids, ...s.egos]) if (x.id === cid) return { ...x, sinner: s.name, isEgo: String(cid)[0] === "2" };
  return null;
}
// The header of what is open: picture, title, the Mod box (it applies to every tab: Skills and Effects are rendered with
// the picked mod, Edit mod edits it) and the tabs; the tab's content goes into #abody.
// A character's mods (the short list): asked once, not at every tab — and again after a mod was changed (api()).
function animMods(cid) {
  const kept = animMods.kept = animMods.kept || {};
  return kept[cid] = kept[cid] || api(`/api/mods?id=${encodeURIComponent(cid)}&light=1`).catch(() => { delete kept[cid]; return { mods: [] }; });
}
async function animHead(v, sel, o) {
  const mods = o.cid != null ? (await animMods(o.cid)).mods : [];
  if (anim.sel !== sel) return false;
  if (anim.fxMod && !mods.some((m) => m.name === anim.fxMod)) anim.fxMod = "";
  anim.mods = mods;
  v.innerHTML = `<div class="an-hdr"><div class="an-pic">${o.pic || ""}</div><div class="an-ht"><h2>${esc(o.title)}</h2><small>${esc(o.sub)}</small></div><span class="grow"></span>
      ${o.cid != null ? `<label class="an-mod ${anim.fxMod ? "active" : ""}" title="Applies to every tab: Skills and Effects are shown and rendered with this mod; Edit mod changes it">
        <span class="muted small">Mod</span><select id="amod"><option value="">Original — no mod</option>${mods.map((m) => `<option ${m.name === anim.fxMod ? "selected" : ""}>${esc(m.name)}</option>`).join("")}<option value="+">+ New mod…</option></select></label>` : ""}</div>
    <div class="an-tabs">${o.tabs.map(([k, l]) => `<button data-t="${k}" class="${k === anim.tab ? "on" : ""}">${esc(l)}</button>`).join("")}</div><div id="abody" class="an-body"></div>`;
  v.querySelectorAll("[data-t]").forEach((b) => b.onclick = () => { anim.tab = b.dataset.t; openAnimEntry(sel); });
  if ($("#amod")) $("#amod").onchange = async (e) => {
    if (e.target.value === "+") {
      const name = (prompt("Name of the new mod (letters, digits, dashes):") || "").trim();
      if (!name) return openAnimEntry(sel);
      if (!/^[A-Za-z0-9-]{1,32}$/.test(name)) { toast("A name of letters, digits and dashes"); return openAnimEntry(sel); }
      await api("/api/mod", { id: o.cid, name, hue: 0, sat: 1, bright: 1 }).catch((er) => toast(esc(er.message)));
      anim.owned = (anim.owned || new Set()).add(String(o.cid));
      anim.fxMod = name;
      anim.tab = "mod";
      drawAnimTree();
    } else anim.fxMod = e.target.value;
    openAnimEntry(sel);
  };
  return true;
}
async function openAnimEntry(sel) {
  stopAnim();
  anim.sel = sel;
  const v = $("#aview");
  if (sel.spine) {
    v.innerHTML = `<div class="an-pad"><div class="row"><b class="grow">${esc(sel.spine.name || sel.spine.base)}${sel.spine.name ? ` <span class="muted small">${esc(sel.spine.base)}</span>` : ""}</b><span class="muted small">${esc(sel.spine.kind)} · ${esc(sel.spine.bundle)}</span></div><div class="spinehost"></div></div>`;
    return openSpine(sel.spine, v.querySelector(".spinehost"));
  }
  if (sel.enemy) {
    // an enemy / abnormality: its battle prefab's skills played with the game's effects
    const x = sel.enemy, c = { id: x.app, title: x.name || x.app.replace(/^\d+_|Appearance$/g, "") };
    anim.slots = {};
    const tabs = [["fx", "Skills"], ["mod", "Edit mod"]];
    if (!tabs.some(([k]) => k === anim.tab)) anim.tab = "fx";
    recentAdd(sel, c.title, `${x.kind} · ${x.app}`);
    if (!await animHead(v, sel, { title: c.title, sub: `${x.kind} · ${x.app}`, tabs, cid: x.app })) return;
    if (anim.tab === "mod") return openMod(c, $("#abody"), () => { anim.tab = "fx"; openAnimEntry(sel); });
    return openFx(c, $("#abody"));
  }
  const c = findChar(sel.cid);
  if (!c) { v.innerHTML = `<div class="empty">Not found.</div>`; return; }
  if (!sel.videos) sel.videos = await api(`/api/owner_videos?id=${c.id}`).catch(() => []);
  if (!sel.slots) sel.slots = await api(`/api/skill_slots?id=${c.id}`).catch(() => ({}));
  anim.slots = sel.slots;
  const tabs = [["fx", "Skills"], ["battle", "Battle clips"], ["effects", "Effects"], ["mod", "Edit mod"], ...(sel.videos.length ? [["videos", `Videos (${sel.videos.length})`]] : []),
    ...c.spine.map((x, i) => [`spine${i}`, `Spine · ${x.base}`])];
  if (!anim.tab || !tabs.some(([k]) => k === anim.tab)) anim.tab = "fx";
  recentAdd(sel, c.title, `${c.sinner} · ${c.isEgo ? "E.G.O" : "Identity"} ${c.id}`);
  if (!await animHead(v, sel, { title: c.title, sub: `${c.sinner} · ${c.isEgo ? "E.G.O" : "Identity"} ${c.id}`, pic: animThumb(c.id), tabs, cid: c.id })) return;
  const body = $("#abody");
  if (anim.tab.startsWith("spine")) return openSpine(c.spine[+anim.tab.slice(5)], body);
  if (anim.tab === "fx" || anim.tab === "effects") return openFx(c, body);
  if (anim.tab === "mod") return openMod(c, body, () => { anim.tab = "fx"; openAnimEntry(sel); });
  if (anim.tab === "videos") {
    body.innerHTML = sel.videos.map((v) => `<div class="card"><div class="row" style="margin-bottom:6px"><b class="grow">${esc(v.label)}</b>
        <span class="muted small">${v.kind === "game" ? "from the game files" : esc(v.file)}</span></div>
        ${/\.gif/i.test(v.src) ? `<img src="${v.src}" style="max-width:100%">` : `<video controls preload="metadata" src="${v.src}" style="width:100%;max-height:60vh;background:#000"></video>`}</div>`).join("")
      + `<div class="small muted">Your own recordings: put them into the videos folder (Settings → Open videos folder); a file is matched by the Identity's title and Sinner name in its name, e.g. The_House_of_Spiders_The_Index_Nursefather_Yi_Sang_Skill_1a.mp4.</div>`;
    return;
  }
  body.innerHTML = `<div class="muted">Reading the clips…</div>`;
  try { anim.clips = await api(`/api/owner_clips?id=${c.id}`); } catch (e) { body.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  if (!anim.clips.length) { body.innerHTML = `<div class="empty">No battle clips for this one${c.spine.length ? " — see its Spine tab" : ""}.</div>`; return; }
  // a clip is its object in a bundle: the same clip copied into two bundles has the same id in both
  const same = (x, y) => x.clip === y.clip && x.bundle === y.bundle;
  if (!anim.clip || !anim.clips.some((x) => same(x, anim.clip))) anim.clip = anim.clips[0];
  const chip = (x) => `<button class="toggle ${same(x, anim.clip) ? "on" : ""}" data-clip="${x.clip}" data-bundle="${esc(x.bundle)}" title="${esc(x.name)}">${esc(x.label)}</button>`;
  const own = anim.clips.filter((x) => x.own), extra = anim.clips.filter((x) => !x.own);
  body.innerHTML = `<div class="row" style="gap:6px;margin-bottom:6px">${own.map(chip).join("")}</div>
    ${extra.length ? `<div class="row" style="gap:6px;margin-bottom:6px"><span class="muted small">Other clips in these files:</span>${extra.map(chip).join("")}</div>` : ""}
    <div class="row" style="margin:8px 0">
      <button id="aplay" class="toggle">${anim.playing ? "⏸ pause" : "▶ play"}</button><button id="aprev" class="toggle">◀</button><button id="anext" class="toggle">▶</button>
      <span id="acount" class="muted small"></span>
      <label class="small">speed <select id="aspeed">${[0.25, 0.5, 1, 1.5, 2].map((s) => `<option ${s === anim.speed ? "selected" : ""}>${s}</option>`).join("")}</select></label>
      <label class="small" title="Layers a skill script switches on (afterimages, clones)"><input type="checkbox" id="aall" ${anim.all ? "checked" : ""}> all animated layers</label>
      <span class="grow"></span><button id="agif">Export GIF</button></div>
    <div class="animstage"><canvas id="acanvas"></canvas></div>`;
  body.querySelectorAll("[data-clip]").forEach((b) => b.onclick = () => { anim.clip = anim.clips.find((x) => same(x, { clip: b.dataset.clip, bundle: b.dataset.bundle })); openAnimEntry(sel); });
  $("#aplay").onclick = () => { anim.playing = !anim.playing; $("#aplay").textContent = anim.playing ? "⏸ pause" : "▶ play"; anim.playing ? startAnim() : stopAnim(); };
  $("#aprev").onclick = () => stepClip(-1);
  $("#anext").onclick = () => stepClip(1);
  $("#aspeed").onchange = (e) => { anim.speed = +e.target.value; };
  $("#aall").onchange = (e) => { anim.all = e.target.checked; openAnimEntry(sel); };
  $("#agif").onclick = () => exportObj({ clipgif: { bundle: anim.clip.bundle, clip: anim.clip.clip, go: anim.clip.animator_go, all: anim.all, name: `${c.id}_${anim.clip.label.replace(/[^\w ]+/g, "").trim()}` } });
  await loadClip(anim.clip);
}
// ---------- skills with the game's own effects: rendered by a small Unity player from the game's files
// slots: the character's {n: {slot, name}} (/api/skill_slots) — the n of "<Char>_S<n>" isn't the game's skill number:
// a second Skill 3 or the Defense can be S4 / S5
// the order the game lists the skills in: Skill 1, 2, 3.1, 3.2 … then Defense
const slotOrder = (n, slots = anim.slots) => {
  const x = slots && slots[n] ? /^Skill (\d+)(?:\.(\d+))?|^Defense/.exec(slots[n].slot) : null;
  return !x ? n : x[1] ? +x[1] + (+x[2] || 0) / 10 : 50 + n / 100;
};
function fxLabel(name, slots = anim.slots) {
  // an E.G.O's cut-in: SkillViewEGO_<id>11 its use, …21 corroded
  const view = /^SkillViewEGO_\d{5}(\d)(\d)$/.exec(name);
  if (view) return view[1] === "1" ? "E.G.O" : view[1] === "2" ? "E.G.O · Corrosion" : `E.G.O · ${view[1]}${view[2]}`;
  const sk = (n) => (slots && slots[n] ? slots[n].slot : `Skill ${n}`);
  const whole = /_S(\d+)$/.exec(name);
  if (whole) return sk(whole[1]) + (slots && slots[whole[1]] && slots[whole[1]].name ? ` · ${slots[whole[1]].name}` : "");
  const m = /_(?:S(\d+)_)?(Parrying_Lose|Parrying|Duel_?Win|Guard_?Win|Retreat|Special)?_?Time?line[ _]?(.*)$/i.exec(name);
  if (!m) return name.replace(/_/g, " ");
  const kind = { parrying_lose: "Clash lost", parrying: "Clash", duel_win: "Clash won", duelwin: "Clash won", guard_win: "Guard won",
    guardwin: "Guard won", retreat: "Retreat", special: "Special" }[(m[2] || "").toLowerCase()];
  const part = (m[3] || "").replace(/_+$/, "").replace(/_/g, ".");
  if (!kind) return `${sk(m[1])} · variant ${part}`;
  return `${m[1] ? `${sk(m[1])} · ` : ""}${kind}${part ? ` ${part}` : ""}`;
}
// render options (limbusdm/viewer.py FLAGS); each set is rendered and kept separately
const FX_OPTS = [["alpha", "Transparent", "transparent"], ["static", "Static camera", "static camera"], ["16bit", "16-bit", "16-bit"], ["tails", "Tails", "tails"],
  ["novoice", "No voice", "no voice"], ["nobg", "No background", "no background", "ego"], ["subs", "Subtitles", "subtitles", "ego"],
  ["nobloom", "No Bloom", "no bloom"], ["buffs", "Buffs", "with buffs", "own"]];
// options only an E.G.O's cut-in uses
// ("own": only for one whose buffs have effects of their own — Database → Buff effects)
const fxOwn = (id) => anim.fxBuffs?.[id]?.own || [];
const fxOptFor = (c) => FX_OPTS.filter((o) => !o[3] || (o[3] === "own" ? fxOwn(c.id).length : /^2\d{4}$/.test(String(c.id))));
// the Effects tab: each effect of the character on its own, always on a transparent background (to lay over footage);
// no target, cut-in, sound or camera moves to keep still
const fxEffects = () => anim.tab === "effects";
const FX_KINDS = [["skill", "Skill effects"], ["aura", "Auras"], ["battle", "Battle VFX"]];
const FX_NOT_EFFECTS = ["alpha", "static", "novoice", "nobg", "subs", "buffs"];
const fxOpts = () => FX_OPTS.filter(([k, , , only]) => !(fxEffects() && FX_NOT_EFFECTS.includes(k)) && !(only === "own" && !fxOwn(anim.sel?.cid).length));
function fxVariant() {
  return [!fxEffects() && anim.fxSolo && "solo", ...fxOpts().map(([k]) => anim.fxOpt?.[k] && k), fxEffects() && "alpha", fxEffects() && "effects",
    anim.fxLevel > 0 && `lv${anim.fxLevel}`, anim.fxMod && `m-${anim.fxMod}`].filter(Boolean).join("_");
}
// the original and the mod's video of one skill, side by side, played together
async function fxCompare(c, n, v, label) {
  const plain = v.split("_").filter((x) => !/^m-/.test(x)).join("_");
  const id = encodeURIComponent(c.id);
  const st = await api(`/api/fx?id=${id}${plain ? `&v=${plain}` : ""}`).catch(() => ({ videos: [] }));
  const mk = (vv, t) => `<div><div class="muted small">${t}</div><video controls loop muted preload="auto" src="/api/fx_video?id=${id}${vv ? `&v=${vv}` : ""}&name=${encodeURIComponent(n)}&t=${Date.now()}"></video></div>`;
  const m = document.createElement("div");
  m.className = "an-modal";
  m.innerHTML = `<div class="an-mbox"><div class="row" style="gap:8px;margin-bottom:8px"><b class="grow">${esc(label)}</b><button data-play>▶ Play both</button><button data-x>Close</button></div>
    ${st.videos.includes(n) ? `<div class="an-two">${mk(plain, "Original")}${mk(v, `With ${esc(anim.fxMod)}`)}</div>`
      : `<div class="empty">The original of this one isn't rendered yet. Pick “Original — no mod” in the Mod box, press Render, then come back.</div>`}</div>`;
  document.body.appendChild(m);
  const close = () => m.remove();
  m.querySelector("[data-x]").onclick = close;
  m.onclick = (e) => { if (e.target === m) close(); };
  m.querySelector("[data-play]").onclick = () => m.querySelectorAll("video").forEach((x) => { x.currentTime = 0; x.play(); });
}
async function openFx(c, body) {
  clearTimeout(anim.fxTimer);
  const tab = anim.tab, effects = fxEffects();
  const solo = !effects && !!anim.fxSolo, v = fxVariant(), q = `id=${encodeURIComponent(c.id)}${v ? `&v=${v}` : ""}`;
  const label = (n) => effects ? n.replace(/_/g, " ") : fxLabel(n);
  let st;
  try { st = await api(`/api/fx?${q}`); } catch (e) { body.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  if (!$("#abody") || anim.sel?.cid !== c.id || anim.tab !== tab || fxVariant() !== v) return;
  if (!st.available) {
    body.innerHTML = `<div class="empty">The effects renderer (LimbusViewer) isn't part of this build.</div>`;
    return;
  }
  // mods of this one (the Edit tab): renders with a mod are kept apart from the original's
  const modList = (await animMods(c.id)).mods.map((m) => m.name);
  if (anim.fxMod && !modList.includes(anim.fxMod)) { anim.fxMod = ""; return openFx(c, body); }
  if (!$("#abody") || anim.tab !== tab || fxVariant() !== v) return;
  // what its buffs change on it (limbusdm/viewer.py buff_levels): a level to render at, the buff behind an effect
  anim.fxBuffs = anim.fxBuffs || {};
  const buffs = anim.fxBuffs[c.id];
  if (!buffs) {
    api(`/api/fx_buffs?id=${encodeURIComponent(c.id)}`).catch(() => ({ levels: [], notes: {} })).then((b) => {
      anim.fxBuffs[c.id] = b;
      if ($("#abody") && anim.sel?.cid === c.id && anim.tab === tab) openFx(c, body);
    });
  }
  const levels = buffs?.levels || [];
  if (buffs && anim.fxLevel && anim.fxLevel >= levels.length) { anim.fxLevel = 0; return openFx(c, body); }
  const buffNote = (n) => buffs?.notes?.[n] || buffs?.notes?.[n.replace(/_\d+$/, "")] || "";
  const running = st.state === "running";
  const key = (n) => { if (n.startsWith("SkillViewEGO_")) return [-1, 0, n]; const m = /_S(\d+)(?:_Time?line[ _]?(.*))?$/.exec(n); return m ? [0, slotOrder(+m[1]), m[2] || ""] : [1, 0, n]; };
  const vids = [...st.videos].sort((a, b) => { const x = key(a), y = key(b); return x[0] - y[0] || x[1] - y[1] || String(x[2]).localeCompare(String(y[2]), undefined, { numeric: true }); });
  const note = running ? `${st.done.length} / ${st.total || "?"} done · ${esc(st.msg || "")}`
    : st.state === "error" ? `<span class="bad">${esc(st.msg)}</span>`
    : effects ? "Each effect of the character on its own, without the characters, on a transparent background (WebM with alpha), the picture fitted to what it draws (a looping one: 4 s)."
    : [solo ? "Without the target: same moves and framing, for putting into your own videos."
      : "The game's skill timelines played in Unity with its own effects, shaders and sounds. The target is a stand-in; Spine parts aren't drawn. An E.G.O's own animation (its cut-in) is the first video.",
      anim.fxOpt?.alpha ? "Transparent: Save gives a WebM (VP9 with alpha) to lay over your own footage." : "",
      anim.fxOpt?.buffs && fxOwn(c.id).length ? `Buffs: ${fxOwn(c.id).map((x) => `${esc(x.buff)} (on ${x.on === "self" ? "itself" : "the target"})`).join(", ")}.` : ""].filter(Boolean).join(" ");
  const tags = [solo && "no target", ...fxOpts().map(([k, , t]) => anim.fxOpt?.[k] && t), effects && "effects", anim.fxLevel > 0 && `buff level ${anim.fxLevel}`,
    anim.fxMod && `mod ${anim.fxMod}`].filter(Boolean).join(", ");
  const fileName = (n) => `${c.id} ${c.title} - ${label(n)}${tags ? ` (${tags})` : ""}`;
  const save = (items) => exportObj({ fxvideo: { id: c.id, v, items, folder: `${c.id} ${c.title}${tags ? ` (${tags})` : ""}` } });
  // The page is built once per character / options / mods. After that (while it renders, when it is done) the videos
  // are updated card by card: new ones are added in their place, a video being watched keeps playing.
  const base = `${c.id}:${v}:${modList.join(",")}:${levels.length}`;
  const src = (n, stamp) => `/api/fx_video?${q}&name=${encodeURIComponent(n)}&t=${stamp}`;
  let grid = body.querySelector(".fxgrid");
  if (body.dataset.fx !== base || !grid || !$("#fxnote")) {
    body.dataset.fx = base;
    body.dataset.fxState = "";
    body.innerHTML = `<div class="an-bar"><b>${effects ? "Effects, each on its own" : "Skills with the game's effects and sounds"}</b>
        ${anim.fxMod ? `<span class="an-tag m">${esc(anim.fxMod)} applied</span>` : ""}<span class="grow"></span><span id="fxsave"></span><button id="fxgo" class="primary"></button></div>
      <details class="an-opts"><summary>Render options <small class="muted">${esc(tags || "none set")}</small></summary><div class="row" style="margin-top:8px;gap:8px;flex-wrap:wrap">
        ${effects ? "" : `<span class="seg"><button class="toggle ${solo ? "" : "on"}" data-solo="0">With target</button><button class="toggle ${solo ? "on" : ""}" data-solo="1">Without target</button></span>`}
        ${fxOptFor(c).filter(([k]) => !(effects && FX_NOT_EFFECTS.includes(k))).map(([k, label]) => `<button class="toggle ${anim.fxOpt?.[k] ? "on" : ""}" data-opt="${k}">${label}</button>`).join("")}
      </div></details><div id="fxnote" class="muted small" style="margin-bottom:8px"></div>
      ${levels.length > 1 ? `<div class="row" style="margin:0 0 8px;gap:8px;flex-wrap:wrap"><span class="small">Buffs</span><span class="seg">${levels.map((l, i) =>
        `<button class="toggle ${(anim.fxLevel || 0) === i ? "on" : ""}" data-lv="${i}" title="${esc(l.join("\n"))}">${i ? `Level ${i}` : "Base"}</button>`).join("")}</span>
        <span class="muted small grow">${esc((levels[anim.fxLevel || 0] || []).join(" · "))}</span></div>` : ""}
      <div id="fxbar"></div><div id="fxkinds" class="row" style="gap:6px;margin:0 0 8px;flex-wrap:wrap"></div>
      <div class="fxgrid"></div><div id="fxempty"></div>`;
    $("#fxgo").onclick = async () => {
      // the Effects tab renders the sub-tab picked first (every effect under All)
      await api("/api/fx", { id: c.id, v, kind: effects ? anim.fxKind || "" : "" }).catch((e) => toast(esc(e.message)));
      openFx(c, body);
    };
    body.querySelectorAll("[data-lv]").forEach((b) => b.onclick = () => { anim.fxLevel = +b.dataset.lv; openFx(c, body); });
    body.querySelectorAll("[data-solo]").forEach((b) => b.onclick = () => { anim.fxSolo = b.dataset.solo === "1"; openFx(c, body); });
    body.querySelectorAll("[data-opt]").forEach((b) => b.onclick = () => {
      anim.fxOpt = { ...anim.fxOpt, [b.dataset.opt]: !anim.fxOpt?.[b.dataset.opt] };
      openFx(c, body);
    });
    grid = body.querySelector(".fxgrid");
  }
  // the Effects tab's sub-tabs, as the player sorted the effects: a skill's (its timeline switches it on), an aura (what a
  // buff keeps on the character), a battle effect (a buff's or field's out of another bundle). One is picked first and
  // Render draws just those; the player lists all of them on every run, so each shows rendered / found
  const kinds = effects ? st.kinds || {} : {};
  const kindOf = (n) => kinds[n] || "skill";
  const sorted = Object.keys(kinds).length > 0;
  const count = (k) => vids.filter((n) => kindOf(n) === k).length;
  const found = (k) => Object.values(kinds).filter((x) => x === k).length;
  if (!FX_KINDS.some(([k]) => k === anim.fxKind)) anim.fxKind = "";
  const list = anim.fxKind ? vids.filter((n) => kindOf(n) === anim.fxKind) : vids;
  const kindName = anim.fxKind ? FX_KINDS.find(([k]) => k === anim.fxKind)[1] : "All effects";
  $("#fxkinds").innerHTML = effects ? [["", "All", vids.length, Object.keys(kinds).length], ...FX_KINDS.map(([k, t]) => [k, t, count(k), found(k)])]
    .map(([k, t, n, of]) => `<button class="toggle ${(anim.fxKind || "") === k ? "on" : ""}" data-kind="${k}"
      title="${sorted ? `${n} rendered of ${of} found` : "Pick what to render, then Render"}">${t} (${sorted ? `${n}/${of}` : n})</button>`).join("") : "";
  $("#fxkinds").querySelectorAll("[data-kind]").forEach((b) => b.onclick = () => { anim.fxKind = b.dataset.kind; openFx(c, body); });
  // the video being drawn, with its own progress bar (the finished ones are the cards below)
  const cur = running && st.current && !vids.includes(st.current.name) ? st.current : null;
  $("#fxbar").innerHTML = cur ? `<div class="card" style="margin-bottom:8px"><div class="row" style="gap:8px"><b class="grow">${esc(label(cur.name))}</b>
      <span class="muted small">${Math.round(100 * cur.frac)}%</span></div><div class="progress"><div style="width:${Math.max(2, 100 * cur.frac)}%"></div></div></div>` : "";
  // a render that just finished wrote new files under the old names: those not being watched are reloaded
  const finished = body.dataset.fxState === "running" && !running;
  const stamp = Date.now();
  const shown = new Map([...grid.children].map((el) => [el.dataset.vid, el]));
  let prev = null;
  for (const n of list) {
    let el = shown.get(n);
    if (!el) {
      const box = document.createElement("div");
      box.innerHTML = `<div class="card" data-vid="${esc(n)}"><div class="row" style="margin-bottom:6px;gap:8px"><b class="grow">${esc(label(n))}${buffNote(n) ? ` <span class="muted small">· ${esc(buffNote(n))}</span>` : ""}</b><span class="muted small">${esc(n)}</span>${anim.fxMod && !effects ? `<button data-cmp title="the original and this mod side by side">Compare</button>` : ""}${effects ? `<button data-rep title="draw this effect with an animation of your own (Edit mod → Effects)">Replace…</button>` : ""}<button data-save>Save</button><button data-gif title="a looping GIF under 10 MB, to post in Discord">GIF</button></div>
        <video controls preload="metadata" src="${src(n, stamp)}" style="width:100%;background:#000"></video></div>`;
      el = box.firstElementChild;
      el.querySelector("[data-save]").onclick = () => save([[n, fileName(n)]]);
      if (el.querySelector("[data-cmp]")) el.querySelector("[data-cmp]").onclick = () => fxCompare(c, n, v, label(n));
      if (el.querySelector("[data-rep]")) el.querySelector("[data-rep]").onclick = () => {
        anim.tab = "mod"; anim.modSub = "effects"; anim.vfxSel = n;
        if (!anim.fxMod) { toast("Name a mod for it first"); $("#amod").value = "+"; $("#amod").dispatchEvent(new Event("change")); return; }
        openAnimEntry(anim.sel);
      };
      el.querySelector("[data-gif]").onclick = () => { toast("Making the GIF…"); exportObj({ fxvideo: { id: c.id, v, items: [[n, fileName(n)]], discord: true } }); };
    } else if (finished) {
      const video = el.querySelector("video");
      if (video.paused) video.src = src(n, stamp);
    }
    const at = prev ? prev.nextElementSibling : grid.firstElementChild;
    if (at !== el) grid.insertBefore(el, at);
    prev = el;
    shown.delete(n);
  }
  for (const el of shown.values()) el.remove();
  body.dataset.fxState = st.state;
  $("#fxnote").innerHTML = note;
  $("#fxgo").disabled = running;
  $("#fxgo").textContent = effects ? `Render ${kindName.toLowerCase()}${list.length ? " again" : ""}` : vids.length ? "Render again" : "Render skills with effects";
  $("#fxsave").innerHTML = vids.length ? `<button id="fxall">Save all</button>` : "";
  if ($("#fxall")) $("#fxall").onclick = () => save(list.map((n) => [n, fileName(n)]));
  $("#fxempty").innerHTML = list.length || running ? ""
    : effects && anim.fxKind && sorted && !found(anim.fxKind) ? `<div class="empty">The player found no ${esc(kindName.toLowerCase())} for this one.</div>`
    : `<div class="empty">${effects ? `${esc(kindName)}: not` : "Not"} rendered yet${tags ? ` (${esc(tags)})` : ""}. ${effects ? "Each effect is played twice (to measure it, then to record it)." : "Takes about half a minute for one Identity."}</div>`;
  if (running) anim.fxTimer = setTimeout(() => openFx(c, body), 1500);
}
// Edit: mods of the skill renders. A mod is a folder of its own (data/mods): its textures replace the game's in
// the renderer's memory and its colour turns the effects; the game's files and the original renders stay as they are.
// a picture of an effect that isn't ready yet (its video is still being written) is asked for again a few times
function stillRetry(img) {
  const n = +(img.dataset.n || 0);
  if (n >= 5) return;
  img.dataset.n = n + 1;
  setTimeout(() => { if (img.isConnected) img.src = img.src.replace(/&r=\d+$/, "") + `&r=${Date.now()}`; }, 2500);
}
const MOD_SUBS = [["colours", "Colours"], ["textures", "Textures"], ["frames", "Frames"], ["timing", "Timing"], ["effects", "Effects"]];
async function openMod(c, body, toRender) {
  const q = `id=${encodeURIComponent(c.id)}`;
  const sub = MOD_SUBS.some(([k]) => k === anim.modSub) ? anim.modSub : "colours";
  anim.modSub = sub;
  if (!anim.fxMod) {
    body.innerHTML = `<div class="an-empty">A mod is your own version of this one's skill videos: textures and frames of your own, another colour for the effects, changed timing, and animations of your own
      in place of its effects. Nothing in the game's files changes — a mod is a folder of its own, its videos are kept apart from the original ones.<br><br>
      Pick a mod in the <b>Mod</b> box (top right), or <button id="modmake" class="primary">+ create one</button></div>`;
    $("#modmake").onclick = () => { $("#amod").value = "+"; $("#amod").dispatchEvent(new Event("change")); };
    return;
  }
  let data;
  try { data = await api(`/api/mods?${q}${sub === "textures" ? "" : "&light=1"}`); } catch (e) { body.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  if (!$("#abody") || anim.tab !== "mod") return;
  const m = data.mods.find((x) => x.name === anim.fxMod);
  if (!m) { anim.fxMod = ""; return openAnimEntry(anim.sel); }
  const stamp = Date.now();
  const has = (t) => m.textures.includes(t);
  const refresh = () => openMod(c, body, toRender);
  body.innerHTML = `<div class="an-bar"><div class="an-subtabs">${MOD_SUBS.map(([k, l]) => `<button class="an-chip ${k === sub ? "on" : ""}" data-sub="${k}">${l}${k === "effects" && m.vfx.length ? ` (${m.vfx.length})` : ""}</button>`).join("")}</div>
      <span class="grow"></span><button id="moddel" class="danger">Delete mod</button><button id="modgo" class="primary" title="Skills tab, rendered with this mod">Render the skills with this mod</button></div><div id="msub"></div>`;
  body.querySelectorAll("[data-sub]").forEach((b) => b.onclick = () => { anim.modSub = b.dataset.sub; refresh(); });
  $("#moddel").onclick = async () => {
    if (!confirm(`Delete the mod "${m.name}" and its videos? The original ones stay.`)) return;
    await api("/api/mod", { id: c.id, name: m.name, delete: true });
    anim.fxMod = "";
    anim.tab = "fx";
    openAnimEntry(anim.sel);
  };
  $("#modgo").onclick = async () => {
    await api("/api/fx", { id: c.id, v: fxVariant() }).catch((e) => toast(esc(e.message)));
    toRender();
  };
  const host = $("#msub");
  if (sub === "colours") {
    host.innerHTML = `<div class="card"><b>Effects colour</b> <span class="muted small">particles, trails and glows; the character stays as drawn</span>
      <div class="row" style="gap:16px;flex-wrap:wrap;margin-top:6px">
        <label class="small">Hue <input type="range" id="mhue" min="-180" max="180" step="5" value="${m.hue}"> <span id="mhuev">${m.hue}°</span></label>
        <label class="small">Saturation <input type="range" id="msat" min="0" max="2" step="0.05" value="${m.sat}"> <span id="msatv">${m.sat}</span></label>
        <label class="small">Brightness <input type="range" id="mbri" min="0" max="3" step="0.05" value="${m.bright}"> <span id="mbriv">${m.bright}</span></label>
        <span class="mswatch" style="width:60px;height:18px;border-radius:4px"></span>
        <button id="modsave" class="primary">Save</button></div></div>`;
    const swatch = () => {
      const h = +$("#mhue").value, s = +$("#msat").value, b = +$("#mbri").value;
      $("#mhuev").textContent = `${h}°`; $("#msatv").textContent = s; $("#mbriv").textContent = b;
      // the effects' gold (≈ 45°) after the shift, as a hint
      host.querySelector(".mswatch").style.background = `hsl(${45 + h}, ${Math.min(100, 85 * s)}%, ${Math.min(90, 50 * b)}%)`;
    };
    ["#mhue", "#msat", "#mbri"].forEach((id) => $(id).oninput = swatch);
    swatch();
    $("#modsave").onclick = async () => {
      await api("/api/mod", { id: c.id, name: m.name, hue: +$("#mhue").value, sat: +$("#msat").value, bright: +$("#mbri").value })
        .then(() => toast("Saved — the mod's videos will be rendered again")).catch((e) => toast(esc(e.message)));
    };
  } else if (sub === "textures") {
    host.innerHTML = `<div class="card"><b>Textures</b> <span class="muted small">(whole sprite sheets — the Frames tab is easier)</span> <span class="muted small">download one, draw over it in any editor keeping the layout (each sprite is cut from a
      fixed place of the sheet); a different size is scaled to the original's. The battle sprites are the "sactx-…" sheets at the top.</span>
      <div class="modgrid">${data.textures.map((t, i) => `<div class="modtex ${has(t.name) ? "on" : ""}">
        <img loading="lazy" src="${has(t.name) ? `/api/mod_texture?${q}&name=${encodeURIComponent(m.name)}&tex=${encodeURIComponent(t.name)}&t=${stamp}` : `/api/object?bundle=${encodeURIComponent(t.bundle)}&pid=${t.pid}`}">
        <div class="small" title="${esc(t.name)}">${esc(t.name.replace(/^sactx-\d+-\d+x\d+-[^-]+-/, "").slice(0, 60))}</div>
        <div class="muted small">${t.w}×${t.h}${has(t.name) ? " · <b>replaced</b>" : ""}</div>
        <div class="row" style="gap:4px"><button class="small" data-orig="${i}" title="Save the game's texture as PNG (into the exports folder)">Original</button>
          <button class="small" data-up="${i}">Replace…</button>${has(t.name) ? `<button class="small" data-reset="${i}">Reset</button>` : ""}</div></div>`).join("")}</div>
      <input type="file" id="modfile" accept="image/png,image/*" style="display:none"></div>`;
    body.querySelectorAll("[data-orig]").forEach((b) => b.onclick = () => { const t = data.textures[+b.dataset.orig]; exportObj({ bundle: t.bundle, pid: t.pid }); });
    let upFor = null;
    body.querySelectorAll("[data-up]").forEach((b) => b.onclick = () => { upFor = data.textures[+b.dataset.up]; $("#modfile").value = ""; $("#modfile").click(); });
    $("#modfile").onchange = () => {
      const f = $("#modfile").files[0];
      if (!f || !upFor) return;
      const rd = new FileReader();
      rd.onload = async () => {
        await api("/api/mod_texture", { id: c.id, name: m.name, tex: upFor.name, png: rd.result, w: upFor.w, h: upFor.h })
          .then(() => toast("Replaced")).catch((e) => toast(esc(e.message)));
        refresh();
      };
      rd.readAsDataURL(f);
    };
    body.querySelectorAll("[data-reset]").forEach((b) => b.onclick = async () => {
      await api("/api/mod_texture", { id: c.id, name: m.name, tex: data.textures[+b.dataset.reset].name });
      refresh();
    });
  } else if (sub === "effects") {
    modEffects(c, m, host, refresh);
  } else if (sub === "timing") {
    modTiming(c, m, host, refresh);
  } else {
    host.innerHTML = `<div class="card" id="modframes"><div class="muted small">Reading the frames…</div></div>`;
    modFrames(c, m, $("#modframes"), refresh, sub);
  }
}
// Effects of the skills drawn as an animation of your own (GIF / APNG / WebP / PNG frames / a zip of PNGs), or as an effect of
// another character. The list is the character's own effects, rendered alone (transparent: the Effects tab) — started by
// itself when none is there yet; the player draws the frames where the game's effect is, from the moment it comes on, and the
// game's effect is not drawn.
async function modEffects(c, m, host, refresh, cached) {
  clearTimeout(anim.fxTimer);
  const id = encodeURIComponent(c.id), V = "alpha_effects";
  let st, groups, stamp;
  if (cached && anim.vfxCache && anim.vfxCache.id === c.id) ({ st, groups, stamp } = anim.vfxCache);
  else {
    try { st = await api(`/api/fx?id=${id}&v=${V}`); } catch (e) { host.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    if (!st.available) { host.innerHTML = `<div class="empty">The effects renderer (LimbusViewer) isn't part of this build.</div>`; return; }
    groups = (await api(`/api/skills?id=${id}`).catch(() => ({ skills: [] }))).skills;
    stamp = Date.now();
    anim.vfxCache = { id: c.id, st, groups, stamp };
  }
  if (!host.isConnected) return;
  const running = st.state === "running";
  const names = [...st.videos].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  // a render that finishes or adds an effect redraws the page; otherwise it is left alone
  const watch = () => {
    anim.fxTimer = setTimeout(async () => {
      const s = await api(`/api/fx?id=${id}&v=${V}`).catch(() => null);
      if (!host.isConnected) return;
      if (s && (s.videos.length !== names.length || s.state !== "running")) { anim.vfxCache = null; refresh(); } else watch();
    }, 2500);
  };
  if (!names.length) {
    host.innerHTML = `<div class="an-empty">${running ? `Rendering this one's effects… ${st.done.length} / ${st.total || "?"} <div class="muted small" style="margin-top:8px">They are drawn once and kept for an hour after you last look at them.</div>`
      : st.state === "error" ? `<span class="bad">${esc(st.msg)}</span><br><br><button id="vgo" class="primary">Try again</button>`
      : `This one's effects aren't rendered yet. They are the list you pick from here, and the originals to compare your animation with.<br><br><button id="vgo" class="primary">Render the effects</button> <span class="small">about half a minute</span>`}</div>`;
    if ($("#vgo")) $("#vgo").onclick = async () => { await api("/api/fx", { id: c.id, v: V, kind: "" }).catch((e) => toast(esc(e.message))); anim.vfxCache = null; refresh(); };
    if (running) watch();
    return;
  }
  const vfx = (n) => m.vfx.find((x) => x.effect === n);
  if (!anim.vfxSel || !names.includes(anim.vfxSel)) anim.vfxSel = names[0];
  const sel = anim.vfxSel, cur = vfx(sel);
  const mid = encodeURIComponent(m.name), eff = encodeURIComponent(sel);
  const orig = (n) => `/api/fx_video?id=${id}&v=${V}&name=${encodeURIComponent(n)}&t=${stamp}`;
  const still = (n) => `/api/fx_still?id=${id}&v=${V}&name=${encodeURIComponent(n)}&t=${stamp}`;
  const frameUrl = (i) => `/api/mod_vfx_frame?id=${id}&name=${mid}&effect=${eff}&i=${i}&t=${m.vfxStamp || stamp}`;
  const lab = (n) => n.replace(/_/g, " ");
  host.innerHTML = `<div class="an-edit">
    <section class="an-fxlist"><h3>Effects of this character</h3><div class="muted small" style="margin-bottom:8px">${running ? "Still rendering… " : ""}Pick one to replace.</div>
      ${names.map((n) => `<div class="an-fx ${n === sel ? "sel" : ""}" data-n="${esc(n)}"><div class="an-th"><img src="${still(n)}" loading="lazy" alt="" onerror="stillRetry(this)"></div>
        <div class="an-t">${esc(lab(n))}<small>${(st.kinds || {})[n] || "skill"}</small></div>${vfx(n) ? `<span class="an-badge">own</span>` : `<span class="an-badge none">game</span>`}</div>`).join("")}</section>
    <section class="an-fxmid">
      <div class="an-views"><div class="an-pv"><label>Original effect</label><video id="vorig" loop muted autoplay playsinline src="${orig(sel)}"></video></div>
        <div class="an-pv"><label>Your animation${cur ? ` · ${cur.n} frames` : ""}</label>${cur ? `<img id="vown" src="${frameUrl(0)}">` : `<div class="an-hint">Drop a file on the right, or take an effect of another character.</div>`}</div></div>
      <div class="an-tl"><div class="row" style="gap:6px"><button id="vpp">⏸</button>${[0.25, 0.5, 1].map((s) => `<button class="vsp ${s === 1 ? "on" : ""}" data-s="${s}">${s}×</button>`).join("")}
        <span class="grow"></span><small class="muted" id="vinfo"></small></div>
        ${cur ? `<div class="an-frames">${Array.from({ length: cur.n }, (_, i) => `<img loading="lazy" data-i="${i}" src="${frameUrl(i)}">`).join("")}</div>` : ""}</div>
      <div class="row" style="gap:8px;flex-wrap:wrap"><button id="vrender" class="primary">Render the skills with this mod</button>
        <span class="muted small grow">The previews show the animation itself. Where it lands in the fight — size, place, timing — shows in the real render; Compare there puts it next to the original.</span></div>
    </section>
    <section class="an-fxctl"><h3>Your animation</h3>
      ${cur ? `<div class="row" style="gap:6px;margin-bottom:10px"><button id="vsave" class="primary" style="flex:1">Save</button><button id="vback" style="flex:1" title="the game's own effect again">Back to the game's</button></div>` : ""}
      <div class="an-drop" id="vdrop">Drop a GIF / APNG / WebP, a PNG or a zip of PNG frames here<br><small>or <u>choose a file</u></small></div>
      <input type="file" id="vfile" accept=".gif,.png,.apng,.webp,.zip,image/*" style="display:none">
      <button id="vother" style="width:100%">…or take an effect of another character</button>
      ${cur ? `<div class="an-ctls">
        <div class="ctl"><div class="l"><span>Size</span><span id="vsizev"></span></div><input type="range" id="vsize" min="0" max="12" step="0.1" value="${cur.scale || 0}"></div>
        <div class="ctl"><label class="small"><input type="checkbox" id="vauto" ${cur.offset ? "" : "checked"}> Place it where the game's effect is</label></div>
        <div class="ctl"><div class="l"><span>Move right</span><span id="vxv"></span></div><input type="range" id="vx" min="-6" max="6" step="0.05" value="${cur.offset ? cur.offset[0] : 0}"></div>
        <div class="ctl"><div class="l"><span>Move up</span><span id="vyv"></span></div><input type="range" id="vy" min="-6" max="6" step="0.05" value="${cur.offset ? cur.offset[1] : 0}"></div>
        <div class="ctl"><div class="l"><span>Speed</span><span id="vfpsv"></span></div><input type="range" id="vfps" min="1" max="60" step="1" value="${Math.round(cur.fps || 24)}"></div>
        <div class="ctl"><div class="l">Blend</div><div class="seg"><button data-b="normal" class="${cur.blend === "additive" ? "" : "on"}">Normal</button><button data-b="additive" class="${cur.blend === "additive" ? "on" : ""}">Additive (glow)</button></div></div>
        <div class="ctl"><div class="l"><span>Brightness</span><span id="vbriv"></span></div><input type="range" id="vbri" min="0" max="4" step="0.05" value="${cur.intensity || 1}"></div>
        <div class="ctl"><label class="small"><input type="checkbox" id="vloop" ${cur.loop ? "checked" : ""}> Loop while the effect is on</label></div>
        <div class="ctl"><div class="l">Only in skill</div><select id="vgrp" style="width:100%"><option value="">All skills that use it</option>${groups.map((g) => `<option value="${esc(g)}" ${g === cur.group ? "selected" : ""}>${esc(fxLabel(g))}</option>`).join("")}</select></div>
      </div>` : ""}</section></div>`;
  // list (switching redraws from what is already known: no waiting, no reload)
  host.querySelectorAll("[data-n]").forEach((d) => d.onclick = () => { anim.vfxSel = d.dataset.n; modEffects(c, m, host, refresh, true); });
  const vorig = $("#vorig"), vown = $("#vown");
  let rate = 1, playing = true, frame = 0, timer = 0;
  const fps = () => (cur ? +($("#vfps") ? $("#vfps").value : cur.fps) || 24 : 24);
  const tick = () => {
    clearInterval(timer);
    if (!cur || !vown || !playing) return;
    timer = setInterval(() => { if (!vown.isConnected) return clearInterval(timer); frame = (frame + 1) % cur.n; vown.src = frameUrl(frame); }, 1000 / (fps() * rate));
  };
  const info = () => { $("#vinfo").textContent = `game ${vorig.duration ? vorig.duration.toFixed(2) + " s" : "…"}${cur ? ` · yours ${cur.n} frames at ${fps()} fps = ${(cur.n / fps()).toFixed(2)} s` : ""}`; };
  vorig.onloadedmetadata = info;
  $("#vpp").onclick = () => { playing = !playing; $("#vpp").textContent = playing ? "⏸" : "▶"; playing ? vorig.play() : vorig.pause(); tick(); };
  host.querySelectorAll(".vsp").forEach((b) => b.onclick = () => {
    rate = +b.dataset.s; vorig.playbackRate = rate;
    host.querySelectorAll(".vsp").forEach((x) => x.classList.toggle("on", x === b));
    tick();
  });
  host.querySelectorAll(".an-frames img").forEach((im) => im.onclick = () => { playing = false; $("#vpp").textContent = "▶"; vorig.pause(); tick(); frame = +im.dataset.i; vown.src = frameUrl(frame); });
  tick();
  info();
  $("#vrender").onclick = async () => {
    await api("/api/fx", { id: c.id, v: fxVariant() }).catch((e) => toast(esc(e.message)));
    anim.tab = "fx";
    openAnimEntry(anim.sel);
  };
  // a file in, or another character's effect
  const send = (extra) => api("/api/mod_vfx", { id: c.id, name: m.name, effect: sel, ...extra }).then(() => toast("Saved — the mod's videos will be rendered again"))
    .catch((e) => toast(esc(e.message))).then(() => { anim.vfxCache = null; refresh(); });
  const params = () => ({ group: $("#vgrp").value, fps: +$("#vfps").value, scale: +$("#vsize").value, blend: host.querySelector("[data-b].on").dataset.b,
    loop: $("#vloop").checked, intensity: +$("#vbri").value, offset: $("#vauto").checked ? null : [+$("#vx").value, +$("#vy").value] });
  const upload = (f) => {
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => send({ file: rd.result, filename: f.name, params: cur ? params() : {} });
    rd.readAsDataURL(f);
  };
  const drop = $("#vdrop");
  drop.onclick = () => { $("#vfile").value = ""; $("#vfile").click(); };
  $("#vfile").onchange = () => upload($("#vfile").files[0]);
  ["dragenter", "dragover"].forEach((n) => drop.addEventListener(n, (e) => { e.preventDefault(); drop.classList.add("hot"); }));
  ["dragleave", "drop"].forEach((n) => drop.addEventListener(n, (e) => { e.preventDefault(); drop.classList.remove("hot"); }));
  drop.addEventListener("drop", (e) => upload(e.dataTransfer.files[0]));
  $("#vother").onclick = () => fxPicker((from) => send({ from, params: cur ? params() : {} }));
  if (!cur) { if (running) watch(); return; }
  // settings
  const lbl = () => {
    $("#vsizev").textContent = +$("#vsize").value ? `${(+$("#vsize").value).toFixed(1)} units tall` : "auto — as big as the game's";
    $("#vxv").textContent = (+$("#vx").value).toFixed(2); $("#vyv").textContent = (+$("#vy").value).toFixed(2);
    $("#vfpsv").textContent = `${$("#vfps").value} fps`; $("#vbriv").textContent = (+$("#vbri").value).toFixed(2);
    $("#vx").disabled = $("#vy").disabled = $("#vauto").checked;
  };
  ["#vsize", "#vx", "#vy", "#vfps", "#vbri", "#vauto"].forEach((k) => $(k).oninput = () => { lbl(); if (k === "#vfps") { tick(); info(); } });
  host.querySelectorAll("[data-b]").forEach((b) => b.onclick = () => {
    host.querySelectorAll("[data-b]").forEach((x) => x.classList.toggle("on", x === b));
    vown.style.mixBlendMode = b.dataset.b === "additive" ? "screen" : "normal";
  });
  vown.style.mixBlendMode = cur.blend === "additive" ? "screen" : "normal";
  lbl();
  $("#vsave").onclick = () => send({ params: params() });
  $("#vback").onclick = () => send({ remove: true });
  if (running) watch();
}
// The window for taking an effect of another character: a searchable list of characters on the left, the effects it has
// rendered as pictures on the right (it can be rendered from here). done({cid, effect}) with the picked one.
function fxPicker(done) {
  const V = "alpha_effects";
  const chars = [];
  for (const s of anim.data.sinners) for (const x of [...s.ids, ...s.egos]) chars.push({ key: String(x.id), label: `${s.name} · ${x.title}`, pic: animThumb(x.id) });
  for (const g of anim.data.groups) for (const arr of Object.values(g.kinds)) for (const x of arr) if (x.app) chars.push({ key: x.app, label: `${g.label} · ${x.name || x.app}`, pic: `<span class="an-ph"></span>` });
  const box = document.createElement("div");
  box.className = "an-modal";
  box.innerHTML = `<div class="an-mbox an-pick"><div class="row" style="gap:8px;margin-bottom:10px"><b class="grow" style="font-size:17px">Take an effect of another character</b><button data-x>Close</button></div>
    <div class="an-pickbody"><div class="an-pickl"><input type="search" id="pkq" placeholder="Search: Ryoshu, Sunshower, Canto 9, pirate…"><div class="an-pickchars" id="pkchars"></div></div>
      <div class="an-pickr"><div class="muted" id="pkhead">Pick a character on the left — its effects show here as pictures.</div><div class="an-pickgrid" id="pkgrid"></div></div></div>
    <div class="row" style="margin-top:12px;gap:10px"><span class="grow muted" id="pkinfo"></span><button class="primary" id="pkuse" disabled>Use this effect</button></div></div>`;
  document.body.appendChild(box);
  const q = (s) => box.querySelector(s);
  let who = anim.vfxWho || "", pick = "", timer = 0;
  const close = () => { clearTimeout(timer); box.remove(); };
  q("[data-x]").onclick = close;
  box.onclick = (e) => { if (e.target === box) close(); };
  const drawChars = () => {
    const f = q("#pkq").value.trim().toLowerCase();
    q("#pkchars").innerHTML = chars.filter((x) => !f || x.label.toLowerCase().includes(f) || x.key.includes(f)).slice(0, 400)
      .map((x) => `<div class="an-it ${x.key === who ? "sel" : ""}" data-k="${esc(x.key)}">${x.pic}<div class="an-t">${esc(x.label)}<small>${esc(x.key)}</small></div></div>`).join("") || `<div class="muted" style="padding:10px">Nothing found.</div>`;
    q("#pkchars").querySelectorAll("[data-k]").forEach((d) => d.onclick = () => { who = anim.vfxWho = d.dataset.k; pick = ""; drawChars(); load(); });
    const on = q("#pkchars .sel");
    if (on && !on.dataset.seen) { on.dataset.seen = 1; on.scrollIntoView({ block: "center" }); }
  };
  const load = async () => {
    clearTimeout(timer);
    if (!who) return;
    const asked = who, id = encodeURIComponent(who), label = (chars.find((x) => x.key === who) || {}).label || who;
    const st = await api(`/api/fx?id=${id}&v=${V}`).catch(() => null);
    if (!box.isConnected || who !== asked) return;
    const names = st ? [...st.videos].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) : [];
    q("#pkhead").innerHTML = `<b>${esc(label)}</b>`;
    q("#pkgrid").innerHTML = names.map((n) => `<div class="an-pk ${n === pick ? "sel" : ""}" data-n="${esc(n)}" title="${esc(n)}"><div class="an-pkimg"><img loading="lazy" src="/api/fx_still?id=${id}&v=${V}&name=${encodeURIComponent(n)}" onerror="stillRetry(this)"></div><div class="small">${esc(n.replace(/^FX_|^Fx_/, "").replace(/_/g, " "))}</div></div>`).join("")
      || (st && st.state === "running" ? `<div class="muted">Rendering its effects… ${st.done.length} / ${st.total || "?"}</div>`
        : `<div class="muted">Its effects aren't rendered yet.<br><br><button id="pkgo" class="primary">Render its effects</button> <span class="small">about half a minute</span></div>`);
    q("#pkgrid").querySelectorAll("[data-n]").forEach((d) => {
      d.onclick = () => { pick = d.dataset.n; q("#pkgrid").querySelectorAll("[data-n]").forEach((x) => x.classList.toggle("sel", x === d)); sync(); };
      d.ondblclick = () => { pick = d.dataset.n; use(); };
    });
    if (q("#pkgo")) q("#pkgo").onclick = async () => { await api("/api/fx", { id: who, v: V, kind: "" }).catch((e) => toast(esc(e.message))); load(); };
    if (!names.length && st && st.state === "running") timer = setTimeout(load, 2000);
    else if (names.length && st && st.state === "running") timer = setTimeout(load, 3000);
    sync();
  };
  const sync = () => { q("#pkuse").disabled = !pick; q("#pkinfo").textContent = pick ? `${pick.replace(/_/g, " ")} — click “Use this effect”, or double-click a picture.` : ""; };
  const use = () => { if (!pick || !who) return; const r = { cid: who, effect: pick }; close(); done(r); };
  q("#pkuse").onclick = use;
  q("#pkq").oninput = drawChars;
  drawChars();
  if (who) load();
}
// Timing: when the original skill's video has what (effects coming on, hits, voice lines, sounds, shakes), and where the
// mod freezes it or plays a stretch slower / faster — drawn on one timeline you can click and drag.
async function modTiming(c, m, host, refresh) {
  const id = encodeURIComponent(c.id);
  host.innerHTML = `<div class="muted" style="padding:10px">Reading the skills…</div>`;
  let sk;
  try { sk = await api(`/api/skills?id=${id}`); } catch (e) { host.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  if (!host.isConnected) return;
  if (!sk.skills.length) { host.innerHTML = `<div class="empty">No skills found for this one.</div>`; return; }
  if (!anim.timeGroup || !sk.skills.includes(anim.timeGroup)) anim.timeGroup = sk.skills[0];
  const g = anim.timeGroup, slots = sk.slots || anim.slots;
  const [tl, st] = await Promise.all([api(`/api/skill_timeline?id=${id}&group=${encodeURIComponent(g)}`).catch((e) => ({ error: e.message })),
    api(`/api/fx?id=${id}`).catch(() => ({ videos: [] }))]);
  if (!host.isConnected) return;
  if (tl.error) { host.innerHTML = `<div class="empty">${esc(tl.error)}</div>`; return; }
  // all the mod's timing in one list that the edits change; Save sends it
  if (!anim.timeDraft || anim.timeDraft.key !== `${c.id}/${m.name}`) anim.timeDraft = { key: `${c.id}/${m.name}`, list: (m.timing || []).map((t) => ({ ...t })), dirty: false };
  const draft = anim.timeDraft;
  const rows = () => draft.list.filter((t) => t.group === g);
  let selRow = null;
  const video = st.videos.includes(g) ? `/api/fx_video?id=${id}&name=${encodeURIComponent(g)}&t=${Date.now()}` : "";
  const span = () => Math.max(1, tl.length + 0.3, ...rows().map((t) => t.at + t.dur + 0.1));
  const LANES = [["parts", "Parts"], ["effect", "Effects"], ["hit", "Hits"], ["voice", "Voice"], ["sound", "Sounds"], ["shake", "Camera shake"], ["move", "Moves"]];
  const evOf = (k) => k === "parts" ? tl.parts.map((p) => ({ t: p.start, dur: p.len, label: p.name })) : tl.events.filter((e) => e.kind === k);
  const fmt = (x) => `${x.toFixed(2)} s`;
  host.innerHTML = `<div class="an-bar"><label>Skill <select id="tsk">${sk.skills.map((s) => `<option value="${esc(s)}" ${s === g ? "selected" : ""}>${esc(fxLabel(s, slots))}</option>`).join("")}</select></label>
      <span class="grow"></span><span id="tnote" class="muted"></span><button id="tsave" class="primary">Save timing</button></div>
    <div class="an-tmtop">${video ? `<video id="tvid" controls muted preload="auto" src="${video}"></video>` : `<div class="an-hint">The original video of this skill isn't rendered, so there's no picture here (and the parts below are laid out from their lengths, not the player's).<br>Skills tab → pick “Original” in the Mod box → Render.</div>`}
      <div class="an-tmhelp"><b>Freeze</b> holds the picture for the time you set (the video gets that much longer). <b>Speed</b> plays that much of the original at ×speed (below 1 slower, above 1 faster); the sounds follow.<br>
        <b>Click an empty place of the last row</b> to add a freeze; <b>drag</b> a bar to move it, drag its right end to change how long. The rows above show where things are in the original: ${tl.rendered ? "as the player showed them." : "roughly (not rendered)."}</div></div>
    <div class="an-tm"><div class="an-tml">${[...LANES.filter(([k]) => evOf(k).length), ["mine", "Your changes"]].map(([k, l]) => `<div class="an-lrow ${k === "mine" ? "mine" : ""}">${l}</div>`).join("")}<div class="an-lrow axis"></div></div>
      <div class="an-tracks" id="ttracks">${[...LANES.filter(([k]) => evOf(k).length), ["mine", ""]].map(([k]) => `<div class="an-lane ${k === "mine" ? "mine" : ""}" data-lane="${k}"></div>`).join("")}<div class="an-axis" id="taxis"></div><div class="an-playhead" id="tph"></div></div></div>
    <div id="tform" class="an-tform"></div>`;
  const L = () => span();
  const pct = (t) => `${(100 * t / L()).toFixed(3)}%`;
  const drawFixed = () => {
    host.querySelectorAll(".an-lane:not(.mine)").forEach((lane) => {
      const k = lane.dataset.lane;
      lane.innerHTML = evOf(k).map((e, i) => `<div class="an-ev ${k} ${k === "parts" && i % 2 ? "alt" : ""}" style="left:${pct(e.t)};width:max(${pct(Math.max(e.dur || 0, 0))},${k === "parts" ? "6px" : "5px"})" title="${esc(`${e.label || k} · ${fmt(e.t)}${e.dur ? ` for ${fmt(e.dur)}` : ""}`)}">${k === "parts" || k === "voice" || k === "effect" ? `<span>${esc((e.label || "").replace(/^FX_|^Fx_|^event:\/Voice\//i, "").slice(0, 28))}</span>` : ""}</div>`).join("");
    });
    // seconds
    const ax = $("#taxis"), step = L() > 12 ? 2 : L() > 5 ? 1 : 0.5;
    let h = "";
    for (let t = 0; t <= L(); t += step) h += `<span style="left:${pct(t)}">${t % 1 ? t.toFixed(1) : t}s</span>`;
    ax.innerHTML = h;
  };
  const newLength = () => tl.length + rows().reduce((a, t) => a + (t.speed === 0 ? t.dur : t.dur / (t.speed || 1) - t.dur), 0);
  const drawMine = () => {
    const lane = host.querySelector(".an-lane.mine");
    lane.innerHTML = rows().map((t, i) => `<div class="an-tmi ${t.speed === 0 ? "freeze" : "speed"} ${t === selRow ? "sel" : ""}" data-i="${draft.list.indexOf(t)}" style="left:${pct(t.at)};width:max(${pct(t.dur)},14px)"
      title="${t.speed === 0 ? "Freeze" : `Speed ×${t.speed}`}">${t.speed === 0 ? "❄" : `×${t.speed}`}<i class="h"></i></div>`).join("");
    const n = rows().length;
    $("#tnote").textContent = `${n ? `${n} change${n > 1 ? "s" : ""} · the video becomes ${fmt(newLength())} (was ${fmt(tl.length)})` : "No changes to this skill's timing"}${draft.dirty ? " · not saved" : ""}`;
    // the form of the picked one
    const f = $("#tform");
    if (!selRow) { f.innerHTML = `<span class="muted">Nothing picked. Click a bar, or an empty place of “Your changes”.</span>`; return; }
    f.innerHTML = `<select id="fk"><option value="0" ${selRow.speed === 0 ? "selected" : ""}>Freeze</option><option value="1" ${selRow.speed > 0 ? "selected" : ""}>Speed</option></select>
      at <input id="fa" type="number" step="0.05" min="0" value="${selRow.at.toFixed(2)}"> s, for <input id="fd" type="number" step="0.05" min="0.05" value="${selRow.dur.toFixed(2)}"> s
      <span id="fsw" style="${selRow.speed === 0 ? "display:none" : ""}">× <input id="fs" type="number" step="0.05" min="0.05" max="4" value="${selRow.speed || 0.5}"></span><button id="fdel" class="danger">Delete</button>`;
    $("#fk").onchange = () => { selRow.speed = $("#fk").value === "0" ? 0 : (+$("#fs").value || 0.5); dirty(); };
    $("#fa").onchange = () => { selRow.at = Math.max(0, +$("#fa").value || 0); dirty(); };
    $("#fd").onchange = () => { selRow.dur = Math.max(0.05, +$("#fd").value || 0.05); dirty(); };
    $("#fs").onchange = () => { selRow.speed = Math.max(0.05, Math.min(4, +$("#fs").value || 1)); dirty(); };
    $("#fdel").onclick = () => { draft.list.splice(draft.list.indexOf(selRow), 1); selRow = null; dirty(); };
  };
  const dirty = () => { draft.dirty = true; drawFixed(); drawMine(); };
  drawFixed();
  drawMine();
  // add / move / resize on the last row
  const lane = host.querySelector(".an-lane.mine");
  const secs = (dx) => dx / lane.clientWidth * L();
  lane.onpointerdown = (e) => {
    const item = e.target.closest(".an-tmi");
    if (!item) {
      const r = lane.getBoundingClientRect();
      selRow = { group: g, at: Math.max(0, (e.clientX - r.left) / r.width * L() - 0.1), dur: 0.2, speed: 0 };
      draft.list.push(selRow);
      return dirty();
    }
    selRow = draft.list[+item.dataset.i];
    const resize = e.target.classList.contains("h") || e.offsetX > item.clientWidth - 8;
    const x0 = e.clientX, at0 = selRow.at, dur0 = selRow.dur, row = selRow;
    drawMine();
    const move = (ev) => {
      if (resize) row.dur = Math.max(0.05, +(dur0 + secs(ev.clientX - x0)).toFixed(2));
      else row.at = Math.max(0, +(at0 + secs(ev.clientX - x0)).toFixed(2));
      draft.dirty = true; drawMine();
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); drawFixed(); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  // the picture's place on the timeline; a click on the seconds jumps to it
  const vid = $("#tvid");
  if (vid) {
    const ph = $("#tph");
    const iv = setInterval(() => { if (!vid.isConnected) return clearInterval(iv); ph.style.left = pct(vid.currentTime); ph.style.display = ""; }, 50);
    $("#taxis").onclick = (e) => { const r = $("#taxis").getBoundingClientRect(); vid.currentTime = (e.clientX - r.left) / r.width * L(); };
  } else $("#tph").style.display = "none";
  $("#tsk").onchange = (e) => { anim.timeGroup = e.target.value; modTiming(c, m, host, refresh); };
  $("#tsave").onclick = async () => {
    await api("/api/mod", { id: c.id, name: m.name, hue: m.hue, sat: m.sat, bright: m.bright, timing: draft.list.map((t) => ({ group: t.group, at: t.at, dur: t.dur, speed: t.speed })) })
      .then(() => { draft.dirty = false; drawMine(); toast("Timing saved — the mod's videos will be rendered again"); }).catch((e) => toast(esc(e.message)));
  };
}
const fxGroupLabel = (n) => fxLabel(n);
// Frames of one skill: each one replaced by a PNG of any size (placed by the feet), by another character's frame, or
// left as it is; and the skill's timing (freeze frames, slow / fast stretches).
async function modFrames(c, m, box, refresh, part = "frames") {
  const q = `id=${encodeURIComponent(c.id)}`;
  let fr;
  try { fr = await api(`/api/frames?${q}`); } catch (e) { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  if (!box.isConnected) return;
  if (!fr.groups.length) { box.innerHTML = `<b>Frames</b> <span class="muted small">no sprite frames found for this one</span>`; return; }
  if (!anim.frameGroup || !fr.groups.some((g) => g.name === anim.frameGroup)) anim.frameGroup = fr.groups[0].name;
  const g = fr.groups.find((x) => x.name === anim.frameGroup);
  const scoped = !!anim.frameScoped, scope = scoped ? g.name : "";
  const rep = (f) => m.frames.find((x) => x.sprite === f.name && x.scope === scope) || (!scoped && null);
  const elsewhere = (f) => m.frames.find((x) => x.sprite === f.name && x.scope !== scope);
  const stamp = Date.now();
  const timing = (m.timing || []).filter((t) => t.group === g.name);
  box.innerHTML = `<b class="mf">Frames</b> <span class="muted small mf">every picture the skill shows, one by one. Download them, draw over any (the canvas has room around
      the character: longer weapons, capes…), load them back — only the frames you load are replaced. Or take a frame from another character.</span>
    <div class="row" style="gap:8px;flex-wrap:wrap;margin:8px 0">
      <label class="small">Skill <select id="fgroup">${fr.groups.map((x) => `<option value="${esc(x.name)}" ${x.name === g.name ? "selected" : ""}>${esc(x.name === "Poses" ? "Poses (idle, hit, guard…)" : fxGroupLabel(x.name))} · ${x.frames.length}</option>`).join("")}</select></label>
      <button id="fzip" class="mf">Download these frames</button><button id="fzipall" class="mf" title="every skill's frames in one zip, each frame once">Download all frames</button><button id="fload" class="mf">Load edited frames…</button>
      <label class="small mf" title="Off: a replaced frame shows wherever the game uses it (frames are often shared between skills)"><input type="checkbox" id="fscope" ${scoped ? "checked" : ""}> only in this skill</label>
      <input type="file" id="ffile" accept="image/png,.zip" multiple style="display:none"><input type="file" id="ffile1" accept="image/png,image/*" style="display:none"></div>
    <div class="modgrid mf">${g.frames.map((f, i) => { const r = rep(f), o = elsewhere(f); return `<div class="modtex ${r ? "on" : ""}">
      <img loading="lazy" src="${r ? `/api/frame_png?${q}&name=${encodeURIComponent(m.name)}&file=${r.file}&t=${stamp}` : `/api/frame_png?bundle=${encodeURIComponent(f.bundle)}&pid=${f.pid}&w=${f.w}&h=${f.h}`}">
      <div class="small">${esc(f.name)}</div>
      <div class="muted small">${f.w}×${f.h}${r ? ` · <b>${r.source ? `from ${esc(r.source)}` : "replaced"}</b>` : o ? " · replaced in another scope" : ""}</div>
      <div class="row" style="gap:4px"><button class="small" data-f1="${i}">Replace…</button><button class="small" data-fo="${i}" title="Use a frame of another character (or another frame of this one) in place of this one">From another…</button>
        ${r ? `<button class="small" data-fr="${i}">Reset</button>` : ""}</div></div>`; }).join("")}</div>
    <div id="fpick"></div>
    <div class="mt" style="margin-top:12px"><b>Timing</b> <span class="muted small">of this skill, in seconds of its original video: a freeze holds the picture (a hit-stop),
      a stretch plays part of it slower or faster; the sound follows.</span>
      <div id="ftime">${timing.map((t, i) => `<div class="row" style="gap:6px;margin-top:4px" data-ti="${i}">
        <select class="tk"><option value="0" ${t.speed === 0 ? "selected" : ""}>Freeze</option><option value="1" ${t.speed > 0 ? "selected" : ""}>Speed</option></select>
        at <input class="ta" type="number" step="0.05" min="0" value="${t.at}" style="width:70px"> s,
        for <input class="td" type="number" step="0.05" min="0" value="${t.dur}" style="width:70px"> s
        <span class="tsp" style="${t.speed === 0 ? "display:none" : ""}">× <input class="ts" type="number" step="0.05" min="0.05" max="4" value="${t.speed || 0.5}" style="width:60px"></span>
        <button class="small" data-tdel="${i}">✕</button></div>`).join("")}</div>
      <div class="row" style="gap:6px;margin-top:6px"><button id="tadd">+ add</button><button id="tsave">Save timing</button></div></div>`;
  box.classList.toggle("an-hide-mf", part === "timing");
  box.classList.toggle("an-hide-mt", part === "frames");
  $("#fgroup").onchange = (e) => { anim.frameGroup = e.target.value; modFrames(c, m, box, refresh, part); };
  $("#fscope").onchange = (e) => { anim.frameScoped = e.target.checked; modFrames(c, m, box, refresh); };
  $("#fzip").onclick = () => exportObj({ framezip: { id: c.id, group: g.name } });
  $("#fzipall").onclick = () => exportObj({ framezip: { id: c.id, group: "" } });
  const send = (body) => api("/api/mod_frame", { id: c.id, name: m.name, scope, ...body });
  const readFile = (f) => new Promise((ok) => { const rd = new FileReader(); rd.onload = () => ok(rd.result); rd.readAsDataURL(f); });
  $("#fload").onclick = () => { $("#ffile").value = ""; $("#ffile").click(); };
  $("#ffile").onchange = async () => {
    const known = new Map(g.frames.map((f) => [f.name.replace(/[<>:"/\\|?*]/g, "_") + ".png", f.name]));
    let n = 0, skipped = [];
    for (const f of $("#ffile").files) {
      const url = await readFile(f);
      if (/\.zip$/i.test(f.name)) { const r = await send({ png: url }).catch((e) => toast(esc(e.message))); n += r?.count || 0; continue; }
      const sprite = known.get(f.name);
      if (!sprite) { skipped.push(f.name); continue; }
      await send({ sprite, png: url }).catch((e) => toast(esc(e.message))); n++;
    }
    toast(`${n} frame${n === 1 ? "" : "s"} replaced${skipped.length ? ` · not frames of this skill: ${esc(skipped.slice(0, 4).join(", "))}` : ""}`);
    refresh();
  };
  let one = null;
  box.querySelectorAll("[data-f1]").forEach((b) => b.onclick = () => { one = g.frames[+b.dataset.f1]; $("#ffile1").value = ""; $("#ffile1").click(); });
  $("#ffile1").onchange = async () => {
    const f = $("#ffile1").files[0];
    if (!f || !one) return;
    await send({ sprite: one.name, png: await readFile(f) }).then(() => toast("Replaced")).catch((e) => toast(esc(e.message)));
    refresh();
  };
  box.querySelectorAll("[data-fr]").forEach((b) => b.onclick = async () => { await send({ sprite: g.frames[+b.dataset.fr].name }); refresh(); });
  box.querySelectorAll("[data-fo]").forEach((b) => b.onclick = () => pickFrame(g.frames[+b.dataset.fo], $("#fpick"), async (src) => {
    await send({ sprite: g.frames[+b.dataset.fo].name, from: src }).then(() => toast("Replaced")).catch((e) => toast(esc(e.message)));
    refresh();
  }));
  // timing rows
  box.querySelectorAll("#ftime .tk").forEach((sel) => sel.onchange = () => { sel.parentElement.querySelector(".tsp").style.display = sel.value === "0" ? "none" : ""; });
  const rows = () => [...box.querySelectorAll("#ftime [data-ti]")].map((r) => ({ group: g.name, at: +r.querySelector(".ta").value || 0,
    dur: +r.querySelector(".td").value || 0, speed: r.querySelector(".tk").value === "0" ? 0 : (+r.querySelector(".ts").value || 1) }));
  const saveTiming = async (list) => {
    const others = (m.timing || []).filter((t) => t.group !== g.name);
    await api("/api/mod", { id: c.id, name: m.name, hue: m.hue, sat: m.sat, bright: m.bright, timing: [...others, ...list] })
      .then(() => toast("Timing saved")).catch((e) => toast(esc(e.message)));
    refresh();
  };
  $("#tadd").onclick = () => saveTiming([...rows(), { group: g.name, at: 1, dur: 0.3, speed: 0 }]);
  $("#tsave").onclick = () => saveTiming(rows());
  box.querySelectorAll("[data-tdel]").forEach((b) => b.onclick = () => saveTiming(rows().filter((_, i) => i !== +b.dataset.tdel)));
}
// another character's frame for `target`: pick a character, one of its skills, a frame
async function pickFrame(target, host, done) {
  const chars = [];
  for (const s of anim.data.sinners) for (const x of [...s.ids, ...s.egos]) chars.push([String(x.id), `${s.name} · ${x.title}`]);
  for (const g of anim.data.groups) for (const arr of Object.values(g.kinds)) for (const x of arr) if (x.app) chars.push([x.app, `${g.label} · ${x.name || x.app}`]);
  const st = { who: anim.pickWho || chars[0][0] };
  const draw = async () => {
    host.innerHTML = `<div class="card" style="margin-top:8px"><div class="small muted" style="margin-bottom:6px">Pick a character and one of its frames: it is
        shown in place of ${esc(target.name)} (at the same spot, its own size).</div><div class="row" style="gap:8px;flex-wrap:wrap"><b>A frame for ${esc(target.name)}</b>
        <select id="pwho" style="max-width:420px">${chars.map(([k, l]) => `<option value="${esc(k)}" ${k === st.who ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>
        <select id="pgrp"></select><span class="grow"></span><button id="pclose">Close</button></div><div class="modgrid" id="pgrid"><div class="muted small">…</div></div></div>`;
    $("#pclose").onclick = () => { host.innerHTML = ""; };
    $("#pwho").onchange = (e) => { st.who = anim.pickWho = e.target.value; st.group = null; draw(); };
    let fr;
    try { fr = await api(`/api/frames?id=${encodeURIComponent(st.who)}`); } catch (e) { $("#pgrid").innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    if (!fr.groups.length) { $("#pgrid").innerHTML = `<div class="muted small">no frames</div>`; return; }
    if (!st.group) st.group = fr.groups[0].name;
    $("#pgrp").innerHTML = fr.groups.map((x) => `<option value="${esc(x.name)}" ${x.name === st.group ? "selected" : ""}>${esc(x.name === "Poses" ? "Poses" : fxGroupLabel(x.name))} · ${x.frames.length}</option>`).join("");
    $("#pgrp").onchange = (e) => { st.group = e.target.value; draw(); };
    const g = fr.groups.find((x) => x.name === st.group);
    $("#pgrid").innerHTML = g.frames.map((f, i) => `<div class="modtex" data-pf="${i}" style="cursor:pointer" title="Use this one">
      <img loading="lazy" src="/api/frame_png?bundle=${encodeURIComponent(f.bundle)}&pid=${f.pid}&w=${f.w}&h=${f.h}"><div class="small">${esc(f.name)}</div></div>`).join("");
    host.querySelectorAll("[data-pf]").forEach((d) => d.onclick = () => { host.innerHTML = ""; done({ cid: st.who, sprite: g.frames[+d.dataset.pf].name }); });
  };
  draw();
  host.scrollIntoView({ behavior: "smooth", block: "start" });  // it opens under the frames, often out of sight
}
async function loadClip(cl) {
  $("#acount").textContent = "loading…";
  let r;
  try { r = await api(`/api/clip?bundle=${encodeURIComponent(cl.bundle)}&clip=${cl.clip}&go=${cl.animator_go}&all=${anim.all ? 1 : 0}`); }
  catch (e) { $("#acount").textContent = e.message; return; }
  const ids = Object.keys(r.sprites);
  const imgs = {};
  // sprites can come from other bundles: each one carries its own bundle + pid
  await Promise.all(ids.map((key) => new Promise((res) => {
    const im = new Image(), s = r.sprites[key];
    im.onload = () => { imgs[key] = im; res(); };
    im.onerror = () => res();
    im.src = `/api/object?bundle=${encodeURIComponent(s.bundle)}&pid=${s.pid}`;
  })));
  // bounds over the whole clip, sprite pivot at (x, y), flips mirror around the pivot
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const f of r.frames) for (const [pid, x, y, flip, , sx, sy] of f.ops) {
    const s = r.sprites[pid];
    const px = flip ? s.w - s.px : s.px;
    x0 = Math.min(x0, x - px * sx); x1 = Math.max(x1, x + (s.w - px) * sx);
    y0 = Math.min(y0, y - s.py * sy); y1 = Math.max(y1, y + (s.h - s.py) * sy);
  }
  if (!isFinite(x0)) {
    $("#acount").textContent = "This clip draws no sprites — the character is animated with Spine here (see its Spine tab) or the clip only drives effects.";
    return;
  }
  const c = $("#acanvas");
  if (!c) return;
  c.width = Math.ceil(x1 - x0) + 4; c.height = Math.ceil(y1 - y0) + 4;
  const starts = [];
  let t = 0;
  for (const f of r.frames) { starts.push(t); t += f.d; }
  anim.render = { r, imgs, x0: x0 - 2, y0: y0 - 2, starts, total: t, pos: 0, i: 0, last: 0 };
  paintClip();
  if (anim.playing) startAnim();
}
function paintClip() {
  const R = anim.render, c = $("#acanvas");
  if (!R || !c) return;
  const ctx = c.getContext("2d");
  ctx.clearRect(0, 0, c.width, c.height);
  const f = R.r.frames[R.i];
  for (const [pid, x, y, flip, a, sx, sy] of f.ops) {
    const im = R.imgs[pid], s = R.r.sprites[pid];
    if (!im) continue;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(x - R.x0, y - R.y0);
    ctx.scale(flip ? -sx : sx, sy);
    ctx.drawImage(im, -s.px, -s.py);
    ctx.restore();
  }
  const sec = (R.starts[R.i] / R.r.fps).toFixed(2), tot = (R.total / R.r.fps).toFixed(2);
  $("#acount").textContent = `frame ${R.i + 1} / ${R.r.frames.length} · ${sec}s / ${tot}s`;
}
function stepClip(d) {
  const R = anim.render;
  if (!R) return;
  anim.playing = false;
  if ($("#aplay")) $("#aplay").textContent = "▶ play";
  stopAnim();
  R.i = (R.i + d + R.r.frames.length) % R.r.frames.length;
  R.pos = R.starts[R.i];
  paintClip();
}
function stopAnim() { cancelAnimationFrame(anim.raf); anim.raf = 0; }
function startAnim() {
  stopAnim();
  const R = anim.render;
  if (!R || R.r.frames.length < 2) return;
  R.last = performance.now();
  const tick = (now) => {
    if (!$("#acanvas")) return stopAnim();
    // the first rAF timestamp can be slightly older than performance.now() at start
    R.pos = (R.pos + Math.max(0, now - R.last) / 1000 * R.r.fps * anim.speed) % R.total;
    R.last = now;
    let i = R.i;
    if (R.starts[i] > R.pos || (i + 1 < R.starts.length && R.starts[i + 1] <= R.pos)) {
      i = Math.max(0, R.starts.findIndex((s, k) => s <= R.pos && (k + 1 === R.starts.length || R.starts[k + 1] > R.pos)));
    }
    if (i !== R.i) { R.i = i; paintClip(); }
    anim.raf = requestAnimationFrame(tick);
  };
  anim.raf = requestAnimationFrame(tick);
}

// ---------- Spine (official spine-player 4.0, loaded from the CDN on first use; Limbus uses Spine 4.0.64)
const SPINE_CDN = "https://cdn.jsdelivr.net/npm/@esotericsoftware/spine-player@4.0.31/dist";
const spn = { player: null, players: [], stack: [], fx: null };  // not "spine": the player script defines a global of that name
function loadSpinePlayer() {
  if (loadSpinePlayer.p) return loadSpinePlayer.p;
  loadSpinePlayer.p = new Promise((res, rej) => {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = `${SPINE_CDN}/spine-player.css`;
    document.head.appendChild(css);
    const s = document.createElement("script");
    s.src = `${SPINE_CDN}/iife/spine-player.min.js`;
    s.onload = () => window.spine && window.spine.SpinePlayer ? res(window.spine) : rej(new Error("The Spine player did not start"));
    s.onerror = () => { loadSpinePlayer.p = null; rej(new Error("Could not load the Spine player (needs internet once)")); };
    document.head.appendChild(s);
  });
  return loadSpinePlayer.p;
}
function disposeSpine() {
  if (spn.fx) { spn.fx.stop(); spn.fx = null; }
  for (const p of spn.players || []) { try { p.dispose(); } catch (e) { /* already gone */ } }
  spn.players = []; spn.player = null; spn.stack = [];
}
async function openSpine(x, host) {
  disposeSpine();
  host.innerHTML = `<div class="row" style="margin-top:8px"><span class="grow"></span>
      <button class="spzip" title="${esc(x.base)}.json, .atlas and the page images — opens in Spine viewers">Download Spine files</button>
      <button class="spgif" title="The animation that is playing now, one loop">Export GIF</button>
      <button class="spvid" title="The same as a video: one loop recorded in real time — full colour, much smaller than a GIF">Export video</button></div>
    <div class="spstage"><div class="spbox animstage" style="height:62vh;margin-top:8px"></div></div>
    <div class="small muted sphint" style="margin-top:6px">Animations and skins: the ⚙ button of the player. Drag to move, scroll to zoom — the GIF keeps this framing.</div>`;
  host.querySelector(".spzip").onclick = () => exportObj({ spine: { bundle: x.bundle, atlas: x.atlas, base: x.base } });
  host.querySelector(".spgif").onclick = (e) => spineGif(x.base, e.target);
  host.querySelector(".spvid").onclick = (e) => spineVideo(x.base, e.target);
  let sp;
  try { sp = await loadSpinePlayer(); } catch (e) { host.querySelector(".spbox").innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  const scene = await api(`/api/spine_scene?bundle=${encodeURIComponent(x.bundle)}&atlas=${x.atlas}`).catch(() => ({}));
  const hasScene = !!(scene.layers && scene.layers.some((l) => l.kind === "image"));
  const full = hasScene && spn.full !== false;
  if (hasScene) {
    const others = scene.layers.filter((l) => l.kind === "spine").length - 1;
    host.querySelector(".row").insertAdjacentHTML("afterbegin", `<label class="small" title="The illustration as the game shows it: background and effect layers of the same prefab around the skeleton${others ? ` (and the ${others} other skeleton${others > 1 ? "s" : ""} it is cut into)` : ""}">
      <input type="checkbox" class="spfull" ${full ? "checked" : ""}> full art (background + effects)</label><select class="spanim" style="display:none"></select>`);
    host.querySelector(".spfull").onchange = (e) => { spn.full = e.target.checked; openSpine(x, host); };
  }
  const sel = host.querySelector(".spanim");
  if (!full) {
    spn.player = await addSpinePlayer(sp, host.querySelector(".spbox"), x.bundle, x.atlas, null, { controls: true });
    spn.players = [spn.player]; spn.stack = [{ player: spn.player }];
    return;
  }
  // the stack of the illustration: runs of images share one WebGL canvas, every skeleton gets its own player;
  // a skeleton's origin sits at (ox, oy) of the frame, 1 skeleton unit = 1 frame pixel
  const parts = [];
  for (const l of scene.layers) {
    if (l.kind === "image") {
      if (!parts.length || parts[parts.length - 1].kind !== "fx") parts.push({ kind: "fx", layers: [] });
      parts[parts.length - 1].layers.push(l);
    } else parts.push({ kind: "spine", l });
  }
  host.querySelector(".spstage").innerHTML = `<div class="spscene" style="aspect-ratio:${scene.w} / ${scene.h};width:min(100%, calc(62vh * ${scene.w / scene.h}))">
    ${parts.map((p, i) => p.kind === "fx" ? `<canvas class="fxl" data-i="${i}"></canvas>` : `<div class="spbox" data-i="${i}"></div>`).join("")}</div>`;
  host.querySelector(".sphint").textContent = "Background and effect layers come from the illustration's prefab; the effects (scrolling noise, dissolve) are replayed from their materials, so they are close to the game but not exact.";
  const stage = host.querySelector(".spscene");
  spn.fx = sceneFx(stage, scene, parts.filter((p) => p.kind === "fx").map((p) => ({ canvas: stage.querySelector(`[data-i="${parts.indexOf(p)}"]`), layers: p.layers })), x.bundle);
  const players = await Promise.all(parts.map((p, i) => p.kind !== "spine" ? null : addSpinePlayer(sp, stage.querySelector(`[data-i="${i}"]`), x.bundle, p.l.atlas, {
    x: -p.l.ox / (p.l.scale || 1), y: -(scene.h - p.l.oy) / (p.l.scale || 1), width: scene.w / (p.l.scale || 1), height: scene.h / (p.l.scale || 1),
    padLeft: "0%", padRight: "0%", padTop: "0%", padBottom: "0%", transitionTime: 0 }, { skin: p.l.skin, anim: p.l.anim })));
  if (!stage.isConnected) { players.forEach((p) => p && p.dispose()); return; }
  spn.stack = parts.map((p, i) => p.kind === "fx" ? { canvas: stage.querySelector(`[data-i="${i}"]`) } : { player: players[i] });
  spn.players = players.filter(Boolean);
  spn.player = players[parts.findIndex((p) => p.kind === "spine" && p.l.atlas === String(x.atlas))] || spn.players[0] || null;
  // animations of the opened skeleton (no player controls in the framed view); the others keep their own
  const names = spn.player ? spn.player.skeleton.data.animations.map((a) => a.name) : [];
  if (sel && names.length > 1) {
    const cur = spn.player.animationState.getCurrent(0);
    sel.innerHTML = names.map((n) => `<option ${cur && cur.animation.name === n ? "selected" : ""}>${esc(n)}</option>`).join("");
    sel.style.display = "";
    sel.onchange = () => { spn.player.setAnimation(sel.value, true); spn.players.forEach((p) => p.play()); };
  }
}
// one Spine player in `box`; resolves with the player once loaded (null if it could not play)
async function addSpinePlayer(sp, box, bundle, atlas, viewport, opt) {
  const base = `/spine/${encodeURIComponent(bundle)}/${atlas}.2/skeleton`;  // .2: pages scaled back to the atlas size (old cached copies are stretched)
  // ~10% of atlases are not premultiplied; drawing them as premultiplied gives dark fringes
  const atlasText = await fetch(`${base}.atlas`).then((r) => r.text()).catch(() => "");
  const pma = /^\s*pma\s*:\s*true/mi.test(atlasText);
  return new Promise((resolve) => {
    const make = (vp) => new sp.SpinePlayer(box, {
      jsonUrl: `${base}.json`, atlasUrl: `${base}.atlas`,
      alpha: true, backgroundColor: "#00000000", premultipliedAlpha: pma,
      showControls: !!opt.controls, interactive: !!opt.controls, preserveDrawingBuffer: true,  // true: frames can be read back for GIFs
      ...(vp ? { viewport: vp } : {}),
      success: (p) => {
        // many skeletons keep the head / body in a named skin, "default" alone shows a headless or broken model
        const skins = p.skeleton.data.skins.map((s) => s.name);
        const skin = opt.skin && opt.skin !== "default" && skins.includes(opt.skin) ? opt.skin : spineSkin(skins);
        if (skin && skin !== "default") { p.skeleton.setSkinByName(skin); p.skeleton.setSlotsToSetupPose(); }
        const names = p.skeleton.data.animations.map((a) => a.name);
        const first = (opt.anim && names.includes(opt.anim) && opt.anim) || names.find((n) => /idle/i.test(n)) || names.find((n) => /^f$|front/i.test(n))
          || names.find((n) => /loop|default|^animation/i.test(n)) || names[0];
        if (first) { p.setAnimation(first, true); p.play(); }
        resolve(p);
      },
      error: async (p, msg) => {
        // "Animation bounds are invalid": nothing visible on the first frame — frame it with the skeleton's own bounds
        if (!vp && /bounds/i.test(msg)) {
          const sk = await fetch(`${base}.json`).then((r) => r.json()).catch(() => null);
          const h = sk && sk.skeleton;
          if (h && h.width > 0 && h.height > 0) {
            box.innerHTML = "";
            make({ x: h.x, y: h.y, width: h.width, height: h.height, padLeft: "10%", padRight: "10%", padTop: "10%", padBottom: "10%" });
            return;
          }
        }
        box.innerHTML = `<div class="empty">Could not play this one: ${esc(msg)}</div>`;
        resolve(null);
      },
    });
    make(viewport);
  });
}

// Background / effect layers of an illustration in WebGL. Fx_Team/FX_Grp_SpineIllustShader: the sprite is pushed
// around by a scrolling noise texture (Noise_*) and faded by a scrolling dissolve texture (Dissolve_*); the colour is
// tint × White_Intensity (HDR in the game, clipped here). Approximated from the material values.
const FX_VS = `attribute vec2 p; attribute vec2 t; varying vec2 uv; void main() { uv = t; gl_Position = vec4(p, 0.0, 1.0); }`;
const FX_FS = `precision mediump float;
varying vec2 uv;
uniform sampler2D tex, ntex, dtex;
uniform vec4 tint; uniform float inten, time, useN, useD, nInt, nRot, dRot, diss, dHard;
uniform vec2 nSpeed, dSpeed, nTile, dTile;
vec2 rot(vec2 q, float deg) { float a = radians(deg); q -= 0.5; return vec2(cos(a) * q.x - sin(a) * q.y, sin(a) * q.x + cos(a) * q.y) + 0.5; }
void main() {
  vec2 u = uv;
  if (useN > 0.5) u += (texture2D(ntex, rot(uv, nRot) * nTile + nSpeed * time).r - 0.5) * nInt;
  vec4 c = texture2D(tex, clamp(u, 0.0, 1.0));
  if (useD > 0.5) {
    float d = texture2D(dtex, rot(uv, dRot) * dTile + dSpeed * time).r;
    float w = max(0.5 * (1.0 - dHard), 0.02);
    c.a *= mix(1.0, smoothstep(0.5 - w, 0.5 + w, d), clamp(diss, 0.0, 1.0));
  }
  c.rgb = min(c.rgb * tint.rgb * inten, 1.0);
  c.a *= tint.a;
  gl_FragColor = vec4(c.rgb * c.a, c.a);
}`;
function sceneFx(stage, scene, runs, bundle) {
  const img = (src) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
  const pot = (im) => {  // WebGL 1 repeats only power-of-two textures
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    c.getContext("2d").drawImage(im, 0, 0, 256, 256);
    return c;
  };
  const make = (canvas, layers) => {
    const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true });
    if (!gl || !layers.length) return null;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, FX_VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FX_FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.warn(gl.getProgramInfoLog(prog)); return null; }
    gl.useProgram(prog);
    const U = (n) => gl.getUniformLocation(prog, n);
    gl.uniform1i(U("tex"), 0); gl.uniform1i(U("ntex"), 1); gl.uniform1i(U("dtex"), 2);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    const ap = gl.getAttribLocation(prog, "p"), at = gl.getAttribLocation(prog, "t");
    gl.enableVertexAttribArray(ap); gl.enableVertexAttribArray(at);
    gl.vertexAttribPointer(ap, 2, gl.FLOAT, false, 16, 0); gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 16, 8);
    gl.enable(gl.BLEND);
    const texture = (src, repeat) => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, repeat ? pot(src) : src);
      const wrap = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      return t;
    };
    const items = [];
    const ready = Promise.all(layers.map(async (l) => {
      const fx = (l.material && l.material.fx) || null;
      const [im, nim, dim] = await Promise.all([img(`/api/scene_sprite?bundle=${encodeURIComponent(bundle)}&pid=${l.sprite}`),
        fx && fx.noise ? img(`/api/object?bundle=${encodeURIComponent(bundle)}&pid=${fx.noise}`) : null,
        fx && fx.dissolve ? img(`/api/object?bundle=${encodeURIComponent(bundle)}&pid=${fx.dissolve}`) : null]);
      return im && { l, fx, tex: texture(im), ntex: nim && texture(nim, true), dtex: dim && texture(dim, true) };
    })).then((r) => { items.push(...r.filter(Boolean)); });  // Promise.all keeps the layer order
    const draw = (time) => {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      for (const it of items) {
        const { l, fx } = it;
        const x0 = l.x / scene.w * 2 - 1, x1 = (l.x + l.w) / scene.w * 2 - 1;
        const y0 = 1 - l.y / scene.h * 2, y1 = 1 - (l.y + l.h) / scene.h * 2;
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([x0, y0, 0, 0, x1, y0, 1, 0, x0, y1, 0, 1, x1, y1, 1, 1]), gl.STREAM_DRAW);
        gl.blendFunc(gl.ONE, l.material && l.material.blend === "add" ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, it.tex);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, it.ntex || it.tex);
        gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, it.dtex || it.tex);
        const f = (k, d = 0) => (fx && fx[k] != null ? fx[k] : d);
        gl.uniform4fv(U("tint"), l.color);
        gl.uniform1f(U("inten"), f("White_Intensity", 1));
        gl.uniform1f(U("time"), time);
        gl.uniform1f(U("useN"), it.ntex && f("Noise_Intensity") ? 1 : 0);
        gl.uniform1f(U("useD"), it.dtex && f("Dissolve") ? 1 : 0);
        gl.uniform1f(U("nInt"), f("Noise_Intensity")); gl.uniform1f(U("nRot"), f("Noise_Rotate"));
        gl.uniform1f(U("dRot"), f("Dissolve_Rotate")); gl.uniform1f(U("diss"), f("Dissolve")); gl.uniform1f(U("dHard"), f("Dissolve_Hardness"));
        gl.uniform2f(U("nSpeed"), f("Noise_Speed_U"), f("Noise_Speed_V")); gl.uniform2f(U("dSpeed"), f("Dissolve_Speed_U"), f("Dissolve_Speed_V"));
        gl.uniform2fv(U("nTile"), f("noise_tile", [1, 1])); gl.uniform2fv(U("dTile"), f("dissolve_tile", [1, 1]));
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
    };
    return { ready, draw };
  };
  const canvases = runs.map((r) => r.canvas);
  const px = () => Math.max(1, Math.round(stage.clientWidth * Math.min(window.devicePixelRatio || 1, scene.w / Math.max(1, stage.clientWidth))));
  const size = () => {
    const w = px(), h = Math.max(1, Math.round(w * scene.h / scene.w));
    for (const c of canvases) { c.width = w; c.height = h; }
  };
  size();
  const rs = runs.map((r) => make(r.canvas, r.layers)).filter(Boolean);
  const fx = { raf: 0, t0: performance.now() };
  fx.draw = (t) => rs.forEach((r) => r.draw(t));
  fx.stop = () => { cancelAnimationFrame(fx.raf); fx.raf = 0; };
  fx.start = () => {
    fx.stop();
    const tick = (now) => {
      if (!stage.isConnected) return fx.stop();
      if (canvases.length && canvases[0].width !== px()) size();
      fx.draw((now - fx.t0) / 1000);
      fx.raf = requestAnimationFrame(tick);
    };
    fx.raf = requestAnimationFrame(tick);
  };
  Promise.all(rs.map((r) => r.ready)).then(() => fx.start());
  return fx;
}

// the layers of the Spine view drawn into one 2D canvas, in order (image runs and skeleton players)
function paintStack(ctx, w, h) {
  ctx.clearRect(0, 0, w, h);
  if (spn.fx) { ctx.fillStyle = "#000"; ctx.fillRect(0, 0, w, h); }
  for (const s of spn.stack || []) {
    const c = s.canvas || (s.player && s.player.canvas);
    if (c) ctx.drawImage(c, 0, 0, w, h);
  }
}
function stackCanvas(maxSide) {
  const src = spn.player.canvas, k = Math.min(1, maxSide / Math.max(src.width, src.height));
  const c = document.createElement("canvas");
  c.width = Math.round(src.width * k / 2) * 2; c.height = Math.round(src.height * k / 2) * 2;  // even sizes for video encoders
  return c;
}
// one loop of the current animation: step the paused players frame by frame and read the canvases back
async function spineGif(base, btn) {
  const p = spn.player, entry = p && p.animationState && p.animationState.getCurrent(0);
  if (!entry || !p.canvas) return toast("Nothing is playing");
  const fps = 25, a = entry.animation, fx = spn.fx;
  const n = Math.max(1, Math.min(300, Math.round(a.duration * fps)));
  const c2 = stackCanvas(fx ? 960 : 900), ctx = c2.getContext("2d");
  const players = spn.players.filter((q) => q.animationState.getCurrent(0));
  const wasPaused = p.paused, label = btn.textContent;
  players.forEach((q) => q.pause());
  if (fx) fx.stop();
  btn.disabled = true;
  const frames = [];
  try {
    for (let i = 0; i < n; i++) {
      for (const q of players) {
        q.animationState.getCurrent(0).trackTime = i / fps;
        q.animationState.apply(q.skeleton);
        q.skeleton.updateWorldTransform();
      }
      if (fx) fx.draw(i / fps);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));  // let the players draw it
      paintStack(ctx, c2.width, c2.height);
      frames.push(fx ? c2.toDataURL("image/jpeg", 0.92) : c2.toDataURL("image/png"));
      btn.textContent = `frame ${i + 1} / ${n}`;
    }
    btn.textContent = "saving…";
    await exportObj({ framesgif: { frames, fps, name: `${base}_${a.name}${fx ? "_full" : ""}`.replace(/[^\w-]+/g, "_") } });
  } finally {
    btn.disabled = false; btn.textContent = label;
    if (!wasPaused) players.forEach((q) => q.play());
    if (fx) fx.start();
  }
}
// one loop recorded in real time from a canvas that composites the layers (WebM: VP9 / VP8, whatever WebView2 has)
async function spineVideo(base, btn) {
  const p = spn.player, entry = p && p.animationState && p.animationState.getCurrent(0);
  if (!entry || !p.canvas || !window.MediaRecorder) return toast("Nothing is playing");
  const a = entry.animation, fx = spn.fx;
  const c2 = stackCanvas(1920), ctx = c2.getContext("2d");
  const mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m));
  const rec = new MediaRecorder(c2.captureStream(30), { mimeType: mime, videoBitsPerSecond: 12e6 });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const stopped = new Promise((r) => { rec.onstop = r; });
  const label = btn.textContent;
  btn.disabled = true;
  let run = true;
  const paint = () => {
    if (!run) return;
    if (!fx) { ctx.fillStyle = "#000"; ctx.fillRect(0, 0, c2.width, c2.height); }  // WebM keeps no transparency
    paintStack(ctx, c2.width, c2.height);
    requestAnimationFrame(paint);
  };
  try {
    for (const q of spn.players) { const e = q.animationState.getCurrent(0); if (e) e.trackTime = 0; q.play(); }
    paint();
    rec.start();
    const ms = Math.max(1, a.duration || 3) * 1000, t0 = performance.now();
    while (performance.now() - t0 < ms) {
      btn.textContent = `recording ${((performance.now() - t0) / 1000).toFixed(1)} / ${(ms / 1000).toFixed(1)}s`;
      await new Promise((r) => setTimeout(r, 100));
    }
    rec.stop();
    await stopped;
    btn.textContent = "saving…";
    const data = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(new Blob(chunks, { type: "video/webm" })); });
    await exportObj({ video: { data, name: `${base}_${a.name}${fx ? "_full" : ""}`.replace(/[^\w-]+/g, "_") } });
  } finally {
    run = false;
    btn.disabled = false; btn.textContent = label;
  }
}
function spineSkin(skins) {
  if (skins.length <= 1) return skins[0] || null;
  const pick = (re) => skins.find((s) => re.test(s));
  return pick(/^(normal|noaml|nomal|norm|basic|base)$/i) || pick(/^(a|1|01|on)$/i)
    || skins.find((s) => s !== "default" && !/destroy|dead|broken|off|dummy/i.test(s)) || "default";
}

// ------------------------------------------------------------------ Versus
// Two characters on one stage: one takes the other's skill with its own idle and hit poses, or both clash first
// (their clash animations at once) and the winner's skill follows. Rendered like the skills with effects.
// The page is a workbench: the picker on the left (always open, it fills the side picked for), the two in the middle
// (their start frame, skills, the fight), stage / music / what to show / Debug and the Render and Live buttons on the right.
const vs = { left: "", right: "", skill: "", rskill: "", mode: "target", rounds: 2, winner: 0, map: "", lskills: false, rskills: false, defend: true, counter: false, bursts: false, burstMax: 3, maps: null,
  trim: false, bars: false, uisfx: true, numbers: false, dash: false, hp: false, death: false, intro: false, ego: false, music: "", bgm: null,
  pace: false, impact: false, leftovers: "cut", loop: false, notes: false, kbscale: 2, debug: false, base: {}, buff: false, buffboth: false, buffmany: false, buffown: false, buffshort: false, debuff: false, debuffboth: false, debuffmany: false, debuffown: false, debuffshort: false,
  // (the page: the side a pick fills, the picker's filters, the last picks, each side's last skill drawn at random)
  side: "left", ptype: "ids", psinner: 1, pseason: "", pgroup: "", recent: [], lrand: true, rrand: true,
  // (team fights, limbusdm/versus_team.py: a pick joins its side's team; only the engine view for now)
  team: false, lefts: [], rights: [] };
// the Versus switches (limbusdm/viewer.py VS_EXTRAS), in groups; each one on its own. Fixed rules now (always on, no
// switch): the skill deck (3 : 2 : 1, no repeats), a random last skill, pushing apart two standing in each other.
const VS_GROUPS = [
  ["Fight", [
    ["pace", "Exchanges", "Clashes in exchanges of 2-5, then a skill lands or both spring apart to a stand-off (off: one clash round after another, both springing apart after each, then the winner's skill). Either way the fight engine decides the fight from the game's skill data (coin flips, guards, HP, who runs in, knockback)"],
    ["loop", "Loop", "A seamless loop: it ends in the stand-off it starts in (with Exchanges; no intro, E.G.O, HP or death)"]]],
  ["Motion", [
    ["dash", "Index dashes", "Clashes without dashes of their own get Yi Sang · Index Nursefather's: a blink past the other one and a slide on"]]],
  ["Show", [
    ["hp", "HP & damage", "HP bars over their heads and damage numbers on every hit"],
    ["numbers", "Clash numbers", "Each one's power over its head; the higher one turns gold at the blow, the lower one grey"],
    ["death", "Death finale", "At the end the loser plays its death animation"],
    ["intro", "Intro & WIN", "An “A vs B” card with their pictures before the fight, WIN over the winner at the end"],
    ["buff", "Buffs", "Buffs from Database → Buff effects come onto the fighters at random moments, with their effects. The choices open under the switches"],
    ["buffboth", "Buffs: both sides", "Each of the two gets buffs, on its own clock (off: one of them, drawn at random)"],
    ["buffmany", "Buffs: several", "Up to three buffs a side over the fight (off: one)"],
    ["buffown", "Buffs: their own", "Only the buffs each of the two gives itself (off: any buff of the game). One without buff effects of its own gets none"],
    ["buffshort", "Buffs: a few seconds", "A buff goes out after a few seconds (off: it stays to the end of the fight)"],
    ["debuff", "Debuffs", "Debuffs from Database → Buff effects come onto the fighters, with their effects. The choices open under the switches"],
    ["debuffboth", "Debuffs: both sides", "Each of the two gets debuffs (off: one of them, drawn at random)"],
    ["debuffmany", "Debuffs: several", "Up to three debuffs a side over the fight (off: one)"],
    ["debuffown", "Debuffs: their own", "Only the debuffs the other one inflicts, each coming on when a hit of the skill that inflicts it lands (off: any debuff of the game, at random moments)"],
    ["debuffshort", "Debuffs: a few seconds", "A debuff goes out after a few seconds (off: it stays to the end of the fight)"],
    ["ego", "E.G.O cut-in", "The winner (a Sinner) shows one of its E.G.O cut-ins before its last skill — makes the video several seconds longer"]]],
  ["Test", [
    ["notes", "Engine notes", "(For testing, with Exchanges) what the fight engine decided, written over the video: each clash's powers and coins left, who loses it, the range, damage"]]],
];
const VS_EXTRAS = VS_GROUPS.flatMap(([, items]) => items);
const VS_SHOW = ["hp", "intro", "death", "ego", "buff", "debuff"];  // (on the page; the rest is under Debug)
// what opens under the Buffs / Debuffs chips while one is on: [the switch's ending, its row's name, the choice when
// off, the choice when on], the same four for both
const VS_BUFF = [["both", "Who", "One side", "Both"], ["many", "How many", "One", "Several"], ["own", "Which", "Any", "Their own"],
  ["short", "How long", "Whole fight", "A few seconds"]];
const VS_BUFF_KINDS = [["buff", "Buffs"], ["debuff", "Debuffs"]];
const VS_BUFF_KEYS = VS_BUFF_KINDS.flatMap(([p]) => VS_BUFF.map(([k]) => p + k));
const VS_DEBUG = ["pace", "loop", "numbers", "dash", "notes"];  // (the Debug panel's chips; 0.10.80 dropped this line while still using it)
// the base of every clash fight (limbusdm/viewer.py CLASH_BASE): on without switches; the Debug row changes it for a
// test — `vs.base` holds only what differs from it, and only that is sent (kept until "Reset to base")
const VS_BASE = { defend: true, counter: true, bursts: true, burstMax: 5, lskills: true, rskills: true, kbscale: 2, uisfx: true,
  bars: true, trim: true, clean: true, punch: true, flash: true, ramp: true, hitstop: true, slowmo: true, fade: false, camFollow: 0.5 };
const VS_HIT = ["punch", "flash", "ramp", "hitstop", "slowmo"];  // ("Hit effects": one switch for all five)
const VS_BASE_ITEMS = [
  ["defend", "Guard & evade", "Some rounds one side guards or evades instead of clashing"],
  ["counter", "Counter", "Takes a blow (a guard or a landing) and strikes back with a coin of its first skill"],
  ["bursts", "Whole skills", "A clash's winner sometimes follows it with a whole skill up to this long"],
  ["lskills", "Left: skills as clash", "The left one clashes with coins of its skills as well as its clash animations"],
  ["rskills", "Right: skills as clash", "The right one clashes with coins of its skills as well as its clash animations"],
  ["uisfx", "UI sounds", "The game's battle UI sounds: clash blows, guards, evades, WIN"],
  ["bars", "Bars", "Cinematic bars at the top and bottom"],
  ["hit", "Hit effects", "Camera push-in, impact flash, impact slow-mo, hit-stop, the last blow in slow motion"],
  ["trim", "Cut wind-ups", "Clash animations start near their blow, not with their whole wind-up"]];
const vsB = (k, from = vs.base) => k === "hit" ? VS_HIT.every((h) => vsB(h, from)) : k in from ? from[k] : VS_BASE[k];
function vsBSet(k, v) {
  for (const x of k === "hit" ? VS_HIT : [k]) if (v === VS_BASE[x]) delete vs.base[x]; else vs.base[x] = v;
}
// what differs from the base, in words (`from`: a spec, or vs.base; `skip`: keys already told otherwise)
function vsBaseDiff(from, skip = []) {
  const out = VS_BASE_ITEMS.filter(([k]) => !skip.includes(k) && !!vsB(k, from) !== (k === "hit" || VS_BASE[k]))
    .map(([k, label]) => `${label.toLowerCase()} ${vsB(k, from) ? "on" : "off"}`);
  if (vsB("bursts", from) && +vsB("burstMax", from) !== VS_BASE.burstMax) out.push(`whole skills ≤${vsB("burstMax", from)} s`);
  if (+vsB("kbscale", from) !== VS_BASE.kbscale) out.push(`knockback ${vsB("kbscale", from)}×`);
  if (vsB("fade", from)) out.push("leftovers fade");
  if (+vsB("camFollow", from) !== VS_BASE.camFollow) out.push(`team camera follow ${vsB("camFollow", from)}`);
  return out;
}
// (switches only a clash has)
const VS_CLASH = ["numbers", "dash", "pace", "loop", "notes"];
// the last choices are kept for the next start (this browser profile's storage; the page works without it)
const VS_KEEP = "versus";
const VS_NOKEEP = ["maps", "bgm", "q", "skl", "all", "videos", "tags", "over", "tagEdit", "rulesDef"];
try {
  const saved = JSON.parse(localStorage.getItem(VS_KEEP) || "{}");
  for (const k of Object.keys(vs)) if (k in saved && !VS_NOKEEP.includes(k)) vs[k] = saved[k];
  vs.base = Object.fromEntries(Object.entries(vs.base || {}).filter(([k, v]) => k in VS_BASE && v !== VS_BASE[k]));
  if (!Array.isArray(vs.recent)) vs.recent = [];
} catch (e) { /* no storage */ }
function vsKeep() {
  try { localStorage.setItem(VS_KEEP, JSON.stringify(Object.fromEntries(Object.entries(vs).filter(([k]) => !VS_NOKEEP.includes(k))))); }
  catch (e) { /* no storage */ }
}
async function vsPage(auto) {
  vs.auto = auto;  // (the Auto Battler tab: the team fight with roles, cooldowns and a boss; Versus: duels)
  vs.team = auto || !!vs.vteam;
  const main = $("#main");
  main.innerHTML = `<h1>${auto ? "Auto Battler" : `Versus <label class="vsteamsw" title="Team fight: several a side (many vs many, or many vs one boss). Render makes its video; Live does not play teams yet."><input type="checkbox" id="vsteam" ${vs.team ? "checked" : ""}> Team</label><a class="toggle vsroomlink" href="#/vsroom" title="Pick and fight: two players each pick a fighter in secret, then the same fight plays on everybody's screen; the others watch and bet">Online room</a>`}</h1><div class="sub">${auto ? "Teams fight by the autobattler rules: roles, cooldowns, targets, a boss against several. Pick fighters for each side." : "Pit two characters against each other — Identities, E.G.O or enemies — in the game's own animations and effects."}</div>
    <div id="vsbody"><div class="muted">Loading…</div></div>`;
  if (!anim.data) anim.data = await api("/api/characters");
  if (!vs.maps) vs.maps = await api("/api/battle_maps").catch(() => []);
  if (!vs.bgm) vs.bgm = await api("/api/bgm_tracks").catch(() => []);
  await units().catch(() => null);  // (seasons, and the Identities' / E.G.O' full art for the preview)
  vsPicsSet(await api("/api/stage_pics").catch(() => null));
  vsFigsSet(await api("/api/fighter_pics").catch(() => null));
  drawVersus();
}
routes.versus = () => vsPage(false);
routes.autobattler = () => vsPage(true);
// the stages' pictures (made by the player on demand, limbusdm/viewer.py Renderer.stage_pics): which there are
function vsPicsSet(st) {
  if (!st) return;
  vs.pics = { have: new Set(st.have), queue: st.queue, busy: st.busy, failed: new Set(st.failed), t: Date.now() };
}
const vsPicUrl = (m) => vs.pics && vs.pics.have.has(m) ? `/api/stage_pic?name=${encodeURIComponent(m)}&t=${vs.pics.t}` : "";
// make pictures of these stages (none: every one without one), then watch until they are there
async function vsPicsMake(names) {
  vsPicsSet(await api("/api/stage_pics", { names: names || vs.maps || [] }).catch((e) => { toast(esc(e.message)); return null; }));
  vsPicsWatch();
}
async function vsPicsWatch() {
  clearTimeout(vsPicsWatch.timer);
  const before = vs.pics ? vs.pics.have.size : 0;
  if (vs.pics && vs.pics.busy) {
    vsPicsSet(await api("/api/stage_pics").catch(() => null));
    if (!$("#vsmaps")) return;
    vsPicsWatch.timer = setTimeout(vsPicsWatch, 3000);
  }
  if (!$("#vsmaps")) return;
  if (vs.pics.have.size !== before || !vs.pics.busy) { vsDrawMaps && vsDrawMaps(); vsDrawStage(); }
  vsPicsNote();
}
// The stages in sight get their pictures by themselves (a few at a time, when the renderer is free): nobody has to
// click a stage to see it. One that could not be drawn is not asked for again.
function vsPicsNear() {
  clearTimeout(vsPicsNear.timer);
  vsPicsNear.timer = setTimeout(() => {
    const box = $("#vsmaps");
    if (!box || !vs.pics || vs.pics.busy) return;
    const top = box.getBoundingClientRect().top, bottom = top + box.clientHeight;
    const names = [...box.querySelectorAll("[data-map]")].filter((b) => {
      const r = b.getBoundingClientRect();
      return b.dataset.map && b.querySelector(".vsnopic") && r.bottom > top && r.top < bottom && !vs.pics.failed.has(b.dataset.map) && !vsPicsNear.asked.has(b.dataset.map);
    }).map((b) => b.dataset.map).slice(0, 8);
    names.forEach((n) => vsPicsNear.asked.add(n));  // (asked once a page: a request that fails must not come again and again)
    if (names.length) vsPicsMake(names);
  }, 700);
}
vsPicsNear.asked = new Set();
function vsPicsNote() {
  const el = $("#vspicnote");
  if (!el || !vs.pics) return;
  const all = (vs.maps || []).length, have = vs.pics.have.size, missing = (vs.maps || []).filter((m) => !vs.pics.have.has(m) && !vs.pics.failed.has(m)).length;
  el.innerHTML = vs.pics.busy ? `<span class="grow">Making stage pictures… ${vs.pics.queue} left</span>`
    : `<span class="grow">Pictures: ${have} of ${all}</span>${missing ? `<button id="vspicall" title="The renderer takes a picture of every stage without one (in the background, a few seconds a stage)">Make the other ${missing}</button>` : ""}`;
  if ($("#vspicall")) $("#vspicall").onclick = () => vsPicsMake();
}
let vsDrawMaps = null;
// everyone to pick: { id, label, group, pg (the Sinner, or the Canto / event), short, type (ids / egos / enemy / boss),
// sinner (1-12), season (db.js seasonKey) }
function vsChars() {
  const U = typeof UNITS !== "undefined" ? UNITS : null;
  if (vsChars.cache && vsChars.cache[0] === anim.data && vsChars.cache[1] === U) return vsChars.cache[2];
  const out = [];
  const season = (id) => { const u = U && unitById(id); return u ? seasonKey(u.season) : ""; };
  for (const s of anim.data.sinners) {
    for (const x of s.ids) out.push({ id: String(x.id), label: `${s.name} · ${x.title}`, group: "Identities", pg: s.name, short: x.title, type: "ids", sinner: s.sid, season: season(x.id) });
    for (const x of s.egos) out.push({ id: String(x.id), label: `${s.name} · ${x.title} (E.G.O)`, group: "E.G.O", pg: s.name, short: `${x.title} (E.G.O)`, type: "egos", sinner: s.sid, season: season(x.id) });
  }
  for (const g of anim.data.groups) for (const [kind, arr] of Object.entries(g.kinds)) for (const x of arr)
    if (x.app) {
      const name = `${x.name || x.app.replace(/^\d+_|Appearance$/g, "")}`;
      out.push({ id: x.app, label: name, group: g.label, pg: g.label, short: name, type: /boss|abno/i.test(kind) ? "boss" : "enemy" });
    }
  vsChars.cache = [anim.data, U, out];
  return out;
}
const vsChar = (id) => vsChars().find((c) => c.id === String(id));
const vsIcon = (id) => `/api/char_icon?id=${encodeURIComponent(id)}`;
// a picture that didn't load: an Identity's / E.G.O' thumbnail from the database (some have no profile picture), then nothing
function vsImgErr(img) {
  const id = img.dataset.id || "", u = typeof UNITS !== "undefined" && UNITS && /^\d+$/.test(id) && unitById(+id);
  const alt = u && u.img && u.img.thumb ? imgThumb(u.img.thumb) : "";
  const tried = (img.dataset.tried || "").split("|");
  for (const src of [vsIcon(id), alt]) if (src && !tried.includes(src) && !img.src.endsWith(src)) {
    img.dataset.tried = tried.concat(src).join("|");
    img.src = src;
    return;
  }
  img.style.visibility = "hidden";
}
// the fighters in the preview: each as it stands in a fight, its idle pose on a transparent background — the player
// draws it once (limbusdm/viewer.py make_fighter_pics; a few seconds), the app keeps it
function vsFigsSet(st) {
  if (st) vs.figs = { have: new Set(st.have), busy: st.busy, failed: new Set(st.failed), t: vs.figs ? vs.figs.t : Date.now() };
}
const vsFigUrl = (id) => vs.figs && vs.figs.have.has(String(id)) ? `/api/fighter_pic?id=${encodeURIComponent(id)}&t=${vs.figs.t}` : "";
async function vsFigWant() {
  if (!vs.figs) return;
  const ids = [vs.left, vs.right].map(String).filter((id) => id && !vs.figs.have.has(id) && !vs.figs.failed.has(id));
  if (!ids.length) return;
  vsFigsSet(await api("/api/fighter_pics", { ids }).catch(() => null));
  vsFigWatch();
}
async function vsFigWatch() {
  clearTimeout(vsFigWatch.timer);
  const before = vs.figs.have.size;
  vsFigsSet(await api("/api/fighter_pics").catch(() => null));
  if (!$("#vsstage")) return;
  if (vs.figs.have.size !== before || !vs.figs.busy) vsDrawStage();
  if (vs.figs.busy) vsFigWatch.timer = setTimeout(vsFigWatch, 1500);
}
// a stage's name readable: "Cp4.5_Foreshore_v1" -> "Canto 4.5 · Foreshore"
const vsMapLabel = (m) => m.replace(/_v\d+$/i, "").replace(/^Cp(\d+(?:\.\d+)?)_/i, "Canto $1 · ").replace(/_/g, " ");
const vsTrackLabel = (t) => t.title || t.label;
const VS_TYPES = [["all", "All"], ["ids", "Identities"], ["egos", "E.G.O"], ["enemy", "Enemies"], ["boss", "Bosses & Abnormalities"]];
const vsHasSinner = () => ["all", "ids", "egos"].includes(vs.ptype);
const vsHasGroup = () => ["all", "enemy", "boss"].includes(vs.ptype);
// the picker's list: the search (over everyone), else its filters; an enemy listed in several groups once
function vsFiltered() {
  const q = (vs.q || "").trim().toLowerCase();
  const seen = new Set();
  const list = vsChars().filter((c) => {
    const ok = q ? (c.label + " " + c.group).toLowerCase().includes(q)
      : (vs.ptype === "all" || c.type === vs.ptype)
        && (!vs.psinner || !vsHasSinner() || c.sinner === vs.psinner)
        && (!vs.pseason || !vsHasSinner() || c.season === vs.pseason)
        && (!vs.pgroup || !vsHasGroup() || c.pg === vs.pgroup);
    if (!ok || seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });
  // (a search: the picked type first, then names that start with it)
  const rank = (c) => (vs.ptype === "all" || c.type === vs.ptype ? 0 : 2) + (c.short.toLowerCase().startsWith(q) || c.label.toLowerCase().startsWith(q) ? 0 : 1);
  return q ? list.map((c, i) => [rank(c), i, c]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map((x) => x[2]) : list;
}
async function drawVersus() {
  const box = $("#vsbody");
  if (!box) return;
  const chars = vsChars();
  if (!vs.left || !vsChar(vs.left)) vs.left = chars[0]?.id || "";
  if (!vs.right || !vsChar(vs.right)) vs.right = chars.find((c) => c.type === "enemy" || c.type === "boss")?.id || chars[1]?.id || "";
  vs.skl = vs.skl || {};
  if ($("#vsteam")) $("#vsteam").onchange = (e) => {
    vs.team = vs.vteam = e.target.checked;
    if (vs.team) {  // (first time: the two picked so far are the first of each team)
      vs.mode = "clash";
      if (!vsTeamSide("left").length && vsChar(vs.left)) vs.lefts = [vs.left];
      if (!vsTeamSide("right").length && vsChar(vs.right)) vs.rights = [vs.right];
    }
    vsKeep(); vsDrawPicker(); vsDrawStage(); vsDrawRight(); liveWatch();
  };
  box.innerHTML = `<div id="vsteambox"></div><div class="vsw">
    <section class="card vspick" id="vspick"></section>
    <div class="vsmid"><div id="vsstage"></div><div id="vsout"></div>
      <div class="row" style="margin:14px 0 8px"><h3 class="grow" style="margin:0">Earlier videos</h3><button id="vsall">All</button></div>
      <div id="vslist" class="vsstrip"></div></div>
    <div class="vsright" id="vsright"></div></div>`;
  if (!box.dataset.keep) {  // (the handlers run first: whatever they changed is kept)
    box.dataset.keep = "1";
    for (const ev of ["change", "input", "click"]) box.addEventListener(ev, vsKeep);
  }
  vsKeep();
  vsDrawPicker();
  vsDrawStage();
  vsDrawRight();
  vsDrawTeam();
  ["left", "right"].forEach((k) => vsSkills(k));
  vsFigWant();
  $("#vsall").onclick = () => versusAll();
  liveWatch();
  versusList();
}
// a fighter picked for a side (the picker, its 🎲, Recent, Same settings again)
function vsPick(k, id, redraw = true) {
  id = String(id);
  if (vs.team) { vsTeamAdd(k, id); return; }  // (a team fight: the pick joins the team of that side)
  if (vs[k] !== id) {
    vs[k] = id;
    if (k === "left") vs.skill = ""; else vs.rskill = "";
    vsSkills(k);
  }
  vs.recent = [id, ...vs.recent.filter((x) => x !== id)].slice(0, 12);
  vsFigWant();
  vsKeep();
  if (redraw) { vsDrawPicker(); vsDrawStage(); }
}
// ---- a team fight (the "Team" switch): the middle of the page shows each side's team instead of the two-fighter preview
function vsDrawTeam() { const box = $("#vsteambox"); if (box) box.innerHTML = ""; }  // (the old chip bar: the stage has the teams now)
const VS_ROLE = {
  boss: ["★", "boss", "Alone against two or more: its HP and damage are set so that it wins about half of its fights; short cooldown, armor in its later skills, its mass skills sweep all around it, it turns on shooters. Not a tag: it is the lone fighter of a side (see the Boss button)."],
  nimble: ["⚡", "nimble", "Acts first, short cooldown."],
  slow: ["⛰", "slow", "Fights only in its zone around its start place, long cooldown."],
  range: ["◎", "range", "Shoots from afar: its shots can't be clashed. Backs off after being attacked up close."],
  mass: ["✸", "mass", "Goes where they stand together; its mass skills hit those near the target too."],
  universal: ["◆", "universal", "No special role: the nearest free one."] };
const VS_ROLES = ["nimble", "slow", "range", "mass", "universal"];
const vsTeamSide = (k) => (vs[k + "s"] = (vs[k + "s"] || []).filter((id) => vsChar(id)));
// the boss: the lone fighter of a side against two or more
function vsBossSide() {
  const l = vsTeamSide("left").length, r = vsTeamSide("right").length;
  return r === 1 && l >= 2 ? "right" : l === 1 && r >= 2 ? "left" : "";
}
// a fighter joins a side's team (at most 6)
function vsTeamAdd(k, id) {
  const t = vsTeamSide(k);
  if (t.length >= 6) { toast("A team has at most 6 fighters."); return; }
  t.push(String(id));
  vs.recent = [String(id), ...vs.recent.filter((x) => x !== String(id))].slice(0, 12);
  vsKeep(); vsDrawPicker(); vsDrawStage();
}
// each fighter's guessed tags (and what was set by hand), asked of the engine once
async function vsTeamTagsWant() {
  vs.tags = vs.tags || {};
  const ids = [...new Set([...vsTeamSide("left"), ...vsTeamSide("right")])].filter((id) => !(id in vs.tags));
  if (!ids.length) return;
  ids.forEach((id) => { vs.tags[id] = null; });
  const r = await api(`/api/versus_tags?ids=${ids.map(encodeURIComponent).join(",")}`).catch(() => null);
  if (!r) { ids.forEach((id) => { delete vs.tags[id]; }); return; }
  vs.over = r.over || {};
  for (const id of ids) vs.tags[id] = r.tags[id] || { unit: ["universal"], skills: {}, auto: "" };
  if (vs.team) vsDrawStage();
}
function vsTeamView() {
  const q = new URLSearchParams({ team: "1", lefts: vsTeamSide("left").join(","), rights: vsTeamSide("right").join(","), rounds: vs.rounds, winner: vs.winner });
  q.set("lnames", vs.lefts.map((id) => vsChar(id)?.label || "").join("|")); q.set("rnames", vs.rights.map((id) => vsChar(id)?.label || "").join("|"));
  for (const k of ["lskills", "rskills", "defend", "counter"]) q.set(k, vsB(k) ? "1" : "0");
  q.set("kbscale", vsB("kbscale")); q.set("pace", "1");  // (team fights always play exchanges, as the render)
  if (!vs.auto) { q.set("flow", "duels"); if (vs.pairs === "random") q.set("pairs", "random"); }
  else {
    if (vs.teamFlow === "all") q.set("allAtOnce", "1");
    if (vs.teamFlow === "aggro") q.set("flow", "aggro");
    if (vs.rules && Object.keys(vs.rules).length) q.set("rules", JSON.stringify(vs.rules));
  }
  const o = document.createElement("div");
  o.style.cssText = "position:fixed;inset:0;z-index:50;background:#15161a;display:flex;flex-direction:column";
  o.innerHTML = `<button style="align-self:flex-end;margin:6px">✕ Close</button><iframe src="/ui/versus_view.html?${q}" style="flex:1;border:0"></iframe>`;
  o.querySelector("button").onclick = () => o.remove();
  document.body.appendChild(o);
}
function vsDrawTeamStage(box) {
  if (!vs.auto) return vsDrawDuelStage(box);
  vsTeamTagsWant();
  const boss = vsBossSide();
  const nl = vsTeamSide("left").length, nr = vsTeamSide("right").length;
  const member = (k, id, i) => {
    const c = vsChar(id), isBoss = boss === k, tg = vs.tags && vs.tags[id];
    const roles = (tg ? tg.unit : []).filter((r) => r !== "universal" || tg.unit.length === 1);
    const marks = (isBoss ? [`<span class="vsrole boss" title="${esc(VS_ROLE.boss[2])}">★ boss</span>`] : [])
      .concat(roles.map((r) => `<span class="vsrole" title="${esc(VS_ROLE[r][1] + ": " + VS_ROLE[r][2])}">${VS_ROLE[r][0]} ${VS_ROLE[r][1]}</span>`)).join("");
    const sk = tg ? Object.entries(tg.skills).filter(([, v]) => v.length).map(([g, v]) => `${(g.match(/S\d+/) || [g])[0]}: ${v.join("+")}`).join(" · ") : "";
    const ident = c.type === "ids" || c.type === "egos";
    return `<div class="vstm ${isBoss ? "boss" : ""} ${vs.tagEdit && vs.tagEdit.id === id ? "edit" : ""}">
      <img src="${vsIcon(id)}" alt="" data-id="${esc(id)}" onerror="vsImgErr(this)">
      <div class="grow"><b title="${esc(c.label)}">${esc(ident ? c.pg : c.short)}</b><small>${esc(ident ? c.short : (c.group || ""))}</small>
        <div class="vsroles">${marks || `<span class="muted small">…</span>`}${sk ? `<span class="muted small" title="Skills that shoot (range) or hit several (mass)">${esc(sk)}</span>` : ""}</div></div>
      <div class="vstbtn"><button data-tmove="${k}:${i}:-1" title="Earlier: a front slot" ${i ? "" : "disabled"}>◀</button><button data-tmove="${k}:${i}:1" title="Later: a back slot" ${i < vs[k + "s"].length - 1 ? "" : "disabled"}>▶</button>
        <button data-ttag="${esc(id)}" title="Roles and skill tags of this fighter">Tags</button><button data-tdel="${k}:${i}" title="Take out">×</button></div></div>`;
  };
  const panel = (k) => {
    const list = vs[k + "s"], on = vs.side === k;
    return `<div class="vsteamside ${on ? "on" : ""} ${k}" data-tside="${k}">
      <div class="row"><b class="vsh grow">${k === "left" ? "Left" : "Right"} team · ${list.length}${boss === k ? " · BOSS" : ""}</b>
        <button class="toggle ${on ? "on" : ""}" data-tpick="${k}" title="A click in the list on the left adds a fighter to this team">${on ? "Adding here" : "Add here"}</button>
        <button data-tbossfor="${k}" title="Make this side a lone boss: keeps its first fighter and shows the Bosses &amp; Abnormalities list">Boss</button>
        <button data-tdice="${k}" title="Add a random one of the picker's list">🎲</button><button data-tclear="${k}" title="Empty this team" ${list.length ? "" : "disabled"}>Clear</button></div>
      <div class="vstmlist">${list.map((id, i) => member(k, id, i)).join("") || `<div class="muted small" style="padding:18px 6px">Empty. ${on ? "Click a fighter in the list on the left." : "Press “Add here”, then click fighters in the list on the left."}</div>`}</div></div>`;
  };
  const e = vs.tagEdit && vs.tags && vs.tags[vs.tagEdit.id];
  const editor = () => {
    const te = vs.tagEdit, c = vsChar(te.id);
    return `<div class="card vstagedit"><div class="row"><b class="vsh grow">Tags of ${esc(c.label)}</b>${e.auto ? `<span class="muted small">guessed from: ${esc(e.auto)}</span>` : `<span class="muted small">no guess: universal</span>`}</div>
      <div class="vschips"><span class="vslbl">Roles</span>${VS_ROLES.map((r) => `<button class="toggle ${te.unit.includes(r) ? "on" : ""}" data-trole="${r}" title="${esc(VS_ROLE[r][2])}">${VS_ROLE[r][0]} ${VS_ROLE[r][1]}</button>`).join("")}</div>
      <div class="vsskrows">${Object.keys(e.skills).map((g) => `<div class="row"><span class="vslbl" title="${esc(g)}">${esc((g.match(/S\d+/) || [g])[0])}</span>
        ${["range", "mass"].map((t) => `<button class="toggle ${te.skills[g].includes(t) ? "on" : ""}" data-tskill="${esc(g)}:${t}" title="${esc(VS_ROLE[t][2])}">${VS_ROLE[t][0]} ${t}</button>`).join("")}<span class="muted small">${esc(g)}</span></div>`).join("")}</div>
      <div class="row"><button class="primary" id="vstsave">Save</button><button id="vstauto" title="Forget what was set by hand: back to the guess">Back to the guess</button><button id="vstclose">Close</button>
        <span class="muted small">Tags change only the order, timing, targets and movement of a fight, never coin power or HP.</span></div></div>`;
  };
  const status = !nl || !nr ? `<span class="bad">Each team needs at least one fighter.</span>`
    : boss ? `<span><b>★ Boss fight:</b> ${esc(vsChar(vs[boss + "s"][0])?.short || "")} alone against ${boss === "left" ? nr : nl}. Its strength is set to be fair against this team.</span>`
    : `<span class="muted">${nl} vs ${nr}: no boss. A boss is a lone fighter against two or more: press <b>Boss</b> on a side, pick the boss, then add two or more to the other side.</span>`;
  const sp = vs.map && vsPicUrl(vs.map);
  box.innerHTML = `<div class="vsprev vsteamprev vsarena" ${sp ? `style="background-image:url('${sp}')"` : ""}><div class="vsvs">VS</div>
      <div class="vstag">${esc(vs.map ? vsMapLabel(vs.map) : "Plain dark stage")}</div>
      <div class="vsteams">${panel("left")}${panel("right")}</div></div>
    <div class="card vsfight"><span class="vslbl">Boss</span>${status}</div>
    ${e ? editor() : ""}
    <div class="card vsfight"><span class="vslbl">Mode</span><select id="vslanes"><option value="one">Exchanges · one at a time</option><option value="all" ${vs.teamFlow === "all" ? "selected" : ""}>Exchanges · all at once</option><option value="aggro" ${vs.teamFlow === "aggro" ? "selected" : ""}>Aggro · real time</option></select>
      <span class="vslbl">Clashes</span><span class="seg vsstep"><button class="toggle" data-rounds="-1" title="Fewer">−</button><input id="vsrounds" type="number" min="1" max="99" step="1" value="${vs.rounds}" title="Rounds of the fight (it ends after about this many clashes per fighter)"><button class="toggle" data-rounds="1" title="More">+</button></span>
      <span class="vslbl">Winner</span><span class="seg">${[[0, "Left"], [2, "Random"], [1, "Right"]].map(([v, l]) => `<button class="toggle ${vs.winner === v ? "on" : ""}" data-winner="${v}">${l}</button>`).join("")}</span>
      <button id="vsteamview" ${nl && nr ? "" : "disabled"} title="The engine's decisions as a schematic arena played in real time (no render)">Engine view</button>
      <span class="small muted grow" style="min-width:220px">Click fighters in the list on the left to fill the team marked “Adding here”. Render makes the video; Live does not play teams yet.</span></div>`;
  const redraw = () => { vsKeep(); vsDrawPicker(); vsDrawStage(); };
  box.querySelectorAll("[data-tpick]").forEach((b) => b.onclick = () => { vs.side = b.dataset.tpick; vsDrawPicker(); vsDrawStage(); });
  box.querySelectorAll("[data-tside]").forEach((el) => el.onclick = (ev) => { if (!ev.target.closest("button") && vs.side !== el.dataset.tside) { vs.side = el.dataset.tside; vsDrawPicker(); vsDrawStage(); } });
  box.querySelectorAll("[data-tdel]").forEach((b) => b.onclick = () => { const [k, i] = b.dataset.tdel.split(":"); vs[k + "s"].splice(+i, 1); redraw(); });
  box.querySelectorAll("[data-tmove]").forEach((b) => b.onclick = () => {
    const [k, i, d] = b.dataset.tmove.split(":"), l = vs[k + "s"], j = +i + +d;
    if (j >= 0 && j < l.length) { [l[+i], l[j]] = [l[j], l[+i]]; redraw(); }
  });
  box.querySelectorAll("[data-tclear]").forEach((b) => b.onclick = () => { vs[b.dataset.tclear + "s"] = []; redraw(); });
  box.querySelectorAll("[data-tdice]").forEach((b) => b.onclick = () => {
    const list = vsFiltered();
    vs.side = b.dataset.tdice;
    if (list.length) vsTeamAdd(vs.side, list[Math.floor(Math.random() * list.length)].id);
  });
  box.querySelectorAll("[data-tbossfor]").forEach((b) => b.onclick = () => {
    const k = b.dataset.tbossfor, o = k === "left" ? "right" : "left";
    vs[k + "s"] = vs[k + "s"].slice(0, 1);
    vs.side = k; vs.ptype = "boss"; vs.pgroup = ""; vs.q = ""; vs.all = false;
    if (vs[o + "s"].length < 2) toast(`Now pick the boss, then press “Add here” on the ${o} team and add two or more.`);
    redraw();
  });
  box.querySelectorAll("[data-ttag]").forEach((b) => b.onclick = () => {
    const id = b.dataset.ttag, tg = vs.tags && vs.tags[id];
    if (!tg) return;
    vs.tagEdit = vs.tagEdit && vs.tagEdit.id === id ? null : { id, unit: [...tg.unit], skills: Object.fromEntries(Object.entries(tg.skills).map(([g, v]) => [g, [...v]])) };
    vsDrawStage();
  });
  if (e) {
    const te = vs.tagEdit;
    box.querySelectorAll("[data-trole]").forEach((b) => b.onclick = () => {
      const r = b.dataset.trole;
      te.unit = te.unit.includes(r) ? te.unit.filter((x) => x !== r) : [...te.unit.filter((x) => r !== "universal" && x !== "universal"), r];
      if (!te.unit.length) te.unit = ["universal"];
      vsDrawStage();
    });
    box.querySelectorAll("[data-tskill]").forEach((b) => b.onclick = () => {
      const [g, t] = b.dataset.tskill.split(":");
      te.skills[g] = te.skills[g].includes(t) ? te.skills[g].filter((x) => x !== t) : [...te.skills[g], t];
      vsDrawStage();
    });
    const send = async (body) => {
      await api("/api/versus_tags", Object.assign({ id: te.id }, body)).then((r) => { vs.over = r.over || {}; }).catch((er) => toast(esc(er.message)));
      delete vs.tags[te.id]; vs.tagEdit = null;
      await vsTeamTagsWant(); vsDrawStage();
    };
    $("#vstsave").onclick = () => send({ unit: te.unit, skills: Object.fromEntries(Object.entries(te.skills).map(([g, v]) => [g, v.length ? v : "melee"])) });
    $("#vstauto").onclick = () => send({});
    $("#vstclose").onclick = () => { vs.tagEdit = null; vsDrawStage(); };
  }
  $("#vslanes").onchange = (ev) => { vs.teamFlow = ev.target.value; vsKeep(); };
  $("#vsteamview").onclick = vsTeamView;
  box.querySelectorAll("[data-winner]").forEach((b) => b.onclick = () => { vs.winner = +b.dataset.winner; vsDrawStage(); });
  const setRounds = (n) => { vs.rounds = Math.max(1, Math.min(99, Math.round(+n) || 1)); $("#vsrounds").value = vs.rounds; vsKeep(); };
  $("#vsrounds").onchange = (ev) => setRounds(ev.target.value);
  box.querySelectorAll("[data-rounds]").forEach((b) => b.onclick = () => setRounds(vs.rounds + +b.dataset.rounds));
}
// ---- Versus, "Team": the simple team fight, no autobattler logic: the k-th of the left team fights the k-th of the right (the same
// slot across, or drawn), every pair its own one-on-one, all at the same time (the engine: flow "duels"). The roles, cooldowns, boss
// and the rest are the Auto Battler tab's.
function vsDrawDuelStage(box) {
  const nl = vsTeamSide("left").length, nr = vsTeamSide("right").length, even = nl === nr && nl > 0;
  const member = (k, id, i) => {
    const c = vsChar(id), ident = c.type === "ids" || c.type === "egos";
    const mate = vs[(k === "left" ? "right" : "left") + "s"][i];
    return `<div class="vstm ${mate === undefined && nl !== nr ? "idle" : ""}"><span class="vsslot">${i + 1}</span>
      <img src="${vsIcon(id)}" alt="" data-id="${esc(id)}" onerror="vsImgErr(this)">
      <div class="grow"><b title="${esc(c.label)}">${esc(ident ? c.pg : c.short)}</b><small>${esc(ident ? c.short : (c.group || ""))}</small>
        ${vs.pairs === "random" ? "" : mate !== undefined ? `<small>vs ${esc(vsChar(mate)?.short || "")}</small>` : `<small>no opponent across</small>`}</div>
      <div class="vstbtn"><button data-tmove="${k}:${i}:-1" title="Earlier slot" ${i ? "" : "disabled"}>◀</button><button data-tmove="${k}:${i}:1" title="Later slot" ${i < vs[k + "s"].length - 1 ? "" : "disabled"}>▶</button>
        <button data-tdel="${k}:${i}" title="Take out">×</button></div></div>`;
  };
  const panel = (k) => {
    const list = vs[k + "s"], on = vs.side === k;
    return `<div class="card vsteamside ${on ? "on" : ""} ${k}" data-tside="${k}">
      <div class="row"><b class="vsh grow">${k === "left" ? "Left" : "Right"} team · ${list.length}</b>
        <button class="toggle ${on ? "on" : ""}" data-tpick="${k}" title="A click in the list on the left adds a fighter to this team">${on ? "Adding here" : "Add here"}</button>
        <button data-tdice="${k}" title="Add a random one of the picker list">🎲</button><button data-tclear="${k}" title="Empty this team" ${list.length ? "" : "disabled"}>Clear</button></div>
      <div class="vstmlist">${list.map((id, i) => member(k, id, i)).join("") || `<div class="muted small" style="padding:18px 6px">Empty. ${on ? "Click a fighter in the list on the left." : "Press “Add here”, then click fighters in the list on the left."}</div>`}</div></div>`;
  };
  const status = !nl || !nr ? `<span class="bad">Each team needs at least one fighter.</span>`
    : even ? `<span>${nl} duels at the same time: ${vs.pairs === "random" ? "the opponents are drawn when it is rendered." : "each fighter against the one in the same slot across."}</span>`
    : `<span class="bad">${nl} vs ${nr}: duels need the same number on both sides.</span> <span class="muted">Uneven fights (the bigger team has the advantage) come with their own rules; for now add or take out fighters, or use the Auto Battler tab (roles, cooldowns, a boss).</span>`;
  const sp = vs.map && vsPicUrl(vs.map);
  box.innerHTML = `<div class="vsprev vsteamprev" ${sp ? `style="background-image:url('${sp}')"` : ""}><div class="vsvs">TEAM</div>
      <div class="vstag">${esc(vs.map ? vsMapLabel(vs.map) : "Plain dark stage")}</div></div>
    <div class="vsteams">${panel("left")}${panel("right")}</div>
    <div class="card vsfight">${status}</div>
    <div class="card vsfight"><span class="vslbl">Opponents</span><span class="seg">${[["slot", "Same slot"], ["random", "Drawn"]].map(([v, l]) => `<button class="toggle ${(vs.pairs || "slot") === v ? "on" : ""}" data-pairs="${v}">${l}</button>`).join("")}</span>
      <span class="vslbl">Clashes</span><span class="seg vsstep"><button class="toggle" data-rounds="-1" title="Fewer">−</button><input id="vsrounds" type="number" min="1" max="99" step="1" value="${vs.rounds}" title="How many clashes each duel has"><button class="toggle" data-rounds="1" title="More">+</button></span>
      <span class="vslbl">Winner</span><span class="seg">${[[0, "Left"], [2, "Random"], [1, "Right"]].map(([v, l]) => `<button class="toggle ${vs.winner === v ? "on" : ""}" data-winner="${v}">${l}</button>`).join("")}</span>
      <button id="vsteamview" ${even ? "" : "disabled"} title="The engine's decisions as a schematic arena played in real time (no render)">Engine view</button>
      <span class="small muted grow" style="min-width:220px">Click fighters in the list on the left to fill the team marked “Adding here”. Render makes the video; Live does not play teams yet.</span></div>`;
  const redraw = () => { vsKeep(); vsDrawPicker(); vsDrawStage(); };
  box.querySelectorAll("[data-tpick]").forEach((b) => b.onclick = () => { vs.side = b.dataset.tpick; vsDrawPicker(); vsDrawStage(); });
  box.querySelectorAll("[data-tside]").forEach((el) => el.onclick = (ev) => { if (!ev.target.closest("button") && vs.side !== el.dataset.tside) { vs.side = el.dataset.tside; vsDrawPicker(); vsDrawStage(); } });
  box.querySelectorAll("[data-tdel]").forEach((b) => b.onclick = () => { const [k, i] = b.dataset.tdel.split(":"); vs[k + "s"].splice(+i, 1); redraw(); });
  box.querySelectorAll("[data-tmove]").forEach((b) => b.onclick = () => {
    const [k, i, d] = b.dataset.tmove.split(":"), l = vs[k + "s"], j = +i + +d;
    if (j >= 0 && j < l.length) { [l[+i], l[j]] = [l[j], l[+i]]; redraw(); }
  });
  box.querySelectorAll("[data-tclear]").forEach((b) => b.onclick = () => { vs[b.dataset.tclear + "s"] = []; redraw(); });
  box.querySelectorAll("[data-tdice]").forEach((b) => b.onclick = () => {
    const list = vsFiltered();
    vs.side = b.dataset.tdice;
    if (list.length) vsTeamAdd(vs.side, list[Math.floor(Math.random() * list.length)].id);
  });
  box.querySelectorAll("[data-pairs]").forEach((b) => b.onclick = () => { vs.pairs = b.dataset.pairs; vsKeep(); vsDrawStage(); });
  $("#vsteamview").onclick = vsTeamView;
  box.querySelectorAll("[data-winner]").forEach((b) => b.onclick = () => { vs.winner = +b.dataset.winner; vsDrawStage(); });
  const setRounds = (n) => { vs.rounds = Math.max(1, Math.min(99, Math.round(+n) || 1)); $("#vsrounds").value = vs.rounds; vsKeep(); };
  $("#vsrounds").onchange = (ev) => setRounds(ev.target.value);
  box.querySelectorAll("[data-rounds]").forEach((b) => b.onclick = () => setRounds(vs.rounds + +b.dataset.rounds));
}
// ---- team rules (Debug): the engine's TEAM numbers the page may change; vs.rules keeps only what differs from the defaults
const VS_RULE_FIELDS = [
  ["Kills", [["freeze", "Others stop while a fatal blow plays", "bool"]]],
  ["Exchanges", [["exchange:0", "Clashes in an engagement: at least", "num", 1], ["exchange:1", "at most", "num", 1]]],
  ["Boss", [["boss_streak", "Clashes it wins in a row, at most", "num", 1], ["interrupt_p", "Chance a blow cuts its landing short", "num", 0.05], ["boss_hp", "HP: a one-on-one fighter's × this × the number against it", "num", 0.05]]],
  ["Stage", [["wall", "Half width of the stage (body heights)", "num", 0.5]]],
];
async function vsDrawTeamRules() {
  const box = $("#vsrules");
  if (!box) return;
  if (!vs.team || !vs.auto) { box.innerHTML = ""; return; }
  if (!vs.rulesDef) { vs.rulesDef = await api("/api/versus_team_rules").catch(() => null); if (!vs.rulesDef) return; }
  vs.rules = vs.rules || {};
  const def = vs.rulesDef.defaults;
  const get = (key) => {
    const [k, i] = key.split(":");
    const v = k in vs.rules ? vs.rules[k] : def[k];
    return i === undefined ? v : v[+i];
  };
  const set = (key, val) => {
    const [k, i] = key.split(":");
    let v = JSON.parse(JSON.stringify(k in vs.rules ? vs.rules[k] : def[k]));
    if (i === undefined) v = val;
    else if (k === "cooldown") { const [role, j] = i.split("."); v[role][+j] = val; }
    else v[+i] = val;
    if (JSON.stringify(v) === JSON.stringify(def[k])) delete vs.rules[k]; else vs.rules[k] = v;
    vsKeep(); vsDrawTeamRules();
  };
  const mark = (key) => (key.split(":")[0] in vs.rules ? ' style="color:var(--gold)"' : "");
  const roles = Object.keys(def.cooldown);
  box.innerHTML = `<div class="vslbl" style="margin:12px 0 6px" title="The team engine's numbers (limbusdm/versus_team.py TEAM). They apply to the Engine view and the render; gold = changed">Team rules ${Object.keys(vs.rules).length ? `<small class="muted">(${Object.keys(vs.rules).length} changed)</small>` : ""}</div>
    ${VS_RULE_FIELDS.map(([title, fields]) => `<div class="vsrule"><b class="small">${title}</b>${fields.map(([key, label, type, step]) => type === "bool"
      ? `<label class="small"${mark(key)}><input type="checkbox" data-rule="${key}" ${get(key) ? "checked" : ""}> ${label}</label>`
      : `<label class="small"${mark(key)}>${label} <input type="number" step="${step}" data-rule="${key}" value="${get(key)}"></label>`).join("")}</div>`).join("")}
    <div class="vsrule"><b class="small">Cooldown after an action (s, from – to)</b>${roles.map((r) => `<label class="small"${mark("cooldown")}>${r}
      <input type="number" step="0.1" data-cd="${r}.0" value="${get("cooldown")[r][0]}"> – <input type="number" step="0.1" data-cd="${r}.1" value="${get("cooldown")[r][1]}"></label>`).join("")}</div>
    <button id="vsrulesreset" ${Object.keys(vs.rules).length ? "" : "disabled"}>Reset team rules</button>`;
  box.querySelectorAll("[data-rule]").forEach((el) => el.onchange = () => set(el.dataset.rule, el.type === "checkbox" ? el.checked : +el.value));
  box.querySelectorAll("[data-cd]").forEach((el) => el.onchange = () => set("cooldown:" + el.dataset.cd, +el.value));
  $("#vsrulesreset").onclick = () => { vs.rules = {}; vsKeep(); vsDrawTeamRules(); };
}
// ---- the picker
function vsDrawPicker(keepGrid) {
  const box = $("#vspick");
  if (!box) return;
  const chars = vsChars();
  const name = (k) => vs.team ? String(vsTeamSide(k).length) : esc(vsChar(vs[k])?.short || "—");
  const seasons = [...new Set(chars.filter((c) => c.season).map((c) => c.season))]
    .sort((a, b) => (a === "8000") - (b === "8000") || (a === "9100") - (b === "9100") || +a - +b);
  const sLabel = (s) => s === "9100" ? "Walpurgis" : s === "8000" ? "Collab" : s === "0" ? "Base" : `S${s}`;
  const groups = [...new Set(chars.filter((c) => c.type === "enemy" || c.type === "boss").filter((c) => vs.ptype === "all" || c.type === vs.ptype).map((c) => c.pg))];
  const recent = vs.recent.map(vsChar).filter(Boolean).slice(0, 8);
  box.innerHTML = `<div class="row" style="gap:8px"><span class="vslbl">${vs.team ? "Adding to" : "Picking for"}</span><span class="seg">
      <button class="toggle ${vs.side === "left" ? "on" : ""}" data-pside="left" title="${vs.team ? "A click below adds a fighter to the left team" : "A click below picks the left one"}">Left${vs.team ? " team" : ""} · ${name("left")}</button>
      <button class="toggle ${vs.side === "right" ? "on" : ""}" data-pside="right" title="${vs.team ? "A click below adds a fighter to the right team" : "A click below picks the right one"}">Right${vs.team ? " team" : ""} · ${name("right")}</button></span></div>
    <input type="search" id="vsq" placeholder="Search everyone: name, Identity, enemy, Canto…" value="${esc(vs.q || "")}">
    <div class="vschips">${VS_TYPES.map(([k, l]) => `<button class="toggle ${vs.ptype === k ? "on" : ""}" data-ptype="${k}">${l}</button>`).join("")}</div>
    ${vsHasSinner() ? `${seasons.length ? `<div class="vschips"><span class="vslbl">Season</span><button class="toggle ${vs.pseason ? "" : "on"}" data-pseason="">All</button>${seasons.map((s) =>
        `<button class="toggle ${vs.pseason === s ? "on" : ""}" data-pseason="${s}" title="${esc((typeof seasonInfo === "function" && seasonInfo(+s)?.name) || "")}">${sLabel(s)}</button>`).join("")}</div>` : ""}
      <div class="vssinners"><button class="${vs.psinner ? "" : "on"}" data-psinner="0" title="Every Sinner"><span class="vsall">All</span></button>${anim.data.sinners.map((s) =>
        `<button class="${vs.psinner === s.sid ? "on" : ""}" data-psinner="${s.sid}" title="${esc(s.name)}">${ico(`sinner_${s.sid}`, "", s.name, s.name.slice(0, 2))}<span>${esc(s.name)}</span></button>`).join("")}</div>` : ""}
    ${vsHasGroup() ? `<label class="small row" style="gap:6px">Where <select id="vspgroup" style="flex:1"><option value="">Every Canto, event and dungeon</option>${groups.map((g) =>
        `<option ${vs.pgroup === g ? "selected" : ""}>${esc(g)}</option>`).join("")}</select></label>` : ""}
    ${recent.length ? `<div class="vsrecent"><span class="vslbl">Recent</span>${recent.map((c) =>
        `<button class="toggle" data-pick="${esc(c.id)}" title="${esc(c.label)}"><img src="${vsIcon(c.id)}" alt="" data-id="${esc(c.id)}" onerror="vsImgErr(this)">${esc(c.short)}</button>`).join("")}</div>` : ""}
    <div class="row small muted" id="vscount"></div>
    <div class="vsgrid" id="vsgrid"></div>
    <button id="vsprand" title="A random one of the list above, for the side picked for">🎲 Random from this list</button>`;
  box.querySelectorAll("[data-pside]").forEach((b) => b.onclick = () => { vs.side = b.dataset.pside; vsDrawPicker(); vsDrawStage(); });
  box.querySelectorAll("[data-ptype]").forEach((b) => b.onclick = () => { vs.ptype = b.dataset.ptype; vs.pgroup = ""; vs.all = false; vsDrawPicker(); });
  box.querySelectorAll("[data-pseason]").forEach((b) => b.onclick = () => { vs.pseason = b.dataset.pseason; vs.all = false; vsDrawPicker(); });
  box.querySelectorAll("[data-psinner]").forEach((b) => b.onclick = () => { vs.psinner = +b.dataset.psinner; vs.all = false; vsDrawPicker(); });
  box.querySelectorAll("[data-pick]").forEach((b) => b.onclick = () => vsPick(vs.side, b.dataset.pick));
  if ($("#vspgroup")) $("#vspgroup").onchange = (e) => { vs.pgroup = e.target.value; vs.all = false; vsDrawPicker(); };
  $("#vsq").oninput = (e) => { vs.q = e.target.value; vs.all = false; vsDrawGrid(); };
  $("#vsq").onkeydown = (e) => { if (e.key === "Enter") { const f = vsFiltered()[0]; if (f) vsPick(vs.side, f.id); } };
  $("#vsprand").onclick = () => {
    const list = vsFiltered();
    if (list.length) vsPick(vs.side, list[Math.floor(Math.random() * list.length)].id);
  };
  vsDrawGrid();
}
const VS_GRID_MAX = 160;
function vsDrawGrid() {
  const grid = $("#vsgrid");
  if (!grid) return;
  const list = vsFiltered(), q = (vs.q || "").trim();
  const shown = vs.all ? list : list.slice(0, VS_GRID_MAX);
  const other = vs[vs.side === "left" ? "right" : "left"];
  const mine = vs.team ? vsTeamSide(vs.side) : [], theirs = vs.team ? vsTeamSide(vs.side === "left" ? "right" : "left") : [];
  $("#vscount").innerHTML = `<span class="grow">${list.length} ${q ? "found (everyone)" : "in this list"}</span>`;
  grid.innerHTML = shown.map((c) => `<button class="vsicon ${vs.team ? (mine.includes(c.id) ? "on" : theirs.includes(c.id) ? "other" : "") : c.id === vs[vs.side] ? "on" : c.id === other ? "other" : ""}" data-id="${esc(c.id)}" title="${esc(c.label)}${c.type === "enemy" || c.type === "boss" ? " — " + esc(c.group) : ""}">
      <img loading="lazy" src="${vsIcon(c.id)}" alt="" data-id="${esc(c.id)}" onerror="vsImgErr(this)"><span>${esc(q || !vs.psinner || !vsHasSinner() ? c.label : c.short)}</span></button>`).join("")
    + (shown.length < list.length ? `<button class="vsmore" id="vsmore">Show all ${list.length}</button>` : "")
    || `<div class="muted small">Nobody.</div>`;
  grid.querySelectorAll(".vsicon").forEach((b) => b.onclick = () => vsPick(vs.side, b.dataset.id));
  if ($("#vsmore")) $("#vsmore").onclick = () => { vs.all = true; vsDrawGrid(); };
}
// ---- a side's skills (its last skill: a fixed one, or one drawn at random)
async function vsSkills(k) {
  const id = vs[k];
  const key = k === "left" ? "skill" : "rskill";
  let r;
  try { r = await api(`/api/skills?id=${encodeURIComponent(id)}`); } catch (e) { vs.skl[k] = { id, err: e.message, list: [] }; vsDrawStage(); return; }
  if (vs[k] !== id) return;  // (picked again meanwhile)
  const list = r.skills.filter((n) => !/(^|_)(Parrying|Duel_?Win|Dead|Retreat)(_|$)/i.test(n));  // not "Yisang_DeadButterfly_S1"
  if (!list.includes(vs[key])) vs[key] = list[0] || "";
  vs.skl[k] = { id, list, slots: r.slots, clash: r.clash };
  vsKeep();
  vsDrawStage();
}
// ---- the middle: start frame, the two, the fight
function vsDrawStage() {
  const box = $("#vsstage");
  if (!box) return;
  if (vs.team) return vsDrawTeamStage(box);
  const clash = vs.mode === "clash";
  const nameOf = (k) => {
    const c = vsChar(vs[k]);
    if (!c) return ["—", ""];
    return c.type === "ids" || c.type === "egos" ? [c.pg, c.short] : [c.short, c.group];
  };
  const pic = (k) => {
    const fig = vsFigUrl(vs[k]), wait = !fig && vs.figs && vs.figs.busy && !vs.figs.failed.has(String(vs[k]));
    return `<button class="vsfig ${k}" data-side="${k}" title="Pick the ${k} one in the picker">${fig
      ? `<img class="fig" src="${fig}" alt="" data-id="${esc(vs[k])}" onerror="this.className='pic';vsImgErr(this)">`
      : `<img class="pic" src="${vsIcon(vs[k])}" alt="" data-id="${esc(vs[k])}" onerror="vsImgErr(this)">${wait ? `<span class="vsdrawing">drawing its pose…</span>` : ""}`}</button>`;
  };
  const chips = (k) => {
    const s = vs.skl[k], key = k === "left" ? "skill" : "rskill", rk = k[0] + "rand";
    if (!clash && k === "right") return `<span class="muted small">Takes the hits in its own poses.</span>`;
    if (!s || s.id !== vs[k]) return `<span class="muted small">…</span>`;
    if (s.err) return `<span class="bad small">${esc(s.err)}</span>`;
    const rand = clash && vs[rk];
    const main = s.list.filter((n) => /_S\d+$|^SkillViewEGO_/i.test(n)), more = s.list.filter((n) => !main.includes(n));
    return (clash ? `<button class="toggle ${rand ? "on" : ""}" data-srand="${k}" title="Its last skill: a random one of its own">Random</button>` : "")
      + main.map((n) => `<button class="toggle ${!rand && n === vs[key] ? "on" : ""}" data-skill="${k}" data-n="${esc(n)}" title="${esc(n)}">${esc(fxLabel(n, s.slots))}</button>`).join("")
      + (more.length ? `<select class="vsmoresk ${!rand && more.includes(vs[key]) ? "on" : ""}" data-skillsel="${k}" title="Its other timelines"><option value="">${more.length} more…</option>${more.map((n) =>
        `<option value="${esc(n)}" ${!rand && n === vs[key] ? "selected" : ""}>${esc(fxLabel(n, s.slots))}</option>`).join("")}</select>` : "")
      + (s.clash || !clash ? "" : `<span class="bad small" title="It has no clash animation of its own">no clash animation</span>`);
  };
  const card = (k) => {
    const [n, sub] = nameOf(k);
    return `<div class="card vscard ${vs.side === k ? "on" : ""}" data-side="${k}">
      <img src="${vsIcon(vs[k])}" alt="" data-id="${esc(vs[k])}" onerror="vsImgErr(this)">
      <div class="grow" style="min-width:0"><div class="vslbl">${k === "left" ? "Left" : "Right"} · ${vs.side === k ? "picking" : "click to pick"}</div>
        <b class="vscname" title="${esc(vsChar(vs[k])?.label || "")}">${esc(n)}${sub ? ` · <span>${esc(sub)}</span>` : ""}</b>
        <div class="vsskills">${chips(k)}</div></div>
      <button class="vsdice" data-rand="${k}" title="A random one of the picker's list">🎲</button></div>`;
  };
  const [ln, lsub] = nameOf("left"), [rn, rsub] = nameOf("right");
  const track = (vs.bgm || []).find((m) => m.name === vs.music);
  const sp = vs.map && vsPicUrl(vs.map);
  box.innerHTML = `<div class="vsprev" ${sp ? `style="background-image:url('${sp}')"` : ""}>${pic("left")}${pic("right")}
      <div class="vsvs">VS</div>
      <div class="vsname l"><b>${esc(ln)}</b><span>${esc(lsub)}</span></div>
      <div class="vsname r"><b>${esc(rn)}</b><span>${esc(rsub)}</span></div>
      <div class="vstag">${esc(vs.map ? vsMapLabel(vs.map) : "Plain dark stage")}${track ? ` · ♪ ${esc(vsTrackLabel(track))}` : ""}</div>
      <button id="vsswap" title="Left and right change places (with their skills)">⇄ Swap</button></div>
    <div class="vscards">${card("left")}${card("right")}</div>
    <div id="vsgoslot"></div>
    <div class="card vsfight"><span class="seg"><button class="toggle ${clash ? "on" : ""}" data-mode="clash">Clash fight</button><button class="toggle ${clash ? "" : "on"}" data-mode="target">Right takes the hits</button></span>
      ${clash ? `<span class="vslbl">Clashes</span><span class="seg vsstep"><button class="toggle" data-rounds="-1" title="Fewer">−</button><input id="vsrounds" type="number" min="1" max="99" step="1" value="${vs.rounds}" title="How many clashes the fight has (with Exchanges: about how long the fight lasts — HP is scaled to it)"><button class="toggle" data-rounds="1" title="More">+</button></span>
        <span class="vslbl">Winner</span><span class="seg">${[[0, "Left"], [2, "Random"], [1, "Right"]].map(([v, l]) => `<button class="toggle ${vs.winner === v ? "on" : ""}" data-winner="${v}">${l}</button>`).join("")}</span>` : ""}
      <span class="small muted grow" style="min-width:220px">${clash ? "The fight engine decides it all from the game's skill data: clashes, guards, counters, knockback; then the winner's last skill."
        : "The left one's skill hits the right one, who stands in its own idle pose and reacts to every hit."}</span></div>`;
  box.querySelectorAll("[data-side]").forEach((el) => el.onclick = (e) => {
    if (e.target.closest("button.toggle, .vsdice, select")) return;
    vs.side = el.dataset.side; vsDrawPicker(); vsDrawStage();
  });
  box.querySelectorAll("[data-rand]").forEach((b) => b.onclick = () => {
    const list = vsFiltered().filter((c) => c.id !== vs[b.dataset.rand]);
    const any = list.length ? list : vsChars();
    vsPick(b.dataset.rand, any[Math.floor(Math.random() * any.length)].id);
  });
  box.querySelectorAll("[data-srand]").forEach((b) => b.onclick = () => { vs[b.dataset.srand[0] + "rand"] = true; vsDrawStage(); });
  box.querySelectorAll("[data-skillsel]").forEach((sel) => sel.onchange = () => {
    const k = sel.dataset.skillsel;
    if (!sel.value) return;
    vs[k === "left" ? "skill" : "rskill"] = sel.value;
    vs[k[0] + "rand"] = false;
    vsDrawStage();
  });
  box.querySelectorAll("[data-skill]").forEach((b) => b.onclick = () => {
    const k = b.dataset.skill;
    vs[k === "left" ? "skill" : "rskill"] = b.dataset.n;
    vs[k[0] + "rand"] = false;
    vsDrawStage();
  });
  $("#vsswap").onclick = () => {
    [vs.left, vs.right] = [vs.right, vs.left]; [vs.skill, vs.rskill] = [vs.rskill, vs.skill]; [vs.lrand, vs.rrand] = [vs.rrand, vs.lrand];
    [vs.skl.left, vs.skl.right] = [vs.skl.right, vs.skl.left];
    vsDrawPicker(); vsDrawStage();
  };
  box.querySelectorAll("[data-mode]").forEach((b) => b.onclick = () => { vs.mode = b.dataset.mode; vsDrawStage(); vsDrawRight(); liveWatch(); });
  box.querySelectorAll("[data-winner]").forEach((b) => b.onclick = () => { vs.winner = +b.dataset.winner; vsDrawStage(); });
  const setRounds = (n) => { vs.rounds = Math.max(1, Math.min(99, Math.round(+n) || 1)); $("#vsrounds").value = vs.rounds; };
  if ($("#vsrounds")) {
    $("#vsrounds").onchange = (e) => setRounds(e.target.value);
    box.querySelectorAll("[data-rounds]").forEach((b) => b.onclick = () => setRounds(vs.rounds + +b.dataset.rounds));
  }
}
// a list scrolled to its picked row (only the list: the page stays where it is)
// The right column is one panel with tabs — Stage / Music / Options — and each tab says what is picked. vsDrawRight
// draws the three sections as before (their ids and handlers stay); this puts them under the tabs.
const VS_TABS = [["stage", "Stage"], ["music", "Music"], ["options", "Options"]];
function vsTabs() {
  const box = $("#vsright");
  const secs = box ? [...box.querySelectorAll(":scope > section.vsside")] : [];
  if (secs.length !== 3) return;
  const wrap = document.createElement("div");
  wrap.className = "vstabbox";
  wrap.innerHTML = `<div class="vstabs">${VS_TABS.map(([k, name]) => `<button class="vstab" data-rtab="${k}"><b>${name}</b><small></small></button>`).join("")}</div>`;
  box.insertBefore(wrap, secs[0]);
  secs.forEach((sec, i) => {
    sec.classList.remove("card");
    sec.dataset.rtabof = VS_TABS[i][0];
    wrap.appendChild(sec);
    // the search and the random pick share a line
    const q = sec.querySelector("input[type=search]"), dice = sec.querySelector("#vsmaprand, #vsmusicrand");
    if (q && dice) {
      const line = document.createElement("div");
      line.className = "vsqline";
      q.before(line);
      line.append(q, dice);
      dice.textContent = "🎲 Random";
    }
  });
  secs[0].insertAdjacentHTML("afterbegin", `<div class="vsbig" id="vsbig"><b></b></div>`);
  wrap.querySelectorAll("[data-rtab]").forEach((b) => b.onclick = () => { vs.rtab = b.dataset.rtab; vsKeep(); vsTabsDraw(); });
  wrap.addEventListener("click", () => setTimeout(vsTabsDraw, 0));  // (a pick inside changes what the tabs say)
  vsTabsDraw();
}
function vsTabsDraw() {
  const wrap = document.querySelector(".vstabbox");
  if (!wrap) return;
  const tab = VS_TABS.some(([k]) => k === vs.rtab) ? vs.rtab : "stage";
  const track = (vs.bgm || []).find((m) => m.name === vs.music);
  const now = { stage: vs.map ? vsMapLabel(vs.map) : "Plain dark", music: track ? vsTrackLabel(track) : "None", options: `${VS_SHOW.filter((k) => vs[k]).length} on` };
  wrap.querySelectorAll("[data-rtab]").forEach((b) => { b.classList.toggle("on", b.dataset.rtab === tab); b.querySelector("small").textContent = now[b.dataset.rtab]; });
  wrap.querySelectorAll("[data-rtabof]").forEach((sec) => { sec.hidden = sec.dataset.rtabof !== tab; });
  const big = $("#vsbig"), pic = vs.map && vsPicUrl(vs.map);
  if (big) { big.style.backgroundImage = pic ? `url('${pic}')` : ""; big.querySelector("b").textContent = now.stage; }
}
// Render and Live stand between the fighters' cards and the fight's row on a duel's page (#vsgoslot); the right column
// draws them, so they are moved there after either is drawn (and back to the column when the page has no such place)
const VS_GO = [".vsgo", "#vsprog", "#vsnote"];
function vsGoPlace(kept) {
  const slot = $("#vsgoslot"), right = document.querySelector(".vsright");
  VS_GO.forEach((sel, i) => {
    const el = (right && right.querySelector(`:scope > ${sel}`)) || (kept && kept[i]);
    if (el && (slot || right)) (slot || right).appendChild(el);
  });
}
{
  const stage = vsDrawStage, right = vsDrawRight;
  vsDrawStage = function () {
    const kept = VS_GO.map((sel) => document.querySelector(`#vsgoslot > ${sel}`));
    kept.forEach((el) => el && el.remove());
    const r = stage.apply(this, arguments);
    vsGoPlace(kept);
    return r;
  };
  vsDrawRight = function () {
    const r = right.apply(this, arguments);
    document.querySelectorAll("#vsgoslot > *").forEach((el) => el.remove());
    vsGoPlace();
    vsTabs();
    return r;
  };
}
function vsScrollTo(list) {
  const on = list && list.querySelector(".on");
  if (on) list.scrollTop = on.offsetTop - list.offsetTop - list.clientHeight / 2 + on.offsetHeight / 2;
}
// the picked stage without a picture: the player makes it (a few seconds)
function vsPicWant() {
  if (vs.map && vs.pics && !vs.pics.have.has(vs.map) && !vs.pics.failed.has(vs.map)) vsPicsMake([vs.map]);
}
// ---- the right: stage, music, what to show, Debug, Render / Live
const vsAudio = new Audio();
function vsDrawRight() {
  const box = $("#vsright");
  if (!box) return;
  const clash = vs.mode === "clash" || vs.team;
  const dbg = vs.team ? VS_DEBUG.filter((k) => k !== "pace" && k !== "loop") : VS_DEBUG;
  box.innerHTML = `<section class="card vsside"><div class="row"><b class="vsh grow">Stage</b><button id="vsmaprand" title="A random stage">🎲</button></div>
      <input type="search" id="vsmapq" placeholder="Search stages…"><div class="row small muted" id="vspicnote"></div><div class="vsrows vsmaprows" id="vsmaps"></div></section>
    <section class="card vsside"><div class="row"><b class="vsh grow">Music</b><button id="vsmusicrand" title="A random battle track">🎲</button></div>
      <input type="search" id="vsmusicq" placeholder="Search tracks, Cantos…"><div class="vsrows" id="vstracks"></div></section>
    <section class="card vsside"><b class="vsh">Show</b><div class="vschips">${VS_SHOW.map((k) => {
      const [, label, tip] = VS_EXTRAS.find(([x]) => x === k);
      return `<button class="toggle ${vs[k] ? "on" : ""}" data-x="${k}" title="${esc(tip)}">${vs[k] ? "✓" : "+"} ${label}</button>`;
    }).join("")}</div>${VS_BUFF_KINDS.filter(([p]) => vs[p]).map(([p, title]) => `<div class="vsbuff"><b class="small">${title}</b>${VS_BUFF.map(([k, name, off, on]) => {
      const tip = VS_EXTRAS.find(([x]) => x === p + k)[2];
      return `<div class="row"><span class="small muted">${name}</span><div class="seg" title="${esc(tip)}"><button class="toggle ${vs[p + k] ? "" : "on"}" data-bx="${p + k}" data-v="">${off}</button><button class="toggle ${vs[p + k] ? "on" : ""}" data-bx="${p + k}" data-v="1">${on}</button></div></div>`;
    }).join("")}</div>`).join("")}</section>
    <details class="card vsside vsdbg" id="vsdbg" ${vs.debug ? "open" : ""}><summary><b>Debug &amp; engine</b> <span id="vsdbgn" class="small muted"></span></summary>
      ${clash ? `<div class="vschips" style="margin-top:8px">${dbg.map((k) => {
        const [, label, tip] = VS_EXTRAS.find(([x]) => x === k);
        return `<button class="toggle ${vs[k] ? "on" : ""}" data-x="${k}" title="${esc(tip)}">${vs[k] ? "✓" : "+"} ${label}</button>`;
      }).join("")}${vs.team ? "" : `<button id="vsview" title="Test: the fight engine's decisions for these two as a step-by-step schematic arena (no render)">Engine view</button>`}</div>
      <div id="vsbase"></div><div id="vsrules"></div>` : `<div class="small muted" style="margin-top:8px">Clash fights only.</div>`}</details>
    <div class="vsgo"><button id="vslivego" class="vslive" ${clash && !vs.team ? "" : "disabled"} title="${vs.team ? "Live does not play team fights yet" : clash ? "The same fight played live in a window of its own, nothing saved" : "Live plays clash fights"}"><i></i>Live</button>
      <button id="vslivestop" hidden>■ Stop</button>
      <button id="vsgo" class="primary vsrender">▶ Render the fight</button></div>
    <div id="vsprog"></div><div id="vsnote" class="muted small"></div>`;
  // stage
  const drawMaps = () => {
    const q = $("#vsmapq").value.trim().toLowerCase();
    const list = (vs.maps || []).filter((m) => !q || (m + " " + vsMapLabel(m)).toLowerCase().includes(q));
    $("#vsmaps").innerHTML = (q ? "" : `<button class="vsrow ${vs.map ? "" : "on"}" data-map="">None (plain dark)</button>`)
      + list.map((m) => `<button class="vsrow ${vs.map === m ? "on" : ""}" data-map="${esc(m)}" title="${esc(m)}">${vsPicUrl(m)
          ? `<img loading="lazy" src="${vsPicUrl(m)}" alt="">` : `<span class="vsnopic"></span>`}<span>${esc(vsMapLabel(m))}</span></button>`).join("")
      || `<div class="muted small">No stage.</div>`;
    $("#vsmaps").querySelectorAll("[data-map]").forEach((b) => b.onclick = () => { vs.map = b.dataset.map; vsKeep(); drawMaps(); vsDrawStage(); vsPicWant(); });
    vsScrollTo($("#vsmaps"));
    $("#vsmaps").onscroll = vsPicsNear;
    vsPicsNear();
  };
  vsDrawMaps = drawMaps;
  $("#vsmapq").oninput = drawMaps;
  $("#vsmaprand").onclick = () => { const m = vs.maps || []; if (m.length) { vs.map = m[Math.floor(Math.random() * m.length)]; $("#vsmapq").value = ""; drawMaps(); vsDrawStage(); vsPicWant(); } };
  drawMaps();
  vsPicsNote();
  vsPicWant();
  if (vs.pics && vs.pics.busy) vsPicsWatch();
  // music (▶ plays a track here to listen; the corner player pauses)
  const drawTracks = () => {
    const q = $("#vsmusicq").value.trim().toLowerCase();
    const list = (vs.bgm || []).filter((m) => !q || [m.title, m.label, m.where, m.name].join(" ").toLowerCase().includes(q));
    const playing = !vsAudio.paused && vsAudio.dataset.n;
    $("#vstracks").innerHTML = (q ? "" : `<div class="vsrow ${vs.music ? "" : "on"}" data-music=""><span class="grow">None</span></div>`)
      + list.map((m) => `<div class="vsrow ${vs.music === m.name ? "on" : ""}" data-music="${esc(m.name)}" title="${esc(m.label)}">
          ${m.n != null ? `<button class="vsplay" data-play="${m.n}" title="Listen">${playing === String(m.n) ? "■" : "▶"}</button>` : `<span class="vsplay none"></span>`}
          <span class="grow">${esc(vsTrackLabel(m))}${m.where ? ` <span class="muted">· ${esc(m.where)}</span>` : ""}</span></div>`).join("")
      || `<div class="muted small">No track.</div>`;
    $("#vstracks").querySelectorAll("[data-music]").forEach((r) => r.onclick = (e) => {
      if (e.target.closest("[data-play]")) return;
      vs.music = r.dataset.music; vsKeep(); drawTracks(); vsDrawStage();
    });
    $("#vstracks").querySelectorAll("[data-play]").forEach((b) => b.onclick = () => {
      if (!vsAudio.paused && vsAudio.dataset.n === b.dataset.play) vsAudio.pause();
      else {
        if (typeof muAudio !== "undefined") muAudio.pause();
        vsAudio.dataset.n = b.dataset.play;
        vsAudio.src = "/api/music_audio?n=" + b.dataset.play;
        vsAudio.play().catch(() => toast("This track could not be read from the game's files."));
      }
      drawTracks();
    });
  };
  vsAudio.onpause = vsAudio.onplaying = () => { if ($("#vstracks")) drawTracks(); };
  $("#vsmusicq").oninput = drawTracks;
  $("#vsmusicrand").onclick = () => { const all = vs.bgm || []; if (all.length) { vs.music = all[Math.floor(Math.random() * all.length)].name; $("#vsmusicq").value = ""; drawTracks(); vsDrawStage(); } };
  drawTracks();
  vsScrollTo($("#vstracks"));
  // switches
  box.querySelectorAll("[data-x]").forEach((b) => b.onclick = () => { vs[b.dataset.x] = !vs[b.dataset.x]; vsKeep(); vsDrawRight(); });
  box.querySelectorAll("[data-bx]").forEach((b) => b.onclick = () => { vs[b.dataset.bx] = !!b.dataset.v; vsKeep(); vsDrawRight(); });
  $("#vsdbg").ontoggle = (e) => { vs.debug = e.target.open; vsKeep(); };
  drawVsBase();
  vsDrawTeamRules();
  if ($("#vsview")) $("#vsview").onclick = () => {
    const q = new URLSearchParams({ left: vs.left, right: vs.right, rounds: vs.rounds, winner: vs.winner });
    q.set("lname", vsChar(vs.left)?.label || ""); q.set("rname", vsChar(vs.right)?.label || "");
    for (const k of ["lskills", "rskills", "defend", "counter", "bursts"]) q.set(k, vsB(k) ? "1" : "0");
    q.set("burstMax", vsB("burstMax")); q.set("kbscale", vsB("kbscale"));
    if (vs.pace) q.set("pace", "1");
    const o = document.createElement("div");
    o.style.cssText = "position:fixed;inset:0;z-index:50;background:#15161a;display:flex;flex-direction:column";
    o.innerHTML = `<button style="align-self:flex-end;margin:6px">✕ Close</button><iframe src="/ui/versus_view.html?${q}" style="flex:1;border:0"></iframe>`;
    o.querySelector("button").onclick = () => o.remove();
    document.body.appendChild(o);
  };
  // go
  $("#vsgo").onclick = async () => {
    const spec = vs.team ? vsTeamSpec() : vsSpec();
    if (!spec) return;
    let r;
    try { r = await api("/api/versus", spec); } catch (e) { toast(esc(e.message)); return; }
    watchVersus(r.key, spec);
  };
  $("#vslivego").onclick = liveStart;
  $("#vslivestop").onclick = async () => { await api("/api/versus_live_stop", {}).catch(() => {}); liveWatch(); };
}
// the Debug row (clash only): the clash base's switches; the Debug title tells how many differ from it
function drawVsBase() {
  const n = vsBaseDiff(vs.base).length + VS_DEBUG.filter((k) => vs[k]).length;
  if ($("#vsdbgn")) $("#vsdbgn").textContent = n ? `${n} changed` : "";
  const box = $("#vsbase");
  if (!box) return;
  const mark = (k) => ` style="white-space:nowrap${(k === "hit" ? VS_HIT : [k]).some((x) => x in vs.base) ? ";color:var(--gold)" : ""}"`;
  const sec = vsB("burstMax"), kb = vsB("kbscale"), cf = vsB("camFollow");
  box.innerHTML = `<div class="vslbl" style="margin:12px 0 6px" title="The base of every clash fight (on without switches); changes here are kept until Reset to base">Clash base</div>
    <div class="vsbase">${VS_BASE_ITEMS.map(([k, label, tip]) => `<label class="small" title="${esc(tip)}"${mark(k)}><input type="checkbox" class="vsb" data-k="${k}" ${vsB(k) ? "checked" : ""}> ${label}</label>${k === "bursts"
      ? `<label class="small" title="The longest whole skill, in seconds"${mark("burstMax")}><input type="range" id="vsbmax" min="1" max="10" step="0.5" value="${sec}" ${vsB("bursts") ? "" : "disabled"} style="width:80px;vertical-align:middle;padding:0"> <span id="vsbmaxv">≤${sec} s</span></label>` : ""}`).join("")}
    <label class="small" title="The game's knockback distances times this"${mark("kbscale")}>Knockback <input type="range" id="vsbkb" min="0.5" max="3" step="0.25" value="${kb}" style="width:80px;vertical-align:middle;padding:0"> <span id="vsbkbv">${kb}×</span></label>
    <label class="small" title="Team fights: how much the wide shot goes along with the pair's own camera (0 = one fixed shot). A fatal blow always gets the pair's own camera"${mark("camFollow")}>Camera follow <input type="range" id="vsbcf" min="0" max="1" step="0.1" value="${cf}" style="width:80px;vertical-align:middle;padding:0"> <span id="vsbcfv">${cf}</span></label>
    <span class="small"${mark("fade")} title="Effects left from the previous round: Cut = gone the moment the next round starts; Fade = they dissolve while the two stand apart (only Exchanges has stand-offs)">Leftovers
      <span class="seg"><button class="toggle ${vsB("fade") ? "" : "on"}" data-fade="0">Cut</button><button class="toggle ${vsB("fade") ? "on" : ""}" data-fade="1">Fade</button></span></span>
    <button id="vsbreset" ${Object.keys(vs.base).length ? "" : "disabled"}>Reset to base</button></div>`;
  box.querySelectorAll(".vsb").forEach((c) => c.onchange = () => { vsBSet(c.dataset.k, c.checked); drawVsBase(); });
  $("#vsbmax").oninput = (e) => { $("#vsbmaxv").textContent = `≤${e.target.value} s`; };
  $("#vsbmax").onchange = (e) => { vsBSet("burstMax", +e.target.value); drawVsBase(); };
  $("#vsbkb").oninput = (e) => { $("#vsbkbv").textContent = `${e.target.value}×`; };
  $("#vsbkb").onchange = (e) => { vsBSet("kbscale", +e.target.value); drawVsBase(); };
  $("#vsbcf").oninput = (e) => { $("#vsbcfv").textContent = e.target.value; };
  $("#vsbcf").onchange = (e) => { vsBSet("camFollow", +e.target.value); drawVsBase(); };
  box.querySelectorAll("[data-fade]").forEach((b) => b.onclick = () => { vsBSet("fade", b.dataset.fade === "1"); drawVsBase(); });
  $("#vsbreset").onclick = () => { vs.base = {}; drawVsBase(); };
}
// the Versus page's choices as a render's spec (also Live's, with `mode` "clash")
function vsSpec(mode = vs.mode) {
  const spec = { left: vs.left, right: vs.right, skill: vs.skill, mode, rounds: vs.rounds, winner: vs.winner, rskill: vs.rskill };
  if (vs.map) spec.map = vs.map;
  // (the names the intro card shows: as listed here)
  spec.lname = vsChar(vs.left)?.label;
  spec.rname = vsChar(vs.right)?.label;
  for (const [k] of VS_EXTRAS) if (vs[k] && k !== "impact" && (mode === "clash" || !VS_CLASH.includes(k))) spec[k] = true;
  if (vs.music) spec.music = vs.music;
  if (mode !== "clash") {
    spec.clean = true;  // (leftover effects cut at each hit)
    spec.kbscale = vs.kbscale;
  } else {
    spec.deck = spec.spread = true;  // (fixed rules: the skill deck, pushed apart)
    // the last skill: both drawn at random by the engine, else each side's own (a "Random" side: one of its skills
    // drawn here)
    spec.randskill = vs.lrand && vs.rrand;
    if (!spec.randskill) {
      const draw = (k) => { const l = vs.skl && vs.skl[k] && vs.skl[k].id === vs[k] ? vs.skl[k].list : []; return l.length ? l[Math.floor(Math.random() * l.length)] : ""; };
      if (vs.lrand) spec.skill = draw("left") || spec.skill;
      if (vs.rrand) spec.rskill = draw("right") || spec.rskill;
    }
    Object.assign(spec, vs.base);  // (the clash base, CLASH_BASE: only what the Debug row changed)
    spec.seed = Math.floor(Math.random() * 1e9);  // a new draw every render
  }
  return spec;
}
// a team fight's render spec (the Team switch): the clash spec with each side's line-up, the Mode's flow
function vsTeamSpec() {
  const ids = (k) => (vs[k] || []).filter((id) => vsChar(id));
  const l = ids("lefts"), r = ids("rights");
  if (!l.length || !r.length) { toast("Pick at least one fighter for each team."); return null; }
  const spec = vsSpec("clash");
  Object.assign(spec, { team: true, pace: true, left: l[0], right: r[0], lefts: l.join(","), rights: r.join(","),
    lnames: l.map((id) => vsChar(id)?.label || "").join("|"), rnames: r.map((id) => vsChar(id)?.label || "").join("|") });
  spec.lname = vsChar(l[0])?.label; spec.rname = vsChar(r[0])?.label;
  if (!vs.auto) {  // (Versus: the simple team fight, duels)
    if (l.length !== r.length) { toast("Duels need the same number on both sides."); return null; }
    spec.flow = "duels";
    if (vs.pairs === "random") spec.pairs = "random";
    return spec;
  }
  if (vs.rules && Object.keys(vs.rules).length) spec.rules = vs.rules;
  if (vs.teamFlow === "aggro") spec.flow = "aggro";
  else if (vs.teamFlow === "all") spec.allAtOnce = true;
  else spec.lanes = 1;
  return spec;
}
// an earlier video's settings back on the page ("Same settings again")
function vsAgain(spec) {
  for (const k of ["left", "right", "skill", "rskill", "mode", "rounds", "winner"]) if (spec[k] != null) vs[k] = spec[k];
  vs.left = String(vs.left); vs.right = String(vs.right);
  vs.rounds = +vs.rounds || 1; vs.winner = +vs.winner || 0;
  vs.map = spec.map || ""; vs.music = spec.music || "";
  for (const k of VS_SHOW.concat(VS_DEBUG, VS_BUFF_KEYS)) vs[k] = !!spec[k];
  vs.lrand = vs.rrand = spec.mode !== "clash" || spec.randskill !== false;
  vs.base = spec.mode === "clash" ? Object.fromEntries(Object.keys(VS_BASE).filter((k) => k in spec && spec[k] !== VS_BASE[k]).map((k) => [k, spec[k]])) : {};
  vs.skl = {};
  vsKeep();
  drawVersus();
  $("#main").scrollTop = 0;
  toast("That video's settings are back on the page.");
}
// how far a Versus render is (0-1): the fight drawn in Unity (by the parts of it begun) is most of it, then the
// encoding, the E.G.O cut-in, the intro card and the music laid under it
function vsProgress(st) {
  const f = st.current ? st.current.frac : 0;
  switch (st.phase) {
    case "cutins": return 0.85;
    case "ego": return 0.85 + 0.05 * f;
    case "intro": return 0.93;
    case "music": return 0.97;
    case "fight": return st.current ? 0.05 + 0.78 * f : /^Encoding/.test(st.msg || "") ? 0.85 : 0.05;
    default: return 0.02;  // (preparing: the two characters' timelines read)
  }
}
async function watchVersus(key, spec) {
  const out = $("#vsout");
  if (!out) return;
  const st = await api(`/api/versus?key=${key}`).catch(() => ({ state: "error", msg: "" }));
  if (st.state === "running") {
    $("#vsnote").textContent = st.msg || "Rendering…";
    const p = Math.round(100 * vsProgress(st));
    if ($("#vsprog")) $("#vsprog").innerHTML = `<div class="row" style="gap:8px;margin-top:8px"><div class="progress grow" style="margin:0"><div style="width:${Math.max(2, p)}%"></div></div><span class="muted small">${p}%</span></div>`;
    $("#vsgo").disabled = true;
    setTimeout(() => watchVersus(key, spec), 1500);
    return;
  }
  $("#vsgo").disabled = false;
  if ($("#vsprog")) $("#vsprog").innerHTML = "";
  $("#vsnote").innerHTML = st.state === "error" ? `<span class="bad">${esc(st.msg)}</span>` : "";
  if (st.videos.includes("Versus")) { out.innerHTML = versusCard(key, spec, true); vsBindCards(out, [{ key, spec }]); }
  versusList();
}
function versusTitle(spec) {
  const name = (id) => vsChar(id)?.label || String(id);
  if (spec.team) {  // (a team fight: the first of each side and how many more)
    const n = (k) => String(spec[k] || "").split(",").filter(Boolean).length - 1;
    return `${name(spec.left)}${n("lefts") > 0 ? " +" + n("lefts") : ""} vs ${name(spec.right)}${n("rights") > 0 ? " +" + n("rights") : ""}`;
  }
  return `${name(spec.left)} vs ${name(spec.right)}`;
}
// what a Versus video is beyond the two: its card's line and, after the names, its saved file's name
function versusWhat(spec, file) {
  const out = [];
  if (spec.mode === "clash") {
    out.push(`${spec.rounds} clash${spec.rounds > 1 ? "es" : ""}`);
    if (spec.rspeed) out.push(`random speed${spec.speed && spec.speed !== 1 ? ` ~${spec.speed}×` : ""}`);
    else if (spec.speed && spec.speed !== 1) out.push(`${spec.speed}×`);
    if (spec.rpause) out.push("random pause");
    else if (spec.pause >= 0) out.push(`pause ${spec.pause} s`);
    if (spec.defend) out.push("guard & evade");
    if (spec.counter) out.push("counter");
    if (spec.bursts) out.push(`whole skills ≤${spec.burstMax || 3} s`);
    if (spec.lskills || spec.rskills) out.push(`${spec.lskills && spec.rskills ? "both" : spec.lskills ? "left" : "right"} with skills`);
    const won = +spec.winner === 2 ? spec.won : +spec.winner;  // (random: the one drawn, once rendered)
    const who = won === 1 ? "right" : won === 0 ? "left" : null;
    out.push(+spec.winner === 2 && !file ? `random winner${who ? ` (${who})` : ""}` : `${who || "random"} wins${file || won == null ? "" : ": " + fxLabel(won === 1 ? spec.rskill : spec.skill, {})}`);
  } else if (!file) out.push(fxLabel(spec.skill, {}));
  const x = VS_EXTRAS.filter(([k]) => spec[k] && !["clean", "spread"].includes(k)).map(([, label]) => label.toLowerCase());
  // (a clash rendered on the base — all of its keys saved — with what the Debug row changed)
  if (spec.mode === "clash" && Object.keys(VS_BASE).every((k) => k in spec))
    x.push(...vsBaseDiff(spec, ["defend", "counter", "bursts", "lskills", "rskills"]).map((d) => "base: " + d));
  if (x.length) out.push(x.join(file ? ", " : ", "));
  if (spec.music) out.push(`♪ ${spec.music}`);
  if (spec.map) out.push(spec.map);
  return out.join(file ? " · " : ", ");
}
function versusFile(spec) {
  const w = versusWhat(spec, true);
  return versusTitle(spec) + (w ? " · " + w : "");
}
function versusCard(key, spec, big) {
  const what = versusWhat(spec, false);
  return `<div class="card" ${big ? 'style="margin-top:10px"' : ""}><div class="row" style="gap:8px;margin-bottom:6px"><b class="grow">${esc(versusTitle(spec))}</b>
      <span class="muted small">${esc(what)}</span><button data-vsave="${key}">Save</button>
      <button data-vsgif="${key}" title="A GIF under 10 MB, for Discord">GIF</button><button data-vsagain="${key}" title="These settings back on the page">↻ Same settings</button></div>
    <video controls preload="metadata" ${big === "play" ? "autoplay" : ""} src="/api/fx_video?id=${key}&name=Versus&t=${Date.now()}" style="width:100%;background:#000"></video></div>`;
}
// the Save / GIF / Same settings buttons of the cards in `el` (`list`: their {key, spec})
function vsBindCards(el, list) {
  const find = (key) => list.find((y) => y.key === key) || { spec: vs };
  el.querySelectorAll("[data-vsave]").forEach((b) => b.onclick = () =>
    exportObj({ fxvideo: { id: b.dataset.vsave, v: "", items: [["Versus", versusFile(find(b.dataset.vsave).spec)]], unique: true } }));
  el.querySelectorAll("[data-vsgif]").forEach((b) => b.onclick = () =>
    exportObj({ fxvideo: { id: b.dataset.vsgif, v: "", items: [["Versus", versusFile(find(b.dataset.vsgif).spec)]], discord: true, unique: true } }));
  el.querySelectorAll("[data-vsagain]").forEach((b) => b.onclick = () => { closeModal(); vsAgain(find(b.dataset.vsagain).spec); });
  el.querySelectorAll("[data-vplay]").forEach((b) => b.onclick = () => {
    const x = find(b.dataset.vplay);
    modal(`<div style="width:min(1280px,86vw)">${versusCard(x.key, x.spec, "play")}</div>`);
    vsBindCards($("#modal-body"), list);
  });
}
// the earlier videos: the newest four as a strip, "All" opens every one
async function versusList() {
  const list = await api("/api/versus_list").catch(() => []);
  vs.videos = list;
  const box = $("#vslist");
  if (!box) return;
  if ($("#vsall")) { $("#vsall").textContent = `All (${list.length})`; $("#vsall").disabled = !list.length; }
  box.innerHTML = list.length ? list.slice(0, 4).map((x) => `<div class="vsvid">
      <button class="vsthumb" data-vplay="${x.key}" title="Play" ${x.spec.map && vsPicUrl(x.spec.map) ? `style="background-image:url('${vsPicUrl(x.spec.map)}')"` : ""}>
        <img src="${vsIcon(x.spec.left)}" alt="" data-id="${esc(x.spec.left)}" onerror="vsImgErr(this)"><i>VS</i><img src="${vsIcon(x.spec.right)}" alt="" data-id="${esc(x.spec.right)}" onerror="vsImgErr(this)"><span>▶</span></button>
      <b title="${esc(versusTitle(x.spec))}">${esc(versusTitle(x.spec))}</b><div class="small muted" title="${esc(versusWhat(x.spec, false))}">${esc(versusWhat(x.spec, false))}</div>
      <div class="row" style="gap:4px"><button data-vsave="${x.key}">Save</button><button data-vsgif="${x.key}" title="A GIF under 10 MB, for Discord">GIF</button>
        <button data-vsagain="${x.key}" title="These settings back on the page">↻</button></div></div>`).join("")
    : `<div class="muted small">None yet.</div>`;
  vsBindCards(box, list);
}
function versusAll() {
  const list = vs.videos || [];
  modal(`<div style="width:min(1400px,90vw)"><h2 style="margin-top:0">Earlier videos (${list.length})</h2><div class="fxgrid">${list.map((x) => versusCard(x.key, x.spec, false)).join("")}</div></div>`);
  vsBindCards($("#modal-body"), list);
}

// ------------------------------------------------------------------ Live
// The Versus page's Live: the same fight as a render, but played in the Unity player's own window as it happens
// (limbusdm/viewer.py Renderer.start_live) — with its sounds, music, intro card and WIN. Nothing is saved.
async function liveStart() {
  const spec = vsSpec("clash");
  spec.live = true;
  try { await api("/api/versus", spec); } catch (e) { toast(esc(e.message)); return; }
  liveWatch();
}
async function liveWatch() {
  clearTimeout(liveWatch.timer);
  const note = $("#vsnote");
  if (!note || !$("#vslivego")) return;
  let st;
  try { st = await api("/api/versus_live"); } catch (e) { liveWatch.timer = setTimeout(liveWatch, 2000); return; }  // (asked again: a busy moment)
  const busy = ["preparing", "loading", "playing"].includes(st.state);
  $("#vslivego").disabled = busy || vs.mode !== "clash" || !!vs.team;
  $("#vslivestop").hidden = st.state !== "loading" && st.state !== "playing";
  const names = st.names && st.names[0] ? `${esc(st.names[0])} vs ${esc(st.names[1])} — ` : "";
  if (busy) note.innerHTML = `${names}${esc(st.msg || "")}`;
  else if (st.state === "error") note.innerHTML = `<span class="bad">${esc(st.msg || "failed")}</span>`;
  else if (st.state === "done") note.innerHTML = `${names}${st.msg ? esc(st.msg) : "Over."}`;
  if (busy) liveWatch.timer = setTimeout(liveWatch, 1000);
}

// ------------------------------------------------------------------ Snapshots
routes.snapshots = () => {
  const main = $("#main");
  const draw = () => {
    const s = STATE;
    if (!s) return;
    const snaps = [...s.snapshots].reverse();
    const opts = (sel) => snaps.map((x) => `<option value="${esc(x.id)}" ${x.id === sel ? "selected" : ""}>${esc(fmtSnap(x.id))}</option>`).join("");
    const busy = s.job && s.job.running;
    const keepOld = $("#cmp-old") ? $("#cmp-old").value : snaps[1]?.id, keepNew = $("#cmp-new") ? $("#cmp-new").value : snaps[0]?.id;
    main.innerHTML = `<h1>Snapshots</h1><div class="sub">A snapshot records every file and every object of one game version. Reports compare two snapshots.</div>
      ${jobBlock()}
      <div class="row" style="margin-bottom:16px"><button class="primary" onclick="takeSnapshot()" ${busy ? "disabled" : ""}>Take snapshot now</button>
      <button onclick="checkVersion()">Check the game for a new version</button></div>
      ${snaps.length > 1 ? `<div class="card"><b>Compare any two</b><div class="row" style="margin-top:8px"><select id="cmp-old">${opts(keepOld)}</select> → <select id="cmp-new">${opts(keepNew)}</select>
        <button id="cmp-go" ${busy ? "disabled" : ""}>Build report</button></div></div>` : ""}
      <table><tr><th>version</th><th>taken</th><th></th></tr>${snaps.map((x) => `<tr><td class="mono">${esc(x.version)}</td><td>${esc(fmtSnap(x.id).split(" · ")[1] || "")}</td>
        <td><a href="#/scan/${encodeURIComponent(x.id)}">highlights</a></td></tr>`).join("")}</table>`;
    const go = $("#cmp-go");
    if (go) go.onclick = async () => {
      const a = $("#cmp-old").value, b = $("#cmp-new").value;
      if (a === b) return toast("Pick two different snapshots");
      await api("/api/report", { old: a, new: b });
      toast("Building report…");
      const wait = setInterval(async () => {
        await refresh();
        if (!STATE.job.running) { clearInterval(wait); if (STATE.job.result) location.hash = `#/patches/${encodeURIComponent(STATE.job.result.report)}`; }
      }, 1000);
    };
  };
  draw();
  refresh.hook = () => { if (!document.activeElement || document.activeElement.tagName !== "SELECT") draw(); };
};

// ------------------------------------------------------------------ Highlights of one snapshot
routes.scan = async (args) => {
  const id = args.join("/");
  if (!id) { location.hash = "#/snapshots"; return; }  // (opened without a snapshot: its list)
  const main = $("#main");
  main.innerHTML = `<div class="muted">Scanning ${esc(fmtSnap(id))}…</div>`;
  const s = await api(`/api/scan?id=${encodeURIComponent(id)}`);
  const flagged = byFileType(s.flagged, (x) => x.path);
  main.innerHTML = `<h1>Highlights</h1><div class="sub">${esc(fmtSnap(id))} — everything currently in the files, not only changes.</div>
    <h2>Notable names (${flagged.length})</h2><div class="sub small">Grouped by file type. Click a row to open it.</div>${flagged.length ? `<table>${flagged.map((f, i) =>
      groupHeader(flagged, i, (x) => x.path, (hd) => `<tr><td colspan="3"><h3 class="group">${hd}</h3></td></tr>`) +
      `<tr class="clickrow" data-p="${i}"><td>${flagBadges(f.flags)}</td><td class="mono">${esc(f.path)}<div class="muted small">${esc(f.types.join(", "))}</div></td><td class="thumbcell">${thumbFor(f.path, f.types)}</td></tr>`).join("")}</table>` : `<div class="empty">None.</div>`}
    <h2>Lines only in KR / JP (${s.foreign_only.reduce((a, f) => a + f.count, 0)})</h2>
    ${s.foreign_only.length ? s.foreign_only.map((f) => `<div class="item"><div class="head"><span class="path grow mono">${esc(f.file)}</span><span class="muted small">${f.count} records</span></div>
      <div class="body">${f.records.map((rec) => `<div class="rec added"><div class="rid"><span class="badge lang">${esc(rec.lang)}</span> id ${esc(rec.id)}</div>${recordFields(rec.record)}</div>`).join("")}</div></div>`).join("") : `<div class="empty">None.</div>`}`;
  main.querySelectorAll(".item > .head").forEach((h) => h.onclick = () => { h.parentElement.classList.toggle("open"); translateIn(h.parentElement); });
  main.querySelectorAll("[data-p]").forEach((r) => r.onclick = () => openPath(flagged[+r.dataset.p].path));
};

// ------------------------------------------------------------------ Settings
routes.settings = async () => {
  const main = $("#main");
  const st = await api("/api/state");
  const s = st.settings;
  main.innerHTML = `<h1>Settings</h1><div class="sub">Version ${esc(st.version)} · data folder: <span id="disk">…</span> used ·
    <a href="#" onclick="checkUpdates();return false">check for updates</a></div>
    <div class="form">
      <label>Game folder</label><input type="text" id="game_dir" value="${esc(s.game_dir)}" placeholder="auto: ${esc(st.game.dir || "not found")}">
      <div class="hint">Leave empty to detect it from Steam.</div>
      <label>Game updates</label><div><input type="checkbox" id="auto_on_start" ${s.auto_on_start ? "checked" : ""}> check the game for a new version on start and every 2 minutes while the app is open, and build the report</div>
      <div class="hint">The app reads only what the game itself downloaded: after a patch, open the game first, then this app.</div>
      <label>Image previews</label><div><input type="checkbox" id="thumbs" ${s.thumbs ? "checked" : ""}> keep small copies of every texture</div>
      <div class="hint">Needed for "before" pictures — the game deletes old files when it updates.</div>
      <label>Ignored files</label><textarea id="ignore" class="mono">${esc(s.ignore.join("\n"))}</textarea>
      <div class="hint">Patterns of files that change on every launch (logs etc.), one per line.</div>
      <div></div><div><button class="primary" id="save">Save</button> <button id="open-data">Open data folder</button>
        <button id="open-videos">Open videos folder</button></div>
      <div class="hint">Videos folder: your own recordings of skills, shown in Animations under the matching Identity / E.G.O (the file name has to contain its title and Sinner name).</div>
    </div>`;
  const collect = () => ({
    game_dir: $("#game_dir").value.trim(), auto_on_start: $("#auto_on_start").checked, thumbs: $("#thumbs").checked,
    ignore: $("#ignore").value.split("\n").map((x) => x.trim()).filter(Boolean),
  });
  $("#save").onclick = async () => { await api("/api/settings", collect()); toast("Saved"); refresh(); };
  $("#open-data").onclick = () => api("/api/open", { path: st.data_dir });
  api("/api/disk").then((r) => { if ($("#disk")) $("#disk").textContent = fmtSize(r.bytes); }).catch(() => {});
  if (st.site_publish) { main.insertAdjacentHTML("beforeend", `<h2>Website</h2><div class="card" id="sitebox"><span class="muted">Asking the site which build it shows…</span></div>`); drawSiteBox(); }
  $("#open-videos").onclick = () => api("/api/open", { path: st.data_dir + "\\videos" });
};

// The web copy (limbusdm/site.py) on the Settings page: the build the site shows next to this app's, and the upload
// the app's look at its own site before the upload (limbusdm/site.py verify): which pages asked for what the site lacks
function siteCheck(c) {
  if (!c) return "";
  if (c.error) return `<br><span class="bad">The pages weren't checked: ${esc(c.error)}</span>`;
  const bad = Object.entries(c.misses || {});
  return `<br>${c.checked} pages opened and checked` + (c.healed ? ` · ${c.healed} missing files fetched by itself` : "")
    + (c.opened && c.opened.length ? ` · new on the site: ${c.opened.map(esc).join(", ")}` : "")
    + (bad.length ? `<br><span class="bad">Asked for and not on the site:</span> ${bad.map(([r, ks]) => `<b>${esc(r)}</b> — ${ks.slice(0, 3).map((k) => `<span class="mono small">${esc(k.length > 70 ? k.slice(0, 70) + "…" : k)}</span>`).join(", ")}${ks.length > 3 ? ` and ${ks.length - 3} more` : ""}`).join("; ")}`
      : ` · <span class="ok">every page has what it asks for</span>`);
}
// what a "Send to site" put there (limbusdm/site.py publish → "sent")
function siteSent(x) {
  const data = Object.entries(x.data || {}).map(([k, n]) => `${esc(k)}: ${n} new`).join(" · ");
  return (x.uploaded ? `${x.uploaded} file${x.uploaded > 1 ? "s" : ""} uploaded (${fmtSize(x.uploaded_bytes)})${x.first ? " — the first upload from the app, every file is counted" : ""}` : "nothing new to upload")
    + (x.removed ? `, ${x.removed} removed` : "") + ` · ${x.pages ? "pages updated" : "pages unchanged"}`
    + (x.report ? ` · report ${esc(fmtSnap(x.report.split("__")[1] || x.report))}` : "") + (data ? `<br>read again from the game: ${data}` : "")
    + `<br>the site now: ${x.files} files, ${fmtSize(x.bytes)}` + siteCheck(x.check);
}
// how every "Send to site" ended, the newest first (limbusdm/site.py SEND_LOG): the toast is gone in seconds
function siteLog(log, when) {
  if (!log || !log.length) return "";
  const took = (s) => s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`;
  const row = (x) => `<div class="sitelogrow"><span class="muted">${esc(when({ stamp: x.when }))} · ${esc(x.build || "?")} · ${took(x.took || 0)}</span>
    ${x.ok ? `<span class="ok">${x.uploaded ? "sent" : "written, no upload set up"}</span>` : `<span class="bad">${x.error === "cancelled" ? "cancelled" : "failed"}</span>${x.stage ? ` <span class="muted">at "${esc(x.stage)}"</span>` : ""}`}
    <div>${x.ok ? (x.sent && x.sent.uploaded != null ? siteSent(x.sent) : `the site's files: ${x.sent.files}, ${fmtSize(x.sent.bytes)}` + siteCheck(x.sent.check)) : `<span class="mono" style="overflow-wrap:anywhere;user-select:text">${esc(x.error || "")}</span>`}</div></div>`;
  return `<details class="sitelog small" style="margin-top:10px" ${log[0].ok ? "" : "open"}><summary>Send log <span class="muted">· the last: ${log[0].ok ? `<span class="ok">done</span>` : `<span class="bad">${log[0].error === "cancelled" ? "cancelled" : "failed"}</span>`}, ${esc(when({ stamp: log[0].when }))} · ${log.length} kept</span></summary>${log.map(row).join("")}</details>`;
}
async function drawSiteBox() {
  const s = await api("/api/site_status").catch((e) => ({ error: e.message }));
  const box = $("#sitebox");
  if (!box) return;
  const when = (b) => b && b.stamp ? new Date(b.stamp * 1000).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" }) : "";
  const build = (b) => b ? `<b>${esc(b.version || "?")}</b>${b.ui ? ` <span class="muted small mono">pages ${esc(b.ui)}</span>` : ""}` : `<span class="muted">unknown</span>`;
  const busy = STATE && STATE.job && STATE.job.running, fxJob = busy && STATE.job.kind === "sitefx";
  box.innerHTML = `<div class="row" style="gap:8px;flex-wrap:wrap">${s.url ? `<a href="${esc(s.url)}" target="_blank">${esc(s.url)}</a>` : `<span class="muted">no address in data\\site_config.json</span>`}
      ${s.site ? (s.behind ? `<span class="badge changed">the site is behind</span>` : `<span class="badge added">up to date</span>`) : ""}</div>
    <div style="margin:8px 0">On the site: ${s.site ? `${build(s.site)} <span class="muted small">uploaded ${esc(when(s.site))}${s.site.game ? ` · game ${esc(fmtVer(s.site.game))}` : ""}</span>` : `<span class="muted">${esc(s.error || "nothing yet")}</span>`}<br>
      This app: ${build(s.app)}${s.app && s.app.game ? ` <span class="muted small">game ${esc(fmtVer(s.app.game))}</span>` : ""}</div>
    ${s.last ? `<div class="small" style="margin:0 0 10px"><span class="muted">Sent last, ${esc(when({ stamp: s.last.when }))}:</span> ${siteSent(s.last)}</div>` : ""}
    <div class="row" style="gap:8px"><button class="primary" id="sitego" ${busy ? "disabled" : ""}>Send to site</button>
      <span class="muted small">writes the pages and data out again, packs them and uploads what changed; the progress is in the status at the top</span></div>
    ${siteLog(s.log, when)}
    ${s.fx ? `<div class="row" style="gap:8px;margin-top:10px"><button id="sitefx" ${busy && !fxJob ? "disabled" : ""}>${fxJob ? "Stop rendering" : "Render skills for the site"}</button>
      <span class="muted small">Animations → With effects on the site: <b>${s.fx.have}</b> of ${s.fx.total} Identities and E.G.O have their videos there (${s.fx.videos} videos; with the target, and with buffs where they have any).
        Renders the rest one by one — hours the first time; it can be stopped and goes on from there. Then Send to site.</span></div>` : ""}
    ${s.command ? `<div class="hint" style="margin-top:10px">The upload alone, by hand (sends what was prepared last):</div>
      <div class="row" style="gap:8px"><code class="mono small grow" id="sitecmd" style="user-select:all;overflow-wrap:anywhere">${esc(s.command)}</code><button id="sitecopy">Copy</button></div>` : ""}`;
  $("#sitego").onclick = async () => {
    try { await api("/api/site_publish", {}); toast("Sending to the site…", 6000); refresh(); }
    catch (e) { toast(esc(e.message)); }
  };
  if ($("#sitefx")) $("#sitefx").onclick = async () => {
    try { await api("/api/site_fx", fxJob ? { stop: true } : {}); toast(fxJob ? "Stops after the one being rendered." : "Rendering… the progress is in the status at the top.", 6000); await refresh(); drawSiteBox(); }
    catch (e) { toast(esc(e.message)); }
  };
  if ($("#sitecopy")) $("#sitecopy").onclick = async () => {
    try { await navigator.clipboard.writeText(s.command); } catch (e) { const r = document.createRange(); r.selectNodeContents($("#sitecmd")); getSelection().removeAllRanges(); getSelection().addRange(r); document.execCommand("copy"); }
    toast("Copied");
  };
}

// ------------------------------------------------------------------ start
// (on the web copy ui/site/site.js draws the first page, once every script is in and its stubs are set)
refresh().then(() => { if (typeof SITE === "undefined") route(); });
