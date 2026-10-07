// Central outbound HTTP wrapper: logs request lifecycle with sensitive headers redacted.
import axios from 'axios';
import { logger } from '../config/logger.js';

function sanitizeHeaders(headers = {}) {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => {
      if (String(key).toLowerCase() === 'authorization') {
        return [key, '[REDACTED]'];
      }

      return [key, value];
    }),
  );
}

function summarizeBody(body) {
  if (body == null) {
    return body;
  }

  if (Buffer.isBuffer(body)) {
    return {
      type: 'Buffer',
      length: body.length,
    };
  }

  if (body instanceof ArrayBuffer) {
    return {
      type: 'ArrayBuffer',
      byteLength: body.byteLength,
    };
  }

  return body;
}

function isZohoLogContext(url, label) {
  return /zoho/i.test(String(label || '')) || /zoho/i.test(String(url || ''));
}

function summarizeZohoBody(body) {
  if (body == null) {
    return body;
  }

  if (Buffer.isBuffer(body) || body instanceof ArrayBuffer) {
    return summarizeBody(body);
  }

  if (Array.isArray(body)) {
    return {
      type: 'array',
      length: body.length,
    };
  }

  if (typeof body !== 'object') {
    return body;
  }

  const summary = {};
  const importantScalarKeys = [
    'code',
    'message',
    'status',
    'organization_id',
    'organizationId',
    'customer_id',
    'customerId',
    'contact_id',
    'contactId',
    'estimate_id',
    'estimateId',
    'estimate_number',
    'invoice_id',
    'invoiceId',
    'invoice_number',
    'payment_id',
    'paymentId',
    'payment_number',
    'reference_number',
    'contact_name',
    'name',
    'total',
    'url',
  ];

  for (const key of importantScalarKeys) {
    if (body[key] != null && typeof body[key] !== 'object') {
      summary[key] = body[key];
    }
  }

  if (Array.isArray(body.line_items)) {
    summary.line_items = { count: body.line_items.length };
  }

  if (Array.isArray(body.lineItems)) {
    summary.lineItems = { count: body.lineItems.length };
  }

  for (const nestedKey of ['contact', 'estimate', 'invoice', 'payment']) {
    const nestedValue = body[nestedKey];

    if (nestedValue && typeof nestedValue === 'object' && !Array.isArray(nestedValue)) {
      summary[nestedKey] = summarizeZohoBody(nestedValue);
    }
  }

  if (!Object.keys(summary).length) {
    return { type: 'object' };
  }

  return summary;
}

function summarizeBodyForLog(body, { url = '', label = '' } = {}) {
  if (isZohoLogContext(url, label)) {
    return summarizeZohoBody(body);
  }

  return summarizeBody(body);
}

export async function requestHttp(url, config = {}) {
  const {
    method = 'get',
    data = undefined,
    headers = {},
    params = undefined,
    requestId = '',
    label = 'External HTTP request',
    ...restConfig
  } = config;

  logger.info(`${label} started`, {
    requestId,
    method: String(method).toUpperCase(),
    url,
    headers: sanitizeHeaders(headers),
    params,
    requestBody: summarizeBodyForLog(data, { url, label }),
  });

  try {
    const response = await axios.request({
      url,
      method,
      data,
      headers,
      params,
      ...restConfig,
    });

    logger.info(`${label} succeeded`, {
      requestId,
      method: String(method).toUpperCase(),
      url,
      status: response.status,
      responseBody: summarizeBodyForLog(response.data, { url, label }),
    });

    return response;
  } catch (error) {
    logger.error(`${label} failed`, {
      requestId,
      method: String(method).toUpperCase(),
      url,
      error: error?.message || String(error),
      responseStatus: error?.response?.status ?? null,
      responseBody: summarizeBodyForLog(error?.response?.data ?? null, { url, label }),
    });

    throw error;
  }
}

export async function postJson(url, payload, config = {}) {
  const response = await requestHttp(url, {
    ...config,
    method: 'post',
    data: payload,
  });
  return response.data;
}

export async function getJson(url, config = {}) {
  const response = await requestHttp(url, {
    ...config,
    method: 'get',
  });
  return response.data;
}

export async function putJson(url, payload, config = {}) {
  const response = await requestHttp(url, {
    ...config,
    method: 'put',
    data: payload,
  });
  return response.data;
}
