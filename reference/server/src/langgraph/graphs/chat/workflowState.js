function pendingItemsOfType(pendingDecision, predicate) {
  return (Array.isArray(pendingDecision?.items) ? pendingDecision.items : [])
    .filter(predicate);
}

export function deriveActivePrompt({
  pendingDecision = null,
  pendingCartActionConfirmation = null,
  pendingImageConfirmation = null,
  orderSummaryState = null,
} = {}) {
  if (pendingCartActionConfirmation?.action === 'clear_cart') {
    return {
      type: 'confirm_cart_clear',
      expectedReply: 'yes_no',
    };
  }

  if (pendingImageConfirmation?.uncertainItems?.length) {
    return {
      type: 'confirm_image_details',
      expectedReply: 'confirmation',
    };
  }

  if (orderSummaryState?.status === 'awaiting_confirmation') {
    return {
      type: 'confirm_order',
      expectedReply: 'confirmation_or_cart_edit',
    };
  }

  const suggestionItems = pendingItemsOfType(
    pendingDecision,
    (item) => item?.status === 'suggestions' && Array.isArray(item.options) && item.options.length > 0,
  );
  const quantityItems = pendingItemsOfType(
    pendingDecision,
    (item) => item?.status === 'quantity_missing',
  );
  if (suggestionItems.length && quantityItems.length) {
    return {
      type: 'resolve_items',
      expectedReply: 'item_action',
      itemNumbers: [...new Set([
        ...suggestionItems.map((item) => item.itemNumber),
        ...quantityItems.map((item) => item.itemNumber),
      ])],
      requirements: [
        ...suggestionItems.map((item) => ({
          itemNumber: item.itemNumber,
          type: 'select_option',
          validOptionNumbers: item.options.map((option, index) => index + 1),
        })),
        ...quantityItems.map((item) => ({
          itemNumber: item.itemNumber,
          type: 'provide_quantity',
          sku: item.sku || null,
        })),
      ],
    };
  }

  if (suggestionItems.length) {
    return {
      type: 'select_option',
      expectedReply: 'item_and_option_number',
      itemNumbers: suggestionItems.map((item) => item.itemNumber),
      optionsByItem: Object.fromEntries(suggestionItems.map((item) => [
        item.itemNumber,
        item.options.map((option, index) => ({
          optionNumber: index + 1,
          sku: option.sku,
        })),
      ])),
    };
  }

  if (quantityItems.length) {
    return {
      type: 'provide_quantity',
      expectedReply: 'item_and_quantity',
      itemNumbers: quantityItems.map((item) => item.itemNumber),
      skusByItem: Object.fromEntries(quantityItems.map((item) => [item.itemNumber, item.sku || null])),
    };
  }

  if (pendingDecision?.type === 'cart_review' && pendingDecision?.items?.length) {
    return {
      type: 'cart_action',
      expectedReply: 'cart_command',
      itemNumbers: pendingDecision.items.map((item) => item.itemNumber),
    };
  }

  const addableItems = pendingItemsOfType(
    pendingDecision,
    (item) => ['fully_available', 'lead_time_only', 'split_availability'].includes(item?.status),
  );
  if (addableItems.length) {
    return {
      type: 'confirm_add',
      expectedReply: 'item_confirmation',
      itemNumbers: addableItems.map((item) => item.itemNumber),
    };
  }

  return null;
}

export function deriveWorkflowStage({
  cart = null,
  pendingDecision = null,
  pendingCartActionConfirmation = null,
  pendingImageConfirmation = null,
  orderSummaryState = null,
  conversationStatus = null,
  activePrompt = null,
} = {}) {
  if (conversationStatus === 'order_completed' || orderSummaryState?.status === 'confirmed') {
    return 'order_completed';
  }

  const prompt = activePrompt || deriveActivePrompt({
    pendingDecision,
    pendingCartActionConfirmation,
    pendingImageConfirmation,
    orderSummaryState,
  });

  const promptStages = {
    select_option: 'awaiting_option_selection',
    provide_quantity: 'awaiting_quantity',
    cart_action: 'reviewing_cart',
    confirm_cart_clear: 'awaiting_cart_clear_confirmation',
    confirm_image_details: 'awaiting_image_confirmation',
    confirm_order: 'awaiting_order_confirmation',
    resolve_items: 'awaiting_item_resolution',
    confirm_add: 'awaiting_add_confirmation',
  };

  if (prompt?.type && promptStages[prompt.type]) {
    return promptStages[prompt.type];
  }

  if (cart?.items?.length) {
    return 'reviewing_cart';
  }

  return 'browsing';
}
