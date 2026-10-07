'use strict';

/** @file Env config of the tenancy/admin settings: defaults, validation, production rule. */
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/test';
process.env.LOG_TO_FILE = 'false';

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const assert = require('node:assert/strict');

/** Load the config in a fresh process with `extra` env; returns exit status + parts of it. */
function loadConfig(extra) {
  const r = spawnSync(
    process.execPath,
    ['-e', "const c=require('./src/config');process.stdout.write(JSON.stringify({tenancy:c.tenancy,admin:c.admin}))"],
    {
      cwd: path.resolve(__dirname, '../..'),
      env: { PATH: process.env.PATH, MONGODB_URI: 'mongodb://127.0.0.1:27017/x', LOG_TO_FILE: 'false', ...extra },
      encoding: 'utf8',
    },
  );
  return { status: r.status, config: r.status === 0 ? JSON.parse(r.stdout) : null, stderr: r.stderr };
}

test('defaults: MASTER_DB_NAME iq_master, cache TTL 300s, no admin key outside production', () => {
  const { status, config } = loadConfig({ NODE_ENV: 'development' });
  assert.equal(status, 0);
  assert.deepEqual(config, { tenancy: { masterDbName: 'iq_master', cacheTtlMs: 300000 }, admin: { apiKey: '' } });
});

test('custom values are applied', () => {
  const { config } = loadConfig({
    MASTER_DB_NAME: 'my_master',
    TENANT_CACHE_TTL_SECONDS: '0',
    ADMIN_API_KEY: 'k'.repeat(32),
  });
  assert.deepEqual(config.tenancy, { masterDbName: 'my_master', cacheTtlMs: 0 });
  assert.equal(config.admin.apiKey, 'k'.repeat(32));
});

test('production refuses to start without ADMIN_API_KEY; short keys and bad DB names fail', () => {
  const prod = loadConfig({ NODE_ENV: 'production' });
  assert.equal(prod.status, 1);
  assert.match(prod.stderr, /ADMIN_API_KEY is required in production/);
  assert.equal(loadConfig({ NODE_ENV: 'production', ADMIN_API_KEY: 'x'.repeat(16) }).status, 0);

  const short = loadConfig({ ADMIN_API_KEY: 'short' });
  assert.equal(short.status, 1);
  assert.match(short.stderr, /ADMIN_API_KEY: must be at least 16 characters/);
  const badDb = loadConfig({ MASTER_DB_NAME: 'bad.name' });
  assert.equal(badDb.status, 1);
  assert.match(badDb.stderr, /MASTER_DB_NAME/);
});
