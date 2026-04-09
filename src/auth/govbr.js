'use strict';

require('dotenv').config();
const { chromium } = require('playwright');
const { createContextLogger } = require('../utils/logger');

const log = createContextLogger('govbr');

const ESOCIAL_URL = 'https://login.esocial.gov.br/login.aspx';
const GOVBR_CPF = process.env.GOVBR_CPF;
const GOVBR_SENHA = process.env.GOVBR_SENHA;

// Max wait time for navigation/selectors (ms)
const TIMEOUT = 60000;

/**
 * Perform headless login on the eSocial gov.br portal.
 *
 * Flow:
 *   1. Open browser (headless)
 *   2. Navigate to eSocial login page
 *   3. Click "Entrar com gov.br"
 *   4. Fill CPF + password → submit
 *   5. Wait for redirect back to eSocial
 *   6. Capture cookies and relevant auth headers
 *
 * @returns {{ cookies: Array<object>, headers: object }} Session data ready for Axios
 * @throws {Error} If authentication fails or selectors not found
 */
async function authenticate() {
  if (!GOVBR_CPF || !GOVBR_SENHA) {
    throw new Error('GOVBR_CPF and GOVBR_SENHA must be set in .env');
  }

  log.info('Starting gov.br authentication (headless)');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(TIMEOUT);

  try {
    // Step 1: Navigate to eSocial login
    log.info(`Navigating to ${ESOCIAL_URL}`);
    await page.goto(ESOCIAL_URL, { waitUntil: 'networkidle' });

    // Step 2: Click "Entrar com gov.br" button
    log.info('Looking for "Entrar com gov.br" button');
    const govbrButton = page.locator('text=Entrar com gov.br').first();
    await govbrButton.waitFor({ state: 'visible' });
    await govbrButton.click();

    // Step 3: Fill CPF on gov.br login page
    log.info('Filling CPF on gov.br login page');
    await page.waitForURL(/sso\.acesso\.gov\.br|accounts\.acesso\.gov\.br/, {
      timeout: TIMEOUT,
    });

    const cpfInput = page.locator('input[id="accountId"], input[name="username"], input[type="text"]').first();
    await cpfInput.waitFor({ state: 'visible' });
    await cpfInput.fill(GOVBR_CPF);

    // Click Continuar / Próximo
    const continueBtn = page.locator('button[type="submit"], button:has-text("Continuar"), button:has-text("Próximo")').first();
    await continueBtn.click();

    // Step 4: Fill password
    log.info('Filling password');
    const senhaInput = page.locator('input[type="password"]').first();
    await senhaInput.waitFor({ state: 'visible' });
    await senhaInput.fill(GOVBR_SENHA);

    const loginBtn = page.locator('button[type="submit"], button:has-text("Entrar"), button:has-text("Login")').first();
    await loginBtn.click();

    // Step 5: Wait for redirect back to eSocial
    log.info('Waiting for redirect back to eSocial portal');
    await page.waitForURL(/esocial\.gov\.br/, { timeout: TIMEOUT });
    await page.waitForLoadState('networkidle');

    log.info('Authentication successful — capturing session');

    // Step 6: Capture cookies and authorization header
    const cookies = await context.cookies();
    const cookieHeader = cookies
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');

    const headers = {
      Cookie: cookieHeader,
      'User-Agent':
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Referer: page.url(),
      Origin: 'https://www.esocial.gov.br',
    };

    // Also try to capture any Bearer/XSRF tokens from localStorage
    try {
      const token = await page.evaluate(() => {
        return (
          window.localStorage.getItem('token') ||
          window.localStorage.getItem('access_token') ||
          null
        );
      });
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
        log.info('Bearer token captured from localStorage');
      }
    } catch (_) {
      // Non-critical — proceed without bearer token
    }

    log.info('Session captured successfully');
    return { cookies, headers };
  } catch (err) {
    log.error(`Authentication failed: ${err.message}`, { stack: err.stack });
    // Take a screenshot for debugging
    try {
      await page.screenshot({ path: `logs/auth-error-${Date.now()}.png` });
      log.warn('Error screenshot saved to logs/');
    } catch (_) {}
    throw err;
  } finally {
    await browser.close();
  }
}

module.exports = { authenticate };
