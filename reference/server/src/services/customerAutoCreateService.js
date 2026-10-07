import { logger } from '../config/logger.js';
import { MASTER_DATA_CUSTOMERS_COLLECTION } from '../models/tenant/masterDataCustomerModel.js';
import { fetchCybotUserDetails } from './cybotUserLookupService.js';
import { createCustomer } from './masterDataService.js';

function normalizeText(value) {
  return String(value || '').trim();
}

function buildCustomerDisplayName(userDetails = {}, cybotUserId = '') {
  const firstName = normalizeText(userDetails.firstName);
  const lastName = normalizeText(userDetails.lastName);
  const fullName = `${firstName} ${lastName}`.trim();

  if (fullName) {
    return fullName;
  }

  return (
    normalizeText(userDetails.userName) ||
    normalizeText(userDetails.uniqueName) ||
    normalizeText(userDetails.emailId) ||
    normalizeText(userDetails.phoneNumber) ||
    normalizeText(cybotUserId) ||
    'Customer'
  );
}

function buildCustomerCreatePayload({ userDetails, cybotUserId, tenant }) {
  return {
    customerType: 'individual',
    displayName: buildCustomerDisplayName(userDetails, cybotUserId),
    companyName: null,
    email: normalizeText(userDetails.emailId) || null,
    phoneCountryCode: normalizeText(userDetails.countryCode) || null,
    phone: normalizeText(userDetails.phoneNumber) || null,
    mobileCountryCode: normalizeText(userDetails.countryCode) || null,
    mobile: normalizeText(userDetails.phoneNumber) || null,
    billingAddress: '',
    shippingAddress: null,
    currencyCode: normalizeText(tenant?.companyDetails?.currency) || null,
    paymentTerms: null,
    status: 'active',
    cybotUserId: normalizeText(cybotUserId) || null,
    isCybotRegister: true,
  };
}

export async function ensureCustomerExistsForCybotUser({
  tenantDb,
  tenant,
  botUserId,
  databaseName,
  cybotUserId,
} = {}) {
  const normalizedCybotUserId = normalizeText(cybotUserId);

  if (!tenantDb || !normalizedCybotUserId) {
    return {
      customer: null,
      created: false,
      lookupFound: false,
      skipped: true,
    };
  }

  const existingCustomer = await tenantDb.collection(MASTER_DATA_CUSTOMERS_COLLECTION).findOne({
    tenantId: normalizeText(tenant?.tenantId),
    cybotUserId: normalizedCybotUserId,
    isDeleted: { $ne: true },
  });

  if (existingCustomer) {
    logger.info('Customer already exists for cybot user', {
      botUserId,
      tenantId: tenant?.tenantId || null,
      cybotUserId: normalizedCybotUserId,
      customerId: existingCustomer._id?.toString?.() || null,
    });

    return {
      customer: existingCustomer,
      created: false,
      lookupFound: true,
      skipped: false,
    };
  }

  const lookupResult = await fetchCybotUserDetails({
    userId: normalizedCybotUserId,
    databaseName,
  });

  if (!lookupResult?.found || !lookupResult?.userDetails) {
    logger.warn('Customer could not be auto-created because Cybot lookup did not return a user', {
      botUserId,
      tenantId: tenant?.tenantId || null,
      cybotUserId: normalizedCybotUserId,
      databaseName: normalizeText(databaseName) || null,
    });

    return {
      customer: null,
      created: false,
      lookupFound: false,
      skipped: false,
    };
  }

  const createdCustomer = await createCustomer({
    tenantDb,
    tenant,
    botUserId,
    botMasterKey: tenant?.botMasterKey || {},
    payload: buildCustomerCreatePayload({
      userDetails: lookupResult.userDetails,
      cybotUserId: normalizedCybotUserId,
      tenant,
    }),
  });

  logger.info('Customer auto-created for cybot user', {
    botUserId,
    tenantId: tenant?.tenantId || null,
    cybotUserId: normalizedCybotUserId,
    customerId: createdCustomer?.id || null,
  });

  return {
    customer: createdCustomer,
    created: true,
    lookupFound: true,
    skipped: false,
  };
}
