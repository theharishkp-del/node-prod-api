import {
  getInventoryOrganizationSyncStatus,
  retryInventoryOrganizationSync,
} from '../../services/inventoryOrganizationService.js';
import { logControllerStep } from './shared/controllerUtils.js';

function getBotUserId(req) {
  return String(req.body?.botUserId || req.params?.botUserId || '').trim();
}

export async function getInventoryOrganizationStatusRequest(req, res, next) {
  try {
    const botUserId = getBotUserId(req);
    const result = await getInventoryOrganizationSyncStatus(botUserId);
    return res.status(200).json({ status: 'SUCCESS', data: result });
  } catch (error) {
    next(error);
  }
}

export async function retryInventoryOrganizationSyncRequest(req, res, next) {
  try {
    const botUserId = getBotUserId(req);
    logControllerStep(req, 'Inventory organization sync retry started', { botUserId });
    const result = await retryInventoryOrganizationSync(botUserId);
    const statusCode = result.status === 'synced' ? 200 : 502;
    return res.status(statusCode).json({
      status: result.status === 'synced' ? 'SUCCESS' : 'FAILED',
      inventorySync: result,
    });
  } catch (error) {
    next(error);
  }
}
