import { useMemo, useState, type ReactNode } from 'react';

import type {
  AskAiFollowUpMessage,
  ServerMatchPipelineResult,
  ServerParsedAiResult,
} from '@/features/live-monitor/services/server-monitor.service';
import { getParsedAiResult } from '@/features/live-monitor/services/server-monitor.service';

const DECISION_META = {
  ai_push: { label: 'AI Push', color: '#fff', bg: 'var(--green)' },
  condition_only: { label: 'Cond Only', color: '#fff', bg: 'var(--primary)' },
  no_bet: { label: 'No Bet', color: 'var(--gray-500)', bg: 'var(--gray-100)' },
} satisfies Record<string, { label: string; color: string; bg: string }>;

const RISK_COLOR: Record<string, string> = {
  LOW: 'var(--green)',
  MEDIUM: 'var(--orange)',
  HIGH: 'var(--red)',
};

const STRENGTH_COLOR: Record<string, string> = {
  strong: 'var(--green)',
  moderate: 'var(--orange)',
  weak: 'var(--red)',
  none: 'var(--gray-400)',
};

function DecisionBadge({ kind }: { kind: string }) {
  const meta = (DECISION_META as Record<string, { label: string; color: string; bg: string }>)[kind] ?? DECISION_META.no_bet;
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 10px',
        borderRadius: '12px',
        fontSize: '11px',
        fontWeight: 700,
        letterSpacing: '0.3px',
        color: meta.color,
        background: meta.bg,
        whiteSpace: 'nowrap',
      }}
    >
      {meta.label}
    </span>
  );
}

function MetricItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span style={{ whiteSpace: 'nowrap', fontSize: '12px', color: 'var(--gray-700)' }}>
      <span style={{ color: 'var(--gray-400)', marginRight: '2px' }}>{label}:</span>
      {children}
    </span>
  );
}

function DataTag({ label, color }: { label: string; color?: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '1px 7px',
        borderRadius: '8px',
        fontSize: '10px',
        fontWeight: 500,
        whiteSpace: 'nowrap',
        background: 'var(--gray-100)',
        color: color ?? 'var(--gray-500)',
        border: '1px solid var(--gray-200)',
      }}
    >
      {label}
    </span>
  );
}

function buildContextTags(dbg: ServerMatchPipelineResult['debug'] | undefined): { label: string; color?: string }[] {
  if (!dbg) return [];

  const tags: { label: string; color?: string }[] = [];

  if (dbg.prematchStrength) {
    const strengthLabel: Record<string, string> = {
      strong: 'Strong prematch context',
      moderate: 'Moderate prematch context',
      weak: 'Limited prematch context',
      none: 'No prematch context',
    };
    tags.push({
      label: strengthLabel[dbg.prematchStrength] ?? dbg.prematchStrength,
      color: STRENGTH_COLOR[dbg.prematchStrength],
    });
  }

  if (dbg.promptDataLevel) {
    const analysisLabel: Record<string, string> = {
      'advanced-upgraded': 'Expanded analysis',
      'basic-only': 'Compact analysis',
    };
    tags.push({ label: analysisLabel[dbg.promptDataLevel] ?? dbg.promptDataLevel });
  }

  if (dbg.evidenceMode) {
    const evidenceLabel: Record<string, string> = {
      full_live_data: 'Complete live context',
      full_data: 'Complete context',
      stats_only: 'Stats-led context',
      low_evidence: 'Limited live context',
      odds_events_only_degraded: 'Partial market context',
      events_only_degraded: 'Event-led context',
    };
    tags.push({ label: evidenceLabel[dbg.evidenceMode] ?? dbg.evidenceMode.replace(/_/g, ' ') });
  }

  if (dbg.advisoryOnly) {
    tags.push({ label: 'Advisory follow-up' });
  }

  return tags;
}

function MinuteBadge({ minute, status }: { minute: number | string; status?: string }) {
  const STATUS_LIVE = new Set(['1H', '2H', 'ET', 'BT', 'P', 'INT', 'LIVE']);
  const isLive = status ? STATUS_LIVE.has(status) : false;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: '1px 8px',
        borderRadius: '10px',
        fontSize: '11px',
        fontWeight: 600,
        whiteSpace: 'nowrap',
        background: isLive ? 'color-mix(in srgb, #ef4444 10%, transparent)' : 'var(--gray-100)',
        color: isLive ? '#ef4444' : 'var(--gray-600)',
        border: `1px solid ${isLive ? 'color-mix(in srgb, #ef4444 25%, transparent)' : 'var(--gray-200)'}`,
      }}
    >
      {isLive ? (
        <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#ef4444', flexShrink: 0 }} />
      ) : null}
      @{minute}'
    </span>
  );
}

function FollowUpBubble({ message }: { message: AskAiFollowUpMessage }) {
  const isUser = message.role === 'user';
  return (
    <div
      style={{
        alignSelf: isUser ? 'flex-end' : 'flex-start',
        maxWidth: '100%',
        padding: '10px 12px',
        borderRadius: '12px',
        background: isUser ? 'rgba(59,130,246,0.08)' : '#fff',
        border: `1px solid ${isUser ? 'rgba(59,130,246,0.2)' : 'var(--gray-200)'}`,
      }}
    >
      <div
        style={{
          fontSize: '10px',
          fontWeight: 700,
          color: 'var(--gray-400)',
          textTransform: 'uppercase',
          marginBottom: '4px',
        }}
      >
        {isUser ? 'You' : 'AI Follow-up'}
      </div>
      <div style={{ fontSize: '12px', lineHeight: 1.55, color: 'var(--gray-700)', whiteSpace: 'pre-wrap' }}>
        {message.text}
      </div>
    </div>
  );
}

export interface AiAnalysisPanelEntry {
  matchId: string;
  matchDisplay: string;
  result: ServerMatchPipelineResult;
  followUpMessages?: AskAiFollowUpMessage[];
}

interface Props {
  entry: AiAnalysisPanelEntry;
  onClose: () => void;
  onFollowUp?: (question: string, history: AskAiFollowUpMessage[]) => Promise<void>;
}

export function AiAnalysisPanel({ entry, onClose, onFollowUp }: Props) {
  const { result } = entry;
  const ai: ServerParsedAiResult | null = getParsedAiResult(result);
  const dbg = result.debug;
  const contextTags = buildContextTags(dbg);
  const selection = ai?.selection || result.selection || '--';
  const market = ai?.bet_market || '--';
  const followUps = useMemo(() => entry.followUpMessages ?? [], [entry.followUpMessages]);
  const [followUpInput, setFollowUpInput] = useState('');
  const [sendingFollowUp, setSendingFollowUp] = useState(false);

  const canFollowUp = !!ai && result.success && typeof onFollowUp === 'function';

  const submitFollowUp = async () => {
    const question = followUpInput.trim();
    if (!question || !onFollowUp) return;
    setSendingFollowUp(true);
    try {
      await onFollowUp(question, followUps);
      setFollowUpInput('');
    } finally {
      setSendingFollowUp(false);
    }
  };

  return (
    <div
      id={`ai-result-${entry.matchId}`}
      className="ai-result-panel"
      style={{
        position: 'relative',
        padding: '14px 40px 14px 16px',
        background: 'var(--gray-50)',
        border: '1px solid var(--gray-200)',
        borderRadius: '8px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
      }}
    >
      <button
        onClick={onClose}
        title="Close"
        style={{
          position: 'absolute',
          top: '10px',
          right: '10px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          width: '24px',
          height: '24px',
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '18px',
          lineHeight: 1,
          color: 'var(--gray-400)',
        }}
      >
        x
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', minWidth: 0 }}>
        <h4 style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: 'var(--gray-800)', whiteSpace: 'nowrap' }}>
          AI Analysis
        </h4>
        <span
          style={{
            fontSize: '13px',
            color: 'var(--gray-600)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {entry.matchDisplay}
        </span>
        {result.score ? (
          <span
            style={{
              padding: '1px 8px',
              borderRadius: '8px',
              fontSize: '12px',
              fontWeight: 700,
              background: 'var(--gray-200)',
              color: 'var(--gray-700)',
              whiteSpace: 'nowrap',
              letterSpacing: '1px',
            }}
          >
            {result.score}
          </span>
        ) : null}
        {result.minute != null ? <MinuteBadge minute={result.minute} status={result.status} /> : null}
      </div>

      {ai ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <DecisionBadge kind={result.decisionKind} />
            {selection !== '--' ? (
              <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--gray-800)', whiteSpace: 'nowrap' }}>
                {selection}
              </span>
            ) : null}
            {market !== '--' ? (
              <span style={{ fontSize: '12px', color: 'var(--gray-500)', whiteSpace: 'nowrap' }}>
                [{market}]
              </span>
            ) : null}
            <span style={{ color: 'var(--gray-300)', fontSize: '12px' }}>|</span>
            <MetricItem label="Conf">
              <strong style={{ color: result.confidence >= 7 ? 'var(--green)' : result.confidence >= 4 ? 'var(--orange)' : 'var(--gray-600)' }}>
                {result.confidence}/10
              </strong>
            </MetricItem>
            {ai.risk_level ? (
              <MetricItem label="Risk">
                <strong style={{ color: RISK_COLOR[ai.risk_level] ?? 'var(--gray-600)' }}>
                  {ai.risk_level}
                </strong>
              </MetricItem>
            ) : null}
            <MetricItem label="Stake">
              <strong>{ai.stake_percent ?? 0}%</strong>
            </MetricItem>
            <MetricItem label="Value">
              <strong style={{ color: (ai.value_percent ?? 0) > 0 ? 'var(--green)' : 'var(--gray-600)' }}>
                {ai.value_percent ?? 0}%
              </strong>
            </MetricItem>
          </div>

          {contextTags.length > 0 ? (
            <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', alignItems: 'center' }}>
              {contextTags.map((tag) => (
                <DataTag key={tag.label} label={tag.label} color={tag.color} />
              ))}
            </div>
          ) : null}

          {(ai.reasoning_vi || ai.reasoning_en) ? (
            <p style={{ margin: 0, fontSize: '12px', color: 'var(--gray-700)', lineHeight: 1.5 }}>
              <strong style={{ color: 'var(--gray-500)', marginRight: '4px' }}>Reasoning:</strong>
              {ai.reasoning_vi || ai.reasoning_en}
            </p>
          ) : null}

          {ai.condition_triggered_suggestion ? (
            <p style={{ margin: 0, fontSize: '12px', color: 'var(--gray-700)', lineHeight: 1.5 }}>
              <strong style={{ color: 'var(--gray-500)', marginRight: '4px' }}>Suggestion:</strong>
              {ai.condition_triggered_suggestion}
            </p>
          ) : null}

          {(ai.warnings?.length ?? 0) > 0 ? (
            <p
              style={{
                margin: 0,
                fontSize: '11px',
                color: 'var(--orange)',
                lineHeight: 1.5,
                display: 'flex',
                alignItems: 'flex-start',
                gap: '4px',
              }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ flexShrink: 0, marginTop: '1px' }}
              >
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              {(ai.warnings ?? []).join(' | ')}
            </p>
          ) : null}

          {followUps.length > 0 ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                paddingTop: '8px',
                borderTop: '1px solid var(--gray-200)',
              }}
            >
              <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                Match Follow-up
              </div>
              {followUps.map((message, index) => (
                <FollowUpBubble key={`${message.role}-${index}-${message.text.slice(0, 24)}`} message={message} />
              ))}
            </div>
          ) : null}

          {canFollowUp ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                paddingTop: '8px',
                borderTop: '1px solid var(--gray-200)',
              }}
            >
              <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                Ask follow-up about this match
              </div>
              <textarea
                aria-label="Ask follow-up about this match"
                value={followUpInput}
                onChange={(event) => setFollowUpInput(event.target.value)}
                rows={3}
                placeholder="Ask about a market in this match, for example: Is Home -0.25 better than Under here?"
                style={{
                  width: '100%',
                  resize: 'vertical',
                  minHeight: '84px',
                  borderRadius: '10px',
                  border: '1px solid var(--gray-200)',
                  padding: '10px 12px',
                  fontSize: '12px',
                  lineHeight: 1.5,
                  fontFamily: 'inherit',
                  background: '#fff',
                }}
                disabled={sendingFollowUp}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'center' }}>
                <span style={{ fontSize: '11px', color: 'var(--gray-400)' }}>
                  Follow-up stays grounded in the current match snapshot and does not save a new recommendation.
                </span>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => void submitFollowUp()}
                  disabled={sendingFollowUp || followUpInput.trim().length === 0}
                >
                  {sendingFollowUp ? 'Asking...' : 'Ask Follow-up'}
                </button>
              </div>
            </div>
          ) : null}
        </>
      ) : result.error ? (
        <p style={{ margin: 0, color: 'var(--red)', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '4px' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
          {result.error}
        </p>
      ) : (
        <p style={{ margin: 0, color: 'var(--gray-500)', fontSize: '13px' }}>
          Match was skipped by pipeline filters.
        </p>
      )}
    </div>
  );
}
