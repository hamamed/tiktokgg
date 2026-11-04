import { EventEmitter } from 'node:events';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { envelope, MSG, parseMessage, PROTOCOL_VERSION, Roles } from '../protocol/messages.js';

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * WebSocket hub: tracks clients by role (dashboard | game) and routes frames.
 * Emits:
 *   'message' (client, msg)  — any frame after a successful hello
 *   'hello'   (client)       — a client identified itself
 *   'clients' (summary[])    — the connected client list changed
 */
export class Hub extends EventEmitter {
  #clients = new Map();

  constructor({ server, path, token, log }) {
    super();
    this.log = log;
    this.token = token;
    this.wss = new WebSocketServer({ server, path, maxPayload: 256 * 1024 });
    this.wss.on('connection', (ws, req) => this.#onConnection(ws, req));

    // Heartbeat: drop clients that stop answering pings (e.g. a crashed Unity editor).
    this.heartbeat = setInterval(() => {
      for (const c of this.#clients.values()) {
        if (!c.alive) { c.ws.terminate(); continue; }
        c.alive = false;
        try { c.ws.ping(); } catch { /* ignore */ }
      }
    }, 15_000).unref();
  }

  #onConnection(ws, req) {
    const url = new URL(req.url, 'http://localhost');
    if (this.token && !safeEqual(url.searchParams.get('token') ?? '', this.token)) {
      ws.close(4401, 'Unauthorized');
      return;
    }

    const client = {
      id: randomUUID(),
      ws,
      role: null,
      name: 'unknown',
      actions: [],
      meta: {},
      ip: req.socket.remoteAddress,
      connectedAt: Date.now(),
      alive: true,
    };
    this.#clients.set(client.id, client);
    ws.on('pong', () => (client.alive = true));

    // Clients must say hello within 10s.
    const helloTimer = setTimeout(() => !client.role && ws.close(4408, 'hello timeout'), 10_000);

    ws.on('message', (raw) => {
      client.alive = true;
      const parsed = parseMessage(raw);
      if (!parsed.ok) return this.send(client, MSG.ERROR, { error: parsed.error });
      const { msg } = parsed;

      if (msg.type === MSG.HELLO) {
        clearTimeout(helloTimer);
        return this.#onHello(client, msg);
      }
      if (!client.role) return this.send(client, MSG.ERROR, { error: 'Send "hello" first' }, msg.id);
      this.emit('message', client, msg);
    });

    ws.on('close', () => {
      clearTimeout(helloTimer);
      this.#clients.delete(client.id);
      if (client.role) {
        this.log.info(`${client.role} "${client.name}" disconnected`);
        this.emit('clients', this.listClients());
      }
    });
    ws.on('error', (err) => this.log.debug(`socket error: ${err.message}`));
  }

  #onHello(client, msg) {
    const { role, name, actions, meta } = msg.payload;
    if (!Object.values(Roles).includes(role)) {
      return this.send(client, MSG.ERROR, { error: `role must be "${Roles.DASHBOARD}" or "${Roles.GAME}"` }, msg.id);
    }
    client.role = role;
    client.name = String(name || role).slice(0, 60);
    client.actions = Array.isArray(actions) ? actions.filter((a) => typeof a === 'string').slice(0, 200) : [];
    client.meta = meta && typeof meta === 'object' ? meta : {};
    this.send(client, MSG.WELCOME, { clientId: client.id, role, protocol: PROTOCOL_VERSION }, msg.id);
    this.log.info(`${role} "${client.name}" connected from ${client.ip}`);
    this.emit('hello', client);
    this.emit('clients', this.listClients());
  }

  send(client, type, payload, replyTo) {
    if (client.ws.readyState !== WebSocket.OPEN) return false;
    client.ws.send(JSON.stringify(envelope(type, payload, replyTo ? { replyTo } : {})));
    return true;
  }

  /** Broadcast to every client with `role`. Serializes once. Returns delivery count. */
  broadcast(role, type, payload) {
    const frame = JSON.stringify(envelope(type, payload));
    let n = 0;
    for (const c of this.#clients.values()) {
      if (c.role === role && c.ws.readyState === WebSocket.OPEN) {
        c.ws.send(frame);
        n++;
      }
    }
    return n;
  }

  toDashboards(type, payload) {
    return this.broadcast(Roles.DASHBOARD, type, payload);
  }
  toGames(type, payload) {
    return this.broadcast(Roles.GAME, type, payload);
  }

  listClients() {
    return [...this.#clients.values()]
      .filter((c) => c.role)
      .map(({ id, role, name, actions, meta, ip, connectedAt }) => ({ id, role, name, actions, meta, ip, connectedAt }));
  }

  gameActions() {
    const set = new Set();
    for (const c of this.#clients.values()) if (c.role === Roles.GAME) c.actions.forEach((a) => set.add(a));
    return [...set];
  }

  close() {
    clearInterval(this.heartbeat);
    for (const c of this.#clients.values()) c.ws.close(1001, 'server shutting down');
    this.wss.close();
  }
}
