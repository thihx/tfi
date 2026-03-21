import { normalizeMarket } from './normalize-market.js';

export type PromptStatsSource = 'api-football' | 'live-score-api-fallback' | string;
export type PromptAnalysisMode = 'auto' | 'system_force' | 'manual_force';
export type PromptEvidenceMode =
  | 'full_live_data'
  | 'stats_only'
  | 'odds_events_only_degraded'
  | 'events_only_degraded'
  | 'low_evidence';

export const LIVE_ANALYSIS_PROMPT_VERSIONS = ['v4-evidence-hardened', 'v5-compact-a', 'v6-betting-discipline-a'] as const;
export type LiveAnalysisPromptVersion = (typeof LIVE_ANALYSIS_PROMPT_VERSIONS)[number];
export const LIVE_ANALYSIS_PROMPT_VERSION = 'v4-evidence-hardened';
export const LIVE_ANALYSIS_PROMPT_CANDIDATE_VERSION = 'v6-betting-discipline-a';

export function isLiveAnalysisPromptVersion(value: string): value is LiveAnalysisPromptVersion {
  return (LIVE_ANALYSIS_PROMPT_VERSIONS as readonly string[]).includes(value);
}

interface EvidenceTierRule {
  tier: 'tier_1' | 'tier_2' | 'tier_3' | 'tier_4';
  label: string;
  allowedMarkets: string;
  forbiddenMarkets: string;
  operationalRule: string;
}

interface TwoSideValue {
  home: string | number | null | undefined;
  away: string | number | null | undefined;
}

export interface LiveAnalysisPromptSettings {
  minConfidence: number;
  minOdds: number;
  latePhaseMinute: number;
  veryLatePhaseMinute: number;
  endgameMinute: number;
}

export interface LiveAnalysisPromptPreviousRecommendation {
  minute?: number | null;
  selection?: string | null;
  bet_market?: string | null;
  confidence?: number | null;
  odds?: number | null;
  stake_percent?: number | null;
  reasoning?: string | null;
  result?: string | null;
}

export interface LiveAnalysisMatchTimelineSnapshot {
  minute: number;
  score: string;
  possession: string;
  shots: string;
  shots_on_target: string;
  corners: string;
  fouls: string;
  yellow_cards: string;
  red_cards: string;
  goalkeeper_saves: string;
  status: string;
}

export interface LiveAnalysisHistoricalPerformance {
  overall: { settled: number; correct: number; accuracy: number };
  byMarket: Array<{ market: string; settled: number; correct: number; accuracy: number }>;
  byConfidenceBand: Array<{ band: string; settled: number; correct: number; accuracy: number }>;
  byMinuteBand: Array<{ band: string; settled: number; correct: number; accuracy: number }>;
  byOddsRange: Array<{ range: string; settled: number; correct: number; accuracy: number }>;
  byLeague: Array<{ league: string; settled: number; correct: number; accuracy: number }>;
}

export interface LiveAnalysisPromptInput {
  homeName: string;
  awayName: string;
  league: string;
  minute: number;
  score: string;
  status: string;
  statsCompact: {
    possession: TwoSideValue;
    shots: TwoSideValue;
    shots_on_target: TwoSideValue;
    corners: TwoSideValue;
    fouls: TwoSideValue;
    offsides?: TwoSideValue;
    yellow_cards?: TwoSideValue;
    red_cards?: TwoSideValue;
    goalkeeper_saves?: TwoSideValue;
    blocked_shots?: TwoSideValue;
    total_passes?: TwoSideValue;
    passes_accurate?: TwoSideValue;
  };
  statsAvailable: boolean;
  statsSource: PromptStatsSource;
  evidenceMode: PromptEvidenceMode;
  statsMeta?: Record<string, unknown> | null;
  eventsCompact: Array<{
    minute: number;
    extra?: number | null;
    team: string;
    type: string;
    detail: string;
    player?: string;
  }>;
  oddsCanonical: Record<string, unknown>;
  oddsAvailable: boolean;
  oddsSource: string;
  oddsFetchedAt: string | null;
  oddsSanityWarnings?: string[];
  oddsSuspicious?: boolean;
  derivedInsights: Record<string, unknown> | null;
  customConditions: string;
  recommendedCondition: string;
  recommendedConditionReason: string;
  strategicContext: Record<string, unknown> | null;
  analysisMode?: PromptAnalysisMode;
  forceAnalyze: boolean;
  isManualPush?: boolean;
  skippedFilters?: string[];
  originalWouldProceed?: boolean;
  prediction: Record<string, unknown> | null;
  currentTotalGoals: number;
  previousRecommendations?: LiveAnalysisPromptPreviousRecommendation[];
  matchTimeline?: LiveAnalysisMatchTimelineSnapshot[];
  historicalPerformance?: LiveAnalysisHistoricalPerformance | null;
  preMatchPredictionSummary: string;
  mode: string;
  statsFallbackReason: string;
}

function resolveAnalysisMode(data: LiveAnalysisPromptInput): PromptAnalysisMode {
  if (data.analysisMode) return data.analysisMode;
  if (data.isManualPush) return 'manual_force';
  if (data.forceAnalyze) return 'system_force';
  return 'auto';
}

function describeTriggerProvenance(analysisMode: PromptAnalysisMode): string {
  switch (analysisMode) {
    case 'manual_force':
      return 'manual Ask AI request';
    case 'system_force':
      return 'watchlist/system force mode';
    default:
      return 'scheduled automatic analysis';
  }
}

function buildForceAnalyzeContext(
  data: LiveAnalysisPromptInput,
  analysisMode: PromptAnalysisMode,
): string {
  if (analysisMode === 'auto') return '';
  const skippedFilters = Array.isArray(data.skippedFilters) ? data.skippedFilters : [];
  const originalWouldProceed = data.originalWouldProceed !== false;
  const triggerDescription = analysisMode === 'manual_force'
    ? 'This analysis was explicitly requested by a user from the Ask AI flow.'
    : 'This analysis was triggered by watchlist/system force mode, not by a direct manual Ask AI request.';
  const disciplineRule = analysisMode === 'manual_force'
    ? 'Because a user explicitly requested analysis, provide best-effort insight with clear limitations when evidence is weak.'
    : 'Because this is still an automated/system-triggered run, keep normal betting discipline and do NOT soften standards just because force mode bypassed gates.';
  return `
============================================================
FORCE ANALYZE MODE - SPECIAL INSTRUCTIONS
============================================================
ANALYSIS_MODE: ${analysisMode}
${triggerDescription}
Force mode only bypasses pipeline gating. It does NOT relax betting discipline.

BYPASSED FILTERS:
${skippedFilters.length > 0 ? skippedFilters.map((f) => `- ${f}`).join('\n') : '- None (match passed all filters)'}

ORIGINAL WOULD PROCEED: ${originalWouldProceed ? 'YES' : 'NO'}

SPECIAL RULES FOR FORCE MODE:
1. You MUST still evaluate the match objectively.
2. If the match status is NOT live (HT, NS, FT, etc.):
   - Acknowledge the non-live status in your reasoning.
   - For HT (Half Time): You can analyze based on first half data and provide insights for second half.
   - For NS (Not Started): Limited analysis possible - focus on pre-match data if available.
   - For FT (Full Time): Match is over - no betting recommendation possible, but you can provide post-match analysis.
3. Adjust confidence and stake based on data quality:
   - If status is HT: confidence max 7, stake max 4%
   - If status is NS/FT: should_push = false (explain why in reasoning)
4. Be explicit in reasoning about any limitations due to match status.
5. ${disciplineRule}
`;
}

function buildPreviousRecommendationsSection(data: LiveAnalysisPromptInput): string {
  const recs = Array.isArray(data.previousRecommendations) ? data.previousRecommendations : [];
  if (recs.length === 0) return '';

  const lines = recs.map((r, i) => {
    const resultStr = r.result ? ` | Result: ${r.result}` : '';
    const reasoning = r.reasoning ? `\n     Reasoning: ${String(r.reasoning).substring(0, 150)}` : '';
    return `  ${i + 1}. [Min ${r.minute ?? '?'}] ${r.selection || 'No selection'} (${r.bet_market || '?'}) | Conf: ${r.confidence ?? 0}/10 | Odds: ${r.odds ?? 'N/A'}${resultStr}${reasoning}`;
  });

  return `========================
PREVIOUS RECOMMENDATIONS FOR THIS MATCH (${recs.length})
========================
${lines.join('\n')}

Use these records as context. The authoritative reinforcement / duplicate policy is defined in ANALYSIS CONTINUITY RULES below.
`;
}

function buildMatchTimelineSection(data: LiveAnalysisPromptInput): string {
  const timeline = Array.isArray(data.matchTimeline) ? data.matchTimeline : [];
  if (timeline.length === 0) return '';

  const lines = timeline.map((s) =>
    `  Min ${s.minute}: ${s.score} | Poss: ${s.possession} | Shots: ${s.shots} (OT: ${s.shots_on_target}) | Corners: ${s.corners} | Fouls: ${s.fouls} | Cards: ${s.yellow_cards}Y ${s.red_cards}R | GKSaves: ${s.goalkeeper_saves}`,
  );

  return `========================
MATCH PROGRESSION TIMELINE (${timeline.length} snapshots)
========================
${lines.join('\n')}

USE THIS DATA TO:
- Identify momentum shifts (possession swings, shot rate changes)
- Detect sustained patterns vs temporary bursts
- Assess whether the current stats represent a trend or a spike
- Compare early-game vs current stats for trajectory analysis
- Fouls + cards indicate match intensity and discipline risks
- GK saves ratio vs shots on target shows shooting quality
`;
}

function buildContinuityRulesSection(data: LiveAnalysisPromptInput): string {
  const recs = Array.isArray(data.previousRecommendations) ? data.previousRecommendations : [];
  if (recs.length === 0) return '';

  return `========================
ANALYSIS CONTINUITY RULES (CRITICAL)
========================
You have previous recommendations for this match. You MUST follow these rules:

1. REFERENCE: Acknowledge your previous recommendation(s) in reasoning_en and reasoning_vi.
2. CONSISTENCY: If the match conditions that supported your last recommendation STILL hold,
   explain that continuity. Do NOT contradict yourself without explaining what changed.
3. EVOLUTION: If conditions changed (goal, red card, momentum shift), clearly state what
   changed and why your new assessment differs from the previous one.
4. REINFORCEMENT VS DUPLICATE: Do NOT output the exact same selection + bet_market as your
   most recent recommendation unless at least ONE of these is true:
   - Odds improved by >= 0.10, OR
   - There is a material match-state change (goal, red card, clear momentum shift, meaningful stat swing), OR
   - Match minute advanced >= 5 AND the evidence is materially stronger than before
   Never repeat the same pick solely because time passed.
   If none of the conditions above are true -> set should_push = false with reasoning:
   "No significant strengthening since last recommendation at minute [X]."
5. CHAIN OF THOUGHT: Your reasoning should build upon previous analysis, not start fresh.
   Think of this as a progressive report, not isolated snapshots.
`;
}

const DYNAMIC_PRIOR_MIN_SAMPLE = 8;

function classifyDynamicPrior(bucket: { accuracy: number }): 'supportive prior' | 'caution prior' | 'neutral prior' {
  if (bucket.accuracy >= 60) return 'supportive prior';
  if (bucket.accuracy <= 45) return 'caution prior';
  return 'neutral prior';
}

function filterSampledBuckets<T extends { settled: number }>(rows: T[]): T[] {
  return rows.filter((row) => row.settled >= DYNAMIC_PRIOR_MIN_SAMPLE);
}

function buildHistoricalPerformanceSection(data: LiveAnalysisPromptInput): string {
  const perf = data.historicalPerformance;
  if (!perf || perf.overall.settled < DYNAMIC_PRIOR_MIN_SAMPLE) return '';

  const lines: string[] = [];
  lines.push('========================');
  lines.push('DYNAMIC PERFORMANCE PRIORS (SELF-LEARNING DATA)');
  lines.push('========================');
  lines.push(`Overall prior: ${perf.overall.accuracy}% (${perf.overall.correct}/${perf.overall.settled})`);
  lines.push(`Only buckets with settled >= ${DYNAMIC_PRIOR_MIN_SAMPLE} are shown below. Omitted buckets are low sample and must be ignored.`);
  lines.push('Use these priors only to calibrate confidence/stake or break ties between similar options. They must NEVER override strong live evidence.');

  const marketBuckets = filterSampledBuckets(perf.byMarket);
  if (marketBuckets.length > 0) {
    lines.push('');
    lines.push(`Market priors (settled >= ${DYNAMIC_PRIOR_MIN_SAMPLE}):`);
    for (const m of marketBuckets) {
      lines.push(`  ${m.market}: ${m.accuracy}% (${m.correct}/${m.settled}) [${classifyDynamicPrior(m)}]`);
    }
  }

  const confidenceBuckets = filterSampledBuckets(perf.byConfidenceBand);
  if (confidenceBuckets.length > 0) {
    lines.push('');
    lines.push(`Confidence-band priors (settled >= ${DYNAMIC_PRIOR_MIN_SAMPLE}):`);
    for (const c of confidenceBuckets) {
      lines.push(`  Conf ${c.band}: ${c.accuracy}% (${c.correct}/${c.settled}) [${classifyDynamicPrior(c)}]`);
    }
  }

  const minuteBuckets = filterSampledBuckets(perf.byMinuteBand);
  if (minuteBuckets.length > 0) {
    lines.push('');
    lines.push(`Match-phase priors (settled >= ${DYNAMIC_PRIOR_MIN_SAMPLE}):`);
    for (const m of minuteBuckets) {
      lines.push(`  Min ${m.band}: ${m.accuracy}% (${m.correct}/${m.settled}) [${classifyDynamicPrior(m)}]`);
    }
  }

  const oddsBuckets = filterSampledBuckets(perf.byOddsRange);
  if (oddsBuckets.length > 0) {
    lines.push('');
    lines.push(`Odds-range priors (settled >= ${DYNAMIC_PRIOR_MIN_SAMPLE}):`);
    for (const o of oddsBuckets) {
      lines.push(`  Odds ${o.range}: ${o.accuracy}% (${o.correct}/${o.settled}) [${classifyDynamicPrior(o)}]`);
    }
  }

  const leagueBuckets = filterSampledBuckets(perf.byLeague);
  if (leagueBuckets.length > 0) {
    lines.push('');
    lines.push(`League priors (settled >= ${DYNAMIC_PRIOR_MIN_SAMPLE}):`);
    for (const l of leagueBuckets) {
      lines.push(`  ${l.league}: ${l.accuracy}% (${l.correct}/${l.settled}) [${classifyDynamicPrior(l)}]`);
    }
  }

  lines.push('');
  lines.push('HOW TO USE THESE PRIORS:');
  lines.push('- supportive prior: may slightly increase confidence or stake only when live evidence already supports the pick.');
  lines.push('- caution prior: reduce aggression, require a larger live edge, or skip marginal bets.');
  lines.push('- neutral prior: informational only, no strong calibration effect.');
  lines.push('- Never treat historical priors as hard bans or standalone reasons to bet.');
  lines.push('');

  return lines.join('\n');
}

function getEvidenceTierRule(evidenceMode: PromptEvidenceMode): EvidenceTierRule {
  switch (evidenceMode) {
    case 'full_live_data':
      return {
        tier: 'tier_1',
        label: 'Live stats + usable odds',
        allowedMarkets: 'O/U, AH, BTTS, 1X2, Corners (if market exists and rules pass)',
        forbiddenMarkets: 'None by tier; still subject to market-specific discipline',
        operationalRule: 'Normal evaluation path. Strongest evidence tier.',
      };
    case 'stats_only':
      return {
        tier: 'tier_2',
        label: 'Live stats + pre-match priors, but no usable live odds',
        allowedMarkets: 'Analytical lean only. If no reliable reference price is present, default to NO BET.',
        forbiddenMarkets: '1X2, BTTS No, and any action based on invented/hallucinated odds',
        operationalRule: 'Use this tier for analysis and watchlist insight, not aggressive recommendations.',
      };
    case 'odds_events_only_degraded':
      return {
        tier: 'tier_3',
        label: 'Usable odds + event timeline, but no usable live stats',
        allowedMarkets: 'O/U and selective AH only',
        forbiddenMarkets: '1X2, BTTS, Corners, Double Chance',
        operationalRule: 'Degraded mode. Only low-complexity market families allowed.',
      };
    case 'events_only_degraded':
      return {
        tier: 'tier_4',
        label: 'Event timeline only',
        allowedMarkets: 'No actionable betting markets',
        forbiddenMarkets: 'All markets',
        operationalRule: 'Observation only. No recommendation unless a separate custom-condition fact check is required.',
      };
    default:
      return {
        tier: 'tier_4',
        label: 'Low evidence / incomplete data',
        allowedMarkets: 'No actionable betting markets',
        forbiddenMarkets: 'All markets',
        operationalRule: 'No-bet tier.',
      };
  }
}

function readStrategicText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function hasStrategicText(value: unknown): boolean {
  const text = readStrategicText(value);
  return !!text && !/^no data/i.test(text);
}

function getStrategicNarrative(
  strategicContext: Record<string, unknown>,
  lang: 'en' | 'vi',
): Record<string, unknown> {
  const qualitative = strategicContext.qualitative;
  if (qualitative && typeof qualitative === 'object') {
    const localized = (qualitative as Record<string, unknown>)[lang];
    if (localized && typeof localized === 'object') {
      return localized as Record<string, unknown>;
    }
  }
  return strategicContext;
}

function getStrategicSourceMeta(strategicContext: Record<string, unknown>): Record<string, unknown> {
  const sourceMeta = strategicContext.source_meta;
  return sourceMeta && typeof sourceMeta === 'object'
    ? sourceMeta as Record<string, unknown>
    : {};
}

function getStrategicQuantitative(strategicContext: Record<string, unknown>): Record<string, number> {
  const quantitative = strategicContext.quantitative;
  if (!quantitative || typeof quantitative !== 'object') return {};
  return Object.fromEntries(
    Object.entries(quantitative as Record<string, unknown>).filter(([, value]) => typeof value === 'number'),
  ) as Record<string, number>;
}

function buildStrategicContextSection(strategicContext: Record<string, unknown> | null): string {
  if (!strategicContext || typeof strategicContext !== 'object') return '';
  const ctx = strategicContext;
  const narrativeEn = getStrategicNarrative(ctx, 'en');
  const quantitative = getStrategicQuantitative(ctx);
  const sourceMeta = getStrategicSourceMeta(ctx);
  const searchQuality = readStrategicText(sourceMeta.search_quality) || 'unknown';
  const trustedDomains = Array.isArray(sourceMeta.sources)
    ? (sourceMeta.sources as Array<Record<string, unknown>>)
      .filter((source) => {
        const trust = readStrategicText(source.trust_tier);
        return trust === 'tier_1' || trust === 'tier_2';
      })
      .map((source) => readStrategicText(source.domain))
      .filter(Boolean)
    : [];

  const summary = readStrategicText(narrativeEn.summary || ctx.summary);
  const hasNarrativeData = [
    narrativeEn.home_motivation,
    narrativeEn.away_motivation,
    narrativeEn.league_positions,
    narrativeEn.fixture_congestion,
    narrativeEn.rotation_risk,
    narrativeEn.key_absences,
    narrativeEn.h2h_narrative,
    summary,
  ].some(hasStrategicText);
  const hasQuantitativeData = Object.keys(quantitative).length > 0;
  if (!hasNarrativeData && !hasQuantitativeData) return '';

  const lines: string[] = [];
  lines.push('========================');
  lines.push('STRATEGIC CONTEXT (FROM PRE-MATCH RESEARCH)');
  lines.push('========================');
  lines.push(`SOURCE_QUALITY: ${searchQuality}`);
  if (trustedDomains.length > 0) {
    lines.push(`TRUSTED_SOURCE_DOMAINS: ${Array.from(new Set(trustedDomains)).join(', ')}`);
  }
  if (hasStrategicText(narrativeEn.home_motivation || ctx.home_motivation))
    lines.push(`HOME_MOTIVATION: ${readStrategicText(narrativeEn.home_motivation || ctx.home_motivation)}`);
  if (hasStrategicText(narrativeEn.away_motivation || ctx.away_motivation))
    lines.push(`AWAY_MOTIVATION: ${readStrategicText(narrativeEn.away_motivation || ctx.away_motivation)}`);
  if (hasStrategicText(narrativeEn.league_positions || ctx.league_positions))
    lines.push(`LEAGUE_POSITIONS: ${readStrategicText(narrativeEn.league_positions || ctx.league_positions)}`);
  if (hasStrategicText(narrativeEn.fixture_congestion || ctx.fixture_congestion))
    lines.push(`FIXTURE_CONGESTION: ${readStrategicText(narrativeEn.fixture_congestion || ctx.fixture_congestion)}`);
  if (hasStrategicText(narrativeEn.rotation_risk || ctx.rotation_risk))
    lines.push(`ROTATION_RISK: ${readStrategicText(narrativeEn.rotation_risk || ctx.rotation_risk)}`);
  if (hasStrategicText(narrativeEn.key_absences || ctx.key_absences))
    lines.push(`KEY_ABSENCES: ${readStrategicText(narrativeEn.key_absences || ctx.key_absences)}`);
  if (hasStrategicText(narrativeEn.h2h_narrative || ctx.h2h_narrative))
    lines.push(`H2H_NARRATIVE: ${readStrategicText(narrativeEn.h2h_narrative || ctx.h2h_narrative)}`);
  if (hasStrategicText(ctx.competition_type))
    lines.push(`COMPETITION_TYPE: ${readStrategicText(ctx.competition_type)}`);
  if (hasStrategicText(summary)) {
    lines.push(`SUMMARY: ${summary}`);
  }
  if (hasQuantitativeData) {
    lines.push(`QUANTITATIVE_PREMATCH_PRIORS: ${JSON.stringify(quantitative)}`);
  }
  lines.push('');
  lines.push('STRATEGIC CONTEXT RULES:');
  lines.push('- Treat strategic context as secondary pre-match prior. Live stats/events/odds still dominate.');
  lines.push('- If SOURCE_QUALITY is medium or unknown, use the context as soft guidance only and do NOT boost confidence aggressively.');
  lines.push('- QUANTITATIVE_PREMATCH_PRIORS are baseline tendencies, not live evidence. Use them to calibrate O/U, BTTS, or AH lean only when live evidence aligns.');
  lines.push('- COMPETITION_TYPE: For european/international/friendly competitions, teams are from DIFFERENT domestic leagues. LEAGUE_POSITIONS CANNOT be compared across leagues - IGNORE position gap signals.');
  lines.push('- LEAGUE_POSITIONS: ONLY for domestic_league matches: Top 3 vs bottom 3 = strong favourite signal. Within 3 places = evenly matched -> AVOID 1X2, prefer O/U or BTTS.');
  lines.push('- ROTATION: If team likely rotates key players, reduce confidence for that team winning by 1-2.');
  lines.push('- NOTHING TO PLAY FOR: Expect lower intensity -> favors Under, Draw.');
  lines.push('- TITLE RACE / RELEGATION BATTLE: Expect high intensity -> supports attacking.');
  lines.push('- FIXTURE_CONGESTION within 3 days of major match significantly increases rotation risk.');
  lines.push('- KEY_ABSENCES of star players should reduce expected goals for that team.');
  lines.push('- High Over 2.5 / BTTS rates may support attacking markets only if current tempo and shots agree.');
  lines.push('- High clean-sheet or failed-to-score rates may support Under / BTTS No only if live evidence does not contradict them.');
  lines.push('');

  return lines.join('\n');
}

function buildPreMatchPredictionSection(prediction: Record<string, unknown> | null, summary: string): string {
  if (!prediction && !summary) return '';

  const lines: string[] = [];
  lines.push('========================');
  lines.push('PRE-MATCH PREDICTION (OPTIONAL)');
  lines.push('========================');

  if (prediction && typeof prediction === 'object') {
    const pmPred = (prediction as Record<string, Record<string, unknown>>).predictions || {};
    const pmComp = (prediction as Record<string, Record<string, unknown>>).comparison || {};

    const compact: Record<string, unknown> = {
      pre_favourite: (pmPred.winner as Record<string, unknown>)?.name || null,
      pre_win_or_draw: pmPred.win_or_draw ?? null,
      pre_handicap_home: (pmPred.goals as Record<string, unknown>)?.home ?? null,
      pre_handicap_away: (pmPred.goals as Record<string, unknown>)?.away ?? null,
      pre_percent: pmPred.percent || null,
      pre_form: (pmComp.form as Record<string, unknown>) || null,
      pre_total_rating: (pmComp.total as Record<string, unknown>) || null,
    };

    lines.push(JSON.stringify(compact));

    const h2hSummary = prediction.h2h_summary;
    if (h2hSummary) lines.push(`H2H_SUMMARY: ${JSON.stringify(h2hSummary)}`);

    const teamForm = prediction.team_form;
    if (teamForm) lines.push(`TEAM_FORM_SEQUENCE: ${JSON.stringify(teamForm)}`);
  } else {
    lines.push(summary || 'No pre-match prediction available.');
  }

  lines.push('');
  return lines.join('\n');
}

function buildForceAnalyzeContextCompact(
  data: LiveAnalysisPromptInput,
  analysisMode: PromptAnalysisMode,
): string {
  if (analysisMode === 'auto') return '';
  const skippedFilters = Array.isArray(data.skippedFilters) ? data.skippedFilters : [];
  const originalWouldProceed = data.originalWouldProceed !== false ? 'YES' : 'NO';
  const trigger = analysisMode === 'manual_force'
    ? 'manual Ask AI request'
    : 'system/watchlist force mode';
  const stance = analysisMode === 'manual_force'
    ? 'Best-effort analysis is allowed, but keep betting discipline and state limitations clearly.'
    : 'Gate bypass only. Do not relax betting discipline just because this run was forced.';
  return `========================
FORCE MODE
========================
- ANALYSIS_MODE: ${analysisMode}
- TRIGGER: ${trigger}
- ORIGINAL_WOULD_PROCEED: ${originalWouldProceed}
- BYPASSED_FILTERS: ${skippedFilters.length > 0 ? skippedFilters.join(' | ') : 'None'}
- SPECIAL_RULES:
  - Force mode bypasses pipeline gates only.
  - HT: confidence <= 7, stake <= 4%.
  - NS/FT and other non-live states: should_push = false unless you are only explaining limitations.
  - ${stance}

`;
}

function buildStrategicContextSectionCompact(strategicContext: Record<string, unknown> | null): string {
  if (!strategicContext || typeof strategicContext !== 'object') return '';
  const ctx = strategicContext;
  const narrativeEn = getStrategicNarrative(ctx, 'en');
  const quantitative = getStrategicQuantitative(ctx);
  const sourceMeta = getStrategicSourceMeta(ctx);
  const searchQuality = readStrategicText(sourceMeta.search_quality) || 'unknown';
  const trustedDomains = Array.isArray(sourceMeta.sources)
    ? (sourceMeta.sources as Array<Record<string, unknown>>)
      .filter((source) => {
        const trust = readStrategicText(source.trust_tier);
        return trust === 'tier_1' || trust === 'tier_2';
      })
      .map((source) => readStrategicText(source.domain))
      .filter(Boolean)
    : [];
  const summary = readStrategicText(narrativeEn.summary || ctx.summary);
  const hasNarrativeData = [
    narrativeEn.home_motivation,
    narrativeEn.away_motivation,
    narrativeEn.league_positions,
    narrativeEn.fixture_congestion,
    narrativeEn.rotation_risk,
    narrativeEn.key_absences,
    narrativeEn.h2h_narrative,
    summary,
  ].some(hasStrategicText);
  const hasQuantitativeData = Object.keys(quantitative).length > 0;
  if (!hasNarrativeData && !hasQuantitativeData) return '';

  const lines: string[] = [];
  lines.push('========================');
  lines.push('STRATEGIC CONTEXT');
  lines.push('========================');
  lines.push(`SOURCE_QUALITY: ${searchQuality}`);
  if (trustedDomains.length > 0) {
    lines.push(`TRUSTED_SOURCE_DOMAINS: ${Array.from(new Set(trustedDomains)).join(', ')}`);
  }
  if (hasStrategicText(narrativeEn.home_motivation || ctx.home_motivation))
    lines.push(`HOME_MOTIVATION: ${readStrategicText(narrativeEn.home_motivation || ctx.home_motivation)}`);
  if (hasStrategicText(narrativeEn.away_motivation || ctx.away_motivation))
    lines.push(`AWAY_MOTIVATION: ${readStrategicText(narrativeEn.away_motivation || ctx.away_motivation)}`);
  if (hasStrategicText(narrativeEn.league_positions || ctx.league_positions))
    lines.push(`LEAGUE_POSITIONS: ${readStrategicText(narrativeEn.league_positions || ctx.league_positions)}`);
  if (hasStrategicText(narrativeEn.fixture_congestion || ctx.fixture_congestion))
    lines.push(`FIXTURE_CONGESTION: ${readStrategicText(narrativeEn.fixture_congestion || ctx.fixture_congestion)}`);
  if (hasStrategicText(narrativeEn.rotation_risk || ctx.rotation_risk))
    lines.push(`ROTATION_RISK: ${readStrategicText(narrativeEn.rotation_risk || ctx.rotation_risk)}`);
  if (hasStrategicText(narrativeEn.key_absences || ctx.key_absences))
    lines.push(`KEY_ABSENCES: ${readStrategicText(narrativeEn.key_absences || ctx.key_absences)}`);
  if (hasStrategicText(narrativeEn.h2h_narrative || ctx.h2h_narrative))
    lines.push(`H2H_NARRATIVE: ${readStrategicText(narrativeEn.h2h_narrative || ctx.h2h_narrative)}`);
  if (hasStrategicText(ctx.competition_type))
    lines.push(`COMPETITION_TYPE: ${readStrategicText(ctx.competition_type)}`);
  if (hasStrategicText(summary)) lines.push(`SUMMARY: ${summary}`);
  if (hasQuantitativeData) lines.push(`QUANTITATIVE_PREMATCH_PRIORS: ${JSON.stringify(quantitative)}`);
  lines.push('');
  lines.push('CONTEXT USE RULES:');
  lines.push('- Secondary prior only; live stats/events/odds dominate.');
  lines.push('- Medium/unknown quality => soft guidance only.');
  lines.push('- Quantitative priors help only when live evidence aligns.');
  lines.push('- Cross-league position gaps are invalid outside domestic_league.');
  lines.push('- Rotation, congestion, absences reduce aggression for that side.');
  lines.push('- Goal/BTTS/clean-sheet priors support a market only if live evidence agrees.');
  lines.push('');
  return lines.join('\n');
}

function buildPreviousRecommendationsSectionCompact(data: LiveAnalysisPromptInput): string {
  const recs = Array.isArray(data.previousRecommendations) ? data.previousRecommendations : [];
  if (recs.length === 0) return '';
  const lines = recs.map((r, i) => (
    `  ${i + 1}. [Min ${r.minute ?? '?'}] ${r.selection || 'No selection'} (${r.bet_market || '?'}) | Conf ${r.confidence ?? 0} | Odds ${r.odds ?? 'N/A'} | Stake ${r.stake_percent ?? 0}%`
  ));
  return `========================
PREVIOUS RECOMMENDATIONS (${recs.length})
========================
${lines.join('\n')}

`;
}

function buildContinuityRulesSectionCompact(data: LiveAnalysisPromptInput): string {
  const recs = Array.isArray(data.previousRecommendations) ? data.previousRecommendations : [];
  if (recs.length === 0) return '';
  return `CONTINUITY RULES:
- Reference the latest recommendation and explain continuity or change.
- Do not repeat the same selection + bet_market unless odds improved by >= 0.10, OR match state changed materially, OR >= 5 minutes passed and evidence is materially stronger.
- Never repeat only because time passed.
- If the last pick is not materially stronger now, return should_push=false and say: "No significant strengthening since last recommendation at minute [X]."

`;
}

interface CompactExposureSummary {
  thesisKey: string;
  label: string;
  count: number;
  totalStake: number;
  latestMinute: number | null;
  canonicalMarkets: string[];
}

function isCompactPromptVersion(promptVersion: LiveAnalysisPromptVersion): boolean {
  return promptVersion === 'v5-compact-a' || promptVersion === 'v6-betting-discipline-a';
}

function isBettingDisciplinePromptVersion(promptVersion: LiveAnalysisPromptVersion): boolean {
  return promptVersion === 'v6-betting-discipline-a';
}

function getCorrelatedThesis(canonicalMarket: string): { thesisKey: string; label: string } | null {
  if (!canonicalMarket || canonicalMarket === 'unknown') return null;
  if (canonicalMarket.startsWith('over_')) return { thesisKey: 'goals_over', label: 'Goals Over thesis' };
  if (canonicalMarket.startsWith('under_')) return { thesisKey: 'goals_under', label: 'Goals Under thesis' };
  if (canonicalMarket.startsWith('corners_over_')) return { thesisKey: 'corners_over', label: 'Corners Over thesis' };
  if (canonicalMarket.startsWith('corners_under_')) return { thesisKey: 'corners_under', label: 'Corners Under thesis' };
  if (canonicalMarket.startsWith('asian_handicap_home_')) return { thesisKey: 'asian_handicap_home', label: 'Asian Handicap Home thesis' };
  if (canonicalMarket.startsWith('asian_handicap_away_')) return { thesisKey: 'asian_handicap_away', label: 'Asian Handicap Away thesis' };
  if (canonicalMarket === 'btts_yes') return { thesisKey: 'btts_yes', label: 'BTTS Yes thesis' };
  if (canonicalMarket === 'btts_no') return { thesisKey: 'btts_no', label: 'BTTS No thesis' };
  if (canonicalMarket === '1x2_home') return { thesisKey: '1x2_home', label: 'Home Win thesis' };
  if (canonicalMarket === '1x2_away') return { thesisKey: '1x2_away', label: 'Away Win thesis' };
  if (canonicalMarket === '1x2_draw') return { thesisKey: '1x2_draw', label: 'Draw thesis' };
  return null;
}

function summarizeCorrelatedExposure(data: LiveAnalysisPromptInput): CompactExposureSummary[] {
  const recs = Array.isArray(data.previousRecommendations) ? data.previousRecommendations : [];
  const exposureMap = new Map<string, CompactExposureSummary>();

  for (const rec of recs) {
    const canonicalMarket = normalizeMarket(rec.selection ?? '', rec.bet_market ?? '');
    const thesis = getCorrelatedThesis(canonicalMarket);
    if (!thesis) continue;

    const existing = exposureMap.get(thesis.thesisKey) ?? {
      thesisKey: thesis.thesisKey,
      label: thesis.label,
      count: 0,
      totalStake: 0,
      latestMinute: null,
      canonicalMarkets: [],
    };

    existing.count += 1;
    existing.totalStake += Number(rec.stake_percent ?? 0) || 0;
    if (typeof rec.minute === 'number') {
      existing.latestMinute = existing.latestMinute == null ? rec.minute : Math.max(existing.latestMinute, rec.minute);
    }
    if (canonicalMarket && !existing.canonicalMarkets.includes(canonicalMarket)) {
      existing.canonicalMarkets.push(canonicalMarket);
    }
    exposureMap.set(thesis.thesisKey, existing);
  }

  return Array.from(exposureMap.values())
    .sort((a, b) => b.totalStake - a.totalStake || b.count - a.count)
    .map((row) => ({
      ...row,
      totalStake: Math.round(row.totalStake * 100) / 100,
    }));
}

function buildExistingExposureSectionCompact(data: LiveAnalysisPromptInput): string {
  const summaries = summarizeCorrelatedExposure(data);
  if (summaries.length === 0) return '';

  const lines = summaries.map((summary) => {
    const latestMinute = summary.latestMinute == null ? '?' : String(summary.latestMinute);
    return `- ${summary.label}: ${summary.count} prior pick(s), total prior stake ${summary.totalStake}%, latest at minute ${latestMinute}, lines: ${summary.canonicalMarkets.join(', ')}`;
  });

  return `========================
EXISTING MATCH EXPOSURE
========================
${lines.join('\n')}

BETTING DISCIPLINE:
- Treat correlated lines in the same direction and market family as ONE existing position, not as independent bets.
- Examples: over_2.5 + over_2.0 + over_1.75 = one Goals Over thesis. corners_under_14.5 + corners_under_16.5 = one Corners Under thesis.
- Experienced football bettors usually prefer one clean entry at the best available line. Repeating nearby lines is usually line-chasing, not a new edge.
- If you already have exposure in the same thesis, default to should_push=false unless the new line is an exceptional upgrade in price/risk and you can explain why it is materially better than the earlier entries.
- A looser or tighter line on the same unchanged thesis is NOT diversification. It is compounded bankroll exposure.
- When same-thesis exposure already exists, be stricter on confidence and stake. Protect bankroll first.

`;
}

function buildPreMatchPredictionSectionCompact(prediction: Record<string, unknown> | null, summary: string): string {
  const block = buildPreMatchPredictionSection(prediction, summary);
  if (!block) return '';
  return `${block}PRE-MATCH RULES:
- Context only. Never override live evidence.
- Use mainly for alignment checks, overreaction checks, H2H context, or form context.
- Ignore it when live flow clearly contradicts it.
- Combined pre-match + strategic weighting should stay limited.

`;
}

function buildExactMarketContractSectionCompact(data: LiveAnalysisPromptInput): string {
  const oc = data.oddsCanonical as Record<string, Record<string, unknown>>;
  const exactKeys: string[] = [];
  const rules: string[] = [];

  if (oc['1x2'] && oc['1x2'].home != null && oc['1x2'].draw != null && oc['1x2'].away != null) {
    exactKeys.push('1x2_home', '1x2_draw', '1x2_away');
    rules.push('- 1X2: use exactly "1x2_home", "1x2_draw", or "1x2_away".');
    rules.push('  selection: "Home Win @[odds]", "Draw @[odds]", or "Away Win @[odds]".');
  }

  if (oc.ou && oc.ou.line != null && oc.ou.over != null && oc.ou.under != null) {
    const line = String(oc.ou.line);
    exactKeys.push(`over_${line}`, `under_${line}`);
    rules.push(`- Goals O/U line ${line}: use exactly "over_${line}" or "under_${line}".`);
    rules.push(`  selection: "Over ${line} Goals @[odds]" or "Under ${line} Goals @[odds]".`);
  }

  if (oc.ah && oc.ah.line != null && oc.ah.home != null && oc.ah.away != null) {
    const line = String(oc.ah.line);
    exactKeys.push(`asian_handicap_home_${line}`, `asian_handicap_away_${line}`);
    rules.push(`- Asian Handicap line ${line}: use exactly "asian_handicap_home_${line}" or "asian_handicap_away_${line}".`);
    rules.push(`  selection: "Home ${line} @[odds]" or "Away ${line} @[odds]".`);
  }

  if (oc.btts && oc.btts.yes != null && oc.btts.no != null) {
    exactKeys.push('btts_yes', 'btts_no');
    rules.push('- BTTS: use exactly "btts_yes" or "btts_no".');
    rules.push('  selection: "BTTS Yes @[odds]" or "BTTS No @[odds]".');
  }

  if (oc.corners_ou && oc.corners_ou.line != null && oc.corners_ou.over != null && oc.corners_ou.under != null) {
    const line = String(oc.corners_ou.line);
    exactKeys.push(`corners_over_${line}`, `corners_under_${line}`);
    rules.push(`- Corners O/U line ${line}: use exactly "corners_over_${line}" or "corners_under_${line}".`);
    rules.push(`  selection: "Corners Over ${line} @[odds]" or "Corners Under ${line} @[odds]".`);
  }

  if (exactKeys.length === 0) {
    return `EXACT OUTPUT ENUMS:
- If should_push=false, selection="" and bet_market="".
- No usable exact market keys exist for this run, so do not invent any market key.

`;
  }

  return `EXACT OUTPUT ENUMS:
- If should_push=true, bet_market MUST be EXACTLY one of:
${exactKeys.map((key) => `  - "${key}"`).join('\n')}
- INVALID generic values: "ou", "over/under goals", "1X2", "btts", "asian_handicap", "corners".
- Any other bet_market will be rejected by the system as invalid.
${rules.join('\n')}
- If should_push=false, selection="" and bet_market="".

`;
}

export function buildLiveAnalysisPrompt(
  data: LiveAnalysisPromptInput,
  settings: LiveAnalysisPromptSettings,
  promptVersion: LiveAnalysisPromptVersion = LIVE_ANALYSIS_PROMPT_VERSION,
): string {
  const analysisMode = resolveAnalysisMode(data);
  const MIN_CONFIDENCE = settings.minConfidence;
  const MIN_ODDS = settings.minOdds;
  const LATE_PHASE_MINUTE = settings.latePhaseMinute;
  const VERY_LATE_PHASE_MINUTE = settings.veryLatePhaseMinute;
  const ENDGAME_MINUTE = settings.endgameMinute;

  const cornersHome = parseInt(String(data.statsCompact?.corners?.home ?? ''), 10);
  const cornersAway = parseInt(String(data.statsCompact?.corners?.away ?? ''), 10);
  const currentTotalCorners = !isNaN(cornersHome) && !isNaN(cornersAway)
    ? cornersHome + cornersAway
    : 'unknown';
  const oc = data.oddsCanonical as Record<string, Record<string, unknown>>;
  const currentTotalCornersNumber = typeof currentTotalCorners === 'number' ? currentTotalCorners : null;
  const cornersMarketLineRaw = oc?.corners_ou?.line;
  const cornersMarketLine = cornersMarketLineRaw == null ? null : Number(cornersMarketLineRaw);
  const activeCornersSanityAlert = (
    currentTotalCornersNumber !== null
    && cornersMarketLine !== null
    && !Number.isNaN(cornersMarketLine)
    && data.minute >= 75
    && (cornersMarketLine - currentTotalCornersNumber) >= 3
  )
    ? `- ACTIVE CORNERS SANITY ALERT: live corners show ${currentTotalCornersNumber} vs bookmaker line ${cornersMarketLine} at minute ${data.minute}. Treat this as likely stats desync/delay and set should_push=false for ALL corners markets.`
    : '';

  const incompleteMarkets: string[] = [];
  if (oc['1x2']) {
    if (oc['1x2'].home === null || oc['1x2'].draw === null || oc['1x2'].away === null) incompleteMarkets.push('1x2');
  }
  if (oc['ou']) {
    if (oc['ou'].line === null || oc['ou'].over === null || oc['ou'].under === null) incompleteMarkets.push('ou');
  }
  if (oc['ah']) {
    if (oc['ah'].line === null || oc['ah'].home === null || oc['ah'].away === null) incompleteMarkets.push('ah');
  }
  if (oc['btts']) {
    if (oc['btts'].yes === null || oc['btts'].no === null) incompleteMarkets.push('btts');
  }

  const oddsWarnings = incompleteMarkets.length > 0
    ? `WARNING: Incomplete odds data for markets: ${incompleteMarkets.join(', ')}. Do NOT recommend these markets.`
    : '';
  const evidenceTierRule = getEvidenceTierRule(data.evidenceMode);

  if (isCompactPromptVersion(promptVersion)) {
    const bettingDisciplineSection = isBettingDisciplinePromptVersion(promptVersion)
      ? buildExistingExposureSectionCompact(data)
      : '';
    return `
You are a disciplined live football investment analyst. Analyze one live match and return either one realistic investment idea or no bet. Evaluate custom conditions separately.
${buildForceAnalyzeContextCompact(data, analysisMode)}========================
CORE SETTINGS
========================
PROMPT_VERSION: ${promptVersion}
- Late phase >= ${LATE_PHASE_MINUTE}; very late >= ${VERY_LATE_PHASE_MINUTE}; endgame >= ${ENDGAME_MINUTE}
- MIN_ODDS: ${MIN_ODDS}
- No market below ${MIN_ODDS}
- No 1X2 before minute 35
- Canonical bet_market values only. Generic market family names are invalid.
- value_percent = estimated edge vs market price, range -50..100
- Odds warning: ${oddsWarnings || 'none'}
${buildExactMarketContractSectionCompact(data)}

${buildStrategicContextSectionCompact(data.strategicContext)}========================
MATCH SNAPSHOT
========================
- Match: ${data.homeName} vs ${data.awayName}
- League: ${data.league}
- Minute: ${data.minute}
- Score: ${data.score}
- Status: ${data.status}
- Analysis Mode: ${analysisMode}
- Trigger Provenance: ${describeTriggerProvenance(analysisMode)}
- Stats Source: ${data.statsSource}
- Evidence Mode: ${data.evidenceMode}
- Force Analyze: ${analysisMode === 'auto' ? 'NO' : 'YES'}
- Is Manual Push: ${analysisMode === 'manual_force' ? 'YES' : 'NO'}
${data.statsFallbackReason ? `- Stats Fallback Note: ${data.statsFallbackReason}` : ''}

========================
LIVE STATS JSON
========================
${JSON.stringify(data.statsCompact)}
STATS_AVAILABLE: ${data.statsAvailable}
STATS_SOURCE: ${data.statsSource}
STATS_META: ${JSON.stringify(data.statsMeta || {})}
${!data.statsAvailable && data.derivedInsights ? `DERIVED_INSIGHTS: ${JSON.stringify(data.derivedInsights)}
Derived event-only insights require lower confidence than full stats.

` : ''}========================
ODDS SNAPSHOT
========================
${!data.oddsAvailable ? 'NO USABLE ODDS AVAILABLE' : JSON.stringify(data.oddsCanonical)}
ODDS_AVAILABLE: ${data.oddsAvailable}
ODDS_SOURCE: ${data.oddsSource}
ODDS_FETCHED_AT: ${data.oddsFetchedAt ?? 'unknown'} (match minute at fetch: ${data.minute})
CURRENT_TOTAL_GOALS: ${data.currentTotalGoals}
CURRENT_TOTAL_CORNERS: ${currentTotalCorners}
${data.oddsSource === 'pre-match' ? 'PRE-MATCH ODDS ONLY: use as baseline reference, not as live odds.\n' : ''}${data.oddsSource === 'the-odds-api' ? 'THE_ODDS_API_FALLBACK: live exact-event fallback may lag slightly.\n' : ''}${!data.oddsAvailable ? 'Treat odds as unavailable and be conservative.\n' : ''}${data.oddsSuspicious ? `ODDS SANITY FAILED:\n${(data.oddsSanityWarnings || []).map((w) => '- ' + w).join('\n')}
Treat odds as unreliable and behave as if ODDS_AVAILABLE=false.
` : ''}ODDS RULE: canonical odds are already filtered; never infer missing markets and never invent prices.

${buildPreMatchPredictionSectionCompact(data.prediction, data.preMatchPredictionSummary)}========================
RECENT EVENTS
========================
${JSON.stringify(data.eventsCompact)}
EVENT_COUNT: ${data.eventsCompact.length}

${buildPreviousRecommendationsSectionCompact(data)}${bettingDisciplineSection}${buildContinuityRulesSectionCompact(data)}${buildMatchTimelineSection(data)}${buildHistoricalPerformanceSection(data)}========================
CONFIG / EVIDENCE
========================
- MIN_CONFIDENCE: ${MIN_CONFIDENCE}
- MIN_ODDS: ${MIN_ODDS}
- CUSTOM_CONDITIONS: ${data.customConditions || '(none)'}
- EVIDENCE_MODE: ${data.evidenceMode}
- EVIDENCE_TIER: ${evidenceTierRule.tier} (${evidenceTierRule.label})
- Allowed markets: ${evidenceTierRule.allowedMarkets}
- Forbidden markets: ${evidenceTierRule.forbiddenMarkets}
- Tier rule: ${evidenceTierRule.operationalRule}

========================
AI-RECOMMENDED CONDITION
========================
RECOMMENDED_CONDITION: ${data.recommendedCondition || '(none)'}
RECOMMENDED_CONDITION_REASON: ${data.recommendedConditionReason || '(none)'}

============================================================
DECISION RULES
============================================================
GLOBAL STATUS:
- 1H/2H = normal live analysis
- HT = confidence <= 7 and stake <= 4%
- NS/FT/PST/CANC = should_push false

DATA AVAILABILITY:
- Stats + odds: normal evaluation
- Stats only: default no bet
- No stats + derived insights: confidence cap 7
- No stats + no events: default no bet
- If STATS_SOURCE = live-score-api-fallback, treat it as the primary live stats source for this run

EVIDENCE HIERARCHY:
- Never choose a market outside the current allowed tier
- Narrative or strategic priors may support a pick inside the tier, but never upgrade a forbidden market into an allowed one

LATE GAME:
- minute >= ${LATE_PHASE_MINUTE}: be more conservative
- minute >= ${VERY_LATE_PHASE_MINUTE}: exceptional circumstances only
- minute >= ${ENDGAME_MINUTE}: default no bet, stake <= 2%

MARKET DISCIPLINE:
- Return at most one actionable thesis for this match in this run.
- Think like an experienced bankroll manager, not a signal counter.
- Multiple nearby lines in the same direction are usually one thesis, not multiple separate bets.
- A second bet on the same thesis needs exceptional justification. If you cannot explain a true upgrade, do not push.
- Prefer the best clean line over ladders or stake-splitting across correlated lines.
- Correlated exposure is risk concentration, not diversification.
- If the odds feed contains any market that is logically already settled by the current score/state, treat the entire odds feed as suspect and default to no bet.
- Example of impossible feed state: BTTS Yes/No still quoted after both teams have already scored.
- 1X2 and BTTS No need full_live_data, confidence >= 7, and strong stat support
- BTTS Yes needs tier 1 evidence
- Tier 3 may only use O/U or selective AH
- Corners require tier 1 live stats + live corners data
- If corners line is far above current live corners late in the match (gap >= 3 after minute 75), assume stats desync/delay and skip ALL corners markets.
${activeCornersSanityAlert}
- Odds >= 2.50 => confidence cap 6, stake cap 3%
- Over 3.5+ needs current goals >= line-1 or a clearly open match
- Score 0-0 after minute 55: prefer goal unders, not corners under
- risk_level HIGH => should_push false

RED CARD:
- Scan events for red cards; if found, add warning and reduce confidence by 1

BTTS:
- BTTS Yes: estimate must exceed break-even by >= 5%; if odds >= 2.00 then both teams need shots_on_target >= 2
- BTTS No: requires odds >= 1.70 and clear support such as score gap, one side with 0 SOT, or late clean-sheet game state

BREAK-EVEN:
- For every market, break_even_rate = 1/odds * 100
- Edge must be >= 3% or should_push=false
- Explain valuation using exact break-even plus a rounded fair-value range
- Preferred reasoning_en wording: "Break-even about X%. My fair range is around Y-Z%. Edge looks about W%."

STAKE:
- confidence 8-10 => 5-8%
- confidence 6-7 => 3-5%
- confidence 5 => 2-3%
- confidence < 5 => should_push false, stake 0

CUSTOM CONDITIONS:
- should_push and custom_condition_matched are separate decisions
- If custom_condition_matched=true, provide suggestion, reasoning, confidence, and stake for the triggered condition path

============================================================
OUTPUT - STRICT JSON
============================================================
{
  "should_push": boolean,
  "selection": string,
  "bet_market": string,
  "market_chosen_reason": string,
  "confidence": number,
  "reasoning_en": string,
  "reasoning_vi": string,
  "warnings": string[],
  "value_percent": number,
  "risk_level": "LOW" | "MEDIUM" | "HIGH",
  "stake_percent": number,
  "custom_condition_matched": boolean,
  "custom_condition_status": "none" | "evaluated" | "parse_error",
  "custom_condition_summary_en": string,
  "custom_condition_summary_vi": string,
  "custom_condition_reason_en": string,
  "custom_condition_reason_vi": string,
  "condition_triggered_suggestion": string,
  "condition_triggered_reasoning_en": string,
  "condition_triggered_reasoning_vi": string,
  "condition_triggered_confidence": number,
  "condition_triggered_stake": number
}
All fields must exist. selection="" and bet_market="" when should_push=false.
Return raw JSON only: first char "{" and last char "}".
NEVER wrap the JSON in markdown fences like \`\`\`json.
`;
  }

  return `
You are a professional live football investment insight analyst (not a gambler).
Your task is to analyze ONE live match and determine whether there is exactly ONE realistic, high-quality investment idea, or no idea at all. You must also evaluate a user-defined custom condition objectively.
${buildForceAnalyzeContext(data, analysisMode)}
============================================================
DEFINITIONS & THRESHOLDS (READ FIRST)
============================================================
PROMPT_VERSION: ${promptVersion}

LATE GAME THRESHOLDS:
- Late phase: minute >= ${LATE_PHASE_MINUTE}
- Very late phase: minute >= ${VERY_LATE_PHASE_MINUTE}
- Endgame: minute >= ${ENDGAME_MINUTE}

MINIMUM ACCEPTABLE ODDS: ${MIN_ODDS}
- NEVER recommend any market with price < ${MIN_ODDS}

BET_MARKET STANDARD VALUES:
- 1X2 markets: "1x2_home", "1x2_away", "1x2_draw"
- Over/Under goals: "over_0.5", "over_1.5", "over_2.5", "over_3.5", "over_4.5", "under_0.5", "under_1.5", "under_2.5", "under_3.5", "under_4.5"
- BTTS: "btts_yes", "btts_no"
- Asian Handicap: "asian_handicap_home_[line]", "asian_handicap_away_[line]"
- Corners: "corners_over_[line]", "corners_under_[line]"

SELECTION STANDARD FORMAT:
- 1X2: "Home Win @[odds]", "Away Win @[odds]", "Draw @[odds]"
- Over/Under: "Over [line] Goals @[odds]", "Under [line] Goals @[odds]"
- BTTS: "BTTS Yes @[odds]", "BTTS No @[odds]"
- Asian Handicap: "Home [line] @[odds]", "Away [line] @[odds]"
- Corners: "Corners Over [line] @[odds]", "Corners Under [line] @[odds]"
- FORBIDDEN: Do NOT add team names in selection.

VALUE PERCENT CALCULATION:
- value_percent = estimated edge over market price. Range: -50 to +100.

MARKET RESTRICTIONS (READ BEFORE VIEWING ODDS DATA):
${oddsWarnings ? `- ${oddsWarnings}` : '- No restrictions - all available markets have complete odds data.'}
- Do NOT recommend 1X2 markets before minute 35 (too early, game state can change completely).
- Do NOT recommend any market with price < ${MIN_ODDS}.

${buildStrategicContextSection(data.strategicContext)}
========================
MATCH CONTEXT
========================
- Match: ${data.homeName} vs ${data.awayName}
- League: ${data.league}
- Minute: ${data.minute}
- Score: ${data.score}
- Status: ${data.status}
- Analysis Mode: ${analysisMode}
- Trigger Provenance: ${describeTriggerProvenance(analysisMode)}
- Stats Source: ${data.statsSource}
- Evidence Mode: ${data.evidenceMode}
- Force Analyze: ${analysisMode === 'auto' ? 'NO' : 'YES'}
- Is Manual Push: ${analysisMode === 'manual_force' ? 'YES' : 'NO'}
${data.statsFallbackReason ? `- Stats Fallback Note: ${data.statsFallbackReason}` : ''}

========================
LIVE STATS (COMPACT JSON)
========================
${JSON.stringify(data.statsCompact)}

STATS_AVAILABLE: ${data.statsAvailable}
STATS_SOURCE: ${data.statsSource}
STATS_META: ${JSON.stringify(data.statsMeta || {})}
${!data.statsAvailable && data.derivedInsights ? `
========================
DERIVED INSIGHTS (FROM EVENTS)
========================
${JSON.stringify(data.derivedInsights)}
These insights are DERIVED from match events. Reduce confidence by 1 compared to full stats.
` : ''}
========================
${!data.oddsAvailable ? 'NO USABLE ODDS AVAILABLE' : data.oddsSource === 'pre-match' ? 'PRE-MATCH ODDS (REFERENCE ONLY)' : data.oddsSource === 'the-odds-api' ? 'LIVE ODDS (The Odds API fallback)' : 'LIVE ODDS SNAPSHOT (CANONICAL JSON)'}
========================
${JSON.stringify(data.oddsCanonical)}

ODDS_AVAILABLE: ${data.oddsAvailable}
ODDS_SOURCE: ${data.oddsSource}
ODDS_FETCHED_AT: ${data.oddsFetchedAt ?? 'unknown'} (match minute at fetch: ${data.minute})
CURRENT_TOTAL_GOALS: ${data.currentTotalGoals}
CURRENT_TOTAL_CORNERS: ${currentTotalCorners}
${data.oddsSource === 'pre-match' ? '\nCAUTION: These are PRE-MATCH opening odds fetched before kickoff. Live odds are unavailable for this match.\nYou CAN still use them as a baseline for market direction and value, but adjust confidence based on the current game state.\n' : ''}${data.oddsSource === 'the-odds-api' ? '\nNOTE: These odds are from The Odds API exact-event fallback. They may have slight delay vs Football API live odds.\n' : ''}${!data.oddsAvailable ? '\nNO_USABLE_ODDS: Treat odds as unavailable and be conservative.\n' : ''}${data.oddsSuspicious ? `\nODDS SANITY CHECK FAILED:\n${(data.oddsSanityWarnings || []).map((w) => '- ' + w).join('\n')}\nTreat ALL odds as UNRELIABLE. Behave as if ODDS_AVAILABLE = false.\n` : ''}
ODDS METHODOLOGY:
- Odds are the BEST available across multiple bookmakers (highest price per outcome).
- Markets with invalid implied-probability margins have been PRE-REMOVED by the system.
- If a market is present in the canonical data, it has PASSED margin validation and is RELIABLE.
- Focus your analysis on the markets that ARE present. Do not infer missing markets.

${buildPreMatchPredictionSection(data.prediction, data.preMatchPredictionSummary)}
========================
RECENT EVENTS (LAST 8)
========================
${JSON.stringify(data.eventsCompact)}

EVENT_COUNT: ${data.eventsCompact.length}

${buildPreviousRecommendationsSection(data)}
${buildMatchTimelineSection(data)}
${buildContinuityRulesSection(data)}
${buildHistoricalPerformanceSection(data)}
========================
CONFIG / MODE
========================
- MIN_CONFIDENCE: ${MIN_CONFIDENCE}
- MIN_ODDS: ${MIN_ODDS}
- CUSTOM_CONDITIONS: ${data.customConditions || '(none)'}
- EVIDENCE_MODE: ${data.evidenceMode}
- EVIDENCE_TIER: ${evidenceTierRule.tier} (${evidenceTierRule.label})

========================
AI-RECOMMENDED CONDITION
========================
RECOMMENDED_CONDITION: ${data.recommendedCondition || '(none)'}
RECOMMENDED_CONDITION_REASON: ${data.recommendedConditionReason || '(none)'}

============================================================
PRE-MATCH PREDICTION RULES
============================================================
- Pre-match data is contextual only.
- Must NEVER override live evidence.

WHEN TO USE PRE-MATCH DATA:
- When live stats are sparse but pre-match aligns with observed play style.
- When detecting market overreaction (e.g., strong favourite concedes early -> odds swing excessively).
- As supporting evidence when live play confirms pre-match expectations.
- H2H_SUMMARY: If one team dominates H2H (3+ wins in last 5), factor this into 1X2 assessment.
- TEAM_FORM_SEQUENCE: Recent WDLWW pattern reveals momentum - weight recent matches more.

WHEN TO IGNORE PRE-MATCH DATA:
- When live evidence clearly contradicts pre-match expectation.
- When the match situation has fundamentally changed (red cards, injuries, tactical shifts).

WEIGHT: Pre-match should contribute maximum 20% to your reasoning when used.
WEIGHT: Strategic context (motivation, rotation, congestion) can add up to 10% additional weight.

============================================================
GLOBAL RULES
============================================================
- Status 1H or 2H = LIVE -> normal analysis.
- Status HT: max confidence 7, max stake 4%.
- Status NS/FT/PST/CANC: should_push = false.

DATA RULES:
- STATS + ODDS available: may recommend if all rules pass.
- STATS only (no odds): should_push = false normally, exception only if extremely clear.
- NO STATS but DERIVED INSIGHTS present: may recommend with confidence cap 7.
- NO STATS and no events: should_push = false normally.

EVIDENCE MODE RULES:
- Tier 1 / full_live_data: All supported markets can be evaluated if the rest of the rules pass.
- Tier 2 / stats_only: Analytical tier only. No actionable recommendation without reliable odds. Default should_push=false.
- Tier 3 / odds_events_only_degraded: ONLY evaluate O/U or Asian Handicap. confidence cap 6. stake cap 3%.
- Tier 4 / events_only_degraded or low_evidence: No actionable recommendation.
- If STATS_SOURCE = live-score-api-fallback, treat that fallback as the primary live stats source for this run. Do NOT blend or average it with missing API-Sports stats.

AUTHORITATIVE EVIDENCE HIERARCHY:
- CURRENT TIER FOR THIS MATCH: ${evidenceTierRule.tier} (${evidenceTierRule.label})
- Allowed markets in this tier: ${evidenceTierRule.allowedMarkets}
- Forbidden markets in this tier: ${evidenceTierRule.forbiddenMarkets}
- Operational rule: ${evidenceTierRule.operationalRule}
- NEVER choose a market outside the allowed tier, even if narrative context sounds persuasive.
- Narrative or strategic-context priors can support a pick inside the allowed tier, but can NEVER upgrade a forbidden market into an allowed one.

LATE GAME DISCIPLINE:
- minute >= ${LATE_PHASE_MINUTE}: be more conservative.
- minute >= ${VERY_LATE_PHASE_MINUTE}: exceptional circumstances only.
- minute >= ${ENDGAME_MINUTE}: default should_push = false, max stake 2%.

RED CARD PROTOCOL:
- Scan events for red cards. If found: add warning, reduce confidence by 1, re-evaluate.

MARKET SELECTION:
- 1X2 and BTTS No are Tier-1-only markets. They require full_live_data, confidence >= 7, significant stat gaps, and pre-match support.
- BTTS Yes requires at least Tier 1 evidence. Do NOT recommend BTTS from Tier 3 or Tier 4.
- AH and O/U are the only market families allowed in degraded Tier 3.
- Corners markets require Tier 1 live stats and live corners data. No corners recommendation in Tier 2-4.
- If not met, evaluate Over/Under instead.
- If DYNAMIC PERFORMANCE PRIORS are present and the chosen market is tagged as a caution prior, require a stronger live edge or skip the bet.
- Odds >= 2.50: confidence cap 6, stake cap 3%.
- Before minute 30: early game caution, 1X2 should_push=false before minute 35.
- Over 3.5+: need current goals >= line-1 or clearly open match.
- CORNERS O/U: MUST calculate cornerTempoSoFar, cornersNeeded, cornersPerMinuteNeeded.
  - If cornersPerMinuteNeeded > cornerTempoSoFar x 1.5 -> should_push = false.
  - If cornersNeeded >= 3 AND minutesRemaining <= 20 -> should_push = false.
  - After minute 75: Corners Over requires cornersNeeded <= 1.
  - After minute 80: should_push = false for any Corners Over.
- Score 0-0 after minute 55: prefer GOALS Under markets (under_2.5, under_1.5). NOT corners_under.
- risk_level = HIGH -> should_push = false.

BTTS RULES (DATA-DRIVEN):
- BTTS YES:
  - MANDATORY: Calculate break_even_rate = 1/odds. Estimated probability must exceed break_even_rate + 5%.
  - Odds >= 2.00 for BTTS Yes -> should_push = false unless BOTH teams have shots_on_target >= 2.
  - "Pressure != Goals": Need evidence BOTH teams are dangerous. If weaker team has 0 SOT -> no BTTS Yes.
  - Score 0-0 after minute 60: reduce confidence by 2 for BTTS Yes, prefer Under.
- BTTS NO:
  - Requires odds >= 1.70.
  - If BOTH teams have shots_on_target >= 2 -> should_push = false for BTTS No.
  - Only justified: score gap >= 2, OR minute >= 70 + one team has 0 SOT, OR minute >= 75 + clean sheet.

BREAK-EVEN CHECK (MANDATORY FOR ALL):
- Before recommending ANY market: break_even_rate = 1/odds x 100.
- Estimated probability must exceed break_even_rate by >= 3% (edge >= 3%).
- If edge < 3% -> should_push = false.
- Report valuation using exact break-even from odds plus a rounded fair-value estimate or range.
- Preferred wording style in reasoning_en: "Break-even about X%. My fair range is around Y-Z%. Edge looks about W%."
- Do NOT pretend to know false precision. Rounded estimates are better than fabricated exact decimals.

ODDS RULES:
- Treat odds exactly as provided, no adjustments.
- NEVER invent a price that is not present in the canonical odds for this run.
- Suspicious odds (contradicting match dynamics) -> treat as unreliable -> should_push = false normally.
- Price < ${MIN_ODDS} -> should_push = false.

STAKE GUIDELINES:
- confidence 8-10: stake 5-8%
- confidence 6-7: stake 3-5%
- confidence 5: stake 2-3%
- confidence < 5: should_push = false, stake = 0

============================================================
CUSTOM CONDITIONS (INDEPENDENT EVALUATION)
============================================================
should_push = your investment recommendation.
custom_condition_matched = whether user's condition pattern is detected (factual check).
These are TWO SEPARATE decisions.

When custom_condition_matched = true, provide:
- condition_triggered_suggestion (bet or "No bet - reason")
- condition_triggered_reasoning_en/vi
- condition_triggered_confidence, condition_triggered_stake

============================================================
OUTPUT FORMAT - STRICT JSON
============================================================
{
  "should_push": boolean,
  "selection": string,
  "bet_market": string,
  "market_chosen_reason": string,
  "confidence": number,
  "reasoning_en": string,
  "reasoning_vi": string,
  "warnings": string[],
  "value_percent": number,
  "risk_level": "LOW" | "MEDIUM" | "HIGH",
  "stake_percent": number,
  "custom_condition_matched": boolean,
  "custom_condition_status": "none" | "evaluated" | "parse_error",
  "custom_condition_summary_en": string,
  "custom_condition_summary_vi": string,
  "custom_condition_reason_en": string,
  "custom_condition_reason_vi": string,
  "condition_triggered_suggestion": string,
  "condition_triggered_reasoning_en": string,
  "condition_triggered_reasoning_vi": string,
  "condition_triggered_confidence": number,
  "condition_triggered_stake": number
}

ALL fields must exist. selection="" when should_push=false. bet_market="" when should_push=false.
The FIRST character MUST be "{" and the LAST must be "}".
NO markdown, NO code fences, NO commentary outside JSON.
`;
}
