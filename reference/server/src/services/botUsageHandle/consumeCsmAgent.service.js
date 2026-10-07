import {
  buildBotUsageRequestContext,
  buildUsagePayload,
} from './shared.js';
import { callEntitlementService } from './client.js';

export async function consumeCsmAgent(req, parameter, overrides = {}) {
  const context = buildBotUsageRequestContext(req);
  const payload = buildUsagePayload(context, {
    parameter,
    ...overrides,
  });

  return callEntitlementService('consume-csm-agent', payload, {
    requestId: req?.id || req?.requestId || '',
  });
}
