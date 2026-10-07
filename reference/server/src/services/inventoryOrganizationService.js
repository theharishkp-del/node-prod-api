import { getMasterDbConnection } from '../config/db.js';
import { logger } from '../config/logger.js';
import { REGISTRY_COLLECTION } from '../models/master/registryModel.js';
import { getTenantRegistry } from '../utils/tenantManager.js';
import { requestHttp } from '../utils/httpClient.js';

const INVENTORY_ORGANIZATION_URL = 'https://devce.cognitivemobile.net/inventory/api/v1/organizations';

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizePhoneNumber(countryCode, phoneNumber) {
  const normalizedPhone = normalizeText(phoneNumber);
  if (!normalizedPhone) {
    return undefined;
  }

  const normalizedCountryCode = normalizeText(countryCode);
  if (!normalizedCountryCode || normalizedPhone.startsWith('+')) {
    return normalizedPhone;
  }

  return `${normalizedCountryCode}${normalizedPhone}`;
}

function buildInventoryBotUsers(cybotUsers = []) {
  return (Array.isArray(cybotUsers) ? cybotUsers : []).map((user) => ({
    id: normalizeText(user?.id),
    firstName: normalizeText(user?.firstName),
    lastName: normalizeText(user?.lastName),
    uniqueName: normalizeText(user?.uniqueName),
    userName: normalizeText(user?.userName),
    botTechId: normalizeText(user?.botTechId),
    emailId: normalizeText(user?.emailId),
    phoneNumber: normalizeText(user?.phoneNumber),
    countryCode: normalizeText(user?.countryCode),
    role: normalizeText(user?.role).toUpperCase(),
  }));
}

export function buildInventoryOrganizationPayload(registry = {}) {
  const companyDetails = registry.companyDetails || {};
  const firstBranch = Array.isArray(registry.branches) ? registry.branches[0] || {} : {};
  const branches = Array.isArray(registry.branches) ? registry.branches : [];

  return {
    orgName: normalizeText(registry.companyName || companyDetails.companyName),
    email: normalizeText(
      companyDetails.email || companyDetails.emailId || companyDetails.businessEmail || firstBranch.email,
    ) || undefined,
    phone: normalizePhoneNumber(
      companyDetails.countryCode || firstBranch.countryCode,
      companyDetails.phone || companyDetails.phoneNumber || firstBranch.phone,
    ),
    timezone: normalizeText(companyDetails.timezone || firstBranch.timezone) || 'Asia/Kolkata',
    currency: normalizeText(companyDetails.currency) || 'INR',
    language: normalizeText(companyDetails.language) || 'en',
    multiLocation: branches.length > 1,
    botId: normalizeText(registry.botId || registry.botMasterKey?.botId),
    userId: normalizeText(registry.userId || registry.botMasterKey?.userId),
    databaseName: normalizeText(registry.databaseName || registry.botMasterKey?.databaseName),
    companyName: normalizeText(registry.companyName || companyDetails.companyName),
    botUsers: buildInventoryBotUsers(registry.cybotUsers),
  };
}

function getInventoryCustomerId(response = {}) {
  return normalizeText(
    response.inv_customer_id ||
    response.data?.inv_customer_id ||
    response.data?.id,
  ) || null;
}

function isSuccessfulInventoryResponse(response = {}) {
  return response.status === 'SUCCESS' || response.result_code === 0 || response.exists === true;
}

async function saveInventoryOrganizationState(masterDb, botUserId, inventoryOrganization) {
  await masterDb.collection(REGISTRY_COLLECTION).updateOne(
    { botUserId },
    {
      $set: {
        inventoryOrganization,
        invCustomerId: inventoryOrganization.invCustomerId || null,
        updatedAt: new Date(),
      },
    },
  );
}

export async function syncInventoryOrganization({ registry, force = false }) {
  const masterDb = getMasterDbConnection();
  const botUserId = normalizeText(registry?.botUserId);
  const existingInventoryState = registry?.inventoryOrganization || {};
  const existingCustomerId = normalizeText(registry?.invCustomerId || existingInventoryState.invCustomerId);

  if (!botUserId) {
    throw new Error('botUserId is required to synchronize an inventory organization.');
  }

  if (existingCustomerId && !force) {
    return {
      status: 'synced',
      attempted: false,
      invCustomerId: existingCustomerId,
      message: 'Inventory organization is already synchronized.',
    };
  }

  const payload = buildInventoryOrganizationPayload(registry);
  if (!payload.orgName) {
    const inventoryOrganization = {
      status: 'failed',
      invCustomerId: existingCustomerId || null,
      lastAttemptAt: new Date(),
      syncedAt: existingInventoryState.syncedAt || null,
      lastError: 'Organization name is required for inventory synchronization.',
      responseCode: null,
    };
    await saveInventoryOrganizationState(masterDb, botUserId, inventoryOrganization);

    return {
      status: 'failed',
      attempted: false,
      invCustomerId: existingCustomerId || null,
      message: inventoryOrganization.lastError,
    };
  }

  try {
    const isUpdate = Boolean(existingCustomerId && force);
    const method = isUpdate ? 'put' : 'post';
    const organizationUrl = isUpdate
      ? `${INVENTORY_ORGANIZATION_URL}/${encodeURIComponent(existingCustomerId)}`
      : INVENTORY_ORGANIZATION_URL;
    const response = await requestHttp(organizationUrl, {
      method,
      data: payload,
      headers: {
        'Content-Type': 'application/json',
      },
      requestId: `inventory-org-${botUserId}`,
      label: isUpdate ? 'Inventory organization update' : 'Inventory organization creation',
    });
    const responseBody = response.data || {};
    const invCustomerId = getInventoryCustomerId(responseBody) || existingCustomerId || null;

    if (!isSuccessfulInventoryResponse(responseBody) || !invCustomerId) {
      const message = normalizeText(responseBody.result_text || responseBody.message)
        || 'Inventory organization service returned an unsuccessful response.';
      const inventoryOrganization = {
        status: 'failed',
        invCustomerId: existingCustomerId || null,
        lastAttemptAt: new Date(),
        syncedAt: existingInventoryState.syncedAt || null,
        lastError: message,
        responseCode: response.status,
      };
      await saveInventoryOrganizationState(masterDb, botUserId, inventoryOrganization);

      return { status: 'failed', attempted: true, invCustomerId: null, message };
    }

    const inventoryOrganization = {
      status: 'synced',
      invCustomerId,
      lastAttemptAt: new Date(),
      syncedAt: new Date(),
      lastError: null,
      responseCode: response.status,
    };
    await saveInventoryOrganizationState(masterDb, botUserId, inventoryOrganization);

    logger.info('Inventory organization synchronized', { botUserId, invCustomerId });
    return {
      status: 'synced',
      attempted: true,
      invCustomerId,
      message: normalizeText(responseBody.result_text || responseBody.message) || 'Inventory organization saved successfully.',
    };
  } catch (error) {
    const message = normalizeText(error?.response?.data?.result_text || error?.response?.data?.message || error?.message)
      || 'Inventory organization synchronization failed.';
    const inventoryOrganization = {
      status: 'failed',
      invCustomerId: existingCustomerId || null,
      lastAttemptAt: new Date(),
      syncedAt: existingInventoryState.syncedAt || null,
      lastError: message,
      responseCode: error?.response?.status || null,
    };
    await saveInventoryOrganizationState(masterDb, botUserId, inventoryOrganization);

    return { status: 'failed', attempted: true, invCustomerId: null, message };
  }
}

export async function getInventoryOrganizationSyncStatus(botUserId) {
  const registry = await getTenantRegistry(botUserId);
  if (!registry) {
    throw new Error('Tenant registry was not found.');
  }

  return {
    tenantId: registry.tenantId,
    databaseName: registry.databaseName,
    invCustomerId: registry.invCustomerId || registry.inventoryOrganization?.invCustomerId || null,
    inventoryOrganization: registry.inventoryOrganization || { status: 'not_synced' },
  };
}

export async function retryInventoryOrganizationSync(botUserId) {
  const registry = await getTenantRegistry(botUserId);
  if (!registry) {
    throw new Error('Tenant registry was not found.');
  }

  return syncInventoryOrganization({ registry, force: true });
}
