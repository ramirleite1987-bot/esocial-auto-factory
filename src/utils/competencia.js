'use strict';

const logger = require('./logger').child({ context: 'competencia' });

/**
 * Auto-calculate competência (previous month) when env vars are set to 'auto'.
 * Handles January → December year rollback.
 *
 * @returns {{ mes: number, ano: number }}
 */
function getCompetencia() {
  const mesEnv = process.env.COMPETENCIA_MES;
  const anoEnv = process.env.COMPETENCIA_ANO;

  if (mesEnv && mesEnv !== 'auto' && anoEnv && anoEnv !== 'auto') {
    return { mes: Number(mesEnv), ano: Number(anoEnv) };
  }

  const now = new Date();
  let mes = now.getMonth(); // 0-indexed = previous month (current - 1)
  let ano = now.getFullYear();

  if (mes === 0) {
    mes = 12;
    ano -= 1;
  }

  logger.info(`Competência auto-calculada: ${String(mes).padStart(2, '0')}/${ano}`);
  return { mes, ano };
}

module.exports = { getCompetencia };
