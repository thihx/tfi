const { Pool } = require('pg');
const pool = new Pool({
  connectionString: 'postgresql://fkr:Panda%40241205@fkr-database.postgres.database.azure.com:5432/tfi?sslmode=require'
});

async function main() {
  // 1. Check prompt_version column default
  const r1 = await pool.query(`
    SELECT column_name, column_default, is_nullable 
    FROM information_schema.columns 
    WHERE table_name = 'recommendations' AND column_name IN ('prompt_version', 'stake_amount', '_was_overridden')
  `);
  console.log('=== COLUMN DEFAULTS ===');
  for (const col of r1.rows) {
    console.log(`${col.column_name}: default=${col.column_default}, nullable=${col.is_nullable}`);
  }

  // 2. Check the most recent recommendation to see its prompt_version
  const r2 = await pool.query(`
    SELECT id, match_id, prompt_version, selection, bet_market 
    FROM recommendations ORDER BY id DESC LIMIT 3
  `);
  console.log('\n=== RECENT RECS prompt_version ===');
  for (const row of r2.rows) {
    console.log(`id=${row.id} match=${row.match_id} prompt_version="${row.prompt_version}" sel=${row.selection}`);
  }

  // 3. Try to insert a TEST record (without prompt_version) and see if it fails
  console.log('\n=== TEST INSERT (no prompt_version) ===');
  try {
    const r3 = await pool.query(`
      INSERT INTO recommendations (
        unique_key, match_id, timestamp, league, home_team, away_team, status,
        condition_triggered_suggestion, custom_condition_raw, execution_id,
        odds_snapshot, stats_snapshot, pre_match_prediction_summary, custom_condition_matched,
        minute, score, bet_type, selection, odds, confidence, value_percent, risk_level,
        stake_percent, stake_amount, reasoning, key_factors, warnings,
        ai_model, mode, bet_market, notified, notification_channels,
        result, actual_outcome, pnl, settled_at, _was_overridden
      ) VALUES (
        'TEST_DELETE_ME', 'TEST_MATCH', NOW(), 'Test League', 'Home', 'Away', '2H',
        '', '', 'test-exec',
        '{}', '{}', '', false,
        81, '0-4', 'under_4.5', 'Under 4.5 Goals', 1.65, 6, 14.4, 'LOW',
        3, null, 'test reasoning', '', '',
        'gemini-3-pro-preview', 'B', 'under_4.5', 'pending', 'telegram',
        '', '', 0, null, false
      ) RETURNING id, prompt_version
    `);
    console.log(`SUCCESS: id=${r3.rows[0].id}, prompt_version="${r3.rows[0].prompt_version}"`);
    
    // Clean up test record
    await pool.query("DELETE FROM recommendations WHERE unique_key = 'TEST_DELETE_ME'");
    console.log('Test record cleaned up.');
  } catch (e) {
    console.error(`FAILED: ${e.message}`);
  }

  // 4. Check audit logs for recent recommendation saves
  console.log('\n=== RECENT AUDIT LOGS (RECOMMENDATION_SAVED) ===');
  try {
    const r4 = await pool.query(`
      SELECT id, created_at, action, match_id, metadata 
      FROM audit_logs 
      WHERE action = 'RECOMMENDATION_SAVED' 
      ORDER BY id DESC LIMIT 5
    `);
    for (const row of r4.rows) {
      console.log(`id=${row.id} at=${row.created_at} match=${row.match_id} meta=${JSON.stringify(row.metadata)}`);
    }
  } catch (e) {
    console.log(`Audit table error: ${e.message}`);
  }

  // 5. Check server logs for errors on match 1391582
  console.log('\n=== AUDIT LOGS FOR MATCH 1391582 ===');
  try {
    const r5 = await pool.query(`
      SELECT id, created_at, category, action, outcome, match_id, metadata 
      FROM audit_logs 
      WHERE match_id = '1391582'
      ORDER BY id DESC LIMIT 10
    `);
    console.log(`Found: ${r5.rows.length} audit entries`);
    for (const row of r5.rows) {
      console.log(`id=${row.id} at=${row.created_at} ${row.category}:${row.action} outcome=${row.outcome} meta=${JSON.stringify(row.metadata)}`);
    }
  } catch (e) {
    console.log(`Audit table error: ${e.message}`);
  }

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
