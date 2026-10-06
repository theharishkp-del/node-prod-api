'use strict';

/**
 * Helpers that make request/response data safe to log:
 *  - redact(): deep-copies a value replacing sensitive fields with "[REDACTED]".
 *  - truncate(): caps the serialized size of a value.
 *  - sanitizeUrl(): redacts sensitive query-string parameters.
 *
 * A key is considered sensitive when its normalised name (lower-case, no "-" / "_")
 * CONTAINS one of the patterns, so "newPassword", "access_token", "x-api-key",
 * "client_secret" and "Set-Cookie" are all caught.
 */
const config = require('../config');

const REDACTED = '[REDACTED]';

const DEFAULT_SENSITIVE = [
  'password',
  'passwd',
  'pwd',
  'token',
  'authorization',
  'cookie',
  'secret',
  'apikey',
  'privatekey',
  'creditcard',
  'cardnumber',
  'cvv',
];

const normalise = (key) => String(key).toLowerCase().replace(/[^a-z0-9]/g, '');

const SENSITIVE = [...new Set([...DEFAULT_SENSITIVE, ...config.log.redactFields.map(normalise)])];

const MAX_DEPTH = 8;
const MAX_ARRAY_ITEMS = 50;

function isSensitiveKey(key) {
  const k = normalise(key);
  return SENSITIVE.some((s) => k.includes(s));
}

function redact(value, depth = 0, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object') return value;
  if (Buffer.isBuffer(value)) return `[Buffer ${value.length} bytes]`;
  if (value instanceof Date) return value.toISOString();
  if (seen.has(value)) return '[Circular]';
  if (depth >= MAX_DEPTH) return '[MaxDepth]';
  seen.add(value);

  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY_ITEMS).map((v) => redact(v, depth + 1, seen));
    if (value.length > MAX_ARRAY_ITEMS) items.push(`[+${value.length - MAX_ARRAY_ITEMS} more]`);
    return items;
  }

  const source = typeof value.toJSON === 'function' ? value.toJSON() : value;
  if (source === null || typeof source !== 'object') return source;

  const out = {};
  for (const [key, val] of Object.entries(source)) {
    out[key] = isSensitiveKey(key) ? REDACTED : redact(val, depth + 1, seen);
  }
  return out;
}

/**
 * Keeps logs small: returns the value unchanged when its JSON form fits in `max`
 * characters, otherwise a truncated string preview with the original size.
 */
function truncate(value, max = config.log.bodyMaxLength) {
  if (value === undefined || value === null) return value;
  let str;
  try {
    str = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    return '[Unserializable]';
  }
  if (str === undefined) return undefined;
  if (str.length <= max) return value;
  return `${str.slice(0, max)}... [truncated, ${str.length} chars total]`;
}

/** Redact + truncate in one go. */
function safeBody(value, max) {
  return truncate(redact(value), max);
}

/** Redacts sensitive query parameters: /a?token=abc&x=1 -> /a?token=[REDACTED]&x=1 */
function sanitizeUrl(url) {
  const qIndex = url.indexOf('?');
  if (qIndex === -1) return url;
  const params = new URLSearchParams(url.slice(qIndex + 1));
  let changed = false;
  for (const key of [...params.keys()]) {
    if (isSensitiveKey(key)) {
      params.set(key, REDACTED);
      changed = true;
    }
  }
  if (!changed) return url;
  return `${url.slice(0, qIndex)}?${params.toString().replace(/%5BREDACTED%5D/g, REDACTED)}`;
}

module.exports = { redact, truncate, safeBody, sanitizeUrl, isSensitiveKey, REDACTED };
