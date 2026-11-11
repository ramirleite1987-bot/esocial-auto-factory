'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

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
