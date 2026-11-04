# tiktokGame: a self-hosted control platform for TikTok LIVE games

```
 TikTok LIVE ──► tiktok-live-connector ──► normalize ──► GiftStreakTracker ──► RuleEngine ──► game.action
                    (server/src/tiktok)                    (repeatEnd logic)     (your rules)        │
                                                                                                      ▼
   React Dashboard  ◄──────────── WebSocket hub  ws://host:8080/ws ────────────►  Game clients
   (connect, rules, tuning,          (role: dashboard | game)                     Unity / Web / Flutter
    live feed, test console)
```

* **No built-in gift mappings.** Rules start empty. You create, edit, toggle or delete them from the dashboard during a stream. Changes apply straight away and are saved to `server/data/state.json`.
* **Gift streaks handled properly.** Each rule either fires **once when the streak ends** (`repeatEnd === true`, with the full combo count) or **live for each new gift** in the combo (it works out the change from TikTok's running `repeatCount`). If a streak never sends `repeatEnd`, the server closes it after a timeout so payouts aren't lost.
* **Works with tiktok-live-connector v2.x** (the current version) and with v1/legacy `WebcastPushConnection` forks. Set `TIKTOK_CONNECTOR_PKG` to switch.

## Layout

```
tiktokGame/
├── server/                 Node.js WebSocket server
│   ├── src/index.js            composition root (wires everything)
│   ├── src/config.js           env config (.env supported)
│   ├── src/tiktok/             TikTokBridge (connection + reconnect), normalize, GiftStreakTracker, GiftCatalog, Simulator
│   ├── src/rules/              ruleModel (validation), RuleEngine (matching, cooldowns, multipliers)
│   ├── src/core/               EventPipeline (event → rules → broadcast), commands (dashboard API)
│   ├── src/ws/Hub.js           client roles, heartbeat, token auth, broadcast
│   ├── src/http/httpServer.js  serves dashboard build, /demo, /schema, /api/health
│   └── test/                   node:test unit tests (streaks, rules, normalizer)
├── dashboard/              React + Vite control panel
├── schema/                 protocol.schema.json (JSON Schema) + PROTOCOL.md
├── clients/
│   ├── web/GameListener.js     JS listener (browser / Electron / Node)
│   ├── web/index.html          playable demo game "Lane Rush" (served at /demo)
│   └── unity/                  TikTokGameListener.cs + TrainGameExample.cs
├── express-server/         single-file Express + ws trigger server (server.js), a simpler alternative to server/
└── web-dashboard/          single-file Vue 3 + Tailwind control panel (index.html), published to tiktokgg.koydam.com
```

There are two ways to run it:

| | Server | Dashboard | Protocol |
|---|---|---|---|
| **Lite** | `express-server/server.js` | `web-dashboard/index.html` (hosted at https://tiktokgg.koydam.com) | `CONNECT_TIKTOK`, `UPDATE_RULES`, `TEST_TRIGGER` → `GAME_EVENT` |
| **Full** | `server/` | `dashboard/` (React, served by the server) | `schema/PROTOCOL.md` |

### Lite setup (hosted dashboard)

On the streaming PC, start the server:

```bash
cd express-server
```

```bash
npm install
```

```bash
ALLOWED_ORIGINS=https://tiktokgg.koydam.com npm start
```

Then open https://tiktokgg.koydam.com. It connects to `ws://localhost:8080` (you can change this under ⚙ next to "server"). Chrome, Edge and Firefox let an HTTPS page talk to `ws://localhost`; Safari doesn't, so use one of the others or open `web-dashboard/index.html` from disk. `ALLOWED_ORIGINS` stops other websites you visit from controlling your local server.

### Deploying the dashboard
`.github/workflows/pages.yml` publishes `web-dashboard/` to GitHub Pages on every push to `main` that changes it. One-time setup:
1. Repo **Settings → Pages → Source: GitHub Actions**. Set **Custom domain** to `tiktokgg.koydam.com` and tick **Enforce HTTPS** once the certificate is ready.
2. At your DNS host for koydam.com, add `CNAME  tiktokgg  →  <github-user>.github.io`.

## Quick start

You need Node 18.17 or newer.

```bash
cd tiktokGame
```

```bash
npm install
```

```bash
npm start
```

`npm start` builds the dashboard and starts the server. Then open:
* Dashboard: <http://localhost:8080>
* Demo game: <http://localhost:8080/demo> (open it in another tab or window, or capture it in OBS)

For development with hot reload, run these in two terminals:

```bash
npm run server:dev
```

```bash
npm run dashboard
```

The second command opens the dashboard on <http://localhost:5173>, which proxies `/ws` to `:8080`.

### First show checklist
1. Open the demo game, or press Play in Unity. The **🕹 1 game** badge appears, and the game's action names show up in the action picker.
2. **+ New rule**: Gift `Rose` → action `spawn_train`, streak mode *fire once when the streak ends*.
3. **Test console → Simulate viewer**: gift `Rose`, count 10, combo on. The feed shows the combo building up, and the game receives `spawn_train ×10` once.
4. Enter your TikTok username and press **Connect** (you must be LIVE).
5. Change speed and difficulty with the sliders while live. Each change is sent to the game as `game.settings`.

## Configuration (`server/.env`, see `.env.example`)

| var | default | notes |
|---|---|---|
| `PORT` / `HOST` | `8080` / `0.0.0.0` | |
| `WS_TOKEN` | *(empty)* | When set, every client must connect with `?token=`. Open the dashboard as `http://host:8080/?token=XYZ` (it's remembered after that). |
| `TIKTOK_SIGN_API_KEY` | | Euler Stream key, recommended for connector v2 to avoid sign rate limits |
| `TIKTOK_CONNECTOR_PKG` | `tiktok-live-connector` | e.g. `@ycryptx/tiktok-live-connector` (install it in `server/` first) |
| `STREAK_TIMEOUT_MS` | `30000` | How long to wait before force-closing a streak that never ended |
| `DATA_FILE` | `server/data/state.json` | Where rules, settings and the gift catalogue are saved |

## Rules

| field | meaning |
|---|---|
| trigger | `gift` (name, id, or `*` for any gift, plus optional min diamonds), `chat` (keyword: contains / startsWith / exact / regex), `like` (every N likes, accumulated), `follow`, `share`, `member`, `subscribe` |
| action | `name` and free-form JSON `params` that are passed through to the game |
| streakMode | `onEnd` (wait for `repeatEnd`) or `perUnit` (fire during the combo) |
| countMode | `perUnit`, `perDiamond` (gift count × diamonds), or `once` |
| multiplier / maxCount | count = units × multiplier, capped at maxCount (stops a 10,000-rose combo from flooding the game) |
| cooldownMs / userCooldownMs | anti-spam, per rule and per viewer |

Several rules can match the same event (for example, Rose → `spawn_train` at the end of the streak *and* Rose → `speed_boost` live). The global **Pause rules** switch stops every rule from firing but still shows events in the feed. Manual test actions keep working while paused.

Use Export/Import in the rules panel to save a rule set per game or per show as JSON.

## Writing a game client

Read [`schema/PROTOCOL.md`](schema/PROTOCOL.md). In short:

```js
import { TikTokGameListener } from './GameListener.js';
const tt = new TikTokGameListener({ url: 'ws://localhost:8080/ws', name: 'My Game' });
tt.on('spawn_train', ({ count, params, source }) => spawnTrains(count, params));
tt.onSettings((s) => (world.speed = BASE * s.speedMultiplier));
tt.connect();
```

**Unity:** copy `clients/unity/*.cs` into `Assets/`, add the `com.unity.nuget.newtonsoft-json` package, put `TikTokGameListener` on a GameObject, then either bind actions in the Inspector or call `Register("spawn_train", a => …)`. Callbacks run on the main thread. WebGL builds need a WebGL WebSocket plugin, or use the JS client instead.

**Flutter / anything else:** open a WebSocket and send
`{"v":1,"type":"hello","id":"1","ts":0,"payload":{"role":"game","name":"Flutter","actions":["spawn_train"]}}`,
then handle the `game.action` and `game.settings` frames as described in the schema.

## Tests

```bash
npm test
```

The tests cover the v2 payload normalizer, streak deltas and totals, the synthetic end on timeout, `onEnd` vs `perUnit` firing, like thresholds, pausing, and validation.

## Notes
* `processInitialData: false` is set so connecting mid-stream never replays old gifts as new triggers.
* TikTok's unofficial webcast API changes from time to time. If connecting starts failing, update the connector with `npm --workspace server i tiktok-live-connector@latest`. All the version-specific field handling lives in `server/src/tiktok/normalize.js`.
