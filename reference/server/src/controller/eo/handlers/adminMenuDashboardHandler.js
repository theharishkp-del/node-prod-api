import { buildDashboardLink } from '../../../services/adminLinkService.js';
import { buildStandardEOTextResponse } from './standardEOShared.js';

export async function handleStandardEOAdminMenuDashboard(req) {
  const dashboardUrl = buildDashboardLink(req.tenant?.botMasterKey || {});

  return buildStandardEOTextResponse(req, {
    resultText: 'success',
    fileName: dashboardUrl === '#'
      ? 'Dashboard view is not available right now.'
      : [
        'To access the dashboard and review business, payment, and conversion metrics.',
        dashboardUrl,
      ].join('\n'),
  });
}
