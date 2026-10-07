import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createProductOrderLink,
  decodeProductOrderKey,
} from '../productOrderLinkService.js';
import { env } from '../../config/env.js';

test('product-order key contains requested customer fields and link uses configured webpage base', () => {
  const { key, payload, url } = createProductOrderLink({
    tenant: {
      tenantId: 'tenant-1',
      databaseName: 'database-1',
      companyDetails: { currency: 'USD' },
    },
    botUserId: 'bot-1',
    tierMultiplier: 0.85,
    customer: {
      id: 'customer-1',
      cybotUserId: 'cybot-user-1',
      displayName: 'Customer One',
      currencyCode: 'cad',
      email: 'customer@example.com',
      phone: '5551234567',
    },
    reqMessageObj: {
      taskId: 'task-1',
      signalId: 'signal-1',
    },
  });

  assert.deepEqual(payload.customer, {
    id: 'customer-1',
    cybotUserId: 'cybot-user-1',
    name: 'Customer One',
  });
  assert.equal(
    payload.logoUrl,
    'https://cybots3pro.s3.us-east-1.amazonaws.com/afte/6157/Invoicelogo_Invoicelogo_IQLogoHorizontal_Clearbg_6157.png',
  );
  assert.equal(payload.tierMultiplier, 0.85);
  assert.equal(payload.currencyCode, 'CAD');
  assert.deepEqual(decodeProductOrderKey(key).customer, payload.customer);
  assert.equal(decodeProductOrderKey(key).logoUrl, payload.logoUrl);
  assert.equal(
    url,
    `${env.productOrderClientUrl.replace(/\/$/, '')}/product-order?key=${encodeURIComponent(key)}`,
  );
});
