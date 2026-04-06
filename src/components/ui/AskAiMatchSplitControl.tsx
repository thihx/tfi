import { type CSSProperties, type ReactNode } from 'react';

function SparkleIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden style={{ display: 'block' }}>
      <path d="M12 2l1.5 4.5L18 8l-4.5 1.5L12 14l-1.5-4.5L6 8l4.5-1.5L12 2z" />
      <path d="M19 14l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9.9-2.1z" />
      <path d="M5 17l.6 1.4L7 19l-1.4.6L5 21l-.6-1.4L3 19l1.4-.6L5 17z" />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

/** Two people + overlapping speech bubbles (inline SVG — not emoji / icon font). */
function TwoPeopleChatIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      style={{ display: 'block' }}
    >
      {/* Left & right busts — clearly separated so it reads as two people */}
      <circle cx="6.25" cy="7.75" r="2.5" fill="currentColor" />
      <path
        d="M2.75 19.25c0-2.1 1.7-3.8 3.8-3.8h.15"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <circle cx="17.75" cy="7.75" r="2.5" fill="currentColor" />
      <path
        d="M21.25 19.25c0-2.1-1.7-3.8-3.8-3.8h-.15"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      {/* Overlapping speech bubbles between them */}
      <path
        d="M9.25 9.75h3.25a.85.85 0 01.85.85v1.35h-1.15l-1.1 1v-1H9.4a.85.85 0 01-.85-.85v-.5a.85.85 0 01.85-.85z"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M11.5 12.35h3.25a.85.85 0 01.85.85v.95h-1.1l-1.1 1v-1h-1.9a.85.85 0 01-.85-.85v-.25a.85.85 0 01.85-.85z"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

export interface AskAiMatchSplitControlProps {
  /** Reserved for layout tweaks; both modes use the same 36px icon-button sizing as Watch/Edit. */
  variant: 'table' | 'card';
  hasResult: boolean;
  isAnalyzing: boolean;
  isWatched: boolean;
  onQuick: () => void;
  onOpenQuestion: () => void;
}

const BTN_CLASS = 'btn btn-sm action-icon-btn';

export function AskAiMatchSplitControl({
  variant,
  hasResult,
  isAnalyzing,
  isWatched,
  onQuick,
  onOpenQuestion,
}: AskAiMatchSplitControlProps): ReactNode {
  const disabled = !isWatched || isAnalyzing;
  const primaryVariant = hasResult ? 'btn-success' : 'btn-secondary';

  const groupStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'stretch',
    gap: '6px',
    verticalAlign: 'middle',
    opacity: disabled ? 0.55 : 1,
    pointerEvents: disabled ? 'none' : 'auto',
  };

  const analysisTitle = !isWatched
    ? 'Add this match to Watchlist to run analysis'
    : hasResult
      ? 'View cached analysis'
      : 'Run match analysis';

  const chatTooltip = hasResult ? 'Jump to match chat' : 'Ask with a custom question…';

  return (
    <div
      className="ask-ai-split"
      data-variant={variant}
      style={groupStyle}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className={`${BTN_CLASS} ${primaryVariant}`}
        style={{ margin: 0, borderRadius: '8px' }}
        onClick={onQuick}
        disabled={disabled}
        title={analysisTitle}
        aria-label={
          !isWatched
            ? 'Add this match to Watchlist to run analysis'
            : hasResult
              ? 'View analysis result'
              : 'Run match analysis'
        }
      >
        {isAnalyzing ? (
          <span className="inline-spinner" style={{ width: '14px', height: '14px' }} />
        ) : hasResult ? (
          <CheckGlyph />
        ) : (
          <SparkleIcon size={14} />
        )}
      </button>

      <button
        type="button"
        className={`${BTN_CLASS} btn-secondary`}
        style={{ margin: 0, borderRadius: '8px' }}
        onClick={() => onOpenQuestion()}
        disabled={disabled}
        title={chatTooltip}
        aria-label={hasResult ? 'Jump to match chat' : 'Ask with a custom question'}
      >
        <TwoPeopleChatIcon size={14} />
      </button>
    </div>
  );
}
