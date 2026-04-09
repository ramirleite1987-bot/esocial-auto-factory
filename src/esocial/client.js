'use strict';

require('dotenv').config();
const axios = require('axios');
const { authenticate } = require('../auth/govbr');
const { createContextLogger } = require('../utils/logger');

const log = createContextLogger('esocialClient');

const BASE_URL = 'https://www.esocial.gov.br';
const MAX_RETRY = 1; // number of re-auth attempts on 401/403

/**
 * Create an Axios instance pre-configured with the authenticated session.
 *
 * The instance has a response interceptor that automatically re-authenticates
 * and retries the request once on HTTP 401 / 403.
 *
 * @param {{ cookies: Array<object>, headers: object }} session - Session from govbr.authenticate()
 * @returns {import('axios').AxiosInstance}
 */
function createClient(session) {
  const instance = axios.create({
    baseURL: BASE_URL,
    timeout: 30000,
    headers: {
      ...session.headers,
      Accept: 'application/json, text/plain, */*',
      'Content-Type': 'application/json',
    },
  });

  // Attach session reference so interceptor can mutate it on re-auth
  instance._session = session;

  // ── Response interceptor: handle 401/403 with re-auth ──────────────────────
  instance.interceptors.response.use(
    (response) => response,
    async (error) => {
      const { response, config } = error;

      if (!response) {
        log.error(`Network error: ${error.message}`);
        throw error;
      }

      const status = response.status;

      if ((status === 401 || status === 403) && !config._retried) {
        config._retried = true;
        log.warn(`Received ${status} — attempting re-authentication`);

        try {
          const newSession = await authenticate();
          instance._session = newSession;

          // Update default headers for all future requests
          Object.assign(instance.defaults.headers, newSession.headers);

          // Retry the original request with new headers
          config.headers = {
            ...config.headers,
            ...newSession.headers,
          };

          log.info('Re-authentication successful — retrying original request');
          return instance(config);
        } catch (authErr) {
          log.error(`Re-authentication failed: ${authErr.message}`);
          throw authErr;
        }
      }

      log.error(`HTTP ${status} on ${config.method?.toUpperCase()} ${config.url}: ${response.data?.message || ''}`);
      throw error;
    }
  );

  return instance;
}

module.exports = { createClient };
