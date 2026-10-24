"use strict";
// The web copy's stand-in for the app's server: /api/… answered from the files site.py wrote.
const DATA = "/d/";
const TYPES = { ogg: "audio/ogg", wav: "audio/wav", mp4: "video/mp4", webm: "video/webm", json: "application/json; charset=utf-8", txt: "text/plain; charset=utf-8", png: "image/png", webp: "image/webp",
  jpg: "image/jpeg", gif: "image/gif", otf: "font/otf", ttf: "font/ttf" };
const MEDIA = /\.(mp4|webm|ogg|wav|mp3)$/;
const ONLY_APP = "Only in the desktop app";
let site = null, loading = null, loaded = 0, tr = null;
// requests with no file, per page
const misses = new Map();
const NOT_NEWS = new Set();  // asked by every page on load, only the app answers
// requests per page and how many are in flight
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
  let urls = null;
  if (!idx.keys) {  // (a copy not packed: every manifest read whole)
    urls = new Map();
    for (const m of await Promise.all(idx.manifests.map((n) => getJson(`m/${n}.json.gz`))))
      for (const [k, f] of Object.entries(m.urls || {})) urls.set(k, f);
  }
  site = { stamp: idx.stamp, inline: idx.inline || {}, live: idx.live || {}, tr: idx.tr || [], keys: idx.keys, urls };
  tr = null;
  shards.clear();
  loaded = Date.now();
  if (idx.keys && idx.keys.files) prune(idx.keys.files).catch(() => {});
  return site;
}
// the request → file table in shards (limbusdm/site.py key_group, _key_shards)
const shards = new Map();
function fnv(s) {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(s)) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return h;
}
function group(k) {
  const i = k.indexOf("?"), path = i < 0 ? k : k.slice(0, i);
  if (path.startsWith("/spine/")) return "/spine/" + path.split("/")[2];
  const got = new Map();
  if (i >= 0) for (const part of k.slice(i + 1).split("&")) {
    const j = part.indexOf("=");
    if (j >= 0 && !got.has(part.slice(0, j))) got.set(part.slice(0, j), part.slice(j + 1));
  }
  for (const name of ["bundle", "id"]) if (got.has(name)) return `${path}?${name}=${got.get(name)}`;
  return path;
}
function shard(name) {
  let p = shards.get(name);
  if (!p) {
    p = kept("k/" + name).then((b) => gunzip(new Response(b)).json());
    shards.set(name, p);
    p.catch(() => shards.delete(name));
    if (shards.size > 120) shards.delete(shards.keys().next().value);
  }
  return p;
}
async function lookup(s, k) {
  if (s.urls) return s.urls.get(k);
  let g = group(k);
  const n = s.keys.split[g];
  if (n) g += "#" + (fnv(k) % n);
  const name = s.keys.f[fnv(g) % s.keys.f.length];
  return name ? (await shard(name))[k] : undefined;
}
// files of older copies of the site go from the browser's cache once a new copy is read
async function prune(list) {
  const meta = await caches.open("meta"), seen = await meta.match("/pruned");
  if (seen && (await seen.text()) === list) return;
  const keep = new Set((await (await kept("k/" + list).then((b) => gunzip(new Response(b)))).json()).map((f) => DATA + f));
  keep.add(DATA + "k/" + list);
  const cache = await caches.open("packs");
  for (const r of await cache.keys()) {
    const path = new URL(r.url).pathname;
    if (!keep.has(path)) { await cache.delete(r); packs.delete(path.slice(DATA.length)); }
  }
  await meta.put("/pruned", new Response(list));
}
function ready(force) {
  // re-read the index every few minutes
  if (!loading || force) loading = load().catch((e) => { loading = null; if (!site) throw e; });
  else if (site && Date.now() - loaded > 300e3) { loaded = Date.now(); load().catch(() => {}); }
  return loading.then(() => site);
}
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": TYPES.json } });
// request key: path + sorted params ("t" ignored)
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
  let file;
  try { file = await lookup(s, k); } catch (err) { return json({ error: "The site's data didn't load: " + err.message }, 503); }
  if (!file) { miss(e, k); return json({ error: ONLY_APP }, 404); }
  if (Array.isArray(file)) return packed(req, file);
  // a file stored in parts
  if (file.parts) return parted(req, file);
  // media fetched whole first
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
// a small file inside a pack: the pack fetched once and kept, the file cut out
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
// A file in parts: a Range request gets the part it starts in (next one prefetched); no Range: parts joined.
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

// the site's scripts and styles, named by the build (?<stamp>): kept until the next build, not asked again each visit
let uiBuild = null;
async function uiFile(req, build) {
  const cache = await caches.open("ui").catch(() => null);
  const hit = cache && await cache.match(req.url).catch(() => null);
  if (hit) return hit;
  const r = await fetch(req);
  if (r.ok && r.status === 200 && cache) {
    cache.put(req.url, r.clone()).catch(() => {});
    if (uiBuild !== build) {  // (an older build's go)
      uiBuild = build;
      cache.keys().then((ks) => ks.forEach((k) => { if (new URL(k.url).search !== build) cache.delete(k); })).catch(() => {});
    }
  }
  return r;
}

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("message", (e) => { if (e.data === "reload") ready(true); });
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (u.origin === location.origin && e.request.method === "GET" && /^\/ui\/[^?]+\.(js|css)$/.test(u.pathname) && /^\?\d+$/.test(u.search)) return e.respondWith(uiFile(e.request, u.search));
  if (u.origin !== location.origin || !/^\/(api|spine)\//.test(u.pathname)) return;
  if (u.pathname === "/api/_busy") { const w = work(e.clientId); return e.respondWith(json({ n: w.keys.size, busy: w.busy })); }
  if (u.pathname === "/api/_misses" || !e.clientId) return e.respondWith(answer(e.request, u, e));
  const w = work(e.clientId);
  w.keys.add(e.request.method + " " + u.pathname + u.search);  // (a request repeated on a timer isn't news)
  w.busy++;
  e.respondWith(answer(e.request, u, e).finally(() => { w.busy--; }));
});
