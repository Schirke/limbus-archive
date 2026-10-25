// BETA marks: the pages the owner marks as beta (Admin → Pages), read from beta.json on GitHub; shown on their menu links
// and next to the page's title, in the app and on the site. The same file's "off" = parts of pages switched off,
// "human" = translations made by people without AI tools, "edited" = machine translations corrected by people (marks in
// the language menu), "games" = the big games turned on for everyone, "links" = the ones open by link (biggames.js),
// "ui" = interface languages on for everyone (i18n.js), "fu" = the owner's uses a turn of extra skills ("<id>.<skill>": n, team builder).
"use strict";
const BETA_URL = "https://raw.githubusercontent.com/Schirke/limbus-archive/community-config/beta.json";
// a raw GitHub JSON file, or the site's copy of it (GitHub is out of reach in some countries); the site asks its copy first
function ghGet(url, ms = 6000) {
  const get = (u) => fetch(u, { cache: "no-cache", signal: AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined }).then((r) => (r.ok ? r.json() : Promise.reject(r.status)));
  const site = typeof SITE !== "undefined", copy = (site ? "/gh/" : "https://limbus-archive.com/gh/") + url.replace("https://raw.githubusercontent.com/", "");
  return site ? get(copy).catch(() => get(url)) : get(url).catch(() => get(copy));
}
const betaReady = ghGet(BETA_URL).catch(() => null);  // (i18n.js waits for its "ui")
const beta = { routes: new Set(), human: new Set(), edited: new Set(), fu: {}, raf: 0 };
const langMark = (id) => beta.human.has(id) ? "human" : beta.edited.has(id) ? "edited" : "";
document.head.insertAdjacentHTML("beforeend", `<style>
.betatag, .newtag { display: inline-block; font: 11px/1 "LC Bebas", Impact, sans-serif; letter-spacing: .08em; color: #120e0b; background: #f8b400; padding: 3px 5px 2px; margin-left: 6px; vertical-align: middle; }
.newtag { color: #fff; background: #d8382c; }
#nav .betatag, #subnav .betatag, #subnav .newtag { font-size: 9px; padding: 2px 3px 1px; margin-left: 4px; vertical-align: 1px; }
h1 .betatag { font-size: 14px; vertical-align: 6px; }
[data-off~="lunatest"] #getest { display: none; }
</style>`);
function betaTitle() {
  const h = document.querySelector("#main h1");
  if (!h) return;
  const on = beta.routes.has(location.hash.split("/")[1] || "patches"), b = h.querySelector(".betatag");
  if (on && !b) h.insertAdjacentHTML("beforeend", `<span class="betatag">BETA</span>`);
  else if (!on && b) b.remove();
}
// switched-off parts: names in <html data-off>, hidden by the rules above
function betaOff(list) {
  const off = Array.isArray(list) ? list.filter((r) => /^\w+$/.test(r)) : [];
  document.documentElement.dataset.off = off.join(" ");
  try { localStorage.setItem("beta_off", JSON.stringify(off)); } catch (e) { /* read again next time */ }
}
function betaHuman(list, edited) {
  const ids = (l) => new Set(Array.isArray(l) ? l.filter((r) => typeof r === "string") : []);
  beta.human = ids(list);
  beta.edited = ids(edited);
  try { localStorage.setItem("beta_human", JSON.stringify([[...beta.human], [...beta.edited]])); } catch (e) { /* read again next time */ }
  if (typeof supTranslators === "function") supTranslators();  // (the Support page's list, when it is open)
}
function betaFu(o) {
  beta.fu = o && typeof o === "object" && !Array.isArray(o) ? Object.fromEntries(Object.entries(o).filter(([, v]) => typeof v === "number")) : {};
  try { localStorage.setItem("beta_fu", JSON.stringify(beta.fu)); } catch (e) { /* read again next time */ }
}
function betaApply(list) {
  beta.routes = new Set(Array.isArray(list) ? list.filter((r) => typeof r === "string") : []);
  try { localStorage.setItem("beta", JSON.stringify([...beta.routes])); } catch (e) { /* read again next time */ }
  document.querySelectorAll("#nav a[href^='#/'], #subnav a[href^='#/']").forEach((a) => {
    const on = beta.routes.has(a.getAttribute("href").split("/")[1]), dot = a.querySelector(".betatag");
    if (on && !dot) a.insertAdjacentHTML("beforeend", `<span class="betatag">BETA</span>`);
    else if (!on && dot) dot.remove();
  });
  betaTitle();
}
(() => {
  try { betaApply(JSON.parse(localStorage.getItem("beta") || "[]")); betaOff(JSON.parse(localStorage.getItem("beta_off") || "[]"));
    betaHuman(...JSON.parse(localStorage.getItem("beta_human") || "[[], []]")); betaFu(JSON.parse(localStorage.getItem("beta_fu") || "{}")); } catch (e) { /* none until read */ }
  betaReady.then((j) => { if (j) { betaApply(j.routes); betaOff(j.off); betaHuman(j.human, j.edited); betaFu(j.fu);
    if (document.querySelector("#builder") && typeof drawBuilder === "function") drawBuilder();
    if (typeof bigOn === "function") bigOn(j.games, j.links || []);
    try { localStorage.setItem("beta_ui", JSON.stringify(Array.isArray(j.ui) ? j.ui : [])); } catch (e) { /* read again next time */ } } });
  const main = document.querySelector("#main");
  if (main) new MutationObserver(() => {
    if (!beta.routes.size && !document.querySelector("#main h1 .betatag")) return;
    cancelAnimationFrame(beta.raf);
    beta.raf = requestAnimationFrame(betaTitle);
  }).observe(main, { childList: true, subtree: true });
})();
