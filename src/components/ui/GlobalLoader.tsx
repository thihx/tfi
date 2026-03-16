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
        <div className="loader-brand">📈 Time for Investment</div>
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
