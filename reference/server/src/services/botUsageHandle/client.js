import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { postJson } from '../../utils/httpClient.js';

function joinUrl(baseUrl, pathName) {
  return `${baseUrl.replace(/\/+$/, '')}/${pathName.replace(/^\/+/, '')}`;
}

function resolveEntitlementUrl(serviceName) {
  const explicitUrls = {
    availability: env.entitlementsAvailabilityUrl,
    'consume-csm-agent': env.entitlementsConsumeCsmAgentUrl,
  };

  const explicitUrl = explicitUrls[serviceName];

  if (explicitUrl) {
    return explicitUrl;
  }

  if (env.entitlementsBaseUrl) {
    return joinUrl(env.entitlementsBaseUrl, serviceName);
  }

  throw new Error(`Entitlement URL is not configured for service: ${serviceName}`);
}

export async function callEntitlementService(
  serviceName,
  payload,
  options = {},
) {
  const { requestId = '', headers = {} } = options;
  const url = resolveEntitlementUrl(serviceName);

  logger.info('Calling entitlement service', {
    service: 'fsmagent',
    requestId,
    serviceName,
    url,
    userId: payload?.userId,
    botId: payload?.botId,
    databaseName: payload?.databaseName,
    requestPayload: payload,
  });

  try {
    const response = await postJson(url, payload, { headers });

    logger.info('Entitlement service responded successfully', {
      service: 'fsmagent',
      requestId,
      serviceName,
      url,
      requestPayload: payload,
      responseBody: response,
    });

    return response;
  } catch (error) {
    logger.error('Entitlement service call failed', {
      service: 'fsmagent',
      requestId,
      serviceName,
      url,
      error: error?.message || String(error),
      requestPayload: payload,
      responseStatus: error?.response?.status ?? null,
      responseBody: error?.response?.data ?? null,
    });

    throw error;
  }
}
