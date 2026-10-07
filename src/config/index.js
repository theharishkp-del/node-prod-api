'use strict';

/**
 * @file Centralised, validated configuration.
 *
 * Loads `.env` (if present) with dotenv, validates every variable with a zod schema and
 * exits with a readable list of problems when something is missing or malformed.
 * Every other module reads configuration from here, never from process.env directly.
 */
const path = require('path');
const dotenv = require('dotenv');
const { z } = require('zod');

dotenv.config({ path: path.resolve(process.cwd(), '.env'), quiet: true });

const LOG_LEVELS = ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'];
const LOG_ROTATE_FREQUENCIES = ['weekly', 'daily'];

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  APP_NAME: z.string().min(1).default('node-prod-api'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
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
  LOG_IGNORE_PATHS: z.string().default(''),
  LOG_ROTATE_FREQUENCY: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.enum(LOG_ROTATE_FREQUENCIES, { error: "must be 'weekly' or 'daily'" }))
    .default('weekly'),
  LOG_RETENTION_DAYS: z.coerce.number().int().min(1).default(30),
  LOG_MAX_SIZE: z
    .string()
    .regex(/^\d+[kmg]$/i, "must look like '20m', '500k' or '1g'")
    .default('20m'),

  // HTTP
  CORS_ORIGIN: z.string().default('*'),
  CORS_CREDENTIALS: z.stringbool().default(false),

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

  // EO (bot conversation step) endpoints, e.g. POST /api/customerOrderRequestEo
  EO_FROM_SERVER: z.string().min(1).default('FSMAGENT'),
  // Unset -> true unless NODE_ENV=production (resolved below).
  EO_LOG_FULL: z.stringbool().optional(),
  // TODO(placeholder): base URL used in the order link until the real key-token format is known.
  EO_ORDER_BASE_URL: z.url({ protocol: /^https?$/, error: 'must be an absolute http(s) URL' }).optional(),
});

/**
 * Split a comma-separated string into trimmed, non-empty items.
 * @param {string|undefined} value
 * @returns {string[]}
 */
const csv = (value) =>
  String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * Print a configuration problem and stop the process (the logger depends on config,
 * so it is not available yet).
 * @param {string} message
 */
function fail(message) {
  process.stderr.write(`\n[config] ${message}\n\n`);
  process.exit(1);
}

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
  fail(`Invalid environment configuration:\n${problems}\n\nCopy .env.example to .env and fix the values above.`);
}

const env = parsed.data;

if (env.MONGO_MIN_POOL_SIZE > env.MONGO_MAX_POOL_SIZE) {
  fail('MONGO_MIN_POOL_SIZE cannot be greater than MONGO_MAX_POOL_SIZE');
}
if (env.CORS_CREDENTIALS && csv(env.CORS_ORIGIN).includes('*')) {
  fail('CORS_CREDENTIALS=true cannot be combined with CORS_ORIGIN=*; list explicit origins');
}
if (env.ANGULAR_ENABLED && !env.ANGULAR_APPS && !(env.ANGULAR_APP_NAME && env.ANGULAR_DIST_PATH)) {
  fail('ANGULAR_ENABLED=true requires ANGULAR_APP_NAME + ANGULAR_DIST_PATH (or ANGULAR_APPS)');
}

/**
 * Normalise the URL prefix: '/iqagent/' | 'iqagent' -> '/iqagent'; '' | '/' -> '' (root).
 * @param {string} value
 * @returns {string}
 */
function normaliseBasePath(value) {
  const trimmed = String(value || '').trim().replace(/\/{2,}/g, '/').replace(/^\/+|\/+$/g, '');
  return trimmed ? `/${trimmed}` : '';
}

/**
 * Resolve the Angular app list from ANGULAR_APPS and/or ANGULAR_APP_NAME + ANGULAR_DIST_PATH.
 * Duplicate names keep the first entry; dist paths are made absolute.
 * @param {object} e Parsed environment.
 * @returns {Array<{name: string, distPath: string}>}
 */
function parseAngularApps(e) {
  const apps = [];
  for (const pair of csv(e.ANGULAR_APPS)) {
    const idx = pair.indexOf(':');
    apps.push({ name: pair.slice(0, idx).trim(), distPath: pair.slice(idx + 1).trim() });
  }
  if (e.ANGULAR_APP_NAME && e.ANGULAR_DIST_PATH) {
    apps.push({ name: e.ANGULAR_APP_NAME, distPath: e.ANGULAR_DIST_PATH });
  }
  const seen = new Set();
  return apps
    .filter((a) => (seen.has(a.name) ? false : seen.add(a.name)))
    .map((a) => Object.freeze({ name: a.name, distPath: path.resolve(process.cwd(), a.distPath) }));
}

/**
 * Parse CORS_ORIGIN: '*' or a comma-separated list of origins.
 * @param {string} value
 * @returns {string|string[]}
 */
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
    ignorePaths: csv(env.LOG_IGNORE_PATHS),
    rotateFrequency: env.LOG_ROTATE_FREQUENCY,
    retentionDays: env.LOG_RETENTION_DAYS,
    maxSize: env.LOG_MAX_SIZE.toLowerCase(),
  }),

  cors: Object.freeze({
    origin: parseCorsOrigin(env.CORS_ORIGIN),
    credentials: env.CORS_CREDENTIALS,
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
