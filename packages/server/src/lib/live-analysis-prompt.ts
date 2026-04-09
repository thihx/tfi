/** O/U and market-balance changes: follow `docs/live-monitor-ai-ou-under-bias.md` (Mandatory order) before editing. */
import { normalizeMarket } from './normalize-market.js';
import {
  buildPrematchExpertFeaturesV1,
  type PrematchExpertFeaturesV1,
} from './prematch-expert-features.js';
import { flattenLeagueProfileData } from '../repos/league-profiles.repo.js';
import { buildProfileMetricSemanticsSection } from './profile-metric-semantics.js';

export type PromptStatsSource = 'api-football' | string;
export type PromptAnalysisMode = 'auto' | 'system_force' | 'manual_force';
export type PromptEvidenceMode =
  | 'full_live_data'
  | 'stats_only'
  | 'odds_events_only_degraded'
  | 'events_only_degraded'
  | 'low_evidence';

export const LIVE_ANALYSIS_PROMPT_VERSIONS = ['v4-evidence-hardened', 'v5-compact-a', 'v6-betting-discipline-a', 'v6-betting-discipline-b', 'v6-betting-discipline-c', 'v7-profile-overlay-discipline-a', 'v8-market-balance-followup-a', 'v8-market-balance-followup-b', 'v8-market-balance-followup-c', 'v8-market-balance-followup-d', 'v8-market-balance-followup-e', 'v8-market-balance-followup-f', 'v8-market-balance-followup-g', 'v8-market-balance-followup-h', 'v8-market-balance-followup-i', 'v8-market-balance-followup-j', 'v9-legacy-lean-a', 'v10-hybrid-legacy-a', 'v10-hybrid-legacy-b', 'v10-hybrid-legacy-c', 'v10-hybrid-legacy-d', 'v10-hybrid-legacy-e', 'v10-hybrid-legacy-f', 'v10-hybrid-legacy-g'] as const;
export type LiveAnalysisPromptVersion = (typeof LIVE_ANALYSIS_PROMPT_VERSIONS)[number];
/** Default live-analysis prompt when `LIVE_ANALYSIS_ACTIVE_PROMPT_VERSION` is unset or invalid. */
export const LIVE_ANALYSIS_PROMPT_VERSION = 'v10-hybrid-legacy-b';
/** Reference compact version for tests/replay tooling; runtime shadow uses env (`LIVE_ANALYSIS_SHADOW_*`), not this constant. */
export const LIVE_ANALYSIS_PROMPT_CANDIDATE_VERSION = 'v10-hybrid-legacy-e';

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

export type PromptStatsDetailLevel = 'basic-only' | 'advanced-upgraded';

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

export interface LiveAnalysisPromptFollowUpMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface LiveAnalysisPromptLineupsSnapshot {
  available: boolean;
  teams: Array<{
    side: 'home' | 'away';
    teamName: string;
    formation: string | null;
    coachName: string | null;
    starters: string[];
    substitutes: string[];
  }>;
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
    shots_off_target?: TwoSideValue;
    shots_inside_box?: TwoSideValue;
    shots_outside_box?: TwoSideValue;
    expected_goals?: TwoSideValue;
    goals_prevented?: TwoSideValue;
    passes_percent?: TwoSideValue;
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
  leagueProfile?: Record<string, unknown> | null;
  homeTeamProfile?: Record<string, unknown> | null;
  awayTeamProfile?: Record<string, unknown> | null;
  prematchExpertFeatures?: PrematchExpertFeaturesV1 | null;
  structuredPrematchAskAi?: boolean;
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
  userQuestion?: string;
  followUpHistory?: LiveAnalysisPromptFollowUpMessage[];
  lineupsSnapshot?: LiveAnalysisPromptLineupsSnapshot | null;
  /** Settled replay eval: snapshot came from a stored non-NO_BET recommendation. */
  settledReplayApprovedTrace?: boolean;
  /** Stored row canonical market (replay calibration anchor). */
  settledReplayOriginalBetMarket?: string;
  settledReplayOriginalSelection?: string;
}

function hasRenderableSideValue(value: unknown): boolean {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function pruneEmptyStatsCompact(
  statsCompact: Record<string, TwoSideValue>,
): Record<string, TwoSideValue> {
  return Object.fromEntries(
    Object.entries(statsCompact).filter(([, value]) => {
      if (!value || typeof value !== 'object') return false;
      return hasRenderableSideValue((value as TwoSideValue).home)
        || hasRenderableSideValue((value as TwoSideValue).away);
    }),
  ) as Record<string, TwoSideValue>;
}

const BASIC_STATS_KEYS = [
  'possession',
  'shots',
  'shots_on_target',
  'corners',
  'fouls',
  'offsides',
  'yellow_cards',
  'red_cards',
  'goalkeeper_saves',
  'blocked_shots',
  'total_passes',
  'passes_accurate',
] as const;

const ADVANCED_STATS_KEYS = [
  'shots_off_target',
  'shots_inside_box',
  'shots_outside_box',
  'expected_goals',
  'goals_prevented',
  'passes_percent',
] as const;

function pickStatsSubset(
  statsCompact: LiveAnalysisPromptInput['statsCompact'],
  keys: readonly string[],
): Record<string, TwoSideValue> {
  return Object.fromEntries(
    Object.entries(statsCompact).filter(([key]) => keys.includes(key)),
  ) as Record<string, TwoSideValue>;
}

function countRenderableStatPairs(statsCompact: Record<string, TwoSideValue>): number {
  return Object.values(statsCompact).filter((value) => (
    hasRenderableSideValue(value.home) || hasRenderableSideValue(value.away)
  )).length;
}

function countComparableStatPairs(statsCompact: Record<string, TwoSideValue>): number {
  return Object.values(statsCompact).filter((value) => (
    hasRenderableSideValue(value.home) && hasRenderableSideValue(value.away)
  )).length;
}

function hasSufficientAdvancedStats(statsCompact: Record<string, TwoSideValue>): boolean {
  if (countRenderableStatPairs(statsCompact) < 2) return false;
  return countComparableStatPairs(statsCompact) >= 2;
}

export function getPromptStatsDetailLevel<T extends object>(statsCompact: T): PromptStatsDetailLevel {
  return hasSufficientAdvancedStats(statsCompact as Record<string, TwoSideValue>) ? 'advanced-upgraded' : 'basic-only';
}

function buildAdvancedStatsSection(compact: boolean, statsCompact: Record<string, TwoSideValue>): string {
  if (getPromptStatsDetailLevel(statsCompact) !== 'advanced-upgraded') return '';

  return compact
    ? `========================
ADVANCED QUANT STATS
========================
ADVANCED_STATS_POLICY: This optional block appears only because this match has sufficient advanced stat coverage. If absent in other matches, do not assume missing values are zero.
${JSON.stringify(statsCompact)}
`
    : `========================
ADVANCED QUANT STATS (OPTIONAL)
========================
ADVANCED_STATS_POLICY: This block is rendered only when the source provides sufficient advanced stat coverage for this specific match.
Do NOT assume these fields exist for every competition. If the block is absent, treat advanced stats as unavailable rather than zero.
${JSON.stringify(statsCompact)}

`;
}

function hasNonEmptyObject(value: Record<string, unknown> | null | undefined): value is Record<string, unknown> {
  return !!value && Object.keys(value).length > 0;
}

function hasCustomConditionContext(data: LiveAnalysisPromptInput): boolean {
  return !!(
    data.customConditions.trim()
    || data.recommendedCondition.trim()
    || data.recommendedConditionReason.trim()
  );
}

function buildAiRecommendedConditionSection(data: LiveAnalysisPromptInput): string {
  if (!hasCustomConditionContext(data)) {
    return `========================
AI-RECOMMENDED CONDITION
========================
AI-RECOMMENDED CONDITION: none for this run.

`;
  }

  return `========================
AI-RECOMMENDED CONDITION
========================
RECOMMENDED_CONDITION: ${data.recommendedCondition || '(none)'}
RECOMMENDED_CONDITION_REASON: ${data.recommendedConditionReason || '(none)'}

`;
}

function buildCustomConditionsInstructionSection(compact: boolean, data: LiveAnalysisPromptInput): string {
  if (!hasCustomConditionContext(data)) {
    return compact
      ? `CUSTOM CONDITIONS:
- No custom condition is active for this run.
- Set custom_condition_matched=false, custom_condition_status="none", keep condition text fields empty, confidence/stake=0.
`
      : `============================================================
CUSTOM CONDITIONS (INDEPENDENT EVALUATION)
============================================================
No custom condition is active for this run.
- Set custom_condition_matched = false
- Set custom_condition_status = "none"
- Keep custom condition summary/reason/suggestion/reasoning fields empty
- Set condition_triggered_confidence = 0 and condition_triggered_stake = 0

`;
  }

  return compact
    ? `CUSTOM CONDITIONS:
- should_push and custom_condition_matched are separate decisions
- If custom_condition_matched=true, provide suggestion, reasoning, confidence, and stake for the triggered condition path
- If the triggered suggestion repeats an existing same-thesis position, default to alert-only. Only set condition_triggered_special_override=true when the SAME canonical line now has materially better price and you can explain why.
`
    : `============================================================
CUSTOM CONDITIONS (INDEPENDENT EVALUATION)
============================================================
should_push = your investment recommendation.
custom_condition_matched = whether user's condition pattern is detected (factual check).
These are TWO SEPARATE decisions.

When custom_condition_matched = true, provide:
- condition_triggered_suggestion (bet or "No bet - reason")
- condition_triggered_reasoning_en/vi
- condition_triggered_confidence, condition_triggered_stake
- condition_triggered_special_override = true ONLY when a repeated same-thesis condition alert deserves a saved update on the SAME canonical line with materially better price/risk
- condition_triggered_special_override_reason_en/vi explaining that exceptional override

Default behavior when same-thesis exposure already exists:
- keep alerting if the watched condition is still true
- do NOT create another saved bet just because the line is later or looks safer now
- if you cannot justify a true exceptional override, set condition_triggered_special_override = false

`;
}

function buildLowEvidenceConditionGuardSection(compact: boolean, data: LiveAnalysisPromptInput): string {
  const hasCustomCondition = !!data.customConditions.trim();
  if (data.evidenceMode !== 'low_evidence' || !hasCustomCondition) return '';

  return compact
    ? `LOW EVIDENCE CONDITION GUARD:
- This match is in EVIDENCE_MODE=low_evidence.
- Do NOT produce an actionable AI bet for this run.
- Keep should_push=false, selection="", bet_market="", confidence=0, stake_percent=0 for the AI recommendation path.
- Use the available scoreboard/event facts only to evaluate CUSTOM_CONDITIONS.
- If a watch condition is satisfied, fill the custom_condition_* and condition_triggered_* fields naturally for alerting.
`
    : `============================================================
LOW EVIDENCE CONDITION GUARD
============================================================
This match is in EVIDENCE_MODE = low_evidence.
- Do NOT produce an actionable AI recommendation for this run.
- Set should_push = false for the AI recommendation path.
- Keep selection = "" and bet_market = "" for the AI recommendation path.
- Use only the available scoreboard/event facts in this prompt to evaluate:
  - CUSTOM_CONDITIONS
- If a watch condition is satisfied, populate the custom_condition_* and condition_triggered_* fields naturally for alerting.
- If the available facts are not enough to evaluate the watch condition, set custom_condition_status = "parse_error" and explain what is missing.

`;
}

function isStructuredPrematchAskAi(data: LiveAnalysisPromptInput): boolean {
  return data.structuredPrematchAskAi === true;
}

function buildStructuredPrematchAskAiSection(compact: boolean, data: LiveAnalysisPromptInput): string {
  if (!isStructuredPrematchAskAi(data)) return '';

  return compact
    ? `STRUCTURED PREMATCH ASK AI OVERRIDE:
- This is a MANUAL Ask AI request for a NOT STARTED top-league match.
- Live telemetry is sparse, but structured prematch context is available from profile priors, strategic context, and provider prediction when available.
- You MAY provide one cautious prematch thesis if the structured pre-match evidence is coherent.
- Do NOT invent live pressure, momentum, or line-movement facts that are not present.
- Keep confidence and stake conservative versus normal full-live analysis.
- If the structured prematch evidence is still too thin, return should_push=false with a clear no-bet explanation.
`
    : `============================================================
STRUCTURED PREMATCH ASK AI OVERRIDE
============================================================
This is a MANUAL Ask AI request for a NOT STARTED top-league match.
Live telemetry is sparse, but structured prematch context is available from:
- league/team profile priors
- strategic context
- provider prediction when available

You MAY provide one cautious prematch thesis if the structured pre-match evidence is coherent.
Rules:
- Do NOT invent live pressure, momentum, transitions, or line movement that are not present in the structured inputs.
- Treat this as a prematch-only read, not a live-trading read.
- Keep confidence and stake conservative relative to normal full-live analysis.
- If the structured pre-match evidence is still too thin or conflicting, return should_push=false and explain the limitation clearly.

`;
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

function getEvidenceTierRule(data: LiveAnalysisPromptInput): EvidenceTierRule {
  if (isStructuredPrematchAskAi(data)) {
    return {
      tier: 'tier_2',
      label: 'Structured prematch context for manual Ask AI',
      allowedMarkets: 'Selective prematch O/U, AH, or 1X2 only when supported by provider prediction and profile priors',
      forbiddenMarkets: 'Corners, BTTS No without strong supporting priors, and any market that depends on invented live telemetry',
      operationalRule: 'Manual prematch override. Use structured prematch evidence only and keep confidence/stake conservative.',
    };
  }

  const evidenceMode = data.evidenceMode;
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

function getLeagueProfileQuantitative(leagueProfile: Record<string, unknown>): Record<string, number> {
  const normalized = normalizeLeagueProfileRecord(leagueProfile);
  return Object.fromEntries(
    [
      'avg_goals',
      'over_2_5_rate',
      'btts_rate',
      'late_goal_rate_75_plus',
      'avg_corners',
      'avg_cards',
    ]
      .map((key) => [key, normalized[key]] as const)
      .filter(([, value]) => typeof value === 'number'),
  ) as Record<string, number>;
}

function normalizeLeagueProfileRecord(leagueProfile: Record<string, unknown>): Record<string, unknown> {
  const payload = leagueProfile.profile && typeof leagueProfile.profile === 'object'
    ? leagueProfile.profile as Record<string, unknown>
    : leagueProfile;
  return {
    ...flattenLeagueProfileData(payload),
    notes_en: typeof leagueProfile.notes_en === 'string'
      ? leagueProfile.notes_en
      : typeof payload.notes_en === 'string'
        ? payload.notes_en
        : '',
    notes_vi: typeof leagueProfile.notes_vi === 'string'
      ? leagueProfile.notes_vi
      : typeof payload.notes_vi === 'string'
        ? payload.notes_vi
        : '',
  };
}

function buildLeagueProfileSection(leagueProfile: Record<string, unknown> | null): string {
  if (!leagueProfile || typeof leagueProfile !== 'object') return '';
  const normalizedProfile = normalizeLeagueProfileRecord(leagueProfile);
  const quantitative = getLeagueProfileQuantitative(normalizedProfile);
  const lines: string[] = [];

  const push = (label: string, value: unknown) => {
    const text = readStrategicText(value);
    if (text) lines.push(`${label}: ${text}`);
  };

  push('TEMPO_TIER', normalizedProfile.tempo_tier);
  push('GOAL_TENDENCY', normalizedProfile.goal_tendency);
  push('HOME_ADVANTAGE_TIER', normalizedProfile.home_advantage_tier);
  push('CORNERS_TENDENCY', normalizedProfile.corners_tendency);
  push('CARDS_TENDENCY', normalizedProfile.cards_tendency);
  push('VOLATILITY_TIER', normalizedProfile.volatility_tier);
  push('DATA_RELIABILITY_TIER', normalizedProfile.data_reliability_tier);

  // Inject quantitative baselines as labeled lines — all figures are league-wide
  // per-match averages with BOTH teams combined, not per-team.
  if (Object.keys(quantitative).length > 0) {
    lines.push('LEAGUE_BASELINES (per match, both teams combined, league-wide average):');
    if (quantitative['avg_goals']             != null) lines.push(`  avg_goals:             ${quantitative['avg_goals']} goals/match`);
    if (quantitative['over_2_5_rate']         != null) lines.push(`  over_2_5_rate:         ${(quantitative['over_2_5_rate']! * 100).toFixed(0)}% of matches end with >2.5 goals`);
    if (quantitative['btts_rate']             != null) lines.push(`  btts_rate:             ${(quantitative['btts_rate']! * 100).toFixed(0)}% of matches where both teams scored`);
    if (quantitative['late_goal_rate_75_plus']!= null) lines.push(`  late_goal_rate_75plus: ${(quantitative['late_goal_rate_75_plus']! * 100).toFixed(0)}% of matches have a goal after 75'`);
    if (quantitative['avg_corners']           != null) lines.push(`  avg_corners:           ${quantitative['avg_corners']} corners/match`);
    if (quantitative['avg_cards']             != null) lines.push(`  avg_cards:             ${quantitative['avg_cards']} yellow cards/match`);
  }

  const notes = readStrategicText(normalizedProfile.notes_en);
  if (notes) lines.push(`LEAGUE_PROFILE_NOTES: ${notes}`);
  if (lines.length === 0) return '';

  return `========================
LEAGUE PROFILE
========================
${lines.join('\n')}

LEAGUE PROFILE RULES:
- Treat league profile as a competition prior only. It calibrates expectations but never overrides strong live evidence.
- Low DATA_RELIABILITY_TIER means you should be more conservative, especially for niche markets and thin evidence.
- High VOLATILITY_TIER means wider outcome spread: require cleaner value gaps and avoid aggressive confidence.
- Baseline stats are league-wide per-match averages (both teams combined). Use them to calibrate expected pace, not as a guarantee for any individual match.
- Market-specific baselines (corners, cards, goals) support a thesis only when live evidence and current game state agree.

`;
}

function buildStrategicContextSection(strategicContext: Record<string, unknown> | null): string {
  if (!strategicContext || typeof strategicContext !== 'object') return '';
  const ctx = strategicContext;
  if (ctx.version !== 2 || !ctx.source_meta || typeof ctx.source_meta !== 'object') return '';
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
  if (sourceMeta.prediction_fallback_used === true) {
    lines.push('PREDICTION_FALLBACK_USED: YES');
  }
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

function buildPrematchExpertFeaturesSection(
  data: LiveAnalysisPromptInput,
  compact: boolean,
): string {
  const features = data.prematchExpertFeatures ?? buildPrematchExpertFeaturesV1({
    strategicContext: data.strategicContext,
    leagueProfile: data.leagueProfile ?? null,
    prediction: data.prediction,
    homeTeamProfile: data.homeTeamProfile ?? null,
    awayTeamProfile: data.awayTeamProfile ?? null,
  });

  if (!features) return '';

  const rules = compact
    ? [
      'PREMATCH FEATURE RULES:',
      '- Use PREMATCH_EXPERT_FEATURES_V1 as a secondary prior only.',
      '- Never override live stats/events/odds with prematch features.',
      '- If availability is minimal or prematch_noise_penalty is high, down-weight it heavily.',
      '- Prefer derived scores and coverage/trust fields over any latent narrative reading.',
    ]
    : [
      'PREMATCH FEATURE RULES:',
      '- Use PREMATCH_EXPERT_FEATURES_V1 as a secondary prior only. Live stats/events/odds remain primary.',
      '- Never override strong live evidence with prematch features.',
      '- If meta.availability is minimal or trust_and_coverage.prematch_noise_penalty is high, treat the block as weak guidance only.',
      '- Prefer the derived scores and coverage/trust fields over any latent narrative interpretation.',
      '- Optional team profile features should only sharpen a thesis that is already compatible with live evidence.',
    ];

  return `========================
PREMATCH EXPERT FEATURES V1
========================
${JSON.stringify(features)}
${rules.join('\n')}

`;
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
  if (ctx.version !== 2 || !ctx.source_meta || typeof ctx.source_meta !== 'object') return '';
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
  if (sourceMeta.prediction_fallback_used === true) {
    lines.push('PREDICTION_FALLBACK_USED: YES');
  }
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

function buildLeagueProfileSectionCompact(leagueProfile: Record<string, unknown> | null): string {
  if (!leagueProfile || typeof leagueProfile !== 'object') return '';
  const normalizedProfile = normalizeLeagueProfileRecord(leagueProfile);
  const quantitative = getLeagueProfileQuantitative(normalizedProfile);
  const lines: string[] = [];

  const push = (label: string, value: unknown) => {
    const text = readStrategicText(value);
    if (text) lines.push(`${label}: ${text}`);
  };

  push('TEMPO_TIER', normalizedProfile.tempo_tier);
  push('GOAL_TENDENCY', normalizedProfile.goal_tendency);
  push('HOME_ADVANTAGE_TIER', normalizedProfile.home_advantage_tier);
  push('CORNERS_TENDENCY', normalizedProfile.corners_tendency);
  push('CARDS_TENDENCY', normalizedProfile.cards_tendency);
  push('VOLATILITY_TIER', normalizedProfile.volatility_tier);
  push('DATA_RELIABILITY_TIER', normalizedProfile.data_reliability_tier);
  if (Object.keys(quantitative).length > 0) {
    const parts: string[] = [];
    if (quantitative['avg_goals']             != null) parts.push(`avg_goals=${quantitative['avg_goals']}g/match`);
    if (quantitative['over_2_5_rate']         != null) parts.push(`o25=${(quantitative['over_2_5_rate']! * 100).toFixed(0)}%`);
    if (quantitative['btts_rate']             != null) parts.push(`btts=${(quantitative['btts_rate']! * 100).toFixed(0)}%`);
    if (quantitative['late_goal_rate_75_plus']!= null) parts.push(`late75+=${(quantitative['late_goal_rate_75_plus']! * 100).toFixed(0)}%`);
    if (quantitative['avg_corners']           != null) parts.push(`avg_corners=${quantitative['avg_corners']}/match`);
    if (quantitative['avg_cards']             != null) parts.push(`avg_cards=${quantitative['avg_cards']}/match`);
    if (parts.length > 0) lines.push(`LEAGUE_BASELINES (both teams/match): ${parts.join(' | ')}`);
  }
  const notes = readStrategicText(normalizedProfile.notes_en);
  if (notes) lines.push(`NOTES: ${notes}`);
  if (lines.length === 0) return '';

  return `========================
LEAGUE PROFILE
========================
${lines.join('\n')}

LEAGUE PROFILE RULES:
- Competition prior only; live evidence dominates.
- Low data reliability => lower aggression.
- High volatility => require cleaner edges.
- Baselines are league-wide per-match averages (both teams combined). Market tendencies apply only when live evidence aligns.

`;
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

function buildContinuityRulesSectionCompact(
  data: LiveAnalysisPromptInput,
  promptVersion: LiveAnalysisPromptVersion,
): string {
  const recs = Array.isArray(data.previousRecommendations) ? data.previousRecommendations : [];
  if (recs.length === 0) return '';
  const advancedRules = (
    promptVersion === 'v6-betting-discipline-b'
    || promptVersion === 'v6-betting-discipline-c'
    || promptVersion === 'v7-profile-overlay-discipline-a'
    || isV8PromptVersion(promptVersion)
  )
    ? `- A same-thesis follow-up needs BOTH materially stronger live evidence AFTER the last bet AND a clearly better structural entry. Time passing alone is never enough.
- Do not re-enter the same thesis just because the new line is closer to the current score or looks safer now. If you already hold that view, another entry usually means laddering the same position.
- If the earlier bet already expressed the thesis, the burden of proof for a second entry is extremely high. In most cases, return should_push=false.
`
    : '';
  return `CONTINUITY RULES:
- Reference the latest recommendation and explain continuity or change.
- Do not repeat the same selection + bet_market unless odds improved by >= 0.10, OR match state changed materially, OR >= 5 minutes passed and evidence is materially stronger.
- Never repeat only because time passed.
- If the last pick is not materially stronger now, return should_push=false and say: "No significant strengthening since last recommendation at minute [X]."
${advancedRules}
- The same discipline applies to the condition-triggered suggestion path. Repeated condition alerts are allowed, but a repeated same-thesis saved bet needs exceptional justification on the SAME canonical line. Otherwise keep it alert-only.

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
  return promptVersion === 'v5-compact-a'
    || promptVersion === 'v6-betting-discipline-a'
    || promptVersion === 'v6-betting-discipline-b'
    || promptVersion === 'v6-betting-discipline-c'
    || promptVersion === 'v7-profile-overlay-discipline-a'
    || isV9PromptVersion(promptVersion)
    || isV10PromptVersion(promptVersion)
    || isV8PromptVersion(promptVersion);
}

function isBettingDisciplinePromptVersion(promptVersion: LiveAnalysisPromptVersion): boolean {
  return promptVersion === 'v6-betting-discipline-a'
    || promptVersion === 'v6-betting-discipline-b'
    || promptVersion === 'v6-betting-discipline-c'
    || promptVersion === 'v7-profile-overlay-discipline-a'
    || isV9PromptVersion(promptVersion)
    || isV10PromptVersion(promptVersion)
    || isV8PromptVersion(promptVersion);
}

function isV8PromptVersion(promptVersion: LiveAnalysisPromptVersion): boolean {
  return promptVersion === 'v8-market-balance-followup-a'
    || promptVersion === 'v8-market-balance-followup-b'
    || promptVersion === 'v8-market-balance-followup-c'
    || promptVersion === 'v8-market-balance-followup-d'
    || promptVersion === 'v8-market-balance-followup-e'
    || promptVersion === 'v8-market-balance-followup-f'
    || promptVersion === 'v8-market-balance-followup-g'
    || promptVersion === 'v8-market-balance-followup-h'
    || promptVersion === 'v8-market-balance-followup-i'
    || promptVersion === 'v8-market-balance-followup-j';
}

function isV9PromptVersion(promptVersion: LiveAnalysisPromptVersion): boolean {
  return promptVersion === 'v9-legacy-lean-a';
}

function isV10PromptVersion(promptVersion: LiveAnalysisPromptVersion): boolean {
  return promptVersion === 'v10-hybrid-legacy-a'
    || promptVersion === 'v10-hybrid-legacy-b'
    || promptVersion === 'v10-hybrid-legacy-c'
    || promptVersion === 'v10-hybrid-legacy-d'
    || promptVersion === 'v10-hybrid-legacy-e'
    || promptVersion === 'v10-hybrid-legacy-f';
}

function isV10HybridLegacyB(promptVersion: LiveAnalysisPromptVersion): boolean {
  return promptVersion === 'v10-hybrid-legacy-b'
    || promptVersion === 'v10-hybrid-legacy-c'
    || promptVersion === 'v10-hybrid-legacy-d'
    || promptVersion === 'v10-hybrid-legacy-e'
    || promptVersion === 'v10-hybrid-legacy-f'
    || promptVersion === 'v10-hybrid-legacy-g';
}

function isV10HybridLegacyC(promptVersion: LiveAnalysisPromptVersion): boolean {
  return promptVersion === 'v10-hybrid-legacy-c'
    || promptVersion === 'v10-hybrid-legacy-d'
    || promptVersion === 'v10-hybrid-legacy-e'
    || promptVersion === 'v10-hybrid-legacy-f'
    || promptVersion === 'v10-hybrid-legacy-g';
}

function isV10HybridLegacyD(promptVersion: LiveAnalysisPromptVersion): boolean {
  return promptVersion === 'v10-hybrid-legacy-d';
}

function isV10HybridLegacyE(promptVersion: LiveAnalysisPromptVersion): boolean {
  return promptVersion === 'v10-hybrid-legacy-e';
}

function isV10HybridLegacyF(promptVersion: LiveAnalysisPromptVersion): boolean {
  return promptVersion === 'v10-hybrid-legacy-f'
    || promptVersion === 'v10-hybrid-legacy-g';
}

function isV10HybridLegacyG(promptVersion: LiveAnalysisPromptVersion): boolean {
  return promptVersion === 'v10-hybrid-legacy-g';
}

function readProfileRecord(profile: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return null;
  const nested = profile['profile'];
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) return nested as Record<string, unknown>;
  return profile;
}

function readWindowSnapshot(profile: Record<string, unknown> | null | undefined): {
  sampleMatches: number | null;
  eventCoverage: number | null;
} {
  const record = readProfileRecord(profile);
  const window = record?.['window'];
  if (!window || typeof window !== 'object' || Array.isArray(window)) {
    return { sampleMatches: null, eventCoverage: null };
  }
  const sampleMatches = Number((window as Record<string, unknown>)['sample_matches']);
  const eventCoverage = Number((window as Record<string, unknown>)['event_coverage']);
  return {
    sampleMatches: Number.isFinite(sampleMatches) ? sampleMatches : null,
    eventCoverage: Number.isFinite(eventCoverage) ? eventCoverage : null,
  };
}

function readTeamOverlaySnapshot(profile: Record<string, unknown> | null | undefined): {
  sourceMode: string;
  sourceConfidence: string | null;
} {
  const record = readProfileRecord(profile);
  const overlay = record?.['tactical_overlay'];
  if (!overlay || typeof overlay !== 'object' || Array.isArray(overlay)) {
    return { sourceMode: 'unknown', sourceConfidence: null };
  }
  const sourceMode = String((overlay as Record<string, unknown>)['source_mode'] ?? 'unknown').trim() || 'unknown';
  const sourceConfidenceRaw = (overlay as Record<string, unknown>)['source_confidence'];
  return {
    sourceMode,
    sourceConfidence: typeof sourceConfidenceRaw === 'string' && sourceConfidenceRaw.trim() !== ''
      ? sourceConfidenceRaw
      : null,
  };
}

function buildProfileAndOverlayDisciplineSectionCompact(data: LiveAnalysisPromptInput, promptVersion: LiveAnalysisPromptVersion): string {
  if (promptVersion !== 'v7-profile-overlay-discipline-a' && !isV8PromptVersion(promptVersion)) return '';

  const leagueWindow = readWindowSnapshot(data.leagueProfile ?? null);
  const homeWindow = readWindowSnapshot(data.homeTeamProfile ?? null);
  const awayWindow = readWindowSnapshot(data.awayTeamProfile ?? null);
  const homeOverlay = readTeamOverlaySnapshot(data.homeTeamProfile ?? null);
  const awayOverlay = readTeamOverlaySnapshot(data.awayTeamProfile ?? null);
  const bothNeutral = ['default_neutral', 'unknown', 'none'].includes(homeOverlay.sourceMode)
    && ['default_neutral', 'unknown', 'none'].includes(awayOverlay.sourceMode);

  return `========================
PROFILE / OVERLAY DISCIPLINE
========================
- LEAGUE_PROFILE_WINDOW: sample_matches=${leagueWindow.sampleMatches ?? 'unknown'}, event_coverage=${leagueWindow.eventCoverage ?? 'unknown'}
- HOME_TEAM_PROFILE_WINDOW: sample_matches=${homeWindow.sampleMatches ?? 'unknown'}, event_coverage=${homeWindow.eventCoverage ?? 'unknown'}
- AWAY_TEAM_PROFILE_WINDOW: sample_matches=${awayWindow.sampleMatches ?? 'unknown'}, event_coverage=${awayWindow.eventCoverage ?? 'unknown'}
- HOME_TACTICAL_OVERLAY: source_mode=${homeOverlay.sourceMode}, source_confidence=${homeOverlay.sourceConfidence ?? 'none'}
- AWAY_TACTICAL_OVERLAY: source_mode=${awayOverlay.sourceMode}, source_confidence=${awayOverlay.sourceConfidence ?? 'none'}

V7 DISCIPLINE RULES:
- Quantitative profile priors are supporting evidence only. They are stronger when sample size and event coverage are respectable; they are weak when coverage is thin or unknown.
- If PREMATCH_EXPERT_FEATURES_V1 implies weak/none prior strength, default should_push=false unless live evidence is clearly one-sided and actionable.
- A single narrative item such as motivation, H2H, or one absence note must NOT override weak profile coverage.
- Tactical overlay is provenance-sensitive:
  - source_mode=default_neutral or unknown => treat tactical labels as unavailable, not as evidence.
  - source_mode=llm_assisted with low/medium confidence => tiebreaker only, never a primary reason to bet.
  - source_mode=curated or manual_override with high confidence => supporting prior only, still secondary to live evidence.
- If both team overlays are neutral/unknown (${bothNeutral ? 'currently true' : 'currently false'}), assume tactical context is effectively unavailable for this run.
- If provider prediction is absent and profile coverage is thin, do not manufacture conviction from narrative enrichment. Return no bet.
- In structured prematch Ask AI mode, prefer patience: if the priors do not align cleanly, return should_push=false and explain what confirmation is still missing.
${isV8PromptVersion(promptVersion) ? `- V8 PRIOR ALIGNMENT RULE: before backing generic goals_under, explicitly classify the league/team priors as aligned, neutral, or contradictory. If they are contradictory and the live evidence is not overwhelming, return no bet.
- V8 PRIOR ALIGNMENT RULE: priors may confirm or contradict a live thesis, but they must never replace live evidence.
- V8 MARKET BALANCE RULE: when a favourite/control thesis is live on either side and priors align, consider 1x2_home, 1x2_away, asian_handicap_home, or asian_handicap_away (only keys listed in EXACT ENUMS, including ADJACENT AH when present) before defaulting to generic goals_under.
` : ''}

`;
}

function buildFollowUpContextSection(data: LiveAnalysisPromptInput, compact: boolean): string {
  const question = String(data.userQuestion ?? '').trim();
  if (!question) {
    return compact
      ? 'FOLLOW_UP_MODE: none\n\n'
      : `========================
FOLLOW-UP CONTEXT
========================
FOLLOW_UP_MODE: none

`;
  }

  const historyLines = Array.isArray(data.followUpHistory)
    ? data.followUpHistory
        .slice(-4)
        .map((entry, index) => `- ${index + 1}. ${entry.role.toUpperCase()}: ${String(entry.text ?? '').trim()}`)
        .filter((line) => !line.endsWith(':'))
    : [];

  return compact
    ? `FOLLOW_UP_MODE: advisory_match_scoped
FOLLOW_UP_USER_QUESTION: ${question}
${historyLines.length > 0 ? `FOLLOW_UP_HISTORY:\n${historyLines.join('\n')}\n` : ''}FOLLOW_UP_RULES:
- Answer the user question directly, but stay grounded in THIS match snapshot only.
- Advisory only: do not assume this run will save or notify anything.
- If the user asks about a specific market, evaluate that market first, explain why it is acceptable or weak, then mention any better alternative only if clearly stronger.
- If the requested market is unavailable, logically impossible, or policy-unsafe, say so explicitly in follow_up_answer_en/vi.
- Whenever you mention a betting angle, explicitly name the market period (H1 or Full-time) and market family (European 1X2, Asian Handicap, Goals O/U, BTTS, or Corners O/U).
- If the user asks about the starting lineup, answer only from LINEUPS SNAPSHOT below.
- If the user asked about lineups and LINEUPS SNAPSHOT is unavailable, explicitly say lineup data is unavailable BEFORE answering any betting-market part of the question.
- Never guess or infer missing lineup details from other context.

`
    : `========================
FOLLOW-UP CONTEXT
========================
FOLLOW_UP_MODE: advisory_match_scoped
FOLLOW_UP_USER_QUESTION: ${question}
${historyLines.length > 0 ? `FOLLOW_UP_HISTORY:\n${historyLines.join('\n')}\n` : ''}FOLLOW_UP_RULES:
- Answer the user question directly, but stay grounded in THIS match snapshot only.
- Advisory only: do not assume this run will save or notify anything.
- If the user asks about a specific market, evaluate that market first, explain why it is acceptable or weak, then mention any better alternative only if clearly stronger.
- If the requested market is unavailable, logically impossible, or policy-unsafe, say so explicitly in follow_up_answer_en/vi.
- Whenever you mention a betting angle, explicitly name the market period (H1 or Full-time) and market family (European 1X2, Asian Handicap, Goals O/U, BTTS, or Corners O/U).
- If the user asks about the starting lineup, answer only from LINEUPS SNAPSHOT below.
- If the user asked about lineups and LINEUPS SNAPSHOT is unavailable, explicitly say lineup data is unavailable BEFORE answering any betting-market part of the question.
- Never guess or infer missing lineup details from other context.

`;
}

function buildLineupsSnapshotSection(data: LiveAnalysisPromptInput, compact: boolean): string {
  const shouldRender = String(data.userQuestion ?? '').trim().length > 0
    || (data.followUpHistory?.length ?? 0) > 0
    || data.lineupsSnapshot?.available === true;
  if (!shouldRender) return '';

  const snapshot = data.lineupsSnapshot;
  if (!snapshot?.available || !Array.isArray(snapshot.teams) || snapshot.teams.length === 0) {
    return compact
      ? 'LINEUPS_SNAPSHOT: unavailable\n\n'
      : `========================
LINEUPS SNAPSHOT
========================
LINEUPS_SNAPSHOT: unavailable

`;
  }

  const payload = snapshot.teams.map((team) => ({
    side: team.side,
    team_name: team.teamName,
    formation: team.formation ?? null,
    coach: team.coachName ?? null,
    starters: team.starters,
    substitutes: team.substitutes,
  }));

  return compact
    ? `LINEUPS_SNAPSHOT:
${JSON.stringify(payload)}
- Treat lineup data as confirmed only for the names listed above.
- If lineup details are absent here, do not invent player names, formations, or absences.

`
    : `========================
LINEUPS SNAPSHOT
========================
${JSON.stringify(payload)}
- Treat lineup data as confirmed only for the names listed above.
- If lineup details are absent here, do not invent player names, formations, or absences.

`;
}

function buildV8MarketBalanceSectionCompact(promptVersion: LiveAnalysisPromptVersion): string {
  const isV8b = promptVersion === 'v8-market-balance-followup-b';
  const isV8c = promptVersion === 'v8-market-balance-followup-c';
  const isV8d = promptVersion === 'v8-market-balance-followup-d';
  const isV8e = promptVersion === 'v8-market-balance-followup-e';
  const isV8f = promptVersion === 'v8-market-balance-followup-f';
  const isV8g = promptVersion === 'v8-market-balance-followup-g';
  const isV8h = promptVersion === 'v8-market-balance-followup-h';
  const isV8i = promptVersion === 'v8-market-balance-followup-i';
  const isV8j = promptVersion === 'v8-market-balance-followup-j';
  const v8bExtraRules = (isV8b || isV8c)
    ? `- Minute 30-59 is an anti-mechanical-under zone. In this band, do NOT back goals_under unless live suppression is genuinely strong, the trailing/chasing risk is limited, and priors are aligned or at least neutral.
- From minute 30-59, a goals_under push is exceptional-only. A generic trio of slow tempo + low shots + low xG is NOT enough by itself.
- If your goals_under reasoning could be copied into many unrelated matches without changing the wording much, return no bet instead.
- In minute 30-59, every goals_under push must include at least one match-specific differentiator such as game-kill script, class-control, red-card distortion, trailing-side impotence, or clearly aligned priors.
- If playable 1x2 or Asian Handicap on the leading side (home or away) is unavailable or too cheap to be actionable, that does NOT make goals_under acceptable by default. Prefer no bet over a generic under fallback.
- In 45-59, when the score is level or a one-goal game, a generic \"slow tempo\" read is not enough. You need either a clear suppression signal or a clean favourite-control thesis with a playable line.
- In 45-59, if favourite-side control is live and 1x2_home or 1x2_away is available at a playable price (usually >= 1.55) or the matching asian_handicap_home / asian_handicap_away line is available, actively prefer that thesis over generic goals_under.
`
    : '';
  const v8cExtraRules = isV8c
    ? `- V8C PRIOR USE RULE: in minute 30-59, a totals bet must explicitly cite at least one concrete league/team prior metric or expert feature as confirming, neutral, or contradictory. If you cannot name one, default should_push=false unless live evidence is overwhelming.
- V8C PRIOR CONTRADICTION RULE: if league/team priors lean high-event or comeback-prone and your thesis is goals_under, treat that as contradictory unless live suppression is truly dominant.
- V8C TWO-PLUS-MARGIN RULE: in 45-59 with a two-plus goal margin, do NOT back goals_under just because the remaining line still looks high. You need a real game-kill script plus weak trailing threat; otherwise choose no bet.
- V8C LEVEL/ONE-GOAL RULE: in 45-59, if the score is level or a one-goal game and 1X2/AH is unavailable or not playable, that is still NOT enough to justify goals_under. Missing better markets does not create edge.
- V8C OVER CHECK RULE: if priors are high-event and live dominance is one-sided, consider whether a modest goals_over line is better than forcing a defensive read.
`
    : '';

  if (isV8d || isV8e || isV8f || isV8g || isV8h || isV8i || isV8j) {
    return `V8 MARKET-BALANCE DISCIPLINE:
- Goals Under is NOT the default fallback just because tempo is slow, shots are low, or xG is modest.
- Before minute 60, generic low-event evidence alone is insufficient for a goals_under push.
- For goals_under, explicitly decide whether priors are aligned, neutral, or contradictory. If contradictory and live suppression is not overwhelming, return no bet.
- If live evidence suggests favourite control, territory, or class edge on either side and priors agree, actively consider 1x2_home, 1x2_away, asian_handicap_home, or asian_handicap_away (EXACT ENUMS only; use ADJACENT AH keys when listed) before falling back to goals_under.
- If no market has a clean edge, return no bet. Do NOT use goals_under as a generic escape hatch.
- V8D OPEN-1X2 WINDOW RULE: from minute 35 onward, 1x2_home or 1x2_away becomes eligible again when the matching-side control thesis is live, the price is actually playable, and the edge is better explained by team/class control than by generic suppression.
- V8D OPEN-AH WINDOW RULE: in minute 30-44, if asian_handicap_home or asian_handicap_away is available at a playable price and the game-state favours controlled superiority on that side, prefer AH over a mechanical goals_under read.
- V8D 30-44 REBALANCE RULE: in minute 30-44, only use goals_under when the match-specific suppressive script is stronger than any playable 1x2/AH thesis on the leading side. If 1x2 or AH is playable and matches the live pattern, do not default back to Under.
- V8D 45-59 SHUT-OFF RULE: in minute 45-59, goals_under is exceptional-only. If the score is level or a one-goal game, missing 1X2/AH value is NOT a reason to force Under.
- V8D TWO-PLUS-MARGIN BLOCK: in 45-59 with a two-plus goal margin, treat goals_under as presumptively unsafe. Do not recommend it unless the trailing side is nearly dead, the leader is clearly game-killing, and you can state why a comeback script is highly unlikely.
- V8D MARKET REALISM RULE: if the best 1x2 on the leading side exists only at a clearly cheap or distorted price, do not force it. In that case prefer no bet rather than rotating back into goals_under.
- V8D PRIOR USE RULE: priors are confirm-or-contradict only. They must help you decide whether a live thesis is structurally supported, but they must never replace live evidence.
${isV8e ? `- V8E 30-44 0-0 LOW-LINE RULE: in minute 30-44 at 0-0, do NOT take goals_under above 1.5 just because the game looks quiet. Under 2.0/2.25/2.5 in this band is usually too generic unless suppression is overwhelming and priors clearly confirm.
- V8E 30-44 LEVEL HIGH-LINE RULE: in minute 30-44 when the score is level after 2+ goals have already been scored, do NOT back goals_under above 4.0 only because the line still looks inflated. Early-chaos games can reopen even with modest xG.
- V8E HIGH-LINE CORNERS RULE: before minute 60, corners_over lines >= 12.5 are exceptional-only. Require already-high realized corners AND sustained wide pressure/chasing behaviour. If the line still needs a large late corner run, prefer no bet.
- V8E TOTALS-ONLY REALISM RULE: when side markets are absent and you are choosing from totals only, missing 1X2/AH does NOT create edge. Use tighter standards, not looser ones.
` : ''}${(isV8f || isV8g || isV8h || isV8i || isV8j) ? `- V8F TARGETED TOTALS RULE: keep the V8D balance logic, but be extra selective in totals-only states where the line is doing most of the work for you.
- V8F 30-44 0-0 RULE: in minute 30-44 at 0-0, goals_under above 1.5 is usually too generic unless suppression is extreme and clearly match-specific.
- V8F LEVEL HIGH-LINE RULE: in minute 30-44 when the score is level after 2+ goals, do not trust very high goals-under lines on inflation alone.
- V8F HIGH-LINE CORNERS RULE: before minute 60, corners_over 12.5+ is exceptional-only and usually a pass unless corner volume is already extreme and still accelerating.
` : ''}${(isV8g || isV8h || isV8i || isV8j) ? `- V8G EARLY ONE-GOAL RULE: before minute 45, if the score is already a one-goal game, do NOT default into goals_under 2.75/3.0/3.25 just because the pace looks manageable.
- V8G ONE-GOAL REALISM RULE: in early one-goal states, a high-line Under needs a clear game-killing script. Low shots or modest xG alone are not enough.
- V8G SIDE-MARKET CHECK: if a side market is plausible or the game still has comeback pressure, prefer no bet over a mechanical early high-line Under.
` : ''}${(isV8h || isV8i || isV8j) ? `- V8H 45-59 ZERO-ZERO LOW-LINE RULE: in minute 45-59 at 0-0, do NOT force goals totals around 1.0 to 1.75 from totals-only evidence unless you can clearly explain a late-surge or late-shutout script. Generic balance is not enough.
- V8H 45-59 CORNERS RULE: in minute 45-59 with a one-goal game, corners_over 10+ is exceptional-only. If the line still needs multiple late corners and the pressure script is not obvious, prefer no bet.
- V8H 45-59 REALISM RULE: totals-only availability does not create edge by itself in 45-59. If the line is doing most of the work and the game state still allows volatility, no bet is better.
- V8H RESIDUAL-SCORING RULE: for any goals_under with line >= 2.0 before minute 75, explicitly address the opponent's residual goal threat (set pieces, chasing pressure, recent shots/xG trend). If you cannot argue why further goals are structurally unlikely, return no bet.
- V8H OVER-REJECTION RULE: whenever you select goals_under, include one concise sentence comparing against the best available goals_over alternative (same or adjacent line) and why Over is worse value or structurally weaker — not a generic disclaimer.
- V8H SYMMETRIC-ODDS TIE-BREAK: when the best available goals_over and goals_under prices are roughly balanced (implied probs within ~3% of each other) and live stats are only mildly low-event (not clearly dominant suppression), do NOT default to goals_under. Prefer either a clearly edged goals_over on the smallest plausible line, a side market that fits the script, or no bet.
- V8H EDGE-PUSH RULE: when your internal valuation shows a clear edge (>=3% vs fair/break-even) on exactly one market and no hard safety or policy conflict applies, set should_push=true for that market. Avoid no_bet purely from generic caution when the numeric edge and match-specific reasoning are both present.
` : ''}${isV8j ? `- V8J OVER-FIRST TOTALS: when both a playable goals_over and goals_under exist at similar prices, evaluate the Over thesis first in your reasoning sequence. Among overs, consider the smallest goals_over line that still meets MIN_ODDS before larger overs or Under. Choose goals_under only after you explicitly rule out those overs with match-specific evidence (not symmetry, habit, or "quiet game" clichés).
- V8J UNDER LAST-RESORT (GOALS): treat goals_under as the last option among goal-total markets. Do not output goals_under unless you have named the best alternative goals_over line(s) you rejected and one concrete match-specific reason each is structurally weak or fairly priced (not merely "could happen").
- V8J LINE-VS-FAIR: every goals_under push must include one short phrase tying your fair expectation to the offered line (why the line is wrong), not only qualitative low-event mood. Slow tempo alone never satisfies this.
- V8J IMPLIED-PROB SYMMETRY: if the book's implied probabilities for your candidate goals_under and the best comparable goals_over are within ~4 percentage points of each other, do not pick goals_under — prefer goals_over, a side/corners/btts pick that fits the script, or no_bet.
- V8J DUAL-SIGNAL UNDER: for goals_under with line >= 1.75 before minute 75, require at least two independent live suppression dimensions (e.g. xG drought + SOT collapse, or game-kill + weak trailing attack). For lines below 1.75, one strong suppression pillar plus a confirming prior or explicit scoreboard/settlement logic is enough.
- V8J UNDER-vs-OVER MARGIN: before selecting goals_under, compare against the best available goals_over on the same or nearest line. Pick Under only if your estimated value edge on Under exceeds the best Over's edge by at least 3 absolute percentage points; if Over is within that band and the script is not clearly shut-down, prefer goals_over, a side market, or corners — not Under by default.
- V8J DECISIVE EDGE PUSH: if ANY canonical market reaches >=3% value edge versus your fair range, meets MIN_ODDS, and has no hard safety or policy veto, you MUST set should_push=true for that strongest eligible market.
- V8J OPERATIONAL PUSH LADDER: When evidence is full_live_data and odds are usable, treat should_push=true as the normal outcome. Apply in order; stop at the first step that yields exactly one pick: (1) Strongest market with >=3% edge + MIN_ODDS + no hard veto (any canonical). (2) Among goals_over, 1x2_home, 1x2_away (away-dominant script only), asian_handicap_home, asian_handicap_away, MAIN or ADJACENT AH only if those keys appear in EXACT ENUMS, corners (over/under), btts_yes/no only: pick the highest-edge option with >=1.2% edge + MIN_ODDS + no veto — goals_under is never eligible in this step. (3) goals_under only if >=3% edge + MIN_ODDS + no veto AND it passes every V8J under rule above. (4) Same non-under basket as (2): if any option has edge >=0.5% + MIN_ODDS + no veto, pick the highest edge — still never goals_under. (5) no_bet only when every canonical option is below 0.5% edge, or a stated hard safety veto blocks all options, or odds are unusable. Do not use no_bet for generic caution when step (2) or (4) has an eligible pick.
- V8J BEFORE NO_BET: no_bet must mean step (5) of the ladder; in reasoning, name why each of steps (1)-(4) failed (per-market edge vs veto).
- V8J PORTFOLIO BREADTH: when goals_under is best on paper but goals_over, corners, or a side market is within ~4% edge of that Under and the live script fits the alternative, prefer the non-under pick to avoid mechanical under clustering.
- V8J NON-GOALS FIRST PASS: before committing to goals_under, one mental pass over corners_over/corners_under, btts_yes/no, 1x2_home, 1x2_away (when away clearly leads the script), asian_handicap_home, asian_handicap_away, including MAIN and ADJACENT AH if EXACT ENUMS lists them: if any offers MIN_ODDS and a narrative as clean as your Under thesis, pick that non-under market instead. Goals_under is for when those are clearly weaker or unavailable.
- V8J PROPS HOT-ZONE — LADDER OVERRIDE (30-44 AND 53-59): When applying OPERATIONAL PUSH LADDER steps (2) and (4), if the leading candidate is corners_* OR btts_yes OR btts_no and match minute is 30-44 inclusive OR 53-59 inclusive, that market does NOT qualify at the 1.2% / 0.5% tiers. It qualifies only if: (a) your stated value edge is >= 7% (>= 8% in minute 37-44 inclusive), AND (b) confidence >= 8, AND (c) you name two independent live anchors tied to that prop (e.g. corner run-rate + wide pressure; or xG/shots shape + defensive low-block for BTTS). If the prop only reaches ~1-2% edge here, skip it — prefer goals O/U or side markets that meet their own bars, or no_bet.
- V8J BTTS_NO QUALITY BAR: btts_no needs a scoreboard-consistent story for why a second goal is structurally unlikely (not just "quiet 0-0"). If both sides still show residual shot or set-piece threat without explanation, no_bet. Outside 37-44, still require >= 6% value edge for btts_no when other markets are noisy; inside 37-44 use >= 8% and the PROPS HOT-ZONE rule above.
` : ''}${(isV8i || isV8j) ? `- V8I EARLY LEVEL HIGH-LINE RULE: in minute 00-29, if the score is already level after 2+ goals and you only have totals to work with, do NOT back goals_under above 4.0 just because the line still looks generous.
- V8I EARLY CHAOS RULE: early 1-1 states are structurally volatile. Unless a playable side market exists and the match has clearly calmed down in a match-specific way, prefer no bet over a high-line Under.
- V8I TOTALS-ONLY FILTER: in 00-29 level states, missing side markets is a reason to tighten standards, not to trust an inflated Under.
` : ''}

`;
  }

  return `V8 MARKET-BALANCE DISCIPLINE:
- Goals Under is NOT the default fallback just because tempo is slow, shots are low, or xG is modest.
- Before minute 60, generic low-event evidence alone is insufficient for a goals_under push.
- For goals_under, explicitly decide whether priors are aligned, neutral, or contradictory. If contradictory and live suppression is not overwhelming, return no bet.
- If live evidence suggests favourite control, territory, or class edge on either side and priors agree, actively consider 1x2_home, 1x2_away, asian_handicap_home, or asian_handicap_away (EXACT ENUMS only) before falling back to goals_under.
- If no market has a clean edge, return no bet. Do NOT use goals_under as a generic escape hatch.
${v8bExtraRules}${v8cExtraRules}

`;
}

function buildV9LegacyLeanMarketSelectionSection(compact: boolean): string {
  return compact
    ? `LEGACY-LEAN MARKET SELECTION:
- 1X2 and BTTS No still require a higher bar: confidence >= 7, at least two strong stat gaps, and supporting pre-match context.
- BTTS Yes is NOT subject to that stricter 1X2 / BTTS No gate.
- If 1X2 or BTTS No does not clear the higher bar, evaluate goals O/U instead.
- Minute 5-65: only consider Over X.5 when attacking patterns are clearly open and sustained.
- Minute 65+: only consider Under X.5 when the match is still low-scoring and both teams genuinely look conservative or defensive.
- Do NOT treat Goals Under as a default before minute 65.
- If you choose O/U instead of 1X2 or BTTS No, explain exactly why in market_chosen_reason.

`
    : `LEGACY-LEAN MARKET SELECTION:
- 1X2 and BTTS No remain caution markets, but they are NOT treated as Tier-1-only by default in this prompt version.
- For 1X2 or BTTS No, require all of the following:
  - confidence >= 7
  - at least two strong live gaps such as possession >= 15%, shots on target gap >= 3, or corners gap >= 4
  - supporting pre-match context such as team-quality gap, form edge, or league-position edge
- BTTS Yes is NOT subject to that stricter 1X2 / BTTS No gate.
- If the stricter 1X2 / BTTS No conditions are not fully met:
  - do NOT force those markets
  - evaluate goals O/U as the preferred alternative
- Preferred O/U timing:
  - Minute 5-65: consider Over X.5 only when attacking patterns are clearly open, sustained, and supported by live pressure
  - Minute 65+: consider Under X.5 only when the match is still low-scoring and both teams genuinely look conservative or defensive
- Do NOT treat Goals Under as a default before minute 65.
- Whenever you choose O/U instead of 1X2 or BTTS No, state that reason explicitly in market_chosen_reason.

`;
}

function buildV10HybridLegacyMarketSelectionSection(compact: boolean, promptVersion?: LiveAnalysisPromptVersion): string {
  const inheritedV8hRules = buildV8MarketBalanceSectionCompact('v8-market-balance-followup-h')
    .replace('V8 MARKET-BALANCE DISCIPLINE:\n', '')
    .trimEnd();
  const v10cExtra = isV10HybridLegacyC(promptVersion ?? LIVE_ANALYSIS_PROMPT_VERSION)
    ? `${compact
      ? `- V10C CORNERS EARLY REALISM: before minute 30, corners markets are exceptional-only. Do not back corners_over 11.5+ or corners_under 9+ unless realized corner count is already near the line and the wing/set-piece script is extreme.
- V10C CORNERS EARLY RUNWAY: if a corners line still needs a large late run, early possession/territory alone is not enough. Prefer no bet.
- V10C BTTS MIDGAME: from minute 30-59, BTTS is exceptional-only. BTTS Yes needs direct threat from BOTH teams right now; BTTS No needs a structural reason why one side is effectively dead.
- V10C BTTS NO PRE60: quietness or a temporary 1-0 / 0-0 score is not enough to justify BTTS No before minute 60.
- V10C WEAK-PREMATCH RULE: when prematch strength is weak and only totals/props are available, corners and BTTS are off-menu unless the live evidence is overwhelming and line-specific.
- V10C WEAK 0-0 OVER RULE: in weak-prematch 0-0 states before minute 60, low-line goals_over (0.5 to 1.25) needs a truly strong first-goal script; generic pressure is not enough.
`
      : `- V10C CORNERS EARLY REALISM: before minute 30, treat corners markets as exceptional-only. Do not back corners_over 11.5+ or corners_under 9+ unless the realized corner count is already near the offered line and the live wing/set-piece script is clearly extreme and still accelerating.
- V10C CORNERS EARLY RUNWAY: if an early corners line still needs a large run-rate over 60+ minutes of football, that is usually a no-bet. Early possession, territory, or one-sided control alone is not enough to justify a corners position.
- V10C BTTS MIDGAME: from minute 30-59, BTTS is exceptional-only. BTTS Yes requires direct current threat from BOTH teams; BTTS No requires a structural reason why one side is effectively dead, not just temporary quietness.
- V10C BTTS NO PRE60: do not force BTTS No before minute 60 from a 0-0 or 1-0 scoreboard alone. You need a clear one-side-impotence script with live evidence, not a generic low-event read.
- V10C WEAK-PREMATCH RULE: when prematch strength is weak and only totals/props are available, corners and BTTS are effectively off-menu unless the live evidence is overwhelming, line-specific, and clearly superior to no_bet.
- V10C WEAK 0-0 OVER RULE: in weak-prematch 0-0 states before minute 60, low-line goals_over (0.5 to 1.25) needs a truly strong first-goal script backed by direct attacking evidence. Generic pressure, field tilt, or \"it only needs one goal\" is not enough.
`}`
    : '';
  const v10dExtra = isV10HybridLegacyD(promptVersion ?? LIVE_ANALYSIS_PROMPT_VERSION)
    ? `${compact
      ? `- V10D 45-59 CORNERS: in minute 45-59, one-goal corners positions are not generic tempo trades. Avoid corners_under 6.5 and corners_over 13.5+ unless realized corners are already near the line and the live script is exceptional.
- V10D ONE-GOAL OVER RUNWAY: in one-goal-margin states, goals_over needs realistic runway. Before minute 30, do not back an over that still needs 2.25+ extra goals. Before minute 45, if the score already has 3+ goals, avoid overs that still need 1.75+ extra goals.
- V10D 45-59 TWO-PLUS UNDER: when the match is already 2+ goals clear in minute 45-59, low-cushion goals_under is fragile. If one more goal kills the ticket, prefer no bet.
`
      : `- V10D 45-59 CORNERS: from minute 45-59, corners in one-goal games are not generic rhythm trades. Avoid corners_under 6.5 and corners_over 13.5+ unless the realized corner count is already close to the line and the current wing/set-piece script is clearly exceptional.
- V10D ONE-GOAL OVER RUNWAY: in one-goal-margin states, goals_over needs realistic runway, not generic "game still feels open" language. Before minute 30, do not back an over that still needs 2.25+ extra goals from the current score. Before minute 45, if the score already contains 3+ goals, avoid overs that still need 1.75+ extra goals unless the acceleration case is genuinely exceptional.
- V10D 45-59 TWO-PLUS UNDER: at minute 45-59 with a two-plus-goal margin, a goals_under line that dies from just one more goal is structurally fragile. Treat that as a no-bet unless the collapse risk is truly minimal and line-specific.
`}`
    : '';
  const v10eExtra = isV10HybridLegacyE(promptVersion ?? LIVE_ANALYSIS_PROMPT_VERSION)
    ? `${compact
      ? `- V10E 45-59 CORNERS ONLY: in minute 45-59 with a one-goal margin, treat corners_under 6.5 and corners_over 13.5+ as exceptional-only. If the realized corner count is not already close to the offered line, prefer no bet.
`
      : `- V10E 45-59 CORNERS ONLY: from minute 45-59 in one-goal games, corners_under 6.5 and corners_over 13.5+ are exceptional-only. If the realized corner count is not already close to the offered line, prefer no bet over a generic corners thesis.
`}`
    : '';
  const v10fExtra = isV10HybridLegacyF(promptVersion ?? LIVE_ANALYSIS_PROMPT_VERSION)
    ? `${compact
      ? `- V10F 45-59 CORNERS-UNDER CHASE RULE: in minute 45-59, Full-time corners_under 6.5 is exceptional-only when the match already has goals and the score is level or a one-goal game. A quiet first-half corner count alone is not enough if either side is still chasing.
- V10F SAME-THESIS UNDER ROLLOVER: in minute 45-59 with a two-plus-goal margin, do not roll an existing Full-time goals_under into a looser nearby line just because the line moved up. Without materially stronger suppression and near-zero residual threat, prefer no bet.
`
      : `- V10F 45-59 CORNERS-UNDER CHASE RULE: from minute 45-59, Full-time corners_under 6.5 is exceptional-only when the match already contains goals and the score is level or within one goal. A low first-half corner count by itself is not enough if the second-half script still contains chase pressure.
- V10F SAME-THESIS UNDER ROLLOVER: from minute 45-59 with a two-plus-goal margin, do not justify a new Full-time goals_under just because the market line drifted to a looser rung. If the thesis is unchanged and residual goal threat is not close to dead, prefer no bet over line-rolling.
`}`
    : '';
  const v10gExtra = isV10HybridLegacyG(promptVersion ?? LIVE_ANALYSIS_PROMPT_VERSION)
    ? `${compact
      ? `- V10G 30-44 CORNERS-UNDER REALISM: in minute 30-44, low-line Full-time corners_under is exceptional-only once the match already has goals or the prematch prior is weak. Quiet corner volume alone is not enough.
- V10G 30-44 BTTS-YES REALISM: in one-goal games between minute 30-44, BTTS Yes needs genuine dual-side threat now. One shot on target each or generic chase pressure is not enough.
- V10G 30-44 HIGH-LINE OVER RULE: in one-goal games before halftime, do not force Full-time goals_over 4.5+ unless the game is already extreme and still accelerating.
`
      : `- V10G 30-44 CORNERS-UNDER REALISM: from minute 30-44, low-line Full-time corners_under is exceptional-only once the match already contains goals or the prematch prior is weak. A low realized corner count by itself is not enough.
- V10G 30-44 BTTS-YES REALISM: in one-goal games between minute 30-44, BTTS Yes requires clear current threat from both teams, not just scoreboard pressure or prematch attacking reputation.
- V10G 30-44 HIGH-LINE OVER RULE: before halftime in one-goal games, do not treat Full-time goals_over 4.5+ as a routine chase trade. It needs an already extreme, still-accelerating scoring script.
`}`
    : '';
  return compact
    ? `LEGACY-HYBRID O/U TIMING:
- Keep the stricter v8h market discipline, but borrow only the old prompt's O/U timing logic.
- 1X2 and BTTS No still require the higher v8h bar.
- If 1X2 or BTTS No does not clear that bar, goals O/U may be considered as an alternative only when O/U earns its own edge.
- Minute 5-65: only consider goals O/U when the attacking pattern is clearly open and sustained. If the read is merely quiet or balanced, prefer no bet.
- Minute 65+: goals_under becomes eligible only when the match is still low-scoring and both teams genuinely look conservative or defensive.
- Do NOT treat 0-0 after minute 55 as automatic under.
${v10cExtra}${v10dExtra}${v10eExtra}${v10fExtra}${v10gExtra}${inheritedV8hRules}

`
    : `LEGACY-HYBRID O/U TIMING:
- Keep the stricter v8h market discipline, but borrow only the old prompt's O/U timing logic.
- 1X2 and BTTS No still require the higher live-evidence bar already defined elsewhere in this prompt.
- If 1X2 or BTTS No does not clear that bar, goals O/U may be considered as the preferred alternative only when goals O/U independently earns its own edge.
- Minute 5-65: only consider goals O/U when the attacking pattern is clearly open and sustained. If the match merely looks quiet, balanced, or low-event, prefer no bet instead of a generic Under.
- Minute 65+: goals_under becomes eligible only when the match is still low-scoring and both teams genuinely look conservative or defensive.
- Do NOT treat 0-0 after minute 55 as automatic under.
${v10cExtra}${v10dExtra}${v10eExtra}${v10fExtra}${v10gExtra}${inheritedV8hRules}

`;
}

function buildV10HybridLegacyMinimalSection(compact: boolean, promptVersion?: LiveAnalysisPromptVersion): string {
  const inheritedV8hRules = buildV8MarketBalanceSectionCompact('v8-market-balance-followup-h')
    .replace('V8 MARKET-BALANCE DISCIPLINE:\n', '')
    .trimEnd();
  const v10cExtra = isV10HybridLegacyC(promptVersion ?? LIVE_ANALYSIS_PROMPT_VERSION)
    ? `${compact
      ? `- V10C CORNERS EARLY REALISM: before minute 30, corners markets are exceptional-only. Do not back corners_over 11.5+ or corners_under 9+ unless realized corner count is already near the line and the wing/set-piece script is extreme.
- V10C CORNERS EARLY RUNWAY: if a corners line still needs a large late run, early possession/territory alone is not enough. Prefer no bet.
- V10C BTTS MIDGAME: from minute 30-59, BTTS is exceptional-only. BTTS Yes needs direct threat from BOTH teams right now; BTTS No needs a structural reason why one side is effectively dead.
- V10C BTTS NO PRE60: quietness or a temporary 1-0 / 0-0 score is not enough to justify BTTS No before minute 60.
- V10C WEAK-PREMATCH RULE: when prematch strength is weak and only totals/props are available, corners and BTTS are off-menu unless the live evidence is overwhelming and line-specific.
- V10C WEAK 0-0 OVER RULE: in weak-prematch 0-0 states before minute 60, low-line goals_over (0.5 to 1.25) needs a truly strong first-goal script; generic pressure is not enough.
`
      : `- V10C CORNERS EARLY REALISM: before minute 30, corners markets are exceptional-only. Do not back corners_over 11.5+ or corners_under 9+ unless the realized corner count is already near the offered line and the wing/set-piece script is extreme and still accelerating.
- V10C CORNERS EARLY RUNWAY: if an early corners line still needs a large run-rate over 60+ minutes of football, early possession/territory alone is not enough. Prefer no bet.
- V10C BTTS MIDGAME: from minute 30-59, BTTS is exceptional-only. BTTS Yes needs direct current threat from BOTH teams; BTTS No needs a structural reason why one side is effectively dead.
- V10C BTTS NO PRE60: quietness or a temporary 1-0 / 0-0 score is not enough to justify BTTS No before minute 60.
- V10C WEAK-PREMATCH RULE: when prematch strength is weak and only totals/props are available, corners and BTTS are off-menu unless the live evidence is overwhelming and line-specific.
- V10C WEAK 0-0 OVER RULE: in weak-prematch 0-0 states before minute 60, low-line goals_over (0.5 to 1.25) needs a truly strong first-goal script; generic pressure is not enough.
`}`
    : '';
  const v10dExtra = isV10HybridLegacyD(promptVersion ?? LIVE_ANALYSIS_PROMPT_VERSION)
    ? `${compact
      ? `- V10D 45-59 CORNERS: in minute 45-59, one-goal corners positions are not generic tempo trades. Avoid corners_under 6.5 and corners_over 13.5+ unless realized corners are already near the line and the live script is exceptional.
- V10D ONE-GOAL OVER RUNWAY: in one-goal-margin states, goals_over needs realistic runway. Before minute 30, do not back an over that still needs 2.25+ extra goals. Before minute 45, if the score already has 3+ goals, avoid overs that still need 1.75+ extra goals.
- V10D 45-59 TWO-PLUS UNDER: when the match is already 2+ goals clear in minute 45-59, low-cushion goals_under is fragile. If one more goal kills the ticket, prefer no bet.
`
      : `- V10D 45-59 CORNERS: from minute 45-59, corners in one-goal games are not generic rhythm trades. Avoid corners_under 6.5 and corners_over 13.5+ unless the realized corner count is already close to the line and the current wing/set-piece script is clearly exceptional.
- V10D ONE-GOAL OVER RUNWAY: in one-goal-margin states, goals_over needs realistic runway, not generic "game still feels open" language. Before minute 30, do not back an over that still needs 2.25+ extra goals from the current score. Before minute 45, if the score already contains 3+ goals, avoid overs that still need 1.75+ extra goals unless the acceleration case is genuinely exceptional.
- V10D 45-59 TWO-PLUS UNDER: at minute 45-59 with a two-plus-goal margin, a goals_under line that dies from just one more goal is structurally fragile. Treat that as a no-bet unless the collapse risk is truly minimal and line-specific.
`}`
    : '';
  const v10eExtra = isV10HybridLegacyE(promptVersion ?? LIVE_ANALYSIS_PROMPT_VERSION)
    ? `${compact
      ? `- V10E 45-59 CORNERS ONLY: in minute 45-59 with a one-goal margin, treat corners_under 6.5 and corners_over 13.5+ as exceptional-only. If the realized corner count is not already close to the offered line, prefer no bet.
`
      : `- V10E 45-59 CORNERS ONLY: from minute 45-59 in one-goal games, corners_under 6.5 and corners_over 13.5+ are exceptional-only. If the realized corner count is not already close to the offered line, prefer no bet over a generic corners thesis.
`}`
    : '';
  const v10fExtra = isV10HybridLegacyF(promptVersion ?? LIVE_ANALYSIS_PROMPT_VERSION)
    ? `${compact
      ? `- V10F 45-59 CORNERS-UNDER CHASE RULE: in minute 45-59, Full-time corners_under 6.5 is exceptional-only when the match already has goals and the score is level or a one-goal game. A quiet first-half corner count alone is not enough if either side is still chasing.
- V10F SAME-THESIS UNDER ROLLOVER: in minute 45-59 with a two-plus-goal margin, do not roll an existing Full-time goals_under into a looser nearby line just because the line moved up. Without materially stronger suppression and near-zero residual threat, prefer no bet.
`
      : `- V10F 45-59 CORNERS-UNDER CHASE RULE: from minute 45-59, Full-time corners_under 6.5 is exceptional-only when the match already contains goals and the score is level or within one goal. A low first-half corner count by itself is not enough if the second-half script still contains chase pressure.
- V10F SAME-THESIS UNDER ROLLOVER: from minute 45-59 with a two-plus-goal margin, do not justify a new Full-time goals_under just because the market line drifted to a looser rung. If the thesis is unchanged and residual goal threat is not close to dead, prefer no bet over line-rolling.
`}`
    : '';
  const v10gExtra = isV10HybridLegacyG(promptVersion ?? LIVE_ANALYSIS_PROMPT_VERSION)
    ? `${compact
      ? `- V10G 30-44 CORNERS-UNDER REALISM: in minute 30-44, low-line Full-time corners_under is exceptional-only once the match already has goals or the prematch prior is weak. Quiet corner volume alone is not enough.
- V10G 30-44 BTTS-YES REALISM: in one-goal games between minute 30-44, BTTS Yes needs genuine dual-side threat now. One shot on target each or generic chase pressure is not enough.
- V10G 30-44 HIGH-LINE OVER RULE: in one-goal games before halftime, do not force Full-time goals_over 4.5+ unless the game is already extreme and still accelerating.
`
      : `- V10G 30-44 CORNERS-UNDER REALISM: from minute 30-44, low-line Full-time corners_under is exceptional-only once the match already contains goals or the prematch prior is weak. A low realized corner count by itself is not enough.
- V10G 30-44 BTTS-YES REALISM: in one-goal games between minute 30-44, BTTS Yes requires clear current threat from both teams, not just scoreboard pressure or prematch attacking reputation.
- V10G 30-44 HIGH-LINE OVER RULE: before halftime in one-goal games, do not treat Full-time goals_over 4.5+ as a routine chase trade. It needs an already extreme, still-accelerating scoring script.
`}`
    : '';

  return compact
    ? `MINIMAL LEGACY TIMING ADJUSTMENT:
- Keep the v8h restrictions and market-balance discipline.
- If 1X2 or BTTS No does not clear the higher bar, goals O/U may still be considered only when the O/U edge is independently clear.
- Do NOT treat 0-0 after minute 55 as automatic goals_under.
- Before minute 65, quiet or balanced states usually mean no bet rather than a generic Under.
${v10cExtra}${v10dExtra}${v10eExtra}${v10fExtra}${v10gExtra}${inheritedV8hRules}

`
    : `MINIMAL LEGACY TIMING ADJUSTMENT:
- Keep the v8h restrictions and market-balance discipline.
- If 1X2 or BTTS No does not clear the higher bar, goals O/U may still be considered only when the O/U edge is independently clear.
- Do NOT treat 0-0 after minute 55 as automatic goals_under.
- Before minute 65, quiet or balanced states usually mean no bet rather than a generic Under.
${v10cExtra}${v10dExtra}${v10eExtra}${v10fExtra}${v10gExtra}${inheritedV8hRules}

`;
}

function getCorrelatedThesis(canonicalMarket: string): { thesisKey: string; label: string } | null {
  if (!canonicalMarket || canonicalMarket === 'unknown') return null;
  if (canonicalMarket.startsWith('ht_over_')) return { thesisKey: 'ht_goals_over', label: 'H1 Goals Over thesis' };
  if (canonicalMarket.startsWith('ht_under_')) return { thesisKey: 'ht_goals_under', label: 'H1 Goals Under thesis' };
  if (canonicalMarket.startsWith('ht_asian_handicap_home_')) {
    return { thesisKey: 'ht_asian_handicap_home', label: 'H1 Asian Handicap Home thesis' };
  }
  if (canonicalMarket.startsWith('ht_asian_handicap_away_')) {
    return { thesisKey: 'ht_asian_handicap_away', label: 'H1 Asian Handicap Away thesis' };
  }
  if (canonicalMarket === 'ht_1x2_home') return { thesisKey: 'ht_1x2_home', label: 'H1 Home Win thesis' };
  if (canonicalMarket === 'ht_1x2_away') return { thesisKey: 'ht_1x2_away', label: 'H1 Away Win thesis' };
  if (canonicalMarket === 'ht_1x2_draw') return { thesisKey: 'ht_1x2_draw', label: 'H1 Draw thesis' };
  if (canonicalMarket === 'ht_btts_yes') return { thesisKey: 'ht_btts_yes', label: 'H1 BTTS Yes thesis' };
  if (canonicalMarket === 'ht_btts_no') return { thesisKey: 'ht_btts_no', label: 'H1 BTTS No thesis' };
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

function buildExistingExposureSectionCompact(
  data: LiveAnalysisPromptInput,
  promptVersion: LiveAnalysisPromptVersion,
): string {
  const summaries = summarizeCorrelatedExposure(data);
  if (summaries.length === 0) return '';

  const lines = summaries.map((summary) => {
    const latestMinute = summary.latestMinute == null ? '?' : String(summary.latestMinute);
    const ladderAlert = (
      promptVersion === 'v6-betting-discipline-b'
      || promptVersion === 'v6-betting-discipline-c'
      || promptVersion === 'v7-profile-overlay-discipline-a'
      || isV8PromptVersion(promptVersion)
    ) && summary.count >= 2
      ? ' [LADDER ALERT]'
      : '';
    return `- ${summary.label}: ${summary.count} prior pick(s), total prior stake ${summary.totalStake}%, latest at minute ${latestMinute}, lines: ${summary.canonicalMarkets.join(', ')}${ladderAlert}`;
  });

  const advancedRules = (
    promptVersion === 'v6-betting-discipline-b'
    || promptVersion === 'v6-betting-discipline-c'
    || promptVersion === 'v7-profile-overlay-discipline-a'
    || isV8PromptVersion(promptVersion)
  )
    ? `- If the same thesis already has 2+ entries, do NOT add another rung. Default should_push=false.
- A later safer line may be better in isolation, but adding it on top of earlier exposure still compounds bankroll risk instead of improving the old position.
- Do not walk the line rung-by-rung (example: Over 3.5 -> Over 3 -> Over 2.75 -> Over 2.5). That is usually averaging into the same read, not a fresh edge.
- The same logic applies to corners ladders (example: Under 9.5 -> Under 8.5 -> Under 7.5). That is still one fragile thesis, not diversification.
`
    : '';

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
${advancedRules}

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

void [
  buildLeagueProfileSection,
  buildStrategicContextSection,
  buildStrategicContextSectionCompact,
  buildLeagueProfileSectionCompact,
  buildPreMatchPredictionSectionCompact,
];

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
    rules.push(`- Goals O/U MAIN line ${line}: use exactly "over_${line}" or "under_${line}".`);
    rules.push(`  selection: "Over ${line} Goals @[odds]" or "Under ${line} Goals @[odds]".`);
  }

  const ouAdj = oc['ou_adjacent'] as { line?: unknown; over?: unknown; under?: unknown } | undefined;
  if (ouAdj && ouAdj.line != null && ouAdj.over != null && ouAdj.under != null) {
    const line = String(ouAdj.line);
    exactKeys.push(`over_${line}`, `under_${line}`);
    rules.push(
      `- Goals O/U ADJACENT line ${line}: nearest ladder line to main; use "over_${line}" / "under_${line}" only when value clearly beats main line ${oc.ou?.line ?? '?'}.`,
    );
    rules.push(`  selection: same pattern as main ("Over ${line} Goals @[odds]" / "Under ${line} Goals @[odds]").`);
  }

  if (oc.ah && oc.ah.line != null && oc.ah.home != null && oc.ah.away != null) {
    const line = String(oc.ah.line);
    exactKeys.push(`asian_handicap_home_${line}`, `asian_handicap_away_${line}`);
    rules.push(`- Asian Handicap MAIN line ${line}: use exactly "asian_handicap_home_${line}" or "asian_handicap_away_${line}".`);
    rules.push(`  selection: "Home ${line} @[odds]" or "Away ${line} @[odds]".`);
  }

  const ahAdj = oc['ah_adjacent'] as { line?: unknown; home?: unknown; away?: unknown } | undefined;
  if (ahAdj && ahAdj.line != null && ahAdj.home != null && ahAdj.away != null) {
    const line = String(ahAdj.line);
    exactKeys.push(`asian_handicap_home_${line}`, `asian_handicap_away_${line}`);
    rules.push(
      `- Asian Handicap ADJACENT line ${line}: second line nearest to main; pick home/away suffix keys only when this line fits the script better than main ${oc.ah?.line ?? '?'}.`,
    );
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

  if (oc['ht_1x2'] && oc['ht_1x2'].home != null && oc['ht_1x2'].draw != null && oc['ht_1x2'].away != null) {
    exactKeys.push('ht_1x2_home', 'ht_1x2_draw', 'ht_1x2_away');
    rules.push('- H1 1X2: use exactly "ht_1x2_home", "ht_1x2_draw", or "ht_1x2_away".');
    rules.push('  selection: "H1 Home Win @[odds]", "H1 Draw @[odds]", or "H1 Away Win @[odds]".');
  }

  if (oc.ht_ou && oc.ht_ou.line != null && oc.ht_ou.over != null && oc.ht_ou.under != null) {
    const line = String(oc.ht_ou.line);
    exactKeys.push(`ht_over_${line}`, `ht_under_${line}`);
    rules.push(`- H1 Goals O/U MAIN line ${line}: use exactly "ht_over_${line}" or "ht_under_${line}".`);
    rules.push(`  selection: "H1 Over ${line} Goals @[odds]" or "H1 Under ${line} Goals @[odds]".`);
  }

  const htOuAdj = oc['ht_ou_adjacent'] as { line?: unknown; over?: unknown; under?: unknown } | undefined;
  if (htOuAdj && htOuAdj.line != null && htOuAdj.over != null && htOuAdj.under != null) {
    const line = String(htOuAdj.line);
    exactKeys.push(`ht_over_${line}`, `ht_under_${line}`);
    rules.push(
      `- H1 Goals O/U ADJACENT line ${line}: nearest H1 ladder line to main; use "ht_over_${line}" / "ht_under_${line}" only when it clearly fits better than main ${oc.ht_ou?.line ?? '?'}.`,
    );
    rules.push(`  selection: same pattern as main ("H1 Over ${line} Goals @[odds]" / "H1 Under ${line} Goals @[odds]").`);
  }

  if (oc.ht_ah && oc.ht_ah.line != null && oc.ht_ah.home != null && oc.ht_ah.away != null) {
    const line = String(oc.ht_ah.line);
    exactKeys.push(`ht_asian_handicap_home_${line}`, `ht_asian_handicap_away_${line}`);
    rules.push(`- H1 Asian Handicap MAIN line ${line}: use exactly "ht_asian_handicap_home_${line}" or "ht_asian_handicap_away_${line}".`);
    rules.push(`  selection: "H1 Home ${line} @[odds]" or "H1 Away ${line} @[odds]".`);
  }

  const htAhAdj = oc['ht_ah_adjacent'] as { line?: unknown; home?: unknown; away?: unknown } | undefined;
  if (htAhAdj && htAhAdj.line != null && htAhAdj.home != null && htAhAdj.away != null) {
    const line = String(htAhAdj.line);
    exactKeys.push(`ht_asian_handicap_home_${line}`, `ht_asian_handicap_away_${line}`);
    rules.push(
      `- H1 Asian Handicap ADJACENT line ${line}: second H1 line nearest to main; use this only when it fits better than main ${oc.ht_ah?.line ?? '?'}.`,
    );
    rules.push(`  selection: "H1 Home ${line} @[odds]" or "H1 Away ${line} @[odds]".`);
  }

  if (oc.ht_btts && oc.ht_btts.yes != null && oc.ht_btts.no != null) {
    exactKeys.push('ht_btts_yes', 'ht_btts_no');
    rules.push('- H1 BTTS: use exactly "ht_btts_yes" or "ht_btts_no".');
    rules.push('  selection: "H1 BTTS Yes @[odds]" or "H1 BTTS No @[odds]".');
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
- In reasoning_en/vi and follow_up_answer_en/vi, whenever you mention a betting angle, explicitly state whether it is H1 or Full-time and name the market family (European 1X2, Asian Handicap, Goals O/U, BTTS, or Corners O/U).
- If should_push=false, selection="" and bet_market="".

`;
}

function buildSettledReplayTracePromptBlock(data: LiveAnalysisPromptInput): string {
  if (!data.settledReplayApprovedTrace) return '';
  const bm = String(data.settledReplayOriginalBetMarket ?? '').trim().replace(/"/g, "'");
  const sel = String(data.settledReplayOriginalSelection ?? '').trim().slice(0, 120).replace(/"/g, "'");
  const isGoalsUnderAnchor = /^under_/i.test(bm) && !/^corners_/i.test(bm);
  const anchor = bm
    ? (isGoalsUnderAnchor
      ? `- TRACE_UNDER_HISTORY: Production once saved goals_under as "${bm}"${sel ? ` (${sel})` : ''}. **Default: do not output that same goals_under.** Only use goals_under if it passes every V8J under rule AND your edge vs the best goals_over is >=3 percentage points AND dual-signal holds. Otherwise **must** push a non-under market: rank 1) asian_handicap_home / 1X2_home if script fits, 2) corners_over or corners_under with clean corner thesis (subject to **V8J PROPS HOT-ZONE** in min 30-44 / 53-59), 3) btts_yes/no if odds fit (same hot-zone bar), 4) goals_over on smallest viable line — pick the single best MIN_ODDS option among those.\n`
      : `- STORED_TRACE_ANCHOR: Production saved bet_market="${bm}"${sel ? ` selection="${sel}"` : ''}. When current odds and live stats still reasonably support that same bet_market at MIN_ODDS and no hard veto applies, use that bet_market for should_push (adjust confidence, stake_percent, value_percent as needed). Switch canonical market only if live evidence clearly favors a different key — not for small stylistic preference.\n`)
    : '';
  return `SETTLED_REPLAY_TRACE_MODE:
- This snapshot reconstructs a moment that already produced a stored, non-NO_BET recommendation in production. Set should_push=true unless a HARD safety rule makes every canonical market unsafe (e.g. ODDS_SUSPICIOUS / unusable odds, ACTIVE CORNERS SANITY ALERT or corners sanity desync, or an impossible line). Do not return no_bet from soft caution, generic discipline, or thin-edge worry alone.
- TRACE_MARKET_MIX: **Reduce goals_under share.** Before any goals_under, scan corners (over/under), btts_yes/no, 1X2_home, asian_handicap_home, and goals_over lines. Prefer a non-under pick when it fits the live script within ~5% edge of your best Under idea (same as V8J portfolio breadth intent). In minute 30-44 or 53-59, corners/BTTS count as diversification only if they satisfy **V8J PROPS HOT-ZONE** (7-8% edge, confidence >= 8, two anchors); otherwise prefer goals_over / side / no_bet over weak props.
- Keep goals_under subject to all V8J under rules when you still choose Under after the scan above.
${anchor}`;
}

export function buildLiveAnalysisPrompt(
  data: LiveAnalysisPromptInput,
  settings: LiveAnalysisPromptSettings,
  promptVersion: LiveAnalysisPromptVersion = LIVE_ANALYSIS_PROMPT_VERSION,
): string {
  const analysisMode = resolveAnalysisMode(data);
  const lowEvidenceConditionGuard = buildLowEvidenceConditionGuardSection(isCompactPromptVersion(promptVersion), data);
  const structuredPrematchAskAiSection = buildStructuredPrematchAskAiSection(isCompactPromptVersion(promptVersion), data);
  const prunedBasicStatsCompact = pruneEmptyStatsCompact(pickStatsSubset(data.statsCompact, BASIC_STATS_KEYS));
  const prunedAdvancedStatsCompact = pruneEmptyStatsCompact(pickStatsSubset(data.statsCompact, ADVANCED_STATS_KEYS));
  const statsMeta = hasNonEmptyObject(data.statsMeta ?? null) ? data.statsMeta : null;
  const oddsSanityWarnings = Array.isArray(data.oddsSanityWarnings)
    ? data.oddsSanityWarnings.filter((warning) => String(warning || '').trim() !== '')
    : [];
  const MIN_CONFIDENCE = settings.minConfidence;
  const MIN_ODDS = settings.minOdds;
  const LATE_PHASE_MINUTE = settings.latePhaseMinute;
  const VERY_LATE_PHASE_MINUTE = settings.veryLatePhaseMinute;
  const ENDGAME_MINUTE = settings.endgameMinute;
  const settledReplayTraceBlock = buildSettledReplayTracePromptBlock(data);

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
  const evidenceTierRule = getEvidenceTierRule(data);
  const fullV8MarketBalanceRules = isV8PromptVersion(promptVersion)
    ? buildV8MarketBalanceSectionCompact(promptVersion).replace('V8 MARKET-BALANCE DISCIPLINE:\n', '')
    : '';
  const fullMarketSelectionRules = isV10HybridLegacyB(promptVersion)
    ? `- 1X2 and BTTS No are Tier-1-only markets. They require full_live_data, confidence >= 7, significant stat gaps, and pre-match support.
- BTTS Yes requires at least Tier 1 evidence. Do NOT recommend BTTS from Tier 3 or Tier 4.
- AH and O/U are the only market families allowed in degraded Tier 3.
- Corners markets require Tier 1 live stats and live corners data. No corners recommendation in Tier 2-4.
- If 1X2 or AH is not justified, do NOT automatically fall back to Over/Under. Over/Under must still earn its own edge.
- If ODDS SANITY NOTES removed a corners market, do NOT recommend any corners market and do NOT infer a replacement corners line from stats.
- If DYNAMIC PERFORMANCE PRIORS are present and the chosen market is tagged as a caution prior, require a stronger live edge or skip the bet.
- Odds >= 2.50: confidence cap 6, stake cap 3%.
- Before minute 30: early game caution, 1X2 should_push=false before minute 35.
- Over 3.5+: need current goals >= line-1 or clearly open match.
- CORNERS O/U: MUST calculate cornerTempoSoFar, cornersNeeded, cornersPerMinuteNeeded.
  - If cornersPerMinuteNeeded > cornerTempoSoFar x 1.5 -> should_push = false.
  - If cornersNeeded >= 3 AND minutesRemaining <= 20 -> should_push = false.
  - After minute 75: Corners Over requires cornersNeeded <= 1.
  - After minute 80: should_push = false for any Corners Over.
${buildV10HybridLegacyMinimalSection(false, promptVersion)}- risk_level = HIGH -> should_push = false.
`
    : isV10PromptVersion(promptVersion)
    ? `- 1X2 and BTTS No are Tier-1-only markets. They require full_live_data, confidence >= 7, significant stat gaps, and pre-match support.
- BTTS Yes requires at least Tier 1 evidence. Do NOT recommend BTTS from Tier 3 or Tier 4.
- AH and O/U are the only market families allowed in degraded Tier 3.
- Corners markets require Tier 1 live stats and live corners data. No corners recommendation in Tier 2-4.
- If 1X2 or AH is not justified, do NOT automatically fall back to Over/Under. Over/Under must still earn its own edge.
- If ODDS SANITY NOTES removed a corners market, do NOT recommend any corners market and do NOT infer a replacement corners line from stats.
- If DYNAMIC PERFORMANCE PRIORS are present and the chosen market is tagged as a caution prior, require a stronger live edge or skip the bet.
- Odds >= 2.50: confidence cap 6, stake cap 3%.
- Before minute 30: early game caution, 1X2 should_push=false before minute 35.
- Over 3.5+: need current goals >= line-1 or clearly open match.
- CORNERS O/U: MUST calculate cornerTempoSoFar, cornersNeeded, cornersPerMinuteNeeded.
  - If cornersPerMinuteNeeded > cornerTempoSoFar x 1.5 -> should_push = false.
  - If cornersNeeded >= 3 AND minutesRemaining <= 20 -> should_push = false.
  - After minute 75: Corners Over requires cornersNeeded <= 1.
  - After minute 80: should_push = false for any Corners Over.
${buildV10HybridLegacyMarketSelectionSection(false, promptVersion)}- risk_level = HIGH -> should_push = false.
`
    : isV9PromptVersion(promptVersion)
    ? `${buildV9LegacyLeanMarketSelectionSection(false)}- Corners markets still require Tier 1 live stats and live corners data. No corners recommendation in Tier 2-4.
- If ODDS SANITY NOTES removed a corners market, do NOT recommend any corners market and do NOT infer a replacement corners line from stats.
- If DYNAMIC PERFORMANCE PRIORS are present and the chosen market is tagged as a caution prior, require a stronger live edge or skip the bet.
- Odds >= 2.50: confidence cap 6, stake cap 3%.
- Before minute 30: early game caution, 1X2 should_push=false before minute 35.
- Over 3.5+: need current goals >= line-1 or clearly open match.
- CORNERS O/U: MUST calculate cornerTempoSoFar, cornersNeeded, cornersPerMinuteNeeded.
  - If cornersPerMinuteNeeded > cornerTempoSoFar x 1.5 -> should_push = false.
  - If cornersNeeded >= 3 AND minutesRemaining <= 20 -> should_push = false.
  - After minute 75: Corners Over requires cornersNeeded <= 1.
  - After minute 80: should_push = false for any Corners Over.
- risk_level = HIGH -> should_push = false.
`
    : `- 1X2 and BTTS No are Tier-1-only markets. They require full_live_data, confidence >= 7, significant stat gaps, and pre-match support.
- BTTS Yes requires at least Tier 1 evidence. Do NOT recommend BTTS from Tier 3 or Tier 4.
- AH and O/U are the only market families allowed in degraded Tier 3.
- Corners markets require Tier 1 live stats and live corners data. No corners recommendation in Tier 2-4.
- If 1X2 or AH is not justified, do NOT automatically fall back to Over/Under. Over/Under must still earn its own edge.
- If ODDS SANITY NOTES removed a corners market, do NOT recommend any corners market and do NOT infer a replacement corners line from stats.
- If DYNAMIC PERFORMANCE PRIORS are present and the chosen market is tagged as a caution prior, require a stronger live edge or skip the bet.
- Odds >= 2.50: confidence cap 6, stake cap 3%.
- Before minute 30: early game caution, 1X2 should_push=false before minute 35.
- Over 3.5+: need current goals >= line-1 or clearly open match.
- CORNERS O/U: MUST calculate cornerTempoSoFar, cornersNeeded, cornersPerMinuteNeeded.
  - If cornersPerMinuteNeeded > cornerTempoSoFar x 1.5 -> should_push = false.
  - If cornersNeeded >= 3 AND minutesRemaining <= 20 -> should_push = false.
  - After minute 75: Corners Over requires cornersNeeded <= 1.
  - After minute 80: should_push = false for any Corners Over.
${fullV8MarketBalanceRules}
- Score 0-0 after minute 55: prefer GOALS Under markets (under_2.5, under_1.5). NOT corners_under.
- risk_level = HIGH -> should_push = false.
`;

  if (isCompactPromptVersion(promptVersion)) {
    const bettingDisciplineSection = isBettingDisciplinePromptVersion(promptVersion)
      ? buildExistingExposureSectionCompact(data, promptVersion)
      : '';
    const advancedBettingRules = (
      promptVersion === 'v6-betting-discipline-b'
      || promptVersion === 'v6-betting-discipline-c'
      || promptVersion === 'v7-profile-overlay-discipline-a'
      || isV8PromptVersion(promptVersion)
    )
      ? `- First-half volume is a prior, not an automatic second-half trigger.
- At HT and in the first 10 minutes of 2H, do NOT project a wild first half straight into a new Over bet unless the early second-half flow confirms it with fresh pressure, shots, or transitions.
- Avoid new bets that still need two or more additional goals/events to win unless the match is truly exceptional.
- For Goals Over, if the line still needs two more goals to cash, default should_push=false unless there is a major class mismatch, red-card distortion, or overwhelming full-live evidence.
- Prefer entries where one more goal materially helps the position (push / half-win / full win) over lines that still require two more goals.
- Do not average into a same-thesis totals ladder just because the line moved from 3.5 -> 3 -> 2.75 -> 2.5. That is usually bankroll compounding, not a new edge.
`
      : '';
    const advancedLineSpecificRule = (
      promptVersion === 'v6-betting-discipline-b'
      || promptVersion === 'v6-betting-discipline-c'
      || promptVersion === 'v7-profile-overlay-discipline-a'
      || isV8PromptVersion(promptVersion)
    )
      ? '- At HT / early 2H, a fresh Over 3.5 from 1-1 is usually too demanding. Wait for better confirmation or a friendlier line.\n'
      : '';
    const advancedCornersRules = (
      promptVersion === 'v6-betting-discipline-c'
      || promptVersion === 'v7-profile-overlay-discipline-a'
      || isV8PromptVersion(promptVersion)
    )
      ? `- Corners are a tertiary market. They are not a primary read on team quality, true scoring edge, or match motivation.
- Only choose corners when the corner-specific evidence is cleaner than any available Goals or AH thesis. If a goals/AH read is similarly strong, prefer goals/AH.
- Corners Under is exceptional-only. Default should_push=false unless the match is genuinely calm and corner-suppressing.
- Do NOT recommend Corners Under when either team is trailing and likely to chase, or when the game is stretched, transition-heavy, or producing obvious territorial pressure.
- Do NOT recommend Corners Under when shots, shots on target, or one-sided pressure already suggest repeated final-third entries. Corners Under needs a dead or tightly controlled game, not just a low current corner count.
- Treat corners ladders as fragile exposure. Do not staircase Corners Under from 10.5 -> 9.5 -> 8.5 -> 7.5.
- Corners markets should usually cap at confidence 6 and stake 3%. Corners Under should usually cap at confidence 5 and stake 2% unless the edge is exceptionally clean.
`
      : '';
    const advancedBalancedTotalsRule = (
      promptVersion === 'v6-betting-discipline-c'
      || promptVersion === 'v7-profile-overlay-discipline-a'
      || isV8PromptVersion(promptVersion)
    )
      ? `- Balanced totals are not enough. In 1-1 or 0-0 states around minute 55-70, if possession, shots, and shots on target are broadly even and there is no clear pressure asymmetry, default should_push=false.
- Symmetric prices around 1.90 on both sides usually mean the market sees a thin edge. Do not force an Over or Under just because one more goal would cash.
${promptVersion === 'v8-market-balance-followup-b' || promptVersion === 'v8-market-balance-followup-c' || promptVersion === 'v8-market-balance-followup-d' || promptVersion === 'v8-market-balance-followup-e' || promptVersion === 'v8-market-balance-followup-f' ? '- In minute 30-59, treat level or one-goal states as a danger zone for generic totals picks. If the edge is not clearly asymmetrical, default should_push=false rather than forcing an Under.\n' : ''}${promptVersion === 'v8-market-balance-followup-c' ? '- In minute 30-59, if a totals thesis cannot name a concrete confirming prior, treat that as missing confirmation rather than as neutral support.\n' : ''}
`
      : '';
    const profileOverlayDisciplineSection = buildProfileAndOverlayDisciplineSectionCompact(data, promptVersion);
    const followUpContextSection = buildFollowUpContextSection(data, true);
    const lineupsSnapshotSection = buildLineupsSnapshotSection(data, true);
    const v8MarketBalanceSection = isV8PromptVersion(promptVersion)
      ? buildV8MarketBalanceSectionCompact(promptVersion)
      : '';
    const compactMarketSelectionRules = isV10HybridLegacyB(promptVersion)
      ? `- 1X2 and BTTS No need full_live_data, confidence >= 7, and strong stat support
- BTTS Yes needs tier 1 evidence
- Tier 3 may only use O/U or selective AH
- Thin balanced totals need a pass unless live evidence is clearly asymmetric.
- Goals and AH are primary markets. Corners are tertiary and require cleaner evidence than goals/AH.
- Corners require tier 1 live stats + live corners data
- If ODDS SANITY NOTES removed a corners market, do NOT recommend any corners market and do NOT infer a replacement corners line from stats.
- Prefer Corners Over over Corners Under when pressure evidence is strong. Be very selective with Corners Under.
${advancedCornersRules}
${advancedBalancedTotalsRule}
${profileOverlayDisciplineSection}
${buildV10HybridLegacyMinimalSection(true, promptVersion)}${activeCornersSanityAlert}
- If DYNAMIC PERFORMANCE PRIORS are present and the chosen market is tagged as a caution prior, require a stronger live edge or skip the bet.
- Odds >= 2.50 => confidence cap 6, stake cap 3%
- Over 3.5+ needs current goals >= line-1 or a clearly open match
${advancedLineSpecificRule}- risk_level HIGH => should_push false
`
      : isV10PromptVersion(promptVersion)
      ? `- 1X2 and BTTS No need full_live_data, confidence >= 7, and strong stat support
- BTTS Yes needs tier 1 evidence
- Tier 3 may only use O/U or selective AH
- Thin balanced totals need a pass unless live evidence is clearly asymmetric.
- Goals and AH are primary markets. Corners are tertiary and require cleaner evidence than goals/AH.
- Corners require tier 1 live stats + live corners data
- If ODDS SANITY NOTES removed a corners market, do NOT recommend any corners market and do NOT infer a replacement corners line from stats.
- Prefer Corners Over over Corners Under when pressure evidence is strong. Be very selective with Corners Under.
${advancedCornersRules}
${advancedBalancedTotalsRule}
${profileOverlayDisciplineSection}
${buildV10HybridLegacyMarketSelectionSection(true, promptVersion)}${activeCornersSanityAlert}
- If DYNAMIC PERFORMANCE PRIORS are present and the chosen market is tagged as a caution prior, require a stronger live edge or skip the bet.
- Odds >= 2.50 => confidence cap 6, stake cap 3%
- Over 3.5+ needs current goals >= line-1 or a clearly open match
${advancedLineSpecificRule}- risk_level HIGH => should_push false
`
      : isV9PromptVersion(promptVersion)
      ? `${buildV9LegacyLeanMarketSelectionSection(true)}- Thin balanced totals need a pass unless live evidence is clearly asymmetric.
- Goals and AH are primary markets. Corners are tertiary and require cleaner evidence than goals/AH.
- Corners require tier 1 live stats + live corners data
- If ODDS SANITY NOTES removed a corners market, do NOT recommend any corners market and do NOT infer a replacement corners line from stats.
- Prefer Corners Over over Corners Under when pressure evidence is strong. Be very selective with Corners Under.
${activeCornersSanityAlert}
- Odds >= 2.50 => confidence cap 6, stake cap 3%
- Over 3.5+ needs current goals >= line-1 or a clearly open match
- risk_level HIGH => should_push false
`
      : `- 1X2 and BTTS No need full_live_data, confidence >= 7, and strong stat support
- BTTS Yes needs tier 1 evidence
- Tier 3 may only use O/U or selective AH
- Thin balanced totals need a pass unless live evidence is clearly asymmetric.
- Goals and AH are primary markets. Corners are tertiary and require cleaner evidence than goals/AH.
- Corners require tier 1 live stats + live corners data
- If ODDS SANITY NOTES removed a corners market, do NOT recommend any corners market and do NOT infer a replacement corners line from stats.
- Prefer Corners Over over Corners Under when pressure evidence is strong. Be very selective with Corners Under.
- If corners line is far above current live corners late in the match (gap >= 3 after minute 75), assume stats desync/delay and skip ALL corners markets.
${advancedCornersRules}
${advancedBalancedTotalsRule}
${profileOverlayDisciplineSection}
${v8MarketBalanceSection}
${activeCornersSanityAlert}
- Odds >= 2.50 => confidence cap 6, stake cap 3%
- Over 3.5+ needs current goals >= line-1 or a clearly open match
${advancedLineSpecificRule}- Score 0-0 after minute 55: prefer goal unders, not corners under
- risk_level HIGH => should_push false
`;
    return `
You are a disciplined live football investment analyst. Analyze one live match and return either one realistic investment idea or no bet. Evaluate custom conditions separately.
${buildForceAnalyzeContextCompact(data, analysisMode)}========================
CORE SETTINGS
========================
PROMPT_VERSION: ${promptVersion}
${settledReplayTraceBlock ? `${settledReplayTraceBlock}\n` : ''}- Late phase >= ${LATE_PHASE_MINUTE}; very late >= ${VERY_LATE_PHASE_MINUTE}; endgame >= ${ENDGAME_MINUTE}
- MIN_ODDS: ${MIN_ODDS}
- No market below ${MIN_ODDS}
- No 1X2 before minute 35
- Canonical bet_market values only. Generic market family names are invalid.
- value_percent = estimated edge vs market price, range -50..100
- Odds warning: ${oddsWarnings || 'none'}
${buildExactMarketContractSectionCompact(data)}

${lowEvidenceConditionGuard}${structuredPrematchAskAiSection}${buildPrematchExpertFeaturesSection(data, true)}${buildProfileMetricSemanticsSection(data.leagueProfile ?? null, data.homeTeamProfile ?? null, data.awayTeamProfile ?? null, true)}========================
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
${JSON.stringify(prunedBasicStatsCompact)}
STATS_AVAILABLE: ${data.statsAvailable}
STATS_SOURCE: ${data.statsSource}
${statsMeta ? `STATS_META: ${JSON.stringify(statsMeta)}
` : ''}${buildAdvancedStatsSection(true, prunedAdvancedStatsCompact)}${!data.statsAvailable && data.derivedInsights ? `DERIVED_INSIGHTS: ${JSON.stringify(data.derivedInsights)}
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
${data.oddsSource === 'reference-prematch' ? `REFERENCE_PREMATCH_ODDS: These are static pre-match lines from European bookmakers (Pinnacle, Bet365, etc.), captured before or early in the match. They do NOT reflect the current live market.
WARNING: For Asian live bookmakers (K88, SBO, Pinnacle Asia, IBC), the actual live O/U line at this moment is typically 0.5–1.5 goals LOWER than the pre-match line shown here, because they quote remaining-goals lines that account for goals already scored and time elapsed.
ACTION: Do NOT recommend O/U or Asian Handicap bets based on these pre-match lines. If you must recommend, explicitly state the uncertainty and tell the user to verify the current live line at their bookmaker before placing.
` : ''}${data.oddsSource === 'fallback-live' ? 'FALLBACK_LIVE_ODDS: fallback live snapshot may lag slightly.\n' : ''}${!data.oddsAvailable ? 'Treat odds as unavailable and be conservative.\n' : ''}${!data.oddsSuspicious && oddsSanityWarnings.length > 0 ? `ODDS SANITY NOTES:\n${oddsSanityWarnings.map((w) => '- ' + w).join('\n')}
Use these notes as market-level restrictions, not a reason to discard the entire odds feed.\n` : ''}${data.oddsSuspicious ? `ODDS SANITY FAILED:\n${oddsSanityWarnings.map((w) => '- ' + w).join('\n')}
Treat odds as unreliable and behave as if ODDS_AVAILABLE=false.
` : ''}ODDS RULE: canonical odds are already filtered; never infer missing markets and never invent prices.

========================
RECENT EVENTS
========================
${JSON.stringify(data.eventsCompact)}
EVENT_COUNT: ${data.eventsCompact.length}

${buildPreviousRecommendationsSectionCompact(data)}${bettingDisciplineSection}${buildContinuityRulesSectionCompact(data, promptVersion)}${buildMatchTimelineSection(data)}${buildHistoricalPerformanceSection(data)}========================
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

${buildAiRecommendedConditionSection(data)}
${followUpContextSection}
${lineupsSnapshotSection}

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
${advancedBettingRules}${compactMarketSelectionRules}

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

${buildCustomConditionsInstructionSection(true, data)}

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
  "condition_triggered_stake": number,
  "condition_triggered_special_override": boolean,
  "condition_triggered_special_override_reason_en": string,
  "condition_triggered_special_override_reason_vi": string,
  "follow_up_answer_en": string,
  "follow_up_answer_vi": string
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
${lowEvidenceConditionGuard}${structuredPrematchAskAiSection}
============================================================
DEFINITIONS & THRESHOLDS (READ FIRST)
============================================================
PROMPT_VERSION: ${promptVersion}
${settledReplayTraceBlock ? `${settledReplayTraceBlock}\n\n` : ''}LATE GAME THRESHOLDS:
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

${buildPrematchExpertFeaturesSection(data, false)}${buildProfileMetricSemanticsSection(data.leagueProfile ?? null, data.homeTeamProfile ?? null, data.awayTeamProfile ?? null, false)}
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
${JSON.stringify(prunedBasicStatsCompact)}

STATS_AVAILABLE: ${data.statsAvailable}
STATS_SOURCE: ${data.statsSource}
${statsMeta ? `STATS_META: ${JSON.stringify(statsMeta)}
` : ''}
${buildAdvancedStatsSection(false, prunedAdvancedStatsCompact)}
${!data.statsAvailable && data.derivedInsights ? `
========================
DERIVED INSIGHTS (FROM EVENTS)
========================
${JSON.stringify(data.derivedInsights)}
These insights are DERIVED from match events. Reduce confidence by 1 compared to full stats.
` : ''}
========================
${!data.oddsAvailable ? 'NO USABLE ODDS AVAILABLE' : data.oddsSource === 'reference-prematch' ? 'PRE-MATCH ODDS (REFERENCE ONLY)' : data.oddsSource === 'fallback-live' ? 'LIVE ODDS (fallback live source)' : 'LIVE ODDS SNAPSHOT (CANONICAL JSON)'}
========================
${JSON.stringify(data.oddsCanonical)}

ODDS_AVAILABLE: ${data.oddsAvailable}
ODDS_SOURCE: ${data.oddsSource}
ODDS_FETCHED_AT: ${data.oddsFetchedAt ?? 'unknown'} (match minute at fetch: ${data.minute})
CURRENT_TOTAL_GOALS: ${data.currentTotalGoals}
CURRENT_TOTAL_CORNERS: ${currentTotalCorners}
${data.oddsSource === 'reference-prematch' ? '\nCAUTION: These are PRE-MATCH opening odds fetched before kickoff. Live odds are unavailable for this match.\nYou CAN still use them as a baseline for market direction and value, but adjust confidence based on the current game state.\n' : ''}${data.oddsSource === 'fallback-live' ? '\nNOTE: These odds are from a fallback live source. They may lag slightly versus the primary live feed.\n' : ''}${!data.oddsAvailable ? '\nNO_USABLE_ODDS: Treat odds as unavailable and be conservative.\n' : ''}${!data.oddsSuspicious && oddsSanityWarnings.length > 0 ? `\nODDS SANITY NOTES:\n${oddsSanityWarnings.map((w) => '- ' + w).join('\n')}\nTreat these as market-specific restrictions, not a reason to discard the entire odds feed.\n` : ''}${data.oddsSuspicious ? `\nODDS SANITY CHECK FAILED:\n${oddsSanityWarnings.map((w) => '- ' + w).join('\n')}\nTreat ALL odds as UNRELIABLE. Behave as if ODDS_AVAILABLE = false.\n` : ''}
ODDS METHODOLOGY:
- Odds are the BEST available across multiple bookmakers (highest price per outcome).
- Markets with invalid implied-probability margins have been PRE-REMOVED by the system.
- If a market is present in the canonical data, it has PASSED margin validation and is RELIABLE.
- Focus your analysis on the markets that ARE present. Do not infer missing markets.

========================
RECENT EVENTS (LAST 8)
========================
${JSON.stringify(data.eventsCompact)}

EVENT_COUNT: ${data.eventsCompact.length}

${buildPreviousRecommendationsSection(data)}
${buildMatchTimelineSection(data)}
${buildContinuityRulesSection(data)}
${buildHistoricalPerformanceSection(data)}
${buildFollowUpContextSection(data, false)}
========================
CONFIG / MODE
========================
- MIN_CONFIDENCE: ${MIN_CONFIDENCE}
- MIN_ODDS: ${MIN_ODDS}
- CUSTOM_CONDITIONS: ${data.customConditions || '(none)'}
- EVIDENCE_MODE: ${data.evidenceMode}
- EVIDENCE_TIER: ${evidenceTierRule.tier} (${evidenceTierRule.label})

${buildAiRecommendedConditionSection(data)}

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
${fullMarketSelectionRules}

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

${buildCustomConditionsInstructionSection(false, data)}

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
  "condition_triggered_stake": number,
  "condition_triggered_special_override": boolean,
  "condition_triggered_special_override_reason_en": string,
  "condition_triggered_special_override_reason_vi": string,
  "follow_up_answer_en": string,
  "follow_up_answer_vi": string
}

ALL fields must exist. selection="" when should_push=false. bet_market="" when should_push=false.
The FIRST character MUST be "{" and the LAST must be "}".
NO markdown, NO code fences, NO commentary outside JSON.
`;
}
