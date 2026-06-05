import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { WatchlistEditModal } from '@/components/ui/WatchlistEditModal';
import { evaluateWatchConditionPreview, fetchConditionAlertPresets, fetchMatchAlertRules } from '@/lib/services/api';
import type { WatchlistItem } from '@/types';

vi.mock('@/hooks/useAppState', () => ({
  useAppState: () => ({
    state: { config: { apiUrl: 'http://localhost:4000' } },
  }),
}));

vi.mock('@/lib/services/api', () => ({
  evaluateWatchConditionPreview: vi.fn().mockResolvedValue({
    supported: true,
    matched: true,
    summary: 'Condition matched: Minute >= 60',
    notify_enabled: true,
    context_summary: {
      minute: 65,
      home_goals: 1,
      away_goals: 1,
      data_source: 'latest_snapshot',
    },
  }),
  fetchConditionAlertPresets: vi.fn().mockResolvedValue([]),
  fetchMatchAlertRules: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/features/live-monitor/config', () => ({
  fetchMonitorConfig: vi.fn().mockResolvedValue({
    AUTO_APPLY_RECOMMENDED_CONDITION: true,
    TELEGRAM_ENABLED: true,
    ZALO_ENABLED: false,
  }),
}));

vi.mock('@/lib/services/notification-channels', () => ({
  fetchNotificationChannels: vi.fn().mockResolvedValue([
    {
      channelType: 'telegram',
      enabled: true,
      status: 'verified',
      address: '1',
      config: {},
      metadata: {},
    },
    {
      channelType: 'zalo',
      enabled: true,
      status: 'draft',
      address: null,
      config: {},
      metadata: {},
    },
  ]),
}));

const baseItem: WatchlistItem = {
  match_id: '100',
  date: '2026-03-22',
  league: 'K League 1',
  home_team: 'Ulsan Hyundai',
  away_team: 'Gimcheon Sangmu',
  kickoff: '18:00',
  custom_conditions: '',
  recommended_custom_condition: '(Minute >= 60) AND (NOT Home leading)',
  recommended_condition_reason: 'Late phase is a good window for late goals.',
  recommended_condition_reason_vi: 'Nhip tran phu hop de theo doi ban thang muon.',
  strategic_context: null,
};

describe('WatchlistEditModal', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.mocked(fetchConditionAlertPresets).mockResolvedValue([]);
    vi.mocked(fetchMatchAlertRules).mockResolvedValue([]);
  });

  test('defaults auto-apply to the global setting when item has no override', () => {
    render(
      <WatchlistEditModal
        item={baseItem}
        onClose={() => {}}
        onSave={() => {}}
      />,
    );

    expect(screen.getByRole('checkbox', { name: /Use system suggestion when saving/i })).toBeChecked();
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
        onClose={() => {}}
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByRole('checkbox', { name: /Use system suggestion when saving/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        auto_apply_recommended_condition: false,
        custom_conditions: '(Minute >= 55) AND (Total goals <= 1)',
        notify_enabled: true,
      }),
    );
  });

  test('applies recommended condition on save when auto-apply is enabled and trigger is blank', () => {
    const onSave = vi.fn();
    render(
      <WatchlistEditModal
        item={baseItem}
        onClose={() => {}}
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        auto_apply_recommended_condition: true,
        custom_conditions: '(Minute >= 60) AND (NOT Home leading)',
        notify_enabled: true,
      }),
    );
  });

  test('calls evaluate API when checking trigger against live data', async () => {
    render(
      <WatchlistEditModal item={baseItem} onClose={() => {}} onSave={() => {}} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Test with live data' }));

    await waitFor(() => {
      expect(evaluateWatchConditionPreview).toHaveBeenCalledWith(
        expect.objectContaining({ apiUrl: 'http://localhost:4000' }),
        expect.objectContaining({
          match_id: '100',
          condition_text: '(Minute >= 60) AND (NOT Home leading)',
        }),
      );
    });
    expect(await screen.findByText(/Would trigger now/i)).toBeInTheDocument();
  });

  test('surfaces when subscription has notifications disabled', async () => {
    vi.mocked(evaluateWatchConditionPreview).mockResolvedValueOnce({
      supported: true,
      matched: true,
      summary: 'Condition matched',
      notify_enabled: false,
      context_summary: {
        minute: 10,
        home_goals: 0,
        away_goals: 0,
        data_source: 'match_fixture',
      },
    });

    render(
      <WatchlistEditModal item={baseItem} onClose={() => {}} onSave={() => {}} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Test with live data' }));

    expect(await screen.findByText(/Push off for this watch/i)).toBeInTheDocument();
  });

  test('points users to match hub for context', () => {
    render(
      <WatchlistEditModal item={baseItem} onClose={() => {}} onSave={() => {}} />,
    );
    expect(screen.getByText(/Match hub/i)).toBeInTheDocument();
  });

  test('shows compact Telegram and Zalo delivery status', async () => {
    render(
      <WatchlistEditModal item={baseItem} onClose={() => {}} onSave={() => {}} />,
    );
    fireEvent.click(screen.getByText('Delivery options'));
    expect(await screen.findByText('Telegram')).toBeInTheDocument();
    expect(await screen.findByText('Monitor on')).toBeInTheDocument();
    expect(await screen.findByText('Zalo')).toBeInTheDocument();
    expect(await screen.findByText('Not linked')).toBeInTheDocument();
  });

  test('shows empty-state copy when there is no recommended condition', () => {
    render(
      <WatchlistEditModal
        item={{
          ...baseItem,
          recommended_custom_condition: '',
          recommended_condition_reason: '',
          recommended_condition_reason_vi: '',
        }}
        onClose={() => {}}
        onSave={() => {}}
      />,
    );
    expect(screen.getByText(/No suggestion yet/i)).toBeInTheDocument();
  });
});
