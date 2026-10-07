import { ensureCustomerExistsForCybotUser } from '../../../services/customerAutoCreateService.js';
import { buildCustomerHistoryUrl } from '../../../services/customerHistoryLinkService.js';
import { buildStandardEOTextResponse, normalizeText } from './standardEOShared.js';

export async function handleStandardEOCustomerHistoryLink(req) {
  const reqMessageObj = req.body?.reqMessageObj ?? {};
  const botUserId = req.body?.botUserId ?? '';
  const tenant = req.tenant ?? {};
  const fromId = normalizeText(reqMessageObj.fromId);
  const databaseName =
    normalizeText(reqMessageObj.databaseName) || normalizeText(tenant?.databaseName);

  const customerResolution = await ensureCustomerExistsForCybotUser({
    tenantDb: req.tenantDb,
    tenant,
    botUserId,
    databaseName,
    cybotUserId: fromId,
  });

  const historyUrl = buildCustomerHistoryUrl(
    tenant?.botMasterKey || {},
    customerResolution?.customer || {},
  );

  return buildStandardEOTextResponse(req, {
    resultText: 'success',
    fileName: historyUrl === '#' ? '' : historyUrl,
  });
}
