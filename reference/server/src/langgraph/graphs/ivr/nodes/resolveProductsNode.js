import { logger } from '../../../../config/logger.js';
import { MASTER_DATA_INVENTORY_COLLECTION } from '../../../../models/tenant/masterDataInventoryModel.js';
import {
  createResolveProductsNode as createSharedResolveProductsNode,
} from '../../chat/nodes/resolveProductsNode.js';
import { normalizeSku } from '../../../tools/inventoryTools.js';

function normalizeText(value) {
  return String(value || '').trim();
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function levenshteinDistance(left, right) {
  const a = normalizeText(left);
  const b = normalizeText(right);

  if (!a) {
    return b.length;
  }

  if (!b) {
    return a.length;
  }

  const matrix = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));

  for (let row = 0; row <= a.length; row += 1) {
    matrix[row][0] = row;
  }

  for (let column = 0; column <= b.length; column += 1) {
    matrix[0][column] = column;
  }

  for (let row = 1; row <= a.length; row += 1) {
    for (let column = 1; column <= b.length; column += 1) {
      const cost = a[row - 1] === b[column - 1] ? 0 : 1;

      matrix[row][column] = Math.min(
        matrix[row - 1][column] + 1,
        matrix[row][column - 1] + 1,
        matrix[row - 1][column - 1] + cost,
      );
    }
  }

  return matrix[a.length][b.length];
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

function scoreApproximateSkuMatch(normalizedQuery, product) {
  const normalizedCandidate = normalizeSku(product.normalizedSku || product.sku);
  const distance = levenshteinDistance(normalizedQuery, normalizedCandidate);
  const sharedPrefixLength = (() => {
    let count = 0;
    const maxLength = Math.min(normalizedQuery.length, normalizedCandidate.length);

    while (count < maxLength && normalizedQuery[count] === normalizedCandidate[count]) {
      count += 1;
    }

    return count;
  })();
  const sharedSuffixLength = (() => {
    let count = 0;
    const maxLength = Math.min(normalizedQuery.length, normalizedCandidate.length);

    while (
      count < maxLength &&
      normalizedQuery[normalizedQuery.length - 1 - count] ===
        normalizedCandidate[normalizedCandidate.length - 1 - count]
    ) {
      count += 1;
    }

    return count;
  })();

  return (sharedPrefixLength * 12) + (sharedSuffixLength * 6) - (distance * 18);
}

async function findApproximateIvrSkuMatches({
  tenantDb,
  tenantId,
  botUserId,
  skuCandidate,
  maxResults = 4,
}) {
  const normalizedCandidate = normalizeSku(skuCandidate);

  if (!tenantDb || !tenantId || normalizedCandidate.length < 4) {
    return [];
  }

  const collection = tenantDb.collection(MASTER_DATA_INVENTORY_COLLECTION);
  const baseFilter = {
    tenantId,
    ...(botUserId ? { botUserId } : {}),
    isDeleted: { $ne: true },
    isActive: { $ne: false },
  };
  const prefixLengths = [...new Set([
    Math.min(5, normalizedCandidate.length),
    Math.min(4, normalizedCandidate.length),
    Math.min(3, normalizedCandidate.length),
  ])].filter((length) => length >= 3);

  let documents = [];
  for (const prefixLength of prefixLengths) {
    documents = await collection.find({
      ...baseFilter,
      normalizedSku: {
        $regex: `^${escapeRegex(normalizedCandidate.slice(0, prefixLength))}`,
        $options: 'i',
      },
    }).limit(40).toArray();

    if (documents.length) {
      break;
    }
  }

  if (!documents.length) {
    return [];
  }

  const maxDistance = Math.max(2, Math.ceil(normalizedCandidate.length * 0.25));

  return documents
    .map(serializeProduct)
    .map((product) => ({
      product,
      distance: levenshteinDistance(normalizedCandidate, normalizeSku(product.normalizedSku || product.sku)),
      score: scoreApproximateSkuMatch(normalizedCandidate, product),
    }))
    .filter((entry) => entry.distance <= maxDistance)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.distance - right.distance;
    })
    .slice(0, maxResults)
    .map((entry) => entry.product);
}

export function createResolveProductsNode({
  inventoryTools,
  tenantDb,
  tenantId,
  botUserId,
}) {
  const baseNode = createSharedResolveProductsNode({ inventoryTools });

  return async function resolveIvrProductsNode(state) {
    const baseResult = await baseNode(state);
    const requestId = state.agentPayload?.sessionInfo?.requestId || '';
    const productResults = Array.isArray(baseResult?.productResults) ? baseResult.productResults : [];
    const recoveredResults = await Promise.all(productResults.map(async (result) => {
      const skuCandidate = normalizeText(result?.requestedItem?.skuCandidate);

      if (result?.status !== 'unmatched' || !skuCandidate) {
        return result;
      }

      const matches = await findApproximateIvrSkuMatches({
        tenantDb,
        tenantId,
        botUserId,
        skuCandidate,
      });

      if (!matches.length) {
        return result;
      }

      logger.info('IVR approximate SKU recovery applied', {
        requestId,
        skuCandidate,
        recoveredSkus: matches.map((item) => item.sku),
      });

      return {
        ...result,
        status: 'suggestions',
        matchType: 'ivr_sku_recovery',
        matches,
      };
    }));

    return {
      ...baseResult,
      productResults: recoveredResults,
    };
  };
}

export { findApproximateIvrSkuMatches };
