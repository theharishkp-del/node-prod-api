'use strict';

/**
 * PM2 process file.
 *   npm i -g pm2
 *   pm2 start ecosystem.config.js --env production
 *   pm2 reload node-prod-api      # zero-downtime reload
 *
 * In cluster mode each worker gets NODE_APP_INSTANCE (0..n-1); the logger appends it
 * to file names (app-2026-W41-0.log, ...) so workers never rotate the same file.
 * App logs are written by winston to LOG_DIR, so PM2's stdout capture is discarded to
 * avoid duplicating every line on disk (use `pm2 logs` / LOG_TO_FILE as you prefer).
 */
module.exports = {
  apps: [
    {
      name: 'node-prod-api',
      script: 'src/server.js',
      exec_mode: 'cluster',
      instances: process.env.WEB_CONCURRENCY || 'max',
      // .env is still loaded by the app itself (dotenv); values below override it.
      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
      },
      // Graceful shutdown/startup
      wait_ready: true, // app calls process.send('ready') once listening
      listen_timeout: 10000,
      kill_timeout: 12000, // > SHUTDOWN_TIMEOUT_MS so the app can drain requests
      // Stability
      max_memory_restart: '512M',
      exp_backoff_restart_delay: 200,
      max_restarts: 20,
      min_uptime: '10s',
      autorestart: true,
      watch: false,
      out_file: '/dev/null',
      // stderr only carries crashes that happen before the logger exists (e.g. bad env)
      error_file: 'logs/pm2-error.log',
      merge_logs: true,
      time: false,
    },
  ],
};
