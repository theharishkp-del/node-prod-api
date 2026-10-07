# Product Order Webpage API Contract

## Document purpose

This document is the frontend/backend integration contract for the customer product-order webpage. The webpage creates a cart, requests a quotation, and confirms the accepted quotation. The backend then creates the work order, invoice, and payment link.

All request and response bodies use `application/json`.

## API summary

| Operation | Method | Endpoint | Successful status |
| --- | --- | --- | --- |
| Load encoded customer context | `GET` | `/product-order/context?key={key}` | `200` |
| Check whether this link already created an order | `GET` | `/product-order/status?key={key}` | `200` |
| Generate quotation | `POST` | `/product-order/quote` | `201` |
| Confirm quote and create sales documents | `POST` | `/product-order/confirm` | `201` for first creation, `200` for an idempotent retry |

## 1. Product-order link

The Standard EO handler for the following keys returns the webpage URL:

```json
{
  "questionKey": "iq+customer_menu",
  "answerKey": "iq+customer_menu_ans_3"
}
```

URL format:

```text
{PRODUCT_ORDER_CLIENT_URL}/product-order?key={BASE64URL_ENCODED_JSON}
```

`key` is Base64URL-encoded UTF-8 JSON. It uses URL-safe `-` and `_` characters and does not require `=` padding. The frontend should preserve and return the key exactly as received.

Backend encoding format:

```js
const key = Buffer.from(JSON.stringify(keyPayload), 'utf8').toString('base64url');
const url = `${productOrderClientUrl}/product-order?key=${encodeURIComponent(key)}`;
```

`PRODUCT_ORDER_CLIENT_URL` is the public base URL for the product-order webpage, without the `/product-order` route. If it is unset, the backend falls back to `CLIENT_URL`.
The backend creates the key. The frontend must not recreate or modify its decoded content.
`logoUrl` is currently set to the product-order brand logo URL in the backend; customer profile details used during quotation and confirmation are loaded server-side using `customer.id`.

The key is Base64URL-encoded JSON. Its decoded fields include `version`, `questionKey`, `answerKey`, `orderSource`, `currencyCode`, `tenantId`, `botUserId`, `databaseName`, `sessionId`, `taskId`, `signalId`, `logoUrl`, `tierMultiplier`, customer identifiers and name, and `issuedAt`/`expiresAt`. The webpage should treat it as an opaque value and send the exact key from the URL; it should not construct or edit the decoded payload.

## 2. Check existing order

Call this endpoint when the page loads or is refreshed, before allowing a new quote/order submission:

```http
GET /product-order/status?key={key}
```

No existing work order:

```json
{
  "status": "success",
  "data": {
    "orderCreated": false
  }
}
```

If this key's `sessionId` already has a work order for its customer and tenant, the response sets `orderCreated` to `true` and includes the existing work order, quote, invoice, and payment-link details. The UI should display the existing order and prevent the customer from starting a second order. The `key` must be passed exactly as found in the page URL.

The decoded `key` JSON has this structure:

```json
{
  "version": 1,
  "questionKey": "iq+customer_menu",
  "answerKey": "iq+customer_menu_ans_3",
  "orderSource": "webpage",
  "currencyCode": "USD",
  "tierMultiplier": 0.85,
  "tenantId": "tenant-id",
  "botUserId": "bot-user-id",
  "databaseName": "database-name",
  "sessionId": "task-or-signal-id",
  "taskId": "task-id",
  "signalId": "signal-id",
  "logoUrl": "https://cybots3pro.s3.us-east-1.amazonaws.com/afte/6157/Invoicelogo_Invoicelogo_IQLogoHorizontal_Clearbg_6157.png",
  "customer": {
    "id": "mongodb-customer-id",
    "cybotUserId": "cybot-user-id",
    "name": "Customer Name"
  },
  "issuedAt": "2026-09-29T00:00:00.000Z",
  "expiresAt": "2026-09-30T00:00:00.000Z"
}
```

## 3. Load customer context

```http
GET /product-order/context?key={key}
```

The response includes `currencyCode` and `tierMultiplier`. The UI can use the multiplier to display the customer's offer (for example `0.85` means 15% off the base price). It is only a display hint: the quote API reloads the customer tier and applies the current server-side multiplier rather than trusting the key.

Positive response — `200 OK`:

```json
{
  "status": "success",
  "data": {
    "orderSource": "webpage",
    "currencyCode": "USD",
    "tierMultiplier": 0.85,
    "questionKey": "iq+customer_menu",
    "answerKey": "iq+customer_menu_ans_3",
    "logoUrl": "https://cybots3pro.s3.us-east-1.amazonaws.com/afte/6157/Invoicelogo_Invoicelogo_IQLogoHorizontal_Clearbg_6157.png",
    "customer": {
      "id": "mongodb-customer-id",
      "cybotUserId": "cybot-user-id",
      "name": "Customer Name"
    }
  }
}
```

## 4. Generate quotation

```http
POST /product-order/quote
Content-Type: application/json
```

```json
{
  "key": "base64url-key-from-page-url",
  "customerRequestNotes": "Optional customer instructions",
  "cart": {
    "currencyCode": "USD",
    "items": [
      {
        "inventoryId": "inventory-document-id",
        "sku": "W1212GD-SW",
        "productName": "Wall Cabinet",
        "itemName": "12-inch Glass Door Wall Cabinet",
        "description": "Two-door wall cabinet",
        "category": "Cabinet",
        "type": "Wall",
        "color": "White",
        "finish": "Satin White",
        "doorType": "Glass Door",
        "glassDoor": true,
        "width": 12,
        "height": 12,
        "depth": 12,
        "unit": "each",
        "quantity": 2,
        "unitPrice": 150,
        "imageUrl": "https://example.com/product.jpg",
        "notes": "Optional line note"
      }
    ]
  }
}
```

Product details and `unitPrice` come from the webpage's product source. The backend does not look up product SKUs, stock, or prices in the local inventory database for this flow. It validates that each line has a SKU, positive quantity, and non-negative unit price, then uses the submitted product data to create the quotation. Confirmation uses the saved quotation's product lines and prices.

Successful response:

```json
{
  "status": "quote_created",
  "data": {
    "currencyCode": "USD",
    "quote": {
      "id": "quote-id",
      "number": "QT-20260929-0001",
      "url": "https://quotation-pdf-url"
    },
    "cart": [
      {
        "inventoryId": "inventory-document-id",
        "sku": "W1212GD-SW",
        "productName": "Wall Cabinet",
        "itemName": "12-inch Glass Door Wall Cabinet",
        "description": "Two-door wall cabinet",
        "category": "Cabinet",
        "type": "Wall",
        "color": "White",
        "finish": "Satin White",
        "doorType": "Glass Door",
        "glassDoor": true,
        "width": 12,
        "height": 12,
        "depth": 12,
        "unit": "each",
        "unitPrice": 150,
        "quantity": 2,
        "lineTotal": 300,
        "qtyAvailableNow": 0,
        "remainingQty": 2,
        "leadTimeDays": 0,
        "imageUrl": "https://example.com/product.jpg",
        "notes": ""
      }
    ]
  }
}
```

## 5. Confirm quotation

```http
POST /product-order/confirm
Content-Type: application/json
```

```json
{
  "key": "base64url-key-from-page-url",
  "quoteId": "quote-id-returned-by-quote-api"
}
```

The backend reloads the stored quotation, checks that it belongs to the customer in the key, preserves the quoted prices, and creates the work order, invoice, and payment link.

Successful response:

```json
{
  "status": "completed",
  "data": {
    "workOrder": {
      "number": "WO-20260929-0001",
      "orderReferenceNumber": "ORD-20260929-0001",
      "source": "webpage"
    },
    "quote": {
      "id": "quote-id",
      "number": "QT-20260929-0001",
      "url": "https://quotation-pdf-url"
    },
    "invoice": {
      "id": "invoice-id",
      "number": "INV-20260929-0001",
      "url": "https://invoice-pdf-url"
    },
    "paymentLink": {
      "id": "payment-link-id",
      "url": "https://payment-url"
    }
  }
}
```

## 6. Negative response format

All controller and validation errors use this envelope:

```json
{
  "status": "error",
  "message": "Human-readable error message."
}
```

### Invalid or expired key — `404 Not Found`

Applies to all three APIs.

```json
{
  "status": "error",
  "message": "The product-order key is invalid or has expired."
}
```

### Key belongs to a different tenant — `403 Forbidden`

```json
{
  "status": "error",
  "message": "The product-order key does not match the tenant."
}
```

### Empty or oversized cart — `400 Bad Request`

```json
{
  "status": "error",
  "message": "Cart must contain between 1 and 100 items."
}
```

### Invalid cart item — `400 Bad Request`

```json
{
  "status": "error",
  "message": "A valid SKU and positive quantity are required for cart item 1."
}
```

### Currency mismatch — `400 Bad Request`

```json
{
  "status": "error",
  "message": "Cart currency EUR does not match order currency USD."
}
```

### Inventory item not found — `400 Bad Request`

```json
{
  "status": "error",
  "message": "Inventory item W1212GD-SW was not found."
}
```

### Order already confirmed — `409 Conflict`

Returned when the quote API is called after the webpage order has already created a work order.

```json
{
  "status": "error",
  "message": "This webpage order has already been confirmed."
}
```

### Invalid quotation ID — `400 Bad Request`

```json
{
  "status": "error",
  "message": "A valid quotation ID is required."
}
```

### Quotation not found or customer mismatch — `404 Not Found`

```json
{
  "status": "error",
  "message": "The quotation was not found for this customer."
}
```

### Invalid quotation lines — `400 Bad Request`

```json
{
  "status": "error",
  "message": "The quotation does not contain valid product lines."
}
```

### Unexpected backend or integration failure — `500 Internal Server Error`

```json
{
  "status": "error",
  "message": "Unexpected server error."
}
```

The server can return a more specific integration message in `message` when one is available.

## 7. Frontend handling rules

1. Read `key` from the product-order page URL.
2. Call the context API and initialize the page with its customer and `currencyCode`.
3. Keep the key unchanged for the complete webpage session.
4. Send the cart to the quote API. The minimum required item fields are `sku` and `quantity`.
5. Display prices and totals using the authoritative cart returned by the quote API.
6. Display the quotation PDF using `data.quote.url`.
7. Send `key` and `quoteId` to the confirmation API only after explicit customer acceptance.
8. Display the returned invoice and payment links.
9. Disable further cart changes after confirmation succeeds.

## 8. Backend processing rules

1. Validate and decode the Base64URL key, including its expiry.
2. Resolve and verify the tenant and customer.
3. Ensure the customer is synchronized to Zoho before quotation synchronization.
4. Reload every product using its SKU; do not trust frontend prices.
5. Apply the customer pricing tier and the currency from the encoded key.
6. Preserve product metadata in quotation and invoice descriptions.
7. On confirmation, verify that the quote belongs to the encoded customer.
8. Preserve the quotation price when creating the work order and invoice.
9. Create the work order with `orderSource: "webpage"`.
10. Return the quotation, invoice, and payment links to the frontend.

## 9. Security note

Base64URL is encoding, not encryption. Customer details can be decoded by anyone who has the URL. The key should not contain passwords, access tokens, payment-card data, or other secrets. A server-side signature should be added if tamper protection is required.
