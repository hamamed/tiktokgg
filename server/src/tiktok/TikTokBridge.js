import { EventEmitter } from 'node:events';
import { normalizeChat, normalizeGift, normalizeGiftList, normalizeLike, normalizeSimple } from './normalize.js';

/** Connector event name -> normalizer. Event names are identical in connector v1 and v2. */
const EVENT_MAP = {
  gift: normalizeGift,
  chat: normalizeChat,
  like: normalizeLike,
  follow: normalizeSimple('follow'),
  share: normalizeSimple('share'),
  member: normalizeSimple('member'),
  subscribe: normalizeSimple('subscribe'), // v1
  superFan: normalizeSimple('subscribe'), // v2 equivalent
};

/**
 * Loads whichever connector is installed and exposes a constructor + flavour.
 * v2: `TikTokLiveConnection`   v1/legacy/forks: `WebcastPushConnection`
 */
async function loadConnector(pkg) {
  const mod = await import(pkg);
  const lib = { ...(mod.default ?? {}), ...mod };
  if (lib.TikTokLiveConnection) return { Ctor: lib.TikTokLiveConnection, flavour: 'v2' };
  if (lib.WebcastPushConnection) return { Ctor: lib.WebcastPushConnection, flavour: 'v1' };
  throw new Error(`Package "${pkg}" exports neither TikTokLiveConnection nor WebcastPushConnection`);
}

/**
 * Owns the single TikTok LIVE connection.
 * Emits:
 *   'event'  (normalizedEvent)
 *   'status' (statusObject)
 *   'gifts'  (giftList)   — room gift catalogue after connect
 */
export class TikTokBridge extends EventEmitter {
  #conn = null;
  #manualClose = false;
  #reconnectTimer = null;
  #attempt = 0;
  #connector = null;

  constructor({ connectorPkg, signApiKey, reconnect, log }) {
    super();
    this.opts = { connectorPkg, signApiKey, reconnect };
    this.log = log;
    this.status = { state: 'disconnected', username: null, roomId: null, viewerCount: null, error: null, flavour: null };
  }

  #setStatus(patch) {
    this.status = { ...this.status, ...patch };
    this.emit('status', this.status);
  }

  async connect(rawUsername) {
    const username = String(rawUsername ?? '').trim().replace(/^@/, '');
    if (!/^[\w.]{2,50}$/.test(username)) throw new Error('Enter a valid TikTok username (without @)');

    await this.disconnect({ silent: true });
    this.#manualClose = false;
    this.#attempt = 0;
    return this.#open(username);
  }

  async #open(username) {
    clearTimeout(this.#reconnectTimer);
    this.#setStatus({ state: 'connecting', username, error: null });

    try {
      this.#connector ??= await loadConnector(this.opts.connectorPkg);
    } catch (err) {
      const msg = `Cannot load "${this.opts.connectorPkg}": ${err.message}. Run "npm install" in /server.`;
      this.#setStatus({ state: 'error', error: msg });
      throw new Error(msg);
    }

    const { Ctor, flavour } = this.#connector;
    const conn = new Ctor(username, {
      processInitialData: false, // never replay historic gifts/chats as fresh triggers
      enableExtendedGiftInfo: true,
      ...(this.opts.signApiKey ? { signApiKey: this.opts.signApiKey } : {}),
    });
    this.#conn = conn;
    this.#wire(conn);

    try {
      const state = await conn.connect();
      if (this.#conn !== conn) return this.status; // superseded by a newer connect()
      this.#attempt = 0;
      this.#setStatus({ state: 'connected', roomId: String(state?.roomId ?? conn.roomId ?? '') || null, flavour, error: null });
      this.log.info(`Connected to @${username} (room ${this.status.roomId}, connector ${flavour})`);
      this.#loadGiftCatalog(conn, state);
      return this.status;
    } catch (err) {
      if (this.#conn === conn) this.#conn = null;
      const msg = err?.message || String(err);
      this.log.warn(`Connect to @${username} failed: ${msg}`);
      this.#setStatus({ state: 'error', error: msg });
      throw new Error(msg);
    }
  }

  #wire(conn) {
    const live = () => this.#conn === conn; // ignore events from a stale connection

    for (const [name, normalize] of Object.entries(EVENT_MAP)) {
      conn.on(name, (data) => {
        if (!live()) return;
        try {
          this.emit('event', { ...normalize(data), ts: Date.now() });
        } catch (err) {
          this.log.warn(`Failed to normalize "${name}" event: ${err.message}`);
        }
      });
    }

    conn.on('roomUser', (d) => {
      if (!live()) return;
      const viewerCount = Number(d?.viewerCount ?? d?.total ?? d?.totalUser);
      if (Number.isFinite(viewerCount)) this.#setStatus({ viewerCount });
    });

    conn.on('streamEnd', () => {
      if (!live()) return;
      this.log.info('Stream ended by host');
      this.#manualClose = true; // do not auto-reconnect to an ended stream
      this.#conn = null;
      this.#setStatus({ state: 'ended', viewerCount: null });
    });

    conn.on('disconnected', () => {
      if (!live()) return;
      this.#conn = null;
      if (this.#manualClose) return;
      this.#scheduleReconnect();
    });

    conn.on('error', (err) => {
      if (!live()) return;
      this.log.warn(`Connector error: ${err?.info || err?.message || err}`);
    });
  }

  #scheduleReconnect() {
    const { maxAttempts, baseDelayMs, maxDelayMs } = this.opts.reconnect;
    if (this.#attempt >= maxAttempts) {
      this.#setStatus({ state: 'error', error: `Lost connection — gave up after ${maxAttempts} attempts` });
      return;
    }
    const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** this.#attempt++);
    this.log.warn(`Disconnected unexpectedly — reconnecting in ${Math.round(delay / 1000)}s (attempt ${this.#attempt}/${maxAttempts})`);
    this.#setStatus({ state: 'reconnecting', error: null });
    const username = this.status.username;
    this.#reconnectTimer = setTimeout(() => this.#open(username).catch(() => this.#scheduleReconnect()), delay);
  }

  async #loadGiftCatalog(conn, state) {
    try {
      let raw = state?.availableGifts ?? conn.availableGifts;
      if (!raw?.length) {
        if (typeof conn.fetchAvailableGifts === 'function') raw = await conn.fetchAvailableGifts();
        else if (typeof conn.getAvailableGifts === 'function') raw = await conn.getAvailableGifts();
      }
      const gifts = normalizeGiftList(raw);
      if (gifts.length) this.emit('gifts', gifts);
    } catch (err) {
      this.log.debug(`Gift catalogue unavailable: ${err.message}`);
    }
  }

  async disconnect({ silent = false } = {}) {
    this.#manualClose = true;
    clearTimeout(this.#reconnectTimer);
    const conn = this.#conn;
    this.#conn = null;
    if (conn) {
      try { await conn.disconnect(); } catch { /* already closed */ }
    }
    if (!silent || this.status.state !== 'disconnected') {
      this.#setStatus({ state: 'disconnected', roomId: null, viewerCount: null, error: null });
    }
  }
}
