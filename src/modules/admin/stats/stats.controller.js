'use strict';

/** @file HTTP layer of GET /api/admin/stats. */
const { sendSuccess } = require('../../../shared/utils/apiResponse');
const { getStats } = require('./stats.service');

/** GET /stats - dashboard counts. */
async function stats(req, res) {
  sendSuccess(res, await getStats());
}

module.exports = { stats };
