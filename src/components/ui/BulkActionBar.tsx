import type { ReactNode } from 'react';

interface BulkActionBarProps {
  count: number;
  variant?: 'info' | 'danger';
  children: ReactNode;
  onClear?: () => void;
  clearLabel?: string;
}

export function BulkActionBar({
  count,
  variant = 'info',
  children,
  onClear,
  clearLabel = 'Clear',
}: BulkActionBarProps) {
  return (
    <div className={`bulk-bar bulk-bar--${variant}`} role="status">
      <span className="bulk-bar__count">{count} selected</span>
      <div className="bulk-bar__actions">{children}</div>
      {onClear && (
        <button type="button" className="btn btn-secondary btn-sm bulk-bar__clear" onClick={onClear}>
          {clearLabel}
        </button>
      )}
    </div>
  );
}