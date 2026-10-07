import { logger } from '../../config/logger.js';
import { buildEoResposne } from '../../utils/eoResponse/buildEOResponse.js';

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function resolveResponseFromId(reqMessageObj = {}, botUserId = '') {
  return String(reqMessageObj.toId || botUserId || '').trim();
}

function hasIvrCallFields(reqMessageObj = {}) {
  return Boolean(
    String(reqMessageObj.botMobNo || '').trim() &&
    String(reqMessageObj.userMobNo || '').trim() &&
    String(reqMessageObj.callSId || '').trim()
  );
}

function resolveIvrVoiceResultText(reqMessageObj = {}) {
  return hasIvrCallFields(reqMessageObj) || normalizeText(reqMessageObj.channel) === 'voice'
    ? '8'
    : 'success';
}

function normalizeIvrVoiceInitRequestBody(reqBody = {}) {
  const reqMessageObj = reqBody?.reqMessageObj ?? {};

  return {
    ...reqBody,
    reqMessageObj: {
      ...reqMessageObj,
      fromId: reqMessageObj.fromId == null ? '' : String(reqMessageObj.fromId).trim(),
    },
  };
}

function buildIvrVoiceInitSuccessResponse(req) {
  const reqMessageObj = req.body?.reqMessageObj ?? {};
  const botUserId = req.body?.botUserId ?? '';

  return buildEoResposne({
    resultCode: '0',
    resultText: resolveIvrVoiceResultText(reqMessageObj),
    reqMessageObj,
    eoState: 'stop',
    resMessageObj: {
      taskId: reqMessageObj.taskId ?? '',
      fromId: resolveResponseFromId(reqMessageObj, botUserId),
      mimeType: 'text',
    },
    fileName: '',
  });
}

export async function handleIvrVoiceCallInit(req, res, next) {
  try {
    // This handshake only tells EO which IVR flow to continue; it does not invoke LangGraph.
    req.logFlowStep?.('ivr_voice_init_started');
    req.body = normalizeIvrVoiceInitRequestBody(req.body);
    const reqMessageObj = req.body?.reqMessageObj ?? {};
    const taskId = reqMessageObj.taskId ?? null;
    const signalId = reqMessageObj.signalId ?? null;
    const botUserId = req.body?.botUserId ?? null;
    const isVoiceChannel = normalizeText(reqMessageObj.channel) === 'voice';
    const hasVoiceCallFields = hasIvrCallFields(reqMessageObj);
    req.logFlowStep?.('ivr_voice_init_request_normalized', {
      isVoiceChannel,
      hasVoiceCallFields,
    });

    logger.info('IVR voice call init controller started', {
      requestId: req.requestId,
      botUserId,
      signalId,
      taskId,
    });

    logger.info('IVR voice call request context resolved', {
      requestId: req.requestId,
      botUserId,
      signalId,
      taskId,
      fromId: reqMessageObj.fromId ?? null,
      toId: reqMessageObj.toId ?? null,
      channel: reqMessageObj.channel ?? null,
      databaseName: reqMessageObj.databaseName ?? null,
      botMobNo: reqMessageObj.botMobNo ?? null,
      userMobNo: reqMessageObj.userMobNo ?? null,
      callSId: reqMessageObj.callSId ?? null,
      isVoiceChannel,
      hasVoiceCallFields,
    });

    logger.info('IVR voice call request payload', {
      requestId: req.requestId,
      botUserId,
      requestPayload: req.body,
    });

    const response = buildIvrVoiceInitSuccessResponse(req);
    req.logFlowStep?.('ivr_voice_init_response_composed', {
      resultText: response.resultText,
      eoState: response.eoState,
    });

    logger.info('IVR voice call EO response prepared', {
      requestId: req.requestId,
      botUserId,
      taskId,
      parentSignalId: signalId,
      responseFromId: response.resMessageObj.fromId ?? null,
      responseTaskId: response.resMessageObj.taskId ?? null,
      responseMimeType: response.resMessageObj.mimeType ?? null,
      resolvedResultText: response.resultText,
    });

    logger.info('IVR voice call init response generated', {
      requestId: req.requestId,
      parentSignalId: signalId,
      responseSignalId: response.resMessageObj.signalId,
      resultCode: response.resultCode,
      resultText: response.resultText,
      eoState: response.eoState,
    });

    logger.info('IVR voice call response payload', {
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
