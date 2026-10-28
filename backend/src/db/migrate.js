#!/usr/bin/env node
/**
 * MIGRATION RUNNER
 * ────────────────
 * Applies every .sql file in backend/migrations in filename order, each inside
 * its own transaction, and records what ran in schema_migrations. Re-running is
 * safe: applied files are skipped.
 *
 *   npm run migrate            apply pending migrations
 *   npm run migrate -- --reset drop the schema first (DEVELOPMENT ONLY)
 *   npm run migrate -- --list  show which files are applied
 *
 * The runner is plain Node + pg — no CLI tool needed on a clinic server where
 * only Node and PostgreSQL are installed.
 */

const fs   = require('fs');
const path = require('path');
const config = require('../config');
const db     = require('./pool');

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'migrations');

const args  = process.argv.slice(2);
const RESET = args.includes('--reset');
const LIST  = args.includes('--list');

const summary = { applied: [], skipped: [], failed: null };

async function ensureMigrationsTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

function migrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.toLowerCase().endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
}

async function appliedSet() {
  const { rows } = await db.query('SELECT filename FROM schema_migrations');
  return new Set(rows.map((r) => r.filename));
}

async function resetSchema() {
  if (config.isProduction) {
    throw new Error('--reset is refused while NODE_ENV=production.');
  }
  console.log('!! Dropping schema public (CASCADE) and recreating it …');
  await db.query('DROP SCHEMA IF EXISTS public CASCADE');
  await db.query('CREATE SCHEMA public');
}

async function applyFile(filename) {
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf8');

  await db.withTransaction(async (client) => {
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
  });
}

async function main() {
  console.log(`\nHealthRecord migrations  →  ${config.db.database}@${config.db.host}:${config.db.port}\n`);

  if (RESET) await resetSchema();

  await ensureMigrationsTable();
  const already = await appliedSet();
  const files   = migrationFiles();

  if (!files.length) {
    console.log('No migration files found.');
    return;
  }

  if (LIST) {
    files.forEach((f) => console.log(`${already.has(f) ? '[applied]' : '[pending]'} ${f}`));
    return;
  }

  for (const file of files) {
    if (already.has(file)) {
      summary.skipped.push(file);
      console.log(`   skipped   ${file}`);
      continue;
    }
    process.stdout.write(`   applying  ${file} … `);
    try {
      await applyFile(file);
      summary.applied.push(file);
      console.log('done');
    } catch (err) {
      summary.failed = { file, message: err.message };
      console.log('FAILED');
      throw err;
    }
  }
}

main()
  .then(async () => {
    console.log(`\nApplied: ${summary.applied.length}   Skipped: ${summary.skipped.length}`);
    if (summary.applied.length) {
      console.log('\nNext step:  npm run seed        (creates the first superadmin account)');
      console.log('            npm run seed -- --demo  (adds a sample clinic + hospital)');
    }
    await db.close();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(`\n✖ Migration failed${summary.failed ? ` in ${summary.failed.file}` : ''}: ${err.message}\n`);
    if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
      console.error('  Is PostgreSQL running? Check DB_HOST / DB_PORT in backend/.env');
      console.error(`  Currently trying ${config.db.host}:${config.db.port}\n`);
    }
    if (err.code === '28P01' || err.code === '3D000') {
      console.error('  Wrong DB_PASSWORD, or the database does not exist yet.');
      console.error(`  Create it with:  CREATE DATABASE ${config.db.database};\n`);
    }
    await db.close().catch(() => {});
    process.exit(1);
  });