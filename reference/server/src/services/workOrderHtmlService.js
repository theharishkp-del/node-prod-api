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

function buildContainerId(workOrderId) {
  const normalizedId = String(workOrderId || 'pending')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-');
  return `work-order-html-${normalizedId || 'pending'}`;
}

function safeImageUrl(value) {
  const imageUrl = String(value || '').trim();
  return /^https?:\/\//i.test(imageUrl) ? imageUrl : '';
}

function formatAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount.toFixed(2) : '-';
}

export function buildWorkOrderHtml({ workOrder = {}, customer = {}, enrichedWorkOrder = {}, workOrderId = '' } = {}) {
  const containerId = buildContainerId(workOrderId || workOrder.workOrderNumber || workOrder.workOrderId);
  const items = Array.isArray(workOrder.items) && workOrder.items.length
    ? workOrder.items
    : (workOrder.lineItems || []);
  const itemRows = items.length
    ? items.map((item) => {
      const imageUrl = safeImageUrl(item.imageUrl);
      const imageMarkup = imageUrl
        ? `<div class="prod-img-wrap">
            <img class="item-image prod-img" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(item.sku || item.name || 'Item')}">
            <div class="prod-img-preview"><img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(item.sku || item.name || 'Item')}"></div>
          </div>`
        : '<div class="item-image item-image-empty"></div>';
      return `
        <div class="item-row">
          ${imageMarkup}
          <div class="item-details">
            <div class="item-name">${escapeHtml(item.itemName || item.name || 'Item')}</div>
            <div class="muted">${escapeHtml(item.sku || item.description)}</div>
            <div class="muted">Description: ${escapeHtml(item.description || item.itemName || item.name || 'Unavailable')}</div>
            <div class="muted">Category: ${escapeHtml(item.category || 'Uncategorized')}</div>
            <div class="item-meta">Qty: ${escapeHtml(item.quantity)} &nbsp; | &nbsp; Amount: $${formatAmount(item.lineTotal ?? item.amount)}</div>
          </div>
        </div>`;
    }).join('')
    : '<p class="muted">No items available</p>';
  const quoteUrl = text(workOrder.s3Documents?.quote?.url || workOrder.quoteLink, '');
  const invoiceUrl = text(workOrder.s3Documents?.invoice?.url, '');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>New Work Order</title>
  <style>
    #${containerId} { font-family: Arial, sans-serif; font-size: 14px; line-height: 1.4; background: #fff; color: #333; max-width: 495px; margin: 1rem auto; padding: 0 10px; word-wrap: break-word; overflow-wrap: break-word; }
    #${containerId} .card { border-radius: 8px; border: 1px solid #e5e7eb; overflow: hidden; }
    #${containerId} .card-header { background: #4caf50; color: #fff; padding: 10px; text-align: center; font-weight: bold; font-size: 16px; }
    #${containerId} .card-body { padding: 15px; background: #f9f9f9; }
    #${containerId} .section-title { color: #4caf50; font-size: 16px; margin: 0 0 10px; }
    #${containerId} .field { margin: 5px 0; }
    #${containerId} .muted { color: #666; font-size: 12px; }
    #${containerId} .item-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid #e5e7eb; }
    #${containerId} .prod-img-wrap { position: relative; flex-shrink: 0; width: 58px; height: 58px; }
    #${containerId} .item-image { width: 58px; height: 58px; object-fit: contain; background: #fff; border: 1px solid #ddd; border-radius: 5px; flex: 0 0 58px; display: block; }
    #${containerId} .prod-img { width: 58px; height: 58px; object-fit: cover; border-radius: 5px; border: 1px solid #ddd; display: block; }
    #${containerId} .item-image-empty { background: #eee; }
    #${containerId} .prod-img-preview { position: absolute; z-index: 20; top: 50%; left: calc(100% + 0.75rem); width: 16rem; height: 16rem; padding: 0.35rem; border: 1px solid #cbd5e1; border-radius: 0.75rem; background: #fff; box-shadow: 0 14px 30px rgba(15, 23, 42, 0.2); opacity: 0; pointer-events: none; transform: translateY(-50%) scale(0.96); transform-origin: left center; transition: opacity 0.14s ease, transform 0.14s ease; }
    #${containerId} .prod-img-preview img { width: 100%; height: 100%; object-fit: contain; border-radius: 0.5rem; display: block; }
    #${containerId} .prod-img-wrap:hover .prod-img-preview, #${containerId} .prod-img-wrap:focus-within .prod-img-preview { opacity: 1; transform: translateY(-50%) scale(1); }
    #${containerId} .item-details { min-width: 0; }
    #${containerId} .item-name { font-weight: bold; }
    #${containerId} .item-meta { margin-top: 3px; font-size: 12px; }
    #${containerId} .links { display: grid; gap: 10px; margin-top: 18px; }
    #${containerId} .action { display: block; padding: 11px 14px; border-radius: 5px; color: #fff; text-align: center; text-decoration: none; font-weight: bold; }
    #${containerId} .action-quote { background: #c27a00; }
    #${containerId} .action-invoice { background: #2563eb; }
    #${containerId} .action-label { display: block; font-size: 11px; font-weight: normal; opacity: .9; margin-top: 2px; }
    #${containerId} .not-generated { margin: 0; color: #666; font-size: 13px; }
    @media (max-width: 360px) {
      #${containerId} { padding: 0 6px; }
      #${containerId} .card-body { padding: 12px; }
      #${containerId} .prod-img-preview { left: 50%; top: calc(100% + 0.75rem); transform: translateX(-50%) scale(0.96); transform-origin: top center; }
      #${containerId} .prod-img-wrap:hover .prod-img-preview, #${containerId} .prod-img-wrap:focus-within .prod-img-preview { transform: translateX(-50%) scale(1); }
    }
  </style>
</head>
<body>
  <div id="${containerId}" class="container-custom">
    <div class="card">
      <div class="card-header">NEW WORK ORDER CREATED</div>
      <div class="card-body">
        <div class="section-title">Work Order Details</div>
        <p class="field"><b>Sales Order ID:</b> ${escapeHtml(workOrder.salesOrderId)}</p>
        <p class="field"><b>Work Order ID:</b> ${escapeHtml(workOrder.workOrderNumber || workOrder.workOrderId)}</p>
        <p class="field"><b>Order Ref:</b> ${escapeHtml(workOrder.orderReferenceNumber)}</p>
        <p class="field"><b>Requested Date:</b> ${escapeHtml(workOrder.requestedLocalDateTime || workOrder.requestedAt || workOrder.createdAt)}</p>
        <div class="section-title">Customer Details</div>
        <p class="field"><b>Name:</b> ${escapeHtml(customer.displayName || workOrder.customerInfo?.name)}</p>
        <p class="field"><b>Email:</b> ${escapeHtml(customer.email || workOrder.customerInfo?.emailId)}</p>
        <div class="section-title">Order Items</div>
        ${itemRows}
        <p class="field"><b>Total Amount:</b> $${formatAmount(workOrder.totalAmount ?? workOrder.grandTotal)}</p>
        <p class="field"><b>Payment Status:</b> ${escapeHtml(workOrder.paymentStatus)}</p>
        <div class="links">
          ${quoteUrl ? `<a class="action action-quote" href="${escapeHtml(quoteUrl)}" target="_blank" rel="noopener">Open Quote<span class="action-label">View quotation PDF</span></a>` : '<p class="not-generated">Quote: Not generated</p>'}
          ${invoiceUrl ? `<a class="action action-invoice" href="${escapeHtml(invoiceUrl)}" target="_blank" rel="noopener">Open Invoice<span class="action-label">View invoice PDF</span></a>` : '<p class="not-generated">Invoice: Not generated</p>'}
          ${enrichedWorkOrder.quoteNumberRef ? `<p class="muted">Quotation: ${escapeHtml(enrichedWorkOrder.quoteNumberRef)}</p>` : ''}
          ${enrichedWorkOrder.invoiceNumberRef ? `<p class="muted">Invoice: ${escapeHtml(enrichedWorkOrder.invoiceNumberRef)}</p>` : ''}
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

export async function createAndUploadWorkOrderHtml({ workOrder, customer, enrichedWorkOrder, tenantId, workOrderId } = {}) {
  const html = buildWorkOrderHtml({ workOrder, customer, enrichedWorkOrder, workOrderId });
  const fileName = `work-order-${text(workOrderId || workOrder?.workOrderNumber, 'pending')}.html`;
  const upload = await uploadBufferToS3({
    body: Buffer.from(html, 'utf8'),
    fileName,
    folderName: `work-orders-${text(tenantId, 'unknown-tenant')}`,
    contentType: 'text/html; charset=utf-8',
    contentDisposition: 'inline',
    mimeType: 'htmlFile',
  });

  return { ...upload, html };
}
