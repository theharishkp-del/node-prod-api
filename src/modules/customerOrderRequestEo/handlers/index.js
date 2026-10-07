'use strict';

/**
 * @file Handler registry of customerOrderRequestEo:
 *   { [questionKey]: { [answerKey]: handler, default?: handler } }
 * Keys are the DECODED context.questionKey / context.answerKey values.
 *
 * A handler is `async (payload, decodedContext) => ({ fileName, eoState, mimeType? })`;
 * `fileName` is plain text (buildEoResponse base64-encodes it).
 * Lookup order (shared/eo resolveHandler):
 *   registry[questionKey][answerKey] -> registry[questionKey].default -> defaultHandler
 */
const { QUESTION_KEYS, ANSWER_KEYS } = require('../constants');
const defaultHandler = require('./default.handler');
const { bookNewOrderViaWebsite } = require('./customerMenu.handler');

const registry = {
  [QUESTION_KEYS.CUSTOMER_MENU]: {
    [ANSWER_KEYS.BOOK_NEW_ORDER_VIA_WEBSITE]: bookNewOrderViaWebsite,
  },
};

module.exports = { registry, defaultHandler };
