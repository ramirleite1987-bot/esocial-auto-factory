'use strict';

const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');

const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const LOG_DIR = process.env.LOG_DIR || path.join(process.cwd(), 'logs');

const SENSITIVE_KEYS = ['password', 'senha', 'token', 'secret', 'cpf', 'authorization', 'cookie'];

function redactSensitive(info) {
  if (typeof info.message === 'object' && info.message !== null) {
    const sanitized = { ...info.message };
    for (const key of Object.keys(sanitized)) {
      if (SENSITIVE_KEYS.some((s) => key.toLowerCase().includes(s))) {
        sanitized[key] = '[REDACTED]';
      }
    }
    info.message = sanitized;
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
