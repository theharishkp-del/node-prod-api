'use strict';

/**
 * @file EO session persistence (shared/eo/session.service): one document per
 * (sessionDate, botUserId, taskId), static fields written once, messages appended.
 */
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/test';
process.env.LOG_TO_FILE = 'false';
process.env.LOG_LEVEL = 'error';

const test = require('node:test');
const assert = require('node:assert/strict');
const { recordEoExchange, buildEoResponse, decodeContext, decodeBase64 } = require('../../src/shared/eo');
const { getTenantModels, initTenantDatabase } = require('../../src/shared/tenancy');
const { startTestDb } = require('../helpers/testDb');
const { captureLogs } = require('../helpers/captureLogs');
const sample = require('../fixtures/eoRequest.json');

const DB = 'iq_t_session_test';
const clone = (v) => JSON.parse(JSON.stringify(v));

let db;
let EoSession;
test.before(async () => {
  db = await startTestDb();
  await initTenantDatabase(DB);
  EoSession = getTenantModels(DB).EoSession;
});
test.after(() => db && db.stop());
test.beforeEach(() => EoSession.deleteMany({}));

/** Record one exchange for `payload` with reply text `text`. */
function record(payload, text = 'reply', at = new Date()) {
  const response = buildEoResponse(payload, { fileName: text, eoState: 'stop' });
  return recordEoExchange({ EoSession, payload, decoded: decodeContext(payload.context), response, at });
}

test('unique compound index (sessionDate, botUserId, taskId) exists', async () => {
  const indexes = await EoSession.collection.indexes();
  const idx = indexes.find((i) => i.unique && i.key.sessionDate === 1);
  assert.deepEqual(idx.key, { sessionDate: 1, botUserId: 1, taskId: 1 });
});

test('first message creates the session with static fields and both messages', async () => {
  const at = new Date('2026-10-07T06:31:00Z');
  const res = await record(clone(sample), 'Hello ₹', at);
  assert.equal(res.saved, true);
  assert.equal(res.session.messages, undefined, 'messages not returned (projection)');

  const doc = await EoSession.findOne().lean();
  assert.deepEqual(
    {
      sessionDate: doc.sessionDate,
      botUserId: doc.botUserId,
      botDatabaseName: doc.botDatabaseName,
      taskId: doc.taskId,
      taskNo: doc.taskNo,
      fromId: doc.fromId,
      toId: doc.toId,
      fromEmail: doc.fromEmail,
      deviceId: doc.deviceId,
      env: doc.env,
      localTimeZone: doc.localTimeZone,
      databaseName: doc.databaseName,
      createdDate: doc.createdDate,
    },
    {
      sessionDate: '20261007062959549',
      botUserId: '3183',
      botDatabaseName: 'SYSTEMBOT63183',
      taskId: '6472',
      taskNo: '2026100706295954997453',
      fromId: '3138',
      toId: '3183',
      fromEmail: 'sup1@cognitivemobile.net',
      deviceId: 'test-device-id',
      env: 'prod',
      localTimeZone: 'Asia/Calcutta',
      databaseName: 'HM_6',
      createdDate: '2026-10-07 06:30:57.121',
    },
  );
  assert.equal(doc.firstMessageAt.toISOString(), at.toISOString());
  assert.equal(doc.lastMessageAt.toISOString(), at.toISOString());
  assert.equal(doc.messageCount, 2);
  assert.equal(doc.lastEoState, 'stop');
  assert.ok(doc.createdAt && doc.updatedAt, 'timestamps');

  const [inMsg, outMsg] = doc.messages;
  assert.deepEqual(
    { ...inMsg, at: undefined },
    {
      direction: 'in',
      signalId: '33004652728201345',
      parentId: '20337731133105397',
      questionKey: 'iq+customer_menu',
      answerKey: 'iq+customer_menu_ans_3',
      expectedAns: '3 or Book a New Order via website',
      answerText: '3',
      mimeType: 'text',
      at: undefined,
    },
  );
  assert.equal(outMsg.direction, 'out');
  assert.equal(outMsg.parentId, '33004652728201345');
  assert.match(outMsg.signalId, /^\d{17}$/);
  assert.equal(outMsg.answerText, 'Hello ₹');
  assert.equal(outMsg.eoState, 'stop');
  assert.equal(outMsg.resultCode, '0');
  assert.equal(outMsg.resultText, 'success');
});

test('second message appends; static fields keep their first values', async () => {
  const first = new Date('2026-10-07T06:31:00Z');
  const second = new Date('2026-10-07T06:32:00Z');
  await record(clone(sample), 'one', first);

  const next = clone(sample);
  next.reqMessageObj.signalId = '33004652728201999';
  next.reqMessageObj.fileName = Buffer.from('hello again').toString('base64');
  next.reqMessageObj.fromEmail = 'changed@example.com';
  await record(next, 'two', second);

  const docs = await EoSession.find().lean();
  assert.equal(docs.length, 1);
  const doc = docs[0];
  assert.equal(doc.messageCount, 4);
  assert.equal(doc.messages.length, 4);
  assert.equal(doc.fromEmail, 'sup1@cognitivemobile.net', '$setOnInsert only');
  assert.equal(doc.firstMessageAt.toISOString(), first.toISOString());
  assert.equal(doc.lastMessageAt.toISOString(), second.toISOString());
  assert.deepEqual(
    doc.messages.map((m) => [m.direction, m.answerText]),
    [
      ['in', '3'],
      ['out', 'one'],
      ['in', 'hello again'],
      ['out', 'two'],
    ],
  );
});

test('a new sessionDate (or taskId) starts a new document', async () => {
  await record(clone(sample));
  const nextDay = clone(sample);
  nextDay.sessionDate = '20261008090000000';
  await record(nextDay);
  const otherTask = clone(sample);
  otherTask.reqMessageObj.taskId = '7000';
  await record(otherTask);
  assert.equal(await EoSession.countDocuments(), 3);
  assert.equal(await EoSession.countDocuments({ sessionDate: '20261007062959549' }), 2);
});

test('concurrent first messages end up in one document (duplicate-key race retried)', async () => {
  await Promise.all(Array.from({ length: 6 }, () => record(clone(sample))));
  const docs = await EoSession.find().lean();
  assert.equal(docs.length, 1);
  assert.equal(docs[0].messageCount, 12);
});

test('payload without sessionDate/taskId is skipped, not saved', async () => {
  const payload = clone(sample);
  delete payload.sessionDate;
  delete payload.reqMessageObj.taskId;
  const res = await record(payload);
  assert.equal(res.saved, false);
  assert.match(res.skipped, /sessionDate, taskId/);
  assert.equal(await EoSession.countDocuments(), 0);
});

test('write errors are returned and logged, never thrown', async () => {
  const logs = captureLogs();
  try {
    const failing = { findOneAndUpdate: async () => Promise.reject(new Error('boom')) };
    const payload = clone(sample);
    const response = buildEoResponse(payload, { fileName: 'x', eoState: 'stop' });
    const res = await recordEoExchange({ EoSession: failing, payload, decoded: decodeContext(payload.context), response });
    assert.equal(res.saved, false);
    assert.equal(res.error.message, 'boom');
    const log = logs.entries.find((e) => e.event === 'eo.session_save_failed');
    assert.equal(log.level, 'error');
    assert.equal(log.taskId, '6472');
    assert.equal(decodeBase64(response.resMessageObj.fileName), 'x');
  } finally {
    logs.restore();
  }
});
