'use strict';

/** @file Routes of the health module, mounted at /health. */
const { Router } = require('express');
const { health, readiness } = require('./health.controller');

const router = Router();

router.get('/', health); // liveness
router.get('/live', health); // liveness alias
router.get('/ready', readiness);

module.exports = router;
