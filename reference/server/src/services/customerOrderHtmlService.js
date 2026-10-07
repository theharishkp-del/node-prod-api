import { uploadBufferToS3 } from '../utils/s3Upload.js';

function text(value, fallback = '-') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function escapeHtml(value) {
  return text(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[character]));
}

function safeImageUrl(value) {
  const normalized = String(value || '').trim();
  return /^https?:\/\//i.test(normalized) ? normalized : '';
}

function containerId(orderReference) {
  return `customer-order-html-${String(orderReference || 'pending')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')}`;
}

function formatAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? `$${amount.toFixed(2)}` : '-';
}

export function buildCustomerOrderHtml({ orderReference, items = [], quoteUrl = '', invoiceUrl = '', paymentLinkUrl = '' } = {}) {
  const safeOrderReference = text(orderReference, 'Pending');
  const rootId = containerId(safeOrderReference);
  const itemRows = items.length
    ? items.map((item) => {
      const imageUrl = safeImageUrl(item.imageUrl);
      const imageMarkup = imageUrl
        ? `<div class="prod-img-wrap">
            <img class="item-image prod-img" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(item.sku || item.productName || 'Item')}">
            <div class="prod-img-preview"><img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(item.sku || item.productName || 'Item')}"></div>
          </div>`
        : '<div class="item-image item-image-empty"></div>';
      return `<div class="item-row">
          ${imageMarkup}
          <div class="item-details">
            <div class="item-name">${escapeHtml(item.productName || item.itemName || 'Item')}</div>
            <div class="muted">${escapeHtml(item.sku)}</div>
            <div class="muted">Description: ${escapeHtml(item.description || item.productName || 'Unavailable')}</div>
            <div class="muted">Category: ${escapeHtml(item.category || 'Uncategorized')}</div>
            <div class="item-meta">Qty: ${escapeHtml(item.quantity)} | Total: ${formatAmount(item.lineTotal)}</div>
          </div>
        </div>`;
    }).join('')
    : '<p class="muted">No order items available.</p>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Order Confirmed</title>
  <style>
    #${rootId} { font-family: Arial, sans-serif; font-size: 14px; line-height: 1.4; color: #333; max-width: 495px; margin: 1rem auto; padding: 0 10px; word-wrap: break-word; overflow-wrap: break-word; }
    #${rootId} .card { border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; }
    #${rootId} .card-header { background: #4caf50; color: #fff; padding: 10px; text-align: center; font-weight: bold; font-size: 16px; }
    #${rootId} .card-body { padding: 15px; background: #f9f9f9; }
    #${rootId} .section-title { color: #4caf50; font-size: 16px; margin: 0 0 10px; }
    #${rootId} .field { margin: 5px 0; }
    #${rootId} .muted { color: #666; font-size: 12px; }
    #${rootId} .item-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid #e5e7eb; }
    #${rootId} .prod-img-wrap { position: relative; flex-shrink: 0; width: 58px; height: 58px; }
    #${rootId} .item-image { width: 58px; height: 58px; object-fit: contain; background: #fff; border: 1px solid #ddd; border-radius: 5px; flex: 0 0 58px; display: block; }
    #${rootId} .prod-img { width: 58px; height: 58px; object-fit: cover; border-radius: 5px; border: 1px solid #ddd; display: block; }
    #${rootId} .item-image-empty { background: #eee; }
    #${rootId} .prod-img-preview { position: absolute; z-index: 20; top: 50%; left: calc(100% + 0.75rem); width: 16rem; height: 16rem; padding: 0.35rem; border: 1px solid #cbd5e1; border-radius: 0.75rem; background: #fff; box-shadow: 0 14px 30px rgba(15, 23, 42, 0.2); opacity: 0; pointer-events: none; transform: translateY(-50%) scale(0.96); transform-origin: left center; transition: opacity 0.14s ease, transform 0.14s ease; }
    #${rootId} .prod-img-preview img { width: 100%; height: 100%; object-fit: contain; border-radius: 0.5rem; display: block; }
    #${rootId} .prod-img-wrap:hover .prod-img-preview, #${rootId} .prod-img-wrap:focus-within .prod-img-preview { opacity: 1; transform: translateY(-50%) scale(1); }
    #${rootId} .item-details { min-width: 0; }
    #${rootId} .item-name { font-weight: bold; }
    #${rootId} .item-meta { margin-top: 3px; font-size: 12px; }
    #${rootId} .links { display: grid; gap: 10px; margin-top: 18px; }
    #${rootId} .action { display: block; padding: 11px 14px; border-radius: 5px; color: #fff; text-align: center; text-decoration: none; font-weight: bold; }
    #${rootId} .action-quote { background: #c27a00; }
    #${rootId} .action-invoice { background: #2563eb; }
    #${rootId} .action-payment { background: #16803c; }
    #${rootId} .action-label { display: block; font-size: 11px; font-weight: normal; opacity: .9; margin-top: 2px; }
    #${rootId} .not-generated { margin: 0; color: #666; font-size: 13px; }
    @media (max-width: 360px) {
      #${rootId} { padding: 0 6px; }
      #${rootId} .card-body { padding: 12px; }
      #${rootId} .prod-img-preview { left: 50%; top: calc(100% + 0.75rem); transform: translateX(-50%) scale(0.96); transform-origin: top center; }
      #${rootId} .prod-img-wrap:hover .prod-img-preview, #${rootId} .prod-img-wrap:focus-within .prod-img-preview { transform: translateX(-50%) scale(1); }
    }
  </style>
</head>
<body>
  <div id="${rootId}" class="customer-order-container">
    <div class="card">
      <div class="card-header">ORDER CONFIRMED</div>
      <div class="card-body">
        <p class="field">Thank you for your order. It has been confirmed successfully.</p>
        <div class="section-title">Order Details</div>
        <p class="field"><b>Order Reference:</b> ${escapeHtml(safeOrderReference)}</p>
        <div class="section-title">Items</div>
        ${itemRows}
        <div class="links">
          ${quoteUrl ? `<a class="action action-quote" href="${escapeHtml(quoteUrl)}" target="_blank" rel="noopener">Open Quote<span class="action-label">View your quotation</span></a>` : '<p class="not-generated">Quote: Not generated</p>'}
          ${invoiceUrl ? `<a class="action action-invoice" href="${escapeHtml(invoiceUrl)}" target="_blank" rel="noopener">Open Invoice<span class="action-label">View your invoice PDF</span></a>` : '<p class="not-generated">Invoice: Not generated</p>'}
          ${paymentLinkUrl ? `<a class="action action-payment" href="${escapeHtml(paymentLinkUrl)}" target="_blank" rel="noopener">Pay Invoice<span class="action-label">Open secure payment link</span></a>` : '<p class="not-generated">Payment link: Not generated</p>'}
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

export async function createAndUploadCustomerOrderHtml({ orderReference, items, quoteUrl, invoiceUrl, paymentLinkUrl, tenantId } = {}) {
  const html = buildCustomerOrderHtml({ orderReference, items, quoteUrl, invoiceUrl, paymentLinkUrl });
  const fileName = `order-confirmed-${text(orderReference, 'pending')}.html`;
  const upload = await uploadBufferToS3({
    body: Buffer.from(html, 'utf8'),
    fileName,
    folderName: `customer-orders-${text(tenantId, 'unknown-tenant')}`,
    contentType: 'text/html; charset=utf-8',
    contentDisposition: 'inline',
    mimeType: 'htmlFile',
  });

  return { ...upload, html };
}