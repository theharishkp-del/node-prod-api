'use strict';

const { Router } = require('express');
const userRoutes = require('./user.routes');

/** Versioned API router mounted at /api/v1 */
const router = Router();

router.get('/', (req, res) => res.json({ message: 'API v1', requestId: req.id }));
router.use('/users', userRoutes);

module.exports = router;
