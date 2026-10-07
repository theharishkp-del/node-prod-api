'use strict';

/**
 * @file Admin API without MongoDB and without ADMIN_API_KEY (development/test mode):
 * open access with a one-time warning, /auth/check works, data routes answer 503.
 */
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/test';
process.env.LOG_TO_FILE = 'false';
process.env.LOG_LEVEL = 'error';
delete process.env.ADMIN_API_KEY;

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const createApp = require('../../src/app');
const { captureLogs } = require('../helpers/captureLogs');

const app = createApp();

test('without ADMIN_API_KEY the admin API is open and warns once', async () => {
  const logs = captureLogs('warn');
  try {
    const res = await request(app).get('/iqagent/api/admin/auth/check').expect(200);
    assert.deepEqual(res.body, { success: true, data: { ok: true, authRequired: false } });
    await request(app).get('/api/admin/auth/check').expect(200);
    const warnings = logs.entries.filter((e) => e.event === 'admin.auth_disabled');
    assert.equal(warnings.length, 1);
  } finally {
    logs.restore();
  }
});

test('data routes answer 503 DATABASE_UNAVAILABLE while MongoDB is not connected', async () => {
  const logs = captureLogs('error'); // keeps the 5xx access log lines out of the test output
  try {
    for (const url of ['/api/admin/stats', '/api/admin/organizations', '/iqagent/api/admin/bots/3183']) {
      const res = await request(app).get(url).expect(503);
      assert.equal(res.body.error.code, 'DATABASE_UNAVAILABLE');
    }
  } finally {
    logs.restore();
  }
});
