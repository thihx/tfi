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
import {
  isPushSupported,
  getNotificationPermission,
  requestNotificationPermission,
  getExistingSubscription,
  subscribePush,
  unsubscribePush,
} from '@/lib/services/push';

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
    description: 'Marks watchlist entries as expired when kickoff time + 120 minutes has passed.',
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

function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      onClick={() => !disabled && onChange(!on)}
      disabled={disabled}
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
  const [telegramEnabled, setTelegramEnabled] = useState(true);
  const [notificationLanguage, setNotificationLanguage] = useState<'vi' | 'en' | 'both'>('vi');
  const [autoApplyRecommendedCondition, setAutoApplyRecommendedCondition] = useState(true);
  const [webPushEnabled, setWebPushEnabled] = useState(false);
  const [webPushLoading, setWebPushLoading] = useState(false);
  const [webPushPermission, setWebPushPermission] = useState<NotificationPermission>('default');

  useEffect(() => {
    let mounted = true;
    fetchMonitorConfig()
      .then((config: LiveMonitorConfig) => {
        if (!mounted) return;
        setUiLanguage(config.UI_LANGUAGE || 'vi');
        setTelegramEnabled(config.TELEGRAM_ENABLED !== false);
        setNotificationLanguage((config.NOTIFICATION_LANGUAGE as 'vi' | 'en' | 'both') || 'vi');
        setAutoApplyRecommendedCondition(config.AUTO_APPLY_RECOMMENDED_CONDITION !== false);
      })
      .catch(() => undefined);

    // Sync web push state from browser
    if (isPushSupported()) {
      setWebPushPermission(getNotificationPermission());
      getExistingSubscription()
        .then((sub) => { if (mounted) setWebPushEnabled(sub != null); })
        .catch(() => undefined);
    }

    return () => { mounted = false; };
  }, []);

  const handleLanguageChange = async (next: 'en' | 'vi') => {
    const previous = uiLanguage;
    setUiLanguage(next);
    try {
      await persistMonitorConfig({ UI_LANGUAGE: next });
      window.dispatchEvent(new CustomEvent('tfi:settings-updated'));
      showToast(`Display language -> ${next.toUpperCase()}`, 'success');
    } catch {
      setUiLanguage(previous);
      showToast('Failed to save display language', 'error');
    }
  };

  const handleTelegramToggle = async (enabled: boolean) => {
    setTelegramEnabled(enabled);
    try {
      await persistMonitorConfig({ TELEGRAM_ENABLED: enabled });
      showToast(`Telegram ${enabled ? 'enabled' : 'disabled'}`, 'success');
    } catch {
      setTelegramEnabled(!enabled);
      showToast('Failed to save setting', 'error');
    }
  };

  const handleWebPushToggle = async (enable: boolean) => {
    if (!isPushSupported()) {
      showToast('Web Push is not supported in this browser.', 'error');
      return;
    }
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
        setWebPushEnabled(true);
        await persistMonitorConfig({ WEB_PUSH_ENABLED: true });
        showToast('Web Push enabled', 'success');
      } else {
        await unsubscribePush();
        setWebPushEnabled(false);
        await persistMonitorConfig({ WEB_PUSH_ENABLED: false });
        showToast('Web Push disabled', 'success');
      }
    } catch (e) {
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
                border: `1px solid ${telegramEnabled ? '#bfdbfe' : 'var(--gray-200)'}`,
                background: telegramEnabled ? '#eff6ff' : 'var(--gray-50)',
                gap: '12px', flexWrap: 'wrap',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                  <span style={{ fontSize: '18px' }}>✈️</span>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--gray-900)' }}>Telegram</div>
                    <div style={{ fontSize: '11px', color: 'var(--gray-500)', marginTop: '1px' }}>
                      Send AI recommendations via Telegram Bot
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
                  <Toggle on={telegramEnabled} onChange={handleTelegramToggle} />
                  <span style={{ fontSize: '11px', fontWeight: 600, color: telegramEnabled ? '#2563eb' : 'var(--gray-400)', minWidth: 26 }}>
                    {telegramEnabled ? 'ON' : 'OFF'}
                  </span>
                </div>
              </div>

              {/* Web Push row */}
              {isPushSupported() && (
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '12px 14px', borderRadius: '8px',
                  border: `1px solid ${webPushEnabled ? '#d1fae5' : 'var(--gray-200)'}`,
                  background: webPushEnabled ? '#f0fdf4' : 'var(--gray-50)',
                  gap: '12px', flexWrap: 'wrap',
                  opacity: webPushLoading ? 0.7 : 1,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                    <span style={{ fontSize: '18px' }}>🔔</span>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--gray-900)' }}>Web Push</span>
                        {webPushPermission === 'denied' && (
                          <span style={{ fontSize: '10px', fontWeight: 700, padding: '1px 6px', borderRadius: '999px', background: '#fee2e2', color: '#991b1b' }}>
                            Blocked
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '11px', color: webPushPermission === 'denied' ? '#b91c1c' : 'var(--gray-500)', marginTop: '1px' }}>
                        {webPushPermission === 'denied'
                          ? 'Blocked by browser — allow in site settings to enable'
                          : 'Receive AI recommendations as browser notifications on this device'}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
                    <Toggle
                      on={webPushEnabled}
                      onChange={handleWebPushToggle}
                      disabled={webPushLoading || webPushPermission === 'denied'}
                    />
                    <span style={{ fontSize: '11px', fontWeight: 600, color: webPushEnabled ? '#059669' : 'var(--gray-400)', minWidth: 26 }}>
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
                <Toggle on={false} onChange={() => {}} disabled />
              </div>

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
