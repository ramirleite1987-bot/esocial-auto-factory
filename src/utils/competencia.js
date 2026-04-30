'use strict';

const logger = require('./logger').child({ context: 'competencia' });

const MIN_YEAR = 2000;

function parseManualMes(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 12) {
    throw new Error(
      `COMPETENCIA_MES inválido: "${value}" (esperado inteiro entre 1 e 12 ou "auto")`,
    );
  }
  return n;
}

function parseManualAno(value) {
  const n = Number(value);
  const maxYear = new Date().getFullYear() + 1;
  if (!Number.isInteger(n) || n < MIN_YEAR || n > maxYear) {
    throw new Error(
      `COMPETENCIA_ANO inválido: "${value}" (esperado inteiro entre ${MIN_YEAR} e ${maxYear} ou "auto")`,
    );
  }
  return n;
}

/**
 * Auto-calculate competência (previous month) when env vars are unset or 'auto'.
 * Validates manual values strictly: COMPETENCIA_MES must be 1-12,
 * COMPETENCIA_ANO must be between 2000 and currentYear+1. Throws on invalid input.
 * Supports partial config (e.g., manual mes + auto ano).
 *
 * @returns {{ mes: number, ano: number }}
 */
function getCompetencia() {
  const mesEnv = process.env.COMPETENCIA_MES;
  const anoEnv = process.env.COMPETENCIA_ANO;

  const mesIsManual = mesEnv && mesEnv !== 'auto';
  const anoIsManual = anoEnv && anoEnv !== 'auto';

  if (mesIsManual && anoIsManual) {
    return { mes: parseManualMes(mesEnv), ano: parseManualAno(anoEnv) };
  }

  const now = new Date();
  let mes = now.getMonth(); // 0-indexed = previous month (current - 1)
  let ano = now.getFullYear();

  if (mes === 0) {
    mes = 12;
    ano -= 1;
  }

  if (mesIsManual) {
    mes = parseManualMes(mesEnv);
  }
  if (anoIsManual) {
    ano = parseManualAno(anoEnv);
  }

  logger.info(`Competência calculada: ${String(mes).padStart(2, '0')}/${ano}`);
  return { mes, ano };
}

module.exports = { getCompetencia };
