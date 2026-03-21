// ============================================================
// PostgreSQL connection pool
// ============================================================

import pg from 'pg';
import { config } from '../config.js';

// Return DATE columns as plain "YYYY-MM-DD" strings instead of JS Date objects
pg.types.setTypeParser(1082, (val: string) => val);

// pg ≥ 8.13 supports `onConnect` in pool options (awaited before handing
// the client to queries), but @types/pg hasn't added it yet.
interface PoolConfigWithOnConnect extends pg.PoolConfig {
  onConnect?: (client: pg.PoolClient) => Promise<void>;
}

const databaseUrl = String(config.databaseUrl ?? '');

const pool = new pg.Pool({
  connectionString: databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  ssl: databaseUrl.includes('sslmode=require') ? { rejectUnauthorized: false } : false,
  onConnect: async (client) => {
    await client.query(`SET timezone = '${config.timezone}'`);
  },
} as PoolConfigWithOnConnect);

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
