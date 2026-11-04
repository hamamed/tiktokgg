/**
 * TikTokGameListener — drop-in WebSocket client for browser / Electron / Node (18+) games.
 *
 *   import { TikTokGameListener } from './GameListener.js';
 *
 *   const listener = new TikTokGameListener({
 *     url: 'ws://localhost:8080/ws',
 *     name: 'Train Runner (Web)',
 *     token: '',                          // if the server sets WS_TOKEN
 *   });
 *   listener.on('spawn_train', ({ count, params, source }) => { ... });  // handler per action
 *   listener.onSettings((s) => game.speed = base * s.speedMultiplier);
 *   listener.connect();
 *
 * The action names you register are announced in `hello`, so they show up in the dashboard's
 * action picker automatically.
 */
export class TikTokGameListener {
  #ws = null;
  #handlers = new Map(); // action -> Set<fn>
  #anyHandlers = new Set();
  #settingsHandlers = new Set();
  #statusHandlers = new Set();
  #retry = 0;
  #timer = null;
  #closed = false;
  #seen = new Set(); // actionId de-dupe (protects against re-sends after reconnect)

  settings = {};
  status = 'idle';

  constructor({ url = 'ws://localhost:8080/ws', name = 'Web Game', token = '', meta = {}, autoAck = true, WebSocketImpl } = {}) {
    this.url = token ? `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}` : url;
    this.name = name;
    this.meta = meta;
    this.autoAck = autoAck;
    this.WS = WebSocketImpl ?? globalThis.WebSocket;
    if (!this.WS) throw new Error('No WebSocket implementation: pass { WebSocketImpl: require("ws") } in Node < 22');
  }

  /** Register a handler for one action name. Returns an unsubscribe function. */
  on(action, fn) {
    if (!this.#handlers.has(action)) this.#handlers.set(action, new Set());
    this.#handlers.get(action).add(fn);
    if (this.status === 'open') this.#hello(); // re-announce new action list
    return () => this.#handlers.get(action)?.delete(fn);
  }
  /** Handler for every action (logging, generic effects, unknown actions). */
  onAny(fn) { this.#anyHandlers.add(fn); return () => this.#anyHandlers.delete(fn); }
  onSettings(fn) { this.#settingsHandlers.add(fn); if (Object.keys(this.settings).length) fn(this.settings); return () => this.#settingsHandlers.delete(fn); }
  onStatus(fn) { this.#statusHandlers.add(fn); return () => this.#statusHandlers.delete(fn); }

  connect() {
    this.#closed = false;
    this.#open();
    return this;
  }

  disconnect() {
    this.#closed = true;
    clearTimeout(this.#timer);
    this.#ws?.close();
  }

  /** Report arbitrary game state (score, lives, level) to the dashboard. */
  sendState(state) {
    this.#send('game.state', state);
  }

  ack(actionId, status = 'ok', message) {
    this.#send('game.ack', { actionId, status, ...(message ? { message } : {}) });
  }

  // ---------------------------------------------------------------------------
  #setStatus(s) {
    this.status = s;
    for (const fn of this.#statusHandlers) fn(s);
  }

  #open() {
    this.#setStatus('connecting');
    const ws = new this.WS(this.url);
    this.#ws = ws;

    ws.onopen = () => {
      this.#retry = 0;
      this.#setStatus('open');
      this.#hello();
    };
    ws.onmessage = (ev) => this.#onFrame(typeof ev.data === 'string' ? ev.data : ev.data.toString());
    ws.onclose = (ev) => {
      this.#setStatus('closed');
      if (this.#closed || ev.code === 4401) return; // don't hammer the server with a bad token
      const delay = Math.min(10_000, 500 * 2 ** this.#retry++);
      this.#timer = setTimeout(() => this.#open(), delay);
    };
    ws.onerror = () => { /* onclose handles reconnect */ };
  }

  #hello() {
    this.#send('hello', { role: 'game', name: this.name, actions: [...this.#handlers.keys()], meta: this.meta });
  }

  #send(type, payload) {
    if (this.#ws?.readyState !== 1) return false;
    const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    this.#ws.send(JSON.stringify({ v: 1, type, id, ts: Date.now(), payload }));
    return true;
  }

  #onFrame(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.v !== 1) console.warn('[TikTokGameListener] protocol version mismatch', msg.v);

    switch (msg.type) {
      case 'game.settings':
        this.settings = msg.payload;
        for (const fn of this.#settingsHandlers) fn(this.settings);
        break;

      case 'game.action': {
        const a = msg.payload;
        if (this.#seen.has(a.actionId)) return;
        this.#seen.add(a.actionId);
        if (this.#seen.size > 500) this.#seen.delete(this.#seen.values().next().value);

        if (a.settings) this.settings = a.settings;
        const handlers = this.#handlers.get(a.action);
        let status = handlers?.size ? 'ok' : 'ignored';
        let message;
        try {
          handlers?.forEach((fn) => fn(a));
          this.#anyHandlers.forEach((fn) => fn(a));
        } catch (err) {
          status = 'error';
          message = String(err?.message ?? err);
          console.error(`[TikTokGameListener] handler for "${a.action}" threw`, err);
        }
        if (this.autoAck) this.ack(a.actionId, status, message);
        break;
      }

      case 'error':
        console.warn('[TikTokGameListener] server error:', msg.payload?.error);
        break;
      default:
        break; // welcome, ack…
    }
  }
}
