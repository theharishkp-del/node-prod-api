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

  app.use(helmet());
  app.use(
    cors({
      origin: config.cors.origin,
      credentials: config.cors.credentials,
      exposedHeaders: ['X-Request-Id', 'RateLimit', 'RateLimit-Policy', 'Retry-After'],
    }),
  );
  app.use(compression());

  // Health endpoints are not rate limited (load balancers / orchestrators poll them).
  app.use('/health', healthRoutes);

  app.use(express.json({ limit: config.bodyLimit }));
  app.use(express.urlencoded({ extended: false, limit: config.bodyLimit }));

  app.use('/api', apiLimiter);
  app.use('/api/v1', apiRoutes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
