'use strict';

/**
 * @file Master `bots` schema: a bot on the bot platform, owned by one organization
 * (one organization has many bots). EO calls are routed to a tenant via `botUserId`.
 */
const { Schema } = require('mongoose');
const { BOT_STATUS, COLLECTIONS } = require('../constants');

const botSchema = new Schema(
  {
    botUserId: { type: String, required: true, unique: true, trim: true, immutable: true },
    botDatabaseName: { type: String, trim: true, maxlength: 100 },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    orgId: { type: String, required: true, lowercase: true, trim: true, index: true },
    channel: { type: String, trim: true, default: 'cybot', maxlength: 40 },
    status: {
      type: String,
      enum: Object.values(BOT_STATUS),
      default: BOT_STATUS.ACTIVE,
      index: true,
    },
    config: { type: Schema.Types.Mixed, default: () => ({}) },
  },
  { timestamps: true, collection: COLLECTIONS.BOTS, minimize: false },
);

botSchema.index({ orgId: 1, status: 1 });

module.exports = botSchema;
