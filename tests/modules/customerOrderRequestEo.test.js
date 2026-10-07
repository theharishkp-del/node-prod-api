'use strict';

/** @file customerOrderRequestEo module: endpoint, handler registry, logging and EO env defaults. */
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
const sample = require('../fixtures/eoRequest.json');

const app = createApp();
const clone = (v) => JSON.parse(JSON.stringify(v));
const PATHS = ['/api/customerOrderRequestEo', '/iqagent/api/customerOrderRequestEo'];

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

test('EO endpoint works without MongoDB and without a body', async () => {
  const res = await request(app).post('/api/customerOrderRequestEo').expect(200);
  assert.equal(res.body.eoState, 'stop');
  assert.equal(res.body.fromServer, 'FSMAGENT_TEST');
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
    const env = { PATH: process.env.PATH, MONGODB_URI: 'mongodb://127.0.0.1:27017/x', ...extra };
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
