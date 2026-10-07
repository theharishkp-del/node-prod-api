import { ObjectId } from 'mongodb';
import { getMasterDbConnection } from '../config/db.js';
import { logger } from '../config/logger.js';
import { REGISTRY_COLLECTION } from '../models/master/registryModel.js';
import { MASTER_DATA_CUSTOMERS_COLLECTION } from '../models/tenant/masterDataCustomerModel.js';
import { MASTER_DATA_TIERS_COLLECTION } from '../models/tenant/masterDataTierModel.js';
import { MASTER_DATA_QUOTES_COLLECTION } from '../models/tenant/masterDataQuoteModel.js';
import { MASTER_DATA_INVOICES_COLLECTION } from '../models/tenant/masterDataInvoiceModel.js';
import { MASTER_DATA_PAYMENTS_COLLECTION } from '../models/tenant/masterDataPaymentModel.js';
import { ZOHO_CUSTOMERS_COLLECTION } from '../models/tenant/zohoCustomerModel.js';
import { ZOHO_QUOTES_COLLECTION } from '../models/tenant/zohoQuoteModel.js';
import { ZOHO_INVOICES_COLLECTION } from '../models/tenant/zohoInvoiceModel.js';
import { ZOHO_PAYMENTS_COLLECTION } from '../models/tenant/zohoPaymentModel.js';
import { getJson } from '../utils/httpClient.js';
import { getTenantDb, getTenantRegistry, primeTenantRoutingCache } from '../utils/tenantManager.js';

const MODULE_ORDER = ['customer', 'quote', 'invoice', 'payment'];
const MODULE_LABELS = {
  customer: 'Customers',
  quote: 'Quotes',
  invoice: 'Invoices',
  payment: 'Payments',
};
const DEFAULT_IMPORT_STATUS = 'idle';
const DEFAULT_TIER_KEY = 'T1';
const activeImportJobs = new Map();

function getBotUserId(botMasterKey = {}) {
  const botId = botMasterKey.botId != null ? String(botMasterKey.botId).trim() : '';
  const userId = botMasterKey.userId != null ? String(botMasterKey.userId).trim() : '';
  return botId || userId || '';
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeOptionalText(value) {
  const normalized = normalizeText(value);
  return normalized || null;
}

function parseDate(value) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function resolveDefaultTierId(tenantDb, tenantId) {
  const tiersCollection = tenantDb.collection(MASTER_DATA_TIERS_COLLECTION);
  const defaultTier = await tiersCollection.findOne({
    tenantId,
    tierKey: DEFAULT_TIER_KEY,
    isDeleted: { $ne: true },
  });

  if (defaultTier?._id) {
    return defaultTier._id;
  }

  const fallbackTier = await tiersCollection.findOne({
    tenantId,
    isDeleted: { $ne: true },
  });

  if (fallbackTier?._id) {
    return fallbackTier._id;
  }

  const now = new Date();
  const result = await tiersCollection.insertOne({
    tenantId,
    botUserId: '',
    tierKey: DEFAULT_TIER_KEY,
    tierName: 'Tier 1 (Retail Homeowner)',
    multiplier: 0.45,
    isDeleted: false,
    createdAt: now,
    updatedAt: now,
  });

  return result.insertedId;
}

function buildModuleState(existing = {}, key = '') {
  return {
    key,
    label: MODULE_LABELS[key] || key,
    status: normalizeText(existing.status || DEFAULT_IMPORT_STATUS) || DEFAULT_IMPORT_STATUS,
    fetchedCount: Number(existing.fetchedCount || 0),
    importedCount: Number(existing.importedCount || 0),
    startedAt: existing.startedAt ? new Date(existing.startedAt) : null,
    completedAt: existing.completedAt ? new Date(existing.completedAt) : null,
    lastError: normalizeOptionalText(existing.lastError),
  };
}

function buildDefaultImportState(existing = {}) {
  const modules = existing.modules || {};

  return {
    status: normalizeText(existing.status || 'pending_initial_import') || 'pending_initial_import',
    startedAt: existing.startedAt ? new Date(existing.startedAt) : null,
    completedAt: existing.completedAt ? new Date(existing.completedAt) : null,
    lastError: normalizeOptionalText(existing.lastError),
    modules: {
      customer: buildModuleState(modules.customer, 'customer'),
      quote: buildModuleState(modules.quote, 'quote'),
      invoice: buildModuleState(modules.invoice, 'invoice'),
      payment: buildModuleState(modules.payment, 'payment'),
    },
  };
}

function cloneImportStateForPersistence(state = {}) {
  return {
    status: state.status,
    startedAt: state.startedAt || null,
    completedAt: state.completedAt || null,
    lastError: state.lastError || null,
    modules: Object.fromEntries(
      MODULE_ORDER.map((key) => [
        key,
        {
          key,
          label: MODULE_LABELS[key],
          status: state.modules?.[key]?.status || DEFAULT_IMPORT_STATUS,
          fetchedCount: Number(state.modules?.[key]?.fetchedCount || 0),
          importedCount: Number(state.modules?.[key]?.importedCount || 0),
          startedAt: state.modules?.[key]?.startedAt || null,
          completedAt: state.modules?.[key]?.completedAt || null,
          lastError: state.modules?.[key]?.lastError || null,
        },
      ])
    ),
  };
}

function serializeImportState(state = null) {
  if (!state) {
    return null;
  }

  return {
    status: state.status,
    startedAt: state.startedAt ? new Date(state.startedAt).toISOString() : null,
    completedAt: state.completedAt ? new Date(state.completedAt).toISOString() : null,
    lastError: state.lastError || null,
    modules: MODULE_ORDER.map((key) => ({
      key,
      label: MODULE_LABELS[key],
      status: state.modules?.[key]?.status || DEFAULT_IMPORT_STATUS,
      fetchedCount: Number(state.modules?.[key]?.fetchedCount || 0),
      importedCount: Number(state.modules?.[key]?.importedCount || 0),
      startedAt: state.modules?.[key]?.startedAt ? new Date(state.modules[key].startedAt).toISOString() : null,
      completedAt: state.modules?.[key]?.completedAt ? new Date(state.modules[key].completedAt).toISOString() : null,
      lastError: state.modules?.[key]?.lastError || null,
    })),
  };
}

async function persistImportState(botUserId, nextState) {
  const masterDb = getMasterDbConnection();
  const stateToStore = cloneImportStateForPersistence(nextState);
  const now = new Date();

  await masterDb.collection(REGISTRY_COLLECTION).updateOne(
    { botUserId },
    {
      $set: {
        'zohoBooks.importState': stateToStore,
        updatedAt: now,
      },
    }
  );

  const refreshedRegistryEntry = await getTenantRegistry(botUserId);
  if (refreshedRegistryEntry) {
    primeTenantRoutingCache({
      ...refreshedRegistryEntry,
      zohoBooks: {
        ...(refreshedRegistryEntry.zohoBooks || {}),
        importState: stateToStore,
      },
      updatedAt: now,
    });
  }

  return stateToStore;
}

async function updateImportState(botUserId, mutator) {
  const registryEntry = await getTenantRegistry(botUserId);
  const currentState = buildDefaultImportState(registryEntry?.zohoBooks?.importState || {});
  const nextState = buildDefaultImportState(mutator(currentState) || currentState);
  await persistImportState(botUserId, nextState);
  return nextState;
}

async function fetchAllPages({ accessToken, apiDomain, organizationId, resourcePath, collectionKey }) {
  const records = [];
  const baseUrl = `${String(apiDomain || 'https://www.zohoapis.com').replace(/\/+$/, '')}${resourcePath}`;
  let page = 1;
  const perPage = 200;

  while (true) {
    const response = await getJson(baseUrl, {
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
      },
      params: {
        organization_id: organizationId,
        page,
        per_page: perPage,
      },
      label: `Zoho initial import ${collectionKey}`,
    });

    const batch = Array.isArray(response?.[collectionKey]) ? response[collectionKey] : [];
    records.push(...batch);

    if (batch.length < perPage) {
      break;
    }

    page += 1;
  }

  return records;
}

function buildImportedLineItems(lineItems = []) {
  if (!Array.isArray(lineItems) || !lineItems.length) {
    return [
      {
        itemId: null,
        name: 'Imported line item',
        description: null,
        quantity: 1,
        rate: 0,
        discount: 0,
        taxPercentage: 0,
        taxAmount: 0,
        amount: 0,
      },
    ];
  }

  return lineItems.map((lineItem) => {
    const quantity = Number(lineItem?.quantity || 1) || 1;
    const rate = Number(lineItem?.rate || lineItem?.price || 0) || 0;
    const discount = Number(lineItem?.discount_amount || lineItem?.discount || 0) || 0;
    const taxPercentage = Number(lineItem?.tax_percentage || lineItem?.taxPercent || 0) || 0;
    const taxAmount = Number(lineItem?.tax_amount || 0) || 0;
    const amount = Number(
      lineItem?.item_total ??
      lineItem?.total ??
      Math.max((quantity * rate) - discount, 0) + taxAmount
    ) || 0;

    return {
      itemId: normalizeOptionalText(lineItem?.item_id || lineItem?.itemId),
      name: normalizeText(lineItem?.name || lineItem?.item_name || 'Imported line item'),
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

function mapQuoteStatus(status) {
  const normalized = normalizeText(status).toLowerCase();

  if (['accepted', 'declined', 'expired', 'sent', 'draft'].includes(normalized)) {
    return normalized;
  }

  if (normalized === 'invoiced') {
    return 'accepted';
  }

  return 'draft';
}

function mapInvoiceStatus(status, balanceAmount, paidAmount) {
  const normalized = normalizeText(status).toLowerCase();

  if (['draft', 'sent', 'partially_paid', 'paid', 'overdue', 'void'].includes(normalized)) {
    return normalized;
  }

  if (normalized === 'partiallypaid') {
    return 'partially_paid';
  }

  if (balanceAmount <= 0) {
    return 'paid';
  }

  if (paidAmount > 0) {
    return 'partially_paid';
  }

  return 'sent';
}

function mapPaymentStatus(status) {
  const normalized = normalizeText(status).toLowerCase();

  if (normalized.includes('refund')) {
    return 'refunded';
  }

  if (normalized.includes('fail')) {
    return 'failed';
  }

  if (normalized.includes('pending')) {
    return 'pending';
  }

  return 'success';
}

function mapPaymentMode(paymentMode) {
  const normalized = normalizeText(paymentMode).toLowerCase().replace(/\s+/g, '_');
  const allowed = new Set(['cash', 'bank_transfer', 'upi', 'card', 'cheque', 'payment_gateway']);
  return allowed.has(normalized) ? normalized : 'payment_gateway';
}

const ADDRESS_PLACEHOLDERS = new Set([
  'not provided',
  'not available',
  'n/a',
  'na',
  'unknown',
  'imported from zoho books',
]);

function isUsableStoredAddress(value) {
  const normalized = normalizeText(value);
  return normalized && !ADDRESS_PLACEHOLDERS.has(normalized.toLowerCase());
}

function formatZohoAddress(address) {
  if (!address || typeof address !== 'object') {
    return null;
  }

  const values = [
    address.address || address.street,
    address.street2,
    address.city,
    address.state,
    address.zip,
    address.country,
  ];
  const seen = new Set();
  const lines = [];

  for (const value of values) {
    const normalized = normalizeText(value);
    const dedupeKey = normalized.toLowerCase();
    if (normalized && !ADDRESS_PLACEHOLDERS.has(dedupeKey) && !seen.has(dedupeKey)) {
      seen.add(dedupeKey);
      lines.push(normalized);
    }
  }

  return lines.length ? lines.join('\n') : null;
}

async function fetchZohoContactDetails({ accessToken, apiDomain, organizationId, zohoCustomerId }) {
  const apiRoot = String(apiDomain || 'https://www.zohoapis.com').replace(/\/+$/, '');
  const response = await getJson(
    `${apiRoot}/books/v3/contacts/${encodeURIComponent(zohoCustomerId)}`,
    {
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
      },
      params: {
        organization_id: organizationId,
      },
      label: 'Zoho initial import customer details',
    },
  );

  return response?.contact || response?.data || null;
}

async function importCustomers({ tenantDb, tenantId, botUserId, organizationId, accessToken, apiDomain }) {
  const contacts = await fetchAllPages({
    accessToken,
    apiDomain,
    organizationId,
    resourcePath: '/books/v3/contacts',
    collectionKey: 'contacts',
  });

  let importedCount = 0;

  for (const contact of contacts) {
    const zohoCustomerId = normalizeText(contact?.contact_id || contact?.contactId);
    if (!zohoCustomerId) {
      continue;
    }

    let addressContact = contact;
    if (!formatZohoAddress(contact?.billing_address) || !formatZohoAddress(contact?.shipping_address)) {
      try {
        const detailedContact = await fetchZohoContactDetails({
          accessToken,
          apiDomain,
          organizationId,
          zohoCustomerId,
        });
        if (detailedContact) {
          addressContact = detailedContact;
        }
      } catch (error) {
        logger.warn('Zoho customer detail fetch failed during initial import', {
          botUserId,
          zohoCustomerId,
          errorMessage: error?.response?.data?.message || error?.message || 'Unknown Zoho customer error.',
        });
      }
    }

    const importedBillingAddress = formatZohoAddress(addressContact?.billing_address);
    const importedShippingAddress = formatZohoAddress(addressContact?.shipping_address);

    await tenantDb.collection(ZOHO_CUSTOMERS_COLLECTION).updateOne(
      { zohoCustomerId, organizationId: String(organizationId || '').trim() },
      {
        $set: {
          zohoCustomerId,
          organizationId: String(organizationId || '').trim(),
          displayName: normalizeText(contact?.contact_name || contact?.contactName),
          email: normalizeOptionalText(contact?.email),
          phone: normalizeOptionalText(contact?.phone),
          contactType: normalizeOptionalText(contact?.contact_type),
          currencyCode: normalizeOptionalText(contact?.currency_code),
          syncedAt: new Date(),
          raw: addressContact,
        },
      },
      { upsert: true }
    );

    const existingCustomer = await tenantDb.collection(MASTER_DATA_CUSTOMERS_COLLECTION).findOne({
      $or: [
        { zohoCustomerId },
        ...(normalizeOptionalText(contact?.email) ? [{ email: normalizeText(contact.email) }] : []),
        ...(normalizeOptionalText(contact?.phone) ? [{ phone: normalizeText(contact.phone) }] : []),
      ],
      tenantId,
      isDeleted: { $ne: true },
    });

    const now = new Date();
    const defaultTierId = existingCustomer?.tierId || await resolveDefaultTierId(tenantDb, tenantId);
    const document = {
      tenantId,
      botUserId,
      customerCode: existingCustomer?.customerCode || null,
      tierId: defaultTierId || null,
      customerType: existingCustomer?.customerType || 'business',
      displayName: normalizeText(contact?.contact_name || contact?.contactName || existingCustomer?.displayName || 'Imported Customer'),
      companyName: normalizeOptionalText(contact?.company_name || existingCustomer?.companyName),
      email: normalizeOptionalText(contact?.email) || existingCustomer?.email || null,
      phoneCountryCode: existingCustomer?.phoneCountryCode || null,
      phone: normalizeOptionalText(contact?.phone) || existingCustomer?.phone || null,
      mobileCountryCode: existingCustomer?.mobileCountryCode || null,
      mobile: normalizeOptionalText(contact?.mobile) || existingCustomer?.mobile || null,
      gstNumber: normalizeOptionalText(contact?.gst_no) || existingCustomer?.gstNumber || null,
      taxTreatment: normalizeOptionalText(contact?.tax_treatment) || existingCustomer?.taxTreatment || null,
      billingAddress: importedBillingAddress
        || (isUsableStoredAddress(existingCustomer?.billingAddress) ? existingCustomer.billingAddress : ''),
      shippingAddress: importedShippingAddress
        || (isUsableStoredAddress(existingCustomer?.shippingAddress) ? existingCustomer.shippingAddress : null),
      currencyCode: normalizeOptionalText(contact?.currency_code) || existingCustomer?.currencyCode || null,
      paymentTerms: normalizeOptionalText(contact?.payment_terms_label) || existingCustomer?.paymentTerms || null,
      status: String(contact?.status || '').toLowerCase() === 'inactive' ? 'inactive' : 'active',
      isDeleted: false,
      zohoCustomerId,
      zohoSyncStatus: 'synced',
      zohoLastSyncedAt: now,
      zohoErrorMessage: null,
      createdAt: existingCustomer?.createdAt || now,
      updatedAt: now,
    };

    if (existingCustomer?._id) {
      await tenantDb.collection(MASTER_DATA_CUSTOMERS_COLLECTION).updateOne(
        { _id: existingCustomer._id },
        { $set: document }
      );
    } else {
      await tenantDb.collection(MASTER_DATA_CUSTOMERS_COLLECTION).insertOne(document);
    }

    importedCount += 1;
  }

  return {
    fetchedCount: contacts.length,
    importedCount,
  };
}

async function importQuotes({ tenantDb, tenantId, botUserId, organizationId, accessToken, apiDomain }) {
  const estimates = await fetchAllPages({
    accessToken,
    apiDomain,
    organizationId,
    resourcePath: '/books/v3/estimates',
    collectionKey: 'estimates',
  });

  let importedCount = 0;

  for (const estimate of estimates) {
    const zohoQuoteId = normalizeText(estimate?.estimate_id || estimate?.estimateId);
    const zohoCustomerId = normalizeText(estimate?.customer_id || estimate?.customerId);

    if (!zohoQuoteId || !zohoCustomerId) {
      continue;
    }

    const customer = await tenantDb.collection(MASTER_DATA_CUSTOMERS_COLLECTION).findOne({
      tenantId,
      zohoCustomerId,
      isDeleted: { $ne: true },
    });

    if (!customer?._id) {
      continue;
    }

    await tenantDb.collection(ZOHO_QUOTES_COLLECTION).updateOne(
      { zohoQuoteId, organizationId: String(organizationId || '').trim() },
      {
        $set: {
          zohoQuoteId,
          organizationId: String(organizationId || '').trim(),
          displayName: normalizeText(estimate?.estimate_number || 'Imported Quote'),
          customerId: zohoCustomerId,
          status: normalizeOptionalText(estimate?.status),
          currencyCode: normalizeOptionalText(estimate?.currency_code),
          total: Number(estimate?.total || 0),
          syncedAt: new Date(),
          raw: estimate,
        },
      },
      { upsert: true }
    );

    const existingQuote = await tenantDb.collection(MASTER_DATA_QUOTES_COLLECTION).findOne({
      tenantId,
      zohoEstimateId: zohoQuoteId,
      isDeleted: { $ne: true },
    });

    const lineItems = buildImportedLineItems(estimate?.line_items || []);
    const now = new Date();
    const document = {
      tenantId,
      botUserId,
      quoteNumber: normalizeText(estimate?.estimate_number || `ZOHO-QUOTE-${zohoQuoteId}`),
      customerId: customer._id,
      quoteDate: parseDate(estimate?.date) || existingQuote?.quoteDate || now,
      expiryDate: parseDate(estimate?.expiry_date) || null,
      lineItems,
      subTotal: Number(estimate?.sub_total ?? estimate?.subtotal ?? 0),
      taxTotal: Number(estimate?.tax_total ?? 0),
      discountTotal: Number(estimate?.discount_total ?? estimate?.discount ?? 0),
      grandTotal: Number(estimate?.total ?? 0),
      status: mapQuoteStatus(estimate?.status),
      notes: normalizeOptionalText(estimate?.notes),
      termsAndConditions: normalizeOptionalText(estimate?.terms),
      isDeleted: false,
      zohoEstimateId: zohoQuoteId,
      zohoSyncStatus: 'synced',
      zohoLastSyncedAt: now,
      zohoErrorMessage: null,
      createdAt: existingQuote?.createdAt || now,
      updatedAt: now,
    };

    if (existingQuote?._id) {
      await tenantDb.collection(MASTER_DATA_QUOTES_COLLECTION).updateOne(
        { _id: existingQuote._id },
        { $set: document }
      );
    } else {
      await tenantDb.collection(MASTER_DATA_QUOTES_COLLECTION).insertOne(document);
    }

    importedCount += 1;
  }

  return {
    fetchedCount: estimates.length,
    importedCount,
  };
}

async function importInvoices({ tenantDb, tenantId, botUserId, organizationId, accessToken, apiDomain }) {
  const invoices = await fetchAllPages({
    accessToken,
    apiDomain,
    organizationId,
    resourcePath: '/books/v3/invoices',
    collectionKey: 'invoices',
  });

  let importedCount = 0;

  for (const invoice of invoices) {
    const zohoInvoiceId = normalizeText(invoice?.invoice_id || invoice?.invoiceId);
    const zohoCustomerId = normalizeText(invoice?.customer_id || invoice?.customerId);

    if (!zohoInvoiceId || !zohoCustomerId) {
      continue;
    }

    const customer = await tenantDb.collection(MASTER_DATA_CUSTOMERS_COLLECTION).findOne({
      tenantId,
      zohoCustomerId,
      isDeleted: { $ne: true },
    });

    if (!customer?._id) {
      continue;
    }

    const zohoEstimateId = normalizeOptionalText(invoice?.estimate_id || invoice?.estimateId);
    const quote = zohoEstimateId
      ? await tenantDb.collection(MASTER_DATA_QUOTES_COLLECTION).findOne({
        tenantId,
        zohoEstimateId,
        isDeleted: { $ne: true },
      })
      : null;

    await tenantDb.collection(ZOHO_INVOICES_COLLECTION).updateOne(
      { zohoInvoiceId, organizationId: String(organizationId || '').trim() },
      {
        $set: {
          zohoInvoiceId,
          organizationId: String(organizationId || '').trim(),
          displayName: normalizeText(invoice?.invoice_number || 'Imported Invoice'),
          customerId: zohoCustomerId,
          status: normalizeOptionalText(invoice?.status),
          currencyCode: normalizeOptionalText(invoice?.currency_code),
          total: Number(invoice?.total || 0),
          syncedAt: new Date(),
          raw: invoice,
        },
      },
      { upsert: true }
    );

    const existingInvoice = await tenantDb.collection(MASTER_DATA_INVOICES_COLLECTION).findOne({
      tenantId,
      zohoInvoiceId,
      isDeleted: { $ne: true },
    });

    const lineItems = buildImportedLineItems(invoice?.line_items || []);
    const now = new Date();
    const paidAmount = Number(invoice?.paid_amount ?? 0);
    const balanceAmount = Number(invoice?.balance ?? Math.max(Number(invoice?.total || 0) - paidAmount, 0));
    const document = {
      tenantId,
      botUserId,
      invoiceNumber: normalizeText(invoice?.invoice_number || `ZOHO-INVOICE-${zohoInvoiceId}`),
      customerId: customer._id,
      quoteId: quote?._id || null,
      invoiceDate: parseDate(invoice?.date) || existingInvoice?.invoiceDate || now,
      dueDate: parseDate(invoice?.due_date) || parseDate(invoice?.date) || existingInvoice?.dueDate || now,
      lineItems,
      subTotal: Number(invoice?.sub_total ?? invoice?.subtotal ?? 0),
      taxTotal: Number(invoice?.tax_total ?? 0),
      discountTotal: Number(invoice?.discount_total ?? invoice?.discount ?? 0),
      grandTotal: Number(invoice?.total ?? 0),
      paidAmount,
      balanceAmount,
      status: mapInvoiceStatus(invoice?.status, balanceAmount, paidAmount),
      notes: normalizeOptionalText(invoice?.notes),
      termsAndConditions: normalizeOptionalText(invoice?.terms),
      isDeleted: false,
      zohoInvoiceId,
      zohoSyncStatus: 'synced',
      zohoLastSyncedAt: now,
      zohoErrorMessage: null,
      createdAt: existingInvoice?.createdAt || now,
      updatedAt: now,
    };

    if (existingInvoice?._id) {
      await tenantDb.collection(MASTER_DATA_INVOICES_COLLECTION).updateOne(
        { _id: existingInvoice._id },
        { $set: document }
      );
    } else {
      await tenantDb.collection(MASTER_DATA_INVOICES_COLLECTION).insertOne(document);
    }

    importedCount += 1;
  }

  return {
    fetchedCount: invoices.length,
    importedCount,
  };
}

async function importPayments({ tenantDb, tenantId, botUserId, organizationId, accessToken, apiDomain }) {
  const payments = await fetchAllPages({
    accessToken,
    apiDomain,
    organizationId,
    resourcePath: '/books/v3/customerpayments',
    collectionKey: 'customerpayments',
  });

  let importedCount = 0;

  for (const payment of payments) {
    const zohoPaymentId = normalizeText(
      payment?.payment_id ||
      payment?.customerpayment_id ||
      payment?.paymentId ||
      payment?.customerPaymentId
    );
    const zohoCustomerId = normalizeText(payment?.customer_id || payment?.customerId);
    const invoiceAllocation = Array.isArray(payment?.invoices) && payment.invoices.length ? payment.invoices[0] : null;
    const zohoInvoiceId = normalizeText(
      invoiceAllocation?.invoice_id ||
      invoiceAllocation?.invoiceId ||
      payment?.invoice_id ||
      payment?.invoiceId
    );

    if (!zohoPaymentId || !zohoCustomerId || !zohoInvoiceId) {
      continue;
    }

    const customer = await tenantDb.collection(MASTER_DATA_CUSTOMERS_COLLECTION).findOne({
      tenantId,
      zohoCustomerId,
      isDeleted: { $ne: true },
    });
    const invoice = await tenantDb.collection(MASTER_DATA_INVOICES_COLLECTION).findOne({
      tenantId,
      zohoInvoiceId,
      isDeleted: { $ne: true },
    });

    if (!customer?._id || !invoice?._id) {
      continue;
    }

    await tenantDb.collection(ZOHO_PAYMENTS_COLLECTION).updateOne(
      { zohoPaymentId, organizationId: String(organizationId || '').trim() },
      {
        $set: {
          zohoPaymentId,
          organizationId: String(organizationId || '').trim(),
          displayName: normalizeText(payment?.payment_number || 'Imported Payment'),
          customerId: zohoCustomerId,
          paymentMode: normalizeOptionalText(payment?.payment_mode),
          currencyCode: normalizeOptionalText(payment?.currency_code),
          amount: Number(payment?.amount || invoiceAllocation?.amount_applied || 0),
          syncedAt: new Date(),
          raw: payment,
        },
      },
      { upsert: true }
    );

    const existingPayment = await tenantDb.collection(MASTER_DATA_PAYMENTS_COLLECTION).findOne({
      tenantId,
      zohoPaymentId,
      isDeleted: { $ne: true },
    });

    const now = new Date();
    const document = {
      tenantId,
      botUserId,
      paymentNumber: normalizeText(payment?.payment_number || `ZOHO-PAYMENT-${zohoPaymentId}`),
      customerId: customer._id,
      invoiceId: invoice._id,
      paymentDate: parseDate(payment?.date) || existingPayment?.paymentDate || now,
      amount: Number(payment?.amount || invoiceAllocation?.amount_applied || 0),
      paymentMode: mapPaymentMode(payment?.payment_mode),
      referenceNumber: normalizeOptionalText(payment?.reference_number),
      gatewayProvider: normalizeOptionalText(payment?.gateway),
      gatewayPaymentId: normalizeOptionalText(payment?.payment_reference),
      status: mapPaymentStatus(payment?.status),
      notes: normalizeOptionalText(payment?.description),
      isDeleted: false,
      zohoPaymentId,
      zohoSyncStatus: 'synced',
      zohoLastSyncedAt: now,
      zohoErrorMessage: null,
      createdAt: existingPayment?.createdAt || now,
      updatedAt: now,
    };

    if (existingPayment?._id) {
      await tenantDb.collection(MASTER_DATA_PAYMENTS_COLLECTION).updateOne(
        { _id: existingPayment._id },
        { $set: document }
      );
    } else {
      await tenantDb.collection(MASTER_DATA_PAYMENTS_COLLECTION).insertOne(document);
    }

    importedCount += 1;
  }

  return {
    fetchedCount: payments.length,
    importedCount,
  };
}

async function runInitialImport(botUserId, botMasterKey) {
  try {
    await updateImportState(botUserId, (state) => ({
      ...state,
      status: 'initial_import_running',
      startedAt: state.startedAt || new Date(),
      completedAt: null,
      lastError: null,
    }));

    const registryEntry = await getTenantRegistry(botUserId);
    const tenantDb = await getTenantDb(botUserId);
    const tenantId = String(registryEntry?.tenantId || '').trim();
    const { getValidZohoAccessToken } = await import('./zohoOAuthService.js');
    const { accessToken, organizationId, apiDomain } = await getValidZohoAccessToken(botMasterKey);

    if (!tenantId) {
      throw new Error('Tenant is not configured for this Zoho Books connection.');
    }

    if (!organizationId) {
      throw new Error('Zoho Books organization is not selected for this tenant.');
    }

    const handlers = {
      customer: importCustomers,
      quote: importQuotes,
      invoice: importInvoices,
      payment: importPayments,
    };

    for (const moduleKey of MODULE_ORDER) {
      await updateImportState(botUserId, (state) => ({
        ...state,
        modules: {
          ...state.modules,
          [moduleKey]: {
            ...state.modules[moduleKey],
            status: 'running',
            startedAt: state.modules[moduleKey].startedAt || new Date(),
            completedAt: null,
            lastError: null,
          },
        },
      }));

      const result = await handlers[moduleKey]({
        tenantDb,
        tenantId,
        botUserId,
        organizationId,
        accessToken,
        apiDomain,
      });

      await updateImportState(botUserId, (state) => ({
        ...state,
        modules: {
          ...state.modules,
          [moduleKey]: {
            ...state.modules[moduleKey],
            status: 'completed',
            fetchedCount: result.fetchedCount,
            importedCount: result.importedCount,
            completedAt: new Date(),
            lastError: null,
          },
        },
      }));
    }

    await updateImportState(botUserId, (state) => ({
      ...state,
      status: 'active',
      completedAt: new Date(),
      lastError: null,
    }));
  } catch (error) {
    const errorMessage = error?.message || 'Initial Zoho Books import failed.';
    logger.error('Zoho Books initial import failed', {
      botUserId,
      message: errorMessage,
    });

    await updateImportState(botUserId, (state) => ({
      ...state,
      status: 'sync_failed',
      completedAt: new Date(),
      lastError: errorMessage,
    }));
  } finally {
    activeImportJobs.delete(botUserId);
  }
}

export async function scheduleZohoInitialImportForBot({ botMasterKey = {}, force = false } = {}) {
  const botUserId = getBotUserId(botMasterKey);

  if (!botUserId) {
    throw new Error('botMasterKey.botId or botMasterKey.userId is required.');
  }

  const registryEntry = await getTenantRegistry(botUserId);
  const zohoBooks = registryEntry?.zohoBooks || {};
  const importState = buildDefaultImportState(zohoBooks.importState || {});
  const selectedOrganizationId = normalizeText(
    zohoBooks?.organizations?.selectedOrganization?.organizationId ||
    zohoBooks?.selectedOrganizationId ||
    zohoBooks?.organizationId
  );

  if (!selectedOrganizationId) {
    return serializeImportState(importState);
  }

  const alreadyFinished = importState.status === 'active';
  const alreadyRunning = importState.status === 'initial_import_running' || activeImportJobs.has(botUserId);

  if (!force && (alreadyFinished || alreadyRunning)) {
    return serializeImportState(importState);
  }

  const pendingState = await updateImportState(botUserId, (state) => ({
    ...state,
    status: 'pending_initial_import',
    startedAt: state.startedAt || new Date(),
    completedAt: null,
    lastError: null,
    modules: Object.fromEntries(
      MODULE_ORDER.map((key) => [
        key,
        {
          ...state.modules[key],
          status: key === 'customer' ? 'pending' : state.modules[key].status === 'completed' && !force ? 'completed' : 'pending',
          fetchedCount: force ? 0 : Number(state.modules[key].fetchedCount || 0),
          importedCount: force ? 0 : Number(state.modules[key].importedCount || 0),
          startedAt: force ? null : state.modules[key].startedAt,
          completedAt: force ? null : state.modules[key].completedAt,
          lastError: null,
        },
      ])
    ),
  }));

  const job = runInitialImport(botUserId, registryEntry?.botMasterKey || botMasterKey);
  activeImportJobs.set(botUserId, job);
  void job;

  return serializeImportState(pendingState);
}

export async function getZohoInitialImportState(botMasterKey = {}) {
  const botUserId = getBotUserId(botMasterKey);

  if (!botUserId) {
    throw new Error('botMasterKey.botId or botMasterKey.userId is required.');
  }

  const registryEntry = await getTenantRegistry(botUserId);
  return serializeImportState(buildDefaultImportState(registryEntry?.zohoBooks?.importState || {}));
}

export { formatZohoAddress };
