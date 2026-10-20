"use strict";
// The web copy's tweaks over the app's scripts: stubs for app-only pages, hidden controls, the footer.
(() => {
  // the pages the site has data for: decided when the site is made (limbusdm/site.py PAGES, verify)
  const repo = "https://github.com/Schirke/limbus-archive";
  const OPEN = new Set(SITE.open || []);
  // "?check": the app checking its site. The front page (site only): latest Identities' art, latest patch, sections
  OPEN.add("home");
  // a section page opens the app on it
  if (location.hash.length < 3) {
    const page = location.pathname.replace(/^\/+|\/+$|\.html$/g, "");
    history.replaceState(null, "", "/" + location.search + "#/" + (page && page !== "index" ? page : "home"));
  }
  const titled = () => {
    const h = location.hash.slice(2).split("/"), t = (SITE.titles || {})[h[0] === "games" && h[1] === "track" ? "games/track" : h[0]];
    document.title = t && h[0] !== "home" ? `${t} · Limbus Company · Limbus Archive` : "Limbus Archive";
  };
  window.addEventListener("hashchange", titled);
  titled();
  // a card's own address: its page shows the card's picture in a link preview (limbusdm/site.py card_pages)
  window.siteLink = (path) => `<button class="sitelink" data-link="${esc(path)}" title="Copy a link to this card: Discord and others show its picture">Copy link</button>`;
  // the row under a video: the file, a GIF, PNG frames (made at the end of this file); alpha = a transparent video
  window.siteDl = (url, name, alpha) => `<div class="sdl" data-url="${esc(url)}" data-name="${esc(name)}"${alpha ? " data-alpha" : ""}><small>Download</small><button data-k="video">Video</button><button data-k="gif" title="a looping GIF under 10 MB">GIF</button><button data-k="png" title="every frame as a PNG, in a zip">PNG frames</button>${alpha ? `<span class="sdlbg"><small>GIF / frames on</small><button class="on" data-bg="clear">Transparent</button><button data-bg="black">Black</button></span>` : ""}</div>`;
  document.addEventListener("click", (ev) => {
    const b = ev.target.closest && ev.target.closest("[data-link]");
    if (!b) return;
    const url = `${location.origin}/${b.dataset.link}`;
    navigator.clipboard.writeText(url).then(() => { b.textContent = "Copied"; setTimeout(() => { b.textContent = "Copy link"; }, 1500); },
      () => prompt("Link to this card:", url));
  });
  document.querySelector("#top .brand").setAttribute("href", "#/home");
  const HOME_TILES = [
    ["patches", "patches", "Patches", "What every update changed: new units, highlights, texts, pictures, sounds.", "BottomMenu_1_11"],
    ["db", "db", "Identities & E.G.O", "Skills, coins, passives and the full art of every unit.", "BottomMenu_1_10"],
    ["enemies", "enemies", "Enemies", "Enemies and Abnormalities with their skills and their battle look.", "BottomMenu_1_12"],
    ["anim", "anim", "Animations", "Spine models and skills played with the game's own effects.", "BottomMenu_1_9"],
    ["stages", "stages", "Story map", "Every Canto's stages: who stands there and what waits.", "BottomMenu_1_11"],
    ["games", "games", "Games", "Guessers and live matches with friends. Lunacy for the Extraction.", "Settings_3_20"],
    ["teams", "teams", "Team builder", "Put a team together and share it as a link.", "BottomMenu_1_14"],
    ["community", "community", "Community", "Who streams Limbus right now, channels worth a look.", "BottomMenu_1_13"],
  ];
  let homeTimer = 0;
  // report counts without code / paths / other
  const homeChips = (sum) => `<div class="chips">${SUMMARY_LABELS.filter(([k]) => sum && sum[k] && !/^(code|catalog_added|other)$/.test(k)).map(([k, l]) =>
    `<span class="chip ${k === "leaks" || k === "foreign_only" ? "leak" : ""}"><b>${sum[k]}</b> ${l}</span>`).join("") || `<span class="chip">no content changes</span>`}</div>`;
  routes.home = async () => {
    const main = $("#main"), here = () => !!main.querySelector(".home");
    clearInterval(homeTimer);
    main.innerHTML = `<div class="home"><div class="hhero"></div></div>`;
    let ids = typeof UNITS !== "undefined" && UNITS && UNITS.ids || [];
    const day = (r) => { const m = /^build (\d\d\.\d\d)\.(\d{4}) · taken (.+)$/.exec(fmtSnap(r.new)); return m ? { d: m[1], y: m[2], taken: m[3] } : { d: fmtSnap(r.new), y: "", taken: "" }; };
    const draw = () => {
      if (!here()) return;
      const byDate = [...ids].sort((a, b) => (b.date || "").localeCompare(a.date || "") || b.id - a.id);
      const newest = byDate.length ? byDate[0].date || "" : "";
      // banner: the newest Identities in turn
      const slides = byDate.filter((x) => x.date === newest && x.img && x.img.art).slice(0, 6);
      const games = document.querySelectorAll("#subnav a[data-game]").length;
      const reps = STATE && STATE.reports || [], last = reps[0], prev = reps[1];
      const a = last && day(last), b = prev && day(prev);
      main.querySelector(".home").innerHTML = `<div class="hhero"><i class="hart"></i><i class="hart"></i>
          <div class="hsay"><span class="hkick">Unofficial Limbus Company fan archive</span>
            <div class="hname">Limbus<br><b>Archive</b></div>
            <p>Everything a patch brings, the day it lands: new Identities and E.G.O, enemies, battle animations, story stages and music${games ? ` — plus ${games} mini-games to play with friends` : ""}.</p>
            <div class="hgo">${last ? `<a class="hbig" href="#/patches/${encodeURIComponent(last.id)}">Latest patch</a>` : ""}<a class="hbtn" href="#/db">Browse Identities</a><a class="hbtn" href="${repo}/releases/latest" target="_blank" rel="noopener">Get the app</a></div>
          </div>
          ${last ? `<div class="hlast"><a href="#/patches/${encodeURIComponent(last.id)}"><span class="hkick">Latest patch</span><b class="hday">${esc(a.d)}${a.y ? `<small>.${esc(a.y)}</small>` : ""}</b>${homeChips(last.summary)}</a>
            ${prev ? `<a class="hprev" href="#/patches/${encodeURIComponent(prev.id)}"><span class="hkick dim">Before that · ${esc(b.d)}</span>${homeChips(prev.summary)}</a>` : ""}</div>` : ""}
          ${slides.length ? `<div class="hwho"><a id="hwho"></a>${slides.length > 1 ? `<span class="hdots">${slides.map((x, i) => `<button data-i="${i}" title="${esc(x.title)}"></button>`).join("")}</span>` : ""}</div>` : ""}
        </div>
        <div class="hsect"><h2>What is inside</h2></div>
        <div class="htiles">${HOME_TILES.filter(([name]) => OPEN.has(name)).map(([name, pic, title, text, icon]) => `<a class="htile" href="#/${name}">
          <i class="hpic" style="background-image:url(/ui/site/home/${pic}.webp)"></i><span class="htx"><b><i style="background-image:url(/api/gacha_ui?n=MainUI_${icon})"></i>${esc(title)}</b><span>${esc(text)}</span></span></a>`).join("")}</div>
        ${byDate.length ? `<div class="hsect"><h2>Newest Identities</h2><a href="#/db">All Identities ›</a></div>
        <div class="hids">${byDate.slice(0, 8).map((x) => dbCard(x, newest)).join("")}</div>` : ""}`;
      main.querySelectorAll(".hids [data-u]").forEach((c) => { c.onclick = () => openUnit(+c.dataset.u); });
      if (!slides.length) return;
      // two layers, one fading into the other: a picture is shown when it has arrived
      const layers = main.querySelectorAll(".hart"), who = $("#hwho");
      let at = -1, top = 0;
      const show = (i) => {
        // phone: the art after uptie 3 (when there is one) fits the tall banner better
        const x = slides[i], url = matchMedia("(max-width: 900px)").matches && x.pics.art2 || x.pics.art, im = new Image();
        im.onload = () => {
          if (!who.isConnected) return;
          top ^= 1; at = i;
          layers[top].style.backgroundImage = `url("${url}")`;
          layers[top].classList.add("on"); layers[top ^ 1].classList.remove("on");
          who.innerHTML = `<small>New Identity</small><b>${esc(x.title)}</b><span>${esc(x.sinnerName)}</span>`;
          who.onclick = () => openUnit(x.id);
          main.querySelectorAll(".hdots button").forEach((d, n) => d.classList.toggle("on", n === i));
        };
        im.src = url;
      };
      const turn = () => {
        clearInterval(homeTimer);
        if (slides.length > 1) homeTimer = setInterval(() => { if (!who.isConnected) return clearInterval(homeTimer); if (!document.hidden) show((at + 1) % slides.length); }, 7000);
      };
      main.querySelectorAll(".hdots button").forEach((d) => { d.onclick = () => { show(+d.dataset.i); turn(); }; });
      show(0); turn();
    };
    // (drawn once the app's state is here, again when the Identities come: their pack can be slow)
    let drawn = false;
    const first = () => { drawn = true; draw(); };
    if (typeof STATE !== "undefined" && STATE) first(); else refresh.hook = () => { refresh.hook = null; first(); };
    if (!ids.length) units().then((u) => { ids = u && u.ids || []; if (drawn && ids.length) draw(); }).catch(() => { /* the page without the Identities then */ });
  };
  const checking = new URLSearchParams(location.search);
  if (checking.has("check")) {
    const all = Object.keys(routes);
    for (const name of all) OPEN.add(name);
    // settled: nothing asked for 1.5 s
    const most = +checking.get("settle") || 6000, t0 = Date.now();
    let last = -1, since = t0;
    const tick = setInterval(async () => {
      const w = await fetch("/api/_busy").then((r) => r.json()).catch(() => null);
      const now = Date.now();
      if (w && (w.busy || w.n !== last)) { last = w.n; since = now; }
      if (now - t0 < most && (!w || now - t0 < 2000 || now - since < 1500)) return;
      clearInterval(tick);
      const list = await fetch("/api/_misses").then((r) => r.json()).catch(() => []);
      const el = Object.assign(document.createElement("script"), { type: "application/json", id: "site-check" });
      el.textContent = JSON.stringify({ routes: all, misses: list });
      document.head.appendChild(el);
    }, 300);
  }
  // Visitor count: a page reports what it opened, at once, every 10 min and when hidden. Nothing kept in the browser.
  if (!checking.has("check")) {
    let opened = [], shut = false;
    const here = () => [location.hash.split("/")[1] || "home", ""];
    const tell = (leaving) => {
      if (shut) return;
      const body = JSON.stringify({ p: here()[0], o: opened.splice(0) });
      if (leaving) { try { navigator.sendBeacon("/stat/hit", body); } catch (e) { /* not counted */ } return; }
      fetch("/stat/hit", { method: "POST", keepalive: true, body }).then((r) => { if (r.status === 410) shut = true; }).catch(() => {});
    };
    window.addEventListener("hashchange", () => { if (opened.length < 50) opened.push(here()); });
    opened.push(here());
    // a card opened by click or by link
    if (typeof openUnit === "function") {
      const open = openUnit;
      window.openUnit = function (id) { if (/^\d{5}$/.test(String(id)) && opened.length < 50) opened.push(["db", String(id), 1]); return open.apply(this, arguments); };
    }
    tell();
    setInterval(() => { if (!document.hidden) tell(); }, 600e3);
    document.addEventListener("visibilitychange", () => { if (document.hidden && opened.length) tell(true); });
  }
  const statKey = () => { try { return localStorage.getItem("statskey") || ""; } catch (e) { return ""; } };
  window.siteStatsTab = () => SITE.stats !== "key" || !!statKey();
  const stv = { range: "day" };
  const stRows = (list) => {
    const total = list.reduce((a, r) => a + r[1], 0), top = Math.max(1, ...list.map((r) => r[1]));
    return !list.length ? `<div class="muted">Nothing yet.</div>` : `<div class="strows">${list.map(([n, c]) =>
      `<div><span>${esc(n)}</span><i><u style="width:${(c / top * 100).toFixed(1)}%"></u></i><b>${c}</b><em>${Math.round(c / total * 100)}%</em></div>`).join("")}</div>`;
  };
  const stPage = (name) => { if (name === "home") return "Home"; const a = document.querySelector(`#top a[href="#/${name}"], #subnav a[href="#/${name}"]`); return a ? a.textContent.trim() : name; };
  window.siteStats = async (args) => {
    if (args[1]) { try { localStorage.setItem("statskey", args[1]); } catch (e) { /* asked for each time then */ } location.replace("#/community/stats"); return; }
    const main = $("#main"), head = `${cmHead("Who opens Limbus Archive, from where, and what they look at.")}${cmTabs("stats")}`;
    main.innerHTML = `${head}<p class="muted">Reading the count…</p>`;
    const r = await fetch("/stat/get?k=" + encodeURIComponent(statKey()), { cache: "no-store" }).catch(() => null);
    const d = r && r.ok ? await r.json().catch(() => null) : null;
    if (location.hash.split("/")[2] !== "stats") return;
    if (!d) { main.innerHTML = `${head}<div class="empty">${r && r.status === 403 ? "This page is the owner's." : "The count didn't answer. Try again in a minute."}</div>`; return; }
    try { await units(); } catch (e) { /* ids instead of names */ }
    const region = (() => { try { return new Intl.DisplayNames(["en"], { type: "region" }); } catch (e) { return null; } })();
    const country = (cc) => { try { return (cc !== "??" && region && region.of(cc)) || "Unknown"; } catch (e) { return "Unknown"; } };
    const unit = (id) => { const x = typeof unitById === "function" && unitById(+id); return x ? (x.title ? `${x.title} ${x.sinnerName || ""}`.trim() : x.name) : id; };
    const part = (set, pre, name, most) => Object.entries(set).filter(([k]) => k.startsWith(pre)).map(([k, n]) => [name(k.slice(pre.length)), n]).sort((a, b) => b[1] - a[1]).slice(0, most);
    // spent this period (owner view)
    const spent = () => {
      const u = d.spent, m = u && u.most;
      if (!m) return "";
      const one = (name, n, most) => most ? `${name} ${n.toLocaleString("en")} of ${most.toLocaleString("en")} (${Math.round(n / most * 100)}%)` : "";
      return `<p class="muted small">Server allowance since ${esc(u.period)}: ${[one("requests", u.w, m.w), one("object requests", u.d, m.d), one("rows written", u.r, m.r)].filter(Boolean).join(" · ")}.${
        u.off ? ` <b>Reached: the count and the live rooms are closed until ${new Date(u.until).toISOString().slice(0, 10)}.</b>` : ""}</p>`;
    };
    const draw = () => {
      const s = d.sets[stv.range], y = (k) => (d.sets.prev[k] || 0) - (d.sets.day[k] || 0);
      const pages = part(s, "pg:", (k) => k, 999).filter(([k]) => routes[k]);  // (a name anybody could send is not a page)
      const played = pages.filter(([k]) => /^(game(?!s$)|live)/.test(k));
      const games = played.reduce((a, [, n]) => a + n, 0);
      const diff = (s.v || 0) - y("v"), top = Math.max(10, Math.ceil(Math.max(...d.days.map((x) => x[1])) / 10) * 10);
      const ticks = [0, 1, 2, 3, 4].map((i) => top / 4 * i);
      const where = Object.entries(d.online.reduce((o, p) => { o[p] = (o[p] || 0) + 1; return o; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([p, n]) => `${n} in ${esc(stPage(p))}`).join(", ");
      main.innerHTML = `${head}
        <div class="sthead"><div class="seg" id="strange">${[["day", "Today"], ["week", "7 days"], ["month", "30 days"]].map(([k, n]) => `<button data-r="${k}" class="toggle ${stv.range === k ? "on" : ""}">${n}</button>`).join("")}</div></div>
        <div class="sttiles">
          <div><small>Visitors</small><b>${s.v || 0}</b><span>${stv.range === "day" ? `${diff > 0 ? "+" : ""}${diff} vs yesterday` : "a browser counts once a day"}</span></div>
          <div><small>Pages opened</small><b>${s.p || 0}</b><span>${s.v ? ((s.p || 0) / s.v).toFixed(1) + " per visitor" : "&nbsp;"}</span></div>
          <div><small>Games opened</small><b>${games}</b><span>${played.length ? esc(stPage(played[0][0])) + " leads" : "&nbsp;"}</span></div>
          <div><small>On the site now</small><b><i class="stlive"></i>${d.online.length}</b><span>${where || "&nbsp;"}</span></div>
        </div>
        <div class="stcols">
          <div class="card wide"><h3>Visitors by day</h3><div class="muted small">Last 14 days (UTC). The lighter bar is today, still filling.</div>
            <div class="stplot"><div class="styax">${ticks.map((t) => `<span style="bottom:${t / top * 100}%">${t}</span>`).join("")}</div>
              <div class="starea">${ticks.slice(1).map((t) => `<i style="bottom:${t / top * 100}%"></i>`).join("")}
                <div class="stbars">${d.days.map(([day, v], i) => `<div class="${i === d.days.length - 1 ? "last" : ""}" title="${day.slice(8)}.${day.slice(5, 7)} · ${v} visitors"><u style="height:${v / top * 100}%"></u></div>`).join("")}</div></div>
              <div class="stxax">${d.days.map(([day], i) => `<span>${i % 2 ? "" : `${day.slice(8)}.${day.slice(5, 7)}`}</span>`).join("")}</div></div></div>
          <div class="card"><h3>Where from</h3><div class="muted small">Country of each visitor.</div>${stRows(part(s, "cc:", country, 8))}</div>
          <div class="card"><h3>Most opened pages</h3><div class="muted small">Share of the pages listed.</div>${stRows(pages.slice(0, 8).map(([k, n]) => [stPage(k), n]))}</div>
          <div class="card"><h3>Most viewed in the database</h3><div class="muted small">Identities and E.G.O people opened most.</div>${stRows(part(s, "u:", unit, 6))}</div>
          <div class="card"><h3>Devices</h3><div class="muted small">What the site was opened on.</div>${stRows(part(s, "dv:", (k) => k, 3))}</div>
        </div>
        <p class="muted small">A visitor is one browser per day. The site keeps only daily totals: no names, no addresses, no cookies. Countries come from Cloudflare. Counting started on 8 October 2026.</p>${spent()}`;
      main.querySelectorAll("#strange button").forEach((b) => { b.onclick = () => { stv.range = b.dataset.r; draw(); }; });
    };
    draw();
  };
  // Animations on the site: Spine and battle tabs; "With effects" for videos sent here
  let FXS = {};
  const fxList = fetch("/api/site_fx").then((r) => (r.ok ? r.json() : {})).then((j) => { FXS = j || {}; }).catch(() => {});
  const fxHas = (id, v) => (FXS[id] || []).includes(v);
  // an enemy's "Animations →" in the handbook: shown when its videos were sent here (ui/enemies.js)
  window.siteHasFx = (id) => !!FXS[id];
  if (typeof openAnimEntry === "function") {
    const open = openAnimEntry;
    window.openAnimEntry = async (sel) => {
      anim.sel = sel;  // draw the list before waiting
      await fxList;
      const mine = sel && sel.cid != null && !sel.spine;  // (an enemy has only the With effects tab)
      if (mine && !sel.enemy) {
        sel.videos = sel.videos || [];
        if (!FXS[sel.cid]) sel.slots = sel.slots || {};  // (the skills' names are here only with the videos)
        const c = findChar(sel.cid);
        // first tab: sent videos, else Spine, else clips
        if (!/^(battle$|spine)/.test(anim.tab || "") && !(anim.tab === "fx" && FXS[sel.cid])) anim.tab = FXS[sel.cid] ? "fx" : c && c.spine.length ? "spine0" : "battle";
      }
      const show = () => { const b = document.querySelector('#aview .an-tabs [data-t="fx"]'); if (b) b.classList.toggle("onsite", !!(mine && FXS[sel.cid])); };
      // phones show the list or the picked one, not both
      const app = document.querySelector(".an-app");
      if (app && !app.classList.contains("anopen")) {
        const top = (y) => { const m = $("#main"), d = document.scrollingElement, was = m.scrollTop || d.scrollTop; m.scrollTop = d.scrollTop = y; return was; };
        if (!app.querySelector(".an-back")) app.insertAdjacentHTML("afterbegin", `<button class="an-back">‹ All characters</button>`);
        const was = matchMedia("(max-width: 900px)").matches ? top(0) : 0;
        app.classList.add("anopen");
        app.querySelector(".an-back").onclick = () => { stopAnim(); anim.sel = null; app.classList.remove("anopen"); drawAnimTree(); top(was); };
      }
      const r = open(sel);
      show();
      await r;
      show();
    };
  }
  if (typeof openFx === "function") {
    const fx = openFx;
    window.openFx = async (c, body) => {
      anim.fxSolo = false; anim.fxLevel = 0; anim.fxMod = "";
      // buffs on when that's the only set
      anim.fxOpt = { buffs: fxHas(c.id, "buffs") && (!!(anim.fxOpt && anim.fxOpt.buffs) || !fxHas(c.id, "")) };
      anim.fxBuffs = anim.fxBuffs || {};
      if (!anim.fxBuffs[c.id]) anim.fxBuffs[c.id] = await fetch(`/api/fx_buffs?id=${encodeURIComponent(c.id)}`).then((r) => r.json()).catch(() => ({ levels: [], notes: {}, own: [] }));
      await fx(c, body);
      body.querySelectorAll('[data-solo="1"], [data-opt]').forEach((b) => {
        if (b.dataset.opt === "buffs" && fxHas(c.id, "buffs")) return;
        b.disabled = true; b.classList.add("fxapp"); b.title = "In the desktop app";
      });
      const note = body.querySelector("#fxnote"), none = body.querySelector("#fxempty .empty");
      if (note && !note.querySelector(".fxsite")) note.insertAdjacentHTML("beforeend", ` <span class="fxsite">These videos were rendered in the desktop app and sent here. The greyed options and rendering itself are <a href="${repo}/releases/latest" target="_blank" rel="noopener">in the app</a>.</span>`);
      if (none) none.textContent = "These videos aren't on the site. They can be rendered in the desktop app.";
    };
  }
  // mods are made and kept in the app: no list of them is asked for here
  if (typeof animMods === "function") window.animMods = async () => ({ mods: [] });
  // no idle-pose pictures on the site
  if (typeof enThumbs === "function") window.enThumbs = async () => {};
  const stub = () => {
    $("#main").innerHTML = `<div class="empty"><h2 style="margin-top:0">Only in the app</h2>
      <p>This page isn't on the site: it needs the game's files on your computer. It is in the desktop app: <a href="${repo}/releases/latest" target="_blank" rel="noopener">Limbus Archive for Windows</a>.</p>
      <p><a href="#/patches">Patches</a> · <a href="#/db">Identities &amp; E.G.O</a></p></div>`;
  };
  for (const name of Object.keys(routes)) if (!OPEN.has(name)) routes[name] = stub;
  // games the site has no data for: no tile, no Daily, not the mode of the day
  if (typeof GM_GAMES !== "undefined") {
    const off = new Set(GM_GAMES.filter((g) => !OPEN.has(g[1].split("/")[1])).map((g) => g[0]));
    const drop = (a) => { for (let i = a.length - 1; i >= 0; i--) if (off.has(a[i][0])) a.splice(i, 1); };
    drop(GM_GAMES);
    drop(GM_SCORED);
    for (const [, keys] of GM_GROUPS) for (let i = keys.length - 1; i >= 0; i--) if (off.has(keys[i])) keys.splice(i, 1);
    document.querySelectorAll("#subnav [data-game]").forEach((a) => { if (off.has(a.dataset.game)) a.remove(); });
  }
  const animPage = routes.anim;
  routes.anim = (args) => {
    const r = animPage(args), sub = document.querySelector("#main .sub");
    if (sub) sub.textContent = "Battle animations of Identities and E.G.O replayed from the game's own clips, and Spine skeletons: the animated art of Identities and E.G.O, enemies, abnormalities and the RPG's people. Skills with the game's own effects: the Play tab plays the videos sent here; the desktop app plays any skill at once and renders the rest.";
    return r;
  };
  document.querySelectorAll("a[data-route], #top a[data-group]").forEach((a) => {
    const name = (a.getAttribute("href") || "").split("/")[1];
    if (name && !OPEN.has(name)) a.classList.add("apponly");
  });
  document.body.classList.add("site");
  // phones: the bottom bar slides away while reading down; tab rows show which side has more; a page's description
  // folds into "How it works"
  const phone = () => matchMedia("(max-width: 900px)").matches;
  // Buff effects and Enemies there: the list or the picked card (.enopen), by the address
  for (const [name, all] of [["buffs", "All buff effects"], ["enemies", "All enemies"]]) {
    const draw = routes[name];
    let was = 0, open = false;
    if (draw) routes[name] = async (args) => {
      await draw(args);
      const wrap = document.querySelector("#main .enwrap"), m = $("#main"), d = document.scrollingElement;
      if (!wrap) return;
      if (!wrap.querySelector(".en-back")) wrap.insertAdjacentHTML("afterbegin", `<a class="en-back" href="#/${name}">‹ ${all}</a>`);
      const now = !!args[0];
      wrap.classList.toggle("enopen", now);
      if (now !== open && phone()) { const y = m.scrollTop || d.scrollTop; m.scrollTop = d.scrollTop = now ? 0 : was; if (now) was = y; }
      open = now;
    };
  }
  let lastY = 0;
  const onScroll = (e) => {
    const el = e.target === document ? document.scrollingElement : e.target;
    if (!el || !phone()) return;
    const y = el.scrollTop, d = y - lastY;
    if (Math.abs(d) < 8) return;
    document.body.classList.toggle("navaway", d > 0 && y > 80);
    lastY = y;
  };
  $("#main").addEventListener("scroll", onScroll, { passive: true });
  document.addEventListener("scroll", onScroll, { passive: true });
  const edge = (d) => { const more = d.scrollWidth - d.clientWidth > 4;
    d.classList.toggle("more-r", more && d.scrollLeft + d.clientWidth < d.scrollWidth - 4); d.classList.toggle("more-l", more && d.scrollLeft > 4); };
  document.querySelectorAll("#subnav div[data-group]").forEach((d) => d.addEventListener("scroll", () => edge(d), { passive: true }));
  const tabs = () => {
    const a = document.querySelector("#subnav div:not([hidden]) a.active");
    if (a && phone()) a.scrollIntoView({ block: "nearest", inline: "nearest" });
    document.querySelectorAll("#subnav div[data-group]").forEach(edge);
  };
  addEventListener("hashchange", () => { document.body.classList.remove("navaway"); lastY = 0; setTimeout(tabs, 50); });
  addEventListener("resize", tabs);
  setTimeout(tabs, 50);
  new MutationObserver(() => {
    const sub = document.querySelector("#main > .sub, #main > div > .sub");
    if (!sub || sub.previousElementSibling?.classList.contains("howto")) return;
    const b = Object.assign(document.createElement("button"), { className: "howto", textContent: "ⓘ How it works" });
    b.onclick = () => { sub.classList.toggle("open"); b.classList.toggle("open"); };
    sub.before(b);
  }).observe($("#main"), { childList: true, subtree: true });
  // an invite: offer to open it in the app
  const appBar = () => {
    const h = location.hash, on = /^#\/(game\w+|games\/track)\/duel\/[\w.%-]+$|^#\/(live|vsroom|gamewho)\/[a-z0-9]{4,10}$/i.test(h);
    let el = $("#appbar");
    if (!on) return el && el.remove();
    if (!el) { el = document.createElement("a"); el.id = "appbar"; document.body.appendChild(el); }
    el.href = "limbusarchive://open/" + h.slice(2);
    el.innerHTML = `<b>Open in the desktop app</b><small>if Limbus Archive is installed, version 0.11.33 or newer</small>`;
  };
  window.addEventListener("hashchange", appBar);
  appBar();
  // An open copy checks the index every 2 min and offers the notes and a reload; notes since the last seen version pop
  // up once.
  const mine = SITE.build || {};
  const ver = (v) => String(v || "").split(".").map((x) => parseInt(x, 10) || 0);
  const newer = (a, b) => { const x = ver(a), y = ver(b); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };
  const kept = (store, k, v) => { try { return v === undefined ? store.getItem(k) || "" : store.setItem(k, v); } catch (e) { return ""; } };
  const index = () => fetch("/d/index.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const reports = (idx) => (((idx.inline || {})["/api/state"] || {}).reports || []).length;
  // the notes of the versions after `from` up to `to`
  const notes = (idx, from, to) => {
    const a = (idx.inline || {})["/api/appnotes?all=1"] || {};
    return { version: to, page: a.page || `${repo}/releases`, notes: (a.notes || []).filter((n) => newer(n.tag, from) && !newer(n.tag, to)) };
  };
  let had = null;  // how many reports the site had when this page was opened
  const fresh = async () => {
    if (document.hidden || $("#sitenew")) return;
    const idx = await index(), b = idx && idx.build;
    if (!b) return;
    if (had === null) had = reports(idx);
    const app = newer(b.version, mine.version), patch = b.game !== mine.game || reports(idx) > had;
    if (!app && !patch && b.ui === mine.ui || kept(sessionStorage, "site_new_off") === String(idx.stamp) || $("#sitenew")) return;
    const a = notes(idx, mine.version, b.version);
    const el = document.createElement("div");
    el.id = "sitenew";
    el.innerHTML = `<div><b>${app ? `Limbus Archive ${esc(b.version)} is out` : patch ? "A new patch is on the site" : "The site was updated"}</b><small>Reload the page to see it${app && patch ? ", and the new patch with it" : ""}.</small></div>
      ${a.notes.length ? `<button class="toggle" data-a="notes">What's new</button>` : ""}<button class="primary" data-a="reload">Reload</button><button class="toggle" data-a="off" title="Later">✕</button>`;
    el.onclick = (e) => {
      const act = (e.target.closest("button") || {}).dataset;
      if (!act) return;
      if (act.a === "notes") { kept(localStorage, "site_seen", b.version); showAppNotes(a); }
      if (act.a === "off") { kept(sessionStorage, "site_new_off", String(idx.stamp)); el.remove(); }
      if (act.a === "reload") { if (navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage("reload"); location.reload(); }
    };
    document.body.appendChild(el);
  };
  if (!checking.has("check") && mine.version) {
    index().then((idx) => {
      if (!idx) return;
      had = reports(idx);
      const last = kept(localStorage, "site_seen");
      // (not over an invite's page, and not before somebody's first visit)
      if (last && newer(mine.version, last) && !$("#appbar") && $("#modal").classList.contains("hidden")) {
        const a = notes(idx, last, mine.version);
        if (a.notes.length) showAppNotes(a);
      }
      if (!$("#appbar") || !last) kept(localStorage, "site_seen", mine.version);
    });
    setInterval(fresh, 120e3);
    document.addEventListener("visibilitychange", fresh);
  }
  const foot = document.createElement("footer");
  foot.id = "sitefoot";
  foot.innerHTML = `<span>Unofficial fan site, not affiliated with ProjectMoon.<span class="fwide"> Limbus Company and everything from it belong to ProjectMoon.</span></span>
    <span><a href="${repo}/releases/latest" target="_blank" rel="noopener">Desktop app<span class="fwide"> for Windows: the latest release on GitHub</span></a></span>
    ${SITE.build ? `<span class="fwide" title="pages ${esc(SITE.build.ui)}">Built from Limbus Archive <b>${esc(SITE.build.version)}</b> · ${new Date(SITE.build.stamp * 1000).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}${SITE.build.game ? ` · game ${esc(fmtVer(SITE.build.game))}` : ""}</span>` : ""}
    ${SITE.contact ? `<span>Contact: <b>${esc(SITE.contact)}</b></span>` : ""}
    <span>Made with <a href="https://claude.com/claude-code" target="_blank" rel="noopener">Claude Code</a></span>
    <span><a href="#" id="sitenotes">What's new</a> · <a href="#/support">Support · Credits</a></span>`;
  // footer kept last in the scroll
  const main = $("#main"), last = () => { if (main.lastElementChild !== foot) main.appendChild(foot); };
  new MutationObserver(last).observe(main, { childList: true });
  last();
  $("#sitenotes").onclick = (e) => { e.preventDefault(); showAppHistory(); };
  route();
})();

// ---- "Download" under a video (the siteDl hook): the file itself, a GIF or PNG frames in a zip, made in the browser
(() => {
  const FPS = 30, GIF_MAX = 10e6, GIF_W = 480, GIF_FRAMES = 240;  // (renders are 30 fps; a GIF fits Discord's 10 MB)
  const clean = (s) => s.replace(/[\\/:*?"<>|]+/g, "_").trim();
  const save = (blob, name) => {
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: clean(name) });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60e3);
  };
  const tick = () => new Promise((ok) => setTimeout(ok));

  // every frame of a video at fps, drawn w wide (0 = as it is): fn(canvas, ctx, i, n)
  async function frames(blob, fps, w, black, fn) {
    const v = Object.assign(document.createElement("video"), { muted: true, playsInline: true, preload: "auto" });
    v.src = URL.createObjectURL(blob);
    try {
      await new Promise((ok, no) => { v.onloadeddata = ok; v.onerror = () => no(new Error("this browser can't read the video")); });
      const dur = v.duration;
      if (!isFinite(dur) || !v.videoWidth) throw new Error("this browser can't read the video");
      const n = Math.max(1, Math.floor(dur * fps + 0.01)), W = w ? Math.min(w, v.videoWidth) : v.videoWidth, H = Math.round(v.videoHeight * W / v.videoWidth);
      const c = Object.assign(document.createElement("canvas"), { width: W, height: H }), ctx = c.getContext("2d", { willReadFrequently: true });
      for (let i = 0; i < n; i++) {
        await new Promise((ok) => { v.onseeked = ok; v.currentTime = Math.min(Math.max(0, dur - 0.001), (i + 0.5) / fps); });
        if (black) { ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H); } else ctx.clearRect(0, 0, W, H);
        ctx.drawImage(v, 0, 0, W, H);
        await fn(c, ctx, i, n);
      }
    } finally { URL.revokeObjectURL(v.src); v.removeAttribute("src"); v.load(); }
  }

  // ---- zip, files stored as they are
  const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc32 = (u8) => { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  function zip(files) {  // [name, Blob, crc]
    const enc = new TextEncoder(), parts = [], dir = [];
    let at = 0;
    const rec = (central, name, size, crc, off) => {
      const b = new DataView(new ArrayBuffer((central ? 46 : 30) + name.length));
      let p = 0;
      const u16 = (x) => { b.setUint16(p, x, true); p += 2; }, u32 = (x) => { b.setUint32(p, x, true); p += 4; };
      u32(central ? 0x02014b50 : 0x04034b50);
      if (central) u16(20);
      u16(20); u16(0x0800); u16(0); u16(0); u16(0x21); u32(crc); u32(size); u32(size); u16(name.length); u16(0);
      if (central) { u16(0); u16(0); u16(0); u32(0); u32(off); }
      new Uint8Array(b.buffer).set(name, p);
      return b.buffer;
    };
    for (const [n, blob, crc] of files) {
      const name = enc.encode(n), head = rec(false, name, blob.size, crc);
      dir.push(rec(true, name, blob.size, crc, at));
      parts.push(head, blob);
      at += head.byteLength + blob.size;
    }
    const end = new DataView(new ArrayBuffer(22)), size = dir.reduce((s, d) => s + d.byteLength, 0);
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, size, true); end.setUint32(16, at, true);
    return new Blob([...parts, ...dir, end.buffer], { type: "application/zip" });
  }

  // ---- GIF: one palette for the whole clip (median cut over 5-bit colours), ordered dither
  function palette(list, clear) {
    const hist = new Uint32Array(32768);
    for (const px of list) for (let i = 0; i < px.length; i += 16) if (!clear || px[i + 3] >= 128) hist[(px[i] >> 3) << 10 | (px[i + 1] >> 3) << 5 | px[i + 2] >> 3]++;
    const bins = [];
    for (let k = 0; k < 32768; k++) if (hist[k]) bins.push(k);
    const ch = [(k) => k >> 10, (k) => k >> 5 & 31, (k) => k & 31];
    const box = (b) => {
      let n = 0, best = 0, wide = -1;
      for (const k of b) n += hist[k];
      for (let c = 0; c < 3; c++) { let lo = 31, hi = 0; for (const k of b) { const x = ch[c](k); if (x < lo) lo = x; if (x > hi) hi = x; } if (hi - lo > wide) { wide = hi - lo; best = c; } }
      return { b, n, c: best, wide };
    };
    const boxes = [box(bins)], max = clear ? 255 : 256;
    while (boxes.length < max) {
      let at = -1, score = 0;
      boxes.forEach((x, i) => { const s = x.wide > 0 && x.b.length > 1 ? x.n * (x.wide + 1) : 0; if (s > score) { score = s; at = i; } });
      if (at < 0) break;
      const x = boxes[at], f = ch[x.c];
      x.b.sort((p, q) => f(p) - f(q));
      let half = 0, cut = 0;
      while (cut < x.b.length - 1 && half + hist[x.b[cut]] <= x.n / 2) half += hist[x.b[cut++]];
      cut = Math.max(1, cut);
      boxes.splice(at, 1, box(x.b.slice(0, cut)), box(x.b.slice(cut)));
    }
    const pal = new Uint8Array(768);
    boxes.forEach((x, i) => {
      let r = 0, g = 0, b = 0;
      for (const k of x.b) { const h = hist[k]; r += h * (k >> 10); g += h * (k >> 5 & 31); b += h * (k & 31); }
      const n = x.n || 1;
      pal.set([r / n * 8 + 4, g / n * 8 + 4, b / n * 8 + 4], i * 3);
    });
    return { pal, n: boxes.length };
  }
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((x) => (x - 7.5) * 0.6);
  function indexed(px, w, h, pal, n, clear, near) {
    const out = new Uint8Array(w * h);
    for (let y = 0, i = 0, o = 0; y < h; y++) for (let x = 0; x < w; x++, i += 4, o++) {
      if (clear && px[i + 3] < 128) { out[o] = 255; continue; }
      const d = BAYER[(y & 3) << 2 | x & 3];
      const r = Math.min(255, Math.max(0, px[i] + d)), g = Math.min(255, Math.max(0, px[i + 1] + d)), b = Math.min(255, Math.max(0, px[i + 2] + d));
      const k = (r >> 3) << 10 | (g >> 3) << 5 | b >> 3;
      let v = near[k];
      if (v < 0) {
        const cr = (r & 248) + 4, cg = (g & 248) + 4, cb = (b & 248) + 4;
        let best = 1e9;
        for (let p = 0; p < n; p++) { const dr = pal[p * 3] - cr, dg = pal[p * 3 + 1] - cg, db = pal[p * 3 + 2] - cb, e = dr * dr * 2 + dg * dg * 4 + db * db; if (e < best) { best = e; v = p; } }
        near[k] = v;
      }
      out[o] = v;
    }
    return out;
  }
  function lzw(idx, out) {
    const CLEAR = 256, END = 257, table = new Map();
    let size = 9, next = 258, cur = 0, bits = 0, block = [];
    const put = (code) => {
      cur |= code << bits; bits += size;
      while (bits >= 8) { block.push(cur & 255); cur >>>= 8; bits -= 8; if (block.length === 255) { out.push(255, ...block); block = []; } }
    };
    put(CLEAR);
    let pre = idx[0];
    for (let i = 1; i < idx.length; i++) {
      const c = idx[i], key = pre << 8 | c, hit = table.get(key);
      if (hit !== undefined) { pre = hit; continue; }
      put(pre);
      if (next < 4096) { table.set(key, next++); if (next - 1 === 1 << size && size < 12) size++; }
      else { put(CLEAR); table.clear(); size = 9; next = 258; }
      pre = c;
    }
    put(pre); put(END);
    if (bits) block.push(cur & 255);
    if (block.length) out.push(block.length, ...block);
    out.push(0);
  }
  async function gif(list, w, h, delay, clear, step) {
    const { pal, n } = palette(list, clear), near = new Int16Array(32768).fill(-1), parts = [];
    const head = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, w & 255, w >> 8, h & 255, h >> 8, 0xF7, 0, 0, ...pal,
      0x21, 0xFF, 11, ...[..."NETSCAPE2.0"].map((c) => c.charCodeAt(0)), 3, 1, 0, 0, 0];
    parts.push(new Uint8Array(head));
    for (let i = 0; i < list.length; i++) {
      const out = [0x21, 0xF9, 4, clear ? 9 : 4, delay & 255, delay >> 8, 255, 0, 0x2C, 0, 0, 0, 0, w & 255, w >> 8, h & 255, h >> 8, 0, 8];
      lzw(indexed(list[i], w, h, pal, n, clear, near), out);
      parts.push(new Uint8Array(out));
      if (i % 4 === 3) { step(i / list.length); await tick(); }
    }
    parts.push(new Uint8Array([0x3B]));
    return new Blob(parts, { type: "image/gif" });
  }
  const smaller = (px, w, h, k) => {
    const a = Object.assign(document.createElement("canvas"), { width: w, height: h }), W = Math.round(w * k), H = Math.round(h * k);
    a.getContext("2d").putImageData(new ImageData(px, w, h), 0, 0);
    const b = Object.assign(document.createElement("canvas"), { width: W, height: H }), ctx = b.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(a, 0, 0, W, H);
    return ctx.getImageData(0, 0, W, H).data;
  };

  const files = new WeakMap();
  const file = (row) => { if (!files.has(row)) files.set(row, fetch(row.dataset.url).then((r) => { if (!r.ok) throw new Error("the video isn't here"); return r.blob(); })); return files.get(row); };
  async function make(row, kind, step) {
    const name = row.dataset.name, blob = await file(row), alpha = "alpha" in row.dataset, black = alpha && row.classList.contains("black");
    if (kind === "video") return save(blob, `${name}.${/webm/.test(blob.type) || alpha ? "webm" : "mp4"}`);
    if (kind === "png") {
      const list = [];
      await frames(blob, FPS, 0, black, async (c, ctx, i, n) => {
        const png = await new Promise((ok) => c.toBlob(ok, "image/png"));
        list.push([`${clean(name)}_${String(i + 1).padStart(4, "0")}.png`, png, crc32(new Uint8Array(await png.arrayBuffer()))]);
        step((i + 1) / n);
      });
      while (list.length > 1 && list[list.length - 1][2] === list[list.length - 2][2]) list.pop();  // (the sound runs longer than the picture)
      return save(zip(list), `${name} - frames.zip`);
    }
    const probe = Object.assign(document.createElement("video"), { preload: "metadata", src: URL.createObjectURL(blob) });
    await new Promise((ok) => { probe.onloadedmetadata = probe.onerror = ok; });
    URL.revokeObjectURL(probe.src);
    const delay = Math.max(5, Math.ceil(100 / Math.min(20, GIF_FRAMES / (probe.duration || 1))));
    let list = [], w = 0, h = 0;
    await frames(blob, 100 / delay, GIF_W, black, (c, ctx, i, n) => { w = c.width; h = c.height; list.push(ctx.getImageData(0, 0, w, h).data); step((i + 1) / n * 0.5); });
    const same = (a, b) => { for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 3] !== b[i + 3]) return false; return true; };
    while (list.length > 1 && same(list[list.length - 1], list[list.length - 2])) list.pop();
    for (let pass = 0; ; pass++) {
      const out = await gif(list, w, h, delay, alpha && !black, (p) => step(0.5 + p * 0.5));
      if (out.size <= GIF_MAX || pass === 3 || w < 200) return save(out, `${name}.gif`);
      const k = Math.sqrt(GIF_MAX / out.size) * 0.9, W = Math.round(w * k), H = Math.round(h * k);
      list = list.map((px) => smaller(px, w, h, k));
      w = W; h = H;
    }
  }
  document.addEventListener("click", async (ev) => {
    const b = ev.target.closest && ev.target.closest(".sdl button"), row = b && b.closest(".sdl");
    if (!row) return;
    if (b.dataset.bg) { row.classList.toggle("black", b.dataset.bg === "black"); row.querySelectorAll("[data-bg]").forEach((x) => x.classList.toggle("on", x === b)); return; }
    if (row.classList.contains("busy")) return;
    const text = b.textContent;
    row.classList.add("busy");
    try { await make(row, b.dataset.k, (p) => { b.textContent = `${Math.round(p * 100)}%`; }); }
    catch (e) { toast(`Could not make it: ${esc(e.message || String(e))}`); }
    row.classList.remove("busy");
    b.textContent = text;
  });
})();
