'use strict';

/**
 * @file Seed script (`npm run seed`): registers the demo organization 'demo' and its bot
 * '3183' (botDatabaseName SYSTEMBOT63183) and initialises the tenant database.
 * Idempotent: existing records are left unchanged, missing ones are created.
 *
 * Also exports seedDemo() so tests can reuse the same fixture data.
 */
const { connectDatabase, closeDatabase } = require('../src/config/database');
const logger = require('../src/config/logger');
const {
  getMasterModels,
  ensureMasterIndexes,
  initTenantDatabase,
  buildTenantDbName,
  invalidateTenantCache,
} = require('../src/shared/tenancy');

/** Demo organization (master `organizations`). */
const DEMO_ORG = Object.freeze({
  orgId: 'demo',
  name: 'Demo Cabinets',
  legalName: 'Demo Cabinets Pvt Ltd',
  email: 'admin@demo-cabinets.example',
  phone: '+91 80 4000 1234',
  address: {
    line1: '12 MG Road',
    city: 'Bengaluru',
    state: 'Karnataka',
    country: 'India',
    postalCode: '560001',
  },
  currencyCode: 'USD',
  timezone: 'Asia/Calcutta',
});

/** Demo bot (master `bots`), matches tests/fixtures/eoRequest.json. */
const DEMO_BOT = Object.freeze({
  botUserId: '3183',
  botDatabaseName: 'SYSTEMBOT63183',
  name: 'Demo Cabinets Bot',
  orgId: 'demo',
  channel: 'cybot',
});

/**
 * Create the demo organization + bot when missing and initialise the tenant DB.
 * Requires an open mongoose connection.
 * @param {object} [overrides]
 * @param {object} [overrides.org] Fields merged into DEMO_ORG.
 * @param {object} [overrides.bot] Fields merged into DEMO_BOT.
 * @returns {Promise<{org: object, bot: object, createdOrg: boolean, createdBot: boolean}>}
 */
async function seedDemo({ org: orgOverrides = {}, bot: botOverrides = {} } = {}) {
  const { Organization, Bot } = getMasterModels();
  await ensureMasterIndexes();

  const orgData = { ...DEMO_ORG, ...orgOverrides };
  orgData.dbName = buildTenantDbName(orgData.orgId);
  const orgRes = await Organization.findOneAndUpdate(
    { orgId: orgData.orgId },
    { $setOnInsert: orgData },
    { upsert: true, new: true, includeResultMetadata: true, lean: true },
  );
  await initTenantDatabase(orgRes.value.dbName);

  const botData = { ...DEMO_BOT, orgId: orgData.orgId, ...botOverrides };
  const botRes = await Bot.findOneAndUpdate(
    { botUserId: botData.botUserId },
    { $setOnInsert: botData },
    { upsert: true, new: true, includeResultMetadata: true, lean: true },
  );

  invalidateTenantCache();
  return {
    org: orgRes.value,
    bot: botRes.value,
    createdOrg: !orgRes.lastErrorObject.updatedExisting,
    createdBot: !botRes.lastErrorObject.updatedExisting,
  };
}

/** CLI entry point. */
async function main() {
  let exitCode = 0;
  try {
    await connectDatabase();
    const { org, bot, createdOrg, createdBot } = await seedDemo();
    logger.info(`Organization "${org.orgId}" ${createdOrg ? 'created' : 'already exists'} (db ${org.dbName})`);
    logger.info(`Bot "${bot.botUserId}" ${createdBot ? 'created' : 'already exists'} (org ${bot.orgId})`);
  } catch (err) {
    logger.error('Seed failed', { err });
    exitCode = 1;
  } finally {
    await closeDatabase().catch(() => {});
    await logger.flushLogger();
  }
  process.exit(exitCode);
}

if (require.main === module) main();

module.exports = { seedDemo, DEMO_ORG, DEMO_BOT };
