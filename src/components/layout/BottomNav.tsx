import { useState } from 'react';
import type { TabName } from '@/types';

interface BottomNavProps {
  activeTab: TabName;
  onTabChange: (tab: TabName) => void;
}

const PRIMARY: { key: TabName; label: string; icon: string }[] = [
  { key: 'dashboard',       label: 'Home',    icon: '📊' },
  { key: 'matches',         label: 'Matches', icon: '⚽' },
  { key: 'watchlist',       label: 'Watch',   icon: '🔖' },
  { key: 'recommendations', label: 'Tips',    icon: '💡' },
  { key: 'live-monitor',    label: 'Live',    icon: '🔴' },
];

const MORE: { key: TabName; label: string; icon: string }[] = [
  { key: 'bet-tracker', label: 'Investment Tracker', icon: '💹' },
  { key: 'leagues',     label: 'Leagues',            icon: '🏆' },
  { key: 'reports',     label: 'Reports',            icon: '📈' },
  { key: 'settings',    label: 'Settings',           icon: '⚙️' },
];

const MORE_KEYS = new Set<TabName>(MORE.map((t) => t.key));

export function BottomNav({ activeTab, onTabChange }: BottomNavProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isMoreActive = MORE_KEYS.has(activeTab);

  const handleTabChange = (key: TabName) => {
    setDrawerOpen(false);
    onTabChange(key);
  };

  return (
    <>
      {/* Backdrop */}
      {drawerOpen && (
        <div
          className="bottom-nav-backdrop"
          onClick={() => setDrawerOpen(false)}
        />
      )}

      {/* More drawer */}
      {drawerOpen && (
        <div className="bottom-nav-drawer">
          {MORE.map((t) => (
            <button
              key={t.key}
              className={`bottom-nav-drawer-item${activeTab === t.key ? ' active' : ''}`}
              onClick={() => handleTabChange(t.key)}
            >
              <span className="bottom-nav-drawer-icon">{t.icon}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* Bottom bar */}
      <nav className="bottom-nav">
        {PRIMARY.map((t) => (
          <button
            key={t.key}
            className={`bottom-nav-item${activeTab === t.key ? ' active' : ''}`}
            onClick={() => handleTabChange(t.key)}
          >
            <span className="bottom-nav-icon">{t.icon}</span>
            <span className="bottom-nav-label">{t.label}</span>
          </button>
        ))}

        {/* More button */}
        <button
          className={`bottom-nav-item${isMoreActive || drawerOpen ? ' active' : ''}`}
          onClick={() => setDrawerOpen((o) => !o)}
        >
          <span className="bottom-nav-icon">☰</span>
          <span className="bottom-nav-label">More</span>
        </button>
      </nav>
    </>
  );
}
