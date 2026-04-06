import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildReplayLlmCachePath,
  loadReplayLlmCache,
  saveReplayLlmCache,
} from '../lib/replay-llm-cache.js';

describe('replay llm cache', () => {
  test('builds stable cache paths and round-trips entries', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tfi-replay-cache-'));
    try {
      const path = buildReplayLlmCachePath(
        dir,
        {
          name: '1504751 Machida Zelvia vs FC Tokyo',
          metadata: { recommendationId: 88 } as never,
        },
        'v8-market-balance-followup-f',
        'mock',
      );

      saveReplayLlmCache(path, {
        generatedAt: '2026-04-06T00:00:00.000Z',
        recommendationId: 88,
        scenarioName: '1504751 Machida Zelvia vs FC Tokyo',
        promptVersion: 'v8-market-balance-followup-f',
        oddsMode: 'mock',
        aiText: '{"should_push":true}',
        prompt: 'Prompt',
        selection: 'Under 2.5 Goals @1.90',
      });

      const loaded = loadReplayLlmCache(path);
      expect(loaded?.recommendationId).toBe(88);
      expect(loaded?.promptVersion).toBe('v8-market-balance-followup-f');
      expect(loaded?.aiText).toContain('should_push');
      expect(path).toContain('88__1504751-machida-zelvia-vs-fc-tokyo');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
