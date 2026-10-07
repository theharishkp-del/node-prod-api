import { Router } from 'express';
import { handleIvrVoiceCallInit } from '../../controller/eo/ivrVoiceCallInitController.js';
import { ensureRegisteredBotUser } from '../../middleware/eoBotUserMiddleware.js';

const router = Router();

router.post('/', ensureRegisteredBotUser, handleIvrVoiceCallInit);

export default router;
