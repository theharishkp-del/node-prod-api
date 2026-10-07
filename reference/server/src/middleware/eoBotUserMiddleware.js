import { logger } from '../config/logger.js';
import { getTrialStatusForBot } from '../services/planMasterService.js';
import { buildEoResposne } from '../utils/eoResponse/buildEOResponse.js';
import { getTenantDb, getTenantRegistry, provisionTrialTenant } from '../utils/tenantManager.js';

function resolveResponseFromId(reqMessageObj = {}, botUserId = '') {
  return String(reqMessageObj.toId || botUserId || '').trim();
}

function buildBotUserUnavailableResponse(req, resultText = '13') {
  const reqMessageObj = req.body?.reqMessageObj ?? {};
  const botUserId = String(req.body?.botUserId || '').trim();

  return buildEoResposne({
    resultCode: '0',
    resultText,
    reqMessageObj,
    eoState: 'stop',
    resMessageObj: {
      taskId: reqMessageObj.taskId ?? '',
      fromId: resolveResponseFromId(reqMessageObj, botUserId),
      mimeType: 'text',
    },
    fileName: 'This bot is not configured. Please contact admin.',
  });
}

function buildTrialExpiredResponse(req, trialStatus = {}) {
  const reqMessageObj = req.body?.reqMessageObj ?? {};
  const botUserId = String(req.body?.botUserId || '').trim();
  const trialEndMessage = String(
    trialStatus.trialEndMessage || 'Thanks for using the OFA Agent trial. The trial period has ended. Please purchase the OFA Agent in the cart.'
  ).trim();

  return buildEoResposne({
    resultCode: '0',
    resultText: '13',
    reqMessageObj,
    eoState: 'stop',
    resMessageObj: {
      taskId: reqMessageObj.taskId ?? '',
      fromId: resolveResponseFromId(reqMessageObj, botUserId),
      mimeType: 'text',
    },
    fileName: trialEndMessage,
  });
}

export async function ensureRegisteredBotUser(req, res, next) {
  try {
    const botUserId = String(req.body?.botUserId || '').trim();
    const signalId = req.body?.reqMessageObj?.signalId ?? null;

    req.logFlowStep?.('eo_bot_validation_started', { botUserId: botUserId || null, signalId });

    logger.info('EO bot user validation started', {
      requestId: req.requestId,
      path: req.originalUrl,
      botUserId: botUserId || null,
      signalId,
    });

    if (!botUserId) {
      logger.warn('EO botUserId is missing', {
        requestId: req.requestId,
        path: req.originalUrl,
        signalId,
      });

      const response = buildBotUserUnavailableResponse(req);
      logger.warn('EO unavailable response returned', {
        requestId: req.requestId,
        path: req.originalUrl,
        reason: 'missing_bot_user_id',
        responsePayload: response,
      });

      return res.status(200).json(response);
    }

    // Check if bot is configured: either in registry or in trial
    const tenantRegistry = await getTenantRegistry(botUserId);
    const trialStatus = await getTrialStatusForBot(botUserId);

    if (!tenantRegistry && !trialStatus) {
      logger.warn('EO bot is not configured', {
        requestId: req.requestId,
        path: req.originalUrl,
        botUserId,
        signalId,
      });

      const response = buildBotUserUnavailableResponse(req);
      logger.warn('EO unavailable response returned', {
        requestId: req.requestId,
        path: req.originalUrl,
        botUserId,
        signalId,
        reason: 'bot_not_configured',
        responsePayload: response,
      });

      return res.status(200).json(response);
    }

    // Check if trial bot and expired
    if (trialStatus && trialStatus.isExpired) {
      const response = buildTrialExpiredResponse(req, trialStatus);
      logger.warn('EO trial expired response returned', {
        requestId: req.requestId,
        path: req.originalUrl,
        botUserId,
        trialEndDate: trialStatus.endDate,
        trialEndMessage: trialStatus.trialEndMessage,
        responsePayload: response,
      });
      return res.status(200).json(response);
    }

    // Trial bot is active, provision and proceed
    if (trialStatus) {
      const trialTenant = await provisionTrialTenant(botUserId);
      logger.info('EO trial bot validation passed', {
        requestId: req.requestId,
        path: req.originalUrl,
        botUserId,
        trialEndDate: trialStatus.endDate,
        databaseName: trialTenant.databaseName,
      });
      req.tenant = trialTenant;
      req.tenantDb = await getTenantDb(botUserId);
      return next();
    }

    // Regular configured bot
    if (!tenantRegistry) {
      logger.warn('EO botUserId was not found in master registry', {
        requestId: req.requestId,
        path: req.originalUrl,
        botUserId,
        signalId,
      });

      const response = buildBotUserUnavailableResponse(req);
      logger.warn('EO unavailable response returned', {
        requestId: req.requestId,
        path: req.originalUrl,
        botUserId,
        signalId,
        reason: 'registry_not_found',
        responsePayload: response,
      });

      return res.status(200).json(response);
    }

    logger.info('EO bot user validation passed', {
      requestId: req.requestId,
      path: req.originalUrl,
      botUserId,
      signalId,
      tenantId: tenantRegistry.tenantId ?? null,
      databaseName: tenantRegistry.databaseName ?? null,
    });

    req.tenant = tenantRegistry;
    req.tenantDb = await getTenantDb(botUserId);
    req.logFlowStep?.('eo_bot_validation_completed', {
      botUserId,
      tenantId: tenantRegistry.tenantId ?? null,
      databaseName: tenantRegistry.databaseName ?? null,
    });
    return next();
  } catch (error) {
    req.logFlowStep?.('eo_bot_validation_failed', { error: error.message });
    return next(error);
  }
}
