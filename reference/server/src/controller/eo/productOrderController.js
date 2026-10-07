import { ObjectId } from 'mongodb';
import { logger } from '../../config/logger.js';
import { MASTER_DATA_CUSTOMERS_COLLECTION } from '../../models/tenant/masterDataCustomerModel.js';
import { MASTER_DATA_INVOICES_COLLECTION } from '../../models/tenant/masterDataInvoiceModel.js';
import { MASTER_DATA_QUOTES_COLLECTION } from '../../models/tenant/masterDataQuoteModel.js';
import { MASTER_DATA_WORK_ORDERS_COLLECTION } from '../../models/tenant/workOrderModel.js';
import { createWorkOrder } from '../../services/masterDataService.js';
import { decodeProductOrderKey } from '../../services/productOrderLinkService.js';
import { getTenantDb, getTenantRegistry } from '../../utils/tenantManager.js';

function normalizeText(value) {
  return String(value || '').trim();
}

function keyFromRequest(req) {
  return normalizeText(req.body?.key || req.query?.key);
}

function createHttpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function loadCustomerProfile(tenantDb, context) {
  if (!ObjectId.isValid(context.customer?.id)) {
    throw createHttpError('A valid customer ID is required.');
  }

  const customer = await tenantDb.collection(MASTER_DATA_CUSTOMERS_COLLECTION).findOne({
    _id: new ObjectId(context.customer.id),
    tenantId: context.tenantId,
    isDeleted: { $ne: true },
  });
  if (!customer) {
    throw createHttpError('The customer was not found for this order.', 404);
  }
  return customer;
}

function decodeContext(req) {
  const context = decodeProductOrderKey(keyFromRequest(req));
  if (!context) {
    throw createHttpError('The product-order key is invalid or has expired.', 404);
  }
  return context;
}

async function resolveTenantContext(context) {
  const tenant = await getTenantRegistry(context.botUserId);
  if (normalizeText(tenant?.tenantId) !== normalizeText(context.tenantId)) {
    throw createHttpError('The product-order key does not match the tenant.', 403);
  }
  return { tenant, tenantDb: await getTenantDb(context.botUserId) };
}

function productOrderItems(req) {
  const items = req.body?.cart?.items || req.body?.items;
  if (!Array.isArray(items) || items.length === 0 || items.length > 100) {
    throw createHttpError('Cart must contain between 1 and 100 items.');
  }

  return items.map((item, index) => {
    const sku = normalizeText(item?.sku);
    const quantity = Number(item?.quantity);
    const unitPrice = Number(item?.unitPrice);
    if (!sku || !Number.isFinite(quantity) || quantity <= 0 ||
      !Number.isFinite(unitPrice) || unitPrice < 0) {
      throw createHttpError(
        `A valid SKU, positive quantity, and non-negative unit price are required for cart item ${index + 1}.`,
      );
    }
    return {
      inventoryId: normalizeText(item?.inventoryId) || null,
      sku,
      productName: normalizeText(item?.productName || item?.name) || sku,
      itemName: normalizeText(item?.itemName || item?.productName || item?.name) || sku,
      description: normalizeText(item?.description),
      category: normalizeText(item?.category),
      type: normalizeText(item?.type),
      color: normalizeText(item?.color),
      finish: normalizeText(item?.finish),
      doorType: normalizeText(item?.doorType),
      glassDoor: item?.glassDoor == null ? null : Boolean(item.glassDoor),
      width: item?.width == null ? null : numberValue(item.width),
      height: item?.height == null ? null : numberValue(item.height),
      depth: item?.depth == null ? null : numberValue(item.depth),
      unit: normalizeText(item?.unit),
      unitPrice,
      quantity,
      lineTotal: Number((unitPrice * quantity).toFixed(2)),
      qtyAvailableNow: 0,
      remainingQty: quantity,
      leadTimeDays: Math.max(0, numberValue(item?.leadTimeDays)),
      imageUrl: normalizeText(item?.imageUrl),
      notes: normalizeText(item?.notes),
    };
  });
}

function numberValue(value, fallback = 0) {
  const parsed = Number(value?.toString?.() ?? value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function customerInfo(customer) {
  return {
    name: customer?.displayName || customer?.name,
    emailId: customer?.email,
    phNumber: customer?.phone || customer?.mobile,
  };
}

function sourcePayload(context) {
  return {
    orderSource: 'webpage',
    channel: 'product-order-webpage',
    questionKey: context.questionKey,
    answerKey: context.answerKey,
    sessionId: context.sessionId,
    taskId: context.taskId,
  };
}

function quoteArtifact(result = {}, fallback = null) {
  return {
    id: normalizeText(result.quoteId || result.quote?.id || fallback?.id) || null,
    number: normalizeText(result.quoteNumberRef || result.quote?.quoteNumber || fallback?.number) || null,
    url: normalizeText(
      result.quoteLink || result.quotePdf?.url || result.s3Documents?.quote?.url || fallback?.url,
    ) || null,
  };
}

function finalArtifacts(result = {}, quote = null) {
  return {
    workOrder: {
      number: normalizeText(result.workOrderNumber || result.workOrderId) || null,
      orderReferenceNumber: normalizeText(result.orderReferenceNumber) || null,
      source: 'webpage',
    },
    quote: quoteArtifact(result, quote),
    invoice: {
      id: normalizeText(result.invoiceId) || null,
      number: normalizeText(result.invoiceNumber || result.invoiceNumberRef) || null,
      url: normalizeText(result.invoiceUrl || result.invoicePdf?.url || result.s3Documents?.invoice?.url) || null,
    },
    paymentLink: {
      id: normalizeText(result.paymentLinkId) || null,
      url: normalizeText(result.paymentLink) || null,
    },
  };
}

async function loadAcceptedQuote(tenantDb, context, quoteId) {
  if (!ObjectId.isValid(quoteId) || !ObjectId.isValid(context.customer.id)) {
    throw createHttpError('A valid quotation ID is required.');
  }

  const quote = await tenantDb.collection(MASTER_DATA_QUOTES_COLLECTION).findOne({
    _id: new ObjectId(quoteId),
    tenantId: context.tenantId,
    customerId: new ObjectId(context.customer.id),
    isDeleted: { $ne: true },
  });
  if (!quote) {
    throw createHttpError('The quotation was not found for this customer.', 404);
  }
  return quote;
}

function quoteItems(quote) {
  const items = (quote.lineItems || []).map((item) => {
    const description = normalizeText(item.description);
    const skuFromDescription = description.match(/^SKU:\s*([^|]+)/i)?.[1];
    const sku = normalizeText(item.sku || item.itemId || skuFromDescription || description);
    const quantity = numberValue(item.quantity);
    const unitPrice = numberValue(item.rate);
    if (!sku || quantity <= 0 || unitPrice < 0) {
      throw createHttpError('The quotation does not contain valid product lines.');
    }
    return {
      sku,
      productName: normalizeText(item.name) || sku,
      itemName: normalizeText(item.name) || sku,
      description,
      quantity,
      unitPrice,
      lineTotal: Number((unitPrice * quantity).toFixed(2)),
      qtyAvailableNow: 0,
      remainingQty: quantity,
      leadTimeDays: 0,
    };
  });
  if (!items.length) {
    throw createHttpError('The quotation does not contain valid product lines.');
  }
  return items;
}

export async function getProductOrder(req, res, next) {
  try {
    const context = decodeContext(req);
    await resolveTenantContext(context);
    return res.json({
      status: 'success',
      data: {
        orderSource: context.orderSource,
        currencyCode: context.currencyCode,
        tierMultiplier: context.tierMultiplier ?? 1,
        questionKey: context.questionKey,
        answerKey: context.answerKey,
        logoUrl: context.logoUrl,
        customer: context.customer,
      },
    });
  } catch (error) {
    return next(error);
  }
}

export async function getProductOrderStatus(req, res, next) {
  try {
    const context = decodeContext(req);
    const { tenantDb } = await resolveTenantContext(context);
    await loadCustomerProfile(tenantDb, context);

    const workOrder = await tenantDb.collection(MASTER_DATA_WORK_ORDERS_COLLECTION).findOne({
      tenantId: context.tenantId,
      sessionId: context.sessionId,
      customerId: new ObjectId(context.customer.id),
      isDeleted: { $ne: true },
    });

    if (!workOrder) {
      return res.json({ status: 'success', data: { orderCreated: false } });
    }

    const quoteId = workOrder.quoteId && ObjectId.isValid(String(workOrder.quoteId))
      ? new ObjectId(String(workOrder.quoteId))
      : null;
    const invoiceId = workOrder.invoiceId && ObjectId.isValid(String(workOrder.invoiceId))
      ? new ObjectId(String(workOrder.invoiceId))
      : null;
    const [quote, invoice] = await Promise.all([
      quoteId
        ? tenantDb.collection(MASTER_DATA_QUOTES_COLLECTION).findOne({
          _id: quoteId,
          tenantId: context.tenantId,
          isDeleted: { $ne: true },
        })
        : null,
      invoiceId
        ? tenantDb.collection(MASTER_DATA_INVOICES_COLLECTION).findOne({
          _id: invoiceId,
          tenantId: context.tenantId,
          isDeleted: { $ne: true },
        })
        : null,
    ]);

    return res.json({
      status: 'success',
      data: {
        orderCreated: true,
        workOrder: {
          number: normalizeText(workOrder.workOrderNumber || workOrder.workOrderId) || null,
          orderReferenceNumber: normalizeText(workOrder.orderReferenceNumber) || null,
          source: 'webpage',
        },
        quote: quoteArtifact({}, quote ? {
          id: quote._id.toString(),
          number: quote.quoteNumber,
          url: quote.quotePdf?.url || quote.zohoEstimateUrl || workOrder.s3Documents?.quote?.url,
        } : null),
        invoice: {
          id: invoice?._id?.toString?.() || invoiceId?.toString() || null,
          number: normalizeText(invoice?.invoiceNumber) || null,
          url: normalizeText(
            workOrder.s3Documents?.invoice?.url ||
            invoice?.invoicePdf?.url ||
            invoice?.zohoInvoiceUrl,
          ) || null,
        },
        paymentLink: {
          id: normalizeText(workOrder.paymentLinkId) || null,
          url: normalizeText(workOrder.paymentLink) || null,
        },
      },
    });
  } catch (error) {
    return next(error);
  }
}

export async function createProductOrderQuote(req, res, next) {
  try {
    const context = decodeContext(req);
    const { tenant, tenantDb } = await resolveTenantContext(context);
    const customer = await loadCustomerProfile(tenantDb, context);
    const requestCurrency = normalizeText(req.body?.cart?.currencyCode).toUpperCase();
    if (requestCurrency && requestCurrency !== normalizeText(context.currencyCode).toUpperCase()) {
      throw createHttpError(
        `Cart currency ${requestCurrency} does not match order currency ${context.currencyCode}.`,
      );
    }
    const existingWorkOrder = await tenantDb.collection(MASTER_DATA_WORK_ORDERS_COLLECTION).findOne({
      tenantId: context.tenantId,
      sessionId: context.sessionId,
      isDeleted: { $ne: true },
    });
    if (existingWorkOrder) {
      throw createHttpError('This webpage order has already been confirmed.', 409);
    }

    const cart = productOrderItems(req);
    const quoteResult = await createWorkOrder({
      tenantDb,
      tenant,
      botUserId: context.botUserId,
      payload: {
        quoteOnly: true,
        sessionId: context.sessionId,
        databaseName: context.databaseName,
        customerInfo: customerInfo(customer),
        items: cart,
        customerRequestNotes: normalizeText(req.body?.customerRequestNotes),
        orderSource: 'webpage',
        sourcePayload: sourcePayload(context),
      },
      requestContext: { requestId: req.requestId, channel: 'product-order-webpage' },
    });

    return res.status(201).json({
      status: 'quote_created',
      data: { currencyCode: context.currencyCode, quote: quoteArtifact(quoteResult), cart },
    });
  } catch (error) {
    logger.error('Product-order quotation creation failed', {
      requestId: req.requestId,
      error: error?.message || String(error),
    });
    return next(error);
  }
}

export async function confirmProductOrder(req, res, next) {
  try {
    const context = decodeContext(req);
    const { tenant, tenantDb } = await resolveTenantContext(context);
    const customer = await loadCustomerProfile(tenantDb, context);
    const quote = await loadAcceptedQuote(tenantDb, context, normalizeText(req.body?.quoteId));
    const cart = quoteItems(quote);
    const existingWorkOrder = await tenantDb.collection(MASTER_DATA_WORK_ORDERS_COLLECTION).findOne({
      tenantId: context.tenantId,
      sessionId: context.sessionId,
      customerId: new ObjectId(context.customer.id),
      isDeleted: { $ne: true },
    });

    const workOrderResult = await createWorkOrder({
      tenantDb,
      tenant,
      botUserId: context.botUserId,
      payload: {
        quoteOnly: false,
        quoteId: quote._id.toString(),
        workOrderNumber: existingWorkOrder?.workOrderNumber,
        sessionId: context.sessionId,
        databaseName: context.databaseName,
        customerInfo: customerInfo(customer),
        items: cart,
        quoteAcceptedAt: new Date().toISOString(),
        quoteStatus: 'accepted',
        orderSource: 'webpage',
        sourcePayload: sourcePayload(context),
      },
      requestContext: { requestId: req.requestId, channel: 'product-order-webpage' },
    });
    const result = finalArtifacts(workOrderResult, {
      id: quote._id.toString(),
      number: quote.quoteNumber,
      url: quote.quotePdf?.url,
    });

    return res.status(existingWorkOrder ? 200 : 201).json({ status: 'completed', data: result });
  } catch (error) {
    logger.error('Product-order confirmation failed', {
      requestId: req.requestId,
      error: error?.message || String(error),
    });
    return next(error);
  }
}
