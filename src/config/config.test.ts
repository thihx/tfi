import { describe, test, expect, beforeEach } from 'vitest';
import { escapeHtml, formatDate, formatDateTime, getStatusBadge, getCountryFromLeague, getTierBadge, loadConfig, saveConfig } from './config';

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

// ==================== formatDate ====================
describe('formatDate', () => {
  test('formats date string to vi-VN locale', () => {
    const result = formatDate('2026-03-16');
    // vi-VN format: DD/MM/YYYY
    expect(result).toMatch(/16/);
    expect(result).toMatch(/3/);
    expect(result).toMatch(/2026/);
  });

  test('returns empty string for empty input', () => {
    expect(formatDate('')).toBe('');
  });
});

// ==================== formatDateTime ====================
describe('formatDateTime', () => {
  test('formats datetime string to vi-VN locale', () => {
    const result = formatDateTime('2026-03-16T14:30:00');
    expect(result).toMatch(/16/);
    expect(result).toMatch(/2026/);
  });

  test('returns empty string for empty input', () => {
    expect(formatDateTime('')).toBe('');
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
    expect(config.webhookUrl).toBeTruthy();
    expect(config.defaultMode).toBe('B');
    expect(config.appsScriptUrl).toBeTruthy();
    expect(config.apiKey).toBeTruthy();
  });

  test('saveConfig persists to localStorage', () => {
    const config = loadConfig();
    config.webhookUrl = 'https://test.example.com';
    config.defaultMode = 'A';
    saveConfig(config);

    expect(localStorage.setItem).toHaveBeenCalledWith('webhookUrl', 'https://test.example.com');
    expect(localStorage.setItem).toHaveBeenCalledWith('defaultMode', 'A');
  });

  test('loadConfig reads saved values', () => {
    localStorage.setItem('webhookUrl', 'https://saved.example.com');
    localStorage.setItem('defaultMode', 'C');

    const config = loadConfig();
    expect(config.webhookUrl).toBe('https://saved.example.com');
    expect(config.defaultMode).toBe('C');
  });
});
