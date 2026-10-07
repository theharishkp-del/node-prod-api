'use strict';

const config = require('../../config');
const { EO_STATE } = require('../constants');

/**
 * TODO(placeholder): the real order link must carry a key/token whose format is still
 * pending from the business side. Until then this returns EO_ORDER_BASE_URL as-is.
 * Replace the body of this function once the token format is confirmed.
 */
function buildOrderLink(_payload, _decoded) {
  return config.eo.orderBaseUrl;
}

/** questionKey 'iq+customer_menu', answerKey 'iq+customer_menu_ans_3' ("Book a New Order via website"). */
async function bookNewOrderViaWebsite(payload, decoded) {
  const link = buildOrderLink(payload, decoded);
  const fileName = link
    ? `Please use the link below to book a new order:\n${link}`
    : // TODO(placeholder): EO_ORDER_BASE_URL not set.
      'Online order booking link is not available yet. Please try again later.';
  return { fileName, eoState: EO_STATE.STOP, mimeType: 'text' };
}

module.exports = { bookNewOrderViaWebsite, buildOrderLink };
