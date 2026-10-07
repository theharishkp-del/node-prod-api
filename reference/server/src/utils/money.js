export function formatMoney(value, currency) {
  const amount = Number(value || 0);

  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency || 'USD'} ${amount.toFixed(2)}`;
  }
}

export function resolveCurrentDate(payload) {
  const providedDate = new Date(payload?.metadata?.localDateTime || '');
  return Number.isNaN(providedDate.getTime()) ? new Date() : providedDate;
}

export function formatLeadDate(payload, leadTimeDays) {
  if (!Number.isFinite(Number(leadTimeDays)) || Number(leadTimeDays) <= 0) {
    return null;
  }

  const date = resolveCurrentDate(payload);
  date.setDate(date.getDate() + Number(leadTimeDays));

  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: payload?.metadata?.localTimeZone || 'Asia/Kolkata',
  }).format(date);
}
