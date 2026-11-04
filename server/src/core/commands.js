import { MSG, Roles } from '../protocol/messages.js';

/**
 * Command handlers keyed by message type. Each returns a result (sent back as `ack`)
 * or throws (sent back as `error`). Dashboard-only unless listed in GAME_ALLOWED.
 */
export function createCommandRouter(ctx) {
  const { hub, engine, bridge, pipeline, simulator, log } = ctx;

  const handlers = {
    [MSG.STATE_REQUEST]: () => ctx.snapshot(),

    [MSG.TIKTOK_CONNECT]: async ({ username }) => bridge.connect(username),
    [MSG.TIKTOK_DISCONNECT]: async () => bridge.disconnect(),

    [MSG.RULES_UPSERT]: ({ rule }) => engine.upsertRule(rule),
    [MSG.RULES_DELETE]: ({ id }) => (engine.deleteRule(id), { id }),
    [MSG.RULES_IMPORT]: ({ rules, replace }) => engine.importRules(rules, { replace: !!replace }),

    [MSG.SETTINGS_PATCH]: ({ patch }) => engine.patchSettings(patch),

    // Fire a game action directly, bypassing rules (button-mash testing).
    [MSG.TEST_ACTION]: ({ action, count, params }) => {
      if (!action || typeof action !== 'string') throw new Error('action is required');
      let p = params ?? {};
      if (typeof p === 'string') p = p.trim() ? JSON.parse(p) : {};
      return pipeline.dispatch({
        action: action.trim(),
        count: Math.max(1, Math.min(10_000, Number(count) || 1)),
        params: p,
        source: { kind: 'manual', simulated: true },
      });
    },

    // Inject a fake TikTok event that runs through streaks + rules exactly like a real one.
    [MSG.TEST_EVENT]: (payload) => (simulator.run(payload), { queued: true }),

    // From game clients
    [MSG.GAME_ACK]: (payload, client) => {
      hub.toDashboards(MSG.GAME_ACK, { ...payload, clientId: client.id, clientName: client.name });
    },
    [MSG.GAME_STATE]: (payload, client) => {
      hub.toDashboards(MSG.GAME_STATE, { state: payload, clientId: client.id, clientName: client.name });
    },
  };

  const GAME_ALLOWED = new Set([MSG.GAME_ACK, MSG.GAME_STATE]);
  const SILENT = new Set([MSG.GAME_ACK, MSG.GAME_STATE]); // no ack spam for high-frequency frames

  return async function route(client, msg) {
    const handler = handlers[msg.type];
    if (!handler) return hub.send(client, MSG.ERROR, { error: `Unknown message type "${msg.type}"` }, msg.id);
    if (client.role === Roles.GAME && !GAME_ALLOWED.has(msg.type)) {
      return hub.send(client, MSG.ERROR, { error: `"${msg.type}" is dashboard-only` }, msg.id);
    }
    try {
      const result = await handler(msg.payload, client);
      if (!SILENT.has(msg.type)) hub.send(client, MSG.ACK, { type: msg.type, result: result ?? null }, msg.id);
    } catch (err) {
      log.warn(`${msg.type} failed: ${err.message}`);
      hub.send(client, MSG.ERROR, { type: msg.type, error: err.message }, msg.id);
    }
  };
}
