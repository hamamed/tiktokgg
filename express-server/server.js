/**
 * server.js — TikTok LIVE → game trigger router
 * ============================================================================
 *
 *   TikTok LIVE ──► tiktok-live-connector ──► normalizeGift() ──► streak gate ──► rule lookup
 *                                                                                    │
 *   Dashboard  ◄────────────────── WebSocket (ws://host:PORT/ws) ───────────────────┤ GAME_EVENT
 *   Game client◄─────────────────────────────────────────────────────────────────────┘
 *
 * Every WebSocket frame is JSON: { "type": "<MESSAGE_TYPE>", "payload": { ... } }
 *
 * Client → server
 *   CONNECT_TIKTOK     { username }                     start, or restart on a new username
 *   DISCONNECT_TIKTOK  {}
 *   UPDATE_RULES       { rules, mode?: "replace"|"merge" }
 *   TEST_TRIGGER       { action, value?, user? }        fire an action directly
 *                      { giftName, repeatCount?, user? } or simulate a gift through the rules
 *   GET_STATE          {}
 *   FETCH_GIFTS        { username? }                    load TikTok's gift list (names, diamonds, images)
 *   UPDATE_COMMANDS    { commands: { "!left": { action, value, cooldown, userCooldown } } }
 *   UPDATE_GOALS       { goals: [{ every, action, value, label }] }      like goals
 *   SET_PAUSED         { paused }                       SET_AUTO_CONNECT { enabled, username }
 *   SAVE_PRESET / LOAD_PRESET / DELETE_PRESET { name }
 *   TEST_CHAT          { comment, user? }               TEST_LIKES { count, user? }
 *   GET_REPORTS {}  ·  GET_REPORT { id | "current" }   GAME_STATS { distance }  (sent by the game on crash)
 *
 * Server → client
 *   STATE        full snapshot (sent on connect and for GET_STATE)
 *   STATUS       { status: CONNECTED|DISCONNECTED|ERROR, username, roomId, error, reconnecting, attempt }
 *   GAME_EVENT   { user, giftName, diamondCount, action, value, ... }   only gifts that matched a rule
 *   GIFT_RECEIVED{ user, giftName, diamondCount, repeatCount, totalDiamonds, action|null, ... } every finished gift
 *   VIEWERS_UPDATE { viewerCount }
 *   GIFTS        { gifts: [{ id, name, diamonds, image }] }   gift catalogue (images served at /gift-img/…)
 *   COMMANDS_UPDATED { commands } · GOALS_UPDATED { goals } · PAUSED { paused } · PRESETS { presets }
 *   SUPPORTERS   { top: [{ uniqueId, nickname, avatar, diamonds, gifts }] }   top 3 gifters this stream
 *   SESSION      { summary of the current stream }      REPORTS { reports }   (CSV: /api/reports/<id>.csv)
 *   RULES_UPDATED{ rules }
 *   LIKES_UPDATE { totalLikes, streamTotalLikes, lastUser, lastCount }
 *   ACK / ERROR  reply to a client message (carries `requestId` if the client sent `id`)
 *
 * WebSocket endpoint: ws://host:PORT  (also accepted on ws://host:PORT/ws)
 *
 * Run:  npm install && npm start      (env vars documented in CONFIG below)
 */

'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');

// ============================================================================
// 1. CONFIG — everything tunable via environment variables
// ============================================================================
const CONFIG = Object.freeze({
  port: Number(process.env.PORT) || 8080,
  host: process.env.HOST || '0.0.0.0',
  wsPaths: ['/', '/ws'], // the dashboard connects to ws://localhost:8080 (either path works)
  // Optional shared secret: clients connect with ws://host:8080/ws?token=XYZ
  wsToken: process.env.WS_TOKEN || '',
  // Folder with the control panel (web-dashboard/index.html), served at "/". Missing folder = API only.
  dashboardDir: path.resolve(process.env.DASHBOARD_DIR || path.join(__dirname, '..', 'web-dashboard')),
  // Writable folder for the gift catalogue (gifts.json + gift-images/). On the VPS: /var/lib/tiktokgg
  dataDir: path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data')),
  giftImgAllowLocal: process.env.GIFT_IMG_ALLOW_LOCAL === '1', // tests only: allow image downloads from localhost
  // Optional browser Origin allowlist, e.g. "https://tiktokgg.koydam.com,http://localhost:5500".
  // Stops random websites a streamer visits from talking to their local server. Empty = allow all.
  allowedOrigins: (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  // Euler Stream sign key (recommended by tiktok-live-connector v2 to avoid rate limits)
  signApiKey: process.env.TIKTOK_SIGN_API_KEY || undefined,
  reconnect: {
    maxAttempts: Number(process.env.RECONNECT_MAX_ATTEMPTS) || 5,
    baseDelayMs: 2_000, // 2s, 4s, 8s, 16s, 32s …
    maxDelayMs: 60_000,
  },
  // If TikTok never delivers the final repeatEnd event of a streak (packet loss, viewer left),
  // fire the trigger anyway after this long so viewers still get their payout. 0 disables.
  streakTimeoutMs: Number(process.env.STREAK_TIMEOUT_MS ?? 30_000),
  likeBroadcastIntervalMs: 1_000, // likes arrive in bursts; throttle LIKES_UPDATE
  heartbeatMs: 15_000,
  maxPayloadBytes: 64 * 1024,
});

// ============================================================================
// 2. LOGGER — tiny structured logger (swap for pino/winston in larger deployments)
// ============================================================================
const log = {
  info: (msg, meta) => console.log(`${new Date().toISOString()} INFO  ${msg}`, meta ?? ''),
  warn: (msg, meta) => console.warn(`${new Date().toISOString()} WARN  ${msg}`, meta ?? ''),
  error: (msg, meta) => console.error(`${new Date().toISOString()} ERROR ${msg}`, meta ?? ''),
};

// ============================================================================
// 3. MESSAGE TYPES — single source of truth for the wire protocol
// ============================================================================
const MSG = Object.freeze({
  // inbound
  CONNECT_TIKTOK: 'CONNECT_TIKTOK',
  DISCONNECT_TIKTOK: 'DISCONNECT_TIKTOK',
  UPDATE_RULES: 'UPDATE_RULES',
  TEST_TRIGGER: 'TEST_TRIGGER',
  GET_STATE: 'GET_STATE',
  FETCH_GIFTS: 'FETCH_GIFTS',
  UPDATE_COMMANDS: 'UPDATE_COMMANDS',
  UPDATE_GOALS: 'UPDATE_GOALS',
  SET_PAUSED: 'SET_PAUSED',
  SET_AUTO_CONNECT: 'SET_AUTO_CONNECT',
  SAVE_PRESET: 'SAVE_PRESET',
  LOAD_PRESET: 'LOAD_PRESET',
  DELETE_PRESET: 'DELETE_PRESET',
  TEST_CHAT: 'TEST_CHAT',
  TEST_LIKES: 'TEST_LIKES',
  GET_REPORTS: 'GET_REPORTS',
  GET_REPORT: 'GET_REPORT',
  GAME_STATS: 'GAME_STATS',
  // outbound
  STATE: 'STATE',
  STATUS: 'STATUS',
  GAME_EVENT: 'GAME_EVENT',
  GIFT_RECEIVED: 'GIFT_RECEIVED',
  VIEWERS_UPDATE: 'VIEWERS_UPDATE',
  GIFTS: 'GIFTS',
  COMMANDS_UPDATED: 'COMMANDS_UPDATED',
  GOALS_UPDATED: 'GOALS_UPDATED',
  PAUSED: 'PAUSED',
  PRESETS: 'PRESETS',
  SUPPORTERS: 'SUPPORTERS',
  SESSION: 'SESSION',
  REPORTS: 'REPORTS',
  RULES_UPDATED: 'RULES_UPDATED',
  LIKES_UPDATE: 'LIKES_UPDATE',
  ACK: 'ACK',
  ERROR: 'ERROR',
});

const STATUS = Object.freeze({ CONNECTED: 'CONNECTED', DISCONNECTED: 'DISCONNECTED', ERROR: 'ERROR' });

// ============================================================================
// 4. RULE STORE — dynamic gift → action mapping (kept in memory, saved to DATA_DIR/rules.json)
//    Shape: { "Rose": { "action": "SPAWN_OBSTACLE", "value": 1 }, "*": {...fallback} }
//    Lookups are case-insensitive. "*" (optional) matches any gift without its own rule.
// ============================================================================
const RuleStore = (() => {
  let rules = {}; // loaded from DATA_DIR/rules.json at boot; the dashboard sends UPDATE_RULES
  const FILE = path.join(CONFIG.dataDir, 'rules.json');
  let index = new Map(); // lowercase name -> { name, action, value }

  const ACTION_RE = /^[A-Za-z0-9_.:-]{1,64}$/;

  /** Validate + normalize an incoming rules object. Throws on bad input (nothing is applied). */
  function validate(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new Error('rules must be an object like {"Rose": {"action": "SPAWN_OBSTACLE", "value": 1}}');
    }
    const out = {};
    for (const [giftName, rule] of Object.entries(input)) {
      const name = String(giftName).trim();
      if (!name || name.length > 100) throw new Error(`Invalid gift name "${giftName}"`);
      if (rule === null) { out[name] = null; continue; } // null = delete (merge mode)
      if (!rule || typeof rule !== 'object') throw new Error(`Rule for "${name}" must be an object`);
      const action = String(rule.action ?? '').trim();
      if (!ACTION_RE.test(action)) throw new Error(`Rule "${name}": action must match ${ACTION_RE}`);
      const value = rule.value === undefined ? 1 : Number(rule.value);
      if (!Number.isFinite(value)) throw new Error(`Rule "${name}": value must be a number`);
      out[name] = { action, value };
    }
    return out;
  }

  function save() {
    try {
      fs.mkdirSync(CONFIG.dataDir, { recursive: true });
      const tmp = `${FILE}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(rules, null, 2));
      fs.renameSync(tmp, FILE);
    } catch (err) {
      log.warn(`Could not save rules: ${err.message}`);
    }
  }

  function rebuildIndex() {
    index = new Map(Object.entries(rules).map(([name, r]) => [name.toLowerCase(), { name, ...r }]));
  }

  return {
    /** mode "replace" swaps the whole mapping; "merge" upserts keys (null value deletes a key). */
    update(input, mode = 'replace') {
      const valid = validate(input);
      const next = mode === 'merge' ? { ...rules } : {};
      for (const [name, rule] of Object.entries(valid)) {
        if (rule === null) delete next[name];
        else next[name] = rule;
      }
      rules = next;
      rebuildIndex();
      save();
      return rules;
    },
    /** Restore the last saved rules so a restart or update never wipes the setup. */
    load() {
      try {
        rules = validate(JSON.parse(fs.readFileSync(FILE, 'utf8')));
        for (const k of Object.keys(rules)) if (rules[k] === null) delete rules[k];
        rebuildIndex();
        log.info(`Rules loaded from ${FILE}: ${Object.keys(rules).join(', ') || '(none)'}`);
      } catch (err) {
        if (err.code !== 'ENOENT') log.warn(`Could not load ${FILE}: ${err.message}`);
      }
    },
    match(giftName) {
      return index.get(String(giftName).toLowerCase()) ?? index.get('*') ?? null;
    },
    all: () => rules,
  };
})();

// ============================================================================
// 5. NORMALIZATION — one stable gift shape for connector v1 (flattened) and v2 (protobuf)
//    v2 nests data under data.gift / data.user and sends repeatEnd as 0/1 (a NUMBER), so a strict
//    `data.repeatEnd === true` check would never fire on v2. We coerce it to a real boolean here.
// ============================================================================
const first = (...v) => v.find((x) => x !== undefined && x !== null && x !== '');
const imageUrl = (img) => first(img?.urlList?.[0], img?.url_list?.[0], img?.url?.[0]);

function normalizeUser(d = {}) {
  const u = d.user ?? {};
  const uniqueId = String(first(u.uniqueId, d.uniqueId, u.displayId, 'unknown'));
  return {
    userId: String(first(u.userId, d.userId, u.id, uniqueId)),
    uniqueId,
    nickname: String(first(u.nickname, d.nickname, uniqueId)),
    profilePictureUrl: first(d.profilePictureUrl, imageUrl(u.avatarThumb), imageUrl(u.profilePicture)) ?? null,
  };
}

function normalizeGift(d = {}) {
  const g = d.gift ?? {};
  const det = d.giftDetails ?? {};
  const ext = d.extendedGiftInfo ?? {};
  const giftId = String(first(d.giftId, g.id, ext.id, '0'));
  const giftType = Number(first(d.giftType, g.type, det.giftType, ext.type, 0));
  return {
    user: normalizeUser(d),
    giftId,
    giftName: String(first(d.giftName, g.name, det.giftName, ext.name, `Gift#${giftId}`)),
    diamondCount: Number(first(d.diamondCount, g.diamondCount, det.diamondCount, ext.diamond_count, 0)) || 0,
    giftPictureUrl: first(d.giftPictureUrl, imageUrl(g.image), det.giftImage?.giftPictureUrl) ?? null,
    // giftType 1 = "streakable" (combo) gift: arrives as many events, the last one has repeatEnd.
    streakable: giftType === 1 || g.combo === true,
    repeatCount: Math.max(1, Number(first(d.repeatCount, 1)) || 1),
    repeatEnd: d.repeatEnd === true || Number(d.repeatEnd) === 1,
    groupId: String(first(d.groupId, '')),
  };
}

// ============================================================================
// 5b. GIFT CATALOGUE — real TikTok gift names, diamond prices and images
//
//   • Saved to DATA_DIR/gifts.json (same format as the koydam-tiktok panel, so its cache can be copied).
//   • Each image is downloaded ONCE from TikTok's CDN into DATA_DIR/gift-images and served from
//     /gift-img/<id>.<ext>, so dashboards and OBS never depend on TikTok's CDN during a stream.
//   • Filled from: the room's gift list on connect, every gift received, and FETCH_GIFTS.
// ============================================================================
const GiftCatalog = (() => {
  const FILE = path.join(CONFIG.dataDir, 'gifts.json');
  const IMG_DIR = path.join(CONFIG.dataDir, 'gift-images');
  const IMG_FILE_RE = /^[0-9]{1,20}\.(png|jpg|webp|gif)$/;
  // Only download from TikTok's image servers; never fetch arbitrary hosts.
  const HOST_RE = /(^|\.)(tiktokcdn(-us|-eu)?|ibyteimg|byteimg|muscdn|tiktokv|ttwstatic)\.com$/i;
  const hostOk = (u) => {
    try {
      const { hostname, protocol } = new URL(u);
      if (!/^https?:$/.test(protocol)) return false;
      return HOST_RE.test(hostname) || (CONFIG.giftImgAllowLocal && /^(127\.0\.0\.\d{1,3}|localhost)$/.test(hostname));
    } catch { return false; }
  };
  const pickUrl = (list) => {
    if (!Array.isArray(list)) return '';
    const ok = list.map(String).filter((u) => /^https?:\/\//.test(u) && !/\.heic/i.test(u));
    return ok.find((u) => /\.(png|jpe?g|webp)/i.test(u)) || ok[0] || '';
  };
  const imgUrl = (img) => (typeof img === 'string' ? img : pickUrl(img?.urlList) || pickUrl(img?.url_list) || pickUrl(img?.url) || '');
  const imageType = (b) =>
    b[0] === 0x89 && b[1] === 0x50 ? 'png'
      : b[0] === 0xff && b[1] === 0xd8 ? 'jpg'
      : b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP' ? 'webp'
      : b.slice(0, 3).toString() === 'GIF' ? 'gif' : null;

  const byId = new Map(); // id -> { id, name, diamonds, remote, local }
  const failed = new Set();
  const queue = [];
  let active = 0;
  let saveTimer = null;
  let notifyTimer = null;
  let onChange = () => {};

  const cleanId = (id) => String(id ?? '').replace(/[^0-9]/g, '').slice(0, 20);

  function load() {
    try {
      const arr = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      for (const g of Array.isArray(arr) ? arr : []) {
        const id = cleanId(g.id);
        if (!id || !g.name) continue;
        const localName = typeof g.local === 'string' ? path.basename(g.local) : '';
        const local = IMG_FILE_RE.test(localName) && fs.existsSync(path.join(IMG_DIR, localName)) ? `/gift-img/${localName}` : '';
        const e = { id, name: String(g.name).slice(0, 48), diamonds: Number(g.diamonds) || 0, remote: typeof g.remote === 'string' ? g.remote : '', local };
        byId.set(id, e);
        if (!e.local && e.remote) enqueue(e);
      }
      log.info(`Gift catalogue: ${byId.size} gifts (${[...byId.values()].filter((e) => e.local).length} images cached) from ${FILE}`);
    } catch (err) {
      if (err.code !== 'ENOENT') log.warn(`Could not read ${FILE}: ${err.message}`);
    }
  }

  function save(now = false) {
    clearTimeout(saveTimer);
    const write = () => {
      try {
        fs.mkdirSync(CONFIG.dataDir, { recursive: true });
        const tmp = `${FILE}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify([...byId.values()], null, 1));
        fs.renameSync(tmp, FILE);
      } catch (err) { log.warn(`Gift catalogue save failed: ${err.message}`); }
    };
    if (now) write(); else saveTimer = setTimeout(write, 2000);
  }

  function changed() {
    save();
    clearTimeout(notifyTimer);
    notifyTimer = setTimeout(() => onChange(list()), 600);
  }

  /** Add or update one gift. Returns true if something changed. */
  function add(g) {
    const id = cleanId(g.id);
    const name = String(g.name ?? '').trim().slice(0, 48);
    if (!id || id === '0' || !name || /^Gift#/.test(name)) return false;
    const prev = byId.get(id);
    const remote = imgUrl(g.image) || prev?.remote || '';
    const next = { id, name, diamonds: Number(g.diamonds) || prev?.diamonds || 0, remote, local: prev?.local || '' };
    if (prev && prev.name === next.name && prev.diamonds === next.diamonds && prev.remote === next.remote) return false;
    byId.set(id, next);
    if (next.remote && !next.local) enqueue(next);
    changed();
    return true;
  }

  /** Accepts the connector's gift list in any of the shapes it has used. */
  function ingest(raw) {
    let arr = Array.isArray(raw) ? raw : raw?.gifts ?? raw?.giftList ?? raw?.gift_list ?? raw?.data?.gifts ?? [];
    if (Array.isArray(raw?.pages)) for (const pg of raw.pages) arr = arr.concat(pg.gifts || []);
    let n = 0;
    for (const g of arr) {
      if (!g || typeof g !== 'object') continue;
      add({ id: g.id ?? g.giftId, name: g.name ?? g.giftName, diamonds: g.diamond_count ?? g.diamondCount, image: g.image ?? g.icon ?? g.giftImage });
      n++;
    }
    return n;
  }

  function find(id, name) {
    const byIdHit = byId.get(cleanId(id));
    if (byIdHit) return byIdHit;
    const lower = String(name ?? '').toLowerCase();
    for (const e of byId.values()) if (e.name.toLowerCase() === lower) return e;
    return null;
  }

  function enqueue(e) {
    if (failed.has(e.id) || queue.includes(e) || !hostOk(e.remote)) return;
    queue.push(e);
    pump();
  }
  function pump() {
    while (active < 4 && queue.length) {
      const e = queue.shift();
      active++;
      download(e).finally(() => { active--; pump(); });
    }
  }
  async function download(e) {
    try {
      const r = await fetch(e.remote, { signal: AbortSignal.timeout(15_000), headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > 2 * 1024 * 1024) throw new Error('too large');
      const type = imageType(buf);
      if (!type) throw new Error('not an image');
      fs.mkdirSync(IMG_DIR, { recursive: true });
      const file = `${e.id}.${type}`;
      fs.writeFileSync(path.join(IMG_DIR, file), buf);
      e.local = `/gift-img/${file}`;
      changed();
    } catch (err) {
      failed.add(e.id);
      log.warn(`Gift image download failed (${e.name}): ${err.message}`);
    }
  }

  function list() {
    return [...byId.values()]
      .map((e) => ({ id: e.id, name: e.name, diamonds: e.diamonds, image: e.local || e.remote || null }))
      .sort((a, b) => a.diamonds - b.diamonds || a.name.localeCompare(b.name));
  }

  return {
    load, add, ingest, find, list, IMG_DIR, IMG_FILE_RE,
    flush: () => save(true),
    imageFor: (id, name) => { const e = find(id, name); return e ? e.local || e.remote || null : null; },
    size: () => byId.size,
    onChange: (fn) => (onChange = fn),
  };
})();

// ============================================================================
// 6. STREAK GATE — decides WHEN a gift should produce a trigger
//
//   • Non-streakable gift            → fire immediately (once).
//   • Streakable, repeatEnd === false → combo still running: remember it, DO NOT fire.
//   • Streakable, repeatEnd === true  → combo finished: fire ONCE with the final repeatCount.
//   • Streak with no repeatEnd within streakTimeoutMs → fire once with the last count seen.
//   • Duplicate final events (some connector versions re-emit them) are suppressed.
// ============================================================================
class StreakGate {
  constructor({ timeoutMs, onTimeout }) {
    this.timeoutMs = timeoutMs;
    this.onTimeout = onTimeout;
    this.pending = new Map(); // streakKey -> { gift, timer }
    this.recentFinals = new Map(); // dedupeKey -> ts
  }

  static key(gift) {
    return `${gift.user.userId}:${gift.giftId}:${gift.groupId}`;
  }

  /** @returns {boolean} true if this event should fire a trigger now */
  accept(gift) {
    if (!gift.streakable) return this.#once(gift);

    const key = StreakGate.key(gift);
    const prev = this.pending.get(key);
    if (prev) clearTimeout(prev.timer);

    if (!gift.repeatEnd) {
      // Combo in progress — track the latest count and (re)arm the safety timeout.
      const timer = this.timeoutMs > 0
        ? setTimeout(() => {
            this.pending.delete(key);
            if (this.#once(gift)) this.onTimeout(gift);
          }, this.timeoutMs)
        : null;
      timer?.unref?.();
      this.pending.set(key, { gift, timer });
      return false;
    }

    this.pending.delete(key);
    return this.#once(gift);
  }

  /** Suppress an identical final event seen within the last 5s. */
  #once(gift) {
    const now = Date.now();
    const k = `${StreakGate.key(gift)}:${gift.repeatCount}`;
    for (const [key, ts] of this.recentFinals) if (now - ts > 5_000) this.recentFinals.delete(key);
    if (this.recentFinals.has(k)) return false;
    this.recentFinals.set(k, now);
    return true;
  }

  clear() {
    for (const { timer } of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
    this.recentFinals.clear();
  }
}

// ============================================================================
// 7. WEBSOCKET HUB — client bookkeeping, auth, heartbeat, broadcast
// ============================================================================
const Hub = {
  wss: null,
  clients: new Set(),

  attach(server) {
    // noServer + manual upgrade so we can accept several paths and reject everything else.
    this.wss = new WebSocketServer({ noServer: true, maxPayload: CONFIG.maxPayloadBytes });
    server.on('upgrade', (req, socket, head) => {
      const { pathname } = new URL(req.url, 'http://localhost');
      if (!CONFIG.wsPaths.includes(pathname)) return socket.destroy();
      const origin = req.headers.origin;
      if (origin && CONFIG.allowedOrigins.length && !CONFIG.allowedOrigins.includes(origin)) {
        log.warn(`Rejected WebSocket from origin ${origin}`);
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        return socket.destroy();
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.wss.emit('connection', ws, req));
    });

    this.wss.on('connection', (ws, req) => {
      // --- optional token auth ---
      const url = new URL(req.url, 'http://localhost');
      if (CONFIG.wsToken && !safeEqual(url.searchParams.get('token') ?? '', CONFIG.wsToken)) {
        ws.close(4401, 'Unauthorized');
        return;
      }

      ws.id = crypto.randomUUID();
      ws.role = url.searchParams.get('role') || 'client'; // informational: "dashboard" | "game"
      ws.isAlive = true;
      this.clients.add(ws);
      log.info(`WS client connected (${ws.role}) — ${this.clients.size} total`);

      ws.on('pong', () => (ws.isAlive = true));
      ws.on('message', (raw) => handleClientMessage(ws, raw));
      ws.on('close', () => {
        this.clients.delete(ws);
        log.info(`WS client disconnected (${ws.role}) — ${this.clients.size} total`);
      });
      ws.on('error', (err) => log.warn(`WS client error: ${err.message}`));

      // New clients immediately get the full picture.
      this.send(ws, MSG.STATE, snapshot());
    });

    // Heartbeat: terminate sockets that stop answering pings (crashed game, sleeping laptop).
    this.heartbeat = setInterval(() => {
      for (const ws of this.clients) {
        if (!ws.isAlive) { ws.terminate(); continue; }
        ws.isAlive = false;
        try { ws.ping(); } catch { /* socket already gone */ }
      }
    }, CONFIG.heartbeatMs);
    this.heartbeat.unref();
  },

  send(ws, type, payload, requestId) {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type, payload, ...(requestId ? { requestId } : {}), ts: Date.now() }));
  },

  /** Broadcast to ALL connected clients (dashboard + game). Serializes once. */
  broadcast(type, payload) {
    const frame = JSON.stringify({ type, payload, ts: Date.now() });
    for (const ws of this.clients) if (ws.readyState === WebSocket.OPEN) ws.send(frame);
  },

  close() {
    clearInterval(this.heartbeat);
    for (const ws of this.clients) ws.close(1001, 'Server shutting down');
    this.wss?.close();
  },
};

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// ============================================================================
// 8. LIKE AGGREGATOR — counts likes and throttles broadcasts (likes arrive in bursts)
// ============================================================================
const Likes = {
  totalLikes: 0, // likes counted by this server since the current connection started
  streamTotalLikes: 0, // TikTok's own running total for the stream (when provided)
  last: null,
  timer: null,

  add(data, simulated = false) {
    const count = Math.max(1, Number(first(data.likeCount, data.count, 1)) || 1);
    const prev = this.totalLikes;
    this.totalLikes += count;
    const streamTotal = Number(data.totalLikeCount);
    if (Number.isFinite(streamTotal) && streamTotal > this.streamTotalLikes) this.streamTotalLikes = streamTotal;
    const user = normalizeUser(data);
    this.last = { user, count };
    Session.recordLikes(user, count, simulated);
    GoalStore.check(prev, this.totalLikes, user, simulated);
    this._scheduleBroadcast();
  },

  _scheduleBroadcast() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      Hub.broadcast(MSG.LIKES_UPDATE, this.toJSON());
    }, CONFIG.likeBroadcastIntervalMs);
  },

  reset() {
    clearTimeout(this.timer);
    Object.assign(this, { totalLikes: 0, streamTotalLikes: 0, last: null, timer: null });
  },

  toJSON() {
    return {
      totalLikes: this.totalLikes,
      streamTotalLikes: this.streamTotalLikes,
      lastUser: this.last?.user.uniqueId ?? null,
      lastCount: this.last?.count ?? 0,
    };
  },
};

// Viewer count from TikTok "roomUser" events, throttled like likes.
const Viewers = {
  viewerCount: 0,
  timer: null,
  set(n) {
    if (!Number.isFinite(n) || n === this.viewerCount) return;
    this.viewerCount = n;
    Session.recordViewers(n);
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      Hub.broadcast(MSG.VIEWERS_UPDATE, { viewerCount: this.viewerCount });
    }, CONFIG.likeBroadcastIntervalMs);
  },
  reset() {
    clearTimeout(this.timer);
    this.timer = null;
    this.viewerCount = 0;
    Hub.broadcast(MSG.VIEWERS_UPDATE, { viewerCount: 0 });
  },
};

// ============================================================================
// 8b. STREAM FEATURES — saved settings, pause, chat commands, like goals, presets, sessions/reports
// ============================================================================
const ACTION_NAME_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
const clampNum = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

/** Small JSON file in DATA_DIR, written atomically. */
function jsonFile(name) {
  const file = path.join(CONFIG.dataDir, name);
  return {
    file,
    read(fallback) {
      try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
      catch (err) { if (err.code !== 'ENOENT') log.warn(`Could not read ${file}: ${err.message}`); return fallback; }
    },
    write(data) {
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const tmp = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
        fs.renameSync(tmp, file);
      } catch (err) { log.warn(`Could not save ${file}: ${err.message}`); }
    },
  };
}

/** Server settings that must survive restarts (auto-connect). */
const Settings = (() => {
  const f = jsonFile('settings.json');
  let data = { autoConnect: { enabled: false, username: '' } };
  return {
    load() { const d = f.read({}); data = { ...data, ...d, autoConnect: { ...data.autoConnect, ...(d.autoConnect || {}) } }; },
    get: () => data,
    set(patch) { data = { ...data, ...patch }; f.write(data); return data; },
  };
})();

/** Pause: while paused no GAME_EVENT is sent (gifts are still counted and logged). */
const Control = {
  paused: false,
  setPaused(p) {
    this.paused = !!p;
    Hub.broadcast(MSG.PAUSED, { paused: this.paused });
    log.info(this.paused ? 'Game paused' : 'Game resumed');
    return { paused: this.paused };
  },
};

/**
 * Chat commands: { "!left": { action, value, cooldown, userCooldown } } (cooldowns in seconds).
 * "!left" or the bare word "left" (as the whole message) triggers it.
 */
const CommandStore = (() => {
  const f = jsonFile('commands.json');
  const KEY_RE = /^![\p{L}\p{N}_-]{1,24}$/u;
  let commands = {};
  const lastAll = new Map();
  const lastUser = new Map();
  const normKey = (k) => { let s = String(k ?? '').trim().toLowerCase(); if (s && !s.startsWith('!')) s = '!' + s; return s; };

  function validate(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('commands must be an object like {"!left": {"action": "STEER_LEFT"}}');
    const out = {};
    for (const [k, c] of Object.entries(input)) {
      const key = normKey(k);
      if (!KEY_RE.test(key)) throw new Error(`Invalid command "${k}" (letters/numbers, max 24, e.g. !left)`);
      if (!c || !ACTION_NAME_RE.test(String(c.action ?? ''))) throw new Error(`Command ${key}: pick an action`);
      const value = c.value === undefined ? 1 : Number(c.value);
      if (!Number.isFinite(value)) throw new Error(`Command ${key}: value must be a number`);
      out[key] = { action: String(c.action), value, cooldown: clampNum(c.cooldown, 0, 3600, 3), userCooldown: clampNum(c.userCooldown, 0, 3600, 10) };
    }
    if (Object.keys(out).length > 50) throw new Error('At most 50 chat commands');
    return out;
  }

  return {
    load() { try { commands = validate(f.read({})); } catch (err) { log.warn(`commands.json ignored: ${err.message}`); commands = {}; } },
    update(input) { commands = validate(input); lastAll.clear(); lastUser.clear(); f.write(commands); return commands; },
    all: () => commands,
    /** null = not a command; { key, cmd } = fire; { key, blocked } = on cooldown. */
    match(comment, userId, now = Date.now()) {
      const text = String(comment ?? '').trim().toLowerCase();
      if (!text) return null;
      const firstWord = text.split(/\s+/)[0];
      let key = firstWord.startsWith('!') ? firstWord : null;
      if (!key && commands['!' + text]) key = '!' + text; // bare word, whole message
      const cmd = key && commands[key];
      if (!cmd) return null;
      const uk = `${key}|${userId}`;
      if (now - (lastAll.get(key) ?? 0) < cmd.cooldown * 1000) return { key, blocked: 'cooldown' };
      if (now - (lastUser.get(uk) ?? 0) < cmd.userCooldown * 1000) return { key, blocked: 'user cooldown' };
      lastAll.set(key, now);
      lastUser.set(uk, now);
      return { key, cmd };
    },
  };
})();

/** Like goals: [{ id, every, action, value, label }] → fires each time total likes pass a multiple of `every`. */
const GoalStore = (() => {
  const f = jsonFile('like-goals.json');
  let goals = [];
  function validate(list) {
    if (!Array.isArray(list)) throw new Error('goals must be a list');
    if (list.length > 10) throw new Error('At most 10 like goals');
    return list.map((g, i) => {
      if (!g || !ACTION_NAME_RE.test(String(g.action ?? ''))) throw new Error(`Goal ${i + 1}: pick an action`);
      const every = Math.round(clampNum(g.every, 10, 10_000_000, NaN));
      if (!Number.isFinite(every)) throw new Error(`Goal ${i + 1}: "every" must be at least 10 likes`);
      const value = g.value === undefined ? 1 : Number(g.value);
      if (!Number.isFinite(value)) throw new Error(`Goal ${i + 1}: value must be a number`);
      return { id: /^[\w-]{1,24}$/.test(g.id ?? '') ? g.id : 'g' + crypto.randomBytes(3).toString('hex'), every, action: String(g.action), value, label: String(g.label ?? '').slice(0, 40) };
    });
  }
  return {
    load() { try { goals = validate(f.read([])); } catch (err) { log.warn(`like-goals.json ignored: ${err.message}`); goals = []; } },
    update(list) { goals = validate(list); f.write(goals); return goals; },
    all: () => goals,
    /** Called when the like counter goes prev → now. */
    check(prev, now, liker, simulated) {
      for (const g of goals) {
        const crossed = Math.floor(now / g.every) - Math.floor(prev / g.every);
        if (crossed <= 0) continue;
        emitGameEvent({
          source: 'likes', user: liker?.uniqueId ?? 'viewers', nickname: liker?.nickname ?? 'Viewers', profilePictureUrl: liker?.profilePictureUrl ?? null,
          giftName: g.label || `${g.every.toLocaleString('en')} likes`, giftId: 'likes', giftImage: null,
          diamondCount: 0, repeatCount: crossed, totalDiamonds: 0, action: g.action, value: g.value * crossed,
          matchedRule: `likes:${g.id}`, simulated, reason: 'likes', likes: Math.floor(now / g.every) * g.every,
        });
      }
    },
  };
})();

/**
 * Stream sessions → reports. A "live" session starts when a TikTok connection succeeds and ends on
 * disconnect / stream end; it is saved to DATA_DIR/reports/<id>.json. Outside a live stream a
 * "rehearsal" session collects dashboard tests (never saved). Live sessions ignore dashboard tests.
 */
const Session = (() => {
  const DIR = path.join(CONFIG.dataDir, 'reports');
  const ID_RE = /^[\w.-]{1,120}$/;
  let cur = fresh();
  let supTimer = null;
  let sesTimer = null;
  let lastTop = '';

  function fresh(username = null, live = false) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    return { id: username ? `${stamp}-${username}` : 'rehearsal', username, live, startedAt: Date.now(), endedAt: null,
      diamonds: 0, gifts: 0, likes: 0, chats: 0, commands: 0, peakViewers: 0, bestRun: 0, runs: 0, users: {}, giftCounts: {}, actions: {} };
  }
  const counts = (simulated) => !(cur.live && simulated);
  function userRec(u) {
    const k = u.userId || u.uniqueId || 'unknown';
    const r = (cur.users[k] ??= { uniqueId: u.uniqueId, nickname: u.nickname, avatar: null, diamonds: 0, gifts: 0, likes: 0 });
    if (u.profilePictureUrl) r.avatar = u.profilePictureUrl;
    if (u.nickname) r.nickname = u.nickname;
    return r;
  }
  function changed() {
    if (!supTimer) supTimer = setTimeout(() => {
      supTimer = null;
      const top = topGifters(3);
      const key = JSON.stringify(top);
      if (key !== lastTop) { lastTop = key; Hub.broadcast(MSG.SUPPORTERS, { top }); }
    }, 800);
    if (!sesTimer) sesTimer = setTimeout(() => { sesTimer = null; Hub.broadcast(MSG.SESSION, summary()); }, 2000);
  }
  function topGifters(n, s = cur) {
    return Object.values(s.users).filter((u) => u.diamonds > 0)
      .sort((a, b) => b.diamonds - a.diamonds || b.gifts - a.gifts).slice(0, n)
      .map(({ uniqueId, nickname, avatar, diamonds, gifts }) => ({ uniqueId, nickname, avatar, diamonds, gifts }));
  }
  function summary(s = cur) {
    const { users, giftCounts, actions, ...rest } = s;
    return { ...rest, topGifter: topGifters(1, s)[0] ?? null, gifters: Object.values(users).filter((u) => u.diamonds > 0).length };
  }
  function full(s = cur) {
    return {
      ...summary(s),
      topGifters: topGifters(100, s),
      giftList: Object.entries(s.giftCounts).map(([name, g]) => ({ name, ...g })).sort((a, b) => b.diamonds - a.diamonds || b.count - a.count),
      actions: s.actions,
    };
  }
  function save(s) {
    try {
      fs.mkdirSync(DIR, { recursive: true });
      fs.writeFileSync(path.join(DIR, `${s.id}.json`), JSON.stringify(full(s), null, 1));
      log.info(`Report saved: ${s.id} (${s.diamonds} diamonds, ${s.gifts} gifts, ${s.likes} likes)`);
    } catch (err) { log.warn(`Could not save report: ${err.message}`); }
  }
  function list() {
    let files = [];
    try { files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')); } catch { return []; }
    return files.sort().reverse().slice(0, 100).map((f) => {
      try { const { topGifters: t, giftList, actions, ...s } = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); return s; } catch { return null; }
    }).filter(Boolean);
  }
  const csvCell = (v) => { const s = String(v ?? ''); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  function csv(r) {
    const rows = [
      ['TikTok LIVE report', r.username ? '@' + r.username : 'rehearsal'],
      ['Started', new Date(r.startedAt).toISOString()], ['Ended', r.endedAt ? new Date(r.endedAt).toISOString() : 'live'],
      ['Diamonds', r.diamonds], ['Gifts', r.gifts], ['Gifters', r.gifters], ['Likes', r.likes], ['Chat messages', r.chats],
      ['Chat commands used', r.commands], ['Peak viewers', r.peakViewers], ['Runs', r.runs], ['Best run (distance)', r.bestRun], [],
      ['Rank', 'Username', 'Nickname', 'Diamonds', 'Gifts'],
      ...r.topGifters.map((u, i) => [i + 1, '@' + u.uniqueId, u.nickname, u.diamonds, u.gifts]), [],
      ['Gift', 'Count', 'Diamonds'], ...r.giftList.map((g) => [g.name, g.count, g.diamonds]), [],
      ['Action', 'Times fired'], ...Object.entries(r.actions).map(([a, n]) => [a, n]),
    ];
    return '﻿' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n'); // BOM so Excel reads UTF-8 names
  }

  return {
    current: () => cur,
    summary, topGifters, list, csv,
    get(id) {
      if (id === 'current') return full(cur);
      if (!ID_RE.test(String(id))) throw new Error('Bad report id');
      try { return JSON.parse(fs.readFileSync(path.join(DIR, `${id}.json`), 'utf8')); } catch { throw new Error('Report not found'); }
    },
    start(username) { this.end(); cur = fresh(username, true); lastTop = ''; changed(); Hub.broadcast(MSG.REPORTS, { reports: list() }); },
    end() {
      if (cur.live) {
        cur.endedAt = Date.now();
        if (cur.gifts || cur.likes || cur.chats) { save(cur); }
      }
      const wasLive = cur.live;
      cur = fresh();
      lastTop = '';
      changed();
      if (wasLive) Hub.broadcast(MSG.REPORTS, { reports: list() });
    },
    recordGift(gift, simulated) {
      if (!counts(simulated)) return;
      const total = gift.diamondCount * gift.repeatCount;
      cur.diamonds += total;
      cur.gifts += gift.repeatCount;
      const u = userRec(gift.user);
      u.diamonds += total;
      u.gifts += gift.repeatCount;
      const g = (cur.giftCounts[gift.giftName] ??= { count: 0, diamonds: 0, image: null });
      g.count += gift.repeatCount;
      g.diamonds += total;
      g.image = GiftCatalog.imageFor(gift.giftId, gift.giftName) || g.image;
      changed();
    },
    recordLikes(user, n, simulated) { if (!counts(simulated)) return; cur.likes += n; userRec(user).likes += n; changed(); },
    recordChat(simulated) { if (!counts(simulated)) return; cur.chats++; changed(); },
    recordAction(ev) { if (!counts(ev.simulated)) return; cur.actions[ev.action] = (cur.actions[ev.action] ?? 0) + 1; if (ev.source === 'chat') cur.commands++; changed(); },
    recordViewers(n) { if (n > cur.peakViewers) { cur.peakViewers = n; changed(); } },
    recordRun(distance) { const d = Math.max(0, Math.floor(Number(distance) || 0)); cur.runs++; if (d > cur.bestRun) cur.bestRun = d; changed(); },
  };
})();

/** Saved setups: { name: { rules, commands, goals, savedAt } }. */
const Presets = (() => {
  const f = jsonFile('presets.json');
  let presets = {};
  const list = () => Object.entries(presets).map(([name, p]) => ({
    name, savedAt: p.savedAt, rules: Object.keys(p.rules || {}).length, commands: Object.keys(p.commands || {}).length, goals: (p.goals || []).length,
  })).sort((a, b) => a.name.localeCompare(b.name));
  const cleanName = (n) => { const s = String(n ?? '').trim().slice(0, 40); if (!s) throw new Error('Give the preset a name'); return s; };
  const broadcast = () => Hub.broadcast(MSG.PRESETS, { presets: list() });
  return {
    load() { const d = f.read({}); presets = d && typeof d === 'object' && !Array.isArray(d) ? d : {}; },
    list,
    save(name) {
      const n = cleanName(name);
      if (!presets[n] && Object.keys(presets).length >= 30) throw new Error('At most 30 presets');
      presets[n] = { rules: RuleStore.all(), commands: CommandStore.all(), goals: GoalStore.all(), savedAt: Date.now() };
      f.write(presets); broadcast();
      log.info(`Preset saved: ${n}`);
      return { name: n };
    },
    apply(name) {
      const n = cleanName(name);
      const p = presets[n];
      if (!p) throw new Error(`No preset called "${n}"`);
      const rules = RuleStore.update(p.rules || {}, 'replace');
      const commands = CommandStore.update(p.commands || {});
      const goals = GoalStore.update(p.goals || []);
      Hub.broadcast(MSG.RULES_UPDATED, { rules, reason: 'preset', preset: n });
      Hub.broadcast(MSG.COMMANDS_UPDATED, { commands, reason: 'preset' });
      Hub.broadcast(MSG.GOALS_UPDATED, { goals, reason: 'preset' });
      log.info(`Preset loaded: ${n}`);
      return { name: n, rules: Object.keys(rules).length, commands: Object.keys(commands).length, goals: goals.length };
    },
    remove(name) {
      const n = cleanName(name);
      if (!presets[n]) throw new Error(`No preset called "${n}"`);
      delete presets[n];
      f.write(presets); broadcast();
      return { name: n };
    },
  };
})();

/** Every GAME_EVENT goes through here (gifts, chat commands, like goals, tests). */
function emitGameEvent(fields) {
  if (Control.paused) { log.info(`Paused: skipped ${fields.action} from @${fields.user}`); return null; }
  const event = { eventId: crypto.randomUUID(), ts: Date.now(), source: 'gift', ...fields };
  Hub.broadcast(MSG.GAME_EVENT, event);
  Session.recordAction(event);
  log.info(`GAME_EVENT ${event.action} value=${event.value} ← ${event.giftName}${event.repeatCount > 1 ? ' x' + event.repeatCount : ''} from @${event.user}${event.simulated ? ' (test)' : ''}`);
  return event;
}

/** A chat message: counts it and fires a chat command if one matches (and is off cooldown). */
function handleChat(user, comment, simulated = false) {
  Session.recordChat(simulated);
  const hit = CommandStore.match(comment, user.userId || user.uniqueId);
  if (!hit) return { matched: false };
  if (hit.blocked) return { matched: true, fired: false, command: hit.key, blocked: hit.blocked };
  const event = emitGameEvent({
    source: 'chat', user: user.uniqueId, nickname: user.nickname, profilePictureUrl: user.profilePictureUrl ?? null,
    giftName: hit.key, giftId: 'chat', giftImage: null, diamondCount: 0, repeatCount: 1, totalDiamonds: 0,
    action: hit.cmd.action, value: hit.cmd.value, matchedRule: hit.key, command: hit.key, comment: String(comment).slice(0, 120),
    simulated, reason: simulated ? 'test' : 'chat',
  });
  return { matched: true, fired: !!event, command: hit.key, event };
}

// ============================================================================
// 9. GAME EVENT ROUTER — turns a finished gift into a GAME_EVENT broadcast
// ============================================================================
function routeGift(gift, { simulated = false, reason = 'gift' } = {}) {
  const rule = RuleStore.match(gift.giftName);
  if (!rule) return null; // no mapping → nothing to do (the gift is still logged)

  return emitGameEvent({
    source: 'gift',
    user: gift.user.uniqueId,
    nickname: gift.user.nickname,
    profilePictureUrl: gift.user.profilePictureUrl,
    giftName: gift.giftName,
    giftId: gift.giftId,
    giftImage: GiftCatalog.imageFor(gift.giftId, gift.giftName) || gift.giftPictureUrl || null, // /gift-img/… when cached
    diamondCount: gift.diamondCount, // diamonds per single gift
    repeatCount: gift.repeatCount, // gifts in this streak
    totalDiamonds: gift.diamondCount * gift.repeatCount,
    action: rule.action,
    value: rule.value * gift.repeatCount, // rule value scaled by streak size
    matchedRule: rule.name,
    simulated,
    reason, // "gift" | "streak_timeout" | "test"
  });
}

/**
 * Called once per FINISHED gift (after the streak gate). Broadcasts GIFT_RECEIVED for the
 * dashboard's log/analytics (even when no rule matches), then routes it to the game.
 */
function completeGift(gift, opts = {}) {
  Session.recordGift(gift, !!opts.simulated);
  const event = routeGift(gift, opts);
  Hub.broadcast(MSG.GIFT_RECEIVED, {
    user: gift.user.uniqueId,
    nickname: gift.user.nickname,
    giftName: gift.giftName,
    giftPictureUrl: gift.giftPictureUrl,
    giftImage: GiftCatalog.imageFor(gift.giftId, gift.giftName) || gift.giftPictureUrl || null,
    diamondCount: gift.diamondCount,
    repeatCount: gift.repeatCount,
    totalDiamonds: gift.diamondCount * gift.repeatCount,
    action: event?.action ?? null,
    value: event?.value ?? null,
    simulated: !!opts.simulated,
    reason: opts.reason ?? 'gift',
  });
  return event;
}

const streakGate = new StreakGate({
  timeoutMs: CONFIG.streakTimeoutMs,
  onTimeout: (gift) => {
    log.warn(`Streak timed out without repeatEnd: ${gift.giftName} x${gift.repeatCount} from @${gift.user.uniqueId}`);
    completeGift(gift, { reason: 'streak_timeout' });
  },
});

// ============================================================================
// 10. TIKTOK CONNECTION MANAGER — connect / restart / auto-reconnect / status broadcast
// ============================================================================
const TikTok = (() => {
  // Load whichever connector is installed: v2 exports TikTokLiveConnection, v1 WebcastPushConnection.
  const lib = require('tiktok-live-connector');
  const Connection = lib.TikTokLiveConnection ?? lib.WebcastPushConnection;
  if (!Connection) throw new Error('tiktok-live-connector exports no known connection class');

  let conn = null;
  let generation = 0; // bumps on every (re)connect; stale connections' events are ignored
  let manualStop = false;
  let reconnectTimer = null;
  let attempt = 0;
  let connecting = false;
  let state = { status: STATUS.DISCONNECTED, username: null, roomId: null, error: null, reconnecting: false, attempt: 0, since: Date.now() };
  let autoInfo = { checkedAt: null, live: null, error: null };

  const publicState = () => ({ ...state, autoConnect: { ...Settings.get().autoConnect, ...autoInfo } });
  function setStatus(patch) {
    const prev = state.status;
    state = { ...state, ...patch, since: patch.status && patch.status !== prev ? Date.now() : state.since };
    Hub.broadcast(MSG.STATUS, publicState());
  }

  /** Tear down the current connection without triggering reconnect logic. */
  async function teardown() {
    generation++;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    const old = conn;
    conn = null;
    streakGate.clear();
    if (old) {
      old.removeAllListeners?.();
      try { await old.disconnect(); } catch { /* already closed */ }
    }
  }

  /** Public: (re)start a connection. Safe to call while connected — restarts cleanly. */
  async function connect(rawUsername) {
    const username = String(rawUsername ?? '').trim().replace(/^@/, '');
    if (!/^[\w.]{2,50}$/.test(username)) throw new Error('Invalid TikTok username');
    manualStop = false;
    attempt = 0;
    await teardown();
    Likes.reset();
    Viewers.reset();
    return open(username);
  }

  async function open(username) {
    const myGen = ++generation;
    connecting = true;
    setStatus({ username, error: null, reconnecting: attempt > 0, attempt });

    conn = new Connection(username, {
      processInitialData: false, // don't replay gifts sent before we connected
      enableExtendedGiftInfo: true,
      ...(CONFIG.signApiKey ? { signApiKey: CONFIG.signApiKey } : {}),
    });
    wireEvents(conn, myGen);

    try {
      const info = await conn.connect();
      if (myGen !== generation) return state; // superseded by a newer CONNECT_TIKTOK
      connecting = false;
      attempt = 0;
      // A new stream report starts on the first successful connect (auto-reconnects keep the same one).
      const cur = Session.current();
      if (!cur.live || cur.username !== username) Session.start(username);
      const auto = Settings.get().autoConnect;
      if (auto.enabled && auto.username !== username) Settings.set({ autoConnect: { ...auto, username } });
      setStatus({ status: STATUS.CONNECTED, roomId: String(info?.roomId ?? '') || null, error: null, reconnecting: false, attempt: 0 });
      log.info(`Connected to @${username} (room ${state.roomId})`);
      // Fill the gift catalogue from this room (non-blocking).
      roomGifts(conn, info)
        .then((list) => { const n = GiftCatalog.ingest(list); if (n) log.info(`Gift list from @${username}: ${n} gifts`); })
        .catch((err) => log.warn(`Could not load the room's gift list: ${describeError(err)}`));
      return state;
    } catch (err) {
      if (myGen !== generation) return state;
      connecting = false;
      const message = describeError(err);
      log.warn(`Connect to @${username} failed: ${message}`);
      // Invalidate the failed connection so any late 'disconnected'/'error' it emits is ignored.
      generation++;
      const failed = conn;
      conn = null;
      failed?.removeAllListeners?.();
      Promise.resolve(failed?.disconnect?.()).catch(() => {});
      setStatus({ status: STATUS.ERROR, error: message });
      // First manual attempt fails fast (bad username / not live); reconnect attempts keep retrying.
      if (attempt > 0) scheduleReconnect(username);
      throw new Error(message);
    }
  }

  function wireEvents(c, myGen) {
    const live = () => myGen === generation;
    // Every listener is wrapped so a malformed payload can never crash the process.
    const on = (event, fn) =>
      c.on(event, (...args) => {
        if (!live()) return;
        try { fn(...args); } catch (err) { log.error(`Handler for "${event}" failed: ${err.message}`); }
      });

    on('gift', (data) => {
      const gift = normalizeGift(data);
      GiftCatalog.add({ id: gift.giftId, name: gift.giftName, diamonds: gift.diamondCount, image: gift.giftPictureUrl });
      if (streakGate.accept(gift)) completeGift(gift);
    });

    on('like', (data) => Likes.add(data));

    on('chat', (data) => handleChat(normalizeUser(data), first(data.comment, data.content, '')));

    on('roomUser', (data) => Viewers.set(Number(first(data.viewerCount, data.total, data.totalUser))));

    on('streamEnd', () => {
      log.info('Stream ended by host');
      manualStop = true; // never auto-reconnect to an ended stream
      conn = null;
      streakGate.clear();
      Session.end();
      setStatus({ status: STATUS.DISCONNECTED, error: 'Stream ended', reconnecting: false });
    });

    on('disconnected', () => {
      conn = null;
      if (manualStop) return setStatus({ status: STATUS.DISCONNECTED, reconnecting: false });
      log.warn('TikTok connection dropped unexpectedly');
      scheduleReconnect(state.username);
    });

    on('error', (err) => log.warn(`Connector error: ${describeError(err)}`));
  }

  function scheduleReconnect(username) {
    const { maxAttempts, baseDelayMs, maxDelayMs } = CONFIG.reconnect;
    if (!username || manualStop) return;
    if (attempt >= maxAttempts) {
      setStatus({ status: STATUS.ERROR, error: `Gave up reconnecting after ${maxAttempts} attempts`, reconnecting: false });
      return;
    }
    attempt++;
    const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
    log.info(`Reconnecting to @${username} in ${delay / 1000}s (attempt ${attempt}/${maxAttempts})`);
    setStatus({ status: STATUS.DISCONNECTED, reconnecting: true, attempt });
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => { reconnectTimer = null; open(username).catch(() => { /* handled inside open() */ }); }, delay);
  }

  async function disconnect() {
    manualStop = true;
    connecting = false;
    await teardown();
    Session.end();
    setStatus({ status: STATUS.DISCONNECTED, roomId: null, error: null, reconnecting: false, attempt: 0 });
  }

  /* ---- Auto-connect: check once a minute whether the account is LIVE, connect when it is ---- */
  function setAutoConnect({ enabled, username }) {
    const cur = Settings.get().autoConnect;
    const u = String(username ?? cur.username ?? '').trim().replace(/^@/, '');
    if (enabled && !/^[\w.]{2,50}$/.test(u)) throw new Error('Enter your TikTok username for auto-connect');
    Settings.set({ autoConnect: { enabled: !!enabled, username: u } });
    autoInfo = { checkedAt: null, live: null, error: null };
    setStatus({});
    log.info(enabled ? `Auto-connect on for @${u}` : 'Auto-connect off');
    if (enabled) setTimeout(autoTick, 500);
    return publicState().autoConnect;
  }
  async function autoTick() {
    const a = Settings.get().autoConnect;
    if (!a.enabled || !a.username || state.status === STATUS.CONNECTED || connecting || reconnectTimer) return;
    let live = true;
    let error = null;
    try {
      const probe = new Connection(a.username, { ...(CONFIG.signApiKey ? { signApiKey: CONFIG.signApiKey } : {}) });
      probe.on?.('error', () => {});
      if (typeof probe.fetchIsLive === 'function') live = !!(await probe.fetchIsLive());
    } catch (err) { live = false; error = describeError(err); }
    autoInfo = { checkedAt: Date.now(), live, error };
    if (!live) return setStatus({});
    log.info(`Auto-connect: @${a.username} is LIVE, connecting`);
    connect(a.username).catch(() => { /* status shows the error; next tick retries */ });
  }
  setTimeout(() => autoTick().catch(() => {}), 5_000).unref();
  setInterval(() => autoTick().catch(() => {}), 60_000).unref();

  /** The connector's gift list for a connection, in whichever way this connector version offers it. */
  async function roomGifts(c, info) {
    let list = info?.availableGifts ?? c.availableGifts;
    if (!list || (Array.isArray(list) && !list.length)) {
      const f = c.fetchAvailableGifts ?? c.getAvailableGifts;
      if (f) list = await f.call(c);
    }
    return list || [];
  }

  /**
   * Gift list for FETCH_GIFTS: from the current stream, or from any account that is LIVE right now
   * (TikTok only returns the gift list for a live room). Uses a short-lived second connection.
   */
  async function fetchGifts(rawUsername) {
    const username = String(rawUsername ?? '').trim().replace(/^@/, '');
    if (!username && conn && state.status === STATUS.CONNECTED) return roomGifts(conn, null);
    const u = username || state.username;
    if (!/^[\w.]{2,50}$/.test(u || '')) throw new Error('Enter the username of any TikTok account that is LIVE right now');
    const temp = new Connection(u, { processInitialData: false, enableExtendedGiftInfo: true, ...(CONFIG.signApiKey ? { signApiKey: CONFIG.signApiKey } : {}) });
    temp.on('error', () => {});
    try {
      const info = await Promise.race([
        temp.connect(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out after 45s')), 45_000)),
      ]);
      return await roomGifts(temp, info);
    } catch (err) {
      const m = describeError(err);
      throw new Error(/offline|not.*live|isn't online|UserOffline|room id/i.test(m) ? `@${u} is not LIVE right now. Enter any account that is streaming at the moment.` : `Could not load gifts: ${m}`);
    } finally {
      temp.removeAllListeners?.();
      temp.on?.('error', () => {});
      Promise.resolve(temp.disconnect?.()).catch(() => {});
    }
  }

  return { connect, disconnect, fetchGifts, setAutoConnect, status: publicState };
})();

function describeError(err) {
  return String(err?.message || err?.info || err?.exception?.message || err || 'Unknown error');
}

// ============================================================================
// 11. CLIENT MESSAGE HANDLERS — the dashboard's command API
// ============================================================================
const handlers = {
  async [MSG.CONNECT_TIKTOK]({ username }) {
    return TikTok.connect(username);
  },

  async [MSG.DISCONNECT_TIKTOK]() {
    // A manual disconnect also stops auto-connect, otherwise it would reconnect within a minute.
    if (Settings.get().autoConnect.enabled) TikTok.setAutoConnect({ enabled: false });
    await TikTok.disconnect();
    return TikTok.status();
  },

  [MSG.UPDATE_COMMANDS]({ commands }) {
    const updated = CommandStore.update(commands);
    Hub.broadcast(MSG.COMMANDS_UPDATED, { commands: updated });
    log.info(`Chat commands updated: ${Object.keys(updated).join(', ') || '(none)'}`);
    return { commands: updated };
  },

  [MSG.UPDATE_GOALS]({ goals }) {
    const updated = GoalStore.update(goals);
    Hub.broadcast(MSG.GOALS_UPDATED, { goals: updated });
    log.info(`Like goals updated: ${updated.map((g) => `${g.every}→${g.action}`).join(', ') || '(none)'}`);
    return { goals: updated };
  },

  [MSG.SET_PAUSED]({ paused }) { return Control.setPaused(paused); },
  [MSG.SET_AUTO_CONNECT](p) { return TikTok.setAutoConnect(p); },
  [MSG.SAVE_PRESET]({ name }) { return Presets.save(name); },
  [MSG.LOAD_PRESET]({ name }) { return Presets.apply(name); },
  [MSG.DELETE_PRESET]({ name }) { return Presets.remove(name); },

  [MSG.TEST_CHAT]({ comment, user = 'tester' }) {
    if (Control.paused) throw new Error('The game is paused. Resume it first.');
    const u = String(user).slice(0, 40);
    return handleChat({ userId: 'test-' + u, uniqueId: u, nickname: u, profilePictureUrl: null }, String(comment ?? ''), true);
  },
  [MSG.TEST_LIKES]({ count = 100, user = 'tester' }) {
    const n = Math.round(clampNum(count, 1, 100_000, 100));
    const u = String(user).slice(0, 40);
    Likes.add({ likeCount: n, userId: 'test-' + u, uniqueId: u, nickname: u }, true);
    return { totalLikes: Likes.totalLikes };
  },
  [MSG.GET_REPORTS]() { return { reports: Session.list(), current: Session.summary() }; },
  [MSG.GET_REPORT]({ id }) { return Session.get(id); },
  [MSG.GAME_STATS]({ distance }) { Session.recordRun(distance); return { ok: true }; },

  [MSG.UPDATE_RULES]({ rules, mode = 'replace' }) {
    if (!['replace', 'merge'].includes(mode)) throw new Error('mode must be "replace" or "merge"');
    const updated = RuleStore.update(rules, mode);
    Hub.broadcast(MSG.RULES_UPDATED, { rules: updated });
    log.info(`Rules updated (${mode}): ${Object.keys(updated).join(', ') || '(none)'}`);
    return { rules: updated };
  },

  /**
   * TEST_TRIGGER, two modes:
   *   { action: "SPAWN_OBSTACLE", value: 3 }   → broadcast that action directly (no rule needed)
   *   { giftName: "Rose", repeatCount: 5 }     → simulate a finished gift through the live rules
   */
  [MSG.TEST_TRIGGER](p = {}) {
    if (Control.paused) throw new Error('The game is paused. Resume it first.');
    const name = String(p.user || 'test_user').slice(0, 40);
    const user = { userId: 'test-' + name, uniqueId: name, nickname: name, profilePictureUrl: null }; // one supporter per test name

    if (p.giftName) {
      const matched = RuleStore.match(p.giftName);
      const known = GiftCatalog.find(null, p.giftName);
      const gift = {
        user,
        giftId: known?.id ?? 'test',
        // Use the rule's canonical spelling ("rose" → "Rose") unless only the "*" fallback matched.
        giftName: matched && matched.name !== '*' ? matched.name : String(p.giftName),
        diamondCount: Number(p.diamondCount) || known?.diamonds || 1,
        giftPictureUrl: null,
        streakable: false,
        repeatCount: Math.max(1, Math.min(10_000, Number(p.repeatCount) || 1)),
        repeatEnd: true,
        groupId: '',
      };
      const event = completeGift(gift, { simulated: true, reason: 'test' });
      // Not an error: the gift is still logged; the dashboard just sees matched=false.
      return event ?? { matched: false, giftName: gift.giftName };
    }

    const action = String(p.action ?? '').trim();
    if (!action) throw new Error('TEST_TRIGGER needs either "action" or "giftName"');
    const value = p.value === undefined ? 1 : Number(p.value);
    if (!Number.isFinite(value)) throw new Error('value must be a number');
    return emitGameEvent({
      source: 'test',
      user: user.uniqueId,
      nickname: user.nickname,
      profilePictureUrl: null,
      giftName: p.giftNameLabel ?? 'TEST',
      giftId: 'test',
      diamondCount: 0,
      repeatCount: 1,
      totalDiamonds: 0,
      action,
      value,
      matchedRule: null,
      simulated: true,
      reason: 'test',
    });
  },

  async [MSG.FETCH_GIFTS]({ username } = {}) {
    const list = await TikTok.fetchGifts(username);
    const count = GiftCatalog.ingest(list);
    if (!count) throw new Error('TikTok returned no gifts for that account. Try another account that is LIVE.');
    log.info(`FETCH_GIFTS: ${count} gifts (catalogue now ${GiftCatalog.size()})`);
    return { count, total: GiftCatalog.size() };
  },

  [MSG.GET_STATE]() {
    return snapshot();
  },
};

async function handleClientMessage(ws, raw) {
  let msg;
  try {
    msg = JSON.parse(raw.toString());
  } catch {
    return Hub.send(ws, MSG.ERROR, { error: 'Invalid JSON' });
  }
  const { type, payload = {}, id } = msg ?? {};
  const handler = handlers[type];
  if (!handler) return Hub.send(ws, MSG.ERROR, { error: `Unknown message type "${type}"` }, id);
  if (typeof payload !== 'object' || payload === null) return Hub.send(ws, MSG.ERROR, { type, error: 'payload must be an object' }, id);

  try {
    const result = await handler(payload);
    Hub.send(ws, MSG.ACK, { type, result }, id);
  } catch (err) {
    log.warn(`${type} failed: ${err.message}`);
    Hub.send(ws, MSG.ERROR, { type, error: err.message }, id);
  }
}

function snapshot() {
  return {
    status: TikTok.status(), rules: RuleStore.all(), likes: Likes.toJSON(), viewerCount: Viewers.viewerCount, clients: Hub.clients.size, gifts: GiftCatalog.list(),
    commands: CommandStore.all(), goals: GoalStore.all(), paused: Control.paused, presets: Presets.list(),
    supporters: Session.topGifters(3), session: Session.summary(),
  };
}

// ============================================================================
// 12. EXPRESS — health check + read-only REST mirror (for monitoring / OBS / scripts)
// ============================================================================
const app = express();
app.disable('x-powered-by');
app.get('/health', (_req, res) => res.json({ ok: true, uptime: process.uptime(), tiktok: TikTok.status().status }));
// Read-only state; requires the same token as the WebSocket when WS_TOKEN is set.
app.get('/api/state', (req, res) => {
  const given = req.query.token || req.get('x-access-token') || '';
  if (CONFIG.wsToken && !safeEqual(given, CONFIG.wsToken)) return res.status(401).json({ error: 'token required' });
  res.json(snapshot());
});
// Stream report as CSV (opens in Excel / Google Sheets). Same token as the WebSocket.
app.get('/api/reports/:id.csv', (req, res) => {
  const given = req.query.token || req.get('x-access-token') || '';
  if (CONFIG.wsToken && !safeEqual(given, CONFIG.wsToken)) return res.status(401).json({ error: 'token required' });
  try {
    const report = Session.get(req.params.id);
    const name = `tiktok-report-${report.username || 'rehearsal'}-${new Date(report.startedAt).toISOString().slice(0, 10)}.csv`;
    res.set('Content-Disposition', `attachment; filename="${name.replace(/[^\w.-]/g, '_')}"`);
    res.type('text/csv; charset=utf-8').send(Session.csv(report));
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// Cached TikTok gift images (public, long cache: file names are gift ids).
app.get('/gift-img/:file', (req, res) => {
  if (!GiftCatalog.IMG_FILE_RE.test(req.params.file)) return res.status(404).end();
  res.sendFile(path.join(GiftCatalog.IMG_DIR, req.params.file), { maxAge: '30d', dotfiles: 'deny' }, (err) => err && !res.headersSent && res.status(404).end());
});

// The control panel itself (so one process serves https://tiktokgg.koydam.com behind nginx).
if (fs.existsSync(path.join(CONFIG.dashboardDir, 'index.html'))) {
  app.use(express.static(CONFIG.dashboardDir, { index: 'index.html', maxAge: '5m' }));
} else {
  app.get('/', (_req, res) => res.type('text').send(`TikTok trigger server — WebSocket at ws://<host>:${CONFIG.port}`));
}
app.use((err, _req, res, _next) => {
  log.error(`HTTP error: ${err.message}`);
  res.status(500).json({ error: 'Internal error' });
});

// ============================================================================
// 13. BOOT + PROCESS SAFETY + GRACEFUL SHUTDOWN
// ============================================================================
Settings.load();
RuleStore.load();
CommandStore.load();
GoalStore.load();
Presets.load();
GiftCatalog.load();
GiftCatalog.onChange((gifts) => Hub.broadcast(MSG.GIFTS, { gifts }));

const server = http.createServer(app);
Hub.attach(server);

server.listen(CONFIG.port, CONFIG.host, () => {
  log.info(`HTTP on http://${CONFIG.host}:${CONFIG.port}  |  WebSocket on ws://${CONFIG.host}:${CONFIG.port} (or /ws)`);
  if (!CONFIG.wsToken) log.warn('WS_TOKEN not set — any client on the network can control the server');
});

server.on('error', (err) => {
  log.error(`Server failed to start: ${err.message}`);
  process.exit(1);
});

// The TikTok connector can reject promises from internal timers; log them instead of crashing.
process.on('unhandledRejection', (reason) => log.error(`Unhandled rejection: ${describeError(reason)}`));

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info(`${signal} received — shutting down`);
  const force = setTimeout(() => process.exit(0), 3_000);
  force.unref();
  try { await TikTok.disconnect(); } catch { /* ignore */ } // also saves the stream report
  GiftCatalog.flush();
  Hub.close();
  server.close(() => process.exit(0));
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
