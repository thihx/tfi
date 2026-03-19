const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://fkr:Panda%40241205@fkr-database.postgres.database.azure.com:5432/tfi?sslmode=require' });

(async () => {
  // Test 1: Empty string for timestamp column — SHOULD FAIL
  console.log('=== TEST 1: settled_at = empty string ===');
  try {
    await pool.query("SELECT ''::timestamptz");
    console.log('PASSED (unexpected)');
  } catch (err) {
    console.log('FAILED:', err.message);
    console.log('>>> This is the EXACT error that kills frontend save!');
  }

  // Test 2: NULL for timestamp column — SHOULD PASS
  console.log('\n=== TEST 2: settled_at = NULL ===');
  try {
    await pool.query('SELECT NULL::timestamptz');
    console.log('PASSED — null is valid for timestamp');
  } catch (err) {
    console.log('FAILED:', err.message);
  }

  // Test 3: Verify the exact createRecommendation SQL with settled_at=''
  console.log('\n=== TEST 3: Full INSERT with settled_at = empty string ===');
  try {
    const result = await pool.query(
      `INSERT INTO recommendations (
        unique_key, match_id, timestamp, league, home_team, away_team, status,
        condition_triggered_suggestion, custom_condition_raw, execution_id,
        odds_snapshot, stats_snapshot, pre_match_prediction_summary, custom_condition_matched,
        minute, score, bet_type, selection, odds, confidence, value_percent, risk_level,
        stake_percent, stake_amount, reasoning, key_factors, warnings,
        ai_model, mode, bet_market, notified, notification_channels,
        result, actual_outcome, pnl, settled_at, _was_overridden
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
        $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37
      )
      ON CONFLICT (unique_key) DO UPDATE SET minute = EXCLUDED.minute
      RETURNING id`,
      [
        'test_bug_verify_' + Date.now(), '999999', new Date().toISOString(), 'Test', 'Home', 'Away', 'LIVE',
        '', '', 'tfi_test_bug', '{}', '{}', '', false,
        45, '1-0', 'AI', 'Over 2.5', 1.85, 75, 10, 'MEDIUM',
        2, null, 'test reasoning', '', '',
        'test-model', 'B', 'over_2.5', '', '',
        '', '', 0, '', false  // <-- settled_at = '' here!
      ]
    );
    console.log('PASSED (unexpected) — id:', result.rows[0].id);
    // Clean up test record
    await pool.query('DELETE FROM recommendations WHERE match_id = $1', ['999999']);
  } catch (err) {
    console.log('FAILED:', err.message);
    console.log('>>> ROOT CAUSE CONFIRMED!');
  }

  // Test 4: Same INSERT with settled_at = null
  console.log('\n=== TEST 4: Full INSERT with settled_at = null ===');
  try {
    const result = await pool.query(
      `INSERT INTO recommendations (
        unique_key, match_id, timestamp, league, home_team, away_team, status,
        condition_triggered_suggestion, custom_condition_raw, execution_id,
        odds_snapshot, stats_snapshot, pre_match_prediction_summary, custom_condition_matched,
        minute, score, bet_type, selection, odds, confidence, value_percent, risk_level,
        stake_percent, stake_amount, reasoning, key_factors, warnings,
        ai_model, mode, bet_market, notified, notification_channels,
        result, actual_outcome, pnl, settled_at, _was_overridden
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
        $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37
      )
      ON CONFLICT (unique_key) DO UPDATE SET minute = EXCLUDED.minute
      RETURNING id`,
      [
        'test_bug_verify_' + Date.now(), '999999', new Date().toISOString(), 'Test', 'Home', 'Away', 'LIVE',
        '', '', 'tfi_test_null', '{}', '{}', '', false,
        45, '1-0', 'AI', 'Over 2.5', 1.85, 75, 10, 'MEDIUM',
        2, null, 'test reasoning', '', '',
        'test-model', 'B', 'over_2.5', '', '',
        '', '', 0, null, false  // <-- settled_at = null here!
      ]
    );
    console.log('PASSED — id:', result.rows[0].id);
    // Clean up
    await pool.query('DELETE FROM recommendations WHERE match_id = $1', ['999999']);
  } catch (err) {
    console.log('FAILED:', err.message);
  }

  await pool.end();
})();
