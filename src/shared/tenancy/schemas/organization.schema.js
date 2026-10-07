'use strict';

/**
 * @file Master `organizations` schema: one document per tenant (customer business).
 * `orgId` and `dbName` are immutable once created; `dbName` is the tenant database.
 */
const { Schema } = require('mongoose');
const { ORG_STATUS, COLLECTIONS, ORG_ID_PATTERN } = require('../constants');

const addressSchema = new Schema(
  {
    line1: { type: String, trim: true, maxlength: 200 },
    line2: { type: String, trim: true, maxlength: 200 },
    city: { type: String, trim: true, maxlength: 100 },
    state: { type: String, trim: true, maxlength: 100 },
    country: { type: String, trim: true, maxlength: 100 },
    postalCode: { type: String, trim: true, maxlength: 20 },
  },
  { _id: false },
);

const organizationSchema = new Schema(
  {
    orgId: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      immutable: true,
      match: ORG_ID_PATTERN,
    },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    legalName: { type: String, trim: true, maxlength: 200 },
    email: { type: String, trim: true, lowercase: true, maxlength: 254 },
    phone: { type: String, trim: true, maxlength: 40 },
    address: { type: addressSchema, default: () => ({}) },
    currencyCode: { type: String, uppercase: true, trim: true, match: /^[A-Z]{3}$/, default: 'USD' },
    timezone: { type: String, trim: true, default: 'Asia/Calcutta' },
    logoUrl: { type: String, trim: true, maxlength: 2048 },
    dbName: { type: String, required: true, unique: true, immutable: true },
    status: {
      type: String,
      enum: Object.values(ORG_STATUS),
      default: ORG_STATUS.ACTIVE,
      index: true,
    },
    settings: { type: Schema.Types.Mixed, default: () => ({}) },
  },
  { timestamps: true, collection: COLLECTIONS.ORGANIZATIONS, minimize: false },
);

organizationSchema.index({ name: 1 });
organizationSchema.index({ createdAt: -1 });

module.exports = organizationSchema;
