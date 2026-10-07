# Tier Pricing - Quick Developer Reference

## 🎯 One-Liner
**Customer's tier multiplier automatically adjusts product prices: `final_price = base_price × tier_multiplier`**

## 📦 Core Utilities

### Backend (Node.js)
**File:** `server/src/utils/tierPricing.js`

```javascript
import { calculateTierPrice, validateAndNormalizeMultiplier, getTierMultiplier } from './utils/tierPricing.js';

// Get customer's multiplier
multiplier = await getTierMultiplier(tenantDb, customerId.tierId);  // Returns 0.45

// Validate multiplier (caps at 1.0)
validated = validateAndNormalizeMultiplier(1.5);  // Returns 1.0

// Calculate final price
finalPrice = calculateTierPrice(150, 0.45);  // Returns 67.50
```

### Frontend (TypeScript/Angular)
**File:** `client/src/app/utils/tierPricing.ts`

```typescript
import { calculateTierPriceFrontend, validateAndNormalizeMultiplierFrontend } from './utils/tierPricing';

// Validate multiplier
valid = validateAndNormalizeMultiplierFrontend(1.5);  // Returns 1.0

// Calculate price
price = calculateTierPriceFrontend(150, 0.45);  // Returns 67.50

// Format for display
info = formatTierPrice(67.50, 0.45, 'USD');  // Returns formatted info
```

## 🔗 Integration Points

### 1. Tier Master CRUD
**File:** `server/src/services/masterDataService.js`
- Function: `buildTierPayload()`
- **Action:** Validates multiplier (caps > 1.0, rejects ≤ 0)
- **When:** On create/update tier

### 2. Cart Pricing
**File:** `server/src/langgraph/graphs/chat/nodes/cartActionNode.js`
- Function: `createCartActionNode()`
- **Action:** Fetches customer tier, applies multiplier
- **When:** On cart add/update

### 3. Price Calculation
**File:** `server/src/langgraph/graphs/chat/nodes/cartActionNode.js`
- Function: `buildCartItemFromResult()`
- **Action:** Accepts tierMultiplier parameter, applies to unitPrice
- **When:** Building cart item

## 🗄️ Database Tables

### md_tiers (Tier Master)
```sql
CREATE COLLECTION md_tiers (
  _id: ObjectId PRIMARY KEY,
  tierKey: String UNIQUE,
  tierName: String,
  multiplier: Number,  -- Validated: > 0, capped at 1.0
  tenantId: String,
  botUserId: String,
  isDeleted: Boolean,
  createdAt: Date,
  updatedAt: Date
)
```

### md_customers (Customer Table)
```sql
CREATE COLLECTION md_customers (
  _id: ObjectId PRIMARY KEY,
  tierId: ObjectId FK → md_tiers,  -- Links customer to tier
  -- ... other fields
)
```

## 🔢 Quick Formula

```
Final Price = Base Price × Tier Multiplier

Example:
  Base Price = $150
  Tier = TIER_3 (multiplier: 0.45)
  Final = $150 × 0.45 = $67.50
```

## ⚙️ Configuration

### Default Behavior
- No tier assigned → Multiplier = 1.0 (no discount)
- Multiplier > 1.0 → Auto-capped to 1.0 (no markup allowed)
- Multiplier ≤ 0 → Error (rejected)

### Validation
- Backend: `validateAndNormalizeMultiplier()` in tierPricing.js
- Frontend: `validateAndNormalizeMultiplierFrontend()` in tierPricing.ts

## 🚀 Usage Examples

### Example 1: Create Tier
```javascript
// Backend
await createTier({
  tenantDb,
  tenant,
  botUserId,
  payload: {
    tierKey: 'TIER_3',
    tierName: 'Silver',
    multiplier: 0.45  // 45% of original price
  }
})
// Validation: multiplier 0.45 is valid ✓
```

### Example 2: Assign Tier to Customer
```javascript
// Backend
await updateCustomer({
  tenantDb,
  customerId: 'customer123',
  payload: {
    tierId: ObjectId('tier123')  // Link to tier
  }
})
```

### Example 3: Cart Pricing
```javascript
// Inside cartActionNode
const tierMultiplier = await getTierMultiplier(tenantDb, customer.tierId);
// Returns: 0.45

const cartItem = buildCartItemFromResult(product, agentPayload, tierMultiplier);
// Applies: unitPrice = 150 × 0.45 = 67.50
```

## 🧪 Validation Examples

```javascript
// Backend
validateAndNormalizeMultiplier(0.45)   // ✅ Returns 0.45
validateAndNormalizeMultiplier(0.99)   // ✅ Returns 0.99
validateAndNormalizeMultiplier(1.00)   // ✅ Returns 1.00
validateAndNormalizeMultiplier(1.50)   // ✅ Returns 1.00 (capped)
validateAndNormalizeMultiplier(0)      // ❌ Throws error
validateAndNormalizeMultiplier(-0.5)   // ❌ Throws error

// Frontend (same logic)
validateAndNormalizeMultiplierFrontend(1.50)  // ✅ Returns 1.00
```

## 🔄 Data Flow

```
CUSTOMER
  │
  ├─→ tierId (ObjectId)
       │
       └─→ TIER (multiplier: 0.45)
            │
            └─→ CART ACTION NODE
                 │
                 ├─→ Fetch customer by email
                 ├─→ Get customer.tierId
                 ├─→ Fetch tier multiplier
                 │
                 └─→ For each product:
                      base_price = 150
                      unit_price = 150 × 0.45 = 67.50
                      │
                      └─→ Add to cart with adjusted price
```

## 📋 Common Tasks

### Task 1: Create a Tier with 30% Discount
```javascript
const tier = await createTier({
  payload: {
    tierKey: 'TIER_GOLD',
    tierName: 'Gold Member',
    multiplier: 0.70  // 30% discount (70% of original)
  }
});
```

### Task 2: Assign Tier to Customer
```javascript
await updateCustomer({
  customerId: 'customer123',
  payload: {
    tierId: tier._id
  }
});
// Customer now gets 0.70 multiplier on all prices
```

### Task 3: Calculate Final Price in Quote
```javascript
const finalPrice = calculateTierPrice(
  quoteLineItem.rate,        // 150
  customerTierMultiplier     // 0.70
);
// Returns: 105
```

## 🐛 Debugging

### Check Customer's Tier
```javascript
const customer = await tenantDb.collection('md_customers').findOne({ email: 'john@example.com' });
console.log('Customer tierId:', customer.tierId);
```

### Check Tier Multiplier
```javascript
const tier = await tenantDb.collection('md_tiers').findOne({ _id: ObjectId(customer.tierId) });
console.log('Tier multiplier:', tier.multiplier);
```

### Trace Price Calculation
```javascript
const basePrice = 150;
const multiplier = 0.45;
const finalPrice = basePrice * multiplier;
console.log(`$${basePrice} × ${multiplier} = $${finalPrice}`);
// Output: $150 × 0.45 = $67.5
```

## ✅ Checklist for Implementation

- [x] Tier multiplier validation (backend & frontend)
- [x] Auto-cap multiplier > 1.0 to 1.0
- [x] Fetch customer's tier in cart action
- [x] Apply multiplier to product prices
- [x] Pass multiplier through cart building
- [x] Store tier multiplier info in cart items
- [x] Frontend validation utilities created
- [x] Error handling for missing tiers
- [x] Default behavior (multiplier = 1.0)
- [x] No syntax/compilation errors

## 🔗 Related Files
- Tier Model: `server/src/models/tenant/masterDataTierModel.js`
- Customer Model: `server/src/models/tenant/masterDataCustomerModel.js`
- Master Data Service: `server/src/services/masterDataService.js`
- Cart Action Node: `server/src/langgraph/graphs/chat/nodes/cartActionNode.js`
- Chat Graph: `server/src/langgraph/graphs/chat/chatGraph.js`
