// ============================================================
// Odds Movements Repository — Track odds changes over time
// ============================================================

import { query } from '../db/pool.js';

export interface OddsMovementRow {
  id: number;
  match_id: string;
  captured_at: string;
  match_minute: number | null;
  market: string;
  bookmaker: string;
  line: number | null;
  price_1: number | null;
  price_2: number | null;
  price_x: number | null;
  prev_price_1: number | null;
  prev_price_2: number | null;
}

export async function recordOddsMovement(mov: {
  match_id: string;
  match_minute?: number | null;
  market: string;
  bookmaker?: string;
  line?: number | null;
  price_1?: number | null;
  price_2?: number | null;
  price_x?: number | null;
  prev_price_1?: number | null;
  prev_price_2?: number | null;
}): Promise<OddsMovementRow> {
  const r = await query<OddsMovementRow>(
    `INSERT INTO odds_movements (match_id, match_minute, market, bookmaker, line, price_1, price_2, price_x, prev_price_1, prev_price_2)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (match_id, market, match_minute)
     DO UPDATE SET
       line = EXCLUDED.line,
       price_1 = EXCLUDED.price_1,
       price_2 = EXCLUDED.price_2,
       price_x = EXCLUDED.price_x,
       prev_price_1 = EXCLUDED.prev_price_1,
       prev_price_2 = EXCLUDED.prev_price_2,
       captured_at = NOW()
     RETURNING *`,
    [
      mov.match_id,
      mov.match_minute ?? null,
      mov.market,
      mov.bookmaker ?? 'api-football',
      mov.line ?? null,
      mov.price_1 ?? null,
      mov.price_2 ?? null,
      mov.price_x ?? null,
      mov.prev_price_1 ?? null,
      mov.prev_price_2 ?? null,
    ],
  );
  return r.rows[0]!;
}

export async function getOddsHistory(
  matchId: string,
  market?: string,
): Promise<OddsMovementRow[]> {
  if (market) {
    const r = await query<OddsMovementRow>(
      'SELECT * FROM odds_movements WHERE match_id = $1 AND market = $2 ORDER BY match_minute',
      [matchId, market],
    );
    return r.rows;
  }
  const r = await query<OddsMovementRow>(
    'SELECT * FROM odds_movements WHERE match_id = $1 ORDER BY market, match_minute',
    [matchId],
  );
  return r.rows;
}

export async function purgeOddsMovements(keepDays: number): Promise<number> {
  if (keepDays <= 0) return 0;
  const result = await query(
    `DELETE FROM odds_movements
     WHERE captured_at < NOW() - INTERVAL '1 day' * $1`,
    [keepDays],
  );
  return result.rowCount ?? 0;
}
