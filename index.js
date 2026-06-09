'use strict';

require('dotenv').config();

const logger = require('./src/utils/logger').child({ context: 'main' });
const { initWhatsApp } = require('./src/notifications/whatsapp');
const { runJob, setupCron, shutdown } = require('./src/jobs/monthly');
const { startHealthServer } = require('./src/health');
const { resolveSchedule } = require('./src/utils/scheduleConfig');

let healthServer = null;
let shuttingDown = false;

const REQUIRED_ENV_VARS = ['GOVBR_CPF', 'GOVBR_SENHA'];

/**
 * Validate that all required environment variables are set.
 * Throws on first missing variable.
 */
function validateEnv() {
  const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

/**
 * Application entry point.
 */
async function main() {
  const runNow = process.argv.includes('--run-now');

  // Validate environment and cron before anything else
  validateEnv();
  const schedule = resolveSchedule();

  logger.info(`eSocial Auto starting — Node.js ${process.version}`);
  logger.info(`Cron schedule: ${schedule}`);

  const competenciaMes = process.env.COMPETENCIA_MES || 'auto';
  const competenciaAno = process.env.COMPETENCIA_ANO || 'auto';
  logger.info(`Competência target: ${competenciaMes}/${competenciaAno}`);

  // Fire-and-forget WhatsApp init — must not block cron/job startup
  initWhatsApp().catch((err) => {
    logger.error(`WhatsApp init error (non-fatal): ${err.message}`);
  });

  // Start health check server (if enabled)
  healthServer = startHealthServer();

  // Set up cron job
  setupCron(schedule);
  logger.info('Cron job configured');

  if (runNow) {
    logger.info('--run-now flag detected, executing job immediately');
    try {
      await runJob();
    } catch (err) {
      logger.error(`Immediate job run failed: ${err.message}`);
      process.exit(1);
    }
    process.exit(0);
  }

  logger.info('Waiting for scheduled cron execution...');
}

/**
 * Graceful shutdown: stop cron, wait for in-flight job, close health server.
 * Triggered by SIGTERM (Kubernetes/Docker stop) and SIGINT (Ctrl+C).
 */
async function gracefulShutdown(signal) {
  if (shuttingDown) {
    logger.warn(`${signal} received again — already shutting down`);
    return;
  }
  shuttingDown = true;
  logger.info(`${signal} received, iniciando graceful shutdown`);

  let exitCode = 0;
  try {
    const result = await shutdown();
    if (!result.drained) {
      logger.warn('Shutdown timeout; job em execução pode ter sido interrompido');
      exitCode = 1;
    }
  } catch (err) {
    logger.error(`Erro durante shutdown: ${err.message}`);
    exitCode = 1;
  }

  if (healthServer && typeof healthServer.close === 'function') {
    await new Promise((resolve) => healthServer.close(resolve));
    logger.info('Health server fechado');
  }

  logger.info(`Shutdown completo, saindo com código ${exitCode}`);
  process.exit(exitCode);
}

process.on('SIGTERM', () => { gracefulShutdown('SIGTERM'); });
process.on('SIGINT', () => { gracefulShutdown('SIGINT'); });

// Global error handlers
process.on('unhandledRejection', (reason) => {
  logger.error(`Unhandled rejection: ${reason instanceof Error ? reason.message : reason}`);
});

process.on('uncaughtException', (err) => {
  logger.error(`Uncaught exception: ${err.message}`);
  process.exit(1);
});

main().catch((err) => {
  logger.error(`Startup failed: ${err.message}`);
  process.exit(1);
});
