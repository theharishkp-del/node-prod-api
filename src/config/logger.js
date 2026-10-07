'use strict';

/**
 * @file Application logger (winston).
 *
 * Transports:
 *  - Console: colourised and human-readable in development, JSON lines elsewhere.
 *  - <LOG_DIR>/app-%DATE%.log   : every entry >= LOG_LEVEL, JSON lines.
 *  - <LOG_DIR>/error-%DATE%.log : "error" entries only, JSON lines.
 *
 * Rotation (winston-daily-rotate-file) is driven by env, see buildRotationOptions():
 *  - LOG_ROTATE_FREQUENCY weekly (default) -> app-2026-W41.log, daily -> app-2026-10-07.log
 *  - LOG_RETENTION_DAYS   -> files older than N days are deleted ('Nd')
 *  - LOG_MAX_SIZE         -> also rolls within a period when a file grows too big (.1, .2 ...)
 *  - rotated files are gzipped
 */
const os = require('os');
const fs = require('fs');
const path = require('path');
const util = require('util');
const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const config = require('./index');

const { combine, timestamp, json, colorize, printf } = winston.format;

/** moment.js date patterns per rotation frequency ('GGGG-[W]WW' = ISO week-year + week). */
const DATE_PATTERNS = Object.freeze({
  weekly: 'GGGG-[W]WW',
  daily: 'YYYY-MM-DD',
});

/**
 * Map the logging config to winston-daily-rotate-file rotation options.
 * @param {object} logConfig
 * @param {'weekly'|'daily'} [logConfig.rotateFrequency='weekly']
 * @param {number} logConfig.retentionDays Number of days to keep log files.
 * @param {string} logConfig.maxSize Size threshold such as '20m'.
 * @returns {{datePattern: string, maxFiles: string, maxSize: string, zippedArchive: boolean}}
 */
function buildRotationOptions({ rotateFrequency = 'weekly', retentionDays, maxSize }) {
  const datePattern = DATE_PATTERNS[rotateFrequency];
  if (!datePattern) throw new Error(`Unknown log rotation frequency: ${rotateFrequency}`);
  return {
    datePattern,
    maxFiles: `${retentionDays}d`,
    maxSize,
    zippedArchive: true,
  };
}

/**
 * Turn an Error into a plain, JSON-friendly object (follows Error causes, max 3 levels).
 * @param {*} err Any value; non-Errors are returned unchanged.
 * @param {number} [depth=0]
 * @returns {*}
 */
function serializeError(err, depth = 0) {
  if (!(err instanceof Error)) return err;
  const out = { name: err.name, message: err.message, stack: err.stack };
  for (const key of ['code', 'statusCode', 'errorCode', 'codeName']) {
    const v = err[key];
    if (typeof v === 'string' || typeof v === 'number') out[key] = v;
  }
  // Only follow Error causes (driver errors can carry huge topology objects elsewhere).
  if (err.cause instanceof Error && depth < 3) out.cause = serializeError(err.cause, depth + 1);
  return out;
}

const errorSerializer = winston.format((info) => {
  if (info instanceof Error) {
    return Object.assign(info, { message: info.message, stack: info.stack });
  }
  for (const key of Object.keys(info)) {
    if (info[key] instanceof Error) info[key] = serializeError(info[key]);
  }
  return info;
});

const devConsoleFormat = combine(
  colorize(),
  printf((info) => {
    const { timestamp: ts, level, message } = info;
    const hidden = new Set(['timestamp', 'level', 'message', 'service', 'env', 'pid', 'hostname']);
    // Object.keys skips winston's internal Symbol properties.
    const meta = {};
    for (const key of Object.keys(info)) if (!hidden.has(key)) meta[key] = info[key];
    const metaStr = Object.keys(meta).length
      ? `\n${util.inspect(meta, { depth: 6, colors: true, breakLength: 120 })}`
      : '';
    return `${ts} ${level}: ${message}${metaStr}`;
  }),
);

// Several processes must not rotate the same file, so cluster workers (NODE_APP_INSTANCE,
// set e.g. by PM2) each get their own file set.
const instance = process.env.NODE_APP_INSTANCE;
const instanceSuffix = instance !== undefined ? `-${instance}` : '';
const rotation = buildRotationOptions(config.log);

/**
 * Create a rotating JSON file transport.
 * @param {string} name File prefix ('app' or 'error').
 * @param {string} level Minimum level written to the file.
 * @returns {DailyRotateFile}
 */
function fileTransport(name, level) {
  return new DailyRotateFile({
    ...rotation,
    level,
    dirname: config.log.dir,
    filename: `${name}-%DATE%${instanceSuffix}.log`,
    auditFile: path.join(config.log.dir, `.${name}${instanceSuffix}-audit.json`),
    format: json(),
  });
}

const transports = [
  new winston.transports.Console({ format: config.isDevelopment ? devConsoleFormat : json() }),
];

const fileTransports = [];
if (config.log.toFile) {
  fs.mkdirSync(config.log.dir, { recursive: true });
  fileTransports.push(fileTransport('app', config.log.level), fileTransport('error', 'error'));
  transports.push(...fileTransports);
}

const logger = winston.createLogger({
  level: config.log.level,
  format: combine(timestamp(), errorSerializer()),
  defaultMeta: {
    service: config.appName,
    env: config.env,
    pid: process.pid,
    hostname: os.hostname(),
  },
  transports,
  exitOnError: false,
});

// Rotation / retention lifecycle events.
for (const t of fileTransports) {
  t.on('new', (filename) => logger.info('Log file opened', { event: 'log.new', filename }));
  t.on('rotate', (oldFilename, newFilename) =>
    logger.info('Log file rotated', { event: 'log.rotate', oldFilename, newFilename }),
  );
  t.on('archive', (zipFilename) =>
    logger.info('Rotated log archived', { event: 'log.archive', zipFilename }),
  );
  t.on('logRemoved', (removedFilename) =>
    logger.info('Old log file removed (retention)', { event: 'log.removed', removedFilename }),
  );
  // Report on stderr to avoid recursing into the failing transport.
  t.on('error', (err) => process.stderr.write(`[logger] file transport error: ${err && err.stack}\n`));
}

let flushed = null;

/**
 * Flush and close the file transports. Call once during shutdown, after the last log line.
 * @param {number} [timeoutMs=3000] Maximum time to wait for the streams to finish.
 * @returns {Promise<void>} Resolves when all file streams have finished (or on timeout).
 */
function flushLogger(timeoutMs = 3000) {
  if (flushed) return flushed;
  flushed = new Promise((resolve) => {
    // Let winston's internal stream pipeline hand pending entries to the transports first.
    setTimeout(() => {
      if (fileTransports.length === 0) return resolve();
      let pending = fileTransports.length;
      const timer = setTimeout(resolve, timeoutMs);
      timer.unref();
      const done = () => {
        pending -= 1;
        if (pending === 0) {
          clearTimeout(timer);
          resolve();
        }
      };
      for (const t of fileTransports) {
        t.once('finish', done);
        t.close();
      }
    }, 50);
  });
  return flushed;
}

module.exports = logger;
module.exports.flushLogger = flushLogger;
module.exports.serializeError = serializeError;
module.exports.buildRotationOptions = buildRotationOptions;
module.exports.DATE_PATTERNS = DATE_PATTERNS;
