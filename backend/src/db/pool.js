/**
 * POSTGRESQL CONNECTION
 * ───────────────────
 * A single shared pool for the whole process (PM2 cluster mode gives each
 * worker its own pool, which is why DB_POOL_MAX stays modest).
 *
 * Usage:
 *   const db = require('../db/pool');
 *   const { rows } = await db.query('SELECT ...', [param]);
 *   await db.withTransaction(async (client) => { ... });
 */

const { Pool } = require('pg');
const config   = require('../config');

const pool = config.db.connectionString
  ? new Pool({
      connectionString: config.db.connectionString,
      ssl:  config.db.ssl,
      max:  config.db.max,
      idleTimeoutMillis:       30_000,
      connectionTimeoutMillis: 5_000,
      application_name:        'healthrecord-api',
    })
  : new Pool({
      host:     config.db.host,
      port:     config.db.port,
      database: config.db.database,
      user:     config.db.user,
      password: config.db.password,
      ssl:      config.db.ssl,
      max:      config.db.max,
      idleTimeoutMillis:       30_000,
      connectionTimeoutMillis: 5_000,
      application_name:        'healthrecord-api',
    });

// A backend crash (e.g. Postgres restarted) must not kill the API process.
pool.on('error', (err) => {
  console.error('[db] idle client error:', err.message);
});

/** Run a parameterised query. Always use $1, $2 … placeholders — never string concat. */
async function query(text, params) {
  const startedAt = Date.now();
  try {
    const result = await pool.query(text, params);
    const ms = Date.now() - startedAt;
    if (ms > 500) console.warn(`[db] slow query (${ms}ms): ${String(text).slice(0, 120)}`);
    return result;
  } catch (err) {
    console.error('[db] query failed:', err.message);
    throw err;
  }
}

/**
 * Wrap several statements in a single transaction. The callback receives the
 * client, and everything is rolled back if it throws — essential when a visit
 * note, its vitals and the appointment status must change together.
 */
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* connection already broken */ }
    throw err;
  } finally {
    client.release();
  }
}

/** Used by /health so monitoring can detect a dead database immediately. */
async function healthCheck() {
  await pool.query('SELECT 1');
  return true;
}

module.exports = {
  pool,
  query,
  withTransaction,
  healthCheck,
  close: () => pool.end(),
};