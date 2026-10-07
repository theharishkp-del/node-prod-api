import { MongoDBSaver } from '@langchain/langgraph-checkpoint-mongodb';
import { getMongoClient } from '../../config/db.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';

const checkpointerPromises = new Map();

export async function getLanggraphCheckpointer(tenantDb) {
  const databaseName = String(tenantDb?.databaseName || '').trim();

  if (!databaseName) {
    throw new Error('tenantDb with a valid databaseName is required for LangGraph checkpointer setup.');
  }

  if (!checkpointerPromises.has(databaseName)) {
    checkpointerPromises.set(databaseName, (async () => {
      const ttl = Number.isFinite(env.langgraphCheckpointTtlSeconds)
        ? Math.max(3600, env.langgraphCheckpointTtlSeconds)
        : 60 * 60 * 24 * 30;
      const checkpointer = new MongoDBSaver({
        client: getMongoClient(),
        dbName: databaseName,
        checkpointCollectionName: 'agent_chat_checkpoints',
        checkpointWritesCollectionName: 'agent_chat_checkpoint_writes',
        ttl,
      });

      logger.info('LangGraph MongoDB checkpointer setup started', {
        databaseName,
        checkpointCollectionName: 'agent_chat_checkpoints',
        ttlSeconds: ttl,
      });

      const setupErrors = await checkpointer.setup();

      if (setupErrors.length) {
        throw new AggregateError(setupErrors, 'Unable to initialize LangGraph MongoDB indexes.');
      }

      logger.info('LangGraph MongoDB checkpointer ready', {
        databaseName,
        ttlSeconds: ttl,
      });

      return checkpointer;
    })().catch((error) => {
      checkpointerPromises.delete(databaseName);
      logger.error('LangGraph MongoDB checkpointer setup failed', {
        databaseName,
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }));
  }

  return checkpointerPromises.get(databaseName);
}
