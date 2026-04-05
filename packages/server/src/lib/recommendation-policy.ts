import { normalizeMarket } from './normalize-market.js';

export interface RecommendationPolicyPreviousRow {
  minute: number | null;
  selection: string;
  bet_market: string;
  odds?: number | null;
  stake_percent?: number | null;
  result?: string | null;
}

export interface RecommendationPolicyStatsCompact {
  shots_on_target?: { home: string | null; away: string | null };
}

export interface RecommendationPolicyInput {
  selection: string;
  betMarket: string;
  minute: number;
  score: string;
  odds: number | null;
  confidence: number;
  valuePercent: number;
  stakePercent: number;
  promptVersion?: string | null;
  previousRecommendations?: RecommendationPolicyPreviousRow[];
  statsCompact?: RecommendationPolicyStatsCompact | null;
}

export interface RecommendationPolicyResult {
  blocked: boolean;
  warnings: string[];
  confidence: number;
  stakePercent: number;
}

const BTTS_NO_MIN_ODDS = 1.7;
const BTTS_NO_MAX_ODDS = 1.9;
const BTTS_NO_MIN_EDGE = 5;
const BTTS_NO_MAX_CONFIDENCE = 6;
const BTTS_NO_MAX_STAKE_PERCENT = 2;
const SAME_THESIS_MAX_RECOMMENDATIONS = 2;
const SAME_THESIS_MAX_STAKE_PERCENT = 10;

function parseStatInt(value: string | null | undefined): number | null {
  if (value == null) return null;
  const num = Number.parseInt(String(value).trim(), 10);
  return Number.isFinite(num) ? num : null;
}

function getScoreState(score: string): 'unknown' | 'level' | 'one-goal-margin' | 'two-plus-margin' {
  const match = String(score || '').trim().match(/^(\d+)\s*[-:]\s*(\d+)$/);
  if (!match) return 'unknown';
  const home = Number(match[1] ?? 0);
  const away = Number(match[2] ?? 0);
  const diff = Math.abs(home - away);
  if (diff === 0) return 'level';
  if (diff === 1) return 'one-goal-margin';
  return 'two-plus-margin';
}

export function getCorrelatedThesis(canonicalMarket: string): string | null {
  if (!canonicalMarket || canonicalMarket === 'unknown') return null;
  if (canonicalMarket.startsWith('over_')) return 'goals_over';
  if (canonicalMarket.startsWith('under_')) return 'goals_under';
  if (canonicalMarket.startsWith('corners_over_')) return 'corners_over';
  if (canonicalMarket.startsWith('corners_under_')) return 'corners_under';
  if (canonicalMarket.startsWith('asian_handicap_home_')) return 'asian_handicap_home';
  if (canonicalMarket.startsWith('asian_handicap_away_')) return 'asian_handicap_away';
  if (canonicalMarket === 'btts_yes') return 'btts_yes';
  if (canonicalMarket === 'btts_no') return 'btts_no';
  if (canonicalMarket === '1x2_home') return '1x2_home';
  if (canonicalMarket === '1x2_away') return '1x2_away';
  if (canonicalMarket === '1x2_draw') return '1x2_draw';
  return null;
}

function isNonDuplicatePreviousRow(row: RecommendationPolicyPreviousRow): boolean {
  return String(row.result ?? '').trim().toLowerCase() !== 'duplicate';
}

export function applyRecommendationPolicy(input: RecommendationPolicyInput): RecommendationPolicyResult {
  const canonicalMarket = normalizeMarket(input.selection ?? '', input.betMarket ?? '');
  const warnings: string[] = [];
  let blocked = false;
  let confidence = input.confidence;
  let stakePercent = input.stakePercent;
  const promptVersion = String(input.promptVersion ?? '').trim();
  const isV8 = promptVersion === 'v8-market-balance-followup-a' || promptVersion === 'v8-market-balance-followup-b';
  const isV8b = promptVersion === 'v8-market-balance-followup-b';
  const isV8d = promptVersion === 'v8-market-balance-followup-d';
  const scoreState = getScoreState(input.score);

  const block = (warning: string) => {
    blocked = true;
    warnings.push(warning);
  };

  if (canonicalMarket === '1x2_draw') {
    block('POLICY_BLOCK_1X2_DRAW');
  }

  if (canonicalMarket === '1x2_home' && input.minute < (isV8d ? 35 : isV8b ? 55 : isV8 ? 60 : 75)) {
    block(
      isV8d
        ? 'POLICY_BLOCK_1X2_HOME_PRE35_V8D'
        : isV8b
          ? 'POLICY_BLOCK_1X2_HOME_PRE55_V8B'
          : isV8
            ? 'POLICY_BLOCK_1X2_HOME_PRE60_V8'
            : 'POLICY_BLOCK_1X2_HOME_PRE75',
    );
  }

  if (canonicalMarket === 'over_0.5' && input.minute >= 75) {
    block('POLICY_BLOCK_OVER_0_5_75_PLUS');
  }

  if (canonicalMarket === 'under_2.5' && input.minute < 75) {
    block('POLICY_BLOCK_UNDER_2_5_PRE75');
  }

  if (
    isV8d
    && canonicalMarket.startsWith('under_')
    && !canonicalMarket.startsWith('under_0.5')
    && input.minute >= 45
    && input.minute <= 59
    && scoreState === 'two-plus-margin'
  ) {
    block('POLICY_BLOCK_GOALS_UNDER_45_59_TWO_PLUS_MARGIN_V8D');
  }

  if (canonicalMarket === 'btts_no') {
    if (input.minute >= 60 && input.minute < 75) {
      block('POLICY_BLOCK_BTTS_NO_60_74');
    }
    if (input.odds != null && input.odds < BTTS_NO_MIN_ODDS) {
      block('POLICY_BLOCK_BTTS_NO_LOW_PRICE');
    }
    if (input.odds != null && input.odds >= BTTS_NO_MAX_ODDS) {
      block('POLICY_BLOCK_BTTS_NO_HIGH_PRICE');
    }
    if (input.valuePercent < BTTS_NO_MIN_EDGE) {
      block('POLICY_BLOCK_BTTS_NO_LOW_EDGE');
    }

    const homeShotsOnTarget = parseStatInt(input.statsCompact?.shots_on_target?.home);
    const awayShotsOnTarget = parseStatInt(input.statsCompact?.shots_on_target?.away);
    if ((homeShotsOnTarget ?? 0) >= 2 && (awayShotsOnTarget ?? 0) >= 2) {
      block('POLICY_BLOCK_BTTS_NO_BOTH_TEAMS_ON_TARGET');
    }

    if (confidence > BTTS_NO_MAX_CONFIDENCE) {
      confidence = BTTS_NO_MAX_CONFIDENCE;
      warnings.push('POLICY_CAP_BTTS_NO_CONFIDENCE');
    }
    if (stakePercent > BTTS_NO_MAX_STAKE_PERCENT) {
      stakePercent = BTTS_NO_MAX_STAKE_PERCENT;
      warnings.push('POLICY_CAP_BTTS_NO_STAKE');
    }
  }

  const thesis = getCorrelatedThesis(canonicalMarket);
  if (thesis) {
    const sameThesisRows = (input.previousRecommendations ?? [])
      .filter(isNonDuplicatePreviousRow)
      .filter((row) => getCorrelatedThesis(normalizeMarket(row.selection ?? '', row.bet_market ?? '')) === thesis);

    const sameThesisStake = sameThesisRows.reduce((sum, row) => sum + (Number(row.stake_percent ?? 0) || 0), 0);
    if (sameThesisRows.length >= SAME_THESIS_MAX_RECOMMENDATIONS) {
      block('POLICY_BLOCK_SAME_THESIS_COUNT_CAP');
    }
    if (sameThesisStake + (Number(stakePercent) || 0) > SAME_THESIS_MAX_STAKE_PERCENT) {
      block('POLICY_BLOCK_SAME_THESIS_STAKE_CAP');
    }
  }

  return {
    blocked,
    warnings,
    confidence,
    stakePercent,
  };
}
