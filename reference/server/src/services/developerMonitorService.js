import { getMasterDbConnection } from '../config/db.js';
import { ObjectId } from 'mongodb';
import {
  getLogsForDate,
  getLogBufferLimit,
  getLogDirectory,
} from '../config/logger.js';
import { getTenantCacheSnapshot, getTenantDb } from '../utils/tenantManager.js';
import { REGISTRY_COLLECTION } from '../models/master/registryModel.js';

const MAX_LOG_LIMIT = 200;
const MAX_DOCUMENT_LIMIT = 25;
const MAX_COLLECTION_KEY_COUNT = 12;
const MAX_COLLECTION_DELETE_COUNT = 100;

function createHttpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizePositiveInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsedValue = Number.parseInt(String(value ?? ''), 10);

  if (Number.isNaN(parsedValue)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsedValue));
}

function serializeDocumentValue(value, depth = 0) {
  if (value == null) {
    return value ?? null;
  }

  if (depth >= 5) {
    return '[Max depth reached]';
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Buffer.isBuffer(value)) {
    return `[Buffer ${value.length} bytes]`;
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeDocumentValue(item, depth + 1));
  }

  if (typeof value === 'object') {
    if (value?._bsontype === 'ObjectId' && typeof value.toString === 'function') {
      return value.toString();
    }

    return Object.entries(value).reduce((result, [key, entryValue]) => {
      result[key] = serializeDocumentValue(entryValue, depth + 1);
      return result;
    }, {});
  }

  return value;
}

function detectCollectionActivity(sampleDocument) {
  if (!sampleDocument || typeof sampleDocument !== 'object') {
    return null;
  }

  const knownDateKeys = ['updatedAt', 'createdAt', 'lastImportedAt', 'paymentDate', 'invoiceDate', 'quoteDate'];

  for (const key of knownDateKeys) {
    if (sampleDocument[key]) {
      return serializeDocumentValue(sampleDocument[key]);
    }
  }

  return null;
}

async function buildCollectionSummary(db, collectionName) {
  const collection = db.collection(collectionName);
  const [documentCount, latestDocument] = await Promise.all([
    collection.estimatedDocumentCount(),
    collection.findOne({}, { sort: { _id: -1 } }),
  ]);

  return {
    name: collectionName,
    documentCount,
    sampleKeys: Object.keys(latestDocument || {}).slice(0, MAX_COLLECTION_KEY_COUNT),
    latestDocumentId: latestDocument?._id ? String(latestDocument._id) : null,
    latestActivityAt: detectCollectionActivity(latestDocument),
  };
}

async function buildDatabaseSummary(db) {
  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  const names = collections
    .map((collection) => String(collection?.name || '').trim())
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));

  const collectionSummaries = await Promise.all(names.map((name) => buildCollectionSummary(db, name)));
  const totalDocuments = collectionSummaries.reduce((sum, collection) => sum + collection.documentCount, 0);

  return {
    name: db.databaseName,
    collectionCount: collectionSummaries.length,
    totalDocuments,
    collections: collectionSummaries,
  };
}

function resolveDatabaseScope(scope, tenantDb) {
  if (scope === 'master') {
    return getMasterDbConnection();
  }

  if (scope === 'tenant') {
    return tenantDb;
  }

  throw createHttpError('Collection scope must be either "master" or "tenant".', 400);
}

async function listDeveloperTenants() {
  const masterDb = getMasterDbConnection();
  const tenantRegistries = await masterDb.collection(REGISTRY_COLLECTION)
    .find({ isActive: { $ne: false } })
    .project({ tenantId: 1, botUserId: 1, botId: 1, databaseName: 1, companyName: 1 })
    .sort({ companyName: 1, tenantId: 1 })
    .toArray();

  return tenantRegistries.map((tenant) => ({
    tenantId: String(tenant.tenantId || ''),
    botUserId: String(tenant.botUserId || tenant.botId || ''),
    databaseName: String(tenant.databaseName || ''),
    companyName: String(tenant.companyName || tenant.tenantName || tenant.tenantId || 'Unnamed tenant'),
  })).filter((tenant) => tenant.tenantId && tenant.botUserId && tenant.databaseName);
}

async function resolveDeveloperTenant(tenantId) {
  const tenants = await listDeveloperTenants();
  const normalizedTenantId = String(tenantId || '').trim();
  const tenant = normalizedTenantId
    ? tenants.find((candidate) => candidate.tenantId === normalizedTenantId)
    : tenants[0];

  if (!tenant) {
    throw createHttpError('An active tenant was not found for the selected tenant ID.', 404);
  }

  return {
    tenant,
    tenantDb: await getTenantDb(tenant.botUserId),
    tenants,
  };
}

async function ensureCollectionExists(db, collectionName) {
  const matchingCollections = await db.listCollections({ name: collectionName }, { nameOnly: true }).toArray();

  if (!matchingCollections.length) {
    throw createHttpError(`Collection "${collectionName}" was not found in database "${db.databaseName}".`, 404);
  }
}

function normalizeCollectionNames(value, fieldName) {
  if (!Array.isArray(value)) {
    throw createHttpError(`${fieldName} must be an array of collection names.`, 400);
  }

  const names = [...new Set(value.map((name) => String(name || '').trim()).filter(Boolean))];
  if (!names.length) {
    throw createHttpError('Select at least one collection to delete.', 400);
  }
  if (names.length > MAX_COLLECTION_DELETE_COUNT) {
    throw createHttpError(`A maximum of ${MAX_COLLECTION_DELETE_COUNT} collections can be deleted at once.`, 400);
  }
  if (names.some((name) => name.startsWith('system.'))) {
    throw createHttpError('System collections cannot be deleted from Developer Monitor.', 400);
  }

  return names;
}

function normalizeCollectionName(value) {
  const collectionName = String(value || '').trim();
  if (!collectionName) throw createHttpError('Collection name is required.', 400);
  if (collectionName.startsWith('system.')) throw createHttpError('System collections cannot be managed from Developer Monitor.', 400);
  return collectionName;
}

function normalizeDocument(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw createHttpError('Document data must be a JSON object.', 400);
  }

  const { _id, ...document } = value;
  return document;
}

function toDocumentId(value) {
  const id = String(value || '').trim();
  if (!ObjectId.isValid(id)) throw createHttpError('Document ID must be a valid MongoDB ObjectId.', 400);
  return new ObjectId(id);
}

export async function getDeveloperMonitorOverview({ query = {} }) {
  const logLimit = normalizePositiveInteger(query.logLimit, 40, { min: 10, max: MAX_LOG_LIMIT });
  const masterDb = getMasterDbConnection();
  const { tenant, tenantDb, tenants } = await resolveDeveloperTenant(query.tenantId);
  const [masterDatabase, tenantDatabase] = await Promise.all([
    buildDatabaseSummary(masterDb),
    buildDatabaseSummary(tenantDb),
  ]);
  const logResult = getLogsForDate({
    date: query.logDate,
    limit: logLimit,
    level: query.logLevel,
    search: query.logSearch,
  });

  return {
    generatedAt: new Date().toISOString(),
    tenantContext: {
      botUserId: tenant.botUserId,
      tenantId: tenant.tenantId,
      tenantName: tenant.companyName,
      databaseName: tenant.databaseName,
    },
    tenants,
    logConfig: {
      directory: getLogDirectory(),
      bufferLimit: getLogBufferLimit(),
      availableCount: logResult.totalAvailable,
      returnedCount: logResult.returnedCount,
      activeLevelFilter: String(query.logLevel || '').trim().toUpperCase() || 'ALL',
      activeSearch: String(query.logSearch || '').trim(),
      activeDate: logResult.selectedDate,
      source: logResult.source,
    },
    tenantRoutingCache: getTenantCacheSnapshot(),
    masterDatabase,
    tenantDatabase,
    recentLogs: logResult.items,
  };
}

export function getDeveloperMonitorLogs({ query = {} }) {
  const logLimit = normalizePositiveInteger(query.limit, 80, { min: 10, max: MAX_LOG_LIMIT });
  const logResult = getLogsForDate({
    date: query.date ?? query.logDate,
    limit: logLimit,
    level: query.level,
    search: query.search,
    kind: query.kind,
  });

  return {
    generatedAt: new Date().toISOString(),
    limit: logLimit,
    selectedDate: logResult.selectedDate,
    source: logResult.source,
    totalAvailable: logResult.totalAvailable,
    returnedCount: logResult.returnedCount,
    items: logResult.items,
  };
}

export async function getDeveloperMonitorCollectionDocuments({
  query = {},
  scope,
  collectionName,
}) {
  const normalizedScope = String(scope || '').trim().toLowerCase();
  const normalizedCollectionName = decodeURIComponent(String(collectionName || '').trim());
  const limit = normalizePositiveInteger(query.limit, 10, { min: 1, max: MAX_DOCUMENT_LIMIT });

  if (!normalizedCollectionName) {
    throw createHttpError('Collection name is required.', 400);
  }

  const { tenantDb } = await resolveDeveloperTenant(query.tenantId);
  const db = resolveDatabaseScope(normalizedScope, tenantDb);
  await ensureCollectionExists(db, normalizedCollectionName);

  const documents = await db.collection(normalizedCollectionName)
    .find({}, { sort: { _id: -1 }, limit })
    .toArray();

  return {
    scope: normalizedScope,
    databaseName: db.databaseName,
    collectionName: normalizedCollectionName,
    limit,
    returnedCount: documents.length,
    documents: documents.map((document) => serializeDocumentValue(document)),
  };
}

export async function deleteDeveloperMonitorCollections({
  query = {},
  scope,
  collectionNames,
  confirmationNames,
}) {
  const normalizedScope = String(scope || '').trim().toLowerCase();
  const selectedNames = normalizeCollectionNames(collectionNames, 'collectionNames');
  const confirmedNames = normalizeCollectionNames(confirmationNames, 'confirmationNames');
  const selectedNameSet = new Set(selectedNames);

  if (confirmedNames.length !== selectedNames.length || confirmedNames.some((name) => !selectedNameSet.has(name))) {
    throw createHttpError('Confirmation must contain every selected collection name exactly.', 400);
  }

  const { tenantDb } = await resolveDeveloperTenant(query.tenantId);
  const db = resolveDatabaseScope(normalizedScope, tenantDb);
  await Promise.all(selectedNames.map((collectionName) => ensureCollectionExists(db, collectionName)));

  await Promise.all(selectedNames.map((collectionName) => db.collection(collectionName).drop()));

  return {
    scope: normalizedScope,
    databaseName: db.databaseName,
    deletedCollectionNames: selectedNames,
  };
}

export async function createDeveloperMonitorCollection({ query = {}, scope, collectionName }) {
  const normalizedScope = String(scope || '').trim().toLowerCase();
  const normalizedCollectionName = normalizeCollectionName(collectionName);
  const { tenantDb } = await resolveDeveloperTenant(query.tenantId);
  const db = resolveDatabaseScope(normalizedScope, tenantDb);
  const exists = await db.listCollections({ name: normalizedCollectionName }, { nameOnly: true }).hasNext();
  if (exists) throw createHttpError(`Collection "${normalizedCollectionName}" already exists.`, 409);

  await db.createCollection(normalizedCollectionName);
  return { scope: normalizedScope, databaseName: db.databaseName, collectionName: normalizedCollectionName };
}

export async function insertDeveloperMonitorDocument({ query = {}, scope, collectionName, document }) {
  const normalizedScope = String(scope || '').trim().toLowerCase();
  const normalizedCollectionName = normalizeCollectionName(collectionName);
  const { tenantDb } = await resolveDeveloperTenant(query.tenantId);
  const db = resolveDatabaseScope(normalizedScope, tenantDb);
  await ensureCollectionExists(db, normalizedCollectionName);
  const result = await db.collection(normalizedCollectionName).insertOne(normalizeDocument(document));
  return { collectionName: normalizedCollectionName, documentId: String(result.insertedId) };
}

export async function updateDeveloperMonitorDocument({ query = {}, scope, collectionName, documentId, document }) {
  const normalizedScope = String(scope || '').trim().toLowerCase();
  const normalizedCollectionName = normalizeCollectionName(collectionName);
  const { tenantDb } = await resolveDeveloperTenant(query.tenantId);
  const db = resolveDatabaseScope(normalizedScope, tenantDb);
  await ensureCollectionExists(db, normalizedCollectionName);
  const result = await db.collection(normalizedCollectionName).updateOne({ _id: toDocumentId(documentId) }, { $set: normalizeDocument(document) });
  if (!result.matchedCount) throw createHttpError('Document was not found.', 404);
  return { collectionName: normalizedCollectionName, documentId: String(documentId) };
}

export async function deleteDeveloperMonitorDocument({ query = {}, scope, collectionName, documentId }) {
  const normalizedScope = String(scope || '').trim().toLowerCase();
  const normalizedCollectionName = normalizeCollectionName(collectionName);
  const { tenantDb } = await resolveDeveloperTenant(query.tenantId);
  const db = resolveDatabaseScope(normalizedScope, tenantDb);
  await ensureCollectionExists(db, normalizedCollectionName);
  const result = await db.collection(normalizedCollectionName).deleteOne({ _id: toDocumentId(documentId) });
  if (!result.deletedCount) throw createHttpError('Document was not found.', 404);
  return { collectionName: normalizedCollectionName, documentId: String(documentId) };
}
