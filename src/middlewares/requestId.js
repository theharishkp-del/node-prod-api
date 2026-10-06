'use strict';

const { randomUUID } = require('crypto');

// Accept a caller-supplied id only if it looks sane (prevents log injection / huge values).
const VALID_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * Assigns req.id from the incoming X-Request-Id header (if valid) or a new UUID v4,
 * and echoes it back in the X-Request-Id response header.
 */
function requestId(req, res, next) {
  const incoming = req.get('x-request-id');
  req.id = incoming && VALID_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
}

module.exports = requestId;
