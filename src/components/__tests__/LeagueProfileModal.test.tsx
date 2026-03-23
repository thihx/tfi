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
    tempo_tier:            'high',
    goal_tendency:         'high',
    home_advantage_tier:   'balanced',
    corners_tendency:      'balanced',
    cards_tendency:        'low',
    volatility_tier:       'low',
    data_reliability_tier: 'high',
    avg_goals:             2.95,
    over_2_5_rate:         61,
    btts_rate:             57,
    late_goal_rate_75_plus: 31,
    avg_corners:           9.8,
    avg_cards:             3.7,
  },
  notes_en: 'Fast and open league.',
  notes_vi: 'Giai dau co toc do cao.',
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

    // Tempo slider: 'high' = index 2
    const tempoSlider = screen.getByRole('slider', { name: 'Tempo' }) as HTMLInputElement;
    expect(tempoSlider.value).toBe('2');

    // Cards slider: 'low' = index 0
    const cardsSlider = screen.getByRole('slider', { name: 'Cards' }) as HTMLInputElement;
    expect(cardsSlider.value).toBe('0');

    // Data Reliability slider: 'high' = index 2
    const reliabilitySlider = screen.getByRole('slider', { name: 'Data Reliability' }) as HTMLInputElement;
    expect(reliabilitySlider.value).toBe('2');
  });

  test('renders stat inputs with correct initial numeric values', () => {
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

    const avgGoalsInput = screen.getByLabelText(/^avg goals/i) as HTMLInputElement;
    expect(avgGoalsInput.value).toBe('2.95');
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

    const avgGoalsInput = screen.getByLabelText(/^avg goals/i);
    fireEvent.change(avgGoalsInput, { target: { value: '3.10' } });
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

    // Move Tempo slider from index 2 (high) to index 1 (balanced)
    const tempoSlider = screen.getByRole('slider', { name: 'Tempo' });
    fireEvent.change(tempoSlider, { target: { value: '1' } });

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

    // All sliders default to 'balanced' = index 1
    const sliders = screen.getAllByRole('slider');
    sliders.forEach((slider) => {
      expect((slider as HTMLInputElement).value).toBe('1');
    });
  });

  test('Deep Research tab shows prompt template', () => {
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

    fireEvent.click(screen.getByRole('button', { name: 'Deep Research' }));

    const promptArea = screen.getByLabelText('Deep Research Prompt Template') as HTMLTextAreaElement;
    expect(promptArea.value).toContain('Create exactly one betting-oriented league profile');
    expect(promptArea.value).toContain('- league_name: Premier League');
    expect(promptArea.value).toContain('"low|balanced|high"');
  });

  test('Deep Research wizard: parses JSON and applies to profile', async () => {
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

    // Switch to Deep Research tab
    fireEvent.click(screen.getByRole('button', { name: 'Deep Research' }));

    // Step 1 → Step 2
    fireEvent.click(screen.getByRole('button', { name: /I've got the JSON result/i }));

    // Paste JSON
    const importedJson = {
      league_id: 39,
      league_name: 'Premier League',
      country: 'England',
      sample_confidence: 'high',
      qualitative_profile: {
        tempo_tier: 'high',
        goal_tendency: 'high',
        home_advantage_tier: 'balanced',
        corners_tendency: 'high',
        cards_tendency: 'low',
        volatility_tier: 'low',
        data_reliability_tier: 'high',
      },
      quantitative_verified: {
        avg_goals: 3.12,
        over_2_5_rate: 0.635,
        btts_rate: 0.582,
        late_goal_rate_75_plus: 0.301,
        avg_corners: 10.2,
        avg_cards: 3.9,
      },
      notes_en: 'Fast and open with strong late-game tempo.',
      notes_vi: 'Toc do cao va cuoi tran thuong mo.',
    };

    fireEvent.change(screen.getByLabelText('Import League Profile JSON'), {
      target: { value: JSON.stringify(importedJson) },
    });

    // Validate & proceed to step 3
    fireEvent.click(screen.getByRole('button', { name: /validate & continue/i }));

    // Apply import
    fireEvent.click(screen.getByRole('button', { name: /apply to profile/i }));

    // Now save
    fireEvent.click(screen.getByRole('button', { name: 'Update Profile' }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      profile: expect.objectContaining({
        tempo_tier: 'high',
        avg_goals: 3.12,
      }),
      notes_en: 'Fast and open with strong late-game tempo.',
    }));
  });

  test('Deep Research wizard: shows error for invalid JSON', () => {
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

    fireEvent.click(screen.getByRole('button', { name: 'Deep Research' }));
    fireEvent.click(screen.getByRole('button', { name: /I've got the JSON result/i }));

    fireEvent.change(screen.getByLabelText('Import League Profile JSON'), {
      target: { value: 'not valid json {{{' },
    });
    fireEvent.click(screen.getByRole('button', { name: /validate & continue/i }));

    expect(screen.getByText(/could not be auto-repaired/i)).toBeInTheDocument();
  });

  test('Deep Research wizard: rejects JSON for wrong league', () => {
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

    fireEvent.click(screen.getByRole('button', { name: 'Deep Research' }));
    fireEvent.click(screen.getByRole('button', { name: /I've got the JSON result/i }));

    fireEvent.change(screen.getByLabelText('Import League Profile JSON'), {
      target: { value: JSON.stringify({ league_name: 'Bundesliga', country: 'Germany' }) },
    });
    fireEvent.click(screen.getByRole('button', { name: /validate & continue/i }));

    expect(screen.getByText(/Imported profile is for/i)).toBeInTheDocument();
  });
});
