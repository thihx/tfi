// ============================================================
// Config Service Tests
// ============================================================

import { describe, test, expect, beforeEach } from 'vitest';
import { createDefaultConfig, loadMonitorConfig, saveMonitorConfig } from '../config';

describe('createDefaultConfig', () => {
  test('returns all required fields with defaults', () => {
    const config = createDefaultConfig();

    expect(config.TIMEZONE).toBe('Asia/Seoul');
    expect(config.MIN_CONFIDENCE).toBe(5);
    expect(config.MIN_ODDS).toBe(1.5);
    expect(config.LATE_PHASE_MINUTE).toBe(75);
    expect(config.VERY_LATE_PHASE_MINUTE).toBe(85);
    expect(config.ENDGAME_MINUTE).toBe(88);
    expect(config.AI_PROVIDER).toBe('gemini');
    expect(config.AI_MODEL).toBe('gemini-3-pro-preview');
    expect(config.MANUAL_PUSH_MATCH_IDS).toEqual([]);
  });

  test('applies overrides to defaults', () => {
    const config = createDefaultConfig({
      AI_PROVIDER: 'claude',
      AI_MODEL: 'claude-sonnet-4-20250514',
      MIN_CONFIDENCE: 7,
    });

    expect(config.AI_PROVIDER).toBe('claude');
    expect(config.AI_MODEL).toBe('claude-sonnet-4-20250514');
    expect(config.MIN_CONFIDENCE).toBe(7);
    // Other defaults preserved
    expect(config.TIMEZONE).toBe('Asia/Seoul');
  });
});

describe('loadMonitorConfig', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('returns default config when localStorage is empty', () => {
    const config = loadMonitorConfig();
    expect(config.AI_PROVIDER).toBe('gemini');
    expect(config.TIMEZONE).toBe('Asia/Seoul');
  });

  test('merges localStorage config with defaults', () => {
    localStorage.setItem(
      'liveMonitorConfig',
      JSON.stringify({ AI_PROVIDER: 'claude', MIN_CONFIDENCE: 8 }),
    );
    const config = loadMonitorConfig();
    expect(config.AI_PROVIDER).toBe('claude');
    expect(config.MIN_CONFIDENCE).toBe(8);
    expect(config.TIMEZONE).toBe('Asia/Seoul');
  });

  test('applies runtime overrides on top of localStorage', () => {
    localStorage.setItem(
      'liveMonitorConfig',
      JSON.stringify({ AI_PROVIDER: 'claude' }),
    );
    const config = loadMonitorConfig({ AI_PROVIDER: 'gemini', MIN_ODDS: 2.0 });
    expect(config.AI_PROVIDER).toBe('gemini');
    expect(config.MIN_ODDS).toBe(2.0);
  });

  test('handles corrupted localStorage gracefully', () => {
    localStorage.setItem('liveMonitorConfig', 'not-json');
    const config = loadMonitorConfig();
    expect(config.AI_PROVIDER).toBe('gemini');
  });
});

describe('saveMonitorConfig', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('saves config to localStorage', () => {
    const config = createDefaultConfig({ AI_PROVIDER: 'claude' });
    saveMonitorConfig(config);

    const saved = JSON.parse(localStorage.getItem('liveMonitorConfig')!);
    expect(saved.AI_PROVIDER).toBe('claude');
  });

  test('saved config can be loaded back', () => {
    const original = createDefaultConfig({ MIN_CONFIDENCE: 8, AI_MODEL: 'test-model' });
    saveMonitorConfig(original);
    const loaded = loadMonitorConfig();

    expect(loaded.MIN_CONFIDENCE).toBe(8);
    expect(loaded.AI_MODEL).toBe('test-model');
  });
});
