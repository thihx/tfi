import { pool } from './src/db/pool.ts';

const r = await pool.query(`
  SELECT 
    COALESCE(SUM(stake_amount) FILTER (WHERE result IN ('win','loss','push')), 0) as total_staked,
    COALESCE(SUM(pnl) FILTER (WHERE result IN ('win','loss','push')), 0) as total_pnl,
    COUNT(*) FILTER (WHERE stake_amount IS NOT NULL AND stake_amount > 0) as has_stake,
    COUNT(*) FILTER (WHERE stake_amount IS NULL OR stake_amount = 0) as no_stake,
    COUNT(*) as total
  FROM recommendations 
  WHERE result != 'duplicate'
`);
console.log('=== STAKE STATS ===');
console.log(r.rows[0]);

const sample = await pool.query(`
  SELECT stake_amount, stake_percent, pnl, result
  FROM recommendations
  WHERE result != 'duplicate' AND result IN ('win','loss')
  LIMIT 5
`);
console.log('\n=== SAMPLE rows ===');
sample.rows.forEach(x => console.log(x));

process.exit(0);
