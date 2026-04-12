/**
 * Aggregate live DB: goals Under/Over share, prompt_version, and settlement mix (recent window).
 * cd packages/server && npx tsx src/scripts/analyze-goals-totals-recent.ts [days=14]
 */
import { config } from '../config.js';
import { pool } from '../db/pool.js';

async function main(): Promise<void> {
  const days = Math.max(1, Math.min(90, Number(process.argv[2]) || 14));
  if (!config.databaseUrl?.trim()) {
    console.error('Missing DATABASE_URL');
    process.exit(1);
  }

  const overall = await pool.query<{
    total: string;
    n_under: string;
    n_over: string;
    under_pct: string | null;
  }>(
    `SELECT
       COUNT(*)::text AS total,
       COUNT(*) FILTER (WHERE bet_market LIKE 'under_%')::text AS n_under,
       COUNT(*) FILTER (WHERE bet_market LIKE 'over_%')::text AS n_over,
       ROUND(100.0 * COUNT(*) FILTER (WHERE bet_market LIKE 'under_%') / NULLIF(COUNT(*), 0), 2)::text AS under_pct
     FROM recommendations
     WHERE timestamp >= NOW() - make_interval(days => $1::int)
       AND bet_market IS NOT NULL
       AND (bet_market LIKE 'under_%' OR bet_market LIKE 'over_%')`,
    [days],
  );

  const [byResult, byBetType, directionalSettlement] = await Promise.all([
    pool.query<{ result: string; c: string }>(
      `SELECT COALESCE(NULLIF(TRIM(result), ''), '(empty)') AS result, COUNT(*)::text AS c
       FROM recommendations
       WHERE timestamp >= NOW() - make_interval(days => $1::int)
       GROUP BY 1 ORDER BY COUNT(*) DESC`,
      [days],
    ),
    pool.query<{ bet_type: string; c: string }>(
      `SELECT COALESCE(NULLIF(TRIM(bet_type), ''), '(empty)') AS bet_type, COUNT(*)::text AS c
       FROM recommendations
       WHERE timestamp >= NOW() - make_interval(days => $1::int)
       GROUP BY 1 ORDER BY COUNT(*) DESC`,
      [days],
    ),
    pool.query<{
      directional: string;
      wins: string;
      losses: string;
      push_like: string;
      pending_or_other: string;
    }>(
      `SELECT
         COUNT(*)::text AS directional,
         COUNT(*) FILTER (WHERE result = 'win')::text AS wins,
         COUNT(*) FILTER (WHERE result = 'loss')::text AS losses,
         COUNT(*) FILTER (WHERE result IN ('push','void','half_win','half_loss'))::text AS push_like,
         COUNT(*) FILTER (WHERE result = '' OR result IS NULL OR result NOT IN ('win','loss','push','half_win','half_loss','void'))::text AS pending_or_other
       FROM recommendations
       WHERE timestamp >= NOW() - make_interval(days => $1::int)
         AND bet_type IS DISTINCT FROM 'NO_BET'
         AND result IS DISTINCT FROM 'duplicate'`,
      [days],
    ),
  ]);

  const byVersion = await pool.query<{
    prompt_version: string;
    total: string;
    n_under: string;
    n_over: string;
    under_pct: string | null;
  }>(
    `SELECT
       COALESCE(NULLIF(TRIM(prompt_version), ''), '(empty)') AS prompt_version,
       COUNT(*)::text AS total,
       COUNT(*) FILTER (WHERE bet_market LIKE 'under_%')::text AS n_under,
       COUNT(*) FILTER (WHERE bet_market LIKE 'over_%')::text AS n_over,
       ROUND(100.0 * COUNT(*) FILTER (WHERE bet_market LIKE 'under_%') / NULLIF(COUNT(*), 0), 2)::text AS under_pct
     FROM recommendations
     WHERE timestamp >= NOW() - make_interval(days => $1::int)
       AND bet_market IS NOT NULL
       AND (bet_market LIKE 'under_%' OR bet_market LIKE 'over_%')
     GROUP BY 1
     ORDER BY COUNT(*) DESC`,
    [days],
  );

  const ds = directionalSettlement.rows[0];
  const w = Number(ds?.wins ?? 0);
  const lo = Number(ds?.losses ?? 0);
  const decidedWl = w + lo;

  const out = {
    lookbackDays: days,
    allRowsByResult: byResult.rows,
    allRowsByBetType: byBetType.rows,
    directionalSettlement: ds ?? null,
    winRateAmongDecidedWinLoss: decidedWl > 0 ? Number((w / decidedWl).toFixed(4)) : null,
    goalsTotalsSide: overall.rows[0] ?? null,
    byPromptVersion: byVersion.rows,
  };
  console.log(JSON.stringify(out, null, 2));
  await pool.end();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
