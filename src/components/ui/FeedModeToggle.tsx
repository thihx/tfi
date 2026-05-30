interface FeedModeToggleProps<T extends string> {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  hint?: string;
}

export function FeedModeToggle<T extends string>({ value, options, onChange, hint }: FeedModeToggleProps<T>) {
  return (
    <div className="feed-mode-bar">
      <div className="feed-mode-toggle" role="group">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className={`feed-mode-toggle__btn${value === opt.value ? ' feed-mode-toggle__btn--active' : ''}`}
            onClick={() => onChange(opt.value)}
            aria-pressed={value === opt.value}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {hint ? <span className="feed-mode-bar__hint">{hint}</span> : null}
    </div>
  );
}