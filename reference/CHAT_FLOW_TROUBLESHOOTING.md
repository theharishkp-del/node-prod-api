# Chat Flow and Troubleshooting Guide

This guide describes the current **chat-only** LangGraph flow. IVR remains separate and menu-driven.

## 1. Core Request Flow

```text
Customer message / uploaded file
  → API builds agent payload
  → thread_id identifies the customer + session
  → MongoDB checkpoint restores the current state
  → extract_order_input
  → understand_request
  → conditional route
      ├─ product/cart/order action → resolve_products → cart_action → order_summary → compose_response
      └─ question/unclear message → resolve_conversation → answer_question
  → final state is checkpointed in MongoDB
  → API returns customer reply and optional cart-selection link
```

The `thread_id` is derived from tenant, bot user, customer identity, and session ID. Use the same customer/session while testing a continuing order.

## 2. Chat State That Must Be Preserved

| State field | Purpose |
| --- | --- |
| `cart` | Verified products the customer has added. |
| `pendingDecision` | Product options, quantity questions, and cart-item numbers currently shown to the customer. |
| `pendingImageConfirmation` | Unclear image/sketch fields that must be confirmed before an add action. |
| `orderSummaryState` | Draft/order-review status and final order artifacts. |
| `recentTurns` | Last six customer/assistant turns. |
| `conversationSummary` | Short rolling summary for longer conversations. |
| `stage` | `browsing`, `choosing_product`, `reviewing_cart`, `awaiting_order_confirmation`, or `order_completed`. |

## 3. Single Item, One Message at a Time

```text
Customer: Add W2430-SW qty 2
  → intent: cart_add
  → find_products_by_sku
  → verified product result
  → cart adds W2430-SW × 2

Customer: Add B3634-SW qty 1
  → same thread_id loads prior cart
  → cart adds B3634-SW × 1
```

Expected cart:

```text
W2430-SW × 2
B3634-SW × 1
```

Rules:

- A SKU without quantity is shown but not auto-added.
- An unmatched SKU is never added.
- Adding the same SKU again merges/increases its quantity.
- `Remove item 1` uses the saved display mapping; if unavailable, it safely falls back to current cart order.

## 4. Multiple Items in One Message

Example:

```text
Add W2430-SW qty 2
Add B3634-SW qty 1
Add T1884-SW qty 1
```

Flow:

```text
understand_request extracts all item lines
  → resolve_products validates each line independently
  → cart_action adds only exact verified selections
  → compose_response groups matches, suggestions, and missing details
```

If one item cannot be found, valid items stay separate from unresolved items. The system must not silently substitute a suggested product.

## 5. Suggested Options and Selection Messages

When a description has multiple close catalog options, the reply contains numbered choices.

Use these message formats:

```text
item 1 option 1 qty 2
item 2 option 3 qty 1
```

To select every suggested option for one item:

```text
item 1 all options qty 2
```

Each selected option is resolved against inventory and becomes a separate cart line only after validation.

## 6. Side Questions Must Not Change the Cart

Examples:

```text
What is the price of item 1?
Which one is cheaper?
Is item 2 available now?
Can I get this in black?
Show a cheaper alternative.
Can you recommend a budget kitchen cabinet?
```

Flow:

```text
understand_request identifies conversation/unclear message
  → resolve_conversation
      → get_product_details / compare_products / check_availability / find_alternatives
  → answer_question writes a natural response from verified facts
  → cart and order state remain unchanged
```

After every side-question test, send `Show cart`. The cart must be identical to its state before the question.

## 7. Image or Sketch Upload Flow

Only one uploaded file is expected per request.

```text
Image/PDF from S3
  → extract_order_input downloads the file
  → Claude vision returns structured items
      SKU, description, quantity, dimensions, sketch hints
      confidence, uncertainFields, uncertaintyNote
  → inventory resolution
  → guided customer response
```

The response explicitly says it reviewed the uploaded image/sketch.

If extraction contains unclear data, the customer must confirm it before any add action:

```text
Customer: Confirm image details
```

Until then, `cart_action` returns `image_confirmation_required` and must not mutate the cart.

## 8. Cart Selection Link Payload

The API creates a 24-hour tokenized cart-selection link when there are pending selections or a cart view.

The link payload includes:

```text
pendingDecision
pendingImageConfirmation
cart
orderSummaryState
bookingCompleted
orderLocked
```

The UI should:

1. Show product options and cart items, including available images.
2. If `pendingImageConfirmation` exists, require `Confirm image details` before normal selection/add actions.
3. Submit the customer selection text to the cart-selection endpoint.
4. Refresh the same link state after the graph reply.

Safety controls:

- Link tokens expire after 24 hours.
- Submission is atomically claimed to prevent double-click duplicates.
- A completed order locks old cart-selection links.
- Submission resumes the original LangGraph `thread_id`.

## 9. Checkout and Final Order Safety

```text
Customer: Place the order
  → order summary is prepared
  → stage: awaiting_order_confirmation

Customer: Confirm
  → final work order/invoice/payment flow may run
```

Final order creation is blocked unless the graph has a saved `awaiting_confirmation` summary. If a direct submit reaches the order node without that state, it is converted to a review-required summary and no final write occurs.

## 10. Troubleshooting by Symptom

| Symptom | Check first | Expected fix/path |
| --- | --- | --- |
| Cart disappears between messages | Compare `thread_id`, session ID, customer identity, and checkpoint logs. | Use the same customer/session. |
| Product not added | Inspect `intent`, `productResults`, and `cartActionResult`. | Require exact match and valid quantity. |
| Wrong product suggestion | Inspect `resolve_products` tool results and source description/dimensions. | Customer selects a numbered option; do not auto-add suggestions. |
| Side question resets flow | Inspect `routeAfterUnderstand`. | It should route to `resolve_conversation`, not cart/order mutation. |
| Cart-selection UI differs from chat | Inspect `customer_cart_selection_links.uiState`. | Refresh the link after submission; use the same thread ID. |
| Image add is blocked | Inspect `pendingImageConfirmation`. | Customer sends `Confirm image details`. |
| Order was not created | Inspect `orderSummaryState.status`. | First create/review summary; then explicit confirmation. |
| Duplicate UI submission | Inspect `uiSubmitStatus` and work-order lock. | Link submission should return a conflict instead of creating a duplicate. |
| Technical model failure | Inspect `systemUnavailable`, request ID, and LangGraph node logs. | Return safe error; do not change cart/order state. |

## 11. Production Log Sequence

Search logs using `requestId` and then `threadId`.

```text
step_1_payload_normalized
step_2_checkpointer_resolved
step_3_graph_built
step_4_stream_started
step_5_node_<n>_<node_name>
step_6_final_state_ready
step_7_request_completed
```

For a normal cart request, expected node order is:

```text
extract_order_input
understand_request
resolve_products
cart_action
order_summary
compose_response
```

For a side question:

```text
extract_order_input
understand_request
resolve_conversation
answer_question
```
