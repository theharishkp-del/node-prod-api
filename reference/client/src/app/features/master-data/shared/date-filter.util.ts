export interface DateRangeValue {
  dateFrom: string;
  dateTo: string;
}

function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getCurrentMonthDateRange(now = new Date()): DateRangeValue {
  return {
    dateFrom: toDateInputValue(new Date(now.getFullYear(), now.getMonth(), 1)),
    dateTo: toDateInputValue(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
  };
}

export function getDateRangeError(dateFrom: string, dateTo: string): string {
  if (dateFrom && dateTo && dateFrom > dateTo) {
    return '"From" date must be on or before "To" date.';
  }
  if (dateTo && !dateFrom) {
    return 'Please set a "From" date.';
  }
  if (dateFrom && !dateTo) {
    return 'Please set a "To" date.';
  }
  return '';
}
