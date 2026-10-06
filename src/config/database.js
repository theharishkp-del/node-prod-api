'use strict';

/**
 * MongoDB connection (mongoose).
 *
 * - connectDatabase(): connects with exponential backoff + jitter on startup.
 *   MONGO_CONNECT_RETRIES=0 retries forever; otherwise throws after N failed attempts.
 * - Logs connection lifecycle events (connected, disconnected, reconnected, error...).
 * - After the first successful connection the MongoDB driver handles reconnects itself.
 * - closeDatabase(): graceful close used during shutdown.
 */
const mongoose = require('mongoose');
const config = require('./index');
const baseLogger = require('./logger');

const logger = baseLogger.child({ module: 'mongodb' });

const STATES = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
  99: 'uninitialized',
};

mongoose.set('strictQuery', true);
// Fail fast instead of silently queueing queries while disconnected.
mongoose.set('bufferCommands', false);

const connectionOptions = {
  maxPoolSize: config.mongo.maxPoolSize,
  minPoolSize: config.mongo.minPoolSize,
  serverSelectionTimeoutMS: config.mongo.serverSelectionTimeoutMS,
  socketTimeoutMS: config.mongo.socketTimeoutMS,
  connectTimeoutMS: 10000,
  heartbeatFrequencyMS: 10000,
  maxIdleTimeMS: 60000,
  retryWrites: true,
  // Indexes are built explicitly after connecting (see syncIndexes) because
  // bufferCommands=false prevents mongoose from building them before the connection.
  autoIndex: false,
  appName: config.appName,
};

/** Hide credentials when logging the connection string. */
function redactUri(uri) {
  return uri.replace(/\/\/([^@/]+)@/, '//***:***@');
}

let listenersAttached = false;
let shuttingDown = false;
let hasConnectedOnce = false; // startup failures are reported by the retry loop instead

function attachListeners() {
  if (listenersAttached) return;
  listenersAttached = true;
  const conn = mongoose.connection;

  conn.on('connecting', () => logger.info('MongoDB connecting'));
  conn.on('connected', () => {
    hasConnectedOnce = true;
    logger.info('MongoDB connected', { host: conn.host, port: conn.port, db: conn.name });
  });
  conn.on('open', () => logger.debug('MongoDB connection open'));
  conn.on('disconnected', () => {
    if (shuttingDown || !hasConnectedOnce) logger.info('MongoDB disconnected');
    else logger.warn('MongoDB disconnected - driver will try to reconnect');
  });
  conn.on('reconnected', () => logger.info('MongoDB reconnected'));
  conn.on('close', () => logger.info('MongoDB connection closed'));
  conn.on('error', (err) => {
    if (hasConnectedOnce) logger.error('MongoDB connection error', { err });
    else logger.debug('MongoDB connection error during startup', { error: err.message });
  });
}

function backoffDelay(attempt) {
  const { retryInitialDelayMs, retryMaxDelayMs } = config.mongo;
  const exp = Math.min(retryMaxDelayMs, retryInitialDelayMs * 2 ** (attempt - 1));
  const jitter = Math.random() * exp * 0.2; // +/- 20% jitter avoids thundering herd
  return Math.round(exp - exp * 0.1 + jitter);
}

/**
 * Create the indexes declared in the schemas (e.g. unique email). Safe to run on every
 * start (createIndex is idempotent). Disable with MONGO_AUTO_INDEX=false if you manage
 * indexes with migrations on large production collections.
 */
async function ensureIndexes() {
  for (const name of mongoose.modelNames()) {
    try {
      await mongoose.model(name).createIndexes();
      logger.info('MongoDB indexes ensured', { model: name });
    } catch (err) {
      logger.error('Failed to create MongoDB indexes', { model: name, err });
    }
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Connect to MongoDB, retrying with exponential backoff.
 * @returns {Promise<typeof mongoose>}
 */
async function connectDatabase() {
  attachListeners();
  const { uri, connectRetries } = config.mongo;
  const maxAttempts = connectRetries === 0 ? Infinity : connectRetries;

  for (let attempt = 1; ; attempt += 1) {
    if (shuttingDown) throw new Error('Shutdown in progress, aborting MongoDB connect');
    try {
      logger.info('Connecting to MongoDB', {
        uri: redactUri(uri),
        attempt,
        maxAttempts: Number.isFinite(maxAttempts) ? maxAttempts : 'infinite',
      });
      await mongoose.connect(uri, connectionOptions);
      if (config.mongo.autoIndex) await ensureIndexes();
      return mongoose;
    } catch (err) {
      if (attempt >= maxAttempts) {
        logger.error('MongoDB connection failed, giving up', { attempt, err });
        throw err;
      }
      const delay = backoffDelay(attempt);
      logger.warn('MongoDB connection attempt failed, retrying', {
        attempt,
        retryInMs: delay,
        error: err.message,
      });
      await sleep(delay);
    }
  }
}

async function closeDatabase() {
  shuttingDown = true;
  if (mongoose.connection.readyState === 0) return;
  logger.info('Closing MongoDB connection');
  await mongoose.connection.close(false);
}

function getDatabaseState() {
  const state = mongoose.connection.readyState;
  return { state: STATES[state] || 'unknown', isConnected: state === 1 };
}

module.exports = { connectDatabase, closeDatabase, getDatabaseState, mongoose };
