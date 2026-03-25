import { beforeEach, describe, expect, test } from 'vitest';

import { readUiLanguage } from './useUiLanguage';

describe('readUiLanguage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('returns UI_LANGUAGE when present', () => {
    localStorage.setItem('liveMonitorConfig', JSON.stringify({ UI_LANGUAGE: 'en' }));

    expect(readUiLanguage()).toBe('en');
  });

  test('falls back to vi when only notification language is present', () => {
    localStorage.setItem('liveMonitorConfig', JSON.stringify({ NOTIFICATION_LANGUAGE: 'en' }));

    expect(readUiLanguage()).toBe('vi');
  });

  test('falls back to vi for invalid storage data', () => {
    localStorage.setItem('liveMonitorConfig', 'not-json');

    expect(readUiLanguage()).toBe('vi');
  });
});