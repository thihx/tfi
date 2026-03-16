// ============================================================
// Watchlist Service
// Equivalent to: "Get Active Matches" + "Filter Active Only" + 
//                "Has Active Matches?" + "Prepare Match Data" + 
//                "Build Fixtures Batch"
// ============================================================

import type { AppConfig } from '@/types';
import type {
  LiveMonitorConfig,
  WatchlistMatch,
  FilteredMatch,
  FixtureBatch,
} from '../types';
import { fetchWatchlistMatches } from './proxy.service';

/**
 * Parse a local date/time string (YYYY-MM-DD, HH:MM) into a UTC Date
 * treating the components as-is (no timezone conversion).
 */
function parseLocalDateTime(dateStr: string, timeStr: string): Date | null {
  if (!dateStr) return null;
  const dateParts = dateStr.trim().split('-');
  if (dateParts.length !== 3) return null;
  const year = Number(dateParts[0]);
  const month = Number(dateParts[1]);
  const day = Number(dateParts[2]);
  let hour = 0;
  let minute = 0;
  if (timeStr) {
    const tParts = timeStr.trim().split(':');
    hour = Number(tParts[0] || 0);
    minute = Number(tParts[1] || 0);
  }
  if (!year || !month || !day) return null;
  return new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));
}

/**
 * Get current time in the configured timezone as a "fake UTC" Date
 * (same trick as the n8n workflow).
 */
function getNowLocal(timezone: string): Date {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const part = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return new Date(
    Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), 0, 0),
  );
}

/**
 * Filter watchlist matches to only those that are currently active.
 * Mirrors the "Filter Active Only" node logic exactly.
 */
export function filterActiveMatches(
  allMatches: WatchlistMatch[],
  config: LiveMonitorConfig,
  webhookMatchIds?: string[],
): FilteredMatch[] {
  if (!allMatches.length) return [];

  const MATCH_DURATION_MINUTES = config.MATCH_STARTED_THRESHOLD_MINUTES;
  const MATCH_END_GRACE_MINUTES = 1;
  const FUTURE_WINDOW_MINUTES = 1;

  const isManualPush = !!webhookMatchIds?.length;
  const manualPushIds = new Set(
    (config.MANUAL_PUSH_MATCH_IDS || []).map((id) => String(id)),
  );

  let relevant: WatchlistMatch[] = [];

  // If webhook provides specific match IDs, filter by those
  if (webhookMatchIds && webhookMatchIds.length > 0) {
    const idSet = new Set(webhookMatchIds.map((id) => String(id)));
    relevant = allMatches.filter((item) => {
      const mid = String(item.match_id || '').trim();
      return mid && idSet.has(mid);
    });
  }

  // Fallback: filter by date/kickoff time window
  if (!relevant.length && (!webhookMatchIds || webhookMatchIds.length === 0)) {
    const nowLocal = getNowLocal(config.TIMEZONE);

    for (const item of allMatches) {
      const dateStr = String(item.date || '').trim();
      const kickoffStr = String(item.kickoff || '').trim();
      const matchStart = parseLocalDateTime(dateStr, kickoffStr);
      if (!matchStart) continue;

      const matchEnd = new Date(matchStart.getTime() + MATCH_DURATION_MINUTES * 60000);
      const diffKickoffMinutes = (matchStart.getTime() - nowLocal.getTime()) / 60000;
      const diffEndMinutes = (matchEnd.getTime() - nowLocal.getTime()) / 60000;

      if (diffKickoffMinutes > FUTURE_WINDOW_MINUTES) continue;
      if (diffEndMinutes < -MATCH_END_GRACE_MINUTES) continue;

      relevant.push(item);
    }
  }

  return relevant.map((item) => {
    const mid = String(item.match_id || '').trim();
    const forceAnalyze = item.mode === 'F' || manualPushIds.has(mid);
    return {
      ...item,
      force_analyze: forceAnalyze,
      is_manual_push: isManualPush,
    };
  });
}

/**
 * Prepare match data for pipeline processing.
 * Mirrors the "Prepare Match Data" node.
 */
export function prepareMatchData(
  matches: FilteredMatch[],
  config: LiveMonitorConfig,
): Array<{
  config: LiveMonitorConfig;
  match_id: string;
  home_team: string;
  away_team: string;
  league: string;
  mode: string;
  custom_conditions: string;
  priority: number;
  prediction: string;
  force_analyze: boolean;
  is_manual_push: boolean;
  recommended_custom_condition: string;
  recommended_condition_reason: string;
  recommended_condition_reason_vi: string;
}> {
  return matches.map((match) => ({
    config,
    match_id: match.match_id,
    home_team: match.home_team,
    away_team: match.away_team,
    league: match.league || match.league_name || '',
    mode: match.mode || 'B',
    custom_conditions: match.custom_conditions || '',
    priority: match.priority || 3,
    prediction: match.prediction || '',
    force_analyze: match.force_analyze || false,
    is_manual_push: match.is_manual_push || false,
    recommended_custom_condition: match.recommended_custom_condition || '',
    recommended_condition_reason: match.recommended_condition_reason || '',
    recommended_condition_reason_vi: match.recommended_condition_reason_vi || '',
  }));
}

/**
 * De-duplicate match IDs and batch them in groups of 20.
 * Mirrors the "Build Fixtures Batch" node.
 */
export function buildFixtureBatches<
  T extends { match_id: string },
>(matches: T[]): FixtureBatch[] {
  const matchMap = new Map<string, T>();
  for (const m of matches) {
    const id = String(m.match_id || '').trim();
    if (id && !matchMap.has(id)) matchMap.set(id, m);
  }

  const uniqueIds = Array.from(matchMap.keys());
  const batches: FixtureBatch[] = [];
  for (let i = 0; i < uniqueIds.length; i += 20) {
    batches.push({ match_ids: uniqueIds.slice(i, i + 20) });
  }
  return batches;
}

/**
 * Full watchlist loading + filtering pipeline.
 */
export async function loadAndFilterWatchlist(
  appConfig: AppConfig,
  monitorConfig: LiveMonitorConfig,
  webhookMatchIds?: string[],
): Promise<FilteredMatch[]> {
  const allMatches = await fetchWatchlistMatches(appConfig);
  return filterActiveMatches(allMatches as WatchlistMatch[], monitorConfig, webhookMatchIds);
}
