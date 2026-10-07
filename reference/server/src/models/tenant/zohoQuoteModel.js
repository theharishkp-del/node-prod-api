export const ZOHO_QUOTES_COLLECTION = 'zoho_quotes';

export const zohoQuoteCollectionSchema = {
  bsonType: 'object',
  required: ['zohoQuoteId', 'organizationId', 'displayName', 'syncedAt', 'raw'],
  additionalProperties: true,
  properties: {
    zohoQuoteId: { bsonType: 'string' },
    organizationId: { bsonType: 'string' },
    displayName: { bsonType: 'string' },
    customerId: { bsonType: ['string', 'null'] },
    status: { bsonType: ['string', 'null'] },
    currencyCode: { bsonType: ['string', 'null'] },
    total: { bsonType: ['double', 'int', 'long', 'decimal', 'null'] },
    syncedAt: { bsonType: 'date' },
    raw: { bsonType: 'object' },
  },
};
