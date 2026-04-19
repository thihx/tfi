import { useState, useCallback, useEffect, useRef } from 'react';

const MAX_CONDITIONS = 10;

interface ConditionRow {
  id: number;
  text: string;
  operator: 'AND' | 'OR';
}

interface ConditionBuilderProps {
  initialValue: string;
  onChange: (value: string) => void;
  /** Section heading above the clause rows (default: Conditions) */
  sectionLabel?: string;
  /** Placeholder for each clause input */
  inputPlaceholder?: string;
  /** Short note shown under the preview line (e.g. auto-apply vs preview) */
  previewNote?: string | null;
}

let nextRowId = 1;

function parseConditionsString(str: string): ConditionRow[] {
  if (!str?.trim()) return [];
  const regex = /\(([^)]+)\)(?:\s+(AND|OR))?/g;
  const result: ConditionRow[] = [];
  let match;
  while ((match = regex.exec(str)) !== null) {
    result.push({ id: nextRowId++, text: match[1]!, operator: (match[2] as 'AND' | 'OR') || 'AND' });
  }
  if (result.length === 0) {
    return [{ id: nextRowId++, text: str.trim(), operator: 'AND' }];
  }
  return result;
}

function buildConditionsString(rows: ConditionRow[]): string {
  const valid = rows.filter((r) => r.text.trim());
  return valid.map((r, i) => (i > 0 ? `${r.operator} ` : '') + `(${r.text.trim()})`).join(' ');
}

export function ConditionBuilder({
  initialValue,
  onChange,
  sectionLabel = 'Conditions',
  inputPlaceholder = 'e.g., Corners > 10, BTTS, Shots ≥ 5',
  previewNote = null,
}: ConditionBuilderProps) {
  const [rows, setRows] = useState<ConditionRow[]>(() => {
    const parsed = parseConditionsString(initialValue);
    return parsed.length > 0 ? parsed : [{ id: nextRowId++, text: '', operator: 'AND' }];
  });

  // Track the last value we emitted so we don't re-parse our own changes.
  // Without this, every keystroke: notify → onChange → parent setState → new initialValue
  // → useEffect fires → setRows with NEW ids → React unmounts/remounts inputs → focus lost.
  const lastEmittedRef = useRef<string>(buildConditionsString(rows));

  // Re-initialize only when initialValue changes externally (modal reopen, apply recommended)
  useEffect(() => {
    if (initialValue === lastEmittedRef.current) return;
    lastEmittedRef.current = initialValue;
    const parsed = parseConditionsString(initialValue);
    setRows(parsed.length > 0 ? parsed : [{ id: nextRowId++, text: '', operator: 'AND' }]);
  }, [initialValue]);

  const notify = useCallback(
    (updated: ConditionRow[]) => {
      const built = buildConditionsString(updated);
      lastEmittedRef.current = built;
      setRows(updated);
      onChange(built);
    },
    [onChange],
  );

  const updateRow = (id: number, field: 'text' | 'operator', value: string) => {
    const updated = rows.map((r) => (r.id === id ? { ...r, [field]: value } : r));
    notify(updated);
  };

  const removeRow = (id: number) => {
    const updated = rows.filter((r) => r.id !== id);
    notify(updated.length > 0 ? updated : [{ id: nextRowId++, text: '', operator: 'AND' }]);
  };

  const addRow = () => {
    if (rows.length >= MAX_CONDITIONS) return;
    notify([...rows, { id: nextRowId++, text: '', operator: 'AND' }]);
  };

  const preview = buildConditionsString(rows);

  return (
    <div className="form-group">
      <label>{sectionLabel}</label>
      <div className="cond-builder">
        {rows.map((row, idx) => (
          <div key={row.id} className={`cond-row${idx > 0 ? ' has-operator' : ''}`}>
            {idx > 0 && (
              <select className="cond-op" value={row.operator} onChange={(e) => updateRow(row.id, 'operator', e.target.value)}>
                <option value="AND">AND</option>
                <option value="OR">OR</option>
              </select>
            )}
            <div className="cond-input-wrapper">
              <input
                type="text"
                className="cond-input"
                placeholder={inputPlaceholder}
                value={row.text}
                onChange={(e) => updateRow(row.id, 'text', e.target.value)}
              />
              {row.text && (
                <button type="button" className="cond-clear" style={{ display: 'block' }} onClick={() => updateRow(row.id, 'text', '')}>
                  ✕
                </button>
              )}
            </div>
            {idx > 0 && (
              <button type="button" className="cond-remove" onClick={() => removeRow(row.id)}>
                ✖
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="cond-actions">
        <button type="button" className="btn btn-secondary btn-sm" onClick={addRow}>
          + Add condition
        </button>
      </div>
      <div className="cond-preview">{preview ? `Preview: ${preview}` : 'Preview: (no conditions)'}</div>
      {previewNote ? <div className="cond-preview-note">{previewNote}</div> : null}
    </div>
  );
}
