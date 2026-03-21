import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { LeagueProfileModal } from '@/components/ui/LeagueProfileModal';
import type { League, LeagueProfile } from '@/types';

const league: League = {
  league_id: 39,
  league_name: 'Premier League',
  country: 'England',
  tier: '1',
  active: true,
  top_league: true,
  type: 'League',
  logo: '',
  last_updated: '',
  has_profile: true,
  profile_updated_at: '2026-03-22T00:00:00Z',
  profile_volatility_tier: 'medium',
  profile_data_reliability_tier: 'high',
};

const profile: LeagueProfile = {
  league_id: 39,
  tempo_tier: 'high',
  goal_tendency: 'high',
  home_advantage_tier: 'normal',
  corners_tendency: 'balanced',
  cards_tendency: 'low',
  volatility_tier: 'medium',
  data_reliability_tier: 'high',
  avg_goals: 2.95,
  over_2_5_rate: 61,
  btts_rate: 57,
  late_goal_rate_75_plus: 31,
  avg_corners: 9.8,
  avg_cards: 3.7,
  notes_en: 'Fast and open league.',
  notes_vi: 'Giai dau co toc do cao.',
  created_at: '2026-03-22T00:00:00Z',
  updated_at: '2026-03-22T00:00:00Z',
};

describe('LeagueProfileModal', () => {
  test('renders existing profile and submits edited values', () => {
    const onSave = vi.fn();
    render(
      <LeagueProfileModal
        league={league}
        profile={profile}
        loading={false}
        saving={false}
        onClose={() => {}}
        onSave={onSave}
        onDelete={() => {}}
      />,
    );

    const avgGoalsInput = screen.getByLabelText('Avg Goals') as HTMLInputElement;
    fireEvent.change(avgGoalsInput, { target: { value: '3.10' } });

    fireEvent.click(screen.getByRole('button', { name: 'Update Profile' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      avg_goals: 3.1,
      tempo_tier: 'high',
      notes_en: 'Fast and open league.',
    }));
  });

  test('shows create mode without delete button when profile is absent', () => {
    render(
      <LeagueProfileModal
        league={{ ...league, has_profile: false }}
        profile={null}
        loading={false}
        saving={false}
        onClose={() => {}}
        onSave={() => {}}
        onDelete={() => {}}
      />,
    );

    expect(screen.getByRole('button', { name: 'Create Profile' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete Profile' })).not.toBeInTheDocument();
  });

  test('shows a league-specific deep research prompt template', () => {
    render(
      <LeagueProfileModal
        league={league}
        profile={profile}
        loading={false}
        saving={false}
        onClose={() => {}}
        onSave={() => {}}
        onDelete={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Export Prompt Template' }));

    const promptArea = screen.getByLabelText('Deep Research Prompt Template') as HTMLTextAreaElement;
    expect(promptArea.value).toContain('Create exactly one betting-oriented league profile');
    expect(promptArea.value).toContain('- league_name: Premier League');
    expect(promptArea.value).toContain('- country: England');
    expect(promptArea.value).toContain('Return STRICT JSON only with this exact shape:');
  });

  test('imports deep research JSON into the form before saving', () => {
    const onSave = vi.fn();
    render(
      <LeagueProfileModal
        league={league}
        profile={profile}
        loading={false}
        saving={false}
        onClose={() => {}}
        onSave={onSave}
        onDelete={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Import League Profile' }));
    fireEvent.change(screen.getByLabelText('Import League Profile JSON'), {
      target: {
        value: JSON.stringify({
          league_id: 39,
          league_name: 'Premier League',
          country: 'England',
          sample_confidence: 'high',
          qualitative_profile: {
            tempo_tier: 'very_high',
            goal_tendency: 'high',
            home_advantage_tier: 'high',
            corners_tendency: 'high',
            cards_tendency: 'balanced',
            volatility_tier: 'medium',
            data_reliability_tier: 'high',
          },
          quantitative_verified: {
            avg_goals: 3.12,
            over_2_5_rate: 63.5,
            btts_rate: 58.2,
            late_goal_rate_75_plus: 30.1,
            avg_corners: 10.2,
            avg_cards: 3.9,
          },
          notes_en: 'Fast and open with strong late-game tempo.',
          notes_vi: 'Toc do cao va cuoi tran thuong mo.',
        }),
      },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Apply Import' }));
    fireEvent.click(screen.getByRole('button', { name: 'Update Profile' }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      tempo_tier: 'very_high',
      home_advantage_tier: 'high',
      avg_goals: 3.12,
      notes_en: 'Fast and open with strong late-game tempo.',
      notes_vi: 'Toc do cao va cuoi tran thuong mo.',
    }));
  });
});
