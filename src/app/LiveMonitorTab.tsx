import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatLocalDateTime } from '@/lib/utils/helpers';
import {
  fetchLiveMonitorStatus,
  getParsedAiResult,
  type LiveMonitorStatusResponse,
  type LiveMonitorTarget,
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

type LiveSignalKind = 'bet' | 'watch' | 'no_action';

interface LiveSignalView {
  kind: LiveSignalKind;
  label: string;
  badgeClass: string;
  detail: string;
}

const SIGNAL_SORT_WEIGHT: Record<LiveSignalKind, number> = {
  bet: 3,
  watch: 2,
  no_action: 1,
};

function liveSignalLabel(kind: LiveSignalKind): string {
  if (kind === 'bet') return 'Bet';
  if (kind === 'watch') return 'Watch';
  return 'No Action';
}

function liveSignalBadgeClass(kind: LiveSignalKind): string {
  if (kind === 'bet') return 'badge-won';
  if (kind === 'watch') return 'badge-pending';
  return 'badge-draw';
}

function hasRuntimeWatchSignal(result: ServerMatchPipelineResult): boolean {
  const shadow = result.debug?.runtimePolicyShadow;
  if (!shadow) return false;
  const watchKey = String(shadow.watchSignalKey || '').trim();
  return (watchKey.length > 0 && watchKey !== 'none')
    || (shadow.matchedPockets?.length ?? 0) > 0;
}

function resolveLiveSignal(result: ServerMatchPipelineResult): LiveSignalView {
  const parsed = getParsedAiResult(result);
  const shadow = result.debug?.runtimePolicyShadow;

  if (result.saved) {
    return {
      kind: 'bet',
      label: 'Bet',
      badgeClass: liveSignalBadgeClass('bet'),
      detail: result.notified ? 'Saved and notified.' : 'Saved as an actionable recommendation.',
    };
  }

  if (
    hasRuntimeWatchSignal(result)
    || result.decisionKind === 'condition_only'
    || parsed?.condition_triggered_should_push === true
  ) {
    const pocketDetail = shadow?.matchedPockets?.map((pocket) => pocket.label).filter(Boolean).join('; ');
    return {
      kind: 'watch',
      label: 'Watch',
      badgeClass: liveSignalBadgeClass('watch'),
      detail: shadow?.watchSignalLabel && shadow.watchSignalLabel !== 'none'
        ? shadow.watchSignalLabel
        : pocketDetail || parsed?.condition_triggered_suggestion || 'Signal present, policy did not promote it to Bet.',
    };
  }

  return {
    kind: 'no_action',
    label: 'No Action',
    badgeClass: liveSignalBadgeClass('no_action'),
    detail: result.debug?.llmDecisionDiagnostic
      ? result.debug.llmDecisionDiagnostic.replace(/_/g, ' ')
      : result.error || 'No actionable signal.',
  };
}

function formatCompactMetric(label: string, value: number | string | null | undefined): string | null {
  if (value == null || value === '') return null;
  return `${label} ${value}`;
}

function decisionKindLabel(kind: ServerMatchPipelineResult['decisionKind']): string {
  switch (kind) {
    case 'ai_push':
      return 'AI Selected';
    case 'condition_only':
      return 'Condition Only';
    default:
      return 'No pick';
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

function candidateReasonLabel(reason: string): string {
  switch (reason) {
    case 'not_live':
      return 'Not live yet';
    case 'force_analyze':
      return 'Forced by manual trigger';
    case 'minute_unknown':
      return 'Minute unavailable, analyze once';
    case 'first_analysis':
      return 'No prior baseline, first analysis';
    case 'phase_changed':
      return 'Match phase changed';
    case 'score_changed':
      return 'Score changed';
    case 'time_elapsed':
      return 'Cooldown elapsed, re-check now';
    case 'no_significant_change':
      return 'No meaningful change since last baseline';
    default:
      return reason.replace(/_/g, ' ');
  }
}

function baselineLabel(baseline: LiveMonitorTarget['baseline']): string {
  switch (baseline) {
    case 'recommendation':
      return 'Recommendation';
    case 'snapshot':
      return 'Snapshot';
    default:
      return 'None';
  }
}

function ScopeRow({ target }: { target: LiveMonitorTarget }) {
  return (
    <div className="monitor-list-row">
      <div className="monitor-list-row__head">
        <div className="monitor-list-row__main">
          <div className="monitor-list-row__title-row">
            <span className="monitor-list-row__title">{target.matchDisplay}</span>
            <span className={`badge ${target.candidate ? 'badge-active' : target.live ? 'badge-pending' : 'badge-draw'}`}>
              {target.candidate ? 'Pre-check candidate' : target.live ? 'Watching Live' : 'Waiting for Kickoff'}
            </span>
            {target.customConditions ? <span className="badge badge-draw">Custom Condition</span> : null}
            {target.recommendedCondition ? <span className="badge badge-pending">Suggested condition</span> : null}
          </div>
          <div className="monitor-list-row__meta">
            {[target.league, target.minute != null ? `${target.minute}'` : null, target.score, target.status]
              .filter(Boolean)
              .join(' | ')}
          </div>
          <div className="monitor-list-row__sub">
            {target.candidate
              ? 'Passed the coarse gate; the engine may still skip after fresh stats and odds.'
              : target.live
                ? 'Tracked live, but not sent to analysis yet.'
                : 'This match is in the system monitoring pool but is not live yet.'}
          </div>
          {target.customConditions && (
            <div className="monitor-list-row__detail">
              <strong>Custom condition:</strong> {target.customConditions}
            </div>
          )}
          {!target.customConditions && target.recommendedCondition && (
            <div className="monitor-list-row__detail">
              <strong>Suggested condition:</strong> {target.recommendedCondition}
            </div>
          )}
          <div className="monitor-list-row__sub">
            {candidateReasonLabel(target.candidateReason)} | Baseline {baselineLabel(target.baseline)}
          </div>
        </div>
        <div className="monitor-list-row__aside">
          <div className="monitor-list-row__stat-label">Checks</div>
          <div className="monitor-list-row__stat-value">{target.totalChecks}</div>
          {target.lastChecked && (
            <div className="monitor-list-row__sub">
              Last checked {formatLocalDateTime(target.lastChecked)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ProgressCard({ status }: { status: LiveMonitorStatusResponse }) {
  if (!status.progress || (!status.job.running && !status.progress.error)) return null;
  const percent = status.progress.percent ?? 0;
  const hasError = Boolean(status.progress.error);

  return (
    <div className="card tab-section">
      <div className="card-header">
        <div className="card-title">Live Engine Is Working</div>
        <small className="text-muted">
          {status.progress.startedAt ? formatLocalDateTime(status.progress.startedAt) : '—'}
        </small>
      </div>
      <div className="monitor-engine-progress">
        <div className="monitor-engine-progress__head">
          <span className="monitor-engine-progress__message">
            {status.progress.message || status.progress.step || 'Checking watched matches'}
          </span>
          <span className="text-muted">{percent}%</span>
        </div>
        <div className="job-progress-bar-bg">
          <div
            className={`job-progress-bar-fill${hasError ? ' error' : ''}`}
            style={{ width: `${percent}%` }}
          />
        </div>
        <p className={`monitor-list-row__sub${hasError ? '' : ''}`} style={{ margin: '10px 0 0', color: hasError ? 'var(--danger)' : undefined }}>
          {status.progress.error || 'The live engine is actively checking matches right now.'}
        </p>
      </div>
    </div>
  );
}

function ResultRow({ result }: { result: ServerMatchPipelineResult }) {
  const parsed = getParsedAiResult(result);
  const signalView = resolveLiveSignal(result);
  const shadow = result.debug?.runtimePolicyShadow;
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
  const cardClass = [
    'monitor-list-row',
    !result.success ? 'match-error' : '',
    result.notified ? 'match-notified' : '',
    signalView.kind === 'watch' ? 'match-watch' : '',
  ].filter(Boolean).join(' ');
  const oddsFromSelection = result.selection.match(/@(\d+(?:\.\d+)?)/)?.[1] ?? null;
  const signalMetrics = [
    formatCompactMetric('Odds', shadow?.odds ?? oddsFromSelection),
    formatCompactMetric('Value', shadow?.valuePercent != null ? `${shadow.valuePercent}%` : parsed?.value_percent != null ? `${parsed.value_percent}%` : null),
    formatCompactMetric('Risk', shadow?.riskLevel || parsed?.risk_level),
    formatCompactMetric('Market', shadow?.canonicalMarket || parsed?.bet_market),
  ].filter(Boolean).join(' | ');

  return (
    <div className={cardClass}>
      <div className="monitor-list-row__head">
        <div className="monitor-list-row__main">
          <div className="match-card-badges monitor-list-row__title-row">
            <span className="monitor-list-row__title">{matchTitle}</span>
            <span className={`badge ${signalView.badgeClass}`}>{signalView.label}</span>
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
          <div className="monitor-list-row__meta">
            {result.selection || parsed?.selection || 'No actionable selection'}
          </div>
          {matchMeta && <div className="monitor-list-row__sub">{matchMeta}</div>}
          {parsed?.bet_market && <div className="monitor-list-row__sub">{parsed.bet_market}</div>}
          {promptMeta && <div className="monitor-list-row__sub">{promptMeta}</div>}
          {prematchMeta && <div className="monitor-list-row__sub">{prematchMeta}</div>}
          <div className="live-signal-detail">
            <strong>{signalView.label}:</strong> {signalView.detail}
            {signalMetrics ? <span className="text-muted"> {' '}| {signalMetrics}</span> : null}
          </div>
        </div>
        <div className="monitor-list-row__aside">
          <div className="monitor-list-row__stat-label">Confidence</div>
          <div
            className="monitor-list-row__stat-value"
            style={{ color: result.shouldPush ? 'var(--success)' : undefined }}
          >
            {result.confidence}/10
          </div>
        </div>
      </div>

      {reasoning && (
        <p className={`match-reasoning${result.error ? ' match-card-error' : ''}`} style={{ marginTop: 'var(--space-2)' }}>
          {reasoning}
        </p>
      )}

      {parsed?.condition_triggered_suggestion && (
        <div className="monitor-list-row__detail">
          <strong>Condition Suggestion:</strong> {parsed.condition_triggered_suggestion}
          {conditionReasoning ? <span className="text-muted"> {' '}| {conditionReasoning}</span> : null}
        </div>
      )}

      {warnings.length > 0 && (
        <div className="match-warnings">
          {warnings.map((warning) => (
            <span key={warning} className="warning-tag">{warning}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function LiveSignalsPanel({ results }: { results: ServerMatchPipelineResult[] }) {
  const rows = results
    .map((result) => ({ result, signal: resolveLiveSignal(result) }))
    .sort((left, right) => {
      const weightDelta = SIGNAL_SORT_WEIGHT[right.signal.kind] - SIGNAL_SORT_WEIGHT[left.signal.kind];
      if (weightDelta !== 0) return weightDelta;
      return Number(right.result.confidence ?? 0) - Number(left.result.confidence ?? 0);
    });
  const counts = rows.reduce<Record<LiveSignalKind, number>>((acc, row) => {
    acc[row.signal.kind] += 1;
    return acc;
  }, { bet: 0, watch: 0, no_action: 0 });

  return (
    <div className="card tab-section live-signals-panel">
      <div className="card-header">
        <div className="card-title">Live Signals</div>
        <small className="text-muted">{rows.length} latest result{rows.length === 1 ? '' : 's'}</small>
      </div>
      <div className="live-signals-overview">
        {(['bet', 'watch', 'no_action'] as LiveSignalKind[]).map((kind) => (
          <div key={kind} className={`live-signal-summary live-signal-summary--${kind}`}>
            <span className={`badge ${liveSignalBadgeClass(kind)}`}>{liveSignalLabel(kind)}</span>
            <strong>{counts[kind]}</strong>
          </div>
        ))}
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No live signals have been published yet." />
      ) : (
        <div className="live-signal-feed">
          {rows.slice(0, 5).map(({ result, signal }) => {
            const shadow = result.debug?.runtimePolicyShadow;
            const matchTitle = result.matchDisplay || [result.homeName, result.awayName].filter(Boolean).join(' vs ') || result.matchId;
            const metrics = [
              result.minute != null ? `${result.minute}'` : null,
              result.score,
              shadow?.canonicalMarket,
              shadow?.valueBand ? `value ${shadow.valueBand}` : null,
              shadow?.riskLevel,
            ].filter(Boolean).join(' | ');
            return (
              <div key={`${result.matchId}-${signal.kind}-${result.selection}`} className={`live-signal-row live-signal-row--${signal.kind}`}>
                <div className="live-signal-row__main">
                  <div className="live-signal-row__title">
                    <span className={`badge ${signal.badgeClass}`}>{signal.label}</span>
                    <strong>{matchTitle}</strong>
                  </div>
                  <div className="live-signal-row__selection">
                    {result.selection || (signal.kind === 'no_action' ? 'No actionable signal' : 'Watch signal')}
                  </div>
                  <div className="live-signal-row__detail">{signal.detail}</div>
                </div>
                <div className="live-signal-row__aside">
                  <strong>{result.confidence}/10</strong>
                  {metrics ? <span>{metrics}</span> : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MonitorListPanel({
  title,
  hint,
  countLabel,
  emptyTitle,
  isEmpty,
  children,
}: {
  title: string;
  hint: string;
  countLabel: string;
  emptyTitle: string;
  isEmpty: boolean;
  children: ReactNode;
}) {
  return (
    <div className="card tab-section" style={{ overflow: 'hidden' }}>
      <div className="card-header">
        <div className="card-title">{title}</div>
        <small className="text-muted">{countLabel}</small>
      </div>
      <div className="monitor-panel-hint">{hint}</div>
      {isEmpty ? <EmptyState title={emptyTitle} /> : <div>{children}</div>}
    </div>
  );
}

export function LiveMonitorTab() {
  const { state } = useAppState();
  const [status, setStatus] = useState<LiveMonitorStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshError, setRefreshError] = useState('');

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

  const sortedResults = useMemo(() => {
    return [...(status?.results || [])].sort((left, right) => {
      const priority = { ai_push: 3, condition_only: 2, no_bet: 1 } as const;
      const leftScore = priority[left.decisionKind] * 10 + Number(left.saved) * 2 + Number(left.notified);
      const rightScore = priority[right.decisionKind] * 10 + Number(right.saved) * 2 + Number(right.notified);
      return rightScore - leftScore;
    });
  }, [status?.results]);

  const liveTargets = useMemo(() => {
    return [...(status?.monitoring.targets || [])]
      .filter((target) => target.live)
      .sort((left, right) => Number(right.candidate) - Number(left.candidate));
  }, [status?.monitoring.targets]);

  const waitingTargets = useMemo(() => {
    return [...(status?.monitoring.targets || [])]
      .filter((target) => !target.live)
      .sort((left, right) => left.matchId.localeCompare(right.matchId));
  }, [status?.monitoring.targets]);

  if (loading && !status) {
    return (
      <div className="loading-panel">
        <div className="loading-spinner" />
        <p>Loading live monitor dashboard...</p>
      </div>
    );
  }

  return (
    <div className="live-monitor-tab">
      <div className="card tab-section">
        <div className="monitor-summary-panel">
          <div className="monitor-stats-row" style={{ marginTop: 0 }}>
            <SummaryStat label="Live Now" value={status?.monitoring.liveWatchCount ?? 0} color={(status?.monitoring.liveWatchCount ?? 0) > 0 ? 'var(--success)' : undefined} />
            <SummaryStat label="Pre-check candidates" value={status?.monitoring.candidateCount ?? 0} color={(status?.monitoring.candidateCount ?? 0) > 0 ? 'var(--primary)' : undefined} />
            <SummaryStat label="My Watchlist" value={state.watchlist.length} />
            <SummaryStat label="System Pool" value={status?.monitoring.activeWatchCount ?? 0} />
          </div>
          <p className="monitor-list-row__sub" style={{ margin: '14px 0 0' }}>
            This screen refreshes automatically and focuses on what is live now, what is ready for analysis, and what is still waiting.
          </p>
          <div className="monitor-meta-row">
            <span><strong>Engine:</strong> {status?.job.running ? 'Checking now' : status?.job.enabled ? 'Waiting for next cycle' : 'Disabled'}</span>
            <span><strong>Checks so far:</strong> {status?.job.runCount ?? 0}</span>
            <span><strong>Last refresh:</strong> {formatLocalDateTime(status?.job.lastRun ?? null)}</span>
            <span><strong>Refresh cadence:</strong> {formatInterval(status?.job.intervalMs ?? 0)}</span>
          </div>
          {refreshError && (
            <p className="monitor-list-row__sub" style={{ margin: '10px 0 0', color: 'var(--danger)' }}>{refreshError}</p>
          )}
          {!refreshError && status?.job.lastError && (
            <p className="monitor-list-row__sub" style={{ margin: '10px 0 0', color: 'var(--danger)' }}>{status.job.lastError}</p>
          )}
        </div>
      </div>

      {status && <ProgressCard status={status} />}

      <LiveSignalsPanel results={sortedResults} />

      <MonitorListPanel
        title="Live Right Now"
        hint="These are the matches the live engine is actively following at this moment."
        countLabel={`${liveTargets.length} match${liveTargets.length === 1 ? '' : 'es'}`}
        emptyTitle="No watched matches are live right now."
        isEmpty={!status || liveTargets.length === 0}
      >
        {liveTargets.map((target) => (
          <ScopeRow key={`${target.matchId}-${target.lastChecked ?? 'never'}`} target={target} />
        ))}
      </MonitorListPanel>

      <MonitorListPanel
        title="Waiting Or Upcoming"
        hint="These matches are still in the pool, but they are waiting for kickoff or the next meaningful change."
        countLabel={`${waitingTargets.length} match${waitingTargets.length === 1 ? '' : 'es'}`}
        emptyTitle="No upcoming or waiting matches are in the monitoring pool."
        isEmpty={!status || waitingTargets.length === 0}
      >
        {waitingTargets.map((target) => (
          <ScopeRow key={`${target.matchId}-${target.lastChecked ?? 'never'}`} target={target} />
        ))}
      </MonitorListPanel>

      <div className="card tab-section">
        <div className="card-header">
          <div className="card-title">Latest Run Summary</div>
        </div>
        <div className="monitor-summary-panel" style={{ paddingTop: 0 }}>
          {status?.summary ? (
            <div className="monitor-stats-row" style={{ marginTop: 0 }}>
              <SummaryStat label="Live Matches" value={status.summary.liveCount} />
              <SummaryStat label="Pre-check candidates" value={status.summary.candidateCount} />
              <SummaryStat label="Checked This Run" value={status.summary.processed} />
              <SummaryStat label="Recommendations Saved" value={status.summary.savedRecommendations} color="var(--success)" />
              <SummaryStat label="Notifications" value={status.summary.pushedNotifications} color="var(--primary)" />
              <SummaryStat label="Errors" value={status.summary.errors} color={status.summary.errors > 0 ? 'var(--danger)' : undefined} />
            </div>
          ) : (
            <EmptyState title="No completed live-monitor run has been recorded yet." />
          )}
        </div>
      </div>

      <MonitorListPanel
        title="Latest Match Results"
        hint="Most recent pipeline outcomes from the live engine."
        countLabel={`${sortedResults.length} result${sortedResults.length === 1 ? '' : 's'}`}
        emptyTitle="No result payload has been published by the server pipeline yet."
        isEmpty={sortedResults.length === 0}
      >
        {sortedResults.map((result) => (
          <ResultRow key={`${result.matchId}-${result.selection}-${result.confidence}`} result={result} />
        ))}
      </MonitorListPanel>
    </div>
  );
}
