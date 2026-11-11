'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// Session persistence has no logging contract. Avoid opening asynchronous file
// transports in a directory the test removes immediately after the assertion.
jest.mock('../src/utils/logger', () => {
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  logger.child = () => logger;
  return logger;
});

describe('persistSession', () => {
  test('writes session.json with owner-only mode', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'esocial-session-'));
    const prev = process.cwd();
    process.chdir(dir);
    jest.resetModules();
    try {
      const { persistSession } = require('../src/auth/govbr');
      persistSession({ cookies: [{ name: 'x', value: 'dummy', expires: 9999999999 }] });
      const st = fs.statSync(path.join(dir, 'session.json'));
      expect(st.mode & 0o077).toBe(0);
    } finally {
      process.chdir(prev);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
