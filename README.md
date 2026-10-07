# node-prod-api

A production-ready Express 5 + MongoDB (mongoose) API starter written in CommonJS (Node 18.18+, Node 22 LTS recommended).

Features: structured winston logging with weekly rotation, request/response logging with secret redaction, validated env config, helmet, CORS, compression, rate limiting, central error handling, health/readiness endpoints, graceful shutdown, PM2 cluster config, and a Docker setup.

## Quick start (local)

```bash
npm install
cp .env.example .env        # then edit .env (MONGODB_URI, etc.)
npm run dev                 # node --watch, pretty colourised console logs
```

Try it:

```bash
curl localhost:3000/health
curl localhost:3000/health/ready
curl -X POST localhost:3000/api/v1/users -H 'Content-Type: application/json' \
  -d '{"name":"Ann","email":"ann@example.com","password":"change-me-please"}'
curl 'localhost:3000/api/v1/users?page=1&limit=20'
```

Other scripts: `npm start` (plain node), `npm test` (node:test + supertest, no DB needed), `npm run lint`.

## Run with PM2 (cluster mode)

```bash
npm install -g pm2
npm ci --omit=dev
NODE_ENV=production pm2 start ecosystem.config.js --env production
pm2 reload node-prod-api    # zero-downtime reload
pm2 save && pm2 startup     # restart on boot
```

The app still reads `.env`. Each worker writes its own log files (`app-2026-W41-0.log`, `app-2026-W41-1.log`, ...) so workers never rotate the same file.

## Run with Docker

```bash
cp .env.example .env
docker compose up --build -d     # API on :3000 + MongoDB 7
docker compose logs -f api
docker compose down
```

The image is based on `node:22-alpine`, installs prod deps only with `npm ci --omit=dev`, runs as the non-root `node` user, and uses `tini` as PID 1 so SIGTERM triggers a graceful shutdown. It has a HEALTHCHECK on `/health`. Logs are stored in the `api-logs` volume (`/app/logs`).

## Endpoints

| Method | Path                | Description                                                      |
|--------|---------------------|------------------------------------------------------------------|
| GET    | `/health`           | Liveness: always 200; includes uptime, memory and MongoDB state  |
| GET    | `/health/ready`     | Readiness: 200 when MongoDB is connected, otherwise 503          |
| GET    | `/api/v1/users`     | List users (`?page=&limit=`)                                     |
| GET    | `/api/v1/users/:id` | Get one user                                                     |
| POST   | `/api/v1/users`     | Create a user `{ name, email, password, role? }`                 |
| POST   | `/api/customerOrderRequestEo` | EO bot conversation step (see below); no DB needed     |

Errors always look like `{ "error": { "message", "code", "requestId", "details?" } }`.

## EO endpoint: `POST /api/customerOrderRequestEo`

The bot platform calls this for a conversation step. It is served at `/api/customerOrderRequestEo` and `${APP_BASE_PATH}/api/customerOrderRequestEo` (e.g. `/iqagent/api/customerOrderRequestEo`).

- **Path:** it lives directly under `/api`, not under the versioned `/api/v1`, because that is the exact path set on the bot platform. Future bot (EO) endpoints should also go in `src/routes/eo.routes.js`, and regular REST resources stay under `/api/v1`.
- **No checks or DB:** requests are not validated, and the endpoint does not use `requireDb`, so it keeps answering while MongoDB is down. Nothing is stored in the database yet.
- **Rate limit:** like everything else under `/api`, it goes through the `/api` rate limiter (`RATE_LIMIT_MAX` per `RATE_LIMIT_WINDOW_MS` per IP).
- **Flow:** `decodeContext(body.context)` → `resolveHandler(questionKey, answerKey)` → `handler(payload, decoded)` → `buildEoResponse(...)` → HTTP 200 JSON.
- **Errors:** if a handler throws, the error is logged (`eo.handler_error`) and the reply is still **HTTP 200**, with a `buildEoError(...)` body (`resultCode '1'`, `resultText 'failure'`, `eoState 'stop'`). The platform reads `resultCode`/`eoState`, not the HTTP status. The failure code and text are placeholders until the platform confirms them; they are set in `src/eo/constants.js`.

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

### Helpers (`src/utils/eo.js`)

| Function | Purpose |
|---|---|
| `encodeBase64(text)` / `decodeBase64(text)` | UTF-8 ⇄ base64. `decodeBase64` returns `''` for null, empty or invalid input (bad base64 or bytes that are not UTF-8) and never throws |
| `generateSignalId()` | 17-digit numeric string: 13-digit epoch ms + 4-digit sequence. It always increases and is unique within the process |
| `decodeContext(context)` | `{ questionKey, answerKey, expectedAns, questionUserDefinedObject, userDefinedObject, apiAnswer, englishTranslation }` with the base64 fields decoded. The two userDefined fields are decoded when they are valid base64 and kept as-is otherwise |
| `buildEoResponse(payload, { resultCode='0', resultText='success', fileName, eoState, mimeType='text', signalId=generateSignalId(), encodeFileName=true })` | Builds the response envelope above |
| `buildEoError(payload, { resultCode='1', resultText='failure', message })` | Same shape with `eoState: 'stop'`; `message` becomes the base64 `fileName` |
| `resolveHandler(questionKey, answerKey)` | Looks up `registry[q][a]`, then `registry[q].default`, then the global default handler |

### Adding a question/answer handler

1. Create a handler, for example `src/eo/handlers/myStep.handler.js`:
   ```js
   const { EO_STATE } = require('../constants');
   async function myStep(payload, decoded) {
     // decoded.questionKey, decoded.answerKey, decoded.apiAnswer, payload.reqMessageObj, ...
     return { fileName: 'Plain reply text (base64-encoded for you)', eoState: EO_STATE.STOP };
   }
   module.exports = { myStep };
   ```
2. Register it in `src/eo/handlers/index.js`, keyed by the **decoded** keys:
   ```js
   'iq+my_question': { 'iq+my_question_ans_1': myStep, default: myQuestionFallback },
   ```
3. Add a test to `tests/eo.test.js` (use `encodeBase64('iq+my_question')` in `context.questionKey`).

Unmapped keys go to `src/eo/handlers/default.handler.js`, which replies "This step is not configured yet (...)" with `eoState 'stop'`.
Currently registered: `iq+customer_menu` / `iq+customer_menu_ans_3`, which returns a **placeholder** order link built from `EO_ORDER_BASE_URL`. The real key/token format for the link is still pending; see the TODO in `buildOrderLink` in `src/eo/handlers/customerMenu.handler.js`.

### EO environment variables

| Variable | Default | Meaning |
|---|---|---|
| `EO_FROM_SERVER` | `FSMAGENT` | `fromServer` value in every EO response |
| `EO_LOG_FULL` | `true`, except `false` when `NODE_ENV=production` | See "EO logging" below |
| `EO_ORDER_BASE_URL` | (unset) | Optional absolute http(s) URL for the placeholder order link |

### EO logging

- **`EO_LOG_FULL=true`:**
  - Logs `eo.request` (the full incoming payload) and `eo.response` (the full outgoing response) at info level, each with `requestId`.
  - Keys that look secret (password, token, ...) are redacted, but nothing is truncated, so `LOG_BODY_MAX_LENGTH` does not apply here. `deviceId` and `fromEmail` are not redacted.
  - The access log entry for the request skips its own truncated body copy and adds `bodiesLoggedAs: "eo.request/eo.response"` instead.
- **`EO_LOG_FULL=false`:**
  - Logs a single `eo.response` entry with only `taskId`, `signalId`, `parentId`, `sessionDate`, `botUserId`, the decoded `questionKey`/`answerKey`, `resultCode`, `eoState`, plus `resSignalId`, `handler` and `durationMs`.
  - The access log works as usual, so `LOG_BODIES` still decides whether it includes truncated bodies.

## Logging

All logging goes through winston (`src/config/logger.js`).

| File (in `LOG_DIR`, default `logs/`) | Contents                                      |
|--------------------------------------|-----------------------------------------------|
| `app-<GGGG>-W<WW>.log`               | Every entry at `LOG_LEVEL` or above, JSON lines |
| `error-<GGGG>-W<WW>.log`             | Only `error` level entries, JSON lines        |
| `*.log.N.gz`                         | Gzipped rotated files                         |
| `.app-audit.json`, `.error-audit.json` | Rotation bookkeeping used for retention     |

- **Console:** colourised and human-readable in `development`. In `production`/`test` it prints JSON, which suits Docker and other log collectors. Set `LOG_TO_FILE=false` to log only to the console.
- **Access log:** one entry per request with `requestId`, `method`, `url`, `status`, `responseTimeMs`, `ip`, `userAgent`, `referer`, `reqContentLength` and `resContentLength`. The level is info for 2xx/3xx, warn for 4xx, and error for 5xx or aborted requests.
- **Request ID:** taken from the incoming `X-Request-Id` header if it is valid. Otherwise a new UUID v4 is generated. The ID is always returned in the `X-Request-Id` response header.
- **Bodies:** when `LOG_BODIES=true`, request and response bodies are logged. Sensitive keys at any depth are replaced with `[REDACTED]`. Matching ignores case and works on substrings, so it covers keys like password, token, authorization, cookie, secret and apikey, plus anything you add to `LOG_REDACT_FIELDS`. Sensitive query parameters in the URL are redacted the same way. Bodies longer than `LOG_BODY_MAX_LENGTH` characters are truncated.
- **Weekly rotation:** `winston-daily-rotate-file` uses `datePattern: 'GGGG-[W]WW'`, which is the ISO week-year plus ISO week number. Each Monday a new file starts, e.g. `app-2026-W41.log` and then `app-2026-W42.log`. The previous file is gzipped (`zippedArchive: true`). Within a week, a file is also rolled over when it reaches `LOG_MAX_SIZE` (`.1`, `.2`, ...). `LOG_MAX_FILES` controls retention: `12w` keeps 12 weeks (converted to `84d`), and a plain number keeps that many files.
- **Rotation events:** opening, rotating, archiving and removing a file are all logged (`event: log.new | log.rotate | log.archive | log.removed`).
- On shutdown, the log streams are flushed before the process exits.

## Startup, MongoDB and shutdown

1. The env is validated with zod (`src/config/index.js`). If anything is missing or invalid, the app lists every problem and exits.
2. The HTTP server starts. `/health/ready` returns 503 until MongoDB is connected, and `/api/v1/users` returns 503 `DATABASE_UNAVAILABLE`.
3. MongoDB connects with exponential backoff and jitter (`MONGO_CONNECT_RETRIES`; set it to 0 to retry forever). If all attempts fail, the process exits with code 1 so the supervisor (PM2/Docker/K8s) can restart it. After the first connection, the driver reconnects automatically. The `connected`, `disconnected`, `reconnected`, `close` and `error` events are logged.
4. On SIGTERM/SIGINT, readiness switches to 503, the HTTP server stops accepting connections and drains in-flight requests, MongoDB closes, logs are flushed, and the process exits. If this takes longer than `SHUTDOWN_TIMEOUT_MS`, the exit is forced. `uncaughtException` and `unhandledRejection` are logged with their stack traces and then go through the same shutdown with exit code 1.

## Folder structure

```
.
├── src
│   ├── app.js                  # Express app: middleware order, routes, error handling
│   ├── server.js               # Entry point: HTTP server, Mongo connect, signals, shutdown
│   ├── config
│   │   ├── index.js            # dotenv + zod env validation -> frozen config object
│   │   ├── logger.js           # winston logger, weekly rotating files, flushLogger()
│   │   └── database.js         # mongoose connect with retry/backoff, events, close
│   ├── middlewares
│   │   ├── requestId.js        # X-Request-Id (accept or generate UUID)
│   │   ├── requestLogger.js    # access log with redacted/truncated bodies
│   │   ├── rateLimiter.js      # express-rate-limit for /api
│   │   ├── requireDb.js        # 503 when MongoDB is not connected
│   │   ├── validate.js         # zod body validation
│   │   ├── notFound.js         # 404 handler
│   │   └── errorHandler.js     # central error handler (AppError, zod, mongoose, body-parser)
│   ├── routes                  # index.js (/api/v1), eo.routes.js (/api), health.routes.js, user.routes.js
│   ├── controllers             # health.controller.js, user.controller.js, eo.controller.js
│   ├── eo                      # constants.js (result codes), handlers/ (EO question/answer registry)
│   ├── models                  # user.model.js (scrypt password hash, hidden in JSON)
│   └── utils                   # AppError.js, asyncHandler.js, sanitize.js (redact/truncate), eo.js (EO helpers)
├── tests                       # node:test + supertest (no DB required)
├── logs/.gitkeep
├── .env.example                # every variable, documented
├── ecosystem.config.js         # PM2 cluster config
├── Dockerfile, .dockerignore, docker-compose.yml
└── eslint.config.js
```

## Production notes

- Set `TRUST_PROXY` (usually `1`) when running behind a load balancer or reverse proxy, so `req.ip` and rate limiting use the real client IP.
- The rate limiter keeps its counters in memory, per process. With several instances, use a shared store such as `rate-limit-redis`.
- Set `CORS_ORIGIN` to explicit origins in production.
- Keep real credentials out of git. Use environment variables or a secret manager; `.env` is git-ignored.
- Consider setting `LOG_BODIES=false` in production, or at least review which fields get redacted.

## Serving an Angular app under a sub-path (nginx + PM2)

Target URL: `https://devvir.cognitivemobile.net/iqagent/<ANGULAR_APP_NAME>/`
(e.g. `https://devvir.cognitivemobile.net/iqagent/portal/`).

### Routing

| Path | Served by |
| --- | --- |
| `${APP_BASE_PATH}/health`, `/health/ready` | health routes (also at `/health` for local checks) |
| `${APP_BASE_PATH}/api/v1/...` | API (also at `/api/v1` for local checks) |
| `${APP_BASE_PATH}/api/customerOrderRequestEo` | EO bot endpoint (also at `/api/customerOrderRequestEo`) |
| `${APP_BASE_PATH}/<name>` | 301 → `${APP_BASE_PATH}/<name>/` |
| `${APP_BASE_PATH}/<name>/main.abc123.js` | static file, `Cache-Control: public, max-age=31536000, immutable` |
| `${APP_BASE_PATH}/<name>/` and deep links (`/orders/5`) | `index.html`, `Cache-Control: no-cache` |
| `${APP_BASE_PATH}/<name>/missing.js`, `.../api/...` | JSON 404 (no SPA fallback) |

Files whose name contains a hash (`main.abc123.js`, `styles-5INURTSO.css`) get the 1-year
immutable cache; everything else (index.html, favicon.ico, assets without hash) is `no-cache`.
Helmet's Content-Security-Policy is **disabled for the Angular paths only** (Angular's
critical-CSS inlining uses inline `<style>`/`onload` and apps often call other origins);
all other helmet headers stay on, and API/health keep the strict default CSP. Add a CSP in
nginx if you need one for the SPA. If the dist folder or `index.html` is missing at startup,
a warning is logged and the app is skipped (the API still starts).

### 1. Build Angular with the right base href (critical)

```bash
ng build --configuration production --base-href /iqagent/portal/
```

`--base-href` must equal `${APP_BASE_PATH}/${ANGULAR_APP_NAME}/` **with the trailing slash**.
It sets `<base href>` in index.html, which the browser uses to resolve `main-*.js`,
`styles-*.css`, `assets/...` and which the Angular router uses for deep links. With the
default `/`, the browser requests `https://devvir.cognitivemobile.net/main.js` (outside
`/iqagent/`) and the app loads blank.

### 2. Copy the output

Angular 17+ writes to `dist/<project>/browser/`; older versions to `dist/<project>/`.
Copy the folder that contains `index.html`:

```bash
mkdir -p public/portal && rsync -a --delete dist/portal/browser/ /path/to/node-prod-api/public/portal/
```

(or point `ANGULAR_DIST_PATH` straight at the build folder).

### 3. `.env`

```dotenv
TRUST_PROXY=1
APP_BASE_PATH=/iqagent
ANGULAR_ENABLED=true
ANGULAR_APP_NAME=portal
ANGULAR_DIST_PATH=./public/portal
# several apps: ANGULAR_APPS=portal:./public/portal,admin:./public/admin
```

### 4. Restart

```bash
pm2 restart ecosystem.config.js --env production   # or: npm run pm2:reload
```

Config is read at startup, so new dist files or `.env` changes need a restart/reload.

### 5. nginx

See [`docs/nginx.example.conf`](docs/nginx.example.conf): `location /iqagent/ { proxy_pass http://127.0.0.1:3000; }`
**without** a trailing slash on `proxy_pass`, so the `/iqagent` prefix reaches Node unchanged,
plus `Host`, `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto` headers (with `TRUST_PROXY=1`).

Check: `curl -I https://devvir.cognitivemobile.net/iqagent/health` and open
`https://devvir.cognitivemobile.net/iqagent/portal/`.
