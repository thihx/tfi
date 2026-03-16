// ============================================================
// Live Monitor Tab — Real-time pipeline control & results
// ============================================================

import { useState, useCallback } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useScheduler } from '@/features/live-monitor/useScheduler';
import type { PipelineContext, PipelineMatchResult, LiveMonitorConfig } from '@/features/live-monitor/types';
import { loadMonitorConfig, saveMonitorConfig } from '@/features/live-monitor/config';

// ==================== Sub-components ====================

function SchedulerControls({
  status,
  intervalMs,
  runCount,
  errorCount,
  lastRun,
  nextRunAt,
  onStart,
  onStop,
  onPause,
  onResume,
  onRunOnce,
  running,
}: {
  status: string;
  intervalMs: number;
  runCount: number;
  errorCount: number;
  lastRun: string | null;
  nextRunAt: string | null;
  onStart: (intervalMs: number) => void;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
  onRunOnce: () => void;
  running: boolean;
}) {
  const [interval, setInterval_] = useState(Math.round(intervalMs / 60_000));

  const statusColor =
    status === 'running' ? 'var(--success)' : status === 'paused' ? 'var(--warning)' : 'var(--gray-500)';

  const statusLabel = status === 'running' ? '🟢 Running' : status === 'paused' ? '🟡 Paused' : '⚪ Idle';

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title">🎮 Scheduler Control</div>
        <span style={{ color: statusColor, fontWeight: 600 }}>{statusLabel}</span>
      </div>
      <div style={{ padding: '20px' }}>
        <div className="monitor-controls">
          <div className="control-group">
            <label>Interval (phút)</label>
            <input
              type="number"
              min={1}
              max={60}
              value={interval}
              onChange={(e) => setInterval_(Number(e.target.value))}
              disabled={status === 'running'}
              className="monitor-input"
            />
          </div>
          <div className="control-buttons">
            {status === 'idle' && (
              <button className="btn btn-success btn-sm" onClick={() => onStart(interval * 60_000)}>
                ▶ Start
              </button>
            )}
            {status === 'running' && (
              <>
                <button className="btn btn-warning btn-sm" onClick={onPause}>⏸ Pause</button>
                <button className="btn btn-danger btn-sm" onClick={onStop}>⏹ Stop</button>
              </>
            )}
            {status === 'paused' && (
              <>
                <button className="btn btn-success btn-sm" onClick={onResume}>▶ Resume</button>
                <button className="btn btn-danger btn-sm" onClick={onStop}>⏹ Stop</button>
              </>
            )}
            <button className="btn btn-primary btn-sm" onClick={onRunOnce} disabled={running}>
              {running ? '⏳ Running...' : '🔄 Run Once'}
            </button>
          </div>
        </div>
        <div className="monitor-stats-row">
          <div className="monitor-stat">
            <span className="monitor-stat-label">Runs</span>
            <span className="monitor-stat-value">{runCount}</span>
          </div>
          <div className="monitor-stat">
            <span className="monitor-stat-label">Errors</span>
            <span className="monitor-stat-value" style={{ color: errorCount > 0 ? 'var(--danger)' : undefined }}>
              {errorCount}
            </span>
          </div>
          <div className="monitor-stat">
            <span className="monitor-stat-label">Last Run</span>
            <span className="monitor-stat-value">
              {lastRun ? new Date(lastRun).toLocaleTimeString('vi-VN') : '—'}
            </span>
          </div>
          <div className="monitor-stat">
            <span className="monitor-stat-label">Next Run</span>
            <span className="monitor-stat-value">
              {nextRunAt ? new Date(nextRunAt).toLocaleTimeString('vi-VN') : '—'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ConfigPanel() {
  const [config, setConfig] = useState(() => loadMonitorConfig());
  const [saved, setSaved] = useState(false);

  const update = (key: keyof LiveMonitorConfig, value: string | number) => {
    setConfig((c) => ({ ...c, [key]: value }));
    setSaved(false);
  };

  const handleSave = () => {
    saveMonitorConfig(config);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title">⚙️ Monitor Config</div>
        <button className="btn btn-primary btn-sm" onClick={handleSave}>
          {saved ? '✅ Saved!' : '💾 Save'}
        </button>
      </div>
      <div style={{ padding: '20px' }}>
        <div className="config-grid">
          <div className="config-field">
            <label>AI Provider</label>
            <select
              className="monitor-input"
              value={config.AI_PROVIDER}
              onChange={(e) => update('AI_PROVIDER', e.target.value)}
            >
              <option value="gemini">Gemini</option>
              <option value="claude">Claude</option>
            </select>
          </div>
          <div className="config-field">
            <label>AI Model</label>
            <input
              className="monitor-input"
              value={config.AI_MODEL}
              onChange={(e) => update('AI_MODEL', e.target.value)}
            />
          </div>
          <div className="config-field">
            <label>Min Confidence (0-10)</label>
            <input
              type="number"
              className="monitor-input"
              min={0}
              max={10}
              value={config.MIN_CONFIDENCE}
              onChange={(e) => update('MIN_CONFIDENCE', Number(e.target.value))}
            />
          </div>
          <div className="config-field">
            <label>Min Odds</label>
            <input
              type="number"
              className="monitor-input"
              step={0.1}
              min={1}
              value={config.MIN_ODDS}
              onChange={(e) => update('MIN_ODDS', Number(e.target.value))}
            />
          </div>
          <div className="config-field">
            <label>Min Minute</label>
            <input
              type="number"
              className="monitor-input"
              min={0}
              max={90}
              value={config.MIN_MINUTE}
              onChange={(e) => update('MIN_MINUTE', Number(e.target.value))}
            />
          </div>
          <div className="config-field">
            <label>Max Minute</label>
            <input
              type="number"
              className="monitor-input"
              min={0}
              max={95}
              value={config.MAX_MINUTE}
              onChange={(e) => update('MAX_MINUTE', Number(e.target.value))}
            />
          </div>
          <div className="config-field">
            <label>Late Phase (min)</label>
            <input
              type="number"
              className="monitor-input"
              value={config.LATE_PHASE_MINUTE}
              onChange={(e) => update('LATE_PHASE_MINUTE', Number(e.target.value))}
            />
          </div>
          <div className="config-field">
            <label>Email To</label>
            <input
              className="monitor-input"
              value={config.EMAIL_TO}
              onChange={(e) => update('EMAIL_TO', e.target.value)}
            />
          </div>
          <div className="config-field">
            <label>Telegram Chat ID</label>
            <input
              className="monitor-input"
              value={config.TELEGRAM_CHAT_ID}
              onChange={(e) => update('TELEGRAM_CHAT_ID', e.target.value)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function PipelineStageIndicator({ stage }: { stage: PipelineContext['stage'] }) {
  const stages: { key: PipelineContext['stage']; label: string; icon: string }[] = [
    { key: 'loading-watchlist', label: 'Watchlist', icon: '📋' },
    { key: 'fetching-live-data', label: 'Live Data', icon: '📡' },
    { key: 'merging-data', label: 'Merge', icon: '🔀' },
    { key: 'ai-analysis', label: 'AI Analysis', icon: '🤖' },
    { key: 'notifying', label: 'Notify', icon: '📨' },
    { key: 'complete', label: 'Done', icon: '✅' },
  ];

  const currentIdx = stages.findIndex((s) => s.key === stage);

  return (
    <div className="pipeline-stages">
      {stages.map((s, i) => {
        const isActive = s.key === stage;
        const isDone = currentIdx > i || stage === 'complete';
        const cls = isActive ? 'stage-active' : isDone ? 'stage-done' : 'stage-pending';
        return (
          <div key={s.key} className={`pipeline-stage ${cls}`}>
            <span className="stage-icon">{isDone && !isActive ? '✓' : s.icon}</span>
            <span className="stage-label">{s.label}</span>
          </div>
        );
      })}
    </div>
  );
}

function MatchResultCard({ result }: { result: PipelineMatchResult }) {
  const ai = result.parsedAi;
  const rec = result.recommendation;

  return (
    <div className={`monitor-match-card ${result.stage === 'error' ? 'match-error' : result.notified ? 'match-notified' : ''}`}>
      <div className="match-card-header">
        <strong>{result.matchDisplay}</strong>
        <div className="match-card-badges">
          {result.proceeded && <span className="badge badge-live">Analyzed</span>}
          {result.notified && <span className="badge badge-active">Notified</span>}
          {result.saved && <span className="badge badge-won">Saved</span>}
          {result.stage === 'error' && <span className="badge badge-lost">Error</span>}
          {!result.proceeded && result.stage === 'complete' && <span className="badge badge-ns">Skipped</span>}
        </div>
      </div>

      {ai && (
        <div className="match-card-body">
          <div className="match-ai-grid">
            <div>
              <span className="ai-label">Selection</span>
              <span className="ai-value">{ai.ai_selection || '—'}</span>
            </div>
            <div>
              <span className="ai-label">Market</span>
              <span className="ai-value">{ai.bet_market || '—'}</span>
            </div>
            <div>
              <span className="ai-label">Confidence</span>
              <span className="ai-value">{ai.ai_confidence}/10</span>
            </div>
            <div>
              <span className="ai-label">Odds</span>
              <span className="ai-value">{ai.odds_for_display ?? '—'}</span>
            </div>
            <div>
              <span className="ai-label">Risk</span>
              <span className={`ai-value risk-${(ai.risk_level || 'HIGH').toLowerCase()}`}>
                {ai.risk_level || 'N/A'}
              </span>
            </div>
            <div>
              <span className="ai-label">Stake</span>
              <span className="ai-value">{ai.stake_percent ? `${ai.stake_percent}%` : '—'}</span>
            </div>
          </div>
          {ai.reasoning_vi && (
            <div className="match-reasoning">
              <small>{ai.reasoning_vi}</small>
            </div>
          )}
          {ai.warnings && ai.warnings.length > 0 && (
            <div className="match-warnings">
              {ai.warnings.map((w, i) => (
                <span key={i} className="warning-tag">⚠ {w}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {rec && (
        <div className="match-card-footer">
          <small style={{ color: 'var(--gray-500)' }}>
            Key: {rec.unique_key} | Factors: {rec.key_factors || '—'}
          </small>
        </div>
      )}

      {result.error && (
        <div className="match-card-error">
          <small>❌ {result.error}</small>
        </div>
      )}
    </div>
  );
}

// ==================== Main Tab ====================

export function LiveMonitorTab() {
  const { state } = useAppState();
  const appConfig = state.config;
  const scheduler = useScheduler(appConfig);
  const [manualRunning, setManualRunning] = useState(false);
  const [lastCtx, setLastCtx] = useState<PipelineContext | null>(null);
  const [showConfig, setShowConfig] = useState(false);

  const handleStart = useCallback(
    (intervalMs: number) => {
      scheduler.start({ intervalMs });
    },
    [scheduler],
  );

  const handleRunOnce = useCallback(async () => {
    setManualRunning(true);
    try {
      const ctx = await scheduler.runOnce();
      setLastCtx(ctx);
    } finally {
      setManualRunning(false);
    }
  }, [scheduler]);

  // Use scheduler's lastResult or manual run result
  const ctx = scheduler.lastResult ?? lastCtx;

  return (
    <div className="live-monitor-tab">
      <SchedulerControls
        status={scheduler.status}
        intervalMs={scheduler.intervalMs}
        runCount={scheduler.runCount}
        errorCount={scheduler.errorCount}
        lastRun={scheduler.lastRun}
        nextRunAt={scheduler.nextRunAt}
        onStart={handleStart}
        onStop={scheduler.stop}
        onPause={scheduler.pause}
        onResume={scheduler.resume}
        onRunOnce={handleRunOnce}
        running={manualRunning}
      />

      <div style={{ marginBottom: '16px', display: 'flex', gap: '8px' }}>
        <button
          className={`btn btn-sm ${showConfig ? 'btn-secondary' : 'btn-primary'}`}
          onClick={() => setShowConfig((v) => !v)}
        >
          {showConfig ? '📊 Show Results' : '⚙️ Config'}
        </button>
      </div>

      {showConfig ? (
        <ConfigPanel />
      ) : (
        <>
          {/* Pipeline Stage Progress */}
          {ctx && ctx.stage !== 'idle' && (
            <div className="card" style={{ marginBottom: '16px' }}>
              <div className="card-header">
                <div className="card-title">📡 Pipeline Progress</div>
                <small style={{ color: 'var(--gray-500)' }}>
                  {ctx.triggeredBy === 'scheduled' ? '⏰ Scheduled' : '👆 Manual'} —{' '}
                  {ctx.startedAt ? new Date(ctx.startedAt).toLocaleTimeString('vi-VN') : ''}
                </small>
              </div>
              <div style={{ padding: '16px 20px' }}>
                <PipelineStageIndicator stage={ctx.stage} />
              </div>
            </div>
          )}

          {/* Match Results */}
          {ctx && ctx.results.length > 0 ? (
            <div className="card">
              <div className="card-header">
                <div className="card-title">
                  🎯 Results ({ctx.results.length} match{ctx.results.length > 1 ? 'es' : ''})
                </div>
                <div style={{ display: 'flex', gap: '12px', fontSize: '13px', color: 'var(--gray-500)' }}>
                  <span>✅ {ctx.results.filter((r) => r.proceeded).length} analyzed</span>
                  <span>📨 {ctx.results.filter((r) => r.notified).length} notified</span>
                  <span>💾 {ctx.results.filter((r) => r.saved).length} saved</span>
                </div>
              </div>
              <div style={{ padding: '16px' }}>
                {ctx.results.map((r, i) => (
                  <MatchResultCard key={r.matchId || i} result={r} />
                ))}
              </div>
            </div>
          ) : (
            !ctx && (
              <div className="card">
                <div style={{ padding: '60px 20px', textAlign: 'center' }}>
                  <div style={{ fontSize: '48px', marginBottom: '16px' }}>📡</div>
                  <p style={{ color: 'var(--gray-500)', fontSize: '16px' }}>
                    Chưa có kết quả. Nhấn <strong>Run Once</strong> hoặc <strong>Start</strong> scheduler.
                  </p>
                  <p style={{ color: 'var(--gray-400)', fontSize: '13px', marginTop: '8px' }}>
                    Pipeline sẽ tự động quét watchlist, fetch live data, AI analysis và gửi thông báo.
                  </p>
                </div>
              </div>
            )
          )}

          {/* Error display */}
          {ctx?.error && (
            <div className="card" style={{ borderLeft: '4px solid var(--danger)', marginTop: '16px' }}>
              <div style={{ padding: '16px 20px' }}>
                <strong style={{ color: 'var(--danger)' }}>❌ Pipeline Error</strong>
                <p style={{ marginTop: '8px', color: 'var(--gray-600)' }}>{ctx.error}</p>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
