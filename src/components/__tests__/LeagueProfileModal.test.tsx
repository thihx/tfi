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
  profile_volatility_tier: 'balanced',
  profile_data_reliability_tier: 'high',
};

const profile: LeagueProfile = {
  league_id: 39,
  profile: {
    tempo_tier: 'high',
    goal_tendency: 'high',
    home_advantage_tier: 'balanced',
    corners_tendency: 'balanced',
    cards_tendency: 'low',
    volatility_tier: 'low',
    data_reliability_tier: 'high',
    avg_goals: 2.95,
    over_2_5_rate: 61,
    btts_rate: 57,
    late_goal_rate_75_plus: 31,
    avg_corners: 9.8,
    avg_cards: 3.7,
  },
  notes_en: 'Fast and open league.',
  notes_vi: 'Giải đấu có tốc độ cao.',
  created_at: '2026-03-22T00:00:00Z',
  updated_at: '2026-03-22T00:00:00Z',
};

describe('LeagueProfileModal', () => {
  test('renders league info strip with correct values', () => {
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

    expect(screen.getByText('Premier League')).toBeInTheDocument();
    expect(screen.getByText('England')).toBeInTheDocument();
    expect(screen.getByText('1 / League')).toBeInTheDocument();
  });

  test('shows Update Profile button when profile exists', () => {
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

    expect(screen.getByRole('button', { name: 'Update Profile' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  test('shows Create Profile button and hides Delete when no profile', () => {
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
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  test('renders tier sliders with correct initial values', () => {
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

    expect((screen.getByRole('slider', { name: 'Tempo' }) as HTMLInputElement).value).toBe('2');
    expect((screen.getByRole('slider', { name: 'Cards' }) as HTMLInputElement).value).toBe('0');
    expect((screen.getByRole('slider', { name: 'Data Reliability' }) as HTMLInputElement).value).toBe('2');
  });

  test('calls onSave with updated stat value', () => {
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

    fireEvent.change(screen.getByLabelText(/^avg goals/i), { target: { value: '3.10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update Profile' }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      profile: expect.objectContaining({ avg_goals: 3.1, tempo_tier: 'high' }),
      notes_en: 'Fast and open league.',
    }));
  });

  test('calls onSave with updated tier from slider', () => {
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

    fireEvent.change(screen.getByRole('slider', { name: 'Tempo' }), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update Profile' }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      profile: expect.objectContaining({ tempo_tier: 'balanced' }),
    }));
  });

  test('calls onDelete when Delete is clicked', () => {
    const onDelete = vi.fn();
    render(
      <LeagueProfileModal
        league={league}
        profile={profile}
        loading={false}
        saving={false}
        onClose={() => {}}
        onSave={() => {}}
        onDelete={onDelete}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  test('shows loading state while loading=true', () => {
    render(
      <LeagueProfileModal
        league={league}
        profile={null}
        loading={true}
        saving={false}
        onClose={() => {}}
        onSave={() => {}}
        onDelete={() => {}}
      />,
    );

    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create Profile' })).toBeDisabled();
  });

  test('disables buttons while saving=true', () => {
    render(
      <LeagueProfileModal
        league={league}
        profile={profile}
        loading={false}
        saving={true}
        onClose={() => {}}
        onSave={() => {}}
        onDelete={() => {}}
      />,
    );

    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
  });

  test('initialises sliders to balanced when profile is null', () => {
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

    screen.getAllByRole('slider').forEach((slider) => {
      expect((slider as HTMLInputElement).value).toBe('1');
    });
  });

  test('shows auto-derived core message and no Deep Research tab', () => {
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

    expect(screen.getByText(/auto-derived from structured historical data/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deep Research' })).not.toBeInTheDocument();
  });
});
