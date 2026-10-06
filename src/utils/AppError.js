'use strict';

/**
 * Operational (expected) error carrying an HTTP status code.
 * Throw it anywhere in a request pipeline; the central error handler formats it.
 *
 *   throw new AppError('User not found', 404, 'USER_NOT_FOUND');
 */
class AppError extends Error {
  constructor(message, statusCode = 500, code = undefined, details = undefined) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code || AppError.defaultCode(statusCode);
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }

  static defaultCode(statusCode) {
    const codes = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      413: 'PAYLOAD_TOO_LARGE',
      422: 'UNPROCESSABLE_ENTITY',
      429: 'TOO_MANY_REQUESTS',
      503: 'SERVICE_UNAVAILABLE',
    };
    return codes[statusCode] || (statusCode >= 500 ? 'INTERNAL_ERROR' : 'ERROR');
  }

  static badRequest(message = 'Bad request', details) {
    return new AppError(message, 400, 'BAD_REQUEST', details);
  }

  static notFound(message = 'Resource not found') {
    return new AppError(message, 404, 'NOT_FOUND');
  }

  static conflict(message = 'Conflict') {
    return new AppError(message, 409, 'CONFLICT');
  }

  static serviceUnavailable(message = 'Service unavailable') {
    return new AppError(message, 503, 'SERVICE_UNAVAILABLE');
  }
}

module.exports = AppError;
