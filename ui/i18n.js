// The interface in another language (ui/lang/<lang>.json, limbusdm/uilang.py): a dictionary "English text → translation"
// put over the page as it is drawn. Follows the game-text language (LANG); game texts themselves go through langApply.
// Keys: "English" or "route|English" (only on that page); {0} = a number or a name, "{0|форма|формы|форм}" = the word
// form for {0}. On for everyone only when the owner lists the language in beta.json "ui"; admins always see it.
"use strict";
const UI = { lang: "", dict: null, pats: new Map(), loose: [], mine: new WeakMap(), data: new Set() };
// not the interface's own words: streams, news posts, video titles, file names
const UI_SKIP = 'script, style, textarea, code, pre, .mono, [translate="no"], .notr, [contenteditable="true"], '
  + ".cmtext > b, .cmtext > span, .cmrec, .cmlive, .nwtitle, .nwt, .nwx, .nwtext, .nwbody h3, .cbcard > b, .cben, .hvtxt";
const UI_ATTRS = ["title", "placeholder", "aria-label", "alt"];
const UI_PH = /\{(\d+)\}/g;
const uiForeign = /(?![\p{Script=Latin}])\p{L}/u;  // letters of another script: not English UI text
const uiRoute = () => (location.hash.split("/")[1] || "").split("?")[0];

// Russian-style word forms: 1 / 2–4 / 5+; two forms = 1 / other (Spanish); a language with one form gives one
function uiPlural(n, forms) {
  const f = forms.split("|"), x = Math.abs(parseFloat(String(n).replace(",", ".")));
  if (f.length === 2 && isFinite(x)) return x === 1 ? f[0] : f[1];
  if (f.length < 3 || !isFinite(x)) return f[f.length - 1];
  if (x % 1) return f[1];
  const d = x % 10, h = x % 100;
  return d === 1 && h !== 11 ? f[0] : d >= 2 && d <= 4 && (h < 12 || h > 14) ? f[1] : f[2];
}
function uiFill(tr, vals) {
  return tr.replace(/\{(\d+)(?:\|([^}]*))?\}/g, (m, i, forms) => {
    const v = vals[+i];
    if (v === undefined) return m;
    return forms !== undefined ? uiPlural(v, forms) : v;
  });
}
// keys with {n}: matched as patterns, indexed by their first / last letters; ones with {n} at both ends ("loose")
// by their longest piece of text
function uiIndex(dict) {
  UI.pats = new Map();
  UI.loose = [];
  for (const k of Object.keys(dict)) {
    const bar = k.indexOf("|"), route = bar > 0 && /^[a-z0-9-]+$/.test(k.slice(0, bar)) ? k.slice(0, bar) : "";
    const en = route ? k.slice(bar + 1) : k;
    if (!en.includes("{")) continue;
    const parts = en.split(/\{\d+\}/), letters = parts.join("").replace(/[^A-Za-z]/g, "").length;
    if (letters < 2) continue;
    // (a {n} right before another one takes at least a letter, else "{0}{1}" would give everything to {1})
    let re = parts.map((x, i) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + (i === parts.length - 1 ? "" : !parts[i + 1] && i + 1 < parts.length - 1 ? "(.+?)" : "(.*?)")).join("");
    // ("… only. {0}" where {0} is a link of its own: the text node ends before it)
    if (parts.length > 1 && !parts[parts.length - 1] && / $/.test(parts[parts.length - 2])) re = re.slice(0, -6) + "(?: (.*?))?";
    const p = { re: new RegExp("^" + re + "$"), k, route,
      order: [...en.matchAll(UI_PH)].map((m) => +m[1]) };
    if (!parts[0] && !parts[parts.length - 1]) {
      if (letters >= 2) UI.loose.push(Object.assign(p, { need: parts.reduce((a, b) => (b.length > a.length ? b : a)) }));
      continue;
    }
    const ix = parts[0] ? parts[0].slice(0, 3) : "$" + parts[parts.length - 1].slice(-3);
    if (!UI.pats.has(ix)) UI.pats.set(ix, []);
    UI.pats.get(ix).push(p);
  }
}
function uiExact(one, route) {
  return UI.dict[route + "|" + one] ?? UI.dict[one];
}
// one piece of text: exact, then a pattern ({0} = number or name; a name that is itself interface gets translated),
// then the same without the marks around it ("♪ ", " ›", "· ")
function uiOne(one, deep = 0) {
  const route = uiRoute();
  let x = uiExact(one, route);
  if (x !== undefined) return x;
  if (UI.data.has(one) || !/[A-Za-z]/.test(one)) return null;
  const c = UI.loose.filter((p) => one.includes(p.need));
  for (let n = 1; n <= 3; n++) c.push(...(UI.pats.get(one.slice(0, n)) || []), ...(UI.pats.get("$" + one.slice(-n)) || []));
  let best = null;
  for (const p of c) {  // this page's own key first, then the longest one
    if (p.route && p.route !== route) continue;
    const m = p.re.exec(one), score = (p.route ? 1e6 : 0) + p.k.length;
    // (a loose one must start with a number or a data name: "6 days" yes, "Every day counts" no)
    if (m && p.need && !/\d/.test(m[1]) && !UI.data.has(m[1].trim()) && UI.dict[m[1].trim()] === undefined) continue;
    if (m && (!best || score > best.score)) best = { p, m, score };
  }
  if (best) {
    const vals = [];
    best.p.order.forEach((n, i) => {
      const v = best.m[i + 1] ?? "";
      const t = /\d/.test(v) && !/[A-Za-z]{2}/.test(v) || deep || !v.trim() ? null : uiOne(v.trim(), 1);
      vals[n] = t == null ? v : v.match(/^\s*/)[0] + t + v.match(/\s*$/)[0];
    });
    return uiFill(UI.dict[best.p.k], vals).trim();
  }
  const m = /^([^A-Za-z0-9{]*)(.*?)([^A-Za-z0-9}.…?!)]*)$/.exec(one);
  if (deep < 2 && m && (m[1] || m[3]) && m[2]) {
    const t = uiOne(m[2], 2);
    if (t != null) return m[1] + t + m[3];
  }
  return null;
}
// whole text, else its " · " parts one by one (data names in between stay)
function uiT(s) {
  const one = s.replace(/\s+/g, " ").trim();
  if (!one || !UI.dict) return null;
  const x = uiOne(one);
  if (x != null || !one.includes(" · ")) return x;
  let any = false;
  const out = one.split(" · ").map((p) => {
    let t = uiOne(p);
    if (t == null && (t = uiOne("· " + p)) != null) t = t.replace(/^·\s*/, "");
    if (t != null) any = true;
    return t ?? p;
  }).join(" · ");
  return any ? out : null;
}
// texts that came from the app's data lists: only a whole dictionary key is translated in them, never a pattern
function uiData(o, depth = 0) {
  if (typeof o === "string") {
    if (o.length < 200 && /[A-Za-z]/.test(o)) { const one = o.replace(/\s+/g, " ").trim(); UI.data.add(one); if (one.includes(" · ")) one.split(" · ").forEach((p) => UI.data.add(p)); }
  } else if (o && typeof o === "object" && depth < 12) for (const v of Array.isArray(o) ? o : Object.values(o)) uiData(v, depth + 1);
}
// the admin pages stay English
const uiSkip = (el) => !el || !!el.closest(UI_SKIP) || (location.hash.startsWith("#/adm") && !!el.closest("#main"));

function uiText(n, walked) {
  const v = n.nodeValue;
  if (!v || UI.mine.get(n) === v || !/[A-Za-z]/.test(v) || (!walked && uiSkip(n.parentElement))) return;
  const x = uiT(v);
  if (x == null) return;
  const out = v.match(/^\s*/)[0] + x + v.match(/\s*$/)[0];
  UI.mine.set(n, out);
  n.nodeValue = out;
}
function uiAttrs(el) {
  for (const a of UI_ATTRS) {
    const v = el.getAttribute(a);
    if (!v || el[`_ui_${a}`] === v || !/[A-Za-z]/.test(v)) continue;
    const x = uiT(v);
    if (x == null) continue;
    el[`_ui_${a}`] = x;
    el.setAttribute(a, x);
  }
}
function uiWalk(root) {
  if (root.nodeType === 3) return uiText(root);
  if (root.nodeType !== 1 || uiSkip(root)) return;
  uiAttrs(root);
  const adm = location.hash.startsWith("#/adm");
  const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    { acceptNode: (n) => n.nodeType === 1 && (n.matches(UI_SKIP) || adm && n.id === "main") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
  for (let n = w.nextNode(); n; n = w.nextNode()) n.nodeType === 3 ? uiText(n, true) : uiAttrs(n);
}
// (checking) the English bits of the open page the dictionary doesn't know
function uiMissing() {
  const out = new Set(), add = (s) => {
    const one = (s || "").replace(/\s+/g, " ").trim();
    if (one.length > 1 && /[A-Za-z]{2}/.test(one) && !uiForeign.test(one) && !UI.data.has(one) && uiT(one) == null) out.add(one);
  };
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    { acceptNode: (n) => n.nodeType === 1 && n.matches(UI_SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (n.nodeType === 3) { if (!UI.mine.has(n)) add(n.nodeValue); }
    else for (const a of UI_ATTRS) if (n.getAttribute(a) && n[`_ui_${a}`] !== n.getAttribute(a)) add(n.getAttribute(a));
  }
  return [...out];
}

{
  const raw = api;  // every list the pages read: its texts are data
  const own = /^\/api\/(state|settings|appnotes|ui_lang|langs|ext\/)/;  // (the app's own messages are interface)
  api = async (path, body) => { const d = await raw(path, body); if (body === undefined && path.startsWith("/api/") && !own.test(path)) uiData(d); return d; };
}
(async () => {
  const site = document.body.classList.contains("site");
  let off = false, admin = false;
  try { off = localStorage.getItem("ui_lang") === "off"; } catch {}
  if (!LANG.id || off) return;
  try { admin = !site && ((await fetch("/api/state").then((r) => r.json())).ext || []).length > 0; } catch {}
  const l = (await langList()).find((x) => x.id === LANG.id);
  const ui = await fetch("/api/ui_langs").then((r) => r.ok ? r.json() : {}).catch(() => ({})), have = ui.langs || [];
  const code = l && [l.lang, l.lang.split("-")[0]].find((c) => have.includes(c));
  if (!code) return;
  // the owner's switch (Admin → Translations): the last one read, or the fresh one if it comes quickly
  let on = [];
  try { on = JSON.parse(localStorage.getItem("beta_ui") || "[]"); } catch {}
  if (!admin && !on.includes(code) && typeof betaReady !== "undefined") {
    const j = await Promise.race([betaReady, new Promise((r) => setTimeout(() => r(null), 3000))]);
    if (j && Array.isArray(j.ui)) on = j.ui;
  }
  if (!admin && !on.includes(code)) return;
  UI.dict = ui.urls && ui.urls[code] ? await fetch(ui.urls[code]).then((r) => r.ok ? r.json() : null).catch(() => null) : null;
  if (!UI.dict || !Object.keys(UI.dict).length) { UI.dict = null; return; }
  UI.lang = code;
  document.documentElement.lang = code;
  document.documentElement.dataset.uilang = code;
  uiIndex(UI.dict);
  for (const k of ["alert", "confirm", "prompt"]) {
    const f = window[k];
    window[k] = (msg, ...a) => { if (typeof msg === "string") { const x = uiT(msg); if (x != null) msg = x; } return f.call(window, msg, ...a); };
  }
  uiWalk(document.body);
  let todo = new Set(), queued = false;
  new MutationObserver((ms) => {
    for (const m of ms) {
      if (m.type === "childList") m.addedNodes.forEach((n) => todo.add(n));
      else todo.add(m.target);
    }
    if (!queued) {
      queued = true;
      queueMicrotask(() => { queued = false; const t = todo; todo = new Set(); t.forEach((n) => n.isConnected && uiWalk(n)); });
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: UI_ATTRS });
})();
