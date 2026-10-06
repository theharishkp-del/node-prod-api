'use strict';

const { rateLimit } = require('express-rate-limit');
const config = require('../config');
const AppError = require('../utils/AppError');

/**
 * Global rate limiter (in-memory store, per process).
 * For several instances/servers use a shared store, e.g. rate-limit-redis.
 */
const apiLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  limit: config.rateLimit.max,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res, next, options) =>
    next(new AppError('Too many requests, please try again later', options.statusCode)),
});

module.exports = { apiLimiter };
