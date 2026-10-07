'use strict';

/**
 * @file Route guard for endpoints that need MongoDB: answers 503 DATABASE_UNAVAILABLE
 * (JSON error shape) right away instead of letting queries fail while disconnected.
 */
const { getDatabaseState } = require('../../config/database');
const AppError = require('../utils/AppError');

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function requireDb(req, res, next) {
  if (getDatabaseState().isConnected) return next();
  return next(new AppError('Database unavailable, please retry shortly', 503, 'DATABASE_UNAVAILABLE'));
}

module.exports = requireDb;
