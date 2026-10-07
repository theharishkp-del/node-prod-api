'use strict';

/**
 * @file EO conversation persistence (tenant collection `eo_sessions`), reusable by every
 * EO module.
 *
 * One document per (sessionDate, botUserId, taskId). Each EO call costs ONE atomic upsert:
 *   $setOnInsert  static request fields (written only by the first message)
 *   $push         the inbound message and the outbound reply
 *   $set / $inc   lastMessageAt, lastEoState, messageCount
 *
 * recordEoExchange() never throws: a failed write is logged and reported in the return
 * value, so the EO reply is always sent.
 */
const baseLogger = require('../../config/logger');
const { decodeBase64, decodeMaybeBase64, eoLogSummary } = require('./helpers');

const logger = baseLogger.child({ module: 'eo' });

/** `v` when it is an object, otherwise {}. */
const asObject = (v) => (v && typeof v === 'object' ? v : {});

/** undefined for null/undefined/'' (so the field is not stored), otherwise String(v). */
const opt = (v) => (v === undefined || v === null || v === '' ? undefined : String(v));

/** Drop undefined values so they are not written as nulls. */
const compact = (obj) =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

/**
 * Unique key of the session a payload belongs to.
 * sessionDate is payload.sessionDate (falls back to reqMessageObj.sessionDate).
 * @param {object} payload Incoming EO body.
 * @returns {{sessionDate: string|undefined, botUserId: string|undefined, taskId: string|undefined}}
 */
function buildSessionKey(payload) {
  const p = asObject(payload);
  const req = asObject(p.reqMessageObj);
  return {
    sessionDate: opt(p.sessionDate) || opt(req.sessionDate),
    botUserId: opt(p.botUserId),
    taskId: opt(req.taskId),
  };
}

/**
 * Fields stored once, when the session document is created.
 * @param {object} payload
 * @param {Date} at Time of the first message.
 * @returns {object}
 */
function buildStaticFields(payload, at) {
  const p = asObject(payload);
  const req = asObject(p.reqMessageObj);
  return compact({
    botDatabaseName: opt(p.botDatabaseName),
    taskNo: opt(req.taskNo),
    fromId: opt(req.fromId),
    toId: opt(req.toId),
    fromEmail: opt(req.fromEmail),
    deviceId: opt(req.deviceId),
    env: opt(req.env),
    localTimeZone: opt(req.localTimeZone) || opt(p.localTimeZone),
    databaseName: opt(req.databaseName),
    createdDate: opt(req.createdDate),
    firstMessageAt: at,
  });
}

/**
 * Inbound message entry (what the user sent).
 * @param {object} payload
 * @param {{questionKey: string, answerKey: string, expectedAns: string}} decoded
 * @param {Date} at
 * @returns {object}
 */
function buildInboundMessage(payload, decoded, at) {
  const req = asObject(asObject(payload).reqMessageObj);
  const d = asObject(decoded);
  return compact({
    direction: 'in',
    signalId: opt(req.signalId),
    parentId: opt(req.parentId),
    questionKey: opt(d.questionKey),
    answerKey: opt(d.answerKey),
    expectedAns: opt(d.expectedAns),
    answerText: opt(decodeMaybeBase64(req.fileName)),
    mimeType: opt(req.mimeType),
    at,
  });
}

/**
 * Outbound message entry (the EO reply).
 * @param {object} response EO envelope built by buildEoResponse/buildEoError.
 * @param {{questionKey: string, answerKey: string}} decoded
 * @param {Date} at
 * @returns {object}
 */
function buildOutboundMessage(response, decoded, at) {
  const r = asObject(response);
  const m = asObject(r.resMessageObj);
  const d = asObject(decoded);
  return compact({
    direction: 'out',
    signalId: opt(m.signalId),
    parentId: opt(m.parentId),
    questionKey: opt(d.questionKey),
    answerKey: opt(d.answerKey),
    answerText: opt(decodeBase64(m.fileName) || m.fileName),
    mimeType: opt(m.mimeType),
    eoState: opt(r.eoState),
    resultCode: opt(r.resultCode),
    resultText: opt(r.resultText),
    at,
  });
}

/**
 * Append one EO exchange (request + reply) to its session, creating the session on the
 * first message. Retries once on a duplicate-key race between two concurrent first messages.
 * @param {object} options
 * @param {import('mongoose').Model} options.EoSession Tenant model (req.tenant.models.EoSession).
 * @param {object} options.payload Incoming EO body.
 * @param {object} options.decoded decodeContext(payload.context).
 * @param {object} options.response EO envelope that is being sent back.
 * @param {Date} [options.at=new Date()]
 * @returns {Promise<{saved: boolean, session?: object, skipped?: string, error?: Error}>}
 *   Never rejects.
 */
async function recordEoExchange({ EoSession, payload, decoded, response, at = new Date() }) {
  const key = buildSessionKey(payload);
  const missing = Object.keys(key).filter((k) => !key[k]);
  if (missing.length > 0) {
    logger.warn('eo.session_skipped', {
      event: 'eo.session_skipped',
      reason: `missing ${missing.join(', ')}`,
      ...eoLogSummary(payload, asObject(decoded)),
    });
    return { saved: false, skipped: `missing ${missing.join(', ')}` };
  }

  const update = {
    $setOnInsert: buildStaticFields(payload, at),
    $push: {
      messages: {
        $each: [buildInboundMessage(payload, decoded, at), buildOutboundMessage(response, decoded, at)],
      },
    },
    $set: compact({ lastMessageAt: at, lastEoState: opt(asObject(response).eoState) }),
    $inc: { messageCount: 2 },
  };
  const options = { upsert: true, new: true, lean: true, projection: { messages: 0 } };

  for (let attempt = 1; ; attempt += 1) {
    try {
      const session = await EoSession.findOneAndUpdate(key, update, options);
      return { saved: true, session };
    } catch (error) {
      if (error && error.code === 11000 && attempt === 1) continue; // lost the insert race
      logger.error('eo.session_save_failed', {
        event: 'eo.session_save_failed',
        ...eoLogSummary(payload, asObject(decoded), response),
        err: error,
      });
      return { saved: false, error };
    }
  }
}

module.exports = {
  recordEoExchange,
  buildSessionKey,
  buildStaticFields,
  buildInboundMessage,
  buildOutboundMessage,
};
