// Search: one box over everything (Ctrl+K, the header's button) and the story's line search (#/story/find/<words>).
// Both take the shown language and English.
const sx = { rows: null, items: [], sel: 0, back: null, lines: null, linesBusy: null };
const sxNorm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ё/g, "е")
  .replace(/<[^>]*>/g, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const sxPlain = (s) => String(s || "").replace(/<[^>]*>/g, "");
const sxWords = (q) => sxNorm(q).split(" ").filter(Boolean);
const sxRx = (q) => {
  const w = q.replace(/[«»"]/g, " ").split(/\s+/).filter((x) => x.length > 1).map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return w.length ? new RegExp(`(${w.join("|")})`, "giu") : null;
};
const sxMark = (text, rx) => rx ? esc(text).replace(rx, "<mark>$1</mark>") : esc(text);

// the shown language's text → its English (one translation can stand for several: "Разрыв" is Rupture and Rip)
async function sxBack() {
  if (!LANG.id || sx.back?.id === LANG.id) return;
  const m = new Map();
  for (const g of ["core", "story"]) for (const [en, tr] of Object.entries(await langTable(g))) {
    if (typeof tr !== "string" || tr === en) continue;
    for (const t of new Set([tr, tr.trim()])) { const a = m.get(t) || []; if (!a.includes(en)) a.push(en); m.set(t, a); }
  }
  sx.back = { id: LANG.id, m };
}
const sxEn = (s) => s == null || !LANG.id || !sx.back ? "" : (sx.back.m.get(String(s)) || sx.back.m.get(String(s).trim()) || []).join(" / ");

// ------------------------------------------------------------------ the box over everything
const SX_ORDER = ["Pages", "Keywords", "Identities", "E.G.O", "Enemies", "Buff effects", "Story", "Music", "Games"];
async function sxData() {
  if (sx.rows && sx.rows.lang === LANG.id) return sx.rows;
  const [, en, bf, mus, sto] = await Promise.all([units(), api("/api/enemies").catch(() => null), api("/api/buffs").catch(() => null),
    api("/api/music").catch(() => []), api("/api/story").catch(() => null), sxBack()]);
  const thumbs = new Set(en?.thumbs || []), season = (x) => x.season && x.season < 100 ? ` · Season ${x.season}` : "";
  const rows = [];
  const used = new Set([...Object.keys(UNITS.keywords || {}), ...UNITS.ids.flatMap((x) => x.statuses || [])]);
  const buffIds = new Set((bf?.list || []).map((b) => b.id));
  for (const k of used) {
    const g = UNITS.glossary[k];
    if (g?.name) rows.push({ g: "Keywords", t: g.name, s: sxPlain(g.desc).slice(0, 90), html: statusIcon(k, "s28"), go: buffIds.has(k) ? `#/buffs/${k}` : "#/db/ids", kw: buffIds.has(k) ? "" : g.name, k: [g.name, k] });
  }
  for (const x of UNITS.ids) rows.push({ g: "Identities", t: x.title, s: x.sinnerName + season(x), pic: imgThumb(x.img.thumb), go: `#/db/ids/${x.id}`, k: [x.title, x.sinnerName, x.id] });
  for (const x of UNITS.egos) rows.push({ g: "E.G.O", t: x.name, s: `${x.sinnerName} · ${x.grade}`, pic: imgThumb(x.img.thumb), go: `#/db/ego/${x.id}`, k: [x.name, x.sinnerName, x.grade, x.id] });
  const seen = new Set();
  for (const e of en?.list || []) {
    if (seen.has(e.name + "|" + e.group)) continue;
    seen.add(e.name + "|" + e.group);
    rows.push({ g: "Enemies", t: e.name, s: e.group + (e.kind ? ` · ${e.kind}` : ""), go: `#/enemies/${e.id}`, k: [e.name, e.group],
      pic: thumbs.has(e.app) ? `/api/enemy_thumb?app=${encodeURIComponent(e.app)}` : e.pic ? imgThumb(e.pic) : "" });
  }
  for (const b of bf?.list || []) rows.push({ g: "Buff effects", t: b.name, s: sxPlain(b.desc).split("\n")[0].slice(0, 70), pic: b.icon ? imgThumb(b.icon) : "", go: `#/buffs/${b.id}`, k: [b.name, b.id] });
  (Array.isArray(mus) ? mus : []).forEach((m, n) => rows.push({ g: "Music", t: m.name, s: [m.by, m.where].filter(Boolean).join(" · "), icon: "♪", play: n, k: [m.name, m.by, m.where] }));
  for (const c of [...(sto?.main || []), ...(sto?.other || [])]) {
    rows.push({ g: "Story", t: `${c.label} · ${c.title}`, s: [c.company, c.area].filter(Boolean).join(" · "), pic: c.pic ? stImg(c.pic) : "", go: `#/story/main/${c.id}`, k: [c.label, c.title, c.company, c.area] });
    for (const e of c.eps || []) if (e.parts?.[0]) rows.push({ g: "Story", t: e.title || `Episode ${e.n}`, s: `${c.label} · episode ${e.n}`, minor: 1,
      pic: e.parts[0][2] ? stImg(e.parts[0][2]) : "", go: `#/story/read/${encodeURIComponent(e.parts[0][0])}`, k: [e.title, c.label] });
  }
  for (const g of GM_GAMES) rows.push({ g: "Games", t: g[2], s: g[3], icon: "🎲", go: g[1], k: [g[2], g[3], "game"] });
  for (const a of document.querySelectorAll("#nav a[href^='#/'], #subnav a[href^='#/']")) {
    const t = a.textContent.trim().replace(/\s+/g, " ");
    if (t && !a.classList.contains("apponly")) rows.push({ g: "Pages", t, s: "Page", icon: "↗", go: a.getAttribute("href"), k: [t] });
  }
  for (const r of rows) { r.en = sxEn(r.t); r.nt = sxNorm(r.t); r.nk = sxNorm(r.k.join(" ") + " " + r.k.map(sxEn).join(" ")); }
  rows.lang = LANG.id;
  return sx.rows = rows;
}
function sxFindAll(q) {
  const w = sxWords(q);
  if (!w.length) return [];
  const out = [];
  for (const r of sx.rows) {
    if (!w.every((x) => r.nk.includes(x))) continue;
    const sc = r.nt.startsWith(w[0]) ? 0 : (" " + r.nt).includes(" " + w[0]) ? 1 : r.nt.includes(w[0]) ? 2 : 3;
    out.push([sc + (r.minor || 0), r]);
  }
  out.sort((a, b) => a[0] - b[0] || a[1].t.length - b[1].t.length);
  const by = {};
  for (const [, r] of out) (by[r.g] ||= []).push(r);
  return SX_ORDER.filter((g) => by[g]).map((g) => [g, by[g]]);
}
function sxOpen() {
  if ($("#sxbox")) return;
  const el = document.createElement("div");
  el.id = "sxbox";
  el.innerHTML = `<div class="sxpanel"><div class="sxin"><span class="sxglass">⌕</span><input id="sxq" placeholder="Search Identities, E.G.O, enemies, effects, story, music…" autocomplete="off"><kbd>Esc</kbd></div>
    <div id="sxres"><div class="sxhint">Type a name in your language or in English.</div></div>
    <div class="sxfoot"><span><kbd>↑</kbd><kbd>↓</kbd> choose</span><span><kbd>Enter</kbd> open</span><span><kbd>Ctrl</kbd><kbd>K</kbd> anywhere</span></div></div>`;
  document.body.appendChild(el);
  el.onclick = (e) => { if (e.target === el) sxClose(); };
  const inp = $("#sxq");
  inp.focus();
  const sel = (i) => {
    sx.sel = Math.max(0, Math.min(sx.items.length - 1, i));
    $("#sxres").querySelectorAll(".sxrow").forEach((r) => r.classList.toggle("on", +r.dataset.i === sx.sel));
    $("#sxres .sxrow.on")?.scrollIntoView({ block: "nearest" });
  };
  const go = (r) => {
    if (!r) return;
    sxClose();
    if (r.play != null) { if (mu.tracks?.length) muPlay(r.play); return; }
    location.hash = r.go;
    if (r.kw) setTimeout(() => { const i = $("#main input.dbq") || $("#main input"); if (i) { i.value = r.kw; i.dispatchEvent(new Event("input", { bubbles: true })); } }, 700);
  };
  const draw = () => {
    const q = inp.value.trim();
    if (!sx.rows || sx.rows.lang !== LANG.id) { $("#sxres").innerHTML = `<div class="sxhint">Loading…</div>`; return; }
    sx.items = [];
    const rx = sxRx(q), w = sxWords(q);
    let h = sxFindAll(q).map(([g, list]) => {
      const n = g === "Story" || g === "Music" ? 4 : 5;
      return `<div class="sxgroup"><div class="sxgh">${esc(g)} <span>${list.length}</span></div>${list.slice(0, n).map((r) => {
        sx.items.push(r);
        const byEn = r.en && !w.every((x) => r.nt.includes(x));
        return `<div class="sxrow" data-i="${sx.items.length - 1}">${r.html ? `<i class="sxico">${r.html}</i>` : r.pic ? `<img src="${r.pic}" loading="lazy" alt="" onerror="this.replaceWith(Object.assign(document.createElement('i'),{className:'sxico',textContent:'·'}))">` : `<i class="sxico">${r.icon || "·"}</i>`}
          <div class="sxt"><b>${sxMark(r.t, rx)}</b><span>${byEn ? `<u>${sxMark(r.en, rx)}</u> · ` : ""}${esc(r.s || "")}</span></div><em>${r.play != null ? "▶ play" : "open"}</em></div>`;
      }).join("")}${list.length > n ? `<div class="sxmore">+ ${list.length - n} more</div>` : ""}</div>`;
    }).join("");
    if (q.length > 2) {
      sx.items.push({ go: `#/story/find/${encodeURIComponent(q)}` });
      h += `<div class="sxgroup"><div class="sxrow sxline" data-i="${sx.items.length - 1}"><i class="sxico">❝</i><div class="sxt"><b>Search the story's lines for “${esc(q)}”</b><span>Every line of every Canto, Intervallo and Identity story</span></div><em>→</em></div></div>`;
    }
    $("#sxres").innerHTML = h || (q ? `<div class="sxhint">Nothing found.</div>` : `<div class="sxhint">Type a name in your language or in English.</div>`);
    $("#sxres").querySelectorAll(".sxrow").forEach((r) => { r.onmouseenter = () => sel(+r.dataset.i); r.onclick = () => go(sx.items[+r.dataset.i]); });
    sel(0);
  };
  sxData().then(() => { if ($("#sxbox")) draw(); }).catch((e) => { $("#sxres").innerHTML = `<div class="sxhint">${esc(e.message)}</div>`; });
  inp.oninput = draw;
  inp.onkeydown = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); sel(sx.sel + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); sel(sx.sel - 1); }
    else if (e.key === "Enter") { e.preventDefault(); go(sx.items[sx.sel]); }
    else if (e.key === "Escape") sxClose();
  };
}
function sxClose() { $("#sxbox")?.remove(); }
document.addEventListener("keydown", (e) => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k" || e.key === "/" && !typing && !e.ctrlKey) { e.preventDefault(); sxOpen(); }
}, true);
$("#sxbtn")?.addEventListener("click", sxOpen);

// ------------------------------------------------------------------ the story's lines
// the Story page's box (story.js puts it next to its tabs)
const sxStoryBar = () => `<form class="sxbar" onsubmit="event.preventDefault(); const q = this.q.value.trim(); if (q) location.hash = '#/story/find/' + encodeURIComponent(q);">
  <span class="sxglass">❝</span><input name="q" placeholder="Find a line…" value="${esc(sx.q || "")}" autocomplete="off"><button>Find</button></form>`;
// every line once (English from /api/story_lines, the shown language put over it here, so both can be searched)
async function sxLines() {
  if (sx.lines?.lang === LANG.id) return sx.lines;
  if (sx.linesBusy?.lang === LANG.id) return sx.linesBusy.p;
  const p = (async () => {
    const r = await fetch("/api/story_lines");
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
    const [data, core, story] = await Promise.all([r.json(), LANG.id ? langTable("core") : {}, LANG.id ? langTable("story") : {}]);
    const tr = (s) => story[s] ?? core[s] ?? story[s.trim()] ?? core[s.trim()] ?? s;
    const who = data.who.map(([n, c]) => { const t = n ? tr(n) : ""; return { name: t, color: c, nw: sxNorm(t + " " + (t !== n ? n : "")) }; });
    const lines = data.lines.map(([f, i, w, en]) => {
      const t = sxPlain(LANG.id ? tr(en) : en);
      return { f: data.files[f], i, w: who[w], t, en: t === sxPlain(en) ? "" : sxPlain(en), nt: sxNorm(t), ne: "" };
    });
    for (const l of lines) if (l.en) l.ne = sxNorm(l.en);
    return sx.lines = { lang: LANG.id, lines };
  })();
  sx.linesBusy = { lang: LANG.id, p };
  return p.finally(() => { sx.linesBusy = null; });
}
// where each story file sits: "Canto III · title", "episode title · part 2"
function sxWhere() {
  if (sx.where?.idx === st.idx) return sx.where.m;
  const m = new Map();
  for (const c of [...st.idx.main, ...st.idx.other]) for (const e of c.eps || []) (e.parts || []).forEach((p, k) =>
    m.has(p[0]) || m.set(p[0], { where: `${c.label}${c.title ? ` · ${c.title}` : ""}`, ep: `${e.title || "Episode " + e.n}${e.parts.length > 1 ? ` · part ${k + 1}` : ""}` }));
  for (const s of st.idx.ident || []) for (const it of s.items || []) m.has(it.story) || m.set(it.story, { where: `Identity story · ${s.name}`, ep: it.name || "" });
  sx.where = { idx: st.idx, m };
  return m;
}
async function sxFind(q) {
  sx.q = q;
  const tabs = `<div class="sttabs" role="tablist">${ST_TABS.map(([k, n]) => `<button class="sttab" role="tab" data-tab="${k}" aria-selected="false">${n}</button>`).join("")}${sxStoryBar()}</div>`;
  $("#stpage").innerHTML = `${tabs}<div class="sxfind"><div id="sxfout"><div class="muted">Reading the story…</div></div></div>`;
  document.querySelectorAll(".sttab").forEach((b) => b.onclick = () => { location.hash = "#/story/" + b.dataset.tab; });
  let S;
  try { S = await sxLines(); } catch (e) { if ($("#sxfout")) $("#sxfout").innerHTML = `<div class="empty">Could not read the story's lines: ${esc(e.message)}</div>`; return; }
  if (!$("#sxfout") || sx.q !== q) return;
  const w = sxWords(q), phrase = /^".*"$|^«.*»$/.test(q.trim()) ? sxNorm(q) : "", wq = " " + w.join(" ");
  const hit = (t) => { t = " " + t; return phrase ? t.includes(" " + phrase) : w.length > 1 && t.includes(wq) || w.every((x) => t.includes(" " + x)); };
  const hits = [];
  if (w.length) for (const l of S.lines) { const own = hit(l.nt), byEn = !own && !!l.ne && hit(l.ne); if (own || byEn) hits.push({ l, byEn }); }
  if (!phrase && w.length > 1) hits.sort((a, b) => (" " + (b.byEn ? b.l.ne : b.l.nt)).includes(wq) - (" " + (a.byEn ? a.l.ne : a.l.nt)).includes(wq));
  const who = new Map();
  for (const { l } of hits) who.set(l.w.name, (who.get(l.w.name) || 0) + 1);
  const where = sxWhere(), rx = sxRx(q);
  let pick = null;
  const draw = () => {
    const list = pick === null ? hits : hits.filter((h) => h.l.w.name === pick);
    let last = null, h = "";
    for (const { l, byEn } of list.slice(0, 300)) {
      if (l.f !== last) { last = l.f; const p = where.get(l.f) || { where: l.f, ep: "" }; h += `<div class="sxfep"><b>${esc(p.where)}</b><span>${esc(p.ep)}</span></div>`; }
      h += `<a class="sxfl" onclick="st.back = location.hash" href="#/story/read/${encodeURIComponent(l.f)}/${l.i}"><i style="${l.w.color ? `--c:${esc(l.w.color)}` : ""}">${esc((l.w.name || "·").slice(0, 1))}</i>
        <div><b${l.w.color ? ` style="color:${esc(l.w.color)}"` : ""}>${esc(l.w.name || "—")}</b><p>${sxMark(l.t, rx)}</p>${byEn ? `<p class="sxen">${sxMark(l.en, rx)}</p>` : ""}</div><em>read ›</em></a>`;
    }
    $("#sxfout").innerHTML = `<div class="sxfsum"><b>${hits.length}</b> lines in <b>${new Set(hits.map((x) => x.l.f)).size}</b> stories</div>
      ${who.size > 1 ? `<div class="sxwho"><button class="${pick === null ? "on" : ""}" data-w="">Everyone</button>${[...who].sort((a, b) => b[1] - a[1]).slice(0, 16).map(([n, c]) => `<button class="${pick === n ? "on" : ""}" data-w="${esc(n)}" data-n="1">${esc(n || "—")} <span>${c}</span></button>`).join("")}</div>` : ""}
      ${h || `<div class="empty">${w.length ? "No line has these words." : "Type the words someone says."}</div>`}${list.length > 300 ? `<div class="muted">The first 300 of ${list.length}: add a word to narrow it.</div>` : ""}`;
    $("#sxfout").querySelectorAll("[data-w]").forEach((b) => b.onclick = () => { pick = b.dataset.n ? b.dataset.w : null; draw(); });
  };
  draw();
}
