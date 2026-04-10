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
