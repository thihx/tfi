// ============================================================
// WatchlistEditModal — shared edit modal for watchlist items
// Used by WatchlistTab and MatchesTab
// ============================================================

import { useState, useEffect } from 'react';
import { Modal } from '@/components/ui/Modal';
import { ConditionBuilder } from '@/components/ui/ConditionBuilder';
import { formatLocalDateTime } from '@/lib/utils/helpers';
import { loadMonitorConfig } from '@/features/live-monitor/config';
import {
  getStrategicNarrative,
  getStrategicQuantitativeEntries,
  getStrategicRefreshMeta,
  getStrategicSourceMeta,
  isStructuredStrategicContext,
} from '@/lib/utils/strategicContext';
import type { UiLanguage } from '@/hooks/useUiLanguage';
import type { WatchlistItem } from '@/types';

function normalizeCondition(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')');
}

interface WatchlistEditModalProps {
  item: WatchlistItem | null;
  defaultMode: string;
  uiLanguage: UiLanguage;
  onClose: () => void;
  onSave: (changes: {
    mode: string;
    priority: number;
    status: string;
    custom_conditions: string;
    auto_apply_recommended_condition: boolean;
  }) => void;
}

export function WatchlistEditModal({ item, defaultMode, uiLanguage, onClose, onSave }: WatchlistEditModalProps) {
  const [editMode, setEditMode] = useState('');
  const [editPriority, setEditPriority] = useState('2');
  const [editStatus, setEditStatus] = useState('active');
  const [editConditions, setEditConditions] = useState('');
  const [autoApplyRecommendedCondition, setAutoApplyRecommendedCondition] = useState(true);

  useEffect(() => {
    if (!item) return;
    setEditMode(item.mode || defaultMode);
    setEditPriority(String(item.priority || 2));
    setEditStatus(item.status || 'active');
    setEditConditions(item.custom_conditions || '');
    setAutoApplyRecommendedCondition(
      item.auto_apply_recommended_condition ?? loadMonitorConfig().AUTO_APPLY_RECOMMENDED_CONDITION !== false,
    );
  }, [item, defaultMode]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!item) return;
    const recommendedCondition = normalizeCondition(item.recommended_custom_condition || '');
    const currentCondition = normalizeCondition(editConditions);
    const safeToAutoApply = !currentCondition || currentCondition === recommendedCondition;
    onSave({
      mode: editMode,
      priority: parseInt(editPriority),
      status: editStatus,
      custom_conditions: autoApplyRecommendedCondition && recommendedCondition && safeToAutoApply
        ? recommendedCondition
        : editConditions,
      auto_apply_recommended_condition: autoApplyRecommendedCondition,
    });
  }

  return (
    <Modal open={!!item} title="Edit Watchlist Item" onClose={onClose} size="lg">
      {item && (
        <form onSubmit={handleSubmit}>
          {(() => {
            const ctx = item.strategic_context;
            const homeMotivation = getStrategicNarrative(ctx, 'home_motivation', uiLanguage);
            const awayMotivation = getStrategicNarrative(ctx, 'away_motivation', uiLanguage);
            const leaguePositions = getStrategicNarrative(ctx, 'league_positions', uiLanguage);
            const keyAbsences = getStrategicNarrative(ctx, 'key_absences', uiLanguage);
            const rotationRisk = getStrategicNarrative(ctx, 'rotation_risk', uiLanguage);
            const fixtureCongestion = getStrategicNarrative(ctx, 'fixture_congestion', uiLanguage);
            const h2hNarrative = getStrategicNarrative(ctx, 'h2h_narrative', uiLanguage);
            const summary = getStrategicNarrative(ctx, 'summary', uiLanguage);
            const sourceMeta = getStrategicSourceMeta(ctx);
            const refreshMeta = getStrategicRefreshMeta(ctx);
            const quantitativeEntries = getStrategicQuantitativeEntries(ctx);
            const structuredContext = isStructuredStrategicContext(ctx);
            const trustedDomains = Array.from(new Set((sourceMeta?.sources || []).map((s) => s.domain).filter(Boolean)));
            const searchQueries = (sourceMeta?.web_search_queries || []).filter(Boolean);
            return (
              <>
                <div className="form-group">
                  <label>Match:</label>
                  <input type="text" readOnly value={`${item.home_team} vs ${item.away_team}`} />
                </div>
                <div className="form-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 160px), 1fr))', gap: '12px' }}>
                  <div className="form-group">
                    <label>Mode:</label>
                    <select value={editMode} onChange={(e) => setEditMode(e.target.value)}>
                      <option value="A">A - Aggressive</option>
                      <option value="B">B - Balanced</option>
                      <option value="C">C - Conservative</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Priority:</label>
                    <select value={editPriority} onChange={(e) => setEditPriority(e.target.value)}>
                      <option value="1">1 - Low</option>
                      <option value="2">2 - Medium</option>
                      <option value="3">3 - High</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Status:</label>
                    <select value={editStatus} onChange={(e) => setEditStatus(e.target.value)}>
                      <option value="pending">🟡 Pending</option>
                      <option value="active">🟢 Active</option>
                    </select>
                  </div>
                </div>

                {/* Strategic Context from AI */}
                {item.strategic_context && (
                  <div className="form-group">
                    <div className="strategic-context-box">
                      <div className="strategic-context-header">🧠 Strategic Context</div>
                      {(structuredContext || refreshMeta) && (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '8px', marginBottom: '12px' }}>
                          {structuredContext && (
                            <>
                              <div className="strategic-context-item">
                                <span className="strategic-context-label">🔎 Source Quality</span>
                                <span className="strategic-context-text">{sourceMeta?.search_quality || 'unknown'}</span>
                              </div>
                              <div className="strategic-context-item">
                                <span className="strategic-context-label">✅ Trusted Sources</span>
                                <span className="strategic-context-text">{sourceMeta?.trusted_source_count ?? 0}</span>
                              </div>
                              {ctx?.competition_type && (
                                <div className="strategic-context-item">
                                  <span className="strategic-context-label">🏆 Competition Type</span>
                                  <span className="strategic-context-text">{ctx.competition_type}</span>
                                </div>
                              )}
                            </>
                          )}
                          {refreshMeta?.refresh_status && (
                            <div className="strategic-context-item">
                              <span className="strategic-context-label">🔁 Refresh Status</span>
                              <span className="strategic-context-text">{refreshMeta.refresh_status}</span>
                            </div>
                          )}
                          {refreshMeta?.retry_after && (
                            <div className="strategic-context-item">
                              <span className="strategic-context-label">⏳ Retry After</span>
                              <span className="strategic-context-text">{formatLocalDateTime(refreshMeta.retry_after)}</span>
                            </div>
                          )}
                        </div>
                      )}
                      <div className="strategic-context-grid">
                        {homeMotivation && <div className="strategic-context-item"><span className="strategic-context-label">🏠 {item.home_team}</span><span className="strategic-context-text">{homeMotivation}</span></div>}
                        {awayMotivation && <div className="strategic-context-item"><span className="strategic-context-label">✈️ {item.away_team}</span><span className="strategic-context-text">{awayMotivation}</span></div>}
                        {leaguePositions && <div className="strategic-context-item"><span className="strategic-context-label">📊 Positions</span><span className="strategic-context-text">{leaguePositions}</span></div>}
                        {keyAbsences && <div className="strategic-context-item"><span className="strategic-context-label">🚑 Absences</span><span className="strategic-context-text">{keyAbsences}</span></div>}
                        {rotationRisk && <div className="strategic-context-item"><span className="strategic-context-label">🔄 Rotation</span><span className="strategic-context-text">{rotationRisk}</span></div>}
                        {fixtureCongestion && <div className="strategic-context-item"><span className="strategic-context-label">📅 Fixture Congestion</span><span className="strategic-context-text">{fixtureCongestion}</span></div>}
                        {h2hNarrative && <div className="strategic-context-item"><span className="strategic-context-label">⚔️ H2H</span><span className="strategic-context-text">{h2hNarrative}</span></div>}
                        {summary && <div className="strategic-context-item strategic-context-summary"><span className="strategic-context-label">📝 Summary</span><span className="strategic-context-text">{summary}</span></div>}
                        {structuredContext && quantitativeEntries.length > 0 && (
                          <div className="strategic-context-item strategic-context-summary">
                            <span className="strategic-context-label">📈 Quantitative Priors</span>
                            <span className="strategic-context-text">{quantitativeEntries.map((e) => `${e.label}: ${e.value}`).join(' | ')}</span>
                          </div>
                        )}
                        {structuredContext && trustedDomains.length > 0 && (
                          <div className="strategic-context-item strategic-context-summary">
                            <span className="strategic-context-label">🔗 Trusted Domains</span>
                            <span className="strategic-context-text">{trustedDomains.join(', ')}</span>
                          </div>
                        )}
                        {structuredContext && searchQueries.length > 0 && (
                          <div className="strategic-context-item strategic-context-summary">
                            <span className="strategic-context-label">🔍 Search Queries</span>
                            <span className="strategic-context-text">{searchQueries.join(' | ')}</span>
                          </div>
                        )}
                        {!structuredContext && (
                          <div className="strategic-context-item strategic-context-summary">
                            <span className="strategic-context-label">⚠️ Trust Note</span>
                            <span className="strategic-context-text">Legacy context detected. Trust metadata is missing, so this context may be stale and should be refreshed near kickoff.</span>
                          </div>
                        )}
                        {refreshMeta?.last_error && (
                          <div className="strategic-context-item strategic-context-summary">
                            <span className="strategic-context-label">⚠️ Last Error</span>
                            <span className="strategic-context-text">{refreshMeta.last_error}</span>
                          </div>
                        )}
                      </div>
                      {item.strategic_context_at && (
                        <div className="strategic-context-footer">Updated: {formatLocalDateTime(item.strategic_context_at)}</div>
                      )}
                    </div>
                  </div>
                )}

                {/* AI Recommended Condition */}
                {item.recommended_custom_condition && (
                  <div className="form-group">
                    <div className="ai-recommended-box">
                      <div className="ai-recommended-header">🤖 AI Recommended Condition</div>
                      <div className="ai-recommended-content">
                        <div className="ai-recommended-item">
                          <label>Condition:</label>
                          <div className="ai-recommended-value">{item.recommended_custom_condition}</div>
                        </div>
                        {item.recommended_condition_reason_vi && (
                          <div className="ai-recommended-item">
                            <label>Reason:</label>
                            <div className="ai-recommended-value">{item.recommended_condition_reason_vi}</div>
                          </div>
                        )}
                      </div>
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => {
                        const current = editConditions.trim();
                        if (current && current.includes(item.recommended_custom_condition!)) return;
                        const rec = item.recommended_custom_condition!;
                        setEditConditions(current ? `${current} OR (${rec})` : `(${rec})`);
                      }}>
                        ✨ Apply Recommended Condition
                      </button>
                    </div>
                  </div>
                )}

                <div className="form-group">
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--gray-600)' }}>
                    <input
                      type="checkbox"
                      checked={autoApplyRecommendedCondition}
                      onChange={(e) => setAutoApplyRecommendedCondition(e.target.checked)}
                    />
                    Auto-apply recommended condition for this match
                  </label>
                </div>

                <ConditionBuilder initialValue={editConditions} onChange={setEditConditions} />
                <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>Save Changes</button>
              </>
            );
          })()}
        </form>
      )}
    </Modal>
  );
}
