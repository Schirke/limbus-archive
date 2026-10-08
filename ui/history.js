"use strict";
// Patches → Change history: what each patch changed in an Identity, an E.G.O, an enemy or a status — numbers and
// wording, the old text struck out and the new one marked. Read from the reports the app keeps, so it goes back only
// as far as they do. Data: /api/history (limbusdm/history.py).
let HISTORY = null;
const hv = { patch: 0, key: "", view: "diff", tech: false, q: "" };
const HV_KINDS = [["id", "Identities"], ["ego", "E.G.O"], ["enemy", "Enemies"], ["buff", "Statuses"]];

routes.changes = async (args) => {
  const main = $("#main");
  if (!HISTORY) {
    main.innerHTML = `<h1>Change history</h1><div class="muted">Reading the reports…</div>`;
    try { [HISTORY] = await Promise.all([api("/api/history"), units()]); } catch (e) { main.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  }
  if (!location.hash.startsWith("#/changes")) return;
  if (!HISTORY.patches.length) { const none = HISTORY; HISTORY = null; main.innerHTML = `<h1>Change history</h1><div class="empty">${none.cards ? "No kept report has changed a skill, a passive or a status yet. The history starts with the next patch." : "Nothing to read."}</div>`; return; }
  if (args[0] && HISTORY.cards[args[0]]) {
    hv.key = args[0];
    if (!HISTORY.patches[hv.patch].cards[hv.key]) hv.patch = HISTORY.patches.findIndex((p) => p.cards[hv.key]);
  }
  hvDraw();
};

// the words of two texts set against each other: what left is struck out, what came is marked ([Keyword]s stay whole)
function hvDiff(a, b) {
  const toks = (s) => s.match(/\[[^\]\s]+\]|\s+|[^\s\[]+|\[/g) || [];
  const x = toks(a), y = toks(b), n = x.length, m = y.length, t = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) t[i][j] = x[i] === y[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
  let i = 0, j = 0, out = "", same = "", del = "", ins = "";
  const flush = () => { out += (del ? `<del>${fmtDesc(del)}</del>` : "") + (ins ? `<ins>${fmtDesc(ins)}</ins>` : ""); del = ins = ""; };
  const keep = () => { out += fmtDesc(same); same = ""; };
  while (i < n || j < m) {
    if (i < n && j < m && x[i] === y[j]) {
      // a space inside a changed run stays in the run, so a rewritten phrase reads as one piece
      if ((del || ins) && /^ +$/.test(x[i]) && i + 1 < n && j + 1 < m && x[i + 1] !== y[j + 1]) { if (del) del += x[i]; if (ins) ins += x[i]; if (!del || !ins) { flush(); same += x[i]; } }
      else { flush(); same += x[i]; }
      i++; j++;
    } else { keep(); if (j < m && (i === n || t[i][j + 1] >= t[i + 1][j])) ins += y[j++]; else del += x[i++]; }
  }
  flush(); keep();
  return out;
}

const hvPic = (c) => { const src = c.pic ? imgThumb(c.pic) : c.app ? `/api/enemy_thumb?app=${encodeURIComponent(c.app)}` : ""; return src ? `<img src="${src}" loading="lazy" onerror="this.style.visibility='hidden'">` : "<i></i>"; };
function hvRow(r) {
  if (!hv.tech && !r.nums.length && !r.texts.length && !r.new) return "";
  const icon = r.icon ? imgThumb(r.icon) : "";
  const nums = r.nums.map(([l, o, n]) => `<span>${esc(l)} ${o} → <b class="${n < o ? "dn" : "up"}">${n}</b></span>`).join("");
  const texts = r.texts.map(([w, o, n]) => `<div class="hvtxt"><em>${esc(w)}</em>${hv.view === "diff" || !o ? hvDiff(o, n) : `<div class="hvba"><div>${fmtDesc(o)}</div><div>${fmtDesc(n)}</div></div>`}</div>`).join("");
  const tech = hv.tech && r.tech.length ? `<div class="hvtech">${r.tech.map(([p, o, n]) => (o || n ? `${esc(p)}: <span>${esc(o)}</span> → <span>${esc(n)}</span>` : esc(p))).join("<br>")}</div>` : "";
  return `<div class="hvrow ${icon ? "" : "bare"}">${icon ? `<img src="${icon}" loading="lazy" onerror="this.style.visibility='hidden'">` : ""}<div><b>${esc(r.name)}</b>${r.new ? '<span class="hvtag new">NEW</span>' : ""}${!r.nums.length && !r.texts.length && !r.new ? '<span class="hvtag">technical only</span>' : ""}
    ${nums ? `<div class="hvnums">${nums}</div>` : ""}${texts}${tech}</div></div>`;
}

function hvDraw() {
  const P = HISTORY.patches, p = P[hv.patch] || P[0], q = hv.q.trim().toLowerCase();
  const keys = Object.keys(p.cards).filter((k) => (hv.tech || p.cards[k].real) && (!q || HISTORY.cards[k].name.toLowerCase().includes(q)));
  if (!keys.includes(hv.key) && !q) hv.key = keys.slice().sort((a, b) => p.cards[b].real - p.cards[a].real)[0] || "";
  const c = HISTORY.cards[hv.key];
  const list = HV_KINDS.map(([kind, title]) => { const ks = keys.filter((k) => HISTORY.cards[k].kind === kind).sort((a, b) => p.cards[b].real - p.cards[a].real || HISTORY.cards[a].name.localeCompare(HISTORY.cards[b].name));
    return ks.length ? `<div class="hvcap">${title}</div>` + ks.map((k) => `<a class="${k === hv.key ? "on" : ""}" href="#/changes/${encodeURIComponent(k)}">${hvPic(HISTORY.cards[k])}<span>${esc(HISTORY.cards[k].name)}<small>${p.cards[k].real || "technical"} change${p.cards[k].real === 1 ? "" : "s"} · ${esc(HISTORY.cards[k].label)}</small></span></a>`).join("") : ""; }).join("");
  const line = c ? P.filter((x) => x.cards[hv.key]).map((x) => { const e = x.cards[hv.key], body = e.groups.map((g) => { const rows = g.rows.map(hvRow).join(""); return rows ? `<div class="hvcap">${g.kind}</div>${rows}` : ""; }).join("");
    return `<section><h3>${esc(x.day)}<small>${e.real} change${e.real === 1 ? "" : "s"}${x.taken ? " · snapshot of " + esc(x.taken) : ""}</small></h3>${body || '<div class="muted">Only technical fields changed — switch them on to see.</div>'}</section>`; }).join("") : "";
  const first = P[P.length - 1];
  $("#main").innerHTML = `<div id="hvpage"><h1>Change history</h1><div class="sub">What each patch changed in an Identity, an E.G.O, an enemy or a status — numbers and wording. It goes back as far as the reports kept on this PC.</div>
    <div class="hvcols"><div class="card hvlist"><div class="hvpatches">${P.map((x, i) => `<button class="toggle ${i === hv.patch ? "on" : ""}" data-p="${i}">${esc(x.day)}</button>`).join("")}</div>
        <input type="text" id="hvq" placeholder="Search a name…" value="${esc(hv.q)}">${list || '<div class="muted" style="margin-top:10px">Nothing here.</div>'}</div>
      <div>${c ? `<div class="hvhead">${hvPic(c)}<div><h2>${esc(c.name)}</h2><span class="muted">${esc(c.label)}</span></div>
          <div class="row"><div class="seg"><button data-v="diff" class="toggle ${hv.view === "diff" ? "on" : ""}">Marked changes</button><button data-v="ba" class="toggle ${hv.view === "ba" ? "on" : ""}">Before / after</button></div>
          <button data-tech class="toggle ${hv.tech ? "on" : ""}" title="Fields without a name of their own here, and texts whose only change is the game's highlight">Technical fields</button></div></div>
        <div class="hvtl">${line}<section class="old"><h3>${esc(first.from || first.day)}<small>the first kept snapshot — no history before it</small></h3></section></div>` : '<div class="muted">Pick a card on the left.</div>'}</div></div></div>`;
  const page = $("#hvpage");
  page.onclick = (e) => {
    const t = e.target.closest("[data-p],[data-v],[data-tech]");
    if (!t) return;
    if (t.dataset.p) { hv.patch = +t.dataset.p; hv.key = ""; }
    else if (t.dataset.v) hv.view = t.dataset.v;
    else hv.tech = !hv.tech;
    hvDraw();
  };
  $("#hvq").oninput = (e) => { hv.q = e.target.value; hvDraw(); const el = $("#hvq"); el.focus(); el.setSelectionRange(el.value.length, el.value.length); };
}
