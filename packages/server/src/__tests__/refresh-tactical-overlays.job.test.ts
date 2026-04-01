import { beforeEach, describe, expect, test, vi } from 'vitest';

const mockRefreshTopLeagueTacticalOverlays = vi.fn();
const mockReportJobProgress = vi.fn();

vi.mock('../config.js', () => ({
  config: {
    tacticalOverlayRefreshMaxPerRun: 6,
    tacticalOverlayRefreshStaleDays: 30,
  },
}));

vi.mock('../lib/team-tactical-overlay.service.js', () => ({
  refreshTopLeagueTacticalOverlays: mockRefreshTopLeagueTacticalOverlays,
}));

vi.mock('../jobs/job-progress.js', () => ({
  reportJobProgress: mockReportJobProgress,
}));

const { refreshTacticalOverlaysJob } = await import('../jobs/refresh-tactical-overlays.job.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('refreshTacticalOverlaysJob', () => {
  test('reports progress and returns overlay refresh summary', async () => {
    mockRefreshTopLeagueTacticalOverlays.mockResolvedValue({
      candidateTeams: 14,
      selectedTeams: 6,
      refreshedTeams: 4,
      skippedTeams: 1,
      failedTeams: 1,
      skippedReasons: {
        protected_source_mode: 1,
        'Gemini tactical overlay response was empty.': 1,
      },
      results: [],
    });

    const result = await refreshTacticalOverlaysJob();

    expect(mockRefreshTopLeagueTacticalOverlays).toHaveBeenCalledWith({ maxPerRun: 6, staleDays: 30 });
    expect(mockReportJobProgress).toHaveBeenCalledWith(
      'refresh-tactical-overlays',
      'planning',
      expect.stringContaining('approved competition team profiles'),
      10,
    );
    expect(mockReportJobProgress).toHaveBeenCalledWith(
      'refresh-tactical-overlays',
      'complete',
      expect.stringContaining('refreshed=4'),
      100,
    );
    expect(result).toEqual({
      maxPerRun: 6,
      staleDays: 30,
      candidateTeams: 14,
      selectedTeams: 6,
      refreshedTeams: 4,
      skippedTeams: 1,
      failedTeams: 1,
      skippedReasons: {
        protected_source_mode: 1,
        'Gemini tactical overlay response was empty.': 1,
      },
    });
  });
});
