// WatchlistEditModal — watch rules and conditions (context/priors live in Match hub)
import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { ConditionBuilder, type ConditionLineStatus } from '@/components/ui/ConditionBuilder';
import { fetchMonitorConfig } from '@/features/live-monitor/config';
import type { LiveMonitorConfig } from '@/features/live-monitor/types';
import { useAppState } from '@/hooks/useAppState';
import {
  evaluateWatchConditionPreview,
  evaluateMatchAlertRulePreview,
  fetchConditionAlertPresets,
  fetchMatchAlertRules,
  type ConditionAlertPreset,
  type WatchConditionEvaluationResult,
} from '@/lib/services/api';
import { fetchNotificationChannels } from '@/lib/services/notification-channels';
import type { NotificationChannelConfig, WatchlistItem } from '@/types';

const FORM_ID = 'watchlist-edit-form';

function normalizeCondition(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')');
}

type ChannelStatusLine = {
  id: 'telegram' | 'zalo';
  label: string;
  monitorOn: boolean;
  linked: boolean;
};

type PreviewStatus = ConditionLineStatus;

function statusFromEvaluation(
  supported: boolean,
  matched: boolean,
  summary?: string,
): PreviewStatus {
  if (!supported) {
    return { status: 'unsupported', label: 'Unsupported', summary };
  }
  if (matched) {
    return { status: 'matched', label: 'Matched now', summary };
  }
  return { status: 'not_matched', label: 'Not now', summary };
}

function conditionStatusKey(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function extractConditionClauses(value: string): string[] {
  const text = normalizeCondition(value);
  if (!text) return [];
  const clauses: string[] = [];
  const regex = /\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const clause = normalizeCondition(match[1]);
    if (clause) clauses.push(clause);
  }
  return clauses.length > 0 ? clauses : [text];
}

function buildChannelStatusLines(
  cfg: LiveMonitorConfig,
  channels: NotificationChannelConfig[],
): ChannelStatusLine[] {
  const tel = channels.find((c) => c.channelType === 'telegram');
  const zalo = channels.find((c) => c.channelType === 'zalo');
  return [
    {
      id: 'telegram',
      label: 'Telegram',
      monitorOn: cfg.TELEGRAM_ENABLED === true,
      linked: Boolean(tel?.enabled && tel.status === 'verified'),
    },
    {
      id: 'zalo',
      label: 'Zalo',
      monitorOn: cfg.ZALO_ENABLED === true,
      linked: Boolean(zalo?.enabled && zalo.status === 'verified'),
    },
  ];
}

const COPY = {
  hubHint: 'Double-click the row for live stats and context in Match hub.',
  suggestionTitle: 'System suggestion',
  suggestionEmpty: 'No suggestion yet. Add clauses below or wait for enrichment.',
  applyRecommended: 'Add to manual rules',
  autoApplyLabel: 'Use system suggestion when saving',
  autoApplyDetails:
    'When on, Save stores the suggestion if your manual list is empty or still matches it. Different manual text is kept as-is.',
  manualSection: 'Your conditions',
  conditionPlaceholder: 'Minute >= 60',
  previewNoteAuto: 'Empty manual list → saves the suggestion above.',
  save: 'Save changes',
  notifyLabel: 'Push when condition matches',
  notifyDetails: 'Save changes to activate background push. Test only previews the current live state.',
  checkTrigger: 'Test with live data',
  checkingTrigger: 'Testing…',
  triggerMatched: 'Would trigger now (preview only)',
  triggerNotMatched: 'Would not trigger',
  triggerUnsupported: 'Unsupported or missing data',
  triggerChannelsOff: 'Push off for this watch',
  previewError: 'Could not evaluate condition',
} as const;

interface WatchlistEditModalProps {
  item: WatchlistItem | null;
  onClose: () => void;
  onSave: (changes: {
    custom_conditions: string;
    auto_apply_recommended_condition: boolean;
    notify_enabled: boolean;
    condition_preset_ids?: string[];
  }) => void;
}

export function WatchlistEditModal({ item, onClose, onSave }: WatchlistEditModalProps) {
  const { state } = useAppState();
  const apiUrl = state.config.apiUrl;
  const c = COPY;
  const [editConditions, setEditConditions] = useState(() => item?.custom_conditions || '');
  const [autoApplyRecommendedCondition, setAutoApplyRecommendedCondition] = useState(() => item?.auto_apply_recommended_condition ?? true);
  const [notifyEnabled, setNotifyEnabled] = useState(() => item?.notify_enabled !== false);
  const [conditionEval, setConditionEval] = useState<WatchConditionEvaluationResult | null>(null);
  const [conditionEvalError, setConditionEvalError] = useState<string | null>(null);
  const [conditionEvalLoading, setConditionEvalLoading] = useState(false);
  const [conditionLineStatuses, setConditionLineStatuses] = useState<Record<string, PreviewStatus>>({});
  const [conditionPresetStatuses, setConditionPresetStatuses] = useState<Record<string, PreviewStatus>>({});
  const [channelLines, setChannelLines] = useState<ChannelStatusLine[] | null>(null);
  const [conditionPresets, setConditionPresets] = useState<ConditionAlertPreset[]>([]);
  const [selectedPresetIds, setSelectedPresetIds] = useState<Set<string>>(new Set());

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
    setConditionLineStatuses({});
    setConditionPresetStatuses({});
  }, [item]);

  useEffect(() => {
    if (!item) {
      setChannelLines(null);
      return;
    }
    let cancelled = false;
    void Promise.all([
      fetchMonitorConfig(),
      fetchNotificationChannels().catch(() => [] as NotificationChannelConfig[]),
    ])
      .then(([cfg, channels]) => {
        if (cancelled) return;
        setChannelLines(buildChannelStatusLines(cfg, channels));
      })
      .catch(() => {
        if (!cancelled) setChannelLines(null);
      });
    return () => {
      cancelled = true;
    };
  }, [item]);

  useEffect(() => {
    if (!item) {
      setConditionPresets([]);
      setSelectedPresetIds(new Set());
      return;
    }
    let cancelled = false;
    void Promise.all([
      fetchConditionAlertPresets(apiUrl ?? ''),
      fetchMatchAlertRules(apiUrl ?? '', { matchId: String(item.match_id), alertKind: 'condition_signal' }).catch(() => []),
    ])
      .then(([presets, rules]) => {
        if (cancelled) return;
        setConditionPresets(presets);
        const existingPresetIds = rules
          .map((rule) => rule.source.startsWith('preset:') ? rule.source.slice('preset:'.length) : '')
          .filter(Boolean);
        setSelectedPresetIds(new Set(
          existingPresetIds.length > 0
            ? existingPresetIds
            : presets.filter((preset) => preset.enabled).slice(0, 5).map((preset) => preset.id),
        ));
      })
      .catch(() => {
        if (!cancelled) setConditionPresets([]);
      });
    return () => {
      cancelled = true;
    };
  }, [apiUrl, item]);

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
  }, [autoApplyRecommendedCondition, hasRecommended, manualTrim, c.previewNoteAuto]);

  function resolvePersistedCustomConditions(): string {
    if (!item) return '';
    const recommendedCondition = normalizeCondition(item.recommended_custom_condition || '');
    const currentCondition = normalizeCondition(editConditions);
    const safeToAutoApply = !currentCondition || currentCondition === recommendedCondition;
    if (autoApplyRecommendedCondition && recommendedCondition && safeToAutoApply) return recommendedCondition;
    return editConditions;
  }

  function handleConditionChange(value: string) {
    setEditConditions(value);
    setConditionEval(null);
    setConditionLineStatuses({});
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!item) return;
    onSave({
      custom_conditions: resolvePersistedCustomConditions(),
      auto_apply_recommended_condition: autoApplyRecommendedCondition,
      notify_enabled: notifyEnabled,
      condition_preset_ids: Array.from(selectedPresetIds),
    });
  }

  async function handleCheckTrigger() {
    if (!item || apiUrl == null) return;
    setConditionEvalLoading(true);
    setConditionEvalError(null);
    try {
      const conditionText = resolvePersistedCustomConditions();
      const res = await evaluateWatchConditionPreview(state.config, {
        condition_text: conditionText,
        match_id: String(item.match_id),
      });
      setConditionEval(res);

      const clauseResults = await Promise.allSettled(
        extractConditionClauses(conditionText).map(async (clause) => {
          const evaluation = await evaluateWatchConditionPreview(state.config, {
            condition_text: clause,
            match_id: String(item.match_id),
          });
          return {
            key: conditionStatusKey(clause),
            status: statusFromEvaluation(evaluation.supported, evaluation.matched, evaluation.summary),
          };
        }),
      );
      const nextLineStatuses: Record<string, PreviewStatus> = {};
      for (const result of clauseResults) {
        if (result.status === 'fulfilled') nextLineStatuses[result.value.key] = result.value.status;
      }
      setConditionLineStatuses(nextLineStatuses);

      const presetResults = await Promise.allSettled(
        conditionPresets.map(async (preset) => {
          const preview = await evaluateMatchAlertRulePreview(state.config, {
            matchId: String(item.match_id),
            alertKind: 'condition_signal',
            presetId: preset.id,
          });
          return {
            key: preset.id,
            status: statusFromEvaluation(
              preview.evaluation.supported,
              preview.evaluation.matched,
              preview.evaluation.unsupportedReason ?? preview.evaluation.summaryVi ?? preview.evaluation.summaryEn,
            ),
          };
        }),
      );
      const nextPresetStatuses: Record<string, PreviewStatus> = {};
      for (const result of presetResults) {
        if (result.status === 'fulfilled') nextPresetStatuses[result.value.key] = result.value.status;
      }
      setConditionPresetStatuses(nextPresetStatuses);
    } catch (err) {
      setConditionEval(null);
      setConditionLineStatuses({});
      setConditionPresetStatuses({});
      setConditionEvalError(err instanceof Error ? err.message : c.previewError);
    } finally {
      setConditionEvalLoading(false);
    }
  }

  const matchTitle = item ? `${item.home_team} vs ${item.away_team}` : '';

  const triggerStatusClass = !conditionEval
    ? ''
    : !conditionEval.notify_enabled
      ? 'watchlist-trigger-status--warn'
      : conditionEval.supported && conditionEval.matched
        ? 'watchlist-trigger-status--ok'
        : conditionEval.supported
          ? 'watchlist-trigger-status--muted'
          : 'watchlist-trigger-status--warn';

  const triggerStatusText = !conditionEval
    ? ''
    : !conditionEval.notify_enabled
      ? c.triggerChannelsOff
      : conditionEval.supported && conditionEval.matched
        ? c.triggerMatched
        : conditionEval.supported
          ? c.triggerNotMatched
          : c.triggerUnsupported;

  return (
    <Modal
      open={!!item}
      title={matchTitle || 'Watch alerts'}
      onClose={onClose}
      size="lg"
      footer={item ? (
        <div className="watch-rules-footer">
          <div className="watch-rules-footer__test">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={conditionEvalLoading || apiUrl == null}
              onClick={() => void handleCheckTrigger()}
            >
              {conditionEvalLoading ? c.checkingTrigger : c.checkTrigger}
            </button>
            {conditionEval && (
              <span className={`watchlist-trigger-status ${triggerStatusClass}`}>
                {triggerStatusText}
              </span>
            )}
          </div>
          <button type="submit" form={FORM_ID} className="btn btn-primary">
            {c.save}
          </button>
        </div>
      ) : undefined}
    >
      {item && (
        <form id={FORM_ID} className="watch-rules-modal" onSubmit={handleSubmit}>
          <p className="watch-rules-modal__hint">{c.hubHint}</p>

          <section className="watch-rules-panel" aria-labelledby="watch-rules-suggestion-heading">
            <h3 id="watch-rules-suggestion-heading" className="watch-rules-panel__title">
              {c.suggestionTitle}
            </h3>
            {hasRecommended ? (
              <>
                <code className="watch-rules-expression">{recommendedRaw}</code>
                {reasonText ? (
                  <details className="watch-rules-details">
                    <summary>Rationale</summary>
                    <p>{reasonText}</p>
                  </details>
                ) : null}
                <div className="watch-rules-panel__actions">
                  <button
                    id="apply-recommended-btn"
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      const current = editConditions.trim();
                      const rec = item.recommended_custom_condition!;
                      if (current && current.includes(rec)) return;
                      setEditConditions(current ? `${current} AND (${rec})` : `(${rec})`);
                    }}
                  >
                    {c.applyRecommended}
                  </button>
                  <label htmlFor="watchlist-auto-apply-rec" className="watch-rules-inline-check">
                    <input
                      id="watchlist-auto-apply-rec"
                      type="checkbox"
                      checked={autoApplyRecommendedCondition}
                      onChange={(e) => setAutoApplyRecommendedCondition(e.target.checked)}
                    />
                    <span>{c.autoApplyLabel}</span>
                  </label>
                </div>
                <details className="watch-rules-details watch-rules-details--compact">
                  <summary>How auto-apply works</summary>
                  <p>{c.autoApplyDetails}</p>
                </details>
              </>
            ) : (
              <p className="watch-rules-panel__empty">{c.suggestionEmpty}</p>
            )}
          </section>

          {!hasRecommended && (
            <label htmlFor="watchlist-auto-apply-rec-empty" className="watch-rules-inline-check watch-rules-inline-check--block">
              <input
                id="watchlist-auto-apply-rec-empty"
                type="checkbox"
                checked={autoApplyRecommendedCondition}
                onChange={(e) => setAutoApplyRecommendedCondition(e.target.checked)}
              />
              <span>{c.autoApplyLabel}</span>
            </label>
          )}

          <ConditionBuilder
            initialValue={editConditions}
            onChange={handleConditionChange}
            sectionLabel={c.manualSection}
            inputPlaceholder={c.conditionPlaceholder}
            previewNote={previewNote}
            lineStatuses={conditionLineStatuses}
          />

          {conditionPresets.length > 0 && (
            <section className="watch-rules-panel" aria-labelledby="watch-rules-presets-heading">
              <h3 id="watch-rules-presets-heading" className="watch-rules-panel__title">
                Fast condition presets
              </h3>
              <div className="watch-rules-preset-grid">
                {conditionPresets.map((preset) => {
                  const checked = selectedPresetIds.has(preset.id);
                  const previewStatus = conditionPresetStatuses[preset.id];
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      className={[
                        'watch-rules-preset-chip',
                        checked ? 'watch-rules-preset-chip--selected' : '',
                        previewStatus ? `watch-rules-preset-chip--${previewStatus.status}` : '',
                      ].filter(Boolean).join(' ')}
                      onClick={() => {
                        setSelectedPresetIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(preset.id)) next.delete(preset.id);
                          else next.add(preset.id);
                          return next;
                        });
                      }}
                      title={preset.description}
                    >
                      <span>{preset.labelVi || preset.label}</span>
                      {previewStatus ? (
                        <span className="watch-rules-preset-chip__status">{previewStatus.label}</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          <section className="watch-rules-panel watch-rules-panel--notify" aria-labelledby="watch-rules-notify-heading">
            <h3 id="watch-rules-notify-heading" className="watch-rules-panel__title watch-rules-panel__title--sr">
              Notifications
            </h3>
            <label htmlFor="watchlist-notify-enabled" className="watch-rules-inline-check watch-rules-inline-check--block">
              <input
                id="watchlist-notify-enabled"
                type="checkbox"
                checked={notifyEnabled}
                onChange={(e) => setNotifyEnabled(e.target.checked)}
              />
              <span>{c.notifyLabel}</span>
            </label>
            <details className="watch-rules-details watch-rules-details--compact">
              <summary>Delivery options</summary>
              <p>{c.notifyDetails}</p>
              {channelLines && channelLines.length > 0 ? (
                <ul className="watch-rules-channels">
                  {channelLines.map((line) => (
                    <li key={line.id} className="watch-rules-channel">
                      <span className="watch-rules-channel__name">{line.label}</span>
                      <span className={`watch-rules-channel__pill${line.monitorOn ? ' is-on' : ''}`}>
                        {line.monitorOn ? 'Monitor on' : 'Monitor off'}
                      </span>
                      <span className={`watch-rules-channel__pill${line.linked ? ' is-linked' : ''}`}>
                        {line.linked ? 'Linked' : 'Not linked'}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </details>
          </section>

          {conditionEval && (
            <p className="watch-rules-eval-summary text-muted">
              {conditionEval.summary}
              {' '}
              (min {conditionEval.context_summary.minute ?? '—'},{' '}
              {conditionEval.context_summary.home_goals}-{conditionEval.context_summary.away_goals},{' '}
              {conditionEval.context_summary.data_source})
            </p>
          )}
          {conditionEvalError && (
            <p className="watch-rules-eval-error" role="alert">{conditionEvalError}</p>
          )}
        </form>
      )}
    </Modal>
  );
}
