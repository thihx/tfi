import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import type {
  AskAiFollowUpMessage,
  ServerMatchPipelineResult,
  ServerParsedAiResult,
} from '@/features/live-monitor/services/server-monitor.service';
import { getParsedAiResult } from '@/features/live-monitor/services/server-monitor.service';
import { AskAiQuickPromptChips } from '@/components/ui/AskAiQuickPromptChips';
import { useAskAiQuickPromptList } from '@/hooks/useAskAiQuickPromptList';
import { useAuth } from '@/hooks/useAuth';
import { useUiLanguage } from '@/hooks/useUiLanguage';
import {
  getAskAiQuickPromptsSectionLabel,
  uiLanguageToAskAiPromptLocale,
} from '@/lib/askAiQuickPrompts';
import type { AuthUser } from '@/lib/services/auth';
import { UserAvatar } from '@/components/ui/UserAvatar';

const DECISION_META = {
  ai_push: { label: 'Signal', color: '#fff', bg: 'var(--green)' },
  condition_only: { label: 'Cond Only', color: '#fff', bg: 'var(--primary)' },
  no_bet: { label: 'No pick', color: 'var(--gray-500)', bg: 'var(--gray-100)' },
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

/** Same sparkle marks as the analysis control on Matches (SparkleIcon). */
function AskAiSparkleIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden style={{ display: 'block' }}>
      <path d="M12 2l1.5 4.5L18 8l-4.5 1.5L12 14l-1.5-4.5L6 8l4.5-1.5L12 2z" />
      <path d="M19 14l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9.9-2.1z" />
      <path d="M5 17l.6 1.4L7 19l-1.4.6L5 21l-.6-1.4L3 19l1.4-.6L5 17z" />
    </svg>
  );
}

/** Paper-plane style send icon (idle submit). */
function FollowUpSendIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="22" y1="2" x2="11" y2="13" />
      <path d="M22 2L15 22l-4-9-9-4L22 2z" />
    </svg>
  );
}

function FollowUpThinkingBubble() {
  return (
    <div
      className="ai-followup-bubble"
      role="status"
      aria-live="polite"
      aria-label="Analysis in progress"
      style={{
        alignSelf: 'flex-start',
        maxWidth: '100%',
        padding: '11px 14px',
        borderRadius: '10px',
        background: '#fff',
        border: '1px dashed var(--gray-300)',
      }}
    >
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
        <span className="ai-followup-thinking-icon" style={{ flexShrink: 0, display: 'flex', color: 'var(--gray-600)' }}>
          <AskAiSparkleIcon size={15} />
        </span>
        <span style={{ fontSize: '11px', color: 'var(--gray-500)', fontStyle: 'italic' }}>Thinking…</span>
      </div>
    </div>
  );
}

function FollowUpBubble({ message, user }: { message: AskAiFollowUpMessage; user: AuthUser | null }) {
  const isUser = message.role === 'user';
  if (isUser) {
    return (
      <div
        className="ai-followup-bubble"
        style={{
          alignSelf: 'flex-end',
          width: 'fit-content',
          maxWidth: 'min(100%, 22rem)',
          padding: '11px 14px',
          borderRadius: '10px',
          background: 'rgba(59,130,246,0.08)',
          border: '1px solid rgba(59,130,246,0.2)',
        }}
      >
        <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', flexDirection: 'row' }}>
          <UserAvatar user={user} size={22} />
          <div
            style={{
              fontSize: '11px',
              lineHeight: 1.55,
              color: 'var(--gray-700)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              flex: 1,
              minWidth: 0,
              textAlign: 'left',
            }}
          >
            {message.text}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div
      className="ai-followup-bubble"
      style={{
        alignSelf: 'flex-start',
        maxWidth: '100%',
        padding: '11px 14px',
        borderRadius: '10px',
        background: '#fff',
        border: '1px solid var(--gray-200)',
      }}
    >
      <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
        <span
          style={{ flexShrink: 0, display: 'flex', color: 'var(--gray-600)', marginTop: '2px' }}
          title="Assistant"
          aria-label="Assistant reply"
        >
          <AskAiSparkleIcon size={15} />
        </span>
        <div
          style={{
            fontSize: '11px',
            lineHeight: 1.55,
            color: 'var(--gray-700)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            flex: 1,
            minWidth: 0,
          }}
        >
          {message.text}
        </div>
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

/** Max length for match follow-up chat input (UI + client-side cap). */
const FOLLOW_UP_MAX_CHARS = 100;

const PANEL_ICON_BTN: CSSProperties = {
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
};

export function AiAnalysisPanel({ entry, onClose, onFollowUp }: Props) {
  const { user } = useAuth();
  const uiLanguage = useUiLanguage();
  const promptLocale = uiLanguageToAskAiPromptLocale(uiLanguage);
  const quickPrompts = useAskAiQuickPromptList(promptLocale);
  const quickPromptsLabel = getAskAiQuickPromptsSectionLabel('en');

  const { result } = entry;
  const ai: ServerParsedAiResult | null = getParsedAiResult(result);
  const dbg = result.debug;
  const contextTags = buildContextTags(dbg);
  const selection = ai?.selection || result.selection || '--';
  const market = ai?.bet_market || '--';
  const followUps = useMemo(() => entry.followUpMessages ?? [], [entry.followUpMessages]);
  const [followUpInput, setFollowUpInput] = useState('');
  const [sendingFollowUp, setSendingFollowUp] = useState(false);
  const [optimisticUserText, setOptimisticUserText] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);
  const followUpScrollRef = useRef<HTMLDivElement>(null);

  const canFollowUp = !!ai && result.success && typeof onFollowUp === 'function';

  /** True when server history already contains this optimistic user + assistant pair. */
  const hasMergedOptimistic = useMemo(() => {
    if (!optimisticUserText) return true;
    const n = followUps.length;
    if (n < 2) return false;
    const u = followUps[n - 2];
    const a = followUps[n - 1];
    return u?.role === 'user' && u.text === optimisticUserText && a?.role === 'assistant';
  }, [followUps, optimisticUserText]);

  const showPendingFollowUp = optimisticUserText != null && !hasMergedOptimistic;
  const followUpInputLocked = sendingFollowUp || showPendingFollowUp;

  useEffect(() => {
    if (hasMergedOptimistic && optimisticUserText) {
      setOptimisticUserText(null);
    }
  }, [hasMergedOptimistic, optimisticUserText]);

  useEffect(() => {
    setOptimisticUserText(null);
    setFollowUpInput('');
  }, [entry.matchId]);

  useLayoutEffect(() => {
    const el = followUpScrollRef.current;
    if (!el) return;
    const top = el.scrollHeight;
    if (typeof el.scrollTo === 'function') {
      el.scrollTo({ top, behavior: 'smooth' });
    } else {
      el.scrollTop = top;
    }
  }, [followUps.length, showPendingFollowUp]);

  const submitFollowUp = async () => {
    const question = followUpInput.trim();
    if (!question || !onFollowUp || followUpInputLocked) return;
    setSendingFollowUp(true);
    setOptimisticUserText(question);
    setFollowUpInput('');
    try {
      await onFollowUp(question, followUps);
    } catch {
      setFollowUpInput(question);
      setOptimisticUserText(null);
    } finally {
      setSendingFollowUp(false);
    }
  };

  const onFollowUpKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    if (event.nativeEvent.isComposing) return;
    event.preventDefault();
    void submitFollowUp();
  };

  return (
    <div
      id={`ai-result-${entry.matchId}`}
      className="ai-result-panel"
      style={{
        position: 'relative',
        background: 'var(--gray-50)',
        border: '1px solid var(--gray-200)',
        borderRadius: '8px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: '10px',
          right: '10px',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
        }}
      >
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          title={expanded ? 'Collapse' : 'Expand'}
          aria-expanded={expanded}
          aria-label={expanded ? 'Collapse panel' : 'Expand panel'}
          style={PANEL_ICON_BTN}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            {expanded ? <path d="M6 15l6-6 6 6" /> : <path d="M6 9l6 6 6-6" />}
          </svg>
        </button>
        <button type="button" onClick={onClose} title="Close" aria-label="Close panel" style={PANEL_ICON_BTN}>
          x
        </button>
      </div>

      <div className="ai-result-panel__inner">
        <div className="ai-result-panel__header" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', minWidth: 0 }}>
          <h4 style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: 'var(--gray-800)', whiteSpace: 'nowrap' }}>
            Match analysis
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

        {expanded ? (
      ai ? (
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

          {(ai.reasoning_vi || ai.reasoning_en || ai.condition_triggered_suggestion || (ai.warnings?.length ?? 0) > 0) ? (
            <div className="ai-result-panel__prose-block">
              {(ai.reasoning_vi || ai.reasoning_en) ? (
                <p style={{ margin: 0, fontSize: '12px', color: 'var(--gray-700)' }}>
                  <strong style={{ color: 'var(--gray-500)', marginRight: '4px' }}>Reasoning:</strong>
                  {ai.reasoning_vi || ai.reasoning_en}
                </p>
              ) : null}

              {ai.condition_triggered_suggestion ? (
                <p style={{ margin: 0, fontSize: '12px', color: 'var(--gray-700)' }}>
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
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '8px',
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
                  <span style={{ lineHeight: 1.65 }}>{(ai.warnings ?? []).join(' | ')}</span>
                </p>
              ) : null}
            </div>
          ) : null}

          {(followUps.length > 0 || showPendingFollowUp) ? (
            <div className="ai-result-panel__followup-sep">
              <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                Match Follow-up
              </div>
              {followUps.length === 1 && followUps[0]?.role === 'user' ? (
                <p style={{ margin: '0 0 6px', fontSize: '10px', color: 'var(--gray-500)', lineHeight: 1.45 }}>
                  Main analysis is above. Your prompt is shown here so you can tell it shaped this run; continue chatting below if needed.
                </p>
              ) : null}
              <div className="ai-result-panel__chat-thread">
                <div
                  ref={followUpScrollRef}
                  aria-busy={followUpInputLocked}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                    maxHeight: 'min(200px, 35vh)',
                    overflowY: 'auto',
                    overflowX: 'hidden',
                    paddingRight: '8px',
                    paddingBottom: '6px',
                    paddingLeft: '8px',
                    boxSizing: 'border-box',
                  }}
                >
                  {followUps.map((message, index) => (
                    <FollowUpBubble key={`${message.role}-${index}-${message.text.slice(0, 24)}`} message={message} user={user} />
                  ))}
                  {showPendingFollowUp ? (
                    <>
                      <FollowUpBubble message={{ role: 'user', text: optimisticUserText! }} user={user} />
                      <FollowUpThinkingBubble />
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          {canFollowUp ? (
            <div
              className={['ai-result-panel__chat-compose', (followUps.length > 0 || showPendingFollowUp) ? null : 'ai-result-panel__followup-sep'].filter(Boolean).join(' ')}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                minWidth: 0,
              }}
            >
              <AskAiQuickPromptChips
                label={quickPromptsLabel}
                prompts={quickPrompts}
                disabled={followUpInputLocked}
                onPick={(text) => setFollowUpInput(text.slice(0, FOLLOW_UP_MAX_CHARS))}
              />
              <div style={{ display: 'flex', gap: '10px', alignItems: 'stretch' }}>
                <input
                  type="text"
                  id={`ai-followup-input-${entry.matchId}`}
                  aria-label="Follow-up question for this match"
                  value={followUpInput}
                  maxLength={FOLLOW_UP_MAX_CHARS}
                  onChange={(event) => setFollowUpInput(event.target.value)}
                  onKeyDown={onFollowUpKeyDown}
                  placeholder="Question… Enter to send"
                  autoComplete="off"
                  style={{
                    flex: 1,
                    minWidth: 0,
                    height: '36px',
                    borderRadius: '8px',
                    border: '1px solid var(--gray-200)',
                    padding: '0 12px',
                    fontSize: '12px',
                    lineHeight: 1.4,
                    fontFamily: 'inherit',
                    background: followUpInputLocked ? 'var(--gray-100)' : '#fff',
                    boxSizing: 'border-box',
                    opacity: followUpInputLocked ? 0.85 : 1,
                  }}
                  disabled={followUpInputLocked}
                />
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  title={followUpInputLocked ? 'Waiting for reply…' : 'Send (Enter)'}
                  aria-label={followUpInputLocked ? 'Assistant is replying' : 'Send follow-up'}
                  aria-busy={followUpInputLocked}
                  onClick={() => void submitFollowUp()}
                  disabled={followUpInputLocked || followUpInput.trim().length === 0}
                  style={{
                    flexShrink: 0,
                    alignSelf: 'stretch',
                    minWidth: '40px',
                    paddingLeft: '10px',
                    paddingRight: '10px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {followUpInputLocked ? (
                    <span className="ai-followup-thinking-icon" style={{ display: 'inline-flex', color: 'var(--gray-600)' }}>
                      <AskAiSparkleIcon size={16} />
                    </span>
                  ) : (
                    <span style={{ display: 'inline-flex', color: 'var(--gray-600)' }}>
                      <FollowUpSendIcon size={18} />
                    </span>
                  )}
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
      )
        ) : null}
      </div>
    </div>
  );
}
