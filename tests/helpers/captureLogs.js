'use strict';

/** @file Test helper: capture winston log entries in memory instead of printing them. */
const winston = require('winston');
const logger = require('../../src/config/logger');

/**
 * Silence the existing transports and collect entries at `level` and above.
 * @param {string} [level='info']
 * @returns {{entries: object[], restore: () => void}} Call restore() when done.
 */
function captureLogs(level = 'info') {
  const entries = [];
  class Capture extends winston.Transport {
    log(info, cb) {
      entries.push(info);
      cb();
    }
  }
  const transport = new Capture({ level });
  const previousLevel = logger.level;
  const silenced = logger.transports.filter((t) => !t.silent);
  silenced.forEach((t) => (t.silent = true));
  logger.add(transport);
  logger.level = level;
  return {
    entries,
    restore() {
      logger.remove(transport);
      logger.level = previousLevel;
      silenced.forEach((t) => (t.silent = false));
    },
  };
}

/** Resolve after pending 'finish' handlers (the access log is written on finish). */
const nextTick = () => new Promise((resolve) => setImmediate(resolve));

module.exports = { captureLogs, nextTick };
