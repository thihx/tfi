import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../db/pool.js', () => ({
  query: vi.fn(),
}));

import { query } from '../db/pool.js';
import {
  buildAutoDerivedTeamProfileData,
  flattenTeamProfileData,
  flattenTeamProfileRow,
  getAllTeamProfiles,
  normalizeTeamProfileData,
} from '../repos/team-profiles.repo.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('team profiles repository', () => {
  test('lists one row per shared team profile using stable metadata joins', async () => {
    vi.mocked(query).mockResolvedValueOnce({
      rows: [{
        team_id: '33',
        profile: { attack_style: 'mixed' },
        notes_en: '',
        notes_vi: '',
        created_at: '2026-03-25T00:00:00.000Z',
        updated_at: '2026-03-25T00:00:00.000Z',
        team_name: 'Manchester United',
        team_logo: 'https://logo/33.png',
      }],
    } as never);

    const result = await getAllTeamProfiles();

    expect(result).toHaveLength(1);
    expect(result[0]?.team_name).toBe('Manchester United');
    expect(query).toHaveBeenCalledTimes(1);
    const sql = String(vi.mocked(query).mock.calls[0]?.[0]);
    expect(sql).toContain('FROM team_profiles tp');
    expect(sql).toContain('LEFT JOIN teams t');
    expect(sql).not.toContain('LEFT JOIN LATERAL');
  });

  test('flattens v2 stored team profiles back into the legacy UI shape', () => {
    const stored = {
      version: 2,
      source_mode: 'hybrid',
      window: {
        lookback_days: 180,
        sample_matches: 18,
        sample_home_matches: 9,
        sample_away_matches: 9,
        event_summary_matches: 18,
        event_coverage: 1,
        top_league_only: true,
        computed_at: '2026-04-01T00:00:00.000Z',
        updated_at: '2026-04-01T00:00:00.000Z',
      },
      quantitative_core: {
        set_piece_threat: 'high',
        home_strength: 'strong',
        form_consistency: 'consistent',
        avg_goals_scored: 1.8,
        avg_goals_conceded: 0.9,
        clean_sheet_rate: 0.4,
        btts_rate: 0.5,
        over_2_5_rate: 0.55,
        avg_corners_for: 5.9,
        avg_corners_against: 4.2,
        avg_cards: 2.1,
        first_goal_rate: 0.63,
        late_goal_rate: 0.37,
        data_reliability_tier: 'high',
      },
      tactical_overlay: {
        attack_style: 'direct',
        defensive_line: 'high',
        pressing_intensity: 'high',
        squad_depth: 'deep',
        source_mode: 'curated',
        source_confidence: 'medium',
        source_urls: ['https://fbref.com/example'],
        source_season: '2025/26',
        updated_at: '2026-04-01T00:00:00.000Z',
      },
    };
    const flattened = flattenTeamProfileData(stored);
    const flattenedRow = flattenTeamProfileRow({ profile: stored });

    expect(flattened.attack_style).toBe('direct');
    expect(flattened.set_piece_threat).toBe('high');
    expect(flattened.first_goal_rate).toBe(0.63);
    expect(flattenedRow.tactical_overlay_source_mode).toBe('curated');
    expect(flattenedRow.tactical_overlay_source_season).toBe('2025/26');
    expect(flattenedRow.tactical_overlay_source_urls).toEqual(['https://fbref.com/example']);
  });

  test('keeps an existing tactical overlay when rebuilding auto-derived quantitative core', () => {
    const stored = buildAutoDerivedTeamProfileData(
      {
        attack_style: 'mixed',
        defensive_line: 'medium',
        pressing_intensity: 'medium',
        set_piece_threat: 'high',
        home_strength: 'strong',
        form_consistency: 'consistent',
        squad_depth: 'medium',
        avg_goals_scored: 1.8,
        avg_goals_conceded: 0.9,
        clean_sheet_rate: 0.4,
        btts_rate: 0.5,
        over_2_5_rate: 0.55,
        avg_corners_for: 5.9,
        avg_corners_against: 4.2,
        avg_cards: 2.1,
        first_goal_rate: 0.63,
        late_goal_rate: 0.37,
        data_reliability_tier: 'high',
      },
      {
        lookback_days: 180,
        sample_matches: 18,
        sample_home_matches: 9,
        sample_away_matches: 9,
        event_summary_matches: 18,
        event_coverage: 1,
        top_league_only: true,
        computed_at: '2026-04-01T00:00:00.000Z',
      },
      {
        version: 2,
        source_mode: 'hybrid',
        window: {
          lookback_days: 180,
          sample_matches: 18,
          sample_home_matches: 9,
          sample_away_matches: 9,
          event_summary_matches: 18,
          event_coverage: 1,
          top_league_only: true,
          computed_at: '2026-03-31T00:00:00.000Z',
          updated_at: '2026-03-31T00:00:00.000Z',
        },
        quantitative_core: {
          set_piece_threat: 'medium',
          home_strength: 'normal',
          form_consistency: 'inconsistent',
          avg_goals_scored: 1.2,
          avg_goals_conceded: 1.2,
          clean_sheet_rate: 0.2,
          btts_rate: 0.4,
          over_2_5_rate: 0.45,
          avg_corners_for: 4.8,
          avg_corners_against: 4.8,
          avg_cards: 2.5,
          first_goal_rate: 0.5,
          late_goal_rate: 0.2,
          data_reliability_tier: 'medium',
        },
        tactical_overlay: {
          attack_style: 'possession',
          defensive_line: 'low',
          pressing_intensity: 'high',
          squad_depth: 'deep',
          source_mode: 'curated',
          source_confidence: 'high',
          source_urls: ['https://example.com/report'],
          source_season: '2025/26',
          updated_at: '2026-03-31T00:00:00.000Z',
        },
      },
    );

    expect(stored.tactical_overlay.attack_style).toBe('possession');
    expect(stored.tactical_overlay.source_mode).toBe('curated');
    expect(stored.tactical_overlay.source_urls).toEqual(['https://example.com/report']);
    expect(stored.tactical_overlay.source_season).toBe('2025/26');
    expect(stored.quantitative_core.avg_goals_scored).toBe(1.8);
  });

  test('clears overlay provenance when tactical overlay is reset to default neutral', () => {
    const reset = normalizeTeamProfileData(
      {
        attack_style: 'mixed',
        defensive_line: 'medium',
        pressing_intensity: 'medium',
        set_piece_threat: 'medium',
        home_strength: 'normal',
        form_consistency: 'inconsistent',
        squad_depth: 'medium',
        avg_goals_scored: 1.2,
        avg_goals_conceded: 1.1,
        clean_sheet_rate: 0.2,
        btts_rate: 0.4,
        over_2_5_rate: 0.45,
        avg_corners_for: 4.8,
        avg_corners_against: 4.8,
        avg_cards: 2.5,
        first_goal_rate: 0.5,
        late_goal_rate: 0.2,
        data_reliability_tier: 'medium',
      },
      {
        version: 2,
        source_mode: 'hybrid',
        window: {
          lookback_days: 180,
          sample_matches: 18,
          sample_home_matches: 9,
          sample_away_matches: 9,
          event_summary_matches: 18,
          event_coverage: 1,
          top_league_only: true,
          computed_at: '2026-03-31T00:00:00.000Z',
          updated_at: '2026-03-31T00:00:00.000Z',
        },
        quantitative_core: {
          set_piece_threat: 'medium',
          home_strength: 'normal',
          form_consistency: 'inconsistent',
          avg_goals_scored: 1.2,
          avg_goals_conceded: 1.2,
          clean_sheet_rate: 0.2,
          btts_rate: 0.4,
          over_2_5_rate: 0.45,
          avg_corners_for: 4.8,
          avg_corners_against: 4.8,
          avg_cards: 2.5,
          first_goal_rate: 0.5,
          late_goal_rate: 0.2,
          data_reliability_tier: 'medium',
        },
        tactical_overlay: {
          attack_style: 'direct',
          defensive_line: 'high',
          pressing_intensity: 'high',
          squad_depth: 'deep',
          source_mode: 'curated',
          source_confidence: 'medium',
          source_urls: ['https://example.com/report'],
          source_season: '2025/26',
          updated_at: '2026-03-31T00:00:00.000Z',
        },
      },
      {
        source_mode: 'default_neutral',
      },
    );

    expect(reset.tactical_overlay.source_mode).toBe('default_neutral');
    expect(reset.tactical_overlay.source_confidence).toBeNull();
    expect(reset.tactical_overlay.source_urls).toEqual([]);
    expect(reset.tactical_overlay.source_season).toBeNull();
  });
});
