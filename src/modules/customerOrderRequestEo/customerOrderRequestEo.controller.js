'use strict';

/**
 * @file HTTP layer of POST /api/customerOrderRequestEo (also under APP_BASE_PATH).
 *
 * Always answers HTTP 200 with the EO envelope, also when a handler throws (the body is
 * then buildEoError(): resultCode '1', eoState 'stop'), because the bot platform reads
 * resultCode/eoState rather than the HTTP status.
 *
 * Logging: EO_LOG_FULL=true logs the full request payload and response as-is (never
 * truncated); otherwise only the compact eoLogSummary() fields are logged.
 */
const config = require('../../config');
const baseLogger = require('../../config/logger');
const { decodeContext, eoLogSummary } = require('../../shared/eo');
const { processCustomerOrderRequest } = require('./customerOrderRequestEo.service');
const { LOG_MODULE } = require('./constants');

const logger = baseLogger.child({ module: LOG_MODULE });

/**
 * Express handler for the EO step.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function customerOrderRequestEo(req, res) {
  const start = process.hrtime.bigint();
  const payload = req.body && typeof req.body === 'object' ? req.body : {};
  const decoded = decodeContext(payload.context);
  const { logFull } = config.eo;

  if (logFull) {
    // The access log skips its truncated body copy for this request to avoid duplicates.
    res.locals.bodyLoggedSeparately = 'eo.request/eo.response';
    logger.info('eo.request', { event: 'eo.request', ...eoLogSummary(payload, decoded), payload });
  }

  const { handler, response, error } = await processCustomerOrderRequest(payload, decoded);

  if (error) {
    logger.error('eo.handler_error', {
      event: 'eo.handler_error',
      handler: handler.name,
      ...eoLogSummary(payload, decoded),
      err: error,
    });
  }

  const meta = {
    event: 'eo.response',
    handler: handler.name,
    durationMs: Math.round((Number(process.hrtime.bigint() - start) / 1e6) * 100) / 100,
    ...eoLogSummary(payload, decoded, response),
  };
  if (logFull) meta.response = response;
  logger.info('eo.response', meta);

  res.status(200).json(response);
}

module.exports = { customerOrderRequestEo };
