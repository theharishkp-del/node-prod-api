'use strict';

/**
 * Application logger (winston).
 *
 * Transports:
 *  - Console: colourised, human-readable in development; JSON elsewhere (good for
 *    container log collectors).
 *  - logs/app-%DATE%.log   : all levels >= LOG_LEVEL, JSON lines.
 *  - logs/error-%DATE%.log : level "error" only, JSON lines.
 *
 * Rotation (winston-daily-rotate-file):
 *  - datePattern "GGGG-[W]WW" -> one file per ISO week (e.g. app-2026-W41.log).
 *  - maxSize       -> also rolls within a week when the file grows too big (.1, .2, ...).
 *  - zippedArchive -> rotated files are gzipped.
 *  - maxFiles      -> retention ("12w" = 12 weeks, or a plain file count).
 */
const os = require('os');
const fs = require('fs');
const path = require('path');
const util = require('util');
const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const config = require('./index');

const { combine, timestamp, json, colorize, printf } = winston.format;

/** Turns any Error found in the log metadata into a plain, JSON-friendly object. */
function serializeError(err, depth = 0) {
  if (!(err instanceof Error)) return err;
  const out = { name: err.name, message: err.message, stack: err.stack };
  for (const key of ['code', 'statusCode', 'errorCode', 'codeName']) {
    const v = err[key];
    if (v !== undefined && (typeof v === 'string' || typeof v === 'number')) out[key] = v;
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

const baseFormat = combine(timestamp(), errorSerializer());

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

// When running under PM2 cluster mode each worker writes its own file set, because
// winston-daily-rotate-file is not safe for several processes rotating the same file.
const instance = process.env.NODE_APP_INSTANCE;
const instanceSuffix = instance !== undefined ? `-${instance}` : '';

function fileTransport(name, level) {
  return new DailyRotateFile({
    level,
    dirname: config.log.dir,
    filename: `${name}-%DATE%${instanceSuffix}.log`,
    datePattern: config.log.datePattern,
    zippedArchive: true,
    maxSize: config.log.maxSize,
    maxFiles: config.log.maxFiles,
    auditFile: path.join(config.log.dir, `.${name}${instanceSuffix}-audit.json`),
    format: json(),
  });
}

const transports = [
  new winston.transports.Console({
    format: config.isDevelopment ? devConsoleFormat : json(),
  }),
];

const fileTransports = [];
if (config.log.toFile) {
  fs.mkdirSync(config.log.dir, { recursive: true });
  fileTransports.push(fileTransport('app', config.log.level), fileTransport('error', 'error'));
  transports.push(...fileTransports);
}

const logger = winston.createLogger({
  level: config.log.level,
  format: baseFormat,
  defaultMeta: {
    service: config.appName,
    env: config.env,
    pid: process.pid,
    hostname: os.hostname(),
  },
  transports,
  exitOnError: false,
});

// ---- Rotation / retention events ---------------------------------------------------
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
  t.on('error', (err) => {
    // Avoid recursion into the failing transport: report on stderr.
    process.stderr.write(`[logger] file transport error: ${err && err.stack}\n`);
  });
}

/**
 * Flush and close file transports. Call once during shutdown, after the last log line.
 * Resolves after all file streams have finished (or after `timeoutMs`).
 */
let flushed = null;
function flushLogger(timeoutMs = 3000) {
  if (flushed) return flushed;
  flushed = new Promise((resolve) => {
    // Let winston's internal stream pipeline hand pending entries to the transports.
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
