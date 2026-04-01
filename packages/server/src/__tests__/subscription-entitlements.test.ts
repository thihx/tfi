import { describe, expect, test } from 'vitest';
import {
  buildDailyPeriodKey,
  getBooleanEntitlement,
  getNumberEntitlement,
  getStringArrayEntitlement,
  mergeEntitlements,
  normalizeEntitlementMap,
} from '../lib/subscription-entitlements.js';

describe('subscription entitlements', () => {
  test('normalizes malformed values back to typed defaults', () => {
    const normalized = normalizeEntitlementMap({
      'ai.manual.ask.enabled': 'yes',
      'ai.manual.ask.daily_limit': '12',
      'notifications.channels.allowed_types': ['web_push', '', 'telegram', 'telegram'],
    });

    expect(normalized['ai.manual.ask.enabled']).toBe(true);
    expect(normalized['ai.manual.ask.daily_limit']).toBe(12);
    expect(normalized['notifications.channels.allowed_types']).toEqual(['web_push', 'telegram']);
  });

  test('merges layers on top of defaults', () => {
    const merged = mergeEntitlements(
      { 'ai.manual.ask.daily_limit': 3, 'watchlist.active_matches.limit': 5 },
      { 'ai.manual.ask.daily_limit': 20 },
    );

    expect(getNumberEntitlement(merged, 'ai.manual.ask.daily_limit')).toBe(20);
    expect(getNumberEntitlement(merged, 'watchlist.active_matches.limit')).toBe(5);
    expect(getBooleanEntitlement(merged, 'reports.export.enabled')).toBe(false);
    expect(getStringArrayEntitlement(merged, 'notifications.channels.allowed_types')).toEqual(['web_push']);
  });

  test('builds YYYY-MM-DD period keys', () => {
    const key = buildDailyPeriodKey(new Date('2026-03-31T12:34:56.000Z'));
    expect(key).toBe('2026-03-31');
  });
});
