import { buildMasterDataLink } from '../../../services/adminLinkService.js';
import { buildStandardEOTextResponse } from './standardEOShared.js';

export async function handleStandardEOAdminMenuMasterData(req) {
  const masterDataUrl = buildMasterDataLink(req.tenant?.botMasterKey || {});

  return buildStandardEOTextResponse(req, {
    resultText: 'success',
    fileName: masterDataUrl === '#'
      ? 'Master data access is not available right now.'
      : [
        'To access master data and review synchronized business records.',
        masterDataUrl,
      ].join('\n'),
  });
}
