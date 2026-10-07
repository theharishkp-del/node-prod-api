import { logger } from '../../config/logger.js';
import { env } from '../../config/env.js';
import { buildEoResposne } from '../../utils/eoResponse/buildEOResponse.js';
import { postJson } from '../../utils/httpClient.js';
import { ensureCustomerExistsForCybotUser } from '../../services/customerAutoCreateService.js';

const WIDGET_GUEST_EMAIL = 'info@widget.com';

function getNormalizedWidgetEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeText(value) {
  return String(value || '').trim();
}

function getNotVerifiedUserId(reqMessageObj = {}) {
  return String(reqMessageObj.notVerifiedUserId || reqMessageObj.notVerifiedUserID || '').trim();
}

function normalizeWidgetRouteRequestBody(reqBody = {}) {
  const reqMessageObj = reqBody?.reqMessageObj ?? {};

  return {
    ...reqBody,
    reqMessageObj: {
      ...reqMessageObj,
      fromId: reqMessageObj.fromId == null ? '' : String(reqMessageObj.fromId).trim(),
    },
  };
}

async function fetchWidgetUserDetails({ requestId, fromId, databaseName }) {
  if (!env.checkBotUserIdUrl || !fromId || !databaseName) {
    return null;
  }

  const response = await postJson(
    env.checkBotUserIdUrl,
    {
      userId: fromId,
      databaseName,
    },
    {
      requestId,
      label: 'Widget URL user details lookup',
    },
  );

  if (String(response?.result_code) !== '0') {
    return null;
  }

  const userDetails = typeof response.userDetails === 'string'
    ? JSON.parse(response.userDetails)
    : response.userDetails;

  return userDetails && typeof userDetails === 'object' ? userDetails : null;
}

async function fetchGuestUserStatus({ requestId, databaseName, taskId }) {
  if (!env.guestUserStatusUrl || !databaseName || !taskId) {
    return null;
  }

  const response = await postJson(
    env.guestUserStatusUrl,
    {
      databaseName,
      taskId,
    },
    {
      requestId,
      label: 'Widget URL guest user status lookup',
    },
  );

  if (String(response?.result_code) !== '0') {
    return null;
  }

  return {
    isGuestUserVerified: Boolean(response?.isGuestUserVerified),
    isGuestUserId: String(response?.isGuestUserId || '').trim(),
  };
}

async function resolveWidgetResponseFromId(req) {
  const reqMessageObj = req.body?.reqMessageObj ?? {};
  const requestId = req.requestId;
  const originalFromId = String(reqMessageObj.fromId || '').trim();
  const fromEmail = getNormalizedWidgetEmail(reqMessageObj.fromEmail);
  const notVerifiedUserId = getNotVerifiedUserId(reqMessageObj);
  const databaseName = String(reqMessageObj.databaseName || '').trim();
  const taskId = String(reqMessageObj.taskId || '').trim();

  logger.info('AI Meet widget URL fromId resolution started', {
    requestId,
    originalFromId: originalFromId || null,
    fromEmail: fromEmail || null,
    hasNotVerifiedUserId: Boolean(notVerifiedUserId),
    databaseName: databaseName || null,
    taskId: taskId || null,
  });

  const userDetails = await fetchWidgetUserDetails({
    requestId,
    fromId: originalFromId,
    databaseName,
  });
  const resolvedEmailId = getNormalizedWidgetEmail(userDetails?.emailId);

  logger.info('AI Meet widget URL user details checked', {
    requestId,
    originalFromId: originalFromId || null,
    requestFromEmail: fromEmail || null,
    resolvedEmailId: resolvedEmailId || null,
    lookupMatchedWidgetGuest: resolvedEmailId === WIDGET_GUEST_EMAIL,
  });

  if (resolvedEmailId && resolvedEmailId !== WIDGET_GUEST_EMAIL) {
    logger.info('AI Meet widget URL fromId fallback applied', {
      requestId,
      resolutionType: 'original_from_id',
      resolvedFromId: originalFromId || null,
      reason: 'lookup_email_is_not_widget_guest',
    });

    return originalFromId;
  }

  if (resolvedEmailId === WIDGET_GUEST_EMAIL && notVerifiedUserId) {
    logger.info('AI Meet widget URL fromId resolved from not verified user', {
      requestId,
      resolutionType: 'not_verified_user_id',
      resolvedFromId: notVerifiedUserId,
    });

    return notVerifiedUserId;
  }

  if (resolvedEmailId === WIDGET_GUEST_EMAIL) {
    const guestUserStatus = await fetchGuestUserStatus({
      requestId,
      databaseName,
      taskId,
    });

    logger.info('AI Meet widget URL guest user status checked', {
      requestId,
      isGuestUserVerified: guestUserStatus?.isGuestUserVerified ?? null,
      isGuestUserId: guestUserStatus?.isGuestUserId || null,
    });

    if (guestUserStatus?.isGuestUserVerified && guestUserStatus?.isGuestUserId) {
      logger.info('AI Meet widget URL fromId resolved from verified guest user', {
        requestId,
        resolutionType: 'verified_guest_user_id',
        resolvedFromId: guestUserStatus.isGuestUserId,
      });

      return guestUserStatus.isGuestUserId;
    }
  }

  logger.info('AI Meet widget URL fromId fallback applied', {
    requestId,
    resolutionType: 'original_from_id',
    resolvedFromId: originalFromId || null,
    reason: 'guest_resolution_not_available',
  });

  return originalFromId;
}

function findCybotUserRole(cybotUsers = [], fromId = '') {
  const normalizedFromId = normalizeText(fromId);
  const matchedUser = (Array.isArray(cybotUsers) ? cybotUsers : []).find(
    (user) => normalizeText(user?.id) === normalizedFromId
  ) || null;

  if (!matchedUser) {
    return 'Customer';
  }

  return normalizeText(matchedUser.role) || 'Customer';
}

function resolveWidgetResultText(role = '') {
  const normalizedRole = normalizeText(role).toLowerCase();

  if (normalizedRole === 'admin') {
    return '4';
  }

  if (normalizedRole === 'technician') {
    return '14';
  }

  return '2';
}

async function triggerWidgetQuestionFlow({
  requestId,
  reqBody = {},
  resolvedFromId = '',
  questionIdOrKey = '',
  tenant = null,
} = {}) {
  if (!env.sentToQuestionUrl || !resolvedFromId || !questionIdOrKey) {
    return null;
  }

  const reqMessageObj = reqBody?.reqMessageObj ?? {};
  const botUserId = normalizeText(reqBody?.botUserId);
  const botDatabaseName =
    normalizeText(reqBody?.botDatabaseName) ||
    normalizeText(tenant?.botMasterKey?.databaseName) ||
    normalizeText(tenant?.databaseName) ||
    normalizeText(reqMessageObj.databaseName) ||
    normalizeText(env.botDbName);
  const databaseName =
    normalizeText(reqMessageObj.databaseName) ||
    normalizeText(tenant?.databaseName) ||
    normalizeText(reqBody?.databaseName);
  const taskId = normalizeText(reqMessageObj.taskId);
  const sessionDate =
    normalizeText(reqBody?.sessionDate) ||
    normalizeText(reqBody?.localDateTime);
  const requestPayload = {
    botUserId,
    botDatabaseName,
    databaseName,
    taskId,
    userId: resolvedFromId,
    sessionDate,
    questionIdOrKey,
    reqMessageObj,
    resetFromBackUp: false,
    resetUserStateOnly: true,
  };

  logger.info('AI Meet widget URL SENT_TO_QUESTION request', {
    requestId,
    questionIdOrKey,
    taskId,
    userId: resolvedFromId,
    requestPayload,
  });

  const data = await postJson(
    env.sentToQuestionUrl,
    requestPayload,
    {
      requestId,
      label: 'AI Meet widget URL SENT_TO_QUESTION',
    },
  );

  logger.info('AI Meet widget URL SENT_TO_QUESTION response received', {
    requestId,
    questionIdOrKey,
    taskId,
    userId: resolvedFromId,
    responseBody: data,
  });

  return data;
}

function buildAiMeetWidgetSuccessResponse(req, fromId) {
  const reqMessageObj = req.body?.reqMessageObj ?? {};

  return buildEoResposne({
    resultCode: '0',
    resultText: 'success',
    reqMessageObj,
    eoState: 'stop',
    resMessageObj: {
      taskId: reqMessageObj.taskId ?? '',
      fromId,
      mimeType: 'text',
    },
    fileName: '',
  });
}

export async function handleAiMeetWidgetUrl(req, res, next) {
  try {
    // Resolve the widget identity, initialize its EO question state, then return the callback payload.
    req.logFlowStep?.('widget_url_handler_started');
    req.body = normalizeWidgetRouteRequestBody(req.body);
    const reqMessageObj = req.body?.reqMessageObj ?? {};
    const context = req.body?.context ?? {};
    const taskId = reqMessageObj.taskId ?? null;
    const signalId = reqMessageObj.signalId ?? null;
    const botUserId = req.body?.botUserId ?? null;
    req.logFlowStep?.('widget_url_request_normalized', {
      taskId,
      hasQuestionKey: Boolean(context.questionKey),
    });

    logger.info('AI Meet widget URL controller started', {
      requestId: req.requestId,
      botUserId,
      signalId,
      taskId,
    });

    logger.info('AI Meet widget URL request context resolved', {
      requestId: req.requestId,
      botUserId,
      signalId,
      taskId,
      questionKey: context.questionKey ?? null,
      apiAnswer: context.apiAnswer ?? null,
      fromId: reqMessageObj.fromId ?? null,
      toId: reqMessageObj.toId ?? null,
      fromEmail: reqMessageObj.fromEmail ?? null,
      notVerifiedUserId: getNotVerifiedUserId(reqMessageObj) || null,
      databaseName: reqMessageObj.databaseName ?? null,
    });

    logger.info('AI Meet widget URL request payload', {
      requestId: req.requestId,
      botUserId,
      requestPayload: req.body,
    });


    

    const resolvedFromId = await resolveWidgetResponseFromId(req);
    const role = findCybotUserRole(req.tenant?.cybotUsers, resolvedFromId);
    const questionIdOrKey = resolveWidgetResultText(role);
    req.logFlowStep?.('widget_url_identity_resolved', {
      role,
      questionIdOrKey,
      usedFallbackIdentity: resolvedFromId !== normalizeText(reqMessageObj.fromId),
    });
    const databaseName =
      normalizeText(reqMessageObj.databaseName) ||
      normalizeText(req.tenant?.botMasterKey?.databaseName) ||
      normalizeText(req.tenant?.databaseName);

    if (normalizeText(role).toLowerCase() === 'customer') {
      await ensureCustomerExistsForCybotUser({
        tenantDb: req.tenantDb,
        tenant: req.tenant,
        botUserId,
        databaseName,
        cybotUserId: resolvedFromId,
      });
      req.logFlowStep?.('widget_url_customer_ensured');
    }

    await triggerWidgetQuestionFlow({
      requestId: req.requestId,
      reqBody: req.body,
      resolvedFromId,
      questionIdOrKey,
      tenant: req.tenant,
    });
    req.logFlowStep?.('widget_url_question_flow_triggered', { questionIdOrKey });

    const response = buildAiMeetWidgetSuccessResponse(req, resolvedFromId);
    req.logFlowStep?.('widget_url_response_composed', {
      resultText: response.resultText,
      eoState: response.eoState,
    });

    logger.info('AI Meet widget URL EO response prepared', {
      requestId: req.requestId,
      botUserId,
      taskId,
      parentSignalId: signalId,
      resolvedRole: role,
      questionIdOrKey,
      responseResultText: response.resultText,
      requestFromId: reqMessageObj.fromId ?? null,
      responseFromId: response.resMessageObj.fromId ?? null,
      responseTaskId: response.resMessageObj.taskId ?? null,
      responseMimeType: response.resMessageObj.mimeType ?? null,
    });

    logger.info('AI Meet widget URL response generated', {
      requestId: req.requestId,
      parentSignalId: signalId,
      responseSignalId: response.resMessageObj.signalId,
      resultCode: response.resultCode,
      resultText: response.resultText,
      eoState: response.eoState,
    });

    logger.info('AI Meet widget URL response payload', {
      requestId: req.requestId,
      botUserId,
      taskId,
      responsePayload: response,
    });

    return res.status(200).json(response);
  } catch (error) {
    return next(error);
  }
}
