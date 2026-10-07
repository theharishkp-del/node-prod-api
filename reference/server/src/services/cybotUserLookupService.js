import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { postJson } from '../utils/httpClient.js';

function normalizeUserDetails(userDetails) {
  if (!userDetails || typeof userDetails !== 'object') {
    return null;
  }

  return {
    firstName: String(userDetails.firstName || '').trim(),
    lastName: String(userDetails.lastName || '').trim(),
    uniqueName: String(userDetails.uniqueName || '').trim(),
    userName: String(userDetails.userName || '').trim(),
    id: String(userDetails.id || '').trim(),
    emailId: String(userDetails.emailId || '').trim(),
    phoneNumber: String(userDetails.phoneNumber || '').trim(),
    countryCode: String(userDetails.countryCode || '').trim(),
  };
}

function buildEmailId({ emailId, countryCode, phoneNumber }) {
  const trimmedEmailId = String(emailId || '').trim();

  if (trimmedEmailId) {
    return trimmedEmailId;
  }

  const trimmedCountryCode = String(countryCode || '').trim();
  const trimmedPhoneNumber = String(phoneNumber || '').trim();

  if (!trimmedCountryCode || !trimmedPhoneNumber) {
    throw new Error('Either emailId or countryCode and phoneNumber are required.');
  }

  return `${trimmedCountryCode}_${trimmedPhoneNumber}${env.userCheckPhoneNumberSuffix}`;
}

function buildLookupIdentifierPayload(payload = {}) {
  const userId = String(payload.userId || payload.cybotUserId || payload.fromId || '').trim();

  if (userId) {
    return {
      userId,
    };
  }

  return {
    emailId: buildEmailId(payload),
  };
}

export async function fetchCybotUserDetails(payload) {
  if (!env.checkBotUserIdUrl) {
    throw new Error('CHECK_BOT_USERID is not configured.');
  }

  const databaseName =
    String(payload.databaseName || payload.botMasterKey?.databaseName || env.botDbName || '').trim();

  if (!databaseName) {
    throw new Error('Database name is required for Cybot user lookup.');
  }

  const requestPayload = {
    databaseName,
    ...buildLookupIdentifierPayload(payload),
  };

  logger.info('Cybot lookup outbound request payload', {
    url: env.checkBotUserIdUrl,
    requestPayload,
  });

  const data = await postJson(env.checkBotUserIdUrl, requestPayload);

  logger.info('Cybot lookup raw response received', {
    responseBody: data,
  });

  if (String(data?.result_code) !== '0') {
    logger.info('Cybot lookup completed without matching user', {
      normalizedResponse: {
        found: false,
        message: data?.result_text || 'User details were not found.',
        requestPayload,
        userDetails: null,
      },
    });

    return {
      found: false,
      message: data?.result_text || 'User details were not found.',
      requestPayload,
      userDetails: null,
    };
  }

  const parsedUserDetails =
    typeof data.userDetails === 'string' ? JSON.parse(data.userDetails) : data.userDetails;
  const normalizedUserDetails = normalizeUserDetails(parsedUserDetails);

  if (!normalizedUserDetails) {
    throw new Error('Cybot userDetails response is not a valid object.');
  }

  const result = {
    found: true,
    message: data?.result_text || 'Available User Details',
    requestPayload,
    userDetails: normalizedUserDetails,
  };

  logger.info('Cybot lookup normalized response', {
    normalizedResponse: result,
  });

  return result;
}
