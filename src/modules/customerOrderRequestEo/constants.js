'use strict';

/**
 * @file Constants of the customerOrderRequestEo module: the decoded context keys it
 * handles and its logger name.
 */

/** Decoded context.questionKey values. */
const QUESTION_KEYS = Object.freeze({
  CUSTOMER_MENU: 'iq+customer_menu',
});

/** Decoded context.answerKey values. */
const ANSWER_KEYS = Object.freeze({
  BOOK_NEW_ORDER_VIA_WEBSITE: 'iq+customer_menu_ans_3', // "Book a New Order via website"
});

/** `module` field of this API's log entries. */
const LOG_MODULE = 'eo';

module.exports = { QUESTION_KEYS, ANSWER_KEYS, LOG_MODULE };
