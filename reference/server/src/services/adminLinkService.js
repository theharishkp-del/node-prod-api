import { env } from '../config/env.js';
import { encodeBotMasterKey } from '../utils/standardEO.js';

function normalizeText(value) {
  return String(value || '').trim();
}

function resolveBaseClientUrl() {
  return normalizeText(env.clientUrl).replace(/\/+$/, '');
}

function buildClientLink(pathname = '', botMasterKey = {}) {
  const baseClientUrl = resolveBaseClientUrl();

  if (!baseClientUrl || !botMasterKey || typeof botMasterKey !== 'object') {
    return '#';
  }

  const encodedKey = encodeBotMasterKey(botMasterKey);
  return `${baseClientUrl}${pathname}?key=${encodeURIComponent(encodedKey)}`;
}

export function buildProvisioningLink(botMasterKey = {}) {
  const baseClientUrl = resolveBaseClientUrl();

  if (!baseClientUrl || !botMasterKey || typeof botMasterKey !== 'object') {
    return '#';
  }

  const { redirectUrl: _redirectUrl, ...provisioningBotMasterKey } = botMasterKey;
  const encodedKey = encodeBotMasterKey(provisioningBotMasterKey);

  return `${baseClientUrl}/bot-register?key=${encodeURIComponent(encodedKey)}`;
}

export function buildMasterDataLink(botMasterKey = {}) {
  return buildClientLink('/master-data', botMasterKey);
}

export function buildDashboardLink(botMasterKey = {}) {
  return buildClientLink('/dashboard', botMasterKey);
}

export function buildReportsLink(botMasterKey = {}) {
  return buildClientLink('/reports', botMasterKey);
}

export function buildAdminCalendarLink(botMasterKey = {}) {
  return buildClientLink('/admin-calendar', botMasterKey);
}
