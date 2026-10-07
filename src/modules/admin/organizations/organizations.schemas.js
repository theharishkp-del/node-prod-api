'use strict';

/** @file Zod request schemas of the admin organizations endpoints. */
const { z } = require('zod');
const { ORG_STATUS, ORG_ID_PATTERN } = require('../../../shared/tenancy');
const { paginationFields } = require('../../../shared/utils/query');
const v = require('../validation');

const STATUSES = Object.values(ORG_STATUS);
const SORTS = ['name', '-name', 'orgId', '-orgId', 'createdAt', '-createdAt', 'updatedAt', '-updatedAt'];

const orgIdField = z
  .string()
  .trim()
  .toLowerCase()
  .regex(ORG_ID_PATTERN, 'must be 2-32 characters: lowercase letters, digits and "-" (not at the ends)');

const addressSchema = z.strictObject({
  line1: v.text(200).optional(),
  line2: v.text(200).optional(),
  city: v.text(100).optional(),
  state: v.text(100).optional(),
  country: v.text(100).optional(),
  postalCode: v.text(20).optional(),
});

const editableFields = {
  name: v.requiredText(120),
  legalName: v.text(200).optional(),
  email: v.emailField.optional(),
  phone: v.text(40).optional(),
  address: addressSchema.optional(),
  currencyCode: v.currencyField.optional(),
  timezone: v.timeZoneField.optional(),
  logoUrl: v.urlField.optional(),
  settings: v.jsonObject.optional(),
};

/** POST /organizations (orgId optional: generated from the name). */
const createOrganizationSchema = z.strictObject({
  orgId: orgIdField.optional(),
  ...editableFields,
  status: z.enum(STATUSES).optional(),
});

/** PATCH /organizations/:orgId (orgId, dbName immutable; status via /status). */
const updateOrganizationSchema = v.nonEmpty(
  z.strictObject({ ...editableFields, name: v.requiredText(120).optional() }),
);

/** PATCH /organizations/:orgId/status */
const statusSchema = z.strictObject({ status: z.enum(STATUSES) });

/** GET /organizations */
const listOrganizationsQuery = z.object({
  q: v.text(100).optional(),
  status: z.enum(STATUSES).optional(),
  sort: z.enum(SORTS).default('-createdAt'),
  ...paginationFields,
});

/** GET /organizations/:orgId/sessions */
const listSessionsQuery = z.object({
  botUserId: v.text(64).optional(),
  ...paginationFields,
});

module.exports = {
  createOrganizationSchema,
  updateOrganizationSchema,
  statusSchema,
  listOrganizationsQuery,
  listSessionsQuery,
  IMMUTABLE_FIELDS: ['orgId', 'dbName'],
};
