'use strict';

/**
 * @file Module registry: every API module and the path it is mounted at.
 * app.js mounts the resulting router at the root and again under APP_BASE_PATH
 * (e.g. /health and /iqagent/health). To add a module, add one line to MODULES.
 */
const { Router } = require('express');
const healthRoutes = require('../modules/health/health.routes');
const customerOrderRequestEoRoutes = require('../modules/customerOrderRequestEo/customerOrderRequestEo.routes');
const adminRoutes = require('../modules/admin/admin.routes');

/** @type {Array<{path: string, router: import('express').Router}>} */
const MODULES = [
  { path: '/health', router: healthRoutes },
  { path: '/api/customerOrderRequestEo', router: customerOrderRequestEoRoutes },
  { path: '/api/admin', router: adminRoutes },
];

/**
 * Build a router with every module mounted at its path.
 * @returns {import('express').Router}
 */
function createRoutes() {
  const router = Router();
  for (const { path, router: moduleRouter } of MODULES) router.use(path, moduleRouter);
  return router;
}

module.exports = { createRoutes, MODULES };
