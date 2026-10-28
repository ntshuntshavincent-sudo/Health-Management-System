/**
 * EXPRESS APPLICATION
 * ──────────────────
 * Assembles middleware in the order that matters, then mounts the API. Kept
 * separate from server.js so tests can import the app without opening a port.
 *
 * Middleware order (do not shuffle these):
 *   helmet → cors → requestId → http log → body parse → sanitise → app log
 *   → rate limit → routes → 404 → error handler
 */

const express = require('express');
const cors    = require('cors');

const config  = require('./config');
const routes  = require('./routes');
const db      = require('./db/pool');
const { logger } = require('./services/log');
const { ApiError } = require('./utils/http');
const {
  helmetMiddleware,
  loginLimiter,
  lookupLimiter,
  generalLimiter,
  requestId,
  requestLogger,
  httpLogger,
} = require('./middleware/security');
const { sanitise } = require('./middleware/sanitise');

const app = express();

app.disable('x-powered-by');
// Behind nginx (or any reverse proxy) this makes req.ip the real client, which
// matters for rate limiting and for the POPIA access log.
app.set('trust proxy', 1);

// ── CORS ────────────────────────────────────────────────────────────────────
// Only the configured frontend origins may call the API from a browser.
const corsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true);                    // curl, apps, health checks
    if (config.corsOrigins.includes(origin)) return callback(null, true);
    logger.warn('Blocked CORS origin', { origin });
    return callback(new ApiError(403, `Origin ${origin} is not allowed to call this API.`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Kiosk-Key', 'X-Request-Id'],
  exposedHeaders: ['X-Request-Id'],
  maxAge: 600,
};

app.use(helmetMiddleware);
app.use(cors(corsOptions));
app.use(requestId);
app.use(httpLogger);
app.use(express.json({ limit: config.maxBodySize }));
app.use(express.urlencoded({ extended: true, limit: config.maxBodySize }));
app.use(sanitise);
app.use(requestLogger);
app.use(generalLimiter);

// ─ HEALTH ───────────────────────────────────────────────────────────────────
// Monitoring (and the deployment script) uses this to tell "API up" from
// "API up but database gone".
app.get('/health', async (_req, res) => {
  try {
    await db.healthCheck();
    res.json({
      status: 'ok',
      database: 'connected',
      environment: config.env,
      version: require('../package.json').version,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(503).json({
      status: 'degraded',
      database: 'unreachable',
      error: err.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// ── TIGHTER LIMITS ON THE SENSITIVE DOORS ────────────────────────────────────
app.use('/api/auth/login',   loginLimiter);   // brute-force protection
app.use('/api/kiosk',        lookupLimiter);  // waiting-room touchscreen
app.use('/api/patients',     lookupLimiter);  // ID-number lookup by staff

// ── API ──────────────────────────────────────────────────────────────────────
app.use('/api', routes);

// ── 404 ─────────────────────────────────────────────────────────────────────
app.use((req, _res, next) => next(ApiError.notFound(`Route not found: ${req.method} ${req.path}`)));

// ── GLOBAL ERROR HANDLER ─────────────────────────────────────────────────────
// In production the client never sees internal messages — only a request id
// that maps to a stack trace in logs/error.log.
app.use((err, req, res, _next) => {
  const status = err.statusCode || err.status || 500;

  if (status >= 500) {
    logger.error('Unhandled error', {
      requestId: req.id,
      path: req.path,
      message: err.message,
      stack: err.stack,
      userId: req.user?.user_id || null,
    });
  }

  const message = status >= 500 && config.isProduction
    ? 'An internal server error occurred. Quote the requestId to your administrator.'
    : err.message;

  res.status(status).json({
    error: message,
    ...(err.details ? { details: err.details } : {}),
    requestId: req.id,
  });
});

module.exports = app;