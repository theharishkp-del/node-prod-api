import { buildProductResponseFacts } from '../../chat/nodes/composeResponseNode.js';
import { getTierMultiplier } from '../../../../utils/tierPricing.js';

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

function normalizeText(value) {
  return String(value || '').trim();
}

const MULTI_PRODUCT_LINK_PROMPT = 'Press 6 to receive a link by SMS to enter multiple products.';

function buildIvrPendingDecisionFromFacts(facts) {
  const items = (facts?.items || []).map((item, index) => {
    if (item.status === 'matched') {
      return {
        itemNumber: index + 1,
        requestedReference: item.requestedReference,
        requestedQuantity: item.requestedQuantity,
        sku: item.product.sku,
        productName: item.product.productName,
        status: item.availabilityCase,
        availableNow: item.product.immediatelyAvailableForRequest,
        estimatedDate: item.product.estimatedBalanceDate,
        canAddNow: item.availabilityCase === 'fully_available',
        canBackorder: item.availabilityCase === 'lead_time_only' || item.availabilityCase === 'split_availability',
      };
    }

    if (item.status === 'suggestions') {
      return {
        itemNumber: index + 1,
        requestedReference: item.requestedReference,
        status: 'suggestions',
        options: item.options.map((option) => ({
          sku: option.sku,
          productName: option.productName,
          formattedUnitPrice: option.formattedUnitPrice,
          currentAvailable: option.currentAvailable,
        })),
      };
    }

    return {
      itemNumber: index + 1,
      requestedReference: item.requestedReference,
      status: 'unmatched',
    };
  });

  if (!items.length) {
    return null;
  }

  return {
    hasMultipleItems: items.length > 1,
    source: 'ivr_product_flow',
    items,
  };
}

function buildCartSummary(cartActionResult) {
  const itemCount = Number(cartActionResult?.cartSummary?.itemCount || cartActionResult?.pendingDecision?.items?.length || 0);
  const total = normalizeText(cartActionResult?.cartSummary?.formattedTotal) || '$0.00';

  if (!itemCount) {
    return 'Your cart is empty.';
  }

  const itemLines = (cartActionResult?.pendingDecision?.items || []).map((item) => {
    const statusText =
      item.status === 'ready_now'
        ? 'ready now'
        : item.estimatedDate
          ? `scheduled for ${item.estimatedDate}`
          : 'pending confirmation';
    return `${item.itemNumber}. ${item.sku}, quantity ${item.requestedQuantity}, ${statusText}.`;
  });

  return [
    'Here is your cart.',
    ...itemLines,
    `Cart total is ${total}.`,
  ].join(' ');
}

function buildAddablePrompt(item) {
  return item.product.estimatedBalanceDate
    ? `${item.requestedQuantity} units of ${item.product.sku} total ${item.product.formattedOrderTotal}. The full order is scheduled for ${item.product.estimatedBalanceDate}. Press 1 to add this item to your cart. Press 2 to search another item. ${MULTI_PRODUCT_LINK_PROMPT}`
    : `${item.requestedQuantity} units of ${item.product.sku} total ${item.product.formattedOrderTotal}. Press 1 to add this item to your cart. Press 2 to search another item. ${MULTI_PRODUCT_LINK_PROMPT}`;
}

function formatSingleProductReply(fact) {
  if (fact.status === 'unmatched') {
    return `I could not find a close match for ${fact.requestedReference}. Please say or enter a different SKU or product description.`;
  }

  if (fact.status === 'suggestions') {
    const options = fact.options
      .slice(0, 4)
      .map((option, index) => `Press ${index + 1} for ${option.sku} at ${option.formattedUnitPrice}.`)
      .join(' ');
    return `I found a few close matches for ${fact.requestedReference}. ${options} Press 5 to try a different product. ${MULTI_PRODUCT_LINK_PROMPT}`;
  }

  if (!fact.requestedQuantity) {
    const availability = fact.product.currentAvailable > 0
      ? `${fact.product.currentAvailable} available now.`
      : fact.product.estimatedBalanceDate
        ? `Expected on ${fact.product.estimatedBalanceDate}.`
        : 'Availability needs confirmation.';
    return `I found ${fact.product.productName}. Price is ${fact.product.formattedUnitPrice} each. ${availability} Please say or enter the quantity.`;
  }

  if (fact.availabilityCase === 'fully_available') {
    return buildAddablePrompt(fact);
  }

  if (fact.availabilityCase === 'split_availability') {
    return `${fact.requestedQuantity} units of ${fact.product.sku} total ${fact.product.formattedOrderTotal}. ${fact.product.immediatelyAvailableForRequest} are available now, and the remaining ${fact.product.remainingQuantity} are expected on ${fact.product.estimatedBalanceDate || 'the next delivery date'}. Press 1 to add the full order to your cart. Press 2 to search another item. ${MULTI_PRODUCT_LINK_PROMPT}`;
  }

  return buildAddablePrompt(fact);
}

function formatMultiItemReply(facts) {
  const lines = [];
  let pressNumber = 1;

  for (const item of facts.items.slice(0, 4)) {
    if (item.status === 'suggestions') {
      for (const option of item.options.slice(0, 4 - lines.length)) {
        lines.push(`Press ${pressNumber} for ${option.sku} at ${option.formattedUnitPrice}.`);
        pressNumber += 1;
      }
      continue;
    }

    if (item.status === 'matched' && item.requestedQuantity) {
      lines.push(`Item ${pressNumber} is ${item.product.sku}, quantity ${item.requestedQuantity}, total ${item.product.formattedOrderTotal}.`);
      pressNumber += 1;
      continue;
    }

    if (item.status === 'matched') {
      lines.push(`${item.product.sku} is ${item.product.formattedUnitPrice} each. Please say the quantity for that item.`);
      pressNumber += 1;
    }
  }

  const omittedItems = facts.items.slice(4);
  const unmatchedItemNumbers = facts.items
    .map((item, index) => ({ item, itemNumber: index + 1 }))
    .filter(({ item }) => item.status === 'unmatched')
    .map(({ itemNumber }) => itemNumber);

  if (!lines.length) {
    if (unmatchedItemNumbers.length) {
      return `I could not identify item ${unmatchedItemNumbers.join(', ')}. Please say that SKU or product description again. ${MULTI_PRODUCT_LINK_PROMPT}`;
    }

    return 'Please say or enter the SKU or product description you want to order.';
  }

  const omittedNotice = omittedItems.length
    ? ` I heard ${facts.items.length} items in total. The remaining ${omittedItems.length} item${omittedItems.length === 1 ? '' : 's'} were retained, but are not read aloud. Use the SMS link for the complete multi-product order.`
    : '';
  const unmatchedNotice = unmatchedItemNumbers.length
    ? ` I could not identify item ${unmatchedItemNumbers.join(', ')}. Please repeat ${unmatchedItemNumbers.length === 1 ? 'that item' : 'those items'} before continuing.`
    : '';

  return `${lines.join(' ')}${omittedNotice}${unmatchedNotice} Press 5 to try a different product. ${MULTI_PRODUCT_LINK_PROMPT}`;
}

function formatOrderSummaryReply(orderSummaryState) {
  const summary = orderSummaryState?.summary || { lines: [], formattedTotal: '$0.00' };
  const firstLine = summary.lines[0];
  const itemText = summary.lines.length === 1
    ? `Your cart has 1 item. ${firstLine?.sku}, quantity ${firstLine?.quantity}.`
    : `Your cart has ${summary.lines.length} items.`;

  return `${itemText} Order total is ${summary.formattedTotal}. I have sent the order summary and quote by SMS. Press 1 to confirm the order and receive the invoice and payment link by SMS. Press 2 to review your cart. Press 5 to add another item. ${MULTI_PRODUCT_LINK_PROMPT}`;
}

function formatOrderSubmittedReply(orderSummaryState) {
  const orderReferenceNumber = normalizeText(
    orderSummaryState?.artifacts?.coreOrder?.referenceNumber,
  );

  if (orderReferenceNumber) {
    return `Your order is confirmed. Your order reference number is ${orderReferenceNumber}. I have sent the invoice and payment link by SMS. Thank you.`;
  }

  return 'Your order is confirmed. I have sent the invoice and payment link by SMS. Thank you.';
}

export function createComposeResponseNode({ tenantDb = null } = {}) {
  return async function composeIvrResponseNode(state) {
    let tierMultiplier = 1;

    try {
      if (tenantDb) {
        const customer = await tenantDb.collection('md_customers').findOne({
          tenantId: state.agentPayload?.databaseInfo?.tenantId,
          $or: [
            { 'contact.emailId': state.agentPayload?.customerInfo?.emailId },
            { email: state.agentPayload?.customerInfo?.emailId },
          ],
          isDeleted: { $ne: true },
        });

        if (customer?.tierId) {
          tierMultiplier = await getTierMultiplier(tenantDb, customer.tierId);
        }
      }
    } catch {
      // Keep the IVR available with base pricing if tier lookup is unavailable.
    }

    const facts = buildProductResponseFacts({
      intent: state.intent,
      productResults: state.productResults,
      agentPayload: state.agentPayload,
      tierMultiplier,
    });
    const cartActionResult = state.cartActionResult || null;
    const orderSummaryState = state.orderSummaryState || null;
    const productPendingDecision = buildIvrPendingDecisionFromFacts(facts);
    let resolvedPendingDecision = state.pendingDecision || null;

    let reply = 'Please say or enter the SKU or product description you want to order.';
    let conversationStatus = 'active';

    if (state.intent?.intent === 'order_submit' && orderSummaryState?.status === 'confirmed') {
      reply = formatOrderSubmittedReply(orderSummaryState);
      conversationStatus = 'order_completed';
    } else if (state.intent?.intent === 'order_summary' && orderSummaryState?.status === 'awaiting_confirmation') {
      reply = formatOrderSummaryReply(orderSummaryState);
    } else if (state.intent?.intent === 'order_summary' && orderSummaryState?.status === 'empty_cart') {
      reply = 'Your cart is empty. Please say or enter a SKU or product description to add an item.';
    } else if (cartActionResult?.type === 'cart_view') {
      reply = `${buildCartSummary(cartActionResult)} Press 1 to receive the order summary and quote by SMS. Press 2 to hear the cart again. Press 5 to add another item. ${MULTI_PRODUCT_LINK_PROMPT}`;
    } else if (cartActionResult?.type === 'cart_add' || cartActionResult?.type === 'cart_update') {
      reply = `${normalizeText(cartActionResult.message)} ${buildCartSummary(cartActionResult)} Press 1 to receive the order summary and quote by SMS. Press 2 to hear the cart again. Press 5 to add another item. ${MULTI_PRODUCT_LINK_PROMPT}`;
    } else if (cartActionResult?.type === 'cart_remove') {
      reply = `${normalizeText(cartActionResult.message)} ${buildCartSummary(cartActionResult)} Press 1 to receive the order summary and quote by SMS. Press 2 to hear the cart again. Press 5 to add another item. ${MULTI_PRODUCT_LINK_PROMPT}`;
    } else if (cartActionResult?.type === 'cart_clear_confirmation') {
      reply = 'Press 1 to clear your cart. Press 2 to keep your cart.';
    } else if (cartActionResult?.type === 'cart_clear') {
      reply = 'Your cart is cleared. Please say or enter a SKU or product description to start a new order.';
      resolvedPendingDecision = null;
    } else if (!facts.items.length) {
      reply = normalizeText(state.intent?.clarificationQuestion) || reply;
      if (state.intent?.intent === 'product_enquiry') {
        resolvedPendingDecision = null;
      }
    } else if (facts.items.length === 1) {
      reply = formatSingleProductReply(facts.items[0]);
      resolvedPendingDecision = productPendingDecision;
    } else {
      reply = formatMultiItemReply(facts);
      resolvedPendingDecision = productPendingDecision;
    }

    const recentTurns = [
      ...(Array.isArray(state.recentTurns) ? state.recentTurns : []),
      {
        userMessage: state.agentPayload?.metadata?.originalIvrUserMessage || state.agentPayload?.userMessage || '',
        reply,
      },
    ].slice(-6);

    return {
      reply,
      recentTurns,
      pendingDecision: resolvedPendingDecision,
      pendingCartActionConfirmation: state.pendingCartActionConfirmation || null,
      conversationStatus,
    };
  };
}
