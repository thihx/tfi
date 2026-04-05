import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { Modal } from '@/components/ui/Modal';
import type { Match } from '@/types';

const MAX_QUESTION_CHARS = 2000;

interface AskAiMatchDialogProps {
  open: boolean;
  match: Match | null;
  isRunning: boolean;
  onClose: () => void;
  onSubmit: (question: string) => void;
}

export function AskAiMatchDialog({ open, match, isRunning, onClose, onSubmit }: AskAiMatchDialogProps) {
  const [draft, setDraft] = useState('');
  const descId = useId();

  useEffect(() => {
    if (open) setDraft('');
  }, [open, match?.match_id]);

  const title = match ? `Ask AI — ${match.home_team} vs ${match.away_team}` : 'Ask AI';

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    if (!isRunning && draft.length <= MAX_QUESTION_CHARS) onSubmit(draft.trim());
  };

  return (
    <Modal
      open={open && match != null}
      title={title}
      onClose={isRunning ? () => {} : onClose}
      size="md"
      footer={(
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={isRunning}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onSubmit(draft.trim())}
            disabled={isRunning || draft.length > MAX_QUESTION_CHARS}
            aria-busy={isRunning}
          >
            {isRunning ? 'Running…' : 'Run analysis'}
          </button>
        </>
      )}
    >
      <p id={descId} style={{ margin: '0 0 10px', fontSize: '13px', color: 'var(--gray-600)', lineHeight: 1.5 }}>
        Optional question for the first run (e.g. focus on a market). Leave empty for the same standard analysis as a quick run.
      </p>
      <textarea
        id="ask-ai-match-question"
        aria-labelledby={descId}
        aria-label="Your question (optional)"
        value={draft}
        onChange={(e) => setDraft(e.target.value.slice(0, MAX_QUESTION_CHARS))}
        onKeyDown={handleKeyDown}
        disabled={isRunning}
        placeholder="Your question (optional)"
        rows={4}
        style={{
          width: '100%',
          minHeight: '88px',
          resize: 'vertical',
          borderRadius: '8px',
          border: '1px solid var(--gray-200)',
          padding: '10px 12px',
          fontSize: '13px',
          lineHeight: 1.45,
          fontFamily: 'inherit',
          boxSizing: 'border-box',
          background: isRunning ? 'var(--gray-100)' : '#fff',
        }}
      />
      <div style={{ marginTop: '6px', fontSize: '11px', color: 'var(--gray-400)', textAlign: 'right' }}>
        {draft.length}/{MAX_QUESTION_CHARS}
      </div>
      <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--gray-400)' }}>
        Shift+Enter for new line · Enter to run
      </div>
    </Modal>
  );
}
