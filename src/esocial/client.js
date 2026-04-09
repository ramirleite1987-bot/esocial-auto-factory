'use strict';

const axios = require('axios');
const { authenticate } = require('../auth/govbr');
const logger = require('../utils/logger').child({ context: 'esocial-client' });

const BASE_URL = 'https://login.esocial.gov.br';
const TIMEOUT = 30000;

/**
 * Create an Axios HTTP client configured with eSocial session cookies.
 * Includes a response interceptor that re-authenticates on 401/403.
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
    },
  });

  instance.interceptors.response.use(
    (response) => response,
    async (error) => {
      const status = error.response ? error.response.status : null;

      if ((status === 401 || status === 403) && !error.config._retried) {
        error.config._retried = true;
        logger.warn(`Received ${status}, attempting re-authentication`);

        const newSession = await authenticate();
        error.config.headers.Cookie = newSession;
        instance.defaults.headers.Cookie = newSession;

        return instance.request(error.config);
      }

      return Promise.reject(error);
    },
  );

  return instance;
}

module.exports = { createClient };
