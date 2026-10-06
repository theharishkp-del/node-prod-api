'use strict';

/**
 * Wraps an async route handler so rejected promises reach the error middleware.
 * (Express 5 already does this, but the wrapper keeps handlers portable and explicit.)
 */
const asyncHandler = (fn) =>
  function asyncHandlerWrapper(req, res, next) {
    return Promise.resolve(fn(req, res, next)).catch(next);
  };

module.exports = asyncHandler;
