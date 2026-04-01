import { useState, useEffect, useCallback, useRef } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useToast } from '@/hooks/useToast';
import { formatLocalDateTime } from '@/lib/utils/helpers';
import { buildTimeZoneOptions, DEFAULT_APP_TIMEZONE, detectBrowserTimeZone } from '@/lib/utils/timezone';
import { AuditLogsPanel } from '@/components/AuditLogsPanel';
import { IntegrationHealthPanel } from '@/components/IntegrationHealthPanel';
import { OpsMonitoringPanel } from '@/components/OpsMonitoringPanel';
import { Toggle } from '@/components/ui/Toggle';
import { fetchCurrentUser, getToken, getUser } from '@/lib/services/auth';
import { internalApiUrl } from '@/lib/internal-api';
import { fetchMonitorConfig, persistMonitorConfig } from '@/features/live-monitor/config';
import type { LiveMonitorConfig } from '@/features/live-monitor/types';
import { fetchNotificationChannels, persistNotificationChannel } from '@/lib/services/notification-channels';
import {
  fetchAdminUsers,
  updateAdminUser,
  fetchEntitlementCatalog,
  fetchSubscriptionPlans,
  updateSubscriptionPlan,
  fetchAdminUserSubscriptions,
  updateAdminUserSubscription,
  type AdminUserRecord,
  type AdminSubscriptionUserRecord,
  type EntitlementCatalogEntry,
  type SubscriptionBillingInterval,
  type SubscriptionPlanRecord,
  type SubscriptionStatus,
} from '@/lib/services/api';
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
  lastStartedAt?: string | null;
  lastCompletedAt?: string | null;
  lastHeartbeatAt?: string | null;
  lastDurationMs?: number | null;
  lastLagMs?: number | null;
  lastError: string | null;
  running: boolean;
  enabled: boolean;
  runCount: number;
  progress: JobProgress | null;
  concurrency: number;
  activeRuns: number;
  pendingRuns: number;
  lockPolicy?: 'strict' | 'degraded-local';
  degradedLocking?: boolean;
  history24h?: JobRunOverview | null;
}

type JobRunStatus = 'success' | 'failure' | 'skipped';

interface JobRunOverview {
  jobName: string;
  totalRuns: number;
  successRuns: number;
  failureRuns: number;
  skippedRuns: number;
  degradedRuns: number;
  avgLagMs: number | null;
  avgDurationMs: number | null;
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
  lastStatus: JobRunStatus | null;
}

interface JobRunHistoryRow {
  id: number;
  job_name: string;
  scheduled_at: string;
  started_at: string;
  completed_at: string | null;
  status: JobRunStatus;
  skip_reason: string | null;
  lock_policy: string;
  degraded_locking: boolean;
  instance_id: string;
  lag_ms: number | null;
  duration_ms: number | null;
  error: string | null;
  summary: Record<string, unknown>;
  created_at: string;
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
    description: 'Looks for today\'s and tomorrow\'s matches in the leagues you track, updates the match list, and saves finished games to history.',
    order: 1,
  },
  'sync-watchlist-metadata': {
    label: 'Sync Watchlist Metadata',
    description: 'Keeps monitored watchlist rows aligned with the latest match metadata and backfills legacy operational entries.',
    order: 2,
  },
  'auto-add-top-league-watchlist': {
    label: 'Auto Add Top League Watchlist',
    description: 'Scans upcoming top-league matches and adds them to the operational watchlist when not already tracked.',
    order: 3,
  },
  'auto-add-favorite-team-watchlist': {
    label: 'Auto Add Favorite Team Watchlist',
    description: 'Adds upcoming matches for users\' favorite teams into their personal watchlists when those matches are not already followed.',
    order: 4,
  },
  'refresh-live-matches': {
    label: 'Refresh Live Matches',
    description: 'Refreshes only the matches that are live or about to start, so scores and match state move faster without forcing a full match reload every few seconds.',
    order: 5,
  },
  'sync-reference-data': {
    label: 'Sync Reference Data',
    description: 'Refreshes basic league and team information that changes slowly. This helps other parts of the app read from saved local data instead of asking for the same details again.',
    order: 6,
  },
  'enrich-watchlist': {
    label: 'Enrich Watchlist',
    description: 'Adds more background to upcoming matches in the follow list, such as why the game may matter and whether there may be missing players or a busy schedule. It can also suggest a follow rule when there is enough context.',
    order: 7,
  },
  'update-predictions': {
    label: 'Update Predictions',
    description: 'Gets pre-game outlooks for upcoming matches in the follow list and saves them for later use.',
    order: 8,
  },
  'check-live-trigger': {
    label: 'Check Live Matches',
    description: 'Looks for followed matches that are now live and decides which ones need a fresh review. For those matches, it runs the main review flow and may save a new result or send an alert.',
    order: 9,
  },
  'refresh-provider-insights': {
    label: 'Refresh Provider Insights',
    description: 'Pre-warms saved non-live provider details for followed games so the app can reuse local copies instead of asking again each time.',
    order: 10,
  },
  'auto-settle': {
    label: 'Auto Settle',
    description: 'Checks finished matches and updates open picks and bets with their final outcome. It uses saved match history first and only asks for missing final details when needed.',
    order: 11,
  },
  'expire-watchlist': {
    label: 'Expire Watchlist',
    description: 'Removes old follow-list entries after the match has been over long enough that the app no longer needs to keep watching them.',
    order: 12,
  },
  'purge-audit': {
    label: 'Housekeeping',
    description: 'Runs retention and cleanup across high-growth operational tables so storage and audit churn stay under control.',
    order: 13,
  },
  'integration-health': {
    label: 'Integration Health',
    description: 'Checks whether the key services the app depends on are working well. If one goes down or recovers, it sends a message so people notice quickly.',
    order: 14,
  },
  'health-watchdog': {
    label: 'Health Watchdog',
    description: 'Watches the most important background jobs and looks for ones that stop running on time or appear stuck. If a problem starts or clears, it sends a message.',
    order: 15,
  },
};

function formatMsDuration(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '-';
  if (value < 1000) return `${Math.round(value)} ms`;
  const seconds = value / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds >= 10 ? 0 : 1)} s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return remainder > 0 ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

function formatJobRunStatus(status: JobRunStatus | null | undefined): string {
  if (status === 'success') return 'Healthy';
  if (status === 'failure') return 'Failed';
  if (status === 'skipped') return 'Skipped';
  return 'Idle';
}

function formatLockPolicy(policy: JobInfo['lockPolicy'] | string | null | undefined): string {
  if (policy === 'degraded-local') return 'Degraded local lock';
  if (policy === 'strict') return 'Strict lock';
  return 'Lock policy unknown';
}

function formatPlanPrice(priceAmount: string, currency: string, billingInterval: SubscriptionBillingInterval): string {
  const parsed = Number(priceAmount);
  const amount = Number.isFinite(parsed) ? parsed.toFixed(parsed % 1 === 0 ? 0 : 2) : priceAmount;
  if (billingInterval === 'manual') return `${currency} ${amount}`;
  return `${currency} ${amount}/${billingInterval}`;
}

function prettyEntitlementValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value == null) return '-';
  return String(value);
}

function safeParseJsonObject(raw: string): Record<string, unknown> {
  const parsed = JSON.parse(raw);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('JSON must be an object');
  }
  return parsed as Record<string, unknown>;
}

interface SubscriptionPlanDraft {
  display_name: string;
  description: string;
  billing_interval: SubscriptionBillingInterval;
  price_amount: string;
  currency: string;
  active: boolean;
  public: boolean;
  display_order: string;
  entitlementsJson: string;
  metadataJson: string;
}

interface UserSubscriptionDraft {
  planCode: string;
  status: SubscriptionStatus;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
}

function JobSchedulerPanel() {
  const { state } = useAppState();
  const { showToast } = useToast();
  const [jobs, setJobs] = useState<JobInfo[]>([]);
  const [triggering, setTriggering] = useState<Set<string>>(new Set());
  const [expandedHistoryJob, setExpandedHistoryJob] = useState<string | null>(null);
  const [jobRunsByName, setJobRunsByName] = useState<Record<string, JobRunHistoryRow[]>>({});
  const [historyLoadingByName, setHistoryLoadingByName] = useState<Record<string, boolean>>({});
  const [historyErrorByName, setHistoryErrorByName] = useState<Record<string, string | null>>({});
  const apiUrl = state.config.apiUrl;
  const hasRunningJob = jobs.some((j) => j.running);

  const fetchJobs = useCallback(async () => {
    if (apiUrl == null) return;
    try {
      const res = await fetch(internalApiUrl('/api/jobs', apiUrl), { headers: authHeaders(), credentials: 'include' });
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

  const fetchJobRuns = useCallback(async (jobName: string, force = false) => {
    if (apiUrl == null) return;
    if (!force && jobRunsByName[jobName] != null) return;
    setHistoryLoadingByName((prev) => ({ ...prev, [jobName]: true }));
    setHistoryErrorByName((prev) => ({ ...prev, [jobName]: null }));
    try {
      const params = new URLSearchParams({
        jobName,
        limit: '8',
        hours: '24',
      });
      const res = await fetch(internalApiUrl(`/api/jobs/runs?${params.toString()}`, apiUrl), {
        headers: authHeaders(),
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`Failed with status ${res.status}`);
      const payload = await res.json() as { runs?: JobRunHistoryRow[] };
      setJobRunsByName((prev) => ({ ...prev, [jobName]: payload.runs ?? [] }));
    } catch {
      setHistoryErrorByName((prev) => ({ ...prev, [jobName]: 'Failed to load recent runs.' }));
    } finally {
      setHistoryLoadingByName((prev) => ({ ...prev, [jobName]: false }));
    }
  }, [apiUrl, jobRunsByName]);

  const handleHistoryToggle = (jobName: string) => {
    const nextJob = expandedHistoryJob === jobName ? null : jobName;
    setExpandedHistoryJob(nextJob);
    if (nextJob != null) {
      void fetchJobRuns(nextJob);
    }
  };

  const handleIntervalChange = async (name: string, intervalMs: number) => {
    const meta = JOB_META[name];
    const label = meta?.label || name;
    try {
      const res = await fetch(internalApiUrl(`/api/jobs/${name}`, apiUrl), {
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
      const res = await fetch(internalApiUrl(`/api/jobs/${name}/trigger`, apiUrl), {
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
        const overview = job.history24h ?? null;
        const isHistoryExpanded = expandedHistoryJob === job.name;
        const recentRuns = jobRunsByName[job.name] ?? [];
        const isHistoryLoading = historyLoadingByName[job.name] === true;
        const historyError = historyErrorByName[job.name];
        const latestStatus: JobRunStatus | null = overview?.lastStatus ?? (isRunning ? 'success' : job.lastError ? 'failure' : null);
        const historyButtonLabel = isHistoryExpanded ? 'Hide Runs' : 'Recent Runs';

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
                    <span className="job-concurrency-badge" title={`Max ${job.concurrency} parallel runs`} style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> ×{job.concurrency}
                      {job.activeRuns > 0 && <span style={{ color: 'var(--warning)' }}> {job.activeRuns}/{job.concurrency}</span>}
                      {job.pendingRuns > 0 && <span style={{ color: 'var(--gray-500)' }}> +{job.pendingRuns} queued</span>}
                    </span>
                  ) : (
                    <span className="job-concurrency-badge job-single" title="Single-threaded"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></span>
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
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => handleHistoryToggle(job.name)}
                  aria-expanded={isHistoryExpanded}
                >
                  {historyButtonLabel}
                </button>
                {job.name === 'enrich-watchlist' && (
                  <button
                    className="btn btn-sm"
                    style={{ marginLeft: 4, background: '#f59e0b', color: '#fff', border: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                    onClick={() => handleTrigger(job.name, true)}
                    disabled={isRunning || triggering.has(job.name)}
                    title="Force re-enrich all entries (ignore 6h cache)"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> Force
                  </button>
                )}
              </div>
            </div>

            <div className="job-health-strip">
              <span className={`job-status-pill status-${latestStatus ?? 'idle'}`}>
                {formatJobRunStatus(latestStatus)}
              </span>
              <span className="job-health-chip">
                24h {overview ? `${overview.successRuns} ok / ${overview.failureRuns} fail / ${overview.skippedRuns} skipped` : 'no history'}
              </span>
              <span className="job-health-chip">
                Avg lag {formatMsDuration(overview?.avgLagMs ?? job.lastLagMs)}
              </span>
              <span className="job-health-chip">
                Avg duration {formatMsDuration(overview?.avgDurationMs ?? job.lastDurationMs)}
              </span>
              <span className="job-health-chip">
                {formatLockPolicy(job.lockPolicy)}
              </span>
              {job.degradedLocking || (overview?.degradedRuns ?? 0) > 0 ? (
                <span className="job-health-chip warning">
                  Degraded lock seen in last 24h
                </span>
              ) : null}
            </div>

            <div className="job-timestamps">
              <span>Started: {job.lastStartedAt ? formatLocalDateTime(job.lastStartedAt) : '-'}</span>
              <span>Completed: {job.lastCompletedAt ? formatLocalDateTime(job.lastCompletedAt) : '-'}</span>
              <span>Heartbeat: {job.lastHeartbeatAt ? formatLocalDateTime(job.lastHeartbeatAt) : '-'}</span>
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

            {isHistoryExpanded && (
              <div className="job-history-panel">
                <div className="job-history-toolbar">
                  <div>
                    <div className="job-history-title">Recent Runs</div>
                    <div className="job-history-subtitle">Latest 8 runs from the last 24 hours</div>
                  </div>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => { void fetchJobRuns(job.name, true); }}
                    disabled={isHistoryLoading}
                  >
                    {isHistoryLoading ? 'Refreshing...' : 'Refresh'}
                  </button>
                </div>

                {historyError ? (
                  <div className="job-history-empty error">{historyError}</div>
                ) : isHistoryLoading && recentRuns.length === 0 ? (
                  <div className="job-history-empty">Loading recent runs...</div>
                ) : recentRuns.length === 0 ? (
                  <div className="job-history-empty">No recorded runs in the last 24 hours.</div>
                ) : (
                  <div className="job-history-list">
                    {recentRuns.map((run) => (
                      <div key={run.id} className="job-history-row">
                        <div className="job-history-row-main">
                          <span className={`job-status-pill status-${run.status}`}>{formatJobRunStatus(run.status)}</span>
                          <span className="job-history-time">
                            {formatLocalDateTime(run.started_at)}
                          </span>
                          <span className="job-history-meta">
                            Lag {formatMsDuration(run.lag_ms)} · Duration {formatMsDuration(run.duration_ms)}
                          </span>
                        </div>
                        <div className="job-history-row-detail">
                          <span>{run.completed_at ? `Completed ${formatLocalDateTime(run.completed_at)}` : 'Still running'}</span>
                          <span>{formatLockPolicy(run.lock_policy)}</span>
                          {run.skip_reason ? <span>Reason: {run.skip_reason}</span> : null}
                          {run.degraded_locking ? <span>Degraded locking</span> : null}
                          {run.error ? <span className="job-history-error">{run.error}</span> : null}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
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

// ── User & Subscription management helpers ───────────────────────────────────

function getUserInitials(name: string | null, email: string): string {
  if (name) {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    const firstInitial = parts[0]?.[0] ?? name[0] ?? '';
    const lastInitial = parts[parts.length - 1]?.[0] ?? firstInitial;
    return (parts.length > 1 ? `${firstInitial}${lastInitial}` : name.slice(0, 2)).toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

const DEFAULT_ROLE_BADGE = { bg: 'var(--gray-100)', color: 'var(--gray-500)' } as const;
const ROLE_BADGE: Record<string, { bg: string; color: string }> = {
  owner:  { bg: '#ede9fe', color: '#6d28d9' },
  admin:  { bg: '#dbeafe', color: '#1d4ed8' },
  member: DEFAULT_ROLE_BADGE,
};

const DEFAULT_STATUS_BADGE = { bg: '#dcfce7', color: '#166534' } as const;
const STATUS_BADGE: Record<string, { bg: string; color: string }> = {
  active:   { bg: '#dcfce7', color: '#166534' },
  disabled: { bg: '#fee2e2', color: '#b91c1c' },
  invited:  { bg: '#fef9c3', color: '#92400e' },
};

const DEFAULT_SUB_STATUS_BADGE = { bg: 'var(--gray-100)', color: 'var(--gray-500)' } as const;
const SUB_STATUS_BADGE: Record<string, { bg: string; color: string }> = {
  trialing: { bg: '#ede9fe', color: '#6d28d9' },
  active:   { bg: '#dcfce7', color: '#166534' },
  past_due: { bg: '#fee2e2', color: '#b91c1c' },
  paused:   { bg: 'var(--gray-100)', color: 'var(--gray-600)' },
  canceled: { bg: '#fee2e2', color: '#9f1239' },
  expired:  { bg: 'var(--gray-100)', color: 'var(--gray-400)' },
};

function UserManagementPanel({
  currentUserId,
  currentUserRole,
}: {
  currentUserId: string | null;
  currentUserRole: string | null;
}) {
  const { state } = useAppState();
  const { showToast } = useToast();
  const apiUrl = state.config.apiUrl;
  const [users, setUsers] = useState<AdminUserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { role: 'owner' | 'admin' | 'member'; status: 'active' | 'disabled' | 'invited' }>>({});

  const loadUsers = useCallback(async () => {
    if (apiUrl == null) return;
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchAdminUsers(apiUrl);
      setUsers(rows);
      setDrafts(Object.fromEntries(rows.map((row) => [row.id, { role: row.role, status: row.status }])));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users.');
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const handleDraftChange = useCallback((
    userId: string,
    field: 'role' | 'status',
    value: 'owner' | 'admin' | 'member' | 'active' | 'disabled' | 'invited',
  ) => {
    setDrafts((prev) => ({
      ...prev,
      [userId]: {
        role: prev[userId]?.role ?? 'member',
        status: prev[userId]?.status ?? 'active',
        [field]: value,
      },
    }));
  }, []);

  const handleSave = useCallback(async (row: AdminUserRecord) => {
    if (apiUrl == null) return;
    const draft = drafts[row.id];
    const payload: { role?: 'admin' | 'member'; status?: 'active' | 'disabled' } = {};
    if (draft?.role && draft.role !== row.role && draft.role !== 'owner') payload.role = draft.role;
    if (draft?.status && draft.status !== row.status && draft.status !== 'invited') payload.status = draft.status;
    if (!payload.role && !payload.status) return;

    setSavingUserId(row.id);
    try {
      const updated = await updateAdminUser(apiUrl, row.id, payload);
      setUsers((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      setDrafts((prev) => ({
        ...prev,
        [updated.id]: { role: updated.role, status: updated.status },
      }));
      showToast(`Updated ${updated.email}`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to update user.', 'error');
    } finally {
      setSavingUserId(null);
    }
  }, [apiUrl, drafts, showToast]);

  if (apiUrl == null) {
    return <p style={{ color: 'var(--gray-500)' }}>Backend URL not configured.</p>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ fontSize: '11px', color: 'var(--gray-500)' }}>
          Manage user role and login access. Owner accounts are locked here — you cannot change your own role or status.
        </div>
        <button className="btn btn-secondary btn-sm" onClick={() => { void loadUsers(); }} disabled={loading || savingUserId != null} style={{ flexShrink: 0 }}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {error ? (
        <div style={{ fontSize: '12px', color: '#b91c1c' }}>{error}</div>
      ) : loading ? (
        <div style={{ fontSize: '12px', color: 'var(--gray-500)' }}>Loading users...</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {users.map((row) => {
            const draft = drafts[row.id] ?? { role: row.role, status: row.status };
            const isOwner = row.role === 'owner';
            const isSelf = currentUserId === row.id;
            const locked = isOwner || isSelf;
            const hasChanges = draft.role !== row.role || draft.status !== row.status;
            const note = isOwner
              ? 'Owner — locked in this panel'
              : isSelf
                ? `You are signed in as ${currentUserRole ?? 'admin'} — self-edits are blocked`
                : null;
            const roleStyle = ROLE_BADGE[row.role] ?? DEFAULT_ROLE_BADGE;
            const statusStyle = STATUS_BADGE[draft.status] ?? DEFAULT_STATUS_BADGE;
            const initials = getUserInitials(row.display_name, row.email);

            return (
              <div
                key={row.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0, 1fr) 160px 160px auto',
                  gap: '12px',
                  alignItems: 'center',
                  padding: '12px 14px',
                  border: `1px solid ${hasChanges && !locked ? '#93c5fd' : 'var(--gray-200)'}`,
                  borderRadius: '10px',
                  background: hasChanges && !locked ? '#f0f7ff' : locked ? 'var(--gray-50)' : '#fff',
                  opacity: draft.status === 'disabled' ? 0.72 : 1,
                  transition: 'border-color 0.15s, background 0.15s',
                }}
              >
                {/* User identity */}
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', minWidth: 0 }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                    background: roleStyle.bg, color: roleStyle.color,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '12px', fontWeight: 700, letterSpacing: '0.5px',
                  }}>
                    {initials}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--gray-900)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {row.display_name || row.email}
                      </span>
                      {isSelf && (
                        <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '999px', background: '#dbeafe', color: '#1d4ed8', fontWeight: 600, flexShrink: 0 }}>You</span>
                      )}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--gray-500)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.email}</div>
                    {note && <div style={{ fontSize: '10px', color: '#92400e', marginTop: '2px' }}>{note}</div>}
                    <div style={{ fontSize: '10px', color: 'var(--gray-400)', marginTop: '2px' }}>Updated {formatLocalDateTime(row.updated_at)}</div>
                  </div>
                </div>

                {/* Role */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                  <div style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--gray-400)' }}>Role</div>
                  {locked ? (
                    <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: 600, background: roleStyle.bg, color: roleStyle.color }}>
                      {row.role}
                    </span>
                  ) : (
                    <select
                      className="job-interval-select"
                      aria-label={`Role for ${row.email}`}
                      value={draft.role}
                      disabled={savingUserId === row.id}
                      onChange={(e) => handleDraftChange(row.id, 'role', e.target.value as 'admin' | 'member')}
                      style={{ fontSize: '12px' }}
                    >
                      <option value="member">member</option>
                      <option value="admin">admin</option>
                    </select>
                  )}
                </div>

                {/* Status */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                  <div style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--gray-400)' }}>Status</div>
                  {locked ? (
                    <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: 600, background: statusStyle.bg, color: statusStyle.color }}>
                      {row.status}
                    </span>
                  ) : (
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                      <select
                        className="job-interval-select"
                        aria-label={`Status for ${row.email}`}
                        value={draft.status}
                        disabled={savingUserId === row.id}
                        onChange={(e) => handleDraftChange(row.id, 'status', e.target.value as 'active' | 'disabled')}
                        style={{ fontSize: '12px' }}
                      >
                        <option value="active">active</option>
                        <option value="disabled">disabled</option>
                        {row.status === 'invited' ? <option value="invited">invited</option> : null}
                      </select>
                      <span style={{ padding: '2px 7px', borderRadius: '999px', fontSize: '10px', fontWeight: 600, background: statusStyle.bg, color: statusStyle.color, flexShrink: 0 }}>
                        {draft.status}
                      </span>
                    </div>
                  )}
                </div>

                {/* Save */}
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  {!locked && (
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => { void handleSave(row); }}
                      disabled={!hasChanges || savingUserId === row.id}
                      style={{ opacity: hasChanges ? 1 : 0.3 }}
                    >
                      {savingUserId === row.id ? 'Saving…' : 'Save'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SubscriptionManagementPanel() {
  const { state } = useAppState();
  const { showToast } = useToast();
  const apiUrl = state.config.apiUrl;
  const [catalog, setCatalog] = useState<EntitlementCatalogEntry[]>([]);
  const [plans, setPlans] = useState<SubscriptionPlanRecord[]>([]);
  const [users, setUsers] = useState<AdminSubscriptionUserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [planSavingCode, setPlanSavingCode] = useState<string | null>(null);
  const [userSavingId, setUserSavingId] = useState<string | null>(null);
  const [planDrafts, setPlanDrafts] = useState<Record<string, SubscriptionPlanDraft>>({});
  const [subscriptionDrafts, setSubscriptionDrafts] = useState<Record<string, UserSubscriptionDraft>>({});
  const [expandedPlanCodes, setExpandedPlanCodes] = useState<Set<string>>(new Set());

  const loadAll = useCallback(async () => {
    if (apiUrl == null) return;
    setLoading(true);
    setError(null);
    try {
      const [catalogPayload, planRows, userRows] = await Promise.all([
        fetchEntitlementCatalog(apiUrl),
        fetchSubscriptionPlans(apiUrl),
        fetchAdminUserSubscriptions(apiUrl),
      ]);
      setCatalog(catalogPayload.catalog);
      setPlans(planRows);
      setUsers(userRows);
      setPlanDrafts(Object.fromEntries(planRows.map((plan) => [
        plan.plan_code,
        {
          display_name: plan.display_name,
          description: plan.description,
          billing_interval: plan.billing_interval,
          price_amount: plan.price_amount,
          currency: plan.currency,
          active: plan.active,
          public: plan.public,
          display_order: String(plan.display_order),
          entitlementsJson: JSON.stringify(plan.entitlements, null, 2),
          metadataJson: JSON.stringify(plan.metadata, null, 2),
        },
      ])));
      setSubscriptionDrafts(Object.fromEntries(userRows.map((row) => [
        row.id,
        {
          planCode: row.subscription_plan_code ?? 'free',
          status: row.subscription_status ?? 'active',
          currentPeriodEnd: row.subscription_current_period_end ?? '',
          cancelAtPeriodEnd: row.subscription_cancel_at_period_end ?? false,
        },
      ])));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load subscription settings.');
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handlePlanDraftChange = useCallback((
    planCode: string,
    field: 'display_name' | 'description' | 'billing_interval' | 'price_amount' | 'currency' | 'active' | 'public' | 'display_order' | 'entitlementsJson' | 'metadataJson',
    value: string | boolean,
  ) => {
    setPlanDrafts((prev) => ({
      ...prev,
      [planCode]: {
        ...(prev[planCode] ?? {
          display_name: '',
          description: '',
          billing_interval: 'manual',
          price_amount: '0',
          currency: 'USD',
          active: true,
          public: false,
          display_order: '0',
          entitlementsJson: '{}',
          metadataJson: '{}',
        }),
        [field]: value,
      } as SubscriptionPlanDraft,
    }));
  }, []);

  const handleSubscriptionDraftChange = useCallback((
    userId: string,
    field: 'planCode' | 'status' | 'currentPeriodEnd' | 'cancelAtPeriodEnd',
    value: string | boolean,
  ) => {
    setSubscriptionDrafts((prev) => ({
      ...prev,
      [userId]: {
        ...(prev[userId] ?? {
          planCode: 'free',
          status: 'active',
          currentPeriodEnd: '',
          cancelAtPeriodEnd: false,
        }),
        [field]: value,
      } as UserSubscriptionDraft,
    }));
  }, []);

  const handlePlanSave = useCallback(async (plan: SubscriptionPlanRecord) => {
    if (apiUrl == null) return;
    const draft = planDrafts[plan.plan_code];
    if (!draft) return;

    let entitlements: Record<string, unknown>;
    let metadata: Record<string, unknown>;
    try {
      entitlements = safeParseJsonObject(draft.entitlementsJson);
      metadata = safeParseJsonObject(draft.metadataJson);
    } catch (err) {
      showToast(err instanceof Error ? `Invalid JSON for ${plan.display_name}: ${err.message}` : 'Invalid JSON', 'error');
      return;
    }

    setPlanSavingCode(plan.plan_code);
    try {
      const updated = await updateSubscriptionPlan(apiUrl, plan.plan_code, {
        display_name: draft.display_name,
        description: draft.description,
        billing_interval: draft.billing_interval,
        price_amount: Number(draft.price_amount),
        currency: draft.currency,
        active: draft.active,
        public: draft.public,
        display_order: Number(draft.display_order),
        entitlements,
        metadata,
      });
      setPlans((prev) => prev.map((item) => (item.plan_code === updated.plan_code ? updated : item)));
      setPlanDrafts((prev) => ({
        ...prev,
        [updated.plan_code]: {
          display_name: updated.display_name,
          description: updated.description,
          billing_interval: updated.billing_interval,
          price_amount: updated.price_amount,
          currency: updated.currency,
          active: updated.active,
          public: updated.public,
          display_order: String(updated.display_order),
          entitlementsJson: JSON.stringify(updated.entitlements, null, 2),
          metadataJson: JSON.stringify(updated.metadata, null, 2),
        },
      }));
      showToast(`Saved plan ${updated.display_name}`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save subscription plan.', 'error');
    } finally {
      setPlanSavingCode(null);
    }
  }, [apiUrl, planDrafts, showToast]);

  const handleSubscriptionSave = useCallback(async (row: AdminSubscriptionUserRecord) => {
    if (apiUrl == null) return;
    const draft = subscriptionDrafts[row.id];
    if (!draft) return;
    setUserSavingId(row.id);
    try {
      const updated = await updateAdminUserSubscription(apiUrl, row.id, {
        planCode: draft.planCode,
        status: draft.status,
        currentPeriodEnd: draft.currentPeriodEnd.trim() || null,
        cancelAtPeriodEnd: draft.cancelAtPeriodEnd,
      });
      setUsers((prev) => prev.map((item) => (
        item.id === row.id
          ? {
              ...item,
              subscription_plan_code: updated.plan_code,
              subscription_status: updated.status,
              subscription_provider: updated.provider,
              subscription_current_period_end: updated.current_period_end,
              subscription_cancel_at_period_end: updated.cancel_at_period_end,
              subscription_updated_at: updated.updated_at,
            }
          : item
      )));
      setSubscriptionDrafts((prev) => ({
        ...prev,
        [row.id]: {
          planCode: updated.plan_code,
          status: updated.status,
          currentPeriodEnd: updated.current_period_end ?? '',
          cancelAtPeriodEnd: updated.cancel_at_period_end,
        },
      }));
      showToast(`Updated subscription for ${row.email}`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to update user subscription.', 'error');
    } finally {
      setUserSavingId(null);
    }
  }, [apiUrl, showToast, subscriptionDrafts]);

  const togglePlanExpanded = useCallback((planCode: string) => {
    setExpandedPlanCodes((prev) => {
      const next = new Set(prev);
      if (next.has(planCode)) next.delete(planCode); else next.add(planCode);
      return next;
    });
  }, []);

  if (apiUrl == null) {
    return <p style={{ color: 'var(--gray-500)' }}>Backend URL not configured.</p>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ fontSize: '11px', color: 'var(--gray-500)' }}>
          Plans are commercial access tiers, separate from internal roles. Enforced on Ask AI, watchlist capacity, and notification channels.
        </div>
        <button className="btn btn-secondary btn-sm" onClick={() => { void loadAll(); }} disabled={loading || planSavingCode != null || userSavingId != null} style={{ flexShrink: 0 }}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {error ? (
        <div style={{ fontSize: '12px', color: '#b91c1c' }}>{error}</div>
      ) : loading ? (
        <div style={{ fontSize: '12px', color: 'var(--gray-500)' }}>Loading subscription settings...</div>
      ) : (
        <>
          {/* Plan cards */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--gray-600)', letterSpacing: '0.3px' }}>Subscription Plans</div>
            {plans.map((plan) => {
              const draft = planDrafts[plan.plan_code];
              if (!draft) return null;
              const isExpanded = expandedPlanCodes.has(plan.plan_code);
              const isSaving = planSavingCode === plan.plan_code;
              return (
                <div key={plan.plan_code} style={{ border: '1px solid var(--gray-200)', borderRadius: '10px', overflow: 'hidden' }}>
                  <div style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', background: 'var(--gray-50)', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, fontSize: '14px', color: 'var(--gray-900)' }}>{plan.display_name}</span>
                      <span style={{ fontSize: '10px', padding: '1px 7px', borderRadius: '4px', background: 'var(--gray-200)', color: 'var(--gray-600)', fontFamily: 'monospace', fontWeight: 600 }}>{plan.plan_code}</span>
                      <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '999px', background: '#f0fdf4', color: '#166534', fontWeight: 600 }}>{formatPlanPrice(plan.price_amount, plan.currency, plan.billing_interval)}</span>
                      {draft.active
                        ? <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '999px', background: '#dcfce7', color: '#166534', fontWeight: 600 }}>Active</span>
                        : <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '999px', background: '#fee2e2', color: '#b91c1c', fontWeight: 600 }}>Inactive</span>
                      }
                      {draft.public && <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '999px', background: '#dbeafe', color: '#1d4ed8', fontWeight: 600 }}>Public</span>}
                    </div>
                    <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => togglePlanExpanded(plan.plan_code)}>
                        {isExpanded ? 'Collapse' : 'Edit'}
                      </button>
                      {isExpanded && (
                        <button className="btn btn-primary btn-sm" onClick={() => { void handlePlanSave(plan); }} disabled={isSaving}>
                          {isSaving ? 'Saving…' : 'Save Plan'}
                        </button>
                      )}
                    </div>
                  </div>
                  {isExpanded && (
                    <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '12px', borderTop: '1px solid var(--gray-100)' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '11px', color: 'var(--gray-500)' }}>
                          Display name
                          <input className="filter-input" value={draft.display_name} onChange={(e) => handlePlanDraftChange(plan.plan_code, 'display_name', e.target.value)} />
                        </label>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '11px', color: 'var(--gray-500)' }}>
                          Billing interval
                          <select className="job-interval-select" value={draft.billing_interval} onChange={(e) => handlePlanDraftChange(plan.plan_code, 'billing_interval', e.target.value as SubscriptionBillingInterval)}>
                            <option value="manual">manual</option>
                            <option value="month">month</option>
                            <option value="year">year</option>
                          </select>
                        </label>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '11px', color: 'var(--gray-500)' }}>
                          Price
                          <input className="filter-input" value={draft.price_amount} onChange={(e) => handlePlanDraftChange(plan.plan_code, 'price_amount', e.target.value)} />
                        </label>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '11px', color: 'var(--gray-500)' }}>
                          Currency
                          <input className="filter-input" value={draft.currency} onChange={(e) => handlePlanDraftChange(plan.plan_code, 'currency', e.target.value)} />
                        </label>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '11px', color: 'var(--gray-500)' }}>
                          Display order
                          <input className="filter-input" value={draft.display_order} onChange={(e) => handlePlanDraftChange(plan.plan_code, 'display_order', e.target.value)} />
                        </label>
                        <div style={{ display: 'flex', gap: '16px', alignItems: 'center', paddingTop: '18px' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--gray-600)' }}>
                            <input type="checkbox" checked={draft.active} onChange={(e) => handlePlanDraftChange(plan.plan_code, 'active', e.target.checked)} />
                            Active
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--gray-600)' }}>
                            <input type="checkbox" checked={draft.public} onChange={(e) => handlePlanDraftChange(plan.plan_code, 'public', e.target.checked)} />
                            Public
                          </label>
                        </div>
                      </div>
                      <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '11px', color: 'var(--gray-500)' }}>
                        Description
                        <textarea className="filter-input" rows={2} value={draft.description} onChange={(e) => handlePlanDraftChange(plan.plan_code, 'description', e.target.value)} />
                      </label>
                      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 1fr) minmax(220px, 320px)', gap: '12px' }}>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '11px', color: 'var(--gray-500)' }}>
                          Entitlements JSON
                          <textarea className="filter-input" rows={10} value={draft.entitlementsJson} onChange={(e) => handlePlanDraftChange(plan.plan_code, 'entitlementsJson', e.target.value)} />
                        </label>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                          <div style={{ fontSize: '11px', color: 'var(--gray-500)' }}>Catalog reference</div>
                          <div style={{ border: '1px solid var(--gray-200)', borderRadius: '8px', padding: '10px', maxHeight: '244px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {catalog.map((entry) => (
                              <div key={entry.key} style={{ fontSize: '11px', color: 'var(--gray-600)' }}>
                                <div style={{ fontWeight: 700, color: 'var(--gray-800)' }}>{entry.label}</div>
                                <div>{entry.key} | {entry.valueType}{entry.enforced ? ' | enforced' : ''}</div>
                                <div style={{ color: 'var(--gray-500)' }}>Current: {prettyEntitlementValue(plan.entitlements[entry.key])}</div>
                              </div>
                            ))}
                          </div>
                          <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '11px', color: 'var(--gray-500)' }}>
                            Metadata JSON
                            <textarea className="filter-input" rows={4} value={draft.metadataJson} onChange={(e) => handlePlanDraftChange(plan.plan_code, 'metadataJson', e.target.value)} />
                          </label>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* User subscriptions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', paddingTop: '4px', borderTop: '1px solid var(--gray-200)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingTop: '12px' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--gray-600)', letterSpacing: '0.3px' }}>User Subscriptions</div>
              <div style={{ fontSize: '11px', color: 'var(--gray-400)' }}>Users without a row fall back to the free plan automatically.</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {users.map((row) => {
                const draft = subscriptionDrafts[row.id] ?? {
                  planCode: row.subscription_plan_code ?? 'free',
                  status: row.subscription_status ?? 'active',
                  currentPeriodEnd: row.subscription_current_period_end ?? '',
                  cancelAtPeriodEnd: row.subscription_cancel_at_period_end ?? false,
                };
                const statusStyle = SUB_STATUS_BADGE[draft.status] ?? DEFAULT_SUB_STATUS_BADGE;
                const roleStyle = ROLE_BADGE[row.role] ?? DEFAULT_ROLE_BADGE;
                const noSubscriptionRow = row.subscription_plan_code == null;
                return (
                  <div
                    key={row.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'minmax(0, 1fr) 150px 200px 200px auto',
                      gap: '12px',
                      alignItems: 'center',
                      padding: '12px 14px',
                      border: `1px solid ${noSubscriptionRow ? '#fde68a' : 'var(--gray-200)'}`,
                      borderRadius: '10px',
                      background: noSubscriptionRow ? '#fffbeb' : '#fff',
                    }}
                  >
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center', minWidth: 0 }}>
                      <div style={{
                        width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                        background: roleStyle.bg, color: roleStyle.color,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '11px', fontWeight: 700,
                      }}>
                        {getUserInitials(row.display_name, row.email)}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--gray-900)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.display_name || row.email}</div>
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginTop: '2px', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '11px', color: 'var(--gray-500)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.email}</span>
                          <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '999px', background: roleStyle.bg, color: roleStyle.color, fontWeight: 600, flexShrink: 0 }}>{row.role}</span>
                        </div>
                        {noSubscriptionRow && <div style={{ fontSize: '10px', color: '#92400e', marginTop: '2px' }}>No subscription row — runtime defaults to Free</div>}
                        {row.subscription_updated_at && <div style={{ fontSize: '10px', color: 'var(--gray-400)', marginTop: '2px' }}>Updated {formatLocalDateTime(row.subscription_updated_at)}</div>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                      <div style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--gray-400)' }}>Plan</div>
                      <select className="job-interval-select" value={draft.planCode} onChange={(e) => handleSubscriptionDraftChange(row.id, 'planCode', e.target.value)} style={{ fontSize: '12px' }}>
                        {plans.map((plan) => (
                          <option key={plan.plan_code} value={plan.plan_code}>{plan.display_name}</option>
                        ))}
                      </select>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                      <div style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--gray-400)' }}>Status</div>
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        <select className="job-interval-select" value={draft.status} onChange={(e) => handleSubscriptionDraftChange(row.id, 'status', e.target.value as SubscriptionStatus)} style={{ fontSize: '12px' }}>
                          <option value="trialing">trialing</option>
                          <option value="active">active</option>
                          <option value="past_due">past_due</option>
                          <option value="paused">paused</option>
                          <option value="canceled">canceled</option>
                          <option value="expired">expired</option>
                        </select>
                        <span style={{ padding: '2px 7px', borderRadius: '999px', fontSize: '10px', fontWeight: 600, background: statusStyle.bg, color: statusStyle.color, flexShrink: 0 }}>
                          {draft.status}
                        </span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                      <div style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--gray-400)' }}>Period End</div>
                      <input
                        className="filter-input"
                        value={draft.currentPeriodEnd}
                        onChange={(e) => handleSubscriptionDraftChange(row.id, 'currentPeriodEnd', e.target.value)}
                        placeholder="2026-04-30T00:00:00Z"
                        style={{ fontSize: '12px' }}
                      />
                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--gray-500)' }}>
                        <input type="checkbox" checked={draft.cancelAtPeriodEnd} onChange={(e) => handleSubscriptionDraftChange(row.id, 'cancelAtPeriodEnd', e.target.checked)} />
                        Cancel at period end
                      </label>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => { void handleSubscriptionSave(row); }}
                        disabled={userSavingId === row.id}
                      >
                        {userSavingId === row.id ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Tab constants ────────────────────────────────────────────────────────────

type SettingsTab = 'general' | 'user-mgmt' | 'subscription-mgmt' | 'scheduler' | 'system' | 'audit';

const ALL_TABS: { id: SettingsTab; label: string; adminOnly?: boolean }[] = [
  { id: 'general',           label: 'General' },
  { id: 'user-mgmt',         label: 'User Management',         adminOnly: true },
  { id: 'subscription-mgmt', label: 'Subscription Management', adminOnly: true },
  { id: 'scheduler',         label: 'Scheduler' },
  { id: 'system',            label: 'System' },
  { id: 'audit',             label: 'Audit' },
];

// ── Main component ───────────────────────────────────────────────────────────

export function SettingsTab() {
  const [authUser, setAuthUser] = useState(() => getUser(getToken()));
  const isAdminOrOwner = authUser?.role === 'admin' || authUser?.role === 'owner';
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [uiLanguage, setUiLanguage] = useState<'en' | 'vi'>('vi');
  const detectedTimeZone = detectBrowserTimeZone();
  const [userTimeZone, setUserTimeZone] = useState(detectedTimeZone ?? DEFAULT_APP_TIMEZONE);
  const [userTimeZoneConfirmed, setUserTimeZoneConfirmed] = useState(false);
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
  const emailChannel = notificationChannels.find((channel) => channel.channelType === 'email') ?? null;
  const zaloChannel = notificationChannels.find((channel) => channel.channelType === 'zalo') ?? null;
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
      ? 'Add a Telegram chat ID below before alerts can be delivered.'
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
    void fetchCurrentUser()
      .then((user) => {
        if (!mounted || !user) return;
        setAuthUser(user);
      })
      .catch(() => undefined);
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (activeTab !== 'general') return;
    let mounted = true;
    fetchMonitorConfig()
      .then((config: LiveMonitorConfig) => {
        if (!mounted) return;
        setUiLanguage(config.UI_LANGUAGE || 'vi');
        setUserTimeZone(config.USER_TIMEZONE || detectedTimeZone || DEFAULT_APP_TIMEZONE);
        setUserTimeZoneConfirmed(config.USER_TIMEZONE_CONFIRMED === true && typeof config.USER_TIMEZONE === 'string');
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
  }, [activeTab, detectedTimeZone]);

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

  const handleTimeZoneChange = async (next: string) => {
    const previousTimeZone = userTimeZone;
    const previousConfirmed = userTimeZoneConfirmed;
    setUserTimeZone(next);
    setUserTimeZoneConfirmed(true);
    try {
      await persistMonitorConfig({ USER_TIMEZONE: next, USER_TIMEZONE_CONFIRMED: true });
      showToast(`Timezone -> ${next}`, 'success');
    } catch {
      setUserTimeZone(previousTimeZone);
      setUserTimeZoneConfirmed(previousConfirmed);
      showToast('Failed to save timezone', 'error');
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

  const getChannelPlaceholder = (channelType: NotificationChannelType) => {
    if (channelType === 'telegram') return 'Chat ID';
    if (channelType === 'email') return 'Email address';
    if (channelType === 'zalo') return 'Zalo recipient';
    return 'Address';
  };

  const handleChannelAddressSave = async (channel: NotificationChannelConfig) => {
    const address = (channelAddresses[channel.channelType] ?? channel.address ?? '').trim();
    await saveChannel(channel.channelType, {
      address: address || null,
      enabled: channel.enabled,
    });
    showToast(`${channel.channelType.replace('_', ' ')} address saved`, 'success');
  };

  const timeZoneOptions = buildTimeZoneOptions(userTimeZone, detectedTimeZone);

  return (
    <div style={{ maxWidth: 860 }}>
      {/* Tab bar */}
      <div style={{
        display: 'flex', gap: '2px',
        borderBottom: '1px solid var(--gray-200)',
        marginBottom: '20px',
      }}>
        {ALL_TABS.filter((tab) => !tab.adminOnly || isAdminOrOwner).map((tab) => {
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

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--gray-100)', background: 'var(--gray-50)' }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--gray-700)' }}>Timezone</div>
              <div style={{ fontSize: '11px', color: 'var(--gray-400)', marginTop: '2px' }}>
                Controls how match times and day-group labels are displayed for your account.
              </div>
            </div>
            <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <select
                className="job-interval-select"
                value={userTimeZone}
                onChange={(e) => handleTimeZoneChange(e.target.value)}
                style={{ minWidth: '220px' }}
              >
                {timeZoneOptions.map((timeZone) => (
                  <option key={timeZone} value={timeZone}>{timeZone}</option>
                ))}
              </select>
              <div style={{ fontSize: '11px', color: 'var(--gray-500)' }}>
                Browser detected: {detectedTimeZone ?? 'Unavailable'}
                {userTimeZoneConfirmed ? ' · Confirmed' : ' · Auto-detected'}
              </div>
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
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: '1 1 320px' }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
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
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
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
                {telegramChannel && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: '1 1 100%', flexWrap: 'wrap' }}>
                    <input
                      type="text"
                      className="filter-input"
                      value={channelAddresses['telegram'] ?? telegramChannel.address ?? ''}
                      placeholder={getChannelPlaceholder('telegram')}
                      onChange={(e) => setChannelAddresses((prev) => ({ ...prev, telegram: e.target.value }))}
                      style={{ minWidth: '220px', flex: '1 1 260px', background: 'white' }}
                    />
                    <button
                      className="btn btn-secondary"
                      disabled={channelSaving['telegram'] === true}
                      onClick={() => {
                        void handleChannelAddressSave(telegramChannel).catch(() => {
                          showToast('Failed to save notification channel', 'error');
                        });
                      }}
                    >
                      {channelSaving['telegram'] === true ? 'Saving...' : 'Save Chat ID'}
                    </button>
                  </div>
                )}
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
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
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

              {emailChannel && (
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '12px 14px', borderRadius: '8px',
                  border: '1px solid var(--gray-200)',
                  background: 'var(--gray-50)',
                  gap: '12px', flexWrap: 'wrap',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: '1 1 320px' }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--gray-900)' }}>Email</span>
                        <span style={{ fontSize: '10px', fontWeight: 700, padding: '1px 6px', borderRadius: '999px', background: 'var(--gray-100)', color: getChannelStatusColor(emailChannel.status) }}>
                          {emailChannel.status.toUpperCase()}
                        </span>
                        <span style={{ fontSize: '10px', fontWeight: 700, padding: '1px 6px', borderRadius: '999px', background: '#fef3c7', color: '#92400e' }}>
                          Sender pending
                        </span>
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--gray-500)', marginTop: '1px' }}>
                        {getChannelDescription(emailChannel)}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
                    <Toggle on={false} onChange={() => {}} disabled label="Toggle Email notifications" />
                    <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--gray-400)', minWidth: 26 }}>OFF</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: '1 1 100%', flexWrap: 'wrap' }}>
                    <input
                      type="text"
                      className="filter-input"
                      value={channelAddresses['email'] ?? emailChannel.address ?? ''}
                      placeholder={getChannelPlaceholder('email')}
                      onChange={(e) => setChannelAddresses((prev) => ({ ...prev, email: e.target.value }))}
                      style={{ minWidth: '220px', flex: '1 1 260px', background: 'white' }}
                    />
                    <button
                      className="btn btn-secondary"
                      disabled={channelSaving['email'] === true}
                      onClick={() => {
                        void handleChannelAddressSave(emailChannel).catch(() => {
                          showToast('Failed to save notification channel', 'error');
                        });
                      }}
                    >
                      {channelSaving['email'] === true ? 'Saving...' : 'Save Email'}
                    </button>
                  </div>
                </div>
              )}

              {zaloChannel && (
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '12px 14px', borderRadius: '8px',
                  border: '1px solid var(--gray-200)',
                  background: 'var(--gray-50)',
                  gap: '12px', flexWrap: 'wrap', opacity: 0.75,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: '1 1 320px' }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--gray-900)' }}>Zalo</span>
                      <span style={{ fontSize: '10px', fontWeight: 700, padding: '1px 6px', borderRadius: '999px', background: 'var(--gray-100)', color: getChannelStatusColor(zaloChannel.status) }}>
                        {zaloChannel.status.toUpperCase()}
                      </span>
                      <span style={{ fontSize: '10px', fontWeight: 700, padding: '1px 6px', borderRadius: '999px', background: '#fde68a', color: '#92400e' }}>
                        Coming soon
                      </span>
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--gray-500)', marginTop: '1px' }}>{getChannelDescription(zaloChannel)}</div>
                  </div>
                </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
                    <Toggle on={false} onChange={() => {}} disabled label="Toggle Zalo notifications" />
                    <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--gray-400)', minWidth: 26 }}>OFF</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: '1 1 100%', flexWrap: 'wrap' }}>
                    <input
                      type="text"
                      className="filter-input"
                      value={channelAddresses['zalo'] ?? zaloChannel.address ?? ''}
                      placeholder={getChannelPlaceholder('zalo')}
                      onChange={(e) => setChannelAddresses((prev) => ({ ...prev, zalo: e.target.value }))}
                      style={{ minWidth: '220px', flex: '1 1 260px', background: 'white' }}
                    />
                    <button
                      className="btn btn-secondary"
                      disabled={channelSaving['zalo'] === true}
                      onClick={() => {
                        void handleChannelAddressSave(zaloChannel).catch(() => {
                          showToast('Failed to save notification channel', 'error');
                        });
                      }}
                    >
                      {channelSaving['zalo'] === true ? 'Saving...' : 'Save Zalo'}
                    </button>
                  </div>
                </div>
              )}

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
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>
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

      {/* Tab: User Management (admin/owner only) */}
      {activeTab === 'user-mgmt' && isAdminOrOwner && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px' }}>
            <UserManagementPanel currentUserId={authUser?.userId ?? null} currentUserRole={authUser?.role ?? null} />
          </div>
        </div>
      )}

      {/* Tab: Subscription Management (admin/owner only) */}
      {activeTab === 'subscription-mgmt' && isAdminOrOwner && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px' }}>
            <SubscriptionManagementPanel />
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
