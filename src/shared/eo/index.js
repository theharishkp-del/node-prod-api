'use strict';

/**
 * @file Public entry point of the shared EO toolkit: protocol constants plus helpers.
 *   const { buildEoResponse, EO_STATE } = require('../../shared/eo');
 */
const { EO_RESULT, EO_STATE } = require('./constants');
const helpers = require('./helpers');

module.exports = { EO_RESULT, EO_STATE, ...helpers };
