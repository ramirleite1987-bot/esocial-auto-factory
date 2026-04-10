'use strict';

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { authenticate } = require('../auth/govbr');
const logger = require('../utils/logger').child({ context: 'esocial-client' });

const SESSION_PATH = path.join(process.cwd(), 'session.json');

const BASE_URL = process.env.ESOCIAL_BASE_URL || 'https://login.esocial.gov.br';
const TIMEOUT = Number(process.env.ESOCIAL_TIMEOUT) || 30000;

/**
 * Validate that an API response contains expected data structure.
 * @param {import('axios').AxiosResponse} response
 * @returns {import('axios').AxiosResponse}
 */
function validateResponse(response) {
  if (!response || typeof response.data === 'undefined') {
    logger.warn(`Resposta vazia recebida de ${response?.config?.url || 'URL desconhecida'}`);
  }
  return response;
}

/**
 * Create an Axios HTTP client configured with eSocial session cookies.
 * Includes interceptors for response validation and re-authentication on 401/403.
 *
 * @param {string} session - Cookie string from authenticate()
 * @returns {import('axios').AxiosInstance}
 */
function createClient(session) {
  const instance = axios.create({
    baseURL: BASE_URL,
    timeout: TIMEOUT,
    headers: {
      Cookie: session,
      Accept: 'application/json',
    },
  });

  // Response validation interceptor
  instance.interceptors.response.use(
    (response) => validateResponse(response),
    async (error) => {
      const status = error.response ? error.response.status : null;
      const url = error.config ? error.config.url : 'unknown';

      if ((status === 401 || status === 403) && !error.config._retried) {
        error.config._retried = true;
        logger.warn(`Received ${status} on ${url}, attempting re-authentication`);

        if (fs.existsSync(SESSION_PATH)) {
          fs.unlinkSync(SESSION_PATH);
          logger.info('Deleted stale session.json to force browser re-login');
        }

        const newSession = await authenticate();
        error.config.headers.Cookie = newSession;
        instance.defaults.headers.Cookie = newSession;

        return instance.request(error.config);
      }

      if (status >= 500) {
        logger.error(`Erro do servidor eSocial (${status}) em ${url}: ${error.message}`);
      }

      return Promise.reject(error);
    },
  );

  return instance;
}

module.exports = { createClient };
