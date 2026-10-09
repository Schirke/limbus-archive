"use strict";
// The web copy (limbusdm/site.py): loaded after the app's own scripts. Pages that need the game on the visitor's
// computer are stubs here, the app's own controls are hidden, and the footer names who to write to.
(() => {
  // the pages the site has data for: decided when the site is made (limbusdm/site.py verify)
  const repo = "https://github.com/Schirke/limbus-archive";
  const OPEN = new Set(SITE.open || ["patches", "news", "db", "enemies", "anim", "teams", "games", "gameid", "gameskill", "community", "support"]);
  // "?check": the app looking at its own site (limbusdm/sitecheck.py) — every page runs for real and, once it has
  // settled, leaves what it asked for in vain where the app reads it
  // The front page, here only (the app opens on Patches: who has it knows where they are): what the site is in a
  // line, the art of the newest Identities taking turns behind it, the latest patch, the sections and the newest
  // Identities. Somebody sent the bare link lands here.
  OPEN.add("home");
  // a section's own page (/db, /enemies…: limbusdm/site.py, written for search engines) opens the app on it
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
  // (a report's counts as its row has them, without the kinds that say little to a visitor: code, new paths, other)
  const homeChips = (sum) => `<div class="chips">${SUMMARY_LABELS.filter(([k]) => sum && sum[k] && !/^(code|catalog_added|other)$/.test(k)).map(([k, l]) =>
    `<span class="chip ${k === "leaks" || k === "foreign_only" ? "leak" : ""}"><b>${sum[k]}</b> ${l}</span>`).join("") || `<span class="chip">no content changes</span>`}</div>`;
  routes.home = async () => {
    const main = $("#main"), here = () => !!main.querySelector(".home");
    clearInterval(homeTimer);
    main.innerHTML = `<div class="home"><div class="hhero"></div></div>`;
    try { await units(); } catch (e) { /* the page without the Identities then */ }
    if (!here()) return;
    const ids = typeof UNITS !== "undefined" && UNITS && UNITS.ids || [];
    const byDate = [...ids].sort((a, b) => (b.date || "").localeCompare(a.date || "") || b.id - a.id);
    const newest = byDate.length ? byDate[0].date || "" : "";
    // the banner: the Identities of the latest date (one banner brings several: they take turns)
    const slides = byDate.filter((x) => x.date === newest && x.img && x.img.art).slice(0, 6);
    const games = document.querySelectorAll("#subnav a[data-game]").length;
    const day = (r) => { const m = /^build (\d\d\.\d\d)\.(\d{4}) · taken (.+)$/.exec(fmtSnap(r.new)); return m ? { d: m[1], y: m[2], taken: m[3] } : { d: fmtSnap(r.new), y: "", taken: "" }; };
    const draw = () => {
      if (!here()) return;
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
        const x = slides[i], url = imgFull(x.img.art), im = new Image();
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
    // (the reports come with the app's state: drawn once it is here)
    if (typeof STATE !== "undefined" && STATE) draw(); else refresh.hook = () => { refresh.hook = null; draw(); };
  };
  const checking = new URLSearchParams(location.search);
  if (checking.has("check")) {
    const all = Object.keys(routes);
    for (const name of all) OPEN.add(name);
    // settled = nothing new asked and nothing on its way for a second and a half ("settle" is the longest wait)
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
  // The site's own count of its visitors (worker.js Stats): a page tells what was opened in it — at once when it is
  // opened, then every ten minutes ("still here" too) and when it is put away: few requests however many pages a
  // visitor goes through. 410 = the count is closed for the month (worker.js, the allowance). Nothing is kept in the
  // browser. The Site stats tab of Community shows the sums — to everybody, or (SITE.stats "key") to who opened it
  // once as #/community/stats/<key>.
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
    // an Identity's or E.G.O's card: opened by a click in the list (the link stays) or by a link — both come here
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
    // what the plan's period has spent of what the site's settings allow it (worker.js: the count's own sums)
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
  // Animations: the site has the Spine skeletons and the battle animations — an Identity or E.G.O opens on its Spine
  // tab, or on the battle one when it has no skeleton (the tabs that need the game's files are hidden in site.css),
  // without asking for its videos and skill numbers
  // "With effects": the skills rendered by the app's Unity player, for those whose videos were sent here — with the
  // target, and with the character's buffs (limbusdm/sitefx.py); the other options and rendering stay in the app
  let FXS = {};
  const fxList = fetch("/api/site_fx").then((r) => (r.ok ? r.json() : {})).then((j) => { FXS = j || {}; }).catch(() => {});
  const fxHas = (id, v) => (FXS[id] || []).includes(v);
  if (typeof openAnimEntry === "function") {
    const open = openAnimEntry;
    window.openAnimEntry = async (sel) => {
      await fxList;
      const mine = sel && sel.cid != null && !sel.enemy && !sel.spine;
      if (mine) {
        sel.videos = sel.videos || [];
        if (!FXS[sel.cid]) sel.slots = sel.slots || {};  // (the skills' names are here only with the videos)
        const c = findChar(sel.cid);
        // (the app's first tab is Skills: here that is the videos sent to the site, else the Spine art, else the clips)
        if (!/^(battle$|spine)/.test(anim.tab || "") && !(anim.tab === "fx" && FXS[sel.cid])) anim.tab = FXS[sel.cid] ? "fx" : c && c.spine.length ? "spine0" : "battle";
      }
      const show = () => { const b = document.querySelector('#aview .an-tabs [data-t="fx"]'); if (b) b.classList.toggle("onsite", !!(mine && FXS[sel.cid])); };
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
      // (with its buffs when that is the only set here; the buffs' list first: the tab draws its switches once)
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
  // the app takes pictures of the enemies' idle poses for the grid and keeps them; the site has the ones it was given
  if (typeof enThumbs === "function") window.enThumbs = async () => {};
  const stub = () => {
    $("#main").innerHTML = `<div class="empty"><h2 style="margin-top:0">Only in the app</h2>
      <p>This page isn't on the site: it needs the game's files on your computer. It is in the desktop app: <a href="${repo}/releases/latest" target="_blank" rel="noopener">Limbus Archive for Windows</a>.</p>
      <p><a href="#/patches">Patches</a> · <a href="#/db">Identities &amp; E.G.O</a></p></div>`;
  };
  for (const name of Object.keys(routes)) if (!OPEN.has(name)) routes[name] = stub;
  const animPage = routes.anim;
  routes.anim = (args) => {
    const r = animPage(args), sub = document.querySelector("#main .sub");
    if (sub) sub.textContent = "Battle animations of Identities and E.G.O replayed from the game's own clips, and Spine skeletons: the animated art of Identities and E.G.O, enemies, abnormalities and the RPG's people. Skills with the game's own effects: the With effects tab where the videos were sent here, and the desktop app for the rest.";
    return r;
  };
  document.querySelectorAll("a[data-route], #top a[data-group]").forEach((a) => {
    const name = (a.getAttribute("href") || "").split("/")[1];
    if (name && !OPEN.has(name)) a.classList.add("apponly");
  });
  document.body.classList.add("site");
  // an invite opened here (a duel, a live room, a Versus room): who has the desktop app can go on there — the app
  // makes limbusarchive: links its own (limbusdm/app.py)
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
  // A copy of the site left open learns that a newer one was sent (the app's "Send to site"): the site's index is
  // looked at every two minutes and a plate offers the notes and a reload — nothing reloads by itself, a game may be
  // on. The notes are the app's own (the releases', limbusdm/site.py index); after the reload, or on the next visit,
  // the ones since the version seen last pop up once, as in the app.
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
  document.body.appendChild(foot);
  $("#sitenotes").onclick = (e) => { e.preventDefault(); showAppHistory(); };
  route();
})();
