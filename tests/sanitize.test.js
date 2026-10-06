'use strict';

process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/test';
process.env.LOG_TO_FILE = 'false';

const test = require('node:test');
const assert = require('node:assert/strict');
const { redact, truncate, sanitizeUrl, REDACTED } = require('../src/utils/sanitize');

test('redact masks sensitive keys at any depth, case-insensitively', () => {
  const input = {
    name: 'Ann',
    password: 'p',
    nested: { accessToken: 't', Authorization: 'Bearer x', ok: 1, list: [{ client_secret: 's' }] },
    'Set-Cookie': 'a=b',
  };
  const out = redact(input);
  assert.equal(out.name, 'Ann');
  assert.equal(out.password, REDACTED);
  assert.equal(out.nested.accessToken, REDACTED);
  assert.equal(out.nested.Authorization, REDACTED);
  assert.equal(out.nested.ok, 1);
  assert.equal(out.nested.list[0].client_secret, REDACTED);
  assert.equal(out['Set-Cookie'], REDACTED);
  assert.equal(input.password, 'p', 'original object must not be mutated');
});

test('redact handles circular references', () => {
  const a = { x: 1 };
  a.self = a;
  assert.equal(redact(a).self, '[Circular]');
});

test('truncate shortens large values', () => {
  const big = { data: 'x'.repeat(5000) };
  const out = truncate(big, 100);
  assert.equal(typeof out, 'string');
  assert.match(out, /truncated, \d+ chars total/);
  assert.deepEqual(truncate({ a: 1 }, 100), { a: 1 });
});

test('sanitizeUrl redacts sensitive query params', () => {
  assert.equal(sanitizeUrl('/a?token=abc&x=1'), `/a?token=${REDACTED}&x=1`);
  assert.equal(sanitizeUrl('/a?x=1'), '/a?x=1');
});
