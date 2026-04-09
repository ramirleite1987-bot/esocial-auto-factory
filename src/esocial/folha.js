'use strict';

const { createContextLogger } = require('../utils/logger');

const log = createContextLogger('folha');

// eSocial API endpoints (internal — may require adjustment if portal changes)
const ENDPOINTS = {
  listarFolhas: '/portal-esocial/api/v1/folha/listar',
  verificarCompetencia: '/portal-esocial/api/v1/folha/competencia',
  encerrarFolha: '/portal-esocial/api/v1/folha/encerrar',
};

/**
 * List all open payroll periods (folhas) for the authenticated employer.
 *
 * @param {import('axios').AxiosInstance} client
 * @returns {Promise<Array<object>>} Array of folha objects
 */
async function listarFolhasAbertas(client) {
  log.info('Listing open folhas');
  try {
    const { data } = await client.get(ENDPOINTS.listarFolhas, {
      params: { status: 'ABERTA' },
    });
    const folhas = data?.folhas || data?.data || data || [];
    log.info(`Found ${folhas.length} open folha(s)`);
    return folhas;
  } catch (err) {
    log.error(`Failed to list folhas: ${err.message}`);
    throw err;
  }
}

/**
 * Check whether a given competência (MM/YYYY) has already been closed.
 *
 * @param {import('axios').AxiosInstance} client
 * @param {{ mes: string|number, ano: string|number }} competencia
 * @returns {Promise<{ encerrada: boolean, status: string }>}
 */
async function verificarCompetencia(client, competencia) {
  const { mes, ano } = competencia;
  log.info(`Checking competência ${mes}/${ano}`);
  try {
    const { data } = await client.get(ENDPOINTS.verificarCompetencia, {
      params: { mes, ano },
    });
    const encerrada =
      data?.status === 'ENCERRADA' ||
      data?.encerrada === true ||
      data?.situacao === 'ENCERRADA';
    log.info(`Competência ${mes}/${ano} status: ${data?.status || (encerrada ? 'ENCERRADA' : 'ABERTA')}`);
    return { encerrada, status: data?.status || (encerrada ? 'ENCERRADA' : 'ABERTA'), raw: data };
  } catch (err) {
    log.error(`Failed to check competência ${mes}/${ano}: ${err.message}`);
    throw err;
  }
}

/**
 * Close (encerrar) the payroll for the given competência.
 *
 * Handles idempotent calls (already closed) and other known error conditions.
 *
 * @param {import('axios').AxiosInstance} client
 * @param {{ mes: string|number, ano: string|number }} competencia
 * @returns {Promise<{ success: boolean, message: string }>}
 */
async function encerrarFolha(client, competencia) {
  const { mes, ano } = competencia;
  log.info(`Closing folha for competência ${mes}/${ano}`);

  try {
    const { data } = await client.post(ENDPOINTS.encerrarFolha, { mes, ano });

    const message =
      data?.message ||
      data?.mensagem ||
      `Folha encerrada com sucesso para ${mes}/${ano}`;

    log.info(`Folha closed: ${message}`);
    return { success: true, message };
  } catch (err) {
    const status = err?.response?.status;
    const responseData = err?.response?.data;
    const serverMsg =
      responseData?.message || responseData?.mensagem || err.message;

    // 409 Conflict — already closed
    if (status === 409 || /j[aá]\s+encerrada/i.test(serverMsg)) {
      log.warn(`Competência ${mes}/${ano} is already closed: ${serverMsg}`);
      return {
        success: true,
        message: `Competência ${mes}/${ano} já estava encerrada`,
        alreadyClosed: true,
      };
    }

    // 422 / validation error — no workers, pending events, etc.
    if (status === 422) {
      log.error(`Validation error closing folha ${mes}/${ano}: ${serverMsg}`);
      throw new Error(`Validation error: ${serverMsg}`);
    }

    log.error(`Unexpected error closing folha ${mes}/${ano}: ${serverMsg}`);
    throw err;
  }
}

module.exports = { listarFolhasAbertas, verificarCompetencia, encerrarFolha };
