import { query } from '../db/pool.js';
import { ensureMatchInsight } from './provider-insight-cache.js';
import * as matchHistoryRepo from '../repos/matches-history.repo.js';
import {
  upsertLeagueProfile,
  buildAutoDerivedLeagueProfileData,
  type LeagueProfileData,
} from '../repos/league-profiles.repo.js';
import {
  upsertTeamProfile,
  buildAutoDerivedTeamProfileData,
  getTeamProfileByTeamId,
  type TeamProfileData,
} from '../repos/team-profiles.repo.js';
import { parseStoredSettlementStats } from './settlement-stat-cache.js';
import {
  getPrematchProfileCandidateTeams,
  type PrematchProfileCandidateTeam,
} from './prematch-profile-team-candidates.js';
import { getLeagueTeamDirectory } from '../repos/team-directory.repo.js';
import { fetchLeagueSeasonFixturesFromReferenceProvider } from './reference-data-provider.js';
import {
  FINISHED_SETTLEMENT_STATUSES,
  buildHistoricalArchiveRowFromFixture,
} from './settlement-history-hydration.js';

const LOOKBACK_DAYS = 180;
const LEAGUE_MIN_MATCHES = 20;
const TEAM_MIN_MATCHES = 8;
const LEAGUE_EVENT_SUMMARY_MIN_COUNT = 12;
const TEAM_EVENT_SUMMARY_MIN_COUNT = 5;
const EVENT_SUMMARY_COVERAGE_FLOOR = 0.6;
// Phase 1 rollout acceleration: top-league backfill should fill historical goal-timeline
// coverage quickly enough for derived profile metrics to become usable after a small number of runs.
const EVENT_SUMMARY_BACKFILL_LIMIT = 500;
const EVENT_SUMMARY_BACKFILL_CONCURRENCY = 10;
const HISTORY_FIXTURE_BACKFILL_CONCURRENCY = 2;
const HISTORY_FIXTURE_BACKFILL_SEASON_DEPTH = 2;

type LeagueTier = LeagueProfileData['tempo_tier'];
type TeamReliabilityTier = TeamProfileData['data_reliability_tier'];
type FirstScoringSide = 'home' | 'away' | null;

interface SettlementEventSummary {
  first_scoring_side: FirstScoringSide;
  has_goal_after_75: boolean;
  goal_event_count: number;
  source: 'api-football-events';
}

interface HistoricalMatchRow {
  match_id: string;
  league_id: number;
  league_name: string;
  home_team: string;
  away_team: string;
  final_status: string;
  home_score: number;
  away_score: number;
  settlement_stats: unknown;
  settlement_event_summary: unknown;
  date: string;
}

interface TeamMatchPerspective {
  goalsFor: number;
  goalsAgainst: number;
  isHome: boolean;
  cornersFor: number | null;
  cornersAgainst: number | null;
  cards: number | null;
  scoredFirst: boolean | null;
  hadGoalAfter75: boolean | null;
}

export interface DerivedPrematchProfilesResult {
  lookbackDays: number;
  candidateLeagues: number;
  refreshedLeagueProfiles: number;
  skippedLeagueProfiles: number;
  candidateTeams: number;
  refreshedTeamProfiles: number;
  skippedTeamProfiles: number;
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function average(values: Array<number | null | undefined>): number | null {
  const present = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (present.length === 0) return null;
  return present.reduce((sum, value) => sum + value, 0) / present.length;
}

function round(value: number | null, digits = 3): number | null {
  if (value == null) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function rate(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(denominator) || denominator <= 0) return null;
  return numerator / denominator;
}

function standardDeviation(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
  return Math.sqrt(variance);
}

function clampTier(value: number | null, thresholds: { low: number; high: number }): LeagueTier {
  if (value == null) return 'balanced';
  if (value >= thresholds.high) return 'high';
  if (value <= thresholds.low) return 'low';
  return 'balanced';
}

function reliabilityTierFromMatches(matches: number): LeagueTier {
  if (matches >= 80) return 'high';
  if (matches >= 30) return 'balanced';
  return 'low';
}

function teamReliabilityTierFromMatches(matches: number): TeamReliabilityTier {
  if (matches >= 24) return 'high';
  if (matches >= 12) return 'medium';
  return 'low';
}

function extractPairStat(
  rawStats: unknown,
  typeMatchers: RegExp[],
): { home: number | null; away: number | null } | null {
  const stats = parseStoredSettlementStats(rawStats);
  const row = stats.find((item) => typeMatchers.some((matcher) => matcher.test(String(item.type ?? ''))));
  if (!row) return null;
  const home = Number(row.home);
  const away = Number(row.away);
  return {
    home: Number.isFinite(home) ? home : null,
    away: Number.isFinite(away) ? away : null,
  };
}

function buildTeamPerspective(
  match: HistoricalMatchRow,
  side: 'home' | 'away',
): TeamMatchPerspective {
  const eventSummary = parseStoredSettlementEventSummary(match.settlement_event_summary);
  const corners = extractPairStat(match.settlement_stats, [/corner/i]);
  const cards = extractPairStat(match.settlement_stats, [/yellow cards?/i, /yellow/i]);
  if (side === 'home') {
    return {
      goalsFor: match.home_score,
      goalsAgainst: match.away_score,
      isHome: true,
      cornersFor: corners?.home ?? null,
      cornersAgainst: corners?.away ?? null,
      cards: cards?.home ?? null,
      scoredFirst: eventSummary ? eventSummary.first_scoring_side === 'home' : null,
      hadGoalAfter75: eventSummary ? eventSummary.has_goal_after_75 : null,
    };
  }
  return {
    goalsFor: match.away_score,
    goalsAgainst: match.home_score,
    isHome: false,
    cornersFor: corners?.away ?? null,
    cornersAgainst: corners?.home ?? null,
    cards: cards?.away ?? null,
    scoredFirst: eventSummary ? eventSummary.first_scoring_side === 'away' : null,
    hadGoalAfter75: eventSummary ? eventSummary.has_goal_after_75 : null,
  };
}

function hasSufficientCoverage(covered: number, total: number, minimum: number): boolean {
  if (total <= 0) return false;
  if (covered < minimum) return false;
  return (covered / total) >= EVENT_SUMMARY_COVERAGE_FLOOR;
}

function normalizeNameKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function isoDateDaysAgo(days: number): string {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  return cutoff.toISOString().slice(0, 10);
}

function buildBackfillSeasons(currentSeason: number | null): number[] {
  if (!currentSeason || !Number.isFinite(currentSeason) || currentSeason <= 0) return [];
  return Array.from({ length: HISTORY_FIXTURE_BACKFILL_SEASON_DEPTH }, (_, offset) => currentSeason - offset)
    .filter((season) => season > 0);
}

function buildHistoricalBackfillArchiveRows(
  fixtures: Array<{
    fixture: { date: string; status: { short: string } };
  }>,
  cutoffDate: string,
): Array<ReturnType<typeof buildHistoricalArchiveRowFromFixture>> {
  return fixtures
    .filter((fixture) => FINISHED_SETTLEMENT_STATUSES.has(fixture.fixture.status?.short ?? ''))
    .filter((fixture) => (fixture.fixture.date?.slice(0, 10) ?? '') >= cutoffDate)
    .map((fixture) => buildHistoricalArchiveRowFromFixture(fixture as never));
}

function parseEventMinute(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const time = typeof record.time === 'object' && record.time ? record.time as Record<string, unknown> : null;
  const directMinute = Number(record.minute);
  if (Number.isFinite(directMinute)) return directMinute;
  const elapsed = Number(time?.elapsed);
  return Number.isFinite(elapsed) ? elapsed : null;
}

function parseEventSide(raw: unknown, homeTeam: string, awayTeam: string): 'home' | 'away' | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const team = typeof record.team === 'object' && record.team ? record.team as Record<string, unknown> : null;
  const teamName = normalizeNameKey(String(team?.name ?? record.team_name ?? ''));
  if (!teamName) return null;
  if (teamName === normalizeNameKey(homeTeam)) return 'home';
  if (teamName === normalizeNameKey(awayTeam)) return 'away';
  return null;
}

function isGoalEvent(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const record = raw as Record<string, unknown>;
  const type = String(record.type ?? '').trim().toLowerCase();
  const detail = String(record.detail ?? '').trim().toLowerCase();
  if (type !== 'goal') return false;
  if (detail.includes('disallow')) return false;
  if (detail.includes('penalty shootout')) return false;
  return true;
}

function parseStoredSettlementEventSummary(value: unknown): SettlementEventSummary | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const firstRaw = String(record.first_scoring_side ?? '').trim().toLowerCase();
  const firstScoringSide: FirstScoringSide =
    firstRaw === 'home' || firstRaw === 'away'
      ? firstRaw
      : null;
  const hasGoalAfter75 = record.has_goal_after_75;
  const goalEventCount = Number(record.goal_event_count);
  if (typeof hasGoalAfter75 !== 'boolean') return null;
  if (!Number.isFinite(goalEventCount) || goalEventCount < 0) return null;
  return {
    first_scoring_side: firstScoringSide,
    has_goal_after_75: hasGoalAfter75,
    goal_event_count: goalEventCount,
    source: 'api-football-events',
  };
}

export function buildSettlementEventSummaryFromEvents(
  match: Pick<HistoricalMatchRow, 'home_team' | 'away_team' | 'home_score' | 'away_score'>,
  eventsRaw: unknown,
): SettlementEventSummary | null {
  if (!Array.isArray(eventsRaw)) {
    if ((match.home_score + match.away_score) === 0) {
      return {
        first_scoring_side: null,
        has_goal_after_75: false,
        goal_event_count: 0,
        source: 'api-football-events',
      };
    }
    return null;
  }

  const goalEvents = eventsRaw
    .filter((event) => isGoalEvent(event))
    .map((event) => ({
      minute: parseEventMinute(event),
      side: parseEventSide(event, match.home_team, match.away_team),
    }))
    .filter((event): event is { minute: number; side: 'home' | 'away' } => event.minute != null && event.side != null)
    .sort((left, right) => left.minute - right.minute);

  if (goalEvents.length === 0) {
    if ((match.home_score + match.away_score) === 0) {
      return {
        first_scoring_side: null,
        has_goal_after_75: false,
        goal_event_count: 0,
        source: 'api-football-events',
      };
    }
    return null;
  }

  return {
    first_scoring_side: goalEvents[0]!.side,
    has_goal_after_75: goalEvents.some((event) => event.minute > 75),
    goal_event_count: goalEvents.length,
    source: 'api-football-events',
  };
}

export function deriveLeagueProfileFromHistory(
  rows: HistoricalMatchRow[],
): LeagueProfileData | null {
  const matches = rows.length;
  if (matches < LEAGUE_MIN_MATCHES) return null;

  const totalGoals = rows.map((row) => row.home_score + row.away_score);
  const avgGoals = average(totalGoals);
  const over25 = rate(rows.filter((row) => row.home_score + row.away_score >= 3).length, matches);
  const btts = rate(rows.filter((row) => row.home_score > 0 && row.away_score > 0).length, matches);
  const homeWinRate = rate(rows.filter((row) => row.home_score > row.away_score).length, matches) ?? 0;
  const awayWinRate = rate(rows.filter((row) => row.away_score > row.home_score).length, matches) ?? 0;
  const totalGoalsStd = standardDeviation(totalGoals);

  const corners = rows
    .map((row) => extractPairStat(row.settlement_stats, [/corner/i]))
    .filter((value): value is { home: number | null; away: number | null } => value != null)
    .map((value) => (value.home ?? 0) + (value.away ?? 0));
  const cards = rows
    .map((row) => extractPairStat(row.settlement_stats, [/yellow cards?/i, /yellow/i]))
    .filter((value): value is { home: number | null; away: number | null } => value != null)
    .map((value) => (value.home ?? 0) + (value.away ?? 0));

  const avgCorners = average(corners);
  const avgCards = average(cards);
  const eventSummaries = rows
    .map((row) => parseStoredSettlementEventSummary(row.settlement_event_summary))
    .filter((summary): summary is SettlementEventSummary => summary != null);
  const lateGoalRate = hasSufficientCoverage(eventSummaries.length, matches, LEAGUE_EVENT_SUMMARY_MIN_COUNT)
    ? rate(eventSummaries.filter((summary) => summary.has_goal_after_75).length, eventSummaries.length)
    : null;

  return {
    tempo_tier: clampTier(avgGoals, { low: 2.2, high: 3.0 }),
    goal_tendency: clampTier(over25, { low: 0.45, high: 0.58 }),
    home_advantage_tier: clampTier(homeWinRate - awayWinRate, { low: 0.05, high: 0.15 }),
    corners_tendency: clampTier(avgCorners, { low: 8.5, high: 10.5 }),
    cards_tendency: clampTier(avgCards, { low: 3.4, high: 4.6 }),
    volatility_tier: clampTier(totalGoalsStd, { low: 1.1, high: 1.6 }),
    data_reliability_tier: reliabilityTierFromMatches(matches),
    avg_goals: round(avgGoals, 2),
    over_2_5_rate: round(over25, 3),
    btts_rate: round(btts, 3),
    late_goal_rate_75_plus: round(lateGoalRate, 3),
    avg_corners: round(avgCorners, 2),
    avg_cards: round(avgCards, 2),
  };
}

export function deriveTeamProfileFromHistory(
  rows: TeamMatchPerspective[],
): TeamProfileData | null {
  const matches = rows.length;
  if (matches < TEAM_MIN_MATCHES) return null;

  const avgGoalsScored = average(rows.map((row) => row.goalsFor));
  const avgGoalsConceded = average(rows.map((row) => row.goalsAgainst));
  const cleanSheetRate = rate(rows.filter((row) => row.goalsAgainst === 0).length, matches);
  const bttsRate = rate(rows.filter((row) => row.goalsFor > 0 && row.goalsAgainst > 0).length, matches);
  const over25Rate = rate(rows.filter((row) => row.goalsFor + row.goalsAgainst >= 3).length, matches);
  const avgCornersFor = average(rows.map((row) => row.cornersFor));
  const avgCornersAgainst = average(rows.map((row) => row.cornersAgainst));
  const avgCards = average(rows.map((row) => row.cards));
  const firstGoalSamples = rows.filter((row) => row.scoredFirst != null);
  const lateGoalSamples = rows.filter((row) => row.hadGoalAfter75 != null);

  const homeRows = rows.filter((row) => row.isHome);
  const homePointsPerMatch = average(homeRows.map((row) => {
    if (row.goalsFor > row.goalsAgainst) return 3;
    if (row.goalsFor === row.goalsAgainst) return 1;
    return 0;
  }));

  const pointsSeries = rows.map((row) => {
    if (row.goalsFor > row.goalsAgainst) return 3;
    if (row.goalsFor === row.goalsAgainst) return 1;
    return 0;
  });
  const pointsStd = standardDeviation(pointsSeries);

  let homeStrength: TeamProfileData['home_strength'] = 'normal';
  if ((homePointsPerMatch ?? 0) >= 2.0) homeStrength = 'strong';
  else if ((homePointsPerMatch ?? 0) <= 1.0) homeStrength = 'weak';

  let formConsistency: TeamProfileData['form_consistency'] = 'inconsistent';
  if ((pointsStd ?? 0) <= 0.9) formConsistency = 'consistent';
  else if ((pointsStd ?? 0) >= 1.5) formConsistency = 'volatile';

  let setPieceThreat: TeamProfileData['set_piece_threat'] = 'medium';
  if ((avgCornersFor ?? 0) >= 6) setPieceThreat = 'high';
  else if ((avgCornersFor ?? 0) > 0 && (avgCornersFor ?? 0) <= 4) setPieceThreat = 'low';
  const firstGoalRate = hasSufficientCoverage(firstGoalSamples.length, matches, TEAM_EVENT_SUMMARY_MIN_COUNT)
    ? rate(firstGoalSamples.filter((row) => row.scoredFirst === true).length, firstGoalSamples.length)
    : null;
  const lateGoalRate = hasSufficientCoverage(lateGoalSamples.length, matches, TEAM_EVENT_SUMMARY_MIN_COUNT)
    ? rate(lateGoalSamples.filter((row) => row.hadGoalAfter75 === true).length, lateGoalSamples.length)
    : null;

  return {
    attack_style: 'mixed',
    defensive_line: 'medium',
    pressing_intensity: 'medium',
    set_piece_threat: setPieceThreat,
    home_strength: homeStrength,
    form_consistency: formConsistency,
    squad_depth: 'medium',
    avg_goals_scored: round(avgGoalsScored, 3),
    avg_goals_conceded: round(avgGoalsConceded, 3),
    clean_sheet_rate: round(cleanSheetRate, 3),
    btts_rate: round(bttsRate, 3),
    over_2_5_rate: round(over25Rate, 3),
    avg_corners_for: round(avgCornersFor, 3),
    avg_corners_against: round(avgCornersAgainst, 3),
    avg_cards: round(avgCards, 3),
    first_goal_rate: round(firstGoalRate, 3),
    late_goal_rate: round(lateGoalRate, 3),
    data_reliability_tier: teamReliabilityTierFromMatches(matches),
  };
}

async function getHistoricalMatchesForLeagues(
  leagueIds: number[],
  lookbackDays: number,
): Promise<HistoricalMatchRow[]> {
  if (leagueIds.length === 0) return [];
  const result = await query<HistoricalMatchRow>(
    `SELECT
       match_id,
       league_id,
       league_name,
       home_team,
       away_team,
       final_status,
       home_score,
       away_score,
       settlement_stats,
       settlement_event_summary,
       date::text
     FROM matches_history
     WHERE league_id = ANY($1)
       AND final_status IN ('FT', 'AET', 'PEN')
       AND date >= CURRENT_DATE - ($2 * INTERVAL '1 day')`,
    [leagueIds, lookbackDays],
  );
  return result.rows;
}

async function hydrateMissingEventSummaries(rows: HistoricalMatchRow[]): Promise<void> {
  const targets = rows
    .filter((row) => parseStoredSettlementEventSummary(row.settlement_event_summary) == null)
    .sort((left, right) => Date.parse(right.date) - Date.parse(left.date))
    .slice(0, EVENT_SUMMARY_BACKFILL_LIMIT);

  for (let start = 0; start < targets.length; start += EVENT_SUMMARY_BACKFILL_CONCURRENCY) {
    const batch = targets.slice(start, start + EVENT_SUMMARY_BACKFILL_CONCURRENCY);
    await Promise.all(batch.map(async (row) => {
      try {
        const insight = await ensureMatchInsight(row.match_id, {
          status: row.final_status ?? 'FT',
          matchMinute: null,
          includeStartedDetails: true,
          refreshOdds: false,
          consumer: 'prematch-profile-sync',
          freshnessMode: 'prewarm_only',
        });
        const summary = buildSettlementEventSummaryFromEvents(row, insight.events.payload);
        if (!summary) return;
        row.settlement_event_summary = summary;
        await matchHistoryRepo.updateHistoricalMatchSettlementData(row.match_id, {
          settlement_event_summary: summary,
        });
      } catch {
        // Best-effort only. Missing event summaries should not fail the profile sync.
      }
    }));
  }
}

async function backfillHistoricalMatchesForLeagues(
  leagueIds: number[],
  lookbackDays: number,
): Promise<void> {
  const cutoffDate = isoDateDaysAgo(lookbackDays);
  const seasonPlans = await Promise.all(leagueIds.map(async (leagueId) => {
    const directoryRows = await getLeagueTeamDirectory(leagueId).catch(() => []);
    const currentSeason = directoryRows[0]?.season ?? new Date().getUTCFullYear();
    return {
      leagueId,
      seasons: buildBackfillSeasons(currentSeason),
    };
  }));

  const seasonTargets = seasonPlans.flatMap((plan) =>
    plan.seasons.map((season) => ({
      leagueId: plan.leagueId,
      season,
    })),
  );

  for (let start = 0; start < seasonTargets.length; start += HISTORY_FIXTURE_BACKFILL_CONCURRENCY) {
    const batch = seasonTargets.slice(start, start + HISTORY_FIXTURE_BACKFILL_CONCURRENCY);
    await Promise.all(batch.map(async ({ leagueId, season }) => {
      const fixtures = await fetchLeagueSeasonFixturesFromReferenceProvider(leagueId, season);
      const archiveRows = buildHistoricalBackfillArchiveRows(fixtures, cutoffDate);
      if (archiveRows.length === 0) return;
      await matchHistoryRepo.archiveFinishedMatches(archiveRows);
    }));
  }
}

export async function syncDerivedPrematchProfiles(
  leagueIds: number[],
): Promise<DerivedPrematchProfilesResult> {
  const uniqueLeagueIds = Array.from(new Set(leagueIds.filter((id) => Number.isFinite(id) && id > 0)));
  if (uniqueLeagueIds.length === 0) {
    return {
      lookbackDays: LOOKBACK_DAYS,
      candidateLeagues: 0,
      refreshedLeagueProfiles: 0,
      skippedLeagueProfiles: 0,
      candidateTeams: 0,
      refreshedTeamProfiles: 0,
      skippedTeamProfiles: 0,
    };
  }

  await backfillHistoricalMatchesForLeagues(uniqueLeagueIds, LOOKBACK_DAYS);

  const [historyRows, candidateTeamEntries] = await Promise.all([
    getHistoricalMatchesForLeagues(uniqueLeagueIds, LOOKBACK_DAYS),
    getPrematchProfileCandidateTeams(uniqueLeagueIds),
  ]);
  await hydrateMissingEventSummaries(historyRows);
  const computedAt = new Date().toISOString();

  const leagueHistory = new Map<number, HistoricalMatchRow[]>();
  for (const row of historyRows) {
    const list = leagueHistory.get(row.league_id) ?? [];
    list.push(row);
    leagueHistory.set(row.league_id, list);
  }

  let refreshedLeagueProfiles = 0;
  let skippedLeagueProfiles = 0;
  for (const leagueId of uniqueLeagueIds) {
    const rows = leagueHistory.get(leagueId) ?? [];
    const profile = deriveLeagueProfileFromHistory(rows);
    if (!profile) {
      skippedLeagueProfiles += 1;
      continue;
    }
    await upsertLeagueProfile(
      leagueId,
      buildAutoDerivedLeagueProfileData(profile, {
        lookback_days: LOOKBACK_DAYS,
        sample_matches: rows.length,
        event_summary_matches: rows.filter((row) => parseStoredSettlementEventSummary(row.settlement_event_summary) != null).length,
        event_coverage: rows.length > 0
          ? round(
            rows.filter((row) => parseStoredSettlementEventSummary(row.settlement_event_summary) != null).length / rows.length,
            3,
          )
          : null,
        top_league_only: true,
        computed_at: computedAt,
      }),
      `Auto-derived from the last ${rows.length} settled matches over ${LOOKBACK_DAYS} days.`,
      `Tu dong suy ra tu ${rows.length} tran da ket thuc trong ${LOOKBACK_DAYS} ngay gan nhat.`,
    );
    refreshedLeagueProfiles += 1;
  }

  const teamEntriesByLeague = new Map<number, PrematchProfileCandidateTeam[]>();
  for (const entry of candidateTeamEntries) {
    const list = teamEntriesByLeague.get(entry.league_id) ?? [];
    list.push(entry);
    teamEntriesByLeague.set(entry.league_id, list);
  }

  let refreshedTeamProfiles = 0;
  let skippedTeamProfiles = 0;
  for (const leagueId of uniqueLeagueIds) {
    const rows = leagueHistory.get(leagueId) ?? [];
    if (rows.length === 0) {
      skippedTeamProfiles += teamEntriesByLeague.get(leagueId)?.length ?? 0;
      continue;
    }

    const teamRows = new Map<string, TeamMatchPerspective[]>();
    for (const team of teamEntriesByLeague.get(leagueId) ?? []) {
      teamRows.set(String(team.team_id), []);
    }

    const nameToTeamId = new Map<string, string>();
    for (const team of teamEntriesByLeague.get(leagueId) ?? []) {
      nameToTeamId.set(normalizeName(team.team_name), String(team.team_id));
    }

    for (const row of rows) {
      const homeId = nameToTeamId.get(normalizeName(row.home_team));
      if (homeId) {
        teamRows.get(homeId)?.push(buildTeamPerspective(row, 'home'));
      }
      const awayId = nameToTeamId.get(normalizeName(row.away_team));
      if (awayId) {
        teamRows.get(awayId)?.push(buildTeamPerspective(row, 'away'));
      }
    }

    for (const [teamId, samples] of teamRows) {
      const profile = deriveTeamProfileFromHistory(samples);
      if (!profile) {
        skippedTeamProfiles += 1;
        continue;
      }
      const existingProfile = await getTeamProfileByTeamId(teamId).catch(() => null);
      const eventSummaryMatches = samples.filter((sample) => sample.scoredFirst != null && sample.hadGoalAfter75 != null).length;
      await upsertTeamProfile(teamId, {
        profile: buildAutoDerivedTeamProfileData(profile, {
          lookback_days: LOOKBACK_DAYS,
          sample_matches: samples.length,
          sample_home_matches: samples.filter((sample) => sample.isHome).length,
          sample_away_matches: samples.filter((sample) => !sample.isHome).length,
          event_summary_matches: eventSummaryMatches,
          event_coverage: samples.length > 0 ? round(eventSummaryMatches / samples.length, 3) : null,
          top_league_only: true,
          computed_at: computedAt,
        }, existingProfile?.profile ?? null),
        notes_en: `Auto-derived from ${samples.length} settled matches in the last ${LOOKBACK_DAYS} days. Tactical fields remain neutral defaults until manually curated.`,
        notes_vi: `Tu dong suy ra tu ${samples.length} tran da ket thuc trong ${LOOKBACK_DAYS} ngay gan nhat. Cac truong chien thuat van de gia tri trung tinh cho den khi duoc bien tap thu cong.`,
      });
      refreshedTeamProfiles += 1;
    }
  }

  return {
    lookbackDays: LOOKBACK_DAYS,
    candidateLeagues: uniqueLeagueIds.length,
    refreshedLeagueProfiles,
    skippedLeagueProfiles,
    candidateTeams: candidateTeamEntries.length,
    refreshedTeamProfiles,
    skippedTeamProfiles,
  };
}

export const __testables__ = {
  buildBackfillSeasons,
  buildHistoricalBackfillArchiveRows,
};
