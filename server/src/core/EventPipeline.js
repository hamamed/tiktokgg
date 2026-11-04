import { randomUUID } from 'node:crypto';
import { MSG } from '../protocol/messages.js';

/**
 * The heart of the platform:
 *
 *   TikTok/Simulator ─► normalize ─► streak tracker ─► rule engine ─► game.action broadcast
 *                                   └──────────────► tiktok.event to dashboards (live feed)
 */
export class EventPipeline {
  #feed = [];

  constructor({ engine, tracker, catalog, hub, log, historySize = 150 }) {
    Object.assign(this, { engine, tracker, catalog, hub, log, historySize });
    // Streaks that never got repeatEnd are closed by the tracker; evaluate them as 'end'.
    tracker.on('timeout', (evt) => {
      this.log.debug(`Streak timed out: ${evt.gift.name} x${evt.streak.total} from @${evt.user.uniqueId}`);
      this.#process({ ...evt, id: randomUUID(), ts: Date.now() });
    });
  }

  get feed() {
    return this.#feed;
  }

  /** Entry point for every incoming event (real or simulated). */
  ingest(evt, { simulated = false } = {}) {
    const e = { ...evt, id: randomUUID(), ts: evt.ts ?? Date.now(), simulated };
    if (e.type === 'gift') {
      e.streak = this.tracker.process(e);
      this.catalog.learn({ id: e.gift.id, name: e.gift.name, diamonds: e.gift.diamonds, image: e.gift.image, streakable: e.gift.streakable });
    }
    this.#process(e);
  }

  #process(e) {
    this.#remember(e);
    this.hub.toDashboards(MSG.TIKTOK_EVENT, e);

    for (const { rule, count, units } of this.engine.evaluate(e)) {
      this.dispatch({
        action: rule.action.name,
        params: rule.action.params,
        count,
        source: {
          kind: e.type,
          ruleId: rule.id,
          ruleName: rule.name,
          eventId: e.id,
          simulated: e.simulated,
          units,
          user: e.user,
          ...(e.type === 'gift' && {
            gift: { id: e.gift.id, name: e.gift.name, diamonds: e.gift.diamonds, image: e.gift.image, repeatCount: e.streak.total, phase: e.streak.phase },
          }),
          ...(e.type === 'chat' && { comment: e.comment }),
          ...(e.type === 'like' && { likeCount: e.likeCount }),
        },
      });
    }
  }

  /** Build + broadcast a game.action (also used by manual test triggers). */
  dispatch({ action, params = {}, count = 1, source }) {
    const payload = {
      actionId: randomUUID(),
      action,
      count,
      params,
      settings: this.engine.settings,
      source: source ?? { kind: 'manual' },
    };
    const deliveredTo = this.hub.toGames(MSG.GAME_ACTION, payload);
    this.hub.toDashboards(MSG.ACTION_DISPATCHED, { ...payload, deliveredTo, ts: Date.now() });
    if (!deliveredTo) this.log.debug(`"${action}" dispatched but no game client is connected`);
    return payload;
  }

  #remember(e) {
    // Collapse in-progress streak updates so history holds one row per combo.
    if (e.type === 'gift' && e.streak?.key) {
      const i = this.#feed.findIndex((x) => x.streak?.key === e.streak.key && x.streak.phase === 'progress');
      if (i >= 0) this.#feed.splice(i, 1);
    }
    this.#feed.unshift(e);
    if (this.#feed.length > this.historySize) this.#feed.length = this.historySize;
  }
}
