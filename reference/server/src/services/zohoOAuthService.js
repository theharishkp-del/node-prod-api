import crypto from 'node:crypto';
import { getMasterDbConnection } from '../config/db.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { REGISTRY_COLLECTION } from '../models/master/registryModel.js';
import { encodeBotMasterKey } from '../utils/standardEO.js';
import { getTenantRegistry, primeTenantRoutingCache } from '../utils/tenantManager.js';
import { getJson, postJson } from '../utils/httpClient.js';
import { getZohoInitialImportState, scheduleZohoInitialImportForBot } from './zohoInitialImportService.js';

function normalizeUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function getNormalizedZohoBaseUrl(baseUrl, fallbackBaseUrl = '') {
  return normalizeUrl(baseUrl || fallbackBaseUrl);
}

const ACCESS_TOKEN_REFRESH_BUFFER_MS = 60 * 1000;

function toBase64Url(value) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function fromBase64Url(value) {
  return Buffer.from(String(value || ''), 'base64url').toString('utf8');
}

function getBotUserId(botMasterKey = {}) {
  const botId = botMasterKey.botId != null ? String(botMasterKey.botId).trim() : '';
  const userId = botMasterKey.userId != null ? String(botMasterKey.userId).trim() : '';
  return botId || userId || '';
}

function assertZohoConfig() {
  if (!env.zohoClientId || !env.zohoClientSecret || !env.zohoRedirectUri) {
    throw new Error('Zoho OAuth is not configured. Set ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, and ZOHO_REDIRECT_URI.');
  }
}

function buildSignedState(botMasterKey = {}) {
  const payload = {
    botMasterKey,
    issuedAt: Date.now(),
  };
  const serializedPayload = JSON.stringify(payload);
  const encodedPayload = toBase64Url(serializedPayload);
  const signature = crypto
    .createHmac('sha256', env.zohoClientSecret)
    .update(encodedPayload)
    .digest('base64url');

  return `${encodedPayload}.${signature}`;
}

function parseSignedState(state) {
  const [encodedPayload, signature] = String(state || '').split('.');

  if (!encodedPayload || !signature) {
    throw new Error('Zoho callback is missing a valid state payload.');
  }

  const expectedSignature = crypto
    .createHmac('sha256', env.zohoClientSecret)
    .update(encodedPayload)
    .digest('base64url');

  if (signature !== expectedSignature) {
    throw new Error('Zoho callback state validation failed.');
  }

  return JSON.parse(fromBase64Url(encodedPayload));
}

function buildCallbackRedirectUrl({ encodedKey, status, message, organizationId = '', organizationName = '' }) {
  const clientUrl = normalizeUrl(env.clientUrl);

  if (!clientUrl) {
    return null;
  }

  const callbackUrl = new URL(`${clientUrl}${env.zohoFrontendCallbackPath}`);
  callbackUrl.searchParams.set('status', status);
  callbackUrl.searchParams.set('message', message);

  if (encodedKey) {
    callbackUrl.searchParams.set('key', encodedKey);
  }

  if (organizationId) {
    callbackUrl.searchParams.set('organization_id', organizationId);
  }

  if (organizationName) {
    callbackUrl.searchParams.set('organization_name', organizationName);
  }

  return callbackUrl.toString();
}

async function exchangeCodeForTokens(code, { accountsServer = '' } = {}) {
  const normalizedAccountsServer = getNormalizedZohoBaseUrl(accountsServer, env.zohoAccountsUrl);
  const tokenUrl = `${normalizedAccountsServer}/oauth/v2/token`;
  return postJson(tokenUrl, null, {
    params: {
      grant_type: 'authorization_code',
      client_id: env.zohoClientId,
      client_secret: env.zohoClientSecret,
      redirect_uri: env.zohoRedirectUri,
      code,
    },
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    label: 'Zoho exchangeCodeForTokens',
  });
}

async function refreshAccessToken(refreshToken, { accountsServer = '' } = {}) {
  const normalizedAccountsServer = getNormalizedZohoBaseUrl(accountsServer, env.zohoAccountsUrl);
  const tokenUrl = `${normalizedAccountsServer}/oauth/v2/token`;
  return postJson(tokenUrl, null, {
    params: {
      grant_type: 'refresh_token',
      client_id: env.zohoClientId,
      client_secret: env.zohoClientSecret,
      refresh_token: refreshToken,
    },
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    label: 'Zoho refreshAccessToken',
  });
}

async function fetchOrganizations({ accessToken, apiDomain }) {
  const normalizedApiDomain = getNormalizedZohoBaseUrl(apiDomain, 'https://www.zohoapis.com');
  const response = await getJson(`${normalizedApiDomain}/books/v3/organizations`, {
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
    },
    label: 'Zoho fetchOrganizations',
  });

  return response?.organizations ?? [];
}

function selectOrganization(organizations = []) {
  if (!organizations.length) {
    return null;
  }

  const configuredOrganization = env.zohoOrgId
    ? organizations.find((organization) => String(organization.organization_id) === String(env.zohoOrgId))
    : null;

  if (configuredOrganization) {
    return configuredOrganization;
  }

  return (
    organizations.find((organization) => organization.is_default_org) ??
    organizations[0]
  );
}

function normalizeAccessibleOrganizations(organizations = []) {
  return organizations.map((organization) => ({
    organizationId: String(organization.organization_id),
    name: organization.name || '',
    isDefault: Boolean(organization.is_default_org),
    isActive: Boolean(organization.is_org_active),
    currencyCode: organization.currency_code || null,
    timeZone: organization.time_zone || null,
  }));
}

function resolveZohoAutoSyncEnabled(value) {
  return value !== false;
}

function normalizeStoredZohoBooks(zohoBooks = null) {
  if (!zohoBooks || typeof zohoBooks !== 'object') {
    return null;
  }

  const organizationConfig = zohoBooks.organizationConfig || {};
  const organizations = zohoBooks.organizations || {};
  const auth = zohoBooks.auth || {};
  const audit = zohoBooks.audit || {};
  const accessibleOrganizations = Array.isArray(organizations.availableOrganizations)
    ? organizations.availableOrganizations
    : (Array.isArray(zohoBooks.accessibleOrganizations) ? zohoBooks.accessibleOrganizations : []);
  const selectedOrganization = organizations.selectedOrganization && typeof organizations.selectedOrganization === 'object'
    ? organizations.selectedOrganization
    : null;

  return {
    status: zohoBooks.status || null,
    autoSyncEnabled: resolveZohoAutoSyncEnabled(zohoBooks.autoSyncEnabled),
    configuredOrganizationId: organizationConfig.defaultOrganizationId || zohoBooks.configuredOrganizationId || null,
    accessibleOrganizations,
    organizationId: selectedOrganization?.organizationId || zohoBooks.organizationId || null,
    organizationName: selectedOrganization?.name || zohoBooks.organizationName || null,
    selectedOrganizationId: selectedOrganization?.organizationId || zohoBooks.selectedOrganizationId || zohoBooks.organizationId || null,
    selectedOrganizationName: selectedOrganization?.name || zohoBooks.selectedOrganizationName || zohoBooks.organizationName || null,
    selectionRequired: organizations.selectionRequired ?? zohoBooks.selectionRequired ?? false,
    organizationLocked: organizations.organizationLocked ?? zohoBooks.organizationLocked ?? false,
    scope: zohoBooks.scope || null,
    accessToken: auth.accessToken || zohoBooks.accessToken || null,
    refreshToken: auth.refreshToken || zohoBooks.refreshToken || null,
    apiDomain: auth.apiDomain || zohoBooks.apiDomain || null,
    tokenType: auth.tokenType || zohoBooks.tokenType || 'Bearer',
    expiresInSeconds: auth.expiresInSeconds ?? zohoBooks.expiresInSeconds ?? null,
    accessTokenExpiresAt: auth.accessTokenExpiresAt || zohoBooks.accessTokenExpiresAt || null,
    accountsServer: auth.accountsServer || zohoBooks.accountsServer || null,
    redirectUri: auth.redirectUri || zohoBooks.redirectUri || null,
    connectedAt: audit.connectedAt || zohoBooks.connectedAt || null,
    updatedAt: audit.updatedAt || zohoBooks.updatedAt || null,
    importState: zohoBooks.importState || null,
  };
}

function buildStructuredZohoBooks(zohoBooks = {}) {
  const normalizedZohoBooks = normalizeStoredZohoBooks(zohoBooks);

  if (!normalizedZohoBooks) {
    return null;
  }

  const selectedOrganization = normalizedZohoBooks.selectedOrganizationId
    ? {
      organizationId: normalizedZohoBooks.selectedOrganizationId,
      name: normalizedZohoBooks.selectedOrganizationName || normalizedZohoBooks.organizationName || '',
    }
    : null;

  return {
    status: normalizedZohoBooks.status,
    autoSyncEnabled: resolveZohoAutoSyncEnabled(normalizedZohoBooks.autoSyncEnabled),
    scope: normalizedZohoBooks.scope,
    organizationConfig: {
      defaultOrganizationId: normalizedZohoBooks.configuredOrganizationId,
    },
    organizations: {
      availableOrganizations: normalizedZohoBooks.accessibleOrganizations,
      selectedOrganization,
      selectionRequired: Boolean(normalizedZohoBooks.selectionRequired),
      organizationLocked: Boolean(normalizedZohoBooks.organizationLocked),
    },
    auth: {
      accessToken: normalizedZohoBooks.accessToken,
      refreshToken: normalizedZohoBooks.refreshToken,
      apiDomain: normalizedZohoBooks.apiDomain,
      tokenType: normalizedZohoBooks.tokenType,
      expiresInSeconds: normalizedZohoBooks.expiresInSeconds,
      accessTokenExpiresAt: normalizedZohoBooks.accessTokenExpiresAt,
      accountsServer: normalizedZohoBooks.accountsServer,
      redirectUri: normalizedZohoBooks.redirectUri,
    },
    audit: {
      connectedAt: normalizedZohoBooks.connectedAt,
      updatedAt: normalizedZohoBooks.updatedAt,
    },
    importState: normalizedZohoBooks.importState || null,
  };
}

function findAccessibleOrganizationById(accessibleOrganizations = [], organizationId = '') {
  const normalizedOrganizationId = String(organizationId || '').trim();

  if (!normalizedOrganizationId) {
    return null;
  }

  return accessibleOrganizations.find(
    (organization) => String(organization.organizationId) === normalizedOrganizationId
  ) || null;
}

function buildZohoSelectionFields(accessibleOrganizations = [], selectedOrganization = null) {
  return {
    organizationId: selectedOrganization?.organizationId || null,
    organizationName: selectedOrganization?.name || null,
    selectedOrganizationId: selectedOrganization?.organizationId || null,
    selectedOrganizationName: selectedOrganization?.name || null,
    selectionRequired: accessibleOrganizations.length > 1 && !selectedOrganization,
    organizationLocked: Boolean(selectedOrganization),
  };
}

function buildZohoTokenFields(tokenData = {}, existingZohoBooks = {}, { accountsServer = '', connectedAt = null } = {}) {
  const now = new Date();
  const expiresInSeconds = tokenData.expires_in != null ? Number(tokenData.expires_in) : null;

  return {
    accessToken: tokenData.access_token || existingZohoBooks.accessToken || null,
    refreshToken: tokenData.refresh_token || existingZohoBooks.refreshToken || null,
    apiDomain: tokenData.api_domain || existingZohoBooks.apiDomain || null,
    tokenType: tokenData.token_type || existingZohoBooks.tokenType || 'Bearer',
    expiresInSeconds: Number.isFinite(expiresInSeconds) ? expiresInSeconds : null,
    accessTokenExpiresAt: Number.isFinite(expiresInSeconds)
      ? new Date(Date.now() + (expiresInSeconds * 1000))
      : existingZohoBooks.accessTokenExpiresAt || null,
    accountsServer: getNormalizedZohoBaseUrl(accountsServer, existingZohoBooks.accountsServer || env.zohoAccountsUrl),
    redirectUri: env.zohoRedirectUri,
    connectedAt: connectedAt || existingZohoBooks.connectedAt || now,
    updatedAt: now,
  };
}

function isZohoAccessTokenExpired(accessTokenExpiresAt) {
  if (!accessTokenExpiresAt) {
    return true;
  }

  const expiresAt = new Date(accessTokenExpiresAt);

  if (Number.isNaN(expiresAt.getTime())) {
    return true;
  }

  return expiresAt.getTime() <= Date.now() + ACCESS_TOKEN_REFRESH_BUFFER_MS;
}

async function persistZohoBooks(botUserId, botMasterKey, zohoBooks, { preserveCreatedAt = true } = {}) {
  const masterDb = getMasterDbConnection();
  const normalizedZohoBooks = normalizeStoredZohoBooks(zohoBooks);
  const structuredZohoBooks = buildStructuredZohoBooks(normalizedZohoBooks || {});
  const updatedAt = normalizedZohoBooks?.updatedAt;
  const now = updatedAt instanceof Date ? updatedAt : new Date();
  const updateDocument = {
    $set: {
      botUserId,
      botMasterKey,
      zohoBooks: structuredZohoBooks,
      updatedAt: now,
    },
  };

  if (preserveCreatedAt) {
    updateDocument.$setOnInsert = {
      createdAt: now,
      isActive: true,
    };
  }

  await masterDb.collection(REGISTRY_COLLECTION).updateOne(
    { botUserId },
    updateDocument,
    { upsert: true }
  );
}

async function refreshZohoAccessTokenIfNeeded(registryEntry) {
  const botMasterKey = registryEntry?.botMasterKey || {};
  const botUserId = getBotUserId(botMasterKey) || registryEntry?.botUserId || '';
  const existingZohoBooks = normalizeStoredZohoBooks(registryEntry?.zohoBooks || null);

  if (!botUserId) {
    throw new Error('botMasterKey.botId or botMasterKey.userId is required.');
  }

  if (!existingZohoBooks?.refreshToken) {
    throw new Error('Zoho Books is not connected for this tenant.');
  }

  if (!isZohoAccessTokenExpired(existingZohoBooks.accessTokenExpiresAt) && existingZohoBooks.accessToken) {
    return existingZohoBooks;
  }

  const tokenData = await refreshAccessToken(existingZohoBooks.refreshToken, {
    accountsServer: existingZohoBooks.accountsServer,
  });

  const refreshedZohoBooks = {
    ...existingZohoBooks,
    ...buildZohoTokenFields(tokenData, existingZohoBooks, {
      accountsServer: existingZohoBooks.accountsServer,
      connectedAt: existingZohoBooks.connectedAt,
    }),
  };

  await persistZohoBooks(botUserId, botMasterKey, refreshedZohoBooks);

  const refreshedRegistryEntry = {
    ...registryEntry,
    botUserId,
    botMasterKey,
    zohoBooks: refreshedZohoBooks,
    updatedAt: refreshedZohoBooks.updatedAt,
  };

  primeTenantRoutingCache(refreshedRegistryEntry);

  logger.info('Zoho Books access token refreshed', {
    botUserId,
    organizationId: refreshedZohoBooks.organizationId || null,
    accessTokenExpiresAt: refreshedZohoBooks.accessTokenExpiresAt || null,
  });

  return refreshedZohoBooks;
}

export function buildZohoAuthorizeUrl(botMasterKey = {}) {
  assertZohoConfig();

  const botUserId = getBotUserId(botMasterKey);

  if (!botUserId) {
    throw new Error('botMasterKey.botId or botMasterKey.userId is required to build the Zoho authorize URL.');
  }

  const authorizeUrl = new URL(`${normalizeUrl(env.zohoAccountsUrl)}/oauth/v2/auth`);
  authorizeUrl.searchParams.set('scope', env.zohoScope);
  authorizeUrl.searchParams.set('client_id', env.zohoClientId);
  authorizeUrl.searchParams.set('state', buildSignedState(botMasterKey));
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('redirect_uri', env.zohoRedirectUri);
  authorizeUrl.searchParams.set('access_type', 'offline');
  authorizeUrl.searchParams.set('prompt', 'consent');

  return authorizeUrl.toString();
}

export async function getZohoIntegrationStatus(botMasterKey = {}) {
  const botUserId = getBotUserId(botMasterKey);

  if (!botUserId) {
    throw new Error('botMasterKey.botId or botMasterKey.userId is required.');
  }

  const registryEntry = await getTenantRegistry(botUserId);
  const zohoBooks = normalizeStoredZohoBooks(registryEntry?.zohoBooks || null);

  return {
    connected: !!zohoBooks?.refreshToken,
    autoSyncEnabled: resolveZohoAutoSyncEnabled(zohoBooks?.autoSyncEnabled),
    organizationId: zohoBooks?.selectedOrganizationId || zohoBooks?.organizationId || null,
    organizationName: zohoBooks?.selectedOrganizationName || zohoBooks?.organizationName || null,
    selectedOrganizationId: zohoBooks?.selectedOrganizationId || zohoBooks?.organizationId || null,
    selectedOrganizationName: zohoBooks?.selectedOrganizationName || zohoBooks?.organizationName || null,
    accessibleOrganizations: zohoBooks?.accessibleOrganizations || [],
    selectionRequired: Boolean(zohoBooks?.selectionRequired),
    organizationLocked: Boolean(zohoBooks?.organizationLocked),
    connectedAt: zohoBooks?.connectedAt || null,
    scope: zohoBooks?.scope || null,
    accessTokenExpiresAt: zohoBooks?.accessTokenExpiresAt || null,
    initialImport: await getZohoInitialImportState(registryEntry?.botMasterKey || botMasterKey),
    authorizeUrl: buildZohoAuthorizeUrl(registryEntry?.botMasterKey || botMasterKey),
  };
}

export async function updateZohoAutoSyncForBot({
  botMasterKey = {},
  autoSyncEnabled = true,
} = {}) {
  const botUserId = getBotUserId(botMasterKey);

  if (!botUserId) {
    throw new Error('botMasterKey.botId or botMasterKey.userId is required.');
  }

  const registryEntry = await getTenantRegistry(botUserId);
  const existingZohoBooks = normalizeStoredZohoBooks(registryEntry?.zohoBooks || null);

  if (!existingZohoBooks?.refreshToken) {
    throw new Error('Zoho Books is not connected for this tenant.');
  }

  const updatedZohoBooks = {
    ...existingZohoBooks,
    autoSyncEnabled: resolveZohoAutoSyncEnabled(autoSyncEnabled),
    updatedAt: new Date(),
  };

  await persistZohoBooks(botUserId, registryEntry?.botMasterKey || botMasterKey, updatedZohoBooks);

  primeTenantRoutingCache({
    ...registryEntry,
    botUserId,
    botMasterKey: registryEntry?.botMasterKey || botMasterKey,
    zohoBooks: updatedZohoBooks,
    updatedAt: updatedZohoBooks.updatedAt,
  });

  logger.info('Zoho auto sync setting updated for tenant', {
    botUserId,
    autoSyncEnabled: updatedZohoBooks.autoSyncEnabled,
  });

  return {
    connected: true,
    autoSyncEnabled: updatedZohoBooks.autoSyncEnabled,
    organizationId: updatedZohoBooks.selectedOrganizationId || updatedZohoBooks.organizationId || null,
    organizationName: updatedZohoBooks.selectedOrganizationName || updatedZohoBooks.organizationName || null,
  };
}

export async function selectZohoOrganizationForBot({
  botMasterKey = {},
  organizationId = '',
} = {}) {
  const botUserId = getBotUserId(botMasterKey);

  if (!botUserId) {
    throw new Error('botMasterKey.botId or botMasterKey.userId is required.');
  }

  const registryEntry = await getTenantRegistry(botUserId);
  const existingZohoBooks = normalizeStoredZohoBooks(registryEntry?.zohoBooks || null);

  if (!existingZohoBooks?.refreshToken) {
    throw new Error('Zoho Books is not connected for this tenant.');
  }

  const normalizedOrganizationId = String(organizationId || '').trim();

  if (!normalizedOrganizationId) {
    throw new Error('organizationId is required.');
  }

  const accessibleOrganizations = existingZohoBooks.accessibleOrganizations || [];
  const matchingOrganization = findAccessibleOrganizationById(accessibleOrganizations, normalizedOrganizationId);

  if (!matchingOrganization) {
    throw new Error('Selected organization is not available for this Zoho Books connection.');
  }

  const lockedOrganizationId = existingZohoBooks.selectedOrganizationId || existingZohoBooks.organizationId || null;

  if (lockedOrganizationId && String(lockedOrganizationId) !== normalizedOrganizationId) {
    throw new Error('A Zoho Books organization is already selected for this FSM Agent bot.');
  }

  const updatedZohoBooks = {
    ...existingZohoBooks,
    ...buildZohoSelectionFields(accessibleOrganizations, matchingOrganization),
    updatedAt: new Date(),
  };

  await persistZohoBooks(botUserId, registryEntry?.botMasterKey || botMasterKey, updatedZohoBooks);

  primeTenantRoutingCache({
    ...registryEntry,
    botUserId,
    botMasterKey: registryEntry?.botMasterKey || botMasterKey,
    zohoBooks: updatedZohoBooks,
    updatedAt: updatedZohoBooks.updatedAt,
  });

  logger.info('Zoho Books organization selected for tenant', {
    botUserId,
    organizationId: updatedZohoBooks.selectedOrganizationId,
    organizationName: updatedZohoBooks.selectedOrganizationName,
  });

  return {
    organizationId: updatedZohoBooks.selectedOrganizationId,
    organizationName: updatedZohoBooks.selectedOrganizationName,
  };
}

export async function getValidZohoAccessToken(botMasterKey = {}) {
  const botUserId = getBotUserId(botMasterKey);

  if (!botUserId) {
    throw new Error('botMasterKey.botId or botMasterKey.userId is required.');
  }

  const registryEntry = await getTenantRegistry(botUserId);

  if (!registryEntry?.zohoBooks) {
    throw new Error('Zoho Books is not connected for this tenant.');
  }

  const zohoBooks = await refreshZohoAccessTokenIfNeeded(registryEntry);

  return {
    accessToken: zohoBooks.accessToken,
    organizationId: zohoBooks.selectedOrganizationId || zohoBooks.organizationId || null,
    organizationName: zohoBooks.selectedOrganizationName || zohoBooks.organizationName || null,
    apiDomain: zohoBooks.apiDomain || null,
    accountsServer: zohoBooks.accountsServer || null,
    accessTokenExpiresAt: zohoBooks.accessTokenExpiresAt || null,
  };
}

export async function handleZohoOAuthCallback({ code, state, error, accountsServer }) {
  assertZohoConfig();

  if (error) {
    throw new Error(`Zoho authorization was denied: ${error}`);
  }

  if (!code) {
    throw new Error('Zoho callback did not return an authorization code.');
  }

  const parsedState = parseSignedState(state);
  const botMasterKey = parsedState.botMasterKey || {};
  const botUserId = getBotUserId(botMasterKey);

  if (!botUserId) {
    throw new Error('Zoho callback is missing bot user context.');
  }

  const tokenData = await exchangeCodeForTokens(code, { accountsServer });
  const existingRegistryEntry = await getTenantRegistry(botUserId);
  const existingZohoBooks = normalizeStoredZohoBooks(existingRegistryEntry?.zohoBooks || null);
  const organizations = await fetchOrganizations({
    accessToken: tokenData.access_token,
    apiDomain: tokenData.api_domain,
  });
  const accessibleOrganizations = normalizeAccessibleOrganizations(organizations);
  const existingSelectedOrganizationId =
    existingZohoBooks?.selectedOrganizationId ||
    existingZohoBooks?.organizationId ||
    '';
  const existingSelectedOrganization = findAccessibleOrganizationById(
    accessibleOrganizations,
    existingSelectedOrganizationId
  );
  const autoSelectedOrganization = accessibleOrganizations.length === 1
    ? accessibleOrganizations[0]
    : existingSelectedOrganization;
  const now = new Date();

  const zohoBooks = {
    status: 'connected',
    configuredOrganizationId: env.zohoOrgId || null,
    accessibleOrganizations,
    scope: env.zohoScope,
    ...buildZohoSelectionFields(accessibleOrganizations, autoSelectedOrganization),
    ...buildZohoTokenFields(tokenData, existingZohoBooks || {}, { accountsServer, connectedAt: now }),
  };

  await persistZohoBooks(botUserId, botMasterKey, zohoBooks);

  const registryEntry = await getTenantRegistry(botUserId);

  if (registryEntry) {
    primeTenantRoutingCache({
      ...registryEntry,
      botMasterKey,
      zohoBooks,
      updatedAt: now,
    });
  }

  logger.info('Zoho Books organization linked', {
    botUserId,
    organizationId: zohoBooks.selectedOrganizationId || zohoBooks.organizationId,
    organizationName: zohoBooks.selectedOrganizationName || zohoBooks.organizationName,
    selectionRequired: zohoBooks.selectionRequired,
  });

  if (!zohoBooks.selectionRequired && (zohoBooks.selectedOrganizationId || zohoBooks.organizationId)) {
    try {
      await scheduleZohoInitialImportForBot({ botMasterKey });
    } catch (error) {
      logger.error('Failed to schedule Zoho Books initial import after OAuth callback', {
        botUserId,
        message: error?.message || 'Unknown error',
      });
    }
  }

  return {
    encodedKey: encodeBotMasterKey(botMasterKey),
    organizationId: zohoBooks.selectedOrganizationId || zohoBooks.organizationId,
    organizationName: zohoBooks.selectedOrganizationName || zohoBooks.organizationName,
    redirectUrl: buildCallbackRedirectUrl({
      encodedKey: encodeBotMasterKey(botMasterKey),
      status: zohoBooks.selectionRequired ? 'selection_required' : 'success',
      message: zohoBooks.selectionRequired
        ? 'Zoho Books connected. Choose one organization for this FSM Agent bot.'
        : 'Zoho Books connected successfully.',
      organizationId: zohoBooks.selectedOrganizationId || zohoBooks.organizationId || '',
      organizationName: zohoBooks.selectedOrganizationName || zohoBooks.organizationName || '',
    }),
  };
}

export function buildZohoFailureRedirect({ state, message }) {
  try {
    const parsedState = parseSignedState(state);
    const encodedKey = encodeBotMasterKey(parsedState.botMasterKey || {});

    return buildCallbackRedirectUrl({
      encodedKey,
      status: 'error',
      message,
    });
  } catch {
    return buildCallbackRedirectUrl({
      encodedKey: '',
      status: 'error',
      message,
    });
  }
}
