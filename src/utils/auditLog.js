'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('./logger').child({ context: 'audit' });

const DEFAULT_AUDIT_PATH = path.join(process.cwd(), 'output', 'runs.jsonl');

/**
 * Resolve the audit-log file path from env or default.
 * @returns {string}
 */
function resolveAuditPath() {
  return process.env.AUDIT_LOG_PATH || DEFAULT_AUDIT_PATH;
}

/**
 * Append one entry describing a completed run to the audit log.
 * Best-effort — never throws. Each call writes a single newline-terminated
 * JSON object to the file (JSON Lines format), so the log can be tailed,
 * grepped, and consumed by tools that read line-delimited JSON.
 *
 * @param {object} entry - Run metadata. A `timestamp` field is added if absent.
 *   Recommended fields: status, periodo, durationMs, error, pdfPath.
 */
function appendRun(entry) {
  try {
    const auditPath = resolveAuditPath();
    const dir = path.dirname(auditPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const record = { timestamp: new Date().toISOString(), ...entry };
    fs.appendFileSync(auditPath, JSON.stringify(record) + '\n', 'utf8');
  } catch (err) {
    logger.warn(`Failed to append audit log: ${err.message}`);
  }
}

/**
 * Read the most recent N entries from the audit log.
 * Best-effort — returns [] on missing file or parse errors.
 *
 * @param {number} [limit=10] - Maximum number of entries to return
 * @returns {Array<object>}
 */
function readRecent(limit = 10) {
  try {
    const auditPath = resolveAuditPath();
    if (!fs.existsSync(auditPath)) return [];
    const content = fs.readFileSync(auditPath, 'utf8').trim();
    if (!content) return [];
    const lines = content.split('\n');
    const tail = lines.slice(-Math.max(0, limit));
    return tail
      .map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .filter((x) => x !== null);
  } catch (err) {
    logger.warn(`Failed to read audit log: ${err.message}`);
    return [];
  }
}

module.exports = { appendRun, readRecent, resolveAuditPath };
