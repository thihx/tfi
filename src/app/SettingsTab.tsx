import { useState, useEffect, useCallback, useRef } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useToast } from '@/hooks/useToast';
import { formatLocalTimeFull } from '@/lib/utils/helpers';

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
  intervalMs: number;
  lastRun: string | null;
  lastError: string | null;
  running: boolean;
  enabled: boolean;
  runCount: number;
  progress: JobProgress | null;
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
];

const JOB_META: Record<string, { label: string; description: string }> = {
  'fetch-matches': {
    label: 'Fetch Matches',
    description: 'Fetches fixtures from Football API for active leagues, archives finished matches, and auto-adds top league NS matches to watchlist.',
  },
  'update-predictions': {
    label: 'Update Predictions',
    description: 'Fetches prediction data from Football API for all upcoming (NS) watchlist matches.',
  },
  'expire-watchlist': {
    label: 'Expire Watchlist',
    description: 'Marks watchlist entries as expired when kickoff time + 120 minutes has passed.',
  },
  'check-live-trigger': {
    label: 'Check Live Matches',
    description: 'Detects currently live watchlist matches and increments their check counters.',
  },
  'auto-settle': {
    label: 'Auto Settle',
    description: 'Settles pending recommendations and bets using final match scores from history or Football API.',
  },
  'enrich-watchlist': {
    label: 'Enrich Watchlist',
    description: 'Uses AI (Gemini) and web search to add strategic context and generate recommended conditions for watchlist entries.',
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
      const res = await fetch(`${apiUrl}/api/jobs`);
      if (res.ok) setJobs(await res.json());
    } catch { /* server offline */ }
  }, [apiUrl]);

  // Poll faster when a job is running (2s) vs idle (5s)
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
        headers: { 'Content-Type': 'application/json' },
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(force ? { force: true } : {}),
      });
      if (res.ok) {
        // Trigger accepted — progress will appear via polling
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
      {jobs.map((job) => {
        const meta = JOB_META[job.name];
        const label = meta?.label || job.name;
        const description = meta?.description || '';
        const progress = job.progress;
        const isRunning = job.running;
        const isCompleted = progress?.completedAt && !isRunning;
        const hasError = !!job.lastError || !!progress?.error;
        const percent = progress?.percent ?? 0;

        return (
          <div key={job.name} className={`job-card${isRunning ? ' job-running' : ''}${hasError ? ' job-error' : ''}`}>
            <div className="job-header">
              <div className="job-info">
                <div className="job-label">{label}</div>
                <div className="job-description">{description}</div>
                <div className="job-meta">
                  {job.lastRun ? `Last run: ${formatLocalTimeFull(job.lastRun)}` : 'Never run'}
                  {job.runCount > 0 && <span className="job-run-count"> (#{job.runCount})</span>}
                  {job.lastError && !isRunning && (
                    <span className="job-error-text"> | Error: {job.lastError}</span>
                  )}
                </div>
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
                  disabled={isRunning || triggering.has(job.name)}
                >
                  {isRunning ? 'Running...' : 'Run'}
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

            {/* Progress bar — visible when running or just completed */}
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

export function SettingsTab() {
  const { state, saveConfig } = useAppState();
  const { showToast } = useToast();
  const { config } = state;

  const [defaultMode, setDefaultMode] = useState(config.defaultMode);
  const [newPassword, setNewPassword] = useState('');

  useEffect(() => {
    setDefaultMode(config.defaultMode);
  }, [config]);

  const handleSave = () => {
    saveConfig({ ...config, defaultMode });
    if (newPassword) {
      showToast('⚠️ Password change requires code update', 'error');
    } else {
      showToast('✅ Settings saved!', 'success');
    }
  };

  return (
    <div className="card">
      <div className="card-header">
      </div>
      <div style={{ padding: '20px' }}>
        <div className="form-group">
          <label>Default Betting Mode:</label>
          <select value={defaultMode} onChange={(e) => setDefaultMode(e.target.value)}>
            <option value="A">A - Aggressive</option>
            <option value="B">B - Balanced</option>
            <option value="C">C - Conservative</option>
          </select>
        </div>
        <div className="form-group">
          <label>Change Password:</label>
          <input type="password" placeholder="New password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          <small style={{ color: 'var(--gray-500)', display: 'block', marginTop: '5px' }}>
            Note: Requires code update to change password hash
          </small>
        </div>
        <button className="btn btn-primary" onClick={handleSave}>💾 Save Settings</button>
      </div>

      {/* Job Scheduler Section */}
      <div className="card-header" style={{ marginTop: '16px' }}>
        <div className="card-title">Job Scheduler</div>
      </div>
      <div style={{ padding: '20px' }}>
        <JobSchedulerPanel />
      </div>
    </div>
  );
}
