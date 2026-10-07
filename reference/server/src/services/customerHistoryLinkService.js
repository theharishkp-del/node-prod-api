import { env } from '../config/env.js';
import { encodeBotMasterKey } from '../utils/standardEO.js';

function normalizeText(value) {
  return String(value || '').trim();
}

export function buildCustomerHistoryContext(customer = {}) {
  return {
    customerId: normalizeText(customer?.id || customer?._id?.toString?.()),
    cybotUserId: normalizeText(customer?.cybotUserId),
    customerCode: normalizeText(customer?.customerCode),
    displayName: normalizeText(customer?.displayName),
  };
}

export function encodeCustomerHistoryContext(customer = {}) {
  return Buffer.from(
    JSON.stringify(buildCustomerHistoryContext(customer)),
    'utf8',
  ).toString('base64');
}

export function buildCustomerHistoryUrl(botMasterKey = {}, customer = {}) {
  const baseClientUrl = normalizeText(env.clientUrl).replace(/\/+$/, '');
  const encodedKey = encodeBotMasterKey(botMasterKey);
  const encodedCustomer = encodeCustomerHistoryContext(customer);

  if (!baseClientUrl || !encodedKey || !encodedCustomer) {
    return '#';
  }

  return `${baseClientUrl}/customer-history?key=${encodeURIComponent(encodedKey)}&customer=${encodeURIComponent(encodedCustomer)}`;
}
