'use strict';

// EO helpers + POST /api/customerOrderRequestEo (no MongoDB needed).
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

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const winston = require('winston');
const config = require('../src/config');
const logger = require('../src/config/logger');
const createApp = require('../src/app');
const handlers = require('../src/eo/handlers');
const { eoLogSummary } = require('../src/controllers/eo.controller');
const {
  EO_RESULT,
  encodeBase64,
  decodeBase64,
  generateSignalId,
  decodeContext,
  buildEoResponse,
  buildEoError,
  resolveHandler,
} = require('../src/utils/eo');
const sample = require('./fixtures/eoRequest.json');

const app = createApp();
const clone = (v) => JSON.parse(JSON.stringify(v));
const PATHS = ['/api/customerOrderRequestEo', '/iqagent/api/customerOrderRequestEo'];

/** Captures log entries at info+ without printing them. */
function captureLogs() {
  const entries = [];
  class Capture extends winston.Transport {
    log(info, cb) {
      entries.push(info);
      cb();
    }
  }
  const transport = new Capture({ level: 'info' });
  const previousLevel = logger.level;
  const silenced = logger.transports.filter((t) => !t.silent);
  silenced.forEach((t) => (t.silent = true));
  logger.add(transport);
  logger.level = 'info';
  return {
    entries,
    restore() {
      logger.remove(transport);
      logger.level = previousLevel;
      silenced.forEach((t) => (t.silent = false));
    },
  };
}

// ---- base64 ------------------------------------------------------------------------
test('encodeBase64 / decodeBase64 round-trip utf8', () => {
  assert.equal(encodeBase64('iq+customer_menu'), 'aXErY3VzdG9tZXJfbWVudQ==');
  assert.equal(decodeBase64('aXErY3VzdG9tZXJfbWVudQ=='), 'iq+customer_menu');
  const text = 'Héllo ₹ 世界 👋';
  assert.equal(decodeBase64(encodeBase64(text)), text);
  assert.equal(encodeBase64(3), 'Mw==');
  assert.equal(encodeBase64(null), '');
  assert.equal(encodeBase64(undefined), '');
  assert.equal(encodeBase64(''), '');
});

test('decodeBase64 returns empty string for null/empty/invalid input', () => {
  for (const bad of [null, undefined, '', '   ', 123, {}, '!!!', 'abc', 'Mw=', 'Mw===', 'a$b=', '//79']) {
    assert.equal(decodeBase64(bad), '', `input ${JSON.stringify(bad)}`);
  }
  // '//79' is valid base64 but not valid UTF-8 -> ''. Whitespace is tolerated.
  assert.equal(decodeBase64(' Mw== \n'), '3');
});

// ---- signal id ---------------------------------------------------------------------
test('generateSignalId returns 17-digit numeric strings, unique over 10k calls', () => {
  const ids = new Set();
  for (let i = 0; i < 10000; i += 1) {
    const id = generateSignalId();
    assert.match(id, /^\d{17}$/);
    ids.add(id);
  }
  assert.equal(ids.size, 10000);
  const ts = Number(generateSignalId().slice(0, 13));
  assert.ok(Math.abs(ts - Date.now()) < 60000, 'prefix is (close to) epoch ms');
});

// ---- decodeContext -----------------------------------------------------------------
test('decodeContext decodes the sample payload context', () => {
  assert.deepEqual(decodeContext(sample.context), {
    questionKey: 'iq+customer_menu',
    answerKey: 'iq+customer_menu_ans_3',
    expectedAns: '3 or Book a New Order via website',
    questionUserDefinedObject: '',
    userDefinedObject: '',
    apiAnswer: '3 or Book a New Order via website',
    englishTranslation: '3',
  });
});

test('decodeContext tolerates missing context and plain userDefined values', () => {
  const empty = decodeContext(undefined);
  assert.equal(empty.questionKey, '');
  assert.equal(empty.apiAnswer, '');
  const d = decodeContext({ userDefinedObject: encodeBase64('{"a":1}'), questionUserDefinedObject: '{"b":2}' });
  assert.equal(d.userDefinedObject, '{"a":1}');
  assert.equal(d.questionUserDefinedObject, '{"b":2}'); // not base64 -> kept as-is
});

// ---- builders ----------------------------------------------------------------------
test('buildEoResponse maps fields exactly', () => {
  const payload = clone(sample);
  const res = buildEoResponse(payload, {
    fileName: 'Hello ₹',
    eoState: 'stop',
    signalId: '12345678901234567',
  });
  assert.deepEqual(res, {
    resultCode: '0',
    resultText: 'success',
    resMessageObj: {
      taskId: '6472',
      fromId: '3183',
      signalId: '12345678901234567',
      parentId: '33004652728201345',
      mimeType: 'text',
      databaseName: 'HM_6',
      fileName: Buffer.from('Hello ₹').toString('base64'),
    },
    fromServer: 'FSMAGENT_TEST',
    eoState: 'stop',
    reqMessageObj: sample.reqMessageObj,
  });
  assert.equal(res.reqMessageObj, payload.reqMessageObj, 'echoed unchanged (same object)');
  assert.deepEqual(Object.keys(res), [
    'resultCode',
    'resultText',
    'resMessageObj',
    'fromServer',
    'eoState',
    'reqMessageObj',
  ]);
});

test('buildEoResponse dynamic params, generated signalId and raw fileName', () => {
  const res = buildEoResponse(sample, {
    resultCode: '7',
    resultText: 'custom',
    fileName: 'raw',
    eoState: 'continue',
    mimeType: 'image',
    encodeFileName: false,
  });
  assert.equal(res.resultCode, '7');
  assert.equal(res.resultText, 'custom');
  assert.equal(res.eoState, 'continue');
  assert.equal(res.resMessageObj.mimeType, 'image');
  assert.equal(res.resMessageObj.fileName, 'raw');
  assert.match(res.resMessageObj.signalId, /^\d{17}$/);
  assert.equal(config.eo.fromServer, 'FSMAGENT_TEST');
});

test('buildEoResponse / buildEoError do not throw on an empty payload', () => {
  const res = buildEoResponse(undefined, { fileName: 'x', eoState: 'stop' });
  assert.equal(res.resMessageObj.taskId, undefined);
  assert.equal(res.reqMessageObj, undefined);
  const err = buildEoError(null);
  assert.equal(err.eoState, 'stop');
});

test('buildEoError uses failure defaults and eoState stop', () => {
  const res = buildEoError(sample, { message: 'boom' });
  assert.equal(res.resultCode, EO_RESULT.FAILURE_CODE);
  assert.equal(res.resultText, EO_RESULT.FAILURE_TEXT);
  assert.equal(res.eoState, 'stop');
  assert.equal(decodeBase64(res.resMessageObj.fileName), 'boom');
  assert.equal(res.resMessageObj.parentId, '33004652728201345');
  const custom = buildEoError(sample, { resultCode: '9', resultText: 'nope' });
  assert.equal(custom.resultCode, '9');
  assert.equal(decodeBase64(custom.resMessageObj.fileName), EO_RESULT.FAILURE_MESSAGE);
});

// ---- handler lookup ----------------------------------------------------------------
test('resolveHandler: exact, question default, global default, prototype keys', () => {
  const exact = async () => ({});
  const qDefault = async () => ({});
  const globalDefault = async () => ({});
  const reg = { q1: { a1: exact, default: qDefault }, q2: { a1: exact } };
  assert.equal(resolveHandler('q1', 'a1', reg, globalDefault), exact);
  assert.equal(resolveHandler('q1', 'zz', reg, globalDefault), qDefault);
  assert.equal(resolveHandler('q2', 'zz', reg, globalDefault), globalDefault);
  assert.equal(resolveHandler('nope', 'a1', reg, globalDefault), globalDefault);
  assert.equal(resolveHandler('__proto__', 'constructor', reg, globalDefault), globalDefault);
  assert.equal(resolveHandler('q1', 'toString', reg, globalDefault), qDefault);
  // real registry
  assert.equal(
    resolveHandler('iq+customer_menu', 'iq+customer_menu_ans_3'),
    handlers.registry['iq+customer_menu']['iq+customer_menu_ans_3'],
  );
  assert.equal(resolveHandler('x', 'y'), handlers.defaultHandler);
});

// ---- endpoint ----------------------------------------------------------------------
for (const path of PATHS) {
  test(`POST ${path} returns the EO response for the sample payload`, async () => {
    const res = await request(app).post(path).send(sample).expect(200);
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

  test(`POST ${path} uses the default handler for unmapped keys`, async () => {
    const payload = clone(sample);
    payload.context.questionKey = encodeBase64('iq+unknown_question');
    payload.context.answerKey = encodeBase64('iq+unknown_answer');
    const res = await request(app).post(path).send(payload).expect(200);
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
  } finally {
    logs.restore();
    delete handlers.registry['iq+test_throw'];
  }
});

test('EO_LOG_FULL=true logs full untruncated payload and response with requestId', async () => {
  const logs = captureLogs();
  try {
    await request(app)
      .post('/api/customerOrderRequestEo')
      .set('X-Request-Id', 'eo-test-1')
      .send(sample)
      .expect(200);
    // Access log is written on 'finish'; give it a tick.
    await new Promise((r) => setImmediate(r));
    const reqLog = logs.entries.find((e) => e.message === 'eo.request');
    const resLog = logs.entries.find((e) => e.message === 'eo.response');
    assert.ok(reqLog && resLog);
    assert.equal(reqLog.requestId, 'eo-test-1');
    assert.equal(resLog.requestId, 'eo-test-1');
    assert.equal(reqLog.level, 'info');
    assert.deepEqual(reqLog.payload, sample); // full, not truncated (LOG_BODY_MAX_LENGTH=100)
    assert.equal(reqLog.payload.reqMessageObj.deviceId, 'test-device-id');
    assert.equal(resLog.response.resMessageObj.parentId, '33004652728201345');
    assert.equal(resLog.questionKey, 'iq+customer_menu');
    assert.equal(resLog.answerKey, 'iq+customer_menu_ans_3');
    assert.equal(resLog.resultCode, '0');
    assert.equal(resLog.eoState, 'stop');
    const access = logs.entries.find((e) => e.event === 'http.request');
    assert.ok(access, 'access log still written');
    assert.equal(access.reqBody, undefined, 'generic logger skips its truncated body copy');
    assert.equal(access.resBody, undefined);
    assert.equal(access.bodiesLoggedAs, 'eo.request/eo.response');
  } finally {
    logs.restore();
  }
});

test('eoLogSummary contains only the compact fields (EO_LOG_FULL=false mode)', () => {
  const decoded = decodeContext(sample.context);
  const response = buildEoResponse(sample, { fileName: 'x', eoState: 'stop', signalId: '1'.repeat(17) });
  assert.deepEqual(eoLogSummary(sample, decoded, response), {
    taskId: '6472',
    signalId: '33004652728201345',
    parentId: '20337731133105397',
    sessionDate: '20261007062959549',
    botUserId: '3183',
    questionKey: 'iq+customer_menu',
    answerKey: 'iq+customer_menu_ans_3',
    resultCode: '0',
    eoState: 'stop',
    resSignalId: '11111111111111111',
  });
});

test('EO env defaults: EO_LOG_FULL true unless production, EO_FROM_SERVER FSMAGENT', () => {
  const { spawnSync } = require('node:child_process');
  const run = (extra) => {
    const env = { PATH: process.env.PATH, MONGODB_URI: 'mongodb://127.0.0.1:27017/x', ...extra };
    const r = spawnSync(
      process.execPath,
      ['-e', "const c=require('./src/config');process.stdout.write(JSON.stringify(c.eo))"],
      { cwd: require('node:path').resolve(__dirname, '..'), env, encoding: 'utf8' },
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
