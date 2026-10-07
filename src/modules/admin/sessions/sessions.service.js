'use strict';

/**
 * @file Read access to a tenant's EO sessions (tenant DB collection eo_sessions) for the
 * admin UI: a paginated summary list (newest activity first) and one full session.
 */
const mongoose = require('mongoose');
const AppError = require('../../../shared/utils/AppError');
const { getTenantModels } = require('../../../shared/tenancy');
const { findOrganizationOrThrow } = require('../organizations/organizations.service');

/**
 * Summary of a session document fetched with `messages: { $slice: -1 }`.
 * @param {object} doc
 * @returns {object} Session without `messages`, plus `lastMessage`.
 */
function toSummary(doc) {
  const { messages, ...rest } = doc;
  const last = Array.isArray(messages) && messages.length > 0 ? messages[messages.length - 1] : null;
  return {
    ...rest,
    lastMessage: last
      ? { direction: last.direction, answerText: last.answerText, eoState: last.eoState, at: last.at }
      : null,
  };
}

/**
 * Paginated sessions of an organization, newest activity first.
 * @param {string} orgId
 * @param {{botUserId?: string, page: number, limit: number}} query
 * @returns {Promise<{items: object[], total: number}>}
 */
async function listOrganizationSessions(orgId, { botUserId, page, limit }) {
  const org = await findOrganizationOrThrow(orgId);
  const { EoSession } = getTenantModels(org.dbName);
  const filter = botUserId ? { botUserId } : {};
  const [docs, total] = await Promise.all([
    EoSession.find(filter)
      .select({ messages: { $slice: -1 }, __v: 0 })
      .sort({ lastMessageAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    EoSession.countDocuments(filter),
  ]);
  return { items: docs.map(toSummary), total };
}

/**
 * One full session (all messages) of an organization.
 * @param {string} orgId
 * @param {string} id Session _id.
 * @returns {Promise<object>} Session plus `org: { orgId, name }`.
 * @throws {AppError} 400 INVALID_ID, 404 ORG_NOT_FOUND / SESSION_NOT_FOUND
 */
async function getOrganizationSession(orgId, id) {
  if (!mongoose.isValidObjectId(id)) throw new AppError('Invalid session id', 400, 'INVALID_ID');
  const org = await findOrganizationOrThrow(orgId);
  const { EoSession } = getTenantModels(org.dbName);
  const session = await EoSession.findById(id).select('-__v').lean();
  if (!session) throw new AppError('Session not found', 404, 'SESSION_NOT_FOUND');
  return { ...session, org: { orgId: org.orgId, name: org.name } };
}

module.exports = { listOrganizationSessions, getOrganizationSession };
