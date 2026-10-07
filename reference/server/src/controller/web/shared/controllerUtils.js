import { logger } from '../../../config/logger.js';

export function getRequestContext(req) {
  // Shared by web controllers: recording this once makes database/tenant context
  // visible in the request timeline without each controller repeating the same log.
  req?.logFlowStep?.('web_controller_context_resolved', {
    botUserId: req.botUserId ?? null,
    tenantId: req.tenant?.tenantId ?? null,
    databaseName: req.tenant?.databaseName ?? null,
  });
  return {
    tenantDb: req.tenantDb,
    tenant: req.tenant,
    botUserId: req.botUserId,
    botMasterKey: req.tenant?.botMasterKey || {},
  };
}

function summarizeData(data) {
  if (Array.isArray(data)) {
    return {
      type: 'array',
      itemCount: data.length,
    };
  }

  if (data && typeof data === 'object') {
    return {
      type: 'object',
      keys: Object.keys(data).slice(0, 12),
    };
  }

  return {
    type: typeof data,
    value: data ?? null,
  };
}

export function getControllerLogMeta(req, extra = {}) {
  return {
    requestId: req?.requestId,
    method: req?.method,
    url: req?.originalUrl,
    botUserId: req?.botUserId ?? req?.body?.botUserId ?? null,
    tenantId: req?.tenant?.tenantId ?? null,
    databaseName: req?.tenant?.databaseName ?? null,
    ...extra,
  };
}

export function logControllerStep(req, message, extra = {}) {
  logger.info(message, getControllerLogMeta(req, extra));
}

export function sendSuccess(res, statusCode, message, data, pagination) {
  const responseBody = {
    status: 'ok',
    message,
    data,
  };

  if (pagination) {
    responseBody.pagination = pagination;
  }

  if (res?.req) {
    res.req.logFlowStep?.('web_controller_response_prepared', {
      statusCode,
      responseMessage: message,
    });
    logControllerStep(res.req, 'Web controller response prepared', {
      statusCode,
      responseStatus: responseBody.status,
      responseMessage: message,
      dataSummary: summarizeData(data),
      pagination: pagination || null,
    });
  }

  return res.status(statusCode).json(responseBody);
}
