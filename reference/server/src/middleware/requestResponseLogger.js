import { logger } from '../config/logger.js';

export function formatRequestTraceBlock({ requestId, method, url, statusCode, durationMs, requestFlow = [] } = {}) {
  const lines = [];
  lines.push('┌──────────────────────── REQUEST TRACE ────────────────────────┐');
  lines.push(`│ requestId: ${requestId || 'unknown'}`);
  lines.push(`│ method: ${method || 'UNKNOWN'}`);
  lines.push(`│ url: ${url || 'unknown'}`);
  lines.push(`│ statusCode: ${statusCode ?? 'n/a'}`);
  lines.push(`│ durationMs: ${durationMs ?? 'n/a'}`);

  if (requestFlow.length > 0) {
    lines.push('│ steps:');
    for (const step of requestFlow) {
      const name = step?.step || 'unknown_step';
      const elapsed = step?.elapsedMs ?? 'n/a';
      lines.push(`│   - ${name} (elapsedMs: ${elapsed})`);
    }
  }

  lines.push('└────────────────────────────────────────────────────────────────┘');
  return lines.join('\n');
}

function buildRequestId() {
  return `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function summarizeFlowDetails(details = {}) {
  if (!details || typeof details !== 'object') {
    return {};
  }

  const safeDetails = { ...details };

  for (const sensitiveKey of ['authorization', 'cookie', 'set-cookie', 'x-api-key', 'apiKey', 'password', 'secret', 'token']) {
    if (safeDetails[sensitiveKey] !== undefined) {
      safeDetails[sensitiveKey] = '[REDACTED]';
    }
  }

  return safeDetails;
}

function sanitizeRequestPayload(payload) {
  if (payload === undefined) {
    return undefined;
  }

  if (payload === null || typeof payload !== 'object') {
    return payload;
  }

  const result = Array.isArray(payload) ? [...payload] : { ...payload };

  for (const [key, value] of Object.entries(result)) {
    const loweredKey = String(key).toLowerCase();

    if (['authorization', 'cookie', 'set-cookie', 'x-api-key', 'apiKey', 'password', 'secret', 'token', 'accessToken', 'refreshToken'].includes(loweredKey)) {
      result[key] = '[REDACTED]';
      continue;
    }

    if (value && typeof value === 'object') {
      result[key] = sanitizeRequestPayload(value);
    }
  }

  return result;
}

export function requestResponseLogger(req, res, next) {
  const startTime = Date.now();
  const requestId = req.headers['x-request-id'] || buildRequestId();
  const tenantId = req.headers['x-tenant-id'] || req.headers['x-tenant'] || req.headers['tenantId'];
  const botUserId = req.headers['x-bot-user-id'] || req.headers['botUserId'];
  const sessionId = req.headers['x-session-id'] || req.headers['sessionId'];

  req.requestId = requestId;
  req.requestFlow = [];
  req.tenantId = tenantId;
  req.botUserId = botUserId;
  req.sessionId = sessionId;
  req.logFlowStep = (step, details = {}) => {
    const entry = {
      stepNumber: req.requestFlow.length + 1,
      step,
      elapsedMs: Date.now() - startTime,
      ...summarizeFlowDetails(details),
    };
    req.requestFlow.push(entry);

    logger.flow(step, {
      requestId,
      tenantId,
      botUserId,
      sessionId,
      method: req.method,
      url: req.originalUrl,
      route: req.route?.path || req.originalUrl,
      ...entry,
    });
  };
  res.setHeader('x-request-id', requestId);

  const safeQuery = sanitizeRequestPayload(req.query);
  const safeParams = sanitizeRequestPayload(req.params);
  const safeBody = sanitizeRequestPayload(req.body);
  const safeHeaders = {
    authorization: req.headers.authorization ? '[REDACTED]' : undefined,
    cookie: req.headers.cookie ? '[REDACTED]' : undefined,
    'x-bot-user-id': botUserId,
    'x-tenant-id': tenantId,
    'x-session-id': sessionId,
  };

  req.logFlowStep('request_received', {
    stage: 'inbound',
    method: req.method,
    url: req.originalUrl,
    route: req.route?.path || req.originalUrl,
    ip: req.ip,
    query: safeQuery,
    params: safeParams,
    bodySummary: safeBody,
    headersSummary: safeHeaders,
  });

  logger.info('HTTP request received', {
    requestId,
    tenantId,
    botUserId,
    sessionId,
    method: req.method,
    url: req.originalUrl,
    route: req.route?.path || req.originalUrl,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    query: safeQuery,
    params: safeParams,
    bodySummary: safeBody,
    headersSummary: safeHeaders,
    step: 'request_received',
    action: 'http_request_received',
    responseStatus: 'in_progress',
  });

  res.on('finish', () => {
    const durationMs = Date.now() - startTime;

    req.logFlowStep('request_completed', {
      stage: 'outbound',
      statusCode: res.statusCode,
      durationMs,
      totalSteps: req.requestFlow.length,
    });

    const traceBlock = formatRequestTraceBlock({
      requestId,
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      durationMs,
      requestFlow: req.requestFlow,
    });

    logger.info('HTTP request completed', {
      requestId,
      tenantId,
      botUserId,
      sessionId,
      method: req.method,
      url: req.originalUrl,
      route: req.route?.path || req.originalUrl,
      statusCode: res.statusCode,
      durationMs,
      totalSteps: req.requestFlow.length,
      requestFlow: req.requestFlow,
      step: 'request_completed',
      action: 'http_request_completed',
      responseStatus: res.statusCode >= 400 ? 'error' : 'success',
    });

    logger.info(traceBlock, {
      requestId,
      tenantId,
      botUserId,
      sessionId,
      method: req.method,
      url: req.originalUrl,
      route: req.route?.path || req.originalUrl,
      statusCode: res.statusCode,
      durationMs,
      requestFlow: req.requestFlow,
      step: 'request_trace',
      action: 'request_trace_block',
      responseStatus: res.statusCode >= 400 ? 'error' : 'success',
    });
  });

  next();
}
