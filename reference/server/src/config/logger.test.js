import test from 'node:test';
import assert from 'node:assert/strict';
import { formatLogEntry, getRecentLogs, logger } from './logger.js';
import { formatRequestTraceBlock } from '../middleware/requestResponseLogger.js';

test('formatLogEntry renders readable console output with request details', () => {
  const formatted = formatLogEntry({
    timestamp: '2026-08-31T10:00:00.000Z',
    level: 'INFO',
    message: 'HTTP request received',
    requestId: 'req-123',
    method: 'POST',
    url: '/api/orders',
    ip: '127.0.0.1',
    flow: true,
    step: 'request_received',
  });

  assert.match(formatted, /HTTP request received/);
  assert.match(formatted, /requestId: req-123/);
  assert.match(formatted, /method: POST/);
  assert.match(formatted, /url: \/api\/orders/);
  assert.match(formatted, /step: request_received/);
});

test('formatRequestTraceBlock renders a multi-line request flow summary', () => {
  const block = formatRequestTraceBlock({
    requestId: 'req-123',
    method: 'POST',
    url: '/api/orders',
    statusCode: 200,
    durationMs: 155,
    requestFlow: [
      { step: 'request_received', elapsedMs: 5 },
      { step: 'request_completed', elapsedMs: 155 },
    ],
  });

  assert.match(block, /REQUEST TRACE/);
  assert.match(block, /requestId: req-123/);
  assert.match(block, /method: POST/);
  assert.match(block, /request_received/);
  assert.match(block, /request_completed/);
  assert.match(block, /statusCode: 200/);
});

test('getRecentLogs applies the API filter before limiting results', () => {
  const requestId = `test-api-filter-${Date.now()}`;
  logger.info('API request for filter test', {
    requestId,
    method: 'GET',
    url: '/api/filter-test',
  });

  for (let index = 0; index < 5; index += 1) {
    logger.info(`Application entry ${index} for filter test`);
  }

  const apiEntries = getRecentLogs({ limit: 1, kind: 'api', search: requestId });
  assert.equal(apiEntries.length, 1);
  assert.equal(apiEntries[0].requestId, requestId);
});
