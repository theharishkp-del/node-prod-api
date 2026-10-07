import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSeparatorTolerantSkuRegex,
  createInventoryTools,
  normalizeSku,
} from '../tools/inventoryTools.js';
import { createResolveProductsNode } from '../graphs/chat/nodes/resolveProductsNode.js';
import {
  buildProductResponseFacts,
  composeProductResponse,
  createComposeResponseNode,
} from '../graphs/chat/nodes/composeResponseNode.js';
import {
  createComposeResponseNode as createIvrComposeResponseNode,
} from '../graphs/ivr/nodes/composeResponseNode.js';
import {
  createResolveProductsNode as createIvrResolveProductsNode,
  findApproximateIvrSkuMatches,
} from '../graphs/ivr/nodes/resolveProductsNode.js';
import {
  collapseSpokenSkuCharacters,
  normalizeIvrUserMessage,
} from '../graphs/ivr/nodes/understandRequestNode.js';
import { createCartActionNode } from '../graphs/chat/nodes/cartActionNode.js';
import { createExtractOrderInputNode } from '../graphs/chat/nodes/extractOrderInputNode.js';
import { createOrderSummaryNode } from '../graphs/chat/nodes/orderSummaryNode.js';
import {
  createUnderstandRequestNode,
  parseContinuationRequest,
} from '../graphs/chat/nodes/understandRequestNode.js';
import {
  deriveActivePrompt,
  deriveWorkflowStage,
} from '../graphs/chat/workflowState.js';
import {
  buildStandardEOIvrTextResponse,
  buildStandardEOTextResponse,
} from '../../controller/eo/handlers/standardEOShared.js';
import {
  isWidgetChatContinuationRequest,
  resolveIvrUserQuestion,
  resolveLocalDateTime,
} from '../../controller/eo/langgraph/ivrCustomerConversationLanggraph.js';
import { buildConversationAgentPayload } from '../../services/customerConversationService.js';

test('continuation parser selects different options for multiple pending items', () => {
  const intent = parseContinuationRequest(
    'item 1 option 1 qty 2, item 2 option 3 qty 1',
    {
      items: [
        {
          itemNumber: 1,
          requestedReference: 'wall cabinet',
          status: 'suggestions',
          options: [
            { sku: 'W-1A', productName: 'Wall Cabinet A' },
            { sku: 'W-1B', productName: 'Wall Cabinet B' },
          ],
        },
        {
          itemNumber: 2,
          requestedReference: 'base cabinet',
          status: 'suggestions',
          options: [
            { sku: 'B-2A', productName: 'Base Cabinet A' },
            { sku: 'B-2B', productName: 'Base Cabinet B' },
            { sku: 'B-2C', productName: 'Base Cabinet C' },
          ],
        },
      ],
    },
  );

  assert.equal(intent.intent, 'product_enquiry');
  assert.equal(intent.decisionAction, 'choose_option');
  assert.deepEqual(intent.referencedItems, [1, 2]);
  assert.deepEqual(intent.items.map((item) => ({ sku: item.skuCandidate, quantity: item.quantity })), [
    { sku: 'W-1A', quantity: 2 },
    { sku: 'B-2C', quantity: 1 },
  ]);
});

test('continuation parser keeps trailing quantities separate from option numbers', () => {
  const intent = parseContinuationRequest(
    'item 1 option 1 4 qty\nitem 2 option 1 3 qty\nitem 3 option 3 5 qty',
    {
      items: [
        {
          itemNumber: 1,
          requestedReference: '12 inch wall cabinet',
          status: 'suggestions',
          options: [
            { sku: 'W1212GD-SW', productName: 'Wall Cabinet 12 inch' },
            { sku: 'W1230-SW', productName: 'Wall Cabinet 12 by 30 inch' },
          ],
        },
        {
          itemNumber: 2,
          requestedReference: '14 inch wall cabinet',
          status: 'suggestions',
          options: [
            { sku: 'W1512GD-SW', productName: 'Wall Cabinet 15 inch' },
            { sku: 'W1530-SW', productName: 'Wall Cabinet 15 by 30 inch' },
          ],
        },
        {
          itemNumber: 3,
          requestedReference: '22 inch wall cabinet',
          status: 'suggestions',
          options: [
            { sku: 'W2112GD-SW', productName: 'Wall Cabinet 21 inch' },
            { sku: 'W2130-SW', productName: 'Wall Cabinet 21 by 30 inch' },
            { sku: 'W2136-SW', productName: 'Wall Cabinet 21 by 36 inch' },
          ],
        },
      ],
    },
  );

  assert.equal(intent.decisionAction, 'choose_option');
  assert.deepEqual(intent.referencedItems, [1, 2, 3]);
  assert.deepEqual(intent.items.map((item) => ({ sku: item.skuCandidate, quantity: item.quantity })), [
    { sku: 'W1212GD-SW', quantity: 4 },
    { sku: 'W1512GD-SW', quantity: 3 },
    { sku: 'W2136-SW', quantity: 5 },
  ]);
});

test('continuation parser preserves each cart-selection option quantity', () => {
  const intent = parseContinuationRequest(
    'item 1 option 1 qty 3\nitem 1 option 3 qty 3\nitem 2 option 1 qty 2\nitem 2 option 2 qty 4',
    {
      items: [
        {
          itemNumber: 1,
          status: 'suggestions',
          options: [
            { sku: 'W2412GD-SW' },
            { sku: 'DCW2412GD-SW' },
            { sku: 'W2418-SW' },
          ],
        },
        {
          itemNumber: 2,
          status: 'suggestions',
          options: [
            { sku: 'W3312GD-SW' },
            { sku: 'W3312-SW' },
          ],
        },
      ],
    },
  );

  assert.deepEqual(intent.items.map((item) => [item.skuCandidate, item.quantity]), [
    ['W2412GD-SW', 3],
    ['W2418-SW', 3],
    ['W3312GD-SW', 2],
    ['W3312-SW', 4],
  ]);
});

test('continuation parser accepts natural-language option and quantity references for multiple items', () => {
  const intent = parseContinuationRequest(
    'Please add the first choice for the first item, two pieces, and the third choice for the second item, one piece.',
    {
      items: [
        {
          itemNumber: 1,
          requestedReference: 'wall cabinet',
          status: 'suggestions',
          options: [
            { sku: 'W-1A', productName: 'Wall Cabinet A' },
            { sku: 'W-1B', productName: 'Wall Cabinet B' },
          ],
        },
        {
          itemNumber: 2,
          requestedReference: 'base cabinet',
          status: 'suggestions',
          options: [
            { sku: 'B-2A', productName: 'Base Cabinet A' },
            { sku: 'B-2B', productName: 'Base Cabinet B' },
            { sku: 'B-2C', productName: 'Base Cabinet C' },
          ],
        },
      ],
    },
  );

  assert.equal(intent.decisionAction, 'choose_option');
  assert.deepEqual(intent.referencedItems, [1, 2]);
  assert.deepEqual(intent.items.map((item) => ({ sku: item.skuCandidate, quantity: item.quantity })), [
    { sku: 'W-1A', quantity: 2 },
    { sku: 'B-2C', quantity: 1 },
  ]);
});

test('continuation parser selects multiple options for one pending item with quantity per option', () => {
  const intent = parseContinuationRequest(
    'item 1 options 1,2,3 qty 3 each',
    {
      items: [{
        itemNumber: 1,
        requestedReference: 'wall cabinet',
        status: 'suggestions',
        options: [
          { sku: 'W-1A', productName: 'Wall Cabinet A' },
          { sku: 'W-1B', productName: 'Wall Cabinet B' },
          { sku: 'W-1C', productName: 'Wall Cabinet C' },
        ],
      }],
    },
  );

  assert.equal(intent.decisionAction, 'choose_option');
  assert.deepEqual(intent.items.map((item) => ({ sku: item.skuCandidate, quantity: item.quantity })), [
    { sku: 'W-1A', quantity: 3 },
    { sku: 'W-1B', quantity: 3 },
    { sku: 'W-1C', quantity: 3 },
  ]);
});

test('continuation parser accepts quantity after each for multiple options', () => {
  const intent = parseContinuationRequest(
    'item 1 option 1,2,3 each 2 unit',
    {
      items: [{
        itemNumber: 1,
        requestedReference: '24 inch wall cabinet',
        status: 'suggestions',
        options: [
          { sku: 'W2412GD-SW', productName: 'Wall Cabinet 24 inch' },
          { sku: 'DCW2412GD-SW', productName: 'Diagonal Corner Wall Cabinet 24 inch' },
          { sku: 'W2418-SW', productName: 'Wall Cabinet 24 inch by 18 inch' },
        ],
      }],
    },
  );

  assert.equal(intent.decisionAction, 'choose_option');
  assert.deepEqual(intent.items.map((item) => ({ sku: item.skuCandidate, quantity: item.quantity })), [
    { sku: 'W2412GD-SW', quantity: 2 },
    { sku: 'DCW2412GD-SW', quantity: 2 },
    { sku: 'W2418-SW', quantity: 2 },
  ]);
});

test('continuation parser preserves repeated option selections for one pending item', () => {
  const intent = parseContinuationRequest(
    'item 1 option 2 qty 3\nitem 1 option 3 qty 3',
    {
      items: [{
        itemNumber: 1,
        requestedReference: '24 inch wall cabinet',
        status: 'suggestions',
        options: [
          { sku: 'W-1A', productName: 'Wall Cabinet A' },
          { sku: 'W-1B', productName: 'Wall Cabinet B' },
          { sku: 'W-1C', productName: 'Wall Cabinet C' },
        ],
      }],
    },
  );

  assert.equal(intent.intent, 'product_enquiry');
  assert.equal(intent.decisionAction, 'choose_option');
  assert.deepEqual(intent.items.map((item) => ({ sku: item.skuCandidate, quantity: item.quantity })), [
    { sku: 'W-1B', quantity: 3 },
    { sku: 'W-1C', quantity: 3 },
  ]);
});

test('continuation parser adds all pending SKU items with one quantity', () => {
  const intent = parseContinuationRequest(
    'add all each 1',
    {
      type: null,
      items: [
        { itemNumber: 1, sku: 'W2412GD-SW', status: 'quantity_missing' },
        { itemNumber: 2, sku: 'W2112GD-SW', status: 'quantity_missing' },
        { itemNumber: 3, sku: 'W1812GD-SW', status: 'quantity_missing' },
        { itemNumber: 4, sku: 'W1512GD-SW', status: 'quantity_missing' },
        { itemNumber: 5, sku: 'W1212GD-SW', status: 'quantity_missing' },
      ],
    },
  );

  assert.equal(intent.intent, 'cart_add');
  assert.equal(intent.decisionAction, 'add');
  assert.deepEqual(intent.items.map((item) => ({ sku: item.skuCandidate, quantity: item.quantity })), [
    { sku: 'W2412GD-SW', quantity: 1 },
    { sku: 'W2112GD-SW', quantity: 1 },
    { sku: 'W1812GD-SW', quantity: 1 },
    { sku: 'W1512GD-SW', quantity: 1 },
    { sku: 'W1212GD-SW', quantity: 1 },
  ]);
});

test('continuation parser adds all suggested options from a natural-language request', () => {
  const intent = parseContinuationRequest(
    'Please add all options for item 1 to my cart, quantity 3 each',
    {
      items: [{
        itemNumber: 1,
        requestedReference: 'wall cabinet',
        status: 'suggestions',
        options: [
          { sku: 'W-1A', productName: 'Wall Cabinet A' },
          { sku: 'W-1B', productName: 'Wall Cabinet B' },
          { sku: 'W-1C', productName: 'Wall Cabinet C' },
        ],
      }],
    },
  );

  assert.equal(intent.intent, 'cart_add');
  assert.equal(intent.decisionAction, 'add');
  assert.deepEqual(intent.items.map((item) => ({ sku: item.skuCandidate, quantity: item.quantity })), [
    { sku: 'W-1A', quantity: 3 },
    { sku: 'W-1B', quantity: 3 },
    { sku: 'W-1C', quantity: 3 },
  ]);
});

test('continuation parser accepts ordinal item references and word quantities for all options', () => {
  const intent = parseContinuationRequest(
    'I want every choice for the first item, two pieces each.',
    {
      items: [{
        itemNumber: 1,
        requestedReference: 'wall cabinet',
        status: 'suggestions',
        options: [
          { sku: 'W-1A', productName: 'Wall Cabinet A' },
          { sku: 'W-1B', productName: 'Wall Cabinet B' },
        ],
      }],
    },
  );

  assert.equal(intent.decisionAction, 'add');
  assert.deepEqual(intent.items.map((item) => ({ sku: item.skuCandidate, quantity: item.quantity })), [
    { sku: 'W-1A', quantity: 2 },
    { sku: 'W-1B', quantity: 2 },
  ]);
});

test('continuation parser accepts all-options language without an item number when one item has suggestions', () => {
  const intent = parseContinuationRequest(
    'I want every suggestion, 2 each',
    {
      items: [{
        itemNumber: 1,
        requestedReference: 'wall cabinet',
        status: 'suggestions',
        options: [
          { sku: 'W-1A', productName: 'Wall Cabinet A' },
          { sku: 'W-1B', productName: 'Wall Cabinet B' },
        ],
      }],
    },
  );

  assert.equal(intent.intent, 'cart_add');
  assert.deepEqual(intent.items.map((item) => ({ sku: item.skuCandidate, quantity: item.quantity })), [
    { sku: 'W-1A', quantity: 2 },
    { sku: 'W-1B', quantity: 2 },
  ]);
});

test('continuation parser asks for quantity before adding all suggested options', () => {
  const intent = parseContinuationRequest(
    'Add all options for item 1 to my cart',
    {
      items: [{
        itemNumber: 1,
        requestedReference: 'wall cabinet',
        status: 'suggestions',
        options: [{ sku: 'W-1A', productName: 'Wall Cabinet A' }],
      }],
    },
  );

  assert.equal(intent.needsClarification, true);
  assert.match(intent.clarificationQuestion, /quantity for each option/i);
});

test('continuation parser asks for an item number when all-options request is ambiguous', () => {
  const intent = parseContinuationRequest(
    'Add all options, quantity 2 each',
    {
      items: [
        {
          itemNumber: 1,
          requestedReference: 'wall cabinet',
          status: 'suggestions',
          options: [{ sku: 'W-1A', productName: 'Wall Cabinet A' }],
        },
        {
          itemNumber: 2,
          requestedReference: 'base cabinet',
          status: 'suggestions',
          options: [{ sku: 'B-2A', productName: 'Base Cabinet A' }],
        },
      ],
    },
  );

  assert.equal(intent.needsClarification, true);
  assert.match(intent.clarificationQuestion, /which item number/i);
});

test('all suggested options are added as separate cart lines with quantity applied to each', async () => {
  const intent = parseContinuationRequest(
    'Add all options for item 1, quantity 2 each',
    {
      items: [{
        itemNumber: 1,
        requestedReference: 'wall cabinet',
        status: 'suggestions',
        options: [
          { sku: 'W-1A', productName: 'Wall Cabinet A' },
          { sku: 'W-1B', productName: 'Wall Cabinet B' },
          { sku: 'W-1C', productName: 'Wall Cabinet C' },
        ],
      }],
    },
  );
  const cartActionNode = createCartActionNode();
  const result = await cartActionNode({
    agentPayload: {
      sessionInfo: { requestId: 'req-all-options-cart' },
      metadata: { localDateTime: '2026-08-24T12:00:00+05:30', localTimeZone: 'Asia/Kolkata' },
    },
    intent,
    cart: { items: [], currency: 'USD' },
    productResults: intent.items.map((item) => ({
      status: 'matched',
      requestedItem: item,
      matches: [{
        sku: item.skuCandidate,
        productName: item.description,
        sellingPrice: 100,
        currency: 'USD',
        qtyAvailable: 10,
        unit: 'EA',
        leadTimeDays: 0,
      }],
    })),
  });

  assert.equal(result.cartActionResult.type, 'cart_add');
  assert.deepEqual(result.cart.items.map((item) => ({ sku: item.sku, quantity: item.quantity })), [
    { sku: 'W-1A', quantity: 2 },
    { sku: 'W-1B', quantity: 2 },
    { sku: 'W-1C', quantity: 2 },
  ]);
});

test('ivr numeric quantity reply maps to item quantity follow-up', () => {
  const normalized = normalizeIvrUserMessage({
    agentPayload: {
      userMessage: '4',
    },
    pendingDecision: {
      items: [{
        itemNumber: 1,
        sku: 'W1212GD-SW',
        requestedReference: 'w1212gdsw',
        requestedQuantity: null,
        status: 'quantity_missing',
      }],
    },
  });

  assert.equal(normalized, 'item 1 qty 4');
});

test('chat accepts quantity wording and attached compact quantity after a SKU', async () => {
  const understandRequestNode = createUnderstandRequestNode({
    model: {
      withStructuredOutput: () => ({
        invoke: async () => ({
          intent: 'product_enquiry',
          requestMode: 'fresh_search',
          decisionAction: 'none',
          referencedItems: [],
          removeReferencedItems: [],
          clearCartConfirmed: false,
          items: [{
            rawReference: 'W1212GD-SW4 quantity',
            skuCandidate: 'W1212GD-SW',
            quantity: null,
            unit: null,
            description: null,
            dimensions: null,
            sketchHints: null,
          }],
          needsClarification: false,
          clarificationQuestion: null,
        }),
      }),
    },
  });

  const result = await understandRequestNode({
    agentPayload: {
      userMessage: 'W1212GD-SW4 quantity',
      sessionInfo: { requestId: 'req-compact-quantity' },
    },
    cart: { items: [] },
    recentTurns: [],
  });

  assert.equal(result.intent.items[0].quantity, 4);
});

test('chat extracts an x multiplier quantity written after a SKU', async () => {
  const understandRequestNode = createUnderstandRequestNode({
    model: {
      withStructuredOutput: () => ({
        invoke: async () => ({
          intent: 'product_enquiry',
          requestMode: 'fresh_search',
          decisionAction: 'none',
          referencedItems: [],
          removeReferencedItems: [],
          clearCartConfirmed: false,
          items: [{
            rawReference: 'W1212GD-SW',
            skuCandidate: 'W1212GD-SW',
            quantity: null,
            unit: null,
            description: null,
            dimensions: null,
            sketchHints: null,
          }],
          needsClarification: false,
          clarificationQuestion: null,
        }),
      }),
    },
  });

  const result = await understandRequestNode({
    agentPayload: {
      userMessage: 'W1212GD-SW x3',
      sessionInfo: { requestId: 'req-sku-multiplier-quantity' },
    },
    cart: { items: [] },
    recentTurns: [],
  });

  assert.equal(result.intent.intent, 'product_enquiry');
  assert.equal(result.intent.items[0].skuCandidate, 'W1212GD-SW');
  assert.equal(result.intent.items[0].quantity, 3);
});

test('chat rejects conflicting quantities for one product before model interpretation', async () => {
  const understandRequestNode = createUnderstandRequestNode({
    model: {
      withStructuredOutput: () => ({
        invoke: async () => {
          throw new Error('model should not be used for conflicting quantities');
        },
      }),
    },
  });

  const result = await understandRequestNode({
    agentPayload: {
      userMessage: '56qty and W331524 6qty',
      sessionInfo: { requestId: 'req-conflicting-quantity' },
    },
    cart: { items: [] },
    recentTurns: [],
  });

  assert.equal(result.intent.intent, 'unclear');
  assert.match(result.intent.clarificationQuestion, /conflicting quantities/i);
});

test('chat explains invalid add cart command when cart is empty', async () => {
  const understandRequestNode = createUnderstandRequestNode({
    model: {
      withStructuredOutput: () => ({
        invoke: async () => {
          throw new Error('model should not be used for invalid empty-cart command');
        },
      }),
    },
  });

  const result = await understandRequestNode({
    agentPayload: {
      userMessage: 'add cart',
      sessionInfo: { requestId: 'req-invalid-add-cart' },
    },
    cart: { items: [] },
    recentTurns: [],
  });

  assert.match(result.intent.clarificationQuestion, /cannot be used yet/i);
  assert.match(result.intent.clarificationQuestion, /W1212GD-SW qty 4/i);
});

test('chat parses a recognizable multi-line order without model extraction', async () => {
  const understandRequestNode = createUnderstandRequestNode({
    model: {
      withStructuredOutput: () => ({
        invoke: async () => {
          throw new Error('model should not be used for deterministic multi-line order');
        },
      }),
    },
  });

  const result = await understandRequestNode({
    agentPayload: {
      userMessage: [
        'W1212GD-SW qty 4',
        'Wall cabinet 30 W x 12 H Shaker White qty 2',
        'B2436-SW 3 pcs',
      ].join('\n'),
      sessionInfo: { requestId: 'req-multiline-order' },
    },
    cart: { items: [] },
    recentTurns: [],
  });

  assert.equal(result.intent.items.length, 3);
  assert.equal(result.intent.items[0].skuCandidate, 'W1212GD-SW');
  assert.equal(result.intent.items[0].quantity, 4);
  assert.deepEqual(result.intent.items[1].dimensions, { width: 30, height: 12, depth: null });
  assert.equal(result.intent.items[1].quantity, 2);
  assert.equal(result.intent.items[2].skuCandidate, 'B2436-SW');
  assert.equal(result.intent.items[2].quantity, 3);
});

test('cart-selection multi-line option payload uses pending options instead of fresh-order parsing', async () => {
  const understandRequestNode = createUnderstandRequestNode({
    model: {
      withStructuredOutput: () => ({
        invoke: async () => {
          throw new Error('LLM should not be used for a cart-selection payload');
        },
      }),
    },
  });

  const result = await understandRequestNode({
    agentPayload: {
      userMessage: 'item 1 option 1 qty 2\nitem 2 option 2 qty 2',
      sessionInfo: { requestId: 'req-cart-selection-multiline-options' },
    },
    cart: { items: [] },
    recentTurns: [],
    pendingDecision: {
      items: [
        {
          itemNumber: 1,
          requestedReference: '24 inch wall cabinet',
          status: 'suggestions',
          options: [
            { sku: 'W2412GD-SW', productName: 'Wall Cabinet 24 inch' },
            { sku: 'W2418-SW', productName: 'Wall Cabinet 24 by 18 inch' },
          ],
        },
        {
          itemNumber: 2,
          requestedReference: '32 inch wall cabinet',
          status: 'suggestions',
          options: [
            { sku: 'W3312GD-SW', productName: 'Wall Cabinet 33 inch glass' },
            { sku: 'W3312-SW', productName: 'Wall Cabinet 33 inch' },
          ],
        },
      ],
    },
  });

  assert.equal(result.intent.requestMode, 'continue_previous_selection');
  assert.equal(result.intent.decisionAction, 'choose_option');
  assert.deepEqual(result.intent.items.map((item) => ({ sku: item.skuCandidate, quantity: item.quantity })), [
    { sku: 'W2412GD-SW', quantity: 2 },
    { sku: 'W3312-SW', quantity: 2 },
  ]);
});

test('chat preserves width and height for a single dimensioned cabinet request', async () => {
  const understandRequestNode = createUnderstandRequestNode({
    model: {
      withStructuredOutput: () => ({
        invoke: async () => {
          throw new Error('model should not be used for deterministic dimensions');
        },
      }),
    },
  });

  const result = await understandRequestNode({
    agentPayload: {
      userMessage: 'Wall cabinet glass door 30 W x 12 H qty 2',
      sessionInfo: { requestId: 'req-dimension-order' },
    },
    cart: { items: [] },
    recentTurns: [],
  });

  assert.deepEqual(result.intent.items[0].dimensions, { width: 30, height: 12, depth: null });
  assert.equal(result.intent.items[0].quantity, 2);
});

test('chat asks to separate multiple SKU-like identifiers in one line', async () => {
  const understandRequestNode = createUnderstandRequestNode({
    model: {
      withStructuredOutput: () => ({
        invoke: async () => {
          throw new Error('model should not merge ambiguous SKU identifiers');
        },
      }),
    },
  });

  const result = await understandRequestNode({
    agentPayload: {
      userMessage: 'W1212GD-SW qty 2 and B2436-SW qty 1',
      sessionInfo: { requestId: 'req-ambiguous-skus' },
    },
    cart: { items: [] },
    recentTurns: [],
  });

  assert.equal(result.intent.intent, 'unclear');
  assert.match(result.intent.clarificationQuestion, /more than one SKU-like identifier/i);
});

test('ivr collapses letter-by-letter spoken SKU before intent extraction', () => {
  assert.equal(
    collapseSpokenSkuCharacters('I need W 1 2 1 2 G D S W quantity 2'),
    'I need W1212GDSW quantity 2',
  );
  assert.equal(
    normalizeIvrUserMessage({
      agentPayload: { userMessage: 'W 1 2 1 2 G D S W' },
    }),
    'W1212GDSW',
  );
  assert.equal(
    collapseSpokenSkuCharacters('I want a wall cabinet'),
    'I want a wall cabinet',
  );
  assert.equal(
    collapseSpokenSkuCharacters('W 1212 GD I want 2 quantity'),
    'W1212GD I want 2 quantity',
  );
  assert.equal(
    normalizeIvrUserMessage({
      agentPayload: { userMessage: 'item1qty4 item2qty6 12 width by 24 height' },
    }),
    'item 1 qty 4 item 2 qty 6 width 12 height 24',
  );
});

test('ivr order summary confirm press one maps to confirm', () => {
  const normalized = normalizeIvrUserMessage({
    agentPayload: {
      userMessage: '1',
    },
    orderSummaryState: {
      status: 'awaiting_confirmation',
    },
  });

  assert.equal(normalized, 'confirm');
});

test('ivr compose response asks for quantity on matched sku lookup', async () => {
  const composeResponseNode = createIvrComposeResponseNode();

  const response = await composeResponseNode({
    agentPayload: {
      sessionInfo: { requestId: 'req-ivr-1' },
      metadata: {
        localDateTime: '2026-08-04T11:00:00+05:30',
        localTimeZone: 'Asia/Kolkata',
      },
    },
    intent: { intent: 'product_enquiry' },
    productResults: [{
      status: 'matched',
      requestedItem: { rawReference: 'w1212gdsw', quantity: null },
      matches: [{
        sku: 'W1212GD-SW',
        productName: 'Wall Cabinet 12"W x 12"H Glass Door Shaker White',
        sellingPrice: 103,
        currency: 'USD',
        qtyAvailable: 0,
        leadTimeDays: 4,
      }],
    }],
    recentTurns: [],
  });

  assert.match(response.reply, /Price is \$103\.00 each/i);
  assert.match(response.reply, /Please say or enter the quantity/i);
});

test('ivr compose response applies the customer tier multiplier to the spoken price', async () => {
  const tierId = '507f1f77bcf86cd799439011';
  const tenantDb = {
    collection: (name) => ({
      findOne: async () => {
        if (name === 'md_customers') return { tierId };
        if (name === 'md_tiers') return { multiplier: 0.45 };
        return null;
      },
    }),
  };
  const composeResponseNode = createIvrComposeResponseNode({ tenantDb });

  const response = await composeResponseNode({
    agentPayload: {
      databaseInfo: { tenantId: 'tenant-1' },
      customerInfo: { emailId: 'customer@example.test' },
      sessionInfo: { requestId: 'req-ivr-tier-price' },
      metadata: { localDateTime: '2026-08-04T11:00:00+05:30', localTimeZone: 'Asia/Kolkata' },
    },
    intent: { intent: 'product_enquiry' },
    productResults: [{
      status: 'matched',
      requestedItem: { rawReference: 'w1212gdsw', quantity: null },
      matches: [{
        sku: 'W1212GD-SW',
        productName: 'Wall Cabinet',
        sellingPrice: 103,
        currency: 'USD',
        qtyAvailable: 1,
      }],
    }],
    recentTurns: [],
  });

  assert.match(response.reply, /Price is \$46\.35 each/i);
});

test('IVR widget-chat request hands off to the chat graph and IVR text cleanup collapses whitespace', () => {
  assert.equal(isWidgetChatContinuationRequest({
    body: {
      reqMessageObj: {
        requestType: 'taskConversation',
        fromEmail: '+91_7299027793_CyBot_WORLD',
        deviceId: 'widget-device-id',
      },
    },
  }), true);

  assert.equal(isWidgetChatContinuationRequest({
    body: {
      reqMessageObj: {
        requestType: 'taskConversation',
        fromEmail: '+91_7299027793_CyBot_WORLD',
        callSId: 'voice-call-id',
      },
    },
  }), false);

  assert.equal(resolveIvrUserQuestion({
    body: {
      context: { apiAnswer: '  W. 1512, GDs. W quantity 7  ' },
      reqMessageObj: {},
    },
  }), 'W1512GDSW quantity 7');
});

test('ivr order summary response mentions SMS and keypad confirmation', async () => {
  const composeResponseNode = createIvrComposeResponseNode();

  const response = await composeResponseNode({
    agentPayload: {
      sessionInfo: { requestId: 'req-ivr-2' },
      metadata: {},
    },
    intent: {
      intent: 'order_summary',
      decisionAction: 'prepare_order_summary',
    },
    orderSummaryState: {
      status: 'awaiting_confirmation',
      summary: {
        formattedTotal: '$412.00',
        lines: [{
          itemNumber: 1,
          sku: 'W1212GD-SW',
          quantity: 4,
        }],
      },
    },
    recentTurns: [],
  });

  assert.match(response.reply, /sent the order summary and quote by SMS/i);
  assert.match(response.reply, /Press 1 to confirm the order/i);
  assert.match(response.reply, /Press 2 to review your cart/i);
  assert.match(response.reply, /Press 6 to receive a link by SMS to enter multiple products/i);
});

test('ivr final confirmation speaks the order reference number', async () => {
  const composeResponseNode = createIvrComposeResponseNode();

  const response = await composeResponseNode({
    agentPayload: {
      sessionInfo: { requestId: 'req-ivr-3' },
      metadata: {},
    },
    intent: {
      intent: 'order_submit',
      decisionAction: 'submit_order',
    },
    orderSummaryState: {
      status: 'confirmed',
      artifacts: {
        coreOrder: {
          referenceNumber: 'ORD-20260804-000123',
        },
      },
    },
    recentTurns: [],
  });

  assert.match(response.reply, /order is confirmed/i);
  assert.match(response.reply, /order reference number is ORD-20260804-000123/i);
  assert.match(response.reply, /invoice and payment link by SMS/i);
});

test('ivr fresh matched product replaces stale cart-review pending decision', async () => {
  const composeResponseNode = createIvrComposeResponseNode();

  const response = await composeResponseNode({
    agentPayload: {
      sessionInfo: { requestId: 'req-ivr-stale-1' },
      metadata: {
        localDateTime: '2026-08-04T18:27:50',
        localTimeZone: 'Asia/Kolkata',
      },
    },
    intent: { intent: 'product_enquiry' },
    productResults: [{
      status: 'matched',
      requestedItem: { rawReference: 'W3036SW', quantity: 2 },
      matches: [{
        sku: 'W3036-SW',
        productName: 'Wall Cabinet 30"W x 36"H Shaker White',
        sellingPrice: 404,
        currency: 'USD',
        qtyAvailable: 6,
        unit: 'EA',
        leadTimeDays: 0,
      }],
    }],
    pendingDecision: {
      type: 'cart_review',
      items: [{
        itemNumber: 1,
        sku: 'W0930-SW',
        requestedQuantity: 4,
        status: 'ready_now',
      }],
    },
    recentTurns: [],
  });

  assert.match(response.reply, /Press 1 to add this item to your cart/i);
  assert.equal(response.pendingDecision?.source, 'ivr_product_flow');
  assert.equal(response.pendingDecision?.items?.[0]?.sku, 'W3036-SW');
  assert.equal(response.pendingDecision?.items?.[0]?.status, 'fully_available');
});

test('ivr request selection uses decoded fileName only', () => {
  const resolved = resolveIvrUserQuestion({
    body: {
      context: {
        apiAnswer: 'different text',
        englishTranslation: 'wrong translated text',
      },
      reqMessageObj: {
        intentObj: {
          value: 'another different text',
        },
        mimeType: 'text',
        fileName: 'VzEyMTJHRFNXIEkgd2FudCAyIHF1YW50aXR5',
      },
    },
  });

  assert.equal(resolved, 'W1212GDSW I want 2 quantity');
});

test('ivr request selection prefers cleaner apiAnswer over noisy decoded speech', () => {
  const resolved = resolveIvrUserQuestion({
    body: {
      context: {
        apiAnswer: 'W1212GD-SW 3 quantity',
        englishTranslation: 'I want W 1212 gdw for quantity.',
      },
      reqMessageObj: {
        intentObj: {
          value: 'W1212GD-SW 3 quantity',
        },
        mimeType: 'text',
        fileName: 'VzEgdG8gMTIxMiBHRC4gUyB3LCAzIHF1YW50aXR5Lg==',
      },
    },
  });

  assert.equal(resolved, 'W1212GD-SW 3 quantity');
});

test('ivr localDateTime prefers request message timestamp over session id', () => {
  const resolved = resolveLocalDateTime({
    body: {
      sessionDate: '20260804112355610',
      reqMessageObj: {
        localDateTime: '2026-08-04 16:59:43',
      },
    },
  });

  assert.equal(resolved, '2026-08-04T16:59:43');
});

test('ivr approximate sku recovery returns close matches for noisy sku text', async () => {
  const tenantDb = {
    collection: () => ({
      find: () => ({
        limit: () => ({
          toArray: async () => ([{
            _id: { toString: () => 'inv-1' },
            sku: 'W1212GD-SW',
            normalizedSku: 'W1212GDSW',
            productName: 'Wall Cabinet 12"W x 12"H Glass Door Shaker White',
            sellingPrice: 103,
            currency: 'USD',
            qtyAvailable: 0,
            unit: 'EA',
            leadTimeDays: 4,
          }]),
        }),
      }),
    }),
  };

  const matches = await findApproximateIvrSkuMatches({
    tenantDb,
    tenantId: 'tenant-1',
    botUserId: '16020',
    skuCandidate: 'W1212GDW',
  });

  assert.equal(matches.length, 1);
  assert.equal(matches[0].sku, 'W1212GD-SW');
});

test('ivr resolve products converts noisy unmatched sku into suggestions', async () => {
  const resolveProductsNode = createIvrResolveProductsNode({
    inventoryTools: {
      findProductsBySkuTool: {
        invoke: async () => ([{
          query: 'W1212GDW',
          normalizedSku: 'W1212GDW',
          status: 'unmatched',
          matches: [],
        }]),
      },
      searchProductsTool: {
        invoke: async () => ([]),
      },
    },
    tenantDb: {
      collection: () => ({
        find: () => ({
          limit: () => ({
            toArray: async () => ([{
              _id: { toString: () => 'inv-1' },
              sku: 'W1212GD-SW',
              normalizedSku: 'W1212GDSW',
              productName: 'Wall Cabinet 12"W x 12"H Glass Door Shaker White',
              sellingPrice: 103,
              currency: 'USD',
              qtyAvailable: 0,
              unit: 'EA',
              leadTimeDays: 4,
            }]),
          }),
        }),
      }),
    },
    tenantId: 'tenant-1',
    botUserId: '16020',
  });

  const result = await resolveProductsNode({
    agentPayload: {
      sessionInfo: { requestId: 'req-ivr-fuzzy-1' },
    },
    intent: {
      intent: 'product_enquiry',
      items: [{
        rawReference: 'W1212GDW',
        skuCandidate: 'W1212GDW',
        quantity: 1,
      }],
    },
  });

  assert.equal(result.productResults.length, 1);
  assert.equal(result.productResults[0].status, 'suggestions');
  assert.equal(result.productResults[0].matches[0].sku, 'W1212GD-SW');
});

test('normalizeSku ignores case, whitespace, and separators', () => {
  assert.equal(normalizeSku('w1212gd-sw'), 'W1212GDSW');
  assert.equal(normalizeSku('W 1212 GD / SW'), 'W1212GDSW');
  assert.equal(normalizeSku('w1212gd_sw'), 'W1212GDSW');
});

test('separator-tolerant SKU regex matches existing formatted SKU', () => {
  const regex = buildSeparatorTolerantSkuRegex('w1212gdsw');
  assert.equal(regex.test('W1212GD-SW'), true);
  assert.equal(regex.test('W 1212 GD / SW'), true);
  assert.equal(regex.test('W1512GD-SW'), false);
});

test('descriptive inventory search falls back to exact dimensions when OCR text is weak', async () => {
  const calls = [];
  const fakeCollection = {
    find(filter) {
      calls.push(filter);
      const documents = calls.length === 1
        ? []
        : [{
          _id: { toString: () => 'inv-1' },
          sku: 'W1212GD-SW',
          productName: 'Wall Cabinet 12"W x 12"H Glass Door Shaker White',
          category: 'Wall Cabinet Glass Door',
          description: 'Glass door wall cabinet, Shaker White finish, 12"W x 12"H',
          style: 'Shaker',
          finish: 'White',
          width: 12,
          height: 12,
          depth: null,
          sellingPrice: 103,
          currency: 'USD',
          qtyAvailable: 0,
          unit: 'EA',
          leadTimeDays: 4,
        }];

      return {
        limit() {
          return {
            async toArray() {
              return documents;
            },
          };
        },
      };
    },
  };

  const inventoryTools = createInventoryTools({
    tenantDb: {
      collection: () => fakeCollection,
    },
    tenantId: 'tn_e89ffee32b55',
    botUserId: '16020',
  });

  const [result] = await inventoryTools.searchProductsTool.invoke({
    searches: [{
      searchId: '1',
      rawReference: '12" W x 12" H',
      description: '12" W x 12" H',
      dimensions: {
        width: 12,
        height: 12,
        depth: null,
      },
      maxResults: 3,
    }],
  });

  assert.equal(result.status, 'matched');
  assert.equal(result.matchType, 'exact_dimensions_only');
  assert.equal(result.matches[0].sku, 'W1212GD-SW');
  assert.equal(calls.length, 2);
  assert.equal(Array.isArray(calls[0].$and), true);
  assert.equal(calls[1].$and, undefined);
  assert.equal(calls[1].width, 12);
  assert.equal(calls[1].height, 12);
});

test('descriptive inventory search returns top dimension-based suggestions when no exact size exists', async () => {
  const calls = [];
  const fakeCollection = {
    find(filter) {
      calls.push(filter);
      const documents = filter.$or
        ? []
        : [];

      const fallbackDocuments = filter.$or
        ? [
          {
            _id: { toString: () => 'inv-30a' },
            sku: 'W3015GD-SW',
            productName: 'Wall Cabinet 30"W x 15"H Glass Door Shaker White',
            category: 'Wall Cabinet Glass Door',
            description: 'Glass door wall cabinet, Shaker White finish, 30"W x 15"H',
            style: 'Shaker',
            finish: 'White',
            width: 30,
            height: 15,
            depth: null,
            sellingPrice: 180,
            currency: 'USD',
            qtyAvailable: 2,
            unit: 'EA',
            leadTimeDays: 4,
          },
          {
            _id: { toString: () => 'inv-30b' },
            sku: 'W3018GD-SW',
            productName: 'Wall Cabinet 30"W x 18"H Glass Door Shaker White',
            category: 'Wall Cabinet Glass Door',
            description: 'Glass door wall cabinet, Shaker White finish, 30"W x 18"H',
            style: 'Shaker',
            finish: 'White',
            width: 30,
            height: 18,
            depth: null,
            sellingPrice: 210,
            currency: 'USD',
            qtyAvailable: 1,
            unit: 'EA',
            leadTimeDays: 4,
          },
          {
            _id: { toString: () => 'inv-30c' },
            sku: 'W3012-SW',
            productName: 'Wall Cabinet 30"W x 12"H Shaker White',
            category: 'Wall Cabinet',
            description: 'Wall cabinet, Shaker White finish, 30"W x 12"H',
            style: 'Shaker',
            finish: 'White',
            width: 30,
            height: 12,
            depth: null,
            sellingPrice: 150,
            currency: 'USD',
            qtyAvailable: 3,
            unit: 'EA',
            leadTimeDays: 4,
          },
        ]
        : documents;

      return {
        limit() {
          return {
            async toArray() {
              return fallbackDocuments;
            },
          };
        },
      };
    },
  };

  const inventoryTools = createInventoryTools({
    tenantDb: {
      collection: () => fakeCollection,
    },
    tenantId: 'tn_e89ffee32b55',
    botUserId: '16020',
  });

  const [result] = await inventoryTools.searchProductsTool.invoke({
    searches: [{
      searchId: '2',
      rawReference: '30" W x 12" H glass door',
      description: '30" W x 12" H glass door',
      dimensions: {
        width: 30,
        height: 12,
        depth: null,
      },
      maxResults: 3,
    }],
  });

  assert.equal(result.status, 'suggestions');
  assert.equal(result.matchType, 'nearby_dimensions');
  assert.equal(result.matches.length, 3);
  assert.equal(result.matches[0].sku, 'W3015GD-SW');
  assert.equal(result.matches[1].sku, 'W3018GD-SW');
  assert.equal(result.matches[2].sku, 'W3012-SW');
  assert.equal(calls.length, 3);
  assert.equal(calls[2].$or.length, 2);
});

test('descriptive inventory search uses sketch hints to rank double glass-door options higher', async () => {
  const fakeCollection = {
    find() {
      const documents = [
        {
          _id: { toString: () => 'inv-double-glass' },
          sku: 'W3012GD2-SW',
          productName: 'Wall Cabinet 30"W x 12"H Double Glass Door Shaker White',
          category: 'Wall Cabinet Glass Door',
          description: 'Double glass door wall cabinet, Shaker White finish, 30"W x 12"H',
          style: 'Shaker',
          finish: 'White',
          doorType: 'Glass',
          glassDoor: true,
          width: 30,
          height: 12,
          depth: null,
          sellingPrice: 240,
          currency: 'USD',
          qtyAvailable: 2,
          unit: 'EA',
          leadTimeDays: 4,
        },
        {
          _id: { toString: () => 'inv-single-glass' },
          sku: 'W3012GD-SW',
          productName: 'Wall Cabinet 30"W x 12"H Glass Door Shaker White',
          category: 'Wall Cabinet Glass Door',
          description: 'Glass door wall cabinet, Shaker White finish, 30"W x 12"H',
          style: 'Shaker',
          finish: 'White',
          doorType: 'Glass',
          glassDoor: true,
          width: 30,
          height: 12,
          depth: null,
          sellingPrice: 210,
          currency: 'USD',
          qtyAvailable: 2,
          unit: 'EA',
          leadTimeDays: 4,
        },
        {
          _id: { toString: () => 'inv-double-solid' },
          sku: 'W3012-SW',
          productName: 'Wall Cabinet 30"W x 12"H Double Door Shaker White',
          category: 'Wall Cabinet',
          description: 'Double door wall cabinet, Shaker White finish, 30"W x 12"H',
          style: 'Shaker',
          finish: 'White',
          doorType: 'Solid',
          glassDoor: false,
          width: 30,
          height: 12,
          depth: null,
          sellingPrice: 180,
          currency: 'USD',
          qtyAvailable: 2,
          unit: 'EA',
          leadTimeDays: 4,
        },
      ];

      return {
        limit() {
          return {
            async toArray() {
              return documents;
            },
          };
        },
      };
    },
  };

  const inventoryTools = createInventoryTools({
    tenantDb: {
      collection: () => fakeCollection,
    },
    tenantId: 'tn_e89ffee32b55',
    botUserId: '16020',
  });

  const [result] = await inventoryTools.searchProductsTool.invoke({
    searches: [{
      searchId: '3',
      rawReference: '30x12 double glass door wall cabinet',
      description: '30x12 double glass door wall cabinet',
      dimensions: {
        width: 30,
        height: 12,
        depth: null,
      },
      sketchHints: {
        cabinetType: 'wall cabinet',
        doorStyle: 'glass door',
        doorCount: 2,
        sectionCount: 2,
        sectionWidth: 15,
        notes: [],
      },
      maxResults: 3,
    }],
  });

  assert.equal(result.status, 'suggestions');
  assert.equal(result.matches[0].sku, 'W3012GD2-SW');
  assert.equal(result.matches[1].sku, 'W3012GD-SW');
  assert.equal(result.matches[2].sku, 'W3012-SW');
});

test('product response includes quantity, total, stock, and cart confirmation', () => {
  const reply = composeProductResponse({
    intent: { intent: 'product_enquiry' },
    agentPayload: {
      metadata: {
        localDateTime: '2026-08-03T12:00:00+05:30',
        localTimeZone: 'Asia/Kolkata',
      },
    },
    productResults: [{
      status: 'matched',
      requestedItem: { rawReference: 'w1212gdsw', quantity: 2 },
      matches: [{
        sku: 'W1212GD-SW',
        productName: 'Wall Cabinet',
        sellingPrice: 103,
        currency: 'USD',
        qtyAvailable: 0,
        leadTimeDays: 4,
      }],
    }],
  });

  assert.match(reply, /\*\*W1212GD-SW\*\*/);
  assert.match(reply, /\*\*Qty:\*\* 2/);
  assert.match(reply, /\$206/);
  assert.match(reply, /Aug 7, 2026/);
  assert.match(reply, /Full qty est\. Aug 7, 2026/);
  assert.doesNotMatch(reply, /out of stock/i);
});

test('higher requested quantity offers full order or current stock', () => {
  const input = {
    intent: { intent: 'product_enquiry' },
    agentPayload: {
      metadata: {
        localDateTime: '2026-08-03T12:00:00+05:30',
        localTimeZone: 'Asia/Kolkata',
      },
    },
    productResults: [{
      status: 'matched',
      requestedItem: { rawReference: 'w1212gdsw', quantity: 5 },
      matches: [{
        sku: 'W1212GD-SW',
        productName: 'Wall Cabinet',
        sellingPrice: 103,
        currency: 'USD',
        qtyAvailable: 2,
        unit: 'EA',
        leadTimeDays: 4,
      }],
    }],
  };
  const facts = buildProductResponseFacts(input);
  const reply = composeProductResponse(input);

  assert.equal(facts.items[0].availabilityCase, 'split_availability');
  assert.equal(facts.items[0].product.immediatelyAvailableForRequest, 2);
  assert.equal(facts.items[0].product.remainingQuantity, 3);
  assert.match(reply, /2 available now/);
  assert.match(reply, /remaining 3/);
  assert.match(reply, /remaining 3 est\. Aug 7, 2026/i);
  assert.doesNotMatch(reply, /out of stock/i);
});

test('customer-order EO response can keep the UI session active', () => {
  const req = {
    body: {
      botUserId: '16020',
      reqMessageObj: {
        taskId: 'task-1',
        signalId: 'signal-1',
        fromId: 'customer-1',
        toId: '16020',
        mimeType: 'text',
      },
    },
  };
  const response = buildStandardEOTextResponse(req, {
    resultText: 'success',
    fileName: 'How many would you like?',
    eoState: 'continue',
  });

  assert.equal(response.eoState, 'continue');
});

test('ivr EO response excludes quote, invoice, payment, and work-order fields', () => {
  const req = {
    body: {
      botUserId: '16020',
      reqMessageObj: {
        taskId: 'task-ivr-1',
        signalId: 'signal-ivr-1',
        fromId: 'customer-ivr-1',
        toId: '16020',
        mimeType: 'text',
      },
    },
  };

  const response = buildStandardEOIvrTextResponse(req, {
    resultText: 'success',
    fileName: 'Your order is confirmed. I have sent the invoice and payment link by SMS.',
    eoState: 'stop',
  });

  assert.equal(response.eoState, 'stop');
  assert.equal('orderReferenceNumber' in response, false);
  assert.equal('workOrderId' in response, false);
  assert.equal('quoteLink' in response, false);
  assert.equal('invoiceUrl' in response, false);
  assert.equal('paymentLinkId' in response, false);
  assert.equal('paymentLink' in response, false);
});

test('cart action node stores full-order items and supports cart view', async () => {
  const cartActionNode = createCartActionNode();
  const added = await cartActionNode({
    agentPayload: {
      sessionInfo: { requestId: 'req-1' },
      metadata: {
        localDateTime: '2026-08-03T12:00:00+05:30',
        localTimeZone: 'Asia/Kolkata',
      },
    },
    intent: { intent: 'cart_add' },
    productResults: [{
      status: 'matched',
      requestedItem: { rawReference: 'W1212GD-SW', quantity: 5 },
      matches: [{
        sku: 'W1212GD-SW',
        productName: 'Wall Cabinet',
        sellingPrice: 103,
        currency: 'USD',
        qtyAvailable: 2,
        unit: 'EA',
        leadTimeDays: 4,
      }],
    }],
  });

  assert.equal(added.cart.items.length, 1);
  assert.equal(added.cart.items[0].quantity, 5);
  assert.equal(added.cart.items[0].fulfillmentStatus, 'full_order_scheduled');
  assert.equal(added.cartActionResult.message, 'I added 1 item to your cart.');

  const viewed = await cartActionNode({
    agentPayload: {
      sessionInfo: { requestId: 'req-2' },
      metadata: {
        localDateTime: '2026-08-03T12:00:00+05:30',
        localTimeZone: 'Asia/Kolkata',
      },
    },
    intent: { intent: 'cart_view' },
    cart: added.cart,
  });

  assert.equal(viewed.cartActionResult.type, 'cart_view');
  assert.equal(viewed.cartActionResult.pendingDecision.items[0].sku, 'W1212GD-SW');
  assert.equal(viewed.cartActionResult.pendingDecision.items[0].requestedQuantity, 5);
});

test('cart action messages use polished singular wording', async () => {
  const cartActionNode = createCartActionNode();

  const added = await cartActionNode({
    agentPayload: {
      sessionInfo: { requestId: 'req-cart-wording-1' },
      metadata: {
        localDateTime: '2026-08-03T12:00:00+05:30',
        localTimeZone: 'Asia/Kolkata',
      },
    },
    intent: { intent: 'cart_add' },
    productResults: [{
      status: 'matched',
      requestedItem: { rawReference: 'WBC2736-SW', quantity: 2 },
      matches: [{
        sku: 'WBC2736-SW',
        productName: 'Blind Corner Wall Cabinet',
        sellingPrice: 387,
        currency: 'USD',
        qtyAvailable: 2,
        unit: 'EA',
        leadTimeDays: 0,
      }],
    }],
  });

  assert.equal(added.cartActionResult.message, 'I added 1 item to your cart.');

  const removed = await cartActionNode({
    agentPayload: {
      sessionInfo: { requestId: 'req-cart-wording-2' },
      metadata: {
        localDateTime: '2026-08-03T12:00:00+05:30',
        localTimeZone: 'Asia/Kolkata',
      },
    },
    intent: { intent: 'cart_remove', referencedItems: [1] },
    pendingDecision: {
      items: [{ itemNumber: 1, sku: 'WBC2736-SW' }],
    },
    cart: added.cart,
  });

  assert.equal(removed.cartActionResult.message, 'I removed that item from your cart.');
});

test('cart add increments existing sku quantity instead of replacing it', async () => {
  const cartActionNode = createCartActionNode();

  const updated = await cartActionNode({
    agentPayload: {
      sessionInfo: { requestId: 'req-cart-merge-1' },
      metadata: {
        localDateTime: '2026-08-03T12:00:00+05:30',
        localTimeZone: 'Asia/Kolkata',
      },
    },
    intent: { intent: 'cart_add' },
    cart: {
      items: [{
        sku: 'OE630-SW',
        productName: 'Wall Open End Shelf 6"W x 30"H Shaker White',
        quantity: 2,
        unit: 'EA',
        unitPrice: 131,
        currency: 'USD',
        formattedUnitPrice: '$131.00',
        lineTotal: 262,
        formattedLineTotal: '$262.00',
        qtyAvailable: 2,
        estimatedDate: null,
        fulfillmentStatus: 'ready_now',
      }],
      currency: 'USD',
    },
    productResults: [{
      status: 'matched',
      requestedItem: { rawReference: 'OE630-SW', quantity: 2 },
      matches: [{
        sku: 'OE630-SW',
        productName: 'Wall Open End Shelf 6"W x 30"H Shaker White',
        sellingPrice: 131,
        currency: 'USD',
        qtyAvailable: 8,
        unit: 'EA',
        leadTimeDays: 0,
      }],
    }],
  });

  assert.equal(updated.cart.items.length, 1);
  assert.equal(updated.cart.items[0].sku, 'OE630-SW');
  assert.equal(updated.cart.items[0].quantity, 4);
  assert.equal(updated.cart.items[0].lineTotal, 524);
  assert.equal(updated.cartActionResult.changedItems[0].quantity, 4);
  assert.equal(updated.cartActionResult.cartSummary.formattedTotal, '$524.00');
});

test('image order extraction converts uploaded file into structured multi-item request', async () => {
  const extractOrderInputNode = createExtractOrderInputNode({
    model: {
      withStructuredOutput: () => ({
        invoke: async () => ({
          summary: 'Extracted 2 items from the uploaded image.',
          items: [
            {
              rawText: 'W0942-SW qty 5',
              skuCandidate: 'W0942-SW',
              quantity: 5,
              description: 'Wall Cabinet 9"W x 42"H Shaker White',
            },
            {
              rawText: 'W1212GD-SW qty 3',
              skuCandidate: 'W1212GD-SW',
              quantity: 3,
              description: 'Wall Cabinet 12"W x 12"H Glass Door Shaker White',
              sketchHints: {
                cabinetType: 'wall cabinet',
                doorStyle: 'glass door',
                doorCount: 1,
                sectionCount: 1,
                sectionWidth: 12,
                notes: ['hand sketch'],
              },
            },
          ],
          notes: [],
        }),
      }),
    },
    fetchAttachmentBufferFn: async () => Buffer.from('fake-image-bytes'),
  });

  const extracted = await extractOrderInputNode({
    agentPayload: {
      inputType: 'image',
      userMessage: 'Customer uploaded an image order. Read the text visible in the image and use that as the order details.',
      sessionInfo: { requestId: 'req-file-1' },
      attachments: [{
        type: 'image',
        mimeType: 'image',
        fileUrl: 'https://example.com/order.jpeg',
        originalFileName: 'order.jpeg',
      }],
      metadata: {},
    },
  });

  assert.equal(extracted.fileExtraction.status, 'success');
  assert.equal(extracted.fileExtraction.extractedItems.length, 2);
  assert.match(extracted.agentPayload.userMessage, /W0942-SW qty 5/);
  assert.match(extracted.agentPayload.userMessage, /W1212GD-SW qty 3/);

  const understandRequestNode = createUnderstandRequestNode({
    model: {
      withStructuredOutput: () => ({
        invoke: async () => {
          throw new Error('understandRequestNode should use extracted items directly');
        },
      }),
    },
  });

  const understood = await understandRequestNode({
    agentPayload: extracted.agentPayload,
    fileExtraction: extracted.fileExtraction,
    recentTurns: [],
    pendingDecision: null,
  });

  assert.equal(understood.intent.intent, 'product_enquiry');
  assert.equal(understood.intent.items.length, 2);
  assert.equal(understood.intent.items[0].skuCandidate, 'W0942-SW');
  assert.equal(understood.intent.items[1].quantity, 3);
  assert.equal(understood.intent.items[1].sketchHints?.doorStyle, 'glass door');
  assert.equal(understood.intent.items[1].sketchHints?.doorCount, 1);
  assert.match(understood.intent.items[1].description, /glass door/i);
  assert.match(understood.intent.items[1].description, /1 door/i);
  assert.match(understood.intent.items[1].description, /12 inch section/i);
});

test('uploaded multi-item sketch clearly requests only the first missing quantity', async () => {
  const extractOrderInputNode = createExtractOrderInputNode({
    model: {
      withStructuredOutput: () => ({
        invoke: async () => ({
          summary: 'Extracted 3 items from the uploaded sketch.',
          items: [
            {
              rawText: 'W1212GD-SW',
              skuCandidate: 'W1212GD-SW',
              quantity: null,
              description: 'Wall Cabinet 12"W x 12"H Glass Door Shaker White',
            },
            {
              rawText: 'W1812GD-SW qty 2',
              skuCandidate: 'W1812GD-SW',
              quantity: 2,
              description: 'Wall Cabinet 18"W x 12"H Glass Door Shaker White',
            },
            {
              rawText: 'W2712GD-SW qty 3',
              skuCandidate: 'W2712GD-SW',
              quantity: 3,
              description: 'Wall Cabinet 27"W x 12"H Glass Door Shaker White',
            },
          ],
          notes: [],
        }),
      }),
    },
    fetchAttachmentBufferFn: async () => Buffer.from('fake-sketch-image'),
  });
  const extracted = await extractOrderInputNode({
    agentPayload: {
      inputType: 'image',
      userMessage: 'Customer uploaded a cabinet sketch.',
      sessionInfo: { requestId: 'req-file-missing-first-quantity' },
      attachments: [{
        type: 'image',
        mimeType: 'image',
        fileUrl: 'https://example.com/cabinet-sketch.jpeg',
        originalFileName: 'cabinet-sketch.jpeg',
      }],
      metadata: {},
    },
  });
  const understandRequestNode = createUnderstandRequestNode({
    model: {
      withStructuredOutput: () => ({
        invoke: async () => {
          throw new Error('understandRequestNode should use extracted items directly');
        },
      }),
    },
  });
  const understood = await understandRequestNode({
    agentPayload: extracted.agentPayload,
    fileExtraction: extracted.fileExtraction,
    recentTurns: [],
    pendingDecision: null,
  });
  const composeResponseNode = createComposeResponseNode({
    model: {
      invoke: async () => {
        throw new Error('composeResponseNode should use the extracted-file template');
      },
    },
  });
  const response = await composeResponseNode({
    agentPayload: extracted.agentPayload,
    intent: understood.intent,
    fileExtraction: extracted.fileExtraction,
    productResults: understood.intent.items.map((item) => ({
      status: 'matched',
      requestedItem: item,
      matches: [{
        sku: item.skuCandidate,
        productName: item.description,
        sellingPrice: 100,
        currency: 'USD',
        qtyAvailable: 10,
        unit: 'EA',
        leadTimeDays: 0,
      }],
    })),
    recentTurns: [],
  });

  assert.deepEqual(understood.intent.items.map((item) => item.quantity), [null, 2, 3]);
  assert.match(response.reply, /Quantity needed:/i);
  assert.match(response.reply, /Item 1: W1212GD-SW/i);
  assert.match(response.reply, /Reply: item 1 qty 2/i);
  assert.match(response.reply, /Item 2: W1812GD-SW/i);
  assert.match(response.reply, /Item 3: W2712GD-SW/i);
  assert.match(response.reply, /\*\*Qty:\*\* 2/i);
  assert.match(response.reply, /\*\*Qty:\*\* 3/i);
  assert.match(response.reply, /^➡️ item 1 qty 2$/m);
  assert.match(response.reply, /^➡️ yes$/m);
  assert.match(response.reply, /^➡️ show cart$/m);
  assert.doesNotMatch(response.reply, /Reply: item 2 qty/i);
  assert.doesNotMatch(response.reply, /Reply: item 3 qty/i);
});

test('unsupported Word order upload asks for a clearer supported format', async () => {
  const extractOrderInputNode = createExtractOrderInputNode({
    model: {
      withStructuredOutput: () => ({
        invoke: async () => ({
          summary: null,
          items: [],
          notes: [],
        }),
      }),
    },
    fetchAttachmentBufferFn: async () => Buffer.from('fake-docx-bytes'),
  });

  const extracted = await extractOrderInputNode({
    agentPayload: {
      inputType: 'document',
      userMessage: 'Customer uploaded a document order. Read the file and use the extracted order details.',
      sessionInfo: { requestId: 'req-file-2' },
      attachments: [{
        type: 'document',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        fileUrl: 'https://example.com/order.docx',
        originalFileName: 'order.docx',
      }],
      metadata: {},
    },
  });

  assert.equal(extracted.fileExtraction.status, 'failed');
  assert.match(extracted.fileExtraction.clarificationQuestion, /PDF or image/i);

  const understandRequestNode = createUnderstandRequestNode({
    model: {
      withStructuredOutput: () => ({
        invoke: async () => {
          throw new Error('understandRequestNode should not call the model for failed extraction');
        },
      }),
    },
  });

  const understood = await understandRequestNode({
    agentPayload: {
      userMessage: 'Customer uploaded a document order.',
      sessionInfo: { requestId: 'req-file-2' },
    },
    fileExtraction: extracted.fileExtraction,
    recentTurns: [],
    pendingDecision: null,
  });

  assert.equal(understood.intent.intent, 'unclear');
  assert.equal(understood.intent.needsClarification, true);
  assert.match(understood.intent.clarificationQuestion, /PDF or image/i);
});

test('image order extraction falls back to readable sketch text before asking for a clearer photo', async () => {
  let invokeCount = 0;
  const extractOrderInputNode = createExtractOrderInputNode({
    model: {
      withStructuredOutput: (_schema, options = {}) => ({
        invoke: async () => {
          invokeCount += 1;

          if (options.name === 'order_file_fallback_extraction') {
            return {
              summary: 'Recovered cabinet plan text from sketch photo.',
              lines: [
                'Top wall cabinets 24x36, 27x36, 36x18',
                'Base cabinets 24 and 27',
                'Island base 12, 36, 18 with dishwasher',
                'Panel near fridge 96 inch',
              ],
              notes: ['handwritten sketch with partial uncertainty'],
            };
          }

          return {
            summary: null,
            items: [],
            notes: [],
          };
        },
      }),
    },
    fetchAttachmentBufferFn: async () => Buffer.from('fake-low-quality-image'),
  });

  const extracted = await extractOrderInputNode({
    agentPayload: {
      inputType: 'image',
      userMessage: 'Customer uploaded a dark hand sketch photo.',
      sessionInfo: { requestId: 'req-file-recovery-1' },
      attachments: [{
        type: 'image',
        mimeType: 'image',
        fileUrl: 'https://example.com/sketch-fallback.jpeg',
        originalFileName: 'sketch-fallback.jpeg',
      }],
      metadata: {},
    },
  });

  assert.equal(invokeCount, 2);
  assert.equal(extracted.fileExtraction.status, 'success');
  assert.equal(extracted.fileExtraction.extractedItems.length, 0);
  assert.match(extracted.fileExtraction.extractedText, /24x36/i);
  assert.match(extracted.fileExtraction.extractedText, /dishwasher/i);
  assert.match(extracted.agentPayload.userMessage, /96 inch/i);
  assert.equal(extracted.fileExtraction.clarificationQuestion, null);
});

test('understand request builds fresh-search items from recovered extraction text without calling intent LLM', async () => {
  const understandRequestNode = createUnderstandRequestNode({
    model: {
      withStructuredOutput: () => ({
        invoke: async () => {
          throw new Error('intent LLM should not be used for recovered extraction text');
        },
      }),
    },
  });

  const understood = await understandRequestNode({
    agentPayload: {
      userMessage: 'Recovered cabinet plan text from sketch photo.',
      sessionInfo: { requestId: 'req-file-fallback-intent-1' },
    },
    fileExtraction: {
      status: 'success',
      mimeType: 'image/jpeg',
      extractedItems: [],
      extractedText: [
        'Top wall cabinets 24x36, 27x36, 36x18',
        'Base cabinets 24 and 27',
        'Island base 12, 36, 18 with dishwasher',
        'Panel near fridge 96 inch',
      ].join('\n'),
      notes: ['handwritten sketch with partial uncertainty'],
      clarificationQuestion: null,
    },
    recentTurns: [],
    pendingDecision: null,
  });

  assert.equal(understood.intent.intent, 'product_enquiry');
  assert.equal(understood.intent.requestMode, 'fresh_search');
  assert.equal(understood.intent.items.length, 4);
  assert.equal(understood.intent.items[0].rawReference, 'Top wall cabinets 24x36, 27x36, 36x18');
  assert.equal(understood.intent.items[2].description, 'Island base 12, 36, 18 with dishwasher');
});

test('cart add response shows only show-cart and add-another guidance', async () => {
  const composeResponseNode = createComposeResponseNode({
    model: {
      invoke: async () => {
        throw new Error('LLM should not be used for cart add template');
      },
    },
  });

  const response = await composeResponseNode({
    agentPayload: {
      sessionInfo: { requestId: 'req-cart-guidance-1' },
      metadata: {
        localDateTime: '2026-08-03T12:00:00+05:30',
        localTimeZone: 'Asia/Kolkata',
      },
    },
    intent: { intent: 'cart_add' },
    productResults: [],
    cartActionResult: {
      type: 'cart_add',
      message: 'I added that item to your cart.',
      changedItems: [{
        sku: 'B42-SW',
        quantity: 9,
        formattedLineTotal: '$7,452.00',
        fulfillmentStatus: 'full_order_scheduled',
        estimatedDate: 'Aug 7, 2026',
      }],
      cartSummary: { formattedTotal: '$7,452.00' },
    },
    recentTurns: [],
  });

  assert.match(response.reply, /show cart/i);
  assert.match(response.reply, /place the order/i);
  assert.match(response.reply, /send a new SKU or product description to add another item/i);
  assert.match(response.reply, /^➡️ Show cart$/m);
  assert.match(response.reply, /^➡️ Place the order .+order summary$/m);
  assert.doesNotMatch(response.reply, /item 1 remove/i);
  assert.doesNotMatch(response.reply, /item 1 update from qty 1 to 3/i);
});

test('cart remove response shows the refreshed cart contents', async () => {
  const composeResponseNode = createComposeResponseNode({
    model: {
      invoke: async () => {
        throw new Error('LLM should not be used for cart remove template');
      },
    },
  });

  const response = await composeResponseNode({
    agentPayload: {
      sessionInfo: { requestId: 'req-cart-guidance-2' },
      metadata: {
        localDateTime: '2026-08-03T12:00:00+05:30',
        localTimeZone: 'Asia/Kolkata',
      },
    },
    intent: { intent: 'cart_remove' },
    productResults: [],
    cartActionResult: {
      type: 'cart_remove',
      message: 'I removed that item from your cart.',
      changedItems: [{
        sku: 'B42-SW',
        quantity: 4,
        formattedLineTotal: '$3,312.00',
        fulfillmentStatus: 'ready_now',
      }],
      cartSummary: { formattedTotal: '$1,760.00' },
      pendingDecision: {
        items: [{
          itemNumber: 1,
          sku: '3DB36-SW',
          productName: '3 Drawer Base Cabinet 36"W Shaker White',
          requestedQuantity: 2,
          status: 'ready_now',
          estimatedDate: null,
        }],
      },
    },
    recentTurns: [],
  });

  assert.match(response.reply, /I removed that item from your cart\./i);
  assert.match(response.reply, /\*3DB36-SW\*/i);
  assert.match(response.reply, /\*\*Cart Total:\*\* \$1,760\.00/i);
  assert.match(response.reply, /place the order/i);
  assert.match(response.reply, /item 1 remove/i);
  assert.match(response.reply, /item 1 update from qty 2 to 3/i);
});

test('cart view update guidance uses the current cart quantity', async () => {
  const composeResponseNode = createComposeResponseNode({
    model: {
      invoke: async () => {
        throw new Error('LLM should not be used for cart view template');
      },
    },
  });

  const response = await composeResponseNode({
    agentPayload: {
      sessionInfo: { requestId: 'req-cart-guidance-quantity-5' },
      metadata: {},
    },
    intent: { intent: 'cart_view' },
    productResults: [],
    cartActionResult: {
      type: 'cart_view',
      cartSummary: { formattedTotal: '$865.00' },
      pendingDecision: {
        items: [{
          itemNumber: 1,
          sku: 'W1212GD-SW',
          productName: 'Wall Cabinet 12"W x 12"H Glass Door Shaker White',
          requestedQuantity: 5,
          formattedLineTotal: '$865.00',
          status: 'ready_now',
          estimatedDate: null,
        }],
      },
    },
    recentTurns: [],
  });

  assert.match(response.reply, /Item 1 update from qty 5 to 3/i);
  assert.doesNotMatch(response.reply, /Item 1 update from qty 1 to 3/i);
});

test('proceed with order after cart resolves to order summary preparation intent', async () => {
  const understandRequestNode = createUnderstandRequestNode({
    model: {
      withStructuredOutput: () => ({
        invoke: async () => {
          throw new Error('LLM should not be used for proceed-with-order summary intent');
        },
      }),
    },
  });

  const result = await understandRequestNode({
    agentPayload: {
      userMessage: 'proceed with order',
      sessionInfo: { requestId: 'req-summary-1' },
    },
    recentTurns: [],
    cart: {
      items: [{ sku: 'B42-SW', quantity: 4, lineTotal: 3312, currency: 'USD' }],
    },
    pendingDecision: {
      type: 'cart_review',
      items: [{ itemNumber: 1, sku: 'B42-SW', requestedQuantity: 4, status: 'ready_now' }],
    },
  });

  assert.equal(result.intent.intent, 'order_summary');
  assert.equal(result.intent.decisionAction, 'prepare_order_summary');
});

test('order summary node builds stub summary from cart', async () => {
  const orderSummaryNode = createOrderSummaryNode();

  const result = await orderSummaryNode({
    agentPayload: {
      sessionInfo: { requestId: 'req-summary-2' },
    },
    intent: {
      intent: 'order_summary',
      decisionAction: 'prepare_order_summary',
    },
    cart: {
      items: [{
        sku: 'B42-SW',
        productName: 'Base Cabinet 42"W Shaker White',
        quantity: 4,
        formattedLineTotal: '$3,312.00',
        lineTotal: 3312,
        currency: 'USD',
        fulfillmentStatus: 'ready_now',
      }],
    },
  });

  assert.equal(result.orderSummaryState.status, 'awaiting_confirmation');
  assert.equal(result.orderSummaryState.summary.lines.length, 1);
  assert.equal(result.orderSummaryState.summary.formattedTotal, '$3,312.00');
});

test('order summary response shows quote draft and direct cart update guidance', async () => {
  const composeResponseNode = createComposeResponseNode({
    model: {
      invoke: async () => {
        throw new Error('LLM should not be used for order summary template');
      },
    },
  });

  const response = await composeResponseNode({
    agentPayload: {
      sessionInfo: { requestId: 'req-summary-3' },
      metadata: {},
    },
    intent: {
      intent: 'order_summary',
      decisionAction: 'prepare_order_summary',
    },
    productResults: [],
    orderSummaryState: {
      status: 'awaiting_confirmation',
      quoteDraftId: 'Q-DRAFT-123',
      customerCheck: { existsInZoho: 'stubbed' },
      summary: {
        formattedTotal: '$3,312.00',
        lines: [{
          itemNumber: 1,
          sku: 'B42-SW',
          productName: 'Base Cabinet 42"W Shaker White',
          quantity: 4,
          formattedLineTotal: '$3,312.00',
          fulfillmentStatus: 'ready_now',
          estimatedDate: null,
        }, {
          itemNumber: 2,
          sku: 'W1230-SW',
          productName: 'Wall Cabinet 12\"W x 30\"H Shaker White',
          quantity: 1,
          formattedLineTotal: '$120.00',
          fulfillmentStatus: 'ready_now',
          estimatedDate: null,
        }],
      },
    },
    recentTurns: [],
  });

  assert.match(response.reply, /ORDER SUMMARY/i);
  assert.match(response.reply, /\*\*Quote\*\*: Q-DRAFT-123/i);
  assert.match(response.reply, /Confirm.*finalize this order and receive the invoice and payment link/i);
  assert.match(response.reply, /Item 1 remove/i);
  assert.match(response.reply, /Item 1 update from qty 4 to 3/i);
  assert.match(response.reply, /🟢 Available Now\n\n2️⃣ \*\*W1230-SW\*\*/);
  assert.doesNotMatch(response.reply, /`edit`/i);
});

test('order summary response preserves cart review context for direct item edits', async () => {
  const composeResponseNode = createComposeResponseNode({
    model: {
      invoke: async () => {
        throw new Error('LLM should not be used for order summary template');
      },
    },
  });

  const response = await composeResponseNode({
    agentPayload: {
      sessionInfo: { requestId: 'req-summary-3b' },
      metadata: {},
    },
    intent: {
      intent: 'order_summary',
      decisionAction: 'prepare_order_summary',
    },
    productResults: [],
    orderSummaryState: {
      status: 'awaiting_confirmation',
      quoteDraftId: 'Q-DRAFT-123',
      customerCheck: { existsInZoho: 'stubbed' },
      summary: {
        formattedTotal: '$3,898.00',
        lines: [{
          itemNumber: 1,
          sku: 'B42-SW',
          productName: 'Base Cabinet 42"W Shaker White',
          quantity: 4,
          formattedLineTotal: '$3,312.00',
          fulfillmentStatus: 'ready_now',
          estimatedDate: null,
        }, {
          itemNumber: 2,
          sku: 'W2436-SW',
          productName: 'Wall Cabinet 24"W x 36"H Shaker White',
          quantity: 1,
          formattedLineTotal: '$586.00',
          fulfillmentStatus: 'full_order_scheduled',
          estimatedDate: 'Aug 8, 2026',
        }],
      },
    },
    recentTurns: [],
  });

  assert.equal(response.pendingDecision?.type, 'cart_review');
  assert.equal(response.pendingDecision?.items?.length, 2);
  assert.equal(response.pendingDecision?.items?.[0]?.itemNumber, 1);
  assert.equal(response.pendingDecision?.items?.[0]?.sku, 'B42-SW');
  assert.equal(response.pendingDecision?.items?.[1]?.itemNumber, 2);
  assert.equal(response.pendingDecision?.items?.[1]?.requestedQuantity, 1);
});

test('cart update after order summary marks summary as editing', async () => {
  const cartActionNode = createCartActionNode();

  const result = await cartActionNode({
    agentPayload: {
      sessionInfo: { requestId: 'req-summary-3c' },
      metadata: {
        localDateTime: '2026-08-04T10:00:00+05:30',
        localTimeZone: 'Asia/Kolkata',
      },
    },
    intent: {
      intent: 'cart_update',
      decisionAction: 'change_qty',
    },
    productResults: [{
      status: 'matched',
      requestedItem: {
        quantity: 3,
      },
      matches: [{
        sku: 'B42-SW',
        productName: 'Base Cabinet 42"W Shaker White',
        sellingPrice: 828,
        currency: 'USD',
        qtyAvailable: 8,
        unit: 'EA',
        leadTimeDays: 0,
      }],
    }],
    cart: {
      items: [{
        sku: 'B42-SW',
        productName: 'Base Cabinet 42"W Shaker White',
        quantity: 1,
        unitPrice: 828,
        currency: 'USD',
        formattedUnitPrice: '$828.00',
        lineTotal: 828,
        formattedLineTotal: '$828.00',
        qtyAvailable: 8,
        estimatedDate: null,
        fulfillmentStatus: 'ready_now',
      }],
      currency: 'USD',
    },
    pendingDecision: {
      type: 'cart_review',
      items: [{
        itemNumber: 1,
        sku: 'B42-SW',
        productName: 'Base Cabinet 42"W Shaker White',
        requestedReference: 'B42-SW',
        requestedQuantity: 1,
        status: 'ready_now',
        availableNow: 8,
        estimatedDate: null,
      }],
    },
    orderSummaryState: {
      status: 'awaiting_confirmation',
      quoteDraftId: 'Q-DRAFT-123',
      customerCheck: { existsInZoho: 'stubbed' },
      summaryVersion: 1,
      summary: {
        formattedTotal: '$828.00',
        lines: [{
          itemNumber: 1,
          sku: 'B42-SW',
          productName: 'Base Cabinet 42"W Shaker White',
          quantity: 1,
          formattedLineTotal: '$828.00',
          fulfillmentStatus: 'ready_now',
          estimatedDate: null,
        }],
      },
    },
  });

  assert.equal(result.orderSummaryState?.status, 'editing');
  assert.equal(result.cart.items[0].quantity, 3);
});

test('confirm after order summary produces stub final artifacts response', async () => {
  const understandRequestNode = createUnderstandRequestNode({
    model: {
      withStructuredOutput: () => ({
        invoke: async () => {
          throw new Error('LLM should not be used for order summary confirm intent');
        },
      }),
    },
  });
  const orderSummaryNode = createOrderSummaryNode();
  const composeResponseNode = createComposeResponseNode({
    model: {
      invoke: async () => {
        throw new Error('LLM should not be used for order submit template');
      },
    },
  });

  const understood = await understandRequestNode({
    agentPayload: {
      userMessage: 'confirm',
      sessionInfo: { requestId: 'req-summary-4' },
    },
    recentTurns: [],
    orderSummaryState: {
      status: 'awaiting_confirmation',
      quoteDraftId: 'Q-DRAFT-123',
      summary: {
        formattedTotal: '$3,312.00',
        lines: [],
      },
    },
    cart: {
      items: [{
        sku: 'B42-SW',
        productName: 'Base Cabinet 42"W Shaker White',
        quantity: 4,
        formattedLineTotal: '$3,312.00',
        lineTotal: 3312,
        currency: 'USD',
        fulfillmentStatus: 'ready_now',
      }],
    },
  });

  const summarized = await orderSummaryNode({
    agentPayload: { sessionInfo: { requestId: 'req-summary-4' } },
    intent: understood.intent,
    cart: {
      items: [{
        sku: 'B42-SW',
        productName: 'Base Cabinet 42"W Shaker White',
        quantity: 4,
        formattedLineTotal: '$3,312.00',
        lineTotal: 3312,
        currency: 'USD',
        fulfillmentStatus: 'ready_now',
      }],
    },
    orderSummaryState: {
      status: 'awaiting_confirmation',
      quoteDraftId: 'Q-DRAFT-123',
      customerCheck: { existsInZoho: 'stubbed' },
      summaryVersion: 1,
      summary: {
        formattedTotal: '$3,312.00',
        lines: [{
          itemNumber: 1,
          sku: 'B42-SW',
          productName: 'Base Cabinet 42"W Shaker White',
          quantity: 4,
          formattedLineTotal: '$3,312.00',
          fulfillmentStatus: 'ready_now',
          estimatedDate: null,
        }],
      },
    },
  });

  const response = await composeResponseNode({
    agentPayload: {
      sessionInfo: { requestId: 'req-summary-4' },
      metadata: {},
    },
    intent: understood.intent,
    productResults: [],
    orderSummaryState: summarized.orderSummaryState,
    recentTurns: [],
  });

  assert.match(response.reply, /confirmed successfully\./i);
  assert.match(response.reply, /Order Ref:/i);
  assert.match(response.reply, /Invoice/i);
  assert.match(response.reply, /Payment Link/i);
  assert.doesNotMatch(response.reply, /Quote:/i);
  assert.doesNotMatch(response.reply, /Reply with:/i);
  assert.equal(response.conversationStatus, 'order_completed');
});

test('confim typo after order summary still submits the order', async () => {
  const understandRequestNode = createUnderstandRequestNode({
    model: {
      withStructuredOutput: () => ({
        invoke: async () => {
          throw new Error('LLM should not be used for mistyped order summary confirm intent');
        },
      }),
    },
  });

  const understood = await understandRequestNode({
    agentPayload: {
      userMessage: 'confim',
      sessionInfo: { requestId: 'req-summary-4b' },
    },
    recentTurns: [],
    orderSummaryState: {
      status: 'awaiting_confirmation',
      quoteDraftId: 'Q-DRAFT-123',
      summary: {
        formattedTotal: '$412.00',
        lines: [],
      },
    },
    cart: {
      items: [{
        sku: 'W1212GD-SW',
        productName: 'Wall Cabinet 12"W x 12"H Glass Door Shaker White',
        quantity: 4,
        formattedLineTotal: '$412.00',
        lineTotal: 412,
        currency: 'USD',
        fulfillmentStatus: 'full_order_scheduled',
      }],
    },
  });

  assert.equal(understood.intent.intent, 'order_submit');
  assert.equal(understood.intent.decisionAction, 'submit_order');
});

test('guided multi-item response groups usable matches and unmatched items clearly', async () => {
  const composeResponseNode = createComposeResponseNode({
    model: {
      invoke: async () => {
        throw new Error('LLM should not be used for guided multi-item template');
      },
    },
  });

  const response = await composeResponseNode({
    agentPayload: {
      sessionInfo: { requestId: 'req-guided-multi-1' },
      metadata: {
        localDateTime: '2026-08-03T12:00:00+05:30',
        localTimeZone: 'Asia/Kolkata',
        extractedOrderText: '24x36 wall cabinet\n27 base cabinet',
      },
    },
    intent: { intent: 'product_enquiry' },
    productResults: [
      {
        status: 'matched',
        requestedItem: { rawReference: '24x36 wall cabinet', quantity: 2 },
        matches: [{
          sku: 'W2436-SW',
          productName: 'Wall Cabinet 24"W x 36"H Shaker White',
          sellingPrice: 404,
          currency: 'USD',
          qtyAvailable: 0,
          unit: 'EA',
          leadTimeDays: 5,
        }],
      },
      {
        status: 'suggestions',
        requestedItem: { rawReference: '27" base cabinet', quantity: 1 },
        matches: [
          {
            sku: 'B27-SW',
            productName: 'Base Cabinet 27"W Shaker White',
            sellingPrice: 586,
            currency: 'USD',
            qtyAvailable: 5,
          },
          {
            sku: 'SB27-SW',
            productName: 'Sink Base Cabinet 27"W Shaker White',
            sellingPrice: 456,
            currency: 'USD',
            qtyAvailable: 5,
          },
        ],
      },
      {
        status: 'unmatched',
        requestedItem: { rawReference: 'Dash base cabinet', quantity: 1 },
        matches: [],
      },
    ],
    recentTurns: [],
  });

  assert.match(response.reply, /Matched items:/i);
  assert.match(response.reply, /Options:/i);
  assert.match(response.reply, /Skipped:/i);
  assert.match(response.reply, /B27-SW/i);
  assert.match(response.reply, /SB27-SW/i);
  assert.match(response.reply, /Reply: item 2 option 1 qty 1/i);
  assert.match(response.reply, /Reply with:/i);
  assert.match(response.reply, /^➡️ yes$/im);
  assert.match(response.reply, /item 2 option 1 qty 1/i);
  assert.match(response.reply, /Item 3: Dash base cabinet/i);
  assert.doesNotMatch(response.reply, /Reply with your selections, for example:/i);
  assert.match(response.reply, /If you still need a skipped item, send the SKU or clearer description in a new message\./i);
  assert.match(response.reply, /✅ \*\*Matched items:\*\*/);
  assert.match(response.reply, /🔎 \*\*Options:\*\*/);
  assert.match(response.reply, /❌ \*\*Skipped:\*\*/);
  assert.match(response.reply, /2️⃣ \*\*Item 2: 27" base cabinet\*\*/);
  assert.match(response.reply, /1️⃣ \*\*B27-SW\*\*/);
  assert.match(response.reply, /\*\*Unit Price:\*\*/);
  assert.doesNotMatch(response.reply, /\*\*(?:Rate|Multiplier):\*\*/);
  assert.match(response.reply, /\*\*Unit Price:\*\*[^\n]*\n\n\s*2️⃣ \*\*SB27-SW\*\*/);
});

test('extracted-file response with only close options does not offer yes-to-add', async () => {
  const composeResponseNode = createComposeResponseNode({
    model: {
      invoke: async () => {
        throw new Error('LLM should not be used for guided multi-item template');
      },
    },
  });

  const response = await composeResponseNode({
    agentPayload: {
      sessionInfo: { requestId: 'req-guided-multi-2' },
      metadata: {
        localDateTime: '2026-08-03T12:00:00+05:30',
        localTimeZone: 'Asia/Kolkata',
        extractedOrderText: '24x36 wall cabinet\n27 base cabinet',
      },
    },
    intent: { intent: 'product_enquiry' },
    productResults: [
      {
        status: 'suggestions',
        requestedItem: { rawReference: '24x36 wall cabinet', quantity: 1 },
        matches: [
          {
            sku: 'W2436-SW',
            productName: 'Wall Cabinet 24"W x 36"H Shaker White',
            sellingPrice: 404,
            currency: 'USD',
            qtyAvailable: 5,
          },
        ],
      },
      {
        status: 'unmatched',
        requestedItem: { rawReference: 'Dash base cabinet', quantity: 1 },
        matches: [],
      },
    ],
    recentTurns: [],
  });

  assert.doesNotMatch(response.reply, /Reply `yes` if you would like me to add/i);
  assert.match(response.reply, /Options:/i);
  assert.match(response.reply, /Skipped:/i);
  assert.match(response.reply, /W2436-SW/i);
  assert.match(response.reply, /Reply: item 1 option 1 qty 1/i);
  assert.match(response.reply, /Please choose from the options above\./i);
  assert.match(response.reply, /For multiple items, send one selection per line:/i);
  assert.match(response.reply, /^➡️ item 1 option 1 qty 1$/im);
  assert.match(response.reply, /^➡️ item 2 option 2 qty 2$/im);
  assert.match(response.reply, /Reply with:/i);
  assert.match(response.reply, /item 1 option 1 qty 1/i);
  assert.match(response.reply, /Item 2: Dash base cabinet/i);
  assert.match(response.reply, /If you still need a skipped item, send the SKU or clearer description in a new message\./i);
  assert.match(response.reply, /🔎 \*\*Options:\*\*/);
  assert.match(response.reply, /1️⃣ \*\*Item 1: 24x36 wall cabinet\*\*/);
  assert.match(response.reply, /1️⃣ \*\*W2436-SW\*\*/);
});

test('extracted-file response includes item option qty example for close sketch matches', async () => {
  const composeResponseNode = createComposeResponseNode({
    model: {
      invoke: async () => {
        throw new Error('LLM should not be used for extracted-file guidance template');
      },
    },
  });

  const response = await composeResponseNode({
    agentPayload: {
      sessionInfo: { requestId: 'req-file-guidance-1' },
      metadata: {
        localDateTime: '2026-08-03T12:00:00+05:30',
        localTimeZone: 'Asia/Kolkata',
        extractedOrderText: '30x12 glass door',
      },
    },
    intent: { intent: 'product_enquiry' },
    productResults: [{
      status: 'suggestions',
      requestedItem: { rawReference: '30x12 glass door', quantity: null },
      matches: [{
        sku: 'W3015GD-SW',
        productName: 'Wall Cabinet 30"W x 15"H Glass Door Shaker White',
        sellingPrice: 180,
        currency: 'USD',
        qtyAvailable: 2,
        unit: 'EA',
        leadTimeDays: 4,
      }],
    }],
    recentTurns: [],
  });

  assert.match(response.reply, /Options:/i);
  assert.match(response.reply, /item 1 option 1 qty 1/i);
  assert.match(response.reply, /Reply with:/i);
  assert.doesNotMatch(response.reply, /show more/i);
});

test('extracted-file yes follow-up selects all exact matched pending items', async () => {
  const understandRequestNode = createUnderstandRequestNode({
    model: {
      withStructuredOutput: () => ({
        invoke: async () => {
          throw new Error('LLM should not be used for extracted-file yes follow-up');
        },
      }),
    },
  });

  const understood = await understandRequestNode({
    agentPayload: {
      userMessage: 'yes',
      sessionInfo: { requestId: 'req-file-yes-1' },
    },
    recentTurns: [],
    pendingDecision: {
      source: 'extracted_file',
      items: [
        {
          itemNumber: 1,
          requestedReference: 'W1212GD-SW qty 2',
          requestedQuantity: 2,
          sku: 'W1212GD-SW',
          productName: 'Wall Cabinet 12"W x 12"H Glass Door Shaker White',
          status: 'lead_time_only',
        },
        {
          itemNumber: 2,
          requestedReference: 'W1512GD-SW qty 2',
          requestedQuantity: 2,
          sku: 'W1512GD-SW',
          productName: 'Wall Cabinet 15"W x 12"H Glass Door Shaker White',
          status: 'lead_time_only',
        },
        {
          itemNumber: 3,
          requestedReference: '24x36 wall cabinet',
          status: 'suggestions',
          options: [
            {
              sku: 'W2436-SW',
              productName: 'Wall Cabinet 24"W x 36"H Shaker White',
              formattedUnitPrice: '$404.00',
              currentAvailable: 5,
            },
          ],
        },
      ],
    },
  });

  assert.equal(understood.intent.intent, 'cart_add');
  assert.equal(understood.intent.decisionAction, 'add');
  assert.deepEqual(understood.intent.referencedItems, [1, 2]);
  assert.equal(understood.intent.items.length, 2);
  assert.equal(understood.intent.items[0].skuCandidate, 'W1212GD-SW');
  assert.equal(understood.intent.items[1].quantity, 2);
});

test('single extracted exact match without quantity asks for quantity directly', async () => {
  const composeResponseNode = createComposeResponseNode({
    model: {
      invoke: async () => {
        throw new Error('LLM should not be used for guided multi-item template');
      },
    },
  });

  const response = await composeResponseNode({
    agentPayload: {
      sessionInfo: { requestId: 'req-guided-multi-3' },
      metadata: {
        localDateTime: '2026-08-03T12:00:00+05:30',
        localTimeZone: 'Asia/Kolkata',
        extractedOrderText: 'W2436-SW',
      },
    },
    intent: { intent: 'product_enquiry' },
    productResults: [
      {
        status: 'matched',
        requestedItem: { rawReference: 'W2436-SW', quantity: null },
        matches: [{
          sku: 'W2436-SW',
          productName: 'Wall Cabinet 24"W x 36"H Shaker White',
          sellingPrice: 404,
          currency: 'USD',
          qtyAvailable: 5,
          unit: 'EA',
          leadTimeDays: 0,
        }],
      },
    ],
    recentTurns: [],
  });

  assert.match(response.reply, /Quantity needed:/i);
  assert.match(response.reply, /Item 1: W2436-SW/i);
  assert.match(response.reply, /Reply: item 1 qty 2/i);
  assert.match(response.reply, /Reply with:/i);
  assert.doesNotMatch(response.reply, /^yes$/im);
});

test('unrelated messages do not repeat a pending cart response', async () => {
  const understandRequestNode = createUnderstandRequestNode({
    model: {
      withStructuredOutput: () => ({
        invoke: async () => {
          throw new Error('unrelated messages should not use stale pending cart context');
        },
      }),
    },
  });
  const composeResponseNode = createComposeResponseNode({
    model: {
      invoke: async () => {
        throw new Error('empty unrelated requests should use clarification guidance');
      },
    },
  });
  const pendingDecision = {
    type: 'cart_review',
    items: [
      { itemNumber: 1, sku: 'W1212GD-SW', requestedQuantity: 5, status: 'fully_available' },
      { itemNumber: 2, sku: 'W1812GD-SW', requestedQuantity: 1, status: 'fully_available' },
    ],
  };

  for (const userMessage of ['what is the time', 'iphone 13']) {
    const agentPayload = {
      userMessage,
      sessionInfo: { requestId: `req-unrelated-${userMessage.replace(/\s+/g, '-')}` },
      metadata: {},
    };
    const understood = await understandRequestNode({
      agentPayload,
      recentTurns: [],
      pendingDecision,
    });
    const response = await composeResponseNode({
      agentPayload,
      intent: understood.intent,
      productResults: [],
      pendingDecision,
      recentTurns: [],
    });

    assert.equal(understood.intent.intent, 'unrelated');
    assert.match(response.reply, /couldn't find \*\*.+\*\* in our current inventory/i);
    assert.match(response.reply, /Search again with a different SKU or product name/i);
    assert.doesNotMatch(response.reply, /W1212GD-SW|Cart Total|add 1,2/i);
    assert.equal(response.conversationStatus, 'active');
  }

  const freshAgentPayload = {
    userMessage: 'iphone 13',
    sessionInfo: { requestId: 'req-unrelated-fresh-iphone' },
    metadata: {},
  };
  const freshIntent = await understandRequestNode({
    agentPayload: freshAgentPayload,
    recentTurns: [],
    pendingDecision: null,
  });
  const freshResponse = await composeResponseNode({
    agentPayload: freshAgentPayload,
    intent: freshIntent.intent,
    productResults: [],
    recentTurns: [],
  });

  assert.equal(freshIntent.intent.intent, 'unrelated');
  assert.match(freshResponse.reply, /couldn't find \*\*iphone 13\*\* in our current inventory/i);
  assert.match(freshResponse.reply, /Search again with a different SKU or product name/i);
  assert.doesNotMatch(freshResponse.reply, /storage capacity|128GB|256GB/i);

  const skuSearchResponse = await composeResponseNode({
    agentPayload: {
      userMessage: 'xyz123 6 qty',
      sessionInfo: { requestId: 'req-unrelated-sku-with-quantity' },
      metadata: {},
    },
    intent: { intent: 'unrelated' },
    productResults: [],
    recentTurns: [],
  });

  assert.match(skuSearchResponse.reply, /couldn't find \*\*xyz123\*\* in our current inventory/i);
  assert.doesNotMatch(skuSearchResponse.reply, /\*\*xyz123 6 qty\*\*/i);

  const typoSearchResponse = await composeResponseNode({
    agentPayload: {
      userMessage: 'iphon 1',
      sessionInfo: { requestId: 'req-unclear-typo-search' },
      metadata: {},
    },
    intent: { intent: 'unclear', clarificationQuestion: null },
    productResults: [],
    recentTurns: [],
  });

  assert.match(typoSearchResponse.reply, /couldn't find \*\*iphon 1\*\* in our current inventory/i);
  assert.doesNotMatch(typoSearchResponse.reply, /I am happy to help/i);
});

test('single unmatched product search uses the short not-found reply', async () => {
  const composeResponseNode = createComposeResponseNode({
    model: {
      invoke: async () => {
        throw new Error('single unmatched product response must not use the LLM');
      },
    },
  });

  const response = await composeResponseNode({
    agentPayload: {
      userMessage: 'xyz123 6 qty',
      sessionInfo: { requestId: 'req-single-unmatched-search' },
      metadata: {},
    },
    intent: { intent: 'product_enquiry' },
    productResults: [{
      status: 'unmatched',
      requestedItem: { rawReference: 'xyz123', quantity: 6 },
      matches: [],
    }],
    recentTurns: [],
  });

  assert.match(response.reply, /couldn't find \*\*xyz123\*\* in our current inventory/i);
  assert.match(response.reply, /^➡️ Search again with a different SKU or product name$/im);
  assert.doesNotMatch(response.reply, /Which would you prefer|Browse our available products/i);
});

test('professional cart commands are parsed for remove and update', async () => {
  const understandRequestNode = createUnderstandRequestNode({
    model: {
      withStructuredOutput: () => ({
        invoke: async () => {
          throw new Error('LLM should not be used for professional cart commands');
        },
      }),
    },
  });

  const removed = await understandRequestNode({
    agentPayload: {
      userMessage: 'item 1 remove',
      sessionInfo: { requestId: 'req-cart-pro-1' },
    },
    recentTurns: [],
    pendingDecision: {
      items: [{ itemNumber: 1, sku: 'ERB36-SW', requestedQuantity: 4, status: 'ready_now' }],
    },
  });

  assert.equal(removed.intent.intent, 'cart_remove');
  assert.deepEqual(removed.intent.referencedItems, [1]);

  const updated = await understandRequestNode({
    agentPayload: {
      userMessage: 'item 1 update from qty 1 to 3',
      sessionInfo: { requestId: 'req-cart-pro-2' },
    },
    recentTurns: [],
    pendingDecision: {
      items: [{ itemNumber: 1, sku: 'ERB36-SW', requestedQuantity: 1, status: 'ready_now', productName: 'Lazy Susan Base Cabinet' }],
    },
  });

  assert.equal(updated.intent.intent, 'cart_update');
  assert.equal(updated.intent.decisionAction, 'change_qty');
  assert.deepEqual(updated.intent.referencedItems, [1]);
  assert.equal(updated.intent.items[0].quantity, 3);
});

test('natural-language cart quantity update uses the requested quantity', async () => {
  const understandRequestNode = createUnderstandRequestNode({
    model: {
      withStructuredOutput: () => ({
        invoke: async () => {
          throw new Error('LLM should not be used for natural-language cart update');
        },
      }),
    },
  });

  const updated = await understandRequestNode({
    agentPayload: {
      userMessage: 'i want to update the item 1 qty to 4',
      sessionInfo: { requestId: 'req-cart-natural-update-1' },
    },
    recentTurns: [],
    pendingDecision: {
      type: 'cart_review',
      items: [{
        itemNumber: 1,
        sku: 'W1212GD-SW',
        productName: 'Wall Cabinet 12"W x 12"H Glass Door Shaker White',
        requestedQuantity: 3,
        status: 'ready_now',
      }],
    },
  });

  assert.equal(updated.intent.intent, 'cart_update');
  assert.equal(updated.intent.decisionAction, 'change_qty');
  assert.deepEqual(updated.intent.referencedItems, [1]);
  assert.equal(updated.intent.items[0].quantity, 4);
});

test('arrow and natural quantity requests update the referenced cart item', async () => {
  const understandRequestNode = createUnderstandRequestNode({
    model: {
      withStructuredOutput: () => ({
        invoke: async () => {
          throw new Error('LLM should not be used for natural-language cart updates');
        },
      }),
    },
  });
  const pendingDecision = {
    type: 'cart_review',
    items: [{
      itemNumber: 1,
      sku: 'W1212GD-SW',
      productName: 'Wall Cabinet 12"W x 12"H Glass Door Shaker White',
      requestedQuantity: 3,
      status: 'ready_now',
    }],
  };

  for (const [userMessage, quantity] of [
    ['update the item 1 3 --> 8', 8],
    ['i need only 4 nos of item 1', 4],
  ]) {
    const updated = await understandRequestNode({
      agentPayload: {
        userMessage,
        sessionInfo: { requestId: `req-cart-natural-update-${quantity}` },
      },
      recentTurns: [],
      pendingDecision,
    });

    assert.equal(updated.intent.intent, 'cart_update');
    assert.equal(updated.intent.decisionAction, 'change_qty');
    assert.deepEqual(updated.intent.referencedItems, [1]);
    assert.equal(updated.intent.items[0].quantity, quantity);
  }
});

test('should-become cart quantity wording updates the referenced cart item', async () => {
  let invokeCount = 0;
  const understandRequestNode = createUnderstandRequestNode({
    model: {
      withStructuredOutput: () => ({
        invoke: async () => {
          invokeCount += 1;
          return {
            intent: 'cart_add',
            requestMode: 'continue_previous_selection',
            decisionAction: 'add',
            referencedItems: [1],
            removeReferencedItems: [],
            clearCartConfirmed: false,
            items: [{
              rawReference: 'W1212GD-SW',
              skuCandidate: 'W1212GD-SW',
              quantity: 2,
              unit: null,
              description: null,
              dimensions: null,
              sketchHints: null,
            }],
            needsClarification: false,
            clarificationQuestion: null,
          };
        },
      }),
    },
  });

  const updated = await understandRequestNode({
    agentPayload: {
      userMessage: 'item 1 quantity should become 6',
      sessionInfo: { requestId: 'req-cart-natural-update-become-6' },
    },
    recentTurns: [],
    pendingDecision: {
      type: 'cart_review',
      items: [{
        itemNumber: 1,
        sku: 'W1212GD-SW',
        productName: 'Wall Cabinet 12"W x 12"H Glass Door Shaker White',
        requestedQuantity: 4,
        status: 'ready_now',
      }],
    },
  });

  assert.equal(invokeCount, 0);
  assert.equal(updated.intent.intent, 'cart_update');
  assert.equal(updated.intent.decisionAction, 'change_qty');
  assert.deepEqual(updated.intent.referencedItems, [1]);
  assert.equal(updated.intent.items[0].quantity, 6);
});

test('combined add and all-options request expands every selected pending item', () => {
  const intent = parseContinuationRequest(
    'add 1\nitem 2 all option i need 2 each\nitem 3 all option i need 3 each',
    {
      items: [
        { itemNumber: 1, sku: 'W1212GD-SW', requestedQuantity: 2, status: 'fully_available' },
        {
          itemNumber: 2,
          requestedReference: 'base cabinet 42 inch',
          options: [
            { sku: 'B42-SW', productName: 'Base Cabinet 42' },
            { sku: 'BBC42-SW', productName: 'Blind Corner Base Cabinet 42' },
          ],
        },
        {
          itemNumber: 3,
          requestedReference: 'drawer base cabinet 36 inch',
          options: [
            { sku: 'V3621DL-SW', productName: 'Vanity Drawer Base Left 36' },
            { sku: 'V3621DR-SW', productName: 'Vanity Drawer Base Right 36' },
            { sku: 'VSD36-SW', productName: 'Vanity Sink Drawer Base 36' },
          ],
        },
      ],
    },
  );

  assert.equal(intent.intent, 'cart_add');
  assert.equal(intent.decisionAction, 'add');
  assert.deepEqual(intent.referencedItems, [1, 2, 3]);
  assert.deepEqual(intent.items.map((item) => [item.skuCandidate, item.quantity]), [
    ['W1212GD-SW', 2],
    ['B42-SW', 2],
    ['BBC42-SW', 2],
    ['V3621DL-SW', 3],
    ['V3621DR-SW', 3],
    ['VSD36-SW', 3],
  ]);
});

test('combined request supports ready items, option subsets, and all-options selections', () => {
  const intent = parseContinuationRequest(
    'add 1\nitem 2 option 1 and 3 qty 2 each\nitem 3 all options qty 3 each',
    {
      items: [
        { itemNumber: 1, sku: 'W1212GD-SW', requestedQuantity: 2, status: 'fully_available' },
        {
          itemNumber: 2,
          options: [
            { sku: 'B42-SW', productName: 'Base Cabinet 42' },
            { sku: 'BBC42-SW', productName: 'Blind Corner Base Cabinet 42' },
            { sku: 'VSD42-SW', productName: 'Vanity Sink Drawer Base 42' },
          ],
        },
        {
          itemNumber: 3,
          options: [
            { sku: 'VSD36-SW', productName: 'Vanity Sink Drawer Base 36' },
            { sku: '3DB36-SW', productName: '3 Drawer Base Cabinet 36' },
            { sku: 'V3621DL-SW', productName: 'Vanity Drawer Base Left 36' },
          ],
        },
      ],
    },
  );

  assert.equal(intent.intent, 'cart_add');
  assert.deepEqual(intent.referencedItems, [1, 2, 3]);
  assert.deepEqual(intent.items.map((item) => [item.skuCandidate, item.quantity]), [
    ['W1212GD-SW', 2],
    ['B42-SW', 2],
    ['VSD42-SW', 2],
    ['VSD36-SW', 3],
    ['3DB36-SW', 3],
    ['V3621DL-SW', 3],
  ]);
});

test('natural-language option subsets select only the requested options per item', () => {
  const intent = parseContinuationRequest(
    'item 2 option 1 and 3 qty 2 each\nitem 3 only option 2 qty 4 each',
    {
      items: [
        {
          itemNumber: 2,
          requestedReference: 'base cabinet 42 inch',
          options: [
            { sku: 'B42-SW', productName: 'Base Cabinet 42' },
            { sku: 'BBC42-SW', productName: 'Blind Corner Base Cabinet 42' },
            { sku: 'VSD42-SW', productName: 'Vanity Sink Drawer Base 42' },
          ],
        },
        {
          itemNumber: 3,
          requestedReference: 'drawer base cabinet 36 inch',
          options: [
            { sku: 'V3621DL-SW', productName: 'Vanity Drawer Base Left 36' },
            { sku: 'V3621DR-SW', productName: 'Vanity Drawer Base Right 36' },
            { sku: 'VSD36-SW', productName: 'Vanity Sink Drawer Base 36' },
          ],
        },
      ],
    },
  );

  assert.equal(intent.intent, 'product_enquiry');
  assert.equal(intent.decisionAction, 'choose_option');
  assert.deepEqual(intent.items.map((item) => [item.skuCandidate, item.quantity]), [
    ['B42-SW', 2],
    ['VSD42-SW', 2],
    ['V3621DR-SW', 4],
  ]);
});

test('unrecognized cart-update wording falls through to the structured llm', async () => {
  let invokeCount = 0;
  const understandRequestNode = createUnderstandRequestNode({
    model: {
      withStructuredOutput: () => ({
        invoke: async () => {
          invokeCount += 1;
          return {
            intent: 'cart_update',
            requestMode: 'continue_previous_selection',
            decisionAction: 'change_qty',
            referencedItems: [1],
            removeReferencedItems: [],
            clearCartConfirmed: false,
            items: [{
              rawReference: 'W1212GD-SW',
              skuCandidate: 'W1212GD-SW',
              quantity: 4,
              unit: null,
              description: null,
              dimensions: null,
              sketchHints: null,
            }],
            needsClarification: false,
            clarificationQuestion: null,
          };
        },
      }),
    },
  });

  const updated = await understandRequestNode({
    agentPayload: {
      userMessage: 'please make item 1 four for this project',
      sessionInfo: { requestId: 'req-cart-llm-update-1' },
    },
    recentTurns: [],
    pendingDecision: {
      type: 'cart_review',
      items: [{ itemNumber: 1, sku: 'W1212GD-SW', requestedQuantity: 3, status: 'ready_now' }],
    },
  });

  assert.equal(invokeCount, 0);
  assert.equal(updated.intent.intent, 'cart_update');
  assert.equal(updated.intent.decisionAction, 'change_qty');
  assert.equal(updated.intent.items[0].quantity, 4);
});

test('explicit SKU quantity is preserved when the model omits it', async () => {
  const understandRequestNode = createUnderstandRequestNode({
    model: {
      withStructuredOutput: () => ({
        invoke: async () => ({
          intent: 'product_enquiry',
          requestMode: 'fresh_search',
          decisionAction: 'none',
          referencedItems: [],
          removeReferencedItems: [],
          clearCartConfirmed: false,
          items: [{
            rawReference: 'w1212gd-sw',
            skuCandidate: 'w1212gd-sw',
            quantity: null,
            unit: null,
            description: 'w1212gd-sw',
            dimensions: null,
            sketchHints: null,
          }],
          needsClarification: false,
          clarificationQuestion: null,
        }),
      }),
    },
  });

  const result = await understandRequestNode({
    agentPayload: {
      userMessage: 'w1212gd-sw 4 nos',
      sessionInfo: { requestId: 'req-sku-quantity-4' },
    },
    recentTurns: [],
  });

  assert.equal(result.intent.items[0].quantity, 4);
});

test('order summary direct cart update command is not downgraded to generic edit guidance', async () => {
  const understandRequestNode = createUnderstandRequestNode({
    model: {
      withStructuredOutput: () => ({
        invoke: async () => {
          throw new Error('LLM should not be used for order summary direct cart update');
        },
      }),
    },
  });

  const updated = await understandRequestNode({
    agentPayload: {
      userMessage: 'item1 update from qty 5 to 7',
      sessionInfo: { requestId: 'req-summary-edit-1' },
    },
    recentTurns: [],
    orderSummaryState: {
      status: 'awaiting_confirmation',
      quoteDraftId: 'Q-DRAFT-456',
      summary: {
        formattedTotal: '$515.00',
        lines: [{
          itemNumber: 1,
          sku: 'W1212GD-SW',
          productName: 'Wall Cabinet 12"W x 12"H Glass Door Shaker White',
          quantity: 5,
          formattedLineTotal: '$515.00',
          fulfillmentStatus: 'full_order_scheduled',
          estimatedDate: 'Aug 8, 2026',
        }],
      },
    },
    pendingDecision: {
      type: 'cart_review',
      items: [{
        itemNumber: 1,
        sku: 'W1212GD-SW',
        productName: 'Wall Cabinet 12"W x 12"H Glass Door Shaker White',
        requestedQuantity: 5,
        status: 'full_order_scheduled',
        estimatedDate: 'Aug 8, 2026',
      }],
    },
    cart: {
      items: [{
        sku: 'W1212GD-SW',
        productName: 'Wall Cabinet 12"W x 12"H Glass Door Shaker White',
        quantity: 5,
        unit: 'EA',
        unitPrice: 103,
        currency: 'USD',
        formattedUnitPrice: '$103.00',
        lineTotal: 515,
        formattedLineTotal: '$515.00',
        qtyAvailable: 0,
        estimatedDate: 'Aug 8, 2026',
        fulfillmentStatus: 'full_order_scheduled',
      }],
    },
  });

  assert.equal(updated.intent.intent, 'cart_update');
  assert.equal(updated.intent.decisionAction, 'change_qty');
  assert.deepEqual(updated.intent.referencedItems, [1]);
  assert.equal(updated.intent.items[0].quantity, 7);
});

test('order summary direct SKU quantity updates are parsed for every matching line', async () => {
  const understandRequestNode = createUnderstandRequestNode({
    model: {
      withStructuredOutput: () => ({
        invoke: async () => {
          throw new Error('LLM should not be used for direct SKU cart updates');
        },
      }),
    },
  });

  const updated = await understandRequestNode({
    agentPayload: {
      userMessage: 'update AW1242-SW qty 6\nupdate B12-SW qty 6\nupdate B15-SW qty 1\nupdate 3DB33-SW qty 1',
      sessionInfo: { requestId: 'req-summary-edit-sku-1' },
    },
    recentTurns: [],
    pendingDecision: {
      type: 'cart_review',
      items: [
        { itemNumber: 1, sku: 'AW1242-SW', requestedQuantity: 10 },
        { itemNumber: 2, sku: 'B12-SW', requestedQuantity: 10 },
        { itemNumber: 3, sku: 'B15-SW', requestedQuantity: 2 },
        { itemNumber: 4, sku: '3DB33-SW', requestedQuantity: 2 },
      ],
    },
  });

  assert.equal(updated.intent.intent, 'cart_update');
  assert.equal(updated.intent.decisionAction, 'change_qty');
  assert.deepEqual(updated.intent.referencedItems, [1, 2, 3, 4]);
  assert.deepEqual(updated.intent.items.map((item) => [item.skuCandidate, item.quantity]), [
    ['AW1242-SW', 6],
    ['B12-SW', 6],
    ['B15-SW', 1],
    ['3DB33-SW', 1],
  ]);
});

test('cart quantity update replaces existing quantity instead of adding to it', async () => {
  const cartActionNode = createCartActionNode();

  const updated = await cartActionNode({
    agentPayload: {
      sessionInfo: { requestId: 'req-cart-replace-1' },
      metadata: {
        localDateTime: '2026-08-03T22:55:00+05:30',
        localTimeZone: 'Asia/Kolkata',
      },
    },
    intent: {
      intent: 'cart_update',
      decisionAction: 'change_qty',
      referencedItems: [1],
    },
    pendingDecision: {
      type: 'cart_review',
      items: [{
        itemNumber: 1,
        sku: 'W1212GD-SW',
        productName: 'Wall Cabinet 12"W x 12"H Glass Door Shaker White',
        requestedQuantity: 5,
        status: 'full_order_scheduled',
        estimatedDate: 'Aug 8, 2026',
      }],
    },
    cart: {
      items: [{
        sku: 'W1212GD-SW',
        productName: 'Wall Cabinet 12"W x 12"H Glass Door Shaker White',
        quantity: 5,
        unit: 'EA',
        unitPrice: 103,
        currency: 'USD',
        formattedUnitPrice: '$103.00',
        lineTotal: 515,
        formattedLineTotal: '$515.00',
        qtyAvailable: 0,
        estimatedDate: 'Aug 8, 2026',
        fulfillmentStatus: 'full_order_scheduled',
      }],
      currency: 'USD',
    },
    productResults: [{
      status: 'matched',
      requestedItem: { rawReference: 'W1212GD-SW', quantity: 7 },
      matches: [{
        sku: 'W1212GD-SW',
        productName: 'Wall Cabinet 12"W x 12"H Glass Door Shaker White',
        sellingPrice: 103,
        currency: 'USD',
        qtyAvailable: 0,
        unit: 'EA',
        leadTimeDays: 5,
      }],
    }],
  });

  assert.equal(updated.cart.items.length, 1);
  assert.equal(updated.cart.items[0].quantity, 7);
  assert.equal(updated.cart.items[0].lineTotal, 721);
  assert.equal(updated.cartActionResult.changedItems[0].quantity, 7);
  assert.equal(updated.cartActionResult.cartSummary.formattedTotal, '$721.00');
});

test('shorthand cart qty update without change keyword is parsed correctly', async () => {
  const understandRequestNode = createUnderstandRequestNode({
    model: {
      withStructuredOutput: () => ({
        invoke: async () => {
          throw new Error('LLM should not be used for shorthand cart qty updates');
        },
      }),
    },
  });

  const updated = await understandRequestNode({
    agentPayload: {
      userMessage: 'item 4 qty 2 to 4',
      sessionInfo: { requestId: 'req-cart-short-1' },
    },
    recentTurns: [],
    pendingDecision: {
      type: 'cart_review',
      items: [
        { itemNumber: 1, sku: 'W1212GD-SW', requestedQuantity: 2, status: 'full_order_scheduled' },
        { itemNumber: 2, sku: 'W1512GD-SW', requestedQuantity: 2, status: 'full_order_scheduled' },
        { itemNumber: 3, sku: 'W1812GD-SW', requestedQuantity: 2, status: 'full_order_scheduled' },
        { itemNumber: 4, sku: 'W2112GD-SW', requestedQuantity: 2, status: 'full_order_scheduled' },
      ],
    },
  });

  assert.equal(updated.intent.intent, 'cart_update');
  assert.equal(updated.intent.decisionAction, 'change_qty');
  assert.deepEqual(updated.intent.referencedItems, [4]);
  assert.equal(updated.intent.items[0].skuCandidate, 'W2112GD-SW');
  assert.equal(updated.intent.items[0].quantity, 4);
});

test('single suggestion response uses guided option and quantity format', async () => {
  const composeResponseNode = createComposeResponseNode({
    model: {
      invoke: async () => {
        throw new Error('LLM should not be used for single suggestion template');
      },
    },
  });

  const response = await composeResponseNode({
    agentPayload: {
      userMessage: 'Diagonal corner wall cabinet, Shaker White finish, 24"W x 36"H',
      sessionInfo: { requestId: 'req-suggestion-1' },
      metadata: {
        localDateTime: '2026-08-03T17:09:00+05:30',
        localTimeZone: 'Asia/Kolkata',
      },
    },
    intent: { intent: 'product_enquiry' },
    productResults: [{
      status: 'ambiguous',
      requestedItem: { rawReference: 'Diagonal corner wall cabinet, Shaker White finish, 24"W x 36"H', quantity: null },
      matches: [
        {
          sku: 'DCW2436-SW',
          productName: 'Standard Diagonal Corner Wall Cabinet',
          sellingPrice: 547,
          currency: 'USD',
          qtyAvailable: 8,
        },
        {
          sku: 'DCW2436GD-SW',
          productName: 'Diagonal Corner Wall Cabinet with Glass Door',
          sellingPrice: 575,
          currency: 'USD',
          qtyAvailable: 0,
        },
      ],
    }],
    recentTurns: [],
  });

  assert.match(response.reply, /Options:/i);
  assert.match(response.reply, /\*\*Item 1: Diagonal corner wall cabinet/i);
  assert.match(response.reply, /1\. \*\*DCW2436-SW\*\*/i);
  assert.match(response.reply, /2\. \*\*DCW2436GD-SW\*\*/i);
  assert.match(response.reply, /\*\*Description:\*\*/i);
  assert.match(response.reply, /\*\*Category:\*\*/i);
  assert.match(response.reply, /Reply: item 1 option 1 qty 1/i);
  assert.match(response.reply, /Please choose from the options above\./i);
  assert.match(response.reply, /For multiple items, send one selection per line:/i);
  assert.match(response.reply, /^➡️ item 2 option 2 qty 2$/im);
  assert.match(response.reply, /Reply with:/i);
  assert.match(response.reply, /item 1 option 1 qty 1/i);
  assert.doesNotMatch(response.reply, /show more/i);
  assert.match(response.reply, /show cart/i);
});

test('option selection follow-up resolves chosen suggestion sku and quantity', async () => {
  const understandRequestNode = createUnderstandRequestNode({
    model: {
      withStructuredOutput: () => ({
        invoke: async () => {
          throw new Error('LLM should not be used for option follow-up');
        },
      }),
    },
  });

  const result = await understandRequestNode({
    agentPayload: {
      userMessage: 'option 1 2qty',
      sessionInfo: { requestId: 'req-option-1' },
    },
    recentTurns: [],
    pendingDecision: {
      items: [{
        itemNumber: 1,
        requestedReference: 'Diagonal corner wall cabinet, Shaker White finish, 24"W x 36"H',
        status: 'suggestions',
        options: [
          {
            sku: 'DCW2436-SW',
            productName: 'Standard Diagonal Corner Wall Cabinet',
            formattedUnitPrice: '$547.00',
            currentAvailable: 8,
          },
          {
            sku: 'DCW2436GD-SW',
            productName: 'Diagonal Corner Wall Cabinet with Glass Door',
            formattedUnitPrice: '$575.00',
            currentAvailable: 0,
          },
        ],
      }],
    },
  });

  assert.equal(result.intent.intent, 'product_enquiry');
  assert.equal(result.intent.requestMode, 'continue_previous_selection');
  assert.equal(result.intent.decisionAction, 'choose_option');
  assert.equal(result.intent.items.length, 1);
  assert.equal(result.intent.items[0].skuCandidate, 'DCW2436-SW');
  assert.equal(result.intent.items[0].rawReference, 'DCW2436-SW');
  assert.equal(result.intent.items[0].quantity, 2);
});

test('numeric-only option follow-up resolves chosen suggestion sku and quantity', async () => {
  const understandRequestNode = createUnderstandRequestNode({
    model: {
      withStructuredOutput: () => ({
        invoke: async () => {
          throw new Error('LLM should not be used for numeric option follow-up');
        },
      }),
    },
  });

  const result = await understandRequestNode({
    agentPayload: {
      userMessage: '1 2qty',
      sessionInfo: { requestId: 'req-option-2' },
    },
    recentTurns: [],
    pendingDecision: {
      items: [{
        itemNumber: 1,
        requestedReference: 'Diagonal corner wall cabinet, Shaker White finish, 24"W x 36"H',
        status: 'suggestions',
        options: [
          { sku: 'DCW2436-SW', productName: 'Standard Diagonal Corner Wall Cabinet' },
          { sku: 'DCW2436GD-SW', productName: 'Diagonal Corner Wall Cabinet with Glass Door' },
        ],
      }],
    },
  });

  assert.equal(result.intent.decisionAction, 'choose_option');
  assert.equal(result.intent.items[0].skuCandidate, 'DCW2436-SW');
  assert.equal(result.intent.items[0].quantity, 2);
});

test('bare number selects the sole suggestion option and asks for quantity without changing the cart', async () => {
  let invokeCount = 0;
  const understandRequestNode = createUnderstandRequestNode({
    model: {
      withStructuredOutput: () => ({
        invoke: async () => {
          invokeCount += 1;
          return {
            intent: 'cart_update',
            requestMode: 'continue_previous_selection',
            decisionAction: 'change_qty',
            referencedItems: [1],
            items: [{ skuCandidate: 'W1212GD-SW', quantity: 1 }],
            needsClarification: false,
            clarificationQuestion: null,
          };
        },
      }),
    },
  });

  const result = await understandRequestNode({
    agentPayload: {
      userMessage: '1',
      sessionInfo: { requestId: 'req-option-bare-1' },
    },
    recentTurns: [],
    cart: {
      items: [{ sku: 'W1212GD-SW', quantity: 1 }],
    },
    pendingDecision: {
      items: [{
        itemNumber: 1,
        requestedReference: '24inch wall cabnet',
        status: 'suggestions',
        options: [
          { sku: 'W2412GD-SW', productName: 'Wall Cabinet 24 by 12 inch Glass Door' },
          { sku: 'DCW2412GD-SW', productName: 'Diagonal Corner Wall Cabinet' },
          { sku: 'W2418-SW', productName: 'Wall Cabinet 24 by 18 inch' },
        ],
      }],
    },
  });

  assert.equal(invokeCount, 1);
  assert.equal(result.intent.intent, 'product_enquiry');
  assert.equal(result.intent.requestMode, 'continue_previous_selection');
  assert.equal(result.intent.decisionAction, 'none');
  assert.deepEqual(result.intent.referencedItems, [1]);
  assert.equal(result.intent.items[0].skuCandidate, 'W2412GD-SW');
  assert.equal(result.intent.items[0].quantity, null);

  const resolveProductsNode = createResolveProductsNode({
    inventoryTools: {
      findProductsBySkuTool: {
        invoke: async ({ skus }) => skus.map(() => ({
          status: 'matched',
          matches: [{
            sku: 'W2412GD-SW',
            productName: 'Wall Cabinet 24 by 12 inch Glass Door',
            sellingPrice: 100,
            currency: 'USD',
            qtyAvailable: 5,
            unit: 'EA',
            leadTimeDays: 0,
          }],
        })),
      },
      searchProductsTool: { invoke: async () => [] },
    },
  });
  const agentPayload = {
    userMessage: '1',
    sessionInfo: { requestId: 'req-option-bare-1' },
    metadata: {
      localDateTime: '2026-09-09T22:31:00+05:30',
      localTimeZone: 'Asia/Kolkata',
    },
  };
  const resolved = await resolveProductsNode({ agentPayload, intent: result.intent });
  const cartActionNode = createCartActionNode();
  const cartResult = await cartActionNode({
    agentPayload,
    intent: result.intent,
    productResults: resolved.productResults,
    pendingDecision: {
      items: [{
        itemNumber: 1,
        status: 'suggestions',
        options: [{ sku: 'W2412GD-SW' }],
      }],
    },
    cart: {
      items: [{
        sku: 'W1212GD-SW',
        productName: 'Wall Cabinet 12 by 12 inch Glass Door',
        quantity: 1,
        currency: 'USD',
        lineTotal: 46.35,
        formattedLineTotal: '$46.35',
      }],
      currency: 'USD',
    },
  });

  assert.equal(cartResult.cartActionResult, null);
  assert.deepEqual(cartResult.cart.items.map((item) => item.sku), ['W1212GD-SW']);

  const composeResponseNode = createComposeResponseNode({
    model: { invoke: async () => { throw new Error('force deterministic fallback'); } },
  });
  const composed = await composeResponseNode({
    agentPayload,
    intent: result.intent,
    productResults: resolved.productResults,
    cart: cartResult.cart,
    cartActionResult: cartResult.cartActionResult,
    pendingDecision: cartResult.pendingDecision,
    recentTurns: [],
  });

  assert.match(composed.reply, /How many would you like\?/i);
  assert.equal(composed.pendingDecision.items[0].sku, 'W2412GD-SW');
  assert.equal(composed.pendingDecision.items[0].status, 'quantity_missing');
  assert.equal(composed.activePrompt.type, 'provide_quantity');
  assert.equal(composed.activePrompt.expectedReply, 'item_and_quantity');
  assert.equal(composed.stage, 'awaiting_quantity');
});

test('bare option selection carries quantity from the original product request', () => {
  const intent = parseContinuationRequest(
    '3',
    {
      items: [{
        itemNumber: 1,
        requestedReference: 'w3012',
        requestedQuantity: 2,
        status: 'suggestions',
        options: [
          { sku: 'W3012GD-SW', productName: 'Wall Cabinet 30x12 Glass Door' },
          { sku: 'W3012-SW', productName: 'Wall Cabinet 30x12' },
          { sku: 'W301224-SW', productName: 'Deep Wall Cabinet 30x12x24' },
        ],
      }],
    },
    { type: 'select_option', itemNumbers: [1] },
  );

  assert.equal(intent.intent, 'cart_add');
  assert.equal(intent.decisionAction, 'add');
  assert.equal(intent.items[0].skuCandidate, 'W301224-SW');
  assert.equal(intent.items[0].quantity, 2);
});

test('natural quantity survives ambiguous search and bare option selection', async () => {
  const understandRequestNode = createUnderstandRequestNode({
    model: {
      withStructuredOutput: () => ({
        invoke: async () => ({
          intent: 'product_enquiry',
          requestMode: 'fresh_search',
          decisionAction: 'none',
          referencedItems: [],
          removeReferencedItems: [],
          clearCartConfirmed: false,
          items: [{
            rawReference: '3012',
            skuCandidate: '3012',
            quantity: null,
            unit: null,
            description: null,
            dimensions: null,
          }],
          needsClarification: false,
          clarificationQuestion: null,
        }),
      }),
    },
  });
  const agentPayload = {
    userMessage: 'i need three of 3012',
    sessionInfo: { requestId: 'req-natural-suggestion-quantity' },
  };
  const understood = await understandRequestNode({
    agentPayload,
    recentTurns: [],
    pendingDecision: null,
  });

  assert.equal(understood.intent.items[0].quantity, 3);

  const matches = [
    { sku: 'W3012GD-SW', productName: 'Wall Cabinet 30x12 Glass Door', sellingPrice: 100, currency: 'USD' },
    { sku: 'W3012-SW', productName: 'Wall Cabinet 30x12', sellingPrice: 110, currency: 'USD' },
    { sku: 'W301224-SW', productName: 'Deep Wall Cabinet 30x12x24', sellingPrice: 120, currency: 'USD' },
  ];
  const composeResponseNode = createComposeResponseNode({
    model: { invoke: async () => { throw new Error('suggestion response must be deterministic'); } },
  });
  const composed = await composeResponseNode({
    agentPayload,
    intent: understood.intent,
    productResults: [{
      status: 'matched',
      requestedItem: understood.intent.items[0],
      matches,
    }],
    recentTurns: [],
  });

  assert.equal(composed.pendingDecision.items[0].requestedQuantity, 3);
  assert.match(composed.reply, /item 1 option 1 qty 3/i);

  const selected = parseContinuationRequest(
    '3',
    composed.pendingDecision,
    composed.activePrompt,
  );
  assert.equal(selected.intent, 'cart_add');
  assert.equal(selected.items[0].skuCandidate, 'W301224-SW');
  assert.equal(selected.items[0].quantity, 3);
});

test('workflow state distinguishes option selection, quantity entry, and cart review', () => {
  const optionDecision = {
    items: [{
      itemNumber: 1,
      status: 'suggestions',
      options: [{ sku: 'W2412GD-SW' }, { sku: 'W2418-SW' }],
    }],
  };
  const optionPrompt = deriveActivePrompt({ pendingDecision: optionDecision });
  assert.equal(optionPrompt.type, 'select_option');
  assert.equal(optionPrompt.expectedReply, 'item_and_option_number');
  assert.equal(deriveWorkflowStage({ pendingDecision: optionDecision, activePrompt: optionPrompt }), 'awaiting_option_selection');

  const quantityDecision = {
    items: [{ itemNumber: 1, status: 'quantity_missing', sku: 'W2412GD-SW' }],
  };
  const quantityPrompt = deriveActivePrompt({ pendingDecision: quantityDecision });
  assert.equal(quantityPrompt.type, 'provide_quantity');
  assert.equal(deriveWorkflowStage({ pendingDecision: quantityDecision, activePrompt: quantityPrompt }), 'awaiting_quantity');

  const cartDecision = {
    type: 'cart_review',
    items: [{ itemNumber: 1, status: 'ready_now', sku: 'W1212GD-SW' }],
  };
  const cartPrompt = deriveActivePrompt({ pendingDecision: cartDecision });
  assert.equal(cartPrompt.type, 'cart_action');
  assert.equal(deriveWorkflowStage({ pendingDecision: cartDecision, activePrompt: cartPrompt }), 'reviewing_cart');

  const mixedDecision = {
    items: [
      { itemNumber: 1, status: 'quantity_missing', sku: 'W1212GD-SW' },
      { itemNumber: 2, status: 'suggestions', options: [{ sku: 'W2412GD-SW' }] },
    ],
  };
  const mixedPrompt = deriveActivePrompt({ pendingDecision: mixedDecision });
  assert.equal(mixedPrompt.type, 'resolve_items');
  assert.deepEqual(mixedPrompt.requirements.map((item) => item.type), ['select_option', 'provide_quantity']);
  assert.equal(deriveWorkflowStage({ pendingDecision: mixedDecision, activePrompt: mixedPrompt }), 'awaiting_item_resolution');
});

test('spoken option follow-up resolves chosen suggestion sku and quantity', async () => {
  const understandRequestNode = createUnderstandRequestNode({
    model: {
      withStructuredOutput: () => ({
        invoke: async () => {
          throw new Error('LLM should not be used for spoken option follow-up');
        },
      }),
    },
  });

  const result = await understandRequestNode({
    agentPayload: {
      userMessage: 'first one 2',
      sessionInfo: { requestId: 'req-option-3' },
    },
    recentTurns: [],
    pendingDecision: {
      items: [{
        itemNumber: 1,
        requestedReference: 'Diagonal corner wall cabinet, Shaker White finish, 24"W x 36"H',
        status: 'suggestions',
        options: [
          { sku: 'DCW2436-SW', productName: 'Standard Diagonal Corner Wall Cabinet' },
          { sku: 'DCW2436GD-SW', productName: 'Diagonal Corner Wall Cabinet with Glass Door' },
        ],
      }],
    },
  });

  assert.equal(result.intent.decisionAction, 'choose_option');
  assert.equal(result.intent.items[0].skuCandidate, 'DCW2436-SW');
  assert.equal(result.intent.items[0].quantity, 2);
});

test('go-with option follow-up resolves chosen suggestion sku and quantity', async () => {
  const understandRequestNode = createUnderstandRequestNode({
    model: {
      withStructuredOutput: () => ({
        invoke: async () => {
          throw new Error('LLM should not be used for go-with option follow-up');
        },
      }),
    },
  });

  const result = await understandRequestNode({
    agentPayload: {
      userMessage: 'go with option 1 qty 2',
      sessionInfo: { requestId: 'req-option-4' },
    },
    recentTurns: [],
    pendingDecision: {
      items: [{
        itemNumber: 1,
        requestedReference: 'Diagonal corner wall cabinet, Shaker White finish, 24"W x 36"H',
        status: 'suggestions',
        options: [
          { sku: 'DCW2436-SW', productName: 'Standard Diagonal Corner Wall Cabinet' },
          { sku: 'DCW2436GD-SW', productName: 'Diagonal Corner Wall Cabinet with Glass Door' },
        ],
      }],
    },
  });

  assert.equal(result.intent.decisionAction, 'choose_option');
  assert.equal(result.intent.items[0].skuCandidate, 'DCW2436-SW');
  assert.equal(result.intent.items[0].quantity, 2);
});

test('quantity-of-ordinal option phrase adds the selected option with its stated quantity', () => {
  const intent = parseContinuationRequest(
    'add 2 of 2nd option',
    {
      items: [{
        itemNumber: 1,
        requestedReference: 'w303',
        status: 'suggestions',
        options: [
          { sku: 'W3030GD-SW', productName: 'Wall Cabinet 30x30 Glass Door' },
          { sku: 'W3030-SW', productName: 'Wall Cabinet 30x30' },
          { sku: 'W3036GD-SW', productName: 'Wall Cabinet 30x36 Glass Door' },
        ],
      }],
    },
    { type: 'select_option', itemNumbers: [1] },
  );

  assert.equal(intent.intent, 'cart_add');
  assert.equal(intent.decisionAction, 'add');
  assert.deepEqual(intent.referencedItems, [1]);
  assert.equal(intent.items[0].skuCandidate, 'W3030-SW');
  assert.equal(intent.items[0].quantity, 2);
});

test('item-first option follow-up stays in continuation flow for extracted-file suggestions', async () => {
  const understandRequestNode = createUnderstandRequestNode({
    model: {
      withStructuredOutput: () => ({
        invoke: async () => {
          throw new Error('LLM should not be used for item-first option follow-up');
        },
      }),
    },
  });

  const result = await understandRequestNode({
    agentPayload: {
      userMessage: '1 option 1 qty',
      sessionInfo: { requestId: 'req-option-5' },
    },
    recentTurns: [],
    pendingDecision: {
      source: 'extracted_file',
      items: [
        {
          itemNumber: 1,
          requestedReference: '24x36 wall cabinet',
          status: 'suggestions',
          options: [
            { sku: 'W2436-SW', productName: 'Wall Cabinet 24"W x 36"H Shaker White' },
            { sku: 'W2436GD-SW', productName: 'Wall Cabinet 24"W x 36"H Glass Door Shaker White' },
          ],
        },
        {
          itemNumber: 2,
          requestedReference: '21x36 wall cabinet',
          status: 'suggestions',
          options: [
            { sku: 'W2136-SW', productName: 'Wall Cabinet 21"W x 36"H Shaker White' },
          ],
        },
      ],
    },
  });

  assert.equal(result.intent.intent, 'product_enquiry');
  assert.equal(result.intent.requestMode, 'continue_previous_selection');
  assert.equal(result.intent.decisionAction, 'choose_option');
  assert.deepEqual(result.intent.referencedItems, [1]);
  assert.equal(result.intent.items.length, 1);
  assert.equal(result.intent.items[0].skuCandidate, 'W2436-SW');
});

test('cart action node can remove one item and add a new sku in the same turn', async () => {
  const cartActionNode = createCartActionNode();

  const result = await cartActionNode({
    agentPayload: {
      sessionInfo: { requestId: 'req-cart-mixed-1' },
      metadata: {
        localDateTime: '2026-08-03T12:00:00+05:30',
        localTimeZone: 'Asia/Kolkata',
      },
    },
    intent: {
      intent: 'cart_update',
      removeReferencedItems: [1],
    },
    pendingDecision: {
      items: [
        { itemNumber: 1, sku: 'B42-SW' },
        { itemNumber: 2, sku: '3DB36-SW' },
      ],
    },
    cart: {
      items: [
        {
          sku: 'B42-SW',
          productName: 'Base Cabinet 42"W Shaker White',
          quantity: 4,
          currency: 'USD',
          lineTotal: 3312,
          formattedLineTotal: '$3,312.00',
          qtyAvailable: 4,
          fulfillmentStatus: 'ready_now',
        },
        {
          sku: '3DB36-SW',
          productName: '3 Drawer Base Cabinet 36"W Shaker White',
          quantity: 2,
          currency: 'USD',
          lineTotal: 1760,
          formattedLineTotal: '$1,760.00',
          qtyAvailable: 2,
          fulfillmentStatus: 'ready_now',
        },
      ],
      currency: 'USD',
    },
    productResults: [{
      status: 'matched',
      requestedItem: { rawReference: 'WBC2736-SW', quantity: 2 },
      matches: [{
        sku: 'WBC2736-SW',
        productName: 'Blind Corner Wall Cabinet',
        sellingPrice: 387,
        currency: 'USD',
        qtyAvailable: 2,
        unit: 'EA',
        leadTimeDays: 0,
      }],
    }],
  });

  assert.equal(result.cart.items.length, 2);
  assert.equal(result.cart.items.some((item) => item.sku === 'B42-SW'), false);
  assert.equal(result.cart.items.some((item) => item.sku === 'WBC2736-SW'), true);
  assert.equal(result.cartActionResult.message, 'I updated your cart.');
});

test('clear cart requires confirmation before emptying the cart', async () => {
  const cartActionNode = createCartActionNode();

  const confirmation = await cartActionNode({
    agentPayload: {
      sessionInfo: { requestId: 'req-cart-clear-1' },
      metadata: {
        localDateTime: '2026-08-03T12:00:00+05:30',
        localTimeZone: 'Asia/Kolkata',
      },
    },
    intent: {
      intent: 'cart_remove',
      decisionAction: 'clear_cart',
      clearCartConfirmed: false,
    },
    cart: {
      items: [
        {
          sku: 'B42-SW',
          productName: 'Base Cabinet 42"W Shaker White',
          quantity: 4,
          currency: 'USD',
          lineTotal: 3312,
          formattedLineTotal: '$3,312.00',
          qtyAvailable: 4,
          fulfillmentStatus: 'ready_now',
        },
      ],
      currency: 'USD',
    },
  });

  assert.equal(confirmation.cart.items.length, 1);
  assert.equal(confirmation.cartActionResult.type, 'cart_clear_confirmation');
  assert.equal(confirmation.pendingCartActionConfirmation.action, 'clear_cart');

  const cleared = await cartActionNode({
    agentPayload: {
      sessionInfo: { requestId: 'req-cart-clear-2' },
      metadata: {
        localDateTime: '2026-08-03T12:00:00+05:30',
        localTimeZone: 'Asia/Kolkata',
      },
    },
    intent: {
      intent: 'cart_remove',
      decisionAction: 'confirm_clear_cart',
      clearCartConfirmed: true,
    },
    cart: confirmation.cart,
    pendingCartActionConfirmation: confirmation.pendingCartActionConfirmation,
  });

  assert.equal(cleared.cart.items.length, 0);
  assert.equal(cleared.cartActionResult.type, 'cart_clear');
  assert.equal(cleared.pendingCartActionConfirmation, null);
});

test('resolve products merges repeated identical SKU requests into one quantity', async () => {
  const resolveProductsNode = createResolveProductsNode({
    inventoryTools: {
      findProductsBySkuTool: {
        invoke: async ({ skus }) => skus.map(() => ({
          status: 'matched',
          matches: [{
            sku: 'W0942-SW',
            productName: 'Wall Cabinet',
            sellingPrice: 240,
            currency: 'USD',
            qtyAvailable: 5,
            unit: 'EA',
            leadTimeDays: 4,
          }],
        })),
      },
      searchProductsTool: {
        invoke: async () => [],
      },
    },
  });

  const result = await resolveProductsNode({
    agentPayload: {
      sessionInfo: { requestId: 'req-merge-1' },
    },
    intent: {
      intent: 'product_enquiry',
      items: [
        { rawReference: 'W0942-sw', skuCandidate: 'W0942-sw', quantity: 2, unit: 'pieces', description: 'W0942-sw', dimensions: null },
        { rawReference: 'W0942-sw', skuCandidate: 'W0942-sw', quantity: 3, unit: 'nos', description: 'W0942-sw', dimensions: null },
        { rawReference: 'W0942-sw', skuCandidate: 'W0942-sw', quantity: 5, unit: 'qty', description: 'W0942-sw', dimensions: null },
      ],
    },
  });

  assert.equal(result.productResults.length, 1);
  assert.equal(result.productResults[0].requestedItem.quantity, 10);
  assert.equal(result.productResults[0].requestedItem.skuCandidate, 'W0942-sw');
});

test('resolve products ignores empty duplicate SKU lines when another repeated line has quantity', async () => {
  const resolveProductsNode = createResolveProductsNode({
    inventoryTools: {
      findProductsBySkuTool: {
        invoke: async ({ skus }) => skus.map(() => ({
          status: 'matched',
          matches: [{
            sku: 'W0942-SW',
            productName: 'Wall Cabinet',
            sellingPrice: 240,
            currency: 'USD',
            qtyAvailable: 5,
            unit: 'EA',
            leadTimeDays: 4,
          }],
        })),
      },
      searchProductsTool: {
        invoke: async () => [],
      },
    },
  });

  const result = await resolveProductsNode({
    agentPayload: {
      sessionInfo: { requestId: 'req-merge-2' },
    },
    intent: {
      intent: 'product_enquiry',
      items: [
        { rawReference: 'W0942-sw', skuCandidate: 'W0942-sw', quantity: null, unit: null, description: 'W0942-sw', dimensions: null },
        { rawReference: 'W0942-sw', skuCandidate: 'W0942-sw', quantity: 3, unit: 'nos', description: 'W0942-sw', dimensions: null },
      ],
    },
  });

  assert.equal(result.productResults.length, 1);
  assert.equal(result.productResults[0].requestedItem.quantity, 3);
});

test('resolve products keeps one repeated SKU unresolved when all duplicate lines miss quantity', async () => {
  const resolveProductsNode = createResolveProductsNode({
    inventoryTools: {
      findProductsBySkuTool: {
        invoke: async ({ skus }) => skus.map(() => ({
          status: 'matched',
          matches: [{
            sku: 'W0942-SW',
            productName: 'Wall Cabinet',
            sellingPrice: 240,
            currency: 'USD',
            qtyAvailable: 5,
            unit: 'EA',
            leadTimeDays: 4,
          }],
        })),
      },
      searchProductsTool: {
        invoke: async () => [],
      },
    },
  });

  const result = await resolveProductsNode({
    agentPayload: {
      sessionInfo: { requestId: 'req-merge-3' },
    },
    intent: {
      intent: 'product_enquiry',
      items: [
        { rawReference: 'W0942-sw', skuCandidate: 'W0942-sw', quantity: null, unit: null, description: 'W0942-sw', dimensions: null },
        { rawReference: 'W0942-sw', skuCandidate: 'W0942-sw', quantity: null, unit: null, description: 'W0942-sw', dimensions: null },
      ],
    },
  });

  assert.equal(result.productResults.length, 1);
  assert.equal(result.productResults[0].requestedItem.quantity, null);
});

test('resolve products strips zero dimensions before descriptive search tool validation', async () => {
  let capturedSearches = null;
  const resolveProductsNode = createResolveProductsNode({
    inventoryTools: {
      findProductsBySkuTool: {
        invoke: async () => [],
      },
      searchProductsTool: {
        invoke: async ({ searches }) => {
          capturedSearches = searches;
          return searches.map((search, index) => ({
            searchId: search.searchId || String(index),
            rawReference: search.rawReference,
            status: 'unmatched',
            matchType: 'description',
            matches: [],
          }));
        },
      },
    },
  });

  await resolveProductsNode({
    agentPayload: {
      sessionInfo: { requestId: 'req-zero-dim-1' },
    },
    intent: {
      intent: 'product_enquiry',
      items: [
        {
          rawReference: 'Tall pantry cabinet',
          skuCandidate: null,
          quantity: 1,
          unit: null,
          description: 'Tall pantry cabinet',
          dimensions: { width: 18, height: 0, depth: 0 },
        },
        {
          rawReference: 'Wall cabinet',
          skuCandidate: null,
          quantity: 2,
          unit: null,
          description: 'Wall cabinet',
          dimensions: { width: 0, height: 30, depth: 0 },
        },
      ],
    },
  });

  assert.equal(capturedSearches.length, 2);
  assert.deepEqual(capturedSearches[0].dimensions, { width: 18, height: null, depth: null });
  assert.deepEqual(capturedSearches[1].dimensions, { width: null, height: 30, depth: null });
});

test('fresh SKU-only message is normalized from cart_add to product_enquiry', async () => {
  const understandRequestNode = createUnderstandRequestNode({
    model: {
      withStructuredOutput: () => ({
        invoke: async () => ({
          intent: 'cart_add',
          requestMode: 'fresh_search',
          decisionAction: 'add',
          referencedItems: [],
          items: [{
            rawReference: 'WBC3630',
            skuCandidate: 'WBC3630',
            quantity: 1,
            unit: null,
            description: 'WBC3630',
            dimensions: null,
          }],
          needsClarification: false,
          clarificationQuestion: null,
        }),
      }),
    },
  });

  const result = await understandRequestNode({
    agentPayload: {
      userMessage: 'WBC3630',
      sessionInfo: { requestId: 'req-intent-1' },
    },
    recentTurns: [],
    pendingDecision: null,
  });

  assert.equal(result.intent.intent, 'product_enquiry');
  assert.equal(result.intent.decisionAction, 'none');
  assert.equal(result.intent.requestMode, 'fresh_search');
  assert.equal(result.intent.items[0].skuCandidate, 'WBC3630');
  assert.equal(result.intent.items[0].quantity, null);
});

test('explicit add language keeps fresh cart_add intent', async () => {
  const understandRequestNode = createUnderstandRequestNode({
    model: {
      withStructuredOutput: () => ({
        invoke: async () => ({
          intent: 'cart_add',
          requestMode: 'fresh_search',
          decisionAction: 'add',
          referencedItems: [],
          items: [{
            rawReference: 'WBC3630',
            skuCandidate: 'WBC3630',
            quantity: 1,
            unit: null,
            description: 'WBC3630',
            dimensions: null,
          }],
          needsClarification: false,
          clarificationQuestion: null,
        }),
      }),
    },
  });

  const result = await understandRequestNode({
    agentPayload: {
      userMessage: 'add WBC3630',
      sessionInfo: { requestId: 'req-intent-2' },
    },
    recentTurns: [],
    pendingDecision: null,
  });

  assert.equal(result.intent.intent, 'cart_add');
  assert.equal(result.intent.decisionAction, 'add');
});

test('fresh descriptive request can keep explicit quantity while remaining enquiry', async () => {
  const understandRequestNode = createUnderstandRequestNode({
    model: {
      withStructuredOutput: () => ({
        invoke: async () => ({
          intent: 'cart_add',
          requestMode: 'fresh_search',
          decisionAction: 'add',
          referencedItems: [],
          items: [{
            rawReference: 'wall cabinet 12 inch qty 2',
            skuCandidate: null,
            quantity: 2,
            unit: null,
            description: 'wall cabinet 12 inch',
            dimensions: null,
          }],
          needsClarification: false,
          clarificationQuestion: null,
        }),
      }),
    },
  });

  const result = await understandRequestNode({
    agentPayload: {
      userMessage: 'wall cabinet 12 inch qty 2',
      sessionInfo: { requestId: 'req-intent-3' },
    },
    recentTurns: [],
    pendingDecision: null,
  });

  assert.equal(result.intent.intent, 'product_enquiry');
  assert.equal(result.intent.items[0].quantity, 2);
});

test('fresh dimension description overrides stale cart continuation and does not treat inches as quantity', async () => {
  const understandRequestNode = createUnderstandRequestNode({
    model: {
      withStructuredOutput: () => ({
        invoke: async () => ({
          intent: 'product_enquiry',
          requestMode: 'continue_previous_selection',
          decisionAction: 'choose_option',
          referencedItems: [],
          items: [{
            rawReference: '24inch wall cabnet',
            skuCandidate: '24inch',
            quantity: 24,
            unit: null,
            description: '24inch wall cabnet',
            dimensions: { width: 24, height: null, depth: null },
          }],
          needsClarification: false,
          clarificationQuestion: null,
        }),
      }),
    },
  });

  const result = await understandRequestNode({
    agentPayload: {
      userMessage: 'i want 24inch wall cabnet',
      sessionInfo: { requestId: 'req-fresh-dimension-1' },
    },
    recentTurns: [],
    pendingDecision: {
      type: 'cart_review',
      items: [{ itemNumber: 1, sku: 'W1212GD-SW', requestedQuantity: 1, status: 'ready_now' }],
    },
    activePrompt: {
      type: 'cart_action',
      expectedReply: 'cart_command',
      itemNumbers: [1],
    },
  });

  assert.equal(result.intent.intent, 'product_enquiry');
  assert.equal(result.intent.requestMode, 'fresh_search');
  assert.equal(result.intent.decisionAction, 'none');
  assert.deepEqual(result.intent.referencedItems, []);
  assert.equal(result.intent.items[0].quantity, null);
});

test('cart action ignores suggestion-only product results instead of emitting a false cart update', async () => {
  const cartActionNode = createCartActionNode();
  const pendingDecision = {
    type: 'cart_review',
    items: [{ itemNumber: 1, sku: 'W1212GD-SW', requestedQuantity: 1, status: 'ready_now' }],
  };
  const result = await cartActionNode({
    agentPayload: {
      sessionInfo: { requestId: 'req-fresh-dimension-2' },
      metadata: {},
    },
    intent: {
      intent: 'product_enquiry',
      decisionAction: 'choose_option',
      items: [{ rawReference: '24inch wall cabnet', quantity: null }],
    },
    pendingDecision,
    cart: {
      items: [{ sku: 'W1212GD-SW', quantity: 1, currency: 'USD', lineTotal: 46.35 }],
      currency: 'USD',
    },
    productResults: [{
      status: 'suggestions',
      requestedItem: { rawReference: '24inch wall cabnet', quantity: null },
      matches: [{ sku: 'W2412GD-SW' }, { sku: 'W2418-SW' }],
    }],
  });

  assert.equal(result.cartActionResult, null);
  assert.equal(result.pendingDecision, pendingDecision);
  assert.deepEqual(result.cart.items.map((item) => item.sku), ['W1212GD-SW']);
});

test('zero quantity in a fresh multi-item request is sanitized instead of failing the whole flow', async () => {
  const understandRequestNode = createUnderstandRequestNode({
    model: {
      withStructuredOutput: () => ({
        invoke: async () => ({
          intent: 'cart_add',
          requestMode: 'fresh_search',
          decisionAction: 'add',
          referencedItems: [],
          items: [
            {
              rawReference: 'W1212GD-SW',
              skuCandidate: 'W1212GD-SW',
              quantity: 15,
              unit: null,
              description: 'W1212GD-SW',
              dimensions: null,
            },
            {
              rawReference: 'W1512GD-SW',
              skuCandidate: 'W1512GD-SW',
              quantity: 0,
              unit: null,
              description: 'W1512GD-SW',
              dimensions: null,
            },
          ],
          needsClarification: false,
          clarificationQuestion: null,
        }),
      }),
    },
  });

  const result = await understandRequestNode({
    agentPayload: {
      userMessage: 'W1212GD-SW qty 15\nW1512GD-SW qty 0',
      sessionInfo: { requestId: 'req-intent-zero-1' },
    },
    recentTurns: [],
    pendingDecision: null,
  });

  assert.equal(result.intent.intent, 'product_enquiry');
  assert.equal(result.intent.items.length, 2);
  assert.equal(result.intent.items[0].quantity, 15);
  assert.equal(result.intent.items[1].quantity, null);
  assert.equal(result.intent.needsClarification, true);
  assert.match(result.intent.clarificationQuestion, /quantity greater than 0/i);
});

test('single quantity reply continues the last quantity-missing product request', async () => {
  const understandRequestNode = createUnderstandRequestNode({
    model: {
      withStructuredOutput: () => ({
        invoke: async () => {
          throw new Error('LLM should not be used for single quantity follow-up');
        },
      }),
    },
  });

  const result = await understandRequestNode({
    agentPayload: {
      userMessage: '5',
      sessionInfo: { requestId: 'req-qty-followup-1' },
    },
    recentTurns: [],
    pendingDecision: {
      items: [{
        itemNumber: 1,
        sku: 'W1212GD-SW',
        productName: 'Wall Cabinet 12"W x 12"H Glass Door Shaker White',
        requestedReference: 'w1212gdsw',
        requestedQuantity: null,
        status: 'quantity_missing',
      }],
    },
  });

  assert.equal(result.intent.intent, 'product_enquiry');
  assert.equal(result.intent.requestMode, 'continue_previous_selection');
  assert.equal(result.intent.decisionAction, 'add');
  assert.equal(result.intent.items.length, 1);
  assert.equal(result.intent.items[0].skuCandidate, 'W1212GD-SW');
  assert.equal(result.intent.items[0].quantity, 5);
});

test('invalid quantity reply explains the rejection and re-asks for quantity', () => {
  const intent = parseContinuationRequest(
    '3@',
    {
      items: [{
        itemNumber: 1,
        sku: 'W2412GD-SW',
        productName: 'Wall Cabinet 24"W x 12"H Glass Door Shaker White',
        requestedReference: 'w2412gdsw',
        requestedQuantity: null,
        status: 'quantity_missing',
      }],
    },
  );

  assert.equal(intent.intent, 'unclear');
  assert.equal(intent.decisionAction, 'ask_more');
  assert.deepEqual(intent.referencedItems, [1]);
  assert.equal(intent.needsClarification, true);
  assert.match(intent.clarificationQuestion, /couldn't use "3@"/i);
  assert.match(intent.clarificationQuestion, /digits only/i);
  assert.match(intent.clarificationQuestion, /how many would you like\?/i);
});

test('understand request resolves invalid quantity reply locally without using the llm', async () => {
  const understandRequestNode = createUnderstandRequestNode({
    model: {
      withStructuredOutput: () => ({
        invoke: async () => {
          throw new Error('LLM should not be used for invalid quantity follow-up');
        },
      }),
    },
  });

  const result = await understandRequestNode({
    agentPayload: {
      userMessage: '3/',
      sessionInfo: { requestId: 'req-qty-invalid-1' },
    },
    recentTurns: [],
    pendingDecision: {
      items: [{
        itemNumber: 1,
        sku: 'W2412GD-SW',
        productName: 'Wall Cabinet 24"W x 12"H Glass Door Shaker White',
        requestedReference: 'w2412gdsw',
        requestedQuantity: null,
        status: 'quantity_missing',
      }],
    },
  });

  assert.equal(result.intent.intent, 'unclear');
  assert.equal(result.intent.needsClarification, true);
  assert.match(result.intent.clarificationQuestion, /couldn't use "3\/"/i);
  assert.match(result.intent.clarificationQuestion, /digits only/i);
});

test('fresh numbered multi-item message is not mistaken for existing cart item numbers', async () => {
  let invokeCount = 0;
  const understandRequestNode = createUnderstandRequestNode({
    model: {
      withStructuredOutput: () => ({
        invoke: async () => {
          invokeCount += 1;
          return {
            intent: 'product_enquiry',
            requestMode: 'fresh_search',
            decisionAction: 'none',
            referencedItems: [],
            items: [
              {
                rawReference: 'OE630-SW',
                skuCandidate: 'OE630-SW',
                quantity: 2,
                unit: null,
                description: 'OE630-SW',
                dimensions: null,
              },
              {
                rawReference: 'DCW2436-SW',
                skuCandidate: 'DCW2436-SW',
                quantity: 2,
                unit: null,
                description: 'DCW2436-SW',
                dimensions: null,
              },
              {
                rawReference: 'U309024-SW',
                skuCandidate: 'U309024-SW',
                quantity: 5,
                unit: null,
                description: 'U309024-SW',
                dimensions: null,
              },
            ],
            needsClarification: false,
            clarificationQuestion: null,
          };
        },
      }),
    },
  });

  const result = await understandRequestNode({
    agentPayload: {
      userMessage: '1. OE630-SW qty 2\n2. DCW2436-SW qty 2\n3. U309024-SW qty 5',
      sessionInfo: { requestId: 'req-multi-fresh-1' },
    },
    recentTurns: [],
    pendingDecision: {
      items: [
        { itemNumber: 1, sku: 'OE630-SW', requestedQuantity: 2, status: 'ready_now' },
        { itemNumber: 2, sku: 'DCW2436-SW', requestedQuantity: 2, status: 'ready_now' },
        { itemNumber: 3, sku: 'U309024-SW', requestedQuantity: 5, status: 'full_order_scheduled' },
      ],
    },
  });

  assert.equal(invokeCount, 0);
  assert.equal(result.intent.requestMode, 'fresh_search');
  assert.equal(result.intent.items.length, 3);
  assert.equal(result.intent.items[2].skuCandidate, 'U309024-SW');
  assert.equal(result.intent.items[2].quantity, 5);
});

test('show carts is interpreted as cart view', async () => {
  const understandRequestNode = createUnderstandRequestNode({
    model: {
      withStructuredOutput: () => ({
        invoke: async () => {
          throw new Error('LLM should not be used for show carts');
        },
      }),
    },
  });

  const result = await understandRequestNode({
    agentPayload: {
      userMessage: 'show carts',
      sessionInfo: { requestId: 'req-cart-1' },
    },
    recentTurns: [],
    pendingDecision: {
      items: [
        { itemNumber: 1, sku: 'WBC3630-SW', requestedQuantity: 3, status: 'full_order_scheduled' },
      ],
    },
  });

  assert.equal(result.intent.intent, 'cart_view');
});

test('fresh sku add message is not hijacked into cart view when cart memory exists', async () => {
  let invokeCount = 0;
  const understandRequestNode = createUnderstandRequestNode({
    model: {
      withStructuredOutput: () => ({
        invoke: async () => {
          invokeCount += 1;
          return {
            intent: 'product_enquiry',
            requestMode: 'fresh_search',
            decisionAction: 'none',
            referencedItems: [],
            items: [{
              rawReference: 'WBC2736-SW',
              skuCandidate: 'WBC2736-SW',
              quantity: 2,
              unit: null,
              description: 'WBC2736-SW',
              dimensions: null,
            }],
            needsClarification: false,
            clarificationQuestion: null,
          };
        },
      }),
    },
  });

  const result = await understandRequestNode({
    agentPayload: {
      userMessage: 'WBC2736-SW i need to add cart 2 qty',
      sessionInfo: { requestId: 'req-cart-2' },
    },
    recentTurns: [],
    pendingDecision: {
      items: [
        { itemNumber: 1, sku: 'WBC3630-SW', requestedQuantity: 3, status: 'full_order_scheduled' },
      ],
    },
  });

  assert.equal(invokeCount, 1);
  assert.equal(result.intent.intent, 'product_enquiry');
  assert.equal(result.intent.items[0].skuCandidate, 'WBC2736-SW');
  assert.equal(result.intent.items[0].quantity, 2);
});

test('bare fresh sku remains enquiry even when cart review memory exists', async () => {
  const understandRequestNode = createUnderstandRequestNode({
    model: {
      withStructuredOutput: () => ({
        invoke: async () => ({
          intent: 'cart_add',
          requestMode: 'fresh_search',
          decisionAction: 'add',
          referencedItems: [],
          items: [{
            rawReference: 'F342-SW',
            skuCandidate: 'F342-SW',
            quantity: 1,
            unit: null,
            description: 'F342-SW',
            dimensions: null,
          }],
          needsClarification: false,
          clarificationQuestion: null,
        }),
      }),
    },
  });

  const result = await understandRequestNode({
    agentPayload: {
      userMessage: 'F342-SW',
      sessionInfo: { requestId: 'req-cart-3' },
    },
    recentTurns: [],
    pendingDecision: {
      items: [
        { itemNumber: 1, sku: '3VDB15-SW', requestedQuantity: 4, status: 'ready_now' },
      ],
    },
  });

  assert.equal(result.intent.intent, 'product_enquiry');
  assert.equal(result.intent.decisionAction, 'none');
  assert.equal(result.intent.items[0].skuCandidate, 'F342-SW');
  assert.equal(result.intent.items[0].quantity, null);
});

test('natural order language preserves an LLM-extracted number-word quantity', async () => {
  const understandRequestNode = createUnderstandRequestNode({
    model: {
      withStructuredOutput: () => ({
        invoke: async () => ({
          intent: 'cart_add',
          requestMode: 'fresh_search',
          decisionAction: 'add',
          referencedItems: [],
          items: [{
            rawReference: 'w1212gd',
            skuCandidate: 'W1212GD',
            quantity: 1,
            unit: null,
            description: 'w1212gd',
            dimensions: null,
          }],
          needsClarification: false,
          clarificationQuestion: null,
        }),
      }),
    },
  });

  const result = await understandRequestNode({
    agentPayload: {
      userMessage: 'i want one w1212gd',
      sessionInfo: { requestId: 'req-natural-qty-1' },
    },
    recentTurns: [],
    pendingDecision: null,
  });

  assert.equal(result.intent.intent, 'cart_add');
  assert.equal(result.intent.decisionAction, 'add');
  assert.equal(result.intent.items[0].skuCandidate, 'W1212GD');
  assert.equal(result.intent.items[0].quantity, 1);
});

test('natural number-word quantity fills a missing LLM quantity for one ordered item', async () => {
  const understandRequestNode = createUnderstandRequestNode({
    model: {
      withStructuredOutput: () => ({
        invoke: async () => ({
          intent: 'cart_add',
          requestMode: 'fresh_search',
          decisionAction: 'add',
          referencedItems: [],
          items: [{
            rawReference: 'w1212gd',
            skuCandidate: 'W1212GD',
            quantity: null,
            unit: null,
            description: 'w1212gd',
            dimensions: null,
          }],
          needsClarification: false,
          clarificationQuestion: null,
        }),
      }),
    },
  });

  const result = await understandRequestNode({
    agentPayload: {
      userMessage: 'give me two w1212gd',
      sessionInfo: { requestId: 'req-natural-qty-2' },
    },
    recentTurns: [],
    pendingDecision: null,
  });

  assert.equal(result.intent.intent, 'cart_add');
  assert.equal(result.intent.items[0].quantity, 2);
});

test('eo-like bare sku flow asks for quantity instead of auto-adding to cart', async () => {
  const understandRequestNode = createUnderstandRequestNode({
    model: {
      withStructuredOutput: () => ({
        invoke: async () => ({
          intent: 'cart_add',
          requestMode: 'fresh_search',
          decisionAction: 'add',
          referencedItems: [],
          items: [{
            rawReference: 'WBC3630',
            skuCandidate: 'WBC3630',
            quantity: 1,
            unit: null,
            description: 'WBC3630',
            dimensions: null,
          }],
          needsClarification: false,
          clarificationQuestion: null,
        }),
      }),
    },
  });

  const resolveProductsNode = createResolveProductsNode({
    inventoryTools: {
      findProductsBySkuTool: {
        invoke: async ({ skus }) => skus.map(() => ({
          status: 'matched',
          matches: [{
            sku: 'WBC3630-SW',
            productName: 'Blind Corner Wall Cabinet 36"W x 30"H',
            sellingPrice: 440,
            currency: 'USD',
            qtyAvailable: 0,
            unit: 'EA',
            leadTimeDays: 4,
          }],
        })),
      },
      searchProductsTool: {
        invoke: async () => [],
      },
    },
  });

  const composeResponseNode = createComposeResponseNode({
    model: {
      invoke: async () => {
        throw new Error('force deterministic fallback');
      },
    },
  });

  const agentPayload = buildConversationAgentPayload({
    requestId: 'req-e2e-1',
    sessionId: '20260803100746270',
    reqMessageObj: {
      fromId: '14459',
      signalId: '9897019859654846',
      taskId: '416330',
      channel: 'chat',
      mimeType: 'text',
      databaseName: 'HM_6',
      localDateTime: '2026-08-03 15:39:14',
      localTimeZone: 'Asia/Calcutta',
    },
    context: {
      apiAnswer: 'WBC3630',
    },
    tenant: {
      tenantId: 'tn_e89ffee32b55',
      databaseName: 'tenant_16020_hhh_15ce500cf7',
    },
    botUserId: '16020',
    customer: {
      displayName: 'Harish',
      email: 'kpharish20@gmail.com',
      phone: '9999999999',
      cybotUserId: '14459',
    },
    message: 'WBC3630',
    localDateTime: '2026-08-03 15:39:14',
    localTimeZone: 'Asia/Calcutta',
    inputType: 'text',
  });

  const understood = await understandRequestNode({
    agentPayload,
    recentTurns: [],
    pendingDecision: null,
  });

  assert.equal(understood.intent.intent, 'product_enquiry');
  assert.equal(understood.intent.items[0].quantity, null);

  const resolved = await resolveProductsNode({
    agentPayload,
    intent: understood.intent,
  });

  const composed = await composeResponseNode({
    agentPayload,
    intent: understood.intent,
    productResults: resolved.productResults,
    recentTurns: [],
  });

  assert.match(composed.reply, /How many would you like\?/i);
  assert.doesNotMatch(composed.reply, /added .* to your cart/i);
});
