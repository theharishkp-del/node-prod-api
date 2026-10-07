export const ZOHO_PAYMENTS_COLLECTION = 'zoho_payments';

export const zohoPaymentCollectionSchema = {
  bsonType: 'object',
  required: ['zohoPaymentId', 'organizationId', 'displayName', 'syncedAt', 'raw'],
  additionalProperties: true,
  properties: {
    zohoPaymentId: { bsonType: 'string' },
    organizationId: { bsonType: 'string' },
    displayName: { bsonType: 'string' },
    customerId: { bsonType: ['string', 'null'] },
    paymentMode: { bsonType: ['string', 'null'] },
    currencyCode: { bsonType: ['string', 'null'] },
    amount: { bsonType: ['double', 'int', 'long', 'decimal', 'null'] },
    syncedAt: { bsonType: 'date' },
    raw: { bsonType: 'object' },
  },
};
