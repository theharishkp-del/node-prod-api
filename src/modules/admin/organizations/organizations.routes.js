'use strict';

/** @file Routes of /api/admin/organizations (auth + DB guard applied by admin.routes.js). */
const { Router } = require('express');
const asyncHandler = require('../../../shared/utils/asyncHandler');
const c = require('./organizations.controller');

const router = Router();

router.get('/', asyncHandler(c.list));
router.post('/', asyncHandler(c.create));
router.get('/:orgId', asyncHandler(c.getOne));
router.patch('/:orgId', asyncHandler(c.update));
router.patch('/:orgId/status', asyncHandler(c.setStatus));
router.delete('/:orgId', asyncHandler(c.remove));
router.get('/:orgId/sessions', asyncHandler(c.listSessions));
router.get('/:orgId/sessions/:id', asyncHandler(c.getSession));

module.exports = router;
