"use strict";
// The web copy's stand-in for the app's server: the UI's /api/… requests are answered from the files that
// limbusdm/site.py wrote (d/index.json → manifests "request → file"). Anything else exists only in the app.
const DATA = "/d/";
const TYPES = { ogg: "audio/ogg", wav: "audio/wav", mp4: "video/mp4", webm: "video/webm", json: "application/json; charset=utf-8", txt: "text/plain; charset=utf-8", png: "image/png", webp: "image/webp",
  jpg: "image/jpeg", gif: "image/gif", otf: "font/otf", ttf: "font/ttf" };
const MEDIA = /\.(mp4|webm|ogg|wav|mp3)$/;
const ONLY_APP = "Only in the desktop app";
let site = null, loading = null, loaded = 0, tr = null;
// what each page asked for and the site has no file for (the app's check reads it: limbusdm/sitecheck.py)
const misses = new Map();
const NOT_NEWS = new Set();  // asked by every page on load, only the app answers
// …and what it asked for at all, with how many answers are still on their way: the check waits for a page to go quiet
const asked = new Map();
function work(id) {
  if (!asked.has(id)) asked.set(id, { keys: new Set(), busy: 0 });
  if (asked.size > 40) asked.delete(asked.keys().next().value);
  return asked.get(id);
}
function miss(e, k) {
  if (!e.clientId || NOT_NEWS.has(k)) return;
  if (!misses.has(e.clientId)) misses.set(e.clientId, []);
  misses.get(e.clientId).push(k);
  if (misses.size > 40) misses.delete(misses.keys().next().value);
}

const gunzip = (r) => new Response(r.body.pipeThrough(new DecompressionStream("gzip")));
const getJson = async (path) => {
  const r = await fetch(DATA + path, { cache: "no-cache" });
  if (!r.ok) throw new Error(path + " " + r.status);
  return (path.endsWith(".gz") ? gunzip(r) : r).json();
};
async function load() {
  const idx = await getJson("index.json");
  if (site && site.stamp === idx.stamp) { loaded = Date.now(); return site; }
  const urls = new Map();
  for (const m of await Promise.all(idx.manifests.map((n) => getJson(`m/${n}.json.gz`))))
    for (const [k, f] of Object.entries(m.urls || {})) urls.set(k, f);
  site = { stamp: idx.stamp, inline: idx.inline || {}, live: idx.live || {}, tr: idx.tr || [], urls };
  tr = null;
  loaded = Date.now();
  return site;
}
function ready(force) {
  // a new patch on the site shows up without reinstalling the worker: the index is looked at again every few minutes
  if (!loading || force) loading = load().catch((e) => { loading = null; if (!site) throw e; });
  else if (site && Date.now() - loaded > 300e3) { loaded = Date.now(); load().catch(() => {}); }
  return loading.then(() => site);
}
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": TYPES.json } });
// a request's name in the manifests: the path and its parameters sorted ("t" only busts caches)
function keyOf(u) {
  const q = [...u.searchParams].filter(([k]) => k !== "t" && k !== "refresh" && k !== "force").map(([k, v]) => `${k}=${v}`).sort();
  let path = u.pathname;
  try { path = decodeURIComponent(path); } catch (e) { /* as it is */ }
  return path + (q.length ? "?" + q.join("&") : "");
}
async function translate(req) {
  const { texts = [] } = await req.json().catch(() => ({}));
  if (!tr) {
    tr = {};
    for (const part of await Promise.all(site.tr.map((n) => getJson(`tr/${n}.json.gz`).catch(() => ({}))))) Object.assign(tr, part);
  }
  return json({ result: texts.map((t) => tr[t] || null) });
}
async function answer(req, u, e) {
  let s;
  try { s = await ready(); } catch (e) { return json({ error: "The site's data didn't load: " + e.message }, 503); }
  if (req.method !== "GET") {
    if (u.pathname === "/api/translate") return translate(req);
    if (u.pathname === "/api/myteam") {  // the visitor's own teams stay in their browser
      const body = await req.text();
      (await caches.open("own")).put("/api/myteam", new Response(body, { headers: { "Content-Type": TYPES.json } }));
      return new Response(body, { headers: { "Content-Type": TYPES.json } });
    }
    if (u.pathname === "/api/open_url") {
      const { url = "" } = await req.json().catch(() => ({}));
      const c = url.startsWith("https://") && e.clientId && await self.clients.get(e.clientId);
      if (c) c.postMessage({ open: url });
      return json({ ok: !!c });
    }
    if (/^\/api\/(mark|patchnotes_seen|appnotes_seen)$/.test(u.pathname)) return json({ ok: true });
    return json({ error: ONLY_APP }, 400);
  }
  const k = keyOf(u);
  if (k === "/api/myteam") return (await (await caches.open("own")).match(k)) || json({});
  if (k in s.inline) return json(s.inline[k]);
  if (k === "/api/_misses") return json(misses.get(e.clientId) || []);
  if (s.live[k]) {  // read from where the app reads it, now
    try { return json(await (await fetch(s.live[k], { cache: "no-cache" })).json()); } catch (err) { return json({}); }
  }
  const file = s.urls.get(k);
  if (!file) { miss(e, k); return json({ error: ONLY_APP }, 404); }
  if (Array.isArray(file)) return packed(req, file);
  // a file that lies on the host in parts (limbusdm/site.py pack: a video, or anything above what the host takes)
  if (file.parts) return parted(req, file);
  // a sound / video on its own: fetched whole first — the host can't send a part of a file, and a player that
  // seeks asks for parts
  if (MEDIA.test(file)) {
    const ext = file.split(".").pop();
    try { const blob = await kept(file); return part(req, blob, 0, blob.size, TYPES[ext]); }
    catch (e) { return json({ error: "missing on the site" }, 404); }
  }
  const r = await fetch(DATA + file);
  if (!r.ok) return json({ error: "missing on the site" }, 404);
  const gz = file.endsWith(".gz"), ext = file.replace(/\.gz$/, "").split(".").pop();
  return new Response((gz ? gunzip(r) : r).body, { headers: { "Content-Type": TYPES[ext] || "application/octet-stream", "Cache-Control": "max-age=3600" } });
}
// a small file inside a pack (the site as it is uploaded: limbusdm/site.py pack): [pack, offset, length, extension].
// The pack is fetched whole once and kept (its name is its content), the file is cut out of it.
const packs = new Map();
function kept(path) {
  let p = packs.get(path);
  if (!p) {
    p = (async () => {
      const url = DATA + path, cache = await caches.open("packs").catch(() => null);
      let r = cache && await cache.match(url);
      if (!r) {
        r = await fetch(url);
        if (!r.ok) throw new Error(path + " " + r.status);
        if (cache) cache.put(url, r.clone()).catch(() => {});
      }
      return r.blob();
    })();
    packs.set(path, p);
    p.catch(() => packs.delete(path));
    if (packs.size > 60) packs.delete(packs.keys().next().value);
  }
  return p;
}
// `len` bytes of a kept file from `off`, or the part of them a player asks for
function part(req, blob, off, len, type) {
  const m = /bytes=(\d+)-(\d*)/.exec(req.headers.get("Range") || "");
  const a = m ? Math.min(+m[1], len - 1) : 0, b = m && m[2] ? Math.min(+m[2], len - 1) : len - 1;
  const headers = { "Content-Type": type, "Content-Length": String(b - a + 1), "Accept-Ranges": "bytes", "Cache-Control": "max-age=86400" };
  if (m) headers["Content-Range"] = `bytes ${a}-${b}/${len}`;
  return new Response(blob.slice(off + a, off + b + 1, type), { status: m ? 206 : 200, headers });
}
// A file in parts. A player asks for a piece ("Range"): it gets the part that piece starts in, no more — a player takes
// what it is given and asks on from there, so a video starts after its first part, and a jump fetches the part jumped
// to. The next part is fetched meanwhile. Asked for whole (no Range), the parts are joined.
async function parted(req, file) {
  const type = TYPES[file.ext || file.parts[0].split(".").slice(-2)[0]] || "application/octet-stream";
  const m = /bytes=(\d+)-(\d*)/.exec(req.headers.get("Range") || ""), step = file.part, size = file.size;
  try {
    if (!m || !step || !size) { const blob = new Blob(await Promise.all(file.parts.map(kept))); return part(req, blob, 0, blob.size, type); }
    const a = Math.min(+m[1], size - 1), i = Math.floor(a / step);
    const b = Math.min(m[2] ? +m[2] : size - 1, size - 1, (i + 1) * step - 1);
    const blob = await kept(file.parts[i]);
    if (file.parts[i + 1]) kept(file.parts[i + 1]).catch(() => {});
    return new Response(blob.slice(a - i * step, b - i * step + 1, type), { status: 206, headers: { "Content-Type": type, "Content-Length": String(b - a + 1),
      "Accept-Ranges": "bytes", "Content-Range": `bytes ${a}-${b}/${size}`, "Cache-Control": "max-age=86400" } });
  } catch (e) { return json({ error: "missing on the site" }, 404); }
}
async function packed(req, [pack, off, len, ext]) {
  const gz = ext.endsWith(".gz"), type = TYPES[ext.replace(/\.gz$/, "")] || "application/octet-stream";
  let blob;
  try { blob = await kept("p/" + pack); } catch (e) { return json({ error: "missing on the site" }, 404); }
  if (gz) return new Response(blob.slice(off, off + len).stream().pipeThrough(new DecompressionStream("gzip")), { headers: { "Content-Type": type } });
  return part(req, blob, off, len, type);
}

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("message", (e) => { if (e.data === "reload") ready(true); });
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin || !/^\/(api|spine)\//.test(u.pathname)) return;
  if (u.pathname === "/api/_busy") { const w = work(e.clientId); return e.respondWith(json({ n: w.keys.size, busy: w.busy })); }
  if (u.pathname === "/api/_misses" || !e.clientId) return e.respondWith(answer(e.request, u, e));
  const w = work(e.clientId);
  w.keys.add(e.request.method + " " + u.pathname + u.search);  // (a request repeated on a timer isn't news)
  w.busy++;
  e.respondWith(answer(e.request, u, e).finally(() => { w.busy--; }));
});
