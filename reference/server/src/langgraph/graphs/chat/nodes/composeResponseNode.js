import { logger } from '../../../../config/logger.js';
import { deriveActivePrompt, deriveWorkflowStage } from '../workflowState.js';
import { formatLeadDate, formatMoney } from '../../../../utils/money.js';
import { calculateTierPrice } from '../../../../utils/tierPricing.js';

// ─── Formatting helpers ────────────────────────────────────────────────────

const EMOJI_NUMBERS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
const REPLY_OPTION_PREFIX = '➡️';
const UNRELATED_SEARCH_REFERENCE_MAX_LENGTH = 60;
const UNRELATED_REPLY =
  'Hello! Thanks for reaching out. I can help with cabinet products, pricing, dimensions, availability, and orders. Please send a cabinet SKU or product description with quantity.';

function emojiNumber(n) {
  return EMOJI_NUMBERS[n - 1] || `${n}.`;
}

function itemLabel(n) {
  return `Item ${n}`;
}

function replyOption(text) {
  return `${REPLY_OPTION_PREFIX} ${text}`;
}

function formatUnrelatedSearchReference(userMessage) {
  const normalized = String(userMessage || '').replace(/\s+/g, ' ').trim();
  const withoutTrailingQuantity = normalized
    .replace(/\b(?:qty|quantity)\s*:?\s*\d+\b/gi, '')
    .replace(/\b\d+\s*(?:qty|quantity)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  const reference = withoutTrailingQuantity || normalized;

  if (!reference) {
    return '';
  }

  const shortenedReference = reference.length > UNRELATED_SEARCH_REFERENCE_MAX_LENGTH
    ? `${reference.slice(0, UNRELATED_SEARCH_REFERENCE_MAX_LENGTH - 3).trimEnd()}...`
    : reference;

  return shortenedReference.replace(/([\\*`])/g, '\\$1');
}

function formatUnrelatedSearchReply(userMessage) {
  const searchReference = formatUnrelatedSearchReference(userMessage);

  if (!searchReference) {
    return UNRELATED_REPLY;
  }

  return [
    `Thank you for your interest! Unfortunately, I couldn't find **${searchReference}** in our current inventory.`,
    '',
    "Here's how I can help:",
    '',
    replyOption('Search again with a different SKU or product name'),
  ].join('\n');
}

function multipleSelectionReplyGuidance() {
  return [
    'Please choose from the options above.',
    'For multiple items, send one selection per line:',
    '',
    '**Example:**',
    replyOption('item 1 option 1 qty 1'),
    replyOption('item 2 option 2 qty 2'),
  ];
}

function replaceReplyBullets(text) {
  return String(text || '').replace(/(^|\n)[\t ]*(?:[-*•])[\t ]+/g, `$1${REPLY_OPTION_PREFIX} `);
}

function itemStatusIcon(status) {
  switch (status) {
    case 'ready_now':
    case 'fully_available':
      return '✅';
    case 'quantity_missing':
      return '⚠️';
    case 'unmatched':
      return '❌';
    case 'suggestions':
      return '🔍';
    case 'lead_time_only':
    case 'split_availability':
    case 'full_order_scheduled':
      return '🕐';
    default:
      return '🔹';
  }
}

function availabilityBadge(status, estimatedDate) {
  if (status === 'ready_now' || status === 'fully_available') {
    return '🟢 Available Now';
  }
  if (estimatedDate) {
    return `🕐 Scheduled for ${estimatedDate}`;
  }
  return '🔸 Pending Confirmation';
}

function productDetailsLines(product = {}) {
  return [
    `   **Description:** ${product.description || product.productName || 'N/A'}`,
    `   **Category:** ${product.category || 'N/A'}`,
  ];
}

function productPricingLines(product = {}, quantity = null) {
  const lines = [
    `   **Unit Price:** ${product.formattedUnitPrice || '—'}`,
  ];

  if (quantity) {
    lines.push(`   **Qty:** ${quantity}   **Total:** ${product.formattedOrderTotal || '—'}`);
  }

  return lines;
}

const RESPONSE_SYSTEM_PROMPT = [
  'Write a brief, natural sales-assistant response using only the supplied inventory facts.',
  'Never invent or change SKU, price, quantity, stock, total, lead time, or date.',
  'Never use the phrase "out of stock".',
  'If quantity is missing, state price and useful availability, then ask for quantity.',
  'If requested quantity is fully available, ask permission to add that quantity to the cart.',
  'If some quantity is available now and the balance has a lead date, clearly state both and offer only the full requested order quantity.',
  'If none is available now, state when the full quantity is expected and ask whether to take the full order for that date.',
  'For suggestions, show at most three options and ask the customer to choose.',
  'Start with a short, warm customer-facing introduction such as "Thank you for your interest" or "Here is what I found for you."',
  'Use valid Markdown: wrap important labels and SKUs in **double asterisks** for bold. Prefix every action or reply option with ➡️, never a hyphen or other bullet. Do not use > for reply options.',
  'Do not mention internal tools, policies, JSON, graph states, or implementation status.',
  'When listing multiple items always number them using emoji digits: 1️⃣ for item 1, 2️⃣ for item 2, 3️⃣ for item 3, and so on.',
  'For each listed item show the SKU, product name, quantity, unit price, total, and availability on separate indented lines.',
  'Use 🟢 Available Now for items fully in stock, 🕐 Scheduled for <date> for lead-time items, ⚠️ Quantity Missing when no quantity was given, and ❌ Product Not Found for unmatched items.',
  'When asking the customer to choose an action, list the options as 1️⃣ Option one 2️⃣ Option two etc.',
].join(' ');

function buildMatchedProductFacts(result, payload, tierMultiplier = 1) {
  const product = result.matches[0];
  const requestedQuantity = result.requestedItem.quantity;
  const currentAvailable = Math.max(0, Number(product.qtyAvailable || 0));
  const basePrice = Number(product.sellingPrice || 0);
  
  // Apply tier multiplier to base price
  const unitPrice = calculateTierPrice(basePrice, tierMultiplier);
  
  const remainingQuantity = requestedQuantity
    ? Math.max(0, requestedQuantity - currentAvailable)
    : null;
  let availabilityCase = 'quantity_missing';

  if (requestedQuantity && currentAvailable <= 0) {
    availabilityCase = 'lead_time_only';
  } else if (requestedQuantity && remainingQuantity > 0) {
    availabilityCase = 'split_availability';
  } else if (requestedQuantity) {
    availabilityCase = 'fully_available';
  }

  return {
    status: 'matched',
    requestedReference: result.requestedItem.rawReference,
    requestedQuantity,
    availabilityCase,
    product: {
      sku: product.sku,
      productName: product.productName,
      description: product.description,
      category: product.category,
      unitPrice,
      formattedUnitPrice: formatMoney(unitPrice, product.currency),
      currency: product.currency,
      unit: product.unit,
      currentAvailable,
      immediatelyAvailableForRequest: requestedQuantity
        ? Math.min(currentAvailable, requestedQuantity)
        : currentAvailable,
      remainingQuantity,
      leadTimeDays: product.leadTimeDays,
      estimatedBalanceDate: formatLeadDate(payload, product.leadTimeDays),
      orderTotal: requestedQuantity ? unitPrice * requestedQuantity : null,
      formattedOrderTotal: requestedQuantity
        ? formatMoney(unitPrice * requestedQuantity, product.currency)
        : null,
      tierMultiplier,
      basePrice,
    },
  };
}

function buildPendingDecision(facts, options = {}) {
  const items = facts.items.map((item, index) => {
    if (item.status === 'matched') {
      return {
        itemNumber: index + 1,
        requestedReference: item.requestedReference,
        requestedQuantity: item.requestedQuantity,
        sku: item.product.sku,
        productName: item.product.productName,
        description: item.product.description,
        category: item.product.category,
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
        requestedQuantity: item.requestedQuantity,
        status: 'suggestions',
        options: item.options.map((option) => ({
          sku: option.sku,
          productName: option.productName,
          description: option.description,
          category: option.category,
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

  return {
    hasMultipleItems: items.length > 1,
    source: options.source || 'default',
    items,
  };
}

function formatGuidedNextSteps(pendingDecision) {
  if (!pendingDecision?.items?.length) {
    return '';
  }

  const addableItems = pendingDecision.items
    .filter((item) => ['fully_available', 'lead_time_only', 'split_availability'].includes(item.status))
    .map((item) => item.itemNumber);
  const quantityMissingItems = pendingDecision.items
    .filter((item) => item.status === 'quantity_missing')
    .map((item) => item.itemNumber);
  const suggestionItems = pendingDecision.items
    .filter((item) => item.status === 'suggestions')
    .map((item) => item.itemNumber);
  const unmatchedItems = pendingDecision.items
    .filter((item) => item.status === 'unmatched')
    .map((item) => item.itemNumber);

  const hasMixedActions =
    (addableItems.length > 0 || quantityMissingItems.length > 0) &&
    (quantityMissingItems.length > 0 || suggestionItems.length > 0);

  // Keep actions separate when multiple follow-ups are required.
  if (hasMixedActions && addableItems.length && quantityMissingItems.length) {
    const lines = ['⚠️ Some items need quantities.'];
    lines.push('');

    if (addableItems.length) {
      lines.push('**Add the items that are ready:**');
      lines.push(replyOption(`add ${addableItems.join(',')}`));
      lines.push('');
    }

    lines.push('**Provide quantity for each item below:**');
    quantityMissingItems.forEach((itemNumber) => {
      lines.push(replyOption(`item ${itemNumber} qty 1`));
    });

    if (suggestionItems.length) {
      lines.push('');
      lines.push('**Choose options for unresolved items:**');
      suggestionItems.forEach((itemNumber) => {
        lines.push(replyOption(`item ${itemNumber} option 1 qty 1`));
      });
    }

    if (unmatchedItems.length) {
      lines.push('');
      lines.push('**Or skip items not found:**');
      lines.push(replyOption(`skip ${unmatchedItems.join(',')}`));
    }

    lines.push('');
    lines.push(replyOption('show cart'));
    return lines.join('\n');
  }

  // Simple case — only one action type, single reply is safe.
  const lines = ['**Reply with:**'];

  if (addableItems.length) {
    lines.push(replyOption(`add ${addableItems.join(',')}`));
  }

  if (quantityMissingItems.length) {
    quantityMissingItems.slice(0, 3).forEach((itemNumber) => {
      lines.push(replyOption(`item ${itemNumber} qty 1`));
    });
  }

  if (suggestionItems.length) {
    const suggestionExamples = suggestionItems
      .slice(0, 3)
      .map((itemNumber) => `item ${itemNumber} option 1`)
      .join(', ');
    lines.push(replyOption(suggestionExamples));
  }

  if (unmatchedItems.length) {
    lines.push(replyOption(`skip ${unmatchedItems.join(',')}`));
    lines.push(replyOption('item 6 W1230-SW qty 2'));
  }

  lines.push(replyOption('show cart'));
  lines.push(replyOption('Send a new SKU or product description to add another item'));
  return lines.join('\n');
}

function formatExtractedFileNextSteps({
  hasMatchedItems,
  quantityItemNumber,
  hasSuggestionItems,
  suggestionItemNumber,
}) {
  const lines = [];

  if (hasMatchedItems && (quantityItemNumber || hasSuggestionItems)) {
    // Two-step guidance when both matched items and pending actions exist —
    // mixing them in one message causes the parser to misfire.
    lines.push('**Reply with:**');
    lines.push('');
    lines.push('Reply in two messages:');
    lines.push('');
    lines.push('**First, confirm matched items:**');
    lines.push(replyOption('yes'));
    lines.push('');
    lines.push('**Then resolve the remaining items:**');

    if (quantityItemNumber) {
      lines.push(replyOption(`item ${quantityItemNumber} qty 2`));
    }

    if (hasSuggestionItems && suggestionItemNumber) {
      lines.push(replyOption(`item ${suggestionItemNumber} option 1 qty 1`));
    }
  } else {
    // Only one type of action needed — single reply is safe.
    lines.push('**Reply with:**');

    if (hasMatchedItems) {
      lines.push(replyOption('yes'));
    }

    if (quantityItemNumber) {
      lines.push(replyOption(`item ${quantityItemNumber} qty 2`));
    }

    if (hasSuggestionItems && suggestionItemNumber) {
      lines.push(replyOption(`item ${suggestionItemNumber} option 1 qty 1`));
    }
  }

  lines.push(replyOption('show cart'));

  return lines.join('\n');
}

function formatCartQuantityUpdateExample(cartItems = []) {
  const firstItem = Array.isArray(cartItems) ? cartItems[0] : null;
  const itemNumber = Number(firstItem?.itemNumber) || 1;
  const quantity = Number(firstItem?.requestedQuantity ?? firstItem?.quantity);

  if (Number.isFinite(quantity) && quantity > 0) {
    const suggestedQuantity = quantity === 3 ? 4 : 3;
    return replyOption(`Item ${itemNumber} update from qty ${quantity} to ${suggestedQuantity}`);
  }

  return replyOption(`Item ${itemNumber} update to qty 3`);
}

function formatOrderFulfillmentSummary(summaryLines = []) {
  const scheduledItems = summaryLines.filter((item) => item.fulfillmentStatus !== 'ready_now');

  if (!scheduledItems.length) {
    return '🟢 **Fulfillment:** All items are available now.';
  }

  if (scheduledItems.length === summaryLines.length) {
    const dates = [...new Set(scheduledItems.map((item) => item.estimatedDate).filter(Boolean))];
    return `🕐 **Fulfillment:** All items are scheduled${dates.length ? `; expected date${dates.length === 1 ? '' : 's'}: ${dates.join(', ')}` : ''}.`;
  }

  const dates = [...new Set(scheduledItems.map((item) => item.estimatedDate).filter(Boolean))];
  return `⚠️ **Split fulfillment:** ${summaryLines.length - scheduledItems.length} item${summaryLines.length - scheduledItems.length === 1 ? '' : 's'} available now; ${scheduledItems.length} scheduled${dates.length ? ` for ${dates.join(', ')}` : ''}.`;
}

function buildCartReplyGuidance({ includeShowCart = true, includeNewOrder = false, cartItems = [] }) {
  const lines = ['**Reply with:**'];

  if (includeShowCart) {
    lines.push(replyOption('Show cart'));
  }

  lines.push(replyOption('Place the order — see the order summary'));
  lines.push(replyOption('Item 1 remove'));
  lines.push(formatCartQuantityUpdateExample(cartItems));
  lines.push(replyOption('Send a new SKU or product description to add another item'));

  if (includeNewOrder) {
    lines.push(replyOption('New order'));
  }

  return lines;
}

function buildPostAddReplyGuidance() {
  return [
    '**Reply with:**',
    replyOption('Show cart'),
    replyOption('Place the order — see the order summary'),
    replyOption('Send a new SKU or product description to add another item'),
  ];
}

function buildOrderSummaryPendingDecision(orderSummaryState) {
  const summaryLines = Array.isArray(orderSummaryState?.summary?.lines)
    ? orderSummaryState.summary.lines
    : [];

  return {
    hasMultipleItems: summaryLines.length > 1,
    type: 'cart_review',
    items: summaryLines.map((item) => ({
      itemNumber: item.itemNumber,
      sku: item.sku,
      productName: item.productName,
      requestedReference: item.sku,
      requestedQuantity: item.quantity,
      status: item.fulfillmentStatus,
      availableNow: null,
      estimatedDate: item.estimatedDate || null,
    })),
  };
}

function buildArtifactLinkLine({ label, referenceNumber, url, fallbackText }) {
  const trimmedUrl = String(url || '').trim();
  const trimmedReference = String(referenceNumber || '').trim();

  if (!trimmedUrl) {
    return `${label}: ${fallbackText}`;
  }

  if (trimmedReference) {
    return `${label}: ${trimmedReference}`;
  }

  return `${label}: Available`;
}

function appendCacheBuster(url, token) {
  const trimmedUrl = String(url || '').trim();
  const trimmedToken = String(token || '').trim();

  if (!trimmedUrl || !trimmedToken) {
    return trimmedUrl;
  }

  return `${trimmedUrl}${trimmedUrl.includes('?') ? '&' : '?'}v=${encodeURIComponent(trimmedToken)}`;
}

function formatOrderSummaryReply(orderSummaryState) {
  if (!orderSummaryState || orderSummaryState.status === 'empty_cart') {
    return [
      'Thank you. Your cart is empty, so I could not prepare the order summary yet.',
      '',
      '**Reply with:**',
      replyOption('Show cart'),
      replyOption('Send a new SKU or product description to add another item'),
    ].join('\n');
  }

  const summary = orderSummaryState.summary || { lines: [], formattedTotal: '$0.00' };
  const quoteArtifact = orderSummaryState.artifacts?.quote || null;
  const quoteUrl = appendCacheBuster(
    quoteArtifact?.url,
    [quoteArtifact?.referenceNumber, orderSummaryState?.summaryVersion].filter(Boolean).join('-'),
  );

  const itemLines = summary.lines.flatMap((item, index) => {
    const badge = availabilityBadge(item.fulfillmentStatus, item.estimatedDate);
    return [
      `${emojiNumber(item.itemNumber)} **${item.sku}** — ${item.productName}`,
      `   **Description:** ${item.description || item.productName || 'N/A'}`,
      `   **Category:** ${item.category || 'N/A'}`,
      `   **Qty:** ${item.quantity}   **Total:** ${item.formattedLineTotal}`,
      `   ${badge}`,
      ...(index < summary.lines.length - 1 ? [''] : []),
    ];
  });

  const lines = [
    'Thank you for your order. Please review the details below before confirming.',
    '',
    '🛒 ORDER SUMMARY',
    '',
    ...itemLines,
    '',
    `🧾 **Order Total:** ${summary.formattedTotal}`,
    formatOrderFulfillmentSummary(summary.lines),
    buildArtifactLinkLine({
      label: '📄 **Quote**',
      referenceNumber: quoteArtifact?.referenceNumber || orderSummaryState.quoteDraftId,
      url: quoteUrl,
      fallbackText: orderSummaryState.quoteDraftId || 'Not generated',
    }),
    ...(quoteUrl ? [quoteUrl] : []),
    '',
    '**Reply with:**',
    replyOption('Confirm — finalize this order and receive the invoice and payment link'),
    replyOption('Show cart'),
    replyOption('Item 1 remove'),
    formatCartQuantityUpdateExample(summary.lines),
    '- Send a new SKU or product description to add another item',
  ];

  return lines.join('\n');
}

function formatOrderSubmissionReply(orderSummaryState) {
  const artifacts = orderSummaryState?.artifacts || {};
  const invoiceUrl =
    artifacts.invoice?.status === 'created'
      ? String(artifacts.invoice.url || '').trim()
      : '';
  const paymentLinkUrl =
    artifacts.paymentLink?.status === 'created'
      ? String(artifacts.paymentLink.url || '').trim()
      : '';
  const lines = [
    'Thank you for your order. It has been confirmed successfully.',
    '',
    '✅ ORDER CONFIRMED',
    '',
    `**Order Ref:** ${artifacts.coreOrder?.referenceNumber || '—'}`,
    formatOrderFulfillmentSummary(orderSummaryState?.summary?.lines || []),
    buildArtifactLinkLine({
      label: '📄 **Invoice**',
      referenceNumber: artifacts.invoice?.referenceNumber,
      url: invoiceUrl,
      fallbackText: 'Not generated',
    }),
    ...(invoiceUrl ? [invoiceUrl] : []),
    buildArtifactLinkLine({
      label: '💳 **Payment Link**',
      referenceNumber: artifacts.paymentLink?.referenceNumber || artifacts.paymentLink?.paymentLinkId,
      url: paymentLinkUrl,
      fallbackText: 'Not generated',
    }),
    ...(paymentLinkUrl ? [paymentLinkUrl] : []),
  ];

  return lines.join('\n');
}

function formatCartItems(cartItems = [], cartSummary = null) {
  if (!cartItems.length) {
    return [];
  }

  return [
    ...cartItems.flatMap((item) => {
      const badge = availabilityBadge(item.status, item.estimatedDate);
      const qtyText = item.requestedQuantity != null ? `${item.requestedQuantity}` : '—';
      return [
        [
          `${emojiNumber(item.itemNumber)} **${item.sku}** — ${item.productName}`,
          `   **Description:** ${item.description || item.productName || 'N/A'}`,
          `   **Category:** ${item.category || 'N/A'}`,
          `   **Qty:** ${qtyText}`,
          `   ${badge}`,
        ].join('\n'),
        '', // blank line between items
      ];
    }),
    cartSummary ? `🛒 **Cart Total:** ${cartSummary.formattedTotal}` : null,
  ].filter(Boolean);
}

function formatGuidedMultiItemResponse(facts, pendingDecision, options = {}) {
  const isExtractedFileFlow = Boolean(options.isExtractedFileFlow);

  if (isExtractedFileFlow) {
    return formatSimpleExtractedFileResponse(facts, options.fileExtraction);
  }

  let hasQuantityPendingItems = false;

  const matchedBlocks = [];
  const unresolvedBlocks = [];
  let unresolvedCount = 0;

  for (const [index, item] of facts.items.entries()) {
    const num = itemLabel(index + 1);

    if (item.status === 'matched') {
      const product = item.product;
      const quantity = item.requestedQuantity || 0;

      if (item.availabilityCase === 'fully_available') {
        matchedBlocks.push([
          `${num} **${product.sku}** — ${product.productName}`,
          ...productDetailsLines(product),
          `   **Qty:** ${quantity}`,
          `   **Price:** ${product.formattedUnitPrice}   **Total:** ${product.formattedOrderTotal}`,
          `   🟢 Available Now`,
        ].join('\n'));
      } else if (item.availabilityCase === 'split_availability') {
        matchedBlocks.push([
          `${num} **${product.sku}** — ${product.productName}`,
          ...productDetailsLines(product),
          `   **Qty:** ${quantity}`,
          `   **Price:** ${product.formattedUnitPrice}   **Total:** ${product.formattedOrderTotal}`,
          `   🟢 ${product.immediatelyAvailableForRequest} available now`,
          `   🕐 Remaining ${product.remainingQuantity} est. ${product.estimatedBalanceDate || 'next delivery date'}`,
        ].join('\n'));
      } else if (item.availabilityCase === 'lead_time_only') {
        matchedBlocks.push([
          `${num} **${product.sku}** — ${product.productName}`,
          ...productDetailsLines(product),
          `   **Qty:** ${quantity}`,
          `   **Price:** ${product.formattedUnitPrice}   **Total:** ${product.formattedOrderTotal}`,
          `   🕐 Est. ${product.estimatedBalanceDate || 'next delivery date'}`,
        ].join('\n'));
      } else {
        hasQuantityPendingItems = true;
        matchedBlocks.push([
          `${num} **${product.sku}** — ${product.productName}`,
          ...productDetailsLines(product),
          `   **Price:** ${product.formattedUnitPrice}`,
          `   ⚠️ Quantity missing`,
          `   Reply like: item ${index + 1} qty 1`,
        ].join('\n'));
      }
      continue;
    }

    unresolvedCount++;

    if (item.status === 'suggestions') {
      const suggestionLines = [
        `${num} ${item.requestedReference}`,
        '   🔍 Close options:',
      ];

      item.options.slice(0, 3).forEach((option, optionIndex) => {
        const availabilityText = Number(option.currentAvailable) > 0
          ? `🟢 ${option.currentAvailable} available now`
          : '🔸 Availability needs confirmation';
        suggestionLines.push(
          `   ${emojiNumber(optionIndex + 1)} **${option.sku}** — ${option.productName}`,
          `      **Description:** ${option.description || option.productName || 'N/A'}`,
          `      **Category:** ${option.category || 'N/A'}`,
          `      **Price:** ${option.formattedUnitPrice}`,
          `      ${availabilityText}`,
        );
        if (optionIndex < Math.min(item.options.length, 3) - 1) {
          suggestionLines.push('');
        }
      });

      suggestionLines.push(`   Reply like: item ${index + 1} option 1 qty 1`);
      unresolvedBlocks.push(suggestionLines.join('\n'));
    } else {
      unresolvedBlocks.push(
        [
          `${num} ${item.requestedReference}`,
          '   ❌ Product not found',
          '   Send SKU or a clearer product description with quantity.',
        ].join('\n'),
      );
    }
  }

  const lines = ['Thank you for your request. Here is what I found for the items you requested.', ''];
  const hasMatched = matchedBlocks.length > 0;
  const hasUnresolved = unresolvedCount > 0;
  const hasSuggestions = facts.items.some((item) => item.status === 'suggestions');

  if (hasMatched) {
    lines.push('✅ MATCHED ITEMS');
    lines.push('');
    matchedBlocks.forEach((block, i) => {
      lines.push(block);
      lines.push(''); // blank line after every item for readability
    });
  }

  if (hasUnresolved) {
    lines.push(`🔎 UNRESOLVED ITEMS (${unresolvedCount})`);
    lines.push('');
    unresolvedBlocks.forEach((block) => {
      lines.push(block);
      lines.push(''); // blank line after every item for readability
    });
  }

  if (hasMatched && hasUnresolved) {
    const addableNums = (pendingDecision?.items || [])
      .filter((i) => ['fully_available', 'lead_time_only', 'split_availability'].includes(i.status))
      .map((i) => i.itemNumber);
    const qtyMissingNums = (pendingDecision?.items || [])
      .filter((i) => i.status === 'quantity_missing')
      .map((i) => i.itemNumber);
    const suggestionItems = (pendingDecision?.items || [])
      .filter((i) => i.status === 'suggestions');

    // Determine how many distinct steps are needed.
    const hasAddable = addableNums.length > 0;
    const hasQtyMissing = qtyMissingNums.length > 0;
    const hasSuggestionDecisions = suggestionItems.length > 0;

    lines.push('');
    if (hasSuggestionDecisions) {
      lines.push(...multipleSelectionReplyGuidance());
      lines.push('');
    }
    lines.push('**Reply with:**');
    lines.push('');

    let stepNum = 1;

    if (hasAddable) {
      lines.push(`**Step ${stepNum++} — Add items that are ready (send this message):**`);
      lines.push(`add ${addableNums.join(',')}`);
      lines.push('');
    }

    if (hasQtyMissing) {
      lines.push(`**Step ${stepNum++} — Provide quantity for each item (send all in one message):**`);
      qtyMissingNums.forEach((n) => lines.push(`item ${n} qty 1`));
      lines.push('');
    }

    if (hasSuggestionDecisions) {
      lines.push(`**Step ${stepNum++} — Choose options for unresolved items (send all selections in one message):**`);
      suggestionItems.forEach((item) => lines.push(`item ${item.itemNumber} option 1 qty 1`));
      lines.push('');
    }

    lines.push(`show cart`);
  } else if (hasMatched) {
    lines.push('');
    lines.push(
      formatGuidedNextSteps(pendingDecision),
    );
  } else if (hasUnresolved) {
    if (hasSuggestions) {
      lines.push('');
      lines.push(...multipleSelectionReplyGuidance());
      lines.push('');
      lines.push('**Reply with:**');
      lines.push(replyOption('show cart'));
    }
  }

  return lines.filter((l) => l !== null && l !== undefined).join('\n');
}

function formatImageExtractionNotice(fileExtraction = null) {
  const uncertainItems = (fileExtraction?.extractedItems || [])
    .map((item, index) => ({ item, itemNumber: index + 1 }))
    .filter(({ item }) => item.confidence === 'low' || item.uncertainFields?.length);
  const lines = [
    `I reviewed your uploaded ${fileExtraction?.mimeType?.startsWith('image/') ? 'image/sketch' : 'file'} and found the following items.`,
  ];

  if (!uncertainItems.length) {
    lines.push('Please review the matched products before adding anything to your cart.');
    return lines.join('\n');
  }

  lines.push('A few details were unclear, so please confirm or correct them before adding those items to your cart:');
  uncertainItems.forEach(({ item, itemNumber }) => {
    const fields = (item.uncertainFields || []).map((field) => field.replace('_', ' ')).join(', ') || 'the extracted details';
    lines.push(`➡️ Item ${itemNumber}: please confirm ${fields}${item.uncertaintyNote ? ` — ${item.uncertaintyNote}` : ''}.`);
  });
  return lines.join('\n');
}

function formatSimpleExtractedFileResponse(facts, fileExtraction = null) {
  const matchedLines = [];
  const quantityBlocks = [];
  const optionBlocks = [];
  const skippedLines = [];
  let quantityItemNumber = null;
  let suggestionItemNumber = null;

  for (const [index, item] of facts.items.entries()) {
    const itemNumber = index + 1;

    if (item.status === 'matched') {
      const product = item.product;

      if (item.requestedQuantity) {
        matchedLines.push([
          `${emojiNumber(itemNumber)} **Item ${itemNumber}: ${product.sku}** — ${product.productName}`,
          ...productPricingLines(product, item.requestedQuantity),
        ].join('\n'));
      } else {
        quantityItemNumber = quantityItemNumber || itemNumber;
        quantityBlocks.push([
          `${emojiNumber(itemNumber)} **Item ${itemNumber}: ${product.sku}** — ${product.productName}`,
          ...productPricingLines(product),
          `   ⚠️ **Quantity needed**`,
          `   **Reply: item ${itemNumber} qty 2**`,
        ].join('\n'));
      }

      continue;
    }

    if (item.status === 'suggestions') {
      suggestionItemNumber = suggestionItemNumber || itemNumber;
      const lines = [`${emojiNumber(itemNumber)} **Item ${itemNumber}: ${item.requestedReference}**`, '   🔍 **Close options:**'];

      item.options.slice(0, 3).forEach((option, optionIndex) => {
        lines.push(`   ${emojiNumber(optionIndex + 1)} **${option.sku}** — ${option.productName}`);
        lines.push(`      **Unit Price:** ${option.formattedUnitPrice || '—'}`);
        if (optionIndex < Math.min(item.options.length, 3) - 1) {
          lines.push('');
        }
      });

      lines.push(`   **Reply: item ${itemNumber} option 1 qty 1**`);
      optionBlocks.push(lines.join('\n'));
      continue;
    }

    skippedLines.push(`${emojiNumber(itemNumber)} **Item ${itemNumber}: ${item.requestedReference}**`);
  }

  const lines = [formatImageExtractionNotice(fileExtraction), '', 'Here is what I found.', ''];

  if (matchedLines.length) {
    lines.push('✅ **Matched items:**');
    lines.push('');
    lines.push(matchedLines.join('\n\n'));
    lines.push('');
  }

  if (quantityBlocks.length) {
    lines.push('⚠️ **Quantity needed:**');
    lines.push('');
    lines.push(quantityBlocks.join('\n\n'));
    lines.push('');
  }

  if (optionBlocks.length) {
    lines.push('🔎 **Options:**');
    lines.push('');
    lines.push(optionBlocks.join('\n\n'));
    lines.push('');
    lines.push(...multipleSelectionReplyGuidance());
    lines.push('');
  }

  if (skippedLines.length) {
    lines.push('❌ **Skipped:**');
    lines.push('');
    lines.push(skippedLines.join('\n\n'));
    lines.push('');
  }

  lines.push(formatExtractedFileNextSteps({
    hasMatchedItems: matchedLines.length > 0,
    quantityItemNumber,
    hasSuggestionItems: optionBlocks.length > 0,
    suggestionItemNumber,
  }));

  if (skippedLines.length) {
    lines.push('');
    lines.push('If you still need a skipped item, send the SKU or clearer description in a new message.');
  }

  return lines.filter((l) => l !== null && l !== undefined).join('\n');
}

function formatSingleSuggestionResponse(item) {
  const requestedQuantity = Number(item.requestedQuantity) > 0
    ? Number(item.requestedQuantity)
    : 1;
  const lines = [
    'Thank you for your interest. I found a few close matches for you.',
    '',
    '**Options:**',
    `**Item 1: ${item.requestedReference}**`,
  ];

  item.options.forEach((product, index) => {
    lines.push(`${index + 1}. **${product.sku}** — **${product.productName}**`);
    lines.push(`   **Description:** ${product.description || product.productName || 'N/A'}`);
    lines.push(`   **Category:** ${product.category || 'N/A'}`);
    if (index < item.options.length - 1) {
      lines.push('');
    }
  });

  lines.push(`Reply: item 1 option 1 qty ${requestedQuantity}`);
  lines.push('');
  lines.push(...multipleSelectionReplyGuidance());
  lines.push('');
  lines.push('**Reply with:**');
  lines.push(replyOption(`item 1 option 1 qty ${requestedQuantity}`));
  lines.push(replyOption('show cart'));
  return lines.join('\n');
}

export function buildProductResponseFacts({ intent, productResults, agentPayload, tierMultiplier = 1 }) {
  return {
    intent: intent?.intent || 'unclear',
    needsClarification: Boolean(intent?.needsClarification),
    clarificationQuestion: intent?.clarificationQuestion || null,
    items: (productResults || []).map((result) => {
      if (result.status === 'matched' && result.matches.length === 1) {
        return buildMatchedProductFacts(result, agentPayload, tierMultiplier);
      }

      if (result.matches.length) {
        return {
          status: 'suggestions',
          requestedReference: result.requestedItem.rawReference,
          requestedQuantity: result.requestedItem.quantity,
          options: result.matches.slice(0, 3).map((product) => {
            const basePrice = Number(product.sellingPrice || 0);
            const tieredPrice = calculateTierPrice(basePrice, tierMultiplier);
            return {
              sku: product.sku,
              productName: product.productName,
              description: product.description,
              category: product.category,
              unitPrice: tieredPrice,
              formattedUnitPrice: formatMoney(tieredPrice, product.currency),
              currency: product.currency,
              currentAvailable: Math.max(0, Number(product.qtyAvailable || 0)),
              tierMultiplier,
              basePrice,
            };
          }),
        };
      }

      return {
        status: 'unmatched',
        requestedReference: result.requestedItem.rawReference,
      };
    }),
  };
}

function formatMatchedProductFallback(item) {
  const product = item.product;
  const quantity = item.requestedQuantity;

  if (!quantity) {
    const badge = product.currentAvailable > 0
      ? `🟢 ${product.currentAvailable} ${product.unit} available now`
      : product.estimatedBalanceDate
        ? `🕐 Expected by ${product.estimatedBalanceDate}`
        : '🔸 Availability needs confirmation';
    return [
      `**${product.sku}** — ${product.productName}`,
      `   **Description:** ${product.description || product.productName || 'N/A'}`,
      `   **Category:** ${product.category || 'N/A'}`,
      `   **Price:** ${product.formattedUnitPrice}`,
      `   ${badge}`,
      `   ⚠️ Quantity missing — how many would you like?`,
    ].join('\n');
  }

  let badge = '🔸 Pending Confirmation';
  let detail = '';

  if (item.availabilityCase === 'fully_available') {
    badge = '🟢 Available Now';
  } else if (item.availabilityCase === 'split_availability') {
    const balanceTiming = product.estimatedBalanceDate
      ? `remaining ${product.remainingQuantity} est. ${product.estimatedBalanceDate}`
      : `remaining ${product.remainingQuantity} pending confirmation`;
    badge = `🟢 ${product.immediatelyAvailableForRequest} available now`;
    detail = `   🕐 ${balanceTiming}`;
  } else {
    badge = product.estimatedBalanceDate
      ? `🕐 Full qty est. ${product.estimatedBalanceDate}`
      : '🔸 Availability needs confirmation';
  }

  const lines = [
    `**${product.sku}** — ${product.productName}`,
    `   **Description:** ${product.description || product.productName || 'N/A'}`,
    `   **Category:** ${product.category || 'N/A'}`,
    `   **Qty:** ${quantity}   **Price:** ${product.formattedUnitPrice}   **Total:** ${product.formattedOrderTotal}`,
    `   ${badge}`,
  ];

  if (detail) lines.push(detail);

  lines.push('');
  lines.push('Shall I add this to your cart?');
  lines.push(`${emojiNumber(1)} Yes, add to cart`);
  lines.push(`${emojiNumber(2)} Change quantity`);
  lines.push(`${emojiNumber(3)} Cancel`);

  return lines.join('\n');
}

export function composeProductResponse({ intent, productResults, agentPayload }) {
  const facts = buildProductResponseFacts({ intent, productResults, agentPayload });
  const pendingDecision = buildPendingDecision(facts);

  if (facts.intent === 'unrelated') {
    return formatUnrelatedSearchReply(agentPayload?.userMessage);
  }

  if (facts.intent === 'cart_view') {
    return [
      '**Reply with:**',
      replyOption('Show cart'),
      replyOption('Item 1 remove'),
      replyOption('Item 1 update to qty 3'),
      replyOption('Send a new SKU or product description to add another item'),
    ].join('\n');
  }

  if (!facts.items.length) {
    return facts.clarificationQuestion || 'It looks like your message came through empty. To process your order, please share any input.';
  }

  if (Boolean(agentPayload?.metadata?.extractedOrderText) || pendingDecision.hasMultipleItems) {
    return formatGuidedMultiItemResponse(facts, pendingDecision, {
      isExtractedFileFlow: Boolean(agentPayload?.metadata?.extractedOrderText),
    });
  }

  return facts.items.map((item) => {
    if (item.status === 'matched') {
      return formatMatchedProductFallback(item);
    }

    if (item.status === 'suggestions') {
      return formatSingleSuggestionResponse(item);
    }

    return formatUnrelatedSearchReply(item.requestedReference);
  }).join('\n\n');
}

function formatFactsForLlm(facts) {
  if (!facts?.items?.length) {
    return JSON.stringify(facts);
  }

  const itemLines = facts.items.map((item, index) => {
    const num = EMOJI_NUMBERS[index] || `${index + 1}.`;

    if (item.status === 'matched') {
      const p = item.product;
      const qtyLine = item.requestedQuantity
        ? `   Qty: ${item.requestedQuantity}   Unit Price: ${p.formattedUnitPrice}   Total: ${p.formattedOrderTotal || '—'}`
        : `   Unit Price: ${p.formattedUnitPrice}   ⚠️ Quantity Missing`;
      let badge = '🔸 Pending Confirmation';
      if (item.availabilityCase === 'fully_available') badge = '🟢 Available Now';
      else if (item.availabilityCase === 'split_availability') badge = `🟢 ${p.immediatelyAvailableForRequest} now   🕐 ${p.remainingQuantity} est. ${p.estimatedBalanceDate || 'TBD'}`;
      else if (item.availabilityCase === 'lead_time_only') badge = `🕐 Est. ${p.estimatedBalanceDate || 'TBD'}`;
      else if (item.availabilityCase === 'quantity_missing') badge = '⚠️ Quantity Missing';
      return `${num} ${p.sku} — ${p.productName}\n${qtyLine}\n   ${badge}`;
    }

    if (item.status === 'suggestions') {
      const opts = item.options.map((o, i) => `   ${EMOJI_NUMBERS[i] || `${i + 1}.`} ${o.sku} — ${o.productName}   ${o.formattedUnitPrice}`).join('\n');
      return `${num} ${item.requestedReference}\n   🔍 No exact match — close options:\n${opts}`;
    }

    return `${num} ${item.requestedReference}\n   ❌ Product Not Found`;
  });

  return [
    `intent: ${facts.intent}`,
    '',
    'Items:',
    ...itemLines,
  ].join('\n');
}

function extractResponseText(response) {
  if (typeof response?.content === 'string') {
    return response.content.trim();
  }

  if (Array.isArray(response?.content)) {
    return response.content
      .map((block) => typeof block === 'string' ? block : block?.text || '')
      .join('')
      .trim();
  }

  return '';
}

function buildConversationSummary(previousSummary, userMessage, reply, stage) {
  const normalized = [
    String(previousSummary || '').replace(/\s+/g, ' ').trim(),
    `Stage: ${stage}. Customer: ${String(userMessage || '').replace(/\s+/g, ' ').trim()} Assistant: ${String(reply || '').replace(/\s+/g, ' ').trim()}`,
  ].filter(Boolean).join(' | ');

  return normalized.slice(-900);
}

// Step 6: translate verified state into the customer reply, then store the request
// and reply together as short-term conversation memory for the next turn.
export function createComposeResponseNode({ model, tenantDb = null, deterministicOnly = false } = {}) {
  return async function composeResponseNode(state) {
    const startedAt = Date.now();
    const requestId = state.agentPayload.sessionInfo.requestId;

    // Fetch customer's tier multiplier for response pricing
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
      logger.warn('Failed to fetch customer tier multiplier for response, using default pricing', {
        requestId,
        error: error.message,
      });
    }

    const facts = buildProductResponseFacts({
      intent: state.intent,
      productResults: state.productResults,
      agentPayload: state.agentPayload,
      tierMultiplier,
    });
    const pendingDecision = buildPendingDecision(facts, {
      source:
        state.fileExtraction?.status === 'success' || state.agentPayload?.metadata?.extractedOrderText
          ? 'extracted_file'
          : 'default',
    });
    const cartActionResult = state.cartActionResult || null;
    const orderSummaryState = state.orderSummaryState || null;

    logger.info('LangGraph grounded LLM response generation started', {
      requestId,
      intent: facts.intent,
      itemCount: facts.items.length,
      matchedCount: facts.items.filter((item) => item.status === 'matched').length,
      tierMultiplier,
      availabilityCases: facts.items
        .filter((item) => item.status === 'matched')
        .map((item) => item.availabilityCase),
    });

    let reply;
    let responseSource = 'llm';
    let conversationStatus = 'active';
    let resolvedPendingDecision = cartActionResult?.pendingDecision || pendingDecision;

    if (state.intent?.systemUnavailable) {
      responseSource = 'system_unavailable_template';
      reply = state.intent.clarificationQuestion || 'We are unable to process your request right now. Please contact the admin/support team for assistance.';
    } else if (state.intent?.imageDetailsConfirmed) {
      responseSource = 'image_details_confirmed_template';
      reply = 'Thank you — I have marked the image details as confirmed. You can now choose a product option or ask me to add the confirmed item to your cart.';
    } else if (state.intent?.intent === 'unrelated') {
      responseSource = 'unrelated_template';
      reply = formatUnrelatedSearchReply(state.agentPayload?.userMessage);
    } else if (state.intent?.intent === 'order_submit' && orderSummaryState?.status === 'confirmed') {
      responseSource = 'order_submit_template';
      reply = formatOrderSubmissionReply(orderSummaryState);
      conversationStatus = 'order_completed';
    } else if (['order_summary', 'order_submit'].includes(state.intent?.intent) && orderSummaryState) {
      responseSource = 'order_summary_template';
      resolvedPendingDecision = buildOrderSummaryPendingDecision(orderSummaryState);
      if (state.intent?.decisionAction === 'edit_order_summary') {
        reply = state.intent?.clarificationQuestion || 'Please update the cart and say `Place the order` again.';
      } else {
        reply = formatOrderSummaryReply(orderSummaryState);
      }
    } else if (cartActionResult?.type === 'cart_view') {
      responseSource = 'cart_view_template';
      const cartItems = cartActionResult.pendingDecision?.items || [];
      if (!cartItems.length) {
        reply = [
          'Hello! Your cart is currently empty.',
          '',
          '🛒 YOUR CART',
          '',
          '**Reply with:**',
          replyOption('New order'),
          replyOption('Send a new SKU or product description to add an item'),
        ].join('\n');
      } else {
        reply = [
          'Here is your cart so far.',
          '',
          '🛒 YOUR CART',
          '',
          ...formatCartItems(cartItems, cartActionResult.cartSummary),
          '',
          ...buildCartReplyGuidance({ includeShowCart: false, includeNewOrder: false, cartItems }),
        ].join('\n');
      }
    } else if (cartActionResult?.type === 'cart_clear_confirmation') {
      responseSource = 'cart_clear_confirmation_template';
      reply = [
        'Before I clear your cart, please confirm your choice.',
        '',
        cartActionResult.message,
        '',
        replyOption('Yes'),
        replyOption('No'),
      ].join('\n');
    } else if (cartActionResult?.type === 'image_confirmation_required') {
      responseSource = 'image_confirmation_required_template';
      reply = [
        'Before I add anything to your cart, please confirm the unclear details from your uploaded image.',
        '',
        cartActionResult.message,
        '',
        replyOption('Confirm image details'),
      ].join('\n');
    } else if (cartActionResult?.type === 'cart_clear') {
      responseSource = 'cart_clear_template';
      reply = [
        'Your cart has been updated.',
        '',
        cartActionResult.message,
        '',
        replyOption('Send a new SKU or product description to add another item'),
      ].join('\n');
    } else if (cartActionResult?.type === 'cart_add' || cartActionResult?.type === 'cart_remove' || cartActionResult?.type === 'cart_update') {
      responseSource = 'cart_action_template';
      if (cartActionResult.type === 'cart_add') {
        reply = [
          `Thank you. ${cartActionResult.message}`,
          '',
          '✅ CART UPDATED',
          ...((cartActionResult.changedItems || []).flatMap((item, index, items) => {
            const badge = availabilityBadge(item.fulfillmentStatus, item.estimatedDate);
            return [
              [
                `${emojiNumber(index + 1)} **${item.sku}** — ${item.productName}`,
                `   **Qty:** ${item.quantity}`,
                `   **Price:** ${item.formattedUnitPrice}   **Total:** ${item.formattedLineTotal}`,
                `   ${badge}`,
              ].join('\n'),
              ...(index < items.length - 1 ? [''] : []),
            ];
          })),
          `\n🛒 **Cart Total:** ${cartActionResult.cartSummary.formattedTotal}`,
          '',
          ...buildPostAddReplyGuidance(),
        ].join('\n');
      } else {
        const cartItems = cartActionResult.pendingDecision?.items || [];
        reply = [
          'Your cart has been updated.',
          '',
          cartActionResult.message,
          ...formatCartItems(cartItems, cartActionResult.cartSummary),
          '',
          ...buildCartReplyGuidance({ includeShowCart: true, includeNewOrder: false, cartItems }),
        ].join('\n');
      }
    } else if (pendingDecision.hasMultipleItems || Boolean(state.fileExtraction?.status === 'success' || state.agentPayload?.metadata?.extractedOrderText)) {
      responseSource = 'guided_multi_item_template';
      reply = formatGuidedMultiItemResponse(facts, pendingDecision, {
        isExtractedFileFlow: Boolean(state.fileExtraction?.status === 'success' || state.agentPayload?.metadata?.extractedOrderText),
        fileExtraction: state.fileExtraction,
      });
    } else if (!facts.items.length) {
      const hasSearchReference = Boolean(formatUnrelatedSearchReference(state.agentPayload?.userMessage));
      const isUnclearSearch =
        ['unclear', 'product_enquiry'].includes(state.intent?.intent) &&
        !state.intent?.clarificationQuestion &&
        hasSearchReference;

      if (isUnclearSearch) {
        responseSource = 'unmatched_search_template';
        reply = formatUnrelatedSearchReply(state.agentPayload?.userMessage);
      } else {
        responseSource = 'clarification_template';
        reply = state.intent?.clarificationQuestion || 'I am happy to help. Please send a SKU or product description, and include the quantity if you know it.';
      }
    } else if (facts.items.length === 1 && facts.items[0].status === 'suggestions') {
      responseSource = 'single_suggestion_template';
      reply = formatSingleSuggestionResponse(facts.items[0]);
    } else if (facts.items.length === 1 && facts.items[0].status === 'unmatched') {
      responseSource = 'unmatched_search_template';
      reply = formatUnrelatedSearchReply(facts.items[0].requestedReference);
    } else if (deterministicOnly) {
      responseSource = 'deterministic_template';
      reply = composeProductResponse({
        intent: state.intent,
        productResults: state.productResults,
        agentPayload: state.agentPayload,
      });
    } else {
      try {
        const response = await model.invoke([
          {
            role: 'system',
            content: RESPONSE_SYSTEM_PROMPT,
          },
          {
            role: 'user',
            content: formatFactsForLlm(facts),
          },
        ]);
        logger.info('LangGraph customer-response LLM raw output', {
          requestId,
          intent: facts.intent,
          rawContent: response?.content ?? null,
          responseMetadata: response?.response_metadata ?? null,
          usageMetadata: response?.usage_metadata ?? null,
        });
        reply = extractResponseText(response);

        if (!reply) {
          throw new Error('LLM returned an empty customer response.');
        }
      } catch (error) {
        responseSource = 'deterministic_fallback';
        reply = composeProductResponse({
          intent: state.intent,
          productResults: state.productResults,
          agentPayload: state.agentPayload,
        });
        logger.warn('LangGraph grounded LLM response generation failed; fallback used', {
          requestId,
          error: error.message,
        });
      }
    }

    // Models can still occasionally return Markdown bullets despite the prompt.
    // Normalize them at the output boundary so every customer-facing reply is consistent.
    reply = replaceReplyBullets(reply);

    const recentTurns = [
      ...(Array.isArray(state.recentTurns) ? state.recentTurns : []),
      {
        userMessage: state.agentPayload.userMessage,
        reply,
      },
    ].slice(-6);
    const activePrompt = deriveActivePrompt({
      pendingDecision: resolvedPendingDecision,
      pendingCartActionConfirmation: state.pendingCartActionConfirmation,
      pendingImageConfirmation: state.pendingImageConfirmation,
      orderSummaryState,
    });
    const stage = deriveWorkflowStage({
      cart: state.cart,
      pendingDecision: resolvedPendingDecision,
      pendingCartActionConfirmation: state.pendingCartActionConfirmation,
      pendingImageConfirmation: state.pendingImageConfirmation,
      orderSummaryState,
      conversationStatus,
      activePrompt,
    });

    logger.info('LangGraph customer response completed', {
      requestId,
      responseSource,
      responseMessage: reply,
      responseMessageEscaped: JSON.stringify(reply),
      replyLength: reply.length,
      durationMs: Date.now() - startedAt,
    });

    return {
      reply,
      pendingDecision: resolvedPendingDecision,
      activePrompt,
      pendingCartActionConfirmation: state.pendingCartActionConfirmation || null,
      recentTurns,
      conversationSummary: buildConversationSummary(
        state.conversationSummary,
        state.agentPayload.userMessage,
        reply,
        stage,
      ),
      stage,
      conversationStatus,
    };
  };
}
