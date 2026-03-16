// ============================================================
// Job: Check Live Matches & Trigger N8N
// Mirrors: Apps Script checkLiveMatchesAndTriggerN8n()
//
// 1. Read active watchlist match IDs
// 2. Cross-reference with matches table for live status
// 3. Send batches to n8n webhook
// ============================================================

import { config } from '../config.js';
import * as watchlistRepo from '../repos/watchlist.repo.js';
import * as matchRepo from '../repos/matches.repo.js';

const BATCH_SIZE = 5;

export async function checkLiveTriggerJob(): Promise<{ liveCount: number; batchesSent: number }> {
  if (!config.n8nWebhookUrl) {
    console.log('[checkLiveTriggerJob] N8N_WEBHOOK_URL not configured, skip.');
    return { liveCount: 0, batchesSent: 0 };
  }

  // 1. Get active watchlist match IDs
  const activeWatchlist = await watchlistRepo.getActiveWatchlist();
  if (activeWatchlist.length === 0) {
    return { liveCount: 0, batchesSent: 0 };
  }
  const activeMatchIds = activeWatchlist.map((w) => w.match_id);

  // 2. Get matches and find live ones
  const matches = await matchRepo.getMatchesByIds(activeMatchIds);
  const statusMap = new Map(matches.map((m) => [m.match_id, m.status]));

  const liveMatchIds = activeMatchIds.filter((id) => {
    const status = statusMap.get(id);
    return status && config.liveStatuses.includes(status);
  });

  if (liveMatchIds.length === 0) {
    return { liveCount: 0, batchesSent: 0 };
  }

  // 3. Split into batches and send to n8n
  const batches: string[][] = [];
  for (let i = 0; i < liveMatchIds.length; i += BATCH_SIZE) {
    batches.push(liveMatchIds.slice(i, i + BATCH_SIZE));
  }

  let batchesSent = 0;
  for (let i = 0; i < batches.length; i++) {
    const payload = {
      source: 'tfi-server',
      triggeredAt: new Date().toISOString(),
      liveMatchIds: batches[i],
      batchInfo: {
        current: i + 1,
        total: batches.length,
        totalMatches: liveMatchIds.length,
      },
    };

    try {
      const res = await fetch(config.n8nWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      console.log(`[checkLiveTriggerJob] Batch ${i + 1}/${batches.length} → n8n ${res.status}`);
      batchesSent++;
    } catch (err) {
      console.error(`[checkLiveTriggerJob] Batch ${i + 1}/${batches.length} error:`, err);
    }
  }

  console.log(`[checkLiveTriggerJob] ✅ ${liveMatchIds.length} live matches, ${batchesSent} batches sent`);
  return { liveCount: liveMatchIds.length, batchesSent };
}
