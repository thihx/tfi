// ============================================================
// Job: Update Watchlist Predictions
// Mirrors: Apps Script updateWatchlistPredictionsJob()
//
// 1. Read matches → build match_id → status map
// 2. Read watchlist entries
// 3. For each NS (Not Started) match, fetch prediction from API
// 4. Update watchlist prediction field
// ============================================================

import { fetchPrediction, buildSlimPrediction } from '../lib/football-api.js';
import * as matchRepo from '../repos/matches.repo.js';
import * as watchlistRepo from '../repos/watchlist.repo.js';
import { reportJobProgress } from './job-progress.js';

const API_DELAY_MS = 200; // Rate-limit protection
let forceNext = false;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasStoredPrediction(prediction: unknown): boolean {
  if (!prediction || typeof prediction !== 'object' || Array.isArray(prediction)) return false;
  return Object.keys(prediction as Record<string, unknown>).length > 0;
}

/** Force next run to refresh predictions even when watchlist rows already have cached data. */
export function setForcePredictionRefresh(): void {
  forceNext = true;
}

export async function updatePredictionsJob(): Promise<{ checked: number; updated: number }> {
  const JOB = 'update-predictions';

  // 1. Build match_id → status map
  await reportJobProgress(JOB, 'load', 'Loading matches and watchlist...', 5);
  const allMatches = await matchRepo.getAllMatches();
  const statusMap = new Map<string, string>();
  for (const m of allMatches) {
    statusMap.set(m.match_id, m.status.toUpperCase());
  }

  // 2. Get all watchlist entries
  const watchlist = await watchlistRepo.getAllWatchlist();
  if (watchlist.length === 0) {
    console.log('[updatePredictionsJob] Watchlist empty, skip.');
    return { checked: 0, updated: 0 };
  }

  const force = forceNext;
  forceNext = false;
  if (force) console.log('[updatePredictionsJob] Force mode - refreshing cached predictions');

  // Collect NS entries to process
  const nsEntries = watchlist.filter((entry) => {
    const matchStatus = statusMap.get(entry.match_id)?.toUpperCase() ?? '';
    if (matchStatus !== 'NS') return false;
    return force || !hasStoredPrediction(entry.prediction);
  });

  let checked = 0;
  let updated = 0;

  // 3. Process each NS match
  for (const entry of nsEntries) {
    checked++;
    await reportJobProgress(
      JOB, 'predict',
      `Fetching prediction ${checked}/${nsEntries.length}: ${entry.home_team} vs ${entry.away_team}`,
      5 + (checked / nsEntries.length) * 90,
    );

    try {
      const prediction = await fetchPrediction(entry.match_id);

      if (prediction) {
        const slim = buildSlimPrediction(prediction);
        await watchlistRepo.updateWatchlistEntry(entry.match_id, { prediction: slim as unknown });
        updated++;
      } else {
        // No prediction available → clear it
        await watchlistRepo.updateWatchlistEntry(entry.match_id, { prediction: null as unknown });
      }
    } catch (err) {
      console.error(`[updatePredictionsJob] Error for match ${entry.match_id}:`, err);
    }

    await sleep(API_DELAY_MS);
  }

  console.log(`[updatePredictionsJob] ✅ Checked ${checked} NS matches, updated ${updated} predictions`);
  return { checked, updated };
}
