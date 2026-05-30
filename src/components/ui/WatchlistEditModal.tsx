// WatchlistEditModal — watch rules and conditions (context/priors live in Match hub)
import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { ConditionBuilder } from '@/components/ui/ConditionBuilder';
import { fetchMonitorConfig } from '@/features/live-monitor/config';
import type { LiveMonitorConfig } from '@/features/live-monitor/types';
import { useAppState } from '@/hooks/useAppState';
import { evaluateWatchConditionPreview, type WatchConditionEvaluationResult } from '@/lib/services/api';
import { fetchNotificationChannels } from '@/lib/services/notification-channels';
import type { NotificationChannelConfig, WatchlistItem } from '@/types';

function normalizeCondition(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')');
}

/** One line: monitor flags + whether Telegram/Zalo rows look linked (verified). */
function formatAccountDeliverySummary(cfg: LiveMonitorConfig, channels: NotificationChannelConfig[]): string {
  const monitorTelegram = cfg.TELEGRAM_ENABLED === true;
  const monitorZalo = cfg.ZALO_ENABLED === true;
  const tel = channels.find((c) => c.channelType === 'telegram');
  const zalo = channels.find((c) => c.channelType === 'zalo');
  const telLinked = Boolean(tel?.enabled && tel.status === 'verified');
  const zaloLinked = Boolean(zalo?.enabled && zalo.status === 'verified');

  const telegram = `${monitorTelegram ? 'monitor on' : 'monitor off'} · ${telLinked ? 'Telegram linked' : 'Telegram not linked'}`;
  const zaloPart = `${monitorZalo ? 'monitor on' : 'monitor off'} · ${zaloLinked ? 'Zalo linked' : 'Zalo not linked'}`;
  return `Telegram: ${telegram} · Zalo: ${zaloPart}`;
}

/** English-only UI until formal i18n ships (see `useUiLanguage` / `UI_LANGUAGE` for future locale). */
const WATCHLIST_EDIT_COPY = {
  intro:
    'Choose how this watchlist match fires alerts. Live stats and AI context live in the Match hub — open the row (double-click).',
  suggestionTitle: 'System suggestion',
  suggestionEmpty:
    'No machine-evaluable suggestion yet. Common when enrichment has not finished, sources were weak, or the model did not return a parenthesis-style condition. You can still add your own clauses below.',
  conditionLabel: 'Expression',
  reasonLabel: 'Rationale',
  applyRecommended: 'Insert suggestion into manual field',
  autoApplyLabel: 'Use system suggestion when saving',
  autoApplyHint:
    'When on: if the manual field is empty (or exactly matches the suggestion), Save stores the suggestion above. If you typed something different, Save keeps your text.',
  manualSection: 'Your conditions (optional)',
  conditionPlaceholder: '(Minute >= 60) AND (Total goals <= 2)',
  previewNoteAuto:
    'Preview only reflects clauses you type below. With this option on and no manual clauses, Save will persist the system suggestion.',
  manualHintNoSuggestion: 'No suggestion yet — add one or more parenthesized clauses below.',
  save: 'Save Changes',
  notifyLabel: 'Push notification when this condition matches',
  notifyHint:
    'Uses the same machine check as the live pipeline when a channel below is allowed and linked. Turn off to keep this match in-app only.',
  notifyChannelsHeading: 'Account channels',
  checkTrigger: 'Check against current match data',
  checkingTrigger: 'Checking…',
  triggerMatched: 'Would trigger now',
  triggerNotMatched: 'Would not trigger with current data',
  triggerUnsupported: 'Condition not supported or missing data for a clause',
  triggerChannelsOff: 'Notifications are disabled for this watch — enable above to allow pushes.',
  previewError: 'Could not evaluate condition',
} as const;

interface WatchlistEditModalProps {
  item: WatchlistItem | null;
  onClose: () => void;
  onSave: (changes: {
    custom_conditions: string;
    auto_apply_recommended_condition: boolean;
    notify_enabled: boolean;
  }) => void;
}

export function WatchlistEditModal({ item, onClose, onSave }: WatchlistEditModalProps) {
  const { state } = useAppState();
  const apiUrl = state.config.apiUrl;
  const c = WATCHLIST_EDIT_COPY;
  const [editConditions, setEditConditions] = useState(() => item?.custom_conditions || '');
  const [autoApplyRecommendedCondition, setAutoApplyRecommendedCondition] = useState(() => item?.auto_apply_recommended_condition ?? true);
  const [notifyEnabled, setNotifyEnabled] = useState(() => item?.notify_enabled !== false);
  const [conditionEval, setConditionEval] = useState<WatchConditionEvaluationResult | null>(null);
  const [conditionEvalError, setConditionEvalError] = useState<string | null>(null);
  const [conditionEvalLoading, setConditionEvalLoading] = useState(false);
  const [deliverySummary, setDeliverySummary] = useState<string | null>(null);

  useEffect(() => {
    if (!item) return;
    let cancelled = false;

    if (item.auto_apply_recommended_condition != null) {
      return undefined;
    }

    void fetchMonitorConfig()
      .then((monitorConfig) => {
        if (cancelled) return;
        setAutoApplyRecommendedCondition(monitorConfig.AUTO_APPLY_RECOMMENDED_CONDITION !== false);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [item]);

  useEffect(() => {
    if (!item) return;
    setEditConditions(item.custom_conditions || '');
    setAutoApplyRecommendedCondition(item.auto_apply_recommended_condition ?? true);
    setNotifyEnabled(item.notify_enabled !== false);
    setConditionEval(null);
    setConditionEvalError(null);
  }, [item]);

  useEffect(() => {
    if (!item) {
      setDeliverySummary(null);
      return;
    }
    let cancelled = false;
    void Promise.all([
      fetchMonitorConfig(),
      fetchNotificationChannels().catch(() => [] as NotificationChannelConfig[]),
    ])
      .then(([cfg, channels]) => {
        if (cancelled) return;
        setDeliverySummary(formatAccountDeliverySummary(cfg, channels));
      })
      .catch(() => {
        if (!cancelled) setDeliverySummary(null);
      });
    return () => {
      cancelled = true;
    };
  }, [item]);

  const recommendedRaw = item?.recommended_custom_condition;
  const hasRecommended = Boolean(normalizeCondition(recommendedRaw));
  const reasonText = useMemo(() => {
    if (!item) return '';
    return (item.recommended_condition_reason || item.recommended_condition_reason_vi || '').trim();
  }, [item]);

  const manualTrim = normalizeCondition(editConditions);
  const previewNote = useMemo(() => {
    if (!autoApplyRecommendedCondition || !hasRecommended || manualTrim) return null;
    return c.previewNoteAuto;
  }, [autoApplyRecommendedCondition, hasRecommended, manualTrim]);

  function resolvePersistedCustomConditions(): string {
    if (!item) return '';
    const recommendedCondition = normalizeCondition(item.recommended_custom_condition || '');
    const currentCondition = normalizeCondition(editConditions);
    const safeToAutoApply = !currentCondition || currentCondition === recommendedCondition;
    if (autoApplyRecommendedCondition && recommendedCondition && safeToAutoApply) return recommendedCondition;
    return editConditions;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!item) return;
    onSave({
      custom_conditions: resolvePersistedCustomConditions(),
      auto_apply_recommended_condition: autoApplyRecommendedCondition,
      notify_enabled: notifyEnabled,
    });
  }

  async function handleCheckTrigger() {
    if (!item || apiUrl == null) return;
    setConditionEvalLoading(true);
    setConditionEvalError(null);
    try {
      const res = await evaluateWatchConditionPreview(state.config, {
        condition_text: resolvePersistedCustomConditions(),
        match_id: String(item.match_id),
      });
      setConditionEval(res);
    } catch (err) {
      setConditionEval(null);
      setConditionEvalError(err instanceof Error ? err.message : c.previewError);
    } finally {
      setConditionEvalLoading(false);
    }
  }

  const matchTitle = item ? `${item.home_team} vs ${item.away_team}` : '';

  return (
    <Modal open={!!item} title={matchTitle || 'Watch alerts and conditions'} onClose={onClose} size="lg">
      {item && (
        <form onSubmit={handleSubmit}>
          <p className="watchlist-edit-intro">{c.intro}</p>

          <div className="form-group watchlist-edit-section">
            <div className={`ai-recommended-box${hasRecommended ? '' : ' ai-recommended-empty'}`}>
              <div className="ai-recommended-header">{c.suggestionTitle}</div>
              {hasRecommended ? (
                <>
                  <div className="ai-recommended-content">
                    <div className="ai-recommended-item">
                      <label>{c.conditionLabel}</label>
                      <div className="ai-recommended-value">{recommendedRaw}</div>
                    </div>
                    {reasonText ? (
                      <div className="ai-recommended-item">
                        <label>{c.reasonLabel}</label>
                        <div className="ai-recommended-value">{reasonText}</div>
                      </div>
                    ) : null}
                  </div>
                  <button
                    id="apply-recommended-btn"
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => {
                      const current = editConditions.trim();
                      const rec = item.recommended_custom_condition!;
                      if (current && current.includes(rec)) return;
                      setEditConditions(current ? `${current} OR (${rec})` : `(${rec})`);
                    }}
                  >
                    {c.applyRecommended}
                  </button>
                </>
              ) : (
                <p className="ai-recommended-empty-text">{c.suggestionEmpty}</p>
              )}
            </div>
          </div>

          <div className="watchlist-edit-section">
            <label htmlFor="watchlist-auto-apply-rec" className="modal-check-row">
              <input
                id="watchlist-auto-apply-rec"
                type="checkbox"
                checked={autoApplyRecommendedCondition}
                onChange={(e) => setAutoApplyRecommendedCondition(e.target.checked)}
              />
              <span className="modal-check-row__text">{c.autoApplyLabel}</span>
            </label>
            <p id="watchlist-auto-apply-rec-hint" className="modal-check-row__hint">
              {c.autoApplyHint}
            </p>
          </div>

          {!hasRecommended ? (
            <p className="text-muted" style={{ fontSize: 12, margin: '0 0 10px', lineHeight: 1.45 }}>
              {c.manualHintNoSuggestion}
            </p>
          ) : null}

          <ConditionBuilder
            initialValue={editConditions}
            onChange={setEditConditions}
            sectionLabel={c.manualSection}
            inputPlaceholder={c.conditionPlaceholder}
            previewNote={previewNote}
          />

          <div className="watchlist-edit-section">
            <label htmlFor="watchlist-notify-enabled" className="modal-check-row">
              <input
                id="watchlist-notify-enabled"
                type="checkbox"
                checked={notifyEnabled}
                onChange={(e) => setNotifyEnabled(e.target.checked)}
              />
              <span className="modal-check-row__text">
                <strong style={{ display: 'block', marginBottom: '4px' }}>{c.notifyLabel}</strong>
                <span className="text-muted" style={{ fontSize: 12 }}>{c.notifyHint}</span>
                {deliverySummary ? (
                  <span style={{ display: 'block', marginTop: 8, fontSize: 12, lineHeight: 1.45 }}>
                    <strong>{c.notifyChannelsHeading}:</strong> {deliverySummary}
                  </span>
                ) : null}
              </span>
            </label>
          </div>

          <div className="watchlist-trigger-row">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={conditionEvalLoading || apiUrl == null}
              onClick={() => void handleCheckTrigger()}
            >
              {conditionEvalLoading ? c.checkingTrigger : c.checkTrigger}
            </button>
            {conditionEval && (
              <span
                className={`watchlist-trigger-status${
                  !conditionEval.notify_enabled
                    ? ' watchlist-trigger-status--warn'
                    : conditionEval.supported && conditionEval.matched
                      ? ' watchlist-trigger-status--ok'
                      : conditionEval.supported
                        ? ' watchlist-trigger-status--muted'
                        : ' watchlist-trigger-status--warn'
                }`}
              >
                {!conditionEval.notify_enabled
                  ? c.triggerChannelsOff
                  : conditionEval.supported && conditionEval.matched
                    ? c.triggerMatched
                    : conditionEval.supported
                      ? c.triggerNotMatched
                      : c.triggerUnsupported}
              </span>
            )}
          </div>
          {conditionEval && (
            <p className="text-muted" style={{ margin: '0 0 12px', fontSize: 12, lineHeight: 1.45 }}>
              {conditionEval.summary}
              {' '}
              <span>
                (minute {conditionEval.context_summary.minute ?? '—'}, score{' '}
                {conditionEval.context_summary.home_goals}-{conditionEval.context_summary.away_goals},{' '}
                source: {conditionEval.context_summary.data_source})
              </span>
            </p>
          )}
          {conditionEvalError && (
            <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--danger)' }}>{conditionEvalError}</p>
          )}

          <button type="submit" className="btn btn-primary btn-block">
            {c.save}
          </button>
        </form>
      )}
    </Modal>
  );
}
