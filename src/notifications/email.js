'use strict';

require('dotenv').config();
const nodemailer = require('nodemailer');
const fs = require('fs');
const { createContextLogger } = require('../utils/logger');

const log = createContextLogger('email');

const {
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASS,
  EMAIL_TO,
} = process.env;

/**
 * Build a Nodemailer transporter from .env credentials.
 * @returns {import('nodemailer').Transporter}
 */
function buildTransporter() {
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    throw new Error('SMTP_HOST, SMTP_PORT, SMTP_USER and SMTP_PASS must be set in .env');
  }
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

/**
 * Generate an HTML body for a success notification.
 * @param {{ mes: string|number, ano: string|number }} competencia
 * @param {string} extraInfo
 * @returns {string}
 */
function buildSuccessHtml(competencia, extraInfo = '') {
  const { mes, ano } = competencia;
  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#2e7d32">✅ eSocial Doméstico — Folha Encerrada com Sucesso</h2>
      <p><strong>Competência:</strong> ${String(mes).padStart(2, '0')}/${ano}</p>
      <p>A folha de pagamento foi encerrada e a guia DAE foi gerada automaticamente.</p>
      ${extraInfo ? `<p>${extraInfo}</p>` : ''}
      <p>A guia DAE (PDF) está em anexo a este e-mail.</p>
      <hr/>
      <p style="color:#666;font-size:12px">
        Esta mensagem foi gerada automaticamente pelo job eSocial Doméstico Automação.
      </p>
    </div>
  `;
}

/**
 * Generate an HTML body for a failure notification.
 * @param {string} errorMessage
 * @param {{ mes: string|number, ano: string|number }} competencia
 * @returns {string}
 */
function buildFailureHtml(errorMessage, competencia) {
  const { mes, ano } = competencia;
  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#c62828">❌ eSocial Doméstico — Falha na Execução do Job</h2>
      <p><strong>Competência:</strong> ${String(mes).padStart(2, '0')}/${ano}</p>
      <p><strong>Erro:</strong></p>
      <pre style="background:#f5f5f5;padding:12px;border-radius:4px;overflow:auto">${errorMessage}</pre>
      <p>Verifique os logs para mais detalhes e tome as ações necessárias antes do vencimento.</p>
      <hr/>
      <p style="color:#666;font-size:12px">
        Esta mensagem foi gerada automaticamente pelo job eSocial Doméstico Automação.
      </p>
    </div>
  `;
}

/**
 * Send an e-mail notification.
 *
 * @param {object} opts
 * @param {string} opts.subject  - E-mail subject
 * @param {string} opts.body     - HTML body
 * @param {Array<{ filename: string, path: string }>=} opts.attachments - Optional file attachments
 * @returns {Promise<void>}
 */
async function sendEmail({ subject, body, attachments = [] }) {
  if (!EMAIL_TO) {
    throw new Error('EMAIL_TO must be set in .env');
  }

  const transporter = buildTransporter();
  const mailOptions = {
    from: `"eSocial Job" <${SMTP_USER}>`,
    to: EMAIL_TO,
    subject,
    html: body,
    attachments: attachments.map((att) => ({
      filename: att.filename || att.path.split('/').pop(),
      path: att.path,
    })),
  };

  log.info(`Sending e-mail to ${EMAIL_TO}: "${subject}"`);

  try {
    const info = await transporter.sendMail(mailOptions);
    log.info(`E-mail sent — messageId: ${info.messageId}`);
  } catch (err) {
    log.error(`Failed to send e-mail: ${err.message}`);
    throw err;
  }
}

/**
 * Send a success notification with the DAE PDF attached.
 *
 * @param {{ mes: string|number, ano: string|number }} competencia
 * @param {string} pdfPath - Absolute path to the DAE PDF
 * @param {string=} extraInfo - Optional additional message
 */
async function sendSuccessEmail(competencia, pdfPath, extraInfo) {
  const { mes, ano } = competencia;
  const subject = `✅ eSocial — Folha encerrada e guia gerada — competência ${String(mes).padStart(2, '0')}/${ano}`;
  const body = buildSuccessHtml(competencia, extraInfo);
  const attachments = pdfPath && fs.existsSync(pdfPath)
    ? [{ path: pdfPath }]
    : [];

  await sendEmail({ subject, body, attachments });
}

/**
 * Send a failure notification.
 *
 * @param {Error|string} error
 * @param {{ mes: string|number, ano: string|number }} competencia
 */
async function sendFailureEmail(error, competencia) {
  const { mes, ano } = competencia;
  const errorMessage = error instanceof Error ? error.stack || error.message : String(error);
  const subject = `❌ eSocial — Falha no job — competência ${String(mes).padStart(2, '0')}/${ano}`;
  const body = buildFailureHtml(errorMessage, competencia);

  await sendEmail({ subject, body });
}

module.exports = { sendEmail, sendSuccessEmail, sendFailureEmail };
