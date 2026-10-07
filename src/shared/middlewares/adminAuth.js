'use strict';

/**
 * @file Admin API authentication: a static API key sent in the `x-admin-key` header.
 *
 *  - ADMIN_API_KEY set   -> every /api/admin/* request must send the exact key (401 otherwise).
 *  - ADMIN_API_KEY unset -> allowed (development/test only; config refuses to start in
 *    production without it) and a warning is logged once.
 * Keys are compared in constant time (SHA-256 digests + timingSafeEqual).
 */
const crypto = require('crypto');
const config = require('../../config');
const baseLogger = require('../../config/logger');
const AppError = require('../utils/AppError');

const logger = baseLogger.child({ module: 'admin-auth' });

/** Request header carrying the admin key. */
const ADMIN_KEY_HEADER = 'x-admin-key';

/**
 * Constant-time string comparison (lengths are hidden by hashing first).
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/**
 * Build the admin auth middleware.
 * @param {object} [options]
 * @param {string} [options.apiKey=config.admin.apiKey] Expected key; '' disables the check.
 * @returns {import('express').RequestHandler} Sets req.adminAuth = { authRequired }.
 */
function createAdminAuth({ apiKey = config.admin.apiKey } = {}) {
  let warned = false;
  return function adminAuth(req, res, next) {
    if (!apiKey) {
      if (!warned) {
        warned = true;
        logger.warn('ADMIN_API_KEY is not set: the admin API is OPEN (allowed outside production only)', {
          event: 'admin.auth_disabled',
        });
      }
      req.adminAuth = { authRequired: false };
      return next();
    }
    const provided = req.get(ADMIN_KEY_HEADER);
    if (!provided || !safeEqual(provided, apiKey)) {
      return next(new AppError('Missing or invalid admin API key', 401, 'UNAUTHORIZED'));
    }
    req.adminAuth = { authRequired: true };
    return next();
  };
}

module.exports = { createAdminAuth, ADMIN_KEY_HEADER, safeEqual };
