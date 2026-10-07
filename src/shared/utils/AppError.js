'use strict';

/**
 * @file Operational (expected) error carrying an HTTP status code.
 *
 * Throw it anywhere in a request pipeline; the central error handler formats it:
 *   throw new AppError('Order not found', 404, 'ORDER_NOT_FOUND');
 */
class AppError extends Error {
  /**
   * @param {string} message Client-safe message.
   * @param {number} [statusCode=500] HTTP status code.
   * @param {string} [code] Machine-readable code; derived from the status when omitted.
   * @param {*} [details] Optional extra data returned to the client (e.g. validation issues).
   */
  constructor(message, statusCode = 500, code = undefined, details = undefined) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code || AppError.defaultCode(statusCode);
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Default machine-readable code for an HTTP status.
   * @param {number} statusCode
   * @returns {string}
   */
  static defaultCode(statusCode) {
    const codes = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      413: 'PAYLOAD_TOO_LARGE',
      422: 'UNPROCESSABLE_ENTITY',
      503: 'SERVICE_UNAVAILABLE',
    };
    return codes[statusCode] || (statusCode >= 500 ? 'INTERNAL_ERROR' : 'ERROR');
  }

  /**
   * @param {string} [message='Bad request']
   * @param {*} [details]
   * @returns {AppError} 400 BAD_REQUEST
   */
  static badRequest(message = 'Bad request', details) {
    return new AppError(message, 400, 'BAD_REQUEST', details);
  }

  /**
   * @param {string} [message='Resource not found']
   * @returns {AppError} 404 NOT_FOUND
   */
  static notFound(message = 'Resource not found') {
    return new AppError(message, 404, 'NOT_FOUND');
  }

  /**
   * @param {string} [message='Conflict']
   * @returns {AppError} 409 CONFLICT
   */
  static conflict(message = 'Conflict') {
    return new AppError(message, 409, 'CONFLICT');
  }

  /**
   * @param {string} [message='Service unavailable']
   * @returns {AppError} 503 SERVICE_UNAVAILABLE
   */
  static serviceUnavailable(message = 'Service unavailable') {
    return new AppError(message, 503, 'SERVICE_UNAVAILABLE');
  }
}

module.exports = AppError;
