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
├── web-dashboard/          control panel (index.html), stream page (play.html), phone remote (remote.html) and games/*.js, served by express-server
└── deploy/                 install.sh / update.sh for the VPS (tiktokgg.koydam.com)
```

There are two ways to run it:

| | Server | Dashboard | Protocol |
|---|---|---|---|
| **Lite** | `express-server/server.js` | `web-dashboard/index.html` (served by the server; live at https://tiktokgg.koydam.com) | `CONNECT_TIKTOK`, `UPDATE_RULES`, `TEST_TRIGGER` → `GAME_EVENT` |
| **Full** | `server/` | `dashboard/` (React, served by the server) | `schema/PROTOCOL.md` |

### Lite setup on a VPS (https://tiktokgg.koydam.com)

The VPS runs `express-server/server.js` as the `tiktokgg` service. It serves the dashboard at `/`, the WebSocket at `/ws`, and connects to TikTok itself, just like the `tiktok.koydam.com` panel.

1. At your DNS host, add **one A record**: `tiktokgg → 46.224.86.198`. Delete any CNAME to `github.io`.
2. On the VPS (as root):

```bash
curl -fsSL https://raw.githubusercontent.com/hamamed/tiktokgg/main/deploy/install.sh | sudo DOMAIN=tiktokgg.koydam.com EMAIL=admin@koydam.com bash
```

The installer runs the server on `127.0.0.1` (a free port in 3200-3299) and adds **one** nginx/Apache/Caddy site for the domain, with HTTPS from Let's Encrypt. It doesn't touch your other sites. At the end it prints an **access token** and a link `https://tiktokgg.koydam.com/?token=…`. Open that link once and the browser remembers the token.

* Game clients connect to `wss://tiktokgg.koydam.com/ws?token=…`
* The stream page is `https://tiktokgg.koydam.com/play.html?token=…&obs=1`. Add it to OBS once as a Browser Source (1080×1920, tick **Control audio via OBS**). It always shows the game you pick in the dashboard and switches by itself. The old `game.html` link still works and redirects there
* Update: `sudo bash /opt/tiktokgg/deploy/update.sh`
* Logs: `journalctl -u tiktokgg -f`
* New token: `sudo NEW_TOKEN=1 bash /opt/tiktokgg/deploy/install.sh`
* Settings (port, token, allowed origins) are in `/etc/tiktokgg/env`

**Gifts:** the dashboard shows every TikTok gift with its real image. Tap a gift to choose what it does in the game. Press **Load TikTok gifts** while you're connected, or enter any account that is LIVE right now. On the VPS the installer also copies the gift list and images that `koydam-tiktok` has already downloaded (`/opt/koydam-tiktok/data`).

**Games** (`web-dashboard/games/`, listed in `games/catalog.json`). Each game keeps its own gifts, chat commands, like goals and options:

| Game | Viewers… |
|---|---|
| Gift Runner | make a self-driving car's ride harder (barriers, mud, boss) or easier (heal, slow) |
| Tug of War | pull a rope for red or blue (`!red` / `!blue` are free small pulls); freezes and an underdog boost |
| Tower Race | stack blocks for their team; wind knocks the other tower down |
| Castle Defense | send monsters and ogres, or defend with arrows (`!fire`), shields, repairs and the dragon |
| Boat Storm | bring waves, lightning and a whale, or sail boosts (`!row`), repairs and calm sea |
| Spin the Wheel | spin a prize wheel you fill in Settings ("10 push-ups", "Sing a song"…) |
| Bomb Pass | join with `!join`; gifts pass a ticking bomb or add time; last player standing wins |
| Claw Machine | drop a claw to grab a prize; bigger gifts grab better |
| Fish Catch | cast for fish (`!fish` is a free cast every minute), from minnows to the legendary golden koi |
| Word Guess | type the hidden word in chat; gifts reveal letters or double the points |
| Vote Path | type left or right at each fork; gifts add votes; treasure or trap |

**Voice and keeping viewers** (Settings → Voice): a neural voice on the stream welcomes people who join (grouped, with a tip like "Send a Rose to pull for red"), thanks gifters, followers and sharers, announces winners and MVPs, and plays reminders every few minutes while you're live. English and Arabic texts are built in, and you can edit every sentence. The voice is generated on the server with Microsoft Edge's neural voices (`msedge-tts`) and played inside the stream page, so OBS records it. If the server can't reach the voice service, the stream page uses the browser's voice instead. The stream page also shows a tips ticker and "Welcome @name" pop-ups (Settings → On the stream).

**Dashboard tabs:** **Start here** (the step-by-step setup), **Live** (stats, tests, log, presets, phone remote), **Games**, **Gifts**, **Chat & likes**, **Reports** and **Settings**.

**Stream features** (all saved in `DATA_DIR` on the server):
* **Chat commands:** for example `!left → Move left`, with a shared wait and a per-viewer wait. Viewers can type `!left` or just `left`.
* **Like goals:** "every N likes → action". The game shows a progress bar.
* **Top supporters:** the top 3 gifters of the stream are shown in the game. When the car crashes, the banner names the MVP of that run.
* **Presets:** save the gifts, chat commands and like goals as a named preset, and load it from the dashboard or the phone.
* **Auto-connect:** the server checks every minute whether your account is LIVE and connects by itself. A manual Disconnect turns it off.
* **Pause:** freezes the game. Gifts are still counted but trigger nothing.
* **Phone remote:** `/remote.html`. Scan the QR code from **Live controls → Phone remote** on the dashboard.
* **Sound:** generated in the browser. In OBS, tick "Control audio via OBS" on the Browser Source. Add `&sound=0` to the game link to turn it off.
* **Stream reports:** saved when a stream ends or you disconnect: diamonds, top gifters, gifts, actions, likes, peak viewers and best run. Download each one as CSV (`/api/reports/<id>.csv?token=…`). Dashboard tests aren't counted while you're live.

Rules are saved on the server (`DATA_DIR/rules.json`, on the VPS `/var/lib/tiktokgg/rules.json`), so they survive restarts and updates. In the **Games** panel each action card shows its gifts. Use **+ Gift** to add one, and × to remove it. Mapped gift tiles also have a trash button, and **Clear all** removes every rule. Press **Apply Rules** to send changes.

### Lite setup on your own PC
Run the server yourself:

```bash
cd express-server
```

```bash
npm install
```

```bash
npm start
```

Then open `http://localhost:8080`. The server serves the same dashboard and connects automatically.

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

## Backgrounds

Dashboard → **Games** → **Game settings** → **Background**: 32 backgrounds plus *Transparent* and *Green screen*, each game separately. Pick one from the thumbnails; it goes live at once.

- Calm: Midnight, Sunset, Deep ocean, Neon glow, Forest night, Desert dusk, Dark carbon, Mountain dawn, Blue sky
- Space: Starfield, Hyperspace, Nebula, Spiral galaxy, Aurora
- Party & retro: Synthwave, City at night, Hex grid, Digital rain, Disco lights, Gold luxury, Red & cyan, Color flow, Candy stripes
- Moving: Bokeh lights, Fireflies, Snowfall, Rainy night, Bubbles, Floating hearts, Confetti party, Lava lamp, Ocean waves
- **Transparent**: the stream page has no background, so your camera or OBS scene shows behind the game. **Green screen**: a chroma-key green.
- *Darken the background* (0–90 %) keeps the game readable on bright backgrounds. *Game's own* keeps each game's original scenery.

Backgrounds are drawn in code in `games/_backgrounds.js` (no image files), and games call `api.drawBackground(ctx)`.

## Screen layout (move any window)

Dashboard → **Games** → **Screen layout**. The preview turns into an editor:

- Drag any window to put it anywhere: gift list, score panel, top supporters, like goals, gift alerts, effect timers, tips bar, big banners, join messages or the team battle bar.
- Click a window to pick it. Drag its red handle to make it wider or narrower. Its bar has **H / V** (horizontal or vertical) for the gift list, score panel, supporters, like goals, alerts and effect timers, plus size − / + and reset.
- **Gift names**: the *names* switch on the Gift list row (or the T button in the editor bar, or Game settings → On screen) shows the gift names or only the gift icons with their action. The diamond price is hidden by default; turn on *Diamond price next to each gift* in Game settings → On screen to show it.
- **Delete a window**: pick it and press the trash button in its bar (or the Delete key), or press the trash button next to it in the list. Removed windows show in a *Removed* strip on the editor and in the list with **Restore**.
- The list next to the preview does the same with buttons: remove / restore, H / V, size and reset, plus *Use this layout in all games* and *Reset all windows* (which also brings back removed windows).
- Every change saves by itself. **My saved layouts** stores the whole screen (window places, sizes, H / V and removed windows) under a name, so you can load it again in any game (`SAVE_LAYOUT` / `LOAD_LAYOUT` / `DELETE_LAYOUT`, kept in `layouts.json`).
- Each game keeps its own layout, and presets save it. OBS updates live. For a bigger editor, open `play.html?edit=1&token=…`.

## Game settings (per game)

Dashboard → **Games** → **Game settings**. Each game keeps its own settings, and changes go live on stream right away. The preview next to the panel shows them.

- **Gameplay**: health, speeds, damage, wave sizes, chances, round and pause lengths, lives, prizes and words. Each game has its own list. Every game also has a *Game speed* setting from 50 % to 200 %.
- **On screen**: score panel, effect timers, @names inside the game, gift alerts, big banners, sparkles, gift list, like goals, top supporters and the tips bar, plus game-specific parts (rain, wheel lights, vote counts…). The switches in Settings → On the stream still apply to all games; a part shows only when both are on.
- **Sound**: sound-effects volume (0–150 %).
- **Default settings** puts the game's settings back to the defaults. Your gift rules stay as they are.

Options are declared in `games/catalog.json` (`options`: `number`, `range`, `bool`, `select`, `text`, `lines`, each with a `group`). Games read them with `api.num(key, default, min, max)`, `api.flag(key)` and `api.options`. An option marked `reload: true` restarts the game when it changes.

## Team battle (Red vs Blue)

Dashboard → **Teams** → *Turn teams on*. It works with every game:

- Viewers type **1** (Red) or **2** (Blue) in chat. They can also type red / blue, أحمر / أزرق, kırmızı / mavi, or `join` for the smaller team. With *Auto-assign* on, anyone who gifts or likes without a team joins the smaller one.
- Each diamond gifted is 1 point for the sender's team, plus 1 point per N likes (default 10).
- Rounds are timed (default 3 minutes). The stream shows a battle bar, and the voice warns when 30 s are left. At the end it announces the winner and the team MVP, and a new round starts 10 s later.
- In Tug of War and Tower Race, gifts help the sender's own team: "Pull Red" becomes "pull for your team" and "Freeze Blue" becomes "freeze the other team". Turn off *Gifts help the sender's team* to keep fixed gift-per-team rules.
- A viewer can switch teams until they score their first point. *Clear teams* empties both teams.

Protocol: `UPDATE_TEAMS` {enabled, autoAssign, routeGifts, roundSeconds, likesPerPoint, redName, blueName}, `TEAM_CONTROL` {op: newRound | endRound | clear}. The server broadcasts `TEAMS` (state), `TEAM_JOIN` and `TEAM_ROUND` (start / end). Each `GAME_EVENT` carries `team`, plus `originalAction` when it was re-routed.

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
