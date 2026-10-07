import { Annotation } from '@langchain/langgraph';

export const ChatState = Annotation.Root({
  agentPayload: Annotation(),
  fileExtraction: Annotation(),
  intent: Annotation(),
  productResults: Annotation(),
  pendingItems: Annotation(),
  pendingDecision: Annotation(),
  activePrompt: Annotation(),
  pendingCartActionConfirmation: Annotation(),
  pendingImageConfirmation: Annotation(),
  cart: Annotation(),
  cartActionResult: Annotation(),
  orderSummaryState: Annotation(),
  lastResolvedProducts: Annotation(),
  recentTurns: Annotation(),
  conversationSummary: Annotation(),
  conversationCatalogFacts: Annotation(),
  stage: Annotation(),
  conversationStatus: Annotation(),
  reply: Annotation(),
});
