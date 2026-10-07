import express from 'express';
import { env } from '../../config/env.js';

const router = express.Router();

router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: env.serverVersion,
    environment: env.nodeEnv,
    uptime: process.uptime(),
  });
});

export default router;
