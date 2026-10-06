'use strict';

const { Router } = require('express');
const { health, readiness } = require('../controllers/health.controller');

const router = Router();

router.get('/', health); // liveness
router.get('/live', health); // alias
router.get('/ready', readiness); // readiness

module.exports = router;
