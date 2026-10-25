// Identity / E.G.O database and team builder, from /api/units.

const SIN_COLORS = { Wrath: "#d94a3a", Lust: "#e8862f", Sloth: "#e3c43a", Gluttony: "#8fc34a", Gloom: "#43b4d6", Pride: "#3e62d6", Envy: "#9b5bd0", None: "#888" };
const RANKS = { 1: "0", 2: "00", 3: "000" };
const GRADES = ["ZAYIN", "TETH", "HE", "WAW", "ALEPH"];
let UNITS = null;
async function units() {
  if (!UNITS) UNITS = await api("/api/units");
  return UNITS;
}
const unitById = (id) => UNITS && (UNITS.ids.find((x) => x.id === id) || UNITS.egos.find((x) => x.id === id) || (UNITS.events || []).find((x) => x.id === id));
// the Database tab's list: Identities, E.G.O or an event's own Identities (Sinnerlings)
const dbList = () => dbv.tab === "egos" ? UNITS.egos : dbv.tab === "events" ? UNITS.events || [] : UNITS.ids;
const statusName = (k) => (UNITS && UNITS.keywords[k]) || k;
const imgThumb = (path) => `/api/asset_thumb?path=${encodeURIComponent(path)}`;
const imgFull = (path) => `/api/asset_img?path=${encodeURIComponent(path)}`;
// Skill icons in their sin frames (community PSD layers); click to save.
let FRAMES = null;
const frameImgs = {};
const loadImg = (src) => frameImgs[src] || (frameImgs[src] = new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; }));
const frameKey = (sin, tier, defense) => defense ? (SIN_COLORS[sin] && sin !== "None" ? `defense_${sin.toLowerCase()}` : "defense") : SIN_COLORS[sin] && sin !== "None" ? `${sin.toLowerCase()}_${Math.min(3, Math.max(1, tier || 1))}` : "";
async function framedIcon(art, key) {
  FRAMES = FRAMES || await fetch("/ui/frames/frames.json").then((r) => r.json());
  const f = FRAMES[key];
  if (!f) return null;
  const [sh, fr, mask, pic] = await Promise.all([..."sfi"].map((k) => loadImg(`/ui/frames/${key}_${{ s: "shadow", f: "frame", i: "inner" }[k]}.png`)).concat(loadImg(art)));
  const [W, H] = f.size, [x0, y0, x1, y1] = f.inner, w = x1 - x0, h = y1 - y0, k = Math.max(w / pic.width, h / pic.height);
  const canvas = () => { const c = document.createElement("canvas"); c.width = W; c.height = H; return [c, c.getContext("2d")]; };
  const [inner, gi] = canvas(), [c, g] = canvas();
  gi.drawImage(pic, x0 + (w - pic.width * k) / 2, y0 + (h - pic.height * k) / 2, pic.width * k, pic.height * k);
  gi.globalCompositeOperation = "destination-in";
  gi.drawImage(mask, 0, 0);
  g.drawImage(sh, 0, 0); g.drawImage(inner, 0, 0); g.drawImage(fr, 0, 0);
  return c.toDataURL("image/png");
}
new MutationObserver(() => document.querySelectorAll("img[data-frame]:not([data-done])").forEach((im) => {
  im.dataset.done = "1";
  // the framed one shows straight away; the round icon only if it can't be made
  const round = () => { im.parentElement.classList.remove("framed"); im.src = im.dataset.src; im.style.visibility = ""; };
  // no own picture: the fallback goes in the frame
  framedIcon(im.dataset.art, im.dataset.frame).catch(() => im.dataset.art2 ? framedIcon(im.dataset.art2, im.dataset.frame) : null)
    .then((u) => { if (!u) return round(); im.src = u; im.style.visibility = ""; }).catch(round);
})).observe(document.documentElement, { childList: true, subtree: true });
function saveIcon(im) {
  if (im.src.startsWith("data:")) exportObj({ image: { data: im.src, name: im.dataset.name } });
}
const sinDot = (sin, title) => `<span class="sindot" style="background:${SIN_COLORS[sin] || "#666"}" title="${esc(title || sin)}"></span>`;

// ------------------------------------------------------------------ Database page
// chips are multi-select: statuses / sins / attack types must ALL be there, ranks / grades match ANY of the picked ones
const DB_MULTI = ["rank", "grade", "sin", "atk", "status", "season"];
const dbv = { tab: "ids", q: "", sinner: 0, rank: [], grade: [], sin: [], atk: [], status: [], season: [], assoc: "", sort: "new", shown: 120 };
// season key; 9100 = every Walpurgis Night
const seasonKey = (s) => !s ? "0" : s > 9100 && s < 9200 ? "9100" : String(s);
const seasonInfo = (s) => (UNITS.seasons || {})[seasonKey(s)];
const lightColor = (hex) => { const n = parseInt(hex.slice(1), 16); return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 > 140; };
function seasonTag(s) {
  const d = seasonInfo(s);
  if (!d) return "";
  const name = seasonKey(s) === "9100" ? `${d.name} ${ROMAN[s - 9101] || s - 9100}` : d.name;
  return `<span class="stag ${lightColor(d.color) ? "lt" : ""}" style="background:${d.color}" title="${esc(d.title ? `${name}: ${d.title}` : name)}">${esc(name)}</span>`;
}
routes.db = async (args) => {
  const main = $("#main");
  main.innerHTML = `<div class="muted">Loading the database…</div>`;
  try { await units(); } catch (e) { main.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  if (!UNITS.ids.length) { main.innerHTML = `<div class="empty">Take a snapshot first — the database is read from it.</div>`; return; }
  if (args[0]) dbv.tab = args[0] === "ego" ? "egos" : args[0] === "event" && (UNITS.events || []).length ? "events" : "ids";
  drawDb();
  if (args[1]) openUnit(+args[1]);
};
function drawDb() {
  const main = $("#main");
  const isId = dbv.tab !== "egos";
  const assocs = [...new Set(dbList().flatMap((x) => x.assoc || []))].sort();
  const chip = (key, val, label, on, title = "") => `<button class="toggle ${on ? "on" : ""}" data-f="${key}" data-v="${esc(val)}" title="${esc(title)}">${label}</button>`;
  // this tab's seasons in the game's order
  const have = new Set(dbList().map((x) => seasonKey(x.season)));
  const seasons = Object.keys(UNITS.seasons || {}).filter((k) => have.has(k)).sort((a, b) => a - b);
  const seasonChip = (k) => { const d = UNITS.seasons[k], on = dbv.season.includes(k);
    return `<button class="toggle schip ${on ? "on" : ""} ${lightColor(d.color) ? "lt" : ""}" data-f="season" data-v="${k}" title="${esc(d.title || d.name)}" style="--sc:${d.color}">${esc(d.name)}</button>`; };
  main.innerHTML = `<h1>Identities & E.G.O</h1>
    <div class="sub">Read from the game's own files — new Identities and changes show up here after every patch.</div>
    <div class="tabs"><button data-tab="ids" class="${dbv.tab === "ids" ? "active" : ""}">Identities<span class="n">${UNITS.ids.length}</span></button>
      <button data-tab="egos" class="${!isId ? "active" : ""}">E.G.O<span class="n">${UNITS.egos.length}</span></button>
      ${(UNITS.events || []).length ? `<button data-tab="events" class="${dbv.tab === "events" ? "active" : ""}" title="Identities of an event only, not in the main game">Sinnerlings<span class="n">${UNITS.events.length}</span></button>` : ""}</div>
    <input type="search" id="dbq" class="dbq" placeholder="Search: name, skill, passive, keyword…" value="${esc(dbv.q)}">
    <div class="dbrow">
      ${isId ? [3, 2, 1].map((r) => chip("rank", r, rankIcons(r, "rank"), dbv.rank.includes(r), RANKS[r])).join("") : GRADES.map((g) => chip("grade", g, ico(`grade_${g}`, "s22", g, g), dbv.grade.includes(g), g)).join("")}
      <span class="gap"></span>${UNITS.sins.map((s) => chip("sin", s, sinIcon(s, "s22"), dbv.sin.includes(s), s)).join("")}
      <span class="gap"></span>${["Slash", "Pierce", "Blunt"].map((a) => chip("atk", a, ico(`atk_${a}`, "s22", a, a), dbv.atk.includes(a), a)).join("")}
      ${isId ? `<span class="gap"></span>${UNITS.statuses.map((k) => chip("status", k, statusIcon(k, "s22"), dbv.status.includes(k), statusName(k))).join("")}` : ""}
    </div>
    <div class="dbrow">
      ${UNITS.sinners.map((n, i) => `<button class="toggle ${dbv.sinner === i + 1 ? "on" : ""}" data-f="sinner" data-v="${i + 1}" title="${esc(n)}">${ico(`sinner_${i + 1}`, "s22 semb", n, n.slice(0, 2))}</button>`).join("")}
      <span class="grow"></span>
      ${isId ? `<select id="dbassoc"><option value="">Any association</option>${assocs.map((a) => `<option ${dbv.assoc === a ? "selected" : ""}>${esc(a)}</option>`).join("")}</select>` : ""}
    </div>
    <div class="dbrow">
      ${seasons.length ? `${chip("season", "0", "Standard", dbv.season.includes("0"), "Not tied to a season")}${seasons.map(seasonChip).join("")}` : ""}
      <span class="grow"></span>
      <button class="toggle on" id="dbsort" title="Sorted by release date: click to turn the order">Release date ${dbv.sort === "old" ? "↑" : "↓"}</button>
      <button class="toggle" id="dbreset">Reset</button>
    </div>
    <div id="dbgrid"></div>`;
  main.querySelectorAll(".tabs button").forEach((b) => b.onclick = () => { dbv.tab = b.dataset.tab; dbv.shown = 120; location.hash = dbv.tab === "egos" ? "#/db/ego" : dbv.tab === "events" ? "#/db/event" : "#/db"; });
  main.querySelectorAll("[data-f]").forEach((b) => b.onclick = () => {
    const f = b.dataset.f, v = ["sinner", "rank"].includes(f) ? +b.dataset.v : b.dataset.v;
    if (DB_MULTI.includes(f)) dbv[f] = dbv[f].includes(v) ? dbv[f].filter((x) => x !== v) : [...dbv[f], v];
    else dbv[f] = dbv[f] === v ? (typeof v === "number" ? 0 : "") : v;
    dbv.shown = 120; drawDb();
  });
  $("#dbsort").onclick = () => { dbv.sort = dbv.sort === "old" ? "new" : "old"; drawDb(); };
  $("#dbreset").onclick = () => { DB_MULTI.forEach((f) => { dbv[f] = []; }); Object.assign(dbv, { q: "", sinner: 0, assoc: "", sort: "new", shown: 120 }); drawDb(); };
  if ($("#dbassoc")) $("#dbassoc").onchange = (e) => { dbv.assoc = e.target.value; drawDbGrid(); };
  let t;
  $("#dbq").oninput = (e) => { clearTimeout(t); t = setTimeout(() => { dbv.q = e.target.value; dbv.shown = 120; drawDbGrid(); }, 200); };
  drawDbGrid();
}
// [Key] / <link="Key"> also by the shown name of the keyword, buff or debuff
const kwNames = (t) => t.replace(/<link="([^"]+)">|\[([A-Za-z0-9_]+)\]/g, (m, a, b) => { const k = a || b, g = UNITS.glossary[k]; return `${m} ${(g && g.name) || UNITS.keywords[k] || UNITS.tags[k] || ""} `; });
function unitText(x) {
  const sk = [...(x.skills || []), ...(x.defense || [])].map((s) => { const u = s.up[Math.max(...Object.keys(s.up))]; return `${u.name} ${u.desc} ${(u.coindescs || []).flat().join(" ")}`; });
  return kwNames([x.title, x.name, x.sinnerName, x.id, ...(x.assoc || []), ...(x.statuses || []).map(statusName), ...sk,
    ...(x.passives || []).flatMap(pasVersions).map((p) => `${p.name} ${p.desc}`)].join(" ")).toLowerCase();
}
// a passive and its earlier versions (lower Uptie / Threadspin)
const pasVersions = (p) => p.prev ? [p, ...pasVersions(p.prev)] : [p];
const pasAt = (p, up) => { while (p.prev && up < p.uptie) p = p.prev; return p; };
const topUp = (s) => s.up[Math.max(...Object.keys(s.up))];
function dbFiltered() {
  const isId = dbv.tab !== "egos", q = dbv.q.trim().toLowerCase();
  let arr = dbList().filter((x) =>
    (!dbv.sinner || x.sinner === dbv.sinner)
    && (!isId || !dbv.rank.length || dbv.rank.includes(x.rank)) && (isId || !dbv.grade.length || dbv.grade.includes(x.grade))
    && dbv.sin.every((sin) => x.skills.some((s) => topUp(s).sin === sin))
    && dbv.atk.every((atk) => x.skills.some((s) => topUp(s).atk === atk))
    && (!isId || dbv.status.every((k) => x.statuses.includes(k)))
    && (!dbv.season.length || dbv.season.includes(seasonKey(x.season)))
    && (!isId || !dbv.assoc || x.assoc.includes(dbv.assoc))
    && (!q || unitText(x).includes(q)));
  const by = {
    new: (a, b) => (b.date || "").localeCompare(a.date || "") || b.id - a.id,
    old: (a, b) => (a.date || "").localeCompare(b.date || "") || a.id - b.id,
    sinner: (a, b) => a.sinner - b.sinner || a.id - b.id,
    rank: (a, b) => b.rank - a.rank || a.sinner - b.sinner,
    grade: (a, b) => GRADES.indexOf(a.grade) - GRADES.indexOf(b.grade) || a.sinner - b.sinner,
  };
  return arr.sort(by[dbv.sort] || by.new);
}
// the game's UI icons; text when missing
function icoFail(img) { const s = document.createElement("span"); s.className = "icofb"; s.textContent = img.alt; img.replaceWith(s); }
const ico = (key, cls = "", title = "", fallback = "") =>
  `<img class="ico ${cls}" src="/api/ui_icon?k=${encodeURIComponent(key)}" title="${esc(title)}" alt="${esc(fallback)}" onerror="icoFail(this)">`;
const sinIcon = (sin, cls = "s16", title = "") => SIN_COLORS[sin] && sin !== "None" ? ico(`sin_${sin}`, cls, title || sin, sin) : "";
const atkIcon = (u, cls = "s16") => u.atk ? ico(`atk_${u.atk}`, cls, u.atk, u.atk) : u.def ? ico(`def_${u.def}`, cls, u.def, u.def) : "";
const statusIcon = (k, cls = "s18") => ico(`st_${k}`, cls, statusName(k), statusName(k));
const rankIcons = (r, cls = "rank") => r ? ico(`rank_${r}`, cls, RANKS[r], RANKS[r]) : "";
const MAX_LEVEL = 65;  // the current level cap: HP = base + per level × level, defense / offense = level + bonus
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV"];
const SPEED_SVG = `<svg class="ico s28" viewBox="0 0 32 32"><path fill="#b4774a" stroke="#3a2418" stroke-width="1.5" d="M10 3h9l-1 12 9 5c3 2 3 6 0 7H6c-2 0-3-2-2-4l3-6z"/><path fill="#3a2418" d="M6 26h22v2H6z"/></svg>`;

// plain-word statuses are marked too; shared names go to the most used keyword
let kwPlain = null;
function kwPlainOf() {
  if (kwPlain) return kwPlain;
  const uses = {};
  const count = (t) => String(t || "").replace(/<link="([^"]+)">|\[([A-Za-z0-9_]+)\]/g, (m, a, b) => { uses[a || b] = (uses[a || b] || 0) + 1; return m; });
  for (const x of [...UNITS.ids, ...UNITS.egos]) {
    for (const sk of [...(x.skills || []), ...(x.defense || [])]) for (const u of Object.values(sk.up)) { count(u.desc); u.coindescs.forEach((c) => c.forEach(count)); }
    (x.passives || []).flatMap(pasVersions).forEach((p) => count(p.desc));
  }
  const key = {};
  for (const [k, g] of Object.entries(UNITS.glossary)) {
    const n = g.name || "", o = key[n];
    if (n.length < 4 || !/^[A-Z]/.test(n) || /[\[\]]/.test(n)) continue;
    if (!o || (uses[k] || 0) > (uses[o] || 0) || ((uses[k] || 0) === (uses[o] || 0) && k.length < o.length)) key[n] = k;
  }
  const names = Object.keys(key).sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  // the game skips a name followed by a letter or one of []()【】-_<'":+
  kwPlain = { key, rx: names.length ? new RegExp(`(?<![\\w\\[])(${names.join("|")})(?![\\p{L}\\d_\\[\\]()【】\\-<'":+])`, "gu") : null };
  return kwPlain;
}
// [Tag] colours the game draws (not in its texts); the rest lime
const TAG_COLOR = { WhenUse: "#26cfff", WhenUse_Force: "#26cfff", WinDuel: "#ff7e00", DuelCounter: "#ff6000", DefeatDuel: "#e30000",
  Wide: "#ffe71b", CantIdentify: "#ff0000", CantDuel: "#ff0000", OnSucceedAttackHead: "#c7ff94", OnSucceedAttackTail: "#64ab23",
  CoinHead: "#ff59c2", EndSkillHead: "#ff59c2", CriticalEndSkill: "#ff59c2", CoinTail: "#cb0080", EndSkillTail: "#cb0080" };
// skill / passive text like the game: [Keyword] → icon + name with tooltip; plain: also plain-word statuses
function fmtDesc(text, plain = false) {
  if (!text) return "";
  const marks = [], gl = (UNITS && UNITS.glossary) || {}, tags = (UNITS && UNITS.tags) || {};  // (games that never load /api/units: plain words)
  const mark = (html) => { marks.push(html); return `\u0001${marks.length - 1}\u0002`; };
  const kwSpan = (k, label) => {
    const g = gl[k];
    if (!g) return mark(`<span class="kw neu">${esc(label || k)}</span>`);
    return mark(`<span class="kw ${g.type}" data-kw="${esc(k)}">${g.iconUrl ? `<img class="kwico" src="${g.iconUrl}" onerror="this.remove()">` : ""}${esc(label || g.name)}</span>`);
  };
  // [TabExplain] is a wrap mark, not a keyword
  let s = String(text).replace(/\[TabExplain\]/g, "").replace(/<sprite[^>]*>/g, "")
    .replace(/<link="([^"]+)">([\s\S]*?)<\/link>/g, (_, k, t) => kwSpan(k, t.replace(/<[^>]+>/g, "")))
    .replace(/<style="highlight">/g, "\u0006").replace(/<style="upgradeHighlight">/g, "\u0005").replace(/<\/style>/g, "\u0007")
    .replace(/<(color|mark)[= ](?:color=)?"?(#[0-9a-fA-F]{6,8})"?>/g, (_, t, c) => mark(`<span style="${t === "mark" ? "background" : "color"}:${c}">`))
    .replace(/<b>/g, () => mark(`<span style="font-weight:700">`)).replace(/<\/(color|mark|b)>/g, () => mark("</span>"))
    .replace(/<\/?[A-Za-z][\w-]*(?:[= ][^>]*)?>/g, "");  // only tags: a translation's own "<Bloodfiend>" stays text, as in the game
  const pk = plain && UNITS && kwPlainOf();
  if (pk && pk.rx) s = s.split(/("[^"\n]*"|“[^”\n]*”|(?<![A-Za-z])'[^'\n]*'(?![A-Za-z]))/)
    .map((part, i) => i % 2 ? part : part.replace(pk.rx, (n) => kwSpan(pk.key[n], n))).join("");
  s = esc(s).replace(/\[([A-Za-z0-9_]+)\]/g, (m, k) => tags[k]
    ? mark(`<span class="tg" style="color:${TAG_COLOR[k] || "#93f13e"}">${esc(tags[k].replace(/<[^>]*>/g, ""))}</span>`) : kwSpan(k));
  // unbalanced spans dropped / closed
  let open = 0;
  s = s.replace(/\u0001(\d+)\u0002|[\u0005\u0006\u0007]/g, (m, i) => {
    const h = m === "\u0005" ? `<span class="uph">` : m === "\u0006" ? `<span class="hl">` : m === "\u0007" ? "</span>" : marks[i];
    if (h === "</span>") { if (!open) return ""; open--; } else if (h.startsWith("<span style=") || h === `<span class="hl">` || h === `<span class="uph">`) open++;
    return h;
  });
  return s.replace(/\n/g, "<br>") + "</span>".repeat(open);
}
// keyword tooltip (click a highlighted status)
document.addEventListener("click", (e) => {
  const tip = document.getElementById("kwtip");
  const kw = e.target.closest && e.target.closest(".kw[data-kw]");
  if (!kw) { if (tip && !e.target.closest("#kwtip")) tip.remove(); return; }
  e.stopPropagation();
  const g = UNITS && UNITS.glossary[kw.dataset.kw];
  if (!g) return;
  let t = tip || Object.assign(document.createElement("div"), { id: "kwtip" });
  t.innerHTML = `<div class="kwhead">${g.iconUrl ? `<img src="${g.iconUrl}">` : ""}<b class="${g.type}">${esc(g.name)}</b></div>
    <div class="kwdesc">${fmtDesc(g.desc)}</div>${g.flavor ? `<div class="kwflavor">${esc(g.flavor)}</div>` : ""}`;
  document.body.appendChild(t);
  const r = kw.getBoundingClientRect(), w = Math.min(380, window.innerWidth - 20);
  t.style.width = w + "px";
  t.style.left = Math.max(10, Math.min(r.left, window.innerWidth - w - 10)) + "px";
  const below = r.bottom + 6, h = t.offsetHeight;
  t.style.top = (below + h > window.innerHeight - 10 ? Math.max(10, r.top - h - 6) : below) + "px";
}, true);

function unitCard(x, extra = "") {
  const isId = !!x.title;
  return `<div class="ucard" data-u="${x.id}">${extra}<div class="uimg"><img loading="lazy" src="${x.pics.thumb}" onerror="this.style.visibility='hidden'"></div>
    <div class="ucap"><div class="urank">${isId ? rankIcons(x.rank) : ico(`grade_${x.grade}`, "s18", x.grade, x.grade)}</div>
      <div class="utitle">${esc(isId ? x.title : x.name)}</div><div class="muted small">${esc(x.sinnerName)}</div>
      ${isId && x.statuses.length ? `<div class="usins">${x.statuses.map((k) => statusIcon(k, "s20")).join("")}</div>` : ""}</div></div>`;
}
// database card: statuses and season
function dbCard(x, newest) {
  const isId = !!x.title;
  const line = isId ? x.statuses.map((k) => `<span class="arch">${statusIcon(k, "s18")}${esc(statusName(k))}</span>`).join("")
    : (x.cost || []).map((c) => `<span class="arch">${sinIcon(c.sin, "s18")}${c.n}</span>`).join("");
  // tile: art, emblem, rank, season; who, title, archetype
  const sid = x.sinner || Math.floor(x.id / 100) % 100;
  return `<div class="ucard dcard d2" data-u="${x.id}"><div class="uimg"><img loading="lazy" src="${x.pics.thumb}" onerror="this.style.visibility='hidden'">
      <span class="uem">${ico(`sinner_${sid}`, "s36", x.sinnerName, "")}</span>
      <span class="urank">${isId ? rankIcons(x.rank) : ico(`grade_${x.grade}`, "s22", x.grade, x.grade)}</span>${seasonTag(x.season)}</div>
    ${x.date && x.date === newest ? `<span class="unew">NEW</span>` : ""}
    <div class="ucap"><div class="uwho">${esc(x.sinnerName)}</div><div class="utitle">${esc(isId ? x.title : x.name)}</div>
      <div class="uarch">${line}</div></div></div>`;
}
function drawDbGrid() {
  const arr = dbFiltered();
  const all = dbList();
  const newest = dbv.tab === "events" ? "" : all.reduce((m, x) => (x.date || "") > m ? x.date : m, "");
  const found = `<div class="muted small" style="margin:10px 0 8px">${arr.length} found${dbv.status.length > 1 || dbv.sin.length > 1 || dbv.atk.length > 1 ? " · with all the picked statuses / sins / attack types" : ""}</div>`;
  $("#dbgrid").innerHTML = (arr.length ? `${found}<div class="ugrid dgrid">${arr.slice(0, dbv.shown).map((x) => dbCard(x, newest)).join("")}</div>` : `${found}<div class="empty">Nothing matches.</div>`)
    + (arr.length > dbv.shown ? `<button class="more" id="dbmore">Show more (${arr.length - dbv.shown} left)</button>` : "");
  $("#dbgrid").querySelectorAll("[data-u]").forEach((c) => c.onclick = () => openUnit(+c.dataset.u));
  if ($("#dbmore")) $("#dbmore").onclick = () => { dbv.shown += 240; drawDbGrid(); };
}

// ---------- detail, laid out like the game's Identity screen
// the game's words: Fatal ×2, Weak ×1.5, Normal ×1, Endure ×0.75, Ineff. ×0.5
const RESIST = (v) => v >= 2 ? ["Fatal", "rfatal"] : v > 1 ? ["Weak", "rweak"] : v === 1 ? ["Normal", "rnorm"] : v >= 0.75 ? ["Endure", "rend"] : ["Ineff.", "rineff"];
// battle UI coins; drawn fallback
const coinIcon = (kind) => `<img class="ico coin" src="/api/ui_icon?k=coin${kind ? `_${kind}` : ""}" title="${kind === "super" ? "Unbreakable Coin" : "Coin"}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('i'), { className: 'coinico' }))">`;
function skillView(s, up, level, label, fallbackImg, plain = false) {
  // missing level: nearest lower; not unlocked yet: first level, marked
  const ks = Object.keys(s.up).map(Number), low = ks.filter((k) => k <= up), lockAt = s.up[up] || low.length ? 0 : Math.min(...ks);
  const u = s.up[up] || s.up[low.length ? Math.max(...low) : lockAt];
  // changed from the previous Uptie / Threadspin: drawn like the texts' highlight
  const pl = ks.filter((k) => k < up), prev = !s.up[up] || !pl.length ? null : s.up[Math.max(...pl)];
  const chg = (f) => prev && f(prev) !== f(u) ? " hl" : "";
  const color = SIN_COLORS[u.sin] || "#777";
  // (the server's links; fallbackImg {thumb, img}: an E.G.O skill's picture without one of its own)
  const fb = typeof fallbackImg === "string" ? { thumb: imgThumb(fallbackImg), img: imgFull(fallbackImg) } : fallbackImg || {};
  const iconPath = s.iconPath || `Assets/Resources_moved/Sprite/SkillIcon/${s.icon || s.id}.png`, icon = s.iconUrl || fb.thumb || imgThumb(iconPath);
  const key = frameKey(u.sin, s.tier, label === "Defense");
  const coinOf = (v) => v.coin == null ? "" : `${v.op === "SUB" ? "−" : "+"}${v.coin}`, coin = coinOf(u);
  const off = level + (u.level || 0);
  return `<div class="skv" style="--sin:${color}">
    <div class="skvtop">
      ${u.base != null ? `<div class="skvbase${chg((v) => v.base)}">${u.base}</div>` : ""}
      <div class="skvicon${key ? " framed" : ""}"><img ${key ? `data-src="${icon}" style="visibility:hidden"` : `src="${icon}"`} ${key ? `data-frame="${key}" data-art="${s.artUrl || fb.img || imgFull(iconPath)}" ${fb.img ? `data-art2="${fb.img}"` : ""} data-name="${esc(`${s.id} ${u.name}`)}" title="Click to save the icon in its frame" onclick="saveIcon(this)"` : ""} onerror="${fb.thumb ? `this.onerror=null;this.src='${fb.thumb}'` : "this.remove()"}">${coin ? `<span class="skvcoin${chg(coinOf)}">${esc(coin)}</span>` : ""}</div>
      <div class="skvmain">
        <div class="skvcoins">${Array.from({ length: u.coins }, (_, i) => coinIcon((u.coinkinds || [])[i] || "")).join("")}${s.copies ? `<span class="copies">×${s.copies}</span>` : ""}</div>
        <div class="skvbanner">${sinIcon(u.sin, "s20")}<span>${esc(u.name)}</span></div>
        <div class="skvmeta">${atkIcon(u, "s28")}<span class="skvoff" title="${u.atk ? "Offense" : "Defense"} level at Lv. ${level}: level ${level}, this skill ${(u.level || 0) >= 0 ? "+" : "−"}${Math.abs(u.level || 0)}">${off}</span><span class="skvlv">(${level}${(u.level || 0) >= 0 ? "+" : "−"}${Math.abs(u.level || 0)})</span>
          <span class="skvw">Atk Weight ${"<i class=\"wsq\"></i>".repeat(Math.max(1, u.targets || 1))}</span>
          ${label ? `<span class="sklabel">${esc(label)}</span>` : ""}${lockAt ? `<span class="muted small" title="The game gives this skill from this Uptie on">Unlocks at Uptie ${ROMAN[lockAt - 1] || lockAt}</span>` : ""}${u.sanity ? `<span class="muted small">${u.sanity} SP</span>` : ""}</div>
      </div></div>
    ${u.desc ? `<div class="skdesc">${fmtDesc(u.desc, plain)}</div>` : ""}
    ${u.coindescs.map((c, i) => c.length ? `<div class="coinrow"><span class="coinbadge">${ROMAN[i] || i + 1}</span><div>${c.map((t) => fmtDesc(t, plain)).join("<br>")}</div></div>` : "").join("")}</div>`;
}
// [2, 0] → " · Threadspin II+", [2, 4] → " · Threadspin II–IV"
const threadspinText = (t) => !t || !t.length ? ""
  : ` · Threadspin ${ROMAN[t[0] - 1] || t[0]}${t[1] ? (t[1] === t[0] ? "" : `–${ROMAN[t[1] - 1] || t[1]}`) : "+"}`;
function passiveHtml(p, plain = false) {
  const cost = p.cost.map((c) => `${sinIcon(c.sin, "s18")}<b>×${c.n}</b>`).join(" ");
  return `<div class="passive"><div class="row"><b class="grow">${esc(p.name)}</b>
      ${cost ? `<span class="pcost"><span class="muted small">${p.mode === "res" ? "Resonance" : "Owned"}</span> ${cost}</span>` : ""}</div>
    <div class="muted small">${p.kind === "support" ? "Support passive" : p.kind === "ego" ? `E.G.O passive${threadspinText(p.threadspin)}` : "Battle passive"}</div>
    <div class="skdesc">${fmtDesc(p.desc, plain)}</div></div>`;
}
function openUnit(id) {
  const x = unitById(id);
  if (!x) return;
  const isId = !!x.title;
  let up = x.maxUp || 4, art2 = false, tab = 0, level = MAX_LEVEL;
  let hl = true; try { hl = localStorage.getItem("udHl") !== "0"; } catch {}
  // Skills 1-3 with their copies, Defense
  const main = x.skills.filter((s) => !isId || s.copies), extra = isId ? x.skills.filter((s) => !s.copies) : [];
  const lone = extra.filter((e) => !main.some((m) => m.tier === e.tier));
  const tabs = isId
    ? [...main.map((s, i) => [`Skill ${i + 1}`, [s, ...extra.filter((e) => e.tier === s.tier)], ""]),
       ...(lone.length ? [["Extra", lone, "Extra"]] : []),
       ...((x.defense || []).length ? [["Defense", x.defense, "Defense"]] : [])]
    : x.skills.map((s) => [s.label || "Skill", [s], s.label || ""]);
  const panel = () => { const [, list, label] = tabs[tab] || [null, []];
    return list.map((s, i) => skillView(s, up, level, label || (i ? "Extra" : ""), isId ? null : s.label === "Corrosion" && x.pics.art2 ? { thumb: x.pics.thumb2, img: x.pics.art2 } : { thumb: x.pics.thumb, img: x.pics.full }, true)
      + (typeof dcSkillLine === "function" ? dcSkillLine(x, s, up, level) : "")).join(`<div class="sksep"></div>`); };
  const left = () => {
    let h = `<div class="udart"><img src="${art2 && x.pics.art2 ? x.pics.art2 : x.pics.art}" onerror="this.src='${x.pics.thumb}'">
        ${x.img.art2 ? `<button class="artbtn ${art2 ? "on" : ""}" id="art2" title="${isId ? "Art after uptie 3" : "Corrosion art"}">⟳</button>` : ""}</div>`;
    if (isId) {
      const sp = x.speed[Math.min(up, x.speed.length) - 1] || [];
      const hp = Math.floor(x.hp + x.hpLevel * level);
      h += `<div class="panels">
        <div class="panel"><h4>Status</h4><div class="trio">
          <div>${ico("hp", "s28", "HP", "HP")}<b>${hp}</b></div>
          <div>${SPEED_SVG}<b>${sp[0]}-${sp[1]}</b></div>
          <div>${ico("def", "s28", "Defense level", "DEF")}<b>${level + x.def}</b><span class="muted small">(${x.def >= 0 ? "+" : ""}${x.def})</span></div></div></div>
        <div class="panel"><h4>Resistances</h4><div class="trio">${["Slash", "Pierce", "Blunt"].map((k) => { const v = x.resist[k] ?? 1, [l, c] = RESIST(v);
          return `<div>${ico(`res_${k}`, "s28", k, k)}<span class="${c}">${l}</span><span class="${c} small">(×${v})</span></div>`; }).join("")}</div></div>
        <div class="panel"><h4>Stagger</h4>${x.stagger.map((p) => `<div><b class="gold">${Math.floor(hp * p / 100)}</b> <span class="muted small">(${p}%)</span></div>`).join("") || `<span class="muted">—</span>`}</div>
      </div>
      ${x.statuses.length ? `<div class="panel"><h4>Keywords</h4><div class="kwrow">${x.statuses.map((k) => `<span class="kw ${(UNITS.glossary[k] || {}).type || "neu"} big" data-kw="${k}">${statusIcon(k, "s28")}${esc(statusName(k))}</span>`).join("")}</div></div>` : ""}
      ${(x.traitKw || []).length ? `<div class="panel"><h4>Trait Keywords</h4><div class="chips">${x.traitKw.map((t) => `<span class="trait${/<s>/.test(t.name) ? " gone" : ""}">${esc(t.name.replace(/<[^>]*>/g, ""))}</span>`).join("")}</div></div>` : ""}`;
    } else {
      h += `<div class="panels two">
        <div class="panel"><h4>Cost</h4><div class="kwrow">${x.cost.map((c) => `<span class="kwi">${sinIcon(c.sin, "s28")}<b>×${c.n}</b></span>`).join("")}</div></div>
        <div class="panel"><h4>Resistances</h4><div class="sinres">${Object.entries(x.resist).filter(([k]) => SIN_COLORS[k] && k !== "None").map(([k, v]) => { const [, c] = RESIST(v); return `<div>${sinIcon(k, "s24")}<span class="${c} small">×${v}</span></div>`; }).join("")}</div></div>
      </div>`;
    }
    return h;
  };
  const right = () => {
    return `<div class="lvpanel"><span class="lvlabel">${isId ? "Uptie" : "Threadspin"}</span>
        ${Array.from({ length: x.maxUp || 4 }, (_, i) => i + 1).map((n) => `<button class="upbtn ${up === n ? "on" : ""}" data-up="${n}" title="${n}">${ico(`up_${n}`, "s22", "", ROMAN[n - 1])}</button>`).join("")}
        ${isId ? `<span class="lvlabel lv">Lv. <b id="lvn">${level}</b></span><input type="range" id="lvr" min="1" max="${MAX_LEVEL}" value="${level}">` : ""}
        <button class="hltog ${hl ? "on" : ""}" id="hltog" title="Highlight what changed from the previous ${isId ? "Uptie" : "Threadspin"}">Changes</button></div>
      <div class="sktabs">${tabs.map(([n], i) => `<button class="${i === tab ? "on" : ""}" data-tab="${i}">${esc(n)}</button>`).join("")}</div>
      <div class="skpanel copyable">${(tabs[tab] || [0, []])[1].length ? panel() : `<div class="muted">No skills.</div>`}</div>
      ${x.passives.length ? `<h3 class="group">Passives</h3><div class="copyable">${x.passives.map((p) => passiveHtml(pasAt(p, up), true)).join("")}</div>` : ""}`;
  };
  const draw = () => {
    modal(`<div class="ud${hl ? "" : " nohl"}"><div class="udhead">${isId ? rankIcons(x.rank, "rankbig") : ico(`grade_${x.grade}`, "s36", x.grade, x.grade)}
        <div class="grow copyable"><div class="udtitle">${esc(isId ? x.title : x.name)}</div>
        <div class="muted small">${esc(x.sinnerName)} · id ${x.id}${x.date ? ` · updated ${esc(x.date)}` : ""}</div></div>
        ${typeof siteLink === "function" ? siteLink(`db/${isId ? "id" : "ego"}/${x.id}`) : ""}<button id="tocmp">⇄ Compare</button>${isId ? `<button id="toanim">Battle animations →</button>` : ""}</div>
      <div class="udcols"><div class="udleft" id="udleft">${left()}</div><div class="udright" id="udright">${right()}</div></div></div>`);
    bind();
  };
  const redraw = () => { $("#udleft").innerHTML = left(); $("#udright").innerHTML = right(); bind(); };
  const bind = () => {
    const body = $("#modal-body");
    body.querySelectorAll("[data-up]").forEach((b) => b.onclick = () => { up = +b.dataset.up; redraw(); });
    body.querySelectorAll("[data-tab]").forEach((b) => b.onclick = () => { tab = +b.dataset.tab; redraw(); });
    $("#hltog").onclick = () => {
      hl = !hl; try { localStorage.setItem("udHl", hl ? "1" : "0"); } catch {}
      $(".ud").classList.toggle("nohl", !hl); $("#hltog").classList.toggle("on", hl);
    };
    const r = $("#lvr");
    if (r) r.oninput = () => { level = +r.value; $("#lvn").textContent = level; $("#udleft").innerHTML = left(); $(".skpanel").innerHTML = panel(); bindLeft(); };
    bindLeft();
    if ($("#tocmp")) $("#tocmp").onclick = () => { $("#modal").classList.add("hidden"); location.hash = `#/compare/${x.id}`; };
    if ($("#toanim")) $("#toanim").onclick = () => { $("#modal").classList.add("hidden"); anim.sel = { key: `c${x.id}`, cid: x.id }; location.hash = "#/anim"; };
  };
  const bindLeft = () => { if ($("#art2")) $("#art2").onclick = () => { art2 = !art2; $("#udleft").innerHTML = left(); bindLeft(); }; };
  draw();
}

// ------------------------------------------------------------------ Teams page
const ORDER_MAX = 7;  // Mirror Dungeon fields 7 at a time; the rest wait in backup
let MY = null;
routes.teams = async () => {
  const main = $("#main");
  main.innerHTML = `<div class="muted">Loading…</div>`;
  await Promise.all([units(), myTeam()]);
  drawTeams();
};
function saveMy() { api("/api/myteam", MY).catch(() => {}); }
async function myTeam() {
  if (!MY) MY = await api("/api/myteam");
  MY.slots = MY.slots || {};
  MY.order = MY.order || [];
  MY.egos = MY.egos || {};
  return MY;
}

// Game team code: base64(gzip(base64(bits))), 46 bits per Sinner 1-12 (Identity 8, order 4, E.G.O 7 x4 + 6), then a
// zero byte.
const TC_EGO = [7, 7, 7, 7, 6];
const tcBytes = (s) => Uint8Array.from(atob(s.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const tcB64 = (bytes) => btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""));
async function teamCodeRead(code) {
  let bytes;
  try {
    const text = await new Response(new Blob([tcBytes(code)]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
    bytes = tcBytes(text.trim());
  } catch { throw new Error("That is not a team code — copy one in the game: Sinners → the two-papers icon → Copy team code."); }
  if (bytes.length * 8 < 12 * 46) throw new Error("The team code is too short.");
  let bit = 0;
  const take = (n) => { let v = 0; for (let i = 0; i < n; i++, bit++) v = v * 2 + ((bytes[bit >> 3] >> (7 - (bit & 7))) & 1); return v; };
  const team = { slots: {}, order: [], egos: {} }, at = {};
  for (let s = 1; s <= 12; s++) {
    const id = take(8), ord = take(4), eg = TC_EGO.map(take);
    if (id) team.slots[s] = 10000 + s * 100 + id;
    if (ord) at[s] = ord;
    team.egos[s] = eg.map((n) => (n ? 20000 + s * 100 + n : 0));
  }
  team.order = Object.keys(at).map(Number).sort((a, b) => at[a] - at[b]);
  return team;
}
async function teamCodeMake(team) {
  const bits = [];
  const put = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >> i) & 1); };
  for (let s = 1; s <= 12; s++) {
    const eg = (team.egos || {})[s] || [];
    put((team.slots[s] || 10001 + s * 100) % 100, 8);  // (the game wants an Identity for everyone: the LCB one)
    put(team.order.indexOf(s) + 1, 4);
    TC_EGO.forEach((n, i) => put(eg[i] ? eg[i] % 100 : i ? 0 : 1, n));  // ZAYIN can't be empty: the first one
  }
  const bytes = new Uint8Array(Math.ceil(bits.length / 8) + 1);
  bits.forEach((b, i) => { if (b) bytes[i >> 3] |= 128 >> (i & 7); });
  const gz = await new Response(new Blob([tcB64(bytes)]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
  return tcB64(new Uint8Array(gz));
}
// load a pasted code; returns how many Identities are unknown
async function teamCodeLoad(code) {
  const t = await teamCodeRead(code);
  const lost = Object.values(t.slots).filter((id) => !unitById(id)).length;
  Object.assign(MY, t);
  saveMy();
  return lost;
}

function drawTeams() {
  const main = $("#main");
  main.innerHTML = `<h1>Team builder</h1>
    <div class="sub">Pick an Identity for every Sinner and the order they go in — or paste a team code from the game.</div>
    <div class="row tcrow"><input type="text" id="tccode" placeholder="Paste a team code from the game…"><button id="tcload">Load</button>
      <span class="grow"></span><button id="tccopy" title="Load it in the game: Sinners → the two-papers icon → Load team code">Copy team code</button></div>
    <div id="builder"></div>`;
  drawBuilder();
  const load = async () => {
    const v = $("#tccode").value.trim();
    if (!v) return;
    try { const lost = await teamCodeLoad(v); $("#tccode").value = ""; drawBuilder(); toast(lost ? `Team loaded — ${lost} Identit${lost > 1 ? "ies are" : "y is"} newer than this game data.` : "Team loaded."); }
    catch (e) { toast(esc(e.message), 6000); }
  };
  $("#tcload").onclick = load;
  $("#tccode").onkeydown = (e) => { if (e.key === "Enter") load(); };
  $("#tccopy").onclick = async () => {
    const code = await teamCodeMake(MY);
    try { await navigator.clipboard.writeText(code); toast("Team code copied — load it in the game: Sinners → the two-papers icon → Load team code."); }
    catch { $("#tccode").value = code; $("#tccode").select(); toast("Copy the code from the box."); }
  };
}
function teamIds() { return Object.values(MY.slots).map(unitById).filter(Boolean); }
// what the deployed part of the team brings: statuses, attack types and sins of the skills
function teamStats() {
  const deployed = MY.order.slice(0, ORDER_MAX).map((sid) => unitById(MY.slots[sid])).filter(Boolean);
  const pool = deployed.length ? deployed : teamIds();
  const st = {}, sins = {}, atk = {};
  pool.forEach((x) => {
    x.statuses.forEach((k) => st[k] = (st[k] || 0) + 1);
    x.skills.forEach((s) => { const u = topUp(s), n = s.copies ?? 1; if (!n) return; sins[u.sin] = (sins[u.sin] || 0) + n; if (u.atk) atk[u.atk] = (atk[u.atk] || 0) + n; });
  });
  return { deployed, pool, st, sins, atk };
}
function tbCard(sid, i, S, here) {
  const x = unitById(MY.slots[sid]), name = UNITS.sinners[sid - 1];
  const egos = here || x ? (MY.egos[sid] || []).map(unitById).filter(Boolean) : [];
  const egoImg = (e) => { const pr = here ? tbPrice(e.cost, "", S) : null;
    return `<img class="${pr ? "tb" + pr.v : ""}" src="${e.pics.thumb}" title="${esc(e.grade)} · ${esc(e.name)}${pr ? ": " + esc(pr.text) : ""}" onerror="this.style.visibility='hidden'">`; };
  return `<div class="tbc ${x ? "" : "empty"} ${x && !here ? "bk" : ""} ${tbSel === sid ? "sel" : ""}" data-slot="${sid}" ${x ? `draggable="true" title="${esc(x.title)}"` : ""}>
    ${x ? `<button class="tbn ${i < 0 ? "off" : ""}" data-tbo="${sid}" title="${i < 0 ? "Not in the order: click to add" : "Click two numbers to swap them (again on the same one: take it out), or drag the card"}">${i < 0 ? "+" : i + 1}</button>${tbPasMark(x, here ? "battle" : "support", S)}` : ""}
    <div class="tbimg">${x ? `<img class="u" src="${x.pics.thumb}" onerror="this.style.visibility='hidden'">` : ico(`sinner_${sid}`, "s36", name, "")}</div>
    <div class="tbegos">${egos.map(egoImg).join("")}</div>
    <div class="tbname">${esc(x ? x.title : "Pick")}</div><div class="tbsin">${esc(name)}</div></div>`;
}
function drawBuilder() {
  const el = $("#builder"), has = (sid) => !!unitById(MY.slots[sid]);
  MY.order = MY.order.filter(has);
  const sides = tbSides(), S = tbSins(sides.field), card = (sid) => tbCard(sid, MY.order.indexOf(sid), S, sides.field.includes(sid));
  const team = `<div class="tbteam">${UNITS.sinners.map((_, i) => card(i + 1)).join("")}</div>`;
  const { st, sins, atk } = teamStats();
  const total = Object.values(sins).reduce((a, b) => a + b, 0) || 1;
  const stats = `<div class="row tbstats">
      ${UNITS.statuses.filter((k) => st[k]).map((k) => `<span class="kwi small">${statusIcon(k, "s22")}<b>${st[k]}</b> ${esc(statusName(k))}</span>`).join("") || `<span class="muted small">no statuses yet</span>`}
      <span class="sep"></span>${Object.entries(atk).map(([k, n]) => `<span class="kwi small">${ico(`atk_${k}`, "s18", k, "")}<b>${n}</b> ${esc(k)}</span>`).join("")}
      <span class="grow"></span><button id="clearteam">Clear</button></div>
    <div class="sinbar">${UNITS.sins.filter((s) => sins[s]).map((s) => `<div style="flex:${sins[s]};background:${SIN_COLORS[s]}" title="${s}: ${sins[s]} skill copies"><span>${100 * sins[s] / total < 8 ? "" : s + " "}${Math.round(100 * sins[s] / total)}%</span></div>`).join("")}</div>
    ${sides.field.length ? `<div class="tbrate"><span class="muted small" title="Each used skill gives one of its sin; on average, from the ${sides.field.length} on the field">Sins a turn ≈</span>${UNITS.sins.filter((s) => S.rate[s]).map((s) => `<span class="tbcost"${S.extra[s] ? ` title="${esc(`With extra skills: ${S.extra[s].map((f) => `${f.who} +${f.n.toFixed(1)}`).join(", ")}`)}"` : ""}>${sinIcon(s, "s16")}${S.rate[s].toFixed(1)}${S.extra[s] ? "*" : ""}</span>`).join("")}
      <span class="muted small">· E.G.O frame: <i class="tbkey slow"></i> slow to gather <i class="tbkey no"></i> no such sin on the field</span></div>` : ""}`;
  const P = tbPasList(sides, S);
  const panel = sides.field.length ? `<div class="card tbpanel"><div class="tbtabs">
      <button class="toggle ${tbTab === "md" ? "on" : ""}" data-tbtab="md">MD gifts</button>
      <button class="toggle ${tbTab === "pas" ? "on" : ""}" data-tbtab="pas">Passives${P.bad.length ? ` <b class="tbwarn">${P.bad.length}</b>` : ""}</button></div>
    ${tbTab === "md" ? tbMd(sides) : tbPas(P, S)}</div>` : "";
  el.innerHTML = `<div class="tbwrap"><div>${team}${stats}</div>${panel}</div>`;
  tbBind(el);
}
// passives with a sin condition: battle ones on the field, support ones in the backup
function tbPasList(sides, S) {
  const xs = (sids) => sids.map((sid) => unitById(MY.slots[sid])).filter(Boolean);
  const rows = (list, kind) => list.flatMap((x) => x.passives.filter((p) => p.kind === kind && p.cost.length).map((p) => ({ x, p, pr: tbPrice(p.cost, p.mode, S) })));
  const all = [...rows(xs(sides.field), "battle"), ...rows(xs(sides.bench), "support")];
  return { all, bad: all.filter((r) => r.pr.v !== "ok") };
}
function tbPas({ all, bad }, S) {
  const shown = (tbAll ? all : bad).map(({ x, p, pr }) => tbRow(x.pics.thumb, p.name, `${p.kind === "battle" ? "Passive" : "Support"} · ${x.title}`, tbCosts(p.cost, p.mode, S), pr, tbPlain(p.desc))).join("");
  return `<div class="tbhead"><span class="muted small">${all.length - bad.length} of ${all.length} switch on easily</span><span class="grow"></span><button id="tbfind">Find support passives</button></div>
    ${shown || `<div class="muted small">${all.length ? "Every passive with a sin condition works with this team." : "No passive here asks for sins."}</div>`}
    ${all.length && bad.length < all.length ? `<button class="tblink" data-tball>${tbAll ? "Only the problems" : `Show all ${all.length}`}</button>` : ""}`;
}
function pickFor(sid) {
  const list = UNITS.ids.filter((x) => x.sinner === sid).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  let status = "", gi = -1;  // gi: the E.G.O grade being picked (-1 = the Identity)
  const egoRow = () => {
    const cur = MY.egos[sid] || [];
    return `<div class="chips" style="margin-bottom:10px"><button class="toggle ${gi < 0 ? "on" : ""}" data-gi="-1">Identity</button>${GRADES.map((g, i) => {
      const e = unitById(cur[i]);
      return `<button class="toggle ${gi === i ? "on" : ""}" data-gi="${i}" title="${e ? esc(e.name) : "Empty"}">${ico(`grade_${g}`, "s18", g, g)}${e ? esc(e.name) : g}</button>`;
    }).join("")}</div>`;
  };
  const drawEgo = () => {
    const g = GRADES[gi], cur = MY.egos[sid] || [];
    const arr = UNITS.egos.filter((x) => x.sinner === sid && x.grade === g).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    modal(`<h2 style="margin-top:0">${esc(UNITS.sinners[sid - 1])}</h2>${egoRow()}
      <div class="chips" style="margin-bottom:10px">${cur[gi] ? `<button data-none="1">Remove</button>` : ""}</div>
      <div class="ugrid small-cards">${arr.map((x) => unitCard(x, (cur[gi] === x.id ? `<div class="picked">✓</div>` : "") + tbEgoBadge(sid, x))).join("") || `<div class="muted">No ${g} E.G.O for this Sinner.</div>`}</div>`);
    const body = $("#modal-body");
    body.querySelectorAll("[data-gi]").forEach((b) => b.onclick = () => { gi = +b.dataset.gi; draw(); });
    const set = (id) => {
      const e = (MY.egos[sid] || []).slice(); while (e.length < GRADES.length) e.push(0);
      e[gi] = id; MY.egos[sid] = e; saveMy(); drawBuilder(); drawEgo();
    };
    body.querySelectorAll("[data-u]").forEach((c) => c.onclick = () => set(+c.dataset.u));
    const none = body.querySelector("[data-none]");
    if (none) none.onclick = () => set(0);
  };
  const draw = () => {
    if (gi >= 0) return drawEgo();
    const arr = list.filter((x) => !status || x.statuses.includes(status));
    modal(`<h2 style="margin-top:0">${esc(UNITS.sinners[sid - 1])}</h2>${egoRow()}
      <div class="chips" style="margin-bottom:10px">${UNITS.statuses.map((k) => `<button class="toggle ${status === k ? "on" : ""}" data-pst="${k}">${statusIcon(k, "s18")}${esc(statusName(k))}</button>`).join("")}
        ${MY.slots[sid] ? `<button data-none="1">Remove</button>` : ""}</div>
      <div class="ugrid small-cards">${arr.map((x) => unitCard(x, MY.slots[sid] === x.id ? `<div class="picked">✓</div>` : "")).join("")}</div>`);
    const body = $("#modal-body");
    body.querySelectorAll("[data-gi]").forEach((b) => b.onclick = () => { gi = +b.dataset.gi; draw(); });
    body.querySelectorAll("[data-pst]").forEach((b) => b.onclick = () => { status = status === b.dataset.pst ? "" : b.dataset.pst; draw(); });
    body.querySelectorAll("[data-u]").forEach((c) => c.onclick = () => {
      MY.slots[sid] = +c.dataset.u;
      if (!MY.order.includes(sid) && MY.order.length < ORDER_MAX) MY.order.push(sid);
      saveMy(); $("#modal").classList.add("hidden"); drawBuilder();
    });
    const none = body.querySelector("[data-none]");
    if (none) none.onclick = () => { delete MY.slots[sid]; MY.order = MY.order.filter((s) => s !== sid); saveMy(); $("#modal").classList.add("hidden"); drawBuilder(); };
  };
  draw();
}

// ------------------------------------------------------------------ Team checks: sins for E.G.O and passives, MD gifts
// A used skill gives one of its sin; each turn a Sinner is dealt 2 of its 6 skill copies and uses one.
function tbSides() {
  const all = UNITS.sinners.map((_, i) => i + 1), has = (sid) => !!unitById(MY.slots[sid]);
  let field = MY.order.slice(0, ORDER_MAX).filter(has);
  if (!field.length) field = all.filter(has);
  return { field, bench: all.filter((sid) => !field.includes(sid)) };
}
// rate: sins a turn on average (+ extra skills the kits use by name, x.fu); can: per Sinner, the chance a turn deals it a skill of that sin
function tbSins(field) {
  const rate = {}, can = {}, extra = {};
  for (const sid of field) {
    const d = {}, gives = {}, x = unitById(MY.slots[sid]);
    x.skills.forEach((s) => { const n = s.copies ?? 1, sin = topUp(s).sin; if (n) { d[sin] = (d[sin] || 0) + n; if (!s.nores) gives[sin] = (gives[sin] || 0) + n; } });
    const tot = Object.values(d).reduce((a, b) => a + b, 0);
    for (const [sin, c] of Object.entries(d)) {
      if (gives[sin]) rate[sin] = (rate[sin] || 0) + gives[sin] / tot;
      (can[sin] = can[sin] || []).push(tot > 1 ? 1 - ((tot - c) * (tot - c - 1)) / (tot * (tot - 1)) : 1);
    }
    for (const f of tbFollowUps(x, field.filter((o) => o !== sid).map((o) => unitById(MY.slots[o])))) {
      rate[f.sin] = (rate[f.sin] || 0) + f.n;
      (extra[f.sin] = extra[f.sin] || []).push(f);
    }
  }
  return { rate, can, extra };
}
// x's extra skills against its field mates: n = uses a turn (the owner's number from beta.json "fu" over the text's guess)
function tbFollowUps(x, mates) {
  return (x.fu || []).flatMap((f) => {
    if (f.nores) return [];
    const p = beta.fu[`${x.id}.${f.skill}`] ?? f.p, t = f.team;
    const k = !t ? 1 : mates.filter((m) => t.kw ? (m.keywords || []).includes(t.kw) : mdFacs(m).includes(t.assoc)).length;
    const n = p * (f.each ? k : Math.min(1, k)), sk = x.skills.find((s) => s.id === f.skill);
    return n > 0 ? [{ sin: f.sin, n, who: `${x.sinnerName} · ${sk ? topUp(sk).name : f.skill}` }] : [];
  });
}
function tbAtLeast(ps, n) {
  let dp = [1];
  for (const p of ps) { const nx = Array(dp.length + 1).fill(0); dp.forEach((v, k) => { nx[k] += v * (1 - p); nx[k + 1] += v * p; }); dp = nx; }
  return dp.slice(n).reduce((a, b) => a + b, 0);
}
// a sin price against the field: v = ok / slow / no
function tbPrice(cost, mode, S) {
  if (!cost || !cost.length) return null;
  if (mode === "res") {
    const lack = cost.find(({ sin, n }) => (S.can[sin] || []).length < n);
    if (lack) return { v: "no", text: `Won't activate: ${(S.can[lack.sin] || []).length} on the field use ${lack.sin}, Resonance needs ${lack.n}` };
    const p = Math.min(...cost.map(({ sin, n }) => tbAtLeast(S.can[sin], n)));
    return { v: p >= 0.5 ? "ok" : "slow", text: `Resonance on ≈${Math.round(p * 100)}% of turns` };
  }
  const lack = cost.find(({ sin }) => !S.rate[sin]);
  if (lack) return { v: "no", text: `Won't activate: no ${lack.sin} skills on the field` };
  const t = Math.max(1, Math.ceil(Math.max(...cost.map(({ sin, n }) => n / S.rate[sin]))));
  return { v: t <= 3 ? "ok" : "slow", text: `≈${t} turn${t > 1 ? "s" : ""} to gather` };
}
const tbCosts = (cost, mode, S) => (cost || []).map(({ sin, n }) => `<span class="tbcost ${(mode === "res" ? (S.can[sin] || []).length >= n : S.rate[sin]) ? "" : "no"}" title="${mode === "res" ? "Resonance" : "Owned"} ${n} ${sin}">${sinIcon(sin, "s16")}${n}</span>`).join("");
const tbPlain = (t) => String(t || "").replace(/<[^>]+>/g, "").replace(/\[(\w+)\]/g, (_, k) => statusName(k));
const tbRow = (img, name, sub, costs, pr, tip = "") => `<div class="tbrow ${pr ? pr.v : ""}" title="${esc(tip)}"><img src="${img}" onerror="this.style.visibility='hidden'">
  <div class="tbtx"><b>${esc(name)}</b><small>${esc(sub)}</small>${pr ? `<small class="tbv">${esc(pr.text)}</small>` : ""}</div><span class="tbcosts">${costs}</span></div>`;

// the worst sin check of an Identity's passives of this kind, as a corner mark on its slot
function tbPasMark(x, kind, S) {
  const bad = x.passives.filter((p) => p.kind === kind && p.cost.length).map((p) => ({ p, pr: tbPrice(p.cost, p.mode, S) })).filter((r) => r.pr.v !== "ok");
  if (!bad.length) return "";
  const v = bad.some((r) => r.pr.v === "no") ? "no" : "slow";
  return `<span class="tbmark ${v}" title="${esc(bad.map((r) => `${kind === "battle" ? "Passive" : "Support passive"} ${r.p.name}: ${r.pr.text}`).join("\n"))}">${v === "no" ? "!" : "~"}</span>`;
}
let tbAll = false, tbClose = false, tbSel = 0, tbTab = "md";
// on an E.G.O card in the picker: can the field gather its price
function tbEgoBadge(sid, e) {
  const { field } = tbSides();
  if (!field.includes(sid)) return "";
  const pr = tbPrice(e.cost, "", tbSins(field));
  return pr ? `<div class="tbbadge ${pr.v}">${esc(pr.v === "no" ? "No such sin on the field" : pr.text.replace(" to gather", ""))}</div>` : "";
}
// Mirror Dungeon gifts that switch on only for a team (mirror.team_conds, read from the English text); names compared
// in English
let TB_MD = null;
const tbOn = new Set(), tbOff = new Set();
const mdFacs = (x) => x._fac || (x._fac = [...x.assoc, ...(x.traitKw || []).map((t) => t.name)].map(langEn));
const mdMet = (c) => (c.n ? c.have >= c.n : c.have > 0), mdCnt = (c) => (c.n ? `${c.have}/${c.n}` : `${c.have}, more = stronger`);
function mdConds(g) {
  if (g._c) return g._c;
  const facs = mdConds.f || (mdConds.f = new Set(UNITS.ids.flatMap(mdFacs)));
  return (g._c = (g.team || []).map((c) => (c.fs ? { ...c, fs: c.fs.map(langEn) } : c))
    .filter((c) => (c.kind === "st" ? UNITS.statuses.includes(c.k) : c.kind === "fac" ? c.fs.every((f) => facs.has(f)) : true)));
}
function mdCount(c, { field, bench }) {
  const sids = c.scope === "all" ? field.concat(bench) : c.scope === "bench" ? bench : field;
  return sids.map((sid) => unitById(MY.slots[sid])).filter(Boolean).filter((x) => c.kind === "st" ? x.statuses.includes(c.k)
    : c.kind === "fac" ? c.fs.some((f) => mdFacs(x).includes(f))
    : (((MIRROR || {}).users || {})[c.k] || []).includes(x.id)).length;
}
const mdLabel = (c) => (c.kind === "fac" ? c.fs.join(" or ") : c.kind === "use" ? `${((UNITS.glossary || {})[c.k] || {}).name || c.k} users` : statusName(c.k))
  + { field: " on the field", all: " in the team", bench: " in the backup" }[c.scope];
// for the MD planner: how the saved team meets a gift's condition
function mdTeamLine(id) {
  if (!MY || !UNITS || !Object.values(MY.slots).some(unitById)) return "";
  const sides = tbSides();
  return mdConds(mpG(id)).map((c) => { c = { ...c, have: mdCount(c, sides) }; return `<small class="mdteam ${mdMet(c) ? "ok" : "bad"}">Your team: ${esc(mdLabel(c))} ${mdCnt(c)}</small>`; }).join("");
}
// gifts by condition, one row each; a fusion's parts come with it in the planner, so they aren't listed
function tbMd(sides) {
  if (!MIRROR) {
    if (!TB_MD) TB_MD = mpLoad().then(() => tbRedraw()).catch(() => { TB_MD = "failed"; tbRedraw(); });
    return `<div class="muted small">${TB_MD === "failed" ? "No Mirror Dungeon data: take a snapshot first." : "Reading the gifts…"}</div>`;
  }
  const seen = new Set(), list = [];
  for (const [id, g] of Object.entries(MIRROR.gifts)) {
    const cs = mdConds(g).map((c) => ({ ...c, have: mdCount(c, sides) }));
    if (!cs.length || !cs.some((c) => c.have) || seen.has(g.name)) continue;
    seen.add(g.name);
    const met = cs.every(mdMet);
    if (met || cs.every((c) => c.have >= c.n - 2)) list.push({ id: +id, g, cs, met, fus: !!MIRROR.fus[id] });
  }
  const parts = new Set(), addParts = (id) => (MIRROR.fus[id] || []).flat().forEach((p) => { if (!parts.has(p)) { parts.add(p); addParts(p); } });
  list.forEach((x) => addParts(x.id));
  const groups = new Map();
  for (const x of list.filter((x) => !parts.has(x.id))) {
    const key = JSON.stringify(x.cs.map((c) => [c.kind, c.k, c.fs, c.n, c.scope]));
    if (!groups.has(key)) groups.set(key, { cs: x.cs, met: x.met, gifts: [] });
    groups.get(key).gifts.push(x);
  }
  const gs = [...groups.values()];
  gs.forEach((G) => G.gifts.sort((a, b) => b.fus - a.fus || b.g.tier - a.g.tier || a.g.name.localeCompare(b.g.name)));
  gs.sort((a, b) => b.gifts.filter((x) => x.fus).length - a.gifts.filter((x) => x.fus).length || b.gifts.length - a.gifts.length);
  const on = (x) => (x.met && !tbOff.has(x.id)) || tbOn.has(x.id), shown = gs.flatMap((G) => (G.met || tbClose ? G.gifts : []));
  const icon = (x) => `<span class="tbgi ${on(x) ? "on" : ""}" data-tbg="${x.id}" title="${esc(`${x.g.name} · Tier ${ROMAN[x.g.tier - 1] || x.g.tier}${x.fus ? " · Fusion" : ""}\n\n${tbPlain(x.g.desc)}`)}">${x.g.pic ? `<img src="${imgThumb(x.g.pic)}" loading="lazy">` : ""}${x.fus ? "<s>F</s>" : ""}</span>`;
  const row = (G) => `<div class="tbgrp ${G.met ? "ok" : "no"}"><div class="tbcond">${G.met ? "✓" : "·"} ${G.cs.map((c) => `${esc(mdLabel(c))} <b>${mdCnt(c)}</b>`).join(" + ")}</div><div class="tbgis">${G.gifts.map(icon).join("")}</div></div>`;
  const met = gs.filter((G) => G.met), close = gs.filter((G) => !G.met), picked = shown.filter(on);
  return `${met.map(row).join("") || `<div class="muted small">${close.length ? "Nothing switches on with this team yet." : "No gift asks for what this team has."}</div>`}
    ${close.length ? `<button class="tblink" data-tbclose>${tbClose ? "Hide the almost ones ▴" : `Almost (${close.length}) ▾`}</button>${tbClose ? close.map(row).join("") : ""}` : ""}
    ${shown.length ? `<div class="muted small tbhint">Click a gift to leave it out · F = fusion, its parts are planned with it</div><button id="tbplan" class="tbplan" ${picked.length ? "" : "disabled"}>Plan ${picked.length} in the MD planner ›</button>` : ""}`;
}
function tbRedraw() { if ($("#builder") && location.hash.startsWith("#/teams")) drawBuilder(); }
function tbBind(el) {
  const has = (sid) => !!unitById(MY.slots[sid]);
  const swap = (a, b) => {
    const o = MY.order.slice(), i = o.indexOf(a), j = o.indexOf(b);
    if (a === b || (i < 0 && j < 0)) return;
    if (i >= 0 && j >= 0) { o[i] = b; o[j] = a; } else if (i >= 0) o[i] = b; else o[j] = a;
    MY.order = o; saveMy();
  };
  el.querySelectorAll("[data-slot]").forEach((d) => {
    const sid = +d.dataset.slot;
    d.onclick = (e) => { if (!e.target.closest("[data-tbo],.tbmark")) pickFor(sid); };
    if (!has(sid)) return;
    d.ondragstart = (e) => { e.dataTransfer.setData("text/plain", String(sid)); e.dataTransfer.effectAllowed = "move"; };
    d.ondragover = (e) => { e.preventDefault(); d.classList.add("over"); };
    d.ondragleave = () => d.classList.remove("over");
    d.ondrop = (e) => { e.preventDefault(); tbSel = 0; swap(+e.dataTransfer.getData("text/plain"), sid); drawBuilder(); };
  });
  el.querySelectorAll("[data-tbo]").forEach((b) => b.onclick = () => {
    const sid = +b.dataset.tbo;
    if (tbSel === sid) { MY.order = MY.order.filter((s) => s !== sid); saveMy(); tbSel = 0; }
    else if (tbSel) { swap(tbSel, sid); tbSel = 0; }
    else if (MY.order.includes(sid)) tbSel = sid;
    else { MY.order.push(sid); saveMy(); }
    drawBuilder();
  });
  el.querySelectorAll("[data-tbtab]").forEach((b) => b.onclick = () => { tbTab = b.dataset.tbtab; drawBuilder(); });
  const clear = el.querySelector("#clearteam");
  if (clear) clear.onclick = () => { MY.slots = {}; MY.order = []; MY.egos = {}; saveMy(); drawBuilder(); };
  const find = el.querySelector("#tbfind");
  if (find) find.onclick = tbFind;
  el.querySelectorAll("[data-tball]").forEach((b) => b.onclick = () => { tbAll = !tbAll; drawBuilder(); });
  el.querySelectorAll("[data-tbclose]").forEach((b) => b.onclick = () => { tbClose = !tbClose; drawBuilder(); });
  el.querySelectorAll("[data-tbg]").forEach((r) => r.onclick = () => {
    const id = +r.dataset.tbg;
    if (r.classList.contains("on")) { tbOn.delete(id); tbOff.add(id); } else { tbOff.delete(id); tbOn.add(id); }
    drawBuilder();
  });
  const plan = el.querySelector("#tbplan");
  if (plan) plan.onclick = () => {
    const ids = [...el.querySelectorAll("[data-tbg].on")].map((r) => +r.dataset.tbg);
    const st = teamStats().st, lead = Object.keys(st).sort((a, b) => st[b] - st[a])[0];
    ids.forEach((id) => mp.want.add(id));
    mp.kw = lead || ""; mp.tab = "b";
    mpSave();
    location.hash = "#/mirror";
  };
}
// support passives of every Identity a backup Sinner could take, checked against the field's sins
function tbFind() {
  let st = "", works = false, top = 0;
  const draw = () => {
    const { field, bench } = tbSides(), S = tbSins(field);
    const groups = bench.map((sid) => {
      const rows = UNITS.ids.filter((x) => x.sinner === sid).sort((a, b) => (b.date || "").localeCompare(a.date || ""))
        .flatMap((x) => x.passives.filter((p) => p.kind === "support").map((p) => ({ x, p, pr: tbPrice(p.cost, p.mode, S) })))
        .filter(({ p, pr }) => (!st || p.desc.includes(`[${st}]`)) && (!works || !pr || pr.v !== "no"));
      return rows.length ? `<div class="tbsub">${esc(UNITS.sinners[sid - 1])}</div>` + rows.map(({ x, p, pr }) => `<div class="tbrow tbpick ${pr ? pr.v : ""} ${MY.slots[sid] === x.id ? "on" : ""}" data-tbpick="${sid}:${x.id}">
        <img src="${x.pics.thumb}" onerror="this.style.visibility='hidden'"><div class="tbtx"><b>${esc(p.name)}</b><small>${esc(x.title)}${MY.slots[sid] === x.id ? " · in the team" : ""}</small>
        ${pr ? `<small class="tbv">${esc(pr.text)}</small>` : ""}<div class="tbdesc">${fmtDesc(p.desc)}</div></div><span class="tbcosts">${tbCosts(p.cost, p.mode, S)}</span></div>`).join("") : "";
    }).join("");
    modal(`<h2 style="margin-top:0">Support passives for the backup</h2>
      <div class="sub">Sinners not among the first ${ORDER_MAX} in order. Red: the sins of the ${field.length} on the field can't switch it on. Click one to put that Identity in the team.</div>
      <div class="chips" style="margin-bottom:10px"><button class="toggle ${works ? "on" : ""}" data-tbw="1">Only ones that work</button>
        ${UNITS.statuses.map((k) => `<button class="toggle ${st === k ? "on" : ""}" data-tbst="${k}">${statusIcon(k, "s18")}${esc(statusName(k))}</button>`).join("")}</div>
      ${groups || `<div class="muted">${bench.length ? "Nothing fits." : "Every Sinner is on the field."}</div>`}`);
    const body = $("#modal-body"), box = body.closest(".modal-box");
    box.scrollTop = top;
    body.querySelector("[data-tbw]").onclick = () => { works = !works; draw(); };
    body.querySelectorAll("[data-tbst]").forEach((b) => b.onclick = () => { st = st === b.dataset.tbst ? "" : b.dataset.tbst; draw(); });
    body.querySelectorAll("[data-tbpick]").forEach((r) => r.onclick = () => {
      const [sid, id] = r.dataset.tbpick.split(":").map(Number);
      MY.slots[sid] = id; saveMy(); drawBuilder(); top = box.scrollTop; draw();
    });
  };
  draw();
}
