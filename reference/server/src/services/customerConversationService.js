import { MASTER_DATA_CUSTOMERS_COLLECTION } from '../models/tenant/masterDataCustomerModel.js';
import { createCustomer } from './masterDataService.js';
import { fetchCybotUserDetails } from './cybotUserLookupService.js';

const DEFAULT_CUSTOMER_EMAIL_DOMAIN = 'cybot.local';
export const CUSTOMER_ENQUIRY_LOG_COLLECTION = 'customer_enquiry_logs';
const enquiryLogIndexReadyDatabases = new Set();

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeChannel(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeEmail(value, fallbackKey = '') {
  const email = normalizeText(value).toLowerCase();

  if (email && email.includes('@')) {
    return email;
  }

  const sanitizedFallbackKey = normalizeText(fallbackKey)
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '');

  if (!sanitizedFallbackKey) {
    return `customer@${DEFAULT_CUSTOMER_EMAIL_DOMAIN}`;
  }

  return `${sanitizedFallbackKey}@${DEFAULT_CUSTOMER_EMAIL_DOMAIN}`;
}

function normalizePhone(value, fallbackValue = '') {
  return normalizeText(value) || normalizeText(fallbackValue) || 'unknown';
}

function serializeCustomer(document) {
  if (!document) {
    return null;
  }

  return {
    id: document._id?.toString?.() || String(document.id || '').trim() || null,
    customerCode: normalizeText(document.customerCode) || null,
    displayName: normalizeText(document.displayName) || null,
    email: normalizeText(document.email) || null,
    phoneCountryCode: normalizeText(document.phoneCountryCode) || null,
    phone: normalizeText(document.phone) || null,
    mobileCountryCode: normalizeText(document.mobileCountryCode) || null,
    mobile: normalizeText(document.mobile) || null,
    cybotUserId: normalizeText(document.cybotUserId) || null,
    isCybotRegister: Boolean(document.isCybotRegister),
    status: normalizeText(document.status) || null,
  };
}

async function ensureCustomerEnquiryLogCollectionReady(tenantDb) {
  if (!tenantDb) {
    return;
  }

  const databaseKey = normalizeText(tenantDb.databaseName) || 'default';
  if (enquiryLogIndexReadyDatabases.has(databaseKey)) {
    return;
  }

  const collection = tenantDb.collection(CUSTOMER_ENQUIRY_LOG_COLLECTION);
  await collection.createIndex(
    { tenantId: 1, customerKey: 1, sessionId: 1 },
    { unique: true, name: 'uniq_customer_session_enquiry_log' },
  );
  await collection.createIndex(
    { tenantId: 1, sessionDate: 1, updatedAt: -1 },
    { name: 'customer_enquiry_log_session_date_idx' },
  );

  enquiryLogIndexReadyDatabases.add(databaseKey);
}

function buildCustomerEnquiryLogFilter({
  tenant = {},
  customer = null,
  cybotUserId = '',
  reqMessageObj = {},
  sessionId = '',
}) {
  const normalizedSessionId =
    normalizeText(sessionId) ||
    normalizeText(reqMessageObj.sessionDate) ||
    normalizeText(reqMessageObj.signalId) ||
    'customer-enquiry-session';
  const customerKey =
    normalizeText(customer?.cybotUserId) ||
    normalizeText(cybotUserId) ||
    normalizeText(customer?.id) ||
    normalizeText(reqMessageObj.fromId) ||
    'anonymous-customer';

  return {
    tenantId: normalizeText(tenant?.tenantId),
    customerKey,
    sessionId: normalizedSessionId,
  };
}

function buildCustomerSnapshot({ customer = null, cybotUserId = '' } = {}) {
  return {
    id: normalizeText(customer?.id) || null,
    customerCode: normalizeText(customer?.customerCode) || null,
    displayName: normalizeText(customer?.displayName) || null,
    email: normalizeText(customer?.email) || null,
    phone: normalizeText(customer?.phone || customer?.mobile) || null,
    cybotUserId: normalizeText(customer?.cybotUserId || cybotUserId) || null,
    status: normalizeText(customer?.status) || null,
  };
}

function buildConversationMessageEntry({
  role = 'user',
  text = '',
  agentInputText = '',
  customMessage = '',
  inputType = 'text',
  fileUrl = null,
  thumbnailUrl = null,
  originalFileName = null,
  localDateTime = '',
  localTimeZone = '',
  reqMessageObj = {},
  requestId = '',
  threadId = '',
  eoState = '',
  conversationStatus = '',
  orderReferenceNumber = null,
  workOrderId = null,
  quoteLink = null,
  invoiceNumber = null,
  invoiceUrl = null,
  paymentLinkId = null,
  paymentLink = null,
}) {
  return {
    role: normalizeText(role) || 'user',
    text: normalizeText(text),
    agentInputText: normalizeText(agentInputText) || null,
    customMessage: normalizeText(customMessage) || null,
    inputType: normalizeText(inputType) || 'text',
    mimeType: normalizeText(reqMessageObj?.mimeType) || null,
    originalFileName: normalizeText(originalFileName) || null,
    fileUrl: normalizeText(fileUrl) || null,
    thumbnailUrl: normalizeText(thumbnailUrl) || null,
    requestId: normalizeText(requestId) || null,
    signalId: normalizeText(reqMessageObj?.signalId) || null,
    taskId: normalizeText(reqMessageObj?.taskId) || null,
    channel: normalizeText(reqMessageObj?.channel) || null,
    localDateTime: normalizeText(localDateTime) || null,
    localTimeZone: normalizeText(localTimeZone) || null,
    threadId: normalizeText(threadId) || null,
    eoState: normalizeText(eoState) || null,
    conversationStatus: normalizeText(conversationStatus) || null,
    orderReferenceNumber: normalizeText(orderReferenceNumber) || null,
    workOrderId: normalizeText(workOrderId) || null,
    quoteLink: normalizeText(quoteLink) || null,
    invoiceNumber: normalizeText(invoiceNumber) || null,
    invoiceUrl: normalizeText(invoiceUrl) || null,
    paymentLinkId: normalizeText(paymentLinkId) || null,
    paymentLink: normalizeText(paymentLink) || null,
    createdAt: new Date(),
  };
}

export async function appendCustomerEnquiryLogEntry({
  tenantDb,
  tenant = {},
  botUserId = '',
  customer = null,
  cybotUserId = '',
  sessionId = '',
  sessionDate = '',
  localDateTime = '',
  localTimeZone = '',
  reqMessageObj = {},
  context = {},
  role = 'user',
  text = '',
  agentInputText = '',
  customMessage = '',
  inputType = 'text',
  fileUrl = null,
  thumbnailUrl = null,
  originalFileName = null,
  requestId = '',
  threadId = '',
  eoState = '',
  conversationStatus = '',
  orderReferenceNumber = null,
  workOrderId = null,
  quoteLink = null,
  invoiceNumber = null,
  invoiceUrl = null,
  paymentLinkId = null,
  paymentLink = null,
} = {}) {
  if (!tenantDb) {
    return null;
  }

  await ensureCustomerEnquiryLogCollectionReady(tenantDb);

  const now = new Date();
  const filter = buildCustomerEnquiryLogFilter({
    tenant,
    customer,
    cybotUserId,
    reqMessageObj,
    sessionId,
  });
  const normalizedSessionDate =
    normalizeText(sessionDate) ||
    normalizeText(reqMessageObj.sessionDate) ||
    normalizeText(filter.sessionId);
  const messageEntry = buildConversationMessageEntry({
    role,
    text,
    agentInputText,
    customMessage,
    inputType,
    fileUrl,
    thumbnailUrl,
    originalFileName,
    localDateTime,
    localTimeZone,
    reqMessageObj,
    requestId,
    threadId,
    eoState,
    conversationStatus,
    orderReferenceNumber,
    workOrderId,
    quoteLink,
    invoiceNumber,
    invoiceUrl,
    paymentLinkId,
    paymentLink,
  });

  await tenantDb.collection(CUSTOMER_ENQUIRY_LOG_COLLECTION).updateOne(
    filter,
    {
      $setOnInsert: {
        tenantId: filter.tenantId,
        customerKey: filter.customerKey,
        sessionId: filter.sessionId,
        sessionDate: normalizedSessionDate,
        createdAt: now,
        reqMessageObj: {
          fromId: normalizeText(reqMessageObj.fromId) || null,
          toId: normalizeText(reqMessageObj.toId) || null,
          fromEmail: normalizeText(reqMessageObj.fromEmail) || null,
          databaseName: normalizeText(reqMessageObj.databaseName) || null,
          channel: normalizeText(reqMessageObj.channel) || null,
        },
      },
      $set: {
        botUserId: normalizeText(botUserId) || null,
        customer: buildCustomerSnapshot({ customer, cybotUserId }),
        context,
        inputType: normalizeText(inputType) || 'text',
        localDateTime: normalizeText(localDateTime) || null,
        localTimeZone: normalizeText(localTimeZone) || null,
        latestThreadId: normalizeText(threadId) || null,
        latestConversationStatus: normalizeText(conversationStatus) || null,
        latestEoState: normalizeText(eoState) || null,
        latestOrderReferenceNumber: normalizeText(orderReferenceNumber) || null,
        latestWorkOrderId: normalizeText(workOrderId) || null,
        latestQuoteLink: normalizeText(quoteLink) || null,
        latestInvoiceNumber: normalizeText(invoiceNumber) || null,
        latestInvoiceUrl: normalizeText(invoiceUrl) || null,
        latestPaymentLinkId: normalizeText(paymentLinkId) || null,
        latestPaymentLink: normalizeText(paymentLink) || null,
        updatedAt: now,
        lastMessageAt: now,
      },
      $push: {
        messages: messageEntry,
      },
    },
    { upsert: true },
  );

  return {
    sessionId: filter.sessionId,
    sessionDate: normalizedSessionDate,
    customerKey: filter.customerKey,
  };
}

function buildCustomerDisplayName(userDetails = {}, fallbackCybotUserId = '') {
  const firstName = normalizeText(userDetails.firstName);
  const lastName = normalizeText(userDetails.lastName);
  const fullName = `${firstName} ${lastName}`.trim();

  return (
    fullName ||
    normalizeText(userDetails.userName) ||
    normalizeText(userDetails.uniqueName) ||
    normalizeText(userDetails.emailId) ||
    normalizeText(userDetails.phoneNumber) ||
    normalizeText(fallbackCybotUserId) ||
    'Customer'
  );
}

async function findCustomerByCybotUserId({ tenantDb, tenantId, cybotUserId }) {
  const normalizedCybotUserId = normalizeText(cybotUserId);

  if (!normalizedCybotUserId) {
    return null;
  }

  return tenantDb.collection(MASTER_DATA_CUSTOMERS_COLLECTION).findOne({
    tenantId: normalizeText(tenantId),
    cybotUserId: normalizedCybotUserId,
    isDeleted: { $ne: true },
  });
}

function buildCustomerCreatePayload({ userDetails, cybotUserId, tenant }) {
  return {
    customerType: 'individual',
    displayName: buildCustomerDisplayName(userDetails, cybotUserId),
    companyName: null,
    email: normalizeText(userDetails.emailId) || null,
    phoneCountryCode: normalizeText(userDetails.countryCode) || null,
    phone: normalizeText(userDetails.phoneNumber) || null,
    mobileCountryCode: normalizeText(userDetails.countryCode) || null,
    mobile: normalizeText(userDetails.phoneNumber) || null,
    billingAddress: '',
    shippingAddress: null,
    currencyCode: normalizeText(tenant?.companyDetails?.currency) || null,
    paymentTerms: null,
    status: 'active',
    cybotUserId: normalizeText(cybotUserId) || null,
    isCybotRegister: true,
  };
}

export async function ensureCustomerForConversation({
  tenantDb,
  tenant,
  botUserId,
  databaseName,
  cybotUserId,
}) {
  const normalizedCybotUserId = normalizeText(cybotUserId);

  if (!normalizedCybotUserId) {
    return {
      customer: null,
      created: false,
      lookupFound: false,
    };
  }

  const existingCustomer = await findCustomerByCybotUserId({
    tenantDb,
    tenantId: tenant?.tenantId,
    cybotUserId: normalizedCybotUserId,
  });

  if (existingCustomer) {
    return {
      customer: serializeCustomer(existingCustomer),
      created: false,
      lookupFound: true,
    };
  }

  const lookupResult = await fetchCybotUserDetails({
    userId: normalizedCybotUserId,
    databaseName,
    botMasterKey: tenant?.botMasterKey || {},
  });

  if (!lookupResult?.found || !lookupResult?.userDetails) {
    return {
      customer: null,
      created: false,
      lookupFound: false,
    };
  }

  const createdCustomer = await createCustomer({
    tenantDb,
    tenant,
    botUserId,
    botMasterKey: tenant?.botMasterKey || {},
    payload: buildCustomerCreatePayload({
      userDetails: lookupResult.userDetails,
      cybotUserId: normalizedCybotUserId,
      tenant,
    }),
  });

  return {
    customer: serializeCustomer(createdCustomer),
    created: true,
    lookupFound: true,
  };
}

export function buildConversationAgentPayload({
  requestId,
  sessionId,
  reqMessageObj = {},
  context = {},
  tenant = {},
  botUserId,
  customer,
  message,
  localDateTime,
  localTimeZone,
  inputType = 'text',
  fileUrl = null,
  thumbnailUrl = null,
  originalFileName = null,
  requestDatabaseName = null,
  metadataOverrides = {},
}) {
  const resolvedSessionId =
    normalizeText(sessionId) ||
    normalizeText(reqMessageObj.signalId) ||
    normalizeText(requestId) ||
    'customer-order-session';
  const databaseName =
    normalizeText(tenant?.databaseName) ||
    normalizeText(tenant?.botMasterKey?.databaseName) ||
    null;
  const customerName =
    normalizeText(customer?.displayName) ||
    normalizeText(customer?.customerCode) ||
    normalizeText(reqMessageObj.fromId) ||
    'Customer';
  const customerIdentifier =
    normalizeText(customer?.cybotUserId) ||
    normalizeText(reqMessageObj.fromId) ||
    normalizeText(customer?.id);
  const normalizedInputType = normalizeText(inputType).toLowerCase() || 'text';
  const normalizedMimeType = normalizeText(reqMessageObj.mimeType) || null;
  const attachment =
    (normalizedInputType === 'image' || normalizedInputType === 'document') && normalizeText(fileUrl)
      ? {
        type: normalizedInputType === 'document' ? 'document' : 'image',
        mimeType: normalizedMimeType,
        fileUrl: normalizeText(fileUrl),
        thumbnailUrl: normalizeText(thumbnailUrl) || null,
        originalFileName: normalizeText(originalFileName) || null,
      }
      : null;

  const payload = {
    customerInfo: {
      name: customerName,
      emailId: normalizeEmail(customer?.email, customerIdentifier),
      phNumber: normalizePhone(customer?.phone || customer?.mobile, customerIdentifier),
    },
    databaseInfo: {
      databaseName,
      tenantId: normalizeText(tenant?.tenantId) || undefined,
      botUserId: normalizeText(botUserId) || undefined,
    },
    sessionInfo: {
      sessionId: resolvedSessionId,
      requestId: normalizeText(requestId) || normalizeText(reqMessageObj.signalId) || 'customer-order-request',
    },
    userMessage: normalizeText(message),
    inputType: normalizedInputType,
    attachments: attachment ? [attachment] : [],
    metadata: {
      source: 'fsm-server',
      channel: normalizeText(reqMessageObj.channel) || null,
      isEmailViaMailBridge: normalizeChannel(reqMessageObj.channel) === 'emailviamailbridge',
      fromEmail: normalizeText(reqMessageObj.fromEmail) || null,
      conversationId: normalizeText(reqMessageObj.signalId) || null,
      taskId: normalizeText(reqMessageObj.taskId) || null,
      fromId: normalizeText(reqMessageObj.fromId) || null,
      toId: normalizeText(reqMessageObj.toId) || null,
      mimeType: normalizedMimeType,
      hasAttachment: Boolean(attachment),
      attachment,
      localDateTime: normalizeText(localDateTime) || new Date().toISOString(),
      localTimeZone: normalizeText(localTimeZone) || 'Asia/Kolkata',
      customer,
      context,
      ...metadataOverrides,
    },
  };

  if (normalizeText(requestDatabaseName)) {
    payload.databaseInfo.requestDatabaseName = normalizeText(requestDatabaseName);
  }

  return payload;
}
