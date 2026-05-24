import { describe, expect, test } from 'vitest';
import { classifyJobResult } from '../jobs/job-run-outcome.js';

describe('classifyJobResult', () => {
  test('treats football API circuit skip as skipped status', () => {
    const outcome = classifyJobResult({
      skipped: true,
      skipReason: 'football_api_daily_limit',
      openUntil: '2026-05-25T00:00:00.000Z',
      saved: 0,
    });
    expect(outcome.status).toBe('skipped');
    expect(outcome.skipReason).toBe('football_api_daily_limit');
    expect(outcome.errorMessage).toContain('2026-05-25T00:00:00.000Z');
  });

  test('treats adaptive backoff as skipped', () => {
    const outcome = classifyJobResult({
      skipped: true,
      skipReason: 'adaptive_poll_backoff',
      saved: 0,
      leagues: 0,
    });
    expect(outcome.status).toBe('skipped');
    expect(outcome.errorMessage).toContain('adaptive poll backoff');
  });

  test('success when no skip flag', () => {
    expect(classifyJobResult({ saved: 3, leagues: 2 }).status).toBe('success');
  });
});
