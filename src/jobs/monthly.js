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
const { notifyPayment, notifyError, notifyConfirmation } = require('../notifications/slack');
const { recordJobRun } = require('../health');
const { appendRun } = require('../utils/auditLog');

const LOCK_FILE = '/tmp/esocial-auto.lock';
const GUIAS_DIR = path.resolve(__dirname, '../../output/guias');
const MAX_RETRIES = Number(process.env.JOB_MAX_RETRIES) || 3;
const RETRY_BASE_DELAY_MS = 2000;

let currentRun = null;
let cronTask = null;

/**
 * Sleep for a given number of milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute an async function with retry and exponential backoff.
 * @param {Function} fn - Async function to execute
 * @param {string} label - Description for logging
 * @param {number} [maxRetries=MAX_RETRIES] - Maximum number of retries
 * @returns {Promise<*>} Result of fn()
 */
async function withRetry(fn, label, maxRetries = MAX_RETRIES) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const status = err.response ? err.response.status : null;

      // Don't retry on client errors (4xx) except 408 (timeout) and 429 (rate limit)
      if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) {
        throw err;
      }

      if (attempt < maxRetries) {
        const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
        logger.warn(`${label} falhou (tentativa ${attempt}/${maxRetries}): ${err.message}. Retentando em ${delay}ms...`);
        await sleep(delay);
      }
    }
  }
  logger.error(`${label} falhou após ${maxRetries} tentativas`);
  throw lastError;
}

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
  if (currentRun) {
    logger.warn('runJob called while a previous run is still in flight — awaiting existing run');
    return currentRun;
  }
  currentRun = _runJobImpl().finally(() => {
    currentRun = null;
  });
  return currentRun;
}

async function _runJobImpl() {
  logger.info('=== Iniciando job mensal eSocial ===');
  const startedAt = Date.now();
  let periodo = null;
  let pdfPath = null;

  acquireLock();

  try {
    // Step 1: Authenticate (with retry)
    logger.info('Autenticando via gov.br...');
    const session = await withRetry(() => authenticate(), 'Autenticação gov.br');
    logger.info('Autenticação concluída');

    // Step 2: Create HTTP client
    const client = createClient(session);

    // Step 3: Calculate competência
    const competencia = getCompetencia();
    periodo = `${String(competencia.mes).padStart(2, '0')}/${competencia.ano}`;
    logger.info(`Competência alvo: ${periodo}`);

    // Step 4: List and verify payroll (with retry)
    const folhas = await withRetry(() => listarFolhasAbertas(client), 'Listar folhas');
    logger.info(`Folhas abertas: ${folhas.length}`);

    await withRetry(() => verificarCompetencia(client, competencia), 'Verificar competência');

    // Step 5: Close payroll (with retry)
    const resultado = await withRetry(() => encerrarFolha(client, competencia), 'Encerrar folha');
    logger.info(`Resultado encerramento: ${JSON.stringify(resultado)}`);

    // Slack confirmation: payroll closed
    notifyConfirmation({
      title: 'Folha encerrada',
      message: `Folha de pagamento da competência *${periodo}* encerrada com sucesso.`,
      fields: [
        { label: 'Competência', value: periodo },
        { label: 'Resultado', value: resultado && resultado.status ? String(resultado.status) : 'OK' },
      ],
    }).catch(() => {});

    // Step 6: Generate DAE and download PDF (with retry)
    const guiaId = await withRetry(() => gerarGuia(client, competencia), 'Gerar guia DAE');
    const pdfFilename = `DAE-${String(competencia.mes).padStart(2, '0')}-${competencia.ano}.pdf`;
    pdfPath = path.join(GUIAS_DIR, pdfFilename);
    await withRetry(() => downloadGuiaPDF(client, guiaId, pdfPath), 'Download PDF');

    // Slack notification: payment slip ready (DAE = arrecadação / "conta paga")
    notifyPayment({
      periodo,
      pdfPath,
      guiaId,
      valor: resultado && (resultado.valor || resultado.valorTotal),
    }).catch(() => {});

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

    recordJobRun('success');
    appendRun({
      status: 'success',
      periodo,
      pdfPath,
      durationMs: Date.now() - startedAt,
    });
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

    try {
      await notifyError({
        context: 'job mensal',
        error,
        periodo,
      });
    } catch (slackErr) {
      logger.error(`Falha ao enviar Slack de erro: ${slackErr.message}`);
    }

    recordJobRun('error');
    appendRun({
      status: 'error',
      periodo,
      error: error.message,
      durationMs: Date.now() - startedAt,
    });
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

  cronTask = task;
  return task;
}

/**
 * Whether a job execution is currently in flight.
 * @returns {boolean}
 */
function isRunning() {
  return currentRun !== null;
}

/**
 * Gracefully shut the job system down. Stops the cron scheduler so no new
 * runs are triggered, then awaits the in-flight run (if any) up to
 * `timeoutMs` (defaults to SHUTDOWN_GRACE_MS env var or 30s).
 *
 * Safe to call multiple times; idempotent.
 *
 * @param {number} [timeoutMs] - Max time to wait for the active job to finish
 * @returns {Promise<{stopped: boolean, drained: boolean, durationMs: number}>}
 *   `stopped` is true once the cron task is no longer scheduling new runs.
 *   `drained` is true if the active run (if any) finished within timeoutMs;
 *   false if the timeout elapsed first (the run may still be running).
 */
async function shutdown(timeoutMs) {
  const startedAt = Date.now();
  const grace = Number.isFinite(timeoutMs)
    ? timeoutMs
    : (Number(process.env.SHUTDOWN_GRACE_MS) || 30000);

  if (cronTask) {
    try {
      if (typeof cronTask.stop === 'function') cronTask.stop();
      if (typeof cronTask.destroy === 'function') cronTask.destroy();
      logger.info('Cron task parado');
    } catch (err) {
      logger.warn(`Falha ao parar cron task: ${err.message}`);
    }
    cronTask = null;
  }

  if (!currentRun) {
    return { stopped: true, drained: true, durationMs: Date.now() - startedAt };
  }

  logger.info(`Aguardando job em execução finalizar (até ${grace}ms)...`);

  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve('timeout'), grace);
  });

  const result = await Promise.race([
    currentRun.then(() => 'done').catch(() => 'done'),
    timeout,
  ]);
  clearTimeout(timer);

  const drained = result === 'done';
  if (!drained) {
    logger.warn(`Timeout de ${grace}ms atingido aguardando job; saindo com job ainda ativo`);
  } else {
    logger.info('Job finalizado limpo durante shutdown');
  }

  return { stopped: true, drained, durationMs: Date.now() - startedAt };
}

/**
 * Reset module-level state. Intended for tests only.
 */
function _resetForTests() {
  currentRun = null;
  cronTask = null;
}

module.exports = { runJob, setupCron, shutdown, isRunning, _resetForTests };
