import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Modal } from '@/components/ui/Modal';
import { AskAiQuickPromptChips } from '@/components/ui/AskAiQuickPromptChips';
import { useAskAiQuickPromptList } from '@/hooks/useAskAiQuickPromptList';
import { useUiLanguage } from '@/hooks/useUiLanguage';
import {
  ASK_AI_CHAT_MAX_CHARS,
  getAskAiQuickPromptsSectionLabel,
  uiLanguageToAskAiPromptLocale,
} from '@/lib/askAiQuickPrompts';
import type { Match } from '@/types';

interface AskAiMatchDialogProps {
  open: boolean;
  match: Match | null;
  isRunning: boolean;
  onClose: () => void;
  onSubmit: (question: string) => void;
}

export function AskAiMatchDialog({ open, match, isRunning, onClose, onSubmit }: AskAiMatchDialogProps) {
  const uiLanguage = useUiLanguage();
  const promptLocale = uiLanguageToAskAiPromptLocale(uiLanguage);
  const quickPrompts = useAskAiQuickPromptList(promptLocale);
  const quickPromptsLabel = getAskAiQuickPromptsSectionLabel('en');

  const [draft, setDraft] = useState('');
  const descId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) setDraft('');
  }, [open, match?.match_id]);

  useEffect(() => {
    if (!open || !match || isRunning) return;
    const t = window.setTimeout(() => {
      textareaRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(t);
  }, [open, match?.match_id, isRunning]);

  const title = match ? `Ask a question — ${match.home_team} vs ${match.away_team}` : 'Ask a question';

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
            disabled={isRunning || draft.length > ASK_AI_CHAT_MAX_CHARS}
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
      <AskAiQuickPromptChips
        label={quickPromptsLabel}
        prompts={quickPrompts}
        disabled={isRunning}
        onPick={(text) => setDraft(text.slice(0, MAX_QUESTION_CHARS))}
      />
      <textarea
        ref={textareaRef}
        id="ask-ai-match-question"
        aria-labelledby={descId}
        aria-label="Your question (optional)"
        value={draft}
        onChange={(e) => setDraft(e.target.value.slice(0, ASK_AI_CHAT_MAX_CHARS))}
        onKeyDown={handleKeyDown}
        disabled={isRunning}
        maxLength={ASK_AI_CHAT_MAX_CHARS}
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
      <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--gray-400)' }}>
        Shift+Enter for new line · Enter to run
      </div>
    </Modal>
  );
}
