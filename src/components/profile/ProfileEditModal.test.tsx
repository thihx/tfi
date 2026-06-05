import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfileEditModal } from './ProfileEditModal';

const mockShowToast = vi.fn();
const mockUpdateCurrentUserProfile = vi.fn();
const mockFetchMonitorConfig = vi.fn();
const mockPersistMonitorConfig = vi.fn();
const mockFetchNotificationChannels = vi.fn();
const mockPersistNotificationChannel = vi.fn();
const mockFetchMatchAlertSettings = vi.fn();
const mockPersistMatchAlertSettings = vi.fn();
const mockFetchConditionAlertPresets = vi.fn();
const mockPersistConditionAlertPresets = vi.fn();
const mockResetConditionAlertPresets = vi.fn();
const mockRequestNotificationPermission = vi.fn();
const mockGetExistingSubscription = vi.fn();
const mockSubscribePush = vi.fn();
const mockUnsubscribePush = vi.fn();
let pushSupported = false;
let notificationPermission: NotificationPermission = 'default';

vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

vi.mock('@/lib/services/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/services/auth')>('@/lib/services/auth');
  return {
    ...actual,
    updateCurrentUserProfile: (...args: unknown[]) => mockUpdateCurrentUserProfile(...args),
  };
});

vi.mock('@/features/live-monitor/config', () => ({
  fetchMonitorConfig: (...args: unknown[]) => mockFetchMonitorConfig(...args),
  persistMonitorConfig: (...args: unknown[]) => mockPersistMonitorConfig(...args),
}));

vi.mock('@/lib/services/notification-channels', async () => {
  const actual = await vi.importActual<typeof import('@/lib/services/notification-channels')>(
    '@/lib/services/notification-channels',
  );
  return {
    ...actual,
    fetchNotificationChannels: (...args: unknown[]) => mockFetchNotificationChannels(...args),
    persistNotificationChannel: (...args: unknown[]) => mockPersistNotificationChannel(...args),
  };
});

vi.mock('@/lib/services/push', () => ({
  isPushSupported: () => pushSupported,
  getNotificationPermission: () => notificationPermission,
  requestNotificationPermission: (...args: unknown[]) => mockRequestNotificationPermission(...args),
  getExistingSubscription: (...args: unknown[]) => mockGetExistingSubscription(...args),
  subscribePush: (...args: unknown[]) => mockSubscribePush(...args),
  unsubscribePush: (...args: unknown[]) => mockUnsubscribePush(...args),
}));

vi.mock('@/lib/services/api', () => ({
  fetchMatchAlertSettings: (...args: unknown[]) => mockFetchMatchAlertSettings(...args),
  persistMatchAlertSettings: (...args: unknown[]) => mockPersistMatchAlertSettings(...args),
  fetchConditionAlertPresets: (...args: unknown[]) => mockFetchConditionAlertPresets(...args),
  persistConditionAlertPresets: (...args: unknown[]) => mockPersistConditionAlertPresets(...args),
  resetConditionAlertPresets: (...args: unknown[]) => mockResetConditionAlertPresets(...args),
}));

const baseUser = {
  userId: 'user-1',
  email: 'user@example.com',
  role: 'admin',
  status: 'active',
  name: 'User Example',
  displayName: 'User Example',
  picture: '',
  avatarUrl: '',
};

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  pushSupported = false;
  notificationPermission = 'default';
  mockFetchMonitorConfig.mockResolvedValue({
    UI_LANGUAGE: 'vi',
    TELEGRAM_ENABLED: true,
    WEB_PUSH_ENABLED: false,
    NOTIFICATION_LANGUAGE: 'vi',
    USER_TIMEZONE: 'Asia/Seoul',
    USER_TIMEZONE_CONFIRMED: true,
    AUTO_APPLY_RECOMMENDED_CONDITION: true,
  });
  mockPersistMonitorConfig.mockResolvedValue(undefined);
  mockFetchNotificationChannels.mockResolvedValue([
    {
      channelType: 'telegram',
      enabled: true,
      status: 'pending',
      address: '123456',
      config: {},
      metadata: { senderImplemented: true },
    },
    {
      channelType: 'email',
      enabled: false,
      status: 'draft',
      address: 'user@example.com',
      config: {},
      metadata: { senderImplemented: false },
    },
    {
      channelType: 'zalo',
      enabled: false,
      status: 'draft',
      address: null,
      config: {},
      metadata: { senderImplemented: false },
    },
  ]);
  mockPersistNotificationChannel.mockImplementation(async (channelType: string, patch: Record<string, unknown>) => ({
    channelType,
    enabled: patch.enabled ?? true,
    status: 'pending',
    address: typeof patch.address === 'string' ? patch.address : channelType === 'telegram' ? '123456' : null,
    config: {},
    metadata: {},
  }));
  mockFetchMatchAlertSettings.mockResolvedValue({
    matchStartEnabled: true,
    manualMatchStartEnabled: true,
    favoriteTeamMatchStartEnabled: false,
    favoriteLeagueMatchStartEnabled: false,
    conditionAlertsEnabled: true,
    favoriteTeamConditionAlertsEnabled: false,
    favoriteLeagueConditionAlertsEnabled: false,
    kickoffLeadMinutes: 0,
    defaultCooldownMinutes: 10,
    channelPolicy: {},
  });
  mockPersistMatchAlertSettings.mockImplementation(async (_config: string, patch: Record<string, unknown>) => ({
    matchStartEnabled: true,
    manualMatchStartEnabled: true,
    favoriteTeamMatchStartEnabled: false,
    favoriteLeagueMatchStartEnabled: false,
    conditionAlertsEnabled: true,
    favoriteTeamConditionAlertsEnabled: false,
    favoriteLeagueConditionAlertsEnabled: false,
    kickoffLeadMinutes: 0,
    defaultCooldownMinutes: 10,
    channelPolicy: {},
    ...patch,
  }));
  mockFetchConditionAlertPresets.mockResolvedValue([
    {
      id: 'away_scores_first',
      label: 'Away scores first',
      labelVi: 'Away scores first',
      description: 'Momentum flip.',
      category: 'big_event',
      enabled: true,
      defaultCooldownMinutes: 0,
      defaultOncePerMatch: true,
      sortOrder: 10,
      ruleJson: { id: 'away_scores_first' },
      source: 'system',
    },
    {
      id: 'red_card',
      label: 'Red card',
      labelVi: 'Red card',
      description: 'Major live-state change.',
      category: 'big_event',
      enabled: true,
      defaultCooldownMinutes: 0,
      defaultOncePerMatch: false,
      sortOrder: 20,
      ruleJson: { id: 'red_card' },
      source: 'system',
    },
  ]);
  mockPersistConditionAlertPresets.mockImplementation(async (_config: string, presets: unknown[]) => presets.map((preset) => ({
    label: 'Preset',
    labelVi: 'Preset',
    description: '',
    category: 'big_event',
    defaultOncePerMatch: true,
    sortOrder: 10,
    source: 'user',
    ...(preset as Record<string, unknown>),
  })));
  mockResetConditionAlertPresets.mockImplementation(async () => mockFetchConditionAlertPresets());
  mockGetExistingSubscription.mockResolvedValue(null);
  mockRequestNotificationPermission.mockResolvedValue('granted');
  mockSubscribePush.mockResolvedValue(undefined);
  mockUnsubscribePush.mockResolvedValue(undefined);
});

describe('ProfileEditModal', () => {
  it('saves display name and returns the updated auth user to the caller', async () => {
    const user = userEvent.setup();
    const handleUserChange = vi.fn();
    mockUpdateCurrentUserProfile.mockResolvedValue({
      ...baseUser,
      name: 'Thi Nguyen',
      displayName: 'Thi Nguyen',
    });

    render(
      <ProfileEditModal
        open
        onClose={() => {}}
        user={baseUser}
        onUserChange={handleUserChange}
      />,
    );

    const input = await screen.findByDisplayValue('User Example');
    fireEvent.change(input, { target: { value: 'Thi Nguyen' } });
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockUpdateCurrentUserProfile).toHaveBeenCalledWith({ displayName: 'Thi Nguyen' });
    });
    expect(handleUserChange).toHaveBeenCalledWith(expect.objectContaining({
      displayName: 'Thi Nguyen',
      name: 'Thi Nguyen',
    }));
    expect(mockShowToast).toHaveBeenCalledWith('Profile updated', 'success');
  });

  it('disables Save when display name is unchanged', async () => {
    render(
      <ProfileEditModal
        open
        onClose={() => {}}
        user={baseUser}
      />,
    );

    expect(await screen.findByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.queryByText('Account Info')).not.toBeInTheDocument();
    expect(screen.getByText('Photo from Google sign-in')).toBeInTheDocument();
  });

  it('restores the last opened profile tab from session storage', async () => {
    sessionStorage.setItem('profile-edit-active-tab', 'watchlist');
    const user = userEvent.setup();

    render(
      <ProfileEditModal
        open
        onClose={() => {}}
        user={baseUser}
      />,
    );

    expect(await screen.findByText(/Bulk add by favorite leagues is on the Matches tab/i)).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Profile' }));
    expect(sessionStorage.getItem('profile-edit-active-tab')).toBe('identity');
  });

  it('shows notification channel summary chips on the notifications tab', async () => {
    const user = userEvent.setup();

    render(
      <ProfileEditModal
        open
        onClose={() => {}}
        user={baseUser}
      />,
    );

    await user.click(await screen.findByRole('tab', { name: 'Notifications' }));
    expect(await screen.findByLabelText('Notification channel status')).toBeInTheDocument();
    expect(screen.getByText(/Telegram · Ready/i)).toBeInTheDocument();
  });

  it('lets the user update Telegram delivery data from the profile modal', async () => {
    const user = userEvent.setup();

    render(
      <ProfileEditModal
        open
        onClose={() => {}}
        user={baseUser}
      />,
    );

    await user.click(await screen.findByRole('tab', { name: 'Notifications' }));
    const chatIdInput = await screen.findByDisplayValue('123456');
    await user.clear(chatIdInput);
    await user.type(chatIdInput, '987654');
    await user.click(screen.getByRole('button', { name: 'Save Chat ID' }));

    await waitFor(() => {
      expect(mockPersistNotificationChannel).toHaveBeenCalledWith('telegram', { address: '987654' });
    });
    expect(mockShowToast).toHaveBeenCalledWith('Telegram target saved', 'success');
  });

  it('lets the user configure condition alert presets from profile notifications', async () => {
    const user = userEvent.setup();

    render(
      <ProfileEditModal
        open
        onClose={() => {}}
        user={baseUser}
      />,
    );

    await user.click(await screen.findByRole('tab', { name: 'Notifications' }));
    await user.click(await screen.findByText('Condition alert presets'));
    await user.click(screen.getByLabelText('Toggle Red card'));
    await user.selectOptions(screen.getByLabelText('Away scores first cooldown'), '10');
    await user.click(screen.getByRole('button', { name: 'Save presets' }));

    await waitFor(() => {
      expect(mockPersistConditionAlertPresets).toHaveBeenCalledWith('', expect.arrayContaining([
        expect.objectContaining({ id: 'away_scores_first', defaultCooldownMinutes: 10 }),
        expect.objectContaining({ id: 'red_card', enabled: false }),
      ]));
    });
    expect(mockShowToast).toHaveBeenCalledWith('Condition alert presets saved', 'success');
  });
});
