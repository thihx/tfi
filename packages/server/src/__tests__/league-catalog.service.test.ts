import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../repos/leagues.repo.js', () => ({
  getAllLeagues: vi.fn(),
  getLeagueById: vi.fn(),
  upsertLeagues: vi.fn(),
}));

vi.mock('../lib/reference-data-provider.js', () => ({
  fetchAllLeaguesFromReferenceProvider: vi.fn(),
  fetchLeagueByIdFromReferenceProvider: vi.fn(),
}));

import * as leaguesRepo from '../repos/leagues.repo.js';
import * as referenceProvider from '../lib/reference-data-provider.js';
import { ensureLeagueCatalogEntry, refreshLeagueCatalog } from '../lib/league-catalog.service.js';

describe('league-catalog.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('refreshes only stale active/top leagues for reference-data sync', async () => {
    vi.mocked(leaguesRepo.getAllLeagues).mockResolvedValue([
      {
        league_id: 39,
        league_name: 'Premier League',
        country: 'England',
        tier: '1',
        active: true,
        top_league: true,
        type: 'League',
        logo: '',
        last_updated: '2026-03-24T00:00:00Z',
        provider_synced_at: '2026-03-01T00:00:00Z',
      },
      {
        league_id: 140,
        league_name: 'La Liga',
        country: 'Spain',
        tier: '1',
        active: true,
        top_league: false,
        type: 'League',
        logo: '',
        last_updated: '2026-03-24T00:00:00Z',
        provider_synced_at: new Date().toISOString(),
      },
    ]);
    vi.mocked(referenceProvider.fetchLeagueByIdFromReferenceProvider).mockResolvedValue({
      league: { id: 39, name: 'Premier League', type: 'League', logo: '' },
      country: { name: 'England', code: 'GB', flag: null },
      seasons: [],
    });
    vi.mocked(leaguesRepo.upsertLeagues).mockResolvedValue(1);

    const result = await refreshLeagueCatalog({ mode: 'active-top', force: false });

    expect(result).toMatchObject({
      candidateLeagues: 2,
      attemptedLeagues: 1,
      refreshedLeagues: 1,
      skippedFreshLeagues: 1,
      failedLeagues: 0,
      upserted: 1,
    });
    expect(referenceProvider.fetchLeagueByIdFromReferenceProvider).toHaveBeenCalledTimes(1);
    expect(referenceProvider.fetchLeagueByIdFromReferenceProvider).toHaveBeenCalledWith(39, { force: true });
    expect(leaguesRepo.upsertLeagues).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ league_id: 39, active: true, top_league: true }),
      ]),
      { touchProviderSyncAt: true },
    );
  });

  test('backfills a missing league on demand', async () => {
    vi.mocked(leaguesRepo.getLeagueById)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        league_id: 999,
        league_name: 'Test League',
        country: 'Nowhere',
        tier: '3',
        active: false,
        top_league: false,
        type: 'League',
        logo: '',
        last_updated: '2026-03-24T00:00:00Z',
        provider_synced_at: '2026-03-24T00:00:00Z',
      });
    vi.mocked(leaguesRepo.getAllLeagues).mockResolvedValue([]);
    vi.mocked(referenceProvider.fetchLeagueByIdFromReferenceProvider).mockResolvedValue({
      league: { id: 999, name: 'Test League', type: 'League', logo: '' },
      country: { name: 'Nowhere', code: null, flag: null },
      seasons: [],
    });
    vi.mocked(leaguesRepo.upsertLeagues).mockResolvedValue(1);

    const league = await ensureLeagueCatalogEntry(999);

    expect(league?.league_id).toBe(999);
    expect(referenceProvider.fetchLeagueByIdFromReferenceProvider).toHaveBeenCalledWith(999, { force: true });
  });
});
