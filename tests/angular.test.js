'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// Fake Angular dist, created before config is loaded.
const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'ng-dist-'));
fs.writeFileSync(
  path.join(dist, 'index.html'),
  '<!doctype html><html><head><base href="/iqagent/portal/"></head><body><app-root></app-root><script src="main.abc123.js"></script></body></html>',
);
fs.writeFileSync(path.join(dist, 'main.abc123.js'), 'console.log("app");');

process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/test';
process.env.LOG_TO_FILE = 'false';
process.env.LOG_LEVEL = 'error';
process.env.LOG_BODIES = 'true';
process.env.APP_BASE_PATH = 'iqagent/'; // normalised to /iqagent
process.env.ANGULAR_ENABLED = 'true';
process.env.ANGULAR_APP_NAME = 'portal';
process.env.ANGULAR_DIST_PATH = dist;
process.env.ANGULAR_APPS = 'missing:/nonexistent/dir/xyz';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const config = require('../src/config');
const createApp = require('../src/app');

const app = createApp();
test.after(() => fs.rmSync(dist, { recursive: true, force: true }));

test('base path is normalised', () => {
  assert.equal(config.basePath, '/iqagent');
});

test('mount path without slash redirects to trailing slash', async () => {
  const res = await request(app).get('/iqagent/portal?x=1').expect(301);
  assert.equal(res.headers.location, '/iqagent/portal/?x=1');
});

test('index.html served with no-cache and without CSP', async () => {
  const res = await request(app).get('/iqagent/portal/').expect(200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.text, /<app-root>/);
  assert.equal(res.headers['cache-control'], 'no-cache');
  assert.equal(res.headers['content-security-policy'], undefined);
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
});

test('hashed asset served with 1y immutable cache', async () => {
  const res = await request(app).get('/iqagent/portal/main.abc123.js').expect(200);
  assert.match(res.headers['content-type'], /javascript/);
  assert.equal(res.headers['cache-control'], 'public, max-age=31536000, immutable');
});

test('deep link falls back to index.html', async () => {
  const res = await request(app).get('/iqagent/portal/orders/5').expect(200);
  assert.match(res.text, /<app-root>/);
  assert.equal(res.headers['cache-control'], 'no-cache');
});

test('missing file with extension is a 404, not index.html', async () => {
  const res = await request(app).get('/iqagent/portal/main.missing.js').expect(404);
  assert.equal(res.body.error.code, 'ROUTE_NOT_FOUND');
});

test('api paths are not swallowed by the SPA fallback', async () => {
  const res = await request(app).get('/iqagent/api/v1').expect(200);
  assert.equal(res.body.message, 'API v1');
  const inside = await request(app).get('/iqagent/portal/api/anything').expect(404);
  assert.equal(inside.body.error.code, 'ROUTE_NOT_FOUND');
  await request(app).get('/iqagent/api/v1/nope').expect(404);
});

test('health works under base path and at root; API keeps strict CSP', async () => {
  const res = await request(app).get('/iqagent/health').expect(200);
  assert.equal(res.body.status, 'ok');
  assert.ok(res.headers['content-security-policy']);
  await request(app).get('/iqagent/health/ready').expect(503);
  await request(app).get('/health').expect(200);
});

test('app with missing dist is skipped, not crashing', async () => {
  await request(app).get('/iqagent/missing/').expect(404);
});
