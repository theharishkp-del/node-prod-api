'use strict';

/**
 * @file Multi-tenant data layer: model registration per database, tenant DB naming, the
 * TTL cache and getTenantContextByBotUserId() (cache hit, invalidation, error reasons).
 */
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/test';
process.env.LOG_TO_FILE = 'false';
process.env.LOG_LEVEL = 'error';
process.env.MASTER_DB_NAME = 'iq_master_test';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const {
  getMasterModels,
  getTenantModels,
  buildTenantDbName,
  getTenantContextByBotUserId,
  invalidateTenantCache,
  resolveTenantFromEo,
  TenantResolutionError,
  TENANT_ERROR,
  TENANT_ERROR_MESSAGES,
} = require('../../src/shared/tenancy');
const { createTtlCache } = require('../../src/shared/tenancy/ttlCache');
const { decodeBase64 } = require('../../src/shared/eo');
const { startTestDb } = require('../helpers/testDb');
const { seedDemo } = require('../../scripts/seed');
const sample = require('../fixtures/eoRequest.json');

let db;
test.before(async () => {
  db = await startTestDb();
});
test.after(() => db && db.stop());
test.beforeEach(async () => {
  await db.reset();
  await seedDemo();
});

/** Assert that `promise` rejects with a TenantResolutionError of `code`. */
async function rejectsWith(promise, code) {
  await assert.rejects(promise, (err) => {
    assert.ok(err instanceof TenantResolutionError);
    assert.equal(err.code, code);
    assert.equal(err.message, TENANT_ERROR_MESSAGES[code]);
    return true;
  });
}

test('master models live in MASTER_DB_NAME and are registered once', () => {
  const a = getMasterModels();
  const b = getMasterModels();
  assert.equal(a, b);
  assert.equal(a.Organization.db.name, 'iq_master_test');
  assert.equal(a.Bot.collection.collectionName, 'bots');
  assert.equal(a.Organization.collection.collectionName, 'organizations');
});

test('tenant models are cached per dbName and refuse the master DB', () => {
  const t1 = getTenantModels('iq_t_one');
  assert.equal(getTenantModels('iq_t_one'), t1);
  assert.notEqual(getTenantModels('iq_t_two'), t1);
  assert.equal(t1.EoSession.db.name, 'iq_t_one');
  assert.equal(t1.EoSession.collection.collectionName, 'eo_sessions');
  assert.throws(() => getTenantModels('iq_master_test'), /master database/);
  assert.throws(() => getTenantModels(''), /required/);
});

test('buildTenantDbName prefixes and sanitises the orgId', () => {
  assert.equal(buildTenantDbName('demo'), 'iq_t_demo');
  assert.equal(buildTenantDbName('Acme-Kitchens'), 'iq_t_acme_kitchens');
  assert.equal(buildTenantDbName('a.b/c d$'), 'iq_t_a_b_c_d_');
  assert.throws(() => buildTenantDbName(''), /orgId/);
});

test('TTL cache: expiry, ttl 0, size cap and deleteWhere', () => {
  let now = 1000;
  const cache = createTtlCache({ ttlMs: 100, maxEntries: 2, now: () => now });
  cache.set('a', 1);
  assert.equal(cache.get('a'), 1);
  now += 100;
  assert.equal(cache.get('a'), undefined, 'expired exactly at ttl');
  cache.set('a', 1);
  cache.set('b', 2);
  cache.set('c', 3);
  assert.equal(cache.size(), 2);
  assert.equal(cache.get('a'), undefined, 'oldest evicted');
  assert.equal(cache.deleteWhere((v) => v === 3), 1);
  assert.deepEqual([cache.get('b'), cache.get('c')], [2, undefined]);

  const off = createTtlCache({ ttlMs: 0 });
  off.set('x', 1);
  assert.equal(off.get('x'), undefined);
});

test('resolves bot 3183 to the demo tenant; the second call is a cache hit', async () => {
  const ctx = await getTenantContextByBotUserId('3183');
  assert.equal(ctx.fromCache, false);
  assert.equal(ctx.org.orgId, 'demo');
  assert.equal(ctx.bot.botDatabaseName, 'SYSTEMBOT63183');
  assert.equal(ctx.dbName, 'iq_t_demo');
  assert.equal(ctx.models.EoSession.db.name, 'iq_t_demo');

  const again = await getTenantContextByBotUserId(3183); // numbers are accepted
  assert.equal(again.fromCache, true);
  assert.equal(again.org.orgId, 'demo');
});

test('cached record is used until invalidated (bot status change)', async () => {
  const { Bot } = getMasterModels();
  await getTenantContextByBotUserId('3183');
  await Bot.updateOne({ botUserId: '3183' }, { status: 'inactive' }); // bypasses the admin API

  const stale = await getTenantContextByBotUserId('3183');
  assert.equal(stale.fromCache, true, 'still served from cache');

  assert.equal(invalidateTenantCache({ botUserId: '3183' }), 1);
  await rejectsWith(getTenantContextByBotUserId('3183'), TENANT_ERROR.BOT_INACTIVE);
});

test('invalidate by orgId drops every bot of the organization (suspended org)', async () => {
  const { Bot, Organization } = getMasterModels();
  await Bot.create({ botUserId: '4000', name: 'Second', orgId: 'demo' });
  await getTenantContextByBotUserId('3183');
  await getTenantContextByBotUserId('4000');
  await Organization.updateOne({ orgId: 'demo' }, { status: 'suspended' });

  assert.equal(invalidateTenantCache({ orgId: 'demo' }), 2);
  await rejectsWith(getTenantContextByBotUserId('3183'), TENANT_ERROR.ORG_SUSPENDED);
  await rejectsWith(getTenantContextByBotUserId('4000'), TENANT_ERROR.ORG_SUSPENDED);
});

test('missing / unknown bot and bot without organization are rejected (and not cached)', async () => {
  const { Bot, Organization } = getMasterModels();
  await rejectsWith(getTenantContextByBotUserId(undefined), TENANT_ERROR.MISSING_BOT_USER_ID);
  await rejectsWith(getTenantContextByBotUserId('  '), TENANT_ERROR.MISSING_BOT_USER_ID);
  await rejectsWith(getTenantContextByBotUserId('nope'), TENANT_ERROR.BOT_NOT_FOUND);

  await Bot.create({ botUserId: '5000', name: 'Orphan', orgId: 'ghost' });
  await rejectsWith(getTenantContextByBotUserId('5000'), TENANT_ERROR.ORG_NOT_FOUND);
  // Creating the organization afterwards works immediately (incomplete records are not cached).
  await Organization.create({ orgId: 'ghost', name: 'Ghost', dbName: 'iq_t_ghost' });
  assert.equal((await getTenantContextByBotUserId('5000')).org.orgId, 'ghost');
});

test('resolveTenantFromEo attaches req.tenant or answers an EO failure envelope', async () => {
  const app = express();
  app.use(express.json());
  app.post('/eo', resolveTenantFromEo, (req, res) => res.json({ orgId: req.tenant.org.orgId }));

  const ok = await request(app).post('/eo').send(sample).expect(200);
  assert.deepEqual(ok.body, { orgId: 'demo' });

  const unknown = await request(app)
    .post('/eo')
    .send({ ...sample, botUserId: 'x1' })
    .expect(200);
  assert.equal(unknown.body.resultCode, '1');
  assert.equal(unknown.body.resultText, 'failure');
  assert.equal(unknown.body.eoState, 'stop');
  assert.equal(unknown.body.resMessageObj.parentId, sample.reqMessageObj.signalId);
  assert.equal(decodeBase64(unknown.body.resMessageObj.fileName), TENANT_ERROR_MESSAGES.BOT_NOT_FOUND);
});
