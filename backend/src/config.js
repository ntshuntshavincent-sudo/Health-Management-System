/**
 * CENTRAL CONFIGURATION
 * ─────────────────────
 * Every environment variable the API reads is resolved here, once, with
 * sensible defaults. Nothing else in the codebase should touch process.env
 * directly — that keeps deployment mistakes to a single file.
 */

require('dotenv').config();

const env          = process.env.NODE_ENV || 'development';
const isProduction = env === 'production';

const num = (value, fallback) => {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const bool = (value, fallback = false) =>
  value === undefined ? fallback : ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());

const list = (value, fallback = []) =>
  (value ? String(value).split(',') : fallback).map((s) => s.trim()).filter(Boolean);

const config = {
  env,
  isProduction,

  port: num(process.env.PORT, 3000),

  // ── PostgreSQL ──────────────────────────────────────────────────────────────
  db: {
    connectionString: process.env.DATABASE_URL || null,
    host:     process.env.DB_HOST || 'localhost',
    port:     num(process.env.DB_PORT, 5432),
    database: process.env.DB_NAME || 'healthrecord',
    user:     process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    ssl:      bool(process.env.DB_SSL) ? { rejectUnauthorized: false } : false,
    max:      num(process.env.DB_POOL_MAX, 10),
  },

  // ── Auth ────────────────────────────────────────────────────────────────────
  jwt: {
    secret:    process.env.JWT_SECRET || 'insecure-development-secret-do-not-use-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  },
  bcryptRounds: num(process.env.BCRYPT_ROUNDS, 12),

  // ── Rate limiting ───────────────────────────────────────────────────────────
  limits: {
    loginMax:        num(process.env.LOGIN_MAX_ATTEMPTS, 10),
    loginWindowMs:   num(process.env.LOGIN_WINDOW_MINUTES, 15) * 60 * 1000,
    lookupMax:       num(process.env.LOOKUP_MAX_PER_MINUTE, 60),
    generalMax:      num(process.env.GENERAL_MAX_PER_MINUTE, 200),
  },

  // ── CORS ────────────────────────────────────────────────────────────────────
  // In development the React dev server ports are always allowed.
  corsOrigins: isProduction
    ? list(process.env.FRONTEND_URLS, ['http://localhost:3001'])
    : ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:5173'],

  // ── Records ─────────────────────────────────────────────────────────────────
  retentionYears: num(process.env.RETENTION_YEARS, 6),
  maxBodySize:    '64kb',   // clinical text, not file uploads — keep it small

  // ── Kiosk ───────────────────────────────────────────────────────────────────
  // The waiting-room touchscreen is a public device. Set KIOSK_API_KEY to a
  // shared secret so the lookup endpoint cannot be called from anywhere on the
  // network; leave it empty and the endpoint stays open (dev / pilot only).
  kiosk: {
    apiKey: process.env.KIOSK_API_KEY || null,
    // An unauthenticated kiosk NEVER receives clinical fields.
    minimisePublicLookup: bool(process.env.KIOSK_MINIMISE, true),
  },

  // ── First-run bootstrap ─────────────────────────────────────────────────────
  seed: {
    username: process.env.SEED_ADMIN_USERNAME || 'admin',
    password: process.env.SEED_ADMIN_PASSWORD || 'ChangeMe123!',
    fullName: process.env.SEED_ADMIN_FULLNAME || 'System Administrator',
  },
};

/**
 * Guard rails. Development only warns; production refuses to start so a
 * misconfigured clinic server can never run with a well-known JWT secret.
 */
function validateConfig() {
  const problems = [];

  if (!config.jwt.secret || config.jwt.secret.length < 32) {
    problems.push('JWT_SECRET must be at least 32 characters long.');
  }
  if (config.jwt.secret.startsWith('change_me') || config.jwt.secret.startsWith('insecure-')) {
    problems.push('JWT_SECRET is still the placeholder value — generate a real random secret.');
  }
  if (!config.db.connectionString && !config.db.password) {
    problems.push('No database password configured (DB_PASSWORD or DATABASE_URL).');
  }

  if (problems.length) {
    if (isProduction) {
      throw new Error(
        'Refusing to start in production with an insecure configuration:\n  - ' + problems.join('\n  - ')
      );
    }
    problems.forEach((p) => console.warn(`[config] WARNING: ${p}`));
  }

  return config;
}

module.exports = config;
module.exports.validateConfig = validateConfig;
