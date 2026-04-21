import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const authState = vi.hoisted(() => ({
  currentUser: {
    userId: 'admin-1',
    email: 'admin@example.com',
    role: 'admin' as 'admin' | 'owner',
    name: 'Admin',
    picture: '',
  },
}));

const mockFetchMonitorConfig = vi.fn();

vi.mock('@/lib/services/auth', () => ({
  getToken: () => 'test-token',
  getUser: () => authState.currentUser,
  fetchCurrentUser: vi.fn().mockImplementation(async () => authState.currentUser),
}));

vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
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
  persistMonitorConfig: vi.fn(),
}));

vi.mock('@/lib/services/notification-channels', () => ({
  fetchNotificationChannels: vi.fn().mockResolvedValue([]),
  persistNotificationChannel: vi.fn(),
}));

vi.mock('@/lib/services/push', () => ({
  isPushSupported: () => false,
  getNotificationPermission: () => 'default',
  requestNotificationPermission: vi.fn(),
  getExistingSubscription: vi.fn().mockResolvedValue(null),
  subscribePush: vi.fn(),
  unsubscribePush: vi.fn(),
}));

vi.mock('@/components/AuditLogsPanel', () => ({ AuditLogsPanel: () => null }));
vi.mock('@/components/IntegrationHealthPanel', () => ({ IntegrationHealthPanel: () => null }));
vi.mock('@/components/OpsMonitoringPanel', () => ({ OpsMonitoringPanel: () => null }));
vi.mock('@/components/RecommendationStudioPanel', () => ({
  RecommendationStudioPanel: () => <div>Recommendation Studio Panel Loaded</div>,
}));

const { SettingsTab } = await import('./SettingsTab');

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchMonitorConfig.mockResolvedValue({
    UI_LANGUAGE: 'vi',
    TELEGRAM_ENABLED: true,
    WEB_PUSH_ENABLED: false,
    NOTIFICATION_LANGUAGE: 'vi',
    AUTO_APPLY_RECOMMENDED_CONDITION: true,
  });
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/jobs')) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (url.includes('/api/settings/users')) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (url.includes('/api/settings/subscription')) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  }));
});

describe('SettingsTab Recommendation Studio', () => {
  test('shows the Recommendation Studio settings tab for admins', async () => {
    authState.currentUser = {
      userId: 'admin-1',
      email: 'admin@example.com',
      role: 'admin',
      name: 'Admin',
      picture: '',
    };
    const user = userEvent.setup();

    render(<SettingsTab />);

    const tab = await screen.findByRole('tab', { name: 'Recommendation Studio' });
    expect(tab).toBeInTheDocument();

    await user.click(tab);
    expect(await screen.findByText('Recommendation Studio Panel Loaded')).toBeInTheDocument();
  });

  test('hides the Recommendation Studio settings tab for owners', async () => {
    authState.currentUser = {
      userId: 'owner-1',
      email: 'owner@example.com',
      role: 'owner',
      name: 'Owner',
      picture: '',
    };

    render(<SettingsTab />);

    await waitFor(() => {
      expect(screen.queryByRole('tab', { name: 'Recommendation Studio' })).not.toBeInTheDocument();
    });
  });
});
