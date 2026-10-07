import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { postJson } from '../utils/httpClient.js';

export async function addBotAsBuddy({
  fromId,
  buddyId,
  requestStatus = 'accepted',
  databaseName,
} = {}) {
  if (!env.addBotAsBuddyUrl) {
    throw new Error('ADD_BOT_BUDDY is not configured.');
  }

  const normalizedFromId = String(fromId || '').trim();
  const normalizedBuddyId = String(buddyId || '').trim();
  const normalizedRequestStatus = String(requestStatus || 'accepted').trim() || 'accepted';
  const normalizedDatabaseName = String(databaseName || env.botDbName || '').trim();

  if (!normalizedFromId) {
    throw new Error('fromId is required to add bot as buddy.');
  }

  if (!normalizedBuddyId) {
    throw new Error('buddyId is required to add bot as buddy.');
  }

  if (!normalizedDatabaseName) {
    throw new Error('databaseName is required to add bot as buddy.');
  }

  const requestPayload = {
    fromId: normalizedFromId,
    buddyId: normalizedBuddyId,
    requestStatus: normalizedRequestStatus,
    databaseName: normalizedDatabaseName,
  };

  logger.info('Add bot as buddy outbound request payload', {
    url: env.addBotAsBuddyUrl,
    requestPayload,
  });

  const data = await postJson(env.addBotAsBuddyUrl, requestPayload);

  logger.info('Add bot as buddy raw response received', {
    responseBody: data,
  });

  return data;
}
