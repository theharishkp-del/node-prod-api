import { buildStandardEOResponse } from '../../../utils/eoResponse/buildStandardEOResponse.js';

export function normalizeText(value) {
  return String(value || '').trim();
}

export function resolveResponseFromId(reqMessageObj = {}, botUserId = '') {
  return String(reqMessageObj.toId || botUserId || reqMessageObj.fromId || '').trim();
}

export function buildStandardEOTextResponse(
  req,
  {
    resultText = 'success',
    fileName = '',
    eoState = 'stop',
    orderReferenceNumber = null,
    workOrderId = null,
    quoteLink = null,
    invoiceNumber = null,
    invoiceUrl = null,
    paymentLinkId = null,
    paymentLink = null,
    mimeType = 'text',
    fileNameFolder = '',
  } = {},
) {
  const reqMessageObj = req.body?.reqMessageObj ?? {};
  const botUserId = req.body?.botUserId ?? '';

  return buildStandardEOResponse({
    resultCode: '0',
    resultText,
    reqMessageObj,
    eoState,
    resMessageObj: {
      taskId: reqMessageObj.taskId ?? '',
      fromId: resolveResponseFromId(reqMessageObj, botUserId),
      mimeType,
    },
    fileName,
    orderReferenceNumber,
    workOrderId,
    quoteLink,
    invoiceNumber,
    invoiceUrl,
    paymentLinkId,
    paymentLink,
    fileNameFolder,
  });
}

export function buildStandardEOIvrTextResponse(
  req,
  {
    resultText = 'success',
    fileName = '',
    eoState = 'stop',
  } = {},
) {
  const response = buildStandardEOTextResponse(req, {
    resultText,
    fileName,
    eoState,
  });

  delete response.orderReferenceNumber;
  delete response.workOrderId;
  delete response.quoteLink;
  delete response.invoiceNumber;
  delete response.invoiceUrl;
  delete response.paymentLinkId;
  delete response.paymentLink;

  return response;
}
