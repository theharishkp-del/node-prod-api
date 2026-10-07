import crypto from 'node:crypto';
import path from 'node:path';
import { ObjectId } from 'mongodb';
import xlsx from 'xlsx';
import { logger } from '../config/logger.js';
import { uploadBufferToS3 } from '../utils/s3Upload.js';
import { MASTER_DATA_INVENTORY_COLLECTION } from '../models/tenant/masterDataInventoryModel.js';

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 100;
const INVENTORY_IMPORT_HISTORY_COLLECTION = 'md_inventory_import_history';
const PRODUCTS_SHEET_NAME = 'Products';
const REQUIRED_PRODUCT_COLUMNS = [
  'Product Name',
  'SKU',
  'Category',
  'Selling Price',
  'Purchase Price',
  'Currency',
  'Quantity',
  'Active',
];
const NUMERIC_PRODUCT_COLUMNS = [
  'Width (in)',
  'Height (in)',
  'Depth (in)',
  'Selling Price',
  'Purchase Price',
  'Quantity',
  'Restock Lead Time (Days)',
  'Reorder Level',
];

function createHttpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeSku(value) {
  return normalizeText(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function normalizeWorksheetHeader(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function normalizeOptionalText(value) {
  const normalized = normalizeText(value);
  return normalized || null;
}

function normalizeRequiredText(value, fieldName) {
  const normalized = normalizeText(value);

  if (!normalized) {
    throw createHttpError(`${fieldName} is required.`);
  }

  return normalized;
}

function parseOptionalNumber(value, fieldName) {
  if (value == null || String(value).trim() === '') {
    return null;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    throw createHttpError(`${fieldName} must be a valid number.`);
  }

  return parsed;
}

function parseRequiredNumber(value, fieldName) {
  const parsed = parseOptionalNumber(value, fieldName);

  if (parsed == null) {
    throw createHttpError(`${fieldName} is required.`);
  }

  return parsed;
}

function normalizeDimensionNumber(value) {
  if (value == null || String(value).trim() === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractDimensionCandidates(value) {
  const normalized = normalizeText(value).toUpperCase();

  if (!normalized) {
    return null;
  }

  const explicitMatch = normalized.match(
    /(\d+(?:\.\d+)?)\s*(?:\"|IN|INCH|INCHES)?\s*[W]?\s*[Xx]\s*(\d+(?:\.\d+)?)\s*(?:\"|IN|INCH|INCHES)?\s*[H]?(?:\s*[Xx]\s*(\d+(?:\.\d+)?)\s*(?:\"|IN|INCH|INCHES)?\s*[D]?)?/
  );

  if (explicitMatch?.[1] && explicitMatch?.[2]) {
    return {
      width: normalizeDimensionNumber(explicitMatch[1]),
      height: normalizeDimensionNumber(explicitMatch[2]),
      depth: normalizeDimensionNumber(explicitMatch[3] || null),
    };
  }

  const compactDigits = normalized.match(/\b(\d{4}|\d{6})\b/);
  if (compactDigits?.[1]) {
    const dimensionDigits = compactDigits[1];
    if (dimensionDigits.length === 4) {
      return {
        width: normalizeDimensionNumber(dimensionDigits.slice(0, 2)),
        height: normalizeDimensionNumber(dimensionDigits.slice(2, 4)),
        depth: null,
      };
    }

    return {
      width: normalizeDimensionNumber(dimensionDigits.slice(0, 2)),
      height: normalizeDimensionNumber(dimensionDigits.slice(2, 4)),
      depth: normalizeDimensionNumber(dimensionDigits.slice(4, 6)),
    };
  }

  const skuDigits = normalized.replace(/[^0-9]/g, '');
  if (skuDigits.length >= 4) {
    if (skuDigits.length >= 6) {
      const sixDigitWindow = skuDigits.slice(0, 6);
      return {
        width: normalizeDimensionNumber(sixDigitWindow.slice(0, 2)),
        height: normalizeDimensionNumber(sixDigitWindow.slice(2, 4)),
        depth: normalizeDimensionNumber(sixDigitWindow.slice(4, 6)),
      };
    }

    const fourDigitWindow = skuDigits.slice(0, 4);
    return {
      width: normalizeDimensionNumber(fourDigitWindow.slice(0, 2)),
      height: normalizeDimensionNumber(fourDigitWindow.slice(2, 4)),
      depth: null,
    };
  }

  return null;
}

function resolveDimensions(payload = {}) {
  const explicitWidth = parseOptionalNumber(payload.width, 'width');
  const explicitHeight = parseOptionalNumber(payload.height, 'height');
  const explicitDepth = parseOptionalNumber(payload.depth, 'depth');

  if (explicitWidth != null || explicitHeight != null || explicitDepth != null) {
    return {
      width: explicitWidth,
      height: explicitHeight,
      depth: explicitDepth,
    };
  }

  const sources = [payload.sku, payload.generalSku, payload.itemName, payload.description, payload.notes];
  for (const source of sources) {
    const parsed = extractDimensionCandidates(source);
    if (parsed?.width != null || parsed?.height != null || parsed?.depth != null) {
      return parsed;
    }
  }

  return {
    width: null,
    height: null,
    depth: null,
  };
}

function buildDimensionAliases({ width, height, depth }) {
  const normalizedWidth = normalizeDimensionNumber(width);
  const normalizedHeight = normalizeDimensionNumber(height);
  const normalizedDepth = normalizeDimensionNumber(depth);

  if (normalizedWidth == null || normalizedHeight == null) {
    return {
      dimensionSignature: null,
      dimensionAliases: [],
    };
  }

  const widthText = String(normalizedWidth);
  const heightText = String(normalizedHeight);
  const depthText = normalizedDepth == null ? null : String(normalizedDepth);
  const aliases = new Set([
    `${widthText}x${heightText}`,
    `${widthText} x ${heightText}`,
    `${heightText}x${widthText}`,
    `${heightText} x ${widthText}`,
    `${widthText}${heightText}`,
    `${heightText}${widthText}`,
    `${widthText} width ${heightText} height`,
    `${heightText} height ${widthText} width`,
  ]);

  if (depthText) {
    aliases.add(`${widthText}x${heightText}x${depthText}`);
    aliases.add(`${widthText} x ${heightText} x ${depthText}`);
    aliases.add(`${widthText}${heightText}${depthText}`);
  }

  return {
    dimensionSignature: depthText ? `${widthText}x${heightText}x${depthText}` : `${widthText}x${heightText}`,
    dimensionAliases: [...aliases],
  };
}

function buildNormalizedSearchText(payload = {}, aliases = []) {
  return [
    payload.sku,
    payload.itemName,
    payload.category,
    payload.description,
    payload.finish,
    payload.generalSku,
    payload.style,
    payload.notes,
    ...aliases,
  ]
    .map((value) => normalizeOptionalText(value))
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function hasExplicitDimensionValue(value) {
  return value != null && String(value).trim() !== '';
}

function parseBoolean(value) {
  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = normalizeText(value).toLowerCase();
  return ['true', '1', 'yes', 'active'].includes(normalized);
}

function parseYesNoBoolean(value, fieldName, { required = false } = {}) {
  if (value == null || String(value).trim() === '') {
    if (required) {
      throw createHttpError(`${fieldName} is required and must be Yes or No.`);
    }

    return null;
  }

  const normalized = normalizeText(value).toLowerCase();

  if (normalized === 'yes') {
    return true;
  }

  if (normalized === 'no') {
    return false;
  }

  throw createHttpError(`${fieldName} must be Yes or No.`);
}

function toObjectId(value, fieldName = 'id') {
  const normalized = normalizeText(value);

  if (!ObjectId.isValid(normalized)) {
    throw createHttpError(`${fieldName} is not valid.`);
  }

  return new ObjectId(normalized);
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parsePagination(query = {}) {
  const page = Math.max(DEFAULT_PAGE, Number.parseInt(String(query.page || DEFAULT_PAGE), 10) || DEFAULT_PAGE);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number.parseInt(String(query.pageSize || DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE)
  );

  return {
    page,
    pageSize,
    skip: (page - 1) * pageSize,
  };
}

function buildPagedResponse(items, total, page, pageSize) {
  return {
    items,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      hasNextPage: page * pageSize < total,
      hasPreviousPage: page > 1,
    },
  };
}

function serializeDocument(document) {
  if (!document) {
    return null;
  }

  const { _id, ...rest } = document;
  return {
    id: _id?.toString(),
    ...rest,
  };
}

async function ensureInventoryIndexes(tenantDb) {
  const collection = tenantDb.collection(MASTER_DATA_INVENTORY_COLLECTION);
  const historyCollection = tenantDb.collection(INVENTORY_IMPORT_HISTORY_COLLECTION);
  await Promise.all([
    collection.createIndex({ tenantId: 1, sku: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } }),
    collection.createIndex({ tenantId: 1, normalizedSku: 1 }),
    collection.createIndex({ tenantId: 1, category: 1, updatedAt: -1 }),
    collection.createIndex({ tenantId: 1, itemName: 1 }),
    collection.createIndex({ tenantId: 1, width: 1, height: 1, depth: 1 }),
    collection.createIndex({ tenantId: 1, dimensionSignature: 1 }),
    historyCollection.createIndex({ tenantId: 1, createdAt: -1 }),
    historyCollection.createIndex({ tenantId: 1, importBatchId: 1 }, { unique: true }),
  ]);
}

function buildContext({ tenant, botUserId }) {
  return {
    tenantId: tenant?.tenantId || '',
    botUserId: String(botUserId || '').trim(),
  };
}

function buildInventoryPayload(payload, context, existingDocument = null) {
  const now = new Date();
  const dimensions = resolveDimensions(payload);
  const dimensionMetadata = buildDimensionAliases(dimensions);
  const productName = normalizeRequiredText(payload.productName ?? payload.itemName, 'productName');
  const color = normalizeOptionalText(payload.color);
  const sellingPrice = parseRequiredNumber(payload.sellingPrice ?? payload.salesPrice, 'sellingPrice');
  const quantity = parseRequiredNumber(payload.quantity ?? payload.qtyAvailable, 'quantity');
  const glassDoor = parseYesNoBoolean(payload.glassDoor, 'glassDoor');
  const active = parseYesNoBoolean(payload.active ?? payload.isActive, 'active', { required: true });
  const restockLeadTimeDays = parseOptionalNumber(
    payload.restockLeadTimeDays ?? payload.leadTimeDays,
    'restockLeadTimeDays'
  );

  return {
    tenantId: context.tenantId,
    botUserId: context.botUserId,
    sku: normalizeRequiredText(payload.sku, 'sku'),
    normalizedSku: normalizeSku(payload.sku),
    productName,
    itemName: normalizeRequiredText(payload.itemName ?? productName, 'itemName'),
    category: normalizeRequiredText(payload.category, 'category'),
    description: normalizeOptionalText(payload.description),
    color,
    finish: normalizeOptionalText(payload.finish ?? color),
    doorType: normalizeOptionalText(payload.doorType),
    glassDoor,
    sellingPrice,
    salesPrice: sellingPrice,
    currency: normalizeRequiredText(payload.currency, 'currency'),
    quantity,
    qtyAvailable: quantity,
    unit: normalizeOptionalText(payload.unit) || existingDocument?.unit || 'EA',
    generalSku: normalizeOptionalText(payload.generalSku),
    style: normalizeOptionalText(payload.style),
    width: dimensions.width,
    height: dimensions.height,
    depth: dimensions.depth,
    dimensionSignature: dimensionMetadata.dimensionSignature,
    dimensionAliases: dimensionMetadata.dimensionAliases,
    normalizedSearchText: buildNormalizedSearchText(payload, dimensionMetadata.dimensionAliases) || null,
    purchasePrice: parseOptionalNumber(payload.purchasePrice, 'purchasePrice'),
    restockLeadTimeDays,
    reorderLevel: parseOptionalNumber(payload.reorderLevel, 'reorderLevel'),
    active,
    isActive: active,
    leadTimeDays: restockLeadTimeDays,
    notes: normalizeOptionalText(payload.notes),
    sourceFileName: normalizeOptionalText(payload.sourceFileName) || existingDocument?.sourceFileName || null,
    importBatchId: normalizeOptionalText(payload.importBatchId) || existingDocument?.importBatchId || null,
    lastImportedAt: payload.lastImportedAt instanceof Date ? payload.lastImportedAt : (existingDocument?.lastImportedAt || null),
    isDeleted: false,
    createdAt: existingDocument?.createdAt || now,
    updatedAt: now,
  };
}

function buildSearchFilter(search) {
  const normalizedSearch = normalizeText(search);

  if (!normalizedSearch) {
    return null;
  }

  const regex = new RegExp(escapeRegex(normalizedSearch), 'i');

  return {
    $or: [
      { sku: regex },
      { itemName: regex },
      { category: regex },
      { generalSku: regex },
      { style: regex },
      { finish: regex },
      { dimensionSignature: regex },
      { dimensionAliases: regex },
      { normalizedSearchText: regex },
    ],
  };
}

function parseWorkbookRows(filePath) {
  const workbook = xlsx.readFile(filePath, { cellDates: false });
  const productsSheet = workbook.Sheets[PRODUCTS_SHEET_NAME];

  if (!workbook.SheetNames.length) {
    throw createHttpError('Uploaded workbook does not contain any sheets.');
  }

  if (!productsSheet) {
    throw createHttpError(`Uploaded workbook must contain a "${PRODUCTS_SHEET_NAME}" sheet.`);
  }

  return xlsx.utils.sheet_to_json(productsSheet, {
    defval: null,
    raw: true,
    blankrows: false,
  });
}

function getWorksheetValue(row, aliases) {
  const aliasSet = new Set(aliases.map((alias) => normalizeWorksheetHeader(alias)));

  for (const [key, value] of Object.entries(row || {})) {
    if (aliasSet.has(normalizeWorksheetHeader(key))) {
      return value;
    }
  }

  return null;
}

function validateRequiredProductColumns(rows = []) {
  const firstRow = rows[0] || {};
  const headers = new Set(Object.keys(firstRow).map((key) => normalizeWorksheetHeader(key)));
  const missingColumns = REQUIRED_PRODUCT_COLUMNS.filter((column) => !headers.has(normalizeWorksheetHeader(column)));

  if (missingColumns.length) {
    throw createHttpError(`Products sheet is missing required columns: ${missingColumns.join(', ')}.`);
  }
}

function validateWorkbookDuplicateSkus(rows = []) {
  const seenSkus = new Map();

  rows.forEach((row, index) => {
    const rawSku = normalizeText(getWorksheetValue(row, ['SKU']));

    if (!rawSku) {
      return;
    }

    if (seenSkus.has(rawSku)) {
      throw createHttpError(
        `Duplicate SKU "${rawSku}" found in Products sheet at rows ${seenSkus.get(rawSku)} and ${index + 2}.`
      );
    }

    seenSkus.set(rawSku, index + 2);
  });
}

function validateNumericWorksheetValue(value, fieldName) {
  if (value == null || String(value).trim() === '') {
    return;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw createHttpError(`${fieldName} must be a valid number.`);
  }
}

function validateProductRow(row) {
  for (const fieldName of NUMERIC_PRODUCT_COLUMNS) {
    validateNumericWorksheetValue(getWorksheetValue(row, [fieldName]), fieldName);
  }

  parseYesNoBoolean(getWorksheetValue(row, ['Glass Door']), 'Glass Door');
  parseYesNoBoolean(getWorksheetValue(row, ['Active']), 'Active', { required: true });
}

function mapWorksheetRowToInventoryPayload(row, sourceFileName, importBatchId) {
  validateProductRow(row);

  return {
    productName: getWorksheetValue(row, ['Product Name']),
    sku: getWorksheetValue(row, ['sku']),
    itemName: getWorksheetValue(row, ['Product Name', 'itemName', 'item name']),
    generalSku: getWorksheetValue(row, ['General SKU', 'generalSku', 'general sku']),
    description: getWorksheetValue(row, ['Description', 'description']),
    category: getWorksheetValue(row, ['category']),
    width: getWorksheetValue(row, ['Width (in)', 'width']),
    height: getWorksheetValue(row, ['Height (in)', 'height']),
    depth: getWorksheetValue(row, ['Depth (in)', 'depth']),
    style: getWorksheetValue(row, ['Style', 'style']),
    color: getWorksheetValue(row, ['Color', 'color']),
    finish: getWorksheetValue(row, ['Color', 'finish']),
    doorType: getWorksheetValue(row, ['Door Type', 'door type', 'doorType']),
    glassDoor: getWorksheetValue(row, ['Glass Door', 'glass door', 'glassDoor']),
    sellingPrice: getWorksheetValue(row, ['Selling Price', 'selling price']),
    salesPrice: getWorksheetValue(row, ['Selling Price', 'selling price', 'salesPrice', 'sales price']),
    purchasePrice: getWorksheetValue(row, ['Purchase Price', 'purchase price']),
    currency: getWorksheetValue(row, ['Currency', 'currency']),
    quantity: getWorksheetValue(row, ['Quantity', 'quantity']),
    qtyAvailable: getWorksheetValue(row, ['Quantity', 'quantity', 'qtyAvailable', 'qty available']),
    restockLeadTimeDays: getWorksheetValue(row, ['Restock Lead Time (Days)', 'restock lead time days']),
    leadTimeDays: getWorksheetValue(row, ['Restock Lead Time (Days)', 'leadTimeDays', 'lead time days']),
    reorderLevel: getWorksheetValue(row, ['Reorder Level', 'reorder level']),
    active: getWorksheetValue(row, ['Active', 'active']),
    isActive: getWorksheetValue(row, ['Active', 'active', 'isActive', 'is active']),
    unit: 'EA',
    notes: null,
    sourceFileName,
    importBatchId,
    lastImportedAt: new Date(),
  };
}

async function recordImportHistory(tenantDb, historyDocument) {
  await tenantDb.collection(INVENTORY_IMPORT_HISTORY_COLLECTION).insertOne(historyDocument);
}

function normalizeImportMode(value) {
  const normalized = normalizeText(value).toLowerCase();
  return normalized === 'replace' ? 'replace' : 'merge';
}

export async function importInventoryWorkbook({ tenantDb, tenant, botUserId, file, mode = 'merge' }) {
  if (!file) {
    throw createHttpError('Inventory file is required.');
  }

  await ensureInventoryIndexes(tenantDb);

  const context = buildContext({ tenant, botUserId });
  const importBatchId = crypto.randomUUID();
  const workbookRows = parseWorkbookRows(file.path);
  validateRequiredProductColumns(workbookRows);
  validateWorkbookDuplicateSkus(workbookRows);
  const rows = workbookRows.map((row, index) => ({
    rowNumber: index + 2,
    payload: mapWorksheetRowToInventoryPayload(row, file.originalname, importBatchId),
  }));
  const collection = tenantDb.collection(MASTER_DATA_INVENTORY_COLLECTION);
  const normalizedMode = normalizeImportMode(mode);
  const seenSkus = new Set();

  let importedCount = 0;
  let insertedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  let retiredCount = 0;
  const failures = [];
  const rowValidationErrors = [];
  const warnings = [];
  let inferredDimensionCount = 0;

  for (let index = 0; index < rows.length; index += 1) {
    const rowEntry = rows[index];
    const rowNumber = rowEntry.rowNumber || index + 2;

    try {
      const mappedRow = rowEntry.payload;

      if (!normalizeText(mappedRow.sku) || !normalizeText(mappedRow.itemName) || !normalizeText(mappedRow.category)) {
        skippedCount += 1;
        continue;
      }

      const existingDocument = await collection.findOne({
        tenantId: context.tenantId,
        sku: normalizeText(mappedRow.sku),
      });

      const payload = buildInventoryPayload(
        mappedRow,
        context,
        existingDocument
      );
      seenSkus.add(payload.sku);

      const hadExplicitDimensions = [
        mappedRow.width,
        mappedRow.height,
        mappedRow.depth,
      ].some((value) => hasExplicitDimensionValue(value));

      const hasResolvedDimensions = payload.width != null || payload.height != null || payload.depth != null;

      if (!hadExplicitDimensions && hasResolvedDimensions) {
        inferredDimensionCount += 1;
        warnings.push({
          rowNumber,
          sku: payload.sku,
          type: 'dimension_inferred',
          message: 'Width/height/depth were inferred from SKU or product text.',
        });
      }

      await collection.updateOne(
        {
          tenantId: context.tenantId,
          sku: payload.sku,
        },
        { $set: payload },
        { upsert: true }
      );

      importedCount += 1;
      if (existingDocument) {
        updatedCount += 1;
      } else {
        insertedCount += 1;
      }
    } catch (error) {
      failedCount += 1;
      const rowError = {
        rowNumber,
        sku: normalizeOptionalText(rowEntry?.payload?.sku),
        message: error.message,
      };
      failures.push(rowError);
      rowValidationErrors.push(rowError);
    }
  }

  if (normalizedMode === 'replace') {
    const replaceResult = await collection.updateMany(
      {
        tenantId: context.tenantId,
        isDeleted: { $ne: true },
        sku: { $nin: [...seenSkus] },
      },
      {
        $set: {
          isDeleted: true,
          updatedAt: new Date(),
        },
      }
    );
    retiredCount = Number(replaceResult.modifiedCount || 0);
  }

  const historyDocument = {
    tenantId: context.tenantId,
    botUserId: context.botUserId,
    importBatchId,
    sourceFileName: file.originalname,
    storedFileName: file.filename,
    relativeFilePath: path.relative(process.cwd(), file.path),
    mode: normalizedMode,
    importedCount,
    insertedCount,
    updatedCount,
    skippedCount,
    failedCount,
    retiredCount,
    inferredDimensionCount,
    failures,
    rowValidationErrors,
    warnings,
    createdAt: new Date(),
  };

  await recordImportHistory(tenantDb, historyDocument);

  logger.info('Inventory workbook imported', {
    botUserId: context.botUserId,
    tenantId: context.tenantId,
    importBatchId,
    sourceFileName: file.originalname,
    mode: normalizedMode,
    importedCount,
    insertedCount,
    updatedCount,
    skippedCount,
    failedCount,
    retiredCount,
    inferredDimensionCount,
  });

  return {
    mode: normalizedMode,
    importedCount,
    insertedCount,
    updatedCount,
    skippedCount,
    failedCount,
    retiredCount,
    inferredDimensionCount,
    failures,
    rowValidationErrors,
    warnings,
    importBatchId,
    sourceFileName: file.originalname,
    storedFileName: file.filename,
    storedFilePath: file.path,
    relativeFilePath: path.relative(process.cwd(), file.path),
    uploadedAt: new Date().toISOString(),
  };
}

export async function listInventoryProducts({ tenantDb, tenant, botUserId, query }) {
  await ensureInventoryIndexes(tenantDb);
  const context = buildContext({ tenant, botUserId });
  const filter = {
    tenantId: context.tenantId,
    isDeleted: { $ne: true },
  };

  if (normalizeText(query.category)) {
    filter.category = normalizeText(query.category);
  }

  if (normalizeText(query.status)) {
    filter.isActive = normalizeText(query.status).toLowerCase() === 'active';
  }

  const searchFilter = buildSearchFilter(query.search);
  if (searchFilter) {
    Object.assign(filter, searchFilter);
  }

  const { page, pageSize, skip } = parsePagination(query);
  const collection = tenantDb.collection(MASTER_DATA_INVENTORY_COLLECTION);
  const total = await collection.countDocuments(filter);
  const items = await collection.find(filter)
    .sort({ updatedAt: -1, createdAt: -1 })
    .skip(skip)
    .limit(pageSize)
    .toArray();

  return buildPagedResponse(items.map(serializeDocument), total, page, pageSize);
}

export async function getInventoryProductById({ tenantDb, tenant, botUserId, inventoryId }) {
  const context = buildContext({ tenant, botUserId });
  const document = await tenantDb.collection(MASTER_DATA_INVENTORY_COLLECTION).findOne({
    _id: toObjectId(inventoryId, 'inventoryId'),
    tenantId: context.tenantId,
    isDeleted: { $ne: true },
  });

  if (!document) {
    throw createHttpError('Inventory product was not found.', 404);
  }

  return serializeDocument(document);
}

export async function createInventoryProduct({ tenantDb, tenant, botUserId, payload }) {
  await ensureInventoryIndexes(tenantDb);
  const context = buildContext({ tenant, botUserId });
  const document = buildInventoryPayload(payload, context);

  try {
    const result = await tenantDb.collection(MASTER_DATA_INVENTORY_COLLECTION).insertOne(document);
    return serializeDocument({ _id: result.insertedId, ...document });
  } catch (error) {
    if (error?.code === 11000) {
      throw createHttpError('An inventory product with this SKU already exists.', 409);
    }

    throw error;
  }
}

export async function updateInventoryProduct({ tenantDb, tenant, botUserId, inventoryId, payload }) {
  const context = buildContext({ tenant, botUserId });
  const _id = toObjectId(inventoryId, 'inventoryId');
  const existingDocument = await tenantDb.collection(MASTER_DATA_INVENTORY_COLLECTION).findOne({
    _id,
    tenantId: context.tenantId,
    isDeleted: { $ne: true },
  });

  if (!existingDocument) {
    throw createHttpError('Inventory product was not found.', 404);
  }

  const document = buildInventoryPayload(payload, context, existingDocument);

  try {
    await tenantDb.collection(MASTER_DATA_INVENTORY_COLLECTION).updateOne({ _id }, { $set: document });
  } catch (error) {
    if (error?.code === 11000) {
      throw createHttpError('Another inventory product already uses this SKU.', 409);
    }

    throw error;
  }

  return getInventoryProductById({ tenantDb, tenant, botUserId, inventoryId });
}

export async function deleteInventoryProduct({ tenantDb, tenant, botUserId, inventoryId }) {
  const context = buildContext({ tenant, botUserId });
  const result = await tenantDb.collection(MASTER_DATA_INVENTORY_COLLECTION).updateOne(
    {
      _id: toObjectId(inventoryId, 'inventoryId'),
      tenantId: context.tenantId,
      isDeleted: { $ne: true },
    },
    {
      $set: {
        isDeleted: true,
        updatedAt: new Date(),
      },
    }
  );

  if (!result.matchedCount) {
    throw createHttpError('Inventory product was not found.', 404);
  }
}

export async function getInventorySummary({ tenantDb, tenant, botUserId }) {
  const context = buildContext({ tenant, botUserId });
  const collection = tenantDb.collection(MASTER_DATA_INVENTORY_COLLECTION);
  const baseFilter = {
    tenantId: context.tenantId,
    isDeleted: { $ne: true },
  };

  const historyCollection = tenantDb.collection(INVENTORY_IMPORT_HISTORY_COLLECTION);
  const [totalProducts, activeProducts, inactiveProducts, latestImportedItem, latestImportHistory] = await Promise.all([
    collection.countDocuments(baseFilter),
    collection.countDocuments({ ...baseFilter, isActive: true }),
    collection.countDocuments({ ...baseFilter, isActive: false }),
    collection.find({ ...baseFilter, lastImportedAt: { $ne: null } }).sort({ lastImportedAt: -1, updatedAt: -1 }).limit(1).next(),
    historyCollection.find({ tenantId: context.tenantId }).sort({ createdAt: -1 }).limit(1).next(),
  ]);

  return {
    totalProducts,
    activeProducts,
    inactiveProducts,
    lastImportedAt: latestImportedItem?.lastImportedAt || null,
    lastSourceFileName: latestImportedItem?.sourceFileName || null,
    lastImportMode: latestImportHistory?.mode || null,
    lastImportBatchId: latestImportHistory?.importBatchId || null,
  };
}

export async function listInventoryCategories({ tenantDb, tenant, botUserId }) {
  const context = buildContext({ tenant, botUserId });
  const categories = await tenantDb.collection(MASTER_DATA_INVENTORY_COLLECTION).distinct('category', {
    tenantId: context.tenantId,
    isDeleted: { $ne: true },
  });

  return categories
    .map((value) => normalizeText(value))
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
}

export async function listInventoryImportHistory({ tenantDb, tenant, botUserId, query = {} }) {
  const context = buildContext({ tenant, botUserId });
  const limit = Math.min(20, Math.max(1, Number.parseInt(String(query.limit || query.pageSize || 10), 10) || 10));
  const items = await tenantDb.collection(INVENTORY_IMPORT_HISTORY_COLLECTION)
    .find({ tenantId: context.tenantId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();

  return items.map((document) => ({
    id: document._id?.toString(),
    importBatchId: document.importBatchId,
    sourceFileName: document.sourceFileName,
    storedFileName: document.storedFileName,
    relativeFilePath: document.relativeFilePath,
    mode: document.mode,
    importedCount: document.importedCount,
    skippedCount: document.skippedCount,
    failedCount: document.failedCount,
    retiredCount: document.retiredCount,
    inferredDimensionCount: document.inferredDimensionCount || 0,
    failures: Array.isArray(document.failures) ? document.failures : [],
    warnings: Array.isArray(document.warnings) ? document.warnings : [],
    createdAt: document.createdAt,
  }));
}

export async function uploadInventoryProductImage({ tenantDb, tenant, botUserId, inventoryId, file }) {
  const context = buildContext({ tenant, botUserId });
  const _id = toObjectId(inventoryId, 'inventoryId');

  const existingDocument = await tenantDb.collection(MASTER_DATA_INVENTORY_COLLECTION).findOne({
    _id,
    tenantId: context.tenantId,
    isDeleted: { $ne: true },
  });

  if (!existingDocument) {
    throw createHttpError('Inventory product was not found.', 404);
  }

  if (!file?.buffer || !file?.mimetype) {
    throw createHttpError('Image file is required.', 400);
  }

  const ext = file.mimetype.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
  const fileName = `${context.tenantId}_${normalizeSku(existingDocument.sku)}_${Date.now()}.${ext}`;
  const folderName = `inventory/${context.tenantId}`;

  const s3Result = await uploadBufferToS3({
    body: file.buffer,
    fileName,
    folderName,
    contentType: file.mimetype,
    mimeType: 'image',
  });

  await tenantDb.collection(MASTER_DATA_INVENTORY_COLLECTION).updateOne(
    { _id },
    { $set: { imageUrl: s3Result.url, updatedAt: new Date() } },
  );

  logger.info('Inventory product image uploaded', {
    tenantId: context.tenantId,
    inventoryId,
    sku: existingDocument.sku,
    imageUrl: s3Result.url,
  });

  return { imageUrl: s3Result.url };
}
