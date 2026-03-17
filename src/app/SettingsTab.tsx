import { useState, useEffect, useCallback } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useToast } from '@/hooks/useToast';
import { formatLocalTimeFull } from '@/lib/utils/helpers';

interface JobInfo {
  name: string;
  intervalMs: number;
  lastRun: string | null;
  lastError: string | null;
  running: boolean;
  enabled: boolean;
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

const JOB_LABELS: Record<string, string> = {
  'fetch-matches': '⚽ Fetch Matches',
  'update-predictions': '🔮 Update Predictions',
  'expire-watchlist': '🧹 Expire Watchlist',
  'check-live-trigger': '📡 Check Live Matches',
};

function JobSchedulerPanel() {
  const { state } = useAppState();
  const { showToast } = useToast();
  const [jobs, setJobs] = useState<JobInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const apiUrl = state.config.apiUrl;

  const fetchJobs = useCallback(async () => {
    if (!apiUrl) return;
    try {
      const res = await fetch(`${apiUrl}/api/jobs`);
      if (res.ok) setJobs(await res.json());
    } catch { /* server offline */ }
  }, [apiUrl]);

  useEffect(() => {
    fetchJobs();
    const id = setInterval(fetchJobs, 5000);
    return () => clearInterval(id);
  }, [fetchJobs]);

  const handleIntervalChange = async (name: string, intervalMs: number) => {
    try {
      const res = await fetch(`${apiUrl}/api/jobs/${name}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intervalMs }),
      });
      if (res.ok) {
        const updated: JobInfo = await res.json();
        setJobs((prev) => prev.map((j) => (j.name === updated.name ? updated : j)));
        showToast(`✅ ${JOB_LABELS[name] || name} → ${intervalMs === 0 ? 'disabled' : `${intervalMs / 1000}s`}`, 'success');
      }
    } catch {
      showToast('❌ Failed to update job', 'error');
    }
  };

  const handleTrigger = async (name: string) => {
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/jobs/${name}/trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (res.ok) {
        const updated: JobInfo = await res.json();
        setJobs((prev) => prev.map((j) => (j.name === updated.name ? updated : j)));
        showToast(`✅ ${JOB_LABELS[name] || name} executed`, updated.lastError ? 'error' : 'success');
      }
    } catch {
      showToast('❌ Failed to trigger job', 'error');
    } finally {
      setLoading(false);
    }
  };

  if (!apiUrl) {
    return <p style={{ color: 'var(--gray-500)' }}>Backend URL not configured (VITE_API_URL)</p>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {jobs.map((job) => (
        <div key={job.name} style={{
          display: 'flex', alignItems: 'center', gap: '12px', padding: '12px',
          background: 'var(--bg-secondary, #f8f9fa)', borderRadius: '8px', flexWrap: 'wrap',
        }}>
          <div style={{ flex: '1', minWidth: '180px' }}>
            <strong>{JOB_LABELS[job.name] || job.name}</strong>
            <div style={{ fontSize: '12px', color: 'var(--gray-500)', marginTop: '4px' }}>
              {job.lastRun ? `Last: ${formatLocalTimeFull(job.lastRun)}` : 'Never run'}
              {job.lastError && <span style={{ color: 'var(--danger, red)', marginLeft: '8px' }}>⚠ {job.lastError}</span>}
              {job.running && <span style={{ color: 'var(--primary, dodgerblue)', marginLeft: '8px' }}>⏳ Running...</span>}
            </div>
          </div>
          <select
            value={job.intervalMs}
            onChange={(e) => handleIntervalChange(job.name, Number(e.target.value))}
            style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--gray-300, #ccc)' }}
          >
            {INTERVAL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <button
            className="btn btn-primary"
            onClick={() => handleTrigger(job.name)}
            disabled={loading || job.running}
            style={{ padding: '6px 14px', fontSize: '13px' }}
          >
            ▶ Run
          </button>
        </div>
      ))}
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
        <div className="card-title">⚙️ Settings</div>
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
        <div className="card-title">🔄 Job Scheduler</div>
      </div>
      <div style={{ padding: '20px' }}>
        <JobSchedulerPanel />
      </div>
    </div>
  );
}
