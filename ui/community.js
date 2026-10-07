// Community: who streams the game right now — the live streams on Twitch and YouTube: everything together
// ("Popular") or English, Russian, Korean; sorted by viewers or by when they started, one site or both.
// (/api/community: a list made on GitHub every quarter of an hour, see scripts/community.py. The menu item shows up
// once there is such a list.) While somebody big is live — a stream with at least `cm.big` viewers — the menu item
// turns into a live mark with the streamer's picture, name and viewers (cmTab; the list is read anew every 3 minutes).
// The page says when the list was made (cmStamp): green while fresh, gold after 20 minutes, red after an hour.
"use strict";

const CM_LANGS = [["all", "Popular"], ["en", "English"], ["ru", "Русский"], ["ko", "한국어"]];
const CM_SORTS = [["viewers", "Viewers"], ["new", "Just started"], ["long", "Longest live"]];
const CM_SITES = [["", "All"], ["twitch", "Twitch"], ["youtube", "YouTube"]];
const CM_BIG = [["100", "100+"], ["300", "300+"], ["1000", "1000+"], ["0", "Off"]];
const cm = { lang: "all", sort: "viewers", site: "", big: "300", ...(() => { try { return JSON.parse(localStorage.getItem("community") || "{}"); } catch { return {}; } })() };
const cmAgo = (iso) => { const m = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000));
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ${m % 60} min ago`; };
const cmFor = (iso) => { const m = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };

const cmK = (n) => n < 1000 ? String(n) : (n / 1000).toFixed(n < 100000 ? 1 : 0).replace(/\.0$/, "") + "K";

function cmTab(d) {
  const a = $("#navcommunity");
  if (d) cm.last = d;
  d = cm.last;
  if (!a || !d || !d.updated) return;
  a.hidden = false;
  // (a list older than an hour says nothing about now)
  const big = +cm.big && Date.now() - new Date(d.updated) < 3600e3 ? ["en", "ru", "ko"].flatMap((k) => d[k] || []).filter((s) => s.viewers >= +cm.big).sort((x, y) => y.viewers - x.viewers) : [];
  const s = big[0];
  a.classList.toggle("live", !!s);
  a.title = s ? `${big.length > 1 ? `${big.length} big streams are live — the biggest: ` : "Live now: "}${s.name} · ${s.title}` : "";
  a.innerHTML = !s ? "Community" : `<span class="cmav" data-i="${esc([...s.name.replace(/[^\p{L}\p{N}]/gu, "")].slice(0, 2).join("").toUpperCase())}">${s.avatar ? `<img src="${esc(s.avatar)}" onerror="this.remove()">` : ""}</span>${esc(s.name)}<i>${cmK(s.viewers)}${big.length > 1 ? ` · +${big.length - 1}` : ""}</i>`;
}
// When the list was made: a plate that keeps counting while the page is open.
function cmStamp(iso) {
  const min = (Date.now() - new Date(iso)) / 60000, at = new Date(iso);
  return `<span class="cmstamp ${min < 20 ? "" : min < 60 ? "old" : "stale"}" data-at="${esc(iso)}" title="The list was made ${esc(at.toLocaleString())}. It is made anew every 5 minutes${min < 60 ? "" : " — this one is old: the streams below may be over"}."><i></i>${min < 60 ? "Updated" : "Last update"} ${cmAgo(iso)}</span>`;
}
const cmRead = () => api("/api/community").then((d) => { cmTab(d); if (cm.fresh) cm.fresh(d); }).catch(() => {});
cmRead();
setInterval(cmRead, 180000);
setInterval(() => { const el = $(".cmstamp"); if (el) el.outerHTML = cmStamp(el.dataset.at); }, 30000);

routes.community = async () => {
  $("#main").innerHTML = `<h1>Community</h1><div class="sub">Who streams Limbus Company right now.</div><p class="muted">Reading the list…</p>`;
  let d = await api("/api/community").catch(() => ({}));
  cmTab(d);
  if (!CM_LANGS.some(([k]) => k === cm.lang)) cm.lang = "all";
  let every = [];
  const take = (doc) => { d = doc; every = CM_LANGS.slice(1).flatMap(([k, name]) => (d[k] || []).map((s) => ({ ...s, lang: name }))); };
  take(d);
  const chips = (list, key) => list.map(([k, n]) => `<button class="toggle ${cm[key] === k ? "on" : ""}" data-${key}="${k}">${n}</button>`).join("");
  const draw = () => {
    const started = (s) => new Date(s.started || 0).getTime();
    const rows = every.filter((s) => (cm.lang === "all" || s.lang === CM_LANGS.find(([k]) => k === cm.lang)[1]) && (!cm.site || s.on === cm.site))
      .sort((a, b) => cm.sort === "new" ? started(b) - started(a) : cm.sort === "long" ? (started(a) || 9e15) - (started(b) || 9e15) : b.viewers - a.viewers);
    $("#main").innerHTML = `<h1>Community</h1>
      <div class="sub">Who streams Limbus Company right now, on Twitch and YouTube.</div>
      <div class="dbrow">${chips(CM_LANGS, "lang")}<span class="gap"></span>${chips(CM_SITES, "site")}
        <span class="grow"></span><span class="gmscore">${d.updated ? `${rows.length} LIVE` : ""}</span>${d.updated ? cmStamp(d.updated) : ""}</div>
      <div class="dbrow">${chips(CM_SORTS, "sort")}<span class="grow"></span><span class="muted small" title="The Community button in the menu shows who is live while a stream has this many viewers">Show in the menu a stream with</span>${chips(CM_BIG, "big")}</div>
      ${!d.updated ? `<p class="muted">The list isn't there yet — no connection, or it hasn't been published.</p>`
      : !rows.length ? `<p class="muted">Nobody is live here right now.</p>`
      : `<div class="cmlist">${rows.map((s, i) => `<a class="cmrow" href="${esc(s.url)}" target="_blank" title="Open the stream in the browser">
          <span class="cmn">${i + 1}</span><span class="cmpic"><img loading="lazy" src="${esc(s.thumb)}" onerror="this.remove()"><i>LIVE</i></span>
          <span class="cmtext"><b>${esc(s.title)}</b><span>${esc(s.name)}</span>
            <small><u class="cm-${esc(s.on)}">${s.on === "twitch" ? "Twitch" : "YouTube"}</u>${cm.lang === "all" ? `<u>${esc(s.lang)}</u>` : ""}${s.started ? ` live for ${cmFor(s.started)}` : ""}</small></span>
          <span class="cmview"><b>${Number(s.viewers).toLocaleString("en")}</b>watching</span></a>`).join("")}</div>`}`;
    for (const key of ["lang", "site", "sort", "big"])
      document.querySelectorAll(`[data-${key}]`).forEach((b) => b.onclick = () => {
        cm[key] = b.dataset[key];
        try { localStorage.setItem("community", JSON.stringify({ lang: cm.lang, sort: cm.sort, site: cm.site, big: cm.big })); } catch {}
        cmTab();
        draw();
      });
  };
  draw();
  // a newer list read while the page is open (cmRead) is shown at once
  cm.fresh = (doc) => { if (location.hash.split("/")[1] !== "community") return void (cm.fresh = null); if (doc && doc.updated && doc.updated !== d.updated) { take(doc); draw(); } };
};
