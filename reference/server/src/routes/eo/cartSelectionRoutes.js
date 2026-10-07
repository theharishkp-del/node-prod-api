import { Router } from 'express';
import { getCartSelection, submitCartSelection } from '../../controller/eo/cartSelectionController.js';

const router = Router();
router.get('/:token', getCartSelection);
router.post('/:token/submit', submitCartSelection);
export default router;
