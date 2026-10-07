import { countries } from 'countries-list';

export interface CurrencyOption {
  code: string;
  name: string;
  symbol: string;
}

function getCurrencyName(code: string): string {
  try {
    const displayNames = new Intl.DisplayNames(['en'], { type: 'currency' });
    return displayNames.of(code) || code;
  } catch {
    return code;
  }
}

function getCurrencySymbol(code: string): string {
  try {
    const parts = new Intl.NumberFormat('en', {
      style: 'currency',
      currency: code,
      currencyDisplay: 'narrowSymbol',
    }).formatToParts(1);

    return parts.find((part) => part.type === 'currency')?.value || code;
  } catch {
    return code;
  }
}

const uniqueCurrencyCodes = Array.from(
  new Set(
    Object.values(countries).flatMap((country) => country.currency || [])
  )
)
  .filter((code) => !!code)
  .sort((left, right) => left.localeCompare(right));

export const CURRENCY_OPTIONS: CurrencyOption[] = uniqueCurrencyCodes.map((code) => ({
  code,
  name: getCurrencyName(code),
  symbol: getCurrencySymbol(code),
}));
