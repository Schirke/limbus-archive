// Big games: the larger games, shipped built (ui/big/*.js, loaded by refresh from STATE.big). Each stays hidden until the
// owner turns it on for everyone (Admin → Pages, beta.json "games"); admins see them all the time.
"use strict";
const BIG = [];  // {key, route, tile, scored, need}
const big = { on: new Set() };
try { big.on = new Set(JSON.parse(localStorage.getItem("big_on") || "[]")); } catch (e) { /* none until beta.json is read */ }
const bigAdmin = () => typeof STATE !== "undefined" && STATE && Array.isArray(STATE.ext) && STATE.ext.length > 0;
const bigSeen = (k) => big.on.has(k) || bigAdmin();

// called by a big game's script: its tile ([key, page, name, about, icon, toy]), whether it has a Daily, and a function
// that asks the app for everything the game can use
function bigGame(tile, scored, need) {
  const key = tile[0], route = tile[1].split("/")[1];
  if (BIG.some((g) => g.key === key)) return;
  BIG.push({ key, route, tile, scored, need });
  const play = routes[route];
  routes[route] = (args) => bigSeen(key) ? play(args) : (location.hash = "#/games");
  bigSync();
}
// the owner's list from beta.json
function bigOn(list) {
  big.on = new Set(Array.isArray(list) ? list.filter((k) => typeof k === "string") : []);
  try { localStorage.setItem("big_on", JSON.stringify([...big.on])); } catch (e) { /* read again next time */ }
  bigSync();
}
function bigSync() {
  let changed = false;
  for (const g of BIG) {
    const at = GM_GAMES.indexOf(g.tile), seen = bigSeen(g.key);
    if (seen !== at >= 0) changed = true;
    if (seen && at < 0) {
      GM_GAMES.push(g.tile);
      if (g.scored) GM_SCORED.push(g.tile);
      const row = document.querySelector("#subnav .gmcrumb");
      if (row && !row.querySelector(`[data-game="${g.key}"]`)) row.insertAdjacentHTML("beforeend", `<a href="#/${g.route}" data-route="${g.route}" data-game="${g.key}" hidden></a>`);
    } else if (!seen && at >= 0) {
      GM_GAMES.splice(at, 1);
      if (GM_SCORED.includes(g.tile)) GM_SCORED.splice(GM_SCORED.indexOf(g.tile), 1);
    }
  }
  const nav = document.querySelector('#subnav a[data-route="biggames"]');
  if (nav) nav.hidden = !BIG.some((g) => bigSeen(g.key));
  const page = location.hash.split("/")[1] || "";
  if (changed && ((page === "games" && !location.hash.startsWith("#/games/")) || page === "biggames")) route();
}

// every request the big games make (Send to site runs this in a hidden window: site.py Exporter.biggames)
async function bigNeeds() {
  performance.setResourceTimingBufferSize(1e6);
  performance.clearResourceTimings();
  for (const g of BIG) if (g.need) try { await g.need(); } catch (e) { console.warn(g.key, e); }
  const own = location.origin + "/api/";
  return [...new Set(performance.getEntriesByType("resource").map((e) => e.name).filter((u) => u.startsWith(own)).map((u) => u.slice(location.origin.length)))];
}

routes.biggames = () => {
  const seen = BIG.filter((g) => bigSeen(g.key));
  if (!seen.length) {
    if (window.bigLoaded === true) location.hash = "#/games";
    else $("#main").innerHTML = `<h1>Big games</h1><div class="empty">Loading…</div>`;
    return;
  }
  $("#main").innerHTML = `<h1>Big games</h1><div class="sub">Larger games made from the game's own sprites, sounds and music.</div>
    ${seen.map(({ key, tile: [k, href, name, about, icon], scored }) => { const today = scored && typeof gmDailyDone === "function" ? gmDailyDone(k) : null;
      return `<div class="gmday bgday"><a class="gmart" data-game="${k}" href="${href}">${icon}</a><div class="gmdaybody">
      <div class="gmkick">${big.on.has(key) ? "BIG GAME" : "OFF FOR PLAYERS · ADMINS SEE IT"}</div><a class="gmname" href="${href}">${esc(name)}</a><p>${esc(about)}</p>
      <div class="gmplay"><a class="gmbtn" href="${href}">Play</a>${!scored ? "" : today == null ? `<a class="toggle" href="${href}/daily" title="The same track for everybody today, on fixed settings">Daily</a>` : `<span class="toggle done">Daily ✓</span>`}${scored && typeof gmDuelBtns === "function" ? gmDuelBtns(k) : ""}</div></div></div>`; }).join("")}`;
  if (typeof gmHubPics === "function") gmHubPics();
};
