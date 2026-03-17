import type { TabName } from '@/types';

const TABS: { key: TabName; label: string }[] = [
  { key: 'dashboard',       label: 'Dashboard' },
  { key: 'leagues',         label: 'Leagues' },
  { key: 'matches',         label: 'Matches' },
  { key: 'watchlist',       label: 'Watchlist' },
  { key: 'recommendations', label: 'Recommendations' },
  { key: 'bet-tracker',     label: 'Investment Tracker' },
  { key: 'live-monitor',    label: 'Live Monitor' },
  { key: 'reports',         label: 'Reports' },
  { key: 'settings',        label: 'Settings' },
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
          {t.label}
        </div>
      ))}
    </div>
  );
}
