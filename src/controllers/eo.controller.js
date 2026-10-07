'use strict';

/**
 * POST /api/customerOrderRequestEo  (also under APP_BASE_PATH, e.g. /iqagent/api/...)
 *
 * No request validation (by request): missing fields simply come back undefined.
 * Always answers HTTP 200 with the EO envelope - also when a handler throws, in which
 * case the body is buildEoError(...) (resultCode '1', eoState 'stop'), because the bot
 * platform reads resultCode/eoState rather than the HTTP status. Only a failure outside
 * the handler (practically impossible) reaches the central error handler as a 500.
 */
const config = require('../config');
const baseLogger = require('../config/logger');
const { redact } = require('../utils/sanitize');
const { EO_STATE } = require('../eo/constants');
const {
  decodeContext,
  resolveHandler,
  buildEoResponse,
  buildEoError,
} = require('../utils/eo');

const logger = baseLogger.child({ module: 'eo' });

/** Compact fields logged for every EO call (the only ones when EO_LOG_FULL=false). */
function eoLogSummary(payload, decoded, response) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const req = p.reqMessageObj && typeof p.reqMessageObj === 'object' ? p.reqMessageObj : {};
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

async function customerOrderRequestEo(req, res) {
  const start = process.hrtime.bigint();
  const payload = req.body && typeof req.body === 'object' ? req.body : {};
  const decoded = decodeContext(payload.context);
  const logFull = config.eo.logFull;

  if (logFull) {
    // Full payload: redacted for secret-looking keys only, never truncated. The generic
    // access log skips its (truncated) bodies for this request to avoid duplicates.
    res.locals.bodyLoggedSeparately = 'eo.request/eo.response';
    logger.info('eo.request', {
      event: 'eo.request',
      requestId: req.id,
      ...eoLogSummary(payload, decoded),
      payload: redact(payload),
    });
  }

  const handler = resolveHandler(decoded.questionKey, decoded.answerKey);
  let response;
  try {
    const out = (await handler(payload, decoded)) || {};
    response = buildEoResponse(payload, {
      fileName: out.fileName,
      eoState: out.eoState || EO_STATE.STOP,
      mimeType: out.mimeType,
    });
  } catch (err) {
    logger.error('eo.handler_error', {
      event: 'eo.handler_error',
      requestId: req.id,
      handler: handler.name,
      ...eoLogSummary(payload, decoded),
      err,
    });
    response = buildEoError(payload);
  }

  const meta = {
    event: 'eo.response',
    requestId: req.id,
    handler: handler.name,
    durationMs: Math.round((Number(process.hrtime.bigint() - start) / 1e6) * 100) / 100,
    ...eoLogSummary(payload, decoded, response),
  };
  if (logFull) meta.response = redact(response);
  logger.info('eo.response', meta);

  res.status(200).json(response);
}

module.exports = { customerOrderRequestEo, eoLogSummary };
