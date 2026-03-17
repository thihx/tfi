import { describe, test, expect, beforeEach } from 'vitest';
import { escapeHtml, getStatusBadge, getCountryFromLeague, getTierBadge, loadConfig, saveConfig } from './config';

// ==================== escapeHtml ====================
describe('escapeHtml', () => {
  test('escapes HTML special characters', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
    );
  });

  test('escapes ampersand', () => {
    expect(escapeHtml('A & B')).toBe('A &amp; B');
  });

  test('escapes single quotes', () => {
    expect(escapeHtml("it's")).toBe('it&#039;s');
  });

  test('returns empty string for empty input', () => {
    expect(escapeHtml('')).toBe('');
  });

  test('returns empty string for falsy input', () => {
    expect(escapeHtml(null as unknown as string)).toBe('');
  });
});

// ==================== getStatusBadge ====================
describe('getStatusBadge', () => {
  test('returns badge info for known status', () => {
    const badge = getStatusBadge('NS');
    expect(badge.label).toBeTruthy();
    expect(typeof badge.className).toBe('string');
  });

  test('returns raw status as label for unknown status', () => {
    const badge = getStatusBadge('UNKNOWN_STATUS');
    expect(badge.label).toBe('UNKNOWN_STATUS');
  });
});

// ==================== getCountryFromLeague ====================
describe('getCountryFromLeague', () => {
  test('returns country for known league', () => {
    // Premier League = 39
    expect(getCountryFromLeague(39)).toBe('England');
  });

  test('returns "Other" for unknown league', () => {
    expect(getCountryFromLeague(99999)).toBe('Other');
  });
});

// ==================== getTierBadge ====================
describe('getTierBadge', () => {
  test('returns tier for known league', () => {
    const tier = getTierBadge(39); // Premier League
    expect(tier).toBe(1);
  });

  test('returns null for unknown league', () => {
    expect(getTierBadge(99999)).toBeNull();
  });
});

// ==================== loadConfig / saveConfig ====================
describe('loadConfig & saveConfig', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('loadConfig returns default config when nothing saved', () => {
    const config = loadConfig();
    expect(config.defaultMode).toBe('B');
    expect(config.apiUrl).toBeTruthy();
  });

  test('saveConfig persists to localStorage', () => {
    const config = loadConfig();
    config.defaultMode = 'A';
    saveConfig(config);

    expect(localStorage.setItem).toHaveBeenCalledWith('defaultMode', 'A');
  });

  test('loadConfig reads saved values', () => {
    localStorage.setItem('defaultMode', 'C');

    const config = loadConfig();
    expect(config.defaultMode).toBe('C');
  });
});
