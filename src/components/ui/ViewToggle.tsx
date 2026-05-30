export type ViewToggleMode = 'table' | 'cards';

interface ViewToggleProps {
  mode: ViewToggleMode;
  onModeChange: (mode: ViewToggleMode) => void;
  showChart?: boolean;
  chartActive?: boolean;
  onChartToggle?: () => void;
}

const IconChart = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </svg>
);

const IconTable = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 9h18M3 15h18M9 3v18" />
  </svg>
);

const IconCards = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </svg>
);

export function ViewToggle({ mode, onModeChange, showChart, chartActive, onChartToggle }: ViewToggleProps) {
  return (
    <div className="view-toggle" role="group" aria-label="View mode">
      {showChart && onChartToggle && (
        <button
          type="button"
          className={`view-toggle__btn${chartActive ? ' view-toggle__btn--active' : ''}`}
          onClick={onChartToggle}
          title={chartActive ? 'Hide chart' : 'Show chart'}
          aria-pressed={chartActive}
        >
          <IconChart />
        </button>
      )}
      <button
        type="button"
        className={`view-toggle__btn${mode === 'table' ? ' view-toggle__btn--active' : ''}`}
        onClick={() => onModeChange('table')}
        title="Table view"
        aria-pressed={mode === 'table'}
      >
        <IconTable />
      </button>
      <button
        type="button"
        className={`view-toggle__btn${mode === 'cards' ? ' view-toggle__btn--active' : ''}`}
        onClick={() => onModeChange('cards')}
        title="Card view"
        aria-pressed={mode === 'cards'}
      >
        <IconCards />
      </button>
    </div>
  );
}