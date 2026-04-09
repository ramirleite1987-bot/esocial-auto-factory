'use strict';

require('dotenv').config();
const { initClient, destroyClient } = require('./src/notifications/whatsapp');
const { runJob, setupCron } = require('./src/jobs/monthly');
const { logger } = require('./src/utils/logger');

const RUN_NOW = process.argv.includes('--run-now');

/**
 * Graceful shutdown handler.
 */
async function shutdown(signal) {
  logger.info(`Received ${signal} — shutting down gracefully`);
  await destroyClient();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  logger.error(`Uncaught exception: ${err.message}`, { stack: err.stack });
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  logger.error(`Unhandled promise rejection: ${reason}`);
  process.exit(1);
});

/**
 * Application entry point.
 */
async function main() {
  logger.info('========================================');
  logger.info(' eSocial Doméstico — Job de Automação   ');
  logger.info('========================================');
  logger.info(`Node.js ${process.version} | PID ${process.pid}`);

  // Initialize WhatsApp client (may show QR code on first run)
  logger.info('Initializing WhatsApp client (this may display a QR code)...');
  try {
    await initClient();
    logger.info('WhatsApp client ready');
  } catch (err) {
    logger.error(`WhatsApp initialization failed: ${err.message}`);
    logger.warn('Continuing without WhatsApp — notifications will only be sent via e-mail');
  }

  if (RUN_NOW) {
    // Manual / immediate execution
    logger.info('--run-now flag detected — executing job immediately');
    try {
      await runJob();
    } catch (err) {
      logger.error(`Job execution failed: ${err.message}`);
      await destroyClient();
      process.exit(1);
    }
    await destroyClient();
    process.exit(0);
  } else {
    // Scheduled execution via cron
    setupCron();
    logger.info('Cron scheduler active — waiting for scheduled execution');
    logger.info('Press Ctrl+C to stop');
  }
}

main();
