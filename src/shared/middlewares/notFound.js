'use strict';

/** @file Catch-all for unmatched routes (mounted after every router). */
const AppError = require('../utils/AppError');

/**
 * Forward a 404 ROUTE_NOT_FOUND AppError to the error handler.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function notFound(req, res, next) {
  next(new AppError(`Route not found: ${req.method} ${req.path}`, 404, 'ROUTE_NOT_FOUND'));
}

module.exports = notFound;
