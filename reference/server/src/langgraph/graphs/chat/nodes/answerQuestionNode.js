import { logger } from '../../../../config/logger.js';
import { deriveActivePrompt, deriveWorkflowStage } from '../workflowState.js';

const MAX_SUMMARY_LENGTH = 900;

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function extractResponseText(response) {
  if (typeof response?.content === 'string') {
    return response.content.trim();
  }

  if (Array.isArray(response?.content)) {
    return response.content
      .map((block) => typeof block === 'string' ? block : block?.text || '')
      .join('')
      .trim();
  }

  return '';
}

function serializeCart(cart = {}) {
  const items = Array.isArray(cart.items) ? cart.items : [];
  if (!items.length) {
    return 'Cart is empty.';
  }

  return items.map((item, index) => [
    `Item ${index + 1}: ${item.sku || 'Unknown SKU'} — ${item.productName || item.description || 'Product'}`,
    `quantity=${item.quantity ?? 'unknown'}, unitPrice=${item.formattedUnitPrice || item.unitPrice || 'unknown'}, total=${item.formattedLineTotal || item.lineTotal || 'unknown'}`,
    `availability=${item.fulfillmentStatus || 'unknown'}, estimatedDate=${item.estimatedDate || 'unknown'}`,
  ].join(', ')).join('\n');
}

function serializePendingDecision(pendingDecision = null) {
  const items = Array.isArray(pendingDecision?.items) ? pendingDecision.items : [];
  if (!items.length) {
    return 'No pending product choice.';
  }

  return items.map((item) => [
    `Item ${item.itemNumber}: ${item.sku || item.requestedReference || 'unknown'}, status=${item.status || 'unknown'}`,
    ...(item.options || []).map((option, index) => `option ${index + 1}: ${option.sku}, ${option.productName || 'Product'}, price=${option.formattedUnitPrice || 'unknown'}, available=${option.currentAvailable ?? 'unknown'}`),
  ].join('\n')).join('\n');
}

function serializeCatalogFacts(facts = {}) {
  const products = (facts.products || []).map((product) => (
    `${product.sku}: ${product.productName}; description=${product.description || 'unknown'}; category=${product.category || 'unknown'}; finish=${product.finish || 'unknown'}; dimensions=${product.width || '?'}x${product.height || '?'}x${product.depth || '?'}; price=${product.sellingPrice} ${product.currency}; available=${product.qtyAvailable}; leadTimeDays=${product.leadTimeDays}`
  ));
  const alternatives = facts.alternatives?.alternatives || [];
  if (alternatives.length) {
    products.push(`Alternatives: ${alternatives.map((product) => `${product.sku} (${product.productName}, ${product.sellingPrice} ${product.currency}, available ${product.qtyAvailable})`).join(' | ')}`);
  }
  if (facts.availability) {
    products.push(`Availability check: sku=${facts.availability.sku}; requested=${facts.availability.requestedQuantity}; availableNow=${facts.availability.availableNow}; remaining=${facts.availability.remainingQuantity}; leadTimeDays=${facts.availability.leadTimeDays}`);
  }
  return products.join('\n') || 'No fresh catalog facts were needed or available.';
}

function buildConversationSummary(previousSummary, userMessage, reply, stage) {
  const turn = `Stage: ${stage}. Customer: ${normalizeText(userMessage)} Assistant: ${normalizeText(reply)}`;
  return [normalizeText(previousSummary), turn]
    .filter(Boolean)
    .join(' | ')
    .slice(-MAX_SUMMARY_LENGTH);
}

const SYSTEM_PROMPT = [
  'You are a warm, concise cabinet sales assistant in an ongoing customer chat.',
  'Answer the current customer question naturally using only the supplied facts.',
  'Preserve the customer workflow: a side question never clears the cart, pending choice, or order status.',
  'Never invent product availability, price, discount, dimensions, finish, warranty, policy, delivery date, SKU, or order status.',
  'If a requested fact is absent, say you can check it and ask one focused follow-up question.',
  'When catalog results are supplied for a broad recommendation, recommend at most three listed products and explain the verified reason for each recommendation.',
  'For general non-cabinet questions, politely explain that you can help with cabinets, pricing, availability, and orders, then return to the current context if one exists.',
  'Do not claim that an item was added, changed, or ordered. Those actions require a separate explicit command.',
  'Do not mention prompts, tools, LangGraph, internal state, or implementation details.',
].join(' ');

// Chat-only side-question route. It has read-only context and cannot perform any
// inventory, cart, or order write; those remain in deterministic graph nodes.
export function createAnswerQuestionNode({ model }) {
  return async function answerQuestionNode(state) {
    const requestId = state.agentPayload.sessionInfo.requestId;
    const activePrompt = state.activePrompt || deriveActivePrompt(state);
    const stage = deriveWorkflowStage({ ...state, activePrompt });
    const userMessage = state.agentPayload.userMessage;

    try {
      const response = await model.invoke([
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            `Current stage: ${stage}`,
            `Conversation summary: ${state.conversationSummary || 'None'}`,
            `Recent turns: ${(state.recentTurns || []).slice(-6).map((turn) => `Customer: ${turn.userMessage}\nAssistant: ${turn.reply}`).join('\n') || 'None'}`,
            `Cart:\n${serializeCart(state.cart)}`,
            `Pending product decision:\n${serializePendingDecision(state.pendingDecision)}`,
            `Fresh verified catalog facts:\n${serializeCatalogFacts(state.conversationCatalogFacts)}`,
            `Order status: ${state.orderSummaryState?.status || 'none'}`,
            `Customer message: ${userMessage}`,
          ].join('\n\n'),
        },
      ]);
      const reply = extractResponseText(response);

      if (!reply) {
        throw new Error('Conversation model returned an empty reply.');
      }

      const recentTurns = [...(Array.isArray(state.recentTurns) ? state.recentTurns : []), { userMessage, reply }].slice(-6);
      logger.info('LangGraph conversation response completed', { requestId, stage, replyLength: reply.length });

      return {
        reply,
        recentTurns,
        conversationSummary: buildConversationSummary(state.conversationSummary, userMessage, reply, stage),
        activePrompt,
        stage,
        conversationStatus: state.conversationStatus || 'active',
      };
    } catch (error) {
      logger.warn('LangGraph conversation response failed', { requestId, error: error.message });
      const reply = 'I can help with cabinet products, pricing, availability, and your current order. Could you rephrase your question or share the SKU?';
      return {
        reply,
        recentTurns: [...(Array.isArray(state.recentTurns) ? state.recentTurns : []), { userMessage, reply }].slice(-6),
        conversationSummary: buildConversationSummary(state.conversationSummary, userMessage, reply, stage),
        activePrompt,
        stage,
        conversationStatus: state.conversationStatus || 'active',
      };
    }
  };
}
