import { buildReportsLink } from '../../../services/adminLinkService.js';
import { buildStandardEOTextResponse } from './standardEOShared.js';

export async function handleStandardEOAdminMenuReports(req) {
  const reportsUrl = buildReportsLink(req.tenant?.botMasterKey || {});

  return buildStandardEOTextResponse(req, {
    resultText: 'success',
    fileName: reportsUrl === '#'
      ? 'Reports access is not available right now.'
      : [
        'To access reports and download customer, invoice, and work order reports.',
        reportsUrl,
      ].join('\n'),
  });
}
