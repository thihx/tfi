// ============================================================
// Market Normalizer — Derive canonical bet_market from selection text
// ============================================================

/**
 * Normalize a bet market to a canonical key like "1x2_home", "over_2.5", "btts_yes".
 * Uses bet_market if available, otherwise parses the selection text.
 */
export function normalizeMarket(selection: string, betMarket?: string): string {
  if (betMarket && betMarket.trim() !== '') return betMarket.trim().toLowerCase();

  const s = selection.toLowerCase().trim();

  // Asian Handicap (check BEFORE home/win since "AH Home" contains "home")
  if (/asian\s*handicap|\bah\s+[+-]?\d/i.test(s)) return 'asian_handicap';

  // Corners (check BEFORE over/under since "Over 9.5 Corners" contains "over")
  if (/corner/i.test(s)) return 'corners';

  // Over X.X Goals
  const overMatch = s.match(/over\s+(\d+\.?\d*)/);
  if (overMatch) return `over_${overMatch[1]}`;

  // Under X.X Goals
  const underMatch = s.match(/under\s+(\d+\.?\d*)/);
  if (underMatch) return `under_${underMatch[1]}`;

  // BTTS
  if (/btts|both\s*teams?\s*(to\s+)?scor/.test(s)) {
    return s.includes('no') ? 'btts_no' : 'btts_yes';
  }

  // Draw
  if (/\bdraw\b/.test(s)) return '1x2_draw';

  // Away win
  if (/\baway\b/.test(s)) return '1x2_away';

  // Home/team name win — fallback for "Brighton Win", "Home Win", etc.
  if (/\b(home|win)\b/.test(s)) return '1x2_home';

  return 'unknown';
}

/**
 * Build the dedup key: same match + same normalized market = same bet.
 * AI can recommend the SAME market multiple times for the same match,
 * but only the first record counts. Subsequent ones should UPDATE, not INSERT.
 */
export function buildDedupKey(matchId: string, selection: string, betMarket?: string): string {
  return `${matchId}_${normalizeMarket(selection, betMarket)}`;
}
