export const ZOHO_INVOICES_COLLECTION = 'zoho_invoices';

export const zohoInvoiceCollectionSchema = {
  bsonType: 'object',
  required: ['zohoInvoiceId', 'organizationId', 'displayName', 'syncedAt', 'raw'],
  additionalProperties: true,
  properties: {
    zohoInvoiceId: { bsonType: 'string' },
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
