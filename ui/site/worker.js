// The site's Worker: static files, /room/<code> live-match rooms (a Durable Object relaying messages in one order with
// its clock), and /stat/* visitor counts (daily sums, salted daily hashes).
import { DurableObject } from "cloudflare:workers";

const MOST = 8;

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // pings answered without waking the room
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'));
  }

  players() {
    return this.ctx.getWebSockets().map((ws) => ({ ws, ...(ws.deserializeAttachment() || {}) })).filter((p) => p.id).sort((a, b) => a.at - b.at);
  }

  async fetch(req) {
    if (req.headers.get("Upgrade") !== "websocket") return new Response("a room: connect with a WebSocket", { status: 426 });
    const q = new URL(req.url).searchParams, id = (q.get("id") || "").slice(0, 24), name = (q.get("name") || "").trim().slice(0, 20) || "Sinner";
    const state = (await this.ctx.storage.get("state")) || {}, there = this.players();
    const pair = new WebSocketPair(), [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    const again = there.find((p) => p.id === id);  // the same player from a page opened anew: the old line goes
    if (!id || (!again && there.length >= Math.min(MOST, state.max || MOST))) {
      server.send(JSON.stringify({ t: "full" }));
      server.close(1000, "full");
      return new Response(null, { status: 101, webSocket: client });
    }
    if (again) { again.ws.serializeAttachment(null); try { again.ws.close(1000, "again"); } catch {} }
    server.serializeAttachment({ id, name, at: again ? again.at : Date.now() });
    if (!(await this.ctx.storage.get("host")) || !this.players().some((p) => p.id === state.host)) await this.host(state);
    await this.tell();
    return new Response(null, { status: 101, webSocket: client });
  }

  // the host: who set the room up, or — when they are gone — who has been in the longest
  async host(state) {
    const first = this.players()[0];
    state.host = first ? first.id : "";
    await this.ctx.storage.put("state", state);
    await this.ctx.storage.put("host", state.host);
  }

  async tell() {
    const state = (await this.ctx.storage.get("state")) || {}, all = this.players(), list = all.map(({ id, name }) => ({ id, name }));
    for (const p of all) try { p.ws.send(JSON.stringify({ t: "room", you: p.id, host: state.host, players: list, state, now: Date.now() })); } catch {}
  }

  async webSocketMessage(ws, text) {
    let m;
    try { m = JSON.parse(text); } catch { return; }
    const me = ws.deserializeAttachment();
    if (!me || !me.id || typeof text !== "string" || text.length > 8000) return;
    if (m.t === "ping") return ws.send(JSON.stringify({ t: "pong", now: Date.now() }));
    if (m.t === "set") {
      const state = (await this.ctx.storage.get("state")) || {};
      if (state.host !== me.id || !m.state || typeof m.state !== "object") return;
      await this.ctx.storage.put("state", { ...m.state, host: state.host });
      return this.tell();
    }
    if (m.t === "msg") {
      const out = JSON.stringify({ t: "msg", from: me.id, data: m.data, now: Date.now() });
      for (const p of this.players()) try { p.ws.send(out); } catch {}
    }
  }

  async webSocketClose(ws) {
    const me = ws.deserializeAttachment();
    ws.serializeAttachment(null);
    try { ws.close(); } catch {}
    if (!me || !me.id) return;
    const state = (await this.ctx.storage.get("state")) || {};
    if (!this.players().length) return this.ctx.storage.deleteAll();  // the last one left: the room is forgotten
    if (state.host === me.id) await this.host(state);
    await this.tell();
  }

  webSocketError(ws) { return this.webSocketClose(ws); }
}

// Stats: daily sums by key and today's visitors; hits are batched by the Worker.
const DAY = 86400e3, NOW = 16 * 60e3;  // pages report every ten minutes
const FLUSH = 300e3, MOST_HITS = 300, PER_MIN = 30, OPENED = 50;
const dayOf = (t) => new Date(t).toISOString().slice(0, 10);
const budgetOf = (env) => { try { const b = JSON.parse(env.BUDGET || ""); return b && typeof b === "object" ? b : null; } catch { return null; } };
// the period the moment is in: [its first day, the first moment of the next one]
const periodOf = (now, day) => {
  const d = new Date(now), at = (y, m) => Date.UTC(y, m, Math.min(day, new Date(Date.UTC(y, m + 1, 0)).getUTCDate()));
  let y = d.getUTCFullYear(), m = d.getUTCMonth();
  if (at(y, m) > now) m--;
  return [dayOf(at(y, m)), at(y, m + 1)];
};

export class Stats extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.budget = budgetOf(env);
    this.rows = 0;
    this.sql.exec("CREATE TABLE IF NOT EXISTS c (day TEXT, k TEXT, n INTEGER, PRIMARY KEY (day, k))");
    this.sql.exec("CREATE TABLE IF NOT EXISTS s (h TEXT PRIMARY KEY, day TEXT, at INTEGER, p TEXT)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS salt (day TEXT PRIMARY KEY, v TEXT)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS u (period TEXT PRIMARY KEY, w INTEGER, d INTEGER, r INTEGER)");
  }

  // a statement that writes: its rows are a part of the allowance
  put(q, ...a) { const c = this.sql.exec(q, ...a); c.toArray(); this.rows += c.rowsWritten || 1; }

  add(day, k, n) { this.put("INSERT INTO c VALUES (?, ?, ?) ON CONFLICT (day, k) DO UPDATE SET n = n + excluded.n", day, k, n); }

  // this period's usage
  spent(w, d) {
    const now = Date.now(), b = this.budget, [period, until] = periodOf(now, (b && +b.day) || 1);
    let u = this.sql.exec("SELECT w, d, r FROM u WHERE period = ?", period).toArray()[0];
    if (!u) {
      u = { w: (b && b.used && +b.used[period]) || 0, d: 0, r: 0 };
      this.sql.exec("DELETE FROM u WHERE period < ?", dayOf(now - 400 * DAY));
    }
    u = { w: u.w + w, d: u.d + d, r: u.r + this.rows + 2 };
    this.rows = 0;
    this.sql.exec("INSERT OR REPLACE INTO u VALUES (?, ?, ?, ?)", period, u.w, u.d, u.r);
    const off = !!b && ((b.requests > 0 && u.w >= b.requests) || (b.objects > 0 && u.d >= b.objects) || (b.rows > 0 && u.r >= b.rows));
    return { period, until, ...u, off };
  }

  async hit(x, sums) {
    const ua = String(x.ua || ""), m = x.m && typeof x.m === "object" ? x.m : {};
    const now = Date.now(), day = dayOf(now), name = (p) => String(p || "").slice(0, 24).replace(/[^a-z0-9]/gi, "") || "patches", page = name(m.p);
    const bump = (k) => sums.set(k, (sums.get(k) || 0) + 1);
    let salt = this.sql.exec("SELECT v FROM salt WHERE day = ?", day).toArray()[0];
    if (!salt) {  // a new day: yesterday's visitors are forgotten, and the sums older than a quarter
      salt = { v: crypto.randomUUID() };
      this.put("DELETE FROM salt");
      this.put("INSERT INTO salt VALUES (?, ?)", day, salt.v);
      this.put("DELETE FROM s WHERE day < ?", day);
      this.put("DELETE FROM c WHERE day < ?", dayOf(now - 92 * DAY));
    }
    const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(salt.v + String(x.ip || "") + ua));
    const h = [...new Uint8Array(raw).slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
    if (!this.sql.exec("SELECT 1 FROM s WHERE h = ?", h).toArray().length) {
      bump("v");
      bump("cc:" + (String(x.cc || "").replace(/[^A-Z]/g, "").slice(0, 2) || "??"));
      bump("dv:" + (/iPad|Tablet|Android(?!.*Mobi)/i.test(ua) ? "Tablet" : /Mobi|iPhone/i.test(ua) ? "Phone" : "Desktop"));
    }
    this.put("INSERT INTO s VALUES (?, ?, ?, ?) ON CONFLICT (h) DO UPDATE SET at = excluded.at, p = excluded.p", h, day, now, page);
    // pages opened since the last report
    const opened = Array.isArray(m.o) ? m.o.slice(0, OPENED) : m.beat ? [] : [[m.p, m.u]];
    for (const o of opened) {
      if (!Array.isArray(o)) continue;
      if (!o[2]) { bump("p"); bump("pg:" + name(o[0])); }
      if (/^\d{5}$/.test(o[1] || "")) bump("u:" + o[1]);
    }
  }

  // the hits a Worker kept, and what it has spent since it told last -> {off, until}
  async take(m) {
    const sums = new Map(), day = dayOf(Date.now());
    for (const x of Array.isArray(m.hits) ? m.hits.slice(0, MOST_HITS) : []) await this.hit(x || {}, sums);
    for (const [k, n] of sums) this.add(day, k, n);
    const u = this.spent(Math.max(0, +m.w || 0), 1 + Math.max(0, +m.d || 0));
    return { off: u.off, until: u.until };
  }

  get() {
    const now = Date.now(), sum = (days) => {
      const o = {};
      for (const r of this.sql.exec("SELECT k, SUM(n) AS n FROM c WHERE day >= ? GROUP BY k", dayOf(now - (days - 1) * DAY))) o[r.k] = r.n;
      return o;
    };
    const by = Object.fromEntries(this.sql.exec("SELECT day, n FROM c WHERE k = 'v' AND day >= ?", dayOf(now - 13 * DAY)).toArray().map((r) => [r.day, r.n]));
    const u = this.spent(0, 1), b = this.budget;
    return {
      now, today: dayOf(now), sets: { day: sum(1), prev: sum(2), week: sum(7), month: sum(30) },
      days: Array.from({ length: 14 }, (_, i) => dayOf(now - (13 - i) * DAY)).map((d) => [d, by[d] || 0]),
      online: this.sql.exec("SELECT p FROM s WHERE at > ?", now - NOW).toArray().map((r) => r.p),
      spent: { ...u, most: b ? { w: +b.requests || 0, d: +b.objects || 0, r: +b.rows || 0 } : null },
    };
  }

  async fetch(req) {
    if (req.method === "POST") return Response.json(await this.take((await req.json().catch(() => null)) || {}));
    return new Response(JSON.stringify(this.get()), { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
  }
}

// per-isolate state between requests
const G = { hits: [], w: 0, d: 0, at: 0, off: 0, ips: new Map(), min: 0, got: null };

async function flush(env) {
  const body = JSON.stringify({ hits: G.hits, w: G.w, d: G.d });
  G.hits = []; G.w = 0; G.d = 0; G.at = Date.now();
  try {
    const r = await env.STATS.get(env.STATS.idFromName("site")).fetch("https://stats/take", { method: "POST", body });
    const a = await r.json();
    G.off = a.off ? a.until : 0;
  } catch { /* the hits kept since the last time are lost */ }
}

// old addresses move for good to the site's own (a browser first carries its storage over)
const MOVE_PAGE = `<!doctype html><meta charset="utf-8"><title>Limbus Archive</title><meta name="robots" content="noindex">
<p style="font:15px sans-serif;color:#888">Limbus Archive has moved to <a id="to" href="">limbus-archive.com</a>…</p>
<script>
(async () => {
  const to = %TO%, m = { d: {}, h: location.hash };
  document.getElementById("to").href = to;
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); m.d[k] = localStorage.getItem(k); } } catch (e) {}
  try {
    const r = await Promise.race([caches.open("own").then((c) => c.match("/api/myteam")), new Promise((ok) => setTimeout(ok, 1500))]);
    if (r) m.own = await r.text();
  } catch (e) {}
  document.cookie = "moved=1; max-age=31536000; path=/; secure; samesite=lax";
  const move = Object.keys(m.d).length || m.own ? "#move=" + encodeURIComponent(JSON.stringify(m)) : location.hash;
  location.replace(to + (move.length < 1.5e6 ? move : location.hash));
})();
</script>`;

function moved(req, u, env) {
  let home;
  try { home = new URL(env.HOME); } catch { return null; }
  const old = u.hostname.endsWith(".workers.dev");
  if (u.hostname === home.hostname || !(old || u.hostname === "www." + home.hostname)) return null;
  if ((req.method !== "GET" && req.method !== "HEAD") || req.headers.get("Upgrade") === "websocket") return null;
  if (/^\/(room|stat|d|ui|api|spine)\/|^\/sw\.js$/.test(u.pathname)) return null;
  const to = home.origin + u.pathname + u.search;
  if (old && req.headers.get("Sec-Fetch-Dest") === "document" && !/(^|;\s*)moved=1/.test(req.headers.get("Cookie") || ""))
    return new Response(MOVE_PAGE.replace("%TO%", JSON.stringify(to)), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  return Response.redirect(to, 301);
}

export default {
  async fetch(req, env, ctx) {
    const u = new URL(req.url), now = Date.now(), closed = now < G.off;
    G.w++;
    const away = env.HOME && moved(req, u, env);
    if (away) return away;
    try {
      const m = /^\/room\/([a-z0-9]{4,10})$/.exec(u.pathname);
      if (m) {
        if (closed) return new Response("closed", { status: 503 });
        G.d += 3;  // (the connection, and its messages: twenty of them count as a request)
        return await env.ROOMS.get(env.ROOMS.idFromName(m[1])).fetch(req);
      }
      if (env.STATS && u.pathname === "/stat/hit" && req.method === "POST") {
        if (closed) return new Response(null, { status: 410 });  // (the page stops telling)
        const ua = req.headers.get("User-Agent") || "", ip = req.headers.get("CF-Connecting-IP") || "";
        if (Math.floor(now / 60e3) !== G.min) { G.min = Math.floor(now / 60e3); G.ips.clear(); }
        const sent = (G.ips.get(ip) || 0) + 1;
        G.ips.set(ip, sent);
        const own = (req.headers.get("Origin") || u.origin) === u.origin;
        if (own && sent <= PER_MIN && G.hits.length < MOST_HITS && +(req.headers.get("Content-Length") || 0) < 4000 && !/bot|crawl|spider|headless|preview/i.test(ua)) {
          const msg = await req.json().catch(() => null);
          if (msg && typeof msg === "object") G.hits.push({ ip, ua: ua.slice(0, 300), cc: (req.cf && req.cf.country) || "", m: msg });
        }
        return new Response(null, { status: 204 });
      }
      if (env.STATS && u.pathname === "/stat/get" && req.method === "GET") {
        // stats page may need a key
        if (env.STATS_KEY && u.searchParams.get("k") !== env.STATS_KEY) return new Response("no", { status: 403 });
        if (!G.got || now - G.got.at > 30e3) {
          const all = await (await env.STATS.get(env.STATS.idFromName("site")).fetch("https://stats/get")).json();
          G.got = { at: now, own: JSON.stringify(all), body: JSON.stringify({ ...all, spent: undefined }) };
        }
        // usage for the owner only
        return new Response(env.OWNER_KEY && u.searchParams.get("k") === env.OWNER_KEY ? G.got.own : G.got.body, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
      }
      return env.ASSETS ? await env.ASSETS.fetch(req) : new Response("not found", { status: 404 });
    } finally {
      // the first hit after a quiet while goes at once
      if (env.STATS && !closed && (G.hits.length || G.w > 50) && (now - G.at >= FLUSH || G.hits.length >= MOST_HITS)) ctx.waitUntil(flush(env));
    }
  },
};
