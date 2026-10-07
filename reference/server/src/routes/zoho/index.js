import { Router } from 'express';
import {
  getExistingZohoStatus,
  getZohoAuthorizeLink,
  handleZohoCallback,
  selectZohoOrganization,
  updateZohoAutoSync,
} from '../../controller/zoho/zohoController.js';

const router = Router();

router.post('/status', getExistingZohoStatus);
router.post('/select-organization', selectZohoOrganization);
router.post('/auto-sync', updateZohoAutoSync);
router.post('/authorize', getZohoAuthorizeLink);
router.get('/oauth/callback', handleZohoCallback);

export default router;
