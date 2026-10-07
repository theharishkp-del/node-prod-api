'use strict';

/**
 * @file Success envelope of the JSON (non-EO) APIs: { success: true, data, meta? }.
 * Errors keep the central error handler's shape: { error: { message, code, details? } }.
 */

/**
 * Send a success response.
 * @param {import('express').Response} res
 * @param {*} data
 * @param {object} [options]
 * @param {number} [options.status=200]
 * @param {object} [options.meta] e.g. pagination { page, limit, total, totalPages }.
 * @returns {import('express').Response}
 */
function sendSuccess(res, data, { status = 200, meta } = {}) {
  const body = { success: true, data };
  if (meta) body.meta = meta;
  return res.status(status).json(body);
}

module.exports = { sendSuccess };
