import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockQuery = vi.fn();

vi.mock('../db/pool.js', () => ({
  query: mockQuery,
}));

describe('match alert rules repo', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('gates candidate rules by source-specific user settings', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const repo = await import('../repos/match-alert-rules.repo.js');

    await repo.getCandidateAlertRules();

    const sql = String(mockQuery.mock.calls[0]?.[0] ?? '');
    expect(sql).toContain('LEFT JOIN user_match_alert_settings s ON s.user_id = r.user_id');
    expect(sql).toContain('AND COALESCE(s.match_start_enabled, TRUE) = TRUE');
    expect(sql).toContain("WHEN r.source = 'manual' THEN COALESCE(s.manual_match_start_enabled, TRUE) = TRUE");
    expect(sql).toContain("WHEN r.source = 'favorite_team' THEN COALESCE(s.favorite_team_match_start_enabled, FALSE) = TRUE");
    expect(sql).toContain("WHEN r.source = 'favorite_league' THEN COALESCE(s.favorite_league_match_start_enabled, FALSE) = TRUE");
    expect(sql).toContain('AND COALESCE(s.condition_alerts_enabled, TRUE) = TRUE');
    expect(sql).toContain("WHEN r.source = 'favorite_team' THEN COALESCE(s.favorite_team_condition_alerts_enabled, FALSE) = TRUE");
    expect(sql).toContain("WHEN r.source = 'favorite_league' THEN COALESCE(s.favorite_league_condition_alerts_enabled, FALSE) = TRUE");
  });

  it('uses the same source-specific gates for realtime alert refresh interest', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ match_id: '1546317' }] });
    const repo = await import('../repos/match-alert-rules.repo.js');

    const ids = await repo.getRealtimeAlertMatchIds();

    expect(ids).toEqual(['1546317']);
    const sql = String(mockQuery.mock.calls[0]?.[0] ?? '');
    expect(sql).toContain('SELECT DISTINCT r.match_id');
    expect(sql).toContain('LEFT JOIN user_match_alert_settings s ON s.user_id = r.user_id');
    expect(sql).toContain('AND COALESCE(s.match_start_enabled, TRUE) = TRUE');
    expect(sql).toContain("WHEN r.source = 'manual' THEN COALESCE(s.manual_match_start_enabled, TRUE) = TRUE");
    expect(sql).toContain("WHEN r.source = 'favorite_team' THEN COALESCE(s.favorite_team_match_start_enabled, FALSE) = TRUE");
    expect(sql).toContain("WHEN r.source = 'favorite_league' THEN COALESCE(s.favorite_league_match_start_enabled, FALSE) = TRUE");
    expect(sql).toContain('AND COALESCE(s.condition_alerts_enabled, TRUE) = TRUE');
    expect(sql).toContain("WHEN r.source = 'favorite_team' THEN COALESCE(s.favorite_team_condition_alerts_enabled, FALSE) = TRUE");
    expect(sql).toContain("WHEN r.source = 'favorite_league' THEN COALESCE(s.favorite_league_condition_alerts_enabled, FALSE) = TRUE");
  });
});
