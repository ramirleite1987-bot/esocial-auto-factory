'use strict';

const nodemailer = require('nodemailer');
const logger = require('../utils/logger').child('email');

let transporter = null;

/**
 * Create SMTP transporter from environment variables and verify connection.
 * Best-effort — logs errors but never throws.
 */
async function initEmail() {
  try {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    await transporter.verify();
    logger.info('SMTP transporter verified successfully');
  } catch (err) {
    logger.error(`Failed to initialize SMTP transporter: ${err.message}`);
    transporter = null;
  }
}

/**
 * Build HTML for a success notification.
 * @param {string} body - Main message body
 * @returns {string} HTML string
 */
function successTemplate(body) {
  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
      <h2 style="color:#2e7d32;">✅ eSocial — Processamento Concluído</h2>
      <p>${body}</p>
      <hr/>
      <p style="font-size:12px;color:#888;">Mensagem automática — esocial-auto</p>
    </div>`;
}

/**
 * Build HTML for a failure notification.
 * @param {string} body - Error details
 * @returns {string} HTML string
 */
function failureTemplate(body) {
  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
      <h2 style="color:#c62828;">❌ eSocial — Falha no Processamento</h2>
      <p>${body}</p>
      <hr/>
      <p style="font-size:12px;color:#888;">Mensagem automática — esocial-auto</p>
    </div>`;
}

/**
 * Send an email notification. Best-effort — never throws.
 * @param {object} options
 * @param {string} options.subject - Email subject
 * @param {string} options.body - Email body text
 * @param {Array}  [options.attachments] - Nodemailer attachment objects
 * @param {boolean} [options.isError] - Use failure template when true
 */
async function sendEmail({ subject, body, attachments, isError = false } = {}) {
  try {
    if (!transporter) {
      logger.warn('SMTP transporter not initialized, attempting init...');
      await initEmail();
    }

    if (!transporter) {
      logger.error('SMTP transporter unavailable — skipping email');
      return;
    }

    const html = isError ? failureTemplate(body) : successTemplate(body);

    const mailOptions = {
      from: process.env.SMTP_USER,
      to: process.env.EMAIL_TO,
      subject,
      html,
      attachments: attachments || [],
    };

    const info = await transporter.sendMail(mailOptions);
    logger.info(`Email sent: ${info.messageId}`);
  } catch (err) {
    logger.error(`Failed to send email: ${err.message}`);
  }
}

module.exports = { initEmail, sendEmail };
