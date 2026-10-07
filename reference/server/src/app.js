/**
 * Express application setup.
 *
 * Central place to register middleware, CORS settings, and primary
 * route mounts. Keeps the app configuration simple so `server.js`
 * can focus on lifecycle (start/shutdown).
 */
import cors from 'cors';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { requestResponseLogger } from './middleware/requestResponseLogger.js';
import routes from './routes/index.js';
import healthRoutes from './routes/status/healthRoutes.js';

const app = express();
const publicDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../public'
);

// API responses should always be fresh; conditional 304 responses break CRUD screens.
app.set('etag', false);

// Parse JSON bodies
app.use(express.json());

// Attach request logging (adds `x-request-id` and logs timing)
app.use(requestResponseLogger);

// Enable CORS using configured origin
app.use(
  cors({
    origin: env.corsOrigin,
  })
);

// Additional CORS headers and quick OPTIONS response
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', env.corsOrigin);
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-bot-user-id, x-bot-master-key, x-developer-monitor-key, Cache-Control, Pragma');
  res.header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.header('Pragma', 'no-cache');
  res.header('Expires', '0');

  if (req.method === 'OPTIONS') {
    req.requestId && res.setHeader('x-request-id', req.requestId);
    return res.sendStatus(204);
  }

  next();
});

// Angular's `dist/<app-name>/browser` contents are deployed here.
app.use('/hmclient', express.static(publicDirectory));

// Mount routes
app.use(routes);
app.use(healthRoutes);

// Let Angular handle client-side routes such as /hmclient/master-data.
app.get('/hmclient/{*angularRoute}', (_req, res, next) => {
  res.sendFile(path.join(publicDirectory, 'index.html'), (error) => {
    if (error) {
      next(error);
    }
  });
});

// Not found and error handlers
app.use(notFoundHandler);
app.use(errorHandler);
export default app;
