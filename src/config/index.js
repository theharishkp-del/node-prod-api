'use strict';

/**
 * Centralised, validated configuration.
 *
 * - Loads variables from `.env` (if present) via dotenv.
 * - Validates them with a zod schema.
 * - Fails fast (exit code 1) with a readable list of problems.
 *
 * Every other module should read config from here, never from process.env directly.
 */
const path = require('path');
const dotenv = require('dotenv');
const { z } = require('zod');

dotenv.config({ path: path.resolve(process.cwd(), '.env'), quiet: true });

const csv = (value) =>
  String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const LOG_LEVELS = ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'];

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  APP_NAME: z.string().min(1).default('node-prod-api'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),

  // Express "trust proxy": true | false | number of hops | comma-separated IPs/subnets
  TRUST_PROXY: z.string().default('false'),
  BODY_LIMIT: z
    .string()
    .regex(/^\d+(b|kb|mb)$/i, 'must look like 100kb, 1mb, 512b')
    .default('100kb'),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1000).default(10000),

  // MongoDB
  MONGODB_URI: z
    .string({ error: 'MONGODB_URI is required' })
    .regex(/^mongodb(\+srv)?:\/\//, 'must start with mongodb:// or mongodb+srv://'),
  MONGO_MAX_POOL_SIZE: z.coerce.number().int().min(1).default(10),
  MONGO_MIN_POOL_SIZE: z.coerce.number().int().min(0).default(0),
  MONGO_SERVER_SELECTION_TIMEOUT_MS: z.coerce.number().int().min(500).default(5000),
  MONGO_SOCKET_TIMEOUT_MS: z.coerce.number().int().min(1000).default(45000),
  MONGO_AUTO_INDEX: z.stringbool().default(true),
  MONGO_CONNECT_RETRIES: z.coerce.number().int().min(0).default(10), // 0 = retry forever
  MONGO_RETRY_INITIAL_DELAY_MS: z.coerce.number().int().min(100).default(1000),
  MONGO_RETRY_MAX_DELAY_MS: z.coerce.number().int().min(100).default(30000),

  // Logging
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  LOG_DIR: z.string().min(1).default('logs'),
  LOG_TO_FILE: z.stringbool().default(true),
  LOG_BODIES: z.stringbool().default(false),
  LOG_BODY_MAX_LENGTH: z.coerce.number().int().min(100).default(2000),
  LOG_REDACT_FIELDS: z.string().default(''),
  LOG_IGNORE_PATHS: z.string().default(''),
  LOG_DATE_PATTERN: z.string().min(1).default('GGGG-[W]WW'), // ISO week, e.g. 2026-W41
  LOG_MAX_FILES: z
    .string()
    .regex(/^\d+[dw]?$/i, "must be a file count (e.g. 12) or an age like '12w' / '84d'")
    .default('12w'),
  LOG_MAX_SIZE: z
    .string()
    .regex(/^\d+[kmg]$/i, "must look like '20m', '500k' or '1g'")
    .default('20m'),

  // HTTP / security
  CORS_ORIGIN: z.string().default('*'),
  CORS_CREDENTIALS: z.stringbool().default(false),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(15 * 60 * 1000),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(100),

  // Sub-path / Angular static hosting
  APP_BASE_PATH: z
    .string()
    .regex(/^[A-Za-z0-9._~/-]*$/, 'may only contain URL path characters, e.g. /iqagent')
    .default('/iqagent'),
  ANGULAR_ENABLED: z.stringbool().default(false),
  ANGULAR_APP_NAME: z
    .string()
    .regex(/^[A-Za-z0-9._~-]+$/, 'must be a single URL segment, e.g. portal')
    .optional(),
  ANGULAR_DIST_PATH: z.string().min(1).optional(),
  ANGULAR_APPS: z
    .string()
    .regex(
      /^\s*[A-Za-z0-9._~-]+:[^,]+(\s*,\s*[A-Za-z0-9._~-]+:[^,]+)*\s*$/,
      "must look like 'name1:path1,name2:path2'",
    )
    .optional(),

  // EO (bot conversation step) endpoint: POST /api/customerOrderRequestEo
  EO_FROM_SERVER: z.string().min(1).default('FSMAGENT'),
  // Unset -> true unless NODE_ENV=production (resolved below).
  EO_LOG_FULL: z.stringbool().optional(),
  // TODO(placeholder): base URL used in the order link until the real key-token format is known.
  EO_ORDER_BASE_URL: z.url({ protocol: /^https?$/, error: 'must be an absolute http(s) URL' }).optional(),
});

// Treat empty strings ("FOO=") as "not set" so defaults apply.
const rawEnv = Object.fromEntries(
  Object.entries(process.env).filter(([, v]) => v !== undefined && v !== ''),
);

// APP_BASE_PATH= (empty) explicitly means "serve at the root", so keep it.
if (process.env.APP_BASE_PATH === '') rawEnv.APP_BASE_PATH = '';

const parsed = envSchema.safeParse(rawEnv);

if (!parsed.success) {
  const problems = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  // Logger is not available yet (it depends on config) so write straight to stderr.
  process.stderr.write(
    `\n[config] Invalid environment configuration:\n${problems}\n\n` +
      'Copy .env.example to .env and fix the values above.\n\n',
  );
  process.exit(1);
}

const env = parsed.data;

if (env.MONGO_MIN_POOL_SIZE > env.MONGO_MAX_POOL_SIZE) {
  process.stderr.write('[config] MONGO_MIN_POOL_SIZE cannot be greater than MONGO_MAX_POOL_SIZE\n');
  process.exit(1);
}

if (env.CORS_CREDENTIALS && csv(env.CORS_ORIGIN).includes('*')) {
  process.stderr.write(
    '[config] CORS_CREDENTIALS=true cannot be combined with CORS_ORIGIN=*; list explicit origins\n',
  );
  process.exit(1);
}

/** '/iqagent/' | 'iqagent' -> '/iqagent'; '' | '/' -> '' (root). */
function normaliseBasePath(value) {
  const trimmed = String(value || '').trim().replace(/\/{2,}/g, '/').replace(/^\/+|\/+$/g, '');
  return trimmed ? `/${trimmed}` : '';
}

/** Resolve the Angular app list from ANGULAR_APPS and/or ANGULAR_APP_NAME + ANGULAR_DIST_PATH. */
function parseAngularApps(e) {
  const apps = [];
  if (e.ANGULAR_APPS) {
    for (const pair of csv(e.ANGULAR_APPS)) {
      const idx = pair.indexOf(':');
      apps.push({ name: pair.slice(0, idx).trim(), distPath: pair.slice(idx + 1).trim() });
    }
  }
  if (e.ANGULAR_APP_NAME && e.ANGULAR_DIST_PATH) {
    apps.push({ name: e.ANGULAR_APP_NAME, distPath: e.ANGULAR_DIST_PATH });
  }
  const seen = new Set();
  return apps
    .filter((a) => (seen.has(a.name) ? false : seen.add(a.name)))
    .map((a) => Object.freeze({ name: a.name, distPath: path.resolve(process.cwd(), a.distPath) }));
}

if (env.ANGULAR_ENABLED && !env.ANGULAR_APPS && !(env.ANGULAR_APP_NAME && env.ANGULAR_DIST_PATH)) {
  process.stderr.write(
    '[config] ANGULAR_ENABLED=true requires ANGULAR_APP_NAME + ANGULAR_DIST_PATH (or ANGULAR_APPS)\n',
  );
  process.exit(1);
}

/** Express trust proxy accepts boolean, hop count, or a string list of addresses. */
function parseTrustProxy(value) {
  const v = value.trim().toLowerCase();
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^\d+$/.test(v)) return Number(v);
  return value.trim();
}

/** winston-daily-rotate-file understands "N" (files) or "Nd" (days); add "Nw" (weeks). */
function normaliseMaxFiles(value) {
  const m = /^(\d+)([dw]?)$/i.exec(value);
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  if (unit === 'w') return `${n * 7}d`;
  if (unit === 'd') return `${n}d`;
  return n;
}

/** Parse CORS_ORIGIN: "*" or comma-separated list of origins. */
function parseCorsOrigin(value) {
  const list = csv(value);
  if (list.length === 0 || list.includes('*')) return '*';
  return list.length === 1 ? list[0] : list;
}

const config = Object.freeze({
  env: env.NODE_ENV,
  isProduction: env.NODE_ENV === 'production',
  isDevelopment: env.NODE_ENV === 'development',
  isTest: env.NODE_ENV === 'test',
  appName: env.APP_NAME,
  host: env.HOST,
  port: env.PORT,
  trustProxy: parseTrustProxy(env.TRUST_PROXY),
  bodyLimit: env.BODY_LIMIT,
  shutdownTimeoutMs: env.SHUTDOWN_TIMEOUT_MS,

  mongo: Object.freeze({
    uri: env.MONGODB_URI,
    maxPoolSize: env.MONGO_MAX_POOL_SIZE,
    minPoolSize: env.MONGO_MIN_POOL_SIZE,
    serverSelectionTimeoutMS: env.MONGO_SERVER_SELECTION_TIMEOUT_MS,
    socketTimeoutMS: env.MONGO_SOCKET_TIMEOUT_MS,
    autoIndex: env.MONGO_AUTO_INDEX,
    connectRetries: env.MONGO_CONNECT_RETRIES,
    retryInitialDelayMs: env.MONGO_RETRY_INITIAL_DELAY_MS,
    retryMaxDelayMs: env.MONGO_RETRY_MAX_DELAY_MS,
  }),

  log: Object.freeze({
    level: env.LOG_LEVEL,
    dir: path.resolve(process.cwd(), env.LOG_DIR),
    toFile: env.LOG_TO_FILE,
    bodies: env.LOG_BODIES,
    bodyMaxLength: env.LOG_BODY_MAX_LENGTH,
    redactFields: csv(env.LOG_REDACT_FIELDS),
    ignorePaths: csv(env.LOG_IGNORE_PATHS),
    datePattern: env.LOG_DATE_PATTERN,
    maxFiles: normaliseMaxFiles(env.LOG_MAX_FILES),
    maxSize: env.LOG_MAX_SIZE.toLowerCase(),
  }),

  cors: Object.freeze({
    origin: parseCorsOrigin(env.CORS_ORIGIN),
    credentials: env.CORS_CREDENTIALS,
  }),

  rateLimit: Object.freeze({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX,
  }),

  basePath: normaliseBasePath(env.APP_BASE_PATH),

  angular: Object.freeze({
    enabled: env.ANGULAR_ENABLED,
    apps: Object.freeze(parseAngularApps(env)),
  }),

  eo: Object.freeze({
    fromServer: env.EO_FROM_SERVER,
    logFull: env.EO_LOG_FULL ?? env.NODE_ENV !== 'production',
    orderBaseUrl: env.EO_ORDER_BASE_URL || '',
  }),
});

module.exports = config;
