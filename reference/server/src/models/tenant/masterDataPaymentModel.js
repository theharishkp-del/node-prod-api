export const MASTER_DATA_PAYMENTS_COLLECTION = 'md_payments';

export const masterDataPaymentCollectionSchema = {
  bsonType: 'object',
  required: ['tenantId', 'botUserId', 'paymentNumber', 'customerId', 'invoiceId', 'paymentDate', 'amount', 'paymentMode', 'status', 'isDeleted', 'createdAt', 'updatedAt'],
  additionalProperties: true,
  properties: {
    tenantId: { bsonType: 'string' },
    botUserId: { bsonType: 'string' },
    paymentNumber: { bsonType: 'string' },
    customerId: { bsonType: 'objectId' },
    invoiceId: { bsonType: 'objectId' },
    paymentDate: { bsonType: 'date' },
    amount: { bsonType: 'number' },
    paymentMode: { bsonType: 'string' },
    referenceNumber: { bsonType: ['string', 'null'] },
    gatewayProvider: { bsonType: ['string', 'null'] },
    gatewayPaymentId: { bsonType: ['string', 'null'] },
    status: { bsonType: 'string' },
    notes: { bsonType: ['string', 'null'] },
    isDeleted: { bsonType: 'bool' },
    zohoPaymentId: { bsonType: ['string', 'null'] },
    zohoSyncStatus: { bsonType: 'string' },
    zohoLastSyncedAt: { bsonType: ['date', 'null'] },
    zohoErrorMessage: { bsonType: ['string', 'null'] },
    createdAt: { bsonType: 'date' },
    updatedAt: { bsonType: 'date' },
  },
};
