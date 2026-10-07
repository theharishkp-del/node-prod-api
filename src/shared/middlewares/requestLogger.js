'use strict';

/**
 * @file Access log: one structured entry per request when the response finishes (or the
 * client aborts) with method, URL, status, response time, IP, user agent and content
 * lengths. With LOG_BODIES=true the request/response bodies are added as-is, only
 * truncated to LOG_BODY_MAX_LENGTH characters.
 *
 * Level: info for 1xx-3xx, warn for 4xx, error for 5xx/aborted.
 */
const config = require('../../config');
const baseLogger = require('../../config/logger');
const { truncate } = require('../utils/truncate');

const logger = baseLogger.child({ module: 'http' });

/**
 * Keep a copy of whatever is passed to res.send()/res.json() so it can be logged.
 * @param {import('express').Response} res
 */
function captureResponseBody(res) {
  const originalSend = res.send;
  res.send = function sendWithCapture(body) {
    // res.json() calls res.send() again with a string; keep only the outermost call.
    if (res.locals.capturedBody === undefined && !res.locals.isStaticAsset) {
      res.locals.capturedBody = body;
    }
    return originalSend.call(this, body);
  };
}

/**
 * Captured response body in a loggable form (JSON strings parsed back to objects).
 * @param {import('express').Response} res
 * @returns {*}
 */
function parseCapturedBody(res) {
  const body = res.locals.capturedBody;
  if (body === undefined || body === null || body === '') return undefined;
  if (Buffer.isBuffer(body)) return `[Buffer ${body.length} bytes]`;
  if (typeof body === 'string' && String(res.get('content-type') || '').includes('json')) {
    try {
      return JSON.parse(body);
    } catch {
      return body;
    }
  }
  return body;
}

/**
 * Express middleware that writes the access log entry for each request.
 * Paths listed in LOG_IGNORE_PATHS are skipped.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function requestLogger(req, res, next) {
  if (config.log.ignorePaths.includes(req.path)) return next();

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
      method: req.method,
      url: req.originalUrl || req.url,
      status,
      responseTimeMs: Math.round(durationMs * 100) / 100,
      ip: req.ip,
      userAgent: req.get('user-agent'),
      referer: req.get('referer'),
      reqContentLength: Number(req.get('content-length')) || 0,
      resContentLength: Number(res.get('content-length')) || 0,
    };
    if (aborted) entry.aborted = true;

    // Static assets never log bodies. Routes that log their own full bodies (EO with
    // EO_LOG_FULL=true) set res.locals.bodyLoggedSeparately to avoid a truncated duplicate.
    if (config.log.bodies && res.locals.bodyLoggedSeparately) {
      entry.bodiesLoggedAs = res.locals.bodyLoggedSeparately;
    } else if (config.log.bodies && !res.locals.isStaticAsset) {
      if (req.body && Object.keys(req.body).length > 0) {
        entry.reqBody = truncate(req.body, config.log.bodyMaxLength);
      }
      const resBody = parseCapturedBody(res);
      if (resBody !== undefined) entry.resBody = truncate(resBody, config.log.bodyMaxLength);
    }

    const message = `${req.method} ${entry.url} ${status} ${entry.responseTimeMs}ms`;
    if (aborted || status >= 500) logger.error(message, entry);
    else if (status >= 400) logger.warn(message, entry);
    else logger.info(message, entry);
  };

  res.on('finish', () => log('finish'));
  res.on('close', () => log('close'));
  return next();
}

module.exports = requestLogger;
