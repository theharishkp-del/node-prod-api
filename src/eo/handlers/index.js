'use strict';

/**
 * EO handler registry: { [questionKey]: { [answerKey]: handler, default?: handler } }
 * Keys are the DECODED context.questionKey / context.answerKey values.
 *
 * A handler is `async (payload, decodedContext) => ({ fileName, eoState, mimeType? })`.
 * `fileName` is plain text (it is base64-encoded by buildEoResponse).
 *
 * Lookup order (src/utils/eo.js resolveHandler):
 *   registry[questionKey][answerKey] -> registry[questionKey].default -> defaultHandler
 */
const defaultHandler = require('./default.handler');
const { bookNewOrderViaWebsite } = require('./customerMenu.handler');

const registry = {
  'iq+customer_menu': {
    'iq+customer_menu_ans_3': bookNewOrderViaWebsite,
  },
};

module.exports = { registry, defaultHandler };
