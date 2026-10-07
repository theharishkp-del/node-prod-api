'use strict';

/**
 * Express application (no network listening here, so it can be imported by tests).
 */
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');

const config = require('./config');
const requestId = require('./middlewares/requestId');
const requestLogger = require('./middlewares/requestLogger');
const { apiLimiter } = require('./middlewares/rateLimiter');
const notFound = require('./middlewares/notFound');
const errorHandler = require('./middlewares/errorHandler');
const healthRoutes = require('./routes/health.routes');
const apiRoutes = require('./routes');
const eoRoutes = require('./routes/eo.routes');
const logger = require('./config/logger');
const { buildAngularApps } = require('./middlewares/angularStatic');

function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.locals.shuttingDown = false;

  // Correlation id + access log first so every request (even rejected ones) is logged.
  app.use(requestId);
  app.use(requestLogger);

  // Tell clients/load balancers to stop reusing connections while draining.
  app.use((req, res, next) => {
    if (app.locals.shuttingDown) res.setHeader('Connection', 'close');
    next();
  });

  // Angular apps get helmet without CSP: Angular CLI's critical-CSS inlining uses inline
  // <style>/onload handlers and apps often load fonts/APIs from other origins, which the
  // default strict CSP blocks. Everything else (API, health) keeps the full default CSP.
  const angularApps = config.angular.enabled
    ? buildAngularApps(config.angular.apps, config.basePath, logger)
    : [];
  const strictHelmet = helmet();
  const spaHelmet = helmet({ contentSecurityPolicy: false });
  const isSpaPath = (p) =>
    angularApps.some((a) => p === a.mountPath || p.startsWith(`${a.mountPath}/`));
  app.use((req, res, next) => (isSpaPath(req.path) ? spaHelmet : strictHelmet)(req, res, next));
  app.use(
    cors({
      origin: config.cors.origin,
      credentials: config.cors.credentials,
      exposedHeaders: ['X-Request-Id', 'RateLimit', 'RateLimit-Policy', 'Retry-After'],
    }),
  );
  app.use(compression());

  // Routes are mounted under APP_BASE_PATH (e.g. /iqagent/health, /iqagent/api/v1) because
  // nginx forwards the prefix unchanged. They are also kept at the root (/health, /api/v1)
  // for local curl checks / existing clients; nginx only exposes the prefixed ones.
  const prefixes = config.basePath ? ['', config.basePath] : [''];

  // Health endpoints are not rate limited (load balancers / orchestrators poll them).
  for (const p of prefixes) app.use(`${p}/health`, healthRoutes);

  app.use(express.json({ limit: config.bodyLimit }));
  app.use(express.urlencoded({ extended: false, limit: config.bodyLimit }));

  for (const p of prefixes) {
    app.use(`${p}/api`, apiLimiter);
    // EO bot endpoints live directly under /api (exact paths configured on the bot platform).
    app.use(`${p}/api`, eoRoutes);
    app.use(`${p}/api/v1`, apiRoutes);
  }

  // Angular SPA(s) after the API so /api is never shadowed.
  for (const a of angularApps) app.use(a.mountPath, a.router);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
