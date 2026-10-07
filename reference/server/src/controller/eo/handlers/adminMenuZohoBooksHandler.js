import { buildZohoAuthorizeUrl } from '../../../services/zohoOAuthService.js';
import { buildStandardEOTextResponse } from './standardEOShared.js';

function getSelectedZohoOrganizationName(zohoBooks = null) {
  return (
    zohoBooks?.organizations?.selectedOrganization?.name ||
    zohoBooks?.selectedOrganizationName ||
    zohoBooks?.organizationName ||
    ''
  );
}

function isZohoConnected(zohoBooks = null) {
  return Boolean(
    zohoBooks?.auth?.refreshToken ||
    zohoBooks?.refreshToken,
  );
}

export async function handleStandardEOAdminMenuZohoBooks(req) {
  const zohoBooks = req.tenant?.zohoBooks || null;
  const selectedOrganizationName = getSelectedZohoOrganizationName(zohoBooks);
  const connected = isZohoConnected(zohoBooks);
  let href = '#';

  try {
    href = buildZohoAuthorizeUrl(req.tenant?.botMasterKey || {});
  } catch {
    href = '#';
  }

  const text = connected
    ? `Zoho Books is already connected${selectedOrganizationName ? ` with default organization ${selectedOrganizationName}` : ''}. Open this link and continue with the same Zoho account${selectedOrganizationName ? ' and choose the default organization shown above' : ''}.`
    : 'To connect your Zoho Books account.';

  return buildStandardEOTextResponse(req, {
    resultText: 'success',
    fileName: [text, href === '#' ? '' : href].filter(Boolean).join('\n'),
  });
}
