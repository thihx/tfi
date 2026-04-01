import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfileEditModal } from './ProfileEditModal';

const mockShowToast = vi.fn();
const mockUpdateCurrentUserProfile = vi.fn();
const mockFetchMonitorConfig = vi.fn();
const mockPersistMonitorConfig = vi.fn();
const mockFetchNotificationChannels = vi.fn();
const mockPersistNotificationChannel = vi.fn();
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

vi.mock('@/lib/services/notification-channels', () => ({
  fetchNotificationChannels: (...args: unknown[]) => mockFetchNotificationChannels(...args),
  persistNotificationChannel: (...args: unknown[]) => mockPersistNotificationChannel(...args),
}));

vi.mock('@/lib/services/push', () => ({
  isPushSupported: () => pushSupported,
  getNotificationPermission: () => notificationPermission,
  requestNotificationPermission: (...args: unknown[]) => mockRequestNotificationPermission(...args),
  getExistingSubscription: (...args: unknown[]) => mockGetExistingSubscription(...args),
  subscribePush: (...args: unknown[]) => mockSubscribePush(...args),
  unsubscribePush: (...args: unknown[]) => mockUnsubscribePush(...args),
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
    await user.clear(input);
    await user.type(input, 'Thi Nguyen');
    await user.click(screen.getByRole('button', { name: 'Save Profile' }));

    await waitFor(() => {
      expect(mockUpdateCurrentUserProfile).toHaveBeenCalledWith({ displayName: 'Thi Nguyen' });
    });
    expect(handleUserChange).toHaveBeenCalledWith(expect.objectContaining({
      displayName: 'Thi Nguyen',
      name: 'Thi Nguyen',
    }));
    expect(mockShowToast).toHaveBeenCalledWith('Profile updated', 'success');
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

    const chatIdInput = await screen.findByDisplayValue('123456');
    await user.clear(chatIdInput);
    await user.type(chatIdInput, '987654');
    await user.click(screen.getByRole('button', { name: 'Save Chat ID' }));

    await waitFor(() => {
      expect(mockPersistNotificationChannel).toHaveBeenCalledWith('telegram', { address: '987654' });
    });
    expect(mockShowToast).toHaveBeenCalledWith('Telegram target saved', 'success');
  });
});
