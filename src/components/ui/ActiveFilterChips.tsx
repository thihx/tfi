export interface ActiveFilterChip {
  key: string;
  label: string;
  onRemove: () => void;
}

interface ActiveFilterChipsProps {
  chips: ActiveFilterChip[];
  onClearAll?: () => void;
}

export function ActiveFilterChips({ chips, onClearAll }: ActiveFilterChipsProps) {
  if (chips.length === 0) return null;

  return (
    <div className="filter-chips-row" aria-label="Active filters">
      {chips.map((chip) => (
        <span key={chip.key} className="filter-chip">
          {chip.label}
          <button
            type="button"
            className="filter-chip__remove"
            onClick={chip.onRemove}
            aria-label={`Remove ${chip.label} filter`}
          >
            {'\u00d7'}
          </button>
        </span>
      ))}
      {onClearAll && (
        <button type="button" className="btn btn-secondary btn-sm" onClick={onClearAll}>
          Clear all
        </button>
      )}
    </div>
  );
}