import { logger } from '../../config/logger.js';
import { sendOversizedStandardEOResponseViaKafka } from '../../services/standardEOKafkaMultipartService.js';
import { handleStandardEOAdminMenuBotQrCode } from './handlers/adminMenuBotQrCodeHandler.js';
import { handleStandardEOAdminMenuCalendar } from './handlers/adminMenuCalendarHandler.js';
import { handleStandardEOAdminMenuDashboard } from './handlers/adminMenuDashboardHandler.js';
import { handleStandardEOAdminMenuMasterData } from './handlers/adminMenuMasterDataHandler.js';
import { handleStandardEOAdminMenuProvisioning } from './handlers/adminMenuProvisioningHandler.js';
import { handleStandardEOAdminMenuReports } from './handlers/adminMenuReportsHandler.js';
import { handleStandardEOAdminMenuZohoBooks } from './handlers/adminMenuZohoBooksHandler.js';
import { handleStandardEOBotUserFind } from './handlers/botUserFindHandler.js';
import { handleStandardEOCustomerOrderLanggraph } from './langgraph/customerOrderRequestLanggraph.js';
import { handleStandardEOCustomerHistoryLink } from './handlers/customerHistoryLinkHandler.js';
import { handleStandardEOCustomerProductOrderLink } from './handlers/customerProductOrderLinkHandler.js';
import {
  handleStandardEOIvrCustomerOrderEnquiryLanggraph,
} from './langgraph/ivrCustomerConversationLanggraph.js';
import { handleStandardEOIvrCustomerBookMenu } from './handlers/ivrCustomerBookMenuHandler.js';
import { decodeBase64Value, decodeStandardEOContext } from '../../utils/standardEO.js';
import { buildStandardEOTextResponse, normalizeText } from './handlers/standardEOShared.js';

const standardEOHandlers = [
  {
    // Customer menu option 1 starts the initial LangGraph echo flow.
    questionKey: 'customer_menu',
    answerKey: 'customer_menu_ans_1',
    logMessage: 'Standard EO customer menu option 1 handler matched',
    handler: handleStandardEOCustomerOrderLanggraph,
  },
  {
    questionKey: 'bot_user_find',
    answerKey: 'bot_user_find_ans',
    logMessage: 'Standard EO bot_user_find handler matched',
    handler: handleStandardEOBotUserFind,
  },
  {
    questionKey: '',
    answerKey: 'customer_order_request_answer',
    logMessage: 'Standard EO customer order request handler matched',
    handler: handleStandardEOCustomerOrderLanggraph,
  },
  {
    questionKey: 'ivr_customer_order_enquiry',
    answerKey: 'ivr_customer_order_enquiry_ans',
    logMessage: 'Standard EO IVR customer order enquiry handler matched',
    handler: handleStandardEOIvrCustomerOrderEnquiryLanggraph,
  },
  {
    questionKey: 'ivr_customer_book_menu',
    answerKey: 'ivr_customer_book_menu_ans_1',
    logMessage: 'Standard EO IVR customer book menu handler matched for answer 1',
    handler: handleStandardEOIvrCustomerBookMenu,
  },
  {
    questionKey: 'ivr_customer_book_menu',
    answerKey: 'ivr_customer_book_menu_ans_2',
    logMessage: 'Standard EO IVR customer book menu handler matched for answer 2',
    handler: handleStandardEOIvrCustomerBookMenu,
  },
  {
    questionKey: 'iq+customer_menu',
    answerKey: 'iq+customer_menu_ans_2',
    logMessage: 'Standard EO customer history link handler matched',
    handler: handleStandardEOCustomerHistoryLink,
  },
  {
    questionKey: 'iq+customer_menu',
    answerKey: 'iq+customer_menu_ans_3',
    logMessage: 'Standard EO customer product-order link handler matched',
    handler: handleStandardEOCustomerProductOrderLink,
  },
  {
    questionKey: 'iq+admin_menu',
    answerKey: 'iq+admin_menu_ans_1',
    logMessage: 'Standard EO admin provisioning handler matched',
    handler: handleStandardEOAdminMenuProvisioning,
  },
  {
    questionKey: 'iq+admin_menu',
    answerKey: 'iq+admin_menu_ans_2',
    logMessage: 'Standard EO admin master data handler matched',
    handler: handleStandardEOAdminMenuMasterData,
  },
  {
    questionKey: 'iq+admin_menu',
    answerKey: 'iq+admin_menu_ans_3',
    logMessage: 'Standard EO admin Zoho Books handler matched',
    handler: handleStandardEOAdminMenuZohoBooks,
  },
  {
    questionKey: 'iq+admin_menu',
    answerKey: 'iq+admin_menu_ans_4',
    logMessage: 'Standard EO admin bot QR code handler matched',
    handler: handleStandardEOAdminMenuBotQrCode,
  },
  {
    questionKey: 'iq+admin_menu',
    answerKey: 'iq+admin_menu_ans_5',
    logMessage: 'Standard EO admin calendar handler matched',
    handler: handleStandardEOAdminMenuCalendar,
  },
  {
    questionKey: 'iq+admin_menu',
    answerKey: 'iq+admin_menu_ans_6',
    logMessage: 'Standard EO admin dashboard handler matched',
    handler: handleStandardEOAdminMenuDashboard,
  },
  {
    questionKey: 'iq+admin_menu',
    answerKey: 'iq+admin_menu_ans_7',
    logMessage: 'Standard EO admin reports handler matched',
    handler: handleStandardEOAdminMenuReports,
  },
];

function buildStandardEOSuccessResponse(req) {
  return buildStandardEOTextResponse(req, {
    resultText: 'success',
    fileName: '',
  });
}

function buildUnhandledKeyResponse(req) {
  return buildStandardEOTextResponse(req, {
    resultText: 'failure',
    fileName: 'unhandled key',
  });
}

function normalizeStandardEORequestBody(reqBody = {}) {
  const reqMessageObj = reqBody?.reqMessageObj ?? {};
  const normalizedReqMessageObj = {
    ...reqMessageObj,
    fromId: reqMessageObj.fromId == null ? '' : String(reqMessageObj.fromId).trim(),
  };

  return {
    ...reqBody,
    reqMessageObj: normalizedReqMessageObj,
  };
}

function getStandardEOUiContent(response = {}) {
  return decodeBase64Value(response?.resMessageObj?.fileName);
}

export async function handleStandardEOService(req, res, next) {
  try {
    // EO routing selects one business handler from decoded question/answer keys.
    // The selected handler then owns the rest of the business workflow.
    req.body = normalizeStandardEORequestBody(req.body);
    const reqMessageObj = req.body?.reqMessageObj ?? {};
    const botUserId = req.body?.botUserId ?? null;
    const decodedContext = decodeStandardEOContext(req.body?.context ?? {});
    const questionKey = normalizeText(decodedContext.decodedQuestionKey);
    const answerKey = normalizeText(decodedContext.decodedAnswerKey);
    req.logFlowStep?.('eo_request_decoded', {
      questionKey: questionKey || null,
      answerKey: answerKey || null,
    });

    logger.info('Standard EO service request received', {
      requestId: req.requestId,
      botUserId,
      taskId: reqMessageObj.taskId ?? null,
      signalId: reqMessageObj.signalId ?? null,
      questionKey: questionKey || null,
      answerKey: answerKey || null,
      fromId: reqMessageObj.fromId ?? null,
    });
    logger.info('Standard EO request payload', {
      requestId: req.requestId,
      botUserId,
      requestPayload: req.body,
      decodedContext,
    });

    const matchedHandler =
      standardEOHandlers.find(
        (entry) => entry.questionKey === questionKey && entry.answerKey === answerKey,
      ) ||
      standardEOHandlers.find(
        (entry) => !entry.questionKey && entry.answerKey === answerKey,
      );

    let baseResponse;

    if (!matchedHandler) {
      logger.warn('Standard EO handler not found', {
        requestId: req.requestId,
        botUserId,
        taskId: reqMessageObj.taskId ?? null,
        signalId: reqMessageObj.signalId ?? null,
        questionKey: questionKey || null,
        answerKey: answerKey || null,
        fromId: reqMessageObj.fromId ?? null,
      });

      baseResponse = buildUnhandledKeyResponse(req);
    } else {
      req.logFlowStep?.('eo_handler_selected', {
        handler: matchedHandler.handler.name || 'anonymous_handler',
        questionKey: matchedHandler.questionKey || null,
        answerKey: matchedHandler.answerKey,
      });
      logger.info(matchedHandler.logMessage, {
        requestId: req.requestId,
        botUserId,
        taskId: reqMessageObj.taskId ?? null,
        signalId: reqMessageObj.signalId ?? null,
        fromId: reqMessageObj.fromId ?? null,
      });

      baseResponse = await matchedHandler.handler(req);
    }

    const response = await sendOversizedStandardEOResponseViaKafka({
      requestId: req.requestId,
      reqMessageObj,
      botUserId,
      response: baseResponse,
    });
    req.logFlowStep?.('eo_response_ready', {
      resultText: response?.resultText ?? null,
      eoState: response?.eoState ?? null,
      responseSignalId: response?.resMessageObj?.signalId ?? null,
    });

    logger.info('Standard EO response payload', {
      requestId: req.requestId,
      botUserId,
      taskId: reqMessageObj.taskId ?? null,
      parentSignalId: reqMessageObj.signalId ?? null,
      responseSignalId: response?.resMessageObj?.signalId ?? null,
      resultCode: response?.resultCode ?? null,
      resultText: response?.resultText ?? null,
      eoState: response?.eoState ?? null,
      // Keep both forms so we can verify the API payload and the UI-visible text.
      responsePayload: response,
      uiContent: getStandardEOUiContent(response),
      uiContentEscaped: JSON.stringify(getStandardEOUiContent(response)),
    });

    return res.status(200).json(response);
  } catch (error) {
    return next(error);
  }
}
