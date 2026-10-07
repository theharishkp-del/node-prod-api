import { logger } from '../../../../config/logger.js';
import { createWorkOrder } from '../../../../services/masterDataService.js';

function formatMoney(value, currency) {
  const amount = Number(value || 0);

  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency || 'USD'} ${amount.toFixed(2)}`;
  }
}

function buildDraftId(existingState) {
  return existingState?.quoteDraftId || `Q-DRAFT-${Date.now()}`;
}

function buildArtifactSeed(orderSummaryState) {
  return orderSummaryState?.quoteDraftId?.replace(/[^A-Z0-9]/gi, '').slice(-8) || `${Date.now()}`.slice(-8);
}

function buildOrderSummaryFromCart(cart) {
  const items = Array.isArray(cart?.items) ? cart.items : [];
  const currency = items[0]?.currency || cart?.currency || 'USD';
  const total = items.reduce((sum, item) => sum + Number(item.lineTotal || 0), 0);

  return {
    itemCount: items.length,
    currency,
    total,
    formattedTotal: formatMoney(total, currency),
    lines: items.map((item, index) => ({
      itemNumber: index + 1,
      sku: item.sku,
      productName: item.productName,
      description: item.description,
      category: item.category,
      quantity: item.quantity,
      formattedLineTotal: item.formattedLineTotal || formatMoney(item.lineTotal, currency),
      fulfillmentStatus: item.fulfillmentStatus,
      estimatedDate: item.estimatedDate || null,
    })),
  };
}

function buildSummaryArtifacts(orderSummaryState, existingArtifacts = null) {
  const seed = buildArtifactSeed(orderSummaryState);
  const existingQuote = existingArtifacts?.quote || null;

  return {
    coreOrder: existingArtifacts?.coreOrder || null,
    quote: {
      status: 'created',
      referenceNumber: existingQuote?.referenceNumber || `QT-${seed}`,
      url: existingQuote?.url || `https://example.test/quote/${seed.toLowerCase()}`,
    },
    workOrder: existingArtifacts?.workOrder || null,
    invoice: existingArtifacts?.invoice || null,
    paymentLink: existingArtifacts?.paymentLink || null,
  };
}

function buildStubArtifacts(orderSummaryState, existingArtifacts = null) {
  const seed = buildArtifactSeed(orderSummaryState);
  const summaryArtifacts = buildSummaryArtifacts(orderSummaryState, existingArtifacts);

  return {
    ...summaryArtifacts,
    coreOrder: {
      status: 'created',
      referenceNumber: summaryArtifacts.coreOrder?.referenceNumber || `ORD-${seed}`,
    },
    workOrder: {
      status: 'created',
      referenceNumber: summaryArtifacts.workOrder?.referenceNumber || `WO-${seed}`,
    },
    invoice: summaryArtifacts.invoice || {
      status: 'not_generated',
      referenceNumber: null,
      reason: 'Optional artifact pending external integration.',
    },
    paymentLink: summaryArtifacts.paymentLink || {
      status: 'created',
      referenceNumber: `PAY-${seed}`,
      url: `https://example.test/pay/${seed.toLowerCase()}`,
    },
  };
}

function buildAvailabilityNote(item) {
  if (item.fulfillmentStatus === 'ready_now') {
    return 'Ready now.';
  }

  if (item.estimatedDate) {
    return `Full order scheduled for ${item.estimatedDate}.`;
  }

  return 'Full order pending confirmation.';
}

function buildWorkOrderPayload({ state, cart, currentOrderSummaryState, quoteOnly = false }) {
  const customerInfo = state.agentPayload?.customerInfo || {};
  const metadata = state.agentPayload?.metadata || {};
  const existingArtifacts = currentOrderSummaryState?.artifacts || {};
  const existingQuoteId = String(existingArtifacts.quote?.quoteId || '').trim();
  const existingWorkOrderNumber = String(
    existingArtifacts.workOrder?.referenceNumber || existingArtifacts.workOrder?.workOrderNumber || '',
  ).trim();

  return {
    quoteOnly,
    quoteId: existingQuoteId || undefined,
    workOrderNumber: !quoteOnly && existingWorkOrderNumber ? existingWorkOrderNumber : undefined,
    workOrderId: !quoteOnly && existingWorkOrderNumber ? existingWorkOrderNumber : undefined,
    sessionId: state.agentPayload?.sessionInfo?.sessionId,
    databaseName:
      state.agentPayload?.databaseInfo?.requestDatabaseName ||
      state.agentPayload?.databaseInfo?.databaseName ||
      null,
    collectionName: state.agentPayload?.databaseInfo?.collectionName || null,
    customerInfo: {
      name: customerInfo.name,
      emailId: customerInfo.emailId,
      phNumber: customerInfo.phNumber,
    },
    requestedAt: metadata.localDateTime || new Date().toISOString(),
    requestedLocalDateTime: metadata.localDateTime || null,
    requestedLocalTimeZone: metadata.localTimeZone || null,
    quoteAcceptedAt: metadata.localDateTime || new Date().toISOString(),
    quoteStatus: quoteOnly ? 'sent' : 'accepted',
    deliveryMode: 'WAREHOUSE_PICKUP',
    customerRequestNotes: 'Created from conversation cart summary.',
    sourcePayload: {
      userMessage: state.agentPayload?.userMessage || '',
      sessionInfo: state.agentPayload?.sessionInfo || {},
      metadata,
    },
    items: (cart.items || []).map((item) => ({
      sku: item.sku,
      itemName: item.productName,
      description: item.description,
      category: item.category,
      quantity: item.quantity,
      unitPrice: Number(item.unitPrice || 0),
      lineTotal: Number(item.lineTotal || 0),
      qtyAvailableNow: Math.max(0, Number(item.qtyAvailable || 0)),
      remainingQty: Math.max(0, Number(item.quantity || 0) - Math.max(0, Number(item.qtyAvailable || 0))),
      leadTimeDays: 0,
      availabilityNote: buildAvailabilityNote(item),
      imageUrl: item.imageUrl || null,
    })),
  };
}

function buildRequestContext(state) {
  const metadata = state.agentPayload?.metadata || {};

  return {
    requestId: state.agentPayload?.sessionInfo?.requestId || '',
    userId: metadata.fromId || '',
    databaseName:
      state.agentPayload?.databaseInfo?.requestDatabaseName ||
      state.agentPayload?.databaseInfo?.databaseName ||
      '',
    usageDate: metadata.localDateTime || null,
  };
}

function mapStandaloneQuoteArtifacts(orderSummaryState, workOrderResult, existingArtifacts = null) {
  const seed = buildArtifactSeed(orderSummaryState);
  const quote = workOrderResult?.quote || {};
  const quoteUrl = String(
    workOrderResult?.quoteLink ||
    workOrderResult?.quotePdf?.url ||
    quote?.zohoEstimateUrl ||
    '',
  ).trim();

  return {
    coreOrder: existingArtifacts?.coreOrder || null,
    quote: {
      status: quoteUrl ? 'created' : 'not_generated',
      quoteId: String(workOrderResult?.quoteId || quote?.id || '').trim() || null,
      referenceNumber: String(quote?.quoteNumber || `QT-${seed}`).trim() || `QT-${seed}`,
      url: quoteUrl || null,
    },
    workOrder: existingArtifacts?.workOrder || null,
    invoice: existingArtifacts?.invoice || null,
    paymentLink: existingArtifacts?.paymentLink || null,
  };
}

async function loadWorkOrderDocuments({ tenantDb, tenantId, workOrderNumber }) {
  if (!tenantDb || !tenantId || !workOrderNumber) {
    return null;
  }

  return tenantDb.collection('md_work_orders').findOne({
    tenantId,
    workOrderNumber,
    isDeleted: { $ne: true },
  });
}

function mapSubmittedOrderArtifacts(orderSummaryState, workOrderResult, persistedWorkOrder, existingArtifacts = null) {
  const quoteDocument = persistedWorkOrder?.s3Documents?.quote || null;
  const invoiceDocument = persistedWorkOrder?.s3Documents?.invoice || null;
  const quoteFromResult = workOrderResult?.quote || {};

  return {
    coreOrder: {
      status: 'created',
      referenceNumber: String(
        workOrderResult?.orderReferenceNumber ||
        persistedWorkOrder?.orderReferenceNumber ||
        existingArtifacts?.coreOrder?.referenceNumber ||
        '',
      ).trim() || null,
    },
    quote: {
      status: String(
        quoteDocument?.url ||
        workOrderResult?.quoteLink ||
        quoteFromResult?.zohoEstimateUrl ||
        '',
      ).trim()
        ? 'created'
        : 'not_generated',
      quoteId: String(workOrderResult?.quoteId || persistedWorkOrder?.quoteId || '').trim() || null,
      referenceNumber: String(
        quoteFromResult?.quoteNumber ||
        existingArtifacts?.quote?.referenceNumber ||
        '',
      ).trim() || null,
      url: String(
        quoteDocument?.url ||
        workOrderResult?.quoteLink ||
        quoteFromResult?.zohoEstimateUrl ||
        '',
      ).trim() || null,
    },
    workOrder: {
      status: 'created',
      referenceNumber: String(
        workOrderResult?.workOrderNumber ||
        workOrderResult?.workOrderId ||
        persistedWorkOrder?.workOrderNumber ||
        existingArtifacts?.workOrder?.referenceNumber ||
        '',
      ).trim() || null,
    },
    invoice: {
      status: String(invoiceDocument?.url || '').trim() ? 'created' : 'not_generated',
      invoiceId: String(workOrderResult?.invoiceId || persistedWorkOrder?.invoiceId || '').trim() || null,
      referenceNumber: String(
        workOrderResult?.invoiceNumber ||
        persistedWorkOrder?.invoiceNumber ||
        existingArtifacts?.invoice?.referenceNumber ||
        '',
      ).trim() || null,
      url: String(invoiceDocument?.url || '').trim() || null,
    },
    paymentLink: {
      status: String(
        workOrderResult?.paymentLink ||
        persistedWorkOrder?.paymentLink ||
        '',
      ).trim()
        ? 'created'
        : 'not_generated',
      referenceNumber: String(
        workOrderResult?.paymentLinkId ||
        persistedWorkOrder?.paymentLinkId ||
        '',
      ).trim() || null,
      url: String(
        workOrderResult?.paymentLink ||
        persistedWorkOrder?.paymentLink ||
        '',
      ).trim() || null,
    },
  };
}

// Step 5: prepare a quote when the customer proceeds with the order, or create final sales
// documents only after an explicit confirmation of that quote.
export function createOrderSummaryNode({
  tenantDb = null,
  tenant = null,
  botUserId = null,
  prepareSummaryOrderFn = createWorkOrder,
  submitOrderFn = createWorkOrder,
} = {}) {
  return async function orderSummaryNode(state) {
    const startedAt = Date.now();
    const requestId = state.agentPayload.sessionInfo.requestId;
    const intent = state.intent || {};
    const currentOrderSummaryState = state.orderSummaryState || null;
    const cart = state.cart || { items: [] };

    let nextOrderSummaryState = currentOrderSummaryState;

    if (intent.intent === 'order_summary' && intent.decisionAction === 'prepare_order_summary') {
      const summary = buildOrderSummaryFromCart(cart);

      if (!summary.itemCount) {
        nextOrderSummaryState = {
          status: 'empty_cart',
          quoteDraftId: null,
          customerCheck: null,
          summaryVersion: 0,
          summary,
          artifacts: null,
        };
      } else {
        const nextQuoteDraftId = buildDraftId(currentOrderSummaryState);
        let artifacts = buildSummaryArtifacts(
          {
            ...currentOrderSummaryState,
            quoteDraftId: nextQuoteDraftId,
          },
          currentOrderSummaryState?.artifacts || null,
        );

        try {
          const workOrderResult = await prepareSummaryOrderFn({
            tenantDb,
            tenant,
            botUserId,
            payload: buildWorkOrderPayload({
              state,
              cart,
              currentOrderSummaryState,
              quoteOnly: true,
            }),
            requestContext: buildRequestContext(state),
          });
          artifacts = mapStandaloneQuoteArtifacts(
            { ...currentOrderSummaryState, quoteDraftId: nextQuoteDraftId },
            workOrderResult,
            currentOrderSummaryState?.artifacts || null,
          );
        } catch (error) {
          logger.warn('LangGraph order summary quote preparation failed; fallback summary artifacts used', {
            requestId,
            error: error.message,
          });
        }

        nextOrderSummaryState = {
          status: 'awaiting_confirmation',
          quoteDraftId: nextQuoteDraftId,
          customerCheck: {
            checked: true,
            existsInZoho: 'stubbed',
          },
          summaryVersion: Number(currentOrderSummaryState?.summaryVersion || 0) + 1,
          summary,
          artifacts,
        };
      }
    } else if (intent.intent === 'order_summary' && intent.decisionAction === 'edit_order_summary') {
      nextOrderSummaryState = {
        ...currentOrderSummaryState,
        status: 'editing',
      };
    } else if (
      intent.intent === 'order_submit' &&
      intent.decisionAction === 'submit_order' &&
      currentOrderSummaryState?.status !== 'awaiting_confirmation'
    ) {
      // Defense in depth: even if a caller bypasses the understand-node guard,
      // never create final sales documents without a saved review step.
      const summary = buildOrderSummaryFromCart(cart);
      nextOrderSummaryState = {
        status: summary.itemCount ? 'awaiting_confirmation' : 'empty_cart',
        quoteDraftId: buildDraftId(currentOrderSummaryState),
        customerCheck: null,
        summaryVersion: Number(currentOrderSummaryState?.summaryVersion || 0) + 1,
        summary,
        artifacts: buildSummaryArtifacts(currentOrderSummaryState || {}, currentOrderSummaryState?.artifacts || null),
      };
    } else if (intent.intent === 'order_submit' && intent.decisionAction === 'submit_order') {
      const baseState = currentOrderSummaryState?.summary
        ? currentOrderSummaryState
        : {
          status: 'awaiting_confirmation',
          quoteDraftId: buildDraftId(currentOrderSummaryState),
          customerCheck: {
            checked: true,
            existsInZoho: 'stubbed',
          },
          summaryVersion: 1,
          summary: buildOrderSummaryFromCart(cart),
          artifacts: null,
        };

      nextOrderSummaryState = {
        ...baseState,
        status: 'confirmed',
        artifacts: buildStubArtifacts(baseState, baseState.artifacts || null),
      };

      try {
        const workOrderResult = await submitOrderFn({
          tenantDb,
          tenant,
          botUserId,
          payload: buildWorkOrderPayload({
            state,
            cart,
            currentOrderSummaryState: baseState,
            quoteOnly: false,
          }),
          requestContext: buildRequestContext(state),
        });
        const persistedWorkOrder = await loadWorkOrderDocuments({
          tenantDb,
          tenantId: tenant?.tenantId || null,
          workOrderNumber: String(
            workOrderResult?.workOrderNumber || workOrderResult?.workOrderId || '',
          ).trim(),
        });

        nextOrderSummaryState = {
          ...nextOrderSummaryState,
          artifacts: mapSubmittedOrderArtifacts(
            baseState,
            workOrderResult,
            persistedWorkOrder,
            baseState.artifacts || null,
          ),
        };
      } catch (error) {
        logger.warn('LangGraph order submission failed; fallback artifacts used', {
          requestId,
          error: error.message,
        });
      }
    }

    logger.info('LangGraph order summary node completed', {
      requestId,
      intent: intent.intent || null,
      decisionAction: intent.decisionAction || null,
      orderSummaryStatus: nextOrderSummaryState?.status || null,
      durationMs: Date.now() - startedAt,
    });

    return {
      orderSummaryState: nextOrderSummaryState,
    };
  };
}
