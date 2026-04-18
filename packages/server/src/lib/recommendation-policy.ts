/**
 * Post-parse gates: see `docs/live-monitor-ai-ou-under-bias.md` before tightening Under/Over asymmetry.
 * Global settlement-informed guards (all prompt versions) reduce recurring loss clusters (HT Under tight,
 * BTTS Yes one-sided score, AH home chalk, corners under in open games, MEDIUM with thin edge).
 */
import { normalizeMarket } from './normalize-market.js';
import { buildRecommendationSegmentKey } from './segment-policy-blocklist.js';
import { config } from '../config.js';

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
  prematchStrength?: string | null;
  previousRecommendations?: RecommendationPolicyPreviousRow[];
  statsCompact?: RecommendationPolicyStatsCompact | null;
  /** Optional keys `minuteBand::marketFamily` (replay segment shape); blocks persistence when matched. */
  segmentBlocklist?: ReadonlySet<string> | null;
  /** Optional max stake % per segment key; lowers stake and adds a warning (does not block). */
  segmentStakeCaps?: ReadonlyMap<string, number> | null;
  /** AI risk tier; used to tighten MEDIUM picks that historically underperform. */
  riskLevel?: string | null;
  /** Runtime evidence tier used by prompt and policy gates. */
  evidenceMode?: string | null;
  /** Break-even probability in decimal form (0..1). */
  breakEvenRate?: number | null;
  /** Optional directional gate signal (true means directional case is valid). */
  directionalWin?: boolean | null;
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
const MIDGAME_BLACKLISTED_MARKETS = new Set([
  'over_2.5',
  'ht_over_1.5',
  'under_2.25',
  'ht_1x2_draw',
  'corners_under_7.5',
  'corners_under_9.5',
]);
const HIGH_RISK_MARKETS = new Set([
  'btts_no',
  'corners_under_7.5',
  'corners_under_8.5',
  'corners_under_9.5',
  'under_2.25',
  'over_2.5',
]);

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

function getMinuteBand(minute: number): '00-29' | '30-44' | '45-59' | '60-74' | '75+' {
  if (minute <= 29) return '00-29';
  if (minute <= 44) return '30-44';
  if (minute <= 59) return '45-59';
  if (minute <= 74) return '60-74';
  return '75+';
}

function getTotalGoals(score: string): number | null {
  const match = String(score || '').trim().match(/^(\d+)\s*[-:]\s*(\d+)$/);
  if (!match) return null;
  const home = Number(match[1] ?? 0);
  const away = Number(match[2] ?? 0);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
  return home + away;
}

function getMarketLine(canonicalMarket: string): number | null {
  const match = String(canonicalMarket || '').trim().match(/_(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const line = Number(match[1]);
  return Number.isFinite(line) ? line : null;
}

/** Parsed Asian handicap for home (e.g. asian_handicap_home_-0.5 -> -0.5). */
function getAsianHandicapHomeLine(canonicalMarket: string): number | null {
  const prefix = 'asian_handicap_home_';
  if (!canonicalMarket.startsWith(prefix)) return null;
  const n = Number(canonicalMarket.slice(prefix.length));
  return Number.isFinite(n) ? n : null;
}

export function getCorrelatedThesis(canonicalMarket: string): string | null {
  if (!canonicalMarket || canonicalMarket === 'unknown') return null;
  if (canonicalMarket.startsWith('ht_over_')) return 'ht_goals_over';
  if (canonicalMarket.startsWith('ht_under_')) return 'ht_goals_under';
  if (canonicalMarket.startsWith('ht_asian_handicap_home_')) return 'ht_asian_handicap_home';
  if (canonicalMarket.startsWith('ht_asian_handicap_away_')) return 'ht_asian_handicap_away';
  if (canonicalMarket === 'ht_1x2_home') return 'ht_1x2_home';
  if (canonicalMarket === 'ht_1x2_away') return 'ht_1x2_away';
  if (canonicalMarket === 'ht_1x2_draw') return 'ht_1x2_draw';
  if (canonicalMarket === 'ht_btts_yes') return 'ht_btts_yes';
  if (canonicalMarket === 'ht_btts_no') return 'ht_btts_no';
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
  const isV8d = promptVersion === 'v8-market-balance-followup-d' || promptVersion === 'v8-market-balance-followup-e';
  const isV8f = promptVersion === 'v8-market-balance-followup-f';
  const isV8g = promptVersion === 'v8-market-balance-followup-g';
  const isV8h = promptVersion === 'v8-market-balance-followup-h';
  const isV8i = promptVersion === 'v8-market-balance-followup-i';
  const isV8j = promptVersion === 'v8-market-balance-followup-j';
  const isV10c = promptVersion === 'v10-hybrid-legacy-c';
  const isV10d = promptVersion === 'v10-hybrid-legacy-d';
  const isV10e = promptVersion === 'v10-hybrid-legacy-e';
  const isV10f = promptVersion === 'v10-hybrid-legacy-f';
  const isV10g = promptVersion === 'v10-hybrid-legacy-g';
  const isV8dFamily = isV8d || isV8f || isV8g || isV8h || isV8i || isV8j;
  const scoreState = getScoreState(input.score);
  const totalGoals = getTotalGoals(input.score);
  const marketLine = getMarketLine(canonicalMarket);
  const minuteBand = getMinuteBand(input.minute);
  const evidenceMode = String(input.evidenceMode ?? '').trim() || 'unknown';
  const breakEvenRate = Number.isFinite(input.breakEvenRate)
    ? Number(input.breakEvenRate)
    : (input.odds != null && input.odds > 0 ? 1 / input.odds : null);
  const directionalGate = input.directionalWin ?? true;
  const isGoalLess = totalGoals === 0;
  const lateGameDirectionalOverride = minuteBand === '75+'
    && scoreState === 'one-goal-margin'
    && evidenceMode === 'full_live_data';
  const applyPromptImprovementSpec = isV10g;

  const block = (warning: string) => {
    blocked = true;
    warnings.push(warning);
  };

  // Prompt-improvement spec rule #5: unresolved markets are a hard stop.
  if (!canonicalMarket || canonicalMarket === 'unknown') {
    block('MARKET_UNRESOLVED');
    return { blocked, warnings, confidence, stakePercent };
  }

  if (applyPromptImprovementSpec) {
    // Prompt-improvement spec rule #4 + #6: tighten global push requirements with late-game relaxation.
    const requiredBreakEvenMax = config.policyRequiredBreakEvenMax;
    const highRiskBreakEvenMax = config.policyHighRiskBreakEvenMax;
    const lateRelaxation = minuteBand === '75+' ? config.policyLateGameBreakEvenRelaxation : 0;
    const effectiveRequiredBreakEven = requiredBreakEvenMax + lateRelaxation;
    const effectiveHighRiskBreakEven = highRiskBreakEvenMax + lateRelaxation;
    const directionalSatisfied = lateGameDirectionalOverride ? true : directionalGate === true;
    const shouldEnforcePushRequirements =
      input.evidenceMode != null
      || input.breakEvenRate != null
      || input.directionalWin != null;
    const requiredConditionsMet = (
      evidenceMode === 'full_live_data'
      && directionalSatisfied
      && breakEvenRate != null
      && breakEvenRate < effectiveRequiredBreakEven
    );
    if (shouldEnforcePushRequirements && !requiredConditionsMet) {
      block('REQUIRED_CONDITIONS_NOT_MET');
    }

    if (
      shouldEnforcePushRequirements
      && HIGH_RISK_MARKETS.has(canonicalMarket)
      && (breakEvenRate == null || breakEvenRate >= effectiveHighRiskBreakEven)
    ) {
      block('HIGH_RISK_MARKET_BREAKEVEN_TOO_HIGH');
    }

    // Prompt-improvement spec rule #1: BTTS No hard safety gates.
    if (canonicalMarket === 'btts_no') {
      if (scoreState === 'two-plus-margin' && minuteBand === '75+') {
        // Allow this specific pocket.
      } else if (scoreState === 'one-goal-margin' || scoreState === 'two-plus-margin') {
        block('BTTS_NO_BLOCKED_GOAL_MARGIN');
      } else if (isGoalLess && (minuteBand === '45-59' || minuteBand === '60-74')) {
        block('BTTS_NO_BLOCKED_MIDGAME_GOALLESS');
      } else if (
        isGoalLess
        && (minuteBand === '00-29' || minuteBand === '30-44')
        && evidenceMode === 'full_live_data'
      ) {
        // Allow early 0-0 BTTS No with full evidence.
      } else {
        block('BTTS_NO_INSUFFICIENT_CONDITIONS');
      }
    }

    // Prompt-improvement spec rule #2: market blacklist in 45-74 volatility window.
    if (
      MIDGAME_BLACKLISTED_MARKETS.has(canonicalMarket)
      && (minuteBand === '45-59' || minuteBand === '60-74')
    ) {
      block('MARKET_BLACKLISTED_FOR_MIDGAME_WINDOW');
    }
    if (canonicalMarket === 'over_1.5' && minuteBand === '60-74') {
      block('OVER_1_5_BLOCKED_LATE_MIDGAME');
    }

    // Prompt-improvement spec rule #3: dangerous score/minute combinations.
    if (scoreState === 'two-plus-margin' && minuteBand === '45-59') {
      block('HIGH_MARGIN_MIDGAME_BLOCK');
    }
    if (scoreState === 'one-goal-margin' && minuteBand === '30-44') {
      const strictOk = evidenceMode === 'full_live_data'
        && breakEvenRate != null
        && breakEvenRate < 0.48
        && directionalSatisfied;
      if (!strictOk) {
        block('ONE_GOAL_MIDGAME_INSUFFICIENT_CONFIDENCE');
      }
    }
    if ((isGoalLess || scoreState === 'two-plus-margin') && minuteBand === '60-74') {
      const strictOk = evidenceMode === 'full_live_data'
        && breakEvenRate != null
        && breakEvenRate < 0.48;
      if (!strictOk) {
        block('LATE_MIDGAME_INSUFFICIENT_CONFIDENCE');
      }
    }
  }

  if (input.segmentBlocklist?.size) {
    const segKey = buildRecommendationSegmentKey(input.minute, canonicalMarket);
    if (input.segmentBlocklist.has(segKey)) {
      block('POLICY_BLOCK_SEGMENT_BLOCKLIST');
    }
  }

  if (canonicalMarket === '1x2_draw') {
    block('POLICY_BLOCK_1X2_DRAW');
  }

  if (canonicalMarket === '1x2_home' && input.minute < (isV8dFamily ? 35 : isV8b ? 55 : isV8 ? 60 : 75)) {
    block(
      isV8dFamily
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
    isV8dFamily
    && canonicalMarket.startsWith('under_')
    && !canonicalMarket.startsWith('under_0.5')
    && input.minute >= 45
    && input.minute <= 59
    && scoreState === 'two-plus-margin'
  ) {
    block('POLICY_BLOCK_GOALS_UNDER_45_59_TWO_PLUS_MARGIN_V8D');
  }

  if (
    (isV8f || isV8g || isV8h || isV8i || isV8j)
    && canonicalMarket.startsWith('under_')
    && !canonicalMarket.startsWith('under_0.5')
    && input.minute >= 30
    && input.minute <= 44
    && totalGoals === 0
    && marketLine != null
    && marketLine > 1.5
  ) {
    block('POLICY_BLOCK_GOALS_UNDER_30_44_0_0_OVER_1_5_V8F');
  }

  if (
    (isV8f || isV8g || isV8h || isV8i || isV8j)
    && canonicalMarket.startsWith('under_')
    && !canonicalMarket.startsWith('under_0.5')
    && input.minute >= 30
    && input.minute <= 44
    && scoreState === 'level'
    && (totalGoals ?? 0) >= 2
    && marketLine != null
    && marketLine > 4
  ) {
    block('POLICY_BLOCK_GOALS_UNDER_30_44_LEVEL_HIGH_LINE_V8F');
  }

  if (
    (isV8f || isV8g || isV8h || isV8i || isV8j)
    && canonicalMarket.startsWith('corners_over_')
    && input.minute < 60
    && marketLine != null
    && marketLine >= 12.5
  ) {
    block('POLICY_BLOCK_CORNERS_OVER_HIGH_LINE_PRE60_V8F');
  }

  if (
    isV10c
    && canonicalMarket.startsWith('corners_over_')
    && input.minute < 30
    && marketLine != null
    && marketLine >= 11.5
  ) {
    block('POLICY_BLOCK_CORNERS_OVER_HIGH_LINE_PRE30_V10C');
  }

  if (
    isV10c
    && canonicalMarket.startsWith('corners_under_')
    && input.minute < 30
    && marketLine != null
    && marketLine >= 9
  ) {
    block('POLICY_BLOCK_CORNERS_UNDER_EARLY_HIGH_LINE_V10C');
  }

  if (
    (isV8g || isV8h || isV8i || isV8j)
    && canonicalMarket.startsWith('under_')
    && !canonicalMarket.startsWith('under_0.5')
    && input.minute <= 44
    && scoreState === 'one-goal-margin'
    && marketLine != null
    && marketLine >= 2.75
  ) {
    block('POLICY_BLOCK_GOALS_UNDER_EARLY_ONE_GOAL_HIGH_LINE_V8G');
  }

  if (
    (isV8h || isV8i || isV8j)
    && canonicalMarket.startsWith('under_')
    && !canonicalMarket.startsWith('under_0.5')
    && input.minute >= 45
    && input.minute <= 59
    && totalGoals === 0
    && marketLine != null
    && marketLine <= 1.75
  ) {
    block('POLICY_BLOCK_GOALS_UNDER_45_59_0_0_LOW_LINE_V8H');
  }

  if (
    (isV8h || isV8i || isV8j)
    && canonicalMarket.startsWith('over_')
    && input.minute >= 45
    && input.minute <= 59
    && totalGoals === 0
    && marketLine != null
    && marketLine <= 1
  ) {
    block('POLICY_BLOCK_GOALS_OVER_45_59_0_0_LOW_LINE_V8H');
  }

  if (
    (isV8h || isV8i || isV8j)
    && canonicalMarket.startsWith('corners_over_')
    && input.minute >= 45
    && input.minute <= 59
    && scoreState === 'one-goal-margin'
    && marketLine != null
    && marketLine >= 10
  ) {
    block('POLICY_BLOCK_CORNERS_OVER_45_59_ONE_GOAL_HIGH_LINE_V8H');
  }

  const inPropsHotZoneV8j =
    isV8j
    && ((input.minute >= 30 && input.minute <= 44) || (input.minute >= 53 && input.minute <= 59));
  const propsHotZoneMinEdge =
    input.minute >= 37 && input.minute <= 44 ? 8 : 7;

  if (
    inPropsHotZoneV8j
    && (canonicalMarket.startsWith('corners_') || canonicalMarket === 'btts_yes')
  ) {
    if (input.valuePercent < propsHotZoneMinEdge) {
      block('POLICY_BLOCK_PROPS_HOT_ZONE_LOW_EDGE_V8J');
    }
    if (input.confidence < 8) {
      block('POLICY_BLOCK_PROPS_HOT_ZONE_LOW_CONFIDENCE_V8J');
    }
  }

  if (canonicalMarket === 'btts_no') {
    if (isV10c && input.minute < 60) {
      block('POLICY_BLOCK_BTTS_NO_PRE60_V10C');
    }
    if (input.minute >= 60 && input.minute < 75) {
      block('POLICY_BLOCK_BTTS_NO_60_74');
    }
    if (input.odds != null && input.odds < BTTS_NO_MIN_ODDS) {
      block('POLICY_BLOCK_BTTS_NO_LOW_PRICE');
    }
    if (input.odds != null && input.odds >= BTTS_NO_MAX_ODDS) {
      block('POLICY_BLOCK_BTTS_NO_HIGH_PRICE');
    }
    let minBttsNoEdge = BTTS_NO_MIN_EDGE;
    if (isV8j) {
      minBttsNoEdge = Math.max(minBttsNoEdge, 6);
      if (input.minute >= 37 && input.minute <= 44) {
        minBttsNoEdge = Math.max(minBttsNoEdge, 8);
      } else if ((input.minute >= 30 && input.minute <= 44) || (input.minute >= 53 && input.minute <= 59)) {
        minBttsNoEdge = Math.max(minBttsNoEdge, 7);
      }
    }
    if (input.valuePercent < minBttsNoEdge) {
      block(
        minBttsNoEdge > BTTS_NO_MIN_EDGE
          ? 'POLICY_BLOCK_BTTS_NO_LOW_EDGE_V8J'
          : 'POLICY_BLOCK_BTTS_NO_LOW_EDGE',
      );
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

  if (
    (isV10c || isV10g)
    && canonicalMarket === 'btts_yes'
    && input.minute >= 30
    && input.minute <= 59
  ) {
    const homeShotsOnTarget = parseStatInt(input.statsCompact?.shots_on_target?.home);
    const awayShotsOnTarget = parseStatInt(input.statsCompact?.shots_on_target?.away);
    if ((homeShotsOnTarget ?? 0) < 2 || (awayShotsOnTarget ?? 0) < 2) {
      block(
        isV10g && input.minute <= 44 && scoreState === 'one-goal-margin'
          ? 'POLICY_BLOCK_BTTS_YES_30_44_ONE_GOAL_LOW_DUAL_THREAT_V10G'
          : 'POLICY_BLOCK_BTTS_YES_MIDGAME_LOW_DUAL_THREAT_V10C',
      );
    }
  }

  if (
    isV10d
    && canonicalMarket.startsWith('corners_under_')
    && input.minute >= 45
    && input.minute <= 59
    && scoreState === 'one-goal-margin'
    && marketLine != null
    && marketLine <= 6.5
  ) {
    block('POLICY_BLOCK_CORNERS_UNDER_45_59_ONE_GOAL_LOW_LINE_V10D');
  }

  if (
    isV10d
    && canonicalMarket.startsWith('corners_over_')
    && input.minute >= 45
    && input.minute <= 59
    && scoreState === 'one-goal-margin'
    && marketLine != null
    && marketLine >= 13.5
  ) {
    block('POLICY_BLOCK_CORNERS_OVER_45_59_ONE_GOAL_EXTREME_LINE_V10D');
  }

  if (
    isV10d
    && canonicalMarket.startsWith('over_')
    && scoreState === 'one-goal-margin'
    && marketLine != null
    && totalGoals != null
  ) {
    const runway = marketLine - totalGoals;
    if (input.minute < 30 && runway >= 2.25) {
      block('POLICY_BLOCK_GOALS_OVER_ONE_GOAL_EARLY_LONG_RUNWAY_V10D');
    }
    if (input.minute >= 30 && input.minute <= 44 && totalGoals >= 3 && runway >= 1.75) {
      block('POLICY_BLOCK_GOALS_OVER_ONE_GOAL_MID_LONG_RUNWAY_V10D');
    }
  }

  if (
    isV10d
    && canonicalMarket.startsWith('under_')
    && input.minute >= 45
    && input.minute <= 59
    && scoreState === 'two-plus-margin'
    && marketLine != null
    && totalGoals != null
    && marketLine <= totalGoals + 1
  ) {
    block('POLICY_BLOCK_GOALS_UNDER_45_59_TWO_PLUS_LOW_CUSHION_V10D');
  }

  if (
    isV10e
    && canonicalMarket.startsWith('corners_under_')
    && input.minute >= 45
    && input.minute <= 59
    && scoreState === 'one-goal-margin'
    && marketLine != null
    && marketLine <= 6.5
  ) {
    block('POLICY_BLOCK_CORNERS_UNDER_45_59_ONE_GOAL_LOW_LINE_V10E');
  }

  if (
    isV10e
    && canonicalMarket.startsWith('corners_over_')
    && input.minute >= 45
    && input.minute <= 59
    && scoreState === 'one-goal-margin'
    && marketLine != null
    && marketLine >= 13.5
  ) {
    block('POLICY_BLOCK_CORNERS_OVER_45_59_ONE_GOAL_EXTREME_LINE_V10E');
  }

  if (
    isV10f
    && canonicalMarket.startsWith('corners_under_')
    && input.minute >= 45
    && input.minute <= 59
    && marketLine != null
    && marketLine <= 6.5
    && (totalGoals ?? 0) >= 1
    && (scoreState === 'level' || scoreState === 'one-goal-margin')
  ) {
    block('POLICY_BLOCK_CORNERS_UNDER_45_59_LOW_LINE_CHASE_V10F');
  }

  if (
    isV10g
    && canonicalMarket.startsWith('corners_under_')
    && input.minute >= 30
    && input.minute <= 44
    && marketLine != null
    && marketLine <= 8
    && (totalGoals ?? 0) >= 1
  ) {
    block('POLICY_BLOCK_CORNERS_UNDER_30_44_GOALS_ON_BOARD_LOW_LINE_V10G');
  }

  if (
    isV10g
    && canonicalMarket.startsWith('corners_under_')
    && input.minute >= 30
    && input.minute <= 44
    && marketLine != null
    && marketLine <= 8
  ) {
    if (String(input.prematchStrength ?? '').trim() === 'weak') {
      block('POLICY_BLOCK_CORNERS_UNDER_30_44_WEAK_PREMATCH_V10G');
    }
  }

  if (
    isV10g
    && canonicalMarket.startsWith('over_')
    && input.minute >= 30
    && input.minute <= 44
    && scoreState === 'one-goal-margin'
    && marketLine != null
    && marketLine >= 4.5
  ) {
    block('POLICY_BLOCK_GOALS_OVER_30_44_ONE_GOAL_EXTREME_RUNWAY_V10G');
  }

  // ── Global guards (all prompt versions) — informed by recent settlement loss mix ──
  const ahHomeLine = getAsianHandicapHomeLine(canonicalMarket);
  if (
    canonicalMarket.startsWith('ht_under_')
    && marketLine != null
    && marketLine <= 1.5
  ) {
    if (input.minute < 22) {
      block('POLICY_BLOCK_HT_UNDER_TIGHT_PRE22_GLOBAL');
    } else if (totalGoals != null && totalGoals >= 1 && input.minute <= 38) {
      block('POLICY_BLOCK_HT_UNDER_TIGHT_AFTER_EARLY_GOAL_GLOBAL');
    } else if (input.confidence < 8 || input.valuePercent < 7) {
      block('POLICY_BLOCK_HT_UNDER_TIGHT_LOW_SIGNAL_GLOBAL');
    }
  }

  if (canonicalMarket === 'btts_yes') {
    if (
      scoreState === 'one-goal-margin'
      && input.minute >= 12
      && input.minute < 82
      && totalGoals != null
      && totalGoals >= 1
    ) {
      const m = String(input.score || '').trim().match(/^(\d+)\s*[-:]\s*(\d+)$/);
      if (m) {
        const h = Number(m[1] ?? 0);
        const a = Number(m[2] ?? 0);
        if (h === 0 || a === 0) {
          block('POLICY_BLOCK_BTTS_YES_ONE_SIDE_BLANK_GLOBAL');
        }
      }
    }
    if (input.minute >= 28) {
      const homeShotsOnTarget = parseStatInt(input.statsCompact?.shots_on_target?.home);
      const awayShotsOnTarget = parseStatInt(input.statsCompact?.shots_on_target?.away);
      const haveBoth = homeShotsOnTarget != null && awayShotsOnTarget != null;
      if (haveBoth && (homeShotsOnTarget < 2 || awayShotsOnTarget < 2)) {
        block('POLICY_BLOCK_BTTS_YES_LOW_DUAL_THREAT_GLOBAL');
      }
    }
  }

  if (ahHomeLine != null && ahHomeLine <= -0.5) {
    if (input.confidence < 8 || input.valuePercent < 7) {
      block('POLICY_BLOCK_AH_HOME_CHALK_LOW_SIGNAL_GLOBAL');
    }
  } else if (ahHomeLine != null && ahHomeLine <= -0.25 && ahHomeLine > -0.5) {
    if (input.minute < 50 && scoreState === 'level' && (totalGoals ?? 0) === 0) {
      if (input.confidence < 8 || input.valuePercent < 7) {
        block('POLICY_BLOCK_AH_HOME_QUARTER_BALL_EARLY_0_0_GLOBAL');
      }
    }
  }

  if (canonicalMarket.startsWith('corners_under_') && marketLine != null) {
    if (
      input.minute >= 35
      && input.minute <= 52
      && (totalGoals ?? 0) >= 2
      && marketLine <= 7.5
    ) {
      block('POLICY_BLOCK_CORNERS_UNDER_MIDGAME_GOALS_GLOBAL');
    }
    if (
      input.minute >= 40
      && input.minute <= 59
      && marketLine <= 6.5
      && scoreState === 'one-goal-margin'
    ) {
      block('POLICY_BLOCK_CORNERS_UNDER_LATE_ONE_GOAL_LOW_LINE_GLOBAL');
    }
  }

  const risk = String(input.riskLevel ?? '').trim().toUpperCase();
  if (risk === 'MEDIUM') {
    const thinEdge =
      input.valuePercent > 0
      && input.valuePercent < 7
      && canonicalMarket !== 'btts_no';
    if (thinEdge) {
      block('POLICY_BLOCK_MEDIUM_RISK_THIN_EDGE_GLOBAL');
    } else if (!blocked && stakePercent > 2.5) {
      const prev = stakePercent;
      stakePercent = Math.min(Number(stakePercent) || 0, 2.5);
      if (stakePercent < prev) {
        warnings.push('POLICY_CAP_MEDIUM_RISK_STAKE_GLOBAL');
      }
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

    if (
      isV10f
      && canonicalMarket.startsWith('under_')
      && input.minute >= 45
      && input.minute <= 59
      && scoreState === 'two-plus-margin'
      && marketLine != null
      && sameThesisRows.some((row) => {
        const previousCanonical = normalizeMarket(row.selection ?? '', row.bet_market ?? '');
        if (!previousCanonical.startsWith('under_') || previousCanonical.startsWith('under_0.5')) return false;
        const previousLine = getMarketLine(previousCanonical);
        return previousLine != null && previousLine < marketLine;
      })
    ) {
      block('POLICY_BLOCK_GOALS_UNDER_45_59_TWO_PLUS_SAME_THESIS_ROLLOVER_V10F');
    }
  }

  if (!blocked && input.segmentStakeCaps?.size) {
    const segKey = buildRecommendationSegmentKey(input.minute, canonicalMarket);
    const cap = input.segmentStakeCaps.get(segKey);
    if (cap != null && Number.isFinite(cap) && cap >= 0) {
      const prev = stakePercent;
      stakePercent = Math.min(Number(stakePercent) || 0, cap);
      if (stakePercent < prev) {
        warnings.push('POLICY_WARN_SEGMENT_STAKE_CAP');
      }
    }
  }

  return {
    blocked,
    warnings,
    confidence,
    stakePercent,
  };
}
