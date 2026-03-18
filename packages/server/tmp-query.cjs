const { Pool } = require('pg');
const pool = new Pool({
  host: 'fkr-database.postgres.database.azure.com',
  user: 'fkr',
  password: 'Panda@241205',
  database: 'tfi',
  ssl: { rejectUnauthorized: false },
});

(async () => {
  // 1. Fix dates: sync watchlist dates from matches table for mismatched entries
  console.log('\n=== Syncing watchlist dates from matches table ===');
  const r1 = await pool.query(`
    UPDATE watchlist w
    SET date = m.date, kickoff = m.kickoff
    FROM matches m
    WHERE w.match_id = m.match_id::text
      AND (w.date != m.date OR w.kickoff != m.kickoff)
    RETURNING w.match_id, w.home_team, w.date::text AS new_date, m.date::text AS m_date
  `);
  console.log('Synced:', r1.rowCount);
  console.table(r1.rows);

  // 2. Re-activate expired entries whose match is still NS
  console.log('\n=== Re-activating wrongly expired NS entries ===');
  const r2 = await pool.query(`
    UPDATE watchlist w
    SET status = 'active'
    FROM matches m
    WHERE w.match_id = m.match_id::text
      AND w.status = 'expired'
      AND m.status = 'NS'
    RETURNING w.match_id, w.home_team, w.date::text, w.status
  `);
  console.log('Re-activated:', r2.rowCount);
  console.table(r2.rows);

  // 3. Verify: show all active entries
  console.log('\n=== All active watchlist entries now ===');
  const r3 = await pool.query(`
    SELECT w.match_id, w.date::text AS w_date, w.kickoff::text AS w_kick,
           w.home_team, w.away_team, w.status, m.status AS m_status
    FROM watchlist w
    LEFT JOIN matches m ON w.match_id = m.match_id::text
    WHERE w.status = 'active'
    ORDER BY w.date, w.kickoff
  `);
  console.table(r3.rows);

  await pool.end();
})();
