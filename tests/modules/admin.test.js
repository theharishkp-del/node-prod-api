'use strict';

/**
 * @file Admin API (/api/admin): x-admin-key auth, organizations + bots CRUD with
 * validation, tenant DB initialisation, cache invalidation (EO sees changes at once),
 * stats and the tenant sessions endpoints. Uses a throw-away MongoDB.
 */
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/test';
process.env.LOG_TO_FILE = 'false';
process.env.LOG_LEVEL = 'error';
process.env.APP_BASE_PATH = '/iqagent';
process.env.ADMIN_API_KEY = 'test-admin-key-0123456789';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const request = require('supertest');
const createApp = require('../../src/app');
const { decodeBase64 } = require('../../src/shared/eo');
const { TENANT_ERROR_MESSAGES } = require('../../src/shared/tenancy');
const { startTestDb } = require('../helpers/testDb');
const { seedDemo } = require('../../scripts/seed');
const sample = require('../fixtures/eoRequest.json');

const KEY = process.env.ADMIN_API_KEY;
const app = createApp();

/** supertest agent call with the admin key. */
const api = {
  get: (url) => request(app).get(`/api/admin${url}`).set('x-admin-key', KEY),
  post: (url, body) => request(app).post(`/api/admin${url}`).set('x-admin-key', KEY).send(body),
  patch: (url, body) => request(app).patch(`/api/admin${url}`).set('x-admin-key', KEY).send(body),
  delete: (url) => request(app).delete(`/api/admin${url}`).set('x-admin-key', KEY),
};
const eo = (payload = sample) => request(app).post('/api/customerOrderRequestEo').send(payload).expect(200);

let db;
test.before(async () => {
  db = await startTestDb();
});
test.after(() => db && db.stop());
test.beforeEach(async () => {
  await db.reset();
  await seedDemo();
});

test('auth: missing or wrong x-admin-key -> 401, right key -> 200 (root and /iqagent)', async () => {
  const noKey = await request(app).get('/api/admin/stats').expect(401);
  assert.deepEqual(noKey.body, { error: { message: 'Missing or invalid admin API key', code: 'UNAUTHORIZED' } });
  await request(app).get('/api/admin/organizations').set('x-admin-key', 'wrong-key-wrong-key').expect(401);
  await request(app).get('/iqagent/api/admin/bots').expect(401);

  const check = await request(app).get('/iqagent/api/admin/auth/check').set('x-admin-key', KEY).expect(200);
  assert.deepEqual(check.body, { success: true, data: { ok: true, authRequired: true } });
  assert.equal(check.headers['cache-control'], 'no-store');
});

test('organizations: create validates input (400 with details) and rejects unknown keys', async () => {
  const res = await api
    .post('/organizations', { name: '', email: 'nope', currencyCode: 'dollars', timezone: 'Mars/Base', dbName: 'x', orgId: 'Bad_Id' })
    .expect(400);
  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  const paths = res.body.error.details.map((d) => d.path).sort();
  assert.deepEqual(paths, ['currencyCode', 'dbName', 'email', 'name', 'orgId', 'timezone']);
});

test('organizations: create generates orgId + dbName and initialises the tenant DB', async () => {
  const res = await api
    .post('/organizations', {
      name: 'Acme Kitchens & Co.',
      email: 'Ops@Acme.example',
      currencyCode: 'eur',
      address: { city: 'Pune', country: 'India' },
    })
    .expect(201);
  const org = res.body.data;
  assert.equal(res.body.success, true);
  assert.equal(org.orgId, 'acme-kitchens-co');
  assert.equal(org.dbName, 'iq_t_acme_kitchens_co');
  assert.equal(org.email, 'ops@acme.example');
  assert.equal(org.currencyCode, 'EUR');
  assert.equal(org.timezone, 'Asia/Calcutta');
  assert.equal(org.status, 'active');
  assert.equal(org.__v, undefined);

  const collections = await mongoose.connection.useDb(org.dbName).db.listCollections().toArray();
  assert.ok(collections.some((c) => c.name === 'eo_sessions'), 'tenant DB created with eo_sessions');

  // Same name again -> a suffixed orgId; explicit duplicate -> 409.
  const again = await api.post('/organizations', { name: 'Acme Kitchens & Co.' }).expect(201);
  assert.match(again.body.data.orgId, /^acme-kitchens-co-[a-z0-9]{4}$/);
  const dup = await api.post('/organizations', { orgId: 'demo', name: 'Other' }).expect(409);
  assert.equal(dup.body.error.code, 'ORG_EXISTS');
});

test('organizations: list with search, status filter, sort and pagination', async () => {
  for (const name of ['Bravo Doors', 'Alpha Wood', 'Charlie Glass']) {
    await api.post('/organizations', { name }).expect(201);
  }
  await api.patch('/organizations/charlie-glass/status', { status: 'suspended' }).expect(200);

  const all = await api.get('/organizations?sort=name&limit=2').expect(200);
  assert.deepEqual(all.body.data.map((o) => o.orgId), ['alpha-wood', 'bravo-doors']);
  assert.deepEqual(all.body.meta, { page: 1, limit: 2, total: 4, totalPages: 2 });
  const page2 = await api.get('/organizations?sort=name&limit=2&page=2').expect(200);
  assert.deepEqual(page2.body.data.map((o) => o.orgId), ['charlie-glass', 'demo']);
  assert.equal(page2.body.data[1].botCount, 1);

  const q = await api.get('/organizations?q=WOOD').expect(200);
  assert.deepEqual(q.body.data.map((o) => o.orgId), ['alpha-wood']);
  const suspended = await api.get('/organizations?status=suspended').expect(200);
  assert.deepEqual(suspended.body.data.map((o) => o.orgId), ['charlie-glass']);

  const bad = await api.get('/organizations?limit=1000&sort=password').expect(400);
  assert.deepEqual(bad.body.error.details.map((d) => d.path).sort(), ['limit', 'sort']);
});

test('organizations: get, patch (partial address), immutable fields, 404', async () => {
  const one = await api.get('/organizations/demo').expect(200);
  assert.equal(one.body.data.botCount, 1);
  assert.equal(one.body.data.activeBotCount, 1);
  assert.equal(one.body.data.sessionCount, 0);

  const patched = await api.patch('/organizations/demo', { phone: '+1 555', address: { city: 'Mysuru' } }).expect(200);
  assert.equal(patched.body.data.phone, '+1 555');
  assert.equal(patched.body.data.address.city, 'Mysuru');
  assert.equal(patched.body.data.address.line1, '12 MG Road', 'other address fields kept');

  const imm = await api.patch('/organizations/demo', { dbName: 'iq_t_other', name: 'x' }).expect(400);
  assert.equal(imm.body.error.code, 'IMMUTABLE_FIELD');
  await api.patch('/organizations/demo', { orgId: 'new' }).expect(400);
  const empty = await api.patch('/organizations/demo', {}).expect(400);
  assert.equal(empty.body.error.details[0].message, 'No fields to update');
  await api.patch('/organizations/nope', { name: 'x' }).expect(404);
  const missing = await api.get('/organizations/nope').expect(404);
  assert.equal(missing.body.error.code, 'ORG_NOT_FOUND');
});

test('organizations: status change applies to EO calls immediately (cache invalidated)', async () => {
  assert.equal((await eo()).body.resultCode, '0'); // warms the tenant cache

  await api.patch('/organizations/demo/status', { status: 'suspended' }).expect(200);
  const blocked = await eo();
  assert.equal(blocked.body.resultText, 'failure');
  assert.equal(decodeBase64(blocked.body.resMessageObj.fileName), TENANT_ERROR_MESSAGES.ORG_SUSPENDED);

  await api.patch('/organizations/demo/status', { status: 'active' }).expect(200);
  assert.equal((await eo()).body.resultCode, '0');
  await api.patch('/organizations/demo/status', { status: 'deleted' }).expect(400);
});

test('organizations: delete is refused while bots exist (409), allowed afterwards', async () => {
  const conflict = await api.delete('/organizations/demo').expect(409);
  assert.equal(conflict.body.error.code, 'ORG_HAS_BOTS');
  await api.delete('/bots/3183').expect(200);
  const del = await api.delete('/organizations/demo').expect(200);
  assert.deepEqual(del.body.data, { orgId: 'demo', dbName: 'iq_t_demo', deleted: true });
  await api.get('/organizations/demo').expect(404);
});

test('bots: create validates, requires an existing org (422) and a unique botUserId (409)', async () => {
  const invalid = await api.post('/bots', { botUserId: 'a b', orgId: 'demo' }).expect(400);
  assert.deepEqual(invalid.body.error.details.map((d) => d.path).sort(), ['botUserId', 'name']);

  const noOrg = await api.post('/bots', { botUserId: '7001', name: 'X', orgId: 'ghost' }).expect(422);
  assert.equal(noOrg.body.error.code, 'ORG_NOT_FOUND');
  const dup = await api.post('/bots', { botUserId: '3183', name: 'X', orgId: 'demo' }).expect(409);
  assert.equal(dup.body.error.code, 'BOT_EXISTS');

  const created = await api
    .post('/bots', { botUserId: 7001, name: 'Support bot', orgId: 'DEMO', botDatabaseName: 'SYSTEMBOT67001' })
    .expect(201);
  assert.equal(created.body.data.botUserId, '7001');
  assert.equal(created.body.data.orgId, 'demo');
  assert.equal(created.body.data.channel, 'cybot');
  assert.equal(created.body.data.status, 'active');
  assert.deepEqual(created.body.data.organization, { orgId: 'demo', name: 'Demo Cabinets', status: 'active' });
});

test('bots: list filters, get, patch, status change reaches EO, delete', async () => {
  await api.post('/organizations', { orgId: 'other', name: 'Other Org' }).expect(201);
  await api.post('/bots', { botUserId: '8001', name: 'Other bot', orgId: 'other' }).expect(201);
  await api.post('/bots', { botUserId: '8002', name: 'Spare bot', orgId: 'other', status: 'inactive' }).expect(201);

  const byOrg = await api.get('/bots?orgId=other&sort=botUserId').expect(200);
  assert.deepEqual(byOrg.body.data.map((b) => b.botUserId), ['8001', '8002']);
  assert.equal(byOrg.body.meta.total, 2);
  const inactive = await api.get('/bots?status=inactive').expect(200);
  assert.deepEqual(inactive.body.data.map((b) => b.botUserId), ['8002']);
  const q = await api.get('/bots?q=SYSTEMBOT63').expect(200);
  assert.deepEqual(q.body.data.map((b) => b.botUserId), ['3183']);

  const one = await api.get('/bots/3183').expect(200);
  assert.equal(one.body.data.organization.name, 'Demo Cabinets');
  await api.get('/bots/0000').expect(404);

  const patched = await api.patch('/bots/8001', { name: 'Renamed', config: { greeting: 'hi' } }).expect(200);
  assert.equal(patched.body.data.name, 'Renamed');
  assert.deepEqual(patched.body.data.config, { greeting: 'hi' });
  const imm = await api.patch('/bots/8001', { botUserId: '9' }).expect(400);
  assert.equal(imm.body.error.code, 'IMMUTABLE_FIELD');
  await api.patch('/bots/8001', { orgId: 'ghost' }).expect(422);

  assert.equal((await eo()).body.resultCode, '0');
  await api.patch('/bots/3183/status', { status: 'inactive' }).expect(200);
  assert.equal(decodeBase64((await eo()).body.resMessageObj.fileName), TENANT_ERROR_MESSAGES.BOT_INACTIVE);
  await api.patch('/bots/3183/status', { status: 'active' }).expect(200);

  await api.delete('/bots/8002').expect(200);
  await api.delete('/bots/8002').expect(404);
  assert.equal(decodeBase64((await eo({ ...sample, botUserId: '8002' })).body.resMessageObj.fileName), TENANT_ERROR_MESSAGES.BOT_NOT_FOUND);
});

test('stats: organizations, bots and sessions per organization', async () => {
  await api.post('/organizations', { orgId: 'other', name: 'Other Org' }).expect(201);
  await api.patch('/organizations/other/status', { status: 'suspended' }).expect(200);
  await api.post('/bots', { botUserId: '8001', name: 'B', orgId: 'other', status: 'inactive' }).expect(201);
  await eo();

  const { data } = (await api.get('/stats').expect(200)).body;
  assert.deepEqual(data.organizations, { total: 2, active: 1, suspended: 1 });
  assert.deepEqual(data.bots, { total: 2, active: 1, inactive: 1 });
  assert.deepEqual(data.sessions, { total: 1, last24h: 1 });
  const demo = data.perOrganization.find((o) => o.orgId === 'demo');
  assert.equal(demo.sessions, 1);
  assert.equal(demo.bots, 1);
  assert.ok(demo.lastMessageAt);
  assert.equal(data.perOrganizationTruncated, false);
});

test('sessions: list (summaries, newest first) and detail with all messages', async () => {
  await eo();
  await eo({ ...sample, sessionDate: '20261008100000000' });
  await eo({ ...sample, sessionDate: '20261008100000000' });

  const list = await api.get('/organizations/demo/sessions?limit=10').expect(200);
  assert.equal(list.body.meta.total, 2);
  const [newest, older] = list.body.data;
  assert.equal(newest.sessionDate, '20261008100000000');
  assert.equal(newest.messageCount, 4);
  assert.equal(newest.messages, undefined, 'summaries have no message array');
  assert.equal(newest.lastMessage.direction, 'out');
  assert.equal(older.sessionDate, '20261007062959549');

  const filtered = await api.get('/organizations/demo/sessions?botUserId=nobody').expect(200);
  assert.equal(filtered.body.meta.total, 0);

  const detail = await api.get(`/organizations/demo/sessions/${newest._id}`).expect(200);
  assert.equal(detail.body.data.messages.length, 4);
  assert.deepEqual(detail.body.data.org, { orgId: 'demo', name: 'Demo Cabinets' });

  const bad = await api.get('/organizations/demo/sessions/not-an-id').expect(400);
  assert.equal(bad.body.error.code, 'INVALID_ID');
  await api.get('/organizations/demo/sessions/0123456789abcdef01234567').expect(404);
  await api.get('/organizations/ghost/sessions').expect(404);
});
