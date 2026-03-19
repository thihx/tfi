const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://fkr:Panda%40241205@fkr-database.postgres.database.azure.com:5432/tfi?sslmode=require' });

(async () => {
  // Check ALL audit logs around 21:05-21:12 when AI_CALL and TELEGRAM_SEND succeeded
  const r = await pool.query(`
    SELECT id, action, outcome, error, created_at, 
           metadata->>'matchId' as match_id,
           metadata->>'selection' as selection
    FROM audit_logs 
    WHERE created_at >= '2026-03-19 12:05:00' 
      AND created_at <= '2026-03-19 12:12:00'
    ORDER BY created_at ASC
  `);
  console.log('=== AUDIT LOGS 21:05-21:12 KST (12:05-12:12 UTC) ===');
  console.log('Total:', r.rows.length);
  for (const row of r.rows) {
    const ts = new Date(row.created_at).toLocaleTimeString('en-US', {timeZone:'Asia/Seoul', hour12: false});
    console.log(`${row.id} ${ts} ${row.action} outcome=${row.outcome || '-'} match=${row.match_id || '-'} sel=${row.selection || '-'} ${row.error ? 'ERR:' + row.error.substring(0, 100) : ''}`);
  }

  // Also check if there are ANY errors in audit_logs for that day
  const errs = await pool.query(`
    SELECT id, action, outcome, error, created_at,
           metadata->>'matchId' as match_id
    FROM audit_logs 
    WHERE created_at >= '2026-03-19 00:00:00' 
      AND error IS NOT NULL AND error != ''
    ORDER BY created_at ASC
    LIMIT 20
  `);
  console.log('\n=== ALL ERROR AUDIT ENTRIES ON 2026-03-19 ===');
  console.log('Total:', errs.rows.length);
  for (const row of errs.rows) {
    const ts = new Date(row.created_at).toLocaleTimeString('en-US', {timeZone:'Asia/Seoul', hour12: false});
    console.log(`${row.id} ${ts} ${row.action} match=${row.match_id || '-'} ERR: ${(row.error || '').substring(0, 150)}`);
  }

  // Check: did any RECOMMENDATION_SAVED or ask-ai audit ever exist?
  const saved = await pool.query(`
    SELECT id, action, outcome, created_at, metadata->>'matchId' as match_id
    FROM audit_logs 
    WHERE action = 'RECOMMENDATION_SAVED'
    ORDER BY created_at DESC
    LIMIT 5
  `);
  console.log('\n=== MOST RECENT RECOMMENDATION_SAVED ENTRIES ===');
  console.log('Total:', saved.rows.length);
  for (const row of saved.rows) {
    const ts = new Date(row.created_at).toLocaleTimeString('en-US', {timeZone:'Asia/Seoul', hour12: false});
    console.log(`${row.id} ${ts} match=${row.match_id || '-'}`);
  }

  // Check all recommendations to see if any exist from ask-ai
  const recs = await pool.query(`
    SELECT id, match_id, execution_id, selection, created_at, bet_market
    FROM recommendations 
    WHERE execution_id LIKE 'tfi_%'
    ORDER BY created_at DESC
    LIMIT 10
  `);
  console.log('\n=== RECENT RECOMMENDATIONS FROM FRONTEND PIPELINE (tfi_*) ===');
  console.log('Total:', recs.rows.length);
  for (const row of recs.rows) {
    const ts = new Date(row.created_at).toLocaleTimeString('en-US', {timeZone:'Asia/Seoul', hour12: false});
    console.log(`${row.id} ${ts} match=${row.match_id} sel="${row.selection}" mkt=${row.bet_market} exec=${row.execution_id}`);
  }

  // Check all recommendations from auto-pipeline
  const autoRecs = await pool.query(`
    SELECT id, match_id, execution_id, selection, created_at, bet_market
    FROM recommendations 
    WHERE execution_id LIKE 'auto-%'
    ORDER BY created_at DESC
    LIMIT 10
  `);
  console.log('\n=== RECENT RECOMMENDATIONS FROM SERVER PIPELINE (auto-*) ===');
  console.log('Total:', autoRecs.rows.length);
  for (const row of autoRecs.rows) {
    const ts = new Date(row.created_at).toLocaleTimeString('en-US', {timeZone:'Asia/Seoul', hour12: false});
    console.log(`${row.id} ${ts} match=${row.match_id} sel="${row.selection}" mkt=${row.bet_market} exec=${row.execution_id}`);
  }

  await pool.end();
})();
