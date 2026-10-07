import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { MASTER_DATA_INVENTORY_COLLECTION } from '../../models/tenant/masterDataInventoryModel.js';
import { logger } from '../../config/logger.js';

const MAX_SKU_BATCH_SIZE = 25;
const MAX_SEARCH_BATCH_SIZE = 25;

function normalizeText(value) {
  return String(value || '').trim();
}

export function normalizeSku(value) {
  return normalizeText(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function buildSeparatorTolerantSkuRegex(value) {
  const normalizedSku = normalizeSku(value);

  if (!normalizedSku) {
    return null;
  }

  return new RegExp(`^${normalizedSku.split('').join('[^A-Z0-9]*')}$`, 'i');
}

function serializeProduct(document) {
  return {
    id: document._id?.toString?.() || null,
    sku: normalizeText(document.sku),
    normalizedSku: normalizeSku(document.normalizedSku || document.sku),
    productName: normalizeText(document.productName || document.itemName),
    category: normalizeText(document.category),
    description: normalizeText(document.description),
    style: normalizeText(document.style),
    finish: normalizeText(document.finish || document.color),
    doorType: normalizeText(document.doorType),
    glassDoor: Boolean(document.glassDoor),
    width: document.width ?? null,
    height: document.height ?? null,
    depth: document.depth ?? null,
    sellingPrice: Number(document.sellingPrice ?? document.salesPrice ?? 0),
    currency: normalizeText(document.currency) || 'USD',
    qtyAvailable: Number(document.qtyAvailable ?? document.quantity ?? 0),
    unit: normalizeText(document.unit) || 'EA',
    leadTimeDays: Number(document.leadTimeDays ?? document.restockLeadTimeDays ?? 0),
  };
}

function buildInventoryFilter({ tenantId, botUserId }) {
  return {
    tenantId,
    ...(botUserId ? { botUserId } : {}),
    isDeleted: { $ne: true },
    isActive: { $ne: false },
  };
}

function tokenizeSearchText(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 2)
    .slice(0, 10);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasDimension(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function scoreProduct(product, searchItem) {
  const searchableText = [
    product.sku,
    product.productName,
    product.category,
    product.description,
    product.style,
    product.finish,
  ].join(' ').toLowerCase();
  const tokens = tokenizeSearchText(searchItem.description || searchItem.rawReference);
  const tokenScore = tokens.reduce(
    (score, token) => score + (searchableText.includes(token) ? 8 : 0),
    0,
  );
  const glassDoorPreference = tokens.includes('glass') && tokens.includes('door') && searchableText.includes('glass') && searchableText.includes('door')
    ? 30
    : 0;
  const sketchHints = searchItem.sketchHints || {};
  const sketchHintScore = [
    sketchHints.cabinetType && searchableText.includes(String(sketchHints.cabinetType).toLowerCase()) ? 18 : 0,
    sketchHints.doorStyle && searchableText.includes(String(sketchHints.doorStyle).toLowerCase()) ? 28 : 0,
    Number(sketchHints.doorCount) >= 2 && /\bdouble\b|\b2 door\b|\btwo door\b/.test(searchableText) ? 22 : 0,
    Number(sketchHints.doorCount) === 1 && /\bsingle\b|\b1 door\b|\bone door\b/.test(searchableText) ? 14 : 0,
    Number(sketchHints.sectionCount) >= 2 && /\b2 section\b|\btwo section\b/.test(searchableText) ? 18 : 0,
    Number(sketchHints.sectionWidth) > 0 && searchableText.includes(`${Number(sketchHints.sectionWidth)}`) ? 10 : 0,
    sketchHints.doorStyle && /glass/i.test(String(sketchHints.doorStyle)) && product.glassDoor ? 26 : 0,
  ].reduce((sum, value) => sum + value, 0);
  const dimensions = searchItem.dimensions || {};
  const dimensionPairs = [
    ['width', dimensions.width],
    ['height', dimensions.height],
    ['depth', dimensions.depth],
  ].filter(([, value]) => hasDimension(value));
  const exactDimensionScore = dimensionPairs.reduce(
    (score, [field, value]) => score + (Number(product[field]) === Number(value) ? 25 : 0),
    0,
  );
  const distancePenalty = dimensionPairs.reduce((penalty, [field, value]) => {
    if (!hasDimension(product[field])) {
      return penalty + 30;
    }

    return penalty + Math.abs(Number(product[field]) - Number(value));
  }, 0);

  return tokenScore + glassDoorPreference + sketchHintScore + exactDimensionScore - distancePenalty;
}

async function findProductsBySku({ collection, baseFilter, skus }) {
  const requests = skus.map((sku) => ({
    query: normalizeText(sku),
    normalizedSku: normalizeSku(sku),
  })).filter((entry) => entry.normalizedSku);
  const uniqueNormalizedSkus = [...new Set(requests.map((entry) => entry.normalizedSku))];
  const normalizedMatches = await collection.find({
    ...baseFilter,
    normalizedSku: { $in: uniqueNormalizedSkus },
  }).limit(MAX_SKU_BATCH_SIZE * 4).toArray();
  const foundNormalizedSkus = new Set(normalizedMatches.map((item) => normalizeSku(item.sku)));
  const missingSkus = uniqueNormalizedSkus.filter((sku) => !foundNormalizedSkus.has(sku));
  const fallbackMatches = missingSkus.length
    ? await collection.find({
      ...baseFilter,
      $or: missingSkus.map((sku) => ({ sku: buildSeparatorTolerantSkuRegex(sku) })),
    }).limit(MAX_SKU_BATCH_SIZE * 4).toArray()
    : [];
  const products = [...normalizedMatches, ...fallbackMatches].map(serializeProduct);

  return requests.map((request) => {
    const matches = products.filter((product) => product.normalizedSku === request.normalizedSku);

    return {
      ...request,
      status: matches.length === 1 ? 'matched' : matches.length > 1 ? 'ambiguous' : 'unmatched',
      matches,
    };
  });
}

function buildExactDimensionFilter(dimensions = {}) {
  return Object.fromEntries(
    Object.entries(dimensions)
      .filter(([, value]) => hasDimension(value))
      .map(([field, value]) => [field, Number(value)]),
  );
}

function buildPartialDimensionFilter(dimensions = {}) {
  const entries = Object.entries(dimensions)
    .filter(([, value]) => hasDimension(value))
    .map(([field, value]) => ({ [field]: Number(value) }));

  if (!entries.length) {
    return null;
  }

  return entries.length === 1 ? entries[0] : { $or: entries };
}

async function searchOneProduct({ collection, baseFilter, searchItem }) {
  const exactDimensions = buildExactDimensionFilter(searchItem.dimensions || {});
  const partialDimensions = buildPartialDimensionFilter(searchItem.dimensions || {});
  const tokens = tokenizeSearchText(searchItem.description || searchItem.rawReference);
  const textFilters = tokens.slice(0, 4).map((token) => ({
    normalizedSearchText: new RegExp(escapeRegex(token), 'i'),
  }));
  const exactFilter = {
    ...baseFilter,
    ...exactDimensions,
    ...(textFilters.length ? { $and: textFilters } : {}),
  };
  let documents = await collection.find(exactFilter).limit(60).toArray();
  let matchType = Object.keys(exactDimensions).length ? 'exact_dimensions' : 'description';

  if (!documents.length && Object.keys(exactDimensions).length && textFilters.length) {
    const dimensionsOnlyFilter = {
      ...baseFilter,
      ...exactDimensions,
    };
    documents = await collection.find(dimensionsOnlyFilter).limit(60).toArray();
    matchType = 'exact_dimensions_only';
  }

  if (!documents.length && partialDimensions) {
    const nearbyDimensionFilter = {
      ...baseFilter,
      ...partialDimensions,
      ...(textFilters.length ? { $and: textFilters.slice(0, 2) } : {}),
    };
    documents = await collection.find(nearbyDimensionFilter).limit(100).toArray();
    matchType = 'nearby_dimensions';
  }

  if (!documents.length && Object.keys(exactDimensions).length) {
    const broadFilter = {
      ...baseFilter,
      ...(textFilters.length ? { $and: textFilters.slice(0, 2) } : {}),
    };
    documents = await collection.find(broadFilter).limit(100).toArray();
    matchType = 'nearby';
  }

  if (!documents.length && partialDimensions) {
    const fallbackDimensionFilter = {
      ...baseFilter,
      ...partialDimensions,
    };
    documents = await collection.find(fallbackDimensionFilter).limit(100).toArray();
    matchType = 'nearby_dimensions_only';
  }

  const maxResults = Math.min(Math.max(Number(searchItem.maxResults || 3), 1), 5);
  const matches = documents
    .map(serializeProduct)
    .map((product) => ({ product, score: scoreProduct(product, searchItem) }))
    .sort((left, right) => right.score - left.score)
    .slice(0, maxResults)
    .map(({ product }) => product);

  return {
    searchId: searchItem.searchId,
    rawReference: searchItem.rawReference,
    status: matches.length === 1 ? 'matched' : matches.length > 1 ? 'suggestions' : 'unmatched',
    matchType,
    matches,
  };
}

function extractFinishPreference(query = '') {
  const match = normalizeText(query).toLowerCase().match(/\b(white|black|gray|grey|brown|blue|green|natural)\b/);
  return match ? match[1] : null;
}

function wantsAvailableSoon(query = '') {
  return /\b(in stock|available now|ready now|faster|sooner|quick(?:er)? delivery)\b/i.test(query);
}

function wantsCheaper(query = '') {
  return /\b(cheaper|less expensive|lower price|budget)\b/i.test(query);
}

async function findAlternatives({ collection, baseFilter, referenceSku, query, maxResults }) {
  const referenceResult = await findProductsBySku({ collection, baseFilter, skus: [referenceSku] });
  const referenceProduct = referenceResult[0]?.matches?.[0] || null;
  const preferredFinish = extractFinishPreference(query);
  const cheaperOnly = wantsCheaper(query);
  const availableSoonOnly = wantsAvailableSoon(query);
  const candidateFilter = {
    ...baseFilter,
    ...(referenceProduct?.category ? { category: referenceProduct.category } : {}),
    ...(referenceProduct?.sku ? { normalizedSku: { $ne: referenceProduct.normalizedSku } } : {}),
    ...(preferredFinish ? { normalizedSearchText: new RegExp(escapeRegex(preferredFinish), 'i') } : {}),
  };
  const candidates = (await collection.find(candidateFilter).limit(100).toArray())
    .map(serializeProduct)
    .filter((product) => !cheaperOnly || !referenceProduct || product.sellingPrice <= referenceProduct.sellingPrice)
    .filter((product) => !availableSoonOnly || product.qtyAvailable > 0)
    .map((product) => ({
      product,
      score: scoreProduct(product, {
        rawReference: query,
        description: [referenceProduct?.category, referenceProduct?.productName, query].filter(Boolean).join(' '),
        dimensions: referenceProduct
          ? { width: referenceProduct.width, height: referenceProduct.height, depth: referenceProduct.depth }
          : null,
      }),
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, maxResults)
    .map(({ product }) => product);

  return {
    referenceProduct,
    criteria: { preferredFinish, cheaperOnly, availableSoonOnly },
    alternatives: candidates,
  };
}

export function createInventoryTools({ tenantDb, tenantId, botUserId }) {
  if (!tenantDb) {
    throw new Error('tenantDb is required to create inventory tools.');
  }

  const collection = tenantDb.collection(MASTER_DATA_INVENTORY_COLLECTION);
  const baseFilter = buildInventoryFilter({ tenantId, botUserId });

  const findProductsBySkuTool = tool(
    async ({ skus }) => {
      const startedAt = Date.now();
      logger.info('LangGraph inventory exact SKU tool started', {
        tenantId,
        botUserId,
        requestedCount: skus.length,
      });
      const results = await findProductsBySku({ collection, baseFilter, skus });
      logger.info('LangGraph inventory exact SKU tool completed', {
        tenantId,
        botUserId,
        requestedCount: skus.length,
        statuses: results.map((result) => result.status),
        durationMs: Date.now() - startedAt,
      });
      return results;
    },
    {
      name: 'find_products_by_sku',
      description: 'Find one or many inventory products by exact SKU while ignoring case, spaces, and special separators.',
      schema: z.object({
        skus: z.array(z.string().trim().min(1)).min(1).max(MAX_SKU_BATCH_SIZE),
      }),
    },
  );

  const searchProductsTool = tool(
    async ({ searches }) => {
      const startedAt = Date.now();
      logger.info('LangGraph inventory descriptive search tool started', {
        tenantId,
        botUserId,
        requestedCount: searches.length,
        withDimensionsCount: searches.filter((item) => item.dimensions).length,
      });
      const results = await Promise.all(searches.map((searchItem) => searchOneProduct({
        collection,
        baseFilter,
        searchItem,
      })));
      logger.info('LangGraph inventory descriptive search tool completed', {
        tenantId,
        botUserId,
        requestedCount: searches.length,
        statuses: results.map((result) => result.status),
        durationMs: Date.now() - startedAt,
      });
      return results;
    },
    {
      name: 'search_products',
      description: 'Search inventory by product description and exact width, height, or depth, returning nearby options if needed.',
      schema: z.object({
        searches: z.array(z.object({
          searchId: z.string().trim().min(1),
          rawReference: z.string().trim().min(1),
          description: z.string().trim().nullable(),
          dimensions: z.object({
            width: z.number().positive().nullable(),
            height: z.number().positive().nullable(),
            depth: z.number().positive().nullable(),
          }).nullable(),
          sketchHints: z.object({
            cabinetType: z.string().trim().nullable(),
            doorStyle: z.string().trim().nullable(),
            doorCount: z.number().int().positive().nullable(),
            sectionCount: z.number().int().positive().nullable(),
            sectionWidth: z.number().positive().nullable(),
            notes: z.array(z.string().trim().min(1)).default([]),
          }).nullable().optional(),
          maxResults: z.number().int().min(1).max(5).default(3),
        })).min(1).max(MAX_SEARCH_BATCH_SIZE),
      }),
    },
  );

  const getProductDetailsTool = tool(
    async ({ skus }) => findProductsBySku({ collection, baseFilter, skus }),
    {
      name: 'get_product_details',
      description: 'Return verified catalog details for selected product SKUs, including dimensions, finish, price, stock, and lead time.',
      schema: z.object({
        skus: z.array(z.string().trim().min(1)).min(1).max(10),
      }),
    },
  );

  const compareProductsTool = tool(
    async ({ skus }) => findProductsBySku({ collection, baseFilter, skus }),
    {
      name: 'compare_products',
      description: 'Return verified details for two to five SKUs so the response layer can compare them.',
      schema: z.object({
        skus: z.array(z.string().trim().min(1)).min(2).max(5),
      }),
    },
  );

  const findAlternativesTool = tool(
    async ({ referenceSku, query, maxResults = 3 }) => findAlternatives({
      collection,
      baseFilter,
      referenceSku,
      query,
      maxResults,
    }),
    {
      name: 'find_alternatives',
      description: 'Find catalog alternatives to a selected SKU using a customer request such as cheaper, a finish preference, or available sooner.',
      schema: z.object({
        referenceSku: z.string().trim().min(1),
        query: z.string().trim().min(1).max(500),
        maxResults: z.number().int().min(1).max(5).default(3),
      }),
    },
  );

  const checkAvailabilityTool = tool(
    async ({ sku, quantity }) => {
      const result = (await findProductsBySku({ collection, baseFilter, skus: [sku] }))[0];
      const product = result?.matches?.length === 1 ? result.matches[0] : null;
      if (!product) {
        return { status: result?.status || 'unmatched', sku, product: null };
      }

      const requestedQuantity = Number(quantity);
      const availableNow = Math.max(0, product.qtyAvailable);
      return {
        status: 'matched',
        sku: product.sku,
        product,
        requestedQuantity,
        availableNow: Math.min(availableNow, requestedQuantity),
        remainingQuantity: Math.max(0, requestedQuantity - availableNow),
        leadTimeDays: product.leadTimeDays,
      };
    },
    {
      name: 'check_availability',
      description: 'Check verified current availability and lead time for a requested quantity of one SKU.',
      schema: z.object({
        sku: z.string().trim().min(1),
        quantity: z.number().int().positive().max(1000),
      }),
    },
  );

  return {
    findProductsBySkuTool,
    searchProductsTool,
    getProductDetailsTool,
    compareProductsTool,
    findAlternativesTool,
    checkAvailabilityTool,
  };
}
