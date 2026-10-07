'use strict';

/**
 * @file Wrapper that forwards rejected promises from async route handlers to the error
 * middleware. Express 5 already does this; the wrapper keeps handlers explicit and portable.
 */

/**
 * @param {(req: import('express').Request, res: import('express').Response, next: Function) => Promise<*>} fn
 * @returns {import('express').RequestHandler}
 */
const asyncHandler = (fn) =>
  function asyncHandlerWrapper(req, res, next) {
    return Promise.resolve(fn(req, res, next)).catch(next);
  };

module.exports = asyncHandler;
