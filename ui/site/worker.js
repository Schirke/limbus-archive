// The site's own small server (Cloudflare Worker): everything is still served as files, and /room/<code> is a room of
// the Games' live matches — a Durable Object that keeps its players' WebSockets and passes their messages on.
// The room knows nothing of the games: it holds who is in, who the host is, and one "state" the host sets (the game,
// the mode, the seed…). Every message goes to everybody in the order the room got it, with the room's clock on it —
// so "who answered first" is the same on every screen.
//   client → room: {t: "set", state} (the host only) · {t: "msg", data} · {t: "ping"}
//   room → client: {t: "room", you, host, players: [{id, name}], state, now} · {t: "msg", from, data, now} · {t: "full"}
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

export default {
  async fetch(req, env) {
    const m = /^\/room\/([a-z0-9]{4,10})$/.exec(new URL(req.url).pathname);
    if (m) return env.ROOMS.get(env.ROOMS.idFromName(m[1])).fetch(req);
    return env.ASSETS ? env.ASSETS.fetch(req) : new Response("not found", { status: 404 });
  },
};
