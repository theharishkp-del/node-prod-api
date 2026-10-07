'use strict';

/**
 * @file Admin API, mounted at /api/admin (and under APP_BASE_PATH).
 *
 *   adminAuth (x-admin-key)            -> 401 when ADMIN_API_KEY is set and the key is wrong
 *   GET  /auth/check                   -> verifies the key (works without MongoDB)
 *   requireDb                          -> 503 DATABASE_UNAVAILABLE while MongoDB is down
 *   /stats, /organizations[...], /bots[...]
 *
 * Success bodies: { success: true, data, meta? }; errors: { error: { message, code, details? } }.
 */
const { Router } = require('express');
const { createAdminAuth } = require('../../shared/middlewares/adminAuth');
const requireDb = require('../../shared/middlewares/requireDb');
const asyncHandler = require('../../shared/utils/asyncHandler');
const { sendSuccess } = require('../../shared/utils/apiResponse');
const organizationsRoutes = require('./organizations/organizations.routes');
const botsRoutes = require('./bots/bots.routes');
const { stats } = require('./stats/stats.controller');

const router = Router();

router.use(createAdminAuth());
// Admin responses are per-request data: never cache them in browsers or proxies.
router.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

router.get('/auth/check', (req, res) => sendSuccess(res, { ok: true, ...req.adminAuth }));

router.use(requireDb);
router.get('/stats', asyncHandler(stats));
router.use('/organizations', organizationsRoutes);
router.use('/bots', botsRoutes);

module.exports = router;
