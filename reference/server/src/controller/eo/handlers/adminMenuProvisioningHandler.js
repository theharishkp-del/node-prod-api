import { buildProvisioningLink } from '../../../services/adminLinkService.js';
import { buildStandardEOTextResponse } from './standardEOShared.js';

export async function handleStandardEOAdminMenuProvisioning(req) {
  const provisioningUrl = buildProvisioningLink(req.tenant?.botMasterKey || {});

  return buildStandardEOTextResponse(req, {
    resultText: 'success',
    fileName: provisioningUrl === '#'
      ? 'Provisioning access is not available right now.'
      : [
        'To access provisioning and manage setup configuration.',
        provisioningUrl,
      ].join('\n'),
  });
}
