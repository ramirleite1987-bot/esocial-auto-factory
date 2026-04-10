'use strict';

const fs = require('fs');
const path = require('path');
const { gerarGuia, downloadGuiaPDF } = require('../src/esocial/guia');

const TEST_OUTPUT_DIR = path.join(__dirname, '../output/guias');

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

describe('downloadGuiaPDF', () => {
  const testPdfPath = path.join(TEST_OUTPUT_DIR, 'test-download.pdf');

  afterEach(() => {
    if (fs.existsSync(testPdfPath)) {
      fs.unlinkSync(testPdfPath);
    }
  });

  test('downloads PDF and saves to disk', async () => {
    const pdfContent = Buffer.from('%PDF-1.4 fake content');
    const client = {
      get: jest.fn().mockResolvedValue({ data: pdfContent }),
    };

    const result = await downloadGuiaPDF(client, 'guia-123', testPdfPath);
    expect(result).toBe(testPdfPath);
    expect(fs.existsSync(testPdfPath)).toBe(true);
    expect(fs.readFileSync(testPdfPath).length).toBeGreaterThan(0);
  });

  test('skips download if file already exists', async () => {
    // Create the file first
    if (!fs.existsSync(TEST_OUTPUT_DIR)) {
      fs.mkdirSync(TEST_OUTPUT_DIR, { recursive: true });
    }
    fs.writeFileSync(testPdfPath, 'existing');

    const client = {
      get: jest.fn(),
    };

    const result = await downloadGuiaPDF(client, 'guia-123', testPdfPath);
    expect(result).toBe(testPdfPath);
    expect(client.get).not.toHaveBeenCalled();
  });

  test('throws on empty PDF response', async () => {
    const client = {
      get: jest.fn().mockResolvedValue({ data: Buffer.alloc(0) }),
    };

    await expect(downloadGuiaPDF(client, 'guia-123', testPdfPath)).rejects.toThrow('PDF vazio');
  });
});
