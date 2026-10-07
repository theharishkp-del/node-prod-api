import { getJson, putJson, postJson, requestHttp } from '../utils/httpClient.js';
import { ObjectId } from 'mongodb';
import xlsx from 'xlsx';
import { logger } from '../config/logger.js';
import { MASTER_DATA_CUSTOMERS_COLLECTION } from '../models/tenant/masterDataCustomerModel.js';
import { MASTER_DATA_TIERS_COLLECTION } from '../models/tenant/masterDataTierModel.js';
import { MASTER_DATA_QUOTES_COLLECTION } from '../models/tenant/masterDataQuoteModel.js';
import { MASTER_DATA_INVOICES_COLLECTION } from '../models/tenant/masterDataInvoiceModel.js';
import { MASTER_DATA_PAYMENTS_COLLECTION } from '../models/tenant/masterDataPaymentModel.js';
import { MASTER_DATA_WORK_ORDERS_COLLECTION } from '../models/tenant/workOrderModel.js';
import { MASTER_DATA_INVENTORY_COLLECTION } from '../models/tenant/masterDataInventoryModel.js';
import { notifyAdminsOfNewWorkOrder } from './workOrderAdminNotificationService.js';
import { ZOHO_CUSTOMERS_COLLECTION } from '../models/tenant/zohoCustomerModel.js';
import { ZOHO_INVOICES_COLLECTION } from '../models/tenant/zohoInvoiceModel.js';
import { ZOHO_PAYMENTS_COLLECTION } from '../models/tenant/zohoPaymentModel.js';
import { ZOHO_QUOTES_COLLECTION } from '../models/tenant/zohoQuoteModel.js';
import { deleteObjectFromS3, uploadBufferToS3 } from '../utils/s3Upload.js';
import { getTenantRegistry } from '../utils/tenantManager.js';
import { buildCustomerHistoryContext, buildCustomerHistoryUrl } from './customerHistoryLinkService.js';
import {
  checkEntitlementAvailability,
  consumeCsmAgent,
} from './botUsageHandle/index.js';
import { getTrialStatusForBot } from './planMasterService.js';
import { getValidZohoAccessToken } from './zohoOAuthService.js';

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 100;
const DEFAULT_ZOHO_SYNC_STATUS = 'not_synced';
const TEMP_PAYMENT_LINKS_COLLECTION = 'payment_gateway_links';
const TEMP_PAYMENT_LINK_REFERENCE = 'affd58979b088d37b07e4de46f851df3bfe07628';

const CUSTOMER_STATUSES = new Set(['active', 'inactive']);
const CUSTOMER_TYPES = new Set(['business', 'individual']);
const QUOTE_STATUSES = new Set(['draft', 'sent', 'accepted', 'declined', 'expired']);
const INVOICE_STATUSES = new Set(['draft', 'sent', 'partially_paid', 'paid', 'overdue', 'void']);
const PAYMENT_STATUSES = new Set(['pending', 'success', 'failed', 'refunded']);
const PAYMENT_MODES = new Set(['cash', 'bank_transfer', 'upi', 'card', 'cheque', 'payment_gateway']);
const DEFAULT_TIER_KEY = 'T1';
const DEFAULT_TIER_DEFINITIONS = [
  { tierKey: 'T1', tierName: 'Tier 1 (Retail Homeowner)', multiplier: 0.45 },
  { tierKey: 'T2', tierName: 'Tier 2 (Small Contractor)', multiplier: 0.32 },
  { tierKey: 'T3', tierName: 'Tier 3 (Builder/Designer)', multiplier: 0.30 },
  { tierKey: 'T4', tierName: 'Tier 4 (Investor/Repeat GC)', multiplier: 0.29 },
  { tierKey: 'T5', tierName: 'Tier 5 (Bulk/Partner)', multiplier: 0.28 },
];

function createHttpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeOptionalText(value) {
  const normalized = normalizeText(value);
  return normalized || null;
}

function isCybotPlaceholderEmail(value) {
  const normalized = normalizeText(value);

  return Boolean(normalized) && !normalized.includes('@') && /_cybot_world$/i.test(normalized);
}

function isSyntheticLocalEmail(value) {
  const normalized = normalizeText(value).toLowerCase();

  return Boolean(normalized) && normalized.endsWith('@cybot.local');
}

function normalizeCustomerEmail(value) {
  const normalizedEmail = normalizeOptionalText(value);

  if (
    !normalizedEmail ||
    isCybotPlaceholderEmail(normalizedEmail) ||
    isSyntheticLocalEmail(normalizedEmail) ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
  ) {
    return null;
  }

  return normalizedEmail.toLowerCase();
}

function hasOwnValue(payload, fieldName) {
  return Object.prototype.hasOwnProperty.call(payload || {}, fieldName);
}

function normalizeRequiredText(value, fieldName) {
  const normalized = normalizeText(value);

  if (!normalized) {
    throw createHttpError(`${fieldName} is required.`);
  }

  return normalized;
}

function parseDate(value, fieldName) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw createHttpError(`${fieldName} must be a valid date.`);
  }

  return parsed;
}

function parsePositiveNumber(value, fieldName, { allowZero = false } = {}) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || (!allowZero && parsed <= 0) || (allowZero && parsed < 0)) {
    throw createHttpError(`${fieldName} must be a valid ${allowZero ? 'non-negative' : 'positive'} number.`);
  }

  return parsed;
}

function parseDecimalNumber(value, fieldName, { allowZero = true } = {}) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || (!allowZero && parsed <= 0) || (allowZero && parsed < 0)) {
    throw createHttpError(`${fieldName} must be a valid ${allowZero ? 'non-negative' : 'positive'} number.`);
  }

  return Number(parsed.toFixed(4));
}

function toObjectId(value, fieldName = 'id') {
  const normalized = normalizeText(value);

  if (!ObjectId.isValid(normalized)) {
    throw createHttpError(`${fieldName} is not valid.`, 400);
  }

  return new ObjectId(normalized);
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
}

function parsePagination(query = {}) {
  const page = Math.max(DEFAULT_PAGE, Number.parseInt(String(query.page || DEFAULT_PAGE), 10) || DEFAULT_PAGE);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number.parseInt(String(query.pageSize || DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE)
  );

  return {
    page,
    pageSize,
    skip: (page - 1) * pageSize,
  };
}

function buildPagedResponse(items, total, page, pageSize) {
  return {
    items,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      hasNextPage: page * pageSize < total,
      hasPreviousPage: page > 1,
    },
  };
}

async function generateCustomerCode(tenantDb) {
  const latestCustomer = await tenantDb.collection(MASTER_DATA_CUSTOMERS_COLLECTION)
    .find({
      customerCode: { $regex: /^CUST-\d+$/i },
    })
    .sort({ createdAt: -1, _id: -1 })
    .limit(1)
    .next();

  const lastNumber = latestCustomer?.customerCode
    ? Number.parseInt(String(latestCustomer.customerCode).replace(/^CUST-/i, ''), 10)
    : 0;
  const nextNumber = Number.isFinite(lastNumber) ? lastNumber + 1 : 1;

  return `CUST-${String(nextNumber).padStart(6, '0')}`;
}

function parseBotMasterKeyHeader(req) {
  const rawValue = req.header('x-bot-master-key');

  if (!rawValue) {
    return null;
  }

  try {
    return JSON.parse(rawValue);
  } catch {
    throw createHttpError('x-bot-master-key header is not valid JSON.');
  }
}

function parseEncodedCustomerHistoryContext(encodedValue) {
  const normalizedValue = normalizeText(encodedValue);

  if (!normalizedValue) {
    throw createHttpError('customer context is required.', 400);
  }

  try {
    const parsed = JSON.parse(Buffer.from(normalizedValue, 'base64').toString('utf8'));

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Decoded customer context is not a valid object.');
    }

    return buildCustomerHistoryContext(parsed);
  } catch (error) {
    throw createHttpError(`customer context is not valid. ${error?.message || ''}`.trim(), 400);
  }
}

function buildContext({ tenant, botUserId }) {
  return {
    tenantId: tenant?.tenantId || '',
    botUserId: String(botUserId || '').trim(),
  };
}

function extractTemporaryPaymentLink(document) {
  const source = document && typeof document === 'object' ? document : {};
  const paymentLink = normalizeOptionalText(
    source.paymentLink ||
    source.url ||
    source.link ||
    source.paymentUrl ||
    source.checkoutUrl
  );
  const paymentLinkId = normalizeOptionalText(
    source.paymentLinkId ||
    source.referenceNumber ||
    source.reference ||
    source.linkReference ||
    source._id
  );

  if (!paymentLink) {
    return null;
  }

  return {
    paymentLinkId: paymentLinkId || TEMP_PAYMENT_LINK_REFERENCE,
    paymentLink,
  };
}

async function findTemporaryPaymentGatewayLink(tenantDb, { tenantId = '', databaseName = '' } = {}) {
  const collection = tenantDb.collection(TEMP_PAYMENT_LINKS_COLLECTION);
  const normalizedTenantId = normalizeOptionalText(tenantId);
  const normalizedDatabaseName = normalizeOptionalText(databaseName);
  const baseReferenceFilters = [
    { reference: TEMP_PAYMENT_LINK_REFERENCE },
    { paymentLinkId: TEMP_PAYMENT_LINK_REFERENCE },
    { referenceNumber: TEMP_PAYMENT_LINK_REFERENCE },
    { linkReference: TEMP_PAYMENT_LINK_REFERENCE },
  ];
  const scopedFilters = [];

  for (const referenceFilter of baseReferenceFilters) {
    if (normalizedTenantId && normalizedDatabaseName) {
      scopedFilters.push({
        ...referenceFilter,
        tenantId: normalizedTenantId,
        databaseName: normalizedDatabaseName,
      });
    }

    if (normalizedDatabaseName) {
      scopedFilters.push({
        ...referenceFilter,
        databaseName: normalizedDatabaseName,
      });
    }

    if (normalizedTenantId) {
      scopedFilters.push({
        ...referenceFilter,
        tenantId: normalizedTenantId,
      });
    }

    scopedFilters.push(referenceFilter);
  }

  for (const filter of scopedFilters) {
    const document = await collection.findOne(filter);
    const resolvedLink = extractTemporaryPaymentLink(document);

    if (resolvedLink) {
      return resolvedLink;
    }
  }

  const fallbackScopes = [];

  if (normalizedTenantId && normalizedDatabaseName) {
    fallbackScopes.push({ tenantId: normalizedTenantId, databaseName: normalizedDatabaseName });
  }

  if (normalizedDatabaseName) {
    fallbackScopes.push({ databaseName: normalizedDatabaseName });
  }

  if (normalizedTenantId) {
    fallbackScopes.push({ tenantId: normalizedTenantId });
  }

  fallbackScopes.push({});

  for (const scope of fallbackScopes) {
    const fallbackDocument = await collection.find(scope).sort({ updatedAt: -1, createdAt: -1 }).limit(1).next();
    const resolvedLink = extractTemporaryPaymentLink(fallbackDocument);

    if (resolvedLink) {
      return resolvedLink;
    }
  }

  return null;
}

async function resolveMasterRegistryUserId(tenant, botUserId, requestContext = {}, payload = {}, customer = null) {
  const registryEntry = normalizeText(botUserId)
    ? await getTenantRegistry(botUserId)
    : null;

  return (
    normalizeText(registryEntry?.userId) ||
    normalizeText(registryEntry?.botMasterKey?.userId) ||
    normalizeText(tenant?.userId) ||
    normalizeText(tenant?.botMasterKey?.userId) ||
    normalizeText(requestContext.userId) ||
    normalizeText(payload?.reqMessageObj?.fromId) ||
    normalizeText(payload?.fromId) ||
    normalizeText(customer?.cybotUserId)
  );
}

async function consumeWorkOrderUsage({
  tenant,
  customer,
  payload,
  botUserId,
  requestContext = {},
}) {
  const userId = await resolveMasterRegistryUserId(
    tenant,
    botUserId,
    requestContext,
    payload,
    customer,
  );
  const databaseName =
    normalizeText(requestContext.databaseName) ||
    normalizeText(payload?.sourcePayload?.reqMessageObj?.databaseName) ||
    normalizeText(payload?.sourcePayload?.databaseInfo?.requestDatabaseName) ||
    normalizeText(payload?.databaseName) ||
    normalizeText(payload?.reqMessageObj?.databaseName) ||
    normalizeText(tenant?.databaseName) ||
    normalizeText(tenant?.botMasterKey?.databaseName);

  if (!userId || !botUserId || !databaseName) {
    logger.warn('Skipping work order entitlement consumption because usage context is incomplete', {
      botUserId,
      userId,
      databaseName,
      tenantId: tenant?.tenantId || '',
    });
    return;
  }

  const trialStatus = await getTrialStatusForBot(botUserId);
  if (trialStatus) {
    logger.info('Skipping work order entitlement consumption for trial bot', {
      botUserId,
      userId,
      databaseName,
      tenantId: tenant?.tenantId || '',
      trialEndDate: trialStatus.endDate,
    });
    return;
  }

  await consumeCsmAgent(
    {
      requestId: requestContext.requestId || '',
      body: {
        userId,
        botUserId,
        databaseName,
        usageDate: requestContext.usageDate || payload?.workOrderDate || payload?.createdAt,
      },
    },
    'work_orders',
  );
}

async function ensureWorkOrderAvailability({
  tenant,
  customer,
  payload,
  botUserId,
  requestContext = {},
}) {
  const userId = await resolveMasterRegistryUserId(
    tenant,
    botUserId,
    requestContext,
    payload,
    customer,
  );
  const databaseName =
    normalizeText(requestContext.databaseName) ||
    normalizeText(payload?.sourcePayload?.reqMessageObj?.databaseName) ||
    normalizeText(payload?.sourcePayload?.databaseInfo?.requestDatabaseName) ||
    normalizeText(payload?.databaseName) ||
    normalizeText(payload?.reqMessageObj?.databaseName) ||
    normalizeText(tenant?.databaseName) ||
    normalizeText(tenant?.botMasterKey?.databaseName);

  if (!userId || !botUserId || !databaseName) {
    logger.warn('Skipping work order availability check because usage context is incomplete', {
      botUserId,
      userId,
      databaseName,
      tenantId: tenant?.tenantId || '',
    });
    return;
  }

  const trialStatus = await getTrialStatusForBot(botUserId);
  if (trialStatus) {
    logger.info('Skipping work order availability check for trial bot', {
      botUserId,
      userId,
      databaseName,
      tenantId: tenant?.tenantId || '',
      trialEndDate: trialStatus.endDate,
    });
    return;
  }

  const response = await checkEntitlementAvailability(
    {
      requestId: requestContext.requestId || '',
      body: {
        userId,
        botUserId,
        databaseName,
        usageDate: requestContext.usageDate || payload?.workOrderDate || payload?.createdAt,
      },
    },
    'work_orders',
  );

  const availabilityEntry = Array.isArray(response?.postPerDate)
    ? response.postPerDate[0]
    : null;
  const canCreateWorkOrder =
    availabilityEntry?.post === true &&
    String(availabilityEntry?.result_code ?? '') === '0';

  if (canCreateWorkOrder) {
    return;
  }

  throw createHttpError(
    availabilityEntry?.result_text || 'Work order limit exceeded for this period.',
    403,
  );
}

async function resolveCustomerForHistoryAccess(tenantDb, context, encodedCustomerContext) {
  const customerContext = parseEncodedCustomerHistoryContext(encodedCustomerContext);
  const customerId = normalizeText(customerContext.customerId);
  const cybotUserId = normalizeText(customerContext.cybotUserId);
  const filter = {
    tenantId: context.tenantId,
    isDeleted: { $ne: true },
  };

  if (customerId && ObjectId.isValid(customerId)) {
    filter._id = new ObjectId(customerId);
  } else if (cybotUserId) {
    filter.cybotUserId = cybotUserId;
  } else {
    throw createHttpError('customer context is missing a valid customer identifier.', 400);
  }

  const customer = await tenantDb.collection(MASTER_DATA_CUSTOMERS_COLLECTION).findOne(filter);

  if (!customer) {
    throw createHttpError('Customer history was not found.', 404);
  }

  if (cybotUserId && normalizeText(customer.cybotUserId) && normalizeText(customer.cybotUserId) !== cybotUserId) {
    throw createHttpError('Customer history access is not valid for this customer.', 403);
  }

  return customer;
}

function isZohoAutoSyncEnabled(tenant, botMasterKey = {}) {
  const refreshToken = String(
    tenant?.zohoBooks?.auth?.refreshToken ||
    tenant?.zohoBooks?.refreshToken ||
    botMasterKey?.refreshToken ||
    ''
  ).trim();
  const autoSyncEnabled = tenant?.zohoBooks?.autoSyncEnabled !== false;

  return Boolean(refreshToken) && autoSyncEnabled;
}

async function runBestEffortZohoSync({ entityName, entityId, context, syncOperation }) {
  try {
    const result = await syncOperation();

    if (!result?.ok) {
      logger.warn(`Automatic Zoho sync failed for ${entityName}`, {
        botUserId: context.botUserId,
        tenantId: context.tenantId,
        [`${entityName}Id`]: entityId,
        errorMessage: result?.errorMessage || 'Unknown sync error.',
      });
      return null;
    }

    logger.info(`Automatic Zoho sync completed for ${entityName}`, {
      botUserId: context.botUserId,
      tenantId: context.tenantId,
      [`${entityName}Id`]: entityId,
    });

    return result;
  } catch (error) {
    logger.warn(`Automatic Zoho sync threw an error for ${entityName}`, {
      botUserId: context.botUserId,
      tenantId: context.tenantId,
      [`${entityName}Id`]: entityId,
      errorMessage: error?.message || 'Unknown sync error.',
    });
    return null;
  }
}

function buildNeedsZohoResyncFields(overrideFields = {}) {
  return {
    ...overrideFields,
    zohoSyncStatus: DEFAULT_ZOHO_SYNC_STATUS,
    zohoLastSyncedAt: null,
    zohoErrorMessage: null,
  };
}

function serializeDocument(document) {
  if (!document) {
    return null;
  }

  const { _id, customerId, quoteId, invoiceId, tierId, ...rest } = document;

  return {
    id: _id?.toString(),
    ...rest,
    customerId: customerId instanceof ObjectId ? customerId.toString() : customerId,
    quoteId: quoteId instanceof ObjectId ? quoteId.toString() : quoteId,
    invoiceId: invoiceId instanceof ObjectId ? invoiceId.toString() : invoiceId,
    tierId: tierId instanceof ObjectId ? tierId.toString() : tierId,
  };
}

function serializeCustomerHistoryCustomer(document) {
  return {
    id: document?._id?.toString?.() || '',
    displayName: normalizeText(document?.displayName) || 'Customer',
    customerCode: normalizeOptionalText(document?.customerCode),
    companyName: normalizeOptionalText(document?.companyName),
    email: normalizeOptionalText(document?.email),
    phone: normalizeOptionalText(document?.phone || document?.mobile),
    cybotUserId: normalizeOptionalText(document?.cybotUserId),
  };
}

function serializeObjectIdArray(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return values.map((value) => (value instanceof ObjectId ? value.toString() : String(value || '').trim())).filter(Boolean);
}

function serializeWorkOrderDocument(document) {
  if (!document) {
    return null;
  }

  const isLegacyShapedDocument = !normalizeText(document.workOrderNumber) && normalizeText(document.workOrderId);
  const serialized = serializeDocument(document);

  if (isLegacyShapedDocument) {
    const customerName = normalizeText(document?.customerInfo?.name);
    const customerEmail = normalizeText(document?.customerInfo?.emailId);
    const customerPhone = normalizeText(document?.customerInfo?.phNumber);
    const fallbackCustomerId = customerEmail || customerPhone || customerName || '';
    const legacyItems = Array.isArray(document.items) ? document.items : [];
    const totalTasks = legacyItems.length;

    return {
      ...serialized,
      workOrderNumber: normalizeText(document.workOrderId),
      customerId: fallbackCustomerId,
      customerDisplayName: customerName || fallbackCustomerId,
      customerCode: null,
      quoteId: normalizeOptionalText(document.quoteId),
      quoteNumberRef: normalizeOptionalText(document.quoteReferenceNumber),
      invoiceId: normalizeOptionalText(document.invoiceId),
      invoiceNumberRef: normalizeOptionalText(document.invoiceReferenceNumber),
      paymentIds: serializeObjectIdArray(document.paymentIds),
      branchId: normalizeOptionalText(document.branchId),
      deliveryMode: normalizeText(document.deliveryMode || document.fulfillmentMode),
      requestedAt: document.requestedAt || document.createdAt || null,
      totalAmount: Number(document.totalAmount ?? document.grandTotal ?? document.subtotal ?? 0),
      paidAmount: document.paidAmount != null ? Number(document.paidAmount) : 0,
      balanceAmount: document.balanceAmount != null
        ? Number(document.balanceAmount)
        : Number(document.grandTotal ?? document.subtotal ?? 0),
      customerRequestNotes:
        normalizeOptionalText(document.customerRequestNotes) ||
        normalizeOptionalText(document.notes) ||
        normalizeOptionalText(document?.sourcePayload?.userMessage),
      internalNotes: normalizeOptionalText(document.internalNotes),
      lineItems: legacyItems,
      taskSummary: document.taskSummary || {
        totalTasks,
        pendingTasks: totalTasks,
        inProgressTasks: 0,
        completedTasks: 0,
        cancelledTasks: 0,
      },
      statusTimeline: Array.isArray(document.statusTimeline) ? document.statusTimeline : [],
    };
  }

  return {
    ...serialized,
    paymentIds: serializeObjectIdArray(document.paymentIds),
    lineItems: Array.isArray(document.lineItems) ? document.lineItems : [],
    taskSummary: document.taskSummary || null,
    statusTimeline: Array.isArray(document.statusTimeline) ? document.statusTimeline : [],
  };
}

function serializeCustomerHistoryItems(lineItems = []) {
  return (Array.isArray(lineItems) ? lineItems : [])
    .map((lineItem) => ({
      name: normalizeText(lineItem?.name || lineItem?.itemName),
      quantity: Number(lineItem?.quantity || 0),
    }))
    .filter((lineItem) => lineItem.name);
}

function buildCustomerHistoryDateCandidates({
  workOrder,
  quote,
  invoice,
  payments,
}) {
  const paymentDates = (Array.isArray(payments) ? payments : []).flatMap((payment) => [
    payment?.updatedAt,
    payment?.createdAt,
    payment?.paymentDate,
  ]);

  return [
    workOrder?.updatedAt,
    workOrder?.createdAt,
    workOrder?.requestedAt,
    quote?.updatedAt,
    quote?.createdAt,
    quote?.quoteDate,
    invoice?.updatedAt,
    invoice?.createdAt,
    invoice?.invoiceDate,
    ...paymentDates,
  ]
    .map((value) => new Date(value || 0))
    .filter((value) => !Number.isNaN(value.getTime()));
}

function resolveLatestHistoryActivityAt(input = {}) {
  const dateCandidates = buildCustomerHistoryDateCandidates(input);

  if (!dateCandidates.length) {
    return null;
  }

  return new Date(Math.max(...dateCandidates.map((value) => value.getTime()))).toISOString();
}

function serializeCustomerHistoryQuote(quote) {
  if (!quote) {
    return null;
  }

  return {
    quoteNumber: normalizeText(quote.quoteNumber) || null,
    status: normalizeText(quote.status) || null,
    quoteDate: quote.quoteDate || null,
    expiryDate: quote.expiryDate || null,
    accepted: normalizeText(quote.status).toLowerCase() === 'accepted',
    acceptedAt:
      normalizeText(quote.status).toLowerCase() === 'accepted'
        ? (quote.updatedAt || quote.quoteDate || null)
        : null,
    grandTotal: Number.isFinite(Number(quote.grandTotal)) ? Number(quote.grandTotal) : null,
  };
}

function serializeCustomerHistoryInvoice(invoice) {
  if (!invoice) {
    return null;
  }

  return {
    invoiceNumber: normalizeText(invoice.invoiceNumber) || null,
    status: normalizeText(invoice.status) || null,
    invoiceDate: invoice.invoiceDate || null,
    dueDate: invoice.dueDate || null,
    grandTotal: Number.isFinite(Number(invoice.grandTotal)) ? Number(invoice.grandTotal) : null,
    paidAmount: Number.isFinite(Number(invoice.paidAmount)) ? Number(invoice.paidAmount) : null,
    balanceAmount: Number.isFinite(Number(invoice.balanceAmount)) ? Number(invoice.balanceAmount) : null,
  };
}

function serializeCustomerHistoryDocumentLink(s3Document = null) {
  const url = normalizeOptionalText(s3Document?.url);
  const fileName = normalizeOptionalText(s3Document?.fileName);

  if (!url) {
    return null;
  }

  return {
    url,
    fileName,
  };
}

function serializeCalendarDocumentLink(s3Document = null) {
  return serializeCustomerHistoryDocumentLink(s3Document);
}

function serializeCalendarEventDate(value) {
  const parsed = new Date(value || 0);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function serializeCalendarWorkOrderEvent(workOrder = {}, customer = null) {
  const eventDate =
    serializeCalendarEventDate(workOrder.requestedAt) ||
    serializeCalendarEventDate(workOrder.createdAt) ||
    serializeCalendarEventDate(workOrder.updatedAt);

  return {
    id: `work_order_${workOrder?._id?.toString?.() || ''}`,
    entityId: workOrder?._id?.toString?.() || '',
    eventType: 'work_order_conversion',
    title: normalizeText(workOrder.orderReferenceNumber) || normalizeText(workOrder.workOrderNumber) || 'Work order',
    subtitle: normalizeText(customer?.displayName) || normalizeText(workOrder.customerInfo?.name) || 'Customer',
    startAt: eventDate,
    status: normalizeText(workOrder.paymentStatus) || normalizeText(workOrder.status) || 'open',
    amount: Number.isFinite(Number(workOrder.totalAmount ?? workOrder.grandTotal))
      ? Number(workOrder.totalAmount ?? workOrder.grandTotal)
      : null,
    orderReferenceNumber: normalizeOptionalText(workOrder.orderReferenceNumber),
    customerId: workOrder?.customerId?.toString?.() || '',
  };
}

function serializeCalendarCustomerEvent(customer = {}) {
  const eventDate =
    serializeCalendarEventDate(customer.createdAt) ||
    serializeCalendarEventDate(customer.updatedAt);

  return {
    id: `customer_${customer?._id?.toString?.() || ''}`,
    entityId: customer?._id?.toString?.() || '',
    eventType: 'customer_enquiry',
    title: normalizeText(customer.displayName) || normalizeText(customer.companyName) || 'Customer enquiry',
    subtitle: normalizeText(customer.customerCode) || normalizeText(customer.email) || 'Enquiry',
    startAt: eventDate,
    status: normalizeText(customer.status) || 'active',
    amount: null,
    orderReferenceNumber: null,
    customerId: customer?._id?.toString?.() || '',
  };
}

function serializeCalendarWorkOrderDetails({
  workOrder,
  customer,
  quote,
  invoice,
  payments,
}) {
  const serializedWorkOrder = serializeWorkOrderDocument(workOrder);
  const totalAmount = Number(serializedWorkOrder?.totalAmount ?? serializedWorkOrder?.grandTotal ?? 0);

  return {
    workOrder: {
      ...serializedWorkOrder,
      quotePdf: serializeCalendarDocumentLink(workOrder?.s3Documents?.quote),
      invoicePdf: serializeCalendarDocumentLink(workOrder?.s3Documents?.invoice),
    },
    customer: customer
      ? {
        ...serializeDocument(customer),
        displayName: normalizeText(customer.displayName) || null,
      }
      : null,
    quote: quote ? serializeDocument(quote) : null,
    invoice: invoice ? serializeDocument(invoice) : null,
    payments: (Array.isArray(payments) ? payments : []).map((payment) => serializeDocument(payment)),
    summary: {
      totalAmount: Number.isFinite(totalAmount) ? totalAmount : null,
      balanceAmount: Number.isFinite(Number(serializedWorkOrder?.balanceAmount))
        ? Number(serializedWorkOrder.balanceAmount)
        : null,
      paymentStatus: normalizeText(serializedWorkOrder?.paymentStatus) || null,
      totalProducts: Array.isArray(serializedWorkOrder?.lineItems)
        ? serializedWorkOrder.lineItems.length
        : (Array.isArray(serializedWorkOrder?.items) ? serializedWorkOrder.items.length : 0),
    },
  };
}

function serializeCustomerHistoryPayments(payments = []) {
  return (Array.isArray(payments) ? payments : [])
    .map((payment) => ({
      paymentNumber: normalizeText(payment.paymentNumber) || null,
      paymentDate: payment.paymentDate || null,
      amount: Number.isFinite(Number(payment.amount)) ? Number(payment.amount) : null,
      paymentMode: normalizeText(payment.paymentMode) || null,
      status: normalizeText(payment.status) || null,
      referenceNumber: normalizeOptionalText(payment.referenceNumber),
      gatewayProvider: normalizeOptionalText(payment.gatewayProvider),
    }))
    .sort((left, right) => {
      const rightTime = new Date(right.paymentDate || 0).getTime();
      const leftTime = new Date(left.paymentDate || 0).getTime();
      return rightTime - leftTime;
    });
}

function withCustomerHistoryUrl(document, botMasterKey, customer) {
  return {
    ...document,
    customerHistoryUrl: buildCustomerHistoryUrl(botMasterKey, customer),
  };
}

function applyWorkOrderSearch(items, searchTerm = '') {
  const normalizedSearch = normalizeText(searchTerm).toLowerCase();

  if (!normalizedSearch) {
    return items;
  }

  return items.filter((item) => {
    const candidates = [
      item.workOrderNumber,
      item.workOrderId,
      item.orderReferenceNumber,
      item.status,
      item.paymentStatus,
      item.deliveryMode,
      item.branchId,
      item.customerRequestNotes,
      item.customerDisplayName,
    ];

    return candidates.some((value) => normalizeText(value).toLowerCase().includes(normalizedSearch));
  });
}

function paginateItems(items, query = {}) {
  const { page, pageSize, skip } = parsePagination(query);
  const total = items.length;
  const pagedItems = items.slice(skip, skip + pageSize);

  return buildPagedResponse(pagedItems, total, page, pageSize);
}

function normalizeLineItems(lineItems) {
  if (!Array.isArray(lineItems) || lineItems.length === 0) {
    throw createHttpError('At least one line item is required.');
  }

  return lineItems.map((lineItem, index) => {
    const name = normalizeText(lineItem?.name);

    if (!name) {
      throw createHttpError(`lineItems[${index}].name is required.`);
    }

    const quantity = parsePositiveNumber(lineItem?.quantity, `lineItems[${index}].quantity`);
    const rate = parsePositiveNumber(lineItem?.rate, `lineItems[${index}].rate`, { allowZero: true });
    const discount = parsePositiveNumber(lineItem?.discount ?? 0, `lineItems[${index}].discount`, { allowZero: true });
    const taxPercentage = parsePositiveNumber(lineItem?.taxPercentage ?? 0, `lineItems[${index}].taxPercentage`, { allowZero: true });
    const baseAmount = quantity * rate;
    const discountedAmount = Math.max(baseAmount - discount, 0);
    const taxAmount = Number(((discountedAmount * taxPercentage) / 100).toFixed(2));
    const amount = Number((discountedAmount + taxAmount).toFixed(2));

    return {
      itemId: normalizeOptionalText(lineItem?.itemId),
      name,
      description: normalizeOptionalText(lineItem?.description),
      quantity,
      rate,
      discount,
      taxPercentage,
      taxAmount,
      amount,
    };
  });
}

function buildLineItemTotals(lineItems) {
  return lineItems.reduce(
    (totals, lineItem) => {
      totals.subTotal += lineItem.quantity * lineItem.rate;
      totals.discountTotal += lineItem.discount;
      totals.taxTotal += lineItem.taxAmount;
      totals.grandTotal += lineItem.amount;
      return totals;
    },
    { subTotal: 0, taxTotal: 0, discountTotal: 0, grandTotal: 0 }
  );
}

function getUtcDayRange(date = new Date()) {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1, 0, 0, 0, 0));

  return { start, end };
}

function parseCalendarRangeDate(value, fieldName) {
  const normalizedValue = normalizeText(value);

  if (!normalizedValue) {
    throw createHttpError(`${fieldName} is required.`);
  }

  const parsed = new Date(normalizedValue);

  if (Number.isNaN(parsed.getTime())) {
    throw createHttpError(`${fieldName} must be a valid date.`);
  }

  return parsed;
}

function resolveCalendarDateRange(query = {}) {
  const from = parseCalendarRangeDate(query.from, 'from');
  const to = parseCalendarRangeDate(query.to, 'to');

  if (from.getTime() > to.getTime()) {
    throw createHttpError('from date must be earlier than or equal to to date.');
  }

  return {
    from,
    to,
  };
}

function formatDateSegment(date = new Date()) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');

  return `${year}${month}${day}`;
}

function formatSequence(sequence) {
  return String(sequence).padStart(6, '0');
}

function buildWorkOrderNumber(sequence, date = new Date()) {
  return `WO-GOOD-${formatDateSegment(date)}-${formatSequence(sequence)}`;
}

function buildSalesOrderId(workOrderNumber) {
  const normalizedWorkOrderNumber = normalizeRequiredText(workOrderNumber, 'workOrderNumber');
  return `SO-${normalizedWorkOrderNumber}`;
}

function buildOrderReferenceNumber(sequence, date = new Date()) {
  return `ORD-${formatDateSegment(date)}-${formatSequence(sequence)}`;
}

function buildQuoteNumber(sequence, date = new Date()) {
  return `QTN-${formatDateSegment(date)}-${formatSequence(sequence)}`;
}

function buildInvoiceNumber(sequence, date = new Date()) {
  return `INV-${formatDateSegment(date)}-${formatSequence(sequence)}`;
}

function buildPaymentNumber(sequence, date = new Date()) {
  return `PAY-${formatDateSegment(date)}-${formatSequence(sequence)}`;
}

async function generateDailyWorkOrderSequence(tenantDb, tenantId, date = new Date()) {
  const { start, end } = getUtcDayRange(date);

  return tenantDb.collection(MASTER_DATA_WORK_ORDERS_COLLECTION).countDocuments({
    tenantId,
    isDeleted: { $ne: true },
    createdAt: {
      $gte: start,
      $lt: end,
    },
  }).then((count) => count + 1);
}

async function generateDailyCollectionSequence(tenantDb, collectionName, tenantId, date = new Date()) {
  const { start, end } = getUtcDayRange(date);

  return tenantDb.collection(collectionName).countDocuments({
    tenantId,
    isDeleted: { $ne: true },
    createdAt: {
      $gte: start,
      $lt: end,
    },
  }).then((count) => count + 1);
}

function normalizeAgentWorkOrderItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw createHttpError('At least one work-order item is required.');
  }

  return items.map((item, index) => {
    const itemName = normalizeRequiredText(item?.itemName, `items[${index}].itemName`);
    const sku = normalizeRequiredText(item?.sku, `items[${index}].sku`);
    const quantity = parsePositiveNumber(item?.quantity, `items[${index}].quantity`);
    const unitPrice = parseDecimalNumber(item?.unitPrice, `items[${index}].unitPrice`);
    const qtyAvailableNow = Math.max(0, Math.trunc(Number(item?.qtyAvailableNow ?? 0) || 0));
    const remainingQty = Math.max(0, Math.trunc(Number(item?.remainingQty ?? 0) || 0));
    const leadTimeDays = Math.max(0, Math.trunc(Number(item?.leadTimeDays ?? 0) || 0));
    const calculatedLineTotal = Number((quantity * unitPrice).toFixed(2));
    const lineTotal = item?.lineTotal == null
      ? calculatedLineTotal
      : parseDecimalNumber(item.lineTotal, `items[${index}].lineTotal`);

    return {
      inventoryId: normalizeOptionalText(item?.inventoryId),
      sku,
      productName: normalizeOptionalText(item?.productName),
      itemName,
      description: normalizeOptionalText(item?.description),
      category: normalizeOptionalText(item?.category),
      type: normalizeOptionalText(item?.type),
      color: normalizeOptionalText(item?.color),
      finish: normalizeOptionalText(item?.finish),
      doorType: normalizeOptionalText(item?.doorType),
      glassDoor: item?.glassDoor == null ? null : Boolean(item.glassDoor),
      width: item?.width == null ? null : parseDecimalNumber(item.width, `items[${index}].width`, { allowZero: true }),
      height: item?.height == null ? null : parseDecimalNumber(item.height, `items[${index}].height`, { allowZero: true }),
      depth: item?.depth == null ? null : parseDecimalNumber(item.depth, `items[${index}].depth`, { allowZero: true }),
      unit: normalizeOptionalText(item?.unit),
      unitPrice,
      quantity,
      lineTotal,
      qtyAvailableNow,
      remainingQty,
      leadTimeDays,
      availabilityNote: normalizeOptionalText(item?.availabilityNote),
      imageUrl: normalizeOptionalText(item?.imageUrl),
      notes: normalizeOptionalText(item?.notes),
    };
  });
}

function buildAgentSalesLineDescription(item = {}) {
  const existingDescription = normalizeOptionalText(item.description);
  if (/^SKU:\s*/i.test(existingDescription || '')) {
    return existingDescription;
  }
  const dimensions = [item.width, item.height, item.depth]
    .map((value) => value == null ? '' : String(value))
    .filter(Boolean)
    .join(' x ');
  return [
    `SKU: ${normalizeText(item.sku)}`,
    existingDescription,
    item.category ? `Category: ${item.category}` : null,
    item.type ? `Type: ${item.type}` : null,
    item.color ? `Color: ${item.color}` : null,
    item.finish ? `Finish: ${item.finish}` : null,
    item.doorType ? `Door Type: ${item.doorType}` : null,
    dimensions ? `Dimensions: ${dimensions}` : null,
    item.unit ? `Unit: ${item.unit}` : null,
  ].filter(Boolean).join(' | ');
}

async function attachInventoryImages(tenantDb, tenantId, botUserId, items) {
  const missingImageItems = items.filter((item) => !item.imageUrl);
  if (!missingImageItems.length) return items;

  const normalizeSkuForImageLookup = (value) => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const missingSkus = [...new Set(missingImageItems
    .map((item) => normalizeSkuForImageLookup(item.sku))
    .filter(Boolean))];
  const inventory = tenantDb.collection(MASTER_DATA_INVENTORY_COLLECTION);
  const baseFilter = {
    tenantId,
    normalizedSku: { $in: missingSkus },
    imageUrl: { $exists: true, $ne: null },
    isDeleted: { $ne: true },
    isActive: { $ne: false },
  };
  const projection = { sku: 1, normalizedSku: 1, imageUrl: 1, _id: 0 };
  const inventoryItems = await inventory.find(
    { ...baseFilter, ...(botUserId ? { botUserId } : {}) },
    { projection },
  ).toArray();
  const foundSkus = new Set(inventoryItems.map((item) => normalizeSkuForImageLookup(item.normalizedSku || item.sku)));
  const stillMissingSkus = missingSkus.filter((sku) => !foundSkus.has(sku));

  // Conversation orders may be created under a different bot-user context than
  // the inventory upload. Fall back to the tenant catalogue so order HTML uses
  // the same product images that cart selection resolves at display time.
  if (botUserId && stillMissingSkus.length) {
    const tenantFallbackItems = await inventory.find(
      { ...baseFilter, normalizedSku: { $in: stillMissingSkus } },
      { projection },
    ).toArray();
    inventoryItems.push(...tenantFallbackItems);
  }

  const imageBySku = new Map(inventoryItems.map((item) => [
    normalizeSkuForImageLookup(item.normalizedSku || item.sku),
    normalizeText(item.imageUrl),
  ]));
  return items.map((item) => ({
    ...item,
    imageUrl: item.imageUrl || imageBySku.get(normalizeSkuForImageLookup(item.sku)) || '',
  }));
}

async function resolveWorkOrderCustomer(tenantDb, tenantId, customerInfo = {}) {
  const email = normalizeText(customerInfo.emailId).toLowerCase();
  const phone = normalizeText(customerInfo.phNumber);
  const name = normalizeText(customerInfo.name);
  const filters = [];

  if (email) {
    filters.push({ email });
  }

  if (phone) {
    filters.push({ phone });
    filters.push({ mobile: phone });
  }

  if (name) {
    filters.push({ displayName: name });
  }

  if (!filters.length) {
    throw createHttpError('Customer information is required to create the work order.');
  }

  const customer = await tenantDb.collection(MASTER_DATA_CUSTOMERS_COLLECTION).findOne({
    tenantId,
    isDeleted: { $ne: true },
    $or: filters,
  });

  if (!customer) {
    throw createHttpError('Matching customer was not found for this work order.', 404);
  }

  return customer;
}

function buildAgentWorkOrderDocument({ context, payload, customer, items, now, sequence }) {
  const subtotal = Number(items.reduce((sum, item) => sum + item.lineTotal, 0).toFixed(2));
  const workOrderNumber = normalizeText(payload.workOrderNumber) || buildWorkOrderNumber(sequence, now);
  const salesOrderId = normalizeText(payload.salesOrderId) || buildSalesOrderId(workOrderNumber);
  const orderReferenceNumber = normalizeText(payload.orderReferenceNumber) || buildOrderReferenceNumber(sequence, now);
  const deliveryMode = normalizeText(payload.deliveryMode || payload.fulfillmentMode || 'WAREHOUSE_PICKUP');
  const quoteAcceptedAt = parseDate(payload.quoteAcceptedAt, 'quoteAcceptedAt') || now;
  const paymentLinkGeneratedAt = parseDate(payload.paymentLinkGeneratedAt, 'paymentLinkGeneratedAt');
  const paymentCompletedAt = parseDate(payload.paymentCompletedAt, 'paymentCompletedAt');
  const paymentStatus = paymentCompletedAt ? 'paid' : 'pending';
  const totalTasks = items.length;
  const requestedLocalDateTime = normalizeOptionalText(
    payload.requestedLocalDateTime ||
    payload.localDateTime ||
    payload?.sourcePayload?.metadata?.localDateTime ||
    payload?.sourcePayload?.reqMessageObj?.localDateTime,
  );
  const requestedLocalTimeZone = normalizeOptionalText(
    payload.requestedLocalTimeZone ||
    payload.localTimeZone ||
    payload?.sourcePayload?.metadata?.localTimeZone ||
    payload?.sourcePayload?.reqMessageObj?.localTimeZone,
  );
  const customerRequestNotes =
    normalizeOptionalText(payload.customerRequestNotes) ||
    normalizeOptionalText(payload.notes) ||
    normalizeOptionalText(payload?.sourcePayload?.userMessage);

  return {
    tenantId: context.tenantId,
    botUserId: context.botUserId,
    sessionId: normalizeOptionalText(payload.sessionId),
    orderSource: normalizeOptionalText(
      payload.orderSource || payload.sourceChannel || payload?.sourcePayload?.orderSource,
    ) || 'chat',
    databaseName: normalizeOptionalText(payload.databaseName),
    collectionName: normalizeOptionalText(payload.collectionName),
    orderReferenceNumber,
    workOrderNumber,
    workOrderId: workOrderNumber,
    salesOrderId,
    customerId: customer._id,
    customerInfo: {
      name: normalizeRequiredText(payload?.customerInfo?.name, 'customerInfo.name'),
      emailId: normalizeOptionalText(payload?.customerInfo?.emailId),
      phNumber: normalizeOptionalText(payload?.customerInfo?.phNumber),
    },
    quoteId: normalizeText(payload.quoteId) && ObjectId.isValid(normalizeText(payload.quoteId))
      ? new ObjectId(normalizeText(payload.quoteId))
      : null,
    invoiceId: null,
    paymentIds: [],
    branchId: normalizeOptionalText(payload.branchId),
    status: 'open',
    paymentStatus,
    dispatchStatus: null,
    pickupStatus: null,
    deliveryMode,
    requestedAt: parseDate(payload.requestedAt, 'requestedAt') || now,
    requestedLocalDateTime,
    requestedLocalTimeZone,
    quoteAcceptedAt,
    invoiceCreatedAt: null,
    paymentCompletedAt,
    productionStartedAt: null,
    readyForDispatchAt: null,
    dispatchedAt: null,
    pickedUpAt: null,
    closedAt: paymentCompletedAt,
    cancelledAt: null,
    cancellationReason: null,
    autoCancelledAfterDays: null,
    totalAmount: subtotal,
    paidAmount: paymentCompletedAt ? subtotal : 0,
    balanceAmount: paymentCompletedAt ? 0 : subtotal,
    creditAmountAddedBack: null,
    customerRequestNotes,
    internalNotes: normalizeOptionalText(payload.internalNotes),
    lineItems: items.map((item) => ({
      itemId: null,
      sku: item.sku,
      name: item.itemName,
      description: buildAgentSalesLineDescription(item),
      category: item.category,
      type: item.type,
      color: item.color,
      finish: item.finish,
      doorType: item.doorType,
      width: item.width,
      height: item.height,
      depth: item.depth,
      unit: item.unit,
      quantity: item.quantity,
      rate: item.unitPrice,
      discount: 0,
      taxPercentage: 0,
      taxAmount: 0,
      amount: item.lineTotal,
    })),
    taskSummary: {
      totalTasks,
      pendingTasks: totalTasks,
      inProgressTasks: 0,
      completedTasks: 0,
      cancelledTasks: 0,
    },
    statusTimeline: [
      {
        status: 'open',
        changedAt: now,
        changedBy: 'conversation-agent',
        notes: 'Work order created from booking confirmation.',
      },
    ],
    fulfillmentMode: deliveryMode,
    items,
    subtotal,
    grandTotal: subtotal,
    quoteStatus: normalizeText(payload.quoteStatus || 'ACCEPTED'),
    quoteLink: normalizeOptionalText(payload.quoteLink),
    paymentLinkId: normalizeOptionalText(payload.paymentLinkId),
    paymentLink: normalizeOptionalText(payload.paymentLink),
    paymentLinkGeneratedAt,
    sourcePayload: payload.sourcePayload ?? null,
    llmExtractedOrderData: payload.llmExtractedOrderData ?? null,
    notes: normalizeOptionalText(payload.notes),
    isDeleted: false,
    createdAt: now,
    updatedAt: now,
  };
}

function mapWorkOrderLineItemsToSalesLineItems(lineItems = []) {
  return (Array.isArray(lineItems) ? lineItems : []).map((lineItem) => ({
    name: normalizeRequiredText(lineItem?.name, 'lineItems.name'),
    description: buildAgentSalesLineDescription(lineItem),
    quantity: parsePositiveNumber(lineItem?.quantity, 'lineItems.quantity'),
    rate: parseDecimalNumber(lineItem?.rate, 'lineItems.rate', { allowZero: true }),
    discount: parseDecimalNumber(lineItem?.discount ?? 0, 'lineItems.discount', { allowZero: true }),
    taxPercentage: parseDecimalNumber(lineItem?.taxPercentage ?? 0, 'lineItems.taxPercentage', { allowZero: true }),
  }));
}

async function createSalesDocumentsForWorkOrder({
  tenantDb,
  tenant,
  botMasterKey = {},
  context,
  customer,
  workOrder,
}) {
  return ensureInvoiceAndPaymentForWorkOrder({
    tenantDb,
    tenant,
    botMasterKey,
    context,
    customer,
    workOrder,
  });
}

async function createStandaloneQuoteForAgentOrder({
  tenantDb,
  tenant,
  botMasterKey = {},
  context,
  customer,
  items,
  payload,
}) {
  const now = new Date();
  const quoteCollection = tenantDb.collection(MASTER_DATA_QUOTES_COLLECTION);
  const sessionId =
    normalizeOptionalText(payload?.sessionId) ||
    normalizeOptionalText(payload?.sourcePayload?.sessionInfo?.sessionId);
  const requestedQuoteId = normalizeText(payload?.quoteId);
  const quoteBasePayload = {
    customerId: customer._id.toString(),
    quoteDate: now,
    expiryDate: new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000)),
    lineItems: items.map((item) => ({
      name: item.itemName,
      description: buildAgentSalesLineDescription(item),
      quantity: item.quantity,
      rate: item.unitPrice,
      discount: 0,
      taxPercentage: 0,
    })),
    status: 'sent',
    notes:
      normalizeOptionalText(payload?.customerRequestNotes) ||
      normalizeOptionalText(payload?.notes) ||
      '',
    termsAndConditions: '',
    sessionId,
    sourcePayload: payload?.sourcePayload ?? null,
  };

  const existingQuote =
    (requestedQuoteId && ObjectId.isValid(requestedQuoteId)
      ? await quoteCollection.findOne({
        _id: new ObjectId(requestedQuoteId),
        tenantId: context.tenantId,
        customerId: customer._id,
        isDeleted: { $ne: true },
      })
      : null) ||
    (sessionId
      ? await quoteCollection.find({
        tenantId: context.tenantId,
        customerId: customer._id,
        sessionId,
        isDeleted: { $ne: true },
      }).sort({ updatedAt: -1, createdAt: -1 }).limit(1).next()
      : null);

  let quoteId;
  let quoteDocument;

  if (existingQuote) {
    quoteId = existingQuote._id;
    quoteDocument = buildQuotePayload({
      ...quoteBasePayload,
      quoteNumber: existingQuote.quoteNumber,
    }, context, existingQuote);
    await quoteCollection.updateOne(
      { _id: quoteId },
      { $set: quoteDocument }
    );
  } else {
    const quoteSequence = await generateDailyCollectionSequence(
      tenantDb,
      MASTER_DATA_QUOTES_COLLECTION,
      context.tenantId,
      now
    );
    const quoteNumber = buildQuoteNumber(quoteSequence, now);
    quoteDocument = buildQuotePayload({
      ...quoteBasePayload,
      quoteNumber,
    }, context);
    const quoteInsert = await quoteCollection.insertOne(quoteDocument);
    quoteId = quoteInsert.insertedId;
  }

  await ensureZohoCustomerForWorkOrderSales({
    tenantDb,
    tenant,
    botMasterKey,
    context,
    customer,
  });

  let latestQuote = await tenantDb.collection(MASTER_DATA_QUOTES_COLLECTION).findOne({
    _id: quoteId,
    tenantId: context.tenantId,
    isDeleted: { $ne: true },
  });

  if (isZohoAutoSyncEnabled(tenant, botMasterKey) && latestQuote) {
    latestQuote = await syncQuoteAndRefreshPdf({
      tenantDb,
      botMasterKey,
      context,
      quote: latestQuote,
    }) || latestQuote;
  }

  let quoteUrl = normalizeOptionalText(latestQuote?.quotePdf?.url);

  if (!quoteUrl && latestQuote && isZohoSynced(latestQuote, 'zohoEstimateId')) {
    try {
      const pdf = await fetchZohoPdfBuffer({
        botUserId: context.botUserId,
        botMasterKey,
        apiPath: `/books/v3/estimates/${encodeURIComponent(String(latestQuote.zohoEstimateId || '').trim())}`,
      });

      const s3Document = await uploadZohoPdfToStandaloneQuoteS3({
        tenantDb,
        tenantId: context.tenantId,
        quote: latestQuote,
        buffer: pdf.buffer,
        contentType: pdf.contentType,
      });

      quoteUrl = normalizeOptionalText(s3Document?.url);

      if (quoteUrl) {
        latestQuote = await tenantDb.collection(MASTER_DATA_QUOTES_COLLECTION).findOne({
          _id: quoteId,
          tenantId: context.tenantId,
          isDeleted: { $ne: true },
        }) || latestQuote;
      }
    } catch (error) {
      logger.warn('Standalone quote PDF S3 upload failed after Zoho sync', {
        botUserId: context.botUserId,
        tenantId: context.tenantId,
        quoteId: quoteId.toString(),
        errorMessage: error?.message || 'Unknown standalone quote PDF upload error.',
      });
    }
  }

  const enriched = await enrichCustomerReferences(
    tenantDb,
    [serializeDocument(latestQuote || { _id: quoteId, ...quoteDocument })]
  );
  quoteUrl = quoteUrl || normalizeOptionalText(
    latestQuote?.zohoEstimateUrl ||
    enriched[0]?.zohoEstimateUrl
  );

  return {
    quoteId,
    quote: enriched[0] || serializeDocument(latestQuote || { _id: quoteId, ...quoteDocument }),
    quoteUrl: quoteUrl || null,
  };
}

async function ensureZohoCustomerForWorkOrderSales({
  tenantDb,
  tenant,
  botMasterKey = {},
  context,
  customer,
}) {
  if (!isZohoAutoSyncEnabled(tenant, botMasterKey) || isZohoSynced(customer, 'zohoCustomerId')) {
    return;
  }

  await runBestEffortZohoSync({
    entityName: 'customer',
    entityId: customer._id.toString(),
    context,
    syncOperation: () => performCustomerZohoSync({
      tenantDb,
      tenantId: context.tenantId,
      botUserId: context.botUserId,
      botMasterKey,
      customer,
    }),
  });
}

async function createOrUpdateQuoteForWorkOrder({
  tenantDb,
  tenant,
  botMasterKey = {},
  context,
  customer,
  workOrder,
  quoteStatus = 'sent',
}) {
  const now = new Date();
  const quoteBasePayload = {
    customerId: customer._id.toString(),
    quoteDate: now,
    expiryDate: new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000)),
    lineItems: mapWorkOrderLineItemsToSalesLineItems(workOrder.lineItems),
    status: quoteStatus,
    notes:
      workOrder.customerRequestNotes ||
      workOrder.notes ||
      `Auto-created from work order ${workOrder.workOrderNumber}.`,
    termsAndConditions:
      quoteStatus === 'accepted'
        ? 'Auto-generated from confirmed work order.'
        : 'Auto-generated from order summary.',
  };
  const existingQuoteId = workOrder?.quoteId && ObjectId.isValid(String(workOrder.quoteId))
    ? new ObjectId(String(workOrder.quoteId))
    : null;
  const existingQuote = existingQuoteId
    ? await tenantDb.collection(MASTER_DATA_QUOTES_COLLECTION).findOne({
      _id: existingQuoteId,
      tenantId: context.tenantId,
      isDeleted: { $ne: true },
    })
    : null;

  let quoteId;
  let quoteDocument;
  let quoteNumber;

  if (existingQuote) {
    quoteId = existingQuote._id;
    quoteNumber = existingQuote.quoteNumber;
    quoteDocument = buildNeedsZohoResyncFields(
      buildQuotePayload(
        {
          ...quoteBasePayload,
          quoteNumber,
        },
        context,
        existingQuote
      )
    );
    await tenantDb.collection(MASTER_DATA_QUOTES_COLLECTION).updateOne(
      { _id: quoteId },
      { $set: quoteDocument }
    );
  } else {
    const quoteSequence = await generateDailyCollectionSequence(
      tenantDb,
      MASTER_DATA_QUOTES_COLLECTION,
      context.tenantId,
      now
    );
    quoteNumber = buildQuoteNumber(quoteSequence, now);
    quoteDocument = buildQuotePayload({
      ...quoteBasePayload,
      quoteNumber,
    }, context);
    const quoteInsert = await tenantDb.collection(MASTER_DATA_QUOTES_COLLECTION).insertOne(quoteDocument);
    quoteId = quoteInsert.insertedId;
  }

  await tenantDb.collection(MASTER_DATA_WORK_ORDERS_COLLECTION).updateOne(
    { _id: workOrder._id },
    {
      $set: {
        quoteId,
        quoteAcceptedAt: quoteStatus === 'accepted' ? now : (workOrder.quoteAcceptedAt || null),
        updatedAt: now,
      },
      $push: {
        statusTimeline: {
          status: workOrder.status || 'open',
          changedAt: now,
          changedBy: 'fsm-server',
          notes: existingQuote
            ? `Quote ${quoteNumber} updated for this work order.`
            : `Quote ${quoteNumber} created for this work order.`,
        },
      },
    }
  );

  await ensureZohoCustomerForWorkOrderSales({
    tenantDb,
    tenant,
    botMasterKey,
    context,
    customer,
  });

  let latestQuote = await tenantDb.collection(MASTER_DATA_QUOTES_COLLECTION).findOne({
    _id: quoteId,
    tenantId: context.tenantId,
    isDeleted: { $ne: true },
  });

  if (isZohoAutoSyncEnabled(tenant, botMasterKey) && latestQuote) {
    latestQuote = await syncQuoteAndRefreshPdf({
      tenantDb,
      botMasterKey,
      context,
      quote: latestQuote,
    }) || latestQuote;
  }

  const latestWorkOrder = await tenantDb.collection(MASTER_DATA_WORK_ORDERS_COLLECTION).findOne({
    _id: workOrder._id,
    tenantId: context.tenantId,
    isDeleted: { $ne: true },
  });
  const quoteUrl = normalizeOptionalText(latestWorkOrder?.s3Documents?.quote?.url);

  if (quoteUrl && latestWorkOrder?.quoteLink !== quoteUrl) {
    await tenantDb.collection(MASTER_DATA_WORK_ORDERS_COLLECTION).updateOne(
      { _id: workOrder._id },
      { $set: { quoteLink: quoteUrl, updatedAt: new Date() } }
    );
  }

  return {
    quoteId,
    quote: latestQuote || { _id: quoteId, ...quoteDocument },
    quoteUrl: quoteUrl || null,
  };
}

async function ensureInvoiceAndPaymentForWorkOrder({
  tenantDb,
  tenant,
  botMasterKey = {},
  context,
  customer,
  workOrder,
}) {
  const now = new Date();
  const quoteResult = await createOrUpdateQuoteForWorkOrder({
    tenantDb,
    tenant,
    botMasterKey,
    context,
    customer,
    workOrder,
    quoteStatus: 'accepted',
  });
  const refreshedWorkOrder = await tenantDb.collection(MASTER_DATA_WORK_ORDERS_COLLECTION).findOne({
    _id: workOrder._id,
    tenantId: context.tenantId,
    isDeleted: { $ne: true },
  }) || { ...workOrder, quoteId: quoteResult.quoteId };
  const existingInvoiceId = refreshedWorkOrder?.invoiceId && ObjectId.isValid(String(refreshedWorkOrder.invoiceId))
    ? new ObjectId(String(refreshedWorkOrder.invoiceId))
    : null;
  let existingInvoice = existingInvoiceId
    ? await tenantDb.collection(MASTER_DATA_INVOICES_COLLECTION).findOne({
      _id: existingInvoiceId,
      tenantId: context.tenantId,
      isDeleted: { $ne: true },
    })
    : null;

  let invoiceId;
  let invoiceDocument;

  if (existingInvoice) {
    invoiceId = existingInvoice._id;
    invoiceDocument = existingInvoice;
  } else {
    const invoiceSequence = await generateDailyCollectionSequence(
      tenantDb,
      MASTER_DATA_INVOICES_COLLECTION,
      context.tenantId,
      now
    );
    invoiceDocument = buildInvoicePayload({
      invoiceNumber: buildInvoiceNumber(invoiceSequence, now),
      customerId: customer._id.toString(),
      quoteId: quoteResult.quoteId.toString(),
      invoiceDate: now,
      dueDate: new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000)),
      lineItems: mapWorkOrderLineItemsToSalesLineItems(refreshedWorkOrder.lineItems || workOrder.lineItems),
      status: 'sent',
      notes: `Auto-created from quote ${quoteResult.quote?.quoteNumber || ''}.`.trim(),
      termsAndConditions: 'Payment pending confirmation.',
    }, context, null, 0);
    const invoiceInsert = await tenantDb.collection(MASTER_DATA_INVOICES_COLLECTION).insertOne(invoiceDocument);
    invoiceId = invoiceInsert.insertedId;
    existingInvoice = { _id: invoiceId, ...invoiceDocument };
  }

  const existingPaymentIds = Array.isArray(refreshedWorkOrder.paymentIds)
    ? refreshedWorkOrder.paymentIds.filter((value) => ObjectId.isValid(String(value)))
    : [];
  let paymentId = existingPaymentIds.length ? new ObjectId(String(existingPaymentIds[0])) : null;
  let paymentDocument = null;

  if (!paymentId) {
    const paymentSequence = await generateDailyCollectionSequence(
      tenantDb,
      MASTER_DATA_PAYMENTS_COLLECTION,
      context.tenantId,
      now
    );
    paymentDocument = buildPaymentPayload({
      paymentNumber: buildPaymentNumber(paymentSequence, now),
      customerId: customer._id.toString(),
      invoiceId: invoiceId.toString(),
      paymentDate: now,
      amount: Number(existingInvoice?.grandTotal ?? invoiceDocument?.grandTotal ?? 0),
      paymentMode: 'payment_gateway',
      status: 'pending',
      referenceNumber: refreshedWorkOrder.workOrderNumber || workOrder.workOrderNumber,
      gatewayProvider: 'zoho',
      notes: `Pending payment for work order ${refreshedWorkOrder.workOrderNumber || workOrder.workOrderNumber}.`,
    }, context);
    const paymentInsert = await tenantDb.collection(MASTER_DATA_PAYMENTS_COLLECTION).insertOne(paymentDocument);
    paymentId = paymentInsert.insertedId;
  }

  await syncInvoicePaymentSummary(tenantDb, invoiceId);

  await tenantDb.collection(MASTER_DATA_WORK_ORDERS_COLLECTION).updateOne(
    { _id: refreshedWorkOrder._id || workOrder._id },
    {
      $set: {
        invoiceId,
        paymentIds: [paymentId],
        invoiceCreatedAt: now,
        updatedAt: now,
      },
      $push: {
        statusTimeline: {
          status: refreshedWorkOrder.status || workOrder.status || 'open',
          changedAt: now,
          changedBy: 'fsm-server',
          notes: paymentDocument
            ? `Invoice ${invoiceDocument.invoiceNumber} and payment ${paymentDocument.paymentNumber} created.`
            : `Invoice ${invoiceDocument.invoiceNumber} already existed for this work order.`,
        },
      },
    }
  );

  let latestInvoice = await tenantDb.collection(MASTER_DATA_INVOICES_COLLECTION).findOne({
    _id: invoiceId,
    tenantId: context.tenantId,
    isDeleted: { $ne: true },
  });

  if (isZohoAutoSyncEnabled(tenant, botMasterKey) && latestInvoice) {
    latestInvoice = await syncInvoiceAndRefreshPdf({
      tenantDb,
      botMasterKey,
      context,
      invoice: latestInvoice,
    }) || latestInvoice;
  }

  const latestWorkOrder = await tenantDb.collection(MASTER_DATA_WORK_ORDERS_COLLECTION).findOne({
    _id: refreshedWorkOrder._id || workOrder._id,
    tenantId: context.tenantId,
    isDeleted: { $ne: true },
  });
  const invoiceUrl = normalizeOptionalText(latestWorkOrder?.s3Documents?.invoice?.url);

  logger.info('Sales documents created for work order', {
    botUserId: context.botUserId,
    tenantId: context.tenantId,
    workOrderId: refreshedWorkOrder.workOrderNumber || workOrder.workOrderNumber,
    quoteId: quoteResult.quoteId.toString(),
    invoiceId: invoiceId.toString(),
    paymentId: paymentId.toString(),
  });

  return {
    quoteId: quoteResult.quoteId,
    invoiceId,
    paymentId,
    invoiceNumber: normalizeText(existingInvoice?.invoiceNumber || invoiceDocument?.invoiceNumber) || null,
    quoteUrl: quoteResult.quoteUrl || null,
    invoiceUrl: invoiceUrl || null,
  };
}

async function ensureCustomerExists(tenantDb, customerId) {
  const customer = await tenantDb.collection(MASTER_DATA_CUSTOMERS_COLLECTION).findOne({
    _id: customerId,
    isDeleted: { $ne: true },
  });

  if (!customer) {
    throw createHttpError('Customer was not found.', 404);
  }

  return customer;
}

async function ensureQuoteExists(tenantDb, quoteId) {
  const quote = await tenantDb.collection(MASTER_DATA_QUOTES_COLLECTION).findOne({
    _id: quoteId,
    isDeleted: { $ne: true },
  });

  if (!quote) {
    throw createHttpError('Quote was not found.', 404);
  }

  return quote;
}

async function ensureInvoiceExists(tenantDb, invoiceId) {
  const invoice = await tenantDb.collection(MASTER_DATA_INVOICES_COLLECTION).findOne({
    _id: invoiceId,
    isDeleted: { $ne: true },
  });

  if (!invoice) {
    throw createHttpError('Invoice was not found.', 404);
  }

  return invoice;
}

async function findCustomerByIdOptional(tenantDb, customerId) {
  if (!customerId) {
    return null;
  }

  return tenantDb.collection(MASTER_DATA_CUSTOMERS_COLLECTION).findOne({
    _id: customerId,
    isDeleted: { $ne: true },
  });
}

async function findQuoteByIdOptional(tenantDb, quoteId) {
  if (!quoteId) {
    return null;
  }

  return tenantDb.collection(MASTER_DATA_QUOTES_COLLECTION).findOne({
    _id: quoteId,
    isDeleted: { $ne: true },
  });
}

async function findInvoiceByIdOptional(tenantDb, invoiceId) {
  if (!invoiceId) {
    return null;
  }

  return tenantDb.collection(MASTER_DATA_INVOICES_COLLECTION).findOne({
    _id: invoiceId,
    isDeleted: { $ne: true },
  });
}

function isZohoSynced(document, idFieldName) {
  return (
    String(document?.[idFieldName] || '').trim().length > 0
    && String(document?.zohoSyncStatus || '').trim().toLowerCase() === 'synced'
  );
}

function assertZohoCustomerReady(customer, entityLabel) {
  if (isZohoSynced(customer, 'zohoCustomerId')) {
    return;
  }

  throw createHttpError(`${entityLabel} requires a customer that is synced with Zoho Books.`, 409);
}

function assertZohoInvoiceReady(invoice, entityLabel) {
  if (isZohoSynced(invoice, 'zohoInvoiceId')) {
    return;
  }

  throw createHttpError(`${entityLabel} requires an invoice that is synced with Zoho Books.`, 409);
}

function assertLinkedQuoteReadyForInvoiceSync(quote) {
  if (!quote) {
    return;
  }

  if (isZohoSynced(quote, 'zohoEstimateId')) {
    return;
  }

  if (String(quote?.zohoSyncStatus || '').trim().toLowerCase() === 'failed') {
    throw createHttpError('Sync the linked quote to Zoho Books successfully before syncing this invoice.', 409);
  }
}

function assertPaymentAmountWithinInvoiceBalance({
  invoice,
  paymentAmount,
  paymentStatus,
  existingPayment = null,
}) {
  if (String(paymentStatus || '').trim().toLowerCase() !== 'success') {
    return;
  }

  const invoiceBalanceAmount = Number(invoice?.balanceAmount || 0);
  const previousAmountOnSameInvoice = (
    existingPayment
    && existingPayment.invoiceId?.toString() === invoice?._id?.toString()
    && String(existingPayment.status || '').trim().toLowerCase() === 'success'
  )
    ? Number(existingPayment.amount || 0)
    : 0;

  const allowedAmount = Number((invoiceBalanceAmount + previousAmountOnSameInvoice).toFixed(2));
  const normalizedPaymentAmount = Number(Number(paymentAmount || 0).toFixed(2));

  if (normalizedPaymentAmount > allowedAmount + 0.0001) {
    throw createHttpError(`Payment amount cannot exceed the invoice balance of ${allowedAmount.toFixed(2)}.`, 409);
  }
}

async function enrichCustomerReferences(tenantDb, items) {
  const customerIds = [...new Set(items.map((item) => item.customerId).filter(Boolean))]
    .map((id) => String(id).trim())
    .filter((id) => ObjectId.isValid(id))
    .map((id) => new ObjectId(id));

  if (!customerIds.length) {
    return items;
  }

  const customers = await tenantDb.collection(MASTER_DATA_CUSTOMERS_COLLECTION)
    .find({ _id: { $in: customerIds } })
    .project({ displayName: 1, customerCode: 1 })
    .toArray();

  const customerMap = new Map(customers.map((customer) => [customer._id.toString(), customer]));

  return items.map((item) => ({
    ...item,
    customerDisplayName: customerMap.get(item.customerId)?.displayName || '',
    customerCode: customerMap.get(item.customerId)?.customerCode || null,
  }));
}

async function enrichQuoteReferences(tenantDb, items) {
  const quoteIds = [...new Set(items.map((item) => item.quoteId).filter(Boolean))]
    .map((id) => String(id).trim())
    .filter((id) => ObjectId.isValid(id))
    .map((id) => new ObjectId(id));

  if (!quoteIds.length) {
    return items;
  }

  const quotes = await tenantDb.collection(MASTER_DATA_QUOTES_COLLECTION)
    .find({ _id: { $in: quoteIds } })
    .project({ quoteNumber: 1 })
    .toArray();

  const quoteMap = new Map(quotes.map((quote) => [quote._id.toString(), quote.quoteNumber]));

  return items.map((item) => ({
    ...item,
    quoteNumberRef: item.quoteId ? (quoteMap.get(item.quoteId) || '') : '',
  }));
}

async function enrichInvoiceReferences(tenantDb, items) {
  const invoiceIds = [...new Set(items.map((item) => item.invoiceId).filter(Boolean))]
    .map((id) => String(id).trim())
    .filter((id) => ObjectId.isValid(id))
    .map((id) => new ObjectId(id));

  if (!invoiceIds.length) {
    return items;
  }

  const invoices = await tenantDb.collection(MASTER_DATA_INVOICES_COLLECTION)
    .find({ _id: { $in: invoiceIds } })
    .project({ invoiceNumber: 1 })
    .toArray();

  const invoiceMap = new Map(invoices.map((invoice) => [invoice._id.toString(), invoice.invoiceNumber]));

  return items.map((item) => ({
    ...item,
    invoiceNumberRef: item.invoiceId ? (invoiceMap.get(item.invoiceId) || '') : '',
  }));
}

async function syncInvoicePaymentSummary(tenantDb, invoiceId) {
  const invoice = await ensureInvoiceExists(tenantDb, invoiceId);
  const successfulPayments = await tenantDb.collection(MASTER_DATA_PAYMENTS_COLLECTION)
    .find({
      invoiceId,
      isDeleted: { $ne: true },
      status: 'success',
    })
    .project({ amount: 1 })
    .toArray();

  const paidAmount = Number(
    successfulPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0).toFixed(2)
  );
  const balanceAmount = Number(Math.max(Number(invoice.grandTotal || 0) - paidAmount, 0).toFixed(2));

  let status = invoice.status;

  if (balanceAmount === 0) {
    status = 'paid';
  } else if (paidAmount > 0) {
    status = 'partially_paid';
  } else if (status === 'paid' || status === 'partially_paid') {
    status = 'sent';
  }

  await tenantDb.collection(MASTER_DATA_INVOICES_COLLECTION).updateOne(
    { _id: invoiceId },
    {
      $set: {
        paidAmount,
        balanceAmount,
        status,
        updatedAt: new Date(),
      },
    }
  );
}

function sanitizeFileNameToken(value, fallback) {
  const normalized = normalizeText(value);
  const sanitized = normalized
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return sanitized || fallback;
}

function buildWorkOrderPdfFileName({ workOrder, documentType, referenceNumber }) {
  const baseName = sanitizeFileNameToken(
    workOrder?.orderReferenceNumber || workOrder?.workOrderNumber || referenceNumber,
    `work_order_${documentType}`
  );

  return `${baseName}_${documentType}.pdf`;
}

function buildStandaloneQuotePdfFileName({ customerId, referenceNumber, versionToken = '' }) {
  const customerToken = sanitizeFileNameToken(customerId, 'customer');
  const referenceToken = sanitizeFileNameToken(referenceNumber, 'quote');
  const versionSuffix = sanitizeFileNameToken(versionToken, '');
  return versionSuffix
    ? `${customerToken}_${referenceToken}_${versionSuffix}_quote.pdf`
    : `${customerToken}_${referenceToken}_quote.pdf`;
}

async function saveWorkOrderS3Document({
  tenantDb,
  tenantId,
  workOrderId,
  documentType,
  s3Document,
}) {
  await tenantDb.collection(MASTER_DATA_WORK_ORDERS_COLLECTION).updateOne(
    {
      _id: workOrderId,
      tenantId,
      isDeleted: { $ne: true },
    },
    {
      $set: {
        [`s3Documents.${documentType}`]: s3Document,
        updatedAt: new Date(),
      },
    }
  );
}

async function saveStandaloneQuoteS3Document({
  tenantDb,
  tenantId,
  quoteId,
  s3Document,
}) {
  await tenantDb.collection(MASTER_DATA_QUOTES_COLLECTION).updateOne(
    {
      _id: quoteId,
      tenantId,
      isDeleted: { $ne: true },
    },
    {
      $set: {
        quotePdf: s3Document,
        updatedAt: new Date(),
      },
    }
  );
}

async function uploadZohoPdfToWorkOrderS3({
  tenantDb,
  tenantId,
  documentType,
  salesDocumentId,
  referenceNumber,
  buffer,
  contentType = 'application/pdf',
}) {
  const workOrderLookupField = documentType === 'quote' ? 'quoteId' : 'invoiceId';
  const workOrder = await tenantDb.collection(MASTER_DATA_WORK_ORDERS_COLLECTION).findOne({
    tenantId,
    [workOrderLookupField]: salesDocumentId,
    isDeleted: { $ne: true },
  });

  if (!workOrder) {
    logger.warn('Work order not found for Zoho PDF S3 upload', {
      tenantId,
      documentType,
      salesDocumentId: salesDocumentId?.toString?.() || String(salesDocumentId || ''),
    });
    return null;
  }

  const folderName = normalizeText(workOrder.customerId);
  const fileName = buildWorkOrderPdfFileName({
    workOrder,
    documentType,
    referenceNumber,
  });
  const existingS3Document = workOrder?.s3Documents?.[documentType] || null;

  const s3Document = await uploadBufferToS3({
    body: buffer,
    folderName,
    fileName,
    contentType,
    contentDisposition: 'inline',
    mimeType: 'document',
  });

  if (
    existingS3Document?.key
    && existingS3Document.key !== s3Document.key
  ) {
    try {
      await deleteObjectFromS3({
        bucket: existingS3Document.bucket,
        key: existingS3Document.key,
      });
    } catch (error) {
      logger.warn('Failed to delete previous Zoho PDF from S3', {
        tenantId,
        documentType,
        workOrderId: workOrder.workOrderNumber || workOrder.workOrderId || '',
        previousKey: existingS3Document.key,
        errorMessage: error?.message || 'Unknown S3 delete error.',
      });
    }
  }

  await saveWorkOrderS3Document({
    tenantDb,
    tenantId,
    workOrderId: workOrder._id,
    documentType,
    s3Document,
  });

  logger.info('Zoho PDF uploaded to S3 and saved on work order', {
    tenantId,
    documentType,
    workOrderId: workOrder.workOrderNumber || workOrder.workOrderId || '',
    fileName: s3Document.fileName,
    fileNameFolder: s3Document.fileNameFolder,
  });

  return s3Document;
}

async function uploadZohoPdfToStandaloneQuoteS3({
  tenantDb,
  tenantId,
  quote,
  buffer,
  contentType = 'application/pdf',
}) {
  if (!quote?._id) {
    return null;
  }

  const folderName = normalizeText(quote.customerId);
  const versionToken = (
    quote?.updatedAt instanceof Date
      ? quote.updatedAt.toISOString()
      : normalizeText(quote?.updatedAt) || new Date().toISOString()
  ).replace(/[:.]/g, '-');
  const fileName = buildStandaloneQuotePdfFileName({
    customerId: folderName,
    referenceNumber: quote.quoteNumber,
    versionToken,
  });
  const existingS3Document = quote?.quotePdf || null;

  const s3Document = await uploadBufferToS3({
    body: buffer,
    folderName,
    fileName,
    contentType,
    contentDisposition: 'inline',
    mimeType: 'document',
  });

  if (existingS3Document?.key && existingS3Document.key !== s3Document.key) {
    try {
      await deleteObjectFromS3({
        bucket: existingS3Document.bucket,
        key: existingS3Document.key,
      });
    } catch (error) {
      logger.warn('Failed to delete previous standalone quote PDF from S3', {
        tenantId,
        quoteId: quote._id?.toString?.() || '',
        previousKey: existingS3Document.key,
        errorMessage: error?.message || 'Unknown S3 delete error.',
      });
    }
  }

  await saveStandaloneQuoteS3Document({
    tenantDb,
    tenantId,
    quoteId: quote._id,
    s3Document,
  });

  logger.info('Standalone quote PDF uploaded to S3 and saved on quote', {
    tenantId,
    quoteId: quote._id?.toString?.() || '',
    fileName: s3Document.fileName,
    fileNameFolder: s3Document.fileNameFolder,
  });

  return s3Document;
}

async function fetchZohoPdfBuffer({
  botUserId,
  botMasterKey = {},
  apiPath,
}) {
  const {
    accessToken,
    organizationId,
    apiDomain,
  } = await getValidZohoAccessToken(botMasterKey || { botId: botUserId });

  if (!organizationId) {
    throw createHttpError('Zoho Books organization is not selected for this tenant.', 409);
  }

  const baseUrl = `${String(apiDomain || 'https://www.zohoapis.com').replace(/\/+$/, '')}${apiPath}`;
  const response = await requestHttp(baseUrl, {
    method: 'get',
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
    },
    params: {
      organization_id: organizationId,
      accept: 'pdf',
    },
    responseType: 'arraybuffer',
    label: 'Zoho fetch PDF buffer',
  });

  return {
    contentType: response.headers['content-type'] || 'application/pdf',
    buffer: Buffer.from(response.data),
  };
}

async function autoUploadZohoQuotePdfToS3({
  tenantDb,
  tenantId,
  botUserId,
  botMasterKey = {},
  quote,
}) {
  if (!quote || !isZohoSynced(quote, 'zohoEstimateId')) {
    return null;
  }

  const pdf = await fetchZohoPdfBuffer({
    botUserId,
    botMasterKey,
    apiPath: `/books/v3/estimates/${encodeURIComponent(String(quote.zohoEstimateId || '').trim())}`,
  });

  const workOrderS3Document = await uploadZohoPdfToWorkOrderS3({
    tenantDb,
    tenantId,
    documentType: 'quote',
    salesDocumentId: quote._id,
    referenceNumber: quote.quoteNumber,
    buffer: pdf.buffer,
    contentType: pdf.contentType,
  });

  if (workOrderS3Document) {
    return workOrderS3Document;
  }

  return uploadZohoPdfToStandaloneQuoteS3({
    tenantDb,
    tenantId,
    quote,
    buffer: pdf.buffer,
    contentType: pdf.contentType,
  });
}

async function autoUploadZohoInvoicePdfToS3({
  tenantDb,
  tenantId,
  botUserId,
  botMasterKey = {},
  invoice,
}) {
  if (!invoice || !isZohoSynced(invoice, 'zohoInvoiceId')) {
    return null;
  }

  const pdf = await fetchZohoPdfBuffer({
    botUserId,
    botMasterKey,
    apiPath: `/books/v3/invoices/${encodeURIComponent(String(invoice.zohoInvoiceId || '').trim())}`,
  });

  return uploadZohoPdfToWorkOrderS3({
    tenantDb,
    tenantId,
    documentType: 'invoice',
    salesDocumentId: invoice._id,
    referenceNumber: invoice.invoiceNumber,
    buffer: pdf.buffer,
    contentType: pdf.contentType,
  });
}

async function syncQuoteAndRefreshPdf({
  tenantDb,
  botMasterKey = {},
  context,
  quote,
}) {
  const result = await runBestEffortZohoSync({
    entityName: 'quote',
    entityId: quote._id.toString(),
    context,
    syncOperation: () => performQuoteZohoSync({
      tenantDb,
      tenantId: context.tenantId,
      botUserId: context.botUserId,
      botMasterKey,
      quote,
    }),
  });

  if (!result?.ok) {
    return null;
  }

  const syncedQuote = await tenantDb.collection(MASTER_DATA_QUOTES_COLLECTION).findOne({
    _id: quote._id,
    tenantId: context.tenantId,
    isDeleted: { $ne: true },
  });

  if (syncedQuote && isZohoSynced(syncedQuote, 'zohoEstimateId')) {
    try {
      await autoUploadZohoQuotePdfToS3({
        tenantDb,
        tenantId: context.tenantId,
        botUserId: context.botUserId,
        botMasterKey,
        quote: syncedQuote,
      });
    } catch (error) {
      logger.warn('Automatic quote PDF S3 upload failed after Zoho sync', {
        botUserId: context.botUserId,
        tenantId: context.tenantId,
        quoteId: quote._id.toString(),
        errorMessage: error?.message || 'Unknown quote PDF upload error.',
      });
    }

    return tenantDb.collection(MASTER_DATA_QUOTES_COLLECTION).findOne({
      _id: quote._id,
      tenantId: context.tenantId,
      isDeleted: { $ne: true },
    });
  }

  return syncedQuote;
}

async function syncInvoiceAndRefreshPdf({
  tenantDb,
  botMasterKey = {},
  context,
  invoice,
}) {
  const result = await runBestEffortZohoSync({
    entityName: 'invoice',
    entityId: invoice._id.toString(),
    context,
    syncOperation: () => performInvoiceZohoSync({
      tenantDb,
      tenantId: context.tenantId,
      botUserId: context.botUserId,
      botMasterKey,
      invoice,
    }),
  });

  if (!result?.ok) {
    return null;
  }

  const syncedInvoice = await tenantDb.collection(MASTER_DATA_INVOICES_COLLECTION).findOne({
    _id: invoice._id,
    tenantId: context.tenantId,
    isDeleted: { $ne: true },
  });

  if (syncedInvoice && isZohoSynced(syncedInvoice, 'zohoInvoiceId')) {
    try {
      await autoUploadZohoInvoicePdfToS3({
        tenantDb,
        tenantId: context.tenantId,
        botUserId: context.botUserId,
        botMasterKey,
        invoice: syncedInvoice,
      });
    } catch (error) {
      logger.warn('Automatic invoice PDF S3 upload failed after Zoho sync', {
        botUserId: context.botUserId,
        tenantId: context.tenantId,
        invoiceId: invoice._id.toString(),
        errorMessage: error?.message || 'Unknown invoice PDF upload error.',
      });
    }
  }

  return syncedInvoice;
}

function validateAllowedValue(value, allowedValues, fieldName) {
  if (!allowedValues.has(value)) {
    throw createHttpError(`${fieldName} is invalid.`);
  }
}

function buildSearchFilter(fields, searchTerm) {
  const normalizedSearch = normalizeText(searchTerm);

  if (!normalizedSearch) {
    return null;
  }

  const regex = new RegExp(escapeRegex(normalizedSearch), 'i');

  return {
    $or: fields.map((field) => ({ [field]: regex })),
  };
}

function buildDateRangeFilter(dateField, dateFrom, dateTo) {
  const from = normalizeText(dateFrom);
  const to = normalizeText(dateTo);

  if (!from && !to) {
    return null;
  }

  const rangeCondition = {};

  if (from) {
    const parsedFrom = new Date(from);
    if (!Number.isNaN(parsedFrom.getTime())) {
      rangeCondition.$gte = new Date(Date.UTC(
        parsedFrom.getUTCFullYear(),
        parsedFrom.getUTCMonth(),
        parsedFrom.getUTCDate(),
        0, 0, 0, 0,
      ));
    }
  }

  if (to) {
    const parsedTo = new Date(to);
    if (!Number.isNaN(parsedTo.getTime())) {
      rangeCondition.$lte = new Date(Date.UTC(
        parsedTo.getUTCFullYear(),
        parsedTo.getUTCMonth(),
        parsedTo.getUTCDate(),
        23, 59, 59, 999,
      ));
    }
  }

  if (!rangeCondition.$gte && !rangeCondition.$lte) {
    return null;
  }

  return { [dateField]: rangeCondition };
}

/**
 * Post-query search filter applied to already-enriched item arrays.
 * Needed for fields like customerDisplayName, quoteNumberRef, invoiceNumberRef
 * that are resolved after the DB query and don't exist in raw documents.
 * Also handles numeric amount matching (e.g. typing "1500" finds items with amount 1500).
 */
function applyPostQuerySearch(items, searchTerm, fields) {
  const normalizedSearch = normalizeText(searchTerm).toLowerCase().trim();

  if (!normalizedSearch) {
    return items;
  }

  const numericSearch = Number(normalizedSearch);
  const isNumeric = Number.isFinite(numericSearch) && normalizedSearch !== '';

  return items.filter((item) =>
    fields.some((field) => {
      const value = item[field];
      if (value == null) {
        return false;
      }

      if (typeof value === 'number') {
        // Match numeric fields: exact match, starts-with (e.g. "51" matches 515),
        // or the formatted string representation contains the search (e.g. "1,500")
        const valueStr = String(value);
        const formattedStr = value.toFixed(2);
        return (
          valueStr.startsWith(normalizedSearch) ||
          formattedStr.startsWith(normalizedSearch) ||
          (isNumeric && Math.abs(value - numericSearch) < 0.005)
        );
      }

      return normalizeText(String(value)).toLowerCase().includes(normalizedSearch);
    })
  );
}

async function fetchList(collection, filter, query = {}) {
  const { page, pageSize, skip } = parsePagination(query);
  const total = await collection.countDocuments(filter);
  const items = await collection.find(filter)
    .sort({ updatedAt: -1, createdAt: -1 })
    .skip(skip)
    .limit(pageSize)
    .toArray();

  return buildPagedResponse(items.map(serializeDocument), total, page, pageSize);
}

async function enrichWorkOrderReferences(tenantDb, items) {
  const enrichedWithCustomers = await enrichCustomerReferences(
    tenantDb,
    items.map((item) => ({
      ...item,
      customerId: String(item.customerId || '').trim(),
    }))
  );
  const enrichedWithQuotes = await enrichQuoteReferences(tenantDb, enrichedWithCustomers);
  return enrichInvoiceReferences(tenantDb, enrichedWithQuotes);
}

async function ensureTierCollectionReady(tenantDb, context) {
  const collection = tenantDb.collection(MASTER_DATA_TIERS_COLLECTION);

  await collection.createIndex(
    { tenantId: 1, tierKey: 1 },
    { unique: true, partialFilterExpression: { isDeleted: false } }
  );
  await collection.createIndex({ tenantId: 1, updatedAt: -1 });

  const existingCount = await collection.countDocuments({
    tenantId: context.tenantId,
    isDeleted: { $ne: true },
  });

  if (existingCount > 0) {
    return;
  }

  const now = new Date();
  await collection.insertMany(
    DEFAULT_TIER_DEFINITIONS.map((tier) => ({
      tenantId: context.tenantId,
      botUserId: context.botUserId,
      tierKey: tier.tierKey,
      tierName: tier.tierName,
      multiplier: tier.multiplier,
      isDeleted: false,
      createdAt: now,
      updatedAt: now,
    })),
    { ordered: true }
  );
}

async function resolveTierDocument(tenantDb, context, tierId = null) {
  await ensureTierCollectionReady(tenantDb, context);
  const collection = tenantDb.collection(MASTER_DATA_TIERS_COLLECTION);

  if (normalizeText(tierId)) {
    const tierDocument = await collection.findOne({
      _id: toObjectId(tierId, 'tierId'),
      tenantId: context.tenantId,
      isDeleted: { $ne: true },
    });

    if (!tierDocument) {
      throw createHttpError('tierId is not valid.', 400);
    }

    return tierDocument;
  }

  const defaultTier = await collection.findOne({
    tenantId: context.tenantId,
    tierKey: DEFAULT_TIER_KEY,
    isDeleted: { $ne: true },
  });

  if (defaultTier) {
    return defaultTier;
  }

  const fallbackTier = await collection.findOne({
    tenantId: context.tenantId,
    isDeleted: { $ne: true },
  });

  if (!fallbackTier) {
    throw createHttpError('No tier records are configured for this tenant.', 409);
  }

  return fallbackTier;
}

async function enrichCustomerTierReferences(tenantDb, items) {
  const tierIds = [...new Set(items.map((item) => item.tierId).filter(Boolean))].map((id) => new ObjectId(id));

  if (!tierIds.length) {
    return items;
  }

  const tiers = await tenantDb.collection(MASTER_DATA_TIERS_COLLECTION)
    .find({ _id: { $in: tierIds } })
    .project({ tierKey: 1, tierName: 1, multiplier: 1 })
    .toArray();

  const tierMap = new Map(tiers.map((tier) => [tier._id.toString(), tier]));

  return items.map((item) => {
    const tier = item.tierId ? tierMap.get(item.tierId) : null;

    return {
      ...item,
      tierKey: tier?.tierKey || null,
      tierName: tier?.tierName || null,
      tierMultiplier: typeof tier?.multiplier === 'number' ? tier.multiplier : null,
    };
  });
}

async function enrichCustomerWorkOrderReferences(tenantDb, items, context = {}) {
  const customerIds = [...new Set(items.map((item) => item.id).filter(Boolean))]
    .filter((id) => ObjectId.isValid(String(id)));

  if (!customerIds.length) {
    return items.map((item) => ({
      ...item,
      hasWorkOrder: false,
    }));
  }

  const workOrderCustomerIds = await tenantDb.collection(MASTER_DATA_WORK_ORDERS_COLLECTION)
    .distinct('customerId', {
      isDeleted: { $ne: true },
      customerId: { $in: customerIds.map((id) => new ObjectId(id)) },
    });

  const customerIdSet = new Set(workOrderCustomerIds.map((value) => value?.toString?.() || String(value || '').trim()));

  return items.map((item) => ({
    ...item,
    hasWorkOrder: customerIdSet.has(String(item.id || '').trim()),
  }));
}

async function serializeCustomerDocumentWithTier(tenantDb, document) {
  const serialized = serializeDocument(document);

  if (!serialized) {
    return null;
  }

  const context = {
    tenantId: normalizeText(document?.tenantId),
    botUserId: normalizeText(document?.botUserId),
    databaseName: normalizeText(document?.databaseName),
  };
  const [tierEnriched] = await enrichCustomerTierReferences(tenantDb, [serialized]);
  const [workOrderEnriched] = await enrichCustomerWorkOrderReferences(tenantDb, [tierEnriched], context);
  return workOrderEnriched;
}

function buildTierPayload(payload, context, existingDocument = null) {
  const now = new Date();
  const multiplier = parseDecimalNumber(payload.multiplier, 'multiplier');

  // Validate multiplier: must be > 0
  if (multiplier <= 0) {
    throw createHttpError('Multiplier must be a positive number greater than 0.', 400);
  }

  // Normalize multiplier: if > 1, cap to 1.0
  const normalizedMultiplier = multiplier > 1 ? 1 : multiplier;

  return {
    tenantId: context.tenantId,
    botUserId: context.botUserId,
    tierKey: normalizeRequiredText(payload.tierKey, 'tierKey').toUpperCase(),
    tierName: normalizeRequiredText(payload.tierName, 'tierName'),
    multiplier: normalizedMultiplier,
    isDeleted: false,
    createdAt: existingDocument?.createdAt || now,
    updatedAt: now,
  };
}

function normalizeTierWriteError(error) {
  if (error?.code === 11000) {
    return createHttpError('This tier key already exists. Please choose another one.', 409);
  }

  return error;
}

async function buildCustomerPayload(tenantDb, payload, context, existingDocument = null) {
  const displayName = normalizeText(payload.displayName);

  if (!displayName) {
    throw createHttpError('displayName is required.');
  }

  const customerType = normalizeText(payload.customerType || 'business').toLowerCase();
  validateAllowedValue(customerType, CUSTOMER_TYPES, 'customerType');

  const email = normalizeOptionalText(payload.email);
  const phone = normalizeOptionalText(payload.phone);

  if (!email && !phone) {
    throw createHttpError('Either phone or email is required.');
  }

  const status = normalizeText(payload.status || 'active').toLowerCase();
  validateAllowedValue(status, CUSTOMER_STATUSES, 'status');

  const now = new Date();
  const providedCustomerCode = normalizeOptionalText(payload.customerCode);
  const customerCode = existingDocument?.customerCode || providedCustomerCode || await generateCustomerCode(tenantDb);
  const resolvedTier = await resolveTierDocument(
    tenantDb,
    context,
    hasOwnValue(payload, 'tierId') ? payload.tierId : (existingDocument?.tierId?.toString?.() || existingDocument?.tierId || null)
  );

  return {
    tenantId: context.tenantId,
    botUserId: context.botUserId,
    customerCode,
    tierId: resolvedTier._id,
    customerType,
    displayName,
    companyName: normalizeOptionalText(payload.companyName),
    email,
    phoneCountryCode: normalizeOptionalText(payload.phoneCountryCode),
    phone,
    mobileCountryCode: normalizeOptionalText(payload.mobileCountryCode),
    mobile: normalizeOptionalText(payload.mobile),
    cybotUserId: hasOwnValue(payload, 'cybotUserId')
      ? normalizeOptionalText(payload.cybotUserId)
      : (existingDocument?.cybotUserId || null),
    isCybotRegister: hasOwnValue(payload, 'isCybotRegister')
      ? Boolean(payload.isCybotRegister)
      : Boolean(existingDocument?.isCybotRegister),
    gstNumber: normalizeOptionalText(payload.gstNumber),
    taxTreatment: normalizeOptionalText(payload.taxTreatment),
    billingAddress: normalizeText(payload.billingAddress),
    shippingAddress: normalizeOptionalText(payload.shippingAddress),
    currencyCode: normalizeOptionalText(payload.currencyCode),
    paymentTerms: normalizeOptionalText(payload.paymentTerms),
    status,
    isDeleted: false,
    zohoCustomerId: hasOwnValue(payload, 'zohoCustomerId')
      ? normalizeOptionalText(payload.zohoCustomerId)
      : (existingDocument?.zohoCustomerId || null),
    zohoSyncStatus: hasOwnValue(payload, 'zohoSyncStatus')
      ? normalizeText(payload.zohoSyncStatus || DEFAULT_ZOHO_SYNC_STATUS)
      : DEFAULT_ZOHO_SYNC_STATUS,
    zohoLastSyncedAt: hasOwnValue(payload, 'zohoLastSyncedAt')
      ? parseDate(payload.zohoLastSyncedAt, 'zohoLastSyncedAt')
      : (existingDocument?.zohoLastSyncedAt || null),
    zohoErrorMessage: hasOwnValue(payload, 'zohoErrorMessage')
      ? normalizeOptionalText(payload.zohoErrorMessage)
      : null,
    createdAt: existingDocument?.createdAt || now,
    updatedAt: now,
  };
}

export function buildZohoContactPayload(customer) {
  return buildZohoContactPayloadWithOverrides(customer);
}

function buildZohoContactPayloadWithOverrides(customer, overrides = {}) {
  const payload = {
    contact_name: String(overrides.contactName || customer.displayName || '').trim(),
    contact_type: 'customer',
  };

  const companyName = String(customer.companyName || '').trim();
  if (companyName) {
    payload.company_name = companyName;
  }

  const email = normalizeCustomerEmail(customer.email);
  if (email) {
    payload.email = email;
  }

  const phone = String(customer.phone || '').trim();
  if (phone) {
    payload.phone = phone;
  }

  const mobile = String(customer.mobile || '').trim();
  if (mobile) {
    payload.mobile = mobile;
  }

  const billingAddress = buildZohoTransactionAddress(customer.billingAddress);
  if (billingAddress) {
    payload.billing_address = {
      attention: String(customer.displayName || '').trim(),
      ...billingAddress,
    };
  }

  const shippingAddress = buildZohoTransactionAddress(customer.shippingAddress);
  if (shippingAddress) {
    payload.shipping_address = {
      attention: String(customer.displayName || '').trim(),
      ...shippingAddress,
    };
  }

  return payload;
}

function buildAlternateZohoContactName(customer) {
  const displayName = String(customer?.displayName || '').trim();
  const customerCode = String(customer?.customerCode || '').trim();
  const idSuffix = String(customer?._id?.toString?.() || customer?._id || '').trim().slice(-6);

  if (displayName && customerCode) {
    return `${displayName} ${customerCode}`.trim();
  }

  if (displayName && idSuffix) {
    return `${displayName} ${idSuffix}`.trim();
  }

  return displayName || customerCode || idSuffix || 'Customer';
}

function isZohoResourceNotAccessibleError(error) {
  return Number(error?.response?.status || 0) === 404
    && Number(error?.response?.data?.code || 0) === 1002;
}

function findExactZohoCustomerMatch(contacts, customer) {
  const email = normalizeCustomerEmail(customer?.email);
  const displayName = normalizeOptionalText(customer?.displayName);

  return (Array.isArray(contacts) ? contacts : []).find((contact) => {
    const contactEmail = normalizeCustomerEmail(contact?.email);
    const contactName = normalizeOptionalText(contact?.contact_name || contact?.contactName);

    return (email && contactEmail === email)
      || (displayName && contactName === displayName);
  }) || null;
}

async function findZohoCustomerLiveMatch({ baseUrl, requestConfig, customer }) {
  const email = normalizeCustomerEmail(customer?.email);
  const displayName = normalizeOptionalText(customer?.displayName);
  const searches = [];

  if (email) {
    searches.push({ email });
  }

  if (displayName) {
    searches.push({ contact_name: displayName });
  }

  for (const params of searches) {
    const response = await getJson(baseUrl, {
      ...requestConfig,
      params: {
        ...requestConfig.params,
        ...params,
      },
      label: 'Zoho search customer for stale mapping recovery',
    });
    const match = findExactZohoCustomerMatch(response?.contacts, customer);

    if (match?.contact_id || match?.contactId) {
      return match;
    }
  }

  return null;
}

async function findZohoDocumentLiveMatch({
  baseUrl,
  requestConfig,
  queryParam,
  queryValue,
  responseKey,
  numberKey,
  idKeys,
}) {
  const normalizedQueryValue = String(queryValue || '').trim();

  if (!normalizedQueryValue) {
    return null;
  }

  const response = await getJson(baseUrl, {
    ...requestConfig,
    params: {
      ...requestConfig.params,
      [queryParam]: normalizedQueryValue,
    },
    label: 'Zoho search document for stale mapping recovery',
  });
  const records = Array.isArray(response?.[responseKey]) ? response[responseKey] : [];

  return records.find((record) => {
    const recordNumber = String(record?.[numberKey] || '').trim();
    const recordId = idKeys.map((key) => String(record?.[key] || '').trim()).find(Boolean);

    return recordNumber === normalizedQueryValue && recordId;
  }) || null;
}

async function upsertZohoCustomerSnapshot(tenantDb, organizationId, contact) {
  const zohoCustomerId = String(contact?.contact_id || contact?.contactId || '').trim();

  if (!zohoCustomerId) {
    return;
  }

  await tenantDb.collection(ZOHO_CUSTOMERS_COLLECTION).updateOne(
    { zohoCustomerId, organizationId: String(organizationId || '').trim() },
    {
      $set: {
        zohoCustomerId,
        organizationId: String(organizationId || '').trim(),
        displayName: String(contact?.contact_name || contact?.contactName || '').trim(),
        email: normalizeOptionalText(contact?.email),
        phone: normalizeOptionalText(contact?.phone),
        contactType: normalizeOptionalText(contact?.contact_type),
        currencyCode: normalizeOptionalText(contact?.currency_code),
        syncedAt: new Date(),
        raw: contact,
      },
    },
    { upsert: true }
  );
}

async function markCustomerZohoSyncState(tenantDb, customerId, updates) {
  const { zohoSyncAudit, ...customerUpdates } = updates;

  await tenantDb.collection(MASTER_DATA_CUSTOMERS_COLLECTION).updateOne(
    { _id: customerId },
    {
      $set: {
        ...customerUpdates,
        ...(zohoSyncAudit ? { zohoSyncAudit } : {}),
        updatedAt: new Date(),
      },
    }
  );
}

async function performCustomerZohoSync({ tenantDb, tenantId, botUserId, botMasterKey = {}, customer }) {
  const _id = customer._id instanceof ObjectId ? customer._id : toObjectId(customer._id, 'customerId');
  let zohoCustomerId = '';
  const normalizedBotId = normalizeText(botMasterKey?.botId);
  const normalizedUserId = normalizeText(botMasterKey?.userId);
  const resolvedZohoBotMasterKey = normalizedBotId || normalizedUserId
    ? botMasterKey
    : { botId: botUserId };

  try {
    const {
      accessToken,
      organizationId,
      apiDomain,
    } = await getValidZohoAccessToken(resolvedZohoBotMasterKey);

    if (!organizationId) {
      throw new Error('Zoho Books organization is not selected for this tenant.');
    }

    const contactPayload = buildZohoContactPayload(customer);
    const apiRoot = String(apiDomain || 'https://www.zohoapis.com').replace(/\/+$/, '');
    const baseUrl = `${apiRoot}/books/v3/contacts`;
    const requestConfig = {
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
      },
      params: {
        organization_id: organizationId,
      },
    };

    zohoCustomerId = String(customer.zohoCustomerId || '').trim();
    let activeZohoCustomerId = zohoCustomerId;
    let response;

    const createCustomerContact = async () => {
      try {
        return {
          data: await postJson(baseUrl, contactPayload, { ...requestConfig, label: 'Zoho sync customer create' }),
        };
      } catch (error) {
        const responseCode = Number(error?.response?.data?.code || 0);

        if (responseCode !== 3062) {
          throw error;
        }

        const existingContact = await findZohoCustomerLiveMatch({
          baseUrl,
          requestConfig,
          customer,
        });

        if (existingContact?.contact_id || existingContact?.contactId) {
          activeZohoCustomerId = String(existingContact.contact_id || existingContact.contactId).trim();
          return {
            data: await putJson(
              `${baseUrl}/${encodeURIComponent(activeZohoCustomerId)}`,
              contactPayload,
              { ...requestConfig, label: 'Zoho sync customer update matched contact' },
            ),
          };
        }

        const alternateContactPayload = buildZohoContactPayloadWithOverrides(customer, {
          contactName: buildAlternateZohoContactName(customer),
        });

        return {
          data: await postJson(
            baseUrl,
            alternateContactPayload,
            { ...requestConfig, label: 'Zoho sync customer create retry' },
          ),
        };
      }
    };

    if (zohoCustomerId) {
      try {
        response = {
          data: await putJson(
            `${baseUrl}/${encodeURIComponent(activeZohoCustomerId)}`,
            contactPayload,
            { ...requestConfig, label: 'Zoho sync customer update' },
          ),
        };
      } catch (error) {
        if (!isZohoResourceNotAccessibleError(error)) {
          throw error;
        }

        const existingContact = await findZohoCustomerLiveMatch({
          baseUrl,
          requestConfig,
          customer,
        });

        if (existingContact?.contact_id || existingContact?.contactId) {
          activeZohoCustomerId = String(existingContact.contact_id || existingContact.contactId).trim();
          response = {
            data: await putJson(
              `${baseUrl}/${encodeURIComponent(activeZohoCustomerId)}`,
              contactPayload,
              { ...requestConfig, label: 'Zoho sync customer update recovered mapping' },
            ),
          };
        } else {
          response = await createCustomerContact();
        }
      }
    } else {
      response = await createCustomerContact();
    }

    const responseBody = response?.data || {};
    const contact = responseBody.contact || responseBody.contacts || responseBody.data || {};
    const resolvedZohoCustomerId = String(
      contact?.contact_id ||
      contact?.contactId ||
      activeZohoCustomerId
    ).trim();

    if (!resolvedZohoCustomerId) {
      throw new Error('Zoho Books did not return a contact id for this customer.');
    }

    // Customer sync is bidirectional for address data: after the outbound update,
    // fetch Zoho's complete contact because update/list responses can omit addresses.
    const detailedZohoContact = await fetchZohoCustomerContact({
      apiRoot,
      zohoCustomerId: resolvedZohoCustomerId,
      requestConfig,
    });
    await refreshLocalCustomerAddressesFromZoho({
      tenantDb,
      customer,
      zohoContact: detailedZohoContact,
    });

    await markCustomerZohoSyncState(tenantDb, _id, {
      zohoCustomerId: resolvedZohoCustomerId,
      zohoSyncStatus: 'synced',
      zohoLastSyncedAt: new Date(),
      zohoErrorMessage: null,
      zohoSyncAudit: {
        status: 'synced',
        lastAttemptAt: new Date(),
        lastSyncedAt: new Date(),
        lastOperation: zohoCustomerId && activeZohoCustomerId === zohoCustomerId
          ? 'update'
          : (zohoCustomerId ? 'recover_stale_mapping' : 'create'),
        previousZohoCustomerId: zohoCustomerId && activeZohoCustomerId !== zohoCustomerId
          ? zohoCustomerId
          : null,
        zohoCustomerId: resolvedZohoCustomerId,
        lastError: null,
      },
    });

    await upsertZohoCustomerSnapshot(tenantDb, organizationId, {
      ...contact,
      ...detailedZohoContact,
      contact_id: resolvedZohoCustomerId,
      contact_name: detailedZohoContact?.contact_name || contact?.contact_name || customer.displayName,
      email: detailedZohoContact?.email || contact?.email || customer.email,
      phone: detailedZohoContact?.phone || contact?.phone || customer.phone,
      contact_type: detailedZohoContact?.contact_type || contact?.contact_type || 'customer',
      currency_code: detailedZohoContact?.currency_code || contact?.currency_code || customer.currencyCode,
    });

    const syncedCustomer = await tenantDb.collection(MASTER_DATA_CUSTOMERS_COLLECTION).findOne({
      _id,
      tenantId,
    });

    return {
      ok: true,
      customer: serializeDocument(syncedCustomer),
      errorMessage: null,
    };
  } catch (error) {
    const errorMessage = error?.response?.data?.message || error?.message || 'Zoho customer sync failed.';

    await markCustomerZohoSyncState(tenantDb, _id, {
      zohoSyncStatus: 'failed',
      zohoErrorMessage: errorMessage,
      zohoSyncAudit: {
        status: 'failed',
        lastAttemptAt: new Date(),
        lastOperation: zohoCustomerId ? 'update' : 'create',
        zohoCustomerId: zohoCustomerId || null,
        lastError: {
          httpStatus: error?.response?.status || null,
          zohoCode: error?.response?.data?.code || null,
          message: errorMessage,
          occurredAt: new Date(),
        },
      },
    });

    return {
      ok: false,
      customer: null,
      errorMessage,
    };
  }
}

function formatDateOnly(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return null;
  }

  return value.toISOString().slice(0, 10);
}

function isZohoAutoNumberingConflict(error) {
  const errorMessage = String(error?.response?.data?.message || error?.message || '').trim().toLowerCase();
  return (
    errorMessage.includes('does not match the auto-generated number')
    || (
      errorMessage.includes('auto-generation')
      && errorMessage.includes('cannot be changed')
    )
  );
}

const UNAVAILABLE_ADDRESS_VALUES = new Set([
  'not provided',
  'not available',
  'n/a',
  'na',
  'unknown',
  'imported from zoho books',
]);

function normalizeUsableAddressPart(value) {
  const normalized = String(value ?? '').trim();
  return normalized && !UNAVAILABLE_ADDRESS_VALUES.has(normalized.toLowerCase())
    ? normalized
    : '';
}

function buildZohoTransactionAddress(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const address = {};

    for (const field of ['attention', 'address', 'street2', 'city', 'state', 'zip', 'country', 'fax']) {
      const normalizedValue = normalizeUsableAddressPart(value[field]);
      if (normalizedValue) {
        address[field] = normalizedValue;
      }
    }

    if (!address.address) {
      const street = normalizeUsableAddressPart(value.street);
      if (street) {
        address.address = street;
      }
    }

    return Object.keys(address).length ? address : null;
  }

  const address = normalizeUsableAddressPart(value);
  return address ? { address } : null;
}

function getZohoCustomerAddresses(customer, zohoContact = null) {
  return {
    billingAddress: buildZohoTransactionAddress(zohoContact?.billing_address)
      || buildZohoTransactionAddress(customer?.billingAddress),
    shippingAddress: buildZohoTransactionAddress(zohoContact?.shipping_address)
      || buildZohoTransactionAddress(customer?.shippingAddress),
  };
}

function formatZohoAddressForStorage(value) {
  const address = buildZohoTransactionAddress(value);
  if (!address) {
    return null;
  }

  const seen = new Set();
  const lines = [];
  for (const field of ['address', 'street2', 'city', 'state', 'zip', 'country']) {
    const part = normalizeUsableAddressPart(address[field]);
    const dedupeKey = part.toLowerCase();
    if (part && !seen.has(dedupeKey)) {
      seen.add(dedupeKey);
      lines.push(part);
    }
  }

  return lines.length ? lines.join('\n') : null;
}

async function refreshLocalCustomerAddressesFromZoho({ tenantDb, customer, zohoContact }) {
  const billingAddress = formatZohoAddressForStorage(zohoContact?.billing_address);
  const shippingAddress = formatZohoAddressForStorage(zohoContact?.shipping_address);
  const updates = {};

  if (billingAddress) {
    updates.billingAddress = billingAddress;
  }
  if (shippingAddress) {
    updates.shippingAddress = shippingAddress;
  }

  if (Object.keys(updates).length) {
    await tenantDb.collection(MASTER_DATA_CUSTOMERS_COLLECTION).updateOne(
      { _id: customer._id, tenantId: customer.tenantId },
      { $set: { ...updates, updatedAt: new Date() } },
    );
    logger.info('Master data customer addresses refreshed from Zoho', {
      tenantId: customer.tenantId,
      customerId: customer._id?.toString?.() || String(customer._id || ''),
      billingAddressUpdated: Boolean(updates.billingAddress),
      shippingAddressUpdated: Boolean(updates.shippingAddress),
    });
  }

  return { ...customer, ...updates };
}

function applyZohoCustomerAddresses(payload, customer, zohoContact = null) {
  const { billingAddress, shippingAddress } = getZohoCustomerAddresses(customer, zohoContact);

  if (billingAddress) {
    payload.billing_address = billingAddress;
  }

  if (shippingAddress) {
    payload.shipping_address = shippingAddress;
  }

  return payload;
}

async function fetchZohoCustomerContact({ apiRoot, zohoCustomerId, requestConfig }) {
  const response = await getJson(
    `${apiRoot}/books/v3/contacts/${encodeURIComponent(zohoCustomerId)}`,
    { ...requestConfig, label: 'Zoho fetch customer addresses' },
  );
  return response?.contact || response?.data || null;
}

async function updateZohoDocumentAddresses({
  baseUrl,
  documentId,
  requestConfig,
  customer,
  zohoContact,
  documentLabel,
}) {
  const { billingAddress, shippingAddress } = getZohoCustomerAddresses(customer, zohoContact);
  const encodedDocumentId = encodeURIComponent(documentId);
  const toAddressUpdatePayload = (address) => Object.fromEntries(
    Object.entries(address || {}).filter(([field]) => (
      ['address', 'city', 'state', 'zip', 'country', 'fax'].includes(field)
    )),
  );
  const billingAddressUpdate = toAddressUpdatePayload(billingAddress);
  const shippingAddressUpdate = toAddressUpdatePayload(shippingAddress);

  if (Object.keys(billingAddressUpdate).length) {
    await putJson(
      `${baseUrl}/${encodedDocumentId}/address/billing`,
      billingAddressUpdate,
      { ...requestConfig, label: `Zoho update ${documentLabel} billing address` },
    );
  }

  if (Object.keys(shippingAddressUpdate).length) {
    await putJson(
      `${baseUrl}/${encodedDocumentId}/address/shipping`,
      shippingAddressUpdate,
      { ...requestConfig, label: `Zoho update ${documentLabel} shipping address` },
    );
  }
}

function buildZohoQuotePayload(
  quote,
  customer,
  { includeCustomNumber = true, zohoContact = null } = {},
) {
  const lineItems = Array.isArray(quote?.lineItems)
    ? quote.lineItems.map((lineItem, index) => ({
      item_order: index + 1,
      name: String(lineItem?.name || '').trim(),
      description: normalizeOptionalText(lineItem?.description),
      quantity: Number(lineItem?.quantity || 0),
      rate: Number(lineItem?.rate || 0),
      discount_amount: Number(lineItem?.discount || 0),
      tax_percentage: Number(lineItem?.taxPercentage || 0),
    }))
    : [];

  const payload = {
    customer_id: String(customer?.zohoCustomerId || '').trim(),
    date: formatDateOnly(quote?.quoteDate),
    line_items: lineItems,
  };
  applyZohoCustomerAddresses(payload, customer, zohoContact);

  if (includeCustomNumber) {
    payload.estimate_number = String(quote?.quoteNumber || '').trim();
  }

  const expiryDate = formatDateOnly(quote?.expiryDate);
  if (expiryDate) {
    payload.expiry_date = expiryDate;
  }

  const notes = String(quote?.notes || '').trim();
  if (notes) {
    payload.notes = notes;
  }

  const terms = String(quote?.termsAndConditions || '').trim();
  if (terms) {
    payload.terms = terms;
  }

  return payload;
}

async function upsertZohoQuoteSnapshot(tenantDb, organizationId, estimate, sourceQuote) {
  const zohoQuoteId = String(estimate?.estimate_id || estimate?.estimateId || '').trim();

  if (!zohoQuoteId) {
    return;
  }

  await tenantDb.collection(ZOHO_QUOTES_COLLECTION).updateOne(
    { zohoQuoteId, organizationId: String(organizationId || '').trim() },
    {
      $set: {
        zohoQuoteId,
        organizationId: String(organizationId || '').trim(),
        displayName: String(
          estimate?.estimate_number ||
          estimate?.display_name ||
          sourceQuote?.quoteNumber ||
          ''
        ).trim(),
        customerId: normalizeOptionalText(estimate?.customer_id || estimate?.customerId),
        status: normalizeOptionalText(estimate?.status || sourceQuote?.status),
        currencyCode: normalizeOptionalText(estimate?.currency_code || estimate?.currencyCode),
        total: Number(estimate?.total ?? sourceQuote?.grandTotal ?? 0),
        syncedAt: new Date(),
        raw: estimate,
      },
    },
    { upsert: true }
  );
}

async function markQuoteZohoSyncState(tenantDb, quoteId, updates) {
  const { zohoSyncAudit, ...quoteUpdates } = updates;

  await tenantDb.collection(MASTER_DATA_QUOTES_COLLECTION).updateOne(
    { _id: quoteId },
    {
      $set: {
        ...quoteUpdates,
        ...(zohoSyncAudit ? { zohoSyncAudit } : {}),
        updatedAt: new Date(),
      },
    }
  );
}

async function performQuoteZohoSync({ tenantDb, tenantId, botUserId, botMasterKey = {}, quote }) {
  const _id = quote._id instanceof ObjectId ? quote._id : toObjectId(quote._id, 'quoteId');
  let zohoEstimateId = '';
  let resolvedZohoEstimateIdForFailure = '';

  try {
    const customer = await tenantDb.collection(MASTER_DATA_CUSTOMERS_COLLECTION).findOne({
      _id: quote.customerId,
      tenantId,
      isDeleted: { $ne: true },
    });

    if (!customer) {
      throw new Error('Customer for this quote was not found.');
    }

    const zohoCustomerId = String(customer.zohoCustomerId || '').trim();
    if (!zohoCustomerId) {
      throw new Error('Sync the customer to Zoho Books before syncing this quote.');
    }

    const {
      accessToken,
      organizationId,
      apiDomain,
    } = await getValidZohoAccessToken(botMasterKey || { botId: botUserId });

    if (!organizationId) {
      throw new Error('Zoho Books organization is not selected for this tenant.');
    }

    const apiRoot = String(apiDomain || 'https://www.zohoapis.com').replace(/\/+$/, '');
    const baseUrl = `${apiRoot}/books/v3/estimates`;
    const requestConfig = {
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
      },
      params: {
        organization_id: organizationId,
      },
    };
    const zohoContact = await fetchZohoCustomerContact({
      apiRoot,
      zohoCustomerId,
      requestConfig,
    });
    const customerWithAddresses = await refreshLocalCustomerAddressesFromZoho({
      tenantDb,
      customer,
      zohoContact,
    });

    zohoEstimateId = String(quote.zohoEstimateId || '').trim();
    let activeZohoEstimateId = zohoEstimateId;
    const executeEstimateSync = async (includeCustomNumber = true) => {
      const estimatePayload = buildZohoQuotePayload(quote, customerWithAddresses, {
        includeCustomNumber,
        zohoContact,
      });
      return activeZohoEstimateId
        ? { data: await putJson(`${baseUrl}/${encodeURIComponent(activeZohoEstimateId)}`, estimatePayload, { ...requestConfig, label: 'Zoho sync quote update' }) }
        : { data: await postJson(baseUrl, estimatePayload, { ...requestConfig, label: 'Zoho sync quote create' }) };
    };

    const executeEstimateSyncWithNumberFallback = async () => {
      try {
        return await executeEstimateSync(true);
      } catch (error) {
        if (!isZohoAutoNumberingConflict(error)) {
          throw error;
        }

        return executeEstimateSync(false);
      }
    };

    let response;
    try {
      response = await executeEstimateSyncWithNumberFallback();
    } catch (error) {
      if (!activeZohoEstimateId || !isZohoResourceNotAccessibleError(error)) {
        throw error;
      }

      const matchingEstimate = await findZohoDocumentLiveMatch({
        baseUrl,
        requestConfig,
        queryParam: 'estimate_number',
        queryValue: quote.quoteNumber,
        responseKey: 'estimates',
        numberKey: 'estimate_number',
        idKeys: ['estimate_id', 'estimateId'],
      });
      activeZohoEstimateId = String(
        matchingEstimate?.estimate_id || matchingEstimate?.estimateId || ''
      ).trim();
      response = await executeEstimateSyncWithNumberFallback();
    }

    const responseBody = response?.data || {};
    const estimate = responseBody.estimate || responseBody.estimates || responseBody.data || {};
    const resolvedZohoEstimateId = String(
      estimate?.estimate_id ||
      estimate?.estimateId ||
      activeZohoEstimateId
    ).trim();

    if (!resolvedZohoEstimateId) {
      throw new Error('Zoho Books did not return an estimate id for this quote.');
    }

    // Dedicated address endpoints repair estimates that previously stored a placeholder.
    resolvedZohoEstimateIdForFailure = resolvedZohoEstimateId;
    await updateZohoDocumentAddresses({
      baseUrl,
      documentId: resolvedZohoEstimateId,
      requestConfig,
      customer: customerWithAddresses,
      zohoContact,
      documentLabel: 'quote',
    });

    await markQuoteZohoSyncState(tenantDb, _id, {
      zohoEstimateId: resolvedZohoEstimateId,
      zohoEstimateUrl: normalizeOptionalText(estimate?.estimate_url || estimate?.estimateUrl),
      zohoSyncStatus: 'synced',
      zohoLastSyncedAt: new Date(),
      zohoErrorMessage: null,
      zohoSyncAudit: {
        status: 'synced',
        lastAttemptAt: new Date(),
        lastSyncedAt: new Date(),
        lastOperation: zohoEstimateId && activeZohoEstimateId === zohoEstimateId
          ? 'update'
          : (zohoEstimateId ? 'recover_stale_mapping' : 'create'),
        previousZohoEstimateId: zohoEstimateId && activeZohoEstimateId !== zohoEstimateId
          ? zohoEstimateId
          : null,
        zohoEstimateId: resolvedZohoEstimateId,
        lastError: null,
      },
    });

    await upsertZohoQuoteSnapshot(tenantDb, organizationId, {
      ...estimate,
      estimate_id: resolvedZohoEstimateId,
      estimate_number: estimate?.estimate_number || quote.quoteNumber,
      customer_id: estimate?.customer_id || zohoCustomerId,
      status: estimate?.status || quote.status,
      total: estimate?.total || quote.grandTotal,
    }, quote);

    const syncedQuote = await tenantDb.collection(MASTER_DATA_QUOTES_COLLECTION).findOne({
      _id,
      tenantId,
    });

    return {
      ok: true,
      quote: serializeDocument(syncedQuote),
      errorMessage: null,
    };
  } catch (error) {
    const errorMessage = error?.response?.data?.message || error?.message || 'Zoho quote sync failed.';
    const failedZohoEstimateId = resolvedZohoEstimateIdForFailure || zohoEstimateId;

    await markQuoteZohoSyncState(tenantDb, _id, {
      ...(failedZohoEstimateId ? { zohoEstimateId: failedZohoEstimateId } : {}),
      zohoSyncStatus: 'failed',
      zohoErrorMessage: errorMessage,
      zohoSyncAudit: {
        status: 'failed',
        lastAttemptAt: new Date(),
        lastOperation: zohoEstimateId ? 'update' : 'create',
        zohoEstimateId: failedZohoEstimateId || null,
        lastError: {
          httpStatus: error?.response?.status || null,
          zohoCode: error?.response?.data?.code || null,
          message: errorMessage,
          occurredAt: new Date(),
        },
      },
    });

    return {
      ok: false,
      quote: null,
      errorMessage,
    };
  }
}

function buildQuotePayload(payload, context, existingDocument = null) {
  const quoteNumber = normalizeText(payload.quoteNumber);

  if (!quoteNumber) {
    throw createHttpError('quoteNumber is required.');
  }

  const quoteDate = parseDate(payload.quoteDate, 'quoteDate');

  if (!quoteDate) {
    throw createHttpError('quoteDate is required.');
  }

  const customerId = toObjectId(payload.customerId, 'customerId');
  const lineItems = normalizeLineItems(payload.lineItems);
  const totals = buildLineItemTotals(lineItems);
  const status = normalizeText(payload.status || 'draft').toLowerCase();
  validateAllowedValue(status, QUOTE_STATUSES, 'status');
  const now = new Date();

  return {
    tenantId: context.tenantId,
    botUserId: context.botUserId,
    quoteNumber,
    sessionId: normalizeOptionalText(payload.sessionId) || existingDocument?.sessionId || null,
    customerId,
    quoteDate,
    expiryDate: parseDate(payload.expiryDate, 'expiryDate'),
    lineItems,
    ...totals,
    status,
    notes: normalizeOptionalText(payload.notes),
    termsAndConditions: normalizeOptionalText(payload.termsAndConditions),
    isDeleted: false,
    zohoEstimateId: hasOwnValue(payload, 'zohoEstimateId')
      ? normalizeOptionalText(payload.zohoEstimateId)
      : (existingDocument?.zohoEstimateId || null),
    zohoSyncStatus: hasOwnValue(payload, 'zohoSyncStatus')
      ? normalizeText(payload.zohoSyncStatus || DEFAULT_ZOHO_SYNC_STATUS)
      : (existingDocument?.zohoSyncStatus || DEFAULT_ZOHO_SYNC_STATUS),
    zohoLastSyncedAt: hasOwnValue(payload, 'zohoLastSyncedAt')
      ? parseDate(payload.zohoLastSyncedAt, 'zohoLastSyncedAt')
      : (existingDocument?.zohoLastSyncedAt || null),
    zohoEstimateUrl: hasOwnValue(payload, 'zohoEstimateUrl')
      ? normalizeOptionalText(payload.zohoEstimateUrl)
      : (existingDocument?.zohoEstimateUrl || null),
    zohoErrorMessage: hasOwnValue(payload, 'zohoErrorMessage')
      ? normalizeOptionalText(payload.zohoErrorMessage)
      : (existingDocument?.zohoErrorMessage || null),
    sourcePayload: payload.sourcePayload ?? existingDocument?.sourcePayload ?? null,
    createdAt: existingDocument?.createdAt || now,
    updatedAt: now,
  };
}

function buildZohoInvoicePayload(
  invoice,
  customer,
  quote = null,
  { includeCustomNumber = true, includeUpdateReason = false, zohoContact = null } = {},
) {
  const lineItems = Array.isArray(invoice?.lineItems)
    ? invoice.lineItems.map((lineItem, index) => ({
      item_order: index + 1,
      name: String(lineItem?.name || '').trim(),
      description: normalizeOptionalText(lineItem?.description),
      quantity: Number(lineItem?.quantity || 0),
      rate: Number(lineItem?.rate || 0),
      discount_amount: Number(lineItem?.discount || 0),
      tax_percentage: Number(lineItem?.taxPercentage || 0),
    }))
    : [];

  const payload = {
    customer_id: String(customer?.zohoCustomerId || '').trim(),
    date: formatDateOnly(invoice?.invoiceDate),
    due_date: formatDateOnly(invoice?.dueDate),
    line_items: lineItems,
  };
  applyZohoCustomerAddresses(payload, customer, zohoContact);

  if (includeCustomNumber) {
    payload.invoice_number = String(invoice?.invoiceNumber || '').trim();
  }

  if (quote?.quoteNumber) {
    payload.reference_number = String(quote.quoteNumber).trim();
  }

  const notes = String(invoice?.notes || '').trim();
  if (notes) {
    payload.notes = notes;
  }

  const terms = String(invoice?.termsAndConditions || '').trim();
  if (terms) {
    payload.terms = terms;
  }

  if (includeUpdateReason) {
    payload.reason = 'Synced from master data application.';
  }

  return payload;
}

async function upsertZohoInvoiceSnapshot(tenantDb, organizationId, zohoInvoice, sourceInvoice) {
  const zohoInvoiceId = String(zohoInvoice?.invoice_id || zohoInvoice?.invoiceId || '').trim();

  if (!zohoInvoiceId) {
    return;
  }

  await tenantDb.collection(ZOHO_INVOICES_COLLECTION).updateOne(
    { zohoInvoiceId, organizationId: String(organizationId || '').trim() },
    {
      $set: {
        zohoInvoiceId,
        organizationId: String(organizationId || '').trim(),
        displayName: String(
          zohoInvoice?.invoice_number ||
          zohoInvoice?.display_name ||
          sourceInvoice?.invoiceNumber ||
          ''
        ).trim(),
        customerId: normalizeOptionalText(zohoInvoice?.customer_id || zohoInvoice?.customerId),
        status: normalizeOptionalText(zohoInvoice?.status || sourceInvoice?.status),
        currencyCode: normalizeOptionalText(zohoInvoice?.currency_code || zohoInvoice?.currencyCode),
        total: Number(zohoInvoice?.total ?? sourceInvoice?.grandTotal ?? 0),
        syncedAt: new Date(),
        raw: zohoInvoice,
      },
    },
    { upsert: true }
  );
}

async function markInvoiceZohoSyncState(tenantDb, invoiceId, updates) {
  const { zohoSyncAudit, ...invoiceUpdates } = updates;

  await tenantDb.collection(MASTER_DATA_INVOICES_COLLECTION).updateOne(
    { _id: invoiceId },
    {
      $set: {
        ...invoiceUpdates,
        ...(zohoSyncAudit ? { zohoSyncAudit } : {}),
        updatedAt: new Date(),
      },
    }
  );
}

async function performInvoiceZohoSync({ tenantDb, tenantId, botUserId, botMasterKey = {}, invoice }) {
  const _id = invoice._id instanceof ObjectId ? invoice._id : toObjectId(invoice._id, 'invoiceId');
  let zohoInvoiceId = '';
  let resolvedZohoInvoiceIdForFailure = '';

  try {
    const customer = await tenantDb.collection(MASTER_DATA_CUSTOMERS_COLLECTION).findOne({
      _id: invoice.customerId,
      tenantId,
      isDeleted: { $ne: true },
    });

    if (!customer) {
      throw new Error('Customer for this invoice was not found.');
    }

    const zohoCustomerId = String(customer.zohoCustomerId || '').trim();
    if (!zohoCustomerId) {
      throw new Error('Sync the customer to Zoho Books before syncing this invoice.');
    }

    const quote = invoice.quoteId
      ? await tenantDb.collection(MASTER_DATA_QUOTES_COLLECTION).findOne({
        _id: invoice.quoteId,
        tenantId,
        isDeleted: { $ne: true },
      })
      : null;

    assertZohoCustomerReady(customer, 'Invoice sync');
    assertLinkedQuoteReadyForInvoiceSync(quote);

    const {
      accessToken,
      organizationId,
      apiDomain,
    } = await getValidZohoAccessToken(botMasterKey || { botId: botUserId });

    if (!organizationId) {
      throw new Error('Zoho Books organization is not selected for this tenant.');
    }

    const apiRoot = String(apiDomain || 'https://www.zohoapis.com').replace(/\/+$/, '');
    const baseUrl = `${apiRoot}/books/v3/invoices`;
    const requestConfig = {
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
      },
      params: {
        organization_id: organizationId,
      },
    };
    const zohoContact = await fetchZohoCustomerContact({
      apiRoot,
      zohoCustomerId,
      requestConfig,
    });
    const customerWithAddresses = await refreshLocalCustomerAddressesFromZoho({
      tenantDb,
      customer,
      zohoContact,
    });

    zohoInvoiceId = String(invoice.zohoInvoiceId || '').trim();
    let activeZohoInvoiceId = zohoInvoiceId;
    const executeInvoiceSync = async (includeCustomNumber = true) => {
      const invoicePayload = buildZohoInvoicePayload(invoice, customerWithAddresses, quote, {
        includeCustomNumber,
        includeUpdateReason: Boolean(activeZohoInvoiceId),
        zohoContact,
      });
      return activeZohoInvoiceId
        ? { data: await putJson(`${baseUrl}/${encodeURIComponent(activeZohoInvoiceId)}`, invoicePayload, { ...requestConfig, label: 'Zoho sync invoice update' }) }
        : { data: await postJson(baseUrl, invoicePayload, { ...requestConfig, label: 'Zoho sync invoice create' }) };
    };

    const executeInvoiceSyncWithNumberFallback = async () => {
      try {
        return await executeInvoiceSync(true);
      } catch (error) {
        if (!isZohoAutoNumberingConflict(error)) {
          throw error;
        }

        return executeInvoiceSync(false);
      }
    };

    let response;
    try {
      response = await executeInvoiceSyncWithNumberFallback();
    } catch (error) {
      if (!activeZohoInvoiceId || !isZohoResourceNotAccessibleError(error)) {
        throw error;
      }

      const matchingInvoice = await findZohoDocumentLiveMatch({
        baseUrl,
        requestConfig,
        queryParam: 'invoice_number',
        queryValue: invoice.invoiceNumber,
        responseKey: 'invoices',
        numberKey: 'invoice_number',
        idKeys: ['invoice_id', 'invoiceId'],
      });
      activeZohoInvoiceId = String(
        matchingInvoice?.invoice_id || matchingInvoice?.invoiceId || ''
      ).trim();
      response = await executeInvoiceSyncWithNumberFallback();
    }

    const responseBody = response?.data || {};
    const zohoInvoice = responseBody.invoice || responseBody.invoices || responseBody.data || {};
    const resolvedZohoInvoiceId = String(
      zohoInvoice?.invoice_id ||
      zohoInvoice?.invoiceId ||
      activeZohoInvoiceId
    ).trim();

    if (!resolvedZohoInvoiceId) {
      throw new Error('Zoho Books did not return an invoice id for this invoice.');
    }

    resolvedZohoInvoiceIdForFailure = resolvedZohoInvoiceId;
    await updateZohoDocumentAddresses({
      baseUrl,
      documentId: resolvedZohoInvoiceId,
      requestConfig,
      customer: customerWithAddresses,
      zohoContact,
      documentLabel: 'invoice',
    });

    await markInvoiceZohoSyncState(tenantDb, _id, {
      zohoInvoiceId: resolvedZohoInvoiceId,
      zohoSyncStatus: 'synced',
      zohoLastSyncedAt: new Date(),
      zohoErrorMessage: null,
      zohoSyncAudit: {
        status: 'synced',
        lastAttemptAt: new Date(),
        lastSyncedAt: new Date(),
        lastOperation: zohoInvoiceId && activeZohoInvoiceId === zohoInvoiceId
          ? 'update'
          : (zohoInvoiceId ? 'recover_stale_mapping' : 'create'),
        previousZohoInvoiceId: zohoInvoiceId && activeZohoInvoiceId !== zohoInvoiceId
          ? zohoInvoiceId
          : null,
        zohoInvoiceId: resolvedZohoInvoiceId,
        lastError: null,
      },
    });

    await upsertZohoInvoiceSnapshot(tenantDb, organizationId, {
      ...zohoInvoice,
      invoice_id: resolvedZohoInvoiceId,
      invoice_number: zohoInvoice?.invoice_number || invoice.invoiceNumber,
      customer_id: zohoInvoice?.customer_id || zohoCustomerId,
      status: zohoInvoice?.status || invoice.status,
      total: zohoInvoice?.total ?? invoice.grandTotal,
    }, invoice);

    const syncedInvoice = await tenantDb.collection(MASTER_DATA_INVOICES_COLLECTION).findOne({
      _id,
      tenantId,
    });

    return {
      ok: true,
      invoice: serializeDocument(syncedInvoice),
      errorMessage: null,
    };
  } catch (error) {
    const errorMessage = error?.response?.data?.message || error?.message || 'Zoho invoice sync failed.';
    const failedZohoInvoiceId = resolvedZohoInvoiceIdForFailure || zohoInvoiceId;

    await markInvoiceZohoSyncState(tenantDb, _id, {
      ...(failedZohoInvoiceId ? { zohoInvoiceId: failedZohoInvoiceId } : {}),
      zohoSyncStatus: 'failed',
      zohoErrorMessage: errorMessage,
      zohoSyncAudit: {
        status: 'failed',
        lastAttemptAt: new Date(),
        lastOperation: zohoInvoiceId ? 'update' : 'create',
        zohoInvoiceId: failedZohoInvoiceId || null,
        lastError: {
          httpStatus: error?.response?.status || null,
          zohoCode: error?.response?.data?.code || null,
          message: errorMessage,
          occurredAt: new Date(),
        },
      },
    });

    return {
      ok: false,
      invoice: null,
      errorMessage,
    };
  }
}

function buildInvoicePayload(payload, context, existingDocument = null, currentPaidAmount = 0) {
  const invoiceNumber = normalizeText(payload.invoiceNumber);

  if (!invoiceNumber) {
    throw createHttpError('invoiceNumber is required.');
  }

  const invoiceDate = parseDate(payload.invoiceDate, 'invoiceDate');
  const dueDate = parseDate(payload.dueDate, 'dueDate');

  if (!invoiceDate) {
    throw createHttpError('invoiceDate is required.');
  }

  if (!dueDate) {
    throw createHttpError('dueDate is required.');
  }

  const customerId = toObjectId(payload.customerId, 'customerId');
  const quoteId = payload.quoteId ? toObjectId(payload.quoteId, 'quoteId') : null;
  const lineItems = normalizeLineItems(payload.lineItems);
  const totals = buildLineItemTotals(lineItems);
  const paidAmount = Number(currentPaidAmount.toFixed(2));
  const balanceAmount = Number(Math.max(totals.grandTotal - paidAmount, 0).toFixed(2));
  let status = normalizeText(payload.status || existingDocument?.status || 'draft').toLowerCase();

  if (balanceAmount === 0) {
    status = 'paid';
  } else if (paidAmount > 0) {
    status = 'partially_paid';
  }

  validateAllowedValue(status, INVOICE_STATUSES, 'status');

  const now = new Date();

  return {
    tenantId: context.tenantId,
    botUserId: context.botUserId,
    invoiceNumber,
    customerId,
    quoteId,
    invoiceDate,
    dueDate,
    lineItems,
    ...totals,
    paidAmount,
    balanceAmount,
    status,
    notes: normalizeOptionalText(payload.notes),
    termsAndConditions: normalizeOptionalText(payload.termsAndConditions),
    isDeleted: false,
    zohoInvoiceId: hasOwnValue(payload, 'zohoInvoiceId')
      ? normalizeOptionalText(payload.zohoInvoiceId)
      : (existingDocument?.zohoInvoiceId || null),
    zohoSyncStatus: hasOwnValue(payload, 'zohoSyncStatus')
      ? normalizeText(payload.zohoSyncStatus || DEFAULT_ZOHO_SYNC_STATUS)
      : (existingDocument?.zohoSyncStatus || DEFAULT_ZOHO_SYNC_STATUS),
    zohoLastSyncedAt: hasOwnValue(payload, 'zohoLastSyncedAt')
      ? parseDate(payload.zohoLastSyncedAt, 'zohoLastSyncedAt')
      : (existingDocument?.zohoLastSyncedAt || null),
    zohoErrorMessage: hasOwnValue(payload, 'zohoErrorMessage')
      ? normalizeOptionalText(payload.zohoErrorMessage)
      : (existingDocument?.zohoErrorMessage || null),
    createdAt: existingDocument?.createdAt || now,
    updatedAt: now,
  };
}

function buildZohoPaymentPayload(
  payment,
  customer,
  invoice,
  { includeCustomNumber = true, includeInvoiceAllocations = true } = {},
) {
  const payload = {
    customer_id: String(customer?.zohoCustomerId || '').trim(),
    payment_mode: String(payment?.paymentMode || '').trim(),
    date: formatDateOnly(payment?.paymentDate),
    amount: Number(payment?.amount || 0),
  };

  if (includeInvoiceAllocations) {
    payload.invoices = [
      {
        invoice_id: String(invoice?.zohoInvoiceId || '').trim(),
        amount_applied: Number(payment?.amount || 0),
      },
    ];
  }

  if (includeCustomNumber) {
    payload.payment_number = String(payment?.paymentNumber || '').trim();
  }

  const referenceNumber = String(payment?.referenceNumber || '').trim();
  if (referenceNumber) {
    payload.reference_number = referenceNumber;
  }

  const notes = String(payment?.notes || '').trim();
  if (notes) {
    payload.description = notes;
  }

  return payload;
}

async function upsertZohoPaymentSnapshot(tenantDb, organizationId, zohoPayment, sourcePayment) {
  const zohoPaymentId = String(
    zohoPayment?.payment_id ||
    zohoPayment?.customerpayment_id ||
    zohoPayment?.paymentId ||
    zohoPayment?.customerPaymentId ||
    ''
  ).trim();

  if (!zohoPaymentId) {
    return;
  }

  await tenantDb.collection(ZOHO_PAYMENTS_COLLECTION).updateOne(
    { zohoPaymentId, organizationId: String(organizationId || '').trim() },
    {
      $set: {
        zohoPaymentId,
        organizationId: String(organizationId || '').trim(),
        displayName: String(
          zohoPayment?.payment_number ||
          zohoPayment?.display_name ||
          sourcePayment?.paymentNumber ||
          ''
        ).trim(),
        customerId: normalizeOptionalText(zohoPayment?.customer_id || zohoPayment?.customerId),
        paymentMode: normalizeOptionalText(zohoPayment?.payment_mode || zohoPayment?.paymentMode || sourcePayment?.paymentMode),
        currencyCode: normalizeOptionalText(zohoPayment?.currency_code || zohoPayment?.currencyCode),
        amount: Number(zohoPayment?.amount ?? sourcePayment?.amount ?? 0),
        syncedAt: new Date(),
        raw: zohoPayment,
      },
    },
    { upsert: true }
  );
}

async function markPaymentZohoSyncState(tenantDb, paymentId, updates) {
  const { zohoSyncAudit, ...paymentUpdates } = updates;

  await tenantDb.collection(MASTER_DATA_PAYMENTS_COLLECTION).updateOne(
    { _id: paymentId },
    {
      $set: {
        ...paymentUpdates,
        ...(zohoSyncAudit ? { zohoSyncAudit } : {}),
        updatedAt: new Date(),
      },
    }
  );
}

async function performPaymentZohoSync({ tenantDb, tenantId, botUserId, botMasterKey = {}, payment }) {
  const _id = payment._id instanceof ObjectId ? payment._id : toObjectId(payment._id, 'paymentId');
  let zohoPaymentId = '';

  try {
    if (String(payment.status || '').trim().toLowerCase() !== 'success') {
      throw new Error('Only successful payments can be synced to Zoho Books.');
    }

    const customer = await tenantDb.collection(MASTER_DATA_CUSTOMERS_COLLECTION).findOne({
      _id: payment.customerId,
      tenantId,
      isDeleted: { $ne: true },
    });

    if (!customer) {
      throw new Error('Customer for this payment was not found.');
    }

    assertZohoCustomerReady(customer, 'Payment sync');
    const zohoCustomerId = String(customer.zohoCustomerId || '').trim();

    const invoice = await tenantDb.collection(MASTER_DATA_INVOICES_COLLECTION).findOne({
      _id: payment.invoiceId,
      tenantId,
      isDeleted: { $ne: true },
    });

    if (!invoice) {
      throw new Error('Invoice for this payment was not found.');
    }

    assertZohoInvoiceReady(invoice, 'Payment sync');
    const zohoInvoiceId = String(invoice.zohoInvoiceId || '').trim();

    const {
      accessToken,
      organizationId,
      apiDomain,
    } = await getValidZohoAccessToken(botMasterKey || { botId: botUserId });

    if (!organizationId) {
      throw new Error('Zoho Books organization is not selected for this tenant.');
    }

    const baseUrl = `${String(apiDomain || 'https://www.zohoapis.com').replace(/\/+$/, '')}/books/v3/customerpayments`;
    const requestConfig = {
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
      },
      params: {
        organization_id: organizationId,
      },
    };

    zohoPaymentId = String(payment.zohoPaymentId || '').trim();
    let activeZohoPaymentId = zohoPaymentId;
    const executePaymentSync = async (includeCustomNumber = true) => {
      const paymentPayload = buildZohoPaymentPayload(payment, customer, invoice, {
        includeCustomNumber,
        includeInvoiceAllocations: !activeZohoPaymentId,
      });
      return activeZohoPaymentId
        ? { data: await putJson(`${baseUrl}/${encodeURIComponent(activeZohoPaymentId)}`, paymentPayload, { ...requestConfig, label: 'Zoho sync payment update' }) }
        : { data: await postJson(baseUrl, paymentPayload, { ...requestConfig, label: 'Zoho sync payment create' }) };
    };

    const executePaymentSyncWithNumberFallback = async () => {
      try {
        return await executePaymentSync(true);
      } catch (error) {
        if (!isZohoAutoNumberingConflict(error)) {
          throw error;
        }

        return executePaymentSync(false);
      }
    };

    let response;
    try {
      response = await executePaymentSyncWithNumberFallback();
    } catch (error) {
      if (!activeZohoPaymentId || !isZohoResourceNotAccessibleError(error)) {
        throw error;
      }

      const matchingPayment = await findZohoDocumentLiveMatch({
        baseUrl,
        requestConfig,
        queryParam: 'payment_number',
        queryValue: payment.paymentNumber,
        responseKey: 'customerpayments',
        numberKey: 'payment_number',
        idKeys: ['payment_id', 'customerpayment_id', 'paymentId', 'customerPaymentId'],
      });
      activeZohoPaymentId = String(
        matchingPayment?.payment_id ||
        matchingPayment?.customerpayment_id ||
        matchingPayment?.paymentId ||
        matchingPayment?.customerPaymentId ||
        ''
      ).trim();
      response = await executePaymentSyncWithNumberFallback();
    }

    const responseBody = response?.data || {};
    const zohoPayment = responseBody.payment || responseBody.customerpayment || responseBody.data || {};
    const resolvedZohoPaymentId = String(
      zohoPayment?.payment_id ||
      zohoPayment?.customerpayment_id ||
      zohoPayment?.paymentId ||
      zohoPayment?.customerPaymentId ||
      activeZohoPaymentId
    ).trim();

    if (!resolvedZohoPaymentId) {
      throw new Error('Zoho Books did not return a payment id for this payment.');
    }

    await markPaymentZohoSyncState(tenantDb, _id, {
      zohoPaymentId: resolvedZohoPaymentId,
      zohoSyncStatus: 'synced',
      zohoLastSyncedAt: new Date(),
      zohoErrorMessage: null,
      zohoSyncAudit: {
        status: 'synced',
        lastAttemptAt: new Date(),
        lastSyncedAt: new Date(),
        lastOperation: zohoPaymentId && activeZohoPaymentId === zohoPaymentId
          ? 'update'
          : (zohoPaymentId ? 'recover_stale_mapping' : 'create'),
        previousZohoPaymentId: zohoPaymentId && activeZohoPaymentId !== zohoPaymentId
          ? zohoPaymentId
          : null,
        zohoPaymentId: resolvedZohoPaymentId,
        lastError: null,
      },
    });

    await upsertZohoPaymentSnapshot(tenantDb, organizationId, {
      ...zohoPayment,
      payment_id: resolvedZohoPaymentId,
      payment_number: zohoPayment?.payment_number || payment.paymentNumber,
      customer_id: zohoPayment?.customer_id || zohoCustomerId,
      payment_mode: zohoPayment?.payment_mode || payment.paymentMode,
      amount: zohoPayment?.amount ?? payment.amount,
    }, payment);

    const syncedPayment = await tenantDb.collection(MASTER_DATA_PAYMENTS_COLLECTION).findOne({
      _id,
      tenantId,
    });

    return {
      ok: true,
      payment: serializeDocument(syncedPayment),
      errorMessage: null,
    };
  } catch (error) {
    const errorMessage = error?.response?.data?.message || error?.message || 'Zoho payment sync failed.';

    await markPaymentZohoSyncState(tenantDb, _id, {
      zohoSyncStatus: 'failed',
      zohoErrorMessage: errorMessage,
      zohoSyncAudit: {
        status: 'failed',
        lastAttemptAt: new Date(),
        lastOperation: zohoPaymentId ? 'update' : 'create',
        zohoPaymentId: zohoPaymentId || null,
        lastError: {
          httpStatus: error?.response?.status || null,
          zohoCode: error?.response?.data?.code || null,
          message: errorMessage,
          occurredAt: new Date(),
        },
      },
    });

    return {
      ok: false,
      payment: null,
      errorMessage,
    };
  }
}

function buildPaymentPayload(payload, context, existingDocument = null) {
  const paymentNumber = normalizeText(payload.paymentNumber);

  if (!paymentNumber) {
    throw createHttpError('paymentNumber is required.');
  }

  const paymentDate = parseDate(payload.paymentDate, 'paymentDate');

  if (!paymentDate) {
    throw createHttpError('paymentDate is required.');
  }

  const customerId = toObjectId(payload.customerId, 'customerId');
  const invoiceId = toObjectId(payload.invoiceId, 'invoiceId');
  const amount = parsePositiveNumber(payload.amount, 'amount');
  const paymentMode = normalizeText(payload.paymentMode).toLowerCase();
  validateAllowedValue(paymentMode, PAYMENT_MODES, 'paymentMode');
  const status = normalizeText(payload.status || 'success').toLowerCase();
  validateAllowedValue(status, PAYMENT_STATUSES, 'status');
  const now = new Date();

  return {
    tenantId: context.tenantId,
    botUserId: context.botUserId,
    paymentNumber,
    customerId,
    invoiceId,
    paymentDate,
    amount,
    paymentMode,
    referenceNumber: normalizeOptionalText(payload.referenceNumber),
    gatewayProvider: normalizeOptionalText(payload.gatewayProvider),
    gatewayPaymentId: normalizeOptionalText(payload.gatewayPaymentId),
    status,
    notes: normalizeOptionalText(payload.notes),
    isDeleted: false,
    zohoPaymentId: hasOwnValue(payload, 'zohoPaymentId')
      ? normalizeOptionalText(payload.zohoPaymentId)
      : (existingDocument?.zohoPaymentId || null),
    zohoSyncStatus: hasOwnValue(payload, 'zohoSyncStatus')
      ? normalizeText(payload.zohoSyncStatus || DEFAULT_ZOHO_SYNC_STATUS)
      : (existingDocument?.zohoSyncStatus || DEFAULT_ZOHO_SYNC_STATUS),
    zohoLastSyncedAt: hasOwnValue(payload, 'zohoLastSyncedAt')
      ? parseDate(payload.zohoLastSyncedAt, 'zohoLastSyncedAt')
      : (existingDocument?.zohoLastSyncedAt || null),
    zohoErrorMessage: hasOwnValue(payload, 'zohoErrorMessage')
      ? normalizeOptionalText(payload.zohoErrorMessage)
      : (existingDocument?.zohoErrorMessage || null),
    createdAt: existingDocument?.createdAt || now,
    updatedAt: now,
  };
}

export async function listCustomers({ tenantDb, tenant, botUserId, query }) {
  const context = buildContext({ tenant, botUserId });
  await ensureTierCollectionReady(tenantDb, context);
  const filter = {
    tenantId: context.tenantId,
    isDeleted: { $ne: true },
  };

  if (normalizeText(query.status)) {
    filter.status = normalizeText(query.status).toLowerCase();
  }

  const dateFilter = buildDateRangeFilter('createdAt', query.dateFrom, query.dateTo);
  if (dateFilter) {
    Object.assign(filter, dateFilter);
  }

  const searchTerm = normalizeText(query.search);

  if (!searchTerm) {
    const response = await fetchList(tenantDb.collection(MASTER_DATA_CUSTOMERS_COLLECTION), filter, query);
    response.items = await enrichCustomerTierReferences(tenantDb, response.items);
    response.items = await enrichCustomerWorkOrderReferences(tenantDb, response.items, {
      tenantId: context.tenantId,
      botUserId: context.botUserId,
      databaseName: tenant?.databaseName || tenant?.botMasterKey?.databaseName || '',
    });

    return response;
  }

  const allDocs = await tenantDb.collection(MASTER_DATA_CUSTOMERS_COLLECTION)
    .find(filter)
    .sort({ updatedAt: -1, createdAt: -1 })
    .toArray();

  const enrichedWithTiers = await enrichCustomerTierReferences(
    tenantDb,
    allDocs.map(serializeDocument)
  );
  const enriched = await enrichCustomerWorkOrderReferences(tenantDb, enrichedWithTiers, {
    tenantId: context.tenantId,
    botUserId: context.botUserId,
    databaseName: tenant?.databaseName || tenant?.botMasterKey?.databaseName || '',
  });

  const matched = applyPostQuerySearch(enriched, searchTerm, [
    'displayName', 'companyName', 'email', 'phone', 'mobile', 'customerCode',
    'customerType', 'status', 'gstNumber', 'taxTreatment', 'paymentTerms',
    'currencyCode', 'zohoSyncStatus', 'cybotUserId', 'tierName', 'tierKey',
  ]);

  return paginateItems(matched, query);
}

export async function listCustomersWithoutWorkOrders({ tenantDb, tenant, botUserId, query }) {
  const context = buildContext({ tenant, botUserId });
  await ensureTierCollectionReady(tenantDb, context);

  const workOrderCustomerIds = await tenantDb.collection(MASTER_DATA_WORK_ORDERS_COLLECTION)
    .distinct('customerId', {
      tenantId: context.tenantId,
      isDeleted: { $ne: true },
      customerId: { $type: 'objectId' },
    });

  const filter = {
    tenantId: context.tenantId,
    isDeleted: { $ne: true },
    _id: { $nin: workOrderCustomerIds },
  };

  if (normalizeText(query.status)) {
    filter.status = normalizeText(query.status).toLowerCase();
  }

  const dateFilter = buildDateRangeFilter('createdAt', query.dateFrom, query.dateTo);
  if (dateFilter) {
    Object.assign(filter, dateFilter);
  }

  const searchTerm = normalizeText(query.search);

  if (!searchTerm) {
    const response = await fetchList(tenantDb.collection(MASTER_DATA_CUSTOMERS_COLLECTION), filter, query);
    response.items = await enrichCustomerTierReferences(tenantDb, response.items);
    response.items = await enrichCustomerWorkOrderReferences(tenantDb, response.items, {
      tenantId: context.tenantId,
      botUserId: context.botUserId,
      databaseName: tenant?.databaseName || tenant?.botMasterKey?.databaseName || '',
    });
    return response;
  }

  const allDocs = await tenantDb.collection(MASTER_DATA_CUSTOMERS_COLLECTION)
    .find(filter)
    .sort({ updatedAt: -1, createdAt: -1 })
    .toArray();

  const enrichedWithTiers = await enrichCustomerTierReferences(
    tenantDb,
    allDocs.map(serializeDocument)
  );
  const enriched = await enrichCustomerWorkOrderReferences(tenantDb, enrichedWithTiers, {
    tenantId: context.tenantId,
    botUserId: context.botUserId,
    databaseName: tenant?.databaseName || tenant?.botMasterKey?.databaseName || '',
  });
  const matched = applyPostQuerySearch(enriched, searchTerm, [
    'displayName', 'companyName', 'email', 'phone', 'mobile', 'customerCode',
    'customerType', 'status', 'gstNumber', 'taxTreatment', 'paymentTerms',
    'currencyCode', 'zohoSyncStatus', 'cybotUserId', 'tierName', 'tierKey',
  ]);

  return paginateItems(matched, query);
}

export async function listWorkOrders({ tenantDb, tenant, botUserId, query }) {
  const context = buildContext({ tenant, botUserId });
  const mdFilter = {
    tenantId: context.tenantId,
    isDeleted: { $ne: true },
  };

  if (normalizeText(query.status)) {
    mdFilter.status = normalizeText(query.status).toLowerCase();
  }

  if (normalizeText(query.paymentStatus)) {
    mdFilter.paymentStatus = normalizeText(query.paymentStatus).toLowerCase();
  }

  const dateFilter = buildDateRangeFilter('requestedAt', query.dateFrom, query.dateTo);
  if (dateFilter) {
    Object.assign(mdFilter, dateFilter);
  }

  const searchTerm = normalizeText(query.search);

  // No search — use efficient DB-level pagination
  if (!searchTerm) {
    const { page, pageSize, skip } = parsePagination(query);
    const total = await tenantDb.collection(MASTER_DATA_WORK_ORDERS_COLLECTION).countDocuments(mdFilter);
    const docs = await tenantDb.collection(MASTER_DATA_WORK_ORDERS_COLLECTION)
      .find(mdFilter)
      .sort({ updatedAt: -1, createdAt: -1 })
      .skip(skip)
      .limit(pageSize)
      .toArray();
    const items = await enrichWorkOrderReferences(tenantDb, docs.map(serializeWorkOrderDocument));
    return buildPagedResponse(items, total, page, pageSize);
  }

  // With search — fetch all status/date filtered docs, enrich, then filter in memory
  // so we can also match against enriched fields like customerDisplayName, quoteNumberRef etc.
  const mdDocuments = await tenantDb.collection(MASTER_DATA_WORK_ORDERS_COLLECTION)
    .find(mdFilter)
    .sort({ updatedAt: -1, createdAt: -1 })
    .toArray();

  const mdItems = await enrichWorkOrderReferences(
    tenantDb,
    mdDocuments.map(serializeWorkOrderDocument)
  );

  const matched = applyPostQuerySearch(
    applyWorkOrderSearch(mdItems, searchTerm),
    searchTerm,
    ['customerDisplayName', 'customerCode', 'quoteNumberRef', 'invoiceNumberRef',
      'workOrderNumber', 'workOrderId', 'orderReferenceNumber',
      'totalAmount', 'grandTotal', 'balanceAmount', 'paidAmount']
  ).sort((left, right) => {
    const rightTime = new Date(right.updatedAt || right.createdAt || 0).getTime();
    const leftTime = new Date(left.updatedAt || left.createdAt || 0).getTime();
    return rightTime - leftTime;
  });

  return paginateItems(matched, query);
}

export async function getAdminCalendarEvents({ tenantDb, tenant, botUserId, query = {} }) {
  const context = buildContext({ tenant, botUserId });
  const { from, to } = resolveCalendarDateRange(query);

  const [customers, workOrders] = await Promise.all([
    tenantDb.collection(MASTER_DATA_CUSTOMERS_COLLECTION)
      .find({
        tenantId: context.tenantId,
        isDeleted: { $ne: true },
        createdAt: {
          $gte: from,
          $lte: to,
        },
      })
      .sort({ createdAt: 1, updatedAt: 1 })
      .toArray(),
    tenantDb.collection(MASTER_DATA_WORK_ORDERS_COLLECTION)
      .find({
        tenantId: context.tenantId,
        isDeleted: { $ne: true },
        createdAt: {
          $gte: from,
          $lte: to,
        },
      })
      .sort({ createdAt: 1, updatedAt: 1 })
      .toArray(),
  ]);

  const customerMap = new Map(customers.map((customer) => [customer._id.toString(), customer]));
  const events = [
    ...customers.map((customer) => serializeCalendarCustomerEvent(customer)),
    ...workOrders.map((workOrder) => serializeCalendarWorkOrderEvent(
      workOrder,
      customerMap.get(workOrder?.customerId?.toString?.() || '') || null,
    )),
  ]
    .filter((event) => event.startAt)
    .sort((left, right) => new Date(left.startAt || 0).getTime() - new Date(right.startAt || 0).getTime());

  return {
    range: {
      from: from.toISOString(),
      to: to.toISOString(),
    },
    summary: {
      totalEnquiries: customers.length,
      totalConversions: workOrders.length,
    },
    events,
  };
}

function buildDashboardCurrencyTotals(values = []) {
  return Number(
    values.reduce((sum, value) => sum + (Number.isFinite(Number(value)) ? Number(value) : 0), 0).toFixed(2)
  );
}

function buildReportDateRange(query = {}) {
  return resolveDashboardDateRange(query);
}

function buildReportWorkbook(sheetName, rows = []) {
  const workbook = xlsx.utils.book_new();
  const worksheet = xlsx.utils.json_to_sheet(rows);
  xlsx.utils.book_append_sheet(workbook, worksheet, sheetName);

  return xlsx.write(workbook, {
    type: 'buffer',
    bookType: 'xlsx',
  });
}

function buildReportCustomerFilter(customerId = '') {
  const normalizedCustomerId = normalizeText(customerId);

  if (!normalizedCustomerId) {
    return null;
  }

  return toObjectId(normalizedCustomerId, 'customerId');
}

function startOfUtcDay(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
}

function endOfUtcDay(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
}

function resolveDashboardDateRange(query = {}) {
  const period = normalizeText(query.period).toLowerCase() || 'month';
  const now = new Date();

  if (period === 'day') {
    return {
      period: 'day',
      from: startOfUtcDay(now),
      to: endOfUtcDay(now),
      granularity: 'hour',
    };
  }

  if (period === 'week') {
    const to = endOfUtcDay(now);
    const from = startOfUtcDay(new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - 6,
      0,
      0,
      0,
      0,
    )));

    return {
      period: 'week',
      from,
      to,
      granularity: 'day',
    };
  }

  if (period === 'custom') {
    const from = startOfUtcDay(parseCalendarRangeDate(query.from, 'from'));
    const to = endOfUtcDay(parseCalendarRangeDate(query.to, 'to'));

    if (from.getTime() > to.getTime()) {
      throw createHttpError('from date must be earlier than or equal to to date.');
    }

    return {
      period: 'custom',
      from,
      to,
      granularity: 'day',
    };
  }

  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  const to = endOfUtcDay(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 0, 0, 0, 0)));

  return {
    period: 'month',
    from,
    to,
    granularity: 'day',
  };
}

function formatDashboardBucketLabel(date, granularity) {
  if (granularity === 'hour') {
    const hours = String(date.getUTCHours()).padStart(2, '0');
    return `${hours}:00`;
  }

  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = date.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  return `${day} ${month}`;
}

function buildDashboardTrendPoints({ from, to, granularity, enquiries = [], workOrders = [], payments = [] }) {
  const points = [];
  const enquiriesMap = new Map();
  const workOrdersMap = new Map();
  const paymentsMap = new Map();

  const createKey = (date) => (
    granularity === 'hour'
      ? `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}-${date.getUTCHours()}`
      : `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}`
  );

  const normalizeBucketDate = (value) => {
    const parsed = new Date(value || 0);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }

    return granularity === 'hour'
      ? new Date(Date.UTC(
        parsed.getUTCFullYear(),
        parsed.getUTCMonth(),
        parsed.getUTCDate(),
        parsed.getUTCHours(),
        0,
        0,
        0,
      ))
      : startOfUtcDay(parsed);
  };

  enquiries.forEach((value) => {
    const bucketDate = normalizeBucketDate(value?.createdAt);
    if (!bucketDate) {
      return;
    }

    const key = createKey(bucketDate);
    enquiriesMap.set(key, (enquiriesMap.get(key) || 0) + 1);
  });

  workOrders.forEach((value) => {
    const bucketDate = normalizeBucketDate(value?.createdAt);
    if (!bucketDate) {
      return;
    }

    const key = createKey(bucketDate);
    workOrdersMap.set(key, (workOrdersMap.get(key) || 0) + 1);
  });

  payments.forEach((value) => {
    const bucketDate = normalizeBucketDate(value?.paymentDate || value?.createdAt);
    if (!bucketDate) {
      return;
    }

    const key = createKey(bucketDate);
    paymentsMap.set(key, buildDashboardCurrencyTotals([
      paymentsMap.get(key) || 0,
      value?.amount || 0,
    ]));
  });

  let cursor = new Date(from);

  while (cursor.getTime() <= to.getTime()) {
    const bucketDate = granularity === 'hour' ? new Date(cursor) : startOfUtcDay(cursor);
    const key = createKey(bucketDate);
    points.push({
      label: formatDashboardBucketLabel(bucketDate, granularity),
      enquiries: Number(enquiriesMap.get(key) || 0),
      workOrders: Number(workOrdersMap.get(key) || 0),
      collectedAmount: buildDashboardCurrencyTotals([paymentsMap.get(key) || 0]),
    });

    if (granularity === 'hour') {
      cursor = new Date(cursor.getTime() + (60 * 60 * 1000));
    } else {
      cursor = new Date(cursor.getTime() + (24 * 60 * 60 * 1000));
    }
  }

  return points;
}

export async function getBusinessDashboardSummary({ tenantDb, tenant, botUserId, query = {} }) {
  const context = buildContext({ tenant, botUserId });
  const { period, from, to, granularity } = resolveDashboardDateRange(query);
  const recentActivityLimit = 5;
  const baseFilter = {
    tenantId: context.tenantId,
    isDeleted: { $ne: true },
  };
  const rangeFilter = {
    $gte: from,
    $lte: to,
  };
  const customerFilter = {
    ...baseFilter,
    createdAt: rangeFilter,
  };
  const workOrderFilter = {
    ...baseFilter,
    createdAt: rangeFilter,
  };
  const quoteFilter = {
    ...baseFilter,
    createdAt: rangeFilter,
  };
  const invoiceFilter = {
    ...baseFilter,
    createdAt: rangeFilter,
  };
  const paymentFilter = {
    ...baseFilter,
    $or: [
      { paymentDate: rangeFilter },
      { paymentDate: { $exists: false }, createdAt: rangeFilter },
      { paymentDate: null, createdAt: rangeFilter },
    ],
  };

  const [
    totalEnquiries,
    totalWorkOrders,
    customersWithoutWorkOrders,
    workOrderStats,
    topProducts,
    quoteStats,
    invoiceStats,
    paymentStats,
    trendEnquiries,
    trendWorkOrders,
    trendPayments,
    recentEnquiries,
    recentQuotesRaw,
    recentInvoicesRaw,
    recentPaymentsRaw,
  ] = await Promise.all([
    tenantDb.collection(MASTER_DATA_CUSTOMERS_COLLECTION).countDocuments(customerFilter),
    tenantDb.collection(MASTER_DATA_WORK_ORDERS_COLLECTION).countDocuments(workOrderFilter),
    tenantDb.collection(MASTER_DATA_CUSTOMERS_COLLECTION).aggregate([
      { $match: customerFilter },
      {
        $lookup: {
          from: MASTER_DATA_WORK_ORDERS_COLLECTION,
          let: { customerId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$customerId', '$$customerId'] },
                    { $ne: ['$isDeleted', true] },
                    { $gte: ['$createdAt', from] },
                    { $lte: ['$createdAt', to] },
                  ],
                },
              },
            },
            { $limit: 1 },
          ],
          as: 'workOrders',
        },
      },
      {
        $match: {
          workOrders: { $eq: [] },
        },
      },
      { $count: 'total' },
    ]).toArray(),
    tenantDb.collection(MASTER_DATA_WORK_ORDERS_COLLECTION).aggregate([
      { $match: workOrderFilter },
      {
        $project: {
          totalAmount: { $ifNull: ['$totalAmount', '$grandTotal'] },
          paidAmount: { $ifNull: ['$paidAmount', 0] },
          balanceAmount: { $ifNull: ['$balanceAmount', 0] },
          paymentStatus: { $toLower: { $ifNull: ['$paymentStatus', 'pending'] } },
          lineItems: { $ifNull: ['$lineItems', []] },
        },
      },
      {
        $addFields: {
          lineItemQuantity: {
            $sum: {
              $map: {
                input: '$lineItems',
                as: 'item',
                in: { $ifNull: ['$$item.quantity', 0] },
              },
            },
          },
        },
      },
      {
        $group: {
          _id: null,
          grossSales: { $sum: { $ifNull: ['$totalAmount', 0] } },
          collectedAmount: { $sum: { $ifNull: ['$paidAmount', 0] } },
          outstandingAmount: { $sum: { $ifNull: ['$balanceAmount', 0] } },
          paidWorkOrders: {
            $sum: {
              $cond: [{ $eq: ['$paymentStatus', 'paid'] }, 1, 0],
            },
          },
          pendingWorkOrders: {
            $sum: {
              $cond: [{ $ne: ['$paymentStatus', 'paid'] }, 1, 0],
            },
          },
          totalItemQuantitySold: { $sum: { $ifNull: ['$lineItemQuantity', 0] } },
          highestOrderValue: { $max: { $ifNull: ['$totalAmount', 0] } },
        },
      },
    ]).toArray(),
    tenantDb.collection(MASTER_DATA_WORK_ORDERS_COLLECTION).aggregate([
      { $match: workOrderFilter },
      {
        $project: {
          lineItems: {
            $cond: [
              { $gt: [{ $size: { $ifNull: ['$lineItems', []] } }, 0] },
              '$lineItems',
              {
                $map: {
                  input: { $ifNull: ['$items', []] },
                  as: 'item',
                  in: {
                    name: { $ifNull: ['$$item.itemName', ''] },
                    quantity: { $ifNull: ['$$item.quantity', 0] },
                  },
                },
              },
            ],
          },
        },
      },
      { $unwind: { path: '$lineItems', preserveNullAndEmptyArrays: false } },
      {
        $project: {
          name: { $trim: { input: { $ifNull: ['$lineItems.name', ''] } } },
          quantity: { $ifNull: ['$lineItems.quantity', 0] },
        },
      },
      { $match: { name: { $ne: '' } } },
      {
        $group: {
          _id: '$name',
          quantity: { $sum: '$quantity' },
        },
      },
      { $sort: { quantity: -1, _id: 1 } },
      { $limit: 5 },
    ]).toArray(),
    tenantDb.collection(MASTER_DATA_QUOTES_COLLECTION).aggregate([
      { $match: quoteFilter },
      {
        $project: {
          grandTotal: { $ifNull: ['$grandTotal', 0] },
          status: { $toLower: { $ifNull: ['$status', 'draft'] } },
        },
      },
      {
        $group: {
          _id: null,
          totalQuotes: { $sum: 1 },
          draftQuotes: {
            $sum: { $cond: [{ $eq: ['$status', 'draft'] }, 1, 0] },
          },
          sentQuotes: {
            $sum: { $cond: [{ $eq: ['$status', 'sent'] }, 1, 0] },
          },
          acceptedQuotes: {
            $sum: { $cond: [{ $eq: ['$status', 'accepted'] }, 1, 0] },
          },
          declinedQuotes: {
            $sum: { $cond: [{ $eq: ['$status', 'declined'] }, 1, 0] },
          },
          expiredQuotes: {
            $sum: { $cond: [{ $eq: ['$status', 'expired'] }, 1, 0] },
          },
          totalQuoteValue: { $sum: '$grandTotal' },
        },
      },
    ]).toArray(),
    tenantDb.collection(MASTER_DATA_INVOICES_COLLECTION).aggregate([
      { $match: invoiceFilter },
      {
        $project: {
          grandTotal: { $ifNull: ['$grandTotal', 0] },
          balanceAmount: { $ifNull: ['$balanceAmount', 0] },
          status: { $toLower: { $ifNull: ['$status', 'draft'] } },
        },
      },
      {
        $group: {
          _id: null,
          totalInvoices: { $sum: 1 },
          draftInvoices: {
            $sum: {
              $cond: [{ $eq: ['$status', 'draft'] }, 1, 0],
            },
          },
          sentInvoices: {
            $sum: {
              $cond: [{ $eq: ['$status', 'sent'] }, 1, 0],
            },
          },
          partiallyPaidInvoices: {
            $sum: {
              $cond: [{ $eq: ['$status', 'partially_paid'] }, 1, 0],
            },
          },
          paidInvoices: {
            $sum: {
              $cond: [{ $eq: ['$status', 'paid'] }, 1, 0],
            },
          },
          overdueInvoices: {
            $sum: {
              $cond: [{ $eq: ['$status', 'overdue'] }, 1, 0],
            },
          },
          voidInvoices: {
            $sum: {
              $cond: [{ $eq: ['$status', 'void'] }, 1, 0],
            },
          },
          pendingInvoices: {
            $sum: {
              $cond: [{ $ne: ['$status', 'paid'] }, 1, 0],
            },
          },
          totalInvoiceValue: { $sum: '$grandTotal' },
          averageOrderValue: { $avg: '$grandTotal' },
        },
      },
    ]).toArray(),
    tenantDb.collection(MASTER_DATA_PAYMENTS_COLLECTION).aggregate([
      { $match: paymentFilter },
      {
        $project: {
          amount: { $ifNull: ['$amount', 0] },
          status: { $toLower: { $ifNull: ['$status', 'pending'] } },
        },
      },
      {
        $group: {
          _id: null,
          totalPayments: { $sum: 1 },
          pendingPayments: {
            $sum: {
              $cond: [{ $eq: ['$status', 'pending'] }, 1, 0],
            },
          },
          successPayments: {
            $sum: {
              $cond: [{ $eq: ['$status', 'success'] }, 1, 0],
            },
          },
          failedPayments: {
            $sum: {
              $cond: [{ $eq: ['$status', 'failed'] }, 1, 0],
            },
          },
          refundedPayments: {
            $sum: {
              $cond: [{ $eq: ['$status', 'refunded'] }, 1, 0],
            },
          },
          totalPaymentAmount: { $sum: '$amount' },
          collectedAmount: {
            $sum: {
              $cond: [{ $eq: ['$status', 'success'] }, '$amount', 0],
            },
          },
        },
      },
    ]).toArray(),
    tenantDb.collection(MASTER_DATA_CUSTOMERS_COLLECTION)
      .find(customerFilter, { projection: { createdAt: 1 } })
      .toArray(),
    tenantDb.collection(MASTER_DATA_WORK_ORDERS_COLLECTION)
      .find(workOrderFilter, { projection: { createdAt: 1 } })
      .toArray(),
    tenantDb.collection(MASTER_DATA_PAYMENTS_COLLECTION)
      .find(paymentFilter, { projection: { createdAt: 1, paymentDate: 1, amount: 1, status: 1 } })
      .toArray(),
    tenantDb.collection(MASTER_DATA_CUSTOMERS_COLLECTION).aggregate([
      { $match: customerFilter },
      { $sort: { createdAt: -1, updatedAt: -1 } },
      { $limit: recentActivityLimit },
      {
        $lookup: {
          from: MASTER_DATA_WORK_ORDERS_COLLECTION,
          let: { customerId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$customerId', '$$customerId'] },
                    { $ne: ['$isDeleted', true] },
                    { $gte: ['$createdAt', from] },
                    { $lte: ['$createdAt', to] },
                  ],
                },
              },
            },
            { $sort: { createdAt: -1, updatedAt: -1 } },
            { $limit: 1 },
            {
              $project: {
                workOrderNumber: 1,
                status: 1,
              },
            },
          ],
          as: 'recentWorkOrder',
        },
      },
      {
        $project: {
          displayName: 1,
          customerCode: 1,
          status: 1,
          createdAt: 1,
          recentWorkOrder: { $first: '$recentWorkOrder' },
        },
      },
    ]).toArray(),
    tenantDb.collection(MASTER_DATA_QUOTES_COLLECTION)
      .find(quoteFilter, {
        projection: {
          quoteNumber: 1,
          customerId: 1,
          status: 1,
          grandTotal: 1,
          quoteDate: 1,
          createdAt: 1,
        },
      })
      .sort({ createdAt: -1, updatedAt: -1 })
      .limit(recentActivityLimit)
      .toArray(),
    tenantDb.collection(MASTER_DATA_INVOICES_COLLECTION)
      .find(invoiceFilter, {
        projection: {
          invoiceNumber: 1,
          customerId: 1,
          quoteId: 1,
          status: 1,
          grandTotal: 1,
          balanceAmount: 1,
          invoiceDate: 1,
          dueDate: 1,
          createdAt: 1,
        },
      })
      .sort({ createdAt: -1, updatedAt: -1 })
      .limit(recentActivityLimit)
      .toArray(),
    tenantDb.collection(MASTER_DATA_PAYMENTS_COLLECTION)
      .find(paymentFilter, {
        projection: {
          paymentNumber: 1,
          customerId: 1,
          invoiceId: 1,
          status: 1,
          amount: 1,
          paymentDate: 1,
          createdAt: 1,
        },
      })
      .sort({ paymentDate: -1, createdAt: -1, updatedAt: -1 })
      .limit(recentActivityLimit)
      .toArray(),
  ]);

  const workOrderSummary = workOrderStats[0] || {};
  const quoteSummary = quoteStats[0] || {};
  const invoiceSummary = invoiceStats[0] || {};
  const paymentSummary = paymentStats[0] || {};
  const pendingEnquiries = customersWithoutWorkOrders[0]?.total || 0;
  const grossSales = buildDashboardCurrencyTotals([workOrderSummary.grossSales]);
  const workOrderCollectedAmount = buildDashboardCurrencyTotals([workOrderSummary.collectedAmount]);
  const paymentCollectedAmount = buildDashboardCurrencyTotals([paymentSummary.collectedAmount]);
  const collectedAmount = paymentCollectedAmount > 0 ? paymentCollectedAmount : workOrderCollectedAmount;
  const outstandingAmount = buildDashboardCurrencyTotals([workOrderSummary.outstandingAmount]);
  const averageOrderValue = totalWorkOrders > 0
    ? Number((grossSales / totalWorkOrders).toFixed(2))
    : Number(Number(invoiceSummary.averageOrderValue || 0).toFixed(2));
  const totalQuotes = Number(quoteSummary.totalQuotes || 0);
  const totalInvoices = Number(invoiceSummary.totalInvoices || 0);
  const totalPayments = Number(paymentSummary.totalPayments || 0);
  const paidInvoices = Number(invoiceSummary.paidInvoices || 0);
  const conversionRate = totalEnquiries > 0
    ? Number(((totalWorkOrders / totalEnquiries) * 100).toFixed(2))
    : 0;
  const workOrderToQuoteRate = totalWorkOrders > 0
    ? Number(((totalQuotes / totalWorkOrders) * 100).toFixed(2))
    : 0;
  const quoteToInvoiceRate = totalQuotes > 0
    ? Number(((totalInvoices / totalQuotes) * 100).toFixed(2))
    : 0;
  const invoiceToPaidRate = totalInvoices > 0
    ? Number(((paidInvoices / totalInvoices) * 100).toFixed(2))
    : 0;
  const successfulTrendPayments = trendPayments.filter(
    (payment) => normalizeText(payment?.status).toLowerCase() === 'success'
  );
  const trendPoints = buildDashboardTrendPoints({
    from,
    to,
    granularity,
    enquiries: trendEnquiries,
    workOrders: trendWorkOrders,
    payments: successfulTrendPayments,
  });
  const recentQuotes = await enrichCustomerReferences(
    tenantDb,
    recentQuotesRaw.map((quote) => serializeDocument(quote))
  );
  const recentInvoices = await enrichQuoteReferences(
    tenantDb,
    await enrichCustomerReferences(
      tenantDb,
      recentInvoicesRaw.map((invoice) => serializeDocument(invoice))
    )
  );
  const recentPayments = await enrichInvoiceReferences(
    tenantDb,
    await enrichCustomerReferences(
      tenantDb,
      recentPaymentsRaw.map((payment) => serializeDocument(payment))
    )
  );

  return {
    range: {
      period,
      from: from.toISOString(),
      to: to.toISOString(),
    },
    businessSummary: {
      customerEnquiries: totalEnquiries,
      workOrders: totalWorkOrders,
      quotes: totalQuotes,
      invoices: totalInvoices,
      payments: totalPayments,
      grossSales,
      collectedAmount,
    },
    salesPipeline: {
      enquiries: totalEnquiries,
      workOrders: totalWorkOrders,
      quotes: totalQuotes,
      invoices: totalInvoices,
      payments: totalPayments,
    },
    quoteOverview: {
      totalQuotes,
      draftQuotes: Number(quoteSummary.draftQuotes || 0),
      sentQuotes: Number(quoteSummary.sentQuotes || 0),
      acceptedQuotes: Number(quoteSummary.acceptedQuotes || 0),
      declinedQuotes: Number(quoteSummary.declinedQuotes || 0),
      expiredQuotes: Number(quoteSummary.expiredQuotes || 0),
      totalQuoteValue: buildDashboardCurrencyTotals([quoteSummary.totalQuoteValue]),
    },
    invoiceOverview: {
      totalInvoices,
      draftInvoices: Number(invoiceSummary.draftInvoices || 0),
      sentInvoices: Number(invoiceSummary.sentInvoices || 0),
      partiallyPaidInvoices: Number(invoiceSummary.partiallyPaidInvoices || 0),
      paidInvoices,
      overdueInvoices: Number(invoiceSummary.overdueInvoices || 0),
      voidInvoices: Number(invoiceSummary.voidInvoices || 0),
      totalInvoiceValue: buildDashboardCurrencyTotals([invoiceSummary.totalInvoiceValue]),
    },
    paymentOverview: {
      paidInvoicesOrOrders: Number(invoiceSummary.paidInvoices || workOrderSummary.paidWorkOrders || 0),
      pendingInvoicesOrOrders: Number(invoiceSummary.pendingInvoices || workOrderSummary.pendingWorkOrders || 0),
      totalPayments,
      pendingPayments: Number(paymentSummary.pendingPayments || 0),
      successPayments: Number(paymentSummary.successPayments || 0),
      failedPayments: Number(paymentSummary.failedPayments || 0),
      refundedPayments: Number(paymentSummary.refundedPayments || 0),
      totalPaymentAmount: buildDashboardCurrencyTotals([paymentSummary.totalPaymentAmount]),
      collectedAmount,
      outstandingAmount,
    },
    orderInsights: {
      totalItemQuantitySold: Number(workOrderSummary.totalItemQuantitySold || 0),
      averageOrderValue,
      highestOrderValue: buildDashboardCurrencyTotals([workOrderSummary.highestOrderValue]),
      topOrderedProducts: topProducts.map((item) => ({
        name: normalizeText(item?._id),
        quantity: Number(item?.quantity || 0),
      })),
    },
    enquiryConversion: {
      enquiriesReceived: totalEnquiries,
      workOrdersCreated: totalWorkOrders,
      conversionRate,
      pendingEnquiries,
    },
    funnelConversion: {
      enquiryToWorkOrderRate: conversionRate,
      workOrderToQuoteRate,
      quoteToInvoiceRate,
      invoiceToPaidRate,
    },
    recentActivity: {
      enquiries: recentEnquiries.map((enquiry) => ({
        id: enquiry?._id ? String(enquiry._id) : '',
        displayName: normalizeText(enquiry?.displayName) || 'Customer',
        customerCode: normalizeOptionalText(enquiry?.customerCode),
        status: normalizeText(enquiry?.status) || 'active',
        stage: enquiry?.recentWorkOrder?.workOrderNumber ? 'converted' : 'pending',
        workOrderNumber: normalizeOptionalText(enquiry?.recentWorkOrder?.workOrderNumber),
        createdAt: enquiry?.createdAt || null,
      })),
      quotes: recentQuotes.map((quote) => ({
        id: quote.id,
        quoteNumber: normalizeText(quote.quoteNumber),
        customerDisplayName: normalizeText(quote.customerDisplayName) || 'Customer',
        customerCode: normalizeOptionalText(quote.customerCode),
        status: normalizeText(quote.status) || 'draft',
        grandTotal: buildDashboardCurrencyTotals([quote.grandTotal]),
        quoteDate: quote.quoteDate || null,
        createdAt: quote.createdAt || null,
      })),
      invoices: recentInvoices.map((invoice) => ({
        id: invoice.id,
        invoiceNumber: normalizeText(invoice.invoiceNumber),
        customerDisplayName: normalizeText(invoice.customerDisplayName) || 'Customer',
        customerCode: normalizeOptionalText(invoice.customerCode),
        quoteNumberRef: normalizeOptionalText(invoice.quoteNumberRef),
        status: normalizeText(invoice.status) || 'draft',
        grandTotal: buildDashboardCurrencyTotals([invoice.grandTotal]),
        balanceAmount: buildDashboardCurrencyTotals([invoice.balanceAmount]),
        invoiceDate: invoice.invoiceDate || null,
        dueDate: invoice.dueDate || null,
        createdAt: invoice.createdAt || null,
      })),
      payments: recentPayments.map((payment) => ({
        id: payment.id,
        paymentNumber: normalizeText(payment.paymentNumber),
        customerDisplayName: normalizeText(payment.customerDisplayName) || 'Customer',
        customerCode: normalizeOptionalText(payment.customerCode),
        invoiceNumberRef: normalizeOptionalText(payment.invoiceNumberRef),
        status: normalizeText(payment.status) || 'pending',
        amount: buildDashboardCurrencyTotals([payment.amount]),
        paymentDate: payment.paymentDate || null,
        createdAt: payment.createdAt || null,
      })),
    },
    trend: {
      granularity,
      points: trendPoints,
    },
  };
}

export async function downloadCustomerReport({ tenantDb, tenant, botUserId, query = {} }) {
  const context = buildContext({ tenant, botUserId });
  const customerObjectId = buildReportCustomerFilter(query.customerId);
  const { period, from, to } = buildReportDateRange(query);
  const filter = {
    tenantId: context.tenantId,
    isDeleted: { $ne: true },
    createdAt: {
      $gte: from,
      $lte: to,
    },
  };

  if (customerObjectId) {
    filter._id = customerObjectId;
  }

  const customers = await tenantDb.collection(MASTER_DATA_CUSTOMERS_COLLECTION)
    .find(filter)
    .sort({ createdAt: -1, updatedAt: -1 })
    .toArray();

  const enrichedCustomers = await enrichCustomerTierReferences(
    tenantDb,
    customers.map((customer) => serializeDocument(customer))
  );

  const rows = enrichedCustomers.map((customer) => ({
    Period: period,
    CustomerCode: normalizeText(customer.customerCode),
    DisplayName: normalizeText(customer.displayName),
    CompanyName: normalizeText(customer.companyName),
    CustomerType: normalizeText(customer.customerType),
    Email: normalizeText(customer.email),
    Phone: normalizeText(customer.phone || customer.mobile),
    Tier: normalizeText(customer.tierName),
    Status: normalizeText(customer.status),
    CreatedAt: customer.createdAt || '',
    UpdatedAt: customer.updatedAt || '',
  }));

  return {
    fileName: `customer-report-${period}.xlsx`,
    buffer: buildReportWorkbook('Customers', rows),
  };
}

export async function listCustomerReportPreview({ tenantDb, tenant, botUserId, query = {} }) {
  const context = buildContext({ tenant, botUserId });
  const customerObjectId = buildReportCustomerFilter(query.customerId);
  const { from, to } = buildReportDateRange(query);
  const filter = {
    tenantId: context.tenantId,
    isDeleted: { $ne: true },
    createdAt: {
      $gte: from,
      $lte: to,
    },
  };

  if (customerObjectId) {
    filter._id = customerObjectId;
  }

  const customers = await tenantDb.collection(MASTER_DATA_CUSTOMERS_COLLECTION)
    .find(filter)
    .sort({ createdAt: -1, updatedAt: -1 })
    .toArray();

  const enrichedCustomers = await enrichCustomerTierReferences(
    tenantDb,
    customers.map((customer) => serializeDocument(customer))
  );

  const searchTerm = normalizeText(query.search);
  const matched = searchTerm
    ? applyPostQuerySearch(enrichedCustomers, searchTerm, [
      'displayName', 'companyName', 'email', 'phone', 'mobile', 'customerCode',
      'customerType', 'status', 'tierName', 'tierKey', 'cybotUserId',
    ])
    : enrichedCustomers;

  return paginateItems(matched, query);
}

export async function downloadInvoiceReport({ tenantDb, tenant, botUserId, query = {} }) {
  const context = buildContext({ tenant, botUserId });
  const customerObjectId = buildReportCustomerFilter(query.customerId);
  const { period, from, to } = buildReportDateRange(query);
  const filter = {
    tenantId: context.tenantId,
    isDeleted: { $ne: true },
    createdAt: {
      $gte: from,
      $lte: to,
    },
  };

  if (customerObjectId) {
    filter.customerId = customerObjectId;
  }

  const invoices = await tenantDb.collection(MASTER_DATA_INVOICES_COLLECTION)
    .find(filter)
    .sort({ createdAt: -1, updatedAt: -1 })
    .toArray();

  const enrichedInvoices = await enrichQuoteReferences(
    tenantDb,
    await enrichCustomerReferences(tenantDb, invoices.map((invoice) => serializeDocument(invoice)))
  );

  const rows = enrichedInvoices.map((invoice) => ({
    Period: period,
    InvoiceNumber: normalizeText(invoice.invoiceNumber),
    CustomerCode: normalizeText(invoice.customerCode),
    CustomerName: normalizeText(invoice.customerDisplayName),
    QuoteNumber: normalizeText(invoice.quoteNumberRef),
    InvoiceDate: invoice.invoiceDate || '',
    DueDate: invoice.dueDate || '',
    Status: normalizeText(invoice.status),
    GrandTotal: Number(invoice.grandTotal || 0),
    PaidAmount: Number(invoice.paidAmount || 0),
    BalanceAmount: Number(invoice.balanceAmount || 0),
    CreatedAt: invoice.createdAt || '',
    UpdatedAt: invoice.updatedAt || '',
  }));

  return {
    fileName: `invoice-report-${period}.xlsx`,
    buffer: buildReportWorkbook('Invoices', rows),
  };
}

export async function listInvoiceReportPreview({ tenantDb, tenant, botUserId, query = {} }) {
  const context = buildContext({ tenant, botUserId });
  const customerObjectId = buildReportCustomerFilter(query.customerId);
  const { from, to } = buildReportDateRange(query);
  const filter = {
    tenantId: context.tenantId,
    isDeleted: { $ne: true },
    createdAt: {
      $gte: from,
      $lte: to,
    },
  };

  if (customerObjectId) {
    filter.customerId = customerObjectId;
  }

  const invoices = await tenantDb.collection(MASTER_DATA_INVOICES_COLLECTION)
    .find(filter)
    .sort({ createdAt: -1, updatedAt: -1 })
    .toArray();

  const enrichedInvoices = await enrichQuoteReferences(
    tenantDb,
    await enrichCustomerReferences(tenantDb, invoices.map((invoice) => serializeDocument(invoice)))
  );

  const searchTerm = normalizeText(query.search);
  const matched = searchTerm
    ? applyPostQuerySearch(enrichedInvoices, searchTerm, [
      'invoiceNumber', 'status', 'paymentStatus', 'customerDisplayName', 'customerCode',
      'quoteNumberRef', 'grandTotal', 'paidAmount', 'balanceAmount',
    ])
    : enrichedInvoices;

  return paginateItems(matched, query);
}

export async function downloadWorkOrderReport({ tenantDb, tenant, botUserId, query = {} }) {
  const context = buildContext({ tenant, botUserId });
  const customerObjectId = buildReportCustomerFilter(query.customerId);
  const { period, from, to } = buildReportDateRange(query);
  const filter = {
    tenantId: context.tenantId,
    isDeleted: { $ne: true },
    createdAt: {
      $gte: from,
      $lte: to,
    },
  };

  if (customerObjectId) {
    filter.customerId = customerObjectId;
  }

  const workOrders = await tenantDb.collection(MASTER_DATA_WORK_ORDERS_COLLECTION)
    .find(filter)
    .sort({ createdAt: -1, updatedAt: -1 })
    .toArray();

  const enrichedWorkOrders = await enrichWorkOrderReferences(
    tenantDb,
    workOrders.map((workOrder) => serializeWorkOrderDocument(workOrder))
  );

  const rows = enrichedWorkOrders.map((workOrder) => ({
    Period: period,
    WorkOrderNumber: normalizeText(workOrder.workOrderNumber),
    OrderReferenceNumber: normalizeText(workOrder.orderReferenceNumber),
    CustomerCode: normalizeText(workOrder.customerCode),
    CustomerName: normalizeText(workOrder.customerDisplayName),
    Status: normalizeText(workOrder.status),
    PaymentStatus: normalizeText(workOrder.paymentStatus),
    DeliveryMode: normalizeText(workOrder.deliveryMode),
    RequestedAt: workOrder.requestedAt || '',
    TotalAmount: Number(workOrder.totalAmount || workOrder.grandTotal || 0),
    PaidAmount: Number(workOrder.paidAmount || 0),
    BalanceAmount: Number(workOrder.balanceAmount || 0),
    CreatedAt: workOrder.createdAt || '',
    UpdatedAt: workOrder.updatedAt || '',
  }));

  return {
    fileName: `work-order-report-${period}.xlsx`,
    buffer: buildReportWorkbook('WorkOrders', rows),
  };
}

export async function listWorkOrderReportPreview({ tenantDb, tenant, botUserId, query = {} }) {
  const context = buildContext({ tenant, botUserId });
  const customerObjectId = buildReportCustomerFilter(query.customerId);
  const { from, to } = buildReportDateRange(query);
  const filter = {
    tenantId: context.tenantId,
    isDeleted: { $ne: true },
    createdAt: {
      $gte: from,
      $lte: to,
    },
  };

  if (customerObjectId) {
    filter.customerId = customerObjectId;
  }

  const workOrders = await tenantDb.collection(MASTER_DATA_WORK_ORDERS_COLLECTION)
    .find(filter)
    .sort({ createdAt: -1, updatedAt: -1 })
    .toArray();

  const enrichedWorkOrders = await enrichWorkOrderReferences(
    tenantDb,
    workOrders.map((workOrder) => serializeWorkOrderDocument(workOrder))
  );

  const searchTerm = normalizeText(query.search);
  const matched = searchTerm
    ? applyPostQuerySearch(
        applyWorkOrderSearch(enrichedWorkOrders, searchTerm),
        searchTerm,
        ['customerDisplayName', 'customerCode', 'quoteNumberRef', 'invoiceNumberRef',
          'workOrderNumber', 'workOrderId', 'orderReferenceNumber',
          'totalAmount', 'grandTotal', 'balanceAmount', 'paidAmount'],
      )
    : enrichedWorkOrders;

  return paginateItems(matched, query);
}

export async function getAdminCalendarWorkOrderDetails({ tenantDb, tenant, botUserId, workOrderId }) {
  const context = buildContext({ tenant, botUserId });
  const workOrder = await tenantDb.collection(MASTER_DATA_WORK_ORDERS_COLLECTION).findOne({
    _id: toObjectId(workOrderId, 'workOrderId'),
    tenantId: context.tenantId,
    isDeleted: { $ne: true },
  });

  if (!workOrder) {
    throw createHttpError('Work order was not found.', 404);
  }

  const paymentFilters = [];

  if (Array.isArray(workOrder.paymentIds) && workOrder.paymentIds.length > 0) {
    paymentFilters.push({ _id: { $in: workOrder.paymentIds } });
  }

  if (workOrder.invoiceId) {
    paymentFilters.push({ invoiceId: workOrder.invoiceId });
  }

  const [customer, quote, invoice, payments] = await Promise.all([
    findCustomerByIdOptional(tenantDb, workOrder.customerId),
    findQuoteByIdOptional(tenantDb, workOrder.quoteId),
    findInvoiceByIdOptional(tenantDb, workOrder.invoiceId),
    paymentFilters.length
      ? tenantDb.collection(MASTER_DATA_PAYMENTS_COLLECTION)
        .find({
          tenantId: context.tenantId,
          isDeleted: { $ne: true },
          $or: paymentFilters,
        })
        .sort({ paymentDate: -1, createdAt: -1 })
        .toArray()
      : [],
  ]);

  return serializeCalendarWorkOrderDetails({
    workOrder,
    customer,
    quote,
    invoice,
    payments,
  });
}

export async function getWorkOrderDetails({ tenantDb, tenant, botUserId, workOrderNumber }) {
  const context = buildContext({ tenant, botUserId });
  const reference = normalizeRequiredText(workOrderNumber, 'workOrderNumber');
  const workOrder = await tenantDb.collection(MASTER_DATA_WORK_ORDERS_COLLECTION).findOne({
    tenantId: context.tenantId,
    isDeleted: { $ne: true },
    $or: [
      { workOrderNumber: reference },
      { workOrderId: reference },
      { salesOrderId: reference },
    ],
  });

  if (!workOrder) {
    throw createHttpError('Work order was not found.', 404);
  }

  const paymentFilters = [];
  if (Array.isArray(workOrder.paymentIds) && workOrder.paymentIds.length > 0) {
    paymentFilters.push({ _id: { $in: workOrder.paymentIds } });
  }
  if (workOrder.invoiceId) {
    paymentFilters.push({ invoiceId: workOrder.invoiceId });
  }

  const [customer, quote, invoice, payments] = await Promise.all([
    findCustomerByIdOptional(tenantDb, workOrder.customerId),
    findQuoteByIdOptional(tenantDb, workOrder.quoteId),
    findInvoiceByIdOptional(tenantDb, workOrder.invoiceId),
    paymentFilters.length
      ? tenantDb.collection(MASTER_DATA_PAYMENTS_COLLECTION).find({
        tenantId: context.tenantId,
        isDeleted: { $ne: true },
        $or: paymentFilters,
      }).sort({ paymentDate: -1, createdAt: -1 }).toArray()
      : [],
  ]);

  return serializeCalendarWorkOrderDetails({ workOrder, customer, quote, invoice, payments });
}

export async function createWorkOrder({
  tenantDb,
  tenant,
  botUserId,
  payload,
  requestContext = {},
}) {
  const context = buildContext({ tenant, botUserId });
  const now = new Date();
  const quoteOnly = Boolean(payload?.quoteOnly);
  const customer = await resolveWorkOrderCustomer(tenantDb, context.tenantId, payload.customerInfo);
  const normalizedItems = normalizeAgentWorkOrderItems(payload.items);
  const items = payload?.orderSource === 'webpage'
    ? normalizedItems
    : await attachInventoryImages(
      tenantDb,
      context.tenantId,
      context.botUserId,
      normalizedItems,
    );
  const requestedWorkOrderNumber =
    normalizeText(payload?.workOrderNumber) || normalizeText(payload?.workOrderId);
  const existingWorkOrder = requestedWorkOrderNumber
    ? await tenantDb.collection(MASTER_DATA_WORK_ORDERS_COLLECTION).findOne({
      tenantId: context.tenantId,
      workOrderNumber: requestedWorkOrderNumber,
      isDeleted: { $ne: true },
    })
    : null;

  if (quoteOnly && !existingWorkOrder) {
    const standaloneQuote = await createStandaloneQuoteForAgentOrder({
      tenantDb,
      tenant,
      botMasterKey: tenant?.botMasterKey || {},
      context,
      customer,
      items,
      payload,
    });

    logger.info('Master data standalone quote created from booking summary', {
      botUserId: context.botUserId,
      tenantId: context.tenantId,
      quoteId: standaloneQuote.quoteId?.toString?.() || '',
      customerId: customer._id.toString(),
      itemCount: items.length,
    });

    return {
      workOrderNumber: null,
      workOrderId: null,
      orderReferenceNumber: null,
      quoteId: standaloneQuote.quoteId?.toString?.() || null,
      quoteLink: standaloneQuote.quoteUrl || standaloneQuote.quote?.zohoEstimateUrl || null,
      quotePdf: standaloneQuote.quoteUrl ? { url: standaloneQuote.quoteUrl } : null,
      invoicePdf: null,
      customerHistoryUrl: null,
      quote: standaloneQuote.quote,
    };
  }

  if (!existingWorkOrder) {
    await ensureWorkOrderAvailability({
      tenant,
      customer,
      payload,
      botUserId: context.botUserId,
      requestContext,
    });
  }

  const sequence = existingWorkOrder ? null : await generateDailyWorkOrderSequence(tenantDb, context.tenantId, now);
  const document = buildAgentWorkOrderDocument({
    context,
    payload,
    customer,
    items,
    now,
    sequence,
  });

  let workOrderDocument;

  if (existingWorkOrder) {
    const updatedDocument = {
      ...existingWorkOrder,
      ...document,
      _id: existingWorkOrder._id,
      workOrderNumber: existingWorkOrder.workOrderNumber,
      workOrderId: existingWorkOrder.workOrderNumber,
      orderReferenceNumber: existingWorkOrder.orderReferenceNumber || document.orderReferenceNumber,
      quoteId: existingWorkOrder.quoteId || document.quoteId,
      invoiceId: existingWorkOrder.invoiceId || null,
      paymentIds: Array.isArray(existingWorkOrder.paymentIds) ? existingWorkOrder.paymentIds : [],
      createdAt: existingWorkOrder.createdAt || now,
      updatedAt: now,
      statusTimeline: Array.isArray(existingWorkOrder.statusTimeline)
        ? existingWorkOrder.statusTimeline
        : document.statusTimeline,
    };
    const statusTimelineEntry = {
      status: updatedDocument.status || 'open',
      changedAt: now,
      changedBy: 'conversation-agent',
      notes: 'Work order updated from booking summary edit.',
    };
    const { statusTimeline, ...updatedDocumentWithoutTimeline } = updatedDocument;

    await tenantDb.collection(MASTER_DATA_WORK_ORDERS_COLLECTION).updateOne(
      { _id: existingWorkOrder._id },
      {
        $set: updatedDocumentWithoutTimeline,
        $push: {
          statusTimeline: statusTimelineEntry,
        },
      }
    );

    workOrderDocument = {
      ...updatedDocument,
      statusTimeline: [
        ...(Array.isArray(statusTimeline) ? statusTimeline : []),
        statusTimelineEntry,
      ],
    };
  } else {
    const result = await tenantDb.collection(MASTER_DATA_WORK_ORDERS_COLLECTION).insertOne(document);
    workOrderDocument = { _id: result.insertedId, ...document };

    try {
      await consumeWorkOrderUsage({
        tenant,
        customer,
        payload,
        botUserId: context.botUserId,
        requestContext,
      });
    } catch (error) {
      logger.error('Failed to consume work order entitlement after work order creation', {
        botUserId: context.botUserId,
        tenantId: context.tenantId,
        workOrderId: workOrderDocument.workOrderNumber,
        error: error?.message || String(error),
      });
    }
  }

  if (quoteOnly) {
    await createOrUpdateQuoteForWorkOrder({
      tenantDb,
      tenant,
      botMasterKey: tenant?.botMasterKey || {},
      context,
      customer,
      workOrder: workOrderDocument,
      quoteStatus: 'sent',
    });
  } else {
    await createSalesDocumentsForWorkOrder({
      tenantDb,
      tenant,
      botMasterKey: tenant?.botMasterKey || {},
      context,
      customer,
      workOrder: workOrderDocument,
    });

    const latestPersistedWorkOrder = await tenantDb.collection(MASTER_DATA_WORK_ORDERS_COLLECTION).findOne({
      _id: workOrderDocument._id,
      tenantId: context.tenantId,
      isDeleted: { $ne: true },
    });
    const hasPaymentLink = Boolean(normalizeOptionalText(
      latestPersistedWorkOrder?.paymentLink || workOrderDocument.paymentLink,
    ));

    if (!hasPaymentLink) {
      try {
        const temporaryPaymentLink = await findTemporaryPaymentGatewayLink(tenantDb, {
          tenantId: context.tenantId,
          databaseName:
            normalizeOptionalText(payload?.databaseName) ||
            normalizeOptionalText(payload?.sourcePayload?.databaseInfo?.requestDatabaseName) ||
            normalizeOptionalText(payload?.sourcePayload?.databaseInfo?.databaseName) ||
            normalizeOptionalText(payload?.sourcePayload?.reqMessageObj?.databaseName) ||
            normalizeOptionalText(tenant?.databaseName) ||
            normalizeOptionalText(tenant?.botMasterKey?.databaseName),
        });

        if (temporaryPaymentLink?.paymentLink) {
          await attachPaymentLinkToWorkOrder({
            tenantDb,
            tenant,
            botUserId,
            workOrderNumber: workOrderDocument.workOrderNumber,
            payload: temporaryPaymentLink,
          });
        }
      } catch (error) {
        logger.warn('Temporary payment link attachment failed for work order', {
          botUserId: context.botUserId,
          tenantId: context.tenantId,
          workOrderId: workOrderDocument.workOrderNumber,
          errorMessage: error?.message || 'Unknown temporary payment link error.',
        });
      }
    }
  }
  const latestWorkOrder = await tenantDb.collection(MASTER_DATA_WORK_ORDERS_COLLECTION).findOne({
    _id: workOrderDocument._id,
    tenantId: context.tenantId,
    isDeleted: { $ne: true },
  });
  const enriched = await enrichWorkOrderReferences(
    tenantDb,
    [serializeWorkOrderDocument(latestWorkOrder || workOrderDocument)]
  );

  if (!existingWorkOrder && latestWorkOrder) {
    try {
      const notificationSummary = await notifyAdminsOfNewWorkOrder({
        tenantDb,
        tenant,
        botUserId: context.botUserId,
        workOrder: latestWorkOrder,
        customer,
        enrichedWorkOrder: enriched[0] || {},
        requestId: requestContext.requestId || '',
      });

      logger.info('New work order admin notification flow completed', {
        tenantId: context.tenantId,
        workOrderId: latestWorkOrder.workOrderNumber,
        ...notificationSummary,
      });
    } catch (error) {
      logger.error('New work order admin notification flow failed', {
        tenantId: context.tenantId,
        workOrderId: latestWorkOrder.workOrderNumber,
        error: error?.message || String(error),
      });
    }
  }

  logger.info(existingWorkOrder ? 'Master data work order updated' : 'Master data work order created', {
    botUserId: context.botUserId,
    tenantId: context.tenantId,
    workOrderId: workOrderDocument.workOrderNumber,
    orderReferenceNumber: workOrderDocument.orderReferenceNumber,
    customerId: customer._id.toString(),
    itemCount: items.length,
  });

  return withCustomerHistoryUrl(
    enriched[0] || serializeWorkOrderDocument(workOrderDocument),
    tenant?.botMasterKey || {},
    customer,
  );
}

export async function attachPaymentLinkToWorkOrder({ tenantDb, tenant, botUserId, workOrderNumber, payload }) {
  const context = buildContext({ tenant, botUserId });
  const normalizedWorkOrderNumber = normalizeRequiredText(workOrderNumber, 'workOrderNumber');
  const paymentLinkId = normalizeRequiredText(payload.paymentLinkId, 'paymentLinkId');
  const paymentLink = normalizeRequiredText(payload.paymentLink, 'paymentLink');
  const paymentLinkGeneratedAt = new Date();
  let workOrder = await tenantDb.collection(MASTER_DATA_WORK_ORDERS_COLLECTION).findOne({
    tenantId: context.tenantId,
    workOrderNumber: normalizedWorkOrderNumber,
    isDeleted: { $ne: true },
  });

  if (!workOrder) {
    throw createHttpError('Work order was not found.', 404);
  }

  const customer = await ensureCustomerExists(tenantDb, workOrder.customerId);

  if (!workOrder.invoiceId || !Array.isArray(workOrder.paymentIds) || workOrder.paymentIds.length === 0) {
    await ensureInvoiceAndPaymentForWorkOrder({
      tenantDb,
      tenant,
      botMasterKey: tenant?.botMasterKey || {},
      context,
      customer,
      workOrder,
    });

    workOrder = await tenantDb.collection(MASTER_DATA_WORK_ORDERS_COLLECTION).findOne({
      tenantId: context.tenantId,
      workOrderNumber: normalizedWorkOrderNumber,
      isDeleted: { $ne: true },
    });
  }

  const result = await tenantDb.collection(MASTER_DATA_WORK_ORDERS_COLLECTION).findOneAndUpdate(
    {
      tenantId: context.tenantId,
      workOrderNumber: normalizedWorkOrderNumber,
      isDeleted: { $ne: true },
    },
    {
      $set: {
        paymentStatus: 'pending',
        paymentLinkId,
        paymentLink,
        paymentLinkGeneratedAt,
        updatedAt: paymentLinkGeneratedAt,
        internalNotes: `Payment link shared: ${paymentLink}`,
      },
      $push: {
        statusTimeline: {
          status: 'open',
          changedAt: paymentLinkGeneratedAt,
          changedBy: 'conversation-agent',
          notes: `Payment link shared (${paymentLinkId})`,
        },
      },
    },
    {
      returnDocument: 'after',
    }
  );

  if (result.invoiceId) {
    await tenantDb.collection(MASTER_DATA_PAYMENTS_COLLECTION).updateMany(
      {
        tenantId: context.tenantId,
        invoiceId: result.invoiceId,
        isDeleted: { $ne: true },
      },
      {
        $set: {
          referenceNumber: paymentLinkId,
          gatewayProvider: 'zoho',
          notes: `Payment link shared: ${paymentLink}`,
          updatedAt: paymentLinkGeneratedAt,
        },
      }
    );
  }

  logger.info('Master data work order payment link attached', {
    botUserId: context.botUserId,
    tenantId: context.tenantId,
    workOrderId: normalizedWorkOrderNumber,
    paymentLinkId,
  });

  const latestWorkOrder = await tenantDb.collection(MASTER_DATA_WORK_ORDERS_COLLECTION).findOne({
    tenantId: context.tenantId,
    workOrderNumber: normalizedWorkOrderNumber,
    isDeleted: { $ne: true },
  }) || result;
  const enriched = await enrichWorkOrderReferences(tenantDb, [serializeWorkOrderDocument(latestWorkOrder)]);
  return withCustomerHistoryUrl(
    enriched[0] || serializeWorkOrderDocument(latestWorkOrder),
    tenant?.botMasterKey || {},
    customer,
  );
}

export async function createCustomer({ tenantDb, tenant, botUserId, botMasterKey = {}, payload }) {
  const context = buildContext({ tenant, botUserId });
  const document = await buildCustomerPayload(tenantDb, payload, context);
  const result = await tenantDb.collection(MASTER_DATA_CUSTOMERS_COLLECTION).insertOne(document);
  const insertedId = result.insertedId;

  logger.info('Master data customer created', {
    botUserId: context.botUserId,
    tenantId: context.tenantId,
    customerId: insertedId.toString(),
  });

  if (isZohoAutoSyncEnabled(tenant, botMasterKey)) {
    await runBestEffortZohoSync({
      entityName: 'customer',
      entityId: insertedId.toString(),
      context,
      syncOperation: () => performCustomerZohoSync({
        tenantDb,
        tenantId: context.tenantId,
        botUserId: context.botUserId,
        botMasterKey,
        customer: { _id: insertedId, ...document },
      }),
    });
  }

  const latestCustomer = await tenantDb.collection(MASTER_DATA_CUSTOMERS_COLLECTION).findOne({
    _id: insertedId,
    tenantId: context.tenantId,
    isDeleted: { $ne: true },
  });

  return serializeCustomerDocumentWithTier(tenantDb, latestCustomer || { _id: insertedId, ...document });
}

export async function getCustomerById({ tenantDb, tenant, botUserId, customerId }) {
  const context = buildContext({ tenant, botUserId });
  await ensureTierCollectionReady(tenantDb, context);
  const document = await tenantDb.collection(MASTER_DATA_CUSTOMERS_COLLECTION).findOne({
    _id: toObjectId(customerId, 'customerId'),
    tenantId: context.tenantId,
    isDeleted: { $ne: true },
  });

  if (!document) {
    throw createHttpError('Customer was not found.', 404);
  }

  return serializeCustomerDocumentWithTier(tenantDb, document);
}

export async function getCustomerHistory({
  tenantDb,
  tenant,
  botUserId,
  encodedCustomerContext,
}) {
  const context = buildContext({ tenant, botUserId });
  const customer = await resolveCustomerForHistoryAccess(tenantDb, context, encodedCustomerContext);
  const customerId = customer._id;
  const workOrders = await tenantDb.collection(MASTER_DATA_WORK_ORDERS_COLLECTION)
    .find({
      tenantId: context.tenantId,
      customerId,
      isDeleted: { $ne: true },
    })
    .sort({ updatedAt: -1, createdAt: -1 })
    .toArray();
  const serializedWorkOrders = await enrichWorkOrderReferences(
    tenantDb,
    workOrders.map(serializeWorkOrderDocument),
  );

  const quoteIds = serializedWorkOrders
    .map((workOrder) => normalizeText(workOrder.quoteId))
    .filter((value) => ObjectId.isValid(value))
    .map((value) => new ObjectId(value));
  const invoiceIds = serializedWorkOrders
    .map((workOrder) => normalizeText(workOrder.invoiceId))
    .filter((value) => ObjectId.isValid(value))
    .map((value) => new ObjectId(value));
  const paymentIds = serializedWorkOrders
    .flatMap((workOrder) => Array.isArray(workOrder.paymentIds) ? workOrder.paymentIds : [])
    .map((value) => normalizeText(value))
    .filter((value) => ObjectId.isValid(value))
    .map((value) => new ObjectId(value));

  const [quotes, invoices, payments] = await Promise.all([
    quoteIds.length
      ? tenantDb.collection(MASTER_DATA_QUOTES_COLLECTION).find({
        _id: { $in: quoteIds },
        tenantId: context.tenantId,
        isDeleted: { $ne: true },
      }).toArray()
      : [],
    invoiceIds.length
      ? tenantDb.collection(MASTER_DATA_INVOICES_COLLECTION).find({
        _id: { $in: invoiceIds },
        tenantId: context.tenantId,
        isDeleted: { $ne: true },
      }).toArray()
      : [],
    tenantDb.collection(MASTER_DATA_PAYMENTS_COLLECTION).find({
      tenantId: context.tenantId,
      customerId,
      isDeleted: { $ne: true },
      ...(paymentIds.length ? { _id: { $in: paymentIds } } : {}),
    }).toArray(),
  ]);

  const quoteMap = new Map(quotes.map((quote) => [quote._id.toString(), quote]));
  const invoiceMap = new Map(invoices.map((invoice) => [invoice._id.toString(), invoice]));
  const paymentsByInvoiceId = new Map();

  for (const payment of payments) {
    const invoiceId = payment?.invoiceId?.toString?.() || '';

    if (!invoiceId) {
      continue;
    }

    const existingPayments = paymentsByInvoiceId.get(invoiceId) || [];
    existingPayments.push(payment);
    paymentsByInvoiceId.set(invoiceId, existingPayments);
  }

  const history = serializedWorkOrders
    .map((workOrder) => {
      const quote = normalizeText(workOrder.quoteId) ? quoteMap.get(normalizeText(workOrder.quoteId)) || null : null;
      const invoice = normalizeText(workOrder.invoiceId) ? invoiceMap.get(normalizeText(workOrder.invoiceId)) || null : null;
      const orderPayments = normalizeText(workOrder.invoiceId)
        ? paymentsByInvoiceId.get(normalizeText(workOrder.invoiceId)) || []
        : [];

      return {
        latestActivityAt: resolveLatestHistoryActivityAt({
          workOrder,
          quote,
          invoice,
          payments: orderPayments,
        }),
        requestedAt: workOrder.requestedAt || workOrder.createdAt || null,
        orderReferenceNumber: normalizeOptionalText(workOrder.orderReferenceNumber),
        status: normalizeText(workOrder.status) || null,
        paymentStatus: normalizeText(workOrder.paymentStatus) || null,
        deliveryMode: normalizeOptionalText(workOrder.deliveryMode),
        items: serializeCustomerHistoryItems(workOrder.lineItems || workOrder.items),
        quote: quote
          ? {
            ...serializeCustomerHistoryQuote(quote),
            pdf: serializeCustomerHistoryDocumentLink(workOrder?.s3Documents?.quote),
          }
          : null,
        invoice: invoice
          ? {
            ...serializeCustomerHistoryInvoice(invoice),
            pdf: serializeCustomerHistoryDocumentLink(workOrder?.s3Documents?.invoice),
          }
          : null,
        payments: serializeCustomerHistoryPayments(orderPayments),
      };
    })
    .sort((left, right) => {
      const rightTime = new Date(right.latestActivityAt || 0).getTime();
      const leftTime = new Date(left.latestActivityAt || 0).getTime();
      return rightTime - leftTime;
    });

  return {
    customer: serializeCustomerHistoryCustomer(customer),
    context: buildCustomerHistoryContext(customer),
    history,
  };
}

export async function updateCustomer({ tenantDb, tenant, botUserId, customerId, payload }) {
  const context = buildContext({ tenant, botUserId });
  const _id = toObjectId(customerId, 'customerId');
  const existingDocument = await tenantDb.collection(MASTER_DATA_CUSTOMERS_COLLECTION).findOne({
    _id,
    tenantId: context.tenantId,
    isDeleted: { $ne: true },
  });

  if (!existingDocument) {
    throw createHttpError('Customer was not found.', 404);
  }

  const document = buildNeedsZohoResyncFields(
    await buildCustomerPayload(tenantDb, payload, context, existingDocument)
  );
  await tenantDb.collection(MASTER_DATA_CUSTOMERS_COLLECTION).updateOne({ _id }, { $set: document });

  return serializeCustomerDocumentWithTier(tenantDb, { _id, ...document });
}

export async function deleteCustomer({ tenantDb, tenant, botUserId, customerId }) {
  const context = buildContext({ tenant, botUserId });
  const _id = toObjectId(customerId, 'customerId');
  const result = await tenantDb.collection(MASTER_DATA_CUSTOMERS_COLLECTION).updateOne(
    { _id, tenantId: context.tenantId, isDeleted: { $ne: true } },
    { $set: { isDeleted: true, updatedAt: new Date() } }
  );

  if (!result.matchedCount) {
    throw createHttpError('Customer was not found.', 404);
  }
}

export async function syncCustomerToZoho({ tenantDb, tenant, botUserId, botMasterKey = {}, customerId }) {
  const context = buildContext({ tenant, botUserId });
  const _id = toObjectId(customerId, 'customerId');
  const customer = await tenantDb.collection(MASTER_DATA_CUSTOMERS_COLLECTION).findOne({
    _id,
    tenantId: context.tenantId,
    isDeleted: { $ne: true },
  });

  if (!customer) {
    throw createHttpError('Customer was not found.', 404);
  }

  const result = await performCustomerZohoSync({
    tenantDb,
    tenantId: context.tenantId,
    botUserId: context.botUserId,
    botMasterKey,
    customer,
  });

  if (!result.ok) {
    throw createHttpError(result.errorMessage || 'Failed to sync customer to Zoho Books.', 502);
  }

  return result.customer;
}

export async function syncAllCustomersToZoho({ tenantDb, tenant, botUserId, botMasterKey = {} }) {
  const context = buildContext({ tenant, botUserId });
  const customers = await tenantDb.collection(MASTER_DATA_CUSTOMERS_COLLECTION)
    .find({
      tenantId: context.tenantId,
      isDeleted: { $ne: true },
    })
    .sort({ updatedAt: -1, createdAt: -1 })
    .toArray();

  let syncedCount = 0;
  let failedCount = 0;
  const failures = [];

  for (const customer of customers) {
    const result = await performCustomerZohoSync({
      tenantDb,
      tenantId: context.tenantId,
      botUserId: context.botUserId,
      botMasterKey,
      customer,
    });

    if (result.ok) {
      syncedCount += 1;
      continue;
    }

    failedCount += 1;
    failures.push({
      customerId: customer._id.toString(),
      displayName: customer.displayName,
      errorMessage: result.errorMessage,
    });
  }

  return {
    totalCustomers: customers.length,
    syncedCount,
    failedCount,
    failures,
  };
}

export async function getCustomerZohoSyncSummary({ tenantDb, tenant, botUserId }) {
  const context = buildContext({ tenant, botUserId });
  const baseFilter = {
    tenantId: context.tenantId,
    isDeleted: { $ne: true },
  };

  const [totalCustomers, syncedCount, failedCount, pendingCount, latestSyncedCustomer] = await Promise.all([
    tenantDb.collection(MASTER_DATA_CUSTOMERS_COLLECTION).countDocuments(baseFilter),
    tenantDb.collection(MASTER_DATA_CUSTOMERS_COLLECTION).countDocuments({
      ...baseFilter,
      zohoSyncStatus: 'synced',
    }),
    tenantDb.collection(MASTER_DATA_CUSTOMERS_COLLECTION).countDocuments({
      ...baseFilter,
      zohoSyncStatus: 'failed',
    }),
    tenantDb.collection(MASTER_DATA_CUSTOMERS_COLLECTION).countDocuments({
      ...baseFilter,
      zohoSyncStatus: 'not_synced',
    }),
    tenantDb.collection(MASTER_DATA_CUSTOMERS_COLLECTION).find({
      ...baseFilter,
      zohoLastSyncedAt: { $ne: null },
    })
      .sort({ zohoLastSyncedAt: -1, updatedAt: -1 })
      .limit(1)
      .next(),
  ]);

  return {
    totalCustomers,
    syncedCount,
    failedCount,
    pendingCount,
    lastOverallSyncedAt: latestSyncedCustomer?.zohoLastSyncedAt || null,
  };
}

export async function listTiers({ tenantDb, tenant, botUserId, query }) {
  const context = buildContext({ tenant, botUserId });
  await ensureTierCollectionReady(tenantDb, context);

  const filter = {
    tenantId: context.tenantId,
    isDeleted: { $ne: true },
  };

  const searchFilter = buildSearchFilter(['tierKey', 'tierName'], query.search);
  if (searchFilter) {
    Object.assign(filter, searchFilter);
  }

  return fetchList(tenantDb.collection(MASTER_DATA_TIERS_COLLECTION), filter, query);
}

export async function createTier({ tenantDb, tenant, botUserId, botMasterKey = {}, payload }) {
  const context = buildContext({ tenant, botUserId });
  await ensureTierCollectionReady(tenantDb, context);
  try {
    const document = buildTierPayload(payload, context);
    const result = await tenantDb.collection(MASTER_DATA_TIERS_COLLECTION).insertOne(document);

    logger.info('Master data tier created', {
      botUserId: context.botUserId,
      tenantId: context.tenantId,
      tierId: result.insertedId.toString(),
      tierKey: document.tierKey,
    });

    return serializeDocument({ _id: result.insertedId, ...document });
  } catch (error) {
    throw normalizeTierWriteError(error);
  }
}

export async function getTierById({ tenantDb, tenant, botUserId, tierId }) {
  const context = buildContext({ tenant, botUserId });
  await ensureTierCollectionReady(tenantDb, context);
  const document = await tenantDb.collection(MASTER_DATA_TIERS_COLLECTION).findOne({
    _id: toObjectId(tierId, 'tierId'),
    tenantId: context.tenantId,
    isDeleted: { $ne: true },
  });

  if (!document) {
    throw createHttpError('Tier was not found.', 404);
  }

  return serializeDocument(document);
}

export async function updateTier({ tenantDb, tenant, botUserId, botMasterKey = {}, tierId, payload }) {
  const context = buildContext({ tenant, botUserId });
  await ensureTierCollectionReady(tenantDb, context);
  const _id = toObjectId(tierId, 'tierId');
  const existingDocument = await tenantDb.collection(MASTER_DATA_TIERS_COLLECTION).findOne({
    _id,
    tenantId: context.tenantId,
    isDeleted: { $ne: true },
  });

  if (!existingDocument) {
    throw createHttpError('Tier was not found.', 404);
  }

  try {
    const document = buildTierPayload(payload, context, existingDocument);
    await tenantDb.collection(MASTER_DATA_TIERS_COLLECTION).updateOne({ _id }, { $set: document });

    logger.info('Master data tier updated', {
      botUserId: context.botUserId,
      tenantId: context.tenantId,
      tierId: _id.toString(),
      tierKey: document.tierKey,
    });

    return serializeDocument({ _id, ...document });
  } catch (error) {
    throw normalizeTierWriteError(error);
  }
}

export async function deleteTier({ tenantDb, tenant, botUserId, tierId }) {
  const context = buildContext({ tenant, botUserId });
  await ensureTierCollectionReady(tenantDb, context);
  const _id = toObjectId(tierId, 'tierId');
  const tier = await tenantDb.collection(MASTER_DATA_TIERS_COLLECTION).findOne({
    _id,
    tenantId: context.tenantId,
    isDeleted: { $ne: true },
  });

  if (!tier) {
    throw createHttpError('Tier was not found.', 404);
  }

  const assignedCustomersCount = await tenantDb.collection(MASTER_DATA_CUSTOMERS_COLLECTION).countDocuments({
    tenantId: context.tenantId,
    tierId: _id,
    isDeleted: { $ne: true },
  });

  if (assignedCustomersCount > 0) {
    throw createHttpError('This tier is assigned to one or more customers and cannot be deleted.', 409);
  }

  await tenantDb.collection(MASTER_DATA_TIERS_COLLECTION).updateOne(
    { _id },
    { $set: { isDeleted: true, updatedAt: new Date() } }
  );
}

export async function listQuotes({ tenantDb, tenant, botUserId, query }) {
  const context = buildContext({ tenant, botUserId });
  const filter = {
    tenantId: context.tenantId,
    isDeleted: { $ne: true },
  };

  if (normalizeText(query.status)) {
    filter.status = normalizeText(query.status).toLowerCase();
  }

  const dateFilter = buildDateRangeFilter('quoteDate', query.dateFrom, query.dateTo);
  if (dateFilter) {
    Object.assign(filter, dateFilter);
  }

  const searchTerm = normalizeText(query.search);

  // If no search term, use paginated fetch for efficiency
  if (!searchTerm) {
    const response = await fetchList(tenantDb.collection(MASTER_DATA_QUOTES_COLLECTION), filter, query);
    response.items = await enrichCustomerReferences(tenantDb, response.items);
    return response;
  }

  // With a search term: fetch all matching docs (status + date filtered), enrich, then
  // apply full-field search in memory (covers text fields, customerDisplayName, and numeric grandTotal)
  const allDocs = await tenantDb.collection(MASTER_DATA_QUOTES_COLLECTION)
    .find(filter)
    .sort({ updatedAt: -1, createdAt: -1 })
    .toArray();

  const enriched = await enrichCustomerReferences(tenantDb, allDocs.map(serializeDocument));

  const matched = applyPostQuerySearch(enriched, searchTerm, [
    'quoteNumber', 'status', 'notes', 'termsAndConditions', 'zohoSyncStatus',
    'customerDisplayName', 'customerCode',
    'workOrderNumber', 'workOrderId', 'orderReferenceNumber',
    'grandTotal', 'subTotal', 'taxTotal', 'discountTotal',
  ]);

  return paginateItems(matched, query);
}

export async function createQuote({ tenantDb, tenant, botUserId, botMasterKey = {}, payload }) {
  const context = buildContext({ tenant, botUserId });
  const document = buildQuotePayload(payload, context);
  const customer = await ensureCustomerExists(tenantDb, document.customerId);
  const result = await tenantDb.collection(MASTER_DATA_QUOTES_COLLECTION).insertOne(document);
  const insertedId = result.insertedId;

  logger.info('Master data quote created', {
    botUserId: context.botUserId,
    tenantId: context.tenantId,
    quoteId: insertedId.toString(),
  });

  if (isZohoAutoSyncEnabled(tenant, botMasterKey)) {
    await runBestEffortZohoSync({
      entityName: 'quote',
      entityId: insertedId.toString(),
      context,
      syncOperation: () => performQuoteZohoSync({
        tenantDb,
        tenantId: context.tenantId,
        botUserId: context.botUserId,
        botMasterKey,
        quote: { _id: insertedId, ...document },
      }),
    });
  }

  const latestQuote = await tenantDb.collection(MASTER_DATA_QUOTES_COLLECTION).findOne({
    _id: insertedId,
    tenantId: context.tenantId,
    isDeleted: { $ne: true },
  });
  const enriched = await enrichCustomerReferences(
    tenantDb,
    [serializeDocument(latestQuote || { _id: insertedId, ...document })]
  );

  return {
    ...enriched[0],
    customerDisplayName: customer.displayName || enriched[0]?.customerDisplayName || '',
  };
}

export async function getQuoteById({ tenantDb, tenant, botUserId, quoteId }) {
  const context = buildContext({ tenant, botUserId });
  const document = await tenantDb.collection(MASTER_DATA_QUOTES_COLLECTION).findOne({
    _id: toObjectId(quoteId, 'quoteId'),
    tenantId: context.tenantId,
    isDeleted: { $ne: true },
  });

  if (!document) {
    throw createHttpError('Quote was not found.', 404);
  }

  const serialized = serializeDocument(document);
  const enriched = await enrichCustomerReferences(tenantDb, [serialized]);
  return enriched[0];
}

export async function updateQuote({ tenantDb, tenant, botUserId, quoteId, payload }) {
  const context = buildContext({ tenant, botUserId });
  const _id = toObjectId(quoteId, 'quoteId');
  const existingDocument = await tenantDb.collection(MASTER_DATA_QUOTES_COLLECTION).findOne({
    _id,
    tenantId: context.tenantId,
    isDeleted: { $ne: true },
  });

  if (!existingDocument) {
    throw createHttpError('Quote was not found.', 404);
  }

  const document = buildNeedsZohoResyncFields(
    buildQuotePayload(payload, context, existingDocument)
  );
  await ensureCustomerExists(tenantDb, document.customerId);
  await tenantDb.collection(MASTER_DATA_QUOTES_COLLECTION).updateOne({ _id }, { $set: document });
  if (isZohoAutoSyncEnabled(tenant, tenant?.botMasterKey || {})) {
    await syncQuoteAndRefreshPdf({
      tenantDb,
      botMasterKey: tenant?.botMasterKey || {},
      context,
      quote: { _id, ...document },
    });
  }
  const latestQuote = await tenantDb.collection(MASTER_DATA_QUOTES_COLLECTION).findOne({
    _id,
    tenantId: context.tenantId,
    isDeleted: { $ne: true },
  });
  const enriched = await enrichCustomerReferences(
    tenantDb,
    [serializeDocument(latestQuote || { _id, ...document })]
  );
  return enriched[0];
}

export async function deleteQuote({ tenantDb, tenant, botUserId, quoteId }) {
  const context = buildContext({ tenant, botUserId });
  const _id = toObjectId(quoteId, 'quoteId');
  const result = await tenantDb.collection(MASTER_DATA_QUOTES_COLLECTION).updateOne(
    { _id, tenantId: context.tenantId, isDeleted: { $ne: true } },
    { $set: { isDeleted: true, updatedAt: new Date() } }
  );

  if (!result.matchedCount) {
    throw createHttpError('Quote was not found.', 404);
  }
}

export async function syncQuoteToZoho({ tenantDb, tenant, botUserId, botMasterKey = {}, quoteId }) {
  const context = buildContext({ tenant, botUserId });
  const _id = toObjectId(quoteId, 'quoteId');
  const quote = await tenantDb.collection(MASTER_DATA_QUOTES_COLLECTION).findOne({
    _id,
    tenantId: context.tenantId,
    isDeleted: { $ne: true },
  });

  if (!quote) {
    throw createHttpError('Quote was not found.', 404);
  }

  const result = await performQuoteZohoSync({
    tenantDb,
    tenantId: context.tenantId,
    botUserId: context.botUserId,
    botMasterKey,
    quote,
  });

  if (!result.ok) {
    throw createHttpError(result.errorMessage || 'Failed to sync quote to Zoho Books.', 502);
  }

  const enriched = await enrichCustomerReferences(tenantDb, [result.quote]);
  return enriched[0];
}

export async function getQuotePdfFromZoho({ tenantDb, tenant, botUserId, botMasterKey = {}, quoteId }) {
  const context = buildContext({ tenant, botUserId });
  const _id = toObjectId(quoteId, 'quoteId');
  const quote = await tenantDb.collection(MASTER_DATA_QUOTES_COLLECTION).findOne({
    _id,
    tenantId: context.tenantId,
    isDeleted: { $ne: true },
  });

  if (!quote) {
    throw createHttpError('Quote was not found.', 404);
  }

  if (!isZohoSynced(quote, 'zohoEstimateId')) {
    throw createHttpError('Quote PDF requires a quote that is synced with Zoho Books.', 409);
  }

  const {
    accessToken,
    organizationId,
    apiDomain,
  } = await getValidZohoAccessToken(botMasterKey || { botId: context.botUserId });

  if (!organizationId) {
    throw createHttpError('Zoho Books organization is not selected for this tenant.', 409);
  }

  const zohoEstimateId = String(quote.zohoEstimateId || '').trim();
  const baseUrl = `${String(apiDomain || 'https://www.zohoapis.com').replace(/\/+$/, '')}/books/v3/estimates/${encodeURIComponent(zohoEstimateId)}`;

  try {
    const response = await requestHttp(baseUrl, {
      method: 'get',
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
      },
      params: {
        organization_id: organizationId,
        accept: 'pdf',
      },
      responseType: 'arraybuffer',
      label: 'Zoho fetch quote PDF',
    });
    const contentType = response.headers['content-type'] || 'application/pdf';
    const buffer = Buffer.from(response.data);

    try {
      await uploadZohoPdfToWorkOrderS3({
        tenantDb,
        tenantId: context.tenantId,
        documentType: 'quote',
        salesDocumentId: _id,
        referenceNumber: quote.quoteNumber,
        buffer,
        contentType,
      });
    } catch (uploadError) {
      logger.warn('Failed to upload quote PDF to S3', {
        tenantId: context.tenantId,
        quoteId: _id.toString(),
        errorMessage: uploadError?.message || 'Unknown S3 upload error.',
      });
    }

    return {
      fileName: `${String(quote.quoteNumber || 'quote').trim() || 'quote'}.pdf`,
      contentType,
      buffer,
    };
  } catch (error) {
    const errorMessage = error?.response?.data?.message || error?.message || 'Failed to load quote PDF from Zoho Books.';
    throw createHttpError(errorMessage, 502);
  }
}

export async function syncAllQuotesToZoho({ tenantDb, tenant, botUserId, botMasterKey = {} }) {
  const context = buildContext({ tenant, botUserId });
  const quotes = await tenantDb.collection(MASTER_DATA_QUOTES_COLLECTION)
    .find({
      tenantId: context.tenantId,
      isDeleted: { $ne: true },
    })
    .sort({ updatedAt: -1, createdAt: -1 })
    .toArray();

  let syncedCount = 0;
  let failedCount = 0;
  const failures = [];

  for (const quote of quotes) {
    const result = await performQuoteZohoSync({
      tenantDb,
      tenantId: context.tenantId,
      botUserId: context.botUserId,
      botMasterKey,
      quote,
    });

    if (result.ok) {
      syncedCount += 1;
      continue;
    }

    failedCount += 1;
    failures.push({
      quoteId: quote._id.toString(),
      quoteNumber: quote.quoteNumber,
      errorMessage: result.errorMessage,
    });
  }

  return {
    totalQuotes: quotes.length,
    syncedCount,
    failedCount,
    failures,
  };
}

export async function getQuoteZohoSyncSummary({ tenantDb, tenant, botUserId }) {
  const context = buildContext({ tenant, botUserId });
  const baseFilter = {
    tenantId: context.tenantId,
    isDeleted: { $ne: true },
  };

  const [totalQuotes, syncedCount, failedCount, pendingCount, latestSyncedQuote] = await Promise.all([
    tenantDb.collection(MASTER_DATA_QUOTES_COLLECTION).countDocuments(baseFilter),
    tenantDb.collection(MASTER_DATA_QUOTES_COLLECTION).countDocuments({
      ...baseFilter,
      zohoSyncStatus: 'synced',
    }),
    tenantDb.collection(MASTER_DATA_QUOTES_COLLECTION).countDocuments({
      ...baseFilter,
      zohoSyncStatus: 'failed',
    }),
    tenantDb.collection(MASTER_DATA_QUOTES_COLLECTION).countDocuments({
      ...baseFilter,
      zohoSyncStatus: 'not_synced',
    }),
    tenantDb.collection(MASTER_DATA_QUOTES_COLLECTION).find({
      ...baseFilter,
      zohoLastSyncedAt: { $ne: null },
    })
      .sort({ zohoLastSyncedAt: -1, updatedAt: -1 })
      .limit(1)
      .next(),
  ]);

  return {
    totalQuotes,
    syncedCount,
    failedCount,
    pendingCount,
    lastOverallSyncedAt: latestSyncedQuote?.zohoLastSyncedAt || null,
  };
}

export async function listInvoices({ tenantDb, tenant, botUserId, query }) {
  const context = buildContext({ tenant, botUserId });
  const filter = {
    tenantId: context.tenantId,
    isDeleted: { $ne: true },
  };

  if (normalizeText(query.status)) {
    filter.status = normalizeText(query.status).toLowerCase();
  }

  const dateFilter = buildDateRangeFilter('invoiceDate', query.dateFrom, query.dateTo);
  if (dateFilter) {
    Object.assign(filter, dateFilter);
  }

  const searchTerm = normalizeText(query.search);

  if (!searchTerm) {
    const response = await fetchList(tenantDb.collection(MASTER_DATA_INVOICES_COLLECTION), filter, query);
    response.items = await enrichCustomerReferences(tenantDb, response.items);
    response.items = await enrichQuoteReferences(tenantDb, response.items);
    return response;
  }

  const allDocs = await tenantDb.collection(MASTER_DATA_INVOICES_COLLECTION)
    .find(filter)
    .sort({ updatedAt: -1, createdAt: -1 })
    .toArray();

  const enrichedWithCustomers = await enrichCustomerReferences(tenantDb, allDocs.map(serializeDocument));
  const enriched = await enrichQuoteReferences(tenantDb, enrichedWithCustomers);

  const matched = applyPostQuerySearch(enriched, searchTerm, [
    'invoiceNumber', 'status', 'paymentStatus', 'notes', 'termsAndConditions', 'zohoSyncStatus',
    'customerDisplayName', 'customerCode', 'quoteNumberRef',
    'workOrderNumber', 'workOrderId', 'orderReferenceNumber',
    'grandTotal', 'balanceAmount', 'paidAmount', 'subTotal', 'taxTotal', 'discountTotal',
  ]);

  return paginateItems(matched, query);
}

export async function createInvoice({ tenantDb, tenant, botUserId, botMasterKey = {}, payload }) {
  const context = buildContext({ tenant, botUserId });
  const document = buildInvoicePayload(payload, context, null, 0);
  await ensureCustomerExists(tenantDb, document.customerId);
  if (document.quoteId) {
    const quote = await ensureQuoteExists(tenantDb, document.quoteId);

    if (quote.customerId?.toString() !== document.customerId.toString()) {
      throw createHttpError('Selected quote does not belong to the selected customer.');
    }
  }
  const result = await tenantDb.collection(MASTER_DATA_INVOICES_COLLECTION).insertOne(document);
  const insertedId = result.insertedId;

  if (isZohoAutoSyncEnabled(tenant, botMasterKey)) {
    await runBestEffortZohoSync({
      entityName: 'invoice',
      entityId: insertedId.toString(),
      context,
      syncOperation: () => performInvoiceZohoSync({
        tenantDb,
        tenantId: context.tenantId,
        botUserId: context.botUserId,
        botMasterKey,
        invoice: { _id: insertedId, ...document },
      }),
    });
  }

  const latestInvoice = await tenantDb.collection(MASTER_DATA_INVOICES_COLLECTION).findOne({
    _id: insertedId,
    tenantId: context.tenantId,
    isDeleted: { $ne: true },
  });
  const enriched = await enrichQuoteReferences(
    tenantDb,
    await enrichCustomerReferences(tenantDb, [serializeDocument(latestInvoice || { _id: insertedId, ...document })])
  );

  logger.info('Master data invoice created', {
    botUserId: context.botUserId,
    tenantId: context.tenantId,
    invoiceId: insertedId.toString(),
  });

  return enriched[0];
}

export async function getInvoiceById({ tenantDb, tenant, botUserId, invoiceId }) {
  const context = buildContext({ tenant, botUserId });
  const document = await tenantDb.collection(MASTER_DATA_INVOICES_COLLECTION).findOne({
    _id: toObjectId(invoiceId, 'invoiceId'),
    tenantId: context.tenantId,
    isDeleted: { $ne: true },
  });

  if (!document) {
    throw createHttpError('Invoice was not found.', 404);
  }

  const enriched = await enrichQuoteReferences(
    tenantDb,
    await enrichCustomerReferences(tenantDb, [serializeDocument(document)])
  );
  return enriched[0];
}

export async function updateInvoice({ tenantDb, tenant, botUserId, invoiceId, payload }) {
  const context = buildContext({ tenant, botUserId });
  const _id = toObjectId(invoiceId, 'invoiceId');
  const existingDocument = await tenantDb.collection(MASTER_DATA_INVOICES_COLLECTION).findOne({
    _id,
    tenantId: context.tenantId,
    isDeleted: { $ne: true },
  });

  if (!existingDocument) {
    throw createHttpError('Invoice was not found.', 404);
  }

  const document = buildNeedsZohoResyncFields(
    buildInvoicePayload(payload, context, existingDocument, Number(existingDocument.paidAmount || 0))
  );
  await ensureCustomerExists(tenantDb, document.customerId);
  if (document.quoteId) {
    const quote = await ensureQuoteExists(tenantDb, document.quoteId);

    if (quote.customerId?.toString() !== document.customerId.toString()) {
      throw createHttpError('Selected quote does not belong to the selected customer.');
    }
  }
  await tenantDb.collection(MASTER_DATA_INVOICES_COLLECTION).updateOne({ _id }, { $set: document });
  await syncInvoicePaymentSummary(tenantDb, _id);
  if (isZohoAutoSyncEnabled(tenant, tenant?.botMasterKey || {})) {
    const latestInvoice = await tenantDb.collection(MASTER_DATA_INVOICES_COLLECTION).findOne({
      _id,
      tenantId: context.tenantId,
      isDeleted: { $ne: true },
    });

    if (latestInvoice) {
      await syncInvoiceAndRefreshPdf({
        tenantDb,
        botMasterKey: tenant?.botMasterKey || {},
        context,
        invoice: latestInvoice,
      });
    }
  }
  return getInvoiceById({ tenantDb, tenant, botUserId, invoiceId });
}

export async function deleteInvoice({ tenantDb, tenant, botUserId, invoiceId }) {
  const context = buildContext({ tenant, botUserId });
  const _id = toObjectId(invoiceId, 'invoiceId');
  const result = await tenantDb.collection(MASTER_DATA_INVOICES_COLLECTION).updateOne(
    { _id, tenantId: context.tenantId, isDeleted: { $ne: true } },
    { $set: { isDeleted: true, updatedAt: new Date() } }
  );

  if (!result.matchedCount) {
    throw createHttpError('Invoice was not found.', 404);
  }
}

export async function syncInvoiceToZoho({ tenantDb, tenant, botUserId, botMasterKey = {}, invoiceId }) {
  const context = buildContext({ tenant, botUserId });
  const _id = toObjectId(invoiceId, 'invoiceId');
  const invoice = await tenantDb.collection(MASTER_DATA_INVOICES_COLLECTION).findOne({
    _id,
    tenantId: context.tenantId,
    isDeleted: { $ne: true },
  });

  if (!invoice) {
    throw createHttpError('Invoice was not found.', 404);
  }

  const result = await performInvoiceZohoSync({
    tenantDb,
    tenantId: context.tenantId,
    botUserId: context.botUserId,
    botMasterKey,
    invoice,
  });

  if (!result.ok) {
    throw createHttpError(result.errorMessage || 'Failed to sync invoice to Zoho Books.', 502);
  }

  const enriched = await enrichQuoteReferences(
    tenantDb,
    await enrichCustomerReferences(tenantDb, [result.invoice])
  );
  return enriched[0];
}

export async function getInvoicePdfFromZoho({ tenantDb, tenant, botUserId, botMasterKey = {}, invoiceId }) {
  const context = buildContext({ tenant, botUserId });
  const _id = toObjectId(invoiceId, 'invoiceId');
  const invoice = await tenantDb.collection(MASTER_DATA_INVOICES_COLLECTION).findOne({
    _id,
    tenantId: context.tenantId,
    isDeleted: { $ne: true },
  });

  if (!invoice) {
    throw createHttpError('Invoice was not found.', 404);
  }

  assertZohoInvoiceReady(invoice, 'Invoice PDF');

  const {
    accessToken,
    organizationId,
    apiDomain,
  } = await getValidZohoAccessToken(botMasterKey || { botId: context.botUserId });

  if (!organizationId) {
    throw createHttpError('Zoho Books organization is not selected for this tenant.', 409);
  }

  const zohoInvoiceId = String(invoice.zohoInvoiceId || '').trim();
  const baseUrl = `${String(apiDomain || 'https://www.zohoapis.com').replace(/\/+$/, '')}/books/v3/invoices/${encodeURIComponent(zohoInvoiceId)}`;

  try {
    const response = await requestHttp(baseUrl, {
      method: 'get',
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
      },
      params: {
        organization_id: organizationId,
        accept: 'pdf',
      },
      responseType: 'arraybuffer',
      label: 'Zoho fetch invoice PDF',
    });
    const contentType = response.headers['content-type'] || 'application/pdf';
    const buffer = Buffer.from(response.data);

    try {
      await uploadZohoPdfToWorkOrderS3({
        tenantDb,
        tenantId: context.tenantId,
        documentType: 'invoice',
        salesDocumentId: _id,
        referenceNumber: invoice.invoiceNumber,
        buffer,
        contentType,
      });
    } catch (uploadError) {
      logger.warn('Failed to upload invoice PDF to S3', {
        tenantId: context.tenantId,
        invoiceId: _id.toString(),
        errorMessage: uploadError?.message || 'Unknown S3 upload error.',
      });
    }

    return {
      fileName: `${String(invoice.invoiceNumber || 'invoice').trim() || 'invoice'}.pdf`,
      contentType,
      buffer,
    };
  } catch (error) {
    const errorMessage = error?.response?.data?.message || error?.message || 'Failed to load invoice PDF from Zoho Books.';
    throw createHttpError(errorMessage, 502);
  }
}

export async function syncAllInvoicesToZoho({ tenantDb, tenant, botUserId, botMasterKey = {} }) {
  const context = buildContext({ tenant, botUserId });
  const invoices = await tenantDb.collection(MASTER_DATA_INVOICES_COLLECTION)
    .find({
      tenantId: context.tenantId,
      isDeleted: { $ne: true },
    })
    .sort({ updatedAt: -1, createdAt: -1 })
    .toArray();

  let syncedCount = 0;
  let failedCount = 0;
  const failures = [];

  for (const invoice of invoices) {
    const result = await performInvoiceZohoSync({
      tenantDb,
      tenantId: context.tenantId,
      botUserId: context.botUserId,
      botMasterKey,
      invoice,
    });

    if (result.ok) {
      syncedCount += 1;
      continue;
    }

    failedCount += 1;
    failures.push({
      invoiceId: invoice._id.toString(),
      invoiceNumber: invoice.invoiceNumber,
      errorMessage: result.errorMessage,
    });
  }

  return {
    totalInvoices: invoices.length,
    syncedCount,
    failedCount,
    failures,
  };
}

export async function getInvoiceZohoSyncSummary({ tenantDb, tenant, botUserId }) {
  const context = buildContext({ tenant, botUserId });
  const baseFilter = {
    tenantId: context.tenantId,
    isDeleted: { $ne: true },
  };

  const [totalInvoices, syncedCount, failedCount, pendingCount, latestSyncedInvoice] = await Promise.all([
    tenantDb.collection(MASTER_DATA_INVOICES_COLLECTION).countDocuments(baseFilter),
    tenantDb.collection(MASTER_DATA_INVOICES_COLLECTION).countDocuments({
      ...baseFilter,
      zohoSyncStatus: 'synced',
    }),
    tenantDb.collection(MASTER_DATA_INVOICES_COLLECTION).countDocuments({
      ...baseFilter,
      zohoSyncStatus: 'failed',
    }),
    tenantDb.collection(MASTER_DATA_INVOICES_COLLECTION).countDocuments({
      ...baseFilter,
      zohoSyncStatus: 'not_synced',
    }),
    tenantDb.collection(MASTER_DATA_INVOICES_COLLECTION).find({
      ...baseFilter,
      zohoLastSyncedAt: { $ne: null },
    })
      .sort({ zohoLastSyncedAt: -1, updatedAt: -1 })
      .limit(1)
      .next(),
  ]);

  return {
    totalInvoices,
    syncedCount,
    failedCount,
    pendingCount,
    lastOverallSyncedAt: latestSyncedInvoice?.zohoLastSyncedAt || null,
  };
}

export async function listPayments({ tenantDb, tenant, botUserId, query }) {
  const context = buildContext({ tenant, botUserId });
  const filter = {
    tenantId: context.tenantId,
    isDeleted: { $ne: true },
  };

  if (normalizeText(query.status)) {
    filter.status = normalizeText(query.status).toLowerCase();
  }

  const dateFilter = buildDateRangeFilter('paymentDate', query.dateFrom, query.dateTo);
  if (dateFilter) {
    Object.assign(filter, dateFilter);
  }

  const searchTerm = normalizeText(query.search);

  if (!searchTerm) {
    const response = await fetchList(tenantDb.collection(MASTER_DATA_PAYMENTS_COLLECTION), filter, query);
    response.items = await enrichInvoiceReferences(
      tenantDb,
      await enrichCustomerReferences(tenantDb, response.items)
    );
    return response;
  }

  const allDocs = await tenantDb.collection(MASTER_DATA_PAYMENTS_COLLECTION)
    .find(filter)
    .sort({ updatedAt: -1, createdAt: -1 })
    .toArray();

  const enrichedWithCustomers = await enrichCustomerReferences(tenantDb, allDocs.map(serializeDocument));
  const enriched = await enrichInvoiceReferences(tenantDb, enrichedWithCustomers);

  const matched = applyPostQuerySearch(enriched, searchTerm, [
    'paymentNumber', 'referenceNumber', 'gatewayPaymentId', 'paymentMode', 'status', 'notes',
    'gatewayProvider', 'zohoSyncStatus', 'paymentLinkId',
    'customerDisplayName', 'customerCode', 'invoiceNumberRef',
    'workOrderId', 'workOrderNumber', 'orderReferenceNumber',
    'amount',
  ]);

  return paginateItems(matched, query);
}

export async function createPayment({ tenantDb, tenant, botUserId, botMasterKey = {}, payload }) {
  const context = buildContext({ tenant, botUserId });
  const document = buildPaymentPayload(payload, context);
  await ensureCustomerExists(tenantDb, document.customerId);
  const invoice = await ensureInvoiceExists(tenantDb, document.invoiceId);

  if (invoice.customerId?.toString() !== document.customerId.toString()) {
    throw createHttpError('Selected invoice does not belong to the selected customer.');
  }

  assertPaymentAmountWithinInvoiceBalance({
    invoice,
    paymentAmount: document.amount,
    paymentStatus: document.status,
  });

  const result = await tenantDb.collection(MASTER_DATA_PAYMENTS_COLLECTION).insertOne(document);
  const insertedId = result.insertedId;
  await syncInvoicePaymentSummary(tenantDb, document.invoiceId);

  logger.info('Master data payment created', {
    botUserId: context.botUserId,
    tenantId: context.tenantId,
    paymentId: insertedId.toString(),
  });

  if (isZohoAutoSyncEnabled(tenant, botMasterKey)) {
    await runBestEffortZohoSync({
      entityName: 'payment',
      entityId: insertedId.toString(),
      context,
      syncOperation: () => performPaymentZohoSync({
        tenantDb,
        tenantId: context.tenantId,
        botUserId: context.botUserId,
        botMasterKey,
        payment: { _id: insertedId, ...document },
      }),
    });
  }

  const latestPayment = await tenantDb.collection(MASTER_DATA_PAYMENTS_COLLECTION).findOne({
    _id: insertedId,
    tenantId: context.tenantId,
    isDeleted: { $ne: true },
  });
  const enriched = await enrichInvoiceReferences(
    tenantDb,
    await enrichCustomerReferences(tenantDb, [serializeDocument(latestPayment || { _id: insertedId, ...document })])
  );
  return enriched[0];
}

export async function getPaymentById({ tenantDb, tenant, botUserId, paymentId }) {
  const context = buildContext({ tenant, botUserId });
  const document = await tenantDb.collection(MASTER_DATA_PAYMENTS_COLLECTION).findOne({
    _id: toObjectId(paymentId, 'paymentId'),
    tenantId: context.tenantId,
    isDeleted: { $ne: true },
  });

  if (!document) {
    throw createHttpError('Payment was not found.', 404);
  }

  const enriched = await enrichInvoiceReferences(
    tenantDb,
    await enrichCustomerReferences(tenantDb, [serializeDocument(document)])
  );
  return enriched[0];
}

export async function updatePayment({ tenantDb, tenant, botUserId, paymentId, payload }) {
  const context = buildContext({ tenant, botUserId });
  const _id = toObjectId(paymentId, 'paymentId');
  const existingDocument = await tenantDb.collection(MASTER_DATA_PAYMENTS_COLLECTION).findOne({
    _id,
    tenantId: context.tenantId,
    isDeleted: { $ne: true },
  });

  if (!existingDocument) {
    throw createHttpError('Payment was not found.', 404);
  }

  const document = buildNeedsZohoResyncFields(
    buildPaymentPayload(payload, context, existingDocument)
  );
  await ensureCustomerExists(tenantDb, document.customerId);
  const invoice = await ensureInvoiceExists(tenantDb, document.invoiceId);

  if (invoice.customerId?.toString() !== document.customerId.toString()) {
    throw createHttpError('Selected invoice does not belong to the selected customer.');
  }

  assertPaymentAmountWithinInvoiceBalance({
    invoice,
    paymentAmount: document.amount,
    paymentStatus: document.status,
    existingPayment: existingDocument,
  });

  await tenantDb.collection(MASTER_DATA_PAYMENTS_COLLECTION).updateOne({ _id }, { $set: document });
  await syncInvoicePaymentSummary(tenantDb, existingDocument.invoiceId);

  if (existingDocument.invoiceId?.toString() !== document.invoiceId.toString()) {
    await syncInvoicePaymentSummary(tenantDb, document.invoiceId);
  }

  if (isZohoAutoSyncEnabled(tenant, tenant?.botMasterKey || {})) {
    const normalizedStatus = String(document.status || '').trim().toLowerCase();

    if (normalizedStatus === 'success') {
      await runBestEffortZohoSync({
        entityName: 'payment',
        entityId: _id.toString(),
        context,
        syncOperation: () => performPaymentZohoSync({
          tenantDb,
          tenantId: context.tenantId,
          botUserId: context.botUserId,
          botMasterKey: tenant?.botMasterKey || {},
          payment: { _id, ...document },
        }),
      });
    }
  }

  return getPaymentById({ tenantDb, tenant, botUserId, paymentId });
}

export async function deletePayment({ tenantDb, tenant, botUserId, paymentId }) {
  const context = buildContext({ tenant, botUserId });
  const _id = toObjectId(paymentId, 'paymentId');
  const existingDocument = await tenantDb.collection(MASTER_DATA_PAYMENTS_COLLECTION).findOne({
    _id,
    tenantId: context.tenantId,
    isDeleted: { $ne: true },
  });

  if (!existingDocument) {
    throw createHttpError('Payment was not found.', 404);
  }

  await tenantDb.collection(MASTER_DATA_PAYMENTS_COLLECTION).updateOne(
    { _id },
    { $set: { isDeleted: true, updatedAt: new Date() } }
  );
  await syncInvoicePaymentSummary(tenantDb, existingDocument.invoiceId);
}

export async function syncPaymentToZoho({ tenantDb, tenant, botUserId, botMasterKey = {}, paymentId }) {
  const context = buildContext({ tenant, botUserId });
  const _id = toObjectId(paymentId, 'paymentId');
  const payment = await tenantDb.collection(MASTER_DATA_PAYMENTS_COLLECTION).findOne({
    _id,
    tenantId: context.tenantId,
    isDeleted: { $ne: true },
  });

  if (!payment) {
    throw createHttpError('Payment was not found.', 404);
  }

  const result = await performPaymentZohoSync({
    tenantDb,
    tenantId: context.tenantId,
    botUserId: context.botUserId,
    botMasterKey,
    payment,
  });

  if (!result.ok) {
    throw createHttpError(result.errorMessage || 'Failed to sync payment to Zoho Books.', 502);
  }

  const enriched = await enrichInvoiceReferences(
    tenantDb,
    await enrichCustomerReferences(tenantDb, [result.payment])
  );
  return enriched[0];
}

export async function syncAllPaymentsToZoho({ tenantDb, tenant, botUserId, botMasterKey = {} }) {
  const context = buildContext({ tenant, botUserId });
  const payments = await tenantDb.collection(MASTER_DATA_PAYMENTS_COLLECTION)
    .find({
      tenantId: context.tenantId,
      isDeleted: { $ne: true },
    })
    .sort({ updatedAt: -1, createdAt: -1 })
    .toArray();

  let syncedCount = 0;
  let failedCount = 0;
  const failures = [];

  for (const payment of payments) {
    const result = await performPaymentZohoSync({
      tenantDb,
      tenantId: context.tenantId,
      botUserId: context.botUserId,
      botMasterKey,
      payment,
    });

    if (result.ok) {
      syncedCount += 1;
      continue;
    }

    failedCount += 1;
    failures.push({
      paymentId: payment._id.toString(),
      paymentNumber: payment.paymentNumber,
      errorMessage: result.errorMessage,
    });
  }

  return {
    totalPayments: payments.length,
    syncedCount,
    failedCount,
    failures,
  };
}

export async function getPaymentZohoSyncSummary({ tenantDb, tenant, botUserId }) {
  const context = buildContext({ tenant, botUserId });
  const baseFilter = {
    tenantId: context.tenantId,
    isDeleted: { $ne: true },
  };

  const [totalPayments, syncedCount, failedCount, pendingCount, latestSyncedPayment] = await Promise.all([
    tenantDb.collection(MASTER_DATA_PAYMENTS_COLLECTION).countDocuments(baseFilter),
    tenantDb.collection(MASTER_DATA_PAYMENTS_COLLECTION).countDocuments({
      ...baseFilter,
      zohoSyncStatus: 'synced',
    }),
    tenantDb.collection(MASTER_DATA_PAYMENTS_COLLECTION).countDocuments({
      ...baseFilter,
      zohoSyncStatus: 'failed',
    }),
    tenantDb.collection(MASTER_DATA_PAYMENTS_COLLECTION).countDocuments({
      ...baseFilter,
      zohoSyncStatus: 'not_synced',
    }),
    tenantDb.collection(MASTER_DATA_PAYMENTS_COLLECTION).find({
      ...baseFilter,
      zohoLastSyncedAt: { $ne: null },
    })
      .sort({ zohoLastSyncedAt: -1, updatedAt: -1 })
      .limit(1)
      .next(),
  ]);

  return {
    totalPayments,
    syncedCount,
    failedCount,
    pendingCount,
    lastOverallSyncedAt: latestSyncedPayment?.zohoLastSyncedAt || null,
  };
}

export {
  buildZohoInvoicePayload,
  buildZohoQuotePayload,
  parseBotMasterKeyHeader,
};
