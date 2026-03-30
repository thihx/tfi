interface GlobalLoaderProps {
  loading: boolean;
  progress: number;
  message: string;
}

export function GlobalLoader({ loading, progress, message }: GlobalLoaderProps) {
  if (!loading) return null;
  const pct = Math.max(0, Math.min(100, Math.round(progress)));
  return (
    <div className="global-loader" style={{ display: 'flex' }}>
      <div className="loader-content">
        <div className="loader-brand" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg> Time for Investment</div>
        <div className="loader-spinner" />
        <div className="loader-progress">
          <div className="loader-progress-bar">
            <div className="loader-progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="loader-progress-text">
            <span id="loaderPercent">{pct}%</span>
            <span id="loaderMessage">{message || 'Loading...'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
