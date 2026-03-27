import type { ServerMatchPipelineResult, ServerParsedAiResult } from '@/features/live-monitor/services/server-monitor.service';
import { getParsedAiResult } from '@/features/live-monitor/services/server-monitor.service';

// ── Helpers ──────────────────────────────────────────────────────────────────

const DECISION_META = {
  ai_push:        { label: 'AI Push',      color: '#fff',               bg: 'var(--green)' },
  condition_only: { label: 'Cond Only',    color: '#fff',               bg: 'var(--primary)' },
  no_bet:         { label: 'No Bet',       color: 'var(--gray-500)',     bg: 'var(--gray-100)' },
} satisfies Record<string, { label: string; color: string; bg: string }>;

const RISK_COLOR: Record<string, string> = {
  LOW:    'var(--green)',
  MEDIUM: 'var(--orange)',
  HIGH:   'var(--red)',
};

const STRENGTH_COLOR: Record<string, string> = {
  strong:   'var(--green)',
  moderate: 'var(--orange)',
  weak:     'var(--red)',
  none:     'var(--gray-400)',
};

const DATA_LEVEL_LABEL: Record<string, string> = {
  'advanced-upgraded': 'Advanced',
  'basic-only':        'Basic',
};

// ── Sub-components ────────────────────────────────────────────────────────────

function DecisionBadge({ kind }: { kind: string }) {
  const meta = (DECISION_META as Record<string, { label: string; color: string; bg: string }>)[kind] ?? DECISION_META.no_bet;
  return (
    <span style={{
      display: 'inline-block', padding: '2px 10px', borderRadius: '12px',
      fontSize: '11px', fontWeight: 700, letterSpacing: '0.3px',
      color: meta.color, background: meta.bg, whiteSpace: 'nowrap',
    }}>
      {meta.label}
    </span>
  );
}

function MetricItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span style={{ whiteSpace: 'nowrap', fontSize: '12px', color: 'var(--gray-700)' }}>
      <span style={{ color: 'var(--gray-400)', marginRight: '2px' }}>{label}:</span>
      {children}
    </span>
  );
}

function FlagChip({ label, value }: { label: string; value: boolean }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '4px',
      padding: '2px 8px', borderRadius: '10px', fontSize: '11px',
      whiteSpace: 'nowrap',
      background: value ? 'color-mix(in srgb, var(--green) 12%, transparent)' : 'var(--gray-100)',
      color:      value ? 'var(--green)' : 'var(--gray-500)',
      border: `1px solid ${value ? 'color-mix(in srgb, var(--green) 25%, transparent)' : 'var(--gray-200)'}`,
    }}>
      <span style={{ fontSize: '10px' }}>{value ? '✓' : '✗'}</span>
      {label}
    </span>
  );
}

function DataTag({ label, color }: { label: string; color?: string }) {
  return (
    <span style={{
      display: 'inline-block', padding: '1px 7px', borderRadius: '8px',
      fontSize: '10px', fontWeight: 500, whiteSpace: 'nowrap',
      background: 'var(--gray-100)', color: color ?? 'var(--gray-500)',
      border: '1px solid var(--gray-200)',
    }}>
      {label}
    </span>
  );
}

function MinuteBadge({ minute, status }: { minute: number | string; status?: string }) {
  const STATUS_LIVE = new Set(['1H', '2H', 'ET', 'BT', 'P', 'INT', 'LIVE']);
  const isLive = status ? STATUS_LIVE.has(status) : false;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '4px',
      padding: '1px 8px', borderRadius: '10px', fontSize: '11px',
      fontWeight: 600, whiteSpace: 'nowrap',
      background: isLive ? 'color-mix(in srgb, #ef4444 10%, transparent)' : 'var(--gray-100)',
      color: isLive ? '#ef4444' : 'var(--gray-600)',
      border: `1px solid ${isLive ? 'color-mix(in srgb, #ef4444 25%, transparent)' : 'var(--gray-200)'}`,
    }}>
      {isLive && (
        <span style={{
          width: '6px', height: '6px', borderRadius: '50%',
          background: '#ef4444', flexShrink: 0,
          animation: 'pulse 1.5s ease-in-out infinite',
        }} />
      )}
      @{minute}&apos;
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export interface AiAnalysisPanelEntry {
  matchId: string;
  matchDisplay: string;
  result: ServerMatchPipelineResult;
}

interface Props {
  entry: AiAnalysisPanelEntry;
  onClose: () => void;
}

export function AiAnalysisPanel({ entry, onClose }: Props) {
  const { result } = entry;
  const ai: ServerParsedAiResult | null = getParsedAiResult(result);
  const dbg = result.debug;

  const selection = ai?.selection || result.selection || '—';
  const market    = ai?.bet_market || '—';

  return (
    <div
      id={`ai-result-${entry.matchId}`}
      className="ai-result-panel"
      style={{
        padding: '14px 16px',
        background: 'var(--gray-50)',
        border: '1px solid var(--gray-200)',
        borderRadius: '8px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        transition: 'outline 0.3s',
      }}
    >
      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', minWidth: 0 }}>
          <h4 style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: 'var(--gray-800)', whiteSpace: 'nowrap' }}>
            AI Analysis
          </h4>
          <span style={{ fontSize: '13px', color: 'var(--gray-600)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {entry.matchDisplay}
          </span>
          {result.score && (
            <span style={{
              padding: '1px 8px', borderRadius: '8px', fontSize: '12px',
              fontWeight: 700, background: 'var(--gray-200)', color: 'var(--gray-700)',
              whiteSpace: 'nowrap', letterSpacing: '1px',
            }}>
              {result.score}
            </span>
          )}
          {result.minute != null && (
            <MinuteBadge minute={result.minute} status={result.status} />
          )}
        </div>
        <button
          onClick={onClose}
          title="Close"
          style={{
            flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer',
            width: '22px', height: '22px', borderRadius: '50%', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            fontSize: '16px', lineHeight: 1, color: 'var(--gray-400)',
            transition: 'background 0.15s, color 0.15s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gray-200)'; e.currentTarget.style.color = 'var(--gray-700)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--gray-400)'; }}
        >
          ×
        </button>
      </div>

      {ai ? (
        <>
          {/* ── Decision + metrics row ── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <DecisionBadge kind={result.decisionKind} />

            {selection !== '—' && (
              <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--gray-800)', whiteSpace: 'nowrap' }}>
                {selection}
              </span>
            )}
            {market !== '—' && (
              <span style={{ fontSize: '12px', color: 'var(--gray-500)', whiteSpace: 'nowrap' }}>
                [{market}]
              </span>
            )}

            <span style={{ color: 'var(--gray-300)', fontSize: '12px' }}>|</span>

            <MetricItem label="Conf">
              <strong style={{ color: result.confidence >= 7 ? 'var(--green)' : result.confidence >= 4 ? 'var(--orange)' : 'var(--gray-600)' }}>
                {result.confidence}/10
              </strong>
            </MetricItem>

            {ai.risk_level && (
              <MetricItem label="Risk">
                <strong style={{ color: RISK_COLOR[ai.risk_level] ?? 'var(--gray-600)' }}>
                  {ai.risk_level}
                </strong>
              </MetricItem>
            )}

            <MetricItem label="Stake">
              <strong>{ai.stake_percent ?? 0}%</strong>
            </MetricItem>

            <MetricItem label="Value">
              <strong style={{ color: (ai.value_percent ?? 0) > 0 ? 'var(--green)' : 'var(--gray-600)' }}>
                {ai.value_percent ?? 0}%
              </strong>
            </MetricItem>
          </div>

          {/* ── Flag chips ── */}
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            <FlagChip label="Should Push"     value={result.shouldPush} />
            <FlagChip label="Cond Matched"    value={!!ai.custom_condition_matched} />
            <FlagChip label="Cond Triggered"  value={!!ai.condition_triggered_should_push} />
            <FlagChip label="Saved"           value={result.saved} />
            <FlagChip label="Notified"        value={result.notified} />
          </div>

          {/* ── Data quality row ── */}
          {dbg && (dbg.statsSource || dbg.prematchStrength || dbg.promptDataLevel || dbg.totalLatencyMs != null) && (
            <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: '10px', color: 'var(--gray-400)', marginRight: '2px' }}>Data:</span>
              {dbg.statsSource        && <DataTag label={dbg.statsSource} />}
              {dbg.prematchStrength   && <DataTag label={`prematch: ${dbg.prematchStrength}`} color={STRENGTH_COLOR[dbg.prematchStrength]} />}
              {dbg.promptDataLevel    && <DataTag label={DATA_LEVEL_LABEL[dbg.promptDataLevel] ?? dbg.promptDataLevel} />}
              {dbg.evidenceMode       && <DataTag label={dbg.evidenceMode} />}
              {dbg.totalLatencyMs != null && <DataTag label={`${dbg.totalLatencyMs}ms`} />}
            </div>
          )}

          {/* ── Reasoning ── */}
          {(ai.reasoning_vi || ai.reasoning_en) && (
            <p style={{ margin: 0, fontSize: '12px', color: 'var(--gray-700)', lineHeight: 1.5 }}>
              <strong style={{ color: 'var(--gray-500)', marginRight: '4px' }}>Reasoning:</strong>
              {ai.reasoning_vi || ai.reasoning_en}
            </p>
          )}

          {/* ── Condition suggestion ── */}
          {ai.condition_triggered_suggestion && (
            <p style={{ margin: 0, fontSize: '12px', color: 'var(--gray-700)', lineHeight: 1.5 }}>
              <strong style={{ color: 'var(--gray-500)', marginRight: '4px' }}>Suggestion:</strong>
              {ai.condition_triggered_suggestion}
            </p>
          )}

          {/* ── Warnings ── */}
          {(ai.warnings?.length ?? 0) > 0 && (
            <p style={{ margin: 0, fontSize: '11px', color: 'var(--orange)', lineHeight: 1.5 }}>
              ⚠ {ai.warnings!.join(' · ')}
            </p>
          )}
        </>
      ) : result.error ? (
        <p style={{ margin: 0, color: 'var(--red)', fontSize: '13px' }}>❌ {result.error}</p>
      ) : (
        <p style={{ margin: 0, color: 'var(--gray-500)', fontSize: '13px' }}>
          Match was skipped by pipeline filters (not active or no data available).
        </p>
      )}
    </div>
  );
}
