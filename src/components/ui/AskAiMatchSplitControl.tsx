import { useRef, type CSSProperties, type ReactNode } from 'react';

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

export interface AskAiMatchSplitControlProps {
  variant: 'table' | 'card';
  hasResult: boolean;
  isAnalyzing: boolean;
  isWatched: boolean;
  onQuick: () => void;
  onOpenQuestion: () => void;
}

/**
 * Primary = quick analysis or view cached result; chevron opens optional “ask with a question” dialog.
 */
export function AskAiMatchSplitControl({
  variant,
  hasResult,
  isAnalyzing,
  isWatched,
  onQuick,
  onOpenQuestion,
}: AskAiMatchSplitControlProps): ReactNode {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const disabled = !isWatched || isAnalyzing;
  const isTable = variant === 'table';

  const btnClass = isTable ? 'btn btn-sm action-icon-btn' : 'btn btn-sm';
  const primaryVariant = hasResult ? 'btn-success' : 'btn-secondary';
  const groupStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'stretch',
    borderRadius: '6px',
    overflow: 'visible',
    opacity: disabled ? 0.55 : 1,
    pointerEvents: disabled ? 'none' : 'auto',
    verticalAlign: 'middle',
  };

  const closeMenu = () => {
    const el = detailsRef.current;
    if (el) el.open = false;
  };

  const handleMenuPick = () => {
    closeMenu();
    onOpenQuestion();
  };

  return (
    <div
      className="ask-ai-split"
      style={groupStyle}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className={`${btnClass} ${primaryVariant}`}
        style={{
          borderTopRightRadius: 0,
          borderBottomRightRadius: 0,
          margin: 0,
          minWidth: isTable ? undefined : '40px',
        }}
        onClick={onQuick}
        disabled={disabled}
        title={
          !isWatched
            ? 'Add this match to Watchlist to use Ask AI'
            : hasResult
              ? 'View cached result'
              : 'Run AI analysis'
        }
        aria-label={
          !isWatched
            ? 'Add this match to Watchlist to use Ask AI'
            : hasResult
              ? 'View AI result'
              : 'Run AI analysis'
        }
      >
        {isAnalyzing ? (
          <span className="inline-spinner" style={{ width: '14px', height: '14px' }} />
        ) : hasResult ? (
          <CheckGlyph />
        ) : (
          <SparkleIcon size={isTable ? 14 : 15} />
        )}
      </button>

      <details
        ref={detailsRef}
        className="ask-ai-split__details"
        style={{ position: 'relative', margin: 0 }}
        onToggle={(e) => {
          const d = e.currentTarget;
          if (!d.open || disabled) return;
        }}
      >
        <summary
          className={`ask-ai-split__summary ${btnClass} ${primaryVariant}`}
          style={{
            listStyle: 'none',
            borderTopLeftRadius: 0,
            borderBottomLeftRadius: 0,
            borderLeft: '1px solid rgba(0,0,0,0.08)',
            margin: 0,
            cursor: disabled ? 'not-allowed' : 'pointer',
            paddingLeft: isTable ? '6px' : '8px',
            paddingRight: isTable ? '6px' : '8px',
          }}
          onClick={(e) => {
            if (disabled) {
              e.preventDefault();
              return;
            }
            e.stopPropagation();
          }}
          aria-label="Ask AI with a custom question"
          title="Ask with a custom question…"
        >
          <span style={{ fontSize: '10px', lineHeight: 1, opacity: 0.85 }} aria-hidden>▾</span>
        </summary>
        <div
          role="menu"
          className="ask-ai-split__menu"
          style={{
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 4px)',
            zIndex: 50,
            minWidth: '200px',
            padding: '6px 0',
            background: 'var(--gray-0, #fff)',
            border: '1px solid var(--gray-200)',
            borderRadius: '8px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
          }}
        >
          <button
            type="button"
            role="menuitem"
            className="btn"
            style={{
              width: '100%',
              justifyContent: 'flex-start',
              border: 'none',
              borderRadius: 0,
              background: 'transparent',
              fontSize: '13px',
              padding: '8px 12px',
              fontWeight: 400,
              textAlign: 'left',
            }}
            onClick={(e) => {
              e.stopPropagation();
              handleMenuPick();
            }}
          >
            Ask with a custom question…
          </button>
        </div>
      </details>
    </div>
  );
}
