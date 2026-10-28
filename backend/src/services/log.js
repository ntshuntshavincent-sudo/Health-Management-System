/**
 * LOGGER
 * ─────
 * Winston, writing JSON lines to logs/combined.log and logs/error.log so there
 * is always an on-disk trail for a POPIA audit, plus colourised console output
 * during development.
 *
 * Patient ID numbers are redacted on the way into the log: a 13-digit sequence
 * is replaced with ***REDACTED-ID***. Logs are still powerful evidence, but
 * they are not a second, unmanaged copy of the patient register.
 */

const fs   = require('fs');
const path = require('path');
const winston = require('winston');
const config  = require('../config');

const LOG_DIR = path.join(__dirname, '..', '..', 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

/** Replace anything that looks like an SA ID number before it is persisted. */
const redactIds = winston.format((info) => {
  if (typeof info.message === 'string') {
    info.message = info.message.replace(/\b\d{13}\b/g, '***REDACTED-ID***');
  }
  return info;
});

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    redactIds(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: path.join(LOG_DIR, 'error.log'),    level: 'error' }),
    new winston.transports.File({ filename: path.join(LOG_DIR, 'combined.log') }),
  ],
  exitOnError: false,
});

// Readable output while developing; silent in production (PM2 captures stdout anyway).
if (!config.isProduction) {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.printf(({ level, message, timestamp }) => `${timestamp} ${level} ${message}`)
    ),
  }));
}

module.exports = { logger, LOG_DIR, redactIds };