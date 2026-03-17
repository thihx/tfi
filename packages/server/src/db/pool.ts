// ============================================================
// PostgreSQL connection pool
// ============================================================

import pg from 'pg';
import { config } from '../config.js';

// Return DATE columns as plain "YYYY-MM-DD" strings instead of JS Date objects
pg.types.setTypeParser(1082, (val: string) => val);

const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  ssl: config.databaseUrl.includes('sslmode=require') ? { rejectUnauthorized: false } : false,
});

// Ensure every connection uses Asia/Seoul timezone so that
// NOW(), timestamp::date casts, and (date + kickoff) < NOW() comparisons
// all operate in the same timezone as our Football API data.
pool.on('connect', (client) => {
  client.query("SET timezone = 'Asia/Seoul'");
});

pool.on('error', (err) => {
  console.error('Unexpected PG pool error:', err);
});

export { pool };

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params);
}

export async function getClient(): Promise<pg.PoolClient> {
  return pool.connect();
}

export async function transaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
