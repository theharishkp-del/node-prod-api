'use strict';

/**
 * @file Tenant resolution: botUserId -> { org, bot, dbName, models }.
 *
 * Bot + organization documents are read from the master database and cached in memory for
 * TENANT_CACHE_TTL_SECONDS (per process). Status checks run on every call, so a cached
 * record never bypasses them; the admin API calls invalidateTenantCache() after every
 * organization/bot change so updates apply immediately on this instance (other instances
 * pick them up when their TTL expires).
 */
const config = require('../../config');
const { ORG_STATUS, BOT_STATUS } = require('./constants');
const { getMasterModels, getTenantModels } = require('./models');
const { createTtlCache } = require('./ttlCache');

/** Machine-readable reasons why an EO call has no usable tenant. */
const TENANT_ERROR = Object.freeze({
  MISSING_BOT_USER_ID: 'MISSING_BOT_USER_ID',
  BOT_NOT_FOUND: 'BOT_NOT_FOUND',
  BOT_INACTIVE: 'BOT_INACTIVE',
  ORG_NOT_FOUND: 'ORG_NOT_FOUND',
  ORG_SUSPENDED: 'ORG_SUSPENDED',
});

/** User-facing (bot reply) text per reason. */
const TENANT_ERROR_MESSAGES = Object.freeze({
  [TENANT_ERROR.MISSING_BOT_USER_ID]: 'This bot is not configured: the request has no botUserId.',
  [TENANT_ERROR.BOT_NOT_FOUND]: 'This bot is not configured yet. Please contact the administrator.',
  [TENANT_ERROR.BOT_INACTIVE]: 'This bot is currently inactive. Please contact the administrator.',
  [TENANT_ERROR.ORG_NOT_FOUND]:
    'This bot is not linked to an organization. Please contact the administrator.',
  [TENANT_ERROR.ORG_SUSPENDED]:
    'This service is currently suspended for your organization. Please contact the administrator.',
});

/** Expected "no usable tenant" outcome (not a server fault). */
class TenantResolutionError extends Error {
  /**
   * @param {string} code One of TENANT_ERROR.
   * @param {object} [meta] Extra log fields (botUserId, orgId).
   */
  constructor(code, meta = {}) {
    super(TENANT_ERROR_MESSAGES[code] || 'Tenant could not be resolved');
    this.name = 'TenantResolutionError';
    this.code = code;
    this.meta = meta;
  }
}

/** botUserId -> { bot, org } (lean documents). */
const cache = createTtlCache({ ttlMs: config.tenancy.cacheTtlMs });

/**
 * Read a bot and its organization from the master database.
 * @param {string} botUserId
 * @returns {Promise<{bot: object, org: object|null}|null>} null when the bot does not exist.
 */
async function loadTenantRecord(botUserId) {
  const { Bot, Organization } = getMasterModels();
  const bot = await Bot.findOne({ botUserId }).lean();
  if (!bot) return null;
  const org = await Organization.findOne({ orgId: bot.orgId }).lean();
  return { bot, org };
}

/**
 * Resolve the tenant of an EO call.
 * @param {string|number} botUserId payload.botUserId
 * @returns {Promise<{org: object, bot: object, dbName: string, models: object, fromCache: boolean}>}
 * @throws {TenantResolutionError} Missing/unknown/inactive bot, missing/suspended organization.
 * @throws {Error} Database errors (e.g. MongoDB unavailable and nothing cached).
 */
async function getTenantContextByBotUserId(botUserId) {
  const id = botUserId === undefined || botUserId === null ? '' : String(botUserId).trim();
  if (!id) throw new TenantResolutionError(TENANT_ERROR.MISSING_BOT_USER_ID);

  let record = cache.get(id);
  const fromCache = Boolean(record);
  if (!record) {
    record = await loadTenantRecord(id);
    // Only complete records are cached: a new bot/org must work without waiting for a TTL.
    if (record && record.org) cache.set(id, record);
  }

  if (!record) throw new TenantResolutionError(TENANT_ERROR.BOT_NOT_FOUND, { botUserId: id });
  const { bot, org } = record;
  if (!org) {
    throw new TenantResolutionError(TENANT_ERROR.ORG_NOT_FOUND, { botUserId: id, orgId: bot.orgId });
  }
  if (bot.status !== BOT_STATUS.ACTIVE) {
    throw new TenantResolutionError(TENANT_ERROR.BOT_INACTIVE, { botUserId: id, orgId: org.orgId });
  }
  if (org.status !== ORG_STATUS.ACTIVE) {
    throw new TenantResolutionError(TENANT_ERROR.ORG_SUSPENDED, { botUserId: id, orgId: org.orgId });
  }

  return { org, bot, dbName: org.dbName, models: getTenantModels(org.dbName), fromCache };
}

/**
 * Drop cached tenant records. Call after any organization or bot change.
 * @param {object} [target] Without botUserId/orgId the whole cache is cleared.
 * @param {string} [target.botUserId] Drop this bot's record.
 * @param {string} [target.orgId] Drop every record of this organization's bots.
 * @returns {number} Number of entries removed (-1 when the whole cache was cleared).
 */
function invalidateTenantCache({ botUserId, orgId } = {}) {
  if (!botUserId && !orgId) {
    cache.clear();
    return -1;
  }
  let removed = 0;
  if (botUserId && cache.delete(String(botUserId))) removed += 1;
  if (orgId) {
    removed += cache.deleteWhere((rec) => rec.bot.orgId === orgId || (rec.org && rec.org.orgId === orgId));
  }
  return removed;
}

module.exports = {
  getTenantContextByBotUserId,
  invalidateTenantCache,
  TenantResolutionError,
  TENANT_ERROR,
  TENANT_ERROR_MESSAGES,
};
