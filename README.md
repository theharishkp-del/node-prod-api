# node-prod-api

Express 5 + MongoDB (mongoose) API in CommonJS (Node 18.18+, Node 22 LTS recommended), organised in feature modules.

Includes: validated env config (zod), winston logging with env-driven weekly/daily rotation, helmet, CORS, compression, a JSON body size limit, central error handling + JSON 404, health/readiness endpoints, MongoDB connection with retry/reconnect, graceful shutdown, crash logging, Angular static hosting under a sub-path, and the EO bot endpoint with reusable EO helpers.

## Quick start

```bash
npm install
cp .env.example .env        # then edit .env (MONGODB_URI, etc.)
npm run dev                 # node --watch, pretty colourised console logs
```

```bash
curl localhost:3000/iqagent/health
curl -X POST localhost:3000/iqagent/api/customerOrderRequestEo \
  -H 'Content-Type: application/json' -d @tests/fixtures/eoRequest.json
```

Scripts: `npm start` (plain node), `npm test` (node:test + supertest, no DB needed), `npm run lint`.

## Endpoints

Every module is served at the root **and** under `APP_BASE_PATH` (default `/iqagent`, which nginx forwards unchanged).

| Method | Path | Description |
|---|---|---|
| GET | `/health`, `/health/live` | Liveness: always 200; uptime, memory and MongoDB state |
| GET | `/health/ready` | Readiness: 200 when MongoDB is connected and not shutting down, otherwise 503 |
| POST | `/api/customerOrderRequestEo` | EO bot conversation step (see below); no DB needed |
| GET | `/<ANGULAR_APP_NAME>/...` | Angular build (only under `APP_BASE_PATH`, when enabled) |

Errors always look like `{ "error": { "message", "code", "details?" } }`.

## Folder structure

```
src
├── app.js                       # Express app: middleware order, module routes, 404 + errors
├── server.js                    # entry point: HTTP server, Mongo connect, signals, shutdown
├── config
│   ├── index.js                 # dotenv + zod env validation -> frozen config object
│   ├── logger.js                # winston logger, rotating files, flushLogger()
│   └── database.js              # mongoose connect with retry/backoff, events, close
├── routes
│   └── index.js                 # module registry: path -> module router
├── shared
│   ├── eo                       # EO toolkit reused by every EO API
│   │   ├── constants.js         #   EO_RESULT, EO_STATE
│   │   ├── helpers.js           #   base64, signal ids, decodeContext, builders, resolveHandler, runEoStep
│   │   └── index.js             #   public entry point
│   ├── middlewares              # requestLogger, errorHandler, notFound, angularStatic
│   └── utils                    # AppError, asyncHandler, truncate
└── modules
    ├── health                   # health.routes.js, health.controller.js
    └── customerOrderRequestEo
        ├── customerOrderRequestEo.routes.js
        ├── customerOrderRequestEo.controller.js   # HTTP + EO logging
        ├── customerOrderRequestEo.service.js      # runs the step against the handler registry
        ├── constants.js                           # question/answer keys
        └── handlers                               # index.js (registry), default + customerMenu handlers
tests                            # mirrors src: modules/, shared/, config/, plus app/health/angular
```

## How to add a new API module

1. Create `src/modules/<name>/`:
   ```
   src/modules/<name>/
   ├── <name>.routes.js       # const router = Router(); router.post('/', asyncHandler(controller)); module.exports = router;
   ├── <name>.controller.js   # req/res only: read input, call the service, send the response
   ├── <name>.service.js      # business logic (and DB access via a model, if any)
   ├── <name>.model.js        # optional mongoose model
   └── constants.js           # optional
   ```
   For an EO API, copy `modules/customerOrderRequestEo` and give it its own `handlers/` registry; the service is a one-liner around `runEoStep(payload, { registry, defaultHandler })` from `shared/eo`.
2. Register the router in `src/routes/index.js`:
   ```js
   { path: '/api/<name>', router: require('../modules/<name>/<name>.routes') },
   ```
   It is then served at `/api/<name>` and `${APP_BASE_PATH}/api/<name>`.
3. Add tests in `tests/modules/<name>.test.js`.

Throw `AppError` (or `AppError.notFound()`, ...) for expected errors; anything else becomes a generic 500. For DB-backed routes, check `getDatabaseState().isConnected` from `config/database` if you want a fast 503 while MongoDB is down.

## EO endpoint: `POST /api/customerOrderRequestEo`

- **Flow:** `decodeContext(body.context)` → `resolveHandler(questionKey, answerKey, registry, defaultHandler)` → `handler(payload, decoded)` → `buildEoResponse(...)` → HTTP 200 JSON.
- **No validation or DB:** missing fields just come back `undefined`; the endpoint keeps answering while MongoDB is down.
- **Errors:** if a handler throws, `eo.handler_error` is logged and the reply is still **HTTP 200** with a `buildEoError(...)` body (`resultCode '1'`, `resultText 'failure'`, `eoState 'stop'`). The failure values are placeholders until the platform confirms them (`src/shared/eo/constants.js`).

Response shape (`req` = `body.reqMessageObj`):

```json
{
  "resultCode": "0", "resultText": "success",
  "resMessageObj": { "taskId": "<req.taskId>", "fromId": "<body.botUserId>", "signalId": "<new 17-digit id>",
                     "parentId": "<req.signalId>", "mimeType": "text", "databaseName": "<req.databaseName>",
                     "fileName": "<base64 of the reply text>" },
  "fromServer": "<EO_FROM_SERVER>", "eoState": "stop",
  "reqMessageObj": { "...": "echoed unchanged" }
}
```

### Shared EO helpers (`src/shared/eo`)

| Function | Purpose |
|---|---|
| `encodeBase64(text)` / `decodeBase64(text)` | UTF-8 ⇄ base64. `decodeBase64` returns `''` for null, empty or invalid input and never throws |
| `generateSignalId()` | 17-digit numeric string (13-digit epoch ms + 4-digit sequence), increasing and unique within the process |
| `decodeContext(context)` | `{ questionKey, answerKey, expectedAns, questionUserDefinedObject, userDefinedObject, apiAnswer, englishTranslation }` with base64 fields decoded |
| `buildEoResponse(payload, { resultCode='0', resultText='success', fileName, eoState, mimeType='text', signalId, encodeFileName=true })` | Builds the envelope above |
| `buildEoError(payload, { resultCode='1', resultText='failure', message })` | Same shape with `eoState: 'stop'`; `message` becomes the base64 `fileName` |
| `resolveHandler(questionKey, answerKey, registry, fallback)` | `registry[q][a]` → `registry[q].default` → `fallback` |
| `runEoStep(payload, { registry, defaultHandler })` | The whole flow above; returns `{ decoded, handler, response, error? }` |
| `eoLogSummary(payload, decoded, response?)` | Compact log fields (taskId, signalId, keys, resultCode, ...) |

### Adding a question/answer handler

1. Create `src/modules/customerOrderRequestEo/handlers/myStep.handler.js`:
   ```js
   const { EO_STATE } = require('../../../shared/eo');
   async function myStep(payload, decoded) {
     return { fileName: 'Plain reply text (base64-encoded for you)', eoState: EO_STATE.STOP };
   }
   module.exports = { myStep };
   ```
2. Register it in `handlers/index.js`, keyed by the **decoded** keys (add them to `constants.js`):
   `'iq+my_question': { 'iq+my_question_ans_1': myStep, default: myQuestionFallback }`
3. Add a test to `tests/modules/customerOrderRequestEo.test.js`.

Unmapped keys go to `default.handler.js` ("This step is not configured yet (...)"). Registered today: `iq+customer_menu` / `iq+customer_menu_ans_3`, which returns a **placeholder** order link from `EO_ORDER_BASE_URL` (see the TODO in `buildOrderLink`).

### EO variables and logging

| Variable | Default | Meaning |
|---|---|---|
| `EO_FROM_SERVER` | `FSMAGENT` | `fromServer` in every EO response |
| `EO_LOG_FULL` | `true`, except `false` when `NODE_ENV=production` | `true`: log `eo.request` (full payload) and `eo.response` (full response) as-is, never truncated; the access log then skips its body copy (`bodiesLoggedAs`). `false`: one compact `eo.response` entry (`eoLogSummary` fields + `handler`, `durationMs`) |
| `EO_ORDER_BASE_URL` | (unset) | Optional absolute http(s) URL for the placeholder order link |

## Logging

All logging goes through winston (`src/config/logger.js`): console (colourised in development, JSON otherwise) plus, with `LOG_TO_FILE=true`, JSON-lines files in `LOG_DIR`:

- `app-<period>.log`: every entry at `LOG_LEVEL` or above; `error-<period>.log`: errors only.
- **Access log:** one entry per request with `method`, `url`, `status`, `responseTimeMs`, `ip`, `userAgent`, `referer` and content lengths (info for 2xx/3xx, warn for 4xx, error for 5xx/aborted). With `LOG_BODIES=true` request/response bodies are included **as-is (no redaction)**, truncated to `LOG_BODY_MAX_LENGTH` characters.
- **Rotation:**

  | Variable | Default | Effect |
  |---|---|---|
  | `LOG_ROTATE_FREQUENCY` | `weekly` | `weekly` → `datePattern 'GGGG-[W]WW'` (`app-2026-W41.log`, new file each ISO week); `daily` → `'YYYY-MM-DD'` (`app-2026-10-07.log`) |
  | `LOG_RETENTION_DAYS` | `30` | Files older than N days are deleted (`maxFiles: 'Nd'`) |
  | `LOG_MAX_SIZE` | `20m` | Also rolls within a period when a file reaches this size (`.1`, `.2`, ...) |

  Rotated files are gzipped. Rotation events are logged (`log.new | log.rotate | log.archive | log.removed`). Logs are flushed on shutdown.

## Startup, MongoDB and shutdown

1. Env is validated with zod; on any problem the app lists them all and exits.
2. The HTTP server starts; `/health/ready` is 503 until MongoDB is connected.
3. MongoDB connects with exponential backoff and jitter (`MONGO_CONNECT_RETRIES`, 0 = forever). If all attempts fail the process exits with code 1 so the supervisor can restart it. After that the driver reconnects automatically; connection events are logged.
4. On SIGTERM/SIGINT, readiness switches to 503, the server drains in-flight requests, MongoDB closes, logs flush and the process exits (forced after `SHUTDOWN_TIMEOUT_MS`). `uncaughtException` / `unhandledRejection` are logged with stack traces and go through the same shutdown with exit code 1.

## Angular under a sub-path (nginx)

Target: `https://devvir.cognitivemobile.net/iqagent/<ANGULAR_APP_NAME>/`.

| Path | Served by |
|---|---|
| `${APP_BASE_PATH}/<name>` | 301 → `${APP_BASE_PATH}/<name>/` |
| `${APP_BASE_PATH}/<name>/main.abc123.js` | static file, `Cache-Control: public, max-age=31536000, immutable` |
| `${APP_BASE_PATH}/<name>/` and deep links | `index.html`, `Cache-Control: no-cache` |
| `${APP_BASE_PATH}/<name>/missing.js`, `.../api/...` | JSON 404 (no SPA fallback) |

Helmet's CSP is disabled for the Angular paths only (Angular inlines critical CSS); all other helmet headers stay on and the API keeps the strict default CSP. A missing dist folder logs a warning and skips the app.

1. Build with the matching base href (trailing slash required): `ng build --configuration production --base-href /iqagent/portal/`
2. Copy the folder containing `index.html` (Angular 17+: `dist/<project>/browser/`) to `ANGULAR_DIST_PATH`.
3. `.env`: `APP_BASE_PATH=/iqagent`, `ANGULAR_ENABLED=true`, `ANGULAR_APP_NAME=portal`, `ANGULAR_DIST_PATH=./public/portal` (several apps: `ANGULAR_APPS=portal:./public/portal,admin:./public/admin`).
4. Restart the Node process (config is read at startup).
5. nginx: see [`docs/nginx.example.conf`](docs/nginx.example.conf), `proxy_pass http://127.0.0.1:3000;` **without** a trailing slash so the `/iqagent` prefix reaches Node.

## Production notes

- Set `CORS_ORIGIN` to explicit origins.
- Bodies are logged unredacted when `LOG_BODIES=true` or `EO_LOG_FULL=true`; make sure that is acceptable for your data, or turn them off.
- Express `trust proxy` is not enabled, so `req.ip` behind nginx is the proxy address.
- Keep real credentials out of git (`.env` is git-ignored).
