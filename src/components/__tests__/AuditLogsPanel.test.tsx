import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/hooks/useAppState', () => ({
  useAppState: () => ({
    state: {
      config: { apiUrl: 'http://localhost:4000' },
    },
  }),
}));

vi.mock('@/lib/services/auth', () => ({
  getToken: () => 'test-token',
}));

const fetchMock = vi.fn();

beforeEach(() => {
  vi.restoreAllMocks();
  fetchMock.mockImplementation((input: string) => {
    if (input.includes('/api/audit-logs/stats')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          totalLogs: 20,
          last24h: 5,
          byCategory: { PIPELINE: 10 },
          failureRate: 5,
        }),
      });
    }

    return Promise.resolve({
      ok: true,
      json: async () => ({
        total: 1,
        rows: [
          {
            id: 1,
            timestamp: '2026-03-24T12:00:00.000Z',
            category: 'PIPELINE',
            action: 'PIPELINE_MATCH_ANALYZED',
            outcome: 'SUCCESS',
            actor: 'auto-pipeline',
            match_id: '100',
            duration_ms: 1234,
            metadata: {
              matchDisplay: 'Arsenal vs Chelsea',
              prematchStrength: 'weak',
              prematchNoisePenalty: 60,
            },
            error: null,
          },
        ],
      }),
    });
  });
  vi.stubGlobal('fetch', fetchMock);
});

const { AuditLogsPanel } = await import('../AuditLogsPanel');

describe('AuditLogsPanel', () => {
  test('sends prematch filters and shows match display from metadata', async () => {
    render(<AuditLogsPanel />);

    await screen.findByText('Arsenal vs Chelsea');

    fireEvent.change(screen.getByDisplayValue('All Prematch Strength'), { target: { value: 'weak' } });
    fireEvent.change(screen.getByDisplayValue('Any Prematch Noise'), { target: { value: '50' } });

    await waitFor(() => {
      const auditCalls = fetchMock.mock.calls
        .map((call) => String(call[0]))
        .filter((url) => url.includes('/api/audit-logs?'));
      expect(auditCalls.some((url) => url.includes('prematchStrength=weak'))).toBe(true);
      expect(auditCalls.some((url) => url.includes('prematchNoiseMin=50'))).toBe(true);
    });

    expect(screen.getByText('Arsenal vs Chelsea')).toBeInTheDocument();
  });
});