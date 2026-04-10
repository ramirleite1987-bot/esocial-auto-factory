'use strict';

const logger = require('../utils/logger').child({ context: 'esocial-folha' });
const { getCompetencia } = require('../utils/competencia');

/**
 * List open (pending) payrolls.
 *
 * @param {import('axios').AxiosInstance} client - Configured eSocial HTTP client
 * @returns {Promise<Array>} Array of open payroll entries
 */
async function listarFolhasAbertas(client) {
  logger.info('Listando folhas de pagamento abertas');

  const response = await client.get('/api/empregadordomestico/folha');
  const folhas = response.data || [];

  const abertas = Array.isArray(folhas)
    ? folhas.filter((f) => f.status === 'ABERTA' || f.status === 'aberta')
    : [];

  logger.info(`Encontradas ${abertas.length} folha(s) aberta(s)`);
  return abertas;
}

/**
 * Check competency status for a given period.
 *
 * @param {import('axios').AxiosInstance} client - Configured eSocial HTTP client
 * @param {{ mes: number, ano: number }} competencia - Period to check
 * @returns {Promise<Object>} Competency status object
 */
async function verificarCompetencia(client, competencia) {
  const { mes, ano } = competencia || getCompetencia();
  const periodo = `${String(mes).padStart(2, '0')}/${ano}`;
  logger.info(`Verificando competência ${periodo}`);

  const response = await client.get('/api/empregadordomestico/folha/competencia', {
    params: { mes, ano },
  });

  const status = response.data || {};
  logger.info(`Competência ${periodo}: status=${status.status || 'desconhecido'}`);
  return status;
}

/**
 * Close payroll for a given competency period.
 * Gracefully handles already-closed payrolls (logs + skips).
 *
 * @param {import('axios').AxiosInstance} client - Configured eSocial HTTP client
 * @param {{ mes: number, ano: number }} competencia - Period to close
 * @returns {Promise<Object>} Closure result
 */
async function encerrarFolha(client, competencia) {
  const { mes, ano } = competencia || getCompetencia();
  const periodo = `${String(mes).padStart(2, '0')}/${ano}`;
  logger.info(`Encerrando folha de pagamento para ${periodo}`);

  try {
    const response = await client.post('/api/empregadordomestico/folha/encerrar', {
      mes,
      ano,
    });

    logger.info(`Folha ${periodo} encerrada com sucesso`);
    return response.data;
  } catch (error) {
    const status = error.response ? error.response.status : null;
    const body = error.response ? error.response.data : null;

    const alreadyClosed =
      (status === 400 || status === 409 || status === 422) &&
      body &&
      (typeof body === 'string'
        ? body.toLowerCase().includes('encerrad')
        : JSON.stringify(body).toLowerCase().includes('encerrad'));

    if (alreadyClosed) {
      logger.warn(`Folha ${periodo} já se encontra encerrada — ignorando`);
      return { status: 'already_closed', periodo };
    }

    logger.error(`Erro ao encerrar folha ${periodo}: ${error.message}`);
    throw error;
  }
}

module.exports = { listarFolhasAbertas, verificarCompetencia, encerrarFolha };
