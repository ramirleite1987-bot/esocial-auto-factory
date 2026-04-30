'use strict';

const axios = require('axios');
const logger = require('../utils/logger').child({ context: 'slack' });

const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Send a message to Slack via incoming webhook.
 * Opt-in: no-op when SLACK_WEBHOOK_URL is unset.
 * Best-effort — never throws; errors are logged.
 *
 * @param {string} text - Message text (supports Slack mrkdwn)
 * @param {object} [opts]
 * @param {string} [opts.username] - Override default bot name
 * @param {string} [opts.iconEmoji] - Override default emoji icon (e.g. ':rotating_light:')
 * @returns {Promise<boolean>} true if message was delivered
 */
async function sendSlack(text, opts = {}) {
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook) {
    logger.debug('SLACK_WEBHOOK_URL not configured, skipping Slack notification');
    return false;
  }

  const timeout = Number(process.env.SLACK_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  const payload = { text };
  if (opts.username) payload.username = opts.username;
  if (opts.iconEmoji) payload.icon_emoji = opts.iconEmoji;

  try {
    await axios.post(webhook, payload, { timeout });
    logger.info('Slack notification sent');
    return true;
  } catch (err) {
    logger.error(`Failed to send Slack notification: ${err.message}`);
    return false;
  }
}

module.exports = { sendSlack };
