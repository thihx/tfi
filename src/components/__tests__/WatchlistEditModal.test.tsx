import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { WatchlistEditModal } from '@/components/ui/WatchlistEditModal';
import type { WatchlistItem } from '@/types';

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
  });

  test('defaults auto-apply to the global setting when item has no override', () => {
    render(
      <WatchlistEditModal
        item={baseItem}
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
        item={{ ...baseItem, custom_conditions: '(Minute >= 55) AND (Total goals <= 1)' }}
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
});
