/**
 * Server bootstrapper.
 *
 * Responsible for starting the Express app, connecting databases and
 * handling termination signals to shut down gracefully.
 */
import app from './app.js';
import { initializeCustomerEchoGraph } from './langgraph/customerEchoGraph.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { closeDatabases, connectDatabases } from './config/db.js';
import { ensurePlanMasterSeed } from './services/planMasterService.js';

async function startServer() {
  /**
   * Connect databases, start listening and wire graceful shutdown
   */
  try {
    await connectDatabases();
    await ensurePlanMasterSeed();

    const onServerStarted = () => {
      logger.info('FSM Agent server started', {
        version: env.serverVersion,
        port: env.port,
        environment: env.nodeEnv,
      });
    };

    initializeCustomerEchoGraph();

    const server = app.listen(env.port, onServerStarted);

    const shutdown = async (signal) => {
      logger.info('Shutdown signal received', { signal });

      server.close(async () => {
        await closeDatabases();
        process.exit(0);
      });
    };

    process.on('SIGINT', () => {
      void shutdown('SIGINT');
    });

    process.on('SIGTERM', () => {
      void shutdown('SIGTERM');
    });
  } catch (error) {
    logger.error('Failed to start server', {
      error: error.message,
      stack: error.stack,
    });
    process.exit(1);
  }
}

void startServer();
