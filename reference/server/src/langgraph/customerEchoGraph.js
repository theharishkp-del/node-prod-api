import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { logger } from '../config/logger.js';
import { normalizeAgentPayload, buildAgentThreadId } from './agentPayload.js';

// Lesson 1: state holds the input and the values returned by our single node.
const EchoState = Annotation.Root({
  agentPayload: Annotation(),
  reply: Annotation(),
  conversationStatus: Annotation(),
});
let compiledGraph;

// Lesson 2: a node reads state and returns only the fields it changes.
// This baseline echoes the supplied text. No model/API key is needed yet.
function echoUserMessage(state) {
  const { userMessage, sessionInfo } = state.agentPayload;
  logger.info('Customer echo graph: node executed', {
    requestId: sessionInfo.requestId,
    sessionId: sessionInfo.sessionId,
    messageLength: userMessage.length,
  });
  return { reply: userMessage, conversationStatus: 'active' };
}

// Lesson 3: compile once at startup, before Express starts listening.
// Repeated calls reuse the graph; each invoke has its own state.
export function initializeCustomerEchoGraph() {
  if (!compiledGraph) {
    compiledGraph = new StateGraph(EchoState)
      .addNode('echo_user_message', echoUserMessage)
      .addEdge(START, 'echo_user_message')
      .addEdge('echo_user_message', END)
      .compile();
    logger.info('Customer echo graph: compiled', {
      flow: 'START -> echo_user_message -> END',
    });
  }
  return compiledGraph;
}

// Lesson 4: the API invokes the compiled graph and maps state to agentResult.
// Keep this return shape compatible with the existing EO response handler.
export async function runCustomerEchoGraph({ agentPayload }) {
  if (!compiledGraph) throw new Error('Customer echo graph must be initialized before API requests.');
  const payload = normalizeAgentPayload(agentPayload);
  const requestId = payload.sessionInfo.requestId;
  const threadId = buildAgentThreadId(payload);
  const startedAt = Date.now();
  logger.info('Customer echo graph: invoke started', { requestId, threadId });
  try {
    const state = await compiledGraph.invoke({ agentPayload: payload });
    logger.info('Customer echo graph: invoke completed', {
      requestId, threadId,
      durationMs: Date.now() - startedAt,
      replyLength: state.reply.length,
      conversationStatus: state.conversationStatus,
    });
    return {
      graphType: 'echo', threadId,
      conversationStatus: state.conversationStatus,
      eoState: 'continue',
      reply: state.reply,
      intent: { intent: 'echo' },
      graphState: {},
    };
  } catch (error) {
    logger.error('Customer echo graph: invoke failed', { requestId, threadId, error: error.message });
    throw error;
  }
}
