'use strict';

/**
 * @file customerOrderRequestEo module: endpoint, tenant resolution, session persistence,
 * handler registry, logging and EO env defaults. Uses a throw-away MongoDB with the demo
 * organization/bot (botUserId 3183 of the fixture) seeded.
 */
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/test';
process.env.LOG_TO_FILE = 'false';
process.env.LOG_LEVEL = 'error';
process.env.LOG_BODIES = 'true';
process.env.LOG_BODY_MAX_LENGTH = '100';
process.env.APP_BASE_PATH = '/iqagent';
process.env.EO_FROM_SERVER = 'FSMAGENT_TEST';
process.env.EO_LOG_FULL = 'true';
process.env.EO_ORDER_BASE_URL = 'https://orders.example.com/book';

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const createApp = require('../../src/app');
const handlers = require('../../src/modules/customerOrderRequestEo/handlers');
const { QUESTION_KEYS, ANSWER_KEYS } = require('../../src/modules/customerOrderRequestEo/constants');
const { EO_RESULT, encodeBase64, decodeBase64, resolveHandler } = require('../../src/shared/eo');
const { captureLogs, nextTick } = require('../helpers/captureLogs');
const { startTestDb } = require('../helpers/testDb');
const { seedDemo } = require('../../scripts/seed');
const { getMasterModels, getTenantModels, invalidateTenantCache, TENANT_ERROR_MESSAGES } = require('../../src/shared/tenancy');
const sample = require('../fixtures/eoRequest.json');

const app = createApp();
const clone = (v) => JSON.parse(JSON.stringify(v));
const PATHS = ['/api/customerOrderRequestEo', '/iqagent/api/customerOrderRequestEo'];

let db;
test.before(async () => {
  db = await startTestDb();
  await seedDemo();
});
test.after(() => db && db.stop());

/** eo_sessions model of the demo tenant. */
const sessions = () => getTenantModels('iq_t_demo').EoSession;

test('registry maps customer menu answer 3 to bookNewOrderViaWebsite; unknown keys to default', () => {
  const { registry, defaultHandler } = handlers;
  const h = resolveHandler(QUESTION_KEYS.CUSTOMER_MENU, ANSWER_KEYS.BOOK_NEW_ORDER_VIA_WEBSITE, registry, defaultHandler);
  assert.equal(h.name, 'bookNewOrderViaWebsite');
  assert.equal(resolveHandler('x', 'y', registry, defaultHandler), defaultHandler);
});

for (const p of PATHS) {
  test(`POST ${p} returns the EO response for the sample payload`, async () => {
    const res = await request(app).post(p).send(sample).expect(200);
    const body = res.body;
    assert.deepEqual(Object.keys(body), [
      'resultCode',
      'resultText',
      'resMessageObj',
      'fromServer',
      'eoState',
      'reqMessageObj',
    ]);
    assert.equal(body.resultCode, '0');
    assert.equal(body.resultText, 'success');
    assert.equal(body.fromServer, 'FSMAGENT_TEST');
    assert.equal(body.eoState, 'stop');
    assert.deepEqual(body.reqMessageObj, sample.reqMessageObj);
    const m = body.resMessageObj;
    assert.equal(m.taskId, '6472');
    assert.equal(m.fromId, '3183');
    assert.equal(m.parentId, '33004652728201345');
    assert.equal(m.databaseName, 'HM_6');
    assert.equal(m.mimeType, 'text');
    assert.match(m.signalId, /^\d{17}$/);
    const text = decodeBase64(m.fileName);
    assert.match(text, /book a new order/i);
    assert.ok(text.includes('https://orders.example.com/book'));
  });

  test(`POST ${p} uses the default handler for unmapped keys`, async () => {
    const payload = clone(sample);
    payload.context.questionKey = encodeBase64('iq+unknown_question');
    payload.context.answerKey = encodeBase64('iq+unknown_answer');
    const res = await request(app).post(p).send(payload).expect(200);
    assert.equal(res.body.resultCode, '0');
    assert.equal(res.body.eoState, 'stop');
    const text = decodeBase64(res.body.resMessageObj.fileName);
    assert.match(text, /not configured/);
    assert.ok(text.includes('iq+unknown_question') && text.includes('iq+unknown_answer'));
  });
}

test('request without a body / botUserId -> EO failure envelope explaining the problem', async () => {
  const res = await request(app).post('/api/customerOrderRequestEo').expect(200);
  assert.equal(res.body.resultCode, EO_RESULT.FAILURE_CODE);
  assert.equal(res.body.resultText, 'failure');
  assert.equal(res.body.eoState, 'stop');
  assert.equal(res.body.fromServer, 'FSMAGENT_TEST');
  assert.equal(decodeBase64(res.body.resMessageObj.fileName), TENANT_ERROR_MESSAGES.MISSING_BOT_USER_ID);
});

test('unknown bot -> EO failure envelope, logged as eo.tenant_rejected, nothing saved', async () => {
  const logs = captureLogs();
  try {
    const payload = clone(sample);
    payload.botUserId = '999999';
    const res = await request(app).post('/iqagent/api/customerOrderRequestEo').send(payload).expect(200);
    assert.equal(res.body.resultText, 'failure');
    assert.equal(res.body.resMessageObj.parentId, '33004652728201345');
    assert.equal(decodeBase64(res.body.resMessageObj.fileName), TENANT_ERROR_MESSAGES.BOT_NOT_FOUND);
    const log = logs.entries.find((e) => e.event === 'eo.tenant_rejected');
    assert.ok(log, 'rejection logged');
    assert.equal(log.level, 'warn');
    assert.equal(log.reason, 'BOT_NOT_FOUND');
    assert.equal(log.botUserId, '999999');
    assert.equal(await sessions().countDocuments({ botUserId: '999999' }), 0);
  } finally {
    logs.restore();
  }
});

test('inactive bot and suspended organization -> EO failure envelopes', async () => {
  const { Bot, Organization } = getMasterModels();
  try {
    await Bot.updateOne({ botUserId: '3183' }, { status: 'inactive' });
    invalidateTenantCache({ botUserId: '3183' });
    let res = await request(app).post('/api/customerOrderRequestEo').send(sample).expect(200);
    assert.equal(decodeBase64(res.body.resMessageObj.fileName), TENANT_ERROR_MESSAGES.BOT_INACTIVE);

    await Bot.updateOne({ botUserId: '3183' }, { status: 'active' });
    await Organization.updateOne({ orgId: 'demo' }, { status: 'suspended' });
    invalidateTenantCache({ orgId: 'demo' });
    res = await request(app).post('/api/customerOrderRequestEo').send(sample).expect(200);
    assert.equal(res.body.resultText, 'failure');
    assert.equal(decodeBase64(res.body.resMessageObj.fileName), TENANT_ERROR_MESSAGES.ORG_SUSPENDED);
  } finally {
    await Bot.updateOne({ botUserId: '3183' }, { status: 'active' });
    await Organization.updateOne({ orgId: 'demo' }, { status: 'active' });
    invalidateTenantCache();
  }
});

test('end to end: EO call is answered and saved to the tenant eo_sessions collection', async () => {
  const payload = clone(sample);
  payload.sessionDate = '20261007999999001'; // fresh session for this test
  const first = await request(app).post('/iqagent/api/customerOrderRequestEo').send(payload).expect(200);

  const doc = await sessions().findOne({ sessionDate: '20261007999999001' }).lean();
  assert.ok(doc, 'session document created in iq_t_demo.eo_sessions');
  assert.equal(doc.botUserId, '3183');
  assert.equal(doc.botDatabaseName, 'SYSTEMBOT63183');
  assert.equal(doc.taskId, '6472');
  assert.equal(doc.taskNo, '2026100706295954997453');
  assert.equal(doc.fromId, '3138');
  assert.equal(doc.fromEmail, 'sup1@cognitivemobile.net');
  assert.equal(doc.messageCount, 2);
  const [inMsg, outMsg] = doc.messages;
  assert.equal(inMsg.direction, 'in');
  assert.equal(inMsg.signalId, '33004652728201345');
  assert.equal(inMsg.answerText, '3'); // decoded reqMessageObj.fileName 'Mw=='
  assert.equal(inMsg.questionKey, 'iq+customer_menu');
  assert.equal(inMsg.answerKey, 'iq+customer_menu_ans_3');
  assert.equal(outMsg.direction, 'out');
  assert.equal(outMsg.signalId, first.body.resMessageObj.signalId);
  assert.equal(outMsg.parentId, '33004652728201345');
  assert.equal(outMsg.answerText, decodeBase64(first.body.resMessageObj.fileName));
  assert.equal(outMsg.eoState, 'stop');
  assert.equal(outMsg.resultCode, '0');

  // Second step of the same conversation is appended to the same document.
  payload.reqMessageObj.signalId = '33004652728209999';
  await request(app).post('/api/customerOrderRequestEo').send(payload).expect(200);
  const again = await sessions().find({ sessionDate: '20261007999999001' }).lean();
  assert.equal(again.length, 1);
  assert.equal(again[0].messageCount, 4);
  assert.equal(again[0].messages[2].signalId, '33004652728209999');
});

test('a failing session write is logged and the EO reply is still sent', async (t) => {
  const EoSession = sessions();
  t.mock.method(EoSession, 'findOneAndUpdate', async () => {
    throw new Error('disk full');
  });
  const logs = captureLogs();
  try {
    const res = await request(app).post('/api/customerOrderRequestEo').send(sample).expect(200);
    assert.equal(res.body.resultCode, '0');
    assert.match(decodeBase64(res.body.resMessageObj.fileName), /book a new order/i);
    const err = logs.entries.find((e) => e.event === 'eo.session_save_failed');
    assert.ok(err, 'save failure logged');
    assert.equal(err.err.message, 'disk full');
    const resLog = logs.entries.find((e) => e.message === 'eo.response');
    assert.equal(resLog.sessionSaved, false);
  } finally {
    logs.restore();
  }
});

test('tenant lookup failure (e.g. MongoDB down) -> EO "temporarily unavailable" envelope', async (t) => {
  invalidateTenantCache();
  const { Bot } = getMasterModels();
  t.mock.method(Bot, 'findOne', () => {
    throw new Error('connection refused');
  });
  const logs = captureLogs();
  try {
    const res = await request(app).post('/api/customerOrderRequestEo').send(sample).expect(200);
    assert.equal(res.body.resultText, 'failure');
    assert.match(decodeBase64(res.body.resMessageObj.fileName), /temporarily unavailable/);
    const log = logs.entries.find((e) => e.event === 'eo.tenant_lookup_failed');
    assert.equal(log.level, 'error');
  } finally {
    logs.restore();
  }
});

test('handler exception -> 200 with buildEoError body and error log', async () => {
  handlers.registry['iq+test_throw'] = {
    default: async () => {
      throw new Error('handler exploded');
    },
  };
  const logs = captureLogs();
  try {
    const payload = clone(sample);
    payload.context.questionKey = encodeBase64('iq+test_throw');
    const res = await request(app).post('/iqagent/api/customerOrderRequestEo').send(payload).expect(200);
    assert.equal(res.body.resultCode, EO_RESULT.FAILURE_CODE);
    assert.equal(res.body.resultText, EO_RESULT.FAILURE_TEXT);
    assert.equal(res.body.eoState, 'stop');
    assert.equal(res.body.resMessageObj.parentId, '33004652728201345');
    const errLog = logs.entries.find((e) => e.event === 'eo.handler_error');
    assert.ok(errLog, 'error logged');
    assert.equal(errLog.level, 'error');
    assert.equal(errLog.err.message, 'handler exploded');
    assert.equal(errLog.questionKey, 'iq+test_throw');
  } finally {
    logs.restore();
    delete handlers.registry['iq+test_throw'];
  }
});

test('EO_LOG_FULL=true logs the full, untruncated, unredacted payload and response', async () => {
  const logs = captureLogs();
  try {
    const payload = clone(sample);
    payload.reqMessageObj.password = 'not-redacted';
    await request(app).post('/api/customerOrderRequestEo').send(payload).expect(200);
    await nextTick();
    const reqLog = logs.entries.find((e) => e.message === 'eo.request');
    const resLog = logs.entries.find((e) => e.message === 'eo.response');
    assert.ok(reqLog && resLog);
    assert.equal(reqLog.level, 'info');
    assert.deepEqual(reqLog.payload, payload); // full, not truncated (LOG_BODY_MAX_LENGTH=100)
    assert.equal(reqLog.payload.reqMessageObj.password, 'not-redacted');
    assert.equal(reqLog.questionKey, 'iq+customer_menu');
    assert.equal(reqLog.requestId, undefined);
    assert.equal(resLog.response.resMessageObj.parentId, '33004652728201345');
    assert.equal(resLog.questionKey, 'iq+customer_menu');
    assert.equal(resLog.answerKey, 'iq+customer_menu_ans_3');
    assert.equal(resLog.resultCode, '0');
    assert.equal(resLog.eoState, 'stop');
    assert.equal(resLog.handler, 'bookNewOrderViaWebsite');
    const access = logs.entries.find((e) => e.event === 'http.request');
    assert.ok(access, 'access log still written');
    assert.equal(access.reqBody, undefined, 'generic logger skips its truncated body copy');
    assert.equal(access.resBody, undefined);
    assert.equal(access.bodiesLoggedAs, 'eo.request/eo.response');
  } finally {
    logs.restore();
  }
});

test('EO env defaults: EO_LOG_FULL true unless production, EO_FROM_SERVER FSMAGENT', () => {
  const run = (extra) => {
    const env = {
      PATH: process.env.PATH,
      MONGODB_URI: 'mongodb://127.0.0.1:27017/x',
      ADMIN_API_KEY: 'test-admin-key-0123456789', // required in production
      ...extra,
    };
    const r = spawnSync(
      process.execPath,
      ['-e', "const c=require('./src/config');process.stdout.write(JSON.stringify(c.eo))"],
      { cwd: path.resolve(__dirname, '../..'), env, encoding: 'utf8' },
    );
    return { status: r.status, eo: r.status === 0 ? JSON.parse(r.stdout) : null, stderr: r.stderr };
  };
  assert.deepEqual(run({ NODE_ENV: 'development' }).eo, {
    fromServer: 'FSMAGENT',
    logFull: true,
    orderBaseUrl: '',
  });
  assert.equal(run({ NODE_ENV: 'production' }).eo.logFull, false);
  assert.equal(run({ NODE_ENV: 'production', EO_LOG_FULL: 'true' }).eo.logFull, true);
  assert.equal(run({ NODE_ENV: 'development', EO_LOG_FULL: 'false' }).eo.logFull, false);
  const bad = run({ EO_ORDER_BASE_URL: 'not a url' });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /EO_ORDER_BASE_URL/);
});
