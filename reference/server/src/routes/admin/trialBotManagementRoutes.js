import { Router } from 'express';
import { developerMonitorAuth } from '../../middleware/developerMonitorAuthMiddleware.js';
import {
  handleListTrialBots,
  handleAddTrialBot,
  handleUpdateTrialBot,
  handleRemoveTrialBot,
} from '../../controller/admin/trialBotManagementController.js';

const router = Router();

router.use(developerMonitorAuth);

/**
 * GET /admin/trial-bots
 * List all trial bots in the trial plan
 */
router.get('/', handleListTrialBots);

/**
 * POST /admin/trial-bots
 * Add a new trial bot to the trial plan
 * Body: { botId, noOfDays, maxUsers, trialEndMessage? }
 */
router.post('/', handleAddTrialBot);

/**
 * PUT /admin/trial-bots/:botId
 * Update an existing trial bot configuration
 * Body: { noOfDays?, maxUsers?, trialEndMessage?, ... }
 */
router.put('/:botId', handleUpdateTrialBot);

/**
 * DELETE /admin/trial-bots/:botId
 * Remove a trial bot from the trial plan
 */
router.delete('/:botId', handleRemoveTrialBot);

export default router;
