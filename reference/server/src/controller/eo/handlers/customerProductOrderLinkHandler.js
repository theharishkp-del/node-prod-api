import { ensureCustomerExistsForCybotUser } from '../../../services/customerAutoCreateService.js';
import { syncCustomerToZoho } from '../../../services/masterDataService.js';
import { createProductOrderLink } from '../../../services/productOrderLinkService.js';
import { getCustomerTierMultiplier } from '../../../utils/tierPricing.js';
import { buildStandardEOTextResponse, normalizeText } from './standardEOShared.js';

function getCustomerId(customer = {}) {
  return normalizeText(customer.id || customer._id?.toString?.() || customer._id);
}

function isCustomerSyncedToZoho(customer = {}) {
  return (
    Boolean(normalizeText(customer.zohoCustomerId))
    && normalizeText(customer.zohoSyncStatus).toLowerCase() === 'synced'
  );
}

export async function handleStandardEOCustomerProductOrderLink(req) {
  const reqMessageObj = req.body?.reqMessageObj ?? {};
  const botUserId = normalizeText(req.body?.botUserId);
  const tenant = req.tenant ?? {};
  const databaseName =
    normalizeText(reqMessageObj.databaseName) || normalizeText(tenant?.databaseName);

  const customerResolution = await ensureCustomerExistsForCybotUser({
    tenantDb: req.tenantDb,
    tenant,
    botUserId,
    databaseName,
    cybotUserId: normalizeText(reqMessageObj.fromId),
  });

  if (!customerResolution?.customer) {
    return buildStandardEOTextResponse(req, {
      resultText: 'failure',
      fileName: 'Unable to identify the customer for product ordering.',
    });
  }

  let customer = customerResolution.customer;

  if (!isCustomerSyncedToZoho(customer)) {
    const customerId = getCustomerId(customer);
    req.logFlowStep?.('eo_customer_zoho_sync_started', {
      customerId,
      cybotUserId: normalizeText(reqMessageObj.fromId),
    });

    customer = await syncCustomerToZoho({
      tenantDb: req.tenantDb,
      tenant,
      botUserId,
      botMasterKey: tenant?.botMasterKey || {},
      customerId,
    });

    req.logFlowStep?.('eo_customer_zoho_sync_completed', {
      customerId: getCustomerId(customer),
      zohoCustomerId: normalizeText(customer?.zohoCustomerId) || null,
    });
  }

  const tierMultiplier = await getCustomerTierMultiplier(req.tenantDb, customer);
  const productOrderLink = await createProductOrderLink({
    tenant,
    botUserId,
    customer,
    tierMultiplier,
    reqMessageObj,
  });

  return buildStandardEOTextResponse(req, {
    resultText: 'success',
    fileName: productOrderLink.url,
  });
}
