import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiFixture } from '../lib/football-api.js';

const getProviderFixtureMapping = vi.fn();
const upsertProviderFixtureMapping = vi.fn();
const fetchSportmonksFixturesByDate = vi.fn();
const fetchSportmonksFixtureById = vi.fn();

vi.mock('../repos/provider-fixture-mappings.repo.js', () => ({
  getProviderFixtureMapping,
  upsertProviderFixtureMapping,
}));

vi.mock('../lib/sportmonks-api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/sportmonks-api.js')>();
  return {
    ...actual,
    fetchSportmonksFixturesByDate,
    fetchSportmonksFixtureById,
  };
});

function apiFixture(overrides: Partial<ApiFixture> = {}): ApiFixture {
  return {
    fixture: {
      id: 100,
      referee: null,
      timezone: 'UTC',
      date: '2025-08-16T11:30:00+00:00',
      timestamp: 1755343800,
      periods: { first: null, second: null },
      venue: { id: null, name: null, city: null },
      status: { long: 'Match Finished', short: 'FT', elapsed: 90 },
    },
    league: { id: 8, name: 'Premier League', country: 'England', logo: '', flag: null, season: 2025, round: '' },
    teams: {
      home: { id: 1, name: 'Aston Villa', logo: '', winner: null },
      away: { id: 2, name: 'Newcastle United', logo: '', winner: null },
    },
    goals: { home: 0, away: 0 },
    score: {},
    ...overrides,
  } as ApiFixture;
}

function sportmonksFixture(score: { home: number; away: number } = { home: 0, away: 0 }) {
  return {
    id: 19427456,
    name: 'Aston Villa vs Newcastle United',
    league_id: 8,
    starting_at_timestamp: 1755343800,
    participants: [
      { id: 10, name: 'Aston Villa', image_path: 'home.png', meta: { location: 'home' } },
      { id: 20, name: 'Newcastle United', image_path: 'away.png', meta: { location: 'away' } },
    ],
    scores: [
      { description: 'CURRENT', score: { participant: 'home', goals: score.home } },
      { description: 'CURRENT', score: { participant: 'away', goals: score.away } },
    ],
    statistics: [
      { participant_id: 10, type: { name: 'Shots on target' }, data: { value: 4 } },
      { participant_id: 20, type: { name: 'Shots on target' }, data: { value: 1 } },
    ],
    events: [
      { participant_id: 10, type_id: 14, minute: 22, player_name: 'Scorer', addition: '1st Goal' },
    ],
  };
}

describe('sportmonks-provider-fallback', () => {
  beforeEach(() => {
    vi.resetModules();
    getProviderFixtureMapping.mockReset().mockResolvedValue(null);
    upsertProviderFixtureMapping.mockReset().mockResolvedValue({});
    fetchSportmonksFixtureById.mockReset();
    fetchSportmonksFixturesByDate.mockReset().mockResolvedValue({
      data: [sportmonksFixture()],
      raw: { data: [] },
      statusCode: 200,
      latencyMs: 10,
      rateLimit: { remaining: 100, resetsInSeconds: 3600, requestedEntity: 'Fixture' },
    });
    process.env['SPORTMONKS_API_TOKEN'] = 'token';
    process.env['SPORTMONKS_ENABLED'] = 'true';
    process.env['SPORTMONKS_ALLOW_STATS_FALLBACK'] = 'true';
    process.env['SPORTMONKS_ALLOW_EVENTS_FALLBACK'] = 'true';
  });

  afterEach(() => {
    delete process.env['SPORTMONKS_API_TOKEN'];
    delete process.env['SPORTMONKS_ENABLED'];
    delete process.env['SPORTMONKS_ALLOW_STATS_FALLBACK'];
    delete process.env['SPORTMONKS_ALLOW_EVENTS_FALLBACK'];
  });

  it('maps by date/team and returns converted stats/events when enabled', async () => {
    const { fetchSportmonksSupplementForFixture } = await import('../lib/sportmonks-provider-fallback.js');
    const result = await fetchSportmonksSupplementForFixture(apiFixture());

    expect(fetchSportmonksFixturesByDate).toHaveBeenCalledWith(
      '2025-08-16',
      expect.objectContaining({ consumer: 'provider-fusion' }),
    );
    expect(upsertProviderFixtureMapping).toHaveBeenCalledWith(expect.objectContaining({
      match_id: '100',
      provider: 'sportmonks',
      provider_fixture_id: '19427456',
      confidence: 'high',
    }));
    expect(result).toMatchObject({
      provider: 'sportmonks',
      providerFixtureId: '19427456',
      used: true,
      mappingConfidence: 'high',
    });
    expect(result?.statistics[0]?.statistics).toContainEqual({ type: 'Shots on Goal', value: 4 });
    expect(result?.events[0]).toMatchObject({ type: 'Goal', detail: '1st Goal' });
  });

  it('returns null when Sportmonks fallback is not runtime-enabled', async () => {
    delete process.env['SPORTMONKS_API_TOKEN'];

    const { fetchSportmonksSupplementForFixture } = await import('../lib/sportmonks-provider-fallback.js');
    const result = await fetchSportmonksSupplementForFixture(apiFixture());

    expect(result).toBeNull();
    expect(fetchSportmonksFixturesByDate).not.toHaveBeenCalled();
  });

  it('returns null when Sportmonks is disabled or no fallback role is allowed', async () => {
    process.env['SPORTMONKS_ENABLED'] = 'false';
    let mod = await import('../lib/sportmonks-provider-fallback.js');
    await expect(mod.fetchSportmonksSupplementForFixture(apiFixture())).resolves.toBeNull();

    vi.resetModules();
    fetchSportmonksFixturesByDate.mockReset();
    process.env['SPORTMONKS_ENABLED'] = 'true';
    process.env['SPORTMONKS_ALLOW_STATS_FALLBACK'] = 'false';
    process.env['SPORTMONKS_ALLOW_EVENTS_FALLBACK'] = 'false';
    mod = await import('../lib/sportmonks-provider-fallback.js');
    await expect(mod.fetchSportmonksSupplementForFixture(apiFixture())).resolves.toBeNull();

    expect(fetchSportmonksFixturesByDate).not.toHaveBeenCalled();
  });

  it('resolves through an existing fixture mapping and respects fallback data flags', async () => {
    process.env['SPORTMONKS_ALLOW_STATS_FALLBACK'] = 'false';
    process.env['SPORTMONKS_ALLOW_EVENTS_FALLBACK'] = 'true';
    getProviderFixtureMapping.mockResolvedValueOnce({
      provider_fixture_id: '19427456',
      mapping_method: 'manual_verified',
      confidence: 'high',
    });
    fetchSportmonksFixtureById.mockResolvedValueOnce({
      data: [sportmonksFixture()],
      raw: { data: [] },
      statusCode: 200,
      latencyMs: 10,
      rateLimit: null,
    });

    const { fetchSportmonksSupplementForFixture } = await import('../lib/sportmonks-provider-fallback.js');
    const result = await fetchSportmonksSupplementForFixture(apiFixture());

    expect(fetchSportmonksFixtureById).toHaveBeenCalledWith(
      '19427456',
      expect.objectContaining({ jobName: 'sportmonks-provider-fallback' }),
    );
    expect(fetchSportmonksFixturesByDate).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      used: true,
      mappingMethod: 'manual_verified',
      mappingConfidence: 'verified',
      statistics: [],
    });
    expect(result?.events).toHaveLength(1);
  });

  it('keeps manually verified mappings production-usable and can return stats without events', async () => {
    process.env['SPORTMONKS_ALLOW_STATS_FALLBACK'] = 'true';
    process.env['SPORTMONKS_ALLOW_EVENTS_FALLBACK'] = 'false';
    getProviderFixtureMapping.mockResolvedValueOnce({
      provider_fixture_id: '19427456',
      mapping_method: 'manual_verified',
      confidence: 'medium',
    });
    fetchSportmonksFixtureById.mockResolvedValueOnce({
      data: [sportmonksFixture()],
      raw: { data: [] },
      statusCode: 200,
      latencyMs: 10,
      rateLimit: null,
    });

    const { fetchSportmonksSupplementForFixture } = await import('../lib/sportmonks-provider-fallback.js');
    const result = await fetchSportmonksSupplementForFixture(apiFixture());

    expect(result).toMatchObject({
      used: true,
      mappingMethod: 'manual_verified',
      mappingConfidence: 'verified',
      events: [],
    });
    expect(result?.statistics).toHaveLength(2);
  });

  it('does not use an invalid stored mapping method for fallback data', async () => {
    getProviderFixtureMapping.mockResolvedValueOnce({
      provider_fixture_id: '19427456',
      mapping_method: 'manual_review',
      confidence: 'experimental',
    });
    fetchSportmonksFixtureById.mockResolvedValueOnce({
      data: [sportmonksFixture()],
      raw: { data: [] },
      statusCode: 200,
      latencyMs: 10,
      rateLimit: null,
    });

    const { fetchSportmonksSupplementForFixture } = await import('../lib/sportmonks-provider-fallback.js');
    const result = await fetchSportmonksSupplementForFixture(apiFixture());

    expect(result).toMatchObject({
      used: false,
      mappingMethod: 'imported',
      mappingConfidence: 'unknown',
      statistics: [],
      events: [],
      warnings: ['sportmonks_mapping_low_confidence'],
      coverageFlags: { mapping_money_eligible: false },
    });
  });

  it('does not use an existing mapping when the mapped Sportmonks fixture payload is empty', async () => {
    getProviderFixtureMapping.mockResolvedValueOnce({
      provider_fixture_id: 'missing-fixture',
      mapping_method: 'manual_verified',
      confidence: 'high',
    });
    fetchSportmonksFixtureById.mockResolvedValueOnce({
      data: [],
      raw: { data: [] },
      statusCode: 200,
      latencyMs: 10,
      rateLimit: null,
    });

    const { fetchSportmonksSupplementForFixture } = await import('../lib/sportmonks-provider-fallback.js');
    const result = await fetchSportmonksSupplementForFixture(apiFixture());

    expect(fetchSportmonksFixturesByDate).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      providerFixtureId: 'missing-fixture',
      used: false,
      mappingMethod: 'manual_verified',
      mappingConfidence: 'verified',
      warnings: ['sportmonks_mapped_fixture_not_found'],
    });
  });

  it('returns an unused supplement when no safe Sportmonks fixture mapping is found', async () => {
    fetchSportmonksFixturesByDate.mockResolvedValueOnce({
      data: [{
        ...sportmonksFixture(),
        id: 999,
        name: 'Different Home vs Different Away',
        participants: [
          { id: 30, name: 'Different Home', meta: { location: 'home' } },
          { id: 40, name: 'Different Away', meta: { location: 'away' } },
        ],
      }],
      raw: { data: [] },
      statusCode: 200,
      latencyMs: 10,
      rateLimit: null,
    });

    const { fetchSportmonksSupplementForFixture } = await import('../lib/sportmonks-provider-fallback.js');
    const result = await fetchSportmonksSupplementForFixture(apiFixture());

    expect(upsertProviderFixtureMapping).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      providerFixtureId: '',
      used: false,
      mappingMethod: 'date_team_match',
      mappingConfidence: 'low',
      warnings: ['sportmonks_mapping_not_found'],
    });
  });

  it('rejects date candidates without usable home and away sides', async () => {
    fetchSportmonksFixturesByDate.mockResolvedValueOnce({
      data: [{
        ...sportmonksFixture(),
        id: 333,
        participants: [],
      }],
      raw: { data: [] },
      statusCode: 200,
      latencyMs: 10,
      rateLimit: null,
    });

    const { fetchSportmonksSupplementForFixture } = await import('../lib/sportmonks-provider-fallback.js');
    const result = await fetchSportmonksSupplementForFixture(apiFixture());

    expect(result).toMatchObject({
      used: false,
      warnings: ['sportmonks_mapping_not_found'],
    });
  });

  it('chooses the strongest candidate when multiple Sportmonks date matches are plausible', async () => {
    fetchSportmonksFixturesByDate.mockResolvedValueOnce({
      data: [
        {
          ...sportmonksFixture(),
          id: 111,
          league_id: 999,
          starting_at_timestamp: 1755400000,
        },
        {
          ...sportmonksFixture(),
          id: 222,
          league_id: 8,
          starting_at_timestamp: 1755343800,
        },
      ],
      raw: { data: [] },
      statusCode: 200,
      latencyMs: 10,
      rateLimit: null,
    });

    const { fetchSportmonksSupplementForFixture } = await import('../lib/sportmonks-provider-fallback.js');
    const result = await fetchSportmonksSupplementForFixture(apiFixture());

    expect(result).toMatchObject({
      providerFixtureId: '222',
      mappingConfidence: 'high',
      used: true,
    });
    expect(upsertProviderFixtureMapping).toHaveBeenCalledWith(expect.objectContaining({
      provider_fixture_id: '222',
      mapping_method: 'kickoff_team_league_match',
      evidence: expect.objectContaining({
        score: 100,
        reasons: ['home_name_match', 'away_name_match', 'kickoff_within_15m', 'league_id_match'],
      }),
    }));
  });

  it('does not use Sportmonks data when provider clocks have a severe minute conflict', async () => {
    fetchSportmonksFixturesByDate.mockResolvedValueOnce({
      data: [{
        ...sportmonksFixture(),
        state_id: '2H',
        length: 51,
      }],
      raw: { data: [] },
      statusCode: 200,
      latencyMs: 10,
      rateLimit: null,
    });

    const { fetchSportmonksSupplementForFixture } = await import('../lib/sportmonks-provider-fallback.js');
    const result = await fetchSportmonksSupplementForFixture(apiFixture({
      fixture: {
        ...apiFixture().fixture,
        status: { long: 'Second Half', short: '2H', elapsed: 65 },
      },
    }));

    expect(result).toMatchObject({
      used: false,
      warnings: ['sportmonks_minute_conflict'],
      coverageFlags: { minute_conflict: true },
    });
  });

  it('does not treat finished fixtures as live minute conflicts', async () => {
    fetchSportmonksFixturesByDate.mockResolvedValueOnce({
      data: [{
        ...sportmonksFixture(),
        state_id: 'FT',
        length: 51,
      }],
      raw: { data: [] },
      statusCode: 200,
      latencyMs: 10,
      rateLimit: null,
    });

    const { fetchSportmonksSupplementForFixture } = await import('../lib/sportmonks-provider-fallback.js');
    const result = await fetchSportmonksSupplementForFixture(apiFixture({
      fixture: {
        ...apiFixture().fixture,
        status: { long: 'Match Finished', short: 'FT', elapsed: 90 },
      },
    }));

    expect(result).toMatchObject({
      used: true,
      warnings: [],
    });
  });

  it('does not use Sportmonks data when scores conflict', async () => {
    fetchSportmonksFixturesByDate.mockResolvedValueOnce({
      data: [sportmonksFixture({ home: 2, away: 0 })],
      raw: { data: [] },
      statusCode: 200,
      latencyMs: 10,
      rateLimit: null,
    });

    const { fetchSportmonksSupplementForFixture } = await import('../lib/sportmonks-provider-fallback.js');
    const result = await fetchSportmonksSupplementForFixture(apiFixture());

    expect(result).toMatchObject({
      used: false,
      warnings: ['sportmonks_score_conflict'],
    });
    expect(result?.statistics).toEqual([]);
    expect(result?.events).toEqual([]);
  });

  it('does not treat missing score values as a provider conflict', async () => {
    fetchSportmonksFixturesByDate.mockResolvedValueOnce({
      data: [{
        ...sportmonksFixture(),
        scores: [],
      }],
      raw: { data: [] },
      statusCode: 200,
      latencyMs: 10,
      rateLimit: null,
    });

    const { fetchSportmonksSupplementForFixture } = await import('../lib/sportmonks-provider-fallback.js');
    const result = await fetchSportmonksSupplementForFixture(apiFixture({
      goals: { home: null, away: null },
    }));

    expect(result).toMatchObject({
      used: true,
      warnings: [],
    });
  });

  it('returns a guarded unused supplement when Sportmonks fetch fails', async () => {
    fetchSportmonksFixturesByDate.mockRejectedValueOnce(new Error('network unavailable'));

    const { fetchSportmonksSupplementForFixture } = await import('../lib/sportmonks-provider-fallback.js');
    const result = await fetchSportmonksSupplementForFixture(apiFixture());

    expect(result).toMatchObject({
      providerFixtureId: '',
      used: false,
      mappingMethod: 'unknown',
      mappingConfidence: 'low',
      warnings: ['sportmonks_fetch_error'],
    });
    expect(result?.coverageFlags).toMatchObject({ fetch_error: 'network unavailable' });
  });

  it('captures non-Error Sportmonks failures without throwing from fallback', async () => {
    fetchSportmonksFixturesByDate.mockRejectedValueOnce('quota unavailable');

    const { fetchSportmonksSupplementForFixture } = await import('../lib/sportmonks-provider-fallback.js');
    const result = await fetchSportmonksSupplementForFixture(apiFixture());

    expect(result).toMatchObject({
      used: false,
      warnings: ['sportmonks_fetch_error'],
    });
    expect(result?.coverageFlags).toMatchObject({ fetch_error: 'quota unavailable' });
  });
});
