'use strict';

const { Router } = require('express');
const asyncHandler = require('../utils/asyncHandler');
const requireDb = require('../middlewares/requireDb');
const { validateBody } = require('../middlewares/validate');
const {
  listUsers,
  getUser,
  createUser,
  createUserSchema,
} = require('../controllers/user.controller');

const router = Router();

router.use(requireDb);

router.get('/', asyncHandler(listUsers));
router.get('/:id', asyncHandler(getUser));
router.post('/', validateBody(createUserSchema), asyncHandler(createUser));

module.exports = router;
