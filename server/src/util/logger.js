const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

/** Tiny logger with subscribers so logs can be mirrored to the dashboard. */
export function createLogger(level = 'info') {
  const min = LEVELS[level] ?? LEVELS.info;
  const listeners = new Set();

  const write = (lvl, scope, msg, meta) => {
    if (LEVELS[lvl] < min) return;
    const line = `${new Date().toISOString()} ${lvl.toUpperCase().padEnd(5)} [${scope}] ${msg}`;
    (lvl === 'error' ? console.error : lvl === 'warn' ? console.warn : console.log)(line, meta ?? '');
    for (const fn of listeners) {
      try { fn({ level: lvl, scope, msg, ts: Date.now() }); } catch { /* never let a listener break logging */ }
    }
  };

  const scoped = (scope) => ({
    debug: (m, x) => write('debug', scope, m, x),
    info: (m, x) => write('info', scope, m, x),
    warn: (m, x) => write('warn', scope, m, x),
    error: (m, x) => write('error', scope, m, x),
  });

  return { scope: scoped, subscribe: (fn) => (listeners.add(fn), () => listeners.delete(fn)) };
}
