import { beforeEach, describe, expect, test, vi } from 'vitest';

const mockQuery = vi.fn();
const mockConfig = {
  criticalFallbackSmsEnabled: false,
  criticalFallbackVoiceCallEnabled: false,
  criticalFallbackSmsMaxPerUserDay: 10,
  criticalFallbackVoiceCallMaxPerUserDay: 3,
  criticalFallbackSmsMaxGlobalDay: 100,
  criticalFallbackVoiceCallMaxGlobalDay: 20,
};

vi.mock('../config.js', () => ({
  config: mockConfig,
}));

vi.mock('../db/pool.js', () => ({
  query: mockQuery,
}));

const { evaluateCriticalFallbackPolicy } = await import('../lib/critical-fallback-policy.js');

beforeEach(() => {
  mockQuery.mockReset();
  mockConfig.criticalFallbackSmsEnabled = false;
  mockConfig.criticalFallbackVoiceCallEnabled = false;
  mockConfig.criticalFallbackSmsMaxPerUserDay = 10;
  mockConfig.criticalFallbackVoiceCallMaxPerUserDay = 3;
  mockConfig.criticalFallbackSmsMaxGlobalDay = 100;
  mockConfig.criticalFallbackVoiceCallMaxGlobalDay = 20;
});

describe('critical fallback policy', () => {
  test('blocks SMS by default unless explicitly enabled', async () => {
    const result = await evaluateCriticalFallbackPolicy('sms', '00000000-0000-0000-0000-000000000001', '+15551234567');

    expect(result).toEqual({
      allowed: false,
      reason: 'sms critical fallback is not enabled',
    });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('requires E.164 phone numbers', async () => {
    mockConfig.criticalFallbackSmsEnabled = true;

    const result = await evaluateCriticalFallbackPolicy('sms', '00000000-0000-0000-0000-000000000001', '555-1234');

    expect(result).toEqual({
      allowed: false,
      reason: 'sms destination must be E.164',
    });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('blocks when per-user daily limit is reached', async () => {
    mockConfig.criticalFallbackSmsEnabled = true;
    mockConfig.criticalFallbackSmsMaxPerUserDay = 2;
    mockQuery
      .mockResolvedValueOnce({ rows: [{ verified: true }] })
      .mockResolvedValueOnce({ rows: [{ count: '2' }] });

    const result = await evaluateCriticalFallbackPolicy('sms', '00000000-0000-0000-0000-000000000001', '+15551234567');

    expect(result).toEqual({
      allowed: false,
      reason: 'sms per-user daily limit reached',
    });
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  test('blocks when phone number has not been verified', async () => {
    mockConfig.criticalFallbackSmsEnabled = true;
    mockQuery.mockResolvedValueOnce({ rows: [{ verified: false }] });

    const result = await evaluateCriticalFallbackPolicy('sms', '00000000-0000-0000-0000-000000000001', '+15551234567');

    expect(result).toEqual({
      allowed: false,
      reason: 'sms destination is not verified',
    });
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  test('allows when enabled, address is valid, and daily guards have capacity', async () => {
    mockConfig.criticalFallbackVoiceCallEnabled = true;
    mockConfig.criticalFallbackVoiceCallMaxPerUserDay = 3;
    mockConfig.criticalFallbackVoiceCallMaxGlobalDay = 20;
    mockQuery
      .mockResolvedValueOnce({ rows: [{ verified: true }] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] })
      .mockResolvedValueOnce({ rows: [{ count: '10' }] });

    const result = await evaluateCriticalFallbackPolicy('voice_call', '00000000-0000-0000-0000-000000000001', '+15551234567');

    expect(result).toEqual({ allowed: true });
    expect(mockQuery).toHaveBeenCalledTimes(3);
  });
});
