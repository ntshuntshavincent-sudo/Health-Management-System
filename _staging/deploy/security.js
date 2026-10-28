const helmet       = require('helmet');
const rateLimit    = require('express-rate-limit');
const winston      = require('winston');
const morgan       = require('morgan');
const { v4: uuid } = require('uuid');

// ─── LOGGER ──────────────────────────────────────────────────────────────────
// All logs written to files so you have an audit trail for POPIA compliance.
// Errors go to error.log, everything else to combined.log.
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/error.log',    level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
  ],
});

// Also print to console in development
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    ),
  }));
}

// ─── HELMET ───────────────────────────────────────────────────────────────────
// Sets ~15 security-related HTTP headers automatically.
const helmetMiddleware = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'"],
      styleSrc:   ["'self'"],
      imgSrc:     ["'self'", 'data:'],
    },
  },
  hsts: {
    // Force HTTPS for 1 year once in production
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
});

// ─── RATE LIMITERS ────────────────────────────────────────────────────────────
// Login: max 10 attempts per 15 minutes per IP — prevents brute-force attacks
const loginLimiter = rateLimit({
  windowMs:  15 * 60 * 1000,
  max:        10,
  message:   { error: 'Too many login attempts. Please wait 15 minutes and try again.' },
  standardHeaders: true,
  legacyHeaders:   false,
});

// Kiosk lookup: max 60 lookups per minute per IP (generous for clinic use)
const lookupLimiter = rateLimit({
  windowMs: 60 * 1000,
  max:      60,
  message:  { error: 'Too many requests. Please slow down.' },
});

// General API: max 200 requests per minute per IP
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max:      200,
  message:  { error: 'Rate limit exceeded. Please try again shortly.' },
});

// ─── REQUEST ID ───────────────────────────────────────────────────────────────
// Attach a unique ID to every request so you can trace issues in logs
const requestId = (req, res, next) => {
  req.id = uuid();
  res.setHeader('X-Request-Id', req.id);
  next();
};

// ─── AUDIT LOG MIDDLEWARE ─────────────────────────────────────────────────────
// Logs every API call with: who made it, what they did, when.
// This is the POPIA-compliant access log — required for patient data systems.
const auditLog = (req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    // Only log API routes, not static assets
    if (!req.path.startsWith('/api')) return;

    const entry = {
      requestId:  req.id,
      method:     req.method,
      path:       req.path,
      statusCode: res.statusCode,
      duration:   `${Date.now() - start}ms`,
      userId:     req.user?.user_id   || 'unauthenticated',
      username:   req.user?.username  || 'unauthenticated',
      role:       req.user?.role      || 'none',
      ip:         req.ip,
      userAgent:  req.get('user-agent'),
    };

    // Flag any access to patient data specifically
    if (req.path.includes('/patients') || req.path.includes('/notes')) {
      entry.dataAccess = 'patient_data';
    }

    if (res.statusCode >= 400) {
      logger.warn('Request error', entry);
    } else {
      logger.info('API access', entry);
    }
  });
  next();
};

// ─── HTTP REQUEST LOGGER ──────────────────────────────────────────────────────
// Compact HTTP access log (like Apache/Nginx combined format)
const httpLogger = morgan('combined', {
  stream: {
    write: (msg) => logger.info(msg.trim()),
  },
});

module.exports = {
  logger,
  helmetMiddleware,
  loginLimiter,
  lookupLimiter,
  generalLimiter,
  requestId,
  auditLog,
  httpLogger,
};
