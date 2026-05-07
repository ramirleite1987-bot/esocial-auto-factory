'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  gerarGuia,
  downloadGuiaPDF,
  isValidPdfBuffer,
  isValidPdfFile,
} = require('../src/esocial/guia');

const TEST_OUTPUT_DIR = path.join(__dirname, '../output/guias');
const VALID_PDF = Buffer.from('%PDF-1.4 fake content');

describe('gerarGuia', () => {
  test('returns guiaId from response', async () => {
    const client = {
      post: jest.fn().mockResolvedValue({ data: { id: 'guia-123' } }),
    };

    const result = await gerarGuia(client, { mes: 3, ano: 2025 });
    expect(result).toBe('guia-123');
    expect(client.post).toHaveBeenCalledWith('/api/empregadordomestico/guia/gerar', {
      mes: 3,
      ano: 2025,
    });
  });

  test('returns guiaId from alternative field name', async () => {
    const client = {
      post: jest.fn().mockResolvedValue({ data: { guiaId: 'guia-456' } }),
    };

    const result = await gerarGuia(client, { mes: 5, ano: 2025 });
    expect(result).toBe('guia-456');
  });

  test('throws when no guiaId returned', async () => {
    const client = {
      post: jest.fn().mockResolvedValue({ data: {} }),
    };

    await expect(gerarGuia(client, { mes: 3, ano: 2025 })).rejects.toThrow('ID não retornado');
  });
});

describe('isValidPdfBuffer', () => {
  test('accepts buffers starting with %PDF-', () => {
    expect(isValidPdfBuffer(Buffer.from('%PDF-1.4\n%binary'))).toBe(true);
  });

  test('rejects empty buffers', () => {
    expect(isValidPdfBuffer(Buffer.alloc(0))).toBe(false);
  });

  test('rejects buffers without %PDF- prefix', () => {
    expect(isValidPdfBuffer(Buffer.from('<html>oops</html>'))).toBe(false);
  });

  test('rejects non-Buffer inputs', () => {
    expect(isValidPdfBuffer('%PDF-1.4')).toBe(false);
    expect(isValidPdfBuffer(null)).toBe(false);
  });

  test('rejects buffers shorter than the magic prefix', () => {
    expect(isValidPdfBuffer(Buffer.from('%PD'))).toBe(false);
  });
});

describe('isValidPdfFile', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guia-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns false when file does not exist', () => {
    expect(isValidPdfFile(path.join(tmpDir, 'missing.pdf'))).toBe(false);
  });

  test('returns false when file is empty', () => {
    const f = path.join(tmpDir, 'empty.pdf');
    fs.writeFileSync(f, '');
    expect(isValidPdfFile(f)).toBe(false);
  });

  test('returns false when file does not start with %PDF-', () => {
    const f = path.join(tmpDir, 'notpdf.pdf');
    fs.writeFileSync(f, 'not a pdf at all');
    expect(isValidPdfFile(f)).toBe(false);
  });

  test('returns true for a real PDF', () => {
    const f = path.join(tmpDir, 'good.pdf');
    fs.writeFileSync(f, VALID_PDF);
    expect(isValidPdfFile(f)).toBe(true);
  });
});

describe('downloadGuiaPDF', () => {
  const testPdfPath = path.join(TEST_OUTPUT_DIR, 'test-download.pdf');
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.PDF_BACKUP_DIR;
  });

  afterEach(() => {
    if (fs.existsSync(testPdfPath)) {
      fs.unlinkSync(testPdfPath);
    }
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('downloads PDF and saves to disk', async () => {
    const client = {
      get: jest.fn().mockResolvedValue({ data: VALID_PDF }),
    };

    const result = await downloadGuiaPDF(client, 'guia-123', testPdfPath);
    expect(result).toBe(testPdfPath);
    expect(fs.existsSync(testPdfPath)).toBe(true);
    expect(fs.readFileSync(testPdfPath).length).toBeGreaterThan(0);
  });

  test('skips download if a valid PDF already exists', async () => {
    if (!fs.existsSync(TEST_OUTPUT_DIR)) {
      fs.mkdirSync(TEST_OUTPUT_DIR, { recursive: true });
    }
    fs.writeFileSync(testPdfPath, VALID_PDF);

    const client = { get: jest.fn() };

    const result = await downloadGuiaPDF(client, 'guia-123', testPdfPath);
    expect(result).toBe(testPdfPath);
    expect(client.get).not.toHaveBeenCalled();
  });

  test('re-downloads when existing file is empty', async () => {
    if (!fs.existsSync(TEST_OUTPUT_DIR)) {
      fs.mkdirSync(TEST_OUTPUT_DIR, { recursive: true });
    }
    fs.writeFileSync(testPdfPath, '');

    const client = {
      get: jest.fn().mockResolvedValue({ data: VALID_PDF }),
    };

    const result = await downloadGuiaPDF(client, 'guia-123', testPdfPath);
    expect(result).toBe(testPdfPath);
    expect(client.get).toHaveBeenCalledTimes(1);
    expect(fs.readFileSync(testPdfPath).equals(VALID_PDF)).toBe(true);
  });

  test('re-downloads when existing file is not a PDF', async () => {
    if (!fs.existsSync(TEST_OUTPUT_DIR)) {
      fs.mkdirSync(TEST_OUTPUT_DIR, { recursive: true });
    }
    fs.writeFileSync(testPdfPath, '<html>error page</html>');

    const client = {
      get: jest.fn().mockResolvedValue({ data: VALID_PDF }),
    };

    await downloadGuiaPDF(client, 'guia-123', testPdfPath);
    expect(client.get).toHaveBeenCalledTimes(1);
    expect(fs.readFileSync(testPdfPath).equals(VALID_PDF)).toBe(true);
  });

  test('throws on empty PDF response', async () => {
    const client = {
      get: jest.fn().mockResolvedValue({ data: Buffer.alloc(0) }),
    };

    await expect(downloadGuiaPDF(client, 'guia-123', testPdfPath)).rejects.toThrow('PDF vazio');
  });

  test('throws when response is not a valid PDF', async () => {
    const client = {
      get: jest.fn().mockResolvedValue({ data: Buffer.from('<html>boom</html>') }),
    };

    await expect(downloadGuiaPDF(client, 'guia-123', testPdfPath)).rejects.toThrow(
      /não é um PDF válido/,
    );
    expect(fs.existsSync(testPdfPath)).toBe(false);
  });

  test('copies PDF to PDF_BACKUP_DIR when configured', async () => {
    const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-backup-'));
    process.env.PDF_BACKUP_DIR = backupDir;

    const client = {
      get: jest.fn().mockResolvedValue({ data: VALID_PDF }),
    };

    try {
      await downloadGuiaPDF(client, 'guia-123', testPdfPath);
      const backupPath = path.join(backupDir, path.basename(testPdfPath));
      expect(fs.existsSync(backupPath)).toBe(true);
      expect(fs.readFileSync(backupPath).equals(VALID_PDF)).toBe(true);
    } finally {
      fs.rmSync(backupDir, { recursive: true, force: true });
    }
  });

  test('creates backup directory if it does not yet exist', async () => {
    const parentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-backup-parent-'));
    const backupDir = path.join(parentDir, 'nested', 'subdir');
    process.env.PDF_BACKUP_DIR = backupDir;

    const client = {
      get: jest.fn().mockResolvedValue({ data: VALID_PDF }),
    };

    try {
      await downloadGuiaPDF(client, 'guia-123', testPdfPath);
      expect(fs.existsSync(path.join(backupDir, path.basename(testPdfPath)))).toBe(true);
    } finally {
      fs.rmSync(parentDir, { recursive: true, force: true });
    }
  });

  test('backup failure does not fail the download', async () => {
    process.env.PDF_BACKUP_DIR = '/nonexistent-readonly-root/backup';

    const client = {
      get: jest.fn().mockResolvedValue({ data: VALID_PDF }),
    };

    const result = await downloadGuiaPDF(client, 'guia-123', testPdfPath);
    expect(result).toBe(testPdfPath);
    expect(fs.existsSync(testPdfPath)).toBe(true);
  });
});
