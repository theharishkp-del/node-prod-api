import { logger } from '../../../../config/logger.js';
import { formatLeadDate, formatMoney } from '../../../../utils/money.js';
import { calculateTierPrice } from '../../../../utils/tierPricing.js';

function buildEmptyCart() {
  return {
    items: [],
    currency: 'USD',
    updatedAt: null,
  };
}

function cloneCart(cart) {
  const resolvedCart = cart?.items ? cart : buildEmptyCart();
  return {
    ...resolvedCart,
    items: resolvedCart.items.map((item) => ({ ...item })),
  };
}

/**
 * Builds cart item from product, applying tier-based pricing if multiplier is provided
 * @param {Object} result - Product search result with matches
 * @param {Object} agentPayload - Agent payload with session info
 * @param {number} tierMultiplier - Tier multiplier for pricing (optional, defaults to 1)
 * @returns {Object|null} - Cart item or null if invalid
 */
function buildCartItemFromResult(result, agentPayload, tierMultiplier = 1) {
  const product = result.matches?.[0];
  const quantity = Number(result.requestedItem?.quantity || 0);

  if (!product?.sku || !Number.isInteger(quantity) || quantity <= 0 || quantity > 1000) {
    return null;
  }

  // Get base price and apply tier multiplier
  const basePrice = Number(product.sellingPrice || 0);
  const unitPrice = calculateTierPrice(basePrice, tierMultiplier);
  const qtyAvailable = Math.max(0, Number(product.qtyAvailable || 0));
  const estimatedDate = formatLeadDate(agentPayload, product.leadTimeDays);

  return {
    sku: product.sku,
    productName: product.productName,
    description: product.description,
    category: product.category,
    quantity,
    unit: product.unit || 'EA',
    unitPrice,
    currency: product.currency || 'USD',
    formattedUnitPrice: formatMoney(unitPrice, product.currency),
    lineTotal: unitPrice * quantity,
    formattedLineTotal: formatMoney(unitPrice * quantity, product.currency),
    qtyAvailable,
    estimatedDate,
    fulfillmentStatus:
      qtyAvailable >= quantity
        ? 'ready_now'
        : estimatedDate
          ? 'full_order_scheduled'
          : 'full_order_pending_confirmation',
    tierMultiplier, // Store tier multiplier for reference
  };
}

function buildMergedCartItem(existingItem, nextCartItem, agentPayload) {
  const quantity = Number(existingItem.quantity || 0) + Number(nextCartItem.quantity || 0);
  const qtyAvailable = Math.max(0, Number(nextCartItem.qtyAvailable || 0));
  const estimatedDate = nextCartItem.estimatedDate || existingItem.estimatedDate || null;
  const unitPrice = Number(nextCartItem.unitPrice || existingItem.unitPrice || 0);
  const currency = nextCartItem.currency || existingItem.currency || 'USD';

  return {
    ...existingItem,
    ...nextCartItem,
    quantity,
    unitPrice,
    currency,
    formattedUnitPrice: formatMoney(unitPrice, currency),
    lineTotal: unitPrice * quantity,
    formattedLineTotal: formatMoney(unitPrice * quantity, currency),
    qtyAvailable,
    estimatedDate,
    fulfillmentStatus:
      qtyAvailable >= quantity
        ? 'ready_now'
        : estimatedDate
          ? 'full_order_scheduled'
          : 'full_order_pending_confirmation',
  };
}

function upsertCartItem(cart, cartItem) {
  const existingIndex = cart.items.findIndex((item) => item.sku === cartItem.sku);

  if (existingIndex >= 0) {
    const mergedItem = buildMergedCartItem(cart.items[existingIndex], cartItem);
    cart.items[existingIndex] = mergedItem;
    return mergedItem;
  }

  cart.items.push(cartItem);
  return cartItem;
}

function replaceCartItemQuantity(cart, cartItem) {
  const existingIndex = cart.items.findIndex((item) => item.sku === cartItem.sku);

  if (existingIndex < 0) {
    cart.items.push(cartItem);
    return cartItem;
  }

  cart.items[existingIndex] = {
    ...cart.items[existingIndex],
    ...cartItem,
    quantity: Number(cartItem.quantity || 0),
    lineTotal: Number(cartItem.lineTotal || 0),
    formattedLineTotal: cartItem.formattedLineTotal,
    formattedUnitPrice: cartItem.formattedUnitPrice,
    fulfillmentStatus: cartItem.fulfillmentStatus,
    estimatedDate: cartItem.estimatedDate,
    qtyAvailable: cartItem.qtyAvailable,
  };

  return cart.items[existingIndex];
}

function buildCartPendingDecision(cart) {
  return {
    hasMultipleItems: cart.items.length > 1,
    type: 'cart_review',
    items: cart.items.map((item, index) => ({
      itemNumber: index + 1,
      sku: item.sku,
      productName: item.productName,
        description: item.description,
        category: item.category,
      requestedReference: item.sku,
      requestedQuantity: item.quantity,
      status: item.fulfillmentStatus,
      availableNow: item.qtyAvailable,
      estimatedDate: item.estimatedDate,
    })),
  };
}

function buildCartSummary(cart) {
  const currency = cart.items[0]?.currency || cart.currency || 'USD';
  const total = cart.items.reduce((sum, item) => sum + Number(item.lineTotal || 0), 0);

  return {
    itemCount: cart.items.length,
    total,
    formattedTotal: formatMoney(total, currency),
  };
}

function removeCartItems(cart, referencedItems = [], pendingDecision = null, skuCandidates = []) {
  // Build the set of SKUs to remove.
  // Priority 1: item numbers from pendingDecision (e.g. "item 3 remove")
  // Priority 2: current cart position when the saved display mapping is absent
  // Priority 3: direct SKU candidates (e.g. "remove B12-SW" from UI or chat)
  const pendingItems = pendingDecision?.items || [];
  const skuSet = new Set([
    ...referencedItems
      .map((itemNumber) => (
        pendingItems.find((item) => item.itemNumber === itemNumber)?.sku ||
        cart.items[Number(itemNumber) - 1]?.sku
      ))
      .filter(Boolean),
    ...skuCandidates.filter(Boolean),
  ]);

  if (!skuSet.size) {
    return [];
  }

  const removedItems = cart.items.filter((item) => skuSet.has(item.sku));
  cart.items = cart.items.filter((item) => !skuSet.has(item.sku));
  return removedItems;
}

function buildCartActionResult({ type, message, cart, changedItems = [], pendingDecision }) {
  return {
    type,
    message,
    changedItems,
    cartSummary: buildCartSummary(cart),
    pendingDecision,
  };
}

function buildUpdatedOrderSummaryState(currentOrderSummaryState, cart, actionType) {
  if (!currentOrderSummaryState) {
    return currentOrderSummaryState;
  }

  if (actionType === 'cart_clear') {
    return {
      ...currentOrderSummaryState,
      status: 'empty_cart',
      summaryVersion: Number(currentOrderSummaryState.summaryVersion || 0) + 1,
      summary: {
        itemCount: 0,
        currency: cart.currency || 'USD',
        total: 0,
        formattedTotal: formatMoney(0, cart.currency || 'USD'),
        lines: [],
      },
    };
  }

  if (['cart_add', 'cart_remove', 'cart_update'].includes(actionType)) {
    return {
      ...currentOrderSummaryState,
      status: 'editing',
    };
  }

  return currentOrderSummaryState;
}

// Step 4: apply only the verified product results and validated intent to cart state.
// The returned cartActionResult is the source of truth for the response node.
export function createCartActionNode(options = {}) {
  const { tenantDb = null } = options;

  return async function cartActionNode(state) {
    const startedAt = Date.now();
    const requestId = state.agentPayload.sessionInfo.requestId;
    const intent = state.intent || {};
    const cart = cloneCart(state.cart);
    const currentPendingDecision = state.pendingDecision || null;

    if (state.pendingImageConfirmation?.uncertainItems?.length && intent.intent === 'cart_add') {
      return {
        cart,
        cartActionResult: buildCartActionResult({
          type: 'image_confirmation_required',
          message: 'Please confirm the unclear image details before adding these items to your cart.',
          cart,
          pendingDecision: currentPendingDecision,
        }),
        pendingImageConfirmation: state.pendingImageConfirmation,
      };
    }

    // Fetch customer's tier multiplier for pricing
    let tierMultiplier = 1;
    try {
      if (tenantDb) {
        const { getTierMultiplier } = await import('../../../../utils/tierPricing.js');
        const MASTER_DATA_CUSTOMERS_COLLECTION = 'md_customers';

        const customer = await tenantDb.collection(MASTER_DATA_CUSTOMERS_COLLECTION).findOne({
          tenantId: state.agentPayload.databaseInfo.tenantId,
          $or: [
            { 'contact.emailId': state.agentPayload.customerInfo.emailId },
            { email: state.agentPayload.customerInfo.emailId },
          ],
          isDeleted: { $ne: true },
        });

        if (customer?.tierId) {
          tierMultiplier = await getTierMultiplier(tenantDb, customer.tierId);
        }
      }
    } catch (error) {
      logger.warn('Failed to fetch customer tier multiplier, using default pricing', {
        requestId,
        error: error.message,
      });
    }

    logger.info('LangGraph cart action started', {
      requestId,
      intent: intent.intent || null,
      decisionAction: intent.decisionAction || null,
      cartItemCount: cart.items.length,
      tierMultiplier,
    });

    let cartActionResult = null;
    let nextPendingDecision = currentPendingDecision;
    let nextPendingCartActionConfirmation = state.pendingCartActionConfirmation || null;
    let nextOrderSummaryState = state.orderSummaryState || null;
    const removedItems = [];
    const removeReferencedItems = Array.isArray(intent.removeReferencedItems)
      ? intent.removeReferencedItems
      : [];

    if (intent.decisionAction === 'clear_cart' && !intent.clearCartConfirmed) {
      cartActionResult = buildCartActionResult({
        type: 'cart_clear_confirmation',
        message: 'Are you sure you want me to clear your cart?',
        cart,
        pendingDecision: buildCartPendingDecision(cart),
      });
      nextPendingCartActionConfirmation = { action: 'clear_cart' };
    } else if (intent.decisionAction === 'confirm_clear_cart' && intent.clearCartConfirmed) {
      const clearedItems = [...cart.items];
      cart.items = [];
      nextPendingDecision = buildCartPendingDecision(cart);
      cartActionResult = buildCartActionResult({
        type: 'cart_clear',
        message: 'I cleared your cart.',
        cart,
        changedItems: clearedItems,
        pendingDecision: nextPendingDecision,
      });
      nextPendingCartActionConfirmation = null;
    } else if (intent.intent === 'cart_view') {
      nextPendingDecision = buildCartPendingDecision(cart);
      cartActionResult = buildCartActionResult({
        type: 'cart_view',
        message: cart.items.length ? 'Here is your current cart.' : 'Your cart is empty.',
        cart,
        pendingDecision: nextPendingDecision,
      });
      nextPendingCartActionConfirmation = null;
    } else if (!cartActionResult && (intent.intent === 'cart_remove' || removeReferencedItems.length)) {
      // Collect SKU candidates from intent items (used when UI sends "remove SKU-XXX" directly)
      const skuCandidatesFromIntent = (intent.items || [])
        .map((item) => item.skuCandidate)
        .filter(Boolean);
      removedItems.push(...removeCartItems(
        cart,
        removeReferencedItems.length ? removeReferencedItems : (intent.referencedItems || []),
        currentPendingDecision,
        skuCandidatesFromIntent,
      ));
    }

    if (!cartActionResult && intent.intent === 'cart_remove' && !(state.productResults || []).length) {
      nextPendingDecision = buildCartPendingDecision(cart);
      cartActionResult = buildCartActionResult({
        type: 'cart_remove',
        message: removedItems.length
          ? 'I removed that item from your cart.'
          : 'I could not find those item numbers in your cart.',
        cart,
        changedItems: removedItems,
        pendingDecision: nextPendingDecision,
      });
      nextPendingCartActionConfirmation = null;
    } else if (!cartActionResult && (
      intent.intent === 'cart_add' ||
      (intent.intent === 'product_enquiry' && (intent.decisionAction === 'choose_option' || intent.decisionAction === 'add')) ||
      (intent.intent === 'cart_update' && intent.decisionAction === 'change_qty') ||
      ((state.productResults || []).length && removeReferencedItems.length)
    )) {
      const changedItems = [];
      const isQuantityReplace =
        intent.intent === 'cart_update' && intent.decisionAction === 'change_qty';

      for (const result of state.productResults || []) {
        if (result.status !== 'matched' || result.matches.length !== 1) {
          continue;
        }

        // Pass tier multiplier to cart item builder
        const cartItem = buildCartItemFromResult(result, state.agentPayload, tierMultiplier);

        if (!cartItem) {
          continue;
        }

        const appliedCartItem = isQuantityReplace
          ? replaceCartItemQuantity(cart, cartItem)
          : upsertCartItem(cart, cartItem);
        changedItems.push(appliedCartItem);
      }

      if (changedItems.length || removedItems.length) {
        nextPendingDecision = buildCartPendingDecision(cart);
        cartActionResult = buildCartActionResult({
          type:
            removedItems.length && changedItems.length
              ? 'cart_update'
              : intent.intent === 'cart_add'
                ? 'cart_add'
                : 'cart_update',
          message:
            removedItems.length && changedItems.length
              ? 'I updated your cart.'
              : intent.intent === 'cart_add'
                ? (changedItems.length === 1
                  ? 'I added 1 item to your cart.'
                  : `I added ${changedItems.length} items to your cart.`)
                : 'I updated your cart.',
          cart,
          changedItems: [...removedItems, ...changedItems],
          pendingDecision: nextPendingDecision,
        });
        nextPendingCartActionConfirmation = null;
      }
    }

    cart.updatedAt = new Date().toISOString();

    logger.info('LangGraph cart action completed', {
      requestId,
      actionType: cartActionResult?.type || 'none',
      cartItemCount: cart.items.length,
      changedItemCount: cartActionResult?.changedItems?.length || 0,
      durationMs: Date.now() - startedAt,
    });

    return {
      cart,
      cartActionResult,
      pendingDecision: nextPendingDecision,
      pendingCartActionConfirmation: nextPendingCartActionConfirmation,
      orderSummaryState: buildUpdatedOrderSummaryState(
        nextOrderSummaryState,
        cart,
        cartActionResult?.type || null,
      ),
    };
  };
}
