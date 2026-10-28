#!/usr/bin/env node
/**
 * HealthRecord API — entry point
 * ─────────────────────────────
 * Validates configuration, tells you plainly whether PostgreSQL is reachable,
 * then starts serving. PM2 (see deployment/ecosystem.config.js) keeps this
 * process alive in production.
 */

const config = require('./src/config');

// Fail fast on an insecure configuration before we expose patient data.
try {
  config.validateConfig();
} catch (err) {
  console.error('\n✖ ' + err.message + '\n');
  process.exit(1);
}

const app = require('./src/app');
const db  = require('./src/db/pool');
const { logger } = require('./src/services/log');

const server = app.listen(config.port, async () => {
  console.log('');
  console.log('  🏥  HealthRecord API');
  console.log(`      listening   http://localhost:${config.port}`);
  console.log(`      environment ${config.env}`);
  console.log(`      database    ${config.db.database}@${config.db.host}:${config.db.port}`);
  console.log(`      logs        ./logs/combined.log`);
  console.log('');

  try {
    await db.healthCheck();
    console.log('  ✓  PostgreSQL reachable');
    const { rows } = await db.query(`
      SELECT (SELECT COUNT(*)::int FROM facilities) AS facilities,
             (SELECT COUNT(*)::int FROM users)      AS users
    `).catch(() => ({ rows: [{ facilities: null, users: null }] }));

    if (rows[0].facilities === null) {
      console.log('  •  Tables not found — run:  npm run migrate && npm run seed -- --demo');
    } else if (rows[0].users === 0) {
      console.log('  •  No user accounts yet — run:  npm run seed');
    } else {
      console.log(`  •  ${rows[0].facilities} facility(ies), ${rows[0].users} user account(s)`);
    }
    console.log('');
  } catch (err) {
    console.error('  ✖  PostgreSQL unreachable:', err.message);
    console.error('     Fix DB_* values in backend/.env, then restart. The API will');
    console.error('     answer /health with 503 until the database is back.\n');
  }

  logger.info('API started', { port: config.port, env: config.env, pid: process.pid });
});

// ── GRACEFUL SHUTDOWN ────────────────────────────────────────────────────────
// Let in-flight requests finish and close the pool, so a deploy never leaves a
// half-written visit note behind.
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${signal} received — shutting down gracefully`);
  console.log(`\n  ${signal} received — finishing in-flight requests…`);

  server.close(async () => {
    try { await db.close(); } catch { /* already closed */ }
    console.log('  ✓  Shutdown complete\n');
    process.exit(0);
  });

  // Safety net: never hang forever.
  setTimeout(() => {
    console.error('  ✖  Forced exit after 10s');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason: String(reason) });
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception — shutting down', { message: err.message, stack: err.stack });
  shutdown('uncaughtException');
});

module.exports = server;