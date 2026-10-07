import { getMongoClient, getMasterDbConnection } from '../config/db.js';
import { logger } from '../config/logger.js';
import { REGISTRY_COLLECTION } from '../models/master/registryModel.js';

const tenantRegistryCache = new Map();
const tenantDbCache = new Map();

function normalizeCacheKey(value) {
  const normalizedValue = String(value || '').trim();
  return normalizedValue || null;
}

function buildRegistryCacheKeys(tenantRegistry = {}) {
  const botIdCacheKey = normalizeCacheKey(tenantRegistry.botId);
  return botIdCacheKey ? [botIdCacheKey] : [];
}

function cacheTenantRegistryEntry(tenantRegistry) {
  if (!tenantRegistry || typeof tenantRegistry !== 'object') {
    return [];
  }

  const cachedRegistry = { ...tenantRegistry };
  const cacheKeys = buildRegistryCacheKeys(cachedRegistry);

  for (const cacheKey of cacheKeys) {
    tenantRegistryCache.set(cacheKey, cachedRegistry);
  }

  return cacheKeys;
}

export function getTenantCacheSnapshot() {
  const databaseNameCache = [...tenantRegistryCache.entries()].map(([cacheKey, tenantRegistry]) => ({
    cacheKey,
    databaseName: tenantRegistry?.databaseName || null,
  }));

  return {
    sizes: {
      registry: tenantRegistryCache.size,
      tenantDb: tenantDbCache.size,
    },
    registryCacheKeys: [...tenantRegistryCache.keys()],
    databaseNameCache,
    tenantDbCacheKeys: [...tenantDbCache.keys()],
  };
}

export function primeTenantRoutingCache(tenantRegistry) {
  const cacheKeys = cacheTenantRegistryEntry(tenantRegistry);
  const databaseName = tenantRegistry?.databaseName;

  if (databaseName && !tenantDbCache.has(databaseName)) {
    tenantDbCache.set(databaseName, getMongoClient().db(databaseName));
  }

  logger.info('Tenant routing cache primed', {
    botUserId: tenantRegistry?.botUserId || null,
    tenantId: tenantRegistry?.tenantId || null,
    databaseName: databaseName || null,
    cacheKeys,
    cacheSnapshot: getTenantCacheSnapshot(),
  });

  return databaseName ? tenantDbCache.get(databaseName) : null;
}

export async function provisionTrialTenant(botUserId) {
  const normalizedBotUserId = normalizeCacheKey(botUserId);

  if (!normalizedBotUserId) {
    throw new Error('botUserId is required.');
  }

  const masterDb = getMasterDbConnection();
  const existingRegistry = await getTenantRegistry(normalizedBotUserId);
  const tenantId = existingRegistry?.tenantId || `trial_${Date.now().toString(36)}`;
  const databaseName = existingRegistry?.databaseName || `tenant_${normalizedBotUserId}_trial_${Date.now().toString(36)}`;
  const { createdAt: _ignoredCreatedAt, ...existingRegistryWithoutCreatedAt } = existingRegistry || {};
  const trialRegistry = {
    ...existingRegistryWithoutCreatedAt,
    botUserId: normalizedBotUserId,
    botId: existingRegistry?.botId || normalizedBotUserId,
    tenantId,
    databaseName,
    planCode: existingRegistry?.planCode || 'csm-suite-trial',
    isActive: true,
    updatedAt: new Date(),
  };

  await masterDb.collection(REGISTRY_COLLECTION).updateOne(
    { botUserId: normalizedBotUserId },
    {
      $set: trialRegistry,
      $setOnInsert: {
        createdAt: new Date(),
      },
    },
    { upsert: true }
  );

  primeTenantRoutingCache(trialRegistry);
  return trialRegistry;
}

export async function getTenantRegistry(botUserId) {
  const normalizedBotUserId = normalizeCacheKey(botUserId);

  if (!normalizedBotUserId) {
    throw new Error('botUserId is required.');
  }

  if (tenantRegistryCache.has(normalizedBotUserId)) {
    const cachedRegistry = tenantRegistryCache.get(normalizedBotUserId);
    logger.debug('Tenant registry cache hit', {
      botUserId: normalizedBotUserId,
      tenantId: cachedRegistry?.tenantId || null,
      databaseName: cachedRegistry?.databaseName || null,
    });
    return cachedRegistry;
  }

  const masterDb = getMasterDbConnection();

  const tenantRegistry = await masterDb.collection(REGISTRY_COLLECTION).findOne({
    $and: [
      {
        $or: [
          { botUserId: normalizedBotUserId },
          { botId: normalizedBotUserId },
        ],
      },
      { isActive: { $ne: false } },
    ],
  });

  if (!tenantRegistry) {
    return null;
  }

  cacheTenantRegistryEntry(tenantRegistry);
  logger.info('Tenant registry resolved from master database and cached', {
    botUserId: normalizedBotUserId,
    tenantId: tenantRegistry.tenantId || null,
    databaseName: tenantRegistry.databaseName || null,
  });

  return tenantRegistry;
}

export async function getTenantDatabaseName(botUserId) {
  const normalizedBotUserId = normalizeCacheKey(botUserId);

  if (!normalizedBotUserId) {
    throw new Error('botUserId is required.');
  }

  if (tenantRegistryCache.has(normalizedBotUserId)) {
    const cachedRegistry = tenantRegistryCache.get(normalizedBotUserId);
    const cachedDatabaseName = cachedRegistry?.databaseName || null;
    logger.debug('Tenant routing cache hit', {
      botUserId: normalizedBotUserId,
      databaseName: cachedDatabaseName,
    });

    if (!cachedDatabaseName) {
      throw new Error(`No tenant database mapping found in cache for botUserId "${normalizedBotUserId}".`);
    }

    return cachedDatabaseName;
  }

  const tenantRegistry = await getTenantRegistry(normalizedBotUserId);

  if (!tenantRegistry?.databaseName) {
    throw new Error(`No tenant database mapping found for botUserId "${normalizedBotUserId}".`);
  }

  cacheTenantRegistryEntry(tenantRegistry);
  logger.info('Tenant registry resolved from master database', {
    botUserId: normalizedBotUserId,
    databaseName: tenantRegistry.databaseName,
  });
  return tenantRegistry.databaseName;
}

export async function getTenantDb(botUserId) {
  const databaseName = await getTenantDatabaseName(botUserId);

  if (tenantDbCache.has(databaseName)) {
    logger.debug('Tenant database cache hit', { botUserId, databaseName });
    return tenantDbCache.get(databaseName);
  }

  const tenantDb = getMongoClient().db(databaseName);
  tenantDbCache.set(databaseName, tenantDb);
  logger.info('Tenant database connection cached', { botUserId, databaseName });

  return tenantDb;
}

export function clearTenantCaches() {
  tenantRegistryCache.clear();
  tenantDbCache.clear();
}
