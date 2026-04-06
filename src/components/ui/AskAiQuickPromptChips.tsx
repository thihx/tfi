import type { AskAiQuickPromptItem } from '@/lib/askAiQuickPrompts';

interface AskAiQuickPromptChipsProps {
  prompts: readonly AskAiQuickPromptItem[];
  onPick: (text: string) => void;
  disabled?: boolean;
  /** Section label (locale-specific from parent). */
  label: string;
}

/**
 * Compact wrap row of default live-betting quick prompts.
 */
export function AskAiQuickPromptChips({ prompts, onPick, disabled, label }: AskAiQuickPromptChipsProps) {
  if (prompts.length === 0) return null;

  return (
    <div style={{ marginBottom: '10px' }}>
      <div
        style={{
          fontSize: '10px',
          fontWeight: 600,
          color: 'var(--gray-500)',
          textTransform: 'uppercase',
          letterSpacing: '0.35px',
          marginBottom: '6px',
        }}
      >
        {label}
      </div>
      <div
        role="list"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '6px',
          alignItems: 'center',
        }}
      >
        {prompts.map((p) => (
          <button
            key={p.id}
            type="button"
            role="listitem"
            className="btn btn-secondary btn-sm"
            disabled={disabled}
            title={p.text}
            onClick={() => onPick(p.text)}
            style={{
              maxWidth: '100%',
              fontSize: '11px',
              lineHeight: 1.35,
              padding: '4px 8px',
              borderRadius: '6px',
              whiteSpace: 'normal',
              textAlign: 'left',
              hyphens: 'auto',
            }}
          >
            {p.text}
          </button>
        ))}
      </div>
    </div>
  );
}