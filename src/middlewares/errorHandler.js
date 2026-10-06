'use strict';

/**
 * Central error handler. Converts known error types into AppError, logs them and
 * sends a consistent JSON payload:
 *
 *   { "error": { "message": "...", "code": "...", "requestId": "...", "details": ... } }
 *
 * Stack traces are only included in development. Unknown (non-operational) errors
 * are reported as a generic 500 so internals never leak to clients.
 */
const mongoose = require('mongoose');
const { ZodError } = require('zod');
const config = require('../config');
const baseLogger = require('../config/logger');
const AppError = require('../utils/AppError');
const { sanitizeUrl } = require('../utils/sanitize');

const logger = baseLogger.child({ module: 'error-handler' });

function normaliseError(err) {
  if (err instanceof AppError) return err;

  if (err instanceof ZodError) {
    const details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    return new AppError('Validation failed', 400, 'VALIDATION_ERROR', details);
  }

  if (err instanceof mongoose.Error.ValidationError) {
    const details = Object.values(err.errors).map((e) => ({ path: e.path, message: e.message }));
    return new AppError('Validation failed', 400, 'VALIDATION_ERROR', details);
  }

  if (err instanceof mongoose.Error.CastError) {
    return new AppError(`Invalid value for ${err.path}`, 400, 'INVALID_ID');
  }

  if (err && err.code === 11000) {
    const fields = Object.keys(err.keyValue || err.keyPattern || {});
    return new AppError(
      `Duplicate value for ${fields.join(', ') || 'unique field'}`,
      409,
      'DUPLICATE_KEY',
    );
  }

  if (
    err instanceof mongoose.Error.MongooseServerSelectionError ||
    (err && /buffering timed out|Cannot call .* before initial connection/i.test(err.message))
  ) {
    return new AppError('Database unavailable', 503, 'DATABASE_UNAVAILABLE');
  }

  // body-parser & other http-errors style errors (e.g. invalid JSON, payload too large)
  const status = err && (err.statusCode || err.status);
  if (status && status >= 400 && status < 500) {
    const code =
      err.type === 'entity.parse.failed'
        ? 'INVALID_JSON'
        : err.type === 'entity.too.large'
          ? 'PAYLOAD_TOO_LARGE'
          : AppError.defaultCode(status);
    return new AppError(err.expose ? err.message : 'Bad request', status, code);
  }

  const wrapped = new AppError('Internal server error', 500, 'INTERNAL_ERROR');
  wrapped.isOperational = false;
  return wrapped;
}

function errorHandler(err, req, res, next) {
  const appError = normaliseError(err);
  const { statusCode } = appError;

  const logMeta = {
    event: 'http.error',
    requestId: req.id,
    method: req.method,
    url: sanitizeUrl(req.originalUrl || req.url),
    status: statusCode,
    code: appError.code,
  };

  if (!appError.isOperational) {
    // Unexpected bug: full error with stack trace goes to error log.
    logger.error(err.message || 'Unhandled error', { ...logMeta, err });
  } else if (statusCode >= 500) {
    logger.warn(appError.message, { ...logMeta, cause: err !== appError ? err.message : undefined });
  } else {
    logger.debug(appError.message, logMeta);
  }

  if (res.headersSent) {
    // Too late to send a JSON error; let Express close the connection.
    return next(err);
  }

  const body = {
    error: {
      message: appError.message,
      code: appError.code,
      requestId: req.id,
    },
  };
  if (appError.details) body.error.details = appError.details;
  if (config.isDevelopment && !appError.isOperational) body.error.stack = err.stack;

  return res.status(statusCode).json(body);
}

module.exports = errorHandler;
module.exports.normaliseError = normaliseError;
