'use strict';

describe('logger', () => {
  let logger;

  beforeAll(() => {
    logger = require('../src/utils/logger');
  });

  test('logger has expected transport methods', () => {
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.debug).toBe('function');
  });

  test('logger.child returns object with all log methods', () => {
    const child = logger.child({ context: 'test-module' });
    expect(typeof child.info).toBe('function');
    expect(typeof child.warn).toBe('function');
    expect(typeof child.error).toBe('function');
    expect(typeof child.debug).toBe('function');
  });

  test('logger.child accepts string parameter', () => {
    const child = logger.child('test-string');
    expect(typeof child.info).toBe('function');
  });

  test('logger.child supports nested children', () => {
    const parent = logger.child({ context: 'parent' });
    expect(typeof parent.child).toBe('function');
    const nested = parent.child({ context: 'nested' });
    expect(typeof nested.info).toBe('function');
    expect(typeof nested.warn).toBe('function');
  });

  test('logging does not throw', () => {
    const child = logger.child({ context: 'test' });
    expect(() => child.info('test message')).not.toThrow();
    expect(() => child.warn('test warning')).not.toThrow();
    expect(() => child.error('test error')).not.toThrow();
    expect(() => child.debug('test debug')).not.toThrow();
  });
});

describe('redactSensitive', () => {
  const { redactSensitive } = require('../src/utils/logger');

  test('redacts sensitive top-level meta keys', () => {
    const info = { level: 'info', message: 'login', token: 'abc', password: 'p1' };
    redactSensitive(info);
    expect(info.token).toBe('[REDACTED]');
    expect(info.password).toBe('[REDACTED]');
    expect(info.message).toBe('login');
  });

  test('does not redact reserved keys (level, message, context)', () => {
    const info = { level: 'info', message: 'hello', context: 'auth' };
    redactSensitive(info);
    expect(info.level).toBe('info');
    expect(info.message).toBe('hello');
    expect(info.context).toBe('auth');
  });

  test('redacts case-insensitively and substring matches', () => {
    const info = { level: 'info', message: 'x', AUTHORIZATION: 'Bearer xyz', user_cpf: '123' };
    redactSensitive(info);
    expect(info.AUTHORIZATION).toBe('[REDACTED]');
    expect(info.user_cpf).toBe('[REDACTED]');
  });

  test('redacts nested sensitive keys within meta objects', () => {
    const info = { level: 'info', message: 'x', meta: { user: { password: 'p1', name: 'alice' } } };
    redactSensitive(info);
    expect(info.meta.user.password).toBe('[REDACTED]');
    expect(info.meta.user.name).toBe('alice');
  });

  test('redacts sensitive keys within message object', () => {
    const info = { level: 'info', message: { user: 'alice', senha: 'p1', nested: { token: 'tok' } } };
    redactSensitive(info);
    expect(info.message.user).toBe('alice');
    expect(info.message.senha).toBe('[REDACTED]');
    expect(info.message.nested.token).toBe('[REDACTED]');
  });

  test('handles arrays of sensitive objects', () => {
    const info = {
      level: 'info',
      message: 'x',
      users: [{ password: 'p1' }, { password: 'p2', name: 'bob' }],
    };
    redactSensitive(info);
    expect(info.users[0].password).toBe('[REDACTED]');
    expect(info.users[1].password).toBe('[REDACTED]');
    expect(info.users[1].name).toBe('bob');
  });

  test('handles circular references without throwing', () => {
    const meta = { name: 'alice', token: 'tok' };
    meta.self = meta;
    const info = { level: 'info', message: 'x', meta };
    expect(() => redactSensitive(info)).not.toThrow();
    expect(info.meta.token).toBe('[REDACTED]');
  });

  test('preserves primitives in non-sensitive keys', () => {
    const info = { level: 'info', message: 'x', count: 42, ok: true };
    redactSensitive(info);
    expect(info.count).toBe(42);
    expect(info.ok).toBe(true);
  });
});
