import { createUnderstandRequestNode as createChatUnderstandRequestNode } from '../../chat/nodes/understandRequestNode.js';

function normalizeText(value) {
  return String(value || '').trim();
}

function isAddableStatus(status) {
  return ['fully_available', 'lead_time_only', 'split_availability'].includes(status);
}

// Speech-to-text engines often return an SKU as separate tokens, for example
// "W 1 2 1 2 G D S W". Collapse only a run of four or more single
// alphanumeric tokens so normal sentences such as "I want a cabinet" are left
// untouched. The inventory lookup then handles casing and separator differences.
export function collapseSpokenSkuCharacters(message) {
  const tokens = normalizeText(message).split(/\s+/);
  const normalizedTokens = [];

  for (let index = 0; index < tokens.length;) {
    const firstToken = tokens[index];
    if (!/^[A-Za-z]$/.test(firstToken)) {
      normalizedTokens.push(firstToken);
      index += 1;
      continue;
    }

    const skuTokens = [firstToken];
    let cursor = index + 1;
    let hasDigits = false;
    let hasMultiLetterSuffix = false;

    while (cursor < tokens.length) {
      const token = tokens[cursor].replace(/^[,./-]+|[,./-]+$/g, '');
      if (/^\d+$/.test(token) || /^[A-Za-z0-9]$/.test(token)) {
        // A standalone word such as "I" after an already-complete suffix is
        // ordinary speech, not another SKU character.
        if (hasMultiLetterSuffix && /^[A-Za-z]$/.test(token)) break;
        skuTokens.push(token);
        hasDigits ||= /^\d+$/.test(token);
        cursor += 1;
        continue;
      }

      if (/^[A-Za-z]{2}$/.test(token) && hasDigits && !hasMultiLetterSuffix) {
        skuTokens.push(token);
        hasMultiLetterSuffix = true;
        cursor += 1;
      }
      break;
    }

    const compactSku = skuTokens.join('');
    if (hasDigits && compactSku.length >= 5 && skuTokens.length >= 2) {
      normalizedTokens.push(compactSku);
      index = cursor;
      continue;
    }

    normalizedTokens.push(firstToken);
    index += 1;
  }

  return normalizedTokens.join(' ');
}

function normalizeCompactVoiceTokens(message) {
  return normalizeText(message)
    .replace(/\b(\d+)\s*(?:width|wide)\s*(?:by|x)\s*(\d+)\s*(?:height|high)\b/gi, 'width $1 height $2')
    .replace(/\bitem\s*(\d+)\s*(?:qty|quantity)\s*(\d+)\b/gi, 'item $1 qty $2');
}

export function normalizeIvrUserMessage(state) {
  const originalMessage = normalizeText(state?.agentPayload?.userMessage);
  const normalizedSpokenSkuMessage = normalizeCompactVoiceTokens(
    collapseSpokenSkuCharacters(originalMessage),
  );

  if (!/^\d+$/.test(normalizedSpokenSkuMessage)) {
    return normalizedSpokenSkuMessage;
  }

  const selection = Number(normalizedSpokenSkuMessage);
  const pendingDecision = state?.pendingDecision || null;
  const pendingItems = Array.isArray(pendingDecision?.items) ? pendingDecision.items : [];
  const orderSummaryStatus = normalizeText(state?.orderSummaryState?.status).toLowerCase();
  const pendingCartAction = normalizeText(state?.pendingCartActionConfirmation?.action).toLowerCase();

  if (!Number.isFinite(selection) || selection <= 0) {
    return normalizedSpokenSkuMessage;
  }

  if (pendingCartAction === 'clear_cart') {
    if (selection === 1) {
      return 'yes';
    }

    if (selection === 2) {
      return 'no';
    }
  }

  if (orderSummaryStatus === 'awaiting_confirmation') {
    if (selection === 1) {
      return 'confirm';
    }

    if (selection === 2) {
      return 'show cart';
    }

    if (selection === 5) {
      return 'new order';
    }
  }

  if (pendingDecision?.type === 'cart_review') {
    if (selection === 1) {
      return 'proceed with order';
    }

    if (selection === 2 || selection === 9) {
      return 'show cart';
    }

    if (selection === 5) {
      return 'new order';
    }
  }

  if (pendingItems.length === 1) {
    const [item] = pendingItems;

    if (item?.status === 'quantity_missing') {
      return `item 1 qty ${selection}`;
    }

    if (Array.isArray(item?.options) && selection <= item.options.length) {
      return `option ${selection}`;
    }

    if (isAddableStatus(item?.status)) {
      if (selection === 1) {
        return 'yes';
      }

      if (selection === 2) {
        return 'new order';
      }
    }
  }

  const suggestionItems = pendingItems.filter((item) => Array.isArray(item?.options) && item.options.length > 0);
  if (suggestionItems.length === 1 && selection <= suggestionItems[0].options.length) {
    return `item ${suggestionItems[0].itemNumber} option ${selection}`;
  }

  const quantityPendingItems = pendingItems.filter((item) => item?.status === 'quantity_missing');
  if (quantityPendingItems.length === 1) {
    return `item ${quantityPendingItems[0].itemNumber} qty ${selection}`;
  }

  const addableItems = pendingItems.filter((item) => isAddableStatus(item?.status));
  if (addableItems.length && selection <= addableItems.length) {
    return `add ${addableItems[selection - 1].itemNumber}`;
  }

  if (selection === 5) {
    return 'new order';
  }

  if (selection === 9) {
    return pendingDecision?.type === 'cart_review' ? 'show cart' : 'show more';
  }

  return normalizedSpokenSkuMessage;
}

export function createUnderstandRequestNode({ model }) {
  const baseNode = createChatUnderstandRequestNode({ model });

  return async function understandIvrRequestNode(state) {
    const normalizedMessage = normalizeIvrUserMessage(state);

    const nextState = normalizedMessage === state?.agentPayload?.userMessage ? state : {
      ...state,
      agentPayload: {
        ...(state.agentPayload || {}),
        userMessage: normalizedMessage,
        metadata: {
          ...(state.agentPayload?.metadata || {}),
          originalIvrUserMessage: state.agentPayload?.userMessage || '',
        },
      },
    };
    const result = await baseNode(nextState);

    // IVR deliberately remains menu-driven. Chat-only conversational intent must
    // not enter IVR's inventory/cart path.
    if (result.intent?.intent === 'conversation') {
      return {
        ...result,
        intent: {
          ...result.intent,
          intent: 'unrelated',
        },
      };
    }

    return result;
  };
}
