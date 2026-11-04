import { EventEmitter } from 'node:events';

/**
 * Known gifts, used only to populate the dashboard's gift picker.
 * Filled from the room's gift list on connect AND learned from live events.
 * Rules never depend on this list — any gift name typed in the dashboard works.
 */
export class GiftCatalog extends EventEmitter {
  #byName = new Map();
  #timer = null;

  constructor(initial = []) {
    super();
    this.merge(initial, { silent: true });
  }

  merge(gifts, { silent = false } = {}) {
    let changed = false;
    for (const g of gifts) {
      if (!g?.name) continue;
      const key = g.name.toLowerCase();
      const prev = this.#byName.get(key);
      const next = {
        id: g.id ?? prev?.id ?? '',
        name: g.name,
        diamonds: g.diamonds || prev?.diamonds || 0,
        image: g.image ?? prev?.image ?? null,
        streakable: g.streakable ?? prev?.streakable ?? false,
      };
      if (!prev || JSON.stringify(prev) !== JSON.stringify(next)) {
        this.#byName.set(key, next);
        changed = true;
      }
    }
    if (changed && !silent) this.#emitSoon();
    return changed;
  }

  learn(gift) {
    this.merge([gift]);
  }

  list() {
    return [...this.#byName.values()].sort((a, b) => a.diamonds - b.diamonds || a.name.localeCompare(b.name));
  }

  #emitSoon() {
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => this.emit('updated', this.list()), 500);
  }
}
