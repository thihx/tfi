import type { ReactNode } from 'react';

interface EmptyStateProps {
  title: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ title, action, className = '' }: EmptyStateProps) {
  return (
    <div className={`empty-state-panel${className ? ` ${className}` : ''}`}>
      <p className="empty-state-panel__title">{title}</p>
      {action ? <div className="empty-state-panel__actions">{action}</div> : null}
    </div>
  );
}