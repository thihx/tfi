// WatchlistEditModal — watch rules and conditions (context/priors live in Match hub)
import { useEffect, useMemo, useState } from 'react';
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

function watchlistEditCopy(ui: UiLanguage) {
  if (ui === 'vi') {
    return {
      intro:
        'Chọn cách trận này kích hoạt cảnh báo. Thống kê live và ngữ cảnh AI nằm ở hub trận — mở dòng trận (double-click).',
      suggestionTitle: 'Đề xuất từ hệ thống',
      suggestionEmpty:
        'Chưa có điều kiện gợi ý dạng máy (thường gặp khi enrich chưa xong, nguồn tin yếu, hoặc mô hình chưa trả biểu thức trong ngoặc). Bạn vẫn có thể nhập điều kiện thủ công bên dưới.',
      conditionLabel: 'Biểu thức',
      reasonLabel: 'Lý do',
      applyRecommended: 'Chèn đề xuất vào ô nhập thủ công',
      autoApplyLabel: 'Tự dùng đề xuất khi lưu',
      autoApplyHint:
        'Khi bật: nếu ô điều kiện thủ công trống (hoặc trùng đề xuất), Lưu sẽ ghi đề xuất ở trên. Nếu bạn đã nhập khác, Lưu giữ nội dung bạn nhập.',
      manualSection: 'Điều kiện thủ công (tùy chọn)',
      conditionPlaceholder: '(Minute >= 60) AND (Total goals <= 2)',
      previewNoteAuto:
        'Phần xem trước chỉ hiển thị các mệnh đề bạn gõ ở dưới. Khi bật tự dùng đề xuất và để trống, Lưu sẽ lưu đề xuất ở trên.',
      manualHintNoSuggestion: 'Chưa có đề xuất — thêm một hoặc nhiều mệnh đề trong ngoặc ở dưới.',
      save: 'Lưu thay đổi',
    };
  }
  return {
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
  };
}

interface WatchlistEditModalProps {
  item: WatchlistItem | null;
  uiLanguage: UiLanguage;
  onClose: () => void;
  onSave: (changes: {
    custom_conditions: string;
    auto_apply_recommended_condition: boolean;
  }) => void;
}

export function WatchlistEditModal({ item, uiLanguage, onClose, onSave }: WatchlistEditModalProps) {
  const c = watchlistEditCopy(uiLanguage);
  const [editConditions, setEditConditions] = useState(() => item?.custom_conditions || '');
  const [autoApplyRecommendedCondition, setAutoApplyRecommendedCondition] = useState(() => item?.auto_apply_recommended_condition ?? true);

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
  }, [item]);

  const recommendedRaw = item?.recommended_custom_condition;
  const hasRecommended = Boolean(normalizeCondition(recommendedRaw));
  const reasonText = useMemo(() => {
    if (!item) return '';
    return uiLanguage === 'vi'
      ? (item.recommended_condition_reason_vi || item.recommended_condition_reason || '').trim()
      : (item.recommended_condition_reason || item.recommended_condition_reason_vi || '').trim();
  }, [item, uiLanguage]);

  const manualTrim = normalizeCondition(editConditions);
  const previewNote = useMemo(() => {
    if (!autoApplyRecommendedCondition || !hasRecommended || manualTrim) return null;
    return c.previewNoteAuto;
  }, [autoApplyRecommendedCondition, hasRecommended, manualTrim, c.previewNoteAuto]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!item) return;
    const recommendedCondition = normalizeCondition(item.recommended_custom_condition || '');
    const currentCondition = normalizeCondition(editConditions);
    const safeToAutoApply = !currentCondition || currentCondition === recommendedCondition;
    onSave({
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
            {c.intro}
          </p>

          <div className="form-group" style={{ marginBottom: '14px' }}>
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

          <div style={{ marginBottom: '14px' }}>
            <label
              htmlFor="watchlist-auto-apply-rec"
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '10px',
                padding: '10px 14px',
                borderRadius: '6px',
                background: 'var(--bg-secondary, #f8f8f8)',
                border: '1px solid var(--border-color, #e0e0e0)',
                cursor: 'pointer',
                userSelect: 'none',
              }}
            >
              <input
                id="watchlist-auto-apply-rec"
                type="checkbox"
                checked={autoApplyRecommendedCondition}
                onChange={(e) => setAutoApplyRecommendedCondition(e.target.checked)}
                style={{ margin: '2px 0 0', flexShrink: 0 }}
              />
              <span style={{ fontSize: '13px', color: 'var(--text-secondary, #555)', lineHeight: 1.45 }}>
                {c.autoApplyLabel}
              </span>
            </label>
            <p
              id="watchlist-auto-apply-rec-hint"
              style={{
                fontSize: '11px',
                color: 'var(--gray-600)',
                margin: '6px 0 0 2px',
                lineHeight: 1.45,
                paddingLeft: '28px',
              }}
            >
              {c.autoApplyHint}
            </p>
          </div>

          {!hasRecommended ? (
            <p style={{ fontSize: '12px', color: 'var(--gray-600)', margin: '0 0 10px', lineHeight: 1.45 }}>
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
          <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '16px' }}>
            {c.save}
          </button>
        </form>
      )}
    </Modal>
  );
}
