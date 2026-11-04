import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, '..');

// Minimal .env loader (no dependency). Existing env vars win.
const envFile = path.join(serverRoot, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const env = process.env;
const num = (v, d) => (v !== undefined && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : d);

export const config = Object.freeze({
  port: num(env.PORT, 8080),
  host: env.HOST || '0.0.0.0',
  wsPath: '/ws',
  wsToken: env.WS_TOKEN || '',
  connectorPkg: env.TIKTOK_CONNECTOR_PKG || 'tiktok-live-connector',
  signApiKey: env.TIKTOK_SIGN_API_KEY || undefined,
  streakTimeoutMs: num(env.STREAK_TIMEOUT_MS, 30_000),
  reconnect: { maxAttempts: num(env.RECONNECT_MAX_ATTEMPTS, 5), baseDelayMs: 3_000, maxDelayMs: 60_000 },
  dataFile: path.resolve(env.DATA_FILE || path.join(serverRoot, 'data', 'state.json')),
  dashboardDist: path.resolve(serverRoot, '..', 'dashboard', 'dist'),
  feedHistory: 150,
  logLevel: env.LOG_LEVEL || 'info',
});
