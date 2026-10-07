'use strict';

/**
 * @file Business logic of customerOrderRequestEo: runs the EO step against this module's
 * handler registry, then stores the exchange in the tenant's eo_sessions collection.
 */
const { runEoStep, recordEoExchange } = require('../../shared/eo');
const handlers = require('./handlers');

/**
 * Process one customerOrderRequestEo call.
 * @param {object} payload Incoming request body (not validated; missing fields stay undefined).
 * @param {object} decoded Context already decoded with decodeContext().
 * @param {object} tenant req.tenant from resolveTenantFromEo ({ org, bot, dbName, models }).
 * @returns {Promise<{decoded: object, handler: Function, response: object, error?: Error,
 *   sessionSaved: boolean}>} `error` is set when the handler threw; `response` is then a
 *   buildEoError() envelope. A failed session write is logged and never changes `response`.
 */
async function processCustomerOrderRequest(payload, decoded, tenant) {
  const result = await runEoStep(payload, { ...handlers, decoded, ctx: { tenant } });
  const { saved } = await recordEoExchange({
    EoSession: tenant.models.EoSession,
    payload,
    decoded: result.decoded,
    response: result.response,
  });
  return { ...result, sessionSaved: saved };
}

module.exports = { processCustomerOrderRequest };
