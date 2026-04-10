'use strict';

require('dotenv').config();

const logger = require('./src/utils/logger').child({ context: 'main' });
const { initWhatsApp } = require('./src/notifications/whatsapp');
const { runJob, setupCron } = require('./src/jobs/monthly');

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
 * Validate the cron expression at startup.
 * Uses node-cron's validate function.
 */
function validateCron() {
  const cron = require('node-cron');
  let schedule = process.env.CRON_SCHEDULE;

  if (!schedule && process.env.JOB_DIA_FECHAMENTO) {
    const day = Number(process.env.JOB_DIA_FECHAMENTO);
    schedule = `0 8 ${day} * *`;
  }

  if (!schedule) {
    schedule = '0 8 7 * *';
  }

  if (!cron.validate(schedule)) {
    throw new Error(`Invalid cron expression: ${schedule}`);
  }

  return schedule;
}

/**
 * Application entry point.
 */
async function main() {
  const runNow = process.argv.includes('--run-now');

  // Validate environment and cron before anything else
  validateEnv();
  const schedule = validateCron();

  logger.info(`eSocial Auto starting — Node.js ${process.version}`);
  logger.info(`Cron schedule: ${schedule}`);

  const competenciaMes = process.env.COMPETENCIA_MES || 'auto';
  const competenciaAno = process.env.COMPETENCIA_ANO || 'auto';
  logger.info(`Competência target: ${competenciaMes}/${competenciaAno}`);

  // Fire-and-forget WhatsApp init — must not block cron/job startup
  initWhatsApp().catch((err) => {
    logger.error(`WhatsApp init error (non-fatal): ${err.message}`);
  });

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
