import { Router } from 'express';
import {
  createOnboardingRequest,
  getExistingOnboardingRequest,
  getUserDetails,
} from '../../controller/web/provisioningController.js';
import {
  getInventoryOrganizationStatusRequest,
  retryInventoryOrganizationSyncRequest,
} from '../../controller/web/inventoryOrganizationController.js';

const router = Router();

router.post('/user-details', getUserDetails);
router.post('/existing', getExistingOnboardingRequest);
router.post('/complete', createOnboardingRequest);
router.post('/inventory-organization/status', getInventoryOrganizationStatusRequest);
router.post('/inventory-organization/sync', retryInventoryOrganizationSyncRequest);

export default router;
