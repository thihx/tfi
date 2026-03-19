const { Pool } = require('pg');
const pool = new Pool({
  connectionString: 'postgresql://fkr:Panda%40241205@fkr-database.postgres.database.azure.com:5432/tfi?sslmode=require'
});

async function main() {
  // 1. ALL audit logs mentioning 1391582 in metadata
  const r1 = await pool.query(`
    SELECT id, timestamp, action, outcome, metadata, error 
    FROM audit_logs 
    WHERE metadata::text LIKE '%1391582%'
    ORDER BY id DESC LIMIT 20
  `);
  console.log('=== ALL AUDIT LOGS WITH 1391582 IN METADATA ===');
  console.log(`Found: ${r1.rows.length}`);
  for (const row of r1.rows) {
    console.log(`id=${row.id} ts=${row.timestamp} action=${row.action} outcome=${row.outcome}`);
    console.log(`  meta=${JSON.stringify(row.metadata)}`);
    if (row.error) console.log(`  ERROR: ${row.error}`);
  }

  // 2. All audit logs around 21:00-21:15 (when Telegram was sent at 9:09 PM)
  const r2 = await pool.query(`
    SELECT id, timestamp, action, outcome, match_id, metadata, error 
    FROM audit_logs 
    WHERE timestamp >= '2026-03-19 21:00:00+09' AND timestamp <= '2026-03-19 21:15:00+09'
    ORDER BY id
  `);
  console.log('\n=== AUDIT LOGS 21:00-21:15 (around Telegram send time) ===');
  console.log(`Found: ${r2.rows.length}`);
  for (const row of r2.rows) {
    console.log(`id=${row.id} ts=${row.timestamp} action=${row.action} outcome=${row.outcome} match=${row.match_id}`);
    if (row.metadata) console.log(`  meta=${JSON.stringify(row.metadata)}`);
    if (row.error) console.log(`  ERROR: ${row.error}`);
  }

  // 3. Check if Ask AI pipeline even logs to audit - look for any ask-ai mentions
  const r3 = await pool.query(`
    SELECT id, timestamp, action, outcome, metadata 
    FROM audit_logs 
    WHERE metadata::text LIKE '%ask-ai%' OR metadata::text LIKE '%ask_ai%'
    ORDER BY id DESC LIMIT 10
  `);
  console.log('\n=== ASK-AI AUDIT LOGS ===');
  console.log(`Found: ${r3.rows.length}`);
  for (const row of r3.rows) {
    console.log(`id=${row.id} ts=${row.timestamp} action=${row.action} meta=${JSON.stringify(row.metadata)}`);
  }

  // 4. Check how notifications are logged
  const r4 = await pool.query(`
    SELECT id, timestamp, action, outcome, match_id, metadata 
    FROM audit_logs 
    WHERE action LIKE '%NOTIF%' OR action LIKE '%TELEGRAM%' OR action LIKE '%PUSH%'
    ORDER BY id DESC LIMIT 10
  `);
  console.log('\n=== NOTIFICATION AUDIT LOGS ===');
  console.log(`Found: ${r4.rows.length}`);
  for (const row of r4.rows) {
    console.log(`id=${row.id} ts=${row.timestamp} action=${row.action} match=${row.match_id}`);
  }

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
