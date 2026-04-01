import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { WatchlistEditModal } from '@/components/ui/WatchlistEditModal';
import type { AppConfig, Match, WatchlistItem } from '@/types';

vi.mock('@/features/live-monitor/config', () => ({
  fetchMonitorConfig: vi.fn().mockResolvedValue({
    AUTO_APPLY_RECOMMENDED_CONDITION: true,
  }),
}));

vi.mock('@/lib/services/api', () => ({
  fetchLeagueProfile: vi.fn().mockResolvedValue(null),
  fetchTeamProfile: vi.fn().mockResolvedValue(null),
}));

const config: AppConfig = {
  apiUrl: 'http://localhost:4000',
  defaultMode: 'B',
};

const match: Match = {
  match_id: '100',
  date: '2026-03-22',
  kickoff: '18:00',
  kickoff_at_utc: '2026-03-22T09:00:00.000Z',
  league_id: 292,
  league_name: 'K League 1',
  home_team: 'Ulsan Hyundai',
  away_team: 'Gimcheon Sangmu',
  home_logo: '',
  away_logo: '',
  home_score: null,
  away_score: null,
  status: 'NS',
  home_team_id: 1,
  away_team_id: 2,
};

const baseItem: WatchlistItem = {
  match_id: '100',
  date: '2026-03-22',
  league: 'K League 1',
  home_team: 'Ulsan Hyundai',
  away_team: 'Gimcheon Sangmu',
  kickoff: '18:00',
  mode: 'B',
  priority: 2,
  custom_conditions: '',
  status: 'active',
  recommended_custom_condition: '(Minute >= 60) AND (NOT Home leading)',
  recommended_condition_reason_vi: 'Nhip tran phu hop de theo doi ban thang muon.',
  strategic_context: null,
};

describe('WatchlistEditModal', () => {
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

  test('defaults auto-apply to the global setting when item has no override', () => {
    render(
      <WatchlistEditModal
        item={baseItem}
        match={match}
        config={config}
        defaultMode="B"
        uiLanguage="vi"
        onClose={() => {}}
        onSave={() => {}}
      />,
    );

    const checkbox = screen.getByLabelText('Auto-apply recommended condition for this match') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  test('submits explicit per-match override when disabled', () => {
    const onSave = vi.fn();
    render(
      <WatchlistEditModal
        item={{
          ...baseItem,
          custom_conditions: '(Minute >= 55) AND (Total goals <= 1)',
          auto_apply_recommended_condition: true,
        }}
        match={match}
        config={config}
        defaultMode="B"
        uiLanguage="vi"
        onClose={() => {}}
        onSave={onSave}
      />,
    );

    const checkbox = screen.getByLabelText('Auto-apply recommended condition for this match');
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      auto_apply_recommended_condition: false,
      custom_conditions: '(Minute >= 55) AND (Total goals <= 1)',
    }));
  });

  test('applies recommended condition on save when auto-apply is enabled and trigger is blank', () => {
    const onSave = vi.fn();
    render(
      <WatchlistEditModal
        item={baseItem}
        match={match}
        config={config}
        defaultMode="B"
        uiLanguage="vi"
        onClose={() => {}}
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      auto_apply_recommended_condition: true,
      custom_conditions: '(Minute >= 60) AND (NOT Home leading)',
    }));
  });

  test('renders directional strategic context fields when present', () => {
    render(
      <WatchlistEditModal
        item={{
          ...baseItem,
          strategic_context_at: '2026-03-24T12:00:00.000Z',
          strategic_context: {
            home_motivation: 'Home chasing title',
            away_motivation: 'Away needs points',
            league_positions: '2nd vs 16th',
            fixture_congestion: 'Shared congestion summary',
            home_fixture_congestion: 'Home played cup midweek',
            away_fixture_congestion: 'Away had full week rest',
            rotation_risk: 'Moderate rotation risk',
            key_absences: 'Shared absence summary',
            home_key_absences: 'Home missing starting fullback',
            away_key_absences: 'Away missing first-choice striker',
            h2h_narrative: 'Home won last two meetings',
            summary: 'Structured strategic context ready',
            searched_at: '2026-03-24T11:30:00.000Z',
            version: 2,
            source_meta: {
              search_quality: 'high',
              web_search_queries: ['example query'],
              sources: [],
              trusted_source_count: 2,
              rejected_source_count: 0,
              rejected_domains: [],
            },
          },
        }}
        match={match}
        config={config}
        defaultMode="B"
        uiLanguage="vi"
        onClose={() => {}}
        onSave={() => {}}
      />,
    );

    expect(screen.getByText((text) => text.includes('Ulsan Hyundai') && text.includes('Congestion'))).toBeInTheDocument();
    expect(screen.getByText('Away had full week rest')).toBeInTheDocument();
    expect(screen.getByText((text) => text.includes('Ulsan Hyundai') && text.includes('Absences'))).toBeInTheDocument();
    expect(screen.getByText('Away missing first-choice striker')).toBeInTheDocument();
  });

  test('groups context as match-specific enrichment and hides research trace details by default', () => {
    render(
      <WatchlistEditModal
        item={{
          ...baseItem,
          strategic_context_at: '2026-03-24T12:00:00.000Z',
          strategic_context: {
            home_motivation: 'Home chasing title',
            away_motivation: 'Away needs points',
            league_positions: '2nd vs 16th',
            fixture_congestion: 'Shared congestion summary',
            rotation_risk: 'Moderate rotation risk',
            key_absences: 'Shared absence summary',
            h2h_narrative: 'Home won last two meetings',
            summary: 'Structured strategic context ready',
            searched_at: '2026-03-24T11:30:00.000Z',
            competition_type: 'domestic_league',
            version: 2,
            source_meta: {
              search_quality: 'high',
              web_search_queries: ['example query one', 'example query two'],
              sources: [{ title: 'FBref', url: 'https://fbref.com/test', domain: 'fbref.com', publisher: 'fbref.com', language: 'en', source_type: 'stats_reference', trust_tier: 'tier_2' }],
              trusted_source_count: 1,
              rejected_source_count: 0,
              rejected_domains: [],
            },
          },
        }}
        match={match}
        config={config}
        defaultMode="B"
        uiLanguage="vi"
        onClose={() => {}}
        onSave={() => {}}
      />,
    );

    expect(screen.getByText('Match Context')).toBeInTheDocument();
    expect(screen.getByText(/League profile, team profile, and tactical overlay priors/i)).toBeInTheDocument();
    expect(screen.getByText('Domestic League')).toBeInTheDocument();
    expect(screen.getByText('Research Trace')).toBeInTheDocument();
    expect(screen.getByText('Research Trace').closest('details')).not.toHaveAttribute('open');
  });

  test('loads and renders league and team profile priors', async () => {
    const { fetchLeagueProfile, fetchTeamProfile } = await import('@/lib/services/api');
    vi.mocked(fetchLeagueProfile).mockResolvedValueOnce({
      league_id: 292,
      profile: {
        tempo_tier: 'balanced',
        goal_tendency: 'high',
        home_advantage_tier: 'balanced',
        corners_tendency: 'balanced',
        cards_tendency: 'low',
        volatility_tier: 'balanced',
        data_reliability_tier: 'high',
        avg_goals: 2.9,
        over_2_5_rate: 0.58,
        btts_rate: 0.53,
        late_goal_rate_75_plus: 0.31,
        avg_corners: 9.3,
        avg_cards: 3.1,
      },
      notes_en: 'Auto-derived league prior',
      notes_vi: '',
      created_at: '2026-03-22T00:00:00.000Z',
      updated_at: '2026-03-22T12:00:00.000Z',
    });
    vi.mocked(fetchTeamProfile)
      .mockResolvedValueOnce({
        team_id: '1',
        profile: {
          attack_style: 'possession',
          defensive_line: 'high',
          pressing_intensity: 'high',
          set_piece_threat: 'medium',
          home_strength: 'strong',
          form_consistency: 'consistent',
          squad_depth: 'deep',
          avg_goals_scored: 1.8,
          avg_goals_conceded: 0.9,
          clean_sheet_rate: 0.42,
          btts_rate: 0.48,
          over_2_5_rate: 0.51,
          avg_corners_for: 5.2,
          avg_corners_against: 3.3,
          avg_cards: 1.8,
          first_goal_rate: 0.64,
          late_goal_rate: 0.36,
          data_reliability_tier: 'high',
        },
        notes_en: 'Home team prior',
        notes_vi: '',
        tactical_overlay_source_mode: 'llm_assisted',
        tactical_overlay_source_confidence: 'medium',
        tactical_overlay_source_urls: ['https://fotmob.com/test'],
        tactical_overlay_source_season: '2025/26',
        tactical_overlay_updated_at: '2026-03-22T12:00:00.000Z',
        created_at: '2026-03-22T00:00:00.000Z',
        updated_at: '2026-03-22T12:00:00.000Z',
      })
      .mockResolvedValueOnce({
        team_id: '2',
        profile: {
          attack_style: 'counter',
          defensive_line: 'medium',
          pressing_intensity: 'medium',
          set_piece_threat: 'low',
          home_strength: 'normal',
          form_consistency: 'inconsistent',
          squad_depth: 'medium',
          avg_goals_scored: 1.1,
          avg_goals_conceded: 1.2,
          clean_sheet_rate: 0.22,
          btts_rate: 0.58,
          over_2_5_rate: 0.62,
          avg_corners_for: 4.1,
          avg_corners_against: 4.6,
          avg_cards: 2.1,
          first_goal_rate: 0.41,
          late_goal_rate: 0.44,
          data_reliability_tier: 'medium',
        },
        notes_en: 'Away team prior',
        notes_vi: '',
        tactical_overlay_source_mode: 'default_neutral',
        tactical_overlay_source_confidence: null,
        tactical_overlay_source_urls: [],
        tactical_overlay_source_season: null,
        tactical_overlay_updated_at: null,
        created_at: '2026-03-22T00:00:00.000Z',
        updated_at: '2026-03-22T12:00:00.000Z',
      });

    render(
      <WatchlistEditModal
        item={baseItem}
        match={match}
        config={config}
        defaultMode="B"
        uiLanguage="vi"
        onClose={() => {}}
        onSave={() => {}}
      />,
    );

    expect(await screen.findByText('Profile Priors')).toBeInTheDocument();
    expect(await screen.findByText('League Match BTTS')).toBeInTheDocument();
    expect(await screen.findByText('Ulsan Hyundai Team Profile')).toBeInTheDocument();
    expect((await screen.findAllByText('Overlay')).length).toBeGreaterThan(0);
    expect(await screen.findByText('Llm Assisted (Medium)')).toBeInTheDocument();
  });

  test('does not refetch profile priors when the parent rerenders with the same identifiers', async () => {
    const { fetchLeagueProfile, fetchTeamProfile } = await import('@/lib/services/api');
    vi.mocked(fetchLeagueProfile).mockResolvedValueOnce(null);
    vi.mocked(fetchTeamProfile).mockResolvedValue(null);

    const { rerender } = render(
      <WatchlistEditModal
        item={baseItem}
        match={match}
        config={config}
        defaultMode="B"
        uiLanguage="vi"
        onClose={() => {}}
        onSave={() => {}}
      />,
    );

    await screen.findByText('Profile Priors');
    expect(fetchLeagueProfile).toHaveBeenCalledTimes(1);
    expect(fetchTeamProfile).toHaveBeenCalledTimes(2);

    rerender(
      <WatchlistEditModal
        item={{ ...baseItem }}
        match={{ ...match }}
        config={{ ...config }}
        defaultMode="B"
        uiLanguage="vi"
        onClose={() => {}}
        onSave={() => {}}
      />,
    );

    expect(fetchLeagueProfile).toHaveBeenCalledTimes(1);
    expect(fetchTeamProfile).toHaveBeenCalledTimes(2);
  });

  test('normalizes no-diacritic Vietnamese strategic text before rendering', () => {
    render(
      <WatchlistEditModal
        item={{
          ...baseItem,
          strategic_context_at: '2026-03-24T12:00:00.000Z',
          strategic_context: {
            home_motivation: '',
            away_motivation: '',
            league_positions: '',
            fixture_congestion: '',
            rotation_risk: '',
            key_absences: '',
            h2h_narrative: '',
            summary: '',
            searched_at: '2026-03-24T11:30:00.000Z',
            version: 2,
            home_key_absences_vi: 'Khong co vang mat lon',
            rotation_risk_vi: 'Khong co xoay tua lon',
            summary_vi: 'Khong tim thay du lieu',
            source_meta: {
              search_quality: 'low',
              web_search_queries: [],
              sources: [],
              trusted_source_count: 0,
              rejected_source_count: 0,
              rejected_domains: [],
            },
          },
        }}
        match={match}
        config={config}
        defaultMode="B"
        uiLanguage="vi"
        onClose={() => {}}
        onSave={() => {}}
      />,
    );

    expect(screen.getByText('Không có vắng mặt lớn')).toBeInTheDocument();
    expect(screen.getByText('Không có xoay tua lớn')).toBeInTheDocument();
    expect(screen.queryByText('Khong tim thay du lieu')).not.toBeInTheDocument();
  });
});
