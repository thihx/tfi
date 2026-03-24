import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useToast } from '@/hooks/useToast';
import { formatLocalDateTime } from '@/lib/utils/helpers';
import {
  fetchLiveMonitorStatus,
  getParsedAiResult,
  triggerCheckLiveRun,
  type LiveMonitorStatusResponse,
  type ServerMatchPipelineResult,
} from '@/features/live-monitor/services/server-monitor.service';

function formatInterval(intervalMs: number): string {
  if (intervalMs <= 0) return 'Disabled';
  if (intervalMs % 3_600_000 === 0) return `Every ${intervalMs / 3_600_000}h`;
  return `Every ${Math.round(intervalMs / 60_000)}m`;
}

function SummaryStat({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="monitor-stat">
      <span className="monitor-stat-label">{label}</span>
      <span className="monitor-stat-value" style={color ? { color } : undefined}>{value}</span>
    </div>
  );
}

function decisionKindLabel(kind: ServerMatchPipelineResult['decisionKind']): string {
  switch (kind) {
    case 'ai_push':
      return 'AI Push';
    case 'condition_only':
      return 'Condition Only';
    default:
      return 'No Bet';
  }
}

function promptDataLevelLabel(level: 'basic-only' | 'advanced-upgraded' | undefined): string {
  return level === 'advanced-upgraded' ? 'Advanced Prompt' : 'Basic Prompt';
}

function prematchStrengthLabel(
  strength: 'strong' | 'moderate' | 'weak' | 'none' | undefined,
): string {
  switch (strength) {
    case 'strong':
      return 'Prematch Strong';
    case 'moderate':
      return 'Prematch Moderate';
    case 'weak':
      return 'Prematch Weak';
    default:
      return 'No Prematch';
  }
}

function prematchStrengthBadgeClass(
  strength: 'strong' | 'moderate' | 'weak' | 'none' | undefined,
): string {
  switch (strength) {
    case 'strong':
      return 'badge-active';
    case 'moderate':
      return 'badge-pending';
    case 'weak':
      return 'badge-lost';
    default:
      return 'badge-pending';
  }
}

function ProgressCard({ status }: { status: LiveMonitorStatusResponse }) {
  if (!status.progress) return null;

  return (
    <div className="card" style={{ marginBottom: '16px' }}>
      <div className="card-header">
        <div className="card-title">Engine Progress</div>
        <small style={{ color: 'var(--gray-500)' }}>
          {status.progress.startedAt ? formatLocalDateTime(status.progress.startedAt) : '—'}
        </small>
      </div>
      <div style={{ padding: '16px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px', gap: '12px' }}>
          <strong>{status.progress.step || 'running'}</strong>
          <span style={{ color: 'var(--gray-500)', fontSize: '13px' }}>{status.progress.percent}%</span>
        </div>
        <div style={{ height: '10px', background: 'var(--gray-100)', borderRadius: '999px', overflow: 'hidden' }}>
          <div
            style={{
              width: `${status.progress.percent}%`,
              height: '100%',
              background: status.progress.error ? 'var(--danger)' : 'var(--primary)',
              transition: 'width 0.2s ease',
            }}
          />
        </div>
        <p style={{ margin: '10px 0 0', color: status.progress.error ? 'var(--danger)' : 'var(--gray-600)', fontSize: '13px' }}>
          {status.progress.error || status.progress.message}
        </p>
      </div>
    </div>
  );
}

function ResultRow({ result }: { result: ServerMatchPipelineResult }) {
  const parsed = getParsedAiResult(result);
  const matchTitle = result.matchDisplay || [result.homeName, result.awayName].filter(Boolean).join(' vs ') || result.matchId;
  const matchMeta = [result.league, result.minute != null ? `${result.minute}'` : null, result.score, result.status]
    .filter(Boolean)
    .join(' | ');
  const reasoning = parsed?.reasoning_vi || parsed?.reasoning_en || result.error || '';
  const warnings = Array.isArray(parsed?.warnings) ? parsed.warnings : [];
  const conditionReasoning = parsed?.condition_triggered_reasoning_vi || parsed?.condition_triggered_reasoning_en || '';
  const promptDataLevel = result.debug?.promptDataLevel;
  const prematchStrength = result.debug?.prematchStrength;
  const prematchAvailability = result.debug?.prematchAvailability;
  const prematchNoisePenalty = result.debug?.prematchNoisePenalty;
  const promptMeta = [
    result.debug?.promptVersion,
    promptDataLevel ? promptDataLevelLabel(promptDataLevel) : null,
    result.debug?.statsSource,
    result.debug?.evidenceMode,
  ].filter(Boolean).join(' | ');
  const prematchMeta = prematchAvailability
    ? `${prematchStrengthLabel(prematchStrength)} | ${prematchAvailability} | noise ${prematchNoisePenalty ?? 'n/a'}`
    : '';

  return (
    <div style={{ borderBottom: '1px solid var(--gray-100)', padding: '14px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', alignItems: 'flex-start', marginBottom: '8px' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '4px' }}>
            <strong style={{ fontSize: '13px' }}>{matchTitle}</strong>
            {result.shouldPush && <span className="badge badge-active">Push</span>}
            <span className="badge badge-pending">{decisionKindLabel(result.decisionKind)}</span>
            {parsed?.custom_condition_matched && <span className="badge badge-draw">Condition Matched</span>}
            {parsed?.condition_triggered_should_push && <span className="badge badge-pending">Condition Triggered</span>}
            {result.saved && <span className="badge badge-won">Saved</span>}
            {result.notified && <span className="badge badge-active">Notified</span>}
            {promptDataLevel && (
              <span className={`badge ${promptDataLevel === 'advanced-upgraded' ? 'badge-active' : 'badge-pending'}`}>
                {promptDataLevelLabel(promptDataLevel)}
              </span>
            )}
            {prematchStrength && prematchStrength !== 'none' && (
              <span className={`badge ${prematchStrengthBadgeClass(prematchStrength)}`}>
                {prematchStrengthLabel(prematchStrength)}
              </span>
            )}
            {!result.success && <span className="badge badge-lost">Error</span>}
          </div>
          <div style={{ fontSize: '13px', color: 'var(--gray-700)' }}>
            {result.selection || parsed?.selection || 'No actionable selection'}
          </div>
          {matchMeta && (
            <div style={{ fontSize: '12px', color: 'var(--gray-500)', marginTop: '2px' }}>
              {matchMeta}
            </div>
          )}
          {parsed?.bet_market && (
            <div style={{ fontSize: '12px', color: 'var(--gray-500)', marginTop: '2px' }}>
              {parsed.bet_market}
            </div>
          )}
          {promptMeta && (
            <div style={{ fontSize: '12px', color: 'var(--gray-500)', marginTop: '4px' }}>
              {promptMeta}
            </div>
          )}
          {prematchMeta && (
            <div style={{ fontSize: '12px', color: 'var(--gray-500)', marginTop: '2px' }}>
              {prematchMeta}
            </div>
          )}
        </div>
        <div style={{ textAlign: 'right', minWidth: '120px' }}>
          <div style={{ fontSize: '12px', color: 'var(--gray-500)' }}>Confidence</div>
          <div style={{ fontWeight: 700, color: result.shouldPush ? 'var(--success)' : 'var(--gray-700)' }}>
            {result.confidence}/10
          </div>
        </div>
      </div>

      {reasoning && (
        <p style={{ margin: 0, fontSize: '13px', lineHeight: 1.6, color: result.error ? 'var(--danger)' : 'var(--gray-600)' }}>
          {reasoning}
        </p>
      )}

      {parsed?.condition_triggered_suggestion && (
        <div style={{ marginTop: '8px', fontSize: '13px', color: 'var(--gray-700)' }}>
          <strong>Condition Suggestion:</strong> {parsed.condition_triggered_suggestion}
          {conditionReasoning ? <span style={{ color: 'var(--gray-500)' }}> {' '}| {conditionReasoning}</span> : null}
        </div>
      )}

      {warnings.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '10px' }}>
          {warnings.map((warning) => (
            <span
              key={warning}
              style={{
                padding: '2px 8px',
                borderRadius: '999px',
                background: '#fef3c7',
                color: '#92400e',
                fontSize: '11px',
                fontWeight: 600,
              }}
            >
              {warning}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function LiveMonitorTab() {
  const { state } = useAppState();
  const { showToast } = useToast();
  const [status, setStatus] = useState<LiveMonitorStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshError, setRefreshError] = useState('');
  const [triggering, setTriggering] = useState(false);

  const loadStatus = useCallback(async () => {
    setRefreshError('');
    try {
      const next = await fetchLiveMonitorStatus(state.config);
      setStatus(next);
    } catch (error) {
      setRefreshError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [state.config]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    const intervalMs = status?.job.running ? 2_000 : 5_000;
    const timer = window.setInterval(() => {
      void loadStatus();
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [loadStatus, status?.job.running]);

  const handleRunNow = useCallback(async () => {
    setTriggering(true);
    try {
      await triggerCheckLiveRun(state.config);
      showToast('Live monitor job triggered', 'success');
      await loadStatus();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to trigger live monitor job', 'error');
    } finally {
      setTriggering(false);
    }
  }, [loadStatus, showToast, state.config]);

  const sortedResults = useMemo(() => {
    return [...(status?.results || [])].sort((left, right) => {
      const priority = { ai_push: 3, condition_only: 2, no_bet: 1 } as const;
      const leftScore = priority[left.decisionKind] * 10 + Number(left.saved) * 2 + Number(left.notified);
      const rightScore = priority[right.decisionKind] * 10 + Number(right.saved) * 2 + Number(right.notified);
      return rightScore - leftScore;
    });
  }, [status?.results]);

  const promptLevelSummary = useMemo(() => {
    return sortedResults.reduce((acc, result) => {
      if (result.debug?.promptDataLevel === 'advanced-upgraded') acc.advanced += 1;
      if (result.debug?.promptDataLevel === 'basic-only') acc.basic += 1;
      return acc;
    }, { basic: 0, advanced: 0 });
  }, [sortedResults]);

  const prematchStrengthSummary = useMemo(() => {
    return sortedResults.reduce((acc, result) => {
      if (result.debug?.prematchStrength === 'strong') acc.strong += 1;
      if (result.debug?.prematchStrength === 'moderate') acc.moderate += 1;
      if (result.debug?.prematchStrength === 'weak') acc.weak += 1;
      return acc;
    }, { strong: 0, moderate: 0, weak: 0 });
  }, [sortedResults]);

  if (loading && !status) {
    return (
      <div className="card">
        <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--gray-500)' }}>
          Loading live monitor dashboard...
        </div>
      </div>
    );
  }

  return (
    <div className="live-monitor-tab">
      <div className="card" style={{ marginBottom: '16px' }}>
        <div className="card-header">
          <div className="card-title">Live Monitor Dashboard</div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-secondary btn-sm" onClick={() => void loadStatus()} disabled={triggering}>
              Refresh
            </button>
            <button className="btn btn-primary btn-sm" onClick={handleRunNow} disabled={triggering || status?.job.running}>
              {triggering ? 'Triggering...' : status?.job.running ? 'Running...' : 'Run Check Live'}
            </button>
          </div>
        </div>
        <div style={{ padding: '20px' }}>
          <div className="monitor-stats-row">
            <SummaryStat label="Engine" value={status?.job.running ? 'Running' : status?.job.enabled ? 'Idle' : 'Disabled'} color={status?.job.running ? 'var(--success)' : undefined} />
            <SummaryStat label="Interval" value={formatInterval(status?.job.intervalMs ?? 0)} />
            <SummaryStat label="Runs" value={status?.job.runCount ?? 0} />
            <SummaryStat label="Last Run" value={formatLocalDateTime(status?.job.lastRun ?? null)} />
          </div>
          <p style={{ margin: '14px 0 0', color: 'var(--gray-500)', fontSize: '13px' }}>
            This screen is read-only for pipeline execution. Scheduling and thresholds remain owned by the server engine and are configured in Settings.
          </p>
          {refreshError && (
            <p style={{ margin: '10px 0 0', color: 'var(--danger)', fontSize: '13px' }}>{refreshError}</p>
          )}
          {!refreshError && status?.job.lastError && (
            <p style={{ margin: '10px 0 0', color: 'var(--danger)', fontSize: '13px' }}>{status.job.lastError}</p>
          )}
        </div>
      </div>

      {status && <ProgressCard status={status} />}

      <div className="card" style={{ marginBottom: '16px' }}>
        <div className="card-header">
          <div className="card-title">Latest Run Summary</div>
        </div>
        <div style={{ padding: '20px' }}>
          {status?.summary ? (
            <div className="monitor-stats-row">
              <SummaryStat label="Live" value={status.summary.liveCount} />
              <SummaryStat label="Candidates" value={status.summary.candidateCount} />
              <SummaryStat label="Processed" value={status.summary.processed} />
              <SummaryStat label="Saved Recs" value={status.summary.savedRecommendations} color="var(--success)" />
              <SummaryStat label="Notifications" value={status.summary.pushedNotifications} color="var(--primary)" />
              <SummaryStat label="Basic Prompt" value={promptLevelSummary.basic} />
              <SummaryStat label="Advanced Prompt" value={promptLevelSummary.advanced} color={promptLevelSummary.advanced > 0 ? 'var(--primary)' : undefined} />
              <SummaryStat label="Prematch Strong" value={prematchStrengthSummary.strong} color={prematchStrengthSummary.strong > 0 ? 'var(--success)' : undefined} />
              <SummaryStat label="Prematch Moderate" value={prematchStrengthSummary.moderate} />
              <SummaryStat label="Prematch Weak" value={prematchStrengthSummary.weak} color={prematchStrengthSummary.weak > 0 ? 'var(--danger)' : undefined} />
              <SummaryStat label="Errors" value={status.summary.errors} color={status.summary.errors > 0 ? 'var(--danger)' : undefined} />
            </div>
          ) : (
            <p style={{ margin: 0, color: 'var(--gray-500)', fontSize: '13px' }}>
              No completed live-monitor run has been recorded yet.
            </p>
          )}
        </div>
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        <div className="card-header">
          <div className="card-title">Latest Match Results</div>
          <small style={{ color: 'var(--gray-500)' }}>{sortedResults.length} result{sortedResults.length === 1 ? '' : 's'}</small>
        </div>
        {sortedResults.length > 0 ? (
          <div>
            {sortedResults.map((result) => (
              <ResultRow key={`${result.matchId}-${result.selection}-${result.confidence}`} result={result} />
            ))}
          </div>
        ) : (
          <div style={{ padding: '28px 20px', textAlign: 'center', color: 'var(--gray-500)' }}>
            No result payload has been published by the server pipeline yet.
          </div>
        )}
      </div>
    </div>
  );
}
