'use strict';

/** @file Shared EO toolkit: base64, signal ids, context decoding, builders, handler lookup. */
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/test';
process.env.LOG_TO_FILE = 'false';
process.env.LOG_LEVEL = 'error';
process.env.EO_FROM_SERVER = 'FSMAGENT_TEST';

const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../../src/config');
const {
  EO_RESULT,
  EO_STATE,
  encodeBase64,
  decodeBase64,
  generateSignalId,
  decodeContext,
  buildEoResponse,
  buildEoError,
  resolveHandler,
  eoLogSummary,
  runEoStep,
} = require('../../src/shared/eo');
const sample = require('../fixtures/eoRequest.json');

const clone = (v) => JSON.parse(JSON.stringify(v));
const RESPONSE_KEYS = ['resultCode', 'resultText', 'resMessageObj', 'fromServer', 'eoState', 'reqMessageObj'];

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
  // '//79' is valid base64 but not valid UTF-8.
  for (const bad of [null, undefined, '', '   ', 123, {}, '!!!', 'abc', 'Mw=', 'Mw===', 'a$b=', '//79']) {
    assert.equal(decodeBase64(bad), '', `input ${JSON.stringify(bad)}`);
  }
  assert.equal(decodeBase64(' Mw== \n'), '3');
});

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

test('buildEoResponse maps fields exactly', () => {
  const payload = clone(sample);
  const res = buildEoResponse(payload, { fileName: 'Hello ₹', eoState: 'stop', signalId: '12345678901234567' });
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
  assert.deepEqual(Object.keys(res), RESPONSE_KEYS);
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
  assert.equal(buildEoError(null).eoState, 'stop');
});

test('buildEoError uses failure defaults and eoState stop', () => {
  const res = buildEoError(sample, { message: 'boom' });
  assert.equal(res.resultCode, EO_RESULT.FAILURE_CODE);
  assert.equal(res.resultText, EO_RESULT.FAILURE_TEXT);
  assert.equal(res.eoState, EO_STATE.STOP);
  assert.equal(decodeBase64(res.resMessageObj.fileName), 'boom');
  assert.equal(res.resMessageObj.parentId, '33004652728201345');
  const custom = buildEoError(sample, { resultCode: '9', resultText: 'nope' });
  assert.equal(custom.resultCode, '9');
  assert.equal(decodeBase64(custom.resMessageObj.fileName), EO_RESULT.FAILURE_MESSAGE);
});

test('resolveHandler: exact, question default, fallback, prototype keys', () => {
  const exact = async () => ({});
  const qDefault = async () => ({});
  const fallback = async () => ({});
  const reg = { q1: { a1: exact, default: qDefault }, q2: { a1: exact } };
  assert.equal(resolveHandler('q1', 'a1', reg, fallback), exact);
  assert.equal(resolveHandler('q1', 'zz', reg, fallback), qDefault);
  assert.equal(resolveHandler('q2', 'zz', reg, fallback), fallback);
  assert.equal(resolveHandler('nope', 'a1', reg, fallback), fallback);
  assert.equal(resolveHandler('__proto__', 'constructor', reg, fallback), fallback);
  assert.equal(resolveHandler('q1', 'toString', reg, fallback), qDefault);
  assert.equal(resolveHandler('q1', 'a1', undefined, fallback), fallback);
});

test('eoLogSummary contains only the compact fields', () => {
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

test('runEoStep runs the matching handler and wraps its result', async () => {
  const registry = {
    'iq+customer_menu': { 'iq+customer_menu_ans_3': async (p, d) => ({ fileName: `hi ${d.apiAnswer}` }) },
  };
  const { decoded, response, error } = await runEoStep(sample, { registry, defaultHandler: async () => ({}) });
  assert.equal(error, undefined);
  assert.equal(decoded.questionKey, 'iq+customer_menu');
  assert.equal(response.resultCode, '0');
  assert.equal(response.eoState, 'stop', 'eoState defaults to stop');
  assert.equal(response.resMessageObj.mimeType, 'text');
  assert.equal(decodeBase64(response.resMessageObj.fileName), 'hi 3 or Book a New Order via website');
});

test('runEoStep turns a throwing handler into a buildEoError envelope', async () => {
  const boom = async function boom() {
    throw new Error('exploded');
  };
  const { handler, response, error } = await runEoStep(sample, { registry: {}, defaultHandler: boom });
  assert.equal(handler, boom);
  assert.equal(error.message, 'exploded');
  assert.equal(response.resultCode, EO_RESULT.FAILURE_CODE);
  assert.equal(response.eoState, 'stop');
});
