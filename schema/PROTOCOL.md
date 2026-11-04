# Wire protocol (v1)

Transport: one WebSocket at `ws://<server>:8080/ws` (add `?token=XYZ` when `WS_TOKEN` is set).
Every frame, in both directions, is a JSON **envelope**:

```json
{ "v": 1, "type": "game.action", "id": "uuid", "ts": 1730700000000, "payload": { }, "replyTo": "optional-uuid" }
```

The machine-readable schema is in [`protocol.schema.json`](./protocol.schema.json) (JSON Schema 2020-12).

## Game client lifecycle

```
game                                   server
 │ ── hello {role:"game", name, actions:[…]} ──► │
 │ ◄── welcome {clientId, protocol:1} ────────── │
 │ ◄── game.settings {difficulty, …} ─────────── │   (again on every change)
 │ ◄── game.action {actionId, action, count,…} ─ │   (whenever a rule fires)
 │ ── game.ack {actionId, status:"ok"} ────────► │   (optional)
 │ ── game.state {score, lives, …} ────────────► │   (optional, shown on the dashboard)
```

The `actions` list in `hello` populates the dashboard's action picker. The server has no built-in list.

## `game.action`

```json
{
  "v": 1,
  "type": "game.action",
  "id": "9c0f…",
  "ts": 1730700000123,
  "payload": {
    "actionId": "5b1e2c8a-…",
    "action": "spawn_train",
    "count": 10,
    "params": { "lane": "random", "color": "#ff2d55" },
    "settings": { "paused": false, "difficulty": 1.5, "speedMultiplier": 1.2, "obstacleDensity": 1, "spawnRateMultiplier": 1 },
    "source": {
      "kind": "gift",
      "ruleId": "c2a4…",
      "ruleName": "Rose → Spawn Train",
      "eventId": "e81d…",
      "simulated": false,
      "units": 10,
      "user": { "userId": "6812…", "uniqueId": "alice", "nickname": "Alice ✨", "avatar": "https://…" },
      "gift": { "id": "5655", "name": "Rose", "diamonds": 1, "image": "https://…", "repeatCount": 10, "phase": "end" }
    }
  }
}
```

* `count` has already been worked out by the rule as `units × multiplier`, capped at `maxCount`. Run the action `count` times, or treat it as an intensity.
* `params` is free-form JSON that you set per rule in the dashboard.
* `settings` is a snapshot of the tuning values, so a handler never has to wait for `game.settings`.
* `source.gift.phase`: `"end"` means the streak closed (`repeatEnd === true`). `"progress"` appears only on rules set to **live per unit**. `"single"` is a gift that can't streak.

## How streaks work

| TikTok sends | tracker phase | delta | total | `onEnd` rule | `perUnit` rule |
|---|---|---|---|---|---|
| Rose repeatCount=1, repeatEnd=false | progress | 1 | 1 | — | fires count=1 |
| Rose repeatCount=2, repeatEnd=false | progress | 1 | 2 | — | fires count=1 |
| Rose repeatCount=5, repeatEnd=false | progress | 3 | 5 | — | fires count=3 |
| Rose repeatCount=5, repeatEnd=true  | end      | 0 | 5 | **fires count=5** | — |
| Lion (giftType≠1)                   | single   | 1 | 1 | fires count=1 | fires count=1 |

If a streak never gets `repeatEnd` (a dropped packet or the viewer left), the server closes it after `STREAK_TIMEOUT_MS` (30 s by default) and sends a synthetic `end`. That way `onEnd` rules still pay out.

## Dashboard commands (dashboard → server)

The server answers each command with `ack {type, result}` or `error {type, error}`. Both carry `replyTo` set to your frame's `id`.

| type | payload |
|---|---|
| `state.request` | `{}` → full snapshot |
| `tiktok.connect` | `{ "username": "someone" }` |
| `tiktok.disconnect` | `{}` |
| `rules.upsert` | `{ "rule": Rule }` (omit `id` to create) |
| `rules.delete` | `{ "id": "…" }` |
| `rules.import` | `{ "rules": Rule[], "replace": true }` |
| `settings.patch` | `{ "patch": { "speedMultiplier": 1.4, "myCustomKey": 3, "oldKey": null } }` |
| `test.action` | `{ "action": "spawn_train", "count": 3, "params": {} }` (skips the rules) |
| `test.event` | `{ "type": "gift", "giftName": "Rose", "count": 10, "streak": true, "username": "tester" }` (goes through the rules) |

### Rule object

```json
{
  "id": "auto",
  "name": "Rose → Spawn Train",
  "enabled": true,
  "trigger": { "type": "gift", "giftName": "Rose", "minDiamonds": 0 },
  "action": { "name": "spawn_train", "params": { "lane": "random" } },
  "streakMode": "onEnd",
  "countMode": "perUnit",
  "multiplier": 1,
  "maxCount": 100,
  "cooldownMs": 0,
  "userCooldownMs": 0
}
```

Trigger variants:
* `{type:"gift", giftName:"*"|"Rose"|"<giftId>", minDiamonds}`
* `{type:"chat", keyword:"!jump", keywordMode:"contains"|"exact"|"startsWith"|"regex"}`
* `{type:"like", everyLikes:100}`
* `{type:"follow"|"share"|"member"|"subscribe"}`

`countMode`: `perUnit` (one per gift or threshold), `perDiamond` (gift units × diamond value), `once` (always 1).

## Server → dashboard events

`state.snapshot`, `tiktok.status`, `tiktok.event`, `rules.updated`, `settings.updated`, `gifts.updated`, `clients.updated`, `actions.updated`, `action.dispatched`, `game.ack`, `game.state`, `log`.
