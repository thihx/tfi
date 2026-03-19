const { Pool } = require('pg');
const pool = new Pool({
  connectionString: 'postgresql://fkr:Panda%40241205@fkr-database.postgres.database.azure.com:5432/tfi?sslmode=require'
});

async function main() {
  // Audit log columns
  const r1 = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'audit_logs' ORDER BY ordinal_position");
  console.log('Audit columns:', r1.rows.map(x => x.column_name).join(', '));

  // Find audit logs for match 1391582
  const r2 = await pool.query("SELECT * FROM audit_logs WHERE match_id = '1391582' ORDER BY id DESC LIMIT 10");
  console.log('\n=== AUDIT LOGS FOR MATCH 1391582 ===');
  console.log(`Found: ${r2.rows.length}`);
  for (const row of r2.rows) {
    console.log(JSON.stringify(row));
  }

  // Recent RECOMMENDATION_SAVED audit logs
  const r3 = await pool.query("SELECT * FROM audit_logs WHERE action = 'RECOMMENDATION_SAVED' ORDER BY id DESC LIMIT 5");
  console.log('\n=== RECENT RECOMMENDATION_SAVED ===');
  for (const row of r3.rows) {
    console.log(`id=${row.id} match=${row.match_id} ts=${row.timestamp || row.logged_at} meta=${JSON.stringify(row.metadata)}`);
  }

  // Any PIPELINE errors recently
  const r4 = await pool.query("SELECT * FROM audit_logs WHERE category = 'PIPELINE' ORDER BY id DESC LIMIT 10");
  console.log('\n=== RECENT PIPELINE AUDIT ===');
  for (const row of r4.rows) {
    console.log(`id=${row.id} action=${row.action} outcome=${row.outcome} match=${row.match_id} ts=${row.timestamp || row.logged_at}`);
    if (row.metadata) console.log(`  meta=${JSON.stringify(row.metadata)}`);
  }

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
