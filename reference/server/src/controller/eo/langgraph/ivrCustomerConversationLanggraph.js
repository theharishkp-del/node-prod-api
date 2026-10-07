import { logger } from '../../../config/logger.js';
import { env } from '../../../config/env.js';
import { runLanggraphAgent } from '../../../langgraph/router.js';
import {
  buildConversationAgentPayload,
  ensureCustomerForConversation,
} from '../../../services/customerConversationService.js';
import {
  sendMailBridgeAssistantLinkSmsOnce,
  sendTransactionalSmsOnce,
} from '../../../services/widgetAssistantLinkService.js';
import { buildStandardEOIvrTextResponse } from '../handlers/standardEOShared.js';
import { resolveEOFileNameByMimeType } from '../../../utils/standardEO.js';
import { handleStandardEOCustomerOrderLanggraph } from './customerOrderRequestLanggraph.js';
import { interruptIvrCallAndContinueViaWidget } from '../../../services/ivrCallService.js';

const MULTIPLE_ORDER_LINK_MESSAGE =
  'The link will be sent via SMS. Kindly click the link to place your multiple product order. Thank you for choosing our service.';

function normalizeText(value) {
  return String(value || '').trim();
}

function scoreIvrMessageCandidate(value) {
  const text = normalizeText(value);

  if (!text) {
    return Number.NEGATIVE_INFINITY;
  }

  let score = 0;
  const compactText = text.replace(/\s+/g, ' ');

  if (/[A-Za-z]/.test(compactText) && /\d/.test(compactText)) {
    score += 30;
  }

  if (/[A-Za-z]\d|\d[A-Za-z]/.test(compactText)) {
    score += 25;
  }

  if (/\b(?:qty|quantity)\b/i.test(compactText)) {
    score += 12;
  }

  if (/[-/]/.test(compactText)) {
    score += 8;
  }

  if (compactText.length <= 40) {
    score += 8;
  }

  if (/\b(?:uh|um|ah)\b/i.test(compactText)) {
    score -= 10;
  }

  if (/\bto\b/i.test(compactText) && /\b[a-z]\d/i.test(compactText.toLowerCase())) {
    score -= 6;
  }

  return score;
}

function cleanupIvrUserMessage(value) {
  const normalized = normalizeText(value);
  const [messagePart, quantityPart] = normalized.split(/\b(?=(?:qty|quantity)\b)/i);
  const compactSkuPart = messagePart
    .replace(/(?<=[A-Za-z0-9])[\s.,]+(?=[A-Za-z0-9])/g, '')
    .toUpperCase();

  return `${compactSkuPart}${quantityPart ? quantityPart : ''}`
    .replace(/\s+/g, ' ')
    .replace(/\s+,/g, ',')
    .replace(/\s+\./g, '.');
}

export function resolveIvrUserQuestion(req) {
  const reqMessageObj = req.body?.reqMessageObj ?? {};
  const context = req.body?.context ?? {};
  const candidates = [
    String(context.apiAnswer || ''),
    String(reqMessageObj.intentObj?.value || ''),
    String(context.englishTranslation || ''),
    String(reqMessageObj.intentObj?.englishTranslation || ''),
    String(
    resolveEOFileNameByMimeType(reqMessageObj.fileName, reqMessageObj.mimeType) || '',
    ),
  ]
    .map((value, index) => ({
      value: cleanupIvrUserMessage(value),
      index,
    }))
    .filter((entry) => entry.value);

  if (!candidates.length) {
    return '';
  }

  candidates.sort((left, right) => {
    const scoreDifference =
      scoreIvrMessageCandidate(right.value) - scoreIvrMessageCandidate(left.value);

    if (scoreDifference !== 0) {
      return scoreDifference;
    }

    return left.index - right.index;
  });

  return candidates[0].value;
}

function resolveConversationSessionId(req) {
  return String(req.body?.sessionDate || req.sessionDate || '').trim();
}

function normalizeIvrDateTime(value) {
  const normalized = String(value || '').trim();

  if (!normalized) {
    return '';
  }

  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(normalized)) {
    return normalized.replace(' ', 'T');
  }

  return normalized;
}

export function resolveLocalDateTime(req) {
  const reqMessageObj = req.body?.reqMessageObj ?? {};

  return normalizeIvrDateTime(
    reqMessageObj.localDateTime ||
    req.body?.localDateTime ||
    req.body?.sessionDate ||
    req.sessionDate ||
    '',
  );
}

export function resolveLocalTimeZone(req) {
  const reqMessageObj = req.body?.reqMessageObj ?? {};
  return String(reqMessageObj.localTimeZone || req.body?.localTimeZone || 'Asia/Kolkata').trim();
}

function buildIvrConversationMetadata(mode) {
  return {
    channel: 'ivr',
    conversationProfile: {
      channelType: 'ivr',
      mode,
    },
  };
}

export function isWidgetChatContinuationRequest(req) {
  const reqMessageObj = req.body?.reqMessageObj ?? {};
  const requestType = normalizeText(reqMessageObj.requestType).toLowerCase();
  const fromEmail = normalizeText(reqMessageObj.fromEmail);
  const deviceId = normalizeText(reqMessageObj.deviceId);
  const hasChatIdentity = Boolean(
    fromEmail ||
    (requestType === 'taskconversation' && deviceId),
  );
  const hasVoiceMarkers = Boolean(
    normalizeText(reqMessageObj.channel).toLowerCase() === 'voice' ||
    normalizeText(reqMessageObj.botMobNo) ||
    normalizeText(reqMessageObj.userMobNo) ||
    normalizeText(reqMessageObj.callSId)
  );

  return hasChatIdentity && !hasVoiceMarkers;
}

function resolveConfirmationSource(req) {
  return isWidgetChatContinuationRequest(req) ? 'widget_chat' : 'ivr';
}

function isMultipleProductLinkRequest(userMessage) {
  return normalizeText(userMessage) === '6';
}

function buildIvrOrderSummarySmsText(agentResult) {
  const summary = agentResult?.orderSummaryState?.summary || { lines: [], formattedTotal: '$0.00' };
  const lines = [
    'Order summary',
    ...summary.lines.flatMap((item, index) => {
      const statusText =
        item.fulfillmentStatus === 'ready_now'
          ? 'ready now'
          : item.estimatedDate
            ? `scheduled for ${item.estimatedDate}`
            : 'pending confirmation';
      return [
        `${item.itemNumber}. ${item.sku} qty ${item.quantity} ${item.formattedLineTotal} (${statusText})`,
        ...(index < summary.lines.length - 1 ? [''] : []),
      ];
    }),
    `Order total: ${summary.formattedTotal}`,
  ];

  if (normalizeText(agentResult?.quoteLink)) {
    lines.push(`Quote: ${agentResult.quoteLink}`);
  }

  return lines.join('\n');
}

function buildIvrOrderConfirmationSmsText(agentResult) {
  const orderReferenceNumber =
    normalizeText(agentResult?.orderReferenceNumber) ||
    normalizeText(agentResult?.orderSummaryState?.artifacts?.coreOrder?.referenceNumber);
  const invoiceReferenceNumber = normalizeText(
    agentResult?.orderSummaryState?.artifacts?.invoice?.referenceNumber,
  );
  const paymentReferenceNumber = normalizeText(
    agentResult?.orderSummaryState?.artifacts?.paymentLink?.referenceNumber,
  );
  const lines = ['Your order is confirmed.'];

  if (orderReferenceNumber) {
    lines.push(`Order reference number: ${orderReferenceNumber}`);
  }

  if (invoiceReferenceNumber) {
    lines.push(`Invoice number: ${invoiceReferenceNumber}`);
  }

  if (normalizeText(agentResult?.invoiceUrl)) {
    lines.push(`Invoice: ${agentResult.invoiceUrl}`);
  }

  if (paymentReferenceNumber) {
    lines.push(`Payment reference: ${paymentReferenceNumber}`);
  }

  if (normalizeText(agentResult?.paymentLink)) {
    lines.push(`Payment link: ${agentResult.paymentLink}`);
  }

  return lines.join('\n');
}

function buildWidgetChatContinuationReply(agentResult) {
  if (agentResult?.conversationStatus === 'order_completed') {
    return buildIvrOrderConfirmationSmsText(agentResult);
  }

  if (
    agentResult?.intent?.intent === 'order_summary' &&
    agentResult?.orderSummaryState?.status === 'awaiting_confirmation'
  ) {
    return [
      buildIvrOrderSummarySmsText(agentResult),
      '',
      'Reply 1 to confirm the order and receive the invoice and payment link.',
      'Reply 2 to review your cart.',
      'Reply 5 to add another item.',
    ].join('\n');
  }

  return normalizeText(agentResult?.reply);
}

async function maybeSendIvrArtifactsSms({ req, agentResult, botUserId, sessionId }) {
  const confirmationSource = resolveConfirmationSource(req);

  if (!normalizeText(req.body?.reqMessageObj?.userMobNo) && !normalizeText(req.body?.reqMessageObj?.fromId)) {
    return { attempted: false, sent: false, reason: 'missing_user_mobile' };
  }

  if (agentResult?.intent?.intent === 'order_summary' && agentResult?.orderSummaryState?.status === 'awaiting_confirmation') {
    const summaryVersion = Number(agentResult?.orderSummaryState?.summaryVersion || 0);
    return sendTransactionalSmsOnce({
      tenantDb: req.tenantDb,
      reqBody: req.body,
      botUserId,
      sessionId,
      requestId: req.requestId,
      smsType: 'ivr_order_summary',
      referenceId: `ivr-order-summary-${confirmationSource}-${summaryVersion}`,
      msgContent: buildIvrOrderSummarySmsText(agentResult),
    });
  }

  if (agentResult?.conversationStatus === 'order_completed') {
    return sendTransactionalSmsOnce({
      tenantDb: req.tenantDb,
      reqBody: req.body,
      botUserId,
      sessionId,
      requestId: req.requestId,
      smsType: 'ivr_invoice_payment',
      referenceId: [
        'ivr-invoice-payment',
        confirmationSource,
        normalizeText(agentResult?.orderReferenceNumber) || 'final',
        normalizeText(agentResult?.paymentLinkId) || 'payment',
      ].join('-'),
      msgContent: buildIvrOrderConfirmationSmsText(agentResult),
    });
  }

  return { attempted: false, sent: false, reason: 'not_required' };
}

async function maybeSendIvrAssistantLinkSms({ req, botUserId, sessionId }) {
  if (!env.ivrSmsSendEnabled) {
    logger.info('IVR assistant link SMS skipped because IVR SMS sending is disabled', {
      requestId: req.requestId,
      sessionId: sessionId || null,
      taskId: req.body?.reqMessageObj?.taskId ?? null,
      callSId: req.body?.reqMessageObj?.callSId ?? null,
    });
    return { attempted: false, sent: false, reason: 'ivr_sms_disabled' };
  }

  const smsResult = await sendMailBridgeAssistantLinkSmsOnce({
    tenantDb: req.tenantDb,
    reqBody: req.body,
    botUserId,
    sessionId,
    requestId: req.requestId,
  });

  logger.info('IVR assistant link SMS evaluated', {
    requestId: req.requestId,
    sessionId: sessionId || null,
    taskId: req.body?.reqMessageObj?.taskId ?? null,
    callSId: req.body?.reqMessageObj?.callSId ?? null,
    result: smsResult,
  });

  return smsResult;
}

export async function handleStandardEOIvrCustomerMultipleOrderLink(req) {
  const botUserId = req.body?.botUserId ?? '';
  const smsResult = await maybeSendIvrAssistantLinkSms({
    req,
    botUserId,
    sessionId: resolveConversationSessionId(req),
  });

  req.logFlowStep?.('ivr_multiple_product_link_requested', {
    attempted: smsResult.attempted,
    sent: smsResult.sent,
    reason: smsResult.reason || null,
  });

  const response = buildStandardEOIvrTextResponse(req, {
    resultText: 'success',
    fileName: '',
    eoState: 'stop',
  });

  logger.info('IVR multiple-order EO API response prepared', {
    requestId: req.requestId,
    responsePayload: response,
  });

  // Return the EO acknowledgement first, then give the IVR message three
  // seconds to play before the interruption endpoint ends the voice call.
  setTimeout(async () => {
    const interruptResult = await interruptIvrCallAndContinueViaWidget({
      botUserId,
      botDatabaseName: req.body?.reqMessageObj?.botDatabaseName,
      taskId: req.body?.reqMessageObj?.taskId,
      userId: req.body?.reqMessageObj?.fromId,
      sessionDate: req.body?.sessionDate || req.sessionDate,
      callSId: req.body?.reqMessageObj?.callSId,
      msgContent: MULTIPLE_ORDER_LINK_MESSAGE,
      messageObj: req.body?.reqMessageObj,
      requestId: req.requestId,
    });

    req.logFlowStep?.('ivr_call_interrupt_and_widget_continuation_requested', {
      success: interruptResult.success,
      resultCode: interruptResult.resultCode,
      resultText: interruptResult.resultText,
    });
  }, 3000);

  return response;
}

async function handleIvrCustomerConversation(req, mode) {
  if (isWidgetChatContinuationRequest(req)) {
    const cleanedWidgetMessage = resolveIvrUserQuestion(req);
    req.body.context = {
      ...(req.body?.context || {}),
      apiAnswer: cleanedWidgetMessage || req.body?.context?.apiAnswer || '',
    };
    req.logFlowStep?.('ivr_to_widget_chat_handoff', {
      mode,
      cleanedMessageLength: cleanedWidgetMessage.length,
    });
    return handleStandardEOCustomerOrderLanggraph(req);
  }

  // Voice calls stay on the IVR graph; widget continuations are handed off above.
  req.logFlowStep?.('ivr_conversation_handler_started', { mode });
  const reqMessageObj = req.body?.reqMessageObj ?? {};
  const context = req.body?.context ?? {};
  const botUserId = req.body?.botUserId ?? '';
  const tenant = req.tenant ?? {};
  const tenantDb = req.tenantDb;
  const sessionId = resolveConversationSessionId(req);
  const localDateTime = resolveLocalDateTime(req);
  const localTimeZone = resolveLocalTimeZone(req);
  const userMessage = resolveIvrUserQuestion(req);
  req.logFlowStep?.('ivr_input_resolved', {
    mode,
    messageLength: userMessage.length,
    confirmationSource: resolveConfirmationSource(req),
  });
  const cybotUserId = String(reqMessageObj.fromId || '').trim();
  const databaseName =
    String(reqMessageObj.databaseName || tenant?.botMasterKey?.databaseName || '').trim();
  const customerResolution = await ensureCustomerForConversation({
    tenantDb,
    tenant,
    botUserId,
    databaseName,
    cybotUserId,
  });
  req.logFlowStep?.('ivr_customer_resolved', {
    hasCustomer: Boolean(customerResolution.customer),
  });

  const agentPayload = buildConversationAgentPayload({
    requestId: req.requestId,
    sessionId,
    reqMessageObj,
    context,
    tenant,
    botUserId,
    customer: customerResolution.customer,
    message: userMessage,
    localDateTime,
    localTimeZone,
    inputType: 'text',
    metadataOverrides: buildIvrConversationMetadata(mode),
    requestDatabaseName: reqMessageObj.databaseName,
  });
  req.logFlowStep?.('ivr_agent_payload_prepared', {
    sessionId: agentPayload.sessionInfo.sessionId,
    channel: agentPayload.metadata?.channel || 'ivr',
  });

  logger.info('Standard EO IVR LangGraph payload prepared', {
    requestId: req.requestId,
    botUserId,
    mode,
    confirmationSource: resolveConfirmationSource(req),
    taskId: reqMessageObj.taskId ?? null,
    signalId: reqMessageObj.signalId ?? null,
    rawFileName: String(reqMessageObj.fileName || ''),
    decodedFileName: userMessage,
    selectedUserMessage: userMessage,
    payload: agentPayload,
  });

  if (!env.langgraphChatEnabled) {
    req.logFlowStep?.('ivr_langgraph_disabled');
    return buildStandardEOIvrTextResponse(req, {
      resultText: 'success',
      fileName: 'Please say or enter the SKU or product description you want to order.',
      eoState: 'continue',
    });
  }

  if (isMultipleProductLinkRequest(userMessage)) {
    return handleStandardEOIvrCustomerMultipleOrderLink(req);
  }

  req.logFlowStep?.('ivr_langgraph_started', {
    sessionId: agentPayload.sessionInfo.sessionId,
  });
  const agentResult = await runLanggraphAgent({
    agentPayload,
    tenantDb,
    tenant,
  });
  req.logFlowStep?.('ivr_langgraph_completed', {
    threadId: agentResult.threadId,
    intent: agentResult.intent?.intent || null,
    conversationStatus: agentResult.conversationStatus,
  });

  const artifactSmsResult = await maybeSendIvrArtifactsSms({
    req,
    agentResult,
    botUserId,
    sessionId: agentPayload.sessionInfo.sessionId,
  });
  req.logFlowStep?.('ivr_artifact_sms_evaluated', {
    attempted: artifactSmsResult.attempted,
    sent: artifactSmsResult.sent,
    reason: artifactSmsResult.reason || null,
  });

  const responseText = isWidgetChatContinuationRequest(req)
    ? buildWidgetChatContinuationReply(agentResult)
    : agentResult.reply;

  logger.info('IVR continuation response mode resolved', {
    requestId: req.requestId,
    taskId: reqMessageObj.taskId ?? null,
    signalId: reqMessageObj.signalId ?? null,
    isWidgetChatContinuation: isWidgetChatContinuationRequest(req),
    confirmationSource: resolveConfirmationSource(req),
    conversationStatus: agentResult.conversationStatus,
    intent: agentResult.intent?.intent || null,
  });
  req.logFlowStep?.('ivr_eo_response_composed', {
    eoState: agentResult.eoState,
    responseMode: isWidgetChatContinuationRequest(req) ? 'widget_chat' : 'ivr',
  });

  return buildStandardEOIvrTextResponse(req, {
    resultText: 'success',
    fileName: responseText,
    eoState: agentResult.eoState,
  });
}

export async function handleStandardEOIvrCustomerOrderEnquiryLanggraph(req) {
  return handleIvrCustomerConversation(req, 'ivr_enquiry');
}

export async function handleStandardEOIvrCustomerOrderLanggraph(req) {
  return handleIvrCustomerConversation(req, 'ivr_order');
}
