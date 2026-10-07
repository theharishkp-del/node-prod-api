'use strict';

/**
 * @file Test helper: a throw-away MongoDB (mongodb-memory-server, version pinned in
 * package.json "config.mongodbMemoryServer") connected through the app's mongoose instance.
 *
 *   const db = await startTestDb();   // in test.before
 *   await db.stop();                  // in test.after
 */
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { ensureMasterIndexes, invalidateTenantCache } = require('../../src/shared/tenancy');

/**
 * Start mongod, connect mongoose and create the master indexes.
 * @returns {Promise<{uri: string, reset: () => Promise<void>, stop: () => Promise<void>}>}
 */
async function startTestDb() {
  // Load database.js first so its mongoose settings (bufferCommands=false, ...) apply.
  require('../../src/config/database');
  const server = await MongoMemoryServer.create();
  const uri = server.getUri();
  await mongoose.connect(uri, { autoIndex: false, serverSelectionTimeoutMS: 5000 });
  await ensureMasterIndexes();

  return {
    uri,
    /** Drop every database except admin/local/config and clear the tenant cache. */
    async reset() {
      const { databases } = await mongoose.connection.db.admin().listDatabases();
      for (const { name } of databases) {
        if (['admin', 'local', 'config'].includes(name)) continue;
        await mongoose.connection.useDb(name, { useCache: true }).dropDatabase();
      }
      invalidateTenantCache();
      await ensureMasterIndexes();
    },
    async stop() {
      await mongoose.disconnect();
      await server.stop();
    },
  };
}

module.exports = { startTestDb };
