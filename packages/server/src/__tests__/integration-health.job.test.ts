// ============================================================
// Unit tests — integration-health.job.ts
// Focus: status change detection, cooldown, alert logic
// ============================================================

import { describe, test, expect, vi, beforeEach } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────

const mockGet  = vi.fn();
const mockSet  = vi.fn();

vi.mock('../lib/redis.js', () => ({
  getRedisClient: () => ({ get: mockGet, set: mockSet }),
}));

vi.mock('../jobs/job-progress.js', () => ({
  reportJobProgress: vi.fn(),
}));

vi.mock('../config.js', () => ({
  config: {
    telegramBotToken:       'bot:TOKEN',
  },
}));

vi.mock('../lib/telegram-runtime.js', () => ({
  loadOperationalTelegramSettings: vi.fn().mockResolvedValue({
    chatId: '987654321',
    enabled: true,
  }),
}));

vi.mock('../lib/audit.js', () => ({ audit: vi.fn() }));

const mockSendTelegram = vi.fn();
vi.mock('../lib/telegram.js', () => ({
  sendTelegramMessage: (...args: unknown[]) => mockSendTelegram(...args),
}));

const mockCheckAll = vi.fn();
vi.mock('../lib/integration-health.js', () => ({
  checkAllIntegrations: (...args: unknown[]) => mockCheckAll(...args),
}));

// ── Helpers ───────────────────────────────────────────────────

import type { IntegrationProbeResult } from '../lib/integration-health.js';

function makeService(
  id: string,
  status: IntegrationProbeResult['status'],
  latencyMs = 20,
  message?: string,
): IntegrationProbeResult {
  return {
    id, status, latencyMs,
    label: `Service ${id}`,
    description: `Desc for ${id}`,
    checkedAt: new Date().toISOString(),
    message,
  };
}

function makeSnapshot(services: IntegrationProbeResult[]) {
  return {
    overall: 'HEALTHY' as const,
    checkedAt: new Date().toISOString(),
    durationMs: 150,
    services,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockResolvedValue(null);   // no previous state by default
  mockSet.mockResolvedValue('OK');
  mockSendTelegram.mockResolvedValue(undefined);
});

// ── Tests ─────────────────────────────────────────────────────

describe('integrationHealthJob — first run (no previous state)', () => {
  test('HEALTHY on first run → no alert sent', async () => {
    mockCheckAll.mockResolvedValue(makeSnapshot([
      makeService('postgresql', 'HEALTHY'),
    ]));

    const { integrationHealthJob } = await import('../jobs/integration-health.job.js');
    const result = await integrationHealthJob();

    expect(result.alerted).toBe(0);
    expect(mockSendTelegram).not.toHaveBeenCalled();
  });

  test('DOWN on first run → alert sent', async () => {
    mockCheckAll.mockResolvedValue(makeSnapshot([
      makeService('gemini', 'DOWN', 0, 'Timed out after 8000ms'),
    ]));

    const { integrationHealthJob } = await import('../jobs/integration-health.job.js');
    const result = await integrationHealthJob();

    expect(result.alerted).toBe(1);
    expect(mockSendTelegram).toHaveBeenCalledOnce();
    const [chatId, text] = mockSendTelegram.mock.calls[0];
    expect(chatId).toBe('987654321');
    expect(text).toContain('DOWN');
    expect(text).toContain('Service gemini');
  });

  test('DEGRADED on first run → alert sent', async () => {
    mockCheckAll.mockResolvedValue(makeSnapshot([
      makeService('football-api', 'DEGRADED', 3100, 'HTTP 429'),
    ]));

    const { integrationHealthJob } = await import('../jobs/integration-health.job.js');
    const result = await integrationHealthJob();

    expect(result.alerted).toBe(1);
    expect(mockSendTelegram).toHaveBeenCalledOnce();
    expect(mockSendTelegram.mock.calls[0][1]).toContain('DEGRADED');
  });

  test('NOT_CONFIGURED → no alert, not counted in checked', async () => {
    mockCheckAll.mockResolvedValue(makeSnapshot([
      makeService('redis', 'NOT_CONFIGURED'),
    ]));

    const { integrationHealthJob } = await import('../jobs/integration-health.job.js');
    const result = await integrationHealthJob();

    expect(result.alerted).toBe(0);
    expect(result.checked).toBe(0);
    expect(mockSendTelegram).not.toHaveBeenCalled();
  });
});

describe('integrationHealthJob — status transitions', () => {
  test('HEALTHY → DOWN: alert sent, transition recorded', async () => {
    mockGet.mockResolvedValue(JSON.stringify({
      status: 'HEALTHY',
      updatedAt: new Date().toISOString(),
    }));
    mockCheckAll.mockResolvedValue(makeSnapshot([
      makeService('postgresql', 'DOWN', 0, 'Connection refused'),
    ]));

    const { integrationHealthJob } = await import('../jobs/integration-health.job.js');
    const result = await integrationHealthJob();

    expect(result.alerted).toBe(1);
    expect(result.transitioned).toContain('postgresql: HEALTHY → DOWN');
    expect(mockSendTelegram).toHaveBeenCalledOnce();
    expect(mockSendTelegram.mock.calls[0][1]).toContain('DOWN');
  });

  test('DOWN → HEALTHY: recovery alert sent', async () => {
    mockGet.mockResolvedValue(JSON.stringify({
      status: 'DOWN',
      updatedAt: new Date().toISOString(),
      alertedAt: new Date(Date.now() - 10_000).toISOString(), // recently alerted
    }));
    mockCheckAll.mockResolvedValue(makeSnapshot([
      makeService('postgresql', 'HEALTHY', 12),
    ]));

    const { integrationHealthJob } = await import('../jobs/integration-health.job.js');
    const result = await integrationHealthJob();

    expect(result.alerted).toBe(1);
    expect(result.transitioned).toContain('postgresql: DOWN → HEALTHY');
    const text = mockSendTelegram.mock.calls[0][1];
    expect(text).toContain('✅');
    expect(text).toContain('Khôi phục');
  });

  test('DEGRADED → HEALTHY: recovery alert sent', async () => {
    mockGet.mockResolvedValue(JSON.stringify({
      status: 'DEGRADED',
      updatedAt: new Date().toISOString(),
    }));
    mockCheckAll.mockResolvedValue(makeSnapshot([
      makeService('telegram', 'HEALTHY', 55),
    ]));

    const { integrationHealthJob } = await import('../jobs/integration-health.job.js');
    const result = await integrationHealthJob();

    expect(result.alerted).toBe(1);
    const text = mockSendTelegram.mock.calls[0][1];
    expect(text).toContain('✅');
  });

  test('no status change → no alert', async () => {
    mockGet.mockResolvedValue(JSON.stringify({
      status: 'HEALTHY',
      updatedAt: new Date().toISOString(),
    }));
    mockCheckAll.mockResolvedValue(makeSnapshot([
      makeService('redis', 'HEALTHY', 8),
    ]));

    const { integrationHealthJob } = await import('../jobs/integration-health.job.js');
    const result = await integrationHealthJob();

    expect(result.alerted).toBe(0);
    expect(mockSendTelegram).not.toHaveBeenCalled();
  });
});

describe('integrationHealthJob — cooldown logic', () => {
  test('stays DOWN within cooldown → no repeat alert', async () => {
    mockGet.mockResolvedValue(JSON.stringify({
      status: 'DOWN',
      updatedAt: new Date().toISOString(),
      alertedAt: new Date(Date.now() - 30 * 60_000).toISOString(), // 30 min ago — within 4h
    }));
    mockCheckAll.mockResolvedValue(makeSnapshot([
      makeService('gemini', 'DOWN'),
    ]));

    const { integrationHealthJob } = await import('../jobs/integration-health.job.js');
    const result = await integrationHealthJob();

    expect(result.alerted).toBe(0);
    expect(mockSendTelegram).not.toHaveBeenCalled();
  });

  test('stays DOWN after 4h cooldown → re-alert', async () => {
    mockGet.mockResolvedValue(JSON.stringify({
      status: 'DOWN',
      updatedAt: new Date().toISOString(),
      alertedAt: new Date(Date.now() - 5 * 60 * 60_000).toISOString(), // 5 hours ago
    }));
    mockCheckAll.mockResolvedValue(makeSnapshot([
      makeService('gemini', 'DOWN'),
    ]));

    const { integrationHealthJob } = await import('../jobs/integration-health.job.js');
    const result = await integrationHealthJob();

    expect(result.alerted).toBe(1);
    expect(mockSendTelegram).toHaveBeenCalledOnce();
  });
});

describe('integrationHealthJob — multiple services', () => {
  test('multiple services: only changed/alertable ones trigger Telegram', async () => {
    // postgresql: was HEALTHY, still HEALTHY → no alert
    // redis: was HEALTHY, now DOWN → alert
    // gemini: new (no state), HEALTHY → no alert
    mockGet.mockImplementation((key: string) => {
      if (key.includes('postgresql')) {
        return Promise.resolve(JSON.stringify({ status: 'HEALTHY', updatedAt: new Date().toISOString() }));
      }
      if (key.includes('redis')) {
        return Promise.resolve(JSON.stringify({ status: 'HEALTHY', updatedAt: new Date().toISOString() }));
      }
      return Promise.resolve(null);
    });

    mockCheckAll.mockResolvedValue(makeSnapshot([
      makeService('postgresql', 'HEALTHY', 15),
      makeService('redis', 'DOWN', 0, 'ECONNREFUSED'),
      makeService('gemini', 'HEALTHY', 800),
    ]));

    const { integrationHealthJob } = await import('../jobs/integration-health.job.js');
    const result = await integrationHealthJob();

    expect(result.alerted).toBe(1);
    expect(result.checked).toBe(3);
    expect(result.transitioned).toContain('redis: HEALTHY → DOWN');
    expect(mockSendTelegram).toHaveBeenCalledOnce();
    expect(mockSendTelegram.mock.calls[0][1]).toContain('redis');
  });

  test('result.checked excludes NOT_CONFIGURED services', async () => {
    mockCheckAll.mockResolvedValue(makeSnapshot([
      makeService('postgresql', 'HEALTHY'),
      makeService('redis', 'NOT_CONFIGURED'),
      makeService('odds-api', 'NOT_CONFIGURED'),
    ]));

    const { integrationHealthJob } = await import('../jobs/integration-health.job.js');
    const result = await integrationHealthJob();

    expect(result.checked).toBe(1); // only postgresql counted
  });
});

describe('integrationHealthJob — Telegram failure resilience', () => {
  test('Telegram send failure does not throw — job completes normally', async () => {
    mockCheckAll.mockResolvedValue(makeSnapshot([
      makeService('gemini', 'DOWN'),
    ]));
    mockSendTelegram.mockRejectedValue(new Error('Telegram API 400: Bad Request'));

    const { integrationHealthJob } = await import('../jobs/integration-health.job.js');
    // Should not throw
    await expect(integrationHealthJob()).resolves.toBeDefined();
  });
});

describe('integrationHealthJob — state persistence', () => {
  test('saves new state to Redis after each check', async () => {
    mockCheckAll.mockResolvedValue(makeSnapshot([
      makeService('postgresql', 'HEALTHY'),
    ]));

    const { integrationHealthJob } = await import('../jobs/integration-health.job.js');
    await integrationHealthJob();

    expect(mockSet).toHaveBeenCalledOnce();
    const [key, value] = mockSet.mock.calls[0];
    expect(key).toContain('postgresql');
    const saved = JSON.parse(value);
    expect(saved.status).toBe('HEALTHY');
    expect(saved.updatedAt).toBeTruthy();
  });

  test('saves alertedAt when alert is sent', async () => {
    mockCheckAll.mockResolvedValue(makeSnapshot([
      makeService('football-api', 'DOWN'),
    ]));

    const { integrationHealthJob } = await import('../jobs/integration-health.job.js');
    await integrationHealthJob();

    const [, value] = mockSet.mock.calls[0];
    const saved = JSON.parse(value);
    expect(saved.alertedAt).toBeTruthy();
  });

  test('does not update alertedAt when no alert is sent', async () => {
    const prevAlertedAt = new Date(Date.now() - 60_000).toISOString();
    mockGet.mockResolvedValue(JSON.stringify({
      status: 'HEALTHY',
      updatedAt: new Date().toISOString(),
      alertedAt: prevAlertedAt,
    }));
    mockCheckAll.mockResolvedValue(makeSnapshot([
      makeService('postgresql', 'HEALTHY'), // no change
    ]));

    const { integrationHealthJob } = await import('../jobs/integration-health.job.js');
    await integrationHealthJob();

    const [, value] = mockSet.mock.calls[0];
    const saved = JSON.parse(value);
    expect(saved.alertedAt).toBe(prevAlertedAt); // unchanged
  });
});
