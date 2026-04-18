import { getSettings } from '../repos/settings.repo.js';
import type { MatchRow } from '../repos/matches.repo.js';
import type { WatchlistCreate } from '../repos/watchlist.repo.js';

export async function getAutoApplyRecommendedCondition(
  cache: Map<string, boolean>,
  userId = 'default',
  options: { fallbackToDefault?: boolean } = {},
): Promise<boolean> {
  const cacheKey = `${userId}:${options.fallbackToDefault !== false}`;
  const cached = cache.get(cacheKey);
  if (cached != null) return cached;

  const settings = await getSettings(userId, options).catch(() => ({}));
  const value = (settings as Record<string, unknown>).AUTO_APPLY_RECOMMENDED_CONDITION !== false;
  cache.set(cacheKey, value);
  return value;
}

export function buildAutoWatchlistEntry(
  match: MatchRow,
  autoApplyRecommendedCondition: boolean,
  addedBy: string,
): Partial<WatchlistCreate> {
  return {
    match_id: match.match_id,
    date: match.date,
    kickoff_at_utc: match.kickoff_at_utc ?? null,
    league: match.league_name,
    home_team: match.home_team,
    away_team: match.away_team,
    home_logo: match.home_logo,
    away_logo: match.away_logo,
    kickoff: match.kickoff,
    prediction: null,
    recommended_custom_condition: '',
    recommended_condition_reason: '',
    recommended_condition_reason_vi: '',
    recommended_condition_at: null,
    auto_apply_recommended_condition: autoApplyRecommendedCondition,
    custom_conditions: '',
    added_by: addedBy,
    last_checked: null,
    total_checks: 0,
    recommendations_count: 0,
    strategic_context: null,
    strategic_context_at: null,
  };
}
