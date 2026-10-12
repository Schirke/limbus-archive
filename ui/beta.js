// BETA marks: the pages the owner marks as beta (Admin → Pages), read from beta.json on GitHub; shown on their menu links
// and next to the page's title, in the app and on the site.
"use strict";
const BETA_URL = "https://raw.githubusercontent.com/Schirke/limbus-archive/community-config/beta.json";
const beta = { routes: new Set(), raf: 0 };
document.head.insertAdjacentHTML("beforeend", `<style>
.betadot { font: 10px/1 "Segoe UI", sans-serif; color: #ff4d6d; text-transform: lowercase; letter-spacing: 0; margin-left: 4px; }
.betab { font: 11px/1 "LC Bebas", Impact, sans-serif; letter-spacing: .08em; color: #120e0b; background: #f8b400; padding: 3px 5px 2px;
  margin-left: 10px; vertical-align: middle; display: inline-block; }
</style>`);
function betaTitle() {
  const h = document.querySelector("#main h1");
  if (!h) return;
  const on = beta.routes.has(location.hash.split("/")[1] || "patches"), b = h.querySelector(".betab");
  if (on && !b) h.insertAdjacentHTML("beforeend", `<span class="betab">BETA</span>`);
  else if (!on && b) b.remove();
}
function betaApply(list) {
  beta.routes = new Set(Array.isArray(list) ? list.filter((r) => typeof r === "string") : []);
  try { localStorage.setItem("beta", JSON.stringify([...beta.routes])); } catch (e) { /* read again next time */ }
  document.querySelectorAll("#nav a[href^='#/'], #subnav a[href^='#/']").forEach((a) => {
    const on = beta.routes.has(a.getAttribute("href").split("/")[1]), dot = a.querySelector(".betadot");
    if (on && !dot) a.insertAdjacentHTML("beforeend", `<span class="betadot">beta</span>`);
    else if (!on && dot) dot.remove();
  });
  betaTitle();
}
(() => {
  try { betaApply(JSON.parse(localStorage.getItem("beta") || "[]")); } catch (e) { /* none until read */ }
  fetch(BETA_URL, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).then((j) => { if (j) betaApply(j.routes); }).catch(() => {});
  const main = document.querySelector("#main");
  if (main) new MutationObserver(() => {
    if (!beta.routes.size && !document.querySelector("#main .betab")) return;
    cancelAnimationFrame(beta.raf);
    beta.raf = requestAnimationFrame(betaTitle);
  }).observe(main, { childList: true, subtree: true });
})();
