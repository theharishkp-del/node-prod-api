export const MASTER_DATA_TIERS_COLLECTION = 'md_tiers';

export const masterDataTierCollectionSchema = {
  bsonType: 'object',
  required: ['tenantId', 'botUserId', 'tierKey', 'tierName', 'multiplier', 'isDeleted', 'createdAt', 'updatedAt'],
  additionalProperties: true,
  properties: {
    tenantId: { bsonType: 'string' },
    botUserId: { bsonType: 'string' },
    tierKey: { bsonType: 'string' },
    tierName: { bsonType: 'string' },
    multiplier: { bsonType: ['double', 'int', 'long', 'decimal'] },
    isDeleted: { bsonType: 'bool' },
    createdAt: { bsonType: 'date' },
    updatedAt: { bsonType: 'date' },
  },
};
