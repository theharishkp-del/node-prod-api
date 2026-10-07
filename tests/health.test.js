'use strict';

/** @file Health module: liveness/readiness at the root and under APP_BASE_PATH (no MongoDB). */
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/test';
process.env.LOG_TO_FILE = 'false';
process.env.LOG_LEVEL = 'error';
process.env.APP_BASE_PATH = '/iqagent';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const createApp = require('../src/app');

const app = createApp();

for (const prefix of ['', '/iqagent']) {
  test(`GET ${prefix}/health returns ok with uptime and mongo state`, async () => {
    const res = await request(app).get(`${prefix}/health`).expect(200);
    assert.equal(res.body.status, 'ok');
    assert.equal(typeof res.body.uptimeSeconds, 'number');
    assert.equal(res.body.mongo.isConnected, false);
    await request(app).get(`${prefix}/health/live`).expect(200);
  });

  test(`GET ${prefix}/health/ready is 503 while MongoDB is not connected`, async () => {
    const res = await request(app).get(`${prefix}/health/ready`).expect(503);
    assert.equal(res.body.status, 'not_ready');
    assert.equal(res.body.shuttingDown, false);
  });
}

test('health keeps the strict default CSP', async () => {
  const res = await request(app).get('/iqagent/health');
  assert.ok(res.headers['content-security-policy']);
});
