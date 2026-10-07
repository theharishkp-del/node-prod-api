'use strict';

/**
 * @file Constants of the multi-tenant data layer: statuses, model/collection names and the
 * tenant database naming rule.
 */

/** Organization lifecycle. A suspended organization's bots get an EO failure reply. */
const ORG_STATUS = Object.freeze({ ACTIVE: 'active', SUSPENDED: 'suspended' });

/** Bot lifecycle. An inactive bot gets an EO failure reply. */
const BOT_STATUS = Object.freeze({ ACTIVE: 'active', INACTIVE: 'inactive' });

/** Mongoose model names (registered once per database). */
const MODEL_NAMES = Object.freeze({
  ORGANIZATION: 'Organization',
  BOT: 'Bot',
  EO_SESSION: 'EoSession',
});

/** MongoDB collection names. */
const COLLECTIONS = Object.freeze({
  ORGANIZATIONS: 'organizations',
  BOTS: 'bots',
  EO_SESSIONS: 'eo_sessions',
});

/** Every tenant database is named `${TENANT_DB_PREFIX}${orgId}` (sanitised). */
const TENANT_DB_PREFIX = 'iq_t_';

/** orgId: lowercase slug, 2-32 chars, starts/ends with a letter or digit. */
const ORG_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])$/;

module.exports = { ORG_STATUS, BOT_STATUS, MODEL_NAMES, COLLECTIONS, TENANT_DB_PREFIX, ORG_ID_PATTERN };
