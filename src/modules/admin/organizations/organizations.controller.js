'use strict';

/**
 * @file HTTP layer of /api/admin/organizations: validates input with zod (ZodError -> 400
 * via the error handler) and answers { success, data, meta? }.
 */
const { sendSuccess } = require('../../../shared/utils/apiResponse');
const { buildPageMeta } = require('../../../shared/utils/query');
const { rejectImmutable } = require('../validation');
const schemas = require('./organizations.schemas');
const service = require('./organizations.service');
const sessions = require('../sessions/sessions.service');

/** GET / - list (q, status, sort, page, limit). */
async function list(req, res) {
  const query = schemas.listOrganizationsQuery.parse(req.query);
  const { items, total } = await service.listOrganizations(query);
  sendSuccess(res, items, { meta: buildPageMeta({ ...query, total }) });
}

/** GET /:orgId - one organization with bot/session counts. */
async function getOne(req, res) {
  sendSuccess(res, await service.getOrganization(req.params.orgId));
}

/** POST / - create (201). */
async function create(req, res) {
  const input = schemas.createOrganizationSchema.parse(req.body ?? {});
  sendSuccess(res, await service.createOrganization(input), { status: 201 });
}

/** PATCH /:orgId - update editable fields (orgId/dbName -> 400 IMMUTABLE_FIELD). */
async function update(req, res) {
  rejectImmutable(req.body, schemas.IMMUTABLE_FIELDS);
  const input = schemas.updateOrganizationSchema.parse(req.body ?? {});
  sendSuccess(res, await service.updateOrganization(req.params.orgId, input));
}

/** PATCH /:orgId/status - { status: 'active'|'suspended' }. */
async function setStatus(req, res) {
  const { status } = schemas.statusSchema.parse(req.body ?? {});
  sendSuccess(res, await service.setOrganizationStatus(req.params.orgId, status));
}

/** DELETE /:orgId - only when the organization has no bots (409 otherwise). */
async function remove(req, res) {
  sendSuccess(res, await service.deleteOrganization(req.params.orgId));
}

/** GET /:orgId/sessions - EO session summaries, newest first. */
async function listSessions(req, res) {
  const query = schemas.listSessionsQuery.parse(req.query);
  const { items, total } = await sessions.listOrganizationSessions(req.params.orgId, query);
  sendSuccess(res, items, { meta: buildPageMeta({ ...query, total }) });
}

/** GET /:orgId/sessions/:id - one session with all messages. */
async function getSession(req, res) {
  sendSuccess(res, await sessions.getOrganizationSession(req.params.orgId, req.params.id));
}

module.exports = { list, getOne, create, update, setStatus, remove, listSessions, getSession };
