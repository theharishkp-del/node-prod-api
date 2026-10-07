'use strict';

/**
 * @file Zod building blocks shared by the admin API schemas (trimmed strings, email,
 * URL, time zone, rejection of immutable fields).
 */
const { z } = require('zod');
const AppError = require('../../shared/utils/AppError');

/**
 * Trimmed string with a max length ('' allowed, used to clear optional fields).
 * @param {number} max
 * @returns {import('zod').ZodString}
 */
const text = (max) => z.string().trim().max(max, `must be at most ${max} characters`);

/**
 * Required trimmed string.
 * @param {number} max
 * @returns {import('zod').ZodString}
 */
const requiredText = (max) => text(max).min(1, 'is required');

/** '' or a valid e-mail address (lower-cased). */
const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .refine((v) => v === '' || z.email().safeParse(v).success, 'must be a valid email address');

/** '' or an absolute http(s) URL. */
const urlField = z
  .string()
  .trim()
  .max(2048)
  .refine(
    (v) => v === '' || z.url({ protocol: /^https?$/ }).safeParse(v).success,
    'must be an absolute http(s) URL',
  );

/**
 * True when Intl accepts the IANA time zone name (aliases like Asia/Calcutta included).
 * @param {string} tz
 * @returns {boolean}
 */
function isValidTimeZone(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** IANA time zone, e.g. Asia/Calcutta. */
const timeZoneField = z.string().trim().refine(isValidTimeZone, 'must be an IANA time zone, e.g. Asia/Calcutta');

/** ISO 4217 currency code, upper-cased. */
const currencyField = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'must be a 3-letter currency code, e.g. USD');

/** Free-form JSON object (settings / config). */
const jsonObject = z.record(z.string(), z.unknown());

/**
 * Throw 400 IMMUTABLE_FIELD when the body tries to change one of `fields`.
 * @param {object} body Request body.
 * @param {string[]} fields
 * @throws {AppError}
 */
function rejectImmutable(body, fields) {
  const present = fields.filter((f) => body && typeof body === 'object' && f in body);
  if (present.length > 0) {
    throw new AppError(
      `${present.join(', ')} cannot be changed after creation`,
      400,
      'IMMUTABLE_FIELD',
      present.map((p) => ({ path: p, message: 'is immutable' })),
    );
  }
}

/**
 * Require at least one key in a partial update.
 * @param {import('zod').ZodObject} schema
 * @returns {import('zod').ZodType}
 */
const nonEmpty = (schema) =>
  schema.refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

module.exports = {
  text,
  requiredText,
  emailField,
  urlField,
  timeZoneField,
  currencyField,
  jsonObject,
  isValidTimeZone,
  rejectImmutable,
  nonEmpty,
};
