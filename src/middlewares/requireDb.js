'use strict';

const { getDatabaseState } = require('../config/database');
const AppError = require('../utils/AppError');

/** Short-circuits DB-backed routes with 503 while MongoDB is not connected. */
function requireDb(req, res, next) {
  if (!getDatabaseState().isConnected) {
    return next(new AppError('Database unavailable', 503, 'DATABASE_UNAVAILABLE'));
  }
  return next();
}

module.exports = requireDb;
