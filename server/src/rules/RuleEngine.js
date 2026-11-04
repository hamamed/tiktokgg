import { EventEmitter } from 'node:events';
import { applySettingsPatch, normalizeRule, RuleValidationError } from './ruleModel.js';

/**
 * Holds the live rule set + game settings and evaluates normalized TikTok events against it.
 * All mutations persist via the store and emit 'rules' / 'settings' so every dashboard and
 * game client is updated instantly — reconfigure mid-stream with no restart.
 */
export class RuleEngine extends EventEmitter {
  #likeAcc = new Map(); // ruleId -> leftover likes below threshold
  #lastFired = new Map(); // ruleId -> ts
  #lastFiredUser = new Map(); // `${ruleId}:${userId}` -> ts
  #regexCache = new Map();

  constructor(store) {
    super();
    this.store = store;
  }

  get rules() {
    return this.store.data.rules;
  }
  get settings() {
    return this.store.data.settings;
  }

  // ---------- mutations ----------
  upsertRule(input) {
    const idx = input?.id ? this.rules.findIndex((r) => r.id === input.id) : -1;
    const rule = normalizeRule(input, idx >= 0 ? this.rules[idx] : null);
    if (idx >= 0) this.rules[idx] = rule;
    else this.rules.push(rule);
    this.#likeAcc.delete(rule.id);
    this.#regexCache.delete(rule.id);
    this.#commitRules();
    return rule;
  }

  deleteRule(id) {
    const before = this.rules.length;
    this.store.data.rules = this.rules.filter((r) => r.id !== id);
    if (this.rules.length === before) throw new RuleValidationError(`Rule ${id} not found`);
    this.#likeAcc.delete(id);
    this.#commitRules();
  }

  importRules(list, { replace = false } = {}) {
    if (!Array.isArray(list)) throw new RuleValidationError('rules must be an array');
    const normalized = list.map((r) => normalizeRule({ ...r, id: replace ? r.id : undefined }));
    this.store.data.rules = replace ? normalized : [...this.rules, ...normalized];
    this.#likeAcc.clear();
    this.#regexCache.clear();
    this.#commitRules();
    return this.rules;
  }

  patchSettings(patch) {
    this.store.data.settings = applySettingsPatch(this.settings, patch);
    this.store.save();
    this.emit('settings', this.settings);
    return this.settings;
  }

  #commitRules() {
    this.store.save();
    this.emit('rules', this.rules);
  }

  /** Every action name referenced by a rule (merged with game-advertised actions for the UI). */
  actionNames() {
    return [...new Set(this.rules.map((r) => r.action.name))];
  }

  // ---------- evaluation ----------
  /**
   * @param evt normalized event; gift events carry evt.streak = { phase, delta, total }
   * @returns {{ rule, count, units }[]} dispatches
   */
  evaluate(evt, now = Date.now()) {
    if (this.settings.paused) return [];
    const out = [];

    for (const rule of this.rules) {
      if (!rule.enabled || rule.multiplier === 0 || rule.trigger.type !== evt.type) continue;

      const units = this.#units(rule, evt);
      if (units <= 0) continue;

      if (rule.cooldownMs && now - (this.#lastFired.get(rule.id) ?? 0) < rule.cooldownMs) continue;
      const userKey = `${rule.id}:${evt.user?.userId}`;
      if (rule.userCooldownMs && now - (this.#lastFiredUser.get(userKey) ?? 0) < rule.userCooldownMs) continue;

      let count;
      if (rule.countMode === 'once') count = 1;
      else {
        const base = rule.countMode === 'perDiamond' && evt.type === 'gift' ? units * Math.max(1, evt.gift.diamonds) : units;
        count = Math.max(1, Math.round(base * rule.multiplier));
      }
      count = Math.min(rule.maxCount, count);

      this.#lastFired.set(rule.id, now);
      if (rule.userCooldownMs) this.#lastFiredUser.set(userKey, now);
      out.push({ rule, count, units });
    }
    return out;
  }

  /** How many trigger "units" this event represents for this rule (0 = no match). */
  #units(rule, evt) {
    const t = rule.trigger;
    switch (evt.type) {
      case 'gift': {
        const name = t.giftName;
        if (name && name !== '*' && name.toLowerCase() !== evt.gift.name.toLowerCase() && name !== evt.gift.id) return 0;
        if (t.minDiamonds && evt.gift.diamonds < t.minDiamonds) return 0;
        const s = evt.streak;
        // perUnit: react live to each new unit of a combo. onEnd: wait for repeatEnd === true.
        if (rule.streakMode === 'perUnit') return s.delta;
        return s.phase === 'progress' ? 0 : s.total;
      }
      case 'chat':
        return this.#matchChat(rule, evt.comment) ? 1 : 0;
      case 'like': {
        const n = t.everyLikes || 1;
        const acc = (this.#likeAcc.get(rule.id) ?? 0) + evt.likeCount;
        this.#likeAcc.set(rule.id, acc % n);
        return Math.floor(acc / n);
      }
      default:
        return 1;
    }
  }

  #matchChat(rule, comment) {
    const { keyword, keywordMode } = rule.trigger;
    const text = comment.trim().toLowerCase();
    const kw = keyword.toLowerCase();
    switch (keywordMode) {
      case 'exact':
        return text === kw;
      case 'startsWith':
        return text.startsWith(kw);
      case 'regex': {
        let re = this.#regexCache.get(rule.id);
        if (!re) this.#regexCache.set(rule.id, (re = new RegExp(keyword, 'i')));
        return re.test(comment);
      }
      default:
        return text.includes(kw);
    }
  }
}
