import type { TabName } from '@/types';

const TABS: { key: TabName; icon: string; label: string }[] = [
  { key: 'dashboard', icon: '📊', label: 'Dashboard' },
  { key: 'matches', icon: '📅', label: 'Matches' },
  { key: 'watchlist', icon: '👁️', label: 'Watchlist' },
  { key: 'recommendations', icon: '🎯', label: 'Recommendations' },
  { key: 'live-monitor', icon: '📡', label: 'Live Monitor' },
  { key: 'settings', icon: '⚙️', label: 'Settings' },
];

interface NavigationProps {
  activeTab: TabName;
  onTabChange: (tab: TabName) => void;
}

export function Navigation({ activeTab, onTabChange }: NavigationProps) {
  return (
    <div className="nav">
      {TABS.map((t) => (
        <div
          key={t.key}
          className={`nav-item${activeTab === t.key ? ' active' : ''}`}
          onClick={() => onTabChange(t.key)}
        >
          {t.icon} {t.label}
        </div>
      ))}
    </div>
  );
}
