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

Errors always look like `{ "error": { "message", "code", "requestId", "details?" } }`.

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
│   ├── routes                  # index.js (/api/v1), health.routes.js, user.routes.js
│   ├── controllers             # health.controller.js, user.controller.js
│   ├── models                  # user.model.js (scrypt password hash, hidden in JSON)
│   └── utils                   # AppError.js, asyncHandler.js, sanitize.js (redact/truncate)
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
