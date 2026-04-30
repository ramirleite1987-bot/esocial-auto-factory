'use strict';

const cron = require('node-cron');

const DEFAULT_SCHEDULE = '0 8 7 * *';

/**
 * Resolve and validate the cron schedule from environment variables.
 *
 * Precedence: CRON_SCHEDULE > JOB_DIA_FECHAMENTO > default ("0 8 7 * *").
 * When JOB_DIA_FECHAMENTO is used, the day must be an integer 1-31 — otherwise
 * a misconfiguration like "abc" would surface as the confusing message
 * "Invalid cron expression: 0 8 NaN * *".
 *
 * @returns {string} Validated cron expression.
 * @throws {Error} When the day is out of range or the expression is invalid.
 */
function resolveSchedule() {
  let schedule = process.env.CRON_SCHEDULE;

  if (!schedule && process.env.JOB_DIA_FECHAMENTO) {
    const raw = process.env.JOB_DIA_FECHAMENTO;
    const day = Number(raw);
    if (!Number.isInteger(day) || day < 1 || day > 31) {
      throw new Error(
        `JOB_DIA_FECHAMENTO inválido: "${raw}" (esperado inteiro entre 1 e 31)`,
      );
    }
    schedule = `0 8 ${day} * *`;
  }

  if (!schedule) {
    schedule = DEFAULT_SCHEDULE;
  }

  if (!cron.validate(schedule)) {
    throw new Error(`Invalid cron expression: ${schedule}`);
  }

  return schedule;
}

module.exports = { resolveSchedule, DEFAULT_SCHEDULE };
