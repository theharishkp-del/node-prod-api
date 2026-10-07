'use strict';

/** @file Routes of /api/admin/bots (auth + DB guard applied by admin.routes.js). */
const { Router } = require('express');
const asyncHandler = require('../../../shared/utils/asyncHandler');
const c = require('./bots.controller');

const router = Router();

router.get('/', asyncHandler(c.list));
router.post('/', asyncHandler(c.create));
router.get('/:botUserId', asyncHandler(c.getOne));
router.patch('/:botUserId', asyncHandler(c.update));
router.patch('/:botUserId/status', asyncHandler(c.setStatus));
router.delete('/:botUserId', asyncHandler(c.remove));

module.exports = router;
