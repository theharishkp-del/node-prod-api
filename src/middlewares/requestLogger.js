'use strict';

/**
 * Logs one structured line per request when the response finishes (or the client
 * aborts). Includes method, URL, status, response time, request id, IP, user agent,
 * content lengths and - when LOG_BODIES=true - redacted/truncated request & response
 * bodies.
 *
 * Level: info for 1xx-3xx, warn for 4xx, error for 5xx/aborted.
 */
const config = require('../config');
const baseLogger = require('../config/logger');
const { safeBody, sanitizeUrl } = require('../utils/sanitize');

const logger = baseLogger.child({ module: 'http' });

/** Capture whatever is passed to res.send()/res.json() so it can be logged. */
function captureResponseBody(res) {
  const originalSend = res.send;
  res.send = function sendWithCapture(body) {
    // res.json() calls res.send() with a string; only keep the first (outermost) call.
    if (res.locals.__body === undefined) res.locals.__body = body;
    return originalSend.call(this, body);
  };
}

function parseCapturedBody(res) {
  const body = res.locals.__body;
  if (body === undefined || body === null || body === '') return undefined;
  if (Buffer.isBuffer(body)) return `[Buffer ${body.length} bytes]`;
  if (typeof body === 'string') {
    const type = String(res.get('content-type') || '');
    if (type.includes('json')) {
      try {
        return JSON.parse(body);
      } catch {
        return body;
      }
    }
    return body;
  }
  return body;
}

function requestLogger(req, res, next) {
  const path = req.path || req.originalUrl;
  if (config.log.ignorePaths.includes(path)) return next();

  const start = process.hrtime.bigint();
  if (config.log.bodies) captureResponseBody(res);

  let logged = false;
  const log = (event) => {
    if (logged) return;
    logged = true;

    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    const aborted = event === 'close' && !res.writableFinished;
    const status = res.statusCode;

    const entry = {
      event: 'http.request',
      requestId: req.id,
      method: req.method,
      url: sanitizeUrl(req.originalUrl || req.url),
      status,
      responseTimeMs: Math.round(durationMs * 100) / 100,
      ip: req.ip,
      userAgent: req.get('user-agent'),
      referer: req.get('referer'),
      reqContentLength: Number(req.get('content-length')) || 0,
      resContentLength: Number(res.get('content-length')) || 0,
    };
    if (aborted) entry.aborted = true;

    if (config.log.bodies) {
      if (req.body !== undefined && Object.keys(req.body || {}).length > 0) {
        entry.reqBody = safeBody(req.body);
      }
      const resBody = parseCapturedBody(res);
      if (resBody !== undefined) entry.resBody = safeBody(resBody);
    }

    const message = `${req.method} ${entry.url} ${status} ${entry.responseTimeMs}ms`;
    if (aborted || status >= 500) logger.error(message, entry);
    else if (status >= 400) logger.warn(message, entry);
    else logger.info(message, entry);
  };

  res.on('finish', () => log('finish'));
  res.on('close', () => log('close'));
  next();
}

module.exports = requestLogger;
