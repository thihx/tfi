import { describe, expect, it, vi, beforeEach } from 'vitest';

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    thesisWatchEnabled: true,
    linePatienceEnabled: true,
    thesisWatchTtlMinutes: 45,
  },
}));

vi.mock('../config.js', () => ({
  config: mockConfig,
}));

const { mockUpsertPendingThesisWatch } = vi.hoisted(() => ({
  mockUpsertPendingThesisWatch: vi.fn(),
}));

vi.mock('../repos/thesis-watch.repo.js', () => ({
  upsertPendingThesisWatch: mockUpsertPendingThesisWatch,
}));

import {
  isThesisWatchPipelineActive,
  registerThesisWatchFromLlpBlock,
} from '../lib/thesis-watch.service.js';

describe('isThesisWatchPipelineActive', () => {
  beforeEach(() => {
    mockConfig.thesisWatchEnabled = true;
    mockConfig.linePatienceEnabled = true;
    mockConfig.thesisWatchTtlMinutes = 45;
    mockUpsertPendingThesisWatch.mockReset();
  });

  it('is inactive in shadow mode', () => {
    expect(isThesisWatchPipelineActive({ shadowMode: true })).toBe(false);
  });

  it('is inactive in advisory-only mode', () => {
    expect(isThesisWatchPipelineActive({ advisoryOnly: true })).toBe(false);
  });

  it('is active for normal live pipeline when enabled', () => {
    expect(isThesisWatchPipelineActive({ shadowMode: false, advisoryOnly: false })).toBe(true);
  });

  it('is inactive when thesis watch env disabled', () => {
    mockConfig.thesisWatchEnabled = false;
    expect(isThesisWatchPipelineActive({})).toBe(false);
  });

  it('persists the initial live snapshot for a deferred LLP thesis', async () => {
    await registerThesisWatchFromLlpBlock({
      matchId: 'fixture-1',
      minute: 55,
      score: '1-0',
      status: '2H',
      evidenceMode: 'full_live_data',
      warnings: ['LLP_BLOCK_OVER_AGGRESSIVE_LINE'],
      selection: 'Over 2.5 Goals',
      betMarket: 'over_2.5',
      confidence: 8,
      valuePercent: 6,
      stakePercent: 2,
      riskLevel: 'MEDIUM',
      reasoningEn: 'Tempo is strong but wait for a safer rung.',
      reasoningVi: '',
      oddsCanonical: {
        ou: { line: 2.5, over: 2.1, under: 1.7 },
        ou_adjacent: { line: 1, over: 1.84, under: 1.96 },
      },
      statsCompact: { shots_on_target: { home: '4', away: '3' } },
      eventsCompact: [{ minute: 52, type: 'Shot', detail: 'On Target' }],
    });

    expect(mockUpsertPendingThesisWatch).toHaveBeenCalledWith(
      'fixture-1',
      expect.objectContaining({
        watchKey: 'goals_over_line::over_2.5',
        initialSnapshot: expect.objectContaining({
          matchId: 'fixture-1',
          minute: 55,
          score: '1-0',
          status: '2H',
          evidenceMode: 'full_live_data',
          selection: 'Over 2.5 Goals',
          betMarket: 'over_2.5',
          warnings: ['LLP_BLOCK_OVER_AGGRESSIVE_LINE'],
          confidence: 8,
          valuePercent: 6,
          stakePercent: 2,
          riskLevel: 'MEDIUM',
          oddsCanonical: expect.objectContaining({
            ou: expect.objectContaining({ line: 2.5 }),
          }),
          statsCompact: expect.objectContaining({
            shots_on_target: expect.objectContaining({ home: '4', away: '3' }),
          }),
          eventsCompact: [expect.objectContaining({ minute: 52 })],
        }),
      }),
      expect.any(Date),
    );
  });
});
