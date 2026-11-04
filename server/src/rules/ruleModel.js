import { randomUUID } from 'node:crypto';

/**
 * A Rule maps a TikTok event to a game action. Rules live only in data/state.json and are
 * created/edited from the dashboard at runtime — there are no built-in mappings.
 *
 * {
 *   id, name, enabled,
 *   trigger: {
 *     type: 'gift' | 'chat' | 'like' | 'follow' | 'share' | 'member' | 'subscribe',
 *     giftName?:   'Rose' | '*'          (gift)  '*' or empty = any gift
 *     minDiamonds?: number               (gift)  per-unit diamond floor
 *     keyword?:    '!jump'               (chat)
 *     keywordMode?: 'contains' | 'exact' | 'startsWith' | 'regex'
 *     everyLikes?: number                (like)  fire once per N likes
 *   },
 *   action: { name: 'spawn_train', params: { ...free-form JSON for the game } },
 *   streakMode: 'onEnd' | 'perUnit',     gift streaks: fire once when repeatEnd===true, or live per unit
 *   countMode:  'perUnit' | 'perDiamond' | 'once',
 *   multiplier: number,                  count = units * multiplier  (rounded, >= 1)
 *   maxCount:   number,                  hard cap per dispatch (protects the game from 10k-rose combos)
 *   cooldownMs: number,                  per-rule cooldown
 *   userCooldownMs: number,              per-viewer cooldown
 * }
 */

export const TRIGGER_TYPES = ['gift', 'chat', 'like', 'follow', 'share', 'member', 'subscribe'];
export const STREAK_MODES = ['onEnd', 'perUnit'];
export const COUNT_MODES = ['perUnit', 'perDiamond', 'once'];
export const KEYWORD_MODES = ['contains', 'exact', 'startsWith', 'regex'];

const ACTION_NAME = /^[A-Za-z0-9_.:-]{1,64}$/;

const clampNum = (v, min, max, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
};
const oneOf = (v, list, d) => (list.includes(v) ? v : d);

export class RuleValidationError extends Error {}

export function normalizeRule(input = {}, existing = null) {
  const src = { ...(existing ?? {}), ...input };
  const trig = { ...(existing?.trigger ?? {}), ...(input.trigger ?? {}) };
  const act = { ...(existing?.action ?? {}), ...(input.action ?? {}) };

  if (!TRIGGER_TYPES.includes(trig.type)) {
    throw new RuleValidationError(`trigger.type must be one of: ${TRIGGER_TYPES.join(', ')}`);
  }
  const actionName = String(act.name ?? '').trim();
  if (!ACTION_NAME.test(actionName)) {
    throw new RuleValidationError('action.name is required (letters, digits, _ . : - ; max 64 chars)');
  }
  let params = act.params ?? {};
  if (typeof params === 'string') {
    try { params = params.trim() ? JSON.parse(params) : {}; } catch { throw new RuleValidationError('action.params is not valid JSON'); }
  }
  if (typeof params !== 'object' || Array.isArray(params) || params === null) {
    throw new RuleValidationError('action.params must be a JSON object');
  }

  const trigger = { type: trig.type };
  if (trig.type === 'gift') {
    trigger.giftName = String(trig.giftName ?? '').trim() || '*';
    trigger.minDiamonds = clampNum(trig.minDiamonds, 0, 1e7, 0);
  } else if (trig.type === 'chat') {
    trigger.keyword = String(trig.keyword ?? '').trim();
    trigger.keywordMode = oneOf(trig.keywordMode, KEYWORD_MODES, 'contains');
    if (!trigger.keyword) throw new RuleValidationError('chat rules need a keyword');
    if (trigger.keywordMode === 'regex') {
      try { new RegExp(trigger.keyword, 'i'); } catch (e) { throw new RuleValidationError(`Invalid regex: ${e.message}`); }
    }
  } else if (trig.type === 'like') {
    trigger.everyLikes = Math.round(clampNum(trig.everyLikes, 1, 1e6, 100));
  }

  const now = Date.now();
  return {
    id: existing?.id ?? (typeof src.id === 'string' && src.id ? src.id : randomUUID()),
    name: String(src.name ?? '').trim().slice(0, 80) || `${trigger.giftName ?? trigger.keyword ?? trigger.type} → ${actionName}`,
    enabled: src.enabled !== false,
    trigger,
    action: { name: actionName, params },
    streakMode: oneOf(src.streakMode, STREAK_MODES, 'onEnd'),
    countMode: oneOf(src.countMode, COUNT_MODES, 'perUnit'),
    multiplier: clampNum(src.multiplier, 0, 1000, 1),
    maxCount: Math.round(clampNum(src.maxCount, 1, 10_000, 100)),
    cooldownMs: Math.round(clampNum(src.cooldownMs, 0, 3_600_000, 0)),
    userCooldownMs: Math.round(clampNum(src.userCooldownMs, 0, 3_600_000, 0)),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

/** Game tuning values. Free-form: the dashboard can add any numeric/boolean/string key. */
export const DEFAULT_SETTINGS = Object.freeze({
  paused: false, // when true, no rules fire (manual test actions still work)
  difficulty: 1,
  speedMultiplier: 1,
  obstacleDensity: 1,
  spawnRateMultiplier: 1,
});

const SETTING_KEY = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;

/** Validates a settings patch. `null` deletes a custom key. */
export function applySettingsPatch(current, patch = {}) {
  const next = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (!SETTING_KEY.test(key)) throw new RuleValidationError(`Invalid setting key "${key}"`);
    if (value === null) {
      if (key in DEFAULT_SETTINGS) next[key] = DEFAULT_SETTINGS[key];
      else delete next[key];
      continue;
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new RuleValidationError(`Setting "${key}" must be finite`);
      next[key] = Math.min(1e6, Math.max(-1e6, value));
    } else if (typeof value === 'boolean' || typeof value === 'string') {
      next[key] = typeof value === 'string' ? value.slice(0, 200) : value;
    } else {
      throw new RuleValidationError(`Setting "${key}" must be a number, boolean or string`);
    }
  }
  return next;
}
