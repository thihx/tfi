import {
  getProviderFixtureMapping,
  upsertProviderFixtureMapping,
  type ProviderFixtureMappingRow,
} from '../repos/provider-fixture-mappings.repo.js';
import type { ProviderId, ProviderMappingConfidence } from './canonical/provider-domain.js';

export const PROVIDER_FIXTURE_MAPPING_METHODS = [
  'manual_verified',
  'provider_cross_reference',
  'kickoff_team_league_match',
  'date_team_match',
  'imported',
] as const;

export type ProviderFixtureMappingMethod = typeof PROVIDER_FIXTURE_MAPPING_METHODS[number];

export interface ProviderFixtureMappingSource {
  matchId: string | number;
  kickoffAtUtc: string | null;
  kickoffTimestamp: number | null;
  leagueId: string | number | null;
  leagueName?: string | null;
  homeName: string;
  awayName: string;
  homeAliases?: string[];
  awayAliases?: string[];
}

export interface ProviderFixtureMappingCandidate {
  providerFixtureId: string | number;
  kickoffAtUtc?: string | null;
  kickoffTimestamp?: number | null;
  leagueId?: string | number | null;
  leagueName?: string | null;
  homeName: string;
  awayName: string;
  homeAliases?: string[];
  awayAliases?: string[];
}

export interface ProviderFixtureCandidateScore<TCandidate> {
  candidate: TCandidate;
  fixture: ProviderFixtureMappingCandidate;
  score: number;
  confidence: ProviderMappingConfidence;
  mappingMethod: ProviderFixtureMappingMethod;
  reasons: string[];
  warnings: string[];
  rejected: boolean;
}

export interface ProviderFixtureMappingResult<TCandidate> {
  provider: ProviderId;
  matchId: string;
  providerFixtureId: string;
  fixture: TCandidate | null;
  confidence: ProviderMappingConfidence;
  mappingMethod: ProviderFixtureMappingMethod;
  score: number | null;
  reasons: string[];
  warnings: string[];
  evidence: Record<string, unknown>;
  canUseForMoneyDecision: boolean;
  source: 'existing' | 'candidate_search' | 'not_found';
}

export interface ResolveProviderFixtureMappingInput<TCandidate> {
  provider: ProviderId;
  source: ProviderFixtureMappingSource;
  candidateToFixture: (candidate: TCandidate) => ProviderFixtureMappingCandidate;
  fetchFixtureByProviderId?: (providerFixtureId: string) => Promise<TCandidate | null>;
  fetchCandidatesByDate?: (dateKey: string) => Promise<TCandidate[]>;
  getExistingMapping?: (matchId: string, provider: string) => Promise<ProviderFixtureMappingRow | null>;
  upsertMapping?: typeof upsertProviderFixtureMapping;
}

const TEAM_WORDS_TO_DROP = new Set([
  'fc',
  'cf',
  'sc',
  'afc',
  'club',
  'football',
  'soccer',
  'the',
]);

const PROVIDER_MAPPING_CONFIDENCES = new Set<ProviderMappingConfidence>([
  'verified',
  'high',
  'medium',
  'low',
  'unknown',
]);

const PROVIDER_MAPPING_METHODS = new Set<string>(PROVIDER_FIXTURE_MAPPING_METHODS);

function cleanString(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

function stringOrNull(value: unknown): string | null {
  const text = cleanString(value);
  return text ? text : null;
}

function numberOrNull(value: unknown): number | null {
  if (value == null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function dateKeyFromSource(source: ProviderFixtureMappingSource): string | null {
  const direct = stringOrNull(source.kickoffAtUtc);
  if (direct && direct.length >= 10) return direct.slice(0, 10);
  if (source.kickoffTimestamp != null) return new Date(source.kickoffTimestamp * 1000).toISOString().slice(0, 10);
  return null;
}

function kickoffTimestamp(candidate: ProviderFixtureMappingCandidate): number | null {
  const direct = numberOrNull(candidate.kickoffTimestamp);
  if (direct != null) return direct;
  const iso = stringOrNull(candidate.kickoffAtUtc);
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

export function normalizeProviderTeamName(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((part) => part && !TEAM_WORDS_TO_DROP.has(part))
    .join(' ')
    .trim();
}

function tokens(value: string): Set<string> {
  return new Set(normalizeProviderTeamName(value).split(' ').filter(Boolean));
}

function tokenOverlap(left: string, right: string): number {
  const leftTokens = tokens(left);
  const rightTokens = tokens(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let matched = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) matched += 1;
  }
  return matched / Math.max(leftTokens.size, rightTokens.size);
}

export function providerTeamNamesSimilar(left: string, right: string, aliases: string[] = []): boolean {
  const normalizedLeft = normalizeProviderTeamName(left);
  const candidates = [right, ...aliases].map(normalizeProviderTeamName).filter(Boolean);
  if (!normalizedLeft || candidates.length === 0) return false;
  return candidates.some((candidate) => (
    normalizedLeft === candidate
    || normalizedLeft.includes(candidate)
    || candidate.includes(normalizedLeft)
    || tokenOverlap(normalizedLeft, candidate) >= 0.67
  ));
}

function fixtureTeamNamesSimilar(
  sourceName: string,
  candidateName: string,
  sourceAliases: string[] = [],
  candidateAliases: string[] = [],
): boolean {
  return providerTeamNamesSimilar(sourceName, candidateName, candidateAliases)
    || providerTeamNamesSimilar(candidateName, sourceName, sourceAliases);
}

function normalizeConfidence(value: unknown, method?: unknown): ProviderMappingConfidence {
  const rawMethod = cleanString(method);
  if (rawMethod === 'manual_verified' || rawMethod === 'provider_cross_reference') return 'verified';
  const raw = cleanString(value) as ProviderMappingConfidence;
  return PROVIDER_MAPPING_CONFIDENCES.has(raw) ? raw : 'unknown';
}

function normalizeMethod(value: unknown): ProviderFixtureMappingMethod {
  const raw = cleanString(value);
  return PROVIDER_MAPPING_METHODS.has(raw) ? raw as ProviderFixtureMappingMethod : 'imported';
}

export function isProviderFixtureMappingMoneyEligible(confidence: ProviderMappingConfidence): boolean {
  return confidence === 'verified' || confidence === 'high';
}

export function scoreProviderFixtureCandidate<TCandidate>(
  source: ProviderFixtureMappingSource,
  candidate: TCandidate,
  candidateToFixture: (candidate: TCandidate) => ProviderFixtureMappingCandidate,
): ProviderFixtureCandidateScore<TCandidate> {
  const fixture = candidateToFixture(candidate);
  const reasons: string[] = [];
  const warnings: string[] = [];
  let score = 0;

  const homeMatches = fixtureTeamNamesSimilar(
    source.homeName,
    fixture.homeName,
    source.homeAliases,
    fixture.homeAliases,
  );
  const awayMatches = fixtureTeamNamesSimilar(
    source.awayName,
    fixture.awayName,
    source.awayAliases,
    fixture.awayAliases,
  );
  const reversedHome = fixtureTeamNamesSimilar(
    source.homeName,
    fixture.awayName,
    source.homeAliases,
    fixture.awayAliases,
  );
  const reversedAway = fixtureTeamNamesSimilar(
    source.awayName,
    fixture.homeName,
    source.awayAliases,
    fixture.homeAliases,
  );

  if (reversedHome && reversedAway && (!homeMatches || !awayMatches)) {
    return {
      candidate,
      fixture,
      score: 0,
      confidence: 'low',
      mappingMethod: 'date_team_match',
      reasons: ['home_away_reversed'],
      warnings,
      rejected: true,
    };
  }
  if (!homeMatches || !awayMatches) {
    return {
      candidate,
      fixture,
      score: 0,
      confidence: 'low',
      mappingMethod: 'date_team_match',
      reasons: [
        homeMatches ? 'home_name_match' : 'home_name_mismatch',
        awayMatches ? 'away_name_match' : 'away_name_mismatch',
      ],
      warnings,
      rejected: true,
    };
  }

  score += 60;
  reasons.push('home_name_match', 'away_name_match');

  const sourceKickoff = numberOrNull(source.kickoffTimestamp);
  const candidateKickoff = kickoffTimestamp(fixture);
  if (sourceKickoff != null && candidateKickoff != null) {
    const diffSeconds = Math.abs(sourceKickoff - candidateKickoff);
    if (diffSeconds <= 15 * 60) {
      score += 25;
      reasons.push('kickoff_within_15m');
    } else if (diffSeconds <= 3 * 60 * 60) {
      score += 15;
      reasons.push('kickoff_within_3h');
      warnings.push('kickoff_mild_uncertainty');
    } else {
      return {
        candidate,
        fixture,
        score,
        confidence: 'low',
        mappingMethod: 'date_team_match',
        reasons: [...reasons, 'kickoff_outside_tolerance'],
        warnings,
        rejected: true,
      };
    }
  } else {
    warnings.push('kickoff_missing_for_mapping');
  }

  const sourceLeagueId = stringOrNull(source.leagueId);
  const candidateLeagueId = stringOrNull(fixture.leagueId);
  if (sourceLeagueId && candidateLeagueId && sourceLeagueId === candidateLeagueId) {
    score += 15;
    reasons.push('league_id_match');
  } else if (
    source.leagueName
    && fixture.leagueName
    && providerTeamNamesSimilar(source.leagueName, fixture.leagueName)
  ) {
    score += 10;
    reasons.push('league_name_match');
  } else if (sourceLeagueId || candidateLeagueId || source.leagueName || fixture.leagueName) {
    warnings.push('league_uncertain_for_mapping');
  }

  const confidence: ProviderMappingConfidence = score >= 90 ? 'high' : 'medium';
  const mappingMethod: ProviderFixtureMappingMethod = reasons.includes('league_id_match') && reasons.includes('kickoff_within_15m')
    ? 'kickoff_team_league_match'
    : 'date_team_match';

  return {
    candidate,
    fixture,
    score,
    confidence,
    mappingMethod,
    reasons,
    warnings,
    rejected: false,
  };
}

export function selectBestProviderFixtureCandidate<TCandidate>(
  source: ProviderFixtureMappingSource,
  candidates: TCandidate[],
  candidateToFixture: (candidate: TCandidate) => ProviderFixtureMappingCandidate,
): ProviderFixtureCandidateScore<TCandidate> | null {
  const scored = candidates
    .map((candidate) => scoreProviderFixtureCandidate(source, candidate, candidateToFixture))
    .filter((candidate) => !candidate.rejected)
    .sort((left, right) => right.score - left.score);
  return scored[0] ?? null;
}

function existingEvidence(row: ProviderFixtureMappingRow, fixture: ProviderFixtureMappingCandidate | null): Record<string, unknown> {
  return {
    ...(row.evidence ?? {}),
    stored: true,
    storedConfidence: row.confidence,
    storedMethod: row.mapping_method,
    providerFixtureId: row.provider_fixture_id,
    fetchedMappedFixture: fixture != null,
  };
}

function candidateEvidence(
  source: ProviderFixtureMappingSource,
  best: ProviderFixtureCandidateScore<unknown>,
  candidateCount: number,
): Record<string, unknown> {
  return {
    score: best.score,
    confidence: best.confidence,
    method: best.mappingMethod,
    reasons: best.reasons,
    warnings: best.warnings,
    candidateCount,
    apiFixture: {
      kickoff: source.kickoffAtUtc,
      home: source.homeName,
      away: source.awayName,
      leagueId: source.leagueId,
      leagueName: source.leagueName ?? null,
    },
    providerFixture: {
      providerFixtureId: String(best.fixture.providerFixtureId),
      kickoff: best.fixture.kickoffAtUtc ?? null,
      home: best.fixture.homeName,
      away: best.fixture.awayName,
      leagueId: best.fixture.leagueId ?? null,
      leagueName: best.fixture.leagueName ?? null,
    },
  };
}

export async function resolveProviderFixtureMapping<TCandidate>(
  input: ResolveProviderFixtureMappingInput<TCandidate>,
): Promise<ProviderFixtureMappingResult<TCandidate>> {
  const provider = input.provider;
  const matchId = String(input.source.matchId);
  const getExisting = input.getExistingMapping ?? getProviderFixtureMapping;
  const upsertMapping = input.upsertMapping ?? upsertProviderFixtureMapping;

  const existing = await getExisting(matchId, provider);
  if (existing?.provider_fixture_id) {
    const fixture = input.fetchFixtureByProviderId
      ? await input.fetchFixtureByProviderId(existing.provider_fixture_id)
      : null;
    const fixtureRef = fixture ? input.candidateToFixture(fixture) : null;
    const confidence = normalizeConfidence(existing.confidence, existing.mapping_method);
    const mappingMethod = normalizeMethod(existing.mapping_method);
    const warnings = [
      ...(fixture ? [] : [`${provider}_mapped_fixture_not_found`]),
      ...(isProviderFixtureMappingMoneyEligible(confidence) ? [] : [`${provider}_mapping_low_confidence`]),
    ];
    return {
      provider,
      matchId,
      providerFixtureId: existing.provider_fixture_id,
      fixture,
      confidence,
      mappingMethod,
      score: null,
      reasons: ['stored_mapping'],
      warnings,
      evidence: existingEvidence(existing, fixtureRef),
      canUseForMoneyDecision: fixture != null && isProviderFixtureMappingMoneyEligible(confidence),
      source: 'existing',
    };
  }

  const dateKey = dateKeyFromSource(input.source);
  const candidates = dateKey && input.fetchCandidatesByDate ? await input.fetchCandidatesByDate(dateKey) : [];
  const best = selectBestProviderFixtureCandidate(input.source, candidates, input.candidateToFixture);
  if (!best) {
    return {
      provider,
      matchId,
      providerFixtureId: '',
      fixture: null,
      confidence: 'low',
      mappingMethod: 'date_team_match',
      score: null,
      reasons: [],
      warnings: [`${provider}_mapping_not_found`],
      evidence: {
        candidateCount: candidates.length,
        dateKey,
        source: {
          kickoff: input.source.kickoffAtUtc,
          home: input.source.homeName,
          away: input.source.awayName,
          leagueId: input.source.leagueId,
        },
      },
      canUseForMoneyDecision: false,
      source: 'not_found',
    };
  }

  const evidence = candidateEvidence(input.source, best as ProviderFixtureCandidateScore<unknown>, candidates.length);
  await upsertMapping({
    match_id: matchId,
    provider,
    provider_fixture_id: String(best.fixture.providerFixtureId),
    confidence: best.confidence,
    mapping_method: best.mappingMethod,
    evidence,
  });

  const warnings = [
    ...best.warnings,
    ...(isProviderFixtureMappingMoneyEligible(best.confidence) ? [] : [`${provider}_mapping_low_confidence`]),
  ];
  return {
    provider,
    matchId,
    providerFixtureId: String(best.fixture.providerFixtureId),
    fixture: best.candidate,
    confidence: best.confidence,
    mappingMethod: best.mappingMethod,
    score: best.score,
    reasons: best.reasons,
    warnings,
    evidence,
    canUseForMoneyDecision: isProviderFixtureMappingMoneyEligible(best.confidence),
    source: 'candidate_search',
  };
}
