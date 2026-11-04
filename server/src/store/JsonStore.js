import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Debounced, atomic JSON persistence (write tmp file -> rename).
 * Rules and settings survive restarts without a database.
 */
export class JsonStore {
  #timer = null;
  #pending = Promise.resolve();

  constructor(file, defaults, log) {
    this.file = file;
    this.defaults = defaults;
    this.log = log;
    this.data = structuredClone(defaults);
  }

  async load() {
    try {
      const parsed = JSON.parse(await fs.readFile(this.file, 'utf8'));
      this.data = { ...structuredClone(this.defaults), ...parsed };
      this.log.info(`Loaded state from ${this.file}`);
    } catch (err) {
      if (err.code !== 'ENOENT') this.log.warn(`Could not read ${this.file}: ${err.message} — starting fresh`);
      this.data = structuredClone(this.defaults);
    }
    return this.data;
  }

  save(delayMs = 250) {
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => this.flush(), delayMs);
  }

  flush() {
    clearTimeout(this.#timer);
    this.#pending = this.#pending.then(async () => {
      try {
        await fs.mkdir(path.dirname(this.file), { recursive: true });
        const tmp = `${this.file}.${process.pid}.tmp`;
        await fs.writeFile(tmp, JSON.stringify(this.data, null, 2));
        await fs.rename(tmp, this.file);
      } catch (err) {
        this.log.error(`Failed to persist state: ${err.message}`);
      }
    });
    return this.#pending;
  }
}
