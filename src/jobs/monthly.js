'use strict';

const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const logger = require('../utils/logger').child({ context: 'monthly-job' });
const { getCompetencia } = require('../utils/competencia');
const { authenticate } = require('../auth/govbr');
const { createClient } = require('../esocial/client');
const { listarFolhasAbertas, verificarCompetencia, encerrarFolha } = require('../esocial/folha');
const { gerarGuia, downloadGuiaPDF } = require('../esocial/guia');
const { sendEmail } = require('../notifications/email');
const { sendWhatsApp } = require('../notifications/whatsapp');

const LOCK_FILE = '/tmp/esocial-auto.lock';
const GUIAS_DIR = path.resolve(__dirname, '../../output/guias');

/**
 * Acquire a file lock to prevent concurrent runs.
 * Uses flag 'wx' for atomic creation. Writes PID for stale detection.
 */
function acquireLock() {
  try {
    fs.writeFileSync(LOCK_FILE, String(process.pid), { flag: 'wx' });
    logger.info(`Lock acquired: ${LOCK_FILE} (PID ${process.pid})`);
  } catch (err) {
    if (err.code === 'EEXIST') {
      // Check for stale lock
      try {
        const pid = parseInt(fs.readFileSync(LOCK_FILE, 'utf8').trim(), 10);
        try {
          process.kill(pid, 0); // Check if process exists
          throw new Error(`Job already running (PID ${pid}). Lock file: ${LOCK_FILE}`);
        } catch (killErr) {
          if (killErr.code === 'ESRCH') {
            logger.warn(`Stale lock detected (PID ${pid} not running), removing`);
            fs.unlinkSync(LOCK_FILE);
            fs.writeFileSync(LOCK_FILE, String(process.pid), { flag: 'wx' });
            logger.info(`Lock re-acquired: ${LOCK_FILE} (PID ${process.pid})`);
            return;
          }
          throw killErr;
        }
      } catch (readErr) {
        if (readErr.message.includes('already running')) throw readErr;
        throw new Error(`Cannot read lock file: ${readErr.message}`);
      }
    }
    throw err;
  }
}

/**
 * Release the file lock.
 */
function releaseLock() {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      fs.unlinkSync(LOCK_FILE);
      logger.info('Lock released');
    }
  } catch (err) {
    logger.warn(`Failed to release lock: ${err.message}`);
  }
}

/**
 * Execute the full monthly job sequence:
 * 1. Acquire lock
 * 2. Authenticate via gov.br
 * 3. Create HTTP client
 * 4. Calculate competência
 * 5. List/verify/close payroll
 * 6. Generate DAE + download PDF
 * 7. Send success email with PDF
 * 8. Send WhatsApp success message
 * 9. Release lock
 */
async function runJob() {
  logger.info('=== Iniciando job mensal eSocial ===');

  acquireLock();

  try {
    // Step 1: Authenticate
    logger.info('Autenticando via gov.br...');
    const session = await authenticate();
    logger.info('Autenticação concluída');

    // Step 2: Create HTTP client
    const client = createClient(session);

    // Step 3: Calculate competência
    const competencia = getCompetencia();
    const periodo = `${String(competencia.mes).padStart(2, '0')}/${competencia.ano}`;
    logger.info(`Competência alvo: ${periodo}`);

    // Step 4: List and verify payroll
    const folhas = await listarFolhasAbertas(client);
    logger.info(`Folhas abertas: ${folhas.length}`);

    await verificarCompetencia(client, competencia);

    // Step 5: Close payroll
    const resultado = await encerrarFolha(client, competencia);
    logger.info(`Resultado encerramento: ${JSON.stringify(resultado)}`);

    // Step 6: Generate DAE and download PDF
    const guiaId = await gerarGuia(client, competencia);
    const pdfFilename = `DAE-${String(competencia.mes).padStart(2, '0')}-${competencia.ano}.pdf`;
    const pdfPath = path.join(GUIAS_DIR, pdfFilename);
    await downloadGuiaPDF(client, guiaId, pdfPath);

    // Step 7: Send success email with PDF
    try {
      await sendEmail({
        subject: `eSocial — DAE ${periodo} gerada com sucesso`,
        body: `A guia DAE para a competência ${periodo} foi gerada e está em anexo.`,
        attachments: [{ filename: pdfFilename, path: pdfPath }],
      });
      logger.info('E-mail de sucesso enviado');
    } catch (emailErr) {
      logger.error(`Falha ao enviar e-mail de sucesso: ${emailErr.message}`);
    }

    // Step 8: Send WhatsApp success message
    try {
      const whatsappNumber = process.env.WHATSAPP_NUMBER;
      if (whatsappNumber) {
        await sendWhatsApp(
          whatsappNumber,
          `✅ eSocial — DAE ${periodo} gerada com sucesso. PDF salvo em ${pdfPath}`,
        );
        logger.info('WhatsApp de sucesso enviado');
      }
    } catch (waErr) {
      logger.error(`Falha ao enviar WhatsApp de sucesso: ${waErr.message}`);
    }

    logger.info('=== Job mensal concluído com sucesso ===');
  } catch (error) {
    logger.error(`Erro no job mensal: ${error.message}`);

    // Best-effort error notifications
    try {
      await sendEmail({
        subject: 'eSocial — ERRO no job mensal',
        body: `Erro durante execução do job mensal:\n\n${error.message}\n\n${error.stack || ''}`,
        isError: true,
      });
    } catch (emailErr) {
      logger.error(`Falha ao enviar e-mail de erro: ${emailErr.message}`);
    }

    try {
      const whatsappNumber = process.env.WHATSAPP_NUMBER;
      if (whatsappNumber) {
        await sendWhatsApp(
          whatsappNumber,
          `❌ eSocial — ERRO no job mensal: ${error.message}`,
        );
      }
    } catch (waErr) {
      logger.error(`Falha ao enviar WhatsApp de erro: ${waErr.message}`);
    }

    throw error;
  } finally {
    releaseLock();
  }
}

/**
 * Build cron expression from JOB_DIA_FECHAMENTO env var.
 * Generates "0 8 <day> * *" schedule.
 *
 * @param {string|number} day - Day of month
 * @returns {string} Cron expression
 */
function buildCronFromDay(day) {
  const d = Number(day);
  if (isNaN(d) || d < 1 || d > 31) {
    throw new Error(`JOB_DIA_FECHAMENTO inválido: ${day}`);
  }
  return `0 8 ${d} * *`;
}

/**
 * Configure node-cron schedule for the monthly job.
 * Uses CRON_SCHEDULE env var or builds from JOB_DIA_FECHAMENTO.
 * Timezone: America/Sao_Paulo.
 *
 * @param {string} [cronExpression] - Pre-validated cron expression; if omitted, re-derives from env vars.
 * @returns {import('node-cron').ScheduledTask}
 */
function setupCron(cronExpression) {
  let schedule = cronExpression;

  if (!schedule) {
    schedule = process.env.CRON_SCHEDULE;
  }

  if (!schedule && process.env.JOB_DIA_FECHAMENTO) {
    schedule = buildCronFromDay(process.env.JOB_DIA_FECHAMENTO);
  }

  if (!schedule) {
    schedule = '0 8 7 * *'; // Default: 7th of each month at 08:00
    logger.info(`Nenhum schedule configurado, usando padrão: ${schedule}`);
  }

  if (!cron.validate(schedule)) {
    throw new Error(`Expressão cron inválida: ${schedule}`);
  }

  logger.info(`Cron configurado: "${schedule}" (America/Sao_Paulo)`);

  const task = cron.schedule(schedule, async () => {
    try {
      await runJob();
    } catch (err) {
      logger.error(`Job falhou: ${err.message}`);
    }
  }, {
    timezone: 'America/Sao_Paulo',
  });

  return task;
}

module.exports = { runJob, setupCron, getCompetencia };
