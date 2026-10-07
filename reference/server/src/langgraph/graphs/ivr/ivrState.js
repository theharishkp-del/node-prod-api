import { Annotation } from '@langchain/langgraph';

export const IvrState = Annotation.Root({
  agentPayload: Annotation(),
  fileExtraction: Annotation(),
  intent: Annotation(),
  productResults: Annotation(),
  pendingItems: Annotation(),
  pendingDecision: Annotation(),
  pendingCartActionConfirmation: Annotation(),
  cart: Annotation(),
  cartActionResult: Annotation(),
  orderSummaryState: Annotation(),
  lastResolvedProducts: Annotation(),
  recentTurns: Annotation(),
  conversationStatus: Annotation(),
  reply: Annotation(),
});
