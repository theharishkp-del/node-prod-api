import { logger } from '../../config/logger.js';
import { runLanggraphAgent } from '../../langgraph/router.js';
import { sendKafkaTextMessage } from '../../services/kafkaMessageService.js';
import { claimCartSelectionSubmission, getCartSelectionByToken, lockCartSelectionForWorkOrder, upsertCartSelectionLink } from '../../services/cartSelectionService.js';
import { getTenantDb, getTenantRegistry } from '../../utils/tenantManager.js';
import { MASTER_DATA_INVENTORY_COLLECTION } from '../../models/tenant/masterDataInventoryModel.js';
import { MASTER_DATA_WORK_ORDERS_COLLECTION } from '../../models/tenant/workOrderModel.js';
import { buildSeparatorTolerantSkuRegex, normalizeSku } from '../../langgraph/tools/inventoryTools.js';

function tokenFromRequest(req) {
  return String(req.params.token || req.body?.token || '').trim();
}

/**
 * Fetch imageUrl for a set of SKUs from the tenant's inventory collection.
 * Returns a Map<sku, imageUrl>.
 */
async function buildSkuImageMap(tenantDb, tenantId, botUserId, skus = []) {
  const uniqueSkus = [...new Set(skus.filter(Boolean))];
  if (!tenantDb || !tenantId || !uniqueSkus.length) return new Map();

  const collection = tenantDb.collection(MASTER_DATA_INVENTORY_COLLECTION);
  const baseFilter = {
    tenantId,
    ...(botUserId ? { botUserId } : {}),
    isDeleted: { $ne: true },
    isActive: { $ne: false },
    imageUrl: { $exists: true, $ne: null },
  };
  const normalizedSkus = [...new Set(uniqueSkus.map(normalizeSku).filter(Boolean))];
  const normalizedDocs = await collection.find(
    { ...baseFilter, normalizedSku: { $in: normalizedSkus } },
    { projection: { sku: 1, normalizedSku: 1, imageUrl: 1, _id: 0 } },
  ).toArray();
  const foundSkus = new Set(normalizedDocs.map((doc) => normalizeSku(doc.sku)));
  const missingSkus = normalizedSkus.filter((sku) => !foundSkus.has(sku));
  const fallbackDocs = missingSkus.length
    ? await collection.find(
      { ...baseFilter, $or: missingSkus.map((sku) => ({ sku: buildSeparatorTolerantSkuRegex(sku) })) },
      { projection: { sku: 1, normalizedSku: 1, imageUrl: 1, _id: 0 } },
    ).toArray()
    : [];

  return new Map([...normalizedDocs, ...fallbackDocs].map((doc) => [normalizeSku(doc.sku), doc.imageUrl]));
}

export async function getCartSelection(req, res) {
  const selection = await getCartSelectionByToken(tokenFromRequest(req));
  if (!selection) {
    return res.status(404).json({ status: 'not_found', message: 'This cart link is invalid or has expired.' });
  }

  const state = selection.uiState || {};
  const agentPayload = selection.agentPayload || {};
  const tenantId = agentPayload?.databaseInfo?.tenantId || null;
  const botUserId = String(agentPayload?.databaseInfo?.botUserId || '').trim();
  const sessionId = String(agentPayload?.sessionInfo?.sessionId || '').trim();

  // A cart-link can be opened from an earlier reply after the customer has
  // completed the order in chat. Check the persisted work order so that stale
  // UI snapshots become read-only instead of allowing a second submission.
  let persistedWorkOrder = null;
  let orderLocked = Boolean(state.orderLocked);
  if (tenantId && botUserId && sessionId) {
    try {
      const tenantDb = await getTenantDb(botUserId);
      persistedWorkOrder = await tenantDb.collection(MASTER_DATA_WORK_ORDERS_COLLECTION).findOne(
        { tenantId, sessionId, isDeleted: { $ne: true } },
        { projection: { workOrderNumber: 1, workOrderId: 1, status: 1, _id: 0 } },
      );
      orderLocked = orderLocked || Boolean(persistedWorkOrder);

      if (persistedWorkOrder && !state.orderLocked) {
        await lockCartSelectionForWorkOrder({ threadId: selection.threadId, workOrder: persistedWorkOrder });
      }
    } catch (err) {
      logger.warn('Cart selection work-order lock lookup failed (non-fatal)', {
        tenantId,
        sessionId,
        error: err?.message || String(err),
      });
    }
  }

  // Collect all SKUs we need images for — cart items + option rows.
  const cartItems = state.cart?.items || [];
  const pendingItems = state.pendingDecision?.items || [];

  const allSkus = [
    ...cartItems.map((item) => item.sku),
    ...pendingItems.map((pending) => pending.sku).filter(Boolean),
    ...pendingItems.flatMap((pending) => (pending.options || []).map((opt) => opt.sku)),
  ];

  // Resolve tenantDb only if we have enough info, fail silently if not.
  let imageMap = new Map();
  try {
    if (tenantId && botUserId) {
      const tenantDb = await getTenantDb(botUserId);
      imageMap = await buildSkuImageMap(tenantDb, tenantId, botUserId, allSkus);
    }
  } catch (err) {
    logger.warn('Cart selection image lookup failed (non-fatal)', {
      tenantId,
      error: err?.message || String(err),
    });
  }

  // Attach imageUrl to cart items
  const enrichedCartItems = cartItems.map((item) => ({
    ...item,
    imageUrl: imageMap.get(normalizeSku(item.sku)) || null,
  }));

  // Attach imageUrl to each pending item itself (matched/quantity_missing)
  // AND to each option row within suggestion items
  const enrichedPendingDecision = state.pendingDecision
    ? {
        ...state.pendingDecision,
        items: pendingItems.map((pending) => ({
          ...pending,
          imageUrl: imageMap.get(normalizeSku(pending.sku)) || null,
          options: (pending.options || []).map((opt) => ({
            ...opt,
            imageUrl: imageMap.get(normalizeSku(opt.sku)) || null,
          })),
        })),
      }
    : null;

  const orderArtifacts = state.orderSummaryState?.artifacts || {};

  return res.json({
    status: 'success',
    data: {
      submitStatus: selection.uiSubmitStatus,
      bookingCompleted: Boolean(state.bookingCompleted),
      orderLocked,
      pendingDecision: enrichedPendingDecision,
      pendingImageConfirmation: state.pendingImageConfirmation || null,
      cart: {
        ...(state.cart || { items: [] }),
        items: enrichedCartItems,
      },
      orderReference: orderArtifacts.coreOrder || null,
      workOrder: orderArtifacts.workOrder || (persistedWorkOrder ? {
        status: 'created',
        referenceNumber: persistedWorkOrder.workOrderNumber || persistedWorkOrder.workOrderId || null,
      } : null),
      quote: orderArtifacts.quote || null,
      invoice: orderArtifacts.invoice || null,
      paymentLink: orderArtifacts.paymentLink || null,
    },
  });
}

export async function submitCartSelection(req, res) {
  const token = tokenFromRequest(req);
  const message = String(req.body?.message || '').trim();
  if (!message || message.length > 2000) {
    return res.status(400).json({ status: 'invalid_request', message: 'A valid selection message is required.' });
  }

  // Do not rely only on the link's cached graph snapshot: a customer can post
  // directly to an old URL after the work order was completed in chat.
  const existingSelection = await getCartSelectionByToken(token);
  const existingPayload = existingSelection?.agentPayload || {};
  const existingBotUserId = String(existingPayload?.databaseInfo?.botUserId || '').trim();
  const existingTenantId = existingPayload?.databaseInfo?.tenantId || null;
  const existingSessionId = String(existingPayload?.sessionInfo?.sessionId || '').trim();
  if (existingBotUserId && existingTenantId && existingSessionId) {
    const tenantDb = await getTenantDb(existingBotUserId);
    const workOrder = await tenantDb.collection(MASTER_DATA_WORK_ORDERS_COLLECTION).findOne(
      { tenantId: existingTenantId, sessionId: existingSessionId, isDeleted: { $ne: true } },
      { projection: { workOrderNumber: 1, workOrderId: 1, _id: 0 } },
    );
    if (workOrder) {
      await lockCartSelectionForWorkOrder({ threadId: existingSelection.threadId, workOrder });
      return res.status(409).json({
        status: 'order_locked',
        message: 'This order has already been created and can no longer be changed from this cart link.',
      });
    }
  }

  // Atomically claim the submission so double-submits are rejected.
  const selection = await claimCartSelectionSubmission({ token, message });
  if (!selection) {
    return res.status(409).json({ status: 'already_submitted', message: 'This selection was already submitted, completed, or expired.' });
  }

  const agentPayload = selection.agentPayload;
  const botUserId = String(agentPayload?.databaseInfo?.botUserId || '').trim();
  const requestId = agentPayload?.sessionInfo?.requestId || token;

  // Resolve the tenant context that LangGraph needs.
  const tenant = await getTenantRegistry(botUserId);
  const tenantDb = await getTenantDb(botUserId);

  // Continue the same graph thread used when the cart-selection link was created.
  // Clear any earlier uploaded file attachments so the submit action does not
  // re-trigger the image extraction pipeline from the original image request.
  const submissionPayload = {
    ...agentPayload,
    userMessage: message,
    inputType: 'text',
    attachments: [],
    sessionInfo: {
      ...agentPayload.sessionInfo,
      requestId,
    },
  };

  logger.info('Cart selection LangGraph run started', {
    requestId,
    botUserId,
    messageLength: message.length,
    threadId: selection.threadId,
  });

  // Run LangGraph with the customer's selection — get back the LLM reply.
  const agentResult = await runLanggraphAgent({
    agentPayload: submissionPayload,
    tenantDb,
    tenant,
    threadIdOverride: selection.threadId || undefined,
  });

  logger.info('Cart selection LangGraph run completed', {
    requestId,
    botUserId,
    threadId: agentResult.threadId,
    intent: agentResult.intent?.intent || null,
    replyLength: agentResult.reply?.length || 0,
  });

  // Refresh the cart-selection link document with the new graph state so the
  // UI reflects the latest cart/pending-decision if the customer reopens the link.
  await upsertCartSelectionLink({
    threadId: agentResult.threadId,
    agentPayload: submissionPayload,
    graphState: agentResult.graphState,
  });

  // Send the LLM reply (not the raw UI selection text) to Kafka so Cybot
  // delivers the agent's response directly to the customer.
  await sendKafkaTextMessage({
    taskId: agentPayload.metadata?.taskId,
    fromId: agentPayload.metadata?.toId || botUserId,
    databaseName: agentPayload.databaseInfo?.requestDatabaseName || agentPayload.databaseInfo?.databaseName,
    message: agentResult.reply,
    requestId,
  });

  return res.status(202).json({ status: 'accepted', message: 'Your selection has been processed.' });
}
