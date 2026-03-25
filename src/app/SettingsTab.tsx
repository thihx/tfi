import { useState, useEffect, useCallback, useRef } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useToast } from '@/hooks/useToast';
import { formatLocalDateTime } from '@/lib/utils/helpers';
import { AuditLogsPanel } from '@/components/AuditLogsPanel';
import { IntegrationHealthPanel } from '@/components/IntegrationHealthPanel';
import { OpsMonitoringPanel } from '@/components/OpsMonitoringPanel';
import { getToken } from '@/lib/services/auth';
import { fetchMonitorConfig, persistMonitorConfig } from '@/features/live-monitor/config';
import type { LiveMonitorConfig } from '@/features/live-monitor/types';
import { fetchNotificationChannels, persistNotificationChannel } from '@/lib/services/notification-channels';
import {
  isPushSupported,
  getNotificationPermission,
  requestNotificationPermission,
  getExistingSubscription,
  subscribePush,
  unsubscribePush,
} from '@/lib/services/push';
import type { NotificationChannelConfig, NotificationChannelType } from '@/types';

function authHeaders(): Record<string, string> {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

interface JobProgress {
  step: string;
  message: string;
  percent: number;
  startedAt: string;
  completedAt: string | null;
  result: string | null;
  error: string | null;
}

interface JobInfo {
  name: string;
  label?: string;
  description?: string;
  group?: string;
  entityScopes?: string[];
  order?: number;
  intervalMs: number;
  lastRun: string | null;
  lastError: string | null;
  running: boolean;
  enabled: boolean;
  runCount: number;
  progress: JobProgress | null;
  concurrency: number;
  activeRuns: number;
  pendingRuns: number;
}

const INTERVAL_OPTIONS = [
  { label: 'Disabled', value: 0 },
  { label: 'Every 1 min', value: 60_000 },
  { label: 'Every 2 min', value: 120_000 },
  { label: 'Every 5 min', value: 300_000 },
  { label: 'Every 10 min', value: 600_000 },
  { label: 'Every 15 min', value: 900_000 },
  { label: 'Every 30 min', value: 1_800_000 },
  { label: 'Every 60 min', value: 3_600_000 },
  { label: 'Every 6 hours', value: 21_600_000 },
  { label: 'Every 12 hours', value: 43_200_000 },
  { label: 'Every 24 hours', value: 86_400_000 },
];

const JOB_META: Record<string, { label: string; description: string; order: number }> = {
  'fetch-matches': {
    label: 'Fetch Matches',
    description: 'Fetches fixtures from Football API for active leagues, archives finished matches, and auto-adds top league NS matches to watchlist.',
    order: 1,
  },
  'integration-health': {
    label: 'Integration Health',
    description: 'Probes all external services (DB, Redis, APIs, Telegram) and sends Telegram alert when a service goes down or recovers.',
    order: 8,
  },
  'sync-reference-data': {
    label: 'Sync Reference Data',
    description: 'Refreshes low-churn provider-backed reference entities into TFI local storage. Current scope is league-team directory snapshots; later this can expand to more reference entities without changing the job name.',
    order: 2,
  },
  'enrich-watchlist': {
    label: 'Enrich Watchlist',
    description: 'Uses AI and web search to add strategic context and generate recommended conditions for watchlist entries.',
    order: 3,
  },
  'update-predictions': {
    label: 'Update Predictions',
    description: 'Fetches prediction data from Football API for all upcoming (NS) watchlist matches.',
    order: 4,
  },
  'check-live-trigger': {
    label: 'Check Live Matches',
    description: 'Detects currently live watchlist matches, triggers the AI analysis pipeline, and increments their check counters.',
    order: 5,
  },
  'auto-settle': {
    label: 'Auto Settle',
    description: 'Settles pending recommendations and bets using final match scores from history or Football API.',
    order: 6,
  },
  'expire-watchlist': {
    label: 'Expire Watchlist',
    description: 'Removes completed watchlist entries when kickoff time + 120 minutes has passed.',
    order: 7,
  },
  'purge-audit': {
    label: 'Purge Audit Logs',
    description: 'Deletes audit log entries older than the configured retention period (default: 30 days) to manage database growth.',
    order: 8,
  },
  'health-watchdog': {
    label: 'Health Watchdog',
    description: 'Monitors all critical business jobs and sends Telegram alert when a job becomes overdue or recovers.',
    order: 10,
  },
};

function JobSchedulerPanel() {
  const { state } = useAppState();
  const { showToast } = useToast();
  const [jobs, setJobs] = useState<JobInfo[]>([]);
  const [triggering, setTriggering] = useState<Set<string>>(new Set());
  const apiUrl = state.config.apiUrl;
  const hasRunningJob = jobs.some((j) => j.running);

  const fetchJobs = useCallback(async () => {
    if (apiUrl == null) return;
    try {
      const res = await fetch(`${apiUrl}/api/jobs`, { headers: authHeaders(), credentials: 'include' });
      if (res.ok) setJobs(await res.json());
    } catch { /* server offline */ }
  }, [apiUrl]);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    fetchJobs();
    const ms = hasRunningJob ? 2000 : 5000;
    intervalRef.current = setInterval(fetchJobs, ms);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchJobs, hasRunningJob]);

  const handleIntervalChange = async (name: string, intervalMs: number) => {
    const meta = JOB_META[name];
    const label = meta?.label || name;
    try {
      const res = await fetch(`${apiUrl}/api/jobs/${name}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        credentials: 'include',
        body: JSON.stringify({ intervalMs }),
      });
      if (res.ok) {
        const updated: JobInfo = await res.json();
        setJobs((prev) => prev.map((j) => (j.name === updated.name ? updated : j)));
        showToast(`${label} -> ${intervalMs === 0 ? 'disabled' : `${intervalMs / 1000}s`}`, 'success');
      }
    } catch {
      showToast('Failed to update job', 'error');
    }
  };

  const handleTrigger = async (name: string, force = false) => {
    setTriggering((prev) => new Set(prev).add(name));
    try {
      const res = await fetch(`${apiUrl}/api/jobs/${name}/trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        credentials: 'include',
        body: JSON.stringify(force ? { force: true } : {}),
      });
      if (res.ok) {
        fetchJobs();
      } else if (res.status === 409) {
        showToast('Job is already running', 'error');
      }
    } catch {
      showToast('Failed to trigger job', 'error');
    } finally {
      setTriggering((prev) => {
        const next = new Set(prev);
        next.delete(name);
        return next;
      });
    }
  };

  if (apiUrl == null) {
    return <p style={{ color: 'var(--gray-500)' }}>Backend URL not configured (VITE_API_URL)</p>;
  }

  return (
    <div className="job-scheduler">
      {[...jobs].sort((a, b) => (a.order ?? JOB_META[a.name]?.order ?? 99) - (b.order ?? JOB_META[b.name]?.order ?? 99)).map((job) => {
        const meta = JOB_META[job.name];
        const label = job.label || meta?.label || job.name;
        const description = job.description || meta?.description || '';
        const progress = job.progress;
        const isRunning = job.running;
        const isCompleted = progress?.completedAt && !isRunning;
        const hasError = !!job.lastError || !!progress?.error;
        const percent = progress?.percent ?? 0;
        const isMulti = (job.concurrency ?? 1) > 1;
        const isQueueFull = isMulti && job.activeRuns >= job.concurrency && job.pendingRuns >= job.concurrency;
        const runDisabled = isMulti ? isQueueFull || triggering.has(job.name) : isRunning || triggering.has(job.name);

        let runBtnLabel = 'Run';
        if (triggering.has(job.name)) runBtnLabel = '...';
        else if (isMulti && job.activeRuns >= job.concurrency) runBtnLabel = 'Queue';
        else if (isRunning) runBtnLabel = 'Running...';

        return (
          <div key={job.name} className={`job-card${isRunning ? ' job-running' : ''}${hasError ? ' job-error' : ''}`}>
            <div className="job-header">
              <div className="job-info">
                <div className="job-title-row">
                  <span className="job-label">{label}</span>
                  {isMulti ? (
                    <span className="job-concurrency-badge" title={`Max ${job.concurrency} parallel runs`}>
                      ⚡ ×{job.concurrency}
                      {job.activeRuns > 0 && <span style={{ color: 'var(--warning)' }}> {job.activeRuns}/{job.concurrency}</span>}
                      {job.pendingRuns > 0 && <span style={{ color: 'var(--gray-500)' }}> +{job.pendingRuns} queued</span>}
                    </span>
                  ) : (
                    <span className="job-concurrency-badge job-single" title="Single-threaded">🔒</span>
                  )}
                  <span className="job-meta">
                    {job.lastRun ? `Last run: ${formatLocalDateTime(job.lastRun)}` : 'Never run'}
                    {job.runCount > 0 && <span className="job-run-count"> (#{job.runCount})</span>}
                    {job.lastError && !isRunning && (
                      <span className="job-error-text"> · {job.lastError}</span>
                    )}
                  </span>
                </div>
                <div className="job-description" title={description}>{description}</div>
              </div>
              <div className="job-actions">
                <select
                  value={job.intervalMs}
                  onChange={(e) => handleIntervalChange(job.name, Number(e.target.value))}
                  className="job-interval-select"
                >
                  {INTERVAL_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => handleTrigger(job.name)}
                  disabled={runDisabled}
                >
                  {runBtnLabel}
                </button>
                {job.name === 'enrich-watchlist' && (
                  <button
                    className="btn btn-sm"
                    style={{ marginLeft: 4, background: '#f59e0b', color: '#fff', border: 'none' }}
                    onClick={() => handleTrigger(job.name, true)}
                    disabled={isRunning || triggering.has(job.name)}
                    title="Force re-enrich all entries (ignore 6h cache)"
                  >
                    ⚡ Force
                  </button>
                )}
              </div>
            </div>

            {progress && (isRunning || isCompleted) && (
              <div className="job-progress">
                <div className="job-progress-bar-bg">
                  <div
                    className={`job-progress-bar-fill${hasError ? ' error' : isCompleted ? ' done' : ''}`}
                    style={{ width: `${percent}%` }}
                  />
                </div>
                <div className="job-progress-text">
                  {progress.message}
                  {isRunning && <span className="job-progress-pct"> ({percent}%)</span>}
                </div>
              </div>
            )}
          </div>
        );
      })}
      {jobs.length === 0 && <p style={{ color: 'var(--gray-500)' }}>Connecting to server...</p>}
    </div>
  );
}

// ── Toggle Switch ────────────────────────────────────────────────────────────

function Toggle({
  on,
  onChange,
  disabled,
  label,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      onClick={() => !disabled && onChange(!on)}
      disabled={disabled}
      aria-label={label}
      aria-pressed={on}
      style={{
        width: 40, height: 22, borderRadius: '999px', border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        background: on ? '#2563eb' : 'var(--gray-300)',
        position: 'relative', flexShrink: 0, transition: 'background 0.2s',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span style={{
        position: 'absolute', top: 2,
        left: on ? 20 : 2,
        width: 18, height: 18, borderRadius: '50%',
        background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        transition: 'left 0.2s',
      }} />
    </button>
  );
}

// ── Tab constants ────────────────────────────────────────────────────────────

type SettingsTab = 'general' | 'scheduler' | 'system' | 'audit';

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'general',   label: 'General' },
  { id: 'scheduler', label: 'Scheduler' },
  { id: 'system',    label: 'System' },
  { id: 'audit',     label: 'Audit' },
];

// ── Main component ───────────────────────────────────────────────────────────

export function SettingsTab() {
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [uiLanguage, setUiLanguage] = useState<'en' | 'vi'>('vi');
  const [telegramEnabled, setTelegramEnabled] = useState(false);
  const [notificationLanguage, setNotificationLanguage] = useState<'vi' | 'en' | 'both'>('vi');
  const [autoApplyRecommendedCondition, setAutoApplyRecommendedCondition] = useState(true);
  const [webPushEnabled, setWebPushEnabled] = useState(false);
  const [hasWebPushSubscription, setHasWebPushSubscription] = useState(false);
  const [webPushLoading, setWebPushLoading] = useState(false);
  const [webPushPermission, setWebPushPermission] = useState<NotificationPermission>('default');
  const [notificationChannels, setNotificationChannels] = useState<NotificationChannelConfig[]>([]);
  const [channelAddresses, setChannelAddresses] = useState<Record<string, string>>({});
  const [channelSaving, setChannelSaving] = useState<Record<string, boolean>>({});

  const telegramChannel = notificationChannels.find((channel) => channel.channelType === 'telegram') ?? null;
  const telegramAddress = (channelAddresses['telegram'] ?? telegramChannel?.address ?? '').trim();
  const telegramChannelEnabled = telegramChannel?.enabled === true;
  const telegramReady = telegramEnabled && telegramChannelEnabled && telegramAddress.length > 0;
  const telegramStatusLabel = !telegramEnabled
    ? 'Disabled'
    : !telegramChannelEnabled || telegramAddress.length === 0
      ? 'Setup required'
      : telegramChannel?.status === 'verified'
        ? 'Ready'
        : telegramChannel?.status === 'pending'
          ? 'Pending'
          : 'Ready';
  const telegramStatusColor = !telegramEnabled
    ? 'var(--gray-400)'
    : telegramReady
      ? '#2563eb'
      : '#b45309';
  const telegramCardBorder = !telegramEnabled
    ? 'var(--gray-200)'
    : telegramReady
      ? '#bfdbfe'
      : '#fcd34d';
  const telegramCardBackground = !telegramEnabled
    ? 'var(--gray-50)'
    : telegramReady
      ? '#eff6ff'
      : '#fffbeb';
  const telegramHelperText = !telegramEnabled
    ? 'Telegram delivery is turned off for this user.'
    : telegramAddress.length === 0
      ? 'Add a Telegram chat ID in Channel Registry before alerts can be delivered.'
      : telegramChannel?.status === 'verified'
        ? 'Telegram target is verified and ready to receive alerts.'
        : 'Telegram target is saved and will be used for per-user delivery.';
  const webPushChannel = notificationChannels.find((channel) => channel.channelType === 'web_push') ?? null;
  const webPushChannelEnabled = webPushChannel?.enabled === true;
  const webPushReady = webPushEnabled && hasWebPushSubscription && webPushPermission === 'granted' && webPushChannelEnabled;
  const webPushStatusLabel = webPushPermission === 'denied'
    ? 'Blocked'
    : !webPushEnabled
      ? 'Disabled'
      : !hasWebPushSubscription
        ? 'Setup required'
        : !webPushChannelEnabled
          ? 'Setup required'
        : 'Ready';
  const webPushStatusColor = webPushPermission === 'denied'
    ? '#991b1b'
    : webPushReady
      ? '#047857'
      : webPushEnabled
        ? '#b45309'
        : 'var(--gray-400)';
  const webPushCardBorder = webPushPermission === 'denied'
    ? '#fecaca'
    : webPushReady
      ? '#bbf7d0'
      : webPushEnabled
        ? '#fcd34d'
        : 'var(--gray-200)';
  const webPushCardBackground = webPushPermission === 'denied'
    ? '#fef2f2'
    : webPushReady
      ? '#f0fdf4'
      : webPushEnabled
        ? '#fffbeb'
        : 'var(--gray-50)';
  const webPushHelperText = webPushPermission === 'denied'
    ? 'Blocked by browser — allow notifications in site settings to enable delivery.'
    : !webPushEnabled
      ? 'Web Push delivery is turned off for this user.'
      : !hasWebPushSubscription
        ? 'Notifications are enabled, but this browser still needs an active push subscription.'
        : webPushChannel?.enabled === false
          ? 'Browser subscription exists, but the channel registry is disabled.'
          : 'This browser is subscribed and ready to receive alerts.';

  useEffect(() => {
    let mounted = true;
    fetchMonitorConfig()
      .then((config: LiveMonitorConfig) => {
        if (!mounted) return;
        setUiLanguage(config.UI_LANGUAGE || 'vi');
        setTelegramEnabled(config.TELEGRAM_ENABLED === true);
        setWebPushEnabled(config.WEB_PUSH_ENABLED === true);
        setNotificationLanguage((config.NOTIFICATION_LANGUAGE as 'vi' | 'en' | 'both') || 'vi');
        setAutoApplyRecommendedCondition(config.AUTO_APPLY_RECOMMENDED_CONDITION !== false);
      })
      .catch(() => undefined);

    // Sync web push state from browser
    if (isPushSupported()) {
      setWebPushPermission(getNotificationPermission());
      getExistingSubscription()
        .then((sub) => { if (mounted) setHasWebPushSubscription(sub != null); })
        .catch(() => undefined);
    }

    fetchNotificationChannels()
      .then((channels) => {
        if (!mounted) return;
        setNotificationChannels(channels);
        setChannelAddresses(Object.fromEntries(channels.map((channel) => [channel.channelType, channel.address ?? ''])));
      })
      .catch(() => undefined);

    return () => { mounted = false; };
  }, []);

  const syncChannel = useCallback((next: NotificationChannelConfig) => {
    setNotificationChannels((prev) => prev.map((channel) => (channel.channelType === next.channelType ? next : channel)));
    setChannelAddresses((prev) => ({ ...prev, [next.channelType]: next.address ?? '' }));
  }, []);

  const saveChannel = useCallback(async (
    channelType: NotificationChannelType,
    patch: { enabled?: boolean; address?: string | null; config?: Record<string, unknown>; metadata?: Record<string, unknown> },
  ) => {
    setChannelSaving((prev) => ({ ...prev, [channelType]: true }));
    try {
      const saved = await persistNotificationChannel(channelType, patch);
      syncChannel(saved);
      return saved;
    } catch {
      throw new Error('Failed to save notification channel');
    } finally {
      setChannelSaving((prev) => ({ ...prev, [channelType]: false }));
    }
  }, [syncChannel]);

  const handleLanguageChange = async (next: 'en' | 'vi') => {
    const previous = uiLanguage;
    setUiLanguage(next);
    try {
      await persistMonitorConfig({ UI_LANGUAGE: next });
      showToast(`Display language -> ${next.toUpperCase()}`, 'success');
    } catch {
      setUiLanguage(previous);
      showToast('Failed to save display language', 'error');
    }
  };

  const handleTelegramToggle = async (enabled: boolean) => {
    const previous = telegramEnabled;
    let settingsSaved = false;
    setTelegramEnabled(enabled);
    try {
      await persistMonitorConfig({ TELEGRAM_ENABLED: enabled });
      settingsSaved = true;
      await saveChannel('telegram', { enabled });
      showToast(`Telegram ${enabled ? 'enabled' : 'disabled'}`, 'success');
    } catch {
      setTelegramEnabled(previous);
      if (settingsSaved) {
        void persistMonitorConfig({ TELEGRAM_ENABLED: previous }).catch(() => undefined);
      }
      showToast('Failed to save Telegram setting', 'error');
    }
  };

  const handleWebPushToggle = async (enable: boolean) => {
    if (!isPushSupported()) {
      showToast('Web Push is not supported in this browser.', 'error');
      return;
    }
    const previous = webPushEnabled;
    const previousHasSubscription = hasWebPushSubscription;
    let settingsSaved = false;
    setWebPushLoading(true);
    try {
      if (enable) {
        const permission = await requestNotificationPermission();
        setWebPushPermission(permission);
        if (permission !== 'granted') {
          showToast('Notification permission denied. Enable it in browser settings.', 'error');
          return;
        }
        await subscribePush();
        setHasWebPushSubscription(true);
        setWebPushEnabled(true);
        await persistMonitorConfig({ WEB_PUSH_ENABLED: true });
        settingsSaved = true;
        await saveChannel('web_push', { enabled: true });
        showToast('Web Push enabled', 'success');
      } else {
        await unsubscribePush();
        setHasWebPushSubscription(false);
        setWebPushEnabled(false);
        await persistMonitorConfig({ WEB_PUSH_ENABLED: false });
        settingsSaved = true;
        await saveChannel('web_push', { enabled: false });
        showToast('Web Push disabled', 'success');
      }
    } catch (e) {
      setWebPushEnabled(previous);
      if (settingsSaved) {
        void persistMonitorConfig({ WEB_PUSH_ENABLED: previous }).catch(() => undefined);
      }
      void getExistingSubscription()
        .then((sub) => setHasWebPushSubscription(sub != null))
        .catch(() => setHasWebPushSubscription(previousHasSubscription));
      showToast(`Web Push error: ${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally {
      setWebPushLoading(false);
    }
  };

  const handleNotificationLanguage = async (lang: 'vi' | 'en' | 'both') => {
    const previous = notificationLanguage;
    setNotificationLanguage(lang);
    try {
      await persistMonitorConfig({ NOTIFICATION_LANGUAGE: lang });
      showToast(`Notification language -> ${lang.toUpperCase()}`, 'success');
    } catch {
      setNotificationLanguage(previous);
      showToast('Failed to save setting', 'error');
    }
  };

  const handleAutoApplyRecommendedCondition = async (enabled: boolean) => {
    setAutoApplyRecommendedCondition(enabled);
    try {
      await persistMonitorConfig({ AUTO_APPLY_RECOMMENDED_CONDITION: enabled });
      showToast(`Auto-apply recommended trigger condition ${enabled ? 'enabled' : 'disabled'}`, 'success');
    } catch {
      setAutoApplyRecommendedCondition(!enabled);
      showToast('Failed to save setting', 'error');
    }
  };

  const getChannelStatusColor = (status: string) => {
    if (status === 'verified') return '#047857';
    if (status === 'pending') return '#92400e';
    if (status === 'disabled') return 'var(--gray-400)';
    return 'var(--gray-500)';
  };

  const getChannelDescription = (channel: NotificationChannelConfig) => {
    if (channel.channelType === 'telegram') return 'Chat ID or delivery target for Telegram bot alerts.';
    if (channel.channelType === 'email') return 'Reserved email delivery target for future notification sender.';
    if (channel.channelType === 'zalo') return 'Reserved Zalo OA delivery target for future sender integration.';
    return 'Browser-bound push delivery state for the current device.';
  };

  return (
    <div style={{ maxWidth: 860 }}>
      {/* Tab bar */}
      <div style={{
        display: 'flex', gap: '2px',
        borderBottom: '1px solid var(--gray-200)',
        marginBottom: '20px',
      }}>
        {TABS.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: '10px 20px',
                fontSize: '11px',
                fontWeight: active ? 700 : 500,
                letterSpacing: '0.6px',
                textTransform: 'uppercase',
                color: active ? '#2563eb' : 'var(--gray-400)',
                background: active ? 'rgba(37,99,235,0.06)' : 'none',
                border: 'none',
                borderBottom: active ? '2px solid #2563eb' : '2px solid transparent',
                borderRadius: active ? '4px 4px 0 0' : '4px 4px 0 0',
                cursor: 'pointer',
                marginBottom: '-1px',
                transition: 'color 0.15s, background 0.15s',
                whiteSpace: 'nowrap',
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab: General */}
      {activeTab === 'general' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

          {/* Display Language */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--gray-100)', background: 'var(--gray-50)' }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--gray-700)' }}>Display Language</div>
              <div style={{ fontSize: '11px', color: 'var(--gray-400)', marginTop: '2px' }}>
                Strategic context text follows this language when both EN/VI are available.
              </div>
            </div>
            <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
              <select
                className="job-interval-select"
                value={uiLanguage}
                onChange={(e) => handleLanguageChange(e.target.value === 'en' ? 'en' : 'vi')}
                style={{ minWidth: '160px' }}
              >
                <option value="vi">Vietnamese</option>
                <option value="en">English</option>
              </select>
            </div>
          </div>

          {/* Notifications */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--gray-100)', background: 'var(--gray-50)' }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--gray-700)' }}>Notifications</div>
              <div style={{ fontSize: '11px', color: 'var(--gray-400)', marginTop: '2px' }}>
                Manage outbound alert channels for AI recommendations.
              </div>
            </div>
            <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>

              {/* Telegram row */}
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '12px 14px', borderRadius: '8px',
                border: `1px solid ${telegramCardBorder}`,
                background: telegramCardBackground,
                gap: '12px', flexWrap: 'wrap',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                  <span style={{ fontSize: '18px' }}>✈️</span>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--gray-900)' }}>Telegram</div>
                      <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 6px', borderRadius: '999px', background: 'white', color: telegramStatusColor }}>
                        {telegramStatusLabel}
                      </span>
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--gray-500)', marginTop: '1px' }}>
                      Send AI recommendations via Telegram Bot
                    </div>
                    <div style={{ fontSize: '11px', color: telegramReady ? '#1d4ed8' : '#92400e', marginTop: '4px' }}>
                      {telegramHelperText}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
                  <select
                    className="job-interval-select"
                    value={notificationLanguage}
                    onChange={(e) => handleNotificationLanguage(e.target.value as 'vi' | 'en' | 'both')}
                    disabled={!telegramEnabled}
                    style={{ minWidth: '110px', opacity: telegramEnabled ? 1 : 0.45 }}
                    title="Message language"
                  >
                    <option value="vi">Vietnamese</option>
                    <option value="en">English</option>
                    <option value="both">EN + VI</option>
                  </select>
                  <Toggle on={telegramEnabled} onChange={handleTelegramToggle} label="Toggle Telegram notifications" />
                  <span style={{ fontSize: '11px', fontWeight: 600, color: telegramStatusColor, minWidth: 26 }}>
                    {telegramEnabled ? 'ON' : 'OFF'}
                  </span>
                </div>
              </div>

              {/* Web Push row */}
              {isPushSupported() && (
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '12px 14px', borderRadius: '8px',
                  border: `1px solid ${webPushCardBorder}`,
                  background: webPushCardBackground,
                  gap: '12px', flexWrap: 'wrap',
                  opacity: webPushLoading ? 0.7 : 1,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                    <span style={{ fontSize: '18px' }}>🔔</span>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--gray-900)' }}>Web Push</span>
                        <span style={{ fontSize: '10px', fontWeight: 700, padding: '1px 6px', borderRadius: '999px', background: 'white', color: webPushStatusColor }}>
                          {webPushStatusLabel}
                        </span>
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--gray-500)', marginTop: '1px' }}>
                        Receive AI recommendations as browser notifications on this device
                      </div>
                      <div style={{ fontSize: '11px', color: webPushReady ? '#047857' : webPushPermission === 'denied' ? '#991b1b' : '#92400e', marginTop: '4px' }}>
                        {webPushHelperText}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
                    <Toggle
                      on={webPushEnabled}
                      onChange={handleWebPushToggle}
                      disabled={webPushLoading || webPushPermission === 'denied'}
                      label="Toggle Web Push notifications"
                    />
                    <span style={{ fontSize: '11px', fontWeight: 600, color: webPushStatusColor, minWidth: 26 }}>
                      {webPushLoading ? '...' : webPushEnabled ? 'ON' : 'OFF'}
                    </span>
                  </div>
                </div>
              )}

              {/* Zalo row — coming soon */}
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '12px 14px', borderRadius: '8px',
                border: '1px solid var(--gray-200)',
                background: 'var(--gray-50)',
                gap: '12px', opacity: 0.55,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '18px' }}>💬</span>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--gray-900)' }}>Zalo</span>
                      <span style={{ fontSize: '10px', fontWeight: 700, padding: '1px 6px', borderRadius: '999px', background: '#fde68a', color: '#92400e' }}>
                        Coming soon
                      </span>
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--gray-500)', marginTop: '1px' }}>Send notifications via Zalo OA</div>
                  </div>
                </div>
                <Toggle on={false} onChange={() => {}} disabled label="Toggle Zalo notifications" />
              </div>

            </div>
          </div>

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--gray-100)', background: 'var(--gray-50)' }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--gray-700)' }}>Channel Registry</div>
              <div style={{ fontSize: '11px', color: 'var(--gray-400)', marginTop: '2px' }}>
                Per-user notification channel records backing delivery eligibility and future sender integrations.
              </div>
            </div>
            <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {notificationChannels.map((channel) => {
                const address = channelAddresses[channel.channelType] ?? '';
                const isWebPushChannel = channel.channelType === 'web_push';
                const saving = channelSaving[channel.channelType] === true;
                const senderImplemented = channel.metadata.senderImplemented === true;
                return (
                  <div
                    key={channel.channelType}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '12px',
                      padding: '12px 14px',
                      borderRadius: '8px',
                      border: '1px solid var(--gray-200)',
                      background: 'white',
                      flexWrap: 'wrap',
                    }}
                  >
                    <div style={{ minWidth: 0, flex: '1 1 280px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--gray-900)', textTransform: 'capitalize' }}>
                          {channel.channelType.replace('_', ' ')}
                        </span>
                        <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 6px', borderRadius: '999px', background: 'var(--gray-100)', color: getChannelStatusColor(channel.status) }}>
                          {channel.status.toUpperCase()}
                        </span>
                        {!senderImplemented && (
                          <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 6px', borderRadius: '999px', background: '#fef3c7', color: '#92400e' }}>
                            Sender pending
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--gray-500)', marginTop: '4px' }}>
                        {getChannelDescription(channel)}
                      </div>
                    </div>

                    {isWebPushChannel ? (
                      <div style={{ fontSize: '11px', color: 'var(--gray-500)' }}>
                        Browser permission: <strong>{webPushPermission}</strong>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: '1 1 300px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                        <input
                          type="text"
                          className="filter-input"
                          value={address}
                          placeholder={channel.channelType === 'telegram' ? 'Chat ID' : channel.channelType === 'email' ? 'Email address' : 'Zalo recipient'}
                          onChange={(e) => setChannelAddresses((prev) => ({ ...prev, [channel.channelType]: e.target.value }))}
                          style={{ minWidth: '200px', flex: '1 1 220px' }}
                        />
                        <button
                          className="btn btn-secondary"
                          disabled={saving}
                          onClick={() => {
                            void saveChannel(
                              channel.channelType,
                              { address: address.trim() || null, enabled: channel.enabled },
                            )
                              .then(() => {
                                showToast(`${channel.channelType.replace('_', ' ')} address saved`, 'success');
                              })
                              .catch(() => {
                                showToast('Failed to save notification channel', 'error');
                              });
                          }}
                        >
                          {saving ? 'Saving...' : 'Save'}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Watchlist Enrichment */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--gray-100)', background: 'var(--gray-50)' }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--gray-700)' }}>Watchlist Enrichment</div>
              <div style={{ fontSize: '11px', color: 'var(--gray-400)', marginTop: '2px' }}>
                Default behavior for applying AI-recommended trigger conditions to watchlist entries.
              </div>
            </div>
            <div style={{ padding: '12px 16px' }}>
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '12px 14px', borderRadius: '8px',
                border: `1px solid ${autoApplyRecommendedCondition ? '#bfdbfe' : 'var(--gray-200)'}`,
                background: autoApplyRecommendedCondition ? '#eff6ff' : 'var(--gray-50)',
                gap: '12px', flexWrap: 'wrap',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                  <span style={{ fontSize: '18px' }}>🎯</span>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--gray-900)' }}>
                      Auto-apply AI suggested trigger condition
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--gray-500)', marginTop: '1px' }}>
                      For new or safely updatable watchlist entries, copy the AI recommendation into Trigger Condition by default.
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
                  <Toggle on={autoApplyRecommendedCondition} onChange={handleAutoApplyRecommendedCondition} />
                  <span style={{ fontSize: '11px', fontWeight: 600, color: autoApplyRecommendedCondition ? '#2563eb' : 'var(--gray-400)', minWidth: 26 }}>
                    {autoApplyRecommendedCondition ? 'ON' : 'OFF'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Scheduler */}
      {activeTab === 'scheduler' && (
        <div className="card" style={{ padding: '16px' }}>
          <JobSchedulerPanel />
        </div>
      )}

      {/* Tab: System */}
      {activeTab === 'system' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--gray-100)', background: 'var(--gray-50)' }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--gray-700)' }}>Ops Monitoring</div>
            </div>
            <div style={{ padding: '12px 16px' }}>
              <OpsMonitoringPanel />
            </div>
          </div>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--gray-100)', background: 'var(--gray-50)' }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--gray-700)' }}>Integration Health</div>
            </div>
            <div style={{ padding: '12px 16px' }}>
              <IntegrationHealthPanel />
            </div>
          </div>
        </div>
      )}

      {/* Tab: Audit */}
      {activeTab === 'audit' && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--gray-100)', background: 'var(--gray-50)' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--gray-700)' }}>Audit Trail</div>
          </div>
          <div style={{ padding: '12px 16px' }}>
            <AuditLogsPanel />
          </div>
        </div>
      )}
    </div>
  );
}
