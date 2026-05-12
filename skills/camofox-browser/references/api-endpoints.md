# Camofox API Endpoints (48 Total)

Complete route reference from:
- `src/routes/core.ts` (41 endpoints)
- `src/routes/openclaw.ts` (7 endpoints)

Related:
- `../SKILL.md`
- `./cli-commands.md`

Source of truth for development: `AGENTS.md`

## Table of Contents

1. Core Routes (`core.ts`) — 41
2. OpenClaw Routes (`openclaw.ts`) — 7
3. Endpoint Notes
4. Auth & Security Notes
5. `userId` Requirement Matrix
6. End-to-End API Flows

---

## 1) Core Routes (`core.ts`) — 41

Base URL: `http://localhost:9377`

## Cookie endpoints

### 1. `POST /sessions/:userId/cookies`
Import cookies into user context.

Body:
```json
{ "cookies": [/* Cookie objects */], "tabId": "optional-tab-id" }
```
Response: `{ ok: true, userId, count }`
Notes:
- If `CAMOFOX_API_KEY` is set, requires bearer authorization
- Validates array size and cookie shape

### 2. `GET /tabs/:tabId/cookies?userId=...`
Export cookies from tab context.
Response: `Cookie[]`
Auth: bearer required when `CAMOFOX_API_KEY` is set

## Health/presets/tab lifecycle

### 3. `GET /health`
Service health and pool metadata.

### 4. `GET /presets`
Returns available geo presets.

### 5. `POST /tabs`
Create tab.

Body:
```json
{
  "userId": "agent1",
  "sessionKey": "default",
  "listItemId": "optional-legacy",
  "url": "https://example.com",
  "preset": "japan",
  "locale": "ja-JP",
  "timezoneId": "Asia/Tokyo",
  "geolocation": {"latitude": 35.6895, "longitude": 139.6917},
  "viewport": {"width": 1280, "height": 720}
}
```
Response: `{ tabId, url }`

### 6. `GET /tabs?userId=...`
List tabs for user.
Response: `{ running: true, tabs: [...] }`

## Navigation and interaction

### 7. `POST /tabs/:tabId/navigate`
Body: `{ userId, url }` or `{ userId, macro, query }`
Response: `{ ok: true, url }`

### 8. `GET /tabs/:tabId/snapshot?userId=...`
Accessibility snapshot.
Response includes snapshot text and refs metadata.

### 9. `POST /tabs/:tabId/wait`
Body: `{ userId, timeout?, waitForNetwork? }`

### 10. `POST /tabs/:tabId/click`
Body: `{ userId, ref? , selector? }`
Response may include recent downloads metadata when click triggers download.

### 11. `POST /tabs/:tabId/type`
Body: `{ userId, ref?, selector?, text }`

### 12. `POST /tabs/:tabId/press`
Body: `{ userId, key }`

### 13. `POST /tabs/:tabId/scroll`
Body: `{ userId, direction?: "up"|"down", amount?: number }`

### 14. `POST /tabs/:tabId/scroll-element`
Body:
```json
{
  "userId": "agent1",
  "selector": "optional",
  "ref": "optional",
  "deltaX": 0,
  "deltaY": 400,
  "scrollTo": {"top": 1200, "left": 0}
}
```

### 15. `POST /tabs/:tabId/evaluate`
Body: `{ userId, expression, timeout? }`
Limits:
- JSON body limit `64kb`
- Expression length max `65536`
Auth: bearer required when `CAMOFOX_API_KEY` is set

### 16. `POST /tabs/:tabId/evaluate-extended`
Body: `{ userId, expression, timeout? }`
Extended behavior:
- Timeout range `100..300000` ms
- Rate limited per user
- 64KB expression limit
Auth: bearer required when `CAMOFOX_API_KEY` is set

### 17. `POST /tabs/:tabId/back`
Body: `{ userId }`

### 18. `POST /tabs/:tabId/forward`
Body: `{ userId }`

### 19. `POST /tabs/:tabId/refresh`
Body: `{ userId }`

## Console & Error Capture

| Method | Endpoint | Description |
|---|---|---|
| GET | `/tabs/:tabId/console` | Get console messages. Query: `?userId=`, `?type=`, `?limit=` |
| GET | `/tabs/:tabId/errors` | Get page errors. Query: `?userId=`, `?limit=` |
| POST | `/tabs/:tabId/console/clear` | Clear console and error buffers. Body: `{ userId }` |

## Tracing

| Method | Endpoint | Description |
|---|---|---|
| POST | `/tabs/:tabId/trace/start` | Start Playwright tracing. Body: `{ userId, screenshots?, snapshots? }` |
| POST | `/tabs/:tabId/trace/stop` | Stop tracing and save ZIP. Body: `{ userId, path? }` |
| POST | `/tabs/:tabId/trace/chunk/start` | Start trace chunk. Body: `{ userId }` |
| POST | `/tabs/:tabId/trace/chunk/stop` | Stop trace chunk and save ZIP. Body: `{ userId, path? }` |
| GET | `/tabs/:tabId/trace/status` | Get tracing status. Query: `?userId=` |

## Extraction and stats

### 20. `GET /tabs/:tabId/links`
Query:
- `userId` (required)
- `limit`, `offset`
- `scope`, `extension`, `downloadOnly`

### 21. `GET /tabs/:tabId/screenshot`
Query: `userId`, optional `fullPage=true`
Returns PNG bytes.

### 22. `GET /tabs/:tabId/stats`
Query: `userId`
Response includes `visitedUrls`, `toolCalls`, `refsCount`.

## Tab/session deletion

### 23. `DELETE /tabs/:tabId`
Body: `{ userId }`

### 24. `DELETE /tabs/group/:listItemId`
Body: `{ userId }`

### 25. `DELETE /sessions/:userId`
Closes all sessions and cleans downloads for user.

### 26. `POST /sessions/:userId/toggle-display`
Body: `{ headless: true|false|"virtual" }`
Notes:
- Restarts user context
- Existing tabs become invalid
- Can return `vncUrl` in non-headless modes

## Download management

### 27. `GET /tabs/:tabId/downloads`
Query:
- `userId` (required)
- optional filters: `status`, `extension`, `mimeType`, `minSize`, `maxSize`, `sort`, `limit`, `offset`

### 28. `GET /users/:userId/downloads`
Optional same filters as tab download listing.

### 29. `GET /downloads/:downloadId`
Query: `userId` (required)

### 30. `GET /downloads/:downloadId/content`
Query: `userId` (required)
Streams file content if completed.

### 31. `DELETE /downloads/:downloadId`
`userId` accepted from body or query.

## Resource extraction/download helpers

### 32. `POST /tabs/:tabId/extract-resources`
Body options include:
- `userId` (required)
- `selector`, `types`, `extensions`, `resolveBlobs`, `triggerLazyLoad`

### 33. `POST /tabs/:tabId/batch-download`
Body:
- `userId` (required)
- plus batch download options
Timeout allows longer-running operations (up to 300s wrapper).

### 34. `POST /tabs/:tabId/resolve-blobs`
Body:
```json
{ "userId": "agent1", "urls": ["blob:..."] }
```
Constraints:
- `urls` required array
- max 25 URLs

---

## 2) OpenClaw Routes (`openclaw.ts`) — 7

These are compatibility endpoints for OpenClaw clients.

### 35. `GET /`
Status alias route.

### 36. `POST /tabs/open`
Open tab in OpenClaw body format.

Body:
```json
{ "userId": "agent1", "url": "https://example.com", "listItemId": "default" }
```

### 37. `POST /start`
Compatibility start endpoint; returns profile status payload.

### 38. `POST /stop`
Stop browser/session state.
Auth:
- Requires admin authorization (`CAMOFOX_ADMIN_KEY` semantics)

### 39. `POST /navigate`
Body: `{ targetId, url, userId }`

### 40. `GET /snapshot`
Query: `targetId`, `userId`, optional `format`

### 41. `POST /act`
Combined action endpoint.

Body baseline:
```json
{ "kind": "click|type|press|scroll|scrollIntoView|hover|wait|close", "targetId": "...", "userId": "..." }
```
Action-specific fields:
- click: `ref|selector`, `doubleClick?`
- type: `ref|selector`, `text`, `submit?`
- press: `key`
- scroll/scrollIntoView: `ref?`, `direction?`, `amount?`
- hover: `ref|selector`
- wait: `timeMs?`, `text?`, `loadState?`
- close: none additional

---

## 3) Endpoint Notes

- All tab-bound operations require matching `userId` context for tab lookup.
- `DELETE /tabs/:tabId` takes `userId` in body (not path/query requirement).
- Snapshot refs are ephemeral; reacquire after navigation or major interaction.
- Extended evaluate can return `429` (rate limit) and `408` (timeout).

Important mismatch note:
- `POST /youtube/transcript` is **not registered** in `core.ts` or `openclaw.ts`.
- Do not treat YouTube transcript as an available endpoint in current server routes.

---

## 4) Auth & Security Notes

- Bearer API key checks are conditional on `CAMOFOX_API_KEY` for sensitive endpoints (cookie import/export and evaluate family).
- OpenClaw stop endpoint requires admin authorization.
- Session display toggle invalidates existing tabs by restarting context.

---

## 5) `userId` Requirement Matrix

`userId` usage varies by route shape (path, query, or body).

| Endpoint | `userId` location |
|---|---|
| `POST /sessions/:userId/cookies` | path (`:userId`) |
| `GET /tabs/:tabId/cookies` | query |
| `GET /health` | none |
| `GET /presets` | none |
| `POST /tabs` | body |
| `GET /tabs` | query |
| `POST /tabs/:tabId/navigate` | body |
| `GET /tabs/:tabId/snapshot` | query |
| `POST /tabs/:tabId/wait` | body |
| `POST /tabs/:tabId/click` | body |
| `POST /tabs/:tabId/type` | body |
| `POST /tabs/:tabId/press` | body |
| `POST /tabs/:tabId/scroll` | body |
| `POST /tabs/:tabId/scroll-element` | body |
| `POST /tabs/:tabId/evaluate` | body |
| `POST /tabs/:tabId/evaluate-extended` | body |
| `POST /tabs/:tabId/back` | body |
| `POST /tabs/:tabId/forward` | body |
| `POST /tabs/:tabId/refresh` | body |
| `GET /tabs/:tabId/links` | query |
| `GET /tabs/:tabId/screenshot` | query |
| `GET /tabs/:tabId/stats` | query |
| `DELETE /tabs/:tabId` | body |
| `DELETE /tabs/group/:listItemId` | body |
| `DELETE /sessions/:userId` | path |
| `POST /sessions/:userId/toggle-display` | path |
| `GET /tabs/:tabId/downloads` | query |
| `GET /users/:userId/downloads` | path |
| `GET /downloads/:downloadId` | query |
| `GET /downloads/:downloadId/content` | query |
| `DELETE /downloads/:downloadId` | body or query |
| `POST /tabs/:tabId/extract-resources` | body |
| `POST /tabs/:tabId/batch-download` | body |
| `POST /tabs/:tabId/resolve-blobs` | body |
| `GET /` (OpenClaw) | none |
| `POST /tabs/open` | body |
| `POST /start` | none |
| `POST /stop` | none (`admin auth` required) |
| `POST /navigate` | body |
| `GET /snapshot` | query |
| `POST /act` | body |

---

## 6) End-to-End API Flows

### Flow A: Open → Snapshot → Click

```bash
# create tab
TAB_JSON=$(curl -s -X POST http://localhost:9377/tabs \
  -H 'Content-Type: application/json' \
  -d '{"userId":"agent1","sessionKey":"default","url":"https://example.com"}')

# snapshot
curl -s "http://localhost:9377/tabs/<tabId>/snapshot?userId=agent1"

# click by ref
curl -s -X POST http://localhost:9377/tabs/<tabId>/click \
  -H 'Content-Type: application/json' \
  -d '{"userId":"agent1","ref":"e8"}'
```

### Flow B: Macro navigation

```bash
curl -X POST http://localhost:9377/tabs/<tabId>/navigate \
  -H 'Content-Type: application/json' \
  -d '{"userId":"agent1","macro":"@google_search","query":"camoufox browser"}'
```

### Flow C: Download inspection

```bash
curl "http://localhost:9377/users/agent1/downloads?limit=50&offset=0"
curl "http://localhost:9377/downloads/<downloadId>?userId=agent1"
curl "http://localhost:9377/downloads/<downloadId>/content?userId=agent1" -o artifact.bin
```

### Flow D: Toggle display mode for debugging

```bash
curl -X POST http://localhost:9377/sessions/agent1/toggle-display \
  -H 'Content-Type: application/json' \
  -d '{"headless":"virtual"}'
```

Post-condition:
- Existing tabs are invalidated; create/open a new tab.
