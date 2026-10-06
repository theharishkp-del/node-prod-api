'use strict';

/**
 * Process entry point:
 *  1. validate config (fails fast on bad env)
 *  2. start the HTTP server
 *  3. connect to MongoDB with retry/backoff (readiness stays 503 until connected;
 *     the process exits if all retries fail)
 *  4. graceful shutdown on SIGTERM/SIGINT and on fatal errors
 */
const http = require('http');
const config = require('./config');
const logger = require('./config/logger');
const { connectDatabase, closeDatabase } = require('./config/database');
const createApp = require('./app');

const { flushLogger } = logger;

const app = createApp();
const server = http.createServer(app);

// Keep-alive must outlive the load balancer's idle timeout (AWS ALB default: 60s).
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
server.requestTimeout = 30_000;

let shuttingDown = false;

async function shutdown(reason, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  app.locals.shuttingDown = true;
  logger.info('Graceful shutdown started', { reason, exitCode });

  const forceExit = setTimeout(() => {
    logger.error('Graceful shutdown timed out, forcing exit', {
      timeoutMs: config.shutdownTimeoutMs,
    });
    flushLogger(500).finally(() => process.exit(1));
  }, config.shutdownTimeoutMs);
  forceExit.unref();

  try {
    if (server.listening) {
      await new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
        // Drop idle keep-alive sockets right away; active requests may finish.
        if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections();
      });
      logger.info('HTTP server closed');
    }
  } catch (err) {
    logger.error('Error while closing HTTP server', { err });
    exitCode = exitCode || 1;
  }

  try {
    await closeDatabase();
  } catch (err) {
    logger.error('Error while closing MongoDB connection', { err });
    exitCode = exitCode || 1;
  }

  logger.info('Shutdown complete', { exitCode });
  await flushLogger();
  clearTimeout(forceExit);
  process.exit(exitCode);
}

// ---- Process-level handlers -------------------------------------------------------
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', {
    event: 'process.unhandledRejection',
    err: reason instanceof Error ? reason : new Error(String(reason)),
  });
  shutdown('unhandledRejection', 1);
});

process.on('uncaughtException', (err, origin) => {
  logger.error('Uncaught exception', { event: 'process.uncaughtException', origin, err });
  shutdown('uncaughtException', 1);
});

process.on('warning', (warning) => logger.warn('Process warning', { err: warning }));

// ---- Start --------------------------------------------------------------------------
server.on('error', (err) => {
  logger.error('HTTP server error', { err });
  shutdown('serverError', 1);
});

server.listen(config.port, config.host, () => {
  logger.info(`Server listening on http://${config.host}:${config.port}`, {
    event: 'server.start',
    port: config.port,
    env: config.env,
    node: process.version,
    logBodies: config.log.bodies,
    logDir: config.log.toFile ? config.log.dir : null,
  });
  // PM2 (wait_ready: true) waits for this signal before routing traffic.
  if (typeof process.send === 'function') process.send('ready');
});

connectDatabase().catch((err) => {
  if (shuttingDown) return;
  logger.error('Could not connect to MongoDB, exiting', { err });
  shutdown('mongoConnectFailed', 1);
});

module.exports = server;
