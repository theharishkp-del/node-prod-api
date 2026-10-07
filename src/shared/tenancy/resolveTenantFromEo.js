'use strict';

/**
 * @file Express middleware for EO routes: resolves the tenant from payload.botUserId and
 * attaches it as `req.tenant` ({ org, bot, dbName, models }).
 *
 * The bot platform reads the EO envelope, not the HTTP status, so a request without a
 * usable tenant (missing/unknown/inactive bot, suspended organization, database down)
 * is answered with HTTP 200 + buildEoError() (resultText 'failure', eoState 'stop') whose
 * text explains the problem; the route handler is not called.
 */
const config = require('../../config');
const baseLogger = require('../../config/logger');
const { buildEoError, decodeContext, eoLogSummary } = require('../eo');
const { getTenantContextByBotUserId, TenantResolutionError } = require('./tenantContext');

const logger = baseLogger.child({ module: 'eo' });

/** Reply text when the tenant lookup itself fails (e.g. MongoDB unavailable). */
const LOOKUP_FAILED_MESSAGE =
  'Sorry, the service is temporarily unavailable. Please try again later.';

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {Promise<void>}
 */
async function resolveTenantFromEo(req, res, next) {
  const payload = req.body && typeof req.body === 'object' ? req.body : {};
  try {
    req.tenant = await getTenantContextByBotUserId(payload.botUserId);
    return next();
  } catch (err) {
    const known = err instanceof TenantResolutionError;
    const meta = {
      event: known ? 'eo.tenant_rejected' : 'eo.tenant_lookup_failed',
      reason: known ? err.code : 'LOOKUP_FAILED',
      ...eoLogSummary(payload, decodeContext(payload.context)),
    };
    if (config.eo.logFull) {
      res.locals.bodyLoggedSeparately = meta.event;
      meta.payload = payload;
    }
    if (known) logger.warn(meta.event, { ...meta, ...err.meta });
    else logger.error(meta.event, { ...meta, err });

    const response = buildEoError(payload, { message: known ? err.message : LOOKUP_FAILED_MESSAGE });
    return res.status(200).json(response);
  }
}

module.exports = resolveTenantFromEo;
module.exports.LOOKUP_FAILED_MESSAGE = LOOKUP_FAILED_MESSAGE;
