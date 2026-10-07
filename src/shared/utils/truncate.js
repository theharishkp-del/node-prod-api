'use strict';

/**
 * @file Size cap for values written to the generic access log (LOG_BODY_MAX_LENGTH).
 * Values are never modified otherwise; routes that need full bodies log them separately.
 */

/**
 * Return `value` unchanged when its JSON form fits in `max` characters, otherwise a
 * truncated string preview that states the original size.
 * @param {*} value
 * @param {number} max Maximum number of characters.
 * @returns {*}
 */
function truncate(value, max) {
  if (value === undefined || value === null) return value;
  let str;
  try {
    str = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    return '[Unserializable]';
  }
  if (str === undefined || str.length <= max) return value;
  return `${str.slice(0, max)}... [truncated, ${str.length} chars total]`;
}

module.exports = { truncate };
