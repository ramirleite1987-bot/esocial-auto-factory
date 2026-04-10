'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger').child({ context: 'esocial-guia' });

const GUIAS_DIR = path.resolve(__dirname, '../../output/guias');

/**
 * Ensure the output/guias/ directory exists.
 */
function ensureGuiasDir() {
  if (!fs.existsSync(GUIAS_DIR)) {
    fs.mkdirSync(GUIAS_DIR, { recursive: true });
    logger.info(`Diretório criado: ${GUIAS_DIR}`);
  }
}

/**
 * Trigger DAE slip generation for a given competency period.
 *
 * @param {import('axios').AxiosInstance} client - Configured eSocial HTTP client
 * @param {{ mes: number, ano: number }} competencia - Period to generate DAE for
 * @returns {Promise<string>} Generated guia ID
 */
async function gerarGuia(client, competencia) {
  const { mes, ano } = competencia;
  const periodo = `${String(mes).padStart(2, '0')}/${ano}`;
  logger.info(`Gerando guia DAE para ${periodo}`);

  const response = await client.post('/api/empregadordomestico/guia/gerar', {
    mes,
    ano,
  });

  const data = response.data || {};
  const guiaId = data.id || data.guiaId;

  if (!guiaId) {
    throw new Error(`Falha ao gerar guia para ${periodo}: ID não retornado`);
  }

  logger.info(`Guia gerada com sucesso: id=${guiaId}`);
  return guiaId;
}

/**
 * Download DAE PDF to the output/guias/ directory.
 * Skips download if the file already exists. Validates the file is non-empty.
 *
 * @param {import('axios').AxiosInstance} client - Configured eSocial HTTP client
 * @param {string} guiaId - Guia identifier
 * @param {string} outputPath - Full path for the output PDF file
 * @returns {Promise<string>} Path to the downloaded PDF
 */
async function downloadGuiaPDF(client, guiaId, outputPath) {
  ensureGuiasDir();

  if (fs.existsSync(outputPath)) {
    logger.info(`Guia PDF já existe, pulando download: ${outputPath}`);
    return outputPath;
  }

  logger.info(`Baixando guia PDF: guiaId=${guiaId}`);

  const response = await client.get(`/api/empregadordomestico/guia/${guiaId}/pdf`, {
    responseType: 'arraybuffer',
  });

  const buffer = Buffer.from(response.data);

  if (buffer.length === 0) {
    throw new Error(`PDF vazio recebido para guiaId=${guiaId}`);
  }

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(outputPath, buffer);
  logger.info(`Guia PDF salva: ${outputPath} (${buffer.length} bytes)`);

  return outputPath;
}

module.exports = { gerarGuia, downloadGuiaPDF };
