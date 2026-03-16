interface HeaderProps {
  onLogout: () => void;
}

export function Header({ onLogout }: HeaderProps) {
  return (
    <div className="header">
      <h1>📈 Time for Investment</h1>
      <div className="header-actions">
        <button className="btn btn-secondary btn-sm" onClick={onLogout}>
          🚪 Logout
        </button>
      </div>
    </div>
  );
}
