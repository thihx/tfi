import pg from 'pg';
import fs from 'fs';

const pool = new pg.Pool({
  connectionString: 'postgresql://fkr:Panda@241205@fkr-database.postgres.database.azure.com:5432/tfi?sslmode=require',
  ssl: { rejectUnauthorized: false },
});

const out = [];
function log(msg = '') { out.push(msg); }

async function run() {
  log('=== MARKET PERFORMANCE BREAKDOWN ===');
  const marketRes = await pool.query(`
    SELECT bet_market, COUNT(*) as total,
      COUNT(*) FILTER (WHERE result = 'win') as wins,
      COUNT(*) FILTER (WHERE result = 'loss') as losses,
      COUNT(*) FILTER (WHERE result = 'push') as pushes,
      COUNT(*) FILTER (WHERE result NOT IN ('win','loss','push','duplicate') OR result = '' OR result IS NULL) as pending,
      ROUND(100.0 * COUNT(*) FILTER (WHERE result = 'win') / NULLIF(COUNT(*) FILTER (WHERE result IN ('win','loss')), 0), 1) as win_rate,
      ROUND(COALESCE(SUM(pnl) FILTER (WHERE result IN ('win','loss','push')), 0)::numeric, 2) as total_pnl
    FROM recommendations WHERE result IS DISTINCT FROM 'duplicate'
    GROUP BY bet_market ORDER BY total DESC
  `);
  for (const r of marketRes.rows) {
    log(`  ${(r.bet_market||'(empty)').padEnd(20)} total=${String(r.total).padStart(4)} W=${String(r.wins).padStart(3)} L=${String(r.losses).padStart(3)} P=${String(r.pushes).padStart(2)} pend=${String(r.pending).padStart(3)} winRate=${r.win_rate ?? 'N/A'}% pnl=${r.total_pnl}`);
  }

  log('\n=== BTTS DETAIL BY SELECTION ===');
  const bttsRes = await pool.query(`
    SELECT selection, bet_market, COUNT(*) as total,
      COUNT(*) FILTER (WHERE result = 'win') as wins,
      COUNT(*) FILTER (WHERE result = 'loss') as losses,
      ROUND(100.0 * COUNT(*) FILTER (WHERE result = 'win') / NULLIF(COUNT(*) FILTER (WHERE result IN ('win','loss')), 0), 1) as win_rate,
      ROUND(COALESCE(SUM(pnl) FILTER (WHERE result IN ('win','loss')), 0)::numeric, 2) as total_pnl
    FROM recommendations WHERE result IS DISTINCT FROM 'duplicate'
      AND (bet_market ILIKE '%btts%' OR selection ILIKE '%both%team%' OR selection ILIKE '%btts%')
    GROUP BY selection, bet_market ORDER BY total DESC
  `);
  for (const r of bttsRes.rows) {
    log(`  [${r.bet_market}] "${r.selection}" total=${r.total} W=${r.wins} L=${r.losses} winRate=${r.win_rate}% pnl=${r.total_pnl}`);
  }

  log('\n=== RECENT BTTS LOSSES ===');
  const bttsLosses = await pool.query(`
    SELECT id, home_team, away_team, league, minute, score, selection, odds, confidence,
      result, actual_outcome, pnl, reasoning, timestamp::date as date
    FROM recommendations WHERE result IS DISTINCT FROM 'duplicate'
      AND (bet_market ILIKE '%btts%' OR selection ILIKE '%both%team%' OR selection ILIKE '%btts%')
      AND result = 'loss' ORDER BY timestamp DESC LIMIT 20
  `);
  for (const r of bttsLosses.rows) {
    log(`\n  [${r.date}] ${r.home_team} vs ${r.away_team} (${r.league})`);
    log(`    Min:${r.minute} Score:${r.score} Sel:"${r.selection}" Odds:${r.odds} Conf:${r.confidence}`);
    log(`    Result:${r.result} Actual:${r.actual_outcome} PnL:${r.pnl}`);
    log(`    Reasoning: ${(r.reasoning||'').substring(0,250)}`);
  }

  log('\n=== PERFORMANCE BY CONFIDENCE LEVEL ===');
  const confRes = await pool.query(`
    SELECT confidence, COUNT(*) as total,
      COUNT(*) FILTER (WHERE result = 'win') as wins,
      COUNT(*) FILTER (WHERE result = 'loss') as losses,
      ROUND(100.0 * COUNT(*) FILTER (WHERE result = 'win') / NULLIF(COUNT(*) FILTER (WHERE result IN ('win','loss')), 0), 1) as win_rate
    FROM recommendations WHERE result IS DISTINCT FROM 'duplicate' AND result IN ('win','loss')
    GROUP BY confidence ORDER BY confidence DESC
  `);
  for (const r of confRes.rows) {
    log(`  Conf=${String(r.confidence).padStart(2)} total=${String(r.total).padStart(4)} W=${String(r.wins).padStart(3)} L=${String(r.losses).padStart(3)} winRate=${r.win_rate}%`);
  }

  log('\n=== PERFORMANCE BY MINUTE RANGE ===');
  const minRes = await pool.query(`
    SELECT CASE
        WHEN minute < 30 THEN '0-29' WHEN minute BETWEEN 30 AND 45 THEN '30-45'
        WHEN minute BETWEEN 46 AND 60 THEN '46-60' WHEN minute BETWEEN 61 AND 75 THEN '61-75'
        WHEN minute > 75 THEN '76+' ELSE 'unknown' END as minute_range,
      COUNT(*) as total, COUNT(*) FILTER (WHERE result = 'win') as wins,
      COUNT(*) FILTER (WHERE result = 'loss') as losses,
      ROUND(100.0 * COUNT(*) FILTER (WHERE result = 'win') / NULLIF(COUNT(*) FILTER (WHERE result IN ('win','loss')), 0), 1) as win_rate
    FROM recommendations WHERE result IS DISTINCT FROM 'duplicate' AND result IN ('win','loss')
    GROUP BY minute_range ORDER BY minute_range
  `);
  for (const r of minRes.rows) {
    log(`  ${r.minute_range.padEnd(8)} total=${String(r.total).padStart(4)} W=${String(r.wins).padStart(3)} L=${String(r.losses).padStart(3)} winRate=${r.win_rate}%`);
  }

  log('\n=== LAST 30 SETTLED RECOMMENDATIONS ===');
  const recentRes = await pool.query(`
    SELECT id, home_team, away_team, minute, score, selection, bet_market, odds, confidence,
      result, actual_outcome, pnl, timestamp::date as date
    FROM recommendations WHERE result IS DISTINCT FROM 'duplicate' AND result IN ('win','loss','push')
    ORDER BY timestamp DESC LIMIT 30
  `);
  for (const r of recentRes.rows) {
    log(`  [${r.date}] ${(r.home_team+' vs '+r.away_team).padEnd(40)} min=${String(r.minute).padStart(2)} score=${r.score} sel="${(r.selection||'').substring(0,35)}" mkt=${r.bet_market} odds=${r.odds} conf=${r.confidence} => ${r.result} pnl=${r.pnl}`);
  }

  log('\n=== CORNERS MARKET DETAIL ===');
  const cornersRes = await pool.query(`
    SELECT selection, bet_market, minute, score, home_team, away_team,
      result, actual_outcome, confidence, odds, pnl, timestamp::date as date
    FROM recommendations WHERE result IS DISTINCT FROM 'duplicate'
      AND (bet_market ILIKE '%corner%' OR selection ILIKE '%corner%')
    ORDER BY timestamp DESC LIMIT 20
  `);
  for (const r of cornersRes.rows) {
    log(`  [${r.date}] ${(r.home_team+' vs '+r.away_team).padEnd(35)} min=${r.minute} score=${r.score} sel="${(r.selection||'').substring(0,50)}" => ${r.result||'pending'} pnl=${r.pnl}`);
  }

  log('\n=== BTTS NO (Both Teams NOT Score) DETAIL ===');
  const bttsNoRes = await pool.query(`
    SELECT selection, bet_market, minute, score, home_team, away_team,
      result, actual_outcome, confidence, odds, pnl, timestamp::date as date
    FROM recommendations WHERE result IS DISTINCT FROM 'duplicate'
      AND (selection ILIKE '%btts no%' OR selection ILIKE '%both teams to score: no%' 
           OR (bet_market = 'btts_no'))
    ORDER BY timestamp DESC LIMIT 30
  `);
  for (const r of bttsNoRes.rows) {
    log(`  [${r.date}] ${(r.home_team+' vs '+r.away_team).padEnd(35)} min=${r.minute} score=${r.score} sel="${(r.selection||'').substring(0,50)}" odds=${r.odds} conf=${r.confidence} => ${r.result||'pending'} pnl=${r.pnl}`);
  }

  log('\n=== BTTS YES (Both Teams Score) DETAIL ===');
  const bttsYesRes = await pool.query(`
    SELECT selection, bet_market, minute, score, home_team, away_team,
      result, actual_outcome, confidence, odds, pnl, timestamp::date as date
    FROM recommendations WHERE result IS DISTINCT FROM 'duplicate'
      AND (selection ILIKE '%btts yes%' OR selection ILIKE '%both teams to score: yes%'
           OR (bet_market = 'btts_yes'))
    ORDER BY timestamp DESC LIMIT 30
  `);
  for (const r of bttsYesRes.rows) {
    log(`  [${r.date}] ${(r.home_team+' vs '+r.away_team).padEnd(35)} min=${r.minute} score=${r.score} sel="${(r.selection||'').substring(0,50)}" odds=${r.odds} conf=${r.confidence} => ${r.result||'pending'} pnl=${r.pnl}`);
  }

  log('\n=== MARKET PERFORMANCE DETAIL (avg conf/odds/minute by W/L) ===');
  const mktDetail = await pool.query(`
    SELECT bet_market, result, 
      ROUND(AVG(confidence),1) as avg_conf,
      ROUND(AVG(odds::numeric),2) as avg_odds,
      ROUND(AVG(minute),0) as avg_minute,
      COUNT(*) as cnt
    FROM recommendations WHERE result IS DISTINCT FROM 'duplicate' AND result IN ('win','loss')
    GROUP BY bet_market, result ORDER BY bet_market, result
  `);
  for (const r of mktDetail.rows) {
    log(`  ${(r.bet_market||'(empty)').padEnd(20)} ${r.result.padEnd(5)} cnt=${String(r.cnt).padStart(3)} avgConf=${r.avg_conf} avgOdds=${r.avg_odds} avgMin=${r.avg_minute}`);
  }

  log('\n=== OVERALL SUMMARY ===');
  const summaryRes = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE result IN ('win','loss')) as settled,
      COUNT(*) FILTER (WHERE result = 'win') as wins,
      COUNT(*) FILTER (WHERE result = 'loss') as losses,
      ROUND(100.0 * COUNT(*) FILTER (WHERE result = 'win') / NULLIF(COUNT(*) FILTER (WHERE result IN ('win','loss')), 0), 1) as overall_win_rate,
      ROUND(COALESCE(SUM(pnl) FILTER (WHERE result IN ('win','loss')), 0)::numeric, 2) as total_pnl,
      COUNT(*) as total_recs
    FROM recommendations WHERE result IS DISTINCT FROM 'duplicate'
  `);
  const s = summaryRes.rows[0];
  log(`  Total recs: ${s.total_recs} | Settled: ${s.settled} | W: ${s.wins} | L: ${s.losses} | Win Rate: ${s.overall_win_rate}% | Total PnL: ${s.total_pnl}`);

  await pool.end();
  fs.writeFileSync('C:/tfi/market-analysis.txt', out.join('\n'), 'utf8');
  process.stdout.write('ANALYSIS_WRITTEN_OK\n');
}

run().catch(e => { process.stderr.write(e.message + '\n'); process.exit(1); });
