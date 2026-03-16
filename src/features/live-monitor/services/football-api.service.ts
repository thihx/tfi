// ============================================================
// Football API Service
// Equivalent to: "Fetch Live Data" + "Fetch Live Odds"
// ============================================================

import type { AppConfig } from '@/types';
import type {
  FixtureBatch,
  FootballApiFixture,
  FootballApiOddsResponse,
} from '../types';
import { fetchLiveFixtures, fetchLiveOdds } from './proxy.service';

/**
 * Fetch live fixture data for a batch of match IDs.
 * Mirrors the "Fetch Live Data" HTTP request node.
 */
export async function fetchFixturesBatch(
  config: AppConfig,
  batch: FixtureBatch,
): Promise<FootballApiFixture[]> {
  return fetchLiveFixtures(config, batch.match_ids);
}

/**
 * Fetch live fixture data for all batches.
 */
export async function fetchAllFixtures(
  config: AppConfig,
  batches: FixtureBatch[],
): Promise<FootballApiFixture[]> {
  const allFixtures: FootballApiFixture[] = [];
  for (const batch of batches) {
    const fixtures = await fetchFixturesBatch(config, batch);
    allFixtures.push(...fixtures);
  }
  return allFixtures;
}

/**
 * Fetch live odds for a single fixture.
 * Mirrors the "Fetch Live Odds" HTTP request node.
 */
export async function fetchFixtureOdds(
  config: AppConfig,
  matchId: string,
): Promise<FootballApiOddsResponse> {
  return fetchLiveOdds(config, matchId);
}
