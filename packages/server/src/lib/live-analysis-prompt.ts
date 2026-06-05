/** Live recommendation changes: follow `docs/live-recommendation-pipeline-vi.md` before editing. */
import { normalizeMarket } from './normalize-market.js';
import {
  buildPrematchExpertFeaturesV1,
  type PrematchExpertFeaturesV1,
} from './prematch-expert-features.js';
import { flattenLeagueProfileData } from '../repos/league-profiles.repo.js';
import { buildProfileMetricSemanticsSection } from './profile-metric-semantics.js';
import {
  isMarketAllowedForEvidenceMode,
  type LiveAnalysisEvidenceMode,
} from './evidence-mode-market-allowlist.js';

export type PromptStatsSource = 'api-football' | string;
export type PromptAnalysisMode = 'auto' | 'system_force' | 'manual_force';
export type PromptEvidenceMode = LiveAnalysisEvidenceMode;

/** Default live-analysis prompt when `LIVE_ANALYSIS_ACTIVE_PROMPT_VERSION` is unset or invalid. */
export const LIVE_ANALYSIS_PROMPT_VERSION = 'v10-hybrid-legacy-g';
export const LIVE_ANALYSIS_PROMPT_VERSIONS = [LIVE_ANALYSIS_PROMPT_VERSION] as const;
export type LiveAnalysisPromptVersion = (typeof LIVE_ANALYSIS_PROMPT_VERSIONS)[number] | string;
/** Reference official version for tests/replay tooling; runtime shadow uses env (`LIVE_ANALYSIS_SHADOW_*`), not this constant. */
export const LIVE_ANALYSIS_PROMPT_CANDIDATE_VERSION = 'v10-hybrid-legacy-g';

export function isLiveAnalysisPromptVersion(value: string): value is LiveAnalysisPromptVersion {
  return value === LIVE_ANALYSIS_PROMPT_VERSION;
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

export interface LiveAnalysisPerformanceMemoryRecord {
  key: string;
  canonicalMarket: string;
  minuteBand: string;
  scoreState: string;
  total: number;
  wins: number;
  losses: number;
  halfWins: number;
  halfLosses: number;
  pushes: number;
  empiricalWinRate: number;
  sampleReliable: boolean;
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
    confirmedStarters: string[];
    benchCount: number;
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
  referenceOddsCanonical?: Record<string, unknown>;
  referenceOddsSource?: string;
  referenceOddsFetchedAt?: string | null;
  oddsSanityWarnings?: string[];
  oddsSuspicious?: boolean;
  derivedInsights: Record<string, unknown> | null;
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
  currentTotalGoals: number;
  previousRecommendations?: LiveAnalysisPromptPreviousRecommendation[];
  matchTimeline?: LiveAnalysisMatchTimelineSnapshot[];
  historicalPerformance?: LiveAnalysisHistoricalPerformance | null;
  performanceMemory?: {
    minuteBand: string;
    scoreState: string;
    records: LiveAnalysisPerformanceMemoryRecord[];
    autoRules?: Array<{
      key: string;
      canonicalMarket: string;
      minuteBand: string;
      scoreState: string;
      total: number;
      empiricalWinRate: number;
      suggestedAction: 'block' | 'raise_threshold';
    }>;
  } | null;
  preMatchContextSummary: string;
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
ADVANCED_STATS_POLICY: This optional block is rendered only when the source provides sufficient advanced stat coverage for this specific match. This block is rendered only when the source provides sufficient advanced stat coverage for this specific match. If absent in other matches, do not assume missing values are zero.
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

function isStructuredPrematchAskAi(data: LiveAnalysisPromptInput): boolean {
  return data.structuredPrematchAskAi === true;
}

function buildStructuredPrematchAskAiSection(compact: boolean, data: LiveAnalysisPromptInput): string {
  if (!isStructuredPrematchAskAi(data)) return '';

  return compact
    ? `STRUCTURED PREMATCH ASK AI OVERRIDE:
- This is a MANUAL Ask AI request for a NOT STARTED top-league match.
- Live telemetry is sparse, but structured prematch context is available from profile priors and strategic context.
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

function buildPerformanceMemorySection(data: LiveAnalysisPromptInput): string {
  const memory = data.performanceMemory;
  if (!memory || !Array.isArray(memory.records) || memory.records.length === 0) return '';

  const lines: string[] = [];
  lines.push('========================');
  lines.push('PERFORMANCE MEMORY');
  lines.push('========================');
  lines.push(`Current state: minuteBand=${memory.minuteBand}, scoreState=${memory.scoreState}`);
  lines.push('Historical combination priors (canonicalMarket|minuteBand|scoreState):');
  for (const record of memory.records) {
    const effectiveWins = record.wins + record.halfWins * 0.5;
    const effectiveLosses = record.losses + record.halfLosses * 0.5;
    lines.push(
      `- ${record.canonicalMarket}|${record.minuteBand}|${record.scoreState}: `
      + `${effectiveWins.toFixed(1)}W / ${effectiveLosses.toFixed(1)}L `
      + `(n=${record.total}, empirical_win_rate=${(record.empiricalWinRate * 100).toFixed(1)}%, `
      + `sample_reliable=${record.sampleReliable ? 'true' : 'false'})`,
    );
  }
  if (Array.isArray(memory.autoRules) && memory.autoRules.length > 0) {
    lines.push('');
    lines.push('Auto-generated risk candidates (lowest empirical win-rate first):');
    for (const rule of memory.autoRules.slice(0, 5)) {
      lines.push(
        `- ${rule.key}: win_rate=${(rule.empiricalWinRate * 100).toFixed(1)}%, `
        + `n=${rule.total}, suggested_action=${rule.suggestedAction}`,
      );
    }
  }
  lines.push('');
  lines.push('Memory usage rules:');
  lines.push('- If reliable empirical_win_rate < 40%, treat as hard no-bet unless exceptional hard evidence exists.');
  lines.push('- If reliable empirical_win_rate < 45%, require stricter live edge and lower stake.');
  lines.push('- If sample is not reliable and empirical_win_rate < 35%, treat as high-risk caution signal.');
  lines.push('- Do not invent memory records; use only records shown here.');
  lines.push('');
  return lines.join('\n');
}

function getEvidenceTierRule(data: LiveAnalysisPromptInput): EvidenceTierRule {
  if (isStructuredPrematchAskAi(data)) {
    return {
      tier: 'tier_2',
      label: 'Structured prematch context for manual Ask AI',
      allowedMarkets: 'Selective prematch O/U, AH, or 1X2 only when supported by structured profile priors',
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

function promptTextMentionsLineup(value: string | null | undefined): boolean {
  const normalized = String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return [
    'lineup',
    'line-up',
    'starting lineup',
    'starting xi',
    'doi hinh',
    'doi hinh ra san',
  ].some((term) => normalized.includes(term));
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

function getStrategicTrustedDomains(sourceMeta: Record<string, unknown>): string[] {
  return Array.isArray(sourceMeta.sources)
    ? (sourceMeta.sources as Array<Record<string, unknown>>)
      .filter((source) => {
        const trust = readStrategicText(source.trust_tier);
        return trust === 'tier_1' || trust === 'tier_2';
      })
      .map((source) => readStrategicText(source.domain))
      .filter(Boolean)
    : [];
}

function buildStrategicStructuredSignals(
  ctx: Record<string, unknown>,
  narrative: Record<string, unknown>,
): Record<string, unknown> {
  const pick = (...values: unknown[]) => values.find(hasStrategicText) ?? null;
  return Object.fromEntries(Object.entries({
    competition_type: pick(ctx.competition_type),
    home_motivation: pick(narrative.home_motivation, ctx.home_motivation),
    away_motivation: pick(narrative.away_motivation, ctx.away_motivation),
    league_positions: pick(narrative.league_positions, ctx.league_positions),
    fixture_congestion: pick(narrative.fixture_congestion, ctx.fixture_congestion),
    rotation_risk: pick(narrative.rotation_risk, ctx.rotation_risk),
    key_absences: pick(narrative.key_absences, ctx.key_absences),
  }).filter(([, value]) => value != null));
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
  const trustedDomains = getStrategicTrustedDomains(sourceMeta);
  const structuredSignals = buildStrategicStructuredSignals(ctx, narrativeEn);
  const hasNarrativeData = Object.keys(structuredSignals).length > 0;
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
  if (hasNarrativeData) {
    lines.push(`STRUCTURED_STRATEGIC_SIGNALS: ${JSON.stringify(structuredSignals)}`);
  }
  if (hasQuantitativeData) {
    lines.push(`QUANTITATIVE_PREMATCH_PRIORS: ${JSON.stringify(quantitative)}`);
  }
  lines.push('');
  lines.push('STRATEGIC CONTEXT RULES:');
  lines.push('- Treat strategic context as secondary pre-match prior. Live stats/events/odds still dominate.');
  lines.push('- Use structured signals and quantitative priors only; do not infer from missing long-form narrative.');
  lines.push('- If SOURCE_QUALITY is medium or unknown, use this context as soft guidance only and do NOT boost confidence aggressively.');
  lines.push('- QUANTITATIVE_PREMATCH_PRIORS are baseline tendencies, not live evidence. Use them to calibrate O/U, BTTS, or AH lean only when live evidence aligns.');
  lines.push('- COMPETITION_TYPE: For european/international/friendly competitions, teams are from DIFFERENT domestic leagues. LEAGUE_POSITIONS CANNOT be compared across leagues - IGNORE position gap signals.');
  lines.push('- LEAGUE_POSITIONS: ONLY for domestic_league matches: Top 3 vs bottom 3 = strong favourite signal. Within 3 places = evenly matched -> AVOID 1X2, prefer O/U or BTTS.');
  lines.push('- ROTATION / CONGESTION / KEY_ABSENCES reduce aggression for the affected side.');
  lines.push('- Motivation signals are weak priors: use them only if live tempo and odds agree.');
  lines.push('- FIXTURE_CONGESTION within 3 days of major match significantly increases rotation risk.');
  lines.push('- KEY_ABSENCES of star players should reduce expected goals for that team.');
  lines.push('- High Over 2.5 / BTTS rates may support attacking markets only if current tempo and shots agree.');
  lines.push('- High clean-sheet or failed-to-score rates may support Under / BTTS No only if live evidence does not contradict them.');
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
  const trustedDomains = getStrategicTrustedDomains(sourceMeta);
  const structuredSignals = buildStrategicStructuredSignals(ctx, narrativeEn);
  const hasNarrativeData = Object.keys(structuredSignals).length > 0;
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
  if (hasNarrativeData) lines.push(`STRUCTURED_STRATEGIC_SIGNALS: ${JSON.stringify(structuredSignals)}`);
  if (hasQuantitativeData) lines.push(`QUANTITATIVE_PREMATCH_PRIORS: ${JSON.stringify(quantitative)}`);
  lines.push('');
  lines.push('CONTEXT USE RULES:');
  lines.push('- Secondary prior only; live stats/events/odds dominate.');
  lines.push('- Medium/unknown quality => soft guidance only.');
  lines.push('- Use structured fields only; do not infer missing long-form narrative.');
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

function buildLinePatienceDeferHintSection(promptVersion: LiveAnalysisPromptVersion): string {
  if (!isV8PromptVersion(promptVersion)) return '';
  return `LINE PATIENCE (server may defer — still be honest now):
- AH chalk (-0.5/-0.75/-1): if live goals O/U Over is still above ~1.0, prefer should_push=false until Over drops toward 1.0/0.75/0.5.
- goals_over: avoid pushing an aggressive high line when a lower Over ladder rung has similar edge; prefer the conservative line or no_bet.
- corners_over: prefer lower corner lines when the ladder offers them; only exceptional confidence should push a higher line.
The server may hold your thesis across cycles and auto-promote when odds improve.

`;
}

function buildContinuityRulesSectionCompact(
  data: LiveAnalysisPromptInput,
  _promptVersion: LiveAnalysisPromptVersion,
): string {
  const recs = Array.isArray(data.previousRecommendations) ? data.previousRecommendations : [];
  if (recs.length === 0) return '';
  const advancedRules = true
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

function isCompactPromptVersion(_promptVersion: LiveAnalysisPromptVersion): boolean {
  return true;
}

function isBettingDisciplinePromptVersion(_promptVersion: LiveAnalysisPromptVersion): boolean {
  return true;
}

function isV8PromptVersion(_promptVersion: LiveAnalysisPromptVersion): boolean {
  return false;
}

function isV9PromptVersion(_promptVersion: LiveAnalysisPromptVersion): boolean {
  return false;
}

function isV10PromptVersion(_promptVersion: LiveAnalysisPromptVersion): boolean {
  return true;
}

function isV10HybridLegacyB(_promptVersion: LiveAnalysisPromptVersion): boolean {
  return false;
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

function buildProfileAndOverlayDisciplineSectionCompact(data: LiveAnalysisPromptInput, _promptVersion: LiveAnalysisPromptVersion): string {
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

OFFICIAL PROFILE DISCIPLINE:
- Quantitative profile priors are supporting evidence only.
- If prematch strength is weak or unavailable, default should_push=false unless live evidence is clearly one-sided and actionable.
- Tactical overlay is provenance-sensitive and cannot override live evidence.
- If both team overlays are neutral/unknown (${bothNeutral ? 'currently true' : 'currently false'}), tactical context is effectively unavailable for this run.
- Before backing generic goals_under, classify priors as aligned, neutral, or contradictory.
- If no market has a clean edge, return no bet.

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
  const asksAboutLineups = promptTextMentionsLineup(data.userQuestion)
    || (data.followUpHistory ?? []).some((entry) => promptTextMentionsLineup(entry.text));
  const shouldRender = asksAboutLineups;
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
    confirmed_starters: team.confirmedStarters,
    bench_count: team.benchCount,
  }));

  return compact
    ? `LINEUPS_SNAPSHOT:
${JSON.stringify(payload)}
- Treat lineup data as confirmed only for the names listed above.
- Substitutes are intentionally compressed to bench_count; do not invent bench player names, formations, or absences.

`
    : `========================
LINEUPS SNAPSHOT
========================
${JSON.stringify(payload)}
- Treat lineup data as confirmed only for the names listed above.
- Substitutes are intentionally compressed to bench_count; do not invent bench player names, formations, or absences.

`;
}

function buildV8MarketBalanceSectionCompact(_promptVersion: LiveAnalysisPromptVersion): string {
  return `OFFICIAL MARKET-BALANCE DISCIPLINE:
- Goals Under is not the default fallback for slow tempo, low shots, or modest xG.
- Before minute 60, generic low-event evidence alone is insufficient for goals_under.
- For goals_under, explicitly decide whether priors are aligned, neutral, or contradictory.
- If live evidence suggests favourite control, territory, or class edge and priors agree, evaluate 1x2_home, 1x2_away, asian_handicap_home, or asian_handicap_away before goals_under.
- If no market has a clean edge, return no bet.
`;
}

function buildV9LegacyLeanMarketSelectionSection(_compact: boolean): string {
  return buildV8MarketBalanceSectionCompact(LIVE_ANALYSIS_PROMPT_VERSION);
}

function buildV10HybridLegacyMarketSelectionSection(compact: boolean, _promptVersion?: LiveAnalysisPromptVersion): string {
  return compact
    ? `OFFICIAL O/U AND MARKET TIMING:
- 1X2 and BTTS No require full_live_data, confidence >= 7, strong stat support, and prematch support.
- BTTS Yes requires current dual-side threat.
- Goals O/U may be considered only when it independently earns edge; no automatic fallback.
- Minute 5-65: goals O/U needs clearly open and sustained attacking pattern.
- Minute 65+: goals_under is eligible only when low-scoring state and defensive/conservative script align.
- Do not treat 0-0 after minute 55 as automatic under.
- Corners and BTTS are off-menu when prematch strength is weak unless live evidence is overwhelming and line-specific.
- In one-goal games before halftime, do not force Full-time goals_over 4.5+ unless the game is already extreme and still accelerating.
`
    : `OFFICIAL O/U AND MARKET TIMING:
- 1X2 and BTTS No require full_live_data, confidence >= 7, strong stat support, and prematch support.
- BTTS Yes requires current dual-side threat.
- Goals O/U may be considered only when it independently earns edge; no automatic fallback.
- Minute 5-65: goals O/U needs clearly open and sustained attacking pattern.
- Minute 65+: goals_under is eligible only when low-scoring state and defensive/conservative script align.
- Do not treat 0-0 after minute 55 as automatic under.
- Corners and BTTS are off-menu when prematch strength is weak unless live evidence is overwhelming and line-specific.
- In one-goal games before halftime, do not force Full-time goals_over 4.5+ unless the game is already extreme and still accelerating.
`;
}

function buildV10HybridLegacyMinimalSection(compact: boolean, _promptVersion?: LiveAnalysisPromptVersion): string {
  return compact
    ? `OFFICIAL TIMING ADJUSTMENT:
- If 1X2 or BTTS No does not clear the higher bar, goals O/U may still be considered only when the O/U edge is independently clear.
- Do not treat 0-0 after minute 55 as automatic goals_under.
- Before minute 65, quiet or balanced states usually mean no bet rather than generic Under.
- In minute 30-44, low-line Full-time corners_under is exceptional-only once the match already has goals or the prematch prior is weak.
- In one-goal games between minute 30-44, BTTS Yes requires clear current threat from both teams.
`
    : `OFFICIAL TIMING ADJUSTMENT:
- If 1X2 or BTTS No does not clear the higher bar, goals O/U may still be considered only when the O/U edge is independently clear.
- Do not treat 0-0 after minute 55 as automatic goals_under.
- Before minute 65, quiet or balanced states usually mean no bet rather than generic Under.
- In minute 30-44, low-line Full-time corners_under is exceptional-only once the match already has goals or the prematch prior is weak.
- In one-goal games between minute 30-44, BTTS Yes requires clear current threat from both teams.
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
  _promptVersion: LiveAnalysisPromptVersion,
): string {
  const summaries = summarizeCorrelatedExposure(data);
  if (summaries.length === 0) return '';

  const lines = summaries.map((summary) => {
    const latestMinute = summary.latestMinute == null ? '?' : String(summary.latestMinute);
    const ladderAlert = summary.count >= 2
      ? ' [LADDER ALERT]'
      : '';
    return `- ${summary.label}: ${summary.count} prior pick(s), total prior stake ${summary.totalStake}%, latest at minute ${latestMinute}, lines: ${summary.canonicalMarkets.join(', ')}${ladderAlert}`;
  });

  const advancedRules = true
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

void [
  buildLeagueProfileSection,
  buildStrategicContextSection,
  buildStrategicContextSectionCompact,
  buildLeagueProfileSectionCompact,
];

export function buildExactMarketContractSectionCompact(data: LiveAnalysisPromptInput): string {
  const oc = data.oddsCanonical as Record<string, Record<string, unknown>>;
  const exactKeys: string[] = [];
  const rules: string[] = [];
  const allow = (...keys: string[]) => keys.every((key) => isMarketAllowedForEvidenceMode(key, data.evidenceMode));

  if (allow('1x2_home') && oc['1x2'] && oc['1x2'].home != null && oc['1x2'].draw != null && oc['1x2'].away != null) {
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

  if (allow('asian_handicap_home_0') && oc.ah && oc.ah.line != null && oc.ah.home != null && oc.ah.away != null) {
    const line = String(oc.ah.line);
    exactKeys.push(`asian_handicap_home_${line}`, `asian_handicap_away_${line}`);
    rules.push(`- Asian Handicap MAIN line ${line}: use exactly "asian_handicap_home_${line}" or "asian_handicap_away_${line}".`);
    rules.push(`  selection: "Home ${line} @[odds]" or "Away ${line} @[odds]".`);
  }

  const ahAdj = oc['ah_adjacent'] as { line?: unknown; home?: unknown; away?: unknown } | undefined;
  if (allow('asian_handicap_home_0') && ahAdj && ahAdj.line != null && ahAdj.home != null && ahAdj.away != null) {
    const line = String(ahAdj.line);
    exactKeys.push(`asian_handicap_home_${line}`, `asian_handicap_away_${line}`);
    rules.push(
      `- Asian Handicap ADJACENT line ${line}: second line nearest to main; pick home/away suffix keys only when this line fits the script better than main ${oc.ah?.line ?? '?'}.`,
    );
    rules.push(`  selection: "Home ${line} @[odds]" or "Away ${line} @[odds]".`);
  }

  const ahExtraList = Array.isArray(oc['ah_extra'])
    ? oc['ah_extra'] as Array<{ line?: unknown; home?: unknown; away?: unknown }>
    : [];
  for (const row of ahExtraList) {
    if (!allow('asian_handicap_home_0')) break;
    if (row.line == null || row.home == null || row.away == null) continue;
    const line = String(row.line);
    exactKeys.push(`asian_handicap_home_${line}`, `asian_handicap_away_${line}`);
    rules.push(
      `- Asian Handicap EXTRA ladder line ${line}: additional quoted rung beyond main/adjacent; use only when it clearly beats primary lines for the live script.`,
    );
    rules.push(`  selection: "Home ${line} @[odds]" or "Away ${line} @[odds]".`);
  }

  if (allow('btts_yes') && oc.btts && oc.btts.yes != null && oc.btts.no != null) {
    exactKeys.push('btts_yes', 'btts_no');
    rules.push('- BTTS: use exactly "btts_yes" or "btts_no".');
    rules.push('  selection: "BTTS Yes @[odds]" or "BTTS No @[odds]".');
  }

  if (allow('corners_over_0') && oc.corners_ou && oc.corners_ou.line != null && oc.corners_ou.over != null && oc.corners_ou.under != null) {
    const line = String(oc.corners_ou.line);
    exactKeys.push(`corners_over_${line}`, `corners_under_${line}`);
    rules.push(`- Corners O/U line ${line}: use exactly "corners_over_${line}" or "corners_under_${line}".`);
    rules.push(`  selection: "Corners Over ${line} @[odds]" or "Corners Under ${line} @[odds]".`);
  }

  if (allow('ht_1x2_home') && oc['ht_1x2'] && oc['ht_1x2'].home != null && oc['ht_1x2'].draw != null && oc['ht_1x2'].away != null) {
    exactKeys.push('ht_1x2_home', 'ht_1x2_draw', 'ht_1x2_away');
    rules.push('- H1 1X2: use exactly "ht_1x2_home", "ht_1x2_draw", or "ht_1x2_away".');
    rules.push('  selection: "H1 Home Win @[odds]", "H1 Draw @[odds]", or "H1 Away Win @[odds]".');
  }

  if (allow('ht_over_0') && oc.ht_ou && oc.ht_ou.line != null && oc.ht_ou.over != null && oc.ht_ou.under != null) {
    const line = String(oc.ht_ou.line);
    exactKeys.push(`ht_over_${line}`, `ht_under_${line}`);
    rules.push(`- H1 Goals O/U MAIN line ${line}: use exactly "ht_over_${line}" or "ht_under_${line}".`);
    rules.push(`  selection: "H1 Over ${line} Goals @[odds]" or "H1 Under ${line} Goals @[odds]".`);
  }

  const htOuAdj = oc['ht_ou_adjacent'] as { line?: unknown; over?: unknown; under?: unknown } | undefined;
  if (allow('ht_over_0') && htOuAdj && htOuAdj.line != null && htOuAdj.over != null && htOuAdj.under != null) {
    const line = String(htOuAdj.line);
    exactKeys.push(`ht_over_${line}`, `ht_under_${line}`);
    rules.push(
      `- H1 Goals O/U ADJACENT line ${line}: nearest H1 ladder line to main; use "ht_over_${line}" / "ht_under_${line}" only when it clearly fits better than main ${oc.ht_ou?.line ?? '?'}.`,
    );
    rules.push(`  selection: same pattern as main ("H1 Over ${line} Goals @[odds]" / "H1 Under ${line} Goals @[odds]").`);
  }

  if (allow('ht_asian_handicap_home_0') && oc.ht_ah && oc.ht_ah.line != null && oc.ht_ah.home != null && oc.ht_ah.away != null) {
    const line = String(oc.ht_ah.line);
    exactKeys.push(`ht_asian_handicap_home_${line}`, `ht_asian_handicap_away_${line}`);
    rules.push(`- H1 Asian Handicap MAIN line ${line}: use exactly "ht_asian_handicap_home_${line}" or "ht_asian_handicap_away_${line}".`);
    rules.push(`  selection: "H1 Home ${line} @[odds]" or "H1 Away ${line} @[odds]".`);
  }

  const htAhAdj = oc['ht_ah_adjacent'] as { line?: unknown; home?: unknown; away?: unknown } | undefined;
  if (allow('ht_asian_handicap_home_0') && htAhAdj && htAhAdj.line != null && htAhAdj.home != null && htAhAdj.away != null) {
    const line = String(htAhAdj.line);
    exactKeys.push(`ht_asian_handicap_home_${line}`, `ht_asian_handicap_away_${line}`);
    rules.push(
      `- H1 Asian Handicap ADJACENT line ${line}: second H1 line nearest to main; use this only when it fits better than main ${oc.ht_ah?.line ?? '?'}.`,
    );
    rules.push(`  selection: "H1 Home ${line} @[odds]" or "H1 Away ${line} @[odds]".`);
  }

  const htAhExtraList = Array.isArray(oc['ht_ah_extra'])
    ? oc['ht_ah_extra'] as Array<{ line?: unknown; home?: unknown; away?: unknown }>
    : [];
  for (const row of htAhExtraList) {
    if (!allow('ht_asian_handicap_home_0')) break;
    if (row.line == null || row.home == null || row.away == null) continue;
    const line = String(row.line);
    exactKeys.push(`ht_asian_handicap_home_${line}`, `ht_asian_handicap_away_${line}`);
    rules.push(
      `- H1 Asian Handicap EXTRA ladder line ${line}: additional H1 quoted rung; use only when it clearly beats main/adjacent for the half-time script.`,
    );
    rules.push(`  selection: "H1 Home ${line} @[odds]" or "H1 Away ${line} @[odds]".`);
  }

  if (allow('ht_btts_yes') && oc.ht_btts && oc.ht_btts.yes != null && oc.ht_btts.no != null) {
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

function parsePromptScore(score: string): { home: number; away: number; total: number; diff: number } | null {
  const match = String(score || '').trim().match(/^(\d+)\s*[-:]\s*(\d+)$/);
  if (!match) return null;
  const home = Number(match[1] ?? 0);
  const away = Number(match[2] ?? 0);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
  return { home, away, total: home + away, diff: Math.abs(home - away) };
}

function buildRuntimePolicyPreflightSection(
  data: LiveAnalysisPromptInput,
  settings: LiveAnalysisPromptSettings,
  compact: boolean,
): string {
  const score = parsePromptScore(data.score);
  const scoreState = !score
    ? 'unknown'
    : score.diff === 0
      ? 'level'
      : score.diff === 1
        ? 'one-goal-margin'
        : 'two-plus-margin';
  const minuteBand = data.minute <= 29
    ? '00-29'
    : data.minute <= 44
      ? '30-44'
      : data.minute <= 59
        ? '45-59'
        : data.minute <= 74
          ? '60-74'
          : '75+';
  const restrictions: string[] = [];

  restrictions.push(`- Minimum output gate: confidence must be >= ${settings.minConfidence}, value_percent must be >= 3, risk_level must not be HIGH, and odds must be >= ${settings.minOdds}.`);
  restrictions.push('- Runtime policy requires full_live_data plus a clear directional thesis for normal automatic bets. If evidence_mode is not full_live_data, return should_push=false for the AI recommendation path.');
  restrictions.push('- Normal automatic bets usually need break_even_rate < 0.50 (roughly odds > 2.00). If runtime policy explicitly enables the narrow balanced live value pocket, odds 1.65-2.00 may be considered only with full_live_data, confidence >= 7, value_percent >= 7, risk is not HIGH, and a clear directional thesis.');
  restrictions.push('- When enabled, the balanced live value pocket is limited to: Over 1.5 in minutes 60-84 with a one-goal margin, or Asian Handicap lines of +/-0.25 to +/-0.75 from minute 45-84 when the score is level or one-goal margin. Do not use it for BTTS, corners, 1X2, broad goals Under, or weak/degraded evidence.');
  restrictions.push('- High-risk markets (BTTS No, corners under 7.5/8.5/9.5, under 2.25, over 2.5) need break_even_rate < 0.48 and exceptional evidence; otherwise return should_push=false.');
  restrictions.push('- High-confidence AH protection pocket: only asian_handicap_home_+0.25/+0.5 or asian_handicap_away_+0.25/+0.5 may use odds around 1.82-2.00, and only with full_live_data, confidence >= 8, value_percent >= 8, and a clear directional thesis.');

  if (minuteBand === '30-44' && scoreState === 'one-goal-margin') {
    restrictions.push('- ACTIVE SCORE/MINUTE VETO: minute 30-44 with one-goal margin is a danger zone. Return should_push=false unless the candidate is either break_even_rate < 0.48 with full_live_data, or the high-confidence AH protection pocket.');
    restrictions.push('- BTTS No is blocked in this score state before minute 60. Do not recommend BTTS No here.');
    restrictions.push('- Corners props in this zone require confidence >= 8 and value_percent >= 7-8; weak/medium confidence corners should be no_bet.');
  }
  if (minuteBand === '45-59' || minuteBand === '60-74') {
    restrictions.push('- ACTIVE MIDGAME DISCIPLINE: do not force volatile midgame totals or props. Over 2.5, under 2.25, HT over 1.5, and fragile corners-under ladders are blocked unless a stricter listed exception applies.');
  }
  if (minuteBand === '60-74') {
    restrictions.push('- Late midgame under thin-cushion rule: goals Under with less than one goal of cushion requires confidence >= 8; otherwise should_push=false.');
    restrictions.push('- BTTS No is blocked from minute 60-74. Do not recommend BTTS No in this band.');
  }
  if (minuteBand === '75+' && scoreState === 'two-plus-margin') {
    restrictions.push('- Late two-plus-margin goals Under with less than one goal of cushion is normally no_bet unless it is exactly under_4.5 with current total goals = 4, full_live_data, confidence >= 7, value_percent >= 9, risk not HIGH, and break_even_rate < 0.50.');
  }
  if (scoreState === 'two-plus-margin' && minuteBand === '45-59') {
    restrictions.push('- Two-plus margin in minute 45-59 is high volatility. Default should_push=false for fresh totals/props unless the market has exceptional evidence and is not hard-blocked.');
  }
  if (score && score.total >= 1 && data.minute >= 30 && data.minute <= 44) {
    restrictions.push('- Corners Under low lines in minute 30-44 with goals already on board are fragile; prefer should_push=false unless corner suppression evidence is exceptionally clean.');
  }
  if (data.minute < 60) {
    restrictions.push('- BTTS No before minute 60 is a hard no-bet except narrowly supported early 0-0 full-live situations; one-goal margin BTTS No must be should_push=false.');
  }
  if (data.minute < 60) {
    restrictions.push('- Corners Over high lines before minute 60 are hard-blocked when line >= 12.5; do not recommend aggressive corners-over ladders.');
  }
  if (data.minute < 75) {
    restrictions.push('- 1X2 Home is blocked before minute 75 and 1X2 Draw is always blocked.');
  }

  const heading = compact
    ? 'RUNTIME POLICY PREFLIGHT'
    : 'RUNTIME POLICY PREFLIGHT (MIRRORS SERVER HARD GATES)';
  return `========================
${heading}
========================
CURRENT_POLICY_CONTEXT: minute_band=${minuteBand}; score_state=${scoreState}; evidence_mode=${data.evidenceMode}; total_goals=${score?.total ?? 'unknown'}.
If your candidate violates any active line below, return should_push=false with selection="" and bet_market="". Do not output a bet and rely on the server to block it.
${restrictions.join('\n')}

`;
}

export function buildLiveAnalysisPrompt(
  data: LiveAnalysisPromptInput,
  settings: LiveAnalysisPromptSettings,
  promptVersion: LiveAnalysisPromptVersion = LIVE_ANALYSIS_PROMPT_VERSION,
): string {
  promptVersion = LIVE_ANALYSIS_PROMPT_VERSION;
  const analysisMode = resolveAnalysisMode(data);
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
  const runtimePolicyPreflightSection = buildRuntimePolicyPreflightSection(
    data,
    settings,
    isCompactPromptVersion(promptVersion),
  );

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
- GOALS O/U (full match; not corners): late 0-0 (e.g. after minute 55) is not enough to default to goals_under. Before goals_under, compare explicitly against the best available goals_over on the same or nearest ladder line; pick Under only if Under's edge clearly exceeds Over by roughly 3+ percentage points. If edges are close or the script is not clearly shut down, prefer goals_over, a justified side market, or no_bet — not Under by habit. Do NOT use corners_under as a substitute for goal-total reads.
- risk_level = HIGH -> should_push = false.
`;

  if (isCompactPromptVersion(promptVersion)) {
    const bettingDisciplineSection = isBettingDisciplinePromptVersion(promptVersion)
      ? buildExistingExposureSectionCompact(data, promptVersion)
      : '';
    const advancedBettingRules = true
      ? `- First-half volume is a prior, not an automatic second-half trigger.
- At HT and in the first 10 minutes of 2H, do NOT project a wild first half straight into a new Over bet unless the early second-half flow confirms it with fresh pressure, shots, or transitions.
- Avoid new bets that still need two or more additional goals/events to win unless the match is truly exceptional.
- For Goals Over, if the line still needs two more goals to cash, default should_push=false unless there is a major class mismatch, red-card distortion, or overwhelming full-live evidence.
- Prefer entries where one more goal materially helps the position (push / half-win / full win) over lines that still require two more goals.
- Do not average into a same-thesis totals ladder just because the line moved from 3.5 -> 3 -> 2.75 -> 2.5. That is usually bankroll compounding, not a new edge.
`
      : '';
    const advancedLineSpecificRule = true
      ? '- At HT / early 2H, a fresh Over 3.5 from 1-1 is usually too demanding. Wait for better confirmation or a friendlier line.\n'
      : '';
    const advancedCornersRules = true
      ? `- Corners are a tertiary market. They are not a primary read on team quality, true scoring edge, or match motivation.
- Only choose corners when the corner-specific evidence is cleaner than any available Goals or AH thesis. If a goals/AH read is similarly strong, prefer goals/AH.
- Corners Under is exceptional-only. Default should_push=false unless the match is genuinely calm and corner-suppressing.
- Do NOT recommend Corners Under when either team is trailing and likely to chase, or when the game is stretched, transition-heavy, or producing obvious territorial pressure.
- Do NOT recommend Corners Under when shots, shots on target, or one-sided pressure already suggest repeated final-third entries. Corners Under needs a dead or tightly controlled game, not just a low current corner count.
- Treat corners ladders as fragile exposure. Do not staircase Corners Under from 10.5 -> 9.5 -> 8.5 -> 7.5.
- Corners markets should usually cap at confidence 6 and stake 3%. Corners Under should usually cap at confidence 5 and stake 2% unless the edge is exceptionally clean.
`
      : '';
    const advancedBalancedTotalsRule = true
      ? `- Balanced totals are not enough. In 1-1 or 0-0 states around minute 55-70, if possession, shots, and shots on target are broadly even and there is no clear pressure asymmetry, default should_push=false.
- Symmetric prices around 1.90 on both sides usually mean the market sees a thin edge. Do not force an Over or Under just because one more goal would cash.
- In minute 30-59, treat level or one-goal states as a danger zone for generic totals picks. If the edge is not clearly asymmetrical, default should_push=false rather than forcing an Under.
- In minute 30-59, if a totals thesis cannot name a concrete confirming prior, treat that as missing confirmation rather than neutral support.
`
      : '';
    const profileOverlayDisciplineSection = buildProfileAndOverlayDisciplineSectionCompact(data, promptVersion);
    const followUpContextSection = buildFollowUpContextSection(data, true);
    const lineupsSnapshotSection = buildLineupsSnapshotSection(data, true);
    const v8MarketBalanceSection = isV8PromptVersion(promptVersion)
      ? buildV8MarketBalanceSectionCompact(promptVersion)
      : '';
    const compactMarketSelectionRules = isV10HybridLegacyB(promptVersion)
      ? `- 1X2 and BTTS No are Tier-1-only markets. They need full_live_data, confidence >= 7, and strong stat support
- 1X2 and BTTS No need full_live_data, confidence >= 7, and strong stat support
- BTTS Yes requires at least Tier 1 evidence.
- BTTS Yes needs tier 1 evidence
- If 1X2 or AH is not justified, do NOT automatically fall back to Over/Under.
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
      ? `- 1X2 and BTTS No are Tier-1-only markets. They need full_live_data, confidence >= 7, and strong stat support
- 1X2 and BTTS No need full_live_data, confidence >= 7, and strong stat support
- BTTS Yes requires at least Tier 1 evidence.
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
      : `- 1X2 and BTTS No are Tier-1-only markets. They need full_live_data, confidence >= 7, and strong stat support
- 1X2 and BTTS No need full_live_data, confidence >= 7, and strong stat support
- BTTS Yes requires at least Tier 1 evidence.
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
${advancedLineSpecificRule}- Late 0-0 (e.g. after min 55): compare goals_over vs goals_under before any goals_under; no default Under. Do not use corners_under as a goals substitute.
- risk_level HIGH => should_push false
`;
    return `
You are a disciplined live football investment analyst. Analyze one live match and return either one realistic investment idea or no bet.
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

${structuredPrematchAskAiSection}${buildPrematchExpertFeaturesSection(data, true)}${buildProfileMetricSemanticsSection(data.leagueProfile ?? null, data.homeTeamProfile ?? null, data.awayTeamProfile ?? null, true)}========================
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
ODDS METHODOLOGY:
- Odds are the BEST available across multiple bookmakers after system canonicalization.
- Markets with invalid implied-probability margins are pre-removed before prompt rendering.
${data.oddsSource === 'reference-prematch' ? `REFERENCE_PREMATCH_ODDS: These are static pre-match lines from European bookmakers (Pinnacle, Bet365, etc.), captured before or early in the match. They do NOT reflect the current live market.
WARNING: For Asian live bookmakers (K88, SBO, Pinnacle Asia, IBC), the actual live O/U line at this moment is typically 0.5–1.5 goals LOWER than the pre-match line shown here, because they quote remaining-goals lines that account for goals already scored and time elapsed.
ACTION: Do NOT recommend O/U or Asian Handicap bets based on these pre-match lines. If you must recommend, explicitly state the uncertainty and tell the user to verify the current live line at their bookmaker before placing.
` : ''}${data.referenceOddsSource === 'reference-prematch' && data.referenceOddsCanonical ? `REFERENCE_PREMATCH_CONTEXT_ONLY: Live odds are unavailable, but a pre-match odds baseline exists. This is NOT actionable live pricing and MUST NOT be used to output a bet market.
REFERENCE_PREMATCH_FETCHED_AT: ${data.referenceOddsFetchedAt ?? 'unknown'}
REFERENCE_PREMATCH_CANONICAL_JSON: ${JSON.stringify(data.referenceOddsCanonical)}
` : ''}${data.oddsSource === 'fallback-live' ? 'FALLBACK_LIVE_ODDS: fallback live snapshot may lag slightly.\n' : ''}${!data.oddsAvailable ? 'Treat odds as unavailable and be conservative.\n' : ''}${!data.oddsSuspicious && oddsSanityWarnings.length > 0 ? `ODDS SANITY NOTES:\n${oddsSanityWarnings.map((w) => '- ' + w).join('\n')}
Use these notes as market-level restrictions, not a reason to discard the entire odds feed.\n` : ''}${data.oddsSuspicious ? `ODDS SANITY FAILED:\n${oddsSanityWarnings.map((w) => '- ' + w).join('\n')}
Treat odds as unreliable and behave as if ODDS_AVAILABLE=false.
` : ''}ODDS RULES:
- Canonical odds are already filtered; never infer missing markets and never invent prices.
- Treat odds exactly as provided in the canonical snapshot.

========================
RECENT EVENTS
========================
${JSON.stringify(data.eventsCompact)}
EVENT_COUNT: ${data.eventsCompact.length}

${buildPreviousRecommendationsSectionCompact(data)}${bettingDisciplineSection}${buildContinuityRulesSectionCompact(data, promptVersion)}${buildLinePatienceDeferHintSection(promptVersion)}${buildMatchTimelineSection(data)}${buildHistoricalPerformanceSection(data)}${buildPerformanceMemorySection(data)}========================
CONFIG / EVIDENCE
========================
- MIN_CONFIDENCE: ${MIN_CONFIDENCE}
- MIN_ODDS: ${MIN_ODDS}
- EVIDENCE_MODE: ${data.evidenceMode}
- EVIDENCE_TIER: ${evidenceTierRule.tier} (${evidenceTierRule.label})
- Allowed markets: ${evidenceTierRule.allowedMarkets}
- Forbidden markets: ${evidenceTierRule.forbiddenMarkets}
- Tier rule: ${evidenceTierRule.operationalRule}

${followUpContextSection}
${lineupsSnapshotSection}
${runtimePolicyPreflightSection}

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
RED CARD PROTOCOL:
- Re-evaluate all market theses after a red card; do not treat pre-card tempo as still valid.

BTTS:
- BTTS Yes: estimate must exceed break-even by >= 5%; if odds >= 2.00 then both teams need shots_on_target >= 2
- BTTS No: requires odds >= 1.70 and clear support such as score gap, one side with 0 SOT, or late clean-sheet game state

BREAK-EVEN:
- For every market, break_even_rate = 1/odds * 100
- Edge must be >= 3% or should_push=false
- Explain valuation using exact break-even plus a rounded fair-value range
- Do not expose break-even/fair-probability jargon in user-facing reasoning. Explain it as bankroll discipline, e.g. "Odds are slightly better than the required win chance, so keep stake small and controlled."

STAKE:
- confidence 8-10 => 5-8%
- confidence 6-7 => 3-5%
- confidence 5 => 2-3%
- confidence < 5 => should_push false, stake 0

SHADOW CANDIDATE DIAGNOSTIC:
- Always fill shadow_candidate in the JSON.
- If should_push=false, shadow_candidate should describe the best market you seriously considered and rejected, using canonical bet_market and real canonical odds only.
- If there is no viable candidate at all, leave selection/bet_market empty and set reason_code="no_viable_candidate".
- This diagnostic is telemetry only. Do not set should_push=true just to surface a candidate.

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
  "shadow_candidate": {
    "selection": string,
    "bet_market": string,
    "confidence": number,
    "value_percent": number,
    "risk_level": "LOW" | "MEDIUM" | "HIGH",
    "stake_percent": number,
    "reason_code": string,
    "reason_en": string,
    "reason_vi": string
  },
  "follow_up_answer_en": string,
  "follow_up_answer_vi": string
}
All fields must exist. selection="" and bet_market="" when should_push=false. shadow_candidate is diagnostic only and never triggers save/notify.
Return raw JSON only: first char "{" and last char "}".
NEVER wrap the JSON in markdown fences like \`\`\`json.
`;
  }

  return `
You are a professional live football investment insight analyst (not a gambler).
Your task is to analyze ONE live match and determine whether there is exactly ONE realistic, high-quality investment idea, or no idea at all.
${buildForceAnalyzeContext(data, analysisMode)}
${structuredPrematchAskAiSection}
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
${data.oddsSource === 'reference-prematch' ? '\nCAUTION: These are PRE-MATCH opening odds fetched before kickoff. Live odds are unavailable for this match.\nYou CAN still use them as a baseline for market direction and value, but adjust confidence based on the current game state.\n' : ''}${data.referenceOddsSource === 'reference-prematch' && data.referenceOddsCanonical ? `\nREFERENCE_PREMATCH_CONTEXT_ONLY: Live odds are unavailable, but a pre-match odds baseline exists. This is NOT actionable live pricing and MUST NOT be used to output a bet market.\nREFERENCE_PREMATCH_FETCHED_AT: ${data.referenceOddsFetchedAt ?? 'unknown'}\nREFERENCE_PREMATCH_CANONICAL_JSON: ${JSON.stringify(data.referenceOddsCanonical)}\n` : ''}${data.oddsSource === 'fallback-live' ? '\nNOTE: These odds are from a fallback live source. They may lag slightly versus the primary live feed.\n' : ''}${!data.oddsAvailable ? '\nNO_USABLE_ODDS: Treat odds as unavailable and be conservative.\n' : ''}${!data.oddsSuspicious && oddsSanityWarnings.length > 0 ? `\nODDS SANITY NOTES:\n${oddsSanityWarnings.map((w) => '- ' + w).join('\n')}\nTreat these as market-specific restrictions, not a reason to discard the entire odds feed.\n` : ''}${data.oddsSuspicious ? `\nODDS SANITY CHECK FAILED:\n${oddsSanityWarnings.map((w) => '- ' + w).join('\n')}\nTreat ALL odds as UNRELIABLE. Behave as if ODDS_AVAILABLE = false.\n` : ''}
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
${buildPerformanceMemorySection(data)}
${buildFollowUpContextSection(data, false)}
${runtimePolicyPreflightSection}
========================
CONFIG / MODE
========================
- MIN_CONFIDENCE: ${MIN_CONFIDENCE}
- MIN_ODDS: ${MIN_ODDS}
- EVIDENCE_MODE: ${data.evidenceMode}
- EVIDENCE_TIER: ${evidenceTierRule.tier} (${evidenceTierRule.label})

============================================================
PRE-MATCH CONTEXT RULES
============================================================
- Structured league/team profiles and strategic context are contextual only.
- They must NEVER override live evidence.
- Use them only when live stats are sparse and the current match state does not contradict the prior.
- Treat market overreaction ideas as hypotheses; require live evidence or reliable odds support before recommending.
- Strategic context (motivation, rotation, congestion) can add limited weight, but live flow and price remain primary.

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
  - Score 0-0 after minute 60: reduce confidence by 2 for BTTS Yes. If leaving BTTS Yes, do not default to goals_under — compare goals Over vs Under explicitly, or choose a justified side market / no_bet.
- BTTS NO:
  - Requires odds >= 1.70.
  - If BOTH teams have shots_on_target >= 2 -> should_push = false for BTTS No.
  - Only justified: score gap >= 2, OR minute >= 70 + one team has 0 SOT, OR minute >= 75 + clean sheet.

BREAK-EVEN CHECK (MANDATORY FOR ALL):
- Before recommending ANY market: break_even_rate = 1/odds x 100.
- Estimated probability must exceed break_even_rate by >= 3% (edge >= 3%).
- If edge < 3% -> should_push = false.
- Report valuation using exact break-even from odds plus a rounded fair-value estimate or range.
- Do not expose break-even/fair-probability jargon in user-facing reasoning. Explain it as bankroll discipline, e.g. "Odds are slightly better than the required win chance, so keep stake small and controlled."
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

SHADOW CANDIDATE DIAGNOSTIC:
- Always fill shadow_candidate in the JSON.
- If should_push=false, shadow_candidate should describe the best market you seriously considered and rejected, using canonical bet_market and real canonical odds only.
- If there is no viable candidate at all, leave selection/bet_market empty and set reason_code="no_viable_candidate".
- This diagnostic is telemetry only. Do not set should_push=true just to surface a candidate.

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
  "shadow_candidate": {
    "selection": string,
    "bet_market": string,
    "confidence": number,
    "value_percent": number,
    "risk_level": "LOW" | "MEDIUM" | "HIGH",
    "stake_percent": number,
    "reason_code": string,
    "reason_en": string,
    "reason_vi": string
  },
  "follow_up_answer_en": string,
  "follow_up_answer_vi": string
}

ALL fields must exist. selection="" when should_push=false. bet_market="" when should_push=false. shadow_candidate is diagnostic only and never triggers save/notify.
The FIRST character MUST be "{" and the LAST must be "}".
NO markdown, NO code fences, NO commentary outside JSON.
`;
}
