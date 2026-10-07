'use strict';

/**
 * @file Tenant `eo_sessions` schema: one document per EO conversation, keyed by
 * (sessionDate, botUserId, taskId). Static request fields are written once (first message);
 * every EO call appends its inbound message and outbound reply to `messages`.
 */
const { Schema } = require('mongoose');
const { COLLECTIONS } = require('../constants');

const messageSchema = new Schema(
  {
    direction: { type: String, enum: ['in', 'out'], required: true },
    signalId: String,
    parentId: String,
    questionKey: String,
    answerKey: String,
    expectedAns: String,
    answerText: String, // in: decoded reqMessageObj.fileName, out: decoded reply text
    mimeType: String,
    eoState: String,
    resultCode: String,
    resultText: String,
    at: { type: Date, required: true },
  },
  { _id: false },
);

const eoSessionSchema = new Schema(
  {
    sessionDate: { type: String, required: true },
    botUserId: { type: String, required: true },
    botDatabaseName: String,
    taskId: { type: String, required: true },
    taskNo: String,
    fromId: String,
    toId: String,
    fromEmail: String,
    deviceId: String,
    env: String,
    localTimeZone: String,
    databaseName: String,
    createdDate: String, // reqMessageObj.createdDate, kept verbatim (platform local time)
    firstMessageAt: Date,
    lastMessageAt: { type: Date, index: -1 },
    messageCount: Number,
    lastEoState: String,
    messages: { type: [messageSchema], default: undefined },
  },
  { timestamps: true, collection: COLLECTIONS.EO_SESSIONS },
);

eoSessionSchema.index({ sessionDate: 1, botUserId: 1, taskId: 1 }, { unique: true });
eoSessionSchema.index({ botUserId: 1, lastMessageAt: -1 });
eoSessionSchema.index({ fromId: 1, lastMessageAt: -1 });

module.exports = eoSessionSchema;
