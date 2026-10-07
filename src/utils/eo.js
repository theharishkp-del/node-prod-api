'use strict';

/**
 * Reusable helpers for the EO (bot conversation step) protocol.
 *
 * Request  : { botUserId, botDatabaseName, fromServer, reqMessageObj, sessionDate, context }
 * Response : { resultCode, resultText, resMessageObj, fromServer, eoState, reqMessageObj }
 *
 * Nothing here touches the database; handlers are looked up in src/eo/handlers/index.js.
 */
const config = require('../config');
const handlers = require('../eo/handlers');
const { EO_RESULT, EO_STATE } = require('../eo/constants');


const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

/** utf8 text -> base64. null/undefined -> ''. Non-strings are stringified. */
function encodeBase64(text) {
  if (text === undefined || text === null) return '';
  return Buffer.from(String(text), 'utf8').toString('base64');
}

/**
 * base64 -> utf8 text. Never throws: returns '' for null/empty/non-string input,
 * malformed base64 (bad characters or length) or bytes that are not valid UTF-8.
 * Whitespace/newlines inside the value are ignored.
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

// ---- signal ids ------------------------------------------------------------------
let lastMs = 0;
let seq = 0;

/**
 * Unique 17-digit numeric string: 13-digit epoch ms + 4-digit sequence.
 * The sequence starts at a random value in each new ms (0-4999) and increments for
 * further ids in the same ms; if it overflows 9999 the timestamp part is advanced by
 * one ms. Ids are therefore strictly increasing and unique within this process.
 * Across processes (PM2 cluster) collisions are unlikely but possible (TODO if ids
 * must be globally unique: add an instance digit or use a DB sequence).
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

// ---- context ---------------------------------------------------------------------
const str = (v) => (v === undefined || v === null ? '' : String(v));

/** Decode a field that may be base64 or plain/empty: keep the raw value if it is not valid base64. */
function decodeMaybeBase64(value) {
  const raw = str(value);
  if (!raw) return '';
  const decoded = decodeBase64(raw);
  return decoded || raw;
}

/**
 * Decodes payload.context.
 * questionKey / answerKey / expectedAns are base64; the userDefined fields may be base64
 * or empty (non-base64 values are returned unchanged); apiAnswer / englishTranslation are plain.
 */
function decodeContext(context) {
  const c = context && typeof context === 'object' ? context : {};
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

// ---- response builders -----------------------------------------------------------
/**
 * Builds the EO response for `payload` (the incoming request body).
 * req = payload.reqMessageObj; reqMessageObj is echoed back unchanged.
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
  const p = payload && typeof payload === 'object' ? payload : {};
  const req = p.reqMessageObj && typeof p.reqMessageObj === 'object' ? p.reqMessageObj : {};
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

/** Same shape as buildEoResponse with failure defaults and eoState 'stop'; `message` becomes fileName. */
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

// ---- handler lookup --------------------------------------------------------------
const own = (obj, key) =>
  obj !== null && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, key);

/**
 * Returns the handler for (questionKey, answerKey):
 *   registry[questionKey][answerKey] -> registry[questionKey].default -> global default.
 */
function resolveHandler(
  questionKey,
  answerKey,
  registry = handlers.registry,
  fallback = handlers.defaultHandler,
) {
  const byQuestion = own(registry, questionKey) ? registry[questionKey] : undefined;
  if (own(byQuestion, answerKey) && typeof byQuestion[answerKey] === 'function') {
    return byQuestion[answerKey];
  }
  if (own(byQuestion, 'default') && typeof byQuestion.default === 'function') {
    return byQuestion.default;
  }
  return fallback;
}

module.exports = {
  EO_RESULT,
  EO_STATE,
  encodeBase64,
  decodeBase64,
  generateSignalId,
  decodeContext,
  buildEoResponse,
  buildEoError,
  resolveHandler,
};
