'use strict';

require('dotenv').config();
const cron = require('node-cron');
const { authenticate } = require('../auth/govbr');
const { createClient } = require('../esocial/client');
const { verificarCompetencia, encerrarFolha } = require('../esocial/folha');
const { gerarGuia, downloadGuiaPDF } = require('../esocial/guia');
const { sendSuccessEmail, sendFailureEmail } = require('../notifications/email');
const { sendWhatsApp } = require('../notifications/whatsapp');
const { createContextLogger } = require('../utils/logger');

const log = createContextLogger('monthlyJob');

const JOB_DIA = process.env.JOB_DIA_FECHAMENTO || '7';

/**
 * Build the competência object from .env.
 * @returns {{ mes: string, ano: string }}
 */
function getCompetencia() {
  const mes = process.env.COMPETENCIA_MES;
  const ano = process.env.COMPETENCIA_ANO;
  if (!mes || !ano) {
    throw new Error('COMPETENCIA_MES and COMPETENCIA_ANO must be set in .env');
  }
  return { mes, ano };
}

/**
 * Core job logic: authenticate → check/close folha → generate DAE → notify.
 *
 * @returns {Promise<void>}
 */
async function runJob() {
  const competencia = getCompetencia();
  const { mes, ano } = competencia;
  const jobLabel = `${String(mes).padStart(2, '0')}/${ano}`;

  log.info(`===== Starting monthly job for competência ${jobLabel} =====`);
  const startedAt = Date.now();

  let pdfPath = null;

  try {
    // ── Step 1: Authenticate ──────────────────────────────────────────────────
    log.info('Step 1/5: Authenticating with gov.br');
    const session = await authenticate();
    const client = createClient(session);

    // ── Step 2: Check competência status ─────────────────────────────────────
    log.info('Step 2/5: Checking competência status');
    const { encerrada, status } = await verificarCompetencia(client, competencia);

    if (encerrada) {
      log.info(`Competência ${jobLabel} already closed (status: ${status}) — skipping encerramento`);
    } else {
      // ── Step 3: Close folha ───────────────────────────────────────────────
      log.info('Step 3/5: Closing folha');
      const result = await encerrarFolha(client, competencia);
      log.info(`Folha encerrada: ${result.message}`);
    }

    // ── Step 4: Generate and download DAE guide ───────────────────────────────
    log.info('Step 4/5: Generating DAE guide');
    const idGuia = await gerarGuia(client, competencia);

    log.info('Downloading DAE PDF');
    pdfPath = await downloadGuiaPDF(client, idGuia, competencia);

    // ── Step 5: Send notifications ───────────────────────────────────────────
    log.info('Step 5/5: Sending notifications');

    const whatsappMsg =
      `✅ eSocial Doméstico\n` +
      `Folha encerrada e guia gerada — competência ${jobLabel}.\n` +
      `O PDF da DAE foi enviado por e-mail.`;

    const [emailResult, whatsappResult] = await Promise.allSettled([
      sendSuccessEmail(competencia, pdfPath),
      sendWhatsApp(whatsappMsg),
    ]);

    if (emailResult.status === 'rejected') {
      log.error(`E-mail notification failed: ${emailResult.reason?.message}`);
    } else {
      log.info('E-mail notification sent successfully');
    }

    if (whatsappResult.status === 'rejected') {
      log.error(`WhatsApp notification failed: ${whatsappResult.reason?.message}`);
    } else {
      log.info('WhatsApp notification sent successfully');
    }

    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    log.info(`===== Monthly job completed in ${elapsed}s for competência ${jobLabel} =====`);
  } catch (err) {
    log.error(`Monthly job FAILED for ${jobLabel}: ${err.message}`, { stack: err.stack });

    // Send failure notifications (best-effort — do not throw)
    await Promise.allSettled([
      sendFailureEmail(err, competencia),
      sendWhatsApp(
        `❌ eSocial Doméstico\nFalha no job para competência ${jobLabel}.\nErro: ${err.message}\nVerifique os logs.`
      ),
    ]);

    throw err;
  }
}

/**
 * Configure and start the node-cron scheduler.
 *
 * The job runs at 06:00 on the day defined by JOB_DIA_FECHAMENTO.
 *
 * @returns {import('node-cron').ScheduledTask}
 */
function setupCron() {
  // Cron: minute=0, hour=6, day=JOB_DIA, any month, any day-of-week
  const cronExpression = `0 6 ${JOB_DIA} * *`;
  log.info(`Setting up cron job: "${cronExpression}" (day ${JOB_DIA} of each month at 06:00)`);

  const task = cron.schedule(cronExpression, async () => {
    log.info('Cron triggered — running monthly job');
    try {
      await runJob();
    } catch (err) {
      // Already logged and notified inside runJob
    }
  });

  log.info('Cron job scheduled');
  return task;
}

module.exports = { runJob, setupCron };
