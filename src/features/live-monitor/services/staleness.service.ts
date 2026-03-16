// ============================================================
// Staleness Guard — Prevent duplicate AI calls when nothing changed
// ============================================================

import type { MergedMatchData, PreviousRecommendation } from '../types';

interface StalenessResult {
  isStale: boolean;
  reason: string;
}

/**
 * Check if match conditions have changed significantly since the last recommendation.
 * If nothing meaningful changed → skip AI call to avoid duplicates.
 *
 * Returns `{ isStale: true }` when AI should be SKIPPED (no significant change).
 */
export function checkStaleness(
  current: MergedMatchData,
  lastRec: PreviousRecommendation | null,
): StalenessResult {
  // No previous recommendation → always fresh
  if (!lastRec) {
    return { isStale: false, reason: 'first_analysis' };
  }

  const currentMinute = typeof current.minute === 'string'
    ? parseInt(current.minute, 10) || 0
    : (current.minute ?? 0);
  const lastMinute = lastRec.minute ?? 0;

  // 1. Time gap >= 5 minutes → always re-analyze
  if (currentMinute - lastMinute >= 5) {
    return { isStale: false, reason: 'time_elapsed' };
  }

  // 2. Goals changed since last rec
  const recentEvents = current.events_compact || [];
  const newGoalsSinceLastRec = recentEvents.some(
    (e) => e.type === 'Goal' && typeof e.minute === 'number' && e.minute > lastMinute,
  );
  if (newGoalsSinceLastRec) {
    return { isStale: false, reason: 'goal_scored' };
  }

  // 3. Red card since last rec
  const newRedCard = recentEvents.some(
    (e) => e.type === 'Red Card' && typeof e.minute === 'number' && e.minute > lastMinute,
  );
  if (newRedCard) {
    return { isStale: false, reason: 'red_card' };
  }

  // 4. Possession swing > 5 ppt
  const possStr = current.stats?.possession || '';
  const possParts = possStr.split('-').map((s) => parseInt(s.trim(), 10));
  if (possParts.length === 2 && !isNaN(possParts[0]!)) {
    // Possession tracked but we lack previous-snapshot comparison;
    // heuristic: if only 1-2 minutes passed and no events, it's stale (handled below)
  }

  // 5. Odds movement > 0.10
  const oc = current.odds_canonical || {} as Record<string, unknown>;
  if (lastRec.odds && lastRec.bet_market && oc) {
    const currentOdd = extractCurrentOddForMarket(lastRec.bet_market, lastRec.selection, oc as unknown as Record<string, unknown>);
    if (currentOdd !== null && lastRec.odds !== null) {
      const diff = Math.abs(currentOdd - lastRec.odds);
      if (diff > 0.10) {
        return { isStale: false, reason: 'odds_movement' };
      }
    }
  }

  // 6. If less than 3 minutes passed and no events → stale
  if (currentMinute - lastMinute < 3) {
    return { isStale: true, reason: 'no_significant_change' };
  }

  // Default: not stale (allow AI call)
  return { isStale: false, reason: 'time_elapsed' };
}

// ==================== Helpers ====================

function parseScore(score: string): [number, number] {
  const parts = (score || '0-0').split('-').map((s) => parseInt(s.trim(), 10) || 0);
  return [parts[0] ?? 0, parts[1] ?? 0];
}

function extractCurrentOddForMarket(
  market: string,
  selection: string,
  oc: Record<string, unknown>,
): number | null {
  const m = market.toLowerCase();
  const s = (selection || '').toLowerCase();

  if (m.includes('ou') || m.includes('over') || m.includes('under')) {
    const ou = oc.ou as { over?: number; under?: number } | undefined;
    if (s.includes('over') && ou?.over) return ou.over;
    if (s.includes('under') && ou?.under) return ou.under;
  }

  if (m.includes('1x2') || m.includes('match_result')) {
    const x = oc['1x2'] as { home?: number; away?: number; draw?: number } | undefined;
    if (s.includes('home') && x?.home) return x.home;
    if (s.includes('away') && x?.away) return x.away;
    if (s.includes('draw') && x?.draw) return x.draw;
  }

  if (m.includes('btts')) {
    const b = oc.btts as { yes?: number; no?: number } | undefined;
    if (s.includes('yes') && b?.yes) return b.yes;
    if (s.includes('no') && b?.no) return b.no;
  }

  if (m.includes('ah') || m.includes('handicap')) {
    const ah = oc.ah as { home?: number; away?: number } | undefined;
    if (s.includes('home') && ah?.home) return ah.home;
    if (s.includes('away') && ah?.away) return ah.away;
  }

  return null;
}

export { extractCurrentOddForMarket, parseScore };
