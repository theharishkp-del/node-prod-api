'use strict';

const config = require('../config');
const { getDatabaseState } = require('../config/database');

const startedAt = new Date();

function snapshot() {
  const mem = process.memoryUsage();
  return {
    service: config.appName,
    env: config.env,
    uptimeSeconds: Math.round(process.uptime()),
    startedAt: startedAt.toISOString(),
    timestamp: new Date().toISOString(),
    pid: process.pid,
    memory: {
      rssMB: Math.round(mem.rss / 1048576),
      heapUsedMB: Math.round(mem.heapUsed / 1048576),
    },
    mongo: getDatabaseState(),
  };
}

/** Liveness (GET /health): the process is up and serving HTTP. Always 200 while running. */
function health(req, res) {
  res.json({ status: 'ok', ...snapshot() });
}

/** Readiness (GET /health/ready): 200 only when MongoDB is connected and not shutting down. */
function readiness(req, res) {
  const data = snapshot();
  const shuttingDown = Boolean(req.app.locals.shuttingDown);
  const ready = data.mongo.isConnected && !shuttingDown;
  res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not_ready', shuttingDown, ...data });
}

module.exports = { health, readiness };
