'use strict';

const { listarFolhasAbertas, verificarCompetencia, encerrarFolha } = require('../src/esocial/folha');

function createMockClient(responses) {
  return {
    get: jest.fn().mockImplementation((url) => {
      if (responses[url]) return Promise.resolve(responses[url]);
      return Promise.resolve({ data: null });
    }),
    post: jest.fn().mockImplementation((url) => {
      if (responses[url]) return Promise.resolve(responses[url]);
      return Promise.resolve({ data: null });
    }),
  };
}

describe('listarFolhasAbertas', () => {
  test('returns open payrolls filtered by status', async () => {
    const client = createMockClient({
      '/api/empregadordomestico/folha': {
        data: [
          { id: 1, status: 'ABERTA' },
          { id: 2, status: 'ENCERRADA' },
          { id: 3, status: 'ABERTA' },
        ],
      },
    });

    const result = await listarFolhasAbertas(client);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe(1);
    expect(result[1].id).toBe(3);
  });

  test('returns empty array when no open payrolls', async () => {
    const client = createMockClient({
      '/api/empregadordomestico/folha': {
        data: [{ id: 1, status: 'ENCERRADA' }],
      },
    });

    const result = await listarFolhasAbertas(client);
    expect(result).toHaveLength(0);
  });

  test('handles empty response data', async () => {
    const client = createMockClient({
      '/api/empregadordomestico/folha': { data: null },
    });

    const result = await listarFolhasAbertas(client);
    expect(result).toHaveLength(0);
  });

  test('handles case-insensitive status "aberta"', async () => {
    const client = createMockClient({
      '/api/empregadordomestico/folha': {
        data: [{ id: 1, status: 'aberta' }],
      },
    });

    const result = await listarFolhasAbertas(client);
    expect(result).toHaveLength(1);
  });
});

describe('verificarCompetencia', () => {
  test('calls API with correct params', async () => {
    const client = createMockClient({});
    client.get.mockResolvedValue({ data: { status: 'ABERTA' } });

    const result = await verificarCompetencia(client, { mes: 3, ano: 2025 });
    expect(client.get).toHaveBeenCalledWith('/api/empregadordomestico/folha/competencia', {
      params: { mes: 3, ano: 2025 },
    });
    expect(result.status).toBe('ABERTA');
  });
});

describe('encerrarFolha', () => {
  test('closes payroll successfully', async () => {
    const client = createMockClient({});
    client.post.mockResolvedValue({ data: { status: 'ENCERRADA' } });

    const result = await encerrarFolha(client, { mes: 3, ano: 2025 });
    expect(result.status).toBe('ENCERRADA');
    expect(client.post).toHaveBeenCalledWith('/api/empregadordomestico/folha/encerrar', {
      mes: 3,
      ano: 2025,
    });
  });

  test('handles already-closed payroll gracefully', async () => {
    const client = createMockClient({});
    const error = new Error('Request failed');
    error.response = {
      status: 409,
      data: 'Folha já encerrada para este período',
    };
    client.post.mockRejectedValue(error);

    const result = await encerrarFolha(client, { mes: 3, ano: 2025 });
    expect(result.status).toBe('already_closed');
  });

  test('throws on unexpected errors', async () => {
    const client = createMockClient({});
    const error = new Error('Network error');
    error.response = null;
    client.post.mockRejectedValue(error);

    await expect(encerrarFolha(client, { mes: 3, ano: 2025 })).rejects.toThrow('Network error');
  });
});
