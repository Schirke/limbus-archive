// Community: who streams the game right now — the live streams on Twitch and YouTube: everything together
// ("Popular") or English, Russian, Korean; sorted by viewers or by when they started, one site or both.
// (/api/community: a list made on GitHub every minute, see scripts/community.py. The menu item shows up
// once there is such a list.) While somebody big is live — a stream with at least `cm.big` viewers — the menu item
// turns into a live mark with the streamer's picture, name and viewers (cmTab; the list is read anew every minute).
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
  return `<span class="cmstamp ${min < 20 ? "" : min < 60 ? "old" : "stale"}" data-at="${esc(iso)}" title="The list was made ${esc(at.toLocaleString())}. It is made anew every minute${min < 60 ? "" : " — this one is old: the streams below may be over"}."><i></i>${min < 60 ? "Updated" : "Last update"} ${cmAgo(iso)}</span>`;
}
const cmRead = () => api("/api/community").then((d) => { cmTab(d); if (cm.fresh) cm.fresh(d); }).catch(() => {});
cmRead();
setInterval(cmRead, 60000);
setInterval(() => { const el = $(".cmstamp"); if (el) el.outerHTML = cmStamp(el.dataset.at); }, 30000);

// The recommended channels in the page's corner (the owner's list, see the end of the file): round pictures that open
// the channel; who is live right now comes first, in a red ring.
const cmInit = (name) => [...String(name).replace(/[^\p{L}\p{N}]/gu, "")].slice(0, 2).join("").toUpperCase();
function cmRec(d) {
  const list = [...((d || cm.last || {}).recommended || [])].sort((a, b) => !!b.live - !!a.live);
  return !list.length ? "" : `<div class="cmrec"><span>Recommended</span><div>${list.map((c) => `<a class="${c.live ? "live" : ""}" href="${esc(c.url)}" target="_blank" title="${esc(c.name)} · ${c.on === "twitch" ? "Twitch" : "YouTube"}${c.live ? `&#10;Live now: ${esc(c.live.title)}${c.live.viewers ? ` · ${cmK(c.live.viewers)} watching` : ""}` : ""}&#10;Open the channel in the browser">
    <span class="cmav" data-i="${esc(cmInit(c.name))}">${c.avatar ? `<img src="${esc(c.avatar)}" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}</span>${c.live ? "<i>LIVE</i>" : ""}<b>${esc(c.name)}</b></a>`).join("")}</div></div>`;
}
const cmHead = (sub, d) => `<div class="cmhead"><div><h1>Community</h1><div class="sub">${sub}</div></div>${cmRec(d)}</div>`;

// The page's tabs: the live streams, the videos on Bilibili, and — on the website — who visits it (ui/site/site.js).
const cmTabs = (on) => `<div class="cmtabs">${[["", "Live streams"], ["bilibili", "Bilibili"], ...(window.siteStatsTab && siteStatsTab() ? [["stats", "Site stats"]] : [])].map(([k, n]) => `<a class="${on === k ? "on" : ""}" href="#/community${k ? "/" + k : ""}">${n}</a>`).join("")}</div>`;

routes.community = async (args) => {
  if (args && args[0] === "bilibili") return cmBili();
  if (args && args[0] === "stats" && window.siteStats) return siteStats(args);
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
    $("#main").innerHTML = `${cmHead("Who streams Limbus Company right now, on Twitch and YouTube.", d)}${cmTabs("")}
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
  cm.fresh = (doc) => { if (location.hash.split("/")[1] !== "community" || location.hash.split("/")[2]) return void (cm.fresh = null); if (doc && doc.updated && doc.updated !== d.updated) { const y = $("#main").scrollTop; take(doc); draw(); $("#main").scrollTop = y; } };
};

// Bilibili: the game's videos there (/api/bilibili: Bilibili's own search by the game's Chinese name, asked by the app,
// kept 10 minutes) — of the last day, the last week or of all time, the most watched first or the newest first.
// A title is shown as it is, with its English translation under it.
const CB_PERIODS = [["day", "Last 24 hours"], ["week", "Last week"], ["all", "All time"]];
const CB_SORTS = [["views", "Most watched"], ["new", "Newest"]];
const cb = { period: "week", sort: "views", ...(() => { try { return JSON.parse(localStorage.getItem("community_bili") || "{}"); } catch { return {}; } })() };

async function cmBili() {
  if (!CB_PERIODS.some(([k]) => k === cb.period)) cb.period = "week";
  if (!CB_SORTS.some(([k]) => k === cb.sort)) cb.sort = "views";
  const chips = (list, key) => list.map(([k, n]) => `<button class="toggle ${cb[key] === k ? "on" : ""}" data-cb${key}="${k}">${n}</button>`).join("");
  const head = (right) => `${cmHead("Limbus Company videos on Bilibili.")}${cmTabs("bilibili")}
    <div class="dbrow">${chips(CB_PERIODS, "period")}<span class="gap"></span>${chips(CB_SORTS, "sort")}<span class="grow"></span>${right || ""}</div>`;
  const wire = () => {
    for (const key of ["period", "sort"])
      document.querySelectorAll(`[data-cb${key}]`).forEach((b) => b.onclick = () => {
        cb[key] = b.dataset["cb" + key];
        try { localStorage.setItem("community_bili", JSON.stringify(cb)); } catch {}
        cmBili();
      });
  };
  const asked = cb.period + cb.sort;
  $("#main").innerHTML = head() + `<p class="muted">Asking Bilibili…</p>`;
  wire();
  const d = await api(`/api/bilibili?period=${cb.period}&sort=${cb.sort}`).catch(() => ({ error: "no answer" }));
  if (location.hash.split("/")[2] !== "bilibili" || asked !== cb.period + cb.sort) return;
  const rows = d.videos || [];
  $("#main").innerHTML = head(d.updated ? `<span class="gmscore">${rows.length} VIDEOS</span>${cmStamp(d.updated).replace("every minute", "every 10 minutes")}` : "")
    + (d.error ? `<p class="muted">Bilibili's list could not be read (${esc(d.error)}).</p>`
    : !rows.length ? `<p class="muted">No videos here.</p>`
    : `<div class="cbgrid">${rows.map((v, i) => `<a class="cbcard" href="${esc(v.url)}" target="_blank" title="${esc(v.title)}&#10;Open the video on Bilibili">
        <span class="cmpic"><img loading="lazy" referrerpolicy="no-referrer" src="${esc(v.thumb)}@480w_270h_1c.webp" onerror="this.remove()"><i>${i + 1}</i><em>${esc(v.length)}</em></span>
        <b>${esc(v.title)}</b>${v.en ? `<span class="cben">${esc(v.en)}</span>` : ""}
        <span class="cbby">${esc(v.name)}</span>
        <small><u>${cmK(v.views)} views</u>${v.likes ? `${cmK(v.likes)} likes · ` : ""}${cmAgo(v.at).replace(/^(\d+) h \d+ min ago$/, (m, h) => h < 24 ? m : `${Math.floor(h / 24)} d ago`)}</small></a>`).join("")}</div>`);
  wire();
}

// Settings, for the owner alone (where the web copy is set up): the recommended channels — links, one a line, kept on
// GitHub (/api/community_rec); the list made there every minute then carries their names, pictures and who is live.
{
  const settings = routes.settings;
  routes.settings = async () => {
    await settings();
    const st = await api("/api/state");
    if (!st.site_publish || location.hash.split("/")[1] !== "settings") return;
    $("#main").insertAdjacentHTML("beforeend", `<h2>Community · recommended channels</h2><div class="card" id="cmrecbox">
      <div class="muted small">Shown in the corner of the Community page, in the app and on the site; who is live is marked. One link a line (or with spaces / commas between them) — YouTube (youtube.com/@name or youtube.com/channel/UC…) or Twitch (twitch.tv/name). The order here is the order there.</div>
      <textarea class="mono" id="cmreclines" spellcheck="false" placeholder="Reading the list from GitHub…" disabled></textarea>
      <div><button class="primary" id="cmrecsave" disabled>Save</button> <span class="muted small" id="cmrecsaid"></span></div>
      <div id="cmrecnow"></div></div>`);
    const now = (lines) => { const got = (cm.last || {}).recommended || [], miss = lines.filter((l) => !got.some((c) => c.src === l));
      $("#cmrecnow").innerHTML = cmRec({ recommended: got.filter((c) => lines.includes(c.src)) }) + (miss.length ? `<div class="muted small">Not on the page yet: ${miss.map(esc).join(", ")} — a new link shows up within 5–10 minutes; one that never does is not a channel's address.</div>` : ""); };
    const d = await api("/api/community_rec").catch(() => ({ lines: [], error: "no answer" }));
    if (!$("#cmreclines")) return;
    $("#cmreclines").value = d.lines.join("\n");
    $("#cmreclines").placeholder = "https://www.youtube.com/@name";
    $("#cmrecsaid").innerHTML = d.error ? `<span class="bad">GitHub could not be read: ${esc(d.error)}</span>` : "";
    $("#cmreclines").disabled = $("#cmrecsave").disabled = !!d.error;
    now(d.lines);
    $("#cmrecsave").onclick = async () => {
      $("#cmrecsave").disabled = true;
      $("#cmrecsaid").textContent = "Saving…";
      const r = await api("/api/community_rec", { lines: $("#cmreclines").value.split("\n") }).catch(() => ({ error: "no answer" }));
      if (!$("#cmrecsave")) return;
      $("#cmrecsave").disabled = false;
      $("#cmrecsaid").innerHTML = r.error ? `<span class="bad">Not saved: ${esc(r.error)}</span>` : "Saved — on the page within 5–10 minutes";
      if (!r.error) { $("#cmreclines").value = r.lines.join("\n"); now(r.lines); }
    };
  };
}
