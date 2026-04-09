'use strict';

require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { createContextLogger } = require('../utils/logger');

const log = createContextLogger('whatsapp');

const WHATSAPP_NUMBER = process.env.WHATSAPP_NUMBER;

// Singleton client instance — shared across the process lifetime
let _client = null;
let _ready = false;
let _readyPromise = null;

/**
 * Initialise (or return the existing) WhatsApp Web client.
 *
 * On first call, the client is created, QR code is printed to stdout if needed,
 * and a promise is returned that resolves when the client is ready.
 *
 * @returns {Promise<Client>}
 */
function initClient() {
  if (_readyPromise) return _readyPromise;

  log.info('Initializing WhatsApp client (whatsapp-web.js)');

  _client = new Client({
    authStrategy: new LocalAuth({ dataPath: '.wwebjs_auth' }),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    },
  });

  _readyPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('WhatsApp client initialization timed out after 120s'));
    }, 120_000);

    _client.on('qr', (qr) => {
      log.warn('WhatsApp QR code required — scan with your phone:');
      qrcode.generate(qr, { small: true });
    });

    _client.on('authenticated', () => {
      log.info('WhatsApp authenticated');
    });

    _client.on('ready', () => {
      clearTimeout(timeout);
      _ready = true;
      log.info('WhatsApp client ready');
      resolve(_client);
    });

    _client.on('auth_failure', (msg) => {
      clearTimeout(timeout);
      log.error(`WhatsApp authentication failure: ${msg}`);
      _readyPromise = null;
      reject(new Error(`WhatsApp auth failure: ${msg}`));
    });

    _client.on('disconnected', (reason) => {
      log.warn(`WhatsApp disconnected: ${reason} — resetting client`);
      _ready = false;
      _readyPromise = null;
      _client = null;
    });

    _client.initialize();
  });

  return _readyPromise;
}

/**
 * Send a WhatsApp message to the configured number.
 *
 * Automatically initializes the client if not already done.
 * Retries authentication once if the client is disconnected.
 *
 * @param {string} message - Text message to send
 * @param {string=} toNumber - Override destination number (E.164 format, e.g. +5511999999999)
 * @returns {Promise<void>}
 */
async function sendWhatsApp(message, toNumber) {
  const number = toNumber || WHATSAPP_NUMBER;

  if (!number) {
    throw new Error('WHATSAPP_NUMBER must be set in .env or passed as argument');
  }

  // Normalize number: remove leading '+' and append @c.us
  const chatId = number.replace(/^\+/, '') + '@c.us';

  if (!_ready) {
    log.info('WhatsApp client not ready — initializing');
    await initClient();
  }

  log.info(`Sending WhatsApp message to ${number}`);

  try {
    await _client.sendMessage(chatId, message);
    log.info('WhatsApp message sent successfully');
  } catch (err) {
    log.error(`Failed to send WhatsApp message: ${err.message}`);

    // Attempt reconnect once
    log.warn('Attempting WhatsApp reconnect');
    _ready = false;
    _readyPromise = null;
    _client = null;

    await initClient();
    await _client.sendMessage(chatId, message);
    log.info('WhatsApp message sent after reconnect');
  }
}

/**
 * Gracefully destroy the WhatsApp client.
 * Call this on process shutdown.
 */
async function destroyClient() {
  if (_client) {
    try {
      await _client.destroy();
      log.info('WhatsApp client destroyed');
    } catch (_) {}
    _client = null;
    _ready = false;
    _readyPromise = null;
  }
}

module.exports = { initClient, sendWhatsApp, destroyClient };
