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
  // onConnect is awaited by pg.Pool before handing client to queries,
  // unlike pool.on('connect') which fires-and-forgets the callback.
  onConnect: async (client) => {
    await client.query(`SET timezone = '${config.timezone}'`);
  },
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
