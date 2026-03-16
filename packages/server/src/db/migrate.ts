// ============================================================
// Migration runner — reads SQL files from migrations/ folder
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, query, closePool } from './pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function ensureMigrationsTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id       SERIAL PRIMARY KEY,
      name     TEXT NOT NULL UNIQUE,
      applied  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getAppliedMigrations(): Promise<Set<string>> {
  const result = await query<{ name: string }>('SELECT name FROM _migrations ORDER BY id');
  return new Set(result.rows.map((r) => r.name));
}

async function runMigrations(): Promise<void> {
  console.log('🔄 Running migrations...');

  await ensureMigrationsTable();
  const applied = await getAppliedMigrations();

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`  ✓ ${file} (already applied)`);
      continue;
    }

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
    const client = await pool.connect();
    try {
      await client.query(sql);
      await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
      console.log(`  ✅ ${file} applied`);
      count++;
    } catch (err) {
      console.error(`  ❌ ${file} failed:`, err);
      throw err;
    } finally {
      client.release();
    }
  }

  console.log(count > 0 ? `\n🎉 Applied ${count} migration(s)` : '\n✅ All migrations up to date');
  await closePool();
}

runMigrations().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
