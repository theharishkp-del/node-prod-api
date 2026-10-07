import { Router } from 'express';
import { handleAiMeetWidgetUrl } from '../../controller/eo/aiMeetWidgetUrlController.js';
import { ensureRegisteredBotUser } from '../../middleware/eoBotUserMiddleware.js';
const router = Router();

router.post('/', ensureRegisteredBotUser, handleAiMeetWidgetUrl);

export default router;
