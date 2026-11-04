import { randomUUID } from 'node:crypto';

/**
 * Wire protocol shared by the server, dashboard and game clients.
 * Formal JSON Schema: /schema/protocol.schema.json — human docs: /schema/PROTOCOL.md
 *
 * Every frame is an envelope: { v, type, id, ts, payload, replyTo? }
 */
export const PROTOCOL_VERSION = 1;

export const Roles = Object.freeze({ DASHBOARD: 'dashboard', GAME: 'game' });

export const MSG = Object.freeze({
  // handshake / generic
  HELLO: 'hello', // client -> server  { role, name, actions?[] }
  WELCOME: 'welcome', // server -> client  { clientId, role, protocol }
  ACK: 'ack', // server -> client  reply to a command
  ERROR: 'error', // server -> client  reply to a bad command

  // server -> game
  GAME_ACTION: 'game.action',
  GAME_SETTINGS: 'game.settings',
  // game -> server
  GAME_ACK: 'game.ack',
  GAME_STATE: 'game.state',

  // server -> dashboard
  STATE_SNAPSHOT: 'state.snapshot',
  TIKTOK_STATUS: 'tiktok.status',
  TIKTOK_EVENT: 'tiktok.event',
  RULES_UPDATED: 'rules.updated',
  SETTINGS_UPDATED: 'settings.updated',
  GIFTS_UPDATED: 'gifts.updated',
  CLIENTS_UPDATED: 'clients.updated',
  ACTIONS_UPDATED: 'actions.updated',
  ACTION_DISPATCHED: 'action.dispatched',
  LOG: 'log',

  // dashboard -> server (commands)
  STATE_REQUEST: 'state.request',
  TIKTOK_CONNECT: 'tiktok.connect',
  TIKTOK_DISCONNECT: 'tiktok.disconnect',
  RULES_UPSERT: 'rules.upsert',
  RULES_DELETE: 'rules.delete',
  RULES_IMPORT: 'rules.import',
  SETTINGS_PATCH: 'settings.patch',
  TEST_ACTION: 'test.action',
  TEST_EVENT: 'test.event',
});

export function envelope(type, payload = {}, extra = {}) {
  return { v: PROTOCOL_VERSION, type, id: randomUUID(), ts: Date.now(), payload, ...extra };
}

/** Parse + structurally validate an inbound frame. Never throws. */
export function parseMessage(raw) {
  let msg;
  try {
    msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8'));
  } catch {
    return { ok: false, error: 'Invalid JSON' };
  }
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return { ok: false, error: 'Frame must be a JSON object' };
  if (typeof msg.type !== 'string' || !msg.type) return { ok: false, error: 'Missing "type"' };
  if (msg.payload === undefined) msg.payload = {};
  if (typeof msg.payload !== 'object' || msg.payload === null || Array.isArray(msg.payload)) {
    return { ok: false, error: '"payload" must be an object' };
  }
  return { ok: true, msg };
}
