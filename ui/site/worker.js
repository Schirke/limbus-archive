// The site's own small server (Cloudflare Worker): everything is still served as files, and /room/<code> is a room of
// the Games' live matches — a Durable Object that keeps its players' WebSockets and passes their messages on.
// The room knows nothing of the games: it holds who is in, who the host is, and one "state" the host sets (the game,
// the mode, the seed…). Every message goes to everybody in the order the room got it, with the room's clock on it —
// so "who answered first" is the same on every screen.
//   client → room: {t: "set", state} (the host only) · {t: "msg", data} · {t: "ping"}
//   room → client: {t: "room", you, host, players: [{id, name}], state, now} · {t: "msg", from, data, now} · {t: "full"}
// /stat/hit and /stat/get are the site's own count of its visitors (the Site stats page, ui/site/site.js): daily sums
// only — a visitor is a browser on a day, told apart by a hash that is salted anew each day and dropped the next.
import { DurableObject } from "cloudflare:workers";

const MOST = 8;

export class Room extends DurableObject {
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

// The count. c: a day's sums by key — "v" visitors, "p" pages opened, "pg:<page>", "cc:<country>", "dv:<device>",
// "u:<Identity or E.G.O>"; s: who was here today (the day's hash, when last, on which page) — for "a visitor once a
// day" and "on the site now".
const DAY = 86400e3, NOW = 5 * 60e3;
const dayOf = (t) => new Date(t).toISOString().slice(0, 10);

export class Stats extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS c (day TEXT, k TEXT, n INTEGER, PRIMARY KEY (day, k))");
    this.sql.exec("CREATE TABLE IF NOT EXISTS s (h TEXT PRIMARY KEY, day TEXT, at INTEGER, p TEXT)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS salt (day TEXT PRIMARY KEY, v TEXT)");
  }

  bump(day, k) { this.sql.exec("INSERT INTO c VALUES (?, ?, 1) ON CONFLICT (day, k) DO UPDATE SET n = n + 1", day, k); }

  async hit(req) {
    const ua = req.headers.get("User-Agent") || "", m = await req.json().catch(() => null);
    if (!m || /bot|crawl|spider|headless|preview/i.test(ua)) return;
    const now = Date.now(), day = dayOf(now), page = String(m.p || "").slice(0, 24).replace(/[^a-z0-9]/gi, "") || "patches";
    let salt = this.sql.exec("SELECT v FROM salt WHERE day = ?", day).toArray()[0];
    if (!salt) {  // a new day: yesterday's visitors are forgotten, and the sums older than a quarter
      salt = { v: crypto.randomUUID() };
      this.sql.exec("DELETE FROM salt");
      this.sql.exec("INSERT INTO salt VALUES (?, ?)", day, salt.v);
      this.sql.exec("DELETE FROM s WHERE day < ?", day);
      this.sql.exec("DELETE FROM c WHERE day < ?", dayOf(now - 92 * DAY));
    }
    const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(salt.v + (req.headers.get("CF-Connecting-IP") || "") + ua));
    const h = [...new Uint8Array(raw).slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
    if (!this.sql.exec("SELECT 1 FROM s WHERE h = ?", h).toArray().length) {
      this.bump(day, "v");
      this.bump(day, "cc:" + ((req.headers.get("x-cc") || "").replace(/[^A-Z]/g, "").slice(0, 2) || "??"));
      this.bump(day, "dv:" + (/iPad|Tablet|Android(?!.*Mobi)/i.test(ua) ? "Tablet" : /Mobi|iPhone/i.test(ua) ? "Phone" : "Desktop"));
    }
    this.sql.exec("INSERT INTO s VALUES (?, ?, ?, ?) ON CONFLICT (h) DO UPDATE SET at = excluded.at, p = excluded.p", h, day, now, page);
    if (m.beat) return;  // (a page left open: still here, nothing new opened)
    this.bump(day, "p");
    this.bump(day, "pg:" + page);
    if (/^\d{5}$/.test(m.u || "")) this.bump(day, "u:" + m.u);
  }

  get() {
    const now = Date.now(), sum = (days) => {
      const o = {};
      for (const r of this.sql.exec("SELECT k, SUM(n) AS n FROM c WHERE day >= ? GROUP BY k", dayOf(now - (days - 1) * DAY))) o[r.k] = r.n;
      return o;
    };
    const by = Object.fromEntries(this.sql.exec("SELECT day, n FROM c WHERE k = 'v' AND day >= ?", dayOf(now - 13 * DAY)).toArray().map((r) => [r.day, r.n]));
    return {
      now, today: dayOf(now), sets: { day: sum(1), prev: sum(2), week: sum(7), month: sum(30) },
      days: Array.from({ length: 14 }, (_, i) => dayOf(now - (13 - i) * DAY)).map((d) => [d, by[d] || 0]),
      online: this.sql.exec("SELECT p FROM s WHERE at > ?", now - NOW).toArray().map((r) => r.p),
    };
  }

  async fetch(req) {
    if (req.method === "POST") { await this.hit(req); return new Response(null, { status: 204 }); }
    return new Response(JSON.stringify(this.get()), { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
  }
}

export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    const m = /^\/room\/([a-z0-9]{4,10})$/.exec(u.pathname);
    if (m) return env.ROOMS.get(env.ROOMS.idFromName(m[1])).fetch(req);
    if (env.STATS && (u.pathname === "/stat/hit" && req.method === "POST" || u.pathname === "/stat/get" && req.method === "GET")) {
      // (the page can be the owner's alone: a key in the site's settings, see limbusdm/site.py worker_config)
      if (u.pathname === "/stat/get" && env.STATS_KEY && u.searchParams.get("k") !== env.STATS_KEY) return new Response("no", { status: 403 });
      const h = new Headers(req.headers);
      h.set("x-cc", (req.cf && req.cf.country) || "");
      return env.STATS.get(env.STATS.idFromName("site")).fetch(new Request(req, { headers: h }));
    }
    return env.ASSETS ? env.ASSETS.fetch(req) : new Response("not found", { status: 404 });
  },
};
