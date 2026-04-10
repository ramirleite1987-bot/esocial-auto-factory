'use strict';

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger').child({ context: 'auth' });

const SESSION_PATH = path.join(process.cwd(), 'session.json');
const LOGIN_URL = 'https://login.esocial.gov.br';

/**
 * Build a cookie header string from Playwright storage state cookies.
 * @param {Array} cookies - Array of cookie objects from storageState
 * @returns {string} Cookie header value
 */
function buildCookieString(cookies) {
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

/**
 * Check if a persisted session file exists and contains valid data.
 * @returns {{ valid: boolean, state?: object }} Validation result
 */
function loadPersistedSession() {
  try {
    if (!fs.existsSync(SESSION_PATH)) {
      return { valid: false };
    }

    const raw = fs.readFileSync(SESSION_PATH, 'utf-8');
    const state = JSON.parse(raw);

    if (!state.cookies || !Array.isArray(state.cookies) || state.cookies.length === 0) {
      logger.warn('Persisted session has no cookies, will re-authenticate');
      return { valid: false };
    }

    const now = Date.now() / 1000;
    const realCookies = state.cookies.filter((c) => c.expires && c.expires > 0);
    const hasExpired =
      realCookies.length === 0 ||
      realCookies.some((c) => c.expires < now);
    if (hasExpired) {
      logger.warn('Persisted session cookies have expired or are all session-only, will re-authenticate');
      return { valid: false };
    }

    logger.info('Restored existing session from session.json');
    return { valid: true, state };
  } catch (err) {
    logger.warn(`Failed to load persisted session: ${err.message}`);
    return { valid: false };
  }
}

/**
 * Persist Playwright storage state to session.json.
 * @param {object} state - Storage state from context.storageState()
 */
function persistSession(state) {
  fs.writeFileSync(SESSION_PATH, JSON.stringify(state, null, 2), 'utf-8');
  logger.info('Session persisted to session.json');
}

/**
 * Detect CAPTCHA or 2FA challenges on the page.
 * @param {import('playwright').Page} page
 * @returns {Promise<boolean>} True if CAPTCHA/2FA detected
 */
async function detectCaptchaOr2FA(page) {
  const captchaSelectors = [
    'iframe[src*="captcha"]',
    'iframe[src*="recaptcha"]',
    '.g-recaptcha',
    '[data-sitekey]',
    '#captcha',
  ];

  for (const selector of captchaSelectors) {
    const element = await page.$(selector);
    if (element) {
      logger.error('CAPTCHA detected on login page — automated login cannot proceed');
      return true;
    }
  }

  const twoFASelectors = [
    'input[name*="otp"]',
    'input[name*="2fa"]',
    'input[name*="token"]',
    '[class*="two-factor"]',
    '[class*="mfa"]',
  ];

  for (const selector of twoFASelectors) {
    const element = await page.$(selector);
    if (element) {
      logger.error('2FA/MFA challenge detected — automated login cannot proceed');
      return true;
    }
  }

  return false;
}

/**
 * Authenticate against gov.br via headless Playwright browser.
 * Captures session cookies and persists them to session.json.
 *
 * @returns {Promise<string>} Cookie string for use in Axios headers
 */
async function authenticate() {
  const cpf = process.env.GOVBR_CPF;
  const senha = process.env.GOVBR_SENHA;

  if (!cpf || !senha) {
    throw new Error('GOVBR_CPF and GOVBR_SENHA environment variables are required');
  }

  const persisted = loadPersistedSession();
  if (persisted.valid) {
    return buildCookieString(persisted.state.cookies);
  }

  logger.info('Starting gov.br headless authentication');

  let browser = null;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    logger.info('Navigating to eSocial login page');
    await page.goto(LOGIN_URL, { waitUntil: 'networkidle', timeout: 30000 });

    if (await detectCaptchaOr2FA(page)) {
      throw new Error('CAPTCHA or 2FA detected — aborting automated authentication');
    }

    logger.info('Filling login credentials');
    await page.fill('input[name="cpf"], input[type="text"][id*="cpf"], #login-cpf', cpf);
    await page.fill('input[name="password"], input[type="password"], #login-senha', senha);

    logger.info('Submitting login form');
    await page.click('button[type="submit"], input[type="submit"], #submit-btn');

    logger.info('Waiting for post-login redirect');
    await page.waitForURL((url) => {
      const href = url.toString();
      return href.includes('esocial') && !href.includes('login');
    }, { timeout: 30000 });

    if (await detectCaptchaOr2FA(page)) {
      throw new Error('CAPTCHA or 2FA detected after login — aborting');
    }

    logger.info('Authentication successful, capturing session');
    const state = await context.storageState();
    persistSession(state);

    const cookieString = buildCookieString(state.cookies);
    return cookieString;
  } catch (err) {
    logger.error(`Authentication failed: ${err.message}`);
    throw err;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

module.exports = { authenticate };
