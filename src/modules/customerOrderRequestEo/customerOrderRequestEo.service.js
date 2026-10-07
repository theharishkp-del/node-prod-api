'use strict';

/**
 * @file Business logic of customerOrderRequestEo: runs the EO step against this module's
 * handler registry. No database access (the step must answer while MongoDB is down).
 */
const { runEoStep } = require('../../shared/eo');
const handlers = require('./handlers');

/**
 * Process one customerOrderRequestEo call.
 * @param {object} payload Incoming request body (not validated; missing fields stay undefined).
 * @param {object} [decoded] Context already decoded with decodeContext() (avoids decoding twice).
 * @returns {Promise<{decoded: object, handler: Function, response: object, error?: Error}>}
 *   `error` is set when the handler threw; `response` is then a buildEoError() envelope.
 */
function processCustomerOrderRequest(payload, decoded) {
  return runEoStep(payload, { ...handlers, decoded });
}

module.exports = { processCustomerOrderRequest };
