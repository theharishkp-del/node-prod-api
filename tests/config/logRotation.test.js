'use strict';

/** @file Env-driven log rotation: LOG_ROTATE_FREQUENCY (weekly|daily) and LOG_RETENTION_DAYS. */
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/test';
process.env.LOG_TO_FILE = 'false';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRotationOptions, DATE_PATTERNS } = require('../../src/config/logger');

const ROOT = path.resolve(__dirname, '../..');

/**
 * Load the logger in a fresh process with `extra` env, write one line, and report the
 * rotation options of its file transports plus the files created in LOG_DIR.
 */
function inspectLogger(extra) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'log-rotate-'));
  const script = `
    const logger = require('./src/config/logger');
    const config = require('./src/config');
    // Read the options before flushing: closed transports are removed from the logger.
    const files = logger.transports
      .filter((t) => t.options && t.options.datePattern)
      .map((t) => ({ datePattern: t.options.datePattern, maxFiles: t.options.maxFiles,
        maxSize: t.options.maxSize, zippedArchive: t.options.zippedArchive }));
    logger.error('hello');
    logger.flushLogger().then(() => {
      process.stdout.write('\\n@@' + JSON.stringify({ log: config.log, files, created: require('fs').readdirSync(config.log.dir) }));
    });`;
  const env = {
    PATH: process.env.PATH,
    NODE_ENV: 'production',
    MONGODB_URI: 'mongodb://127.0.0.1:27017/x',
    LOG_TO_FILE: 'true',
    LOG_LEVEL: 'error',
    LOG_DIR: dir,
    ...extra,
  };
  const r = spawnSync(process.execPath, ['-e', script], { cwd: ROOT, env, encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  // The console transport also prints to stdout, so the result follows an '@@' marker.
  const out = r.status === 0 ? JSON.parse(r.stdout.slice(r.stdout.lastIndexOf('\n@@') + 3)) : null;
  return { status: r.status, stderr: r.stderr, out };
}

test('buildRotationOptions maps frequency to datePattern and retention days to maxFiles', () => {
  assert.deepEqual(buildRotationOptions({ rotateFrequency: 'weekly', retentionDays: 30, maxSize: '20m' }), {
    datePattern: 'GGGG-[W]WW',
    maxFiles: '30d',
    maxSize: '20m',
    zippedArchive: true,
  });
  assert.deepEqual(buildRotationOptions({ rotateFrequency: 'daily', retentionDays: 7, maxSize: '5m' }), {
    datePattern: 'YYYY-MM-DD',
    maxFiles: '7d',
    maxSize: '5m',
    zippedArchive: true,
  });
  assert.equal(buildRotationOptions({ retentionDays: 1, maxSize: '1m' }).datePattern, DATE_PATTERNS.weekly);
  assert.throws(() => buildRotationOptions({ rotateFrequency: 'hourly', retentionDays: 1 }), /hourly/);
});

test('defaults: weekly rotation, 30 days retention, 20m max size', () => {
  const { status, out, stderr } = inspectLogger({});
  assert.equal(status, 0, stderr);
  assert.equal(out.log.rotateFrequency, 'weekly');
  assert.equal(out.log.retentionDays, 30);
  assert.equal(out.files.length, 2, 'app + error transports');
  for (const f of out.files) {
    assert.deepEqual(f, { datePattern: 'GGGG-[W]WW', maxFiles: '30d', maxSize: '20m', zippedArchive: true });
  }
  assert.ok(out.created.some((n) => /^app-\d{4}-W\d{2}\.log$/.test(n)), out.created.join(','));
});

test('LOG_ROTATE_FREQUENCY=daily + LOG_RETENTION_DAYS=14 + LOG_MAX_SIZE=50M', () => {
  const { status, out, stderr } = inspectLogger({
    LOG_ROTATE_FREQUENCY: 'Daily',
    LOG_RETENTION_DAYS: '14',
    LOG_MAX_SIZE: '50M',
  });
  assert.equal(status, 0, stderr);
  for (const f of out.files) {
    assert.deepEqual(f, { datePattern: 'YYYY-MM-DD', maxFiles: '14d', maxSize: '50m', zippedArchive: true });
  }
  assert.ok(out.created.some((n) => /^app-\d{4}-\d{2}-\d{2}\.log$/.test(n)), out.created.join(','));
});

test('invalid rotation settings fail fast with a readable message', () => {
  const badFreq = inspectLogger({ LOG_ROTATE_FREQUENCY: 'monthly' });
  assert.equal(badFreq.status, 1);
  assert.match(badFreq.stderr, /LOG_ROTATE_FREQUENCY: must be 'weekly' or 'daily'/);
  const badDays = inspectLogger({ LOG_RETENTION_DAYS: '0' });
  assert.equal(badDays.status, 1);
  assert.match(badDays.stderr, /LOG_RETENTION_DAYS/);
});
