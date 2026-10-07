'use strict';

/**
 * @file Routes of the customerOrderRequestEo module, mounted at /api/customerOrderRequestEo
 * (the exact path configured on the bot platform).
 * Intentionally no DB guard: the EO step must answer even while MongoDB is down.
 */
const { Router } = require('express');
const asyncHandler = require('../../shared/utils/asyncHandler');
const { customerOrderRequestEo } = require('./customerOrderRequestEo.controller');

const router = Router();

router.post('/', asyncHandler(customerOrderRequestEo));

module.exports = router;
