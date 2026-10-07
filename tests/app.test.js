'use strict';

/** @file App-wide behaviour: 404/error format, body parsing, headers and the access log. */
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/test';
process.env.LOG_TO_FILE = 'false';
process.env.LOG_LEVEL = 'error';
process.env.LOG_BODIES = 'true';
process.env.LOG_BODY_MAX_LENGTH = '200';
process.env.BODY_LIMIT = '1kb';
process.env.EO_LOG_FULL = 'false';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const createApp = require('../src/app');
const { captureLogs, nextTick } = require('./helpers/captureLogs');

const app = createApp();
const EO_PATH = '/api/customerOrderRequestEo';

test('unknown route returns the JSON 404 error shape', async () => {
  const res = await request(app).get('/nope').expect(404);
  assert.deepEqual(res.body, {
    error: { message: 'Route not found: GET /nope', code: 'ROUTE_NOT_FOUND' },
  });
});

test('invalid JSON returns 400 INVALID_JSON', async () => {
  const res = await request(app)
    .post(EO_PATH)
    .set('Content-Type', 'application/json')
    .send('{"bad json"')
    .expect(400);
  assert.equal(res.body.error.code, 'INVALID_JSON');
});

test('body larger than BODY_LIMIT returns 413 PAYLOAD_TOO_LARGE', async () => {
  const res = await request(app).post(EO_PATH).send({ data: 'x'.repeat(2048) }).expect(413);
  assert.equal(res.body.error.code, 'PAYLOAD_TOO_LARGE');
});

test('security and CORS headers are set; no request-id or rate-limit headers', async () => {
  const res = await request(app).get('/health').set('Origin', 'https://example.com');
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['x-powered-by'], undefined);
  assert.equal(res.headers['access-control-allow-origin'], '*');
  assert.equal(res.headers['x-request-id'], undefined);
  assert.equal(res.headers['ratelimit'], undefined);
  assert.equal(res.headers['ratelimit-policy'], undefined);
});

test('access log writes bodies as-is (no redaction) and truncates large ones', async () => {
  const logs = captureLogs();
  try {
    await request(app).post(EO_PATH).send({ password: 'p@ss', token: 't0k' }).expect(200);
    await request(app).post(EO_PATH).send({ big: 'y'.repeat(500) }).expect(200);
    await nextTick();
    const access = logs.entries.filter((e) => e.event === 'http.request');
    assert.equal(access.length, 2);
    assert.deepEqual(access[0].reqBody, { password: 'p@ss', token: 't0k' });
    assert.equal(access[0].requestId, undefined);
    assert.equal(access[0].status, 200);
    // No botUserId -> EO failure envelope from resolveTenantFromEo (no DB needed).
    assert.match(access[0].resBody, /^\{"resultCode":"1"/, 'response body captured (truncated)');
    assert.match(access[1].reqBody, /\[truncated, \d+ chars total\]$/);
  } finally {
    logs.restore();
  }
});
