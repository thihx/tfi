import { normalizeMarket } from './normalize-market.js';
import type { SettledReplayScenario } from './db-replay-scenarios.js';
import type { ReplayRunOutput } from './pipeline-replay.js';

type CompactStatsPair = {
  home: string | number | null;
  away: string | number | null;
};

export interface ReplaySelfAuditCase {
  scenarioName: string;
  recommendationId: number;
  promptVersion: string;
  originalBetMarket: string;
  replayBetMarket: string;
  replayShouldPush: boolean;
  primaryDecisionDriver: string;
  secondaryDrivers: string[];
  consideredMarkets: string[];
  rejectedMarkets: string[];
  underFallbackDetected: boolean;
  genericReasoningDetected: boolean;
  priorsRole: 'confirming' | 'neutral' | 'contradicting' | 'ignored' | 'unknown';
  liveEvidenceWeight: 'primary' | 'balanced' | 'weak' | 'unknown';
  oddsAvailabilityIssue: boolean;
  continuityBlock: boolean;
  policyRestriction: boolean;
  whyNot1x2: string;
  whyNotAsianHandicap: string;
  notes: string;
}

export interface ReplaySelfAuditSummary {
  total: number;
  underFallbackDetected: number;
  genericReasoningDetected: number;
  oddsAvailabilityIssue: number;
  continuityBlock: number;
  policyRestriction: number;
  priorsIgnored: number;
  priorsContradicting: number;
  replayUnderCount: number;
  replayNoBetCount: number;
  primaryDrivers: Array<{ key: string; count: number }>;
}

function asArrayOfStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => String(entry ?? '').trim())
    .filter((entry) => entry.length > 0);
}

function cleanCompactStats(pair: CompactStatsPair | undefined): CompactStatsPair | null {
  if (!pair) return null;
  const home = pair.home ?? null;
  const away = pair.away ?? null;
  if (home == null && away == null) return null;
  return { home, away };
}

function buildCompactStatsFromScenario(scenario: SettledReplayScenario): Record<string, CompactStatsPair> {
  const compact: Record<string, CompactStatsPair> = {};
  const homeStats = Array.isArray(scenario.statistics) ? scenario.statistics[0]?.statistics ?? [] : [];
  const awayStats = Array.isArray(scenario.statistics) ? scenario.statistics[1]?.statistics ?? [] : [];

  const statMap: Array<[string, string]> = [
    ['possession', 'Ball Possession'],
    ['shots', 'Total Shots'],
    ['shots_on_target', 'Shots on Goal'],
    ['corners', 'Corner Kicks'],
    ['fouls', 'Fouls'],
    ['offsides', 'Offsides'],
    ['yellow_cards', 'Yellow Cards'],
    ['red_cards', 'Red Cards'],
    ['goalkeeper_saves', 'Goalkeeper Saves'],
    ['blocked_shots', 'Blocked Shots'],
    ['total_passes', 'Total passes'],
    ['passes_accurate', 'Passes accurate'],
    ['shots_off_target', 'Shots off Goal'],
    ['shots_inside_box', 'Shots insidebox'],
    ['shots_outside_box', 'Shots outsidebox'],
    ['expected_goals', 'expected_goals'],
    ['goals_prevented', 'goals_prevented'],
    ['passes_percent', 'Passes %'],
  ];

  for (const [key, type] of statMap) {
    const home = homeStats.find((entry) => entry.type === type)?.value ?? null;
    const away = awayStats.find((entry) => entry.type === type)?.value ?? null;
    const normalized = cleanCompactStats({ home, away });
    if (normalized) compact[key] = normalized;
  }

  return compact;
}

function buildOddsSummary(scenario: SettledReplayScenario): Record<string, unknown> {
  const source = scenario.mockResolvedOdds ?? null;
  if (!source || typeof source !== 'object') return {};
  return source as unknown as Record<string, unknown>;
}

function extractReplayBetMarket(output: ReplayRunOutput): string {
  const parsed = (output.result.debug?.parsed ?? {}) as Record<string, unknown>;
  return normalizeMarket(output.result.selection || '', String(parsed.bet_market || ''));
}

function extractPromptSection(prompt: string | undefined, sectionLabel: string): string {
  const text = String(prompt || '');
  if (!text) return '';
  const normalizedLabel = sectionLabel.trim();
  const headerIndex = text.indexOf(normalizedLabel);
  if (headerIndex < 0) return '';

  const beforeHeaderDivider = text.lastIndexOf('========================', headerIndex);
  const sectionStart = beforeHeaderDivider >= 0 ? beforeHeaderDivider : headerIndex;
  const nextDivider = text.indexOf('========================', headerIndex + normalizedLabel.length);
  if (nextDivider > headerIndex) {
    const afterNextDivider = text.indexOf('========================', nextDivider + '========================'.length);
    if (afterNextDivider > nextDivider) {
      return text.slice(sectionStart, afterNextDivider).trim();
    }
  }

  const lineBreakAfterHeader = text.indexOf('\n', headerIndex + normalizedLabel.length);
  const nextSectionDivider = lineBreakAfterHeader >= 0
    ? text.indexOf('========================', lineBreakAfterHeader)
    : -1;
  const sectionEnd = nextSectionDivider > headerIndex ? nextSectionDivider : text.length;
  return text.slice(sectionStart, sectionEnd).trim();
}

export function buildReplaySelfAuditPrompt(
  scenario: SettledReplayScenario,
  replay: ReplayRunOutput,
): string {
  const parsed = (replay.result.debug?.parsed ?? {}) as Record<string, unknown>;
  const replayBetMarket = extractReplayBetMarket(replay);
  const compactStats = buildCompactStatsFromScenario(scenario);
  const oddsSummary = buildOddsSummary(scenario);
  const replayPrompt = String(replay.result.debug?.prompt || '');
  const quantitativePriors = extractPromptSection(replayPrompt, 'QUANTITATIVE_PREMATCH_PRIORS');
  const leagueProfile = extractPromptSection(replayPrompt, 'LEAGUE PROFILE');
  const strategicContext = extractPromptSection(replayPrompt, 'STRATEGIC CONTEXT (FROM PRE-MATCH RESEARCH)');
  const prematchFeatures = extractPromptSection(replayPrompt, 'PREMATCH EXPERT FEATURES V1');
  const priorContext = [
    quantitativePriors,
    prematchFeatures,
    leagueProfile,
    strategicContext,
  ].filter((entry) => entry.length > 0).join('\n\n');

  return `You are auditing a grounded football betting decision on a frozen replay snapshot.
Your job is NOT to propose a new bet. Your job is to explain why the replayed decision ended up as it did.

Return strict JSON only. No markdown.

SCENARIO
- scenario_name: ${scenario.name}
- recommendation_id: ${scenario.metadata.recommendationId}
- prompt_version: ${replay.result.debug?.promptVersion ?? scenario.metadata.originalPromptVersion}
- league: ${scenario.metadata.league}
- home_team: ${scenario.metadata.homeTeam}
- away_team: ${scenario.metadata.awayTeam}
- minute: ${scenario.metadata.minute ?? 'unknown'}
- score: ${scenario.metadata.score}
- status: ${scenario.metadata.status}
- evidence_mode: ${scenario.metadata.evidenceMode}
- prematch_strength: ${scenario.metadata.prematchStrength}
- profile_coverage_band: ${scenario.metadata.profileCoverageBand}
- overlay_coverage_band: ${scenario.metadata.overlayCoverageBand}
- policy_impact_band: ${scenario.metadata.policyImpactBand}

LIVE_STATS_COMPACT
${JSON.stringify(compactStats)}

RECORDED_ODDS_CONTEXT
${JSON.stringify(oddsSummary)}

PREVIOUS_RECOMMENDATIONS_CONTEXT
${JSON.stringify((scenario.previousRecommendations ?? []).map((row) => ({
  minute: row.minute,
  selection: row.selection,
  bet_market: row.bet_market,
  score: row.score,
  odds: row.odds,
  result: row.result ?? null,
  confidence: row.confidence ?? null,
  stake_percent: row.stake_percent ?? null,
})))}

PROMPT_PRIOR_CONTEXT
${priorContext || 'No explicit prematch prior section was available in the replay prompt.'}

REPLAY_OUTPUT
- should_push: ${replay.result.shouldPush}
- decision_kind: ${replay.result.decisionKind}
- selection: ${replay.result.selection || ''}
- replay_bet_market: ${replayBetMarket}
- confidence: ${replay.result.confidence}
- reasoning_en: ${String(parsed.reasoning_en ?? '')}
- reasoning_vi: ${String(parsed.reasoning_vi ?? '')}
- warnings: ${JSON.stringify(asArrayOfStrings(parsed.warnings))}

AUDIT TASK
Explain the root cause of the replay output.
Focus on:
1. why this market or no-bet happened
2. whether goals_under became a generic fallback
3. whether priors actually helped, contradicted, or were ignored
4. whether 1x2_home or asian_handicap_home were meaningfully considered
5. whether odds availability, continuity/exposure, or policy restrictions dominated the outcome

IMPORTANT DISCIPLINE
- Be concrete.
- Do not invent missing markets if the odds context does not contain them.
- If the replay output is no-bet, explain the strongest blocker.
- If the replay output is goals_under, explicitly state whether the reasoning is generic.
- If priors are not actually used in a decisive way, say "ignored" or "neutral".
- If 1x2_home or asian_handicap_home were not viable because the odds were missing, say so directly.

STRICT JSON OUTPUT
{
  "primary_decision_driver": string,
  "secondary_drivers": string[],
  "considered_markets": string[],
  "rejected_markets": string[],
  "under_fallback_detected": boolean,
  "generic_reasoning_detected": boolean,
  "priors_role": "confirming" | "neutral" | "contradicting" | "ignored" | "unknown",
  "live_evidence_weight": "primary" | "balanced" | "weak" | "unknown",
  "odds_availability_issue": boolean,
  "continuity_block": boolean,
  "policy_restriction": boolean,
  "why_not_1x2": string,
  "why_not_asian_handicap": string,
  "notes": string
}`;
}

export function parseReplaySelfAuditResponse(
  text: string,
  scenario: SettledReplayScenario,
  replay: ReplayRunOutput,
): ReplaySelfAuditCase {
  const trimmed = String(text || '').trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error('Self-audit response did not contain JSON.');
  }

  const parsed = JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
  return {
    scenarioName: scenario.name,
    recommendationId: scenario.metadata.recommendationId,
    promptVersion: replay.result.debug?.promptVersion ?? scenario.metadata.originalPromptVersion,
    originalBetMarket: scenario.metadata.originalBetMarket,
    replayBetMarket: extractReplayBetMarket(replay),
    replayShouldPush: replay.result.shouldPush,
    primaryDecisionDriver: String(parsed.primary_decision_driver ?? '').trim(),
    secondaryDrivers: asArrayOfStrings(parsed.secondary_drivers),
    consideredMarkets: asArrayOfStrings(parsed.considered_markets),
    rejectedMarkets: asArrayOfStrings(parsed.rejected_markets),
    underFallbackDetected: parsed.under_fallback_detected === true,
    genericReasoningDetected: parsed.generic_reasoning_detected === true,
    priorsRole: (['confirming', 'neutral', 'contradicting', 'ignored', 'unknown'] as const).includes(parsed.priors_role as never)
      ? parsed.priors_role as ReplaySelfAuditCase['priorsRole']
      : 'unknown',
    liveEvidenceWeight: (['primary', 'balanced', 'weak', 'unknown'] as const).includes(parsed.live_evidence_weight as never)
      ? parsed.live_evidence_weight as ReplaySelfAuditCase['liveEvidenceWeight']
      : 'unknown',
    oddsAvailabilityIssue: parsed.odds_availability_issue === true,
    continuityBlock: parsed.continuity_block === true,
    policyRestriction: parsed.policy_restriction === true,
    whyNot1x2: String(parsed.why_not_1x2 ?? '').trim(),
    whyNotAsianHandicap: String(parsed.why_not_asian_handicap ?? '').trim(),
    notes: String(parsed.notes ?? '').trim(),
  };
}

export function summarizeReplaySelfAudit(rows: ReplaySelfAuditCase[]): ReplaySelfAuditSummary {
  const primaryDrivers = new Map<string, number>();
  for (const row of rows) {
    const key = row.primaryDecisionDriver || 'unknown';
    primaryDrivers.set(key, (primaryDrivers.get(key) ?? 0) + 1);
  }

  return {
    total: rows.length,
    underFallbackDetected: rows.filter((row) => row.underFallbackDetected).length,
    genericReasoningDetected: rows.filter((row) => row.genericReasoningDetected).length,
    oddsAvailabilityIssue: rows.filter((row) => row.oddsAvailabilityIssue).length,
    continuityBlock: rows.filter((row) => row.continuityBlock).length,
    policyRestriction: rows.filter((row) => row.policyRestriction).length,
    priorsIgnored: rows.filter((row) => row.priorsRole === 'ignored').length,
    priorsContradicting: rows.filter((row) => row.priorsRole === 'contradicting').length,
    replayUnderCount: rows.filter((row) => row.replayBetMarket.startsWith('under_') && !row.replayBetMarket.startsWith('corners_')).length,
    replayNoBetCount: rows.filter((row) => !row.replayShouldPush || row.replayBetMarket === 'unknown').length,
    primaryDrivers: [...primaryDrivers.entries()]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)),
  };
}
