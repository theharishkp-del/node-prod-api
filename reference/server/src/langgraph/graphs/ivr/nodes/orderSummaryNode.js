import { createOrderSummaryNode as createSharedOrderSummaryNode } from '../../chat/nodes/orderSummaryNode.js';

export function createOrderSummaryNode(options = {}) {
  return createSharedOrderSummaryNode(options);
}
