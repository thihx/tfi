import { useEffect, useRef } from 'react';
import type { AskAiQuickPromptItem } from '@/lib/askAiQuickPrompts';

interface AskAiQuickPromptChipsProps {
  prompts: readonly AskAiQuickPromptItem[];
  onPick: (text: string) => void;
  disabled?: boolean;
  /** Section label (locale-specific from parent). */
  label: string;
  /** Collapse behind a summary on small screens (expanded by default on desktop). */
  collapsible?: boolean;
}

function QuickPromptChipList({
  prompts,
  onPick,
  disabled,
}: {
  prompts: readonly AskAiQuickPromptItem[];
  onPick: (text: string) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="list"
      className="ai-quick-prompts__list"
    >
      {prompts.map((p) => (
        <button
          key={p.id}
          type="button"
          role="listitem"
          className="btn btn-secondary btn-sm ai-quick-prompts__chip"
          disabled={disabled}
          title={p.text}
          onClick={() => onPick(p.text)}
        >
          {p.text}
        </button>
      ))}
    </div>
  );
}

/**
 * Compact wrap row of default live-betting quick prompts.
 */
export function AskAiQuickPromptChips({
  prompts,
  onPick,
  disabled,
  label,
  collapsible = false,
}: AskAiQuickPromptChipsProps) {
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (!collapsible) return;
    const mq = window.matchMedia('(min-width: 768px)');
    const sync = () => {
      if (detailsRef.current) detailsRef.current.open = mq.matches;
    };
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, [collapsible]);

  if (prompts.length === 0) return null;

  const chipList = (
    <QuickPromptChipList prompts={prompts} onPick={onPick} disabled={disabled} />
  );

  if (!collapsible) {
    return (
      <div className="ai-quick-prompts">
        <div className="ai-quick-prompts__label">{label}</div>
        {chipList}
      </div>
    );
  }

  return (
    <details ref={detailsRef} className="ai-quick-prompts-collapse" data-label={label}>
      <summary className="ai-quick-prompts-collapse__summary">
        {label}
        <span className="ai-quick-prompts-collapse__count">{prompts.length}</span>
      </summary>
      <div className="ai-quick-prompts-collapse__body">
        {chipList}
      </div>
    </details>
  );
}