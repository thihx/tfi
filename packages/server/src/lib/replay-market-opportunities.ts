import type { SettledReplayScenario } from './db-replay-scenarios.js';
import { buildOddsCanonical } from './server-pipeline.js';
import { getReplayMinuteBand, getReplayScoreState } from './settled-replay-evaluation.js';

export interface ReplayMarketOpportunity {
  scenarioName: string;
  recommendationId: number;
  minuteBand: string;
  scoreState: string;
  has1x2Home: boolean;
  playable1x2Home: boolean;
  oneX2HomeOdds: number | null;
  hasAsianHandicapHome: boolean;
  playableAsianHandicapHome: boolean;
  asianHandicapHomeOdds: number | null;
  asianHandicapLine: number | null;
  hasGoalsOu: boolean;
  hasCornersOu: boolean;
  /** First half — mirror FT side/totals coverage for replay audits. */
  hasHt1x2Home: boolean;
  playableHt1x2Home: boolean;
  ht1x2HomeOdds: number | null;
  hasHtAsianHandicapHome: boolean;
  playableHtAsianHandicapHome: boolean;
  htAsianHandicapHomeOdds: number | null;
  htAsianHandicapLine: number | null;
  hasHtGoalsOu: boolean;
}

export type ReplayMarketAvailabilityBucket =
  | 'playable_side_market'
  | 'side_market_unplayable'
  | 'totals_only'
  | 'limited_odds';

export interface ReplayMarketOpportunityBucket {
  bucket: string;
  total: number;
  has1x2Home: number;
  playable1x2Home: number;
  hasAsianHandicapHome: number;
  playableAsianHandicapHome: number;
  hasHt1x2Home: number;
  playableHt1x2Home: number;
  hasHtAsianHandicapHome: number;
  playableHtAsianHandicapHome: number;
  hasGoalsOu: number;
  hasCornersOu: number;
  hasHtGoalsOu: number;
}

export interface ReplayMarketOpportunitySummary {
  total: number;
  has1x2Home: number;
  playable1x2Home: number;
  hasAsianHandicapHome: number;
  playableAsianHandicapHome: number;
  hasGoalsOu: number;
  hasCornersOu: number;
  hasHt1x2Home: number;
  playableHt1x2Home: number;
  hasHtAsianHandicapHome: number;
  playableHtAsianHandicapHome: number;
  hasHtGoalsOu: number;
  byMinuteBand: ReplayMarketOpportunityBucket[];
  byScoreState: ReplayMarketOpportunityBucket[];
}

export function classifyReplayMarketAvailability(
  row: Pick<
    ReplayMarketOpportunity,
    | 'playable1x2Home'
    | 'playableAsianHandicapHome'
    | 'has1x2Home'
    | 'hasAsianHandicapHome'
    | 'hasGoalsOu'
    | 'hasCornersOu'
    | 'playableHt1x2Home'
    | 'playableHtAsianHandicapHome'
    | 'hasHt1x2Home'
    | 'hasHtAsianHandicapHome'
    | 'hasHtGoalsOu'
  >,
): ReplayMarketAvailabilityBucket {
  if (
    row.playable1x2Home
    || row.playableAsianHandicapHome
    || row.playableHt1x2Home
    || row.playableHtAsianHandicapHome
  ) {
    return 'playable_side_market';
  }
  if (
    row.has1x2Home
    || row.hasAsianHandicapHome
    || row.hasHt1x2Home
    || row.hasHtAsianHandicapHome
  ) {
    return 'side_market_unplayable';
  }
  if (row.hasGoalsOu || row.hasCornersOu || row.hasHtGoalsOu) return 'totals_only';
  return 'limited_odds';
}

function incrementBucket(
  map: Map<string, ReplayMarketOpportunityBucket>,
  key: string,
  row: ReplayMarketOpportunity,
): void {
  const current = map.get(key) ?? {
    bucket: key,
    total: 0,
    has1x2Home: 0,
    playable1x2Home: 0,
    hasAsianHandicapHome: 0,
    playableAsianHandicapHome: 0,
    hasHt1x2Home: 0,
    playableHt1x2Home: 0,
    hasHtAsianHandicapHome: 0,
    playableHtAsianHandicapHome: 0,
    hasGoalsOu: 0,
    hasCornersOu: 0,
    hasHtGoalsOu: 0,
  };
  current.total += 1;
  if (row.has1x2Home) current.has1x2Home += 1;
  if (row.playable1x2Home) current.playable1x2Home += 1;
  if (row.hasAsianHandicapHome) current.hasAsianHandicapHome += 1;
  if (row.playableAsianHandicapHome) current.playableAsianHandicapHome += 1;
  if (row.hasHt1x2Home) current.hasHt1x2Home += 1;
  if (row.playableHt1x2Home) current.playableHt1x2Home += 1;
  if (row.hasHtAsianHandicapHome) current.hasHtAsianHandicapHome += 1;
  if (row.playableHtAsianHandicapHome) current.playableHtAsianHandicapHome += 1;
  if (row.hasGoalsOu) current.hasGoalsOu += 1;
  if (row.hasCornersOu) current.hasCornersOu += 1;
  if (row.hasHtGoalsOu) current.hasHtGoalsOu += 1;
  map.set(key, current);
}

export function buildReplayMarketOpportunity(
  scenario: SettledReplayScenario,
  minOdds = 1.5,
): ReplayMarketOpportunity {
  const built = buildOddsCanonical(scenario.mockResolvedOdds?.response ?? []);
  const canonical = built.canonical;
  const oneX2HomeOdds = canonical['1x2']?.home ?? null;
  const asianHandicapHomeOdds = canonical['ah']?.home ?? null;
  const asianHandicapLine = canonical['ah']?.line ?? null;

  const ht1x2HomeOdds = canonical['ht_1x2']?.home ?? null;
  const htAsianHandicapHomeOdds = canonical['ht_ah']?.home ?? null;
  const htAsianHandicapLine = canonical['ht_ah']?.line ?? null;

  return {
    scenarioName: scenario.name,
    recommendationId: scenario.metadata.recommendationId,
    minuteBand: getReplayMinuteBand(scenario.metadata.minute),
    scoreState: getReplayScoreState(scenario.metadata.score),
    has1x2Home: oneX2HomeOdds != null,
    playable1x2Home: oneX2HomeOdds != null && oneX2HomeOdds >= minOdds,
    oneX2HomeOdds,
    hasAsianHandicapHome: asianHandicapHomeOdds != null && asianHandicapLine != null,
    playableAsianHandicapHome:
      asianHandicapHomeOdds != null && asianHandicapLine != null && asianHandicapHomeOdds >= minOdds,
    asianHandicapHomeOdds,
    asianHandicapLine,
    hasGoalsOu: canonical['ou']?.line != null,
    hasCornersOu: canonical['corners_ou']?.line != null,
    hasHt1x2Home: ht1x2HomeOdds != null,
    playableHt1x2Home: ht1x2HomeOdds != null && ht1x2HomeOdds >= minOdds,
    ht1x2HomeOdds,
    hasHtAsianHandicapHome: htAsianHandicapHomeOdds != null && htAsianHandicapLine != null,
    playableHtAsianHandicapHome:
      htAsianHandicapHomeOdds != null
      && htAsianHandicapLine != null
      && htAsianHandicapHomeOdds >= minOdds,
    htAsianHandicapHomeOdds,
    htAsianHandicapLine,
    hasHtGoalsOu: canonical['ht_ou']?.line != null,
  };
}

export function summarizeReplayMarketOpportunities(
  rows: ReplayMarketOpportunity[],
): ReplayMarketOpportunitySummary {
  const minuteMap = new Map<string, ReplayMarketOpportunityBucket>();
  const scoreMap = new Map<string, ReplayMarketOpportunityBucket>();

  for (const row of rows) {
    incrementBucket(minuteMap, row.minuteBand, row);
    incrementBucket(scoreMap, row.scoreState, row);
  }

  return {
    total: rows.length,
    has1x2Home: rows.filter((row) => row.has1x2Home).length,
    playable1x2Home: rows.filter((row) => row.playable1x2Home).length,
    hasAsianHandicapHome: rows.filter((row) => row.hasAsianHandicapHome).length,
    playableAsianHandicapHome: rows.filter((row) => row.playableAsianHandicapHome).length,
    hasGoalsOu: rows.filter((row) => row.hasGoalsOu).length,
    hasCornersOu: rows.filter((row) => row.hasCornersOu).length,
    hasHt1x2Home: rows.filter((row) => row.hasHt1x2Home).length,
    playableHt1x2Home: rows.filter((row) => row.playableHt1x2Home).length,
    hasHtAsianHandicapHome: rows.filter((row) => row.hasHtAsianHandicapHome).length,
    playableHtAsianHandicapHome: rows.filter((row) => row.playableHtAsianHandicapHome).length,
    hasHtGoalsOu: rows.filter((row) => row.hasHtGoalsOu).length,
    byMinuteBand: [...minuteMap.values()].sort((a, b) => a.bucket.localeCompare(b.bucket)),
    byScoreState: [...scoreMap.values()].sort((a, b) => a.bucket.localeCompare(b.bucket)),
  };
}
