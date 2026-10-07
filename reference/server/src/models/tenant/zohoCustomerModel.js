export const ZOHO_CUSTOMERS_COLLECTION = 'zoho_customers';

export const zohoCustomerCollectionSchema = {
  bsonType: 'object',
  required: ['zohoCustomerId', 'organizationId', 'displayName', 'syncedAt', 'raw'],
  additionalProperties: true,
  properties: {
    zohoCustomerId: { bsonType: 'string' },
    organizationId: { bsonType: 'string' },
    displayName: { bsonType: 'string' },
    email: { bsonType: ['string', 'null'] },
    phone: { bsonType: ['string', 'null'] },
    contactType: { bsonType: ['string', 'null'] },
    currencyCode: { bsonType: ['string', 'null'] },
    syncedAt: { bsonType: 'date' },
    raw: { bsonType: 'object' },
  },
};
