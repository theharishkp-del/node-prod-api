import crypto from 'node:crypto';
import { env } from '../config/env.js';

const KEY_VERSION = 1;
const KEY_TTL_MS = 24 * 60 * 60 * 1000;
const PRODUCT_ORDER_LOGO_URL =
  'https://cybots3pro.s3.us-east-1.amazonaws.com/afte/6157/Invoicelogo_Invoicelogo_IQLogoHorizontal_Clearbg_6157.png';

export const PRODUCT_ORDER_QUESTION_KEY = 'iq+customer_menu';
export const PRODUCT_ORDER_ANSWER_KEY = 'iq+customer_menu_ans_3';

function normalizeText(value) {
  return String(value || '').trim();
}

function serializeCustomer(customer = {}) {
  return {
    id: normalizeText(customer.id || customer._id?.toString?.() || customer._id),
    cybotUserId: normalizeText(customer.cybotUserId) || null,
    name: normalizeText(customer.displayName || customer.name),
  };
}

function encodeBase64Url(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

export function decodeProductOrderKey(key) {
  try {
    const decoded = JSON.parse(Buffer.from(normalizeText(key), 'base64url').toString('utf8'));
    const expiresAt = new Date(decoded.expiresAt);
    const isExpectedRoute =
      decoded.questionKey === PRODUCT_ORDER_QUESTION_KEY &&
      decoded.answerKey === PRODUCT_ORDER_ANSWER_KEY;

    if (
      decoded.version !== KEY_VERSION ||
      !decoded.tenantId ||
      !decoded.botUserId ||
      !decoded.currencyCode ||
      !decoded.customer?.id ||
      !isExpectedRoute ||
      Number.isNaN(expiresAt.getTime()) ||
      expiresAt <= new Date()
    ) {
      return null;
    }

    return decoded;
  } catch {
    return null;
  }
}

export function createProductOrderLink({
  tenant,
  botUserId,
  customer,
  tierMultiplier = 1,
  reqMessageObj = {},
} = {}) {
  const customerContext = serializeCustomer(customer);
  const taskId = normalizeText(reqMessageObj.taskId);
  const signalId = normalizeText(reqMessageObj.signalId);
  const now = new Date();
  const currencyCode =
    normalizeText(customer?.currencyCode) ||
    normalizeText(tenant?.companyDetails?.currency) ||
    'USD';
  const payload = {
    version: KEY_VERSION,
    questionKey: PRODUCT_ORDER_QUESTION_KEY,
    answerKey: PRODUCT_ORDER_ANSWER_KEY,
    orderSource: 'webpage',
    currencyCode: currencyCode.toUpperCase(),
    tenantId: normalizeText(tenant?.tenantId),
    botUserId: normalizeText(botUserId),
    databaseName:
      normalizeText(reqMessageObj.databaseName) ||
      normalizeText(tenant?.databaseName) ||
      normalizeText(tenant?.botMasterKey?.databaseName),
    sessionId: taskId || signalId || crypto.randomUUID(),
    taskId: taskId || null,
    signalId: signalId || null,
    logoUrl: PRODUCT_ORDER_LOGO_URL,
    tierMultiplier,
    customer: customerContext,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + KEY_TTL_MS).toISOString(),
  };

  if (!payload.tenantId || !payload.botUserId || !customerContext.id) {
    const error = new Error('Tenant, bot user, and customer are required to create a product-order key.');
    error.statusCode = 400;
    throw error;
  }

  const key = encodeBase64Url(payload);
  return {
    key,
    payload,
    url: `${normalizeText(env.productOrderClientUrl).replace(/\/$/, '')}/product-order?key=${encodeURIComponent(key)}`,
  };
}
