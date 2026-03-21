// ============================================================
// Live Monitor Tab — Real-time pipeline control & results
// ============================================================

import { useState, useCallback, useEffect } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useScheduler } from '@/features/live-monitor/useScheduler';
import type { PipelineContext, PipelineMatchResult, LiveMonitorConfig } from '@/features/live-monitor/types';
import { createDefaultConfig, fetchMonitorConfig, persistMonitorConfig } from '@/features/live-monitor/config';
import { formatLocalDateTime } from '@/lib/utils/helpers';

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
        <div className="card-title">Scheduler Control</div>
        <span style={{ color: statusColor, fontWeight: 600 }}>{statusLabel}</span>
      </div>
      <div style={{ padding: '20px' }}>
        <div className="monitor-controls">
          <div className="control-group">
            <label>Interval (minutes)</label>
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
              {formatLocalDateTime(lastRun)}
            </span>
          </div>
          <div className="monitor-stat">
            <span className="monitor-stat-label">Next Run</span>
            <span className="monitor-stat-value">
              {formatLocalDateTime(nextRunAt)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ConfigPanel() {
  const [config, setConfig] = useState<LiveMonitorConfig>(() => createDefaultConfig());
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMonitorConfig().then((c) => { setConfig(c); setLoading(false); });
  }, []);

  const update = (key: keyof LiveMonitorConfig, value: string | number) => {
    setConfig((c) => ({ ...c, [key]: value }));
    setSaved(false);
    setSaveError('');
  };

  const handleSave = async () => {
    try {
      await persistMonitorConfig(config);
      setSaved(true);
      setSaveError('');
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error('[ConfigPanel] Save failed:', err);
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    }
  };

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title">Monitor Config</div>
        <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={loading}>
          {saved ? 'Saved!' : saveError ? '⚠ Error' : 'Save'}
        </button>
      </div>
      {saveError && <div style={{ padding: '8px 20px', color: 'var(--danger)', fontSize: '13px' }}>{saveError}</div>}
      <div style={{ padding: '20px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '20px', color: 'var(--gray-500)' }}>Loading config…</div>
        ) : (
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
          <div className="config-field">
            <label>Push Notification Language</label>
            <select
              className="monitor-input"
              value={config.NOTIFICATION_LANGUAGE}
              onChange={(e) => update('NOTIFICATION_LANGUAGE', e.target.value)}
            >
              <option value="en">English</option>
              <option value="vi">Tiếng Việt</option>
            </select>
          </div>
        </div>
        )}
      </div>
    </div>
  );
}

function PipelineStageIndicator({ stage }: { stage: PipelineContext['stage'] }) {
  const stages: { key: PipelineContext['stage']; label: string; icon: string }[] = [
    { key: 'loading-watchlist', label: 'Watchlist', icon: '📋' },
    { key: 'fetching-live-data', label: 'Live Data', icon: '📡' },
    { key: 'merging-data', label: 'Merge', icon: '🔀' },
    { key: 'checking-staleness', label: 'Staleness', icon: '🔍' },
    { key: 'fetching-context', label: 'Context', icon: '📚' },
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

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.min(100, Math.max(0, (value / 10) * 100));
  const color = value >= 7 ? '#10b981' : value >= 5 ? '#f59e0b' : '#ef4444';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '100px' }}>
      <div style={{
        flex: 1, height: '6px', borderRadius: '3px',
        background: 'var(--gray-100)',
        overflow: 'hidden',
      }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: '3px', transition: 'width 0.3s' }} />
      </div>
      <span style={{ fontSize: '12px', fontWeight: 600, color, minWidth: '28px' }}>{value}/10</span>
    </div>
  );
}

function RiskChip({ level }: { level: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    LOW:    { bg: '#d1fae5', color: '#065f46' },
    MEDIUM: { bg: '#fef3c7', color: '#92400e' },
    HIGH:   { bg: '#fee2e2', color: '#991b1b' },
  };
  const style = map[level?.toUpperCase()] ?? { bg: '#f3f4f6', color: '#6b7280' };
  return (
    <span style={{
      padding: '2px 8px', borderRadius: '10px',
      fontSize: '11px', fontWeight: 700, letterSpacing: '0.3px',
      background: style.bg, color: style.color,
    }}>
      {level || 'N/A'}
    </span>
  );
}

function MatchResultRow({ result }: { result: PipelineMatchResult }) {
  const [expanded, setExpanded] = useState(false);
  const ai = result.parsedAi;

  const hasPlay = !!(ai?.ai_selection);
  const isError = result.stage === 'error';

  const statusDot = isError ? '#ef4444'
    : result.notified ? '#6366f1'
    : hasPlay ? '#10b981'
    : '#d1d5db';

  return (
    <div style={{
      borderBottom: '1px solid var(--gray-100)',
      opacity: (!hasPlay && !isError) ? 0.6 : 1,
      transition: 'opacity 0.15s',
    }}>
      {/* Main row */}
      <div
        onClick={() => ai?.reasoning_vi && setExpanded((v) => !v)}
        style={{
          display: 'grid',
          gridTemplateColumns: '8px 1fr 140px 80px 120px 80px 80px 28px',
          alignItems: 'center',
          gap: '12px',
          padding: '12px 16px',
          cursor: ai?.reasoning_vi ? 'pointer' : 'default',
          background: expanded ? 'var(--gray-50)' : 'transparent',
          transition: 'background 0.1s',
        }}
      >
        {/* Status dot */}
        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: statusDot, flexShrink: 0 }} />

        {/* Match name + badges */}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--gray-800)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {result.matchDisplay}
          </div>
          <div style={{ display: 'flex', gap: '4px', marginTop: '3px', flexWrap: 'wrap' }}>
            {result.notified && <span className="badge badge-active" style={{ fontSize: '10px', padding: '1px 6px' }}>Notified</span>}
            {result.saved && <span className="badge badge-won" style={{ fontSize: '10px', padding: '1px 6px' }}>Saved</span>}
            {result.skippedStale && <span className="badge badge-ht" style={{ fontSize: '10px', padding: '1px 6px' }}>Stale</span>}
            {isError && <span className="badge badge-lost" style={{ fontSize: '10px', padding: '1px 6px' }}>Error</span>}
          </div>
        </div>

        {/* Confidence bar */}
        {ai ? <ConfidenceBar value={ai.ai_confidence ?? 0} /> : <span style={{ color: 'var(--gray-400)', fontSize: '12px' }}>—</span>}

        {/* Risk */}
        {ai ? <RiskChip level={ai.risk_level || 'HIGH'} /> : <span style={{ color: 'var(--gray-400)', fontSize: '12px' }}>—</span>}

        {/* Selection + Market */}
        <div style={{ minWidth: 0 }}>
          {ai?.ai_selection ? (
            <>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--gray-800)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ai.ai_selection}</div>
              <div style={{ fontSize: '11px', color: 'var(--gray-500)', marginTop: '1px' }}>{ai.bet_market || '—'}</div>
            </>
          ) : (
            <span style={{ color: 'var(--gray-400)', fontSize: '12px' }}>No play</span>
          )}
        </div>

        {/* Odds */}
        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--gray-700)' }}>
          {ai?.odds_for_display ?? '—'}
        </span>

        {/* Stake */}
        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--gray-700)' }}>
          {ai?.stake_percent ? `${ai.stake_percent}%` : '—'}
        </span>

        {/* Expand chevron */}
        {ai?.reasoning_vi ? (
          <span style={{ color: 'var(--gray-400)', fontSize: '12px', transition: 'transform 0.2s', display: 'inline-block', transform: expanded ? 'rotate(180deg)' : 'none' }}>▼</span>
        ) : <span />}
      </div>

      {/* Expanded analysis */}
      {expanded && ai?.reasoning_vi && (
        <div style={{ padding: '0 16px 14px 36px', borderTop: '1px solid var(--gray-100)' }}>
          <p style={{ fontSize: '13px', color: 'var(--gray-600)', lineHeight: 1.65, margin: '12px 0 0' }}>
            {ai.reasoning_vi}
          </p>
          {ai.warnings && ai.warnings.length > 0 && (
            <div style={{ display: 'flex', gap: '6px', marginTop: '10px', flexWrap: 'wrap' }}>
              {ai.warnings.map((w, i) => (
                <span key={i} style={{
                  padding: '2px 8px', borderRadius: '6px',
                  fontSize: '11px', fontWeight: 600,
                  background: '#fef3c7', color: '#92400e',
                }}>⚠ {w}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {isError && result.error && (
        <div style={{ padding: '6px 16px 10px 36px', color: 'var(--danger)', fontSize: '12px' }}>
          ❌ {result.error}
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
                <div className="card-title">Pipeline Progress</div>
                <small style={{ color: 'var(--gray-500)' }}>
                  {ctx.triggeredBy === 'scheduled' ? 'Scheduled' : 'Manual'} —{' '}
                  {ctx.startedAt ? formatLocalDateTime(ctx.startedAt) : ''}
                </small>
              </div>
              <div style={{ padding: '16px 20px' }}>
                <PipelineStageIndicator stage={ctx.stage} />
              </div>
            </div>
          )}

          {/* Match Results */}
          {ctx && ctx.results.length > 0 ? (
            <div className="card" style={{ overflow: 'hidden' }}>
              {/* Header */}
              <div className="card-header">
                <div className="card-title">
                  🎯 Results ({ctx.results.length} match{ctx.results.length > 1 ? 'es' : ''})
                </div>
                <div style={{ display: 'flex', gap: '16px', fontSize: '12px' }}>
                  {[
                    { label: 'Analyzed', count: ctx.results.filter((r) => r.proceeded).length, color: '#10b981' },
                    { label: 'Notified', count: ctx.results.filter((r) => r.notified).length, color: '#6366f1' },
                    { label: 'Saved',    count: ctx.results.filter((r) => r.saved).length,    color: '#f59e0b' },
                  ].map(({ label, count, color }) => (
                    <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: color }} />
                      <span style={{ color: 'var(--gray-500)' }}>{count} {label}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Scrollable table body */}
              <div style={{ overflowX: 'auto' }}>
                <div style={{ minWidth: '700px' }}>
                  {/* Column headers */}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: '8px 1fr 140px 80px 120px 80px 80px 28px',
                    gap: '12px',
                    padding: '8px 16px',
                    background: 'var(--gray-50)',
                    borderBottom: '1px solid var(--gray-200)',
                  }}>
                    <span />
                    <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Match</span>
                    <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Confidence</span>
                    <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Risk</span>
                    <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Selection</span>
                    <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Odds</span>
                    <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Stake</span>
                    <span />
                  </div>

                  {/* Rows — sorted: has play first */}
                  {[...ctx.results]
                    .sort((a, b) => {
                      const aPlay = a.parsedAi?.ai_selection ? 1 : 0;
                      const bPlay = b.parsedAi?.ai_selection ? 1 : 0;
                      return bPlay - aPlay;
                    })
                    .map((r, i) => (
                      <MatchResultRow key={r.matchId || i} result={r} />
                    ))
                  }
                </div>
              </div>
            </div>
          ) : ctx ? (
            <div className="card">
              <div style={{ padding: '32px 20px', textAlign: 'center' }}>
                <div style={{ fontSize: '48px', marginBottom: '16px' }}>✅</div>
                <p style={{ color: 'var(--gray-500)', fontSize: '16px' }}>
                  Pipeline completed — no active matches to analyze.
                </p>
                <p style={{ color: 'var(--gray-400)', fontSize: '13px', marginTop: '8px' }}>
                  Add matches to the Watchlist with status <strong>NS</strong> (Not Started) or wait for live matches (1H/2H).
                  Last run: {ctx.startedAt ? formatLocalDateTime(ctx.startedAt) : '—'}
                </p>
              </div>
            </div>
          ) : (
              <div className="card">
                <div style={{ padding: '32px 20px', textAlign: 'center' }}>
                  <div style={{ fontSize: '48px', marginBottom: '16px' }}>📡</div>
                  <p style={{ color: 'var(--gray-500)', fontSize: '16px' }}>
                    No results yet. Press <strong>Run Once</strong> or <strong>Start</strong> the scheduler.
                  </p>
                  <p style={{ color: 'var(--gray-400)', fontSize: '13px', marginTop: '8px' }}>
                    The pipeline will automatically scan the watchlist, fetch live data, run AI analysis, and send notifications.
                  </p>
                </div>
              </div>
            )
          }

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
