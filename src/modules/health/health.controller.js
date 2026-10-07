'use strict';

/** @file Liveness and readiness handlers used by load balancers / monitors. */
const config = require('../../config');
const { getDatabaseState } = require('../../config/database');

const startedAt = new Date();

/**
 * Process and MongoDB status shared by both endpoints.
 * @returns {object}
 */
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

/**
 * Liveness (GET /health, /health/live): the process is up. Always 200 while running.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
function health(req, res) {
  res.json({ status: 'ok', ...snapshot() });
}

/**
 * Readiness (GET /health/ready): 200 only when MongoDB is connected and the process is
 * not shutting down, otherwise 503.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
function readiness(req, res) {
  const data = snapshot();
  const shuttingDown = Boolean(req.app.locals.shuttingDown);
  const ready = data.mongo.isConnected && !shuttingDown;
  res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not_ready', shuttingDown, ...data });
}

module.exports = { health, readiness };
