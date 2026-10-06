'use strict';

const { z } = require('zod');
const User = require('../models/user.model');
const AppError = require('../utils/AppError');

const createUserSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.email().max(254),
  password: z.string().min(8).max(128),
  role: z.enum(['user', 'admin']).optional(),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/** GET /api/v1/users?page=1&limit=20 */
async function listUsers(req, res) {
  const { page, limit } = listQuerySchema.parse(req.query);
  const [items, total] = await Promise.all([
    User.find()
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    User.countDocuments(),
  ]);
  res.json({
    data: items,
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}

/** GET /api/v1/users/:id */
async function getUser(req, res) {
  const user = await User.findById(req.params.id);
  if (!user) throw AppError.notFound('User not found');
  res.json({ data: user });
}

/** POST /api/v1/users */
async function createUser(req, res) {
  const user = await User.create(req.body);
  res.status(201).location(`${req.baseUrl}/${user.id}`).json({ data: user });
}

module.exports = { listUsers, getUser, createUser, createUserSchema };
