'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

describe('auditLog', () => {
  const originalEnv = process.env;
  let tmpDir;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-test-'));
    process.env.AUDIT_LOG_PATH = path.join(tmpDir, 'runs.jsonl');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('appendRun creates the file and writes one JSON line per call', () => {
    const { appendRun } = require('../src/utils/auditLog');
    appendRun({ status: 'success', periodo: '03/2025', durationMs: 1234 });
    appendRun({ status: 'error', periodo: '04/2025', error: 'boom', durationMs: 500 });

    const content = fs.readFileSync(process.env.AUDIT_LOG_PATH, 'utf8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(2);

    const first = JSON.parse(lines[0]);
    expect(first.status).toBe('success');
    expect(first.periodo).toBe('03/2025');
    expect(first.durationMs).toBe(1234);
    expect(first.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const second = JSON.parse(lines[1]);
    expect(second.error).toBe('boom');
  });

  test('appendRun creates parent directory if missing', () => {
    process.env.AUDIT_LOG_PATH = path.join(tmpDir, 'nested', 'deeper', 'runs.jsonl');
    const { appendRun } = require('../src/utils/auditLog');
    appendRun({ status: 'success' });

    expect(fs.existsSync(process.env.AUDIT_LOG_PATH)).toBe(true);
  });

  test('appendRun preserves caller-provided timestamp', () => {
    const { appendRun } = require('../src/utils/auditLog');
    appendRun({ timestamp: '2025-01-01T00:00:00.000Z', status: 'success' });

    const line = fs.readFileSync(process.env.AUDIT_LOG_PATH, 'utf8').trim();
    const entry = JSON.parse(line);
    expect(entry.timestamp).toBe('2025-01-01T00:00:00.000Z');
  });

  test('appendRun never throws on filesystem errors', () => {
    process.env.AUDIT_LOG_PATH = '/nonexistent-readonly-root/audit.jsonl';
    const { appendRun } = require('../src/utils/auditLog');
    expect(() => appendRun({ status: 'success' })).not.toThrow();
  });

  test('readRecent returns [] when file does not exist', () => {
    const { readRecent } = require('../src/utils/auditLog');
    expect(readRecent()).toEqual([]);
  });

  test('readRecent returns last N entries in order', () => {
    const { appendRun, readRecent } = require('../src/utils/auditLog');
    for (let i = 1; i <= 5; i++) {
      appendRun({ status: 'success', n: i });
    }
    const recent = readRecent(3);
    expect(recent).toHaveLength(3);
    expect(recent.map((r) => r.n)).toEqual([3, 4, 5]);
  });

  test('readRecent skips malformed lines without throwing', () => {
    fs.writeFileSync(
      process.env.AUDIT_LOG_PATH,
      '{"status":"success"}\nnot-json\n{"status":"error"}\n',
      'utf8',
    );
    const { readRecent } = require('../src/utils/auditLog');
    const result = readRecent();
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.status)).toEqual(['success', 'error']);
  });

  test('resolveAuditPath honors AUDIT_LOG_PATH env override', () => {
    const { resolveAuditPath } = require('../src/utils/auditLog');
    expect(resolveAuditPath()).toBe(process.env.AUDIT_LOG_PATH);
  });
});
