'use strict';

/**
 * @file Bots (master DB): list/search, read, create, update, status change and delete.
 * A bot always belongs to an existing organization. Every change invalidates the tenant
 * cache entry of the bot so EO calls see it immediately.
 */
const baseLogger = require('../../../config/logger');
const AppError = require('../../../shared/utils/AppError');
const { containsRegex, toSort } = require('../../../shared/utils/query');
const { getMasterModels, invalidateTenantCache } = require('../../../shared/tenancy');

const logger = baseLogger.child({ module: 'admin' });

const BOT_PROJECTION = '-__v';

/**
 * Organization summaries keyed by orgId.
 * @param {string[]} orgIds
 * @returns {Promise<Map<string, {orgId: string, name: string, status: string}>>}
 */
async function orgSummaries(orgIds) {
  const { Organization } = getMasterModels();
  const orgs = await Organization.find({ orgId: { $in: [...new Set(orgIds)] } })
    .select('orgId name status -_id')
    .lean();
  return new Map(orgs.map((o) => [o.orgId, o]));
}

/**
 * Throw 422 ORG_NOT_FOUND unless the organization exists.
 * @param {string} orgId
 * @returns {Promise<void>}
 */
async function assertOrganizationExists(orgId) {
  const { Organization } = getMasterModels();
  if (!(await Organization.exists({ orgId }))) {
    throw new AppError(`Organization "${orgId}" does not exist`, 422, 'ORG_NOT_FOUND', [
      { path: 'orgId', message: 'unknown organization' },
    ]);
  }
}

/**
 * List bots with search (botUserId, name, botDatabaseName), organization and status
 * filters, sorting and pagination. Items carry `organization: { orgId, name, status }`.
 * @param {{q?: string, orgId?: string, status?: string, sort: string, page: number, limit: number}} query
 * @returns {Promise<{items: object[], total: number}>}
 */
async function listBots({ q, orgId, status, sort, page, limit }) {
  const { Bot } = getMasterModels();
  const filter = {};
  if (orgId) filter.orgId = orgId;
  if (status) filter.status = status;
  if (q) {
    const rx = containsRegex(q);
    filter.$or = [{ botUserId: rx }, { name: rx }, { botDatabaseName: rx }];
  }
  const [items, total] = await Promise.all([
    Bot.find(filter)
      .select(BOT_PROJECTION)
      .sort(toSort(sort))
      .skip((page - 1) * limit)
      .limit(limit)
      .collation({ locale: 'en', strength: 2 })
      .lean(),
    Bot.countDocuments(filter),
  ]);
  const orgs = await orgSummaries(items.map((b) => b.orgId));
  for (const bot of items) bot.organization = orgs.get(bot.orgId) || null;
  return { items, total };
}

/**
 * One bot with its organization summary.
 * @param {string} botUserId
 * @returns {Promise<object>}
 * @throws {AppError} 404 BOT_NOT_FOUND
 */
async function getBot(botUserId) {
  const { Bot } = getMasterModels();
  const bot = await Bot.findOne({ botUserId: String(botUserId) }).select(BOT_PROJECTION).lean();
  if (!bot) throw new AppError(`Bot "${botUserId}" not found`, 404, 'BOT_NOT_FOUND');
  bot.organization = (await orgSummaries([bot.orgId])).get(bot.orgId) || null;
  return bot;
}

/**
 * Register a bot for an existing organization.
 * @param {object} input Validated createBotSchema output.
 * @returns {Promise<object>}
 * @throws {AppError} 409 BOT_EXISTS, 422 ORG_NOT_FOUND
 */
async function createBot(input) {
  const { Bot } = getMasterModels();
  await assertOrganizationExists(input.orgId);
  if (await Bot.exists({ botUserId: input.botUserId })) {
    throw new AppError(`Bot "${input.botUserId}" already exists`, 409, 'BOT_EXISTS');
  }
  const created = await Bot.create(input);
  invalidateTenantCache({ botUserId: input.botUserId });
  logger.info('Bot created', { event: 'admin.bot_created', botUserId: input.botUserId, orgId: input.orgId });
  return getBot(created.botUserId);
}

/**
 * Update editable fields (botUserId is immutable; orgId may move the bot to another
 * organization - its past sessions stay in the old tenant database).
 * @param {string} botUserId
 * @param {object} input Validated updateBotSchema output (or { status }).
 * @returns {Promise<object>}
 */
async function updateBot(botUserId, input) {
  const { Bot } = getMasterModels();
  if (input.orgId) await assertOrganizationExists(input.orgId);
  const updated = await Bot.findOneAndUpdate(
    { botUserId: String(botUserId) },
    { $set: input },
    { new: true, runValidators: true },
  ).lean();
  if (!updated) throw new AppError(`Bot "${botUserId}" not found`, 404, 'BOT_NOT_FOUND');
  invalidateTenantCache({ botUserId: updated.botUserId });
  logger.info('Bot updated', { event: 'admin.bot_updated', botUserId: updated.botUserId, fields: Object.keys(input) });
  return getBot(updated.botUserId);
}

/**
 * Activate or deactivate a bot (inactive -> EO failure reply).
 * @param {string} botUserId
 * @param {'active'|'inactive'} status
 * @returns {Promise<object>}
 */
function setBotStatus(botUserId, status) {
  return updateBot(botUserId, { status });
}

/**
 * Delete a bot (its sessions stay in the tenant database).
 * @param {string} botUserId
 * @returns {Promise<{botUserId: string, deleted: true}>}
 */
async function deleteBot(botUserId) {
  const { Bot } = getMasterModels();
  const deleted = await Bot.findOneAndDelete({ botUserId: String(botUserId) }).lean();
  if (!deleted) throw new AppError(`Bot "${botUserId}" not found`, 404, 'BOT_NOT_FOUND');
  invalidateTenantCache({ botUserId: deleted.botUserId });
  logger.info('Bot deleted', { event: 'admin.bot_deleted', botUserId: deleted.botUserId, orgId: deleted.orgId });
  return { botUserId: deleted.botUserId, deleted: true };
}

module.exports = { listBots, getBot, createBot, updateBot, setBotStatus, deleteBot };
