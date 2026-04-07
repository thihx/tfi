// WatchlistEditModal — watch rules and conditions (context/priors live in Match hub)
import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { ConditionBuilder } from '@/components/ui/ConditionBuilder';
import { fetchMonitorConfig } from '@/features/live-monitor/config';
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

export function WatchlistEditModal({ item, defaultMode, onClose, onSave }: WatchlistEditModalProps) {
  const [editMode, setEditMode] = useState(() => item?.mode || defaultMode);
  const [editPriority, setEditPriority] = useState(() => String(item?.priority || 2));
  const [editStatus, setEditStatus] = useState(() => item?.status || 'active');
  const [editConditions, setEditConditions] = useState(() => item?.custom_conditions || '');
  const [autoApplyRecommendedCondition, setAutoApplyRecommendedCondition] = useState(() => item?.auto_apply_recommended_condition ?? true);

  useEffect(() => {
    if (!item) return;
    let cancelled = false;

    if (item.auto_apply_recommended_condition != null) {
      return;
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
    setEditMode(item.mode || defaultMode);
    setEditPriority(String(item.priority || 2));
    setEditStatus(item.status || 'active');
    setEditConditions(item.custom_conditions || '');
    setAutoApplyRecommendedCondition(item.auto_apply_recommended_condition ?? true);
  }, [item, defaultMode]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!item) return;
    const recommendedCondition = normalizeCondition(item.recommended_custom_condition || '');
    const currentCondition = normalizeCondition(editConditions);
    const safeToAutoApply = !currentCondition || currentCondition === recommendedCondition;
    onSave({
      mode: editMode,
      priority: parseInt(editPriority, 10),
      status: editStatus,
      custom_conditions: autoApplyRecommendedCondition && recommendedCondition && safeToAutoApply
        ? recommendedCondition
        : editConditions,
      auto_apply_recommended_condition: autoApplyRecommendedCondition,
    });
  }

  const matchTitle = item ? `${item.home_team} vs ${item.away_team}` : '';

  return (
    <Modal open={!!item} title={matchTitle || 'Watch alerts and conditions'} onClose={onClose} size="lg">
      {item && (
        <form onSubmit={handleSubmit}>
          <p style={{ fontSize: '12px', color: 'var(--gray-500)', margin: '0 0 16px', lineHeight: 1.5 }}>
            Set mode, priority, and alert conditions for this watchlist match. View league/team priors and match context from the match hub (double-click the row).
          </p>
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
                <option value="pending">Pending</option>
                <option value="active">Active</option>
              </select>
            </div>
          </div>

          {item.recommended_custom_condition && (
            <div className="form-group">
              <div className="ai-recommended-box">
                <div className="ai-recommended-header">Suggested condition</div>
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
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => {
                    const current = editConditions.trim();
                    if (current && current.includes(item.recommended_custom_condition!)) return;
                    const rec = item.recommended_custom_condition!;
                    setEditConditions(current ? `${current} OR (${rec})` : `(${rec})`);
                  }}
                >
                  Apply Recommended Condition
                </button>
              </div>
            </div>
          )}

          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', borderRadius: '6px', background: 'var(--bg-secondary, #f8f8f8)', border: '1px solid var(--border-color, #e0e0e0)', cursor: 'pointer', userSelect: 'none', marginBottom: '16px' }}>
            <input
              type="checkbox"
              checked={autoApplyRecommendedCondition}
              onChange={(e) => setAutoApplyRecommendedCondition(e.target.checked)}
              style={{ margin: 0, flexShrink: 0 }}
            />
            <span style={{ fontSize: '13px', color: 'var(--text-secondary, #555)' }}>
              Auto-apply recommended condition for this match
            </span>
          </label>

          <ConditionBuilder initialValue={editConditions} onChange={setEditConditions} />
          <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '16px' }}>
            Save Changes
          </button>
        </form>
      )}
    </Modal>
  );
}
