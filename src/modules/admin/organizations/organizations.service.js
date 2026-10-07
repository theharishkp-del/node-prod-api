'use strict';

/**
 * @file Organizations (master DB): list/search, read with counts, create (generates orgId
 * and the tenant database), update, status change and delete. Every change invalidates
 * the tenant cache so EO calls see it immediately.
 */
const crypto = require('crypto');
const baseLogger = require('../../../config/logger');
const AppError = require('../../../shared/utils/AppError');
const { containsRegex, toSort } = require('../../../shared/utils/query');
const {
  getMasterModels,
  getTenantModels,
  buildTenantDbName,
  initTenantDatabase,
  invalidateTenantCache,
  BOT_STATUS,
} = require('../../../shared/tenancy');

const logger = baseLogger.child({ module: 'admin' });

/** Projection used for every organization returned by the API. */
const ORG_PROJECTION = '-__v';

/**
 * URL-safe slug of a name: 'Demo Cabinets & Co.' -> 'demo-cabinets-co'.
 * @param {string} name
 * @param {number} [max=24]
 * @returns {string} At least 2 characters ('org' when nothing usable is left).
 */
function slugify(name, max = 24) {
  const slug = String(name || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/, '');
  return slug.length >= 2 ? slug : 'org';
}

/**
 * Pick an unused orgId: the slug of the name, else slug + '-' + 4 random characters.
 * @param {string} name
 * @returns {Promise<string>}
 */
async function generateOrgId(name) {
  const { Organization } = getMasterModels();
  const base = slugify(name);
  for (let i = 0; i < 6; i += 1) {
    const candidate = i === 0 ? base : `${base}-${crypto.randomBytes(3).toString('hex').slice(0, 4)}`;
    if (!(await Organization.exists({ orgId: candidate }))) return candidate;
  }
  throw new AppError('Could not generate a unique orgId, please provide one', 409, 'ORG_ID_UNAVAILABLE');
}

/**
 * Bot counts per organization.
 * @param {string[]} orgIds
 * @returns {Promise<Map<string, {total: number, active: number}>>}
 */
async function countBotsByOrg(orgIds) {
  const { Bot } = getMasterModels();
  const rows = await Bot.aggregate([
    { $match: { orgId: { $in: orgIds } } },
    {
      $group: {
        _id: '$orgId',
        total: { $sum: 1 },
        active: { $sum: { $cond: [{ $eq: ['$status', BOT_STATUS.ACTIVE] }, 1, 0] } },
      },
    },
  ]);
  return new Map(rows.map((r) => [r._id, { total: r.total, active: r.active }]));
}

/**
 * Load an organization or throw 404.
 * @param {string} orgId
 * @returns {Promise<object>} Lean document.
 * @throws {AppError} 404 ORG_NOT_FOUND
 */
async function findOrganizationOrThrow(orgId) {
  const { Organization } = getMasterModels();
  const org = await Organization.findOne({ orgId: String(orgId).toLowerCase() }).select(ORG_PROJECTION).lean();
  if (!org) throw new AppError(`Organization "${orgId}" not found`, 404, 'ORG_NOT_FOUND');
  return org;
}

/**
 * List organizations with search, status filter, sorting and pagination.
 * Each item carries botCount / activeBotCount.
 * @param {{q?: string, status?: string, sort: string, page: number, limit: number}} query
 * @returns {Promise<{items: object[], total: number}>}
 */
async function listOrganizations({ q, status, sort, page, limit }) {
  const { Organization } = getMasterModels();
  const filter = {};
  if (status) filter.status = status;
  if (q) {
    const rx = containsRegex(q);
    filter.$or = [{ name: rx }, { orgId: rx }, { legalName: rx }, { email: rx }];
  }
  const [items, total] = await Promise.all([
    Organization.find(filter)
      .select(ORG_PROJECTION)
      .sort(toSort(sort))
      .skip((page - 1) * limit)
      .limit(limit)
      .collation({ locale: 'en', strength: 2 })
      .lean(),
    Organization.countDocuments(filter),
  ]);
  const counts = await countBotsByOrg(items.map((o) => o.orgId));
  for (const org of items) {
    const c = counts.get(org.orgId) || { total: 0, active: 0 };
    org.botCount = c.total;
    org.activeBotCount = c.active;
  }
  return { items, total };
}

/**
 * One organization with bot and session counts.
 * @param {string} orgId
 * @returns {Promise<object>}
 */
async function getOrganization(orgId) {
  const org = await findOrganizationOrThrow(orgId);
  const counts = (await countBotsByOrg([org.orgId])).get(org.orgId) || { total: 0, active: 0 };
  const sessionCount = await getTenantModels(org.dbName).EoSession.estimatedDocumentCount();
  return { ...org, botCount: counts.total, activeBotCount: counts.active, sessionCount };
}

/**
 * Create an organization and initialise its tenant database (collections + indexes).
 * When the tenant initialisation fails the organization is removed again.
 * @param {object} input Validated createOrganizationSchema output.
 * @returns {Promise<object>}
 * @throws {AppError} 409 ORG_EXISTS
 */
async function createOrganization(input) {
  const { Organization } = getMasterModels();
  const orgId = input.orgId || (await generateOrgId(input.name));
  if (await Organization.exists({ orgId })) {
    throw new AppError(`Organization "${orgId}" already exists`, 409, 'ORG_EXISTS');
  }
  const dbName = buildTenantDbName(orgId);
  const created = await Organization.create({ ...input, orgId, dbName });

  try {
    await initTenantDatabase(dbName);
  } catch (err) {
    logger.error('Tenant database initialisation failed, rolling back organization', {
      event: 'admin.tenant_init_failed',
      orgId,
      dbName,
      err,
    });
    await Organization.deleteOne({ _id: created._id });
    throw new AppError('Could not initialise the tenant database', 500, 'TENANT_INIT_FAILED');
  }

  logger.info('Organization created', { event: 'admin.org_created', orgId, dbName });
  invalidateTenantCache({ orgId });
  return { ...created.toObject({ versionKey: false }), botCount: 0, activeBotCount: 0, sessionCount: 0 };
}

/**
 * Turn { address: { city } } into { 'address.city': ... } so a partial address update
 * keeps the other address fields.
 * @param {object} input
 * @returns {object}
 */
function toSetUpdate(input) {
  const $set = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === 'address' && value && typeof value === 'object') {
      for (const [k, val] of Object.entries(value)) $set[`address.${k}`] = val;
    } else {
      $set[key] = value;
    }
  }
  return $set;
}

/**
 * Update editable fields (orgId and dbName are immutable).
 * @param {string} orgId
 * @param {object} input Validated updateOrganizationSchema output.
 * @returns {Promise<object>}
 */
async function updateOrganization(orgId, input) {
  const { Organization } = getMasterModels();
  const updated = await Organization.findOneAndUpdate(
    { orgId: String(orgId).toLowerCase() },
    { $set: toSetUpdate(input) },
    { new: true, runValidators: true, projection: ORG_PROJECTION },
  ).lean();
  if (!updated) throw new AppError(`Organization "${orgId}" not found`, 404, 'ORG_NOT_FOUND');
  invalidateTenantCache({ orgId: updated.orgId });
  logger.info('Organization updated', { event: 'admin.org_updated', orgId: updated.orgId, fields: Object.keys(input) });
  return updated;
}

/**
 * Activate or suspend an organization (suspended -> its bots get an EO failure reply).
 * @param {string} orgId
 * @param {'active'|'suspended'} status
 * @returns {Promise<object>}
 */
async function setOrganizationStatus(orgId, status) {
  const updated = await updateOrganization(orgId, { status });
  logger.info('Organization status changed', { event: 'admin.org_status', orgId: updated.orgId, status });
  return updated;
}

/**
 * Delete an organization that has no bots. The tenant database is NOT dropped (data is
 * kept; drop it manually if it must go).
 * @param {string} orgId
 * @returns {Promise<{orgId: string, dbName: string, deleted: true}>}
 * @throws {AppError} 404 ORG_NOT_FOUND, 409 ORG_HAS_BOTS
 */
async function deleteOrganization(orgId) {
  const { Organization, Bot } = getMasterModels();
  const org = await findOrganizationOrThrow(orgId);
  const botCount = await Bot.countDocuments({ orgId: org.orgId });
  if (botCount > 0) {
    throw new AppError(
      `Organization "${org.orgId}" still has ${botCount} bot(s); delete or move them first, or suspend the organization`,
      409,
      'ORG_HAS_BOTS',
    );
  }
  await Organization.deleteOne({ _id: org._id });
  invalidateTenantCache({ orgId: org.orgId });
  logger.info('Organization deleted', { event: 'admin.org_deleted', orgId: org.orgId, dbName: org.dbName });
  return { orgId: org.orgId, dbName: org.dbName, deleted: true };
}

module.exports = {
  listOrganizations,
  getOrganization,
  createOrganization,
  updateOrganization,
  setOrganizationStatus,
  deleteOrganization,
  findOrganizationOrThrow,
  slugify,
};
