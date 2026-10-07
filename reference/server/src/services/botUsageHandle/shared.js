function padDateValue(value) {
  return String(value).padStart(2, '0');
}

export function formatUsageDateFromValue(value) {
  if (typeof value === 'string') {
    const trimmedValue = value.trim();
    const matchedDate = trimmedValue.match(/^(\d{4})-(\d{2})-(\d{2})/);

    if (matchedDate) {
      return `${matchedDate[1]}-${matchedDate[2]}-${matchedDate[3]}`;
    }

    const parsedDate = new Date(trimmedValue);

    if (!Number.isNaN(parsedDate.getTime())) {
      return [
        parsedDate.getFullYear(),
        padDateValue(parsedDate.getMonth() + 1),
        padDateValue(parsedDate.getDate()),
      ].join('-');
    }
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return [
      value.getFullYear(),
      padDateValue(value.getMonth() + 1),
      padDateValue(value.getDate()),
    ].join('-');
  }

  const fallbackDate = new Date();

  return [
    fallbackDate.getFullYear(),
    padDateValue(fallbackDate.getMonth() + 1),
    padDateValue(fallbackDate.getDate()),
  ].join('-');
}

export function buildBotUsageRequestContext(req = {}) {
  const body = req.body || {};
  const reqMessageObj = body.reqMessageObj || {};

  return {
    userId: body.userId || reqMessageObj.fromId || '',
    botId: body.botId || body.botUserId || '',
    databaseName: body.databaseName || reqMessageObj.databaseName || '',
    date: [
      formatUsageDateFromValue(
        body.usageDate ||
          body.date?.[0] ||
          reqMessageObj.localDateTime ||
          reqMessageObj.createdDate,
      ),
    ],
  };
}

export function buildUsagePayload(context = {}, overrides = {}) {
  const mergedPayload = {
    ...context,
    ...overrides,
  };

  const usageDate = overrides.date?.[0] || context.date?.[0];

  return {
    ...mergedPayload,
    date: [formatUsageDateFromValue(usageDate)],
  };
}
