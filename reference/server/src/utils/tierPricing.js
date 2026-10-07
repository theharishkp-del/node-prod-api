/**
 * Tier-based pricing utilities
 * Handles calculation and validation of prices with tier multipliers
 */

/**
 * Validates and normalizes a tier multiplier
 * @param {number} multiplier - The tier multiplier value
 * @returns {number} - Normalized multiplier (capped at 1.0)
 */
export function validateAndNormalizeMultiplier(multiplier) {
  const parsed = Number(multiplier || 1);
  
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error('Multiplier must be a positive number');
  }
  
  // Cap multiplier at 1.0 - if it exceeds 1, use 1
  return parsed > 1 ? 1 : parsed;
}

/**
 * Calculates final price with tier multiplier
 * @param {number} basePrice - The base/selling price from inventory
 * @param {number} multiplier - The tier multiplier (0.xx for discount, 1.0 or less)
 * @returns {number} - Final price after applying multiplier
 */
export function calculateTierPrice(basePrice, multiplier = 1) {
  const base = Number(basePrice || 0);
  const factor = validateAndNormalizeMultiplier(multiplier);
  
  return Number((base * factor).toFixed(2));
}

/**
 * Applies tier pricing to a product object
 * @param {Object} product - Product with sellingPrice/salesPrice
 * @param {number} tierMultiplier - Tier multiplier value (optional)
 * @returns {Object} - Product with adjusted selling price
 */
export function applyTierPricing(product, tierMultiplier) {
  if (!tierMultiplier || tierMultiplier === 1) {
    return product;
  }
  
  const basePrice = Number(product.sellingPrice ?? product.salesPrice ?? 0);
  const adjustedPrice = calculateTierPrice(basePrice, tierMultiplier);
  
  return {
    ...product,
    sellingPrice: adjustedPrice,
    baseSalesPrice: basePrice, // Store original for reference
    tierMultiplier: validateAndNormalizeMultiplier(tierMultiplier),
  };
}

/**
 * Gets tier multiplier from database
 * @param {Object} tenantDb - MongoDB tenant database connection
 * @param {string} tierId - The tier ID
 * @returns {Promise<number|null>} - The tier multiplier or null if tier not found
 */
export async function getTierMultiplier(tenantDb, tierId) {
  if (!tierId) {
    return 1; // Default to no multiplier
  }
  
  const MASTER_DATA_TIERS_COLLECTION = 'md_tiers';
  const { ObjectId } = await import('mongodb');
  
  try {
    const tier = await tenantDb.collection(MASTER_DATA_TIERS_COLLECTION).findOne({
      _id: new ObjectId(tierId),
      isDeleted: { $ne: true },
    });
    
    if (!tier) {
      return 1;
    }
    
    return validateAndNormalizeMultiplier(tier.multiplier);
  } catch (error) {
    console.error(`Error fetching tier ${tierId}:`, error);
    return 1;
  }
}

/**
 * Gets customer's tier multiplier
 * @param {Object} tenantDb - MongoDB tenant database connection
 * @param {Object} customer - Customer object with tierId
 * @returns {Promise<number>} - The tier multiplier for the customer
 */
export async function getCustomerTierMultiplier(tenantDb, customer) {
  if (!customer?.tierId) {
    return 1;
  }
  
  return getTierMultiplier(tenantDb, customer.tierId);
}
