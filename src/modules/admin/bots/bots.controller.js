'use strict';

/**
 * @file HTTP layer of /api/admin/bots: validates input with zod (ZodError -> 400 via the
 * error handler) and answers { success, data, meta? }.
 */
const { sendSuccess } = require('../../../shared/utils/apiResponse');
const { buildPageMeta } = require('../../../shared/utils/query');
const { rejectImmutable } = require('../validation');
const schemas = require('./bots.schemas');
const service = require('./bots.service');

/** GET / - list (q, orgId, status, sort, page, limit). */
async function list(req, res) {
  const query = schemas.listBotsQuery.parse(req.query);
  const { items, total } = await service.listBots(query);
  sendSuccess(res, items, { meta: buildPageMeta({ ...query, total }) });
}

/** GET /:botUserId */
async function getOne(req, res) {
  sendSuccess(res, await service.getBot(req.params.botUserId));
}

/** POST / - create (201); orgId must exist (422), botUserId unique (409). */
async function create(req, res) {
  const input = schemas.createBotSchema.parse(req.body ?? {});
  sendSuccess(res, await service.createBot(input), { status: 201 });
}

/** PATCH /:botUserId - update editable fields (botUserId -> 400 IMMUTABLE_FIELD). */
async function update(req, res) {
  rejectImmutable(req.body, schemas.IMMUTABLE_FIELDS);
  const input = schemas.updateBotSchema.parse(req.body ?? {});
  sendSuccess(res, await service.updateBot(req.params.botUserId, input));
}

/** PATCH /:botUserId/status - { status: 'active'|'inactive' }. */
async function setStatus(req, res) {
  const { status } = schemas.statusSchema.parse(req.body ?? {});
  sendSuccess(res, await service.setBotStatus(req.params.botUserId, status));
}

/** DELETE /:botUserId */
async function remove(req, res) {
  sendSuccess(res, await service.deleteBot(req.params.botUserId));
}

module.exports = { list, getOne, create, update, setStatus, remove };
