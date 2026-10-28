/**
 * SECURITY MIDDLEWARE
 * ───────────────────
 * HTTP hardening, request tracing and rate limiting. Everything here is
 * configurable from .env so a small clinic server and a provincial data centre
 * can run the same code with different limits.
 */

const crypto    = require('crypto');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan    = require('morgan');
const config    = require('../config');
const { logger } = require('../services/log');

// ─── HELMET ──────────────────────────────────────────────────────────────────
// This is an API: it returns JSON, never HTML, so the content security policy
// can be maximally strict.
const helmetMiddleware = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'none'"],
      scriptSrc:  ["'none'"],
      styleSrc:   ["'none'"],
      imgSrc:     ["'none'"],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
  // Force HTTPS for a year once the certificate is in place.
  hsts: config.isProduction
    ? { maxAge: 31_536_000, includeSubDomains: true, preload: true }
    : false,
  crossOriginResourcePolicy: { policy: 'same-site' },
  referrerPolicy: { policy: 'no-referrer' },
});

// ─── RATE LIMITERS ───────────────────────────────────────────────────────────
const limitResponse = (message) => ({ error: message });

/** Login: brute-force protection. 10 attempts per 15 minutes per IP by default. */
const loginLimiter = rateLimit({
  windowMs: config.limits.loginWindowMs,
  max:      config.limits.loginMax,
  standardHeaders: true,
  legacyHeaders:   false,
  message: limitResponse('Too many login attempts. Please wait 15 minutes and try again.'),
});

/**
 * Kiosk lookup: generous enough for a busy waiting room (60/min per IP), but
 * it stops somebody walking up to the kiosk and harvesting records.
 */
const lookupLimiter = rateLimit({
  windowMs: 60 * 1000,
  max:      config.limits.lookupMax,
  standardHeaders: true,
  legacyHeaders:   false,
  message: limitResponse('Too many requests. Please slow down.'),
});

/** Everything else. */
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max:      config.limits.generalMax,
  standardHeaders: true,
  legacyHeaders:   false,
  message: limitResponse('Rate limit exceeded. Please try again shortly.'),
});

// ─── REQUEST ID ──────────────────────────────────────────────────────────────
// Every response carries X-Request-Id so a nurse's screenshot can be traced to
// exact log lines.
function requestId(req, res, next) {
  req.id = req.headers['x-request-id'] || crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
}

// ─── ACCESS LOG (file only, not the database) ─────────────────────────────────
// The POPIA database trail is written deliberately by routes via services/audit.
// This is the low-level HTTP log: cheap, and enough for debugging.
function requestLogger(req, res, next) {
  const startedAt = Date.now();

  res.on('finish', () => {
    if (!req.path.startsWith('/api')) return;

    const entry = {
      requestId:  req.id,
      method:     req.method,
      path:       req.path,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
      userId:     req.user?.user_id  || 'unauthenticated',
      username:   req.user?.username || 'unauthenticated',
      role:       req.user?.role     || 'none',
      facilityId: req.user?.facility_id || req.facilityId || null,
      ip:         req.ip,
    };

    if (req.path.includes('/patients') || req.path.includes('/notes') || req.path.includes('/vitals')) {
      entry.dataAccess = 'patient_data';
    }

    if (res.statusCode >= 500)      logger.error('Request failed', entry);
    else if (res.statusCode >= 400) logger.warn('Request rejected', entry);
    else                            logger.info('API access', entry);
  });

  next();
}

/** Compact combined-format HTTP log, routed into winston. */
const httpLogger = morgan('combined', {
  stream: { write: (msg) => logger.info(msg.trim()) },
  skip: (_req, res) => res.statusCode === 304,
});

module.exports = {
  helmetMiddleware,
  loginLimiter,
  lookupLimiter,
  generalLimiter,
  requestId,
  requestLogger,
  httpLogger,
};