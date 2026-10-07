import { Router } from 'express';
import onboardingRoutes from './onboardingRoutes.js';
import masterDataRoutes from './masterDataRoutes.js';
import developerMonitorRoutes from './developerMonitorRoutes.js';

const router = Router();

router.use('/onboarding', onboardingRoutes);
router.use('/master-data', masterDataRoutes);
router.use('/developer-monitor', developerMonitorRoutes);

export default router;
