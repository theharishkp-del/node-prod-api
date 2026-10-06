'use strict';

const AppError = require('../utils/AppError');

/** Catch-all for unmatched routes; forwards a 404 AppError to the error handler. */
function notFound(req, res, next) {
  next(new AppError(`Route not found: ${req.method} ${req.path}`, 404, 'ROUTE_NOT_FOUND'));
}

module.exports = notFound;
