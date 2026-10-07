// Patches -> News: the developers' weekly update notices from the game's Steam page (/api/news, limbusdm/news.py),
// each next to the patch it is about in the archive; the same notice sits on top of that patch's report.
"use strict";

const nw = { doc: null, at: 0 };
const nwLoad = async (force) => {
  if (force || !nw.doc || Date.now() - nw.at > 10 * 60000) { nw.doc = await api("/api/news" + (force ? "?force=1" : "")); nw.at = Date.now(); }
  return nw.doc;
};
// times are shown as Moscow time, like the reset timers
const nwDate = (ts, o) => new Date(ts * 1000).toLocaleString("en-GB", { timeZone: "Europe/Moscow", ...o });
const nwDay = (ts) => nwDate(ts, { weekday: "short", day: "numeric", month: "short" });
const nwTime = (ts) => nwDate(ts, { hour: "2-digit", minute: "2-digit" });
const nwLeft = (ts) => { const m = Math.ceil((ts * 1000 - Date.now()) / 60000), d = Math.floor(m / 1440);
  return (d ? d + " d " : "") + Math.floor(m % 1440 / 60) + " h" + (d ? "" : " " + m % 60 + " min"); };
const nwChanges = (s) => s ? s.leaks + s.foreign_only + s.texts + s.data + s.audio + s.video + s.code : 0;
const nwState = (p) => p.report ? `<span class="nwlink">in the archive</span>`
  : p.time * 1000 > Date.now() ? `<span class="nwlink soon">in ${nwLeft(p.time)}</span>`
  : p.snapshot ? `<span class="nwlink">first snapshot</span>` : `<span class="nwlink none">not in the archive</span>`;
const nwPost = (x) => `${x.images.map((u) => `<img loading="lazy" src="${esc(u)}" data-full="${esc(u)}" alt="">`).join("")}${x.text ? `<div class="nwtext">${esc(x.text)}</div>` : ""}`;
const nwZoom = (root) => root.querySelectorAll("img[data-full]").forEach((i) => { i.onclick = () => window.open(i.dataset.full, "_blank"); i.onerror = () => i.remove(); });

function nwReader(p) {
  const n = p.notice, s = p.summary, up = p.time * 1000 > Date.now();
  return `<div class="nwhead"><span class="nwmeta">POSTED ${nwDay(n.posted).toUpperCase()} · ${nwTime(n.posted)} MSK &nbsp;·&nbsp; PATCH ${nwDay(p.time).toUpperCase()} · ${nwTime(p.time)} MSK</span>
      <a href="${esc(n.url)}" target="_blank" title="Open the post on Steam in the browser">Open on Steam ↗</a></div>
    <h2 class="nwtitle">${esc(n.title)}</h2>
    <div class="nwmatch ${p.report ? "" : "none"}">${p.report ? `<div><small>IN YOUR ARCHIVE</small><b>${esc(fmtVer(p.report.split("__")[1]))}</b></div>
        <div class="nwnums"><span><b>${s ? s.leaks + s.foreign_only : 0}</b>highlights</span><span><b>${s ? s.texts : 0}</b>texts</span><span><b>${s ? s.data : 0}</b>data</span><span><b>${s ? s.audio + s.video : 0}</b>audio / video</span></div>
        <a class="nwopen" href="#/patches/${esc(p.report)}">Open report →</a>`
      : up ? `<div><small>NOT OUT YET</small><b>The patch lands in ${nwLeft(p.time)}</b></div><div class="nwnote">Its report appears here once the game has downloaded it.</div>`
      : p.snapshot ? `<div><small>IN YOUR ARCHIVE</small><b>Your first snapshot</b></div><div class="nwnote">Nothing older to compare it with, so there is no report.</div>`
      : `<div><small>NOT IN YOUR ARCHIVE</small><b>No snapshot of this patch</b></div><div class="nwnote">The archive keeps only what the game downloaded while the app was in use.</div>`}</div>
    <div class="nwbody">${nwPost(n)}${p.extra.map((x) => `<h3>${esc(x.title)}</h3>
      <div class="nwmeta">POSTED ${nwDay(x.posted).toUpperCase()} · <a href="${esc(x.url)}" target="_blank">Steam ↗</a></div>${nwPost(x)}`).join("")}</div>`;
}

routes.news = async ([day]) => {
  const main = $("#main");
  if (!nw.doc) main.innerHTML = `<h1>News</h1><div class="sub">The developers' update notices from Steam.</div><p class="muted">Reading the notices…</p>`;
  let d;
  try { d = await nwLoad(); } catch (e) { main.innerHTML = `<h1>News</h1><div class="empty">${esc(e.message)}</div>`; return; }
  const draw = () => {
    const ps = d.patches, cur = ps.find((p) => p.day === day) || ps[0];
    if (!cur) { main.innerHTML = `<h1>News</h1><div class="empty">No notices yet${d.error ? ": Steam didn't answer (" + esc(d.error) + ")" : ""}.</div>`; return; }
    main.innerHTML = `<div class="row"><div class="grow"><h1>News</h1>
        <div class="sub">The developers' update notices from Steam: posted on Monday, the patch lands on Thursday. Each one next to its patch in your archive.</div></div>
      <div class="row" style="gap:10px"><span class="nwmeta">${d.error ? "STEAM DIDN'T ANSWER · SAVED LIST" : d.checked ? "CHECKED " + nwDay(d.checked).toUpperCase() + " " + nwTime(d.checked) : ""}</span><button id="nwre">Refresh</button></div></div>
      <div class="nwfeed"><div class="nwlist">${ps.map((p) => `<a class="nwitem ${p === cur ? "on" : ""}" href="#/news/${p.day}">
          <span class="nwmeta"><b>${nwDay(p.time).toUpperCase()}</b>${nwState(p)}</span>
          <span class="nwt">${esc(p.notice.title)}</span>${p.extra.length ? `<span class="nwx">+ ${p.extra.map((x) => esc(x.title)).join(" · ")}</span>` : ""}</a>`).join("")}</div>
        <div class="nwread">${nwReader(cur)}</div></div>`;
    nwZoom(main);
    const on = main.querySelector(".nwitem.on");
    if (on && routes.news.top != null) main.querySelector(".nwlist").scrollTop = routes.news.top;
    main.querySelector(".nwlist").onscroll = (e) => { routes.news.top = e.target.scrollTop; };
    $("#nwre").onclick = async (e) => {
      e.target.disabled = true;
      try { d = await nwLoad(true); } catch {}
      if (location.hash.startsWith("#/news")) draw();
    };
  };
  draw();
};

// on a patch's report: a line with the developers' notice for that patch, opened in place
const nwRender = renderReport;
renderReport = async function (id, keepTab) {
  await nwRender(id, keepTab);
  let d;
  try { d = await nwLoad(); } catch { return; }
  const m = /^s(\d{4})(\d\d)(\d\d)_/.exec(id.split("__")[1] || ""), tabs = $("#main .tabs");
  const p = d.patches.find((x) => x.report === id) || (m && d.patches.find((x) => x.day === `${m[1]}-${m[2]}-${m[3]}`));
  if (!p || !tabs || $("#nwrep") || !location.hash.includes(id)) return;
  tabs.insertAdjacentHTML("beforebegin", `<div id="nwrep" class="nwrep"><small>OFFICIAL NOTES</small><b>${esc(p.notice.title)}</b>
    <span class="nwmeta">POSTED ${nwDay(p.notice.posted).toUpperCase()}${p.extra.length ? " · + " + p.extra.length + " MORE" : ""}</span>
    <span class="grow"></span><button id="nwrepread">Read</button><a href="${esc(p.notice.url)}" target="_blank">Steam ↗</a></div>`);
  $("#nwrepread").onclick = () => { modal(`<div class="nwread nwmodal">${nwReader(p)}</div>`); nwZoom($("#modal-body"));
    const o = $("#modal-body .nwopen"); if (o) o.remove(); };
};
