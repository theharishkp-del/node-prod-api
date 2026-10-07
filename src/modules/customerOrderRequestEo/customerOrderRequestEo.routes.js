'use strict';

/**
 * @file Routes of the customerOrderRequestEo module, mounted at /api/customerOrderRequestEo
 * (the exact path configured on the bot platform).
 *
 * resolveTenantFromEo runs first: an unknown/inactive bot or a suspended organization is
 * answered with an EO failure envelope (HTTP 200) and never reaches the controller.
 */
const { Router } = require('express');
const asyncHandler = require('../../shared/utils/asyncHandler');
const { resolveTenantFromEo } = require('../../shared/tenancy');
const { customerOrderRequestEo } = require('./customerOrderRequestEo.controller');

const router = Router();

router.post('/', asyncHandler(resolveTenantFromEo), asyncHandler(customerOrderRequestEo));

module.exports = router;
