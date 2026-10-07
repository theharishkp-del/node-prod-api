import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { postJson } from '../utils/httpClient.js';

function normalizeText(value) {
  return String(value || '').trim();
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function interruptIvrCallAndContinueViaWidget({
  botUserId = '',
  botDatabaseName = '',
  taskId = '',
  userId = '',
  sessionDate = '',
  callSId = '',
  msgContent = '',
  messageObj = {},
  requestId = '',
} = {}) {
  const payload = {
    botUserId: normalizeText(botUserId),
    botDatabaseName: normalizeText(botDatabaseName),
    databaseName: normalizeText(env.botDbName),
    taskId: normalizeText(taskId),
    userId: normalizeText(userId),
    sessionDate: normalizeText(sessionDate),
    // The IVR menu selection that starts the widget continuation flow.
    questionIdOrKey: '5',
    callActivity: {
      msgContent: normalizeText(msgContent),
      callSId: normalizeText(callSId),
      hangUp: true,
    },
    // The IVR API needs the original EO request context to continue the
    // conversation in the widget after the voice call is ended.
    messageObj: messageObj && typeof messageObj === 'object' ? messageObj : {},
  };

  logger.info('IVR interrupt-and-continue-via-widget payload prepared', {
    requestId,
    url: env.ivrInterruptCallAndContinueViaWidgetUrl,
    payload,
  });

  if (
    !payload.botUserId ||
    !payload.botDatabaseName ||
    !payload.databaseName ||
    !payload.taskId ||
    !payload.userId ||
    !payload.sessionDate ||
    !payload.callActivity.callSId ||
    !payload.callActivity.msgContent ||
    !env.ivrInterruptCallAndContinueViaWidgetUrl
  ) {
    logger.warn('IVR interrupt-and-continue-via-widget skipped because required fields are missing', {
      requestId,
      hasBotUserId: Boolean(payload.botUserId),
      hasBotDatabaseName: Boolean(payload.botDatabaseName),
      hasDatabaseName: Boolean(payload.databaseName),
      hasTaskId: Boolean(payload.taskId),
      hasUserId: Boolean(payload.userId),
      hasSessionDate: Boolean(payload.sessionDate),
      hasCallSId: Boolean(payload.callActivity.callSId),
      hasMessage: Boolean(payload.callActivity.msgContent),
      hasUrl: Boolean(env.ivrInterruptCallAndContinueViaWidgetUrl),
    });
    return { success: false, resultCode: '1', resultText: '16' };
  }

  try {
    const response = await postJson(env.ivrInterruptCallAndContinueViaWidgetUrl, payload, {
      requestId,
      label: 'IVR interrupt call and continue via widget',
    });
    const resultCode = normalizeText(response?.resultCode);
    const resultText = normalizeText(response?.resultText);

    logger.info('IVR interrupt-and-continue-via-widget response received', {
      requestId,
      payload,
      responseBody: response,
      resultCode: resultCode || null,
      resultText: resultText || null,
    });

    return {
      success: resultCode === '0',
      resultCode: resultCode || '1',
      resultText: resultCode === '0' ? resultText || 'success' : '16',
    };
  } catch (error) {
    logger.error('IVR interrupt-and-continue-via-widget call failed', {
      requestId,
      error: error.message,
    });
    return { success: false, resultCode: '1', resultText: '16' };
  }
}

export async function hangUpIvrCallWithMessage({
  callSId = '',
  msgContent = '',
  requestId = '',
} = {}) {
  const payload = {
    callSId: normalizeText(callSId),
    msgContent: normalizeText(msgContent),
  };

  logger.info('IVR hang-up call payload prepared', {
    requestId,
    url: env.ivrHangUpCallWithMessageUrl,
    payload,
  });

  if (!payload.callSId || !payload.msgContent || !env.ivrHangUpCallWithMessageUrl) {
    logger.warn('IVR hang-up call skipped because required fields are missing', {
      requestId,
      hasCallSId: Boolean(payload.callSId),
      hasMessage: Boolean(payload.msgContent),
      hasUrl: Boolean(env.ivrHangUpCallWithMessageUrl),
    });
    return { success: false, resultCode: '1', resultText: '16' };
  }

  try {
    // Allow the final IVR message to play before requesting that the call ends.
    await delay(3000);

    const response = await postJson(env.ivrHangUpCallWithMessageUrl, payload, {
      requestId,
      label: 'IVR hang-up call with message',
    });
    const resultCode = normalizeText(response?.resultCode);
    const resultText = normalizeText(response?.resultText);

    logger.info('IVR hang-up call response received', {
      requestId,
      payload,
      responseBody: response,
      resultCode: resultCode || null,
      resultText: resultText || null,
    });

    return {
      success: resultCode === '0',
      resultCode: resultCode || '1',
      resultText: resultCode === '0' ? resultText || 'success' : '16',
    };
  } catch (error) {
    logger.error('IVR hang-up call failed', {
      requestId,
      error: error.message,
    });
    return { success: false, resultCode: '1', resultText: '16' };
  }
}
