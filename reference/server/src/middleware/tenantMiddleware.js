import { logger } from '../config/logger.js';
import { getTenantDb, getTenantRegistry } from '../utils/tenantManager.js';

export async function tenantInterceptor(req, res, next) {
  try {
    // Web API tenant resolution runs before controllers so downstream services share
    // one database and tenant context for the entire request.
    req.logFlowStep?.('tenant_resolution_started');
    const botUserId = req.header('x-bot-user-id') || req.body?.botUserId;

    if (!botUserId) {
      logger.warn('Tenant context rejected: bot user ID is missing', {
        path: req.originalUrl,
      });
      return res.status(403).json({
        status: 'access_denied',
        message: 'Please contact admin to use this feature.',
      });
    }

    const tenant = await getTenantRegistry(botUserId);

    if (!tenant) {
      logger.warn('Tenant context rejected: tenant registry entry was not found', {
        botUserId,
        path: req.originalUrl,
      });
      return res.status(403).json({
        status: 'tenant_not_found',
        message: 'Please contact admin to use this feature.',
      });
    }

    req.botUserId = botUserId;
    req.tenant = tenant;
    req.tenantDb = await getTenantDb(botUserId);
    req.logFlowStep?.('tenant_resolution_completed', {
      botUserId,
      tenantId: tenant.tenantId || null,
      databaseName: tenant.databaseName || null,
    });

    logger.info('Tenant context resolved', {
      botUserId,
      databaseName: tenant.databaseName,
      path: req.originalUrl,
    });

    next();
  } catch (error) {
    req.logFlowStep?.('tenant_resolution_failed', { error: error.message });
    next(error);
  }
}
