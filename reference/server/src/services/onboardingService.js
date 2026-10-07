import crypto from 'node:crypto';
import { getMasterDbConnection } from '../config/db.js';
import { logger } from '../config/logger.js';
import { REGISTRY_COLLECTION } from '../models/master/registryModel.js';
import { getOrCreatePlanConfig, isTrialPlanCode } from './planMasterService.js';
import { env } from '../config/env.js';
import { syncInventoryOrganization } from './inventoryOrganizationService.js';
import { addBotAsBuddy } from './buddyService.js';
import { fetchBotDetails } from './botDetailsService.js';
import {
  getTenantCacheSnapshot,
  getTenantRegistry,
  primeTenantRoutingCache,
} from '../utils/tenantManager.js';

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeSegment(value, fallback = 'tenant') {
  const normalizedValue = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return normalizedValue || fallback;
}

function buildCompanyPrefix(companyName) {
  const companyToken = String(companyName || '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();

  if (!companyToken) {
    return 'tnnt';
  }

  if (companyToken.length >= 4) {
    return companyToken.slice(0, 4);
  }

  return companyToken.slice(0, 3);
}

function generateTenantDatabaseName({ botUserId, companyName, isTrial = false }) {
  const botUserToken = normalizeSegment(botUserId, 'anonymous');
  const companyPrefix = buildCompanyPrefix(companyName);
  const uniqueSuffix = crypto.randomBytes(5).toString('hex');

  const trialSuffix = isTrial ? '_trial' : '';
  return `tenant_${botUserToken}_${companyPrefix}${trialSuffix}_${uniqueSuffix}`;
}

function generateTenantId() {
  return `tn_${crypto.randomBytes(6).toString('hex')}`;
}

function generateBranchId() {
  return `br_${crypto.randomBytes(6).toString('hex')}`;
}

function getBotUserId(botMasterKey = {}, explicitBotUserId = null) {
  const botId = botMasterKey.botId != null ? String(botMasterKey.botId) : null;
  const userId = botMasterKey.userId != null ? String(botMasterKey.userId) : null;
  const normalizedExplicitBotUserId = String(explicitBotUserId || '').trim() || null;

  return {
    botId,
    userId,
    botUserId: botId || userId || normalizedExplicitBotUserId,
  };
}

function sanitizeStoredBotMasterKey(botMasterKey = {}) {
  if (!botMasterKey || typeof botMasterKey !== 'object') {
    return {};
  }

  const { redirectUrl: _redirectUrl, ...sanitizedBotMasterKey } = botMasterKey;
  return sanitizedBotMasterKey;
}

function normalizeCybotUsers(payload) {
  if (Array.isArray(payload.cybotUsers) && payload.cybotUsers.length > 0) {
    return payload.cybotUsers;
  }

  if (payload.cybotUserRegistration) {
    return [payload.cybotUserRegistration];
  }

  return [];
}

function buildBranchKey(branch = {}) {
  const branchName = String(branch.branchName || '').trim().toLowerCase();
  const formattedAddress = String(branch.address?.formattedAddress || '').trim().toLowerCase();
  return `${branchName}__${formattedAddress}`;
}

function normalizeBranches(branches, existingBranches = []) {
  const existingBranchesById = new Map(
    (Array.isArray(existingBranches) ? existingBranches : [])
      .filter((branch) => typeof branch?.branchId === 'string' && branch.branchId.trim())
      .map((branch) => [branch.branchId.trim(), branch])
  );
  const existingBranchesByKey = new Map(
    (Array.isArray(existingBranches) ? existingBranches : [])
      .map((branch) => [buildBranchKey(branch), branch])
      .filter(([key]) => key !== '__')
  );

  return (Array.isArray(branches) ? branches : []).map((branch) => {
    const currentBranchId = typeof branch?.branchId === 'string' ? branch.branchId.trim() : '';
    const existingBranchById = currentBranchId ? existingBranchesById.get(currentBranchId) : null;
    const existingBranchByKey = existingBranchesByKey.get(buildBranchKey(branch));
    const branchId = currentBranchId || existingBranchById?.branchId || existingBranchByKey?.branchId || generateBranchId();

    return {
      ...branch,
      branchId,
    };
  });
}

function buildCybotUserKey(user = {}) {
  return (
    String(user.id || '').trim() ||
    String(user.uniqueName || '').trim() ||
    String(user.emailId || '').trim() ||
    `${String(user.countryCode || '').trim()}_${String(user.phoneNumber || '').trim()}`
  );
}

function mergeCybotUsersWithBuddyState(cybotUsers, existingCybotUsers = []) {
  const existingUsersByKey = new Map(
    (Array.isArray(existingCybotUsers) ? existingCybotUsers : [])
      .map((user) => [buildCybotUserKey(user), user])
      .filter(([key]) => key)
  );

  return (Array.isArray(cybotUsers) ? cybotUsers : []).map((user) => {
    const existingUser = existingUsersByKey.get(buildCybotUserKey(user));

    return existingUser?.buddyAdd === true
      ? { ...user, buddyAdd: true }
      : { ...user, buddyAdd: false };
  });
}

async function populateBuddyStatusForCybotUsers({
  cybotUsers,
  botUserId,
  databaseName,
}) {
  const normalizedDatabaseName = String(databaseName || env.botDbName || '').trim();

  return Promise.all(
    (Array.isArray(cybotUsers) ? cybotUsers : []).map(async (user) => {
      if (user?.buddyAdd === true) {
        return user;
      }

      const fromId = String(user?.id || '').trim();

      if (!fromId || !botUserId) {
        return {
          ...user,
          buddyAdd: false,
        };
      }

      try {
        const response = await addBotAsBuddy({
          fromId,
          buddyId: botUserId,
          requestStatus: 'accepted',
          databaseName: normalizedDatabaseName,
        });

        return {
          ...user,
          buddyAdd: String(response?.result_Code) === '0',
        };
      } catch (error) {
        logger.warn('Failed to add bot as buddy for cybot user', {
          botUserId,
          fromId,
          databaseName: normalizedDatabaseName || null,
          error: error?.message || error,
        });

        return {
          ...user,
          buddyAdd: false,
        };
      }
    })
  );
}

function validateCybotUsers(cybotUsers, planConfig) {
  if (!cybotUsers.length) {
    throw new Error('At least one cybot user is required.');
  }

  const seenUsers = new Map();

  for (const user of cybotUsers) {
    const uniqueKey =
      String(user.id || '').trim() ||
      String(user.uniqueName || '').trim() ||
      String(user.emailId || '').trim() ||
      `${String(user.countryCode || '').trim()}_${String(user.phoneNumber || '').trim()}`;

    if (!uniqueKey) {
      throw new Error('Each cybot user must include at least one unique identifier.');
    }

    if (seenUsers.has(uniqueKey)) {
      throw new Error('A user can only be assigned once per organization as either Admin or Technician.');
    }

    seenUsers.set(uniqueKey, true);
  }

  const roleCounts = cybotUsers.reduce(
    (counts, user) => {
      const role = String(user.role || '').trim();

      if (role === 'Admin' || role === 'Technician') {
        counts[role] += 1;
      }

      return counts;
    },
    { Admin: 0, Technician: 0 }
  );

  const limits = planConfig.limits;

  if (cybotUsers.length > limits.maxUsers) {
    throw new Error(`Your ${planConfig.planName} plan allows a maximum of ${limits.maxUsers} Cybot users.`);
  }

  if (roleCounts.Admin < limits.minAdmins || roleCounts.Technician < limits.minTechnicians) {
    throw new Error(
      `Your ${planConfig.planName} plan requires at least ${limits.minAdmins} Admin and ${limits.minTechnicians} Technician user(s).`
    );
  }
}

function validateCustomerPayload(payload) {
  if (!payload.companyDetails?.companyName) {
    throw new Error('companyDetails.companyName is required.');
  }

  if (!Array.isArray(payload.branches) || payload.branches.length === 0) {
    throw new Error('At least one branch is required.');
  }
}

function buildRegistrySetDocument({
  botUserId,
  botId,
  userId,
  tenantId,
  databaseName,
  companyName,
  companyDetails,
  branches,
  cybotUsers,
  botDetails,
  botMasterKey,
  planCode,
}) {
  const setDocument = {
    botUserId,
    botId,
    userId,
    tenantId,
    databaseName,
    botMasterKey,
    planCode,
    isActive: true,
    updatedAt: new Date(),
  };

  if (companyName) {
    setDocument.companyName = companyName;
  }

  if (companyDetails) {
    setDocument.companyDetails = companyDetails;
  }

  if (Array.isArray(branches) && branches.length > 0) {
    setDocument.branches = branches;
  }

  if (Array.isArray(cybotUsers) && cybotUsers.length > 0) {
    setDocument.cybotUsers = cybotUsers;
  }

  if (botDetails && typeof botDetails === 'object') {
    setDocument.botDetails = botDetails;
  }

  return setDocument;
}

async function upsertTenantRegistry({
  masterDb,
  botUserId,
  botId,
  userId,
  tenantId,
  databaseName,
  companyName,
  companyDetails,
  branches,
  cybotUsers,
  botDetails,
  botMasterKey,
  planCode,
}) {
  const setDocument = buildRegistrySetDocument({
    botUserId,
    botId,
    userId,
    tenantId,
    databaseName,
    companyName,
    companyDetails,
    branches,
    cybotUsers,
    botDetails,
    botMasterKey,
    planCode,
  });

  await masterDb.collection(REGISTRY_COLLECTION).updateOne(
    { botUserId },
    {
      $set: setDocument,
      $setOnInsert: {
        createdAt: new Date(),
      },
    },
    { upsert: true }
  );

  return {
    ...setDocument,
    tenantId,
    databaseName,
  };
}

async function resolveTenantProvisioningState({ botMasterKey, botUserId: explicitBotUserId, companyName }) {
  const { botId, userId, botUserId } = getBotUserId(botMasterKey, explicitBotUserId);

  if (!botUserId) {
    throw new Error('botUserId is required in payload.botUserId or botMasterKey.botId or botMasterKey.userId.');
  }

  const existingRegistry = await getTenantRegistry(botUserId);
  const tenantId = existingRegistry?.tenantId || generateTenantId();
  const databaseName = existingRegistry?.databaseName || generateTenantDatabaseName({
    botUserId,
    companyName,
    isTrial: isTrialPlanCode(botMasterKey.plan),
  });

  return {
    existingRegistry,
    botId,
    userId,
    botUserId,
    tenantId,
    databaseName,
  };
}

export async function fetchExistingOnboarding(payload) {
  const botMasterKey = payload.botMasterKey || {};
  const planConfig = await getOrCreatePlanConfig(botMasterKey.plan);
  const { botUserId } = getBotUserId(botMasterKey, payload.botUserId);

  if (!botUserId) {
    throw new Error('botUserId is required in payload.botUserId or botMasterKey.botId or botMasterKey.userId.');
  }

  const existingRegistry = await getTenantRegistry(botUserId);

  if (!existingRegistry?.databaseName) {
    return { planConfig };
  }

  if (!existingRegistry.companyDetails) {
    return { planConfig };
  }

  return {
    tenantId: existingRegistry.tenantId || null,
    databaseName: existingRegistry.databaseName,
    planConfig,
    payload: {
      botMasterKey: existingRegistry.botMasterKey || botMasterKey,
      companyDetails: existingRegistry.companyDetails,
      branches: existingRegistry.branches || [],
      cybotUsers: existingRegistry.cybotUsers || [],
    },
  };
}

export async function provisionTenantRegistry(payload) {
  const masterDb = getMasterDbConnection();
  const botMasterKey = sanitizeStoredBotMasterKey(payload.botMasterKey || {});
  const planConfig = await getOrCreatePlanConfig(botMasterKey.plan);
  const companyName = String(payload.companyDetails?.companyName || payload.companyName || '').trim() || null;
  const companyDetails = payload.companyDetails || null;
  const incomingBranches = Array.isArray(payload.branches) ? payload.branches : [];
  const cybotUsers = normalizeCybotUsers(payload);
  const {
    existingRegistry,
    botId,
    userId,
    botUserId,
    tenantId,
    databaseName,
  } = await resolveTenantProvisioningState({
    botMasterKey,
    botUserId: payload.botUserId,
    companyName,
  });
  const branches = normalizeBranches(incomingBranches, existingRegistry?.branches || []);

  const registryEntry = await upsertTenantRegistry({
    masterDb,
    botUserId,
    botId,
    userId,
    tenantId,
    databaseName,
    companyName,
    companyDetails,
    branches,
    cybotUsers,
    botMasterKey,
    planCode: normalizeText(botMasterKey.plan || planConfig.planCode || 'csm-suite'),
  });

  primeTenantRoutingCache(registryEntry);

  logger.info('Tenant provisioning completed', {
    botUserId,
    tenantId,
    databaseName,
    tenantDatabaseCreated: false,
    customerCollectionCreated: false,
    cacheSnapshot: getTenantCacheSnapshot(),
  });

  return {
    operation: existingRegistry?.databaseName ? 'updated' : 'created',
    tenantId,
    databaseName,
    botUserId,
  };
}

export async function provisionTenantAndCreateCustomer(payload) {
  const masterDb = getMasterDbConnection();
  const botMasterKey = sanitizeStoredBotMasterKey(payload.botMasterKey || {});
  const planConfig = await getOrCreatePlanConfig(botMasterKey.plan);
  const { botId, userId, botUserId } = getBotUserId(botMasterKey, payload.botUserId);
  const cybotUsers = normalizeCybotUsers(payload);

  logger.info('Onboarding payload received', {
    botUserId,
    botId,
    userId,
    planCode: botMasterKey.plan || planConfig.planCode || 'csm-suite',
    onboardingPayload: payload,
  });

  if (!botUserId) {
    throw new Error('botUserId is required in payload.botUserId or botMasterKey.botId or botMasterKey.userId.');
  }

  validateCustomerPayload(payload);
  validateCybotUsers(cybotUsers, planConfig);

  const existingRegistry = await getTenantRegistry(botUserId);
  const normalizedBranches = normalizeBranches(payload.branches, existingRegistry?.branches || []);
  const mergedCybotUsers = mergeCybotUsersWithBuddyState(cybotUsers, existingRegistry?.cybotUsers || []);
  const resolvedDatabaseName =
    String(payload.databaseName || payload.botMasterKey?.databaseName || env.botDbName || '').trim();
  let fetchedBotDetails = null;

  if (!existingRegistry?.companyDetails && !existingRegistry?.botDetails) {
    const botDetailsLookupResult = await fetchBotDetails({
      databaseName: resolvedDatabaseName,
      botId,
      botMasterKey,
    });

    if (botDetailsLookupResult.found) {
      fetchedBotDetails = botDetailsLookupResult.botDetails;
    }
  }

  const cybotUsersWithBuddyStatus = await populateBuddyStatusForCybotUsers({
    cybotUsers: mergedCybotUsers,
    botUserId,
    databaseName: resolvedDatabaseName,
  });
  const preparedPayload = {
    ...payload,
    branches: normalizedBranches,
    cybotUsers: cybotUsersWithBuddyStatus,
  };
  const provisioningResult = await provisionTenantRegistry(preparedPayload);

  const updatedRegistryEntry = await upsertTenantRegistry({
    masterDb,
    botUserId,
    botId,
    userId,
    tenantId: provisioningResult.tenantId,
    databaseName: provisioningResult.databaseName,
    companyName: payload.companyDetails.companyName,
    companyDetails: payload.companyDetails,
    branches: normalizedBranches,
    cybotUsers: cybotUsersWithBuddyStatus,
    botDetails: fetchedBotDetails,
    botMasterKey,
    planCode: normalizeText(botMasterKey.plan || planConfig.planCode || 'csm-suite'),
  });
  const inventorySync = await syncInventoryOrganization({
    registry: {
      ...existingRegistry,
      ...updatedRegistryEntry,
    },
    force: provisioningResult.operation === 'updated',
  });

  primeTenantRoutingCache({
    ...existingRegistry,
    ...updatedRegistryEntry,
    invCustomerId: inventorySync.invCustomerId || updatedRegistryEntry.invCustomerId || null,
    inventoryOrganization: {
      status: inventorySync.status,
      invCustomerId: inventorySync.invCustomerId || updatedRegistryEntry.invCustomerId || null,
    },
  });

  logger.info('Tenant onboarding details saved in master registry', {
    botUserId,
    tenantId: provisioningResult.tenantId,
    databaseName: provisioningResult.databaseName,
    tenantDatabaseCreated: false,
    cacheSnapshot: getTenantCacheSnapshot(),
  });

  return {
    operation: existingRegistry?.companyDetails ? 'updated' : 'created',
    tenantId: provisioningResult.tenantId,
    databaseName: provisioningResult.databaseName,
    inventorySync,
  };
}
