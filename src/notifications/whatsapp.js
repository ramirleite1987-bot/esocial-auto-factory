'use strict';

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const logger = require('../utils/logger').child('whatsapp');

let client = null;

/**
 * Resolve the Chromium executable path bundled with Playwright.
 * Reusing it avoids downloading a second browser (~400MB).
 * @returns {string} Path to the Chromium binary
 */
function getChromiumPath() {
  try {
    const { chromium } = require('playwright');
    return chromium.executablePath();
  } catch {
    logger.warn('Playwright chromium path not found, falling back to default puppeteer behavior');
    return undefined;
  }
}

/**
 * Initialize WhatsApp Web client with LocalAuth strategy.
 * On first run a QR code is displayed in the terminal for pairing.
 * Best-effort — logs errors but never throws.
 */
async function initWhatsApp() {
  try {
    const executablePath = getChromiumPath();

    const puppeteerOpts = {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    };

    if (executablePath) {
      puppeteerOpts.executablePath = executablePath;
      logger.info(`Using Playwright Chromium: ${executablePath}`);
    }

    client = new Client({
      authStrategy: new LocalAuth({ dataPath: '.wwebjs_auth' }),
      puppeteer: puppeteerOpts,
    });

    client.on('qr', (qr) => {
      logger.info('WhatsApp QR code received — scan with your phone');
      qrcode.generate(qr, { small: true });
    });

    client.on('ready', () => {
      logger.info('WhatsApp client is ready');
    });

    client.on('disconnected', (reason) => {
      logger.warn(`WhatsApp client disconnected: ${reason}`);
      logger.info('Please re-scan the QR code on next initialization');
    });

    client.on('auth_failure', (msg) => {
      logger.error(`WhatsApp authentication failure: ${msg}`);
    });

    await client.initialize();
  } catch (err) {
    logger.error(`Failed to initialize WhatsApp client: ${err.message}`);
    client = null;
  }
}

/**
 * Send a WhatsApp message to the configured number.
 * Best-effort — never throws.
 * @param {string} number - Phone number in international format (e.g. '5511999999999')
 * @param {string} message - Message text to send
 */
async function sendWhatsApp(number, message) {
  try {
    if (!client) {
      logger.warn('WhatsApp client not initialized, attempting init...');
      await initWhatsApp();
    }

    if (!client) {
      logger.error('WhatsApp client unavailable — skipping message');
      return;
    }

    const chatId = `${number}@c.us`;
    await client.sendMessage(chatId, message);
    logger.info(`WhatsApp message sent to ${number}`);
  } catch (err) {
    logger.error(`Failed to send WhatsApp message: ${err.message}`);
  }
}

/**
 * Get the current WhatsApp client instance.
 * @returns {Client|null}
 */
function getWhatsAppClient() {
  return client;
}

module.exports = { initWhatsApp, sendWhatsApp, getWhatsAppClient };
