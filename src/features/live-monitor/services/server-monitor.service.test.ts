import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { AppConfig } from '@/types';
import {
  analyzeMatchWithServerPipeline,
  fetchLiveMonitorStatus,
  fetchLiveMonitorWhyNoRecommendation,
  getParsedAiResult,
} from './server-monitor.service';

const appConfig = { apiUrl: 'http://localhost:4000' } as AppConfig;

describe('server-monitor.service', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test('fetchLiveMonitorStatus returns dashboard payload', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        job: {
          name: 'check-live-trigger',
          intervalMs: 60_000,
          enabled: true,
          running: false,
          lastRun: null,
          lastError: null,
          runCount: 0,
        },
        progress: null,
        monitoring: {
          activeWatchCount: 0,
          liveWatchCount: 0,
          candidateCount: 0,
          targets: [],
        },
        summary: null,
        results: [],
      }),
    }));

    const result = await fetchLiveMonitorStatus(appConfig);

    expect(result.job.name).toBe('check-live-trigger');
    expect(result.results).toEqual([]);
  });

  test('analyzeMatchWithServerPipeline returns the structured server result', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        result: {
          matchId: '123',
          matchDisplay: 'Arsenal vs Chelsea',
          homeName: 'Arsenal',
          awayName: 'Chelsea',
          league: 'Premier League',
          minute: 64,
          score: '1-1',
          status: '2H',
          success: true,
          decisionKind: 'ai_push',
          shouldPush: true,
          selection: 'Over 2.5',
          confidence: 7,
          saved: true,
          notified: false,
          debug: {
            parsed: {
              bet_market: 'over_2.5',
              reasoning_vi: 'Đủ điều kiện',
            },
          },
        },
      }),
    }));

    const result = await analyzeMatchWithServerPipeline(appConfig, '123');

    expect(result.selection).toBe('Over 2.5');
    expect(result.matchDisplay).toBe('Arsenal vs Chelsea');
    expect(getParsedAiResult(result)?.bet_market).toBe('over_2.5');
  });

  test('fetchLiveMonitorWhyNoRecommendation returns operator output taxonomy', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        generatedAt: '2026-06-09T00:00:00.000Z',
        lookbackHours: 24,
        officialPromptVersion: 'v10-hybrid-legacy-g',
        totals: {
          matchAnalyzed: 3,
          moneyRecommendations: 1,
          statsOnlySignals: 1,
          watchInsights: 0,
          shadowCandidates: 1,
          noActions: 1,
          llmCalled: 2,
          llmSkipped: 1,
        },
        outputKindBreakdown: [],
        reasonGroupBreakdown: [{ group: 'policy', count: 1, latestAt: '2026-06-09T00:00:00.000Z' }],
        reasonBuckets: [{ key: 'policy_blocked', group: 'policy', outputKind: 'shadow_candidate', evidenceMode: 'full_live_data', count: 1, latestAt: null }],
        recentDrilldown: [],
      }),
    }));

    const result = await fetchLiveMonitorWhyNoRecommendation(appConfig, { lookbackHours: 24, maxSamples: 6 });

    expect(result.reasonBuckets[0]).toEqual(expect.objectContaining({ key: 'policy_blocked', group: 'policy' }));
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:4000/api/live-monitor/why-no-recommendation?lookbackHours=24&maxSamples=6',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  test('getParsedAiResult returns null when debug payload is missing', () => {
    expect(getParsedAiResult({
      matchId: '1',
      success: true,
      decisionKind: 'no_bet',
      shouldPush: false,
      selection: '',
      confidence: 0,
      saved: false,
      notified: false,
    })).toBeNull();
  });
});
