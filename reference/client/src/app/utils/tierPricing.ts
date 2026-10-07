/**
 * Frontend tier-based pricing validation and calculation
 * Must match backend logic in server/src/utils/tierPricing.js
 */

/**
 * Validates and normalizes a tier multiplier (frontend validation)
 * @param {number} multiplier - The tier multiplier value
 * @returns {number} - Normalized multiplier (capped at 1.0)
 */
export function validateAndNormalizeMultiplierFrontend(multiplier: number | string | undefined | null): number {
  const parsed = Number(multiplier || 1);
  
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error('Multiplier must be a positive number');
  }
  
  // Cap multiplier at 1.0 - if it exceeds 1, use 1
  return parsed > 1 ? 1 : parsed;
}

/**
 * Calculates final price with tier multiplier (frontend)
 * @param {number} basePrice - The base/selling price from inventory
 * @param {number} multiplier - The tier multiplier (0.xx for discount, 1.0 or less)
 * @returns {number} - Final price after applying multiplier
 */
export function calculateTierPriceFrontend(basePrice: number | string | undefined | null, multiplier: number | string | undefined = 1): number {
  const base = Number(basePrice || 0);
  const factor = validateAndNormalizeMultiplierFrontend(multiplier);
  
  return Number((base * factor).toFixed(2));
}

/**
 * Formats price for display with tier information
 * @param {number} price - The price to format
 * @param {number} multiplier - The tier multiplier applied (optional)
 * @param {string} currency - Currency code (e.g., 'USD')
 * @returns {Object} - Formatted price info
 */
export function formatTierPrice(
  price: number | string | undefined | null,
  multiplier: number | string | undefined | null,
  currency: string = 'USD'
): {
  price: number;
  formatted: string;
  multiplier: number;
  isTierAdjusted: boolean;
} {
  const numPrice = Number(price || 0);
  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  
  const normalizedMultiplier = multiplier !== undefined && multiplier !== null
    ? validateAndNormalizeMultiplierFrontend(multiplier)
    : 1;
  
  return {
    price: numPrice,
    formatted: formatter.format(numPrice),
    multiplier: normalizedMultiplier,
    isTierAdjusted: multiplier !== undefined && multiplier !== null && normalizedMultiplier !== 1,
  };
}
