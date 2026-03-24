export type PrematchFeatureAvailability = 'full' | 'partial' | 'minimal' | 'none';
export type PrematchFeatureSourceQuality = 'high' | 'medium' | 'low' | 'unknown';
export type PrematchCompetitionType =
  | 'domestic_league'
  | 'domestic_cup'
  | 'european'
  | 'international'
  | 'friendly'
  | 'unknown';
export type PrematchPriorStrength = 'strong' | 'moderate' | 'weak' | 'none';

export interface PrematchExpertFeaturesV1 {
  version: 1;
  meta: {
    availability: PrematchFeatureAvailability;
    source_quality: PrematchFeatureSourceQuality;
    competition_type: PrematchCompetitionType;
    prediction_fallback_used: boolean;
    trusted_source_count: number;
    rejected_source_count: number;
    top_league: boolean | null;
  };
  strength_delta: {
    recent_points_delta: number | null;
    attack_form_delta: number | null;
    defense_form_delta: number | null;
    venue_attack_delta: number | null;
    provider_strength_delta: number | null;
  };
  goal_environment: {
    league_avg_goals: number | null;
    league_over_2_5_rate: number | null;
    league_btts_rate: number | null;
    over_tendency_score: number | null;
    btts_tendency_score: number | null;
    clean_sheet_suppression_score: number | null;
    projected_goal_environment_score: number | null;
  };
  market_priors: {
    one_x2_bias_score: number | null;
    asian_handicap_bias_score: number | null;
    totals_bias_score: number | null;
    btts_bias_score: number | null;
    data_reliability_tier: 'low' | 'medium' | 'high' | null;
    volatility_tier: 'low' | 'medium' | 'high' | null;
  };
  squad_situation: {
    schedule_stress_delta: number | null;
    absence_severity_home: number | null;
    absence_severity_away: number | null;
    motivation_delta: number | null;
    net_squad_stability_score: number | null;
  };
  trust_and_coverage: {
    strategic_quant_fields_present: number;
    league_profile_fields_present: number;
    prediction_fields_present: number;
    team_profile_fields_present: number;
    has_cross_league_position_risk: boolean;
    has_prediction_model_dependency: boolean;
    has_low_reliability_warning: boolean;
    prematch_confidence_cap: number | null;
    prematch_noise_penalty: number | null;
  };
  optional_team_profile: {
    home_style_matchup_score: number | null;
    away_style_matchup_score: number | null;
    pressing_mismatch_score: number | null;
    set_piece_edge_home: number | null;
    set_piece_edge_away: number | null;
    first_goal_edge_score: number | null;
    late_goal_profile_score: number | null;
  } | null;
}

export interface BuildPrematchExpertFeaturesV1Input {
  strategicContext?: Record<string, unknown> | null;
  leagueProfile?: Record<string, unknown> | null;
  prediction?: Record<string, unknown> | null;
  homeTeamProfile?: Record<string, unknown> | null;
  awayTeamProfile?: Record<string, unknown> | null;
  topLeague?: boolean | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function unwrapProfileRecord(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  if (!record) return null;
  const nested = asRecord(record.profile);
  if (!nested) return record;
  return {
    ...nested,
    notes_en: record.notes_en,
    notes_vi: record.notes_vi,
    data_reliability_tier: nested.data_reliability_tier ?? record.data_reliability_tier,
    volatility_tier: nested.volatility_tier ?? record.volatility_tier,
    home_advantage_tier: nested.home_advantage_tier ?? record.home_advantage_tier,
  };
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/%/g, '').replace(/,/g, '.');
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function toRate01(value: unknown): number | null {
  const numeric = toNumber(value);
  if (numeric == null) return null;
  if (numeric >= 0 && numeric <= 1) return numeric;
  if (numeric >= 0 && numeric <= 100) return numeric / 100;
  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number | null): number | null {
  return value == null ? null : Math.round(value);
}

function scaleSigned(value: number | null, maxAbs: number): number | null {
  if (value == null || maxAbs <= 0) return null;
  return round((clamp(value, -maxAbs, maxAbs) / maxAbs) * 100);
}

function average(values: Array<number | null | undefined>): number | null {
  const present = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (present.length === 0) return null;
  return present.reduce((sum, value) => sum + value, 0) / present.length;
}

function normalizeTier(value: unknown): 'low' | 'medium' | 'high' | null {
  const raw = String(value ?? '').trim().toLowerCase();
  if (raw === 'high' || raw === 'strong' || raw === 'deep' || raw === 'consistent') return 'high';
  if (raw === 'medium' || raw === 'balanced' || raw === 'normal' || raw === 'mixed' || raw === 'inconsistent') return 'medium';
  if (raw === 'low' || raw === 'weak' || raw === 'shallow' || raw === 'volatile') return 'low';
  return null;
}

function tierToScore(value: unknown): number | null {
  const tier = normalizeTier(value);
  if (tier === 'high') return 70;
  if (tier === 'medium') return 35;
  if (tier === 'low') return 10;
  return null;
}

function tierToCenteredScore(value: unknown): number | null {
  const tier = normalizeTier(value);
  if (tier === 'high') return 45;
  if (tier === 'medium') return 0;
  if (tier === 'low') return -45;
  return null;
}

function scoreRateEnvironment(rate: number | null): number | null {
  if (rate == null) return null;
  return round(((clamp(rate, 0, 1) - 0.5) / 0.5) * 100);
}

function scoreGoalsAverage(avgGoals: number | null): number | null {
  if (avgGoals == null) return null;
  return round((clamp(avgGoals, 1.2, 4) - 2.6) / 1.4 * 100);
}

function scoreGoalsConcededAverage(avgGoalsConceded: number | null): number | null {
  if (avgGoalsConceded == null) return null;
  const clamped = clamp(avgGoalsConceded, 0.4, 2.6);
  return round(((1.5 - clamped) / 1.1) * 100);
}

function scoreCornersAverage(avgCorners: number | null): number | null {
  if (avgCorners == null) return null;
  return round(((clamp(avgCorners, 6, 13) - 9.5) / 3.5) * 100);
}

function scoreCardsAverage(avgCards: number | null): number | null {
  if (avgCards == null) return null;
  return round(((clamp(avgCards, 2, 6) - 3.5) / 2.5) * 100);
}

function deltaFromScores(home: number | null, away: number | null): number | null {
  if (home == null || away == null) return null;
  return scaleSigned(home - away, 100);
}

function countPresent(record: Record<string, unknown> | null, keys?: string[]): number {
  if (!record) return 0;
  const entries = keys
    ? keys.map((key) => [key, record[key]] as const)
    : Object.entries(record);
  return entries.filter(([, value]) => {
    if (value == null) return false;
    if (typeof value === 'string') return value.trim() !== '';
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value === 'boolean') return true;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
    return false;
  }).length;
}

function cleanText(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function getStrategicValue(strategicContext: Record<string, unknown> | null, key: string): unknown {
  if (!strategicContext) return null;
  if (strategicContext[key] != null) return strategicContext[key];

  const qualitative = asRecord(strategicContext.qualitative);
  const en = asRecord(qualitative?.en);
  if (en?.[key] != null) return en[key];

  const vi = asRecord(qualitative?.vi);
  if (vi?.[key] != null) return vi[key];

  return null;
}

function narrativeScore(text: unknown, dictionary: Array<{ pattern: RegExp; score: number }>): number | null {
  const normalized = cleanText(text);
  if (!normalized) return null;
  const matches = dictionary.filter((entry) => entry.pattern.test(normalized));
  if (matches.length === 0) return null;
  return round(matches.reduce((sum, entry) => sum + entry.score, 0) / matches.length);
}

const MOTIVATION_DICT = [
  { pattern: /title race|must win|need points|relegation|promotion|qualif|dua vo dich|dua tru hang|can diem|bat buoc thang|top chau au/, score: 75 },
  { pattern: /still chasing|fighting survival|dua top|con muc tieu|playoff|tranh suat/, score: 55 },
  { pattern: /nothing to play|already safe|dead rubber|giao huu|het muc tieu|an toan tru hang/, score: 15 },
];

const ABSENCE_DICT = [
  { pattern: /missing two|missing three|several absences|star player out|mat hai|mat ba|vang nhieu|thieu nhieu/, score: 70 },
  { pattern: /missing a starting|key absence|mat .* chinh|vang tru cot|mat trung ve chinh/, score: 50 },
  { pattern: /no major absences|full squad|khong co vang mat dang ke|day du luc luong/, score: 10 },
];

const SCHEDULE_DICT = [
  { pattern: /three days|2 days|cup semifinal|continental|fixture congestion|da cup sau ba ngay|lich thi dau day|mat do lich/, score: 65 },
  { pattern: /four days|moderate congestion|lich kha day/, score: 40 },
  { pattern: /no notable congestion|rested|khong dang ke|duoc nghi/, score: 10 },
];

function normalizeCompetitionType(value: unknown): PrematchCompetitionType {
  const raw = cleanText(value);
  if (
    raw === 'domestic_league'
    || raw === 'domestic_cup'
    || raw === 'european'
    || raw === 'international'
    || raw === 'friendly'
  ) {
    return raw;
  }
  return 'unknown';
}

function extractPredictionStrengthDelta(prediction: Record<string, unknown> | null): number | null {
  if (!prediction) return null;
  const comparison = asRecord(prediction.comparison);
  if (!comparison) return null;
  const total = asRecord(comparison.total);
  const form = asRecord(comparison.form);
  const totalDelta = total
    ? scaleSigned((toNumber(total.home) ?? 0) - (toNumber(total.away) ?? 0), 100)
    : null;
  const formDelta = form
    ? scaleSigned((toNumber(form.home) ?? 0) - (toNumber(form.away) ?? 0), 100)
    : null;
  return round(average([totalDelta, formDelta]));
}

function computeAvailability(totalFields: number): PrematchFeatureAvailability {
  if (totalFields >= 18) return 'full';
  if (totalFields >= 10) return 'partial';
  if (totalFields >= 3) return 'minimal';
  return 'none';
}

function computeSourceQuality(
  strategicContext: Record<string, unknown> | null,
  leagueProfile: Record<string, unknown> | null,
  homeTeamProfile: Record<string, unknown> | null,
  awayTeamProfile: Record<string, unknown> | null,
): PrematchFeatureSourceQuality {
  const strategicMeta = asRecord(strategicContext?.source_meta);
  const searchQuality = cleanText(strategicMeta?.search_quality);
  if (searchQuality === 'high' || searchQuality === 'medium' || searchQuality === 'low') {
    return searchQuality;
  }

  const reliabilityScores = [
    normalizeTier(leagueProfile?.data_reliability_tier),
    normalizeTier(homeTeamProfile?.data_reliability_tier),
    normalizeTier(awayTeamProfile?.data_reliability_tier),
  ];
  if (reliabilityScores.includes('high')) return 'high';
  if (reliabilityScores.includes('medium')) return 'medium';
  if (reliabilityScores.includes('low')) return 'low';
  return 'unknown';
}

export function buildPrematchExpertFeaturesV1(
  input: BuildPrematchExpertFeaturesV1Input,
): PrematchExpertFeaturesV1 | null {
  const strategicContext = asRecord(input.strategicContext);
  const leagueProfile = unwrapProfileRecord(input.leagueProfile);
  const prediction = asRecord(input.prediction);
  const homeTeamProfile = unwrapProfileRecord(input.homeTeamProfile);
  const awayTeamProfile = unwrapProfileRecord(input.awayTeamProfile);
  const strategicQuant = asRecord(strategicContext?.quantitative);
  const strategicMeta = asRecord(strategicContext?.source_meta);

  const strategicQuantFieldsPresent = countPresent(strategicQuant);
  const leagueProfileFieldsPresent = countPresent(leagueProfile, [
    'avg_goals',
    'over_2_5_rate',
    'btts_rate',
    'late_goal_rate_75_plus',
    'avg_corners',
    'avg_cards',
    'home_advantage_tier',
    'volatility_tier',
    'data_reliability_tier',
  ]);
  const predictionFieldsPresent = countPresent(prediction, ['predictions', 'comparison', 'h2h_summary', 'team_form']);
  const teamProfileFieldsPresent = countPresent(homeTeamProfile) + countPresent(awayTeamProfile);
  const totalFieldsPresent = strategicQuantFieldsPresent + leagueProfileFieldsPresent + predictionFieldsPresent + teamProfileFieldsPresent;
  const availability = computeAvailability(totalFieldsPresent);
  if (availability === 'none') return null;

  const competitionType = normalizeCompetitionType(strategicContext?.competition_type);
  const sourceQuality = computeSourceQuality(strategicContext, leagueProfile, homeTeamProfile, awayTeamProfile);
  const predictionFallbackUsed = strategicMeta?.prediction_fallback_used === true;

  const homeLast5Points = toNumber(strategicQuant?.home_last5_points);
  const awayLast5Points = toNumber(strategicQuant?.away_last5_points);
  const homeGoalsFor = toNumber(strategicQuant?.home_last5_goals_for);
  const awayGoalsFor = toNumber(strategicQuant?.away_last5_goals_for);
  const homeGoalsAgainst = toNumber(strategicQuant?.home_last5_goals_against);
  const awayGoalsAgainst = toNumber(strategicQuant?.away_last5_goals_against);
  const homeHomeGoalsAvg = toNumber(strategicQuant?.home_home_goals_avg);
  const awayAwayGoalsAvg = toNumber(strategicQuant?.away_away_goals_avg);
  const providerStrengthDelta = extractPredictionStrengthDelta(prediction);
  const leagueAvgCorners = toNumber(leagueProfile?.avg_corners);
  const leagueAvgCards = toNumber(leagueProfile?.avg_cards);

  const homeProfileGoalsScored = toNumber(homeTeamProfile?.avg_goals_scored);
  const awayProfileGoalsScored = toNumber(awayTeamProfile?.avg_goals_scored);
  const homeProfileGoalsConceded = toNumber(homeTeamProfile?.avg_goals_conceded);
  const awayProfileGoalsConceded = toNumber(awayTeamProfile?.avg_goals_conceded);
  const homeProfileOver25Rate = toRate01(homeTeamProfile?.over_2_5_rate);
  const awayProfileOver25Rate = toRate01(awayTeamProfile?.over_2_5_rate);
  const homeProfileBttsRate = toRate01(homeTeamProfile?.btts_rate);
  const awayProfileBttsRate = toRate01(awayTeamProfile?.btts_rate);
  const homeProfileCleanSheetRate = toRate01(homeTeamProfile?.clean_sheet_rate);
  const awayProfileCleanSheetRate = toRate01(awayTeamProfile?.clean_sheet_rate);
  const homeProfileCornersFor = toNumber(homeTeamProfile?.avg_corners_for);
  const awayProfileCornersFor = toNumber(awayTeamProfile?.avg_corners_for);
  const homeProfileCornersAgainst = toNumber(homeTeamProfile?.avg_corners_against);
  const awayProfileCornersAgainst = toNumber(awayTeamProfile?.avg_corners_against);
  const homeProfileCards = toNumber(homeTeamProfile?.avg_cards);
  const awayProfileCards = toNumber(awayTeamProfile?.avg_cards);
  const homeFirstGoalRate = toRate01(homeTeamProfile?.first_goal_rate);
  const awayFirstGoalRate = toRate01(awayTeamProfile?.first_goal_rate);

  const recentPointsDelta = scaleSigned(
    homeLast5Points != null && awayLast5Points != null ? homeLast5Points - awayLast5Points : null,
    15,
  );
  const attackFormDelta = scaleSigned(
    homeGoalsFor != null && awayGoalsFor != null ? homeGoalsFor - awayGoalsFor : null,
    10,
  );
  const defenseFormDelta = scaleSigned(
    homeGoalsAgainst != null && awayGoalsAgainst != null ? awayGoalsAgainst - homeGoalsAgainst : null,
    10,
  );
  const venueAttackDelta = scaleSigned(
    homeHomeGoalsAvg != null && awayAwayGoalsAvg != null ? homeHomeGoalsAvg - awayAwayGoalsAvg : null,
    2.5,
  );

  const leagueAvgGoals = toNumber(leagueProfile?.avg_goals);
  const leagueOver25Rate = toRate01(leagueProfile?.over_2_5_rate);
  const leagueBttsRate = toRate01(leagueProfile?.btts_rate);
  const homeOver25Rate = toRate01(strategicQuant?.home_over_2_5_rate_last10);
  const awayOver25Rate = toRate01(strategicQuant?.away_over_2_5_rate_last10);
  const homeBttsRate = toRate01(strategicQuant?.home_btts_rate_last10);
  const awayBttsRate = toRate01(strategicQuant?.away_btts_rate_last10);
  const homeCleanSheetRate = toRate01(strategicQuant?.home_clean_sheet_rate_last10);
  const awayCleanSheetRate = toRate01(strategicQuant?.away_clean_sheet_rate_last10);
  const profileOverTendencyScore = round(average([
    scoreRateEnvironment(homeProfileOver25Rate),
    scoreRateEnvironment(awayProfileOver25Rate),
  ]));
  const profileBttsTendencyScore = round(average([
    scoreRateEnvironment(homeProfileBttsRate),
    scoreRateEnvironment(awayProfileBttsRate),
  ]));
  const profileCleanSheetSuppressionScore = round(average([
    homeProfileCleanSheetRate != null ? scoreRateEnvironment(1 - homeProfileCleanSheetRate) : null,
    awayProfileCleanSheetRate != null ? scoreRateEnvironment(1 - awayProfileCleanSheetRate) : null,
  ]));
  const leagueCornersPressureScore = scoreCornersAverage(leagueAvgCorners);
  const leagueCardsVolatilityScore = scoreCardsAverage(leagueAvgCards);

  const overTendencyScore = round(average([
    scoreRateEnvironment(leagueOver25Rate),
    scoreRateEnvironment(homeOver25Rate),
    scoreRateEnvironment(awayOver25Rate),
    profileOverTendencyScore,
  ]));
  const bttsTendencyScore = round(average([
    scoreRateEnvironment(leagueBttsRate),
    scoreRateEnvironment(homeBttsRate),
    scoreRateEnvironment(awayBttsRate),
    profileBttsTendencyScore,
  ]));
  const cleanSheetSuppressionScore = round(average([
    homeCleanSheetRate != null ? scoreRateEnvironment(1 - homeCleanSheetRate) : null,
    awayCleanSheetRate != null ? scoreRateEnvironment(1 - awayCleanSheetRate) : null,
    profileCleanSheetSuppressionScore,
  ]));
  const projectedGoalEnvironmentScore = round(average([
    scoreGoalsAverage(leagueAvgGoals),
    overTendencyScore,
    bttsTendencyScore,
    cleanSheetSuppressionScore,
    leagueCornersPressureScore,
  ]));

  const motivationHome = narrativeScore(getStrategicValue(strategicContext, 'home_motivation'), MOTIVATION_DICT);
  const motivationAway = narrativeScore(getStrategicValue(strategicContext, 'away_motivation'), MOTIVATION_DICT);
  const motivationDelta = scaleSigned(
    motivationHome != null && motivationAway != null ? motivationHome - motivationAway : null,
    100,
  );
  const scheduleStressHome = narrativeScore(getStrategicValue(strategicContext, 'home_fixture_congestion'), SCHEDULE_DICT);
  const scheduleStressAway = narrativeScore(getStrategicValue(strategicContext, 'away_fixture_congestion'), SCHEDULE_DICT);
  const scheduleStressDelta = scaleSigned(
    scheduleStressHome != null && scheduleStressAway != null ? scheduleStressAway - scheduleStressHome : null,
    100,
  );
  const absenceSeverityHome = narrativeScore(getStrategicValue(strategicContext, 'home_key_absences'), ABSENCE_DICT);
  const absenceSeverityAway = narrativeScore(
    getStrategicValue(strategicContext, 'away_key_absences') ?? getStrategicValue(strategicContext, 'key_absences'),
    ABSENCE_DICT,
  );

  const volatilityTier = normalizeTier(leagueProfile?.volatility_tier);
  const dataReliabilityTier = normalizeTier(leagueProfile?.data_reliability_tier)
    ?? normalizeTier(homeTeamProfile?.data_reliability_tier)
    ?? normalizeTier(awayTeamProfile?.data_reliability_tier);
  const homeAdvantageScore = tierToCenteredScore(leagueProfile?.home_advantage_tier);
  const volatilityScore = tierToCenteredScore(leagueProfile?.volatility_tier);

  const homeAttackProfileScore = round(average([
    scoreGoalsAverage(homeProfileGoalsScored),
    scoreRateEnvironment(homeProfileOver25Rate),
    scoreCornersAverage(homeProfileCornersFor),
  ]));
  const awayAttackProfileScore = round(average([
    scoreGoalsAverage(awayProfileGoalsScored),
    scoreRateEnvironment(awayProfileOver25Rate),
    scoreCornersAverage(awayProfileCornersFor),
  ]));
  const homeDefenseProfileScore = round(average([
    scoreGoalsConcededAverage(homeProfileGoalsConceded),
    scoreRateEnvironment(homeProfileCleanSheetRate),
    awayProfileCornersFor != null && homeProfileCornersAgainst != null
      ? scaleSigned(awayProfileCornersFor - homeProfileCornersAgainst, 8)
      : null,
  ]));
  const awayDefenseProfileScore = round(average([
    scoreGoalsConcededAverage(awayProfileGoalsConceded),
    scoreRateEnvironment(awayProfileCleanSheetRate),
    homeProfileCornersFor != null && awayProfileCornersAgainst != null
      ? scaleSigned(homeProfileCornersFor - awayProfileCornersAgainst, 8)
      : null,
  ]));
  const homeConsistencyScore = tierToScore(homeTeamProfile?.form_consistency);
  const awayConsistencyScore = tierToScore(awayTeamProfile?.form_consistency);
  const homeDepthScore = tierToScore(homeTeamProfile?.squad_depth);
  const awayDepthScore = tierToScore(awayTeamProfile?.squad_depth);
  const homeStrengthScore = tierToScore(homeTeamProfile?.home_strength);
  const awayStrengthScore = tierToScore(awayTeamProfile?.home_strength);
  const homeStabilityScore = round(average([
    homeDefenseProfileScore,
    homeConsistencyScore,
    homeDepthScore,
    homeStrengthScore,
  ]));
  const awayStabilityScore = round(average([
    awayDefenseProfileScore,
    awayConsistencyScore,
    awayDepthScore,
    awayStrengthScore,
  ]));

  const oneX2BiasScore = round(average([
    recentPointsDelta,
    venueAttackDelta,
    providerStrengthDelta,
    deltaFromScores(homeAttackProfileScore, awayAttackProfileScore),
    deltaFromScores(homeStabilityScore, awayStabilityScore),
    homeAdvantageScore,
    motivationDelta,
  ]));
  const setPieceEdgeHome = tierToScore(homeTeamProfile?.set_piece_threat);
  const setPieceEdgeAway = tierToScore(awayTeamProfile?.set_piece_threat);
  const setPieceNetEdge = deltaFromScores(setPieceEdgeHome, setPieceEdgeAway);
  const firstGoalEdgeScore = scaleSigned(
    homeFirstGoalRate != null && awayFirstGoalRate != null
      ? homeFirstGoalRate - awayFirstGoalRate
      : null,
    1,
  );
  const asianHandicapBiasScore = round(average([
    recentPointsDelta,
    defenseFormDelta,
    providerStrengthDelta,
    deltaFromScores(homeAttackProfileScore, awayAttackProfileScore),
    deltaFromScores(homeStabilityScore, awayStabilityScore),
    setPieceNetEdge,
    firstGoalEdgeScore,
    homeAdvantageScore,
  ]));
  const totalsBiasScore = round(average([
    projectedGoalEnvironmentScore,
    profileOverTendencyScore,
    leagueCornersPressureScore,
    leagueCardsVolatilityScore,
    volatilityScore,
  ]));
  const bttsBiasScore = round(average([
    bttsTendencyScore,
    cleanSheetSuppressionScore,
    profileBttsTendencyScore,
  ]));

  const homeStyleMatchupScore = round(average([
    scaleSigned(
      homeProfileGoalsScored != null && awayProfileGoalsConceded != null
        ? homeProfileGoalsScored - awayProfileGoalsConceded
        : null,
      2.5,
    ),
    homeStrengthScore,
    scoreCornersAverage(homeProfileCornersFor),
  ]));
  const awayStyleMatchupScore = round(average([
    scaleSigned(
      awayProfileGoalsScored != null && homeProfileGoalsConceded != null
        ? awayProfileGoalsScored - homeProfileGoalsConceded
        : null,
      2.5,
    ),
    awayStrengthScore,
    scoreCornersAverage(awayProfileCornersFor),
  ]));
  const homePressingScore = tierToScore(homeTeamProfile?.pressing_intensity);
  const awayPressingScore = tierToScore(awayTeamProfile?.pressing_intensity);
  const pressingMismatchScore = homePressingScore != null && awayPressingScore != null
    ? Math.abs(homePressingScore - awayPressingScore)
    : null;
  const lateGoalProfileScore = round(average([
    scoreRateEnvironment(toRate01(homeTeamProfile?.late_goal_rate)),
    scoreRateEnvironment(toRate01(awayTeamProfile?.late_goal_rate)),
    scoreRateEnvironment(toRate01(leagueProfile?.late_goal_rate_75_plus)),
  ]));
  const quantitativeStabilityDelta = round(average([
    deltaFromScores(homeStabilityScore, awayStabilityScore),
    deltaFromScores(homeConsistencyScore, awayConsistencyScore),
    deltaFromScores(homeDepthScore, awayDepthScore),
    deltaFromScores(scoreCardsAverage(awayProfileCards), scoreCardsAverage(homeProfileCards)),
  ]));
  const netSquadStabilityScore = round(average([
    quantitativeStabilityDelta,
    motivationDelta,
    scheduleStressDelta,
    absenceSeverityHome != null ? -absenceSeverityHome : null,
    absenceSeverityAway,
  ]));

  const hasCrossLeaguePositionRisk = competitionType === 'european'
    || competitionType === 'international'
    || competitionType === 'friendly';
  const hasLowReliabilityWarning = sourceQuality === 'low'
    || sourceQuality === 'unknown'
    || dataReliabilityTier === 'low';

  const missingPenalty = clamp(100 - totalFieldsPresent * 4, 0, 60);
  const qualityPenalty = sourceQuality === 'high' ? 0 : sourceQuality === 'medium' ? 10 : 25;
  const crossLeaguePenalty = hasCrossLeaguePositionRisk ? 15 : 0;
  const predictionPenalty = predictionFallbackUsed ? 10 : 0;
  const reliabilityPenalty = dataReliabilityTier === 'high' ? 0 : dataReliabilityTier === 'medium' ? 10 : 25;
  const prematchNoisePenalty = clamp(
    missingPenalty + qualityPenalty + crossLeaguePenalty + predictionPenalty + reliabilityPenalty,
    0,
    100,
  );
  const prematchConfidenceCap = clamp(
    sourceQuality === 'high' ? 8 : sourceQuality === 'medium' ? 7 : 6,
    4,
    prematchNoisePenalty >= 60 ? 6 : 8,
  );

  return {
    version: 1,
    meta: {
      availability,
      source_quality: sourceQuality,
      competition_type: competitionType,
      prediction_fallback_used: predictionFallbackUsed,
      trusted_source_count: Number(strategicMeta?.trusted_source_count ?? 0),
      rejected_source_count: Number(strategicMeta?.rejected_source_count ?? 0),
      top_league: input.topLeague ?? null,
    },
    strength_delta: {
      recent_points_delta: recentPointsDelta,
      attack_form_delta: attackFormDelta,
      defense_form_delta: defenseFormDelta,
      venue_attack_delta: venueAttackDelta,
      provider_strength_delta: providerStrengthDelta,
    },
    goal_environment: {
      league_avg_goals: leagueAvgGoals,
      league_over_2_5_rate: leagueOver25Rate,
      league_btts_rate: leagueBttsRate,
      over_tendency_score: overTendencyScore,
      btts_tendency_score: bttsTendencyScore,
      clean_sheet_suppression_score: cleanSheetSuppressionScore,
      projected_goal_environment_score: projectedGoalEnvironmentScore,
    },
    market_priors: {
      one_x2_bias_score: oneX2BiasScore,
      asian_handicap_bias_score: asianHandicapBiasScore,
      totals_bias_score: totalsBiasScore,
      btts_bias_score: bttsBiasScore,
      data_reliability_tier: dataReliabilityTier,
      volatility_tier: volatilityTier,
    },
    squad_situation: {
      schedule_stress_delta: scheduleStressDelta,
      absence_severity_home: absenceSeverityHome,
      absence_severity_away: absenceSeverityAway,
      motivation_delta: motivationDelta,
      net_squad_stability_score: netSquadStabilityScore,
    },
    trust_and_coverage: {
      strategic_quant_fields_present: strategicQuantFieldsPresent,
      league_profile_fields_present: leagueProfileFieldsPresent,
      prediction_fields_present: predictionFieldsPresent,
      team_profile_fields_present: teamProfileFieldsPresent,
      has_cross_league_position_risk: hasCrossLeaguePositionRisk,
      has_prediction_model_dependency: predictionFallbackUsed || predictionFieldsPresent > 0,
      has_low_reliability_warning: hasLowReliabilityWarning,
      prematch_confidence_cap: prematchConfidenceCap,
      prematch_noise_penalty: prematchNoisePenalty,
    },
    optional_team_profile: teamProfileFieldsPresent > 0 ? {
      home_style_matchup_score: homeStyleMatchupScore,
      away_style_matchup_score: awayStyleMatchupScore,
      pressing_mismatch_score: pressingMismatchScore,
      set_piece_edge_home: setPieceEdgeHome,
      set_piece_edge_away: setPieceEdgeAway,
      first_goal_edge_score: firstGoalEdgeScore,
      late_goal_profile_score: lateGoalProfileScore,
    } : null,
  };
}

export function getPrematchPriorStrength(features: PrematchExpertFeaturesV1 | null): PrematchPriorStrength {
  if (!features) return 'none';

  const availabilityBase = features.meta.availability === 'full'
    ? 80
    : features.meta.availability === 'partial'
      ? 60
      : features.meta.availability === 'minimal'
        ? 35
        : 0;
  const sourceAdjustment = features.meta.source_quality === 'high'
    ? 10
    : features.meta.source_quality === 'medium'
      ? 0
      : features.meta.source_quality === 'low'
        ? -10
        : -15;
  const signalScore = availabilityBase - (features.trust_and_coverage.prematch_noise_penalty ?? 100) * 0.6 + sourceAdjustment;

  if (signalScore >= 55) return 'strong';
  if (signalScore >= 25) return 'moderate';
  return 'weak';
}