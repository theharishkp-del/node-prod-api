import { Router } from 'express';
import {
  confirmProductOrder,
  createProductOrderQuote,
  getProductOrder,
  getProductOrderStatus,
} from '../../controller/eo/productOrderController.js';

const router = Router();

router.get('/context', getProductOrder);
router.get('/status', getProductOrderStatus);
router.post('/quote', createProductOrderQuote);
router.post('/confirm', confirmProductOrder);

export default router;
