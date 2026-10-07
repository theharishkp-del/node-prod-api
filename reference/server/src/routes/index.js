import { Router } from 'express';
import webRoutes from './web/index.js';
import zohoRoutes from './zoho/index.js';
import ivrVoiceCallInitRoutes from './eo/ivrVoiceCallInitRoutes.js';
import aiMeetWidgetUrlRoutes from './eo/aiMeetWidgetUrlRoutes.js';
import standardEORoutes from './eo/standardEORoutes.js';
import cartSelectionRoutes from './eo/cartSelectionRoutes.js';
import productOrderRoutes from './eo/productOrderRoutes.js';
import trialBotManagementRoutes from './admin/trialBotManagementRoutes.js';



const router = Router();

// Route namespaces are intentionally grouped by channel before controller middleware runs.
router.get('/api/status', (_req, res) => {
  res.json({ status: 'ok', service: 'fsm-agent' });
});

router.use('/web/v1', webRoutes);
router.use('/zoho/v1', zohoRoutes);
router.use('/ivrVoiceCallInitEO', ivrVoiceCallInitRoutes);
router.use('/widgetUrl', aiMeetWidgetUrlRoutes);
router.use('/standardEOService', standardEORoutes);
router.use('/cart-selection', cartSelectionRoutes);
router.use('/product-order', productOrderRoutes);
router.use('/admin/trial-bots', trialBotManagementRoutes);



export default router;
