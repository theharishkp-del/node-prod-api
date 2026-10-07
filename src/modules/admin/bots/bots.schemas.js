'use strict';

/** @file Zod request schemas of the admin bots endpoints. */
const { z } = require('zod');
const { BOT_STATUS } = require('../../../shared/tenancy');
const { paginationFields } = require('../../../shared/utils/query');
const v = require('../validation');

const STATUSES = Object.values(BOT_STATUS);
const SORTS = ['name', '-name', 'botUserId', '-botUserId', 'createdAt', '-createdAt', 'updatedAt', '-updatedAt'];

/** Numbers are accepted (the platform sends ids as strings, people type numbers). */
const idString = (max, pattern, message) =>
  z.preprocess(
    (val) => (typeof val === 'number' ? String(val) : val),
    z.string().trim().min(1, 'is required').max(max).regex(pattern, message),
  );

const botUserIdField = idString(64, /^[A-Za-z0-9_.-]+$/, 'may only contain letters, digits, ".", "_" and "-"');

const editableFields = {
  name: v.requiredText(120),
  botDatabaseName: v.text(100).optional(),
  orgId: z.string().trim().toLowerCase().min(1, 'is required'),
  channel: v.text(40).optional(),
  config: v.jsonObject.optional(),
};

/** POST /bots */
const createBotSchema = z.strictObject({
  botUserId: botUserIdField,
  ...editableFields,
  status: z.enum(STATUSES).optional(),
});

/** PATCH /bots/:botUserId (botUserId immutable; status via /status). */
const updateBotSchema = v.nonEmpty(
  z.strictObject({
    ...editableFields,
    name: v.requiredText(120).optional(),
    orgId: editableFields.orgId.optional(),
  }),
);

/** PATCH /bots/:botUserId/status */
const statusSchema = z.strictObject({ status: z.enum(STATUSES) });

/** GET /bots */
const listBotsQuery = z.object({
  q: v.text(100).optional(),
  orgId: v.text(64).toLowerCase().optional(),
  status: z.enum(STATUSES).optional(),
  sort: z.enum(SORTS).default('-createdAt'),
  ...paginationFields,
});

module.exports = { createBotSchema, updateBotSchema, statusSchema, listBotsQuery, IMMUTABLE_FIELDS: ['botUserId'] };
