'use strict';

/**
 * @file Public entry point of the multi-tenant data layer.
 *
 *   master DB (MASTER_DB_NAME): organizations, bots
 *   tenant DB (organization.dbName = iq_t_<orgId>): eo_sessions, ...
 *
 *   const { getMasterModels, getTenantModels, resolveTenantFromEo } = require('../../shared/tenancy');
 */
const constants = require('./constants');
const models = require('./models');
const tenantContext = require('./tenantContext');
const resolveTenantFromEo = require('./resolveTenantFromEo');

module.exports = { ...constants, ...models, ...tenantContext, resolveTenantFromEo };
