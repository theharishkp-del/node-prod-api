'use strict';

/**
 * @file Dashboard numbers: organizations and bots by status, plus EO session counts per
 * organization (read from each tenant DB, at most STATS_MAX_ORGS organizations).
 */
const { getMasterModels, getTenantModels, ORG_STATUS, BOT_STATUS } = require('../../../shared/tenancy');

/** Upper bound of tenant databases queried by one stats call. */
const STATS_MAX_ORGS = 100;

/**
 * { total, <status>: count } for a model grouped by `status`.
 * @param {import('mongoose').Model} Model
 * @param {string[]} statuses
 * @returns {Promise<object>}
 */
async function countByStatus(Model, statuses) {
  const rows = await Model.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]);
  const out = { total: 0 };
  for (const s of statuses) out[s] = 0;
  for (const r of rows) {
    out.total += r.n;
    if (r._id in out) out[r._id] = r.n;
  }
  return out;
}

/**
 * Session numbers of one tenant DB.
 * @param {string} dbName
 * @param {Date} since
 * @returns {Promise<{sessions: number, sessionsLast24h: number, lastMessageAt: Date|null}>}
 */
async function tenantSessionStats(dbName, since) {
  const { EoSession } = getTenantModels(dbName);
  const [sessions, sessionsLast24h, last] = await Promise.all([
    EoSession.estimatedDocumentCount(),
    EoSession.countDocuments({ lastMessageAt: { $gte: since } }),
    EoSession.findOne().sort({ lastMessageAt: -1 }).select('lastMessageAt -_id').lean(),
  ]);
  return { sessions, sessionsLast24h, lastMessageAt: last ? last.lastMessageAt : null };
}

/**
 * Admin dashboard statistics.
 * @param {{now?: Date}} [options]
 * @returns {Promise<object>} { organizations, bots, sessions, perOrganization[], generatedAt }
 */
async function getStats({ now = new Date() } = {}) {
  const { Organization, Bot } = getMasterModels();
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [organizations, bots, orgs, botRows] = await Promise.all([
    countByStatus(Organization, Object.values(ORG_STATUS)),
    countByStatus(Bot, Object.values(BOT_STATUS)),
    Organization.find().sort({ createdAt: -1 }).limit(STATS_MAX_ORGS).select('orgId name status dbName -_id').lean(),
    Bot.aggregate([
      {
        $group: {
          _id: '$orgId',
          total: { $sum: 1 },
          active: { $sum: { $cond: [{ $eq: ['$status', BOT_STATUS.ACTIVE] }, 1, 0] } },
        },
      },
    ]),
  ]);
  const botsByOrg = new Map(botRows.map((r) => [r._id, r]));

  const perOrganization = await Promise.all(
    orgs.map(async (org) => {
      const b = botsByOrg.get(org.orgId) || { total: 0, active: 0 };
      return {
        orgId: org.orgId,
        name: org.name,
        status: org.status,
        bots: b.total,
        activeBots: b.active,
        ...(await tenantSessionStats(org.dbName, since)),
      };
    }),
  );

  // Most recently active tenants first; tenants without sessions follow, by name.
  perOrganization.sort(
    (a, b) =>
      (b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0) -
        (a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0) || a.name.localeCompare(b.name),
  );

  const sessions = perOrganization.reduce(
    (acc, o) => ({ total: acc.total + o.sessions, last24h: acc.last24h + o.sessionsLast24h }),
    { total: 0, last24h: 0 },
  );

  return {
    organizations,
    bots,
    sessions,
    perOrganization,
    perOrganizationTruncated: organizations.total > orgs.length,
    generatedAt: now.toISOString(),
  };
}

module.exports = { getStats, STATS_MAX_ORGS };
