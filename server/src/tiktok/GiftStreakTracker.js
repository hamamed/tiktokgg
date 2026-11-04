import { EventEmitter } from 'node:events';

/**
 * Turns TikTok's cumulative gift-streak events into explicit phases.
 *
 * TikTok sends a streakable gift (giftType 1) as N events: repeatCount = 1, 2, 3 ... with
 * repeatEnd === false, then a final event with repeatEnd === true carrying the total.
 * Non-streakable gifts arrive once, already final.
 *
 * process() annotates every gift with:
 *   phase: 'progress' | 'end' | 'single'
 *   delta: how many NEW units this specific event represents (for live, per-unit reactions)
 *   total: cumulative count of the streak so far (the final count when phase === 'end')
 *
 * Rules then choose: fire once at the end (total) or react live per unit (delta).
 * Streaks that never receive repeatEnd (dropped packet, viewer left) are force-closed after
 * `timeoutMs` and emitted as a synthetic 'end' via the 'timeout' event so "on end" rules still fire.
 */
export class GiftStreakTracker extends EventEmitter {
  #streaks = new Map(); // key -> { total, lastSeen, event }
  #sweeper;

  constructor({ timeoutMs = 30_000 } = {}) {
    super();
    this.timeoutMs = timeoutMs;
    this.#sweeper = setInterval(() => this.sweep(), Math.min(5_000, timeoutMs)).unref();
  }

  static keyOf(evt) {
    return `${evt.user.userId}:${evt.gift.id}`;
  }

  process(evt) {
    const { gift } = evt;
    if (!gift.streakable) {
      return { phase: 'single', delta: gift.repeatCount, total: gift.repeatCount, key: null };
    }

    const key = GiftStreakTracker.keyOf(evt);
    const prev = this.#streaks.get(key);
    const prevTotal = prev?.total ?? 0;
    // repeatCount going backwards means TikTok started a fresh streak without closing the old one.
    const delta = gift.repeatCount >= prevTotal ? gift.repeatCount - prevTotal : gift.repeatCount;

    if (gift.repeatEnd) {
      this.#streaks.delete(key);
      return { phase: 'end', delta, total: gift.repeatCount, key };
    }

    this.#streaks.set(key, { total: gift.repeatCount, lastSeen: Date.now(), event: evt });
    return { phase: 'progress', delta, total: gift.repeatCount, key };
  }

  sweep(now = Date.now()) {
    for (const [key, s] of this.#streaks) {
      if (now - s.lastSeen < this.timeoutMs) continue;
      this.#streaks.delete(key);
      this.emit('timeout', {
        ...s.event,
        gift: { ...s.event.gift, repeatEnd: true },
        streak: { phase: 'end', delta: 0, total: s.total, key, synthetic: true },
      });
    }
  }

  get activeCount() {
    return this.#streaks.size;
  }

  clear() {
    this.#streaks.clear();
  }

  dispose() {
    clearInterval(this.#sweeper);
    this.clear();
  }
}
