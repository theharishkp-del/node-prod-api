import { normalizeAgentPayload, buildAgentThreadId } from './agentPayload.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { buildChatGraph } from './graphs/chat/chatGraph.js';
import { buildIvrGraph } from './graphs/ivr/ivrGraph.js';
import { getLanggraphCheckpointer } from './persistence/mongoCheckpointer.js';

const graphCache = new Map();

function logLanggraphFlowStep({ requestId, threadId, graphType, stepNumber, stepLabel, details = {} }) {
  logger.info('LangGraph flow step', {
    requestId,
    threadId,
    graphType,
    stepNumber,
    stepLabel,
    ...details,
  });
}

// This is the execution order for a standard chat request. Keep it next to the
// router logs so a requestId can be followed like a code walkthrough in production.
const CHAT_FLOW_STEPS = Object.freeze({
  extract_order_input: 'Read an attachment when present and convert it into usable order text.',
  understand_request: 'Interpret the customer message, prior memory, and pending choices into validated intent.',
  answer_question: 'Answer a side question naturally without changing cart or order state.',
  resolve_conversation: 'Load verified catalog facts needed to answer a side question.',
  resolve_products: 'Match SKUs/descriptions against inventory and return products or suggestions.',
  cart_action: 'Apply the validated add, remove, update, or view operation to cart state.',
  order_summary: 'Create a quote summary or finalize the confirmed order and sales documents.',
  compose_response: 'Build the customer-facing message and save the turn in conversation memory.',
});

function describeFlowStep(nodeName) {
  return CHAT_FLOW_STEPS[nodeName] || 'Apply this graph state update.';
}

function buildSafeAgentPayloadLog(payload) {
  return {
    customer: {
      hasName: Boolean(payload.customerInfo?.name),
      hasEmail: Boolean(payload.customerInfo?.emailId),
      hasPhone: Boolean(payload.customerInfo?.phNumber),
    },
    database: {
      tenantId: payload.databaseInfo?.tenantId || null,
      botUserId: payload.databaseInfo?.botUserId || null,
      databaseName: payload.databaseInfo?.databaseName || null,
      collectionName: payload.databaseInfo?.collectionName || null,
    },
    session: payload.sessionInfo,
    inputType: payload.inputType,
    userMessage: payload.userMessage,
    attachments: (payload.attachments || []).map((attachment) => ({
      type: attachment.type,
      mimeType: attachment.mimeType || null,
      originalFileName: attachment.originalFileName || null,
      hasFileUrl: Boolean(attachment.fileUrl),
      hasThumbnailUrl: Boolean(attachment.thumbnailUrl),
    })),
    metadata: {
      channel: payload.metadata?.channel || null,
      fromIdPresent: Boolean(payload.metadata?.fromId),
      localDateTime: payload.metadata?.localDateTime || null,
      localTimeZone: payload.metadata?.localTimeZone || null,
    },
  };
}

function buildGraphResultLog(result) {
  return {
    stage: result.stage || null,
    activePrompt: result.activePrompt
      ? {
        type: result.activePrompt.type || null,
        expectedReply: result.activePrompt.expectedReply || null,
        itemNumbers: result.activePrompt.itemNumbers || [],
      }
      : null,
    fileExtraction: result.fileExtraction
      ? {
        status: result.fileExtraction.status || null,
        extractedItemCount: result.fileExtraction.extractedItems?.length || 0,
      }
      : null,
    intent: result.intent
      ? {
        type: result.intent.intent || null,
        action: result.intent.decisionAction || null,
        referencedItems: result.intent.referencedItems || [],
        quantities: (result.intent.items || []).map((item) => ({
          skuCandidate: item.skuCandidate || null,
          quantity: item.quantity || null,
        })),
        needsClarification: Boolean(result.intent.needsClarification),
      }
      : null,
    productResults: (result.productResults || []).map((item) => ({
      status: item.status || null,
      sku: item.selectedProduct?.sku || item.requestedItem?.skuCandidate || null,
      requestedQuantity: item.requestedItem?.quantity || null,
    })),
    cartAction: result.cartActionResult
      ? {
        actionType: result.cartActionResult.actionType || null,
        changedItems: (result.cartActionResult.changedItems || []).map((item) => ({
          sku: item.sku || null,
          quantity: item.quantity || null,
        })),
        cartItemCount: result.cartActionResult.cartSummary?.itemCount || 0,
        formattedTotal: result.cartActionResult.cartSummary?.formattedTotal || null,
      }
      : null,
    orderSummary: result.orderSummaryState
      ? {
        status: result.orderSummaryState.status || null,
        summaryVersion: result.orderSummaryState.summaryVersion || null,
      }
      : null,
  };
}

function buildGraphStateLog(state = {}) {
  return {
    stateKeys: Object.keys(state),
    recentTurnCount: state.recentTurns?.length || 0,
    recentTurns: (state.recentTurns || []).slice(-3).map((turn) => ({
      userMessage: String(turn.userMessage || turn.content || turn.message || turn.text || '').slice(0, 160),
      reply: String(turn.reply || '').slice(0, 160),
    })),
    pendingDecision: state.pendingDecision
      ? {
        type: state.pendingDecision.type || null,
        itemCount: state.pendingDecision.items?.length || 0,
        items: (state.pendingDecision.items || []).map((item) => ({
          itemNumber: item.itemNumber || null,
          sku: item.sku || item.requestedReference || null,
          requestedQuantity: item.requestedQuantity || null,
          status: item.status || null,
          optionCount: item.options?.length || 0,
        })),
      }
      : null,
    cart: state.cart
      ? {
        itemCount: state.cart.items?.length || 0,
        items: (state.cart.items || []).map((item) => ({
          sku: item.sku || null,
          quantity: item.quantity || null,
        })),
        formattedTotal: state.cart.formattedTotal || null,
      }
      : null,
    ...buildGraphResultLog(state),
    replyLength: String(state.reply || '').length,
    conversationStatus: state.conversationStatus || null,
  };
}

async function logGraphMemorySnapshot({ graph, config, requestId, threadId, phase }) {
  try {
    const snapshot = await graph.getState(config);
    logger.info('LangGraph memory state snapshot', {
      requestId,
      threadId,
      phase,
      nextNodes: snapshot.next || [],
      checkpointCreatedAt: snapshot.createdAt || null,
      memoryState: buildGraphStateLog(snapshot.values || {}),
    });
    return snapshot;
  } catch (error) {
    logger.warn('LangGraph memory state snapshot unavailable', {
      requestId,
      threadId,
      phase,
      error: error.message,
    });
    return null;
  }
}

function resolveGraphType(payload) {
  const channel = String(payload.metadata.channel || '').trim().toLowerCase();
  const conversationChannel = String(
    payload.metadata.conversationProfile?.channelType || '',
  ).trim().toLowerCase();

  return channel.includes('ivr') || conversationChannel.includes('ivr') ? 'ivr' : 'chat';
}

function resolveEOState(conversationStatus) {
  return ['order_completed', 'cancelled'].includes(conversationStatus)
    ? 'stop'
    : 'continue';
}

function appendCacheBuster(url, token) {
  const trimmedUrl = String(url || '').trim();
  const trimmedToken = String(token || '').trim();

  if (!trimmedUrl || !trimmedToken) {
    return trimmedUrl || null;
  }

  const separator = trimmedUrl.includes('?') ? '&' : '?';
  return `${trimmedUrl}${separator}v=${encodeURIComponent(trimmedToken)}`;
}

function resolveCachedGraph({
  graphType,
  tenantId,
  botUserId,
  tenantDb,
  tenant,
  checkpointer,
}) {
  const cacheKey = `${graphType}:${tenantId}:${botUserId}`;

  if (!graphCache.has(cacheKey)) {
    const builder = graphType === 'ivr' ? buildIvrGraph : buildChatGraph;
    graphCache.set(cacheKey, builder({
      tenantDb,
      tenant,
      tenantId,
      botUserId,
      checkpointer,
    }));
  }

  return graphCache.get(cacheKey);
}

function buildStructuredOrderArtifacts(orderSummaryState) {
  const artifacts = orderSummaryState?.artifacts || {};
  const paymentReferenceNumber = String(artifacts.paymentLink?.referenceNumber || '').trim();
  const summaryVersion = Number(orderSummaryState?.summaryVersion || 0);
  const quoteReferenceNumber = String(artifacts.quote?.referenceNumber || '').trim();
  const quoteLinkToken = [quoteReferenceNumber, summaryVersion].filter(Boolean).join('-');
  const invoiceReferenceNumber = String(artifacts.invoice?.referenceNumber || '').trim();
  const invoiceLinkToken = [invoiceReferenceNumber, summaryVersion].filter(Boolean).join('-');

  return {
    orderSummaryState: orderSummaryState || null,
    orderReferenceNumber: String(artifacts.coreOrder?.referenceNumber || '').trim() || null,
    workOrderId: String(artifacts.workOrder?.referenceNumber || '').trim() || null,
    quoteLink: appendCacheBuster(artifacts.quote?.url, quoteLinkToken),
    invoiceNumber: invoiceReferenceNumber || null,
    invoiceUrl: appendCacheBuster(artifacts.invoice?.url, invoiceLinkToken),
    paymentLinkId: paymentReferenceNumber || null,
    paymentLink: String(artifacts.paymentLink?.url || '').trim() || null,
  };
}

export async function runLanggraphAgent({ agentPayload, tenantDb, tenant = null, threadIdOverride = null }) {
  const startedAt = Date.now();
  const payload = normalizeAgentPayload(agentPayload);
  const graphType = resolveGraphType(payload);
  const threadId = buildAgentThreadId(payload, threadIdOverride);
  const requestId = payload.sessionInfo.requestId;
  let stepNumber = 0;

  const logStep = (stepLabel, details = {}) => {
    stepNumber += 1;
    logLanggraphFlowStep({
      requestId,
      threadId,
      graphType,
      stepNumber,
      stepLabel,
      details,
    });
  };

  logStep('step_1_payload_normalized', {
    inputType: payload.inputType,
    userMessageLength: payload.userMessage.length,
    agentPayload: buildSafeAgentPayloadLog(payload),
    flowPath: Object.entries(CHAT_FLOW_STEPS).map(([nodeName, purpose]) => ({ nodeName, purpose })),
  });

  const checkpointer = await getLanggraphCheckpointer(tenantDb);
  logStep('step_2_checkpointer_resolved', {
    databaseName: tenantDb?.databaseName || null,
  });

  const buildStartedAt = Date.now();
  const graph = resolveCachedGraph({
    graphType,
    tenantDb,
    tenant,
    tenantId: payload.databaseInfo.tenantId,
    botUserId: payload.databaseInfo.botUserId,
    checkpointer,
  });
  logStep('step_3_graph_built', {
    durationMs: Date.now() - buildStartedAt,
    graphType,
  });

  let result;
  let lastCompletedNode = null;
  const graphRunConfig = {
    configurable: { thread_id: threadId },
    runName: graphType === 'ivr' ? 'customer-order-ivr' : 'customer-order-chat',
    tags: [...new Set(['customer-order', graphType, env.nodeEnv, ...env.langsmithTags])],
    metadata: {
      environment: env.nodeEnv,
      graphType,
      inputType: payload.inputType,
      langsmithProject: env.langsmithProject,
      requestId,
      tenantId: payload.databaseInfo.tenantId,
      botUserId: payload.databaseInfo.botUserId,
    },
  };

  try {
    await logGraphMemorySnapshot({
      graph,
      config: graphRunConfig,
      requestId,
      threadId,
      phase: 'before_run',
    });
    logStep('step_4_stream_started', {
      graphRunConfig: {
        runName: graphRunConfig.runName,
        configurable: graphRunConfig.configurable,
        metadata: graphRunConfig.metadata,
      },
    });

    const stream = await graph.stream(
      { agentPayload: payload },
      { ...graphRunConfig, streamMode: 'updates' },
    );

    let streamStepNumber = 0;
    for await (const update of stream) {
      for (const [nodeName, nodeState] of Object.entries(update)) {
        lastCompletedNode = nodeName;
        streamStepNumber += 1;
        logStep(`step_5_node_${streamStepNumber}_${nodeName}`, {
          nodeName,
          stepPurpose: describeFlowStep(nodeName),
          changedStateKeys: Object.keys(nodeState || {}),
          nodeState: buildGraphStateLog(nodeState || {}),
        });
      }
    }

    const finalSnapshot = await logGraphMemorySnapshot({
      graph,
      config: graphRunConfig,
      requestId,
      threadId,
      phase: 'after_run',
    });
    result = finalSnapshot?.values;

    if (!result) {
      throw new Error('LangGraph completed without a persisted final state.');
    }
    logStep('step_6_final_state_ready', {
      conversationStatus: result.conversationStatus || null,
      intent: result.intent?.intent || null,
      replyLength: String(result.reply || '').length,
      graphResult: buildGraphResultLog(result),
    });
  } catch (error) {
    logStep('step_error_langgraph_failed', {
      lastCompletedNode,
      failedStepPurpose: describeFlowStep(lastCompletedNode),
      durationMs: Date.now() - startedAt,
      error: error.message,
      stack: error.stack,
    });
    logger.error('LangGraph request failed', {
      requestId,
      threadId,
      graphType,
      lastCompletedNode,
      failedStepPurpose: describeFlowStep(lastCompletedNode),
      durationMs: Date.now() - startedAt,
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
  const conversationStatus = result.conversationStatus || 'active';
  const eoState = resolveEOState(result.conversationStatus);

  logStep('step_7_request_completed', {
    intent: result.intent?.intent || null,
    requestedItemCount: result.intent?.items?.length || 0,
    productResultStatuses: (result.productResults || []).map((item) => item.status),
    conversationStatus,
    eoState,
    replyLength: String(result.reply || '').length,
    durationMs: Date.now() - startedAt,
  });

  logger.info('LangGraph request completed', {
    requestId,
    threadId,
    graphType,
    intent: result.intent?.intent || null,
    requestedItemCount: result.intent?.items?.length || 0,
    productResultStatuses: (result.productResults || []).map((item) => item.status),
    conversationStatus,
    eoState,
    replyLength: String(result.reply || '').length,
    graphResult: buildGraphResultLog(result),
    durationMs: Date.now() - startedAt,
  });

  return {
    graphType,
    threadId,
    conversationStatus,
    eoState,
    stage: result.stage || null,
    activePrompt: result.activePrompt || null,
    reply: result.reply,
    intent: result.intent,
    productResults: result.productResults,
    graphState: {
      stage: result.stage || null,
      activePrompt: result.activePrompt || null,
      pendingDecision: result.pendingDecision,
      pendingImageConfirmation: result.pendingImageConfirmation,
      cart: result.cart,
      orderSummaryState: result.orderSummaryState,
    },
    ...buildStructuredOrderArtifacts(result.orderSummaryState),
  };
}
