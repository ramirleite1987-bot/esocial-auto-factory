'use strict';

require('dotenv').config();
const { createLogger, format, transports } = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');

const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const LOG_DIR = process.env.LOG_DIR || './logs';

const { combine, timestamp, printf, colorize, errors } = format;

/**
 * Custom log format:
 * [2024-05-07T09:10:11Z] [INFO] [context] message
 */
const logFormat = printf(({ level, message, timestamp: ts, context, stack }) => {
  const ctx = context ? `[${context}] ` : '';
  const msg = stack || message;
  return `[${ts}] [${level.toUpperCase()}] ${ctx}${msg}`;
});

const consoleFormat = combine(
  colorize({ all: true }),
  timestamp({ format: 'YYYY-MM-DDTHH:mm:ssZ' }),
  errors({ stack: true }),
  logFormat
);

const fileFormat = combine(
  timestamp({ format: 'YYYY-MM-DDTHH:mm:ssZ' }),
  errors({ stack: true }),
  logFormat
);

const dailyRotateTransport = new DailyRotateFile({
  dirname: LOG_DIR,
  filename: 'app-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  maxFiles: '30d',
  level: LOG_LEVEL,
  format: fileFormat,
});

const logger = createLogger({
  level: LOG_LEVEL,
  transports: [
    new transports.Console({
      format: consoleFormat,
    }),
    dailyRotateTransport,
  ],
  exitOnError: false,
});

/**
 * Create a child logger with a fixed context label.
 * @param {string} context - Label to include in every log line (e.g. 'monthlyJob')
 * @returns {object} Winston child logger with context default metadata
 */
function createContextLogger(context) {
  return logger.child({ context });
}

module.exports = { logger, createContextLogger };
