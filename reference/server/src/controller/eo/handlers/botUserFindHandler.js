import { ensureCustomerExistsForCybotUser } from '../../../services/customerAutoCreateService.js';
import { buildStandardEOTextResponse, normalizeText } from './standardEOShared.js';

function findCybotUserRole(cybotUsers = [], fromId = '') {
  const normalizedFromId = normalizeText(fromId);
  const matchedUser = (Array.isArray(cybotUsers) ? cybotUsers : []).find(
    (user) => normalizeText(user?.id) === normalizedFromId,
  ) || null;

  if (!matchedUser) {
    return {
      matchedUser: null,
      role: 'Customer',
      fullName: '',
    };
  }

  const firstName = normalizeText(matchedUser.firstName);
  const lastName = normalizeText(matchedUser.lastName);

  return {
    matchedUser,
    role: normalizeText(matchedUser.role) || 'Customer',
    fullName: `${firstName} ${lastName}`.trim(),
  };
}

function resolveBotUserFindResultText(role = '') {
  const normalizedRole = normalizeText(role).toLowerCase();

  if (normalizedRole === 'admin') {
    return '4';
  }

  if (normalizedRole === 'technician') {
    return '14';
  }

  return '2';
}

export async function handleStandardEOBotUserFind(req) {
  const reqMessageObj = req.body?.reqMessageObj ?? {};
  const botUserId = req.body?.botUserId ?? '';
  const fromId = normalizeText(reqMessageObj.fromId);
  const tenant = req.tenant ?? {};
  const { matchedUser, role, fullName } = findCybotUserRole(tenant.cybotUsers, fromId);
  const companyName = normalizeText(
    tenant?.companyDetails?.companyName || tenant?.companyName,
  );
  const normalizedRole = normalizeText(role).toLowerCase();

  if (normalizedRole === 'customer') {
    await ensureCustomerExistsForCybotUser({
      tenantDb: req.tenantDb,
      tenant,
      botUserId,
      databaseName: normalizeText(reqMessageObj.databaseName) || normalizeText(tenant?.databaseName),
      cybotUserId: fromId,
    });
  }

  return buildStandardEOTextResponse(req, {
    resultText: resolveBotUserFindResultText(role),
    fileName: matchedUser
      ? `Welcome ${fullName || fromId}`
      : `Welcome to the ${companyName || 'FSM Agent'} FSM Agent`,
  });
}
