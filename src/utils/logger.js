'use strict';

const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');

const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const LOG_DIR = process.env.LOG_DIR || path.join(process.cwd(), 'logs');

const SENSITIVE_KEYS = ['password', 'senha', 'token', 'secret', 'cpf', 'authorization', 'cookie'];
const RESERVED_INFO_KEYS = new Set(['level', 'message', 'timestamp', 'context', 'splat']);
const REDACTED = '[REDACTED]';
const MAX_REDACT_DEPTH = 6;

function isSensitiveKey(key) {
  const k = String(key).toLowerCase();
  return SENSITIVE_KEYS.some((s) => k.includes(s));
}

/**
 * Recursively redact sensitive values within an object/array.
 * Mutates and returns the input. Depth-limited and cycle-safe.
 *
 * @param {*} value - Any value (only objects/arrays are walked)
 * @param {number} depth
 * @param {WeakSet} seen
 * @returns {*}
 */
function redactDeep(value, depth, seen) {
  if (value === null || typeof value !== 'object') return value;
  if (depth > MAX_REDACT_DEPTH) return value;
  if (seen.has(value)) return value;
  seen.add(value);

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      value[i] = redactDeep(value[i], depth + 1, seen);
    }
    return value;
  }

  for (const key of Object.keys(value)) {
    if (isSensitiveKey(key)) {
      value[key] = REDACTED;
    } else if (value[key] && typeof value[key] === 'object') {
      value[key] = redactDeep(value[key], depth + 1, seen);
    }
  }
  return value;
}

/**
 * Redact sensitive content from a Winston log record.
 *
 * Scans both the message object AND the top-level meta keys that Winston
 * merges into `info` from `logger.info(msg, meta)` — previously, secrets
 * passed via meta (e.g. { token: '...' }) were never redacted because the
 * old implementation only inspected `info.message`. Also recurses into
 * nested objects so { user: { password: '...' } } no longer leaks.
 *
 * @param {object} info - Winston log record
 * @returns {object} The (mutated) record
 */
function redactSensitive(info) {
  const seen = new WeakSet();

  for (const key of Object.keys(info)) {
    if (RESERVED_INFO_KEYS.has(key)) continue;
    if (isSensitiveKey(key)) {
      info[key] = REDACTED;
    } else if (info[key] && typeof info[key] === 'object') {
      info[key] = redactDeep(info[key], 1, seen);
    }
  }

  if (info.message && typeof info.message === 'object') {
    info.message = redactDeep(info.message, 1, seen);
  }

  return info;
}

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format((info) => redactSensitive(info))(),
  winston.format.printf(({ timestamp, level, context, message }) => {
    const ctx = context ? ` [${context}]` : '';
    const msg = typeof message === 'object' ? JSON.stringify(message) : message;
    return `[${timestamp}] [${level.toUpperCase()}]${ctx} ${msg}`;
  }),
);

const fileTransport = new DailyRotateFile({
  dirname: LOG_DIR,
  filename: 'app-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  maxFiles: '30d',
  level: LOG_LEVEL,
  format: logFormat,
});

fileTransport.on('error', (err) => {
  console.error('Logger file transport error:', err);
});

const consoleTransport = new winston.transports.Console({
  level: LOG_LEVEL,
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format((info) => redactSensitive(info))(),
    winston.format.colorize({ all: true }),
    winston.format.printf(({ timestamp, level, context, message }) => {
      const ctx = context ? ` [${context}]` : '';
      const msg = typeof message === 'object' ? JSON.stringify(message) : message;
      return `[${timestamp}] [${level}]${ctx} ${msg}`;
    }),
  ),
});

const logger = winston.createLogger({
  level: LOG_LEVEL,
  transports: [fileTransport, consoleTransport],
  exitOnError: false,
});

/**
 * Create a child logger with a fixed context label.
 * Accepts either a string or { context: string } for compatibility.
 * @param {string|{context:string}} opts - Context label or options object
 * @returns {{ info: Function, warn: Function, error: Function, debug: Function }}
 */
logger.child = function createChild(opts) {
  const ctx = typeof opts === 'object' && opts !== null ? opts.context : opts;
  const child = {
    info: (msg, meta) => logger.info(msg, { context: ctx, ...meta }),
    warn: (msg, meta) => logger.warn(msg, { context: ctx, ...meta }),
    error: (msg, meta) => logger.error(msg, { context: ctx, ...meta }),
    debug: (msg, meta) => logger.debug(msg, { context: ctx, ...meta }),
  };
  child.child = (childOpts) => {
    const childCtx = typeof childOpts === 'object' && childOpts !== null ? childOpts.context : childOpts;
    return createChild({ context: `${ctx}:${childCtx}` });
  };
  return child;
};

module.exports = logger;
module.exports.redactSensitive = redactSensitive;
module.exports.SENSITIVE_KEYS = SENSITIVE_KEYS;
