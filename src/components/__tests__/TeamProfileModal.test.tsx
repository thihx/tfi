import { fireEvent, render, screen, act } from '@testing-library/react';
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { TeamProfileModal } from '@/components/ui/TeamProfileModal';
import type { TeamProfile } from '@/types';

const team = { id: 'team_42', name: 'Arsenal' };
const teamWithLeague = { id: 'team_42', name: 'Arsenal' };

const profile: TeamProfile = {
  team_id: 'team_42',
  profile: {
    attack_style: 'possession',
    defensive_line: 'high',
    pressing_intensity: 'high',
    set_piece_threat: 'high',
    home_strength: 'strong',
    form_consistency: 'consistent',
    squad_depth: 'deep',
    avg_goals_scored: 2.2,
    avg_goals_conceded: 0.9,
    clean_sheet_rate: 42,
    btts_rate: 48,
    over_2_5_rate: 55,
    avg_corners_for: 6.1,
    avg_corners_against: 3.8,
    avg_cards: 1.4,
    first_goal_rate: 68,
    late_goal_rate: 35,
    data_reliability_tier: 'high',
  },
  notes_en: 'Strong possession team.',
  notes_vi: 'Doi kiem soat bong.',
  created_at: '2026-03-22T00:00:00Z',
  updated_at: '2026-03-22T00:00:00Z',
};

const noop = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    writable: true,
    configurable: true,
  });
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('TeamProfileModal', () => {
  test('renders in update mode with existing profile', () => {
    render(
      <TeamProfileModal
        team={team} profile={profile}
        loading={false} saving={false}
        onClose={noop} onSave={noop} onDelete={noop}
      />,
    );

    expect(screen.getByRole('button', { name: 'Update Profile' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create Profile' })).not.toBeInTheDocument();
  });

  test('renders in create mode when profile is null', () => {
    render(
      <TeamProfileModal
        team={team} profile={null}
        loading={false} saving={false}
        onClose={noop} onSave={noop} onDelete={noop}
      />,
    );

    expect(screen.getByRole('button', { name: 'Create Profile' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete Profile' })).not.toBeInTheDocument();
  });

  test('shows team info strip with last updated when profile exists', () => {
    render(
      <TeamProfileModal
        team={teamWithLeague} leagueName="Premier League"
        profile={profile}
        loading={false} saving={false}
        onClose={noop} onSave={noop} onDelete={noop}
      />,
    );

    expect(screen.getByText('Arsenal')).toBeInTheDocument();
    expect(screen.getByText('Premier League')).toBeInTheDocument();
    expect(screen.getByText('Last Updated')).toBeInTheDocument();
  });

  test('shows loading state and disables save', () => {
    render(
      <TeamProfileModal
        team={team} profile={null}
        loading saving={false}
        onClose={noop} onSave={noop} onDelete={noop}
      />,
    );

    expect(screen.getByText(/Loading profile/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create Profile' })).toBeDisabled();
  });

  test('calls onSave with current draft', () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <TeamProfileModal
        team={team} profile={profile}
        loading={false} saving={false}
        onClose={noop} onSave={onSave} onDelete={noop}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Update Profile' }));
    expect(onSave).toHaveBeenCalledWith('team_42', expect.objectContaining({
      profile: expect.objectContaining({ attack_style: 'possession' }),
      notes_en: 'Strong possession team.',
      notes_vi: 'Doi kiem soat bong.',
    }));
  });

  test('editing a stat input updates the saved draft', () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <TeamProfileModal
        team={team} profile={profile}
        loading={false} saving={false}
        onClose={noop} onSave={onSave} onDelete={noop}
      />,
    );

    const scoredInput = screen.getByLabelText(/^scored/i) as HTMLInputElement;
    fireEvent.change(scoredInput, { target: { value: '2.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update Profile' }));

    expect(onSave).toHaveBeenCalledWith('team_42', expect.objectContaining({
      profile: expect.objectContaining({ avg_goals_scored: 2.5 }),
    }));
  });

  test('clicking a tier option updates the draft on save', () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <TeamProfileModal
        team={team} profile={profile}
        loading={false} saving={false}
        onClose={noop} onSave={onSave} onDelete={noop}
      />,
    );

    fireEvent.click(screen.getByTitle('Counter'));
    fireEvent.click(screen.getByRole('button', { name: 'Update Profile' }));

    expect(onSave).toHaveBeenCalledWith('team_42', expect.objectContaining({
      profile: expect.objectContaining({ attack_style: 'counter' }),
    }));
  });

  test('editing notes updates the saved draft', () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <TeamProfileModal
        team={team} profile={profile}
        loading={false} saving={false}
        onClose={noop} onSave={onSave} onDelete={noop}
      />,
    );

    fireEvent.change(screen.getByLabelText('English'), { target: { value: 'Updated analyst note.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update Profile' }));

    expect(onSave).toHaveBeenCalledWith('team_42', expect.objectContaining({
      notes_en: 'Updated analyst note.',
    }));
  });

  test('delete flow confirms and calls onDelete', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(
      <TeamProfileModal
        team={team} profile={profile}
        loading={false} saving={false}
        onClose={noop} onSave={noop} onDelete={onDelete}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete Profile' }));
    });
    expect(screen.getByText('Delete profile?')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    });
    expect(onDelete).toHaveBeenCalledWith('team_42');
  });

  test('delete confirm cancel hides confirmation', () => {
    render(
      <TeamProfileModal
        team={team} profile={profile}
        loading={false} saving={false}
        onClose={noop} onSave={noop} onDelete={noop}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete Profile' }));
    expect(screen.getByText('Delete profile?')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Cancel' })[0]!);
    expect(screen.queryByText('Delete profile?')).not.toBeInTheDocument();
  });

  test('Tactical Overlay Research tab shows wizard step 1', () => {
    render(
      <TeamProfileModal
        team={team} profile={profile}
        loading={false} saving={false}
        onClose={noop} onSave={noop} onDelete={noop}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Tactical Overlay Research' }));
    expect(screen.getByRole('button', { name: 'Copy Prompt' })).toBeInTheDocument();
  });

  test('Tactical Overlay Research prompt contains team, league, and tactical-only wording', () => {
    render(
      <TeamProfileModal
        team={team} leagueName="Premier League" overlayEligible
        profile={profile}
        loading={false} saving={false}
        onClose={noop} onSave={noop} onDelete={noop}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Tactical Overlay Research' }));
    expect(screen.getByText(/associated with Premier League/)).toBeInTheDocument();
    expect(screen.getByText(/TACTICAL OVERLAY ONLY/i)).toBeInTheDocument();
  });

  test('Tactical Overlay Research warns when team is not in a top league', () => {
    render(
      <TeamProfileModal
        team={team} leagueName="AFC Champions League"
        profile={profile}
        loading={false} saving={false}
        onClose={noop} onSave={noop} onDelete={noop}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Tactical Overlay Research' }));
    expect(screen.getByText(/approved competition contexts only/i)).toBeInTheDocument();
  });

  test('Tactical Overlay Research copy prompt advances to step 2', async () => {
    render(
      <TeamProfileModal
        team={team} profile={profile}
        loading={false} saving={false}
        onClose={noop} onSave={noop} onDelete={noop}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Tactical Overlay Research' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy Prompt' }));

    await act(async () => {
      await Promise.resolve();
      vi.runAllTimers();
    });

    expect(screen.getByRole('button', { name: /Parse JSON/i })).toBeInTheDocument();
  });

  test('Tactical Overlay Research import only patches tactical overlay and preserves quantitative core', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <TeamProfileModal
        team={team} profile={profile} overlayEligible
        loading={false} saving={false}
        onClose={noop} onSave={onSave} onDelete={noop}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Tactical Overlay Research' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy Prompt' }));
    await act(async () => {
      await Promise.resolve();
      vi.runAllTimers();
    });

    const importJson = JSON.stringify({
      schema_version: 1,
      target: 'team_tactical_overlay',
      entity_type: 'club',
      team_name: 'Arsenal',
      competition_context: 'Premier League 2025/26',
      season: '2025/26',
      data_sources: ['https://fbref.com/en/squads/arsenal'],
      sample_confidence: 'high',
      profile: {
        attack_style: 'counter',
        defensive_line: 'low',
        pressing_intensity: 'low',
        squad_depth: 'shallow',
      },
      notes_en: 'Counter-attacking team, weak at home.',
      notes_vi: 'Doi phan cong, yeu san nha.',
    });

    fireEvent.change(screen.getByRole('textbox'), { target: { value: importJson } });
    fireEvent.click(screen.getByRole('button', { name: /Parse JSON/i }));
    expect(screen.getByRole('button', { name: /Apply to Profile/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Apply to Profile/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Update Profile' }));

    expect(onSave).toHaveBeenCalledWith('team_42', expect.objectContaining({
      profile: expect.objectContaining({
        attack_style: 'counter',
        defensive_line: 'low',
        pressing_intensity: 'low',
        squad_depth: 'shallow',
        avg_goals_scored: 2.2,
        home_strength: 'strong',
      }),
      notes_en: 'Counter-attacking team, weak at home.',
      notes_vi: 'Doi phan cong, yeu san nha.',
      overlay_metadata: expect.objectContaining({
        source_mode: 'llm_assisted',
        source_confidence: 'high',
        source_urls: ['https://fbref.com/en/squads/arsenal'],
        source_season: '2025/26',
      }),
    }));
  });

  test('Tactical Overlay Research shows parse error when imported sources are untrusted', async () => {
    render(
      <TeamProfileModal
        team={team} profile={profile} overlayEligible
        loading={false} saving={false}
        onClose={noop} onSave={noop} onDelete={noop}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Tactical Overlay Research' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy Prompt' }));
    await act(async () => {
      await Promise.resolve();
      vi.runAllTimers();
    });

    fireEvent.change(screen.getByRole('textbox'), {
      target: {
        value: JSON.stringify({
          team_name: 'Arsenal',
          data_sources: ['https://reddit.com/r/soccer'],
          profile: {
            attack_style: 'counter',
            defensive_line: 'low',
            pressing_intensity: 'low',
            squad_depth: 'shallow',
          },
        }),
      },
    });
    fireEvent.click(screen.getByRole('button', { name: /Parse JSON/i }));

    expect(screen.getByText(/No trusted tactical overlay source URLs found/i)).toBeInTheDocument();
  });

  test('Tactical Overlay Research step 2 shows parse error on invalid JSON', async () => {
    render(
      <TeamProfileModal
        team={team} profile={profile}
        loading={false} saving={false}
        onClose={noop} onSave={noop} onDelete={noop}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Tactical Overlay Research' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy Prompt' }));
    await act(async () => {
      await Promise.resolve();
      vi.runAllTimers();
    });

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'totally broken {{{' } });
    fireEvent.click(screen.getByRole('button', { name: /Parse JSON/i }));

    expect(screen.getByText(/Invalid JSON/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Parse JSON/i })).toBeInTheDocument();
  });

  test('Tactical Overlay Research rejects unsupported target', async () => {
    render(
      <TeamProfileModal
        team={team} profile={profile}
        loading={false} saving={false}
        onClose={noop} onSave={noop} onDelete={noop}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Tactical Overlay Research' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy Prompt' }));
    await act(async () => {
      await Promise.resolve();
      vi.runAllTimers();
    });

    fireEvent.change(screen.getByRole('textbox'), {
      target: {
        value: JSON.stringify({
          schema_version: 1,
          target: 'league_profile_core',
          data_sources: ['https://fbref.com/en/squads/arsenal'],
          profile: { attack_style: 'counter' },
        }),
      },
    });
    fireEvent.click(screen.getByRole('button', { name: /Parse JSON/i }));

    expect(screen.getByText(/target is not team_tactical_overlay/i)).toBeInTheDocument();
  });

  test('returns null when team prop is null', () => {
    const { container } = render(
      <TeamProfileModal
        team={null} profile={null}
        loading={false} saving={false}
        onClose={noop} onSave={noop} onDelete={noop}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});
