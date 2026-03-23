import { fireEvent, render, screen, act } from '@testing-library/react';
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { TeamProfileModal } from '@/components/ui/TeamProfileModal';
import type { TeamProfile } from '@/types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

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
  notes_vi: 'Đội kiểm soát bóng.',
  created_at: '2026-03-22T00:00:00Z',
  updated_at: '2026-03-22T00:00:00Z',
};

// Default no-op handlers
const noop = vi.fn().mockResolvedValue(undefined);

// ── Clipboard mock ─────────────────────────────────────────────────────────────

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

// ── Tests ─────────────────────────────────────────────────────────────────────

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

  test('renders in create mode when profile is null — no delete button', () => {
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

  test('shows team info strip with Last Updated when profile exists', () => {
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

  test('omits Last Updated strip row when profile is null', () => {
    render(
      <TeamProfileModal
        team={team} profile={null}
        loading={false} saving={false}
        onClose={noop} onSave={noop} onDelete={noop}
      />,
    );

    expect(screen.queryByText('Last Updated')).not.toBeInTheDocument();
  });

  test('shows loading spinner while loading=true and disables save button', () => {
    render(
      <TeamProfileModal
        team={team} profile={null}
        loading={true} saving={false}
        onClose={noop} onSave={noop} onDelete={noop}
      />,
    );

    expect(screen.getByText(/Loading profile/i)).toBeInTheDocument();
    // Footer is always rendered; save button must be disabled while loading
    expect(screen.getByRole('button', { name: 'Create Profile' })).toBeDisabled();
  });

  test('calls onSave with correct teamId when saved', async () => {
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
      notes_vi: 'Đội kiểm soát bóng.',
    }));
  });

  test('editing a stat input updates the saved draft', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <TeamProfileModal
        team={team} profile={profile}
        loading={false} saving={false}
        onClose={noop} onSave={onSave} onDelete={noop}
      />,
    );

    // Label text includes the hint "/90", so use regex partial match
    const scoredInput = screen.getByLabelText(/^scored/i) as HTMLInputElement;
    fireEvent.change(scoredInput, { target: { value: '2.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update Profile' }));

    expect(onSave).toHaveBeenCalledWith('team_42', expect.objectContaining({
      profile: expect.objectContaining({ avg_goals_scored: 2.5 }),
    }));
  });

  test('clicking a TierSegment option updates the draft on save', () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <TeamProfileModal
        team={team} profile={profile}
        loading={false} saving={false}
        onClose={noop} onSave={onSave} onDelete={noop}
      />,
    );

    // Switch attack_style from 'possession' to 'counter'
    fireEvent.click(screen.getByTitle('Counter'));
    fireEvent.click(screen.getByRole('button', { name: 'Update Profile' }));

    expect(onSave).toHaveBeenCalledWith('team_42', expect.objectContaining({
      profile: expect.objectContaining({ attack_style: 'counter' }),
    }));
  });

  test('editing notes textarea updates the saved draft', () => {
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

  test('delete flow: shows confirm buttons, calls onDelete on confirm', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(
      <TeamProfileModal
        team={team} profile={profile}
        loading={false} saving={false}
        onClose={noop} onSave={noop} onDelete={onDelete}
      />,
    );

    // Click delete → shows confirmation
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete Profile' }));
    });
    expect(screen.getByText('Delete profile?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();

    // Confirm → calls onDelete
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

    // Two "Cancel" buttons exist: one in confirm row (btn-sm), one in footer — pick the confirm one
    const cancelButtons = screen.getAllByRole('button', { name: 'Cancel' });
    fireEvent.click(cancelButtons[0]!);
    expect(screen.queryByText('Delete profile?')).not.toBeInTheDocument();
  });

  test('Deep Research tab shows wizard step 1 with Copy Prompt button', () => {
    render(
      <TeamProfileModal
        team={team} profile={profile}
        loading={false} saving={false}
        onClose={noop} onSave={noop} onDelete={noop}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Deep Research' }));
    expect(screen.getByRole('button', { name: 'Copy Prompt' })).toBeInTheDocument();
  });

  test('Deep Research: prompt contains team name and league context', () => {
    render(
      <TeamProfileModal
        team={team} leagueName="Premier League"
        profile={profile}
        loading={false} saving={false}
        onClose={noop} onSave={noop} onDelete={noop}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Deep Research' }));
    // The <pre> element contains the prompt — check unique phrase from the prompt template
    expect(screen.getByText(/playing in Premier League/)).toBeInTheDocument();
  });

  test('Deep Research: Copy Prompt advances to step 2 after timeout', async () => {
    render(
      <TeamProfileModal
        team={team} profile={profile}
        loading={false} saving={false}
        onClose={noop} onSave={noop} onDelete={noop}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Deep Research' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy Prompt' }));

    // After clipboard write resolves + setTimeout fires → step 2
    await act(async () => {
      await Promise.resolve(); // flush clipboard promise
      vi.runAllTimers();
    });

    expect(screen.getByRole('button', { name: 'Parse JSON →' })).toBeInTheDocument();
  });

  test('Deep Research: full import flow applies parsed data to form', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <TeamProfileModal
        team={team} profile={profile}
        loading={false} saving={false}
        onClose={noop} onSave={onSave} onDelete={noop}
      />,
    );

    // Go to step 2 directly by copy → wait → step 2
    fireEvent.click(screen.getByRole('button', { name: 'Deep Research' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy Prompt' }));
    await act(async () => {
      await Promise.resolve();
      vi.runAllTimers();
    });

    // Paste JSON
    const importJson = JSON.stringify({
      team_name: 'Arsenal',
      profile: {
        attack_style: 'counter',
        defensive_line: 'low',
        pressing_intensity: 'low',
        set_piece_threat: 'medium',
        home_strength: 'normal',
        form_consistency: 'volatile',
        squad_depth: 'shallow',
        avg_goals_scored: 1.1,
        avg_goals_conceded: 1.6,
        clean_sheet_rate: 20,
        btts_rate: 60,
        over_2_5_rate: 45,
        avg_corners_for: 4.5,
        avg_corners_against: 5.2,
        avg_cards: 2.8,
        first_goal_rate: 40,
        late_goal_rate: 30,
        data_reliability_tier: 'medium',
      },
      notes_en: 'Counter-attacking team, weak at home.',
      notes_vi: 'Đội phản công, yếu sân nhà.',
    });

    fireEvent.change(screen.getByRole('textbox'), { target: { value: importJson } });
    fireEvent.click(screen.getByRole('button', { name: 'Parse JSON →' }));

    // Step 3: review + apply
    expect(screen.getByRole('button', { name: 'Apply to Profile →' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Apply to Profile →' }));

    // Back on Profile Data tab — save
    fireEvent.click(screen.getByRole('button', { name: 'Update Profile' }));

    expect(onSave).toHaveBeenCalledWith('team_42', expect.objectContaining({
      profile: expect.objectContaining({
        attack_style: 'counter',
        defensive_line: 'low',
        avg_goals_scored: 1.1,
        home_strength: 'normal',
      }),
      notes_en: 'Counter-attacking team, weak at home.',
      notes_vi: 'Đội phản công, yếu sân nhà.',
    }));
  });

  test('Deep Research step 2: shows parse error on invalid JSON', async () => {
    render(
      <TeamProfileModal
        team={team} profile={profile}
        loading={false} saving={false}
        onClose={noop} onSave={noop} onDelete={noop}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Deep Research' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy Prompt' }));
    await act(async () => {
      await Promise.resolve();
      vi.runAllTimers();
    });

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'totally broken {{{' } });
    fireEvent.click(screen.getByRole('button', { name: 'Parse JSON →' }));

    expect(screen.getByText(/Invalid JSON/i)).toBeInTheDocument();
    // Should stay on step 2
    expect(screen.getByRole('button', { name: 'Parse JSON →' })).toBeInTheDocument();
  });

  test('returns null and renders nothing when team prop is null', () => {
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
