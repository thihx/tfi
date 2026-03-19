const { Pool } = require('pg');
const pool = new Pool({
  connectionString: 'postgresql://fkr:Panda%40241205@fkr-database.postgres.database.azure.com:5432/tfi?sslmode=require'
});

async function main() {
  // Check schema first
  const r3 = await pool.query(
    "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'recommendations' ORDER BY ordinal_position"
  );
  console.log('=== RECOMMENDATIONS TABLE SCHEMA ===');
  for (const col of r3.rows) {
    console.log(`${col.column_name} (${col.data_type}) nullable=${col.is_nullable}`);
  }

  // Check recent recommendations
  const r1 = await pool.query(
    'SELECT id, match_id, selection, bet_market, confidence, odds, result, minute, timestamp FROM recommendations ORDER BY id DESC LIMIT 10'
  );
  console.log('\n=== LATEST 10 RECOMMENDATIONS ===');
  for (const row of r1.rows) {
    console.log(`id=${row.id} match=${row.match_id} sel=${row.selection} market=${row.bet_market} conf=${row.confidence} odds=${row.odds} min=${row.minute} result=${row.result} at=${row.timestamp}`);
  }

  // Check specifically match 1391582
  const r2 = await pool.query(
    'SELECT id, match_id, selection, bet_market, confidence, odds, result, minute, timestamp FROM recommendations WHERE match_id = $1 ORDER BY id DESC',
    ['1391582']
  );
  console.log('\n=== MATCH 1391582 (Oleksandria vs Dynamo Kyiv) ===');
  console.log(`Found: ${r2.rows.length} rows`);
  for (const row of r2.rows) {
    console.log(`id=${row.id} sel=${row.selection} market=${row.bet_market} conf=${row.confidence} odds=${row.odds} min=${row.minute} result=${row.result} at=${row.timestamp}`);
  }

  // Check if there are constraints/unique indexes
  const r4 = await pool.query(`
    SELECT con.conname, con.contype, pg_get_constraintdef(con.oid)
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'recommendations'
  `);
  console.log('\n=== RECOMMENDATIONS CONSTRAINTS ===');
  for (const row of r4.rows) {
    console.log(`${row.conname} type=${row.contype} def=${row.pg_get_constraintdef}`);
  }

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
