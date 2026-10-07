import { logger } from '../../../../config/logger.js';
import { normalizeSku } from '../../../tools/inventoryTools.js';

function sanitizeDimensions(dimensions = null) {
  if (!dimensions || typeof dimensions !== 'object') {
    return null;
  }

  const sanitized = {
    width: null,
    height: null,
    depth: null,
  };

  for (const field of ['width', 'height', 'depth']) {
    const numericValue = Number(dimensions[field]);

    if (Number.isFinite(numericValue) && numericValue > 0) {
      sanitized[field] = numericValue;
    }
  }

  return Object.values(sanitized).some((value) => value != null) ? sanitized : null;
}

function buildSearches(items) {
  return items.map((item, index) => ({
    searchId: String(index),
    rawReference: item.rawReference,
    description: item.description || item.rawReference,
    dimensions: sanitizeDimensions(item.dimensions),
    sketchHints: item.sketchHints || null,
    maxResults: 3,
  }));
}

function normalizeText(value) {
  return String(value || '').trim();
}

function buildMergeKey(item = {}) {
  const normalizedSku = normalizeSku(item.skuCandidate);

  if (normalizedSku) {
    return `sku:${normalizedSku}`;
  }

  const normalizedDescription = normalizeText(item.description || item.rawReference).toLowerCase();
  const dimensions = item.dimensions || {};
  const dimensionKey = ['width', 'height', 'depth']
    .map((field) => Number(dimensions[field]) || 0)
    .join('x');

  if (!normalizedDescription) {
    return null;
  }

  return `search:${normalizedDescription}:${dimensionKey}`;
}

function mergeRequestedItems(items = []) {
  const mergedItems = [];
  const indexByKey = new Map();

  for (const item of items) {
    const mergeKey = buildMergeKey(item);

    if (!mergeKey || !indexByKey.has(mergeKey)) {
      if (mergeKey) {
        indexByKey.set(mergeKey, mergedItems.length);
      }
      mergedItems.push(item);
      continue;
    }

    const existingItem = mergedItems[indexByKey.get(mergeKey)];
    const existingHasQuantity = Number.isFinite(Number(existingItem.quantity)) && Number(existingItem.quantity) > 0;
    const nextHasQuantity = Number.isFinite(Number(item.quantity)) && Number(item.quantity) > 0;
    const existingQuantity = existingHasQuantity ? Number(existingItem.quantity) : 0;
    const nextQuantity = nextHasQuantity ? Number(item.quantity) : 0;

    mergedItems[indexByKey.get(mergeKey)] = {
      ...existingItem,
      quantity: existingHasQuantity || nextHasQuantity
        ? existingQuantity + nextQuantity
        : null,
      rawReference: existingItem.rawReference || item.rawReference,
      description: existingItem.description || item.description,
      sketchHints: existingItem.sketchHints || item.sketchHints || null,
    };
  }

  return mergedItems;
}

// Step 3: resolve every structured request against inventory. This node does not
// mutate the cart; it only supplies verified matches, suggestions, or misses.
export function createResolveProductsNode({ inventoryTools }) {
  return async function resolveProductsNode(state) {
    const startedAt = Date.now();
    const intent = state.intent || {};
    const requestedItems = Array.isArray(intent.items) ? intent.items : [];
    const items = mergeRequestedItems(requestedItems);
    const requestId = state.agentPayload.sessionInfo.requestId;

    logger.info('LangGraph product resolution started', {
      requestId,
      intent: intent.intent || null,
      itemCount: items.length,
      originalItemCount: requestedItems.length,
    });

    if (
      intent.intent === 'unrelated' ||
      intent.intent === 'cart_view' ||
      intent.intent === 'cart_remove' ||
      !items.length
    ) {
      logger.info('LangGraph product resolution skipped', {
        requestId,
        reason: !items.length ? 'no_items' : intent.intent,
        durationMs: Date.now() - startedAt,
      });
      return { productResults: [] };
    }

    const skuItems = items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.skuCandidate);
    const skuResults = skuItems.length
      ? await inventoryTools.findProductsBySkuTool.invoke({
        skus: skuItems.map(({ item }) => item.skuCandidate),
      })
      : [];

    logger.info('LangGraph exact SKU resolution completed', {
      requestId,
      requestedCount: skuItems.length,
      matchedCount: skuResults.filter((item) => item.status === 'matched').length,
      ambiguousCount: skuResults.filter((item) => item.status === 'ambiguous').length,
      unmatchedCount: skuResults.filter((item) => item.status === 'unmatched').length,
    });
    const resultsByIndex = new Map();

    skuItems.forEach(({ item, index }, skuResultIndex) => {
      const lookup = skuResults[skuResultIndex];
      resultsByIndex.set(index, {
        requestedItem: item,
        status: lookup?.status || 'unmatched',
        matchType: 'sku',
        matches: lookup?.matches || [],
      });
    });

    const searchEntries = items
      .map((item, index) => ({ item, index }))
      .filter(({ item, index }) => {
        const skuResult = resultsByIndex.get(index);
        return !item.skuCandidate || skuResult?.status === 'unmatched';
      });

    if (searchEntries.length) {
      const searchResults = await inventoryTools.searchProductsTool.invoke({
        searches: buildSearches(searchEntries.map(({ item }) => item)),
      });

      searchEntries.forEach(({ item, index }, searchResultIndex) => {
        const lookup = searchResults[searchResultIndex];
        resultsByIndex.set(index, {
          requestedItem: item,
          status: lookup?.status || 'unmatched',
          matchType: lookup?.matchType || 'description',
          matches: lookup?.matches || [],
        });
      });

      logger.info('LangGraph descriptive product resolution completed', {
        requestId,
        requestedCount: searchEntries.length,
        matchedCount: searchResults.filter((item) => item.status === 'matched').length,
        suggestionCount: searchResults.filter((item) => item.status === 'suggestions').length,
        unmatchedCount: searchResults.filter((item) => item.status === 'unmatched').length,
      });
    }

    const productResults = items.map((item, index) => resultsByIndex.get(index) || {
      requestedItem: item,
      status: 'unmatched',
      matchType: 'unknown',
      matches: [],
    });
    const lastResolvedProducts = productResults
      .filter((result) => result.status === 'matched' && result.matches.length === 1)
      .map((result) => result.matches[0]);

    logger.info('LangGraph product resolution completed', {
      requestId,
      resultCount: productResults.length,
      matchedCount: lastResolvedProducts.length,
      statuses: productResults.map((result) => result.status),
      durationMs: Date.now() - startedAt,
    });

    return { productResults, lastResolvedProducts };
  };
}
