import test from 'node:test';
import assert from 'node:assert/strict';

import { formatZohoAddress } from './zohoInitialImportService.js';

test('formats the complete Zoho address for MongoDB storage', () => {
  assert.equal(formatZohoAddress({
    attention: 'customer_hm',
    address: 'no 2 chennai',
    city: 'chennai',
    state: 'tamilnadu',
    country: 'india',
  }), 'no 2 chennai\nchennai\ntamilnadu\nindia');
});

test('does not persist Zoho address placeholders', () => {
  assert.equal(formatZohoAddress({ address: 'Imported from Zoho Books' }), null);
  assert.equal(formatZohoAddress({ address: 'Not provided' }), null);
});

test('preserves the multiline address shape returned by the Zoho customer detail API', () => {
  assert.equal(formatZohoAddress({
    address_id: '273561000000525002',
    attention: 'customer_hm',
    address: 'no 2 chennai\ntamilnadu\nindia',
    street2: '',
    city: '',
    state: '',
    zip: '',
    country: '',
  }), 'no 2 chennai\ntamilnadu\nindia');
});
