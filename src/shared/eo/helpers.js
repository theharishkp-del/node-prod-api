'use strict';

/**
 * @file Reusable helpers for the EO (bot conversation step) protocol.
 *
 * Request  : { botUserId, botDatabaseName, fromServer, reqMessageObj, sessionDate, context }
 * Response : { resultCode, resultText, resMessageObj, fromServer, eoState, reqMessageObj }
 *
 * Nothing here touches the database or knows about a specific EO API; each module passes
 * its own handler registry to resolveHandler().
 */
const config = require('../../config');
const { EO_RESULT, EO_STATE } = require('./constants');

const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

/** '' for null/undefined, otherwise String(v). */
const str = (v) => (v === undefined || v === null ? '' : String(v));

/** `v` when it is an object, otherwise {} (so property access never throws). */
const asObject = (v) => (v && typeof v === 'object' ? v : {});

/**
 * Encode UTF-8 text as base64.
 * @param {*} text Non-strings are stringified.
 * @returns {string} '' for null/undefined.
 */
function encodeBase64(text) {
  if (text === undefined || text === null) return '';
  return Buffer.from(String(text), 'utf8').toString('base64');
}

/**
 * Decode base64 to UTF-8 text. Never throws; whitespace inside the value is ignored.
 * @param {*} text
 * @returns {string} '' for non-string/empty input, malformed base64 or invalid UTF-8.
 */
function decodeBase64(text) {
  if (typeof text !== 'string') return '';
  const clean = text.replace(/\s+/g, '');
  if (!clean || !BASE64_RE.test(clean)) return '';
  try {
    return utf8Decoder.decode(Buffer.from(clean, 'base64'));
  } catch {
    return '';
  }
}

let lastMs = 0;
let seq = 0;

/**
 * Unique 17-digit numeric id: 13-digit epoch ms + 4-digit sequence.
 * The sequence starts at a random value (0-4999) in each new ms and increments within the
 * same ms; on overflow past 9999 the timestamp part advances by one ms. Ids are strictly
 * increasing and unique within this process. Across processes collisions are unlikely
 * but possible (TODO if ids must be globally unique: add an instance digit or a DB sequence).
 * @returns {string}
 */
function generateSignalId() {
  const now = Date.now();
  if (now > lastMs) {
    lastMs = now;
    seq = Math.floor(Math.random() * 5000);
  } else {
    seq += 1;
    if (seq > 9999) {
      lastMs += 1;
      seq = 0;
    }
  }
  return `${lastMs}${String(seq).padStart(4, '0')}`;
}

/**
 * Decode a field that may be base64 or plain text (kept as-is when not valid base64).
 * @param {*} value
 * @returns {string}
 */
function decodeMaybeBase64(value) {
  const raw = str(value);
  if (!raw) return '';
  return decodeBase64(raw) || raw;
}

/**
 * Decode payload.context.
 * questionKey / answerKey / expectedAns are base64; the userDefined fields may be base64
 * or plain/empty; apiAnswer / englishTranslation are plain text.
 * @param {object} [context]
 * @returns {{questionKey: string, answerKey: string, expectedAns: string,
 *   questionUserDefinedObject: string, userDefinedObject: string, apiAnswer: string,
 *   englishTranslation: string}}
 */
function decodeContext(context) {
  const c = asObject(context);
  return {
    questionKey: decodeBase64(c.questionKey),
    answerKey: decodeBase64(c.answerKey),
    expectedAns: decodeBase64(c.expectedAns),
    questionUserDefinedObject: decodeMaybeBase64(c.questionUserDefinedObject),
    userDefinedObject: decodeMaybeBase64(c.userDefinedObject),
    apiAnswer: str(c.apiAnswer),
    englishTranslation: str(c.englishTranslation),
  };
}

/**
 * Build the EO response envelope for `payload` (the incoming request body).
 * payload.reqMessageObj is echoed back unchanged (same object).
 * @param {object} payload
 * @param {object} [options]
 * @param {string} [options.resultCode='0']
 * @param {string} [options.resultText='success']
 * @param {string} [options.fileName] Reply text (base64-encoded unless encodeFileName=false).
 * @param {string} [options.eoState]
 * @param {string} [options.mimeType='text']
 * @param {string} [options.signalId=generateSignalId()]
 * @param {boolean} [options.encodeFileName=true]
 * @param {string} [options.fromServer=EO_FROM_SERVER]
 * @returns {object} { resultCode, resultText, resMessageObj, fromServer, eoState, reqMessageObj }
 */
function buildEoResponse(
  payload,
  {
    resultCode = EO_RESULT.SUCCESS_CODE,
    resultText = EO_RESULT.SUCCESS_TEXT,
    fileName,
    eoState,
    mimeType = 'text',
    signalId = generateSignalId(),
    encodeFileName = true,
    fromServer = config.eo.fromServer,
  } = {},
) {
  const p = asObject(payload);
  const req = asObject(p.reqMessageObj);
  return {
    resultCode,
    resultText,
    resMessageObj: {
      taskId: req.taskId,
      fromId: p.botUserId,
      signalId,
      parentId: req.signalId,
      mimeType,
      databaseName: req.databaseName,
      fileName: encodeFileName ? encodeBase64(fileName) : str(fileName),
    },
    fromServer,
    eoState,
    reqMessageObj: p.reqMessageObj,
  };
}

/**
 * Build a failure envelope: same shape as buildEoResponse with failure defaults and
 * eoState 'stop'; `message` becomes the (base64) fileName.
 * @param {object} payload
 * @param {object} [options] Any buildEoResponse option plus:
 * @param {string} [options.resultCode='1']
 * @param {string} [options.resultText='failure']
 * @param {string} [options.message] Defaults to EO_RESULT.FAILURE_MESSAGE.
 * @returns {object}
 */
function buildEoError(
  payload,
  {
    resultCode = EO_RESULT.FAILURE_CODE,
    resultText = EO_RESULT.FAILURE_TEXT,
    message = EO_RESULT.FAILURE_MESSAGE,
    ...rest
  } = {},
) {
  return buildEoResponse(payload, {
    ...rest,
    resultCode,
    resultText,
    fileName: message,
    eoState: EO_STATE.STOP,
  });
}

/** Own-property check that ignores prototype keys such as '__proto__' or 'toString'. */
const own = (obj, key) =>
  obj !== null && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, key);

/**
 * Find the handler for a decoded (questionKey, answerKey) pair:
 *   registry[questionKey][answerKey] -> registry[questionKey].default -> fallback.
 * @param {string} questionKey
 * @param {string} answerKey
 * @param {Object<string, Object<string, Function>>} registry
 * @param {Function} fallback Handler used when nothing matches.
 * @returns {Function}
 */
function resolveHandler(questionKey, answerKey, registry, fallback) {
  const byQuestion = own(registry, questionKey) ? registry[questionKey] : undefined;
  if (own(byQuestion, answerKey) && typeof byQuestion[answerKey] === 'function') {
    return byQuestion[answerKey];
  }
  if (own(byQuestion, 'default') && typeof byQuestion.default === 'function') {
    return byQuestion.default;
  }
  return fallback;
}

/**
 * Compact log fields for an EO call (the only payload data logged when EO_LOG_FULL=false).
 * @param {object} payload Incoming request body.
 * @param {{questionKey: string, answerKey: string}} decoded Result of decodeContext().
 * @param {object} [response] EO response, adds resultCode / eoState / resSignalId.
 * @returns {object}
 */
function eoLogSummary(payload, decoded, response) {
  const p = asObject(payload);
  const req = asObject(p.reqMessageObj);
  const summary = {
    taskId: req.taskId,
    signalId: req.signalId,
    parentId: req.parentId,
    sessionDate: p.sessionDate,
    botUserId: p.botUserId,
    questionKey: decoded.questionKey,
    answerKey: decoded.answerKey,
  };
  if (response) {
    summary.resultCode = response.resultCode;
    summary.eoState = response.eoState;
    summary.resSignalId = response.resMessageObj && response.resMessageObj.signalId;
  }
  return summary;
}

/**
 * Run one EO step: decode the context, pick the handler from `registry`, run it and wrap
 * its result in an EO envelope. A handler that throws yields a buildEoError() envelope
 * (the error is returned for logging), so callers can always answer HTTP 200.
 * Handlers are `async (payload, decoded) => ({ fileName, eoState?, mimeType? })`.
 * @param {object} payload Incoming request body.
 * @param {object} options
 * @param {Object<string, Object<string, Function>>} options.registry Handler registry.
 * @param {Function} options.defaultHandler Fallback handler.
 * @param {object} [options.decoded] Already decoded context (decoded here when omitted).
 * @returns {Promise<{decoded: object, handler: Function, response: object, error?: Error}>}
 */
async function runEoStep(payload, { registry, defaultHandler, decoded }) {
  decoded = decoded || decodeContext(asObject(payload).context);
  const handler = resolveHandler(decoded.questionKey, decoded.answerKey, registry, defaultHandler);
  try {
    const out = (await handler(payload, decoded)) || {};
    const response = buildEoResponse(payload, {
      fileName: out.fileName,
      eoState: out.eoState || EO_STATE.STOP,
      mimeType: out.mimeType,
    });
    return { decoded, handler, response };
  } catch (error) {
    return { decoded, handler, response: buildEoError(payload), error };
  }
}

module.exports = {
  encodeBase64,
  decodeBase64,
  generateSignalId,
  decodeContext,
  buildEoResponse,
  buildEoError,
  resolveHandler,
  eoLogSummary,
  runEoStep,
};
