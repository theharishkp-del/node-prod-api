import { logger } from '../../../../config/logger.js';

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function selectedSkus(state) {
  const pending = (state.pendingDecision?.items || []).flatMap((item) => [
    item.sku,
    ...(item.options || []).map((option) => option.sku),
  ]);
  const cart = (state.cart?.items || []).map((item) => item.sku);
  return unique([...pending, ...cart]).slice(0, 5);
}

function requestsAlternatives(message) {
  return /\b(cheaper|less expensive|lower price|budget|alternative|similar|another option|in black|in white|available now|ready now|faster|sooner)\b/i.test(message || '');
}

function requestsAvailability(message) {
  return /\b(available|availability|in stock|ready now|lead time|how soon|when.*(?:arrive|ready))\b/i.test(message || '');
}

function requestedQuantity(message) {
  const match = String(message || '').match(/\b(?:qty|quantity)\s*(\d+)\b|\b(\d+)\s*(?:pcs?|pieces?|units?|items?|nos)\b/i);
  const quantity = Number(match?.[1] || match?.[2]);
  return Number.isInteger(quantity) && quantity > 0 ? quantity : 1;
}

function looksLikeCatalogQuestion(message) {
  return /\b(cabinet|door|drawer|panel|shelf|shaker|kitchen|bathroom|recommend|suggest|looking for|need|want|budget|cheaper|black|white|base|wall)\b/i.test(message || '');
}

// This node is read-only. It provides current catalog facts to the response
// model and never mutates inventory, cart, quote, or order data.
export function createConversationCatalogNode({ inventoryTools }) {
  return async function conversationCatalogNode(state) {
    const requestId = state.agentPayload.sessionInfo.requestId;
    const skus = selectedSkus(state);
    const message = state.agentPayload.userMessage;

    try {
      // A broad recommendation has no selected SKU yet. Search the catalog first
      // so the response can recommend real products instead of generic advice.
      if (!skus.length) {
        if (!looksLikeCatalogQuestion(message)) {
          return { conversationCatalogFacts: { products: [], alternatives: null, availability: null } };
        }

        const searches = await inventoryTools.searchProductsTool.invoke({
          searches: [{
            searchId: 'conversation-recommendation',
            rawReference: message,
            description: message,
            dimensions: null,
            sketchHints: null,
            maxResults: 3,
          }],
        });
        const products = searches.flatMap((result) => result.matches || []);
        return {
          conversationCatalogFacts: {
            products,
            alternatives: null,
            availability: null,
            recommendationSearch: true,
          },
        };
      }

      const details = skus.length > 1
        ? await inventoryTools.compareProductsTool.invoke({ skus })
        : await inventoryTools.getProductDetailsTool.invoke({ skus });
      const products = details.flatMap((result) => result.matches || []);
      const alternatives = requestsAlternatives(message)
        ? await inventoryTools.findAlternativesTool.invoke({ referenceSku: skus[0], query: message, maxResults: 3 })
        : null;
      const availability = requestsAvailability(message)
        ? await inventoryTools.checkAvailabilityTool.invoke({ sku: skus[0], quantity: requestedQuantity(message) })
        : null;

      logger.info('LangGraph conversation catalog facts resolved', {
        requestId,
        productCount: products.length,
        alternativeCount: alternatives?.alternatives?.length || 0,
        availabilityChecked: Boolean(availability),
      });
      return { conversationCatalogFacts: { products, alternatives, availability } };
    } catch (error) {
      logger.warn('LangGraph conversation catalog lookup failed', { requestId, error: error.message });
      return { conversationCatalogFacts: { products: [], alternatives: null, availability: null, error: 'catalog_unavailable' } };
    }
  };
}
