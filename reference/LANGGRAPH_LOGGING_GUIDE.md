# LangGraph Chat Flow - Step-by-Step Logging Guide

## Overview
This guide explains the LangGraph chat flow with detailed logging at each step. No functionality is changed - only logging is added to help understand the flow.

## Complete Chat Flow with Logging

```
STEP 1: EXTRACT ORDER INPUT
├─ 📥 INPUT: User message from chat
├─ 📝 PROCESSING: Extract SKU, quantity, user details
├─ 🔍 LOG WHAT: User message, extracted items, customer info
└─ 📤 OUTPUT: Extracted order input

STEP 2: UNDERSTAND REQUEST  
├─ 📥 INPUT: Extracted order input
├─ 🤖 PROCESSING: Run LLM to understand intent
├─ 🔍 LOG WHAT: Intent detected (cart_add, product_enquiry, etc.), confidence
├─ 🔀 DECISION: What does user want?
└─ 📤 OUTPUT: Intent and parsed intent details

STEP 3: ROUTING DECISION (Router)
├─ 📥 INPUT: Intent from step 2
├─ 🔀 DECISION: Take which path?
│  ├─ If intent = 'unrelated' or 'unclear' → SKIP to Compose Response
│  └─ If intent = order intent → Continue to Resolve Products
├─ 🔍 LOG WHAT: Which path taken and why
└─ 📤 OUTPUT: Next node name

STEP 4A: RESOLVE PRODUCTS (if order intent)
├─ 📥 INPUT: Extracted items (SKU + quantity)
├─ 🔍 PROCESSING: Search inventory for each item
├─ 🔍 LOG WHAT: 
│  ├─ Items searched
│  ├─ Items found (matched/ambiguous/unmatched)
│  ├─ Prices from inventory
│  └─ Availability dates
└─ 📤 OUTPUT: Product search results

STEP 5: CART ACTION
├─ 📥 INPUT: Product search results + intent
├─ 💰 PROCESSING: 
│  ├─ Fetch customer's tier
│  ├─ Get tier multiplier
│  ├─ Apply multiplier to prices
│  └─ Modify cart (add/remove/update items)
├─ 🔍 LOG WHAT:
│  ├─ Customer tier found
│  ├─ Tier multiplier applied (base → tier-adjusted)
│  ├─ Cart items before/after
│  └─ Price changes (before & after multiplier)
└─ 📤 OUTPUT: Updated cart + cart action result

STEP 6: ORDER SUMMARY
├─ 📥 INPUT: Current cart state
├─ 🔍 PROCESSING: Build order summary if submitting
├─ 🔍 LOG WHAT:
│  ├─ Cart items
│  ├─ Cart totals
│  ├─ Order status
│  └─ Work order creation (if confirmed)
└─ 📤 OUTPUT: Order summary state

STEP 7: COMPOSE RESPONSE
├─ 📥 INPUT: All previous states + final decision
├─ 💰 PROCESSING:
│  ├─ Fetch customer's tier AGAIN
│  ├─ Get tier multiplier
│  ├─ Apply to response prices
│  └─ Build bot message with prices
├─ 🔍 LOG WHAT:
│  ├─ Response type (cart_view, cart_add, etc.)
│  ├─ Prices shown in response (base & tier-adjusted)
│  ├─ Product suggestions
│  └─ Final message
└─ 📤 OUTPUT: Bot message to user

STEP 4B: IF UNRELATED/UNCLEAR (Direct to Compose)
└─ Skip inventory, go straight to compose generic response
```

## Log Format Template

Each log should follow this format:

```javascript
logger.info('✅ STEP_NAME - Brief description', {
  requestId,                    // Track individual requests
  step: 'step_name',           // Unique identifier
  
  // INPUT
  input: { /* what comes in */ },
  
  // PROCESSING
  processing: { /* what happens */ },
  
  // DECISION (if applicable)
  decision: { /* which branch */ },
  
  // OUTPUT
  output: { /* what goes out */ },
  
  // TIMING
  durationMs: endTime - startTime,
  
  // SPECIFIC TO TIER PRICING
  tierMultiplier: 0.45,        // If tier is involved
  basePrice: 150,              // Original price
  tieredPrice: 67.50,          // After multiplier
});
```

## Key Fields to Log at Each Step

### STEP 1: Extract Order Input
- `userMessage`: Raw user input
- `extractedItems`: [{ sku, quantity }, ...]
- `customerInfo`: { name, email, phone }
- `itemCount`: Number of items to search

### STEP 2: Understand Request
- `detectedIntent`: String (cart_add, product_enquiry, cart_view, etc.)
- `clarificationNeeded`: Boolean
- `clarificationQuestion`: String if needed
- `confidence`: Intent confidence level

### STEP 3: Routing Decision
- `intentType`: What type of intent
- `routingPath`: Which node to go to next
- `skipReason`: If skipping (unrelated/unclear)

### STEP 4A: Resolve Products
- `searchedItems`: [{ reference, quantity }]
- `foundProducts`: Count of each status (matched/ambiguous/unmatched)
- `inventoryPrices`: Base prices from inventory
- `availabilityStatus`: ready_now / scheduled / pending

### STEP 5: Cart Action
- `customerId`: Customer making purchase
- `customerTier`: Which tier (e.g., TIER_3)
- `tierMultiplier`: Discount factor (0.45)
- `cartBefore`: Previous cart state
- `priceAdjustments`: [{ basePrice, multiplier, finalPrice }]
- `cartAfter`: Updated cart state

### STEP 6: Order Summary
- `orderStatus`: open / confirmed / submitted
- `cartItems`: Items being ordered
- `cartTotals`: subtotal, tax, discount, grand total
- `workOrderId`: If order is confirmed

### STEP 7: Compose Response
- `responseType`: cart_view / product_details / order_confirm
- `responsePrices`: [{ product, basePrice, tieredPrice }]
- `suggestions`: Alternative products (if any)
- `messageLength`: Length of response

## Tracing a Request Through Logs

To follow a single user request:

1. **Find request start**: Search for `requestId` = your ID
2. **Follow the flow**:
   - STEP 1: Extract ✅
   - STEP 2: Understand ✅
   - STEP 3: Router → Path chosen
   - STEP 4A: Resolve Products (if chosen)
   - STEP 5: Cart Action
   - STEP 6: Order Summary
   - STEP 7: Compose Response ✅
3. **Check pricing**: At each step, see basePrice → tieredPrice conversion
4. **Identify where to fix**: Which step shows wrong data?

## Example Log Sequence

```
[17:45:23] ✅ STEP 1 - EXTRACT ORDER INPUT
  requestId: "req-123"
  userMessage: "w1212gdsw 2 qty"
  extractedItems: [{ sku: "W1212GD-SW", quantity: 2 }]
  
[17:45:24] ✅ STEP 2 - UNDERSTAND REQUEST
  requestId: "req-123"
  detectedIntent: "cart_add"
  
[17:45:24] 🔀 STEP 3 - ROUTING DECISION
  requestId: "req-123"
  routingPath: "resolve_products"
  
[17:45:25] ✅ STEP 4A - RESOLVE PRODUCTS
  requestId: "req-123"
  searchedItems: ["W1212GD-SW"]
  found: { matched: 1, ambiguous: 0, unmatched: 0 }
  basePrice: 103.00
  
[17:45:26] ✅ STEP 5 - CART ACTION
  requestId: "req-123"
  customerTier: "TIER_3"
  tierMultiplier: 0.45
  priceAdjustment: { basePrice: 103.00, tieredPrice: 46.35 }
  cartAfter: { items: 1, total: 92.70 }
  
[17:45:27] ✅ STEP 7 - COMPOSE RESPONSE
  requestId: "req-123"
  responseType: "product_details"
  displayPrice: 46.35
  message: "Unit Price: $46.35"
```

## Where to Add Logging

### 1. Chat Graph (`chatGraph.js`)
- Log graph initialization
- Log routing decisions
- Log path chosen

### 2. Extract Order Input Node
- Log raw user message
- Log extracted items
- Log customer info

### 3. Understand Request Node
- Log detected intent
- Log any clarifications needed
- Log confidence level

### 4. Resolve Products Node
- Log items being searched
- Log search results (matched/unmatched/ambiguous)
- Log base prices from inventory
- Log availability

### 5. Cart Action Node
- Log customer tier lookup
- Log tier multiplier
- Log price before/after multiplier
- Log cart modifications

### 6. Order Summary Node
- Log order status changes
- Log cart totals
- Log work order creation

### 7. Compose Response Node
- Log response type
- Log prices in response
- Log tier multiplier application
- Log final message

## Debugging Using Logs

### Problem: Prices are wrong
1. Find price in STEP 7 compose response
2. Backtrack to STEP 5 cart action
3. Check if tier multiplier was applied
4. If wrong, check STEP 4A for base inventory price
5. If inventory price wrong, check database

### Problem: Wrong product found
1. Find product in STEP 4A resolve products
2. Check search query used
3. Check what was returned from inventory
4. Verify SKU matching logic

### Problem: Cart not updating
1. Find cart state in STEP 5
2. Check cart action type (add/remove/update)
3. Verify product was found in STEP 4A
4. Check if intent was understood in STEP 2

### Problem: User not seeing changes
1. Find response message in STEP 7
2. Check what data was used to build message
3. Trace back to STEP 5 cart state
4. Check if tier multiplier was applied

## Production Deployment Checklist

- [ ] All nodes have step logging
- [ ] Each log includes requestId for tracing
- [ ] Prices logged before and after tier multiplier
- [ ] Decision points logged
- [ ] Error paths logged
- [ ] Duration measured for each step
- [ ] No sensitive data in logs (passwords, tokens)
- [ ] Log level set to 'info' or 'debug'
