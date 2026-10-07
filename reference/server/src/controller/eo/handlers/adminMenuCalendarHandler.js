import { buildAdminCalendarLink } from '../../../services/adminLinkService.js';
import { buildStandardEOTextResponse } from './standardEOShared.js';

export async function handleStandardEOAdminMenuCalendar(req) {
  const calendarUrl = buildAdminCalendarLink(req.tenant?.botMasterKey || {});

  return buildStandardEOTextResponse(req, {
    resultText: 'success',
    fileName: calendarUrl === '#'
      ? 'Calendar view is not available right now.'
      : [
        'To access the calendar view and review enquiries and work order activity.',
        calendarUrl,
      ].join('\n'),
  });
}
