import { logger } from '../../../config/logger.js';
import { ensureCustomerForConversation } from '../../../services/customerConversationService.js';
import { decodeStandardEOContext } from '../../../utils/standardEO.js';
import { buildStandardEOIvrTextResponse } from './standardEOShared.js';
import { handleStandardEOIvrCustomerMultipleOrderLink } from '../langgraph/ivrCustomerConversationLanggraph.js';

export async function handleStandardEOIvrCustomerBookMenu(req) {
  const reqMessageObj = req.body?.reqMessageObj ?? {};
  const botUserId = req.body?.botUserId ?? '';
  const tenant = req.tenant ?? {};
  const tenantDb = req.tenantDb;
  const cybotUserId = String(reqMessageObj.fromId || '').trim();
  const databaseName =
    String(reqMessageObj.databaseName || tenant?.botMasterKey?.databaseName || '').trim();

  const customerResolution = await ensureCustomerForConversation({
    tenantDb,
    tenant,
    botUserId,
    databaseName,
    cybotUserId,
  });

  logger.info('IVR customer book menu customer ensured', {
    requestId: req.requestId,
    botUserId,
    taskId: reqMessageObj.taskId ?? null,
    signalId: reqMessageObj.signalId ?? null,
    fromId: reqMessageObj.fromId ?? null,
    customerCreated: customerResolution.created,
    customerFound: Boolean(customerResolution.customer),
    lookupFound: customerResolution.lookupFound,
    customerCode: customerResolution.customer?.customerCode ?? null,
    customerEmail: customerResolution.customer?.email ?? null,
  });

  const answerKey = decodeStandardEOContext(req.body?.context ?? {}).decodedAnswerKey;
  if (answerKey === 'ivr_customer_book_menu_ans_2') {
    return handleStandardEOIvrCustomerMultipleOrderLink(req);
  }

  return buildStandardEOIvrTextResponse(req, {
    resultText: 'success',
    fileName: '',
    eoState: 'stop',
  });
}
