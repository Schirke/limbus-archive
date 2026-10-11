// The interface in another language (limbusdm/uilang.py): a dictionary "English text → translation" put over the
// page as it is drawn. Follows the game-text language (LANG); game texts themselves go through langApply.
"use strict";
const UI = { lang: "", dict: null, queue: new Set(), mine: new WeakMap(), collect: false, data: new Set() };
const UI_NUM = /\d+(?:[.,:]\d+)*/g;
// not the interface's own words: streams, news posts, video titles, file names
const UI_SKIP = 'script, style, textarea, code, pre, .mono, [translate="no"], .notr, [contenteditable="true"], '
  + ".cmtext > b, .cmtext > span, .cmrec, .cmlive, .nwtitle, .nwt, .nwx, .nwtext, .nwbody h3, .cbcard > b, .cben, .hvtxt";
const UI_ATTRS = ["title", "placeholder", "aria-label"];
const uiForeign = /(?![\p{Script=Latin}])\p{L}/u;  // letters of another script: not English UI text

function uiOne(one) {
  if (UI.data.has(one)) return null;
  let x = UI.dict[one];
  if (x !== undefined) return x;
  const nums = [];
  x = UI.dict[one.replace(UI_NUM, (m) => { nums.push(m); return `{${nums.length - 1}}`; })];
  return x === undefined ? null : x.replace(/\{(\d+)\}/g, (m, i) => nums[+i] ?? m);
}
// whole text, else its " · " parts one by one (data names in between stay)
function uiT(s) {
  const one = s.replace(/\s+/g, " ").trim();
  if (!one || !UI.dict) return null;
  const x = uiOne(one);
  if (x != null || !one.includes(" · ")) return x;
  let any = false;
  const out = one.split(" · ").map((p) => { const t = uiOne(p); if (t != null) any = true; return t ?? p; }).join(" · ");
  return any ? out : null;
}
// texts that came from the app's data lists: never interface words
function uiData(o, depth = 0) {
  if (typeof o === "string") {
    if (o.length < 200 && /[A-Za-z]/.test(o)) { const one = o.replace(/\s+/g, " ").trim(); UI.data.add(one); if (one.includes(" · ")) one.split(" · ").forEach((p) => UI.data.add(p)); }
  } else if (o && typeof o === "object" && depth < 12) for (const v of Array.isArray(o) ? o : Object.values(o)) uiData(v, depth + 1);
}
// candidate interface strings of a text: its " · " parts that aren't data
const uiCand = (s) => {
  const one = s.replace(/\s+/g, " ").trim();
  if (one.length < 2 || !/[A-Za-z]{2}/.test(one) || uiForeign.test(one) || UI.data.has(one)) return [];
  return one.split(" · ").map((p) => p.trim()).filter((p) => p.length > 1 && /[A-Za-z]{2}/.test(p) && !UI.data.has(p));
};
const uiNote = (s) => { if (UI.collect && !location.hash.startsWith("#/adm")) uiCand(s).forEach((c) => UI.queue.add(c)); };
const uiSkip = (el) => !el || !!el.closest(UI_SKIP);

function uiText(n, walked) {
  const v = n.nodeValue;
  if (!v || UI.mine.get(n) === v || !/[A-Za-z]/.test(v) || (!walked && uiSkip(n.parentElement))) return;
  const x = uiT(v);
  if (x == null) return uiNote(v);
  const out = v.match(/^\s*/)[0] + x + v.match(/\s*$/)[0];
  UI.mine.set(n, out);
  n.nodeValue = out;
}
function uiAttrs(el) {
  for (const a of UI_ATTRS) {
    const v = el.getAttribute(a);
    if (!v || el[`_ui_${a}`] === v || !/[A-Za-z]/.test(v)) continue;
    const x = uiT(v);
    if (x == null) { uiNote(v); continue; }
    el[`_ui_${a}`] = x;
    el.setAttribute(a, x);
  }
}
function uiWalk(root) {
  if (root.nodeType === 3) return uiText(root);
  if (root.nodeType !== 1 || uiSkip(root)) return;
  uiAttrs(root);
  const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    { acceptNode: (n) => n.nodeType === 1 && n.matches(UI_SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
  for (let n = w.nextNode(); n; n = w.nextNode()) n.nodeType === 3 ? uiText(n, true) : uiAttrs(n);
}
// every candidate string of the whole page, dictionary or not (the app's crawler, uilang.crawl)
function uiCollect() {
  const out = new Set(), add = (s) => uiCand(s).forEach((c) => out.add(c));
  if (location.hash.startsWith("#/adm")) return [];
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    { acceptNode: (n) => n.nodeType === 1 && n.matches(UI_SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (n.nodeType === 3) add(n.nodeValue || "");
    else for (const a of UI_ATTRS) if (n.getAttribute(a)) add(n.getAttribute(a));
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
  try {
    const st = site ? {} : await fetch("/api/state").then((r) => r.json());
    UI.collect = !!st.site_publish;  // the owner's computer gathers new strings as pages are used
  } catch {}
  let off = false;
  try { off = localStorage.getItem("ui_lang") === "off"; } catch {}
  if (LANG.id && !off) {
    const l = (await langList()).find((x) => x.id === LANG.id);
    const have = await fetch("/api/ui_langs").then((r) => r.ok ? r.json() : {}).then((o) => o.langs || []).catch(() => []);
    const code = l && [l.lang, l.lang.split("-")[0]].find((c) => have.includes(c));
    if (code) {
      UI.dict = await fetch(`/api/ui_lang?lang=${encodeURIComponent(code)}`).then((r) => r.ok ? r.json() : null).catch(() => null);
      if (UI.dict && Object.keys(UI.dict).length) UI.lang = code; else UI.dict = null;
    }
  }
  if (!UI.dict && !UI.collect) return;
  for (const k of ["alert", "confirm", "prompt"]) {
    const f = window[k];
    window[k] = (msg, ...a) => { if (typeof msg === "string") { const x = uiT(msg); if (x == null) uiNote(msg); else msg = x; } return f.call(window, msg, ...a); };
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
  if (UI.collect) setInterval(() => {
    if (!UI.queue.size) return;
    const strings = [...UI.queue];
    UI.queue.clear();
    api("/api/ui_lang/seen", { strings, page: location.hash.split("/")[1] || "" }).catch(() => {});
  }, 5000);
})();
