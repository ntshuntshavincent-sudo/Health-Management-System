require('dotenv').config();
const fs   = require('fs');
const path = require('path');

// ── Ensure log directory exists ───────────────────────────────────────────────
const logDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

const express = require('express');
const cors    = require('cors');

// ── Security middleware ───────────────────────────────────────────────────────
const {
  helmetMiddleware,
  loginLimiter,
  lookupLimiter,
  generalLimiter,
  requestId,
  auditLog,
  httpLogger,
  logger,
} = require('./middleware/security');
const { sanitise } = require('./middleware/sanitise');

// ── Route files ───────────────────────────────────────────────────────────────
const authRoutes        = require('./routes/auth');
const patientRoutes     = require('./routes/patients');
const appointmentRoutes = require('./routes/appointments');
const noteRoutes        = require('./routes/notes');
const doctorRoutes      = require('./routes/doctors');
const pool              = require('./db/pool');

const app  = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';

// ── CORS ──────────────────────────────────────────────────────────────────────
// In production, only allow requests from your actual frontend domain.
// Change FRONTEND_URL in your .env to match your deployed frontend.
const allowedOrigins = isProduction
  ? [process.env.FRONTEND_URL || 'https://yourhospital.co.za']
  : ['http://localhost:3001', 'http://localhost:3000'];

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (mobile apps, Postman, curl)
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ── Core middleware (order matters!) ──────────────────────────────────────────
app.set('trust proxy', 1);         // Trust nginx reverse proxy for real IPs
app.use(requestId);                // Attach unique ID to every request
app.use(helmetMiddleware);         // Security headers
app.use(httpLogger);               // HTTP access log
app.use(auditLog);                 // POPIA-compliant audit trail
app.use(express.json({ limit: '10kb' }));  // Limit body size to prevent DoS
app.use(sanitise);                 // Strip dangerous input
app.use(generalLimiter);          // Global rate limiting

// ── Routes ────────────────────────────────────────────────────────────────────
// Apply specific rate limits where needed
app.use('/api/auth/login',   loginLimiter);     // Brute-force protection
app.use('/api/patients',     lookupLimiter);    // Kiosk lookup protection

app.use('/api/auth',         authRoutes);
app.use('/api/patients',     patientRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/notes',        noteRoutes);
app.use('/api/doctors',      doctorRoutes);

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({
      status: 'ok',
      database: 'connected',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  } catch {
    res.status(503).json({ status: 'error', database: 'unreachable' });
  }
});

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Route not found.' }));

// ── Global error handler ──────────────────────────────────────────────────────
// IMPORTANT: Never expose internal error details to the client in production
app.use((err, _req, res, _next) => {
  logger.error('Unhandled error', {
    message: err.message,
    stack:   err.stack,
  });

  const statusCode = err.statusCode || 500;
  const message = isProduction
    ? 'An internal server error occurred.'   // Hide details in production
    : err.message;                           // Show details in development

  res.status(statusCode).json({ error: message });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  logger.info(`Patient system API started`, {
    port: PORT,
    environment: process.env.NODE_ENV || 'development',
    pid: process.pid,
  });
  console.log(`\n Patient system API running on http://localhost:${PORT}`);
  console.log(` Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(` Logs: ./logs/combined.log\n`);
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
// Finish in-flight requests before closing — prevents data loss
const shutdown = async (signal) => {
  logger.info(`${signal} received — shutting down gracefully`);
  await pool.end();
  process.exit(0);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

module.exports = app;
