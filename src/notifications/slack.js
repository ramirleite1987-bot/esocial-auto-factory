'use strict';

const axios = require('axios');
const logger = require('../utils/logger').child({ context: 'slack' });

const WEBHOOK_TIMEOUT_MS = 10_000;

/**
 * Resolve the Slack incoming webhook URL from the environment.
 * @returns {string|null}
 */
function getWebhookUrl() {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return null;
  if (!/^https:\/\/hooks\.slack\.com\//.test(url)) {
    logger.warn('SLACK_WEBHOOK_URL is set but does not match Slack incoming webhook pattern');
  }
  return url;
}

/**
 * Build a Block Kit payload with a header, body section, and optional fields.
 * @param {object} opts
 * @param {string} opts.emoji      - Leading emoji for the header
 * @param {string} opts.title      - Header title
 * @param {string} opts.text       - Plain-text fallback (used by clients that don't render blocks)
 * @param {string} [opts.body]     - Markdown body shown under the header
 * @param {string} [opts.channel]  - Optional channel override
 * @param {Array<{label:string,value:string}>} [opts.fields] - Key/value pairs rendered in a 2-col grid
 * @returns {object} Slack webhook payload
 */
function buildPayload({ emoji, title, text, body, fields, channel }) {
  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `${emoji} ${title}`, emoji: true },
    },
  ];

  if (body) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: body } });
  }

  if (Array.isArray(fields) && fields.length > 0) {
    blocks.push({
      type: 'section',
      fields: fields.slice(0, 10).map((f) => ({
        type: 'mrkdwn',
        text: `*${f.label}*\n${f.value}`,
      })),
    });
  }

  blocks.push({
    type: 'context',
    elements: [
      { type: 'mrkdwn', text: `_eSocial Auto • ${new Date().toISOString()}_` },
    ],
  });

  const payload = { text, blocks };
  if (channel) payload.channel = channel;
  return payload;
}

/**
 * Post a payload to the configured Slack incoming webhook.
 * Best-effort — never throws. No-op when SLACK_WEBHOOK_URL is unset.
 * @param {object} payload - Slack webhook JSON payload
 * @returns {Promise<boolean>} true if the message was accepted by Slack
 */
async function sendSlack(payload) {
  const url = getWebhookUrl();
  if (!url) {
    logger.debug('SLACK_WEBHOOK_URL not configured — skipping Slack notification');
    return false;
  }

  try {
    const response = await axios.post(url, payload, {
      timeout: WEBHOOK_TIMEOUT_MS,
      headers: { 'Content-Type': 'application/json' },
    });

    if (response.status !== 200 || response.data !== 'ok') {
      logger.warn(`Slack webhook returned unexpected response: ${response.status} ${JSON.stringify(response.data)}`);
      return false;
    }
    logger.info('Slack notification sent');
    return true;
  } catch (err) {
    const status = err.response ? err.response.status : null;
    logger.error(`Failed to send Slack notification${status ? ` (HTTP ${status})` : ''}: ${err.message}`);
    return false;
  }
}

/**
 * Notify Slack that a payment slip (DAE) is ready / a payment was processed.
 * Triggered when a "conta" / arrecadação is generated successfully.
 *
 * @param {object} opts
 * @param {string} opts.periodo  - Competency period (e.g. "03/2025")
 * @param {string} [opts.pdfPath] - Local path to the generated PDF
 * @param {number|string} [opts.valor] - Amount, when known
 * @param {string} [opts.guiaId] - Identifier returned by eSocial
 */
async function notifyPayment({ periodo, pdfPath, valor, guiaId } = {}) {
  const fields = [];
  if (periodo) fields.push({ label: 'Competência', value: periodo });
  if (guiaId) fields.push({ label: 'Guia', value: String(guiaId) });
  if (valor !== undefined && valor !== null && valor !== '') {
    const formatted = typeof valor === 'number'
      ? valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
      : String(valor);
    fields.push({ label: 'Valor', value: formatted });
  }
  if (pdfPath) fields.push({ label: 'PDF', value: `\`${pdfPath}\`` });

  return sendSlack(buildPayload({
    emoji: ':moneybag:',
    title: 'eSocial — Pagamento processado',
    text: `eSocial: pagamento/arrecadação processada${periodo ? ` para ${periodo}` : ''}.`,
    body: 'A guia DAE foi gerada/quitada com sucesso. Detalhes abaixo.',
    fields,
  }));
}

/**
 * Notify Slack about an integration problem that requires action.
 *
 * @param {object} opts
 * @param {string} opts.context - Short label of where the problem happened
 * @param {Error|string} opts.error - Error or message describing the failure
 * @param {string} [opts.periodo] - Competency period being processed
 */
async function notifyError({ context, error, periodo } = {}) {
  const message = error instanceof Error ? error.message : String(error || 'erro desconhecido');
  const fields = [];
  if (context) fields.push({ label: 'Contexto', value: context });
  if (periodo) fields.push({ label: 'Competência', value: periodo });
  fields.push({ label: 'Erro', value: '`' + message.slice(0, 500) + '`' });

  return sendSlack(buildPayload({
    emoji: ':rotating_light:',
    title: 'eSocial — Problema na integração',
    text: `eSocial: falha na integração${context ? ` (${context})` : ''}: ${message}`,
    body: 'Uma falha foi detectada e precisa ser revisada manualmente.',
    fields,
  }));
}

/**
 * Notify Slack with a generic confirmation/step-completed message.
 *
 * @param {object} opts
 * @param {string} opts.title - Short title, e.g. "Folha encerrada"
 * @param {string} [opts.message] - Markdown body
 * @param {Array<{label:string,value:string}>} [opts.fields] - Optional key/value pairs
 */
async function notifyConfirmation({ title, message, fields } = {}) {
  return sendSlack(buildPayload({
    emoji: ':white_check_mark:',
    title: `eSocial — ${title || 'Confirmação'}`,
    text: `eSocial: ${title || 'confirmação'}${message ? ` — ${message}` : ''}`,
    body: message,
    fields,
  }));
}

module.exports = {
  sendSlack,
  notifyPayment,
  notifyError,
  notifyConfirmation,
  buildPayload,
  getWebhookUrl,
};
