'use strict';

/**
 * Validates and replaces req.body with the parsed result of a zod schema.
 * Validation errors (ZodError) are turned into 400 responses by the error handler.
 *
 *   router.post('/', validateBody(createUserSchema), handler)
 */
const validateBody = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body ?? {});
  if (!result.success) return next(result.error);
  req.body = result.data;
  return next();
};

module.exports = { validateBody };
