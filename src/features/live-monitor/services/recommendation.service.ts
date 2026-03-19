// ============================================================
// Recommendation Service
// Equivalent to: "Prepare Recommendation Data" node
// ============================================================

import type {
  LiveMonitorConfig,
  MergedMatchData,
  ParsedAiResponse,
  RecommendationData,
} from '../types';

/** Normalize selection text into a canonical market key for dedup. */
function normalizeMarketKey(selection: string, betMarket?: string): string {
  const sel = (selection || '').toLowerCase().trim();
  const mkt = (betMarket || '').toLowerCase().trim();

  if (mkt) return mkt;

  // Asian Handicap (before home/win since "AH Home" contains "home")
  if (/asian\s*handicap|\bah\s+[+-]?\d/i.test(sel)) return 'asian_handicap';
  // Corners (before over/under since "Over 9.5 Corners" contains "over")
  if (/corner/i.test(sel)) return 'corners';
  // Over / Under
  const ouMatch = sel.match(/(?:over|under)\s*([\d.]+)/);
  if (ouMatch) {
    const dir = sel.startsWith('under') ? 'under' : 'over';
    return `${dir}_${ouMatch[1]}`;
  }
  // BTTS
  if (/btts|both.?teams?.?to.?score/i.test(sel)) {
    return sel.includes('no') ? 'btts_no' : 'btts_yes';
  }
  // Draw
  if (/\bdraw\b/i.test(sel)) return '1x2_draw';
  // Away
  if (/\baway\b/i.test(sel)) return '1x2_away';
  // Home / Win (must come after draw/away)
  if (/\b(home|win)\b/i.test(sel)) return '1x2_home';

  // Fallback: slugified selection
  return sel.replace(/[^a-z0-9]+/g, '_').slice(0, 50) || 'unknown';
}

/**
 * Prepare the recommendation record from merged match data + parsed AI response.
 * Maps ~35 fields exactly like the n8n "Prepare Recommendation Data" node.
 */
export function prepareRecommendationData(
  matchData: MergedMatchData,
  parsed: ParsedAiResponse,
  config: LiveMonitorConfig,
  executionId: string,
): RecommendationData {
  const now = new Date().toISOString();
  const match = matchData.match || { id: '', home: '', away: '', league: '', minute: '', score: '', status: '' };

  // Build unique key for deduplication: same match + same market = same bet
  const marketKey = normalizeMarketKey(
    parsed.ai_selection || parsed.selection || '',
    parsed.bet_market,
  );
  const uniqueKey = `${matchData.match_id}_${marketKey}`;

  // Build display string
  const matchDisplay = `${match.home || matchData.home_team} vs ${match.away || matchData.away_team}`;

  // Notification channels
  const channels: string[] = [];
  if (parsed.should_push || parsed.ai_should_push) channels.push('email', 'telegram');
  if (parsed.custom_condition_matched) channels.push('email', 'telegram');
  if (parsed.condition_triggered_should_push) channels.push('email', 'telegram');
  const uniqueChannels = [...new Set(channels)];

  // Stats snapshot (compact JSON string)
  const statsSnapshot = JSON.stringify(matchData.stats_compact || {});

  // Odds snapshot (canonical JSON string)
  const oddsSnapshot = JSON.stringify(matchData.odds_canonical || {});

  // Determine if notified
  const notified = uniqueChannels.length > 0 ? 'pending' : 'skipped';

  // Custom condition raw (for reference)
  const customConditionRaw = matchData.custom_conditions || '';

  // Build reasoning string combining EN + VI
  const reasoning = parsed.reasoning_en || '';

  // Key factors: combine warnings and market reason
  const keyFactors = [
    parsed.market_chosen_reason || '',
    ...(parsed.warnings || []),
  ].filter(Boolean).join(' | ');

  // Warnings as string
  const warnings = (parsed.warnings || []).join(', ');

  // Determine the odds value to display
  const odds = parsed.usable_odd ?? parsed.mapped_odd ?? null;

  // Bet type inference
  const betType = parsed.bet_market || 'none';

  return {
    unique_key: uniqueKey,
    match_id: matchData.match_id,
    timestamp: now,
    match_display: matchDisplay,
    league: match.league || matchData.league || '',
    home_team: match.home || matchData.home_team || '',
    away_team: match.away || matchData.away_team || '',
    minute: match.minute ?? matchData.minute ?? null,
    score: match.score || matchData.score || '',
    status: match.status || matchData.status || '',
    bet_type: betType,
    selection: parsed.ai_selection || parsed.selection || '',
    bet_market: parsed.bet_market || '',
    odds: odds,
    confidence: parsed.ai_confidence ?? parsed.confidence ?? 0,
    value_percent: parsed.value_percent ?? 0,
    risk_level: parsed.risk_level || 'HIGH',
    stake_percent: parsed.stake_percent ?? 0,
    reasoning: reasoning,
    key_factors: keyFactors,
    warnings: warnings,
    custom_condition_matched: parsed.custom_condition_matched ?? false,
    custom_condition_raw: customConditionRaw,
    condition_triggered_suggestion: parsed.condition_triggered_suggestion || '',
    pre_match_prediction_summary: matchData.pre_match_prediction_summary || '',
    stats_snapshot: statsSnapshot,
    odds_snapshot: oddsSnapshot,
    ai_model: config.AI_MODEL || '',
    mode: matchData.mode || 'auto',
    notified: notified,
    notification_channels: uniqueChannels.join(','),
    execution_id: executionId,
    result: '',
    actual_outcome: '',
    pnl: null,
    settled_at: null,
  };
}
