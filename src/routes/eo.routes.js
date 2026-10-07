'use strict';

const { Router } = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { customerOrderRequestEo } = require('../controllers/eo.controller');

/**
 * EO (bot conversation step) routes, mounted at /api (NOT /api/v1) because the bot
 * platform is configured with the exact path /api/customerOrderRequestEo.
 * Intentionally no requireDb: the EO step must answer even while MongoDB is down.
 */
const router = Router();

router.post('/customerOrderRequestEo', asyncHandler(customerOrderRequestEo));

module.exports = router;
