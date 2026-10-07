import { END, START, StateGraph } from '@langchain/langgraph';
import { getLanggraphChatModel } from '../../config/chatModel.js';
import { createInventoryTools } from '../../tools/inventoryTools.js';
import { IvrState } from './ivrState.js';
import { createCartActionNode } from './nodes/cartActionNode.js';
import { createComposeResponseNode } from './nodes/composeResponseNode.js';
import { createExtractOrderInputNode } from './nodes/extractOrderInputNode.js';
import { createOrderSummaryNode } from './nodes/orderSummaryNode.js';
import { createResolveProductsNode } from './nodes/resolveProductsNode.js';
import { createUnderstandRequestNode } from './nodes/understandRequestNode.js';

function routeAfterUnderstand(state) {
  const intent = state.intent?.intent;

  if (intent === 'unrelated' || intent === 'unclear') {
    return 'compose_response';
  }

  return 'resolve_products';
}

export function buildIvrGraph({ tenantDb, tenant, tenantId, botUserId, checkpointer }) {
  const model = getLanggraphChatModel();
  const inventoryTools = createInventoryTools({ tenantDb, tenantId, botUserId });

  return new StateGraph(IvrState)
    .addNode('extract_order_input', createExtractOrderInputNode({ model }))
    .addNode('understand_request', createUnderstandRequestNode({ model }))
    .addNode('resolve_products', createResolveProductsNode({
      inventoryTools,
      tenantDb,
      tenantId,
      botUserId,
    }))
    .addNode('cart_action', createCartActionNode({ tenantDb }))
    .addNode('order_summary', createOrderSummaryNode({
      tenantDb,
      tenant: tenant || { tenantId },
      botUserId,
    }))
    .addNode('compose_response', createComposeResponseNode({ tenantDb }))
    .addEdge(START, 'extract_order_input')
    .addEdge('extract_order_input', 'understand_request')
    .addConditionalEdges('understand_request', routeAfterUnderstand, {
      resolve_products: 'resolve_products',
      compose_response: 'compose_response',
    })
    .addEdge('resolve_products', 'cart_action')
    .addEdge('cart_action', 'order_summary')
    .addEdge('order_summary', 'compose_response')
    .addEdge('compose_response', END)
    .compile({ checkpointer });
}
