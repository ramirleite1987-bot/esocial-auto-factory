'use strict';

const fs = require('fs');
const path = require('path');
const { createContextLogger } = require('../utils/logger');

const log = createContextLogger('guia');

const ENDPOINTS = {
  gerarGuia: '/portal-esocial/api/v1/dae/gerar',
  downloadGuia: '/portal-esocial/api/v1/dae/download',
};

const OUTPUT_DIR = path.resolve('./output/guias');

/**
 * Ensure the output directory exists.
 */
function ensureOutputDir() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    log.info(`Created output directory: ${OUTPUT_DIR}`);
  }
}

/**
 * Trigger DAE guide generation for the given competência.
 *
 * @param {import('axios').AxiosInstance} client
 * @param {{ mes: string|number, ano: string|number }} competencia
 * @returns {Promise<string>} ID of the generated guia
 */
async function gerarGuia(client, competencia) {
  const { mes, ano } = competencia;
  log.info(`Generating DAE guide for competência ${mes}/${ano}`);

  try {
    const { data } = await client.post(ENDPOINTS.gerarGuia, { mes, ano });
    const idGuia = data?.id || data?.idGuia || data?.idDae;

    if (!idGuia) {
      throw new Error(`Guide generation response did not include an ID: ${JSON.stringify(data)}`);
    }

    log.info(`DAE guide generated successfully — ID: ${idGuia}`);
    return String(idGuia);
  } catch (err) {
    log.error(`Failed to generate DAE guide for ${mes}/${ano}: ${err.message}`);
    throw err;
  }
}

/**
 * Download the PDF for the given guia ID and save it to the output directory.
 *
 * Skips download if the file already exists (idempotent).
 *
 * @param {import('axios').AxiosInstance} client
 * @param {string} idGuia
 * @param {{ mes: string|number, ano: string|number }} competencia
 * @returns {Promise<string>} Absolute path to the saved PDF
 */
async function downloadGuiaPDF(client, idGuia, competencia) {
  ensureOutputDir();

  const { mes, ano } = competencia;
  const paddedMes = String(mes).padStart(2, '0');
  const fileName = `DAE-${paddedMes}-${ano}.pdf`;
  const outputPath = path.join(OUTPUT_DIR, fileName);

  // Idempotency check
  if (fs.existsSync(outputPath)) {
    log.warn(`PDF already exists at ${outputPath} — skipping download`);
    return outputPath;
  }

  log.info(`Downloading PDF for guide ID ${idGuia} → ${outputPath}`);

  try {
    const response = await client.get(`${ENDPOINTS.downloadGuia}/${idGuia}`, {
      responseType: 'arraybuffer',
      params: { idGuia },
      headers: {
        Accept: 'application/pdf',
      },
    });

    const buffer = Buffer.from(response.data);

    // Validate we received a PDF
    if (!buffer.slice(0, 4).toString('ascii').startsWith('%PDF')) {
      throw new Error('Response does not appear to be a valid PDF');
    }

    fs.writeFileSync(outputPath, buffer);
    const fileSizeKb = Math.round(buffer.length / 1024);
    log.info(`PDF saved: ${outputPath} (${fileSizeKb} KB)`);

    return outputPath;
  } catch (err) {
    log.error(`Failed to download PDF for guide ${idGuia}: ${err.message}`);
    throw err;
  }
}

module.exports = { gerarGuia, downloadGuiaPDF };
