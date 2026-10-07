import crypto from 'node:crypto';
import { env } from '../config/env.js';

function isBase64Candidate(value) {
  if (typeof value !== 'string') {
    return false;
  }

  const normalizedValue = value.trim();
  if (normalizedValue.length === 0 || normalizedValue.length % 4 !== 0) {
    return false;
  }

  return /^[A-Za-z0-9+/]+={0,2}$/.test(normalizedValue);
}

export function decodeBase64Value(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    return '';
  }

  if (!isBase64Candidate(value)) {
    return value;
  }

  try {
    return Buffer.from(value, 'base64').toString('utf8');
  } catch {
    return value;
  }
}

export function encodeBase64Value(value) {
  return Buffer.from(String(value ?? ''), 'utf8').toString('base64');
}

export function encodeBotMasterKey(botMasterKey = {}) {
  return Buffer.from(JSON.stringify(botMasterKey ?? {}), 'utf8').toString('base64');
}

export function generateSignalId(length = 16) {
  const bytes = crypto.randomBytes(length);
  let signalId = '';

  for (let index = 0; index < length; index += 1) {
    signalId += String(bytes[index] % 10);
  }

  return signalId;
}

export function decodeStandardEOContext(context = {}) {
  return {
    ...context,
    decodedQuestionKey: decodeBase64Value(context.questionKey),
    decodedExpectedAns: decodeBase64Value(context.expectedAns),
    decodedAnswerKey: decodeBase64Value(context.answerKey),
  };
}

export function resolveEOFileNameByMimeType(fileName, mimeType) {
  const normalizedMimeType = String(mimeType || '').trim().toLowerCase();

  if (
    normalizedMimeType === 'text' ||
    normalizedMimeType === 'map' ||
    normalizedMimeType === 'html' ||
    normalizedMimeType === 'plain' ||
    normalizedMimeType.startsWith('text/')
  ) {
    return decodeBase64Value(fileName);
  }

  return String(fileName || '');
}

function normalizeId(value) {
  return value == null ? '' : String(value).trim();
}

export function buildStandardEOResponse({
  resultCode,
  resultText,
  reqMessageObj = {},
  resMessageObj = {},
  eoState = 'stop',
  fileName = '',
  fileNameFolder = '',
  description = '',
  thumbFileNameFolder = '',
  thumpNailName = '',
  orderReferenceNumber = null,
  workOrderId = null,
  quoteLink = null,
  invoiceNumber = null,
  invoiceUrl = null,
  paymentLinkId = null,
  paymentLink = null,
}) {
  const normalizedReqMessageObj = {
    ...reqMessageObj,
    fromId: normalizeId(reqMessageObj.fromId),
  };
  const channel = String(reqMessageObj.channel || '').trim();
  const normalizedOrderReferenceNumber = orderReferenceNumber == null ? null : String(orderReferenceNumber).trim() || null;
  const normalizedWorkOrderId = workOrderId == null ? null : String(workOrderId).trim() || null;
  const normalizedQuoteLink = quoteLink == null ? null : String(quoteLink).trim() || null;
  const normalizedInvoiceNumber = invoiceNumber == null ? null : String(invoiceNumber).trim() || null;
  const normalizedInvoiceUrl = invoiceUrl == null ? null : String(invoiceUrl).trim() || null;
  const normalizedPaymentLinkId = paymentLinkId == null ? null : String(paymentLinkId).trim() || null;
  const normalizedPaymentLink = paymentLink == null ? null : String(paymentLink).trim() || null;

  return {
    resultCode: String(resultCode ?? ''),
    resultText: String(resultText ?? ''),
    resMessageObj: {
      taskId: resMessageObj.taskId ?? normalizedReqMessageObj.taskId ?? '',
      fromId: normalizeId(resMessageObj.fromId ?? normalizedReqMessageObj.fromId),
      signalId: generateSignalId(),
      parentId: normalizedReqMessageObj.signalId || null,
      mimeType: resMessageObj.mimeType ?? normalizedReqMessageObj.mimeType ?? 'text',
      databaseName: normalizedReqMessageObj.databaseName || '',
      ...(channel ? { channel } : {}),
      fileName: encodeBase64Value(fileName),
      ...(description ? { description } : {}),
      ...(fileNameFolder ? { fileNameFolder } : {}),
      ...(thumbFileNameFolder ? { thumbFileNameFolder } : {}),
      ...(thumpNailName ? { thumpNailName: encodeBase64Value(thumpNailName) } : {}),
    },
    fromServer: env.standardEoFromServer,
    eoState,
    ...(normalizedOrderReferenceNumber ? { orderReferenceNumber: normalizedOrderReferenceNumber } : {}),
    ...(normalizedWorkOrderId ? { workOrderId: normalizedWorkOrderId } : {}),
    ...(normalizedQuoteLink ? { quoteLink: normalizedQuoteLink } : {}),
    ...(normalizedInvoiceNumber ? { invoiceNumber: normalizedInvoiceNumber } : {}),
    ...(normalizedInvoiceUrl ? { invoiceUrl: normalizedInvoiceUrl } : {}),
    ...(normalizedPaymentLinkId ? { paymentLinkId: normalizedPaymentLinkId } : {}),
    ...(normalizedPaymentLink ? { paymentLink: normalizedPaymentLink } : {}),
    reqMessageObj: normalizedReqMessageObj,
  };
}
