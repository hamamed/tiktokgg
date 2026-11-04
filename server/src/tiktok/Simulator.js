import { normalizeChat, normalizeGift, normalizeLike, normalizeSimple } from './normalize.js';

/**
 * Fakes TikTok events from the dashboard's Test panel. Events go through the SAME normalizer,
 * streak tracker and rule engine as real ones, so you can rehearse a whole show offline.
 */
export class Simulator {
  #timers = new Set();

  constructor({ emit, catalog }) {
    this.emit = emit; // (normalizedEvent) => void
    this.catalog = catalog;
  }

  #user(p) {
    const uniqueId = String(p.username || `tester_${Math.floor(Math.random() * 900 + 100)}`);
    return { userId: `sim-${uniqueId}`, uniqueId, nickname: p.nickname || uniqueId };
  }

  run(p = {}) {
    const user = this.#user(p);
    switch (p.type) {
      case 'gift':
        return this.#gift(p, user);
      case 'chat':
        return this.emit({ ...normalizeChat({ ...user, comment: String(p.comment ?? '') }), ts: Date.now() });
      case 'like':
        return this.emit({ ...normalizeLike({ ...user, likeCount: Number(p.likeCount) || 1 }), ts: Date.now() });
      case 'follow':
      case 'share':
      case 'member':
      case 'subscribe':
        return this.emit({ ...normalizeSimple(p.type)(user), ts: Date.now() });
      default:
        throw new Error(`Unknown simulated event type "${p.type}"`);
    }
  }

  #gift(p, user) {
    const name = String(p.giftName || '').trim();
    if (!name) throw new Error('giftName is required');
    const known = this.catalog.list().find((g) => g.name.toLowerCase() === name.toLowerCase());
    const count = Math.max(1, Math.min(500, Number(p.count) || 1));
    const streakable = p.streak ?? known?.streakable ?? true;
    const base = {
      ...user,
      giftId: known?.id || `sim-${name.toLowerCase()}`,
      giftName: known?.name || name,
      diamondCount: Number(p.diamonds) || known?.diamonds || 1,
      giftPictureUrl: known?.image,
      giftType: streakable ? 1 : 0,
    };
    const send = (repeatCount, repeatEnd) => this.emit({ ...normalizeGift({ ...base, repeatCount, repeatEnd }), ts: Date.now() });

    if (!streakable) return send(count, true);

    // Realistic combo: 1..N with repeatEnd=false, then the final repeatEnd=true event.
    const interval = Math.max(20, Number(p.intervalMs) || 120);
    for (let i = 1; i <= count; i++) {
      const t = setTimeout(() => {
        this.#timers.delete(t);
        send(i, false);
        if (i === count) {
          const end = setTimeout(() => (this.#timers.delete(end), send(count, true)), interval);
          this.#timers.add(end);
        }
      }, (i - 1) * interval);
      this.#timers.add(t);
    }
  }

  stopAll() {
    for (const t of this.#timers) clearTimeout(t);
    this.#timers.clear();
  }
}
