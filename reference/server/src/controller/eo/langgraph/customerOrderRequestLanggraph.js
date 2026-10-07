import { logger } from '../../../config/logger.js';
import { env } from '../../../config/env.js';
import { runLanggraphAgent } from '../../../langgraph/router.js';
import { createAndUploadCustomerOrderHtml } from '../../../services/customerOrderHtmlService.js';
import {
  appendCustomerEnquiryLogEntry,
  buildConversationAgentPayload,
  ensureCustomerForConversation,
} from '../../../services/customerConversationService.js';
import { appendWidgetAssistantLinkToEmailResponse } from '../../../services/widgetAssistantLinkService.js';
import { upsertCartSelectionLink } from '../../../services/cartSelectionService.js';
import { MASTER_DATA_WORK_ORDERS_COLLECTION } from '../../../models/tenant/workOrderModel.js';
import { MASTER_DATA_INVENTORY_COLLECTION } from '../../../models/tenant/masterDataInventoryModel.js';
import { buildSeparatorTolerantSkuRegex, normalizeSku } from '../../../langgraph/tools/inventoryTools.js';
import { getS3Url } from '../../../utils/s3Utils.js';
import { resolveEOFileNameByMimeType } from '../../../utils/standardEO.js';
import { buildStandardEOTextResponse, normalizeText } from '../handlers/standardEOShared.js';

const DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/plain',
]);

function isImageLikeMimeType(mimeType) {
  const normalizedMimeType = normalizeText(mimeType).toLowerCase();

  return (
    normalizedMimeType === 'sketch' ||
    normalizedMimeType === 'image' ||
    normalizedMimeType.startsWith('image/')
  );
}

function isDocumentLikeMimeType(mimeType, fileName = '') {
  const normalizedMimeType = normalizeText(mimeType).toLowerCase();
  const normalizedFileName = normalizeText(fileName).toLowerCase();
  const fileExtensions = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.txt'];

  return (
    normalizedMimeType === 'document' ||
    normalizedMimeType.startsWith('text/') ||
    DOCUMENT_MIME_TYPES.has(normalizedMimeType) ||
    fileExtensions.some((extension) => normalizedFileName.endsWith(extension))
  );
}

async function attachOrderHtmlImages({ tenantDb, tenantId, botUserId, items = [] }) {
  if (!Array.isArray(items) || !items.length || !tenantId) {
    return items;
  }

  const missingSkus = [...new Set(items
    .filter((item) => !String(item?.imageUrl || '').trim())
    .map((item) => normalizeSku(item?.sku))
    .filter(Boolean))];
  if (!missingSkus.length) {
    logger.info('Customer order HTML image lookup skipped; all items already include images', {
      tenantId,
      botUserId,
      itemCount: items.length,
    });
    return items;
  }

  const inventory = tenantDb.collection(MASTER_DATA_INVENTORY_COLLECTION);
  const inventoryFilter = {
    tenantId,
    normalizedSku: { $in: missingSkus },
    imageUrl: { $exists: true, $ne: null },
    isDeleted: { $ne: true },
    isActive: { $ne: false },
  };
  const inventoryItems = await inventory.find(
    {
      ...(botUserId ? { botUserId } : {}),
      ...inventoryFilter,
    },
    { projection: { sku: 1, normalizedSku: 1, imageUrl: 1, _id: 0 } },
  ).toArray();
  const foundSkus = new Set(inventoryItems.map((item) => normalizeSku(item.normalizedSku || item.sku)));
  const stillMissingSkus = missingSkus.filter((sku) => !foundSkus.has(sku));
  if (botUserId && stillMissingSkus.length) {
    const fallbackItems = await inventory.find(
      {
        tenantId,
        imageUrl: { $exists: true, $ne: null },
        isDeleted: { $ne: true },
        isActive: { $ne: false },
        $or: stillMissingSkus.map((sku) => ({ sku: buildSeparatorTolerantSkuRegex(sku) })),
      },
      { projection: { sku: 1, normalizedSku: 1, imageUrl: 1, _id: 0 } },
    ).toArray();
    inventoryItems.push(...fallbackItems);
  }
  const imageBySku = new Map(inventoryItems.map((item) => [
    normalizeSku(item.normalizedSku || item.sku),
    String(item.imageUrl || '').trim(),
  ]));

  const enrichedItems = items.map((item) => ({
    ...item,
    imageUrl: String(item?.imageUrl || '').trim() || imageBySku.get(normalizeSku(item?.sku)) || '',
  }));
  const unresolvedSkus = enrichedItems
    .filter((item) => !String(item.imageUrl || '').trim())
    .map((item) => item.sku)
    .filter(Boolean);
  logger.info('Customer order HTML image lookup completed', {
    tenantId,
    botUserId,
    itemCount: items.length,
    requestedSkus: missingSkus,
    inventoryImageMatches: imageBySku.size,
    resolvedImageCount: enrichedItems.length - unresolvedSkus.length,
    unresolvedSkus,
  });

  return enrichedItems;
}

function resolveS3FileType(mimeType) {
  const normalizedMimeType = normalizeText(mimeType).toLowerCase();

  if (normalizedMimeType === 'sketch' || normalizedMimeType.startsWith('image/')) {
    return 'image';
  }

  if (normalizedMimeType === 'application/pdf') {
    return 'pdf';
  }

  if (
    normalizedMimeType === 'document' ||
    normalizedMimeType === 'application/msword' ||
    normalizedMimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return 'document';
  }

  if (
    normalizedMimeType === 'application/vnd.ms-excel' ||
    normalizedMimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    normalizedMimeType === 'text/csv'
  ) {
    return 'sheet';
  }

  return normalizedMimeType;
}

async function resolveIncomingOrderContent(reqMessageObj = {}, tenant = {}) {
  const mimeType = normalizeText(reqMessageObj.mimeType);
  const resolvedFileName = resolveEOFileNameByMimeType(reqMessageObj.fileName, mimeType);
  const fileNameText = normalizeText(resolvedFileName);
  const isImageOrder = isImageLikeMimeType(mimeType);
  const isDocumentOrder = isDocumentLikeMimeType(mimeType, fileNameText);

  if (!isImageOrder && !isDocumentOrder) {
    return {
      userMessage: fileNameText,
      inputType: 'text',
      fileUrl: null,
      thumbnailUrl: null,
      originalFileName: fileNameText || null,
    };
  }

  const folderId = normalizeText(reqMessageObj.taskId);
  const databaseName =
    normalizeText(reqMessageObj.databaseName) ||
    normalizeText(tenant?.databaseName) ||
    normalizeText(tenant?.botMasterKey?.databaseName);

  if (!folderId) {
    throw new Error('Missing taskId for image order.');
  }

  if (!fileNameText) {
    throw new Error('Missing fileName for image order.');
  }

  const fileUrlResponse = await getS3Url(
    databaseName,
    folderId,
    fileNameText,
    resolveS3FileType(mimeType),
  );

  return {
    userMessage:
      isDocumentOrder
        ? 'Customer uploaded a document order. Read the file and use the extracted order details.'
        : 'Customer uploaded a kitchen cabinetry image order. Analyze the image, identify the cabinetry items, and use close catalog options only when an exact match is not available.',
    inputType: isDocumentOrder ? 'document' : 'image',
    fileUrl: normalizeText(fileUrlResponse?.url) || null,
    thumbnailUrl: normalizeText(fileUrlResponse?.thumbUrl || fileUrlResponse?.thumpUrl) || null,
    originalFileName: fileNameText,
  };
}

function resolveUserQuestion(req) {
  const reqMessageObj = req.body?.reqMessageObj ?? {};
  const context = req.body?.context ?? {};
  const apiAnswer = String(context.apiAnswer || '').trim();
  const englishTranslation = String(context.englishTranslation || '').trim();
  const intentValue = String(reqMessageObj.intentObj?.value || '').trim();
  const fileNameText = String(
    resolveEOFileNameByMimeType(reqMessageObj.fileName, reqMessageObj.mimeType) || '',
  ).trim();

  return apiAnswer || englishTranslation || intentValue || fileNameText || '';
}

function resolveConversationSessionId(req) {
  const reqMessageObj = req.body?.reqMessageObj ?? {};
  const sessionDate = String(req.body?.sessionDate || req.sessionDate || '').trim();
  const requestSessionDate = String(reqMessageObj.sessionDate || '').trim();
  const signalId = String(reqMessageObj.signalId || '').trim();

  return sessionDate || requestSessionDate || signalId;
}

function resolveConversationSessionDate(req) {
  const reqMessageObj = req.body?.reqMessageObj ?? {};
  const sessionDate = String(req.body?.sessionDate || req.sessionDate || '').trim();
  const requestSessionDate = String(reqMessageObj.sessionDate || '').trim();

  return sessionDate || requestSessionDate || resolveConversationSessionId(req);
}

function resolveLocalDateTime(req) {
  const reqMessageObj = req.body?.reqMessageObj ?? {};
  return String(
    req.body?.localDateTime || reqMessageObj.localDateTime || req.body?.sessionDate || '',
  ).trim();
}

function resolveLocalTimeZone(req) {
  const reqMessageObj = req.body?.reqMessageObj ?? {};
  return String(
    req.body?.localTimeZone || reqMessageObj.localTimeZone || 'Asia/Kolkata',
  ).trim();
}

function maskIdentifier(value, visibleCharacters = 4) {
  const normalizedValue = String(value || '').trim();

  if (!normalizedValue) {
    return null;
  }

  if (normalizedValue.length <= visibleCharacters) {
    return '*'.repeat(normalizedValue.length);
  }

  return `${'*'.repeat(normalizedValue.length - visibleCharacters)}${normalizedValue.slice(-visibleCharacters)}`;
}

function buildSafeApiRequestLog(req) {
  const body = req.body || {};
  const reqMessageObj = body.reqMessageObj || {};
  const context = body.context || {};

  return {
    botUserId: body.botUserId || null,
    sessionDate: body.sessionDate || null,
    localDateTime: body.localDateTime || reqMessageObj.localDateTime || null,
    localTimeZone: body.localTimeZone || reqMessageObj.localTimeZone || null,
    reqMessageObj: {
      fromId: maskIdentifier(reqMessageObj.fromId),
      signalId: reqMessageObj.signalId || null,
      taskId: reqMessageObj.taskId || null,
      channel: reqMessageObj.channel || null,
      mimeType: reqMessageObj.mimeType || null,
      fileName: reqMessageObj.fileName || null,
      databaseName: reqMessageObj.databaseName || null,
      intentValue: reqMessageObj.intentObj?.value || null,
    },
    context: {
      apiAnswer: context.apiAnswer || null,
      englishTranslation: context.englishTranslation || null,
    },
  };
}

export async function handleStandardEOCustomerOrderLanggraph(req) {
  // API boundary: convert the EO webhook request into the small, validated payload
  // consumed by LangGraph. The requestId is retained in every downstream log.
  req.logFlowStep?.('customer_order_handler_started');
  logger.info('Standard EO customer order API request received', {
    requestId: req.requestId,
    apiRequestPayload: buildSafeApiRequestLog(req),
  });

  const reqMessageObj = req.body?.reqMessageObj ?? {};
  const context = req.body?.context ?? {};
  const botUserId = req.body?.botUserId ?? '';
  const tenant = req.tenant ?? {};
  const tenantDb = req.tenantDb;
  const sessionId = resolveConversationSessionId(req);
  const sessionDate = resolveConversationSessionDate(req);
  const localDateTime = resolveLocalDateTime(req);
  const localTimeZone = resolveLocalTimeZone(req);
  const resolvedOrderContent = await resolveIncomingOrderContent(reqMessageObj, tenant);
  req.logFlowStep?.('customer_order_input_resolved', {
    inputType: resolvedOrderContent.inputType,
    hasAttachment: Boolean(resolvedOrderContent.fileUrl),
  });
  const rawUserQuestion = resolveUserQuestion(req);
  const userMessage =
    resolvedOrderContent.inputType === 'image' || resolvedOrderContent.inputType === 'document'
      ? resolvedOrderContent.userMessage
      : rawUserQuestion;
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
  req.logFlowStep?.('customer_order_customer_resolved', {
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
    inputType: resolvedOrderContent.inputType,
    fileUrl: resolvedOrderContent.fileUrl,
    thumbnailUrl: resolvedOrderContent.thumbnailUrl,
    originalFileName: resolvedOrderContent.originalFileName,
    requestDatabaseName: reqMessageObj.databaseName,
  });
  req.logFlowStep?.('customer_order_agent_payload_prepared', {
    sessionId: agentPayload.sessionInfo.sessionId,
    inputType: resolvedOrderContent.inputType,
    messageLength: agentPayload.userMessage.length,
  });

  try {
    await appendCustomerEnquiryLogEntry({
      tenantDb,
      tenant,
      botUserId,
      customer: customerResolution.customer,
      cybotUserId,
      sessionId,
      sessionDate,
      localDateTime,
      localTimeZone,
      reqMessageObj,
      context,
      role: 'user',
      text: rawUserQuestion || userMessage,
      agentInputText: userMessage,
      inputType: resolvedOrderContent.inputType,
      fileUrl: resolvedOrderContent.fileUrl,
      thumbnailUrl: resolvedOrderContent.thumbnailUrl,
      originalFileName: resolvedOrderContent.originalFileName,
      requestId: req.requestId,
    });
    req.logFlowStep?.('customer_order_user_turn_persisted');
  } catch (error) {
    logger.warn('Customer enquiry input logging failed', {
      requestId: req.requestId,
      botUserId,
      sessionId,
      error: error?.message || String(error),
    });
    req.logFlowStep?.('customer_order_user_turn_persist_failed', {
      error: error?.message || String(error),
    });
  }

  logger.info('Standard EO customer order LangGraph payload prepared', {
    requestId: req.requestId,
    botUserId,
    taskId: reqMessageObj.taskId ?? null,
    signalId: reqMessageObj.signalId ?? null,
    inputType: resolvedOrderContent.inputType,
    hasFileUrl: Boolean(resolvedOrderContent.fileUrl),
    sessionId: agentPayload.sessionInfo.sessionId,
    userMessageLength: agentPayload.userMessage.length,
    userMessage: agentPayload.userMessage,
  });

  // Guard: empty message with no file attachment — nothing to process.
  if (!agentPayload.userMessage.trim() && !resolvedOrderContent.fileUrl) {
    req.logFlowStep?.('customer_order_skipped_empty_input');
    logger.info('Standard EO customer order skipped — empty input', {
      requestId: req.requestId,
      botUserId,
      sessionId: agentPayload.sessionInfo.sessionId,
    });
    return buildStandardEOTextResponse(req, {
      resultText: 'success',
      fileName: 'It looks like your message came through empty. To process your order, please share any input.',
      eoState: 'continue',
    });
  }

  if (!env.langgraphChatEnabled) {
    req.logFlowStep?.('customer_order_langgraph_disabled');
    logger.warn('Standard EO customer order LangGraph is disabled', {
      requestId: req.requestId,
      botUserId,
      sessionId: agentPayload.sessionInfo.sessionId,
    });
    const disabledResponse = buildStandardEOTextResponse(req, {
      resultText: 'success',
      fileName: '',
      eoState: 'continue',
    });

    try {
      await appendCustomerEnquiryLogEntry({
        tenantDb,
        tenant,
        botUserId,
        customer: customerResolution.customer,
        cybotUserId,
        sessionId,
        sessionDate,
        localDateTime,
        localTimeZone,
        reqMessageObj,
        context,
        role: 'assistant',
        text: '',
        inputType: resolvedOrderContent.inputType,
        requestId: req.requestId,
        eoState: 'continue',
        conversationStatus: 'active',
      });
    } catch (error) {
      logger.warn('Customer enquiry disabled-response logging failed', {
        requestId: req.requestId,
        botUserId,
        sessionId,
        error: error?.message || String(error),
      });
    }

    return disabledResponse;
  }

  logger.info('Standard EO customer order invoking LangGraph', {
    requestId: req.requestId,
    botUserId,
    sessionId: agentPayload.sessionInfo.sessionId,
  });
  req.logFlowStep?.('customer_order_langgraph_started', {
    sessionId: agentPayload.sessionInfo.sessionId,
  });

  const agentResult = await runLanggraphAgent({
    agentPayload,
    tenantDb,
    tenant,
  });
  req.logFlowStep?.('customer_order_langgraph_completed', {
    threadId: agentResult.threadId,
    intent: agentResult.intent?.intent || null,
    conversationStatus: agentResult.conversationStatus,
  });

  logger.info('Standard EO customer order LangGraph response generated', {
    requestId: req.requestId,
    botUserId,
    threadId: agentResult.threadId,
    intent: agentResult.intent?.intent || null,
    conversationStatus: agentResult.conversationStatus,
    eoState: agentResult.eoState,
    replyLength: agentResult.reply.length,
  });

  // Send the cart-selection link whenever there are pending items the customer
  // needs to act on — set qty, remove unwanted items, or choose options.
  // Also send on cart view so they can manage the full cart from the UI.
  const pendingItems = agentResult.graphState?.pendingDecision?.items || [];
  const hasPendingItems = pendingItems.length > 0;
  const isCartView = agentResult.intent?.intent === 'cart_view';
  const orderSummaryState = agentResult.graphState?.orderSummaryState || {};
  const orderArtifacts = orderSummaryState.artifacts || {};
  const isOrderConfirmed = ['confirmed', 'submitted'].includes(String(orderSummaryState.status || '').toLowerCase())
    || Boolean(orderArtifacts.workOrder || orderArtifacts.coreOrder);
  const shouldSendLink = !isOrderConfirmed && (hasPendingItems || isCartView);

  let replyWithLink = agentResult.reply;
  let cartSelectionLink = null;
  let customerOrderHtml = null;

  if (agentResult.orderReferenceNumber && agentResult.intent?.intent === 'order_submit') {
    const persistedWorkOrder = await tenantDb.collection(MASTER_DATA_WORK_ORDERS_COLLECTION).findOne(
      {
        tenantId: tenant?.tenantId,
        workOrderNumber: agentResult.workOrderId || agentResult.orderReferenceNumber,
        isDeleted: { $ne: true },
      },
      { projection: { items: 1, _id: 0 } },
    );
    const orderItems = await attachOrderHtmlImages({
      tenantDb,
      tenantId: tenant?.tenantId,
      botUserId,
      items: persistedWorkOrder?.items || agentResult.graphState?.cart?.items || [],
    });
    logger.info('Customer order HTML generation input prepared', {
      requestId: req.requestId,
      orderReferenceNumber: agentResult.orderReferenceNumber,
      workOrderId: agentResult.workOrderId || null,
      source: persistedWorkOrder?.items?.length ? 'persisted_work_order' : 'graph_cart',
      itemCount: orderItems.length,
      itemImageCount: orderItems.filter((item) => String(item.imageUrl || '').trim()).length,
    });
    customerOrderHtml = await createAndUploadCustomerOrderHtml({
      orderReference: agentResult.orderReferenceNumber,
      items: orderItems,
      quoteUrl: agentResult.quoteLink,
      invoiceUrl: agentResult.invoiceUrl,
      paymentLinkUrl: agentResult.paymentLink,
      tenantId: tenant?.tenantId,
    });
  }

  if (shouldSendLink) {
    cartSelectionLink = await upsertCartSelectionLink({
      threadId: agentResult.threadId,
      agentPayload,
      graphState: agentResult.graphState,
    });

    // Append the cart-selection link directly into the reply text (fileName)
    // so Cybot renders it as part of the chat bubble message.
    if (cartSelectionLink.url) {
      replyWithLink = [String(agentResult.reply || '').trim(), `Manage your cart or choose an option: ${cartSelectionLink.url}`]
        .filter(Boolean)
        .join('\n\n');
    }
  }

  const response = buildStandardEOTextResponse(req, {
    resultText: 'success',
    fileName: replyWithLink,
    eoState: agentResult.eoState,
    orderReferenceNumber: agentResult.orderReferenceNumber,
    workOrderId: agentResult.workOrderId,
    quoteLink: agentResult.quoteLink,
    invoiceNumber: agentResult.invoiceNumber,
    invoiceUrl: agentResult.invoiceUrl,
    paymentLinkId: agentResult.paymentLinkId,
    paymentLink: agentResult.paymentLink,
    ...(customerOrderHtml ? {
      mimeType: 'htmlFile',
      fileName: customerOrderHtml.fileName,
      fileNameFolder: customerOrderHtml.fileNameFolder,
    } : {}),
  });

  const finalResponse = await appendWidgetAssistantLinkToEmailResponse(
    response,
    req.body,
    tenantDb,
  );

  // Audit the exact EO payload after all response enrichment (including any
  // widget link) so production logs show precisely what Cybot receives.
  logger.info('EO customer order final response payload', {
    requestId: req.requestId,
    botUserId,
    taskId: reqMessageObj.taskId ?? null,
    parentSignalId: reqMessageObj.signalId ?? null,
    threadId: agentResult.threadId,
    resultCode: finalResponse?.resultCode ?? null,
    resultText: finalResponse?.resultText ?? null,
    eoState: finalResponse?.eoState ?? null,
    responseSignalId: finalResponse?.resMessageObj?.signalId ?? null,
    outgoingText: replyWithLink,
    hasCartSelectionLink: Boolean(cartSelectionLink?.url),
    orderHtml: customerOrderHtml ? {
      fileName: customerOrderHtml.fileName,
      fileNameFolder: customerOrderHtml.fileNameFolder,
      url: customerOrderHtml.url,
    } : null,
    responsePayload: finalResponse,
  });
  logger.info('EO customer order outgoing resMessageObj', {
    requestId: req.requestId,
    threadId: agentResult.threadId,
    resMessageObj: finalResponse?.resMessageObj ?? null,
  });
  req.logFlowStep?.('customer_order_eo_response_composed', {
    eoState: agentResult.eoState,
    hasQuoteLink: Boolean(agentResult.quoteLink),
    hasInvoiceUrl: Boolean(agentResult.invoiceUrl),
    hasPaymentLink: Boolean(agentResult.paymentLink),
  });

  try {
    await appendCustomerEnquiryLogEntry({
      tenantDb,
      tenant,
      botUserId,
      customer: customerResolution.customer,
      cybotUserId,
      sessionId,
      sessionDate,
      localDateTime,
      localTimeZone,
      reqMessageObj,
      context,
      role: 'assistant',
      text: agentResult.reply,
      customMessage: cartSelectionLink?.url ? replyWithLink : '',
      inputType: resolvedOrderContent.inputType,
      requestId: req.requestId,
      threadId: agentResult.threadId,
      eoState: agentResult.eoState,
      conversationStatus: agentResult.conversationStatus,
      orderReferenceNumber: agentResult.orderReferenceNumber,
      workOrderId: agentResult.workOrderId,
      quoteLink: agentResult.quoteLink,
      invoiceNumber: agentResult.invoiceNumber,
      invoiceUrl: agentResult.invoiceUrl,
      paymentLinkId: agentResult.paymentLinkId,
      paymentLink: agentResult.paymentLink,
    });
    req.logFlowStep?.('customer_order_assistant_turn_persisted');
  } catch (error) {
    logger.warn('Customer enquiry assistant-response logging failed', {
      requestId: req.requestId,
      botUserId,
      sessionId,
      threadId: agentResult.threadId,
      error: error?.message || String(error),
    });
    req.logFlowStep?.('customer_order_assistant_turn_persist_failed', {
      error: error?.message || String(error),
    });
  }

  return finalResponse;
}
