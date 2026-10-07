import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { postJson } from '../utils/httpClient.js';

function buildFailureResponse(error) {
  return {
    result_text: 'Internal Server Error',
    result_code: '1',
    error: error?.message || String(error),
  };
}

async function callBotTaskApi({ action, url, body = {}, requestId = '' }) {
  if (!url) {
    const error = new Error(`${action} bot task URL is not configured.`);
    logger.error('Bot task request skipped because endpoint is not configured', {
      action,
      requestId,
    });
    return buildFailureResponse(error);
  }

  logger.info('Bot task request started', {
    action,
    requestId,
    url,
  });

  try {
    const result = await postJson(url, body, {
      requestId,
      label: `${action} bot task request`,
    });

    logger.info('Bot task request completed', {
      action,
      requestId,
      url,
      resultCode: result?.result_code ?? null,
    });

    return result;
  } catch (error) {
    logger.error('Bot task request failed', {
      action,
      requestId,
      url,
      error: error?.message || String(error),
      responseStatus: error?.response?.status ?? null,
    });
    return buildFailureResponse(error);
  }
}

export function createBotTask(body = {}, options = {}) {
  return callBotTaskApi({
    action: 'create',
    url: env.createBotTaskUrl,
    body,
    requestId: options.requestId || '',
  });
}

export function deleteBotTask(body = {}, options = {}) {
  return callBotTaskApi({
    action: 'delete',
    url: env.deleteBotTaskUrl,
    body,
    requestId: options.requestId || '',
  });
}

export function reassignBotTask(body = {}, options = {}) {
  return callBotTaskApi({
    action: 'reassign',
    url: env.reassignBotTaskUrl,
    body,
    requestId: options.requestId || '',
  });
}

export function getBotTask(body = {}, options = {}) {
  return callBotTaskApi({
    action: 'get',
    url: env.getBotTaskUrl,
    body,
    requestId: options.requestId || '',
  });
}
