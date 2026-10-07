# Chat LangGraph Learning Guide

This document explains the chat workflow that is implemented in this project. Read it alongside:

- `server/src/langgraph/graphs/chat/chatGraph.js`
- `server/src/langgraph/graphs/chat/chatState.js`
- `server/src/langgraph/graphs/chat/nodes/`

The design principle is simple:

> The model understands customer language. LangGraph controls the allowed workflow. Inventory tools return trusted product facts. Deterministic code protects the cart, order, and customer data.

## 1. The complete chat graph

```text
START
  |
  v
extract_order_input
  |
  v
understand_request
  |
  +-- conversation / side question / recoverable unclear --> resolve_conversation --> answer_question --> END
  |
  +-- system unavailable / cannot safely continue -------> compose_response --> END
  |
  +-- product, cart, or order action --------------------> resolve_products
                                                            |
                                                            v
                                                         cart_action
                                                            |
                                                            v
                                                         order_summary
                                                            |
                                                            v
                                                       compose_response --> END
```

The graph is compiled once when the server starts. For every customer message, the server invokes the compiled graph with the customer/session `thread_id`. The MongoDB checkpointer reloads the previous state for that same thread before the graph runs.

## 2. State: the workflow's shared memory

`ChatState` is the shared object passed from node to node. A node returns only the fields it changed; LangGraph combines those updates into state.

| State field | Meaning | Why it exists |
| --- | --- | --- |
| `agentPayload` | Current message, customer identity, tenant, request/session information and attachments | Input for the current graph run. |
| `fileExtraction` | Structured result from an image/document/text order upload | Keeps attachment interpretation separate from normal text. |
| `intent` | Structured understanding of the current message | Lets routing and business code work without guessing from raw language. |
| `productResults` | Verified inventory matches, suggestions, or misses | A product is never added based only on model text. |
| `pendingItems` | Items being handled in this turn | Useful while resolution is in progress. |
| `pendingDecision` | What the customer must choose or provide next | Supports “option 2”, “item 1 qty 4”, cart edits, and follow-up messages. |
| `pendingCartActionConfirmation` | Confirmation needed before destructive cart actions such as clear cart | Prevents accidental state changes. |
| `pendingImageConfirmation` | Uncertain image/sketch values that need customer approval | Prevents uncertain OCR/vision data entering the cart. |
| `cart` | Verified cart lines, totals, quantities, stock status, and dates | Business truth for the current order. |
| `cartActionResult` | Result of add/remove/update/view action | Gives the response node an exact explanation of what changed. |
| `orderSummaryState` | Quote draft, summary lines, fulfillment status, order-confirmation artifacts | Enforces review before final submission. |
| `lastResolvedProducts` | Recently unique matched products | Helps answer a follow-up like “Is that available?” |
| `recentTurns` | Recent customer/assistant messages | Supports natural references without sending unlimited history. |
| `conversationSummary` | Compact long-term conversation context | Keeps long conversations manageable. |
| `conversationCatalogFacts` | Read-only catalog facts needed for a side question | Grounds a conversational answer in inventory data. |
| `stage` | High-level workflow stage, such as choosing product or reviewing order | Helps maintain context while side questions occur. |
| `conversationStatus` | Whether the conversation is active or order is complete | Controls the channel response state. |
| `reply` | Final customer-facing response | Output returned by the API. |

## 3. What an intent is

An intent is structured data, not a customer-facing answer. It is validated with Zod in `chatIntentSchema.js`.

Example:

```json
{
  "intent": "product_enquiry",
  "requestMode": "fresh_search",
  "decisionAction": "none",
  "items": [
    {
      "rawReference": "Wall cabinet 30 W x 12 H qty 2",
      "skuCandidate": null,
      "quantity": 2,
      "description": "Wall cabinet glass door",
      "dimensions": { "width": 30, "height": 12, "depth": null }
    }
  ],
  "needsClarification": false
}
```

Important intent fields:

| Field | Example | Purpose |
| --- | --- | --- |
| `intent` | `product_enquiry`, `cart_add`, `cart_update`, `cart_remove`, `cart_view`, `order_summary`, `order_submit`, `conversation`, `unclear` | Selects the business path. |
| `requestMode` | `fresh_search` or `continue_previous_selection` | Distinguishes a new product from a reply to a previous menu. |
| `decisionAction` | `add`, `choose_option`, `change_qty`, `clear_cart`, `prepare_order_summary`, `confirm_order_summary` | Makes the requested action explicit. |
| `items` | SKU/description/quantity/dimensions for each requested product | Input to inventory resolution. |
| `referencedItems` | `[1, 3]` | Refers to existing pending/cart item numbers. |
| `needsClarification` | `true` | Stops unsafe guessing and asks one focused question. |

## 4. Node-by-node explanation

### `extract_order_input`

**Input:** current message and attachments.

**Job:** reads supported images, spreadsheets, documents, or text order files and produces structured item candidates. It records confidence and uncertain fields for image/sketch extraction.

**Why:** an uploaded order should become the same structured item format as typed text. Uncertain image values require explicit confirmation before cart addition.

### `understand_request`

**Input:** message, cart, pending decision, recent turns, order stage, and optional extracted file items.

**Job:** converts language into validated intent. It uses deterministic rules before calling the model where accuracy is important.

Current deterministic protections include:

- quantity forms such as `qty 4`, `4 quantity`, and compact SKU quantity text;
- conflicting quantities for a single item; it asks rather than choosing one;
- invalid empty-cart command `add cart`;
- recognizable multi-line orders, parsed one line at a time;
- `30 W x 12 H` mapped to `width: 30`, `height: 12`;
- multiple SKU-like identifiers in one unseparated line; it asks the customer to send one product per line;
- cart continuation commands such as `item 2 qty 4`, `option 1`, and `show cart`.

**Why:** Claude is useful for flexible natural language, but deterministic input formats should not change meaning from one request to another.

### Router after `understand_request`

The router decides which path is safe.

- **Product/cart/order intent** goes to `resolve_products`.
- **Conversation or side question** goes to `resolve_conversation`, then `answer_question`.
- **Recoverable unclear text** may use the conversation path to give a helpful answer without losing workflow state.
- **System-unavailable unclear text** goes directly to `compose_response` so the customer receives a clear fallback.

### `resolve_products`

**Input:** `intent.items`.

**Job:** calls inventory tools and returns one result for each item:

- `matched` — one verified product;
- `suggestions` — close/ambiguous products, requiring customer selection;
- `unmatched` — no verified product.

For descriptions, width, height, and depth are separate fields. A `30 W x 12 H` request is searched as width `30` and height `12`; it is not treated as interchangeable `12 x 30`.

**Why:** the model must not invent SKU, price, availability, or delivery date.

### `cart_action`

**Input:** validated intent, verified product results, existing cart, and pending decision.

**Job:** creates the only permitted cart changes: add, remove, update quantity, view, or clear after confirmation.

**Why:** this node is deterministic business logic. It validates positive quantities, merges same SKU cart lines, computes totals, preserves fulfillment status, and uses plural wording when several items were added.

### `order_summary`

**Input:** cart and order intent.

**Job:** creates a quote/order summary. It does not submit the order until the customer explicitly confirms the prepared summary.

**Why:** checkout is a stage machine:

```text
cart changes
  -> order summary awaiting confirmation
  -> customer confirms
  -> final order / invoice / payment artifacts
```

### `compose_response`

**Input:** verified facts from the previous nodes.

**Job:** produces the customer reply and next-step options. It uses templates for cart, summaries, confirmations, and guided choices; the model is only used where a grounded natural response is appropriate.

It shows:

- per-item availability;
- order-level fulfillment, including split fulfillment;
- scheduled dates in the final confirmation;
- clear Quote, Invoice, and Payment labels;
- no no-op cart suggestion such as `quantity 3 to 3`.

### `resolve_conversation` and `answer_question`

These are the side-question path.

Example:

```text
Customer: "Add W1212GD-SW qty 2"
Assistant: "I found it. Shall I add it?"
Customer: "What is the price?"
```

`resolve_conversation` loads verified catalog/cart facts. `answer_question` answers the price question, but does not add an item, reset the cart, or lose the pending choice.

## 5. Example flows

### A. One product with dimensions

```text
Customer: Wall cabinet glass door 30 W x 12 H qty 2
  -> understand_request: one item, width 30, height 12, quantity 2
  -> resolve_products: exact inventory search
  -> compose_response: matched item or controlled options
  -> customer: Yes, add to cart
  -> cart_action: verified item added
```

### B. Multi-line order

```text
W1212GD-SW qty 4
Wall cabinet 30 W x 12 H Shaker White qty 2
B2436-SW 3 pcs

  -> deterministic multi-line parser creates exactly 3 items
  -> resolve_products creates 3 corresponding results
  -> response lists matched, suggested, and unmatched items separately
```

### C. Safe clarification

```text
Customer: 56qty and W331524 6qty
  -> conflicting quantity guard
  -> reply: "I found conflicting quantities (56 and 6)..."
  -> no inventory/cart/order write occurs
```

### D. Side question during ordering

```text
Customer: Is item 1 available now?
  -> conversation intent
  -> resolve_conversation loads verified cart/catalog facts
  -> answer_question replies using those facts
  -> pending cart/order stage remains unchanged
```

## 6. Tools and why they are separate from nodes

Tools interact with real systems. In this graph, inventory tools perform exact SKU lookup, description/dimension search, availability checks, product detail lookup, comparison, and alternatives.

Nodes decide **when** a tool is required. Tools return facts. Nodes then decide **what state update is allowed**. This separation prevents a language model from directly writing to MongoDB or inventing an inventory result.

## 7. How to troubleshoot a production request

Use the request ID in the logs and read the nodes in this order:

1. `extract_order_input` — did an attachment create correct items?
2. `understand_request` — inspect intent, item count, quantities, and dimensions.
3. Router decision — did it go to conversation or product resolution?
4. `resolve_products` — inspect match/suggestion/unmatched status per item.
5. `cart_action` — inspect changed cart lines and totals.
6. `order_summary` — verify the stage and fulfillment data.
7. `compose_response` — verify the reply matches trusted state.

The router also logs state snapshots before and after a graph run. For a repeat request, compare the normalized message, intent item count, `productResults`, `pendingDecision`, and cart state. That tells you whether the problem came from input extraction, intent extraction, inventory data, or cart business logic.

## 8. What this graph intentionally does not do

- It does not automatically pick an ambiguous product suggestion.
- It does not add an item until product facts and quantity are valid.
- It does not submit an order before an order summary is confirmed.
- It does not silently choose between conflicting quantities.
- It does not let a side question erase the current cart/order workflow.

Those restrictions are not limitations of the AI; they are production safety rules.
