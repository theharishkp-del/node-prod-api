'use strict';

/**
 * @file Public entry point of the shared EO toolkit: protocol constants, helpers and the
 * session persistence service.
 *   const { buildEoResponse, EO_STATE, recordEoExchange } = require('../../shared/eo');
 */
const { EO_RESULT, EO_STATE } = require('./constants');
const helpers = require('./helpers');
const { recordEoExchange } = require('./session.service');

module.exports = { EO_RESULT, EO_STATE, ...helpers, recordEoExchange };
