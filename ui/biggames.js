// Big games: the larger games, shipped built (ui/big/*.js, loaded by refresh from STATE.big). Each stays hidden until the
// owner turns it on for everyone (Admin → Pages, beta.json "games"); admins see them all the time. "By link" (beta.json
// "links"): kept out of the menus, but its address opens it for anyone (a test to share).
"use strict";
const BIG = [];  // {key, route, tile, scored, need}
const big = { on: new Set(), link: new Set(), read: false };  // (read: the owner's list is known, kept from before or fetched now)
try { const kept = localStorage.getItem("big_on"); big.on = new Set(JSON.parse(kept || "[]")); big.link = new Set(JSON.parse(localStorage.getItem("big_link") || "[]")); big.read = kept !== null; } catch (e) { /* none until beta.json is read */ }
const bigAdmin = () => typeof STATE !== "undefined" && STATE && Array.isArray(STATE.ext) && STATE.ext.length > 0;
const bigSeen = (k) => big.on.has(k) || bigAdmin();
const bigOpen = (k) => bigSeen(k) || big.link.has(k);  // (opens by its address; the menus show only bigSeen)
// pages hidden the same way until the owner turns them on (Admin → Pages → Hidden pages): [key = route, name]
const BIG_PAGES = [["workshop", "Story workshop"], ["collection", "Collection"]];
const BIG_ASK = [];  // other shipped pages: a function that asks the app for what the page uses (Send to site)

// called by a big game's script: its tile ([key, page, name, about, icon, toy]), whether it has a Daily, and a function
// that asks the app for everything the game can use
function bigGame(tile, scored, need) {
  const key = tile[0], route = tile[1].split("/")[1];
  if (BIG.some((g) => g.key === key)) return;
  BIG.push({ key, route, tile, scored, need });
  const play = routes[route];
  routes[route] = (args) => bigOpen(key) ? play(args) : big.read ? (location.hash = "#/games") : ($("#main").innerHTML = `<div class="empty">Loading…</div>`);
  bigSync();
  if (typeof muGameCheck === "function") muGameCheck();
}
// the owner's lists from beta.json: on for everyone, open by link
function bigOn(list, links) {
  const keys = (l) => new Set(Array.isArray(l) ? l.filter((k) => typeof k === "string") : []);
  big.on = keys(list);
  if (links !== undefined) big.link = keys(links);
  const first = !big.read;
  big.read = true;
  try { localStorage.setItem("big_on", JSON.stringify([...big.on])); localStorage.setItem("big_link", JSON.stringify([...big.link])); } catch (e) { /* read again next time */ }
  bigSync();
  const page = location.hash.split("/")[1];
  if (first && (page === "biggames" || BIG.some((g) => g.route === page))) route();  // (a link opened before the list came)
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
  for (const [k] of BIG_PAGES) {
    const a = document.querySelector(`#subnav a[data-route="${k}"]`);
    if (a && a.hidden === bigSeen(k)) { a.hidden = !bigSeen(k); if (page === k) changed = true; }
  }
  if (changed && ((page === "games" && !location.hash.startsWith("#/games/")) || page === "biggames" || BIG_PAGES.some(([k]) => k === page))) route();
}

// every request the big games make (Send to site runs this in a hidden window: site.py Exporter.biggames)
async function bigNeeds() {
  performance.setResourceTimingBufferSize(1e6);
  performance.clearResourceTimings();
  for (const g of BIG) if (g.need) try { await g.need(); } catch (e) { console.warn(g.key, e); }
  for (const f of BIG_ASK) try { await f(); } catch (e) { console.warn(e); }
  const own = location.origin + "/api/";
  return [...new Set(performance.getEntriesByType("resource").map((e) => e.name).filter((u) => u.startsWith(own)).map((u) => u.slice(location.origin.length)))];
}

routes.biggames = () => {
  const seen = BIG.filter((g) => bigSeen(g.key));
  if (!seen.length) {
    if (window.bigLoaded === true && (big.read || bigAdmin())) location.hash = "#/games";
    else $("#main").innerHTML = `<h1>Big games</h1><div class="empty">Loading…</div>`;
    return;
  }
  $("#main").innerHTML = `<h1>Big games</h1><div class="sub">Larger games made from the game's own sprites, sounds and music.</div>
    ${seen.map(({ key, tile: [k, href, name, about, icon], scored }) => { const today = scored && typeof gmDailyDone === "function" ? gmDailyDone(k) : null;
      return `<div class="gmday bgday"><a class="gmart" data-game="${k}" href="${href}">${icon}</a><div class="gmdaybody">
      <div class="gmkick">${big.on.has(key) ? "BIG GAME" : big.link.has(key) ? "BY LINK · NOT IN THE MENUS" : "OFF FOR PLAYERS · ADMINS SEE IT"}</div><a class="gmname" href="${href}">${esc(name)}</a><p>${esc(about)}</p>
      <div class="gmplay"><a class="gmbtn" href="${href}">Play</a>${!scored ? "" : today == null ? `<a class="toggle" href="${href}/daily" title="The same track for everybody today, on fixed settings">Daily</a>` : `<span class="toggle done">Daily ✓</span>`}${scored && typeof gmDuelBtns === "function" ? gmDuelBtns(k) : ""}</div></div></div>`; }).join("")}`;
  if (typeof gmHubPics === "function") gmHubPics();
};
