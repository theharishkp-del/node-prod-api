import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { MASTER_DATA_CUSTOMERS_COLLECTION } from '../models/tenant/masterDataCustomerModel.js';
import { postJson } from '../utils/httpClient.js';
import { decodeBase64Value } from '../utils/standardEO.js';

const MAIL_BRIDGE_SMS_TRACKING_COLLECTION = 'mail_bridge_sms_tracking';
const DEFAULT_SMS_AGENT = 'csm';
const DEFAULT_SMS_PLATFORM = 'asecc';

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeId(value) {
  return value == null ? '' : String(value).trim();
}

function normalizePhoneStyleEmailId(value) {
  const normalizedValue = normalizeText(value);
  const normalizedSuffix = normalizeText(env.userCheckPhoneNumberSuffix || '_CyBot_WORLD');

  if (!normalizedValue || normalizedValue.includes('@')) {
    return normalizedValue;
  }

  if (!normalizedValue.endsWith(normalizedSuffix)) {
    return normalizedValue;
  }

  const phonePortion = normalizedValue.slice(0, -normalizedSuffix.length);

  if (phonePortion.includes('_')) {
    return normalizedValue;
  }

  const match = phonePortion.match(/^(\+\d{1,3})(\d+)$/);
  if (!match) {
    return normalizedValue;
  }

  const [, countryCode, phoneNumber] = match;
  return `${countryCode}_${phoneNumber}${normalizedSuffix}`;
}

function extractPhoneNumberFromPhoneStyleEmail(value) {
  const normalizedValue = normalizePhoneStyleEmailId(value);
  const normalizedSuffix = normalizeText(env.userCheckPhoneNumberSuffix || '_CyBot_WORLD');

  if (!normalizedValue || normalizedValue.includes('@') || !normalizedValue.endsWith(normalizedSuffix)) {
    return '';
  }

  const phonePortion = normalizedValue.slice(0, -normalizedSuffix.length);
  const match = phonePortion.match(/^(\+\d{1,3})_(\d+)$/);

  if (!match) {
    return '';
  }

  return `${match[1]}${match[2]}`;
}

function isTextMimeType(mimeType) {
  const normalizedMimeType = normalizeText(mimeType).toLowerCase();

  return (
    normalizedMimeType === 'text' ||
    normalizedMimeType === 'plain' ||
    normalizedMimeType === 'html' ||
    normalizedMimeType.startsWith('text/')
  );
}

function normalizeWidgetPayload(payload = {}) {
  return {
    userId: normalizeId(payload.userId),
    taskId: normalizeText(payload.taskId),
    emailId: normalizePhoneStyleEmailId(payload.emailId),
    botDatabaseName: normalizeText(payload.botDatabaseName),
    brandType: normalizeText(payload.brandType || env.widgetBrandType || 'cybot'),
    databaseName: normalizeText(payload.databaseName),
  };
}

function encodeWidgetAssistantPayload(payload = {}) {
  return Buffer.from(
    JSON.stringify(normalizeWidgetPayload(payload)),
    'utf8',
  ).toString('base64');
}

async function resolveCustomerWidgetEmailId(tenantDb, reqMessageObj = {}) {
  if (!tenantDb) {
    return '';
  }

  const cybotUserId = normalizeText(reqMessageObj.fromId);
  const userMobNo = normalizeText(reqMessageObj.userMobNo).replace(/\s+/g, '');

  if (!cybotUserId && !userMobNo) {
    return '';
  }

  const filters = [
    { isDeleted: { $ne: true } },
  ];

  if (cybotUserId) {
    filters.push({ cybotUserId });
  }

  if (userMobNo) {
    filters.push({ email: normalizePhoneStyleEmailId(`${userMobNo}${normalizeText(env.userCheckPhoneNumberSuffix || '_CyBot_WORLD')}`) });
    filters.push({ phone: userMobNo.replace(/^\+\d{1,3}/, '') });
    filters.push({ mobile: userMobNo.replace(/^\+\d{1,3}/, '') });
  }

  const customer = await tenantDb.collection(MASTER_DATA_CUSTOMERS_COLLECTION).findOne({
    $and: [
      { isDeleted: { $ne: true } },
      {
        $or: filters.filter((entry, index) => index > 0),
      },
    ],
  });

  return normalizePhoneStyleEmailId(customer?.email);
}

async function resolveCustomerSmsDestination(tenantDb, reqMessageObj = {}) {
  if (!tenantDb) {
    return '';
  }

  const cybotUserId = normalizeText(reqMessageObj.fromId);
  const fromEmail = normalizePhoneStyleEmailId(reqMessageObj.fromEmail);

  if (!cybotUserId && !fromEmail) {
    return '';
  }

  const filters = [];

  if (cybotUserId) {
    filters.push({ cybotUserId });
  }

  if (fromEmail) {
    filters.push({ email: fromEmail });
  }

  if (!filters.length) {
    return '';
  }

  const customer = await tenantDb.collection(MASTER_DATA_CUSTOMERS_COLLECTION).findOne({
    isDeleted: { $ne: true },
    $or: filters,
  });

  if (!customer) {
    return '';
  }

  const mobileCountryCode = normalizeText(customer?.mobileCountryCode || customer?.phoneCountryCode);
  const mobileNumber = normalizeText(customer?.mobile || customer?.phone).replace(/\s+/g, '');

  if (mobileCountryCode && mobileNumber) {
    return `${mobileCountryCode}${mobileNumber}`;
  }

  return extractPhoneNumberFromPhoneStyleEmail(customer?.email);
}

async function buildWidgetUserEmailId(reqMessageObj = {}, tenantDb = null) {
  const customerEmail = await resolveCustomerWidgetEmailId(tenantDb, reqMessageObj);
  if (customerEmail) {
    return customerEmail;
  }

  const fromEmail = normalizePhoneStyleEmailId(reqMessageObj.fromEmail);
  if (fromEmail) {
    return fromEmail;
  }

  const userMobNo = normalizeText(reqMessageObj.userMobNo);
  if (!userMobNo) {
    return '';
  }

  if (userMobNo.includes('@')) {
    return userMobNo;
  }

  return normalizePhoneStyleEmailId(
    `${userMobNo}${normalizeText(env.userCheckPhoneNumberSuffix || '_CyBot_WORLD')}`,
  );
}

export function buildWidgetAssistantDetailsUrl(payload = {}) {
  const widgetBaseUrl = normalizeText(env.widgetBaseUrl).replace(/[\/;]+$/, '');
  const aiAssistantDetailsPath = normalizeText(env.widgetAiAssistantDetailsPath).replace(/^[/#]+/, '');
  const encodedKey = encodeWidgetAssistantPayload(payload);

  if (!widgetBaseUrl || !aiAssistantDetailsPath || !encodedKey) {
    return '#';
  }

  return `${widgetBaseUrl}/#/${aiAssistantDetailsPath};key=${encodedKey}`;
}

export function isEmailViaMailBridgeChannel(reqBody = {}) {
  return normalizeText(reqBody?.reqMessageObj?.channel).toLowerCase() === 'emailviamailbridge';
}

export function isSmsViaMailBridgeChannel(reqBody = {}) {
  const channel = normalizeText(reqBody?.reqMessageObj?.channel).toLowerCase();
  return channel === 'smsviamailbridge' || channel === 'smsmailbridge';
}

export function hasVoiceCallFields(reqBody = {}) {
  const reqMessageObj = reqBody?.reqMessageObj ?? {};

  return Boolean(
    normalizeText(reqMessageObj.botMobNo) &&
    normalizeText(reqMessageObj.userMobNo) &&
    normalizeText(reqMessageObj.callSId),
  );
}

export function isVoiceLinkSmsChannel(reqBody = {}) {
  const channel = normalizeText(reqBody?.reqMessageObj?.channel).toLowerCase();
  return channel === 'voice' || hasVoiceCallFields(reqBody);
}

async function buildWidgetAssistantPayloadFromRequest(reqBody = {}, tenantDb = null) {
  const reqMessageObj = reqBody?.reqMessageObj ?? {};
  const rawUserId = reqMessageObj.fromId;
  const normalizedUserId = normalizeId(rawUserId);
  const payload = {
    emailId: await buildWidgetUserEmailId(reqMessageObj, tenantDb),
    userId: normalizedUserId,
    taskId: normalizeText(reqMessageObj.taskId),
    databaseName: normalizeText(reqMessageObj.databaseName),
    botDatabaseName: normalizeText(reqBody?.botDatabaseName),
    brandType: normalizeText(env.widgetBrandType || 'cybot'),
  };

  logger.info('Widget assistant payload formed', {
    rawUserId: rawUserId ?? null,
    rawUserIdType: rawUserId == null ? 'nullish' : typeof rawUserId,
    normalizedUserId: normalizedUserId || null,
    normalizedUserIdType: typeof payload.userId,
    taskId: payload.taskId || null,
    databaseName: payload.databaseName || null,
  });

  return payload;
}

async function buildAssistantLinkCta(response = {}, reqBody = {}, tenantDb = null) {
  const mimeType = normalizeText(response?.resMessageObj?.mimeType || reqBody?.reqMessageObj?.mimeType);
  if (!isTextMimeType(mimeType)) {
    return '';
  }

  const widgetUrl = buildWidgetAssistantDetailsUrl(await buildWidgetAssistantPayloadFromRequest(reqBody, tenantDb));
  if (widgetUrl === '#') {
    return '';
  }

  const currentFileName = decodeBase64Value(response?.resMessageObj?.fileName || '');
  const ctaBlock = [
    'To continue in the chat session to complete the order, click here:',
    widgetUrl,
  ].join('\n');

  return currentFileName
    ? `${currentFileName}\n\n${ctaBlock}`
    : ctaBlock;
}

export async function appendWidgetAssistantLinkToEmailResponse(response = {}, reqBody = {}, tenantDb = null) {
  if (!isEmailViaMailBridgeChannel(reqBody)) {
    return response;
  }

  const ctaText = await buildAssistantLinkCta(response, reqBody, tenantDb);
  if (!ctaText) {
    return response;
  }

  return {
    ...response,
    resMessageObj: {
      ...response.resMessageObj,
      customMessage: ctaText,
    },
  };
}

export async function appendWidgetAssistantLinkToSmsBridgeResponse(response = {}, reqBody = {}, tenantDb = null) {
  if (!isSmsViaMailBridgeChannel(reqBody)) {
    return response;
  }

  const widgetUrl = buildWidgetAssistantDetailsUrl(await buildWidgetAssistantPayloadFromRequest(reqBody, tenantDb));
  if (widgetUrl === '#') {
    return response;
  }

  return {
    ...response,
    resMessageObj: {
      ...response.resMessageObj,
      customMessage: widgetUrl,
    },
  };
}

async function buildMailBridgeSmsText(reqBody = {}, tenantDb = null) {
  const widgetUrl = buildWidgetAssistantDetailsUrl(await buildWidgetAssistantPayloadFromRequest(reqBody, tenantDb));
  if (widgetUrl === '#') {
    return '';
  }

  return `To continue in the chat session to complete the order, click here:\n${widgetUrl}`;
}

function resolveSmsFromId({ reqMessageObj = {}, botUserId = '' } = {}) {
  return normalizeText(reqMessageObj.toId) || normalizeText(botUserId) || normalizeText(reqMessageObj.fromId);
}

async function resolveSmsDestination(tenantDb, reqMessageObj = {}) {
  const directUserMobNo = normalizeText(reqMessageObj.userMobNo).replace(/\s+/g, '');
  if (directUserMobNo) {
    return directUserMobNo;
  }

  const phoneFromEmail = extractPhoneNumberFromPhoneStyleEmail(reqMessageObj.fromEmail);
  if (phoneFromEmail) {
    return phoneFromEmail;
  }

  const customerDestination = await resolveCustomerSmsDestination(tenantDb, reqMessageObj);
  if (customerDestination) {
    return customerDestination;
  }

  return normalizeText(reqMessageObj.fromId);
}

function getIsSendFullContent(msgContent, threshold = 160) {
  if (msgContent == null) {
    return 'false';
  }

  return String(msgContent).trim().length > threshold ? 'true' : 'false';
}

export async function sendMailBridgeAssistantLinkSmsOnce({
  tenantDb,
  reqBody = {},
  botUserId = '',
  sessionId = '',
  requestId = '',
} = {}) {
  const isSmsMailBridge = isSmsViaMailBridgeChannel(reqBody);
  const isVoiceChannel = isVoiceLinkSmsChannel(reqBody);

  if (!isSmsMailBridge && !isVoiceChannel) {
    return { attempted: false, sent: false, reason: 'not_supported_sms_channel' };
  }

  const reqMessageObj = reqBody?.reqMessageObj ?? {};
  const taskId = normalizeText(reqMessageObj.taskId);
  const fromId =
    normalizeText(reqMessageObj.botMobNo) ||
    resolveSmsFromId({ reqMessageObj, botUserId });
  const userMobNo = await resolveSmsDestination(tenantDb, reqMessageObj);
  const databaseName = normalizeText(reqMessageObj.databaseName);
  const smsServiceUrl = normalizeText(env.cybotPhoneSmsService);
  const msgContent = await buildMailBridgeSmsText(reqBody, tenantDb);
  const referenceId =
    normalizeText(reqMessageObj.callSId) ||
    normalizeText(reqMessageObj.signalId) ||
    normalizeText(reqMessageObj.parentId) ||
    normalizeText(reqMessageObj.taskId);
  const smsType = isVoiceChannel ? 'voice_completion_link' : 'mail_bridge_completion_link';

  if (!tenantDb || !sessionId || !taskId || !referenceId || !fromId || !userMobNo || !databaseName || !smsServiceUrl || !msgContent) {
    logger.info('Assistant link SMS skipped', {
      requestId,
      sessionId: sessionId || null,
      taskId: taskId || null,
      referenceId: referenceId || null,
      channel: normalizeText(reqMessageObj.channel) || null,
      reason: !tenantDb
        ? 'missing_tenant_db'
        : !sessionId
          ? 'missing_session_id'
          : !taskId
            ? 'missing_task_id'
            : !referenceId
              ? 'missing_reference_id'
            : !fromId
              ? 'missing_from_id'
              : !userMobNo
                ? 'missing_user_mobile'
                : !databaseName
                  ? 'missing_database_name'
                  : !smsServiceUrl
                    ? 'missing_sms_service_url'
                    : 'missing_completion_link',
    });

    return { attempted: false, sent: false, reason: 'missing_required_fields' };
  }

  const trackingCollection = tenantDb.collection(MAIL_BRIDGE_SMS_TRACKING_COLLECTION);
  const now = new Date();
  const claimResult = await trackingCollection.updateOne(
    {
      sessionId,
      taskId,
      referenceId,
      fromId,
      smsType,
    },
    {
      $setOnInsert: {
        sessionId,
        taskId,
        referenceId,
        fromId,
        smsType,
        databaseName,
        userMobNo,
        createdAt: now,
      },
      $set: {
        updatedAt: now,
        status: 'sending',
      },
    },
    { upsert: true },
  );

  if (claimResult.upsertedCount !== 1) {
    logger.info('Assistant link SMS already tracked', {
      requestId,
      sessionId,
      taskId,
      referenceId,
      fromId,
      smsType,
    });
    return { attempted: false, sent: false, reason: 'already_sent' };
  }

  const payload = {
    fromId,
    platform: DEFAULT_SMS_PLATFORM,
    agent: DEFAULT_SMS_AGENT,
    databaseName,
    userMobNo,
    msgContent,
    isSendFullContent: getIsSendFullContent(msgContent),
  };

  logger.info('Mail bridge completion SMS payload prepared', {
    requestId,
    sessionId,
    taskId,
    referenceId,
    smsType,
    payload,
  });

  try {
    const response = await postJson(
      smsServiceUrl,
      payload,
      {
        requestId,
        label: 'Mail bridge completion SMS',
      },
    );
    logger.info('Mail bridge completion SMS response received', {
      requestId,
      payload,
      responseBody: response,
    });
    const resultCode = normalizeText(response?.resultCode);
    const resultText = normalizeText(response?.resultText);

    if (resultCode && resultCode !== '0') {
      const providerErrorMessage = resultText || `SMS service rejected payload with resultCode ${resultCode}.`;

      await trackingCollection.updateOne(
        {
          sessionId,
          taskId,
          referenceId,
          fromId,
          smsType,
        },
        {
          $set: {
            status: 'failed',
            updatedAt: new Date(),
            lastResponse: response ?? null,
            lastError: providerErrorMessage,
            msgContent,
          },
          $unset: {
            sentAt: '',
          },
        },
      );

      return { attempted: true, sent: false, reason: 'provider_rejected', errorMessage: providerErrorMessage };
    }

    await trackingCollection.updateOne(
      {
        sessionId,
        taskId,
        referenceId,
        fromId,
        smsType,
      },
      {
        $set: {
          status: 'sent',
          sentAt: new Date(),
          updatedAt: new Date(),
          lastResponse: response ?? null,
          msgContent,
        },
      },
    );

    return { attempted: true, sent: true, reason: 'sent' };
  } catch (error) {
    const errorMessage = error?.response?.data?.message || error?.message || 'Unknown SMS error';

    await trackingCollection.updateOne(
      {
        sessionId,
        taskId,
        referenceId,
        fromId,
        smsType,
      },
      {
        $set: {
          status: 'failed',
          updatedAt: new Date(),
          lastError: errorMessage,
          msgContent,
        },
      },
    );

    logger.warn('Assistant link SMS failed', {
      requestId,
      sessionId,
      taskId,
      referenceId,
      fromId,
      userMobNo,
      message: errorMessage,
    });

    return { attempted: true, sent: false, reason: 'send_failed', errorMessage };
  }
}

export async function sendTransactionalSmsOnce({
  tenantDb,
  reqBody = {},
  botUserId = '',
  sessionId = '',
  requestId = '',
  smsType = '',
  referenceId = '',
  msgContent = '',
} = {}) {
  const isSmsMailBridge = isSmsViaMailBridgeChannel(reqBody);
  const isVoiceChannel = isVoiceLinkSmsChannel(reqBody);

  if (!isSmsMailBridge && !isVoiceChannel) {
    return { attempted: false, sent: false, reason: 'not_supported_sms_channel' };
  }

  const reqMessageObj = reqBody?.reqMessageObj ?? {};
  const taskId = normalizeText(reqMessageObj.taskId);
  const fromId =
    normalizeText(reqMessageObj.botMobNo) ||
    resolveSmsFromId({ reqMessageObj, botUserId });
  const userMobNo = await resolveSmsDestination(tenantDb, reqMessageObj);
  const databaseName = normalizeText(reqMessageObj.databaseName);
  const smsServiceUrl = normalizeText(env.cybotPhoneSmsService);
  const normalizedReferenceId = normalizeText(referenceId);
  const normalizedSmsType = normalizeText(smsType) || 'transactional';
  const normalizedContent = normalizeText(msgContent);

  if (!env.ivrSmsSendEnabled) {
    logger.info('Transactional SMS skipped because IVR SMS sending is disabled', {
      requestId,
      sessionId: sessionId || null,
      taskId: taskId || null,
      referenceId: normalizedReferenceId || null,
      smsType: normalizedSmsType,
      preview: normalizedContent || null,
    });

    return { attempted: false, sent: false, reason: 'ivr_sms_disabled' };
  }

  if (!tenantDb || !sessionId || !taskId || !normalizedReferenceId || !fromId || !userMobNo || !databaseName || !smsServiceUrl || !normalizedContent) {
    logger.info('Transactional SMS skipped', {
      requestId,
      sessionId: sessionId || null,
      taskId: taskId || null,
      referenceId: normalizedReferenceId || null,
      smsType: normalizedSmsType || null,
    });

    return { attempted: false, sent: false, reason: 'missing_required_fields' };
  }

  const trackingCollection = tenantDb.collection(MAIL_BRIDGE_SMS_TRACKING_COLLECTION);
  const now = new Date();
  const claimResult = await trackingCollection.updateOne(
    {
      sessionId,
      taskId,
      referenceId: normalizedReferenceId,
      fromId,
      smsType: normalizedSmsType,
    },
    {
      $setOnInsert: {
        sessionId,
        taskId,
        referenceId: normalizedReferenceId,
        fromId,
        smsType: normalizedSmsType,
        databaseName,
        userMobNo,
        createdAt: now,
      },
      $set: {
        updatedAt: now,
        status: 'sending',
      },
    },
    { upsert: true },
  );

  if (claimResult.upsertedCount !== 1) {
    return { attempted: false, sent: false, reason: 'already_sent' };
  }

  const payload = {
    fromId,
    platform: DEFAULT_SMS_PLATFORM,
    agent: DEFAULT_SMS_AGENT,
    databaseName,
    userMobNo,
    msgContent: normalizedContent,
    isSendFullContent: getIsSendFullContent(normalizedContent),
  };

  try {
    const response = await postJson(
      smsServiceUrl,
      payload,
      {
        requestId,
        label: 'Transactional SMS',
      },
    );
    const resultCode = normalizeText(response?.resultCode);
    const resultText = normalizeText(response?.resultText);

    if (resultCode && resultCode !== '0') {
      const providerErrorMessage = resultText || `SMS service rejected payload with resultCode ${resultCode}.`;

      await trackingCollection.updateOne(
        {
          sessionId,
          taskId,
          referenceId: normalizedReferenceId,
          fromId,
          smsType: normalizedSmsType,
        },
        {
          $set: {
            status: 'failed',
            updatedAt: new Date(),
            lastResponse: response ?? null,
            lastError: providerErrorMessage,
            msgContent: normalizedContent,
          },
          $unset: {
            sentAt: '',
          },
        },
      );

      return { attempted: true, sent: false, reason: 'provider_rejected', errorMessage: providerErrorMessage };
    }

    await trackingCollection.updateOne(
      {
        sessionId,
        taskId,
        referenceId: normalizedReferenceId,
        fromId,
        smsType: normalizedSmsType,
      },
      {
        $set: {
          status: 'sent',
          sentAt: new Date(),
          updatedAt: new Date(),
          lastResponse: response ?? null,
          msgContent: normalizedContent,
        },
      },
    );

    return { attempted: true, sent: true, reason: 'sent' };
  } catch (error) {
    const errorMessage = error?.response?.data?.message || error?.message || 'Unknown SMS error';

    await trackingCollection.updateOne(
      {
        sessionId,
        taskId,
        referenceId: normalizedReferenceId,
        fromId,
        smsType: normalizedSmsType,
      },
      {
        $set: {
          status: 'failed',
          updatedAt: new Date(),
          lastError: errorMessage,
          msgContent: normalizedContent,
        },
      },
    );

    return { attempted: true, sent: false, reason: 'send_failed', errorMessage };
  }
}
