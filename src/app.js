'use strict';

/**
 * @file Express application factory. Nothing listens here, so tests can import the app.
 *
 * Middleware order: access log -> shutdown hint -> helmet -> cors -> compression ->
 * body parsers -> module routes (root + APP_BASE_PATH) -> Angular apps -> 404 -> errors.
 */
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');

const config = require('./config');
const logger = require('./config/logger');
const { createRoutes } = require('./routes');
const requestLogger = require('./shared/middlewares/requestLogger');
const { buildAngularApps } = require('./shared/middlewares/angularStatic');
const notFound = require('./shared/middlewares/notFound');
const errorHandler = require('./shared/middlewares/errorHandler');

/**
 * Create a fully configured Express app.
 * @returns {import('express').Express}
 */
function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.locals.shuttingDown = false;

  // Access log first so every request, even a rejected one, is logged.
  app.use(requestLogger);

  // Tell clients/load balancers to stop reusing connections while draining.
  app.use((req, res, next) => {
    if (app.locals.shuttingDown) res.setHeader('Connection', 'close');
    next();
  });

  // Angular apps get helmet without CSP: Angular's critical-CSS inlining uses inline
  // <style>/onload handlers and apps often call other origins, which the strict default
  // CSP blocks. Everything else (API, health) keeps the full default CSP.
  const angularApps = config.angular.enabled
    ? buildAngularApps(config.angular.apps, config.basePath, logger)
    : [];
  const strictHelmet = helmet();
  const spaHelmet = helmet({ contentSecurityPolicy: false });
  const isSpaPath = (p) =>
    angularApps.some((a) => p === a.mountPath || p.startsWith(`${a.mountPath}/`));
  app.use((req, res, next) => (isSpaPath(req.path) ? spaHelmet : strictHelmet)(req, res, next));

  app.use(cors({ origin: config.cors.origin, credentials: config.cors.credentials }));
  app.use(compression());
  app.use(express.json({ limit: config.bodyLimit }));
  app.use(express.urlencoded({ extended: false, limit: config.bodyLimit }));

  // nginx forwards the APP_BASE_PATH prefix unchanged (/iqagent/health); the root mount
  // (/health) is kept for local checks and existing clients.
  const routes = createRoutes();
  app.use('/', routes);
  if (config.basePath) app.use(config.basePath, routes);

  // Angular SPA(s) after the API so API paths are never shadowed.
  for (const a of angularApps) app.use(a.mountPath, a.router);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
