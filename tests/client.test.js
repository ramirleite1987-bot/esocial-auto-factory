'use strict';

jest.mock('../src/auth/govbr', () => ({
  authenticate: jest.fn().mockResolvedValue('new-cookie=value'),
}));

describe('createClient', () => {
  test('creates axios instance with correct defaults', () => {
    const { createClient } = require('../src/esocial/client');
    const client = createClient('session-cookie=abc');
    expect(client.defaults.headers.Cookie).toBe('session-cookie=abc');
    expect(client.defaults.baseURL).toBeDefined();
    expect(client.defaults.timeout).toBeGreaterThan(0);
  });

  test('includes Accept: application/json header', () => {
    const { createClient } = require('../src/esocial/client');
    const client = createClient('session-cookie=abc');
    expect(client.defaults.headers.Accept).toBe('application/json');
  });
});
