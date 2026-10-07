'use strict';

/** @file Handlers for the customer menu question (questionKey 'iq+customer_menu'). */
const config = require('../../../config');
const { EO_STATE } = require('../../../shared/eo');

/**
 * Order link sent to the customer.
 * TODO(placeholder): the real link must carry a key/token whose format is still pending
 * from the business side. Until then this returns EO_ORDER_BASE_URL unchanged.
 * @param {object} _payload Incoming request body.
 * @param {object} _decoded Decoded context.
 * @returns {string} '' when EO_ORDER_BASE_URL is not set.
 */
function buildOrderLink(_payload, _decoded) {
  return config.eo.orderBaseUrl;
}

/**
 * answerKey 'iq+customer_menu_ans_3' ("Book a New Order via website"): reply with the order link.
 * @param {object} payload Incoming request body.
 * @param {object} decoded Decoded context.
 * @returns {Promise<{fileName: string, eoState: string, mimeType: string}>}
 */
async function bookNewOrderViaWebsite(payload, decoded) {
  const link = buildOrderLink(payload, decoded);
  const fileName = link
    ? `Please use the link below to book a new order:\n${link}`
    : 'Online order booking link is not available yet. Please try again later.';
  return { fileName, eoState: EO_STATE.STOP, mimeType: 'text' };
}

module.exports = { bookNewOrderViaWebsite, buildOrderLink };
