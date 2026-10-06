'use strict';

// HTTP-level tests that do not need a running MongoDB.
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/test';
process.env.LOG_TO_FILE = 'false';
process.env.LOG_LEVEL = 'error';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const createApp = require('../src/app');

const app = createApp();

test('GET /health returns ok with uptime and mongo state', async () => {
  const res = await request(app).get('/health').expect(200);
  assert.equal(res.body.status, 'ok');
  assert.equal(typeof res.body.uptimeSeconds, 'number');
  assert.equal(res.body.mongo.isConnected, false);
});

test('GET /health/ready is 503 while MongoDB is not connected', async () => {
  const res = await request(app).get('/health/ready').expect(503);
  assert.equal(res.body.status, 'not_ready');
});

test('X-Request-Id is generated, or echoed when supplied', async () => {
  const generated = await request(app).get('/health');
  assert.match(generated.headers['x-request-id'], /^[0-9a-f-]{36}$/);
  const echoed = await request(app).get('/health').set('X-Request-Id', 'abc-123');
  assert.equal(echoed.headers['x-request-id'], 'abc-123');
});

test('unknown route returns JSON 404 with request id', async () => {
  const res = await request(app).get('/nope').expect(404);
  assert.equal(res.body.error.code, 'ROUTE_NOT_FOUND');
  assert.ok(res.body.error.requestId);
});

test('invalid JSON returns 400 INVALID_JSON', async () => {
  const res = await request(app)
    .post('/api/v1/users')
    .set('Content-Type', 'application/json')
    .send('{"bad json"')
    .expect(400);
  assert.equal(res.body.error.code, 'INVALID_JSON');
});

test('DB-backed route returns 503 while MongoDB is down', async () => {
  const res = await request(app).get('/api/v1/users').expect(503);
  assert.equal(res.body.error.code, 'DATABASE_UNAVAILABLE');
});

test('security headers are set', async () => {
  const res = await request(app).get('/health');
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['x-powered-by'], undefined);
});
