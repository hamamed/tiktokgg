import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { createLogger } from './util/logger.js';
import { JsonStore } from './store/JsonStore.js';
import { RuleEngine } from './rules/RuleEngine.js';
import { DEFAULT_SETTINGS } from './rules/ruleModel.js';
import { TikTokBridge } from './tiktok/TikTokBridge.js';
import { GiftStreakTracker } from './tiktok/GiftStreakTracker.js';
import { GiftCatalog } from './tiktok/GiftCatalog.js';
import { Simulator } from './tiktok/Simulator.js';
import { EventPipeline } from './core/EventPipeline.js';
import { createCommandRouter } from './core/commands.js';
import { createHttpServer } from './http/httpServer.js';
import { Hub } from './ws/Hub.js';
import { MSG, Roles } from './protocol/messages.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const logger = createLogger(config.logLevel);
const log = logger.scope('server');

// ---- state (rules start EMPTY: every mapping is created from the dashboard) ----
const store = new JsonStore(config.dataFile, { rules: [], settings: { ...DEFAULT_SETTINGS }, gifts: [], lastUsername: '' }, logger.scope('store'));
await store.load();

const engine = new RuleEngine(store);
const catalog = new GiftCatalog(store.data.gifts);
const tracker = new GiftStreakTracker({ timeoutMs: config.streakTimeoutMs });
const bridge = new TikTokBridge({ connectorPkg: config.connectorPkg, signApiKey: config.signApiKey, reconnect: config.reconnect, log: logger.scope('tiktok') });

const snapshot = () => ({
  tiktok: bridge.status,
  rules: engine.rules,
  settings: engine.settings,
  gifts: catalog.list(),
  clients: hub.listClients(),
  knownActions: knownActions(),
  feed: pipeline.feed,
  lastUsername: store.data.lastUsername,
});
const knownActions = () => [...new Set([...hub.gameActions(), ...engine.actionNames()])].sort();

// ---- transport ----
const server = createHttpServer({
  dashboardDist: config.dashboardDist,
  extraStatic: { '/demo': path.join(projectRoot, 'clients', 'web'), '/schema': path.join(projectRoot, 'schema') },
  getState: () => ({ tiktok: bridge.status, rules: engine.rules, settings: engine.settings, clients: hub.listClients() }),
});
const hub = new Hub({ server, path: config.wsPath, token: config.wsToken, log: logger.scope('ws') });
const pipeline = new EventPipeline({ engine, tracker, catalog, hub, log: logger.scope('pipeline'), historySize: config.feedHistory });
const simulator = new Simulator({ emit: (e) => pipeline.ingest(e, { simulated: true }), catalog });
const route = createCommandRouter({ hub, engine, bridge, pipeline, simulator, log: logger.scope('cmd'), snapshot });

// ---- wiring ----
bridge.on('event', (e) => pipeline.ingest(e));
bridge.on('gifts', (gifts) => catalog.merge(gifts));
bridge.on('status', (s) => {
  hub.toDashboards(MSG.TIKTOK_STATUS, s);
  if (s.state === 'connected' && s.username !== store.data.lastUsername) {
    store.data.lastUsername = s.username;
    store.save();
  }
  if (s.state === 'disconnected' || s.state === 'ended') tracker.clear();
});
catalog.on('updated', (gifts) => {
  store.data.gifts = gifts;
  store.save(2_000);
  hub.toDashboards(MSG.GIFTS_UPDATED, gifts);
});
engine.on('rules', (rules) => {
  hub.toDashboards(MSG.RULES_UPDATED, rules);
  hub.toDashboards(MSG.ACTIONS_UPDATED, knownActions());
});
engine.on('settings', (settings) => {
  hub.toDashboards(MSG.SETTINGS_UPDATED, settings);
  hub.toGames(MSG.GAME_SETTINGS, settings);
});

hub.on('hello', (client) => {
  if (client.role === Roles.DASHBOARD) hub.send(client, MSG.STATE_SNAPSHOT, snapshot());
  if (client.role === Roles.GAME) hub.send(client, MSG.GAME_SETTINGS, engine.settings);
});
hub.on('clients', (clients) => {
  hub.toDashboards(MSG.CLIENTS_UPDATED, clients);
  hub.toDashboards(MSG.ACTIONS_UPDATED, knownActions());
});
hub.on('message', route);
logger.subscribe((entry) => entry.level !== 'debug' && hub.toDashboards(MSG.LOG, entry));

server.listen(config.port, config.host, () => {
  log.info(`HTTP + WebSocket listening on http://${config.host}:${config.port}  (ws path ${config.wsPath})`);
  log.info(`Rules loaded: ${engine.rules.length}  |  auth: ${config.wsToken ? 'token required' : 'OPEN (set WS_TOKEN to secure)'}`);
});

// ---- graceful shutdown ----
let closing = false;
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    if (closing) return process.exit(1);
    closing = true;
    log.info('Shutting down…');
    simulator.stopAll();
    tracker.dispose();
    await bridge.disconnect({ silent: true });
    await store.flush();
    hub.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2_000).unref();
  });
}
