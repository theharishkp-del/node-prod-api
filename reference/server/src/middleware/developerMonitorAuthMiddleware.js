import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

function keysMatch(receivedKey, configuredKey) {
  const received = Buffer.from(String(receivedKey || ''), 'utf8');
  const configured = Buffer.from(String(configuredKey || ''), 'utf8');

  return received.length === configured.length && crypto.timingSafeEqual(received, configured);
}

export function developerMonitorAuth(req, res, next) {
  const configuredKey = String(env.developerMonitorKey || '').trim();

  if (!configuredKey) {
    logger.error('Developer monitor is disabled because DEVELOPER_MONITOR_KEY is not configured');
    return res.status(503).json({ status: 'developer_monitor_disabled', message: 'Developer monitor is not configured.' });
  }

  if (!keysMatch(req.header('x-developer-monitor-key'), configuredKey)) {
    logger.warn('Developer monitor access rejected', { path: req.originalUrl });
    return res.status(403).json({ status: 'access_denied', message: 'Invalid developer monitor key.' });
  }

  next();
}
