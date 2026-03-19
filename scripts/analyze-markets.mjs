import pg from 'pg';
import fs from 'fs';

const pool = new pg.Pool({
  connectionString: 'postgresql://fkr:Panda@241205@fkr-database.postgres.database.azure.com:5432/tfi?sslmode=require',
  ssl: { rejectUnauthorized: false },
});

const lines = [];
function log(msg = '') { lines.push(msg); }
function logTable(rows) { lines.push(JSON.stringify(rows, null, 2)); }

async function run() {
  // 1. Overall market performance
  console.log('\n=== MARKET PERFORMANCE BREAKDOWN ===');
  const marketRes = await pool.query(`
    SELECT 
      bet_market,
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE result = 'win') as wins,
      COUNT(*) FILTER (WHERE result = 'loss') as losses,
      COUNT(*) FILTER (WHERE result = 'push') as pushes,
      COUNT(*) FILTER (WHERE result NOT IN ('win','loss','push','duplicate') OR result = '' OR result IS NULL) as pending,
      ROUND(100.0 * COUNT(*) FILTER (WHERE result = 'win') / NULLIF(COUNT(*) FILTER (WHERE result IN ('win','loss')), 0), 1) as win_rate,
      ROUND(COALESCE(SUM(pnl) FILTER (WHERE result IN ('win','loss','push')), 0)::numeric, 2) as total_pnl
    FROM recommendations 
    WHERE result IS DISTINCT FROM 'duplicate'
    GROUP BY bet_market
    ORDER BY total DESC
  `);
  console.table(marketRes.rows);

  // 2. BTTS detail - by selection
  console.log('\n=== BTTS DETAIL BY SELECTION ===');
  const bttsRes = await pool.query(`
    SELECT 
      selection,
      bet_market,
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE result = 'win') as wins,
      COUNT(*) FILTER (WHERE result = 'loss') as losses,
      ROUND(100.0 * COUNT(*) FILTER (WHERE result = 'win') / NULLIF(COUNT(*) FILTER (WHERE result IN ('win','loss')), 0), 1) as win_rate,
      ROUND(COALESCE(SUM(pnl) FILTER (WHERE result IN ('win','loss')), 0)::numeric, 2) as total_pnl
    FROM recommendations 
    WHERE result IS DISTINCT FROM 'duplicate'
      AND (bet_market ILIKE '%btts%' OR selection ILIKE '%both%team%' OR selection ILIKE '%btts%')
    GROUP BY selection, bet_market
    ORDER BY total DESC
  `);
  console.table(bttsRes.rows);

  // 3. BTTS losses - recent detail
  console.log('\n=== RECENT BTTS LOSSES (last 20) ===');
  const bttsLosses = await pool.query(`
    SELECT 
      id, match_id, home_team, away_team, league, minute, score, selection, odds, confidence, 
      result, actual_outcome, pnl, reasoning,
      timestamp::date as date
    FROM recommendations 
    WHERE result IS DISTINCT FROM 'duplicate'
      AND (bet_market ILIKE '%btts%' OR selection ILIKE '%both%team%' OR selection ILIKE '%btts%')
      AND result = 'loss'
    ORDER BY timestamp DESC
    LIMIT 20
  `);
  for (const row of bttsLosses.rows) {
    console.log(`\n[${row.date}] ${row.home_team} vs ${row.away_team} (${row.league})`);
    console.log(`  Min: ${row.minute} | Score: ${row.score} | Selection: ${row.selection} | Odds: ${row.odds} | Conf: ${row.confidence}`);
    console.log(`  Result: ${row.result} | Actual: ${row.actual_outcome} | PnL: ${row.pnl}`);
    console.log(`  Reasoning: ${(row.reasoning || '').substring(0, 200)}`);
  }

  // 4. Overall performance by confidence level
  console.log('\n=== PERFORMANCE BY CONFIDENCE LEVEL ===');
  const confRes = await pool.query(`
    SELECT 
      confidence,
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE result = 'win') as wins,
      COUNT(*) FILTER (WHERE result = 'loss') as losses,
      ROUND(100.0 * COUNT(*) FILTER (WHERE result = 'win') / NULLIF(COUNT(*) FILTER (WHERE result IN ('win','loss')), 0), 1) as win_rate
    FROM recommendations 
    WHERE result IS DISTINCT FROM 'duplicate' AND result IN ('win','loss')
    GROUP BY confidence
    ORDER BY confidence DESC
  `);
  console.table(confRes.rows);

  // 5. Performance by minute range
  console.log('\n=== PERFORMANCE BY MINUTE RANGE ===');
  const minRes = await pool.query(`
    SELECT 
      CASE 
        WHEN minute < 30 THEN '0-29'
        WHEN minute BETWEEN 30 AND 45 THEN '30-45'
        WHEN minute BETWEEN 46 AND 60 THEN '46-60'
        WHEN minute BETWEEN 61 AND 75 THEN '61-75'
        WHEN minute > 75 THEN '76+'
        ELSE 'unknown'
      END as minute_range,
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE result = 'win') as wins,
      COUNT(*) FILTER (WHERE result = 'loss') as losses,
      ROUND(100.0 * COUNT(*) FILTER (WHERE result = 'win') / NULLIF(COUNT(*) FILTER (WHERE result IN ('win','loss')), 0), 1) as win_rate
    FROM recommendations 
    WHERE result IS DISTINCT FROM 'duplicate' AND result IN ('win','loss')
    GROUP BY minute_range
    ORDER BY minute_range
  `);
  console.table(minRes.rows);

  // 6. Recent all rec results (last 30 settled)
  console.log('\n=== LAST 30 SETTLED RECOMMENDATIONS ===');
  const recentRes = await pool.query(`
    SELECT 
      id, home_team, away_team, minute, score, selection, bet_market, odds, confidence, 
      result, actual_outcome, pnl,
      timestamp::date as date
    FROM recommendations 
    WHERE result IS DISTINCT FROM 'duplicate' AND result IN ('win','loss','push')
    ORDER BY timestamp DESC
    LIMIT 30
  `);
  console.table(recentRes.rows.map(r => ({
    date: r.date,
    match: `${r.home_team} vs ${r.away_team}`,
    min: r.minute,
    score: r.score,
    selection: (r.selection || '').substring(0, 40),
    market: r.bet_market,
    odds: r.odds,
    conf: r.confidence,
    result: r.result,
    pnl: r.pnl
  })));

  // 7. Corners analysis
  console.log('\n=== CORNERS MARKET DETAIL ===');
  const cornersRes = await pool.query(`
    SELECT 
      selection, bet_market, minute, score, home_team, away_team, 
      result, actual_outcome, confidence, odds, pnl, timestamp::date as date
    FROM recommendations 
    WHERE result IS DISTINCT FROM 'duplicate'
      AND (bet_market ILIKE '%corner%' OR selection ILIKE '%corner%')
    ORDER BY timestamp DESC
    LIMIT 20
  `);
  console.table(cornersRes.rows.map(r => ({
    date: r.date,
    match: `${r.home_team} vs ${r.away_team}`,
    min: r.minute,
    score: r.score,
    selection: (r.selection || '').substring(0, 50),
    result: r.result,
    pnl: r.pnl
  })));

  await pool.end();
  fs.writeFileSync('C:/tfi/market-analysis.txt', lines.join('\n'), 'utf8');
  process.stdout.write('ANALYSIS_WRITTEN_OK\n');
}

run().catch(e => { console.error(e); process.exit(1); });
