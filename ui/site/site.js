"use strict";
// The web copy (limbusdm/site.py): loaded after the app's own scripts. Pages that need the game on the visitor's
// computer are stubs here, the app's own controls are hidden, and the footer names who to write to.
(() => {
  // the pages the site has data for: decided when the site is made (limbusdm/site.py verify)
  const repo = "https://github.com/Schirke/limbus-archive";
  const OPEN = new Set(SITE.open || ["patches", "news", "db", "enemies", "anim", "teams", "games", "gameid", "gameskill", "community", "support"]);
  // "?check": the app looking at its own site (limbusdm/sitecheck.py) — every page runs for real and, once it has
  // settled, leaves what it asked for in vain where the app reads it
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
  // a link the app opens in the system browser (/api/open_url): the worker hands it back to be opened here
  navigator.serviceWorker.addEventListener("message", (e) => { if (e.data && e.data.open) window.open(e.data.open, "_blank", "noopener"); });
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
    const h = location.hash, on = /^#\/(game\w+|games\/track)\/duel\/[\w.%-]+$|^#\/(live|vsroom)\/[a-z0-9]{4,10}$/i.test(h);
    let el = $("#appbar");
    if (!on) return el && el.remove();
    if (!el) { el = document.createElement("a"); el.id = "appbar"; document.body.appendChild(el); }
    el.href = "limbusarchive://open/" + h.slice(2);
    el.innerHTML = `<b>Open in the desktop app</b><small>if Limbus Archive is installed, version 0.11.33 or newer</small>`;
  };
  window.addEventListener("hashchange", appBar);
  appBar();
  const foot = document.createElement("footer");
  foot.id = "sitefoot";
  foot.innerHTML = `<span>Unofficial fan site, not affiliated with ProjectMoon. Limbus Company and everything from it belong to ProjectMoon.</span>
    <span><a href="${repo}/releases/latest" target="_blank" rel="noopener">Desktop app for Windows: the latest release on GitHub</a></span>
    ${SITE.build ? `<span title="pages ${esc(SITE.build.ui)}">Built from Limbus Archive <b>${esc(SITE.build.version)}</b> · ${new Date(SITE.build.stamp * 1000).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}${SITE.build.game ? ` · game ${esc(fmtVer(SITE.build.game))}` : ""}</span>` : ""}
    ${SITE.contact ? `<span>Contact: <b>${esc(SITE.contact)}</b></span>` : ""}
    <span><a href="#/support">Support · Credits</a></span>`;
  document.body.appendChild(foot);
  route();
})();
