import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockShowToast = vi.fn();
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

vi.mock('@/hooks/useAppState', () => ({
  useAppState: () => ({
    state: {
      config: { apiUrl: 'http://localhost:4000', defaultMode: 'B' },
    },
  }),
}));

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

vi.mock('@/components/AuditLogsPanel', () => ({ AuditLogsPanel: () => null }));
vi.mock('@/components/IntegrationHealthPanel', () => ({ IntegrationHealthPanel: () => null }));
vi.mock('@/components/OpsMonitoringPanel', () => ({ OpsMonitoringPanel: () => null }));

const { SettingsTab } = await import('./SettingsTab');

beforeEach(() => {
  vi.clearAllMocks();
  pushSupported = false;
  notificationPermission = 'default';
  mockFetchMonitorConfig.mockResolvedValue({
    UI_LANGUAGE: 'vi',
    TELEGRAM_ENABLED: true,
    WEB_PUSH_ENABLED: false,
    NOTIFICATION_LANGUAGE: 'vi',
    AUTO_APPLY_RECOMMENDED_CONDITION: true,
  });
  mockPersistMonitorConfig.mockResolvedValue(undefined);
  mockRequestNotificationPermission.mockResolvedValue('granted');
  mockGetExistingSubscription.mockResolvedValue(null);
  mockSubscribePush.mockResolvedValue(undefined);
  mockUnsubscribePush.mockResolvedValue(undefined);
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
      channelType: 'zalo',
      enabled: false,
      status: 'draft',
      address: null,
      config: {},
      metadata: { senderImplemented: false },
    },
    {
      channelType: 'web_push',
      enabled: false,
      status: 'draft',
      address: null,
      config: {},
      metadata: { senderImplemented: true },
    },
    {
      channelType: 'email',
      enabled: false,
      status: 'draft',
      address: null,
      config: {},
      metadata: { senderImplemented: false },
    },
  ]);
  mockPersistNotificationChannel.mockRejectedValue(new Error('channel save failed'));
});

describe('SettingsTab', () => {
  it('shows setup required when Telegram is enabled without a saved chat id', async () => {
    mockFetchNotificationChannels.mockResolvedValueOnce([
      {
        channelType: 'telegram',
        enabled: false,
        status: 'draft',
        address: null,
        config: {},
        metadata: { senderImplemented: true },
      },
      {
        channelType: 'zalo',
        enabled: false,
        status: 'draft',
        address: null,
        config: {},
        metadata: { senderImplemented: false },
      },
      {
        channelType: 'web_push',
        enabled: false,
        status: 'draft',
        address: null,
        config: {},
        metadata: { senderImplemented: true },
      },
      {
        channelType: 'email',
        enabled: false,
        status: 'draft',
        address: null,
        config: {},
        metadata: { senderImplemented: false },
      },
    ]);

    render(<SettingsTab />);

    expect(await screen.findByText('Setup required')).toBeInTheDocument();
    expect(screen.getByText('Add a Telegram chat ID in Channel Registry before alerts can be delivered.')).toBeInTheDocument();
  });

  it('shows setup required when Web Push is enabled without an active browser subscription', async () => {
    pushSupported = true;
    notificationPermission = 'granted';
    mockFetchMonitorConfig.mockResolvedValueOnce({
      UI_LANGUAGE: 'vi',
      TELEGRAM_ENABLED: true,
      WEB_PUSH_ENABLED: true,
      NOTIFICATION_LANGUAGE: 'vi',
      AUTO_APPLY_RECOMMENDED_CONDITION: true,
    });

    render(<SettingsTab />);

    expect(await screen.findByText('Setup required')).toBeInTheDocument();
    expect(screen.getByText('Notifications are enabled, but this browser still needs an active push subscription.')).toBeInTheDocument();
    const webPushToggle = await screen.findByRole('button', { name: 'Toggle Web Push notifications' });
    expect(webPushToggle).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows blocked when browser permission denies Web Push', async () => {
    pushSupported = true;
    notificationPermission = 'denied';
    mockFetchMonitorConfig.mockResolvedValueOnce({
      UI_LANGUAGE: 'vi',
      TELEGRAM_ENABLED: true,
      WEB_PUSH_ENABLED: true,
      NOTIFICATION_LANGUAGE: 'vi',
      AUTO_APPLY_RECOMMENDED_CONDITION: true,
    });

    render(<SettingsTab />);

    expect(await screen.findByText('Blocked')).toBeInTheDocument();
    expect(screen.getByText('Blocked by browser — allow notifications in site settings to enable delivery.')).toBeInTheDocument();
  });

  it('shows ready when Web Push is enabled and this browser already has a subscription', async () => {
    pushSupported = true;
    notificationPermission = 'granted';
    mockGetExistingSubscription.mockResolvedValueOnce({ endpoint: 'https://push.example/sub-1' });
    mockFetchNotificationChannels.mockResolvedValueOnce([
      {
        channelType: 'telegram',
        enabled: true,
        status: 'pending',
        address: '123456',
        config: {},
        metadata: { senderImplemented: true },
      },
      {
        channelType: 'zalo',
        enabled: false,
        status: 'draft',
        address: null,
        config: {},
        metadata: { senderImplemented: false },
      },
      {
        channelType: 'web_push',
        enabled: true,
        status: 'pending',
        address: null,
        config: {},
        metadata: { senderImplemented: true, setupState: 'requires_browser_subscription' },
      },
      {
        channelType: 'email',
        enabled: false,
        status: 'draft',
        address: null,
        config: {},
        metadata: { senderImplemented: false },
      },
    ]);
    mockFetchMonitorConfig.mockResolvedValueOnce({
      UI_LANGUAGE: 'vi',
      TELEGRAM_ENABLED: true,
      WEB_PUSH_ENABLED: true,
      NOTIFICATION_LANGUAGE: 'vi',
      AUTO_APPLY_RECOMMENDED_CONDITION: true,
    });

    render(<SettingsTab />);

    expect(await screen.findByText('Ready')).toBeInTheDocument();
    expect(screen.getByText('This browser is subscribed and ready to receive alerts.')).toBeInTheDocument();
    const webPushToggle = await screen.findByRole('button', { name: 'Toggle Web Push notifications' });
    expect(webPushToggle).toHaveAttribute('aria-pressed', 'true');
  });

  it('rolls back Telegram toggle when channel persistence fails', async () => {
    const user = userEvent.setup();
    render(<SettingsTab />);

    const telegramToggle = await screen.findByRole('button', { name: 'Toggle Telegram notifications' });
    await waitFor(() => expect(telegramToggle).toHaveAttribute('aria-pressed', 'true'));

    await user.click(telegramToggle);

    await waitFor(() => {
      expect(mockPersistMonitorConfig).toHaveBeenNthCalledWith(1, { TELEGRAM_ENABLED: false });
      expect(mockPersistMonitorConfig).toHaveBeenNthCalledWith(2, { TELEGRAM_ENABLED: true });
    });
    expect(mockPersistNotificationChannel).toHaveBeenCalledWith('telegram', { enabled: false });
    expect(mockShowToast).toHaveBeenCalledWith('Failed to save Telegram setting', 'error');
    expect(mockShowToast).not.toHaveBeenCalledWith('Telegram disabled', 'success');
    expect(telegramToggle).toHaveAttribute('aria-pressed', 'true');
  });
});