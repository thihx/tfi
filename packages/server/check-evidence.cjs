const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://fkr:Panda%40241205@fkr-database.postgres.database.azure.com:5432/tfi?sslmode=require' });

(async () => {
  // 1. Check ALL audit logs around 21:05-21:12 KST (12:05-12:12 UTC)
  const r = await pool.query(
    "SELECT id, action, outcome, error, timestamp, match_id, metadata->>'selection' as selection FROM audit_logs WHERE timestamp >= '2026-03-19 12:05:00+00' AND timestamp <= '2026-03-19 12:12:00+00' ORDER BY timestamp ASC"
  );
  console.log('=== AUDIT LOGS 21:05-21:12 KST ===');
  console.log('Total:', r.rows.length);
  for (const row of r.rows) {
    const ts = new Date(row.timestamp).toLocaleTimeString('en-US', {timeZone:'Asia/Seoul', hour12: false});
    console.log(row.id, ts, row.action, 'out=' + (row.outcome||'-'), 'match=' + (row.match_id||'-'), 'sel=' + (row.selection||'-'), row.error ? 'ERR:'+row.error.substring(0,100) : '');
  }

  // 2. All errors in audit_logs from today
  const errs = await pool.query(
    "SELECT id, action, outcome, error, timestamp, match_id FROM audit_logs WHERE timestamp >= '2026-03-19 00:00:00+00' AND error IS NOT NULL AND error != '' ORDER BY timestamp ASC LIMIT 20"
  );
  console.log('\n=== ALL ERROR AUDIT ENTRIES ON 2026-03-19 ===');
  console.log('Total:', errs.rows.length);
  for (const row of errs.rows) {
    const ts = new Date(row.timestamp).toLocaleTimeString('en-US', {timeZone:'Asia/Seoul', hour12: false});
    console.log(row.id, ts, row.action, 'match=' + (row.match_id||'-'), 'ERR:', (row.error||'').substring(0, 200));
  }

  // 3. Recent RECOMMENDATION_SAVED entries
  const saved = await pool.query(
    "SELECT id, action, outcome, timestamp, match_id FROM audit_logs WHERE action = 'RECOMMENDATION_SAVED' ORDER BY timestamp DESC LIMIT 5"
  );
  console.log('\n=== MOST RECENT RECOMMENDATION_SAVED ===');
  console.log('Total:', saved.rows.length);
  for (const row of saved.rows) {
    const ts = new Date(row.timestamp).toLocaleTimeString('en-US', {timeZone:'Asia/Seoul', hour12: false});
    console.log(row.id, ts, 'match=' + (row.match_id||'-'));
  }

  // 4. Frontend pipeline recommendations (tfi_*)
  const recs = await pool.query(
    "SELECT id, match_id, execution_id, selection, timestamp, bet_market FROM recommendations WHERE execution_id LIKE 'tfi_%' ORDER BY timestamp DESC LIMIT 10"
  );
  console.log('\n=== RECOMMENDATIONS FROM FRONTEND (tfi_*) ===');
  console.log('Total:', recs.rows.length);
  for (const row of recs.rows) {
    const ts = new Date(row.timestamp).toLocaleTimeString('en-US', {timeZone:'Asia/Seoul', hour12: false});
    console.log(row.id, ts, 'match=' + row.match_id, 'sel="' + row.selection + '"', 'mkt=' + row.bet_market, 'exec=' + row.execution_id);
  }

  // 5. Server pipeline recommendations (auto-*)
  const autoRecs = await pool.query(
    "SELECT id, match_id, execution_id, selection, timestamp, bet_market FROM recommendations WHERE execution_id LIKE 'auto-%' ORDER BY timestamp DESC LIMIT 10"
  );
  console.log('\n=== RECOMMENDATIONS FROM SERVER (auto-*) ===');
  console.log('Total:', autoRecs.rows.length);
  for (const row of autoRecs.rows) {
    const ts = new Date(row.timestamp).toLocaleTimeString('en-US', {timeZone:'Asia/Seoul', hour12: false});
    console.log(row.id, ts, 'match=' + row.match_id, 'sel="' + row.selection + '"', 'mkt=' + row.bet_market, 'exec=' + row.execution_id);
  }

  // 6. Total recommendations count
  const total = await pool.query("SELECT COUNT(*) as cnt FROM recommendations");
  console.log('\n=== TOTAL RECOMMENDATIONS:', total.rows[0].cnt, '===');

  // 7. AI_CALL entries for match 1391582
  const aiCalls = await pool.query(
    "SELECT id, action, outcome, timestamp, match_id, error, metadata->>'model' as model FROM audit_logs WHERE match_id = '1391582' ORDER BY timestamp ASC"
  );
  console.log('\n=== ALL AUDIT FOR MATCH 1391582 ===');
  console.log('Total:', aiCalls.rows.length);
  for (const row of aiCalls.rows) {
    const ts = new Date(row.timestamp).toLocaleTimeString('en-US', {timeZone:'Asia/Seoul', hour12: false});
    console.log(row.id, ts, row.action, 'out=' + (row.outcome||'-'), 'model=' + (row.model||'-'), row.error ? 'ERR:'+row.error.substring(0,100) : '');
  }

  await pool.end();
})();
