'use strict';

/**
 * @file Database handles and model registration for the master + tenant databases.
 *
 * Everything shares ONE mongoose connection (MONGODB_URI). Databases are selected with
 * `mongoose.connection.useDb(name, { useCache: true })`, so no extra sockets are opened.
 * Schemas are defined once (./schemas) and registered on each database the first time it
 * is used; the resulting model sets are cached by database name.
 *
 *   const { Organization, Bot } = getMasterModels();
 *   const { EoSession } = getTenantModels(org.dbName);
 */
const mongoose = require('mongoose');
const config = require('../../config');
const { MODEL_NAMES, TENANT_DB_PREFIX } = require('./constants');
const organizationSchema = require('./schemas/organization.schema');
const botSchema = require('./schemas/bot.schema');
const eoSessionSchema = require('./schemas/eoSession.schema');

/** Schemas registered on the master database. */
const MASTER_SCHEMAS = Object.freeze({
  [MODEL_NAMES.ORGANIZATION]: organizationSchema,
  [MODEL_NAMES.BOT]: botSchema,
});

/** Schemas registered on every tenant database. */
const TENANT_SCHEMAS = Object.freeze({
  [MODEL_NAMES.EO_SESSION]: eoSessionSchema,
});

/** dbName -> frozen { [modelName]: Model } */
const modelCache = new Map();

/**
 * Database handle on the shared connection (cached by mongoose).
 * @param {string} dbName
 * @returns {import('mongoose').Connection}
 */
function getDb(dbName) {
  return mongoose.connection.useDb(dbName, { useCache: true });
}

/**
 * Register `schemas` on database `dbName` once and return the model set.
 * @param {string} dbName
 * @param {Object<string, import('mongoose').Schema>} schemas
 * @returns {Object<string, import('mongoose').Model>}
 */
function registerModels(dbName, schemas) {
  const cached = modelCache.get(dbName);
  if (cached) return cached;
  const db = getDb(dbName);
  const models = {};
  for (const [name, schema] of Object.entries(schemas)) {
    models[name] = db.models[name] || db.model(name, schema);
  }
  const frozen = Object.freeze(models);
  modelCache.set(dbName, frozen);
  return frozen;
}

/**
 * Models of the master (registry) database MASTER_DB_NAME.
 * @returns {{Organization: import('mongoose').Model, Bot: import('mongoose').Model}}
 */
function getMasterModels() {
  return registerModels(config.tenancy.masterDbName, MASTER_SCHEMAS);
}

/**
 * Models of one tenant database.
 * @param {string} dbName Tenant database name (organization.dbName).
 * @returns {{EoSession: import('mongoose').Model}}
 * @throws {Error} When dbName is empty or is the master database.
 */
function getTenantModels(dbName) {
  if (!dbName || typeof dbName !== 'string') throw new Error('Tenant dbName is required');
  if (dbName === config.tenancy.masterDbName) {
    throw new Error('The master database cannot be used as a tenant database');
  }
  return registerModels(dbName, TENANT_SCHEMAS);
}

/**
 * Tenant database name for an orgId: `iq_t_<orgId>` with every character other than
 * [a-z0-9_] replaced by '_' (MongoDB database names cannot contain '/\. "$' etc.).
 * @param {string} orgId
 * @returns {string}
 */
function buildTenantDbName(orgId) {
  const safe = String(orgId || '')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_');
  if (!safe) throw new Error('orgId is required to build a tenant database name');
  return `${TENANT_DB_PREFIX}${safe}`;
}

/**
 * Create the collections and indexes of a model set (idempotent).
 * @param {Object<string, import('mongoose').Model>} models
 * @returns {Promise<void>}
 */
async function ensureModelIndexes(models) {
  for (const model of Object.values(models)) {
    await model.createCollection();
    await model.createIndexes();
  }
}

/**
 * Create master collections + indexes (unique orgId/dbName/botUserId). Run after connect.
 * @returns {Promise<void>}
 */
function ensureMasterIndexes() {
  return ensureModelIndexes(getMasterModels());
}

/**
 * Initialise a tenant database: creates its collections and indexes, which also makes the
 * database exist in MongoDB. Idempotent.
 * @param {string} dbName
 * @returns {Promise<void>}
 */
function initTenantDatabase(dbName) {
  return ensureModelIndexes(getTenantModels(dbName));
}

module.exports = {
  getMasterModels,
  getTenantModels,
  buildTenantDbName,
  ensureMasterIndexes,
  initTenantDatabase,
  MASTER_SCHEMAS,
  TENANT_SCHEMAS,
};
