import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildZohoContactPayload,
  buildZohoInvoicePayload,
  buildZohoQuotePayload,
} from './masterDataService.js';

const customer = {
  zohoCustomerId: '123456789',
  billingAddress: 'customer_hm\nno 2 chennai\ntamilnadu\nindia',
  shippingAddress: 'customer_hm\nno 2 chennai\ntamilnadu\nindia',
};

const lineItems = [{
  name: 'Wall Cabinet',
  description: 'Shaker White',
  quantity: 2,
  rate: 46.35,
  discount: 0,
  taxPercentage: 0,
}];

test('Zoho contact payload omits invalid email but retains other customer details', () => {
  const payload = buildZohoContactPayload({
    displayName: 'Heman Num',
    email: '+91_9345826135_Afte',
    phone: '9345826135',
  });

  assert.equal(payload.contact_name, 'Heman Num');
  assert.equal(payload.phone, '9345826135');
  assert.equal('email' in payload, false);
});

test('Zoho contact payload includes a valid normalized email', () => {
  const payload = buildZohoContactPayload({
    displayName: 'Customer Name',
    email: ' Customer@Example.com ',
  });

  assert.equal(payload.email, 'customer@example.com');
});

test('Zoho quote payload includes customer billing and shipping addresses', () => {
  const payload = buildZohoQuotePayload({
    quoteNumber: 'Q-1001',
    quoteDate: new Date('2026-09-10T00:00:00.000Z'),
    lineItems,
  }, customer);

  assert.deepEqual(payload.billing_address, { address: customer.billingAddress });
  assert.deepEqual(payload.shipping_address, { address: customer.shippingAddress });
});

test('Zoho invoice payload includes customer billing and shipping addresses', () => {
  const payload = buildZohoInvoicePayload({
    invoiceNumber: 'INV-1001',
    invoiceDate: new Date('2026-09-10T00:00:00.000Z'),
    dueDate: new Date('2026-09-10T00:00:00.000Z'),
    lineItems,
  }, customer);

  assert.deepEqual(payload.billing_address, { address: customer.billingAddress });
  assert.deepEqual(payload.shipping_address, { address: customer.shippingAddress });
});

test('Zoho sales document payloads omit empty customer addresses', () => {
  const payload = buildZohoQuotePayload({
    quoteNumber: 'Q-1002',
    quoteDate: new Date('2026-09-10T00:00:00.000Z'),
    lineItems,
  }, {
    zohoCustomerId: '123456789',
    billingAddress: '',
    shippingAddress: null,
  });

  assert.equal('billing_address' in payload, false);
  assert.equal('shipping_address' in payload, false);
});

test('Zoho sales document payloads omit placeholder addresses', () => {
  const payload = buildZohoQuotePayload({
    quoteNumber: 'Q-1003',
    quoteDate: new Date('2026-09-10T00:00:00.000Z'),
    lineItems,
  }, {
    zohoCustomerId: '123456789',
    billingAddress: 'Not provided',
    shippingAddress: 'N/A',
  });

  assert.equal('billing_address' in payload, false);
  assert.equal('shipping_address' in payload, false);
});

test('Zoho contact addresses override stale local placeholders', () => {
  const payload = buildZohoQuotePayload({
    quoteNumber: 'Q-1004',
    quoteDate: new Date('2026-09-10T00:00:00.000Z'),
    lineItems,
  }, {
    zohoCustomerId: '123456789',
    billingAddress: 'Not provided',
    shippingAddress: null,
  }, {
    zohoContact: {
      billing_address: {
        address: 'no 2 chennai',
        state: 'tamilnadu',
        country: 'india',
      },
      shipping_address: {
        address: 'no 2 chennai',
        state: 'tamilnadu',
        country: 'india',
      },
    },
  });

  assert.deepEqual(payload.billing_address, {
    address: 'no 2 chennai',
    state: 'tamilnadu',
    country: 'india',
  });
  assert.deepEqual(payload.shipping_address, {
    address: 'no 2 chennai',
    state: 'tamilnadu',
    country: 'india',
  });
});
