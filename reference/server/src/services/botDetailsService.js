import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { postJson } from '../utils/httpClient.js';

function normalizeBotDetails(botDetails) {
  if (!botDetails || typeof botDetails !== 'object') {
    return null;
  }

  return {
    serverGeneratedUniqueName: String(botDetails.serverGeneratedUniqueName || '').trim(),
    firstName: String(botDetails.firstName || '').trim(),
    aiMeetQrCode: String(botDetails.aiMeetQrCode || '').trim(),
    uniqueName: String(botDetails.uniqueName || '').trim(),
    paymentBot: Boolean(botDetails.paymentBot),
    promotionalContent: String(botDetails.promotionalContent || '').trim(),
    aiMeetQrCodeURL: String(botDetails.aiMeetQrCodeURL || '').trim(),
    emailId: String(botDetails.emailId || '').trim(),
    id: String(botDetails.id || '').trim(),
    userName: String(botDetails.userName || '').trim(),
  };
}

export async function fetchBotDetails(payload = {}) {
  if (!env.getbotDetails) {
    throw new Error('GET_BOT_DETAILS is not configured.');
  }

  const databaseName =
    String(payload.databaseName || payload.botMasterKey?.databaseName || env.botDbName || '').trim();
  const botId = String(payload.botId || payload.botMasterKey?.botId || '').trim();

  if (!databaseName) {
    throw new Error('Database name is required for bot details lookup.');
  }

  if (!botId) {
    throw new Error('botId is required for bot details lookup.');
  }

  const requestPayload = {
    databaseName,
    botId,
  };

  logger.info('Bot details outbound request payload', {
    url: env.getbotDetails,
    requestPayload,
  });

  const data = await postJson(env.getbotDetails, requestPayload);

  logger.info('Bot details raw response received', {
    responseBody: data,
  });

  if (String(data?.result_code) !== '0') {
    return {
      found: false,
      message: data?.result_text || 'No Data Found',
      requestPayload,
      botDetails: null,
    };
  }

  const rawBotDetails = Array.isArray(data?.botDetails) ? data.botDetails[0] : null;
  const normalizedBotDetails = normalizeBotDetails(rawBotDetails);

  if (!normalizedBotDetails) {
    return {
      found: false,
      message: data?.result_text || 'No Data Found',
      requestPayload,
      botDetails: null,
    };
  }

  const result = {
    found: true,
    message: data?.result_text || 'Available Bot Details',
    requestPayload,
    botDetails: normalizedBotDetails,
  };

  logger.info('Bot details normalized response', {
    normalizedResponse: result,
  });

  return result;
}
