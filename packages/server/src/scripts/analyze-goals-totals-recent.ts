/**
 * Aggregate live DB: goals Under vs Over share and prompt_version (recent window).
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

  const out = {
    lookbackDays: days,
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
