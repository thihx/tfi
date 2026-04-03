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
const mockFetch = vi.fn();
let pushSupported = false;
let notificationPermission: NotificationPermission = 'default';

vi.mock('@/lib/services/auth', () => ({
  getToken: () => 'test-token',
  getUser: () => ({
    userId: 'admin-1',
    email: 'admin@example.com',
    role: 'admin',
    name: 'Admin',
    picture: '',
  }),
  fetchCurrentUser: vi.fn().mockResolvedValue({
    userId: 'admin-1',
    email: 'admin@example.com',
    role: 'admin',
    name: 'Admin',
    picture: '',
  }),
}));

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
  vi.stubGlobal('fetch', mockFetch);
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
  mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/settings/users/member-1')) {
      return new Response(JSON.stringify({
        id: 'member-1',
        email: 'member@example.com',
        display_name: 'Member User',
        avatar_url: '',
        role: 'admin',
        status: 'disabled',
        created_at: '2026-03-24T00:00:00.000Z',
        updated_at: '2026-03-31T10:10:00.000Z',
      }), { status: 200 });
    }

    if (url.includes('/api/settings/subscription/catalog')) {
      return new Response(JSON.stringify({
        catalog: [
          {
            key: 'ai.manual.ask.daily_limit',
            label: 'Manual AI daily limit',
            description: 'How many manual Ask AI requests the user may run per day.',
            category: 'ai',
            valueType: 'number',
            defaultValue: 3,
            enforced: true,
          },
        ],
      }), { status: 200 });
    }

    if (url.includes('/api/settings/subscription/plans/free')) {
      return new Response(JSON.stringify({
        plan_code: 'free',
        display_name: 'Free',
        description: 'Entry plan',
        billing_interval: 'manual',
        price_amount: '0.00',
        currency: 'USD',
        active: true,
        public: true,
        display_order: 0,
        entitlements: { 'ai.manual.ask.daily_limit': 4 },
        metadata: {},
        created_at: '2026-03-31T10:00:00.000Z',
        updated_at: '2026-03-31T10:05:00.000Z',
      }), { status: 200 });
    }

    if (url.includes('/api/settings/subscription/plans')) {
      return new Response(JSON.stringify([
        {
          plan_code: 'free',
          display_name: 'Free',
          description: 'Entry plan',
          billing_interval: 'manual',
          price_amount: '0.00',
          currency: 'USD',
          active: true,
          public: true,
          display_order: 0,
          entitlements: { 'ai.manual.ask.daily_limit': 3, 'watchlist.active_matches.limit': 5 },
          metadata: {},
          created_at: '2026-03-31T10:00:00.000Z',
          updated_at: '2026-03-31T10:00:00.000Z',
        },
        {
          plan_code: 'pro',
          display_name: 'Pro',
          description: 'Paid plan',
          billing_interval: 'month',
          price_amount: '29.00',
          currency: 'USD',
          active: true,
          public: true,
          display_order: 1,
          entitlements: { 'ai.manual.ask.daily_limit': 20, 'watchlist.active_matches.limit': 30 },
          metadata: {},
          created_at: '2026-03-31T10:00:00.000Z',
          updated_at: '2026-03-31T10:00:00.000Z',
        },
      ]), { status: 200 });
    }

    if (url.includes('/api/settings/subscription/users/admin-1')) {
      return new Response(JSON.stringify({
        id: 7,
        user_id: 'admin-1',
        plan_code: 'pro',
        status: 'active',
        provider: 'manual',
        provider_customer_id: null,
        provider_subscription_id: null,
        started_at: '2026-03-31T10:00:00.000Z',
        current_period_start: '2026-03-31T10:00:00.000Z',
        current_period_end: '2026-04-30T00:00:00.000Z',
        trial_ends_at: null,
        cancel_at_period_end: false,
        metadata: {},
        created_at: '2026-03-31T10:00:00.000Z',
        updated_at: '2026-03-31T10:05:00.000Z',
      }), { status: 200 });
    }

    if (url.includes('/api/settings/subscription/users')) {
      return new Response(JSON.stringify([
        {
          id: 'admin-1',
          email: 'admin@example.com',
          display_name: 'Admin User',
          avatar_url: '',
          role: 'admin',
          status: 'active',
          created_at: '2026-03-24T00:00:00.000Z',
          updated_at: '2026-03-31T10:00:00.000Z',
          subscription_plan_code: 'free',
          subscription_status: 'active',
          subscription_provider: 'manual',
          subscription_current_period_end: null,
          subscription_cancel_at_period_end: false,
          subscription_updated_at: '2026-03-31T10:00:00.000Z',
        },
      ]), { status: 200 });
    }

    if (url.includes('/api/settings/users')) {
      return new Response(JSON.stringify([
        {
          id: 'owner-1',
          email: 'owner@example.com',
          display_name: 'Owner User',
          avatar_url: '',
          role: 'owner',
          status: 'active',
          created_at: '2026-03-24T00:00:00.000Z',
          updated_at: '2026-03-31T10:00:00.000Z',
        },
        {
          id: 'admin-1',
          email: 'admin@example.com',
          display_name: 'Admin User',
          avatar_url: '',
          role: 'admin',
          status: 'active',
          created_at: '2026-03-24T00:00:00.000Z',
          updated_at: '2026-03-31T10:00:00.000Z',
        },
        {
          id: 'member-1',
          email: 'member@example.com',
          display_name: 'Member User',
          avatar_url: '',
          role: 'member',
          status: 'active',
          created_at: '2026-03-24T00:00:00.000Z',
          updated_at: '2026-03-31T10:00:00.000Z',
        },
      ]), { status: 200 });
    }

    if (url.includes('/api/jobs/runs')) {
      return new Response(JSON.stringify({
        jobName: 'refresh-live-matches',
        windowHours: 24,
        runs: [
          {
            id: 101,
            job_name: 'refresh-live-matches',
            scheduled_at: '2026-03-31T09:59:55.000Z',
            started_at: '2026-03-31T10:00:00.000Z',
            completed_at: '2026-03-31T10:00:04.000Z',
            status: 'success',
            skip_reason: null,
            lock_policy: 'strict',
            degraded_locking: false,
            instance_id: 'tfi-app-1',
            lag_ms: 900,
            duration_ms: 4000,
            error: null,
            summary: { refreshed: 2 },
            created_at: '2026-03-31T10:00:04.000Z',
          },
          {
            id: 100,
            job_name: 'refresh-live-matches',
            scheduled_at: '2026-03-31T09:54:55.000Z',
            started_at: '2026-03-31T09:55:00.000Z',
            completed_at: '2026-03-31T09:55:06.000Z',
            status: 'failure',
            skip_reason: null,
            lock_policy: 'strict',
            degraded_locking: false,
            instance_id: 'tfi-app-1',
            lag_ms: 1200,
            duration_ms: 6000,
            error: 'Provider timeout',
            summary: {},
            created_at: '2026-03-31T09:55:06.000Z',
          },
        ],
        overview: [],
      }), { status: 200 });
    }

    if (url.includes('/api/jobs')) {
      return new Response(JSON.stringify([
        {
          name: 'refresh-live-matches',
          intervalMs: 5000,
          lastRun: '2026-03-31T10:00:04.000Z',
          lastStartedAt: '2026-03-31T10:00:00.000Z',
          lastCompletedAt: '2026-03-31T10:00:04.000Z',
          lastHeartbeatAt: '2026-03-31T10:00:02.000Z',
          lastDurationMs: 4000,
          lastLagMs: 900,
          lastError: null,
          running: false,
          enabled: true,
          runCount: 124,
          progress: null,
          concurrency: 1,
          activeRuns: 0,
          pendingRuns: 0,
          lockPolicy: 'strict',
          degradedLocking: false,
          history24h: {
            jobName: 'refresh-live-matches',
            totalRuns: 120,
            successRuns: 118,
            failureRuns: 1,
            skippedRuns: 1,
            degradedRuns: 0,
            avgLagMs: 950,
            avgDurationMs: 4200,
            lastStartedAt: '2026-03-31T10:00:00.000Z',
            lastCompletedAt: '2026-03-31T10:00:04.000Z',
            lastStatus: 'success',
          },
        },
      ]), { status: 200 });
    }

    return new Response('{}', { status: 404 });
  });
});

describe('SettingsTab', () => {
  it('defaults to Scheduler and removes the self-service General tab', async () => {
    render(<SettingsTab />);

    expect(screen.queryByRole('button', { name: 'General' })).not.toBeInTheDocument();
    expect(await screen.findByText('Refresh Live Matches')).toBeInTheDocument();
  });

  it('shows subscription management on the system tab for admins', async () => {
    const user = userEvent.setup();
    render(<SettingsTab />);

    await user.click(await screen.findByRole('button', { name: 'Subscription Management' }));

    expect(await screen.findByText('Subscription Plans')).toBeInTheDocument();
    expect(await screen.findByText('User Subscriptions')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search by name or email')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'All plans' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'All statuses' })).toBeInTheDocument();
    expect(screen.getByText(/Plans are commercial access tiers, separate from internal roles\./)).toBeInTheDocument();
  });

  it('saves subscription period end from local datetime input as UTC', async () => {
    const user = userEvent.setup();
    render(<SettingsTab />);

    await user.click(await screen.findByRole('button', { name: 'Subscription Management' }));

    const periodInput = await screen.findByLabelText('Period End for admin@example.com');
    await user.type(periodInput, '2026-04-30T09:00');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/settings/subscription/users/admin-1'),
        expect.objectContaining({
          method: 'PUT',
          credentials: 'include',
          body: JSON.stringify({
            planCode: 'free',
            status: 'active',
            currentPeriodEnd: new Date('2026-04-30T09:00').toISOString(),
            cancelAtPeriodEnd: false,
          }),
        }),
      );
    });
  });

  it.skip('shows blocked when browser permission denies Web Push', async () => {
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

  it.skip('shows ready when Web Push is enabled and this browser already has a subscription', async () => {
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

  it.skip('rolls back Telegram toggle when channel persistence fails', async () => {
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

  it('shows scheduler 24h summary and recent run history', async () => {
    const user = userEvent.setup();
    render(<SettingsTab />);

    await user.click(screen.getByRole('button', { name: 'Scheduler' }));

    expect(await screen.findByText('Refresh Live Matches')).toBeInTheDocument();
    expect(screen.getByText('24h 118 ok / 1 fail / 1 skipped')).toBeInTheDocument();
    expect(screen.getByText('Avg lag 950 ms')).toBeInTheDocument();
    expect(screen.getByText('Avg duration 4.2 s')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Recent Runs' }));

    expect(await screen.findByText('Latest 8 runs from the last 24 hours')).toBeInTheDocument();
    expect(screen.getByText('Provider timeout')).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/jobs/runs?jobName=refresh-live-matches&limit=8&hours=24'),
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('lets admins update a member role and status from the System tab', async () => {
    const user = userEvent.setup();
    render(<SettingsTab />);

    await user.click(screen.getByRole('button', { name: 'User Management' }));

    expect(await screen.findByText('User Management')).toBeInTheDocument();
    expect(await screen.findByText('Member User')).toBeInTheDocument();
    expect(screen.getByText(/Manage user role and login access\./)).toBeInTheDocument();
    expect(await screen.findByLabelText('Status for member@example.com')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Role for member@example.com'), 'admin');
    await user.selectOptions(screen.getByLabelText('Status for member@example.com'), 'disabled');
    const saveButtons = screen.getAllByRole('button', { name: 'Save' });
    await user.click(saveButtons.find((button) => !button.hasAttribute('disabled')) ?? saveButtons[0]!);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/settings/users/member-1'),
        expect.objectContaining({
          method: 'PATCH',
          credentials: 'include',
          body: JSON.stringify({ role: 'admin', status: 'disabled' }),
        }),
      );
    });
    expect(mockShowToast).toHaveBeenCalledWith('Updated member@example.com', 'success');
  });
});
