'use strict';

jest.mock('../src/auth/govbr', () => ({
  authenticate: jest.fn(),
}));

const fs = require('fs');
const path = require('path');

const SESSION_PATH = path.join(process.cwd(), 'session.json');

function freshClient(cookie = 's=1') {
  const { createClient } = require('../src/esocial/client');
  const { authenticate } = require('../src/auth/govbr');
  authenticate.mockReset();
  return { client: createClient(cookie), authenticate };
}

describe('createClient', () => {
  beforeEach(() => {
    if (fs.existsSync(SESSION_PATH)) fs.unlinkSync(SESSION_PATH);
  });

  afterAll(() => {
    if (fs.existsSync(SESSION_PATH)) fs.unlinkSync(SESSION_PATH);
  });

  test('creates axios instance with correct defaults', () => {
    const { client } = freshClient('session-cookie=abc');
    expect(client.defaults.headers.Cookie).toBe('session-cookie=abc');
    expect(client.defaults.baseURL).toBeDefined();
    expect(client.defaults.timeout).toBeGreaterThan(0);
  });

  test('includes Accept: application/json header', () => {
    const { client } = freshClient();
    expect(client.defaults.headers.Accept).toBe('application/json');
  });

  test('honors ESOCIAL_BASE_URL and ESOCIAL_TIMEOUT env vars', () => {
    jest.resetModules();
    process.env.ESOCIAL_BASE_URL = 'https://example.test';
    process.env.ESOCIAL_TIMEOUT = '12345';
    try {
      const { client } = freshClient();
      expect(client.defaults.baseURL).toBe('https://example.test');
      expect(client.defaults.timeout).toBe(12345);
    } finally {
      delete process.env.ESOCIAL_BASE_URL;
      delete process.env.ESOCIAL_TIMEOUT;
      jest.resetModules();
    }
  });

  describe('response interceptor', () => {
    test('passes successful responses through unchanged', async () => {
      const { client } = freshClient();
      const handler = client.interceptors.response.handlers[0];
      const response = { data: { ok: true }, config: { url: '/x' } };
      const result = await handler.fulfilled(response);
      expect(result).toBe(response);
    });

    test('warns when response has no data but still returns it', async () => {
      const { client } = freshClient();
      const handler = client.interceptors.response.handlers[0];
      const response = { config: { url: '/empty' } };
      const result = await handler.fulfilled(response);
      expect(result).toBe(response);
    });

    test('tolerates a null response object', async () => {
      const { client } = freshClient();
      const handler = client.interceptors.response.handlers[0];
      const result = await handler.fulfilled(null);
      expect(result).toBeNull();
    });

    test('re-authenticates on 401 and retries the original request', async () => {
      fs.writeFileSync(SESSION_PATH, '{"cookies":[]}', 'utf-8');
      const { client, authenticate } = freshClient('stale=1');
      authenticate.mockResolvedValue('fresh-cookie=xyz');

      const requestSpy = jest
        .spyOn(client, 'request')
        .mockResolvedValue({ data: { retried: true }, status: 200 });

      const handler = client.interceptors.response.handlers[0];
      const cfg = { url: '/protected', headers: { Cookie: 'stale=1' } };
      const result = await handler.rejected({
        response: { status: 401 },
        config: cfg,
        message: 'Unauthorized',
      });

      expect(authenticate).toHaveBeenCalledTimes(1);
      expect(cfg._retried).toBe(true);
      expect(cfg.headers.Cookie).toBe('fresh-cookie=xyz');
      expect(client.defaults.headers.Cookie).toBe('fresh-cookie=xyz');
      expect(requestSpy).toHaveBeenCalledWith(cfg);
      expect(result.data.retried).toBe(true);
      expect(fs.existsSync(SESSION_PATH)).toBe(false);
    });

    test('re-authenticates on 403 as well', async () => {
      const { client, authenticate } = freshClient();
      authenticate.mockResolvedValue('fresh=1');
      jest.spyOn(client, 'request').mockResolvedValue({ data: 'ok' });

      const handler = client.interceptors.response.handlers[0];
      const cfg = { url: '/x', headers: { Cookie: 's=1' } };
      await handler.rejected({ response: { status: 403 }, config: cfg, message: 'Forbidden' });

      expect(authenticate).toHaveBeenCalledTimes(1);
      expect(cfg._retried).toBe(true);
    });

    test('does not re-authenticate twice for the same request (avoids infinite loop)', async () => {
      const { client, authenticate } = freshClient();
      authenticate.mockResolvedValue('fresh=1');

      const handler = client.interceptors.response.handlers[0];
      const cfg = { url: '/x', headers: { Cookie: 's=1' }, _retried: true };
      const err = { response: { status: 401 }, config: cfg, message: 'Unauthorized' };

      await expect(handler.rejected(err)).rejects.toBe(err);
      expect(authenticate).not.toHaveBeenCalled();
    });

    test('skips session.json deletion when the file does not exist', async () => {
      if (fs.existsSync(SESSION_PATH)) fs.unlinkSync(SESSION_PATH);
      const { client, authenticate } = freshClient();
      authenticate.mockResolvedValue('fresh=1');
      jest.spyOn(client, 'request').mockResolvedValue({ data: 'ok' });

      const handler = client.interceptors.response.handlers[0];
      const cfg = { url: '/x', headers: { Cookie: 's=1' } };
      await handler.rejected({ response: { status: 401 }, config: cfg, message: 'Unauthorized' });

      expect(authenticate).toHaveBeenCalledTimes(1);
    });

    test('logs and rethrows 5xx errors without re-authenticating', async () => {
      const { client, authenticate } = freshClient();
      const handler = client.interceptors.response.handlers[0];

      const err = {
        response: { status: 503 },
        config: { url: '/x' },
        message: 'Service Unavailable',
      };
      await expect(handler.rejected(err)).rejects.toBe(err);
      expect(authenticate).not.toHaveBeenCalled();
    });

    test('rethrows non-auth, non-5xx errors as-is', async () => {
      const { client, authenticate } = freshClient();
      const handler = client.interceptors.response.handlers[0];

      const err = {
        response: { status: 400 },
        config: { url: '/x' },
        message: 'Bad Request',
      };
      await expect(handler.rejected(err)).rejects.toBe(err);
      expect(authenticate).not.toHaveBeenCalled();
    });

    test('rethrows network errors with no response', async () => {
      const { client, authenticate } = freshClient();
      const handler = client.interceptors.response.handlers[0];

      const err = { config: { url: '/x' }, message: 'ECONNREFUSED' };
      await expect(handler.rejected(err)).rejects.toBe(err);
      expect(authenticate).not.toHaveBeenCalled();
    });
  });
});
