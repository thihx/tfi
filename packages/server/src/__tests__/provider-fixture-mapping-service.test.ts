import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isProviderFixtureMappingMoneyEligible,
  normalizeProviderTeamName,
  providerTeamNamesSimilar,
  resolveProviderFixtureMapping,
  scoreProviderFixtureCandidate,
  selectBestProviderFixtureCandidate,
  type ProviderFixtureMappingCandidate,
  type ProviderFixtureMappingSource,
} from '../lib/provider-fixture-mapping-service.js';
import {
  getProviderFixtureMapping,
  upsertProviderFixtureMapping,
} from '../repos/provider-fixture-mappings.repo.js';

vi.mock('../repos/provider-fixture-mappings.repo.js', () => ({
  getProviderFixtureMapping: vi.fn(),
  upsertProviderFixtureMapping: vi.fn(),
}));

const mockGetProviderFixtureMapping = vi.mocked(getProviderFixtureMapping);
const mockUpsertProviderFixtureMapping = vi.mocked(upsertProviderFixtureMapping);

interface Candidate {
  id: string;
  kickoffAtUtc?: string | null;
  kickoffTimestamp?: number | null;
  leagueId?: string | number | null;
  leagueName?: string | null;
  homeName: string;
  awayName: string;
  homeAliases?: string[];
  awayAliases?: string[];
}

const kickoffIso = '2026-06-11T19:00:00.000Z';
const kickoffTs = Math.floor(Date.parse(kickoffIso) / 1000);

function source(overrides: Partial<ProviderFixtureMappingSource> = {}): ProviderFixtureMappingSource {
  return {
    matchId: '164327',
    kickoffAtUtc: kickoffIso,
    kickoffTimestamp: kickoffTs,
    leagueId: 1,
    leagueName: 'World Cup',
    homeName: 'South Korea',
    awayName: 'Czech Republic',
    ...overrides,
  };
}

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: 'sm-987',
    kickoffAtUtc: kickoffIso,
    kickoffTimestamp: kickoffTs,
    leagueId: 1,
    leagueName: 'World Cup',
    homeName: 'South Korea',
    awayName: 'Czech Republic',
    ...overrides,
  };
}

function toFixture(row: Candidate): ProviderFixtureMappingCandidate {
  return {
    providerFixtureId: row.id,
    kickoffAtUtc: row.kickoffAtUtc ?? null,
    kickoffTimestamp: row.kickoffTimestamp ?? null,
    leagueId: row.leagueId ?? null,
    leagueName: row.leagueName ?? null,
    homeName: row.homeName,
    awayName: row.awayName,
    homeAliases: row.homeAliases,
    awayAliases: row.awayAliases,
  };
}

describe('provider-fixture-mapping-service', () => {
  beforeEach(() => {
    mockGetProviderFixtureMapping.mockReset().mockResolvedValue(null);
    mockUpsertProviderFixtureMapping.mockReset().mockResolvedValue({
      id: '1',
      match_id: '164327',
      provider: 'sportmonks',
      provider_fixture_id: 'sm-987',
      confidence: 'high',
      mapping_method: 'kickoff_team_league_match',
      evidence: {},
      first_seen_at: kickoffIso,
      last_seen_at: kickoffIso,
    });
  });

  it('normalizes provider team names and supports aliases for home-away matching', () => {
    expect(normalizeProviderTeamName('  Korea Republic FC  ')).toBe('korea republic');
    expect(providerTeamNamesSimilar('South Korea', 'Korea Republic', ['South Korea'])).toBe(true);
    expect(providerTeamNamesSimilar('Czech Republic', 'Czechia', ['Czech Republic'])).toBe(true);
    expect(providerTeamNamesSimilar('', 'Czechia')).toBe(false);
  });

  it('uses manual/exact stored mappings as verified and skips candidate search', async () => {
    mockGetProviderFixtureMapping.mockResolvedValueOnce({
      id: '1',
      match_id: '164327',
      provider: 'sportmonks',
      provider_fixture_id: 'sm-123',
      confidence: 'medium',
      mapping_method: 'manual_verified',
      evidence: { operator: 'kim' },
      first_seen_at: kickoffIso,
      last_seen_at: kickoffIso,
    });
    const fetchFixtureByProviderId = vi.fn().mockResolvedValue(candidate({ id: 'sm-123' }));
    const fetchCandidatesByDate = vi.fn();

    const result = await resolveProviderFixtureMapping({
      provider: 'sportmonks',
      source: source(),
      candidateToFixture: toFixture,
      fetchFixtureByProviderId,
      fetchCandidatesByDate,
    });

    expect(result).toMatchObject({
      providerFixtureId: 'sm-123',
      confidence: 'verified',
      mappingMethod: 'manual_verified',
      source: 'existing',
      canUseForMoneyDecision: true,
      warnings: [],
      reasons: ['stored_mapping'],
      evidence: expect.objectContaining({
        operator: 'kim',
        stored: true,
        fetchedMappedFixture: true,
      }),
    });
    expect(fetchFixtureByProviderId).toHaveBeenCalledWith('sm-123');
    expect(fetchCandidatesByDate).not.toHaveBeenCalled();
    expect(mockUpsertProviderFixtureMapping).not.toHaveBeenCalled();
  });

  it('keeps invalid stored mappings available for audit but not for money decisions', async () => {
    mockGetProviderFixtureMapping.mockResolvedValueOnce({
      id: '1',
      match_id: '164327',
      provider: 'sportmonks',
      provider_fixture_id: 'sm-bad',
      confidence: 'experimental',
      mapping_method: 'manual_review',
      evidence: {},
      first_seen_at: kickoffIso,
      last_seen_at: kickoffIso,
    });

    const result = await resolveProviderFixtureMapping({
      provider: 'sportmonks',
      source: source(),
      candidateToFixture: toFixture,
      fetchFixtureByProviderId: vi.fn().mockResolvedValue(candidate({ id: 'sm-bad' })),
      fetchCandidatesByDate: vi.fn(),
    });

    expect(result).toMatchObject({
      providerFixtureId: 'sm-bad',
      confidence: 'unknown',
      mappingMethod: 'imported',
      canUseForMoneyDecision: false,
      warnings: ['sportmonks_mapping_low_confidence'],
    });
  });

  it('marks missing stored provider fixtures as non-usable but preserves mapping evidence', async () => {
    mockGetProviderFixtureMapping.mockResolvedValueOnce({
      id: '1',
      match_id: '164327',
      provider: 'sportmonks',
      provider_fixture_id: 'missing',
      confidence: 'high',
      mapping_method: 'provider_cross_reference',
      evidence: { source: 'vendor_link' },
      first_seen_at: kickoffIso,
      last_seen_at: kickoffIso,
    });

    const result = await resolveProviderFixtureMapping({
      provider: 'sportmonks',
      source: source(),
      candidateToFixture: toFixture,
      fetchFixtureByProviderId: vi.fn().mockResolvedValue(null),
    });

    expect(result).toMatchObject({
      providerFixtureId: 'missing',
      confidence: 'verified',
      mappingMethod: 'provider_cross_reference',
      fixture: null,
      canUseForMoneyDecision: false,
      warnings: ['sportmonks_mapped_fixture_not_found'],
      evidence: expect.objectContaining({
        fetchedMappedFixture: false,
      }),
    });
  });

  it('scores and stores a high-confidence kickoff/team/league match with evidence', async () => {
    const fetchCandidatesByDate = vi.fn().mockResolvedValue([
      candidate({ id: 'sm-weak', kickoffTimestamp: kickoffTs + 2 * 60 * 60, leagueId: 99 }),
      candidate({ id: 'sm-987' }),
    ]);

    const result = await resolveProviderFixtureMapping({
      provider: 'sportmonks',
      source: source(),
      candidateToFixture: toFixture,
      fetchCandidatesByDate,
    });

    expect(fetchCandidatesByDate).toHaveBeenCalledWith('2026-06-11');
    expect(result).toMatchObject({
      providerFixtureId: 'sm-987',
      confidence: 'high',
      mappingMethod: 'kickoff_team_league_match',
      score: 100,
      canUseForMoneyDecision: true,
      warnings: [],
    });
    expect(mockUpsertProviderFixtureMapping).toHaveBeenCalledWith(expect.objectContaining({
      match_id: '164327',
      provider: 'sportmonks',
      provider_fixture_id: 'sm-987',
      confidence: 'high',
      mapping_method: 'kickoff_team_league_match',
      evidence: expect.objectContaining({
        candidateCount: 2,
        reasons: ['home_name_match', 'away_name_match', 'kickoff_within_15m', 'league_id_match'],
      }),
    }));
  });

  it('handles home/away aliases without treating alternate country names as mismatches', async () => {
    const result = scoreProviderFixtureCandidate(
      source({ homeName: 'South Korea', homeAliases: ['Korea Republic'] }),
      candidate({ homeName: 'Korea Republic' }),
      toFixture,
    );

    expect(result).toMatchObject({
      rejected: false,
      confidence: 'high',
      reasons: expect.arrayContaining(['home_name_match', 'away_name_match']),
    });
  });

  it('rejects wrong teams, reversed sides, and kickoff values outside tolerance', () => {
    expect(scoreProviderFixtureCandidate(source(), candidate({ homeName: 'Mexico' }), toFixture)).toMatchObject({
      rejected: true,
      reasons: ['home_name_mismatch', 'away_name_match'],
    });
    expect(scoreProviderFixtureCandidate(source(), candidate({ awayName: 'Canada' }), toFixture)).toMatchObject({
      rejected: true,
      reasons: ['home_name_match', 'away_name_mismatch'],
    });
    expect(scoreProviderFixtureCandidate(
      source(),
      candidate({ homeName: 'Czech Republic', awayName: 'South Korea' }),
      toFixture,
    )).toMatchObject({
      rejected: true,
      reasons: ['home_away_reversed'],
    });
    expect(scoreProviderFixtureCandidate(
      source(),
      candidate({ kickoffTimestamp: kickoffTs + 4 * 60 * 60 }),
      toFixture,
    )).toMatchObject({
      rejected: true,
      reasons: expect.arrayContaining(['kickoff_outside_tolerance']),
    });
  });

  it('scores ISO kickoff fallback, invalid kickoff strings, and league-name matching branches', () => {
    expect(scoreProviderFixtureCandidate(
      source({ leagueId: null, leagueName: 'World Cup' }),
      candidate({
        kickoffTimestamp: null,
        kickoffAtUtc: kickoffIso,
        leagueId: null,
        leagueName: 'FIFA World Cup',
      }),
      toFixture,
    )).toMatchObject({
      rejected: false,
      score: 95,
      confidence: 'high',
      mappingMethod: 'date_team_match',
      reasons: ['home_name_match', 'away_name_match', 'kickoff_within_15m', 'league_name_match'],
    });

    expect(scoreProviderFixtureCandidate(
      source(),
      candidate({
        kickoffTimestamp: null,
        kickoffAtUtc: 'not-a-date',
      }),
      toFixture,
    )).toMatchObject({
      rejected: false,
      confidence: 'medium',
      warnings: ['kickoff_missing_for_mapping'],
    });

    expect(scoreProviderFixtureCandidate(
      source({ leagueId: null, leagueName: null }),
      candidate({ leagueId: null, leagueName: null }),
      toFixture,
    )).toMatchObject({
      rejected: false,
      score: 85,
      confidence: 'medium',
      warnings: [],
    });
  });

  it('returns not_found without storing evidence when no candidate is safe enough', async () => {
    const result = await resolveProviderFixtureMapping({
      provider: 'sportmonks',
      source: source(),
      candidateToFixture: toFixture,
      fetchCandidatesByDate: vi.fn().mockResolvedValue([
        candidate({ id: 'wrong', homeName: 'Mexico', awayName: 'Canada' }),
        candidate({ id: 'late', kickoffTimestamp: kickoffTs + 5 * 60 * 60 }),
      ]),
    });

    expect(result).toMatchObject({
      providerFixtureId: '',
      fixture: null,
      confidence: 'low',
      mappingMethod: 'date_team_match',
      source: 'not_found',
      canUseForMoneyDecision: false,
      warnings: ['sportmonks_mapping_not_found'],
      evidence: expect.objectContaining({ candidateCount: 2 }),
    });
    expect(mockUpsertProviderFixtureMapping).not.toHaveBeenCalled();
  });

  it('stores medium confidence matches for review but blocks money usage', async () => {
    const result = await resolveProviderFixtureMapping({
      provider: 'sportmonks',
      source: source(),
      candidateToFixture: toFixture,
      fetchCandidatesByDate: vi.fn().mockResolvedValue([
        candidate({
          kickoffAtUtc: null,
          kickoffTimestamp: null,
          leagueId: null,
          leagueName: null,
        }),
      ]),
    });

    expect(result).toMatchObject({
      providerFixtureId: 'sm-987',
      confidence: 'medium',
      mappingMethod: 'date_team_match',
      score: 60,
      canUseForMoneyDecision: false,
      warnings: ['kickoff_missing_for_mapping', 'league_uncertain_for_mapping', 'sportmonks_mapping_low_confidence'],
    });
    expect(mockUpsertProviderFixtureMapping).toHaveBeenCalledWith(expect.objectContaining({
      confidence: 'medium',
      evidence: expect.objectContaining({
        warnings: ['kickoff_missing_for_mapping', 'league_uncertain_for_mapping'],
      }),
    }));
  });

  it('does not search by date when source kickoff is unavailable', async () => {
    const fetchCandidatesByDate = vi.fn();

    const result = await resolveProviderFixtureMapping({
      provider: 'sportmonks',
      source: source({ kickoffAtUtc: null, kickoffTimestamp: null }),
      candidateToFixture: toFixture,
      fetchCandidatesByDate,
    });

    expect(fetchCandidatesByDate).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      source: 'not_found',
      warnings: ['sportmonks_mapping_not_found'],
      evidence: { candidateCount: 0, dateKey: null },
    });
  });

  it('uses timestamp-derived date keys and optional stored-mapping callbacks', async () => {
    const fetchCandidatesByDate = vi.fn().mockResolvedValue([candidate()]);
    const timestampOnly = await resolveProviderFixtureMapping({
      provider: 'sportmonks',
      source: source({ kickoffAtUtc: null }),
      candidateToFixture: toFixture,
      fetchCandidatesByDate,
    });

    expect(fetchCandidatesByDate).toHaveBeenCalledWith('2026-06-11');
    expect(timestampOnly).toMatchObject({
      providerFixtureId: 'sm-987',
      confidence: 'high',
      canUseForMoneyDecision: true,
    });

    mockGetProviderFixtureMapping.mockResolvedValueOnce({
      id: '1',
      match_id: '164327',
      provider: 'sportmonks',
      provider_fixture_id: 'stored-only',
      confidence: 'high',
      mapping_method: 'imported',
      evidence: {},
      first_seen_at: kickoffIso,
      last_seen_at: kickoffIso,
    });
    const storedOnly = await resolveProviderFixtureMapping({
      provider: 'sportmonks',
      source: source(),
      candidateToFixture: toFixture,
    });

    expect(storedOnly).toMatchObject({
      providerFixtureId: 'stored-only',
      fixture: null,
      confidence: 'high',
      mappingMethod: 'imported',
      canUseForMoneyDecision: false,
      warnings: ['sportmonks_mapped_fixture_not_found'],
    });
  });

  it('stores nullable source league names in mapping evidence without breaking a high match', async () => {
    await resolveProviderFixtureMapping({
      provider: 'sportmonks',
      source: source({ leagueName: undefined }),
      candidateToFixture: toFixture,
      fetchCandidatesByDate: vi.fn().mockResolvedValue([candidate()]),
    });

    expect(mockUpsertProviderFixtureMapping).toHaveBeenLastCalledWith(expect.objectContaining({
      evidence: expect.objectContaining({
        apiFixture: expect.objectContaining({ leagueName: null }),
      }),
    }));
  });

  it('exposes pure selection and money-eligibility helpers for fusion phases', () => {
    const best = selectBestProviderFixtureCandidate(source(), [
      candidate({ id: 'bad', kickoffTimestamp: kickoffTs + 2 * 60 * 60, leagueId: 99 }),
      candidate({ id: 'good' }),
    ], toFixture);

    expect(best).toMatchObject({
      fixture: { providerFixtureId: 'good' },
      score: 100,
      confidence: 'high',
    });
    expect(isProviderFixtureMappingMoneyEligible('verified')).toBe(true);
    expect(isProviderFixtureMappingMoneyEligible('high')).toBe(true);
    expect(isProviderFixtureMappingMoneyEligible('medium')).toBe(false);
    expect(isProviderFixtureMappingMoneyEligible('low')).toBe(false);
    expect(isProviderFixtureMappingMoneyEligible('unknown')).toBe(false);
  });
});
