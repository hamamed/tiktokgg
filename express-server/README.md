# TikTok LIVE trigger server (`server.js`)

A single Express + `ws` + `tiktok-live-connector` server that turns TikTok LIVE gifts into game triggers.

This is separate from the full platform in `../server`. Both default to port 8080, so set `PORT` if you run them together.

```bash
npm install
```

```bash
npm start
```

| env | default | |
|---|---|---|
| `PORT` / `HOST` | `8080` / `0.0.0.0` | |
| `WS_TOKEN` | – | if set, clients must connect with `ws://host:8080/ws?token=…` |
| `TIKTOK_SIGN_API_KEY` | – | Euler Stream key, recommended by connector v2 |
| `RECONNECT_MAX_ATTEMPTS` | `5` | exponential backoff: 2s, 4s, 8s… (max 60s) |
| `ALLOWED_ORIGINS` | – | comma-separated list of browser origins allowed to connect, e.g. `https://tiktokgg.koydam.com` |
| `STREAK_TIMEOUT_MS` | `30000` | fire a streak that never sent `repeatEnd`; `0` turns this off |

WebSocket: `ws://host:8080` or `ws://host:8080/ws` (add `?role=game` or `?role=dashboard` to label the client in logs).
HTTP: `GET /health`, `GET /api/state`.

## Messages (`{ "type", "payload", "id"? }`)

Dashboard → server:
```json
{ "type": "CONNECT_TIKTOK", "payload": { "username": "my_tiktok" } }
{ "type": "DISCONNECT_TIKTOK" }
{ "type": "UPDATE_RULES", "payload": { "rules": { "Rose": { "action": "SPAWN_OBSTACLE", "value": 1 } } } }
{ "type": "UPDATE_RULES", "payload": { "mode": "merge", "rules": { "Lion": { "action": "BOSS", "value": 10 }, "Rose": null } } }
{ "type": "TEST_TRIGGER", "payload": { "action": "SPAWN_OBSTACLE", "value": 3 } }
{ "type": "TEST_TRIGGER", "payload": { "giftName": "Rose", "repeatCount": 5, "user": "tester" } }
{ "type": "GET_STATE" }
{ "type": "FETCH_GIFTS", "payload": { "username": "any_live_account" } }
```
`FETCH_GIFTS` loads TikTok's full gift list (names, diamond prices, images). Leave out `username` to use the stream you're connected to. TikTok only returns the list for an account that is LIVE at that moment.
Each message gets an `ACK` or `ERROR` reply. If you send an `id`, the reply carries it back as `requestId`.

Server → all clients: `STATE` (on connect), `STATUS`, `GAME_EVENT` (gifts that matched a rule, plus test actions), `GIFT_RECEIVED` (every finished gift, matched or not), `RULES_UPDATED`, `LIKES_UPDATE` and `VIEWERS_UPDATE` (each sent at most once a second), and `GIFTS` (the gift catalogue).

### Gift catalogue
The server saves gifts to `DATA_DIR/gifts.json` (default `express-server/data/`, on the VPS `/var/lib/tiktokgg`). It downloads each gift image once, only from TikTok's image servers, and serves it at `/gift-img/<id>.png`, so dashboards and OBS don't depend on TikTok's servers during a stream. The catalogue fills up from the room's gift list when you connect, from every gift received, and from `FETCH_GIFTS`. `GAME_EVENT` and `GIFT_RECEIVED` include `giftImage`.

```json
{ "type": "GAME_EVENT", "payload": {
  "user": "alice", "giftName": "Rose", "diamondCount": 1, "action": "SPAWN_OBSTACLE", "value": 5,
  "repeatCount": 5, "totalDiamonds": 5, "nickname": "Alice", "eventId": "…", "simulated": false, "reason": "gift" } }
```
`value` is the rule's value × the streak's `repeatCount`. Gift names match case-insensitively, and a `"*"` rule catches any gift that has no rule of its own.

## Gift streaks
A streakable gift (giftType 1) fires **once** when its final event arrives (`repeatEnd`), with the full count. Events in the middle of a combo are ignored. A non-streakable gift fires straight away. Connector v2 sends `repeatEnd` as `0`/`1`, not `true`/`false`, so the server converts it to a boolean before checking. A plain `=== true` check would never fire on v2.
