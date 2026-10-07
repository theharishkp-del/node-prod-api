import { END, START, StateGraph } from '@langchain/langgraph';
import { getLanggraphChatModel } from '../../config/chatModel.js';
import { createInventoryTools } from '../../tools/inventoryTools.js';
import { logger } from '../../../config/logger.js';
import { ChatState } from './chatState.js';
import { createCartActionNode } from './nodes/cartActionNode.js';
import { createComposeResponseNode } from './nodes/composeResponseNode.js';
import { createExtractOrderInputNode } from './nodes/extractOrderInputNode.js';
import { createOrderSummaryNode } from './nodes/orderSummaryNode.js';
import { createResolveProductsNode } from './nodes/resolveProductsNode.js';
import { createUnderstandRequestNode } from './nodes/understandRequestNode.js';
import { createAnswerQuestionNode } from './nodes/answerQuestionNode.js';
import { createConversationCatalogNode } from './nodes/conversationCatalogNode.js';

// Only unresolved/general questions skip inventory work. Every actionable intent
// continues through product resolution so cart actions use verified catalog facts.
function routeAfterUnderstand(state) {
  const intent = state.intent?.intent;
  const requestId = state.agentPayload?.sessionInfo?.requestId;

  logger.info('🔀 ROUTING DECISION - After Understand Node', {
    requestId,
    step: 'router_after_understand',
    intent,
    routingDecision: intent === 'conversation' || intent === 'unrelated' || (intent === 'unclear' && !state.intent?.systemUnavailable)
      ? 'resolve_conversation (load facts, then preserve workflow)'
      : intent === 'unclear'
        ? 'compose_response (clarify)'
        : 'resolve_products (process order)',
  });

  if (intent === 'conversation' || intent === 'unrelated' || (intent === 'unclear' && !state.intent?.systemUnavailable)) {
    return 'resolve_conversation';
  }

  if (intent === 'unclear') {
    return 'compose_response';
  }

  return 'resolve_products';
}

export function buildChatGraph({ tenantDb, tenant, tenantId, botUserId, checkpointer }) {
  logger.info('🏗️  BUILDING CHAT GRAPH', {
    step: 'build_chat_graph',
    tenantId,
    botUserId,
    timestamp: new Date().toISOString(),
  });

  const model = getLanggraphChatModel();
  const inventoryTools = createInventoryTools({ tenantDb, tenantId, botUserId });

  // The edge order below is the canonical chat walkthrough. The router logs each
  // completed node with the same name, so these definitions map directly to logs.
  return new StateGraph(ChatState)
    .addNode('extract_order_input', createExtractOrderInputNode({ model }))
    .addNode('understand_request', createUnderstandRequestNode({ model }))
    .addNode('answer_question', createAnswerQuestionNode({ model }))
    .addNode('resolve_conversation', createConversationCatalogNode({ inventoryTools }))
    .addNode('resolve_products', createResolveProductsNode({ inventoryTools }))
    .addNode('cart_action', createCartActionNode({ tenantDb }))
    .addNode('order_summary', createOrderSummaryNode({
      tenantDb,
      tenant: tenant || { tenantId },
      botUserId,
    }))
    .addNode('compose_response', createComposeResponseNode({ model, tenantDb }))
    .addEdge(START, 'extract_order_input')
    .addEdge('extract_order_input', 'understand_request')
    .addConditionalEdges('understand_request', routeAfterUnderstand, {
      resolve_products: 'resolve_products',
      compose_response: 'compose_response',
      resolve_conversation: 'resolve_conversation',
    })
    .addEdge('resolve_conversation', 'answer_question')
    .addEdge('answer_question', END)
    .addEdge('resolve_products', 'cart_action')
    .addEdge('cart_action', 'order_summary')
    .addEdge('order_summary', 'compose_response')
    .addEdge('compose_response', END)
    .compile({ checkpointer });
}
