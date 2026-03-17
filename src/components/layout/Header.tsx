import type { TabName } from '@/types';

const TAB_LABELS: Record<TabName, string> = {
  dashboard:       'Dashboard',
  matches:         'Matches',
  watchlist:       'Watchlist',
  recommendations: 'Recommendations',
  'bet-tracker':   'Investment Tracker',
  reports:         'Reports',
  'live-monitor':  'Live Monitor',
  leagues:         'Leagues',
  settings:        'Settings',
};

interface HeaderProps {
  activeTab: TabName;
  onLogout: () => void;
}

export function Header({ activeTab, onLogout }: HeaderProps) {
  return (
    <div className="header">
      <h1>{TAB_LABELS[activeTab] ?? activeTab}</h1>
      <div className="header-actions">
        <button className="btn btn-secondary btn-sm" onClick={onLogout}>
          Logout
        </button>
      </div>
    </div>
  );
}
