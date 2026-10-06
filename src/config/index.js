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
});

// Treat empty strings ("FOO=") as "not set" so defaults apply.
const rawEnv = Object.fromEntries(
  Object.entries(process.env).filter(([, v]) => v !== undefined && v !== ''),
);

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
});

module.exports = config;
