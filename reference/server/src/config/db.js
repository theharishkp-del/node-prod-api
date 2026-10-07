/**
 * MongoDB connection helpers.
 *
 * Exposes helpers to connect to the master database, retrieve the
 * MongoClient instance and close connections cleanly. Functions here
 * are safe to call multiple times; the client is initialized lazily
 * and cached for re-use across the application lifecycle.
 */
import { MongoClient } from 'mongodb';
import { env } from './env.js';
import { logger } from './logger.js';

let mongoClient;
let masterDb;

export async function connectDatabases() {
  /**
   * Connects to MongoDB and returns the client and master DB handle.
   * Caches the client and DB after the first successful connection.
   * @returns {{client: MongoClient, masterDb: import('mongodb').Db}}
   */
  if (mongoClient && masterDb) {
    logger.info('MongoDB connection already initialized', {
      database: env.masterDbName,
      connectionState: mongoClient.topology?.isConnected?.() ? 'connected' : 'disconnected',
    });
    return { client: mongoClient, masterDb };
  }

  mongoClient = new MongoClient(env.mongodbUri, {
    maxPoolSize: 20,
  });

  await mongoClient.connect();
  masterDb = mongoClient.db(env.masterDbName);
  logger.info('MongoDB connection established', {
    database: masterDb.databaseName,
    connectionState: 'connected',
  });

  return { client: mongoClient, masterDb };
}

export function getMongoClient() {
  /**
   * Returns the initialized MongoClient.
   * Throws if `connectDatabases()` has not been called yet.
   * @returns {MongoClient}
   */
  if (!mongoClient) {
    throw new Error('MongoDB client has not been initialized yet.');
  }

  return mongoClient;
}

export function getMasterDbConnection() {
  /**
   * Returns the master database connection established by
   * `connectDatabases()`. Throws if not initialized.
   * @returns {import('mongodb').Db}
   */
  if (!masterDb) {
    throw new Error('Master database connection has not been initialized yet.');
  }

  return masterDb;
}

export async function closeDatabases() {
  /**
   * Closes MongoDB client and clears cached references.
   */
  if (mongoClient) {
    await mongoClient.close();
    logger.info('MongoDB connection closed', {
      database: env.masterDbName,
      connectionState: 'closed',
    });
  }

  mongoClient = undefined;
  masterDb = undefined;
}
