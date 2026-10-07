import { logger } from '../config/logger.js';

export function notFoundHandler(req, res) {
  logger.warn('Route not found', {
    requestId: req.requestId,
    method: req.method,
    path: req.originalUrl,
  });

  res.status(404).json({
    status: 'not_found',
    message: `Route ${req.method} ${req.originalUrl} was not found.`,
  });
}

export function errorHandler(error, req, res, _next) {
  const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;

  logger.error('Unhandled server error', {
    requestId: req.requestId,
    method: req.method,
    path: req.originalUrl,
    statusCode,
    requestFlow: req.requestFlow || [],
    error: {
      message: error?.message,
      stack: error?.stack,
      name: error?.name,
    },
  });

  res.status(statusCode).json({
    status: 'error',
    message: error?.message || 'Unexpected server error.',
  });
}
