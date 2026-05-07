'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger').child({ context: 'esocial-guia' });

const GUIAS_DIR = path.resolve(__dirname, '../../output/guias');
const PDF_MAGIC = Buffer.from('%PDF-', 'utf8');

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
 * Check whether a buffer starts with the PDF magic bytes "%PDF-".
 * @param {Buffer} buffer
 * @returns {boolean}
 */
function isValidPdfBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < PDF_MAGIC.length) return false;
  return buffer.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC);
}

/**
 * Validate an existing PDF on disk: must exist, be non-empty, and start with %PDF-.
 * Returns false if any check fails (caller can then re-download).
 * @param {string} filePath
 * @returns {boolean}
 */
function isValidPdfFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return false;
    const stats = fs.statSync(filePath);
    if (stats.size === 0) return false;
    const fd = fs.openSync(filePath, 'r');
    try {
      const head = Buffer.alloc(PDF_MAGIC.length);
      fs.readSync(fd, head, 0, PDF_MAGIC.length, 0);
      return head.equals(PDF_MAGIC);
    } finally {
      fs.closeSync(fd);
    }
  } catch (err) {
    logger.warn(`Falha ao validar PDF existente em ${filePath}: ${err.message}`);
    return false;
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
 * Copy a PDF to the configured backup directory if PDF_BACKUP_DIR is set.
 * Best-effort — never throws (backup failure must not fail the job).
 *
 * @param {string} sourcePath - Path to the source PDF
 */
function backupPdf(sourcePath) {
  const backupDir = process.env.PDF_BACKUP_DIR;
  if (!backupDir) return;
  try {
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    const target = path.join(backupDir, path.basename(sourcePath));
    fs.copyFileSync(sourcePath, target);
    logger.info(`Backup PDF criado em ${target}`);
  } catch (err) {
    logger.warn(`Falha ao criar backup do PDF em ${backupDir}: ${err.message}`);
  }
}

/**
 * Download DAE PDF to the output/guias/ directory.
 *
 * Skips the download if a valid PDF already exists at outputPath. "Valid" means:
 * the file is non-empty AND starts with the %PDF- magic bytes. A 0-byte or
 * truncated file from a previous interrupted run is treated as missing and
 * re-downloaded — without this check such a stale file would block the job
 * from ever producing a usable PDF.
 *
 * On success, optionally mirrors the file to PDF_BACKUP_DIR (best-effort).
 *
 * @param {import('axios').AxiosInstance} client - Configured eSocial HTTP client
 * @param {string} guiaId - Guia identifier
 * @param {string} outputPath - Full path for the output PDF file
 * @returns {Promise<string>} Path to the downloaded PDF
 */
async function downloadGuiaPDF(client, guiaId, outputPath) {
  ensureGuiasDir();

  if (fs.existsSync(outputPath)) {
    if (isValidPdfFile(outputPath)) {
      logger.info(`Guia PDF já existe e é válida, pulando download: ${outputPath}`);
      backupPdf(outputPath);
      return outputPath;
    }
    logger.warn(
      `Arquivo existente em ${outputPath} é inválido (vazio ou não-PDF), removendo e re-baixando`,
    );
    try {
      fs.unlinkSync(outputPath);
    } catch (err) {
      logger.warn(`Falha ao remover PDF inválido: ${err.message}`);
    }
  }

  logger.info(`Baixando guia PDF: guiaId=${guiaId}`);

  const response = await client.get(`/api/empregadordomestico/guia/${guiaId}/pdf`, {
    responseType: 'arraybuffer',
  });

  const buffer = Buffer.from(response.data);

  if (buffer.length === 0) {
    throw new Error(`PDF vazio recebido para guiaId=${guiaId}`);
  }

  if (!isValidPdfBuffer(buffer)) {
    throw new Error(
      `Resposta para guiaId=${guiaId} não é um PDF válido (magic bytes ausentes; ${buffer.length} bytes)`,
    );
  }

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(outputPath, buffer);
  logger.info(`Guia PDF salva: ${outputPath} (${buffer.length} bytes)`);

  backupPdf(outputPath);

  return outputPath;
}

module.exports = {
  gerarGuia,
  downloadGuiaPDF,
  isValidPdfBuffer,
  isValidPdfFile,
  backupPdf,
};
