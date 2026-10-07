import { Router } from 'express';
import { handleStandardEOService } from '../../controller/eo/standardEOController.js';
import { ensureRegisteredBotUser } from '../../middleware/eoBotUserMiddleware.js';

const router = Router();

router.post('/', ensureRegisteredBotUser, handleStandardEOService);

export default router;
