import { fetchAllLeagues, fetchLeagueById, type ApiLeague } from './football-api.js';
import * as leaguesRepo from '../repos/leagues.repo.js';

const INTERNATIONAL_IDS = new Set([
  2, 3, 848, 1, 4, 5, 9, 531, 11, 12, 15, 13, 25, 960,
]);

const TOP_COUNTRIES: Record<string, { tier1: number[]; tier2: number[] }> = {
  England: { tier1: [39], tier2: [40] },
  Spain: { tier1: [140], tier2: [141] },
  Italy: { tier1: [135], tier2: [136] },
  Germany: { tier1: [78], tier2: [79] },
  France: { tier1: [61], tier2: [62] },
  Portugal: { tier1: [94], tier2: [95] },
  Netherlands: { tier1: [88], tier2: [89] },
  Belgium: { tier1: [144], tier2: [145] },
  Turkey: { tier1: [203], tier2: [204] },
  Scotland: { tier1: [179], tier2: [180] },
  Denmark: { tier1: [119], tier2: [120] },
  Switzerland: { tier1: [207], tier2: [208] },
  Austria: { tier1: [218], tier2: [219] },
  Greece: { tier1: [197], tier2: [198] },
  Norway: { tier1: [103], tier2: [104] },
  Sweden: { tier1: [113], tier2: [114] },
  Poland: { tier1: [106], tier2: [107] },
  'Czech-Republic': { tier1: [345], tier2: [346] },
  Croatia: { tier1: [210], tier2: [211] },
  Serbia: { tier1: [286], tier2: [287] },
  Romania: { tier1: [283], tier2: [284] },
  Ukraine: { tier1: [333], tier2: [334] },
  Russia: { tier1: [235], tier2: [236] },
  Brazil: { tier1: [71], tier2: [72] },
  Argentina: { tier1: [128], tier2: [129] },
  Mexico: { tier1: [262], tier2: [263] },
  USA: { tier1: [253], tier2: [] },
  Chile: { tier1: [265], tier2: [] },
  Colombia: { tier1: [239], tier2: [] },
  Uruguay: { tier1: [274], tier2: [] },
  Japan: { tier1: [98], tier2: [99] },
  'South-Korea': { tier1: [292], tier2: [] },
  'Saudi-Arabia': { tier1: [307], tier2: [] },
  China: { tier1: [17], tier2: [] },
  Australia: { tier1: [188], tier2: [] },
};

const LEAGUE_CATALOG_REFRESH_MAX_AGE_MS = 7 * 24 * 60 * 60_000;
const LEAGUE_FETCH_BATCH_SIZE = 6;

export type LeagueCatalogRefreshMode = 'full' | 'active-top' | 'ids';

export interface RefreshLeagueCatalogInput {
  mode?: LeagueCatalogRefreshMode;
  leagueIds?: number[];
  force?: boolean;
}

export interface RefreshLeagueCatalogResult {
  mode: LeagueCatalogRefreshMode;
  candidateLeagues: number;
  attemptedLeagues: number;
  refreshedLeagues: number;
  skippedFreshLeagues: number;
  failedLeagues: number;
  fetched: number;
  upserted: number;
}

export function classifyLeague(item: ApiLeague): { tier: string; autoActive: boolean } {
  const id = item.league.id;
  const country = item.country.name;
  const type = item.league.type;

  if (INTERNATIONAL_IDS.has(id)) return { tier: 'International', autoActive: true };

  const countryData = TOP_COUNTRIES[country];
  if (countryData) {
    if (countryData.tier1.includes(id)) return { tier: '1', autoActive: true };
    if (countryData.tier2.includes(id)) return { tier: '2', autoActive: false };
    if (type === 'Cup') return { tier: 'Cup', autoActive: false };
  }

  if (type === 'League') return { tier: '3', autoActive: false };
  if (type === 'Cup') return { tier: 'Cup', autoActive: false };
  return { tier: 'Other', autoActive: false };
}

function uniquePositiveIds(ids: number[]): number[] {
  return [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
}

function isFresh(providerSyncedAt: string | null | undefined): boolean {
  if (!providerSyncedAt) return false;
  const syncedAtMs = Date.parse(providerSyncedAt);
  if (!Number.isFinite(syncedAtMs)) return false;
  return Date.now() - syncedAtMs < LEAGUE_CATALOG_REFRESH_MAX_AGE_MS;
}

async function fetchLeaguesByIds(leagueIds: number[]): Promise<{ leagues: ApiLeague[]; failedLeagueIds: number[] }> {
  const leagues: ApiLeague[] = [];
  const failedLeagueIds: number[] = [];

  for (let start = 0; start < leagueIds.length; start += LEAGUE_FETCH_BATCH_SIZE) {
    const batch = leagueIds.slice(start, start + LEAGUE_FETCH_BATCH_SIZE);
    const results = await Promise.allSettled(batch.map((leagueId) => fetchLeagueById(leagueId)));

    results.forEach((result, index) => {
      const leagueId = batch[index] ?? 0;
      if (result.status !== 'fulfilled') {
        failedLeagueIds.push(leagueId);
        return;
      }
      if (!result.value) {
        failedLeagueIds.push(leagueId);
        return;
      }
      leagues.push(result.value);
    });
  }

  return { leagues, failedLeagueIds };
}

function toUpsertRows(apiLeagues: ApiLeague[], existingMap: Map<number, leaguesRepo.LeagueRow>): Partial<leaguesRepo.LeagueRow>[] {
  return apiLeagues.map((item) => {
    const { tier, autoActive } = classifyLeague(item);
    const prev = existingMap.get(item.league.id);
    return {
      league_id: item.league.id,
      league_name: item.league.name,
      country: item.country.name,
      tier,
      active: prev ? prev.active : autoActive,
      top_league: prev ? prev.top_league : undefined,
      type: item.league.type,
      logo: item.league.logo,
    };
  });
}

function resolveCandidateLeagueIds(
  mode: LeagueCatalogRefreshMode,
  existingLeagues: leaguesRepo.LeagueRow[],
  requestedLeagueIds: number[],
): number[] {
  if (mode === 'ids') return uniquePositiveIds(requestedLeagueIds);
  if (mode === 'active-top') {
    return uniquePositiveIds(
      existingLeagues
        .filter((league) => league.active || league.top_league)
        .map((league) => league.league_id),
    );
  }
  return [];
}

export async function refreshLeagueCatalog(input: RefreshLeagueCatalogInput = {}): Promise<RefreshLeagueCatalogResult> {
  const mode = input.mode ?? 'active-top';
  const existingLeagues = await leaguesRepo.getAllLeagues();
  const existingMap = new Map(existingLeagues.map((league) => [league.league_id, league]));

  if (mode === 'full') {
    const apiLeagues = await fetchAllLeagues();
    const upserted = await leaguesRepo.upsertLeagues(toUpsertRows(apiLeagues, existingMap), { touchProviderSyncAt: true });
    return {
      mode,
      candidateLeagues: apiLeagues.length,
      attemptedLeagues: apiLeagues.length,
      refreshedLeagues: apiLeagues.length,
      skippedFreshLeagues: 0,
      failedLeagues: 0,
      fetched: apiLeagues.length,
      upserted,
    };
  }

  const candidateLeagueIds = resolveCandidateLeagueIds(mode, existingLeagues, input.leagueIds ?? []);
  const staleLeagueIds = input.force
    ? candidateLeagueIds
    : candidateLeagueIds.filter((leagueId) => !isFresh(existingMap.get(leagueId)?.provider_synced_at));

  if (staleLeagueIds.length === 0) {
    return {
      mode,
      candidateLeagues: candidateLeagueIds.length,
      attemptedLeagues: 0,
      refreshedLeagues: 0,
      skippedFreshLeagues: candidateLeagueIds.length,
      failedLeagues: 0,
      fetched: 0,
      upserted: 0,
    };
  }

  const { leagues: apiLeagues, failedLeagueIds } = await fetchLeaguesByIds(staleLeagueIds);
  const upserted = apiLeagues.length > 0
    ? await leaguesRepo.upsertLeagues(toUpsertRows(apiLeagues, existingMap), { touchProviderSyncAt: true })
    : 0;

  return {
    mode,
    candidateLeagues: candidateLeagueIds.length,
    attemptedLeagues: staleLeagueIds.length,
    refreshedLeagues: apiLeagues.length,
    skippedFreshLeagues: candidateLeagueIds.length - staleLeagueIds.length,
    failedLeagues: failedLeagueIds.length,
    fetched: apiLeagues.length,
    upserted,
  };
}

export async function ensureLeagueCatalogEntry(leagueId: number): Promise<leaguesRepo.LeagueRow | null> {
  const existing = await leaguesRepo.getLeagueById(leagueId);
  if (existing) return existing;

  const result = await refreshLeagueCatalog({ mode: 'ids', leagueIds: [leagueId], force: true });
  if (result.refreshedLeagues === 0) return null;

  return leaguesRepo.getLeagueById(leagueId);
}