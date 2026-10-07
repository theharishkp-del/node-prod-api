import { chatIntentSchema } from '../chatIntentSchema.js';
import { env } from '../../../../config/env.js';
import { logger } from '../../../../config/logger.js';
import { deriveActivePrompt } from '../workflowState.js';

const AGENT_UNAVAILABLE_MESSAGE =
  'We are unable to process your request right now. Please contact the admin/support team for assistance.';

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

const INTENT_SYSTEM_PROMPT = [
  'Understand customer product and cart requests for an inventory ordering assistant.',
  'Extract every requested item. A quantity may be written as digits or number words, with or without labels such as qty, piece, pieces, pcs, nos, units, or items (for example, "I want one W1212GD" means quantity 1).',
  'Treat a multiplier written after a SKU as quantity (for example, "W1212GD-SW x3" or "W1212GD-SW ×3" means quantity 3).',
  'Treat the word "quantity" exactly like "qty". In compact input such as "W1212GDSW4 quantity", preserve W1212GDSW as the SKU candidate and extract 4 as the quantity.',
  'A SKU may contain missing spaces, hyphens, slashes, or other separators; preserve the raw value in rawReference.',
  'Use dimensions as width, height, depth only when the customer provides them. Do not invent product facts.',
  'For voice input, treat phrases such as "24 hours later", "tomorrow", or "delivery in two days" as fulfillment timing, never as a product name, SKU, colour, or dimension.',
  'For every voice product request, keep its product type, colour or finish, and dimensions with that same item. When an item boundary is unclear, ask for clarification rather than merging attributes from separate products.',
  'Use prior turns only to resolve references such as it, that item, those, or change it to 3.',
  'Interpret natural cart changes such as "item 1 quantity should become 6", "make item 1 six", or "change it to six" as cart_update with decisionAction change_qty when the pending decision identifies the item.',
  'A deterministic parser result may be supplied with the request. Validate it against the current message and preserve explicit item numbers and quantities; do not invent or replace them.',
  'Return only the structured intent required by the schema. Do not write a customer-facing reply.',
  'If the current message refers to numbered items from the pending decision context, set requestMode to continue_previous_selection.',
  'If the current message contains a fresh SKU, dimensions, or product description without referring to pending numbered items, set requestMode to fresh_search.',
  'Use decisionAction to classify add, skip, choose option, quantity change, clear cart, ask more, or start new order.',
  'If the user asks to remove cart items and add new products in the same message, put the cart item numbers in removeReferencedItems and the new products in items.',
  'If the user asks to show or view the cart, including show carts, set intent to cart_view.',
  'If the user says proceed with order, place the order, checkout, order summary, or review order after building a cart, set intent to order_summary and decisionAction to prepare_order_summary.',
  'If the user confirms an order summary, set intent to order_submit and decisionAction to confirm_order_summary or submit_order as appropriate.',
  'If the user asks to edit after an order summary is shown, set intent to order_summary and decisionAction to edit_order_summary.',
  'If the user asks to clear or empty the cart, set intent to cart_remove and decisionAction to clear_cart.',
  'If the user says only yes and there are multiple pending items, ask them to reply with item numbers.',
  'When a customer asks to add all options, suggestions, or choices for a pending item, create one cart_add item for every option and apply the stated quantity to each option.',
  'Use conversation for product comparisons, availability/pricing explanations, finish/style questions, delivery/order questions, or a side question about the current selection. Keep items empty unless the user is requesting a product lookup or cart action.',
  'Choose unrelated only when the message has no useful product, inventory, ordering, or cart meaning.',
].join(' ');

function formatRecentTurns(recentTurns = []) {
  if (!recentTurns.length) {
    return 'No previous conversation.';
  }

  return recentTurns.slice(-6).map((turn) => [
    `Customer: ${turn.userMessage}`,
    `Assistant: ${turn.reply}`,
  ].join('\n')).join('\n');
}

function formatConversationSummary(summary) {
  const normalized = normalizeText(summary);
  return normalized || 'No long-term conversation summary is available.';
}

function normalizeText(value) {
  return String(value || '').trim();
}

const NATURAL_NUMBER_VALUES = {
  one: 1,
  first: 1,
  two: 2,
  second: 2,
  three: 3,
  third: 3,
  four: 4,
  fourth: 4,
  five: 5,
  fifth: 5,
};

const NATURAL_CARDINAL_VALUES = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
};

const NATURAL_CARDINAL_PATTERN = Object.keys(NATURAL_CARDINAL_VALUES).join('|');

function parseNaturalCardinal(value) {
  return NATURAL_CARDINAL_VALUES[normalizeText(value).toLowerCase()] || null;
}

function normalizeNaturalContinuationLanguage(message) {
  let normalizedMessage = normalizeText(message).toLowerCase();

  for (const [word, number] of Object.entries(NATURAL_NUMBER_VALUES)) {
    const ordinalPattern = word === 'first' ? '(?:first|1st)' :
      word === 'second' ? '(?:second|2nd)' :
        word === 'third' ? '(?:third|3rd)' :
          word === 'fourth' ? '(?:fourth|4th)' :
            word === 'fifth' ? '(?:fifth|5th)' : word;

    normalizedMessage = normalizedMessage
      .replace(new RegExp(`\\b${ordinalPattern}\\s+item\\b`, 'gi'), `item ${number}`)
      .replace(new RegExp(`\\bitem\\s+${ordinalPattern}\\b`, 'gi'), `item ${number}`)
      .replace(new RegExp(`\\b${ordinalPattern}\\s+(?:option|choice|selection)\\b`, 'gi'), `option ${number}`)
      .replace(new RegExp(`\\b(?:option|choice|selection)\\s+${ordinalPattern}\\b`, 'gi'), `option ${number}`)
      .replace(new RegExp(`\\b(?:qty|quantity)\\s+${word}\\b`, 'gi'), `qty ${number}`)
      .replace(new RegExp(`\\b${word}\\s+(?:qty|pieces?|pcs|units?|items?|nos)\\b`, 'gi'), `${number} units`);
  }

  return normalizedMessage
    .replace(/\boption\s+(\d+)\s+(?:for|of)\s+the\s+item\s+(\d+)\b/gi, 'option $1 for item $2')
    .replace(/\bthe\s+option\s+(\d+)\b/gi, 'option $1');
}

function isOrderSummaryRequest(message) {
  return /\b(proceed with order|place (?:the )?order|done|checkout|order summary|review order|review summary|finish order)\b/i.test(message || '');
}

function isOrderSummaryConfirm(message) {
  return /\b(confirm|confim|confrim|approved|looks good|place (?:the )?order|submit order|proceed)\b/i.test(message || '');
}

function isOrderSummaryEdit(message) {
  return /\b(edit|change|update|modify|revise)\b/i.test(message || '');
}

function looksLikeDirectCartEdit(message) {
  const normalized = normalizeText(message).toLowerCase();

  if (!normalized) {
    return false;
  }

  return (
    /\bitem\s*\d+\b/i.test(normalized) ||
    /\bitem\d+\b/i.test(normalized) ||
    /\b(remove|qty|quantity)\b/i.test(normalized)
  );
}

function buildIntentFromExtractedItems(fileExtraction) {
  const extractedItems = Array.isArray(fileExtraction?.extractedItems)
    ? fileExtraction.extractedItems
    : [];

  return {
    intent: 'product_enquiry',
    requestMode: 'fresh_search',
    decisionAction: 'none',
    referencedItems: [],
    removeReferencedItems: [],
    clearCartConfirmed: false,
    items: extractedItems.map((item) => ({
      rawReference: item.rawText,
      skuCandidate: item.skuCandidate || null,
      quantity: item.quantity || null,
      unit: null,
      description: item.description || item.rawText || null,
      dimensions: item.dimensions || null,
      sketchHints: item.sketchHints || null,
      extractionConfidence: item.confidence || 'medium',
      uncertainFields: item.uncertainFields || [],
      uncertaintyNote: item.uncertaintyNote || null,
    })),
    needsClarification: false,
    clarificationQuestion: null,
  };
}

function buildIntentFromRecoveredExtractionText(fileExtraction) {
  const extractedText = normalizeText(fileExtraction?.extractedText);

  if (!extractedText) {
    return null;
  }

  const items = extractedText
    .split(/\r?\n+/)
    .map((line) => normalizeText(line))
    .filter((line) => line.length > 2)
    .map((line) => ({
      rawReference: line,
      skuCandidate: null,
      quantity: null,
      unit: null,
      description: line,
      dimensions: null,
      sketchHints: null,
    }));

  if (!items.length) {
    return null;
  }

  return {
    intent: 'product_enquiry',
    requestMode: 'fresh_search',
    decisionAction: 'none',
    referencedItems: [],
    removeReferencedItems: [],
    clearCartConfirmed: false,
    items,
    needsClarification: false,
    clarificationQuestion: null,
  };
}

function parseLineDimensions(line) {
  const normalized = normalizeText(line);
  const labeledMatch = normalized.match(/\b(\d+(?:\.\d+)?)\s*(?:w|width)\s*(?:x|by)\s*(\d+(?:\.\d+)?)\s*(?:h|height)\b/i);
  const compactMatch = normalized.match(/\b(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\b/i);
  const match = labeledMatch || compactMatch;

  if (!match) return null;
  return { width: Number(match[1]), height: Number(match[2]), depth: null };
}

function parseDeterministicMultiLineOrder(message) {
  const lines = normalizeText(message)
    .split(/\r?\n+/)
    .map((line) => normalizeText(line))
    .filter(Boolean);

  if (lines.length < 2) return null;

  const items = lines.map((line) => {
    const quantityMatch = line.match(/\b(?:qty|quantity)\s*(\d+)\b|(?:^|[^0-9])(\d+)\s*(?:qty|quantity|pieces?|pcs|nos|units|items)\b/i);
    const skuMatch = line.match(/\b[A-Za-z][A-Za-z0-9/_-]*\d[A-Za-z0-9/_-]{2,}\b/);
    const dimensions = parseLineDimensions(line);
    const quantity = Number(quantityMatch?.[1] || quantityMatch?.[2]);

    return {
      rawReference: line,
      skuCandidate: skuMatch?.[0] || null,
      quantity: Number.isInteger(quantity) && quantity > 0 ? quantity : null,
      unit: null,
      description: line,
      dimensions,
      sketchHints: null,
    };
  });

  // Do not take over ordinary multi-sentence chat. This path is only for a
  // recognizable order list where every line supplies a product signal.
  if (items.some((item) => !item.skuCandidate && !item.dimensions && !item.quantity)) {
    return null;
  }

  const hasInvalidQuantity = items.some((item) => /\b(?:qty|quantity)\s*0\b/i.test(item.rawReference));

  return {
    intent: 'product_enquiry',
    requestMode: 'fresh_search',
    decisionAction: 'none',
    referencedItems: [],
    removeReferencedItems: [],
    clearCartConfirmed: false,
    items,
    needsClarification: hasInvalidQuantity,
    clarificationQuestion: hasInvalidQuantity
      ? 'One item had an invalid quantity. Please send a quantity greater than 0 for that item.'
      : null,
  };
}

function findSkuLikeTokens(message) {
  const withoutDimensions = normalizeText(message)
    .replace(/\b\d+(?:\.\d+)?\s*(?:w|width)\s*(?:x|by)\s*\d+(?:\.\d+)?\s*(?:h|height)\b/gi, ' ')
    .replace(/\b\d+(?:\.\d+)?\s*x\s*\d+(?:\.\d+)?\b/gi, ' ');
  return [...new Set(withoutDimensions.match(/\b[A-Za-z]{1,4}\d[A-Za-z0-9/_-]{2,}\b/g) || [])];
}

function parseDeterministicDimensionedOrder(message) {
  const line = normalizeText(message);
  const dimensions = parseLineDimensions(line);

  if (!dimensions || !/\b(cabinet|door|drawer|vanity|base|wall)\b/i.test(line)) {
    return null;
  }

  const quantityMatch = line.match(/\b(?:qty|quantity)\s*(\d+)\b|(?:^|[^0-9])(\d+)\s*(?:qty|quantity|pieces?|pcs|nos|units|items)\b/i);
  const quantity = Number(quantityMatch?.[1] || quantityMatch?.[2]);
  const skuCandidate = findSkuLikeTokens(line)[0] || null;

  return {
    intent: 'product_enquiry',
    requestMode: 'fresh_search',
    decisionAction: 'none',
    referencedItems: [],
    removeReferencedItems: [],
    clearCartConfirmed: false,
    items: [{
      rawReference: line,
      skuCandidate,
      quantity: Number.isInteger(quantity) && quantity > 0 ? quantity : null,
      unit: null,
      description: line,
      dimensions,
      sketchHints: null,
    }],
    needsClarification: false,
    clarificationQuestion: null,
  };
}

function resolveRequestedQuantity(message, itemNumber) {
  const patterns = [
    new RegExp(`(?:option\\s*\\d+\\s+(?:for|of)\\s+(?:the\\s+)?item\\s*${itemNumber}|item\\s*${itemNumber})\\s*(?:,|:|-)?\\s*(\\d+)\\s*(?:pcs|pieces|units|items|nos)`, 'i'),
    new RegExp(`(?:item\\s*)?${itemNumber}[^\\n\\r,;]*?qty\\s*\\d+\\s+to\\s+(\\d+)`, 'i'),
    new RegExp(`(?:item\\s*)?${itemNumber}[^\\n\\r,;]*?quantity\\s*\\d+\\s+to\\s+(\\d+)`, 'i'),
    new RegExp(`(?:item\\s*)?${itemNumber}[^\\n\\r,;]*?(?:qty|quantity)\\s+(?:should\\s+)?become\\s+(\\d+)`, 'i'),
    new RegExp(`(?:item\\s*)?${itemNumber}[^\\n\\r,;]*?(?:qty|quantity)\\s+should\\s+be\\s+(\\d+)`, 'i'),
    new RegExp(`(?:item\\s*)?${itemNumber}[^\\n\\r,;]*?(?:qty|quantity)\\s+to\\s+(\\d+)`, 'i'),
    new RegExp(`(?:item\\s*)?${itemNumber}\\s*\\d+\\s*(?:-->|->|→)\\s*(\\d+)`, 'i'),
    new RegExp(`(?:item\\s*)?${itemNumber}\\s+update[^\\n\\r,;]*?from\\s+qty\\s*\\d+\\s+to\\s+(\\d+)`, 'i'),
    new RegExp(`(?:item\\s*)?${itemNumber}\\s+update[^\\n\\r,;]*?to\\s+qty\\s*(\\d+)`, 'i'),
    new RegExp(`(?:item\\s*)?${itemNumber}\\s+update[^\\n\\r,;]*?to\\s+(\\d+)`, 'i'),
    new RegExp(`(?:item\\s*)?${itemNumber}[^\\n\\r,;]*?qty\\s*(\\d+)`, 'i'),
    new RegExp(`(?:item\\s*)?${itemNumber}[^\\n\\r,;]*?(\\d+)\\s*(?:qty|quantity)\\b`, 'i'),
    new RegExp(`qty\\s*(\\d+)[^\\n\\r,;]*?(?:item\\s*)?${itemNumber}`, 'i'),
    new RegExp(`(?:item\\s*)?${itemNumber}[^\\n\\r,;]*?(\\d+)\\s*(?:pcs|pieces|units|items)`, 'i'),
    new RegExp(`change\\s+(?:item\\s*)?${itemNumber}\\s+to\\s+(?:qty\\s*)?(\\d+)`, 'i'),
    new RegExp(`(?:item\\s*)?${itemNumber}\\s+change\\s+to\\s+(?:qty\\s*)?(\\d+)`, 'i'),
    new RegExp(`\\b(?:need|want|only|make|set|keep)\\b[^\\n\\r,;]*?\\b(\\d+)\\s*(?:pcs|pieces|units|items|nos)?\\s*(?:of\\s+)?(?:the\\s+)?item\\s*${itemNumber}\\b`, 'i'),
    // Supports option lists such as "item 1 options 1,2,3 qty 2 each" without crossing into another item.
    new RegExp(`(?:item\\s*)?${itemNumber}\\b(?:(?!\\bitem\\s*\\d+\\b)[\\s\\S])*?\\bqty\\s*(\\d+)`, 'i'),
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) {
      return Number(match[1]);
    }
  }

  return null;
}

function resolveRequestedQuantityForItem(message, itemNumber) {
  const itemPattern = new RegExp(`\\bitem\\s*${itemNumber}\\b`, 'i');
  const itemMatch = itemPattern.exec(message);

  if (!itemMatch) {
    return resolveRequestedQuantity(message, itemNumber);
  }

  const nextItemOffset = message.slice(itemMatch.index + itemMatch[0].length)
    .search(/\bitem\s*\d+\b/i);
  const itemSegment = nextItemOffset === -1
    ? message.slice(itemMatch.index)
    : message.slice(itemMatch.index, itemMatch.index + itemMatch[0].length + nextItemOffset);

  return resolveRequestedQuantity(itemSegment, itemNumber);
}

function resolveSelectedOptionQuantity(message, itemNumber, optionNumber) {
  if (!optionNumber) {
    return null;
  }

  // The cart-selection UI submits one explicit item/option selection per line.
  // Keep the quantity attached to that exact option so multiple selections for
  // the same item can use different quantities.
  const optionPattern = new RegExp(
    `\\bitem\\s*${itemNumber}\\b[^\\r\\n]*?\\boption\\s*${optionNumber}\\b`,
    'i',
  );

  for (const line of String(message || '').split(/\\r?\\n/)) {
    if (!optionPattern.test(line)) {
      continue;
    }

    const quantityMatch = line.match(/\\b(?:qty|quantity)\\s*(\\d+)\\b/i)
      || line.match(/\\b(\\d+)\\s*(?:qty|quantity)\\b/i);
    const quantity = Number(quantityMatch?.[1]);
    if (Number.isInteger(quantity) && quantity > 0) {
      return quantity;
    }
  }

  return null;
}

function resolveSelectedOptionLineQuantity(message, itemNumber, optionNumber) {
  if (!optionNumber) {
    return null;
  }

  const optionPattern = new RegExp(
    '\\bitem\\s*' + itemNumber + '\\b[^\\r\\n]*?\\boption\\s*' + optionNumber + '\\b',
    'i',
  );

  for (const line of String(message || '').replace(/\r/g, '').split('\n')) {
    if (!optionPattern.test(line)) {
      continue;
    }

    const quantityMatch = line.match(/\b(?:qty|quantity)\s*(\d+)\b/i)
      || line.match(/\b(\d+)\s*(?:qty|quantity)\b/i);
    const quantity = Number(quantityMatch?.[1]);
    if (Number.isInteger(quantity) && quantity > 0) {
      return quantity;
    }
  }

  return null;
}

function hasCartStyleQuantityUpdate(message, referencedItems = []) {
  if (!referencedItems.length) {
    return false;
  }

  return referencedItems.some((itemNumber) => resolveRequestedQuantity(message, itemNumber) != null)
    && (/\b(update|change|need|want|only|make|set|keep|qty|quantity|to)\b/i.test(message) || /-->|->|→/.test(message));
}

function parseDirectSkuQuantityUpdates(message, pendingDecision) {
  if (pendingDecision?.type !== 'cart_review') {
    return null;
  }

  const updates = (pendingDecision.items || []).flatMap((pendingItem) => {
    if (!pendingItem?.sku) {
      return [];
    }

    const escapedSku = pendingItem.sku.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const skuMatch = new RegExp(`\\b${escapedSku}\\b`, 'i').exec(message);

    if (!skuMatch) {
      return [];
    }

    const lineEnd = message.indexOf('\n', skuMatch.index);
    const segment = message.slice(skuMatch.index, lineEnd === -1 ? message.length : lineEnd);
    const quantityMatch = segment.match(/\b(?:qty|quantity)\s*(?:\d+\s+to\s+)?(\d+)\b/i)
      || segment.match(/\b(?:to|become|=)\s*(\d+)\b/i);

    if (!quantityMatch || !/\b(update|change|modify|revise|set|qty|quantity)\b/i.test(segment)) {
      return [];
    }

    return [{
      itemNumber: pendingItem.itemNumber,
      rawReference: pendingItem.sku,
      skuCandidate: pendingItem.sku,
      quantity: Number(quantityMatch[1]),
      unit: null,
      description: pendingItem.productName || null,
      dimensions: null,
    }];
  });

  if (!updates.length) {
    return null;
  }

  return {
    intent: 'cart_update',
    requestMode: 'continue_previous_selection',
    decisionAction: 'change_qty',
    referencedItems: updates.map((update) => update.itemNumber),
    removeReferencedItems: [],
    clearCartConfirmed: false,
    items: updates.map(({ itemNumber, ...item }) => item),
    needsClarification: false,
    clarificationQuestion: null,
  };
}

function resolveStandaloneQuantity(message) {
  const patterns = [
    /\bqty\s*(\d+)\b/i,
    /\b(\d+)\s*qty\b/i,
    /\b(\d+)\s*(pcs|pieces|units|items|nos)\b/i,
    /\b(?:first|second|third)\s+one\s+(\d+)\b/i,
    /\boption\s+\d+\s+(\d+)\b/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) {
      return Number(match[1]);
    }
  }

  return null;
}

function parseSelectedOptionNumber(message) {
  if (/^\s*\d+\s*$/.test(message)) {
    return null;
  }

  const patterns = [
    /\boption\s+(\d+)\b/i,
    /\bgo with option\s+(\d+)\b/i,
    /\bchoose option\s+(\d+)\b/i,
    /\bselect option\s+(\d+)\b/i,
    /\bfirst one\b/i,
    /\bsecond one\b/i,
    /\bthird one\b/i,
    /^\s*(\d+)\b/,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);

    if (!match) {
      continue;
    }

    if (pattern.source.includes('first one')) {
      return 1;
    }

    if (pattern.source.includes('second one')) {
      return 2;
    }

    if (pattern.source.includes('third one')) {
      return 3;
    }

    return Number(match[1]);
  }

  return null;
}

function parseSelectedOptionsByItem(message, pendingDecision) {
  const validItemNumbers = new Set((pendingDecision?.items || []).map((item) => item.itemNumber));
  const selections = new Map();
  const mergeSelections = (itemNumber, optionNumbers) => {
    const existingOptions = selections.get(itemNumber) || [];
    selections.set(itemNumber, [...new Set([...existingOptions, ...optionNumbers])]);
  };
  const explicitOptionLinePattern = /^\s*item\s*(\d+)\s*(?:,|:|-)?\s*option\s*(\d+)(?!\s*(?:,|&|\band\b))\b[^\n\r]*$/i;
  const genericMessage = message.split(/\r?\n/).filter((line) => {
    const match = line.match(explicitOptionLinePattern);
    if (!match) {
      return true;
    }

    const itemNumber = Number(match[1]);
    const optionNumber = Number(match[2]);
    if (validItemNumbers.has(itemNumber) && optionNumber > 0) {
      mergeSelections(itemNumber, [optionNumber]);
    }
    return false;
  }).join('\n');
  const multiOptionPattern = /\bitem\s*(\d+)\s*(?:,|:|-)?\s*options?\s+([\d\s,]+)\b/gi;
  const patterns = [
    /\bitem\s*(\d+)\s*(?:,|:|-)?\s*(?:choose\s+|select\s+|go with\s+)?option\s*(\d+)\b/gi,
    /\b(?:choose\s+|select\s+|go with\s+)?option\s*(\d+)\s+(?:for|of)\s+(?:the\s+)?(?:item\s*)?(\d+)\b/gi,
  ];

  for (const match of genericMessage.matchAll(/\bitem\s*(\d+)\s*(?:,|:|-)?\s*option\s*(\d+)\b/gi)) {
    const itemNumber = Number(match[1]);
    const optionNumber = Number(match[2]);

    if (validItemNumbers.has(itemNumber) && optionNumber > 0) {
      mergeSelections(itemNumber, [optionNumber]);
    }
  }

  for (const match of genericMessage.matchAll(multiOptionPattern)) {
    const itemNumber = Number(match[1]);
    const optionNumbers = [...new Set(
      (match[2].match(/\d+/g) || []).map(Number).filter((value) => value > 0),
    )];

    if (validItemNumbers.has(itemNumber) && optionNumbers.length) {
      mergeSelections(itemNumber, optionNumbers);
    }
  }

  for (const pattern of patterns) {
    for (const match of genericMessage.matchAll(pattern)) {
      const itemNumber = Number(pattern === patterns[0] ? match[1] : match[2]);
      const optionNumber = Number(pattern === patterns[0] ? match[2] : match[1]);

      if (validItemNumbers.has(itemNumber) && Number.isFinite(optionNumber) && optionNumber > 0) {
        mergeSelections(itemNumber, [optionNumber]);
      }
    }
  }

  // Accept natural lists such as "item 2 option 1 and 3" or
  // "item 3 option 1 and option 2" in addition to comma-separated lists.
  for (const segment of genericMessage.split(/(?=\bitem\s*\d+\b)/i)) {
    const itemMatch = segment.match(/^\s*item\s*(\d+)\b/i);
    const itemNumber = Number(itemMatch?.[1]);

    if (!validItemNumbers.has(itemNumber)) {
      continue;
    }

    const listedOptionNumbers = new Set();
    const optionListMatch = segment.match(
      /\boptions?\s+(\d+(?:\s*(?:,|&|\band\b)\s*(?:option\s*)?\d+)+)\b/i,
    );

    if (optionListMatch) {
      (optionListMatch[1].match(/\d+/g) || []).forEach((value) => listedOptionNumbers.add(Number(value)));
    }

    for (const optionMatch of segment.matchAll(/\boption\s*(\d+)\b/gi)) {
      const optionReference = segment.slice(optionMatch.index);
      if (!/^\boption\s*\d+\s+for\s+(?:the\s+)?item\s*\d+\b/i.test(optionReference)) {
        listedOptionNumbers.add(Number(optionMatch[1]));
      }
    }

    if (listedOptionNumbers.size) {
      mergeSelections(
        itemNumber,
        [...listedOptionNumbers].filter((optionNumber) => optionNumber > 0),
      );
    }
  }

  return selections;
}

function looksLikeFreshNumberedList(message) {
  if (!message) {
    return false;
  }

  const hasMultipleLines = message.includes('\n');
  const hasNumberedLines = /(?:^|\n)\s*\d+[.)]\s*[a-z]/i.test(message);
  return hasMultipleLines && hasNumberedLines;
}

function parseReferencedItems(message, pendingDecision) {
  const itemNumbers = new Set((pendingDecision?.items || []).map((item) => item.itemNumber));
  const referencedItems = new Set();
  const listMatch = message.match(/\b(add|skip|remove)\s+([\d,\s]+)/i);
  const listedNumbers = listMatch
    ? new Set(
      (listMatch[2].match(/\d+/g) || [])
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value)),
    )
    : new Set();

  for (const itemNumber of itemNumbers) {
    const explicitItemPattern = new RegExp(`(?:^|\\b)item\\s*${itemNumber}(?:\\b|\\s*[,:])`, 'i');
    const optionPattern = new RegExp(`option\\s+\\d+\\s+(?:for|of)\\s+(?:the\\s+)?(?:item\\s*)?${itemNumber}\\b`, 'i');
    const itemFirstOptionPattern = new RegExp(`(?:^|\\b)(?:item\\s*)?${itemNumber}\\s+option\\s+\\d+\\b`, 'i');

    if (
      explicitItemPattern.test(message) ||
      optionPattern.test(message) ||
      itemFirstOptionPattern.test(message) ||
      listedNumbers.has(itemNumber)
    ) {
      referencedItems.add(itemNumber);
    }
  }

  if (!referencedItems.size && /\ball\b/i.test(message) && itemNumbers.size) {
    itemNumbers.forEach((itemNumber) => referencedItems.add(itemNumber));
  }

  return Array.from(referencedItems).sort((left, right) => left - right);
}

function resolveEachQuantity(message) {
  const reversedMatch = message.match(
    /\b(?:each|ea)\s*(\d+)\s*(?:pcs|pieces|unit|units|items|nos)?\b/i,
  );
  if (reversedMatch) {
    return Number(reversedMatch[1]) || null;
  }

  const match = message.match(
    /\b(?:qty|quantity)\s*(\d+)\b|\b(\d+)\s*(?:(?:pcs|pieces|unit|units|items|nos)\s*)?(?:each|ea)\b/i,
  );
  return Number(match?.[1] || match?.[2]) || null;
}

function parseAddAllPendingItems(message, pendingDecision) {
  const pendingItems = pendingDecision?.items || [];
  const normalizedMessage = normalizeNaturalContinuationLanguage(message);
  const hasAllItemsPhrase = /\b(?:add|include|take|put)\b[\s\S]*\ball\b|\ball\b[\s\S]*\b(?:add|include|take|put)\b/i.test(normalizedMessage);
  const quantityMatch = normalizedMessage.match(/\b(?:qty|quantity)\s*(\d+)\b/i)
    || normalizedMessage.match(/\b(?:each|ea)\s*(\d+)\b/i)
    || normalizedMessage.match(/\b(\d+)\s*(?:each|ea)\b/i);
  const quantity = Number(quantityMatch?.[1]) || null;

  if (!pendingItems.length || !hasAllItemsPhrase || !/\ball\b/i.test(normalizedMessage) || !quantity) {
    return null;
  }

  const items = pendingItems.flatMap((pendingItem) => {
    if (Array.isArray(pendingItem.options) && pendingItem.options.length) {
      return pendingItem.options.map((option) => ({
        rawReference: option.sku,
        skuCandidate: option.sku,
        quantity,
        unit: null,
        description: option.productName || null,
        dimensions: null,
      }));
    }

    if (!pendingItem.sku) {
      return [];
    }

    return [{
      rawReference: pendingItem.sku,
      skuCandidate: pendingItem.sku,
      quantity,
      unit: null,
      description: pendingItem.productName || null,
      dimensions: null,
    }];
  });

  return items.length ? {
    intent: 'cart_add',
    requestMode: 'continue_previous_selection',
    decisionAction: 'add',
    referencedItems: pendingItems.map((item) => item.itemNumber),
    removeReferencedItems: [],
    clearCartConfirmed: false,
    items,
    needsClarification: false,
    clarificationQuestion: null,
  } : null;
}

function parseMultipleNaturalAllOptionsRequest(message, pendingDecision) {
  const normalizedMessage = normalizeNaturalContinuationLanguage(message);
  const pendingItems = pendingDecision?.items || [];
  const itemMarkers = [...normalizedMessage.matchAll(/\bitem\s*(\d+)\b/gi)];
  const hasMessageLevelAddIntent = /\b(add|want|need|take|include|put)\b/i.test(normalizedMessage);

  if (itemMarkers.length < 2) {
    return null;
  }

  const allOptionRequests = itemMarkers.flatMap((match, index) => {
    const itemNumber = Number(match[1]);
    const segment = normalizedMessage.slice(match.index, itemMarkers[index + 1]?.index);
    const pendingItem = pendingItems.find((item) => item.itemNumber === itemNumber);
    const asksForAllOptions = /\b(all|every|each)\s+(?:the\s+)?(?:options?|suggestions?|choices?)\b/i.test(segment);
    const hasAddIntent = hasMessageLevelAddIntent || /\b(add|want|need|take|include|put)\b/i.test(segment);
    const quantity = resolveEachQuantity(segment) || resolveStandaloneQuantity(segment) || Number(pendingItem?.requestedQuantity) || null;

    if (!pendingItem || !Array.isArray(pendingItem.options) || !pendingItem.options.length || !asksForAllOptions || !hasAddIntent || !quantity) {
      return [];
    }

    return [{ pendingItem, quantity }];
  });

  const allOptionItemNumbers = new Set(allOptionRequests.map(({ pendingItem }) => pendingItem.itemNumber));
  const selectedOptionsByItem = parseSelectedOptionsByItem(normalizedMessage, pendingDecision);
  const selectedOptionRequests = [...selectedOptionsByItem.entries()]
    .filter(([itemNumber]) => !allOptionItemNumbers.has(itemNumber))
    .flatMap(([itemNumber, optionNumbers]) => {
      const pendingItem = pendingItems.find((item) => item.itemNumber === itemNumber);
      const quantity = resolveRequestedQuantityForItem(normalizedMessage, itemNumber);

      if (!pendingItem || !Array.isArray(pendingItem.options) || !quantity) {
        return [];
      }

      return [{ pendingItem, optionNumbers, quantity }];
    });

  if (!allOptionRequests.length) {
    return null;
  }

  const explicitAddMatch = normalizedMessage.match(/\badd\s+([\d,\s]+)/i);
  const explicitAddItemNumbers = explicitAddMatch
    ? [...new Set((explicitAddMatch[1].match(/\d+/g) || []).map(Number))]
      .filter((itemNumber) => pendingItems.some((item) => item.itemNumber === itemNumber))
      .filter((itemNumber) => !allOptionItemNumbers.has(itemNumber))
    : [];
  const referencedItems = [...new Set([
    ...explicitAddItemNumbers,
    ...selectedOptionRequests.map(({ pendingItem }) => pendingItem.itemNumber),
    ...allOptionRequests.map(({ pendingItem }) => pendingItem.itemNumber),
  ])];

  return {
    intent: 'cart_add',
    requestMode: 'continue_previous_selection',
    decisionAction: 'add',
    referencedItems,
    removeReferencedItems: [],
    clearCartConfirmed: false,
    items: [
      ...explicitAddItemNumbers.flatMap((itemNumber) => {
        const pendingItem = pendingItems.find((item) => item.itemNumber === itemNumber);
        return pendingItem ? [{
          rawReference: pendingItem.sku || pendingItem.requestedReference || `item ${itemNumber}`,
          skuCandidate: pendingItem.sku || null,
          quantity: Number(pendingItem.requestedQuantity) || null,
          unit: null,
          description: pendingItem.productName || pendingItem.requestedReference || null,
          dimensions: null,
        }] : [];
      }),
      ...selectedOptionRequests.flatMap(({ pendingItem, optionNumbers, quantity }) => optionNumbers.flatMap((optionNumber) => {
        const option = pendingItem.options[optionNumber - 1];
        return option ? [{
          rawReference: option.sku,
          skuCandidate: option.sku,
          quantity,
          unit: null,
          description: option.productName || null,
          dimensions: null,
        }] : [];
      })),
      ...allOptionRequests.flatMap(({ pendingItem, quantity }) => pendingItem.options.map((option) => ({
        rawReference: option.sku,
        skuCandidate: option.sku,
        quantity,
        unit: null,
        description: option.productName || null,
        dimensions: null,
      }))),
    ],
    needsClarification: false,
    clarificationQuestion: null,
  };
}

function parseNaturalAllOptionsRequest(message, pendingDecision) {
  const normalizedMessage = normalizeNaturalContinuationLanguage(message);
  const hasAllOptionsPhrase = /\b(all|every|each)\s+(?:the\s+)?(?:options?|suggestions?|choices?)\b|\ball\s+(?:three|3)\s+(?:options?|suggestions?|choices?)\b/i.test(normalizedMessage);
  const hasAddIntent = /\b(add|want|need|take|include|put)\b/i.test(normalizedMessage);

  if (!hasAllOptionsPhrase || !hasAddIntent) {
    return null;
  }

  const suggestionItems = (pendingDecision?.items || []).filter((item) => Array.isArray(item.options) && item.options.length);
  const itemMatch = normalizedMessage.match(/\bitem\s*(\d+)\b/i);
  const requestedItemNumber = Number(itemMatch?.[1]) || null;
  const pendingItem = requestedItemNumber
    ? suggestionItems.find((item) => item.itemNumber === requestedItemNumber)
    : suggestionItems.length === 1
      ? suggestionItems[0]
      : null;

  if (!pendingItem) {
    return {
      intent: 'unclear',
      requestMode: 'continue_previous_selection',
      decisionAction: 'ask_more',
      referencedItems: [],
      removeReferencedItems: [],
      clearCartConfirmed: false,
      items: [],
      needsClarification: true,
      clarificationQuestion: 'Please tell me which item number should include all suggested options, for example: add all options for item 1, quantity 2 each.',
    };
  }

  const quantity =
    resolveEachQuantity(normalizedMessage) ||
    resolveStandaloneQuantity(normalizedMessage) ||
    Number(pendingItem.requestedQuantity) ||
    null;

  if (!quantity) {
    return {
      intent: 'unclear',
      requestMode: 'continue_previous_selection',
      decisionAction: 'ask_more',
      referencedItems: [pendingItem.itemNumber],
      removeReferencedItems: [],
      clearCartConfirmed: false,
      items: [],
      needsClarification: true,
      clarificationQuestion: `Please provide the quantity for each option, for example: add all options for item ${pendingItem.itemNumber}, quantity 2 each.`,
    };
  }

  return {
    intent: 'cart_add',
    requestMode: 'continue_previous_selection',
    decisionAction: 'add',
    referencedItems: [pendingItem.itemNumber],
    removeReferencedItems: [],
    clearCartConfirmed: false,
    items: pendingItem.options.map((option) => ({
      rawReference: option.sku,
      skuCandidate: option.sku,
      quantity,
      unit: null,
      description: option.productName || null,
      dimensions: null,
    })),
    needsClarification: false,
    clarificationQuestion: null,
  };
}

function looksLikeFreshProductMessage(message) {
  if (!message) {
    return false;
  }

  if (/\bshow carts?\b|\bview carts?\b$/i.test(message)) {
    return false;
  }

  const hasSkuLikeToken = /\b[a-z]{1,6}\d{2,}[a-z0-9/_-]*\b/i.test(message);
  const hasProductDescription = /\b(cabinet|drawer|door|panel|shelf|shaker|white|black|brown|wall|base)\b/i.test(message);
  const hasQuantity = /\b\d+\s*(qty|piece|pieces|pcs|nos|units|items)\b/i.test(message);
  const hasAddIntent = /\b(add|need|want|order)\b/i.test(message);

  return hasSkuLikeToken || (hasProductDescription && (hasQuantity || hasAddIntent));
}

function isClearlyOutOfCatalogMessage(message) {
  return /\b(?:iphone|android|samsung|mobile|phone|honda|verna|car|vehicle|weather|time|date|joke)\b/i
    .test(normalizeText(message));
}

function buildUnrelatedIntent() {
  return {
    intent: 'unrelated',
    requestMode: 'fresh_search',
    decisionAction: 'none',
    referencedItems: [],
    removeReferencedItems: [],
    clearCartConfirmed: false,
    items: [],
    needsClarification: false,
    clarificationQuestion: null,
  };
}

function findQuantityPromptItem(pendingDecision, referencedItems = []) {
  const pendingItems = Array.isArray(pendingDecision?.items) ? pendingDecision.items : [];

  if (referencedItems.length === 1) {
    const referencedItem = pendingItems.find((item) => item.itemNumber === referencedItems[0]);

    if (referencedItem?.status === 'quantity_missing') {
      return referencedItem;
    }
  }

  const quantityPendingItems = pendingItems.filter((item) => item.status === 'quantity_missing');
  return quantityPendingItems.length === 1 ? quantityPendingItems[0] : null;
}

function formatRejectedQuantityInput(message) {
  return normalizeText(message).replace(/\s+/g, ' ').slice(0, 40);
}

function detectInvalidQuantityReply(message, pendingDecision, referencedItems = []) {
  const promptItem = findQuantityPromptItem(pendingDecision, referencedItems);
  const trimmedMessage = normalizeText(message);

  if (!promptItem || !trimmedMessage || !/\d/.test(trimmedMessage)) {
    return null;
  }

  if (/^\d+$/.test(trimmedMessage) || resolveStandaloneQuantity(trimmedMessage) != null) {
    return null;
  }

  if (looksLikeFreshProductMessage(trimmedMessage)) {
    return null;
  }

  if (/[a-z]/i.test(trimmedMessage) && !/\b(qty|quantity|pcs|pieces|units|items|nos)\b/i.test(trimmedMessage)) {
    return null;
  }

  return promptItem;
}

function buildInvalidQuantityIntent(message, pendingDecision, referencedItems = []) {
  const promptItem = findQuantityPromptItem(pendingDecision, referencedItems);
  const itemLabel = promptItem?.sku || promptItem?.productName || promptItem?.requestedReference || 'that item';
  const rejectedInput = formatRejectedQuantityInput(message);

  return {
    intent: 'unclear',
    requestMode: 'continue_previous_selection',
    decisionAction: 'ask_more',
    referencedItems: promptItem?.itemNumber ? [promptItem.itemNumber] : [],
    removeReferencedItems: [],
    clearCartConfirmed: false,
    items: [],
    needsClarification: true,
    clarificationQuestion: `I couldn't use "${rejectedInput}" because quantity must be a whole number with digits only. Please reply with just the quantity for ${itemLabel}. How many would you like?`,
  };
}

export function parseContinuationRequest(message, pendingDecision, activePrompt = null) {
  if (!pendingDecision?.items?.length) {
    return null;
  }

  const normalizedMessage = normalizeNaturalContinuationLanguage(message);
  const isExtractedFileFlow = pendingDecision?.source === 'extracted_file';

  if (!normalizedMessage) {
    return null;
  }

  const bareOptionNumber = /^\d+$/.test(normalizedMessage)
    ? Number(normalizedMessage)
    : null;
  const resolvedActivePrompt = activePrompt || deriveActivePrompt({ pendingDecision });
  const promptedSuggestionItems = resolvedActivePrompt?.type === 'select_option'
    ? pendingDecision.items.filter((item) => resolvedActivePrompt.itemNumbers?.includes(item.itemNumber))
    : [];
  const soleSuggestionItem = promptedSuggestionItems.length === 1
    ? promptedSuggestionItems[0]
    : null;
  const bareSelectedOption = bareOptionNumber && soleSuggestionItem
    ? soleSuggestionItem.options?.[bareOptionNumber - 1] || null
    : null;

  // In phrases such as "add 2 of 2nd option", the first number is the
  // requested quantity and the ordinal is the option number. Resolve both
  // deterministically while the assistant has exactly one active option list.
  const quantityOfOptionMatch = normalizedMessage.match(new RegExp(
    `\\b(?:add|want|need|take|include|put)\\s+(\\d+|${NATURAL_CARDINAL_PATTERN})\\s+of\\s+(?:the\\s+)?option\\s+(\\d+)\\b`,
    'i',
  ));
  const quantityOfOption = Number(quantityOfOptionMatch?.[1]) ||
    parseNaturalCardinal(quantityOfOptionMatch?.[1]);
  const quantityOptionNumber = Number(quantityOfOptionMatch?.[2]);
  const quantitySelectedOption = quantityOptionNumber && soleSuggestionItem
    ? soleSuggestionItem.options?.[quantityOptionNumber - 1] || null
    : null;

  if (quantitySelectedOption && Number.isInteger(quantityOfOption) && quantityOfOption > 0) {
    return {
      intent: 'cart_add',
      requestMode: 'continue_previous_selection',
      decisionAction: 'add',
      referencedItems: [soleSuggestionItem.itemNumber],
      removeReferencedItems: [],
      clearCartConfirmed: false,
      items: [{
        rawReference: quantitySelectedOption.sku,
        skuCandidate: quantitySelectedOption.sku,
        quantity: quantityOfOption,
        unit: null,
        description: quantitySelectedOption.productName || quantitySelectedOption.description || null,
        dimensions: null,
        sketchHints: null,
      }],
      needsClarification: false,
      clarificationQuestion: null,
    };
  }

  // A bare number is ambiguous in general, but not when the latest assistant
  // response contains exactly one suggestion list. Treat it as the option
  // number. Carry forward a quantity from the original request when present;
  // otherwise keep it empty so the customer is asked for quantity next.
  if (bareSelectedOption) {
    const pendingRequestedQuantity = Number(soleSuggestionItem.requestedQuantity);
    const hasPendingRequestedQuantity =
      Number.isInteger(pendingRequestedQuantity) && pendingRequestedQuantity > 0;

    return {
      intent: hasPendingRequestedQuantity ? 'cart_add' : 'product_enquiry',
      requestMode: 'continue_previous_selection',
      decisionAction: hasPendingRequestedQuantity ? 'add' : 'none',
      referencedItems: [soleSuggestionItem.itemNumber],
      removeReferencedItems: [],
      clearCartConfirmed: false,
      items: [{
        rawReference: bareSelectedOption.sku,
        skuCandidate: bareSelectedOption.sku,
        quantity: hasPendingRequestedQuantity ? pendingRequestedQuantity : null,
        unit: null,
        description: bareSelectedOption.productName || bareSelectedOption.description || null,
        dimensions: null,
        sketchHints: null,
      }],
      needsClarification: false,
      clarificationQuestion: null,
    };
  }

  if (/\b(new order|start over|start a new order|fresh order)\b/i.test(normalizedMessage)) {
    return {
      intent: 'product_enquiry',
      requestMode: 'fresh_search',
      decisionAction: 'start_new_order',
      referencedItems: [],
      items: [],
      needsClarification: true,
      clarificationQuestion: 'Please send the new SKU or product description with quantity.',
    };
  }

  const naturalAllOptionsIntent =
    parseMultipleNaturalAllOptionsRequest(normalizedMessage, pendingDecision) ||
    parseNaturalAllOptionsRequest(normalizedMessage, pendingDecision);
  if (naturalAllOptionsIntent) {
    return naturalAllOptionsIntent;
  }

  const referencedItems = parseReferencedItems(normalizedMessage, pendingDecision);
  const selectedOptionNumber = parseSelectedOptionNumber(normalizedMessage);
  const selectedOptionsByItem = parseSelectedOptionsByItem(normalizedMessage, pendingDecision);
  const hasSelectedOption = Boolean(selectedOptionNumber) || selectedOptionsByItem.size > 0;
  const addAllPendingItemsIntent = parseAddAllPendingItems(normalizedMessage, pendingDecision);
  const standaloneQuantity = resolveStandaloneQuantity(normalizedMessage) || (
    /^\d+$/.test(normalizedMessage) ? Number(normalizedMessage) : null
  );
  const hasReferencedCartQuantityUpdate = hasCartStyleQuantityUpdate(
    normalizedMessage,
    referencedItems,
  );
  const directSkuQuantityUpdates = parseDirectSkuQuantityUpdates(normalizedMessage, pendingDecision);
  const hasDecisionWords = /\b(add|skip|remove|option|change|qty|quantity|available|delivery|ship|choose|confirm|yes|no|cart|carts|clear|empty)\b/i
    .test(normalizedMessage);
  const invalidQuantityPromptItem = detectInvalidQuantityReply(
    normalizedMessage,
    pendingDecision,
    referencedItems,
  );

  if (directSkuQuantityUpdates) {
    return directSkuQuantityUpdates;
  }

  if (addAllPendingItemsIntent) {
    return addAllPendingItemsIntent;
  }

  if (
    referencedItems.length &&
    /\bremove\b/i.test(normalizedMessage) &&
    looksLikeFreshProductMessage(normalizedMessage)
  ) {
    return null;
  }

  if (looksLikeFreshNumberedList(message) && looksLikeFreshProductMessage(normalizedMessage)) {
    return null;
  }

  if (!referencedItems.length && looksLikeFreshProductMessage(normalizedMessage)) {
    return null;
  }

  if (invalidQuantityPromptItem) {
    return buildInvalidQuantityIntent(message, pendingDecision, referencedItems);
  }

  if (!referencedItems.length && !hasDecisionWords && !hasSelectedOption && !standaloneQuantity) {
    // Do not let an unrelated message be interpreted through stale cart context.
    // Fresh SKU/product requests already return above, so this is safe to treat as unrelated.
    return buildUnrelatedIntent();
  }

  let decisionAction = 'none';
  let intent = 'unclear';
  let clarificationQuestion = null;

  if (/\b(clear|empty)\s+cart\b/i.test(normalizedMessage) && !referencedItems.length) {
    decisionAction = 'clear_cart';
    intent = 'cart_remove';
  } else if (/\bshow carts?\b|\bview carts?\b$/i.test(normalizedMessage) && !referencedItems.length) {
    decisionAction = 'ask_more';
    intent = 'cart_view';
  } else if (/\bremove\b/i.test(normalizedMessage) && (/\bupdate\b|\bqty\b|\bquantity\b/i.test(normalizedMessage))) {
    // Mixed message: some items to remove, others to update qty — parse per line/segment
    const hasRemove = /\bremove\b/i.test(normalizedMessage);
    const hasUpdate = /\b(update|qty|quantity)\b/i.test(normalizedMessage);

    if (hasRemove && hasUpdate) {
      // Split by newline or "item N" boundaries, classify each segment
      const segments = normalizedMessage.split(/\n|(?=\bitem\s*\d+\b)/i).filter(Boolean);

      const removeItems = [];
      const updateItems = [];

      for (const segment of segments) {
        const itemMatch = segment.match(/\bitem\s*(\d+)\b/i);
        if (!itemMatch) continue;
        const itemNum = Number(itemMatch[1]);
        if (/\bremove\b/i.test(segment)) {
          removeItems.push(itemNum);
        } else if (/\b(update|qty|quantity|to)\b/i.test(segment)) {
          updateItems.push(itemNum);
        }
      }

      if (removeItems.length && updateItems.length) {
        // Both remove and update — process remove items, keep update items in referencedItems
        decisionAction = 'change_qty';
        intent = 'cart_update';
        // Override referencedItems to only the update targets
        referencedItems.length = 0;
        updateItems.forEach((n) => referencedItems.push(n));
        // removeReferencedItems will be set below from removeItems
        return {
          intent,
          requestMode: 'continue_previous_selection',
          decisionAction,
          referencedItems,
          removeReferencedItems: removeItems,
          clearCartConfirmed: false,
          items: referencedItems
            .filter((itemNumber) => pendingDecision?.items?.find((i) => i.itemNumber === itemNumber))
            .map((itemNumber) => {
              const pendingItem = pendingDecision.items.find((i) => i.itemNumber === itemNumber);
              const newQty = resolveRequestedQuantity(normalizedMessage, itemNumber);
              return {
                rawReference: pendingItem?.requestedReference || pendingItem?.sku || String(itemNumber),
                skuCandidate: pendingItem?.sku || null,
                quantity: newQty || pendingItem?.requestedQuantity || null,
                unit: null,
                description: null,
                dimensions: null,
                sketchHints: null,
              };
            }),
          needsClarification: false,
          clarificationQuestion: null,
        };
      }
    }

    // Only remove, no update
    decisionAction = 'skip';
    intent = 'cart_remove';
  } else if (/\bskip\b|\bremove\b|\bno\b/i.test(normalizedMessage)) {
    decisionAction = 'skip';
    intent = /\bremove\b/i.test(normalizedMessage) ? 'cart_remove' : 'cart_update';
  } else if (/\boption\b/i.test(normalizedMessage) || hasSelectedOption) {
    // When the message ALSO contains an explicit "add N,N,N" list, treat this as
    // a mixed message. Honour the add part only — option selections require a
    // clean separate turn so the parser doesn't drop the add items.
    const hasExplicitAddList = /\badd\s+[\d,\s]+/i.test(normalizedMessage);
    if (hasExplicitAddList) {
      // Strip the option lines and re-parse referencedItems from the add portion only.
      const addLineMatch = normalizedMessage.match(/\badd\s+([\d,\s]+)/i);
      const addedNums = addLineMatch
        ? (addLineMatch[1].match(/\d+/g) || [])
            .map(Number)
            .filter((n) => Number.isFinite(n))
        : [];
      // Replace referencedItems with only the add targets; option lines are ignored this turn.
      referencedItems.length = 0;
      addedNums
        .filter((n) => (pendingDecision?.items || []).some((i) => i.itemNumber === n))
        .forEach((n) => referencedItems.push(n));
      decisionAction = 'add';
      intent = 'cart_add';
    } else {
      decisionAction = 'choose_option';
      intent = 'product_enquiry';
    }
  } else if (
    pendingDecision?.type === 'cart_review' &&
    referencedItems.length &&
    hasReferencedCartQuantityUpdate
  ) {
    decisionAction = 'change_qty';
    intent = 'cart_update';
  } else if ((/\bchange\b/i.test(normalizedMessage) || /\bupdate\b/i.test(normalizedMessage)) && /\b(qty|quantity)\b/i.test(normalizedMessage)) {
    decisionAction = 'change_qty';
    intent = 'cart_update';
  } else if (/\bmore\b|\bshow more\b|\banother option\b/i.test(normalizedMessage)) {
    decisionAction = 'ask_more';
    intent = 'product_enquiry';
  } else if (/\badd\b|\byes\b|\bconfirm\b|\ball available\b|\bdelivery\b/i.test(normalizedMessage)) {
    decisionAction = 'add';
    intent = 'cart_add';
  } else if (
    referencedItems.length > 0 &&
    /\bqty\b|\bquantity\b/i.test(normalizedMessage) &&
    referencedItems.every((n) => resolveRequestedQuantity(normalizedMessage, n) != null)
  ) {
    // Bulk qty provision — user sent multiple "item N qty N" lines at once.
    // Every referenced item has a qty — treat the whole message as a cart_add.
    decisionAction = 'add';
    intent = 'cart_add';
  }

  if (
    intent === 'unclear' &&
    pendingDecision?.type === 'cart_review' &&
    referencedItems.length &&
    /\b(update|change|need|want|make|set|keep|replace|increase|decrease|instead)\b/i.test(normalizedMessage)
  ) {
    // Let the structured LLM interpret uncommon cart-update wording, then validate it through the usual schema.
    return null;
  }

  if (!referencedItems.length && hasSelectedOption) {
    if ((pendingDecision?.items || []).length === 1) {
      referencedItems.push(pendingDecision.items[0].itemNumber);
    } else {
      clarificationQuestion =
        'Please reply with the item number too, for example: option 1 for 2 qty or option 2 for 1 qty.';
    }
  }

  if (!referencedItems.length && /\byes\b|\bconfirm\b/i.test(normalizedMessage)) {
    const autoAddableItems = (pendingDecision?.items || [])
      .filter((item) => ['fully_available', 'lead_time_only', 'split_availability'].includes(item.status))
      .map((item) => item.itemNumber);

    if (isExtractedFileFlow && autoAddableItems.length) {
      referencedItems.push(...autoAddableItems);
    } else if ((pendingDecision?.items || []).length === 1) {
      referencedItems.push(pendingDecision.items[0].itemNumber);
    } else {
      clarificationQuestion =
        'Please reply with item numbers, for example: add 1,3 or add 2 for the delivery date.';
    }
  }

  // Auto-populate addable items when user says "add matched items" (or similar add phrases)
  // without specifying explicit item numbers — mirrors the yes/confirm logic above but
  // applies to all flows so the parser always has concrete items to act on.
  if (!referencedItems.length && decisionAction === 'add' && intent === 'cart_add') {
    const autoAddableItems = (pendingDecision?.items || [])
      .filter((item) =>
        ['fully_available', 'lead_time_only', 'split_availability'].includes(item.status),
      )
      .map((item) => item.itemNumber);

    if (autoAddableItems.length) {
      referencedItems.push(...autoAddableItems);
    } else if ((pendingDecision?.items || []).length === 1) {
      referencedItems.push(pendingDecision.items[0].itemNumber);
    } else {
      clarificationQuestion =
        'Please reply with item numbers, for example: add 1,3 or add 2.';
    }
  }

  if (!referencedItems.length && standaloneQuantity) {
    const quantityPendingItems = (pendingDecision?.items || []).filter((item) => item.status === 'quantity_missing');

    if (quantityPendingItems.length === 1) {
      referencedItems.push(quantityPendingItems[0].itemNumber);
      decisionAction = 'add';
      intent = 'product_enquiry';
    } else if ((pendingDecision?.items || []).length === 1) {
      referencedItems.push(pendingDecision.items[0].itemNumber);
      if (intent === 'unclear') {
        decisionAction = 'add';
        intent = 'product_enquiry';
      }
    } else if ((pendingDecision?.items || []).length > 1) {
      clarificationQuestion =
        'Please reply with the item number and quantity, for example: item 1 qty 5.';
    }
  }

  if (
    decisionAction === 'ask_more' &&
    /\bmore\b|\bshow more\b|\banother option\b/i.test(normalizedMessage)
  ) {
    clarificationQuestion =
      'Please choose one of the shown options with quantity, for example: item 1 option 2 qty 1. You can also send a new SKU or product description.';
  }

  const items = referencedItems
    .flatMap((itemNumber) => {
      const pendingItem = pendingDecision.items.find((item) => item.itemNumber === itemNumber);

      if (!pendingItem) {
        return [];
      }

      const directQuantityMatch = normalizedMessage.match(
        new RegExp(`\\bitem\\s*${itemNumber}\\b[^\\n\\r,;]*?\\b(?:qty|quantity)\\s*(\\d+)`, 'i'),
      );
      const parsedQuantity = Number(directQuantityMatch?.[1]) ||
        resolveRequestedQuantityForItem(normalizedMessage, itemNumber) ||
        resolveEachQuantity(normalizedMessage) ||
        standaloneQuantity;
      const directOptionMatch = normalizedMessage.match(
        new RegExp(`\\bitem\\s*${itemNumber}\\s*(?:,|:|-)?\\s*option\\s*(\\d+)\\b`, 'i'),
      );
      const selectedOptionNumbers = selectedOptionsByItem.get(itemNumber) || (
        directOptionMatch ? [Number(directOptionMatch[1])] : null
      );
      const selectedOptionNumbersForItem = selectedOptionNumbers?.length
        ? selectedOptionNumbers.filter((optionNumber) => pendingItem.options?.[optionNumber - 1])
        : (selectedOptionNumber ? [selectedOptionNumber] : [null]);

      return selectedOptionNumbersForItem.map((optionNumber) => {
        const selectedOption =
          optionNumber && Array.isArray(pendingItem.options)
            ? pendingItem.options[optionNumber - 1] || null
            : null;

        return {
          rawReference:
            selectedOption?.sku ||
            pendingItem.sku ||
            pendingItem.requestedReference ||
            `item ${itemNumber}`,
          skuCandidate: selectedOption?.sku || pendingItem.sku || null,
          quantity:
            (directQuantityMatch ? Number(directQuantityMatch[1]) : null) ||
            resolveSelectedOptionLineQuantity(normalizedMessage, itemNumber, optionNumber) ||
            parsedQuantity ||
            pendingItem.requestedQuantity ||
            null,
          unit: null,
          description:
            selectedOption?.productName ||
            pendingItem.productName ||
            pendingItem.requestedReference ||
            null,
          dimensions: null,
        };
      });
    })
    .filter(Boolean);

  return {
    intent,
    requestMode: 'continue_previous_selection',
    decisionAction,
    referencedItems,
    removeReferencedItems: intent === 'cart_remove' ? referencedItems : [],
    clearCartConfirmed: false,
    items,
    needsClarification: Boolean(clarificationQuestion),
    clarificationQuestion,
  };
}

function resolveOrderSummaryIntent(message, orderSummaryState, cart) {
  const normalizedMessage = normalizeText(message).toLowerCase();

  if (!normalizedMessage) {
    return null;
  }

  const hasCartItems = Array.isArray(cart?.items) && cart.items.length > 0;
  const summaryStatus = orderSummaryState?.status || null;

  if (hasCartItems && summaryStatus !== 'awaiting_confirmation' && isOrderSummaryRequest(normalizedMessage)) {
    return {
      intent: 'order_summary',
      requestMode: 'continue_previous_selection',
      decisionAction: 'prepare_order_summary',
      referencedItems: [],
      removeReferencedItems: [],
      clearCartConfirmed: false,
      items: [],
      needsClarification: false,
      clarificationQuestion: null,
    };
  }

  if (summaryStatus === 'awaiting_confirmation') {
    if (isOrderSummaryConfirm(normalizedMessage)) {
      return {
        intent: 'order_submit',
        requestMode: 'continue_previous_selection',
        decisionAction: 'submit_order',
        referencedItems: [],
        removeReferencedItems: [],
        clearCartConfirmed: false,
        items: [],
        needsClarification: false,
        clarificationQuestion: null,
      };
    }

    if (isOrderSummaryEdit(normalizedMessage) && !looksLikeDirectCartEdit(normalizedMessage)) {
      return {
        intent: 'order_summary',
        requestMode: 'continue_previous_selection',
        decisionAction: 'edit_order_summary',
        referencedItems: [],
        removeReferencedItems: [],
        clearCartConfirmed: false,
        items: [],
        needsClarification: false,
        clarificationQuestion: 'Please update the cart items, then say `Place the order` again to refresh the order summary.',
      };
    }
  }

  return null;
}

function resolvePendingImageConfirmation(message, pendingImageConfirmation) {
  if (!pendingImageConfirmation?.uncertainItems?.length) {
    return null;
  }

  if (!/\b(confirm image details|confirm details|details are correct|image details are correct)\b/i.test(message || '')) {
    return null;
  }

  return {
    intent: 'conversation',
    requestMode: 'continue_previous_selection',
    decisionAction: 'none',
    referencedItems: [],
    removeReferencedItems: [],
    clearCartConfirmed: false,
    items: [],
    needsClarification: false,
    clarificationQuestion: null,
    imageDetailsConfirmed: true,
  };
}

// A model must never be able to create a final order merely by classifying a
// message as submit. A final write is valid only after this thread has a saved
// quote/order summary awaiting an explicit confirmation.
function enforceOrderSubmissionStage(intent, orderSummaryState, cart) {
  if (intent?.intent !== 'order_submit' || orderSummaryState?.status === 'awaiting_confirmation') {
    return intent;
  }

  if (Array.isArray(cart?.items) && cart.items.length) {
    return {
      ...intent,
      intent: 'order_summary',
      decisionAction: 'prepare_order_summary',
      needsClarification: false,
      clarificationQuestion: null,
    };
  }

  return {
    ...intent,
    intent: 'unclear',
    decisionAction: 'ask_more',
    needsClarification: true,
    clarificationQuestion: 'Your cart is empty. Please add an item before placing an order.',
  };
}

function formatPendingDecision(pendingDecision = {}) {
  if (!pendingDecision?.items?.length) {
    return 'No pending item decisions.';
  }

  return pendingDecision.items.map((item) => {
    const parts = [
      `Item ${item.itemNumber}: ${item.sku || item.requestedReference}`,
      `status=${item.status}`,
    ];

    if (item.requestedQuantity) {
      parts.push(`requestedQty=${item.requestedQuantity}`);
    }

    if (item.availableNow != null) {
      parts.push(`availableNow=${item.availableNow}`);
    }

    if (item.estimatedDate) {
      parts.push(`estimatedDate=${item.estimatedDate}`);
    }

    if (Array.isArray(item.options) && item.options.length) {
      parts.push(`options=${item.options.map((option, index) => `${index + 1}:${option.sku}`).join('|')}`);
    }

    return parts.join(', ');
  }).join('\n');
}

function formatDeterministicContinuation(intent) {
  if (!intent) {
    return 'No deterministic continuation detected.';
  }

  return JSON.stringify({
    intent: intent.intent,
    requestMode: intent.requestMode,
    decisionAction: intent.decisionAction,
    referencedItems: intent.referencedItems,
    removeReferencedItems: intent.removeReferencedItems,
    items: (intent.items || []).map((item) => ({
      skuCandidate: item.skuCandidate,
      quantity: item.quantity,
    })),
    needsClarification: intent.needsClarification,
  });
}

function hasExplicitAddLanguage(message) {
  const normalizedMessage = normalizeText(message);

  if (/\b(add|cart|confirm|go ahead|place order|order it|yes add|add it)\b/i.test(normalizedMessage)) {
    return true;
  }

  const hasNaturalOrderVerb = /\b(want|need|take|buy|purchase|give me|get me|i['’]?d like)\b/i
    .test(normalizedMessage);
  const hasStatedQuantity = /\b(?:qty|quantity)\s*\d+\b|\b\d+\s*(?:qty|pieces?|pcs|nos|units|items)\b/i
    .test(normalizedMessage) ||
    new RegExp(`\\b(?:${NATURAL_CARDINAL_PATTERN})\\b`, 'i').test(normalizedMessage) ||
    /\b(?:want|need|take|buy|purchase|give me|get me|i['’]?d like)\s+(?:\w+\s+){0,2}?\d+\b(?!\s*(?:inches?|inch|in|feet|foot|ft|cm|mm)\b)/i
      .test(normalizedMessage);

  return hasNaturalOrderVerb && hasStatedQuantity;
}

function hasMeaningfulQuantity(items = []) {
  return items.some((item) => Number.isFinite(Number(item.quantity)) && Number(item.quantity) > 0);
}

function applyExplicitSingleItemQuantity(intent, payload) {
  const items = Array.isArray(intent?.items) ? intent.items : [];
  const message = normalizeText(payload?.userMessage);
  const numericQuantityMatch = message
    .match(/(?:^|[^0-9])(\d+)\s*(?:qty|quantity|pieces?|pcs|nos|units|items)\b/i);
  const skuMultiplierQuantityMatch = message
    .match(/\b[A-Za-z][A-Za-z0-9/_-]*\s+[x×]\s*(\d+)\b/i);
  const labeledNaturalQuantityMatch = message.match(new RegExp(
    `\\b(?:qty|quantity)\\s*(${NATURAL_CARDINAL_PATTERN})\\b|\\b(${NATURAL_CARDINAL_PATTERN})\\s*(?:pieces?|pcs|nos|units|items)\\b`,
    'i',
  ));
  const orderedNaturalQuantityMatch = hasExplicitAddLanguage(message)
    ? message.match(new RegExp(`\\b(${NATURAL_CARDINAL_PATTERN})\\b`, 'i'))
    : null;
  const quantity = numericQuantityMatch
    ? Number(numericQuantityMatch[1])
    : skuMultiplierQuantityMatch
      ? Number(skuMultiplierQuantityMatch[1])
    : parseNaturalCardinal(
      labeledNaturalQuantityMatch?.[1] ||
      labeledNaturalQuantityMatch?.[2] ||
      orderedNaturalQuantityMatch?.[1],
    );

  if (
    items.length !== 1 ||
    hasMeaningfulQuantity(items) ||
    !Number.isInteger(quantity) ||
    quantity <= 0
  ) {
    return intent;
  }

  return {
    ...intent,
    items: items.map((item) => ({ ...item, quantity })),
  };
}

function findConflictingSingleItemQuantities(message) {
  const normalized = normalizeText(message);
  const quantities = [...normalized.matchAll(/(?:^|[^0-9])(\d+)\s*(?:qty|quantity)\b/gi)]
    .map((match) => Number(match[1]))
    .filter((quantity) => Number.isInteger(quantity) && quantity > 0);
  const distinctQuantities = [...new Set(quantities)];
  const skuReferences = normalized.match(/\b[A-Za-z]+\d[A-Za-z0-9/_-]*\b/g) || [];

  // Multiple quantities are valid for a clearly numbered/multi-line order. For a
  // single product reference, however, selecting one silently is unsafe.
  if (distinctQuantities.length > 1 && skuReferences.length <= 1 && !/\bitem\s*\d+\b/i.test(normalized)) {
    return distinctQuantities;
  }

  return null;
}

function isBareLookupMessage(message) {
  if (!message) {
    return false;
  }

  if (hasExplicitAddLanguage(message)) {
    return false;
  }

  if (/\b\d+\s*(qty|piece|pieces|pcs|nos|units|items)\b/i.test(message)) {
    return false;
  }

  const normalized = message.toLowerCase();

  if (
    normalized.includes('\n') ||
    normalized.includes(',') ||
    /\b(width|height|depth|inch|inches|cabinet|door|white|black|brown)\b/i.test(normalized)
  ) {
    return false;
  }

  return /^[a-z0-9\s/_-]+$/i.test(message);
}

function sanitizeModelIntent(intent) {
  if (!intent || typeof intent !== 'object') {
    return intent;
  }

  let invalidQuantityCount = 0;
  const sanitizedItems = Array.isArray(intent.items)
    ? intent.items.map((item) => {
      const numericQuantity = Number(item?.quantity);
      const hasExplicitQuantity = item?.quantity !== null && item?.quantity !== undefined;
      const hasValidQuantity = Number.isFinite(numericQuantity) && numericQuantity > 0;

      if (hasExplicitQuantity && !hasValidQuantity) {
        invalidQuantityCount += 1;
      }

      return {
        ...item,
        quantity: hasValidQuantity ? numericQuantity : null,
      };
    })
    : [];

  if (!invalidQuantityCount) {
    return {
      ...intent,
      items: sanitizedItems,
    };
  }

  const existingQuestion = normalizeText(intent.clarificationQuestion);
  const invalidQuantityQuestion = invalidQuantityCount === 1
    ? 'One item had an invalid quantity. Please send a quantity greater than 0 for that item.'
    : 'Some items had invalid quantities. Please send quantities greater than 0 for those items.';

  return {
    ...intent,
    items: sanitizedItems,
    needsClarification: true,
    clarificationQuestion: existingQuestion || invalidQuantityQuestion,
  };
}

function reconcileContinuationIntent(regexIntent, modelIntent) {
  if (!regexIntent) {
    return modelIntent;
  }

  // A complete local command contains explicit item numbers and quantities. Keep those
  // facts authoritative so a model cannot alter a cart update through interpretation.
  const hasCompleteRegexCommand =
    regexIntent.requestMode === 'continue_previous_selection' &&
    regexIntent.decisionAction !== 'none' &&
    !regexIntent.needsClarification;

  const hasResolvedSuggestionWithoutQuantity =
    regexIntent.requestMode === 'continue_previous_selection' &&
    regexIntent.decisionAction === 'none' &&
    regexIntent.items?.length === 1 &&
    Boolean(regexIntent.items[0]?.skuCandidate) &&
    !regexIntent.items[0]?.quantity;

  if (hasCompleteRegexCommand || hasResolvedSuggestionWithoutQuantity) {
    return regexIntent;
  }

  return modelIntent;
}

function normalizeFreshSearchIntent(intent, payload, pendingDecision) {
  const message = normalizeText(payload?.userMessage);

  if (!message) {
    return intent;
  }

  const hasExplicitSelectionReference = /\b(?:item|option)\s*\d+\b/i.test(message);
  const isFreshProductRequest = looksLikeFreshProductMessage(message) && !hasExplicitSelectionReference;

  // The current message is authoritative over stale checkpoint context. A new
  // SKU or product description without item/option references cannot be a cart
  // continuation, even when the model copied a continuation action from memory.
  if (isFreshProductRequest) {
    const isExplicitAdd = hasExplicitAddLanguage(message);
    const keepModelCartAdd = intent?.intent === 'cart_add' && isExplicitAdd;
    const hasExplicitQuantitySyntax = /\b(?:qty|quantity)\s*\d+\b|(?:^|[^0-9])\d+\s*(?:qty|quantity|pieces?|pcs|nos|units|items)\b|\b[A-Za-z][A-Za-z0-9/_-]*\s+[x×]\s*\d+\b/i
      .test(message);
    const hasExplicitNaturalQuantitySyntax = new RegExp(
      `\\b(?:add|want|need|take|buy|purchase|include|put|give me|get me|i['’]?d like)\\s+(${NATURAL_CARDINAL_PATTERN})\\s+(?:of\\s+)?(?!inches?\\b|inch\\b|feet\\b|foot\\b|ft\\b|cm\\b|mm\\b)\\S+`,
      'i',
    ).test(message) || new RegExp(
      `\\b(?:qty|quantity)\\s*(${NATURAL_CARDINAL_PATTERN})\\b|\\b(${NATURAL_CARDINAL_PATTERN})\\s*(?:pieces?|pcs|nos|units|items)\\b`,
      'i',
    ).test(message);

    return {
      ...intent,
      intent: keepModelCartAdd ? 'cart_add' : 'product_enquiry',
      decisionAction: keepModelCartAdd ? 'add' : 'none',
      requestMode: 'fresh_search',
      referencedItems: [],
      removeReferencedItems: [],
      items: (intent.items || []).map((item) => ({
        ...item,
        quantity:
          keepModelCartAdd || hasExplicitQuantitySyntax || hasExplicitNaturalQuantitySyntax
            ? item.quantity
            : null,
      })),
    };
  }

  if (intent?.requestMode === 'continue_previous_selection') {
    return intent;
  }

  // LLM sometimes classifies a fresh product description as "choose_option" when
  // there is a pending decision in context. Detect this misclassification: if the
  // message looks like a product search (has product keywords) AND does NOT contain
  // an explicit item/option reference, override to a fresh search.
  if (
    intent?.intent === 'product_enquiry' &&
    intent?.decisionAction === 'choose_option' &&
    looksLikeFreshProductMessage(message) &&
    !(intent.referencedItems?.length)
  ) {
    return {
      ...intent,
      decisionAction: 'none',
      requestMode: 'fresh_search',
    };
  }

  if (intent?.intent !== 'cart_add') {
    return intent;
  }

  if (hasExplicitAddLanguage(message)) {
    return intent;
  }

  return {
    ...intent,
    intent: 'product_enquiry',
    decisionAction: 'none',
    requestMode: 'fresh_search',
    items: (intent.items || []).map((item) => ({
      ...item,
      quantity: isBareLookupMessage(message) ? null : (hasMeaningfulQuantity(intent.items) ? item.quantity : null),
    })),
  };
}

function resolvePendingCartConfirmation(message, pendingCartActionConfirmation) {
  if (!pendingCartActionConfirmation?.action) {
    return null;
  }

  const normalizedMessage = normalizeText(message).toLowerCase();

  if (!normalizedMessage) {
    return null;
  }

  if (/\b(yes|confirm|go ahead|clear it|do it|okay)\b/i.test(normalizedMessage)) {
    return {
      intent: 'cart_remove',
      requestMode: 'continue_previous_selection',
      decisionAction: 'confirm_clear_cart',
      referencedItems: [],
      removeReferencedItems: [],
      clearCartConfirmed: true,
      items: [],
      needsClarification: false,
      clarificationQuestion: null,
    };
  }

  if (/\b(no|cancel|keep|don['’]?t)\b/i.test(normalizedMessage)) {
    return {
      intent: 'cart_view',
      requestMode: 'continue_previous_selection',
      decisionAction: 'none',
      referencedItems: [],
      removeReferencedItems: [],
      clearCartConfirmed: false,
      items: [],
      needsClarification: false,
      clarificationQuestion: null,
    };
  }

  return {
    intent: 'cart_view',
    requestMode: 'continue_previous_selection',
    decisionAction: 'ask_more',
    referencedItems: [],
    removeReferencedItems: [],
    clearCartConfirmed: false,
    items: [],
    needsClarification: true,
    clarificationQuestion: 'Please reply yes to clear the cart or no to keep it.',
  };
}

// Step 2: turn customer language and checkpoint memory into a structured intent.
// Regex protects explicit facts, the LLM understands flexible wording, and validation
// ensures later nodes never act on invented item numbers or quantities.
export function createUnderstandRequestNode({ model }) {
  const structuredModel = model.withStructuredOutput(chatIntentSchema, {
    name: 'customer_order_intent',
  });

  return async function understandRequestNode(state) {
    const payload = state.agentPayload;
    const startedAt = Date.now();
    const pendingDecision = state.pendingDecision || null;
    const pendingCartActionConfirmation = state.pendingCartActionConfirmation || null;
    const orderSummaryState = state.orderSummaryState || null;
    const cart = state.cart || null;
    const fileExtraction = state.fileExtraction || null;
    const pendingImageConfirmation = state.pendingImageConfirmation || null;
    const activePrompt = state.activePrompt || deriveActivePrompt({
      pendingDecision,
      pendingCartActionConfirmation,
      pendingImageConfirmation,
      orderSummaryState,
    });
    const conflictingQuantities = findConflictingSingleItemQuantities(payload.userMessage);
    // Extract deterministic item references and quantities first. The LLM then interprets
    // natural language, and the two outputs are reconciled before any cart action runs.
    const continuationIntent = parseContinuationRequest(payload.userMessage, pendingDecision, activePrompt);
    const confirmationIntent = resolvePendingCartConfirmation(
      payload.userMessage,
      pendingCartActionConfirmation,
    );
    const orderSummaryIntent = resolveOrderSummaryIntent(
      payload.userMessage,
      orderSummaryState,
      cart,
    );
    const imageConfirmationIntent = resolvePendingImageConfirmation(
      payload.userMessage,
      pendingImageConfirmation,
    );

    logger.info('LangGraph intent understanding started', {
      requestId: payload.sessionInfo.requestId,
      requestMessage: payload.userMessage,
      messageLength: payload.userMessage.length,
      recentTurnCount: state.recentTurns?.length || 0,
      hasPendingDecision: Boolean(pendingDecision?.items?.length),
      hasPendingCartActionConfirmation: Boolean(pendingCartActionConfirmation?.action),
      hasOrderSummaryState: Boolean(orderSummaryState?.status),
      activePromptType: activePrompt?.type || null,
    });

    if (fileExtraction?.status === 'failed') {
      return {
        intent: {
          intent: 'unclear',
          requestMode: 'fresh_search',
          decisionAction: 'none',
          referencedItems: [],
          removeReferencedItems: [],
          clearCartConfirmed: false,
          items: [],
          needsClarification: true,
          clarificationQuestion: fileExtraction.clarificationQuestion,
        },
        pendingItems: [],
        pendingCartActionConfirmation: null,
      };
    }

    if (conflictingQuantities) {
      return {
        intent: {
          intent: 'unclear',
          requestMode: 'fresh_search',
          decisionAction: 'none',
          referencedItems: [],
          removeReferencedItems: [],
          clearCartConfirmed: false,
          items: [],
          needsClarification: true,
          clarificationQuestion: `I found conflicting quantities (${conflictingQuantities.join(' and ')}) for one product. Please reply with the SKU or product description and one quantity.`,
        },
        pendingItems: [],
        pendingCartActionConfirmation: null,
      };
    }

    if (/^\s*add\s+cart\s*$/i.test(payload.userMessage) && !(cart?.items || []).length) {
      return {
        intent: {
          intent: 'unclear',
          requestMode: 'fresh_search',
          decisionAction: 'none',
          referencedItems: [],
          removeReferencedItems: [],
          clearCartConfirmed: false,
          items: [],
          needsClarification: true,
          clarificationQuestion: 'Your cart is empty, so `add cart` cannot be used yet. Send a SKU or product description with quantity, for example: `W1212GD-SW qty 4`.',
        },
        pendingItems: [],
        pendingCartActionConfirmation: null,
      };
    }

    if (imageConfirmationIntent) {
      return {
        intent: imageConfirmationIntent,
        pendingItems: [],
        pendingImageConfirmation: null,
        pendingCartActionConfirmation: null,
      };
    }

    if (fileExtraction?.status === 'success' && fileExtraction.extractedItems?.length) {
      const extractedIntent = buildIntentFromExtractedItems(fileExtraction);

      logger.info('LangGraph intent resolved from extracted file items', {
        requestId: payload.sessionInfo.requestId,
        extractedItemCount: extractedIntent.items.length,
        durationMs: Date.now() - startedAt,
      });

      return {
        intent: extractedIntent,
        pendingItems: extractedIntent.items,
        pendingCartActionConfirmation: null,
      };
    }

    if (fileExtraction?.status === 'success' && normalizeText(fileExtraction?.extractedText)) {
      const recoveredTextIntent = buildIntentFromRecoveredExtractionText(fileExtraction);

      if (recoveredTextIntent) {
        logger.info('LangGraph intent resolved from recovered extraction text', {
          requestId: payload.sessionInfo.requestId,
          extractedLineCount: recoveredTextIntent.items.length,
          durationMs: Date.now() - startedAt,
        });

        return {
          intent: recoveredTextIntent,
          pendingItems: recoveredTextIntent.items,
          pendingCartActionConfirmation: null,
        };
      }
    }

    if (isClearlyOutOfCatalogMessage(payload.userMessage)) {
      return {
        intent: buildUnrelatedIntent(),
        pendingItems: [],
        pendingCartActionConfirmation: null,
      };
    }

    if (confirmationIntent) {
      return {
        intent: confirmationIntent,
        pendingItems: confirmationIntent.items,
        pendingCartActionConfirmation: null,
      };
    }

    if (orderSummaryIntent) {
      return {
        intent: orderSummaryIntent,
        pendingItems: [],
        pendingCartActionConfirmation: null,
      };
    }

    const skuLikeTokens = findSkuLikeTokens(payload.userMessage);
    if (!/\r?\n/.test(payload.userMessage) && skuLikeTokens.length > 1) {
      return {
        intent: {
          intent: 'unclear',
          requestMode: 'fresh_search',
          decisionAction: 'none',
          referencedItems: [],
          removeReferencedItems: [],
          clearCartConfirmed: false,
          items: [],
          needsClarification: true,
          clarificationQuestion: `I found more than one SKU-like identifier (${skuLikeTokens.join(', ')}). Please send each product on its own line with quantity so I do not combine them incorrectly.`,
        },
        pendingItems: [],
        pendingCartActionConfirmation: null,
      };
    }

    // A cart-selection page submits one option per line (for example,
    // "item 1 option 2 qty 3").  That is a continuation, not a new order
    // list.  The generic multiline parser cannot resolve item/option numbers
    // to SKUs, so never let it replace a valid continuation intent.
    const multiLineIntent = continuationIntent
      ? null
      : parseDeterministicMultiLineOrder(payload.userMessage);
    if (multiLineIntent) {
      logger.info('LangGraph intent resolved from deterministic multi-line order', {
        requestId: payload.sessionInfo.requestId,
        itemCount: multiLineIntent.items.length,
      });
      return {
        intent: multiLineIntent,
        pendingItems: multiLineIntent.items,
        pendingCartActionConfirmation: null,
      };
    }

    const dimensionedOrderIntent = parseDeterministicDimensionedOrder(payload.userMessage);
    if (dimensionedOrderIntent) {
      logger.info('LangGraph intent resolved from deterministic dimensioned order', {
        requestId: payload.sessionInfo.requestId,
        dimensions: dimensionedOrderIntent.items[0].dimensions,
      });
      return {
        intent: dimensionedOrderIntent,
        pendingItems: dimensionedOrderIntent.items,
        pendingCartActionConfirmation: null,
      };
    }

    let modelIntent;
    try {
      modelIntent = await withTimeout(
        structuredModel.invoke([
          {
            role: 'system',
            content: INTENT_SYSTEM_PROMPT,
          },
          {
            role: 'user',
            content: [
              `Pending decision context:\n${formatPendingDecision(pendingDecision)}`,
              `Expected reply context:\n${activePrompt ? JSON.stringify(activePrompt) : 'No active prompt.'}`,
              `Deterministic parser result (use it to verify explicit item numbers and quantities):\n${formatDeterministicContinuation(continuationIntent)}`,
              `Previous conversation:\n${formatRecentTurns(state.recentTurns)}`,
              `Conversation summary:\n${formatConversationSummary(state.conversationSummary)}`,
              `Current customer message:\n${payload.userMessage}`,
            ].join('\n\n'),
          },
        ]),
        env.langgraphUnderstandTimeoutMs,
        'understand_request LLM call',
      );
    } catch (error) {
      logger.error('LangGraph intent understanding failed or timed out', {
        requestId: payload.sessionInfo.requestId,
        error: error.message,
        durationMs: Date.now() - startedAt,
      });

      if (continuationIntent) {
        logger.info('LangGraph using regex continuation fallback after LLM failure', {
          requestId: payload.sessionInfo.requestId,
          decisionAction: continuationIntent.decisionAction,
          referencedItems: continuationIntent.referencedItems,
        });

        return {
          intent: continuationIntent,
          pendingItems: continuationIntent.items,
          pendingCartActionConfirmation:
            continuationIntent.decisionAction === 'clear_cart'
              ? { action: 'clear_cart' }
              : null,
        };
      }

      // Attempt a lightweight text-based fallback before giving up.
      // If the message looks like a multi-line product list, parse it directly
      // rather than returning a system-unavailable error to the customer.
      const recoveredIntent = buildIntentFromRecoveredExtractionText({
        extractedText: payload.userMessage,
      });

      if (recoveredIntent && recoveredIntent.items.length) {
        logger.info('LangGraph intent understanding recovered from text fallback', {
          requestId: payload.sessionInfo.requestId,
          itemCount: recoveredIntent.items.length,
        });

        return {
          intent: recoveredIntent,
          pendingItems: recoveredIntent.items,
          pendingCartActionConfirmation: null,
        };
      }

      return {
        intent: {
          intent: 'unclear',
          requestMode: 'fresh_search',
          decisionAction: 'none',
          referencedItems: [],
          removeReferencedItems: [],
          clearCartConfirmed: false,
          items: [],
          needsClarification: true,
          clarificationQuestion: AGENT_UNAVAILABLE_MESSAGE,
          systemUnavailable: true,
        },
        pendingItems: [],
        pendingCartActionConfirmation: null,
      };
    }
    const normalizedModelIntent = normalizeFreshSearchIntent(
      applyExplicitSingleItemQuantity(sanitizeModelIntent(modelIntent), payload),
      payload,
      pendingDecision,
    );
    const intent = enforceOrderSubmissionStage(
      reconcileContinuationIntent(continuationIntent, normalizedModelIntent),
      orderSummaryState,
      cart,
    );

    logger.info('LangGraph intent understanding completed', {
      requestId: payload.sessionInfo.requestId,
      intent: intent.intent,
      itemCount: intent.items.length,
      skuCandidateCount: intent.items.filter((item) => item.skuCandidate).length,
      quantityCount: intent.items.filter((item) => item.quantity).length,
      needsClarification: intent.needsClarification,
      continuationReconciled: Boolean(continuationIntent),
      durationMs: Date.now() - startedAt,
    });

    return {
      intent,
      pendingItems: intent.items,
      pendingCartActionConfirmation:
        intent.decisionAction === 'clear_cart'
          ? { action: 'clear_cart' }
          : null,
    };
  };
}
